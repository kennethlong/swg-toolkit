/**
 * resolve.test.ts — Engine hook point resolver tests (Plan 03-02 GREEN).
 *
 * Exercises the C++ resolver via LookupByNameInTable, ResolveFromSyntheticTable,
 * ResolveFromExe, and IsAdvertisedClient N-API exports without a live SWG client.
 *
 * All tests use a synthetic EngineHookPoints table (in-process JS array) so
 * no SWGClient.exe is required.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import path from 'node:path';

const LIVE_INJECT_DIR = path.resolve(__dirname, '..');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let addon: any;

beforeAll(() => {
  // Load the built host N-API addon (build/Release/swg_live_inject.node).
  // Run `pnpm --filter @swg/live-inject build` first if this throws.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const nodegypbuild = require('node-gyp-build');
  addon = nodegypbuild(LIVE_INJECT_DIR);
});

type TableEntry = { name: string; addr: number };

// ============================================================
// name-keyed resolve — synthetic EngineHookPoints table
// ============================================================

describe('name-keyed resolve — synthetic EngineHookPoints table', () => {
  it('resolves a known name to the correct address', () => {
    const table: TableEntry[] = [
      { name: 'game::getPlayer',          addr: 0x00425140 },
      { name: 'object::getTransform_o2w', addr: 0x00B22C80 },
    ];
    expect(addon.lookupByNameInTable(table, 'game::getPlayer')).toBe(0x00425140);
  });

  it('resolves object::getTransform_o2w to 0x00B22C80', () => {
    const table: TableEntry[] = [
      { name: 'object::getTransform_o2w', addr: 0x00B22C80 },
    ];
    expect(addon.lookupByNameInTable(table, 'object::getTransform_o2w')).toBe(0x00B22C80);
  });

  it('returns null for a nonexistent name (graceful — no crash, no null-slot)', () => {
    const table: TableEntry[] = [
      { name: 'game::getPlayer', addr: 0x00425140 },
    ];
    expect(addon.lookupByNameInTable(table, 'nonexistent::fn')).toBeNull();
  });

  it('returns null for an empty table (null-safe path)', () => {
    const table: TableEntry[] = [];
    expect(addon.lookupByNameInTable(table, 'game::getPlayer')).toBeNull();
  });
});

// ============================================================
// version mismatch is soft
// ============================================================

describe('version mismatch is soft', () => {
  it('still resolves by name when version differs from ENGINE_HOOKPOINTS_VERSION', () => {
    // ENGINE_HOOKPOINTS_VERSION = 6; pass 999 to trigger the soft-warning path.
    // The resolver must still return the address (never abort on version drift).
    const table: TableEntry[] = [
      { name: 'object::getTransform_o2w', addr: 0x00B22C80 },
    ];
    const result = addon.resolveFromSyntheticTable(
      table,
      'object::getTransform_o2w',
      999,  // wrong version — soft warning only
    );
    expect(result).toBe(0x00B22C80);
  });

  it('resolves correctly at the exact ENGINE_HOOKPOINTS_VERSION (6)', () => {
    const table: TableEntry[] = [
      { name: 'game::getPlayer', addr: 0x00425140 },
    ];
    const result = addon.resolveFromSyntheticTable(table, 'game::getPlayer', 6);
    expect(result).toBe(0x00425140);
  });
});

// ============================================================
// isAdvertisedClient detection
// ============================================================

describe('isAdvertisedClient detection', () => {
  it('resolveFromSyntheticTable sets isAdvertisedClient to true (simulates advertised path)', () => {
    // Providing a valid synthetic table simulates the advertised-client path.
    const table: TableEntry[] = [{ name: 'game::getPlayer', addr: 0x00425140 }];
    addon.resolveFromSyntheticTable(table, 'game::getPlayer');
    expect(addon.isAdvertisedClient()).toBe(true);
  });

  it('returns false when GetEngineHookPoints export is absent (node.exe — SWGEmu legacy path)', () => {
    // resolveFromExe() in the node.exe context: GetEngineHookPoints is NOT present
    // in node.exe, so it must return false and set isAdvertisedClient() = false.
    // This exercises the STRICT NO-OP path (D-00) for the legacy SWGEmu client.
    const found = addon.resolveFromExe();
    expect(found).toBe(false);
    expect(addon.isAdvertisedClient()).toBe(false);
  });
});
