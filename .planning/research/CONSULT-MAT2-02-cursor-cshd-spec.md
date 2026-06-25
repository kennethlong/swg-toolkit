# Cursor task — CSHD format + real specular/material-color model (swg-client-v2)

Read LOCKED axioms first: `.planning/research/CONSULT-MAT2-AXIOMS.md`. Ground truth: `D:\Code\swg-client-v2`.
Cite file:line. Don't contradict axioms.

## Angle: pin the exact CSHD resolution + the real material-color/specular math.

1. **CSHD format + customization.** Read `CustomizableShaderTemplate.cpp` / `CustomizableShader.cpp`.
   - Confirm CSHD wraps a base SSHT (A2). How is the base static shader loaded/referenced?
   - What customization chunks does CSHD add (CUST? palette/HUE/`/private/index_color_*`?), and how do
     they modify the base — do they replace a texture, tint via palette into a material/texture-factor
     color, or recolor a customizable texture? Enumerate the CSHD-level chunks + their fields.
   - For `storm_trooper_hces24.sht` specifically: is the white armor the base SSHT diffuse texture, or is
     diffuse produced by a customization (so parsing only the nested SSHT would still be wrong)?
2. **MATL usage + specular math.** Read `StaticShader.cpp` / `Material.cpp` + the dot3 body `.psh`
   (`a_specmap_pp_ps20`).
   - Confirm MATL field order/units (A3): ambient, diffuse, emissive, specular (each VectorArgb), then
     specularPower. Is VectorArgb stored A,R,G,B?
   - How is `MATL.specularColor` fed to the pixel shader, and how does it combine with the light specular
     color and `MAIN.alpha` (specularMask)? Give the exact final spec term.
   - Are `MATL.diffuseColor`/`ambientColor`/`emissiveColor` actually applied to the lit result, or
     typically identity/white for these character shaders? (i.e. do we need them, or just specular?)
   - What is a typical `MATL.specularColor` / specularPower for skin (`as9`/`asb14`) vs metal/armor?

## Deliverable
Per item: file:line evidence + one-line definitive answer. End with: (a) the minimal faithful CSHD diffuse
resolution for stormtrooper, and (b) the exact corrected spec term using MATL.specularColor. No code.
