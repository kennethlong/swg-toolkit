---
id: eft-parser-completion
title: .eft parser — extract PTXM sampler→role map + activate byte-exact CORE-05 fixture
created: 2026-06-24
origin: Phase 02 03 — .eft effect parser landed but two pieces incomplete
severity: medium
area: native-core / harness
status: pending
---

## Context

The EFCT (.eft) parser landed in 02-03 (env-mask-spec relief). Verified working:
- Generic IFF byte-exact round-trip on the real `a_envmask_specmap.eft` (1858/1858) — confirmed
  manually.
- Blend state (alphaBlendEnable/src/dst, alphaTestEnable/ref/func, zWrite) extracts correctly per
  impl and drives material transparent/alphaTest/depthWrite.

## Two gaps (non-blocking for the env-reflection visual, but finish for completeness)

1. **`parseEffect` returns `samplers: []` for every impl** — the PTXM sampler→role mapping
   (idx0=MAIN, idx1=SPEC, idx2=ENVM for a_envmask_specmap) is NOT extracted. The renderer currently
   binds textures by `.sht` SLOT tag (ENVM→uEnvMap), so the env reflection works without it — but
   the sampler map is the authoritative role assignment and should be parsed. Fix: read
   `FORM PPSH → FORM 0001 → FORM PTXM (0002: int8 index, uint32 tag LE)` per
   ShaderImplementation.cpp:3145-3187. (For fixed-function impls, read STAG instead.)

2. **CORE-05 byte-exact `.eft` harness assertion is inactive** — the executor flagged that
   `fixtures-real/effect/a_envmask_specmap.eft` + the body `.sht` weren't extracted, so the hard
   round-trip test is skipped in CI. I verified byte-exactness manually this session; activate the
   fixture (copy-real-fixtures pattern) so CI enforces it going forward. Related:
   [[native-contract-conformance-test]].

## Severity

Medium — the visual feature works; these are parser-completeness + CI-enforcement gaps.
