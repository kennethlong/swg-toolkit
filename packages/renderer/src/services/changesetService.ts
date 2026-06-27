/**
 * packages/renderer/src/services/changesetService.ts
 * Version graph engine for changeset management (DEPLOY-03).
 *
 * Implements the REFINED graph model from D-04-05..08 (2026-06-26):
 *   flatten()      — walks root→N via parentId, last-writer-wins accumulation,
 *                    canonical code-point sort (R2-W4), cycle guard (R2-W6)
 *   sealVersion()  — stores DIFF-VS-PARENT file bytes only (R2-W3), atomic
 *                    manifest write, N4 empty/dup guard, branching via parentId
 *   selectVersion() — moves activeVersionId pointer AND materializes staging (B2 fix)
 *   setDeployedVersion() — moves deployedVersionId pointer with existence check (R2-W7)
 *   flatEqual()    — N4 guard helper with sha fallback to file size (R2-W5)
 *   updateChangesetDeployRecord() — persists deploy record to manifest (R2-B8)
 *   readManifest() / writeManifest() — atomic JSON I/O
 *
 * HARD CONSTRAINTS (append-only, verified by test):
 *   - No destructive filesystem operations; no purge/archive utilities
 *   - History is append-only; nothing ever deleted
 *   - changesets[] array is NEVER destructively mutated
 *
 * Path B renderer: nodeIntegration:true — fs, path, crypto available directly.
 *
 * Source: 04-04-PLAN.md Task 2; 04-CONTEXT.md §D-04-05..08.
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

import type {
  WorkspaceChangesetManifest,
  SwgChangeset,
  FileDelta,
  StagingEntry,
  StagingAction,
  CfgDeployRecord,
} from '@swg/contracts';

import { useChangesetStore } from '../state/changesetStore';
import { useStagingStore } from '../state/stagingStore';
import { useWorkspaceStore } from '../state/workspaceStore';

// ─── Manifest I/O ─────────────────────────────────────────────────────────────

/**
 * Returns the absolute path to the manifest.json for the given studioDir.
 */
export function getManifestPath(studioDir: string): string {
  return path.join(studioDir, 'changesets', 'manifest.json');
}

/**
 * Read the changeset manifest from disk, or return an empty manifest if absent.
 */
export function readManifest(studioDir: string): WorkspaceChangesetManifest {
  const p = getManifestPath(studioDir);
  if (!fs.existsSync(p)) {
    return { activeVersionId: null, deployedVersionId: null, changesets: [] };
  }
  return JSON.parse(fs.readFileSync(p, 'utf8')) as WorkspaceChangesetManifest;
}

/**
 * Atomically write the manifest to disk.
 * Uses tmp+rename so a partial write never corrupts manifest.json.
 */
export function writeManifest(studioDir: string, manifest: WorkspaceChangesetManifest): void {
  const p = getManifestPath(studioDir);
  const tmp = p + '.tmp';
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(tmp, JSON.stringify(manifest, null, 2), 'utf8');
  fs.renameSync(tmp, p); // atomic on same-volume rename
}

// ─── flatten ──────────────────────────────────────────────────────────────────

/**
 * Walk the parentId chain from root to versionId, accumulate deltas
 * with last-writer-wins per virtualPath, and return a canonical sorted
 * StagingEntry[] suitable for deploy or selectVersion materialization.
 *
 * Algorithm:
 *   1. Walk versionId→parent→...→null (reverse root→N order) via parentId.
 *      push+reverse avoids O(n²) unshift (R2-W6 fix).
 *   2. visited Set breaks cycles in corrupt manifests (R2-W6 cycle guard).
 *   3. For each changeset in root→N order: last-writer-wins per virtualPath.
 *   4. Convert to StagingEntry[], resolve storedFileRef, sort by virtualPath
 *      using code-point order (NOT localeCompare — D-04-08a, R2-W4).
 *
 * Source: D-04-08, R2-W3/W4/W6.
 */
