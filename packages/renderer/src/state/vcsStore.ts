/**
 * packages/renderer/src/state/vcsStore.ts — Zustand store for VCS (Git/LFS) panel state.
 *
 * Manages:
 *   - Commit status (idle / committing / done(shortSha) / error(reason))
 *   - LFS availability (unknown / present(version, pointerCount) / absent)
 *   - Pre-commit guard result (null / {passed:true} / {passed:false; file; reason})
 *   - Commit log feed
 *
 * All actions are pure Zustand set() calls — no side-effects, no child_process here.
 * The gitLfsService shims git shell-outs and then calls getState().action() to update.
 *
 * Source: 04-05-PLAN.md Task 1; 04-CONTEXT.md §D-04-13..16;
 *         04-PATTERNS.md §Zustand Store Pattern (mirrors liveStore.ts shape exactly).
 */

import { create } from 'zustand';

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * Discriminated union for the ongoing commit operation status.
 * 'done' carries the short SHA (first 7 chars) from git log.
 */
export type CommitStatus =
  | { kind: 'idle' }
  | { kind: 'committing' }
  | { kind: 'done'; shortSha: string }
  | { kind: 'error'; reason: string };

/**
 * Discriminated union for git-lfs presence probe result.
 * 'present' carries the version string and the count of LFS-routed blobs in the repo.
 */
export type LfsStatus =
  | { kind: 'unknown' }
  | { kind: 'present'; version: string; pointerCount: number }
  | { kind: 'absent' };

/**
 * App-side pre-commit guard result (defense-in-depth, D-04-15).
 * null   → guard not yet run
 * passed → no retail/.tre/large blobs in staged set
 * failed → offending file + human-readable reason
 */
export type GuardResult =
  | null
  | { passed: true }
  | { passed: false; file: string; reason: string };

/** One entry in the commit log feed shown in the VCS panel. */
export interface LogEntry {
  shortSha:     string;
  subject:      string;
  relativeTime: string;
}

// ─── Store interface ──────────────────────────────────────────────────────────

export interface VcsStore {
  /** Current commit operation status. */
  commitStatus: CommitStatus;
  /** git-lfs availability as probed at workspace init. */
  lfsStatus:    LfsStatus;
  /** App-side pre-commit guard result (null = not yet evaluated). */
  guardResult:  GuardResult;
  /** Recent commit log, newest-last (matches `git log --reverse`). */
  log:          LogEntry[];

  // ─── Actions ───────────────────────────────────────────────────────────────

  /** Transition to 'committing' while gitCommit is in flight. */
  beginCommit:    () => void;
  /** Commit succeeded — record the short SHA. */
  commitComplete: (shortSha: string) => void;
  /** Commit failed — record the human-readable reason. */
  commitError:    (reason: string) => void;
  /** Reset commit status back to 'idle'. */
  resetCommit:    () => void;
  /** Update the LFS probe result (called at workspace open / VcsPanel mount). */
  setLfsStatus:   (lfsStatus: LfsStatus) => void;
  /** Update the app-side pre-commit guard result. */
  setGuardResult: (guardResult: GuardResult) => void;
  /** Append a single log entry (e.g. after a successful commit). */
  appendLog:      (entry: LogEntry) => void;
  /** Replace the full log (e.g. after refreshLog refreshes from git). */
  setLog:         (entries: LogEntry[]) => void;
}

// ─── Store implementation ─────────────────────────────────────────────────────

export const useVcsStore = create<VcsStore>((set) => ({
  commitStatus: { kind: 'idle' },
  lfsStatus:    { kind: 'unknown' },
  guardResult:  null,
  log:          [],

  beginCommit: () =>
    set({ commitStatus: { kind: 'committing' } }),

  commitComplete: (shortSha: string) =>
    set({ commitStatus: { kind: 'done', shortSha } }),

  commitError: (reason: string) =>
    set({ commitStatus: { kind: 'error', reason } }),

  resetCommit: () =>
    set({ commitStatus: { kind: 'idle' } }),

  setLfsStatus: (lfsStatus: LfsStatus) =>
    set({ lfsStatus }),

  setGuardResult: (guardResult: GuardResult) =>
    set({ guardResult }),

  appendLog: (entry: LogEntry) =>
    set((state) => ({ log: [...state.log, entry] })),

  setLog: (entries: LogEntry[]) =>
    set({ log: entries }),
}));
