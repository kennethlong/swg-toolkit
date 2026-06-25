# Codex task — normal/lighting data-flow trace (SWG-Toolkit)

Read LOCKED axioms first: `.planning/research/CONSULT-SEAM-AXIOMS.md`. Don't contradict them.
Repo: `D:\Code\SWG-Toolkit`.

## Angle: trace exactly what space each lighting quantity lives in, and whether the normal tracks the skin.

1. In `packages/renderer/src/panels/viewport/material/swgMaterial.ts`, for the SKINNED path, determine
   precisely: (a) is the fragment normal `vNormal` derived from the SKINNED geometry or the bind-pose
   `normal` attribute? (b) what coordinate space is `vNormal` in (given `normalMatrix` = inv-transpose of
   modelViewMatrix)? (c) what space are `lightDir`, `vViewDir`, `vWorldPos`, `H` in? List any space
   mismatch between N and L/V used in `NdotL` and `dot(N,H)`.
2. Confirm whether `<skinnormal_vertex>` (or any normal-skinning) is included. Cite the include list.
3. In `SkinnedMeshView.tsx` `buildSkinnedGroupGeometry`, confirm each part sets its own `normal`
   BufferAttribute (not shared across parts) and whether `computeVertexNormals()` is ever used. Note the
   `frustumCulled` / `side` / material settings that affect seam appearance.
4. Identify every place a value feeding the lit/spec result could spike specifically when a joint rotates
   a lot (arms up) — i.e. what changes between rest and animated that would brighten boundary faces.

## Deliverable
A precise table: quantity → space → skinned? (yes/no) → consistent with N? Then a ranked list of the
data-flow defects (e.g. "normal not skinned", "N in view space, L/V in world space") with the exact
file:line, and which one(s) would manifest specifically AT high-deformation seams DURING animation. No
code — just the trace + ranking.