export function flatten(
  versionId: string | null,
  manifest: WorkspaceChangesetManifest,
  studioDir: string
): StagingEntry[] {
  if (versionId === null) return [];

  const byId = new Map<string, SwgChangeset>(manifest.changesets.map(c => [c.id, c]));

  // Walk versionId→root (collecting in reverse), then reverse for root→N order.
  // R2-W6: visited Set guards against cycles in corrupt manifests.
  const visited = new Set<string>();
  const chainPath: SwgChangeset[] = [];
  let cur: SwgChangeset | undefined = byId.get(versionId);
  while (cur) {
    if (visited.has(cur.id)) break; // cycle guard (R2-W6)
    visited.add(cur.id);
    chainPath.push(cur);
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }
  chainPath.reverse(); // root first — avoids O(n²) unshift (R2-W6 fix)

  // Accumulate: last-writer-wins per virtualPath.
  // walk root→N; later versions' deltas OVERWRITE earlier ones for same virtualPath.
  // parentId chain walk: NOT a cumulative merge of full snapshots (Opus footgun note).
  const acc = new Map<string, { delta: FileDelta; csId: string }>();
  for (const cs of chainPath) {
    for (const delta of cs.deltas) {
      acc.set(delta.virtualPath, { delta, csId: cs.id });
    }
  }

  // Convert to StagingEntry[], resolving storedFileRef → absolute replacementFilePath.
  const entries: StagingEntry[] = [...acc.values()].map(({ delta, csId }) => ({
    virtualPath: delta.virtualPath,
    action: delta.action as StagingAction,
    replacementFilePath:
      delta.action !== 'delete' && delta.storedFileRef
        ? path.join(studioDir, 'changesets', csId, 'files', delta.storedFileRef)
        : undefined,
    sha256: delta.sha,
  }));

  // Canonical sort by virtualPath — code-point order (D-04-08a, R2-W4).
  // NOT localeCompare — must be byte-identical across locales for re-deploy determinism.
  entries.sort((a, b) =>
    a.virtualPath < b.virtualPath ? -1 : a.virtualPath > b.virtualPath ? 1 : 0
  );

  return entries;
}

// ─── flatEqual ────────────────────────────────────────────────────────────────

/**
 * Compare two flattened StagingEntry[] sets for equality (N4 empty/dup guard).
 *
 * Both arrays must be sorted by virtualPath (canonical order) before calling.
 * Comparison order: length → virtualPath → action → sha256 (R2-W5: fallback to
 * file size when sha256 is absent on one or both sides — handles legacy entries
 * added before 04-02 sha fix).
 *
 * Source: D-04-08b, R2-W5.
 */
export function flatEqual(a: StagingEntry[], b: StagingEntry[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].virtualPath !== b[i].virtualPath) return false;
    if (a[i].action !== b[i].action) return false;
    if (a[i].sha256 !== undefined && b[i].sha256 !== undefined) {
      // Both sides have sha — compare directly.
      if (a[i].sha256 !== b[i].sha256) return false;
    } else if (
      a[i].replacementFilePath !== undefined &&
      b[i].replacementFilePath !== undefined
    ) {
      // R2-W5: sha absent on at least one side → fallback to file size comparison.
      const sizeA = fs.statSync(a[i].replacementFilePath!).size;
      const sizeB = fs.statSync(b[i].replacementFilePath!).size;
      if (sizeA !== sizeB) return false;
    }
    // If both replacementFilePaths are absent (e.g. both delete tombstones),
    // and sha is also absent, we conservatively consider them equal since
    // virtualPath + action already matched.
  }
  return true;
}

// ─── sealVersion ──────────────────────────────────────────────────────────────

export interface SealVersionParams {
  sealedBy: 'manual' | 'pack';
  entries: StagingEntry[];
  label: string;
  deployRecord?: CfgDeployRecord;
}

/**
 * Seal the current working set as a new version node in the changeset graph.
 *
 * Steps:
 *   1. N4 guard: throw 'Nothing new to commit' if flattened new state == parent state.
 *   2. DIFF-VS-PARENT (R2-W3): compute sha from SOURCE file BEFORE copying; filter
 *      to only files changed vs flatten(parentId). Copy only changed files.
 *   3. Write manifest atomically; update store.
 *
 * Branching: new node's parentId = current manifest.activeVersionId.
 * If the user called selectVersion(older) before sealing, activeVersionId is the
 * older version — so the new node branches from there (D-04-07).
 *
 * INVARIANT: No destructive filesystem operations, no purge utilities, no
 * array mutation. History is append-only. Nothing is ever deleted.
 *
 * Source: D-04-05..08, R2-W3/W5/W6/N4.
 */
