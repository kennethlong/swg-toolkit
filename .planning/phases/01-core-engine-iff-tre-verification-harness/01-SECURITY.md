---
phase: 01
slug: core-engine-iff-tre-verification-harness
status: secured
threats_total: 21
threats_closed: 21
threats_open: 0
asvs_level: 2
block_on: HIGH+
created: 2026-06-23
audited: 2026-06-23
---

# SECURITY.md — Phase 1 (Core Engine + IFF/TRE Verification Harness)

**Audit type:** Declared-mitigation verification (register authored at plan time; no new-threat scan).
**ASVS level:** 2 · **block_on:** HIGH+
**Primary trust boundary:** untrusted `.tre` / `.iff` asset bytes parsed by native C++.
**Result:** ✅ **SECURED — 21/21 CLOSED, 0 OPEN.** (Initial pass found 1 OPEN/HIGH (T-01-03); fixed and re-verified during this audit.)

Implementation files were treated as READ-ONLY by the auditor. T-01-03's fix was applied by the maintainer's session and independently re-verified.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| Untrusted asset bytes → native C++ | `.tre` / `.iff` files (header, TOC, names, deflate payloads, IFF chunks) parsed by `swg_core` | Attacker-controllable binary; counts, offsets, lengths, FourCC tags, compressed streams |
| JS (renderer) → native addon | Path B `require('@swg/native-core')`; user-picked file paths via Electron dialog | File paths (user-selected), entry indices |
| Native worker → renderer | Extracted entry payloads, parse results | `ArrayBuffer` (binary stays binary) |

---

## Verdict table

| Threat ID | Category | Disposition | Status | Evidence (file:line) |
|-----------|----------|-------------|--------|----------------------|
| T-01-01 | DoS | mitigate | CLOSED | `TreArchive.cpp:167-170` division-form count cap `numberOfFiles > ZLIB_MAX_BLOCK/stride` before alloc |
| T-01-02 | Tamper/Info | mitigate | CLOSED | `TreArchive.cpp:174` (TOC `tocOffset+sizeOfTOC > streamLen`, uint64-widened) + `TreArchive.cpp:327` entry subtraction-form `offset > streamLen - readLen` |
| T-01-03 | DoS | mitigate | **CLOSED (fixed this audit)** | `Zlib.cpp:118-119` seed alloc bounded to `min(ceiling,64KiB)` (no eager `resize(cap)`); `:141-154` incremental doubling growth with `next_out` re-derived from fresh `output.data()`; `:145-150` decompression-bomb throw bounded by `ceiling ≤ 256MB` (`:115`,`:63`). Independently re-verified SECURED (adversarial: no oversized/unbounded alloc, no infinite loop, no overflow, no use-after-resize). |
| T-01-04 | Tamper | mitigate | CLOSED | `Zlib.cpp:80-89` RFC1950 header `(cmf*256+flg)%31==0` validation; clean throw on inflate failure |
| T-01-05 | Tamper | accept (enumerate-only) | CLOSED | `TreArchive.cpp:307-311` extractEntry refuses when `isEnumerateOnly`; `TreVersion.h:123-126` true for V6000 ONLY (v0006 readable) |
| T-01-06 | DoS | mitigate | CLOSED | `TreMount.cpp:269,316-321` search returns `{entryIndex,archiveIndex}` only; `VfsSearchField.tsx:40-43` 120ms debounce |
| T-01-07 | Tamper | mitigate | CLOSED | `TreArchive.cpp:294-297` tombstone (`length==0`) → `deleted=true`, returns -1, no OOB read |
| T-01-08 | DoS | mitigate | CLOSED | `tre_binding.cpp:554-563` (MountArchiveAsyncWorker::Execute) + `:653-664` (MountSearchableAsyncWorker::Execute) parse on libuv pool, off JS thread |
| T-01-09 | Info | accept | CLOSED | `FileInputStream.h:32` opens `std::ifstream` (read-only); no disk writes in renderer |
| T-01-10 | Tamper | mitigate | CLOSED | `Iff.cpp:187-197` rejects `declaredEnd > limit` (parent end for nested, uint64-safe) before recursing |
| T-01-11 | Tamper | mitigate | CLOSED | `Iff.cpp:127-139` validateFourCC rejects bytes outside 0x20–0x7E; applied to tag (`:169`) and subType (`:218`) |
| T-01-12 | DoS | mitigate | CLOSED | `Iff.cpp:121` 64MB `MAX_CHUNK_SIZE`; `:176-181` cap reject; `:191` bound vs remaining buffer |
| T-01-13 | Tamper | mitigate | CLOSED | `Iff.cpp:257-262` DETECT pad (consume 0x00 only when present); `:402` no pad on write; `:353-357` clean-span verbatim re-emit |
| T-01-14 | DoS | mitigate | CLOSED | `HexInspector.tsx` virtualized grid (only `startRow..endRow` + overscan in DOM) |
| T-01-15 | Tamper | mitigate | CLOSED | `TreBuilder.cpp:256-264` copies `rawCompressedSlice` verbatim for untouched entries; only edited recompress (`:269-288`) |
| T-01-16 | Repudiation | mitigate | CLOSED (note) | `TreBuilder.cpp:143-145` pinned `compress2(Z_DEFAULT_COMPRESSION)` (lvl6/wbits15/memLevel8); `:236-303` response-file payload order + crc/name TOC sort; MD5 block emitted (`:376-379`). NOTE: MD5 is **zeroed**, not a real digest — build-twice identity holds, but "MD5" in mitigation text implies a real content hash |
| T-01-17 | Tamper | accept (refuse) | CLOSED | `TreBuilder.cpp:204-209` build() throws for `isEnumerateOnly(V6000)`; `:400-404` repack() same |
| T-01-18 | Tamper | mitigate | CLOSED | `TreBuilder::repack` only calls `sourceStream.read()` (`TreBuilder.cpp:452`); `IInputStream`/`FileInputStream` are read-only — source never opened for writing |
| T-01-19 | Tamper | mitigate | CLOSED | `TreArchive.cpp:279-286` name tie-break scan across equal-CRC run; `TreBuilder.cpp:298-303` (crc,name) secondary sort |
| T-01-20 | Tamper | accept (refuse) | CLOSED | `tre_binding.cpp:493` (readMountEntry) + `:178` (readEntry) both route through `extractEntry` which refuses v6000 (`TreArchive.cpp:307`) |
| T-01-21 | Tamper | mitigate | CLOSED | `TreBuilder.cpp:58-60` `#ifdef MZ_VERSION → #error` miniz guard; `:44-46` zlib 1.2.3 version `#error` pin; write uses `compress2` (zlib) |

