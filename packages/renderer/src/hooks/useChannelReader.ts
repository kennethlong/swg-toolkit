/**
 * packages/renderer/src/hooks/useChannelReader.ts
 * React hook that polls the shared-memory channel on requestAnimationFrame
 * once the live-inject session is 'attached'.
 *
 * Reads the LIVE_CHANNEL_LAYOUT-formatted ArrayBuffer using the seqlock
 * protocol, parses into VerifiedObjectState, and updates liveStore.
 * Also feeds raw channel bytes to liveStore.updateRegion for the
 * HexInspector raw memory view (D-07, stretch goal), and decodes the
 * agent-published guard status / address into liveStore (05-07 Task 3).
 *
 * Phase 3 was READ-VERIFY ONLY. Phase 5 (05-07) makes this the allocation-
 * honest READ half of the write/read loop — see the zero-allocation notes
 * below (LIVE-03 SC1, read direction — REVIEWS.md MEDIUM finding, previously
 * silently half-met).
 *
 * Source: 03-06b-PLAN.md Task 1; 03-CONTEXT.md §D-01; 05-07-PLAN.md Task 3.
 * Pitfall 5 guard: never cache ArrayBuffer.Data() across frames;
 *   always call addon.readChannelView() fresh each RAF tick.
 *
 * Seqlock read protocol (must match agent channel.cpp write):
 *   1. Read seq1 = view[SEQ_COUNTER.offset] — odd = writer active → return null
 *   2. Read payload (transform, networkId, templateName, liveness, focusToken)
 *   3. Read seq2 = view[SEQ_COUNTER.offset] — seq1 !== seq2 = torn read → null
 *   4. Return parsed VerifiedObjectState
 *
 * Zero-allocation investigation (05-07 Task 3): channel_binding.cpp's
 * ReadChannelView returns `it->second.abRef.Value()` — a persistent
 * Napi::Reference to the SAME ArrayBuffer JS object created once at
 * openChannel time, not a fresh buffer per call. This means `buf` is the
 * IDENTICAL object reference on every poll tick for a given open channel, so
 * caching a single Uint8Array VIEW keyed on `buf`'s identity (getRegionView
 * below) is a genuine zero-copy technique here, not just a "one unavoidable
 * native-layer allocation" approximation — the region view is only ever
 * reconstructed if the channel is closed and reopened (a new mapping, hence
 * a new backing ArrayBuffer).
 */

import { useEffect, useRef } from 'react';
import { useLiveStore } from '../state/liveStore';
import { log } from '../services/logService';
import { LIVE_CHANNEL_LAYOUT, LIVE_GUARD_FLAGS } from '@swg/contracts';
import type { VerifiedObjectState } from '@swg/contracts';
import { parseDecorationCapture, readDecorationResult, decorationResultLabel } from '../services/decorationChannel';
import { handleDecorationCapture } from '../services/decorationPersistOrchestrator';

// Path B: require the addon directly (nodeIntegration:true in the renderer).
// eslint-disable-next-line @typescript-eslint/no-require-imports
const addon = require('@swg/live-inject') as {
  readChannelView: (name: string) => ArrayBuffer | null;
  closeChannel: (name: string) => void;
};

// ─── Preallocated, process-lifetime buffers (never reallocated) ──────────────

/** Reused every parseChannelView call — the transform read no longer
 *  allocates via buf.slice() (05-07 Task 3, closes the half-met SC1 finding).
 *  Any consumer that needs to retain the value across ticks MUST .slice() it
 *  ONCE at the point of retention (liveStore's captureSnapshotIfNeeded does
 *  exactly this). */
const preallocTransform = new Float32Array(12);

/** getRegionView's single-entry cache — keyed on the backing ArrayBuffer's
 *  object identity (see the module doc-comment's investigation conclusion). */
let cachedRegionBuf: ArrayBuffer | null = null;
let cachedRegionView: Uint8Array | null = null;

/**
 * Returns a Uint8Array view over `buf`, reusing the SAME view object across
 * calls as long as `buf` is the SAME backing ArrayBuffer (true every tick for
 * an open channel — see the module doc-comment). Only reconstructs the view
 * when the buffer identity actually changes (channel closed + reopened).
 */
export function getRegionView(buf: ArrayBuffer): Uint8Array {
  if (cachedRegionBuf !== buf) {
    cachedRegionBuf = buf;
    cachedRegionView = new Uint8Array(buf);
  }
  return cachedRegionView!;
}

// ─── Guard-field decode (module-private types, exported for testing) ─────────

export interface DecodedGuardFields {
  transformBlocked: boolean;
  scaleBlocked: boolean;
  /** Agent-published x86 pointer of the object last write-guard-checked.
   *  `null` when GUARD_ADDR is still 0 (none checked yet this session). */
  guardAddr: number | null;
}

