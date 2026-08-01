# CONSULT-73 — fresh Sonnet — Phase 05.1 replan verification: UX-contract & honest-disclosure audit

## Facts (treat as given — do NOT re-derive)

1. Repo: `D:\Code\SWG-Toolkit`. Phase plan dir: `.planning/phases/05.1-live-world-editor-productization/` (15 plans).
2. Plans were revised in git commit `f9711c4` after a prior cross-AI review (`05.1-REVIEWS.md`). Delta: `git diff c4e0843..f9711c4 -- .planning/phases/05.1-live-world-editor-productization`.
3. Per this project's AGENTS.md, UI sketches in `.planning/sketches/` are the **authoritative UI contract** (element-for-element), and `05.1-CONTEXT.md` in the phase dir holds locked user decisions (D-01…D-14).

## Your task (your angle only: UX contract completeness & honesty)

The revision deliberately downgraded or deferred several capabilities rather than building them. Audit whether the plan set is **honest end-to-end** about what ships:

1. Diff the governing sketches (find which sketch dirs the plans/CONTEXT cite — e.g., world panel, status strip, remove flow) against what the revised plans actually build. List every sketch element that is: built-functional / built-inert (visible but does nothing) / absent. For each inert or absent element, does some plan or the sign-off plan (05.1-15) explicitly disclose it, or is it silently dropped?
2. Check the internal consistency of the deliberate degrades: a "remove" live-despawn that never fires live, a narrower add-eligible-building scope, coarse words-only host-command logging, and any detail-card fields. For each: does any OTHER plan, UI string, toast, or acceptance criterion still promise the full behavior? Flag every contradiction (a user-visible string promising something a data path can't deliver is HIGH).
3. Check `05.1-CONTEXT.md` locked decisions against the revised plans: is any locked decision now satisfied only in a weakened form without an explicit discretion/deferral clause covering it?

Read the plans, CONTEXT.md, sketches, and (where a claim depends on current code) the real renderer source under `packages/renderer/src/`. Do not take any plan's self-description as true — verify against the sketch/source.

## Output format

Markdown. Sections: `## Summary`, `## Sketch element table` (element → built-functional/built-inert/absent → disclosed where), `## Findings` (severity HIGH/MEDIUM/LOW with evidence), `## Verdict` — `CONVERGED` or `CONCERNS` (list). UX contract only — do not review byte layouts or build wiring.
