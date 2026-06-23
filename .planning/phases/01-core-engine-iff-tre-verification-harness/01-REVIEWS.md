---
phase: 1
reviewers: [codex, cursor, opus, sonnet]
reviewed_at: 2026-06-22
plans_reviewed: [01-01-PLAN.md, 01-02-PLAN.md, 01-03-PLAN.md, 01-04-PLAN.md]
method: de-anchored cross-AI crew (CLAUDE.md protocol) — four reviewers, four non-overlapping angles, neutral evidence, independent source reads
---

# Cross-AI Plan Review — Phase 1 (Core Engine — IFF + TRE + Verification Harness)

Four independent reviewers, each on a distinct lens (citations / byte-layout+wiring / spec-math /
plan-structure), each handed neutral evidence and the real ground-truth sources. The strong signal
is **convergence-from-divergence**: two reviewers reading the same Utinni/client source on different
assignments independently reached the same correction.

---

## Codex Review — angle: ground-truth citation verification

**Summary:** Citation integrity is **mixed**. Retail v0005 and IFF citations mostly point at real
loader/writer code, but several high-impact claims overextend those citations to v0006/v6000,
CRC-first field order, enumerate-only behavior, tie ordering, and trailing bytes. Most serious: the
plans cite sources that **directly contradict** the claimed TRE version/stride/CRC-first matrix.

**Verified (real) citations:** `TreeFile_SearchNode.h:166-197` (Header + 6-field CRC-first TOC),
`TreeFile_SearchNode.cpp:360-408` (CRC binary search, `_stricmp` tie-break, `length==0`→deleted),
`TreeFile.cpp:437-461` (first-match-wins, stop on deleted), `TreeFile.cpp:511-601` (fixUpFileName),
`tre_reader.py:33-43` (36-byte `<4s4s7I` header), `Iff.cpp:508-555` (ntohl), `Iff.cpp:637-644,1144`
(FORM length includes subtype), `Iff.cpp:1076-1095` (FORM-only discriminator), `IffWriter.cs:98-187`
(hybrid clean-slice re-emit, no pad), `IffReader.cs:150-158,174-195` (FourCC reject, 64MB cap),
`TreeFileBuilder.cpp:558-833` (payload→TOC→name→MD5→header-rewrite), `TreWriter.cs:166-174`
(untouched records copy raw verbatim).

**Concerns:**
- **HIGH** — `TreVersion.cs:60-105` cited as "CRC-first all versions" table, but the code says
  `RecordStride(V6000)?32:24` and `IsCrcFirst(v) => V6000 || V5000`; it explicitly treats
  **v0004/v0005/v0006 as size-first**. Contradicts the plans' "CRC-first for ALL versions" + "v0006 stride 32".
- **HIGH** — `TreeFile_SearchNode.cpp:226-349` cited for full TRE parse, but the constructor switch
  only handles `TAG_0004`/`TAG_0005`; it does **not** implement v0006/v5000/v6000. Retail client
  ground truth is v0004/v0005 only.
- **HIGH** — `TreeFile_SearchNode.h:166-197` cited for "compressor code 1 = raw deflate," but the
  client enum is `CT_deprecated` at 1 and `isCompressed()` **fatals** on it (`:211-214`). Raw-deflate
  handling is Utinni-derived (`TreFile.cs:671-674`), not client-derived.
- **HIGH** — `Iff.cpp:63-84` cited for "surface trailing bytes as explicit node," but the code only
  computes raw IFF size and says trailing non-IFF data must be zeroed — it does **not** surface or
  preserve a trailing-bytes node. The node is a **new toolkit behavior, not ported**.
- **MEDIUM** — `TreeFile.cpp:285-308` tie-break: comment says insert-after-equal, but
  `std::lower_bound(priority > …)` inserts **before** the first equivalent. Verify with a test.
- **MEDIUM** — IFF pad: "NO PAD EVER" is wrong; source = "write no pad; **read tolerates** a detected pad" (`IffReader.cs:307-327`).
- **MEDIUM** — zlib "level 6" citation points at the wrong line; level comes from
  `ZlibCompressor.cpp:169` (`deflateInit(…, Z_DEFAULT_COMPRESSION)`), not the builder.
- **MEDIUM** — v0006 enumerate-only warn chip has no clean citation; Utinni says only **v6000** is
  enumerate-only, `tre_reader.py` groups 0006/5000 with encrypted — **sources disagree**, needs arbitration before UI labels.

**Risk: HIGH (citation integrity).** Several highest-impact binary-layout claims contradict their
cited source or are extrapolated beyond what the source implements. The TRE version/field-order
matrix needs explicit correction before implementation.

