---
phase: 02-3d-mesh-viewport-mvp-proof
plan: "05"
subsystem: export-pipeline
status: complete
tags:
  - gltf-export
  - x-mirror
  - material-conversion
  - docs-correction
dependency_graph:
  requires:
    - 02-03  # material pipeline (ShaderMaterial uniforms, DXT textures)
    - 02-04  # skinned animation (composition formula, sparse IR)
  provides:
    - glTF (.glb) export with rigged + animated SWG meshes (VIEW-04)
    - X-mirror baked into deep-cloned export scene
    - ShaderMaterial → MeshStandardMaterial conversion for export
    - DXT CompressedTexture → RGBA DataTexture CPU decode for export
    - Compose-then-mirror animation keyframe sampler
    - Raw-asset Extract via readMountEntry
    - Corrected format docs with precise provenance callouts
  affects:
    - packages/renderer (export pipeline, ExportDialog, ViewportPanel header)
    - docs/02-formats/meshes-and-appearances.md
    - docs/02-formats/skeletons-and-animation.md
    - docs/03-rendering/shaders-and-fx.md
tech_stack:
  added:
    - "GLTFExporter from three/examples/jsm/exporters/GLTFExporter.js (binary glTF)"
  patterns:
    - "compose-then-mirror: L(f)=postMul·(key(f)·bindPoseRot·preMul) then flip=diag(-1,1,1)"
    - "deep-clone export scene (geometry.clone() + skeleton reconstruction) — live scene read-only"
    - "ShaderMaterial→MeshStandardMaterial conversion before GLTFExporter"
    - "DXT CPU decode via decodeDxt(buffer, byteOffset, byteLength, w, h, fmt)"
key_files:
  created:
    - packages/renderer/src/panels/viewport/export/mirrorScene.ts
    - packages/renderer/src/panels/viewport/export/exportMaterial.ts
    - packages/renderer/src/panels/viewport/export/buildAnimationClip.ts
    - packages/renderer/src/panels/viewport/export/buildExportScene.ts
    - packages/renderer/src/panels/viewport/ExportDialog.tsx
    - packages/harness/test/buildAnimationClip-composition.test.ts
  modified:
    - packages/renderer/src/panels/viewport/Viewport.tsx
    - packages/renderer/src/panels/ViewportPanel.tsx
    - packages/renderer/src/state/viewportStore.ts
    - docs/02-formats/meshes-and-appearances.md
    - docs/02-formats/skeletons-and-animation.md
    - docs/03-rendering/shaders-and-fx.md
decisions:
  - "glTF (.glb) ONLY — ColladaExporter was removed from three@0.184.0; all export is via GLTFExporter.parseAsync(scene, {binary:true, animations:[clip]})"
  - "X-mirror BAKED into deep-clone (not root scale node) — negative-scale root + skinning breaks Blender import; flip=diag(-1,1,1) conjugates every matrix/quat/vertex"
  - "Compose-then-mirror (not mirror-raw-key) for animation tracks — L(f)=postMul·(key·bindRot·pre) then mirror; raw-key mirror is wrong for non-identity bind (unit-tested)"
  - "ShaderMaterial→MeshStandardMaterial conversion for export only — live viewport retains ShaderMaterial; GLTFExporter warns+drops ShaderMaterial silently"
  - "DXT CompressedTexture CPU-decoded to DataTexture for export — GLTFExporter also rejects CompressedTexture; decodeDxt uses mip0.data.buffer/byteOffset/byteLength sub-view"
  - "SceneCapturer pattern (module-level _capturedScene) — captures THREE.Scene from inside R3F Canvas via useThree().scene; exposed as getLiveScene() for ExportDialog outside Canvas"
  - "Blender-MCP export engine deferred to Phase 6 (bridge) — backlog blender-bridge-mcp"
metrics:
  duration: "~3 hours"
  completed: "2026-06-25T23:21:27Z"
  tasks_completed: 3
  tasks_total: 3
  files_created: 7
  files_modified: 9
  human_verified: "2026-06-25 — glTF export (textures/skeleton/animation/orientation) + Extract (byte-complete SMAT IFF) approved by maintainer"
---

# Phase 2 Plan 05: glTF Export Pipeline + Format Docs Corrections Summary

**One-liner:** glTF (.glb) export with baked X-mirror (compose-then-mirror), ShaderMaterial→MeshStandardMaterial+DXT-decode conversion, raw Extract, and corrected format docs with precise provenance callouts.

## Status: COMPLETE — Task 3 human-verified & approved (2026-06-25)

