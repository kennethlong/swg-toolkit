// @vitest-environment node
/**
 * packages/renderer/src/services/core3ServerPush.test.ts
 * RED gate for core3ServerPush (04.4-07 Task 2) — Core3 (WSL2) server-side TRE push,
 * the server-side analog of cfgActivator (D-22/D-23).
 *
 * All fixtures are isolated tmp dirs — this suite NEVER touches the real `../Core3` checkout.
 * `flatten` (changesetService) and `packPatch` are mocked so the suite never depends on the
 * native addon or a real changeset manifest; the fake `packPatch` writes a real file to
 * `outputPath` so the copy-into-TrePath assertions below can inspect real bytes on disk.
 *
 * Test inventory (PATH CONTRACT + RESET-RECORD-CLEAR CONTRACT locked in 04.4-07-PLAN.md
 * round-2 revision notes):
 *   (a) pushCore3TreOverride creates config-local.lua with exactly one table.insert(...) line,
 *       copies the built .tre into the resolved TrePath dir, and persists serverPush.core3.json
 *   (b) TrePath resolution: config-local.lua (if it pre-exists with its own TrePath) wins over
 *       config.lua
 *   (c) translateLinuxPathToHost: /mnt/<x>/rest -> <X>:\rest; other absolute -> UNC via
 *       opts.distro; untranslatable -> named error; already-Windows/UNC passes through
 *   (d) idempotent re-push (same activeVersionId) does not duplicate the table.insert line and
 *       reuses the same tokened filename
 *   (e) re-push with a DIFFERENT activeVersionId replaces the line, writes a NEW tokened .tre,
 *       best-effort unlinks the old one, and overwrites serverPush.core3.json (not append)
 *   (f) readCore3PushRecord: null before any push / on malformed JSON; never throws
 *   (g) resetCore3TreOverride: line-surgery when config-local pre-existed (leaves other content
 *       intact incl. its own TrePath line); full delete when toolkit-created; best-effort unlinks
 *       the archive; round-2 LOCKED — does NOT touch serverPush.core3.json
 *   (h) missing config.lua -> clearly-named error, not raw ENOENT
 *   (i) Lua-unsafe projectSlug is sanitized before embedding — no unescaped quote breakout
 *
 * Source: 04.4-07-PLAN.md Task 2; docs/05-server-integration/core3-parity.md "Verified:
 * Product-Thesis Close-Out" section (ConfigManager.cpp:23-93, DataArchiveStore.cpp:56-88,
 * TreeFileRecord.h:109-130, SortedVector.h NO_DUPLICATE, TreeFile.cpp:41-86).
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

vi.mock('./packPatch', () => ({
  packPatch: vi.fn(),
}));

import { flatten } from './changesetService';
import { packPatch } from './packPatch';

// This import FAILS until Task 3 — this is the RED gate.
import {
  pushCore3TreOverride,
  resetCore3TreOverride,
  readCore3PushRecord,
  clearCore3PushRecordFile,
  translateLinuxPathToHost,
} from './core3ServerPush';

// ─── Fixture manifest (unused by the mocked flatten, but required by the signature) ──

const FAKE_MANIFEST: WorkspaceChangesetManifest = {
  activeVersionId: null,
  deployedVersionId: null,
  changesets: [],
};

const FAKE_ENTRIES: StagingEntry[] = [
  { virtualPath: 'texture/test.dds', action: 'add', replacementFilePath: '/fake/source.dds', sha256: 'abc' },
];

// ─── Fixture builders ──────────────────────────────────────────────────────────

function toForwardSlash(p: string): string {
  return p.split(path.sep).join('/');
}

function writeConfigLua(confDir: string, trePathValue: string, treFiles: string[]): void {
  fs.mkdirSync(confDir, { recursive: true });
  const filesBlock = treFiles.map((f) => `\t\t"${f}",`).join('\n');
  const content = [
    'Core3 = {',
    `\tTrePath = "${trePathValue}",`,
    '\tTreFiles = {',
    filesBlock,
    '\t},',
    '}',
    '',
  ].join('\n');
  fs.writeFileSync(path.join(confDir, 'config.lua'), content, 'utf8');
}

function writeConfigLocalWithOwnTrePath(confDir: string, trePathValue: string): void {
  const content = [
    '-- maintainer real shape: config-local overrides TrePath in the same Lua VM',
    `Core3.TrePath = "${trePathValue}"`,
    '',
  ].join('\n');
  fs.writeFileSync(path.join(confDir, 'config-local.lua'), content, 'utf8');
}

function readConfigLocal(confDir: string): string {
  return fs.readFileSync(path.join(confDir, 'config-local.lua'), 'utf8');
}

function countToolkitInsertLines(content: string): number {
  return (content.match(/table\.insert\(Core3\.TreFiles/g) ?? []).length;
}

// ─── Temp-dir setup ─────────────────────────────────────────────────────────────

let root: string;
let confDir: string;
let studioDir: string;
let trePathDir: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'swg-core3-push-test-'));
  confDir = path.join(root, 'MMOCoreORB', 'bin', 'conf');
  studioDir = path.join(root, 'studio');
  trePathDir = path.join(root, 'trepath');
  fs.mkdirSync(studioDir, { recursive: true });
  fs.mkdirSync(trePathDir, { recursive: true });

  vi.clearAllMocks();

  (flatten as unknown as ReturnType<typeof vi.fn>).mockReturnValue(FAKE_ENTRIES);
  (packPatch as unknown as ReturnType<typeof vi.fn>).mockImplementation(
    (_entries: StagingEntry[], outputPath: string) => {
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.writeFileSync(outputPath, 'FAKE_TRE_BYTES:' + path.basename(outputPath));
    },
  );
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

// ─── Tests ──────────────────────────────────────────────────────────────────────

describe('core3ServerPush', () => {
  it('(a) pushCore3TreOverride writes exactly one table.insert line, copies the .tre, persists the record', () => {
    writeConfigLua(confDir, toForwardSlash(trePathDir), ['default_patch.tre', 'bottom.tre']);

    const record = pushCore3TreOverride(confDir, studioDir, 'v1', FAKE_MANIFEST, 'myproject');

    expect(record.treFileName).toMatch(/^swgtoolkit_myproject_.*\.tre$/);
    expect(fs.existsSync(record.configLocalPath)).toBe(true);

    const configLocal = readConfigLocal(confDir);
    expect(countToolkitInsertLines(configLocal)).toBe(1);
    expect(configLocal).toContain(`table.insert(Core3.TreFiles, 1, "${record.treFileName}")`);

    // Archive copied into the resolved TrePath dir.
    const destPath = path.join(record.trePath, record.treFileName);
    expect(fs.existsSync(destPath)).toBe(true);

    // Cross-restart persistence.
    const persisted = readCore3PushRecord(studioDir);
    expect(persisted).not.toBeNull();
    expect(persisted?.treFileName).toBe(record.treFileName);

    // Toolkit created config-local.lua (it did not pre-exist).
    expect(record.wasConfigLocalCreatedByToolkit).toBe(true);
  });

  it('(b) TrePath resolution: pre-existing config-local.lua wins over config.lua', () => {
    const wrongTrePath = path.join(root, 'wrong-tre-dir');
    fs.mkdirSync(wrongTrePath, { recursive: true });
    writeConfigLua(confDir, toForwardSlash(wrongTrePath), ['default_patch.tre']);
    writeConfigLocalWithOwnTrePath(confDir, toForwardSlash(trePathDir));

    const record = pushCore3TreOverride(confDir, studioDir, 'v1', FAKE_MANIFEST, 'myproject');

    // Must land in the config-local value's dir, NOT config.lua's.
    expect(record.trePath).toBe(trePathDir);
    expect(fs.existsSync(path.join(trePathDir, record.treFileName))).toBe(true);
    expect(fs.existsSync(path.join(wrongTrePath, record.treFileName))).toBe(false);

    // config-local.lua pre-existed with its own TrePath line — NOT toolkit-created.
    expect(record.wasConfigLocalCreatedByToolkit).toBe(false);

    // Its pre-existing TrePath line must survive alongside our inserted line.
    const configLocal = readConfigLocal(confDir);
    expect(configLocal).toContain('Core3.TrePath');
    expect(countToolkitInsertLines(configLocal)).toBe(1);
  });

  it('(c) translateLinuxPathToHost: /mnt/<x>/rest -> <X>:\\rest', () => {
    expect(translateLinuxPathToHost('/mnt/d/SWGEmu-Client/SWGEmu')).toBe('D:\\SWGEmu-Client\\SWGEmu');
  });

  it('(c) translateLinuxPathToHost: other absolute Linux path -> \\\\wsl.localhost\\<distro>\\<path>', () => {
    expect(translateLinuxPathToHost('/home/kenny/workspace/Core3', { distro: 'Debian' })).toBe(
      '\\\\wsl.localhost\\Debian\\home\\kenny\\workspace\\Core3',
    );
  });

  it('(c) translateLinuxPathToHost: non-/mnt path with no derivable distro throws a named error', () => {
    expect(() => translateLinuxPathToHost('/home/kenny/workspace/Core3')).toThrow(
      /translateLinuxPathToHost/,
    );
  });

  it('(c) translateLinuxPathToHost: already-Windows/UNC path passes through unchanged', () => {
    expect(translateLinuxPathToHost('D:/SWGEmu-Client/SWGEmu')).toBe('D:/SWGEmu-Client/SWGEmu');
    expect(translateLinuxPathToHost('\\\\wsl.localhost\\Debian\\home\\kenny')).toBe(
      '\\\\wsl.localhost\\Debian\\home\\kenny',
    );
  });

  it('(d) idempotent re-push with the SAME activeVersionId does not duplicate the line and reuses the filename', () => {
    writeConfigLua(confDir, toForwardSlash(trePathDir), ['default_patch.tre']);

    const first = pushCore3TreOverride(confDir, studioDir, 'v1', FAKE_MANIFEST, 'myproject');
    const second = pushCore3TreOverride(confDir, studioDir, 'v1', FAKE_MANIFEST, 'myproject');

    expect(second.treFileName).toBe(first.treFileName);
    const configLocal = readConfigLocal(confDir);
    expect(countToolkitInsertLines(configLocal)).toBe(1);

    const persisted = readCore3PushRecord(studioDir);
    expect(persisted?.treFileName).toBe(first.treFileName);
  });

  it('(e) re-push with a DIFFERENT activeVersionId replaces the line, writes a new .tre, unlinks the old one', () => {
    writeConfigLua(confDir, toForwardSlash(trePathDir), ['default_patch.tre']);

    const first = pushCore3TreOverride(confDir, studioDir, 'v1', FAKE_MANIFEST, 'myproject');
    const firstArchivePath = path.join(first.trePath, first.treFileName);
    expect(fs.existsSync(firstArchivePath)).toBe(true);

    const second = pushCore3TreOverride(confDir, studioDir, 'v2', FAKE_MANIFEST, 'myproject');

    expect(second.treFileName).not.toBe(first.treFileName);

    const configLocal = readConfigLocal(confDir);
    expect(countToolkitInsertLines(configLocal)).toBe(1);
    expect(configLocal).toContain(second.treFileName);
    expect(configLocal).not.toContain(first.treFileName);

    // New archive exists; old one was best-effort unlinked.
    expect(fs.existsSync(path.join(second.trePath, second.treFileName))).toBe(true);
    expect(fs.existsSync(firstArchivePath)).toBe(false);

    // Record file overwritten (not appended) with the latest push.
    const persisted = readCore3PushRecord(studioDir);
    expect(persisted?.treFileName).toBe(second.treFileName);
  });

  it('(f) readCore3PushRecord returns null before any push and never throws on malformed JSON', () => {
    expect(readCore3PushRecord(studioDir)).toBeNull();

    const recordPath = path.join(studioDir, 'serverPush.core3.json');
    fs.mkdirSync(path.dirname(recordPath), { recursive: true });
    fs.writeFileSync(recordPath, '{ not valid json', 'utf8');

    expect(() => readCore3PushRecord(studioDir)).not.toThrow();
    expect(readCore3PushRecord(studioDir)).toBeNull();
  });

  it('(g) resetCore3TreOverride deletes toolkit-created config-local.lua entirely and unlinks the archive', () => {
    writeConfigLua(confDir, toForwardSlash(trePathDir), ['default_patch.tre']);
    const record = pushCore3TreOverride(confDir, studioDir, 'v1', FAKE_MANIFEST, 'myproject');
    const archivePath = path.join(record.trePath, record.treFileName);
    expect(fs.existsSync(record.configLocalPath)).toBe(true);
    expect(fs.existsSync(archivePath)).toBe(true);

    resetCore3TreOverride(record);

    // Toolkit-created config-local.lua is deleted entirely.
    expect(fs.existsSync(record.configLocalPath)).toBe(false);
    // Archive best-effort unlinked.
    expect(fs.existsSync(archivePath)).toBe(false);

    // ROUND-2 LOCKED CONTRACT: resetCore3TreOverride does NOT clear serverPush.core3.json.
    expect(fs.existsSync(path.join(studioDir, 'serverPush.core3.json'))).toBe(true);

    // Caller (04.4-12) clears it explicitly, separately.
    clearCore3PushRecordFile(studioDir);
    expect(fs.existsSync(path.join(studioDir, 'serverPush.core3.json'))).toBe(false);
  });

  it('(g) resetCore3TreOverride line-surgery when config-local.lua pre-existed with other content', () => {
    writeConfigLua(confDir, toForwardSlash(trePathDir), ['default_patch.tre']);
    writeConfigLocalWithOwnTrePath(confDir, toForwardSlash(trePathDir));

    const record = pushCore3TreOverride(confDir, studioDir, 'v1', FAKE_MANIFEST, 'myproject');
    expect(record.wasConfigLocalCreatedByToolkit).toBe(false);

    resetCore3TreOverride(record);

    // config-local.lua still exists (pre-existed) but our line is gone; its OTHER content
    // (the maintainer's own TrePath override) is left intact.
    expect(fs.existsSync(record.configLocalPath)).toBe(true);
    const configLocal = readConfigLocal(confDir);
    expect(countToolkitInsertLines(configLocal)).toBe(0);
    expect(configLocal).toContain('Core3.TrePath');

    // ROUND-2 LOCKED CONTRACT: record file untouched by reset.
    expect(fs.existsSync(path.join(studioDir, 'serverPush.core3.json'))).toBe(true);
  });

  it('(h) missing config.lua throws a clearly-named error, not a raw ENOENT', () => {
    const emptyConfDir = path.join(root, 'no-config-here');
    fs.mkdirSync(emptyConfDir, { recursive: true });

    expect(() =>
      pushCore3TreOverride(emptyConfDir, studioDir, 'v1', FAKE_MANIFEST, 'myproject'),
    ).toThrow(/Core3 conf\/config\.lua not found at/);
  });

  it('(i) Lua-unsafe projectSlug is sanitized — no unescaped quote breaks out of the string literal', () => {
    writeConfigLua(confDir, toForwardSlash(trePathDir), ['default_patch.tre']);

    const unsafeSlug = 'my"proj\\ect\nname';
    const record = pushCore3TreOverride(confDir, studioDir, 'v1', FAKE_MANIFEST, unsafeSlug);

    // No raw quote/backslash/newline in the generated filename or Lua line.
    expect(record.treFileName).not.toMatch(/["\\\n]/);
    const configLocal = readConfigLocal(confDir);
    const insertLineMatch = /^table\.insert\(Core3\.TreFiles, 1, "([^\n]*)"\)\s*$/m.exec(configLocal);
    expect(insertLineMatch).not.toBeNull();
    // The captured filename between the quotes must not itself contain a bare quote.
    expect(insertLineMatch?.[1]).not.toContain('"');
  });
});
