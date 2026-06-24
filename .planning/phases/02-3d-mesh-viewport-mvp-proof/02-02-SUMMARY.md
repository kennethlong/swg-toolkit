---
phase: 02-3d-mesh-viewport-mvp-proof
plan: 02
subsystem: formats/viewport
tags: [SKMG, SKTM, SMAT, APT, R3F, skinned-mesh, appearance-resolver, CORE-05]
dependency_graph:
  requires: [02-01]
  provides: [VIEW-01, CORE-05-skeletal]
  affects: [02-03, 02-04, 02-05]
tech_stack:
  added:
    - "@react-three/fiber 9.6.1 (R3F Canvas + useFrame + useThree)"
    - "@react-three/drei 10.7.7 (OrbitControls + Grid)"
    - "three 0.184.0 (THREE.SkinnedMesh + THREE.Skeleton + THREE.BufferGeometry)"
    - "zustand 5.0.14 (viewportStore)"
  patterns:
    - "SKMG PIDX leading-count: int32 vertexCount + vertexCount×int32 globalPosIdx"
    - "SKMG OITL (v0004): int32 triCount + per-tri (int16 skip + int32×3 indices)"
    - "SKMG TCSD float32 inside FORM TCSF (NOT double)"
    - "SKTM v0001 mandatory BPMJ; v0002 no BPMJ (version-branched)"
    - "APT: FORM APT → FORM 0000 → CHUNK NAME → NUL-terminated redirectTarget"
    - "Three.js skinning auto-enables from skinIndex/skinWeight attributes + bound Skeleton (no material.skinning — removed r140)"
    - "Module-scope scratch objects for GC-safe useFrame (zero allocation)"
    - "D-04 partial resolution: resolver never throws on missing deps"
key_files:
  created:
    - packages/native-core/modules/core/formats/SkeletalMeshGen.h
    - packages/native-core/modules/core/formats/SkeletalMeshGen.cpp
    - packages/native-core/modules/core/formats/Skeleton.h
    - packages/native-core/modules/core/formats/Skeleton.cpp
    - packages/native-core/modules/core/formats/SkeletalAppearance.h
    - packages/native-core/modules/core/formats/SkeletalAppearance.cpp
    - packages/native-core/modules/core/formats/StaticAppearance.h
    - packages/native-core/modules/core/formats/StaticAppearance.cpp
    - packages/renderer/src/state/viewportStore.ts
    - packages/renderer/src/panels/viewport/resolver/appearanceResolver.ts
    - packages/renderer/src/panels/viewport/Viewport.tsx
    - packages/renderer/src/panels/viewport/StaticMeshView.tsx
    - packages/renderer/src/panels/viewport/SkinnedMeshView.tsx
    - packages/renderer/src/panels/viewport/LodPicker.tsx
    - packages/renderer/src/panels/viewport/AppearancePanel.tsx
  modified:
    - packages/native-core/modules/core/CMakeLists.txt
    - packages/native-core/src/mesh_binding.cpp
    - packages/native-core/src/addon.cpp
    - packages/native-core/index.d.ts
    - packages/harness/test/mesh-roundtrip.test.ts
    - packages/renderer/src/panels/ViewportPanel.tsx
decisions:
  - "SKMG PIDX leading-count: oracle SkeletalMeshGeneratorTemplate.cpp:1376-1384 confirmed int32 vertexCount precedes the index array"
  - "SKMG OITL used in v0004 (not ITL): per-triangle int16 occlusionZoneCombinationIdx + int32×3"
  - "SKMG TCSD reads float32 (not double) inside FORM TCSF: oracle :1444 iff.read_float()"
  - "Three.js skinIndex uses Uint16BufferAttribute (converted from Int32 pre-bridge)"
  - "Stats badge labels geometry as 'binary' (not 'zero-copy') — binding memcpys into JS heap"
  - "APT subType is 'APT ' with trailing space (0x41505420)"
  - "SKTM v0001 BPMJ is mandatory (plain enterChunk); v0002 has no BPMJ chunk"
  - "Skeleton quaternion IR: (w,x,y,z) on-disk → THREE.Quaternion.set(x,y,z,w)"
