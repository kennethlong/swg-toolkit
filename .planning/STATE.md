---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: executing
stopped_at: Phase 05.1 context gathered
last_updated: "2026-08-01T22:30:10.610Z"
last_activity: 2026-08-01 -- Phase 05.1 planning complete
progress:
  total_phases: 14
  completed_phases: 10
  total_plans: 100
  completed_plans: 85
  percent: 85
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-06-23)

**Core value:** One tool that takes a modder from raw idea to deployed, in-game-verified SWG mod without leaving the app — and without restarting the client to see a change.
**Current focus:** Productize the live world editor (off-roadmap continuation of the model-D pivot), then Phase 6 — Blender Bridge.

## Current Position

Phase: 6 (roadmap) — deferred behind the live-world-editor productize pass
Plan: Not started
Status: Ready to execute
        Phase 05 closed 2026-07-19 (12/12 plans + maintainer UAT). The 07-19→07-31
        off-roadmap pivot delivered model-D interior-decoration persistence END-TO-END,
        verified live 2026-07-30/31: hover-pick → Arm → gizmo move → Persist → .ilf edit +
        derived building template → wsSetNodeTemplateName rebind (code 0) → wsSaveSnapshot
        → byte-verified .ws → visible in-game (stock-path mirror on hybrid sessions) and in
        the offline editor scene (per-instance path). Three provider ships in one night
        (v25 getContainingBuildingId; save-on-load disarm; GroundScene authored-row-erase
        fix). Full story: .planning/handoff/2026-07-30-live-world-editor-decoration-persist.md.
Next: PRODUCTIZE the live world editor (sketch-first per AGENTS.md: real decoration-editor
      panel replacing the CONSULT-69 debug probe; rotation-persist confirm; add/remove
      decorations via wsAddObject; mirror-mode toggle). Then /gsd:plan-phase for Phase 6
      (Blender Bridge).
Last activity: 2026-08-01 -- Phase 05.1 planning complete
  05-08: DTII grid editor complete (SchemaRail, real Hex view, round-trip gate wiring,
  dockview tab opening). Caught + fixed a vi.mock('@swg/native-core', ...) false-negative
  test gotcha (bare require() of a native addon bypasses vi.mock; monkey-patch the real
  process-cached addon object instead — same fix already documented for @swg/live-inject).

Progress: [██████████] 99%

### 02-03 key facts (crew-verified)

- ~6 native-binding↔contract field-shape mismatches shipped silently this phase (resolveEntry.found,
  LOD order, shader slotTag, DDS format, uvs-array, env-mask). → native-contract-conformance-test (HIGH)
  is a prerequisite-quality item before 02-04 adds the .ans binding.

- protocol_droid_red: red is BAKED in the diffuse (sat 0.44 maroon); material=white, no texfactor,
  no vertex color, SSHT not CSHD. Env reflection is highlight-gated (not flat wash). Remaining SIE
  gap = lighting/tone (presentation, not bytes) → backlog VIEW-MAT-FIDELITY.

## Performance Metrics

**Velocity:**

