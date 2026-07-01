# CONSULT 04.3-12 — Cursor — byte-map a real sku3 entry vs tre_reader.read_tre_payload

You are one of four independent consultants. Answer ONLY your angle. Do not try to agree with anyone.

## LOCKED ground-truth axioms — do NOT contradict, re-derive, or "correct" these
1. `patch_sku3_24_shared_00.tre` = header tag `EERT6000`, `numberOfFiles=0`, payload begins with `78 9c` (plain zlib) at byte 36 — NOT encrypted.
2. Master SearchTOC `.toc` entry = 24 bytes LE: `compressor@0(u16)`, `treeFileIndex@2(u16)`, `crc@4(u32)`, `fileNameLength@8(u32)`, `offset@12(u32)`, `length@16(u32)`, `compressedLength@20(u32)`.
3. TRE internal TOC is CRC-FIRST for ALL versions; V6000 stride = 32 bytes. The "size-first" TOC layout is **FALSIFIED — BANNED** from your answer.
4. v6000 is DUAL-format: SWG-Source `patch_sku3` = plain zlib (READABLE); Restoration = encrypted (degrade). Classification is **PER-PAYLOAD at runtime** (try zlib inflate; fall back), NOT by the version tag.

## Ground-truth sources (outrank any doc/ or consensus)
- Real bytes: `D:/Code/SWGSource Client v3.0/` — the master `.toc` (e.g. `sku3_client.toc`) + `patch_sku3_*_client_*.tre` containers.
- `../swg-blender-plugin/swg_pipeline/tre_reader.py::read_tre_payload` — the working oracle reader.
- As-merged: `packages/native-core/src/tre_binding.cpp` (`parseTocIntoMount`), `packages/renderer/src/services/tocReader.ts` (`resolveFull`).
- Committed fixture: `packages/harness/fixtures-real/toc/*.v6000.descriptor.json` + `*.v6000.expected.bin`.

## YOUR ANGLE (Cursor — most detailed byte-map reader)
Pick ONE real `patch_sku3` entry (prefer `appearance/lod/thm_must_droid_factory_exterior.lod` in `patch_sku3_24_client_00.tre`, or any small entry). Byte-map the FULL chain end to end:
- master `.toc` 24-byte descriptor for that virtualPath (raw hex → each field per axiom 2) →
- the container `.tre` bytes at `offset` for `compressedLength` bytes (raw hex; confirm `78 9c` zlib header) →
- inflate → compare to `read_tre_payload` in `tre_reader.py` for the same entry.

Answer precisely:
- Do the descriptor fields our `parseTocIntoMount`/`resolveFull` extract match the raw `.toc` bytes exactly (offsets, widths, endianness)?
- Does the container byte-slice at `[offset, offset+compressedLength)` inflate to the same bytes `tre_reader.py` produces?
- Does the committed `*.v6000.expected.bin` equal that inflated output?

## Rule
Show raw hex for the descriptor and the first/last bytes of the payload slice. If any field or byte disagrees with the layout above, the BYTES win — report exactly where. Cite `file:line` and byte offsets.
