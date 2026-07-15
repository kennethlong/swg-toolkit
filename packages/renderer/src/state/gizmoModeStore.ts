/**
 * packages/renderer/src/state/gizmoModeStore.ts
 *
 * Single source of truth for the active transform-gizmo mode (Move/Rotate/
 * Scale/Universal) — previously local `useState` in Viewport.tsx (05-10),
 * lifted to a small dedicated Zustand store (05-11 Task 3) so StatusBar.tsx's
 * new mode segment can read the SAME state GizmoModeRail/TransformGizmo
 * already share, without threading it through props across the shell/panel
 * boundary or duplicating it into liveStore (gizmo mode is meaningful offline
 * too — it is not live-injection state).
 *
 * Source: 05-11-PLAN.md Task 3 action text ("reads the shared gizmo-mode
 * state from 05-10 — thread it through liveStore or a small dedicated
 * store/context if it does not already live in a shared location accessible
 * to StatusBar").
 */

import { create } from 'zustand';
import type { GizmoMode } from '../panels/viewport/TransformGizmo.js';

export interface GizmoModeStore {
  mode: GizmoMode;
  setMode: (mode: GizmoMode) => void;
}

export const useGizmoModeStore = create<GizmoModeStore>((set) => ({
  mode: 'translate',
  setMode: (mode) => set({ mode }),
}));

/** Human-readable label matching GizmoModeRail's own button labels, reused by
 *  StatusBar's mode segment ("mode: Move (W)") so the two never drift. */
export const GIZMO_MODE_LABELS: Record<GizmoMode, string> = {
  translate: 'Move (W)',
  rotate: 'Rotate (E)',
  scale: 'Scale (R)',
  universal: 'Universal (Q)',
};
