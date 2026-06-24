---
phase: 2
reviewers: [codex, cursor, sonnet, opus]
reviewed_at: 2026-06-23
plans_reviewed: [02-01-PLAN.md, 02-02-PLAN.md, 02-03-PLAN.md, 02-04-PLAN.md, 02-05-PLAN.md]
method: cross-AI consult crew; each reviewer verified plan format claims directly against ../swg-client-v2 loader source (not synthesis consensus). claude CLI skipped for independence (review run from inside Claude Code).
---

# Cross-AI Plan Review — Phase 2 (3D Mesh Viewport MVP Proof)

Four independent reviewers read all five plans + the LOCKED `CONSULT-P2-SYNTHESIS.md` + CONTEXT, and
spot-checked the plans' binary-format claims against the real `swg-client-v2` C++ loaders. The crew
**converged** on the highest-risk items (a strong signal), while each also surfaced unique catches.

> ⚠ **Several findings implicate `CONSULT-P2-SYNTHESIS.md` §1.3 and §1.6 themselves** — i.e. the
> LOCKED synthesis the plans inherit from carries format errors (SKMG INFO count; CKAT INFO/XFIN/QCHN
> layout + quantization formula). Per the de-anchoring protocol, the synthesis must be corrected too,
> or any `--reviews` replan will re-import the bug. See Consensus → Agreed Concerns.

---

## Codex Review (repo tracer / call-graph; source-cited)

**Summary** — Directionally strong: correctly treats Phase 2 as a real skinned-mesh proof, carries
"binary stays binary" through de-index and DDS upload, and places human checkpoints at the right
boundaries. But would not execute unchanged — verified format-layout mismatches, several "zero-copy"
claims that are really "copy / binary-not-JSON" claims, and dependency gaps between waves (`.apt`,
`.dds`/`.pal` round-trip, texture-byte resolution, animation buffer contracts). Spot-checked against
`swg-client-v2` source; did not validate against real asset bytes this pass.

**Plan 02-01** — Strengths: right first wave (contracts, support parsers, de-index, harness); static
VTXA interleave matches `VertexBuffer.cpp:247-307`; LOD external graph correct (`LodMeshGeneratorTemplate.cpp:210-244`, `LodDistanceTable.cpp:145-170`).
- HIGH: `.dds` and `.pal` are NOT IFF — `serializeIff(parseIff(bytes))` will not work for them. `PaletteArgb.cpp:517-521` reads RIFF PAL; DDS is header/block based.
- HIGH: "zero-copy" overstated — binding uses `Napi::ArrayBuffer::New` + `memcpy` (keeps binary out of JSON but copies into JS-owned memory).
- MEDIUM: `MeshParseResult`/`MeshShaderGroup` lack per-attribute byte offsets/counts, but `SkinnedMeshView` expects buffers sliced from one ArrayBuffer.
- MEDIUM: `.sht` parse underspecifies the real nested texture path — `StaticShaderTemplate.cpp:482-565` loads effect first, then `TXMS`; entries are `FORM TXM → FORM 000x → DATA` then `TextureList::fetch(&iff)`, not slot tag/string/uv-set.
- Risk: MEDIUM-HIGH.

**Plan 02-02** — Strengths: correctly separates root `.skt` `FORM SKTM` from inner `.mgn` `SKTM` name-list (`SkeletalMeshGeneratorTemplate.cpp:2285-2295`, `BasicSkeletonTemplate.cpp:151-172`); SMAT graph confirmed (`SkeletalAppearanceTemplate.cpp:824-1071`); good D-04 stance.
- HIGH: SKMG INFO field order/count wrong — source reads **9 int32 then 4 int16** (`SkeletalMeshGeneratorTemplate.cpp:2258-2278`), not "8×int32 + 4×int16".
- HIGH: `TWDT` cap of `4×posCount` invalid for on-disk data — source reads `transformWeightDataCount` from INFO then that many `(int32,float)` pairs (`:2331-2343`); top-4 is a renderer conversion, not a file limit.
- HIGH: resolver claims `.sat`/`.apt` smart-open but no `.apt` parser / static appearance resolver planned — static composed path incomplete.
- MEDIUM: C++ pre-bridge skin-index normalization can't remap to Three.js bone order without the resolved skeleton; plan alternates C++ normalize (empty boneOrder) vs later JS remap — weakens "ready-to-upload pre-bridge" contract.
- MEDIUM: UI open integration underplanned (no VFS browser/open-action files listed, yet human checkpoint depends on double-click/open-in-viewport).
- Risk: HIGH.

