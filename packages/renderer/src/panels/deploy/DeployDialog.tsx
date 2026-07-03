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
  setLiveVersion,
  readManifest,
  flatEqual,
  updateChangesetDeployRecord,
  clearChangesetDeployRecord,
} from '../../services/changesetService.js';
import { packPatch, buildPatchName } from '../../services/packPatch.js';
import { detectClients, scanSharedFile, chooseSlot } from '../../services/clientLocator.js';
import { deactivatePatch, ensureInclude, snapshotCfg, restoreCfg, getToolkitCfgPath } from '../../services/cfgActivator.js';
import { deployShadowBase, resetShadow, estimateTreSize } from '../../services/shadowBaseService.js';
import { syncLiveToVersion, type ReconcileCtx } from '../../services/syncLiveToVersion.js';
import { BASELINE_ID, type TypedIpcRenderer } from '@swg/contracts';

import type { DetectedClient, CfgInsertionRecord, CfgDeployRecord, LooseDeployRecord } from '@swg/contracts';
import type { SharedFileScan } from '../../services/clientLocator.js';
import type { ShadowDeployRecord } from '../../services/shadowBaseService.js';

import { resolveLayout } from '../../services/clientLayout.js';
import { resolveOverrideDir, resetLoose } from '../../services/looseOverrideDeploy.js';
import { resolveClientMountOrder } from '../../services/clientSearchOrder.js';

// ─── Types ────────────────────────────────────────────────────────────────────

type DeployPhase =
  | { kind: 'idle' }
  | { kind: 'building' }
  | { kind: 'activating' }
  | { kind: 'done'; slot: string; cfgPath: string }
  | { kind: 'error'; step: 'build' | 'activate' | 'reset'; message: string; cfgRestored: boolean };

// ─── DeployDialog ─────────────────────────────────────────────────────────────

