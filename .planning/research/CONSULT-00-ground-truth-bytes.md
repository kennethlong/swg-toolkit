# CONSULT-00 — Ground-truth byte evidence (measured, locked)

Real `.tre` header bytes measured directly from installed clients on 2026-06-22. These are
**measured ground truth** — the oracle that overrides any docs/ claim or crew consensus.

## Client → TRE version map (measured)

| Client | Path (corrected) | Magic (bytes 0..7) | Version |
|---|---|---|---|
| SWG Infinity | `D:\SWG Infinity\SWG Infinity\Live\*.tre` | `EERT5000` | **v0005** |
| SWGEmu | `D:\SWGEmu-Client\*.tre`  (CONTEXT said `D:\SWGEmu Client\SWGEmu` — WRONG path) | `EERT5000` | **v0005** |
| SWG Restoration | `D:\SWG Restoration\SwgRestoration_*.tre` | `EERT6000` | **v0006** |

Also present on disk: `D:\Infinity Launcher`, `D:\swg_creature_client_ws`, `D:\swg_dev_bundle`,
and mirrors on `E:\`.

### ⚠ Findings for the planner / CONTEXT
- **Magic is byte-reversed.** `45 45 52 54` = `"EERT"` = tag `'TREE'` stored little-endian;
  `35 30 30 30` = `"5000"` = version `'0005'` stored little-endian. On disk you literally read
  `5000`/`6000`; the logical/big-endian label is `0005`/`0006`.
- **The D-12 multi-client gate (Infinity + SWGEmu) only covers v0005.** Both are `EERT5000`.
  To actually exercise the v0006 path that D-05 ("support ALL TRE variants") demands, the harness
  needs a v0006 fixture source — **SWG Restoration is the v0006 oracle.** Recommend adding it to
  the local-real fixture set (D-09/D-12).
- **CONTEXT canonical_refs SWGEmu path is wrong** (`D:\SWGEmu Client\SWGEmu` → actual
  `D:\SWGEmu-Client`). Fix in CONTEXT/canonical refs.

## Raw hexdumps (first 0x28 bytes)

### v0005 — `D:\SWG Infinity\...\bottom.tre` (16,205,884 B)
```
00000000  45 45 52 54 35 30 30 30 28 03 00 00 AB CD F6 00   EERT5000(...
00000010  02 00 00 00 2F 33 00 00 02 00 00 00 E2 14 00 00
00000020  84 95 00 00 78 9C ...                              78 9C = zlib stream
```
Decoded: count=0x328 (808); tocOffset=0x00F6CDAB (~16.17 MB, near EOF); then (2, 0x332F)(2, 0x14E2)(0x9584).

### v0005 — `D:\SWG Infinity\...\mtg_planets.tre` (135,424,016 B)
```
00000000  45 45 52 54 35 30 30 30 00 0D 00 00 DA 57 10 08   EERT5000
00000010  02 00 00 00 E1 C5 00 00 02 00 00 00 55 7A 00 00
00000020  01 7E 02 00 CD AB 00 00 01 04 00 00 00 03 00 00
```

### v0006 — `D:\SWG Restoration\SwgRestoration_00.tre` (1,516,877 B)
```
00000000  45 45 52 54 36 30 30 30 4E 01 00 00 60 F3 16 00   EERT6000N...
00000010  02 00 00 00 09 13 00 00 02 00 00 00 04 0A 00 00
00000020  CE 3D 00 00 00 00 00 00 00 00 00 00 00 00 00 00
```
Decoded: count=0x14E (334); tocOffset=0x0016F360 (~1.50 MB, near EOF); then (2, 0x1309)(2, 0x0A04)(0x3DCE).

## Cross-version observation (hypothesis — to confirm against TreeFile.cpp source)
v0005 and v0006 share the **same header field layout** in these samples; only the version token
differs. Recurring `02 00 00 00` at +0x10/+0x18 = compressor code **2 (zlib)** applied to the TOC
block and the name block respectively. The real v0005-vs-v0006 difference is NOT in the header here
— it is deeper (TOC record format / CRC / field widths). **Codex (CONSULT-01) must resolve exactly
what the loader branches on between versions.** Do not assume the layouts are fully identical.
