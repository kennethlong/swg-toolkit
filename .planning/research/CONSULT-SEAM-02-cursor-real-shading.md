# Cursor task — real SWG character shading + skinned-normal handling (swg-client-v2)

Read LOCKED axioms first: `.planning/research/CONSULT-SEAM-AXIOMS.md`. Ground truth: `D:\Code\swg-client-v2`.
Cite file:line. Don't contradict axioms.

## Angle: how does the REAL client light a skinned character, and what stops seam blowout?

1. **Skinned NORMAL transform.** Find the real skinning vertex path (software AND/or shader). Does the
   engine transform the vertex NORMAL by the skinning/bone matrices (so normals follow the deformed pose),
   and does it RENORMALIZE after blending? Look at the software skinner
   (`SoftwareBlendSkeletalShaderPrimitive.cpp`) and any vertex-shader/HLSL for skinned meshes. State
   definitively: are skinned normals deformed + renormalized?
2. **Body shader math.** Read the actual body shader for ackbar — `akbar_body.sht` → its `.eft` → the
   `_as6`/`as` family `.psh`/HLSL (or its documented math). What is the specular model and intensity, and
   what is the diffuse-alpha (MAIN.alpha) channel actually used for (spec mask? gloss? opacity?)? Is
   specular even applied to creature body skin, or only to specific shaders?
3. **Lighting rig / space.** In what space does the engine do lighting (object/world/view)? Is the normal
   kept in the same space as the light direction? What is the actual light setup for character rendering
   (directional + ambient values)?
4. **Seams.** Does the engine do anything special so adjacent body parts (separate mesh generators sharing
   one skeleton) don't show bright seams — e.g. shared/averaged boundary normals, per-pixel vs per-vertex
   lighting, no specular on skin, normal renormalization in the pixel shader?

## Deliverable
For each item: file:line evidence + a one-line definitive answer. End with: "what the real client does that
our shader (axioms A4/A5) does NOT" — the specific delta most likely responsible for white seams during
animation. No code.
