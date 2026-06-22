/**
 * resolve-prebuild.test.ts — Non-circular FND-02 distribution proof (review fix HIGH-1).
 *
 * WHAT THIS PROVES:
 *   With packages/native-core/build/ temporarily moved to build.bak, the addon still
 *   loads via require('../index.js') → node-gyp-build → prebuilds/win32-x64/@swg+native-core.node.
 *   The __resolvedPath exposed by index.js is asserted to contain 'prebuilds' and NOT contain
 *   the build/Release segment — proving the load did NOT come from build/ and that no
 *   cmake-js build/ fallback was used.
 *
 * WHY NON-CIRCULAR:
 *   Round-1 proof was CIRCULAR: prebuilds/ was built with MSVC present and resolved on the same
 *   box with build/Release co-resident, so a green test could not prove the load came from
 *   prebuilds/ or that no compiler was needed. This test closes that hole by ensuring
 *   build/ is absent when the resolution test runs.
 *
 * HONEST SCOPE (review fix HIGH-1 — do NOT claim more than this proves):
 *   - PROVEN: the FND-02 resolution path is non-circular (build/ absent, addon loads from
 *     prebuilds/ alone, __resolvedPath asserts it).
 *   - DEFERRED: full no-compiler-machine proof (no MSVC present at all) belongs on a
 *     toolchain-free CI runner — out of Phase-0 scope.
 *   - Plan 05's packaged hard gate proves the packaged-Electron RUNTIME LOAD of the same
 *     single --napi artifact (ABI-stable across Node + Electron — round-3 / Cursor CUR-1).
 *
 * SAFETY:
 *   - afterAll/finally ALWAYS restores build/ from build.bak, even if assertions fail.
 *   - If build/ does not exist before the test (already clean), it is noted but the test
 *     still runs (prebuilds/ is the only target regardless).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

// Absolute paths for reliable operations (tests run from repo root via vitest)
const NATIVE_CORE_DIR = path.resolve(__dirname, '..');
const BUILD_DIR = path.join(NATIVE_CORE_DIR, 'build');
const BUILD_BAK_DIR = path.join(NATIVE_CORE_DIR, 'build.bak');
const PREBUILDS_DIR = path.join(NATIVE_CORE_DIR, 'prebuilds');
const INDEX_JS = path.join(NATIVE_CORE_DIR, 'index.js');

// We'll load the addon here after build/ is moved aside
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let nativeCore: any = null;
let buildExistedBefore = false;

beforeAll(() => {
  // 1. Verify prebuilds/ exists — if not, the Task 3 prebuild script was not run
  if (!fs.existsSync(PREBUILDS_DIR)) {
    throw new Error(
      `[resolve-prebuild] prebuilds/ not found at ${PREBUILDS_DIR}\n` +
      'Run the Task 3 prebuild script first:\n' +
      '  node packages/native-core/scripts/prebuild.js'
    );
  }

  // 2. Move build/ aside so node-gyp-build CANNOT fall back to build/Release
  buildExistedBefore = fs.existsSync(BUILD_DIR);
  if (buildExistedBefore) {
    // Clean up any leftover build.bak from a previous interrupted test run
    if (fs.existsSync(BUILD_BAK_DIR)) {
      fs.rmSync(BUILD_BAK_DIR, { recursive: true, force: true });
    }
    fs.renameSync(BUILD_DIR, BUILD_BAK_DIR);
  }

  // 3. Clear the require cache for index.js (and node-gyp-build) so we get a fresh
  //    resolution attempt without build/ present.
  //    Vitest uses forks pool, but clearing the cache is defensive best practice.
  for (const key of Object.keys(require.cache)) {
    if (key.includes('native-core')) {
      delete require.cache[key];
    }
  }

  // 4. Re-require index.js — must succeed from prebuilds/ alone
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  nativeCore = require(INDEX_JS);
});

afterAll(() => {
  // ALWAYS restore build/ from build.bak, even if assertions failed
  try {
    if (buildExistedBefore && fs.existsSync(BUILD_BAK_DIR)) {
      // Clean up any partial build/ that might have appeared
      if (fs.existsSync(BUILD_DIR)) {
        fs.rmSync(BUILD_DIR, { recursive: true, force: true });
      }
      fs.renameSync(BUILD_BAK_DIR, BUILD_DIR);
    }
  } catch (err) {
    // Log but do not rethrow — test teardown should not mask test failures
    console.error('[resolve-prebuild] WARNING: failed to restore build/ from build.bak:', err);
  }
});

describe('non-circular FND-02 proof: addon loads from prebuilds/ with build/ moved aside', () => {

  it('require(index.js) succeeds with build/ moved aside (no throw)', () => {
    // If this throws, it means prebuilds/ was not populated or the file is corrupted
    expect(nativeCore).toBeTruthy();
  });

  it('__resolvedPath contains "prebuilds" — load came from prebuilds/', () => {
    // node-gyp-build.resolve() returns the absolute path of the .node it chose.
    // When build/ is absent, it must come from prebuilds/.
    expect(typeof nativeCore.__resolvedPath).toBe('string');
    expect(nativeCore.__resolvedPath).toContain('prebuilds');
  });

  it('__resolvedPath does NOT contain build/Release — not from the cmake-js dev tree', () => {
    // This is the airtight assertion that proves non-circularity.
    // If this fails, node-gyp-build somehow found a build/Release we thought was moved.
    const resolved = nativeCore.__resolvedPath as string;
    // Check for both Windows and POSIX separators
    expect(resolved).not.toContain('build' + path.sep + 'Release');
    expect(resolved).not.toContain('build/Release');
  });

  it('hello() === "pong" with build/ moved aside (addon works from prebuilds/ alone)', () => {
    expect(nativeCore.hello()).toBe('pong');
  });

  it('allocateSab(8).byteLength === 8 with build/ moved aside', () => {
    const sab = nativeCore.allocateSab(8);
    expect(sab instanceof SharedArrayBuffer).toBe(true);
    expect(sab.byteLength).toBe(8);
  });

});