- Total plans completed: 35
- Average duration: — min
- Total execution time: 0 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 00 | 4 | - | - |
| 01 | 4 | - | - |
| 04.4 | 15 | - | - |
| 05 | 12 | - | - |

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
| Phase 04.1 P01 | 7 | 2 tasks | 5 files |
| Phase 04.1-deploy-project-ux P02 | 2 sessions | 3 tasks | 7 files |
| Phase 04.1 P03 | 25 | 3 tasks | 7 files |
| Phase 04.1-deploy-project-ux P04 | 7 | 3 tasks | 5 files |
| Phase 04.1-deploy-project-ux P05 | 10 | 3 tasks | 4 files |
| Phase 04.1-deploy-project-ux P06 | 10 | 3 tasks | 4 files |
| Phase 04.1 P07 | 25 | 3 tasks | 7 files |
| Phase 04.1 P08 | 8 | 3 tasks | 9 files |
| Phase 04.1 P09 | 60 | 3 tasks | 6 files |
| Phase 04.1 P10 | 6 | 3 tasks | 11 files |
| Phase 04.3 P02 | 20 | 3 tasks | 10 files |
| Phase 04.3 P03 | 12 | 2 tasks | 9 files |
| Phase 04.3-versioning-and-searchtoc-mount P05 | 20 | 2 tasks | 4 files |
| Phase 04.3 P06 | 25 | 2 tasks | 3 files |
| Phase 04.3-versioning-and-searchtoc-mount P07 | 90 | 3 tasks | 7 files |
| Phase 04.3 P08 | 20 | 3 tasks | 10 files |
| Phase 04.3 P09 | 25 | 3 tasks | 11 files |
| Phase 04.3-versioning-and-searchtoc-mount P11 | 90 | 3 tasks | 12 files |
| Phase 04.4-ux-polish-deploy-hardening P01 | 25min | 3 tasks | 9 files |
| Phase 04.4-ux-polish-deploy-hardening P02 | ~15min | 3 tasks | 5 files |
| Phase 04.4 P03 | ~10min | 2 tasks | 3 files |
| Phase 04.4-ux-polish-deploy-hardening P05 | 55min | 3 tasks | 5 files |
| Phase 04.4-ux-polish-deploy-hardening P06 | ~45min | 2 tasks | 8 files |
| Phase 04.4-ux-polish-deploy-hardening P07 | ~20min | 3 tasks | 3 files |
| Phase 04.4-ux-polish-deploy-hardening P08 | ~40min | 2 tasks | 3 files |
| Phase 04.4 P09 | 65min | 3 tasks | 8 files |
| Phase 04.4 P10 | ~60min | 3 tasks | 9 files |
| Phase 04.4-ux-polish-deploy-hardening P11 | ~15min | 2 tasks | 7 files |
| Phase 04.4-ux-polish-deploy-hardening P12 | ~15min | 2 tasks tasks | 2 files files |
| Phase 04.4 P13 | ~3h | 2 tasks | 10 files |
| Phase 04.4-ux-polish-deploy-hardening P14 | 35min | 2 tasks | 2 files |
| Phase 04.4-ux-polish-deploy-hardening P04 | 35min | 3 tasks | 5 files |
| Phase 05 P01 | 20min | 2 tasks | 7 files |
| Phase 05-wysiwyg-live-sync-typed-editors P02 | 25min | 4 tasks | 8 files |
| Phase 05 P03 | 20min | 2 tasks | 7 files |
| Phase 05 P04 | ~7min | 1 tasks | 2 files |
| Phase 05 P05 | ~20min | 4 tasks | 8 files |
| Phase 05 P06 | ~20min | 3 tasks | 9 files |
| Phase 05 P07 | ~24min | 3 tasks | 11 files |
| Phase 05 P08 | single session | 3 tasks | 18 files |
| Phase 05 P09 | single session | 3 tasks | 9 files |
| Phase 05 P10 | ~13min | 2 tasks | 5 files |
| Phase 05-wysiwyg-live-sync-typed-editors P11 | ~37min | 3 tasks | 16 files |
| Phase 05 P12 | ~7min (Task 1 only) | 1 tasks | 2 files |

## Accumulated Context

### Roadmap Evolution

- Phase 04.1 inserted after Phase 4: Deploy & Project UX — redesign building approved sketches 005-B/006-D/007/008 (combined Deploy tab, project↔client binding front door, lazy/virtual shadow); emerged from Phase 4 in-client UAT (URGENT)
- Phase 04.2 inserted after Phase 4: Dev-Client Support & Loose-Override Deploy: detect client.cfg + mount searchTOC/searchPath + loose-override deploy mode for the dev/modder decoupled-client class (swg-client-v2) (URGENT)
- Phase 04.3 inserted after Phase 4.2: Versioning Model & SearchTOC Mount Completion — crew UI-vs-sketch gap review first, then version-navigation rework + searchTOC/v6000 master-index mount (bundles the two big queued UAT-blocking reworks) (URGENT)
- Phase 04.4 inserted after Phase 4.3: UX Polish & Deploy Hardening — 6 UI-related todos (delete-project-with-restore, e2e deploy-flow coverage, console/log tabs, statusbar mesh name, VFS override dim, viewport facing axis) (URGENT)

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

