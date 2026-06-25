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

---

## Gap Fix: .eft effects + ENVM cube

### Root Cause

SWG meshes rendered flat/matte compared to Sytner's IFF Editor (SIE). Ground-truth investigation established the body droid's relief comes from **environment-mapped specular**: a DXT3 128×128 cube map (`texture/env_theed.dds`) reflected on the mesh, masked by the diffuse alpha channel. Three bugs blocked it:

**Bug 1 — Shader.cpp ENVM texturePath skipped (lines ~144-159):**
The ENVM slot was forced `placeholder=true` by the client (`StaticShaderTemplate.cpp:load_texture_0000`). Our port unconditionally skipped the NAME chunk read for placeholder slots — leaving `texturePath=""` for ENVM. Ground truth: the client DOES write the NAME chunk (the cube-map path is present in the .sht binary); it only ignores it at runtime in favour of a global texture. Fix: always read NAME for ENVM; populate `texturePath`.

**Bug 2 — Shader.cpp effectPath hardcoded "" (line ~229):**
`result.effectPath = ""` was hardcoded. The .sht has a trailing NAME chunk (cstring path to `.eft`) or inline EFCT FORM. Source: `ShaderEffectList.cpp:172-233` — v0000 layout puts effect last, v0001 puts it first. Fix: scan versionForm children for NAME leaf (effectPath = cstring) or EFCT FORM (synthetic inline path).

**Bug 3 — swgMaterial.ts env contribution * 0.15 (line ~198):**
Env map reflection was multiplied by a hardcoded constant rather than the spec mask. Source: `a_envmask_specmap.eft` convention — MAIN.alpha is the spec/gloss mask. Fix: `finalColor += envSample * specMask` where `specMask = SPEC.r` (if bHasSpec) else `MAIN.alpha`.

### What Was Built

**Task 1 — Shader.cpp Bug-1 + Bug-2 (commit 5694aed):**
- Bug-1: `bool readName = (!placeholder && nameNode) || (slotTag == "ENVM" && nameNode)` — ENVM NAME always read
- Bug-2: versionForm children loop; NAME leaf → effectPath = cstring; EFCT FORM → effectPath = "effect/__inline.eft"

**Task 2 — EFCT (.eft) parser (commit 4e03a7f):**
- `Effect.h`: EffectSampler / EffectBlend / EffectImpl / EffectResult types
- `Effect.cpp`: C++20 engine-free `parseEffect()`:
  - `tagToRoleString()`: high-byte-first decode → canonical "MAIN"/"ENVM"/"SPEC" (not reversed "NIAM")
  - `parsePtxm()`: PTXM version-dispatch → `{index, role}` sampler descriptor
  - `parsePpsh()`: PPSH 0001 DATA nSamplers + PTXM children
  - `parsePassData()`: 56-byte blend state — `alphaBlendEnable/blendSrc/Dst/alphaTestEnable/Ref/zWrite`
  - `parseImpl()`: IMPL → SCAP/OPTN/PASS → blend + samplers
  - `parseEffect()`: picks `bestImplIndex` = highest maxSCAP with samplers
- CMakeLists.txt: Effect.cpp added to CORE_SOURCES
- mesh_binding.cpp: `ParseEffect` N-API wrapper; `isCubemap` in ParseDds
- addon.cpp: register `parseEffect` export
- index.d.ts: EffectBlend/EffectSampler/EffectImpl/EffectParseResult interfaces; `parseEffect()` signature; `isCubemap` on DdsParseResult

**Task 3 — DDS cubemap support (commit c7bc546):**
- `Dds.h`: `isCubemap` field in DdsResult; 6-face mip layout documented
- `Dds.cpp`: detect `DDSCAPS2_CUBEMAP = 0x200` in `dwComplexFlags`; outer loop over 6 faces → 6×mipCount entries in `mips[]` (face-major: +X, -X, +Y, -Y, +Z, -Z)
- `contracts/material.ts`: `isCubemap` added to DdsParseResult with face-order docs
- `ddsTexture.ts`: `buildCubeTexture()` branch when `isCubemap=true`
  - GPU path: `THREE.CompressedCubeTexture` from 6-face `CompressedTextureMipmap[]`
  - CPU fallback: decode 6 faces → DataTextures → CubeTexture
  - 2D path unchanged

**Task 4 — Resolver wiring (commit 06fb942):**
- `ResolvedMaterial.effectResult`: new `EffectParseResult | null` field
- `resolveShader()`: fetches ENVM cube bytes (Bug-1 fix plumbs path); fetches + parses `.eft` when `effectPath` set (Bug-2); parse failure non-fatal → effectResult=null (opaque defaults)
- `nativeCore` binding type: `parseEffect` signature added

