/**
 * packages/renderer/src/state/liveStore.ts — Zustand store for live injection session state.
 *
 * Manages:
 *   - Connection status (idle / connecting / attached / error)
 *   - Injection mode (live / file-patch)
 *   - Disabled reason when injection is unavailable (D-08)
 *   - Verified object state snapshot from the channel
 *   - Raw region bytes for the HexInspector view (D-07)
 *
 * Source: 03-PATTERNS.md §liveStore.ts; 03-CONTEXT.md §D-08 (file-patch fallback).
 */

import { create } from 'zustand';
import type { VerifiedObjectState } from '@swg/contracts';

// ─── Types ────────────────────────────────────────────────────────────────────

/** Discriminated union for the live injection connection status. */
export type ConnectionStatus =
  | { kind: 'idle' }
  | { kind: 'connecting' }
  | { kind: 'attached'; pid: number; mappingName: string }
  | { kind: 'error'; reason: string };

/** Whether the toolkit is in live-injection or file-patch mode. */
export type InjectionMode = 'live' | 'file-patch';

// ─── Store interface ──────────────────────────────────────────────────────────

export interface LiveStore {
  /** Current connection status. Starts idle. */
  status: ConnectionStatus;
  /** Current injection mode. Starts file-patch. */
  mode: InjectionMode;
  /** Reason injection is unavailable (D-08). Null when live or no specific error. */
  disabledReason: string | null;
  /** Latest verified object state from the channel. Null until first read. */
  verifiedState: VerifiedObjectState | null;
  /** Raw region bytes for the HexInspector view (D-07). Null until a region read. */
  regionBytes: Uint8Array | null;

  // ─── Actions ───────────────────────────────────────────────────────────────

  /** Begin attaching to a client process (transitions status to 'connecting'). */
  beginAttach: (clientExe: string) => void;
  /** Attach succeeded — transition to 'attached' + live mode. */
  attachComplete: (pid: number, mappingName: string) => void;
  /** Attach failed — transition to error + file-patch mode with reason (D-08). */
  attachError: (reason: string) => void;
  /** Explicitly set injection mode (e.g. forced file-patch with a reason). */
  setMode: (mode: InjectionMode, reason?: string) => void;
  /** Update the verified object state from the channel. */
  updateState: (state: VerifiedObjectState | null) => void;
  /** Update the raw region bytes for the hex view. */
  updateRegion: (bytes: Uint8Array | null) => void;
  /** Detach from the client process and reset to idle/file-patch. */
  detach: () => void;
}

// ─── Store implementation ─────────────────────────────────────────────────────

export const useLiveStore = create<LiveStore>((set) => ({
  status:         { kind: 'idle' },
  mode:           'file-patch',
  disabledReason: null,
  verifiedState:  null,
  regionBytes:    null,

  beginAttach: (_clientExe: string) =>
    set({ status: { kind: 'connecting' }, disabledReason: null }),

  attachComplete: (pid: number, mappingName: string) =>
    set({ status: { kind: 'attached', pid, mappingName }, mode: 'live' }),

  attachError: (reason: string) =>
    set({ status: { kind: 'error', reason }, mode: 'file-patch', disabledReason: reason }),

  setMode: (mode: InjectionMode, reason?: string) =>
    set({ mode, disabledReason: reason ?? null }),

  updateState: (state: VerifiedObjectState | null) =>
    set({ verifiedState: state }),

  updateRegion: (bytes: Uint8Array | null) =>
    set({ regionBytes: bytes }),

  detach: () =>
    set({
      status:         { kind: 'idle' },
      mode:           'file-patch',
      verifiedState:  null,
      regionBytes:    null,
      disabledReason: null,
    }),
}));
