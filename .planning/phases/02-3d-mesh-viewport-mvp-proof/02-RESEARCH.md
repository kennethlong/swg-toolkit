# Phase 2: 3D Mesh Viewport (MVP Proof) - Research

**Researched:** 2026-06-23
**Domain:** SWG skeletal/static mesh + skeleton + animation + shader parsing → zero-copy N-API bridge → Three.js/R3F rendering + glTF/COLLADA export
**Confidence:** HIGH (format layouts are LOCKED ground truth, verified this session against `swg-client-v2` C++ + `swg-blender-plugin` Python; render/export stack verified against current npm + Three.js docs)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Full VIEW-01..04 in one phase; **skinned `.mgn` leads as the real proof**. Static `.msh` falls out as the easy subset, NOT a separate prerequisite milestone. Success bar = the skinned path working. Planner sequences internally into waves but does not trim scope.
- **D-02:** Parse ALL LOD levels; expose a **user-selectable LOD picker**. Do not collapse to LOD 0.
- **D-03:** Smart-open by file type ("Both"): opening a `.sat`/`.apt` auto-resolves the full dependency graph and renders the composed result; opening a leaf `.mgn`/`.msh` renders standalone in bind pose with optional manual attach of skeleton/animation.
- **D-04:** Missing-dependency handling = **render partial + visible warning** (placeholder texture/default skeleton + `missing: X` panel). Do NOT hard-refuse the render.
- **D-05:** A skinned object's appearance is composite (`.sat` → skeleton(s) + mesh generators; static `.apt` → `.msh`). The appearance-template parsers + a cross-TRE **resolver** are first-class deliverables.
- **D-06:** **Live interactive color-swapping** — expose shader customization variables as live color/palette controls; re-tint in real time. The explicit "beats TRE Explorer" wow moment. Plumb customization indices → `.pal` → shader uniforms.
- **D-07:** **Full multi-map material parity** — diffuse, normal, specular, environment/effect maps mapped onto Three.js materials. Resolve `.msh`/`.mgn` → `.sht` → texture chain in full. NOT diffuse-only.
- **D-08:** **Full animation transport UX** — timeline scrubber, play/pause, loop toggle, playback speed, plus an `.ans` picker (an `.ans` targets a skeleton, not a mesh).
- **D-09:** **GPU skinning via Three.js `SkinnedMesh`/`Skeleton`** — bone matrices to the GPU, no per-frame geometry rebuild. Researcher to confirm bind-pose/bone-weight mapping and specify the GC-safe buffer-reuse strategy.
- **D-10:** **Export = glTF + COLLADA, both rigged with animation. Export-only this phase** (no re-import / round-trip back into SWG formats). SC-5 byte-exact gate applies to the SWG-format **parsers**, not the glTF/COLLADA export fidelity (export is one-way, validated by "opens in an external tool").

### Claude's Discretion
(Resolved with concrete recommendations in this research — see `## Claude's Discretion — Resolved`.)
- DDS decode path — GPU compressed-texture (S3TC/DXT) vs CPU decode to RGBA.
- Appearance-resolver's home — native C++ vs TS/renderer.
- Baseline viewport chrome set — grid, lighting rig, background, wireframe, bbox, camera framing.
- `.ans` compression variants — which the target assets use and what to support for v1.

### Deferred Ideas (OUT OF SCOPE)
- Re-import / round-trip of glTF/COLLADA back into SWG formats (Phase 6 / Blender bridge handles authored `.ans` export).
- In-viewport mesh/UV/weight/rig editing (bridge to Blender, project-wide out of scope).
- Animation state graph / logical animation (`.ash`) authoring (Phase 2 only **plays back** an `.ans`).
- Other appearance types beyond mesh/skinned (particles `.prt`/`.eft`, terrain, portals/POB → Phase 7).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| **VIEW-01** | Open static (`.msh`) or skinned (`.mgn`) mesh; render with orbit camera; geometry crosses N-API **zero-copy** into `BufferGeometry`. | §1 SKMG/MESH layouts (verified); §3 de-index pass (C++ pre-bridge); §4 zero-copy buffer path; §5 R3F + drei `OrbitControls`. |
| **VIEW-02** | Render `.dds` textures **and** `.pal` palette customization correctly (full material parity). | §1.7 SSHT/CSHD/`.pal`/`.dds`; §6 custom `ShaderMaterial` + texture-factor; §7 DDS GPU upload; §9 live customization (D-06). |
| **VIEW-03** | Preview `.skt`/`.sat` skeleton; play back `.ans` animation without per-frame GC hitching. | §1.2 SKTM, §1.6 KFAT/CKAT; §8 CKAT decoder + GPU skinning; §4 GC-safe hot path. |
| **VIEW-04** | Extract a raw asset and export a viewed mesh (rigged + animated) to glTF/COLLADA. | §10 export pipeline + coordinate math (§ coordinate convention, verified). |
</phase_requirements>

---

## Summary

This phase turns the LOCKED format synthesis (`.planning/research/CONSULT-P2-SYNTHESIS.md`) into PLAN-ready engineering. The byte layouts are not re-derived here — they were verified by a 4-AI crew against two independent oracles and **spot-re-verified this session** (CKAT decoder, SKMG chunk set, coordinate math all confirmed against `swg-client-v2` source). What remains is the engineering: parser build order, the zero-copy + GC-safe data path, the Three.js material/skinning wiring, the cross-TRE appearance resolver, and the per-format validation strategy.

Five engineering realities dominate the plan and each becomes explicit task budget: (1) **geometry is indirected** — global POSN/NORM pools + per-shader PIDX/NIDX, requiring a **C++-side de-index pass** before the buffer crosses the bridge, or zero-copy is lost; (2) **skin weights are variable-count int32** (TWHD/TWDT) and must be normalized to fixed **vec4** for Three.js `SkinnedMesh`; (3) **LOD is an external file graph** (`.lmg`/MLOD + `.ldt`/LDTB), not embedded levels, so D-02's LOD picker depends on the resolver traversing it; (4) **`.ans` is usually CKAT-compressed**, so the compressed-quaternion decoder is on the VIEW-03 critical path, not optional; (5) **`.sht` is a parameter file referencing an `.eft`** — full material parity (D-07) means parsing SSHT/CSHD and mapping `.eft` slot semantics to GLSL, not reading HLSL.

