# Phase 2: 3D Mesh Viewport (MVP Proof) — Pattern Map

**Mapped:** 2026-06-23
**Files analyzed:** 28 (new/modified)
**Analogs found:** 27 / 28 (1 has no existing analog — R3F Canvas/SkinnedMesh wiring is net-new)

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `packages/native-core/modules/core/formats/Mesh.{h,cpp}` | service/parser | CRUD, batch | `modules/core/iff/Iff.{h,cpp}` | role-match |
| `packages/native-core/modules/core/formats/SkeletalMeshGen.{h,cpp}` | service/parser | CRUD, batch | `modules/core/iff/Iff.{h,cpp}` | role-match |
| `packages/native-core/modules/core/formats/Skeleton.{h,cpp}` | service/parser | CRUD, batch | `modules/core/iff/Iff.{h,cpp}` | role-match |
| `packages/native-core/modules/core/formats/SkeletalAppearance.{h,cpp}` | service/parser | CRUD, batch | `modules/core/iff/Iff.{h,cpp}` | role-match |
| `packages/native-core/modules/core/formats/MeshLod.{h,cpp}` | service/parser | CRUD, batch | `modules/core/iff/Iff.{h,cpp}` | role-match |
| `packages/native-core/modules/core/formats/Animation.{h,cpp}` | service/parser | CRUD, batch | `modules/core/iff/Iff.{h,cpp}` | role-match |
| `packages/native-core/modules/core/formats/Shader.{h,cpp}` | service/parser | CRUD | `modules/core/iff/Iff.{h,cpp}` | role-match |
| `packages/native-core/modules/core/formats/Palette.{h,cpp}` | service/parser | CRUD | `modules/core/iff/Iff.{h,cpp}` | role-match |
| `packages/native-core/modules/core/formats/Dds.{h,cpp}` | service/parser | CRUD, batch | `modules/core/iff/Iff.{h,cpp}` | role-match |
| `packages/native-core/modules/core/geometry/DeIndex.{h,cpp}` | utility | transform, batch | `modules/core/compress/Zlib.{h,cpp}` | partial-match |
| `packages/native-core/src/mesh_binding.cpp` | middleware/binding | request-response | `src/iff_binding.cpp` | exact |
| `packages/native-core/src/anim_binding.cpp` | middleware/binding | request-response | `src/iff_binding.cpp` | exact |
| `packages/native-core/src/addon.cpp` *(MODIFY)* | config | — | `src/addon.cpp` | exact |
| `packages/contracts/src/mesh.ts` | model | request-response | `contracts/src/iff.ts` | exact |
| `packages/contracts/src/skeleton.ts` | model | request-response | `contracts/src/iff.ts` | exact |
| `packages/contracts/src/animation.ts` | model | request-response | `contracts/src/iff.ts` | exact |
| `packages/contracts/src/material.ts` | model | request-response | `contracts/src/iff.ts` | exact |
| `packages/contracts/src/index.ts` *(MODIFY)* | config | — | `contracts/src/index.ts` | exact |
| `packages/harness/test/mesh-roundtrip.test.ts` | test | batch | `harness/test/iff-roundtrip.test.ts` | exact |
| `packages/renderer/src/panels/viewport/Viewport.tsx` | component | event-driven | `renderer/src/panels/ViewportPanel.tsx` | role-match |
| `packages/renderer/src/panels/viewport/SkinnedMeshView.tsx` | component | event-driven | `renderer/src/panels/ViewportPanel.tsx` | partial-match |
| `packages/renderer/src/panels/viewport/LodPicker.tsx` | component | request-response | `renderer/src/panels/iff/IffStructureTree.tsx` | partial-match |
| `packages/renderer/src/panels/viewport/CustomizationPanel.tsx` | component | event-driven | `renderer/src/panels/tre/VfsSearchField.tsx` | partial-match |
| `packages/renderer/src/panels/viewport/MaterialInspector.tsx` | component | request-response | `renderer/src/panels/iff/IffStructureTree.tsx` | partial-match |
| `packages/renderer/src/panels/viewport/AnimationTransport.tsx` | component | event-driven | `renderer/src/panels/ViewportPanel.tsx` | partial-match |
| `packages/renderer/src/panels/viewport/AppearancePanel.tsx` | component | request-response | `renderer/src/panels/iff/IffStructureTree.tsx` | partial-match |
| `packages/renderer/src/panels/viewport/ExportDialog.tsx` | component | request-response | `renderer/src/shared/AsyncProgress.tsx` | partial-match |
| `packages/renderer/src/panels/viewport/resolver/appearanceResolver.ts` | service | CRUD, event-driven | `renderer/src/state/treStore.ts` | partial-match |
| `packages/renderer/src/state/viewportStore.ts` | store | event-driven | `renderer/src/state/iffStore.ts` | exact |

---

## Pattern Assignments

---

### `packages/native-core/modules/core/formats/Mesh.{h,cpp}` (parser, batch)
### `packages/native-core/modules/core/formats/SkeletalMeshGen.{h,cpp}` (parser, batch)
### `packages/native-core/modules/core/formats/Skeleton.{h,cpp}` (parser, batch)
### `packages/native-core/modules/core/formats/SkeletalAppearance.{h,cpp}` (parser, batch)
### `packages/native-core/modules/core/formats/MeshLod.{h,cpp}` (parser, batch)
### `packages/native-core/modules/core/formats/Animation.{h,cpp}` (parser, batch)
### `packages/native-core/modules/core/formats/Shader.{h,cpp}` (parser, batch)
### `packages/native-core/modules/core/formats/Palette.{h,cpp}` (parser, batch)
### `packages/native-core/modules/core/formats/Dds.{h,cpp}` (parser, batch)

**Analog:** `packages/native-core/modules/core/iff/Iff.h` + `Iff.cpp`

All new format parsers follow the same structural shape as the Phase-1 IFF engine-free C++20 library. They are engine-free (no N-API, no SOE engine headers), consume `parseIff` to get the IFF tree, then do typed extraction into a format-specific struct.

