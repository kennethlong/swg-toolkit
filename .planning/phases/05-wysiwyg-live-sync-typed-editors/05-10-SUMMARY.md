---
phase: 05-wysiwyg-live-sync-typed-editors
plan: 10
subsystem: live-sync
tags: [r3f, drei, transformcontrols, gizmo, zero-allocation, zustand, vitest]

# Dependency graph
requires:
  - phase: 05-wysiwyg-live-sync-typed-editors
    plan: 07
    provides: "useCommandWriter.writeTransform (zero-alloc write path), liveStore per-identity guardState/verifiedState (hasTarget/targetUnavailableOnBuild/scaleUnavailableOnBuild)"
provides:
  - "TransformGizmo.tsx — drei TransformControls wrapper (translate/rotate/scale/universal), sketch-locked axis-hex recoloring, drei Html axis letter labels, guard-aware zero-allocation onChange write path"
  - "GizmoStatusLabel — DOM overlay (MissingDepsOverlay idiom) rendering the D-05 offline copy, the honest cross-build target-identity label, and the Scale-unavailable-on-build structural label"
  - "objectToTransform12 — pure THREE Object3D -> row-major float[3][4] conversion helper matching LIVE_CHANNEL_LAYOUT.TRANSFORM's read-side convention"
  - "GizmoModeRail.tsx — left-edge mode rail (Move/Rotate/Scale/Universal) with W/E/R/Q shortcuts, radiogroup/aria-pressed semantics"
  - "Viewport.tsx wiring — lifted gizmoMode single source of truth, stable targetRef group wrapping SceneContent's mesh output as the gizmo's attach target"
affects: [05-11-hud-readout-bar, 05-12-uat]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "First use of drei's Html helper in this codebase (grepped, no prior precedent) — 3D-scene axis letter labels and, more importantly, the pattern of splitting an R3F-scoped 3D component from a plain-DOM status/label component (mirrors Viewport.tsx's existing MissingDepsOverlay idiom) specifically to keep the DOM-testable pieces (offline copy, target label, scale-unavailable label) assertable via @testing-library/react without needing an R3F/WebGL test harness"
    - "R3F component testing without a Canvas: mock @react-three/drei's TransformControls/Html and @react-three/fiber's useFrame/useThree to plain stand-ins that capture props (mode/enabled/onChange) into a shared array — a captured onChange is then invoked directly to simulate a drag-move tick, sidestepping the lack of any @react-three/test-renderer in this project"
    - "Sibling-group attach target: wrap SceneContent's conditional mesh-render block in one stable <group ref> that persists across mesh swaps — TransformGizmo/the group mount in the SAME commit, so drei's own useLayoutEffect attach (which only re-runs on ref-object identity change, not ref.current mutation) always sees a populated object.current"

key-files:
  created:
    - packages/renderer/src/panels/viewport/TransformGizmo.tsx
    - packages/renderer/src/panels/viewport/TransformGizmo.test.tsx
    - packages/renderer/src/panels/viewport/GizmoModeRail.tsx
    - packages/renderer/src/panels/viewport/GizmoModeRail.test.tsx
  modified:
    - packages/renderer/src/panels/viewport/Viewport.tsx

key-decisions:
  - "'Universal' mode renders THREE separate TransformControls instances (translate+rotate+scale) simultaneously attached to the same object, rather than a single combined drei mode (drei 10.7.7's mode prop only accepts translate/rotate/scale) — the simpler of the two well-supported options the plan offered"
  - "Split TransformGizmo.tsx into two exports: the default R3F 3D component (TransformGizmo, mount inside <Canvas>) and a named plain-DOM overlay (GizmoStatusLabel, mount as a <Canvas> sibling) — the offline/target/scale-unavailable labels needed to be trivially testable with @testing-library/react, and this project has no R3F/WebGL test-rendering infrastructure to mount a real Canvas in vitest"
  - "Axis-hex recoloring of drei's TransformControls handle materials is applied via a best-effort imperative traversal of the attached instance's internal `.gizmo` Object3D (matching mesh names 'X'/'Y'/'Z' only, never the combo handles) — drei exposes no declarative color-override prop; this is guarded to degrade to a no-op rather than throw if three-stdlib's internals change shape, and is not covered by an automated test (no WebGL in vitest/jsdom)"
  - "DatatableGridEditor's existing Grid|Hex toggle already carries role=radiogroup + role=radio/aria-checked (the correct ARIA pairing for a radiogroup — equivalent intent to aria-pressed) — left unchanged per the plan's own 'skip only if already landed' instruction; StfStringsEditor has no Grid|Hex toggle at all (018-A is flat-grid-only), so there was nothing to fix there"
  - "Write-suppression reads liveStore imperatively via useLiveStore.getState() inside the onChange handler (never the reactive hook) — avoids re-subscribing/re-rendering on every drag tick, matching the plan's zero-React-state-churn interaction contract"

