---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: phase-complete
stopped_at: Phase 2 complete (VIEW-01..04 ✓); next = Phase 03 (not yet planned)
last_updated: "2026-06-25"
last_activity: 2026-06-25 -- 02-05 glTF export + Extract human-verified & approved; 4 export bugs fixed via crew (CONSULT-P2-05B); Phase 2 COMPLETE
progress:
  total_phases: 9
  completed_phases: 3
  total_plans: 14
  completed_plans: 14
  percent: 100
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-06-23)

**Core value:** One tool that takes a modder from raw idea to deployed, in-game-verified SWG mod without leaving the app — and without restarting the client to see a change.
**Current focus:** Phase 02 COMPLETE — next: Phase 03 (planning not yet started)

## Current Position

Phase: 02 (3d-mesh-viewport-mvp-proof) — ✅ COMPLETE (all 5 plans; VIEW-01..04 ✓)
Plan: 5 of 5 done — 02-05 glTF export + Extract human-verified & approved 2026-06-25
Status: Phase 2 closed. Export ships glTF (.glb) rigged+animated+textured + raw Extract.
        Residual lighting/gloss fidelity deferred → backlog export-lighting-fidelity, VIEW-MAT-FIDELITY.
Next: Phase 03 (not yet planned) — run /gsd:plan-phase 03 when ready.
Last activity: 2026-06-25 -- Phase 2 complete; 4 export bugs found+fixed via crew round (CONSULT-P2-05B)

Progress: [██████████] Phase 2 done (3/9 phases complete)

### 02-03 key facts (crew-verified)

- ~6 native-binding↔contract field-shape mismatches shipped silently this phase (resolveEntry.found,
  LOD order, shader slotTag, DDS format, uvs-array, env-mask). → native-contract-conformance-test (HIGH)
  is a prerequisite-quality item before 02-04 adds the .ans binding.

- protocol_droid_red: red is BAKED in the diffuse (sat 0.44 maroon); material=white, no texfactor,
  no vertex color, SSHT not CSHD. Env reflection is highlight-gated (not flat wash). Remaining SIE
  gap = lighting/tone (presentation, not bytes) → backlog VIEW-MAT-FIDELITY.

## Performance Metrics

**Velocity:**

- Total plans completed: 8
- Average duration: — min
- Total execution time: 0 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 00 | 4 | - | - |
| 01 | 4 | - | - |

**Recent Trend:**

- Last 5 plans: —
- Trend: —

*Updated after each plan completion*
| Phase 00-toolchain-de-risk-app-shell P01 | 45 | 3 tasks | 20 files |
| Phase 00-toolchain-de-risk-app-shell P01 | 12 | 4 tasks | 25 files |
| Phase 00-toolchain-de-risk-app-shell P02 | continuation | 5 tasks | 9 files |
| Phase 00-toolchain-de-risk-app-shell P00-03 | 90 | 5 tasks | 13 files |
| Phase 00 P04 | single-session | 3 tasks | 21 files |
| Phase 01 P01-01 | 90 | 3 tasks | 40 files |
| Phase 01 P01-02 | ~4h (2 sessions) | 2 tasks (Task 3 pending) | 20 files |
| Phase 01-core-engine-iff-tre-verification-harness P03 | 2sessions | 2 tasks | 17 files |
| Phase 01 P04 | 120 | 2 tasks | 12 files |
| Phase 02-3d-mesh-viewport-mvp-proof P01 | 3h | 3 tasks | 27 files |
| Phase 02-3d-mesh-viewport-mvp-proof P02 | 240 | 2 tasks | 21 files |

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Roadmap-shaping decisions affecting current work:

