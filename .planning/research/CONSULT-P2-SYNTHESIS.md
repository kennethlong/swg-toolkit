# Phase 2 format ground-truth — consult-crew synthesis (LOCKED)

**Date:** 2026-06-23
**Inputs:** 4-consultant cross-AI fan-out, all anchored on `../swg-client-v2` C++ + `../swg-blender-plugin`
Python (two independent oracles per format). Full per-consultant detail:
- `CONSULT-P2-01-codex.out` — appearance load-graph + dependency resolution
- `CONSULT-P2-02-cursor.out` — `.mgn`/`.msh` geometry byte-map
- `CONSULT-P2-03-opus.out` — `.ans` keyframe/compressed encoding + coordinate math
- `CONSULT-P2-04-sonnet.out` — `.sht`/`.dds`/`.pal` customization + Three.js mapping

**Status: HIGH CONFIDENCE.** The slices cross-checked at every shared seam and **agreed**
(`SKMG` order Codex≡Cursor; `MLOD` Codex≡Cursor; name-keyed bone bind Codex≡Cursor≡Opus; `.sht`
ref Cursor≡Sonnet). Treat the layouts below as **LOCKED axioms** for planning — do NOT re-derive from
`docs/` (the docs' byte layouts are fabricated; see § Doc Corrections). C++/Python disagreements are
isolated and listed in § Open Items.

> **⚠ POST-REVIEW CORRECTION (2026-06-23).** The Phase-2 cross-AI plan review (`02-REVIEWS.md`) re-checked
> these layouts against `swg-client-v2` and found the original §1.3 and §1.6 carried real errors — i.e. the
> crew's "agreed at every seam" claim did NOT hold for SKMG INFO and the `.ans`/CKAT layout. **§1.3 (SKMG
> INFO = 9×int32, not 8) and §1.6 (KFAT/CKAT INFO/XFIN/QCHN byte tables + the compressed-quaternion decode)
> were corrected in place against source.** Lesson (de-anchoring): four LLMs converging on a synthesis is not
> ground truth; the loader code is. Other §1 sections were spot-confirmed in the review and stand.

---

## 1. Verified format layouts (the de-anchoring axioms)

**IFF conventions (confirmed):** block **tag + size = big-endian**; **chunk payload scalars =
little-endian**; `Vector` = 3× float32 (X,Y,Z); strings = ASCII + NUL, no length prefix; arrays use a
leading int32/int16 count; chunk bodies are **densely packed** (no internal 4-byte padding).

### 1.1 `.sat` skeletal appearance — **`FORM SMAT`** (v0001/0002/0003)
```
FORM SMAT → FORM 000{1,2,3}
  INFO
  MSGN   → mesh-generator path strings        (→ .lmg/MLOD or .mgn/SKMG)
  SKTI   → (skeletonPath, attachmentTransformName) PAIRS   (→ .skt/SKTM)
  [LATX] → .skt→.lat animation-table mapping   (v0003)
  [LDTB] [SFSK] [APAG]                         (v0003)
```
Entry: `SkeletalAppearanceTemplate::load` (`SkeletalAppearanceTemplate.cpp:786-1136`); runtime =
`SkeletalAppearance2`. **A `.sat` is the auto-compose entry point (CONTEXT D-03).**

### 1.2 `.skt` skeleton — **`FORM SKTM`** (v0001/0002)
```
FORM SKTM → FORM 000{1,2}
  INFO NAME PRNT RPRE RPST BPTR BPRO [BPMJ] JROR
```
`PRNT`=parent index, `RPRE/RPST`=pre/post rotation, `BPTR/BPRO`=bind-pose translation/rotation — the
rest pose. `BasicSkeletonTemplate.cpp:151-389`. Multi-skeleton LOD wrapper = `FORM SLOD`.