**Header / namespace pattern** (`Iff.h` lines 40–51):
```cpp
/**
 * modules/core/formats/{Format}.h — Engine-free C++20 {FORMAT} parser.
 *
 * PORT SOURCE:
 *   swg-client-v2 clientSkeletalAnimation/.../appearance/{FormatTemplate}.cpp:{lines}
 *   swg-client-v2 clientGraphics/.../{Loader}.cpp:{lines}
 *
 * KEY GROUND-TRUTH FACTS (verified against source, do NOT re-derive):
 *   - ...
 */

#pragma once

#include <cstdint>
#include <string>
#include <vector>
#include <stdexcept>
#include <span>
#include "iff/Iff.h"   // parseIff / IffParseResult / IffNode

namespace swg_core {
namespace formats {
```

**Error class pattern** (`Iff.h` lines 59–62):
```cpp
class FormatParseError : public std::runtime_error {
public:
    explicit FormatParseError(const std::string& msg) : std::runtime_error(msg) {}
};
```

**Core parse function signature** (`Iff.h` lines 166–192):
```cpp
// Parse the typed struct from an already-parsed IFF tree.
// data/size are needed only for security-cap validation (delegate to parseIff first).
FormatStruct parseFormat(const swg_core::iff::IffNode& root);

// Round-trip: typed parsers may be read-only viewers; round-trip uses the IFF layer:
//   auto iffResult = parseIff(data, size);
//   auto out = serializeIff(iffResult, data, size);  // byte-exact for unedited input
```

**Security pattern — inherit IFF caps, add count-bounds checks:**
```cpp
// Iff.h:146-149 already enforces: per-chunk <= 64 MB, childEnd <= parentEnd,
// non-printable FourCC rejected. New parsers add:
if (count > kMaxExpectedCount) {
    throw FormatParseError("count field " + std::to_string(count) +
                           " exceeds expected maximum @ 0x" + hexOffset(byteOffset));
}
```

---

### `packages/native-core/modules/core/geometry/DeIndex.{h,cpp}` (utility, transform)

**Analog:** `packages/native-core/modules/core/compress/Zlib.{h,cpp}` (engine-free utility transform)

This is a pure C++ utility with no N-API surface — called from `SkeletalMeshGen.cpp` and `Mesh.cpp` before results cross the bridge. The Zlib pattern is the closest analog for "engine-free utility that transforms binary data in place."

**Utility header pattern** (`Zlib.h`):
```cpp
#pragma once
#include <cstdint>
#include <vector>
#include <stdexcept>

namespace swg_core {
namespace geometry {

struct DeIndexedBuffers {
    std::vector<float>    positions;   // flat x,y,z per shader-local vertex
    std::vector<float>    normals;     // flat nx,ny,nz per shader-local vertex
    std::vector<float>    uvs;         // flat u,v per shader-local vertex
    std::vector<uint16_t> indices;     // triangle indices into the above (shader-local)
    // skinning (optional — present only for .mgn):
    std::vector<int32_t>  skinIndices; // vec4 bone indices, 4 per vertex
    std::vector<float>    skinWeights; // vec4 bone weights (normalized to sum 1.0), 4 per vertex
    uint32_t              weightsTruncated; // count of vertices where >4 influences were truncated
};

/**
 * De-index a single PSDT shader group.
 * POSN/NORM are the global pools; PIDX/NIDX are the per-group index arrays.
 * Output: one BufferGeometry-ready DeIndexedBuffers per group.
 *
 * Source: RESEARCH.md Pattern 2 (de-index pass, delta #3)
 *   + swg-client-v2 SkeletalMeshGeneratorTemplate.cpp (POSN/NORM/PIDX/NIDX/PRIM chunk set)
 */
DeIndexedBuffers deIndex(
    const float*    posPool,   uint32_t posCount,
    const float*    normPool,  uint32_t normCount,
    const int32_t*  pidx,      uint32_t pidxCount,
    const int32_t*  nidx,      uint32_t nidxCount,
    const float*    uvs,       uint32_t uvCount,
    const uint32_t* prim,      uint32_t primCount
);

/**
 * Normalize variable-count TWHD/TWDT skin weights to fixed vec4.
 * Per vertex: top-4 by weight descending, renormalize to sum 1.0, zero-pad.
 *
 * Source: RESEARCH.md Pattern 3 (vec4 skin-weight normalization, delta #2)
 *   + swg-client-v2 SkeletalMeshGeneratorTemplate.cpp TWHD/TWDT chunk semantics
 */
void normalizeSkinWeightsInto(
    DeIndexedBuffers&   out,         // writes skinIndices + skinWeights
    const int32_t*      twhd,        uint32_t vertexCount,   // per-vertex count
    const int32_t*      twdt_xform,  uint32_t twdtCount,     // (transformIndex, weight) pairs
    const float*        twdt_weight,
    const std::string*  xfnm,        uint32_t xfnmCount,     // XFNM name list
    const std::vector<std::string>& boneOrder  // from resolved Skeleton
);

} // namespace geometry
} // namespace swg_core
```

---

### `packages/native-core/src/mesh_binding.cpp` (N-API binding, request-response)
### `packages/native-core/src/anim_binding.cpp` (N-API binding, request-response)

**Analog:** `packages/native-core/src/iff_binding.cpp` — exact match

The binding layer is always a thin transliteration: validate args → extract bytes → call engine-free lib → return typed JSON + zero-copy ArrayBuffer. Copy the shape verbatim.

**File header / zero-copy contract comment** (`iff_binding.cpp` lines 1–23):
```cpp
/**
 * mesh_binding.cpp — Thin N-API binding for the mesh format parsers.
 *
 * Wires swg_core::formats::{Mesh,SkeletalMeshGen,...} into the N-API addon.
 * This file is a THIN BINDING LAYER ONLY — no parse logic here (Decision D-02).
 *
 * Exports (registered in addon.cpp):
 *   parseMesh(bytes: ArrayBuffer|Uint8Array) -> MeshParseResult (typed JSON) + geometry ArrayBuffer
 *   parseSkeletalMesh(bytes)                 -> SkeletalMeshParseResult + geometry + skin ArrayBuffers
 *   parseSkeleton(bytes)                     -> SkeletonParseResult (typed JSON)
 *   parseAnimation(bytes)                    -> AnimationParseResult + keyframe ArrayBuffer
 *   parseShader(bytes)                       -> ShaderParseResult (typed JSON)
 *   parsePalette(bytes)                      -> PaletteParseResult (typed JSON, RGBA entries)
 *   parseDds(bytes)                          -> DdsParseResult (typed JSON mip table)
 *
 * Return contract:
 *   - Structure (node tree, bone names, slot map, mip table) crosses as typed JSON.
 *   - Binary payloads (geometry attrs, keyframe buffers, compressed DXT blocks) cross
 *     as zero-copy ArrayBuffer.
 *   - NEVER return binary as JSON (AGENTS.md zero-copy rule).
 *
 * Source (binding pattern): packages/native-core/src/iff_binding.cpp
 */
```

