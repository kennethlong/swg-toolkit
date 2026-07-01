# CONSULT 04.3-12 — fresh Opus — spec/math: is per-payload inflate-then-classify correct & false-positive-free

You are one of four independent consultants. Answer ONLY your angle. Do not try to agree with anyone. This is a
binary-format correctness question (zlib/decompression math) — not a security task.

## LOCKED ground-truth axioms — do NOT contradict, re-derive, or "correct" these
1. `patch_sku3_24_shared_00.tre` = header tag `EERT6000`, `numberOfFiles=0`, payload begins with `78 9c` (plain zlib) at byte 36 — NOT encrypted.
2. Master SearchTOC `.toc` entry = 24 bytes LE: `compressor@0(u16)`, `treeFileIndex@2(u16)`, `crc@4(u32)`, `fileNameLength@8(u32)`, `offset@12(u32)`, `length@16(u32)`, `compressedLength@20(u32)`.
3. TRE internal TOC is CRC-FIRST for ALL versions; V6000 stride = 32 bytes. "size-first" layout is **FALSIFIED — BANNED**.
4. v6000 is DUAL-format: SWG-Source `patch_sku3` = plain zlib (READABLE); Restoration = encrypted (degrade). Classification is **PER-PAYLOAD at runtime** (try zlib inflate; fall back to encrypted), NOT by the version tag.

## Ground-truth sources (outrank any doc/ or consensus)
- As-merged: `packages/native-core/modules/core/tre/TreArchive.cpp` (`extractAt` — the per-payload classify), `packages/native-core/src/tre_binding.cpp` (`ExtractMountAt`, encrypted sentinel).
- Oracle: `../swg-blender-plugin/swg_pipeline/tre_reader.py` + `tre_decrypt.py` (how the working reader distinguishes plain vs encrypted).

## YOUR ANGLE (fresh Opus — spec/math reasoning)
Evaluate the correctness of the as-merged **per-payload inflate-then-classify** for BOTH families, from a decompression-math standpoint:
- SWG-Source plain-zlib payload (`78 9c ...`, `compressor` per axiom 2): does try-inflate correctly yield the plaintext and classify as READABLE? Does it honor `length` (uncompressed) vs `compressedLength`?
- Restoration encrypted payload: does try-inflate reliably FAIL (returns `{encrypted:true}` / sentinel) rather than silently producing garbage?
- **False-positive risk:** could an encrypted payload's first two bytes coincidentally look like a valid zlib header (`0x78 0x01/0x5E/0x9C/0xDA`, or FCHECK-valid combos) and inflate far enough to be mis-classified as plain? What is the probability, and does the code guard it (CRC-32 `0x04C11DB7` check on the inflated bytes? full-length inflate success? `length` match)?
- **False-negative risk:** could a legitimately plain payload fail to inflate (e.g., raw-deflate `compressor` value with no zlib header) and be wrongly marked encrypted?

Answer precisely: is the classification sound, and if not, what additional check (CRC verify / exact-length match / compressor-value dispatch) makes it robust? Cite `file:line`.

## Rule
Reason from the zlib format + the real code + the oracle reader. If the code's behavior contradicts the measured bytes/oracle, the BYTES/oracle win. Report as findings, not consensus.