### 1.3 `.mgn` skinned mesh generator — **`FORM SKMG`** (v0002/0003/0004) — *Codex≡Cursor*
```
FORM SKMG → FORM 000{2,3,4}
  INFO    9×int32 + 4×int16 counts (verified order, load_0002):
            int32: maxTransformsPerVertex, maxTransformsPerShader, skeletonTemplateNameCount,
                   transformNameCount, positionCount, transformWeightDataCount, normalCount,
                   perShaderDataCount, blendTargetCount
            int16: occlusionZoneCount, occlusionZoneCombinationCount, zonesThisOccludesCount, occlusionLayer
  SKTM    skeleton-template NAME list required by this mesh   ⚠ inner chunk, NOT the .skt root form
  XFNM    transform/bone NAME table  ← skin indices reference THIS by name
  POSN    bind positions (3×float32 × positionCount)          global pool
  TWHD    weights-per-vertex (int32 × positionCount)           prefix counts into TWDT
  TWDT    skin weights: (int32 transformIndex, float32 weight) × transformWeightDataCount
          ⚠ VARIABLE per vertex; TOTAL entry count = transformWeightDataCount from INFO (NOT 4×positionCount)
  [NORM]  authored normals (omitted iff normal_count==0)
  [DOT3]  global tangent pool (v0004 only)
  [HPTS hardpoints] [BLTS blend-targets/morphs] [OZN/OZC/FOZC/ZTO occlusion]
  PSDT*   per-shader group:
    NAME   .sht shader path
    PIDX   shader-local-vert → global POSN index (int32[])
    [NIDX] → global NORM index   [DOT3 v0004]   [VDCL ARGB8 vertex colors]
    [TXCI + FORM TCSF/TCSD*]  texcoord sets
    PRIM → INFO + (ITL | OITL)   triangles, 3×int32 SHADER-LOCAL indices
```
`SkeletalMeshGeneratorTemplate.cpp` — INFO `load_0002` at :2247-2360 (verified 2026-06-23). Zero-area tris culled on load.

### 1.4 `.msh` static mesh — **`FORM MESH`** (v0002..0005; Python = 0005 only)
```
FORM MESH → FORM 0005 → [APPR] → FORM SPS → per-shader FORM 0001
  CNT(shader_count) ; per shader: NAME(.sht) + INFO(prim_count) + per-prim FORM 0001 (LSPT):
    INFO(type=9 indexedTriList, hasIndices, hasSorted)
    FORM VTXA → FORM 0003 → INFO(flags,vert_count) + DATA(interleaved verts)
    [INDX  int32 count + uint16[] indices]   (LSPT 0001; v0000 = int32)
    [SIDX  direction-sorted index buffers]
```
VTXA interleave order (present channels only, per `flags`): position(3f), [transformedW], normal(3f),
[pointSize], [color0 u32], [color1 u32], texcoords(per set, dim = `((flags>>(12+2j))&3)+1`).
`ShaderPrimitiveSetTemplate.cpp` + `VertexBuffer.cpp:247-307`.

### 1.5 LOD — **external indirection, NOT embedded** — *Codex≡Cursor*
```
.lmg = FORM MLOD → FORM 0000 → INFO(level_count int16) + NAME[]  (per-level generator paths)
.ldt = FORM LDTB → FORM 0000 → INFO(level_count) + per-level (minDist, maxDist) float32  (squared at runtime)
```
Client caps usable levels at `min(4, level_count)`. **CONTEXT D-02 ("all LODs, user-selectable")
holds, but the resolver must follow `.lmg`→generator paths — it is not inside the mesh bytes.**

### 1.6 `.ans` animation — **`FORM KFAT` (uncompressed) | `FORM CKAT` (compressed)** — root tag is the discriminator

> **CORRECTED 2026-06-23** against `swg-client-v2` after the Phase-2 plan review. The prior framing
> ("6 counts" without naming them, "format bytes per frame", "baseCount=7 / `baseSep=2/(baseCount+1)`",
> a constant `half_range`) was **FALSIFIED** — see the decode section + § Open Items. Keys are **SPARSE
> (frame-indexed)**, NOT one record per frame. Counts/widths **differ between KFAT (int32) and CKAT (int16)**.

