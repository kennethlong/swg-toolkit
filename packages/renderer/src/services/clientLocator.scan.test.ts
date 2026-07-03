// @vitest-environment node
/**
 * packages/renderer/src/services/clientLocator.scan.test.ts
 * Content-based client detection — scanForClients finds installs by their .tre files,
 * regardless of folder name (client-detection-and-layout-model.md).
 *
 * Ground truth (real disk probe 2026-07): the .tre + cfg dir is often a SUBDIR whose
 * parent is the distro name, and the cfg filename / folder name vary per distro:
 *   • SWG Infinity   → …\SWG Infinity\SWG Infinity\Live  (swgemu.cfg + tre in Live/)
 *   • SWGEmu         → …\SWGEmu-Client\SWGEmu            (swgemu.cfg + tre at root)
 *   • EmpireInFlames → C:\EmpireInFlames                 (swgemu.cfg + tre at root)
 *   • SWG Beyond     → …\SWG Beyond\Win64                (client.cfg + tre in Win64/)
 *
 * These tests are Windows-only (scanForClients guards process.platform === 'win32').
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { buildFakeClientDir } from '../../test/fixtures/fakeClientDir';
import { scanForClients } from './clientLocator';

const WIN = process.platform === 'win32';

const TMP_BASE = join(tmpdir(), 'swg-clientscan-test');
let counter = 0;
let root: string;

beforeEach(() => {
  counter++;
  root = join(TMP_BASE, `t${counter}`);
  mkdirSync(root, { recursive: true });
});

/** Find a detected client by name (case-insensitive). */
function byName(list: ReturnType<typeof scanForClients>, name: string) {
  return list.find((c) => c.name.toLowerCase() === name.toLowerCase());
}

describe('scanForClients — content-based detection (finds by .tre, names vary)', () => {
  it.skipIf(!WIN)('finds all four real-world layouts with the right names + install paths', () => {
    // Infinity: cfg + tre both inside a Live/ subdir under a doubled name dir.
    const infinityLive = join(root, 'SWG Infinity', 'SWG Infinity', 'Live');
    buildFakeClientDir(infinityLive, { treSubdir: '', cfgFile: 'swgemu.cfg', maxSearchPriority: 60 });

    // SWGEmu: hyphenated parent, cfg + tre at the SWGEmu dir root.
    const swgemu = join(root, 'SWGEmu-Client', 'SWGEmu');
    buildFakeClientDir(swgemu, { treSubdir: '', cfgFile: 'swgemu.cfg', maxSearchPriority: 27 });

    // EmpireInFlames: SWGEmu-based, single dir at the scan root.
    const eif = join(root, 'EmpireInFlames');
    buildFakeClientDir(eif, { treSubdir: '', cfgFile: 'swgemu.cfg', maxSearchPriority: 27 });

    // SWG Beyond: client.cfg + tre inside a Win64/ subdir.
    const beyond = join(root, 'SWG Beyond', 'Win64');
    buildFakeClientDir(beyond, { treSubdir: '', cfgFile: 'client.cfg', maxSearchPriority: 20 });

    const found = scanForClients({ roots: [root], maxDepth: 4 });

    // All four detected — name derived from the distro dir, not the generic container.
    expect(byName(found, 'SWG Infinity')).toBeTruthy();
    expect(byName(found, 'SWGEmu')).toBeTruthy();
    expect(byName(found, 'EmpireInFlames')).toBeTruthy();
    expect(byName(found, 'SWG Beyond')).toBeTruthy();

    // installPath points at the actual .tre dir (the subdir), not the parent.
    expect(byName(found, 'SWG Infinity')!.installPath).toBe(infinityLive);
    expect(byName(found, 'SWG Beyond')!.installPath).toBe(beyond);

    // cfg is resolved beside the archives (varies: swgemu.cfg vs client.cfg).
    expect(byName(found, 'SWG Beyond')!.cfgRootPath).toBe(join(beyond, 'client.cfg'));
    expect(byName(found, 'SWGEmu')!.cfgRootPath).toBe(join(swgemu, 'swgemu.cfg'));
  });

  it.skipIf(!WIN)('skips a .tre dir with no cfg beside it (not bindable)', () => {
    // A bare extraction dump: .tre files but no cfg — must not be reported as a client.
    const dump = join(root, 'tre-dump');
    mkdirSync(dump, { recursive: true });
    writeFileSync(join(dump, 'stuff_00.tre'), Buffer.from('EERT5000________'));

    const found = scanForClients({ roots: [root], maxDepth: 3 });
    expect(found).toHaveLength(0);
  });

  it.skipIf(!WIN)('shallow scan prunes user-profile trees; deep scan finds them', () => {
    // Install nested under a shallow-pruned "Users" tree.
    const buried = join(root, 'Users', 'someone', 'MyClient');
    buildFakeClientDir(buried, { treSubdir: '', cfgFile: 'swgemu.cfg', maxSearchPriority: 27 });

    const shallow = scanForClients({ roots: [root] });          // default: prunes 'users'
    expect(byName(shallow, 'MyClient')).toBeFalsy();

    const deep = scanForClients({ roots: [root], deep: true }); // exhaustive: no shallow prune
    expect(byName(deep, 'MyClient')).toBeTruthy();
  });
});
