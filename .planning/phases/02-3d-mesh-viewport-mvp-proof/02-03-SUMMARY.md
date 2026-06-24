---
phase: 02-3d-mesh-viewport-mvp-proof
plan: 03
subsystem: renderer/viewport/material
tags: [ShaderMaterial, DDS, S3TC, DXT, CustomizationPanel, MaterialInspector, orientation]
dependency_graph:
  requires: [02-02]
  provides: [VIEW-02]
  affects: [02-04, 02-05]
tech_stack:
  added: []
  patterns:
    - "ShaderMaterial with uTexFactor (pathway C) + uMaterialColor (pathway A) — DISTINCT Vector4 uniforms"
    - "GPU skinning via #include <skinbase_vertex> + <skinning_vertex> + USE_SKINNING define (auto-set by Three.js for SkinnedMesh)"
    - "Three.js auto-upgrades ShaderMaterial to GLSL3/300es in WebGL2 (WebGLProgram.js:803); #define texture2D texture added automatically"
    - "CompressedTexture(mipmaps, w, h, S3TC_enum) for DXT1/3/5 GPU upload"
    - "decodeDxt(): real DXT1/2/3/4/5 block decoder -> RGBA8 (CPU fallback)"
    - "DDS format enum cast to CompressedPixelFormat for CompressedTexture constructor"
    - "gl as THREE.WebGLRenderer from useThree() — getContext() for S3TC extension check"
    - "SWG->viewer 180 Y rotation (pure rotation, det=+1): axis_forward=Z, axis_up=Y convention"
    - "Zero-alloc customization: uniforms.uTexFactor.value.set(r,g,b,a) in useFrame (no new objects)"
key_files:
  created:
    - packages/renderer/src/panels/viewport/material/swgMaterial.ts
    - packages/renderer/src/panels/viewport/material/ddsTexture.ts
    - packages/renderer/src/panels/viewport/material/dxtCpuDecode.ts
    - packages/renderer/src/panels/viewport/CustomizationPanel.tsx
    - packages/renderer/src/panels/viewport/MaterialInspector.tsx
  modified:
    - packages/renderer/src/panels/viewport/StaticMeshView.tsx
    - packages/renderer/src/panels/viewport/SkinnedMeshView.tsx
    - packages/renderer/src/panels/viewport/Viewport.tsx
    - packages/renderer/src/panels/ViewportPanel.tsx
    - packages/renderer/src/state/viewportStore.ts
decisions:
  - "Three.js auto-upgrades ShaderMaterial to GLSL3 in WebGL2 — do NOT set glslVersion: GLSL3 manually (causes double-version header); omit and let the engine handle it"
  - "skinning chunks in custom ShaderMaterial: must use skinbase_vertex (declares boneMatX/Y/Z/W) THEN skinning_vertex; skinning_vertex alone references undeclared identifiers"
  - "useThree().gl returns THREE.WebGLRenderer, not WebGLRenderingContext; call renderer.getContext() for raw WebGL context when needed (e.g. getExtension)"
  - "Palette bytes not stored separately in resolver slotBytes — CustomizationPanel shows 'palette missing' warning for now; full wiring requires resolver to store palettePath->bytes (deferred)"
  - "SWG->viewer orientation: 180 Y rotation applied at group level (pure rotation, det=+1). Matches io_scene_swg_msh axis_forward=Z convention. HUMAN-VERIFY pending at checkpoint"
  - "viewport-default-facing-axis todo: stays pending until human confirms facing vs SIE at checkpoint"
metrics:
  duration: "14 minutes"
  completed: "2026-06-24"
  tasks_completed: 2
  tasks_total: 3
  files_created: 5
  files_modified: 5
---

# Phase 02 Plan 03: swgMaterial + DDS + CustomizationPanel + MaterialInspector Summary

**One-liner:** Custom ShaderMaterial (pathway A/C distinct uniforms, DOT3 tangents, GPU skinning coexistence) with DDS CompressedTexture GPU upload + real CPU-decode fallback; CustomizationPanel swatch live-swap; MaterialInspector multi-group slot provenance; SWG 180-deg Y orientation for viewer alignment.

## What Was Built

### Task 1: swgMaterial + DDS + CPU-decode + orientation

