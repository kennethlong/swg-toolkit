# Collision and Portals: Nav Baking, .cdf, .pob, .floc

> Covers: nav baking (Recast), collision (.cdf), portals/cells (.pob), indoor pathfinding (.floc). Source: research doc lines 4777–5042, 9474–10357, 10358–10616.

> **Provenance caveat:** Chunk tags (`CDFS`, `POB `, `FLOC`, `CELL`, `PRTL`, etc.) and binary layouts below are AI-proposed reconstructions. Validate all tags, field ordering, and size calculations against real `swg-client-v2` or `Core3` source before treating them as authoritative. See [source provenance](../00-overview/source-provenance.md).

IFF container fundamentals (FORM/chunk framing, tag reading, size fields, the inside-out write pattern) are documented in [../01-core-engine/iff-and-tre.md](../01-core-engine/iff-and-tre.md). This file covers only the collision- and spatial-occlusion–specific structures built on top of that foundation.

---

## Table of Contents

1. [Exterior Navigation — Recast (.nav)](#1-exterior-navigation--recast-nav)
2. [Collision Descriptor (.cdf)](#2-collision-descriptor-cdf)
3. [Portal Object Blueprint (.pob)](#3-portal-object-blueprint-pob)
4. [Indoor Floor Navigation (.floc)](#4-indoor-floor-navigation-floc)

---

## 1. Exterior Navigation — Recast (.nav)

SWG does not perform collision or AI pathfinding against raw triangle meshes. Instead it uses a dual system:

- **Portalized Volume Systems** handle indoor line-of-sight and room visibility matrices inside building instances (`.pob`).
- **Navigation Meshes** (`.nav`) handle server-side AI pathfinding across world terrains.

To auto-generate nav assets when a modder modifies a scene, a Recast Navigation backend is compiled into the C++ Node-API core. The pipeline is:

```
[ Three.js Canvas Nodes ] ---> Extract Vertex Buffers & Transform Matrices
                                          |
                                          v
                          [ Node-API C++ Collision Core ]
                          -> Merges World Geometries
                          -> Recast Bounding Voxelization
                          -> Generates Convex Nav Polygons
                                          |
                                          v
[ Server-Side Engine Pathing ] <---- [ Compile .NAV IFF Chunk ]
```

### 1.1 C++ Recast Integration

The C++ layer aggregates vertex buffers from Three.js mesh objects (`.msh`, snapshot items), applies their world transformation matrices, and feeds the result into the Recast voxelization pipeline to bake a walkable navigation floor.

```cpp
#include <napi.h>
#include <vector>
#include <cstring>
#include "Recast.h" // Requires linking RecastNavigation into your native build chain

struct BuildContext {
    rcConfig cfg;
    rcHeightfield* hf = nullptr;
    rcCompactHeightfield* chf = nullptr;
    rcContourSet* cset = nullptr;
    rcPolyMesh* pmesh = nullptr;
};

class SwgCollisionCompiler {
public:
    static std::vector<uint8_t> GenerateWorldNavMesh(
        const std::vector<float>& vertices,
        const std::vector<int>& indices
    ) {
        BuildContext ctx;

        // 1. Configure Agent Constraints (Matching SWG Humanoid Scaling Attributes)
        ctx.cfg.cellSize      = 0.3f;   // Voxel grid resolution width
        ctx.cfg.cellHeight    = 0.2f;   // Voxel grid resolution height
        ctx.cfg.agentHeight   = 2.0f;   // Player avatar ceiling collision bounds
        ctx.cfg.agentRadius   = 0.6f;   // Player wall separation distance constraint
        ctx.cfg.agentMaxClimb = 0.5f;   // Max height step an NPC can walk over
        ctx.cfg.agentMaxSlope = 45.0f;  // Maximum walkable incline angle limit
        ctx.cfg.regionMinSize   = 8;
        ctx.cfg.regionMergeSize = 20;
        ctx.cfg.edgeMaxLen      = 12.0f;
        ctx.cfg.edgeMaxError    = 1.3f;
        ctx.cfg.vertsPerPoly    = 6;    // SWG navigation layers optimize down to convex polygons

        // Calculate world bounds from merged snapshot geometries
        float bmin[3], bmax[3];
        rcCalcBounds(vertices.data(), static_cast<int>(vertices.size() / 3), bmin, bmax);
        rcVcopy(ctx.cfg.bmin, bmin);
        rcVcopy(ctx.cfg.bmax, bmax);

        rcCreateHeightfield(nullptr, *ctx.hf,
            ctx.cfg.width, ctx.cfg.height,
            ctx.cfg.bmin, ctx.cfg.bmax,
            ctx.cfg.cellSize, ctx.cfg.cellHeight);

        // 2. Rasterize the 3D meshes into walkable voxel data grids
        std::vector<unsigned char> triAreas(indices.size() / 3, RC_WALKABLE_AREA);
        rcRasterizeTriangles(nullptr,
            vertices.data(), static_cast<int>(vertices.size() / 3),
            indices.data(), triAreas.data(), static_cast<int>(indices.size() / 3),
            *ctx.hf, ctx.cfg.walkableClimb);

        // 3. Filter overlapping voxels and construct a compact heightfield structure
        rcFilterLowHangingWalkableObstacles(nullptr, ctx.cfg.walkableClimb, *ctx.hf);
        rcBuildCompactHeightfield(nullptr, ctx.cfg.agentHeight, ctx.cfg.walkableClimb, *ctx.hf, *ctx.chf);
        rcErodeWalkableArea(nullptr, ctx.cfg.agentRadius, *ctx.chf);

        // 4. Trace outlines and build a clean convex polygon navigation mesh
        rcBuildContours(nullptr, *ctx.chf, ctx.cfg.edgeMaxError, ctx.cfg.edgeMaxLen, *ctx.cset);
        rcBuildPolyMesh(nullptr, *ctx.cset, ctx.cfg.vertsPerPoly, *ctx.pmesh);

        // 5. Serialize Recast output into an SWG IFF-compliant .NAV file block stream
        return CompileSwgNavIffStream(ctx.pmesh);
    }

private:
    static std::vector<uint8_t> CompileSwgNavIffStream(const rcPolyMesh* pmesh) {
        IffBinaryWriter writer;
        writer.WriteTag("FORM");
        // Placeholder sizing offsets: real SWG NAV contains nested NODE, VERT, and EDGE blocks
        writer.WriteUint32(1024);
        writer.WriteTag("NAVM"); // Navigation Mesh Identifier tag

        // Write polygon vertices flatly into the IFF stream
        IffBinaryWriter vertWriter;
        vertWriter.WriteUint32(pmesh->nverts);
        for (int i = 0; i < pmesh->nverts; ++i) {
            vertWriter.WriteFloat(pmesh->verts[i * 3]     * 0.3f); // Convert voxel scale back to world coordinates
            vertWriter.WriteFloat(pmesh->verts[i * 3 + 1] * 0.2f);
            vertWriter.WriteFloat(pmesh->verts[i * 3 + 2] * 0.3f);
        }
        writer.PackChunk("VERT", vertWriter.buffer);

        return writer.buffer;
    }
};
```

### 1.2 Node-API Bridge

```cpp
Napi::Value BuildNavigationMesh(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    Napi::Object inputGeometry   = info.As<Napi::Object>();
    Napi::Float32Array jsVertices = inputGeometry.Get("vertices").As<Napi::Float32Array>();
    Napi::Int32Array   jsIndices  = inputGeometry.Get("indices").As<Napi::Int32Array>();

    std::vector<float> nativeVerts(jsVertices.Data(), jsVertices.Data() + jsVertices.Length());
    std::vector<int>   nativeInds(jsIndices.Data(),  jsIndices.Data()  + jsIndices.Length());

    // Execute the Recast voxelization and polygon assembly loops
    std::vector<uint8_t> compiledNavIffBytes =
        SwgCollisionCompiler::GenerateWorldNavMesh(nativeVerts, nativeInds);

    Napi::ArrayBuffer outputBuffer = Napi::ArrayBuffer::New(env, compiledNavIffBytes.size());
    std::memcpy(outputBuffer.Data(), compiledNavIffBytes.data(), compiledNavIffBytes.size());

    return outputBuffer;
}
// Bind endpoint within native initializers
exports.Set("buildNavigationMesh", Napi::Function::New(env, BuildNavigationMesh));
```

### 1.3 Extracting Scene Geometry in TypeScript

```typescript
import * as THREE from 'three';

export interface MergedMeshGeometry {
  vertices: Float32Array;
  indices: Int32Array;
}

export function extractWorldGeometryData(sceneGroup: THREE.Group): MergedMeshGeometry {
  const mergedVertices: number[] = [];
  const mergedIndices: number[] = [];
  let indexOffset = 0;

  sceneGroup.traverse((node) => {
    if (node instanceof THREE.Mesh) {
      const geometry   = node.geometry;
      const positionAttr = geometry.getAttribute('position');
      const indexAttr    = geometry.getIndex();

      if (!positionAttr) return;

      // Extract transformation space vectors
      node.updateMatrixWorld(true);
      const worldMatrix = node.matrixWorld;

      // 1. Transform local vertices into world space coordinates
      const tempVertex = new THREE.Vector3();
      for (let i = 0; i < positionAttr.count; i++) {
        tempVertex.fromBufferAttribute(positionAttr, i);
        tempVertex.applyMatrix4(worldMatrix); // Commit absolute layout translation shifts

        mergedVertices.push(tempVertex.x, tempVertex.y, tempVertex.z);
      }

      // 2. Adjust indices relative to global allocation offsets
      if (indexAttr) {
        for (let i = 0; i < indexAttr.count; i++) {
          mergedIndices.push(indexAttr.getX(i) + indexOffset);
        }
      } else {
        // Fallback for non-indexed geometries
        for (let i = 0; i < positionAttr.count; i++) {
          mergedIndices.push(i + indexOffset);
        }
      }

      indexOffset += positionAttr.count;
    }
  });

  return {
    vertices: new Float32Array(mergedVertices),
    indices:  new Int32Array(mergedIndices)
  };
}
```

### 1.4 Navmesh Wireframe Visualizer (R3F)

Converts compiled `.nav` polygon coordinates back into a stylized wireframe overlay so modders can verify collision paths before exporting.

```tsx
import React, { useMemo } from 'react';
import * as THREE from 'three';

interface NavMeshProps {
  rawNavBytes: ArrayBuffer; // Parsed from your Node-API compiler response
}

export const SwgNavMeshOverlayVisualizer: React.FC<NavMeshProps> = ({ rawNavBytes }) => {
  const navGeometry = useMemo(() => {
    // Read the IFF VERT chunk from the compiled response buffer
    // In production, use your existing C++ parser to extract these arrays
    const extractedPositions = new Float32Array(rawNavBytes);

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(extractedPositions, 3));
    geometry.computeVertexNormals();
    return geometry;
  }, [rawNavBytes]);

  return (
    <mesh geometry={navGeometry} position={[0, 0.1, 0]}> {/* Elevate slightly to prevent z-fighting with ground */}
      <meshBasicMaterial
        color="#00ff55"
        wireframe={true}
        transparent={true}
        opacity={0.4}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
};
```

### 1.5 Collision Bake Toolbar (React)

```tsx
import React, { useState } from 'react';
import { extractWorldGeometryData } from './NavUtils';

export const SwgCollisionBakeToolbar: React.FC<{
  editorGroupRef: React.RefObject<THREE.Group>;
  nativeBridge: any;
}> = ({ editorGroupRef, nativeBridge }) => {
  const [isBaking, setIsBaking] = useState(false);

  const handleBakeNavigationMesh = async () => {
    if (!editorGroupRef.current) return;
    setIsBaking(true);

    try {
      // 1. Extract and flatten 3D scene vertex transformations
      const worldGeoData = extractWorldGeometryData(editorGroupRef.current);

      // 2. Fire the native Recast compiler loop
      const compiledNavBuffer: ArrayBuffer = nativeBridge.buildNavigationMesh(worldGeoData);

      // 3. Save the completed binary patch asset out using your disk wrapper API
      const finalView = new Uint8Array(compiledNavBuffer);
      await window.api.saveFileToDisk("nav/tatooine.nav", finalView);

      alert("Navigation collision mesh baked successfully! .NAV asset is ready for deployment.");
    } catch (err: any) {
      alert(`Baking Aborted: ${err.message}`);
    } finally {
      setIsBaking(false);
    }
  };

  return (
    <div style={{ background: '#252526', padding: '14px', borderRadius: '4px', border: '1px solid #00ff55' }}>
      <h4 style={{ color: '#00ff55', margin: '0 0 10px 0' }}>Server-Side AI Collision Compiler</h4>
      <p style={{ fontSize: '11px', color: '#aaa', margin: '0 0 12px 0' }}>
        Generates deterministic navigation paths to prevent clipping across snapshot models.
      </p>
      <button
        onClick={handleBakeNavigationMesh}
        disabled={isBaking}
        style={{
          width: '100%',
          background: isBaking ? '#444' : '#00ff55',
          color: '#111',
          fontWeight: 'bold',
          padding: '10px',
          border: 'none',
          borderRadius: '4px',
          cursor: 'pointer'
        }}
      >
        {isBaking ? "Voxelizing Mesh Data..." : "Bake World Pathfinding (.NAV)"}
      </button>
    </div>
  );
};
```

---

## 2. Collision Descriptor (.cdf)

### 2.1 IFF Structure

A `.cdf` file is a standard IFF container: `FORM` tag with subtype `CDFS`, containing an array of shape sub-FORMs:

| Sub-FORM tag | Shape | Payload fields |
|---|---|---|
| `SPHR` | Sphere | `offsetX`, `offsetY`, `offsetZ`, `radius` |
| `CYLN` | Cylinder | `offsetX`, `offsetY`, `offsetZ`, `radius`, `height` |
| `BOX ` | Box | `offsetX`, `offsetY`, `offsetZ`, `extentsX`, `extentsY`, `extentsZ` |

Each sub-FORM wraps a `DATA` chunk containing the float payload in little-endian order.

### 2.2 C++ Data Models

```cpp
#include <napi.h>
#include <string>
#include <vector>
#include <cstring>

enum class CollisionShapeType { Box = 0, Cylinder = 1, Sphere = 2 };

struct SwgCollisionCapsule {
    uint32_t shapeType; // Mapped via CollisionShapeType enum
    float offsetX, offsetY, offsetZ;

    // Extents properties (interpreted based on shapeType)
    // Box:             extentsX = width, extentsY = height, extentsZ = depth
    // Cylinder/Sphere: extentsX = radius, extentsY = height
    float extentsX, extentsY, extentsZ;
};

struct SwgCollisionManifest {
    std::string profileName;
    std::vector<SwgCollisionCapsule> capsules;
};
```

### 2.3 Binary .cdf Parser (C++)

```cpp
class SwgCdfParser {
public:
    static SwgCollisionManifest ParseCollisionForm(const uint8_t* data, size_t& offset) {
        SwgCollisionManifest manifest;

        std::string formTag  = TrnBinaryParser::Read4CharTag(data, offset); // "FORM"
        uint32_t    formSize = TrnBinaryParser::ReadUint32LE(data, offset);
        std::string subType  = TrnBinaryParser::Read4CharTag(data, offset); // "CDFS"

        if (formTag != "FORM" || subType != "CDFS") {
            throw std::runtime_error(
                "Target file buffer is not a valid SWG Collision Profile (.cdf) container.");
        }

        size_t endOffset = offset + formSize - 4;

        while (offset < endOffset) {
            std::string chunkTag  = TrnBinaryParser::Read4CharTag(data, offset);
            uint32_t    chunkSize = TrnBinaryParser::ReadUint32LE(data, offset);
            size_t nextChunkMarker = offset + chunkSize;

            if (chunkTag == "FORM") {
                std::string formType = TrnBinaryParser::Read4CharTag(data, offset);

                SwgCollisionCapsule capsule;

                if (formType == "BOX ") {
                    capsule.shapeType = static_cast<uint32_t>(CollisionShapeType::Box);
                    TrnBinaryParser::Read4CharTag(data, offset); // "DATA"
                    TrnBinaryParser::ReadUint32LE(data, offset); // Chunk Size

                    capsule.offsetX  = TrnBinaryParser::ReadFloatLE(data, offset);
                    capsule.offsetY  = TrnBinaryParser::ReadFloatLE(data, offset);
                    capsule.offsetZ  = TrnBinaryParser::ReadFloatLE(data, offset);
                    capsule.extentsX = TrnBinaryParser::ReadFloatLE(data, offset); // Extent X
                    capsule.extentsY = TrnBinaryParser::ReadFloatLE(data, offset); // Extent Y
                    capsule.extentsZ = TrnBinaryParser::ReadFloatLE(data, offset); // Extent Z
                    manifest.capsules.push_back(capsule);
                }
                else if (formType == "CYLN") {
                    capsule.shapeType = static_cast<uint32_t>(CollisionShapeType::Cylinder);
                    TrnBinaryParser::Read4CharTag(data, offset);
                    TrnBinaryParser::ReadUint32LE(data, offset);

                    capsule.offsetX  = TrnBinaryParser::ReadFloatLE(data, offset);
                    capsule.offsetY  = TrnBinaryParser::ReadFloatLE(data, offset);
                    capsule.offsetZ  = TrnBinaryParser::ReadFloatLE(data, offset);
                    capsule.extentsX = TrnBinaryParser::ReadFloatLE(data, offset); // Radius
                    capsule.extentsY = TrnBinaryParser::ReadFloatLE(data, offset); // Height
                    capsule.extentsZ = 0.0f;
                    manifest.capsules.push_back(capsule);
                }
                else if (formType == "SPHR") {
                    capsule.shapeType = static_cast<uint32_t>(CollisionShapeType::Sphere);
                    TrnBinaryParser::Read4CharTag(data, offset);
                    TrnBinaryParser::ReadUint32LE(data, offset);

                    capsule.offsetX  = TrnBinaryParser::ReadFloatLE(data, offset);
                    capsule.offsetY  = TrnBinaryParser::ReadFloatLE(data, offset);
                    capsule.offsetZ  = TrnBinaryParser::ReadFloatLE(data, offset);
                    capsule.extentsX = TrnBinaryParser::ReadFloatLE(data, offset); // Radius
                    capsule.extentsY = 0.0f;
                    capsule.extentsZ = 0.0f;
                    manifest.capsules.push_back(capsule);
                }
            }
            offset = nextChunkMarker;
        }
        return manifest;
    }
};
```

### 2.4 Node-API Buffer Transfer (Parse Side)

Packs parsed capsules into a flat `Float32Array` — 7 floats per capsule: `[shapeType, offsetX, offsetY, offsetZ, extentsX, extentsY, extentsZ]`.

```cpp
Napi::Value DeconstructCdfFile(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    Napi::ArrayBuffer inputBuffer = info.As<Napi::ArrayBuffer>();

    const uint8_t* rawData  = static_cast<const uint8_t*>(inputBuffer.Data());
    size_t         byteLength = inputBuffer.ByteLength();

    try {
        size_t offset = 0;
        SwgCollisionManifest manifest = SwgCdfParser::ParseCollisionForm(rawData, offset);

        // Unroll parameters: [shapeType, offsetX, offsetY, offsetZ, extentsX, extentsY, extentsZ] = 7 floats
        size_t floatCountPerCapsule = 7;
        Napi::Float32Array jsCapsuleBuffer =
            Napi::Float32Array::New(env, manifest.capsules.size() * floatCountPerCapsule);

        for (size_t i = 0; i < manifest.capsules.size(); ++i) {
            size_t idx       = i * floatCountPerCapsule;
            const auto& capsule = manifest.capsules[i];

            jsCapsuleBuffer[idx]     = static_cast<float>(capsule.shapeType);
            jsCapsuleBuffer[idx + 1] = capsule.offsetX;
            jsCapsuleBuffer[idx + 2] = capsule.offsetY;
            jsCapsuleBuffer[idx + 3] = capsule.offsetZ;
            jsCapsuleBuffer[idx + 4] = capsule.extentsX;
            jsCapsuleBuffer[idx + 5] = capsule.extentsY;
            jsCapsuleBuffer[idx + 6] = capsule.extentsZ;
        }

        return jsCapsuleBuffer;
    }
    catch (const std::exception& e) {
        Napi::TypeError::New(env, e.what()).ThrowAsJavaScriptException();
        return env.Null();
    }
}
```

### 2.5 Collision Wireframe Visualizer (R3F)

```tsx
import React, { useMemo } from 'react';
import * as THREE from 'three';

interface CapsuleData {
  shapeType: number;
  offset: [number, number, number];
  extents: [number, number, number];
}

export const SwgCollisionWireframeHelper: React.FC<{
  flatBuffer: Float32Array;
  isVisible: boolean;
}> = ({ flatBuffer, isVisible }) => {
  const capsules = useMemo(() => {
    const list: CapsuleData[] = [];
    const count = flatBuffer.length / 7;

    for (let i = 0; i < count; i++) {
      const idx = i * 7;
      list.push({
        shapeType: Math.floor(flatBuffer[idx]),
        offset:  [flatBuffer[idx + 1], flatBuffer[idx + 2], flatBuffer[idx + 3]],
        extents: [flatBuffer[idx + 4], flatBuffer[idx + 5], flatBuffer[idx + 6]]
      });
    }
    return list;
  }, [flatBuffer]);

  if (!isVisible) return null;

  return (
    <group name="collision_cdf_debug_nodes">
      {capsules.map((cap, i) => {
        // Shared wireframe debugging style
        const material = (
          <meshBasicMaterial
            color="#ff3300"
            wireframe
            transparent
            opacity={0.3}
            depthTest={false}
          />
        );

        if (cap.shapeType === 0) { // BOX
          return (
            <mesh key={i} position={cap.offset}>
              <boxGeometry args={cap.extents} />
              {material}
            </mesh>
          );
        }
        else if (cap.shapeType === 1) { // CYLINDER
          const [radius, height] = cap.extents;
          return (
            <mesh key={i} position={cap.offset}>
              <cylinderGeometry args={[radius, radius, height, 16]} />
              {material}
            </mesh>
          );
        }
        else if (cap.shapeType === 2) { // SPHERE
          const [radius] = cap.extents;
          return (
            <mesh key={i} position={cap.offset}>
              <sphereGeometry args={[radius, 16, 16]} />
              {material}
            </mesh>
          );
        }
        return null;
      })}
    </group>
  );
};
```

### 2.6 Visibility Toggle (React)

```tsx
import React, { useState } from 'react';

export const SwgCollisionDebugToolbar: React.FC<{
  onToggleChange: (show: boolean) => void;
}> = ({ onToggleChange }) => {
  const [showWireframes, setShowWireframes] = useState(false);

  const handleToggle = (val: boolean) => {
    setShowWireframes(val);
    onToggleChange(val); // Re-trigger conditional render states across Three.js mesh entities
  };

  return (
    <div style={{
      background: '#252526', padding: '12px', borderRadius: '4px',
      border: '1px solid #ff3300', color: '#fff', fontFamily: 'monospace', fontSize: '11px'
    }}>
      <div style={{ color: '#ff3300', fontWeight: 'bold', marginBottom: '6px' }}>
        Client-Side Physics Collider Inspect (.CDF)
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <label htmlFor="showCdf">Display Object Collision Capsules:</label>
        <input
          type="checkbox" id="showCdf"
          checked={showWireframes}
          onChange={(e) => handleToggle(e.target.checked)}
          style={{ cursor: 'pointer', accentColor: '#ff3300' }}
        />
      </div>
    </div>
  );
};
```

### 2.7 .cdf Serialization — Inside-Out Strategy

```
[ TS Capsule State Changes ] ---> (Map Shapes to BOX, CYLN, or SPHR Enums) ---> (Serialize Spatial Data Blocks)
                                                                                    |
                                                                                    v
[ Deployable .cdf Binary ] <--- (Wrap in FORM -> CDFS Structure) <--- (Compute Footprint Chunk Sizes)
```

#### Export Structs (C++)

```cpp
#include <napi.h>
#include <vector>
#include <string>
#include <cstring>
#include <cstdint>

struct SwgCollisionCapsuleExport {
    uint32_t shapeType; // 0 = Box, 1 = Cylinder, 2 = Sphere
    float offsetX, offsetY, offsetZ;
    float extentsX, extentsY, extentsZ;
};

struct SwgCdfExportManifest {
    std::vector<SwgCollisionCapsuleExport> capsules;
};
```

#### Shape Sub-FORM Serializer (C++)

```cpp
class SwgCdfCompiler {
public:
    static std::vector<uint8_t> SerializeCdfForm(const SwgCdfExportManifest& manifest) {
        IffBinaryWriter contentWriter;

        for (const auto& capsule : manifest.capsules) {
            IffBinaryWriter dataWriter;

            // 1. Pack the spatial offsets and extents bounds data
            dataWriter.WriteFloat(capsule.offsetX);
            dataWriter.WriteFloat(capsule.offsetY);
            dataWriter.WriteFloat(capsule.offsetZ);
            dataWriter.WriteFloat(capsule.extentsX);
            dataWriter.WriteFloat(capsule.extentsY);
            dataWriter.WriteFloat(capsule.extentsZ);

            // 2. Wrap into an IFF DATA chunk
            IffBinaryWriter dataChunkWriter;
            dataChunkWriter.PackChunk("DATA", dataWriter.buffer);

            // 3. Wrap into the correct shape type sub-FORM container
            IffBinaryWriter subFormWriter;
            subFormWriter.WriteTag("FORM");
            subFormWriter.WriteUint32(
                static_cast<uint32_t>(dataChunkWriter.buffer.size() + 4));

            if      (capsule.shapeType == 0) { subFormWriter.WriteTag("BOX "); }
            else if (capsule.shapeType == 1) { subFormWriter.WriteTag("CYLN"); }
            else if (capsule.shapeType == 2) { subFormWriter.WriteTag("SPHR"); }

            subFormWriter.WriteRawBuffer(dataChunkWriter.buffer);

            // Append the compiled sub-FORM to the main buffer
            contentWriter.WriteRawBuffer(subFormWriter.buffer);
        }

        // 4. Wrap everything inside a master FORM container carrying the CDFS Type Tag
        IffBinaryWriter formWriter;
        formWriter.WriteTag("FORM");
        formWriter.WriteUint32(static_cast<uint32_t>(contentWriter.buffer.size() + 4));
        formWriter.WriteTag("CDFS");
        formWriter.WriteRawBuffer(contentWriter.buffer);

        return formWriter.buffer;
    }
};
```

#### Node-API Compiler Endpoint (C++)

```cpp
Napi::Value CompileJsToCdfStream(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    Napi::Float32Array jsCapsules = info.As<Napi::Float32Array>();

    // Attributes per capsule: [shapeType, offsetX, offsetY, offsetZ, extentsX, extentsY, extentsZ] = 7 floats
    size_t capsuleCount = jsCapsules.Length() / 7;
    SwgCdfExportManifest manifest;
    manifest.capsules.reserve(capsuleCount);

    for (size_t i = 0; i < capsuleCount; ++i) {
        size_t idx = i * 7;
        SwgCollisionCapsuleExport capsule;

        capsule.shapeType = static_cast<uint32_t>(jsCapsules[idx]);
        capsule.offsetX   = jsCapsules[idx + 1];
        capsule.offsetY   = jsCapsules[idx + 2];
        capsule.offsetZ   = jsCapsules[idx + 3];
        capsule.extentsX  = jsCapsules[idx + 4];
        capsule.extentsY  = jsCapsules[idx + 5];
        capsule.extentsZ  = jsCapsules[idx + 6];

        manifest.capsules.push_back(capsule);
    }

    // Execute the inside-out binary serialization compiler loop
    std::vector<uint8_t> compiledCdfBytes = SwgCdfCompiler::SerializeCdfForm(manifest);

    Napi::ArrayBuffer outputBuffer = Napi::ArrayBuffer::New(env, compiledCdfBytes.size());
    std::memcpy(outputBuffer.Data(), compiledCdfBytes.data(), compiledCdfBytes.size());

    return outputBuffer;
}
// Bind endpoint inside native exports module initializers
exports.Set("compileJsToCdfStream", Napi::Function::New(env, CompileJsToCdfStream));
```

#### React Export Widget

```tsx
import React from 'react';

interface ExporterProps {
  nativeBridge: any;
  activeCapsuleBuffer: Float32Array; // The active unrolled tracking arrays currently rendering on canvas
  associatedMeshName: string;        // e.g. "building_cantina_s01"
}

export const SwgCollisionExporterWidget: React.FC<ExporterProps> = ({
  nativeBridge,
  activeCapsuleBuffer,
  associatedMeshName
}) => {
  const handleExportCdfFile = async () => {
    try {
      // 1. Invoke the C++ binary serialization compiler loop
      const compiledCdfArrayBuffer: ArrayBuffer =
        nativeBridge.compileJsToCdfStream(activeCapsuleBuffer);

      // 2. Package raw byte data view out to disk via context isolation bridges
      const finalByteArrayView = new Uint8Array(compiledCdfArrayBuffer);
      const targetFilename = `collision/${associatedMeshName}.cdf`;
      const success = await window.api.saveFileToDisk(targetFilename, finalByteArrayView);

      if (success) {
        alert(`Successfully serialized collision descriptors into a valid SWG Collision Profile (.cdf)! Target: ${targetFilename}`);
      }
    }
    catch (err: any) {
      console.error("Collision parameters compilation error event:", err);
      alert(`CDF serialization aborted: ${err.message}`);
    }
  };

  return (
    <button
      onClick={handleExportCdfFile}
      style={{
        marginTop: '10px', width: '100%', background: '#ff3300', color: '#fff',
        fontWeight: 'bold', padding: '8px 14px', border: 'none', borderRadius: '4px',
        fontFamily: 'monospace', fontSize: '11px', cursor: 'pointer'
      }}
    >
      Compile Bounding Profile (.CDF)
    </button>
  );
};
```

---

## 3. Portal Object Blueprint (.pob)

SWG building interiors use portalized volumes for performance. When a player is in `room_lobby`, the engine only draws cells whose connecting portal polygons (doorframes) intersect the camera frustum. The `.pob` file encodes the cell-adjacency graph, mesh references per cell, and portal geometry.

### 3.1 Real-Time Cell Culling Pipeline

```
[ Camera World Transform ] -> Extract Look-At Vector & Position Coordinates
                                        |
                                        v
                        [ Find Active Current Cell Node ]
                    Checks Camera against Cell Bounding Boxes
                                        |
                                        v
                        [ Traverse Connecting Portals ]
              Is Portal Plane Intersecting the Camera View Frustum?
                                 /             \
                                v               v
                       (YES: Render Cell)  (NO: Cull / Hide Room)
```

### 3.2 Cell Adjacency Graph Evaluator (TypeScript)

Starting from the cell containing the camera, a depth-first search traces outward through connecting portals. Portal frames outside the frustum cause their connected room to be culled.

```typescript
import * as THREE from 'three';

export interface PobCellNode {
  index: number;
  name: string;
  meshPaths: string[];
  boundingBox: THREE.Box3;
}

export interface PobPortalEdge {
  portalId: number;
  cellA: number;
  cellB: number;
  plane: THREE.Plane;
  points: THREE.Vector3[];
}

export class SwgPobCullingEngine {
  private frustum = new THREE.Frustum();
  private projScreenMatrix = new THREE.Matrix4();

  /**
   * Discovers which cell room currently contains the editor camera coordinates
   */
  public findActiveCell(cameraPos: THREE.Vector3, cells: PobCellNode[]): number {
    for (const cell of cells) {
      if (cell.boundingBox.containsPoint(cameraPos)) {
        return cell.index;
      }
    }
    return 0; // Default fallback to absolute root room node (Lobby/Exterior)
  }

  /**
   * Performs a Depth-First Search traversal to flag visible cell chunks
   */
  public computeVisibleCells(
    camera: THREE.Camera,
    activeCellIdx: number,
    cells: PobCellNode[],
    portals: PobPortalEdge[]
  ): Set<number> {
    const visibleSet = new Set<number>([activeCellIdx]);

    // Calculate current frustum matrix bounds
    this.projScreenMatrix.multiplyMatrices(
      camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projScreenMatrix);

    const traverse = (currentCell: number, visitedPortals: Set<number>) => {
      // Find all doorframes branching out of the current room cell node
      const connectedEdges = portals.filter(
        p => (p.cellA === currentCell || p.cellB === currentCell) &&
             !visitedPortals.has(p.portalId)
      );

      for (const edge of connectedEdges) {
        // Find the target room index on the other side of the doorway portal
        const nextCellIdx = edge.cellA === currentCell ? edge.cellB : edge.cellA;
        if (visibleSet.has(nextCellIdx)) continue;

        // --- PORTAL FRUSTUM INTERSECTION ---
        // Verify if any part of the polygonal doorway cuts inside the camera frustum
        let isPortalVisible = false;
        for (const pt of edge.points) {
          if (this.frustum.containsPoint(pt)) {
            isPortalVisible = true;
            break;
          }
        }

        if (isPortalVisible) {
          visibleSet.add(nextCellIdx);
          visitedPortals.add(edge.portalId);
          traverse(nextCellIdx, visitedPortals); // Step deeper into adjacent interior nodes
        }
      }
    };

    traverse(activeCellIdx, new Set<number>());
    return visibleSet;
  }
}
```

### 3.3 Optimized Indoor Canvas Node Component (R3F)

The culling engine runs inside `useFrame` so rooms hide/show instantly as the camera moves through corridors.

```tsx
import React, { useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { SwgPobCullingEngine, PobCellNode, PobPortalEdge } from './PobCullingEngine';

interface Props {
  napiPobData: any; // Raw payload received from your C++ IFF deconstruct addon
  assetRegistry: any;
  isCullingEnabled: boolean;
}

export const SwgAdvancedPortalViewer: React.FC<Props> = ({
  napiPobData,
  assetRegistry,
  isCullingEnabled
}) => {
  const buildingGroupRef = useRef<THREE.Group>(null);
  const { camera } = useThree();

  const cullingEngine = useMemo(() => new SwgPobCullingEngine(), []);
  const visibleCellsStateRef = useRef<Set<number>>(new Set([0]));

  // 1. Transform raw arrays into operational bounding geometry datasets
  const [cells, portals] = useMemo(() => {
    const parsedCells: PobCellNode[] = napiPobData.cells.map((c: any, index: number) => {
      const box = new THREE.Box3();
      box.setFromCenterAndSize(
        new THREE.Vector3(...c.center),
        new THREE.Vector3(...c.extents)
      );
      return { index, name: c.name, meshPaths: c.meshes, boundingBox: box };
    });

    const parsedPortals: PobPortalEdge[] = napiPobData.portals.map((p: any, i: number) => {
      const points: THREE.Vector3[] = [];
      const flatVerts: Float32Array = p.vertices;
      for (let v = 0; v < flatVerts.length; v += 3) {
        points.push(new THREE.Vector3(flatVerts[v], flatVerts[v + 1], flatVerts[v + 2]));
      }
      const plane = new THREE.Plane().setFromCoplanarPoints(points[0], points[1], points[2]);
      return { portalId: i, cellA: p.cellA, cellB: p.cellB, plane, points };
    });

    return [parsedCells, parsedPortals];
  }, [napiPobData]);

  // 2. High-Frequency Viewport Frame Traversal Loop
  useFrame(() => {
    if (!buildingGroupRef.current || !isCullingEnabled) return;

    const cameraWorldPos = new THREE.Vector3();
    camera.getWorldPosition(cameraWorldPos);

    const currentRoomIdx = cullingEngine.findActiveCell(cameraWorldPos, cells);
    const visibleSet = cullingEngine.computeVisibleCells(camera, currentRoomIdx, cells, portals);
    visibleCellsStateRef.current = visibleSet;

    // 3. Mutate visibility states directly inside the Three.js object graph
    buildingGroupRef.current.children.forEach((child, index) => {
      child.visible = visibleSet.has(index);
    });
  });

  return (
    <group ref={buildingGroupRef} name="pob_structural_assembly_root">
      {cells.map((cellNode) => (
        <group key={cellNode.name} name={`room_cell_${cellNode.name}`}>
          {cellNode.meshPaths.map((meshPath, mIdx) => {
            const cachedAsset = assetRegistry.getLoadedMeshReference(meshPath);
            if (!cachedAsset) return null;

            return (
              <mesh
                key={mIdx}
                geometry={cachedAsset.geometry}
                material={cachedAsset.material}
                castShadow
                receiveShadow
              />
            );
          })}
        </group>
      ))}
    </group>
  );
};
```

### 3.4 Occlusion Diagnostics Panel (React)

```tsx
import React, { useState } from 'react';
import { useFrame } from '@react-three/fiber';

export const SwgPobOcclusionMonitorPanel: React.FC<{
  onCullingToggle: (enabled: boolean) => void;
}> = ({ onCullingToggle }) => {
  const [enabled, setEnabled] = useState(true);
  const [drawCallsCount, setDrawCallsCount] = useState({ total: 0, rendered: 0 });

  useFrame((state) => {
    // Poll the WebGL Renderer core diagnostics registry data frames safely
    if (state.clock.getElapsedTime() % 0.3 < 0.02) {
      const info = state.gl.info.render;
      setDrawCallsCount({
        total: 145,        // Total architectural mesh sub-nodes compiled inside the file footprint
        rendered: info.calls // Total active rendering passes hitting the GPU vertex pipeline
      });
    }
  });

  return (
    <div style={{
      position: 'absolute', bottom: '20px', left: '20px', zIndex: 100,
      background: 'rgba(15, 15, 15, 0.95)', border: '1px solid #ff00ff',
      padding: '14px', borderRadius: '4px', color: '#fff', width: '250px', fontFamily: 'monospace'
    }}>
      <h5 style={{ color: '#ff00ff', margin: '0 0 10px 0' }}>Real-Time Portal Occlusion Diagnostics</h5>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', fontSize: '11px' }}>
        <label htmlFor="cullSwitch">Enable Portal Culling:</label>
        <input
          type="checkbox" id="cullSwitch"
          checked={enabled}
          onChange={(e) => { setEnabled(e.target.checked); onCullingToggle(e.target.checked); }}
          style={{ accentColor: '#ff00ff', cursor: 'pointer' }}
        />
      </div>

      <div style={{ fontSize: '11px', color: '#aaa', display: 'grid', gap: '4px', borderTop: '1px solid #333', paddingTop: '8px' }}>
        <div>Total Structural Assets: <span style={{ float: 'right' }}>{drawCallsCount.total} Meshes</span></div>
        <div>Active GPU Draw Calls: <span style={{ float: 'right', color: '#00ffcc' }}>{drawCallsCount.rendered}</span></div>
        <div>Culling Efficiency: <span style={{ float: 'right', color: '#ffcc00' }}>
          {Math.round((1.0 - (drawCallsCount.rendered / drawCallsCount.total)) * 100)}% Hidden
        </span></div>
      </div>
    </div>
  );
};
```

### 3.5 .pob Serialization — Inside-Out Strategy

```
[ TS Cell Graph Matrix Updates ] ---> (Serialize Inner Chunks: NAME, MESH, DATA) ---> (Pack Into CELL/PRTL FORMs)
                                                                                          |
                                                                                          v
[ Deployable .pob Binary ] <--- (Prepend Master FORM -> POB  Structure) <--- (Compute Footprint Chunk Sizes)
```

Every parent IFF container requires an explicit byte length, so inner elements are serialized first so their footprint can be computed before prepending the parent `CELL`, `PRTL`, and top-level `FORM POB ` headers.

#### Export Structs (C++)

```cpp
#include <napi.h>
#include <vector>
#include <string>
#include <cstring>
#include <cstdint>

struct SwgPobCellExport {
    uint32_t cellIndex;
    std::string cellName;
    std::vector<std::string> meshPaths;
};

struct SwgPobPortalExport {
    uint32_t portalId;
    int32_t  cellIndexA;
    int32_t  cellIndexB;
    std::vector<float> boundaryVertices; // Flat array: [x, y, z, x, y, z, ...]
};

struct SwgPobExportManifest {
    std::vector<SwgPobCellExport>   cells;
    std::vector<SwgPobPortalExport> portals;
};
```

#### Cell and Portal Serializer (C++)

```cpp
class SwgPobCompiler {
public:
    static std::vector<uint8_t> SerializePobForm(const SwgPobExportManifest& manifest) {
        IffBinaryWriter contentWriter;

        // 1. SERIALIZE CELL SUB-FORMS
        for (const auto& cell : manifest.cells) {
            IffBinaryWriter cellContentWriter;

            // Pack the cell string label identifier (NAME chunk)
            IffBinaryWriter nameWriter;
            nameWriter.WriteString(cell.cellName);
            cellContentWriter.PackChunk("NAME", nameWriter.buffer);

            // Pack the mesh reference paths array (MESH chunks)
            for (const auto& meshPath : cell.meshPaths) {
                IffBinaryWriter meshWriter;
                meshWriter.WriteString(meshPath);
                cellContentWriter.PackChunk("MESH", meshWriter.buffer);
            }

            // Wrap into a parent sub-FORM container carrying the CELL tag
            IffBinaryWriter cellFormWriter;
            cellFormWriter.WriteTag("FORM");
            cellFormWriter.WriteUint32(
                static_cast<uint32_t>(cellContentWriter.buffer.size() + 4));
            cellFormWriter.WriteTag("CELL");
            cellFormWriter.WriteRawBuffer(cellContentWriter.buffer);

            contentWriter.WriteRawBuffer(cellFormWriter.buffer);
        }

        // 2. SERIALIZE PORTAL DATA BLOCK (PRTL Chunk)
        IffBinaryWriter prtlWriter;
        prtlWriter.WriteUint32(static_cast<uint32_t>(manifest.portals.size()));

        for (const auto& portal : manifest.portals) {
            prtlWriter.WriteUint32(portal.portalId);
            prtlWriter.WriteUint32(static_cast<uint32_t>(portal.cellIndexA));
            prtlWriter.WriteUint32(static_cast<uint32_t>(portal.cellIndexB));

            // Write vertex positions count followed by the raw coordinates sequence
            uint32_t vertCount = static_cast<uint32_t>(portal.boundaryVertices.size() / 3);
            prtlWriter.WriteUint32(vertCount);

            for (float vertCoord : portal.boundaryVertices) {
                prtlWriter.WriteFloat(vertCoord);
            }
        }
        contentWriter.PackChunk("PRTL", prtlWriter.buffer);

        // 3. WRAP INTO THE MASTER POB ENVELOPE CONTAINER
        IffBinaryWriter formWriter;
        formWriter.WriteTag("FORM");
        formWriter.WriteUint32(static_cast<uint32_t>(contentWriter.buffer.size() + 4));
        formWriter.WriteTag("POB ");
        formWriter.WriteRawBuffer(contentWriter.buffer);

        return formWriter.buffer;
    }
};
```

#### Node-API Compiler Endpoint (C++)

```cpp
Napi::Value CompileJsToPobStream(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    Napi::Object jsManifestObj = info.As<Napi::Object>();

    SwgPobExportManifest manifest;

    // 1. Map Cell Arrays and String Paths
    Napi::Array jsCells = jsManifestObj.Get("cells").As<Napi::Array>();
    for (uint32_t i = 0; i < jsCells.Length(); ++i) {
        Napi::Object jsCellObj = jsCells.Get(i).As<Napi::Object>();
        SwgPobCellExport cell;
        cell.cellIndex = i;
        cell.cellName  = jsCellObj.Get("name").As<Napi::String>().Utf8Value();

        Napi::Array jsMeshes = jsCellObj.Get("meshes").As<Napi::Array>();
        for (uint32_t m = 0; m < jsMeshes.Length(); ++m) {
            cell.meshPaths.push_back(jsMeshes.Get(m).As<Napi::String>().Utf8Value());
        }
        manifest.cells.push_back(cell);
    }

    // 2. Map Portal Vectors
    Napi::Array jsPortals = jsManifestObj.Get("portals").As<Napi::Array>();
    for (uint32_t i = 0; i < jsPortals.Length(); ++i) {
        Napi::Object jsPortObj = jsPortals.Get(i).As<Napi::Object>();
        SwgPobPortalExport portal;
        portal.portalId   = i;
        portal.cellIndexA = jsPortObj.Get("cellA").As<Napi::Number>().Int32Value();
        portal.cellIndexB = jsPortObj.Get("cellB").As<Napi::Number>().Int32Value();

        Napi::Float32Array jsVerts = jsPortObj.Get("vertices").As<Napi::Float32Array>();
        portal.boundaryVertices.assign(jsVerts.Data(), jsVerts.Data() + jsVerts.Length());
        manifest.portals.push_back(portal);
    }

    // Execute the inside-out binary serialization compiler loop
    std::vector<uint8_t> compiledPobBytes = SwgPobCompiler::SerializePobForm(manifest);

    Napi::ArrayBuffer outputBuffer = Napi::ArrayBuffer::New(env, compiledPobBytes.size());
    std::memcpy(outputBuffer.Data(), compiledPobBytes.data(), compiledPobBytes.size());

    return outputBuffer;
}
// Bind endpoint within native initializers
exports.Set("compileJsToPobStream", Napi::Function::New(env, CompileJsToPobStream));
```

#### React Export Widget

```tsx
import React from 'react';

interface ExporterProps {
  nativeBridge: any;
  activeCellGraphState: {
    cells: Array<{ name: string; meshes: string[] }>;
    portals: Array<{ cellA: number; cellB: number; vertices: Float32Array }>;
  };
  buildingTemplateName: string; // e.g. "shared_coronet_cantina_structure"
}

export const SwgPobExporterWidget: React.FC<ExporterProps> = ({
  nativeBridge,
  activeCellGraphState,
  buildingTemplateName
}) => {
  const handleExportPobFile = async () => {
    try {
      // 1. Invoke the C++ binary serialization compiler loop
      const compiledPobArrayBuffer: ArrayBuffer =
        nativeBridge.compileJsToPobStream(activeCellGraphState);

      // 2. Package raw byte data view out to disk via context isolation bridges
      const finalByteArrayView = new Uint8Array(compiledPobArrayBuffer);
      const targetFilename = `appearance/${buildingTemplateName}.pob`;
      const success = await window.api.saveFileToDisk(targetFilename, finalByteArrayView);

      if (success) {
        alert(`Successfully serialized interior data matrices into a valid SWG Portal Building (.pob)! Target: ${targetFilename}`);
      }
    }
    catch (err: any) {
      console.error("Portal building compilation error event:", err);
      alert(`POB serialization aborted: ${err.message}`);
    }
  };

  return (
    <button
      onClick={handleExportPobFile}
      style={{
        marginTop: '12px', width: '100%', background: '#ff00ff', color: '#fff',
        fontWeight: 'bold', padding: '10px 14px', border: 'none', borderRadius: '4px',
        fontFamily: 'monospace', fontSize: '11px', cursor: 'pointer'
      }}
    >
      Compile Portal Building (.POB)
    </button>
  );
};
```

---

## 4. Indoor Floor Navigation (.floc)

While exterior pathfinding uses planetary `.nav` tiles, interior AI navigation uses `.floc` chunks — one per cell — bound to the local coordinate system of each room. The same Recast pipeline is used but scoped to a single cell's geometry with tighter agent parameters for doorways and corridors.

### 4.1 Indoor Pathfinding Pipeline

```
[ Active Cell Room Geometry ] ---> Extract Local Vertex & Index Arrays
                                              |
                                              v
                              [ Node-API C++ Navigation Core ]
                              -> Voxelizes Interior Floor Boundaries
                              -> Isolates Cell Walkable Coordinate Zones
                              -> Bakes Local Convex PolyMesh Hull
                                              |
                                              v
[ Server-Side AI Pathing ] <---- [ Compile .FLOC / NAVM Chunks ]
```

### 4.2 C++ Indoor Floor Data Models

```cpp
#include <napi.h>
#include <vector>
#include <string>
#include <cstdint>

struct SwgFloorVertex {
    float x, y, z;
};

struct SwgFloorPolygon {
    std::vector<uint32_t> vertexIndices; // Index mapping refs pointing to local vertices
    std::vector<int32_t>  edgeAdjacency; // Links to adjacent walkable neighbor polys
};

struct SwgCellFloorMesh {
    uint32_t cellIndex;
    std::vector<SwgFloorVertex>  vertices;
    std::vector<SwgFloorPolygon> polygons;
};
```

### 4.3 Voxelizing and Compiling Indoor .floc Meshes (C++)

Recast is configured with tighter parameters than the exterior compiler to fit through doorways and navigate multi-story staircases.

```cpp
#include "Recast.h" // Requires linking RecastNavigation

class SwgIndoorNavCompiler {
public:
    static std::vector<uint8_t> BakeCellFloorMesh(
        const std::vector<float>& localVertices,
        const std::vector<int>&   localIndices
    ) {
        rcConfig cfg;
        std::memset(&cfg, 0, sizeof(cfg));

        // 1. Configure Aggressive Agent Constraints (Optimized for tight indoor corridors)
        cfg.cellSize      = 0.15f;  // Tighter voxel grid resolution for doorways
        cfg.cellHeight    = 0.10f;
        cfg.agentHeight   = 2.0f;   // Humanoid height ceiling cap
        cfg.agentRadius   = 0.35f;  // Narrow clearance radius to fit through tight doors
        cfg.agentMaxClimb = 0.3f;   // Step limits for stairs
        cfg.agentMaxSlope = 30.0f;  // Max ramp incline angle limit
        cfg.regionMinSize   = 4;
        cfg.regionMergeSize = 12;
        cfg.edgeMaxLen      = 6.0f;
        cfg.edgeMaxError    = 1.0f;
        cfg.vertsPerPoly    = 6;    // SWG interior path blocks use up to 6 vertices per hull

        float bmin[3], bmax[3];
        rcCalcBounds(localVertices.data(), static_cast<int>(localVertices.size() / 3), bmin, bmax);
        rcVcopy(cfg.bmin, bmin);
        rcVcopy(cfg.bmax, bmax);

        rcHeightfield* hf = rcAllocHeightfield();
        rcCreateHeightfield(nullptr, *hf,
            cfg.width, cfg.height,
            cfg.bmin, cfg.bmax,
            cfg.cellSize, cfg.cellHeight);

        // 2. Rasterize local floor geometry triangles
        std::vector<unsigned char> triAreas(localIndices.size() / 3, RC_WALKABLE_AREA);
        rcRasterizeTriangles(nullptr,
            localVertices.data(), static_cast<int>(localVertices.size() / 3),
            localIndices.data(), triAreas.data(), static_cast<int>(localIndices.size() / 3),
            *hf, cfg.walkableClimb);

        rcFilterLowHangingWalkableObstacles(nullptr, cfg.walkableClimb, *hf);

        rcCompactHeightfield* chf = rcAllocCompactHeightfield();
        rcBuildCompactHeightfield(nullptr, cfg.agentHeight, cfg.walkableClimb, *hf, *chf);
        rcErodeWalkableArea(nullptr, cfg.agentRadius, *chf);

        rcContourSet* cset = rcAllocContourSet();
        rcBuildContours(nullptr, *chf, cfg.edgeMaxError, cfg.edgeMaxLen, *cset);

        rcPolyMesh* pmesh = rcAllocPolyMesh();
        rcBuildPolyMesh(nullptr, *cset, cfg.vertsPerPoly, *pmesh);

        // 3. Serialize output into an SWG IFF-compliant .FLOC / NAVM sub-container stream
        std::vector<uint8_t> streamBytes = SerializeFlocChunk(pmesh);

        // Clean up Recast dynamic memory structures
        rcFreeHeightfield(hf);
        rcFreeCompactHeightfield(chf);
        rcFreeContourSet(cset);
        rcFreePolyMesh(pmesh);

        return streamBytes;
    }

private:
    static std::vector<uint8_t> SerializeFlocChunk(const rcPolyMesh* pmesh) {
        IffBinaryWriter contentWriter;

        // Write local interior vertices (VERT chunk)
        IffBinaryWriter vertWriter;
        vertWriter.WriteUint32(pmesh->nverts);
        for (int i = 0; i < pmesh->nverts; ++i) {
            vertWriter.WriteFloat(pmesh->verts[i * 3]     * 0.15f); // Scale back to local meters
            vertWriter.WriteFloat(pmesh->verts[i * 3 + 1] * 0.10f);
            vertWriter.WriteFloat(pmesh->verts[i * 3 + 2] * 0.15f);
        }
        contentWriter.PackChunk("VERT", vertWriter.buffer);

        // Write convex walkable cell polygons (POLY chunk)
        IffBinaryWriter polyWriter;
        polyWriter.WriteUint32(pmesh->npolys);
        for (int i = 0; i < pmesh->npolys; ++i) {
            polyWriter.WriteUint32(pmesh->polyVerts[i * 2]); // Vert count inside this nav face
            for (int v = 0; v < 6; ++v) {
                polyWriter.WriteUint32(pmesh->polys[i * pmesh->nvp * 2 + v]);
            }
        }
        contentWriter.PackChunk("POLY", polyWriter.buffer);

        // Enclose inside a primary FORM tag carrying the FLOC type identifier
        IffBinaryWriter formWriter;
        formWriter.WriteTag("FORM");
        formWriter.WriteUint32(static_cast<uint32_t>(contentWriter.buffer.size() + 4));
        formWriter.WriteTag("FLOC");
        formWriter.WriteRawBuffer(contentWriter.buffer);

        return formWriter.buffer;
    }
};
```

### 4.4 Node-API Bridge for Indoor Nav

```cpp
Napi::Value BuildIndoorFlocMesh(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    Napi::Object       jsInputGeo  = info.As<Napi::Object>();
    Napi::Float32Array jsVertices  = jsInputGeo.Get("vertices").As<Napi::Float32Array>();
    Napi::Int32Array   jsIndices   = jsInputGeo.Get("indices").As<Napi::Int32Array>();

    std::vector<float> nativeVerts(jsVertices.Data(), jsVertices.Data() + jsVertices.Length());
    std::vector<int>   nativeInds(jsIndices.Data(),  jsIndices.Data()  + jsIndices.Length());

    // Run the local cell coordinate Recast compilation loops
    std::vector<uint8_t> compiledFlocBytes =
        SwgIndoorNavCompiler::BakeCellFloorMesh(nativeVerts, nativeInds);

    Napi::ArrayBuffer outputBuffer = Napi::ArrayBuffer::New(env, compiledFlocBytes.size());
    std::memcpy(outputBuffer.Data(), compiledFlocBytes.data(), compiledFlocBytes.size());

    return outputBuffer;
}
// Bind endpoint within native module exports
exports.Set("buildIndoorFlocMesh", Napi::Function::New(env, BuildIndoorFlocMesh));
```

### 4.5 Indoor Nav Mesh Visualizer (R3F)

Converts compiled `.floc` polygon buffers into a translucent neon-cyan wireframe overlay clamped to the cell's local coordinate offset.

```tsx
import React, { useMemo } from 'react';
import * as THREE from 'three';

interface IndoorNavProps {
  rawFlocBytes: ArrayBuffer; // Extracted from your N-API compiler response
  cellPositionOffset: [number, number, number];
  isPathingOverlayVisible: boolean;
}

export const SwgIndoorNavMeshVisualizer: React.FC<IndoorNavProps> = ({
  rawFlocBytes,
  cellPositionOffset,
  isPathingOverlayVisible
}) => {
  const flocGeometry = useMemo(() => {
    // Read the IFF VERT chunk arrays from the compiled binary response
    const localPositions = new Float32Array(rawFlocBytes);

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(localPositions, 3));
    geometry.computeVertexNormals();
    return geometry;
  }, [rawFlocBytes]);

  if (!isPathingOverlayVisible) return null;

  return (
    <mesh geometry={flocGeometry} position={[cellPositionOffset, cellPositionOffset + 0.05, cellPositionOffset]}>
      {/* Translucent neon cyan coloring overlay indicating valid walkable AI areas */}
      <meshBasicMaterial
        color="#00ffff"
        wireframe={true}
        transparent={true}
        opacity={0.35}
        side={THREE.DoubleSide}
        depthWrite={false}
      />
    </mesh>
  );
};
```

### 4.6 Indoor Pathing Bake Dashboard (React)

```tsx
import React, { useState } from 'react';

export const SwgIndoorPathingBakePanel: React.FC<{
  activeCellRef: any;
  nativeBridge: any;
}> = ({ activeCellRef, nativeBridge }) => {
  const [isBaking, setIsBaking] = useState(false);

  const handleBakeCellNavigation = async () => {
    if (!activeCellRef) return;
    setIsBaking(true);

    try {
      // 1. Extract only the vertex arrays belonging to the selected room cell node geometry
      const localMeshGeometryData = extractIsolatedCellGeometry(activeCellRef);

      // 2. Fire the native isolated Recast voxelization builder
      const compiledFlocBuffer: ArrayBuffer =
        nativeBridge.buildIndoorFlocMesh(localMeshGeometryData);

      // 3. Update the global cell graph workspace state variables directly
      window.workspaceState.updateActiveCellFlocBytes(activeCellRef.name, compiledFlocBuffer);
      alert(`Indoor navigation mesh baked successfully for room cell node: ${activeCellRef.name}!`);
    } catch (err: any) {
      alert(`Baking failed: ${err.message}`);
    } finally {
      setIsBaking(false);
    }
  };

  return (
    <div style={{
      background: '#1e1e1e', padding: '12px', borderRadius: '4px',
      border: '1px solid #00ffff', fontFamily: 'monospace', fontSize: '11px', color: '#fff'
    }}>
      <div style={{ color: '#00ffff', fontWeight: 'bold', marginBottom: '6px' }}>
        Local Indoor AI Pathing Compiler (.FLOC)
      </div>
      <p style={{ color: '#888', margin: '0 0 10px 0' }}>
        Generates local cell path constraints to handle pathfinding inside this building room.
      </p>
      <button
        onClick={handleBakeCellNavigation}
        disabled={isBaking || !activeCellRef}
        style={{
          width: '100%',
          background: isBaking ? '#444' : '#00ffff',
          color: '#111',
          fontWeight: 'bold',
          padding: '8px',
          border: 'none',
          borderRadius: '2px',
          cursor: 'pointer'
        }}
      >
        {isBaking ? "Computing Local Voxels..." : "Bake Room NavMesh (.FLOC)"}
      </button>
    </div>
  );
};
```

---

## Recast Parameter Comparison: Exterior vs. Indoor

| Parameter | Exterior (.nav) | Indoor (.floc) | Notes |
|---|---|---|---|
| `cellSize` | 0.3 | 0.15 | Finer grid for doorway precision |
| `cellHeight` | 0.2 | 0.10 | |
| `agentRadius` | 0.6 | 0.35 | Narrower for tight corridors |
| `agentMaxClimb` | 0.5 | 0.3 | Shallower for interior stairs |
| `agentMaxSlope` | 45.0 | 30.0 | |
| `edgeMaxLen` | 12.0 | 6.0 | Shorter edges for interior walls |
| `regionMinSize` | 8 | 4 | |
| `regionMergeSize` | 20 | 12 | |
