/**
 * packages/renderer/src/state/snapshotWatchStore.ts
 * Opt-in toggle for the in-game world-edit watcher (auto-detect).
 *
 * Default OFF — the maintainer prefers loose coupling: you inject/edit/save freely, and only
 * flip this on when you want a project to actively catch your in-game `.ws` saves. Persisted
 * to localStorage so the choice sticks across restarts. SnapshotWatchController reads `enabled`
 * and only watches when it's on AND a client-bound workspace is ready.
 */

import { create } from 'zustand';

const LS_KEY = 'swg-toolkit:snapshot-autodetect';

function loadEnabled(): boolean {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem(LS_KEY) === '1';
  } catch {
    return false;
  }
}

interface SnapshotWatchState {
  enabled: boolean;
  setEnabled: (v: boolean) => void;
}

export const useSnapshotWatchStore = create<SnapshotWatchState>((set) => ({
  enabled: loadEnabled(),
  setEnabled: (v) => {
    try {
      if (typeof localStorage !== 'undefined') localStorage.setItem(LS_KEY, v ? '1' : '0');
    } catch {
      /* localStorage unavailable (tests) — session-only */
    }
    set({ enabled: v });
  },
}));
