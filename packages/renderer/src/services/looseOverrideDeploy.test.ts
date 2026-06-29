// @vitest-environment node
/**
 * packages/renderer/src/services/looseOverrideDeploy.test.ts
 * Wave-0 RED gate for looseOverrideDeploy (Plan 04).
 *
 * All tests import from './looseOverrideDeploy' — the module does NOT exist yet.
 * Every test fails with "Cannot find module" until Plan 04 implements it.
 *
 * Test inventory:
 *   (a) resolveOverrideDir returns max-priority searchPath (priority 10 from live cfg fixture)
 *   (b) deployLoose writes <overrideDir>/<virtualPath> from replacementFilePath
 *   (c) deployLoose rejects path-traversal virtualPath '../outside.dds'
 *   (d) deployLoose rejects drive-relative virtualPath 'C:foo' (isVirtualPathSafe tightened)
 *   (e) confinement check: prefix-collision virtualPath (resolves outside overrideDir) rejected
 *   (f) B3 sha256 restore: resetLoose RESTORES pre-existing file bytes (not deletes)
 *   (g) H2 cross-deploy prune: second deploy omitting B.dds removes B.dds, keeps A.dds
 *
 * Ground truth: 04.2-RESEARCH.md §DEEPENED A5 + §Capability 3 + crew review B3/H2.
 * Threat model: T-04.2-01 (path safety), T-04.2-02 (restore), T-04.2-03 (correct dir selection).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';

// This import FAILS until Plan 04 — this is the RED gate.
import { resolveOverrideDir, deployLoose, resetLoose } from './looseOverrideDeploy';

// ---------------------------------------------------------------------------
// Fixture paths
// ---------------------------------------------------------------------------

/**
 * Byte-exact text oracle of the live swg-client-v2 [SharedFile] cfg block.
 * Contains maxSearchPriority=12, three searchPath entries at priorities 5, 9, 10.
 * The expected override dir = searchPath_00_10 (priority 10 = highest).
 */