The maintainer verified the glTF export (correct orientation, textures, skeleton, animation, glowing
eyes) and Extract (byte-complete `SMAT` IFF). Human-verification surfaced **4 real bugs**, all fixed
post-checkpoint via a second 4-AI crew round (CONSULT-P2-05B) — see "Task 3" below. **Phase 2 complete:
VIEW-01 ✓ (02-02), VIEW-02 ✓ (02-03), VIEW-03 ✓ (02-04), VIEW-04 ✓ (this plan).**

## Tasks Completed

| Task | Description | Commit |
|------|-------------|--------|
| 1 | glTF export pipeline (mirrorScene, exportMaterial, buildAnimationClip, buildExportScene, ExportDialog, Extract, store/viewport wiring) + harness test | 7f3fb2f |
| 2 | Correct AI-distilled format docs (SKMG INFO 9×int32, BPMJ v0001/v0002, Skeleton.cpp composition formula, material.skinning r140 fix, glTF export note) | de1504d |

## Task 3 — Human-Verified (APPROVED)

Verified on `protocol_droid_red.sat`: glTF export opens in Blender 4.x with correct orientation, textures,
skeleton, and animation; glowing eyes correct; **Extract** wrote a byte-complete `FORM…SMAT` IFF (285 B,
self-declared length matches file). Approved by the maintainer.

### Bugs found during human-verification (fixed via crew round CONSULT-P2-05B)

The renderer skinned/export path was being exercised on real assets for the first time; 4 bugs surfaced
and were fixed with regression coverage. Crew (Codex/Cursor/Opus/Sonnet) converged from non-overlapping
angles — Codex found the decisive DXT bug *against* the majority read (the de-anchoring win).

| # | Symptom | Root cause | Fix | Commit |
|---|---------|-----------|-----|--------|
| 1 | Stiff legs in exported animation | AnimationClip tracks named by lowercase `.ans` `joint.name`; GLTFExporter binds by EXACT node name → 34/39 limb tracks dropped | Key tracks by the resolved skeleton bone name (`boneData.name`, camelCase). Verified 5→36 animated joints | ec9576c |
| 2 | Whole part glows white | Exported raw EMIS **RGB** (mostly-white); SWG EMIS is an **alpha mask** self-illuminating the diffuse (`swgMaterial.ts:234`) | Bake `emissiveMap.rgb = diffuse.rgb × emis.a`, `emissiveFactor=[1,1,1]` | ec9576c→ea0459b |
| 3 | Placeholder normals/emissive on every material | Read `uNormalMap`/`uEmissiveMap` unconditionally (1×1 placeholder when slot absent) | Gate on `bHasNormal`/`bHasEmissive` shader flags | ec9576c |
| 4 | **Scrambled "cat face"** (the big one) | DXT CPU decode `colorOff - offset` read color blocks ~offset bytes too early when offset≠0 (exporter passes DDS mip offset ~128) → correct alpha, **black/shifted color** | Drop the spurious `-offset`. **Regression test** `dxt-decode-offset.test.ts` (offset-invariance) | ea0459b |

Geometry/mirror/skin were **provably ruled out** (Opus). Residual "lighter/less-glossy than the live
render" is the **expected, deferred** SWG-lighting gap (no glTF-PBR slot for SWG spec/env/ambient model) —
logged with 3 candidate approaches (PBR gloss-map, baked-unlit mode, Blender light rig) in backlog
`export-lighting-fidelity.md`. Crew briefs: `.planning/research/CONSULT-P2-05B-*`.

### Verification basis (standing gate satisfied)
- Maintainer UAT: glTF export + Extract approved.
- `npx vitest run` from repo root: **188/188 green** (incl. new `dxt-decode-offset` RED→GREEN regression
  + `buildAnimationClip-composition` guard).
- `tsc --noEmit` on renderer: clean.
- Byte-level checks: exported `.glb` materials/textures/animation-channels inspected; Extract IFF validated.

---

## Implementation Details

### Task 1: glTF Export Pipeline

**mirrorScene.ts** (`applyXMirror(root: THREE.Object3D): void`)
- Geometry: position.x→-x, normal.x→-nx, tangent (-tx,ty,tz,-w) including w handedness flip, triangle winding reversed (swap index[i+1]/index[i+2])
- SkinnedMesh boneInverses: M' = flip·M·flip via scratch Matrix4
- Bone local transforms: M' = flip·M·flip then decompose → bone.position/quaternion/scale
- No root scale node, no +90° facing rotation, no green-channel invert

**exportMaterial.ts** (`toStandardMaterial(mat): THREE.MeshStandardMaterial`)
- Reads uniforms `uDiffuseMap` (→ .map, SRGBColorSpace), `uNormalMap` (→ .normalMap, linear), `uEmissiveMap` (→ .emissiveMap, sRGB)
- DXT CompressedTexture: `decodeDxt(mip0.data.buffer as ArrayBuffer, mip0.data.byteOffset, mip0.data.byteLength, w, h, fmt)` → DataTexture; `flipY=false`
- SWG specular dropped (no glTF-PBR mapping); roughness=0.7, metalness=0.0

