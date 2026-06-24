# Meshes & Appearances

> Covers: meshes (`.msh`/`.mgn`/`.apt`/`.pob`), composite appearances (`.sat`), palette customization (`.pal`). Source: research doc lines 95–135, 207–592.

> **Verified** against `../swg-client-v2` (clientGraphics + clientSkeletalAnimation) and `../swg-blender-plugin`; see `.planning/research/CONSULT-P2-SYNTHESIS.md`.  
> Binary chunk layouts below supersede any prior AI-proposed content. High-level architecture and Three.js integration prose are retained where sound.

---

## Overview

In Star Wars Galaxies, visual models are never a single monolithic mesh. The client uses a component-based layered system:

1. **Static/skinned geometry** — individual meshes stored as `.msh` (static) or `.mgn` (skinned/morphed). Appearance templates (`.apt`, `.pob`) point to these meshes and define how they are presented.
2. **Composite appearances** (`.sat`) — `FORM SMAT`: a skeletal appearance template that lists mesh-generator paths (`MSGN` — each resolves to a `.lmg`/MLOD or `.mgn`/SKMG) and skeleton-template/attachment-transform pairs (`SKTI`). It is the auto-compose entry point, not a flat manifest of bone sockets.
3. **Palette customization** (`.pal`) — indexed color look-up tables applied at shader time via grayscale mask textures, so a single mesh asset can render in any color without duplicating textures.

Skeleton and animation internals (`.skt`, bone hierarchies, `AnimationMixer` clips) are covered in [skeletons-and-animation.md](./skeletons-and-animation.md) — this document cross-references that material but does not duplicate it.

IFF binary reading/writing boilerplate (`ReadTag`/`ReadUint32`/`WriteTag`/`PackChunk`) is covered in [../01-core-engine/iff-and-tre.md](../01-core-engine/iff-and-tre.md). DDS texture loading and TRE archive mounting are also covered there; only format-specific parsing is reproduced here.

---

## Mesh Parsing and Rendering (`.msh`, `.apt`, `.pob`)

### The N-API Hand-off

Do not convert vertex data into large JSON objects. The C++ N-API layer should parse the IFF structures (`MESH`, `APTM`, etc.) from TRE archives and return raw `ArrayBuffer` or `SharedArrayBuffer` objects directly to TypeScript. Keeping deserialization in C++ worker threads prevents the React UI thread from blocking during heavy reads.

### Feeding Buffers into Three.js BufferGeometry

Feed the raw typed arrays directly into a `THREE.BufferGeometry`:

- `Float32BufferAttribute` for vertex positions, normals, and UV coordinates.
- `Uint16BufferAttribute` for `.msh` triangle index buffers (LSPT v0001 `INDX`); `int32` per-index for `.mgn` `ITL`/`OITL` triangles — see format tables below.
- `Float32BufferAttribute` (vec4, fixed) for skin weights passed to Three.js `SkinnedMesh` — but the on-disk encoding in `.mgn` is **variable-count** pairs (`TWHD`/`TWDT`); a normalize-to-4-bones conversion is required before setting `skinIndex`/`skinWeight` attributes (see `.mgn` section below).

> **Note on normals:** both `.msh` and `.mgn` store authored normals (`VTXA F_normal` / `SKMG NORM+NIDX`). Use these directly — do **not** call `geometry.computeVertexNormals()` as a default, which overwrites the authored data and breaks round-trip fidelity.

This achieves native-level GPU throughput in the browser without an intermediate data copy.

### Skeletal Meshes (`.mgn`) and Particle Effects (`.eft`)

- **Skeletal animation:** Map SWG `.sat`/`.skt` skeleton structures to `THREE.SkinnedMesh` and `THREE.Skeleton`. Use `THREE.AnimationMixer` to blend and play back character animations. Full details are in [skeletons-and-animation.md](./skeletons-and-animation.md).
- **Particle systems:** Replicate SWG client effects (`.eft`) with `THREE.Points` or custom vertex shaders.

### React Three Fiber Ecosystem

Building directly in vanilla Three.js inside a React app produces messy lifecycle code. The recommended stack:

| Library | Role |
|---|---|
| **React Three Fiber (R3F)** | Wraps Three.js into declarative React components; keeps scene graph management clean. |
| **@react-three/drei** | Pre-built hooks for `TransformControls`, camera rigs (`OrbitControls`), and HTML overlays inside the 3D canvas. |
| **Zustand** | Lightweight state management that works both in the React render cycle and inside high-frequency R3F animation loops — synchronizes UI property panels with the 3D canvas. |

