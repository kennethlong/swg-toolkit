/**
 * packages/renderer/src/panels/tre/TreVfsBrowser.test.tsx
 * Source-level contract tests for handleOpenEditor (05-08-PLAN.md Task 3).
 *
 * A full render of TreVfsBrowser pulls in ProjectBindingBar/WorkspaceEntry (workspace +
 * changeset store + IPC-backed project-binding services) — heavy integration surface already
 * covered by other Phase-4 test suites. The DTII-open wiring this plan adds is proven at two
 * lighter, more targeted layers instead:
 *   - VfsTree.test.tsx: double-click fires the onOpenEditor callback exactly once per click.
 *   - editorTabs.test.ts: openEditorTab's dedup contract (addPanel called once across two
 *     "double-clicks" on the same id — the literal acceptance-criteria assertion).
 * This file locks in the FORM-tag gate + wiring shape via source inspection so a future edit
 * cannot silently drop the DTII check, the dedup call site, or introduce a second detection
 * mechanism (the plan's own "do not add a second detection mechanism" constraint).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(__dirname, 'TreVfsBrowser.tsx'), 'utf-8');

describe('TreVfsBrowser — handleOpenEditor (05-08 Task 3)', () => {
  it('gates on FORM DTII via the SAME parseIff() mechanism already used for the IFF Structure panel', () => {
    expect(src).toMatch(/root\.kind !== 'form' \|\| root\.subType !== 'DTII'/);
    expect(src).toContain('nativeCore.parseIff(bytes)');
  });

  it('opens the tab via the shared openEditorTab helper — id derived from the entry virtual path', () => {
    expect(src).toContain("import { openEditorTab } from '../../shell/editorTabs'");
    expect(src).toMatch(/id:\s*`dtii:\$\{entry\.path\}`/);
    expect(src).toContain("component: 'datatable-grid-editor'");
  });

  it('wires VfsTree onOpenEditor to handleOpenEditor', () => {
    expect(src).toContain('onOpenEditor={handleOpenEditor}');
  });

  it('accepts dockApi as a prop (drilled from SidebarPanel.containerApi) rather than a new global hook', () => {
    expect(src).toMatch(/dockApi\?:\s*DockviewApi/);
  });
});