The existing foundation is strong: the Phase-1 engine-free C++ lib (`packages/native-core/modules/core/{iff,tre,io,compress}`) already provides a hybrid-DOM IFF parser/serializer whose **clean nodes re-emit their captured byte slice verbatim** — which means new typed parsers get byte-exact round-trip *for free* by re-serializing through the existing IFF writer, and the CORE-05 harness (`packages/harness/`) already enforces the standing gate via a fixture registry with per-fixture loader-source citations.

**Primary recommendation:** Wave the phase static-spine → skinned → materials/customization → animation → export (per CONTEXT). Land each new parser as engine-free C++ in `modules/core/formats/`, registered into the CORE-05 harness with a real-asset fixture and a cited `swg-client-v2` loader line. Put the **de-index + vec4-skin-normalize passes in C++ (pre-bridge)** so geometry crosses as ready-to-upload typed arrays. Put the **appearance resolver in TS** (it is graph/metadata, not binary). Use a **custom `ShaderMaterial`** (not `MeshStandardMaterial`) with GPU skinning chunks + customization uniforms coexisting. **GPU-upload DXT1/3/5 directly via `WEBGL_compressed_texture_s3tc`** (CPU-decode only the rare DXT2/4). Support **CKAT 0001 + KFAT 0003** for v1; defer legacy KFAT 0002 (Euler).

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Binary format parse (.msh/.mgn/.skt/.sat/.ans/.sht/.lmg/.ldt/.eft) | Native C++ (`modules/core/formats`) | — | Reuses Phase-1 IFF reader; engine-free; headless-testable; heavy parse off main thread (CORE-06). |
| De-index pass (global pools → BufferGeometry attrs) | Native C++ (pre-bridge) | — | Must run before zero-copy buffer crosses, or the bridge re-copies. Delta #3. |
| Variable→vec4 skin-weight normalize | Native C++ (pre-bridge) | — | `SkinnedMesh` needs fixed vec4; doing it C++-side keeps the crossing buffer upload-ready. Delta #2. |
| DXT mip extraction (offsets/sizes) | Native C++ | — | Keep the compressed blocks binary; hand the renderer offset/size + format enum. |
| Cross-TRE appearance resolution (name-keyed graph) | TS (renderer/backend) | Native (file fetch via TRE VFS) | Graph/metadata layer, not binary payload (CONTEXT explicitly carves this out). |
| Geometry → `BufferGeometry` upload | Renderer (R3F) | — | Three.js owns GPU upload; consumes the zero-copy typed arrays. |
| GPU skinning (bone matrices → GPU) | Renderer (Three.js `SkinnedMesh`/`Skeleton`) | — | D-09; satisfies "no per-frame GC". |
| Live customization (palette → uniform) | Renderer (mutate uniform value) | — | Zero-alloc uniform mutation; D-06. |
| Animation sampling (slerp/lerp per frame) | Renderer (`useFrame`, reused scratch objects) | Native (decode keyframes once on load) | Decode once C++-side; sample per-frame in JS into reused `Quaternion`/`Vector3`. |
| glTF/COLLADA export | Renderer (Three.js `GLTFExporter`/`ColladaExporter` over the built scene) | — | Export from the live Three.js scene graph; one-way (D-10). |
| CORE-05 round-trip gate | Harness (bare-Node vitest over C++ lib) | — | Standing gate; every parser registers a fixture + citation. |

---

## Standard Stack

