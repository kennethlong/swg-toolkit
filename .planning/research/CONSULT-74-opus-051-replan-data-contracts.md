# CONSULT-74 — fresh Opus — Phase 05.1 replan verification: cross-plan data-contract consistency

## Facts (treat as given — do NOT re-derive)

1. Repo: `D:\Code\SWG-Toolkit`. Phase plan dir: `.planning/phases/05.1-live-world-editor-productization/` (15 plans).
2. Plans were revised in git commit `f9711c4` after a prior cross-AI review (`05.1-REVIEWS.md`). Delta: `git diff c4e0843..f9711c4 -- .planning/phases/05.1-live-world-editor-productization`.
3. Real current source is ground truth: `packages/renderer/src/services/` (decorationChannel.ts, decorationPersistOrchestrator.ts, decorationPersist.ts), `packages/renderer/src/hooks/useChannelReader.ts`, `packages/renderer/src/state/` stores, `packages/contracts/src/live-inject.ts`.

## Your task (your angle only: interface/type contracts BETWEEN plans)

Different plans (executed by different agents, possibly in parallel waves) each declare pieces of shared interfaces. Verify the pieces actually compose — name-for-name, type-for-type, value-for-value:

1. Enumerate every cross-plan interface the revised plans declare: function signatures, TS interface fields, store actions, return-value shapes, enum/kind values, and ctx objects that one plan produces and another consumes. For each, put the producing plan's declaration next to every consuming plan's usage and check exact agreement (field names, optionality, types, kind string values, return shapes).
2. Pay attention to values threaded across persist flows: a mirror-mode boolean resolved once and reused (which plan resolves, which stashes, which consumes — do the declared shapes line up?), a `studioDir` threaded into a persist ctx (does the declared ctx type in the consuming plan match the producing call site's shape?), and an arm-failure capture kind published by the C++ side and consumed by the store (are the kind discriminator values identical strings across plans?).
3. For each interface where a plan claims "extends existing X", read the real current source of X and check the extension is coherent with what's actually there today (existing field names, existing function signature, existing store shape).
4. Flag HIGH any case where two plans could both complete "successfully" per their own acceptance criteria yet the composed system fails to typecheck or misbehaves at runtime.

## Output format

Markdown. Sections: `## Summary`, `## Contract table` (interface → producer plan → consumer plan(s) → agree? Y/N), `## Findings` (severity HIGH/MEDIUM/LOW with evidence), `## Verdict` — `CONVERGED` or `CONCERNS` (list). Data contracts only — do not review UX or byte offsets.
