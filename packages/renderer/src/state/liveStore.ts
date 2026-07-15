/**
 * packages/renderer/src/state/liveStore.ts — Zustand store for live injection session state.
 *
 * Manages:
 *   - Connection status (idle / connecting / attached / error)
 *   - Injection mode (live / file-patch)
 *   - Disabled reason when injection is unavailable (D-08)
 *   - Verified object state snapshot from the channel
 *   - Raw region bytes for the HexInspector view (D-07)
 *   - D-03 COW snapshot / write-log / per-channel guard state, keyed on the
 *     agent-published focusToken via a small per-identity cache (05-07 ROUND 5,
 *     REVIEWS.md round-4 maintainer decision #1 — the load-bearing identity-
 *     unification fix; ROUND 6 adds a pointer-ABA cross-check + bounded LRU)
 *
 * Source: 03-PATTERNS.md §liveStore.ts; 03-CONTEXT.md §D-08 (file-patch fallback);
 *         05-07-PLAN.md Task 2 (COW/write-log/guard state/identity cache).
 */

import { create } from 'zustand';
import type { VerifiedObjectState } from '@swg/contracts';
import { LIVE_CMD_FLAGS } from '@swg/contracts';
import { writeTransform } from '../hooks/useCommandWriter';

// ─── Types ────────────────────────────────────────────────────────────────────

/** Discriminated union for the live injection connection status. */
export type ConnectionStatus =
  | { kind: 'idle' }
  | { kind: 'connecting' }
  | { kind: 'attached'; pid: number; mappingName: string }
  | { kind: 'error'; reason: string };

/** Whether the toolkit is in live-injection or file-patch mode. */
export type InjectionMode = 'live' | 'file-patch';

/** Copy-on-write snapshot captured at first-sight of an identity (or re-key). */
export interface CowSnapshot {
  transform: Float32Array;
  /** Null until the FIRST scale-bearing write this identity — an explicit,
   *  non-fabricated limitation (REVIEWS.md Fix B), not a bug. */
  scale: Float32Array | null;
  /** DISPLAY ONLY — never used for identity comparison (see focusToken). */
  networkId: string;
  /** DISPLAY ONLY — never used for identity comparison (see focusToken). */
  templateName: string;
}

/** One append-only write-log entry (a completed, guard-accepted write). */
export interface WriteLogEntry {
  id: number;
  atMs: number;
  deltaLabel: string;
  resultingTransform: Float32Array;
  resultingScale: Float32Array;
}

/** Per-channel guard status — transform and scale are gated independently. */
export interface GuardChannelState {
  transform: 'ok' | 'blocked';
  scale: 'ok' | 'blocked';
}

/** What a gate-on-blocked revert discarded, per channel (REVIEWS.md ROUND 4 decision #5). */
export interface LastDiscardedChange {
  addr: string;
  transform?: { expected: Float32Array; got: Float32Array };
  /** `gotVerified: false` — no live-scale read frame field exists this round
   *  (ROUND 5, REVIEWS.md round-4 decision #4); this is an EXPLICIT, typed
   *  degrade, never a silent `got === expected` fabrication. */
  scale?: { expected: Float32Array; got: Float32Array; gotVerified: boolean };
}

/** One per-identity cache slot (ROUND 5 — replaces the single ROUND-4 slot). */
interface IdentitySlot {
  cowSnapshot: CowSnapshot | null;
  writeLog: WriteLogEntry[];
  guardState: GuardChannelState;
  lastDiscardedChange: LastDiscardedChange | null;
  /** Stamped whenever this slot becomes the ACTIVE identity — drives the
   *  bounded-LRU eviction (ROUND 6, Opus LOW 3d). */
  lastActiveMs: number;
}

/** Bounded cache capacity (ROUND 6) — caps memory AND narrows the residual
 *  same-template-realloc ABA window (T-05-46, explicitly accept-watched, not
 *  fully closed by this cap alone). */
const IDENTITY_CACHE_MAX = 64;

function freshGuardState(): GuardChannelState {
  return { transform: 'ok', scale: 'ok' };
}

function freshSlot(state: VerifiedObjectState, nowMs: number): IdentitySlot {
  return {
    cowSnapshot: {
      transform: state.transform.slice(),
      scale: null,
      networkId: state.networkId.toString(),
      templateName: state.templateName,
    },
    writeLog: [],
    guardState: freshGuardState(),
    lastDiscardedChange: null,
    lastActiveMs: nowMs,
  };
}