### Core (new this phase)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `three` | 0.184.0 | WebGL render engine; `SkinnedMesh`/`Skeleton`/`ShaderMaterial`/`CompressedTexture`; glTF/COLLADA exporters | The renderer the whole `docs/03-rendering` design targets. `[VERIFIED: npm registry]` (slopcheck [OK], repo mrdoob/three.js). |
| `@react-three/fiber` | 9.6.1 | Declarative Three.js in React 19 (pairs with react@19 — renderer is React 19.2) | Project-mandated R3F stack (`docs/00-overview/architecture.md`). v9 = React 19. `[VERIFIED: npm registry]` (slopcheck [OK], repo pmndrs). |
| `@react-three/drei` | 10.7.7 | `OrbitControls`, camera rigs, `Grid`, `Environment`, gizmo/bbox helpers | Standard R3F helper lib; supplies the orbit camera (VIEW-01) + chrome. `[VERIFIED: npm registry]` (slopcheck [OK], repo pmndrs). |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@types/three` | 0.184.1 | TS types for three (matches three 0.184) | Dev dep; type the BufferGeometry/SkinnedMesh wiring. `[VERIFIED: npm registry]` |
| `zustand` | 5.0.14 (already installed) | Shared state across React render + `useFrame` (LOD pick, customization indices, transport state) | Already in renderer deps; reuse for viewport/customization/transport state. `[VERIFIED: already in package.json]` |
| `leva` | 0.10.1 | Optional debug-grade control panel for customization color pickers (D-06) | Fast path to the live color-swap UI; OR build bespoke Radix pickers. Recommend bespoke for shipping UI, `leva` only if a quick dev panel is wanted. `[VERIFIED: npm registry]` (slopcheck [OK]) |

Three.js exporters (`GLTFExporter`, `ColladaExporter`) ship **inside** the `three` package under `three/examples/jsm/exporters/` — no separate dependency. `[CITED: three.js docs / examples/jsm]`

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Custom `ShaderMaterial` | `MeshStandardMaterial` + maps | Loses SWG's D3D texture-factor multiply uniform → customization (D-06) can't be expressed cleanly. Synthesis §2 rejects it. Use ShaderMaterial. |
| `WEBGL_compressed_texture_s3tc` GPU upload | CPU-decode DDS→RGBA | CPU decode breaks "binary stays binary" + costs memory/time. S3TC is desktop-ubiquitous on WebGL2. GPU upload wins (see Claude's Discretion). |
| C++ de-index | TS de-index after bridge | TS de-index forces a copy of the global pools across the bridge then a rebuild → defeats zero-copy. C++ pre-bridge wins (delta #3). |
| Three.js `ColladaExporter` | skip COLLADA, glTF only | D-10 locks both. `ColladaExporter` is in `examples/jsm`; ship both. |

**Installation:**
```bash
# in packages/renderer
pnpm add three@0.184.0 @react-three/fiber@9.6.1 @react-three/drei@10.7.7
pnpm add -D @types/three@0.184.1
# leva only if a quick dev control panel is desired:
# pnpm add leva@0.10.1
```

**Version verification (this session):** `npm view` confirmed three 0.184.0, @react-three/fiber 9.6.1, @react-three/drei 10.7.7, @types/three 0.184.1, leva 0.10.1, zustand 5.0.14. R3F-v9↔React-19 pairing confirmed via official docs `[CITED: r3f.docs.pmnd.rs]`.

## Package Legitimacy Audit

> slopcheck 0.6.1 was available and run (`scan` over a probe manifest). All four new packages clean.

| Package | Registry | Source Repo | slopcheck | Disposition |
|---------|----------|-------------|-----------|-------------|
| `three` | npm | github.com/mrdoob/three.js (created 2012) | [OK] | Approved |
| `@react-three/fiber` | npm | github.com/pmndrs/react-three-fiber | [OK] | Approved |
| `@react-three/drei` | npm | github.com/pmndrs/drei | [OK] | Approved |
| `leva` | npm | github.com/pmndrs/leva | [OK] | Approved (optional) |
| `@types/three` | npm | DefinitelyTyped | not scanned (types-only, tracks three) | Approved (dev) |

**Packages removed due to slopcheck [SLOP] verdict:** none.
**Packages flagged [SUS]:** none.
No `postinstall` scripts on `three` or `@react-three/fiber` (checked). Three.js exporters are bundled — no extra package to vet.

---

## Architecture Patterns

### System Architecture Diagram

```
                 ┌─────────────────────── OPEN A FILE ───────────────────────┐
                 │  .sat/.apt  (compose flow, D-03)   │   .mgn/.msh (leaf, D-03)
                 ▼                                     ▼
        ┌──────────────────┐                  ┌──────────────────┐
        │ Appearance       │  name-keyed      │ render standalone │
        │ Resolver (TS)    │  graph walk      │ in bind pose      │
        │ over TRE VFS     │─────────┐        │ (+ manual attach) │
        └──────────────────┘         │        └──────────────────┘
           │ resolves (by name):     │
           │  SMAT → MSGN paths ─────┼──► .lmg/MLOD ──► per-LOD .mgn/SKMG (or .msh/MESH)
           │  SMAT → SKTI pairs ─────┼──► .skt/SKTM (skeleton rest pose)
           │  SKMG PSDT NAME ────────┼──► .sht/SSHT|CSHD ──► .eft slots + .dds + .pal
           │  .ldt/LDTB ─────────────┘    (LOD distances; user-selectable picker, D-02)
           │  missing dep → placeholder + warning (D-04)
           ▼
   ┌──────────────────────────────────────── NATIVE C++ (modules/core/formats) ──────────┐
   │  parse IFF (Phase-1 reader) → typed struct                                            │
   │  DE-INDEX pass: gather global POSN/NORM by per-shader PIDX/NIDX → flat attr arrays    │
   │  VEC4 SKIN normalize: variable TWHD/TWDT → fixed skinIndex[4]/skinWeight[4]           │
   │  DXT mip table: (offset,size,format enum) per mip — blocks stay compressed            │
   │  CKAT/KFAT decode: per-joint keyframe streams → IR (quat (w,x,y,z) normalized order)  │
   └───────────────────────────────┬──────────────────────────────────────────────────────┘
                                    │  binary typed arrays, no JSON (Float32/Uint32/Int32) +
                                    │  control metadata (small JSON: bone names, slot map)
                                    ▼
   ┌──────────────────────────────────── RENDERER (R3F / Three.js) ───────────────────────┐
   │  BufferGeometry ← attr arrays (position/normal/uv/skinIndex/skinWeight)               │
   │  Skeleton ← SKTM rest pose (bones by name); SkinnedMesh binds geometry+skeleton (D-09)│
   │  CompressedTexture ← DXT blocks via WEBGL_compressed_texture_s3tc                     │
   │  ShaderMaterial: uDiffuse/uNormal/uSpec/uEmissive/uEnvMap + uTexFactor(vec4)          │
   │      + <skinning_pars_vertex>/<skinning_vertex>  (skinning coexists w/ customization) │
   │  useFrame: sample anim (slerp rot / lerp trans) into REUSED scratch → bone.matrix     │
   │  Live customization: palette index → mutate uTexFactor.value (zero-alloc, D-06)       │
   └───────────────────────────────┬──────────────────────────────────────────────────────┘
                                    ▼
                    GLTFExporter / ColladaExporter (X-mirror coordinate xform) → file (D-10)
