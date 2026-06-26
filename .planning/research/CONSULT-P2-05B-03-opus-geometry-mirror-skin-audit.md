# Angle 3 (geometry/math) — could the export GEOMETRY/skin be corrupting the face?

FIRST read `.planning/research/CONSULT-P2-05B-AXIOMS.md` (LOCKED ground truth L1–L5).

You are the geometry/math auditor. The BODY reads mostly OK but the FACE is scrambled. Rule in/out a
GEOMETRY or SKINNING corruption in the export path (read mirrorScene.ts, buildExportScene.ts, and the live
SkinnedMeshView buildSkeleton/bind). Be rigorous:

1. **applyXMirror correctness on indexed triangles.** The mirror does pos.x→-x, normal.x→-nx, tangent
   (tx,ty,tz,w)→(-tx,ty,tz,-w), and REVERSES winding by swapping triangle indices. Verify: (a) the winding
   swap is applied to the INDEX buffer consistently (every tri, exactly once), (b) it stays consistent with
   per-vertex normals/UVs (UVs untouched — correct?), (c) nothing double-applies. Could a partial/incorrect
   winding or normal flip scramble shading on a dense region (face) while looking OK on flatter body panels?

2. **Bind-pose skeleton + identity bind matrix.** buildExportScene rebuilds the skeleton in bind pose
   (rest = postMul·bindPoseRot·preMul), calls calculateInverses(), then SkinnedMesh.bind(skeleton,
   IDENTITY). The LIVE mesh was bound differently (in SkinnedMeshView). Could re-binding the cloned geometry
   to a freshly-reconstructed bind-pose skeleton with an IDENTITY bind matrix MIS-SKIN the head — e.g. if the
   head verts' skinIndex/Weight reference bones whose reconstructed rest transform differs from the live bind,
   collapsing/distorting the face? Is the exported skeleton's bind pose provably identical to the live one?

3. **Shared vs cloned geometry.** In the live scene, do multiple shader-group SkinnedMeshes share ONE
   BufferGeometry (per-part) with draw ranges, or does each have its own? If shared, does buildExportScene's
   per-SkinnedMesh geometry.clone() + mirror double-mirror or mis-range the face submesh? Trace SkinnedMeshView's
   SkinnedGroup geometry usage.

Output: for each of the 3, a verdict (geometry is/ is-not corrupted) with the reasoning, and if corrupted, the
exact defect + fix. If geometry is provably fine, say so clearly so we focus on the material (emissive) path.