**extractBytes helper** (`iff_binding.cpp` lines 39–55) — copy verbatim, it handles both ArrayBuffer and Uint8Array:
```cpp
static std::pair<const uint8_t*, size_t>
extractBytes(const Napi::Value& val, Napi::Env env, const char* argName) {
    if (val.IsArrayBuffer()) {
        auto ab = val.As<Napi::ArrayBuffer>();
        return { static_cast<const uint8_t*>(ab.Data()), ab.ByteLength() };
    }
    if (val.IsTypedArray()) {
        auto ta = val.As<Napi::TypedArray>();
        if (ta.TypedArrayType() == napi_uint8_array) {
            auto u8 = val.As<Napi::Uint8Array>();
            return { u8.Data(), u8.ByteLength() };
        }
    }
    std::string msg = std::string(argName) + " must be an ArrayBuffer or Uint8Array";
    Napi::TypeError::New(env, msg).ThrowAsJavaScriptException();
    return { nullptr, 0 };
}
```

**Function shape** (`iff_binding.cpp` lines 147–224) — arg-count guard → type guard → extract → try/catch → build result:
```cpp
Napi::Value ParseMesh(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1) {
        Napi::TypeError::New(env, "parseMesh: (bytes: ArrayBuffer|Uint8Array) required")
            .ThrowAsJavaScriptException();
        return env.Undefined();
    }
    auto [data, size] = extractBytes(info[0], env, "parseMesh bytes");
    if (!data) return env.Undefined();

    try {
        auto iffResult = swg_core::iff::parseIff(data, static_cast<uint32_t>(size));
        auto mesh      = swg_core::formats::parseMesh(iffResult.roots[0]);
        auto deIndexed = swg_core::geometry::deIndex(/* ... mesh pools ... */);

        auto result = Napi::Object::New(env);
        // typed JSON: bone names, shader group count, format metadata
        result.Set("groupCount", Napi::Number::New(env, deIndexed.size()));
        // ... populate typed JSON fields ...

        // Binary geometry: return as ArrayBuffer (zero-copy)
        // (positions, normals, uvs, indices — packed as one typed-array blob per group)
        auto ab = Napi::ArrayBuffer::New(env, geomBytes.size());
        std::memcpy(ab.Data(), geomBytes.data(), geomBytes.size());
        result.Set("geometry", ab);

        return result;
    } catch (const swg_core::iff::IffParseError& e) {
        Napi::Error::New(env, std::string("IFF parse error: ") + e.what())
            .ThrowAsJavaScriptException();
        return env.Undefined();
    } catch (const swg_core::formats::FormatParseError& e) {
        Napi::Error::New(env, std::string("Mesh parse error: ") + e.what())
            .ThrowAsJavaScriptException();
        return env.Undefined();
    } catch (const std::exception& e) {
        Napi::Error::New(env, std::string("Internal error: ") + e.what())
            .ThrowAsJavaScriptException();
        return env.Undefined();
    }
}
```

**ArrayBuffer return pattern** (`iff_binding.cpp` lines 285–289):
```cpp
// Return as ArrayBuffer — caller must not free (copy into JS-heap-owned buffer for safety)
auto ab = Napi::ArrayBuffer::New(env, out.size());
std::memcpy(ab.Data(), out.data(), out.size());
return ab;
```

---

### `packages/native-core/src/addon.cpp` (MODIFY — binding registry)

**Analog:** `packages/native-core/src/addon.cpp` (exact — extend the existing file)

**Registration pattern** (`addon.cpp` lines 84–119) — forward-declare then register in `Init`:
```cpp
// Phase 2 format binding forward declarations (implemented in mesh_binding.cpp, anim_binding.cpp):
Napi::Value ParseMesh(const Napi::CallbackInfo& info);
Napi::Value ParseSkeletalMesh(const Napi::CallbackInfo& info);
Napi::Value ParseSkeleton(const Napi::CallbackInfo& info);
Napi::Value ParseSkeletalAppearance(const Napi::CallbackInfo& info);
Napi::Value ParseMeshLod(const Napi::CallbackInfo& info);
Napi::Value ParseAnimation(const Napi::CallbackInfo& info);
Napi::Value ParseShader(const Napi::CallbackInfo& info);
Napi::Value ParsePalette(const Napi::CallbackInfo& info);
Napi::Value ParseDds(const Napi::CallbackInfo& info);

// In Init():
exports.Set("parseMesh",            Napi::Function::New(env, ParseMesh));
exports.Set("parseSkeletalMesh",    Napi::Function::New(env, ParseSkeletalMesh));
// ... etc.
```

---

### `packages/contracts/src/mesh.ts` (model, request-response)
### `packages/contracts/src/skeleton.ts` (model, request-response)
### `packages/contracts/src/animation.ts` (model, request-response)
### `packages/contracts/src/material.ts` (model, request-response)

**Analog:** `packages/contracts/src/iff.ts` — exact structural match

Contracts are types-only files. Each follows the same pattern: ground-truth citation comment, discriminated interfaces for structure metadata (typed JSON), with binary payloads explicitly documented as "crosses as ArrayBuffer, not included here."

**File header pattern** (`iff.ts` lines 1–12):
```typescript
/**
 * packages/contracts/src/mesh.ts — Mesh format contract types.
 *
 * The mesh parse result crosses the N-API boundary as:
 *   - Structure (group count, bone names, shader slot map) → typed JSON (these types)
 *   - Geometry buffers (positions/normals/uvs/indices/skinIndex/skinWeight) → ArrayBuffer
 * Binary NEVER crosses as JSON (AGENTS.md zero-copy rule).
 *
 * Ground truth: swg-client-v2 SkeletalMeshGeneratorTemplate.cpp (SKMG chunk set, verified)
 *   + MeshAppearanceTemplate.cpp (MESH/SPS/VTXA/INDX).
 * Cross-check: ../swg-blender-plugin/swg_scene/mesh_skeletal.py
 *
 * Source (pattern): packages/contracts/src/iff.ts
 */
```

