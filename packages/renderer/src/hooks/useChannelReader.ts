/**
 * packages/renderer/src/hooks/useChannelReader.ts
 * React hook that polls the shared-memory channel on requestAnimationFrame
 * once the live-inject session is 'attached'.
 *
 * Reads the LIVE_CHANNEL_LAYOUT-formatted ArrayBuffer using the seqlock
 * protocol, parses into VerifiedObjectState, and updates liveStore.
 * Also feeds raw channel bytes to liveStore.updateRegion for the
 * HexInspector raw memory view (D-07, stretch goal).
 *
 * Phase 3 is READ-VERIFY ONLY — no write path.
 *
 * Source: 03-06b-PLAN.md Task 1; 03-CONTEXT.md §D-01.
 * Pitfall 5 guard: never cache ArrayBuffer.Data() across frames;
 *   always call addon.readChannelView() fresh each RAF tick.
 *
 * Seqlock read protocol (must match agent channel.cpp write):
 *   1. Read seq1 = view[SEQ_COUNTER.offset] — odd = writer active → return null
 *   2. Read payload (transform, networkId, templateName, liveness)
 *   3. Read seq2 = view[SEQ_COUNTER.offset] — seq1 !== seq2 = torn read → null
 *   4. Return parsed VerifiedObjectState
 */

import { useEffect, useRef } from 'react';
import { useLiveStore } from '../state/liveStore';
import { LIVE_CHANNEL_LAYOUT } from '@swg/contracts';
import type { VerifiedObjectState } from '@swg/contracts';

// Path B: require the addon directly (nodeIntegration:true in the renderer).
// eslint-disable-next-line @typescript-eslint/no-require-imports
const addon = require('@swg/live-inject') as {
  readChannelView: (name: string) => ArrayBuffer | null;
};

// ─── Channel parser (module-private) ──────────────────────────────────────────

/**
 * Parse a LIVE_CHANNEL_LAYOUT-formatted ArrayBuffer with the seqlock protocol.
 * Returns null on mid-write (odd seq) or torn read (seq mismatch).
 *
 * buf.slice is used (not a typed-array view) to avoid cross-frame aliasing
 * (RESEARCH.md §Common Pitfalls §Pitfall 5).
 */
function parseChannelView(buf: ArrayBuffer): VerifiedObjectState | null {
  const view = new DataView(buf);
  const L = LIVE_CHANNEL_LAYOUT;

  // Seqlock step 1 — odd seq means writer is mid-write; skip this frame
  const seq1 = view.getUint32(L.SEQ_COUNTER.offset, true);
  if ((seq1 & 1) !== 0) return null;

  // Read payload — use buf.slice (creates a copy) to avoid aliasing the
  // caller's ArrayBuffer across frames (Pitfall 5 guard).
  const transform = new Float32Array(
    buf.slice(L.TRANSFORM.offset, L.TRANSFORM.offset + L.TRANSFORM.length),
  );

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

  // Seqlock step 2 — torn-read check; skip frame if seq changed during our read
  const seq2 = view.getUint32(L.SEQ_COUNTER.offset, true);
  if (seq1 !== seq2) return null;

  return { networkId, templateName, transform, playerAlive };
}

// ─── React hook ───────────────────────────────────────────────────────────────

/**
 * Activates a requestAnimationFrame poll loop when live-inject status is
 * 'attached'. No-ops when idle, connecting, or in error state.
 *
 * On each poll frame (if buf is non-null):
 *   - updateRegion(new Uint8Array(buf)) — feeds raw bytes to HexInspector (D-07)
 *   - updateState(parsed)              — updates verified state (STATE 2)
 */
export function useChannelReader(): void {
  const status = useLiveStore((s) => s.status);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    if (status.kind !== 'attached') return;
    const mappingName = (status as { kind: 'attached'; mappingName: string }).mappingName;

    function poll() {
      const buf: ArrayBuffer | null = addon.readChannelView(mappingName);
      if (buf) {
        useLiveStore.getState().updateRegion(new Uint8Array(buf));
        const state = parseChannelView(buf);
        if (state !== null) useLiveStore.getState().updateState(state);
      }
      rafRef.current = requestAnimationFrame(poll);
    }

    rafRef.current = requestAnimationFrame(poll);
    return () => { cancelAnimationFrame(rafRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status.kind === 'attached' ? (status as any).mappingName : null]); // eslint-disable-line @typescript-eslint/no-explicit-any
}