metrics:
  duration: "~4 hours (continued from previous context)"
  completed: "2026-06-24"
  tasks_completed: 2
  tasks_total: 3
  files_created: 15
  files_modified: 6
---

# Phase 02 Plan 02: SKMG/SKTM/SMAT/APT Parsers + R3F Viewport (VIEW-01) Summary

**One-liner:** SKMG/SKTM/SMAT/APT C++ parsers grounded in swg-client-v2 oracle with CORE-05 byte-exact round-trips; R3F Canvas with StaticMeshView + SkinnedMeshView dispatched by isSkinned; appearance resolver with D-04 partial resolution.

## What Was Built

### Task 1: C++ parsers (SKMG/SKTM/SMAT/APT) + CORE-05 fixtures

Four engine-free C++20 parsers grounded against `swg-client-v2` oracle before implementation:

**SkeletalMeshGen.cpp (SKMG v0002/v0003/v0004)**
- INFO: 9×int32 (maxTransformsPerVertex, maxTransformsPerShader, skeletonTemplateNameCount, transformNameCount, positionCount, transformWeightDataCount, normalCount, perShaderDataCount, blendTargetCount) + 4×int16 (occlusionZone counts)
- PIDX: leading int32 vertexCount + vertexCount×int32 globalPosIdx (oracle :1376-1384)
- NIDX: no leading count — uses PIDX's vertexCount directly (oracle :1387-1393)
- OITL (v0004): int32 triCount + per-tri (int16 occlusionZoneCombinIdx + int32×3) (oracle :1229-1278)
- TCSD inside FORM TCSF: float32 UVs (oracle :1444 `iff.read_float()`)
- Security: positionCount cap 1M, perShaderDataCount cap 512, transformWeightDataCount cap positionCount×16
- T-02-08 guard in StaticAppearance.cpp: circular APT indirection rejected