**Interface pattern** (`iff.ts` lines 33–70) — document-source citations on every field:
```typescript
/** One PSDT shader group from a parsed .mgn/.msh mesh. */
export interface MeshShaderGroup {
  /** Shader name from PSDT NAME chunk (e.g. "shader/foo.sht"). */
  shaderName: string;
  /** Number of de-indexed vertices in this group. */
  vertexCount: number;
  /** Number of triangle indices in this group. */
  indexCount: number;
  /**
   * Byte offset of this group's geometry data within the geometry ArrayBuffer
   * returned by parseSkeletalMesh(). Layout: Float32[positions] + Float32[normals]
   * + Float32[uvs] + Uint16[indices] + Int32[skinIndices] + Float32[skinWeights].
   * Source: RESEARCH.md Pattern 2 (de-index) + Pattern 3 (vec4 skin normalize).
   */
  geometryOffset: number;
  geometryByteLength: number;
}

export interface MeshParseResult {
  /** Format tag on disk ('MESH' for static, 'SKMG' for skeletal). */
  formatTag: 'MESH' | 'SKMG';
  /** Shader groups (one Three.js BufferGeometry + material per group). */
  shaderGroups: MeshShaderGroup[];
  /**
   * XFNM bone name list (only present for SKMG / .mgn).
   * Maps skinIndex slot → bone name (for remap to Skeleton bone order).
   * Source: synthesis §1.3 delta #6 (name-keyed bone binding).
   */
  boneNames?: string[];
  /** IFF-level round-trip status (passed through from parseIff). */
  roundTrip: { passed: boolean; failOffset?: number };
  /** Vertices where skin influences were truncated to 4 (non-zero = warning). */
  weightsTruncated?: number;
}
```

**Discriminated status pattern** (`iff.ts` lines 97–103):
```typescript
export interface IffRoundTripStatus {
  passed: boolean;
  failOffset?: number;
}
// All new contracts re-export this or carry an equivalent inline roundTrip field.
```

**Index re-export** (`contracts/src/index.ts` lines 1–9) — add new exports:
```typescript
export * from './mesh.js';
export * from './skeleton.js';
export * from './animation.js';
export * from './material.js';
```

---

### `packages/harness/test/mesh-roundtrip.test.ts` (test, batch)
### *(covers all 9 format round-trip tests)*

**Analog:** `packages/harness/test/iff-roundtrip.test.ts` — exact match

**File header + import pattern** (`iff-roundtrip.test.ts` lines 1–34):
```typescript
/**
 * mesh-roundtrip.test.ts — Byte-exact round-trip tests for mesh/skeleton/animation/
 * shader/palette/dds/lod format parsers (CORE-05, SC-5).
 *
 * Each format: serialize(parse(fixtureBytes)) === fixtureBytes via serializeIff.
 * Real-asset fixtures live in gitignored packages/harness/fixtures-real/{format}/.
 *
 * Ground truth citations (per standing gate):
 *   .msh : swg-client-v2 MeshAppearanceTemplate.cpp + VertexBuffer.cpp:73-200
 *   .mgn : swg-client-v2 SkeletalMeshGeneratorTemplate.cpp (chunk set verified 2026-06-23)
 *   .skt : swg-client-v2 BasicSkeletonTemplate.cpp
 *   .sat : swg-client-v2 SkeletalAppearanceTemplate.cpp:786-1136
 *   .ans : swg-client-v2 CompressedKeyframeAnimation.cpp + CompressedQuaternion.cpp:82-100,370-419
 *   .sht : swg-client-v2 StaticShaderTemplate.cpp:32-36,123-128
 *   .pal : swg-client-v2 PaletteArgb.cpp:517-521
 *   .dds : swg-client-v2 Texture.cpp:115-129
 *   .lmg/.ldt : swg-client-v2 LodDistanceTable.cpp
 */

import { describe, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertRoundTrip } from '../assertRoundTrip.js';
import { registerFormat } from '../fixtureRegistry.js';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const nativeCore = require('../../native-core/index.js') as {
  parseSkeletalMesh: (bytes: ArrayBuffer | Uint8Array) => unknown;
  parseMesh:         (bytes: ArrayBuffer | Uint8Array) => unknown;
  parseSkeleton:     (bytes: ArrayBuffer | Uint8Array) => unknown;
  // ... etc.
  serializeIff:      (result: unknown, srcBytes: ArrayBuffer | Uint8Array) => ArrayBuffer;
  parseIff:          (bytes: ArrayBuffer | Uint8Array) => unknown;
};
```

**Round-trip via IFF layer pattern** (`iff-roundtrip.test.ts` lines 38–46 — the typed parse is validated by rendering, but the IFF-level round-trip is free via `serializeIff`):
```typescript
// parse/serialize pair for assertRoundTrip — use the IFF layer for the byte-exact gate:
function parseMgn(bytes: Uint8Array): { iffResult: unknown; srcBytes: Uint8Array } {
  // Call the typed parser (validated behaviorally); the IFF layer gives us round-trip for free.
  const iffResult = nativeCore.parseIff(bytes);
  return { iffResult, srcBytes: bytes };
}
function serializeMgn(parsed: unknown): Uint8Array {
  const { iffResult, srcBytes } = parsed as { iffResult: unknown; srcBytes: Uint8Array };
  const ab = nativeCore.serializeIff(iffResult, srcBytes);
  return new Uint8Array(ab);
}
```

**Test + fixture-registry pattern** (`iff-roundtrip.test.ts` lines 124–141):
```typescript
const FIXTURES_REAL = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures-real');

describe('mesh format round-trip (CORE-05 SC-5)', () => {
  it('.mgn (SKMG) byte-exact round-trip', () => {
    const bytes = new Uint8Array(
      readFileSync(join(FIXTURES_REAL, 'mesh', 'player_human_m_skel_l0.mgn'))
    );
    assertRoundTrip(parseMgn, serializeMgn, bytes);
  });
  // ... one it() per format/fixture
});

// CORE-05 registry registration (sweep gate enforcement)
registerFormat('mesh-skmg', {
  parse:     (b) => parseMgn(b as Uint8Array),
  serialize: (p) => serializeMgn(p),
  fixtures:  [{ name: 'real-player-human-mgn', bytes: /* loaded above */, loaderSource: 'swg-client-v2 SkeletalMeshGeneratorTemplate.cpp (chunk set verified 2026-06-23)' }],
  loaderSource: 'swg-client-v2 SkeletalMeshGeneratorTemplate.cpp',
});
```

