# CONSULT-01 — Codex — TRE READ path (header + TOC + name block + compression)

You are a repo tracer / call-graph specialist. Read the REAL source. Do **not** trust this
project's `docs/` tree — its binary layouts were distilled by an AI and are frequently fabricated.
Cite real `file:line` for every claim.

## LOCKED GROUND-TRUTH EVIDENCE — treat as given; do NOT contradict or re-derive these bytes

Real `.tre` files from `D:\SWG Infinity\SWG Infinity\Live\`, first 0x28 bytes:

```
bottom.tre  (16,205,884 bytes)
00000000  45 45 52 54 35 30 30 30 28 03 00 00 AB CD F6 00   EERT5000(...
00000010  02 00 00 00 2F 33 00 00 02 00 00 00 E2 14 00 00
00000020  84 95 00 00 78 9C ...                              78 9C = zlib

mtg_patch_001_appearance_01.tre  (129,133,286 bytes)
00000000  45 45 52 54 35 30 30 30 54 45 00 00 26 57 A7 07   EERT5000TE..
00000010  02 00 00 00 A6 2E 04 00 02 00 00 00 DA 8F 02 00
00000020  19 BD 0F 00 78 9C ...

mtg_planets.tre  (135,424,016 bytes)
00000000  45 45 52 54 35 30 30 30 00 0D 00 00 DA 57 10 08   EERT5000
00000010  02 00 00 00 E1 C5 00 00 02 00 00 00 55 7A 00 00
00000020  01 7E 02 00 CD AB 00 00 01 04 00 00 00 03 00 00
```

Given facts (do not re-derive): bytes 0..7 are ASCII `"EERT5000"` — the 4-byte tag `'TREE'`
and the 4-byte version token `'0005'` each stored byte-reversed on disk. A `78 9C` zlib stream
appears shortly after the header. These three samples are version `0005`.

## PRIMARY ORACLE (read it, trace it)

- `../swg-client-v2/src/engine/shared/library/sharedFile/src/shared/TreeFile.cpp` (~971 lines)
- `../swg-client-v2/src/engine/shared/library/sharedFile/src/shared/TreeFile_SearchNode.*`

## YOUR ANGLE — the READ path only (not the writer; another consultant has the writer)

Trace the call graph from "open a `.tre`" through "read one file out of it". Specifically:

1. **Header struct, byte-exact.** Map every field after the 8-byte magic. For `bottom.tre`,
   tie each uint32 you find in source to the actual bytes above (e.g. what is `28 03 00 00` =
   0x328? what is `AB CD F6 00` = 0x00F6CDAB, ~near the 16.2 MB file size?). What is the
   `02 00 00 00` field that recurs? Name each field from source, with `file:line`.
2. **Version handling.** Where/how does the loader compare the version token? Does it accept
   `0005` AND `0006` (and any others)? What differs between versions in the read path? `file:line`.
3. **Table of contents.** Structure of each TOC record (offset, size, compressor, compressed
   size, name-block offset/CRC, etc.), record count, where the TOC lives in the file. `file:line`.
4. **Name block.** How filenames are stored (concatenated? null-terminated? offset table? CRC?),
   how a TOC record references its name. `file:line`.
5. **Compression.** Enumerate the per-file compressor codes the reader supports and which lib each
   maps to (the `78 9C` suggests zlib). What does compressor `0` (none) vs others mean? `file:line`.

## OUTPUT

A byte-exact field-by-field struct for the `0005` header + TOC record + name block, every field
cited to `TreeFile.cpp:line`. Mark anything the source does NOT make explicit as an OPEN question —
do not guess. End with a 5-line summary a C++ porter could implement from directly.
