# Handoff — Phase 2: skinned animation + material fidelity COMPLETE; next = 02-05 export

**Date:** 2026-06-25 · **Status:** Phase 2 ~90%. 02-01/02/03 done & verified. **02-04 (animation)
fully unblocked & working** (skinned `.sat` render + multi-part + multi-skeleton + playback). A full
**material-fidelity pass** landed on top. All committed AND pushed to `origin/main`
(`9152231`→`5b15cc6`). **02-05 (export) NOT started** — that's the next workstream.

---

## TL;DR — where to resume

The prior blocker (skinned `.sat` UI lockup) and everything after it is **DONE**. Skinned characters
load, render, and animate correctly — single-part (`protocol_droid_red.sat`), multi-part + attached
face skeleton (`ackbar.sat`), bipeds with clothing/armor, creatures. Materials are close to in-game
(spec, CSHD, normal maps, shadow floor).

**Resume by starting 02-05 (glTF/COLLADA export + raw extract)** — the last unstarted Phase 2 piece.
Or pick a `VIEW-MAT-FIDELITY` backlog item (all non-blocking polish). Nothing is broken.

**Verify current state quickly:** `pnpm start`, open `ackbar.sat` → renders whole, pick `all_b_*`
animation → animates. Open `han_solo.sat` → skin not over-shiny, face clean at all zooms. 175 tests
pass (`npx vitest run` from repo root).

---

## What got DONE this session (two committed milestones)

### Commit `c83f8f6` — skinned animation end-to-end (02-04)
Fixed the whole chain, each crew-verified vs `../swg-client-v2`:
1. **UI freeze on skinned load** — was the `.ans`-picker doing `searchMount`+`listMountEntries`
   (full-archive N-API marshal) per hit; replaced with an in-memory `vfsEntries` filter (`TreVfsBrowser`).
2. **Bind-pose collapse** — mount the skeleton root bone in the scene graph once + `updateMatrixWorld`
   before `bind()` so inverse-bind is captured against the real rest pose.
3. **Playback** — keep the demand frameloop alive while playing (`state.invalidate()`).
4. **Joint composition** — `localRot = postMul·(anim·bindPoseRot·preMul)`, additive translation
   (`bind + delta`), static rotations/translations, SATCCF translation bits 3/4/5. **BPRO was mis-read
   as 3 floats — it's a 4-float bind-pose ROTATION quaternion** (Skeleton.cpp/.h fixed).
5. **Case-insensitive bone matching** (CrcLowerString) in native remap AND the sampler — fixed 31/36
   mis-bound limb bones (stiff legs).
6. **Multi-part + attached skeleton** (`ackbar`) — `resolver/mergeSkeletons.ts` merges all skeletonRefs
   (attach-order concat, reparent attached root to its attach bone case-insensitively); resolver emits
   `parts[]`; `SkinnedMeshView` renders all parts at the shared LOD sharing ONE merged skeleton.
7. **Animated white seams** — skin the normal (`<skinnormal_vertex>`) in world space + renormalize;
   gate spec by NdotL.

### Commit `5b15cc6` — material-fidelity pass (02-03 polish)
A 5-bug chain found testing characters, each pinned by **measuring bytes** (the crew repeatedly
falsified the elegant hypothesis):
1. **Over-shiny skin** → apply MATL `specularColor`+`specularPower` (was full-white). MATL = MATS→FORM
   0000→MATL, 68 B, 4×ARGB(A,R,G,B)+power; field order ambient/diffuse/**emissive**/**specular**/power.
2. **Stormtrooper white** → CSHD wraps a full SSHT; `parseShader` now recurses into it (`parseSshtBody`
   + `findNestedSsht`). (Palette/textureFactor tint = tracked CSHD follow-up.)
3. **DXT1 face brighter than body** → DXT1 has no alpha; its 1.0 isn't a gloss mask. Gate spec mask on
   real-alpha-channel, else moderate default (~0.5).
4. **Dark side crushed** → ambient floor 0.30→0.40 (NdotL scale 0.70→0.60, lit side unchanged).
5. **Distance-dependent face pattern** → **uncompressed RGBA8 normal maps had NO upload path → rendered
   as 1×1 MAGENTA** (constant bogus normal). Added the RGBA8 path in `ddsTexture.ts` with **B↔R swizzle**
   (D3D9 BGRA on disk) + GPU mipmaps (trilinear) + anisotropy. Fixes normal mapping on EVERY character.
   Plus a spec-normal taming (`mix(geoN,N,0.55)`) and a normal-map LOD fade as insurance.

**Memories written:** `swg-skeletal-animation-composition`, `swg-material-pipeline` (in the auto-memory).

---

## KEY FACTS / DECISIONS (so they're not re-derived)

- **Custom ShaderMaterial ignores THREE lights.** All shading is in `swgMaterial.ts` from a single
  hardcoded `lightDir=(1,1,0.5)` + ambient floor 0.40. The `Viewport.tsx` 3-point rig affects nothing.
