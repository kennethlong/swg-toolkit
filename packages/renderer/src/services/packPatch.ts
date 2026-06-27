/**
 * packages/renderer/src/services/packPatch.ts
 * STUB — real implementation in plan 04-03.
 *
 * Provides the packPatch function that builds a deploy patch .tre from staged entries,
 * and buildPatchName for consistent patch filename generation.
 *
 * The real implementation will use nativeCore.buildTre with version '5000'
 * (EERT5000 format — verified on live Infinity client by hexdump, D-04-04).
 *
 * Source: 04-02-PLAN.md Task 2 (stub to allow StagingPanel to compile).
 */

import type { StagingEntry } from '@swg/contracts';

/**
 * STUB: Build a deploy patch .tre from the given staged entries.
 * @param _entries  The staging list to flatten into the patch.
 * @param _outputPath  Absolute path where the .tre should be written.
 */
export function packPatch(_entries: StagingEntry[], _outputPath: string): void {
  // Real implementation in 04-03 — nativeCore.buildTre(entries, '5000')
}

/**
 * STUB: Generate a consistent patch filename for the given workspace name.
 * @param _workspaceName  Basename of the workspace folder.
 * @returns The patch .tre filename (e.g. 'swgtoolkit_patch.tre').
 */
export function buildPatchName(_workspaceName: string): string {
  return 'swgtoolkit_patch.tre';
}
