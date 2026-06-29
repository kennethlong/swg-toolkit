---
id: v6000-swg-source-plain-zlib-read-support
title: v6000 is a DUAL format — SWG-Source v6000 is plain-zlib READABLE; stop blanket-marking all v6000 enumerate-only/encrypted
created: 2026-06-29
origin: Maintainer UAT note during 04.2-06 — swg-client-v2 mounts patch_sku3_*.tre as v6000 marked "enumerate-only (encrypted)" with 0 entries, but the maintainer's TRE extractor reads them (they are zlip-compressed, not encrypted). "I told you there were 6000 type tree files that were only zipped, not encrypted… my tre extractor can read these." Corrects the conflation with Restoration's genuinely-encrypted type 6000.
severity: high (blocks reading the swg-client-v2 dev-client base — assets inside v6000 patch archives never resolve/extract; directly impacts the 04.2 dev-client UAT spine)
area: native-core (modules/core/tre — TreVersion.h, TreArchive.cpp, TreMount.cpp) + renderer version display
status: pending
related: tre-version-oracles-and-v6000-encryption, feedback-crew-catches-what-plancheck-cannot, project-binds-and-automounts-client-tres
---

## Problem — `6000` is a version TAG used by TWO different formats; we treat the tag as "encrypted"

GROUND TRUTH (maintainer's working extractor + the SWG Source client itself):
- The version tag `6000` (32-byte crc-first TOC stride) is used by BOTH:
  - **SWG Source / swg-client-v2** `patch_sku3_*.tre` — **plain zlib, READABLE.** Proof: the SWG Source
    client mounts them, and `swg-blender-plugin/swg_pipeline/tre_reader.py` reads TOC+names+payloads via zlib.
  - **Restoration** — payloads proprietary-encrypted (zlib fails; needs TreeFileExtractor.exe).
- The discriminator is **per-payload at RUNTIME**, not the version string:
  `swg_pipeline/tre_decrypt.py::try_read_tre_payload` tries `zlib.decompress(raw)` → success = SWG-Source zlib;
  `zlib.error` = Restoration-encrypted. (compressor==0 ⇒ stored/raw.)

Our native code bakes the wrong axiom:
- `modules/core/tre/TreVersion.h::isEnumerateOnly(v) { return v == V6000; }` — blanket, version-tag-keyed.
  Comment cites "Utinni TreVersion.cs:79-86 (IsEnumerateOnly => V6000 only)" — but **Utinni targets Restoration**,
  where v6000 IS encrypted. The assumption does not generalize to SWG Source v6000.
- `modules/core/tre/TreArchive.cpp::extractEntry` (≈L307) throws for any `isEnumerateOnly(m_version)` archive —
  so even readable SWG-Source v6000 payloads are refused.
- `modules/core/tre/TreMount.cpp::archiveInfos` sets `info.enumerateOnly = isEnumerateOnly(ver)` → UI shows
  "enumerate-only (encrypted)" for all v6000.

Note the native reader ALREADY parses the v6000 32-byte TOC and populates `m_entries` (TreVersion.h `recordStride(V6000)=32`;
verified byte-exact vs `SwgRestoration_00.tre`). So entries are enumerated/browsable — only extraction is wrongly refused.

## Open anomaly to investigate FIRST

The swg-client-v2 v6000 archives displayed **entryCount 0** in the Mounted-Archives UI (screenshot 2026-06-29),
despite `archiveInfos().entryCount = node.archive->entryCount()` (= `m_entries.size()`). Possible causes:
1. Our native parse of these specific files throws and the mount swallows it → 0 entries (format delta between
   SWG-Source v6000 and the Restoration v6000 oracle we tested: TOC compressor handling, header field, name block).
2. The displayed `0` is a different column (shadow/override), not entryCount.
Determine this by mounting a real swg-client-v2 `patch_sku3_*.tre` through the native addon and logging entryCount +
the first parsed entry, cross-checked against `tre_reader.read_tre_entries()` on the same file.

## Acceptance criteria

1. `isEnumerateOnly` is no longer a version-tag gate. v6000 archives enumerate AND attempt payload extraction.
2. `extractEntry` for v6000: attempt `treInflate`/zlib (compressor-driven, same as retail). Only on inflate FAILURE
   classify that payload (or archive) as encrypted/Restoration → then refuse with a clear, per-payload reason.
3. swg-client-v2 `patch_sku3_*.tre` entries resolve in the VFS browser with non-zero entryCount, and a known asset
   (e.g. a `.dds`/`.iff` inside one) extracts byte-identically to `tre_reader.read_tre_payload()` on the same file.
4. Restoration v6000 still behaves correctly (extraction fails gracefully → enumerate-only, not a crash).
5. UI: the "enumerate-only (encrypted)" chip only shows when extraction actually fails, not for readable v6000.
6. Native byte-exact test using a real swg-client-v2 v6000 archive (skipIf absent), plus the existing Restoration
   v6000 enumerate-only test stays green.

## Notes / why I was wrong before

The stored memory `tre-version-oracles-and-v6000-encryption` (re-confirmed 2026-06-27) concluded "no plain-zlib 6000
exists; 6000 is exclusively Restoration-encrypted." That sampling missed swg-client-v2's patch_sku3 v6000 set. Memory
corrected 2026-06-29. This is a textbook de-anchoring case (CLAUDE.md): a working extractor + the SWG Source client
mounting these files is ground truth; the AI-distilled "v6000 = encrypted" axiom is not.

Whether this blocks the 04.2-06 UAT spine depends on whether `ksk_all_spaceterminal.dds` lives in a v6000 patch
archive vs a readable base TRE — check before deciding sequencing.
