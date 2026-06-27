/**
 * packages/renderer/src/services/packPatch.ts
 * Build a deployable .tre patch archive from a set of staging entries (DEPLOY-01).
 *
 * Exports:
 *   buildPatchName(workspaceName) — sanitized + UUID-fragmented archive filename (B6+N2 fix)
 *   packPatch(staged, outputPath) — converts staging entries → buildTre entries, sorts
 *                                   canonically, calls buildTre('5000'), writes atomically
 *
 * Fixes implemented:
 *   B6 — sanitize workspaceName (ConfigFile reads up to whitespace; spaces truncate cfg values)
 *   N2 — UUID fragment on buildPatchName for same-name collision prevention
 *   D-04-08a — canonical sort by virtualPath before buildTre → byte-identical re-deploy
 *   T-04-09 — path traversal guard: reject virtualPath containing '..' or starting with '/'|'\'
 *
 * Path B renderer: nodeIntegration:true, contextIsolation:false — fs/path/crypto usable directly.
 *
 * Source:
 *   04-03-PLAN.md Task 2; 04-CONTEXT.md §D-04-03/04/08a; 04-RESEARCH.md §Pattern 1.
 *   packages/native-core/index.d.ts lines 472-518 (buildTre + TreBuilderEntryNative).
 *   packages/renderer/src/hooks/useLiveService.ts lines 29-35 (addon require pattern).
 */

import path from 'path';
import fs from 'fs';
import { randomUUID } from 'crypto';

import type { StagingEntry } from '@swg/contracts';

// Path B: require the native addon directly (nodeIntegration:true in the renderer).
// Mirrors the pattern in useLiveService.ts lines 29-35.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const nativeCore = require('@swg/native-core') as {
  buildTre: (entries: Array<{ path: string; data?: Uint8Array; tombstone?: boolean }>, version?: string) => ArrayBuffer;
};

// ─── buildPatchName ───────────────────────────────────────────────────────────

/**
 * Derive a safe .tre filename for a patch archive from the workspace name.
 *
 * B6 fix: ConfigFile reads searchTree values up to the first whitespace character
 * (ConfigFile.cpp:436-518). A workspace name with spaces would silently truncate
 * the value and the client would look for a non-existent file.
 *
 * N2 fix: A 4-char UUID fragment prevents same-name collisions across workspaces
 * that happen to share the same sanitized name.
 *
 * @param workspaceName  Human-readable workspace name (e.g. "My Mod Project")
 * @returns Sanitized filename (e.g. "swgtoolkit_My_Mod_Project_a3f7.tre")
 */
export function buildPatchName(workspaceName: string): string {
  // B6: replace any non-alphanumeric/underscore/hyphen character with '_'
  const safe = workspaceName.replace(/[^a-zA-Z0-9_-]/g, '_');
  // N2: 4-char UUID fragment for collision prevention
  const suffix = randomUUID().replace(/-/g, '').slice(0, 4);
  return 'swgtoolkit_' + safe + '_' + suffix + '.tre';
}

// ─── packPatch ────────────────────────────────────────────────────────────────

/**
 * Build a deploy patch .tre from a set of staging entries and write it to disk.
 *
 * Accepts BOTH:
 *   - Live staging entries (replacementFilePath = user's external file)
 *   - flatten() output entries (replacementFilePath = storedFileRef inside .studio/changesets/)
 * The conversion logic is identical in both cases.
 *
 * Security: rejects any virtualPath containing '..' or starting with '/' or '\' (T-04-09).
 *
 * @param staged      Array of StagingEntry from the staging store or flatten().
 * @param outputPath  Absolute path to write the output .tre file.
 *
 * Source: D-04-04 (buildTre with version='5000' ONLY — the default is wrong for Infinity);
 *         D-04-08a (canonical sort by virtualPath → byte-identical re-deploy);
 *         T-04-09 (path traversal guard).
 */
export function packPatch(staged: StagingEntry[], outputPath: string): void {
  // T-04-09: path traversal guard — reject any virtualPath that could escape the VFS
  for (const entry of staged) {
    if (
      entry.virtualPath.includes('..') ||
      entry.virtualPath.startsWith('/') ||
      entry.virtualPath.startsWith('\\')
    ) {
      throw new Error(`Invalid virtualPath: path traversal rejected — '${entry.virtualPath}'`);
    }
  }

  // Convert StagingEntry[] → buildTre entry array
  const entries: Array<{ path: string; data?: Uint8Array; tombstone?: boolean }> = staged.map((s) => {
    if (s.action === 'delete') {
      return { path: s.virtualPath, tombstone: true };
    }
    // 'add' or 'modify': read replacement file bytes
    const data = new Uint8Array(fs.readFileSync(s.replacementFilePath!));
    return { path: s.virtualPath, data };
  });

  // D-04-08a: canonical sort by virtualPath before buildTre.
  // Uses code-point comparison (< / > operators), NOT localeCompare, so sort order is
  // deterministic across locales. Re-deploying the same version is byte-identical.
  entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

  // Build the patch archive with version='5000' (EERT5000 — matches live Infinity client).
  // MUST be '5000' — the buildTre default is wrong for Infinity and will NOT load.
  // Source: 04-RESEARCH.md §Pitfall 1; D-04-04.
  const patchBytes = nativeCore.buildTre(entries, '5000');

  // Ensure output directory exists
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });

  // Atomic write: write to .tmp first, then rename (same-volume rename is atomic on Windows).
  // Prevents a partial .tre from being seen by the client if the process is interrupted.
  const tmp = outputPath + '.tmp';
  fs.writeFileSync(tmp, Buffer.from(patchBytes));
  fs.renameSync(tmp, outputPath);
}
