---
phase: 02-3d-mesh-viewport-mvp-proof
plan: "05"
subsystem: export-pipeline
status: checkpoint-pending
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
  tasks_completed: 2
  tasks_total: 3
  files_created: 6
  files_modified: 9
---

# Phase 2 Plan 05: glTF Export Pipeline + Format Docs Corrections Summary

**One-liner:** glTF (.glb) export with baked X-mirror (compose-then-mirror), ShaderMaterial→MeshStandardMaterial+DXT-decode conversion, raw Extract, and corrected format docs with precise provenance callouts.

## Status: CHECKPOINT-PENDING (awaiting Task 3 human verification)

Tasks 1 and 2 are committed. Task 3 is a `checkpoint:human-verify gate="blocking"` — the executor STOPPED here per plan. Do not mark Phase 2 complete until the user approves.

## Tasks Completed

| Task | Description | Commit |
|------|-------------|--------|
| 1 | glTF export pipeline (mirrorScene, exportMaterial, buildAnimationClip, buildExportScene, ExportDialog, Extract, store/viewport wiring) + harness test | 7f3fb2f |
| 2 | Correct AI-distilled format docs (SKMG INFO 9×int32, BPMJ v0001/v0002, Skeleton.cpp composition formula, material.skinning r140 fix, glTF export note) | de1504d |

## Task 3 (PENDING — Human Verification)

**What was built:**
- glTF (.glb, rigged+animated, textured) export with BAKED X-mirror on a deep-cloned export scene (ShaderMaterial→MeshStandardMaterial + DXT decompress)
- Raw-asset Extract via `nativeCore.readMountEntry`
- Corrected format docs

**How to verify (verbatim from plan Task 3):**

1. Open a loaded (textured, animated) .sat. Note pose/orientation.
2. Export… → glTF (.glb), check Skeleton + Animation. Note 'Y-up · X-mirror applied'. Export.
3. Confirm "Exporting glTF…" then "✓ exported {file.glb}".
4. Open the .glb (gltf.report or Blender 4.x Import → glTF). Confirm: geometry upright; TEXTURED (diffuse + normal); NOT inside-out (toggle back-face culling in gltf.report — faces stay lit); skeleton present; animation plays.
5. ASYMMETRIC asset (one-shoulder armor / asymmetric creature): confirm CHIRALITY — the asymmetric feature is on the correct side (matches in-game / SIE), normal-map highlights come from the right side (tangent.w check), no inside-out shading. THIS is the X-mirror's empirical proof.
6. Animate an asymmetric limb (one arm): confirm it tracks its correct final position, no mirror-drift (the compose-then-mirror Rank-1 check).
7. Extract… → choose a location → confirm raw bytes written (spot-check size vs source).
8. Review docs: .sat no longer "Skeleton Animation Template"; CKAT/KFAT sparse per-channel; Skeleton.cpp composition documented; precise "(verified … 2026-06-23/25)" callouts; no Texture.cpp:115-129 DDS mis-citation.

**Resume signal:** Type "approved" to finalize Phase 2, or describe any export/docs issues (double-mirror, inside-out faces, inverted normal-map lighting, animation drift, lost textures, docs gaps).

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