```

### Recommended Project Structure
```
packages/native-core/modules/core/
├── formats/                 # NEW — engine-free parsers over the Phase-1 IFF reader
│   ├── Mesh.{h,cpp}         # FORM MESH (static) → SPS → per-shader VTXA/INDX
│   ├── SkeletalMeshGen.{h,cpp}  # FORM SKMG (.mgn) → de-index + vec4-skin passes
│   ├── Skeleton.{h,cpp}     # FORM SKTM (.skt) rest pose — entry distinct from SKMG's inner SKTM!
│   ├── SkeletalAppearance.{h,cpp}  # FORM SMAT (.sat) → MSGN/SKTI lists
│   ├── MeshLod.{h,cpp}      # FORM MLOD (.lmg) + LDTB (.ldt) — external LOD graph
│   ├── Animation.{h,cpp}    # FORM KFAT | CKAT (.ans) → keyframe IR + CKAT decoder
│   ├── Shader.{h,cpp}       # SSHT | CSHD (.sht) + Effect.{h,cpp} for .eft slot map
│   ├── Palette.{h,cpp}      # RIFF PAL (.pal)
│   └── Dds.{h,cpp}          # DDS header + mip table (blocks stay compressed)
├── geometry/                # de-index + vec4-normalize helpers (shared by Mesh/SkeletalMeshGen)
src/                         # thin N-API bindings: mesh_binding.cpp, anim_binding.cpp, ...
packages/contracts/src/
├── mesh.ts  skeleton.ts  animation.ts  material.ts   # byte-offset + message types
packages/renderer/src/panels/viewport/   # NEW R3F panel
├── Viewport.tsx            # Canvas + camera + chrome
├── SkinnedMeshView.tsx     # SkinnedMesh + ShaderMaterial wiring
├── AnimationTransport.tsx  # scrubber/play/pause/loop/speed + .ans picker (D-08)
├── LodPicker.tsx           # D-02
├── CustomizationPanel.tsx  # live color pickers (D-06)
└── resolver/appearanceResolver.ts   # TS cross-TRE name-keyed graph walk (D-03/D-05)
```

### Pattern 1: Byte-exact round-trip via the existing IFF hybrid-DOM
**What:** New typed parsers do NOT reimplement IFF framing. They parse the Phase-1 `IffParseResult` into a typed view and, for round-trip, re-serialize through the existing `serializeIff`. Clean (unedited) nodes re-emit their `capturedSlice` verbatim.
**When to use:** Every new format parser's CORE-05 fixture.
**Why it matters:** The standing gate becomes nearly free for read-only viewers — parse the typed struct for rendering, but prove round-trip by `serializeIff(parseIff(bytes))` byte-equality on the same fixture. The typed layer is validated separately by "renders correctly."
```cpp
// Source: packages/native-core/modules/core/iff/Iff.h:166-191 (parseIff / serializeIff)
//   clean node → capturedSlice verbatim re-emit (Iff.h:96-105, 171-174)
auto result = swg_core::iff::parseIff(data, size);
auto out    = swg_core::iff::serializeIff(result, data, size);  // byte-exact for unedited input
```

### Pattern 2: De-index pass (C++ pre-bridge) — delta #3
**What:** `.mgn`/`.msh` store a **global** POSN/NORM pool and, per shader group, PIDX/NIDX arrays mapping shader-local vertex indices into the global pool, plus PRIM triangle indices that are shader-local. Three.js wants per-shader `BufferGeometry` with flat, locally-indexed attributes.
**When to use:** On parse, before any buffer crosses the bridge.
**How:** For each PSDT group, for each shader-local index i: `position[i] = POSN[PIDX[i]]`, `normal[i] = NORM[NIDX[i]]`, copy UVs from the group's TCSF/TCSD; PRIM indices are already shader-local → use directly as the index buffer. Output one BufferGeometry-ready attribute set per shader group (one Three.js mesh/material per group).
**Why C++-side:** doing it after the bridge means copying both global pools + all index arrays across, then rebuilding in JS — two copies and a GC-heavy rebuild. C++ emits the final flat arrays once.
> Oracle: `SkeletalMeshGeneratorTemplate.cpp` (4119 lines; chunk set POSN/NORM/TWHD/TWDT/PIDX/NIDX/XFNM/SKTM/DOT3/PSDT/PRIM/OITL/TXCI confirmed present this session). Cross-check `../swg-blender-plugin/swg_scene/mesh_skeletal.py`.

### Pattern 3: Variable→vec4 skin-weight normalization — delta #2
**What:** TWHD holds a per-vertex count (int32 × position_count); TWDT is a flat `(int32 transformIndex, float32 weight)` stream. A vertex may have any number of influences. Three.js `SkinnedMesh` needs exactly 4: `skinIndex` (vec4) + `skinWeight` (vec4).
**How:** Per vertex: read its `count` influences, sort by weight descending, take top 4, renormalize the 4 weights to sum 1.0, zero-pad if fewer than 4. The `transformIndex` references the XFNM name table → remap to the Skeleton bone order (name-keyed, delta #6).
**Where:** C++ pre-bridge (emit final vec4 arrays). Flag vertices that lost >X% weight from truncation as a warning (rare; informative).

### Pattern 4: Custom ShaderMaterial with skinning + customization coexisting
**What:** SWG materials need a D3D-style texture-factor multiply (`final = texture(MAIN,uv) * uTexFactor`) plus multi-map parity — not expressible on `MeshStandardMaterial`. GPU skinning must coexist.
**How:** A `ShaderMaterial` (or `onBeforeCompile` injection) with `#include <skinning_pars_vertex>` + `<skinning_vertex>` in the vertex shader, and uniforms `uDiffuseMap/uNormalMap/uSpecularMap/uEmissiveMap/uEnvMap(global cube)/uTexFactor(vec4)/uSpecPower`. The bone texture Three.js installs for skinning is a separate uniform and does not conflict.
> ⚠ **Do NOT set `material.skinning = true`** — that property was **removed in Three.js r140** and is a silent no-op on the pinned `r0.184.0`. Skinning auto-enables when the geometry carries `skinIndex`/`skinWeight` attributes, the mesh is a `SkinnedMesh` bound to a `Skeleton`, and the `<skinning_*>` chunks are included. (Verified 2026-06-23: Three.js r140 release notes; REVIEWS.md HIGH — Sonnet.)
> Source: synthesis §2 (Sonnet, source-verified) + `StaticShaderTemplate.cpp` / `CustomizableShaderTemplate.cpp` slot semantics.