### Performance Pitfalls

- **Main thread blocking:** Keep all decompression and IFF parsing inside asynchronous C++ worker threads via Node-API. Synchronous parsing on the JS thread freezes the React UI.
- **Garbage collection in animation loops:** Avoid instantiating new `THREE.Vector3`, `THREE.Matrix4`, or similar objects inside `useFrame`/`requestAnimationFrame` callbacks. Pre-allocate and reuse global instances to prevent frame drops.
- **Thousands of small objects:** SWG world layouts can contain thousands of placed objects. Share geometries and materials via a cache (`Map<string, THREE.BufferGeometry>`) rather than cloning for every instance.

---

## Composite Appearances (`.sat`/`.appearance`)

### The Object-Model Strategy

A player or NPC character is assembled from independent meshes attached to a shared skeleton. The architecture uses three decoupled layers:

```
[ N-API C++ Asset Extraction ]
              |
 (Raw JSON Manifests + ArrayBuffers)
              |
              v
   [ TypeScript Composite Registry ]
 (Manages Cache, Dependency Trees)
              |
 +------------+------------+
 |            |            |
 v            v            v
[ Skeleton Rig ]  [ Part Loader ]  [ Customizations ]
(Assembles Bones) (Fetches .msh/.mgn) (Applies .pal/Shader)
 |            |            |
 +------------+------------+
              |
              v
  [ React Three Fiber Component ]
  (Outputs a Unified SkinnedMesh)
```

1. **N-API Bridge (C++)** — reads binary data from TRE archives and converts IFF structures into lightweight JSON manifests and flat typed arrays.
2. **Asset Registry (TypeScript)** — tracks asset dependencies, coordinates async cache checking, prevents loading duplicate assets.
3. **Composition Engine (Three.js/R3F)** — assembles individual meshes onto the shared skeleton, hooks up bone bindings, and manages visibility states.

### Step 1 — Defining the Composite Manifest

The N-API layer outputs a clean structural layout of the appearance map rather than passing raw binary chunks to the React layer:

```typescript
// Types for your SWG composite system — derived from FORM SMAT
// (SkeletalAppearanceTemplate.cpp:786–1136). A .sat binary holds only two lists:
// MSGN (mesh-generator path strings) and SKTI (skeleton-template / attachment pairs).
// There is NO flat parts[]/sockets[] manifest, no baseAppearance string, and no
// per-part customization block — those were fabricated. The N-API layer exposes this
// normalized shape; customization is resolved later at the shader/material level
// (the CSHD model — see resolveMaterial below), keyed off each mesh's PSDT shader.

export interface SwgSkeletonRef {
  // One SKTI pair. The first ref is the root skeleton; any additional ref grafts onto
  // the named transform of an already-loaded skeleton (multi-skeleton appearances).
  skeletonPath: string;            // e.g. 'appearance/skeleton/all_b.skt' (.skt → FORM SKTM)
  attachmentTransformName: string; // transform to attach to; '' / root for the first ref
}

export interface SwgCompositeManifest {
  // SKTI pairs (skeleton-template path + attachment-transform name).
  skeletonRefs: SwgSkeletonRef[];
  // MSGN list: each path resolves via TreeFile to a .lmg/MLOD (LOD chain) or directly
  // to a .mgn/SKMG (skinned mesh generator). No per-mesh socket — binding is by name.
  meshGeneratorPaths: string[];
}
```

### Step 2 — The TypeScript Composite Registry Loader

This layer coordinates fetching individual assets. It communicates with the Node-API backend via a bridge (Electron IPC, Tauri, or a local WebSocket/HTTP server) to fetch sub-meshes dynamically:

