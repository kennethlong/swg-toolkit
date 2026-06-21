# Meshes & Appearances

> Covers: meshes (`.msh`/`.mgn`/`.apt`/`.pob`), composite appearances (`.sat`), palette customization (`.pal`). Source: research doc lines 95–135, 207–592.

> **Caveat:** Binary format and struct details in this document are AI-proposed and have not been fully validated against the live client.  
> Verify against real `swg-client-v2` sources and community tools before treating anything here as authoritative.  
> See [source provenance](../00-overview/source-provenance.md).

---

## Overview

In Star Wars Galaxies, visual models are never a single monolithic mesh. The client uses a component-based layered system:

1. **Static/skinned geometry** — individual meshes stored as `.msh` (static) or `.mgn` (skinned/morphed). Appearance templates (`.apt`, `.pob`) point to these meshes and define how they are presented.
2. **Composite appearances** (`.sat`/`.appearance`) — a manifest that names a skeleton and assembles independent part-meshes (head, torso, armor overlays) onto specific bone sockets.
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
- `Uint16BufferAttribute` for index buffers and (when present) skin indices.
- `Float32BufferAttribute` for skin weights.

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
// Types for your SWG composite system

export interface SwgBoneSocket {
  boneName: string;
  attachmentId: string;
}

export interface SwgComponentPart {
  id: string;
  meshPath: string;        // Path inside TRE (e.g., 'appearance/mesh/human_m_tunic.mgn')
  targetSocket?: string;   // Optional bone socket connection
  customizations?: {
    palettePath: string;   // Pointer to variable color maps (.pal)
    variableIndex: number; // Index for color selection
  };
}

export interface SwgCompositeManifest {
  skeletonPath: string;    // Core skeletal definition (.sat / .skt)
  baseAppearance: string;  // Primary body mesh bounds
  parts: SwgComponentPart[];
  sockets: SwgBoneSocket[];
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

    // 1. Fetch the breakdown manifest from C++ N-API
    const manifest: SwgCompositeManifest = await this.napiBridge.parseAppearance(appearancePath);

    // 2. Load the core skeleton structure
    const skeletonData = await this.napiBridge.loadSkeleton(manifest.skeletonPath);
    const skeleton = this.buildThreeSkeleton(skeletonData);

    // 3. Concurrently load all individual attachment meshes
    const partPromises = manifest.parts.map(async (part) => {
      const geometry = await this.loadMeshGeometry(part.meshPath);
      const material = await this.resolveMaterial(part);

      // Create standard Three.js SkinnedMesh so it responds to the base skeleton bones
      const skinnedMesh = new THREE.SkinnedMesh(geometry, material);

      // Bind the mesh to our master skeleton hierarchy
      skinnedMesh.bind(skeleton);

      // Handle explicit hardpoint / socket attachments if specified
      if (part.targetSocket) {
        const bone = skeleton.getBoneByName(part.targetSocket);
        if (bone) {
          bone.add(skinnedMesh); // Parenting directly attaches it to the bone transform
          return;
        }
      }

      compositeGroup.add(skinnedMesh);
    });

    await Promise.all(partPromises);

    // Add root bone structure to the scene group so animations can update it
    if (skeleton.bones.length > 0) {
      compositeGroup.add(skeleton.bones[0]);
    }

    return compositeGroup;
  }

  private async loadMeshGeometry(meshPath: string): Promise<THREE.BufferGeometry> {
    if (this.geometryCache.has(meshPath)) {
      return this.geometryCache.get(meshPath)!.clone();
    }

    // Fetch zero-copy raw buffers from your Node-API binary bridge
    const rawData = await this.napiBridge.getMeshBuffers(meshPath);

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(rawData.vertices), 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(rawData.uvs), 2));

    if (rawData.skinIndices && rawData.skinWeights) {
      geometry.setAttribute('skinIndex', new THREE.BufferAttribute(new Uint16Array(rawData.skinIndices), 4));
      geometry.setAttribute('skinWeight', new THREE.BufferAttribute(new Float32Array(rawData.skinWeights), 4));
    }

    geometry.setIndex(new THREE.BufferAttribute(new Uint16Array(rawData.indices), 1));
    geometry.computeVertexNormals();

    this.geometryCache.set(meshPath, geometry);
    return geometry;
  }

  private async resolveMaterial(part: SwgComponentPart): Promise<THREE.Material> {
    // Basic material resolution stub.
    // In final implementation, extract .dds textures via N-API and apply SWG palette colors.
    return new THREE.MeshStandardMaterial({ color: 0x999999, roughness: 0.6 });
  }

  private buildThreeSkeleton(rawData: any): THREE.Skeleton {
    const bones: THREE.Bone[] = [];
    // Recurse through raw structural joints array from SWG skeleton definition
    rawData.joints.forEach((joint: any) => {
      const bone = new THREE.Bone();
      bone.name = joint.name;
      bone.position.fromArray(joint.position);
      bone.quaternion.fromArray(joint.rotation);
      bones.push(bone);
    });

    // Re-link hierarchy using parent index maps provided by IFF structure
    rawData.joints.forEach((joint: any, index: number) => {
      if (joint.parentIndex !== -1) {
        bones[joint.parentIndex].add(bones[index]);
      }
    });

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

- **Shared skeleton binding:** In SWG, all armor parts share the exact same rigging space as the default body mesh. Mapping every part to a single `THREE.Skeleton` via `.bind()` forces all independent meshes to animate in sync cleanly.
- **Component-level swapping:** Because each part is loaded in its own async loop, the React UI can toggle or substitute pieces on the fly (e.g., replacing `human_m_tunic.mgn` with `boba_fett_chest.mgn`) simply by modifying the parts state array.
- **Typed array allocation:** Extracting raw mesh data via `TypedArray` keeps memory allocations predictable and fast, which is critical when refreshing a scene view containing many objects.

---

## Palette Customization (`.pal`)

### How SWG Palette Customization Works

SWG assets avoid hardcoding distinct textures for color variants of the same item. Instead, texture maps are mostly **grayscale index masks** — specific channels (often the red channel) indicate which pixels receive a color overlay. A `.pal` file acts as an indexed color look-up grid containing the target RGB values for that variable.

To render this in a custom Three.js app without duplicating textures, pass the raw palette data into WebGL as a `DataTexture` and intercept the standard shader loop using `onBeforeCompile` on a `MeshStandardMaterial`. This retains built-in lighting, shadow casting, and skeletal animation automatically.

### Step 1 — Parsing the `.pal` FORM via Node-API

Like all SWG assets, `.pal` files use the hierarchical IFF format. A `.pal` file contains a `FORM` tag enclosing a `PAL` chunk, which is a plain array of 8-bit RGB or RGBA byte sequences. (See [../01-core-engine/iff-and-tre.md](../01-core-engine/iff-and-tre.md) for the generic IFF reader.)

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