### Anti-Patterns to Avoid
- **`computeVertexNormals()` as a default.** Both `.msh` and `.mgn` store **authored** normals (NORM chunk). Recomputing breaks round-trip and visual fidelity. Use authored normals; only synthesize if NORM is genuinely absent (`normal_count==0`). (Synthesis §4 doc correction.)
- **Uint16 vec4 skin indices read directly from disk.** There is no vec4 on disk — it's variable-count int32 in TWDT. The vec4 is a *derived* bridge artifact (Pattern 3). (Synthesis §4.)
- **Treating `.sht` as a shader graph to edit.** It's a parameter/data file naming an `.eft`. We map slots to GLSL; we do not read HLSL or build a node editor (that's a deferred v2 item). (Synthesis §4.)
- **CPU-decoding DXT by default.** DXT1/3/5 upload compressed to the GPU. (Synthesis §4.)
- **Conflating the two `SKTM` meanings.** `SKTM` is the root FORM of a `.skt` AND an inner chunk of a `.mgn` (the skeleton-name list it requires). Name the parser entry points distinctly. (Synthesis delta #7.)
- **De-indexing or skin-normalizing after the bridge.** Forces extra copies; defeats zero-copy (delta #3/#2).
- **Allocating in `useFrame`.** Per-frame `new Quaternion()/Vector3()/Matrix4()` → GC hitching (the exact VIEW-03 failure mode). Reuse module-scope scratch objects.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| IFF FORM/chunk framing | A new IFF reader per format | Phase-1 `parseIff`/`serializeIff` (`modules/core/iff`) | Already byte-exact, security-capped, hybrid-DOM verbatim re-emit. Round-trip gate becomes free. |
| Orbit camera | Manual mouse-drag camera math | drei `<OrbitControls>` | Standard, damping/inertia handled. |
| GPU skinning math | Custom bone-matrix vertex shader | Three.js `SkinnedMesh`/`Skeleton` + `<skinning_*>` chunks | Battle-tested; satisfies "no per-frame GC" (D-09). |
| glTF/COLLADA writing | Hand-roll glTF JSON / DAE XML | `three/examples/jsm/exporters/{GLTFExporter,ColladaExporter}` | Bundled with three; handles rigged+animated export. |
| DXT→RGBA (only if needed) | A from-scratch BCn decoder | Browser-native `WEBGL_compressed_texture_s3tc` (no decode) or an established decoder for DXT2/4 | Native GPU path is zero-decode; CPU decode is a rare fallback. |
| Quaternion slerp / lerp | Custom interpolation | Three.js `Quaternion.slerpQuaternions` / `Vector3.lerpVectors` into reused scratch | Correct + allocation-free when reusing targets. |
| RIFF PAL parsing | Generic palette guesser | The exact 24-byte header + entryCount×4 layout (synthesis §1.7) | Verified; version-3 alpha quirk matters. |

**Key insight:** The only genuinely new binary work is the SWG-specific *typed decode* (the format structs) and the two bridge passes (de-index, vec4-normalize). Everything around it — IFF framing, camera, skinning, export, interpolation, compressed-texture upload — is solved by Phase-1 code or Three.js. Keep the new surface small and verified.

## Runtime State Inventory

> Not a rename/refactor/migration phase — greenfield format work. Section omitted as not applicable. (No stored data / live config / OS state to migrate; all new parsers + UI.)

## Common Pitfalls

### Pitfall 1: LOD assumed embedded in the mesh
**What goes wrong:** Planner budgets a "parse LOD levels from the mesh" task; D-02's user-selectable LOD picker silently can't find levels.
**Why:** LOD is an **external file graph** — `.lmg`/MLOD lists per-level generator paths, `.ldt`/LDTB holds per-level distances. The mesh bytes contain no levels. (Synthesis §1.5 / delta #1, Codex≡Cursor.)
**How to avoid:** Budget the `.lmg`+`.ldt` parsers AND the resolver's MSGN→MLOD→SKMG indirection as the source of LOD levels. Client caps usable levels at `min(4, level_count)`.
**Warning signs:** A `.mgn` parser that "returns LODs."

### Pitfall 2: CKAT treated as optional / KFAT-only path shipped
**What goes wrong:** Animation playback (VIEW-03) works on a hand-picked uncompressed asset, then fails on real assets.
**Why:** Real `.ans` assets are usually **CKAT** (compressed). The compressed-quaternion decoder is on the critical path. (Synthesis §1.6 / delta #5.)
**How to avoid:** Make CKAT 0001 a v1 must-have, KFAT 0003 the secondary, KFAT 0002 (legacy Euler) deferred.
**Warning signs:** Playback works only on a synthetic fixture.

### Pitfall 3: Quaternion element-order drift
**What goes wrong:** Animation looks subtly wrong (twisted joints) — order/sign mismatch.
**Why:** On-disk KFAT/SROT stores `(w,x,y,z)`; the compressed path reconstructs `(x,y,z)` then computes `w`; the Python oracle is internally inconsistent on order. (Synthesis §5.)
**How to avoid:** Pick ONE IR order (recommend `(w,x,y,z)` to match disk) and **normalize on ingest** at every decode site. Document the order in the contracts type. CKAT `w = sqrt(1-(x²+y²+z²))` — **clamp the radicand to ≥0** (C++ doesn't; Python does; adopt the clamp — numerically safe, no format conflict — synthesis §5 open item).
**Warning signs:** Some joints look mirrored or flipped under animation but bind pose is fine.

### Pitfall 4: Zero-copy lost to a post-bridge rebuild
**What goes wrong:** Geometry "works" but the bridge copies the global pools + index arrays and rebuilds in JS — the zero-copy contract (the whole point of the phase, CORE-06) is silently violated.
**Why:** De-index/normalize done in TS after the buffer crosses.
**How to avoid:** Run de-index + vec4-normalize in C++; cross only the final flat BufferGeometry-ready attribute arrays as typed arrays. Verify with the CORE-06 zero-copy assertion pattern from Phase-1 (`tre-async-zerocopy.test.ts`).
**Warning signs:** Large allocations after a mesh load; the crossing buffer is the raw POSN pool, not the final attribute array.

### Pitfall 5: `SkinnedMesh` bone binding by index instead of name
**What goes wrong:** Wrong bones animate; mesh deforms chaotically.
**Why:** Everything is **name-keyed** — TWDT transformIndex → XFNM name → must map to the Skeleton's bone order (which comes from SKTM names). Skeleton bone order ≠ XFNM order in general. (Synthesis delta #6.)
**How to avoid:** Build a name→boneIndex map from the resolved Skeleton, remap every skinIndex through it during the vec4-normalize pass.
**Warning signs:** Animation plays but the mesh deforms wrongly; static bind pose is fine.

### Pitfall 6: Missing-dependency render hard-fails
**What goes wrong:** An incomplete TRE mount → the viewer refuses to render anything.
**Why:** Not honoring D-04.
**How to avoid:** Resolver returns partial results + a `missing[]` list; substitute placeholder texture (magenta checker) / default skeleton; surface a warning panel. Render what resolved.

## Code Examples

### CKAT compressed-quaternion expand (verified against oracle this session)
```cpp
// Source: swg-client-v2 src/engine/shared/library/sharedMath/src/shared/CompressedQuaternion.cpp:82-100, 370-419
// packed format [MSB]: x = 11 bits (shift 21), y = 11 bits (shift 10), z = 10 bits (low)
//   11-bit: valueMask 0x3FF, signBit 0x400 ; 10-bit: valueMask 0x1FF, signBit 0x200
//   per-component format byte selects a precision table: base = -1 + (i+1)*baseSeparation
// Decode one uint32 'data' with three uint8 format bytes (xFmt,yFmt,zFmt):
x = s_formatData[xFmt].expandElevenBit(data >> 21);
y = s_formatData[yFmt].expandElevenBit(data >> 10);
z = s_formatData[zFmt].expandTenBit (data);
w = std::sqrt(std::max(0.0f, 1.0f - (x*x + y*y + z*z)));  // CLAMP (Python clamps; C++ does not — synthesis §5)
// NOTE: this is NOT smallest-three and NOT a global scale table.
```

### Coordinate convention for export (verified against blender oracle this session)
```
// SWG engine space = left-handed, Y-up, meters; on-disk quaternion order (w,x,y,z).
// To right-handed Y-up (glTF): X-axis mirror.
//   position (x,y,z) -> (-x, y, z)
//   rotation (w,x,y,z) -> (w, x, -y, -z)        // similarity transform flip @ R @ flip
//   for glTF additionally reorder quat to (x,y,z,w)
// Verified: ../swg-blender-plugin/swg_blender/coords.py:13-26 (engine_to_blender_position = (-x,y,z))
//           ../swg-blender-plugin/swg_blender/export_animation.py:154-162 (flip @ R @ flip)
// CAUTION: the Blender oracle ALSO applies a +90° X import rotation for Blender's Z-up target —
//   that is Blender-specific (Phase-6), NOT part of the engine→glTF(Y-up) core transform. For
//   glTF export use the X-mirror only; do not add the +90°.
```

### Zero-alloc live customization (D-06)
```ts
// Source: synthesis §2 — mutate the uniform value in place, no needsUpdate, no realloc.
// picker selection (int palette index) -> PaletteArgb lookup -> packed 0xAARRGGBB -> vec4
material.uniforms.uTexFactor.value.set(r, g, b, a);   // zero-allocation; satisfies D-09 GC bar
```

## State of the Art

| Old Approach (docs/, AI-distilled) | Current (verified) | Source |
|--------------------------------------|--------------------|--------|
| `.sat` = "Skeleton Animation Template" listing `.skt`+`.ans` | `FORM SMAT` skeletal **appearance** → MSGN mesh-gen list + SKTI skeleton pairs | synthesis §1.1 / §4 |
| `.skt` = `SKTM→BONE→NAME/XFRM/INDX` | `SKTM→INFO,NAME,PRNT,RPRE,RPST,BPTR,BPRO,[BPMJ],JROR` | §1.2 / §4 |
| `.ans` = `ANST/CHNL/POSK/ROTK`, float-time, qx/qy/qz/qw, no compression | `KFAT|CKAT`, integer-frame keys, disk `(w,x,y,z)`, uint32-packed compressed quat | §1.6 / §4 |
| Uint16 vec4 skin indices | variable-count int32 in TWHD/TWDT → derive vec4 | §4 / delta #2 |
| `computeVertexNormals()` default | authored NORM chunk | §4 |
| `.sht` = shader-graph editor; DXT must be CPU-decoded | `.sht` = SSHT/CSHD data file → `.eft`; DXT direct GPU upload | §4 |
| `MeshStandardMaterial` | custom `ShaderMaterial` (texture-factor uniform) | §2 / §4 |
| R3F v8 / React 18 | R3F **v9** / React **19** | r3f.docs.pmnd.rs (this session) |

**Deprecated/outdated:** all byte-level layouts in `docs/02-formats/{meshes-and-appearances,skeletons-and-animation}.md` and `docs/03-rendering/shaders-and-fx.md` — replace per synthesis §4 once the parsers verify them (AGENTS.md doc-update convention).

## Claude's Discretion — Resolved

### 1. DDS decode path → **GPU compressed-texture upload (S3TC/DXT), CPU fallback for DXT2/4 only**
DXT1/2/3/4/5 conversions all exist in `Texture.cpp` (confirmed this session), but DXT1/3/5 are the common formats and map directly to `WEBGL_compressed_texture_s3tc` (`COMPRESSED_RGB_S3TC_DXT1`, `DXT3`, `DXT5`). WebGL2 + this extension is desktop-ubiquitous (Electron on desktop GPUs). C++ emits the DDS mip table (per-mip offset/size + format enum); the renderer builds a `THREE.CompressedTexture` and uploads the blocks unmodified — binary stays binary. DXT2/4 (rare, premultiplied-alpha) get a CPU decode-to-RGBA fallback only if encountered. **Recommendation: GPU S3TC path; gate DXT2/4 behind a fallback flag.** `[VERIFIED: swg-client-v2 Texture.cpp:115-129; CITED: synthesis §1.7/§2]`

### 2. Appearance-resolver home → **TypeScript (renderer/backend), binary fetch via the C++ TRE VFS**
The resolver is a name-keyed **graph/metadata** walk (SMAT→MSGN→MLOD→SKMG→SHT→DDS/PAL), exactly the layer CONTEXT carves out as "not binary." TS gets: faster iteration on the D-04 partial/warning logic, easy Zustand wiring for the LOD picker + customization UI, and trivial access to the Phase-1 TRE VFS via existing bindings. Binary payloads still cross zero-copy from C++; only the resolution decisions live in TS. **Recommendation: TS resolver; C++ stays pure parse + bridge.**

### 3. Baseline viewport chrome → **inspector default set**
Ship: infinite **grid** (drei `<Grid>`), **3-point lighting** rig (key/fill/rim) + a neutral ambient, dark neutral **background**, **OrbitControls** with damping (drei), **wireframe toggle**, **bounding-box toggle** (drei `<Box3Helper>`/`<bbAnchor>`), **camera auto-frame** to the loaded mesh bounds on open, and a **bone/skeleton-helper toggle** (Three.js `SkeletonHelper`) for VIEW-03 preview. These are the SIE/inspector-successor defaults; all available from drei/Three.js with no custom math.

### 4. `.ans` variant coverage for v1 → **CKAT 0001 + KFAT 0003; defer KFAT 0002 (Euler)**
Real assets are predominantly CKAT (compressed) — must-have. KFAT 0003 (raw quaternion) is the uncompressed sibling and cheap to add — include. KFAT 0002 (legacy Euler) requires porting the C++ Euler→quaternion bake (the Python oracle discards animated rotations there) and is rare; **defer to a follow-up unless a target asset needs it** (synthesis §5). Detect 0002 and surface a clear "unsupported legacy animation version" warning (D-04 ethos) rather than mis-rendering.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Real target `.ans` assets are predominantly CKAT (so CKAT is the v1 priority) | Claude's Discretion #4 / Pitfall 2 | If targets are mostly KFAT 0002, the deferred Euler path becomes required — add a task. Verify by enumerating `.ans` root tags across the mounted TREs early (cheap script). |
| A2 | `WEBGL_compressed_texture_s3tc` is available in the target Electron/desktop-GPU environment | Claude's Discretion #1 | If absent on some target GPU, DXT needs the CPU fallback for all variants. Verify at runtime with `gl.getExtension(...)` on first texture load; the fallback already exists for DXT2/4. |
| A3 | drei v10.7.7 supplies all chrome helpers (Grid/OrbitControls/Box3Helper/Environment) for R3F v9 | Standard Stack / Discretion #3 | Low risk (these are long-stable drei exports); if an API moved, substitute the Three.js primitive directly. |
| A4 | `leva` (if chosen) is acceptable as a dev-grade control panel | Supporting stack | Low; recommendation is bespoke Radix pickers for shipping UI, leva optional. |

## Open Questions

1. **`.eft` parsing depth for full material parity (D-07) — 5th parser vs slot-map table?** (Synthesis delta #4.)
   - Known: `.sht` (SSHT) names an `.eft` effect file; slot tags (MAIN/NRML/SPEC/EMIS/ENVM/MASK) live in the SSHT's TXMS form, NOT in the `.eft` HLSL.
   - Unclear: whether the toolkit needs to parse the `.eft` at all for v1, or whether the SSHT slot tags + a fixed slot→GLSL-uniform mapping table suffice for the standard material set.
   - Recommendation: **Start with the SSHT/CSHD slot tags + a slot→uniform mapping table** (no `.eft` parse); add a minimal `.eft` parser only if a target shader's behavior isn't recoverable from slots. Budget the `.eft` parser as a conditional task, not a hard one. Confirm against `StaticShaderTemplate.cpp:32-36,123-128`.

2. **Does any spot in the loaders contradict the locked synthesis?** Spot-checks this session (CKAT decode, SKMG chunk set, coordinate math) **all matched** the synthesis. No contradictions found. The synthesis Open Items (§5: w-clamp, quat-order, KFAT 0002 handling, Python version gaps) are the known residuals and are carried forward above — none invalidate a §1 layout.

3. **CORE-06 async-worker model for heavy parse** (carried from Phase-1 Claude's Discretion). The de-index/skin-normalize/DXT/anim-decode passes are the first real heavy parse. Recommend the C++ N-API `AsyncWorker`/libuv-threadpool path (parse off-thread, resolve the typed arrays back to the renderer), consistent with the Path-B in-renderer addon + SAB contract. Planner to confirm against the Phase-1 `tre-async-zerocopy` pattern.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Phase-1 IFF reader (`modules/core/iff`) | every new parser | ✓ | in-repo | — |
| Phase-1 TRE VFS + override resolver | appearance resolver (D-03/D-05) | ✓ | in-repo | — |
| CORE-05 harness (`packages/harness`) | standing gate (SC-5) | ✓ | in-repo, registry+sweep working | — |
| cmake-js / C++20 toolchain | new C++ parsers | ✓ | Phase-0/1 unified on C++20 | — |
| `three` / R3F / drei | render + export | ✗ (not yet installed) | target 0.184.0 / 9.6.1 / 10.7.7 | install task (Wave for materials/render) |
| WebGL2 + `WEBGL_compressed_texture_s3tc` | DXT GPU upload (VIEW-02) | runtime-checked | — | CPU decode-to-RGBA (A2) |
| Real `.msh`/`.mgn`/`.skt`/`.sat`/`.ans`/`.sht`/`.pal`/`.dds` assets | CORE-05 fixtures | partly (gitignored fixtures-real has TRE archives; individual assets must be extracted) | — | extract via Phase-1 TRE extractor into the gitignored scratch dir (D-10) |

**Missing dependencies with no fallback:** none blocking — `three`/R3F/drei are a routine install (gated behind a `checkpoint:human-verify` per the legitimacy audit, though slopcheck already cleared them).
**Missing with fallback:** S3TC extension (CPU decode fallback exists).

## Validation Architecture

Anchored on the **CORE-05 byte-exact round-trip gate** (`packages/harness/{assertRoundTrip.ts,fixtureRegistry.ts}`). Every SWG-format parser registers a real-asset fixture + a cited `swg-client-v2` loader line; the `registry-coverage` sweep fails CI if any registered format lacks a fixture or citation. **Round-trip is proven by re-serializing through the Phase-1 IFF writer** (clean nodes re-emit `capturedSlice` verbatim — Pattern 1), so the gate validates the IFF-level integrity; the typed decode is validated behaviorally by "renders correctly."

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest (bare-Node, over the ABI-stable prebuild — same as Phase 1) |
| Config file | existing per-package vitest setup (`packages/harness`, `packages/native-core/test`) |
| Quick run command | `pnpm --filter @swg/harness test` |
| Full suite command | `pnpm -r test` |

### Gated by CORE-05 (byte-exact round-trip; SC-5) — fixture extracted to gitignored scratch, cited oracle
| Deliverable | Real fixture | Cited swg-client-v2 oracle | Pass/fail signal |
|-------------|--------------|----------------------------|------------------|
| `.msh` (FORM MESH) parser | real static `.msh` | `MeshAppearanceTemplate.cpp` + `ShaderPrimitiveSetTemplate.cpp` + `VertexBuffer.cpp:73-200` | `serializeIff(parseIff(bytes))` byte-identical |
| `.mgn` (FORM SKMG) parser | real skinned `.mgn` | `SkeletalMeshGeneratorTemplate.cpp` (chunk set verified this session) | byte-identical round-trip |
| `.skt` (FORM SKTM) parser | real `.skt` | `BasicSkeletonTemplate.cpp` (`.../clientSkeletalAnimation/.../appearance/`) | byte-identical round-trip |
| `.sat` (FORM SMAT) parser | real `.sat` | `SkeletalAppearanceTemplate.cpp:786-1136` | byte-identical round-trip |
| `.lmg`/`.ldt` (MLOD/LDTB) parsers | real `.lmg`+`.ldt` | LOD path: `LodDistanceTable.cpp` + MLOD load | byte-identical round-trip |
| `.ans` (FORM KFAT/CKAT) parser | real CKAT `.ans` (+ a KFAT 0003) | `CompressedKeyframeAnimation.cpp` + `KeyframeSkeletalAnimation.cpp`; decoder `CompressedQuaternion.cpp:82-100,370-419` | byte-identical round-trip |
| `.sht` (SSHT/CSHD) parser | real `.sht` | `StaticShaderTemplate.cpp:32-36,123-128` + `CustomizableShaderTemplate.cpp:1246-1286` | byte-identical round-trip |
| `.pal` (RIFF PAL) parser | real `.pal` | `PaletteArgb.cpp:517-521` | byte-identical round-trip |
| `.dds` (header+mip table) | real `.dds` | `Texture.cpp:115-129` (format set) | header/mip-table round-trip (compressed blocks pass through unchanged) |

Cross-check oracle (second oracle, D-03 two-oracle rule): `../swg-blender-plugin/swg_scene/{mesh_static,mesh_skeletal,mesh_lod,animation,animation_compressed}.py`. Note (synthesis §5): Blender Python is version-incomplete (VTXA 0001/0002, LSPT 0000, SKMG VDCL not read) — port full version coverage from the C++; use Python only as cross-check.

### NOT gated by CORE-05 — validated behaviorally
| Deliverable | Validation | Pass/fail signal |
|-------------|-----------|------------------|
| VIEW-01 render (BufferGeometry from zero-copy buffer) | renders in viewport; CORE-06 zero-copy assertion (no post-bridge copy of pools) | mesh visible + orbit works; crossing buffer is the final attr array (not raw pool) |
| VIEW-02 materials + customization | renders with correct maps; live color-swap re-tints in real time | visual correctness; uniform mutation changes color with zero per-frame allocation |
| VIEW-03 skeleton + animation | skeleton previews; `.ans` plays back | animation plays; **no per-frame GC hitching** (profiler: no per-frame allocs in `useFrame`) |
| VIEW-04 glTF export | exported file opens in an external glTF viewer rigged+animated | "opens in external tool" (D-10) |
| VIEW-04 COLLADA export | exported `.dae` opens in a DCC tool rigged+animated | "opens in external tool" (D-10) |
| De-index + vec4-normalize passes | golden-vertex spot check vs oracle; visual deformation correct | top-4 weights renormalized to 1.0; bind pose + animation deform correctly |

### Sampling Rate
- **Per task commit:** `pnpm --filter @swg/harness test` (the registered format's round-trip + sweep).
- **Per wave merge:** `pnpm -r test` (full suite — all parsers + render unit checks).
- **Phase gate:** full suite green + each VIEW-0x behavioral signal demonstrated before `/gsd:verify-work`.

### Wave 0 Gaps
- [ ] Extract real per-format assets (`.msh/.mgn/.skt/.sat/.ans/.sht/.pal/.dds` + `.lmg/.ldt`) from a mounted client into the gitignored `packages/harness/fixtures-real/` scratch (via the Phase-1 TRE extractor; copies only, D-10).
- [ ] Register each new `FormatId` in `fixtureRegistry.ts` with parse/serialize (round-trip via `serializeIff`) + the cited oracle line above.
- [ ] Install `three`/R3F/drei in `packages/renderer` (gated behind a `checkpoint:human-verify` per the legitimacy audit, though slopcheck cleared them).
- [ ] Add a CORE-06 zero-copy assertion for mesh geometry (mirror `tre-async-zerocopy.test.ts`).
- [ ] One-time enumeration script: tally `.ans` root tags (CKAT vs KFAT 0002/0003) across mounted TREs to confirm assumption A1.

> Security Domain section omitted: this is a local desktop tool parsing trusted local assets; no auth/session/network surface in this phase. The relevant input-validation controls (per-chunk size caps, bounds checks, FourCC validation) are already enforced by the Phase-1 IFF reader that all new parsers build on (`Iff.h:146-149`), and new parsers must reject malformed/oversized chunks via the same path. (If `security_enforcement` is configured `true` project-wide, treat "every new parser inherits the Phase-1 IFF security caps and adds count/bounds validation on its own array reads" as the V5 Input Validation control.)

## Sources

### Primary (HIGH confidence)
- `.planning/research/CONSULT-P2-SYNTHESIS.md` — LOCKED format brief (§1 layouts, §2 render, §3 deltas, §4 doc corrections, §5 open items, §6 coordinates).
- `swg-client-v2/.../sharedMath/src/shared/CompressedQuaternion.cpp:82-100,370-419` — CKAT decoder (re-verified this session).
- `swg-client-v2/.../clientSkeletalAnimation/.../appearance/SkeletalMeshGeneratorTemplate.cpp` — SKMG chunk set (verified present this session).
- `swg-client-v2/.../clientGraphics/.../VertexBuffer.cpp:73-200`, `Texture.cpp:115-129`, `StaticShaderTemplate.cpp`, `CustomizableShaderTemplate.cpp`, `LodDistanceTable.cpp`, `PaletteArgb.cpp` — paths located/confirmed this session.
- `swg-client-v2/.../appearance/{BasicSkeletonTemplate,SkeletalAppearanceTemplate}.cpp`, `.../clientObject/.../MeshAppearanceTemplate.cpp` — located this session.
- `../swg-blender-plugin/swg_blender/{coords.py:13-26,export_animation.py:154-162}` — coordinate math (re-verified this session).
- `packages/native-core/modules/core/iff/Iff.h` — Phase-1 IFF reader API (hybrid-DOM verbatim re-emit).
- `packages/harness/{assertRoundTrip.ts,fixtureRegistry.ts}` — CORE-05 gate API.
- r3f.docs.pmnd.rs — R3F v9 ↔ React 19 pairing.

### Secondary (MEDIUM confidence)
- npm registry (`npm view`) — three 0.184.0, @react-three/fiber 9.6.1, @react-three/drei 10.7.7, @types/three 0.184.1, leva 0.10.1 (versions current this session).
- `../swg-blender-plugin/swg_scene/*.py` — second oracle (version-incomplete per synthesis §5; cross-check only).

### Tertiary (LOW confidence)
- Assumption A1 (CKAT dominance in target assets) — confirm by enumeration (Wave 0 task).

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — versions verified via npm this session; R3F/React pairing from official docs; slopcheck clean.
- Format layouts: HIGH — LOCKED synthesis + spot re-verification (CKAT, SKMG, coordinates) against source this session; no contradictions found.
- Architecture/bridge passes: HIGH — de-index/vec4/zero-copy reasoning grounded in the verified layouts + Phase-1 zero-copy contract.
- Pitfalls: HIGH — each maps to a verified delta or open item.
- `.eft` parsing depth: MEDIUM — recommendation is conditional (Open Question 1).

**Research date:** 2026-06-23
**Valid until:** ~2026-07-23 (format layouts are stable/locked indefinitely; npm versions ~30 days).
