# Your angle: CALL-GRAPH TRACER (Codex) — round 4

Read `.planning/research/CONSULT-05.1-R4-PREAMBLE.md` first for the neutral evidence and ground truth.

You are the call-graph / seam tracer. Your ONLY job is to trace the fixed seam across ALL its consumers in
the real plan set and confirm no stale citation or cached-value reuse survives. Do NOT evaluate UI design,
locked-decision fidelity, or factual citations — other reviewers own those.

Trace, in `.planning/phases/05.1-live-world-editor-productization/`:

1. **`scanWorldEditorState` signature** — grep every mention across Plans 02, 04, 06, 08, 10, 13, 14. Confirm
   EVERY call site and EVERY `<interfaces>` citation is the two-arg form `scanWorldEditorState(overrideDir, buildingTemplates)`.
   Report any surviving one-arg `scanWorldEditorState(overrideDir)` — that was R1's exact defect class.

2. **`refreshTree()` / `refresh()` call sites** — Plan 10 defines the shared helper. Trace every caller
   (mount effect, manual/live-strip refresh, mirror toggle, Remove in 13, ADD's history-triggered effect in 14).
   Confirm each reads `worldEditorBuildingTemplates` fresh at call time and NONE reuses a value captured at mount.
   Report any site that still threads a mount-cached `meta`.

3. **R3 session-reconcile** — Plan 04's new `refresh()` reconcile of `sessionOverlay`/`selectedRowId`. Trace who
   calls it and confirm the reconcile actually runs on the Remove path (Plan 13) and ADD path (Plan 14), not just mount.

4. **`reconcileMirrorMode` (Plan 06)** — confirm its caller (Plan 10 mirror toggle) handles the new
   `{ failures }` return (R6): does the toggle actually gate persistence on `failures.length === 0` and surface failures?

5. **Dependency edges** — confirm the `wave`/`depends_on` frontmatter across all 15 plans has no cycle, no forward
   reference, and that R5 did NOT introduce a Plan 04 → Plan 01 edge (Plan 04 must stay wave 0, `depends_on: []`).

For each defect: plan, line/section, the stale/broken citation, and the one-line fix. If the seam is fully
propagated, say **CONVERGED on call-graph** and list the consumers you confirmed clean.
