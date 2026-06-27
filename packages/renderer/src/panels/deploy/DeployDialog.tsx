/**
 * packages/renderer/src/panels/deploy/DeployDialog.tsx
 * Deploy dialog — modal for client selection, deploy model choice, cfg-slot preview,
 * and build/activate progress. Replaces the 04-02 stub.
 *
 * Structural clone of ExportDialog.tsx (ExportDialog pattern):
 *   overlay + 360px panel + header × + dividers + AsyncProgress + VerificationStatus
 *
 * Fixes applied (04-06 W2/W7/W9/B1/B6 + R2-B1/B2/B7/B8):
 *   W2  — deploys from flatten(activeVersionId), NOT the live staging store
 *   R2-B1/B2 — dirty check uses flatEqual (not stagingEntries.length > 0)
 *   B1  — full-chain scan via scanSharedFile(client.cfgRootPath) — never swgtoolkitCfgPath
 *   B6  — sanitized patch filename via buildPatchName (ConfigFile whitespace truncation fix)
 *   W7  — stale-deployment warning banner when activeVersionId !== deployedVersionId
 *   W9  — deployingRef mutex prevents concurrent deploys sharing the .bak file
 *   R2-B7 — record.patchPath set for Reset fs.unlinkSync call
 *   R2-B8 — updateChangesetDeployRecord persists record so it survives component unmount
 *
 * Source: 04-06-PLAN.md Task 1; 04-UI-SPEC.md §Surface 4; 04-PATTERNS.md §DeployDialog.tsx.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import fs from 'fs';
import path from 'path';

import AsyncProgress from '../../shared/AsyncProgress.js';
import VerificationStatus from '../../shared/VerificationStatus.js';

import { useStagingStore } from '../../state/stagingStore.js';
import { useWorkspaceStore } from '../../state/workspaceStore.js';

import {
  flatten,
  sealVersion,
  setDeployedVersion,
  readManifest,
  flatEqual,
  updateChangesetDeployRecord,
} from '../../services/changesetService.js';
import { packPatch, buildPatchName } from '../../services/packPatch.js';
import { detectClients, scanSharedFile, chooseSlot } from '../../services/clientLocator.js';
import { activatePatch, deactivatePatch, ensureInclude } from '../../services/cfgActivator.js';
import { deployShadowBase, resetShadow, estimateTreSize } from '../../services/shadowBaseService.js';

import type { DetectedClient, CfgInsertionRecord, CfgDeployRecord } from '@swg/contracts';
import type { SharedFileScan } from '../../services/clientLocator.js';
import type { ShadowDeployRecord } from '../../services/shadowBaseService.js';

// ─── Types ────────────────────────────────────────────────────────────────────

type DeployPhase =
  | { kind: 'idle' }
  | { kind: 'building' }
  | { kind: 'activating' }
  | { kind: 'done'; slot: string; cfgPath: string }
  | { kind: 'error'; step: 'build' | 'activate'; message: string; cfgRestored: boolean };

// ─── DeployDialog ─────────────────────────────────────────────────────────────

export function DeployDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}): React.ReactElement | null {
  const [phase, setPhase] = useState<DeployPhase>({ kind: 'idle' });
  const [clients, setClients] = useState<DetectedClient[]>([]);
  const [selectedClient, setSelectedClient] = useState<DetectedClient | null>(null);
  const [deployModel, setDeployModel] = useState<'patch-prepend' | 'shadow-base'>('patch-prepend');
  const [fullChainScan, setFullChainScan] = useState<SharedFileScan | null>(null);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [staleWarning, setStaleWarning] = useState(false);  // W7: stale-deployment banner
  const [diskEstimate, setDiskEstimate] = useState<number | null>(null);

  /**
   * R2-B7: stores CfgInsertionRecord (patch-prepend) or ShadowDeployRecord (shadow-base)
   * for use by Reset (deactivatePatch + unlinkSync / resetShadow).
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const deployRecordRef = useRef<any>(null);

  /**
   * W9: deploy-in-progress mutex — prevents concurrent deploys sharing the .bak file.
   * The Deploy button is also disabled while phase.kind !== 'idle', providing double protection.
   */
  const deployingRef = useRef(false);

  // ── On dialog open ────────────────────────────────────────────────────────

  useEffect(() => {
    if (!open) return;

    // Reset to idle each time the dialog re-opens
    setPhase({ kind: 'idle' });
    setShowResetConfirm(false);
    deployRecordRef.current = null;

    // Detect installed SWG clients (synchronous — registry + known-path probes)
    try {
      setClients(detectClients());
    } catch {
      setClients([]);
    }

    // W7: stale-deployment warning — warn when the currently active version in the
    // manifest differs from the version that was last deployed to the client.
    // Does NOT block deploy; informational only.
    const studioDir = useWorkspaceStore.getState().studioDir;
    if (studioDir) {
      const m = readManifest(studioDir);
      setStaleWarning(
        m.deployedVersionId !== null && m.activeVersionId !== m.deployedVersionId,
      );
    } else {
      setStaleWarning(false);
    }
  }, [open]);

  // ── On selected client change: compute full-chain scan (B1 fix) ───────────
  // MUST use client.cfgRootPath (swgemu.cfg), NOT swgtoolkitCfgPath alone.
  // Scanning swgtoolkitCfgPath alone yields occupiedSlots=[] → slot 1 (below retail → no-load).

  useEffect(() => {
    if (selectedClient) {
      try {
        // B1: scan from the CLIENT ROOT (swgemu.cfg) to discover all retail slots (30-54)
        setFullChainScan(scanSharedFile(selectedClient.cfgRootPath));
      } catch {
        setFullChainScan(null);
      }
    } else {
      setFullChainScan(null);
    }
  }, [selectedClient]);

  // ── Disk estimate for shadow-base ⚠ warning ──────────────────────────────

  useEffect(() => {
    if (deployModel === 'shadow-base' && selectedClient) {
      try {
        const liveDir = path.join(selectedClient.installPath, 'Live');
        setDiskEstimate(estimateTreSize(liveDir));
      } catch {
        setDiskEstimate(null);
      }
    } else {
      setDiskEstimate(null);
    }
  }, [deployModel, selectedClient]);

  // ── Esc key close ─────────────────────────────────────────────────────────

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  // ── handleClose ───────────────────────────────────────────────────────────

  const handleClose = useCallback(() => {
    onClose();
  }, [onClose]);

  // ── handleBrowse — manual client folder override ──────────────────────────

  const handleBrowse = useCallback(() => {
    // workspace:pick-dir returns string[] (filePaths, or [] if cancelled) — NOT a
    // single string. (Bug fix: the prior `string | null` typing made path.join throw
    // on the array → caught silently → client never selected → Deploy stayed disabled.)
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { ipcRenderer } = require('electron') as {
      ipcRenderer: { invoke(channel: 'workspace:pick-dir'): Promise<string[]> };
    };
    void ipcRenderer.invoke('workspace:pick-dir').then((paths) => {
      const folderPath = paths[0];
      if (!folderPath) return; // cancelled
      try {
        const cfgRootPath = path.join(folderPath, 'swgemu.cfg');
        if (!fs.existsSync(cfgRootPath)) {
          window.alert(
            `No swgemu.cfg found in:\n\n${folderPath}\n\n` +
              'Pick the SWG client folder that directly contains swgemu.cfg ' +
              '(the install root — not the Live subfolder or its parent).',
          );
          return;
        }
        const manual: DetectedClient = {
          name: 'Manual Install',
          installPath: folderPath,
          cfgRootPath,
          treVersion: 'unknown',
        };
        setClients((prev) => {
          const deduped = prev.filter((c) => c.installPath !== folderPath);
          return [...deduped, manual];
        });
        setSelectedClient(manual);
      } catch (err) {
        window.alert('Could not use that folder: ' + String((err as Error)?.message ?? err));
      }
    });
  }, []);

  // ── handleDeploy ─────────────────────────────────────────────────────────
  // Full deploy sequence with W2/W7/W9/B1/B6/R2-B1/B2/B7/B8 fixes applied.

  const handleDeploy = useCallback(async () => {
    // W9: mutual exclusion — prevent concurrent deploys sharing the .bak file.
    // Deploy button is also disabled while phase.kind !== 'idle' (double guard).
    if (deployingRef.current) return;
    deployingRef.current = true;

    try {
      const studioDir = useWorkspaceStore.getState().studioDir!;
      const workspaceName = useWorkspaceStore.getState().workspaceName!;

      // W2: Read from version graph, NOT the live staging store.
      // (Prior bug: packPatch was called with stagingStore.entries directly — this
      // meant deploy never reflected a selectVersion(old) rollback.)
      let manifest = readManifest(studioDir);
      const stagingEntries = useStagingStore.getState().entries;

      // R2-B1/B2: proper dirty check using flatEqual.
      // Checking stagingEntries.length > 0 is WRONG after selectVersion(old):
      //   selectVersion restores staging = flatten(old) = same as the active version,
      //   so sealing would be a no-op but the N4 guard would throw 'Nothing new'.
      // flatEqual correctly detects that staging equals the current sealed version.
      const currentFlat = flatten(manifest.activeVersionId, manifest, studioDir);
      const stagingSorted = stagingEntries
        .slice()
        .sort((a, b) =>
          a.virtualPath < b.virtualPath ? -1 : a.virtualPath > b.virtualPath ? 1 : 0,
        );
      const isDirty = !flatEqual(stagingSorted, currentFlat);

      if (isDirty) {
        setPhase({ kind: 'building' });
        // R2-final (Opus): wrap auto-seal so a seal-time IO failure (manifest write,
        // file copy, 'No workspace open') surfaces as phase:'error' instead of stranding
        // the dialog at phase:'building' with no way out.
        // The N4 'Nothing new' throw cannot fire here: the isDirty gate uses the same
        // flatEqual inputs as N4, so if isDirty=true, N4 will not throw.
        try {
          await sealVersion({ sealedBy: 'pack', entries: stagingEntries, label: 'auto (pack)' });
        } catch (e) {
          setPhase({
            kind: 'error',
            step: 'build',
            message: (e as Error).message ?? String(e),
            cfgRestored: false,
          });
          return;
        }
        manifest = readManifest(studioDir);  // re-read — activeVersionId updated by sealVersion
      }

      // Deploy from the sealed version (W2: flatten from the version graph, not stagingStore)
      const flattenedEntries = flatten(manifest.activeVersionId, manifest, studioDir);
      if (flattenedEntries.length === 0) {
        setPhase({
          kind: 'error',
          step: 'build',
          message: 'No entries in version to deploy (flatten returned empty — version is empty)',
          cfgRestored: false,
        });
        return;
      }

      // B6+N2: buildPatchName sanitizes spaces + adds a UUID fragment.
      // BANNED: 'swgtoolkit_' + workspaceName + '.tre' — spaces truncate cfg values.
      const patchName = buildPatchName(workspaceName);
      const outputPath = path.join(studioDir, 'build', patchName);

      setPhase({ kind: 'building' });
      try {
        packPatch(flattenedEntries, outputPath);  // W2: packPatch receives flatten() output
      } catch (e) {
        setPhase({
          kind: 'error',
          step: 'build',
          message: (e as Error).message ?? String(e),
          cfgRestored: false,
        });
        return;
      }

      setPhase({ kind: 'activating' });

      // ── Shadow-base path (04-06b) ────────────────────────────────────────
      if (deployModel === 'shadow-base') {
        try {
          const shadowRecord = await deployShadowBase(
            selectedClient!,
            studioDir,
            outputPath,
            (_pct) => {},
          );
          deployRecordRef.current = shadowRecord;
          setDeployedVersion(manifest.activeVersionId!);  // W2: persist deployedVersionId
          // R2-B8: persist deploy record to manifest (survives component unmount)
          updateChangesetDeployRecord(manifest.activeVersionId!, {
            cfgPath: shadowRecord.cfgPath,
            includeTargetPath: shadowRecord.includeTargetPath,
            keyName: shadowRecord.patchEntry.keyName,
            slot: shadowRecord.patchEntry.slot,
            backupPath: shadowRecord.backupPath,
            patchPath: shadowRecord.patchEntry.patchPath,
            patchVersion: '5000',
          });
          setPhase({ kind: 'done', slot: 'shadow-base', cfgPath: shadowRecord.cfgPath });
        } catch (e) {
          setPhase({
            kind: 'error',
            step: 'activate',
            message: (e as Error).message ?? String(e),
            cfgRestored: false,
          });
        }
        return;
      }

      // ── Patch-prepend path ───────────────────────────────────────────────
      // The client loads TREs (and resolves bare searchTree filenames) from its TRE
      // directory. This VARIES by release: SWG Infinity uses a Live/ subfolder; stock
      // SWGEmu keeps its .tre files in the install root. Prefer Live/ when it exists,
      // else fall back to the install root. (Proper client-layout detection +
      // manual override is the client-layout-detection todo.)
      const liveDir = path.join(selectedClient!.installPath, 'Live');
      const clientTreDir = fs.existsSync(liveDir) ? liveDir : selectedClient!.installPath;
      const patchPathInLive = path.join(clientTreDir, patchName);

      // Step 1: Copy patch .tre to client Live/ dir
      try {
        fs.copyFileSync(outputPath, patchPathInLive);
      } catch (e) {
        setPhase({
          kind: 'error',
          step: 'activate',
          message: (e as Error).message ?? String(e),
          cfgRestored: false,
        });
        return;
      }

      // Step 2: Ensure swgtoolkit.cfg exists (create empty if needed)
      const cfgDir = path.dirname(selectedClient!.cfgRootPath);
      const swgtoolkitCfgPath = path.join(cfgDir, 'swgtoolkit.cfg');
      if (!fs.existsSync(swgtoolkitCfgPath)) {
        fs.writeFileSync(swgtoolkitCfgPath, '[SharedFile]\r\n', { encoding: 'utf8' });
      }

      // Step 3: activatePatch + ensureInclude + persist
      let record: CfgInsertionRecord | undefined;
      try {
        // B1: FULL chain scan from cfgRootPath (swgemu.cfg) — NEVER swgtoolkitCfgPath alone.
        // Scanning only swgtoolkitCfgPath yields occupiedSlots=[] → slot 1 (below retail).
        const insertScan = scanSharedFile(selectedClient!.cfgRootPath);
        record = activatePatch(swgtoolkitCfgPath, patchName, insertScan);
        record.patchPath = patchPathInLive;  // R2-B7: store path for Reset's unlinkSync call
        deployRecordRef.current = record;
        ensureInclude(selectedClient!.cfgRootPath, 'swgtoolkit.cfg');
        setDeployedVersion(manifest.activeVersionId!);  // W2: persist deployedVersionId

        // R2-B8: persist deploy record to manifest (survives component unmount/remount)
        const deployRecord: CfgDeployRecord = {
          cfgPath: record.cfgPath,
          includeTargetPath: selectedClient!.cfgRootPath,
          keyName: record.keyName,
          slot: record.slot,
          backupPath: record.backupPath,
          patchPath: patchPathInLive,
          patchVersion: '5000',
        };
        updateChangesetDeployRecord(manifest.activeVersionId!, deployRecord);
        setPhase({ kind: 'done', slot: record.keyName, cfgPath: swgtoolkitCfgPath });
      } catch (e) {
        if (record) deactivatePatch(record);  // W9 line-surgery rollback (04-03)
        setPhase({
          kind: 'error',
          step: 'activate',
          message: (e as Error).message ?? String(e),
          cfgRestored: !!record,
        });
      }
    } finally {
      deployingRef.current = false;  // W9: release mutex
    }
  }, [selectedClient, deployModel]);

  // ── handleReset ───────────────────────────────────────────────────────────

  const handleReset = useCallback(() => {
    if (!deployRecordRef.current) {
      setShowResetConfirm(false);
      return;
    }
    try {
      if (deployModel === 'shadow-base') {
        // Shadow-base: line-surgery reset + shadow dir cleanup (cleanup=true)
        resetShadow(deployRecordRef.current as ShadowDeployRecord, true);
      } else {
        // Patch-prepend: line-surgery cfg deactivate + delete deployed .tre from Live/
        const rec = deployRecordRef.current as CfgInsertionRecord;
        deactivatePatch(rec);
        if (rec.patchPath) {
          try { fs.unlinkSync(rec.patchPath); } catch { /* file may already be gone */ }
        }
      }
      setDeployedVersion(null);  // W2: clear deployedVersionId from manifest
      deployRecordRef.current = null;
      setPhase({ kind: 'idle' });
      setShowResetConfirm(false);
    } catch (e) {
      console.error('[DeployDialog] Reset failed:', e);
      setShowResetConfirm(false);
    }
  }, [deployModel]);

  // ── Return null when closed ───────────────────────────────────────────────

  if (!open) return null;

  // ── Derived values ────────────────────────────────────────────────────────

  // Section C: slot preview for patch-prepend model (B1: always uses fullChainScan from cfgRootPath)
  const previewSlot = fullChainScan ? chooseSlot(fullChainScan) : null;
  const slotExceedsMax =
    previewSlot !== null &&
    fullChainScan !== null &&
    previewSlot > fullChainScan.maxSearchPriority;

  // W9: Deploy button disabled when in-flight OR no client selected
  const isDeployDisabled = phase.kind !== 'idle' || !selectedClient;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Deploy patch"
      style={overlayStyle}
      onClick={handleClose}
    >
      <div style={panelStyle} onClick={(e) => e.stopPropagation()}>

        {/* Header */}
        <div style={headerStyle}>
          <span style={{ fontWeight: 600, fontSize: 'var(--text-md)', color: 'var(--color-text)' }}>
            Deploy patch
          </span>
          <button
            aria-label="Close deploy dialog"
            title="Close"
            onClick={handleClose}
            style={closeBtnStyle}
          >
            ×
          </button>
        </div>

        <div style={{ height: 1, background: 'var(--color-border)' }} />

        {/* W7: stale-deployment warning banner */}
        {staleWarning && (
          <div
            style={{
              background: 'var(--color-warn)',
              color: 'var(--color-text)',
              padding: 'var(--space-4)',
              borderRadius: 'var(--radius-sm)',
              fontSize: 'var(--text-xs)',
              margin: 'var(--space-2)',
            }}
          >
            You have unsaved changes — the current edit version differs from the deployed version.
          </div>
        )}

        {/* Section A — Target client (D-04-09) */}
        <div style={sectionStyle}>
          <div style={sectionLabelStyle}>Target client</div>
          {clients.length === 0 ? (
            <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)' }}>
              No installs auto-detected — choose a client folder.
            </div>
          ) : (
            clients.map((client) => (
              <label
                key={client.installPath}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 'var(--space-2)',
                  cursor: 'pointer',
                  padding: 'var(--space-2)',
                  borderRadius: 'var(--radius-sm)',
                  background:
                    selectedClient?.installPath === client.installPath
                      ? 'var(--color-accent-dim)'
                      : 'transparent',
                  border:
                    selectedClient?.installPath === client.installPath
                      ? '1px solid var(--color-accent)'
                      : '1px solid transparent',
                }}
              >
                <input
                  type="radio"
                  name="client"
                  checked={selectedClient?.installPath === client.installPath}
                  onChange={() => setSelectedClient(client)}
                  style={{ accentColor: 'var(--color-accent)', marginTop: 2, flexShrink: 0 }}
                />
                <div>
                  <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600 }}>{client.name}</div>
                  <div
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: 'var(--text-xs)',
                      color: 'var(--color-info)',
                    }}
                  >
                    {client.installPath}
                  </div>
                  <div
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: 'var(--text-xs)',
                      color: 'var(--color-text-faint)',
                    }}
                  >
                    EERT{client.treVersion}
                  </div>
                </div>
              </label>
            ))
          )}
          <button
            style={secondaryBtnStyleLocal}
            onClick={handleBrowse}
            aria-label="Browse for client folder"
          >
            Browse…
          </button>
        </div>

        <div style={{ height: 1, background: 'var(--color-border)' }} />

        {/* Section B — Deploy model (D-04-10) */}
        <div style={sectionStyle}>
          <div style={sectionLabelStyle}>Deploy model</div>

          {/* Patch-prepend option (default) — accent ring when selected */}
          <div
            style={{
              border: `2px solid ${deployModel === 'patch-prepend' ? 'var(--color-accent)' : 'var(--color-border)'}`,
              background:
                deployModel === 'patch-prepend' ? 'var(--color-accent-dim)' : 'transparent',
              borderRadius: 'var(--radius-sm)',
              padding: 'var(--space-2) var(--space-3)',
              cursor: 'pointer',
              marginBottom: 'var(--space-2)',
            }}
            onClick={() => setDeployModel('patch-prepend')}
          >
            <label style={{ display: 'flex', gap: 'var(--space-2)', cursor: 'pointer' }}>
              <input
                type="radio"
                name="deployModel"
                checked={deployModel === 'patch-prepend'}
                onChange={() => setDeployModel('patch-prepend')}
                style={{ accentColor: 'var(--color-accent)', flexShrink: 0 }}
              />
              <div>
                <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600 }}>Patch-prepend</div>
                <div style={{ fontSize: 'var(--text-base)', color: 'var(--color-text-muted)' }}>
                  adds the patch at a free higher cfg priority — retail files stay pristine
                </div>
              </div>
            </label>
          </div>

          {/* Shadow-base option (opt-in) — accent ring when selected */}
          <div
            style={{
              border: `2px solid ${deployModel === 'shadow-base' ? 'var(--color-accent)' : 'var(--color-border)'}`,
              background:
                deployModel === 'shadow-base' ? 'var(--color-accent-dim)' : 'transparent',
              borderRadius: 'var(--radius-sm)',
              padding: 'var(--space-2) var(--space-3)',
              cursor: 'pointer',
            }}
            onClick={() => setDeployModel('shadow-base')}
          >
            <label style={{ display: 'flex', gap: 'var(--space-2)', cursor: 'pointer' }}>
              <input
                type="radio"
                name="deployModel"
                checked={deployModel === 'shadow-base'}
                onChange={() => setDeployModel('shadow-base')}
                style={{ accentColor: 'var(--color-accent)', flexShrink: 0 }}
              />
              <div>
                <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600 }}>
                  Shadow-base (isolated client)
                </div>
                <div style={{ fontSize: 'var(--text-base)', color: 'var(--color-text-muted)' }}>
                  copies the client TRE base to a local shadow and patches there
                </div>
              </div>
            </label>
            {/* ⚠ disk-space warning — revealed when shadow-base is selected and client chosen */}
            {deployModel === 'shadow-base' && diskEstimate !== null && (
              <div
                style={{
                  marginTop: 'var(--space-2)',
                  fontSize: 'var(--text-xs)',
                  fontFamily: 'var(--font-mono)',
                  color: 'var(--color-warn)',
                }}
              >
                ⚠ ~{(diskEstimate / 1073741824).toFixed(1)} GB free disk needed
              </div>
            )}
          </div>
        </div>

        <div style={{ height: 1, background: 'var(--color-border)' }} />

        {/* Section C — Config slot preview (patch-prepend only, D-04-12) */}
        {deployModel === 'patch-prepend' && fullChainScan && previewSlot !== null && (
          <>
            <div style={sectionStyle}>
              <div style={sectionLabelStyle}>Config slot preview</div>
              <pre
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 'var(--text-xs)',
                  color: 'var(--color-text)',
                  background: 'var(--color-bg)',
                  border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-sm)',
                  padding: 'var(--space-3)',
                  margin: 0,
                  overflowX: 'auto',
                  lineHeight: 1.5,
                  whiteSpace: 'pre',
                }}
              >
                {`[SharedFile]\n    searchTree${fullChainScan.skuSuffix}${previewSlot}=(patch filename)\n    maxSearchPriority=${fullChainScan.maxSearchPriority} ${slotExceedsMax ? '⚠ will bump maxSearchPriority ' + fullChainScan.maxSearchPriority + ' → ' + (previewSlot + 5) : '✓ (slot ' + previewSlot + ' ≤ ' + fullChainScan.maxSearchPriority + ')'}`}
              </pre>
              <div
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 'var(--text-xs)',
                  color: 'var(--color-info)',
                }}
              >
                writes a toolkit-owned cfg via .include — never touches user.cfg/options.cfg
              </div>
            </div>
            <div style={{ height: 1, background: 'var(--color-border)' }} />
          </>
        )}

        {/* Phase state — progress / success / failure */}
        {phase.kind !== 'idle' && (
          <div style={sectionStyle}>
            {phase.kind === 'building' && (
              <AsyncProgress caption="Building patch (v5000)…" />
            )}
            {phase.kind === 'activating' && (
              <AsyncProgress caption="Writing client config…" />
            )}
            {phase.kind === 'done' && !showResetConfirm && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                <VerificationStatus
                  variant="pass"
                  caption={`deployed · slot ${phase.slot}`}
                />
                <button
                  style={secondaryBtnStyleLocal}
                  aria-label="Reset deployment"
                  title="Reset deployment"
                  onClick={() => setShowResetConfirm(true)}
                >
                  Reset deployment
                </button>
              </div>
            )}
            {phase.kind === 'done' && showResetConfirm && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                <p
                  style={{ fontSize: 'var(--text-base)', color: 'var(--color-text)', margin: 0 }}
                >
                  Reset deployment? This removes the patch from the client config and deletes the
                  deployed patch .tre. Your changesets are kept.
                </p>
                <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                  <button
                    style={secondaryBtnStyleLocal}
                    onClick={() => setShowResetConfirm(false)}
                    aria-label="Cancel reset"
                  >
                    Cancel
                  </button>
                  <button
                    style={dangerBtnStyleLocal}
                    aria-label="Reset deployment"
                    onClick={handleReset}
                  >
                    Reset
                  </button>
                </div>
              </div>
            )}
            {phase.kind === 'error' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                <VerificationStatus
                  variant="fail"
                  caption={
                    phase.step === 'activate'
                      ? `Could not write client config — ${phase.message}. The .cfg was restored from backup.`
                      : `Could not build patch — ${phase.message}.`
                  }
                />
                <button
                  style={secondaryBtnStyleLocal}
                  aria-label="Retry deploy"
                  onClick={() => setPhase({ kind: 'idle' })}
                >
                  Retry
                </button>
              </div>
            )}
          </div>
        )}

        {/* Action row — Cancel + Deploy patch */}
        {!showResetConfirm && (
          <div
            style={{
              display: 'flex',
              justifyContent: 'flex-end',
              gap: 'var(--space-2)',
              padding: 'var(--space-3) var(--space-4)',
              borderTop: '1px solid var(--color-border)',
            }}
          >
            <button
              style={secondaryBtnStyleLocal}
              onClick={handleClose}
              aria-label="Cancel deploy"
            >
              Cancel
            </button>
            <button
              style={primaryBtnStyleLocal(isDeployDisabled)}
              disabled={isDeployDisabled}
              aria-disabled={isDeployDisabled}
              onClick={isDeployDisabled ? undefined : () => { void handleDeploy(); }}
              aria-label="Deploy patch"
              title={
                !selectedClient
                  ? 'No client selected — point me at a SWG client to deploy.'
                  : phase.kind !== 'idle'
                  ? 'Deploy in progress…'
                  : 'Build and deploy the patch'
              }
            >
              Deploy patch
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
// W1 fix: ALL button styles defined LOCALLY — do NOT import from ExportDialog (not exported).

const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.55)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 50,
};

