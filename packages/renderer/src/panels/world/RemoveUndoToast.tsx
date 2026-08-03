/**
 * packages/renderer/src/panels/world/RemoveUndoToast.tsx
 * 8s auto-dismiss undo toast for the World panel's per-row Remove action (D-03) — 05.1-13 Task 2.
 *
 * Structurally mirrors `DeleteUndoToast.tsx` (pending-diff `useEffect` at `:68-92`, 8s timer at
 * `:30`/`:61-64`, toast shell at `:146-166`) but is PURELY presentational (ROUND 5/V1 — the
 * round's anchor finding): it takes a REQUIRED `onUndo: (entry: RemovedRowEntry) => void` prop
 * and NEVER calls `restore()`/any write helper itself — it has zero knowledge of
 * `resolveOverridePair()`, `WorldEditorBuilding`, or the write path. `WorldPanel.tsx` owns the
 * ENTIRE Undo restore end-to-end (resolve → add-back → restore → refresh).
 *
 * Deliberately panel-scoped (mounted/unmounted with WorldPanel.tsx, NOT globally in App.tsx like
 * DeleteUndoToast) — this is the documented, accepted root cause of a mid-window navigation
 * forfeiting a plain (non-sticky) toast's remaining window (Plan 15 gap ledger item (g)).
 *
 * TWO deliberate deviations from DeleteUndoToast.tsx's literal shape (both load-bearing for the
 * "a failed Undo is never silently superseded/dismissed while unresolved" guarantee, T-05.1-13f):
 *   1. While the CURRENTLY-DISPLAYED entry has a live `undoErrors` entry for its id AND is still
 *      in `pending` ("sticky"), the pending-diff effect returns EARLY — it does NOT run the
 *      removed/added diff and does NOT fold `pending` into its seen-baseline (`prevRef`) this
 *      tick. A removal arriving during the freeze is never silently absorbed unseen; it surfaces
 *      once the sticky entry resolves (dismissed or successfully retried).
 *   2. The sticky display's own 8-second auto-dismiss timer is NEVER armed — only `clearTimer()`,
 *      never `armTimer()` — so it cannot vanish via its own inherited timeout while unresolved.
 *
 * Mount-time initial state is NOT unconditionally blank (unlike a fresh, globally-mounted
 * DeleteUndoToast): because this component can remount mid-session (a tab navigation away and
 * back) while `useRemoveUndoStore`'s module-scope state survives underneath it, the initial
 * `toast`/`prevRef`/`wasStickyRef` are derived from the store's CURRENT truth at mount — if a
 * sticky entry already exists, its display and frozen freeze-baseline are reconstructed rather
 * than lost.
 *
 * Source: 05.1-13-PLAN.md Task 2; DeleteUndoToast.tsx (structural precedent).
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';

import { useRemoveUndoStore, type RemovedRowEntry } from '../../state/removeUndoStore';

const TOAST_MS = 8000;

type ToastState =
  | { kind: 'none' }
  | { kind: 'removed'; entry: RemovedRowEntry; generation: number }
  | { kind: 'error'; entryId: string; message: string; generation: number }
  | { kind: 'restored'; generation: number };

let generationCounter = 0;

/** Basename of a VFS-style ('/') object template path — never throws. */
function baseNameOf(p: string): string {
  const parts = p.split('/').filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : p;
}

/**
 * (ROUND 10, AA2/AA3/BB22) Mount-time reconstruction: if the store ALREADY has a sticky entry
 * (an id present in BOTH `pending` and `undoErrors`), reconstruct its display + the frozen
 * freeze-baseline (`prevRef` = `pending` up to and including that entry) rather than blank-slate
 * seeding — a naive blank seed would silently lose an already-sticky error display, or fold an
 * unshown freeze arrival into the seen baseline, on a mid-session remount. Picks the LAST such
 * entry (deterministic) and warns if more than one is found (BB22's asserted invariant).
 */
function computeInitialState(): { toast: ToastState; prevRef: RemovedRowEntry[]; wasSticky: boolean } {
  const { pending, undoErrors } = useRemoveUndoStore.getState();
  const stickyCandidates = pending.filter((e) => undoErrors.has(e.id));

  if (stickyCandidates.length > 0) {
    if (stickyCandidates.length > 1) {
      // eslint-disable-next-line no-console
      console.warn(
        'RemoveUndoToast: multiple pending entries have a live undoErrors entry at mount ' +
        `(${stickyCandidates.map((e) => e.id).join(', ')}) — showing the last (invariant violation).`,
      );
    }
    const stickyEntry = stickyCandidates[stickyCandidates.length - 1]!;
    const idx = pending.findIndex((e) => e.id === stickyEntry.id);
    generationCounter += 1;
    return {
      toast: {
        kind: 'error',
        entryId: stickyEntry.id,
        message: undoErrors.get(stickyEntry.id)!,
        generation: generationCounter,
      },
      prevRef: pending.slice(0, idx + 1),
      wasSticky: true,
    };
  }

  return { toast: { kind: 'none' }, prevRef: pending, wasSticky: false };
}