- **LKUP / `specular_lookup` is DEAD** in `a_specmap_bump_ps20` (real PSRC: only s0=diffuse, s1=normal).
  Do NOT implement it — legacy fixed-function baggage. (We nearly did; ground truth stopped us.)
- **CSHD** = `CSHD→0001→SSHT→…` (nested full SSHT) + CSHD customization (TFAC/MATR/TXTR palette, NOT parsed).
- **Real diffuse lighting** = `calculateHemisphericLighting` (key→tangent→back gradient) + `vertexDiffuse`
  (ambient+fill+bounce ≈0.38-0.42), scene-derived colored ambient. A neutral greyscale hemispheric model
  collapses to our raised floor — full model needs scene color (deferred).
- **Skeleton bind pose** (verified): `.skt` chunks RPRE(preMul,4f quat), RPST(postMul,4f), BPTR(trans,3f),
  **BPRO(bind-pose rotation, 4f quat)**. Rest pose = `postMul·bindPoseRot·preMul`.
- **DDS uncompressed** = D3D9 A8R8G8B8 = **BGRA byte order on disk** (swizzle B↔R for THREE).
- **Conformance guards** exist for native↔contract field shapes (`contract-conformance.test.ts`,
  R1-R6 incl. BPRO=4 and material). **Add a guard for any new binding field.**

---

## BUILD / RUN / TEST (gotchas)

- **App = `pnpm start`** (Electron Forge), NOT `pnpm dev`.
- **Native rebuild needs the app CLOSED** (`swg_native_core.node` locks → LNK1104):
  `cd packages/native-core && npm run build`. Use the Bash/PowerShell tool with
  `$env:PATH = "C:\Program Files\nodejs;$env:PATH"` first.
- **Contracts must be rebuilt** after editing `packages/contracts/src/*` so renderer/harness see new
  types: `cd packages/contracts && npm run build`.
- **Renderer-only changes** (GLSL, .tsx) → just Ctrl+R in the running app; no rebuild.
- **Tests:** `npx vitest run` from **repo root** (not the package dir). 175 pass.
- **Real assets gitignored** (`packages/harness/fixtures-real/`, incl. `fixtures-real/animation/`).
  Test TREs: `D:\SWG Infinity\SWG Infinity\Live\` (27 `.tre`).
- **Headless repro:** `require('D:/Code/SWG-Toolkit/packages/native-core')`, `mountSearchableAsync`,
  `resolveEntry`/`readMountEntry`/`parseIff`/`parse{Skeleton,SkeletalMesh,SkeletalAppearance,MeshLod,
  Shader,Dds,Animation}`. (Scratch scripts went to `%TEMP%/*.mjs` — recreate as needed.)

---

## NEXT: 02-05 (export) — not started

glTF/COLLADA export + raw extract. Suggested first moves:
- Scope: glTF for geometry + skeleton + skinning + animation (we have all parsed); raw extract for
  arbitrary TRE entries (source-entry fields already on `viewportStore`: mountHandle/archive/entry/path).
- Check what the parse results already provide to feed an exporter before writing code; plan first
  (per `feedback-pause-after-plan-phase` — do NOT auto-advance to execute, offer cross-AI plan review).
- Then `roadmap.update-plan-progress 02 02-04 complete` if not already, and start 02-05.

---

## TRACKED ITEMS

**Backlog `material-rendering-fidelity.md` (`VIEW-MAT-FIDELITY`)** — all non-blocking polish:
1. **Full hemispheric lighting** (the main residual) — needs scene-derived colored ambient/back +
   fill wired into the shader (uniforms; our material ignores the THREE rig). Interim = raised floor.
4. **CSHD customization palette** — TFAC/MATR/TXTR → `.pal` tint (stormtrooper renders its base texture
   now, but not the palette-driven white tint).
9. **EMIS-crush bug** — emissive folded inside the diffuse clamp destroys lit-region detail on glow
   assets; make it post-clamp additive. (Not yet seen on a real asset; file when one is tested.)
   Plus: tone/exposure, .eft PTXM samplers, DOT3 authored-tangent pool, default camera facing.

**Todos `.planning/todos/pending/`:** eft-parser-completion, inapp-console-log-tabs-inactive,
statusbar-mesh-name-stale, viewport-default-facing-axis, viewport-shader-blend-mode.
(`skinned-multipart-composition` → moved to `completed/` this session.)

---

## CROSS-AI CREW (paid off hugely again — see CLAUDE.md)

This session ran ~7 crew rounds. The pattern that worked: **lead with measured ground truth as LOCKED
axioms, fan 4 consultants on non-overlapping angles, and let Sonnet's headless byte-measurements falsify
the elegant hypotheses** (LKUP ramp, detailed-normal TBN, hemispheric model were all wrong; the real
causes were a magenta fallback, a missing alpha channel, a parse gap). Briefs are committed in
`.planning/research/CONSULT-{SKEL,MP,SEAM,MAT2,SKIN,LIGHT,NRMMIP}-*.md` (the big `.out` files gitignored).
**Measure before implementing.**
