# CONSULT-04 — fresh Sonnet — TRE override/shadow resolution + Utinni second-oracle cross-check

You are the lateral / out-of-the-box reader. Two jobs, both about the `.tre` archive container.
Do **not** trust this project's `docs/` tree — AI-distilled, frequently fabricated. Cite `file:line`.

## LOCKED GROUND-TRUTH EVIDENCE — treat as given; do NOT re-derive these bytes

Real `.tre` from `D:\SWG Infinity\SWG Infinity\Live\`, first 0x28 bytes — all version `0005`:

```
bottom.tre  16,205,884 B   00: 45 45 52 54 35 30 30 30 28 03 00 00 AB CD F6 00  EERT5000
mtg_planets 135,424,016 B  00: 45 45 52 54 35 30 30 30 00 0D 00 00 DA 57 10 08  EERT5000
                           10: 02 00 00 00 E1 C5 00 00 02 00 00 00 55 7A 00 00
                           20: 01 7E 02 00 CD AB 00 00 01 04 00 00 00 03 00 00
```
Given: bytes 0..7 = ASCII `"EERT5000"` (`'TREE'`+`'0005'`, byte-reversed). `78 9C` = zlib.
Note the install has BASE trees (`bottom.tre`) and many `mtg_patch_NNN_*.tre` PATCH trees — the
patch trees are meant to **override/shadow** files in the base trees.

## JOB 1 — Override / shadow / load-order resolution (the multi-archive question)

When several archives are mounted and two contain the same logical path, which wins? Read:
- `../swg-client-v2/src/engine/shared/library/sharedFile/src/shared/TreeFile.cpp` — how mounted
  trees are chained/searched (`TreeFile_SearchNode`), and whether first-mounted or last-mounted wins.
- `../swg-client-v2/tools/tre-compare/` — its verify configs (`verify-swgemu.cfg`, Infinity,
  Stardust, SWGSource) encode the real **load order**. What ordering convention do they use? Does a
  later/earlier entry shadow an earlier/later one?
- Any client-side `.cfg`/searchPath/`addSearchTree` priority logic.

Resolve: **is it last-wins or first-wins, and is priority by mount order or by an explicit number?**
Cite `file:line` / config evidence. Explain how a patch `.tre` correctly shadows a retail tree.

## JOB 2 — Second-oracle cross-check of the TRE header/TOC layout

Independently read `../Utinni/UtinniCoreDotNet/Formats/Tre` (working C# reader). Map the SAME
header/TOC/name-block/compression fields the C# code reads. Then state, field by field, whether
Utinni's C# layout **agrees or disagrees** with what swg-client-v2's `TreeFile.cpp` implies for the
locked bytes above. Convergence between two independent oracles = confidence; any disagreement is a
flag we MUST surface, not smooth over.

## OUTPUT

(1) A definitive override-resolution rule (last-wins vs first-wins; by mount order or priority
number) with evidence. (2) A two-column agree/disagree table: `field | swg-client-v2 says | Utinni
C# says`. Mark unverifiable items OPEN. Do not guess.

Write your findings to `.planning/research/CONSULT-04-sonnet-tre-override-and-second-oracle.out` AND return them.