---

## Cursor Review — angle: byte-layout truth + native wiring

**Summary:** Mostly correct for the primary **v0005 retail path + IFF + builder + native wiring**,
but the plans **over-lock TRE TOC layout** in ways that **contradict Utinni's live dispatch** and
**conflate `0006` with `6000`**.

**Strengths (confirmed correct):** TRE 36-byte header / `EERT` / forward version; v0005 CRC-first
24-byte TOC + flat name block; builder block order + MD5 + double header write
(`TreeFileBuilder.cpp:773-813`); IFF BE, FORM-includes-subtype, no-pad write, trailing surfacing;
**C++20 unification is wired correctly and low-risk to the Phase-0 SAB targets**; AsyncWorker +
Reference + zero-copy contract is coherent; compressor code-1 raw-deflate matches Utinni.

**Concerns:**
- **HIGH** — "CRC-first for ALL versions" contradicts Utinni's dual dispatch (`TreFile.cs:272-310`,
  `TreVersion.cs:97-104`): crc-first only for `5000/6000`; `0004/0005/0006` are size-first.
- **HIGH** — `0006` stride/layout wrong: Utinni `V0006`→24B size-first & **readable**; only
  `V6000`→32B crc-first. `tre_reader.py:138-145` puts 0006 in EXTENDED (32B) — a *third* layout.
- **HIGH** — v0006 treated as enumerate-only/encrypted in fixtures+UI, but only `6000` is encrypted
  per Utinni — and the plans **contradict themselves** (Task 2 says `isEnumerateOnly` true only for V6000).
- **MEDIUM** — `isCrcFirst(v)` not encoded explicitly in `TreVersion.h` despite RESEARCH sketching it;
  zlib code-2 framing follows Utinni strip-header, not the client's full-RFC1950 `inflateInit`;
  `Napi::Reference` wording imprecise for disk-path mounts; `find_package(ZLIB)` Windows fallback is
  a comment, not an executable path; IFF viewer extends containers to LIST/CAT/PROP beyond the client.

**Risk: MEDIUM, with a HIGH byte-layout tail on extended TRE variants.** Critical path (v0005,
IFF, C++20 bump, async) is low-risk; the elevated risk is freezing incorrect cross-version facts.
Recommended gate: run the field-order arbiter on a **real** Infinity/SWGEmu v0005 archive and
explicitly decide `v0006` vs `6000` from a real Restoration file — don't rely on the "all CRC-first" bullet.

---

## Opus Review — angle: spec/math (round-trip provability, override resolution, security caps)

**Summary:** Override-resolution and security caps are well-grounded against real source. But two
byte-identity claims are over-stated and one resolver semantic is the toolkit's invention.

**Strengths (verified against source):** tombstone first-match resolution (`TreeFile.cpp:456`,
`TreeFile_SearchNode.cpp:397-401`); priority sort highest-first; caps are overflow-safe in Utinni
(division form `count > Max/stride`, 64-bit-widened subtraction, `min(Max, declared)` + read-one-past
bomb check); no-pad quirk real; v6000 enumerate-only is the right call.

**Concerns:**
- **HIGH** — **TRE "self-built byte-identical" is not provable** without pinning the exact zlib build.
  Deflate output is only bit-stable for a fixed (zlib version, level, memLevel, strategy, wbits) tuple.
  The self-built test is **writer-vs-itself identity (proves nothing about retail)**; the **miniz
  fallback guarantees failure** for the write path. The achievable property is **retail-repack raw-slice
  identity** (copy untouched compressed slices verbatim, recompress only edits). Drop/caveat the
  "freshly compressed matches retail" claim; forbid miniz on the write path.
- **HIGH** — **IFF verbatim re-emit doesn't provably round-trip a file with a real pad byte / interior
  gap.** The trailing-bytes node only catches gaps after the *last top-level* block. Spec must state a
  **clean container re-emits its full declared byte span verbatim** (incl. interior padding); add a
  gapped-FORM fixture and decide explicitly reject-vs-roundtrip.
- **MEDIUM** — `resolveChain` shadow reporting is a **new algorithm, not a port** (client stops at first
  tombstone); under-specified when the winner is itself a tombstone; `ShadowChain` has no "winner is a
  deleted file" representation. Add 3-archive-tombstone-in-middle + tombstone-only fixtures and the
  invariant `resolveChain(name).winner === resolve(name)` for the non-tombstone case.
- **MEDIUM** — CRC-collision: binary search on equal-CRC run needs a guaranteed (crc, name) secondary
  sort or a full-run scan, else a tombstone can be missed. Add a forced-CRC-collision fixture.
