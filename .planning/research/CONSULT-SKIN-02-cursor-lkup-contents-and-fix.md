# CONSULT (Cursor): specular_lookup_35.dds contents + faithful GLSL spec for a_specmap_bump

## LOCKED axioms — treat as given, do NOT contradict
1. Client source of truth = `D:\Code\swg-client-v2`. Installed assets at `D:\SWG Infinity` and
   `D:\SWGEmu Client\SWGEmu` (real .tre bytes).
2. `a_specmap_bump.eft` slots: LKUP=`texture/specular_lookup_35.dds`, MAIN (diffuse), NRML (normal).
   MATL specular [0.182,0.182,0.182], power 20. hasDot3=false (derivative TBN).
3. Symptom: Han Solo's FACE is over-bright/shiny on the lit half; the BODY (identical shader/MATL)
   looks fine. The renderer currently does raw Blinn-Phong `pow(N·H, 20) * matSpec * MAIN.alpha`
   and IGNORES the LKUP texture entirely.
4. `.psh` are compiled bytecode — do NOT interpret bytecode; use HLSL/PSRC source or C++.

## YOUR ANGLE (asset-byte reader + GLSL author)
1. Find `specular_lookup_35.dds` (or `specular_lookup*.dds`) in the installed clients. Report its
   dimensions, format, and DESCRIBE the actual pixel content (is it a 1D/256x1 ramp? a 2D NxM table?
   monotonic falloff? what gradient?). A hexdump/decode of the gradient is the key evidence — quote it.
2. From the client SOURCE, confirm what coordinate indexes the lookup (cross-check, don't assume).
3. Given THREE.js r0.184 ShaderMaterial, fragment shader does `specInt = pow(max(dot(N,H),0), 20)`,
   propose the FAITHFUL GLSL that applies the LKUP ramp: the sampler2D, the texcoord, and how the
   result modulates spec. Then propose a NO-TEXTURE analytic approximation (Fresnel-modulated or
   softened spec) that matches the ramp's visual effect.

Report file:line, the DDS decode (dims/format/gradient), and concrete GLSL. Mark FOUND vs INFERRED.
