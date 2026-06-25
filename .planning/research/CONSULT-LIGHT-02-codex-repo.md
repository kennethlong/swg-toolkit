# Codex task — repo lighting gap + change set (SWG-Toolkit)

Read LOCKED axioms first: `.planning/research/CONSULT-LIGHT-AXIOMS.md`. Repo: `D:\Code\SWG-Toolkit`.

## Angle: map our current lighting wiring and the minimal change set for a faithful diffuse model.

1. Confirm A2/A3: in `material/swgMaterial.ts`, the fragment does all lighting from a hardcoded `lightDir`
   + flat `0.3` floor; the `THREE.ShaderMaterial` does NOT consume the scene's THREE lights defined in
   `Viewport.tsx`. Cite file:line for the hardcoded light, the flat ambient, and the THREE light rig.
2. Options to feed real lighting into the shader and their wiring cost:
   - (A) Add uniforms for a hemispheric model (key dir/color, ambient/sky color, back/ground color) and
     replace the flat `0.3 + 0.7*NdotL`. Where to set these uniforms (buildSwgMaterial defaults? from a
     central lighting config?), and how to keep them consistent across Static + Skinned views.
   - (B) Make the ShaderMaterial consume THREE's lights (lights:true + THREE light uniform includes) so the
     Viewport 3-point rig drives it. Feasibility/cost with a custom GLSL ShaderMaterial in r0.184.
   - (C) Minimal: raise/replace the flat floor with a cheap hemispheric term (sky/ground lerp by N.y or by
     NdotL sign) using a couple of uniforms.
3. Blast radius: every consumer of `buildSwgMaterial` (Static + Skinned). Where defaults live so the change
   is centralized. Any per-asset state that must not regress (the lit side / spec / env already-good).
4. Tests: does anything assert the lighting? (probably not — it's GLSL). Note if a conformance/uniform
   guard is warranted.

## Deliverable
file:line confirmation of the current lighting path, then a ranked change set for options A/B/C with the
exact files/uniforms to touch and the centralization point, plus the lowest-regression default. No code.
