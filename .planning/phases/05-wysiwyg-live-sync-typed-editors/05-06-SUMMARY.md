---
phase: 05-wysiwyg-live-sync-typed-editors
plan: 06
subsystem: ui
tags: [react, dockview, dtii, datatable, gate-machine, virtualization, type-spec-grammar]

# Dependency graph
requires:
  - phase: 05-wysiwyg-live-sync-typed-editors (plan 02)
    provides: Native DTII parser/serializer + N-API binding, per-cell byteOffset/byteLength, the { formatTag, version, columns, rows } return shape this plan's grid consumes directly
provides:
  - Shared gate-state UI primitives (VerificationStatus 'running' variant + dashedBorder prop, GateBar, FailBanner) — ONE implementation for both DTII (this plan) and .stf (05-09)
  - dtiiTypeSpec.ts — pure, independently-tested DTII type-spec grammar interpreter (all 9 non-Comment kinds, z(...) enum-table special case, bitVectorFlagToMask helper)
  - DatatableGridEditor.tsx — crumb bar, grid toolbar, virtualized typed grid (sort/edit/modified-encoding), driven entirely by dtiiTypeSpec.ts
affects: ["05-08 (schema rail, real Hex view, GateBar/FailBanner gate wiring to the native round-trip)", "05-09 (.stf editor reuses GateBar/FailBanner unchanged)"]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Shared gate-state machine: GateBar/FailBanner are pure/presentational, driven entirely by props (state + per-caller copy strings) — no DTII/.stf-specific imports, so 05-09 imports them unchanged"
    - "Type-spec grammar interpretation isolated in a pure, framework-free module (dtiiTypeSpec.ts) with its own fixture-backed tests, consumed (never re-implemented) by the grid component"
    - "z(...) enum-table dispatched as a structurally distinct discriminated-union variant BEFORE the e(...) key=value grammar can ever see it — REVIEWS.md MEDIUM crash-fix enforced by construction, not by a runtime guard"
    - "VfsTree.tsx's ROW_HEIGHT/OVERSCAN/ResizeObserver virtualization scaffold reused verbatim for the DTII grid's vertical windowing"

key-files:
  created:
    - packages/renderer/src/panels/editors/shared/GateBar.tsx
    - packages/renderer/src/panels/editors/shared/GateBar.test.tsx
    - packages/renderer/src/panels/editors/shared/FailBanner.tsx
    - packages/renderer/src/panels/editors/dtiiTypeSpec.ts
    - packages/renderer/src/panels/editors/dtiiTypeSpec.test.ts
    - packages/renderer/src/panels/editors/DatatableGridEditor.tsx
    - packages/renderer/src/panels/editors/DatatableGridEditor.test.tsx
    - packages/renderer/src/shared/VerificationStatus.test.tsx
  modified:
    - packages/renderer/src/shared/VerificationStatus.tsx

key-decisions:
  - "GateBar's pass-state 'staged in working changes' chip is rendered as a plain --color-info-styled span, not another VerificationStatus instance — VerificationStatus always prepends its own glyph, which would visually collide with the chip's own leading '→' arrow already baked into the copy string."
  - "dtiiTypeSpec.ts strengthens getDelimStr's C++ behavior: when the closing delimiter is absent or precedes the opening one, it returns null (not a garbage/negative-length substring) so malformed specs like 'e(malformed' degrade to {kind:'unknown'} instead of silently producing an empty label map — required by the plan's own non-throwing/never-mis-parse acceptance criteria."
  - "The Schema rail, real Hex view content, and GateBar/FailBanner's live wiring to the native round-trip gate are explicitly 05-08's scope per this plan's objective text — this plan renders a static not-run GateBar placeholder and a Hex-view placeholder pane so the crumb bar and footer read correctly at the target ~940-1080px width in the meantime, without pre-building 05-08's wiring."
  - "packedObjVars gets a minimal 3-field (name/type/value) inline editor joined as `name|type|value|$|` on commit — a deliberate simplification of the real multi-entry packed-objvar format, matching the plan's own 'minimal' framing (full multi-entry editing is not required by this plan's acceptance criteria)."

patterns-established:
  - "Pattern: pure grammar/interpreter modules (no React, no native-core imports) get their own fixture-backed *.test.ts file, imported (never re-implemented) by the consuming UI component — dtiiTypeSpec.ts is the first instance of this split in the editors/ directory, and the .stf editor should mirror it if it needs comparable grammar work."

