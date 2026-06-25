# LOCKED AXIOMS — multi-part / multi-skeleton skinned `.sat` (ackbar)

Measured ground truth from `../swg-client-v2` + real `ackbar.sat` bytes (2026-06-25).
**Treat as given. Do NOT re-derive or contradict.** Numbered for citation.

- **A1.** `ackbar.sat` (FORM SMAT 0003) has **3 mesh generators** and **2 skeletons**:
  - meshPaths: `appearance/mesh/{ackbar, ackbar_arms, ackbar_body}.lmg` — each a `.lmg` with **4 LODs**.
  - skeletonRefs: `all_b.skt @ ""` (main) and `mon_m_face.skt @ "head"` (attached at the `head` transform).
- **A2.** Skeleton attachment — `Skeleton.cpp:862-913` (`attachSkeletonSegment`): the attached segment's
  **root joint is parented to the named transform** ("head") located in an already-attached segment
  (case-insensitive name lookup). The attached segment's root is typically an **identity grouping joint**;
  there is **no extra attachment transform** beyond reparenting (comment lines 901-906). In
  `drawJointFramesNow` (1297-1304) a segment-root joint (localParentIndex<0) uses the parent transform's
  `jointToRoot` as its parentToRoot.
- **A3.** A mesh part binds to bones by **name**, looked up in the **combined transform-name map** across
  ALL attached segments (not a per-part skeleton index). Name matching is **case-insensitive**
  (`CrcLowerString`). So the face mesh's face-bone names resolve into the `mon_m_face` segment; the body/arms
  names resolve into `all_b`.
- **A4.** Per-joint local transform (already implemented & verified, for reference):
  `localRot = postMul·(animResolverRot·bindPoseRot·preMul)`, `localTrans = bindTranslation + animResolverTranslation`.
  Disk quats are (w,x,y,z) → THREE (x,y,z,w). SWG frame is left-handed; the toolkit imports as-is (no conversion).
- **A5.** Target: THREE.js r0.184. One `THREE.SkinnedMesh` per shader group; all groups across all parts
  share ONE `THREE.Skeleton`. `skinIndex` values index into that shared skeleton's bone array.

## Current SWG-Toolkit state (facts, not to defend)
- `appearanceResolver.ts` composed `.sat` branch: resolves only `skeletonRefs[0]`; **flattens** every part's
  LODs into one `meshes[]` array (`allMeshes.push(...lodResult.meshes)`); builds `materials[]` from part0 LOD0 only.
- `Viewport.tsx` SceneContent renders a SINGLE mesh `resolution.meshes[selectedLod]`.
- `SkinnedMeshView.tsx` takes ONE `parsedMesh` + `geometry` + `materials`, builds its own skeleton, mounts
  `skeleton.bones[0]` as a `<primitive>`, runs ONE sampler.
- Bone-name remap is now case-insensitive in BOTH the native `SkeletalMeshGen.cpp` and the sampler.
- RESULT (observed): only the head part renders (9 draw calls = its shader groups); arms + body are absent.

## FALSIFIED / BANNED framing
"Render `meshes[selectedLod]`" (one mesh) is wrong for multi-part. Do NOT assume one skeleton ref, one mesh,
or that each part has its own independent skeleton/Skeleton object. All parts share ONE merged skeleton.

## GOAL
Render ALL parts at the selected LOD, sharing one merged skeleton (main + attached face), with correct
per-part materials and correct name-based skin binding into the merged bone array.
