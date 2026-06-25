---
id: VIEW-MAT-FIDELITY
title: Material rendering fidelity — pixel-parity with Sytner's IFF Editor / in-game
created: 2026-06-24
origin: Phase 02 02-03 — MVP material proof met; SIE pixel-parity deferred here
status: backlog
kind: enhancement
suggested_milestone: post-v1.0 (material-fidelity pass)
reference: Sytner's IFF Editor (SIE) renders; 4-AI crew analysis in .planning/research/CONSULT-MAT-* / CONSULT-COLOR-*
---

## What

02-03 delivered the MVP material proof: custom SWG ShaderMaterial, DDS (incl. compressed cube),
correct UVs/weathering, env-mask-spec, opaque/blend, customization UI. The render is "super close"
to SIE for protocol_droid_red. This task is the remaining FIDELITY gap to match SIE/in-game pixel-
for-pixel. Crew-verified: the remaining gap is presentation (lighting/tone), NOT missing asset data
(material=white, no texture-factor, no vertex color, texture is sat-0.44 maroon).

## Items (consolidated from this phase's tracked todos)

1. **Lighting rig** (the main residual): replace the single hardcoded directional + ambient floor
   with the real client light setup. Ground truth (crew, 2026-06-25, `CONSULT-LIGHT-*`): the real
   diffuse is `calculateHemisphericLighting` (functions.inc) — a 3-stop key→tangent→back gradient on
   N·L PLUS a per-vertex `vertexDiffuse` (= accumulated ambient+fill+bounce ≈ 0.38-0.42 outdoor) —
   uploaded from `parallelSpecular[0]` only (D3D9/11_LightManager). back/tangent are SCENE-DERIVED
   (EnvironmentBlock TGA ramps, time-of-day); default to BLACK with no zone data. **Interim fix
   shipped:** raised the flat ambient floor 0.30→0.40 (NdotL scale 0.70→0.60) — for a neutral viewer
   a greyscale hemispheric model collapses to exactly this, so the full model only pays off once we
   feed scene-derived COLORED ambient/back + the fill light into the shader as uniforms (our custom
   ShaderMaterial ignores the THREE 3-point rig). Full impl = wire vertexDiffuse(V) + colored back/
   tangent; also consider a low-intensity colored fill directional for terminator softening.
9. **Emissive crush bug** (separate, found 2026-06-25): `allDiffuse = clamp(floor + NdotL*k + emisMask, 0,1)`
   folds EMIS.a INTO the clamped diffuse-light term, so on a partially-lit face with an active EMIS slot
   the emissive contribution clamps to 1.0 and destroys lit-region texture detail (affects glow assets —
   droid eyes, panel emitters, saber emitters). Fix: add emissive as a post-clamp additive term, not
   inside the diffuse saturate. No emissive-slot asset verified yet; file when one is tested.
2. **Tone / exposure**: SIE shows the maroon slightly more vivid — likely a tone-map/exposure or
   ambient-saturation choice. Calibrate against SIE (ACES toneMapping on the Canvas + exposure).
3. **.eft PTXM sampler-role map** — parseEffect returns samplers:[] (PTXM not decoded). See
   [[eft-parser-completion]]. Needed for authoritative texture→sampler roles.
4. **CSHD customization shaders — UNRESOLVED DIFFUSE (renders WHITE).** Confirmed 2026-06-25:
   `stormtrooper.sat` → `storm_trooper_hces24.sht` is variant **CSHD** with **no static MAIN slot**;
   our renderer only wires the SSHT `MAIN` diffuse path → falls back to the white 1×1 default →
   fully white armor. Affects EVERY customizable armor/clothing piece, not just stormtrooper. Need to
   parse the CSHD diffuse/texture references + `.pal` tint (parse CSHD MATR/TXTR/TFAC vars → fetch
   `.pal` → tint uMaterialColor/uTexFactor — Codex gave the full spec). Baked SSHT assets (red droid,
   ackbar, han_solo) are unaffected.
9. **Specular over-drive on skin (over-shiny).** Confirmed 2026-06-25: `han_solo.sat` (all SSHT,
   textures resolve) reads too glossy on the lit side. Our shader does `spec = specInt * MAIN.alpha`,
   but the real client tempers spec by `materialSpecularColor` (× light spec color) which we omit —
   so skin/`as9`/`asb14` shaders are too hot. (Newly obvious because the seam fix put the highlight in
   the geometrically-correct place.) Fix: source `materialSpecularColor` (from the `.eft`/`.sht`/material)
   and modulate spec by it; ground-truth math = `a_specmap_pp_ps20.psh`
   `(dot3SpecularIntensity * dot3LightSpecularColor * materialSpecularColor + vertexSpecular) * specularMask`.
5. **Per-shader blend mode from .eft** — foliage cutout / glass / additive. See [[viewport-shader-blend-mode]].
6. **Default camera facing** vs SIE. See [[viewport-default-facing-axis]].
7. **Status-bar mesh name** stale readout. See [[statusbar-mesh-name-stale]].
8. **DOT3 authored-tangent pool** — currently falls back to computeTangents(); expose the real
   SKMG v0004 tangent buffer over the bridge for accessory normal maps.

## Why backlog

The MVP viewport proof (VIEW-01/02) is met. Pixel-parity with a 15-year-mature tool is a polish
pass, not the MVP bar. Capture now; schedule as a dedicated material-fidelity milestone.

## STRONGLY related — prerequisite-quality

[[native-contract-conformance-test]] (HIGH): this phase hit ~6 native-binding↔contract field-shape
mismatches that each shipped silently (resolveEntry.found, LOD order, shader slotTag, DDS format,
uvs array, + the color investigation ruling out more). A conformance test would have caught them.
Do this BEFORE more bridge-heavy work (02-04 animation adds the .ans binding).