**On-disk quaternion order is `(w,x,y,z)`** (`Iff::read_floatQuaternion`, §6). Keys are frame-indexed and
sparse — sampling must bracket the two nearest keys (binary search), not assume dense per-frame storage.

**KFAT-0003 (uncompressed quaternion) — verified byte layout:**
```
FORM KFAT → FORM 0003
  INFO   float32 fps; then 6×int32: frameCount, transformInfoCount, rotationChannelCount,
         staticRotationCount, translationChannelCount, staticTranslationCount
  FORM XFRM → XFIN × transformInfoCount (per joint; mapped to skeleton BY NAME):
         string name; int8 hasAnimatedRotations; int32 rotationChannelIndex;
         uint32 translationMask; int32 {x,y,z}TranslationChannelIndex
  [FORM AROT → QCHN × rotationChannelCount]:
         int32 keyCount; per key: int32 frameNumber + floatQuaternion (4×float32, w,x,y,z)   ⚠ SPARSE
  [SROT]  floatQuaternion (4×float32) × staticRotationCount
  [FORM ATRN → CHNL × translationChannelCount]:
         int32 keyCount; per key: int32 frameNumber + float32 value                          ⚠ SPARSE
  [STRN]  float32 × staticTranslationCount   (X/Y/Z axes independent; gated by translationMask bits)
  [MSGS] [LOCT]   optional
```

**CKAT-0001 (compressed quaternion) — verified byte layout (note int16 widths + per-channel formats):**
```
FORM CKAT → FORM 0001
  INFO   float32 fps; then 6×int16: frameCount, transformInfoCount, rotationChannelCount,
         staticRotationCount, translationChannelCount, staticTranslationCount
  FORM XFRM → XFIN × transformInfoCount:
         string name; int8 hasAnimatedRotations; int16 rotationChannelIndex;
         uint8 translationMask; int16 {x,y,z}TranslationChannelIndex
  [FORM AROT → QCHN × rotationChannelCount]:
         int16 keyCount; uint8 xFormat; uint8 yFormat; uint8 zFormat   ⚠ ONCE per channel, NOT per key;
         per key: int16 frameNumber + uint32 compressedRotation                                ⚠ SPARSE
  [SROT]  per static rotation: uint32 compressedRotation + uint8 xFormat + uint8 yFormat + uint8 zFormat
  [FORM ATRN → CHNL × translationChannelCount]:
         int16 keyCount; per key: int16 frameNumber + float32 value                            ⚠ SPARSE
  [STRN]  float32 × staticTranslationCount
  [MSGS] [LOCT]   optional
```

**KFAT-0002 = legacy Euler** (`FORM KFAT → FORM 0002`): the client bakes Euler channels → quaternions on
load (`buildQuaternionKeyframesFromEulers`). Deferred — return `KFAT-0002-unsupported` (do not mis-render).

**Compressed-quaternion decode (CKAT) — port `CompressedQuaternion::install()` + `doExpand()` verbatim; do NOT hand-derive:**
- Packed `uint32`: `(x11 << 21) | (y11 << 10) | z10`. x = bits 21–31 (11-bit), y = bits 10–20 (11-bit), z = bits 0–9 (10-bit).
  - 11-bit field: value mask `0x3FF`, sign bit `0x400`. 10-bit field: value mask `0x1FF`, sign bit `0x200`.
- Each component has its **own `uint8` format byte** (per channel, above). The format byte encodes **BOTH** the
  precision level (`formatId`, high bits) **AND** the base index (low bits, masked by `baseIndexMask`). It is **not**
  a 0–6 level index by itself.