requirements-completed: [DATA-01]

# Metrics
duration: ~20min
completed: 2026-07-15
---

# Phase 5 Plan 06: DTII Grid Editor — Shared Gate UI, Type-Spec Grammar, Grid Anatomy Summary

**Shared GateBar/FailBanner gate-state UI (extending VerificationStatus), a pure fixture-tested dtiiTypeSpec.ts grammar interpreter covering all 9 non-Comment DTII column types (z(...) enum-table structurally isolated from the enum label-map parser), and DatatableGridEditor's crumb bar / toolbar / virtualized typed grid with double-click cell editors and modified-cell triple-encoding.**

## Performance

- **Duration:** ~20 min
- **Started:** 2026-07-15T16:59:53Z (approx, session start)
- **Completed:** 2026-07-15T17:15:00Z
- **Tasks:** 3/3 completed
- **Files modified:** 9 (8 created, 1 modified)

## Accomplishments
- `VerificationStatus.tsx` extended with a `running` variant + optional `dashedBorder` prop — every pre-existing call site (IffStructureTree, etc.) renders unchanged since the new prop defaults to `false`.
- `GateBar.tsx` / `FailBanner.tsx`: the shared 4-state gate machine (not-run/running/pass/fail) and danger-tinted diagnostic banner, both pure/presentational and driven entirely by props, ready for 05-08 (DTII wiring) and 05-09 (.stf, unchanged import) to consume.
- `dtiiTypeSpec.ts`: a pure, zero-import TS module implementing the full DTII type-spec grammar (int/float/string/hashstring/bool/packedObjVars/enum/bitvector/enum-table + bracket-suffix default marker), ported from `DataTableColumnType.cpp:84-232` ground truth, with a `bitVectorFlagToMask` wire-encoding helper. `z(...)` is dispatched as a structurally distinct `enum-table` variant BEFORE the `e(...)` key=value parser ever runs, closing REVIEWS.md's crash-fix finding by construction.
- `DatatableGridEditor.tsx`: the crumb bar (`FORM DTII ▸ FORM <version> ▸ DATA`, Grid|Hex toggle, Compare/Stage/Save-run-gate buttons), grid toolbar (filter, +Row/−Row in-memory edits, count chip), and a VfsTree-idiom virtualized grid with the D-07 widened 9-kind type-badge set, click-to-sort headers, double-click cell editors dispatched entirely via `parseTypeSpec`, and the full modified-cell triple-encoding (border + tint + glyph, propagated to the row-number `●` and up to the tab via `onModifiedChange`).
- `z(...)` columns render as a read-only numeric display with no `<select>`/dropdown — verified by a component test asserting no interactive enum widget renders for that column, closing the REVIEWS.md MEDIUM crash-fix finding at the UI layer too.

## Task Commits

Each task was committed atomically:

1. **Task 1: Shared gate-state components** - `42995ff` (feat)
2. **Task 2 RED: failing dtiiTypeSpec test** - `2765885` (test)
2. **Task 2 GREEN: dtiiTypeSpec implementation** - `3846e40` (feat)
3. **Task 3: DatatableGridEditor** - `dd62a4b` (feat)

**Plan metadata:** (this commit)

## TDD Gate Compliance

Task 2 (`tdd="true"`) followed the RED → GREEN gate sequence: `2765885` (test, RED — import-error failure against the not-yet-existing module) landed before `3846e40` (feat, GREEN — all 12 dtiiTypeSpec assertions pass). No REFACTOR commit was needed (implementation matched the ported ground-truth algorithm on the first pass).

## Files Created/Modified
- `packages/renderer/src/shared/VerificationStatus.tsx` - Added `'running'` variant + `dashedBorder?: boolean` prop
- `packages/renderer/src/shared/VerificationStatus.test.tsx` - Covers the new variant/prop surface only (pre-existing variants already covered elsewhere)
- `packages/renderer/src/panels/editors/shared/GateBar.tsx` - Shared 4-state gate machine footer bar
- `packages/renderer/src/panels/editors/shared/GateBar.test.tsx` - All 4 states + FailBanner role="alert"
- `packages/renderer/src/panels/editors/shared/FailBanner.tsx` - Shared danger-tinted diagnostic banner
- `packages/renderer/src/panels/editors/dtiiTypeSpec.ts` - Pure DTII type-spec grammar interpreter
- `packages/renderer/src/panels/editors/dtiiTypeSpec.test.ts` - Fixture coverage for all 9 kinds + z(...)/malformed/default-suffix edge cases
- `packages/renderer/src/panels/editors/DatatableGridEditor.tsx` - Crumb bar, toolbar, virtualized typed grid
- `packages/renderer/src/panels/editors/DatatableGridEditor.test.tsx` - Component tests for the crumb/toolbar/grid/badge/z(...)/filter/modified-encoding acceptance criteria

