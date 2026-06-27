/**
 * gitLfs.test.ts — DEPLOY-04 integration tests for Git/LFS workspace setup.
 *
 * Spawns a REAL temporary git repo via createWorkspace(), then exercises:
 *   Test 1  — .gitignore content (*.tre, extracted_vanilla_base/, .studio/shadow/, .studio/build/)
 *   Test 2  — .gitattributes content (N3 patterns: *.iff *.tga *.wav *.ogg + *.dds etc.)
 *             and NEGATIVE assertion that *.tre is NOT LFS-tracked
 *   Test 3  — gitCommit stages listed text files, git log shows at least 1 commit
 *   Test 3b — B8 FIX (non-vacuous LFS pointer test): writes a real .dds binary, stages via
 *             'git add -- test.dds' (LFS filter converts it), commits, reads back blob via
 *             'git cat-file blob HEAD:test.dds', asserts blob starts with LFS pointer header.
 *             The ORIGINAL test was vacuous: it called gitCommit without ever staging a binary,
 *             so the cat-file assertion never tested anything real.
 *   Test 4  — Pre-commit hook REJECTED: staging a .tre file via 'git add -f' then committing
 *             causes the hook to reject with non-zero exit.
 *   Test 5  — Pre-commit hook REJECTED: staging a file >50 MB causes the size guard to reject.
 *
 * Tests 4/5 require the pre-commit hook to be executable via git's bundled bash on Windows.
 * They are skipped on non-Windows platforms (hooks require git's bundled sh, not guaranteed in CI).
 *
 * Source: 04-05-PLAN.md Task 1; 04-CONTEXT.md §D-04-15/16; 04-RESEARCH.md §Pre-commit guard.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync, execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { createWorkspace } from '../src/services/workspaceService';
// gitLfsService.ts is Task 2 — importing it here is what makes these tests RED until Task 2.
import { gitCommit } from '../src/services/gitLfsService';

const execFileAsync = promisify(execFile);

// ─── Shared tmp repo ──────────────────────────────────────────────────────────

const TMP = join(tmpdir(), 'swg-gitlfs-' + Date.now());
mkdirSync(TMP, { recursive: true });

/** True if git is on PATH (guard for all tests in this suite). */
let gitAvailable = false;
/** True if git-lfs is available (guard for Test 3b only). */
let lfsAvailable = false;

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeAll(async () => {
  // Check git availability — skip suite if absent.
  try {
    execFileSync('git', ['--version'], { stdio: 'pipe' });
    gitAvailable = true;
  } catch {
    gitAvailable = false;
    return;
  }

  // Scaffold the workspace (git init, .gitignore, .gitattributes, pre-commit hook).
  await createWorkspace(TMP);

  // Set required git identity for commits (some CI environments lack global config).
  execFileSync('git', ['-C', TMP, 'config', 'user.email', 'test@swg-toolkit.test'],
    { stdio: 'pipe' });
  execFileSync('git', ['-C', TMP, 'config', 'user.name', 'SWG-Toolkit Test'],
    { stdio: 'pipe' });

  // Install LFS filter hooks so .gitattributes routing becomes active.
  // Without 'git lfs install --local', the filter=lfs lines in .gitattributes are inert.
  try {
    execFileSync('git', ['-C', TMP, 'lfs', 'install', '--local'], { stdio: 'pipe' });
    lfsAvailable = true;
  } catch {
    lfsAvailable = false;
  }
}, 30_000);

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('DEPLOY-04 Git/LFS workspace', () => {

  // ── Test 1: .gitignore ────────────────────────────────────────────────────

  it('Test 1 — .gitignore contains *.tre, extracted_vanilla_base/, .studio/shadow/, .studio/build/', () => {
    if (!gitAvailable) {
      console.warn('git not available — skipping Test 1');
      return;
    }
    const gitignore = readFileSync(join(TMP, '.gitignore'), 'utf8');
    expect(gitignore).toContain('*.tre');
    expect(gitignore).toContain('extracted_vanilla_base/');
    expect(gitignore).toContain('.studio/shadow/');
    expect(gitignore).toContain('.studio/build/');
  });

  // ── Test 2: .gitattributes — N3 patterns + *.tre NOT LFS-tracked ─────────

  it('Test 2 — .gitattributes has N3 patterns (*.dds *.msh *.iff *.tga *.wav *.ogg) and *.tre is NOT LFS-tracked', () => {
    if (!gitAvailable) {
      console.warn('git not available — skipping Test 2');
      return;
    }
    const gitattributes = readFileSync(join(TMP, '.gitattributes'), 'utf8');

    // N3 confirmation: these patterns must be present for mod-output binary LFS routing.
    expect(gitattributes).toContain('*.dds');
    expect(gitattributes).toContain('*.msh');
    expect(gitattributes).toContain('*.iff');   // N3
    expect(gitattributes).toContain('*.tga');   // N3
    expect(gitattributes).toContain('*.wav');   // N3
    expect(gitattributes).toContain('*.ogg');   // N3

    // D-04-14: *.tre is gitignored (rebuildable artifact) — it must NOT be LFS-tracked.
    expect(gitattributes).not.toContain('*.tre  filter=lfs');  // double-space variant
    expect(gitattributes).not.toContain('*.tre filter=lfs');   // single-space variant
  });

  // ── Test 3: gitCommit stages listed files ─────────────────────────────────

  it('Test 3 — gitCommit(.gitignore + .gitattributes) creates at least one commit', async () => {
    if (!gitAvailable) {
      console.warn('git not available — skipping Test 3');
      return;
    }
    await gitCommit(TMP, 'initial commit', ['.gitignore', '.gitattributes']);
    const { stdout } = await execFileAsync('git', ['-C', TMP, 'log', '--oneline'],
      { encoding: 'utf8' });
    expect(stdout.trim()).toBeTruthy();
  }, 30_000);

  // ── Test 3b: B8 FIX — non-vacuous LFS pointer test ───────────────────────

  it('Test 3b (B8 fix) — staging a .dds binary converts it to an LFS pointer; cat-file confirms', async () => {
    if (!gitAvailable || !lfsAvailable) {
      console.warn('git or git-lfs not available — skipping Test 3b (B8 fix)');
      return;
    }

    // Write 256 bytes of fake DDS (DXT1 magic + padding).
    const ddPath = join(TMP, 'test.dds');
    const ddBytes = Buffer.from([
      // DDS magic: 'DDS ' (0x44 0x44 0x53 0x20)
      0x44, 0x44, 0x53, 0x20,
      // DDS header size field (124) + remaining fake header bytes
      0x7C, 0x00, 0x00, 0x00,
      ...Array(248).fill(0x00),
    ]);
    writeFileSync(ddPath, ddBytes);

    // Stage through LFS filter: .gitattributes routes *.dds via filter=lfs.
    // After 'git lfs install --local' in beforeAll, this converts the binary to an LFS pointer.
    execFileSync('git', ['-C', TMP, 'add', '--', 'test.dds'], { stdio: 'pipe' });

    // gitCommit re-stages test.dds (idempotent — already staged as pointer) then commits.
    await gitCommit(TMP, 'add test.dds via LFS', ['test.dds']);

    // Read back the committed blob — must be an LFS pointer, NOT the raw DDS bytes.
    const blob = execFileSync(
      'git', ['-C', TMP, 'cat-file', 'blob', 'HEAD:test.dds'],
      { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] },
    );

    // B8 fix: this assertion was previously vacuous (no binary was staged → no pointer created).
    // Now we assert the committed object IS an LFS pointer (starts with the LFS spec header).
    expect(blob).toContain('version https://git-lfs.github.com/spec/v1');
  }, 30_000);

  // ── Test 4: pre-commit hook REJECTS staged *.tre ─────────────────────────

  it('Test 4 — pre-commit hook REJECTS a staged .tre file with non-zero exit', async () => {
    if (!gitAvailable || process.platform !== 'win32') {
      console.warn('Skipping Test 4 — requires git on win32 (hook uses bundled bash)');
      return;
    }

    // Force-add the .tre file (it is gitignored, so -f is required).
    writeFileSync(join(TMP, 'mod.tre'), Buffer.from([0x45, 0x45, 0x52, 0x54, 0x35, 0x30, 0x30, 0x30]));
    await execFileAsync('git', ['-C', TMP, 'add', '-f', 'mod.tre'], { encoding: 'utf8' });

    // The pre-commit hook should catch the *.tre extension and exit non-zero, rejecting the commit.
    await expect(
      execFileAsync('git', ['-C', TMP, 'commit', '-m', 'bad — retail .tre'], { encoding: 'utf8' }),
    ).rejects.toThrow();
  }, 30_000);

  // ── Test 5: pre-commit hook REJECTS files >50 MB ─────────────────────────

  it('Test 5 — pre-commit hook REJECTS a file >50 MB with non-zero exit', async () => {
    if (!gitAvailable || process.platform !== 'win32') {
      console.warn('Skipping Test 5 — requires git on win32 (hook uses bundled bash)');
      return;
    }

    // Write a 55 MB binary (zeros — not a .tre, not LFS-tracked, just a huge blob).
    const largePath = join(TMP, 'large.bin');
    writeFileSync(largePath, Buffer.alloc(55 * 1024 * 1024, 0x00));
    await execFileAsync('git', ['-C', TMP, 'add', '--', 'large.bin'], { encoding: 'utf8' });

    // The pre-commit hook size guard (>50 MB) should reject this commit.
    await expect(
      execFileAsync('git', ['-C', TMP, 'commit', '-m', 'toobig'], { encoding: 'utf8' }),
    ).rejects.toThrow();
  }, 60_000);

});
