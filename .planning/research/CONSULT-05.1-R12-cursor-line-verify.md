# CONSULT — Phase 05.1 plan review, Round 12 — Cursor angle: line-level citation & wiring verification

You are one of five independent reviewers of a set of implementation plans. Work only from the
files on disk. Report facts with file:line evidence. Do not soften findings.

## LOCKED axioms (measured ground truth — do NOT contradict or re-derive)

1. `DeleteUndoToast.tsx` is exactly 218 lines. `useChannelReader.ts:172` is the `templateName`
   decode line; `:173` is blank (a prior reviewer off-by-one on this was refuted against the real file).
2. `channel_binding.cpp` `OpenChannel` (`:113-170`) zero-fills at `:153-154`. zustand is `5.0.14`.

## Context (treat as given)

- Plans under review: `05.1-01-PLAN.md` … `05.1-15-PLAN.md` + `05.1-VALIDATION.md`.
- Commit `f404d1e` (round-11 completeness sweep) edited plans 04, 08, 14, 15 + VALIDATION.md,
  resolving round-11 items EE1–EE6. Key code-shape claims to verify: (EE1) `setPlacementPending(false)`
  on every ack-table exit transition + trigger-re-enable test assertions; (EE2) the detach effect now
  re-checks `slot.studioDir === useWorkspaceStore.getState().studioDir`; (EE3) canonical string 2
  carried in full; (EE4) the test-isolation recipe now cites only real studioDir-seeding suites.
- Real sources: `packages/renderer/src/**`, `packages/live-inject/src/**`, `packages/renderer/package.json`.

## Your angle (do NOT do the other reviewers' angles: cross-plan seam tracing, lateral new-seam hunting, locked-decision/spec math, or commit-diff fact-checking)

**Line-level citation & wiring verification.** For every file:line citation and code-shape claim in
the FOUR edited plans (04, 08, 14, 15) + VALIDATION.md, open the cited real source and verify:

1. **EE4 test-file swap — verify each cited replacement against the real file.** The recipe should
   cite suites whose `beforeEach`/per-test actually calls `useWorkspaceStore.setState({ studioDir })`.
   Open each cited file and confirm: `DeployDialog.test.tsx` (~:142/:160/:175), `changesetService.test.ts`
   (~:42/:47), `StagingPanelBody.test.tsx` (~:111). Independently confirm `ProjectBindingBar.test.tsx`
   `beforeEach` (~:91-98) does NOT seed `studioDir` (so its removal was correct).
2. **EE2 wiring:** Plan 14's detach effect studioDir re-check — same identifier/shape as the ack
   effect's (row 7) guard? Plan 08 row 10 / precedence text consistent with Plan 14's implementation?
3. **EE1 wiring:** `setPlacementPending` / `isPlacementPending` — one owning declaration, cleared in
   each exit path with consistent identifier; the re-enable test assertions reference real state.
4. **EE3 canonical string 2:** character-identical between Plan 08's canonical list and Plans 14/15's
   quotes (modulo markdown wrapping)?
5. **Any other citation into `packages/**` that round 11 added or moved**, plus frontmatter mechanical
   integrity (YAML parses, key_links regexes valid, files_modified matches tasks, depends_on targets exist)
   for the 4 edited plans.

## Output format

Verdict line first: `CONVERGED` or `NOT CONVERGED`.
Then a findings table: ID | severity (HIGH/MED/LOW) | plan file:line | citation/claim | what the real source shows (quote) | MATCH/MISMATCH.
List every citation checked, including passes.
