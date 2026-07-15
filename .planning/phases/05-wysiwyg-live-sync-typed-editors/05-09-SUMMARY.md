---
phase: 05-wysiwyg-live-sync-typed-editors
plan: 09
subsystem: ui
tags: [react, dockview, stf, localized-strings, gate-machine, round-trip, n-api]

# Dependency graph
requires:
  - phase: 05-wysiwyg-live-sync-typed-editors (plan 05)
    provides: Native .stf parser/serializer (parseStf/serializeStf), StfResult/StfEntry C++ shapes,
      recomputeSourceCrcFromText declared-but-unbound helper
  - phase: 05-wysiwyg-live-sync-typed-editors (plan 08)
    provides: Shared GateBar/FailBanner gate-state UI, editorTabs.openEditorTab dockview-tab-opening
      helper, DatatableGridEditor's gate-wiring shape (serialize -> re-parse -> re-serialize ->
      byte-compare -> stage-or-fail) this plan mirrors
provides:
  - StfStringsEditor.tsx — crumb bar + search/add toolbar + flat virtualized key|crc32|text grid +
    shared GateBar/FailBanner + per-row "mark re-synced to source" action
  - recomputeSourceCrcFromText N-API binding (stf_binding.cpp/addon.cpp) — 05-05 left this
    unbound by design; this plan is the one that wires it (its one intended caller)
  - GateBar.tsx `note` prop — optional right-aligned faint mono footer note, backward compatible
  - shared/crumbButtonStyles.ts — extracted crumb-bar button style constants
  - StfStringsEditor reachable from the VFS browser via double-click on a `.stf` entry
affects: ["05-10/05-11/05-12 (viewport gizmo + live-sync HUD, LIVE-03) — no direct dependency on this plan's output"]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Working-row model merges byId + nameToId into ONE row per string (id + key/name + text +
      sourceCrc together) rather than tracking two parallel arrays — both on-disk orderings
      (D-11) are re-derived FRESH at serialize time by sorting the merged row set (numeric by id
      for byId, lexicographic by key for nameToId), so order fidelity never depends on the
      display array's own (alpha-by-key) order being correct for either section."
    - "sourceCrc as `number | undefined` in the working-row model — undefined is the UI's 'unset'
      state for a brand-new row; NULL_CRC (0xFFFFFFFF) is assigned only at first-save time inside
      buildStfResult(), never a recomputed hash of the row's own text (D-10)."
    - "recomputeSourceCrcFromText has exactly ONE call site in the entire file — the per-row
      '↻ Mark re-synced to source' hover action — never the Save · run gate path (grep-verified,
      T-05-24)."

key-files:
  created:
    - packages/renderer/src/panels/editors/StfStringsEditor.tsx
    - packages/renderer/src/panels/editors/StfStringsEditor.test.tsx
    - packages/renderer/src/panels/editors/shared/crumbButtonStyles.ts
  modified:
    - packages/native-core/src/stf_binding.cpp
    - packages/native-core/src/addon.cpp
    - packages/renderer/src/panels/editors/shared/GateBar.tsx
    - packages/renderer/src/workspace/WorkspaceShell.tsx
    - packages/renderer/src/panels/tre/TreVfsBrowser.tsx
    - packages/renderer/src/panels/tre/TreVfsBrowser.test.tsx

