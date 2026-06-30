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
import { activatePatch, deactivatePatch, ensureInclude, snapshotCfg, restoreCfg, getToolkitCfgPath } from '../../services/cfgActivator.js';
import { deployShadowBase, resetShadow, estimateTreSize } from '../../services/shadowBaseService.js';
import { BASELINE_ID, type TypedIpcRenderer } from '@swg/contracts';

import type { DetectedClient, CfgInsertionRecord, CfgDeployRecord, LooseDeployRecord } from '@swg/contracts';
import type { SharedFileScan } from '../../services/clientLocator.js';
import type { ShadowDeployRecord } from '../../services/shadowBaseService.js';

import { resolveLayout } from '../../services/clientLayout.js';
import { resolveOverrideDir, deployLoose, resetLoose } from '../../services/looseOverrideDeploy.js';
import { resolveClientMountOrder } from '../../services/clientSearchOrder.js';

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
  const [deployModel, setDeployModel] = useState<'absolute-path' | 'hardlink-shadow' | 'loose-override'>('absolute-path');
  // Hardlink-shadow is demoted behind an "Advanced" disclosure: the absolute-path / loose-override
  // pointer models are non-destructive and proven to load in-game (UAT 2026-06-29, ksk_all_spaceterminal
  // override loaded with the cfg untouched), so full-shadow is reserved for the rare whole-TRE-replace
  // case. Auto-revealed below when hardlink-shadow is the active model (e.g. an in-progress shadow deploy).
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [fullChainScan, setFullChainScan] = useState<SharedFileScan | null>(null);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  // Unsaved-changes prompt (UAT): when deploying with staging != the active version, ask
  // the user to name a version instead of silently auto-snapshotting.
  const [unsavedPromptOpen, setUnsavedPromptOpen] = useState(false);
  const [pendingVersionName, setPendingVersionName] = useState('');
  const [staleWarning, setStaleWarning] = useState(false);  // W7: stale-deployment banner
  // True when the SELECTED (active) version is the Baseline — used to phrase the stale banner
  // and CTA as a "revert to stock" rather than a forward deploy. Computed alongside staleWarning.
  const [activeIsBaseline, setActiveIsBaseline] = useState(false);
  const [diskEstimate, setDiskEstimate] = useState<number | null>(null);
  const [resolvedOverrideDir, setResolvedOverrideDir] = useState<string | null>(null);

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

    // M8: cross-session deploy record restore — if no in-memory record, load the
    // persisted CfgDeployRecord (incl. snapshotPath) from the manifest so that
    // Reset works after a close/reopen without a fresh deploy in this session.
    const studioDir0 = useWorkspaceStore.getState().studioDir;
    if (studioDir0) {
      try {
        const m0 = readManifest(studioDir0);
        if (m0.activeVersionId && m0.activeVersionId !== BASELINE_ID) {
          const cs0 = m0.changesets.find((c) => c.id === m0.activeVersionId);
          if (cs0?.deployRecord) {
            deployRecordRef.current = cs0.deployRecord;
          }
        }
      } catch {
        /* manifest unreadable — start fresh, no in-memory record */
      }
    }

    // Detect installed SWG clients (synchronous — registry + known-path probes)
    let detectedClients: DetectedClient[] = [];
    try {
      detectedClients = detectClients();
      setClients(detectedClients);
    } catch {
      setClients([]);
    }

    // D-12: auto-select the bound client so Deploy is enabled by default.
    // Reads clientPath from workspaceStore top-level (set by openComplete from workspace.json).
    // NEVER reads workspaceStore.kind (does not exist — H4).
    const boundClientPath = useWorkspaceStore.getState().clientPath;
    if (boundClientPath) {
      // H3 fix: derive cfg filename from layout table (supports both swgemu.cfg and client.cfg).
      // Fallback to 'swgemu.cfg' when layout is unrecognised — preserves backward compat.
      const boundCfgFile = resolveLayout(boundClientPath)?.cfgFile ?? 'swgemu.cfg';
      const bound = detectedClients.find((c) => c.installPath === boundClientPath)
        ?? ({
          name:         'Bound client',
          installPath:  boundClientPath,
          cfgRootPath:  path.join(boundClientPath, boundCfgFile),
          treVersion:   'unknown',
        } satisfies DetectedClient);
      setSelectedClient(bound);
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
      setActiveIsBaseline(m.activeVersionId === BASELINE_ID);
    } else {
      setStaleWarning(false);
      setActiveIsBaseline(false);
    }
  }, [open]);

  // ── On selected client change: compute full-chain scan (B1 fix) ───────────
  // MUST use client.cfgRootPath (the root cfg), NOT swgtoolkitCfgPath alone.
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

  // ── Disk estimate for hardlink-shadow ⚠ warning ─────────────────────────
  // For same-volume (hardlink) path this is informational (hardlinks use ~0 bytes).
  // For cross-volume (copy) fallback this is the actual disk space needed.

  useEffect(() => {
    if (deployModel === 'hardlink-shadow' && selectedClient) {
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

  // ── Resolved override dir for loose-override model ───────────────────────
  // Compute the max-priority searchPath dir from the bound client's cfg chain.
  // Dependency on both deployModel AND selectedClient so it re-computes whenever
  // either changes. This is the value the user sees before confirming deploy.

  useEffect(() => {
    if (deployModel === 'loose-override' && selectedClient !== null) {
      setResolvedOverrideDir(
        resolveOverrideDir(selectedClient.cfgRootPath, selectedClient.installPath),
      );
    } else {
      setResolvedOverrideDir(null);
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
    // TypedIpcRenderer from @swg/contracts enforces channel type at compile time.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { ipcRenderer } = require('electron') as { ipcRenderer: TypedIpcRenderer };
    void ipcRenderer.invoke('workspace:pick-dir').then((paths) => {
      const folderPath = paths[0];
      if (!folderPath) return; // cancelled
      try {
        const cfgFile = resolveLayout(folderPath)?.cfgFile ?? 'swgemu.cfg';
        const cfgRootPath = path.join(folderPath, cfgFile);
        if (!fs.existsSync(cfgRootPath)) {
          window.alert(
            `No swgemu.cfg or client.cfg found in:\n\n${folderPath}\n\n` +
              'Pick the SWG client folder that directly contains swgemu.cfg or client.cfg ' +
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

  const handleDeploy = useCallback(async (sealLabel?: string) => {
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
        // Prompt the user to name a version rather than silently snapshotting (UAT).
        // The outer finally resets deployingRef; the user re-triggers deploy with a label.
        if (!sealLabel) {
          setUnsavedPromptOpen(true);
          return;
        }
        setPhase({ kind: 'building' });
        // R2-final (Opus): wrap the seal so a seal-time IO failure (manifest write,
        // file copy, 'No workspace open') surfaces as phase:'error' instead of stranding
        // the dialog at phase:'building' with no way out.
        // The N4 'Nothing new' throw cannot fire here: the isDirty gate uses the same
        // flatEqual inputs as N4, so if isDirty=true, N4 will not throw.
        try {
          await sealVersion({ sealedBy: 'pack', entries: stagingEntries, label: sealLabel });
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

      // H1: Baseline deploy (or empty version) → reset-to-stock.
      // When the user selects the Baseline version and clicks Deploy, the intent is
      // "restore the client to stock". Route to restoreCfg + cleanup rather than
      // throwing the length=0 error (which was confusing and blocked the workflow).
      if (manifest.activeVersionId === BASELINE_ID || flattenedEntries.length === 0) {
        const rootCfgPath = selectedClient!.cfgRootPath;
        const swgtoolkitCfgPath = getToolkitCfgPath(studioDir);  // studio, not client
        const existingRec = deployRecordRef.current as (CfgDeployRecord | LooseDeployRecord | null);

        // Loose-override reset-to-stock: the live deploy wrote loose files into the override
        // dir (no cfg surgery), so revert via resetLoose (B3: restore pre-existing originals /
        // remove toolkit-added). Discriminate on the record shape — the deployModel radio resets
        // to absolute-path on a fresh dialog open and can't be trusted to know the live model here.
        if (existingRec && 'overrideDir' in existingRec) {
          resetLoose(existingRec as LooseDeployRecord);
          setDeployedVersion(null);
          deployRecordRef.current = null;
          setPhase({ kind: 'done', slot: 'Baseline (reset to stock)', cfgPath: rootCfgPath });
          return;
        }

        // Attempt root cfg restore from snapshot (if we have one)
        const snap = existingRec?.snapshotPath;
        if (snap) {
          try {
            if (fs.existsSync(snap)) restoreCfg(rootCfgPath, snap);
          } catch { /* best-effort — cfg may already be clean */ }
        }

        // Remove toolkit cfg (client won't need it after root cfg restore)
        if (fs.existsSync(swgtoolkitCfgPath)) {
          try { fs.unlinkSync(swgtoolkitCfgPath); } catch { /* ignore */ }
        }

        // Remove deployed patch .tre from Live/ if recorded
        if (existingRec?.patchPath) {
          try { fs.unlinkSync(existingRec.patchPath); } catch { /* already gone is fine */ }
        }

        setDeployedVersion(null);
        deployRecordRef.current = null;
        setPhase({ kind: 'done', slot: 'Baseline (reset to stock)', cfgPath: rootCfgPath });
        return;
      }

      // ── Loose-override path (DEPLOY-08) ─────────────────────────────────
      // No TRE pack or cfg surgery — write staged files directly into the client's
      // highest-priority searchPath override dir.  The two existing branches below
      // are UNCHANGED.
      if (deployModel === 'loose-override') {
        // Step 1: override dir must have been resolved via the useEffect.
        if (!resolvedOverrideDir) {
          setPhase({
            kind: 'error',
            step: 'activate',
            message: 'No override dir resolved — bind a client with a searchPath override',
            cfgRestored: false,
          });
          return;
        }

        // Step 1b: W1 override-dir guard — check that looseDirPriorities[0] ≤ maxSearchPriority.
        // A searchPath with priority ABOVE maxSearchPriority is never read by the engine (Opus Q3).
        const order = resolveClientMountOrder(
          selectedClient!.cfgRootPath,
          selectedClient!.installPath,
        );
        if (
          !order ||
          order.looseDirs.length === 0 ||
          order.looseDirPriorities[0] > order.maxPriority
        ) {
          setPhase({
            kind: 'error',
            step: 'activate',
            message:
              'Override dir priority ' +
              (order?.looseDirPriorities[0] ?? 'unknown') +
              ' exceeds maxSearchPriority ' +
              (order?.maxPriority ?? 'unknown') +
              ' — engine would not load files at this priority',
            cfgRestored: false,
          });
          return;
        }

        setPhase({ kind: 'activating' });

        try {
          // H2 prune: pass prior LooseDeployRecord when available (discriminant: 'overrideDir' in rec).
          const prior = deployRecordRef.current;
          const priorLoose: LooseDeployRecord | undefined =
            prior && 'overrideDir' in (prior as object)
              ? (prior as LooseDeployRecord)
              : undefined;

          const record = deployLoose(flattenedEntries, resolvedOverrideDir, {
            studioDir,
            priorRecord: priorLoose,
          });

          deployRecordRef.current = record;
          setDeployedVersion(manifest.activeVersionId!);
          updateChangesetDeployRecord(manifest.activeVersionId!, record);
          setPhase({ kind: 'done', slot: 'override-dir', cfgPath: resolvedOverrideDir });
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

      // ── Hardlink-shadow path (DEPLOY-06) ────────────────────────────────
      if (deployModel === 'hardlink-shadow') {
        // (2) Snapshot ROOT cfg BEFORE deployShadowBase, which calls ensureInclude internally (M9)
        let shadowSnapshotPath: string | undefined;
        try {
          shadowSnapshotPath = snapshotCfg(selectedClient!.cfgRootPath, studioDir);
        } catch { /* non-fatal — restoreCfg fallback will skip if snap missing */ }

        try {
          const shadowRecord = await deployShadowBase(
            selectedClient!,
            studioDir,
            outputPath,
            (_pct) => {},
          );
          deployRecordRef.current = { ...shadowRecord, snapshotPath: shadowSnapshotPath };
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
            snapshotPath: shadowSnapshotPath,
          });
          setPhase({ kind: 'done', slot: 'hardlink-shadow', cfgPath: shadowRecord.cfgPath });
        } catch (e) {
          // H5/M9 auto-rollback: restore ROOT cfg from snapshot if we took one
          let cfgRestored = false;
          if (shadowSnapshotPath && selectedClient) {
            try {
              if (fs.existsSync(shadowSnapshotPath)) {
                restoreCfg(selectedClient.cfgRootPath, shadowSnapshotPath);
                cfgRestored = true;
              }
            } catch { /* snapshot restore failed — log only */ }
          }
          setPhase({
            kind: 'error',
            step: 'activate',
            message: (e as Error).message ?? String(e),
            cfgRestored,
          });
        }
        return;
      }

      // ── Absolute-path path (D-05 default) ───────────────────────────────
      // Write the ABSOLUTE PATH to .studio/build/<patch>.tre directly as the
      // searchTree value — no copy to Live/ needed (UAT item: TreeFile.cpp absolute
      // path support; if client rejects, gap-close = copy-to-Live/).
      // The patchName is a sanitized filename; outputPath is the absolute path to build/.
      // swgtoolkit.cfg lives in the STUDIO (not the client) — the client only gains a
      // single absolute .include line (see getToolkitCfgPath / ConfigFile.cpp verification).
      const swgtoolkitCfgPath = getToolkitCfgPath(studioDir);

      // Step 1: (Re)create swgtoolkit.cfg EMPTY each deploy — one flattened patch ⇒ exactly
      // one searchTree line; truncating avoids stale lines accumulating across deploys.
      fs.mkdirSync(path.dirname(swgtoolkitCfgPath), { recursive: true });
      fs.writeFileSync(swgtoolkitCfgPath, '', { encoding: 'utf8' });

      // Step 2: Snapshot ROOT cfg BEFORE any mutation (D-07 — ensureInclude runs below)
      let absSnapshotPath: string | undefined;
      try {
        absSnapshotPath = snapshotCfg(selectedClient!.cfgRootPath, studioDir);
      } catch { /* non-fatal — restoreCfg fallback will skip if snap missing */ }

      // Step 3: activatePatch (writes absolute outputPath as searchTree value) + ensureInclude + persist
      let record: CfgInsertionRecord | undefined;
      try {
        // B1: FULL chain scan from client root cfg — NEVER swgtoolkitCfgPath alone.
        // Scanning only swgtoolkitCfgPath yields occupiedSlots=[] → slot 1 (below retail).
        const insertScan = scanSharedFile(selectedClient!.cfgRootPath);
        // D-05: pass outputPath (absolute path to .studio/build/<name>.tre) as patchName
        // so TreeFile.cpp can find the TRE without a copy-to-Live/. Pass studioDir so
        // activatePatch relocates the .swgtoolkit.bak into .studio/snapshots (D-06/D-07).
        record = activatePatch(swgtoolkitCfgPath, outputPath, insertScan, studioDir);
        deployRecordRef.current = record;
        // M9: ensureInclude on absolute-path path — the root cfg gains a single absolute,
        // quoted .include pointing at the studio cfg (ConfigFile.cpp opens absolute paths).
        ensureInclude(selectedClient!.cfgRootPath, swgtoolkitCfgPath);
        setDeployedVersion(manifest.activeVersionId!);  // W2: persist deployedVersionId

        // R2-B8: persist deploy record (incl. snapshotPath for M8 cross-session Reset)
        const deployRecord: CfgDeployRecord = {
          cfgPath: record.cfgPath,
          includeTargetPath: selectedClient!.cfgRootPath,
          keyName: record.keyName,
          slot: record.slot,
          backupPath: record.backupPath,
          patchPath: outputPath,  // absolute path — no separate patchPathInLive
          patchVersion: '5000',
          snapshotPath: absSnapshotPath,
        };
        deployRecordRef.current = { ...record, snapshotPath: absSnapshotPath, patchPath: outputPath };
        updateChangesetDeployRecord(manifest.activeVersionId!, deployRecord);
        setPhase({ kind: 'done', slot: record.keyName, cfgPath: swgtoolkitCfgPath });
      } catch (e) {
        if (record) deactivatePatch(record);  // W9 line-surgery rollback (04-03)
        // H5/M9 auto-rollback: restore ROOT cfg from snapshot if we took one
        let cfgRestored = false;
        if (absSnapshotPath && selectedClient) {
          try {
            if (fs.existsSync(absSnapshotPath)) {
              restoreCfg(selectedClient.cfgRootPath, absSnapshotPath);
              cfgRestored = true;
            }
          } catch { /* snapshot restore failed — log only */ }
        }
        setPhase({
          kind: 'error',
          step: 'activate',
          message: (e as Error).message ?? String(e),
          cfgRestored,
        });
      }
    } finally {
      deployingRef.current = false;  // W9: release mutex
    }
  }, [selectedClient, deployModel, resolvedOverrideDir]);

  // ── handleReset ───────────────────────────────────────────────────────────
  // H5: primary reset = restoreCfg (whole-file, byte-pristine ROOT cfg restore).
  // Falls back to line-surgery (deactivatePatch / resetShadow) when no snapshot.

  const handleReset = useCallback(() => {
    if (!deployRecordRef.current) {
      setShowResetConfirm(false);
      return;
    }
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rec = deployRecordRef.current as any;

      // ── Loose-override reset ─────────────────────────────────────────────
      // No cfg surgery, no .tre deletion — resetLoose restores (B3) or removes
      // only the files written by the prior deployLoose call.
      if (deployModel === 'loose-override') {
        resetLoose(rec as LooseDeployRecord);
        setDeployedVersion(null);
        deployRecordRef.current = null;
        setPhase({ kind: 'idle' });
        setShowResetConfirm(false);
        return;
      }

      const rootCfgPath = selectedClient?.cfgRootPath ?? (rec.includeTargetPath as string | undefined);
      const snapPath: string | undefined = rec.snapshotPath;

      if (snapPath && rootCfgPath && fs.existsSync(snapPath)) {
        // H5 PRIMARY: whole-file restore from snapshot — byte-pristine (D-07).
        // Removes .include + any maxSearchPriority bumps; client returns to stock cfg.
        restoreCfg(rootCfgPath, snapPath);
      } else if (deployModel === 'hardlink-shadow') {
        // Fallback for shadow model without snapshot: line-surgery via resetShadow
        resetShadow(rec as ShadowDeployRecord, true);
      } else {
        // Fallback for absolute-path model without snapshot: line-surgery via deactivatePatch
        deactivatePatch(rec as CfgInsertionRecord);
      }

      // Model-specific artifact cleanup
      if (deployModel === 'hardlink-shadow') {
        // Remove toolkit cfg (client no longer reads it after root cfg restore)
        const toolkitCfgPath = rec.cfgPath as string | undefined;
        if (toolkitCfgPath) {
          try { fs.unlinkSync(toolkitCfgPath); } catch { /* ignore — may already be gone */ }
        }
        // Clean up shadow dir (hardlinks; ~0 bytes for same-volume)
        const shadowRec = rec as ShadowDeployRecord;
        if (shadowRec.shadowDir && fs.existsSync(shadowRec.shadowDir)) {
          try { fs.rmSync(shadowRec.shadowDir, { recursive: true, force: true }); } catch { /* ignore */ }
        }
      } else {
        // Absolute-path: delete the deployed .tre from .studio/build/ if still there
        // (the studio copy stays as history; patchPath IS the studioDir path for absolute-path)
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
  }, [deployModel, selectedClient]);

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
    <>
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
            {activeIsBaseline
              ? 'You’re on the Baseline (stock) version, but a later version is still deployed to the client. Deploying below reverts the client to stock — selecting Baseline alone does not undo the live deploy.'
              : 'The selected version isn’t the one deployed to the client — you’re viewing a different version, not unsaved edits. Deploy below to apply it.'}
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

        {/* Section B — Deploy model (D-04-10, D-05) */}
        <div style={sectionStyle}>
          <div style={sectionLabelStyle}>Deploy model</div>

          {/* Absolute-path option (default, D-05) — accent ring when selected */}
          <div
            style={{
              border: `2px solid ${deployModel === 'absolute-path' ? 'var(--color-accent)' : 'var(--color-border)'}`,
              background:
                deployModel === 'absolute-path' ? 'var(--color-accent-dim)' : 'transparent',
              borderRadius: 'var(--radius-sm)',
              padding: 'var(--space-2) var(--space-3)',
              cursor: phase.kind === 'done' ? 'default' : 'pointer',
              marginBottom: 'var(--space-2)',
              // Lock the deploy model while a deploy is active — gray the non-deployed one.
              opacity: phase.kind === 'done' && deployModel !== 'absolute-path' ? 0.45 : 1,
            }}
            onClick={phase.kind === 'done' ? undefined : () => setDeployModel('absolute-path')}
          >
            <label style={{ display: 'flex', gap: 'var(--space-2)', cursor: phase.kind === 'done' ? 'default' : 'pointer' }}>
              <input
                type="radio"
                name="deployModel"
                checked={deployModel === 'absolute-path'}
                disabled={phase.kind === 'done'}
                onChange={() => setDeployModel('absolute-path')}
                style={{ accentColor: 'var(--color-accent)', flexShrink: 0 }}
              />
              <div>
                <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600 }}>Absolute path</div>
                <div style={{ fontSize: 'var(--text-base)', color: 'var(--color-text-muted)' }}>
                  points the client cfg directly at the patch in .studio/build — no copy needed
                </div>
              </div>
            </label>
          </div>

          {/* Loose-override option (opt-in, DEPLOY-08) — accent ring when selected */}
          <div
            style={{
              border: `2px solid ${deployModel === 'loose-override' ? 'var(--color-accent)' : 'var(--color-border)'}`,
              background:
                deployModel === 'loose-override' ? 'var(--color-accent-dim)' : 'transparent',
              borderRadius: 'var(--radius-sm)',
              padding: 'var(--space-2) var(--space-3)',
              cursor: phase.kind === 'done' ? 'default' : 'pointer',
              opacity: phase.kind === 'done' && deployModel !== 'loose-override' ? 0.45 : 1,
            }}
            onClick={phase.kind === 'done' ? undefined : () => setDeployModel('loose-override')}
          >
            <label style={{ display: 'flex', gap: 'var(--space-2)', cursor: phase.kind === 'done' ? 'default' : 'pointer' }}>
              <input
                type="radio"
                name="deployModel"
                checked={deployModel === 'loose-override'}
                disabled={phase.kind === 'done'}
                onChange={() => setDeployModel('loose-override')}
                style={{ accentColor: 'var(--color-accent)', flexShrink: 0 }}
              />
              <div>
                <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600 }}>Loose override dir</div>
                <div style={{ fontSize: 'var(--text-base)', color: 'var(--color-text-muted)' }}>
                  writes files directly into the client&apos;s top-priority override dir — no cfg changes
                </div>
              </div>
            </label>
            {/* Show resolved override dir path when model is selected and a client is bound */}
            {deployModel === 'loose-override' && resolvedOverrideDir !== null && (
              <div
                style={{
                  marginTop: 'var(--space-2)',
                  fontFamily: 'var(--font-mono)',
                  fontSize: 'var(--text-xs)',
                  color: 'var(--color-info)',
                }}
              >
                {resolvedOverrideDir}
              </div>
            )}
          </div>

          {/* Advanced disclosure — Hardlink shadow is demoted here (see showAdvanced note above).
              Collapsed by default; auto-shown when it is the active deployed model. */}
          {!(showAdvanced || deployModel === 'hardlink-shadow') && (
            <button
              type="button"
              onClick={() => setShowAdvanced(true)}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--color-text-muted)',
                fontSize: 'var(--text-xs)',
                fontFamily: 'var(--font-sans)',
                cursor: 'pointer',
                padding: 'var(--space-1) 0',
                textAlign: 'left',
              }}
              aria-label="Show advanced deploy models"
            >
              ▸ Advanced — Hardlink shadow (isolated client)
            </button>
          )}

          {/* Hardlink-shadow option (opt-in, DEPLOY-06) — accent ring when selected */}
          {(showAdvanced || deployModel === 'hardlink-shadow') && (
            <div
              style={{
                border: `2px solid ${deployModel === 'hardlink-shadow' ? 'var(--color-accent)' : 'var(--color-border)'}`,
                background:
                  deployModel === 'hardlink-shadow' ? 'var(--color-accent-dim)' : 'transparent',
                borderRadius: 'var(--radius-sm)',
                padding: 'var(--space-2) var(--space-3)',
                cursor: phase.kind === 'done' ? 'default' : 'pointer',
                opacity: phase.kind === 'done' && deployModel !== 'hardlink-shadow' ? 0.45 : 1,
              }}
              onClick={phase.kind === 'done' ? undefined : () => setDeployModel('hardlink-shadow')}
            >
              <label style={{ display: 'flex', gap: 'var(--space-2)', cursor: phase.kind === 'done' ? 'default' : 'pointer' }}>
                <input
                  type="radio"
                  name="deployModel"
                  checked={deployModel === 'hardlink-shadow'}
                  disabled={phase.kind === 'done'}
                  onChange={() => setDeployModel('hardlink-shadow')}
                  style={{ accentColor: 'var(--color-accent)', flexShrink: 0 }}
                />
                <div>
                  <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600 }}>
                    Hardlink shadow (isolated client)
                  </div>
                  <div style={{ fontSize: 'var(--text-base)', color: 'var(--color-text-muted)' }}>
                    hardlinks client TRE base to a local shadow; uses ~0 disk on same volume — for the rare
                    whole-TRE-replacement case (absolute-path / loose-override are preferred)
                  </div>
                </div>
              </label>
              {/* ⚠ disk-space note — revealed when hardlink-shadow selected and cross-volume risk */}
              {deployModel === 'hardlink-shadow' && diskEstimate !== null && (
                <div
                  style={{
                    marginTop: 'var(--space-2)',
                    fontSize: 'var(--text-xs)',
                    fontFamily: 'var(--font-mono)',
                    color: 'var(--color-warn)',
                  }}
                >
                  ~{(diskEstimate / 1073741824).toFixed(1)} GB needed if cross-volume fallback triggers
                </div>
              )}
            </div>
          )}
        </div>

        <div style={{ height: 1, background: 'var(--color-border)' }} />

        {/* Section C — Config slot preview (absolute-path only, D-04-12) */}
        {deployModel === 'absolute-path' && fullChainScan && previewSlot !== null && (
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
                {/* MED delete-skip banner: surfaces unapplied delete actions to the user.
                    Rendered only when the loose-override deploy skipped one or more
                    'delete' action entries (base-archive files cannot be tombstoned by override). */}
                {phase.slot === 'override-dir' &&
                  ((deployRecordRef.current as LooseDeployRecord)?.skippedDeletes?.length ?? 0) > 0 && (
                  <div
                    style={{
                      padding: 'var(--space-2) var(--space-3)',
                      borderRadius: 'var(--radius-sm)',
                      border: '1px solid var(--color-warn)',
                      background: 'var(--color-warn)',
                      fontSize: 'var(--text-xs)',
                      color: 'var(--color-text)',
                      opacity: 0.9,
                    }}
                  >
                    ⚠ Note:{' '}
                    {(deployRecordRef.current as LooseDeployRecord).skippedDeletes.length}{' '}
                    delete action(s) could not be applied — base-archive files cannot be
                    tombstoned by override. Skipped:{' '}
                    {(deployRecordRef.current as LooseDeployRecord).skippedDeletes.join(', ')}.
                  </div>
                )}
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
                      ? phase.cfgRestored
                        ? `Could not write client config — ${phase.message}. Client cfg restored from snapshot (byte-pristine).`
                        : `Could not write client config — ${phase.message}. Manual cfg check recommended.`
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
            {/* After a deploy/error, this is the clear exit ("Close", prominent); before,
                it's "Cancel" (the deploy hasn't happened yet). */}
            <button
              style={phase.kind === 'done' ? primaryBtnStyleLocal(false) : secondaryBtnStyleLocal}
              onClick={handleClose}
              aria-label={phase.kind === 'done' || phase.kind === 'error' ? 'Close dialog' : 'Cancel deploy'}
            >
              {phase.kind === 'done' || phase.kind === 'error' ? 'Close' : 'Cancel'}
            </button>
            {phase.kind !== 'done' && (
            <button
              style={primaryBtnStyleLocal(isDeployDisabled)}
              disabled={isDeployDisabled}
              aria-disabled={isDeployDisabled}
              onClick={isDeployDisabled ? undefined : () => { void handleDeploy(); }}
              aria-label={activeIsBaseline ? 'Deploy Baseline (revert to stock)' : 'Deploy patch'}
              title={
                !selectedClient
                  ? 'No client selected — point me at a SWG client to deploy.'
                  : phase.kind !== 'idle'
                  ? 'Deploy in progress…'
                  : activeIsBaseline
                  ? 'Revert the client to stock (Baseline — removes the deployed patch)'
                  : 'Build and deploy the patch'
              }
            >
              {activeIsBaseline ? 'Deploy Baseline (revert to stock)' : 'Deploy patch'}
            </button>
            )}
          </div>
        )}
      </div>
    </div>

    {/* Unsaved-changes prompt — name a version instead of an auto-snapshot (UAT). */}
    {unsavedPromptOpen && (
      <div
        style={{ position: 'fixed', inset: 0, zIndex: 1100, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        onClick={() => setUnsavedPromptOpen(false)}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Save version before deploy"
          onClick={(e) => e.stopPropagation()}
          style={{ width: 360, maxWidth: '90vw', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', boxShadow: '0 8px 32px rgba(0,0,0,0.6)', padding: 'var(--space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', fontFamily: 'var(--font-sans)' }}
        >
          <div style={{ fontSize: 'var(--text-md)', fontWeight: 600, color: 'var(--color-text)' }}>Unsaved changes</div>
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)', margin: 0 }}>
            Your staged changes aren&apos;t saved as a version yet. Name one to save and deploy:
          </p>
          <input
            autoFocus
            value={pendingVersionName}
            onChange={(e) => setPendingVersionName(e.target.value)}
            placeholder="e.g. Test Version 2"
            aria-label="Version name"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && pendingVersionName.trim()) {
                const n = pendingVersionName.trim();
                setUnsavedPromptOpen(false);
                void handleDeploy(n);
              }
            }}
            style={{ fontFamily: 'var(--font-sans)', fontSize: 'var(--text-sm)', color: 'var(--color-text)', background: 'var(--color-widget)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', padding: '5px 8px', outline: 'none' }}
          />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-2)' }}>
            <button style={secondaryBtnStyleLocal} onClick={() => setUnsavedPromptOpen(false)} aria-label="Cancel deploy">
              Cancel
            </button>
            <button
              style={primaryBtnStyleLocal(!pendingVersionName.trim())}
              disabled={!pendingVersionName.trim()}
              aria-disabled={!pendingVersionName.trim()}
              onClick={() => {
                const n = pendingVersionName.trim();
                if (!n) return;
                setUnsavedPromptOpen(false);
                void handleDeploy(n);
              }}
              aria-label="Save version and deploy"
            >
              Save &amp; Deploy
            </button>
          </div>
        </div>
      </div>
    )}
    </>
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