**Plan 02-03** — Strengths: custom `ShaderMaterial` correct; S3TC upload for DXT1/3/5 correct; zero-alloc uniform tint sound.
- HIGH: texture bytes not actually available — 02-02 says "skip DDS, loaded later," but 02-03 modifies only view/panel files; resolver/cache never fetches `.dds`/`.pal` bytes via TRE VFS.
- MEDIUM: CPU-decode fallback required but not specified as a real impl (DXT CPU decode nontrivial; no library/native task).
- MEDIUM: full parity may need more than slot tags for some `.eft` behavior — scope as "standard SWG slot-map parity" since `.eft` isn't parsed.
- LOW: shader text section puts sampler uniforms in vertex shader; samplers belong in fragment.
- Risk: MEDIUM-HIGH.

**Plan 02-04** — Strengths: prioritizes CKAT 0001 + KFAT 0003, declines 0002; adopts `w` clamp even though `CompressedQuaternion.cpp:370-379` uses bare `sqrt`; good profiler check.
- HIGH: CKAT `QCHN` layout wrong — `CompressedKeyframeAnimationTemplate.cpp:553-575` reads `keyCount int16`, then `xFormat/yFormat/zFormat uint8` **once per channel**, then per-key `(frame int16, compressedRotation uint32)`. Plan says `uint8[3] per frame`.
- HIGH: CKAT/KFAT INFO field descriptions wrong — CKAT `:1201-1210` = `fps float, frameCount int16, then five int16 counts`; KFAT 0003 `:1521-1532` = `fps float, frameCount int32, then five int32 counts`.
- MEDIUM: dense `frameCount × jointCount × stride` buffers explode memory and don't match sparse channel storage; renderer can sample sparse keys from typed arrays.
- MEDIUM: `setTransportState` per frame via Zustand allocates + rerenders — conflicts with zero-GC hot path.
- Risk: HIGH ("clearest verified format errors").

**Plan 02-05** — Strengths: glTF/COLLADA correctly one-way; good docs-correction task; non-destructive Extract.
- HIGH: coordinate transform under-specified / may double-apply — must define whether the live scene is already SWG→target converted; if already right-handed/Y-up, export must not mirror again.
- HIGH: mirroring only object `position.x` + bone quat `y,z` likely insufficient — geometry vertex buffers, bind/inverse-bind matrices, hierarchy, normals/tangents, animation tracks must all transform consistently.
- MEDIUM: don't broadly "drop AI-proposed caveat" — prefer precise "verified for these versions against these files" callouts.
- MEDIUM: animation export needs stable bone names matching `AnimationClip` track paths; plan doesn't specify how Three.js bone names are set.
- Risk: MEDIUM-HIGH.

**Phase-wide:** Good wave order + checkpoints; correct emphasis on source verification, real fixtures,
partial-dependency handling, no per-frame alloc. HIGH: several format claims need source correction
(SKMG INFO, CKAT/KFAT layouts); "zero-copy" criteria not satisfied by the shown binding; missing
`.apt`; CORE-05 generic-IFF round-trip proves container preservation, not semantic correctness — pair
with typed-parse assertions + render golden checks. **Overall: HIGH as written, MEDIUM after corrections.**

---

## Cursor Review (detailed code/byte-map reader; source-cited)

**Phase summary** — Five-wave structure sound. Plans inherit the synthesis's best decisions and align
with D-01..D-10. **But spot-checking `swg-client-v2` reveals material errors in 02-04, a VIEW-01 gap
for static `.msh`, and a CORE-05 methodology bug for non-IFF `.pal`/`.dds`.** CKAT quaternion bit-packing
and `(w,x,y,z)` order confirmed in source; several animation chunk layouts in 02-04 are not.