/** Formats an agent-published x86 pointer for HUD display. `null` (never
 *  guard-checked yet) renders as '0x0'. */
function formatAddr(addr: number | null): string {
  return addr === null ? '0x0' : '0x' + (addr >>> 0).toString(16).toUpperCase();
}

/** No historical scale was ever captured this identity (cowSnapshot.scale
 *  stays null until the first scale-bearing write) — nothing to revert to.
 *  Pass through an identity scale rather than force-writing zeros (REVIEWS.md
 *  Fix B: never fabricate a "revert" the toolkit never actually observed). */
function resolveScaleForSend(scale: Float32Array | null): Float32Array {
  return scale !== null ? scale : new Float32Array([1, 1, 1]);
}

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

  // ─── D-03 COW / write-log / guard state (ROUND 5 — per-identity cache) ────

  /** Per-identity cache, keyed on the agent-published focusToken — NEVER
   *  (networkId, templateName), which collapses to (0, templateName) on
   *  legacy (REVIEWS.md round-4 Opus MEDIUM). */
  identityCache: Map<number, IdentitySlot>;
  /** The focusToken the public top-level fields below currently mirror. */
  currentFocusToken: number | null;
  /** Mirrors identityCache.get(currentFocusToken).cowSnapshot — public shape
   *  UNCHANGED from round 1 (05-10/05-11 need no changes). */
  cowSnapshot: CowSnapshot | null;
  writeLog: WriteLogEntry[];
  guardState: GuardChannelState;
  lastDiscardedChange: LastDiscardedChange | null;
  /** Explicit GUARD_ADDR (offset 396) decode — no hedge (REVIEWS.md ROUND 4
   *  decision #5). Null = agent has never guard-checked a write this session. */
  guardAddr: number | null;

  // ─── Actions ───────────────────────────────────────────────────────────────

  /** Begin attaching to a client process (transitions status to 'connecting'). */
  beginAttach: (clientExe: string) => void;
  /** Attach succeeded — transition to 'attached' + live mode. */
  attachComplete: (pid: number, mappingName: string) => void;
  /** Attach failed — transition to error + file-patch mode with reason (D-08). */
  attachError: (reason: string) => void;
  /** Explicitly set injection mode (e.g. forced file-patch with a reason). */
  setMode: (mode: InjectionMode, reason?: string) => void;
  /** Update the verified object state from the channel. Internally calls
   *  captureSnapshotIfNeeded — do not call that separately from elsewhere. */
  updateState: (state: VerifiedObjectState | null) => void;
  /** Update the raw region bytes for the hex view. */
  updateRegion: (bytes: Uint8Array | null) => void;
  /** Detach from the client process and reset to idle/file-patch. Also resets
   *  identityCache to a fresh empty Map (ROUND 5 — scoped to one attach session). */
  detach: () => void;

  /** Captures (or swaps to) the per-identity cache slot for state.focusToken.
   *  Called from updateState's body — no separate call site. */
  captureSnapshotIfNeeded: (state: VerifiedObjectState) => void;
  /** Appends a completed write to the active identity's write-log. */
  appendWriteLog: (entry: WriteLogEntry) => void;
  /** Per-channel guard setter — transform/scale are independently settable. */
  setGuardState: (channel: 'transform' | 'scale', state: 'ok' | 'blocked') => void;
  /** Explicit GUARD_ADDR setter (called from useChannelReader's decode step). */
  setGuardAddr: (addr: number | null) => void;
  /** Revert a single write-log entry to the state immediately before it (or
   *  cowSnapshot, if reverting the first entry). Gate-on-blocked + coalesced
   *  (REVIEWS.md ROUND 2 decision #3). */
  revertWrite: (id: number) => void;
  /** Revert to the attach-time (or re-key-time) cowSnapshot. Gate-on-blocked
   *  + coalesced (REVIEWS.md ROUND 2 decision #3). */
  revertAll: () => void;
  /** Pure derivation (REVIEWS.md Fix C) — the HUD's "expected" baseline.
   *  Always the LAST successful write, never the (possibly stale) cowSnapshot
   *  once at least one write has succeeded. */
  expectedTransform: () => Float32Array | null;
  /** Pure derivation (REVIEWS.md Fix C), analogous to expectedTransform. */
  expectedScale: () => Float32Array | null;
}

// ─── Private helpers (need get/set from the store creator) ────────────────────

/** Persists a partial slot update into BOTH the active identityCache entry AND
 *  the public top-level mirror fields, in one immutable Map reference. Routes
 *  appendWriteLog / setGuardState / revert's lastDiscardedChange assignment
 *  through this so the cache and the public fields never drift apart. */
