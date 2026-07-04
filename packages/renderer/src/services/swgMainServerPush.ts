/**
 * packages/renderer/src/services/swgMainServerPush.ts
 * swg-main (VirtualBox VM) server-side loose-override push — the SECOND server-push
 * mechanism (D-22/D-23), architecturally a server-side `looseOverrideDeploy` (NOT a TRE
 * push — swg-main has no TRE-archive concept server-side at all; `exe/shared/servercommon.cfg`'s
 * `[SharedFile] searchPath0/1/2=` reads game data directly from loose compiled source dirs).
 *
 * Exports:
 *   resolveSwgMainOverrideDir(servercommonCfgPath) — parses `[SharedFile] searchPathN=` and
 *     resolves the winning (highest-tier) directory, per the CORRECTED tie-break below.
 *   pushSwgMainOverride(servercommonCfgPath, studioDir, activeVersionId, manifest) — writes staged
 *     entries into the resolved dir (ports looseOverrideDeploy.deployLoose verbatim), PLUS persists
 *     the returned record to studioDir/serverPush.swgmain.json (cross-restart).
 *   readSwgMainPushRecord(studioDir)     — never-throws read of the persisted record.
 *   resetSwgMainOverride(record)         — PURE undo-the-write; thin wrapper of resetLoose; does
 *                                            NOT clear the record file.
 *   clearSwgMainPushRecordFile(studioDir) — standalone; the caller's (04.4-12's) job, in order.
 *
 * PATH CONTRACT (locked, identical in 04.4-12; VERIFIED 2026-07-03 via a direct filesystem
 * check): `serverConfig.path` (type 'swgsource-docker') = the swg-main REPO ROOT.
 * `servercommonCfgPath` is ALWAYS `path.join(serverConfig.path, 'exe', 'shared',
 * 'servercommon.cfg')` — the caller (04.4-12) performs this join; this module NEVER re-derives
 * it from serverConfig.path.
 *
 * RESET-RECORD-CLEAR CONTRACT (round-2, locked, matching 04.4-07's identical contract):
 * `resetSwgMainOverride(record)` undoes the loose-file write only (delegates to `resetLoose`) —
 * it never touches `serverPush.swgmain.json`. Clearing that persisted record file after a
 * successful reset is EXCLUSIVELY the CALLER's job (04.4-12's Reset handler calls
 * `resetSwgMainOverride` then `clearSwgMainPushRecordFile` explicitly, in that order).
 *
 * ============================================================================================
 * GROUND TRUTH — swg-main searchPathN priority + tie-break resolution (CORRECTED, this session)
 * ============================================================================================
 * Verified directly against `../swg-main/src/engine/shared/library/sharedFile/src/shared/
 * TreeFile.cpp` (see swgMainServerPush.test.ts header for the full citation trail):
 *   - `install` (:84-149): reads `searchPath<N>=` for N ascending 0..maxPriority, multi-value
 *     per key in FILE-DECLARATION order (ConfigFile.cpp Key::addValue push_back()s onto an
 *     ordered list — confirmed), calling `addSearchPath(value, priority)` once per declared
 *     value in that order.
 *   - `searchNodePriorityOrder` + `addSearchNode` (:285-308): `std::lower_bound` with
 *     `a->priority > b->priority` — PRIORITY DESC confirmed (higher N wins).
 *   - `open` (:711-715): first-match-wins walk over the sorted list — confirmed.
 *   - **TIE-BREAK, CORRECTED:** the 04.4-RESEARCH.md ADDENDUM (2026-07-03 mount-research pass)
 *     asserted "tie -> earlier-declared wins" reading the :294-296 comment at face value. That
 *     comment ("new nodes... inserted after the last priority match") is CONTRADICTED by the
 *     actual `std::lower_bound`/`vector::insert` semantics (a fresh derivation this session:
 *     for an exact-priority tie, `lower_bound` returns the position of the FIRST existing
 *     equal-priority element, and `insert` places the NEW node BEFORE it — so the most
 *     recently-added node ends up EARLIEST in the search order and wins). This exact
 *     comment/code ambiguity, for the SAME shared `TreeFile.cpp` mechanism (client and server
 *     both build off this shared library), was ALREADY settled by a real, passing,
 *     project-internal test: `packages/native-core/modules/core/tre/TreMount.h:13-20` +
 *     `packages/harness/test/tre-override.test.ts` ("tre priority tie-break" suite,
 *     `expect(result.winner).toBe(pathB)` where pathB is the SECOND-mounted archive) — recorded
 *     as a locked decision in `.planning/STATE.md` ("[Phase 01, Plan 02]: Same-priority
 *     tie-break: SECOND-mounted equal-priority archive wins"). The RESEARCH.md ADDENDUM's
 *     "correction" is FALSIFIED by this precedent + the fresh trace; it is superseded here.
 *   - **Corrected rule:** within a `searchPath<N>` tier with multiple declared values (a tie),
 *     the LAST-DECLARED value in the cfg file wins (installed last -> inserted earliest in
 *     `ms_searchNodes` -> searched first). For the real `servercommon.cfg`
 *     (`docs/05-server-integration/swg-main-parity.md`), the winning `searchPath2` value is
 *     `../../data/sku.0/sys.server/compiled/game/` — the SECOND line, not the first.
 * ============================================================================================
 *
 * Source: 04.4-08-PLAN.md Task 2; swgMainServerPush.test.ts (source-trace citations);
 *         looseOverrideDeploy.ts (deployLoose/resetLoose — the exact pattern reused here);
 *         changesetService.ts (writeManifest atomic tmp+rename pattern — mirrored here).
 */