/**
 * Reads GUARD_STATUS (offset 392) and GUARD_ADDR (offset 396) — single
 * aligned words, no seqlock (a torn read of one stale-but-valid word is
 * harmless, per 05-01's design). Explicit, wired decode — no hedge (05-07
 * ROUND 4, REVIEWS.md round-3 maintainer decision #5).
 */
export function decodeGuardFields(buf: ArrayBuffer): DecodedGuardFields {
  const view = new DataView(buf);
  const guardStatus = view.getUint32(LIVE_CHANNEL_LAYOUT.GUARD_STATUS.offset, true);
  const guardAddrRaw = view.getUint32(LIVE_CHANNEL_LAYOUT.GUARD_ADDR.offset, true);
  return {
    transformBlocked: (guardStatus & LIVE_GUARD_FLAGS.TRANSFORM_REFUSED) !== 0,
    scaleBlocked: (guardStatus & LIVE_GUARD_FLAGS.SCALE_REFUSED) !== 0,
    guardAddr: guardAddrRaw === 0 ? null : guardAddrRaw,
  };
}

// ─── Liveness watchdog (client-exit detection) ───────────────────────────────

/** How often to check the target process is still alive (ms). */
export const LIVENESS_CHECK_MS = 1000;

/** Channel poll cadence (ms). ~30fps when the toolkit is foreground; Chromium
 *  throttles background timers to ~1/s but — unlike requestAnimationFrame — does
 *  NOT pause them, so the HUD keeps updating and the liveness check keeps running
 *  while the SWG client holds the foreground (fullscreen). */
export const POLL_INTERVAL_MS = 33;

/**
 * True if the target process is still running. Probes existence via
 * process.kill(pid, 0), which sends NO signal — not throwing = alive; ESRCH =
 * gone; EPERM = alive but access-limited.
 *
 * This is the correct client-exit signal. Channel/SEQ_COUNTER staleness is NOT:
 * the agent skips channelWrite (and so never bumps the counter) whenever the
 * player is null — loading, login, char-select, zoning — so a perfectly-alive
 * client looks "frozen" (agent_main.cpp: `if (!player) { Sleep(100); continue; }`).
 * A seqlock-staleness watchdog therefore false-positives ~2s into every launch,
 * before the world even loads.
 */
export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

// ─── Channel parser ────────────────────────────────────────────────────────────

/**
 * Parse a LIVE_CHANNEL_LAYOUT-formatted ArrayBuffer with the seqlock protocol.
 * Returns null on mid-write (odd seq) or torn read (seq mismatch).
 *
 * The transform field is written element-by-element into the SAME reused
 * preallocTransform buffer (DataView.getFloat32 reads, matching the existing
 * per-field DataView idiom already used for networkId/liveness) — no
 * buf.slice()/new Float32Array() per call (05-07 Task 3).
 */
export function parseChannelView(buf: ArrayBuffer): VerifiedObjectState | null {
  const view = new DataView(buf);
  const L = LIVE_CHANNEL_LAYOUT;

  // Seqlock step 1 — odd seq means writer is mid-write; skip this frame
  const seq1 = view.getUint32(L.SEQ_COUNTER.offset, true);
  if ((seq1 & 1) !== 0) return null;

  for (let i = 0; i < 12; i++) {
    preallocTransform[i] = view.getFloat32(L.TRANSFORM.offset + i * 4, true);
  }

  const networkIdLo = view.getUint32(L.NETWORK_ID.offset, true);
  const networkIdHi = view.getUint32(L.NETWORK_ID.offset + 4, true);
  const networkId = (BigInt(networkIdHi) << 32n) | BigInt(networkIdLo);

  // Read template name: find null terminator, decode as ASCII
  const nameBytes = new Uint8Array(buf, L.TEMPLATE_NAME.offset, L.TEMPLATE_NAME.length);
  let nullIdx = nameBytes.indexOf(0);
  if (nullIdx < 0) nullIdx = L.TEMPLATE_NAME.length;
  const templateName = new TextDecoder('ascii').decode(nameBytes.slice(0, nullIdx));

  const livenessFlags = view.getUint32(L.LIVENESS.offset, true);
  const playerAlive = (livenessFlags & 0x1) !== 0 && (livenessFlags & 0x2) === 0;
  const hasTarget = (livenessFlags & 0x4) !== 0; // bit2
  const targetUnavailableOnBuild = (livenessFlags & 0x8) !== 0; // bit3 (ROUND 2 redefined)
  const scaleUnavailableOnBuild = (livenessFlags & 0x10) !== 0; // bit4 (ROUND 2 NEW)
  // bit5 (scaleGuardUnavailableOnBuild) is intentionally NOT decoded here — it
  // is left as AGENT-ONLY telemetry this round (05-03 publishes it; no
  // renderer field consumes it yet), per the maintainer's explicit "document
  // as agent-only" option (REVIEWS.md round-3 maintainer decision #5) — a
  // deliberate, documented scope boundary, not a missed bit.

  const focusToken = view.getUint32(L.FOCUS_TOKEN.offset, true);

  // Seqlock step 2 — torn-read check; skip frame if seq changed during our read
  const seq2 = view.getUint32(L.SEQ_COUNTER.offset, true);
  if (seq1 !== seq2) return null;

  return {
    networkId,
    templateName,
    transform: preallocTransform,
    playerAlive,
    hasTarget,
    targetUnavailableOnBuild,
    scaleUnavailableOnBuild,
    focusToken,
  };
}

