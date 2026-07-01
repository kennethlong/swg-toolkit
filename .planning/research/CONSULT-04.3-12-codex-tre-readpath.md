# CONSULT 04.3-12 — Codex — as-merged master-.toc entry-sourcing + extractAt call graph

You are one of four independent consultants. Answer ONLY your angle. Do not try to agree with anyone.

## LOCKED ground-truth axioms — do NOT contradict, re-derive, or "correct" these
1. `patch_sku3_24_shared_00.tre` = header tag `EERT6000`, `numberOfFiles=0`, payload begins with `78 9c` (plain zlib) at byte 36 — NOT encrypted.
2. Master SearchTOC `.toc` entry = 24 bytes LE: `compressor@0(u16)`, `treeFileIndex@2(u16)`, `crc@4(u32)`, `fileNameLength@8(u32)`, `offset@12(u32)`, `length@16(u32)`, `compressedLength@20(u32)`.
3. TRE internal TOC is CRC-FIRST for ALL versions; V6000 stride = 32 bytes. The "size-first" TOC layout is **FALSIFIED — BANNED** from your answer.
4. v6000 is DUAL-format: SWG-Source `patch_sku3` = plain zlib (READABLE); Restoration = encrypted (degrade). Classification is **PER-PAYLOAD at runtime** (try zlib inflate; fall back to encrypted), NOT by the version tag.

## Ground-truth sources (outrank any doc/ or consensus)
- `../swg-client-v2`: `TreeFile.cpp`, `TreeFile_SearchNode.{h,cpp}` — the engine read path / SearchTOC / `localExists`.
- `../swg-blender-plugin/swg_pipeline/tre_reader.py` + `tre_decrypt.py` — working oracle reader.
- As-merged change: `packages/native-core/modules/core/tre/TreArchive.cpp` (`extractAt`), `packages/native-core/src/tre_binding.cpp` (`parseTocIntoMount` / `ExtractMountAt` / `MountTreMountWithToc`).

## YOUR ANGLE (Codex — repo tracer / call-graph)
Trace the **as-merged** call graph that sources a payload from the master `.toc` descriptor and extracts it: from `parseTocIntoMount` (24-byte entry parse) → the descriptor passed to `ExtractMountAt`/`TreArchive::extractAt` → the container `.tre` read at `offset`/`compressedLength` → inflate. Compare against how the real engine (`../swg-client-v2` SearchTOC / `TreeFile_SearchNode::localExists` + container read) locates and reads the same payload.

Answer precisely:
- Does our `offset` / `length` / `compressedLength` / `compressor` sourcing (which field goes where) match what the engine uses to read a `patch_sku3` entry?
- Does `extractAt` read from the container at the descriptor's `offset` (ignoring the container's empty internal TOC), matching the engine?
- Any off-by-one, wrong-field, endianness, or signedness mismatch vs the 24-byte layout in axiom 2?

## Rule
Ground every claim in the real source + the 24-byte layout above. If your reasoning contradicts the measured bytes, the BYTES win. Cite `file:line`. Report disagreements as findings, not as consensus.
