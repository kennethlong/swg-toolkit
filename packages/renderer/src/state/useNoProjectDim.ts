/**
 * packages/renderer/src/state/useNoProjectDim.ts
 * Sketch 007-B: the viewport / inspector / data panes are dimmed and non-interactive
 * until a project is open, focusing the user on the Welcome takeover in the Assets panel.
 *
 * Returns a style fragment to spread into a panel's root element.
 *
 * P5 (04.3-08): dim is keyed by stable dock-GROUP identifiers, NOT by panel label
 * strings like "Data" — panel labels change (plan 09 splits "Data" into Datatable /
 * Console / Log) but the dock groups remain stable.
 *
 * Source: 04.3-08-PLAN.md P5; sketch 007-B variant B.
 */

import type React from 'react';
import { useWorkspaceStore } from './workspaceStore';

// ─── Stable dock-group ID constants ──────────────────────────────────────────
// These identify the dock GROUPS (containers), not the panel labels.
// Plan 09 will register Datatable / Console / Log panels into DIM_GROUP_BOTTOM_PANE,
// not the label "Data" — so the dim survives the split.

/** Dock group containing the 3-D viewport panel. */
export const DIM_GROUP_VIEWPORT    = 'viewport-group';
/** Dock group containing the Inspector / Deploy / VCS panels (right dock). */
export const DIM_GROUP_INSPECTOR   = 'inspector-group';
/** Dock group containing the bottom data pane (Datatable / Console / Log in plan 09). */
export const DIM_GROUP_BOTTOM_PANE = 'bottom-pane-group';

// ─── Simple style helper (backward-compatible) ────────────────────────────────

/**
 * Returns a CSS style fragment to spread onto a panel root.
 * Applies opacity:0.32 + pointer-events:none when no project is open.
 *
 * Used by ViewportPanel, InspectorPanel, DataPanel directly.
 */
export function useNoProjectDimStyle(): React.CSSProperties {
  const dimmed = useWorkspaceStore((s) => s.status.kind !== 'ready');
  return dimmed
    ? { opacity: 0.32, pointerEvents: 'none', transition: 'opacity 0.15s ease' }
    : { transition: 'opacity 0.15s ease' };
}

// ─── Group-keyed hook ─────────────────────────────────────────────────────────

/**
 * Returns the dim state for a given dock group, keyed by the stable group ID
 * constant (DIM_GROUP_*), NOT by the panel label string.
 *
 * Use DIM_GROUP_VIEWPORT / DIM_GROUP_INSPECTOR / DIM_GROUP_BOTTOM_PANE constants.
 * All three groups are dimmed when no project is open; passing any of these IDs
 * returns the same boolean (`dimmed: true` when no project). The groupId parameter
 * is accepted to document intent and to survive panel-label renames in future plans.
 *
 * @param _groupId  One of the DIM_GROUP_* stable dock-group ID constants.
 */
export function useNoProjectDimForGroup(
  _groupId: string,
): { dimmed: boolean; style: React.CSSProperties } {
  const dimmed = useWorkspaceStore((s) => s.status.kind !== 'ready');
  return {
    dimmed,
    style: dimmed
      ? { opacity: 0.32, pointerEvents: 'none', transition: 'opacity 0.15s ease' }
      : { transition: 'opacity 0.15s ease' },
  };
}
