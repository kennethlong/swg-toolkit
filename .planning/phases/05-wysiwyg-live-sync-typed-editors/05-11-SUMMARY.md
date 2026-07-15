---
phase: 05-wysiwyg-live-sync-typed-editors
plan: 11
subsystem: live-sync
tags: [live-inject, zustand, react, r3f, drei, zero-allocation, wysiwyg, vitest, ui-hud]

# Dependency graph
requires:
  - phase: 05-wysiwyg-live-sync-typed-editors
    plan: 07
    provides: "liveStore per-identity guard/COW/write-log state, expectedTransform()/expectedScale() selectors, guardAddr/lastDiscardedChange, revertWrite/revertAll gate-on-blocked coalesced revert"
  - phase: 05-wysiwyg-live-sync-typed-editors
    plan: 10
    provides: "TransformGizmo.tsx (drei TransformControls wrapper, zero-alloc write path), GizmoStatusLabel, GizmoModeRail.tsx, Viewport.tsx's gizmo mounting + stable targetRef group"
provides:
  - "LiveSyncClientCard.tsx — 224px top-right HUD card: live/offline header, client/target(cross-build+mismatch-warning+name-match-caveat)/pid/fps/last-sync/COW-snapshot rows, two independent guard rows (scale four-branch precedence), session write log with per-write revert, Revert ALL (always clickable), all three B2 safety-state banners with real addr/expected-bytes and per-channel discarded-change disclosure"
  - "TransformReadoutBar.tsx — bottom-center Pos/Rot/Scale numbox bar with imperative (zero-React-state-churn) drag mirroring via a new liveDragTelemetry.ts pub/sub, typed-entry commit parity with the gizmo's write path, D-05 offline copy, ROUND 2 Scale-build-availability gating, floating drag-delta readout"
  - "StatusBar.tsx mode/sync/COW-snapshot/guard segments mirroring the client card's own store reads (guard chip reuses the shared scale-precedence helper)"
  - "Viewport.tsx final Surface 1 assembly: LiveSyncClientCard + TransformReadoutBar mounted as Canvas siblings, a NEW bottom-left vp-stats overlay (persp/resolution/fps/SAB-status, distinct from ViewportPanel's existing verts/tris/draws overlay), a real drei GizmoHelper/GizmoViewport corner-orientation gizmo inside the Canvas"
  - "liveStore.ts gains CowSnapshot.capturedAtMs, exported formatAddr, clientLabel, and recordWrite (with computeDeltaLabel) — closes the write-log-never-populates gap left by 05-10's direct useCommandWriter call"
  - "gizmoModeStore.ts — the gizmo-mode single source of truth lifted from Viewport.tsx's local useState so StatusBar can share it"
  - "liveSyncGuardPrecedence.ts — shared scale-guard four-branch precedence + isScaleGenuinelyBlocked/isCardGuardBlocked/normalizeAssetBasename, reused by the client card and StatusBar rather than re-derived per-file"
affects: [05-12-uat]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Imperative pub/sub bridging an R3F-scoped drag onChange tick to plain-DOM refs (liveDragTelemetry.ts) — the sanctioned way to cross the Canvas/DOM boundary without React state churn during a 60fps drag (LIVE-03 SC1); the readout bar's baseline (non-dragging) display stays reactively store-driven since that is NOT the drag hot path the SC targets"
    - "Coalesce-into-current-row write-log recording (liveStore.recordWrite, WRITE_LOG_COALESCE_MS=500) — reconciles '60fps onChange fires many times per drag' with 'the write log should show one row per gesture' without adding a drag-start/drag-end event to the already-shipped TransformGizmo.tsx"
    - "Shared precedence-logic extraction (liveSyncGuardPrecedence.ts) reused verbatim by the client card's scale row and StatusBar's compact guard chip — a build-capability gap (scaleUnavailableOnBuild) is never misreported as a tamper in either surface, by construction"