**Zero-copy assertion pattern** (`tre-async-zerocopy.test.ts` lines 158–177) — mirror for geometry bridge:
```typescript
it('parseMesh geometry payload is an ArrayBuffer (binary stays binary)', () => {
  const bytes = new Uint8Array(readFileSync(FIXTURE_PATH));
  const result = nativeCore.parseMesh(bytes) as { geometry: ArrayBuffer };
  // Binary stays binary — must be ArrayBuffer, NOT a string or plain object
  expect(result.geometry).toBeInstanceOf(ArrayBuffer);
  // Crossing buffer is the FINAL flat attr array, not the raw POSN pool
  const view = new Float32Array(result.geometry);
  expect(view.length).toBeGreaterThan(0);
});
```

---

### `packages/renderer/src/panels/viewport/Viewport.tsx` (component, event-driven)

**Analog:** `packages/renderer/src/panels/ViewportPanel.tsx`

Phase 2 replaces the placeholder body with a real R3F `<Canvas>`. **The existing chrome (header, chips, stats, gizmo) is preserved and extended** — do not re-skin.

**Imports + state pattern** (`ViewportPanel.tsx` lines 14–29):
```typescript
import React, { useState, useEffect } from 'react';
import type { IDockviewPanelProps } from 'dockview';
// Phase 2 adds:
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Grid, Environment } from '@react-three/drei';
import { useViewportStore } from '../../state/viewportStore.ts';

type RenderMode = 'solid' | 'wire' | 'textured';
type CameraMode = 'orbit' | 'pan' | 'frame';
```

**Root container / radial gradient background** (`ViewportPanel.tsx` lines 43–66):
```typescript
<div style={{
  display: 'flex',
  flexDirection: 'column',
  height: '100%',
  position: 'relative',
  background: 'radial-gradient(ellipse at center, #2a2e26 0%, #141414 100%)',
  overflow: 'hidden',
}}>
  {/* 28×28 dot grid overlay — preserve verbatim */}
  <div style={{
    position: 'absolute', inset: 0,
    backgroundImage: 'radial-gradient(circle, rgba(255,255,255,0.04) 1px, transparent 1px)',
    backgroundSize: '28px 28px',
    WebkitMaskImage: 'radial-gradient(ellipse at center, black 0%, transparent 80%)',
    maskImage: 'radial-gradient(ellipse at center, black 0%, transparent 80%)',
    pointerEvents: 'none',
  }} />
```

**Chip style function** (`ViewportPanel.tsx` lines 287–299) — copy verbatim, it implements the active/inactive chip pattern used throughout Phase 2:
```typescript
function chipStyle(active: boolean): React.CSSProperties {
  return {
    background: active ? 'var(--color-accent)' : 'rgba(20,20,20,0.7)',
    border: `1px solid ${active ? 'var(--color-accent)' : 'var(--color-border-soft)'}`,
    color: active ? 'var(--color-accent-text)' : 'var(--color-text-muted)',
    borderRadius: 'var(--radius-sm)',
    padding: '3px 8px',
    cursor: 'pointer',
    fontSize: 'var(--text-sm)',
    backdropFilter: active ? undefined : 'blur(4px)',
    transition: 'background 0.12s ease, color 0.12s ease',
    lineHeight: 1,
  };
}
```

**Stats overlay pattern** (`ViewportPanel.tsx` lines 225–238) — extend from `persp · {dims} · — fps · SAB ✓` to include verts/tris/draws/zero-copy:
```typescript
<div style={{
  position: 'absolute', bottom: 8, left: 8,
  fontFamily: 'var(--font-mono)',
  fontSize: 'var(--text-xs)',
  color: 'var(--color-text-faint)',
  zIndex: 3, pointerEvents: 'none',
}}>
  {`persp · ${dims} · ${fps} fps · ${verts} v · ${tris} t · ${draws} dc · zero-copy ✓`}
</div>
```

**Gizmo** (`ViewportPanel.tsx` lines 240–268) — preserve the 48×48 SVG axes (Y green / X red / Z blue) verbatim.

**Empty state pattern** (`ViewportPanel.tsx` lines 196–221) — replace the "Phase 0" copy with the Phase-2 copy per the UI-SPEC Copywriting Contract:
```typescript
// Empty state:
<span style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-md)', fontWeight: 600 }}>
  Viewport
</span>
<span style={{ color: 'var(--color-text-faint)', fontSize: 'var(--text-sm)' }}>
  Open a mesh from the Assets panel
</span>
<span style={{ color: 'var(--color-text-faint)', fontSize: 'var(--text-xs)' }}>
  .sat / .apt to compose · .mgn / .msh to inspect
</span>
```

**Action button style** (`ViewportPanel.tsx` lines 271–285) — copy verbatim:
```typescript
const actionBtnStyle: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  color: 'var(--color-text-faint)',
  cursor: 'pointer',
  fontSize: 'var(--text-sm)',
  width: 22, height: 22,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  borderRadius: 'var(--radius-sm)',
  padding: 0,
  transition: 'background 0.12s ease, color 0.12s ease',
};
```

---

### `packages/renderer/src/panels/viewport/SkinnedMeshView.tsx` (component, event-driven)

**Analog:** `packages/renderer/src/panels/ViewportPanel.tsx` (partial — the chip/state-hook patterns apply; the R3F scene graph is net-new)

No existing Three.js/R3F code in the repo — this is the one "no analog" file for its core scene content. The React patterns (hooks, state, accessibility) follow `ViewportPanel.tsx`. The Three.js `SkinnedMesh`/`ShaderMaterial` patterns come from RESEARCH Pattern 4 (synthesis §2).

**useViewportStore hook pattern** (follows `treStore.ts`/`iffStore.ts` pattern):
```typescript
import { useViewportStore } from '../../state/viewportStore.ts';

// Inside component:
const { parsedMesh, parsedSkeleton, renderMode, customizationIndices } = useViewportStore();
```

