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
 */

/**
 * Returns true when virtualPath is safe to store/deploy (no traversal, not absolute).
 *
 * Rejects:
 *   - empty / whitespace-only values
 *   - any path containing '..' (traversal)
 *   - absolute paths (starts with '/' or '\\')
 *   - Windows drive-letter paths (e.g. 'C:\' or 'C:/')
 *
 * T-04.1-05: This is the single source of truth for virtual-path validation.
 * Plans 06 and 08 MUST import this function rather than re-implementing it.
 */
export function isVirtualPathSafe(vp: string): boolean {
  if (!vp || vp.trim() === '') return false;
  // Reject '..' anywhere in the path
  if (vp.includes('..')) return false;
  // Reject absolute paths (starts with / or \)
  if (vp.startsWith('/') || vp.startsWith('\\')) return false;
  // Reject Windows-style drive letters (e.g. 'C:\' or 'C:/')
  if (/^[A-Za-z]:[/\\]/.test(vp)) return false;
  return true;
}
