# LOCKED AXIOMS — skin specular (a_specmap_bump + specular_lookup) over-bright face

Measured from `../swg-client-v2` + real `.sht` bytes (2026-06-25). **Treat as given.** Numbered.

- **A1. Symptom:** Han Solo's **face** is overly bright/shiny on the lit half ("not just lighting").
  EVERYTHING ELSE now looks good after a material-fidelity fix (below). The body looks correct.
- **A2. Face and body use the SAME shader config** (measured):
  - `han_solo_face_asb14.sht`: effect `a_specmap_bump.eft`; slots **LKUP=`texture/specular_lookup_35.dds`,
    MAIN=`han_solo_face.dds`, NRML=`han_solo_face_n.dds`**; MATL specular `[0.182,0.182,0.182]`, power 20.
  - `han_solo_body.sht`: effect `a_specmap_bump.eft`; slots **LKUP=`specular_lookup_35.dds`, MAIN, NRML**;
    MATL specular `[0.182,0.182,0.182]`, power 20.
  - Both: `hasDot3=false`, 1 UV set, mesh v0004. So material, effect, tangent path are IDENTICAL.
  - The visible difference is therefore geometry + texture CONTENT (the face's detailed normal map
    `han_solo_face_n.dds` and MAIN.alpha), OR the unimplemented LKUP ramp showing up most on the face.
- **A3. Our renderer (just shipped, the spec-temper fix):**
  - Fragment spec: `specInt = NdotL>0 ? pow(max(dot(N,H),0),uSpecPower) : 0;  spec = specInt * uMatSpecular * envMask;`
    where `uMatSpecular = MATL.specular` (0.182 here), `uSpecPower = MATL.specularPower` (20), `envMask = MAIN.alpha`.
  - Final: `rgb = mix(litSurface, envColor, envWeight) + spec`. Face has NO ENVM ⇒ envWeight=0 ⇒ no env.
  - Normal map (bHasNormal, NRML present): tangent-space normal via a **derivative TBN** (dFdx/dFdy of
    world pos + uv), since hasDot3=false. N is world-space + skinned.
  - **The `LKUP` (specular_lookup) slot is NOT handled** — it's not MAIN/NRML/SPEC/EMIS/ENVM, so it's
    ignored entirely. `a_specmap_bump`'s pixel shader samples this lookup as part of its specular.
- **A4. `.psh` are compiled DX bytecode** — do NOT try to interpret raw bytecode; use any PSRC/HLSL
  source, asm comments, or the C++ that sets sampler roles / constants.
- **A5. Engine:** THREE.js r0.184, single hardcoded directional light dir (1,1,0.5), ACES tonemap, sRGB out.

## OPEN QUESTION (derive, don't assume)
Why is the FACE over-bright on the lit half while the body (identical shader) is acceptable, and what is
the minimal faithful fix? Candidates to evaluate, not assume: (a) the unimplemented `specular_lookup`
ramp that `a_specmap_bump` uses to shape/soften skin specular; (b) the derivative-TBN normal mapping
amplifying the detailed face normal map; (c) MAIN.alpha (spec mask) being high on the face; (d) our raw
Blinn-Phong being too hard for skin regardless. Determine which dominates and the correct/approximate GLSL.