- [Roadmap]: Hard dependency chain 0 -> 1 -> 2 (no mesh without TRE without IFF) is non-negotiable; it is the spine.
- [Roadmap]: Live-injection (Phase 3) and Blender bridge (Phase 6) branch off EARLY and stay OFF the critical path — never serialize the differentiator behind the format tower.
- [Roadmap]: The byte-exact verification harness is a Phase 1 keystone that recurs as a standing gate in every format phase (2, 5, 6, 7) — budget the round-trip tax per phase.
- [Roadmap]: Electron security + COOP/COEP cross-origin isolation + `contracts/` are front-loaded into Phase 0 (cheap before features accrete, HIGH recovery cost after).
- [Phase ?]: D-WORKSPACE: pnpm workspace with @electron/rebuild overridden to ^4.0.0 via pnpm-workspace.yaml overrides
- [Phase ?]: D-TSCONFIG: tsconfig.base.json uses baseUrl+ignoreDeprecations:6.0 for TypeScript 6 path aliases
- [Phase ?]: Prevents Forge from pulling breaking v5+
- [Phase ?]: TypeScript 6 deprecates paths-without-baseUrl; override silences it
- [Phase ?]: check-prereqs.js emits WARN not error; FND-02 unblocked on Node 24
- [Phase ?]: Single --napi prebuild is ABI-stable across Node AND Electron; no separate Electron-ABI build required
- [Phase ?]: cmake-js generator pinned to 'Visual Studio 17 2022' + x64 to work around cmake-js 8.0.0 mis-detecting VS2026
- [Phase ?]: FND-02 non-circular proof: build/ moved aside, __resolvedPath asserted; full no-compiler-machine proof deferred to CI runner
- [Phase ?]: Built against Node v24.15.0 headers; compile-against-Electron-42-headers check deferred to Plan 05 packaged gate
- [Phase ?]: PATH B: StatusBar uses in-process native addon for SAB proof (no utility IPC)
- [Phase ?]: Single owner: StatusBar sets window.__sabValue/__sabIsShared/__crossWriteOk/__zeroCopy
- [Phase ?]: Aria labels: conditional JSX branches for grep-able Collapse/Expand panel labels
- [Phase 01]: D-02: C++20 unified across swg_core static lib and native addon binding
- [Phase 01]: D-09: TRE fixtures synthesized from Utinni byte recipes — never copy Utinni .expected.json goldens
- [Phase 01]: D-10: Real TRE archives gitignored; copy-real-fixtures.js is read-only and never mutates originals
- [Phase 01]: D-12: Field-order arbiter test (tre-fieldorder-arbiter) is CI-BLOCKING — MUST be green before Plan 01 is done
- [Phase 01, Plan 02]: Same-priority tie-break: SECOND-mounted equal-priority archive wins (verified by test from TreeFile.cpp:294-296 code-vs-comment ambiguity)
- [Phase 01, Plan 02]: resolveChain is OUR algorithm — client doesn't expose chains; invariant: chain.winner === resolve.winner for non-tombstone
- [Phase 01, Plan 02]: v6000 enumerate-only (encrypted); v0006 is readable — warn chip ONLY on v6000 rows, NOT v0006
- [Phase 01, Plan 02]: Search returns matched indices only (T-01-06 mitigation — never ship full name list per keystroke)
- [Phase 01, Plan 02]: TreVfsBrowser archive.version and isEnumerateOnly default to 'v0005'/false — needs native version accessor in minor follow-up
- [Phase 01, Plan 03]: Gapped-FORM round-trips verbatim via clean-span-verbatim guarantee; capturedSlice spans full declared length (proven by gapped-form fixture)
- [Phase 01, Plan 03]: IFF trailing-bytes node is toolkit invention (NOT ported from client); client calculateRawDataSize assumes trailing data is zeroed
- [Phase 01, Plan 03]: IFF pad rule: write NO pad (IffWriter.cs:141); read DETECTS/TOLERATES a single 0x00 only when actually present (IffReader.cs:307-327)
- [Phase 01, Plan 03]: HexInspector fully virtualized — ResizeObserver + manual scrollTop state + OVERSCAN=5; only visible rows in DOM
- [Phase 01, Plan 03]: OPEN-3 RESOLVED — LIST and CAT  (trailing space) are containers; PROP is leaf (confirmed vs. swg-client-v2 Iff.cpp + Utinni IffReader)
- [Phase 02, Plan 02 — VERIFIED via human-verify + SIE reference + io_scene_swg_msh cross-check]:
- [Phase 02, Plan 02]: Mesh geometry verified byte-identical to io_scene_swg_msh (protocol_droid_red_l0: verts/tris/bbox match to 6 decimals). SWG display needs a PURE ROTATION, not a mirror (io_scene_swg_msh imports Scale(1) @ axis_conversion). Viewport default-facing-axis polish → folded into Plan 02-03.
- [Phase 02, Plan 02]: resolveEntry native contract = {winner, tombstone, archiveIndex, entryIndex} — NO `found` field. A hit = winner!==null && !tombstone. (Resolver had checked nonexistent .found → everything bucketed missing.)
- [Phase 02, Plan 02]: TRE entries cross the bridge as ONE columnar ArrayBuffer (getMountEntriesColumnar, built off-thread), decoded in JS — NOT 250k Napi::Objects. Native mount of full 27-archive/244k-entry set ≈ 835ms.
- [Phase 02, Plan 02]: VfsTree MUST be virtualized (ROW_HEIGHT=30, OVERSCAN=8) — unvirtualized render of 244k rows was the real >1min hang, NOT native. Same lesson as HexInspector.
- [Phase 02, Plan 02]: .lod = FORM DTLA (DetailAppearanceTemplate), DISTINCT from MLOD/.lmg. parseDetailAppearance lands it; resolver follows .apt→.lod→mesh. LODs ordered HIGHEST-detail-first so selectedLod=0 = l0 (DTLA stores them far-descending = lowest first).

### Pending Todos

- tre-mount-perf-marshalling (DONE — columnar bridge + VfsTree virtualization)
- statusbar-mesh-name-stale (low — bottom bar mesh name/verts doesn't update per load)
- viewport-default-facing-axis (low — default yaw vs SIE; fold into 02-03; pure rotation not mirror)

### Blockers/Concerns

- [Standing risk]: Every binary format layout in `docs/` is an AI-proposed hypothesis (rated LOW—VERIFY). No parser merges without a cited `swg-client-v2` source + byte-exact round-trip on a real asset.
- [Phase 3/5]: Live-injection pointer/offset discovery is per-client-build and effort-unbounded — mine Utinni, use runtime AOB resolution; treat magnitude as a planning unknown.
- [Phase 2]: Mesh/appearance binary layouts (.msh/.mgn/.apt/.sat) in `docs/` are AI-proposed — verify against `swg-client-v2` + real asset bytes before the parser merges (the standing round-trip gate applies).

## Deferred Items

Items acknowledged and carried forward from previous milestone close:

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| *(none)* | | | |

## Session Continuity

Last session: 2026-06-25T23:21:27Z
Stopped at: 02-05 Task 3 checkpoint:human-verify (gate="blocking") — glTF export + docs human verification
Resume file: .planning/phases/02-3d-mesh-viewport-mvp-proof/02-05-SUMMARY.md
