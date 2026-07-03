---
id: v6000-swg-source-plain-zlib-read-support
title: searchTOC base is incompletely mounted — empty-internal-TOC container .tre files (incl. v6000) need the MASTER .toc as the index; v6000 is plain-zlib, not encrypted
created: 2026-06-29
origin: Maintainer UAT note during 04.2-06 — swg-client-v2 mounts patch_sku3_*.tre as v6000 "enumerate-only (encrypted)" with 0 entries, but they are plain zlib. Investigation (2026-06-29, real bytes) found the deeper cause: those .tre files have EMPTY internal TOCs; their entries live only in the master .toc.
severity: medium-high (the v6000/empty-TOC content set is silently missing from the mount; NOT blocking the 04.2-06 UAT — the space-terminal texture is in a v5000 self-indexed patch and resolves fine)
area: renderer (treAutoMount + tocReader) + native-core (tre extraction for toc-indexed entries; v6000 enumerate-only)
status: done
resolves_phase: "04.3"
related: tre-version-oracles-and-v6000-encryption, feedback-crew-catches-what-plancheck-cannot, project-binds-and-automounts-client-tres
---

## Real root cause (verified 2026-06-29 against real swg-client-v2 / SWGSource Client v3.0 bytes)

The swg-client-v2 base is a **SearchTOC** architecture: a master `.toc` per sku (`sku0_client.toc` =
193,475 entries, `sku3_client.toc` = 1,158) is the authoritative index of every path, mapping each to
`(tre_file, offset, compressor, length, compressedLength, crc)`. The referenced `.tre` files come in TWO
shapes:

| `.tre` kind | Example | Internal TOC | Our current mount result |
|---|---|---|---|
| Self-indexed retail/patch | `bottom.tre` (v5000, 808), `patch_11_00.tre` (v5000, 12198) | PRESENT (numberOfFiles>0) | reads internal TOC → entries appear ✓ |
| TOC-indexed container | `patch_sku3_24_shared_00.tre` (**v6000, numberOfFiles=0**) | EMPTY | reads empty internal TOC → **0 entries** ✗ |

`treAutoMount.buildTreNodes` mounts each `.tre` by name (`readTocTreeNames`) and relies on each `.tre`'s
**internal** TOC (`mountTrePaths` → native `TreArchive` parses the on-disk TOC). For empty-TOC container
files that yields 0 entries — that is the `entryCount 0` in the Mounted-Archives UI. The entries for those
files exist ONLY in the master `.toc` (payloads at `comp:2`=zlib / `comp:0`=stored — **READABLE, not
encrypted**; confirmed via the `.toc` index + `swg_pipeline/tre_reader.py`).

The faithful fix = mount a SearchTOC client from the **master `.toc` index** (the full entry set, which
`tocReader.readTocIndex` from 04.2-03 already reads but the mount never uses for entry-sourcing), NOT from
per-`.tre` internal TOCs. Payloads are read from the referenced `.tre` at the indexed offset + inflated by
the per-entry compressor.

## Secondary issue — v6000 enumerate-only is also wrong (but insufficient on its own)

`native-core/.../TreVersion.h::isEnumerateOnly(v){ return v==V6000; }` blanket-refuses ALL v6000 payload
extraction (`TreArchive.cpp::extractEntry` throws), citing Utinni (Restoration-only, where v6000 IS
encrypted). swg-client-v2 v6000 is plain zlib. So even once entries are sourced from the master `.toc`,
extraction of a v6000-container payload would be refused. Fix: make enumerate-only a per-payload runtime
determination (attempt inflate; only on failure classify as Restoration-encrypted) — mirrors
`tre_decrypt.py::try_read_tre_payload`. NOTE: flipping `isEnumerateOnly` ALONE does nothing visible, because
the entries are not sourced (empty internal TOC) — the master-index mount is the load-bearing fix.

## Acceptance criteria

1. SearchTOC mount sources entries from the master `.toc` index (all paths), so TOC-indexed container `.tre`
   files (incl. v6000) contribute their entries — `patch_sku3_*` archives show non-zero entryCount.
2. Avoid double-counting where a `.tre` is BOTH self-indexed and master-indexed (use the master `.toc` as
   the single index for searchTOC clients; do not also read internal TOCs for the same paths).
3. Payload extraction for a TOC-indexed entry reads from the referenced `.tre` at offset + inflates by the
   per-entry compressor; a known v6000 asset extracts byte-identically to `tre_reader.read_tre_payload()`.
4. v6000 `isEnumerateOnly` becomes per-payload (try inflate; refuse only on real failure). Restoration v6000
   still degrades gracefully to enumerate-only (no crash).
5. UI "enumerate-only (encrypted)" chip shows only when extraction actually fails, not for readable v6000.
6. Regression: v5000 self-indexed base/patches (bottom.tre, patch_11_*) still resolve; Infinity/SWGEmu
   searchTree clients unaffected. Native byte-exact test on a real swg-client-v2 v6000 archive (skipIf absent).

## Related: loose-overlay over-enumeration (found during UAT 2026-06-29)

`treAutoMount.injectLooseDirOverlay` recursively enumerates EVERY file in each client `searchPath` dir
and adds them as VFS entries. For swg-client-v2 `client.cfg` lists `searchPath_00_9="D:/Code/SWGSource
Client v3.0/"` — the whole data root — so it surfaces thousands of loose files AND the `.tre` archives
in that dir as bogus loose VFS entries. The real client does on-demand searchPath lookups, not full
enumeration. Fix candidates: only overlay the top-priority override dir (looseDirs[0]); skip `.tre`/.toc
and known-archive files; or make searchPath lookups lazy. (Extract from loose entries was separately
fixed in a3b825f by reading winnerArchivePath directly when winnerArchiveIndex < 0; the IFF/mesh
"Open in viewer" read paths still have the same loose-entry gap — fix with a shared readVfsEntryBytes.)

## UAT impact + notes

- NOT blocking 04.2-06: `texture/ksk_all_spaceterminal.dds` is in `patch_11_0x.tre` (v5000, self-indexed) →
  resolves via the normal internal-TOC mount + the autoMountClient wiring fix (bcf48e6).
- The MISSING set is the sku3 v6000 content (1,158 paths: collision floors, 344 dds, 294 msh, etc.) — real
  client content the toolkit currently omits. Worth completing for full TRE-05 fidelity.
- This corrects the stored memory [[tre-version-oracles-and-v6000-encryption]] ("v6000 = exclusively
  Restoration-encrypted; no plain-zlib 6000 exists" — FALSIFIED). Classic de-anchoring case (CLAUDE.md):
  the working extractor + the SWG Source client mounting these files is ground truth.
- This is effectively COMPLETING the searchTOC mount that 04.2-03 started (it built readTocIndex but the
  mount only used readTocTreeNames). Candidate for a dedicated 04.x plan, not a one-line patch.

## Resolution (2026-07-03 triage)

Resolved by 04.3-10 (native per-payload v6000 extraction + extractAt(descriptor)) + 04.3-11 (master-.toc mount sourcing, lazy searchPath); byte-exact v6000 gate GO in 04.3-12; UAT approved 04.3-13.