- [Phase 03, FOLLOW-UPS from UAT]: (a) DONE — host injects a per-inject uniquely-named copy via
  prepareAgentDllForInject() in useLiveService.ts (copies canonical agent DLL to
  %TEMP%/swg-toolkit-agent/agent-<unique>.dll, prunes unlocked priors, falls back to canonical on copy
  failure); both launchAndInjectUI + attachToRunningUI use it. (b) agent accumulates one poll thread
  per attach — Phase 5 stop-signal should unload/clean; (c) legacy networkId 64-bit read deferred to
  Phase 5; (d) DONE — closeChannel wired: useLiveService closeActiveChannel() closes the prior session's
  channel at the start of every attach (the leak actually bit on RE-ATTACH) and a new detachUI() export
  closes + resets the store. Verified live: after re-attach, prior mappingName readChannelView -> null
  (no leak); after detachUI, idle + null; node exit clean (this also fixed the open-channel teardown
  segfault). A detach/disconnect UI control to call detachUI() is still TODO (no such button exists yet).

- [Phase 03, UAT 2026-06-26]: APP-PATH validated — the REAL useLiveService.attachToRunningUI (transpiled
  via esbuild) against in-world swg-client-v2 (advertised, PID live) drove liveStore to
  {attached, mode:live, mappingName} and the channel streamed verified data (nid non-zero on advertised,
  shared_sullustan_male, Tatooine). Wiring fixes that made this possible (commit 35318ea): live-inject
  needed index.js entry + root-package dependency to be require()-able from the renderer (Path B).

