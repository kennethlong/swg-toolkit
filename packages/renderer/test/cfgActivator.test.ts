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
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

import { activatePatch, deactivatePatch, ensureInclude } from '../src/services/cfgActivator.ts';
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