// ─── React hook ───────────────────────────────────────────────────────────────

/**
 * Activates a setTimeout poll loop when live-inject status is 'attached'.
 * No-ops when idle, connecting, or in error state. setTimeout (not rAF) so the
 * loop keeps running — throttled, not paused — while the SWG client holds the
 * foreground and the toolkit window is occluded.
 *
 * On each poll tick (if buf is non-null):
 *   - updateRegion(getRegionView(buf)) — feeds raw bytes to HexInspector (D-07)
 *   - setGuardState/setGuardAddr       — agent-published guard observability (05-07)
 *   - updateState(parsed)              — updates verified state (STATE 2)
 *
 * Client-exit detection is by process liveness (isPidAlive), throttled to
 * LIVENESS_CHECK_MS — NOT channel staleness (the agent stops writing when the
 * player is null, so a live-but-loading client would false-disconnect).
 */
export function useChannelReader(): void {
  const status = useLiveStore((s) => s.status);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    if (status.kind !== 'attached') return;
    const { pid, mappingName } =
      status as { kind: 'attached'; pid: number; mappingName: string };

    let stopped = false;
    let lastLiveCheck = Date.now(); // first liveness check ~LIVENESS_CHECK_MS after attach
    // Decoration-persist round trip (model D): process each new CAPTURE / RESULT epoch once.
    // The mapping is zeroed at openChannel, so both start at 0 and the first real edit (epoch 1)
    // is strictly greater. Local to this effect → reset cleanly on re-attach.
    let lastCaptureEpoch = 0;
    let lastResultEpoch = 0;

    function poll() {
      if (stopped) return;

      // Client-exit detection (throttled) — is the target process still alive?
      const now = Date.now();
      if (now - lastLiveCheck >= LIVENESS_CHECK_MS) {
        lastLiveCheck = now;
        if (!isPidAlive(pid)) {
          stopped = true;
          try { addon.closeChannel(mappingName); } catch { /* mapping already gone */ }
          log('warn', 'log', 'SWG client exited — live session ended.');
          useLiveStore.getState().detach();
          return; // stop polling; the effect re-runs on the status change and no-ops
        }
      }

      const buf: ArrayBuffer | null = addon.readChannelView(mappingName);
      if (buf) {
        useLiveStore.getState().updateRegion(getRegionView(buf));

        const guard = decodeGuardFields(buf);
        useLiveStore.getState().setGuardState('transform', guard.transformBlocked ? 'blocked' : 'ok');
        useLiveStore.getState().setGuardState('scale', guard.scaleBlocked ? 'blocked' : 'ok');
        useLiveStore.getState().setGuardAddr(guard.guardAddr);

        const state = parseChannelView(buf);
        if (state !== null) useLiveStore.getState().updateState(state);

        // Decoration persist (model D): a new CAPTURE epoch → assemble + rebind; a new RESULT
        // epoch → surface the outcome. One-shot per epoch (guarded by the last-seen counters).
        const cap = parseDecorationCapture(buf);
        if (cap !== null && cap.epoch > lastCaptureEpoch) {
          lastCaptureEpoch = cap.epoch;
          handleDecorationCapture(cap.epoch, cap.capture, {
            mappingName,
            clientExe: useLiveStore.getState().clientLabel,
          });
        }
        const res = readDecorationResult(buf);
        if (res.epoch > lastResultEpoch) {
          lastResultEpoch = res.epoch;
          const level = res.code === 0 ? 'info' : 'warn';
          log(level, 'log', `Decoration rebind #${res.epoch}: ${decorationResultLabel(res.code)}.`);
        }
      }
      timerRef.current = setTimeout(poll, POLL_INTERVAL_MS);
    }

    timerRef.current = setTimeout(poll, 0);
    return () => { stopped = true; if (timerRef.current !== undefined) clearTimeout(timerRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status.kind === 'attached' ? (status as any).mappingName : null]); // eslint-disable-line @typescript-eslint/no-explicit-any
}
