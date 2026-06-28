/**
 * packages/renderer/src/state/useNoProjectDim.ts
 * Sketch 007-B: the viewport / inspector / data panes are dimmed and non-interactive
 * until a project is open, focusing the user on the Welcome takeover in the Assets panel.
 *
 * Returns a style fragment to spread into a panel's root element.
 */

import type React from 'react';
import { useWorkspaceStore } from './workspaceStore';

export function useNoProjectDimStyle(): React.CSSProperties {
  const dimmed = useWorkspaceStore((s) => s.status.kind !== 'ready');
  return dimmed
    ? { opacity: 0.32, pointerEvents: 'none', transition: 'opacity 0.15s ease' }
    : { transition: 'opacity 0.15s ease' };
}