**buildAnimationClip.ts** (`buildAnimationClip(anim, parsedSkeleton): THREE.AnimationClip | null`)
- `composeBoneQuat(keyQuat, bindPoseRot, preMul, postMul)` → `postMul·(key·bindRot·preMul)`
- `mirrorQuat(q)` → `(q.x, -q.y, -q.z, q.w)`
- Per joint: compose at each sparse key frame, then mirror → QuaternionKeyframeTrack
- Translation: union of frames across x/y/z channels, lerp within each, local=bindTrans+delta, mirror x→-x → VectorKeyframeTrack
- Runtime assertion guards against wrong composition order

**buildExportScene.ts** (`buildExportScene(liveScene, parsedSkeleton, opts): THREE.Object3D`)
- `LIVE_SCENE_IS_SWG_NATIVE = true` sentinel documents single-apply decision
- Reconstructs bind-pose skeleton from parsedSkeleton (NOT cloning live animated bones)
- Deep-clones geometry via `geometry.clone()`, converts materials via `toStandardMaterial()`
- Calls `applyXMirror(exportRoot)` exactly once on the export scene clone

**ExportDialog.tsx** — glTF (.glb) only; Skeleton/Animation toggles; 'Y-up · X-mirror applied' coordinate note; AsyncProgress during export; VerificationStatus pass/fail+Retry; Extract… section

**Harness test** (`buildAnimationClip-composition.test.ts`) — 12 tests, 4 describe blocks; critical test proves compose-then-mirror ≠ mirror-then-compose for non-identity bind (the Rank-1 guard)

### Task 2: Format Docs Corrections

| File | Correction |
|------|-----------|
| meshes-and-appearances.md | SKMG INFO: `8× int32` → `9× int32` with provenance callout `SkeletalMeshGeneratorTemplate.cpp:2247-2360` |
| skeletons-and-animation.md | BPMJ: "optional" → "mandatory in v0001; ABSENT in v0002 (BasicSkeletonTemplate.cpp:249-275)" |
| skeletons-and-animation.md | Added Skeleton.cpp:1274-1279 compose-then-mirror callout block in AnimationClip Construction section; clarified "for export" on handedness bullet |
| shaders-and-fx.md | `material.skinning = true (Three.js r152+)` → removed in r140, not r152+; do NOT set in three@0.140.0+ |
| shaders-and-fx.md | Added glTF Export Conversion note: GLTFExporter rejects ShaderMaterial → must convert; DXT rejected → CPU decode; export-only on deep-cloned scene |

---

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed TypeScript ArrayBufferLike cast in exportMaterial.ts**
- **Found during:** Task 1 typecheck
- **Issue:** `TypedArray.buffer` returns `ArrayBufferLike` (includes SharedArrayBuffer); `decodeDxt` requires `ArrayBuffer`
- **Fix:** Added `as ArrayBuffer` cast with explanatory comment
- **Files modified:** `packages/renderer/src/panels/viewport/export/exportMaterial.ts`
- **Commit:** 7f3fb2f (part of Task 1)

**2. [Rule 1 - Bug] Fixed floating-point precision in harness test**
- **Found during:** Task 1 vitest run
- **Issue:** Truncated `0.707` literal for 1/√2 caused `toBeCloseTo` precision mismatch
- **Fix:** Changed to `const HALF_SQRT2 = Math.SQRT2 / 2` (exact IEEE 754 value)
- **Files modified:** `packages/harness/test/buildAnimationClip-composition.test.ts`
- **Commit:** 7f3fb2f (part of Task 1)

---

## Known Stubs

None that block plan goals. The `ExportDialog.tsx` gracefully degrades when `parsedSkeleton` or `parsedAnimation` is null (checkboxes disabled; export still proceeds with geometry only).

---

## Threat Flags

None — no new network endpoints, auth paths, or trust boundary crossings introduced beyond what the plan's threat model documents (T-02-20, T-02-21, T-02-22).

---

## Self-Check: PASSED

- [x] mirrorScene.ts exists at `packages/renderer/src/panels/viewport/export/mirrorScene.ts`
- [x] exportMaterial.ts exists
- [x] buildAnimationClip.ts exists
- [x] buildExportScene.ts exists
- [x] ExportDialog.tsx exists
- [x] harness test exists at `packages/harness/test/buildAnimationClip-composition.test.ts`
- [x] Commit 7f3fb2f in git log (Task 1)
- [x] Commit de1504d in git log (Task 2)
- [x] Three docs files changed (verified via `git diff --stat docs/`)
- [x] TypeScript typecheck passed (verified Task 1)
