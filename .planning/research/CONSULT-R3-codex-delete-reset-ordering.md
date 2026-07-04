# Consult task (Codex, round-3 spot-check): delete-flow reset ordering vs byte-complete trash

You are reviewing ONE structural change in a plan document against the real code. Read-only.

## Locked axioms (treat as given, do NOT re-derive or contradict)

1. Maintainer ruling D-04a: undo after project delete = restore project bytes from `.trash` only. NO automatic re-deploy. The client stays in its delete-restored state.
2. The delete flow contract: before removing a project, the bound client must first be restored to stock (cfg restored / patch deactivated for cfg models, loose overrides reverted for loose model), THEN the studio dir + umbrella folder are parked to a session-scoped `.trash` for undo.
3. The undo contract requires the `.trash` copy to be byte-for-byte complete.

## Evidence to read (real source, this repo)

- `packages/renderer/src/components/DeployDialog.tsx` — the `handleReset` handler (~lines 692–710) and anything it calls. This is the code the plan proposes to extract into a shared `deploymentReset.ts`.
- Any services it uses for cfg restore / patch deactivate / loose reset / artifact cleanup (follow the imports).
- The plan under review: `.planning/phases/04.4-ux-polish-deploy-hardening/04.4-01-PLAN.md` — specifically the shared `deploymentReset(cleanupArtifacts)` contract: delete flow calls it with `cleanupArtifacts: false`, parks `studioDir` to `.trash`, and DeployDialog keeps calling it with `cleanupArtifacts: true`.

## Your question (call-graph trace — answer from the code, not the plan's claims)

Trace the full set of filesystem writes/deletes that `handleReset` (and its callees) performs today. Then evaluate the plan's proposed split:

a) With `cleanupArtifacts: false`, is the resulting client state still byte-pristine (cfg restored, loose overrides reverted), or does skipping cleanup leave client-side residue the delete flow would then orphan?
b) Which specific paths does the skipped cleanup normally delete (e.g. `rec.patchPath`, others)? For each: after delete parks studioDir+umbrella into `.trash` and removes them, is that path (i) inside the parked tree (safe), (ii) inside the client (residue!), or (iii) elsewhere on disk (stranded artifact)?
c) Does the ordering "reset(cleanupArtifacts:false) → park to .trash → remove" have any window where a crash leaves an unrecoverable state?

Report: VERIFIED-SAFE / DEFECT (with file:line evidence) per item. Be specific; cite file:line.
