# LOCKED ground truth — glTF export "catty mess" face (do NOT contradict or re-derive)

We ship an in-app glTF (.glb) exporter for SWG skeletal meshes (three@0.184.0, Electron renderer).
A textured+rigged protocol_droid_red.sat exports; in Blender 4.x Material Preview the BODY reads mostly
OK but the FACE is a scrambled "cat face", the whole thing is grungy/matte vs the glossy live render,
and one part glows near-white. The live in-app viewport renders the SAME asset correctly (glossy C-3PO,
clean face, glowing eyes). These facts are MEASURED — treat as axioms.

L1. **EXPORTED GLB STRUCTURE** (measured from the .glb): 3 meshes, all indexed TRIANGLES, only TEXCOORD_0.
    - mesh0: mat0, 2790 verts, diffuse 512×256 (the body atlas; the FACE diffuse is in here).
    - mesh1: mat1, 354 verts, diffuse 128×128 (metallic pipes, NOT a face), emissive 512×512, JOINTS/WEIGHTS.
    - mesh2: mat2, 30 verts, diffuse 128×128.
    Head/face is part of mesh0's atlas. mesh1 (emissive) is a small detail part (abdomen/lens-like).

L2. **LIVE EMISSIVE SEMANTICS** (swgMaterial.ts:234-256, the real fragment shader):
    `emisMask = texture2D(uEmissiveMap, vUv).a;`  // ALPHA channel ONLY; RGB is IGNORED
    `vec3 allDiffuse = clamp(vec3(0.40) + NdotL*vec3(0.60) + vec3(emisMask), 0.0, 1.0);`
    `vec3 tinted = diffuseColor * uMaterialColor.rgb * uTexFactor.rgb;` then `finalColor ≈ tinted * allDiffuse`.
    So SWG emissive = an alpha MASK that self-illuminates the DIFFUSE color (brightens diffuse where mask=1).
    It is NOT a colored glow added on top. The exported 512² emissive texture is mostly-WHITE RGB with a
    dark lens feature; its ALPHA (unseen) is the real mask.

L3. **EXPORT BUG (confirmed)**: exportMaterial.ts sets glTF `emissive=[1,1,1]`, `emissiveMap = uEmissiveMap`
    (RGB). MeshStandardMaterial emits `emissiveFactor × emissiveMap.RGB` → mostly-white RGB glows the whole
    part white. WRONG vs L2 (should use .a as a mask on the diffuse color). This is a known defect to FIX.

L4. **EXPORT PIPELINE** (current code):
    - buildExportScene.ts: collect live THREE.SkinnedMesh (geometry+material ref, read-only); rebuild a
      BIND-POSE skeleton from parsedSkeleton (rest = postMul·bindPoseRot·preMul); clone each mesh geometry;
      toStandardMaterial(material); SkinnedMesh.bind(skeleton, IDENTITY bindMatrix); applyXMirror(exportRoot).
    - exportMaterial.ts: ShaderMaterial→MeshStandardMaterial; DXT CompressedTexture→RGBA DataTexture (CPU);
      diffuse(sRGB)/normal gated by bHasNormal/ emissive gated by bHasEmissive; flipY=false; roughness 0.7,
      metalness 0; **specular AND env-reflection DROPPED this phase** (no glTF-PBR equivalent).
    - applyXMirror (mirrorScene.ts): flip=diag(-1,1,1) baked into geometry — pos.x→-x, normal.x→-nx,
      tangent (tx,ty,tz,w)→(-tx,ty,tz,-w), REVERSE triangle winding, conjugate bind/inverse-bind + bone
      locals. (Verified earlier vs swg-client-v2 MayaConversions.h + Skeleton.cpp.)
    - buildAnimationClip: compose-then-mirror, NOW WORKING (animation is correct — not in scope here).

L5. **LIVE RENDER** is glossy (specular + environment reflection + the 0.40 ambient floor + emissive mask).
    The EXPORT is matte (diffuse + raw-RGB-emissive only; no spec/env/ambient-floor). The live customization
    tints uMaterialColor/uTexFactor are IDENTITY for protocol_droid_red (no palette) — NOT a factor here.

## BANNED framings (FALSIFIED — do not propose)
- ✗ "Emissive RGB is the glow color." It is the ALPHA mask self-illuminating the diffuse (L2).
- ✗ "Textures are swapped between parts." Each mesh keeps its own geometry+material (per-mesh clone, L4).
- ✗ "Animation/stiff-legs is the problem." That's fixed; this round is purely the static appearance/face.

Answer ONLY your assigned angle. Lead from this ground truth; cite real code (you may read this repo AND
siblings ../swg-client-v2, ../swg-blender-plugin, ../io_scene_swg_msh). A productive SPLIT across angles is
the goal. Reference images on disk: C:/Users/kenne/Downloads/redrobo1.png (live), redrobo3.png (export).
