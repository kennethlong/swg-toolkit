---
phase: 2
slug: 3d-mesh-viewport-mvp-proof
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-23
---

# Phase 2 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Anchored on the **CORE-05 byte-exact round-trip gate** (SC-5): every SWG-format parser
> registers a real-asset fixture + a cited `swg-client-v2` loader line; `registry-coverage`
> fails CI if any registered format lacks a fixture or citation. Typed decode is validated
> behaviorally ("renders correctly"). See `02-RESEARCH.md` → Validation Architecture.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest (bare-Node, over the ABI-stable `--napi` prebuild — same as Phase 1) |
| **Config file** | existing per-package vitest setup (`packages/harness`, `packages/native-core/test`) |
| **Quick run command** | `pnpm --filter @swg/harness test` |
| **Full suite command** | `pnpm -r test` |
| **Estimated runtime** | ~TBD seconds (set after Wave 0 lands fixtures) |

---

## Sampling Rate

- **After every task commit:** Run `pnpm --filter @swg/harness test` (the registered format's round-trip + sweep)
- **After every plan wave:** Run `pnpm -r test` (full suite — all parsers + render unit checks)
- **Before `/gsd:verify-work`:** Full suite green + each VIEW-0x behavioral signal demonstrated
- **Max feedback latency:** TBD seconds

---

## Per-Task Verification Map

> Filled by the planner / executor as tasks land. Each SWG-format parser task maps to a
> CORE-05 byte-exact round-trip; each VIEW-0x render task maps to a behavioral signal.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 2-XX-XX | XX | N | VIEW-0X | — | inherits Phase-1 IFF per-chunk size caps / bounds / FourCC validation | round-trip | `pnpm --filter @swg/harness test` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] Extract real per-format assets (`.msh`/`.mgn`/`.skt`/`.sat`/`.ans`/`.sht`/`.pal`/`.dds` + `.lmg`/`.ldt`) from a mounted client into gitignored `packages/harness/fixtures-real/` (via the Phase-1 TRE extractor; copies only, D-10)
- [ ] Register each new `FormatId` in `fixtureRegistry.ts` with parse/serialize round-trip (`serializeIff`) + cited `swg-client-v2` oracle line
- [ ] Install `three`/R3F/drei in `packages/renderer` (gated behind a `checkpoint:human-verify`)
- [ ] Add a CORE-06 zero-copy assertion for mesh geometry (mirror `tre-async-zerocopy.test.ts`)
- [ ] One-time enumeration script: tally `.ans` root tags (CKAT vs KFAT 0002/0003) across mounted TREs to confirm assumption A1

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Mesh renders + orbit camera works | VIEW-01 | GPU render output not unit-assertable | Open a real `.msh`/`.mgn`; confirm geometry visible and orbit works |
| Materials + live customization color-swap | VIEW-02 | Visual correctness + real-time uniform mutation | Apply `.dds`+`.pal`; move a color picker; confirm re-tint with zero per-frame allocation |
| Skeleton preview + `.ans` playback (no GC hitch) | VIEW-03 | Profiler-observed, not unit-assertable | Play `.ans`; profile `useFrame` for zero per-frame allocations |
| glTF / COLLADA export opens externally | VIEW-04 | Cross-tool fidelity (D-10) | Export rigged+animated; open in an external glTF viewer / DCC tool |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency target set
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
