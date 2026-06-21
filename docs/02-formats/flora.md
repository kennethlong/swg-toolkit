# Flora Distribution Files (.fld)

> Covers: procedural flora/vegetation (.fld), instanced rendering, terrain-material-linked placement. Source: research doc lines 2149–2774.

> **Caveat:** Format and struct details below are AI-proposed based on reverse-engineering analysis. Validate all field layouts and chunk tags against the real `swg-client-v2` source before shipping. See [source provenance](../00-overview/source-provenance.md).

SWG planets feel alive because of their dynamic vegetation. Rather than storing absolute positions for every tree, rock, and grass tuft, SWG uses a **procedural scattering system** driven by Flora Description Files (`.fld`). At runtime the engine evaluates each candidate position against terrain height, slope, and material blend weights, then deterministically spawns or despawns foliage around the player.

IFF read/write primitives are not reproduced here — see [../01-core-engine/iff-and-tre.md](../01-core-engine/iff-and-tre.md) for the generic `IffBinaryWriter` helpers referenced in the serialization section below. Terrain height and slope evaluation details live in [./terrain.md](./terrain.md); this document shows only how flora **consumes** that data.

---

## Table of Contents

1. [File Structure](#1-file-structure)
2. [C++ Rule Representation](#2-c-rule-representation)
3. [Placement Evaluation](#3-placement-evaluation)
   - 3a. [Fast Foliage Grid Sampler](#3a-fast-foliage-grid-sampler)
   - 3b. [Packing Instances for WebGL Transfer](#3b-packing-instances-for-webgl-transfer)
4. [Rendering with R3F InstancedMesh](#4-rendering-with-r3f-instancedmesh)
   - 4a. [Instanced Flora Group Component](#4a-instanced-flora-group-component)
   - 4b. [Flora Grid Manager](#4b-flora-grid-manager)
5. [Serialization](#5-serialization)
   - 5a. [Extending Structs for Export](#5a-extending-structs-for-export)
   - 5b. [Serializing FLOT/FLOR Asset References](#5b-serializing-flotflor-asset-references)
   - 5c. [Compiling the Core Flora Layer Node](#5c-compiling-the-core-flora-layer-node)
   - 5d. [Exposing Export to N-API](#5d-exposing-export-to-n-api)
   - 5e. [React Editor State](#5e-react-editor-state)
6. [Terrain-Material Linkage](#6-terrain-material-linkage)
   - 6a. [Material Matrix Association](#6a-material-matrix-association)
   - 6b. [Extracting Splat Weights from the Terrain Node](#6b-extracting-splat-weights-from-the-terrain-node)
   - 6c. [Texture-Linked Placement Loop](#6c-texture-linked-placement-loop)
   - 6d. [React Inspector](#6d-react-inspector)

---

## 1. File Structure

An `.fld` file is a little-endian IFF archive wrapped in a `FORM` tag with type `FLDF`. Its internal layout:

| Chunk / Form | Contents |
|---|---|
| `NAME` | Human-readable group name string |
| `DATA` | Global layer parameters: `id`, `density`, `minHeight`, `maxHeight`, `maxSlopeAngle` |
| `FORM FLOT` | Static decorative asset sub-container (one per mesh in pool); contains `NAME` (appearance path) + `DATA` (index, probability, scale range) |
| `FORM FLOR` | Swaying vegetation sub-container; same internal layout as `FLOT` |
| `FREQ` | Probability frequency values controlling relative spawn density within the group |

The outer `FORM FLDF` envelope wraps one `FORM FLDF` sub-form per rule group, which in turn wraps the `NAME`, `DATA`, and all `FLOT`/`FLOR` children.

---

## 2. C++ Rule Representation

```cpp
#include <napi.h>
#include <string>
#include <vector>

struct FloraMeshAsset {
    std::string appearancePath; // e.g. "appearance/poi_all_tree_s01.apt"
    float spawnProbability;     // Frequency weight within the pool
    float minScale;
    float maxScale;
};

struct SwgFloraGroupRule {
    uint32_t id;
    std::string name;
    float density;          // Global density multiplier (instances per square meter)
    float minHeight;
    float maxHeight;
    float maxSlopeAngle;    // Trees won't spawn on cliffs if restricted
    std::vector<FloraMeshAsset> meshPool;
};
```

---

## 3. Placement Evaluation

### 3a. Fast Foliage Grid Sampler

The C++ layer evaluates a terrain chunk against the active flora rules using a **deterministic RNG seeded by chunk coordinates** — guaranteeing the same trees regenerate every time the chunk is loaded.

Height and slope are queried from the terrain engine (see [./terrain.md](./terrain.md) for `CalculateHeightAt`). The slope is estimated analytically by finite-differencing four neighbours.

```cpp
#include <cmath>
#include <random>

struct SpawnedFloraInstance {
    std::string appearancePath;
    float x, y, z;
    float scale;
    float rotationY;
};

class FloraPlacer {
public:
    /**
     * Samples a terrain chunk and returns a list of valid plant positions.
     */
    static std::vector<SpawnedFloraInstance> PopulateChunkFlora(
        const SwgFloraGroupRule& rule,
        float chunkX, float chunkZ, float chunkSize,
        const TerrainLayer& terrainEngine
    ) {
        std::vector<SpawnedFloraInstance> instances;

        // Deterministic seed tied to chunk coordinates — same trees every visit
        std::mt19937 prng(static_cast<uint32_t>(chunkX * 31 + chunkZ));
        std::uniform_real_distribution<float> dist(0.0f, 1.0f);

        int targetSpawnCount = static_cast<int>(chunkSize * chunkSize * rule.density);

        for (int i = 0; i < targetSpawnCount; ++i) {
            float localX = dist(prng) * chunkSize;
            float localZ = dist(prng) * chunkSize;
            float worldX = chunkX + localX;
            float worldZ = chunkZ + localZ;

            // 1. Query terrain height
            float height = terrainEngine.CalculateHeightAt(worldX, worldZ, 0.0f);

            // 2. Height constraints
            if (height < rule.minHeight || height > rule.maxHeight) continue;

            // 3. Analytical slope estimation
            float delta = 0.5f;
            float hL = terrainEngine.CalculateHeightAt(worldX - delta, worldZ, 0.0f);
            float hR = terrainEngine.CalculateHeightAt(worldX + delta, worldZ, 0.0f);
            float hD = terrainEngine.CalculateHeightAt(worldX, worldZ - delta, 0.0f);
            float hU = terrainEngine.CalculateHeightAt(worldX, worldZ + delta, 0.0f);

            float slopeX = (hR - hL) / (2.0f * delta);
            float slopeZ = (hU - hD) / (2.0f * delta);
            float slopeAngle = std::atan(std::sqrt(slopeX * slopeX + slopeZ * slopeZ))
                               * (180.0f / 3.14159f);

            if (slopeAngle > rule.maxSlopeAngle) continue;

            // 4. Select mesh from pool by probability weight
            if (rule.meshPool.empty()) continue;
            const auto& selectedMesh = rule.meshPool[prng() % rule.meshPool.size()];

            // 5. Random scale and yaw
            float scale = selectedMesh.minScale
                          + dist(prng) * (selectedMesh.maxScale - selectedMesh.minScale);
            float rotationY = dist(prng) * 2.0f * 3.14159f;

            instances.push_back({
                selectedMesh.appearancePath,
                worldX, height, worldZ,
                scale, rotationY
            });
        }

        return instances;
    }
};
```

### 3b. Packing Instances for WebGL Transfer

Rather than passing individual objects across the N-API boundary, instances are grouped by mesh path and flattened into `Float32Array` buffers with layout `[x, y, z, rotY, scale, ...]`.

```cpp
Napi::Value GetChunkFloraData(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    float chunkX    = info[0].As<Napi::Number>().FloatValue();
    float chunkZ    = info[1].As<Napi::Number>().FloatValue();
    float chunkSize = info[2].As<Napi::Number>().FloatValue();

    SwgFloraGroupRule activeRule     = GetActiveFloraRules();
    TerrainLayer      masterTerrain  = GetActiveTerrainEngine();

    auto rawInstances = FloraPlacer::PopulateChunkFlora(
        activeRule, chunkX, chunkZ, chunkSize, masterTerrain);

    // Group by mesh path -> flattened transform values
    std::unordered_map<std::string, std::vector<float>> groupedData;
    for (const auto& inst : rawInstances) {
        auto& vec = groupedData[inst.appearancePath];
        vec.push_back(inst.x);
        vec.push_back(inst.y);
        vec.push_back(inst.z);
        vec.push_back(inst.rotationY);
        vec.push_back(inst.scale);
    }

    Napi::Object resultObj = Napi::Object::New(env);
    for (const auto& [meshPath, transforms] : groupedData) {
        Napi::Float32Array jsArray = Napi::Float32Array::New(env, transforms.size());
        std::memcpy(jsArray.Data(), transforms.data(), transforms.size() * sizeof(float));
        resultObj.Set(meshPath, jsArray);
    }

    return resultObj;
}
```

---

## 4. Rendering with R3F InstancedMesh

GPU instancing allows thousands of trees to be submitted in a single draw call. One `InstancedMesh` is created per unique mesh path.

### 4a. Instanced Flora Group Component

```tsx
import React, { useMemo, useRef, useEffect } from 'react';
import * as THREE from 'three';

interface InstancedFloraProps {
  meshPath: string;
  transformData: Float32Array; // Layout: [x, y, z, rotY, scale, ...]
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
}

export const SwgInstancedFloraGroup: React.FC<InstancedFloraProps> = ({
  meshPath,
  transformData,
  geometry,
  material
}) => {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const count = transformData.length / 5;

  useEffect(() => {
    if (!meshRef.current) return;

    const instMesh = meshRef.current;
    const dummy = new THREE.Object3D();

    for (let i = 0; i < count; i++) {
      const idx = i * 5;
      const x     = transformData[idx];
      const y     = transformData[idx + 1];
      const z     = transformData[idx + 2];
      const rotY  = transformData[idx + 3];
      const scale = transformData[idx + 4];

      dummy.position.set(x, y, z);
      dummy.rotation.set(0, rotY, 0);
      dummy.scale.set(scale, scale, scale);
      dummy.updateMatrix();

      instMesh.setMatrixAt(i, dummy.matrix);
    }

    instMesh.instanceMatrix.needsUpdate = true;
  }, [transformData, count]);

  return (
    <instancedMesh ref={meshRef} args={[geometry, material, count]}>
      {/* Three.js renders this mesh across all instance coordinate offsets */}
    </instancedMesh>
  );
};
```

### 4b. Flora Grid Manager

The top-level manager queries the N-API backend per chunk, resolves geometries from a registry cache, and composes the instanced groups.

```tsx
import React, { useState, useEffect } from 'react';

export const SwgChunkFloraManager: React.FC<{
  chunkX: number;
  chunkZ: number;
  nativeBridge: any;
}> = ({ chunkX, chunkZ, nativeBridge }) => {
  const [floraGroups, setFloraGroups] = useState<Record<string, Float32Array>>({});

  useEffect(() => {
    const chunkFloraTransforms = nativeBridge.getChunkFloraData(chunkX, chunkZ, 128.0);
    setFloraGroups(chunkFloraTransforms);
  }, [chunkX, chunkZ, nativeBridge]);

  return (
    <group>
      {Object.entries(floraGroups).map(([meshPath, transforms]) => {
        const baseMesh = window.assetRegistry.getLoadedMeshReference(meshPath);
        return (
          <SwgInstancedFloraGroup
            key={meshPath}
            meshPath={meshPath}
            transformData={transforms}
            geometry={baseMesh.geometry}
            material={baseMesh.material}
          />
        );
      })}
    </group>
  );
};
```

---

## 5. Serialization

Writing a modified flora distribution map back into a valid `.fld` file follows the same inside-out IFF serialization pattern used for terrain files (see [../01-core-engine/iff-and-tre.md](../01-core-engine/iff-and-tre.md)). Only flora-specific chunk layout is shown below.

### 5a. Extending Structs for Export

```cpp
#include <vector>
#include <string>
#include <cstdint>

// Reflects all modifiable variables exposed by the React dashboard sliders
struct SwgFloraExportData {
    uint32_t id              = 0;
    std::string name         = "new_flora_group";
    float density            = 0.05f;
    float minHeight          = -1000.0f;
    float maxHeight          = 4000.0f;
    float maxSlopeAngle      = 30.0f;
    std::vector<FloraMeshAsset> meshPool;
};
```

### 5b. Serializing FLOT/FLOR Asset References

Each mesh in the pool is stored in its own sub-`FORM` container. `FLOT` is used for static decorative assets; `FLOR` for swaying vegetation.

```cpp
std::vector<uint8_t> SerializeFloraMeshAsset(const FloraMeshAsset& asset, uint32_t index) {
    IffBinaryWriter contentWriter;

    // 1. Appearance path string
    IffBinaryWriter nameWriter;
    nameWriter.WriteString(asset.appearancePath);
    contentWriter.PackChunk("NAME", nameWriter.buffer);

    // 2. Probability weights and scale range
    IffBinaryWriter dataWriter;
    dataWriter.WriteUint32(index);                    // Slot index within pool
    dataWriter.WriteFloat(asset.spawnProbability);
    dataWriter.WriteFloat(asset.minScale);
    dataWriter.WriteFloat(asset.maxScale);
    contentWriter.PackChunk("DATA", dataWriter.buffer);

    // 3. Wrap in asset sub-FORM (FLOT for static, FLOR for swaying)
    IffBinaryWriter formWriter;
    formWriter.WriteTag("FORM");
    formWriter.WriteUint32(static_cast<uint32_t>(contentWriter.buffer.size() + 4));
    formWriter.WriteTag("FLOT");
    formWriter.WriteRawBuffer(contentWriter.buffer);

    return formWriter.buffer;
}
```

### 5c. Compiling the Core Flora Layer Node

```cpp
std::vector<uint8_t> SerializeFloraGroupForm(const SwgFloraGroupRule& group) {
    IffBinaryWriter contentWriter;

    // 1. Group name
    IffBinaryWriter nameWriter;
    nameWriter.WriteString(group.name);
    contentWriter.PackChunk("NAME", nameWriter.buffer);

    // 2. Global distribution parameters
    IffBinaryWriter dataWriter;
    dataWriter.WriteUint32(group.id);
    dataWriter.WriteFloat(group.density);
    dataWriter.WriteFloat(group.minHeight);
    dataWriter.WriteFloat(group.maxHeight);
    dataWriter.WriteFloat(group.maxSlopeAngle);
    contentWriter.PackChunk("DATA", dataWriter.buffer);

    // 3. Mesh pool — inside-out serialization
    uint32_t assetIndex = 0;
    for (const auto& meshAsset : group.meshPool) {
        std::vector<uint8_t> meshBytes = SerializeFloraMeshAsset(meshAsset, assetIndex++);
        contentWriter.WriteRawBuffer(meshBytes);
    }

    // 4. Wrap in FLDF sub-FORM
    IffBinaryWriter formWriter;
    formWriter.WriteTag("FORM");
    formWriter.WriteUint32(static_cast<uint32_t>(contentWriter.buffer.size() + 4));
    formWriter.WriteTag("FLDF");
    formWriter.WriteRawBuffer(contentWriter.buffer);

    return formWriter.buffer;
}
```

### 5d. Exposing Export to N-API

The N-API export function maps the incoming JavaScript payload to native structs, compiles the inner chunks, then wraps everything in the outer `FORM FLDF` master envelope and returns a zero-copy `ArrayBuffer`.

```cpp
Napi::Value CompileFloraToFldStream(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    Napi::Object jsFloraRule = info[0].As<Napi::Object>();

    SwgFloraGroupRule nativeRule;
    nativeRule.id            = jsFloraRule.Get("id").As<Napi::Number>().Uint32Value();
    nativeRule.name          = jsFloraRule.Get("name").As<Napi::String>().Utf8Value();
    nativeRule.density       = jsFloraRule.Get("density").As<Napi::Number>().FloatValue();
    nativeRule.minHeight     = jsFloraRule.Get("minHeight").As<Napi::Number>().FloatValue();
    nativeRule.maxHeight     = jsFloraRule.Get("maxHeight").As<Napi::Number>().FloatValue();
    nativeRule.maxSlopeAngle = jsFloraRule.Get("maxSlopeAngle").As<Napi::Number>().FloatValue();

    Napi::Array jsPool = jsFloraRule.Get("meshPool").As<Napi::Array>();
    for (uint32_t i = 0; i < jsPool.Length(); ++i) {
        Napi::Object jsAsset = jsPool.Get(i).As<Napi::Object>();
        FloraMeshAsset asset;
        asset.appearancePath   = jsAsset.Get("appearancePath").As<Napi::String>().Utf8Value();
        asset.spawnProbability = jsAsset.Get("spawnProbability").As<Napi::Number>().FloatValue();
        asset.minScale         = jsAsset.Get("minScale").As<Napi::Number>().FloatValue();
        asset.maxScale         = jsAsset.Get("maxScale").As<Napi::Number>().FloatValue();
        nativeRule.meshPool.push_back(asset);
    }

    // Compile inner chunks recursively from the inside out
    std::vector<uint8_t> compiledFloraBytes = SerializeFloraGroupForm(nativeRule);

    // Build the outer master FORM FLDF wrapper
    IffBinaryWriter masterWriter;
    masterWriter.WriteTag("FORM");
    masterWriter.WriteUint32(static_cast<uint32_t>(compiledFloraBytes.size() + 4));
    masterWriter.WriteTag("FLDF");
    masterWriter.WriteRawBuffer(compiledFloraBytes);

    // Zero-copy transfer to Node.js ArrayBuffer
    Napi::ArrayBuffer outputBuffer = Napi::ArrayBuffer::New(env, masterWriter.buffer.size());
    std::memcpy(outputBuffer.Data(), masterWriter.buffer.data(), masterWriter.buffer.size());

    return outputBuffer;
}
```

### 5e. React Editor State

The editor panel binds density and mesh-pool parameters to the N-API export function.

```tsx
import React, { useState } from 'react';

export const SwgFloraEditorPanel: React.FC<{ nativeBridge: any }> = ({ nativeBridge }) => {
  const [floraGroupState, setFloraGroupState] = useState({
    id: 501,
    name: "tatooine_oasis_foliage",
    density: 0.08,
    minHeight: 12.0,
    maxHeight: 250.0,
    maxSlopeAngle: 15.0,
    meshPool: [
      { appearancePath: "appearance/poi_all_tree_s01.apt",    spawnProbability: 0.7, minScale: 0.8, maxScale: 1.4 },
      { appearancePath: "appearance/rock_desert_large_03.apt", spawnProbability: 0.3, minScale: 0.9, maxScale: 1.1 }
    ]
  });

  const triggerBinaryExport = async () => {
    try {
      const exportBuffer: ArrayBuffer = nativeBridge.compileFloraToFldStream(floraGroupState);
      const rawBytes = new Uint8Array(exportBuffer);
      await window.api.saveFileToDisk("shrubbery_tatooine.fld", rawBytes);
      alert("Successfully compiled project into a valid SWG foliage descriptor (.fld) archive payload!");
    } catch (err: any) {
      alert(`Serialization Error: ${err.message}`);
    }
  };

  return (
    <div style={{ padding: '16px', background: '#252526', color: '#fff', borderRadius: '4px' }}>
      <h3>Flora Distribution Parameter Controls</h3>
      <label style={{ display: 'block', margin: '8px 0' }}>
        Foliage Density Factor:
        <input
          type="range" min="0.001" max="0.3" step="0.005"
          value={floraGroupState.density}
          onChange={(e) => setFloraGroupState({ ...floraGroupState, density: parseFloat(e.target.value) })}
          style={{ width: '100%' }}
        />
      </label>
      <button
        onClick={triggerBinaryExport}
        style={{
          marginTop: '12px', background: '#00ffcc', color: '#121212',
          padding: '8px 12px', border: 'none', borderRadius: '4px',
          fontWeight: 'bold', cursor: 'pointer'
        }}
      >
        Export .FLD Binary Map
      </button>
    </div>
  );
};
```

---

## 6. Terrain-Material Linkage

To spawn foliage only on specific ground materials (grass, sand, not rock), flora rules are linked to the terrain splat map. The engine evaluates the **blend weight** of a target texture channel at each candidate position; if the weight falls below a threshold the position is rejected.

For the terrain splat evaluation itself, see [./terrain.md](./terrain.md). The sections below show only the flora-side integration.

### 6a. Material Matrix Association

`SwgFloraGroupRule` is extended with two fields that map directly onto the multi-layer Three.js splat shader channels:

```cpp
struct SwgFloraGroupRule {
    uint32_t id;
    std::string name;
    float density;
    float minHeight;
    float maxHeight;
    float maxSlopeAngle;

    // Which splat texture channel controls this plant family?
    // 0 = Dirt/Sand  1 = Dense Grass  2 = Rock Face  3 = Forest Floor
    uint32_t targetMaterialChannelIndex = 1;

    // Minimum blend weight required at a position before a plant may spawn
    float minMaterialBlendWeight = 0.5f; // 50% texture visibility threshold

    std::vector<FloraMeshAsset> meshPool;
};
```

### 6b. Extracting Splat Weights from the Terrain Node

`EnhancedTerrainLayer` extends the base terrain engine (see [./terrain.md](./terrain.md)) to return both height and a four-channel material weight array in a single query, avoiding a second height lookup.

```cpp
struct TerrainSampleResult {
    float height = 0.0f;
    float materialWeights[4] = { 0.0f, 0.0f, 0.0f, 0.0f }; // 4-channel splat shader
};

class EnhancedTerrainLayer : public TerrainLayer {
public:
    /**
     * Evaluates height and material blend weights concurrently.
     * The weight logic mirrors the math that generates the Three.js aSplatWeight buffer.
     */
    TerrainSampleResult SampleTerrainDetailed(float x, float z, float parentHeight) const {
        TerrainSampleResult result;

        result.height = CalculateHeightAt(x, z, parentHeight);

        if (result.height < 15.0f) {
            result.materialWeights[0] = 1.0f; // Sand/Shore
            result.materialWeights[1] = 0.0f; // Grass
        } else if (result.height < 120.0f) {
            float blendFactor = std::clamp((result.height - 15.0f) / 15.0f, 0.0f, 1.0f);
            result.materialWeights[0] = 1.0f - blendFactor; // Sand fades out
            result.materialWeights[1] = blendFactor;         // Grass fades in
        } else {
            result.materialWeights[1] = 0.2f; // Grass thins out
            result.materialWeights[2] = 0.8f; // Rock face channel
        }

        return result;
    }
};
```

### 6c. Texture-Linked Placement Loop

This replaces `PopulateChunkFlora`. It fires `SampleTerrainDetailed` once per candidate, checks the target channel weight, then falls through to height/slope validation.

```cpp
std::vector<SpawnedFloraInstance> PopulateTextureLinkedFlora(
    const SwgFloraGroupRule& rule,
    float chunkX, float chunkZ, float chunkSize,
    const EnhancedTerrainLayer& terrainEngine
) {
    std::vector<SpawnedFloraInstance> instances;

    std::mt19937 prng(static_cast<uint32_t>(chunkX * 73 + chunkZ * 37));
    std::uniform_real_distribution<float> dist(0.0f, 1.0f);

    int targetSpawnCount = static_cast<int>(chunkSize * chunkSize * rule.density);

    for (int i = 0; i < targetSpawnCount; ++i) {
        float worldX = chunkX + (dist(prng) * chunkSize);
        float worldZ = chunkZ + (dist(prng) * chunkSize);

        TerrainSampleResult sample = terrainEngine.SampleTerrainDetailed(worldX, worldZ, 0.0f);

        // 1. Material channel check — reject positions where the target texture is absent
        float activeTexturePresence = sample.materialWeights[rule.targetMaterialChannelIndex];
        if (activeTexturePresence < rule.minMaterialBlendWeight) continue;

        // 2. Height bounds
        if (sample.height < rule.minHeight || sample.height > rule.maxHeight) continue;

        // 3. Select mesh and generate transforms
        if (rule.meshPool.empty()) continue;
        const auto& selectedMesh = rule.meshPool[prng() % rule.meshPool.size()];

        float scale     = selectedMesh.minScale + dist(prng) * (selectedMesh.maxScale - selectedMesh.minScale);
        float rotationY = dist(prng) * 2.0f * 3.14159f;

        instances.push_back({
            selectedMesh.appearancePath,
            worldX, sample.height, worldZ,
            scale, rotationY
        });
    }

    return instances;
}
```

### 6d. React Inspector

The linkage inspector lets modders select the target ground type and adjust the minimum blend threshold. Changes are piped immediately to the C++ layer and trigger a Three.js instanced mesh regeneration.

```tsx
import React, { useState } from 'react';

export const SwgFloraLinkageInspector: React.FC<{
  nativeBridge: any;
  onUpdate: () => void;
}> = ({ nativeBridge, onUpdate }) => {
  const [targetChannel, setTargetChannel] = useState(1); // Default: Channel 1 (Grass)
  const [minWeight, setMinWeight] = useState(0.5);

  const handleLinkageChange = (channelId: number, weight: number) => {
    setTargetChannel(channelId);
    setMinWeight(weight);

    nativeBridge.updateFloraMaterialLinkage({
      ruleId: 501,
      targetMaterialChannelIndex: channelId,
      minMaterialBlendWeight: weight
    });

    onUpdate(); // Re-trigger Three.js instanced mesh generation
  };

  return (
    <div style={{
      background: '#252526', padding: '14px',
      border: '1px solid #444', borderRadius: '4px', marginTop: '10px'
    }}>
      <h5 style={{ color: '#00ffcc', margin: '0 0 10px 0' }}>Ground Texture Linkage Rules</h5>

      <div style={{ display: 'grid', gap: '8px', fontSize: '12px', color: '#bbb' }}>
        <label>
          Spawn Ground Layer Type:
          <select
            value={targetChannel}
            onChange={(e) => handleLinkageChange(parseInt(e.target.value), minWeight)}
            style={{ float: 'right', background: '#333', color: '#fff', border: '1px solid #555' }}
          >
            <option value={0}>Channel 0: Sand / Desert Soil</option>
            <option value={1}>Channel 1: Forest Grass</option>
            <option value={2}>Channel 2: Craggy Rock Face</option>
            <option value={3}>Channel 3: Swamp Mud</option>
          </select>
        </label>

        <label>
          Minimum Density Threshold ({Math.round(minWeight * 100)}%):
          <input
            type="range" min="0.1" max="0.95" step="0.05"
            value={minWeight}
            onChange={(e) => handleLinkageChange(targetChannel, parseFloat(e.target.value))}
            style={{ width: '100%' }}
          />
        </label>
      </div>
    </div>
  );
};
```

---

## Key Design Notes

- **Determinism:** Foliage positions are never stored. They are recomputed from the chunk coordinate seed every time a chunk is visited, guaranteeing byte-identical placement across editor, server, and client.
- **Instancing budget:** One `InstancedMesh` per unique `appearancePath`. Mesh pool entries with identical paths should be merged before upload.
- **Splat channel mapping:** The four-channel `materialWeights` array must match the channel order in the Three.js splat shader's `aSplatWeight` attribute buffer. If you add or reorder terrain layers, update both.
- **FLOT vs FLOR:** The sub-form tag distinguishes static props (`FLOT`) from animated vegetation (`FLOR`). The internal `NAME`/`DATA` layout is identical; only the four-character tag differs.
- **Binary compatibility:** The outer `FORM FLDF` envelope is written twice — once as the inner group sub-form and once as the master file wrapper — matching the SWG client's expected nesting depth. Validate against a known-good `.fld` dump before shipping edits to a live server.
