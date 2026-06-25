# CONSULT (Codex): how is `specular_lookup` sampled in a_specmap_bump?

## LOCKED axioms — treat as given, do NOT contradict or re-derive
1. SWG client source of truth = `D:\Code\swg-client-v2`.
2. The shader effect `a_specmap_bump.eft` binds a texture slot **LKUP = `texture/specular_lookup_35.dds`**
   (a small lookup texture), plus MAIN (diffuse), NRML (normal map). hasDot3=false.
3. MATL specular = [0.182,0.182,0.182], specular power = 20.
4. The `.psh` pixel shaders are COMPILED DX bytecode — do NOT interpret raw bytecode. Use any
   PSRC/HLSL/.fx/.fxh source, ASM comments, or the C++ that assigns sampler roles/registers/constants.

## YOUR ANGLE (call-graph / binding tracer)
Trace, with file:line, exactly:
(a) Where the string `specular_lookup` (or the LKUP slot tag) is referenced in C++ and which sampler
    register / texture stage it is bound to for the `a_specmap_bump` effect.
(b) In the pixel-shader SOURCE (find the HLSL/PSRC, not bytecode) for the `a_specmap_bump` family
    (or `*specmap*bump*` / `*specmap*pp*`), find the exact texture-coordinate EXPRESSION used to
    sample that lookup texture. Quote it verbatim. Is the lookup indexed by:
      - N·H (specular term), N·L, a Fresnel/view term, raw specular intensity, or a 2D coord?
(c) What does the sampled lookup VALUE then multiply / modulate in the final specular?
(d) Is there any comment or naming indicating this is a SKIN specular ramp / sheen / gloss falloff LUT?

Report file:line + verbatim code. Distinguish FOUND-IN-SOURCE vs INFERRED. If only bytecode exists,
say so and give whatever C++ binding evidence shows how the LUT is indexed.
