# Handoff — Phase 2 (3D Mesh Viewport), Wave 4 (02-04 Animation): skinned-render blocker

**Date:** 2026-06-25 · **Status:** Phase 2 at 80% — 02-01/02/03 done & verified; 02-04 (animation)
tasks 1–2 done & byte-exact-verified, at human-verify checkpoint, **BLOCKED** on a skinned-`.sat`
render bug. 02-05 (export) not started.

---

## TL;DR — where to resume

The `.ans` animation pipeline (parser + transport + sampler) is built and the **byte-exact decoder
is proven**. But loading any **skinned `.sat`** (e.g. `protocol_droid_red.sat`, `ackbar.sat`)
**locks up the UI** (can't click anything) and renders nothing. The native data is 100% valid —
the bug is purely in the renderer's **skinned-render path (`SkinnedMeshView.tsx`)**, which was
**never actually exercised** until now because a `FORM SLOD` skeleton-parse bug (now fixed) meant
no skinned mesh ever got a working skeleton.

**Resume by:** (1) get the DevTools console error (`Ctrl+Shift+I` → Console) on loading
`protocol_droid_red.sat` — the in-app Console/Log tabs are inactive (UX gap); (2) fix the
skinned-render bugs below; (3) verify animation with `ackbar.sat` + `all_b_emt_wave1`; (4) close
02-04; (5) do 02-05 (export).

---

## THE ACTIVE BUG (top priority)

**Symptom:** Clicking a skinned `.sat` in the Assets browser **freezes the whole UI** (hard
main-thread lockup) and shows nothing. Static path (`.msh` / `.apt→.lod→.msh`) works fine.

**VERIFIED GOOD (native — do not re-investigate):** For `protocol_droid_red.sat` the full native
chain produces valid data (traced headlessly):
- `parseSkeletalAppearance` → meshPaths=`[appearance/mesh/protocol_droid_red.lmg]`,
  skeletonRefs=`[protocol_droid.skt]`
- `protocol_droid.skt` → **39 bones**, clean hierarchy (root=bone0 parent=-1, **NO cycle**,
  no self-parent, no out-of-range parent — ruled out as the lockup cause)
- `.lmg` → `parseMeshLod` → 4 LODs → `l0.mgn` → `parseSkeletalMesh` → 3 groups, 2790 verts,
  geometry 238104 B, skinIndices+skinWeights present, uvs is an array, **needsBoneRemap=false**,
  mesh boneNames=36 (subset of the 39), sktmNames=1.
So `resolveAppearance` returns: mode `composed`, isSkinned=true, 39-bone ResolvedSkeleton, meshes,
materials. The data is complete and correct.

**ROOT-CAUSE ANALYSIS (renderer — from a sub-agent investigation, cross-verified vs THREE r0.184):**
1. **Bones never added to the scene graph (confirmed).** `SkinnedMeshView.tsx` renders
   `<skinnedMesh ref geometry material frustumCulled />` (line ~482) and calls
   `meshRef.current.bind(skeleton)` in a useEffect (line ~435), but the skeleton's **root bone tree
   is never added** to the mesh or scene (no `<primitive object={skeleton.bones[0]} />`). Only a
   `SkeletonHelper` is added (line ~820), not the bones themselves. Without the bones in the graph
   with computed world matrices, `bind()`→`calculateInverses()` captures **identity boneInverses**
   → GPU skinning collapses the mesh to origin (effectively blank). THREE's required pattern is
   `mesh.add(skeleton.bones[0]); mesh.bind(skeleton)` with `updateMatrixWorld(true)` on the bone
   tree BEFORE bind. **This fix is needed regardless.**
2. **The UI LOCKUP is a separate/compounding issue.** A bind-pose collapse alone would NOT freeze
   the UI. Prime suspect for the lockup: a **render loop** — line ~820 creates
   `new THREE.SkeletonHelper(...)` **inline in JSX on every render** (a fresh object each render →
   R3F re-attaches/disposes every render). Combined with `useSkeletonHelper` (effect at ~755 also
   makes a SkeletonHelper) and the bind effect, this may storm re-renders. INVESTIGATE the JSX
   render path for an object-identity-changes-every-render loop. (Also check: the bind useEffect
   deps; `buildSkinnedGroupMaterial`/`buildSkeleton` memo identity; whether `loadComplete` causes a
   store→render→store cycle.)
3. **Possible 2nd bug — skinned material GLSL.** `buildSwgMaterial({skinned:true})` hand-injects
   `#include <skinning_pars_vertex>`/`<skinning_vertex>`; if that fails to compile you'd see a
   `THREE.WebGLProgram` error in DevTools. Match against the actual console output.

**Console signatures to disambiguate (ask user / check DevTools):**
- mesh visible but explodes on scrub → bind/inverse bug only
- `THREE.WebGLProgram` shader error → skinned GLSL compile (swgMaterial.ts)
- JS stack trace / React error boundary → exception in buildSkeleton/bind/geometry
- frozen UI / clean console → render-loop (the inline SkeletonHelper) — **this matches the lockup**

**Files:** `packages/renderer/src/panels/viewport/SkinnedMeshView.tsx` (buildSkeleton ~84,
SkinnedGroup ~408, bind ~435, `<skinnedMesh>` ~482, useAnimationSampler ~517, useSkeletonHelper
~755, main render ~789–830 incl. the inline `new THREE.SkeletonHelper` at ~820),
`packages/renderer/src/panels/viewport/material/swgMaterial.ts` (skinned vertex shader),
`Viewport.tsx` (static-vs-skinned dispatch, meshes[selectedLod]).

**ALSO (lower priority, multi-part appearances like ackbar):**
- Composed `.sat` branch (`appearanceResolver.ts` ~579–631) uses **only `skeletonRefs[0]`** (ignores
  attached skeletons like `mon_m_face` at "head") and **flattens multi-part `.lmg` meshes into the
  LOD array** (`allMeshes.push(...lodResult.meshes)` ~609) — so a 3-body-part `.sat` (ackbar) becomes
  [part1_l0..l3, part2_l0..l3, part3_l0..l3] and the viewport renders only `meshes[selectedLod]` = one
  LOD of one part. Multi-part skinned meshes need ALL parts rendered together at the selected LOD.

---

## Phase 2 progress (what's DONE)

- **02-01** ✓ — R3F stack, contracts, C++ static `.msh`/`.lmg`/`.ldt`/`.sht`/`.pal`/`.dds` parsers, harness.
- **02-02** ✓ (VERIFIED) — SKMG/SKTM/SMAT/APT parsers, resolver, Static+Skinned views, `.apt→.lod→.msh`
  (DTLA `.lod` added as a gap-fix). Geometry proven byte-identical to `io_scene_swg_msh`.
- **02-03** ✓ (VERIFIED vs SIE) — custom SWG ShaderMaterial, DDS (incl. compressed cube), customization,
  MaterialInspector. Materials match SIE ("super close"); remaining lighting/tone parity → backlog.
- **02-04** ◆ (checkpoint, BLOCKED) — `.ans` parser (CKAT-0001 + KFAT-0003; KFAT-0002 declined) with
  **verbatim CompressedQuaternion port**, byte-exact round-trip confirmed on real `all_b_emt_wave1.ans`
  (CKAT) and `astromech_emt_greet.ans` (KFAT). AnimationTransport UI + ref-clock zero-GC sampler built.
  **Blocked by the skinned-render bug above** — the animation can't be seen until skinned `.sat` renders.
- **02-05** ○ — glTF/COLLADA export + raw extract (not started).

Commits this session: `0324819`→`7cf1dfc` (see `git log`). 171 tests pass (1 env-flaky:
`resolve-prebuild` EPERM on fresh cmake-js build — ignore). SLOD fix = `5a8baac`.

---

## KEY FACTS / DECISIONS (so they're not re-derived)

- **~6 native-binding ↔ @swg/contracts field-shape mismatches shipped silently this phase**, each a
  runtime bug, ALL NOW FIXED + guarded by `packages/harness/test/contract-conformance.test.ts` (R1–R5):
  `resolveEntry.found` (→winner/tombstone), shader `slotTag`(→slot), DDS per-mip `format`(→top-level)
  + missing `isCubemap`, mesh `uvs` single-object (→array), and the env-mask. **Whenever you add a
  binding (incl. 02-05), add a conformance guard.** The UV one (uvs not an array → all textures sampled
  the (0,0) texel) was the worst — it masked the entire material look.
- **SLOD skeletons:** real character skeletons are `FORM SLOD` (multi-LOD): `SLOD → FORM 0000 →
  INFO + FORM SKTM ×LOD`. `parseSkeleton` now unwraps to LOD 0 (first SKTM = most bones). Direct
  `FORM SKTM` (face skeletons, e.g. mon_m_face) unchanged. Fix in `Skeleton.cpp`.
- **protocol_droid_red color:** red is BAKED in the diffuse (`c3po_red_all.dds` mean `[128,72,84]`,
  saturation 0.44 — a muted maroon). Material=white, no texture-factor, no vertex color (vbformat
  0x1105), SSHT not CSHD. The "brown" was OUR pipeline: a flat env LERP washing it. Fixed by
  highlight-gating env (`mix(lit, env, envMask*specInt)`) + sRGB on diffuse. Remaining SIE gap =
  lighting/tone → backlog. (4-AI crew verified — no hidden red in the bytes.)
- **Real shader math (from extracted `.psh` HLSL):** body shaders (`*_aes17`) =
  `result = lerp(diffuseLitSurface, envColor, envMask) + spec`, envMask=MAIN.alpha (~0.27);
  emissive is `+emisMask` INSIDE the diffuse-light saturate (self-illum floor), not an additive
  pass. Env relief = env_theed cube reflection masked by spec (NO body normal map exists).
- **.eft effect:** `FORM EFCT` parser added (`parseEffect`); supplies blend state + (TODO) PTXM
  sampler roles (currently `samplers:[]` — known gap, tracked). `.psh`/`.vsh` are compiled DX
  bytecode — DO NOT try to interpret; approximate in GLSL.
- **TRE perf:** mount is fast (~835ms native for 244k entries / 27 archives). The >1min hang was an
  **unvirtualized VfsTree** (244k rows) — now virtualized (ROW_HEIGHT=30, OVERSCAN=8). Entries cross
  the bridge as ONE columnar ArrayBuffer (`getMountEntriesColumnar`), not 250k Napi::Objects.

---

## TEST TARGETS & HOW TO REPRODUCE

- **Full TRE set:** `D:\SWG Infinity\SWG Infinity\Live\` (27 `.tre`, ~245k entries). Load-order in
  `swgemu_live.cfg` (mount lowest-priority first → highest last; last-mounted wins).
- **Animation test (once skinned render is fixed):**
  - `appearance/ackbar.sat` (skeleton `all_b.skt`, 38 bones) → picker shows `all_b_*` →
    `all_b_emt_wave1` (CKAT compressed, clear arm wave). Alt: `all_b_emt_salute1`,
    `all_b_dnc_musician_gong_dance_slow`.
  - KFAT path: `astromech_emt_greet.ans` / `bantha_emt_stand_threaten.ans` (KFAT 0003).
  - Simpler single-part subject (currently locks up): `protocol_droid_red.sat` (1 skel + 1 mesh).
- **Correct workflow:** open the `.SAT` first (loads mesh+skeleton), THEN pick the `.ans` from the
  AnimationTransport bar — do NOT open the `.ans` directly (it has nothing to animate).
- **Headless repro (no GUI):** `require('D:/Code/SWG-Toolkit/packages/native-core')`,
  `mountSearchableAsync(paths, prios)`, `resolveEntry`/`readMountEntry`/`parseIff`/`parseSkeleton`/
  `parseSkeletalMesh`/`parseMeshLod`/`parseSkeletalAppearance`. (Scratch scripts were in
  `%TEMP%/*.mjs` this session — recreate as needed.)

---

## WORKFLOW NOTES (gotchas)

- **App = `pnpm start`** (NOT `pnpm dev` — executors keep saying dev; it's start). Electron Forge.
- **Native rebuild needs the app CLOSED** — `swg_native_core.node` is locked while running
  (`LNK1104`). Build: `cd packages/native-core && npm run build`.
- **In-app Console/Log tabs are INACTIVE** (not wired — a UX gap to fix; logged below). Use Electron
  **DevTools** (`Ctrl+Shift+I` → Console) for runtime errors.
- **Real assets are gitignored** (`fixtures-real/`); uncommitted `fixtures-real/animation/` holds the
  02-04 CKAT+KFAT round-trip fixtures (4 files, extracted this session).
- **Cross-AI crew (`CLAUDE.md`)** paid off hugely this session — Sonnet (holistic) found the UV bug,
  Opus (math, extracted real HLSL) found the env-mask + asset-is-maroon truth, all 4 converged on the
  cube-construction + colorspace fixes. Use it for the next hard format/render question. Lead with
  measured ground truth as LOCKED axioms; fan on different angles. Consult briefs are in
  `.planning/research/CONSULT-*.md` (the big `.out` files are gitignored).

---

## TRACKED ITEMS

**Todos (`.planning/todos/pending/`):** eft-parser-completion (PTXM samplers + activate CORE-05
fixture), viewport-default-facing-axis (camera azimuth vs SIE), viewport-shader-blend-mode (.eft
alpha-test/blend for foliage/glass), statusbar-mesh-name-stale, (tre-mount-perf = DONE).
**NEW to add:** in-app Console/Log tabs inactive (use DevTools for now); the multi-part/multi-skeleton
`.sat` composition bug (ackbar).

**Backlog (`.planning/backlog/`):** material-rendering-fidelity (`VIEW-MAT-FIDELITY` — lighting rig
"steal the real swg-client-v2 client rig", tone/exposure, .eft samplers, CSHD palette, blend modes,
DOT3 tangent pool), repository-tree-view (`UI-REPO-TREE` — tabbed TRE structure tree).

---

## IMMEDIATE NEXT STEPS (resume order)

1. Reproduce the lockup, capture DevTools console (match the 4 signatures above).
2. Fix `SkinnedMeshView`: (a) add the bone tree to the scene (`<primitive object={skeleton.bones[0]} />`
   ONCE, shared) + `updateMatrixWorld(true)` before `bind()`; (b) stop creating
   `new THREE.SkeletonHelper` inline every render (memo/ref it, gate on visibility) — the likely
   lockup cause. Renderer-only → Ctrl+R, no rebuild.
3. Verify skinned bind-pose renders (protocol_droid_red.sat), then animation (ackbar.sat +
   all_b_emt_wave1), then a KFAT one. Then `approved` → close 02-04 (roadmap.update-plan-progress 02
   02-04 complete).
4. Fix the multi-part/multi-skeleton composition (ackbar) — or track it.
5. Start 02-05 (export). Add a conformance guard for any new binding.
