/**
 * packages/renderer/test/changeset.test.ts
 * Unit tests for the version graph engine (DEPLOY-03).
 *
 * Test suite: 8 cases covering the full graph model
 *   T1 — sealVersion in empty workspace (root node, bytes stored)
 *   T2 — sealVersion twice creates linear chain (parentId linkage)
 *   T3 — flatten accumulates last-writer-wins, sorted by virtualPath
 *   T4 — selectVersion materializes staging list (B2 fix: not cosmetic)
 *   T5 — sealVersion after selectVersion(older) creates BRANCH
 *   T6 — flatten on different branches returns independent paths
 *   T7 — sealVersion throws "Nothing new to commit" (N4 empty/dup guard)
 *   T8 — sealVersion stores DIFF-VS-PARENT only (b.txt unchanged → excluded)
 *
 * TDD RED phase: tests compile but fail at runtime until Task 2 creates changesetService.ts.
 * TDD GREEN phase: all 8 tests pass once changesetService.ts is implemented.
 *
 * Source: 04-04-PLAN.md Task 1; 04-CONTEXT.md §D-04-05..08.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

import { useChangesetStore } from '../src/state/changesetStore';
import { useStagingStore } from '../src/state/stagingStore';
import { useWorkspaceStore } from '../src/state/workspaceStore';
import {
  sealVersion,
  flatten,
  selectVersion,
  readManifest,
} from '../src/services/changesetService';

// ─── Test context ─────────────────────────────────────────────────────────────

let TMP: string;
let STUDIO_DIR: string;

beforeEach(() => {
  // Fresh tmpdir per test — prevents manifest interference across tests.
  TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'swg-changeset-'));
  STUDIO_DIR = path.join(TMP, '.studio');
  fs.mkdirSync(path.join(STUDIO_DIR, 'changesets'), { recursive: true });

  // Wire up workspace store so sealVersion/selectVersion can read studioDir.
  useWorkspaceStore.getState().openComplete({
    folderPath: TMP,
    studioDir: STUDIO_DIR,
    workspaceName: 'test',
    clientPath: null,
  });
  // Reset changeset store to empty graph.
  useChangesetStore.getState().setManifest({
    activeVersionId: null,
    deployedVersionId: null,
    changesets: [],
  });
  // Clear staging.
  useStagingStore.getState().clearAll();
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('changeset DEPLOY-03 — version graph engine', () => {
  // ─── T1: Root node creation ────────────────────────────────────────────────
  it('T1: sealVersion in empty workspace → root changeset (parentId=null, bytes stored on disk)', async () => {
    const aFile = path.join(TMP, 'a.txt');
    fs.writeFileSync(aFile, 'hello');

    await sealVersion({
      sealedBy: 'manual',
      entries: [{ virtualPath: 'a.txt', action: 'add', replacementFilePath: aFile, sha256: undefined }],
      label: 'v1',
    });

    const manifest = readManifest(STUDIO_DIR);
    expect(manifest.changesets).toHaveLength(1);
    const cs = manifest.changesets[0];

    // Pointer set to new node
    expect(manifest.activeVersionId).toBe(cs.id);
    // Root node: no parent
    expect(cs.parentId).toBeNull();
    // Delta recorded
    expect(cs.deltas).toHaveLength(1);
    expect(cs.deltas[0].storedFileRef).toBeDefined();
    // Bytes actually stored on disk
    const storedPath = path.join(
      STUDIO_DIR, 'changesets', cs.id, 'files', cs.deltas[0].storedFileRef!
    );
    expect(fs.existsSync(storedPath)).toBe(true);
    expect(fs.readFileSync(storedPath, 'utf8')).toBe('hello');
  });

  // ─── T2: Linear chain ─────────────────────────────────────────────────────
  it('T2: sealVersion twice → linear chain (v2.parentId === v1.id, activeVersionId = v2.id)', async () => {
    const aFile = path.join(TMP, 'a.txt');
    const bFile = path.join(TMP, 'b.txt');
    fs.writeFileSync(aFile, 'hello');
    fs.writeFileSync(bFile, 'world');

    await sealVersion({
      sealedBy: 'manual',
      entries: [{ virtualPath: 'a.txt', action: 'add', replacementFilePath: aFile, sha256: undefined }],
      label: 'v1',
    });
    const v1id = readManifest(STUDIO_DIR).activeVersionId!;

    await sealVersion({
      sealedBy: 'manual',
      entries: [
        { virtualPath: 'a.txt', action: 'add', replacementFilePath: aFile, sha256: undefined },
        { virtualPath: 'b.txt', action: 'add', replacementFilePath: bFile, sha256: undefined },
      ],
      label: 'v2',
    });

    const m2 = readManifest(STUDIO_DIR);
    expect(m2.changesets).toHaveLength(2);
    // v2 must point at v1 (linear chain)
    const v2 = m2.changesets.find(c => c.parentId === v1id);
    expect(v2).toBeDefined();
    expect(m2.activeVersionId).toBe(v2!.id);
  });

  // ─── T3: flatten accumulates last-writer-wins ──────────────────────────────
  it('T3: flatten(v2) accumulates root→v1→v2 deltas, last-writer-wins, sorted by virtualPath', async () => {
    const aFile = path.join(TMP, 'a.txt');
    const bFile = path.join(TMP, 'b.txt');
    fs.writeFileSync(aFile, 'hello');
    fs.writeFileSync(bFile, 'world');

    await sealVersion({
      sealedBy: 'manual',
      entries: [{ virtualPath: 'a.txt', action: 'add', replacementFilePath: aFile, sha256: undefined }],
      label: 'v1',
    });
    await sealVersion({
      sealedBy: 'manual',
      entries: [
        { virtualPath: 'a.txt', action: 'add', replacementFilePath: aFile, sha256: undefined },
        { virtualPath: 'b.txt', action: 'add', replacementFilePath: bFile, sha256: undefined },
      ],
      label: 'v2',
    });

    const m = readManifest(STUDIO_DIR);
    const v2id = m.activeVersionId!;
    const entries = flatten(v2id, m, STUDIO_DIR);

    // Both a.txt and b.txt present
    expect(entries).toHaveLength(2);
    // Canonical sort by virtualPath (D-04-08a)
    expect(entries[0].virtualPath).toBe('a.txt');
    expect(entries[1].virtualPath).toBe('b.txt');
    // Resolved replacementFilePaths exist on disk
    expect(entries[0].replacementFilePath).toBeDefined();
    expect(fs.existsSync(entries[0].replacementFilePath!)).toBe(true);
    expect(entries[1].replacementFilePath).toBeDefined();
    expect(fs.existsSync(entries[1].replacementFilePath!)).toBe(true);
  });

  // ─── T4: selectVersion materializes staging (B2 fix) ──────────────────────
  it('T4: selectVersion(v1) → activeVersionId=v1, changesets.length still 2 (non-destructive), staging = flatten(v1)', async () => {
    const aFile = path.join(TMP, 'a.txt');
    const bFile = path.join(TMP, 'b.txt');
    fs.writeFileSync(aFile, 'hello');
    fs.writeFileSync(bFile, 'world');

    await sealVersion({
      sealedBy: 'manual',
      entries: [{ virtualPath: 'a.txt', action: 'add', replacementFilePath: aFile, sha256: undefined }],
      label: 'v1',
    });
    const v1id = readManifest(STUDIO_DIR).activeVersionId!;

    await sealVersion({
      sealedBy: 'manual',
      entries: [
        { virtualPath: 'a.txt', action: 'add', replacementFilePath: aFile, sha256: undefined },
        { virtualPath: 'b.txt', action: 'add', replacementFilePath: bFile, sha256: undefined },
      ],
      label: 'v2',
    });

    // Rollback to v1 — materializes staging (B2 fix: not cosmetic pointer-only)
    // selectVersion calls useStagingStore.getState().restoreEntries(flatten(v1.id)) internally
    selectVersion(v1id);

    const m = readManifest(STUDIO_DIR);
    expect(m.activeVersionId).toBe(v1id);
    // v2 still present — history is append-only, never deleted
    expect(m.changesets.length).toBe(2); // length still 2 after rollback

    // Staging materialized to flatten(v1.id) — only a.txt, not b.txt
    // (restoreEntries replaces the staging list wholesale with the flattened version state)
    const stagingEntries = useStagingStore.getState().entries;
    expect(stagingEntries.some(e => e.virtualPath === 'a.txt')).toBe(true);
    // b.txt was only in v2 — absent from staging after rollback to v1
    expect(stagingEntries.some(e => e.virtualPath === 'b.txt')).toBe(false);
  });

  // ─── T5: BRANCH after rollback ────────────────────────────────────────────
  it('T5: sealVersion after selectVersion(v1) creates BRANCH — v3.parentId === v1.id, v2 intact', async () => {
    const aFile = path.join(TMP, 'a.txt');
    const bFile = path.join(TMP, 'b.txt');
    const cFile = path.join(TMP, 'c.txt');
    fs.writeFileSync(aFile, 'hello');
    fs.writeFileSync(bFile, 'world');
    fs.writeFileSync(cFile, 'branch');

    await sealVersion({
      sealedBy: 'manual',
      entries: [{ virtualPath: 'a.txt', action: 'add', replacementFilePath: aFile, sha256: undefined }],
      label: 'v1',
    });
    const v1id = readManifest(STUDIO_DIR).activeVersionId!;

    await sealVersion({
      sealedBy: 'manual',
      entries: [
        { virtualPath: 'a.txt', action: 'add', replacementFilePath: aFile, sha256: undefined },
        { virtualPath: 'b.txt', action: 'add', replacementFilePath: bFile, sha256: undefined },
      ],
      label: 'v2',
    });

    // Roll back to v1 — next seal branches from here (D-04-07 BRANCH model)
    selectVersion(v1id);

    await sealVersion({
      sealedBy: 'manual',
      entries: [
        { virtualPath: 'a.txt', action: 'add', replacementFilePath: aFile, sha256: undefined },
        { virtualPath: 'c.txt', action: 'add', replacementFilePath: cFile, sha256: undefined },
      ],
      label: 'v3-branch',
    });

    const m = readManifest(STUDIO_DIR);
    // All three nodes present
    expect(m.changesets).toHaveLength(3);
    const v3 = m.changesets.find(c => c.label === 'v3-branch');
    expect(v3).toBeDefined();
    // BRANCH: v3.parentId === v1.id (not v2.id — maintainer chose "branch the history")
    expect(v3!.parentId).toBe(v1id); // v3.parentId points to v1, confirming branch from v1
    // v2 still in changesets (non-destructive — D-04-08)
    expect(m.changesets.some(c => c.label === 'v2')).toBe(true);
  });

  // ─── T6: Independent branch paths ─────────────────────────────────────────
  it('T6: flatten on different branches returns independent paths (v2 not in v3 branch; v3 not in v2 branch)', async () => {
    const aFile = path.join(TMP, 'a.txt');
    const bFile = path.join(TMP, 'b.txt');
    const cFile = path.join(TMP, 'c.txt');
    fs.writeFileSync(aFile, 'hello');
    fs.writeFileSync(bFile, 'world');
    fs.writeFileSync(cFile, 'branch');

    await sealVersion({
      sealedBy: 'manual',
      entries: [{ virtualPath: 'a.txt', action: 'add', replacementFilePath: aFile, sha256: undefined }],
      label: 'v1',
    });
    const v1id = readManifest(STUDIO_DIR).activeVersionId!;

    await sealVersion({
      sealedBy: 'manual',
      entries: [
        { virtualPath: 'a.txt', action: 'add', replacementFilePath: aFile, sha256: undefined },
        { virtualPath: 'b.txt', action: 'add', replacementFilePath: bFile, sha256: undefined },
      ],
      label: 'v2',
    });
    const v2id = readManifest(STUDIO_DIR).activeVersionId!;

    // Branch from v1
    selectVersion(v1id);

    await sealVersion({
      sealedBy: 'manual',
      entries: [
        { virtualPath: 'a.txt', action: 'add', replacementFilePath: aFile, sha256: undefined },
        { virtualPath: 'c.txt', action: 'add', replacementFilePath: cFile, sha256: undefined },
      ],
      label: 'v3',
    });
    const m = readManifest(STUDIO_DIR);
    const v3id = m.activeVersionId!;

    // flatten(v3): root→v1→v3 path — a.txt + c.txt; b.txt NOT included
    const v3Entries = flatten(v3id, m, STUDIO_DIR);
    const v3Paths = v3Entries.map(e => e.virtualPath);
    expect(v3Paths).toContain('a.txt');
    expect(v3Paths).toContain('c.txt');
    expect(v3Paths).not.toContain('b.txt'); // b.txt is on the v2 branch, not the v3 branch

    // flatten(v2): root→v1→v2 path — a.txt + b.txt; c.txt NOT included
    const v2Entries = flatten(v2id, m, STUDIO_DIR);
    const v2Paths = v2Entries.map(e => e.virtualPath);
    expect(v2Paths).toContain('a.txt');
    expect(v2Paths).toContain('b.txt');
    expect(v2Paths).not.toContain('c.txt'); // c.txt is on the v3 branch, not the v2 branch
  });

  // ─── T7: Empty/dup guard (N4) ─────────────────────────────────────────────
  it('T7: sealVersion throws "Nothing new to commit" when entries match current version (N4 empty/dup guard)', async () => {
    const aFile = path.join(TMP, 'a.txt');
    fs.writeFileSync(aFile, 'hello');

    // First seal — succeeds
    await sealVersion({
      sealedBy: 'manual',
      entries: [{ virtualPath: 'a.txt', action: 'add', replacementFilePath: aFile, sha256: undefined }],
      label: 'v1',
    });

    // Second seal with identical entries — must throw (N4 empty/dup guard)
    await expect(
      sealVersion({
        sealedBy: 'manual',
        entries: [{ virtualPath: 'a.txt', action: 'add', replacementFilePath: aFile, sha256: undefined }],
        label: 'v1-dup',
      })
    ).rejects.toThrow('Nothing new to commit');
  });

  // ─── T8: Diff-vs-parent (R2-W3) ───────────────────────────────────────────
  it('T8: sealVersion stores DIFF-VS-PARENT only — unchanged b.txt excluded from deltas (R2-W3)', async () => {
    const aFile = path.join(TMP, 'a.txt');
    const bFile = path.join(TMP, 'b.txt');
    fs.writeFileSync(aFile, 'hello');
    fs.writeFileSync(bFile, 'world');

    // Seal v1 with {a.txt, b.txt}
    await sealVersion({
      sealedBy: 'manual',
      entries: [
        { virtualPath: 'a.txt', action: 'add', replacementFilePath: aFile, sha256: undefined },
        { virtualPath: 'b.txt', action: 'add', replacementFilePath: bFile, sha256: undefined },
      ],
      label: 'v1',
    });
    const v1id = readManifest(STUDIO_DIR).activeVersionId!;

    // Go back to v1 — staging = flatten(v1) = {a.txt, b.txt}
    selectVersion(v1id);

    // Modify only a.txt in staging; b.txt stays the same bytes
    const aModified = path.join(TMP, 'a_modified.txt');
    fs.writeFileSync(aModified, 'hello modified');
    useStagingStore.getState().addEntry({
      virtualPath: 'a.txt',
      action: 'add',
      replacementFilePath: aModified,
      sha256: undefined, // let sealVersion compute it from the file
    });

    // Seal v2 with current staging entries (a.txt changed, b.txt unchanged)
    await sealVersion({
      sealedBy: 'manual',
      entries: useStagingStore.getState().entries,
      label: 'v2',
    });

    const m = readManifest(STUDIO_DIR);
    const v2cs = m.changesets.find(c => c.label === 'v2')!;
    // DIFF-VS-PARENT: only a.txt changed — b.txt must NOT be in v2's deltas
    expect(v2cs.deltas).toHaveLength(1);
    expect(v2cs.deltas[0].virtualPath).toBe('a.txt');
  });
});