export interface RemoveUndoToastProps {
  /** WorldPanel.tsx owns the ENTIRE restore — this toast only reports WHICH entry to restore. */
  onUndo: (entry: RemovedRowEntry) => void;
}

export default function RemoveUndoToast({ onUndo }: RemoveUndoToastProps): React.ReactElement | null {
  const pending = useRemoveUndoStore((s) => s.pending);
  const undoErrors = useRemoveUndoStore((s) => s.undoErrors);

  // Computed exactly ONCE per component instance (first render) — never re-derived on later
  // renders, so the BB22 console.warn (if any) fires at most once per mount.
  const initRef = useRef<ReturnType<typeof computeInitialState> | null>(null);
  if (initRef.current === null) initRef.current = computeInitialState();
  const init = initRef.current;

  const [toast, setToast] = useState<ToastState>(init.toast);
  const prevRef = useRef<RemovedRowEntry[]>(init.prevRef);
  const wasStickyRef = useRef<boolean>(init.wasSticky);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const armTimer = useCallback(() => {
    clearTimer();
    timerRef.current = setTimeout(() => setToast({ kind: 'none' }), TOAST_MS);
  }, [clearTimer]);

  useEffect(() => {
    // ── Step 1 (ROUND 7/Z1; ROUND 8; ROUND 10/AA1): sticky guard-and-swap ──────────────────────
    // The guard AND the content-swap are the SAME branch (ROUND 10/AA1 — a prior draft gated the
    // swap BEHIND a separately-described guard, making it unreachable on the very first tick a
    // failure lands, since the guard becomes true the instant setUndoError fires).
    const displayedId = toast.kind === 'removed' ? toast.entry.id : toast.kind === 'error' ? toast.entryId : null;
    if (displayedId !== null) {
      const stillPending = pending.some((e) => e.id === displayedId);
      const errMsg = undoErrors.get(displayedId);
      if (stillPending && errMsg !== undefined) {
        if (!(toast.kind === 'error' && toast.message === errMsg)) {
          generationCounter += 1;
          setToast({ kind: 'error', entryId: displayedId, message: errMsg, generation: generationCounter });
        }
        // ROUND 9: NEVER armed while sticky — the sticky display cannot vanish via its own
        // inherited timeout.
        clearTimer();
        wasStickyRef.current = true;
        // ROUND 8: do NOT run the diff and do NOT fold `pending` into `prevRef` this tick — a
        // removal arriving during the freeze must not be silently absorbed unseen.
        return;
      }
    }

    // ── Step 3: the ordinary removed/added diff (DeleteUndoToast.tsx:68-92's structure) ────────
    const prev = prevRef.current;
    const prevIds = new Set(prev.map((e) => e.id));
    const currIds = new Set(pending.map((e) => e.id));
    const removed = prev.filter((e) => !currIds.has(e.id));
    const added = pending.filter((e) => !prevIds.has(e.id));

    const wasSticky = wasStickyRef.current;
    wasStickyRef.current = false;

    if (wasSticky && added.length > 0) {
      // ROUND 8/ROUND 9: on the tick immediately following a sticky thaw, an unseen queued
      // removal takes priority over a bare "restored" confirmation. ROUND 9 disclosed narrowing
      // (AA3): if MORE THAN ONE arrived during the freeze, only the newest surfaces its own toast.
      const entry = added[added.length - 1]!;
      generationCounter += 1;
      setToast({ kind: 'removed', entry, generation: generationCounter });
      armTimer();
    } else if (removed.length > 0) {
      generationCounter += 1;
      setToast({ kind: 'restored', generation: generationCounter });
      armTimer();
    } else if (added.length > 0) {
      const entry = added[added.length - 1]!;
      generationCounter += 1;
      setToast({ kind: 'removed', entry, generation: generationCounter });
      armTimer();
    }

    prevRef.current = pending;
  }, [pending, undoErrors, toast, armTimer, clearTimer]);

  useEffect(() => () => clearTimer(), [clearTimer]);

  const handleUndoClick = useCallback(
    (entryId: string) => {
      const entry = useRemoveUndoStore.getState().pending.find((e) => e.id === entryId);
      if (entry) onUndo(entry);
    },
    [onUndo],
  );

  const handleDismiss = useCallback(() => {
    if (toast.kind === 'error') {
      useRemoveUndoStore.getState().clearUndoError(toast.entryId);
    }
    clearTimer();
    setToast({ kind: 'none' });
  }, [toast, clearTimer]);

  if (toast.kind === 'none') return null;

  if (toast.kind === 'restored') {
    return (
      <div data-testid="remove-undo-toast" role="status" style={toastStyle}>
        <div style={toastRowStyle}>
          <span aria-hidden="true" style={{ fontSize: 14 }}>↩</span>
          <span style={toastMsgStyle}>Decoration restored</span>
          <button aria-label="Dismiss" onClick={handleDismiss} style={toastXStyle}>✕</button>
        </div>
        <div key={toast.generation} style={toastBarStyle} />
        <style>{TOAST_BAR_KEYFRAMES}</style>
      </div>
    );
  }

  if (toast.kind === 'error') {
    return (
      <div data-testid="remove-undo-toast" role="status" style={toastStyle}>
        <div style={toastRowStyle}>
          <span aria-hidden="true" style={{ fontSize: 14 }}>⚠</span>
          <span style={{ ...toastMsgStyle, color: 'var(--color-warn)' }}>{toast.message}</span>
          <button aria-label="Undo remove" onClick={() => handleUndoClick(toast.entryId)} style={toastUndoStyle}>
            Undo
          </button>
          <button aria-label="Dismiss" onClick={handleDismiss} style={toastXStyle}>✕</button>
        </div>
        {/* Sticky — no auto-dismiss progress bar (ROUND 9: no timer is ever armed while sticky). */}
      </div>
    );
  }

  const { entry } = toast;
  return (
    <div data-testid="remove-undo-toast" role="status" style={toastStyle}>
      <div style={toastRowStyle}>
        <span aria-hidden="true" style={{ fontSize: 14 }}>🗑</span>
        <span style={toastMsgStyle}>
          <Bold>{baseNameOf(entry.removedNode.objectTemplateName)}</Bold> removed
          <span style={toastSubStyle}>reload scene to see it gone · undo within 8s</span>
        </span>
        <button aria-label="Undo remove" onClick={() => handleUndoClick(entry.id)} style={toastUndoStyle}>
          Undo
        </button>
        <button aria-label="Dismiss" onClick={handleDismiss} style={toastXStyle}>✕</button>
      </div>
      <div key={toast.generation} style={toastBarStyle} />
      <style>{TOAST_BAR_KEYFRAMES}</style>
    </div>
  );
}

