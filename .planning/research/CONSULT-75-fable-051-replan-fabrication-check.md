# CONSULT-75 — fresh Fable — Phase 05.1 replan verification: new-claim fact-check & execution risk

## Facts (treat as given — do NOT re-derive)

1. Repo: `D:\Code\SWG-Toolkit`. Phase plan dir: `.planning/phases/05.1-live-world-editor-productization/` (15 plans).
2. Plans were revised in git commit `f9711c4`. The pre-revision text is commit `c4e0843`. The delta is: `git diff c4e0843..f9711c4 -- .planning/phases/05.1-live-world-editor-productization`.
3. This project has a documented failure mode: **replans can inject fabrications** — a revision pass can introduce NEW plausible-but-false claims about file contents, line numbers, tool behavior, or environment state that were not in the original plans and were never reviewed.

## Your task (your angle only: adversarial fact-check of NEW claims + execution risk)

Work from the diff, not the full plans. Your subject is exclusively what the revision **added or changed**:

1. Extract every NEW factual claim the diff introduces — file paths, file:line citations, symbol names, claimed current behavior ("X is synchronous", "Y currently returns Z", "the client install at PATH has real archives"), claimed tool/build behavior, claimed test names, claimed dockview/library APIs. For each, verify it against the real repo (and real filesystem paths where claimed) with Read/Grep/ls. Classify: VERIFIED / WRONG / UNVERIFIABLE. Every WRONG is at least HIGH.
2. Execution-risk pass on the delta: for each revised plan, would a fresh executor agent following ONLY the revised plan text hit a wall the plan doesn't anticipate? Look specifically for: acceptance criteria that reference things no task creates, verify commands that can't run on this machine (Windows, PowerShell 5.1 host, WSL for Core3), tasks whose `read_first` omits a file the action clearly requires, and checkpoint tasks whose pass condition is not actually observable.
3. Sanity-check the revision's internal bookkeeping: the diff claims to close review items C1–C13 from `05.1-REVIEWS.md`. Spot-check 3–4 of the closures YOU judge most fragile (your choice) and confirm the plan text actually implements the closure rather than merely mentioning it.

Do not re-litigate design decisions that CONTEXT.md locks; your job is truth of claims and executability, not taste.

## Output format

Markdown. Sections: `## Summary`, `## New-claim verification table` (claim → location → VERIFIED/WRONG/UNVERIFIABLE → evidence), `## Execution-risk findings` (severity HIGH/MEDIUM/LOW), `## Verdict` — `CONVERGED` or `CONCERNS` (list).