key-decisions:
  - "recomputeSourceCrcFromText was declared in native C++ (05-05) but deliberately left UNBOUND
    (zero N-API call sites, by design — 05-05-SUMMARY.md explicitly deferred this to '05-09's
    opt-in mark-re-synced-to-source UI action'). This plan added the N-API binding
    (RecomputeSourceCrcFromText in stf_binding.cpp, registered in addon.cpp) and rebuilt the
    native-core addon — required for the plan's own Task 1 action text ('calls
    addon.recomputeSourceCrcFromText(...)'), which cannot work without this export existing."
  - "The re-sync action's 'default-locale file's current text' argument is interpreted as THIS
    file's own current row text (nativeCore.recomputeSourceCrcFromText(row.text)) — the editor
    only has one locale's file open at a time (018-B cross-locale readout was explicitly NOT
    selected per 05-UI-SPEC.md), so there is no other text source available in this plan's scope.
    For a default-locale file this is exactly correct; for a non-default-locale file it is a
    documented simplification consistent with the single-locale-editor scope this phase shipped."
  - "GateBar.tsx gained an optional `note` prop (right-aligned faint mono footer) rather than
    StfStringsEditor rendering a second bar below/around GateBar — the .stf UI-SPEC's footer note
    is part of the SAME gate-bar row per the sketch, and the prop is backward compatible (DTII
    omits it, so DatatableGridEditor's own gate bar is visually unchanged)."
  - "shared/crumbButtonStyles.ts extracts DatatableGridEditor's inline ghost/primary button
    styles into shared constants per the plan's own instruction ('extract a small shared style
    constant if one does not already exist, rather than duplicating inline styles'). DTII's own
    file is NOT refactored to consume them in this plan (out of scope) — a future pass can
    converge both editors onto this one source without a visual diff."
  - "Working-row model merges the byId string-section entry and its nameToId name into ONE row
    (id + key + text + sourceCrc together), rather than literally maintaining two parallel
    arrays. Both on-disk orderings are re-derived fresh at serialize time (buildStfResult sorts
    by id for entries, by key for nameMap) — this satisfies D-11's 'keep both orderings intact'
    requirement without the extra bookkeeping of two synchronized arrays, since re-sorting a
    single merged set on two different keys is equivalent and strictly simpler."
  - "'＋ Stage' and 'Save · run gate' call the IDENTICAL handleSaveRunGate function (mirrors
    05-08's DTII precedent — 'not a separate weaker path')."
  - "FailBanner's single action for a .stf gate failure is 'Dismiss' (resets gate to not-run) —
    unlike DTII's 'Jump to bytes'/'Revert cell' actions, .stf has no Hex view surface and no
    single-cell revert target (edits are diffuse across multiple key/text/crc fields per row), so
    there is no natural analog for those two DTII-specific actions in this editor."

patterns-established:
  - "Dynamic per-file dockview tab components for typed editors are registered in
    WorkspaceShell.tsx's panelComponents but excluded from STATIC_PANEL_IDS, and opened
    exclusively via editorTabs.ts's openEditorTab from the OWNING BROWSER's open-editor handler
    (TreVfsBrowser.handleOpenEditor) — never from VfsTree.tsx itself, which has no native-core or
    dockview access and stays a generic 'fire onOpenEditor on double-click' component regardless
    of how many typed-editor branches the owning browser adds."

requirements-completed: [DATA-02]

# Metrics
duration: single session
completed: 2026-07-15
---

# Phase 5 Plan 09: .stf Strings Editor — Crumb, Grid, sourceCrc-Preserving Gate, Dockview Wiring Summary

**`.stf` localized-strings editor as the direct sibling of the DTII grid editor — flat virtualized key|crc32|text grid, sourceCrc preserved byte-verbatim by default (D-10) with an explicit per-row re-sync action as the ONLY path that recomputes it, reusing the exact shared GateBar/FailBanner components and editorTabs.openEditorTab dockview-tab-opening helper DTII established — DATA-02 complete.**

## Performance

- **Duration:** single session
- **Completed:** 2026-07-15
- **Tasks:** 3/3 completed (Tasks 1+2 committed together — see Deviations, mirrors 05-08's precedent)
- **Files modified:** 9 (3 created, 6 modified)

## Accomplishments

- `StfStringsEditor.tsx`: full Surface 3 anatomy — crumb bar (`string/<locale>/<file>.stf · STF ·
  <N> entries (<M> shown)` + `⇄ Compare to base` disabled + `＋ Stage` + `Save · run gate`),
  toolbar (`Search keys and text…` filtering by BOTH key and localized text + `＋ Add key` + count
  chip), and a flat virtualized `key | crc32 | localized text` grid (VfsTree.tsx ROW_HEIGHT/
  OVERSCAN/ResizeObserver idiom).
- `crc32` column is READ-ONLY everywhere — never an `<input>` element (grep/DOM-verified). Existing
  rows render the hex value (`0xa1b2c3d4`); new rows render the REVIEWS.md-corrected
  `unset · assigned on first save` placeholder (not the original ambiguous `"0x········ (auto on
  save)"` phrasing). Zero occurrences of `"auto on save"` / `"CRC32 auto"` anywhere in the file
  (grep-enforced test).
- Per-row `↻ Mark re-synced to source` hover action next to the crc32 cell — the ONE call site in
  the entire file for `recomputeSourceCrcFromText` (grep-verified, T-05-24). Never called from the
  Save · run gate path.
- `Save · run gate`: `buildStfResult()` derives `byId` (numeric-ascending) and `nameToId`
  (lexicographic-ascending) fresh from the current row set, calls `serializeStf`, then re-parses +
  re-serializes and byte-compares (mirrors 05-08's DTII stability proof). Pass stages via
  `stagingStore.addEntry` — exactly ONE call site (T-05-23) — and clears modified marks; fail
  renders the shared `FailBanner` and never stages. Every entry's `sourceCrc` in the serialized
  output is EXACTLY the in-memory value at save time (original parsed value or the re-sync
  action's value) — never computed inline during save (D-10 proven by a dedicated test).
- Native: `recomputeSourceCrcFromText` — declared in 05-05 but deliberately left unbound (zero
  N-API call sites, by design) — is now exported (`RecomputeSourceCrcFromText` in
  `stf_binding.cpp`, registered in `addon.cpp`). Native-core rebuilt (`cmake-js build`); verified
  both via a direct `require()` smoke test and the full `stf-roundtrip.test.ts` harness suite
  (10/10 green against the rebuilt addon).
- `GateBar.tsx` gained an optional `note` prop (right-aligned faint mono footer,
  `values are UTF-16LE · keys ASCII · sourceCrc preserved on save` — REVIEWS.md-corrected,
  replacing the original ambiguous `"CRC32 auto"` phrasing) — backward compatible; DTII omits it.
- `WorkspaceShell.tsx`: registers `'stf-strings-editor'` (same dynamic-per-file shape as
  `'datatable-grid-editor'`, excluded from `STATIC_PANEL_IDS`).
- `TreVfsBrowser.tsx`'s `handleOpenEditor` gains a `.stf`-EXTENSION branch (not a FORM-tag check —
  `.stf` is PARSER-NATIVE, no IFF tree, 05-05): reads bytes, calls `nativeCore.parseStf`, derives
  `locale` from the path segment after `string/`, opens the tab via the SAME shared
  `openEditorTab` helper DTII uses (dedup-by-id unchanged, no hand-rolled `addPanel` call).

## Task Commits

1. **Tasks 1+2: StfStringsEditor — crumb/toolbar/grid + sourceCrc-preserving gate wiring** - `65ece3e` (feat)
2. **Task 3: Dockview tab wiring via the shared editorTabs helper** - `315d5b9` (feat)

Tasks 1 and 2 share the same file (`StfStringsEditor.tsx`) and interdependent state (the crc32
column's read-only display and the gate machine's sourceCrc-preservation proof were designed
together for correctness), so they were committed together rather than split — same rationale
05-08 documented for its own Tasks 1+2.

## Decisions Made

See `key-decisions` in frontmatter above (native binding addition, re-sync-action text source,
GateBar `note` prop, shared button-style extraction, merged working-row model, `＋Stage`==`Save ·
run gate`, FailBanner action choice for `.stf`).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2/3 - Missing Critical / Blocking] `recomputeSourceCrcFromText` had no N-API binding**
- **Found during:** Task 1 (writing the per-row re-sync action)
- **Issue:** 05-05 implemented and declared `recomputeSourceCrcFromText` in C++ but explicitly left
  it UNBOUND (05-05-SUMMARY.md: "not bound via N-API, not called by serializeStf... since the
  future opt-in 'mark re-synced to source' UI action (05-09) is out of this plan's scope"). This
  plan's Task 1 action text requires calling `addon.recomputeSourceCrcFromText(...)` directly,
  which cannot work without an export existing on the native module.
- **Fix:** Added `RecomputeSourceCrcFromText` N-API binding to `stf_binding.cpp` (thin wrapper,
  same pattern as `ParseStf`/`SerializeStf`), registered it in `addon.cpp`, rebuilt the native-core
  addon (`cmake-js build --generator "Visual Studio 17 2022" --platform x64`).
- **Files modified:** `packages/native-core/src/stf_binding.cpp`, `packages/native-core/src/addon.cpp`
- **Verification:** `require('@swg/native-core').recomputeSourceCrcFromText` loads as a callable
  function and returns a deterministic CRC-32 for a known input; full `stf-roundtrip.test.ts`
  harness suite (10/10) still green post-rebuild; `StfStringsEditor.test.tsx`'s re-sync tests pass
  against the real binding shape (mocked in the component test, but the binding itself was smoke-
  tested directly via `node -e`).
- **Committed in:** `65ece3e` (Tasks 1+2 commit)

**2. [Rule 1 - Bug] Plan named the wrong file for the `.stf` double-click branch**
- **Found during:** Task 3 (dockview tab wiring)
- **Issue:** The plan's `files_modified` frontmatter and Task 3 action text both name `VfsTree.tsx`
  as the file to extend with a `.stf`-extension double-click branch. But per 05-08's own
  established pattern (and `VfsTree.tsx`'s own header comment: "VfsTree itself has no native-core
  or dockview access"), ALL FORM-tag/extension detection and tab-opening logic for typed editors
  lives in `TreVfsBrowser.tsx`'s `handleOpenEditor` — `VfsTree.tsx`'s `onOpenEditor` callback is
  already fully generic (fires unconditionally on any double-click) and required zero changes to
  support a new file type.
- **Fix:** Extended `TreVfsBrowser.tsx`'s existing `handleOpenEditor` with a `.stf`-extension
  branch instead. `VfsTree.tsx` is unmodified — its existing wiring already covers `.stf` entries.
- **Files modified:** `packages/renderer/src/panels/tre/TreVfsBrowser.tsx` (not `VfsTree.tsx`)
- **Verification:** `TreVfsBrowser.test.tsx` gained 5 new source-level contract tests locking in
  the extension gate, the `parseStf`-only call shape (no `parseIff`/`parseDataTable` in that
  branch), locale derivation, and the single-tab-opening-mechanism invariant; `VfsTree.test.tsx`
  (unmodified) still green, confirming no regression.
- **Committed in:** `315d5b9` (Task 3 commit)

---

**Total deviations:** 2 auto-fixed (1 Rule 2/3 missing-native-binding fix required for the plan's
own literal requirement, 1 Rule 1 file-naming correction). No scope creep beyond what the plan's
own acceptance criteria required.

## Files Created/Modified

- `packages/renderer/src/panels/editors/StfStringsEditor.tsx` - Full Surface 3 anatomy: crumb bar, toolbar, virtualized grid, per-row re-sync action, gate wiring (new)
- `packages/renderer/src/panels/editors/StfStringsEditor.test.tsx` - 21 tests: source-level contracts, crumb/toolbar, crc32 read-only, search-both-fields, add-key, gate wiring (new)
- `packages/renderer/src/panels/editors/shared/crumbButtonStyles.ts` - Extracted ghost/primary crumb-bar button style constants (new)
- `packages/native-core/src/stf_binding.cpp` - `RecomputeSourceCrcFromText` N-API binding (05-09 wires 05-05's unbound helper)
- `packages/native-core/src/addon.cpp` - Forward declaration + `exports.Set` registration for the new export
- `packages/renderer/src/panels/editors/shared/GateBar.tsx` - Optional `note` prop (right-aligned faint mono footer, backward compatible)
- `packages/renderer/src/workspace/WorkspaceShell.tsx` - Registers `'stf-strings-editor'` (dynamic per-file, excluded from STATIC_PANEL_IDS)
- `packages/renderer/src/panels/tre/TreVfsBrowser.tsx` - `handleOpenEditor` gains a `.stf`-extension branch (parseStf + locale derivation + openEditorTab)
- `packages/renderer/src/panels/tre/TreVfsBrowser.test.tsx` - 5 new source-level contract tests for the `.stf` branch

## Issues Encountered

None beyond the deviations documented above.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- DATA-02 is now functionally complete end-to-end: mount → double-click `.stf` → view/edit →
  gate → stage, mirroring DATA-01's DTII completion in 05-08.
- `GateBar`'s new `note` prop and `shared/crumbButtonStyles.ts` are available for any future
  editor that needs the same footer-note or button-style reuse.
- 05-10/05-11/05-12 (viewport gizmo + live-sync HUD, LIVE-03) have no dependency on this plan's
  output — they consume Phase 3's live-injection foundation, not the typed-editor surfaces.
- No blockers.

## Self-Check: PASSED

Both created source files (`StfStringsEditor.tsx`, `shared/crumbButtonStyles.ts`) and the test
file (`StfStringsEditor.test.tsx`) verified present on disk; both task commit hashes (`65ece3e`,
`315d5b9`) verified present in `git log`. Full renderer suite (60 files / 479 tests) green;
`tsc --noEmit` clean; full workspace suite (68 files / 542 tests, 2 pre-existing unrelated skips)
green; native-core `stf-roundtrip.test.ts` harness suite (10/10) green against the rebuilt addon.

---
*Phase: 05-wysiwyg-live-sync-typed-editors*
*Completed: 2026-07-15*