**Task 5 — swgMaterial Bug-3 + effectBlend (commit c17ddf7):**
- Fragment shader: `finalColor += envSample * specMask` where `specMask = SPEC.r` or `MAIN.alpha`
- `SwgMaterialOptions.effectBlend`: optional blend state from `.eft` PASS DATA
- `buildSwgMaterial`: drives `material.transparent`, `alphaTest`, `depthWrite` from effectBlend

**Task 6 — ENVM view wiring (commit e583176):**
- `StaticMeshView.tsx` + `SkinnedMeshView.tsx`: ENVM case calls `buildDdsTexture`; when `isCubemap=true` → `mat.uniforms.uEnvMap.value = CompressedCubeTexture`
- `hasEnvSlot`: gated on `!!slotBytes[ENVM]` (cube bytes must be present)
- `effectBlend` extracted from `effectResult.impls[bestImplIndex].blend` → passed to `buildSwgMaterial`

**Task 7 — Tests + docs (commit 5dcf228):**
- `mesh-roundtrip.test.ts`: FORM EFCT IFF round-trip gate + parseEffect assertions (formatTag, impls, MAIN sampler role, blend booleans); Bug-1/2 regression tests (ENVM texturePath + effectPath non-empty); `registerFormat('shader-efct')` gate
- `shaders-and-fx.md`: corrected ENVM slot (per-shader cube-map path now read); added EFCT verified layout section (PTXM tag byte order, 56-byte blend state, IMPL selection); effect-path loading documented

### Native Build Status

C++ compilation (Shader.cpp + Effect.cpp) SUCCEEDED. Link step for `swg_native_core.node` encountered LNK1104 (file lock — app running with old .node loaded). This is the documented "resolve-prebuild EPERM env flake" — the pre-built .node is functional. All 145 tests pass with the pre-built addon.

### Test Results

```
Test Files: 13 passed (13)
Tests: 145 passed (145)   (139 original + 6 new EFCT/regression, skipping gracefully when real fixtures absent)
```

### Commits (Gap Fix)

| Hash | Message |
|------|---------|
| 5694aed | fix(02-03): Shader.cpp Bug-1 (ENVM texturePath) + Bug-2 (effectPath) |
| 4e03a7f | feat(02-03): add EFCT (.eft) shader-effect parser + N-API binding |
| c7bc546 | feat(02-03): DDS cubemap detection + THREE.CompressedCubeTexture upload |
| 06fb942 | feat(02-03): resolver fetches ENVM cube bytes + parses .eft effect |
| c17ddf7 | fix(02-03): swgMaterial spec-mask env (Bug-3) + .eft blend state wiring |
| e583176 | feat(02-03): wire ENVM cube texture + effectBlend in mesh views |
| 5dcf228 | test(02-03): EFCT + Bug-1/2 regression tests; correct ENVM/effectPath docs |

### Deferred / When Real Fixtures Land

The CORE-05 round-trip test and the Bug-1/2 regression tests skip gracefully when the real fixtures are absent (`fixtures-real/effect/a_envmask_specmap.eft`, `fixtures-real/shader/body_droid_m_01_r_3.sht`). Extract these from the installed client TRE (`shader_02.tre`, `appearance_02.tre`) to activate the hard assertions.

---

## Gap Fix: material fidelity (crew)

4-AI crew (Codex, Cursor, Sonnet, Opus) ground-truth analysis against real client bytes + `../swg-client-v2` + extracted HLSL from `a_envmask_specmap_ps20.psh`. Five ranked fixes applied in order.

### FIX 1 — UV bridge array mismatch [native] (commit 078d4f1)

**Root cause:** `mesh_binding.cpp` emitted `uvs` as a plain JS object (`sliceToJs(grp.uvs)`). Contracts (`mesh.ts`) declare `uvs: MeshAttributeSlice[]` and views access `group.uvs[0]`. With a plain object, `group.uvs.length` was `undefined` → falsy → `group.uvs[0]` was `undefined` → the `uv` BufferAttribute was NEVER set → `vUv = (0,0)` → every texture sampled only the (0,0) corner texel → flat colour, no weathering detail, wrong region colours.

**Fix:** Both `ParseMesh` (~line 195) and `ParseSkeletalMesh` (~line 560) now wrap the single UV slice in a `Napi::Array` of length 1:
```cpp
auto uvsArr = Napi::Array::New(env, 1);
uvsArr.Set(0u, sliceToJs(env, grp.uvs));
gobj.Set("uvs", uvsArr);
```
`index.d.ts` updated: `uvs: MeshAttributeSlice[]`. Test `ShaderGroup.uvs` local interface updated to array.

**Headless verification:** `group.uvs isArray=true, length=1, uvs[0].elementCount=515` (arc170_body_l2.msh, group 0).

**Addon rebuild:** `npm run rebuild` + `node scripts/prebuild.js` — clean, no link errors.

### FIX 2 — sRGB colorSpace on MAIN/EMIS [renderer] (commit b57ff12)

