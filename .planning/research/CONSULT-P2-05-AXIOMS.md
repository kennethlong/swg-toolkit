# Shared LOCKED ground truth — 02-05 export (do NOT contradict or re-derive)

Context: we are building a glTF (.glb) exporter for SWG skeletal meshes in a THREE.js (r0.184.0)
viewport. These facts are MEASURED from real source/asset bytes. Treat them as axioms.

L1. **SWG engine/disk geometry is X-NEGATED relative to conventional right-handed DCC space**
    (Maya/Blender/glTF). Source: maintainer plugin `swg_scene/coords.py`:
    `engine_to_blender_position(x,y,z) = (-x, y, z)`; `blender_to_engine_position = (-x, y, z)`;
    docstring: "MayaExporter flips X when writing (MayaUtility.cpp): engine_x = -maya_x."

L2. **Our native loader passes vertex positions/normals to JS VERBATIM** as zero-copy byte slices —
    NO axis negation in C++. (`packages/native-core/src/mesh_binding.cpp:193`
    `sliceToJs(env, grp.positions)`, from `swg_core::formats::parseMesh`.)

L3. **The live THREE viewport applies IDENTITY orientation** (`SkinnedMeshView.tsx:77`
    `SWG_ORIENTATION = new THREE.Euler(0,0,0)`). It does NOT pre-convert coords. So the live scene
    holds SWG-disk coordinates verbatim (= same as SIE renders, = X-mirrored vs DCC convention).

L4. THREE.js and glTF are both **right-handed, Y-up**.

L5. **Per-frame local bone transform** (shipped 02-04 sampler, ported from `Skeleton.cpp:1273-1279`):
    `localRot = postMul · (keyframeRot · bindPoseRot · preMul)`; translation is additive
    `localPos = bindTranslation + animDelta`. Keyframe quats on disk are **(w,x,y,z)**, SPARSE
    (frame-indexed). The keyframe quat is NOT the bone's final local rotation.

L6. Export target: `three@0.184.0` `GLTFExporter` (`three/examples/jsm/exporters/GLTFExporter.js`),
    binary `.glb`, must include skeleton + animation; opens in Blender 4.x / gltf.report.
    NOTE: `ColladaExporter` was REMOVED from three's examples by r0.184.0 — glTF only.

L7. Live material is a **custom `THREE.ShaderMaterial`** with `uDiffuseMap/uNormalMap/uSpecularMap/
    uEmissiveMap/uEnvMap` uniforms + hand-written GLSL (`swgMaterial.ts:406`). NOT a standard material.

## BANNED framings (do NOT re-derive these — they are FALSIFIED)
- ✗ "Export needs no transform because the viewport looks right." The viewport renders SWG-disk
  verbatim (X-mirrored vs DCC); roughly-symmetric assets hide it. Chirality is NOT yet verified.
- ✗ "GLTFExporter will serialize the custom ShaderMaterial's textures." Assume it will NOT.
- ✗ "The animation keyframe quats are the bone's final local rotation." They must be composed per L5.

Answer ONLY your assigned angle below. Cite file:line / derivations. A productive SPLIT across
consultants is the goal — do not collapse onto a single shared answer.
