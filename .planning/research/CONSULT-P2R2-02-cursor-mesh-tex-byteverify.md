# Verification task — confirm/refute Plans 02-01 / 02-02 byte layouts + texture wiring against real source

You are independently verifying plans against ground-truth C++ loader source. **Do not trust the plans;
open the real source and check.** Report every discrepancy with line cites; confirm matches with line ranges.

## Claims to check

**Plan 02-01** (`.planning/phases/02-3d-mesh-viewport-mvp-proof/02-01-PLAN.md`):
- A1. `.pal` is **RIFF PAL, not IFF** (24-byte header + entryCount×4; `versionOrComponentCount != 4` → force alpha=255), so CORE-05 must use a **parser-native** round-trip (read→serialize-own-format→compare), NOT generic `serializeIff(parseIff(bytes))`. `.dds` likewise (Microsoft DDS, not IFF).
- A2. LOD distance table (LDTB): distances live **inside the INFO chunk** (`int16 levelCount` + per-level `(min,max)` float32, stored as actual distances, squared at runtime), NOT in sibling chunks.
- A3. De-indexed geometry indices are **Uint32** (source ITL indices are int32; meshes can exceed 65535 verts).

**Plan 02-02** (`.planning/phases/02-3d-mesh-viewport-mvp-proof/02-02-PLAN.md`):
- B1. SKMG `.mgn` INFO = **9×int32 + 4×int16** (not 8×int32). `transformWeightDataCount` (TWDT total) is read FROM INFO (canonical), not derived as a cap.
- B2. SKTM skeleton: chunk `BPMJ` is **MANDATORY in v0001** (plain enterChunk — must enter+skip or the IFF read position corrupts) and **ABSENT in v0002** → the parser must version-branch.
- B3. The resolver plumbs `.dds`/`.pal` texture **bytes** through to the material descriptor (`materials[i].slotBytes[slot] = ArrayBuffer`) so Plan 02-03 can build textures without re-fetching. Check 02-02's resolver task wires this and 02-03 consumes it (don't re-fetch).

## Ground-truth source (open these — absolute paths)

- `D:/Code/swg-client-v2/src/engine/shared/library/sharedMath/src/shared/PaletteArgb.cpp` (RIFF PAL header/alpha rule)
- `D:/Code/swg-client-v2/src/engine/client/library/clientSkeletalAnimation/src/shared/appearance/SkeletalMeshGeneratorTemplate.cpp` (SKMG INFO field order/count; TWHD/TWDT)
- `D:/Code/swg-client-v2/src/engine/client/library/clientSkeletalAnimation/src/shared/appearance/BasicSkeletonTemplate.cpp` (SKTM v0001 vs v0002 chunk set; BPMJ)
- For LDTB, locate `LodDistanceTable.cpp` under `D:/Code/swg-client-v2` and read its INFO load.

## Your output

For each claim (A1–A3, B1–B3): CONFIRMED (line range) or WRONG (actual layout + line range). One-line
verdict on whether 02-01/02-02 are executable as written or still carry a byte/wiring error.
