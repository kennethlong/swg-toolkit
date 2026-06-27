# SWG Procedural Terrain System (.trn)

> Covers: SWG procedural terrain (`.trn`) — the `PTAT` appearance template, the Layer →
> Boundary/Filter/Affector rule tree, shared resource groups (incl. the `FractalGroup` MultiFractal),
> and what a third-party-terrain importer would have to emit.

> ## ⚠️ GROUND-TRUTH CORRECTION (verified 2026-06-27 vs `swg-client-v2/.../sharedTerrain/` + Core3)
>
> **§§2, 4, 5.1, 6, 9, 10 of the original draft below are FALSIFIED.** The format/tags/noise/serializer
> they describe (`FORM "TRN "`, `MATR/NAME/ADAT/FRAC/BPOLY/MAPP/VERT`, inline per-layer fractal params,
> a custom noise hash, a `"TRN "` writer) **do not exist in the real loader.** They were AI-generated and
> must not be implemented. The verified model is in §1–§2 (rewritten) and the **Verified tag taxonomy**
> table; everything from §3 onward is the original draft, **retained for history only — do NOT implement
> from it.** Ground truth = `ProceduralTerrainAppearanceTemplate.{cpp,h}`, `TerrainGenerator.{cpp,h}`,
> `TerrainGeneratorLoader.cpp`, `AffectorHeight.cpp`, `Filter.cpp`, `BitmapGroup.cpp`,
> `sharedFractal/MultiFractal.h`, and Core3 `MMOCoreORB/src/terrain/ProceduralTerrainAppearance.cpp`.
> When implementing, read byte offsets directly from `ProceduralTerrainAppearanceTemplate::write/_load`
> and validate against a real shipped `.trn` hexdump. See [source provenance](../00-overview/source-provenance.md).

---

## Table of Contents

