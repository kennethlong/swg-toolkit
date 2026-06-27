/**
 * packages/renderer/src/state/workspaceStore.ts
 * Zustand store for mod project workspace state.
 *
 * Manages:
 *   - Workspace open status (idle / opening / ready / error)
 *   - Active workspace metadata (folderPath, studioDir, workspaceName, clientPath)
 *   - Deploy model choice (patch-prepend / shadow-base / null)
 *   - Stale deployment flag (W7: true when .include line missing on open)
 *
 * Source: 04-01-PLAN.md Task 2; liveStore.ts pattern.
 */

import { create } from 'zustand';
import type { WorkspaceInfo } from '@swg/contracts';

// ─── Types ────────────────────────────────────────────────────────────────────

/** Discriminated union for workspace open status. */
export type WorkspaceStatus =
  | { kind: 'idle' }
  | { kind: 'opening' }
  | { kind: 'ready'; info: WorkspaceInfo }
  | { kind: 'error'; reason: string };

// ─── Store interface ──────────────────────────────────────────────────────────

export interface WorkspaceStore {
  /** Current workspace open status. */
  status: WorkspaceStatus;
  /** Absolute path to the workspace root folder. Null when no workspace open. */
  folderPath: string | null;
  /** Absolute path to the .studio/ dir. Null when no workspace open. */
  studioDir: string | null;
  /** Human-readable workspace name (path.basename). Null when no workspace open. */
  workspaceName: string | null;
  /** Detected/configured SWG client path. Null until user sets it. */
  clientPath: string | null;
  /** Deploy isolation model chosen for this workspace. Null until configured. */
  deployModel: 'patch-prepend' | 'shadow-base' | null;
  /**
   * W7: true when the .include line for swgtoolkit.cfg is missing from swgemu.cfg
   * on open — indicates a stale/incomplete prior deployment needing attention.
   */
  hasStaleDeployment: boolean;

  // ─── Actions ───────────────────────────────────────────────────────────────

  /** Begin opening/creating a workspace (transitions status to 'opening'). */
  beginOpen: () => void;
  /** Workspace opened successfully — transition to 'ready' and populate metadata. */
  openComplete: (info: WorkspaceInfo) => void;
  /** Open/create failed — transition to 'error' with reason. */
  openError: (reason: string) => void;
  /** Update the configured client installation path. */
  setClientPath: (p: string | null) => void;
  /** Set the deploy isolation model for this session. */
  setDeployModel: (m: 'patch-prepend' | 'shadow-base') => void;
  /** Set the stale deployment flag (W7). */
  setHasStaleDeployment: (b: boolean) => void;
  /** Close the workspace and reset all state to idle. */
  close: () => void;
}

// ─── Store implementation ─────────────────────────────────────────────────────

export const useWorkspaceStore = create<WorkspaceStore>((set) => ({
  status:             { kind: 'idle' },
  folderPath:         null,
  studioDir:          null,
  workspaceName:      null,
  clientPath:         null,
  deployModel:        null,
  hasStaleDeployment: false,

  beginOpen: () =>
    set({ status: { kind: 'opening' } }),

  openComplete: (info: WorkspaceInfo) =>
    set({
      status:        { kind: 'ready', info },
      folderPath:    info.folderPath,
      studioDir:     info.studioDir,
      workspaceName: info.workspaceName,
      clientPath:    info.clientPath,
    }),

  openError: (reason: string) =>
    set({ status: { kind: 'error', reason } }),

  setClientPath: (p: string | null) =>
    set({ clientPath: p }),

  setDeployModel: (m: 'patch-prepend' | 'shadow-base') =>
    set({ deployModel: m }),

  setHasStaleDeployment: (b: boolean) =>
    set({ hasStaleDeployment: b }),

  close: () =>
    set({
      status:             { kind: 'idle' },
      folderPath:         null,
      studioDir:          null,
      workspaceName:      null,
      clientPath:         null,
      deployModel:        null,
      hasStaleDeployment: false,
    }),
}));