**02-01** — VTXA interleave ✅ (`VertexBuffer.cpp:247-307`); RIFF PAL 24-byte header + `entryCount×4`, version ≠ 4 → α=255 ✅ (`PaletteArgb.cpp:508-522`); CKAT constants ✅ (`CompressedQuaternion.cpp:82-100`).
- HIGH: CORE-05 round-trip via `parseIff`/`serializeIff` for `.pal`/`.dds` is invalid (RIFF PAL + Microsoft DDS, not IFF) — RESEARCH §Validation Architecture says parser-native round-trip.
- MEDIUM: "zero-copy" overstated (`Napi::ArrayBuffer::New` + `memcpy`); stats "zero-copy ✓" label misleading.
- MEDIUM: LDTB layout — distances live inside INFO (`int16 levelCount` + per-level `(min,max)` float32, squared at runtime; `LodDistanceTable.cpp:145-168`), not sibling chunks.
- LOW: DDS oracle `Texture.cpp:115-129` is a format-conversion table, not mip-size math.
- LOW: Wave 1 frontmatter claims VIEW-01/02 but delivers no viewport.
- Risk: MEDIUM.

**02-02** — SKMG load order ✅ (`SkeletalMeshGeneratorTemplate.cpp:2284-2343`); SMAT MSGN+SKTI ✅ (`SkeletalAppearanceTemplate.cpp:851-881`); SKTM chunks ✅ (`BasicSkeletonTemplate.cpp:237-295`); MLOD ✅ (`LodMeshGeneratorTemplate.cpp:210-247`).
- HIGH: VIEW-01 static `.msh` path not delivered — resolver leaf-mode calls `parseMesh`, but only `SkinnedMeshView` ships (expects skinIndex/skinWeight + skeleton); no `StaticMeshView`.
- MEDIUM: SKMG INFO **9×int32 + 4×int16** (`:2553-2569`), not "8×int32".
- MEDIUM: bind pose may be incomplete — client also applies RPRE/RPST pre/post rotations.
- MEDIUM: multi-PSDT / multi-shader-group rendering unspecified (`.mgn` often has multiple groups; `SkinnedMeshView` reads a single `parsedMesh`).
- MEDIUM: skin-index remap split across C++/TS; leaf `.mgn` with null skeleton has weights but no bone mapping.
- Risk: MEDIUM-HIGH.

**02-03** — custom ShaderMaterial + skinning chunks ✅; S3TC + CPU fallback correct; `uTexFactor.value.set()` zero-alloc ✅; CSHD 3-pathway concept ✅ (`CustomizableShaderTemplate.cpp:1246-1286`).
- MEDIUM: normal mapping without DOT3 tangents — SKMG v0004 has authored DOT3 pool; `dFdx/dFdy` TBN risks D-07 parity.
- MEDIUM: ENVM cubemap source undefined.
- MEDIUM: CSHD pathway conflation — A (palette→material color) and C (palette→texture factor) both mapped to `uTexFactor`; client applies them to different properties.
- MEDIUM: CustomizationPanel uses `materials[0]` only — multi-group avatars won't expose all vars.
- Risk: MEDIUM.

**02-04** — root discriminator ✅; quat order `(w,x,y,z)` ✅ (`Iff.cpp:1512-1519`); CKAT packed-bit + `doExpand` ✅ (`CompressedQuaternion.cpp:82-100,370-379`, w-clamp reasonable); 0002 decline ✅; good GC discipline + Chrome perf check.
- HIGH: XFIN is NOT name-only — KFAT-0003 XFIN = name + `int8 hasAnimatedRotations` + `int32 rotationChannelIndex` + `uint32 translationMask` + 3×`int32` translation channel indices (`KeyframeSkeletalAnimationTemplate.cpp:1541-1552`); CKAT XFIN uses `int16` indices (`CompressedKeyframeAnimationTemplate.cpp:1221-1241`).
- HIGH: CKAT QCHN layout wrong — `int16 keyCount`; **3 format bytes once per channel**; then per-key `int16 frame + uint32 compressedRotation` (`:553-575`). Per-frame format bytes misalign every read.
- HIGH: KFAT-0003 QCHN is **sparse** — `int32 keyCount`; per key `int32 frame + read_floatQuaternion()` (`:521-544`). Plan's dense "frame-aligned struct per joint × frameCount" needs an unspecified C++ densification/resampling step.
- MEDIUM: KFAT-0003 INFO field list wrong — after fps: `frameCount, transformInfoCount, rotationChannelCount, staticRotationCount, translationChannelCount, staticTranslationCount` all int32 (`:1523-1530`); plan invents "totalRotationFrames".
- MEDIUM: CKAT vs KFAT integer-width differences (int16 vs int32) not called out.
- MEDIUM: `setTransportState` from `useFrame` triggers Zustand subscribers / React re-renders — prefer ref clock + throttled UI sync.
- MEDIUM: `ansPickerOptions` population unplanned (LATX/animation-table mapping skeleton → `.ans`).
- Risk: HIGH — "VIEW-03 will not work on real CKAT assets with current chunk descriptions."

