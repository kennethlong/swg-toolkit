# 2026-07-31 — CLOSED: .ws save size drift is one-time buildout-name inflation, not a leak

**Status:** Root-caused offline from the artifacts, no code change needed. The open item from the
2026-07-30 authored-fix HANDBACK §3 ("per-cycle save size drift ~20KB") is closed as **benign,
bounded, by design**.

## Verdict

The "1,380,222 → 1,400,231 per load-save cycle" observation was misread as per-cycle growth. It is a
**one-time +20,050-byte step on the first save from a stock baseline**, stable thereafter:

- Parsed stock `snapshot/tatooine.ws` (TOC-resolved: `sku0_client.toc` → `patch_55_client_00.tre`,
  1,380,222 bytes) vs the toolkit's 2026-07-31 11:36 save (1,400,272 bytes):
  - Nodes: **identical** — 15,808 total / 9,140 top-level in both.
  - OTNL name table: 848 → 1,174 names, **all unique, zero duplicates**. The +326 = 325 buildout
    template names + `object/building/toolkit/edit_1082874.iff` (the model-D derived template, the
    only legitimate addition).
  - OTNL string-bytes delta = 20,050 = the entire file growth.

## Mechanism

1. `WorldSnapshot::loadStep`'s buildout phase inserts every buildout object into `ms_reader` via
   `addObject`, which interns each template name into the shared OTNL. Tatooine has **68 v2 buildout
   tables in the TRE set, TOC-resolved** (`datatables/buildout/tatooine/*` — the old "tatooine has no
   buildout" note was a per-tre-scan artifact; the Wave-3 provenance comment in WorldSnapshot.cpp:160
   already recorded these). 325 of those names aren't in stock tatooine's authored OTNL.
2. `saveFiltered` excludes buildout **nodes** (the `ms_buildoutTopLevelNodes` filter) but serializes
   the **whole** name table — deliberately, per its comment ("excluded nodes may leave unused names —
   harmless; surviving nodes' indices stay valid without a remap pass").

## Why it does not grow per cycle

- Intern dedupe keys and load-path map keys are the same crc: `load_0001` keys the crc map with
  `Crc::calculate(name)`; `internObjectTemplateName` keys on `CrcString::getCrc()`, and
  `CrcString::calculateCrc` **is** `Crc::calculate(getString())`. Reloading a saved file re-populates
  the map with all 1,174 names → the buildout re-intern hits every time → no re-append.
- Field evidence: the 7/30 observed save (1,400,231) vs today's (1,400,272) differ by **exactly 41
  bytes = `object/building/toolkit/edit_1082874.iff` + NUL** — across sessions that included multiple
  load-of-saved-file → save cycles (the maintainer's stacked-moves verification). Zero duplicate
  names in today's table after all those cycles.

## Optional future polish (not landed)

If byte-minimal authored saves are ever wanted, `saveFiltered` could garbage-collect the OTNL (write
only names referenced by surviving nodes, remapping indices at serialization time). That would make a
stock load→save byte-identical to stock. Deliberately NOT done now: the save path is live-verified
end-to-end (model-D closed 2026-07-30/31) and the inflation is cosmetic.

## Analysis tooling

One-shot script (session scratchpad `ws_drift.py`): TOC-extracts stock, walks both IFFs, diffs node
counts + OTNL (count/uniques/dupes/set-diff). Rebuild in ~40 lines with
`swg-blender-plugin/swg_pipeline/tre_reader.py` (`read_search_toc_entries`) if ever needed again.
