---
phase: 05-wysiwyg-live-sync-typed-editors
plan: 08
subsystem: ui
tags: [react, dockview, dtii, datatable, gate-machine, hex-inspector, round-trip]

# Dependency graph
requires:
  - phase: 05-wysiwyg-live-sync-typed-editors (plan 02)
    provides: Native DTII parser/serializer + N-API binding, per-cell byteOffset/byteLength (relative to the ROWS chunk's cell-data span), parseIff()/parseDataTable()/serializeDataTable() bindings
  - phase: 05-wysiwyg-live-sync-typed-editors (plan 06)
    provides: Shared GateBar/FailBanner gate-state UI, dtiiTypeSpec.ts type-spec grammar, DatatableGridEditor.tsx's crumb bar/toolbar/virtualized grid (items 1-4)
provides:
  - SchemaRail.tsx — 250px collapsible right rail (Schema · COLS/TYPE, Selected row, Round-trip gate), reusing the shared TypeBadge component
  - Real Hex view — HexInspector fed the ROWS chunk's cell-data span, selectedRange computed directly from the edited cell's byteOffset/byteLength
  - Save · run gate / ＋ Stage wired to the real native round-trip (serializeDataTable -> parseIff -> parseDataTable -> serializeDataTable, byte-compared) with staging integration
  - editorTabs.ts — openEditorTab(dockApi, {id, title, component, params}), the shared dockview-tab-opening helper both DTII (this plan) and .stf (05-09) use
  - DatatableGridEditor reachable from the TRE VFS browser via double-click on a DTII-tagged .iff entry
affects: ["05-09 (.stf editor reuses editorTabs.openEditorTab + GateBar/FailBanner unchanged)"]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Round-trip gate comparator (diffFirstByte) ported inline from packages/harness/assertRoundTrip.ts's byte-scan+hex-window diagnostic — @swg/harness is not a declared @swg/renderer dependency, and the plan explicitly sanctions porting inline over adding a new workspace dependency."
    - "Shared TypeBadge (packages/renderer/src/panels/editors/shared/TypeBadge.tsx) extracted from DatatableGridEditor.tsx so SchemaRail's Schema·COLS/TYPE badges are pixel-identical to the grid header's, without a circular import between the two."
    - "physicalTypeForKind moved into dtiiTypeSpec.ts (single source of truth) so both DatatableGridEditor.tsx's cell-coercion dispatch and SchemaRail.tsx's storage-type label consume the SAME function."
    - "editorTabs.ts's openEditorTab dedups by dockview panel id (dockApi.getPanel(id)) before ever calling addPanel — same dedup idiom as WorkspaceShell's own handleReopenPanel guard."
    - "VfsTree.tsx's onExtract precedent reused for onOpenEditor: the row fires a plain callback on double-click; the parent (TreVfsBrowser) does the actual native/dockApi work, since VfsTree itself has no native-core or dockview access."
    - "SidebarPanel is itself a dockview panel, so its own `props.containerApi` IS the whole-layout DockviewApi — drilled down to TreVfsBrowser as `dockApi` instead of introducing a new window.__* global hook."

key-files:
  created:
    - packages/renderer/src/panels/editors/SchemaRail.tsx
    - packages/renderer/src/panels/editors/SchemaRail.test.tsx
    - packages/renderer/src/panels/editors/shared/TypeBadge.tsx
    - packages/renderer/src/shell/editorTabs.ts
    - packages/renderer/src/shell/editorTabs.test.ts
    - packages/renderer/src/panels/tre/VfsTree.test.tsx
    - packages/renderer/src/panels/tre/TreVfsBrowser.test.tsx
  modified:
    - packages/renderer/src/panels/editors/DatatableGridEditor.tsx
    - packages/renderer/src/panels/editors/DatatableGridEditor.test.tsx
    - packages/renderer/src/panels/editors/dtiiTypeSpec.ts
    - packages/renderer/src/panels/editors/dtiiTypeSpec.test.ts
    - packages/renderer/src/panels/tre/VfsTree.tsx
    - packages/renderer/src/panels/tre/TreVfsBrowser.tsx
    - packages/renderer/src/panels/SidebarPanel.tsx
    - packages/renderer/src/workspace/WorkspaceShell.tsx
    - packages/renderer/src/workspace/workspace-config.ts
    - packages/renderer/src/workspace/workspace-config.test.ts
  deleted:
    - packages/renderer/src/panels/DatatablePanel.tsx

key-decisions:
  - "Hex view's byte source is the ROWS chunk's cell-data SPAN (a slice of the source file), not the whole file — this lets the edited cell's byteOffset/byteLength (already relative to that span, per 05-02) drive selectedRange with ZERO base-offset addition, satisfying the plan's literal 'no client-side offset re-derivation' instruction. Locating the span's absolute start (via a one-time IFF-tree walk to the ROWS leaf, findRowsPayloadSpan) is a container lookup, not a per-cell offset re-derivation."
  - "sourceBytes/iffRoots are OPTIONAL DatatableGridEditorParams fields — the Hex view gracefully falls back to HexInspector's own empty state when absent, so 05-06's existing test fixtures (which don't build a full byte buffer) keep passing unmodified."
  - "'＋ Stage' and 'Save · run gate' call the IDENTICAL handleSaveRunGate function — per UI-SPEC, both actions lead to the same staged-or-not outcome; '＋ Stage' is not a separate weaker path."
  - "A successful gate run resets each cell's originalValue to its current value (and clears isNew) — the staged buffer becomes the new dirty-tracking baseline, matching the UI-SPEC's 'pass: ALL modified marks clear (cell/row/tab)' requirement."
  - "@swg/native-core is a bare require() of a native addon — vi.mock does NOT intercept this in this project's vitest setup (confirmed project-wide precedent: useLiveService.test.ts/useCommandWriter.test.ts for the sibling @swg/live-inject addon). DatatableGridEditor.test.tsx monkey-patches the real process-cached addon object's parseIff/parseDataTable/serializeDataTable properties instead of vi.mock('@swg/native-core', ...) — the latter silently no-ops (real native calls execute, producing spuriously 'clean' byte comparisons regardless of the mock configuration) rather than erroring, which is why this was caught only by inspecting actual staged call args, not a crash."
  - "STATIC_PANEL_IDS (WorkspaceShell.tsx) is a new curated list distinct from Object.keys(panelComponents) — the 'reopen closed panel' menu must never offer 'datatable-grid-editor' (a dynamic per-file template component with no fixed id/required params), which Object.keys(panelComponents) would have silently included, crashing on reopen."

patterns-established:
  - "Dynamic per-file dockview tab components (component key registered in panelComponents, but never given a fixed panel id/PANEL_TITLES/PANEL_REOPEN_POSITIONS entry) are opened exclusively via editorTabs.ts's openEditorTab and are excluded from WorkspaceShell's generic reopen-closed-panel menu via the STATIC_PANEL_IDS allowlist — 05-09's .stf editor should follow the same registration shape."

requirements-completed: [DATA-01]

# Metrics
duration: single session
completed: 2026-07-15
---

# Phase 5 Plan 08: DTII Grid Editor Completion — SchemaRail, Real Hex View, Round-Trip Gate Wiring, Dockview Tab Opening Summary

**Completes the DTII grid editor end-to-end: the 250px SchemaRail (Schema·COLS/TYPE, Selected row, Round-trip gate), the Hex view's real HexInspector target with byte-accurate cell highlighting sourced directly from 05-02's per-cell offsets, Save·run gate / ＋ Stage wired to the actual native round-trip (pass stages, fail never does), and a shared `editorTabs.openEditorTab` helper that opens the editor as a main-editor-group dockview tab from a VFS double-click — retiring the bottom-pane `DatatablePanel` placeholder.**

## Performance

- **Duration:** single session
- **Completed:** 2026-07-15
- **Tasks:** 3/3 completed (Tasks 1+2 committed together — see Deviations)
- **Files modified:** 18 (7 created, 10 modified, 1 deleted)

## Accomplishments

- `SchemaRail.tsx`: 250px right rail with three independently-collapsible sections (rotating `▾` twisty, mirroring `ShadowChainDetail.tsx`'s fixed-detail-panel idiom): `Schema · COLS / TYPE` (type badge + name + derived storage type per column), `Selected row` (kv inspector, `Click a row…` empty state, modified values in warn), `Round-trip gate` (`last run`/`result`/`bytes` kv rows driven entirely by props from the live gate machine).
- `shared/TypeBadge.tsx`: the D-07-widened 9-kind type badge extracted from `DatatableGridEditor.tsx` so the grid header and SchemaRail render pixel-identical badges without a circular import.
- `dtiiTypeSpec.ts`: `physicalTypeForKind` promoted to a shared export (single source of truth for both cell-type coercion and SchemaRail's storage-type label).
- `DatatableGridEditor.tsx` Hex view: real `HexInspector` fed the ROWS chunk's cell-data span (located once via a `findRowsPayloadSpan` IFF-tree walk to the `ROWS` leaf), with `selectedRange` computed directly as `{ start: cell.byteOffset, end: cell.byteOffset + cell.byteLength }` — no client-side offset re-derivation — and the caption `highlighted: <col> (<type>) row <n> — the cell you edit in Grid view is these bytes`.
- Round-trip gate: `Save · run gate` (and the identical `＋ Stage` path) calls `serializeDataTable`, then re-parses + re-serializes to prove stability, byte-comparing via `diffFirstByte` (an inline port of `assertRoundTrip.ts`'s byte-scan+hex-window diagnostic). Pass stages the serialized bytes via a temp file (mirrors `TreVfsBrowser`'s Extract→Add materialization pattern) and calls `stagingStore.addEntry` exactly once; fail renders `FailBanner` (`Jump to bytes` switches to Hex view on the mismatch offset, `Revert cell` undoes the last edit) and **never** calls `addEntry` (T-05-21).
- `editorTabs.ts`: `openEditorTab(dockApi, {id, title, component, params})` — dedups by dockview panel id (activates an existing tab instead of duplicating), opens new tabs within the viewport's dockview group. Generic and reusable — 05-09's `.stf` editor imports it unchanged.
- `VfsTree.tsx` + `TreVfsBrowser.tsx`: double-clicking a `.iff` entry resolves its FORM tag via the same `parseIff()` call the IFF Structure panel already uses (no second detection mechanism); a `DTII` subtype opens `DatatableGridEditor` via `openEditorTab`. `TreVfsBrowser` accepts `dockApi` drilled from `SidebarPanel`'s own `props.containerApi` (SidebarPanel is itself a dockview panel, so `containerApi` is the whole-layout API — no new global hook needed).
- `WorkspaceShell.tsx` / `workspace-config.ts`: registers `'datatable-grid-editor'`, removes the retired `'datatable'` registration, bumps `LAYOUT_VERSION` 3→4 (S8 bottom pane becomes Console|Log only). A new `STATIC_PANEL_IDS` allowlist keeps the dynamic per-file editor component out of the generic reopen-closed-panel menu (which assumes a fixed id and no required params).
- `packages/renderer/src/panels/DatatablePanel.tsx` deleted — superseded by the real main-editor-group tab (UI-SPEC Flagged Assumption 2).

## Task Commits

Tasks 1 and 2 share the same file (`DatatableGridEditor.tsx`) and interdependent state (the Hex view's highlight target and the gate machine's fail-jump-to-bytes both live in the same component and were designed together for correctness), so they were committed together rather than split — see Deviations.

1. **Tasks 1+2: SchemaRail, real Hex view, round-trip gate wiring** - `83012d7` (feat)
2. **Task 3: Dockview tab opening + VfsTree wiring + retire DatatablePanel** - `0523aef` (feat)

## TDD Gate Compliance

Task 2 was marked `tdd="true"` in the plan. This plan did **not** follow a strict RED→GREEN commit sequence for Task 2 — tests and implementation were authored together in the same file/session (the gate machine is tightly coupled to Task 1's Hex-view state in the same component) and verified as a whole (all green) rather than staged as a failing-test-then-implementation pair. See Deviations below.

## Decisions Made

See `key-decisions` in frontmatter above (ROWS-span Hex slicing to avoid offset re-derivation, optional sourceBytes/iffRoots for backward compat, `＋ Stage` == `Save · run gate`, gate-pass baseline reset, the `@swg/native-core` monkey-patch test pattern, and `STATIC_PANEL_IDS`).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `vi.mock('@swg/native-core', ...)` silently no-ops for a bare `require()` of a native addon**
- **Found during:** Task 2 test authoring (round-trip gate wiring tests)
- **Issue:** The first test-writing pass used `vi.mock('@swg/native-core', () => ({...}))`, following `StatusBar.test.tsx`'s apparent precedent. This does NOT intercept `DatatableGridEditor.tsx`'s bare `require('@swg/native-core')` — confirmed by a forced-mismatch test that unexpectedly staged (real native functions executed, producing byte-identical round-trips regardless of the mock's configured "corrupted" return values). This exact gotcha is already documented project-wide (`useLiveService.test.ts`/`useCommandWriter.test.ts` header comments for the sibling `@swg/live-inject` addon).
- **Fix:** Replaced `vi.mock` with the established monkey-patch pattern: `require('@swg/native-core')` directly in the test file (the SAME process-cached module object `DatatableGridEditor.tsx`'s own `require()` resolves to), then reassign `.parseIff`/`.parseDataTable`/`.serializeDataTable` to `vi.fn()` before rendering.
- **Files modified:** `packages/renderer/src/panels/editors/DatatableGridEditor.test.tsx`
- **Verification:** All 18 tests in the file pass, including the forced-mismatch (addEntry called zero times) and clean-round-trip (addEntry called exactly once) acceptance-criteria tests.
- **Committed in:** `83012d7`

**2. [Rule 2 - Missing Critical] `STATIC_PANEL_IDS` allowlist for the reopen-closed-panel menu**
- **Found during:** Task 3 (registering `'datatable-grid-editor'` in `panelComponents`)
- **Issue:** `WorkspaceShell.tsx`'s "reopen closed panel" menu computed its list via `Object.keys(panelComponents)`. Registering the new dynamic `'datatable-grid-editor'` component key in that same map would have made it permanently appear in the reopen menu (it has no fixed id, so it's always "closed") — clicking it would call `api.addPanel({id: 'datatable-grid-editor', component: 'datatable-grid-editor'})` with no `params`, crashing the panel (it destructures `params.table` unconditionally).
- **Fix:** Introduced `STATIC_PANEL_IDS`, a curated list of singleton panel ids, and switched `handleLayoutMenuOpen`'s closed-panel computation to iterate that list instead of `Object.keys(panelComponents)`.
- **Files modified:** `packages/renderer/src/workspace/WorkspaceShell.tsx`
- **Verification:** `WorkspaceShell.test.tsx` (5 tests, unaffected/still green) + manual code-path review.
- **Committed in:** `0523aef`

---

**Total deviations:** 2 auto-fixed (1 Rule 3 test-infra blocker, 1 Rule 2 missing-critical-correctness fix). No scope creep beyond what the plan's own acceptance criteria required.

## Files Created/Modified

- `packages/renderer/src/panels/editors/SchemaRail.tsx` - 250px collapsible schema rail (new)
- `packages/renderer/src/panels/editors/SchemaRail.test.tsx` - Component tests (new)
- `packages/renderer/src/panels/editors/shared/TypeBadge.tsx` - Extracted shared badge component (new)
- `packages/renderer/src/panels/editors/DatatableGridEditor.tsx` - Real Hex view + gate wiring + SchemaRail mount + tab mod-dot
- `packages/renderer/src/panels/editors/DatatableGridEditor.test.tsx` - Extended: Hex view, SchemaRail, gate pass/fail, FailBanner format, ＋Stage-equals-Save·run-gate
- `packages/renderer/src/panels/editors/dtiiTypeSpec.ts` - `physicalTypeForKind` promoted to a shared export
- `packages/renderer/src/panels/editors/dtiiTypeSpec.test.ts` - Coverage for `physicalTypeForKind`
- `packages/renderer/src/shell/editorTabs.ts` - `openEditorTab` shared dockview-tab-opening helper (new)
- `packages/renderer/src/shell/editorTabs.test.ts` - Dedup contract tests (new)
- `packages/renderer/src/panels/tre/VfsTree.tsx` - `onOpenEditor` double-click callback prop
- `packages/renderer/src/panels/tre/VfsTree.test.tsx` - Double-click wiring tests (new)
- `packages/renderer/src/panels/tre/TreVfsBrowser.tsx` - `handleOpenEditor` (FORM-tag gate + `openEditorTab` call), accepts `dockApi` prop
- `packages/renderer/src/panels/tre/TreVfsBrowser.test.tsx` - Source-level contract tests for the FORM-tag gate + wiring (new)
- `packages/renderer/src/panels/SidebarPanel.tsx` - Drills `props.containerApi` to `TreVfsBrowser` as `dockApi`
- `packages/renderer/src/workspace/WorkspaceShell.tsx` - Registers `'datatable-grid-editor'`, removes `'datatable'`, adds `STATIC_PANEL_IDS`
- `packages/renderer/src/workspace/workspace-config.ts` - `LAYOUT_VERSION` 3→4, bottom pane is Console|Log only
- `packages/renderer/src/workspace/workspace-config.test.ts` - Updated Tests 8/9 for the retirement
- `packages/renderer/src/panels/DatatablePanel.tsx` - **Deleted** (superseded)

## Issues Encountered

- `vi.mock('@swg/native-core', ...)` gotcha — see Deviations #1. Cost real debugging time (a test that should fail silently "passed" instead of erroring, which is the worst failure mode for a false-negative gate test) before the project's own prior-documented precedent (`useLiveService.test.ts`) was found and applied.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `editorTabs.ts`'s `openEditorTab` is ready for 05-09's `.stf` strings editor to import unchanged (same dedup + main-editor-group-tab contract).
- `GateBar`/`FailBanner` (05-06) are now proven end-to-end against a real gate machine implementation — 05-09 can follow the identical wiring shape (serialize → re-parse → re-serialize → byte-compare → stage-or-fail-banner) for its own `.stf` round-trip.
- `DatatableGridEditorParams`'s `sourceBytes`/`iffRoots` optional-field pattern (graceful HexInspector empty-state fallback) is a reusable precedent for `.stf`'s own Hex/byte-inspector needs, if any.
- No blockers. DATA-01 is now functionally complete end-to-end: mount → double-click → edit → gate → stage.

## Self-Check: PASSED

All 7 newly-created files verified present on disk (`SchemaRail.tsx`/`.test.tsx`, `shared/TypeBadge.tsx`, `editorTabs.ts`/`.test.ts`, `VfsTree.test.tsx`, `TreVfsBrowser.test.tsx`); `DatatablePanel.tsx` confirmed deleted; both task commit hashes (`83012d7`, `0523aef`) verified present in `git log`. Full renderer suite (59 files / 453 tests) green post-commit; `tsc --noEmit` clean.

---
*Phase: 05-wysiwyg-live-sync-typed-editors*
*Completed: 2026-07-15*