**02-05** — scene clone before transform ✅; X-mirror position `(-x,y,z)` ✅ (`coords.py:13-14`); docs task implements §4.
- MEDIUM: quaternion export math simplified — Blender uses matrix conjugation by X-flip (`export_animation.py:158-161`), more correct for hierarchical skeletons than component negation.
- MEDIUM: `buildAnimationClip()` depends on 02-04 IR — wrong densification → wrong exported animation even if viewport looks OK.
- MEDIUM: ColladaExporter skinning/animation less reliable than glTF; set "best-effort" expectation.
- LOW: Extract needs `mountHandle` + source entry path in viewportStore (not added in 02-02).
- Risk: MEDIUM.

**Overall: MEDIUM-HIGH.** Fix 02-04 animation layouts, add static-mesh render path, fix PAL/DDS harness — then executable.

---

## Sonnet Review (lateral / second-order; source-cited)

**Summary** — Ambitious, well-structured, genuinely anchored on swg-client-v2 source. Wave sequencing
and dependency graph are correct. Latent risks: a deprecated Three.js API that silently fails on the
pinned version; a SKTM chunk mandatory in v0001 but absent in v0002; a static-`.msh` render gap;
GC risk in the animation pre-build; an underspecified KFAT XFIN flag. None are design failures —
each needs a precise implementation-time fix.

**Strengths:** wave parallelization correct (02-03 ⟂ 02-04, both on 02-02); de-index placement
preserves zero-copy; CKAT on critical path with clamp called out; SKTM dual-meaning guard enforced;
D-04 partial-resolution end-to-end; CORE-05 rigorous; thorough threat model; name-keyed bone bind;
X-mirror math verified; docs-update scope bounded.

**Concerns:**
- HIGH: `material.skinning = true` was **removed in Three.js r140** — on pinned r0.184.0 it does nothing/throws. Skinning now auto-enables from `skinIndex`/`skinWeight` attributes + bound skeleton + the explicit `<skinning_*>` chunks. The `material.skinning = true` line in 02-03-T1 and 02-02-T2 `done` will mislead. (Three.js r140 release notes.)
- HIGH: SKTM v0001 has **BPMJ as mandatory** (`BasicSkeletonTemplate.cpp:280-286`, plain `enterChunk`, no optional flag); v0002 omits it (`:363-390`). Synthesis marks it `[BPMJ]` optional and plan says "read and ignore" — but v0001 mandates entering+skipping the chunk or the IFF read position corrupts. Needs a version branch.
- HIGH: KFAT-0003 XFIN contains an `int8` animated-rotation flag the plan omits — name + `int8` + `int32 rotationChannelIndex` + `uint32 translationMask` + 3×`int32` (`KeyframeSkeletalAnimationTemplate.cpp:1546-1553`). CKAT uses `int16` widths (`CompressedKeyframeAnimationTemplate.cpp:1227-1232`). Reading only the name misaligns every subsequent XFIN.
- MEDIUM: static `.msh` has no render checkpoint — 02-01 validates round-trip + zero-copy assertion but the render path is 02-02 only, and 02-02's human-verify is `.sat`/`.mgn`-centric. An off-by-one in VTXA stride parses clean but renders garbage. Add a static-`.msh` sub-step.
- MEDIUM: VTXA flags→channel bit assignments not spelled out in action (only in read_first).
- MEDIUM: "zero-copy" used loosely (sometimes "no JSON", sometimes "no post-bridge alloc") — clarify per boundary.
- MEDIUM: CKAT XFIN channel indices are int16 not int32 (`:1227-1232`).
- MEDIUM: pre-building 10k×Quaternion + 10k×Vector3 from the keyframe buffer on load is a controlled one-time alloc (not per-frame, so D-09-OK) but may cause a load-time GC pause — prefer flat Float32Array + scratch.
- MEDIUM: resolver path-injection mitigation assumes `resolveEntry` rejects non-relative/absolute paths — verify behavior for drive-letter / `..` inputs.
- LOW: remove `material.skinning` from PATTERNS.md too.
- LOW: LodDistanceTable stores actual distances on disk (`sqrt(m_minDistanceSquared)`, `:131-132`), squared at runtime — synthesis "squared at runtime" could be misread as "stored squared."
- LOW: PaletteArgb forces alpha when `versionOrComponentCount != 4` (not "version 3"; `:517-521`).
- LOW: 02-05 scene `clone()` is shallow — mutating `position.x` on a shallow clone can mutate the original (shared geometry/refs). Build a purpose-built export scene or deep-clone.

