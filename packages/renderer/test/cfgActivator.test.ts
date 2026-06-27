// @vitest-environment node
/**
 * cfgActivator.test.ts — cfg patch activation + W9 line-surgery deactivation (DEPLOY-02).
 *
 * Tests the activatePatch / deactivatePatch / ensureInclude functions.
 * Key focus: W9 fix — deactivatePatch MUST use line surgery (remove ONLY the specific
 * keyName= line), NOT restore the .bak file (which would drop ALL keys written after
 * the backup was taken, including shadow-base keys from the other deploy model).
 *
 * Tests:
 *   Test 6 — activatePatch: inserts correct searchTree key; existing keys preserved; backup created; no BOM
 *   Test 7 — deactivatePatch (W9): removes ONLY the specific keyName line; other keys intact
 *   Test 8 — ensureInclude: idempotent; adds exactly one .include line
 *   Test 9 — coexistence: two keys can coexist; deactivate removes only its own key
 *
 * Ground truth:
 *   swg-client-v2 ConfigFile.cpp (BOM-free utf8 write, .include syntax)
 *   W9 fix: deactivatePatch must NOT fs.copyFileSync(.bak, cfgPath) — that would drop
 *   unrelated keys from OTHER deploy models that were written after the backup was made.
 *
 * Source: 04-03-PLAN.md Task 3; 04-CONTEXT.md §D-04-10/12; 04-RESEARCH.md §Pattern 2.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync, existsSync, mkdtempSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

import { activatePatch, deactivatePatch, ensureInclude, snapshotCfg, restoreCfg } from '../src/services/cfgActivator.ts';
import type { SharedFileScan } from '../src/services/clientLocator.ts';

const __dirname_es = dirname(fileURLToPath(import.meta.url));

const TMP_BASE = join(tmpdir(), 'swg-cfgactivator-test');
let tmpDir: string;
let testCounter = 0;

beforeEach(() => {
  testCounter++;
  tmpDir = join(TMP_BASE, `t${testCounter}`);
  mkdirSync(tmpDir, { recursive: true });
});

// ─── Fixture helpers ──────────────────────────────────────────────────────────

function writeCfg(name: string, content: string): string {
  const filePath = join(tmpDir, name);
  writeFileSync(filePath, content, 'utf8');
  return filePath;
}

/** A minimal full-chain scan result for Infinity (mimics scanSharedFile on swgemu.cfg) */
const INFINITY_SCAN: SharedFileScan = {
  skuSuffix: '_00_',
  maxSearchPriority: 60,
  occupiedSlots: [30, 31, 32, 54],
};

