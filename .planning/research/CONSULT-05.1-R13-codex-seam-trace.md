# CONSULT — Phase 05.1 plan review, Round 13 — Codex angle: seam-propagation trace (confirmation)

You are one of five independent reviewers of a set of implementation plans. Work only from the
files on disk. Report facts with file:line evidence. Do not soften findings.

## LOCKED axioms (measured/proven ground truth — do NOT contradict or re-derive)

1. `channel_binding.cpp` `OpenChannel` (`:113-170`) zero-fills at `:153-154`; the epoch-survives-
   restart premise is FALSIFIED. `DeleteUndoToast.tsx` is 218 lines; `useChannelReader.ts:172` decode / `:173` blank.
2. zustand 5.0.14 subscribe is synchronous; **reset-before-render is PROVEN closed** (round 10).
   The **ack state × event table is CERTIFIED TOTAL** (round 10). EE1 `isPlacementPending` is a
   **total function** and EE2 makes the precedence model **TOTAL over store-writing exits** (round 12,
   Opus). Do NOT re-open any of these — assess only whether the round-12 GG1–GG4 prose sweep is
   consistent, and whether it disturbed anything.

## Context (treat as given)

- Plans: `05.1-01-PLAN.md` … `05.1-15-PLAN.md` + `05.1-VALIDATION.md`.
- Round 12 work-list: `05.1-REVIEWS-round12.md` (GG1–GG4) — the entire residue was Plan 08's
  canonical-spec PROSE lagging Plan 14's already-correct implementation. Commit `44018e0` swept it,
  editing ONLY `05.1-08-PLAN.md` (GG1: mirror-clear folded into exit rows 5/6/7/9/10-both-branches/11/12,
  self-loops 8/13 kept true; GG2: durable-surface paragraph qualified row 10 to the match branch;
  GG3: row-9 timeout "+ timer (already fired)") and `05.1-04-PLAN.md` (GG4: EE4 citation openers).
  A checker PASS confirmed mechanism byte-identical to `f404d1e`.

## Your angle (do NOT do the other reviewers' angles: citation byte-verification, lateral new-seam hunting, locked-decision/spec math, or commit-diff fact-checking)

**Seam-propagation trace (confirmation).** The round-12 finding (GG1) was ITSELF a half-propagation
(a per-exit rule stated in row 13 but not the per-rows). Confirm the sweep closed it UNIFORMLY and
introduced no new inconsistency:

1. **`setPlacementPending(false)` / UI-mirror clear:** is it now stated at EVERY exit-row action in
   Plan 08's table (5/6/7/9/10-both-branches/11/12) AND absent from the two self-loop rows (8/13-as-loop)
   AND consistent with row 13's summary AND with Plan 14's per-exit implementation? Any exit row still
   missing it? Any site now DOUBLE-stating or contradicting?
2. **The row-10 `recordPersistResult` branch (GG2):** does every site that mentions row 10 recording
   a durable entry now carry the match-branch qualification (Plan 08 cell, durable-surface paragraph,
   precedence prose, Plan 14, VALIDATION 14-T3)? Any residual unconditional "rows 6/9/10 each record"?
3. **Uniformity of the six exit bodies (GG3):** do all six now read uniformly (slot + timer + mirror)?
4. **Did the sweep disturb any OTHER contract restatement** — the ack timeout constant, canonical
   strings, ledger items, EE2 guard wording — at any of the 15 plans + VALIDATION? Grep-confirm nothing
   adjacent regressed.

## Output format

Verdict line first: `CONVERGED` or `NOT CONVERGED`.
Then a findings table: ID | severity (HIGH/MED/LOW) | file:line | claim | evidence (quote the residual wording).
If a contract propagated fully, say so explicitly with the list of sites you checked.