- **MEDIUM** — bomb cap C++ port can **silently truncate** without the read-one-past-cap detection;
  eager `malloc(cap)` per record is an allocation-amplification DoS — require lazy/streaming growth + a
  global per-archive inflate budget.
- **LOW** — `nameOffset` `+1` bound; FORM declared-length > children-span legal case.

**Risk: MEDIUM.** No HIGH security hole — the caps are sound *if* the port keeps 64-bit widening and
the read-one-past-cap check (currently implicit). The HIGH tags are **provability over-claims** that
undermine the phase's central "byte-exact round-trip is the gate" guarantee if shipped as written.

---

## Sonnet Review — angle: plan structure / scope / goal-achievement

**Summary:** The four plans, in order, **do achieve the phase goal**. Wave chain is sound; every CORE-0x
traces to a task; the two human-verify checkpoints are well-placed. Scope (D-04 TRE builder pulled into
Phase 1) is correctly quarantined to the builder primitive. Residual risk is **execution, not design**.

**Concerns:**
- **HIGH** — **"UI never blocks" (CORE-06) is only partially proven.** The async test proves a Promise
  is returned, not that work is off-thread; a fast synchronous parse would pass it. Only the human
  checkpoint really proves it, and only if the human picks a genuinely large archive. Add an instrumented
  wall-clock guard.
- **HIGH** — **Plan 01 is very wide** (~26 files, 3 concerns) for one serial wave; a CMake/zlib/C++20
  issue stalls everything. The pure-TS harness (Task 1) has no C++ dependency and could ship
  independently before native work.
- **MEDIUM** — IFF is **over-serialized behind the TRE UI** (Plan 03 only needs Plan 02's file-select
  event; the native IFF lib could parallelize); committed v0005 fixture layout is an **assertion, not a
  measured result**, and the real-asset measurement **skips on a clean clone (no CI lane)**; **v6000
  entry-level UX** unspecified (what happens when a user clicks an encrypted entry); 100k-entry search
  latency not in acceptance criteria.
- **LOW** — Plan 04 `read_first` missing `01-03-SUMMARY.md`; Phase-4 DEPLOY-01 dedupe noted but not
  actioned; no multi-GB fixture as a regression gate.

**Risk: MEDIUM (execution risk).** Plan-01 width + un-instrumented async proof + IFF over-serialization
elevate above LOW; none are blockers.

---

## Consensus Summary

### Agreed Strengths (2+ reviewers)
- The **v0005 retail path, IFF parse/serialize, builder block order, C++20 unification + SAB regression
  guard, and the AsyncWorker/zero-copy architecture** are correctly grounded against real source
  (Codex, Cursor, Opus).
- The **harness-first / standing-gate design** and the **4-plan wave structure** are sound and achieve
  the goal (Sonnet, with Cursor/Opus confirming the per-task technical content).
- **Security caps are overflow-safe in the reference** and the threat models are real (Opus, Cursor).

### Agreed Concerns (highest priority — raised by 2+ reviewers)
1. **[HIGH · 3 reviewers] The TRE version/field-order matrix is over-locked and contradicts ground
   truth.** "CRC-first for ALL versions" and "v0006 = 32-byte = encrypted-like-6000" are contradicted
   by Utinni (`TreVersion.cs`/`TreFile.cs`), confirmed independently by **Codex** (citation) and
   **Cursor** (byte-layout), and flagged by **Sonnet** as an unverified assertion whose measurement
   skips on a clean checkout. The retail client (`swg-client-v2`) only implements v0004/v0005. The
   oracles genuinely **disagree** on v0006/v5000 (client: 0004/0005 only; Utinni: 0004/0005/0006
   size-first, 5000/6000 crc-first; `tre_reader.py`: 0006/5000/6000 extended 32B crc-first). The
   RESEARCH "Ground-Truth Reconciliation" ("3 oracles agree, CRC-first all") **overstated the
   consensus**. **This is the project's #1 risk (AI-distilled format vs. real bytes) materializing.**
2. **[HIGH/MEDIUM · 3 reviewers] zlib determinism undermines "self-built byte-identical."** Deflate is
   not bit-stable across zlib versions/builds; the miniz fallback can't reproduce zlib's output (Opus
   HIGH, Cursor MEDIUM, Codex MEDIUM on the mis-cited level). Real property = retail raw-slice identity.
3. **[HIGH · 2 reviewers] The IFF trailing-bytes node + "no pad ever" are toolkit inventions mislabeled
   as ported behavior** (Codex citation HIGH; Opus pad/interior-gap counterexample HIGH). Relabel and
   add a gapped-FORM fixture; clean containers must re-emit their full span verbatim.
