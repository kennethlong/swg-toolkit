/**
 * packages/renderer/src/state/changesetStore.ts
 * Zustand store for changeset history graph state (DEPLOY-03).
 *
 * Manages:
 *   - The full WorkspaceChangesetManifest (all version nodes + active/deployed pointers)
 *   - Seal operation status
 *
 * GRAPH MODEL (D-04-05..08, REFINED 2026-06-26):
 *   - activeVersionId / deployedVersionId are string | null (UUID or null)
 *   - NO number-based index; string UUIDs only
 *   - changesets[] is NEVER destructively mutated; version nodes persist for redo
 *   - setActiveVersion(id) and setDeployedVersion(id) move string-based pointers only
 *
 * Source: 04-01-PLAN.md Task 2; liveStore.ts pattern.
 */

import { create } from 'zustand';
import type { WorkspaceChangesetManifest } from '@swg/contracts';

// ─── Types ────────────────────────────────────────────────────────────────────

/** Discriminated union for changeset seal operation status. */
export type ChangesetSealStatus =
  | { kind: 'idle' }
  | { kind: 'sealing' }
  | { kind: 'error'; reason: string };

// ─── Store interface ──────────────────────────────────────────────────────────

export interface ChangesetStore {
  /**
   * Full changeset manifest — all version nodes in the history graph.
   * Initial state: empty graph with null pointers.
   */
  manifest: WorkspaceChangesetManifest;
  /** Status of the most recent (or current) seal operation. */
  sealStatus: ChangesetSealStatus;

  // ─── Actions ───────────────────────────────────────────────────────────────

  /** Replace the entire manifest (e.g. on workspace open after reading manifest.json). */
  setManifest: (m: WorkspaceChangesetManifest) => void;
  /** Begin sealing a new changeset version. */
  beginSeal: () => void;
  /** Seal succeeded — update sealStatus to idle and replace manifest. */
  sealComplete: (m: WorkspaceChangesetManifest) => void;
  /** Seal failed — record the reason. */
  sealError: (reason: string) => void;
  /**
   * Update manifest.activeVersionId only (non-destructive pointer move).
   * changesets[] is never mutated here — only the pointer changes.
   * D-04-08: rolled-back nodes stay in the array for redo.
   */
  setActiveVersion: (id: string | null) => void;
  /**
   * Update manifest.deployedVersionId only (non-destructive pointer move).
   * changesets[] is never mutated here.
   */
  setDeployedVersion: (id: string | null) => void;
}

// ─── Store implementation ─────────────────────────────────────────────────────

export const useChangesetStore = create<ChangesetStore>((set) => ({
  manifest: {
    activeVersionId:   null,
    deployedVersionId: null,
    changesets:        [],
  },
  sealStatus: { kind: 'idle' },

  setManifest: (m: WorkspaceChangesetManifest) =>
    set({ manifest: m }),

  beginSeal: () =>
    set({ sealStatus: { kind: 'sealing' } }),

  sealComplete: (m: WorkspaceChangesetManifest) =>
    set({ sealStatus: { kind: 'idle' }, manifest: m }),

  sealError: (reason: string) =>
    set({ sealStatus: { kind: 'error', reason } }),

  setActiveVersion: (id: string | null) =>
    set((state) => ({
      manifest: { ...state.manifest, activeVersionId: id },
    })),

  setDeployedVersion: (id: string | null) =>
    set((state) => ({
      manifest: { ...state.manifest, deployedVersionId: id },
    })),
}));