- Build `s_formatData[0..254]` once. For `baseShiftCount = 0..6` (7 precision **levels**):
  - `baseSeparation = 2/(2^baseShiftCount + 1)`; `halfRange = 0.5·(4/(2^baseShiftCount + 1)) = 2/(2^baseShiftCount + 1)` (i.e. `halfRange == baseSeparation`, **per-level, not 1.0**).
  - `expandFactor11 = halfRange/1023`; `expandFactor10 = halfRange/511`.
  - `formatId` per level: `{0:0xFE, 1:0xFC, 2:0xF8, 3:0xF0, 4:0xE0, 5:0xC0, 6:0x80}`; `baseCount = 2^baseShiftCount`.
  - for `i = 0..baseCount-1`: `formatIndex = formatId | i`; `s_formatData[formatIndex] = { baseValue = -1 + (i+1)·baseSeparation, precisionIndex = baseShiftCount }`.
- Decode `data` with `(xFmt,yFmt,zFmt)`:
  - `x = expand11(data>>21, xFmt); y = expand11(data>>10, yFmt); z = expand10(data, zFmt)`
  - `w = sqrt(max(0, 1 − (x²+y²+z²)))`  ← **adopt the `max(0,…)` clamp** (C++ uses a bare `sqrt` at `:379`; the clamp is numerically safe and format-neutral)
  - `expand11(cv,fmt)`: `m = cv & 0x3FF; b = baseValue[fmt]; ef = expandFactor11[fmt]`; return `(cv & 0x400) ? b − m·ef : b + m·ef`
  - `expand10(cv,fmt)`: `m = cv & 0x1FF; b = baseValue[fmt]; ef = expandFactor10[fmt]`; return `(cv & 0x200) ? b − m·ef : b + m·ef`
- **Not** smallest-three, **not** a global scale table.

Interpolation: rotation **slerp**, translation **lerp**; `time = frame/fps`; **no loop flag in format** (loop
is viewer state). ⚠ The loader **decimates even rotation keys on load** under `s_rotationCompressionFix`
(`:578`) — a typed parser that may **re-serialize** must NOT apply that decimation; the IFF-layer SC-5
round-trip (`serializeIff(parseIff(bytes))`) is agnostic to it.

Sources (verified 2026-06-23): `CompressedKeyframeAnimationTemplate.cpp:1198-1313` (CKAT `load_0001`),
`:553-594` (QCHN), `:637-660` (CHNL); `KeyframeSkeletalAnimationTemplate.cpp:1518-1620` (KFAT `load_0003`),
`:523-553` (QCHN), `:576-607` (CHNL); `CompressedQuaternion.cpp:82-122,156-228,370-419` (install + doExpand)
≡ `compressed_quaternion.py:79-86` (cross-check oracle).

### 1.7 `.sht` shader — **`SSHT` (static) | `CSHD` (customizable wrapper)** — *parameter file, NOT a shader graph*
- **SSHT** names an **`.eft` effect file** (the real HLSL/VS lives there) + texture slots in a `TXMS`
  form. Slot tags: `MAIN` (diffuse), `NRML`/`CNRM` (normal), `SPEC`, `EMIS`, `ENVM` (forced
  placeholder = global scene cubemap), `MASK`. UV-set indices in `TCSS` (+ auto `DOT3` tangent channel
  when `NRML` present). `StaticShaderTemplate.cpp:32-36,123-128`.
- **CSHD** wraps an SSHT and adds **customization** (3 pathways — `CustomizableShaderTemplate.cpp:1246-1286`):
  - **A — palette→material color** (`MATR/AMCL/DFCL/EMCL`): named var holds a `.pal` entry index →
    `PaletteArgb` lookup → `setAmbient/Diffuse/EmissiveColor`.
  - **B — palette→texture swap** (`TXTR/TX1D`): index selects a DDS from a flat array, replaces a slot.
  - **C — palette→texture factor** (`TFAC/PAL`): lookup → packed `0xAARRGGBB` tint register.
- **`.pal`** = Microsoft RIFF PAL: 24-byte header + `entryCount×4` (R,G,B,A); version 3 ⇒ alpha forced
  255; ≤1024 entries. `PaletteArgb.cpp:517-521`.