```typescript
import * as THREE from 'three';

export class SwgAssetRegistry {
  // Local cache to prevent redundant disk reads or processing
  private geometryCache = new Map<string, THREE.BufferGeometry>();
  private materialCache = new Map<string, THREE.Material>();

  constructor(private napiBridge: any) {}

  /**
   * Orchestrates the assembly of a full composite character
   */
  async loadCompositeAppearance(appearancePath: string): Promise<THREE.Group> {
    const compositeGroup = new THREE.Group();

    // 1. Fetch the FORM SMAT manifest (MSGN list + SKTI skeleton refs) from C++ N-API.
    const manifest: SwgCompositeManifest = await this.napiBridge.parseAppearance(appearancePath);

    // 2. Build the skeleton from the SKTI refs. The first ref is the root; any extra ref
    //    grafts onto its attachmentTransformName (multi-skeleton appearances). One shared
    //    THREE.Skeleton drives every mesh — bone binding is by NAME (see step 3).
    const skeleton = await this.buildSkeletonFromRefs(manifest.skeletonRefs);

    // 3. Concurrently resolve every mesh generator in the MSGN list. Each path resolves
    //    via TreeFile to a .lmg/MLOD LOD chain (pick a level) or directly to a .mgn/SKMG.
    const meshPromises = manifest.meshGeneratorPaths.map(async (generatorPath) => {
      const meshPath = await this.resolveMeshGenerator(generatorPath);
      if (!meshPath) return; // missing dep → skip + warn (partial render, see D-04)

      const geometry = await this.loadMeshGeometry(meshPath);
      const material = await this.resolveMaterial(meshPath);

      const skinnedMesh = new THREE.SkinnedMesh(geometry, material);

      // Name-keyed bind: the .mgn XFNM transform-name table is matched against the
      // skeleton's transform names (Skeleton::findTransformIndex). There is NO socket /
      // bone-index parenting — all skinned meshes share the same rig and bind by name.
      skinnedMesh.bind(skeleton);
      compositeGroup.add(skinnedMesh);
    });

    await Promise.all(meshPromises);

    // Add the root bone so the AnimationMixer can drive the shared skeleton.
    if (skeleton.bones.length > 0) {
      compositeGroup.add(skeleton.bones[0]);
    }

    return compositeGroup;
  }

  /**
   * Resolve an MSGN entry to a concrete mesh file. A .lmg (FORM MLOD) is a LOD chain of
   * generator paths + a companion .ldt (FORM LDTB) distance table; pick a level (0 = highest
   * detail) and resolve its NAME path, which is itself a .mgn/SKMG (or another generator).
   * A path that is already a .mgn/SKMG is returned as-is.
   */
  private async resolveMeshGenerator(generatorPath: string, lodLevel = 0): Promise<string | null> {
    const info = await this.napiBridge.probeGenerator(generatorPath); // { kind, lodPaths? }
    if (info?.kind === 'MLOD') {
      // info.lodPaths = MLOD NAME[] (capped at min(4, level_count) by the client).
      const level = Math.min(lodLevel, info.lodPaths.length - 1);
      return this.resolveMeshGenerator(info.lodPaths[level], 0); // recurse to the SKMG
    }
    return info?.kind === 'SKMG' ? generatorPath : null;
  }

  private async loadMeshGeometry(meshPath: string): Promise<THREE.BufferGeometry> {
    if (this.geometryCache.has(meshPath)) {
      return this.geometryCache.get(meshPath)!.clone();
    }

    // Fetch zero-copy raw buffers from your Node-API binary bridge. For .mgn the C++ side
    // has already run the PIDX/NIDX de-index pass and the normalize-to-4-bones skin pass.
    const rawData = await this.napiBridge.getMeshBuffers(meshPath);

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(rawData.vertices), 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(rawData.uvs), 2));

    if (rawData.skinIndices && rawData.skinWeights) {
      // skinIndices here must already be the C++-side normalized-to-4-bones result (Int32 TWDT
      // transform indices mapped to a fixed vec4 per vertex); see .mgn binary layout below.
      geometry.setAttribute('skinIndex', new THREE.BufferAttribute(new Int32Array(rawData.skinIndices), 4));
      geometry.setAttribute('skinWeight', new THREE.BufferAttribute(new Float32Array(rawData.skinWeights), 4));
    }

    geometry.setIndex(new THREE.BufferAttribute(new Uint16Array(rawData.indices), 1));

    if (rawData.normals) {
      // Use authored normals stored in VTXA (F_normal) or SKMG (NORM+NIDX).
      // Do NOT call geometry.computeVertexNormals() — it overwrites authored data
      // and breaks round-trip shading fidelity.
      geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(rawData.normals), 3));
    }

    this.geometryCache.set(meshPath, geometry);
    return geometry;
  }

  private async resolveMaterial(meshPath: string): Promise<THREE.Material> {
    // Material is keyed off the mesh's own shader: the .mgn PSDT NAME chunk names a .sht
    // (SSHT static, or CSHD which wraps an SSHT and adds palette-driven customization).
    // Customization (palette + variable index) lives HERE, on the shader, not on a "part".
    // Final impl: parse the .sht, upload .dds slots, and apply the CSHD .pal lookups.
    return new THREE.MeshStandardMaterial({ color: 0x999999, roughness: 0.6 });
  }

  /**
   * Build one shared THREE.Skeleton from the SKTI refs. The first ref is the root .skt;
   * each additional ref grafts its joints onto the named transform of the root rig.
   */
  private async buildSkeletonFromRefs(refs: SwgSkeletonRef[]): Promise<THREE.Skeleton> {
    const bones: THREE.Bone[] = [];
    const boneByName = new Map<string, THREE.Bone>();

    for (const ref of refs) {
      const sktData = await this.napiBridge.loadSkeleton(ref.skeletonPath); // .skt → SKTM joints
      const localBones: THREE.Bone[] = sktData.joints.map((joint: any) => {
        const bone = new THREE.Bone();
        bone.name = joint.name;
        bone.position.fromArray(joint.position);
        bone.quaternion.fromArray(joint.rotation);
        boneByName.set(joint.name, bone);
        return bone;
      });

      // Relink hierarchy via PRNT parent indices from the SKTM chunk.
      sktData.joints.forEach((joint: any, index: number) => {
        if (joint.parentIndex !== -1) {
          localBones[joint.parentIndex].add(localBones[index]);
        }
      });

      // Graft non-root skeletons onto the named attachment transform of the existing rig.
      if (ref.attachmentTransformName) {
        const anchor = boneByName.get(ref.attachmentTransformName);
        if (anchor && localBones.length > 0) anchor.add(localBones[0]);
      }

      bones.push(...localBones);
    }

    return new THREE.Skeleton(bones);
  }
}
```

