---
phase: 03
slug: live-injection-foundation
status: planned
nyquist_compliant: true
wave_0_complete: false
created: 2026-06-25
updated: 2026-06-25
---

# Phase 03 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Derived from `03-RESEARCH.md` § Validation Architecture. The injection/live-memory
> module has a clean seam: `resolve()` + the 4 sentinel predicates are Win32-free and
> unit-testable against a synthetic hook table / captured byte fixtures with zero live
> client; only the irreducible launch+inject+read needs manual UAT on a real client.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.1.9 (TS/JS — pure logic, contracts, channel layout, mocked handle lifecycle); native C++ compiles checked by cmake --build (no separate GoogleTest target in this phase) |
| **Config file** | `packages/live-inject/package.json` `scripts.test: vitest run` |
| **Quick run command** | `pnpm --filter @swg/live-inject test` |
| **Full suite command** | `pnpm -r test` |
| **Estimated runtime** | ~8 seconds (unit tests only; no live client) |

---

## Sampling Rate

- **After every task commit:** Run `pnpm --filter @swg/live-inject test`
- **After every plan wave:** Run `pnpm -r test` (full vitest)
- **Before `/gsd:verify-work`:** Full suite must be green + manual UAT checklist signed
- **Max feedback latency:** ~10 seconds (unit run)

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 03-01-01 | 01 | 1 | LIVE-01/02/04/05 | T-03-SC | No new packages installed | build | `pnpm install --frozen-lockfile` | ❌ W0 | ⬜ pending |
| 03-01-02 | 01 | 1 | LIVE-01/02/04/05 | T-03-SC | TRANSFORM.length===48 (not 64) sanity locked | unit | `pnpm --filter @swg/live-inject test` | ❌ W0 | ⬜ pending |
| 03-02-01 | 02 | 2 | LIVE-01/02 | T-03-03/04 | lookupByName never nulls a slot; resolveFromExe strict no-op on absent export | unit | `pnpm --filter @swg/live-inject test` | ❌ W0 | ⬜ pending |
| 03-02-02 | 02 | 2 | LIVE-02 | T-03-04 | legacy RVA literals verified; 2 UNVERIFIED gaps resolved or bounded | unit | `pnpm --filter @swg/live-inject test` | ❌ W0 | ⬜ pending |
| 03-03-01 | 03 | 2 | LIVE-02 | T-03-04/06 | all 4 sentinels pass/fail correctly; allSentinelsPassed is AND of all 4 | unit | `pnpm --filter @swg/live-inject test` | ❌ W0 | ⬜ pending |
| 03-03-02 | 03 | 2 | LIVE-02 | T-03-03 | seqlock: seq odd during write, even after; round-trip identical | unit | `pnpm --filter @swg/live-inject test` | ❌ W0 | ⬜ pending |
| 03-04-01 | 04 | 3 | LIVE-01/02 | T-03-02 | DllMain does only DisableThreadLibraryCalls | build | `cmake --build packages/live-inject/agent/build-agent` | ❌ W0 | ⬜ pending |
| 03-04-02 | 04 | 3 | LIVE-01/05 | T-03-05 | OpenProcess ACCESS_DENIED → structured file-patch error (no auto-escalate) | unit (mock) | `pnpm --filter @swg/live-inject test` | ❌ W0 | ⬜ pending |
| 03-05-01 | 05 | 4 | LIVE-01 | T-03-01 | identity check (ProductName == SWG) before inject | build | `pnpm --filter @swg/live-inject build` | ❌ W0 | ⬜ pending |
| 03-05-02 | 05 | 4 | LIVE-01 | T-03-02 | both FlushInstructionCache calls present; ASLR from EBX+0x08 | build | `pnpm --filter @swg/live-inject build` | ❌ W0 | ⬜ pending |
| 03-06-01 | 06 | 5 | LIVE-04/05 | T-03-05 | liveStore actions correct; ● Live / ○ File-patch visible in StatusBar; ROADMAP SC-2 corrected | build | `pnpm --filter @swg/renderer build` | ❌ W0 | ⬜ pending |
| 03-06-02 | 06 | 5 | LIVE-04/05 | T-03-04/06 | LiveInspectorPanel all 3 states render; HexInspector present; no write path | build | `pnpm --filter @swg/renderer build` | ❌ W0 | ⬜ pending |
| 03-06b-01 | 06b | 6 | LIVE-04/05 | T-03-05/06 | useLiveService routes addon promise to liveStore; useChannelReader seqlock protocol present | build | `pnpm --filter @swg/renderer build` | ❌ W0 | ⬜ pending |
| 03-06b-02 | 06b | 6 | LIVE-04 | T-03-01/06 | attach trigger UI in STATE 1; useChannelReader called unconditionally; read-verify only | build | `pnpm --filter @swg/renderer build` | ❌ W0 | ⬜ pending |
| 03-06b-UAT | 06b | 6 | LIVE-01/02/04/05 | T-03-01/05/06 | real client UAT (both advertised + legacy); file-patch fallback | manual UAT | (checklist in 03-06b-PLAN.md) | N/A | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [x] `packages/live-inject/test/resolve.spec.ts` — RED stubs for name-keyed resolve unit tests (Plan 03-01 Task 2)
- [x] `packages/live-inject/test/sentinels.spec.ts` — RED stubs for 4-sentinel predicate tests (Plan 03-01 Task 2)
- [x] `packages/live-inject/test/channel-layout.spec.ts` — LIVE_CHANNEL_LAYOUT sanity (TRANSFORM=48 PASSES day 1) + seqlock round-trip RED stub (Plan 03-01 Task 2)
- [x] `packages/live-inject/test/handle.spec.ts` — RED stubs for OpenProcess handle lifecycle (Plan 03-01 Task 2)
- [ ] Captured byte fixtures in `packages/harness/fixtures-real/live/`: sane 48-byte transform (Float32Array), networkId sample, `object/...` template-name string — capture from a real client during Plan 03-02/03-03 execution; placeholder `.gitkeep` created in Plan 03-01
- [ ] Manual-UAT checklist signed (LIVE-01/02/04/05 on both advertised and legacy clients) — gate for Plan 03-06 checkpoint

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Launch-and-inject into advertised (SwgClient_r.exe) client; HUD shows read-verified state; resolved endpoint count ~97 (NOT ~40) | LIVE-01, LIVE-02, LIVE-04 | Requires real running x86 SWG client + the advertised build | Plan 03-06 checkpoint step 1-4 |
| Attach-to-already-running client (late inject); static-init race handled by agent calling GetEngineHookPoints() | LIVE-01 | Real client + live CRT timing | Plan 03-06 checkpoint step 5 |
| Legacy SWGEmu client: RVA-table path attaches and shows transform/templateName | LIVE-01, LIVE-02 | Requires SWGEmu client build | Plan 03-06 checkpoint step 6 |
| Not-elevated / wrong-integrity: ○ File-patch shown with reason; all format editing still works | LIVE-05 | Requires a real elevation-failure scenario | Plan 03-06 checkpoint step 7 |
| Read-verify refuses to proceed (agent loop: sentinels fail → no channelWrite) | LIVE-02 | Real client memory state with an invalid object | Covered by the sentinels unit tests for the algorithm; behavioral confirmation in UAT step 1-2 |
| Raw hex view (HexInspector) in LiveInspectorPanel shows region bytes | LIVE-04 | Visual/functional verification | Plan 03-06 checkpoint step 8 |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references (test stubs created in Plan 03-01)
- [x] No watch-mode flags
- [x] Feedback latency < 10s (unit run)
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** pending (requires Plan 03-06 manual UAT sign-off)
