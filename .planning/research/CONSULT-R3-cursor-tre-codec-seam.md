# Consult task (Cursor, round-3 spot-check): TRE codec seam boundary vs real native code

You are reviewing ONE architectural scoping decision in a plan against the real native source. Read-only.

## Locked axioms (treat as given, do NOT re-derive or contradict)

1. Standard TRE (versions 0004/0005, "EERT5000") uses plain zlib. Verified ground truth.
2. v6000 is a DUAL format: SWG-Source/swg-client-v2 patch_sku3 v6000 = plain zlib (readable); Restoration v6000 = encrypted. Encrypted-ness is a per-payload runtime property (try zlib), NOT the version tag. TOC is crc-first in all versions (24B entries; v6000 = 32B).
3. Decision D-21 (CONTEXT.md): "make the TRE read/write path a pluggable codec interface ... so custom compression/encryption can be dropped in."

## Evidence to read (real source, this repo)

- The native TRE code in this repo (search for `TreArchive.cpp` and `TreBuilder.cpp` under the native core package; also the headers).
- The plan under review: `.planning/phases/04.4-ux-polish-deploy-hardening/04.4-06-PLAN.md` — it PROPOSES scoping the codec seam to per-entry payload compression only (`codecForCompressor` / `codecForTreVersion`), explicitly leaving TOC/name-block inflate/deflate as hardcoded zlib, with the rationale that TOC/name-block must be universally readable before a per-entry codec can be selected.

## Your questions (byte-map / file:line trace — answer from the code)

a) Map every inflate/deflate call site in `TreArchive.cpp` and `TreBuilder.cpp` with file:line, and classify each as payload-path or TOC/name-block-path. (The plan claims TOC/name-block sites exist at roughly lines 192/215/333/357 — verify independently; report the true locations.)
b) Given the code as it actually is: does the proposed payload-only seam cover every call site a "custom per-entry compression/encryption" plugin would need? Yes/no per call site.
c) Concretely: if someone later plugs in a codec for a TRE variant whose TOC or name block is ALSO non-zlib (e.g. an encrypted-TOC format), what is the FIRST function that breaks, and is retrofitting the seam there a contained change or a signature-cascading one? (This determines whether payload-only-now is a cheap deferral or an expensive one.)

Report file:line for every claim. Distinguish measured fact from inference.