export function DeployDialog({
  open,
  onClose,
  isForwardDeploy = true,
}: {
  open: boolean;
  onClose: () => void;
  /**
   * VER-07: When false (navigate/revert paths), the deploy-model picker is hidden —
   * the user is browsing versions, not initiating a new forward deploy.
   * Default: true (forward deploy — show model picker).
   */
  isForwardDeploy?: boolean;
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
  // True when a PRIOR deployment is active (M8 rehydrated record + deployedVersionId set) —
  // makes "Reset deployment" reachable at phase 'idle' (cross-session), not only right
  // after an in-session deploy (phase 'done').
  const [hasPriorDeployment, setHasPriorDeployment] = useState(false);
  // Unsaved-changes prompt (UAT): when deploying with staging != the active version, ask
  // the user to name a version instead of silently auto-snapshotting.
  const [unsavedPromptOpen, setUnsavedPromptOpen] = useState(false);
  const [pendingVersionName, setPendingVersionName] = useState('');
  // True when the SELECTED (active) version is the Baseline — used to phrase the
  // CTA as "revert to stock" rather than a forward deploy.
  const [activeIsBaseline, setActiveIsBaseline] = useState(false);
  // D13: title label — "Deploy vN — label" from manifest's active version
  const [titleLabel, setTitleLabel] = useState<string>('Deploy patch');
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
    // The record is carried by the DEPLOYED version's changeset (falling back to the
    // active one for legacy manifests written before selection was decoupled from deploy).
    setHasPriorDeployment(false);
    const studioDir0 = useWorkspaceStore.getState().studioDir;
    if (studioDir0) {
      try {
        const m0 = readManifest(studioDir0);
        const carrierId0 = m0.deployedVersionId ?? m0.activeVersionId;
        if (carrierId0 && carrierId0 !== BASELINE_ID) {
          const cs0 = m0.changesets.find((c) => c.id === carrierId0);
          if (cs0?.deployRecord) {
            deployRecordRef.current = cs0.deployRecord;
            // A live deployment exists → surface the idle-phase Reset affordance.
            if (m0.deployedVersionId) setHasPriorDeployment(true);
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

    // D13: compute title "Deploy vN — label" from active version + activeIsBaseline
    const studioDir = useWorkspaceStore.getState().studioDir;
    if (studioDir) {
      try {
        const m = readManifest(studioDir);
        setActiveIsBaseline(m.activeVersionId === BASELINE_ID);
        if (m.activeVersionId && m.activeVersionId !== BASELINE_ID) {
          const idx = m.changesets.findIndex((c) => c.id === m.activeVersionId);
          const vN = idx >= 0 ? `v${idx + 1}` : 'v?';
          const cs = m.changesets[idx];
          const label = cs?.label ? ` — ${cs.label}` : '';
          setTitleLabel(`Deploy ${vN}${label}`);
        } else if (m.activeVersionId === BASELINE_ID) {
          setTitleLabel('Deploy Baseline (revert to stock)');
        } else {
          setTitleLabel('Deploy patch');
        }
      } catch {
        setActiveIsBaseline(false);
        setTitleLabel('Deploy patch');
      }
    } else {
      setActiveIsBaseline(false);
      setTitleLabel('Deploy patch');
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

      // H1: Baseline deploy (or empty version) → reset-to-stock, routed through the
      // syncLiveToVersion engine (isBaseline := desired.length === 0 internally).
      // When the user selects the Baseline version and clicks Deploy, the intent is
      // "restore the client to stock" — syncLiveToVersion's H4 dispatch already knows
      // whether the LIVE deployment was loose (resetLoose) or cfg (restoreCfg).
      if (manifest.activeVersionId === BASELINE_ID || flattenedEntries.length === 0) {
        const rootCfgPath = selectedClient!.cfgRootPath;
        const existingRec = deployRecordRef.current as (CfgDeployRecord | LooseDeployRecord | null);
        const priorLoose: LooseDeployRecord | undefined =
          existingRec && 'overrideDir' in existingRec ? (existingRec as LooseDeployRecord) : undefined;

        const ctx: ReconcileCtx = {
          manifest,
          studioDir,
          cfgPath: selectedClient!.cfgRootPath,
          installRoot: selectedClient!.installPath,
          priorLiveLooseRecord: priorLoose,
        };

        try {
          await syncLiveToVersion(manifest.activeVersionId, ctx);
          // Best-effort bookkeeping — still safe/idempotent. NOTE: do NOT call
          // setDeployedVersion(null) here: syncLiveToVersion already moved BOTH
          // activeVersionId and deployedVersionId to the target via setLiveVersion
          // (D-08 single-pointer invariant) — calling it again would desync the pointers.
          try {
            const carrier = manifest.deployedVersionId ?? manifest.activeVersionId;
            if (carrier && carrier !== BASELINE_ID) clearChangesetDeployRecord(carrier);
          } catch { /* best-effort */ }
          deployRecordRef.current = null;
          setHasPriorDeployment(false);
          setPhase({ kind: 'done', slot: 'Baseline (reset to stock)', cfgPath: rootCfgPath });
        } catch (e) {
          // Baseline revert has no separate "build" step to fail.
          setPhase({
            kind: 'error',
            step: 'activate',
            message: (e as Error).message ?? String(e),
            cfgRestored: false,
          });
        }
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

          const ctx: ReconcileCtx = {
            manifest,
            studioDir,
            cfgPath: selectedClient!.cfgRootPath,
            installRoot: selectedClient!.installPath,
            priorLiveLooseRecord: priorLoose,
          };

          // syncLiveToVersion already calls updateChangesetDeployRecord + setLiveVersion
          // internally — do NOT call them again from the dialog.
          const result = await syncLiveToVersion(manifest.activeVersionId, ctx);
          deployRecordRef.current = result.record ?? null;
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
          setLiveVersion(manifest.activeVersionId!);  // D-08: moves both activeVersionId + deployedVersionId
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

      // Step 3: activate the target cfg entry via the engine (writes the absolute outputPath
      // as the searchTree value verbatim — freshPatchPath/freshSnapshotPath, plan 260703-bpu
      // Task 1), then ensureInclude + persist. syncLiveToVersion already calls
      // updateChangesetDeployRecord + setLiveVersion internally — do NOT call them again.
      const ctx: ReconcileCtx = {
        manifest,
        studioDir,
        cfgPath: selectedClient!.cfgRootPath,
        installRoot: selectedClient!.installPath,
        priorLiveLooseRecord:
          deployRecordRef.current && 'overrideDir' in (deployRecordRef.current as object)
            ? (deployRecordRef.current as LooseDeployRecord)
            : undefined,
      };

      try {
        // D-05: outputPath (absolute path to .studio/build/<name>.tre) is passed as
        // freshPatchPath so TreeFile.cpp can find the TRE without a copy-to-Live/.
        const result = await syncLiveToVersion(manifest.activeVersionId, {
          ...ctx,
          freshPatchPath: outputPath,
          freshSnapshotPath: absSnapshotPath,
        });
        // M9: ensureInclude on absolute-path path — the root cfg gains a single absolute,
        // quoted .include pointing at the studio cfg (ConfigFile.cpp opens absolute paths).
        // This remains a dialog-owned step — the engine does not call ensureInclude.
        ensureInclude(selectedClient!.cfgRootPath, swgtoolkitCfgPath);
        deployRecordRef.current = result.record ?? null;
        setPhase({
          kind: 'done',
          slot: (result.record as CfgDeployRecord | undefined)?.keyName ?? 'deployed',
          cfgPath: swgtoolkitCfgPath,
        });
      } catch (e) {
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
    setShowResetConfirm(false);

    if (!deployRecordRef.current) {
      // Surface the miss — the old silent early-return looked like "Reset did nothing".
      setPhase({
        kind: 'error',
        step: 'reset',
        message: 'no deployment record found for the active version (close and reopen the dialog to reload it)',
        cfgRestored: false,
      });
      return;
    }
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rec = deployRecordRef.current as any;

      // Dispatch on the RECORD SHAPE — NOT the deployModel radio. The radio resets to
      // 'absolute-path' on every dialog open and can't be trusted to know which model the
      // LIVE deployment used (same rule as the Baseline deploy path above). Dispatching on
      // the radio made Reset call the wrong revert path and throw — silently (old catch).
      const isLooseRec  = 'overrideDir' in rec;
      const isShadowRec = 'shadowDir' in rec || rec.patchEntry !== undefined;

      if (isLooseRec) {
        // ── Loose-override reset ───────────────────────────────────────────
        // No cfg surgery, no .tre deletion — resetLoose restores (B3) or removes
        // only the files written by the prior deployLoose call.
        resetLoose(rec as LooseDeployRecord);
      } else {
        const rootCfgPath = selectedClient?.cfgRootPath ?? (rec.includeTargetPath as string | undefined);
        const snapPath: string | undefined = rec.snapshotPath;

        if (snapPath && rootCfgPath && fs.existsSync(snapPath)) {
          // H5 PRIMARY: whole-file restore from snapshot — byte-pristine (D-07).
          // Removes .include + any maxSearchPriority bumps; client returns to stock cfg.
          restoreCfg(rootCfgPath, snapPath);
        } else if (isShadowRec) {
          // Fallback for shadow model without snapshot: line-surgery via resetShadow
          resetShadow(rec as ShadowDeployRecord, true);
        } else {
          // Fallback for absolute-path model without snapshot: line-surgery via deactivatePatch
          deactivatePatch(rec as CfgInsertionRecord);
        }

        // Model-specific artifact cleanup — record shape again, not the radio.
        if (isShadowRec) {
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
      }

      // Clear the PERSISTED deploy record too — otherwise the M8 rehydration on the next
      // dialog open resurrects the "deployed" record that was just reset. Read the pointer
      // BEFORE clearing it so we know which changeset carries the record.
      try {
        const studioDirNow = useWorkspaceStore.getState().studioDir;
        if (studioDirNow) {
          const mNow = readManifest(studioDirNow);
          const carrierId = mNow.deployedVersionId ?? mNow.activeVersionId;
          if (carrierId) clearChangesetDeployRecord(carrierId);
        }
      } catch { /* best-effort — a failed record clear must not block the reset */ }

      setDeployedVersion(null);  // W2: clear deployedVersionId from manifest
      deployRecordRef.current = null;
      setHasPriorDeployment(false);
      setPhase({ kind: 'idle' });
    } catch (e) {
      console.error('[DeployDialog] Reset failed:', e);
      // Surface the failure — the old silent catch left the dialog showing the deployed
      // state with no explanation ("Reset does nothing").
      setPhase({
        kind: 'error',
        step: 'reset',
        message: String((e as Error)?.message ?? e),
        cfgRestored: false,
      });
    }
  }, [selectedClient]);

  // ── Return null when closed ───────────────────────────────────────────────

  if (!open) return null;

  // ── DEPLOYUI-12/D14: not-found row for bound client missing from detected list ─
  const boundClientPath = useWorkspaceStore.getState().clientPath;
  const boundClientIsDetected = !!boundClientPath && clients.some((c) => c.installPath === boundClientPath);
  const showNotFoundRow = !!boundClientPath && !boundClientIsDetected;

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
      aria-label={titleLabel}
      data-testid="deploy-dialog"
      style={overlayStyle}
      onClick={handleClose}
    >
      <div style={panelStyle} onClick={(e) => e.stopPropagation()}>

        {/* Header — DEPLOYUI-11/D13: "Deploy vN — label" */}
        <div style={headerStyle}>
          <span
            data-testid="deploy-dialog-title"
            style={{ fontWeight: 600, fontSize: 'var(--text-md)', color: 'var(--color-text)' }}
          >
            {titleLabel}
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

        {/* Section A — Target client (DEPLOYUI-12/D14: "detected" badge + "not found" row) */}
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
                data-testid="client-row"
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
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 'var(--text-sm)', fontWeight: 600 }}>{client.name}</span>
                    {/* DEPLOYUI-12/D14: "detected" badge for auto-detected clients */}
                    <span
                      data-testid="client-detected-badge"
                      style={{ fontSize: 10, color: 'var(--color-accent)' }}
                    >
                      detected
                    </span>
                  </div>
                  <div
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: 'var(--text-xs)',
                      color: 'var(--color-info)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
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

          {/* DEPLOYUI-12/D14: greyed "not found" row for bound client not in detected list */}
          {showNotFoundRow && (
            <div
              data-testid="client-row-not-found"
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 'var(--space-2)',
                padding: 'var(--space-2)',
                borderRadius: 'var(--radius-sm)',
                border: '1px dashed var(--color-border-soft)',
                opacity: 0.55,
                cursor: 'not-allowed',
              }}
            >
              <input
                type="radio"
                name="client"
                disabled
                checked={false}
                onChange={() => {}}
                style={{ marginTop: 2, flexShrink: 0 }}
              />
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 'var(--text-sm)', fontWeight: 600 }}>Bound client</span>
                  <span style={{ fontSize: 10, color: 'var(--color-text-faint)' }}>not found</span>
                </div>
                <div
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 'var(--text-xs)',
                    color: 'var(--color-text-faint)',
                  }}
                >
                  {boundClientPath}
                </div>
              </div>
            </div>
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

        {/* Section B — Deploy model (VER-07: hidden when isForwardDeploy=false) */}
        {isForwardDeploy && <div style={sectionStyle}>
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
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 'var(--text-sm)', fontWeight: 600 }}>Absolute path</span>
                  {/* DEPLOYUI-13/D15: (recommended) label per sketch 006-D */}
                  <span
                    data-testid="model-recommended-label"
                    style={{ fontSize: 10, color: 'var(--color-accent)' }}
                  >
                    (recommended)
                  </span>
                </div>
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
        </div>}

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

        {/* Cross-session Reset: a prior deployment is active but this session hasn't
            deployed (phase idle) — still offer Reset (record rehydrated via M8). Lives
            OUTSIDE the phase-state section below, which only renders when non-idle. */}
        {phase.kind === 'idle' && hasPriorDeployment && (
          <div style={sectionStyle}>
            {!showResetConfirm ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                <VerificationStatus
                  variant="pass"
                  caption="a deployment from a previous session is active on this client"
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
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                <p style={{ fontSize: 'var(--text-base)', color: 'var(--color-text)', margin: 0 }}>
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
          </div>
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
                    phase.step === 'reset'
                      ? `Reset failed — ${phase.message}. The deployment is still active; nothing was changed.`
                      : phase.step === 'activate'
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