**Risk: MEDIUM-HIGH** — concentrated in three invisible implementation traps (`material.skinning`,
BPMJ v0001, XFIN field widths). All fixable with targeted text additions; with fixes, drops to MEDIUM.

---

## Opus Review (math / spec reasoning; source-cited)

**Summary** — Well-structured, correctly sequenced, right architectural instincts (C++ de-index pre-bridge,
fixed vec4 skin, zero-alloc useFrame, custom ShaderMaterial, one-way X-mirror). High-level format claims
check out against real source. **But the deepest-scrutiny target — CKAT decode + `.ans` byte layout —
has multiple HIGH errors in 02-04 that break both the SC-5 round-trip and the decode.**

**Strengths (verified):** de-index architecture (global POSN/NORM pools + per-PSDT PIDX/NIDX int32 +
shader-local int32 ITL) confirmed; `(w,x,y,z)` order confirmed (`Iff.cpp:1512-1520`, write `:876-882`);
X-mirror algebraically valid (= Blender `flip @ R @ flip`, `flip=diag(-1,1,1)`, `export_animation.py:154-162`);
`w` clamp correct; variable→vec4 conversion correct; zero-alloc useFrame discipline; DDS DXT block math
is the correct standard formula + sound mip bounds check.

**Concerns:**
- HIGH: **CKAT format bytes are per-CHANNEL, not per-frame** (02-04:153). Ground truth `CompressedKeyframeAnimationTemplate.cpp:553-594`: `int16 keyCount; uint8 xFormat; uint8 yFormat; uint8 zFormat;` (formats once per channel) then per key `int16 frame; uint32 packed`. Reading 3 bytes/frame desyncs immediately → SC-5 fails.
- HIGH: **the per-component quantization formula (`half_range=1.0`) is wrong** (synthesis §1.6 + 02-04:153). `expandFactor = halfRange/valueMask`, `valueMask=1023|511`, `halfRange = 2/(2^shift+1)` — varies per format. Critically the **format byte encodes BOTH precision level AND base index** (`format = formatId | baseIndex`, `:327`): decoder must reverse-map formatId→shift and extract baseIndex via `baseIndexMask`, then `baseValue = -1 + (baseIndex+1)·baseSeparation`, `baseSeparation = 2/(2^shift+1)`. Plan's "baseCount=7, base=-1+(i+1)·baseSep" conflates the 7 precision *levels* with per-level base *indices*. **Port `CompressedQuaternion::install()` verbatim** to build the 255-entry `s_formatData` table; do not hand-derive.
- HIGH: CKAT INFO + XFIN field sets wrong — INFO `:1201-1212` = `fps + frameCount(int16) + 5×int16`, frameCount FIRST (plan omits frameCount, lists 5 counts, wrong order). XFIN `:1219-1246` = `name + int8 hasAnimatedRotation + int16 rotationChannelIndex + uint8 translationMask + 3×int16 trans indices` — plan says name-only.
- HIGH: KFAT-0003 (int32) vs CKAT-0001 (int16) widths conflated — INFO 6×int32 (`:1521-1530`), XFIN int32 (`:1547-1552`), QCHN/CHNL int32 keys (`:526,537`). SROT also differs: CKAT `uint8 x,y,z fmt + uint32 packed` (`:1273-1277`) vs KFAT raw `floatQuaternion` (4×float32, `:1590`). Carry two explicit byte tables, not "same as KFAT".
- MEDIUM: SKMG INFO is **9×int32 + 4×int16**, not 8 (02-02:155; synthesis §1.3). 9 fields named; `transformWeightDataCount` (TWDT total) is given in INFO — canonical value, not "sum of TWHD".
- MEDIUM: X-mirror export omits **triangle winding reversal + normal.x negation** (02-05). A single-axis mirror (det −1) inverts winding; positions+bones alone leave inside-out shading. Validate with an asymmetric asset.
- MEDIUM: DDS source mis-cited — `Texture.cpp:115-129` is the format-conversion registration table, not a DDS reader. Mip math is correct as DDS spec but not grounded in the cited source (violates SC-5 cited-loader discipline). Find the real DDS plugin or relabel as "standard Microsoft DDS spec".
- MEDIUM: vec4 normalization edge cases unspecified — 0-influence sentinel (all-zero weight leaves vertex at origin; prefer `weight=(1,0,0,0)` to a root bone), unconditional renormalize for drift, deterministic tie-break.
- LOW: `CompressedQuaternion.cpp` path mis-cited in 02-04:126 — actual `src/engine/shared/library/sharedMath/src/shared/CompressedQuaternion.cpp`.
- LOW: loader drops keyframes on load (`s_rotationCompressionFix`/`s_translationFix`, `:578,655`) — IFF-layer SC-5 is agnostic (good), but typed `parseAnimation` must not apply decimation if it ever re-serializes; test counts must expect on-disk counts.
- LOW: **Uint16 index overflow** — source ITL indices are int32; meshes can exceed 65535 verts. 02-01:220/267 says Uint16 → silently corrupts large meshes. Use Uint32. Also pin where the XFNM→bone skinIndex remap lands (prefer C++-side with real `boneOrder`).

