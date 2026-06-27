// @vitest-environment node
/**
 * packages/renderer/test/fixtures/fakeClientDir.ts
 * Shared test helper — builds a fake SWG client directory tree in a real OS temp dir.
 *
 * Used across all Wave-0 detection / binding / deploy tests so each test file does
 * NOT redeclare its own inline helper (no-per-plan-fixture-duplication, W2 fix).
 *
 * Pattern source: 04.1-PATTERNS.md §Wave 0 Test Files → "File-exist fixture pattern"
 *
 * Security: callers MUST pass an os.tmpdir()-rooted base (T-04.1-01 — never a
 * client install or repo source path).
 *
 * Usage:
 *   import { buildFakeClientDir } from './fixtures/fakeClientDir';
 *   const { cfgPath, treDir, trePaths } = buildFakeClientDir(
 *     path.join(os.tmpdir(), 'swg-test-123'),
 *     { treSubdir: 'Live', cfgFile: 'swgemu.cfg', maxSearchPriority: 60 }
 *   );
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FakeClientDirOpts {
  /**
   * Subdirectory under `base` where .tre files are written.
   * Default: 'Live'. Pass '' (empty string) for root (SWGEmu layout).
   */
  treSubdir?: string;
  /**
   * Filename for the cfg file written into `base`.
   * Default: 'swgemu.cfg'.
   */
  cfgFile?: string;
  /**
   * Value for maxSearchPriority in the cfg file.
   * Default: 60 (SWG Infinity layout).
   */
  maxSearchPriority?: number;
}

export interface FakeClientDirResult {
  /** Absolute path to the written cfg file. */
  cfgPath: string;
  /** Absolute path to the TRE directory (may equal `base` when treSubdir is ''). */
  treDir: string;
  /** Absolute paths of the 3 dummy .tre files written. */
  trePaths: string[];
}

// ---------------------------------------------------------------------------
// EERT5000 header bytes (8 ASCII bytes that identify a standard TRE archive)
// ---------------------------------------------------------------------------
const EERT5000_HEADER = Buffer.from('EERT5000');

// ---------------------------------------------------------------------------
// buildFakeClientDir
// ---------------------------------------------------------------------------

/**
 * Build a fake SWG client directory tree inside `base` (must be a temp path).
 *
 * Creates:
 *   <base>/
 *     <cfgFile>                      — cfg with maxSearchPriority + .include stub
 *     <treSubdir>/                   — TRE subdir (or root when treSubdir==='')
 *       sample_patch_00.tre          — 8-byte EERT5000 header
 *       sample_patch_01.tre          — 8-byte EERT5000 header
 *       sample_patch_02.tre          — 8-byte EERT5000 header
 *
 * Returns paths to all created files so tests can assert on them directly.
 */
export function buildFakeClientDir(
  base: string,
  opts: FakeClientDirOpts = {},
): FakeClientDirResult {
  const {
    treSubdir          = 'Live',
    cfgFile            = 'swgemu.cfg',
    maxSearchPriority  = 60,
  } = opts;

  // ── Create base dir ──────────────────────────────────────────────────────
  fs.mkdirSync(base, { recursive: true });

  // ── Write cfg file ───────────────────────────────────────────────────────
  // Minimal cfg with maxSearchPriority line and a .include reference stub so
  // cfgActivator.scanSharedFile / ensureInclude can parse it in tests.
  const cfgPath = path.join(base, cfgFile);
  const cfgContent = [
    '[SharedFile]',
    `\tmaxSearchPriority=${maxSearchPriority}`,
    '.include "swgtoolkit.cfg"',
    '',
  ].join('\n');
  fs.writeFileSync(cfgPath, cfgContent, 'utf8');

  // ── Create TRE dir ────────────────────────────────────────────────────────
  const treDir = treSubdir ? path.join(base, treSubdir) : base;
  if (treSubdir) {
    fs.mkdirSync(treDir, { recursive: true });
  }

  // ── Write dummy .tre files with EERT5000 header ──────────────────────────
  // 3 files so tests can verify multi-archive detection and priority ordering.
  const treNames = [
    'sample_patch_00.tre',
    'sample_patch_01.tre',
    'sample_patch_02.tre',
  ];
  const trePaths = treNames.map((name) => {
    const treFile = path.join(treDir, name);
    // First 8 bytes = EERT5000 magic; pad to 16 bytes so it looks more realistic
    const buf = Buffer.alloc(16, 0);
    EERT5000_HEADER.copy(buf, 0);
    fs.writeFileSync(treFile, buf);
    return treFile;
  });

  return { cfgPath, treDir, trePaths };
}
