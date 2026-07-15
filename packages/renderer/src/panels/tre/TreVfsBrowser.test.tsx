/**
 * packages/renderer/src/panels/tre/TreVfsBrowser.test.tsx
 * Source-level contract tests for handleOpenEditor (05-08-PLAN.md Task 3, extended by
 * 05-09-PLAN.md Task 3 for `.stf`).
 *
 * A full render of TreVfsBrowser pulls in ProjectBindingBar/WorkspaceEntry (workspace +
 * changeset store + IPC-backed project-binding services) — heavy integration surface already
 * covered by other Phase-4 test suites. The DTII/.stf-open wiring these plans add is proven at
 * two lighter, more targeted layers instead:
 *   - VfsTree.test.tsx: double-click fires the onOpenEditor callback exactly once per click
 *     (generic — VfsTree itself has no native-core or dockview access and does not branch on
 *     file type; the `.stf` vs DTII branch lives entirely in THIS file's handleOpenEditor).
 *   - editorTabs.test.ts: openEditorTab's dedup contract (addPanel called once across two
 *     "double-clicks" on the same id — the literal acceptance-criteria assertion).
 * This file locks in the FORM-tag gate + `.stf`-extension gate + wiring shape via source
 * inspection so a future edit cannot silently drop either check, the dedup call site, or
 * introduce a second detection/tab-opening mechanism (the plans' own "do not add a second
 * detection mechanism" / "no hand-rolled addPanel" constraints).
 *
 * DEVIATION NOTE (05-09-PLAN.md Task 3, Rule 1 — plan named the wrong file): the plan's
 * files_modified/action text names VfsTree.tsx as the file to extend for the `.stf` double-click
 * branch, but 05-08's own established pattern (and VfsTree.tsx's own header comment: "VfsTree
 * itself has no native-core or dockview access") puts ALL FORM-tag/extension-detection and
 * tab-opening logic in TreVfsBrowser.tsx's handleOpenEditor — VfsTree.tsx's onOpenEditor callback
 * is already fully generic (fires for any entry, on any double-click) and needs no changes for a
 * new file type. This file (TreVfsBrowser.tsx) is the one actually edited for the `.stf` branch;
 * VfsTree.tsx is unchanged (its existing double-click wiring already covers `.stf` entries).
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

describe('TreVfsBrowser — handleOpenEditor .stf branch (05-09 Task 3, DATA-02)', () => {
  it('gates on the .stf EXTENSION, not a FORM tag (PARSER-NATIVE format, no parseIff call for this branch)', () => {
    expect(src).toMatch(/entry\.path\.toLowerCase\(\)\.endsWith\('\.stf'\)/);
  });

  it('the .stf branch calls parseStf directly — no parseIff/parseDataTable in that branch', () => {
    const stfBranch = src.slice(
      src.indexOf("endsWith('.stf')"),
      src.indexOf('let iffResult'),
    );
    expect(stfBranch).toContain('nativeCore.parseStf(bytes)');
    expect(stfBranch).not.toContain('parseIff');
    expect(stfBranch).not.toContain('parseDataTable');
  });

  it('opens the tab via the shared openEditorTab helper — id derived from the entry virtual path', () => {
    expect(src).toContain("component: 'stf-strings-editor'");
    expect(src).toMatch(/id:\s*`stf:\$\{entry\.path\}`/);
  });

  it('derives locale from the path segment directly under "string/" (e.g. string/en/foo.stf -> en)', () => {
    expect(src).toContain("segments.indexOf('string')");
  });

  it('no hand-rolled dockview addPanel call was introduced for .stf (openEditorTab is the only tab-opening mechanism)', () => {
    expect(src).not.toMatch(/dockApi\.addPanel/);
  });
});
