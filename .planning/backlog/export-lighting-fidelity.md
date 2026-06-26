---
id: EXPORT-LIGHTING-FIDELITY
title: Match the SWG look in exported glTF — PBR gloss-mapping, baked-unlit mode, Blender light rig
created: 2026-06-25
origin: Phase 02 02-05 — glTF export shipped; exported droid reads correct but lighter/less-glossy than the live render
status: backlog
kind: enhancement
suggested_milestone: post-v1.0 (export fidelity) + Phase 6 (Blender bridge, for #3)
reference: 4-AI crew CONSULT-P2-05B; memory swg-gltf-export-coordinate-mirror; related VIEW-MAT-FIDELITY, BLENDER-BRIDGE-MCP
---

## The problem

The 02-05 glTF export is a CORRECT, re-lightable PBR asset (geometry/UV/skeleton/animation/textures all
verified). But opened in Blender it reads **lighter and less glossy** than the live in-app render. Root
cause is philosophical, not a bug: **SWG bakes a fixed lighting model into its look**
(`finalColor ≈ diffuse × clamp(0.40 ambient + N·L·0.60 + emisMask) + Blinn-Phong spec + env reflection`,
hardcoded light, color partly baked into the texture), whereas **glTF ships only the material and lets
the target environment light it**. Blender's studio HDRI lights the bare diffuse brighter/flatter, and we
currently export it as matte dielectric (`metalness 0, roughness 0.7`), discarding SWG's gloss data.

Three approaches (not mutually exclusive). **Maintainer preference: #3.**

## #1 — Drive glTF PBR from SWG's gloss mask (cheapest, glTF-native, helps every viewer)

We already decode but DISCARD `MAIN.alpha`, which is SWG's **gloss mask** (Codex/Cursor-verified;
`swgMaterial.ts` spec path; `bMainHasAlpha`). Map it into the export's MeshStandardMaterial:
- `MAIN.α` → **roughnessMap** (glossy where α high), and → **metalnessMap** (metal where shiny, dielectric
  where matte). A protocol droid IS metal, so this is correct, not a hack.
- Blender Material Preview (and any glTF viewer with an env) then gives real **environment reflections**,
  recovering most of the glossy-metal depth — natively, no SWG-specific shader.
- Caveat: SWG diffuse carries a little baked shading/AO, so prefer a **metalnessMap** over a flat
  `metalness=1` to avoid washing out matte panel detail. Tune roughness range against the live render.
- Code: extend `exportMaterial.ts toStandardMaterial` (the alpha is already in the decoded RGBA from
  `decompressTexture`). Lowest effort, highest portability.

## #2 — Optional "Baked SWG look (unlit)" export mode (pixel-accurate, not re-lightable)

Run SWG's lighting model (ambient floor + N·L + emissive + spec/env approximation) and BAKE the result
into the exported baseColor, then export with **`KHR_materials_unlit`**. The asset then looks IDENTICAL
to the game in any viewer regardless of lights — because it's a snapshot, not a material.
- Trade-off: no longer re-lightable (double-lights if the user adds lights). Serve both audiences with an
  **ExportDialog toggle**: "PBR (editable)" (default, current) vs "Baked SWG look (screenshot-accurate)".
- Good for previews/screenshots/marketing; bad for editing. Pairs well with the in-app shader (reuse the
  same lighting math for the bake).

## #3 — Blender light rig that reproduces SWG's lighting (MAINTAINER'S PREFERRED) → Phase 6 Blender bridge

Ship a Blender world/light template that reproduces SWG's lighting model — the hardcoded directional +
the 0.40 hemispheric ambient floor + (optionally) the EnvironmentBlock sky/ground ramp + time-of-day.
Load it, and the SAME clean PBR asset (#1) lights up like the game — **re-lightable AND faithful**.
- This is the "best of both": keep the asset editable, get the game look on demand by applying the rig.
- Belongs with the **Phase 6 Blender bridge** ([[blender-bridge-mcp]]): the bridge already drives Blender,
  so it can apply the rig and (via MCP) keep it in sync. Could ship as a `.blend` world asset + an
  "Apply SWG lighting" action, or a node group.
- Depends on extracting SWG's real light/ambient values (mine `swgMaterial.ts` lightDir + the
  EnvironmentBlock/time-of-day model; see VIEW-MAT-FIDELITY item 1 for the hemispheric-lighting ground truth).

## Recommendation
Do **#1** first (cheap, principled, universal). Add **#2** as an export toggle when a "match the game"
need arises. Build **#3** as part of the Phase 6 Blender bridge — it's the maintainer's preferred end
state (editable asset + game-accurate lighting on demand) and the natural home for SWG lighting reproduction.
