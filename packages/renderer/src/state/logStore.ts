/**
 * packages/renderer/src/state/logStore.ts — Zustand ring-buffer store backing the
 * in-app Console/Log dockview panels (D-12).
 *
 * A single shared store holds BOTH channels — Console (mirrored console.* + window
 * errors) and Log (structured app events) — distinguished by `channel`. Each panel
 * subscribes with a filtered selector. Hard-capped at 2000 entries (T-04.4-05:
 * unbounded log growth is a DoS on the renderer) via `.slice(-2000)` on every append.
 *
 * Source: 04.4-02-PLAN.md Task 2.
 */

import { create } from 'zustand';

const MAX_ENTRIES = 2000;

export interface LogEntry {
  ts: number;
  level: 'info' | 'warn' | 'error';
  channel: 'console' | 'log';
  message: string;
}

export interface LogStore {
  entries: LogEntry[];
  append: (entry: Omit<LogEntry, 'ts'>) => void;
  clear: () => void;
}

export const useLogStore = create<LogStore>((set) => ({
  entries: [],

  append: (entry) =>
    set((s) => ({
      entries: [...s.entries, { ...entry, ts: Date.now() }].slice(-MAX_ENTRIES),
    })),

  clear: () => set({ entries: [] }),
}));