export async function sealVersion(params: SealVersionParams): Promise<void> {
  useChangesetStore.getState().beginSeal();

  const studioDir = useWorkspaceStore.getState().studioDir;
  if (!studioDir) throw new Error('No workspace open');

  const manifest = readManifest(studioDir);

  // ── N4: Empty/dup guard ────────────────────────────────────────────────────
  // Compare the new flattened state vs the current version's flattened state.
  // Both sorted by virtualPath (code-point) for stable comparison.
  const currentFlat = flatten(manifest.activeVersionId, manifest, studioDir);
  const newFlat = params.entries
    .slice()
    .sort((a, b) =>
      a.virtualPath < b.virtualPath ? -1 : a.virtualPath > b.virtualPath ? 1 : 0
    );

  if (flatEqual(currentFlat, newFlat)) {
    useChangesetStore.getState().sealError('Nothing new to commit');
    throw new Error(
      'Nothing new to commit — the staged changes are identical to the current version.'
    );
  }

  // ── Allocate changeset dir ─────────────────────────────────────────────────
  const id = crypto.randomUUID();
  const csDir = path.join(studioDir, 'changesets', id, 'files');
  fs.mkdirSync(csDir, { recursive: true });

  // ── R2-W3 DIFF-VS-PARENT: compute sha from SOURCE; filter changed files ────
  // Compute the parent's flattened state for comparison.
  const parentFlat = flatten(manifest.activeVersionId, manifest, studioDir);
  const parentMap = new Map<string, StagingEntry>(parentFlat.map(e => [e.virtualPath, e]));

  // CRITICAL: compute sha from the SOURCE file and filter BEFORE copying any bytes.
  // Only changed files are copied — no orphaned bytes; no unnecessary re-storage.
  // (R2-final Opus note: sha computed from source → filter → copy only changed.)
  const deltas: FileDelta[] = [];
  for (const entry of params.entries) {
    const parentEntry = parentMap.get(entry.virtualPath);

    if (entry.action === 'delete' || !entry.replacementFilePath) {
      // Explicit delete tombstone — meaningful only if parent had this path.
      if (
        entry.action === 'delete' &&
        (!parentEntry || parentEntry.action === 'delete')
      ) {
        // Parent didn't have this path (or already deleted) — no-op delete.
        continue;
      }
      deltas.push({
        virtualPath: entry.virtualPath,
        action: entry.action as StagingAction,
        storedFileRef: undefined,
        sha: undefined,
      });
      continue;
    }

    // Compute sha from the SOURCE file (before any copy).
    const sha = crypto
      .createHash('sha256')
      .update(fs.readFileSync(entry.replacementFilePath))
      .digest('hex');

    // Determine if this file changed vs parent state.
    const changed =
      !parentEntry ||
      parentEntry.action !== entry.action ||
      parentEntry.sha256 === undefined || // can't compare conservatively → include
      parentEntry.sha256 !== sha;

    if (!changed) continue; // unchanged vs parent — do NOT copy, do NOT store

    // Copy ONLY changed files into the changeset dir.
    const normalizedPath = entry.virtualPath.replace(/\\/g, '/');
    const destPath = path.join(csDir, ...normalizedPath.split('/'));
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    fs.copyFileSync(entry.replacementFilePath, destPath);

    deltas.push({
      virtualPath: entry.virtualPath,
      action: entry.action as StagingAction,
      storedFileRef: normalizedPath,
      sha,
    });
  }

  // INVARIANT (Opus scenario 4): delete deltas must be EXPLICIT (action:'delete'
  // with storedFileRef=undefined). A parent path dropped by mere absence in the
  // working set is NOT a delete. The materialization model guarantees explicit
  // tombstones; flatten() emits them; selectVersion() restores them.

  // ── Build changeset node ───────────────────────────────────────────────────
  const cs: SwgChangeset = {
    id,
    parentId: manifest.activeVersionId, // branching mechanism (D-04-07)
    label: params.label || 'changeset',
    timestamp: new Date().toISOString(),
    sealedBy: params.sealedBy,
    deltas,
    deployRecord: params.deployRecord,
  };

  manifest.changesets.push(cs); // append-only — history never destructively mutated
  manifest.activeVersionId = id;

  try {
    writeManifest(studioDir, manifest);
    useChangesetStore.getState().sealComplete(manifest);
  } catch (e) {
    useChangesetStore.getState().sealError(String((e as Error)?.message ?? e));
    throw e;
  }
}

