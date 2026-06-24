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
  INFO    (8×int32 + 4×int16 counts)
  SKTM    skeleton-template NAME list required by this mesh   ⚠ inner chunk, NOT the .skt root form
  XFNM    transform/bone NAME table  ← skin indices reference THIS by name
  POSN    bind positions (3×float32 × position_count)         global pool
  TWHD    weights-per-vertex (int32 × position_count)         prefix counts into TWDT
  TWDT    skin weights: (int32 transformIndex, float32 weight) × N   ⚠ VARIABLE count per vertex
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
`SkeletalMeshGeneratorTemplate.cpp:2169-3198`. Zero-area tris culled on load.

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
```
FORM KFAT(0002 Euler|0003 quat) | CKAT(0001)
  INFO   fps:float32 + 6 counts (KFAT int32 / CKAT int16)
  FORM XFRM → XFIN × transformCount   per-joint descriptor, mapped to skeleton BY NAME
  [FORM AROT → QCHN ×]   animated rotation (per-frame quaternion stream)
  [SROT]                 static rotation
  [FORM ATRN → CHNL ×]   animated translation (3 INDEPENDENT scalar axes)
  [STRN]                 static translation;  per-axis animated/static gated by translation_mask bits
  [MSGS] [LOCT] [QCHN-locomotion]   optional
```
**Compressed quaternion (CKAT)** = one `uint32`: x=11b(`>>21 &0x7FF`, sign 0x400), y=11b(`>>10`),
z=10b(`&0x3FF`, sign 0x200); **w dropped, reconstructed** `w=sqrt(1-(x²+y²+z²))`. Per-component
min/max quantization via three `uint8` format bytes (7 precision levels; `base=-1+(i+1)·baseSep`,
`baseSep=2/(baseCount+1)`; `value = base ± field·(half_range/1023|511)`). **Not** smallest-three,
**not** a global scale table. `CompressedQuaternion.cpp:82-100,370-419` ≡ `compressed_quaternion.py:79-86`.
Rotation interpolates **slerp**, translation **lerp**; time = frame/fps; **no loop flag in format**.

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

- **CKAT `w` reconstruction:** C++ does not clamp the `sqrt`; Python clamps `max(0,…)`. Adopt the
  clamp (numerically safe, no format conflict).
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