import fs from 'fs';
import path from 'path';

import type { LooseDeployRecord, WorkspaceChangesetManifest } from '@swg/contracts';

import { flatten } from './changesetService';
import { deployLoose, resetLoose } from './looseOverrideDeploy';

// ─── resolveSwgMainOverrideDir ─────────────────────────────────────────────────

/**
 * Parse `[SharedFile] searchPath<N>=` lines from a swg-main `servercommon.cfg` and resolve the
 * winning (highest-priority) directory, absolute-resolved relative to
 * `path.dirname(servercommonCfgPath)`.
 *
 * Liveness pre-check: throws a clearly-named error if `servercommonCfgPath` does not exist,
 * rather than surfacing a raw ENOENT deeper in the pipeline.
 *
 * Tie-break within a tier (multiple values for the same `searchPath<N>` key): the LAST-DECLARED
 * value wins — see the module header's GROUND TRUTH section for the full derivation, which
 * CORRECTS the 04.4-RESEARCH.md ADDENDUM's "earlier-declared wins" claim.
 *
 * Returns `null` when no `searchPath<N>=` entries are present at all.
 */
export function resolveSwgMainOverrideDir(servercommonCfgPath: string): string | null {
  if (!fs.existsSync(servercommonCfgPath)) {
    throw new Error(
      `swg-main servercommon.cfg not found at ${servercommonCfgPath} — confirm serverConfig.path points at the swg-main repo root`,
    );
  }

  const text = fs.readFileSync(servercommonCfgPath, 'utf8');
  const tiers = new Map<number, string[]>();

  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*searchPath(\d+)\s*=\s*(.+?)\s*$/.exec(line);
    if (!m) continue;
    const tier = parseInt(m[1], 10);
    const value = m[2];
    const existing = tiers.get(tier);
    if (existing) {
      existing.push(value);
    } else {
      tiers.set(tier, [value]);
    }
  }

  if (tiers.size === 0) return null;

  const maxTier = Math.max(...tiers.keys());
  const values = tiers.get(maxTier)!;

  // CORRECTED tie-break (see module header): LAST-declared value wins within a tier.
  const winningValue = values[values.length - 1];

  const baseDir = path.dirname(path.resolve(servercommonCfgPath));
  return path.resolve(baseDir, winningValue);
}

