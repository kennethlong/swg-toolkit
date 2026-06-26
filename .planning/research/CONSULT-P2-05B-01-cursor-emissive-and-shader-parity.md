# Angle 1 (code reader) — correct emissive bake + full live-shader parity audit

FIRST read `.planning/research/CONSULT-P2-05B-AXIOMS.md` (LOCKED ground truth L1–L5).

You are the detailed code reader. Two jobs:

1. **Derive the CORRECT glTF emissive for export.** Per L2 the live shader does
   `emisMask = uEmissiveMap.a; allDiffuse = clamp(0.40 + NdotL*0.60 + emisMask); final = diffuse*allDiffuse`.
   So emissive self-illuminates the DIFFUSE color where the alpha mask is high. Specify exactly how to build
   a `MeshStandardMaterial.emissiveMap` + `emissiveFactor` (three r0.184.0) that reproduces this in Blender:
   - Should `emissiveOut.rgb = diffuse.rgb * emis.a` (baked per-texel), emissiveFactor=[1,1,1]? Confirm/correct.
   - The diffuse (128×128) and emissive (512×512) differ in resolution but SHARE TEXCOORD_0. Give the exact
     CPU bake: sample diffuse at each emissive texel's UV (which filtering?), multiply by emis.a, write RGB.
     Watch colorSpace: diffuse is decoded sRGB; emission in glTF is also sRGB-ish — state the correct space so
     the baked product isn't double-gamma'd.
   - Is the `+0.40` ambient floor / NdotL part of emissive, or separate lighting we intentionally leave to
     Blender? (Do NOT bake scene lighting into emissive — only the self-illum term.)
   Give drop-in code for `exportMaterial.ts`.

2. **Full parity audit.** Read swgMaterial.ts (the WHOLE fragment shader) and list EVERY input that affects
   final pixel color: uDiffuseMap, uMaterialColor (A), uTexFactor (C), uNormalMap, uSpecularMap, uEnvMap,
   emisMask, the 0.40 floor, any alpha/blend. For each, state whether exportMaterial.ts replicates it and
   whether it matters for protocol_droid_red (L5 says material/texfactor are identity). Flag anything besides
   emissive that the export silently drops and would change the FACE appearance (e.g., alphaTest/cutout on the
   face, a second diffuse multiply, gamma). Output: emissive bake spec + a parity table (input | live | export |
   matters-for-this-asset).