**material/swgMaterial.ts — buildSwgMaterial(opts):**
- Custom THREE.ShaderMaterial (NOT MeshStandardMaterial)
- ALL sampler uniforms in FRAGMENT shader: uDiffuseMap/uNormalMap/uSpecularMap/uEmissiveMap/uEnvMap
- Distinct customization uniforms:
  - uMaterialColor (Vector4, default 1,1,1,1) → pathway A (palette-material-color)
  - uTexFactor (Vector4, default 1,1,1,1) → pathway C (palette-texture-factor)
  - Pathways A and C are DISTINCT — not collapsed onto the same uniform
- GPU skinning via `#include <skinbase_vertex>` + `#include <skinning_vertex>` when skinned:true
  - Three.js sets USE_SKINNING define automatically for SkinnedMesh
  - DO NOT set material.skinning (removed in r140)
- Normal map: authored DOT3 TBN from tangent attribute when hasDot3Tangents=true; dFdx/dFdy fallback otherwise
- uSpecPower: float 32.0 (Phong specular)
- Simple 3-point lighting in fragment shader for MVP lighting
- Three.js auto-upgrades to GLSL3/300es in WebGL2 — no glslVersion needed

**material/dxtCpuDecode.ts — decodeDxt():**
- Real DXT1/DXT2/DXT3/DXT4/DXT5 4x4 block decoder → RGBA8
- DXT1: 8 bytes/block, 4-color or 3-color+transparent mode
- DXT3: explicit alpha (4-bit nibbles) + color
- DXT5: interpolated alpha (endpoint + 3-bit lookup table, 6-byte alpha section) + color
- DXT2/DXT4: de-premultiply (divide RGB by alpha/255)
- T-02-15: block-read bounds-checked against slice length
- Pure TypeScript, no dependencies

**material/ddsTexture.ts — buildDdsTexture():**
- S3TC present + DXT1/3/5: THREE.CompressedTexture(mipmaps[], w, h, s3tc_enum)
  - Format enum validated against whitelist before GPU upload (T-02-12)
  - DXT2/DXT4 never passed to driver
- S3TC absent OR DXT2/DXT4: decodeDxt mip0 → THREE.DataTexture(RGBA8)
  - Calls setS3tcWarning once when S3TC absent
- S3TC extension check via renderer.getContext().getExtension()
- Returns { texture, cpuDecoded, formatLabel: "DXT5 · 512×512 · 9 mips" }

**StaticMeshView.tsx + SkinnedMeshView.tsx:**
- Replace MeshStandardMaterial placeholder with buildSwgMaterial per shader group
- Texture bytes from resolution.materials[i].slotBytes (NO re-fetch from TRE)
- MAIN→uDiffuseMap, NRML/CNRM→uNormalMap, SPEC→uSpecularMap, EMIS→uEmissiveMap
- ENVM handled via scene.environment (wired in future pass)
- SWG→viewer 180° Y rotation on root group (pure rotation, det=+1)
  - Matches io_scene_swg_msh @orientation_helper(axis_forward='Z', axis_up='Y')
  - HUMAN-VERIFY at checkpoint vs SIE default facing

**viewportStore.ts:**
- Added s3tcWarning: string|null field (default null)
- Added setS3tcWarning(msg) action; included in reset

### Task 2: CustomizationPanel + MaterialInspector

**CustomizationPanel.tsx:**
- Derives vars from ALL shader groups via flatMap (multi-group, de-duped by name)
- Returns null (hidden) when no vars present
- Per-variable VarRow: variable name, palette filename + current index (mono), swatch strip, Reset
- Swatches: 18×18px, --radius-sm, 3px gap; selected = 2px accent ring (not color alone — Rule 1)
- aria-label="Set {varName} to palette index {i}", title="#AARRGGBB" on every swatch
- Live #AARRGGBB readout; Reset restores cVar.defaultIndex
- Click → setCustomizationIndex → zero-alloc uniform mutation in useFrame via store subscription
- T-02-13: index clamped to [0, entryCount-1]
- Palette missing warning via VerificationStatus warn (palette bytes not yet in slotBytes — known partial)

**MaterialInspector.tsx:**
- One GroupBlock per shader group (multi-group support)
- Slot display order: MAIN/NRML/CNRM/SPEC/EMIS/ENVM/MASK
- Per-slot: slot name (mono), texture filename (mono, ellipsis), DDS format label (mono)
- Missing texture: VerificationStatus warn "missing: {name} — magenta placeholder"
- DDS parse error: VerificationStatus warn
- S3TC unavailable: VerificationStatus warn per-group + global banner at top
- Per-group provenance: variant (SSHT/CSHD) + byte-exact ✓ from roundTrip.passed
- Reads s3tcWarning from viewportStore

