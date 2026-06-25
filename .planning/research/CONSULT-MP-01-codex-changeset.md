# Codex task — exact change set for multi-part/multi-skeleton rendering (SWG-Toolkit)

Read LOCKED axioms first: `.planning/research/CONSULT-MP-AXIOMS.md`. Do not contradict them.
You can read both `D:\Code\SWG-Toolkit` and `D:\Code\swg-client-v2`.

## Angle: produce the precise, ordered change list to go from single-mesh to multi-part + merged skeleton.

Trace and cite file:line for every site that must change:
1. `appearanceResolver.ts` — the composed `.sat` branch (resolve skeletons, the per-meshPath loop, the
   `allMeshes.push(...)` flatten, the `resolveMeshMaterials` call). What's the minimal restructure to emit a
   per-part structure (each part: its LODs + its materials) AND a single merged skeleton?
2. `AppearanceResolutionResult` (its definition in appearanceResolver.ts) — what new field(s) to add (e.g.
   `parts`) without breaking the static/single-part consumers. List every reader of `resolution.meshes` /
   `resolution.materials` / `resolution.skeleton` (grep) so we know the blast radius.
3. `Viewport.tsx` SceneContent — how it currently picks `meshes[selectedLod]` and passes props; what changes
   to render all parts at `selectedLod`.
4. `SkinnedMeshView.tsx` — current props + the single-skeleton/`<primitive>`/sampler wiring; what the new
   props shape should be (array of parts) and which internal sites assume a single mesh.
5. `viewportStore.ts` — does anything need to change (parsedMesh/selectedLod/lodLevels)?
6. Tests — `contract-conformance.test.ts` and any resolver/integration tests that assert the old shape.

## Deliverable
An ordered change list (file:line → what changes), a grep-backed list of every `resolution.meshes` /
`.materials` / `.skeleton` consumer, and a callout of anything that will silently break (static `.apt`/`.lod`
path, single-part `.sat`, leaf `.mgn`) if `meshes`/`materials` semantics change. No code — just the precise plan.
