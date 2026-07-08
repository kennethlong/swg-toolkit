---
phase: 5
slug: wysiwyg-live-sync-typed-editors
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-07-08
reconciled: 2026-07-08
---

# Phase 5 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Detailed test map lives in `05-RESEARCH.md` § Validation Architecture — the planner
> materializes per-task `<automated>` blocks from that map + the Per-Task Verification Map below.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (renderer/TS) + native C++ round-trip harness (CORE-05 precedent) |
| **Config file** | per-package `vitest.config.ts` (hoisted vitest — see Phase 03 P01 note); native gtest/CTest under `packages/native-core` |
| **Quick run command** | `pnpm -w test` (changed-package scope) |
| **Full suite command** | `pnpm -w test && pnpm --filter native-core test` (JS + native round-trip gates) |
| **Estimated runtime** | ~60–120 seconds |

---

## Sampling Rate

- **After every task commit:** Run `pnpm -w test` (quick, changed scope)
- **After every plan wave:** Run the full suite (JS + native round-trip gates)
- **Before `/gsd:verify-work`:** Full suite must be green, incl. DTII + STF byte-exact round-trip gates
- **Max feedback latency:** ~120 seconds

---

## Per-Task Verification Map

> Reconciled against the finalized 12-plan PLAN set (2026-07-08 revision). Every task carries a
> concrete `<automated>` command in its own `<verify>` block — this table maps requirement intent to
> the plan/task that discharges it, it does not restate every command verbatim.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 05-DTII-synthetic | 05-02 Task 3 | 1 | DATA-01 | T-05-10/T-05-11 | synthetic 9-type fixture round-trips byte-exact; DT_Comment rejected | native round-trip | `pnpm --filter @swg/harness test -- dtii-roundtrip registry-coverage` | ✅ planned | ⬜ pending execution |
| 05-DTII-real | 05-02 Task 4 | 1 | DATA-01 | T-05-10 | real extracted `.iff` datatable round-trips byte-exact (standing gate) — local/opt-in, skips cleanly when absent | native round-trip (local) | `pnpm --filter @swg/harness test -- dtii-roundtrip` (after `node scripts/extract-dtii-fixtures.cjs`) | ✅ planned | ⬜ pending execution |
| 05-STF-synthetic | 05-05 Task 3 | 2 | DATA-02 | T-05-12/T-05-13 | differing id/name-order synthetic fixture round-trips byte-exact; `sourceCrc` preserved verbatim | native round-trip | `pnpm --filter @swg/harness test -- stf-roundtrip registry-coverage` | ✅ planned | ⬜ pending execution |
| 05-STF-real | 05-05 Task 4 | 2 | DATA-02 | T-05-12 | real extracted `.stf` round-trips byte-exact, both sections + `sourceCrc` preserved (standing gate) — local/opt-in, skips cleanly when absent | native round-trip (local) | `pnpm --filter @swg/harness test -- stf-roundtrip` (after `node scripts/extract-stf-fixtures.cjs`) | ✅ planned | ⬜ pending execution |
| 05-LIVE-channel | 05-01 | 1 | LIVE-03 | — | command-slot layout offsets/sizes locked by test (`channel-layout.test.ts`) | unit | `pnpm --filter live-inject test -- channel-layout` | ✅ planned | ⬜ pending execution |
| 05-LIVE-guard | 05-01 | 1 | LIVE-03 | read-verify guard fails-closed | guard-blocked write refused, no setter call, no force-write path (`write-guard.test.ts`) | unit | `pnpm --filter live-inject test -- write-guard` | ✅ planned | ⬜ pending execution |
| 05-LIVE-writecmd | 05-04 | 2 | LIVE-03 | — | host-side `writeCommand` writes into the existing named mapping, no second `CreateFileMappingA` | unit | `pnpm --filter live-inject test -- channel-binding` | ✅ planned | ⬜ pending execution |
| 05-LIVE-soak | 05-12 | 6 | LIVE-03 SC1/SC2 | — | zero-alloc 60fps soak + in-world revert UAT | manual/soak (`checkpoint:human-verify`) | n/a — real injected client required | ✅ planned | ⬜ pending execution |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [x] DTII byte-exact round-trip fixture test — **synthetic (CI-enforced)** landed in 05-02 Task 3.
- [x] DTII byte-exact round-trip on a **real extracted `.iff`** (standing gate, two-layer pattern
      D-09/D-10 per Phase 1 precedent) — landed in 05-02 Task 4 (`fixtures-real/datatable/`,
      gitignored, local/opt-in; skips cleanly when absent, never silently substitutes for the
      synthetic CI gate).