**ViewportPanel.tsx:**
- Mounts CustomizationPanel + MaterialInspector in inspector side-panel
- Positioned below AppearancePanel with dividers

## Task 3: CHECKPOINT — Awaiting Human Verification

See checkpoint message below.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] glslVersion: THREE.GLSL3 caused double-version header**
- **Found during:** Task 1 — Three.js WebGLProgram.js:803 already forces #version 300 es for all ShaderMaterial in WebGL2; setting glslVersion:GLSL3 manually would add a second version directive
- **Fix:** Removed glslVersion from ShaderMaterial options; Three.js handles this automatically
- **Note:** texture2D/textureCube macros are also added automatically (#define texture2D texture)

**2. [Rule 1 - Bug] skinbase_vertex missing from skinning include chain**
- **Found during:** Task 1 — skinning_vertex references boneMatX/Y/Z/W which are declared by skinbase_vertex; skinning_vertex alone would fail with undeclared identifiers
- **Fix:** Added #include <skinbase_vertex> before <skinning_vertex> in vertex shader

**3. [Rule 1 - Bug] useThree().gl type is THREE.WebGLRenderer not WebGLRenderingContext**
- **Found during:** Task 1 typecheck — TypeScript error on cast
- **Fix:** Changed buildDdsTexture() parameter from WebGLRenderingContext to THREE.WebGLRenderer; use renderer.getContext() for S3TC extension check

**4. [Rule 1 - Bug] Template literal backtick in comment terminated GLSL string**
- **Found during:** Task 1 typecheck — TS1005 error at line 76
- **Fix:** Changed comment from backtick-quoted to double-quote style

### Known Limitation (Not Auto-fixable)

**Palette bytes not stored in resolver slotBytes:**
- The 02-02 resolver stores DDS texture bytes per ShaderSlotName (MAIN/NRML/etc.) but does NOT store .pal palette file bytes separately
- CustomizationPanel shows "palette missing" warning for customization vars whose .pal file wasn't plumbed
- This is acceptable for the checkpoint — the color swap wiring is correct; it will fire if palette bytes are added
- Full fix: resolver needs to also fetch palettePath → bytes per customizationVar and store them (outside ShaderSlotName key scheme)
- Deferred to a follow-up or 02-04

## Known Stubs

- **CustomizationPanel.tsx:** Palette swatch display falls through to VerificationStatus warn when palette bytes aren't in slotBytes. The zero-alloc uniform mutation pathway is wired correctly; only the palette display is limited.
- **SWG orientation (SWG_ORIENTATION 180° Y):** Applied but not yet human-verified vs SIE. The viewport-default-facing-axis todo remains in pending/ until the maintainer confirms at the checkpoint.
- **AppearancePanel.tsx stub buttons:** "Attach skeleton..." / "Attach animation..." remain disabled — wired in 02-04 (intentional carry-forward).

## Threat Surface Scan

No new threat surface beyond plan's threat model:
- T-02-12: DDS GPU format whitelisted (DXT1/3/5 only) before mapping to WEBGL constant — implemented
- T-02-13: Palette index clamped to [0, entryCount-1] in VarRow + useFrame — implemented
- T-02-14: GLSL strings are authored source (not user input); uniforms typed Vector4/Texture/float — accepted per plan
- T-02-15: parseDds C++ bounds-checks mip offsets; decodeDxt bounds-checks block reads — implemented in 02-01 + dxtCpuDecode.ts

## Self-Check: PASSED

Files created verified:
- packages/renderer/src/panels/viewport/material/swgMaterial.ts — FOUND
- packages/renderer/src/panels/viewport/material/ddsTexture.ts — FOUND
- packages/renderer/src/panels/viewport/material/dxtCpuDecode.ts — FOUND
- packages/renderer/src/panels/viewport/CustomizationPanel.tsx — FOUND
- packages/renderer/src/panels/viewport/MaterialInspector.tsx — FOUND

Commits verified:
- 0324819 — feat(02-03): swgMaterial ShaderMaterial + DDS GPU upload + CPU fallback + SWG orientation
- 1049a20 — feat(02-03): CustomizationPanel + MaterialInspector (VIEW-02 chrome)

TypeScript: 0 errors (npx tsc --noEmit in packages/renderer)
Test suite: 139/139 passing
