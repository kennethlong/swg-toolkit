/**
 * packages/renderer/src/panels/viewport/liveSyncGuardPrecedence.ts
 *
 * Shared scale-guard-row precedence logic (REVIEWS.md Fix B + ROUND 2 decision
 * #2 — "a build-capability gap is never rendered as a tamper"). ONE
 * implementation, reused by LiveSyncClientCard.tsx's scale guard row,
 * TransformReadoutBar.tsx's Scale-group gating, and StatusBar.tsx's compact
 * guard chip — the plan's own Task 1 action text explicitly asks for this to
 * be extracted rather than re-derived ad hoc in each consumer.
 *
 * Precedence order (highest to lowest):
 *   1. scaleUnavailableOnBuild === true  -> 'unavailable' (structural, non-alarming)
 *   2. guardState.scale === 'blocked'    -> 'blocked' (genuine tamper)
 *   3. cowSnapshot.scale === null        -> 'not-written' (nothing to compare yet)
 *   4. otherwise                          -> 'ok'
 *
 * Source: 05-11-PLAN.md Task 1 action text + Interfaces section (item 2, scale
 * row four-branch precedence) + ROUND 2 decision #2.
 */

export type ScaleGuardRowState = 'unavailable' | 'blocked' | 'not-written' | 'ok';

export interface ScaleGuardPrecedenceInput {
  scaleUnavailableOnBuild: boolean;
  guardStateScale: 'ok' | 'blocked';
  /** cowSnapshot.scale — null means no scale-bearing write has happened yet this identity. */
  cowSnapshotScale: Float32Array | null;
}

/** The client card's scale guard row — one of the four precedence-ordered states. */
export function computeScaleGuardRowState(input: ScaleGuardPrecedenceInput): ScaleGuardRowState {
  if (input.scaleUnavailableOnBuild) return 'unavailable';
  if (input.guardStateScale === 'blocked') return 'blocked';
  if (input.cowSnapshotScale === null) return 'not-written';
  return 'ok';
}

/**
 * StatusBar's compact guard chip only needs a boolean: is scale GENUINELY
 * blocked (a real tamper worth naming), as opposed to merely build-unavailable
 * (never named as a guard failure in the compact chip — ROUND 2 decision #2).
 */
export function isScaleGenuinelyBlocked(scaleUnavailableOnBuild: boolean, guardStateScale: 'ok' | 'blocked'): boolean {
  return guardStateScale === 'blocked' && !scaleUnavailableOnBuild;
}

/**
 * Whether the scale-build-unavailable structural state should flip the client
 * card's border to guard-blocked danger styling — it never should, on its own
 * (ROUND 2: "a scale-only 'unavailable on this build' state does NOT flip the
 * card to guard-blocked danger styling, since it is not a tamper").
 */
export function isCardGuardBlocked(
  guardStateTransform: 'ok' | 'blocked',
  guardStateScale: 'ok' | 'blocked',
  scaleUnavailableOnBuild: boolean,
): boolean {
  return guardStateTransform === 'blocked' || isScaleGenuinelyBlocked(scaleUnavailableOnBuild, guardStateScale);
}

/**
 * Normalizes a VFS-style asset path (e.g. `object/mobile/shared_womprat.iff`)
 * to a lowercase, extension-stripped basename for the ROUND 4/5 mismatch
 * warning + name-match-only caveat comparisons — both sides of the comparison
 * (viewportStore.loadStatus.filename and verifiedState.templateName) may carry
 * a full path, so both must be normalized identically before comparing.
 */
export function normalizeAssetBasename(pathOrName: string): string {
  const base = pathOrName.split(/[\\/]/).pop() ?? pathOrName;
  return base.replace(/\.[^./\\]+$/, '').toLowerCase();
}
