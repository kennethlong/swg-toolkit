# Phase 2: 3D Mesh Viewport (MVP Proof) - Context

**Gathered:** 2026-06-23
**Status:** Ready for planning

<domain>
## Phase Boundary

Validate the zero-copy contract end-to-end by rendering a **real SWG mesh** in the Three.js/R3F
viewport and giving the user a complete viewer-studio over it. Delivers **VIEW-01..04**:

- **VIEW-01** — open a static (`.msh`) or skinned (`.mgn`) mesh and render it with an orbit camera;
  geometry crosses the N-API bridge **zero-copy** into `BufferGeometry`.
- **VIEW-02** — apply `.dds` textures **and** `.pal` palette customization correctly (full material
  fidelity — see decisions).
- **VIEW-03** — preview a `.skt`/`.sat` skeleton and play back an `.ans` animation **without
  per-frame GC hitching**.
- **VIEW-04** — extract a raw asset and **export** a viewed mesh (rigged + animated) to glTF/COLLADA.

This is the "beats TRE Explorer on *viewing*" moment and the proof that the Phase-0/1 zero-copy
bridge works for real binary payloads (geometry, textures, bone matrices). **Standing gate (SC-5):**
every parser added here (`.msh`/`.mgn`/`.skt`/`.sat`/`.ans`/`.sht`/`.pal`/`.dds`) MUST pass the
Phase-1 byte-exact round-trip harness with a cited `swg-client-v2` loader source.

**Scope note (deliberate):** every gray-area decision below went to the ambitious end of the range.
Phase 2 is therefore a **large, complete viewer-studio**, not a thin proof — a conscious "wow
moment" call by the maintainer. The planner should **wave** it (static spine → skinned → materials
→ animation → export), not trim scope.

</domain>

<decisions>
## Implementation Decisions

### Scope & risk sequencing
- **D-01:** **Full VIEW-01..04 in one phase**, but **skinned `.mgn` leads as the real proof** — the
  hard case (skinned mesh + skeleton + animation) is what stresses zero-copy + GC the most, so it
  drives the phase; **static `.msh` falls out as the easy subset**, not a separate prerequisite
  milestone. (User explicitly rejected "static-only MVP, skinned deferred.") Planner still sequences
  internally into waves, but the success bar is the skinned path working.
- **D-02:** **Parse ALL LOD levels, expose a user-selectable LOD picker.** A `.msh`/`.mgn` is wrapped
  by an appearance/LOD structure with multiple detail levels — parse every level and let the user
  inspect each, rather than collapsing to LOD 0 only. More parser + UI surface, accepted.

### Open-flow & appearance composition
- **D-03:** **Smart-open by file type** (user chose "Both"):
  - Opening a `.sat`/`.apt` (appearance template) **auto-resolves the full dependency graph**
    (skeleton(s) + `.mgn` LODs + `.sht` shaders + `.dds`/`.pal` textures) across the mounted TREs and
    renders the composed result ("view the character" flow).
  - Opening a leaf `.mgn`/`.msh` **renders standalone in bind pose** with optional **manual attach**
    of a skeleton/animation ("inspect this one mesh" / debugging flow).
- **D-04:** **Missing-dependency handling = render partial + visible warning.** When a referenced
  texture/skeleton/shader is not present in the mounted TREs, render what resolved, substitute a
  clear placeholder (e.g. magenta/checker texture, default skeleton), and surface a `missing: X`
  warning panel. The viewer stays useful against an incomplete mount (inspector ethos) — do NOT
  hard-refuse the render.
- **D-05 (entry point reality):** A skinned object's appearance in SWG is composite — typically a
  `.sat` referencing skeleton(s) + mesh generators; static uses `.apt`→`.msh`. "Open a mesh" is
  really "resolve and compose an appearance across several files." The appearance-template parsers +
  a cross-TRE **resolver** are first-class deliverables, not incidental.

### Materials, textures & customization (VIEW-02)
- **D-06:** **Live interactive color-swapping.** Beyond rendering the asset's default customization
  correctly, **expose the shader customization variables as live controls** (color/palette pickers)
  so the user re-tints the asset in the viewport in real time. This is the explicit "beats TRE
  Explorer" wow moment. Requires plumbing customization indices → palette (`.pal`) → shader uniforms.
