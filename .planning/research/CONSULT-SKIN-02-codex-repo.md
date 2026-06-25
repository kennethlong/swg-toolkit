# Codex task — repo trace: skin specular / LKUP / normal-map path (SWG-Toolkit)

Read LOCKED axioms first: `.planning/research/CONSULT-SKIN-AXIOMS.md`. Repo: `D:\Code\SWG-Toolkit`.

## Angle: trace exactly how our renderer handles (or drops) the skin shader's inputs, and where a fix goes.

1. In `packages/renderer/src/panels/viewport/SkinnedMeshView.tsx` `buildSkinnedGroupMaterial` and
   `material/swgMaterial.ts`: confirm the LKUP slot is dropped (not bound to any uniform). Trace the
   slot switch (MAIN/NRML/SPEC/EMIS/ENVM) and what happens to LKUP / SPEC. Does the face's SPEC-vs-LKUP
   distinction matter (face has LKUP+NRML, neck/hair have SPEC)? Cite file:line.
2. Trace the normal-map fragment path (bHasNormal): the derivative-TBN branch (dFdx/dFdy) vs the DOT3
   branch. For hasDot3=false skin, exactly how is the tangent-space normal decoded and combined with the
   world-space skinned N? Is there a renormalize? Could the derivative TBN be unstable/handedness-wrong?
3. Identify the minimal, lowest-risk place to add either (a) a specular-lookup sampler+ramp, or (b) a
   skin-spec softening, in swgMaterial.ts — what uniform/slot wiring is needed, and how to gate it so
   only a_specmap_bump-family shaders are affected (don't change the already-good shaders).
4. Confirm nothing else (env, emissive, tonemap) contributes to a face-specific over-bright.

## Deliverable
Precise file:line trace of LKUP-dropped + the normal-map path, then the minimal change set for a fix
(both the "implement LKUP" option and the "soften skin spec" option), with the gating that protects the
already-correct shaders. No code — the trace + options.