// ─── selectVersion ────────────────────────────────────────────────────────────

/**
 * Move the activeVersionId pointer to id AND materialize the staging store
 * from flatten(id).
 *
 * B2 fix: the prior "cosmetic pointer-only toggle" never restored staging.
 * This function calls useStagingStore.getState().restoreEntries(flatten(id))
 * so subsequent edits and the next sealVersion see the correct working set.
 *
 * B3 fix: the prior sealVersion appended at changesets.length and jumped
 * PAST rolled-back nodes. With parentId branching, sealVersion simply uses
 * manifest.activeVersionId (set here) as the new node's parentId, so
 * editing after rollback correctly branches from the selected version.
 *
 * Source: D-04-08, B2/B3 fixes.
 */
export function selectVersion(id: string | null): void {
  const studioDir = useWorkspaceStore.getState().studioDir;
  if (!studioDir) throw new Error('No workspace open');

  const manifest = readManifest(studioDir);

  // T-04-15: validate id exists before writing.
  if (id !== null && !manifest.changesets.some(c => c.id === id)) {
    throw new Error('Version not found: ' + id);
  }

  manifest.activeVersionId = id;
  writeManifest(studioDir, manifest);

  // B2 fix: MATERIALIZE the staging list from flatten(id).
  // restoreEntries replaces the staging list wholesale — not a partial update.
  const flattened = flatten(id, manifest, studioDir);
  useStagingStore.getState().restoreEntries(flattened);
  useChangesetStore.getState().setActiveVersion(id);
}

// ─── setDeployedVersion ───────────────────────────────────────────────────────

/**
 * Move the deployedVersionId pointer to id.
 *
 * R2-W7: validates id exists in manifest.changesets before writing.
 * Only the deploy pointer changes — nothing else is touched.
 *
 * Source: D-04-08, R2-W7.
 */
export function setDeployedVersion(id: string | null): void {
  const studioDir = useWorkspaceStore.getState().studioDir;
  if (!studioDir) throw new Error('No workspace open');

  const manifest = readManifest(studioDir);

  // R2-W7: existence check — same guard as selectVersion T-04-15.
  if (id !== null && !manifest.changesets.some(c => c.id === id)) {
    throw new Error('setDeployedVersion: version not found: ' + id);
  }

  manifest.deployedVersionId = id;
  writeManifest(studioDir, manifest);
  useChangesetStore.getState().setDeployedVersion(id);
}

// ─── updateChangesetDeployRecord ──────────────────────────────────────────────

/**
 * Persist a deploy record into the named changeset in manifest.json.
 *
 * R2-B8: DeployDialog must call this after a successful deploy so the record
 * survives component unmount/remount (rather than only living in deployRecordRef.current).
 *
 * Source: R2-B8.
 */
export function updateChangesetDeployRecord(
  csId: string,
  record: CfgDeployRecord
): void {
  const studioDir = useWorkspaceStore.getState().studioDir;
  if (!studioDir) throw new Error('No workspace open');

  const manifest = readManifest(studioDir);
  const cs = manifest.changesets.find(c => c.id === csId);
  if (!cs) {
    throw new Error('updateChangesetDeployRecord: changeset not found: ' + csId);
  }

  cs.deployRecord = record;
  writeManifest(studioDir, manifest);
  useChangesetStore.getState().setManifest(manifest);
}