1. [Overview: What a .trn File Is](#1-overview)
2. [IFF Structure](#2-iff-structure)
3. [Architecture: C++ / TypeScript / Three.js Split](#3-architecture)
4. [Parsing — BPOLY Polygon Boundaries](#4-parsing--bpoly-polygon-boundaries)
5. [Parsing — Recursive LAYR Hierarchy](#5-parsing--recursive-layr-hierarchy)
6. [Parsing — FRAC Fractal Configuration](#6-parsing--frac-fractal-configuration)
7. [Runtime Evaluation Engine](#7-runtime-evaluation-engine)
8. [Rendering — Chunked Terrain Assembly (R3F)](#8-rendering--chunked-terrain-assembly-r3f)
9. [Rendering — Multi-Layer Splat Shader (GLSL)](#9-rendering--multi-layer-splat-shader-glsl)
10. [Serialization — Inside-Out .trn Compilation](#10-serialization--inside-out-trn-compilation)
11. [React UI Components](#11-react-ui-components)
12. [Performance Notes](#12-performance-notes)

---

## 1. Overview (verified)

SWG planet maps (Tatooine, Corellia, etc.) use **no static 3D mesh and no pre-baked heightmap**. One
file per planet — `terrain/<planetName>.trn` (`LocationManager.cpp:204`) — stores a **procedural rule
tree**. Height, vertex color, texturing (shaders), and flora placement are all **generated at runtime
per chunk** by evaluating that tree: `TerrainGenerator::generateChunk(GeneratorChunkData&)` fills a
`heightMap` + `colorMap` + `shaderMap` + flora maps for the requested window (`TerrainGenerator.h:564`).

Verified properties:
- **Deterministic & procedural** — the same world `(x, z)` yields the same height given the same tree.
- **Layered, weighted compositing** — an ordered list of recursive `Layer`s; each layer's boundaries
  produce a `[0,1]` weight, filters gate it, and affectors write into the chunk maps scaled by that
  weight (`Layer::affect`; op enum `TGO_replace/add/subtract/multiply`, `AffectorHeight.cpp:58–93`).
- **Fractal noise via a SHARED group, not inline** — height-fractal affectors store a `familyId` and
  look up a `MultiFractal` from the `FractalGroup` by id (`AffectorHeight.cpp:225–230`). The noise is
  SWG's `sharedFractal` MultiFractal (seed/octaves/frequency/amplitude/gain/bias/CombinationRule —
  `MultiFractal.h`), NOT a custom hash.

---

## 2. IFF Structure (verified — `PTAT`, not `"TRN "`)

`.trn` is only the file **extension**. The IFF top-level FORM type is **`PTAT`** (`TAG(P,T,A,T)`),
versions `0013`–`0015`, current write version **`0015`** (`ProceduralTerrainAppearanceTemplate.cpp:828,
836, 1039`). Core3 parses the same server-side (`MMOCoreORB/src/terrain/ProceduralTerrainAppearance.cpp:32`
→ `getNextFormType() == 'PTAT'`). Byte order / chunk-walking helpers: see
[../01-core-engine/iff-and-tre.md](../01-core-engine/iff-and-tre.md).

```
FORM PTAT (version 0014/0015)
  CHUNK DATA            — name, mapWidthInMeters, chunkWidthInMeters, numberOfTilesPerChunk,
                          global water-table height + shader, environment cycle time,
                          collidable/non-collidable/radial/far-radial flora distances + seeds,
                          legacyMap flag   (exact field order: ...Template.cpp:1043–1072)
  FORM  TGEN            — TerrainGenerator: the procedural rule tree (below)
  FORM  BakedTerrain    — baked passability / water-boundary data (collision)
  <two PackedIntegerMap / PackedFixedPointMap>  — static-collidable-flora maps
```

### TerrainGenerator (`TGEN`) = six shared groups + an ordered Layer list

Groups (`TerrainGenerator.h:479–484`): `ShaderGroup`, `FloraGroup`, `RadialGroup`, `EnvironmentGroup`,
**`FractalGroup`** (the MultiFractal families affectors reference by id), `BitmapGroup` (loose `.tga`
masks). Then a list of recursive **`Layer`**s (`:486`); each `Layer` holds four ordered lists
(`:355–358`): **Boundaries → Filters → Affectors → sub-Layers**.

### Verified tag taxonomy (authoritative dispatch = `TerrainGeneratorLoader.cpp`)

| Kind | Real tags | Notes |
|---|---|---|
| **Boundary** (`createBoundary :62`) | `BCIR` circle · `BREC` rectangle · `BPOL` polygon · `BPLN` polyline | `BALL`,`BSPL` are dead-skipped. (Draft's `BPOLY` is wrong → `BPOL`.) |
| **Filter** (`createFilter :137`) | `FHGT` height · `FFRA` fractal · `FBIT` bitmap · `FSLP` slope · `FDIR` direction · `FSHD` shader | `FBIT` = the only surviving raster path (a MASK, see §heightmaps). |
| **Affector — height** (`createAffector :220`) | `AHCN` constant · `AHFR` fractal · `AHTR` terrace | `AHFR` = `scaleY × FractalGroup[familyId]`. |
| **Affector — color** | `ACCN` constant · `ACRH` ramp-by-height · `ACRF` ramp-by-fractal | |
| **Affector — shader (texture)** | `ASCN` constant · `ASRP` replace | this is SWG's "splat"/texturing, done in the affector tree, not a GLSL shader doc invented. |
| **Affector — flora** | static `AFSC`/`AFCN`/`AFSN` · radial `AFDN`/`ARCN`/`AFDF` | |
| **Affector — other** | `ARIB` ribbon · `AROA` road · `ARIV` river · `AEXC` exclude · `APAS` passable · `AENV` environment | |
| **DEAD / removed** | `AHBM` (height-bitmap — *"no longer exists"*), `ACBM`/`ASBM`/`AFBM`, `AHSM` | `...Loader.cpp:226–264`. |

### Heightmaps: there is NO raster→elevation path

Height is purely procedural (fractal + constant + terrace affectors). The height-from-bitmap affector
`AHBM` was **removed** — you cannot inject a raster heightmap as elevation. The one surviving raster
path is `FBIT`: an **8-bit grayscale `.tga`** (`terrain/<name>.tga`, `Image::PF_w_8`) sampled bilinearly
and normalized `value/255` as a layer **weight/mask** (`Filter.cpp:1081–1125`, `BitmapGroup.cpp`) — it
gates *where* procedural affectors apply, not the elevation itself.

### Authoring + importer surface

Original authoring tool: the client's **TerrainEditor** (MFC,
`client/application/TerrainEditor/`); the loader even instructs "load and save in the TerrainEditor"
(`...Template.cpp:833`). To bring external terrain in, a tool must emit a byte-compatible **`PTAT/0015`**
via `ProceduralTerrainAppearanceTemplate::write` (`:1035–1113`): the `DATA` config + a `TerrainGenerator`
(FractalGroup families + ShaderGroup + a Layer/affector tree) + a (possibly minimal) `BakedTerrain` +
the two packed flora maps. The natural fit is a **procedural→procedural** mapping (noise bands →
`FractalGroup` MultiFractal families → `AHFR`/`AHCN` layers); the hard part is **fractal parity** with
SWG's `sharedFractal` MultiFractal, and **server parity** (Core3 re-parses the same `PTAT`). See the
ProceduralTerrains feasibility note in `.planning/todos/pending/`.

---

> **Everything below (§3–§12) is the ORIGINAL AI-FABRICATED DRAFT. It is FALSIFIED and retained for
> history only — do NOT implement from it.** Its tags (`"TRN "`, `BPOLY`, inline `FRAC`), its
> `CustomNoise2D` hash, its parsers and its `"TRN "` serializer are inventions. Implement against the
> real loader cited in §1–§2.

---

## 3. Architecture: C++ / TypeScript / Three.js Split

Evaluating fractal trees in JavaScript tanks frame rate. The workload splits across three layers:

```
[ .trn Rule File ] ──▶ [ Node-API C++ Engine ] ──▶ (raw Float32Array chunks)
                              │
                     (evaluates fractals,
                      boundary weights)
                              │
                              ▼
              [ TypeScript Grid Coordinator ]
           (manages dynamic chunk recycled bounds)
                              │
                              ▼
           [ Three.js Custom ShaderMaterial ]
        (blends multi-textures in a single pass)
```

The C++ layer:
- Parses `.trn` LAYR/FRAC/BPOLY trees at startup into a live `SwgTerrainEngineContext`.
- Exposes `getHeightAtCoordinate(x, z)` and `generateTerrainChunk(startX, startZ, segments, chunkSize)` via N-API.
- Returns `Float32Array` height data and 4-channel splat blend weights directly into WebGL buffer attributes (zero-copy handoff).

---

## 4. Parsing — BPOLY Polygon Boundaries

Each `LAYR` can contain one or more boundary shapes that spatially restrict where that layer's rules apply. The most common shape is `BPOLY` (polygon). `BCIR` (circle) follows the same FORM wrapper pattern with a center point and radius instead of a vertex list.

### 4.1 C++ Structures

```cpp
struct Vector2D {
    float x;
    float z;
};

struct SwgPolygonBoundary {
    uint32_t id;
    std::string name;
    float featherDistance;  // Soft edge blend width
    bool isInverted;        // True → rule applies *outside* the polygon
    std::vector<Vector2D> vertices;
};
```

### 4.2 BPOLY IFF Parser

This function enters a `FORM "BPOLY"` block already positioned at its start. For the generic `ReadTag` / `ReadUint32` / `ReadFloat` helpers see [../01-core-engine/iff-and-tre.md](../01-core-engine/iff-and-tre.md).

```cpp
static SwgPolygonBoundary ParsePolygonBoundary(const uint8_t* buffer, size_t& offset) {
    SwgPolygonBoundary poly;

    // Consume FORM header
    std::string formType = ReadTag(buffer, offset);  // "FORM"
    uint32_t formSize    = ReadUint32(buffer, offset);
    std::string subType  = ReadTag(buffer, offset);  // "BPOLY"

    size_t endOffset = offset + formSize - 4;
    while (offset < endOffset) {
        std::string chunkId   = ReadTag(buffer, offset);
        uint32_t chunkSize    = ReadUint32(buffer, offset);
        size_t nextChunkOffset = offset + chunkSize;

        if (chunkId == "DATA") {
            poly.id             = ReadUint32(buffer, offset);
            poly.featherDistance = ReadFloat(buffer, offset);
            poly.isInverted     = (ReadUint32(buffer, offset) == 1);
        }
        else if (chunkId == "VERT") {
            uint32_t vertexCount = ReadUint32(buffer, offset);
            poly.vertices.reserve(vertexCount);
            for (uint32_t i = 0; i < vertexCount; ++i) {
                float x = ReadFloat(buffer, offset);
                float z = ReadFloat(buffer, offset);
                poly.vertices.push_back({x, z});
            }
        }

        offset = nextChunkOffset;
    }

    return poly;
}
```

### 4.3 Point-in-Polygon: Ray-Casting (Jordan Curve)

Returns a weight scalar: `0.0` (outside) or `1.0` (inside). Optional feather blending (minimum edge distance) can replace the binary result with a smooth `[0, 1]` fade.

```cpp
float EvaluatePolygonWeight(const SwgPolygonBoundary& poly, float testX, float testZ) {
    bool inside = false;
    size_t count = poly.vertices.size();

    if (count < 3) return 0.0f;

    for (size_t i = 0, j = count - 1; i < count; j = i++) {
        if (((poly.vertices[i].z > testZ) != (poly.vertices[j].z > testZ)) &&
            (testX < (poly.vertices[j].x - poly.vertices[i].x) * (testZ - poly.vertices[i].z) /
            (poly.vertices[j].z - poly.vertices[i].z) + poly.vertices[i].x)) {
            inside = !inside;
        }
    }

    if (poly.isInverted) inside = !inside;
    if (!inside) return 0.0f;

    // If poly.featherDistance > 0, compute minimum distance to nearest edge segment
    // and return a smooth scalar in [0, 1] rather than the hard binary value.
    return 1.0f;
}
```

### 4.4 N-API: Exposing Boundary Vectors to TypeScript

Scans a raw buffer for all `FORM "BPOLY"` blocks, parses each, and returns a JS array. Vertices are packed flat as `[x, z, x, z, ...]` for direct use as Three.js `BufferAttribute` data.

```cpp
Napi::Value ParseTerrainBoundaries(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    Napi::ArrayBuffer inputBuffer = info[0].As<Napi::ArrayBuffer>();
    const uint8_t* rawData = static_cast<const uint8_t*>(inputBuffer.Data());
    size_t bufferSize = inputBuffer.ByteLength();

    std::vector<SwgPolygonBoundary> discoveredPolygons;
    size_t offset = 0;

    while (offset < (bufferSize - 12)) {
        std::string currentTag = SwgTerrainParser::ReadTag(rawData, offset);
        offset -= 4;  // Step back to preserve header boundary

        if (currentTag == "FORM") {
            size_t probeOffset = offset + 8;
            std::string formType = SwgTerrainParser::ReadTag(rawData, probeOffset);
            if (formType == "BPOLY") {
                discoveredPolygons.push_back(SwgTerrainParser::ParsePolygonBoundary(rawData, offset));
                continue;
            }
        }
        offset += 1;
    }

    Napi::Array jsPolyArray = Napi::Array::New(env, discoveredPolygons.size());
    for (size_t i = 0; i < discoveredPolygons.size(); ++i) {
        Napi::Object jsPoly = Napi::Object::New(env);
        jsPoly.Set("id",              Napi::Number::New(env, discoveredPolygons[i].id));
        jsPoly.Set("featherDistance", Napi::Number::New(env, discoveredPolygons[i].featherDistance));
        jsPoly.Set("isInverted",      Napi::Boolean::New(env, discoveredPolygons[i].isInverted));

        Napi::Float32Array pointsArray = Napi::Float32Array::New(env, discoveredPolygons[i].vertices.size() * 2);
        for (size_t v = 0; v < discoveredPolygons[i].vertices.size(); ++v) {
            pointsArray[v * 2]     = discoveredPolygons[i].vertices[v].x;
            pointsArray[v * 2 + 1] = discoveredPolygons[i].vertices[v].z;
        }
        jsPoly.Set("vertices", pointsArray);

        jsPolyArray[i] = jsPoly;
    }

    return jsPolyArray;
}
```

---

## 5. Parsing — Recursive LAYR Hierarchy

### 5.1 ADAT / NAME Field Layout

Each `LAYR` FORM contains:

| Chunk | Fields (in order) |
|-------|-------------------|
| `NAME` | null-terminated ASCII string (layer name) |
| `ADAT` | `uint32 layerId`, `uint32 blendMode` (0=Add, 1=Replace), `float featherDistance`, `uint32 isActive` |
| `FORM "BPOLY"` | Polygon boundary — see §4 |
| `FORM "BCIR"` | Circle boundary |
| `FORM "FRAC"` | Fractal rule — see §6 |
| `FORM "LAYR"` | Nested child layer (recurse) |

Field order within `ADAT` is AI-proposed; validate against `swg-client-v2`.

### 5.2 C++ Layer Node Structure

```cpp
#include <napi.h>
#include <vector>
#include <string>
#include <memory>
#include <cstring>

class SwgTerrainLayerNode {
public:
    uint32_t    layerId         = 0;
    std::string name            = "Unnamed Layer";
    uint32_t    blendMode       = 0;       // 0 = Add, 1 = Replace
    float       featherDistance = 0.0f;
    bool        isActive        = true;

    std::vector<std::unique_ptr<ITerrainBoundary>> boundaries;
    std::vector<std::unique_ptr<ITerrainRule>>     rules;
    std::vector<std::unique_ptr<SwgTerrainLayerNode>> childLayers;
};
```

### 5.3 Recursive LAYR Parser

```cpp
class TrnBinaryParser {
private:
    static std::string Read4CharTag(const uint8_t* data, size_t& offset) {
        char tag[5] = {0};
        std::memcpy(tag, data + offset, 4);
        offset += 4;
        return std::string(tag);
    }

    static uint32_t ReadUint32LE(const uint8_t* data, size_t& offset) {
        uint32_t val;
        std::memcpy(&val, data + offset, 4);
        offset += 4;
        return val;
    }

    static float ReadFloatLE(const uint8_t* data, size_t& offset) {
        float val;
        std::memcpy(&val, data + offset, 4);
        offset += 4;
        return val;
    }

public:
    /**
     * Recursively parses a single LAYR form block out of the raw file stream.
     * Call with offset pointing to the first child chunk (after "LAYR" type tag is consumed).
     */
    static std::unique_ptr<SwgTerrainLayerNode> ParseLayerForm(
        const uint8_t* data, size_t& offset, size_t formEndOffset)
    {
        auto currentNode = std::make_unique<SwgTerrainLayerNode>();

        while (offset < formEndOffset) {
            std::string chunkTag      = Read4CharTag(data, offset);
            uint32_t    chunkSize     = ReadUint32LE(data, offset);
            size_t      nextChunkMarker = offset + chunkSize;

            if (chunkTag == "NAME") {
                currentNode->name = std::string(reinterpret_cast<const char*>(data + offset));
            }
            else if (chunkTag == "ADAT") {
                currentNode->layerId         = ReadUint32LE(data, offset);
                currentNode->blendMode       = ReadUint32LE(data, offset);
                currentNode->featherDistance = ReadFloatLE(data, offset);
                currentNode->isActive        = (ReadUint32LE(data, offset) != 0);
            }
            else if (chunkTag == "FORM") {
                std::string formType = Read4CharTag(data, offset);

                if (formType == "LAYR") {
                    // Recurse into child layer; nextChunkMarker scopes the child's extent
                    auto childNode = ParseLayerForm(data, offset, nextChunkMarker);
                    currentNode->childLayers.push_back(std::move(childNode));
                }
                else if (formType == "BPOLY") {
                    // Step back 12 bytes to re-expose the FORM header for ParsePolygonBoundary
                    offset -= 12;
                    auto polyBound = SwgTerrainParser::ParsePolygonBoundary(data, offset);
                    // currentNode->boundaries.push_back(
                    //     std::make_unique<PolygonBoundary>(polyBound.vertices,
                    //                                       polyBound.featherDistance,
                    //                                       polyBound.isInverted));
                }
                else if (formType == "FRAC") {
                    // Re-enter at current offset (type tag already consumed); parse fractal
                    // See §6.2 — SwgFractalParser::ParseFractalForm
                }
            }

            offset = nextChunkMarker;
        }

        return currentNode;
    }
};
```

### 5.4 Top-Level Entry Point: `ProcessFullTrnFileBuffer`

Validates the outer `FORM "TRN "` header, then seeks forward until the root `FORM "LAYR"` block is found, and fires the recursive parser.

```cpp
std::unique_ptr<SwgTerrainLayerNode> ProcessFullTrnFileBuffer(
    const uint8_t* fileData, size_t totalBytes)
{
    size_t globalOffset = 0;

    std::string rootTag       = TrnBinaryParser::Read4CharTag(fileData, globalOffset);
    uint32_t    totalFormSize = TrnBinaryParser::ReadUint32LE(fileData, globalOffset);
    std::string masterType    = TrnBinaryParser::Read4CharTag(fileData, globalOffset);

    if (rootTag != "FORM" || masterType != "TRN ") {
        throw std::runtime_error("Not a valid SWG .trn file.");
    }

    while (globalOffset < totalBytes) {
        std::string nextTag  = TrnBinaryParser::Read4CharTag(fileData, globalOffset);
        uint32_t    nextSize = TrnBinaryParser::ReadUint32LE(fileData, globalOffset);
        size_t      nextEnd  = globalOffset + nextSize;

        if (nextTag == "FORM") {
            std::string subFormType = TrnBinaryParser::Read4CharTag(fileData, globalOffset);
            if (subFormType == "LAYR") {
                return TrnBinaryParser::ParseLayerForm(fileData, globalOffset, nextEnd);
            }
        }
        globalOffset = nextEnd;
    }

    return nullptr;
}
```

### 5.5 N-API: Layer Tree to JSON for React

```cpp
Napi::Object ConvertLayerToJsObject(Napi::Env env, const SwgTerrainLayerNode* node) {
    Napi::Object jsObj = Napi::Object::New(env);

    jsObj.Set("name",            Napi::String::New(env, node->name));
    jsObj.Set("layerId",         Napi::Number::New(env, node->layerId));
    jsObj.Set("blendMode",       Napi::Number::New(env, node->blendMode));
    jsObj.Set("featherDistance", Napi::Number::New(env, node->featherDistance));
    jsObj.Set("isActive",        Napi::Boolean::New(env, node->isActive));

    Napi::Array jsChildren = Napi::Array::New(env, node->childLayers.size());
    for (size_t i = 0; i < node->childLayers.size(); ++i) {
        jsChildren[i] = ConvertLayerToJsObject(env, node->childLayers[i].get());
    }
    jsObj.Set("children", jsChildren);

    return jsObj;
}

Napi::Value ParseTrnFileStructureJson(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    Napi::ArrayBuffer arrayBuffer = info[0].As<Napi::ArrayBuffer>();
    const uint8_t* rawData  = static_cast<const uint8_t*>(arrayBuffer.Data());
    size_t         byteLength = arrayBuffer.ByteLength();

    try {
        auto rootLayerTree = ProcessFullTrnFileBuffer(rawData, byteLength);
        if (!rootLayerTree) return env.Null();
        return ConvertLayerToJsObject(env, rootLayerTree.get());
    }
    catch (const std::exception& e) {
        Napi::TypeError::New(env, e.what()).ThrowAsJavaScriptException();
        return env.Null();
    }
}
```

---

## 6. Parsing — FRAC Fractal Configuration

### 6.1 FRAC Sub-Container Layout

| Chunk | Fields |
|-------|--------|
| `NAME` | Null-terminated fractal profile name (e.g. `tatooine_dunes_macro`) |
| `DATA` | `uint32 id`, `uint32 seed`, `uint32 octaves`, `float frequency`, `float amplitude`; if `chunkSize >= 24`: `float gain`, `float lacunarity` |
| `MAPP` | `uint32 combinationType` (0=Add, 1=Multiply, 2=Replace) |

Field order and size guard (>=24) are AI-proposed.

### 6.2 C++ FRAC Structure and Parser

```cpp
struct SwgFRACTemplate {
    uint32_t    id              = 0;
    std::string name            = "Unnamed Fractal";
    uint32_t    seed            = 0;
    uint32_t    octaves         = 1;
    float       frequency       = 0.001f;
    float       amplitude       = 1.0f;
    float       gain            = 0.5f;       // Amplitude multiplier per octave
    float       lacunarity      = 2.0f;       // Frequency multiplier per octave
    uint32_t    combinationType = 0;          // 0=Add, 1=Multiply, 2=Replace
};

class SwgFractalParser {
public:
    /**
     * Parses a single FORM "FRAC" container. Call with offset at the start of the FORM tag.
     */
    static SwgFRACTemplate ParseFractalForm(const uint8_t* data, size_t& offset) {
        SwgFRACTemplate frac;

        std::string formType = TrnBinaryParser::Read4CharTag(data, offset);  // "FORM"
        uint32_t    formSize = TrnBinaryParser::ReadUint32LE(data, offset);
        std::string subType  = TrnBinaryParser::Read4CharTag(data, offset);  // "FRAC"

        size_t endOffset = offset + formSize - 4;

        while (offset < endOffset) {
            std::string chunkTag       = TrnBinaryParser::Read4CharTag(data, offset);
            uint32_t    chunkSize      = TrnBinaryParser::ReadUint32LE(data, offset);
            size_t      nextChunkMarker = offset + chunkSize;

            if (chunkTag == "NAME") {
                frac.name = std::string(reinterpret_cast<const char*>(data + offset));
            }
            else if (chunkTag == "DATA") {
                frac.id        = TrnBinaryParser::ReadUint32LE(data, offset);
                frac.seed      = TrnBinaryParser::ReadUint32LE(data, offset);
                frac.octaves   = TrnBinaryParser::ReadUint32LE(data, offset);
                frac.frequency = TrnBinaryParser::ReadFloatLE(data, offset);
                frac.amplitude = TrnBinaryParser::ReadFloatLE(data, offset);
                if (chunkSize >= 24) {
                    frac.gain       = TrnBinaryParser::ReadFloatLE(data, offset);
                    frac.lacunarity = TrnBinaryParser::ReadFloatLE(data, offset);
                }
            }
            else if (chunkTag == "MAPP") {
                frac.combinationType = TrnBinaryParser::ReadUint32LE(data, offset);
            }

            offset = nextChunkMarker;
        }

        return frac;
    }
};
```

---

## 7. Runtime Evaluation Engine

The evaluation engine wires together the parsed structures into a live height-query system. It uses C++ polymorphism so boundaries and rules are interchangeable.

### 7.1 Interfaces

```cpp
#include <vector>
#include <cmath>
#include <memory>
#include <string>
#include <algorithm>

// Restricts or blends a layer spatially
class ITerrainBoundary {
public:
    virtual ~ITerrainBoundary() = default;
    virtual float GetWeight(float x, float z) const = 0;  // Returns [0.0, 1.0]
};

// Modifies height (fractals, terracing, constants)
class ITerrainRule {
public:
    virtual ~ITerrainRule() = default;
    virtual float EvaluateHeight(float x, float z, float currentHeight) const = 0;
};
```

### 7.2 PolygonBoundary (Concrete)

```cpp
class PolygonBoundary : public ITerrainBoundary {
private:
    std::vector<Vector2D> vertices;
    float featherDistance;
    bool  isInverted;
public:
    PolygonBoundary(std::vector<Vector2D> v, float feather, bool invert)
        : vertices(v), featherDistance(feather), isInverted(invert) {}

    float GetWeight(float x, float z) const override {
        bool inside = false;
        size_t count = vertices.size();
        if (count < 3) return 0.0f;

        for (size_t i = 0, j = count - 1; i < count; j = i++) {
            if (((vertices[i].z > z) != (vertices[j].z > z)) &&
                (x < (vertices[j].x - vertices[i].x) * (z - vertices[i].z) /
                (vertices[j].z - vertices[i].z) + vertices[i].x)) {
                inside = !inside;
            }
        }
        if (isInverted) inside = !inside;

        float baseWeight = inside ? 1.0f : 0.0f;
        // Production: apply featherDistance distance-to-edge decay here
        return baseWeight;
    }
};
```

### 7.3 fBm Noise Math

SWG uses a Perlin-family noise seeded deterministically. The interpolated noise function below provides a drop-in implementation:

```cpp
// Deterministic hash matching SWG client seed behavior
float CustomNoise2D(int seed, int x, int z) {
    int n = x + z * 57 + seed * 131;
    n = (n << 13) ^ n;
    return (1.0f - ((n * (n * n * 15731 + 789221) + 1376312589) & 0x7fffffff) / 1073741824.0f);
}

// Bilinear interpolation with cubic S-curve smoothing
float SmoothInterpolateNoise(int seed, float x, float z) {
    int   intX  = static_cast<int>(std::floor(x));
    int   intZ  = static_cast<int>(std::floor(z));
    float fracX = x - intX;
    float fracZ = z - intZ;

    float v1 = CustomNoise2D(seed, intX,     intZ);
    float v2 = CustomNoise2D(seed, intX + 1, intZ);
    float v3 = CustomNoise2D(seed, intX,     intZ + 1);
    float v4 = CustomNoise2D(seed, intX + 1, intZ + 1);

    float sx = fracX * fracX * (3.0f - 2.0f * fracX);  // cubic S-curve
    float sz = fracZ * fracZ * (3.0f - 2.0f * fracZ);

    float i1 = v1 + sx * (v2 - v1);
    float i2 = v3 + sx * (v4 - v3);

    return i1 + sz * (i2 - i1);
}
```

### 7.4 RuntimeFractalEvaluator (Concrete ITerrainRule)

```cpp
class RuntimeFractalEvaluator : public ITerrainRule {
private:
    SwgFRACTemplate config;
public:
    RuntimeFractalEvaluator(SwgFRACTemplate t) : config(t) {}

    float EvaluateHeight(float x, float z, float currentHeight) const override {
        float noiseSum  = 0.0f;
        float currFreq  = config.frequency;
        float currAmp   = config.amplitude;

        // fBm loop — parameters sourced directly from parsed .trn stream
        for (uint32_t i = 0; i < config.octaves; ++i) {
            noiseSum += SmoothInterpolateNoise(config.seed, x * currFreq, z * currFreq) * currAmp;
            currFreq *= config.lacunarity;  // widen wavelength each octave
            currAmp  *= config.gain;        // decay amplitude each octave
        }

        switch (config.combinationType) {
            case 1:  return currentHeight * noiseSum;   // Multiply
            case 2:  return noiseSum;                   // Replace
            case 0:
            default: return currentHeight + noiseSum;   // Add
        }
    }
};
```

### 7.5 TerrainLayer: Recursive Height Evaluation

```cpp
class TerrainLayer {
public:
    std::string name;
    bool isEnabled = true;
    enum class BlendMode { Add, Replace };
    BlendMode mode = BlendMode::Add;

    std::vector<std::unique_ptr<ITerrainBoundary>> boundaries;
    std::vector<std::unique_ptr<ITerrainRule>>     rules;
    std::vector<std::unique_ptr<TerrainLayer>>     childLayers;

    float CalculateHeightAt(float x, float z, float parentHeight) const {
        if (!isEnabled) return parentHeight;

        // 1. Determine boundary weight for this point
        float layerWeight = 1.0f;
        if (!boundaries.empty()) {
            float maxBoundaryWeight = 0.0f;
            for (const auto& boundary : boundaries) {
                maxBoundaryWeight = std::max(maxBoundaryWeight, boundary->GetWeight(x, z));
            }
            layerWeight = maxBoundaryWeight;
        }

        if (layerWeight <= 0.001f) return parentHeight;  // Completely outside — early exit

        // 2. Apply all local terrain rules sequentially
        float calculatedHeight = parentHeight;
        for (const auto& rule : rules) {
            calculatedHeight = rule->EvaluateHeight(x, z, calculatedHeight);
        }

        // 3. Blend local result with parent using boundary weight
        float blendedHeight = parentHeight + ((calculatedHeight - parentHeight) * layerWeight);

        // 4. Recurse into child layers
        for (const auto& child : childLayers) {
            blendedHeight = child->CalculateHeightAt(x, z, blendedHeight);
        }

        return blendedHeight;
    }
};
```

### 7.6 SwgTerrainEngineContext and N-API Height Lookup

```cpp
class SwgTerrainEngineContext {
public:
    std::unique_ptr<TerrainLayer> rootLayer;

    SwgTerrainEngineContext() {
        rootLayer = std::make_unique<TerrainLayer>();
        rootLayer->name = "Global Base Terrain";
        // Example: global rolling hill macro noise
        rootLayer->rules.push_back(std::make_unique<FractalNoiseRule>(0.002f, 35.0f, 3));
    }
};

SwgTerrainEngineContext* g_TerrainEngine = nullptr;

Napi::Value GetHeightAtCoordinate(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (!g_TerrainEngine || !g_TerrainEngine->rootLayer) {
        return Napi::Number::New(env, 0.0f);
    }

    float worldX = info[0].As<Napi::Number>().FloatValue();
    float worldZ = info[1].As<Napi::Number>().FloatValue();

    float calculatedHeight = g_TerrainEngine->rootLayer->CalculateHeightAt(worldX, worldZ, 0.0f);
    return Napi::Number::New(env, calculatedHeight);
}

Napi::Object InitEngineModule(Napi::Env env, Napi::Object exports) {
    g_TerrainEngine = new SwgTerrainEngineContext();
    exports.Set("getHeightAtCoordinate", Napi::Function::New(env, GetHeightAtCoordinate));
    return exports;
}

NODE_API_MODULE(swg_terrain_engine, InitEngineModule)
```

---

## 8. Rendering — Chunked Terrain Assembly (R3F)

Instead of one giant mesh, a recycled grid of terrain chunks (e.g. 3×3 or 5×5) is maintained around the editor camera. When the camera pans, chunks are repositioned and their geometry attributes are updated from C++ data — no mesh recreation.

### 8.1 N-API: `generateTerrainChunk`

The C++ layer accepts a simplified fractal-rule struct that mirrors the parsed `SwgFRACTemplate` fields needed for noise evaluation:

```cpp
// Simplified representation of an SWG Fractal Noise Rule
struct SwgFractalRule {
    int seed;
    float octaves;
    float frequency;
    float amplitude;
};
```

Returns `Float32Array` height data plus 4-channel splat blend weights per vertex, ready for WebGL buffer upload.

```cpp
Napi::Value GenerateTerrainChunk(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    float startX    = info[0].As<Napi::Number>().FloatValue();
    float startZ    = info[1].As<Napi::Number>().FloatValue();
    int   segments  = info[2].As<Napi::Number>().Int32Value();
    float chunkSize = info[3].As<Napi::Number>().FloatValue();

    int vertexCount = (segments + 1) * (segments + 1);

    Napi::Float32Array heightData = Napi::Float32Array::New(env, vertexCount);
    Napi::Float32Array blendData  = Napi::Float32Array::New(env, vertexCount * 4);

    float step  = chunkSize / segments;
    int   index = 0;

    for (int z = 0; z <= segments; ++z) {
        for (int x = 0; x <= segments; ++x) {
            float worldX = startX + (x * step);
            float worldZ = startZ + (z * step);

            // Replace with g_TerrainEngine->rootLayer->CalculateHeightAt(worldX, worldZ, 0.0f)
            float height = 0.0f;
            height += sinf(worldX * 0.005f) * cosf(worldZ * 0.005f) * 45.0f;
            height += sinf(worldX * 0.05f) * 2.5f;

            heightData[index] = height;

            int blendIdx = index * 4;
            if (height < 10.0f) {
                blendData[blendIdx]     = 1.0f;  // Texture 0 (e.g. Mud/Beach)
                blendData[blendIdx + 1] = 0.0f;
            } else {
                blendData[blendIdx]     = 0.0f;
                blendData[blendIdx + 1] = 1.0f;  // Texture 1 (e.g. Grass)
            }
            blendData[blendIdx + 2] = 0.0f;      // Texture 2 (e.g. Rock)
            blendData[blendIdx + 3] = 0.0f;      // Texture 3 (e.g. Snow)

            index++;
        }
    }

    Napi::Object result = Napi::Object::New(env);
    result.Set("heights", heightData);
    result.Set("blends",  blendData);
    return result;
}
```

### 8.2 SwgTerrainChunk (React Three Fiber Component)

```tsx
import React, { useMemo, useRef, useEffect } from 'react';
import * as THREE from 'three';

interface ChunkProps {
  startX: number;
  startZ: number;
  segments: number;
  chunkSize: number;
  nativeBridge: any;
  terrainMaterial: THREE.Material;
}

export const SwgTerrainChunk: React.FC<ChunkProps> = ({
  startX, startZ, segments, chunkSize, nativeBridge, terrainMaterial
}) => {
  const geometryRef = useRef<THREE.BufferGeometry>(null);

  const baseGeometry = useMemo(() => {
    return new THREE.PlaneGeometry(chunkSize, chunkSize, segments, segments);
  }, [chunkSize, segments]);

  useEffect(() => {
    if (!geometryRef.current) return;
    const geo = geometryRef.current;

    const data = nativeBridge.generateTerrainChunk(startX, startZ, segments, chunkSize);
    const rawHeights: Float32Array = data.heights;
    const rawBlends: Float32Array  = data.blends;

    const positionAttr = geo.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < rawHeights.length; i++) {
      // PlaneGeometry maps elevation to Z in plane-space (→ Y in world space after rotation)
      positionAttr.setZ(i, rawHeights[i]);
    }
    positionAttr.needsUpdate = true;

    geo.setAttribute('aSplatWeight', new THREE.BufferAttribute(rawBlends, 4));

    geo.computeVertexNormals();
    geo.computeBoundingBox();
    geo.computeBoundingSphere();
  }, [startX, startZ, segments, chunkSize, nativeBridge]);

  return (
    <mesh
      position={[startX + chunkSize / 2, 0, startZ + chunkSize / 2]}
      rotation={[-Math.PI / 2, 0, 0]}
      material={terrainMaterial}
    >
      <primitive object={baseGeometry} ref={geometryRef} attach="geometry" />
    </mesh>
  );
};
```

### 8.3 Terrain-Snapping Hook

Snap any placed object's Y coordinate to the procedural terrain height via the compiled C++ evaluator:

```typescript
import { useRef } from 'react';
import * as THREE from 'three';

export function useTerrainSnapping(nativeAddon: any) {
  const targetVector = new THREE.Vector3();

  const snapObjectToFloor = (object: THREE.Object3D) => {
    object.getWorldPosition(targetVector);
    const correctHeight = nativeAddon.getHeightAtCoordinate(targetVector.x, targetVector.z);
    object.position.y = correctHeight;
  };

  return { snapObjectToFloor };
}
```

---

## 9. Rendering — Multi-Layer Splat Shader (GLSL)

SWG mixes up to 4–8 textures per terrain chunk via weighted blend. A custom `ShaderMaterial` handles this in a single WebGL draw call by using the `aSplatWeight` vertex attribute filled by the C++ engine.

```typescript
export function createSwgTerrainMaterial(textureUrls: string[]): THREE.Material {
  const loader = new THREE.TextureLoader();
  const textures = textureUrls.map(url => {
    const tex = loader.load(url);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    return tex;
  });

  const material = new THREE.MeshStandardMaterial({
    roughness: 0.8,
    metalness: 0.0
  });

  const terrainUniforms = {
    uTexBank:      { value: textures },
    uTextureScale: { value: 32.0 }
  };

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, terrainUniforms);

    // Inject varying declarations into fragment shader
    shader.fragmentShader = `
      varying vec4 vSplatWeight;
      varying vec2 vTerrainUv;
      uniform sampler2D uTexBank[4];
      uniform float uTextureScale;
    \n` + shader.fragmentShader;

    // Inject attribute declarations into vertex shader
    shader.vertexShader = `
      attribute vec4 aSplatWeight;
      varying vec4 vSplatWeight;
      varying vec2 vTerrainUv;
    \n` + shader.vertexShader;

    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      `
      #include <begin_vertex>
      vSplatWeight = aSplatWeight;
      vTerrainUv   = uv;
      `
    );

    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <map_fragment>',
      `
      vec2 scaledUv = vTerrainUv * uTextureScale;

      vec4 col0 = texture2D(uTexBank[0], scaledUv);
      vec4 col1 = texture2D(uTexBank[1], scaledUv);
      vec4 col2 = texture2D(uTexBank[2], scaledUv);
      vec4 col3 = texture2D(uTexBank[3], scaledUv);

      // Linear splat blend driven by C++ rule evaluation output
      vec4 mixedColor = (col0 * vSplatWeight.r)
                      + (col1 * vSplatWeight.g)
                      + (col2 * vSplatWeight.b)
                      + (col3 * vSplatWeight.a);

      diffuseColor *= mixedColor;
      `
    );
  };

  return material;
}
```

**GLSL blend equation** (embedded in the fragment shader injection above):

```glsl
vec4 mixedColor = (col0 * vSplatWeight.r)
                + (col1 * vSplatWeight.g)
                + (col2 * vSplatWeight.b)
                + (col3 * vSplatWeight.a);
diffuseColor *= mixedColor;
```

---

## 10. Serialization — Inside-Out .trn Compilation

When writing IFF, you must build from the **inside out** — child chunks must be serialized first so their byte sizes are known before parent headers can be written. For the full `IffBinaryWriter` class (`WriteTag` / `WriteUint32` / `WriteFloat` / `WriteString` / `WriteRawBuffer` / `PackChunk`), see [../01-core-engine/iff-and-tre.md](../01-core-engine/iff-and-tre.md).

```
[ TS Layer Tree ] → SerializeFractalForm → (bytes + size known)
                 → SerializeLayerForm (recurse children first) → (bytes + size known)
                 → CompileTerrainToTrnStream (prepend FORM "TRN ") → ArrayBuffer → disk
```

### 10.1 Serialize FRAC Block

```cpp
std::vector<uint8_t> SerializeFractalForm(const SwgFRACTemplate& frac) {
    IffBinaryWriter contentWriter;

    // NAME chunk
    IffBinaryWriter nameWriter;
    nameWriter.WriteString(frac.name);
    contentWriter.PackChunk("NAME", nameWriter.buffer);

    // DATA chunk
    IffBinaryWriter dataWriter;
    dataWriter.WriteUint32(frac.id);
    dataWriter.WriteUint32(frac.seed);
    dataWriter.WriteUint32(frac.octaves);
    dataWriter.WriteFloat(frac.frequency);
    dataWriter.WriteFloat(frac.amplitude);
    dataWriter.WriteFloat(frac.gain);
    dataWriter.WriteFloat(frac.lacunarity);
    contentWriter.PackChunk("DATA", dataWriter.buffer);

    // MAPP chunk
    IffBinaryWriter mappWriter;
    mappWriter.WriteUint32(frac.combinationType);
    contentWriter.PackChunk("MAPP", mappWriter.buffer);

    // Wrap in FORM "FRAC"
    IffBinaryWriter formWriter;
    formWriter.WriteTag("FORM");
    formWriter.WriteUint32(static_cast<uint32_t>(contentWriter.buffer.size() + 4));
    formWriter.WriteTag("FRAC");
    formWriter.WriteRawBuffer(contentWriter.buffer);

    return formWriter.buffer;
}
```

### 10.2 Serialize LAYR Block (Recursive)

```cpp
std::vector<uint8_t> SerializeLayerForm(const SwgTerrainLayerNode& node) {
    IffBinaryWriter contentWriter;

    // NAME chunk
    IffBinaryWriter nameWriter;
    nameWriter.WriteString(node.name);
    contentWriter.PackChunk("NAME", nameWriter.buffer);

    // ADAT chunk
    IffBinaryWriter adatWriter;
    adatWriter.WriteUint32(node.layerId);
    adatWriter.WriteUint32(node.blendMode);
    adatWriter.WriteFloat(node.featherDistance);
    adatWriter.WriteUint32(node.isActive ? 1 : 0);
    contentWriter.PackChunk("ADAT", adatWriter.buffer);

    // Append serialized FRAC rule blocks
    for (const auto& rule : node.rules) {
        // contentWriter.WriteRawBuffer(SerializeFractalForm(rule->GetTemplate()));
    }

    // Recurse into child layers
    for (const auto& child : node.childLayers) {
        std::vector<uint8_t> childBytes = SerializeLayerForm(*child);
        contentWriter.WriteRawBuffer(childBytes);
    }

    // Wrap in FORM "LAYR"
    IffBinaryWriter formWriter;
    formWriter.WriteTag("FORM");
    formWriter.WriteUint32(static_cast<uint32_t>(contentWriter.buffer.size() + 4));
    formWriter.WriteTag("LAYR");
    formWriter.WriteRawBuffer(contentWriter.buffer);

    return formWriter.buffer;
}
```

### 10.3 N-API Root Compiler: `CompileTerrainToTrnStream`

```cpp
Napi::Value CompileTerrainToTrnStream(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    // Unpack incoming JS layer tree back to native C++ structure
    Napi::Object jsRootNode = info[0].As<Napi::Object>();
    SwgTerrainLayerNode rootNode = ReconstructNativeNodeFromJs(jsRootNode);

    // Compile the full tree recursively
    std::vector<uint8_t> terrainTreeBytes = SerializeLayerForm(rootNode);

    // Wrap in master FORM "TRN "
    IffBinaryWriter masterFileWriter;
    masterFileWriter.WriteTag("FORM");
    masterFileWriter.WriteUint32(static_cast<uint32_t>(terrainTreeBytes.size() + 4));
    masterFileWriter.WriteTag("TRN ");
    masterFileWriter.WriteRawBuffer(terrainTreeBytes);

    // Return as ArrayBuffer to TypeScript
    Napi::ArrayBuffer outputBuffer = Napi::ArrayBuffer::New(
        env, masterFileWriter.buffer.size());
    std::memcpy(
        outputBuffer.Data(),
        masterFileWriter.buffer.data(),
        masterFileWriter.buffer.size());

    return outputBuffer;
}
```

---

## 11. React UI Components

### 11.1 Layer Tree Explorer Panel

```tsx
import React from 'react';

interface TerrainLayerDataNode {
  name: string;
  layerId: number;
  blendMode: number;
  isActive: boolean;
  children: TerrainLayerDataNode[];
}

export const SwgTerrainTreeExplorerPanel: React.FC<{ rootLayer: TerrainLayerDataNode }> = ({ rootLayer }) => {

  const renderLayerItemNode = (node: TerrainLayerDataNode) => (
    <div key={node.layerId} style={{ paddingLeft: '16px', borderLeft: '1px dashed #444', margin: '4px 0' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <input type="checkbox" defaultChecked={node.isActive} />
        <span style={{ color: '#e0e0e0', fontWeight: 'bold' }}>{node.name}</span>
        <span style={{ fontSize: '11px', color: '#888' }}>
          (ID: {node.layerId} — Mode: {node.blendMode === 1 ? 'Replace' : 'Add'})
        </span>
      </div>
      {node.children.length > 0 && (
        <div style={{ marginTop: '4px' }}>
          {node.children.map(child => renderLayerItemNode(child))}
        </div>
      )}
    </div>
  );

  return (
    <div style={{ background: '#1e1e1e', padding: '12px', borderRadius: '6px', fontFamily: 'monospace' }}>
      <h3 style={{ color: '#00ffcc', marginTop: 0 }}>Planet Layer Tree Explorer</h3>
      {renderLayerItemNode(rootLayer)}
    </div>
  );
};
```

### 11.2 Fractal Inspector Card

To populate the inspector panel, the C++ N-API layer packages a parsed `SwgFRACTemplate` into a JS object that the React frontend can consume directly:

```cpp
Napi::Object PackageFractalToJsObject(Napi::Env env, const SwgFRACTemplate& frac) {
    Napi::Object obj = Napi::Object::New(env);
    obj.Set("id", Napi::Number::New(env, frac.id));
    obj.Set("name", Napi::String::New(env, frac.name));
    obj.Set("seed", Napi::Number::New(env, frac.seed));
    obj.Set("octaves", Napi::Number::New(env, frac.octaves));
    obj.Set("frequency", Napi::Number::New(env, frac.frequency));
    obj.Set("amplitude", Napi::Number::New(env, frac.amplitude));
    obj.Set("gain", Napi::Number::New(env, frac.gain));
    obj.Set("lacunarity", Napi::Number::New(env, frac.lacunarity));
    obj.Set("combinationType", Napi::Number::New(env, frac.combinationType));
    return obj;
}
```

Allows real-time slider manipulation of fBm parameters. `onParameterChange` should pipe the updated config to the C++ engine context and trigger a Three.js re-render.

```tsx
import React, { useState } from 'react';

interface FractalConfig {
  id: number;
  name: string;
  seed: number;
  octaves: number;
  frequency: number;
  amplitude: number;
  combinationType: number;
}

interface Props {
  initialConfig: FractalConfig;
  onParameterChange: (updated: FractalConfig) => void;
}

export const SwgFractalInspectorCard: React.FC<Props> = ({ initialConfig, onParameterChange }) => {
  const [config, setConfig] = useState<FractalConfig>(initialConfig);

  const updateParam = (key: keyof FractalConfig, value: number) => {
    const updated = { ...config, [key]: value };
    setConfig(updated);
    onParameterChange(updated);
  };

  return (
    <div style={{ background: '#252526', border: '1px solid #3c3c3c', padding: '16px', borderRadius: '4px' }}>
      <h4 style={{ color: '#f1f1f1', margin: '0 0 12px 0' }}>Fractal: {config.name}</h4>

      <div style={{ display: 'grid', gap: '10px', fontSize: '12px', color: '#cccccc' }}>
        <label>
          Seed:
          <input
            type="number"
            value={config.seed}
            onChange={(e) => updateParam('seed', parseInt(e.target.value))}
            style={{ float: 'right', width: '80px' }}
          />
        </label>

        <label>
          Detail Complexity (Octaves: {config.octaves}):
          <input
            type="range" min="1" max="8"
            value={config.octaves}
            onChange={(e) => updateParam('octaves', parseInt(e.target.value))}
            style={{ width: '100%' }}
          />
        </label>

        <label>
          Wavelength Scale (Frequency: {config.frequency.toFixed(5)}):
          <input
            type="range" min="0.0001" max="0.05" step="0.0001"
            value={config.frequency}
            onChange={(e) => updateParam('frequency', parseFloat(e.target.value))}
            style={{ width: '100%' }}
          />
        </label>

        <label>
          Peak Elevation (Amplitude: {config.amplitude}):
          <input
            type="range" min="0" max="200" step="1"
            value={config.amplitude}
            onChange={(e) => updateParam('amplitude', parseFloat(e.target.value))}
            style={{ width: '100%' }}
          />
        </label>
      </div>
    </div>
  );
};
```

### 11.3 Boundary Visualizer (R3F)

Draws BPOLY outlines as lines in the Three.js viewport. Red = inverted (exclusive) boundary; teal = inclusive. Dashed when a feather blend distance is set.

```tsx
import React, { useMemo } from 'react';
import * as THREE from 'three';
import { Line } from '@react-three/drei';

interface BoundaryData {
  id: number;
  featherDistance: number;
  isInverted: boolean;
  vertices: Float32Array;  // Flat: [x, z, x, z, ...]
}

export const SwgTerrainBoundaryVisualizer: React.FC<{ boundary: BoundaryData }> = ({ boundary }) => {

  const points3D = useMemo(() => {
    const points: THREE.Vector3[] = [];
    for (let i = 0; i < boundary.vertices.length; i += 2) {
      // Elevate slightly above terrain to avoid Z-fighting
      points.push(new THREE.Vector3(boundary.vertices[i], 1000.0, boundary.vertices[i + 1]));
    }
    if (points.length > 0) points.push(points[0].clone());  // Close the loop
    return points;
  }, [boundary.vertices]);

  return (
    <Line
      points={points3D}
      color={boundary.isInverted ? '#ff0033' : '#00ffcc'}
      lineWidth={2}
      dashed={boundary.featherDistance > 0}
      dashSize={5}
      gapSize={2}
    />
  );
};
```

### 11.4 Planet Exporter Widget

```tsx
import React from 'react';

interface ExportButtonProps {
  activeLayerTreeState: any;  // Reactive UI state of the modified terrain tree
  nativeAddon: any;           // Node-API C++ binary handler
}

export const SwgPlanetExporterWidget: React.FC<ExportButtonProps> = ({
  activeLayerTreeState,
  nativeAddon
}) => {

  const handleExportTrnFile = async () => {
    try {
      const compiledArrayBuffer: ArrayBuffer =
        nativeAddon.compileTerrainToTrnStream(activeLayerTreeState);

      const rawBytesView = new Uint8Array(compiledArrayBuffer);
      await window.api.saveFileToDisk('patch_tatooine.trn', rawBytesView);

      alert('Successfully compiled into a deployable SWG client map payload!');
    }
    catch (err: any) {
      console.error('Compilation fault:', err);
      alert(`Export failed: ${err.message}`);
    }
  };

  return (
    <button
      onClick={handleExportTrnFile}
      style={{
        background: '#00ffcc',
        color: '#121212',
        fontWeight: 'bold',
        padding: '10px 16px',
        border: 'none',
        borderRadius: '4px',
        cursor: 'pointer'
      }}
    >
      Compile &amp; Export .TRN Map
    </button>
  );
};
```

**Deployment path after export:**
- Client: copy generated `.trn` into `appearance/terrain/` in the local development client.
- Server (SWGEmu / Core3): copy the same file into the equivalent server terrain directory.
- Because the Three.js frontend mirrors the procedural math exactly, procedural valleys, slopes, and boundary clearances will be pixel-accurate in-game.

---

## 12. Performance Notes

- **Reuse geometries.** Never delete and recreate `THREE.PlaneGeometry` instances per chunk reload. Allocate once; mutate only the `position` and `aSplatWeight` buffer attributes.
- **Zero memory copy.** All terrain math runs in the C++ module. The UI thread never locks during deep chunk evaluation. `Float32Array` is handed directly to WebGL without duplication.
- **Infinite scaling.** Querying heights algebraically (not from a pre-loaded mesh) means the editor can load an entire planet with no load screen.
- **Deterministic previews.** Because the C++ math mirrors the compiled SWG client logic exactly, assets placed in the Three.js editor will look identical in the live game after IPC injection.
- **Layer toggle.** Setting `isActive = false` on a `SwgTerrainLayerNode` and propagating that change to the C++ context causes the layer and all its children to be skipped in `CalculateHeightAt`, providing instant real-time terrain preview without file I/O.
