/**
 * packages/renderer/src/services/packPatch.test.ts
 * Unit tests for packPatch path-safety M1 unification (DEPLOY-07).
 *
 * Tests:
 *   1 — packPatch throws "Invalid virtualPath" for a Windows drive-letter path (C:\...)
 *       which the OLD weak guard silently allowed through (missing /^[A-Za-z]:[/\\]/ check)
 *   2 — packPatch rejects path-traversal (..) via guard
 *   3 — packPatch rejects absolute leading-slash path via guard
 *   4 — packPatch allows safe relative paths (tombstone action — no fs.readFileSync needed)
 *
 * RED phase (Task 1):
 *   Test 1 FAILS — current guard does NOT check for drive-letter patterns.
 *   A 'C:\\test.iff' path passes all three current guard conditions and packPatch
 *   proceeds to nativeCore.buildTre (mocked), fs.writeFileSync (mocked), renameSync (mocked),
 *   completing without throwing — the test assertion "toThrow(/Invalid virtualPath/)" fails.
 *
 * GREEN phase (Task 2):
 *   Test 1 PASSES — isVirtualPathSafe catches /^[A-Za-z]:[/\\]/ patterns;
 *   packPatch throws "Invalid virtualPath: path traversal rejected — 'C:\\test.iff'"
 *   before ever reaching nativeCore or fs.
 *
 * Source: 04.1-08-PLAN.md Task 1; T-04.1-19; packPatch.ts:80-89 (weak guard site).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Module mocks ─────────────────────────────────────────────────────────────
// These must be declared BEFORE importing packPatch (vi.mock is hoisted).

// Mock the native addon (Path B require) — avoids loading the .node binary
vi.mock('@swg/native-core', () => ({
  buildTre: vi.fn().mockReturnValue(new ArrayBuffer(8)),
}));

// Mock fs to avoid real disk operations (all calls after guard are no-ops in test).
// Both `default` and named exports are provided: packPatch uses `import fs from 'fs'`
// (default import) and vitest's ESM interop requires the mock to expose `default`.
vi.mock('fs', () => {
  const fns = {
    readFileSync:  vi.fn().mockReturnValue(Buffer.from([1, 2, 3])),
    writeFileSync: vi.fn(),
    renameSync:    vi.fn(),
    mkdirSync:     vi.fn(),
    existsSync:    vi.fn().mockReturnValue(true),
  };
  return { default: fns, ...fns };
});

// ─── Import under test ────────────────────────────────────────────────────────

import { packPatch } from './packPatch';

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('packPatch — path-safety M1 unification (DEPLOY-07)', () => {

  it('Test 1: throws Invalid virtualPath for Windows drive-letter path (C:\\)', () => {
    // Use action:'delete' (tombstone) so fs.readFileSync is never called — guard fires first.
    // RED: current guard misses /^[A-Za-z]:[/\\]/ → no throw → assertion fails.
    // GREEN: isVirtualPathSafe catches it → throws "Invalid virtualPath..."
    const staged = [{ virtualPath: 'C:\\windows\\system32\\ntdll.dll', action: 'delete' as const }];
    expect(() => packPatch(staged, '/output/patch.tre')).toThrow(/Invalid virtualPath/);
  });

  it('Test 2: throws for path-traversal (..) — already caught by old guard, passes RED too', () => {
    const staged = [{ virtualPath: '../escape.iff', action: 'delete' as const }];
    expect(() => packPatch(staged, '/output/patch.tre')).toThrow(/Invalid virtualPath/);
  });

  it('Test 3: throws for absolute leading-slash path — already caught by old guard', () => {
    const staged = [{ virtualPath: '/etc/passwd', action: 'delete' as const }];
    expect(() => packPatch(staged, '/output/patch.tre')).toThrow(/Invalid virtualPath/);
  });

  it('Test 4: does NOT throw for a safe relative path (tombstone)', () => {
    const staged = [{ virtualPath: 'appearance/armor.mgn', action: 'delete' as const }];
    expect(() => packPatch(staged, '/output/patch.tre')).not.toThrow();
  });

});
