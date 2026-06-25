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

1. **Lighting rig** (the main residual): replace the single hardcoded directional + 0.3 ambient
   with the real client light setup (1 specular-capable parallel light + fill lights + ambient
   object) — see swg-client-v2 D3D9_LightManager / the VS lighting path. Match brightness/contrast.
2. **Tone / exposure**: SIE shows the maroon slightly more vivid — likely a tone-map/exposure or
   ambient-saturation choice. Calibrate against SIE (ACES toneMapping on the Canvas + exposure).
3. **.eft PTXM sampler-role map** — parseEffect returns samplers:[] (PTXM not decoded). See
   [[eft-parser-completion]]. Needed for authoritative texture→sampler roles.
4. **CSHD customization palette** — wire `.pal` tint for customizable (non-baked) variants. Codex
   gave the full spec (parse CSHD MATR/TXTR/TFAC vars → fetch .pal → tint uMaterialColor/uTexFactor).
   Not needed for the red droid (SSHT, baked) but required for color-customizable assets.
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
