# CONSULT — Phase 05.1 plan review, Round 9 — angle: lateral new-seam hunt

You are one of five independent reviewers of a set of implementation plans. Work only from the
files on disk. Report facts with file:line evidence. Do not soften findings.

## Context (treat as given)

- Plans under review: `.planning/phases/05.1-live-world-editor-productization/05.1-01-PLAN.md` … `05.1-15-PLAN.md` (15 files) plus `05.1-VALIDATION.md`.
- Round 8 review work-list: `.planning/phases/05.1-live-world-editor-productization/05.1-REVIEWS-round8.md` (items AA1–AA17). Commit `2445b88` claims to resolve all of them; it edited plans 04, 08, 10, 13, 14, 15 and `05.1-RESEARCH.md`.
- History you must assume: in BOTH round 7 and round 8, the fixes themselves spawned new HIGH defects that no reviewer angle was pointed at (round 8: the checker-round fixes to Plan 13 created 2 new HIGH seams). The named AA-items are being checked by other reviewers — your job is everything they are NOT looking at.
- Real renderer source lives under `packages/renderer/src/` (notably `state/workspaceStore.ts`, `hooks/useChannelReader.ts`, `panels/deploy/DeleteUndoToast.tsx`).

## Your angle (do NOT do the other reviewers' angles: AA-item seam tracing, citation byte-verification, locked-decision/spec math, or commit-diff fact-checking)

**Lateral new-seam hunt.** Find genuinely NEW defects — problems no round-8 item named and that the
round-9 edits either introduced or newly exposed. Hunting grounds (non-exhaustive; go where the
evidence leads):

1. Interactions between the NEW mechanisms added this round and OLD mechanisms that predate it: the project-switch `reset()` + `key={studioDir}` remount vs any effect/subscription in Plans 05–12 that assumes state survives a project switch; the epoch-correlated ack toast vs timeouts, channel staleness, client exit, or zoning (the live channel freezes during load/login/zoning per project ground rules).
2. Untouched plans (01, 02, 03, 05, 06, 07, 09, 11, 12) — do any of them interact with the six edited plans through a contract that the edits changed semantics of without renaming (so keyword greps would miss it)?
3. Lifecycle/ordering holes: mount-time store derivation (AA2 fix) racing the very store resets (AA5 fix) that a project switch triggers; two mechanisms both claiming to run "on studioDir change" with an unspecified relative order.
4. Test-reachability: any acceptance_criteria or test added this round that cannot actually execute as written (jsdom vs real Electron, store seeded via setState vs production wire, etc.).
5. Anything else your read of the plans + real source surfaces that no AA-item covers.

Do NOT re-report the AA-items themselves or their direct fix quality — other reviewers own that.

## Output format

Verdict line first: `CONVERGED` or `NOT CONVERGED`.
Then a findings table: ID | severity (HIGH/MED/LOW) | file:line | the new seam/defect | evidence (quote the plan text and, where relevant, the real source).
State explicitly which hunting grounds you swept and found clean.
