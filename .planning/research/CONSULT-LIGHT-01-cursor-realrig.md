# Cursor task — real SWG lighting rig + hemispheric constants (swg-client-v2 / swg-main)

Read LOCKED axioms first: `.planning/research/CONSULT-LIGHT-AXIOMS.md`. Ground truth: `D:\Code\swg-client-v2`,
`D:\Code\swg-main`. Cite file:line. Don't contradict axioms.

## Angle: pin the real diffuse lighting math + the actual constant values / light setup.

1. **`calculateHemisphericLighting` consumers + the dot3Light* constants.** Confirm A4's formula and find
   where `dot3LightDiffuseColor`, `dot3LightTangentMinusDiffuseColor`, `dot3LightTangentMinusBackColor`
   (and any `dot3LightTangentColor` / `dot3LightBackColor`) are COMPUTED and uploaded — `Direct3d9_LightManager.cpp`
   / `Direct3d11_LightManager.cpp`. What real-world quantities are they (key light color, ambient sky vs
   ground/back color, the "tangent" mid color)? Give the formulas that derive them from the scene lights.
2. **Typical VALUES.** For a normal outdoor/interior character scene, what are representative values of
   those constants (or the ambient/back/key colors that feed them)? Even approximate ratios (e.g. back ≈
   0.3× key, ambient color, etc.) so we can reproduce the dark-side lift. Is there a global ambient/back
   color set per scene/zone?
3. **The light DIRECTION.** Is hemispheric `direction` the key light dir in object/tangent space? How many
   real lights affect a character (single key + hemispheric ambient, or multiple)? What's the key light's
   typical direction/intensity for character rendering?
4. **Vertex vs pixel.** Is `vertexDiffuse` (the per-vertex term passed in) significant, and where does it
   come from (VS lighting)? Does ignoring it (we have none) materially change the shadow side?

## Deliverable
Per item: file:line evidence + a one-line definitive answer. End with: a concrete, parameterized diffuse
model we can implement in one fragment shader — the exact hemispheric formula + representative constant
values (key color/dir, ambient/sky color, back/ground color) that would lift the dark side to match the
game. No code edits.
