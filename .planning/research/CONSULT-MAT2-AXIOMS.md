# LOCKED AXIOMS — SWG material model (CSHD resolution + MATL material colors)

Measured from `../swg-client-v2` + real `.sht` bytes (2026-06-25). **Treat as given.** Numbered.

- **A1. Two observed defects (both material-fidelity, NOT skinning regressions):**
  - `stormtrooper.sat` → `storm_trooper_hces24.sht` renders **fully white** (no diffuse).
  - `han_solo.sat` (all textures resolve) renders **over-shiny skin** on the lit side.
- **A2. CSHD wraps a full SSHT.** Real bytes of `storm_trooper_hces24.sht`:
  `FORM CSHD → FORM 0001 → FORM SSHT → FORM 0000 → { FORM MATS→0000→(TAG + MATL), FORM TXMS→… }`
  i.e. a CSHD contains a complete nested SSHT (material + texture maps) PLUS CSHD-level customization.
- **A3. MATL chunk layout** (`Material.cpp:64-72`, verbatim) — 4×VectorArgb + 1 float = **68 bytes**:
  `ambientColor(4f) , diffuseColor(4f) , emissiveColor(4f) , specularColor(4f) , specularPower(1f)`
  (read_floatVectorArgb = 4 float32 in A,R,G,B order; confirm order with the crew).
- **A4. Real body-shader spec math** (`a_specmap_pp_ps20.psh`, from prior CONSULT-19 dump):
  `specularMask = MAIN.alpha`;
  `allSpecularLight = (dot3SpecularIntensity * dot3LightSpecularColor * materialSpecularColor + vertexSpecular) * specularMask`;
  `result.rgb = (diffuseColor * allDiffuseLight * textureFactor.rgb) + allSpecularLight`.
  Specular is **additive**, gated by `lit()` (NdotL>0), and **scaled by `materialSpecularColor`** (= MATL.specularColor) and the light's specular color.
- **A5. Current SWG-Toolkit state:**
  - `parseShader` returns `variant:'CSHD'` for stormtrooper with **no slots / no MAIN** (it does NOT
    recurse into the nested SSHT) → renderer uses the white 1×1 default → white armor.
  - For SSHT it returns texture slots but **does not read MATL** → no material ambient/diffuse/spec
    color. The shader does `spec = pow(dot(N,H),P) * MAIN.alpha` (no `materialSpecularColor`) → skin
    spec is un-tempered → over-shiny (han_solo).
  - Customization vars (palette pathways A/C) exist in the resolver but CSHD's customization wiring is
    incomplete.

## OPEN QUESTIONS (do not assume — verify):
1. **CSHD diffuse:** Is parsing the nested SSHT's `TXMS` MAIN texture sufficient to make stormtrooper
   render its base diffuse, or does the armor diffuse/whiteness come from a CSHD **customization**
   (palette/HUE) that must also be applied? What CSHD-level chunks (CUST/PAL/HUE/etc.) exist and how do
   they modify the base SSHT?
2. **Spec model:** Exactly how does the real shader combine `MATL.specularColor`, the light specular
   color, and `MAIN.alpha` (specularMask)? What is the minimal faithful change to our additive spec?
3. **Other MATL colors:** Should we also apply MATL ambient/diffuse/emissive (do they matter for these
   assets, or are they identity/white)?