/** A minimal scan with one entry (slot 10 occupied → slot 11 is next) */
const SINGLE_SLOT_SCAN: SharedFileScan = {
  skuSuffix: '_00_',
  maxSearchPriority: 60,
  occupiedSlots: [10],
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('cfgActivator DEPLOY-02', () => {
  it('Test 6: activatePatch — inserts searchTree key; existing keys preserved; backup created; no BOM', () => {
    // A minimal swgtoolkit.cfg with one existing key
    const FIXTURE_CONTENT = '[SharedFile]\r\n\tsearchTree_00_30=bottom.tre\r\n';
    const cfgPath = writeCfg('swgtoolkit.cfg', FIXTURE_CONTENT);

    const record = activatePatch(cfgPath, 'swgtoolkit_mymod_a3f7.tre', INFINITY_SCAN);

    const content = readFileSync(cfgPath, 'utf8');

    // Existing key must still be present (activatePatch does NOT overwrite)
    expect(content).toContain('searchTree_00_30=bottom.tre');

    // New key must be present at the next free slot (55 = max(30,31,32,54)+1)
    expect(content).toContain('searchTree_00_55=swgtoolkit_mymod_a3f7.tre');

    // No BOM (utf8 encoding, no BOM prefix)
    expect(content.charCodeAt(0)).not.toBe(0xFEFF);
    expect(content).not.toMatch(/^﻿/);

    // Backup file must exist
    expect(existsSync(record.backupPath)).toBe(true);

    // Record must have correct keyName and slot
    expect(record.keyName).toBe('searchTree_00_55');
    expect(record.slot).toBe(55);
  });

  it('Test 7: deactivatePatch (W9 line surgery) — removes ONLY its specific keyName line; other keys intact', () => {
    // This is the CRITICAL W9 test. The cfg has two keys from different deploy operations.
    // deactivatePatch must remove ONLY its own key, leaving the other key untouched.
    // The old approach (copyFileSync .bak → cfgPath) would drop ALL keys written after
    // the backup was taken — including the other deploy model's key.
    const FIXTURE_CONTENT =
      '[SharedFile]\r\n' +
      '\tmaxSearchPriority=60\r\n' +
      '\tsearchTree_00_55=swgtoolkit_mymod_a3f7.tre\r\n' +
      '\tsearchTree_00_56=swgtoolkit_other_b2e8.tre\r\n';
    const cfgPath = writeCfg('swgtoolkit.cfg', FIXTURE_CONTENT);

    // deactivatePatch removes searchTree_00_55 only (line surgery)
    deactivatePatch({
      cfgPath,
      includeTargetPath: '',
      keyName: 'searchTree_00_55',
      slot: 55,
      backupPath: cfgPath + '.swgtoolkit.bak',
      patchName: 'swgtoolkit_mymod_a3f7.tre',
    });

    const content = readFileSync(cfgPath, 'utf8');

    // W9: the OTHER key must still be present (not dropped by a .bak restore)
    expect(content).toContain('searchTree_00_56=swgtoolkit_other_b2e8.tre');

    // The removed key must be gone
    expect(content).not.toContain('searchTree_00_55=');
  });

  it('Test 8: ensureInclude — idempotent; calling twice adds exactly one .include line', () => {
    const FIXTURE_CONTENT = '[SharedFile]\r\n\tsearchTree_00_30=bottom.tre\r\n';
    const rootCfg = writeCfg('swgemu.cfg', FIXTURE_CONTENT);

    // First call: adds the .include line
    ensureInclude(rootCfg, 'swgtoolkit.cfg');
    const after1 = readFileSync(rootCfg, 'utf8');
    expect(after1).toContain('.include "swgtoolkit.cfg"');

    // Second call: idempotent — must NOT add a second .include line
    ensureInclude(rootCfg, 'swgtoolkit.cfg');
    const after2 = readFileSync(rootCfg, 'utf8');

    // Count occurrences of the .include line
    const matches = after2.match(/\.include\s+"swgtoolkit\.cfg"/g) ?? [];
    expect(matches.length).toBe(1);
  });

  it('Test 9: coexistence — two keys can coexist; deactivatePatch removes only its own key', () => {
    // Scenario: two separate activatePatch calls (e.g. one patch-prepend + one shadow-base key)
    // deactivatePatch for the first key must leave the second key intact.
    const FIXTURE_CONTENT = '[SharedFile]\r\n\tmaxSearchPriority=60\r\n';
    const cfgPath = writeCfg('swgtoolkit.cfg', FIXTURE_CONTENT);

    // First activation: slot 11
    const record1 = activatePatch(cfgPath, 'swgtoolkit_mod1_aaaa.tre', SINGLE_SLOT_SCAN);
    // Second activation: uses updated scan so slot 12 (next free after 10, 11)
    const scan2: SharedFileScan = {
      skuSuffix: '_00_',
      maxSearchPriority: 60,
      occupiedSlots: [10, record1.slot],
    };
    const record2 = activatePatch(cfgPath, 'swgtoolkit_mod2_bbbb.tre', scan2);

    // Both keys present
    let content = readFileSync(cfgPath, 'utf8');
    expect(content).toContain(record1.keyName + '=swgtoolkit_mod1_aaaa.tre');
    expect(content).toContain(record2.keyName + '=swgtoolkit_mod2_bbbb.tre');

    // Deactivate only record1 — record2 must survive
    deactivatePatch(record1);
    content = readFileSync(cfgPath, 'utf8');
    expect(content).not.toContain(record1.keyName + '=');
    expect(content).toContain(record2.keyName + '=swgtoolkit_mod2_bbbb.tre');
  });
});

// ─── DEPLOY-06 snapshot/restore + idempotent header + whitespace-free ────────
// RED: snapshotCfg and restoreCfg are not yet exported from cfgActivator.ts.
// These tests fail at import time (undefined) or at assertion for duplicate-header
// and then turn GREEN after Task 2 implements them.

describe('cfgActivator DEPLOY-06 snapshot/restore + idempotent header', () => {

  it('Test 10: snapshotCfg captures ROOT cfg byte-for-byte into .studio/snapshots', () => {
    // ROOT cfg content — pristine (no .include, no maxSearchPriority bump)
    const ROOT_CFG_CONTENT = '[SharedFile]\r\n\tmaxSearchPriority=60\r\n\tsearchTree_00_30=bottom.tre\r\n';
    const rootCfg = writeCfg('swgemu.cfg', ROOT_CFG_CONTENT);

    // studioDir simulates LOCALAPPDATA/swg-toolkit/studios/MyProject
    const studioDir = join(tmpDir, 'studio');
    mkdirSync(studioDir, { recursive: true });

    // RED: snapshotCfg is not yet exported — will throw "snapshotCfg is not a function"
    const snapshotPath = snapshotCfg(rootCfg, studioDir);

    // Snapshot must exist under .studio/snapshots/<basename>.bak
    expect(existsSync(snapshotPath)).toBe(true);
    expect(snapshotPath).toContain('snapshots');

    // Snapshot content must be byte-for-byte identical to the original
    const snapshotBytes = readFileSync(snapshotPath);
    const originalBytes = readFileSync(rootCfg);
    expect(Buffer.compare(snapshotBytes, originalBytes)).toBe(0);
  });

  it('Test 11: restoreCfg reproduces original ROOT cfg byte-for-byte (removes .include and bumps)', () => {
    // ROOT cfg content — pristine (no .include line, no extra bump)
    const ROOT_CFG_ORIGINAL = '[SharedFile]\r\n\tmaxSearchPriority=60\r\n\tsearchTree_00_30=bottom.tre\r\n';
    const rootCfg = writeCfg('swgemu.cfg', ROOT_CFG_ORIGINAL);

    const studioDir = join(tmpDir, 'studio');
    mkdirSync(studioDir, { recursive: true });

    // RED: snapshotCfg not yet exported
    const snapshotPath = snapshotCfg(rootCfg, studioDir);

    // Mutate: ensureInclude appends .include line (simulates what deploy does)
    ensureInclude(rootCfg, 'swgtoolkit.cfg');

    // Also add a maxSearchPriority bump (simulates what activatePatch might add)
    const afterInclude = readFileSync(rootCfg, 'utf8');
    writeFileSync(rootCfg, afterInclude + '[SharedFile]\r\n\tmaxSearchPriority=70\r\n');

    // Confirm it's now mutated
    const mutated = readFileSync(rootCfg, 'utf8');
    expect(mutated).toContain('.include "swgtoolkit.cfg"');
    expect(mutated).toContain('maxSearchPriority=70');

    // RED: restoreCfg not yet exported
    restoreCfg(rootCfg, snapshotPath);

    // After restore: byte-for-byte identical to the original
    const restored = readFileSync(rootCfg);
    const original = Buffer.from(ROOT_CFG_ORIGINAL, 'utf8');
    expect(Buffer.compare(restored, original)).toBe(0);

    // No .include line remains (byte-pristine restore removes it)
    const restoredText = readFileSync(rootCfg, 'utf8');
    expect(restoredText).not.toContain('.include');
    expect(restoredText).not.toContain('maxSearchPriority=70');
  });

  it('Test 12: two consecutive activatePatch calls yield exactly ONE [SharedFile] header (idempotent header)', () => {
    // Create an EMPTY toolkit cfg (Pitfall 4 — toolkit cfg is empty; activatePatch adds the header)
    const cfgPath = writeCfg('swgtoolkit.cfg', '');

    const scan1: SharedFileScan = {
      skuSuffix: '_00_',
      maxSearchPriority: 60,
      occupiedSlots: [],
    };
    const record1 = activatePatch(cfgPath, 'patch1.tre', scan1);

    const scan2: SharedFileScan = {
      skuSuffix: '_00_',
      maxSearchPriority: 60,
      occupiedSlots: [record1.slot],
    };
    activatePatch(cfgPath, 'patch2.tre', scan2);

    const content = readFileSync(cfgPath, 'utf8');

    // RED: current code adds [SharedFile] unconditionally on each call → 2 headers
    // Count [SharedFile] occurrences excluding comment lines
    const headerMatches = content
      .split(/\r?\n/)
      .filter((line) => line.trim() === '[SharedFile]')
      .length;

    // EXPECTED (after Task 2 idempotent fix): exactly ONE [SharedFile] header
    expect(headerMatches).toBe(1);

    // Both searchTree keys must be present
    expect(content).toContain('patch1.tre');
    expect(content).toContain('patch2.tre');
  });

  it('Test 13: absolute-path patchName writes a whitespace-free searchTree= value in the cfg', () => {
    // When deploy model is absolute-path, patchName is an absolute path from getStudioDir
    // (which is now whitespace-free per D-06 relocation to LOCALAPPDATA/swg-toolkit/studios/<id>)
    const studioDir = join(tmpDir, 'studio');
    const absolutePatchPath = join(studioDir, 'build', 'swgtoolkit_mymod_a3f7.tre');
    // Note: tmpDir typically has no spaces (OS temp dir)

    const cfgPath = writeCfg('swgtoolkit.cfg', '');
    const scan: SharedFileScan = {
      skuSuffix: '_00_',
      maxSearchPriority: 60,
      occupiedSlots: [],
    };

    activatePatch(cfgPath, absolutePatchPath, scan);

    const content = readFileSync(cfgPath, 'utf8');

    // Find the searchTree= line and verify its value has no whitespace
    const searchTreeLine = content
      .split(/\r?\n/)
      .find((line) => line.trim().startsWith('searchTree'));

    expect(searchTreeLine).toBeTruthy();
    const eqIdx = searchTreeLine!.indexOf('=');
    const value = searchTreeLine!.slice(eqIdx + 1).trim();
    // Value should be the absolute path with no embedded whitespace
    expect(value).toBe(absolutePatchPath);
    expect(/\s/.test(value)).toBe(false);
  });

  it('Test 14: snapshotCfg is idempotent — second deploy does NOT overwrite snapshot (protects pristine backup)', () => {
    const ROOT_CFG_ORIGINAL = '[SharedFile]\r\n\tmaxSearchPriority=60\r\n';
    const rootCfg = writeCfg('swgemu.cfg', ROOT_CFG_ORIGINAL);

    const studioDir = join(tmpDir, 'studio');
    mkdirSync(studioDir, { recursive: true });

    // RED: snapshotCfg not yet exported
    const snap1 = snapshotCfg(rootCfg, studioDir);
    const mtime1 = require('node:fs').statSync(snap1).mtimeMs;

    // Mutate root cfg (simulates first deploy)
    ensureInclude(rootCfg, 'swgtoolkit.cfg');

    // Second snapshotCfg call — must NOT overwrite the existing snapshot
    const snap2 = snapshotCfg(rootCfg, studioDir);
    const mtime2 = require('node:fs').statSync(snap2).mtimeMs;

    // Same snapshot path returned
    expect(snap2).toBe(snap1);
    // mtime should be unchanged (snapshot not overwritten)
    expect(mtime2).toBe(mtime1);

    // Snapshot still contains original content (NOT the mutated .include version)
    const snapContent = readFileSync(snap1, 'utf8');
    expect(snapContent).not.toContain('.include');
  });
});

