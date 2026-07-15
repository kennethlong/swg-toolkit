/**
 * packages/renderer/src/panels/viewport/liveDragTelemetry.ts
 *
 * Zero-allocation imperative pub/sub bridging TransformGizmo's (05-10) R3F-
 * scoped drag `onChange` tick to TransformReadoutBar's (05-11 Task 2) plain-
 * DOM numbox mirror + floating delta readout — the ONE sanctioned way live
 * drag values cross from the Canvas-scoped gizmo to the DOM-scoped readout
 * bar WITHOUT threading them through React props/state (LIVE-03 SC1
 * Interaction Contract: "HUD numbox/delta text updates during drag are
 * imperative (refs/direct DOM), never per-frame React state churn").
 *
 * TransformGizmo already recomputes `_scratchTransform`/`_scratchScale` on
 * every onChange tick (zero-alloc, module-level buffers) — publishDragTick
 * forwards those SAME buffer references to subscribers. Subscribers that need
 * to retain a value across ticks MUST copy it (the readout bar's refs do this
 * via direct index writes into their OWN scratch arrays, mirroring
 * useChannelReader.ts's "retain = copy once" contract).
 *
 * Source: 05-11-PLAN.md Task 2 action text ("the simplest wiring is for
 * TransformGizmo to also write into a small shared ref/event-emitter this bar
 * subscribes to imperatively").
 */

export type DragTickListener = (transform12: Float32Array, scale3: Float32Array) => void;

let listeners: DragTickListener[] = [];

/** TransformReadoutBar subscribes once per mount; unsubscribes on unmount. */
export function subscribeDragTick(fn: DragTickListener): () => void {
  listeners.push(fn);
  return () => { listeners = listeners.filter((l) => l !== fn); };
}

/**
 * TransformGizmo calls this from trySendWrite on EVERY onChange tick (up to
 * 60fps during a drag), regardless of whether the WRITE itself was suppressed
 * by a guard/offline check — drei's gizmo has already moved the 3D object
 * locally by the time onChange fires, so the numbox mirror reflects the
 * visual drag, not the write outcome.
 */
export function publishDragTick(transform12: Float32Array, scale3: Float32Array): void {
  for (const fn of listeners) fn(transform12, scale3);
}

/** Test-only reset (mirrors other module-singleton test-reset helpers in this
 *  codebase, e.g. resetConsoleCaptureForTests) — clears all subscribers. */
export function resetDragTelemetryForTests(): void {
  listeners = [];
}
