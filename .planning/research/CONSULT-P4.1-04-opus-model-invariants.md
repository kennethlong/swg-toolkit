# CONSULT P4.1-04 — fresh Opus (spec/model reasoning): version-graph & dependency-graph invariants

Review an EXECUTION PLAN before it is built. Your angle: does introducing the Baseline node +
combined tab preserve the Phase-4 version-graph invariants, and is the wave/dependency graph sound?
Reason at the model level. Do NOT re-verify byte ground-truth (locked) or trace every symbol.

## Treat as GIVEN (LOCKED)
- Phase-4 changeset model (DO NOT regress): version GRAPH not flat list; `flatten(versionId)` walks root→N via parentId, last-writer-wins, delete→tombstone, code-point sort, cycle guard. `sealVersion` stores DIFF-VS-PARENT deltas. Deploy builds from `flatten(activeVersionId)`, NEVER live staging (so "select old version → Deploy" must not hang). Dirty = staging ≠ flatten(activeVersionId); auto-seal only when dirty.
- This phase ADDS: a Baseline root node (zero deltas, parentId null) seeded at project creation; `BASELINE_ID` exported from @swg/contracts.

## Read
- Plans: .planning/phases/04.1-deploy-project-ux/04.1-06-PLAN.md (Baseline seed), 04.1-03-PLAN.md (VersionHistoryBody renders graph + BASELINE_ID), 04.1-01-PLAN.md (contracts), + skim 01..11 frontmatter for the wave/depends_on graph.
- Grounding: 04.1-CONTEXT.md (D-08, D-14), 04.1-RESEARCH.md, the Phase-4 changesetService.ts.

## Your angle (ONLY this)
1. **Baseline invariants:** Does seeding a Baseline root (0 deltas) interact correctly with flatten/seal/select? Is `flatten(BASELINE_ID)` the empty override set (= "reset to stock")? Does the FIRST real changeset get parentId=BASELINE_ID (not null)? Any double-root or orphan risk for projects created BEFORE this change (migration)? Does `dirty` compute correctly when activeVersionId=BASELINE_ID?
2. **Deploy-from-flatten preserved:** In the new combined DeployPanel, is Deploy still driven by flatten(activeVersionId), with auto-seal-when-dirty, so "select older version → Deploy, no edits" deploys that version and does NOT strand at "building"? Confirm the combine didn't reintroduce the packs-live-staging bug.
3. **Dependency/wave soundness:** Given the frontmatter depends_on + wave numbers across 01..11, is the graph acyclic, does every depends_on producer land in an earlier wave, and are same-wave plans' files_modified disjoint? Flag any edge where a consumer could compile/run before its producer.
4. **BASELINE_ID sourcing:** plan 03 imports BASELINE_ID from @swg/contracts (created plan 01); plan 06 adds seedBaseline using it. Is there any wave where the constant is referenced before it exists?

Report each as HOLDS (with reasoning) or RISK (precise scenario + smallest fix). This is the math/spec pass — be adversarial about the graph edge cases.