### Step 3 — Integrating into React Three Fiber

Wrap the composite loader inside a clean functional component. The `active` flag in the effect cleanup prevents setting state on an unmounted component when the appearance path changes rapidly:

```tsx
import React, { useMemo, useEffect, useState } from 'react';
import { useGraph } from '@react-three/fiber';
import { TransformControls } from '@react-three/drei';

interface SwgActorProps {
  appearancePath: string;
  registry: SwgAssetRegistry;
  isSelected: boolean;
  onTransformChange?: (matrix: THREE.Matrix4) => void;
}

export const SwgActor: React.FC<SwgActorProps> = ({
  appearancePath,
  registry,
  isSelected,
  onTransformChange
}) => {
  const [sceneGroup, setSceneGroup] = useState<THREE.Group | null>(null);

  // Dynamically assemble character when path updates
  useEffect(() => {
    let active = true;
    registry.loadCompositeAppearance(appearancePath).then((group) => {
      if (active) setSceneGroup(group);
    });
    return () => { active = false; };
  }, [appearancePath, registry]);

  if (!sceneGroup) return null; // Or return a simple bounding box placeholder/wireframe

  return (
    <group>
      {isSelected ? (
        // Wrapper providing Utinni-style live manipulation widgets
        <TransformControls
          mode="translate"
          object={sceneGroup}
          onObjectChange={(e) => {
            if (e?.target?.object && onTransformChange) {
              onTransformChange(e.target.object.matrix);
            }
          }}
        />
      ) : null}
      <primitive object={sceneGroup} />
    </group>
  );
};
```

### Key Technical Challenges

- **Shared skeleton binding:** In SWG, every mesh generator shares the exact same rigging space (its `.mgn` `XFNM` names resolve against the same skeleton). Binding every `SkinnedMesh` to a single `THREE.Skeleton` via `.bind()` — name-keyed, not socketed — forces all meshes to animate in sync.
- **Component-level swapping:** Because each MSGN entry is resolved in its own async task, the React UI can toggle or substitute meshes on the fly (e.g., replacing `human_m_tunic.mgn` with `boba_fett_chest.mgn`) by editing the `meshGeneratorPaths` list and reloading.
- **Typed array allocation:** Extracting raw mesh data via `TypedArray` keeps memory allocations predictable and fast, which is critical when refreshing a scene view containing many objects.

---

## Binary Format Reference (Verified)

**Verified** against `../swg-client-v2` (clientGraphics + clientSkeletalAnimation) and `../swg-blender-plugin`; see `.planning/research/CONSULT-P2-SYNTHESIS.md`.

