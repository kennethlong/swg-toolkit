/**
 * packages/renderer/src/services/pathSafety.ts
 * Shared virtual-path safety validator — M1 single source of truth.
 *
 * Extracted verbatim from StagingPanel.tsx:94-102.
 * Reused by plans 06 (sealVersion / Baseline seed), 08 (stagingStore.addEntry /
 * packPatch / Extract→Add) — import from here; do NOT inline a second copy.
 *
 * T-04.1-05 (Tampering — virtual-path input in StagingPanelBody): rejects '..',
 * absolute paths, AND Windows drive-letter patterns — strongest validator.
 *
 * Source: 04.1-03-PLAN.md Task 2 (M1); StagingPanel.tsx:94-102.
 * Updated (Plan 04.2-04): drive-relative regex tightened; isConfinedToRoot added.
 */

import path from 'path';

/**
 * Returns true when virtualPath is safe to store/deploy (no traversal, not absolute).
 *
 * Rejects:
 *   - empty / whitespace-only values
 *   - any path containing '..' (traversal)
 *   - absolute paths (starts with '/' or '\\')
 *   - Windows drive-letter paths, including drive-relative (e.g. 'C:\', 'C:/', 'C:foo')
 *
 * T-04.1-05: This is the single source of truth for virtual-path validation.
 * Plans 06 and 08 MUST import this function rather than re-implementing it.
 *
 * T-04.2-01 (MED): regex tightened from /^[A-Za-z]:[/\\]/ to /^[A-Za-z]:/ to also
 * reject drive-relative paths like 'C:foo' which previously passed the old regex
 * and could resolve unexpectedly on Windows.
 */
export function isVirtualPathSafe(vp: string): boolean {
  if (!vp || vp.trim() === '') return false;
  // Reject '..' anywhere in the path
  if (vp.includes('..')) return false;
  // Reject absolute paths (starts with / or \)
  if (vp.startsWith('/') || vp.startsWith('\\')) return false;
  // Reject Windows-style drive letters including drive-relative (e.g. 'C:\', 'C:/', 'C:foo')
  if (/^[A-Za-z]:/.test(vp)) return false;
  return true;
}

/**
 * Returns true when destAbs is the root itself or a proper descendant of rootAbs.
 *
 * Checks that destAbs is the root itself or a proper descendant. Uses +path.sep to
 * prevent prefix collisions (e.g. 'D:/override_evil' would pass a bare
 * startsWith('D:/override') check).
 *
 * T-04.2-01: The trailing-sep form (r + path.sep) is mandatory — a bare
 * d.startsWith(r) allows a sibling dir named overrideDir+'_evil' to pass.
 *
 * @param destAbs  Absolute path to the destination file or directory.
 * @param rootAbs  Absolute path to the root directory that destAbs must be inside.
 */
export function isConfinedToRoot(destAbs: string, rootAbs: string): boolean {
  const r = path.resolve(rootAbs);
  const d = path.resolve(destAbs);
  return d === r || d.startsWith(r + path.sep);
}