- **D-07:** **Full multi-map material parity.** Reproduce the `.sht` material faithfully — diffuse,
  normal, specular, environment/effect maps — mapped onto Three.js materials, not diffuse-only.
  Resolve the `.msh`/`.mgn` → `.sht` → texture chain in full. (User explicitly chose full parity over
  "diffuse-first, more maps if cheap.")

### Playback & export deliverables (VIEW-03 / VIEW-04)
- **D-08:** **Full animation transport UX** — timeline scrubber, play/pause, loop toggle, playback
  speed, **plus an `.ans` picker** (browse animations from the mount and apply to the loaded
  skeleton — an `.ans` is not bound to a mesh; it targets a skeleton).
- **D-09:** **GPU skinning via Three.js `SkinnedMesh`/`Skeleton`** — bone matrices to the GPU, no
  per-frame geometry rebuild, which naturally satisfies the VIEW-03 "no per-frame GC hitching"
  success criterion. Researcher to confirm the SWG bind-pose / bone-weight layout maps cleanly onto
  `SkinnedMesh` and to specify the GC-safe buffer-reuse strategy in the hot path.
- **D-10:** **Export = glTF + COLLADA, both rigged with animation.** Ship both exporters (glTF =
  modern/wide support; COLLADA = legacy DCC tooling), each including skeleton + animation when
  present. **Export-only this phase** — no re-import / round-trip of glTF/COLLADA back into SWG
  formats (that is not a Phase-2 goal). Note: the **SC-5 byte-exact gate applies to the SWG-format
  parsers**, not to the glTF/COLLADA *export* fidelity (export is one-way, validated by "opens in an
  external tool").

### Claude's Discretion (resolve in research/planning — architecture, not vision)
- **DDS decode path** — GPU compressed-texture upload (S3TC/DXT, keeps binary-stays-binary) vs CPU
  decode to RGBA. Confirm DXT1/3/5 coverage + WebGL extension availability; prefer zero-copy GPU
  upload where possible.
- **Appearance-resolver's home** — native C++ lib vs TS/renderer. Binary payloads stay binary
  zero-copy regardless; only the *graph-resolution/metadata* layer is in question.
- **Baseline viewport chrome** — grid, default lighting rig (e.g. 3-point), background, wireframe
  toggle, bounding box, camera framing. Pick a sensible inspector default set.
- **`.ans` compression variants** — keyframe vs compressed-keyframe animation (`KeyframeSkeletalAnimation`
  vs `CompressedKeyframeAnimation`); researcher determines which the target assets use and what must
  be supported for v1 playback.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.** Mesh/skeleton/animation/
shader binary layouts in `docs/02-formats/` are **AI-distilled hypotheses** — verify every layout
against the `swg-client-v2` loader source + real asset bytes (the project's #1 constraint, and the
STATE Phase-2 blocker). Paths are relative to repo root unless noted as a sibling (`../`).

### Ground-truth #1 — `swg-client-v2` loaders (the oracle; cite per the standing gate)
- `../swg-client-v2/src/engine/client/library/clientObject/src/shared/appearance/MeshAppearance.cpp`
  + `MeshAppearanceTemplate.cpp` + `DynamicMeshAppearance.cpp` + `DynamicMeshAppearanceShaderSet.cpp`
  — **static `.msh` / appearance + LOD compositing** loaders (VIEW-01, D-01/D-02).
- `../swg-client-v2/src/engine/client/library/clientSkeletalAnimation/src/shared/` — **skeleton
  (`.skt`), skeletal appearance (`.sat`), mesh generator (`.mgn`)** and the **`.ans` animation**
  loaders. Confirmed animation loaders here: `.../animation/KeyframeSkeletalAnimation.cpp` +
  `KeyframeSkeletalAnimationTemplate.cpp`, `CompressedKeyframeAnimation.cpp` +
  `CompressedKeyframeAnimationTemplate.cpp`, `AnimationCompressor.cpp` (VIEW-01 skinned, VIEW-03).
- `../swg-client-v2/src/engine/client/library/clientGraphics/src/shared/` — **`.sht` shader template
  chain + texture + LOD**: `ShaderTemplate.cpp`, `StaticShaderTemplate.cpp`,
  `CustomizableShaderTemplate.cpp` (← **customization variables → palette**, D-06),
  `Texture.cpp` (**`.dds` decode**, VIEW-02), `LodDistanceTable.cpp` (LOD selection, D-02),
  `ShaderPrimitiveSet*.cpp` (shader→geometry binding).
- `../swg-client-v2/.../clientGraphics/...` palette (`.pal` / `PaletteArgb`) + `CustomizationData`
  sources — **palette customization application** (VIEW-02, D-06). Researcher to pin the exact files.

### Ground-truth #2 — community readers (cross-check ambiguous layouts; D-03 two-oracle rule)
- `../swg-blender-plugin/swg_scene/` — **working Python readers** for the exact formats this phase
  needs: `mesh_static.py`, `mesh_skeletal.py` (+ `_export.py`), `mesh_lod.py`, `animation.py`,
  `animation_compressed.py` (+ `_export.py`). A pragmatic, verified second oracle.
- `../swg-blender-plugin/swg_blender/` — `import_skeletal.py` / `export_skeletal.py` /
  `export_animation.py` (skeleton + animation round-trip reference; informs VIEW-04 export + Phase-6
  `.ans` work).
- `../swg-blender-plugin/swg_pipeline/shader_*.py` — `shader_builder.py`, `shader_import.py`,
  `shader_effects.py`, `shader_extended.py` — **`.sht` shader + multi-map material** reference for
  full material parity (D-07).
- `../io_scene_swg_msh/` — older SWG mesh Blender plugin; additional `.msh` layout cross-reference.
- `../Utinni/UtinniCoreDotNet/Formats/` — C# format impls (note: no mesh/anim `Formats` files found
  on a quick scan; Utinni is primarily the IFF/TRE + injection oracle, not the mesh oracle here).

