// @vitest-environment node
/**
 * packages/renderer/src/services/swgMainServerPush.test.ts
 * RED gate for swgMainServerPush (04.4-08 Task 1) — swg-main (VirtualBox VM) server-side
 * loose-override push, the SECOND server-push mechanism (D-22/D-23) alongside Core3's
 * TRE-search-path push (core3ServerPush.ts, 04.4-07).
 *
 * All fixtures are isolated tmp dirs — this suite NEVER touches the real `../swg-main`
 * checkout's actual data. `flatten` (changesetService) is mocked so the suite never depends
 * on a real changeset manifest; the mocked implementation returns fixed entries pointing at
 * REAL fixture source files on disk so deployLoose's B3-snapshot + atomic-write path can be
 * exercised against real bytes.
 *
 * ============================================================================================
 * SOURCE-TRACE VERIFICATION (Open Question 3 — swg-main searchPathN priority resolution)
 * ============================================================================================
 * Confirmed directly against `D:\Code\swg-main\src\engine\shared\library\sharedFile\src\shared\
 * TreeFile.cpp` this session (task is CONFIRM-THE-CITED-LINES per 04.4-08-PLAN.md Task 1):
 *
 *   - TreeFile::install (:84-149) reads `[SharedFile] searchPath<N>=` (N ascending 0..maxPriority)
 *     via ConfigFile::getKeyString(section, key, index, ...) for index=0,1,2,... (file-declaration
 *     order — ConfigFile::Key::addValue push_back()s onto an ordered std::list, confirmed against
 *     `../swg-main/.../sharedFoundation/src/shared/ConfigFile.cpp` lines 1133-1137/1207-1218) and
 *     calls TreeFile::addSearchPath(value, priority) once per declared value, IN FILE ORDER — this
 *     is a once-per-process install (re-install DEBUG_FATALs), confirmed.
 *   - TreeFile::searchNodePriorityOrder (:285-288) = `a->priority > b->priority`; addSearchNode
 *     (:299-308) inserts via `std::lower_bound(begin, end, newNode, searchNodePriorityOrder)` —
 *     PRIORITY DESC confirmed (higher N searched first).
 *   - TreeFile::open (:711-715) walks ms_searchNodes begin()->end(), first non-null/non-deleted
 *     open() wins — FIRST-MATCH-WINS confirmed.
 *
 *   *** TIE-BREAK CORRECTION (round-3, this session) — the 04.4-RESEARCH.md ADDENDUM
 *   (2026-07-03 mount-research pass) claim of "tie -> EARLIER-declared wins" at TreeFile.cpp
 *   :294-296 is FALSIFIED by a full re-derivation of std::lower_bound + vector::insert
 *   semantics on that exact comparator, AND by an EXISTING, test-PINNED ground-truth comment
 *   in THIS repo for the byte-identical client-side mechanism:
 *     packages/native-core/modules/core/tre/TreMount.h:13-20 — "the client code at
 *       TreeFile.cpp:294-296 comments that equal-priority nodes insert AFTER the last match,
 *       but the code ... actually ... inserts the NEW node BEFORE the existing same-priority
 *       nodes — so the MOST RECENTLY MOUNTED equal-priority archive wins."
 *     packages/harness/test/tre-override.test.ts:284-326 ("tre priority tie-break" suite) —
 *       a REAL PASSING TEST that measures this exact behavior and asserts
 *       `expect(result.winner).toBe(pathB)` where pathB is the SECOND-mounted archive at an
 *       equal priority (comment: "SECOND mounted archive at same priority wins").
 *     .planning/STATE.md "[Phase 01, Plan 02]" decision log: "Same-priority tie-break:
 *       SECOND-mounted equal-priority archive wins (verified by test from TreeFile.cpp:294-296
 *       code-vs-comment ambiguity)".
 *   swg-main's `exe/shared/servercommon.cfg` searchPath resolution and the client's TRE-mount
 *   resolution both funnel through the SAME shared-library mechanism
 *   (`sharedFile/src/shared/TreeFile.cpp` — literally the "shared" library, common to both
 *   client and server builds off this same source tree) — `TreeFile::addSearchNode` is used by
 *   BOTH `addSearchPath` (:322-325, server-side loose dirs) and the client's archive-mount path,
 *   with IDENTICAL `searchNodePriorityOrder`/`std::lower_bound` logic. There is no
 *   server-specific override of this insertion rule.
 *
 *   CORRECTED CONCLUSION (locked, supersedes 04.4-RESEARCH.md ADDENDUM for this one point):
 *   for MULTIPLE VALUES on the SAME `searchPath<N>=` key (a tie at that priority tier), the
 *   LAST-DECLARED (highest ConfigFile index, i.e. LAST line in the file for that key) value is
 *   installed LAST and therefore sits FIRST in ms_searchNodes (inserted-before, per
 *   std::lower_bound) — it is searched first and WINS. For the real servercommon.cfg's two
 *   `searchPath2=` lines shown in 04.4-08-PLAN.md's <interfaces> block, the winner is the
 *   SECOND-declared value `../../data/sku.0/sys.server/compiled/game/` — NOT the first-declared
 *   `sys.shared/compiled/game/` value the plan text and RESEARCH.md ADDENDUM assert. This test
 *   file pins the CORRECTED (code-and-precedent-verified) behavior; docs/05-server-integration/
 *   swg-main-parity.md (Task 2) documents the correction with the same citations.
 * ============================================================================================
 *
 * Test inventory:
 *   (a) resolveSwgMainOverrideDir: highest-numbered searchPathN tier wins; within that tier the
 *       LAST-DECLARED value wins (corrected tie-break, see above)
 *   (b) resolveSwgMainOverrideDir: missing servercommon.cfg -> clearly-named error, not raw ENOENT
 *   (c) pushSwgMainOverride: writes staged entries into the resolved dir, B3-snapshots any
 *       pre-existing file, persists studioDir/serverPush.swgmain.json (atomic tmp+rename)
 *   (d) readSwgMainPushRecord: null before any push / on malformed JSON; never throws
 *   (e) resetSwgMainOverride: restores pre-existing files / removes toolkit-written ones
 *       (byte-identical to resetLoose's contract) — round-2 LOCKED: does NOT touch
 *       serverPush.swgmain.json; a separate clearSwgMainPushRecordFile call is required
 *   (f) a staged 'delete'-action entry is recorded in skippedDeletes, not thrown
 *   (g) missing servercommonCfgPath given directly to pushSwgMainOverride -> same named error
 *
 * Source: 04.4-08-PLAN.md Task 1; docs/05-server-integration/swg-main-parity.md (Task 2);
 *         looseOverrideDeploy.ts (deployLoose/resetLoose — the exact pattern reused here).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

import type { StagingEntry, WorkspaceChangesetManifest } from '@swg/contracts';

// ─── Module mocks (hoisted above imports by vitest) ───────────────────────────

vi.mock('./changesetService', () => ({
  flatten: vi.fn(),
}));

import { flatten } from './changesetService';

// This import FAILS until Task 2 — this is the RED gate.
import {
  resolveSwgMainOverrideDir,
  pushSwgMainOverride,
  resetSwgMainOverride,
  readSwgMainPushRecord,
  clearSwgMainPushRecordFile,
} from './swgMainServerPush';

// ─── Fixture manifest (unused by the mocked flatten, but required by the signature) ──

const FAKE_MANIFEST: WorkspaceChangesetManifest = {
  activeVersionId: null,
  deployedVersionId: null,
  changesets: [],
};

// ─── The exact servercommon.cfg content from 04.4-08-PLAN.md <interfaces> ──────────

const SERVERCOMMON_CFG_CONTENT = [
  '[SharedFile]',
  'searchPath2=../../data/sku.0/sys.shared/compiled/game/',
  'searchPath2=../../data/sku.0/sys.server/compiled/game/',
  'searchPath1=../../data/sku.0/sys.shared/built/game/',
  'searchPath1=../../data/sku.0/sys.server/built/game/',
  'searchPath0=../../data/sku.0/sys.client/compiled/clientdata/',
  '',
].join('\n');

// ─── Temp-dir setup ─────────────────────────────────────────────────────────────

let root: string;
let servercommonCfgPath: string;
let studioDir: string;
let sourceFile: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'swg-main-push-test-'));

  const sharedDir = path.join(root, 'exe', 'shared');
  fs.mkdirSync(sharedDir, { recursive: true });
  servercommonCfgPath = path.join(sharedDir, 'servercommon.cfg');
  fs.writeFileSync(servercommonCfgPath, SERVERCOMMON_CFG_CONTENT, 'utf8');

  studioDir = path.join(root, 'studio');
  fs.mkdirSync(studioDir, { recursive: true });

  const sourceDir = path.join(root, 'source');
  fs.mkdirSync(sourceDir, { recursive: true });
  sourceFile = path.join(sourceDir, 'test.dds');
  fs.writeFileSync(sourceFile, 'FAKE_TEXTURE_BYTES');

  vi.clearAllMocks();

  const fakeEntries: StagingEntry[] = [
    { virtualPath: 'texture/test.dds', action: 'add', replacementFilePath: sourceFile, sha256: 'abc' },
  ];
  (flatten as unknown as ReturnType<typeof vi.fn>).mockReturnValue(fakeEntries);
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

// ─── Tests ──────────────────────────────────────────────────────────────────────

describe('swgMainServerPush', () => {
  it('(a) resolveSwgMainOverrideDir: highest-tier wins; within a tie, LAST-DECLARED value wins (corrected)', () => {
    const resolved = resolveSwgMainOverrideDir(servercommonCfgPath);

    // Highest tier present is searchPath2. Within that tier there are TWO values
    // (a tie) — the corrected ground truth (see header comment) says the LAST-declared
    // ('sys.server') wins, not the first-declared ('sys.shared').
    const expected = path.resolve(root, 'data', 'sku.0', 'sys.server', 'compiled', 'game');
    expect(path.resolve(resolved as string)).toBe(expected);
  });

  it('(b) resolveSwgMainOverrideDir: missing servercommon.cfg throws a clearly-named error, not raw ENOENT', () => {
    const missingPath = path.join(root, 'nope', 'servercommon.cfg');
    expect(() => resolveSwgMainOverrideDir(missingPath)).toThrow(
      /swg-main servercommon\.cfg not found at/,
    );
  });

  it('(c) pushSwgMainOverride writes staged entries into the resolved dir and persists the record', () => {
    const record = pushSwgMainOverride(servercommonCfgPath, studioDir, 'v1', FAKE_MANIFEST);

    const expectedDir = path.resolve(root, 'data', 'sku.0', 'sys.server', 'compiled', 'game');
    expect(path.resolve(record.overrideDir)).toBe(expectedDir);

    const destPath = path.join(record.overrideDir, 'texture', 'test.dds');
    expect(fs.existsSync(destPath)).toBe(true);
    expect(fs.readFileSync(destPath, 'utf8')).toBe('FAKE_TEXTURE_BYTES');

    // Cross-restart persistence.
    const persisted = readSwgMainPushRecord(studioDir);
    expect(persisted).not.toBeNull();
    expect(persisted?.overrideDir).toBe(record.overrideDir);
    expect(persisted?.writtenFiles.length).toBe(1);
  });

  it('(c) pushSwgMainOverride: B3 snapshots a pre-existing file before overwriting it', () => {
    const expectedDir = path.resolve(root, 'data', 'sku.0', 'sys.server', 'compiled', 'game');
    const preExistingPath = path.join(expectedDir, 'texture', 'test.dds');
    fs.mkdirSync(path.dirname(preExistingPath), { recursive: true });
    fs.writeFileSync(preExistingPath, 'ORIGINAL_BASE_BYTES');

    const record = pushSwgMainOverride(servercommonCfgPath, studioDir, 'v1', FAKE_MANIFEST);

    const written = record.writtenFiles[0];
    expect(written.preExisted).toBe(true);
    expect(written.snapshotPath).toBeDefined();
    expect(fs.readFileSync(written.snapshotPath as string, 'utf8')).toBe('ORIGINAL_BASE_BYTES');
    expect(fs.readFileSync(preExistingPath, 'utf8')).toBe('FAKE_TEXTURE_BYTES');
  });

  it('(d) readSwgMainPushRecord returns null before any push and never throws on malformed JSON', () => {
    expect(readSwgMainPushRecord(studioDir)).toBeNull();

    const recordPath = path.join(studioDir, 'serverPush.swgmain.json');
    fs.mkdirSync(path.dirname(recordPath), { recursive: true });
    fs.writeFileSync(recordPath, '{ not valid json', 'utf8');

    expect(() => readSwgMainPushRecord(studioDir)).not.toThrow();
    expect(readSwgMainPushRecord(studioDir)).toBeNull();
  });

  it('(e) resetSwgMainOverride restores/removes files, and round-2 LOCKED: does NOT clear serverPush.swgmain.json', () => {
    const record = pushSwgMainOverride(servercommonCfgPath, studioDir, 'v1', FAKE_MANIFEST);
    const destPath = record.writtenFiles[0].destPath;
    expect(fs.existsSync(destPath)).toBe(true);

    resetSwgMainOverride(record);

    // Non-preExisted file: removed by reset.
    expect(fs.existsSync(destPath)).toBe(false);

    // ROUND-2 LOCKED CONTRACT: resetSwgMainOverride does NOT clear serverPush.swgmain.json.
    expect(fs.existsSync(path.join(studioDir, 'serverPush.swgmain.json'))).toBe(true);

    // Caller (04.4-12) clears it explicitly, separately.
    clearSwgMainPushRecordFile(studioDir);
    expect(fs.existsSync(path.join(studioDir, 'serverPush.swgmain.json'))).toBe(false);
  });

  it('(f) a staged delete-action entry is recorded in skippedDeletes, not thrown', () => {
    const deleteEntries: StagingEntry[] = [
      { virtualPath: 'texture/gone.dds', action: 'delete' },
    ];
    (flatten as unknown as ReturnType<typeof vi.fn>).mockReturnValue(deleteEntries);

    const record = pushSwgMainOverride(servercommonCfgPath, studioDir, 'v1', FAKE_MANIFEST);

    expect(record.skippedDeletes).toContain('texture/gone.dds');
    expect(record.writtenFiles.length).toBe(0);
  });

  it('(g) pushSwgMainOverride: missing servercommonCfgPath throws the same clearly-named error', () => {
    const missingPath = path.join(root, 'nope', 'servercommon.cfg');
    expect(() => pushSwgMainOverride(missingPath, studioDir, 'v1', FAKE_MANIFEST)).toThrow(
      /swg-main servercommon\.cfg not found at/,
    );
  });
});
