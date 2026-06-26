---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: verifying
stopped_at: Phase 03 context gathered
last_updated: "2026-06-26T14:30:00.939Z"
last_activity: 2026-06-26
progress:
  total_phases: 9
  completed_phases: 4
  total_plans: 21
  completed_plans: 21
  percent: 100
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-06-23)

**Core value:** One tool that takes a modder from raw idea to deployed, in-game-verified SWG mod without leaving the app — and without restarting the client to see a change.
**Current focus:** Phase 03 — live-injection-foundation

## Current Position

Phase: 03 (live-injection-foundation) — EXECUTING
Plan: 7 of 7
Status: Phase complete — ready for verification
        Residual lighting/gloss fidelity deferred → backlog export-lighting-fidelity, VIEW-MAT-FIDELITY.
Next: Phase 03 (not yet planned) — run /gsd:plan-phase 03 when ready.
Last activity: 2026-06-26

Progress: [██████████] 100%

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
| Phase 03-live-injection-foundation P01 | 12 | 3 tasks | 22 files |
| Phase 03-live-injection-foundation P02 | 20 | 2 tasks | 6 files |
| Phase 03-live-injection-foundation P03 | 4 | 2 tasks | 4 files |
| Phase 03-live-injection-foundation P04 | 13m | 2 tasks | 7 files |
| Phase 03 P05 | 9 | 2 tasks | 2 files |
| Phase 03-live-injection-foundation P06b | 305 | 2 tasks | 3 files |

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
- [Phase 03, Plan 01]: vitest workspace:* invalid for root devDeps; use hoisted vitest with local vitest.config.ts per package (pnpm CWD issue)
- [Phase 03, Plan 01]: Test files use .test.ts extension (project convention) not .spec.ts as plan spec'd
- [Phase 03, Plan 01]: TRANSFORM.length=48 locked by passing test from day 1 (channel-layout.test.ts sanity check)
- [Phase 03, Plan 01]: x86 MSVC toolset PRESENT: VS 2022 (17.14) + VS 2026 (18.6) both have VC.Tools.x86.x64; agent build unblocked
- [Phase 03, Plan 02]: resolver test utilities inline in inject_binding.cpp (x64 host avoids x86 agent cross-arch CMake linkage)
- [Phase 03, Plan 02]: 2 UNVERIFIED legacy gaps documented — g_runningFlags + getNetworkId have no SWGEmu RVA (Utinni game.cpp:74-82, object.cpp:176-189); advertised-only; legacy fallback cited
- [Phase 03, Plan 02]: rva_table.cpp uses (void**)&typed_fn_ptr binding pattern matching Utinni endpoints_bindings.cpp
- [Phase 02, Plan 02]: resolveEntry native contract = {winner, tombstone, archiveIndex, entryIndex} — NO `found` field. A hit = winner!==null && !tombstone. (Resolver had checked nonexistent .found → everything bucketed missing.)
- [Phase 02, Plan 02]: TRE entries cross the bridge as ONE columnar ArrayBuffer (getMountEntriesColumnar, built off-thread), decoded in JS — NOT 250k Napi::Objects. Native mount of full 27-archive/244k-entry set ≈ 835ms.
- [Phase 02, Plan 02]: VfsTree MUST be virtualized (ROW_HEIGHT=30, OVERSCAN=8) — unvirtualized render of 244k rows was the real >1min hang, NOT native. Same lesson as HexInspector.
- [Phase 02, Plan 02]: .lod = FORM DTLA (DetailAppearanceTemplate), DISTINCT from MLOD/.lmg. parseDetailAppearance lands it; resolver follows .apt→.lod→mesh. LODs ordered HIGHEST-detail-first so selectedLod=0 = l0 (DTLA stores them far-descending = lowest first).
- [Phase ?]: Vitest tests use TS port of C++ predicates
- [Phase ?]: x86 struct packing for LiveState layout
- [Phase ?]: DataView for unaligned BigInt64 in channel tests
- [Phase 03]: channel.h created to share LiveState struct between channel.cpp and agent_main.cpp without redefinition (Rule 2 — missing critical infrastructure) — C++ has no way to share a struct across TUs without a header; channel.h is the correct fix
- [Phase 03]: extern const for k_mainLoopCounter_addr in rva_table.cpp — C++ const at namespace scope has internal linkage by default; extern needed for cross-TU access — Link error LNK2019 on k_mainLoopCounter_addr; static → const → extern const fixed it
- [Phase 03]: UnmapViewOfFile only in ArrayBuffer finalizer in channel_binding.cpp — cleanupChannel only Reset()s the Napi::Reference and closes hMap; OS implicit reference keeps view valid until GC — Pitfall 5 design: finalizer owns view lifetime; CloseHandle(hMap) is safe before GC because OS holds implicit reference while view is open
- [Phase 03, Plan 05]: WOW64_CONTEXT/Wow64GetThreadContext for ASLR base (Ebx+0x08) + EIP spin-poll — host addon is x64; SWG client is x86 under WOW64; standard CONTEXT on x64 lacks Ebx/Eip (has Rbx/Rip); Wow64GetThreadContext is the correct x64-to-x86 API — compiler C2039 on Ebx/Eip triggered the fix
- [Phase 03, Plan 05]: DONT_RESOLVE_DLL_REFERENCES for x86 agent DLL export probe from x64 host — avoids running x86 DllMain in x64 process; GetProcAddress still resolves agent_init export offset from PE table
- [Phase ?]: D-03-06b-A: attachBtnStyle full-width variant (not 22x22 actionBtnStyle) for text attach buttons
- [Phase ?]: D-03-06b-B: STATE 1 form hidden during 'connecting' state to prevent duplicate attach submits
- [Phase ?]: D-03-06b-C: app.isPackaged via try/catch in renderer renderer — false fallback keeps dev path; phase 3 dev-only
- [Phase 03, UAT 2026-06-26]: CORRECTS two false cross-arch assumptions found in first live UAT —
  (1) classicDllInject used HOST x64 LoadLibraryA VA (comment "kernel32 same base" is false across
  arch); (2) "[Plan 05] DONT_RESOLVE_DLL_REFERENCES export probe from x64 host" is FALSE — x86 DLL
  can't load as image in x64 host (ERROR_BAD_EXE_FORMAT). Fix: resolve BOTH LoadLibraryA and
  agent_init in the TARGET via TH32CS_SNAPMODULE32 + target export-table walk (getRemoteModuleBase /
  getRemoteProcAddress in inject_binding.cpp). /MT agent change was NOT the fix (agent loads fine in
  x86; kept as hygiene).
