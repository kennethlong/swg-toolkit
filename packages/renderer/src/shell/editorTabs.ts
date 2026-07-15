/**
 * packages/renderer/src/shell/editorTabs.ts
 * Shared dockview "open a per-file editor tab in the main editor group" helper.
 *
 * ONE generic implementation reused by BOTH typed editors this phase ships:
 *   - DTII grid editor (this plan, 05-08) — VfsTree.tsx double-click on a DTII-tagged .iff.
 *   - .stf strings editor (05-09) — calls the SAME function with its own id/component/params.
 *
 * Lives in shell/ (not panels/editors/) because it is dockview-shell plumbing, not editor UI —
 * mirrors StatusBar.tsx's placement in shell/ for the same "cross-cutting shell concern" reason,
 * and is why 05-09's .stf editor can import it without a panels/editors/ dependency.
 *
 * Dedup contract: opening the SAME virtualPath twice ACTIVATES the existing tab instead of
 * adding a duplicate — dockview's own panel-id uniqueness is the mechanism. Callers derive a
 * stable id from the virtualPath (e.g. `dtii:${virtualPath}` / `stf:${virtualPath}`); this
 * function checks `dockApi.getPanel(id)` before ever calling `addPanel`.
 *
 * New tabs open WITHIN the viewport's dockview group (`direction: 'within', referencePanel:
 * 'viewport'`) — the main editor group, per 05-UI-SPEC.md's "typed editors open as tabs in the
 * main editor group (full-width editor surfaces, NOT 440px Inspect-width)" contract.
 *
 * Source: 05-UI-SPEC.md Design System (Docking) + Component Inventory (dockview tab chrome);
 *         05-08-PLAN.md Task 3.
 */

import type { DockviewApi } from 'dockview';

export interface OpenEditorTabOptions<P = unknown> {
  /** Unique dockview panel id for this file (e.g. `dtii:${virtualPath}`). Re-opening the same
   *  id activates the existing tab instead of adding a duplicate. */
  id: string;
  /** Dockview tab title (e.g. `${fileName} — Datatable`). */
  title: string;
  /** Registered dockview component key (must already be in WorkspaceShell's panelComponents map). */
  component: string;
  /** Params object handed to the panel component as `props.params`. */
  params: P;
}

/**
 * Opens (or activates, if already open) a dynamic per-file editor tab in the main editor group.
 */
export function openEditorTab<P = unknown>(dockApi: DockviewApi, opts: OpenEditorTabOptions<P>): void {
  const existing = dockApi.getPanel(opts.id);
  if (existing) {
    existing.api.setActive();
    return;
  }

  dockApi.addPanel({
    id: opts.id,
    component: opts.component,
    title: opts.title,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    params: opts.params as any,
    position: { direction: 'within', referencePanel: 'viewport' },
  });
}
