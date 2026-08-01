# CONSULT-71 — Codex — Phase 05.1 replan verification: cross-process wiring trace

## Facts (treat as given — do NOT re-derive)

1. Repo: `D:\Code\SWG-Toolkit`. Phase plan dir: `.planning/phases/05.1-live-world-editor-productization/` (15 plans, `05.1-01-PLAN.md` … `05.1-15-PLAN.md`).
2. These plans were revised in git commit `f9711c4` in response to a prior cross-AI review (`05.1-REVIEWS.md` in the same dir). The prior plan text is at commit `c4e0843`. You may run `git diff c4e0843..f9711c4 -- .planning/phases/05.1-live-world-editor-productization` to see exactly what changed.
3. Real source files exist in this repo under `packages/live-inject/` (agent C++ + N-API host binding), `packages/renderer/src/` (React renderer), `packages/contracts/` (shared TS contracts). These are ground truth, not the plans.

## Your task (your angle only: call-graph / wiring trace)

The revised plans claim to wire a shared-memory channel contract end-to-end across three processes (game-agent DLL → N-API host addon → Electron renderer). Trace the **plan-declared wiring** and verify it against the **real current source**:

1. **Channel size ownership.** Find every place in real source where the channel/LiveState byte size is hard-coded or asserted (search `packages/live-inject` for `1308`, `static_assert`, `CHANNEL_BYTE_SIZE`). List each site with file:line. Then check: does some plan's `files_modified` + task text own updating EVERY one of those sites? Name the plan and task for each site, or flag the orphan.
2. **New-field encode/decode symmetry.** The plans add capture fields (an ADD `kind` and `cellName`) and a new host-command region. Trace: which plan writes each new byte region on the C++ side, which plan reads it on the TS side, and do the declared offsets match between the writing plan and the reading plan? Flag any region with a writer but no reader, a reader but no writer, or mismatched offsets.
3. **Build-order soundness.** Using each plan's `wave` and `depends_on` frontmatter: if the plans execute in wave order, is there any point where a build (contracts TS build, agent cmake build, host addon build) is left broken at a wave boundary? Flag any plan whose verify step would fail due to a file another (later) plan owns.

## Output format

Markdown. Sections: `## Summary` (one paragraph), `## Findings` (bullet list, each with severity HIGH/MEDIUM/LOW and file:line or plan/task evidence), `## Verdict` — one of `CONVERGED` (wiring sound as planned) or `CONCERNS` (list what must change). Do not review UX, naming, or style — wiring only.