- [x] STF byte-exact round-trip fixture test covering BOTH sections + `sourceCrc` preservation
      (D-10/D-11) — **synthetic (CI-enforced)** landed in 05-05 Task 3.
- [x] STF byte-exact round-trip on a **real extracted `.stf`** (standing gate) — landed in 05-05
      Task 4 (`fixtures-real/stf/`, gitignored, local/opt-in; skips cleanly when absent).
- [x] Live-write command-slot unit test: latest-wins semantics + zero-alloc assertion (D-02) —
      landed in 05-01 (`channel-layout.test.ts`) + 05-04 (host-side `writeCommand` binding).
- [x] Live-write read-verify guard test: byte-mismatch → write refused, no force affordance (D-03,
      SC #2) — landed in 05-01 (`write-guard.test.ts`).
- [x] GC-pressure soak test harness: native pointer survives GC without dangling (SC #1) — landed
      as the 05-12 `checkpoint:human-verify` (no automated substitute exists for a live GC-pressure
      soak against a real process, per 05-RESEARCH.md's own finding).

*Native round-trip harness (CORE-05) exists; DTII/STF fixtures + live-write test scaffolding are now*
*fully planned across 05-01/02/04/05/12 (see Per-Task Verification Map above). "Complete" here means*
*PLANNED with a concrete task + automated command — actual green runs happen during*
*`/gsd:execute-phase`, tracked per-task in the Status column above.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|--------------------|
| Drag gizmo → object moves in running client, zero restart | LIVE-03 SC #1 | Requires a live injected SWG client + human visual confirm | Attach to in-world client, drag Move/Rotate/Scale gizmo, confirm object moves/scales live on BOTH the advertised (swg-client-v2) and legacy (SWGEmu, RVA `setScale=0x00B23A10`) targets (D-09) |
| Bad live write reverted via changeset/snapshot | LIVE-03 SC #2 | Requires live client + human confirm of revert path | Force a byte mismatch, confirm write refused with real addr + expected/got; Revert-ALL restores attach-time transform |

*Live-injection behaviors (LIVE-03) are Windows-specific and per-client-build — the soak/zero-alloc parts are automated; the in-world visual confirm is a maintainer UAT gate (05-12).*

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies — every task across all 12 plans
      carries a concrete `<automated>` command; the sole exceptions are `05-12`'s
      `checkpoint:human-verify` in-world UAT tasks, which is the documented, no-automated-substitute
      exception (Manual-Only Verifications above).
- [x] Sampling continuity: no 3 consecutive tasks without automated verify — confirmed across the
      finalized plan set.
- [x] Wave 0 covers all MISSING references (DTII/STF synthetic AND real fixtures + live-write
      scaffolding) — the real-asset lane (Blocker 1 of the 2026-07-08 plan-check revision) is now
      operationalized as 05-02 Task 4 / 05-05 Task 4, matching the Phase 1 two-layer fixture pattern.
- [x] No watch-mode flags.
- [x] Feedback latency < 120s.
- [x] `nyquist_compliant: true` set in frontmatter.

**Approval:** approved — Wave 0 validation work is fully planned (see table above); `wave_0_complete`
stays `false` until the plans actually execute and the fixtures/tests run green, tracked per-task in
the Status column during `/gsd:execute-phase`.
