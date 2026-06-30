/**
 * packages/renderer/src/state/clientScanStore.ts
 * Session-scoped first-run client-scan status message (P9).
 *
 * Shared by:
 *   - Plan 08 writer: calls setClientScanMessage('Scanning client files…') during
 *     the first-run client detection pass triggered on ProjectBindingBar render.
 *   - Plan 09 reader: statusbar left-chip reads useClientScanStatus() to surface
 *     the scan progress/result to the user (PROJUI first-run statusbar message).
 *
 * Wave-1 plan 08: setMessage is the real setter (turns plan 02 RED tests GREEN).
 * Called by WorkspaceEntry after the first-run client detection scan.
 *
 * Design:
 *   - Session-scoped ONLY — NOT persisted. Plain in-memory Zustand store.
 *   - Single field: message:string|null (null = no active scan message).
 *
 * Source: 04.3-02-PLAN.md Task 2; 04.3-RESEARCH.md § clientScanStore contract (P9).
 */

import { create } from 'zustand';

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

interface ClientScanState {
  /** Current scan message; null = no message to display. */
  message: string | null;
  /** STUB: no-op setter. Wave-1 plan 08 implements the real setter. */
  setMessage: (msg: string | null) => void;
}

export const useClientScanStore = create<ClientScanState>((set) => ({
  message: null,
  // Wave-1 plan 08 implementation: real setter updates store message.
  setMessage: (msg: string | null) => set({ message: msg }),
}));

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * React hook: returns the current first-run scan status message.
 * Returns { message: null } when no scan is in progress or no result to show.
 * Used by the Plan-09 statusbar reader.
 */
export function useClientScanStatus(): { message: string | null } {
  const message = useClientScanStore((s) => s.message);
  return { message };
}

/**
 * Imperative setter: update the client scan status message.
 * Called by Plan-08 writer from the client-detection service (not a React hook).
 * Pass null to clear the message.
 *
 * Wave-1 plan 08: real setter — updates the message in the Zustand store.
 */
export function setClientScanMessage(msg: string | null): void {
  useClientScanStore.getState().setMessage(msg);
}