patterns-established:
  - "R3F-component-vs-DOM-overlay split for testability: any future HUD element that needs to read live/offline/guard state AND be text-assertable in vitest should follow GizmoStatusLabel's pattern (plain component, no R3F hooks) rather than living inside an R3F-scoped component that requires a Canvas to mount"

requirements-completed: [LIVE-03]

# Metrics
duration: ~13min
completed: 2026-07-15
---

# Phase 05 Plan 10: Interactive Transform Gizmo + Mode Rail Summary

**A drei TransformControls-based drag-to-write gizmo (Move/Rotate/Scale/Universal, sketch-locked axis hexes + letter labels) wired into Viewport.tsx's existing scene, feeding 05-07's zero-allocation writeTransform path, gated offline (D-05), gated per-channel on guardState, gated structurally on scaleUnavailableOnBuild (ROUND 2 W2), and honestly labeling what it moves on either build (05-CONTEXT decision #1 ROUND 2).**

## Performance

- **Duration:** ~13 min
- **Started:** 2026-07-15T13:44:11-05:00 (STATE.md session, immediately following 05-09's completion)
- **Completed:** 2026-07-15T13:57:33-05:00
- **Tasks:** 2 (both type="auto")
- **Files modified:** 5 (4 created, 1 modified)

## Accomplishments
- `TransformGizmo.tsx`: a drei `TransformControls` wrapper attached to a stable target group (the SAME object `Viewport.tsx`'s `SceneContent` already renders — no separate object picker). Four modes: `translate`/`rotate`/`scale` map 1:1 to drei's native modes; `universal` renders all three simultaneously (documented Flagged-Assumption-1 resolution — drei has no combined mode). Axis hexes (X `#e0584f`/Y `#6db33f`/Z `#4a8cff`) are applied to the underlying three-stdlib gizmo's single-axis handle materials via a best-effort, guarded traversal; each axis additionally carries a drei `Html` letter label (X/Y/Z) that tracks the target's world position every frame — the first use of drei's `Html` helper in this codebase.
- Zero-allocation write path: `onChange` reuses ONE module-level `Float32Array(12)`/`Float32Array(3)` scratch pair (never reallocated) and calls `writeTransform` (05-07) directly. `objectToTransform12` is a small, pure, unit-tested helper converting a THREE `Object3D`'s position+quaternion into the SAME row-major `float[3][4]` layout `LIVE_CHANNEL_LAYOUT.TRANSFORM` uses (translation in column 3), mirroring `LiveInspectorPanel.tsx`'s existing read-side convention on the write side.
- Guard-aware write suppression, layered correctly: offline (`status.kind !== 'attached'`) blocks all writes (belt-and-suspenders — `TransformControls` is also `enabled={false}` in that state, so no path reaches the handler at all); `scaleUnavailableOnBuild === true` unconditionally suppresses Scale writes REGARDLESS of `guardState.scale` (ROUND 2 W2 fix, T-05-36 — a structural build-capability gap, not a tamper); otherwise the ordinary per-channel `guardState.transform`/`guardState.scale === 'blocked'` traffic-suppression check applies independently per channel (Cursor MEDIUM fix).
- `GizmoStatusLabel`: a plain DOM overlay (NOT an R3F component — split out specifically for testability, see Decisions) mirroring the D-05 offline copy `○ Offline — attach a client to move objects live` exactly, the honest cross-build target-identity label (`target: <templateName>` / `target: none — moving player avatar` / `target: unavailable on this build — moving player avatar`, 05-CONTEXT decision #1 ROUND 2 — verified build-agnostic with both a legacy-shaped (`networkId: 0n`) and an advertised-shaped (`networkId` non-zero) simulated state), and the `Scale unavailable on this build` structural label (scoped to scale/universal mode only).
- `GizmoModeRail.tsx`: left-edge, vertically-centered rail (`✥ W` Move / `⟳ E` Rotate / `⤢ R` Scale / `✛ Q` Universal), `role="radiogroup"` + `aria-pressed` per button, W/E/R/Q keyboard shortcuts via a document-level keydown listener (mirroring `DeployDialog.tsx`'s established pattern) that ignores keystrokes while focus is inside a text input/textarea/contenteditable (Rule 2 — an un-scoped global shortcut would otherwise hijack ordinary typing). Scale (R) is always selectable regardless of `scaleUnavailableOnBuild` (D-09) — only the WRITE is gated, in `TransformGizmo`, never the mode-selection affordance.
- `Viewport.tsx`: lifts `gizmoMode` state as the SINGLE source of truth shared by `GizmoModeRail` (DOM overlay, `<Canvas>` sibling) and `TransformGizmo`'s `mode` prop (3D, inside `<Canvas>`); wraps `SceneContent`'s conditional mesh-render block in one stable `<group ref={targetRef}>` that persists across mesh swaps and is the gizmo's attach target.
- Verified (grep first, per the plan's instruction) that `DatatableGridEditor`'s existing Grid|Hex toggle already carries `role="radiogroup"` + `role="radio"`/`aria-checked` — the correct ARIA pairing for a radiogroup, equivalent intent to `aria-pressed` — so no change was needed there; `StfStringsEditor` has no Grid|Hex toggle at all (018-A is flat-grid-only per UI-SPEC), so there was nothing to fix in that file either.

## Task Commits

Each task was committed atomically:

1. **Task 1: TransformGizmo — restyled drei TransformControls, four modes, offline/scale-unavailable disabled-with-reason, honest cross-build target label, guard-aware write suppression** - `34a0238` (feat)
2. **Task 2: GizmoModeRail + Viewport mount wiring** - `2147723` (feat)

**Plan metadata:** (this commit, see final_commit below)

## Files Created/Modified
- `packages/renderer/src/panels/viewport/TransformGizmo.tsx` - New: TransformGizmo (3D) + GizmoStatusLabel (DOM overlay) + objectToTransform12
- `packages/renderer/src/panels/viewport/TransformGizmo.test.tsx` - New: 15 tests (write suppression matrix, labels, axis letters, conversion helper)
- `packages/renderer/src/panels/viewport/GizmoModeRail.tsx` - New: mode rail + keyboard shortcuts
- `packages/renderer/src/panels/viewport/GizmoModeRail.test.tsx` - New: 5 tests (radiogroup/aria-pressed, shortcuts, shared-mode contract)
- `packages/renderer/src/panels/viewport/Viewport.tsx` - Modified: lifted gizmoMode state, stable targetRef group, mounts TransformGizmo/GizmoModeRail/GizmoStatusLabel

## Decisions Made
See `key-decisions` in the frontmatter above (Universal-mode implementation, TransformGizmo/GizmoStatusLabel split for testability, axis-recolor traversal approach, Grid|Hex a11y verification result, imperative guard reads).

## Deviations from Plan

None — plan executed as written. The two implementation-detail choices the plan explicitly left to executor discretion (Universal-mode rendering strategy; where exactly the offline/target/scale-unavailable labels live, "or via the mode rail area") are documented as `key-decisions` above, not deviations — the plan's own text granted this latitude.

## Issues Encountered

None. The only friction was test-infrastructure discovery (this project has no R3F/WebGL test-rendering harness yet) — resolved by mocking `@react-three/drei`/`@react-three/fiber` to plain stand-ins for `TransformGizmo.test.tsx`, and by splitting the DOM-only status label out of the R3F-scoped component so it needs no such mocking at all. Both are documented as `patterns-established` above for future viewport-HUD plans (05-11) to reuse.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- The gizmo's write path, guard suppression, and label contracts are all in place and tested; 05-11 (bottom transform readout bar, client card, StatusBar mirror) can consume the same `liveStore` fields (`status`, `verifiedState.hasTarget`/`targetUnavailableOnBuild`/`scaleUnavailableOnBuild`, `guardState`) this plan already reads, plus `expectedTransform()`/`expectedScale()` from 05-07.
- The R3F-component/DOM-overlay split pattern and the drei-mock testing approach are both now precedent for 05-11, which will add more HUD DOM overlays (client card, delta readout, readout bar) — those are naturally DOM-only (like `GizmoStatusLabel`) and won't need the R3F-mocking approach at all.
- Known, explicitly out-of-scope-per-plan limitation carried forward (not a defect): the SEPARATE viewport<->live-object binding gap (whether the mesh loaded in the toolkit's viewport corresponds to whatever is targeted/selected in-game) remains open until Phase 7's `.ws` placement editing — this plan closes the narrower "gizmo always moves the player, never what's targeted/selected" gap on both builds, and does not claim to close the binding gap (05-11 is expected to add an inline mismatch warning for exactly this reason, per the plan's own objective text).
- Axis-hex handle recoloring is a best-effort visual touch with no automated coverage (no WebGL in vitest) — worth a manual glance during 05-12's UAT to confirm the three-stdlib internal traversal actually painted the handles as intended on a real GPU.
- Full renderer suite (62 files / 499 tests) green post both commits; `tsc --noEmit` clean.

---
*Phase: 05-wysiwyg-live-sync-typed-editors*
*Completed: 2026-07-15*

## Self-Check: PASSED

All created/modified files verified present on disk; both task commit hashes (34a0238, 2147723) verified present in git log.