- **`.dds`** = DXT1/3/5 → **direct GPU upload** (no CPU decode); DXT2/4 rare, would need CPU decode.

---

## 2. Rendering decisions confirmed (Three.js) — *Sonnet, source-verified*

- **Material = custom `ShaderMaterial`** (not `MeshStandardMaterial`) so SWG's D3D **texture-factor
  multiply** (`final = texture(MAIN,uv) * uTexFactor`) and multi-map parity are expressible. Uniforms:
  `uDiffuseMap/uNormalMap/uSpecularMap/uEmissiveMap/uEnvMap(global cube)/uTexFactor(vec4)/uSpecPower`.
- **Live customization (D-06) is zero-allocation:** mutate `material.uniforms.uTexFactor.value.set(...)`
  — no `needsUpdate`, no realloc. Picker model: each var = {name, palettePath, defaultIndex,
  affectedChannel|textureSlot}; selection stored as an int index, applied as a uniform. **Satisfies
  the "no per-frame GC" bar (D-09) for customization.**
- **GPU skinning (D-09):** `#include <skinning_pars_vertex>` + `<skinning_vertex>`, `material.skinning
  = true`; bone texture is a separate Three.js uniform that **coexists** with customization uniforms.
- **DXT (VIEW-02):** upload compressed via `WEBGL_compressed_texture_s3tc` (WebGL2, desktop-ubiquitous)
  — keeps binary-binary. CPU-decode path only for DXT2/4 fallback.

---

## 3. Planning deltas — things that REVISE CONTEXT.md assumptions or add tasks

1. **LOD is an external file graph** (`.lmg`/MLOD + `.ldt`/LDTB), not embedded levels (§1.5). The
   appearance resolver (D-03/D-05) must traverse it. Budget the `.lmg`+`.ldt` parsers + the
   MSGN→MLOD→SKMG indirection — D-02 "user-selectable LODs" depends on it.
2. **Skin weights are VARIABLE-count per vertex** (`TWHD`/`TWDT`), but Three.js `SkinnedMesh` needs
   **fixed vec4** `skinIndex`/`skinWeight`. Real **normalize-to-4-bones conversion** (sort by weight,
   take top 4, renormalize) is a required bridge task — not free.
3. **Geometry uses global pools + per-shader `PIDX`/`NIDX` indirection.** Building a `BufferGeometry`
   needs a **de-index pass** (gather global POSN/NORM by shader-local index) — best done C++-side
   before the zero-copy buffer crosses, or it breaks the zero-copy story. Add a task.
4. **`.sht` is a parameter file referencing an `.eft`** — full material parity (D-07) means parsing
   SSHT/CSHD **and** mapping `.eft` slot semantics to GLSL; we are NOT reading HLSL. The `.eft` may be
   a 5th parser or a slot-name→Three.js-uniform mapping table. Scope check for the planner.
5. **`.ans` has two encodings** (KFAT uncompressed + CKAT compressed, §1.6). Real assets are usually
   CKAT → the compressed-quaternion decoder is **on the critical path** for VIEW-03, not optional.
6. **Everything is name-keyed** (bone bind via `XFNM`/`XFIN` names, shader via path strings). The
   resolver + the "missing dep → partial render + warning" path (D-04) key off names, not indices.
7. **`SKTM` is overloaded** — root FORM of a `.skt` AND an inner chunk of a `.mgn`. Name the parser
   entry points distinctly to avoid conflation.

---

## 4. Doc corrections (write back to `docs/` — drop "AI-proposed", replace with verified)

Per the project convention (AGENTS.md: update docs when a layout is verified/corrected). **Every
byte-level layout in these docs is fabricated** and must be replaced with §1 above:

