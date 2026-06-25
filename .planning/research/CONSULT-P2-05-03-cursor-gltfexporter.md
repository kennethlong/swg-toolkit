# Angle 3 (three.js code reader) — what GLTFExporter r0.184.0 actually serializes

FIRST read `.planning/research/CONSULT-P2-05-AXIOMS.md` (LOCKED ground truth, esp. L6, L7).

You are the detailed code reader. Read the ACTUAL exporter source at
`node_modules/three/examples/jsm/exporters/GLTFExporter.js` (three@0.184.0) and answer concretely
with line citations — not from memory.

1. **Material support.** Which `THREE.Material` subclasses does GLTFExporter serialize with full PBR
   output? What EXACTLY happens when it encounters a plain `THREE.ShaderMaterial` (our case, L7)? Does
   it: emit a default material, silently pick up only `.map`/`.color` if those properties exist, warn,
   or throw? (Our ShaderMaterial has NO `.map`/`.color` — textures live in custom uniforms.) Cite the
   material-handling code path.

2. **Minimal textured conversion.** Give the minimal `MeshStandardMaterial` (or MeshBasicMaterial)
   field setup so the .glb is TEXTURED with: diffuse (`.map`, sRGB/`SRGBColorSpace`), normal
   (`.normalMap`), emissive (`.emissiveMap` + `.emissive`). How are these textures embedded in a
   BINARY glb (data URIs vs bufferViews)? Any requirement on `texture.flipY`, colorspace, or
   `texture.image` type (ImageBitmap/canvas) for the embed to work in Electron's renderer?

3. **Skinned mesh + skeleton.** How does GLTFExporter export a `THREE.SkinnedMesh`? Confirm it needs
   `skinIndex`/`skinWeight` geometry attributes + a bound `Skeleton` + `bindMatrix`; how it writes the
   joints array and `inverseBindMatrices`. Any gotchas when MULTIPLE SkinnedMeshes share ONE Skeleton
   (our multi-part case)?

4. **Animation binding.** How are `AnimationClip` tracks bound to nodes on export — by `bone.name`?
   Confirm track names `"${bone.name}.quaternion"` and `"${bone.name}.position"` resolve correctly,
   and that the bones must be present in the exported scene graph. Any requirement that the clip be
   passed via `parse(scene, ..., { animations: [clip] })`?

Output: a concrete, cited implementation note covering 1–4, flagging anything that would make a
rigged+animated+textured .glb fail to round-trip into Blender 4.x.
