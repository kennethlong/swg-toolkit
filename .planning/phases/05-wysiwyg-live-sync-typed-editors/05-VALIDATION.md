---
phase: 5
slug: wysiwyg-live-sync-typed-editors
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-07-08
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

> Skeleton — planner fills exact Task IDs per PLAN. Requirement→test intent is fixed here.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 05-DTII-* | DTII | — | DATA-01 | — | round-trip preserves unknown chunks | native round-trip | `pnpm --filter native-core test` | ❌ W0 | ⬜ pending |
| 05-STF-* | STF | — | DATA-02 | — | `sourceCrc` preserved verbatim on save (D-10) | native round-trip | `pnpm --filter native-core test` | ❌ W0 | ⬜ pending |
| 05-LIVE-* | live-write | — | LIVE-03 | read-verify guard fails-closed | zero-alloc 60fps path; guard refuses on byte mismatch | unit + soak | `pnpm --filter live-inject test` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] DTII byte-exact round-trip fixture test (real datatable `.iff` from a mounted TRE) — DATA-01
- [ ] STF byte-exact round-trip fixture test covering BOTH sections + `sourceCrc` preservation (D-10/D-11) — DATA-02
- [ ] Live-write command-slot unit test: latest-wins semantics + zero-alloc assertion (D-02) — LIVE-03
- [ ] Live-write read-verify guard test: byte-mismatch → write refused, no force affordance (D-03, SC #2) — LIVE-03
- [ ] GC-pressure soak test harness: native pointer survives GC without dangling (SC #1) — LIVE-03

*Native round-trip harness (CORE-05) exists; DTII/STF fixtures + live-write test scaffolding are new Wave-0 work.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Drag gizmo → object moves in running client, zero restart | LIVE-03 SC #1 | Requires a live injected SWG client + human visual confirm | Attach to in-world client, drag Move/Rotate/Scale gizmo, confirm object moves/scales live on BOTH the advertised (swg-client-v2) and legacy (SWGEmu, RVA `setScale=0x00B23A10`) targets (D-09) |
| Bad live write reverted via changeset/snapshot | LIVE-03 SC #2 | Requires live client + human confirm of revert path | Force a byte mismatch, confirm write refused with real addr + expected/got; Revert-ALL restores attach-time transform |

*Live-injection behaviors (LIVE-03) are Windows-specific and per-client-build — the soak/zero-alloc parts are automated; the in-world visual confirm is a maintainer UAT gate.*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references (DTII/STF fixtures + live-write scaffolding)
- [ ] No watch-mode flags
- [ ] Feedback latency < 120s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