// ─── serverPush.swgmain.json persistence ──────────────────────────────────────

function getSwgMainPushRecordPath(studioDir: string): string {
  return path.join(studioDir, 'serverPush.swgmain.json');
}

/**
 * Read the persisted swg-main push record, or `null` if absent or malformed.
 * Never throws — mirrors `changesetService.readManifest`'s defensive-parse style.
 */
export function readSwgMainPushRecord(studioDir: string): LooseDeployRecord | null {
  const p = getSwgMainPushRecordPath(studioDir);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8')) as LooseDeployRecord;
  } catch {
    return null;
  }
}

/**
 * Best-effort unlink of `serverPush.swgmain.json` — never throws.
 *
 * STANDALONE export. `resetSwgMainOverride` NEVER calls this (round-2 locked contract) —
 * 04.4-12's Reset handler is the only caller that invokes both, explicitly, in order:
 * `resetSwgMainOverride(record)` THEN `clearSwgMainPushRecordFile(studioDir)`.
 */
export function clearSwgMainPushRecordFile(studioDir: string): void {
  try {
    fs.unlinkSync(getSwgMainPushRecordPath(studioDir));
  } catch {
    // best-effort — file may already be gone
  }
}

function writeSwgMainPushRecord(studioDir: string, record: LooseDeployRecord): void {
  const p = getSwgMainPushRecordPath(studioDir);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = p + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(record, null, 2), 'utf8');
  fs.renameSync(tmp, p);
}

// ─── pushSwgMainOverride ────────────────────────────────────────────────────────

/**
 * Build this project's active-version staged entries and write them into swg-main's
 * highest-priority `searchPath<N>` directory, persisting the record for cross-restart Reset.
 *
 * @param servercommonCfgPath  CALLER-RESOLVED path to servercommon.cfg
 *                              (path.join(serverConfig.path, 'exe', 'shared', 'servercommon.cfg')).
 * @param studioDir             Absolute path to the toolkit studio dir.
 * @param activeVersionId       The changeset version to build the override set from.
 * @param manifest              Full workspace changeset manifest (passed to flatten()).
 */
export function pushSwgMainOverride(
  servercommonCfgPath: string,
  studioDir: string,
  activeVersionId: string,
  manifest: WorkspaceChangesetManifest,
): LooseDeployRecord {
  // resolveSwgMainOverrideDir performs the liveness pre-check (throws the named error).
  const overrideDir = resolveSwgMainOverrideDir(servercommonCfgPath);
  if (!overrideDir) {
    throw new Error(
      `swg-main servercommon.cfg at ${servercommonCfgPath} declares no [SharedFile] searchPath<N>= entries — cannot resolve a push target`,
    );
  }

  const entries = flatten(activeVersionId, manifest, studioDir);

  // H2 prune: reuse deployLoose's built-in prior-record reset so a re-push never orphans files.
  const priorRecord = readSwgMainPushRecord(studioDir);

  const record = deployLoose(entries, overrideDir, {
    studioDir,
    priorRecord: priorRecord ?? undefined,
  });

  writeSwgMainPushRecord(studioDir, record);

  return record;
}

// ─── resetSwgMainOverride ───────────────────────────────────────────────────────

/**
 * Undo a `pushSwgMainOverride` call — PURE "undo the write" function.
 *
 * Thin wrapper of `resetLoose` (the record shape and restore semantics are IDENTICAL — the
 * restore logic is NOT duplicated here).
 *
 * ROUND-2 LOCKED CONTRACT: this function MUST NOT touch `serverPush.swgmain.json` — clearing
 * that persisted record file is EXCLUSIVELY the caller's (04.4-12's) job via
 * `clearSwgMainPushRecordFile`, called separately, after this function returns.
 */
export function resetSwgMainOverride(record: LooseDeployRecord): void {
  resetLoose(record);
  // INTENTIONALLY does NOT touch serverPush.swgmain.json (round-2 locked contract).
}