function withActiveSlotUpdate(
  get: () => LiveStore,
  updates: Partial<Pick<IdentitySlot, 'cowSnapshot' | 'writeLog' | 'guardState' | 'lastDiscardedChange'>>,
): Partial<LiveStore> {
  const { identityCache, currentFocusToken } = get();
  const result: Partial<LiveStore> = { ...updates };
  if (currentFocusToken !== null) {
    const existing = identityCache.get(currentFocusToken);
    if (existing !== undefined) {
      const newCache = new Map(identityCache);
      newCache.set(currentFocusToken, { ...existing, ...updates });
      result.identityCache = newCache;
    }
  }
  return result;
}

/** Shared send logic for revertWrite/revertAll (REVIEWS.md ROUND 2 decision #3):
 *  gate-on-blocked (independently per channel), disclose what was discarded
 *  BEFORE sending, then send ONE coalesced writeTransform call. */
function sendRevertPayload(
  get: () => LiveStore,
  set: (partial: Partial<LiveStore>) => void,
  mappingName: string,
  targetTransform: Float32Array,
  targetScale: Float32Array | null,
): void {
  const { guardState, guardAddr, verifiedState, cowSnapshot } = get();
  const transformBlocked = guardState.transform === 'blocked';
  const scaleBlocked = guardState.scale === 'blocked';
  const expectedT = get().expectedTransform();
  const expectedS = get().expectedScale();

  let discarded: LastDiscardedChange | null = null;
  if (transformBlocked || scaleBlocked) {
    discarded = {
      addr: formatAddr(guardAddr),
      transform: transformBlocked
        ? {
            expected: (expectedT ?? cowSnapshot!.transform).slice(),
            got: (verifiedState?.transform ?? targetTransform).slice(),
          }
        : undefined,
      scale: scaleBlocked
        ? {
            // Falls back to an identity scale in the (rare) case no scale has
            // EVER been captured or written this identity — there is nothing
            // real to disclose, so this is an explicit non-fabricated stand-in,
            // consistent with resolveScaleForSend's own fallback below.
            expected: (expectedS ?? cowSnapshot!.scale ?? new Float32Array([1, 1, 1])).slice(),
            got: (expectedS ?? cowSnapshot!.scale ?? new Float32Array([1, 1, 1])).slice(),
            gotVerified: false,
          }
        : undefined,
    };
  }

  set(withActiveSlotUpdate(get, { lastDiscardedChange: discarded }));

  const flags = (transformBlocked || scaleBlocked) ? LIVE_CMD_FLAGS.REBASELINE_GUARD : 0;
  writeTransform(mappingName, targetTransform, resolveScaleForSend(targetScale), flags);
}

// ─── Store implementation ─────────────────────────────────────────────────────