### Project design docs (this repo — starting design, verify against the source above)
- `docs/02-formats/meshes-and-appearances.md` — `.msh`/`.mgn`/`.apt` layouts (AI-distilled; VERIFY).
- `docs/02-formats/skeletons-and-animation.md` — `.skt`/`.sat`/`.ans` layouts (AI-distilled; VERIFY).
- `docs/03-rendering/shaders-and-fx.md` — `.sht` shader system + customization (D-06/D-07).
- `docs/03-rendering/viewport-tools.md` — viewport/orbit-camera/LOD/skinning design (VIEW-01/03).
- `docs/00-overview/architecture.md` — **zero-copy binary bridge rules + async worker discipline**
  (geometry/textures/bone-matrices stay binary; reuse objects in hot render loops — D-09, CORE-06).
- `docs/00-overview/source-provenance.md` — why the format docs are unverified hypotheses (#1 risk).
- `.planning/REQUIREMENTS.md` — VIEW-01..04 + the standing round-trip gate statement.
- `.planning/phases/01-core-engine-iff-tre-verification-harness/01-CONTEXT.md` — Phase-1 IFF/TRE
  reader + verification-harness decisions this phase builds directly on (the parsers consume the
  Phase-1 IFF tree + TRE VFS; new parsers register into the Phase-1 harness).
- `.planning/phases/00-toolchain-de-risk-app-shell/00-CONTEXT.md` — Path-B native-in-renderer +
  SAB zero-copy + dockview shell + `contracts/` typing this phase inherits.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`packages/native-core/`** — Phase-0/1 cmake-js N-API addon (`addon.cpp`, `iff_binding.cpp`,
  `tre_binding.cpp`, `sab*.cpp`). The new mesh/skeleton/animation/shader parsers land here as
  engine-free C++ over the Phase-1 IFF reader, with thin N-API bindings. The ABI-stable `--napi`
  prebuild serves both bare-Node (vitest harness) and Electron.
- **Phase-1 IFF parser + TRE VFS** — `.msh`/`.mgn`/`.skt`/`.sat`/`.ans`/`.sht` are all IFF
  FORM/chunk files; the Phase-1 IFF reader parses their container, the TRE VFS + override resolver
  locates dependency files across mounted archives (powers the D-03/D-05 appearance resolver).
- **Phase-1 verification harness (CORE-05)** — `assertRoundTrip`-style registry; every new parser
  registers a real-asset byte-exact fixture (SC-5). Reuse `copy-real-fixtures` + gitignored
  local-real fixtures discipline (D-09/D-10 from Phase 1) for real `.msh`/`.mgn`/`.ans` assets.
- **`packages/contracts/`** — extend with mesh/skeleton/animation/material message + byte-offset
  types so geometry/bone-matrix/texture payloads cross the bridge typed and zero-copy.
- **`packages/renderer/`** (dockview shell + TRE VFS browser + IFF tree, Phase 0/1) — host the new
  **3D viewport panel** (R3F), LOD picker, customization color pickers, and animation transport.

### Established Patterns
- **Path B (Phase 0):** native addon runs **in the renderer**; zero-copy via `SharedArrayBuffer`;
  `crossOriginIsolated === true`. **Binary stays binary** — geometry → `BufferGeometry`, textures →
  GPU, bone matrices → `SkinnedMesh`; never JSON for payloads. Reuse objects in the 60fps path (D-09).
- **Standing gate discipline** — no parser/serializer merges without a byte-exact round-trip on a
  real asset + a cited `swg-client-v2` loader source.
- **Engine-free C++ lib + thin N-API binding** (Phase 1, D-01/D-02) — same shape for mesh formats.

### Integration Points
- New format parsers → thin N-API binding → backend services → `contracts` types → R3F viewport.
- Heavy parse (mesh/skeleton/animation/DDS) runs **off the main thread** (CORE-06 async worker);
  geometry/bone-matrix buffers cross zero-copy into Three.js.
- Appearance resolver consumes the Phase-1 TRE VFS + override resolver to locate dependency files
  (D-03/D-05); missing deps → partial render + warning (D-04).

</code_context>

<specifics>
## Specific Ideas

- **"Beats TRE Explorer on viewing"** is the explicit bar — and the **live customization color
  swapping** (D-06) is the specific wow moment the maintainer wants front-and-center.
- **Attack the hard case first:** skinned `.mgn` + skeleton + animation is the deliberate lead, not
  static `.msh` (D-01) — the maintainer wants the proof to stress the real risk (zero-copy + GC).
- **Maximal fidelity, deliberately:** full multi-map material parity (D-07) + both glTF and COLLADA
  rigged exporters (D-10) were chosen over the smaller MVP options — Phase 2 is the showcase phase.
- **Two viewing modes by design** (D-03): "view the composed character" (`.sat`/`.apt` auto-compose)
  AND "inspect this one mesh" (leaf `.mgn`/`.msh` standalone) — successor to SIE's inspector ethos.

</specifics>

<deferred>
## Deferred Ideas

- **Re-import / round-trip of glTF/COLLADA back into SWG formats** — Phase 2 export is **one-way**
  (D-10). Bringing external-tool edits back into `.mgn`/`.ans` is the Blender-bridge / future story
  (Phase 6 handles authored `.ans` export from Blender).
- **In-viewport mesh/UV/weight/rig editing** — out of scope project-wide (bridge to Blender, not
  rebuild it). Phase 2 is view + export only.
- **Animation state graph / logical animation (`.ash`) authoring** — the `AnimationEditor` app in
  `swg-client-v2` is a rich reference, but Phase 2 only needs to **play back** an `.ans` on a
  skeleton, not author animation-state hierarchies.
- **Other appearance types beyond mesh/skinned** (particles `.prt`/`.eft`, terrain, portals/POB) —
  Phase 7 format-editor leaves, not Phase 2.

None of the above were scope-creep requests during discussion — the discussion stayed within the
VIEW-01..04 boundary; these are noted to keep the boundary crisp for the planner.

</deferred>

---

*Phase: 2-3D Mesh Viewport (MVP Proof)*
*Context gathered: 2026-06-23*
