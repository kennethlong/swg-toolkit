# Cursor task — real a_specmap_bump skin shader + specular_lookup (swg-client-v2)

Read LOCKED axioms first: `.planning/research/CONSULT-SKIN-AXIOMS.md`. Ground truth: `D:\Code\swg-client-v2`.
Cite file:line. Don't contradict axioms.

## Angle: pin EXACTLY what a_specmap_bump's pixel shader computes, especially the specular_lookup.

1. Find `effect/a_specmap_bump.eft` (or its implementations) and the pixel shader it uses
   (`a_specmap_bump_*_ps20.psh` family). Use any PSRC/HLSL source, .asm with comments, or the
   sampler-role/constant-setup C++ — NOT raw bytecode (A4).
2. **The specular_lookup texture (LKUP slot, `specular_lookup_35.dds`):** what is it (1D/2D ramp,
   dimensions, content)? How is it SAMPLED in the PS — by what coordinate (NdotH? NdotV? a Fresnel
   term? specular intensity?)? How does its result feed the final specular? Is it a roughness/skin
   spec ramp, a Fresnel ramp, or an anisotropic lookup? Give the exact sampling + combine.
3. How does the bump (NRML) get into lighting in this shader — tangent-space normal map decode +
   TBN source? Does the PS renormalize? Is there anything that would make a detailed face normal map
   over-respond vs a flatter body normal map?
4. Final spec assembly for a_specmap_bump: write the full term combining specular_lookup,
   materialSpecularColor (MATL.specular=0.182), MAIN.alpha mask, light spec color, and the bumped normal.
5. Is there a Fresnel / rim term in a_specmap_bump that our Blinn-Phong lacks (which would brighten
   grazing-angle skin = the lit-half edge of a face)?

## Deliverable
Per item: file:line evidence + definitive answer. End with: (a) what specular_lookup actually does in one
sentence, and (b) the exact corrected/approximate GLSL specular for skin that would match the client. No code edits.
