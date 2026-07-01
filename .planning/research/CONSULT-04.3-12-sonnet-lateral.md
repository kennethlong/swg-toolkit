# CONSULT 04.3-12 — fresh Sonnet — lateral: what makes patch_sku3_* show 0 entries or the wrong winner

You are one of four independent consultants. Answer ONLY your angle. Do not try to agree with anyone.

## LOCKED ground-truth axioms — do NOT contradict, re-derive, or "correct" these
1. `patch_sku3_24_shared_00.tre` = header tag `EERT6000`, `numberOfFiles=0`, payload begins with `78 9c` (plain zlib) at byte 36 — NOT encrypted.
2. Master SearchTOC `.toc` entry = 24 bytes LE: `compressor@0(u16)`, `treeFileIndex@2(u16)`, `crc@4(u32)`, `fileNameLength@8(u32)`, `offset@12(u32)`, `length@16(u32)`, `compressedLength@20(u32)`.
3. TRE internal TOC is CRC-FIRST for ALL versions; V6000 stride = 32 bytes. The "size-first" TOC layout is **FALSIFIED — BANNED** from your answer.
4. v6000 is DUAL-format: SWG-Source `patch_sku3` = plain zlib (READABLE); Restoration = encrypted (degrade). Classification is **PER-PAYLOAD at runtime** (try zlib inflate; fall back), NOT by the version tag.

## Ground-truth sources (outrank any doc/ or consensus)
- `../swg-client-v2`: `TreeFile.cpp`, `TreeFile_SearchNode.{h,cpp}` — search precedence / dedup / TOCTreePath handling.
- As-merged: `packages/renderer/src/services/treAutoMount.ts` (`autoMountClient` → `mountTreMountWithTocPaths`), `tocReader.ts` (`resolve`/`resolveFull`, tombstone filter), `packages/native-core/src/tre_binding.cpp` (`parseTocIntoMount` — external entries into the mount).
- Reference memory (context, NOT axioms): searchTOC master `.toc` (131 TREs, `+TOCTreePath` prefix); precedence priority DESC wins, ties → later-added.

## YOUR ANGLE (fresh Sonnet — lateral / out-of-the-box)
The mount change now sources searchTOC entries from the master `.toc` so that a container with an EMPTY internal TOC (`numberOfFiles=0`, like `patch_sku3_*`) still exposes its files. Think laterally about what could still go wrong AFTER this change and make `patch_sku3_*` show **0 entries** or resolve the **wrong winner**:
- Dedup / "last writer wins" collisions across the 131 TREs (the classic Pitfall-4): could a later TRE's tombstone or a same-path entry hide the sku3 entry?
- `+TOCTreePath` prefix handling: is the virtualPath keyed with/without the prefix consistently between insert and lookup?
- Priority ties / search order: does the as-merged `mountTreMountWithTocPaths` preserve the engine's priority-DESC, ties→later precedence?
- Tombstone filter (`length==0 → undefined`): could it wrongly drop a real entry, or fail to drop a real tombstone?

Answer precisely: enumerate the concrete failure modes, say which the as-merged code is or isn't guarded against (cite `file:line`), and name the single most likely regression.

## Rule
Ground claims in the as-merged code + engine source. Do not invent byte layouts (use axiom 2/3 as given). Report failure modes as findings, not consensus.
