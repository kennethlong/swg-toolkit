# Angle 2 (repo tracer) — independently CONFIRM/REFUTE axioms from real source

FIRST read `.planning/research/CONSULT-P2-05-AXIOMS.md` (LOCKED ground truth L1–L7).

You are the repo tracer. Do NOT reason from docs or the axioms — independently VERIFY them against
real code and report file:line evidence. You can read this repo AND siblings (`../swg-client-v2`,
`../swg-blender-plugin`, `../io_scene_swg_msh`, `../Core3`).

1. **L1 (SWG↔DCC = negate X).** Find the actual flip in `../swg-client-v2` (search MayaUtility /
   Maya exporter / coordinate code) and in `../swg-blender-plugin/swg_scene/coords.py`. Confirm the
   axis negated is X (not Y/Z), and the direction. Cite file:line. Is it ONLY X, or is there also an
   axis swap anywhere on the mesh import/export path?

2. **L2 (our loader is verbatim).** In `packages/native-core` + its core lib (`swg_core::formats::
   parseMesh`, the skeletal-mesh generator), confirm vertex positions/normals are copied/sliced
   VERBATIM with NO per-component negation or axis swap before reaching JS. If ANY transform is
   applied on our read path, report it (file:line). This is decisive for whether export must mirror.

3. **L5 (animation composition).** In `../swg-client-v2` `Skeleton.cpp` (~1273-1279) confirm the
   per-frame local rotation is exactly `postMul · (animRot · bindPoseRot · preMul)` and translation is
   additive `bindTranslation + delta`. Quote the real code. Flag any discrepancy with L5.

Output: for each of L1/L2/L5 — CONFIRMED or REFUTED, with the exact file:line and a one-line quote.
If refuted, give the correct statement. Convergence with the other consultants is only meaningful if
you reached it from the code independently.