**useFrame GC-safe pattern** (RESEARCH anti-pattern: no `new` in useFrame):
```typescript
// Module-scope scratch objects — reused every frame:
const _scratchQuat  = new THREE.Quaternion();
const _scratchVec3  = new THREE.Vector3();
const _scratchMat4  = new THREE.Matrix4();

// Inside the component's useFrame:
useFrame(() => {
  // Sample animation into reused scratch — no allocation
  THREE.Quaternion.slerpQuaternions(quatA, quatB, t, _scratchQuat);
  bone.quaternion.copy(_scratchQuat);
  // Mutate customization uniform in place — zero-alloc:
  material.uniforms.uTexFactor.value.set(r, g, b, a);
});
```

---

### `packages/renderer/src/panels/viewport/LodPicker.tsx` (component, request-response)
### `packages/renderer/src/panels/viewport/AppearancePanel.tsx` (component, request-response)
### `packages/renderer/src/panels/viewport/MaterialInspector.tsx` (component, request-response)

**Analog:** `packages/renderer/src/panels/iff/IffStructureTree.tsx` (read-only inspector-panel pattern)

All three are read-only inspector panels showing resolved data with status glyphs. They follow the same layout: section head, per-row data, `VerificationStatus` for glyph+color+mono-caption triple-encoding.

**Props interface pattern** (`IffStructureTree.tsx` lines 38–51):
```typescript
export interface LodPickerProps {
  /** Resolved LOD levels from the appearance resolver. */
  lodLevels: LodLevel[] | null;
  /** Currently selected LOD index. */
  selectedLod: number;
  /** Callback when user selects a level. */
  onSelectLod: (index: number) => void;
}
```

**Section container + head pattern** (`IffStructureTree.tsx` lines 55–70):
```typescript
function EmptyState(): React.ReactElement {
  return (
    <div style={{
      flex: 1, display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      gap: 'var(--space-2)', padding: 'var(--space-4)', textAlign: 'center',
    }}>
      <span style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-md)', fontWeight: 600 }}>
        {/* empty-state heading */}
      </span>
      <span style={{ color: 'var(--color-text-faint)', fontSize: 'var(--text-sm)' }}>
        {/* empty-state body */}
      </span>
    </div>
  );
}
```

**Status glyph via VerificationStatus** (`IffStructureTree.tsx` lines 30–36, `VerificationStatus.tsx`):
```typescript
import VerificationStatus from '../../shared/VerificationStatus.tsx';

// Resolved dependency:
<VerificationStatus variant="pass" caption="resolved ✓" />
// Missing dependency:
<VerificationStatus variant="warn" caption={`missing: ${name} — placeholder`} />
// Parse/round-trip fail:
<VerificationStatus variant="fail" caption={`parse error @ 0x${offset.toString(16)}`} />
```

**Selected-row pattern** — 2px accent left border + `--color-accent-dim` bg (LOD selection):
```typescript
const lodRowStyle = (selected: boolean): React.CSSProperties => ({
  display: 'flex',
  alignItems: 'center',
  padding: 'var(--space-2) var(--space-4)',
  gap: 'var(--space-2)',
  background: selected ? 'var(--color-accent-dim)' : 'transparent',
  borderLeft: selected ? '2px solid var(--color-accent)' : '2px solid transparent',
  cursor: 'pointer',
  transition: 'background 0.1s ease',
});
```

---

### `packages/renderer/src/panels/viewport/CustomizationPanel.tsx` (component, event-driven)

**Analog:** `packages/renderer/src/panels/tre/VfsSearchField.tsx` (controlled input + live update pattern)

The customization panel is interactive (swatch click → immediate state update → uniform mutation). The `VfsSearchField` debounced-input pattern shows the "controlled input → store action → downstream effect" wiring in this codebase.

**Live interaction pattern** (swatch click → store action → zero-alloc uniform mutation):
```typescript
// From viewportStore (action):
setCustomizationIndex: (variable: string, index: number) => void;

// In component:
const setCustomizationIndex = useViewportStore(s => s.setCustomizationIndex);

// Swatch click handler — no allocation:
const handleSwatchClick = useCallback((variable: string, index: number) => {
  setCustomizationIndex(variable, index);
  // The ShaderMaterial uniform mutation happens in SkinnedMeshView.tsx's useFrame
  // via the store subscription — zero-alloc per the GC contract (D-09).
}, [setCustomizationIndex]);
```

**Swatch tile — accessibility pattern** (`02-UI-SPEC.md` § Rule 5, swatch entry):
```typescript
<button
  style={{ width: 18, height: 18, background: paletteColor, borderRadius: 'var(--radius-sm)' }}
  aria-label={`Set ${variableName} to palette index ${i}`}
  title={`#${argbHex}`}
  onClick={() => handleSwatchClick(variableName, i)}
/>
```

---

### `packages/renderer/src/panels/viewport/AnimationTransport.tsx` (component, event-driven)

**Analog:** `packages/renderer/src/panels/ViewportPanel.tsx` (chip/glyph-button + accessibility pattern)

The transport bar uses the same chip-style buttons and glyph-only control accessibility rules as the existing viewport chrome.

**Transport button accessibility pattern** (`02-UI-SPEC.md` § Rule 5 + `ViewportPanel.tsx` lines 156–180):
```typescript
<button
  aria-label="Play animation"
  title="Play animation"
  onClick={handlePlayPause}
  style={chipStyle(isPlaying)}
>
  {isPlaying ? '⏸' : '▶'}
</button>
<button
  aria-label="Toggle loop"
  title="Toggle loop"
  onClick={handleLoopToggle}
  style={chipStyle(loopEnabled)}
>
  ↺
</button>
```

**Scrubber keyboard pattern** (`02-UI-SPEC.md` Keyboard table):
```typescript
<input
  type="range"
  min={0} max={totalFrames - 1} value={currentFrame}
  onChange={e => scrubToFrame(Number(e.target.value))}
  onKeyDown={e => {
    if (e.key === 'ArrowLeft')  scrubToFrame(Math.max(0, currentFrame - 1));
    if (e.key === 'ArrowRight') scrubToFrame(Math.min(totalFrames - 1, currentFrame + 1));
    if (e.key === 'Home')       scrubToFrame(0);
    if (e.key === 'End')        scrubToFrame(totalFrames - 1);
  }}
  style={{ /* --color-widget track, --color-accent fill */ }}
/>
<span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)' }}>
  {currentFrame}/{totalFrames} · {timeSeconds.toFixed(2)}s