// ─── Bold ───────────────────────────────────────────────────────────────────────

function Bold({ children }: { children: React.ReactNode }): React.ReactElement {
  return <span style={{ fontWeight: 700 }}>{children}</span>;
}

// ─── Styles (mirrors DeleteUndoToast.tsx's shell) ──────────────────────────────

const toastStyle: React.CSSProperties = {
  position: 'fixed', right: 16, bottom: 40, zIndex: 9500,
  minWidth: 300, maxWidth: 380,
  background: 'var(--color-header)', border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-md)', boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
  overflow: 'hidden', fontFamily: 'var(--font-sans)',
};

const toastRowStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
};

const toastMsgStyle: React.CSSProperties = {
  flex: 1, fontSize: 'var(--text-sm)', color: 'var(--color-text)',
};

const toastSubStyle: React.CSSProperties = {
  display: 'block', fontSize: 'var(--text-xs)', color: 'var(--color-text-faint)', marginTop: 2,
};

const toastUndoStyle: React.CSSProperties = {
  background: 'none', border: '1px solid var(--color-accent)', color: 'var(--color-accent)',
  borderRadius: 'var(--radius-sm)', fontWeight: 700, fontSize: 'var(--text-xs)',
  padding: '5px 10px', cursor: 'pointer',
};

const toastXStyle: React.CSSProperties = {
  background: 'none', border: 'none', color: 'var(--color-text-faint)',
  cursor: 'pointer', fontSize: 13, padding: 2,
};

const toastBarStyle: React.CSSProperties = {
  height: 2, background: 'var(--color-accent)', width: '100%', transformOrigin: 'left',
  animation: `swg-remove-toast-shrink ${TOAST_MS}ms linear forwards`,
};

const TOAST_BAR_KEYFRAMES = `
  @keyframes swg-remove-toast-shrink {
    from { transform: scaleX(1); }
    to { transform: scaleX(0); }
  }
`;
