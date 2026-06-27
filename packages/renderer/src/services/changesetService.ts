/**
 * packages/renderer/src/services/changesetService.ts
 * STUB — real implementation in plan 04-04.
 *
 * Provides the sealVersion function that commits the current staging list
 * as a new sealed version node in the changeset history graph.
 *
 * The real implementation will:
 *   1. Compute delta-vs-parent by comparing staging entries with the parent version
 *   2. Copy replacement files into .studio/changesets/<id>/files/
 *   3. Write manifest.json atomically (tmp+rename)
 *   4. Update changesetStore.manifest
 *   5. Clear stagingStore.entries (the staging list is consumed on seal)
 *
 * Source: 04-02-PLAN.md Task 2 (stub to allow StagingPanel to compile).
 */

import type { StagingEntry } from '@swg/contracts';

/**
 * STUB: Seal the current staging entries as a new version node.
 * @param _entries  The staging entries to seal into the new version.
 * @param _label    Human-readable version label (e.g. "Added armor textures").
 * @param _trigger  What triggered the seal: 'manual' | 'pack'.
 */
export async function sealVersion(
  _entries: StagingEntry[],
  _label?: string,
  _trigger?: 'manual' | 'pack',
): Promise<void> {
  // Real implementation in 04-04 — reads manifest, computes delta, writes files dir + manifest.json
}