**IFF conventions (confirmed):** block tag + size = **big-endian** uint32; chunk payload scalars = **little-endian**; `Vector` = 3× float32 (X,Y,Z); strings = ASCII + NUL, no length prefix; chunk payloads are densely packed (no internal padding).

### `.sat` Skeletal Appearance Template — `FORM SMAT` (v0001/0002/0003)

Source: `SkeletalAppearanceTemplate.cpp:786–1136`; runtime = `SkeletalAppearance2`.

```
FORM SMAT → FORM 000{1,2,3}
  INFO
  MSGN   → mesh-generator path strings        (→ .lmg/MLOD or .mgn/SKMG)
  SKTI   → (skeletonPath, attachmentTransformName) PAIRS   (→ .skt/SKTM)
  [LATX] → .skt→.lat animation-table mapping   (v0003)
  [LDTB] [SFSK] [APAG]                         (v0003)
```

A `.sat` is the auto-compose entry point. It does **not** contain inline mesh data or a flat list of bone sockets — it references mesh generators by path (resolved via `TreeFile`) and skeleton templates by path. The N-API layer must follow `MSGN` paths: each resolves to either a `.lmg`/MLOD LOD chain or directly to a `.mgn`/SKMG skinned mesh.

### `.msh` Static Mesh — `FORM MESH` (v0002..0005)

Sources: `MeshAppearanceTemplate.cpp`, `ShaderPrimitiveSetTemplate.cpp`, `VertexBuffer.cpp:247–307`.

```
FORM MESH → FORM 0005
  [APPR]                           ← appearance metadata (extents, hardpoints); not geometry
  FORM SPS                         ← ShaderPrimitiveSet
    CHUNK CNT  { int32 shader_count }
    FORM 0001*                     ← per-shader group (one per shader_count)
      CHUNK NAME  { string+NUL }   ← .sht shader path (reference only)
      CHUNK INFO  { int32 primitive_count }
      FORM 0001*                   ← per-primitive LSPT (one per primitive_count)
        CHUNK INFO  { int32 primitive_type=9, bool8 has_indices, bool8 has_sorted_indices }
        FORM VTXA → FORM 0003
          CHUNK INFO  { uint32 flags, int32 vertex_count }
          CHUNK DATA  { interleaved vertex records }
        [CHUNK INDX  { int32 index_count, uint16[] indices }]   ← LSPT v0001
        [CHUNK SIDX  { direction-sorted index sub-buffers }]
```

**VTXA DATA interleave order** (present channels only, per `flags` bitmask, repeated `vertex_count` times):

| Order | Channel | Type | Flag |
|---|---|---|---|
| 1 | Position | 3× float32 (X,Y,Z) | `F_position` bit 0 |
| 2 | Transformed W | float32 | `F_transformed` bit 1 |
| 3 | Normal | 3× float32 | `F_normal` bit 2 |
| 4 | Point size | float32 | `F_pointSize` bit 13 (`0x2000`) |
| 5 | Color0 | uint32 (packed ARGB) | `F_color0` bit 3 |
| 6 | Color1 | uint32 (packed ARGB) | `F_color1` bit 4 |
| 7+ | Texcoords | float32 × dim | Per TC set `j`: dim = `((flags >> (12 + 2*j)) & 3) + 1` |

TC set count = `(flags >> 8) & 0xF`. Typical flags for pos+normal+1×2D UV: `0x00000305`.

`INDX` index width: **uint16** for LSPT v0001 (current assets); **int32** for LSPT v0000 (old assets). Python only implements v0001. SIDX (direction-sorted) uses the same width.

> **Three.js mapping:** `VTXA` is self-contained per primitive — no de-index pass needed for static meshes. Feed `INDX` as `Uint16BufferAttribute`. Use stored normals from `F_normal`; do NOT `computeVertexNormals()`.

### `.mgn` Skinned Mesh Generator — `FORM SKMG` (v0002/0003/0004)

Sources: `SkeletalMeshGeneratorTemplate.cpp:2169–3198` (load), cross-checked against `swg-blender-plugin/swg_scene/mesh_skeletal.py`.