// NOTE: width 360 (vs ExportDialog's 320) — deploy dialog carries more fields.
// Source: 04-UI-SPEC.md §Surface 4, modal pattern note.
const panelStyle: React.CSSProperties = {
  background: 'var(--color-surface)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-md)',
  boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
  width: 360,
  maxWidth: '90vw',
  maxHeight: '90vh',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
  overflowY: 'auto',
};

const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: 'var(--space-3) var(--space-4)',
  background: 'var(--color-header)',
  borderBottom: '1px solid var(--color-border)',
  flexShrink: 0,
};

const closeBtnStyle: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  color: 'var(--color-text-faint)',
  cursor: 'pointer',
  fontSize: 'var(--text-md)',
  width: 22,
  height: 22,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: 'var(--radius-sm)',
  padding: 0,
};

const sectionStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--space-2)',
  padding: 'var(--space-4)',
};

const sectionLabelStyle: React.CSSProperties = {
  fontSize: 'var(--text-xs)',
  fontWeight: 600,
  color: 'var(--color-text-muted)',
  letterSpacing: '0.03em',
  textTransform: 'uppercase',
};

function primaryBtnStyleLocal(disabled: boolean): React.CSSProperties {
  return {
    background: disabled ? 'var(--color-widget)' : 'var(--color-accent)',
    border: 'none',
    color: disabled ? 'var(--color-text-faint)' : 'var(--color-accent-text)',
    borderRadius: 'var(--radius-sm)',
    padding: '6px 16px',
    cursor: disabled ? 'not-allowed' : 'pointer',
    fontSize: 'var(--text-sm)',
    fontWeight: 600,
    opacity: disabled ? 0.6 : 1,
    transition: 'opacity 0.1s ease',
  };
}

const secondaryBtnStyleLocal: React.CSSProperties = {
  background: 'transparent',
  border: '1px solid var(--color-border)',
  color: 'var(--color-text-muted)',
  borderRadius: 'var(--radius-sm)',
  padding: '3px 10px',
  cursor: 'pointer',
  fontSize: 'var(--text-xs)',
};

const dangerBtnStyleLocal: React.CSSProperties = {
  background: 'transparent',
  border: '1px solid var(--color-danger)',
  color: 'var(--color-danger)',
  borderRadius: 'var(--radius-sm)',
  padding: '3px 10px',
  cursor: 'pointer',
  fontSize: 'var(--text-xs)',
};
