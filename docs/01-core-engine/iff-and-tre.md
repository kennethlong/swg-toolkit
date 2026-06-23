# IFF Chunk Format, Binary Helpers & TRE Archives

> Covers: IFF chunk format, binary read/write helpers, TRE archives & TREE0005, client .cfg loader. Source: research doc lines 137–205, 1037–1125, 1914–1971, 2776–3024, 14035–14291.

> **Provenance status (updated Plan 01-04):** §§7–8 (TRE archive format and packing engine) are now VERIFIED
> ground truth — proven byte-exact against real archives and `swg-client-v2` source.
> §2 (IFF chunk format) is corrected per Plan 01-03 (big-endian tags/sizes confirmed).
> §§1, 3–6, 9–13 contain AI-proposed code examples; treat as design sketches, not authoritative format specs.
> See [source provenance](../00-overview/source-provenance.md) for the full verification status.

---

## Table of Contents

1. [Runtime vs Offline Asset Pipeline](#1-runtime-vs-offline-asset-pipeline)
2. [IFF Chunk Format Overview](#2-iff-chunk-format-overview)
3. [Binary Reader Helpers (C++)](#3-binary-reader-helpers-c)
4. [Chunk-Walk Parser Example](#4-chunk-walk-parser-example)
5. [IFF Binary Writer (C++)](#5-iff-binary-writer-c)
6. [Inside-Out Serialization Strategy](#6-inside-out-serialization-strategy)
7. [TRE Archive Format](#7-tre-archive-format)
8. [TRE Packing Engine (C++)](#8-tre-packing-engine-c)
9. [N-API Bridge: Exposing Pack to TypeScript](#9-n-api-bridge-exposing-pack-to-typescript)
10. [React Dispatcher & Mod Publisher UI](#10-react-dispatcher--mod-publisher-ui)
11. [Client Config Loader (swg.cfg / live.cfg)](#11-client-config-loader-swgcfg--livecfg)
12. [TRE Consolidation: TREE0005 Multi-Layer Packing](#12-tre-consolidation-tree0005-multi-layer-packing)
13. [DDS Texture Handling](#13-dds-texture-handling)

---

## 1. Runtime vs Offline Asset Pipeline

Two pathways exist for getting SWG assets into a format Three.js can render.

**Runtime Pipeline (built into the toolset):** The C++/N-API backend decompresses TRE archives, parses IFF chunks, and hands raw float/index buffers to TypeScript via `Napi::ArrayBuffer` or `SharedArrayBuffer`. Three.js consumes these directly as `BufferGeometry` without serializing through JSON (which would stall the V8 main thread on large files).

**Offline Conversion Pipeline (for reference/testing):** Use community tools — TRE Explorer, the [SWG Model Exporter](https://modthegalaxy.com/index.php?threads/swg-model-exporter-release.1620/), or the Blender plugin [io_scene_swg_msh](https://github.com/nostyleguy/io_scene_swg_msh) — to extract `.msh`/`.mgn`/`.skt`/`.apt` files and export them as `.gltf`/`.glb`. glTF is the preferred Three.js format: it preserves textures, materials, hierarchies, and skeletal bone bindings with near-zero configuration on the web side.

In practice, SWG-Toolkit uses a **hybrid approach**: the runtime pipeline for live asset browsing and staging; the offline pipeline for final modder exports.

### Three.js Consumer (runtime path)

```typescript
import * as THREE from 'three';

// Data received from the N-API bridge
const { vertexBuffer, indexBuffer } = await window.api.loadSwgMesh("human_m.msh");

const geometry = new THREE.BufferGeometry();

// Cast raw buffers directly to WebGL-friendly typed arrays
const positions = new Float32Array(vertexBuffer);
const indices = new Uint16Array(indexBuffer);

geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
geometry.setIndex(new THREE.BufferAttribute(indices, 1));

// Compute lighting normals
geometry.computeVertexNormals();

const material = new THREE.MeshStandardMaterial({ color: 0xaaaaaa });
const mesh = new THREE.Mesh(geometry, material);
scene.add(mesh);
```

---

## 2. IFF Chunk Format Overview

SWG uses EA's legacy **Interchange File Format (IFF)** as the structural container for virtually every game file: `.msh`, `.apt`, `.pob`, `.trn`, terrain layers, and more.

Key structural rules:

- Every block begins with a **4-character tag** (e.g., `FORM`, `DATA`, `VERT`, `BPOLY`, `MSH `, `INDX`).
- The tag is followed by a **32-bit size field** representing the byte count of the block's payload (not including the tag+size header itself).
- `FORM` blocks are **container nodes** — they hold nested chunks and begin with a 4-character sub-type tag immediately after the size (so a FORM header is 12 bytes: 4 tag + 4 size + 4 sub-type).
- Leaf blocks (`DATA`, `VERT`, etc.) contain raw binary payload.
- **Tags and size fields are BIG-ENDIAN** — SWG uses the classic IFF convention (network byte order) for both
  the 4-byte tag and the 4-byte size. The earlier statement that SWG uses little-endian for sizes was incorrect.
  Source: `swg-client-v2 Iff.cpp:508-555` (parse: `((uint8_t*)&len)[0]` is the most-significant byte).

> **VERIFIED:** The IFF tags/sizes are big-endian per `swg-client-v2/src/engine/client/library/clientObject/src/shared/graphics/Iff.cpp`
> and confirmed by byte-exact round-trip tests in `packages/harness/test/iff-roundtrip.test.ts` (Plan 01-03).
> Corrected from AI-proposed "little-endian" claim.

Chunk layout for a leaf block:

```
[ 4 bytes: tag  ] e.g. "DATA"   (ASCII, BIG-ENDIAN read as uint32)
[ 4 bytes: size ] payload byte count (BIG-ENDIAN uint32)
[ N bytes: data ] raw binary payload
```

FORM container layout:

```
[ 4 bytes: "FORM" ]
[ 4 bytes: total size of everything that follows, including the sub-type tag ]
[ 4 bytes: sub-type, e.g. "BPOLY" ]
[ N bytes: nested child chunks ]
```

---

## 3. Binary Reader Helpers (C++)

These three primitives are the lowest-level building blocks referenced by every other format parser in the toolkit. They advance a shared `offset` cursor into the raw byte buffer.

```cpp
#include <cstring>
#include <string>
#include <cstdint>

class SwgTerrainParser {
public:
    // Read a 4-character text tag from the buffer at the current offset.
    static std::string ReadTag(const uint8_t* buffer, size_t& offset) {
        std::string tag(reinterpret_cast<const char*>(buffer + offset), 4);
        offset += 4;
        return tag;
    }

    // Read a 32-bit unsigned integer (little-endian on a little-endian host).
    static uint32_t ReadUint32(const uint8_t* buffer, size_t& offset) {
        uint32_t value;
        std::memcpy(&value, buffer + offset, 4);
        offset += 4;
        return value;
    }

    // Read a 32-bit IEEE 754 float.
    static float ReadFloat(const uint8_t* buffer, size_t& offset) {
        float value;
        std::memcpy(&value, buffer + offset, 4);
        offset += 4;
        return value;
    }
};
```

---

## 4. Chunk-Walk Parser Example

The example below parses a `BPOLY` (Boundary Polygon) FORM chunk from a terrain file. It demonstrates the general pattern for walking any nested IFF structure: read the FORM header, then loop over child chunks until the end offset is reached.

Supporting data structures:

```cpp
#include <vector>
#include <string>
#include <cstdint>

// Single 2D vertex (SWG terrain uses X/Z as the horizontal plane)
struct Vector2D {
    float x;
    float z;
};

// Parsed BPOLY boundary polygon
struct SwgPolygonBoundary {
    uint32_t id;
    std::string name;
    float featherDistance;  // Soft-blend width at the boundary edge
    bool isInverted;        // true = rule applies outside the boundary
    std::vector<Vector2D> vertices;
};
```

Parser method (member of `SwgTerrainParser`):

```cpp
// Parses a single BPOLY FORM container from the byte stream.
static SwgPolygonBoundary ParsePolygonBoundary(const uint8_t* buffer, size_t& offset) {
    SwgPolygonBoundary poly;

    // 1. Read the FORM header
    std::string formType = ReadTag(buffer, offset);  // "FORM"
    uint32_t formSize    = ReadUint32(buffer, offset);
    std::string subType  = ReadTag(buffer, offset);  // "BPOLY"

    // 2. Walk child chunks until the end of this FORM
    size_t endOffset = offset + formSize - 4;  // -4: sub-type tag is included in formSize
    while (offset < endOffset) {
        std::string chunkId    = ReadTag(buffer, offset);
        uint32_t    chunkSize  = ReadUint32(buffer, offset);
        size_t      nextChunk  = offset + chunkSize;

        if (chunkId == "DATA") {
            poly.id              = ReadUint32(buffer, offset);
            poly.featherDistance = ReadFloat(buffer, offset);
            // 0 = normal boundary, 1 = inverted (rule applies outside)
            poly.isInverted      = (ReadUint32(buffer, offset) == 1);
        }
        else if (chunkId == "VERT") {
            // uint32 count followed by count * (float x, float z) pairs
            uint32_t vertexCount = ReadUint32(buffer, offset);
            poly.vertices.reserve(vertexCount);
            for (uint32_t i = 0; i < vertexCount; ++i) {
                float x = ReadFloat(buffer, offset);
                float z = ReadFloat(buffer, offset);
                poly.vertices.push_back({x, z});
            }
        }

        // Advance past any unread bytes in this chunk (handles unknown/future chunks)
        offset = nextChunk;
    }

    return poly;
}
```

---

## 5. IFF Binary Writer (C++)

`IffBinaryWriter` is the canonical write-side counterpart to the reader helpers above. It accumulates bytes into an internal `std::vector<uint8_t>` buffer and exposes helpers for every primitive type SWG IFF files require.

```cpp
#include <napi.h>
#include <vector>
#include <string>
#include <cstring>

class IffBinaryWriter {
public:
    std::vector<uint8_t> buffer;

    // Write exactly 4 bytes for a chunk tag; pads with spaces if shorter.
    void WriteTag(const std::string& tag) {
        char padded[4] = {' ', ' ', ' ', ' '};
        std::memcpy(padded, tag.c_str(), std::min(size_t(4), tag.length()));
        buffer.insert(buffer.end(), padded, padded + 4);
    }

    // Write a 32-bit unsigned integer (little-endian on a little-endian host).
    // SWG's modified IFF variant uses little-endian size headers.
    void WriteUint32(uint32_t value) {
        uint8_t bytes[4];
        std::memcpy(bytes, &value, 4);
        buffer.insert(buffer.end(), bytes, bytes + 4);
    }

    // Write a 32-bit IEEE 754 float.
    void WriteFloat(float value) {
        uint8_t bytes[4];
        std::memcpy(bytes, &value, 4);
        buffer.insert(buffer.end(), bytes, bytes + 4);
    }

    // Write a null-terminated string (SWG IFF string convention).
    void WriteString(const std::string& str) {
        buffer.insert(buffer.end(), str.begin(), str.end());
        buffer.push_back(0);  // null terminator
    }

    // Append a pre-compiled sub-buffer directly into the stream.
    void WriteRawBuffer(const std::vector<uint8_t>& subBuffer) {
        buffer.insert(buffer.end(), subBuffer.begin(), subBuffer.end());
    }

    // Encapsulate data into a standard SWG chunk: tag + uint32 size + payload.
    void PackChunk(const std::string& tag, const std::vector<uint8_t>& data) {
        WriteTag(tag);
        WriteUint32(static_cast<uint32_t>(data.size()));
        buffer.insert(buffer.end(), data.begin(), data.end());
    }
};
```

---

## 6. Inside-Out Serialization Strategy

When **reading** an IFF file the parser works top-down: encounter a FORM header, read its declared size, recurse into children. When **writing** an IFF file the process must be inverted, because every FORM/chunk header requires an exact `chunkSize` that can only be known after all nested content has been serialized.

The build order is therefore always **inside-out**:

```
[ TS Layer Tree Updates ]
        |
        v
  Serialize innermost chunks first (e.g., FRAC leaf chunks)
        |
        v
  Calculate child buffer sizes
        |
        v
  Prepend parent FORM headers with correct sizes (e.g., LAYR containers)
        |
        v
  Prepend outermost FORM header (e.g., master FORM TRN)
        |
        v
  [ Final deployable .trn file ]
```

In practice this means: serialize each child chunk into a temporary `IffBinaryWriter`, record its `buffer.size()`, then call `PackChunk` on the parent writer with that size. Walk back up the tree until the root FORM is emitted.

---

## 7. TRE Archive Format

A `.tre` (Tree Archive) file is SWG's proprietary packed container. Unlike `.zip`, it is optimized for rapid block-indexed streaming. The game client mounts `.tre` files in a declared priority order: files in a higher-ranked archive (e.g., a custom patch `.tre`) silently override identical paths in lower-ranked archives.

> **VERIFIED — byte-exact ground truth (not AI-proposed).** The layout below was
> proven byte-exact against real archives (`bottom.tre` ver "5000", 808 records,
> stride 24; `SwgRestoration_00.tre` ver "6000", 334 records, stride 32) and against
> the client's own on-disk struct. Sources: `swg-client-v2 .../sharedFile/src/shared/TreeFile_SearchNode.h:189`
> (`TableOfContentsEntry`) and `.../sharedFile/src/shared/Crc.cpp` (`Crc::calculate`).
> The provenance caveat at the top of this document does **not** apply to this section.

### TRE Binary Layout

The on-disk magic is the 4 bytes `45 45 52 54` = `"EERT"` (the little-endian dump of
the tag `'TREE'`), **not** `"TREE"` forward. The version field is 4 ASCII bytes read
forward: `"0004"`, `"0005"`, `"0006"`, `"5000"`, or `"6000"`. The header is **36 bytes**:

```
+-------------------------------------------------------------+
| HEADER (36 bytes, all uint32 LE)                            |
|   [0]  token              "EERT"  (LE dump of 'TREE')       |
|   [4]  version            "0004"/"0005"/"0006"/"5000"/"6000"|
|   [8]  numberOfFiles                                        |
|   [12] tocOffset                                            |
|   [16] tocCompressor      (0 = none, else zlib code)        |
|   [20] sizeOfTOC          (on-disk, possibly compressed)    |
|   [24] blockCompressor    (name block compressor)           |
|   [28] sizeOfNameBlock    (on-disk)                         |
|   [32] uncompSizeOfNameBlock                                |
+-------------------------------------------------------------+
| TOC BLOCK (at tocOffset, may be zlib-compressed)            |
|   numberOfFiles × CRC-FIRST records (24 or 32 bytes each)   |
|   sorted ascending by crc (binary-search precondition)      |
+-------------------------------------------------------------+
| NAME BLOCK (at tocOffset + sizeOfTOC, may be compressed)    |
|   Flat, null-terminated, lowercased, '/'-normalized paths   |
+-------------------------------------------------------------+
| DATA BLOCK                                                  |
|   Raw or zlib-compressed file payloads (at per-entry offset)|
+-------------------------------------------------------------+
```

### TableOfContentsEntry (CRC-FIRST, 24 bytes per file — ALL versions)

The TOC record is **CRC-FIRST for every version** (the "size-first" layout in older
docs/Utinni is **falsified** — it matches no real archive). V6000 appends 8 bytes of
padding for a 32-byte stride; all other versions use 24 bytes.

```cpp
// swg-client-v2 TreeFile_SearchNode.h:189
struct TableOfContentsEntry {
    uint32_t crc;               // [0]  forward CRC-32 of the lowercased, '/'-normalized name
    int32_t  length;            // [4]  uncompressed size; 0 = tombstone (deleted)
    int32_t  offset;            // [8]  absolute byte offset of the payload in the .tre
    int32_t  compressor;        // [12] 0 = uncompressed, else zlib code
    int32_t  compressedLength;  // [16] on-disk payload size
    int32_t  fileNameOffset;    // [20] byte offset within the Name Block
    // V6000 only: + 8 bytes padding → stride 32
};
```

### Filename CRC — forward (MSB-first) CRC-32

Lookups binary-search the CRC-sorted TOC, then tie-break by case-insensitive name
compare. The CRC is the **forward / MSB-first** CRC-32 (polynomial `0x04C11DB7`,
init `0xFFFFFFFF`, final XOR `0xFFFFFFFF`) over the **lowercased, forward-slash-normalized**
name — **not** the reflected/Ethernet CRC (`0xEDB88320`).

```cpp
// swg-client-v2 Crc.cpp — Crc::calculate. Table: c = i<<24; ×8: c = (c&0x80000000)?((c<<1)^0x04C11DB7):(c<<1).
uint32_t crc = 0xFFFFFFFF;
for (const char* s = name; *s; ++s)
    crc = table[((crc >> 24) ^ (uint8_t)*s) & 0xFF] ^ (crc << 8);
return crc ^ 0xFFFFFFFF;
// VERIFIED: Crc::calculate("appearance/mesh/thm_tato_imprv_building_s09_r0_mesh_l4.msh") == 3830594
//           == crc@offset0 of bottom.tre entry 0.
```

Virtual file descriptor passed from TypeScript to the packer:

```cpp
struct VirtualFileToPack {
    std::string internalPath;        // e.g. "terrain/tatooine.trn"
    std::vector<uint8_t> rawBuffer;  // Decompressed file bytes
};
```

---

## 8. TRE Packing Engine (C++)

> **VERIFIED — ground truth from Plan 01-04 (D-04 builder).** This section replaces the
> earlier AI-proposed `SwgTrePacker` which had multiple format errors. The implementation
> below matches the LOCKED ground truth from `swg-client-v2 TreeFileBuilder.cpp:773-833`
> and `ZlibCompressor.cpp:169`. Key corrections from the prior AI-proposed doc:
>
> 1. **Block write order** (the prior doc had: header → TOC → names → data all in one pass).
>    The real builder uses: header stub → file payloads → TOC → name block → **MD5 block** → header rewrite (double-write).
> 2. **TOC field order**: CRC-FIRST (crc, length, offset, compressor, compressedLength, fileNameOffset — 24 bytes,
>    not 20). The prior doc had a 5-field 20-byte layout — FALSIFIED.
> 3. **Header size**: 36 bytes (9 × uint32), not 12 bytes. The prior doc wrote "TREE"/"0005"/count only (12 bytes) — FALSIFIED.
> 4. **Compression gate**: only when `input > 1024 bytes` AND strictly smaller result. Prior doc used `compress()` unconditionally.
> 5. **MD5 block**: `numberOfFiles × 16 bytes`, always uncompressed, written after the name block. Prior doc omitted it entirely.
> 6. **Double header write**: the real builder writes a stub header first (tocOffset=0, sizes=0), writes all blocks, then seeks back and rewrites the header with real offsets.
>
> **IMPLEMENTED in** `packages/native-core/modules/core/tre/TreBuilder.{h,cpp}` (Plan 01-04, D-04).

### TRE Builder — VERIFIED Block Write Order

Source: `swg-client-v2 TreeFileBuilder.cpp:773-833` (write() method).

```
BLOCK WRITE ORDER (LOCKED):
  (1)  36-byte header stub    [all fields 0 except magic/version/numberOfFiles]
  (2)  File payloads          [in response-file/entry order]
       → For each: try zlib compression (code 2, level 6, only if >1024B and strictly smaller)
       → Store code 0 (raw) if compression not beneficial
  (3)  TOC block              [numberOfFiles × 24 bytes (v0004/0005/0006/5000) or 32 bytes (v6000)]
       → CRC-FIRST records: crc | length | offset | compressor | compressedLength | fileNameOffset
       → Sorted ASCENDING by crc (binary-search precondition; tie-break by name)
       → The entire TOC block may itself be zlib-compressed (stores compressed or raw)
  (4)  Name block             [null-terminated paths in TOC sort order, may be compressed]
  (5)  MD5 block              [numberOfFiles × 16 bytes; ALWAYS UNCOMPRESSED]
  (6)  Seek to offset 0       → Rewrite the 36-byte header with real tocOffset/sizes/compressors
```

### Compression policy (LOCKED — ZlibCompressor.cpp:169)

```
zlib RFC1950 framing (compressor code 2) ONLY:
  deflateInit(&z, Z_DEFAULT_COMPRESSION)  ← level 6, wbits 15, memLevel 8
  Only compress when: input.size() > 1024 AND compressed < input (strict)
  compressedLength field is 0 in the TOC when compressor==0 (uncompressed)

FORBIDDEN on write path: miniz / mz_deflate / tdefl
  miniz cannot reproduce zlib's RFC1950 bitstream.
  Read path may use miniz for decompression; write path NEVER does.
```

### MD5 Block (LOCKED — TreeFileBuilder.cpp:658-672)

```
After the name block:
  numberOfFiles × 16 bytes (one Md5::Value per entry, in TOC sort order)
  ALWAYS written uncompressed (disableCompression=true)
  The reader (TreeFile_SearchNode) ignores the MD5 block entirely.
  The builder must include it to produce a self-deterministic archive.
```

### Repack raw-slice identity contract (Utinni TreWriter.cs:166-174)

```
For a REPACK operation (modifying an existing archive):
  Untouched entries → copy raw compressed slice VERBATIM from source (NO recompression)
  Edited entries    → recompress from new payload (zlib level 6 only)

Rationale: zlib deflate is NOT bit-stable across builds (same input → different compressed bytes).
Recompressing untouched entries would break byte identity with the retail archive's compressed slices.
TreBuilder::repack() enforces this contract.
```

### Self-determinism guarantee

```
Building the same entry set TWICE with TreBuilder::build() produces BYTE-IDENTICAL output.
This is a regression guard ("build-twice-identical"), NOT a claim of matching retail archives.
Requires: consistent entry order + CRC-sorted TOC + pinned zlib level/wbits + deterministic MD5 block.
```

---

## 9. N-API Bridge: Exposing Pack to TypeScript

This wrapper receives an array of JS file objects from TypeScript, converts their `ArrayBuffer` payloads into native vectors, runs the packing engine, and returns the result as a zero-copy `Napi::ArrayBuffer`.

```cpp
Napi::Value BuildTrePatchArchive(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    Napi::Array incomingFiles = info[0].As<Napi::Array>();
    std::vector<VirtualFileToPack> packagingPool;

    for (uint32_t i = 0; i < incomingFiles.Length(); ++i) {
        Napi::Object jsFile = incomingFiles.Get(i).As<Napi::Object>();

        VirtualFileToPack nativeFile;
        nativeFile.internalPath = jsFile.Get("internalPath").As<Napi::String>().Utf8Value();

        Napi::ArrayBuffer bufferRef = jsFile.Get("buffer").As<Napi::ArrayBuffer>();
        uint8_t* startPointer = static_cast<uint8_t*>(bufferRef.Data());
        nativeFile.rawBuffer.assign(startPointer, startPointer + bufferRef.ByteLength());

        packagingPool.push_back(nativeFile);
    }

    std::vector<uint8_t> finishedTreBytes = SwgTrePacker::PackageAssetsToTre(packagingPool);

    Napi::ArrayBuffer outputBuffer = Napi::ArrayBuffer::New(env, finishedTreBytes.size());
    std::memcpy(outputBuffer.Data(), finishedTreBytes.data(), finishedTreBytes.size());
    return outputBuffer;
}
```

---

## 10. React Dispatcher & Mod Publisher UI

The `SwgModPublisherButton` component ties the full pipeline together into a single "Publish Mod" action: it compiles active terrain/flora state through the C++ builders, passes the results to the TRE packer, and writes the finished archive to the SWG client directory.

```tsx
import React from 'react';

interface PackagerProps {
  nativeBridge: any;
  currentTerrainJsonState: any;
  currentFloraJsonState: any;
}

export const SwgModPublisherButton: React.FC<PackagerProps> = ({
  nativeBridge,
  currentTerrainJsonState,
  currentFloraJsonState
}) => {

  const handleCompileAndPublishMod = async () => {
    try {
      // 1. Compile state into binary IFF streams via the terrain/flora builders
      const compiledTrnBytes: ArrayBuffer =
        nativeBridge.compileTerrainToTrnStream(currentTerrainJsonState);
      const compiledFldBytes: ArrayBuffer =
        nativeBridge.compileFloraToFldStream(currentFloraJsonState);

      // 2. Assemble file entries matching client loader path conventions
      const filesToBundle = [
        { internalPath: 'terrain/tatooine.trn', buffer: compiledTrnBytes },
        { internalPath: 'terrain/tatooine.fld', buffer: compiledFldBytes }
      ];

      // 3. Run the native TRE compilation pipeline
      const finishedTreArchiveBuffer: ArrayBuffer =
        nativeBridge.buildTrePatchArchive(filesToBundle);

      // 4. Write the archive to the SWG client directory
      const finalView = new Uint8Array(finishedTreArchiveBuffer);
      await window.api.saveFileToDisk('C:/SWG_Client/patch_custom_planet.tre', finalView);

      alert('Mod Packaged Successfully! patch_custom_planet.tre is ready for deployment.');
    } catch (err: any) {
      console.error('TRE Generation Failure:', err);
      alert(`Packaging halted: ${err.message}`);
    }
  };

  return (
    <button
      onClick={handleCompileAndPublishMod}
      style={{
        background: '#ff0055',
        color: '#ffffff',
        fontWeight: 'bold',
        padding: '12px 20px',
        border: 'none',
        borderRadius: '4px',
        boxShadow: '0 4px 6px rgba(0,0,0,0.3)',
        cursor: 'pointer'
      }}
    >
      Package &amp; Deploy Live Client Patch
    </button>
  );
};
```

---

## 11. Client Config Loader (swg.cfg / live.cfg)

For the SWG client executable to discover and load a custom patch archive, its filename must be registered in the `[ResourceSystem]` section of `swg.cfg` or `live.cfg`. The client reads these entries in order; files listed earlier take priority over files listed later.

```ini
[ResourceSystem]
# Custom patch archive — must appear before the standard retail trees
searchTree=patch_custom_planet.tre
searchTree=patch_14_00.tre
searchTree=patch_13_00.tre
searchTree=bottom.tre
```

**Important:** SWG config files resemble `.ini` but allow **duplicate keys** (`searchTree=` appears many times in a specific priority sequence). A naive key-value parser will collapse these duplicates. The config manager must treat each `searchTree=` line as an independent ordered entry.

SWG-Toolkit can manage this automatically: after writing the `.tre` file, the config manager scans `swg.cfg` or `live.cfg`, creates a timestamped backup, inserts the new `searchTree=` line at the top of the `[ResourceSystem]` block, and rewrites the file, preserving all existing duplicate entries.

The `SwgCfgManager` class reads the config line-by-line to preserve structure (including duplicate `searchTree=` keys), inserts the patch entry at the correct priority position, and rewrites the file atomically:

```typescript
import * as fs from 'fs/promises';
import * as path from 'path';

export class SwgCfgManager {
  /**
   * Reads and parses an SWG .cfg file into an ordered array tree structure
   */
  public async parseConfigFile(targetPath: string): Promise<SwgCfgManifest> {
    const rawContent = await fs.readFile(targetPath, 'utf-8');
    const lines = rawContent.split(/\r?\n/);

    const parsedLines: CfgLine[] = lines.map((line) => {
      const trimmed = line.trim();

      if (trimmed.length === 0) {
        return { type: 'blank', raw: line };
      }
      if (trimmed.startsWith('#') || trimmed.startsWith(';')) {
        return { type: 'comment', raw: line };
      }
      if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
        return { type: 'section', raw: line, value: trimmed.slice(1, -1) };
      }

      const equalsIdx = line.indexOf('=');
      if (equalsIdx !== -1) {
        return {
          type: 'pair',
          raw: line,
          key: line.slice(0, equalsIdx).trim(),
          value: line.slice(equalsIdx + 1).trim()
        };
      }

      return { type: 'comment', raw: line }; // Fallback
    });

    return { filePath: targetPath, lines: parsedLines };
  }

  /**
   * Registers your patch file safely at the top priority of the resource sequence
   */
  public registerPatchTree(manifest: SwgCfgManifest, patchName: string): SwgCfgManifest {
    const updatedLines = [...manifest.lines];

    // 1. Check if this specific patch file is already registered to avoid duplication
    const alreadyRegistered = updatedLines.some(
      l => l.type === 'pair' && l.key === 'searchTree' && l.value === patchName
    );
    if (alreadyRegistered) return manifest;

    // 2. Find the ResourceSystem target block section
    let resourceSectionIdx = updatedLines.findIndex(
      l => l.type === 'section' && l.value?.toLowerCase() === 'resourcesystem'
    );

    // If the section doesn't exist, append one to the end of the file safely
    if (resourceSectionIdx === -1) {
      updatedLines.push({ type: 'blank', raw: '' });
      updatedLines.push({ type: 'section', raw: '[ResourceSystem]', value: 'ResourceSystem' });
      resourceSectionIdx = updatedLines.length - 1;
    }

    // 3. Insert the new patch file entry immediately following the section declaration header block
    // This gives your custom file absolute override priority over legacy game files
    const patchInsertionEntry: CfgLine = {
      type: 'pair',
      raw: `searchTree=${patchName}`,
      key: 'searchTree',
      value: patchName
    };

    updatedLines.splice(resourceSectionIdx + 1, 0, patchInsertionEntry);
    return { ...manifest, lines: updatedLines };
  }

  /**
   * Serializes the structure array cleanly back into physical configuration text assets
   */
  public async writeConfigFile(manifest: SwgCfgManifest): Promise<void> {
    // Automated Backup Check Layer: Prevent file corruption issues
    const backupPath = `${manifest.filePath}.bak`;
    try {
      await fs.copyFile(manifest.filePath, backupPath);
    } catch {
      // Create backup file quietly if it does not exist
    }

    const outputText = manifest.lines
      .map((line) => {
        if (line.type === 'pair') return `${line.key}=${line.value}`;
        return line.raw;
      })
      .join('\n');

    await fs.writeFile(manifest.filePath, outputText, 'utf-8');
  }
}
```

The high-level `executeAutoConfigPatch` wrapper iterates over all candidate config filenames and applies the patch registration to whichever files are present:

```typescript
export async function executeAutoConfigPatch(clientDirectory: string, patchFileName: string): Promise<void> {
  const cfgManager = new SwgCfgManager();

  // SWG installations can target either swg.cfg or live.cfg depending on setup types
  const potentialConfigs = ['swg.cfg', 'live.cfg', 'user.cfg'];

  for (const filename of potentialConfigs) {
    const fullPath = path.join(clientDirectory, filename);

    try {
      // Check if file profile is present inside the folder structure
      await fs.access(fullPath);

      console.log(`Auto-Config scanning targeting system: ${filename}`);
      let manifest = await cfgManager.parseConfigFile(fullPath);

      manifest = cfgManager.registerPatchTree(manifest, patchFileName);
      await cfgManager.writeConfigFile(manifest);

      console.log(`Successfully updated active path layout within: ${filename}`);
    } catch (err) {
      // Quietly step past config targets that aren't utilized by this client setup
    }
  }
}
```

---

## 12. TRE Consolidation: TREE0005 Multi-Layer Packing

When multiple ordered changeset snapshots exist (e.g., `snap_001/`, `snap_002/`, `snap_003/`), the toolkit consolidates them into a single optimized `.tre` by keeping only the highest-priority version of each virtual game path.

### Consolidation Pipeline Overview

```
[ TS Changeset Stack Array ]
        |
        v
  C++ Flatten Sweep — crawls layers bottom to top
        |
        v
  In-Memory Consolidation Pool — keeps only the newest version of each path
        |
        v
  Compress file blocks via zlib
        |
        v
  Prepend Index + Name Tables
        |
        v
  [ Compiled final .tre stream ]
```

### Step 1: Consolidated Binary File Models (C++)

```cpp
#include <napi.h>
#include <vector>
#include <string>
#include <unordered_map>
#include <filesystem>
#include <fstream>
#include <cstring>
#include <zlib.h>

namespace fs = std::filesystem;

// Tracks the highest-priority on-disk version of a given virtual game path
struct MemoryFileEntry {
    std::string virtualGamePath;  // e.g. "terrain/tatooine.trn"
    fs::path    absoluteDiskPath; // e.g. "C:/Workspace/.studio/changesets/snap_003/terrain/tatooine.trn"
};
```

### Step 2: Top-Down Consolidation Stack Parser (C++)

Iterates through the ordered changeset folder array from bottom (oldest/base) to top (newest). Later layers overwrite earlier entries in the hash map, so the final map holds only the newest version of each path.

```cpp
class SwgTreStackCompiler {
public:
    /**
     * Traverses ordered changeset directories to build a deduplicated asset registry.
     * Folders should be ordered oldest-first so newer layers overwrite older keys.
     */
    static std::unordered_map<std::string, MemoryFileEntry> ConsolidateChangesetLayers(
        const std::vector<std::string>& orderedChangesetFolderPaths
    ) {
        std::unordered_map<std::string, MemoryFileEntry> consolidatedMap;

        for (const auto& layerDir : orderedChangesetFolderPaths) {
            fs::path searchPath(layerDir);
            if (!fs::exists(searchPath)) continue;

            for (const auto& entry : fs::recursive_directory_iterator(searchPath)) {
                if (!entry.is_regular_file()) continue;

                // Skip internal metadata files
                if (entry.path().filename() == "snapshot_manifest.json" ||
                    entry.path().extension() == ".bak") {
                    continue;
                }

                // Convert absolute disk path -> relative virtual game path
                // e.g. "C:/Workspace/.studio/changesets/snap_002/datatables/weapon.iff"
                //   -> "datatables/weapon.iff"
                std::string relativePath =
                    fs::relative(entry.path(), searchPath).lexically_normal().string();
                // Enforce forward slashes for game path convention
                std::replace(relativePath.begin(), relativePath.end(), '\\', '/');

                MemoryFileEntry fileNode;
                fileNode.virtualGamePath  = relativePath;
                fileNode.absoluteDiskPath = entry.path();

                consolidatedMap[relativePath] = fileNode;  // overwrites older versions
            }
        }
        return consolidatedMap;
    }
};
```

### Step 3: Core TREE0005 Data Packing Pipeline (C++)

Uses `IffBinaryWriter` (see [section 5](#5-iff-binary-writer-c)) and the same `TreIndexEntry` struct from [section 7](#7-tre-archive-format).

```cpp
class SwgTreBinaryGenerator {
public:
    static std::vector<uint8_t> PackConsolidatedMapToTre(
        const std::unordered_map<std::string, MemoryFileEntry>& fileMap
    ) {
        IffBinaryWriter masterWriter;
        uint32_t fileCount = static_cast<uint32_t>(fileMap.size());

        std::vector<TreIndexEntry> indexBlock(fileCount);
        std::vector<uint8_t> nameBlock;
        std::vector<uint8_t> dataBlock;

        uint32_t currentNameOffset = 0;
        uint32_t loopIdx = 0;

        for (const auto& [virtualPath, fileNode] : fileMap) {
            // 1. Pack virtual path into Name Block
            nameBlock.insert(nameBlock.end(), virtualPath.begin(), virtualPath.end());
            nameBlock.push_back(0);  // null terminator

            // 2. Read raw asset bytes from disk
            std::ifstream fileStream(fileNode.absoluteDiskPath,
                                     std::ios::binary | std::ios::ate);
            size_t fileSize = fileStream.tellg();
            std::vector<uint8_t> rawFileBytes(fileSize);
            fileStream.seekg(0, std::ios::beg);
            fileStream.read(reinterpret_cast<char*>(rawFileBytes.data()), fileSize);
            fileStream.close();

            // 3. Compress via zlib
            std::vector<uint8_t> compressedBytes(rawFileBytes.size() + 12);
            uLongf compressedSize = compressedBytes.size();
            int zStatus = compress(compressedBytes.data(), &compressedSize,
                                   rawFileBytes.data(), rawFileBytes.size());

            indexBlock[loopIdx].nameOffset       = currentNameOffset;
            indexBlock[loopIdx].uncompressedSize = static_cast<uint32_t>(rawFileBytes.size());
            currentNameOffset += static_cast<uint32_t>(virtualPath.length() + 1);

            if (zStatus == Z_OK && compressedSize < rawFileBytes.size()) {
                compressedBytes.resize(compressedSize);
                indexBlock[loopIdx].compressedSize  = static_cast<uint32_t>(compressedSize);
                indexBlock[loopIdx].compressionType = 2;  // zlib
                indexBlock[loopIdx].dataOffset      = static_cast<uint32_t>(dataBlock.size());
                dataBlock.insert(dataBlock.end(), compressedBytes.begin(), compressedBytes.end());
            } else {
                indexBlock[loopIdx].compressedSize  = indexBlock[loopIdx].uncompressedSize;
                indexBlock[loopIdx].compressionType = 0;  // uncompressed
                indexBlock[loopIdx].dataOffset      = static_cast<uint32_t>(dataBlock.size());
                dataBlock.insert(dataBlock.end(), rawFileBytes.begin(), rawFileBytes.end());
            }
            loopIdx++;
        }

        // 4. Compute absolute offsets
        uint32_t headerOffset   = 12;               // "TREE0005" + fileCount
        uint32_t indexSize      = fileCount * 20;   // 20 bytes per entry
        uint32_t nameBlockStart = headerOffset + indexSize;
        uint32_t dataBlockStart = nameBlockStart + static_cast<uint32_t>(nameBlock.size());

        for (uint32_t i = 0; i < fileCount; ++i) {
            indexBlock[i].dataOffset += dataBlockStart;
        }

        // 5. Assemble master file buffer using IffBinaryWriter
        masterWriter.WriteTag("TREE");
        masterWriter.WriteTag("0005");
        masterWriter.WriteUint32(fileCount);

        for (const auto& entry : indexBlock) {
            masterWriter.WriteUint32(entry.nameOffset);
            masterWriter.WriteUint32(entry.compressedSize);
            masterWriter.WriteUint32(entry.uncompressedSize);
            masterWriter.WriteUint32(entry.dataOffset);
            masterWriter.WriteUint32(entry.compressionType);
        }

        masterWriter.WriteRawBuffer(nameBlock);
        masterWriter.WriteRawBuffer(dataBlock);

        return masterWriter.buffer;
    }
};
```

### Step 4: N-API Bridge — Stack Compiler

```cpp
Napi::Value CompileDirectoryToTreStream(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    Napi::Array jsLayerPathsArray = info[0].As<Napi::Array>();

    std::vector<std::string> orderedLayers;
    for (uint32_t i = 0; i < jsLayerPathsArray.Length(); ++i) {
        orderedLayers.push_back(jsLayerPathsArray.Get(i).As<Napi::String>().Utf8Value());
    }

    try {
        // 1. Run top-down priority filtration across all changeset layers
        auto consolidatedMap = SwgTreStackCompiler::ConsolidateChangesetLayers(orderedLayers);

        // 2. Serialize and compress into a single deployment stream
        std::vector<uint8_t> finishedTreBytes =
            SwgTreBinaryGenerator::PackConsolidatedMapToTre(consolidatedMap);

        // 3. Return zero-copy ArrayBuffer to JavaScript
        Napi::ArrayBuffer outputBuffer = Napi::ArrayBuffer::New(env, finishedTreBytes.size());
        std::memcpy(outputBuffer.Data(), finishedTreBytes.data(), finishedTreBytes.size());
        return outputBuffer;
    } catch (const std::exception& e) {
        Napi::TypeError::New(env, e.what()).ThrowAsJavaScriptException();
        return env.Null();
    }
}

// Register in native module exports initializer
exports.Set("compileDirectoryToTreStream",
            Napi::Function::New(env, CompileDirectoryToTreStream));
```

### Step 5: Patch Build UI — Changeset Compiler Widget

```tsx
import React, { useState } from 'react';

interface ExporterProps {
  nativeBridge: any;
  // Ordered absolute directory paths: [oldestLayer, ..., newestLayer]
  activeChangesetStack: string[];
  onBuildComplete: (filePath: string) => void;
}

export const SwgTreChangesetCompilerWidget: React.FC<ExporterProps> = ({
  nativeBridge,
  activeChangesetStack,
  onBuildComplete
}) => {
  const [isCompiling, setIsCompiling] = useState(false);

  const handleBuildConsolidatedPatch = async () => {
    if (activeChangesetStack.length === 0) return;
    setIsCompiling(true);

    try {
      // 1. Fire the native multi-layer priority compiler
      const compiledTreArrayBuffer: ArrayBuffer =
        nativeBridge.compileDirectoryToTreStream(activeChangesetStack);
      const finalBytesView = new Uint8Array(compiledTreArrayBuffer);

      // 2. Write the unified archive to disk
      const outputFilename = 'live_workspace_patch.tre';
      const success = await window.api.saveFileToDisk(outputFilename, finalBytesView);

      if (success) {
        onBuildComplete(outputFilename);
        alert(
          `Parity Success! Consolidated ${activeChangesetStack.length} changeset layers ` +
          `into a single deployment package: ${outputFilename}`
        );
      }
    } catch (err: any) {
      console.error('Changeset stack compilation fault:', err);
      alert(`Consolidation aborted: ${err.message}`);
    } finally {
      setIsCompiling(false);
    }
  };

  return (
    <button
      onClick={handleBuildConsolidatedPatch}
      disabled={isCompiling || activeChangesetStack.length === 0}
      style={{
        width: '100%',
        background: isCompiling ? '#444' : '#ff0055',
        color: '#fff',
        fontWeight: 'bold',
        padding: '10px',
        border: 'none',
        borderRadius: '2px',
        fontFamily: 'monospace',
        fontSize: '11px',
        cursor: activeChangesetStack.length === 0 ? 'not-allowed' : 'pointer'
      }}
    >
      {isCompiling
        ? 'Consolidating Tree Slices...'
        : 'Compile & Flatten Active Stack (.TRE)'}
    </button>
  );
};
```

---

## 13. DDS Texture Handling

SWG uses DirectDraw Surface (`.dds`) files for all textures. Web browsers cannot render `.dds` natively via standard `<img>` tags.

Two strategies:

- **Option A (web-side):** Use Three.js's built-in `DDSLoader` to parse `.dds` pixel buffers inside the browser sandbox. Works but keeps GPU-compressed texture data in a browser-specific path.
- **Option B (recommended):** Let the C++ N-API layer use a lightweight library (`stb_image` or `DirectXTex`) to transcode `.dds` compressed textures into `.png` or `.webp` in memory before passing the result to the React UI. This keeps format complexity in the C++ layer and delivers standard image formats the browser handles natively.

The N-API hand-off for textures follows the same `Napi::ArrayBuffer` pattern as mesh data: decompress from TRE, transcode in C++, pass buffer to TypeScript, construct a `THREE.DataTexture` or a blob URL.