## Decisions Made
See `key-decisions` in frontmatter above (GateBar staged-chip styling, dtiiTypeSpec's stricter malformed-input handling, 05-08 scope boundary for schema rail/hex/gate-wiring, packedObjVars minimal editor).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Added component test files not itemized in the plan's `files_modified` frontmatter**
- **Found during:** Tasks 1 and 3
- **Issue:** The plan's `<verify>` blocks explicitly run `pnpm --filter renderer test -- VerificationStatus` / `... DatatableGridEditor`, and the acceptance criteria repeatedly require "verified by a component test" / "a component test asserting..." — but the frontmatter's `files_modified` list for Task 1 omits `GateBar.test.tsx`/`VerificationStatus.test.tsx`, and Task 3 omits `DatatableGridEditor.test.tsx`.
- **Fix:** Added `VerificationStatus.test.tsx`, `GateBar.test.tsx` (also covers `FailBanner`), and `DatatableGridEditor.test.tsx` alongside their respective implementation files, since the plan's own verification commands and acceptance criteria are unsatisfiable without them.
- **Files modified:** (new) `VerificationStatus.test.tsx`, `GateBar.test.tsx`, `DatatableGridEditor.test.tsx`
- **Verification:** All new tests pass; full renderer suite green (50 files / 384 tests) with no regressions.
- **Committed in:** `42995ff` (Task 1), `dd62a4b` (Task 3)

---

**Total deviations:** 1 auto-fixed (Rule 2 category, three files)
**Impact on plan:** Necessary to satisfy the plan's own stated verify/acceptance-criteria commands. No scope creep beyond test coverage for the exact components the plan specifies.

## Issues Encountered
- jsdom has no native `ResizeObserver` — `DatatableGridEditor.test.tsx` stubs it at module scope, following the exact convention already established in `DeployDialog.test.tsx`/`DeployPanel.test.tsx` (no new pattern introduced).
- `pnpm --filter renderer test -- <pattern>` intermittently double-quotes the filter argument in a way that causes vitest to fall back to running the entire suite instead of filtering — same pre-existing repo quirk noted in 05-02-SUMMARY.md for `pnpm --filter`. Worked around by running `npx vitest run <pattern>` directly from `packages/renderer/` for targeted runs; the full `pnpm --filter renderer test` (no args) run at the end confirms the whole suite (50 files / 384 tests) is green regardless.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- `GateBar`/`FailBanner` are ready for 05-08 to wire to the real native round-trip gate (replacing this plan's static not-run placeholder) and for 05-09 to import unchanged for the `.stf` editor.
- `dtiiTypeSpec.ts`'s `TypeSpecInfo` discriminated union and `bitVectorFlagToMask` helper are stable and ready for 05-08's Schema rail (`Schema · COLS/TYPE` section) to consume directly.
- `DatatableGridEditor.tsx` exports `DatatableGridEditorParams` (`{ table, virtualPath, onModifiedChange, onStage, onSaveRunGate }`) — 05-08 wires real `onStage`/`onSaveRunGate` handlers, adds the Schema rail alongside the grid, replaces the Hex-view placeholder with the real byte-highlight view, and swaps the static `GateBar` for one driven by live gate state.
- No blockers. The grid's virtualization, sort, filter, and typed cell-editing all work against a hand-built fixture in this plan's tests; 05-08 should additionally smoke-test against a real extracted DTII asset (e.g. `appearance_table.iff` from 05-02-SUMMARY.md) once the native round-trip is wired end-to-end.

## Self-Check: PASSED

All created files verified present on disk; all task commit hashes verified present in `git log`.

---
*Phase: 05-wysiwyg-live-sync-typed-editors*
*Completed: 2026-07-15*
