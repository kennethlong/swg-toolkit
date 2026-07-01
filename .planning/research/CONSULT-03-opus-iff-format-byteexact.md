# CONSULT-03 — fresh Opus — IFF FORM/chunk format + endianness + byte-exact serialize

You are a math/spec-reasoning specialist. Read the REAL source and reason precisely about the
serialization invariants. Do **not** trust this project's `docs/` tree — its binary layouts were
AI-distilled and are frequently fabricated. Cite real `file:line` for every claim.

This task is about **IFF**, a DIFFERENT format from the `.tre` archive container (other consultants
own TRE). IFF is the FORM/chunk tree format used INSIDE the archive for individual assets.

## ORACLES

- PRIMARY: the IFF loader sources in
  `../swg-client-v2/src/engine/shared/library/sharedFile/` (find the `Iff` reader/writer — e.g.
  `Iff.cpp`/`Iff.h` or equivalent). Read the real parse + write code.
- SECOND (cross-check ambiguous layouts): `../Utinni/UtinniCoreDotNet/Formats/Iff` (working C# impl).
- Fixtures to reason against: `../Utinni/Utinni.Cli.Tests/Fixtures/iff` and
  `../Utinni/UtinniCoreDotNet.Tests/FormatsTests/Iff`.

## QUESTIONS TO RESOLVE (with `file:line`)

1. **FORM vs leaf chunk layout.** Exact on-disk layout of a group node (`FORM`) header vs a leaf
   chunk: tag (4 bytes), length field (width? where?), the group "type" tag, and the data payload.
   Is there a tag besides `FORM` for groups (e.g. `LIST`, `CAT `, `PROP`)? `file:line`.
2. **Endianness — the crux.** Are chunk LENGTH fields big-endian or little-endian? (IFF/EA-85
   tradition is big-endian, but SWG may differ.) Does the loader switch endianness per platform or
   per chunk? Does it differ between the length field and the payload contents? Show the exact
   read/write code that proves it. `file:line`.
3. **Alignment / padding.** Are chunks word-aligned (pad byte after odd-length chunks, classic IFF)?
   Does SWG's loader insert or skip pad bytes? This is decisive for byte-exact round-trip. `file:line`.
4. **"Zero unexplained trailing bytes."** For a byte-exact serialize, what must a writer reproduce
   exactly: length encoding, pad bytes, sibling ordering, nesting? Enumerate every invariant a naive
   re-serializer could violate.
5. **Tag storage order.** Are the 4-char tags stored in natural order or byte-reversed (as the TRE
   magic `EERT` is)? Confirm from the read code, not assumption.
6. **Cross-oracle check.** Where swg-client-v2 and Utinni's C# disagree on any of the above, say so
   explicitly — divergence between two independent oracles is the signal we want, not a thing to
   smooth over.

## OUTPUT

A precise spec for round-trip-safe IFF read+write (FORM/chunk struct, endianness rule, padding rule,
ordering rule), every claim cited to `file:line` in the real source. Mark anything not explicit in
source as OPEN. End with the minimal set of invariants a byte-exact serializer must hold.

Write your findings to `.planning/research/CONSULT-03-opus-iff-format-byteexact.out` AND return them.