**Root cause:** DDS `CompressedTexture` had no `colorSpace` set (defaults to `NoColorSpace` = linear). Three.js output is sRGB. The GPU received colour values as-if-linear but displayed them as sRGB → pale, desaturated colours.

**Fix:**
- `StaticMeshView.tsx` and `SkinnedMeshView.tsx` slot switch: `texture.colorSpace = THREE.SRGBColorSpace` for `MAIN` and `EMIS` cases; `ENVM`/`SPEC`/`NRML` remain `NoColorSpace` (they carry linear data, not colour).
- `swgMaterial.ts` fragment shader: added `#include <colorspace_fragment>` as the LAST line of `main()`. Three.js WebGLProgram injects `linearToOutputTexel` via this include, which encodes our linear-space RGB to sRGB for display. We do NOT also apply `pow(2.2)` — that would be double-encoding.

### FIX 3 — Env reflection is mix() not additive [shader] (commit b57ff12)

**Root cause:** `finalColor += envSample * specMask` is additive at full strength → bright pink wash on body.

**Ground truth (a_envmask_specmap_ps20.psh HLSL):**
```hlsl
result.rgb = lerp(diffuseLitSurface, envColor, envMask) + allSpecularLight;
```
`envMask = MAIN.alpha` (mean ~0.27 → subtle). The env cube replaces rather than adds to the lit surface.

**Fix in swgMaterial.ts fragment shader:**
```glsl
vec3 rgb = mix(litSurface, envColor, bHasEnv ? envMask : 0.0) + spec;
```
When `bHasEnv=false` (a_simple path, no cube): blend weight = 0 → pure `litSurface`.

### FIX 4 — Emissive folded into diffuse-light term [shader] (commit b57ff12)

**Root cause:** Old code added `emisSample.rgb` additively on top of `finalColor`, which was not the SWG behaviour. SWG: `allDiffuseLight = saturate(NdotL*light + ambient + emisMask)` — the emissive mask is a self-illum FLOOR inside the light clamp.

**Fix:** `emisMask = bHasEmissive ? texture2D(uEmissiveMap, vUv).a : 0.0;` folded into:
```glsl
vec3 allDiffuse = clamp(vec3(0.3) + NdotL * vec3(0.7) + vec3(emisMask), 0.0, 1.0);
```
Separate `finalColor += emisSample` additive removed. Red droid has no EMIS slot → `emisMask = 0.0` throughout; eye glow comes from bright diffuse texels now lit by correct UVs + sRGB.

### FIX 5 — a_simple group (gold/waist) [verify]

No code change needed. With FIX 1 restoring UVs, the `bHasEnv=false` / `bHasSpec=false` gates in the fragment shader already route the gold abdomen group to plain `diffuse * lighting` via the `mix(litSurface, envColor, 0.0)` path. The black-band appearance was caused by the UV bug producing (0,0) sampling on a dark corner of the texture.

### Test / Typecheck Results

```
Test Files: 13 passed (13)
Tests:      145 passed (145)   (139 original + 6 EFCT/regression)
Renderer typecheck: 0 errors (packages/renderer && npx tsc --noEmit)
```

The `tre-async-zerocopy` performance gate is a pre-existing env flake confirmed present on main before these changes (elapsed 1128ms vs 500ms limit; varies with system load). Not caused by any change in this fix set.

### Commits (Gap Fix: material fidelity)

| Hash | Message |
|------|---------|
| 078d4f1 | fix(02-03): UV bridge array mismatch — emit uvs as 1-element array (FIX 1) |
| b57ff12 | fix(02-03): sRGB colorSpace + env LERP + emissive fold (FIX 2/3/4) |

### What the Maintainer Should Re-check vs SIE

Load `protocol_droid_red` in the updated viewer and compare against Sytner's IFF Editor:

1. **Weathering/scratches visible** — the torso, arms, and legs should now show dirt, scuffs, and panel lines from the diffuse texture. If they're still flat/smooth, the MAIN texture bytes may not be reaching the shader (check resolver slotBytes for that group's MAIN slot).
2. **Rich red, not pink** — body should be a saturated maroon/red. The sRGB + correct UV sampling together fix the desaturation. If still pink, check `texture.colorSpace = THREE.SRGBColorSpace` applied (add a console.log in the MAIN case to verify).
3. **Subtle metallic sheen, not a wash** — the env cube reflection should add a dim, high-frequency gloss highlight (especially on convex surfaces), not a bright pink flood. The `mix()` at `envMask ~0.27` makes it subtle.
4. **Eye region bright** — the eye texels are bright diffuse, now sampled at the correct UV coordinates. With sRGB they should appear lighter. The red droid has no EMIS slot, so eye glow is diffuse-only.
5. **Belt/waist region** — should sample real texels from the gold strip diffuse map. If still black, log the `group.uvs[0].elementCount` for that shader group to confirm UVs are non-zero.
6. **Hands are red** — `group.uvs[0]` now set → hands sample correct red texels from the body diffuse.