export const useLiveStore = create<LiveStore>((set, get) => ({
  status:         { kind: 'idle' },
  mode:           'file-patch',
  disabledReason: null,
  verifiedState:  null,
  regionBytes:    null,

  identityCache:      new Map(),
  currentFocusToken:  null,
  cowSnapshot:        null,
  writeLog:           [],
  guardState:         freshGuardState(),
  lastDiscardedChange: null,
  guardAddr:          null,

  beginAttach: (_clientExe: string) =>
    set({ status: { kind: 'connecting' }, disabledReason: null }),

  attachComplete: (pid: number, mappingName: string) =>
    set({ status: { kind: 'attached', pid, mappingName }, mode: 'live' }),

  attachError: (reason: string) =>
    set({ status: { kind: 'error', reason }, mode: 'file-patch', disabledReason: reason }),

  setMode: (mode: InjectionMode, reason?: string) =>
    set({ mode, disabledReason: reason ?? null }),

  updateState: (state: VerifiedObjectState | null) => {
    if (state !== null) get().captureSnapshotIfNeeded(state);
    set({ verifiedState: state });
  },

  updateRegion: (bytes: Uint8Array | null) =>
    set({ regionBytes: bytes }),

  detach: () =>
    set({
      status:         { kind: 'idle' },
      mode:           'file-patch',
      verifiedState:  null,
      regionBytes:    null,
      disabledReason: null,
      // ROUND 5 — the per-identity cache is scoped to ONE attach session; a
      // fresh attach starts a brand-new cache, it does not persist identities
      // across detach/reattach cycles (matches D-03's model).
      identityCache:      new Map(),
      currentFocusToken:  null,
      cowSnapshot:        null,
      writeLog:           [],
      guardState:         freshGuardState(),
      lastDiscardedChange: null,
      guardAddr:          null,
    }),

  captureSnapshotIfNeeded: (state: VerifiedObjectState) => {
    const { currentFocusToken, identityCache } = get();
    // Ordinary continuing-same-object tick — the active slot is already correct.
    if (currentFocusToken !== null && currentFocusToken === state.focusToken) return;

    const nowMs = Date.now();
    const existing = identityCache.get(state.focusToken);
    const sameIdentity =
      existing !== undefined &&
      existing.cowSnapshot !== null &&
      existing.cowSnapshot.templateName === state.templateName &&
      existing.cowSnapshot.networkId === state.networkId.toString();

    const newCache = new Map(identityCache);
    let slot: IdentitySlot;

    if (existing !== undefined && sameIdentity) {
      // Flip-back to a previously-seen, CONFIRMED-same identity — restore
      // its ORIGINAL baseline and full write-log verbatim (closes the lossy
      // focus-flip A->B->A bug, REVIEWS.md round-4 Opus MEDIUM NEW-ISSUE).
      slot = { ...existing, lastActiveMs: nowMs };
    } else {
      // Genuinely new identity, OR (ROUND 6) a cache HIT whose stored
      // identity does NOT match the current object at this address — a
      // focusToken match alone does not prove the same object still owns
      // that address (pointer-ABA). Evict the stale entry (a SAFE MISS) and
      // capture fresh, exactly as if no slot had been found.
      if (existing !== undefined) newCache.delete(state.focusToken);
      if (newCache.size >= IDENTITY_CACHE_MAX) {
        let oldestToken: number | null = null;
        let oldestMs = Infinity;
        for (const [token, s] of newCache) {
          if (s.lastActiveMs < oldestMs) {
            oldestMs = s.lastActiveMs;
            oldestToken = token;
          }
        }
        if (oldestToken !== null) newCache.delete(oldestToken);
      }
      slot = freshSlot(state, nowMs);
    }

    newCache.set(state.focusToken, slot);

    set({
      identityCache:      newCache,
      currentFocusToken:  state.focusToken,
      cowSnapshot:        slot.cowSnapshot,
      writeLog:           slot.writeLog,
      guardState:         slot.guardState,
      lastDiscardedChange: slot.lastDiscardedChange,
    });
  },

  appendWriteLog: (entry: WriteLogEntry) => {
    const newWriteLog = [...get().writeLog, entry];
    set(withActiveSlotUpdate(get, { writeLog: newWriteLog }));
  },

  setGuardState: (channel: 'transform' | 'scale', state: 'ok' | 'blocked') => {
    const newGuardState = { ...get().guardState, [channel]: state };
    set(withActiveSlotUpdate(get, { guardState: newGuardState }));
  },

  setGuardAddr: (addr: number | null) => set({ guardAddr: addr }),

  revertWrite: (id: number) => {
    const { writeLog, cowSnapshot, status } = get();
    if (status.kind !== 'attached' || cowSnapshot === null) return;
    const idx = writeLog.findIndex((e) => e.id === id);
    if (idx < 0) return;

    const prev = idx > 0 ? writeLog[idx - 1] : null;
    const targetTransform = prev ? prev.resultingTransform : cowSnapshot.transform;
    const targetScale = prev ? prev.resultingScale : cowSnapshot.scale;

    sendRevertPayload(get, set, status.mappingName, targetTransform, targetScale);

    // The reverted entry and everything after it is undone.
    const truncated = writeLog.slice(0, idx);
    set(withActiveSlotUpdate(get, { writeLog: truncated }));
  },

  revertAll: () => {
    const { cowSnapshot, status } = get();
    if (status.kind !== 'attached' || cowSnapshot === null) return;

    sendRevertPayload(get, set, status.mappingName, cowSnapshot.transform, cowSnapshot.scale);

    set(withActiveSlotUpdate(get, { writeLog: [] }));
  },

  expectedTransform: () => {
    const { writeLog, cowSnapshot } = get();
    if (writeLog.length > 0) return writeLog[writeLog.length - 1].resultingTransform;
    return cowSnapshot?.transform ?? null;
  },

  expectedScale: () => {
    const { writeLog, cowSnapshot } = get();
    if (writeLog.length > 0) return writeLog[writeLog.length - 1].resultingScale;
    return cowSnapshot?.scale ?? null;
  },
}));
