/**
 * packages/renderer/src/hooks/useCommandWriter.ts
 * Plain, synchronous, zero-allocation imperative write path into the
 * host-to-agent command region (05-01/05-04's writeCommand N-API export).
 *
 * NOT a React hook (despite the `use` prefix matching this phase's PATTERNS.md
 * naming convention) — a set of plain exported functions, mirroring
 * useLiveService.ts's "plain async functions so button/drag handlers can call
 * them directly" idiom. writeTransform is called imperatively from the 05-10
 * gizmo drag handler on every drag-move event (flags always 0 from that call
 * site) and from liveStore's revertAll/revertWrite (05-07 Task 2) with a
 * non-zero flags argument ONLY when the relevant guard channel is blocked.
 *
 * Zero-allocation contract (LIVE-03 SC1, write direction): TWO Float32Array
 * buffers (12 floats / 3 floats) are allocated ONCE at module load and reused
 * for the entire process lifetime — writeTransform/writeStop/
 * writeRebaselineGuard never allocate a new typed array per call. A caller
 * that calls writeTransform 1000 times observes the SAME buffer object
 * references passed to addon.writeCommand every time.
 *
 * Source: 05-07-PLAN.md Task 1; 05-01-PLAN.md / 05-04-PLAN.md (writeCommand
 * signature, LIVE_CMD_FLAGS); 05-03-PLAN.md ROUND 2 (agent-side coalesce —
 * a command carrying REBASELINE_GUARD alongside a real payload is APPLIED).
 */

import { LIVE_CMD_FLAGS } from '@swg/contracts';

// Path B: require the addon directly (nodeIntegration:true in the renderer) —
// mirrors useChannelReader.ts's own addon-typing convention.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const addon = require('@swg/live-inject') as {
  writeCommand: (
    name: string,
    transform: Float32Array,
    scale: Float32Array,
    flags: number,
  ) => void;
};

// ─── Preallocated, process-lifetime buffers (never reallocated) ──────────────

const preallocTransform = new Float32Array(12);
const preallocScale = new Float32Array(3);

// ─── Writers ──────────────────────────────────────────────────────────────────

/**
 * Copies `transform` (12 values) and `scale` (3 values) into the preallocated
 * module-level buffers and sends them synchronously via `addon.writeCommand`.
 *
 * `flags` defaults to 0 — a gizmo drag never sets it. Passing
 * `LIVE_CMD_FLAGS.REBASELINE_GUARD` coalesces a rebaseline directive with this
 * SAME real payload into ONE command (liveStore's gate-on-blocked revert
 * actions are the only callers that ever pass a non-zero flags value).
 */
export function writeTransform(
  mappingName: string,
  transform: ArrayLike<number>,
  scale: ArrayLike<number>,
  flags: number = 0,
): void {
  for (let i = 0; i < 12; i++) preallocTransform[i] = transform[i] ?? 0;
  for (let i = 0; i < 3; i++) preallocScale[i] = scale[i] ?? 0;
  addon.writeCommand(mappingName, preallocTransform, preallocScale, flags);
}

/**
 * Zeroes the preallocated buffers (reused, not reallocated) and sends
 * STOP_REQUESTED. useLiveService.ts's detachUI() calls this on a bounded
 * retry loop, polling the agent's sticky GUARD_FLAG_STOPPING acknowledgement.
 */
export function writeStop(mappingName: string): void {
  preallocTransform.fill(0);
  preallocScale.fill(0);
  addon.writeCommand(mappingName, preallocTransform, preallocScale, LIVE_CMD_FLAGS.STOP_REQUESTED);
}

/**
 * Standalone rebaseline-only primitive (REVIEWS.md ROUND 1 Opus MEDIUM fix).
 * Reuses whatever the preallocated buffers currently hold — their contents are
 * irrelevant for a rebaseline-only command, though as of 05-03 ROUND 2 the
 * agent's coalesce logic will attempt to apply whatever payload accompanies
 * the flag. liveStore's Task 2 revert actions do NOT use this helper for that
 * reason — they call writeTransform directly with a REAL payload instead.
 */
export function writeRebaselineGuard(mappingName: string): void {
  addon.writeCommand(mappingName, preallocTransform, preallocScale, LIVE_CMD_FLAGS.REBASELINE_GUARD);
}