```
FORM SKMG → FORM 000{2,3,4}
  CHUNK INFO    { 8× int32, 4× int16 counts — see table below }
  CHUNK SKTM    { string+NUL × skeleton_name_count }   ← skeleton template paths (inner chunk, NOT the .skt root FORM)
  CHUNK XFNM    { string+NUL × transform_name_count }  ← bone name table; TWDT indices key into this
  CHUNK POSN    { 3× float32 × position_count }        ← global bind-pose position pool
  CHUNK TWHD    { int32 × position_count }             ← weights-per-vertex; prefix sum into TWDT
  CHUNK TWDT    { (int32 transformIndex, float32 weight) × transform_weight_data_count }  ← VARIABLE count per vertex
  [CHUNK NORM   { 3× float32 × normal_count }]         ← global authored normal pool; omitted iff normal_count==0
  [CHUNK DOT3   { (x,y,z,flipState) 4× float32 × vector_count }]   ← v0004 only
  [CHUNK HPTS]  [CHUNK BLTS]  [OZN/OZC/FOZC/ZTO occlusion]
  FORM PSDT*   ← per-shader group (per_shader_data_count)
    CHUNK NAME   { string+NUL }       ← .sht path
    CHUNK PIDX   { int32 shader_vert_count; int32[] position_indices }  ← shader-local → global POSN
    [CHUNK NIDX  { int32[] normal_indices }]                            ← shader-local → global NORM
    [CHUNK DOT3  { int32[] dot3_indices }]                              ← v0004 PSDT
    [CHUNK VDCL  { (A,R,G,B) uint8 × shader_vert_count }]              ← per-shader vertex diffuse colors
    [CHUNK TXCI  { int32 set_count; int32[] dims }]
    [FORM TCSF → CHUNK TCSD* { float32 per texcoord }]                 ← one TCSD per set
    FORM PRIM
      CHUNK INFO   { int32 primitive_count }
      CHUNK ITL | CHUNK OITL  ← triangle lists (see below)
```

**`INFO` fields:**

| Field | Type |
|---|---|
| `max_transforms_per_vertex` | int32 |
| `max_transforms_per_shader` | int32 |
| `skeleton_name_count` | int32 |
| `transform_name_count` | int32 |
| `position_count` | int32 |
| `transform_weight_data_count` | int32 |
| `normal_count` | int32 |
| `per_shader_data_count` | int32 |
| `blend_target_count` | int32 |
| `occlusion_zone_name_count` | int16 |
| `occlusion_zone_combination_count` | int16 |
| `zones_this_occludes_count` | int16 |
| `occlusion_layer` | int16 |

**Triangle chunks inside `PRIM`:**
- `ITL` (non-occluded): `{ int32 triangle_count; (int32 i0, i1, i2)[] }` — shader-local indices
- `OITL` (occlusion-aware): `{ int32 triangle_count; (int16 zone_combo_index, int32 i0, i1, i2)[] }` — shader-local indices

Global position = `POSN[ PIDX[local] ]`. Skin weights = TWDT slice at `TWHD` offset for that global position. Zero-area triangles are culled on load (`SkeletalMeshGeneratorTemplate.cpp:1078–1126`).

**SKMG version differences:**

| Feature | 0002 | 0003 | 0004 |
|---|---|---|---|
| Global skin pools (`POSN/TWHD/TWDT/NORM`) | yes | yes | yes |
| `HPTS` hardpoints after `NORM` | yes | yes | yes |
| Global `DOT3` pool | no | no | yes |
| Per-shader `DOT3` indices in PSDT | yes (load_0002) | yes (load_0003≡0002) | yes (load_0004) |
| Per-shader `VDCL` vertex colors | yes | yes | yes |

> **Three.js bridge — skin weights:** `TWHD`/`TWDT` store a **variable number** of `(int32 transformIndex, float32 weight)` pairs per vertex. Three.js `SkinnedMesh` requires fixed **vec4** `skinIndex`/`skinWeight`. The C++ N-API layer must perform a **normalize-to-4-bones conversion**: sort influence pairs by descending weight, take the top 4, renormalize to sum=1, zero-pad shorter vertices. This is a required bridge task — not a trivial cast. The resulting `skinIndex` attribute uses `Int32Array`, **not** `Uint16Array`.
>
> **Three.js bridge — geometry de-indexing:** `.mgn` stores geometry in global pools (`POSN`/`NORM`) with per-shader `PIDX`/`NIDX` indirection. Building a `BufferGeometry` requires a **de-index pass** (gather global POSN/NORM at each shader-local index). This is best done C++-side before the zero-copy buffer crosses the N-API bridge. Use the authored `NORM` normals directly; do **not** call `computeVertexNormals()`.
>
> **Bone name resolution:** `transformIndex` in `TWDT` is an index into `XFNM` (the bone name table). Bone binding is **name-keyed**, not index-keyed, so the resolver matches against the `.skt`/SKTM hierarchy by name.