**Risk: HIGH** (concentrated in 02-04; other four MEDIUM→LOW). Spine is correct and ground-truth-aligned;
the single concentrated risk is the animation byte layout + compressed-quaternion decode in 02-04 (and
its upstream source, synthesis §1.6). Gate the 02-05 docs-update on 02-04 being corrected first, or it
codifies the wrong CKAT layout into the "verified" docs — exactly the de-anchoring failure this project guards against.

---

## Consensus Summary

### Agreed Strengths (2+ reviewers)
- **Wave structure + dependency graph are correct** (all four). 02-03 ⟂ 02-04 parallelism after 02-02 is sound; human-verify gates well placed.
- **De-index pre-bridge architecture preserves zero-copy** (Codex, Sonnet, Opus, Cursor) — global POSN/NORM pools + per-PSDT PIDX/NIDX confirmed against source.
- **`(w,x,y,z)` disk order + Three.js `(x,y,z,w)` reorder is correct and consistently applied** (Cursor, Opus).
- **The CKAT `w = sqrt(max(0, …))` clamp is the right call** (all four) — safer than the bare `sqrt` in `CompressedQuaternion.cpp:379`.
- **Custom `ShaderMaterial` + S3TC DDS upload + zero-alloc `uTexFactor` mutation** is the right materials approach (Codex, Cursor, Sonnet, Opus).
- **D-04 partial-resolution, SKTM dual-meaning guard (delta #7), and the STRIDE registers** are well specified (Codex, Cursor, Sonnet).
- **SMAT/SKTM/SKMG-order/VTXA/MLOD/RIFF-PAL layouts confirmed against source** (Cursor + Opus verification matrices agree).

### Agreed Concerns (2+ reviewers — priority order)
1. **[HIGH — all four] Plan 02-04 animation byte layouts are wrong vs real loaders.** CKAT QCHN format bytes are **per-channel, not per-frame**; INFO omits/misorders `frameCount`; XFIN is a full TransformInfo descriptor (int8 flag + channel indices + translation mask), not a name-only string; KFAT-0003 (int32) and CKAT-0001 (int16) widths are conflated; KFAT QCHN is sparse (needs an explicit C++ densification step). **As written, both the SC-5 round-trip and the decode fail → VIEW-03 broken.** (Codex, Cursor, Opus give exact `CompressedKeyframeAnimationTemplate.cpp` / `KeyframeSkeletalAnimationTemplate.cpp` line ranges.)
2. **[HIGH — Opus, deepest] The CKAT quantization formula itself is wrong** (`half_range=1.0` is not constant; the format byte encodes precision level AND base index). Fix = port `CompressedQuaternion::install()` table verbatim; do not hand-derive from synthesis prose.
3. **[HIGH — Codex, Cursor] `.pal`/`.dds` are NOT IFF** — the CORE-05 `serializeIff(parseIff(bytes))` round-trip is invalid for them. Use parser-native (read→serialize-own-format) round-trips.
4. **[HIGH — Cursor; MEDIUM — Sonnet] Static `.msh` render path (VIEW-01) is not delivered** — only `SkinnedMeshView` ships; no `StaticMeshView` / non-skinned branch, yet 02-02 success criteria claim the static path works.
5. **[HIGH Codex / MEDIUM Cursor, Opus] SKMG INFO is 9×int32 + 4×int16, not "8×int32 + 4×int16"** — off-by-one desyncs INFO parsing. **This error lives in synthesis §1.3.**
6. **[HIGH — Codex; MEDIUM — Cursor] Export coordinate transform is insufficient / risks double-apply** — needs the live-scene-already-converted decision, plus triangle-winding reversal + normal.x negation (a single-axis mirror inverts winding); prefer matrix-based mirror over component negation. Gate 02-05 docs-update on 02-04 being corrected.
7. **[HIGH — Codex; implied Cursor] Texture bytes (`.dds`/`.pal`) are never plumbed through the resolver/cache** for 02-03 to consume.
8. **[MEDIUM — Codex, Cursor] "Zero-copy" is overstated** — the binding `memcpy`s into a new JS ArrayBuffer. Relabel as "binary ArrayBuffer path / no JSON"; fix the "zero-copy ✓" stats label.
9. **[MEDIUM — Codex, Cursor] `setTransportState` every frame** churns Zustand/React — drive the clock from a ref, throttle UI sync.
10. **[MEDIUM — Cursor, Opus] Dense per-frame keyframe expansion** mismatches sparse on-disk storage / risks memory blow-up; **[LOW — Opus, Sonnet] Uint16 indices overflow >65535 verts → use Uint32.**
11. **[LOW — Cursor, Opus] DDS oracle `Texture.cpp:115-129` is mis-cited** (a conversion table, not a DDS reader) — fixes the SC-5 citation discipline; same correction needed in the 02-05 docs task.

### Divergent / Unique catches (single reviewer — high value)
- **Sonnet:** `material.skinning = true` was **removed in Three.js r140** → silent no-op/throw on pinned r0.184.0 (also fix PATTERNS.md). **SKTM `BPMJ` is mandatory in v0001, absent in v0002** → version-branch the parser or corrupt the IFF read position.
- **Opus:** the quantization-formula/`install()`-table finding (#2 above) — the single deepest math error; Uint16→Uint32 index width; vec4-normalize edge cases (0-influence sentinel, deterministic tie-break); keyframe-decimation-on-load caveat for any typed re-serialize.
- **Codex:** missing **`.apt`** parser / static-appearance resolver for the composed-static path; `.sht` nested texture path underspecified (`FORM TXM → 000x → DATA` + `TextureList::fetch`); geometry-buffer ABI lacks explicit per-attribute offsets/counts.
- **Cursor:** **DOT3 tangents** not passed for normal maps (SKMG v0004 has an authored DOT3 pool); **CSHD pathway conflation** (A material-color vs C texture-factor both → `uTexFactor`); multi-PSDT / multi-shader-group rendering unspecified; ENVM cubemap source undefined.

### Bottom line
The phase spine — wave order, synthesis anchoring, security registers, de-index/zero-copy architecture,
materials approach, coordinate algebra — is **above average and largely ground-truth-correct**. The risk
is **concentrated in plan 02-04 (animation)** and its upstream source **synthesis §1.6**, with secondary
HIGH fixes in the `.pal`/`.dds` harness method (02-01), the static-mesh render gap (02-02), the SKMG INFO
count (§1.3), texture-byte plumbing (02-03), and the export winding/normal/double-apply handling (02-05).

**Recommended action:** `/gsd:plan-phase 2 --reviews` to replan, **and correct `CONSULT-P2-SYNTHESIS.md`
§1.3 (SKMG INFO 9×int32) and §1.6 (CKAT INFO/XFIN/QCHN + quantization-via-install-table) first** — the
plans inherit those errors from the LOCKED synthesis, so a replan that re-reads the uncorrected synthesis
will re-import the bug. Treat the synthesis §1.6 framing as FALSIFIED per the de-anchoring protocol.