</span>
```

---

### `packages/renderer/src/panels/viewport/ExportDialog.tsx` (component, request-response)

**Analog:** `packages/renderer/src/shared/AsyncProgress.tsx` (modal + progress + cancel pattern)

The export dialog is the only modal in Phase 2. `AsyncProgress` provides the flex-column + caption + progress affordance pattern for the "Exporting…" state.

**Progress + caption pattern** (`AsyncProgress.tsx` lines 28–134):
```typescript
// "Exporting {format}…" state reuses AsyncProgress:
<AsyncProgress caption={`Exporting ${selectedFormat}…`} />

// Export complete state follows VerificationStatus:
<VerificationStatus variant="pass" caption={`exported ${filename}`} />

// Export failure:
<VerificationStatus variant="fail" caption={`Export failed — ${reason}.`} />
```

**Dialog button style** (consistent with `actionBtnStyle` from `ViewportPanel.tsx`):
```typescript
// Primary action button (Export):
<button style={{
  background: 'var(--color-accent)',
  border: 'none',
  color: 'var(--color-accent-text)',
  borderRadius: 'var(--radius-sm)',
  padding: 'var(--space-2) var(--space-4)',
  cursor: 'pointer',
  fontSize: 'var(--text-sm)',
  fontFamily: 'var(--font-sans)',
}}>Export</button>
```

---

### `packages/renderer/src/panels/viewport/resolver/appearanceResolver.ts` (service, CRUD + event-driven)

**Analog:** `packages/renderer/src/state/treStore.ts` (TS service that calls native bindings + populates store)

The resolver is a TS async function that walks the SMAT→MLOD→SKMG dependency graph using the Phase-1 TRE VFS binding, collects resolved and missing items, and returns a resolution result that the viewport store consumes.

**nativeCore require pattern** (`TreVfsBrowser.tsx` lines 41–75) — copy for the resolver:
```typescript
// eslint-disable-next-line @typescript-eslint/no-require-imports
const nativeCore = require('@swg/native-core') as {
  resolveEntry: (handle: string, name: string) => { found: boolean; archiveIndex: number; entryIndex: number };
  readMountEntry: (handle: string, archiveIndex: number, entryIndex: number) => ArrayBuffer;
  parseIff: (bytes: ArrayBuffer | Uint8Array) => unknown;
  parseSkeletalAppearance: (bytes: ArrayBuffer | Uint8Array) => unknown;
  parseMeshLod: (bytes: ArrayBuffer | Uint8Array) => unknown;
  // ... other format parsers
};
```

**Partial resolution + missing list pattern** (D-04 ethos from RESEARCH Pitfall 6):
```typescript
export interface AppearanceResolutionResult {
  /** Successfully resolved meshes per LOD level (null = fell back to placeholder). */
  meshes: (ResolvedMesh | null)[];
  /** Successfully resolved skeleton (null = default skeleton placeholder). */
  skeleton: ResolvedSkeleton | null;
  /** Resolved shaders + textures per mesh. */
  materials: ResolvedMaterial[];
  /** Names of every dependency that could NOT be resolved. */
  missing: string[];
  /** Open mode taken (D-03). */
  mode: 'composed' | 'leaf';
}

// D-04: never throw on missing — collect and return:
async function resolveAppearance(
  mountHandle: string,
  entryPath: string,
): Promise<AppearanceResolutionResult> {
  const missing: string[] = [];
  // ... graph walk; on each nativeCore.resolveEntry({ found: false }):
  //   missing.push(depName);
  //   use placeholder values instead of throwing
  return { ..., missing };
}
```

---

### `packages/renderer/src/state/viewportStore.ts` (store, event-driven)

**Analog:** `packages/renderer/src/state/iffStore.ts` — exact structural match

The viewport store follows the same Zustand 5 shape as `iffStore.ts` and `treStore.ts`: typed state interface, discriminated status union, set-based action methods.

**Store file header pattern** (`iffStore.ts` lines 1–15):
```typescript
/**
 * packages/renderer/src/state/viewportStore.ts — Zustand store for 3D viewport state.
 *
 * Manages:
 *   - Loaded mesh + skeleton + animation (parsed results from native layer)
 *   - Appearance resolution result + missing-deps list
 *   - LOD selection, render mode, customization indices
 *   - Animation transport state (playing, currentFrame, speed, loop)
 *   - Viewport load status (idle / loading / done / error)
 *
 * Source: packages/renderer/src/state/iffStore.ts (Zustand 5 store pattern).
 */

import { create } from 'zustand';
import type { MeshParseResult, SkeletonParseResult, AnimationParseResult } from '@swg/contracts';
```

**Status discriminated union** (`iffStore.ts` lines 29–33):
```typescript
export type ViewportLoadStatus =
  | { kind: 'idle' }
  | { kind: 'loading'; filename: string }
  | { kind: 'done'; filename: string; mode: 'composed' | 'leaf' }
  | { kind: 'error'; filename: string; reason: string; offset?: number };