key-files:
  created:
    - packages/renderer/src/panels/viewport/LiveSyncClientCard.tsx
    - packages/renderer/src/panels/viewport/LiveSyncClientCard.test.tsx
    - packages/renderer/src/panels/viewport/TransformReadoutBar.tsx
    - packages/renderer/src/panels/viewport/TransformReadoutBar.test.tsx
    - packages/renderer/src/panels/viewport/liveDragTelemetry.ts
    - packages/renderer/src/panels/viewport/liveSyncGuardPrecedence.ts
    - packages/renderer/src/panels/viewport/Viewport.test.tsx
    - packages/renderer/src/state/gizmoModeStore.ts
    - .planning/phases/05-wysiwyg-live-sync-typed-editors/deferred-items.md
  modified:
    - packages/renderer/src/state/liveStore.ts
    - packages/renderer/src/state/liveStore.test.ts
    - packages/renderer/src/panels/viewport/TransformGizmo.tsx
    - packages/renderer/src/panels/viewport/Viewport.tsx
    - packages/renderer/src/shell/StatusBar.tsx
    - packages/renderer/src/shell/StatusBar.test.tsx
    - .planning/phases/05-wysiwyg-live-sync-typed-editors/05-UI-SPEC.md

key-decisions:
  - "recordWrite coalesces rapid recordWrite calls (<500ms apart) into the CURRENT write-log row instead of appending a new one — avoids flooding the log at 60fps while still satisfying 'every live write appends a row'"
  - "computeDeltaLabel picks scale-delta first, then position-delta, then a trace-based rotation-angle delta as fallback (Flagged Assumption 4 — exact rot delta format left to implementer discretion; a single scalar angle rather than a per-axis Euler decomposition)"
  - "The guard-blocked banner's scale variant cannot claim a live 'read <bytes>' value (VerifiedObjectState carries no scale field at all — no live-scale channel exists this round, matching 05-07's own lastDiscardedChange.scale.gotVerified=false precedent) — it uses an honest 'last known — not independently re-verified this session' phrasing instead of fabricating a read"
  - "The B2 'reverted' banner is driven by component-local state (revertedAt), not a liveStore flag — liveStore has no 'just reverted' signal (revertWrite/revertAll mutate writeLog directly); the card clears revertedAt once a genuinely NEW write-log entry appends afterward"
  - "TransformGizmo.tsx's trySendWrite now computes+publishes the object's pose UNCONDITIONALLY before the guard/offline suppression check (previously computed only on the accepted path) — drei has already moved the object locally by the time onChange fires, so the readout bar's numbox mirror must reflect the visual drag regardless of write outcome"
  - "Gizmo mode lifted from Viewport.tsx's local useState to a new gizmoModeStore.ts so StatusBar's mode segment can share the SAME source of truth GizmoModeRail/TransformGizmo already use, without threading it through props across the shell/panel boundary"
  - "The corner axis gizmo (drei GizmoHelper/GizmoViewport, item 7) is mounted alongside — not in place of — ViewportPanel.tsx's existing hand-rolled bottom-right SVG axis indicator (out of this plan's declared file scope); positioned with drei's default 64px margin so the two do not pixel-overlap"

patterns-established:
  - "liveDragTelemetry.ts's imperative pub/sub is the reusable pattern for any future HUD element needing 60fps drag data without React state churn"
  - "Shared precedence-logic modules (liveSyncGuardPrecedence.ts) for cross-surface HUD consistency — future guard-aware surfaces should extend this module rather than re-deriving the branch logic locally"

requirements-completed: [LIVE-03]

# Metrics
duration: ~37min
completed: 2026-07-15
---

# Phase 05 Plan 11: Live-Sync Client Card, Transform Readout Bar, StatusBar Mirror Summary

**Completes UI-SPEC Surface 1 — the top-right live-sync HUD card (cross-build target identity, two independent guard rows, all three B2 safety states with real addr/bytes), the bottom-center transform readout bar (imperative 60fps drag mirror, typed-entry write parity), the StatusBar mirror, and the corner-gizmo/vp-stats assembly in Viewport.tsx — plus closing a write-log-never-populates gap left by 05-10.**