- [Phase ?]: vi.mock intercepts ESM not CJS require()
- [Phase ?]: avoids A→B→A circular import with projectBinding
- [Phase ?]: DeployPanel: ONE surface (staging + splitter + history + CTA); dockview registration in plan 05; pathSafety.ts = M1 shared validator for plans 06+08
- [Phase ?]: LAYOUT_VERSION 1→2 for plan 05 panel-id swap (staging/changesets retired → deploy); further bumps follow the same constant
- [Phase ?]: onDidActivePanelChange (dockview 6.6.1) fires with no args; active panel read via api.activePanel in closure
- [Phase ?]: resetLayout exposed on window.__resetLayout for plan-08 wiring; not module export
- [Phase 04.1, Plan 06]: seedBaseline uses direct writeManifest (NOT sealVersion) — N4 zero-delta guard at sealVersion:225-230 throws on empty deltas; Baseline has no deltas by design (D-08)
- [Phase 04.1, Plan 06]: getStudioDir relocated to LOCALAPPDATA/swg-toolkit/studios/<sanitized-id> (D-06); space-in-path truncation for searchTree= values closed (Pitfall 1); basename-only+space→_ prevents path injection (T-04.1-13)
- [Phase 04.1, Plan 06]: openWorkspace: M2 non-destructive migration copies legacy <folderPath>/.studio to new LOCALAPPDATA path when new studioDir has no manifest; mandatory idempotent seedBaseline on every open (H2a); selectVersion(BASELINE_ID) H2c pristine fallback when node absent
- [Phase ?]: snapshotCfg idempotent + restoreCfg byte-pristine Reset (04.1-07)
- [Phase ?]: absolute-path default deploy model (D-05): writes absolute outputPath as searchTree value, no copy to Live required (04.1-07)
- [Phase ?]: handleReset H5: restoreCfg whole-file as primary; deactivatePatch/resetShadow fallback for pre-07 records lacking snapshotPath (04.1-07)
- [Phase ?]: 04.1-09-SUMMARY.md
- [Phase ?]: swg-source v6000 plain-zlib fixture confirmed at 26174 bytes offset in patch_sku3_24_client_00.tre; resolveFull RED test uses synthetic TOC (CI-safe)
- [Phase ?]: extractMountAt(handle, archiveIndex, descriptor) — container via archiveIndex not offset; plan 11 uses stubs without plan-10 wave dependency (checker W2 fix)
- [Phase ?]: Locked undo contract (04.4-01/10/14): Undo restores project bytes only, never re-deploys to the client
- [Phase ?]: Completion-marker trash protocol (round-3): entryDir/.complete.json written LAST, only after both directory renames succeed — startup purge only removes MARKED entries
- [Phase ?]: resetDeploymentFromRecord shared between DeployDialog.handleReset and deleteProject.ts (cleanupArtifacts opt-out) — never two parallel restore implementations
- [Phase 04.4-02]: installConsoleCapture() installed at ConsolePanel.tsx MODULE SCOPE (not useEffect) so capture starts at true app-boot via WorkspaceShell's static import chain, not first-tab-open
- [Phase 04.4-02]: resetConsoleCaptureForTests() test-only helper restores original console.* + removes window listeners + clears installed guard for cross-test-file isolation (round-2 fix)
- [Phase 04.4, Plan 03]: StatusBar chips subscribe directly to domain stores (viewportStore, changesetStore, dockStateStore, clientScanStore) rather than hold local/hardcoded placeholder state
- [Phase 04.4-05]: STAG version tag (0000/0001) is a direct leaf CHUNK inside FORM STAG, not a FORM wrapping DATA like PTXM; findChunk() is the correct lookup
- [Phase 04.4-05]: Fixed-function stage index = 0-based sibling position among FORM STAG children (no separate index field like PTXM's textureIndex)
- [Phase 04.4-05]: extract-effect-fixtures.cjs reads via readMountEntry(archiveIndex, entryIndex) directly off searchMount hits, not resolveEntry(path) -- searchMount hits carry no .path field
- [Phase 04.4-05]: Synthetic STAG fixture registered unconditionally into the same shader-efct format id so CORE-05 always has >=1 fixture in CI even without the real client-extracted asset
- [Phase 04.4-06]: Round-3 codec seam widened to TOC/name-block compression — codecForBlockCompressor is a separate lookup from codecForCompressor, keyed on the archive's own header fields, since the per-entry compressor code is unknown until the TOC is decoded
- [Phase 04.4-07]: Core3 server push: PATH CONTRACT locked (confDir = caller-resolved conf/ dir, never re-derived from serverConfig.path); RESET-RECORD-CLEAR CONTRACT locked (resetCore3TreOverride never clears serverPush.core3.json — 04.4-12's Reset handler does, explicitly, after reset)
- [Phase 04.4-07]: Verified Core3 TRE search-path mechanism against real ../Core3 source (ConfigManager.cpp, DataArchiveStore.cpp, TreeFileRecord.h, SortedVector.h, TreeFile.cpp); docs/05-server-integration/core3-parity.md updated, AI-proposed caveat scoped to exclude the new verified section
- [Phase 04.4-08]: swg-main server push: PATH CONTRACT locked (servercommonCfgPath = path.join(serverConfig.path, 'exe', 'shared', 'servercommon.cfg')); RESET-RECORD-CLEAR CONTRACT locked (resetSwgMainOverride never clears serverPush.swgmain.json, matching 04.4-07)
- [Phase 04.4-08]: CORRECTED swg-main/client shared TreeFile.cpp same-priority searchPathN tie-break: LAST-declared value wins (not earlier-declared as 04.4-RESEARCH.md ADDENDUM claimed) — falsified by re-deriving std::lower_bound/vector::insert on TreeFile.cpp:285-308/294-296, confirmed by existing test-pinned precedent (TreMount.h:13-20, tre-override.test.ts 'tre priority tie-break', Phase 01/Plan 02: SECOND-mounted wins)
- [Phase 04.4-09]: vite.main.config.ts/vite.preload.config.ts need explicit outDir/format/define/external-list fixes to work standalone (outside electron-forge) — CI's new build-before-E2E step invokes vite build directly, bypassing forge's own config injection (outDir, MAIN_WINDOW_VITE_* defines, Node-builtins external) — without these fixes the standalone build produced a crashing bundle
- [Phase 04.4]: Client label in DeleteProjectConfirmModal is derived best-effort (detectClients match, falling back to parent-folder basename) rather than adding a client-name field to CfgDeployRecord/LooseDeployRecord — Keeps the modal store-independent and avoids widening the contracts package for display-only text
- [Phase 04.4]: DeleteUndoToast detects restores generically by diffing the pending array rather than only reacting to its own Undo button — Makes the round-2 post-restore toast (element #17b) fire for BOTH Undo-from-toast and Restore-from-dimmed-row without coupling the two components
- [Phase 04.4-11]: main-log-forward subscription folded INSIDE installConsoleCapture()'s existing body (04.4-02 insertion point), guarded by process.env['VITEST'] -- no new exported function, no new call site
- [Phase 04.4-11]: one-time 'app ready' main-log line moved to win.webContents.once('did-finish-load', ...) instead of app.whenReady().then(...) to avoid a lost-first-log listener-attachment race
- [Phase 04.4-11]: syncLiveToVersion.ts is the sole reconcile-result Log-tab site (noop + apply paths) -- setLiveVersion not separately logged to avoid double-logging one reconcile as two entries
- [Phase 04.4-12]: VcsPanel Server Push: Tasks 1-2 combined into one commit (same contiguous UI block, not separable) — Task 1 (dispatch UI + rehydration) and Task 2 (handler wiring) modify the same Server Push section added in this plan
- [Phase 04.4-12]: activeVersionId/manifest reads happen directly in render/handler bodies via readManifest, not cached in separate state — Matches existing codebase convention (ProjectListDialog.versionCountFor, DeleteUndoToast.safeChangesetCount)
- [Phase 04.4]: Version-graph row select never silently reconciles/deploys — only the explicit Deploy dialog moves deployedVersionId — Ground-truth re-read of VersionHistoryBody.tsx superseded a stale plan assumption; corrected e2e spec assertions accordingly
- [Phase 04.4]: SWG_TEST_MODE gate reads process.argv (additionalArguments), never process.env — Chromium renderer child processes don't inherit full main-process env, and Vite's client-build stubs bare process.env to an empty object -- fixed both testHooks.ts and vite.main/renderer.config.ts
- [Phase 04.4-ux-polish-deploy-hardening]: Seeded an already-deployed project directly on disk for 06-delete-flow.spec.ts rather than re-driving the New-Project wizard — e2e/07-deploy-flow.spec.ts already covers the wizard/stage/save/Deploy path end-to-end; direct-disk seeding keeps the delete-flow spec focused on delete/undo
- [Phase 04.4-04, D-17 checkpoint]: SWG_ORIENTATION stays identity (0,0,0) — mesh was never wrong; residual SIE gap was camera-azimuth-only. Consciously supersedes D-16's 'rotation, not camera' mechanism claim with new maintainer-confirmed evidence; SC #5 satisfied by this characterization alone.
- [Phase 04.4-04]: Camera-default azimuth match (SIE parity) explicitly out-of-scope per plan's round-2 note, but requested directly by maintainer mid-checkpoint and shipped in-task (round-2 approved) — no follow-up todo needed
- [Phase 04.4-04]: Fixed OrbitControls-target framing bug found during D-17 UAT: useAutoFrame set camera.position/lookAt but never controls.target, so OrbitControls silently re-aimed at (0,0,0) on every update, centering SWG meshes' feet-origin and clipping the head — now retargets controls.target at bounds center
- [Phase 04.4-09]: vite.main.config.ts MAIN_WINDOW_* defines now scoped to non-forge builds only (forgeConfigSelf absence check) — the unconditional defines from 04.4-09 were clobbering forge's own dev-server URL injection and breaking every pnpm/npm start boot
- [Phase 05]: Command slot carries the full target state (transform + scale) every write, not a mode-tagged partial update
- [Phase 05]: applyWrite is declared in write.h (forward-declaring LiveCommand) but left undefined in 05-01 -- 05-03 completes it with the resolved setter fn pointers
- [Phase 05]: FOCUS_TOKEN inserted at offset 320 immediately after LIVENESS, inside the SAME seqlocked read-frame span as transform/networkId/templateName/liveness, shifting all command-region fields +4 bytes
- [Phase 05-02]: String cells are NUL-terminated (Iff::read_string), NOT length-prefixed as the plan's Interfaces section claimed -- verified against swg-client-v2 Iff.cpp:1539-1564 and the codebase's own ChunkView::readString precedent.
- [Phase 05-02]: Legacy FORM 0000's TYPE chunk is int32 DataType codes, a DIFFERENT wire shape than 0001's string TYPE chunk (DataTable.cpp:500-535) -- corrects the plan's 'same three-chunk shape' claim; serializeDataTable always emits canonical 0001.
- [Phase 05-02]: Real-fixture extraction uses listMountEntries() (real paths) not searchMount() (archiveIndex/entryIndex only, no .path per T-01-06); version-gated to '0001' since the serializer only emits canonical 0001.
- [Phase ?]: 05-03: setScale seeded nullptr, applied to legacy RVA only post-resolveFromExe confirming legacy build (BLOCKER fix A)
- [Phase ?]: 05-03: advertised focus resolution is a real two-step cuiHud::g_instance -> cuiHud::getTarget resolver, not a relabeled player fallback
- [Phase ?]: 05-03: no getScale/m_scale binding in rva_table.cpp -- scale-guard comparand is a per-build-gated member-offset read (kLegacyScaleOffset=0x44) owned by agent_main.cpp
- [Phase ?]: 05-03: guard-baseline re-key cross-checks templateName by CONTENT (strncmp against an owned copy), never by pointer -- closes agent-side pointer-ABA
- [Phase ?]: 05-03: MSVC C2712 (__try + magic-static dynamic initializer conflict) fixed by splitting static declaration from its dynamic assignment
- [Phase 05-04]: WriteCommand accepts either a Float32Array (honoring byteOffset) or a raw ArrayBuffer for transform/scale arguments — matches the plan's own Float32Array/ArrayBuffer acceptance-criteria phrasing without a second validation path
- [Phase 05-05]: Magic/two-section-order/sourceCrc interfaces verified correct on first read against swg-client-v2 ground truth -- no falsification found (unlike 05-02's two DTII corrections). — LocalizedStringTable.h/.cpp, LocalizedString.h/.cpp, LocalizedStringTableReaderWriter.cpp all confirm the plan's stated 0xABCD magic, id_type/crc_type=4 bytes, char16_t text encoding, and dual id-ascending/name-ascending section ordering.
- [Phase 05-05]: recomputeSourceCrcFromText regenerates its own CRC-32 table per-TU (same polynomial/algorithm as tre/Crc.cpp) rather than calling across the TU boundary; zero call sites in this plan (opt-in helper for a future 05-09 UI action, not the default save path).
- [Phase 05-05]: Real .stf VFS prefix confirmed as string/<locale>/ (e.g. string/en/aprilfools.stf) via an interactive mount+listMountEntries pass before writing extract-stf-fixtures.cjs -- 7906 real .stf entries found, extraction succeeded on the first candidate tried.
- [Phase 05-06]: GateBar's pass-state staged chip is a plain --color-info span, not a second VerificationStatus instance (avoids glyph collision with the chip copy's own leading arrow)
- [Phase 05-06]: dtiiTypeSpec.ts strengthens ground-truth getDelimStr to return null (not a garbage substring) when the closing delimiter is absent/precedes the opening one, so malformed specs like e(malformed degrade to unknown instead of a mis-parsed enum
- [Phase 05-06]: Schema rail, real Hex view, and GateBar/FailBanner live wiring to the native round-trip gate are 05-08's scope per this plan's objective; 05-06 ships static not-run/placeholder stand-ins only
- [Phase 05-07]: identityCache keys on the agent-published focusToken exclusively (never networkId/templateName); every cache HIT cross-checks templateName/networkId before restoring (evicts+recreates on mismatch); cache bounded to 64 entries via least-recently-active eviction
- [Phase 05-07]: vi.mock does NOT intercept a bare require() of a native addon in this project's vitest setup (confirmed for both @swg/live-inject and @swg/native-core) -- test pattern is: monkey-patch the real process-cached addon object, then dynamically import() the module under test
- [Phase 05-08]: STATIC_PANEL_IDS allowlist (WorkspaceShell.tsx) drives the reopen-closed-panel menu instead of Object.keys(panelComponents) -- keeps dynamic per-file editor tab components (e.g. datatable-grid-editor) out of the generic reopen menu, which assumes a fixed id and no required params
- [Phase 05-08]: @swg/native-core is a bare require() of a native addon -- vi.mock silently no-ops for it in this project's vitest setup; tests must monkey-patch the real process-cached addon object's methods instead (same fix already established for @swg/live-inject in useLiveService.test.ts)
- [Phase ?]: [Phase 05-09]: recomputeSourceCrcFromText declared in 05-05 but deliberately left unbound; 05-09 adds the N-API binding (its one intended caller, the per-row re-sync action) and rebuilds native-core
- [Phase ?]: [Phase 05-09]: .stf working-row model merges byId+nameToId into ONE row per string; both on-disk orderings (D-11) re-derived fresh at serialize time by sorting on id vs key, not tracked as two parallel arrays
- [Phase ?]: [Phase 05-09]: GateBar.tsx gained an optional note prop (right-aligned faint mono footer) for the .stf gate-bar footer note -- backward compatible, DTII omits it
- [Phase ?]: [Phase 05-09]: .stf double-click branch lives in TreVfsBrowser.handleOpenEditor (not VfsTree.tsx as the plan named) -- VfsTree.tsx has no native-core/dockview access, matching 05-08's established DTII pattern
- [Phase 05]: 05-10: Universal gizmo mode renders 3 stacked drei TransformControls (translate+rotate+scale) simultaneously attached to the same object -- drei 10.7.7 has no combined mode
- [Phase 05]: 05-10: TransformGizmo.tsx split into an R3F 3D component (default export) + a plain-DOM GizmoStatusLabel (named export, MissingDepsOverlay idiom) -- no R3F/WebGL test harness exists in this project, so the offline/target/scale-unavailable labels needed to live outside the Canvas-scoped component to stay testable
- [Phase 05]: 05-10: DatatableGridEditor's existing Grid|Hex toggle already carries role=radiogroup + role=radio/aria-checked (correct a11y pairing) -- no change made; StfStringsEditor has no Grid|Hex toggle at all
- [Phase 05-11]: recordWrite coalesces rapid in-drag writeLog appends (<500ms) into the current row instead of one entry per 60fps onChange tick
- [Phase 05-11]: Guard-blocked/StatusBar scale-precedence logic extracted to liveSyncGuardPrecedence.ts, shared by LiveSyncClientCard and StatusBar
- [Phase 05-11]: Gizmo mode lifted from Viewport.tsx local useState to gizmoModeStore.ts so StatusBar's mode segment shares the same source of truth
- [Phase 05-12]: Vitest 4 removed test.poolOptions; --expose-gc for the GC-pressure soak test is now a top-level test.execArgv option, not poolOptions.forks.execArgv

### Pending Todos

- tre-mount-perf-marshalling (DONE — columnar bridge + VfsTree virtualization)
- statusbar-mesh-name-stale (low — bottom bar mesh name/verts doesn't update per load)
- viewport-default-facing-axis (DONE 2026-07-04 — Phase 04.4-04, D-17: identity confirmed correct, camera-azimuth fix shipped, moved to todos/completed/)

### Blockers/Concerns

- [Standing risk]: Every binary format layout in `docs/` is an AI-proposed hypothesis (rated LOW—VERIFY). No parser merges without a cited `swg-client-v2` source + byte-exact round-trip on a real asset.
- [Phase 3/5]: Live-injection pointer/offset discovery is per-client-build and effort-unbounded — mine Utinni, use runtime AOB resolution; treat magnitude as a planning unknown.
- [Phase 2]: Mesh/appearance binary layouts (.msh/.mgn/.apt/.sat) in `docs/` are AI-proposed — verify against `swg-client-v2` + real asset bytes before the parser merges (the standing round-trip gate applies).
- e2e/04-workspace.spec.ts has 2 pre-existing failures (SidebarPanel title-update timing, Titlebar theme-select timeout) that will now surface in CI since 04.4-09 finally lets the lean job build+run E2E for real. Confirmed unrelated to 04.4-09 via A/B test. See deferred-items.md in 04.4 phase dir.
- 05-12 Task 2 (checkpoint:human-verify, gate=blocking): maintainer in-world UAT pending -- attach to real advertised (swg-client-v2) and legacy (SWGEmu) clients and step through 05-12-PLAN.md how-to-verify steps 1-8 (cross-build targeting, mismatch warning, guard fail-closed, coalesced Revert ALL, clean detach incl. null-player, despawn-retarget). LIVE-03 and Phase 05 (12/12 plans) do not close until approved.

### Quick Tasks Completed

| # | Description | Date | Commit | Directory |
|---|-------------|------|--------|-----------|
| 260703-bpu | Route DeployDialog deploys through syncLiveToVersion + re-wire Undo (todo deploy-dialog-synclive-undo-wiring) | 2026-07-03 | faf2acd | [260703-bpu-route-deploydialog-deploys-through-syncl](./quick/260703-bpu-route-deploydialog-deploys-through-syncl/) |

## Deferred Items

Items acknowledged and carried forward from previous milestone close:

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| *(none)* | | | |

## Session Continuity

Last session: 2026-08-01T01:35:45.176Z
Stopped at: Phase 05.1 context gathered
  Full renderer suite (59 files / 453 tests) green post-commit; tsc --noEmit clean. Two commits:
  83012d7 (SchemaRail + real Hex view + gate wiring), 0523aef (editorTabs.ts + VfsTree/
  TreVfsBrowser wiring + DatatablePanel retirement, LAYOUT_VERSION 3→4).
Next session: pick up 05-09 (.stf strings editor, DATA-02, sketch 018-A) — reuses
  editorTabs.openEditorTab and the shared GateBar/FailBanner unchanged per 05-08's readiness
  notes. Then 05-10/11/12 (viewport gizmo + live-sync HUD, LIVE-03).
Resume file: .planning/phases/05.1-live-world-editor-productization/05.1-CONTEXT.md