4. **[HIGH · Sonnet, MEDIUM-adjacent · Cursor] v0006 vs v6000 conflation in fixtures + UI** — only
   `6000` is encrypted/enumerate-only; the warn chip and enumerate-only fixture target the wrong tag,
   and the per-entry encrypted UX is unspecified.

### Divergent Views (worth investigating)
- **Priority tie-break direction:** Opus "verified" the priority sort as correct/complete; **Codex**
  found the *code* (`std::lower_bound(priority > …)`) inserts **before** equivalents while the *comment*
  says after — a latent code-vs-comment ambiguity. Resolve with a small test, don't assume.
- **Plan-01 width / IFF parallelization:** Sonnet wants Plan 01 split and IFF parallelized; the other
  three reviewed it as acceptable-as-cohesive. This is a structure preference, not a correctness issue.

### Bottom line
The **plan structure is sound and the v0005/IFF critical path is well-grounded** — this is not a
from-scratch replan. But there is **strong, independent cross-AI convergence on real HIGH defects**
concentrated in the **TRE cross-version format matrix**, the **byte-identity provability claims**, and
**mislabeled toolkit-invented behavior** — exactly the fabrication class CLAUDE.md's de-anchoring
protocol targets. These should be corrected **before execution**, and the disputed format facts should
be **locked from a real asset hexdump (Wave-0 arbiter as a CI-blocking measurement), not from oracle
consensus.**

---

## Convergence Outcome — cycle 2 (2026-06-22)

The plans were revised (de-anchored, not re-anchored on a single oracle) and re-reviewed.

**Cycle-1 HIGH cluster → all RESOLVED:**
- TRE version/field-order matrix — de-locked to runtime `isCrcFirst(v)`/`recordStride(v)`/`isEnumerateOnly(v)` dispatch with an oracle-disagreement note; "CRC-first for all versions" marked FALSIFIED & BANNED; Wave-0 arbiter promoted to a CI-blocking real-asset measurement (hexdump the literal version tag, 0005 vs 6000).
- `0006` ≠ `6000` — enumerate-only/encrypted/32B/warn-chip scoped to `6000` only; `0006` readable; per-entry encrypted UX defined.
- TRE byte-identity — split into self-build determinism vs retail raw-slice identity; "freshly-compressed matches retail" dropped; miniz forbidden on the write path; zlib level cited correctly (`ZlibCompressor.cpp:169`).
- IFF trailing-bytes node + pad — relabelled toolkit-invention; "no pad ever" → "write none, read tolerates detected 0x00"; clean-container-emits-full-span guarantee + gapped-FORM fixture.
- CORE-06 "UI never blocks" — instrumented wall-clock acceptance gate added (not only the human checkpoint).
- MEDIUMs (resolveChain invariant, CRC-collision secondary sort, bomb-cap over-expansion detection + lazy growth + global budget + 64-bit widening, 100k search latency) — resolved with dedicated fixtures/tests.

**Cycle-2 verdicts (independent, on the revised plans):**
- Codex (citation): `CITATION_HIGHS_REMAINING: 0` — every cycle-1 HIGH resolved; two minor citation-range overclaims found and since corrected (`IffReader.cs:174-195`→`:149-158` for FourCC reject in 01-03; `TreFile.cs:649-679`→`:649-700` for the read-one-past in 01-01).
- Opus (spec/structure): `SPEC_HIGHS_REMAINING: 0` — all resolved with grep-able acceptance criteria; no new HIGH introduced.

**Orchestrator ground-truth fact-check (de-anchoring):** the load-bearing new citations were verified directly against real source — `Utinni/TreVersion.cs` (`IsEnumerateOnly=>V6000`, `RecordStride=>V6000?32:24`, `IsCrcFirst=>V6000||V5000`, V0006≠V6000) and `ZlibCompressor.cpp:169` (`deflateInit(&z, Z_DEFAULT_COMPRESSION)`) — both confirmed real, not replan-injected.

**Result: CONVERGED in 2 cycles. 0 HIGH concerns remaining.** Gates re-verified: requirements 6/6, decisions 12/12, all 4 plans structurally valid.

**Residual (LOW, non-blocking, accepted):** Plan-01 width + IFF-behind-TRE serialization (3/4 reviewers acceptable-as-cohesive); some self-vs-self "byte-identical" wording in 01-04 (internally consistent); the **v0006 field order remains arbiter-pending** (no real `0006` asset on hand — only Restoration `6000`) and is honestly routed to the Wave-0 real-asset gate rather than locked.