- [Phase 03, UAT 2026-06-26]: 03-06b-UAT advertised path PASSED via attach to in-world
  swg-client-v2 — seqlock ~30fps, no torn reads, liveness=0x1, real networkId, templateName
  object/creature/player/shared_sullustan_male.iff, transform tracked real movement (~4.86m + ~80deg
  yaw). LIVE-01/02/04 green.
- [Phase 03, UAT 2026-06-26]: 03-06b-UAT LEGACY SWGEmu path PASSED via attach to in-world SWGEmu
  build 0.0.119.798 (RVAs confirmed valid by maintainer — Utinni reads this build). Two MORE fixes,
  both in OUR code not the RVAs: (1) networkId sentinel made not-applicable when getNetworkId slot is
  null — it was an advertised-only field hard-gating EVERY legacy write (agent_main.cpp results[1]);
  (2) re-inject must use a UNIQUELY-NAMED agent copy — LoadLibraryA matches an already-resident module
  by name and returns stale code, so a rebuilt same-named DLL silently runs the OLD agent. transform +
  template + liveness flow; networkId=0 on legacy (Phase-5 x86 64-bit return convention). Movement
  tracked (~9.6m + ~78deg yaw).
- [Phase 03, FOLLOW-UPS from UAT]: (a) HOST should inject a per-inject uniquely-named copy of the
  agent (mirror the harness) so re-attach loads fresh code + avoids file-lock on rebuild; (b) agent
  accumulates one poll thread per attach — Phase 5 stop-signal should unload/clean; (c) legacy
  networkId 64-bit read deferred to Phase 5.

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

Last session: 2026-06-26T14:29:46.503Z
Stopped at: Phase 03 context gathered
Resume file: None
