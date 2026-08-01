# CONSULT — Phase 05.1 plan review, Round 11 — Cursor angle: line-level citation & wiring verification

You are one of five independent reviewers of a set of implementation plans. Work only from the
files on disk. Report facts with file:line evidence. Do not soften findings.

## LOCKED axioms (measured ground truth — do NOT contradict or re-derive)

1. `packages/renderer/src/panels/deploy/DeleteUndoToast.tsx` is exactly 218 lines (trailing newline; a prior 219 claim was falsified).
2. `useChannelReader.ts:172` is the `templateName` TextDecoder decode line; `:173` is blank. A round-10 reviewer's off-by-one on this was refuted against the real file — the plans' text is correct.
3. `channel_binding.cpp` `OpenChannel` (`:113-170`) zero-fills at `:153-154`.

## Context (treat as given)

- Plans under review: `05.1-01-PLAN.md` … `05.1-15-PLAN.md` + `05.1-VALIDATION.md`.
- Commit `eafec8b` (round-10 replan) edited plans 04, 08, 10, 11, 12, 13, 14, 15 + VALIDATION.md, resolving round-10 items CC1–CC18. Headline: Plan 08's HOST_CMD ACK PROTOCOL is now a 13-row total state × event table; `PLACEMENT_ACK_TIMEOUT_MS = 11_000`; the pending slot carries `studioDir`; poll() was reordered to read-before-liveness (CC5).
- Real sources: `packages/renderer/src/**`, `packages/live-inject/src/**`, `packages/renderer/package.json`.

## Your angle (do NOT do the other reviewers' angles: cross-plan seam tracing, lateral new-seam hunting, locked-decision/spec math, or commit-diff fact-checking)

**Line-level citation & wiring verification.** For every file:line citation and code-shape claim in
the NINE edited files, open the cited real source and verify byte-accuracy:

1. **CC5's premise — the CURRENT poll-loop order.** Open `useChannelReader.ts` around `:237-290` and confirm the poll() body's CURRENT order is liveness-check-BEFORE-channel-read (so Plan 08 Task 2's "reorder to read-before-liveness" is a real, necessary change, not a no-op). Quote the actual current order.
2. **The ack wiring chain as now specified:** Plan 08 table ↔ Plan 04 store field/setter (`lastHostCommandResult`, `setLastHostCommandResult(epoch, code)`) ↔ Plan 14 Task 3 consumer (pending slot shape incl. the new `studioDir` field, ack effect, timeout callback, unmount cleanup) ↔ Plans 09/12 agent-side always-ack. Identifiers, argument order, types, the 11_000 constant, and the slot's field set must be character-consistent at every hop.
3. **The four canonical strings** (Plan 08's list) vs every quoted occurrence in Plans 14/15 — character-exact or MISMATCH.
4. **New citations this round:** anything Plan 04/13 cite for the HMR-dispose/test-isolation recipe (`import.meta.hot`, the named test-convention file — verify it exists and says what's claimed), the `package.json` `sideEffects` premise (CC15 P2), and any `flushSync` grep-gate claim (CC15 P1).
5. **Frontmatter mechanical integrity** for all 9 edited files: YAML parses, `key_links` regexes valid, `files_modified` matches task `<files>`, `depends_on` targets exist.

## Output format

Verdict line first: `CONVERGED` or `NOT CONVERGED`.
Then a findings table: ID | severity (HIGH/MED/LOW) | plan file:line | citation/claim | what the real source shows (quote) | MATCH/MISMATCH.
List every citation checked, including passes.
