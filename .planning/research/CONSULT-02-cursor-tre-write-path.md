# CONSULT-02 — Cursor — TRE WRITE/repack path (what makes a byte-identical `.tre`)

You are the most detailed code reader on the crew. Read the REAL source and produce a precise
`file:line` byte-map. Do **not** trust this project's `docs/` tree — its binary layouts were
AI-distilled and are frequently fabricated. Cite `file:line` for every claim.

## LOCKED GROUND-TRUTH EVIDENCE — treat as given; do NOT contradict or re-derive these bytes

Real `.tre` files from `D:\SWG Infinity\SWG Infinity\Live\`, first 0x28 bytes:

```
bottom.tre  (16,205,884 bytes)
00000000  45 45 52 54 35 30 30 30 28 03 00 00 AB CD F6 00   EERT5000(...
00000010  02 00 00 00 2F 33 00 00 02 00 00 00 E2 14 00 00
00000020  84 95 00 00 78 9C ...                              78 9C = zlib

mtg_planets.tre  (135,424,016 bytes)
00000000  45 45 52 54 35 30 30 30 00 0D 00 00 DA 57 10 08   EERT5000
00000010  02 00 00 00 E1 C5 00 00 02 00 00 00 55 7A 00 00
00000020  01 7E 02 00 CD AB 00 00 01 04 00 00 00 03 00 00
```

Given facts (do not re-derive): bytes 0..7 are ASCII `"EERT5000"` (`'TREE'` + version `'0005'`,
each byte-reversed on disk). `78 9C` = zlib stream. These samples are version `0005`.

## PRIMARY ORACLE (read it)

- `../swg-client-v2/src/engine/shared/application/TreeFileBuilder*` — the archive BUILDER app
- `../swg-client-v2/src/engine/shared/application/TreeFileExtractor*` — the extractor (for symmetry)
- Cross-ref `../swg-client-v2/src/engine/shared/library/sharedFile/src/shared/TreeFile.cpp` ONLY
  where the builder shares struct definitions.

## YOUR ANGLE — the WRITE/repack path only (another consultant owns the reader)

Goal: enumerate everything required to repack an archive so the output is **byte-identical** to a
real retail `.tre`. Specifically:

1. **Write order.** In what order does the builder emit sections — header, file data blocks, TOC,
   name block? Where does the TOC physically sit (front or back)? `file:line`.
2. **Per-file compression decision.** How does the builder decide compress vs store? Which zlib
   level / params produce the `78 9C` stream (default level 6)? Is compression deterministic? Are
   there files it stores uncompressed (compressor 0)? `file:line`.
3. **Alignment / padding.** Any byte alignment, padding, or ordering of files within the archive
   (sorted by name? by CRC? insertion order?) that a byte-identical repack must reproduce. `file:line`.
4. **Name block + CRC.** How names are laid out and any CRC/hash written per entry, with the exact
   algorithm/seed. `file:line`.
5. **Determinism hazards.** List every place where a naive re-writer would diverge from the
   original bytes (compression level, file ordering, timestamps, padding bytes, CRC variant).

## OUTPUT

A `file:line`-cited spec for emitting a byte-identical `0005` archive, plus an explicit
"divergence checklist" of things that break byte-equality. Mark anything not explicit in source as
OPEN — do not guess.
