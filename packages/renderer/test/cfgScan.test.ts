// @vitest-environment node
/**
 * cfgScan.test.ts — Full .include chain scan + LAST-wins maxSearchPriority tests (DEPLOY-02).
 *
 * Tests the B1 fix in scanSharedFile: must walk the FULL .include chain, not just the
 * root file. Uses LAST-wins for maxSearchPriority per ConfigFile.cpp:797 (N5 fix).
 *
 * Tests:
 *   Test 1 — Multi-include chain: occupiedSlots includes entries from BOTH files
 *   Test 2 — LAST-wins maxSearchPriority: included file's value overwrites root's value
 *   Test 3 — chooseSlot: correct next-free slot above max occupied
 *   Test 4 — No SharedFile section: default maxSearchPriority=20, occupiedSlots=[]
 *   Test 5 — Circular include guard: no infinite loop
 *
 * Ground truth:
 *   swg-client-v2 ConfigFile.cpp:797 (LAST-wins maxSearchPriority assignment)
 *   swg-client-v2 TreeFile.cpp:90-191 (searchTree_<sku>_<priority>= key format)
 *   swg-client-v2 ConfigFile.cpp:359-518 (.include directive processing)
 *
 * Source: 04-03-PLAN.md Task 3; 04-CONTEXT.md §B1; 04-RESEARCH.md §Pattern 2.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

import { scanSharedFile, chooseSlot } from '../src/services/clientLocator.ts';

const __dirname_es = dirname(fileURLToPath(import.meta.url));

// Temp dir for fixture .cfg files (fresh per test)
const TMP_BASE = join(tmpdir(), 'swg-cfgscan-test');

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

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('cfgScan DEPLOY-02', () => {
  it('Test 1: multi-include chain — occupiedSlots includes entries from BOTH root and included file', () => {
    // B1 fix: scanSharedFile must follow .include directives and merge ALL entries
    // from the full chain, not just the root file.
    const liveCfg = writeCfg('swgemu_live.cfg',
      '[SharedFile]\r\n' +
      '\tmaxSearchPriority=60\r\n' +
      '\tsearchTree_00_30=live30.tre\r\n' +
      '\tsearchTree_00_54=live54.tre\r\n'
    );

    const rootCfg = writeCfg('swgemu.cfg',
      '[SharedFile]\r\n' +
      '\tmaxSearchPriority=20\r\n' +
      '\tsearchTree_00_10=bottom.tre\r\n' +
      '.include "swgemu_live.cfg"\r\n'
    );

    const scan = scanSharedFile(rootCfg);

    // Must include entries from BOTH the root (slot 10) and the included file (slots 30, 54)
    expect(scan.occupiedSlots).toContain(10);
    expect(scan.occupiedSlots).toContain(30);
    expect(scan.occupiedSlots).toContain(54);
    expect(scan.occupiedSlots.length).toBeGreaterThanOrEqual(3);
  });

  it('Test 2: LAST-wins maxSearchPriority — included file\'s value overwrites root\'s value', () => {
    // N5 fix: ConfigFile.cpp:797 assigns each new maxSearchPriority value, so the LAST
    // value seen across the full chain wins. This is NOT first-wins.
    // Infinity chain: root has maxSearchPriority=20, included file has maxSearchPriority=60.
    // Result must be 60 (the value from the LAST file that sets it).
    const liveCfg = writeCfg('swgemu_live.cfg',
      '[SharedFile]\r\n' +
      '\tmaxSearchPriority=60\r\n' +
      '\tsearchTree_00_30=live1.tre\r\n'
    );

    const rootCfg = writeCfg('swgemu.cfg',
      '[SharedFile]\r\n' +
      '\tmaxSearchPriority=20\r\n' +
      '.include "swgemu_live.cfg"\r\n'
    );

    const scan = scanSharedFile(rootCfg);

    // LAST-wins: included file's maxSearchPriority=60 overwrites root's 20
    expect(scan.maxSearchPriority).toBe(60);
  });

  it('Test 3: chooseSlot returns max(occupiedSlots)+1 — slot 55 for Infinity (slots 30-54 occupied)', () => {
    // With the B1 fix, chooseSlot always receives a full-chain scan.
    // For Infinity (slots 30-54 occupied), next free slot is 55.
    const scan = {
      skuSuffix: '_00_',
      maxSearchPriority: 60,
      occupiedSlots: [30, 31, 54],
    };

    expect(chooseSlot(scan)).toBe(55);
  });

  it('Test 4: cfg with no [SharedFile] section → default maxSearchPriority=20, occupiedSlots=[]', () => {
    // An empty or non-SharedFile cfg yields defaults — no crash, no slots.
    const rootCfg = writeCfg('empty.cfg',
      '[ClientGame]\r\n' +
      '\tsceneDirectory=scenes\r\n'
    );

    const scan = scanSharedFile(rootCfg);

    expect(scan.maxSearchPriority).toBe(20);  // default
    expect(scan.occupiedSlots).toEqual([]);
    expect(scan.skuSuffix).toBe('_00_');       // default
  });

  it('Test 5: circular include guard — self-including cfg causes no infinite loop', () => {
    // A cfg that includes itself should not hang. The visited Set prevents re-processing.
    // The scan returns whatever entries it found before hitting the cycle.
    const selfCfg = writeCfg('self.cfg',
      '[SharedFile]\r\n' +
      '\tmaxSearchPriority=30\r\n' +
      '\tsearchTree_00_10=file.tre\r\n' +
      '.include "self.cfg"\r\n'  // includes itself
    );

    // Must complete without hanging or throwing
    const scan = scanSharedFile(selfCfg);

    // Should have found the entries before the cycle
    expect(scan.maxSearchPriority).toBe(30);
    expect(scan.occupiedSlots).toContain(10);
  });
});