### LOD — External Indirection, Not Embedded

Sources: `LodMeshGeneratorTemplate.cpp`, `LodDistanceTable.cpp`; cross-checked against `mesh_lod.py`.

LOD levels are **not** embedded inside `.msh` or `.mgn` bytes. They use two companion files:

```
.lmg = FORM MLOD → FORM 0000
  CHUNK INFO  { int16 level_count }
  CHUNK NAME* { string+NUL }   ← per-level generator paths (→ .mgn/.msh/other)

.ldt = FORM LDTB → FORM 0000
  CHUNK INFO  { int16 level_count }
  per level:  float32 min_distance, float32 max_distance   ← stored squared at runtime
```

The client caps usable levels at `min(4, level_count)`. The appearance resolver must follow `.lmg` → generator paths: each path resolves via `TreeFile` to the actual mesh file for that LOD level. The `.ldt` distance table drives camera-distance selection. **D-02 ("user-selectable LODs") depends on parsing both files** — the resolver cannot find LOD levels by inspecting mesh bytes alone.

---

## Palette Customization (`.pal`)

### How SWG Palette Customization Works

SWG assets avoid hardcoding distinct textures for color variants of the same item. Instead, texture maps are mostly **grayscale index masks** — specific channels (often the red channel) indicate which pixels receive a color overlay. A `.pal` file acts as an indexed color look-up grid containing the target RGB values for that variable.

To render this in a custom Three.js app without duplicating textures, pass the raw palette data into WebGL as a `DataTexture` and intercept the standard shader loop using `onBeforeCompile` on a `MeshStandardMaterial`. This retains built-in lighting, shadow casting, and skeletal animation automatically.

### Step 1 — Parsing the `.pal` FORM via Node-API

**Verified** against `PaletteArgb.cpp:517–521` (swg-client-v2); see `.planning/research/CONSULT-P2-SYNTHESIS.md` §1.7.

`.pal` files are **Microsoft RIFF PAL** format, not SWG IFF: 24-byte header followed by `entryCount × 4` bytes (R, G, B, A per entry), maximum 1024 entries. Version 3 forces alpha = 255. (See [../01-core-engine/iff-and-tre.md](../01-core-engine/iff-and-tre.md) for the generic IFF reader; `.pal` parsing does not use the IFF reader.)

The C++ layer extracts the colors and passes them to TypeScript as a flat array of 32-bit floats normalized to `[0.0, 1.0]` for WebGL:

```typescript
export interface SwgPaletteData {
  paletteName: string;
  colors: number[]; // Flat array: [r, g, b, a, r, g, b, a, ...]
  colorCount: number;
}
```

### Step 2 — Building a Three.js DataTexture from the Palette

Convert the parsed colors into a 1D `DataTexture` so the GPU can look up color values inside the fragment shader without any JavaScript-side looping:

```typescript
import * as THREE from 'three';

export function createWebGLPalette(palData: SwgPaletteData): THREE.DataTexture {
  // Convert our flat color floats array into a WebGL-friendly Float32Array
  const dataFloatArray = new Float32Array(palData.colors);

  // Create a 1D DataTexture (Width = colorCount, Height = 1)
  const texture = new THREE.DataTexture(
    dataFloatArray,
    palData.colorCount,
    1,
    THREE.RGBAFormat,
    THREE.FloatType
  );

  // Set nearest filtering so colors don't bleed or blur together
  texture.minFilter = THREE.NearestFilter;
  texture.magFilter = THREE.NearestFilter;
  texture.needsUpdate = true;

  return texture;
}
```

### Step 3 — Injecting Custom Shader Logic via `onBeforeCompile`

Use `onBeforeCompile` to patch the standard `MeshStandardMaterial` fragment shader. This injects uniform declarations at the top of the shader and replaces the `<map_fragment>` include to apply the palette lookup:

