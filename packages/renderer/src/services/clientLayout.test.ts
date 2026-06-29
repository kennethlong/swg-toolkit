// @vitest-environment node
/**
 * packages/renderer/src/services/clientLayout.test.ts
 * D-13: release-pattern table + manual-override tests.
 *
 * RED gate for Task 1 of 04.1-09-PLAN.md.
 *
 * Tests:
 *   (a) Infinity-style dir (Live/ + swgemu.cfg) → resolveLayout returns treSubdir 'Live'
 *   (b) SWGEmu-style dir  (root TREs + swgemu.cfg) → treSubdir ''
 *   (c) Unclassifiable dir (cfg present, no .tre)   → null (caller shows manual-override UI)
 *   (d) ClientLayout type usable for manual override (round-trip)
 *
 * Ground truth: 04.1-RESEARCH.md §Pattern 3 (table seed + resolver behavior);
 *               04.1-PATTERNS.md §clientLayout.ts
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { buildFakeClientDir } from '../../test/fixtures/fakeClientDir';
import { resolveLayout, type ClientLayout } from './clientLayout';

// ---------------------------------------------------------------------------
// Temp dir setup (fresh per test)
// ---------------------------------------------------------------------------

const TMP_BASE = join(tmpdir(), 'swg-clientlayout-test');
let testCounter = 0;
let tmpDir: string;

beforeEach(() => {
  testCounter++;
  tmpDir = join(TMP_BASE, `t${testCounter}`);
  mkdirSync(tmpDir, { recursive: true });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('resolveLayout D-13 release-pattern table', () => {
  it('(a) Infinity-style dir: Live/ + swgemu.cfg → layout with treSubdir "Live"', () => {
    // SWG Infinity: cfg at root, TREs inside Live/ subdir, maxSearchPriority=60
    buildFakeClientDir(tmpDir, {
      treSubdir:         'Live',
      cfgFile:           'swgemu.cfg',
      maxSearchPriority: 60,
    });

    const layout = resolveLayout(tmpDir);

    expect(layout).not.toBeNull();
    expect(layout!.cfgFile).toBe('swgemu.cfg');
    expect(layout!.treSubdir).toBe('Live');
    expect(layout!.release).toBe('SWG Infinity');
    expect(layout!.maxSearchPriority).toBe(60);
  });

  it('(b) SWGEmu-style dir: root TREs + swgemu.cfg → layout with treSubdir ""', () => {
    // SWGEmu: cfg at root, TREs also at root (no Live/ subdir), maxSearchPriority=27
    buildFakeClientDir(tmpDir, {
      treSubdir:         '',
      cfgFile:           'swgemu.cfg',
      maxSearchPriority: 27,
    });

    const layout = resolveLayout(tmpDir);

    expect(layout).not.toBeNull();
    expect(layout!.cfgFile).toBe('swgemu.cfg');
    expect(layout!.treSubdir).toBe('');
    expect(layout!.release).toBe('SWGEmu');
    expect(layout!.maxSearchPriority).toBe(27);
  });

  it('(c) unclassifiable dir: cfg present but no .tre → null (shows manual-override UI)', () => {
    // cfg present, Live/ dir present but EMPTY — no .tre files anywhere
    // resolveLayout must return null so the caller can surface the manual-override UI
    mkdirSync(join(tmpDir, 'Live'), { recursive: true });
    writeFileSync(join(tmpDir, 'swgemu.cfg'), '[SharedFile]\nmaxSearchPriority=60\n', 'utf8');
    // (no .tre files written)

    const layout = resolveLayout(tmpDir);

    expect(layout).toBeNull();
  });

  it('(d) ClientLayout type is usable for manual override (round-trip)', () => {
    // Simulates the wizard collecting user-entered cfgFile + treSubdir.
    // A ClientLayout is the canonical carrier for both auto-detected AND manual layouts;
    // the caller persists it via initProject({ manualLayout }) without type changes.
    const manualOverride: ClientLayout = {
      release:           'manual',
      cfgFile:           'client.cfg',
      treSubdir:         'GameFiles',
      maxSearchPriority: 45,
    };

    // Round-trip: every field survives construction
    expect(manualOverride.release).toBe('manual');
    expect(manualOverride.cfgFile).toBe('client.cfg');
    expect(manualOverride.treSubdir).toBe('GameFiles');
    expect(manualOverride.maxSearchPriority).toBe(45);
  });

  // ---------------------------------------------------------------------------
  // Wave-0 extensions — RED until Plan 02 adds the client.cfg row + treDirFromCfg logic
  // ---------------------------------------------------------------------------

  /**
   * (e) swg-client-v2 style: client.cfg present, ZERO .tre files → 'swg-client-v2' layout.
   * RED until Plan 02 adds the { release:'swg-client-v2', cfgFile:'client.cfg', treDirFromCfg:true }
   * row to KNOWN_LAYOUTS and updates resolveLayout to skip the local .tre check for this row.
   *
   * CLIENT-02: decoupled client (no co-located .tre) must be auto-classifiable by toolkit.
   */
  it('(e) client.cfg + ZERO .tre files → resolveLayout returns swg-client-v2 with treDirFromCfg=true', () => {
    // Write only client.cfg — NO .tre files anywhere in the dir
    writeFileSync(join(tmpDir, 'client.cfg'), '[SharedFile]\nmaxSearchPriority=12\n', 'utf8');
    // Intentionally do NOT create any .tre files

    const layout = resolveLayout(tmpDir);

    // RED: resolveLayout returns null because KNOWN_LAYOUTS has no client.cfg row yet.
    // After Plan 02 adds the row, layout should be non-null with these fields:
    expect(layout).not.toBeNull();
    expect(layout!.release).toBe('swg-client-v2');
    expect(layout!.cfgFile).toBe('client.cfg');
    expect(layout!.treDirFromCfg).toBe(true);
    expect(layout!.maxSearchPriority).toBe(12);
  });

  /**
   * (f) Regression: existing SWG Infinity and SWGEmu layouts still classify identically
   * after the swg-client-v2 row is added to KNOWN_LAYOUTS.
   *
   * This test re-checks tests (a) and (b) using fresh temp dirs to confirm the probe order
   * (Infinity → SWGEmu → client.cfg) doesn't accidentally classify legacy installs as client.cfg.
   */
  it('(f) regression: Infinity + SWGEmu layouts still classify correctly after KNOWN_LAYOUTS extension', () => {
    // Sub-temp dirs for independent fixtures
    const infinityDir = join(tmpDir, 'infinity');
    const swgemuDir   = join(tmpDir, 'swgemu');
    mkdirSync(infinityDir, { recursive: true });
    mkdirSync(swgemuDir, { recursive: true });

    buildFakeClientDir(infinityDir, {
      treSubdir:         'Live',
      cfgFile:           'swgemu.cfg',
      maxSearchPriority: 60,
    });
    buildFakeClientDir(swgemuDir, {
      treSubdir:         '',
      cfgFile:           'swgemu.cfg',
      maxSearchPriority: 27,
    });

    const infinityLayout = resolveLayout(infinityDir);
    const swgemuLayout   = resolveLayout(swgemuDir);

    expect(infinityLayout).not.toBeNull();
    expect(infinityLayout!.release).toBe('SWG Infinity');
    expect(infinityLayout!.treSubdir).toBe('Live');

    expect(swgemuLayout).not.toBeNull();
    expect(swgemuLayout!.release).toBe('SWGEmu');
    expect(swgemuLayout!.treSubdir).toBe('');
  });
});
