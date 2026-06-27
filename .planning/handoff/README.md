# Handoff index

Active handoffs (newest first). One file per workstream; read the active one before resuming.

- **[2026-06-27-phase4-code-complete-uat-pending.md](2026-06-27-phase4-code-complete-uat-pending.md)** — ACTIVE.
  Phase 4 (Edit & Deploy Loop) **code-complete** — all 8 plans built/merged/integrated on `main`
  (`…→2c9137e`), gates green (renderer 28/28, native 6/6). **Next = maintainer runs the 2 in-client UATs**
  (patch-prepend deploy + shadow-base) → then mark `04-06`/`04-06b` complete, run verifier, close out.
  Carries the version-graph model, cfg ground-truth, UI layout, build/run gotchas, and the full review
  journey (plan-checker + 2 crew rounds — all findings closed). **Not pushed.** Supersedes the Phase-3
  handoff for the active workstream.

- **[2026-06-26-phase3-live-connect-DONE-replan-ready.md](2026-06-26-phase3-live-connect-DONE-replan-ready.md)** — superseded (Phase 3 DONE; its "replan" pointer was overtaken — we built Phase 4 instead).
  Phase 3 (live-connection foundation) **VERIFIED & closed out** — proven live on both client builds;
  4 defects fixed + app wiring + close-out, all pushed (`…→4df1912`). Next workstream = **replan the
  remaining milestone phases** (2, 4, 5, 6, 7, 8) and fold in the parked live-world-terrain decision.
  Carries Phase-5 inputs, the reusable Path-B native-wiring pattern, and build/run gotchas.

- **[2026-06-25-phase2-skinned-anim-and-material-DONE.md](2026-06-25-phase2-skinned-anim-and-material-DONE.md)** — ACTIVE.
  Phase 2 ~90%. 02-04 (animation) DONE & working (skinned `.sat` render + multi-part + multi-skeleton +
  playback) plus a full material-fidelity pass (MATL spec, CSHD, normal-map RGBA8/magenta fix, shadow
  floor). All committed + pushed (`…→5b15cc6`). Next workstream = **02-05 export** (not started).
  Full state, key facts, build/run gotchas, backlog.

- [2026-06-25-phase2-skinned-animation-blocker.md](2026-06-25-phase2-skinned-animation-blocker.md) — RESOLVED.
  The original skinned-`.sat` UI lockup blocker. Superseded by the DONE handoff above (the lockup and
  every follow-on bug were fixed this session). Kept for history.
