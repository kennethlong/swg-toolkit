# World Snapshots (.ws)

> Covers: world snapshots (.ws) — OTPL object templates, NODD object nodes, read & write. Source: research doc lines 4315–4776.

> **Caveat:** chunk tags (OTPL, NODD), field layouts, and byte-order assumptions below are AI-proposed and have not been validated against the live `swg-client-v2` or `Core3` source trees. Treat as a strong working hypothesis and cross-check before shipping. See [source provenance](../00-overview/source-provenance.md).

---

## Contents

1. [IFF Structure](#1-iff-structure)
2. [Reading .ws → Three.js scene](#2-reading-ws--threejs-scene)
   - [C++ data structures](#21-c-data-structures)
   - [Top-down binary reader](#22-top-down-binary-reader)
   - [N-API bridge: C++ → TypeScript](#23-n-api-bridge-c--typescript)
   - [TypeScript reconstruction layer](#24-typescript-reconstruction-layer)
   - [React Three Fiber world loader](#25-react-three-fiber-world-loader)
3. [Writing scene → .ws](#3-writing-scene--ws)
   - [C++ data models](#31-c-data-models)
   - [Serializing the OTPL dictionary](#32-serializing-the-otpl-dictionary)
   - [Serializing NODD object blocks](#33-serializing-nodd-object-blocks)
   - [N-API bridge: TypeScript → C++](#34-n-api-bridge-typescript--c)
   - [React export button](#35-react-export-button)
4. [Integration notes](#4-integration-notes)

IFF reader/writer primitives (`IffBinaryWriter`, `TrnBinaryParser`, tag/chunk helpers) are documented in [../01-core-engine/iff-and-tre.md](../01-core-engine/iff-and-tre.md). Only .ws-specific (OTPL/NODD) parsing and serialization is shown here.

---

## 1. IFF Structure

> **AI-proposed / unverified:** In addition to object placement, the `.ws` system is also believed to act as a **World Audio Script** layer — linking coordinate boundary regions (reusing the same spatial-bounds model as `.trn` terrain layers) to environmental ambiance templates. When a player crosses into a defined boundary, the engine crossfades to the associated ambient audio template (e.g. a wind loop in open desert). This region-to-ambiance binding is thought to live in the world snapshot rather than in individual `.snd` emitter files, but the exact chunk tag and field layout have not been confirmed against `swg-client-v2` source. For the per-emitter `.snd` audio pipeline and the complementary description of this feature, see [audio-and-effects.md](./audio-and-effects.md).

A `.ws` file is an IFF container with the following nested hierarchy:

```
FORM "WSSN"  (World Snapshot master)
  FORM "OTPL"  (Object Template List — flat, indexed string dictionary)
    DATA: uint32 count, then N null-terminated ASCII path strings
          e.g. "object/static/flora/tree/shared_tree_tatooine_desert_01.iff"
  CHUNK "NODD"  (Object Node Data — spatial quadtree block)
    DATA: uint32 object count, then per-object records:
          uint64 networkId | uint32 templateIndex | float x,y,z |
          float qx,qy,qz,qw | float scale
```

**Key design principle:** individual object records never store raw path strings. They hold an integer index into the OTPL dictionary. This keeps per-object records small and avoids string duplication across tens of thousands of placed objects.

---

## 2. Reading .ws → Three.js scene

### 2.1 C++ data structures

Declare the vectors that will receive the decompressed string dictionary and transform coordinate sets from the binary stream.

```cpp
#include <napi.h>
#include <vector>
#include <string>
#include <cstring>
#include <memory>

// Individual object transformation data mapped from the binary file layout
struct ParsedSnapshotObject {
    uint64_t networkId;
    uint32_t templateIndex;  // Maps to the parsed string dictionary index
    float x, y, z;
    float qx, qy, qz, qw;   // Rotation quaternion (X, Y, Z, W order in file)
    float scale;
};

struct DeconstructedWsData {
    std::vector<std::string> templateDictionary;
    std::vector<ParsedSnapshotObject> objects;
};
```

### 2.2 Top-down binary reader

Walks the binary buffer block-by-block. On an `OTPL` form, reads null-terminated strings sequentially. On a `NODD` chunk, unpacks 64-bit network IDs and object spatial transforms.

```cpp
class SwgWsReader {
public:
    static DeconstructedWsData DeconstructWsBuffer(const uint8_t* data, size_t totalBytes) {
        DeconstructedWsData wsContent;
        size_t offset = 0;

        // 1. Validate the outer master container tags
        std::string rootTag    = TrnBinaryParser::Read4CharTag(data, offset);
        uint32_t totalFormSize = TrnBinaryParser::ReadUint32LE(data, offset);
        std::string masterType = TrnBinaryParser::Read4CharTag(data, offset);

        if (rootTag != "FORM" || masterType != "WSSN") {
            throw std::runtime_error(
                "Target file is not a valid Star Wars Galaxies World Snapshot (.ws) container."
            );
        }

        size_t formEndOffset = 8 + totalFormSize;

        // 2. Walk internal blocks sequentially
        while (offset < (totalBytes - 12) && offset < formEndOffset) {
            std::string chunkTag = TrnBinaryParser::Read4CharTag(data, offset);
            uint32_t chunkSize   = TrnBinaryParser::ReadUint32LE(data, offset);
            size_t nextChunkMarker = offset + chunkSize;

            if (chunkTag == "FORM") {
                std::string formType = TrnBinaryParser::Read4CharTag(data, offset);

                if (formType == "OTPL") {
                    // Parse Object Template string dictionary
                    uint32_t registeredTemplateCount = TrnBinaryParser::ReadUint32LE(data, offset);
                    wsContent.templateDictionary.reserve(registeredTemplateCount);

                    for (uint32_t i = 0; i < registeredTemplateCount; ++i) {
                        std::string path(reinterpret_cast<const char*>(data + offset));
                        offset += path.length() + 1;  // Advance past the null terminator
                        wsContent.templateDictionary.push_back(path);
                    }
                }
            }
            else if (chunkTag == "NODD") {
                // Parse object transform data chunk
                uint32_t totalObjectsInChunk = TrnBinaryParser::ReadUint32LE(data, offset);
                wsContent.objects.reserve(wsContent.objects.size() + totalObjectsInChunk);

                for (uint32_t i = 0; i < totalObjectsInChunk; ++i) {
                    ParsedSnapshotObject obj;

                    // 64-bit unique network pointer ID
                    std::memcpy(&obj.networkId, data + offset, 8);
                    offset += 8;

                    // Dictionary lookup index
                    obj.templateIndex = TrnBinaryParser::ReadUint32LE(data, offset);

                    // Position
                    obj.x = TrnBinaryParser::ReadFloatLE(data, offset);
                    obj.y = TrnBinaryParser::ReadFloatLE(data, offset);
                    obj.z = TrnBinaryParser::ReadFloatLE(data, offset);

                    // Orientation quaternion (X, Y, Z, W)
                    obj.qx = TrnBinaryParser::ReadFloatLE(data, offset);
                    obj.qy = TrnBinaryParser::ReadFloatLE(data, offset);
                    obj.qz = TrnBinaryParser::ReadFloatLE(data, offset);
                    obj.qw = TrnBinaryParser::ReadFloatLE(data, offset);

                    // Uniform scale
                    obj.scale = TrnBinaryParser::ReadFloatLE(data, offset);

                    wsContent.objects.push_back(obj);
                }
            }

            // Fast-forward safely past any unhandled chunk variants
            offset = nextChunkMarker;
        }

        return wsContent;
    }
};
```

### 2.3 N-API bridge: C++ → TypeScript

To avoid blocking the UI main thread, the parsed C++ vectors are serialized into a flat object containing a string dictionary array plus two typed arrays: one `Float32Array` (9 floats per object: templateIndex, x, y, z, qx, qy, qz, qw, scale) and one `BigInt64Array` for network IDs.

```cpp
Napi::Value DeconstructWsFile(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    Napi::ArrayBuffer inputBuffer = info[0].As<Napi::ArrayBuffer>();
    const uint8_t* rawData = static_cast<const uint8_t*>(inputBuffer.Data());
    size_t byteLength = inputBuffer.ByteLength();

    try {
        DeconstructedWsData parsedData = SwgWsReader::DeconstructWsBuffer(rawData, byteLength);

        // 1. Pack template paths into a JS string array
        Napi::Array jsDictionary = Napi::Array::New(env, parsedData.templateDictionary.size());
        for (size_t i = 0; i < parsedData.templateDictionary.size(); ++i) {
            jsDictionary.Set(i, Napi::String::New(env, parsedData.templateDictionary[i]));
        }

        // 2. Pack transform data: 9 floats per object
        size_t objectCount = parsedData.objects.size();
        Napi::Float32Array jsTransformBuffer =
            Napi::Float32Array::New(env, objectCount * 9);
        Napi::BigInt64Array jsNetworkIdBuffer =
            Napi::BigInt64Array::New(env, objectCount);

        for (size_t i = 0; i < objectCount; ++i) {
            const ParsedSnapshotObject& obj = parsedData.objects[i];
            size_t offset = i * 9;

            jsTransformBuffer[offset + 0] = static_cast<float>(obj.templateIndex);
            jsTransformBuffer[offset + 1] = obj.x;
            jsTransformBuffer[offset + 2] = obj.y;
            jsTransformBuffer[offset + 3] = obj.z;
            jsTransformBuffer[offset + 4] = obj.qx;
            jsTransformBuffer[offset + 5] = obj.qy;
            jsTransformBuffer[offset + 6] = obj.qz;
            jsTransformBuffer[offset + 7] = obj.qw;
            jsTransformBuffer[offset + 8] = obj.scale;

            jsNetworkIdBuffer[i] = static_cast<int64_t>(obj.networkId);
        }

        Napi::Object resultContainer = Napi::Object::New(env);
        resultContainer.Set("dictionary", jsDictionary);
        resultContainer.Set("transforms", jsTransformBuffer);
        resultContainer.Set("networkIds", jsNetworkIdBuffer);

        return resultContainer;
    }
    catch (const std::exception& e) {
        Napi::TypeError::New(env, e.what()).ThrowAsJavaScriptException();
        return env.Null();
    }
}
```

> **Note on line 4662 corruption:** the source transcript had an HTML-entity truncation at the dictionary-packing loop boundary. The reconstruction above is inferred from the surrounding context and the typed-array block that followed immediately. Verify the exact loop form against the real N-API integration.

### 2.4 TypeScript reconstruction layer

Receives the flat typed arrays from N-API and maps them back into structured `EditorSceneNode` objects the React UI can iterate over.

```typescript
export interface EditorSceneNode {
  networkId: string;
  templatePath: string;
  position: [number, number, number];
  quaternion: [number, number, number, number];  // [qx, qy, qz, qw]
  scale: number;
}

export function parseNativeSnapshotPayload(napiResult: any): EditorSceneNode[] {
  const dictionary: string[]       = napiResult.dictionary;
  const transforms: Float32Array   = napiResult.transforms;
  const networkIds: BigInt64Array  = napiResult.networkIds;

  const nodeCount = networkIds.length;
  const reconstructedNodes: EditorSceneNode[] = [];

  for (let i = 0; i < nodeCount; i++) {
    const offset = i * 9;

    const templateIndex = Math.floor(transforms[offset]);
    const templatePath  = dictionary[templateIndex];

    reconstructedNodes.push({
      networkId:    networkIds[i].toString(),
      templatePath: templatePath,
      position:     [transforms[offset + 1], transforms[offset + 2], transforms[offset + 3]],
      quaternion:   [transforms[offset + 4], transforms[offset + 5], transforms[offset + 6], transforms[offset + 7]],
      scale:        transforms[offset + 8],
    });
  }

  return reconstructedNodes;
}
```

### 2.5 React Three Fiber world loader

Passes the reconstructed node array directly into the R3F canvas, instantiating one `<mesh>` per object using pre-cached geometries and materials from the TRE asset registry.

```tsx
import React, { useMemo } from 'react';
import * as THREE from 'three';
import { parseNativeSnapshotPayload, EditorSceneNode } from './parseNativeSnapshotPayload';

interface SceneLoaderProps {
  rawNapiPayload: any;
  assetRegistry: any;  // Cache manager pointing to parsed TRE appearance loaders
}

export const SwgLegacyWorldLayerLoader: React.FC<SceneLoaderProps> = ({
  rawNapiPayload,
  assetRegistry,
}) => {
  // Unpack the binary payload using the memoized parser
  const sceneItems = useMemo(
    () => parseNativeSnapshotPayload(rawNapiPayload),
    [rawNapiPayload]
  );

  return (
    <group name="legacy_world_snapshot_root">
      {sceneItems.map((item: EditorSceneNode) => {
        // Fetch shared, cached geometry matching this .iff template path
        const assetMeshReference = assetRegistry.getLoadedMeshReference(item.templatePath);

        // Render null (or a debug wireframe) if the asset hasn't been extracted yet
        if (!assetMeshReference) return null;

        const position   = new THREE.Vector3(...item.position);
        const quaternion = new THREE.Quaternion(...item.quaternion);
        const scale      = new THREE.Vector3(item.scale, item.scale, item.scale);

        return (
          <mesh
            key={item.networkId}
            geometry={assetMeshReference.geometry}
            material={assetMeshReference.material}
            position={position}
            quaternion={quaternion}
            scale={scale}
          />
        );
      })}
    </group>
  );
};
```

---

## 3. Writing scene → .ws

### 3.1 C++ data models

```cpp
#include <napi.h>
#include <vector>
#include <string>
#include <unordered_map>
#include <cstring>

struct SnapshotObjectEntry {
    uint64_t networkId;       // Unique SWG system pointer ID
    std::string templatePath; // e.g. "object/static/flora/tree/shared_tree_tatooine_01.iff"
    float x, y, z;
    float qw, qx, qy, qz;    // Quaternion (note: stored X,Y,Z,W in file — see §3.3)
    float scale;
};

struct SwgWorldSnapshotData {
    std::vector<std::string> templateDictionary;
    std::vector<SnapshotObjectEntry> objects;
};
```

### 3.2 Serializing the OTPL dictionary

Individual object records reference their asset path by index integer only. The OTPL block is written once at the top of the WSSN form.

```cpp
std::vector<uint8_t> SerializeTemplateDictionary(const std::vector<std::string>& dictionary) {
    IffBinaryWriter contentWriter;

    // Count of registered templates
    contentWriter.WriteUint32(static_cast<uint32_t>(dictionary.size()));

    // Each path as a null-terminated ASCII string
    for (const auto& path : dictionary) {
        contentWriter.WriteString(path);
    }

    // Wrap payload into an IFF sub-FORM chunk
    IffBinaryWriter formWriter;
    formWriter.WriteTag("FORM");
    formWriter.WriteUint32(static_cast<uint32_t>(contentWriter.buffer.size() + 4));
    formWriter.WriteTag("OTPL");
    formWriter.WriteRawBuffer(contentWriter.buffer);

    return formWriter.buffer;
}
```

### 3.3 Serializing NODD object blocks

Writes the raw transform data for all placed objects. SWG expects quaternion components in **X, Y, Z, W** order on disk.

```cpp
std::vector<uint8_t> SerializeObjectDataBlock(
    const std::vector<SnapshotObjectEntry>& objects,
    const std::unordered_map<std::string, uint32_t>& dictMap
) {
    IffBinaryWriter contentWriter;

    // Object count for this quadtree block segment
    contentWriter.WriteUint32(static_cast<uint32_t>(objects.size()));

    for (const auto& obj : objects) {
        // 1. 64-bit network ID
        uint8_t idBytes[8];
        std::memcpy(idBytes, &obj.networkId, 8);
        contentWriter.buffer.insert(contentWriter.buffer.end(), idBytes, idBytes + 8);

        // 2. Template dictionary index
        uint32_t templateIndex = dictMap.at(obj.templatePath);
        contentWriter.WriteUint32(templateIndex);

        // 3. Position
        contentWriter.WriteFloat(obj.x);
        contentWriter.WriteFloat(obj.y);
        contentWriter.WriteFloat(obj.z);

        // 4. Orientation quaternion — SWG file order: X, Y, Z, W
        contentWriter.WriteFloat(obj.qx);
        contentWriter.WriteFloat(obj.qy);
        contentWriter.WriteFloat(obj.qz);
        contentWriter.WriteFloat(obj.qw);

        // 5. Uniform scale
        contentWriter.WriteFloat(obj.scale);
    }

    // Encapsulate into a NODD data chunk
    IffBinaryWriter chunkWriter;
    chunkWriter.PackChunk("NODD", contentWriter.buffer);
    return chunkWriter.buffer;
}
```

### 3.4 N-API bridge: TypeScript → C++

Accepts a JS array of object descriptors (with `BigInt` network IDs), builds the string dictionary, compiles OTPL and NODD buffers, assembles the master WSSN form, and returns a zero-copy `ArrayBuffer`.

```cpp
Napi::Value CompileEditorStateToSnapshotStream(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    Napi::Array jsObjectsList = info[0].As<Napi::Array>();

    SwgWorldSnapshotData snapshot;
    std::unordered_map<std::string, uint32_t> dictMap;
    uint32_t dictIndexCounter = 0;

    // Parse the data arriving from the TypeScript layer
    for (uint32_t i = 0; i < jsObjectsList.Length(); ++i) {
        Napi::Object jsObj = jsObjectsList.Get(i).As<Napi::Object>();
        SnapshotObjectEntry entry;

        // 64-bit integer network IDs arrive from JS as BigInt
        entry.networkId    = jsObj.Get("networkId").As<Napi::BigInt>().Uint64Value(nullptr);
        entry.templatePath = jsObj.Get("templatePath").As<Napi::String>().Utf8Value();

        entry.x  = jsObj.Get("x").As<Napi::Number>().FloatValue();
        entry.y  = jsObj.Get("y").As<Napi::Number>().FloatValue();
        entry.z  = jsObj.Get("z").As<Napi::Number>().FloatValue();

        entry.qw = jsObj.Get("qw").As<Napi::Number>().FloatValue();
        entry.qx = jsObj.Get("qx").As<Napi::Number>().FloatValue();
        entry.qy = jsObj.Get("qy").As<Napi::Number>().FloatValue();
        entry.qz = jsObj.Get("qz").As<Napi::Number>().FloatValue();

        entry.scale = jsObj.Get("scale").As<Napi::Number>().FloatValue();

        // Populate the string dictionary only for new (unique) asset paths
        if (dictMap.find(entry.templatePath) == dictMap.end()) {
            dictMap[entry.templatePath] = dictIndexCounter++;
            snapshot.templateDictionary.push_back(entry.templatePath);
        }

        snapshot.objects.push_back(entry);
    }

    // Compile buffers inside-out
    std::vector<uint8_t> compiledDictionary    = SerializeTemplateDictionary(snapshot.templateDictionary);
    std::vector<uint8_t> compiledObjectsBlock  = SerializeObjectDataBlock(snapshot.objects, dictMap);

    // Assemble the outer WSSN master form
    IffBinaryWriter masterWriter;
    masterWriter.WriteTag("FORM");

    uint32_t rootFormPayloadSize =
        static_cast<uint32_t>(4 + compiledDictionary.size() + compiledObjectsBlock.size());
    masterWriter.WriteUint32(rootFormPayloadSize);
    masterWriter.WriteTag("WSSN");  // World Snapshot identifier

    masterWriter.WriteRawBuffer(compiledDictionary);
    masterWriter.WriteRawBuffer(compiledObjectsBlock);

    // Return final binary payload as a zero-copy Node.js ArrayBuffer
    Napi::ArrayBuffer outputBuffer =
        Napi::ArrayBuffer::New(env, masterWriter.buffer.size());
    std::memcpy(outputBuffer.Data(), masterWriter.buffer.data(), masterWriter.buffer.size());

    return outputBuffer;
}
```

### 3.5 React export button

Extracts active node transforms from the Three.js canvas, calls the C++ compiler via the N-API bridge, and writes the result to disk via the Electron `window.api` backend.

```tsx
import React from 'react';
import * as THREE from 'three';

interface SceneNodeData {
  id: string;
  template: string;
  transformMatrix: THREE.Matrix4;
}

export const SwgSnapshotExporter: React.FC<{
  placedItems: SceneNodeData[];
  nativeBridge: any;
}> = ({ placedItems, nativeBridge }) => {

  const handleExportSnapshot = async () => {
    // Decompose each Three.js Matrix4 into flat structural arrays
    const formattedObjects = placedItems.map((item, index) => {
      const position   = new THREE.Vector3();
      const quaternion = new THREE.Quaternion();
      const scale      = new THREE.Vector3();

      item.transformMatrix.decompose(position, quaternion, scale);

      return {
        networkId:    BigInt(20000000 + index),  // Re-index within a valid sandbox allocation range
        templatePath: item.template,
        x:  position.x,
        y:  position.y,
        z:  position.z,
        qw: quaternion.w,
        qx: quaternion.x,
        qy: quaternion.y,
        qz: quaternion.z,
        scale: scale.x,  // Assumes uniform scaling
      };
    });

    try {
      // Run the C++ inside-out binary snapshot compiler
      const rawArrayBuffer: ArrayBuffer =
        nativeBridge.compileEditorStateToSnapshotStream(formattedObjects);

      // Write the binary payload via the Electron backend API
      const uint8View = new Uint8Array(rawArrayBuffer);
      await window.api.saveFileToDisk("snapshot/tatooine.ws", uint8View);

      alert("Successfully compiled active scene data into a deployable World Snapshot (.ws) binary container!");
    } catch (err: any) {
      alert(`Snapshot Compilation Failed: ${err.message}`);
    }
  };

  return (
    <button
      onClick={handleExportSnapshot}
      style={{
        background: '#00ffcc',
        color: '#111',
        fontWeight: 'bold',
        padding: '10px 14px',
        border: 'none',
        borderRadius: '4px',
        cursor: 'pointer',
      }}
    >
      Compile World Snapshot (.WS)
    </button>
  );
};
```

---

## 4. Integration notes

**Server-side deployment:** `.ws` files feed directly into open-source server emulators (e.g. SWGEmu Core3). Objects placed via this toolchain become persistent server-side entities with collision meshes that player characters can interact with natively. This is distinct from terrain-only mods (`.trn`, `.fld`) which are client-side only.

**Performance:** the compiled C++ parser processes world snapshots containing tens of thousands of objects in milliseconds — far faster than line-by-line script utilities. This makes round-tripping large retail maps (e.g. Corellia, Coronet City) practical for inspection and modification.

**Workflow summary:**

| Direction | Entry point | C++ function | TS helper |
|---|---|---|---|
| Read (.ws → scene) | `DeconstructWsFile` (N-API) | `SwgWsReader::DeconstructWsBuffer` | `parseNativeSnapshotPayload` |
| Write (scene → .ws) | `CompileEditorStateToSnapshotStream` (N-API) | `SerializeTemplateDictionary` + `SerializeObjectDataBlock` | `SwgSnapshotExporter` component |

**Network ID allocation:** the write path assigns IDs starting at `20000000 + index`. Ensure this range does not collide with IDs used by the target server instance before deploying.

**Quaternion component order:** Three.js stores quaternions as `(x, y, z, w)`; the `.ws` file stores them on disk as `qx, qy, qz, qw`. The bridge code above matches this convention — verify against real client source before finalizing.
