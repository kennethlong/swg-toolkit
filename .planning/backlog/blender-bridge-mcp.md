---
id: BLENDER-BRIDGE-MCP
title: Blender bridge via MCP — drive Blender for SWG-native export AND glTF round-trip verification
created: 2026-06-25
origin: Phase 02 02-05 scoping — user decision "Both: in-app glTF exporter now + Blender bridge later"
status: backlog
kind: feature
suggested_milestone: Phase 6 (Blender bridge — docs/07-blender/)
reference: 4-AI crew analysis in .planning/research/CONSULT-P2-05-* ; existing swg-blender-plugin (SWG-native importer)
---

## What

02-05 ships a **self-contained in-app glTF (.glb) exporter** (three.js GLTFExporter) — works without
Blender installed, proves VIEW-04. This backlog item tracks the **Blender-MCP** capability the user
explicitly wants tracked (not lost) for the Phase 6 Blender bridge. Two distinct uses, both deferred
to Phase 6:

### Use A — Blender MCP as an alternate export ENGINE (product feature)
Drive a running Blender (via an MCP server, e.g. `blender-mcp` addon) to import the SWG asset
**natively** through the maintainer's `../swg-blender-plugin` (which already reads raw `.msh/.mgn/.skt/
.ans` directly — see `swg_scene/`), then export glTF/FBX/USD from Blender. This BYPASSES every
GLTFExporter limitation the crew mapped for the in-app path (ShaderMaterial→Standard conversion, DXT
CompressedTexture decompress, the X-mirror math, animation composition-bake) because Blender's mature
SWG importer + exporters handle them. Requires Blender installed + the swg plugin. This is the
"Send to Blender" surface of the Phase 6 bridge.

### Use B — Blender MCP as a VERIFICATION harness (dev/CI)
Drive Blender via MCP to import our **in-app .glb** and auto-assert: upright orientation, correct
**chirality on an asymmetric asset** (the one empirical check the crew flagged as still-open for the
X-mirror), skeleton present, animation plays. Automates the 02-05 human-verify checkpoint and any
future export-regression gate. Cheaper than Use A (no SWG-import dependency — just glTF import + checks).

## Why tracked here (not 02-05)
- A full "drive Blender" surface is the Phase 6 Blender bridge by architecture (`docs/07-blender/`),
  a different product surface than the self-contained viewport exporter.
- No MCP server is configured for this repo yet (no `.mcp.json`; connected MCP = Context7 + Google).
  Standing one up + a Blender-with-swg-plugin is a Phase-6 setup cost.
- The in-app exporter remains the correct 02-05 deliverable (no external dependency).

## When picked up
- Confirm/stand up an MCP server exposing Blender's Python API (`blender-mcp` or equivalent).
- Use B is the quick win — wire it as an export-verification step first (reuses the in-app .glb).
- Use A leans entirely on `swg-blender-plugin`'s SWG-native import; coordinate convention there is
  **X-negation** (`swg_scene/coords.py`), the same as our in-app mirror (crew-verified, see memory
  `swg-gltf-export-coordinate-mirror`).