```

**Store creation pattern** (`iffStore.ts` lines 93–134):
```typescript
export const useViewportStore = create<ViewportStore>((set) => ({
  // initial state fields...
  loadStatus: { kind: 'idle' },
  parsedMesh:      null,
  parsedSkeleton:  null,
  parsedAnimation: null,
  resolution:      null,
  selectedLod:     0,
  renderMode:      'textured',
  customizationIndices: {},
  transportState:  { playing: false, currentFrame: 0, totalFrames: 0, speed: 1, loop: false },

  // Actions:
  beginLoad: (filename) => set({ loadStatus: { kind: 'loading', filename } }),
  loadComplete: (filename, mode, parsed) => set({ loadStatus: { kind: 'done', filename, mode }, ...parsed }),
  loadError: (filename, reason) => set({ loadStatus: { kind: 'error', filename, reason } }),
  setSelectedLod: (lod) => set({ selectedLod: lod }),
  setRenderMode: (mode) => set({ renderMode: mode }),
  setCustomizationIndex: (variable, index) =>
    set((state) => ({ customizationIndices: { ...state.customizationIndices, [variable]: index } })),
  setTransportState: (partial) =>
    set((state) => ({ transportState: { ...state.transportState, ...partial } })),
  reset: () => set({ /* initial values */ }),
}));
```

---

## Shared Patterns

### Error Handling — Format Parse Errors
**Source:** `packages/native-core/src/iff_binding.cpp` lines 163–173
**Apply to:** All N-API binding files (`mesh_binding.cpp`, `anim_binding.cpp`)

Two-tier catch: `FormatParseError` (expected, user-facing message) then `std::exception` (internal error). Both throw JS `Error`, never crash the renderer process:
```cpp
} catch (const swg_core::iff::IffParseError& e) {
    Napi::Error::New(env, std::string("IFF parse error: ") + e.what())
        .ThrowAsJavaScriptException();
    return env.Undefined();
} catch (const swg_core::formats::FormatParseError& e) {
    Napi::Error::New(env, std::string("Format parse error: ") + e.what())
        .ThrowAsJavaScriptException();
    return env.Undefined();
} catch (const std::exception& e) {
    Napi::Error::New(env, std::string("Internal error: ") + e.what())
        .ThrowAsJavaScriptException();
    return env.Undefined();
}
```

### Accessibility — Glyph + Color + Caption (Rule 1 + Rule 5)
**Source:** `packages/renderer/src/shared/VerificationStatus.tsx`
**Apply to:** All status indicators in `AppearancePanel.tsx`, `MaterialInspector.tsx`, `AnimationTransport.tsx`, `ExportDialog.tsx`

State is triple-encoded: glyph (visual shape) + semantic color token + mono caption text. Never color alone. Every icon-only button has `aria-label` + `title`:
```typescript
// From VerificationStatus.tsx — copy the VARIANT_CONFIG pattern:
const VARIANT_CONFIG = {
  'pass':  { glyph: '✓', colorVar: 'var(--color-accent)' },
  'warn':  { glyph: '⚠', colorVar: 'var(--color-warn)' },
  'fail':  { glyph: '✕', colorVar: 'var(--color-danger)' },
};
// Use <VerificationStatus> directly, or copy the inline pattern.
```

### Monospace Typography for Technical Readouts
**Source:** `packages/renderer/src/shared/AsyncProgress.tsx` lines 54–60 + `ViewportPanel.tsx` lines 226–232
**Apply to:** Stats overlay, frame counter, LOD distances, palette indices, format tags, DDS dimensions, RGBA values

All numeric/technical text uses `fontFamily: 'var(--font-mono)'` + `fontSize: 'var(--text-xs)'`:
```typescript
<span style={{
  fontFamily: 'var(--font-mono)',
  fontSize: 'var(--text-xs)',
  color: 'var(--color-text-faint)',
}}>
  {value}
</span>
```

### Zustand Store Action Pattern
**Source:** `packages/renderer/src/state/iffStore.ts` lines 93–134
**Apply to:** `viewportStore.ts`

All actions use `set((state) => ...)` for state-dependent updates and `set({ ... })` for simple overwrites. No `get()` unless cross-slice access is genuinely needed:
```typescript
setCustomizationIndex: (variable, index) =>
  set((state) => ({
    customizationIndices: { ...state.customizationIndices, [variable]: index },
  })),
```

### CORE-05 Fixture Registry Citation
**Source:** `packages/harness/fixtureRegistry.ts` lines 78–90
**Apply to:** All `registerFormat()` calls in the new harness test files

The `loaderSource` field MUST match `/swg-client-v2|Utinni|tre_reader\.py/` or the sweep fails CI:
```typescript
registerFormat('mesh-skmg', {
  parse:       parseMgn,
  serialize:   serializeMgn,
  fixtures: [{
    name: 'real-player-human-mgn',
    bytes: realAssetBytes,
    loaderSource: 'swg-client-v2 SkeletalMeshGeneratorTemplate.cpp (chunk set verified 2026-06-23)',
  }],
  loaderSource: 'swg-client-v2 SkeletalMeshGeneratorTemplate.cpp',
});
```

### Zero-Copy ArrayBuffer Return from N-API
**Source:** `packages/native-core/src/iff_binding.cpp` lines 285–289
**Apply to:** All N-API functions that return binary geometry/keyframe/texture data

Binary payloads (geometry attr arrays, DXT blocks, keyframe buffers) cross as `Napi::ArrayBuffer`, not JSON:
```cpp
auto ab = Napi::ArrayBuffer::New(env, out.size());
if (!out.empty()) std::memcpy(ab.Data(), out.data(), out.size());
return ab;
```

### Token-Based Styling (no arbitrary px except structural exceptions)
**Source:** `packages/renderer/src/panels/ViewportPanel.tsx` throughout + `02-UI-SPEC.md` Spacing Scale
**Apply to:** All new renderer components

Use CSS custom property tokens exclusively. The only documented exceptions are the inherited overlay offsets (8px chip insets, 4px chip gap) and the R3F canvas internals (scene-space, not layout-space):
```typescript
// Token-based (correct):
padding: 'var(--space-2) var(--space-4)',
fontSize: 'var(--text-sm)',
borderRadius: 'var(--radius-sm)',
// Inherited structural exception (acceptable):
top: 'calc(var(--tabstrip-h) + 8px)',  // viewport overlay chip position
left: 8,
gap: 4,
```

---

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `SkinnedMeshView.tsx` (R3F scene graph internals) | component | event-driven | No Three.js/R3F code exists in the repo yet. The React shell patterns come from `ViewportPanel.tsx`; the Three.js `SkinnedMesh`/`ShaderMaterial`/`Skeleton` scene graph is entirely net-new. Use RESEARCH Pattern 4 (synthesis §2) for the `ShaderMaterial` + `<skinning_pars_vertex>` wiring. |

---

## Metadata

**Analog search scope:** `packages/native-core/`, `packages/contracts/`, `packages/harness/`, `packages/renderer/src/`
**Files scanned:** 29 source files read
**Pattern extraction date:** 2026-06-23

**Key pattern chains (planner use):**

1. Every new C++ format parser: `Iff.h` namespace/error/API shape → `iff_binding.cpp` thin binding → `contracts/src/iff.ts` types-only contract → `harness/test/iff-roundtrip.test.ts` test + `fixtureRegistry.ts` registration.
2. Every new renderer component: `ViewportPanel.tsx` chip/overlay/token patterns → `iffStore.ts`/`treStore.ts` Zustand store → `VerificationStatus.tsx` for status glyphs → `AsyncProgress.tsx` for loading states.
3. The de-index + vec4-normalize passes in `geometry/DeIndex.{h,cpp}` are called inside the format parsers BEFORE the binding returns — they have no N-API surface of their own.
4. `addon.cpp` is the single registration file — new bindings forward-declare and register there; never create a new MODULE entry.