## Performance

- **Duration:** ~37 min
- **Started:** 2026-07-15T19:01:55Z (STATE.md session, immediately following 05-10's completion)
- **Completed:** 2026-07-15T19:38:02Z
- **Tasks:** 3 (all type="auto")
- **Files modified:** 16 (7 modified, 9 created)

## Accomplishments
- `LiveSyncClientCard.tsx`: the full Surface 1 item-2 anatomy — cross-build `target` row (hasTarget/targetUnavailableOnBuild/none-fallback, build-agnostic), the ROUND 4 `⚠ viewing <loaded>, moving <target>` mismatch warning (normalized-basename compare against `viewportStore.loadStatus`), the ROUND 5 quiet `(name match only — not a verified object identity)` caveat for coincidental same-template matches, two independent read-verify guard rows (transform binary; scale's four-branch precedence — unavailable > blocked > not-written > ok, via the new shared `liveSyncGuardPrecedence.ts`), a session write log with a permanent ROUND 6 per-object-cache caption, `Revert ALL to snapshot` (always enabled while attached, regardless of guard state), and all three B2 banners — guard-blocked (`role="alert"`, real `liveStore.guardAddr` formatted via the exported `formatAddr`, expected bytes from `expectedTransform()`/`expectedScale()`, honest non-fabricated "last known" scale wording since no live-scale channel field exists) and reverted (`role="status"`, per-channel `lastDiscardedChange` disclosure honoring `gotVerified`).
- `TransformReadoutBar.tsx`: Pos/Rot/Scale numbox groups (52px right-aligned mono, sketch-locked axis-tag hexes) whose values update via **direct DOM ref writes** during an active drag — subscribed through a new `liveDragTelemetry.ts` imperative pub/sub that `TransformGizmo.tsx` now publishes into on every `onChange` tick — proven O(1) React renders across a simulated 60-tick drag (one `dragging` state flip, never one render per tick). Typed Enter-to-commit calls the identical `writeTransform` function a gizmo drag calls, gated per-channel the same way. The offline write-target indicator uses the exact D-05 copy (`Offline — attach a client to move objects live`), never `staged (patch)`; Scale numboxes are additionally disabled when `scaleUnavailableOnBuild`.
- `StatusBar.tsx`: new `mode:`/`sync:`/`COW snapshot`/`guard:` segments reading the SAME `liveStore` fields the client card reads — the guard chip reuses `isScaleGenuinelyBlocked` so a build-capability gap is never named as a tamper, matching the card's own precedence exactly. `mode:` sources a new `gizmoModeStore.ts` (lifted from Viewport.tsx's prior local `useState`).
- `Viewport.tsx`: mounts `LiveSyncClientCard`/`TransformReadoutBar` as `<Canvas>` siblings, adds a NEW bottom-left `vp-stats` overlay (`persp · <W>×<H> · <fps> fps · SAB <✓|—>`, distinct from and additional to `ViewportPanel.tsx`'s existing verts/tris/draws overlay, which is unmodified), and mounts a real drei `GizmoHelper`/`GizmoViewport` corner-orientation gizmo inside the Canvas using the sketch-locked axis hexes.
- Verified with a cross-component test that a single `useLiveStore` attach→detach transition flips the client card, readout bar, AND StatusBar sync segment simultaneously — one source of truth, not four independently-wired copies.

## Task Commits

Each task was committed atomically:

1. **Task 1: LiveSyncClientCard** - `bed3df4` (feat)
2. **Task 2: TransformReadoutBar + liveDragTelemetry + TransformGizmo wiring** - `2a864b2` (feat)
3. **Task 3: StatusBar mirror + Viewport final assembly** - `fb49ed3` (feat)

**Plan metadata:** (this commit, see final_commit below)

## Files Created/Modified
- `packages/renderer/src/panels/viewport/LiveSyncClientCard.tsx` - New: the 224px HUD card
- `packages/renderer/src/panels/viewport/LiveSyncClientCard.test.tsx` - New: 23 tests
- `packages/renderer/src/panels/viewport/TransformReadoutBar.tsx` - New: the readout bar
- `packages/renderer/src/panels/viewport/TransformReadoutBar.test.tsx` - New: 9 tests
- `packages/renderer/src/panels/viewport/liveDragTelemetry.ts` - New: imperative drag-tick pub/sub
- `packages/renderer/src/panels/viewport/liveSyncGuardPrecedence.ts` - New: shared guard-precedence helpers
- `packages/renderer/src/panels/viewport/Viewport.test.tsx` - New: 5 tests
- `packages/renderer/src/state/gizmoModeStore.ts` - New: shared gizmo-mode store
- `packages/renderer/src/state/liveStore.ts` - CowSnapshot.capturedAtMs, exported formatAddr, clientLabel, recordWrite/computeDeltaLabel
- `packages/renderer/src/state/liveStore.test.ts` - +9 tests for recordWrite/computeDeltaLabel/formatAddr
- `packages/renderer/src/panels/viewport/TransformGizmo.tsx` - publishDragTick + recordWrite wiring in trySendWrite
- `packages/renderer/src/panels/viewport/Viewport.tsx` - mounts new HUD surfaces, vp-stats, corner gizmo, gizmoModeStore
- `packages/renderer/src/shell/StatusBar.tsx` - mode/sync/COW/guard segments
- `packages/renderer/src/shell/StatusBar.test.tsx` - +6 tests
- `.planning/phases/05-wysiwyg-live-sync-typed-editors/05-UI-SPEC.md` - Errata item 5 (ROUND 2 scaleUnavailableOnBuild precedence)
- `.planning/phases/05-wysiwyg-live-sync-typed-editors/deferred-items.md` - New: logs an unrelated flaky pre-existing test

## Decisions Made
See `key-decisions` in the frontmatter above (write-log coalescing, delta-label precedence, honest scale-read wording, reverted-banner local-state tracking, unconditional drag-tick publishing, gizmo-mode store lift, corner-gizmo coexistence with the existing SVG indicator).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] liveStore.recordWrite + TransformGizmo wiring — the write log could never populate from a real drag**
- **Found during:** Task 1, while implementing the client card's write-log rendering.
- **Issue:** `liveStore.appendWriteLog` had zero non-test call sites before this plan — 05-10's `TransformGizmo.tsx` calls `writeTransform` (from `useCommandWriter.ts`) directly, bypassing `liveStore` entirely. The client card's "every live write appends a row" contract, and 05-12's own UAT step 2 ("a new row appears in the client card's write log" after a drag), could never be satisfied without this wiring.
- **Fix:** Added `liveStore.recordWrite(transform, scale)` (computes a delta label via a new `computeDeltaLabel`, coalesces rapid in-drag ticks into the current row) and called it from `TransformGizmo.tsx`'s `trySendWrite` immediately after a successful `writeTransform`.
- **Files modified:** packages/renderer/src/state/liveStore.ts, packages/renderer/src/panels/viewport/TransformGizmo.tsx
- **Verification:** New liveStore tests (coalescing, distinct-row-after-window, delta-label precedence) + full renderer suite green; `TransformGizmo.test.tsx`'s existing 15 tests unaffected.
- **Committed in:** `bed3df4` (liveStore half), `2a864b2` (TransformGizmo wiring half)

**2. [Rule 2 - Missing Critical] CowSnapshot.capturedAtMs — no timestamp source for the "saved · HH:MM:SS" / reverted-banner copy**
- **Found during:** Task 1, implementing the COW snapshot row and reverted banner's "(<HH:MM:SS>)" clause.
- **Issue:** `liveStore.CowSnapshot` had no timestamp field; the UI-SPEC's copy contract requires an attach-time HH:MM:SS the store never captured.
- **Fix:** Added `capturedAtMs: number`, populated in `freshSlot` (which already receives `nowMs`).
- **Files modified:** packages/renderer/src/state/liveStore.ts
- **Verification:** `liveStore.test.ts`'s existing snapshot-shape assertions unaffected (they check `.transform` only); new card tests assert the formatted HH:MM:SS renders.
- **Committed in:** `bed3df4`

**3. [Rule 2 - Missing Critical] liveStore.clientLabel — the client card's `client` row had no data source**
- **Found during:** Task 1.
- **Issue:** `LiveInspectorPanel.tsx` already tracks the attach-target string as local component state (`clientExe`) but never threaded it through `liveStore`, so no other HUD surface could read it.
- **Fix:** Added `clientLabel: string | null`, set from `beginAttach`'s existing `clientExe` parameter (previously unused — `_clientExe`), cleared on `detach`.
- **Files modified:** packages/renderer/src/state/liveStore.ts
- **Verification:** Full renderer suite green; no existing call site's behavior changed (the parameter was already being passed, just not stored).
- **Committed in:** `bed3df4`

**4. [Rule 3 - Blocking] Exported `formatAddr` from liveStore.ts**
- **Found during:** Task 1 — the guard-blocked banner needed to format `liveStore.guardAddr` with the SAME helper `lastDiscardedChange.addr` is already produced by (ROUND 5, REVIEWS.md round-4 maintainer decision #4), but `formatAddr` was a private, unexported function.
- **Fix:** Added `export` to the existing function; no logic change.
- **Files modified:** packages/renderer/src/state/liveStore.ts
- **Verification:** liveStore.test.ts's existing `lastDiscardedChange.addr` assertions unaffected; new tests import and assert `formatAddr` directly.
- **Committed in:** `bed3df4`

---

**Total deviations:** 4 auto-fixed (all Rule 2/3 — missing critical functionality or a blocking export needed for this plan's own acceptance criteria to be satisfiable). No scope creep beyond what was needed for the client card and readout bar to function against real drag data; all extend files this plan's own action text already reads from (`liveStore.ts`) or explicitly names as an integration point (`TransformGizmo.tsx`, referenced throughout Task 1/2's `read_first` and `done` criteria).

## Issues Encountered

`test/gitLfs.test.ts` (Phase 04.1, untouched by this plan) failed intermittently once during verification with a `git-lfs not found` environment error, then passed on an identical immediate re-run with zero code changes in between — confirmed as pre-existing test flakiness unrelated to this plan (logged in `deferred-items.md`, not fixed).

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- LIVE-03's full HUD anatomy is complete and automated-tested (65 test files / 550 tests green, `tsc --noEmit` clean across the renderer package).
- 05-12 (GC-pressure soak test + maintainer in-world UAT) can now exercise a REAL populated write log during a live drag (this plan's Rule 2 fix), the real guard-blocked/reverted banners with genuine addresses/bytes, and the full cross-build target-identity + mismatch-warning + name-match-caveat surface.
- Known, explicitly out-of-scope-per-plan limitation: the corner axis gizmo (drei `GizmoHelper`/`GizmoViewport`) is mounted alongside — not replacing — `ViewportPanel.tsx`'s existing hand-rolled SVG axis indicator (that file is outside this plan's declared scope); worth a manual glance during 05-12's UAT to confirm the two don't visually clash on a real GPU (no WebGL in vitest to check this automatically).
- The "Re-read & retry" guard-blocked-banner action is an intentional no-op (the RAF poll loop already re-reads the channel continuously every tick while attached — there is no separate "manual read" primitive to call); this is documented in the component's own code comment, not a stub needing follow-up.

---
*Phase: 05-wysiwyg-live-sync-typed-editors*
*Completed: 2026-07-15*

## Self-Check: PASSED

All created files verified present on disk; all three task commit hashes (bed3df4, 2a864b2, fb49ed3) verified present in git log.