**Skeleton.cpp (SKTM v0001/v0002)**
- v0001: mandatory BPMJ chunk entered/skipped (oracle :280-286)
- v0002: no BPMJ (oracle :363-390)
- Root SLOD rejection guard (delta #7): throws FormatParseError with descriptive message
- Security: bone count cap 2048, acyclic parentIndex validation

**SkeletalAppearance.cpp (SMAT v0001/v0002/v0003)**
- INFO (meshGeneratorCount + skeletonTemplateCount + filename) + MSGN (mesh paths) + SKTI (skeleton+attachment pairs)
- Security: counts capped at 256

**StaticAppearance.cpp (APT)**
- FORM APT → FORM 0000 → CHUNK NAME → NUL-terminated redirectTarget
- APT subType "APT " with trailing space (0x41505420)
- T-02-08: throws if redirectTarget ends with ".apt"

**CORE-05 fixtures (real assets from SWG Infinity client):**
- ackbar_arms_l0.mgn (28296 bytes, SKMG v0004): 357 vertices, multi-PSDT with OITL
- at_at.skt (3534 bytes, SKTM v0002): verified bone hierarchy
- 4lom.sat (204 bytes, SMAT v0003): MSGN + SKTI entries
- arc170_body.apt (63 bytes, APT): redirects to .msh

All 122/122 tests passing (net +12 new SKMG/SKTM/SMAT/APT tests).

### Task 2: TypeScript renderer (viewportStore + resolver + Viewport + mesh views)

**viewportStore.ts:** Zustand 5 store with loadStatus, resolution, parsedMesh/Skeleton, isSkinned (drives view dispatch), selectedLod, renderMode, customizationIndices, transportState; source-entry fields (sourceMountHandle, sourceArchiveIndex, sourceEntryIndex, sourceEntryPath) for Extract in 02-05.

**appearanceResolver.ts:** D-03 smart-open by extension:
- `.sat` → 'composed' (skinned): parseSkeletalAppearance → MSGN/SKTI → resolve skeleton first for boneOrder → parseSkeletalMesh with boneOrder
- `.apt` → 'composed-static' (static): parseStaticAppearance → redirect → dispatch by extension
- `.mgn` → 'leaf' (skinned)
- `.msh` → 'leaf' (static)
- D-04: never throws — missing[] list, null placeholders
- T-02-09: path-injection guard (drive-letter/absolute/'..' rejected before resolveEntry)
- Texture bytes plumbed per slot (slotBytes ArrayBuffers) for 02-03 CompressedTexture

**Viewport.tsx:** R3F Canvas; 3-point lighting (key/fill/rim + ambient); OrbitControls + Grid; dispatches to StaticMeshView (isSkinned=false) or SkinnedMeshView (isSkinned=true); stats collector via gl.info.render.

**StaticMeshView.tsx:** THREE.Mesh per PSDT group from MeshAttributeSlice offsets; Uint32 indices (NOT Uint16); Float32 pos/norm/uv; computeVertexNormals when absent.

**SkinnedMeshView.tsx:** THREE.SkinnedMesh per group sharing one THREE.Skeleton; bones built from parsedSkeleton with (w,x,y,z)→(x,y,z,w) quaternion reorder; skinning auto-enables from attributes + bind(); NO material.skinning (removed r140); module-scope scratch _scratchQuat/_scratchVec3/_scratchMat4 (GC contract D-09).

**LodPicker.tsx:** per-level rows with 2px accent selection; generatorPath, minDist/maxDist.

**AppearancePanel.tsx:** open-mode indicator, resolved/missing graph (VerificationStatus), missing-deps banner, leaf stub buttons.

**ViewportPanel.tsx:** Viewport at z-index:1 under chips; empty/loading/error states; stats badge reads `binary` (not `zero-copy`); side-panel toggle for LodPicker + AppearancePanel.

### Task 3: checkpoint:human-verify (STOPPED — awaiting user verification)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] SKMG PIDX parsing: leading vertexCount**
- **Found during:** Task 1 — initial test showed 0 vertices in parseSkeletalMesh output
- **Issue:** Treated entire PIDX chunk as flat int32 array; actual format has leading int32 vertexCount before the index array
- **Fix:** Read `int32_t pidxVertexCount = pidxCv.readI32LE()` then read pidxVertexCount indices
- **Oracle:** SkeletalMeshGeneratorTemplate.cpp:1376-1384
- **Files:** SkeletalMeshGen.cpp

**2. [Rule 1 - Bug] SKMG NIDX: no leading count**
- **Found during:** Task 1 — same PIDX investigation
- **Issue:** Read a leading int32 from NIDX which is not there; NIDX uses PIDX's vertexCount
- **Fix:** Use pidxVertexCount directly; skip the readI32 from NIDX
- **Oracle:** SkeletalMeshGeneratorTemplate.cpp:1387-1393
- **Files:** SkeletalMeshGen.cpp

**3. [Rule 1 - Bug] SKMG v0004 uses OITL not ITL**
- **Found during:** Task 1 — no triangles in geometry output
- **Issue:** v0004 per-shader data uses OITL (Occluded ITL) with an additional int16 per triangle; looking only for ITL tag found nothing
- **Fix:** Added parseOitl() function; updated PRIM processing to handle both ITL and OITL tags; OITL: int32 triCount + per-tri (int16 occlusionZoneCombinIdx + int32×3)
- **Oracle:** OccludedIndexedTriListPrimitive::load_0002 :1229-1278
- **Files:** SkeletalMeshGen.cpp

**4. [Rule 1 - Bug] SKMG TCSD reads float32 inside FORM TCSF**
- **Found during:** Task 1 — UV data empty
- **Issue:** TCSD is inside FORM TCSF (not a direct child of PSDT); TCSD data is float32 (not double)
- **Fix:** Look for TCSF child form then TCSD leaf; use readF32() not memcpy/double
- **Oracle:** SkeletalMeshGeneratorTemplate.cpp:1427-1451 `iff.read_float()`
- **Files:** SkeletalMeshGen.cpp

**5. [Rule 1 - Bug] APT synthetic test buffer overflow**
- **Found during:** Task 1 — APT synthetic test threw RangeError offset out of bounds
- **Issue:** Buffer size calculation was wrong — aptBodyLen included the subType in the length field but the buffer computation didn't account correctly
- **Fix:** Recalculated all buffer sizes from scratch with proper header accounting
- **Files:** mesh-roundtrip.test.ts

**6. [Rule 2 - Missing] CORE-05 registerFormat gate in beforeAll**
- **Found during:** Task 1 commit review — plan required registerFormat calls
- **Fix:** Added beforeAll() block with registerFormat for mesh-skmg/mesh-sktm-v2/mesh-smat/mesh-apt; added `registerFormat` import and `beforeAll` from vitest
- **Files:** mesh-roundtrip.test.ts

**7. [Rule 2 - Missing] Full Phase 02-01+02-02 types in index.d.ts**
- **Found during:** Task 2 — native-core/index.d.ts lacked all format types
- **Fix:** Added full type declarations for MeshAttributeSlice, MeshShaderGroup, MeshParseResult (02-01), SkeletalMeshParseResult, SkeletonParseResult, SkeletalAppearanceParseResult, StaticAppearanceParseResult (02-02)
- **Files:** packages/native-core/index.d.ts

**8. [Rule 1 - Bug] Three.js r0.184 gl.info.render has no 'vertices' field**
- **Found during:** Task 2 typecheck
- **Issue:** TypeScript error: Property 'vertices' does not exist on render info type
- **Fix:** Changed to `gl.info.memory?.geometries ?? 0` for the vertex count proxy
- **Files:** Viewport.tsx

## Deferred Items

None — all plan items completed through Task 2. Task 3 requires human verification.

## Known Stubs

- `SkinnedMeshView.tsx`: `MeshStandardMaterial` placeholder material (color="#888888") — replaced by 02-03 with real CompressedTexture from shader slots
- `StaticMeshView.tsx`: Same placeholder material — replaced by 02-03
- `AppearancePanel.tsx`: "Attach skeleton…" / "Attach animation…" buttons are disabled stubs — wired in 02-04
- `Viewport.tsx`: `frameloop="demand"` — scene only re-renders on camera events or state changes; animation playback in 02-05 will switch to `frameloop="always"`
- `viewportStore.ts`: `fps` in stats overlay is approximate (frame-count accumulation over 1s windows) — improve in 02-05

## Threat Surface Scan

No new threat surface beyond what the plan's threat model covers:
- T-02-06: SkeletalMeshGen.cpp count caps — implemented
- T-02-07: PIDX/NIDX OOB guard — implemented  
- T-02-08: APT circular redirect guard — implemented (StaticAppearance.cpp + T-02-08 test)
- T-02-09: Path injection in appearanceResolver.ts — implemented (isUnsafePath guard)
- T-02-10: Bone order name-keyed (XFNM→skeleton name→index) — implemented
- T-02-11: APT path count cap 64, string cap 512 — implemented

## Gap Fix (post-checkpoint)

**Date:** 2026-06-24
**Commits:** a8900b4, 98ca401, e082e67, 4e74447

### What Was Missing

A read-only trace after the checkpoint identified that the entire open→render pipeline was dead code. Opening a `.msh/.mgn/.sat/.apt` from the TRE VFS browser drove the IFF store but never touched the viewport store, so `parsedMesh` stayed null forever and the Canvas rendered nothing (grid + lights only).

Three layered bugs:

**PRIMARY (pipeline never called):** `TreVfsBrowser.handleSelectEntry` only called `iffStore.beginParse/parseComplete`. `viewportStore.beginLoad`, `resolveAppearance`, and `viewportStore.loadComplete` had zero call sites. Fix: added mesh-extension detection (`MESH_EXTENSIONS = {msh, mgn, sat, apt}`), then for matching entries: `beginLoad()` → `await resolveAppearance()` → `loadComplete(filename, mode, resolution, isSkinned, parsedMesh, parsedSkeleton)`.

**SECONDARY (auto-fit was fake):** `StaticMeshView.useAutoFrame` only called `expandByPoint(0,0,0)` — never read actual vertices; camera always parked at `dist=3`. `SkinnedMeshView.useAutoFrame` hardcoded `camera.position.set(3,2,3)`. SWG meshes are frequently large/off-origin → outside the frustum → invisible. Fix: read actual `Float32Array` positions from the geometry `ArrayBuffer` using `MeshAttributeSlice` offsets across ALL shader groups, compute `THREE.Box3 → getBoundingSphere()`, then set camera distance as `(radius / sin(fovRad/2)) * 1.2` (20% FOV-based margin). Applied to both views. Call `invalidate()` to repaint in demand mode.

**TERTIARY (LOD always index 0, missing[] not surfaced):** `SceneContent` always read `resolution?.meshes[0]?.geometry`, ignoring `selectedLod`. Fix: index as `resolution?.meshes[selectedLod] ?? resolution?.meshes[0]`; use `lodMesh.parseResult` for the active `MeshParseResult`. Added `LoadInvalidator` (inside Canvas) to call `invalidate()` when `loadStatus` transitions to `done` in `frameloop="demand"`. Added `MissingDepsOverlay` (HTML, outside Canvas) that shows a `⚠` banner when `resolution.missing.length > 0`, rendered in `ViewportPanel` when `isDone`.

### Why It Was Missing

The plan built all the components correctly in isolation (viewportStore actions exist, resolver works, mesh views render) but the plan's Task 2 never connected the TRE browser selection event to the viewport pipeline. The integration point — the `handleSelectEntry` callback — was the only missing link. The 122 existing tests passed because none asserted end-to-end from "select entry" → "store has parsedMesh".

### Integration Test Added

`packages/harness/test/viewport-wiring.test.ts` — 7 tests exercising the full `beginLoad → loadComplete → parsedMesh-non-null` state machine, `selectedLod` array indexing, `resolution.missing[]` preservation for ⚠ display, error state, and reset.

### Auto-fit Margin Decision

1.2× FOV-based margin (20% padding): `dist = (radius / sin(fov/2)) * 1.2`. This ensures the bounding sphere fits the frustum with visual breathing room. The "Frame" chip in 02-04 will let users re-fit interactively.

### LOD Default

`selectedLod = 0` (store initial value, reset on each new load). This is the highest-detail level in SWG's LOD ordering, which is the correct inspector default. The LodPicker lets users switch.

## Self-Check: PASSED

Files created verified:
- packages/native-core/modules/core/formats/SkeletalMeshGen.{h,cpp} — FOUND
- packages/native-core/modules/core/formats/Skeleton.{h,cpp} — FOUND
- packages/native-core/modules/core/formats/SkeletalAppearance.{h,cpp} — FOUND
- packages/native-core/modules/core/formats/StaticAppearance.{h,cpp} — FOUND
- packages/renderer/src/state/viewportStore.ts — FOUND
- packages/renderer/src/panels/viewport/resolver/appearanceResolver.ts — FOUND
- packages/renderer/src/panels/viewport/Viewport.tsx — FOUND
- packages/renderer/src/panels/viewport/StaticMeshView.tsx — FOUND
- packages/renderer/src/panels/viewport/SkinnedMeshView.tsx — FOUND
- packages/renderer/src/panels/viewport/LodPicker.tsx — FOUND
- packages/renderer/src/panels/viewport/AppearancePanel.tsx — FOUND

Commits verified:
- 86df5b6 — test(02-02): CORE-05 round-trip + RED/GREEN for SKMG/SKTM/SMAT/APT
- 61810e5 — feat(02-02): wire R3F viewport + appearance resolver + skinned/static mesh views

Test suite: 122/122 passing (pnpm vitest run from root)
TypeScript: 0 errors (npx tsc --noEmit in packages/renderer)
