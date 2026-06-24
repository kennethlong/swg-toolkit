# CONSULT-P2-04 — Sonnet — `.sht` shader + `.dds`/`.pal` customization → Three.js material mapping

## Your role
Lateral systems reader. Bridge two worlds: (a) how SWG's `.sht` shader templates reference textures
and apply **customization** (palette-indexed color variables), and (b) how that maps onto **Three.js
materials** for full multi-map parity + **live customization color-swapping** + **GPU skinning**.
Out-of-the-box thinking is wanted — but every SWG-side claim must cite real source.

## De-anchoring frame (READ FIRST)
- **Ground truth = real code in `../swg-client-v2` + Python in `../swg-blender-plugin`.** Cite file:line.
- `docs/03-rendering/shaders-and-fx.md` (44 code blocks) + `docs/03-rendering/viewport-tools.md`
  (52 code blocks) are **AI-distilled (Gemini)** — **UNVERIFIED HYPOTHESES.** They may contain plausible
  but fabricated Three.js snippets. Use them for *ideas to verify*, not as answers.

## LOCKED ORACLES — read, cite file:line
SWG-side (C++), under `../swg-client-v2/src/engine/client/library/clientGraphics/src/shared/`:
1. `ShaderTemplate.cpp` + `StaticShaderTemplate.cpp` — base `.sht` template: texture references, material params
2. `CustomizableShaderTemplate.cpp` — **the customization system**: how customization variables index
   into palettes (`.pal`) and remap colors (THIS is the live-color-swap mechanism — decode it carefully)
3. `Texture.cpp` — `.dds`/DXT texture handling (which DXT formats, mip handling)
4. `SwitchTextureShaderTemplate.cpp` / `ShaderPrimitiveSet*.cpp` — texture switching + shader→geometry binding
Palette `.pal` + customization data: find `PaletteArgb*` and `CustomizationData*` under clientGraphics/
clientObject (locate the exact files yourself; report paths).
Secondary (Python — second oracle): `../swg-blender-plugin/swg_pipeline/shader_builder.py`,
`shader_import.py`, `shader_effects.py`, `shader_extended.py`.

## Your question (NON-OVERLAPPING — YOUR slice is shaders/textures/customization + the Three.js bridge;
## NOT geometry bytes, NOT animation encoding, NOT the appearance graph)
1. **`.sht` structure:** IFF FORM/chunk tags + what a shader template references — diffuse, normal,
   specular, environment/effect maps; how each texture slot is named and which `.dds` it points to.
2. **Customization decode:** in `CustomizableShaderTemplate`, exactly how a customization variable (e.g.
   a hue/ramp index) selects a palette entry from a `.pal` and recolors the material at runtime. What
   are the inputs (variable name, range) and the output (which texture/material channel is affected)?
   This is what we must expose as **live color pickers** — define the data model.
3. **`.pal` layout + `.dds`/DXT specifics:** `.pal` palette format (entry count, ARGB order); which DXT
   formats appear (DXT1/3/5), and whether we can upload compressed-to-GPU vs must CPU-decode.
4. **Three.js mapping (the lateral part):** propose how to map the above onto Three.js — material type
   (e.g. MeshStandardMaterial vs custom ShaderMaterial), how multi-map parity is achieved, how live
   customization is wired as uniforms WITHOUT per-frame allocation, and how it composes with
   `SkinnedMesh` GPU skinning. Note any SWG material behavior Three.js can't express out-of-the-box.
5. **Doc check:** mark each doc shader/Three.js claim CONFIRMED / PLAUSIBLE-UNVERIFIED / WRONG.

## Output
- `.sht` tag tree + texture-slot table (slot → map type → source, file:line).
- **Customization data model** (inputs → palette lookup → affected channel) — implementation-ready.
- `.pal` + DXT format facts.
- A concrete **Three.js material plan** (multi-map + live-customization uniforms + GPU skinning combo).
- A **doc-verdict** list. Flag any C++↔Python disagreement.