```typescript
export function createSwgCustomMaterial(
  baseDiffuseMap: THREE.Texture,       // The normal grayscale/diffuse game texture
  customizationMaskMap: THREE.Texture, // The SWG channel mask texture
  paletteTex: THREE.DataTexture,       // The texture generated in Step 2
  colorIndex: number                   // The index slot chosen by the user (e.g., 4)
) {
  const material = new THREE.MeshStandardMaterial({
    map: baseDiffuseMap,
    roughness: 0.5,
    metalness: 0.1,
  });

  // Unique uniforms configuration for this material instance
  const customUniforms = {
    uCustomMask: { value: customizationMaskMap },
    uPalette: { value: paletteTex },
    uColorCount: { value: paletteTex.image.width },
    uSelectedColorIndex: { value: colorIndex } // Dynamically modifiable
  };

  material.onBeforeCompile = (shader) => {
    // Inject our custom parameters into the material's uniform block
    Object.assign(shader.uniforms, customUniforms);

    // 1. Inject uniforms declaration at the top of the Fragment Shader
    shader.fragmentShader = `
      uniform sampler2D uCustomMask;
      uniform sampler2D uPalette;
      uniform float uColorCount;
      uniform float uSelectedColorIndex;
    \n` + shader.fragmentShader;

    // 2. Intercept color output step before lighting calculation
    const mapFragmentRegex = /#include <map_fragment>/;

    shader.fragmentShader = shader.fragmentShader.replace(mapFragmentRegex, `
      #include <map_fragment>

      // Read the masking data from the game asset layout texture
      vec4 mask = texture2D(uCustomMask, vMapUv);

      // If mask R channel is flagged (> 0.5), fetch the color from the .pal texture strip
      if (mask.r > 0.5) {
        // Calculate horizontal UV coordinate hitting the center of our chosen color index slot
        float texelCoordX = (uSelectedColorIndex + 0.5) / uColorCount;
        vec4 customColor = texture2D(uPalette, vec2(texelCoordX, 0.5));

        // Multiply diffuse grayscale base against the palette color output
        diffuseColor.rgb *= customColor.rgb;
      }
    `);
  };

  // Expose configuration adjustments directly through properties
  return {
    material,
    setPaletteColorIndex: (index: number) => {
      customUniforms.uSelectedColorIndex.value = index;
    }
  };
}
```

The GLSL fragment patch in plain form (for reference):

```glsl
// Injected into MeshStandardMaterial fragment shader at <map_fragment>

uniform sampler2D uCustomMask;
uniform sampler2D uPalette;
uniform float uColorCount;
uniform float uSelectedColorIndex;

// ... (after #include <map_fragment>) ...

vec4 mask = texture2D(uCustomMask, vMapUv);

if (mask.r > 0.5) {
  float texelCoordX = (uSelectedColorIndex + 0.5) / uColorCount;
  vec4 customColor = texture2D(uPalette, vec2(texelCoordX, 0.5));
  diffuseColor.rgb *= customColor.rgb;
}
```

### Step 4 — Hooking Up React UI State

Connect the color-index selector to a `SwgCustomizedMesh` component. Changing a slider or color swatch in the UI updates the `uSelectedColorIndex` uniform in real time with no material rebuild:

```tsx
import React, { useMemo } from 'react';
import { useLoader } from '@react-three/fiber';
import * as THREE from 'three';

interface Props {
  geometry: THREE.BufferGeometry;
  diffusePath: string;
  maskPath: string;
  paletteData: SwgPaletteData;
  activeColorIndex: number;
}

export const SwgCustomizedMesh: React.FC<Props> = ({
  geometry,
  diffusePath,
  maskPath,
  paletteData,
  activeColorIndex
}) => {
  // 1. Load textures using built-in hooks
  const [diffuse, mask] = useLoader(THREE.TextureLoader, [diffusePath, maskPath]);

  // 2. Memoize palette generation logic to avoid asset re-allocation drops
  const paletteTexture = useMemo(() => createWebGLPalette(paletteData), [paletteData]);

  // 3. Compile custom material configuration layers
  const materialContainer = useMemo(() => {
    return createSwgCustomMaterial(diffuse, mask, paletteTexture, activeColorIndex);
  }, [diffuse, mask, paletteTexture]);

  // 4. Update index parameters when options drop or sliders shift
  materialContainer.setPaletteColorIndex(activeColorIndex);

  return <mesh geometry={geometry} material={materialContainer.material} />;
};
```

### Performance Advantages

- **Minimal memory overhead:** A single flat palette texture and a grayscale mask handle all color variants without duplicating the base texture per variant.
- **Instantaneous previews:** Updating `uSelectedColorIndex` on an existing material uniform takes effect in the next GPU frame — no shader recompilation, no loading stall.