T-01-SC (supply-chain, in 01-01 / 01-04 plans, not in the 21-item register): no new registry packages this phase; zlib vendored at CMake level. Informational — CLOSED.

---

## Resolved during this audit — T-01-03 (DoS, HIGH)

**Declared mitigation (01-01-PLAN):** "Cap inflate output at `min(declaredUncompressed, 256MB)` with read-one-past-cap over-expansion detection; **LAZY/streaming output (no eager malloc(cap))**."

**Gap found (initial pass):** `Zlib.cpp` performed eager `output.reserve(cap); output.resize(cap)` (the old `:105-106`). Since `declaredUncomp` is a per-entry `int32` read straight from the TOC (`TreArchive.cpp:241,336`) with no per-entry size cap, a tiny compressed entry could declare `length = 256MB` and force a 256MB eager zero-fill allocation per `extractEntry`/TOC-inflate — an amplifiable, attacker-controlled memory DoS. Cap + over-expansion detection were present; only the lazy-allocation half was missing.

**Fix applied:** `treInflate` rewritten to grow the output buffer incrementally — seed `min(ceiling, 64KiB)`, double on `avail_out` exhaustion up to `ceiling`, throw the existing decompression-bomb error on hitting `ceiling`. `ceiling = (cap>0) ? cap : ZLIB_MAX_BLOCK`, hard-bounded ≤ 256MB. The buffer is now sized to bytes *actually produced*, never to the attacker-declared length. (`Zlib.cpp:101-182`.) File-header security comment updated to match.

**Verification:**
- Native addon rebuilt clean; **91/91 harness tests pass** (incl. compressed-entry round-trip + real-asset repack, which exercise the inflate path).
- Independent adversarial re-audit returned **## SECURED**: confirmed eager alloc gone, growth incremental & proportional, cap/bomb-throw preserved, and *no* new defect (no use-after-resize of `next_out`, no infinite loop, no integer overflow in the grow step). Could not construct any input forcing an oversized/unbounded allocation or a non-progressing loop.

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-01 | T-01-05 / T-01-17 / T-01-20 | v6000 archives are encrypted; the toolkit is **enumerate-only** for them by design (D-05) — never decrypt/extract/forge/write encrypted payloads. | Plan-time disposition | 2026-06-23 |
| AR-02 | T-01-09 | The TRE browser only **reads** user-selected files (Electron dialog); the renderer never writes to disk this phase. Reference-install paths surfaced in the picker are user-initiated. | Plan-time disposition | 2026-06-23 |

---

## Unregistered flags (from SUMMARY.md `## Threat Flags`)

All flags raised by the executor map to existing register threats — none unregistered:

| Flag (file) | Maps to | Note |
|-------------|---------|------|
| `new-native-file-read` (tre_binding.cpp, 01-01) | T-01-01 / T-01-02 | MountArchive opens arbitrary JS-supplied paths. Parse is cap-bounded. **Path validation is NOT enforced at the JS boundary.** Acceptable for a desktop tool where the user picks files; worth a registered threat if the mount path can ever originate from untrusted IPC/automation. Informational this phase. |
| `path-traversal` (TreBuilder.cpp fixUpFileName, 01-04) | T-01-18 area | `fixUpFileName` strips leading `../`/`./` for paths *inside* built archives. Informational; no new attack surface. |

---

## Notes for the next pass

- **T-01-16:** the zeroed MD5 block satisfies build-twice determinism but is not a real digest; if any future requirement asserts content-MD5 identity, this must change.
- **`new-native-file-read`:** consider a registered threat + JS-boundary path validation if mount paths ever become reachable from untrusted automation/IPC rather than only the user file picker.
- **Per-entry `e.length`:** no explicit per-entry sanity cap (only the global 256MB inflate ceiling bounds it). The ceiling fully mitigates the allocation DoS, but a tighter per-entry cap could be added if future phases surface large-archive heuristics.

---

## Audit Trail

### Security Audit 2026-06-23 (initial)
| Metric | Count |
|--------|-------|
| Threats in register | 21 |
| Closed | 20 |
| Open | 1 (T-01-03, HIGH) |

Verdict: OPEN_THREATS — blocked under `block_on: HIGH+`.

### Security Audit 2026-06-23 (re-verify after fix)
| Metric | Count |
|--------|-------|
| Threats in register | 21 |
| Closed | 21 |
| Open | 0 |

Verdict: **SECURED.** T-01-03 fix (incremental inflate) independently re-verified CLOSED. `threats_open: 0`.
