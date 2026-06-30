# Cross-AI PLAN review — Phase 04.3 — angle: dependency wiring & parallel-wave soundness (Codex)

You are reviewing IMPLEMENTATION PLANS (not yet-written code) for Phase 04.3 of the SWG-Toolkit repo.
Do NOT take the plans' claims on faith — you are a repo tracer. VERIFY every claim against the real
source in this repo (and siblings `../swg-client-v2`). Read the files yourself.

## Your specific angle (stay in this lane — other reviewers cover bytes/UI/algorithm)
**Dependency ordering, wave parallelism, and code-wiring correctness.** Answer:

1. **Do the reused primitives the plans depend on actually exist with the assumed signatures?**
   The plans claim to orchestrate existing code rather than rebuild. Verify these exist and match:
   - `packages/renderer/src/services/changesetService.ts` → `flatten(versionId,…)`, `flatEqual`, `selectVersion`, `setDeployedVersion`
   - `packages/renderer/src/services/looseOverrideDeploy.ts` → `deployLoose`, `resetLoose`, `resolveOverrideDir`
   - `packages/renderer/src/services/cfgActivator.ts` → `activatePatch`, `deactivatePatch`, `restoreCfg`
   - `packages/renderer/src/services/tocReader.ts` → `readTocIndex`, `readTocTreeNames`, `resolve` (and the 24-byte parse that DISCARDS offset/len/comp — plan 11 adds `resolveFull`)
   - `packages/renderer/src/services/treAutoMount.ts` → `buildTreNodes`, `injectLooseDirOverlay`, the priority-DESC sort
   - `readVfsEntryBytes`, `getMountEntriesColumnar` (columnar bridge)
   - native `packages/native-core/.../tre/TreArchive.cpp::extractEntry`, `TreVersion.h::isEnumerateOnly`
   Flag any plan that assumes a function/shape that does not exist or differs.

2. **Wave/parallelism integrity.** The phase runs Wave 1 plans in parallel (04,05,06,07,08,09,10,11).
   - Cross-check each plan's `files_modified` frontmatter across SAME-WAVE plans: any two Wave-1 plans
     writing the SAME file = a parallel-edit conflict. List every overlap.
   - The interface-first decoupling claim: plan 02 freezes Pillar-A contracts (syncLiveToVersion/
     undoStore/laneLayout/LaneGutter as stubs) so 04/05/06 compile in parallel; plan 03 (just amended)
     freezes the native `extractAt` typing in `packages/native-core/index.d.ts` so plan 11 compiles/mocks
     while plan 10 implements the runtime. **Does this decoupling actually hold?** Trace whether plan 06
     can compile against plan-02 stubs without 04/05's real impl, and whether plan 11 can typecheck +
     unit-test (mocking the native call) against the plan-03 `index.d.ts` stub without plan 10's runtime.
     If there's a hidden compile/runtime dep that breaks the parallel wave, that's a HIGH concern.
   - `depends_on` correctness: is anything ordered wrong (a plan consuming another's output without
     depending on it, OR depending on something it doesn't need)?

3. **The D-16 gate (plan 12) + UAT (plan 13) sequencing:** does 12 actually depend on the Pillar-B
   plans (10,11) completing, and 13 on everything? Is the gate truly BEFORE the UAT?

## Files to read
- Plans: `.planning/phases/04.3-versioning-and-searchtoc-mount/04.3-02-PLAN.md` … `04.3-13-PLAN.md`
- Research (touch-point map): `.planning/phases/04.3-versioning-and-searchtoc-mount/04.3-RESEARCH.md`
- Context (locked decisions): `.planning/phases/04.3-versioning-and-searchtoc-mount/04.3-CONTEXT.md`
- The real source files listed in (1) above.

## Output format (markdown)
1. **Summary** — one paragraph.
2. **Strengths** — bullets.
3. **Concerns** — bullets, each tagged HIGH / MEDIUM / LOW, with the file:line or plan# evidence.
4. **Suggestions** — specific, actionable.
5. **Risk Assessment** — overall LOW / MEDIUM / HIGH with justification.
Cite file:line for every claim. If a plan's assumption is correct, say so explicitly (don't invent problems).
