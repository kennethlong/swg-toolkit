---
phase: 1
slug: core-engine-iff-tre-verification-harness
status: approved
nyquist_compliant: true
wave_0_complete: false
created: 2026-06-22
reviewed_at: 2026-06-22
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Derived from `01-RESEARCH.md` → Validation Architecture. The planner consumes this to
> attach `<automated>` verify commands to tasks (Dimension 8); gsd-nyquist-auditor audits coverage.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (Phase-0 pinned) + native unit tests via the harness linking the C++ lib headless |
| **Config file** | inherited from Phase 0 (vitest); add a harness project/config (`native-core` / `harness` project) |
| **Quick run command** | `pnpm vitest run --project native-core` |
| **Full suite command** | `pnpm vitest run` (+ opt-in `real-asset` lane when `fixtures-real/` is populated) |
| **Estimated runtime** | ~30 seconds (committed-fixture suite; real-asset lane longer, local-only) |

---

## Sampling Rate

- **After every task commit:** Run `pnpm vitest run --project native-core` (quick, touched project only)
- **After every plan wave:** Run `pnpm vitest run` (full committed-fixture suite must be green)
- **Before `/gsd:verify-work`:** Full suite + (locally) the `real-asset` lane green
- **Max feedback latency:** ~30 seconds (committed suite)

---

## Per-Task Verification Map

| Req ID | Behavior | Test Type | Automated Command | File Exists | Status |
|--------|----------|-----------|-------------------|-------------|--------|
| CORE-01 | Mount N archives; override/shadow resolution picks highest-priority non-tombstone | unit + integration | `pnpm vitest run -t "tre mount override"` | ❌ W0 | ⬜ pending |
| CORE-01 | Override matrix across Infinity + SWGEmu (D-12) from tre-compare cfgs | integration (real-asset) | `pnpm vitest run -t "override matrix"` | ❌ W0 | ⬜ pending |
| CORE-02 | Browse + substring/glob search returns expected entries | unit | `pnpm vitest run -t "tre search"` | ❌ W0 | ⬜ pending |
| CORE-03 | Parse synth + real IFF into a tree with correct tag/length/offset/kind | unit | `pnpm vitest run -t "iff parse"` | ❌ W0 | ⬜ pending |
| CORE-04 | `assertRoundTrip` byte-exact on every committed IFF fixture (incl odd-chunk-no-pad) | unit | `pnpm vitest run -t "iff roundtrip"` | ❌ W0 | ⬜ pending |
| CORE-04 | TRE self-built archive round-trips byte-identical; retail repack = per-record slice identity | unit + real-asset | `pnpm vitest run -t "tre roundtrip"` | ❌ W0 | ⬜ pending |
| CORE-05 | Fixture-registry sweep FAILS if a registered format lacks a round-trip case or loader-source citation | meta-test | `pnpm vitest run -t "registry coverage"` | ❌ W0 | ⬜ pending |
| CORE-06 | Heavy mount/parse runs off-main-thread; UI thread stays responsive; payload is zero-copy | integration | `pnpm vitest run -t "async worker zero-copy"` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Byte-exact + Override Coverage This Phase Must Prove (Dimension 8)

- **Byte-exact round-trip** on: every committed IFF fixture (synth nested, odd-chunk-no-pad, malformed-rejected-cleanly); every committed TRE fixture (v0005/v0006/v5000 read; v6000 enumerate-only; malformed rejected); AND at least one **real** Infinity + one **real** SWGEmu archive (opt-in lane).
- **Override matrix:** a path present in ≥2 mounted archives resolves to the highest-priority one; a `length==0` tombstone shadows lower archives; the resolved chain is reported to the UI. Driven by the tre-compare `verify-*.cfg` order.
- **Standing-gate self-test:** the registry sweep proves the gate itself is enforced (a format added without a fixture fails CI).

---

## Wave 0 Requirements

- [ ] `packages/harness/assertRoundTrip.ts` + `fixtureRegistry.ts` — CORE-05 mechanism
- [ ] `packages/harness/fixtures/` — regenerated committed synth fixtures (TRE v0005/0006/v6000 + IFF nested/odd-no-pad/malformed) with provenance notes
- [ ] `scripts/copy-real-fixtures` — gitignored copy of Infinity + SWGEmu archives to scratch (D-10)
- [ ] CMake zlib wiring in `modules/core/CMakeLists.txt`
- [ ] **OPEN-1 experiment:** real-asset field-order arbiter test (highest priority)
- [ ] contracts types: `tre.ts` (mount/entry/search), `iff.ts` (node tag/length/offset/kind)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| UI thread visibly stays responsive during multi-GB mount/parse | CORE-06 | Subjective "no freeze" perception is best confirmed by eye; automated proxy is the off-main-thread + zero-copy assertion above | Mount a real multi-GB archive from an installed client; confirm spinner animates and the tree stays interactive throughout |
| Real Infinity + SWGEmu archive round-trip (opt-in `real-asset` lane) | CORE-04 | Requires gitignored real client assets not present in CI | Populate `fixtures-real/`, run `pnpm vitest run` with the `real-asset` lane enabled locally |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