- **`docs/02-formats/skeletons-and-animation.md`**
  - `.sat` described as "Skeleton Animation Template" listing `.skt`+`.ans` → **WRONG.** Real =
    `FORM SMAT`, a skeletal *appearance* template referencing mesh generators + skeleton templates.
  - `.skt` = `FORM SKTM→FORM BONE→NAME/XFRM/INDX` → **WRONG.** Real = `SKTM→0001/0002→INFO,NAME,PRNT,
    RPRE,RPST,BPTR,BPRO,[BPMJ],JROR`.
  - `.ans` = `ANST/CHNL/POSK/ROTK`, float-time keys, `qx/qy/qz/qw` order, no compression → **ALL
    WRONG.** Real = `KFAT|CKAT`, integer-frame keys, on-disk quat `(w,x,y,z)`, compressed
    uint32-packed quaternion (§1.6). Only the "three decoupled files" framing survives.
- **`docs/02-formats/meshes-and-appearances.md`** — has TS/Three.js sketches, **no real byte tables**;
  some sketches WRONG: `Uint16` vec4 skin indices (real = variable-count int32 in `TWDT`);
  `computeVertexNormals()` as default (**breaks round-trip** — both formats store authored normals);
  `skeletonPath`+`parts[]` SAT manifest (real = `MSGN` list + `SKTI` pairs). Replace with §1.1–1.5.
- **`docs/03-rendering/shaders-and-fx.md`** — "shader-graph editor for `.sht`" framing **WRONG**
  (`.sht`=SSHT/CSHD data file; programs live in `.eft`). "DXT must be CPU-decoded" **WRONG** (direct
  GPU upload via S3TC). `MeshStandardMaterial` plausible-but-suboptimal (no texture-factor uniform).
  Replace with §1.7 + §2.

---

## 5. Open items / oracle disagreements to resolve in implementation

- **CKAT `w` reconstruction:** ✅ RESOLVED (folded into §1.6). C++ does not clamp the `sqrt`; Python clamps
  `max(0,…)`. Adopt the clamp (numerically safe, no format conflict).
- **CKAT per-component quantization:** ✅ RESOLVED (folded into §1.6, verified 2026-06-23). The `uint8`
  format byte encodes BOTH precision level (`formatId`) AND base index (low bits); `halfRange = 2/(2^shift+1)`
  is per-level, NOT a constant 1.0. Port `CompressedQuaternion::install()` to build `s_formatData[255]`; do not
  hand-derive. (Original §1.6 "format bytes per frame / baseCount=7 / half_range=1.0" framing was FALSIFIED.)
- **Python quaternion element order is inconsistent** (compressed path returns `(x,y,z,w)`, raw
  KFAT/SROT stores `(w,x,y,z)`). Our IR must pick one order and normalize on ingest.
- **KFAT 0002 (legacy Euler):** C++ bakes Euler channels → quaternions on load; Python discards
  animated rotations. If 0002 support is needed, port the C++ path. **0003 + CKAT are the priority and
  fully agree** — 0002 can be deferred.
- **Blender Python is version-incomplete** (VTXA 0001/0002, LSPT 0000, SKMG `VDCL` not read). Our C++
  port follows `swg-client-v2` for full version coverage; use Python only as the cross-check oracle.

---

## 6. Coordinate convention (for VIEW-04 glTF/COLLADA export, D-10)

SWG engine space = **left-handed, Y-up, meters**; on-disk quaternion order **(w,x,y,z)**. To a
right-handed Y-up target (glTF/Blender): **X-axis mirror** — positions `(x,y,z)→(-x,y,z)`; rotations
`q=(w,x,y,z)→(w,x,-y,-z)`; for glTF additionally reorder to `(x,y,z,w)`. Verified against
`export_animation.py:154-162` + `coords.py:13-26`. (Also settles the Phase-6 Blender Z-up↔Y-up path.)

---

*All file:line citations are in the four `CONSULT-P2-0{1..4}-*.out` files. This synthesis is the
LOCKED input for `/gsd:plan-phase 2` — add it to CONTEXT.md canonical_refs.*