const SHARED_FILE_CFG = path.resolve(
  __dirname,
  '../test/fixtures/swg-client-v2-sharedfile.cfg',
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sha256(filePath: string): string {
  const bytes = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

// ---------------------------------------------------------------------------
// Temp-dir setup
// ---------------------------------------------------------------------------

let overrideDir: string;
beforeEach(() => {
  overrideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'swg-override-test-'));
});
afterEach(() => {
  fs.rmSync(overrideDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('looseOverrideDeploy', () => {
  /**
   * (a) resolveOverrideDir returns the MAX-priority searchPath.
   * The swg-client-v2-sharedfile.cfg has three searchPath entries:
   *   searchPath_00_5  = ".../ilm_extract"   (priority 5)
   *   searchPath_00_9  = ".../SWGSource..."   (priority 9)
   *   searchPath_00_10 = ".../stage/override" (priority 10 — MUST be selected)
   *
   * T-04.2-03: picking _00_9 would deploy into the shared data root — catastrophic.
   */
  it('(a) resolveOverrideDir returns searchPath_00_10 (priority 10 > 9 > 5)', () => {
    const overrideDirPath = resolveOverrideDir(SHARED_FILE_CFG);
    // Must end with the stage/override path (priority 10), NOT ilm_extract or SWGSource root
    expect(overrideDirPath).toContain('stage/override');
    expect(overrideDirPath).not.toContain('ilm_extract');
    expect(overrideDirPath).not.toContain('SWGSource');
  });

  /**
   * (b) deployLoose writes <overrideDir>/<virtualPath> from replacementFilePath.
   */
  it('(b) deployLoose writes file at <overrideDir>/<virtualPath>', () => {
    // Create a replacement file
    const srcFile = path.join(overrideDir, '_source.dds');
    fs.writeFileSync(srcFile, Buffer.from('DDS_DATA_01'));

    const staged = [
      {
        virtualPath: 'texture/test.dds',
        action: 'add' as const,
        replacementFilePath: srcFile,
      },
    ];
    const record = deployLoose(staged, overrideDir);
    const destPath = path.join(overrideDir, 'texture', 'test.dds');
    expect(fs.existsSync(destPath)).toBe(true);
    expect(fs.readFileSync(destPath).toString()).toBe('DDS_DATA_01');
    expect(record.writtenFiles.length).toBe(1);
    expect(record.writtenFiles[0].virtualPath).toBe('texture/test.dds');
    expect(record.writtenFiles[0].preExisted).toBe(false);
  });

  /**
   * (c) deployLoose rejects path-traversal virtualPaths.
   * T-04.2-01: ../outside.dds and ..\outside must be rejected before any fs operation.
   */
  it('(c) deployLoose throws on path-traversal virtualPath "../outside.dds"', () => {
    const srcFile = path.join(overrideDir, '_source.dds');
    fs.writeFileSync(srcFile, Buffer.from('X'));
    expect(() =>
      deployLoose([{ virtualPath: '../outside.dds', action: 'add', replacementFilePath: srcFile }], overrideDir),
    ).toThrow();
  });

  it('(c) deployLoose throws on path-traversal virtualPath "..\\\\outside"', () => {
    const srcFile = path.join(overrideDir, '_source.dds');
    fs.writeFileSync(srcFile, Buffer.from('X'));
    expect(() =>
      deployLoose([{ virtualPath: '..\\outside', action: 'add', replacementFilePath: srcFile }], overrideDir),
    ).toThrow();
  });

  /**
   * (d) deployLoose rejects drive-relative virtualPaths like 'C:foo'.
   * T-04.2-01 (MED): isVirtualPathSafe must reject ^[A-Za-z]: (drive-relative without slash).
   * The existing validator only rejects ^[A-Za-z]:[/\\]; Plan 04 tightens it to ^[A-Za-z]:.
   */
  it('(d) deployLoose throws on drive-relative virtualPath "C:foo"', () => {
    const srcFile = path.join(overrideDir, '_source.dds');
    fs.writeFileSync(srcFile, Buffer.from('X'));
    expect(() =>
      deployLoose([{ virtualPath: 'C:foo', action: 'add', replacementFilePath: srcFile }], overrideDir),
    ).toThrow();
  });

  /**
   * (e) Confinement check: virtualPath that resolves outside overrideDir is rejected.
   * T-04.2-01 (MED): dest.startsWith(resolve(root) + path.sep) — trailing-sep form prevents
   * prefix-collision (e.g. overrideDir_evil/file would pass a bare startsWith(root) check).
   */
  it('(e) deployLoose throws when resolved dest is outside overrideDir (prefix collision)', () => {
    // Create a sibling dir that STARTS WITH the overrideDir name (prefix collision)
    const evilDir = overrideDir + '_evil';
    fs.mkdirSync(evilDir, { recursive: true });
    const srcFile = path.join(overrideDir, '_source.dds');
    fs.writeFileSync(srcFile, Buffer.from('X'));

    // Construct a relative path that traverses OUT via a symbolic name.
    // The confinement check must catch this even if isVirtualPathSafe passes.
    // Note: the exact virtualPath that triggers this depends on the impl;
    // using a null-byte or unicode trick is a secondary guard.
    // The primary guard: dest.startsWith(resolve(root) + sep) not just startsWith(root).
    // This test uses a crafted relative path that resolves outside:
    // e.g. virtualPath = '../' + path.basename(evilDir) + '/file'
    const escapeVP = '../' + path.basename(evilDir) + '/file.dds';
    expect(() =>
      deployLoose([{ virtualPath: escapeVP, action: 'add', replacementFilePath: srcFile }], overrideDir),
    ).toThrow();

    fs.rmSync(evilDir, { recursive: true, force: true });
  });

  /**
   * (f) B3 sha256 restore: resetLoose RESTORES pre-existing file (not deletes it).
   * T-04.2-02: snapshot written before overwrite; restored on reset.
   *
   * Flow:
   *   1. Write original bytes to <overrideDir>/texture/test.dds  → sha256_A
   *   2. deployLoose with replacement bytes                       → preExisted=true
   *   3. resetLoose(record)                                       → RESTORES from snapshot
   *   4. sha256(<overrideDir>/texture/test.dds) must equal sha256_A
   */
  it('(f) B3 sha256: resetLoose RESTORES pre-existing file — sha256 matches original', () => {
    // Step 1: create pre-existing file
    const destPath = path.join(overrideDir, 'texture', 'test.dds');
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    const originalBytes = Buffer.from('ORIGINAL_BYTES_KNOWN');
    fs.writeFileSync(destPath, originalBytes);
    const sha256Before = sha256(destPath);

    // Step 2: deploy a replacement
    const srcFile = path.join(overrideDir, '_replacement.dds');
    fs.writeFileSync(srcFile, Buffer.from('REPLACEMENT_BYTES_DIFFERENT'));
    const record = deployLoose(
      [{ virtualPath: 'texture/test.dds', action: 'modify', replacementFilePath: srcFile }],
      overrideDir,
    );
    expect(record.writtenFiles[0].preExisted).toBe(true);
    expect(record.writtenFiles[0].snapshotPath).toBeDefined();
    // File should now contain replacement bytes
    expect(fs.readFileSync(destPath).toString()).not.toBe('ORIGINAL_BYTES_KNOWN');

    // Step 3: reset — MUST restore the original file, not delete it
    resetLoose(record);

    // Step 4: verify restoration
    expect(fs.existsSync(destPath)).toBe(true);
    const sha256After = sha256(destPath);
    expect(sha256After).toBe(sha256Before);
  });

  /**
   * (g) H2 cross-deploy prune: second deploy omitting a prior file cleans it up.
   * Deploy {A.dds, B.dds} first, then deploy {A.dds} only with priorRecord.
   * After the second deploy: A.dds present, B.dds gone (no orphan).
   */
  it('(g) H2 cross-deploy prune: B.dds removed after second deploy omits it', () => {
    const srcA = path.join(overrideDir, '_src_a.dds');
    const srcB = path.join(overrideDir, '_src_b.dds');
    fs.writeFileSync(srcA, Buffer.from('A_DATA'));
    fs.writeFileSync(srcB, Buffer.from('B_DATA'));

    // First deploy: A + B
    const firstRecord = deployLoose(
      [
        { virtualPath: 'texture/a.dds', action: 'add', replacementFilePath: srcA },
        { virtualPath: 'texture/b.dds', action: 'add', replacementFilePath: srcB },
      ],
      overrideDir,
    );
    expect(fs.existsSync(path.join(overrideDir, 'texture', 'a.dds'))).toBe(true);
    expect(fs.existsSync(path.join(overrideDir, 'texture', 'b.dds'))).toBe(true);

    // Second deploy: A only, passing firstRecord as priorRecord to enable prune
    deployLoose(
      [{ virtualPath: 'texture/a.dds', action: 'modify', replacementFilePath: srcA }],
      overrideDir,
      { priorRecord: firstRecord },
    );

    // A.dds still present, B.dds pruned (no longer in the second deploy's set)
    expect(fs.existsSync(path.join(overrideDir, 'texture', 'a.dds'))).toBe(true);
    expect(fs.existsSync(path.join(overrideDir, 'texture', 'b.dds'))).toBe(false);
  });
});
