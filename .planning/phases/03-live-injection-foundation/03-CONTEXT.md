# Phase 3: Live-Injection Foundation - Context

**Gathered:** 2026-06-25
**Status:** Ready for planning

<domain>
## Phase Boundary

Build the Win32 live-injection module (depends only on Win32, **not** the format tower — parallel
track off the critical path). It must: launch or attach to a supported SWG client on Windows,
inject a SWG-Toolkit agent DLL, resolve engine entry points, **read-verify** an object's live memory
state before any write, surface that state in a HUD, and degrade gracefully to file-patch mode when
injection is unavailable. Delivers **LIVE-01, LIVE-02, LIVE-04, LIVE-05**.

**Phase 3 is READ-VERIFY ONLY.** The gizmo *write* (LIVE-03) and the 60 fps SAB write path are
Phase 5 — but Phase 3 deliberately builds the in-process agent DLL + shared-memory channel that
Phase 5 writes through (build the real home once).

**LOCKED by ground truth — do NOT re-derive:** see `03-GROUNDTRUTH-advertised-hooks.md` (read from
real source 2026-06-25). Resolution is **name-keyed `GetEngineHookPoints` table** (advertised client)
+ **known hardcoded RVAs** (legacy SWGEmu). **NOT AOB/signature scanning** — that is FALSIFIED for
both supported builds and OUT OF SCOPE. x86 target. `isAdvertisedClient()` is the detect/degrade gate.

</domain>

<decisions>
## Implementation Decisions

### Attach architecture (the big fork)
- **D-01:** Build **option (A) — our own injected agent DLL — now**, not the cross-process-read-only
  shortcut. Read-verify runs **in-process** inside our x86 agent DLL (it calls `getTransform_o2w`
  etc. directly in the client). Rationale: this IS the eventual Phase-5 home for the SAB write
  channel — build it once. (Option C, wrapping/loading `UtinniCore.dll`, is **OUT** — it drags in
  older lib dependencies. We **harvest Utinni's logic/idioms into our own code**, never load its DLL.)
- **D-02:** **Both entry paths are in Phase 3 scope:**
  1. **Launch-and-inject (primary)** — `CreateProcess(CREATE_SUSPENDED)`, resolve ASLR base via
     `PEB.ImageBaseAddress` (x86: suspended thread `EBX+0x08`; the advertised `SwgClient_r.exe` is
     `/DYNAMICBASE`), patch entry `EB FE` spin, classic DLL inject
     (`VirtualAllocEx`+`WriteProcessMemory`+`CreateRemoteThread(LoadLibraryA)`), named-event sync,
     restore entry, resume. (Utinni `Launcher/main.cpp` idiom — harvest it.) This path sidesteps the
     static-init "40/96 half-built table" race because we sync **after** the client CRT `_initterm`.
  2. **Attach-to-already-running (secondary)** — `OpenProcess` a live PID + **late-inject** the agent
     DLL via `CreateRemoteThread(LoadLibraryA)`. MUST handle the static-init race explicitly: always
     resolve via a **call to `GetEngineHookPoints()`** (never scrape the static array).
  This satisfies SC-1's literal "attach to a running client" wording for the user-already-launched case.

### Build coverage (resolver)
- **D-03:** **Prove BOTH supported builds in Phase 3:**
  - **Advertised client** (swg-client-v2, v0.9 primary): resolve via name-keyed `GetEngineHookPoints`.
  - **Legacy SWGEmu client**: **harvest the known hardcoded RVA literals from Utinni source** (e.g.
    `object.cpp: getTransform_o2w = 0x00B22C80`, `createObject = 0x00B2E760`), wire them as an
    RVA-table address source, attach + read-verify on the legacy client too.
  - `isAdvertisedClient()` (export present?) selects the path: present → name-keyed; absent → RVA table.
- **D-04 (SC-2 RESCOPE — flag for ROADMAP edit):** ROADMAP Phase 3 **SC-2** currently says the primary
  resolver is "signature/AOB scanning … build-hash-keyed … attaches on a *different* build." This is
  **FALSIFIED** and must be rewritten: the two fenced builds use deterministic address sources
  (name-keyed table / known RVAs); **no AOB scanning**. "Different build" = the two fenced builds,
  both proven. AOB/build-hash/unknown-build is a **future milestone**, out of Phase-3 scope.

### Read-verify gate (LIVE-02 / SC-3)
- **D-05:** A write is permitted only when **all four** sentinel checks pass (refuse otherwise):
  1. **Sane transform matrix** — `object::getTransform_o2w` → finite, ~orthonormal rotation,
     translation within world bounds.
  2. **Non-null networkId** — `object::getNetworkId` → plausible non-zero id.
  3. **Readable template name** — `object::getObjectTemplateName` → pointer derefs to sane ASCII
     `object/...` path.
  4. **Player/world liveness** — `game::getPlayer` non-null, `g_runningFlags`(`isOver`) false,
     `g_mainLoopCounter` advancing — client is actually in-world and looping.

### Agent ↔ toolkit communication
- **D-06:** Stand up the **SharedArrayBuffer / shared-memory region in Phase 3** as the agent→toolkit
  read-verify reporting channel — the **same** channel Phase 5 reuses for gizmo writes (agent DLL
  writes verified state → toolkit reads; Phase 5: toolkit writes → agent applies). Reuse the Phase-0
  SAB round-trip plumbing. (Build the real Phase-5 home once, consistent with D-01.)

### HUD scope (LIVE-04 / SC-4)
- **D-07:** Dockable live inspector surfaces the **read-verified object state** (networkId, template
  name, transform, in-world status) **and** a **raw memory/packet view** (hex/region viewer — SC-4
  wording is "memory/packet inspector"). The raw view is the heavier half; treat it as the Phase-3
  stretch but in scope.

### File-patch fallback (LIVE-05 / SC-5)
- **D-08:** When injection is unavailable (`isAdvertisedClient()` false / not elevated / no client):
  - The live panel shows a **clear disabled state with the reason**; **all format editing keeps
    working** (it never required injection).
  - Surface an **explicit, always-visible mode indicator** (● Live / ○ File-patch) + graceful
    not-elevated messaging (SC-1).

### Claude's Discretion / Planner decides
- **Native package layout:** LOCKED that the **agent DLL is a separate x86 build artifact** and the
  **host-side orchestration (CreateProcess/inject/RPM/WPM) is N-API**. The **package boundary**
  (new `live-inject` package vs. extending `native-core` + a separate agent-DLL target) is the
  **planner's call** against the existing monorepo.
- **Elevation/UAC strategy** (when admin is actually required for `PROCESS_VM_*` / `CreateRemoteThread`
  vs. same-integrity launch) — researcher/planner resolves; the graceful-degrade messaging (D-08) is
  the fixed UX contract.
- **Named-event naming, agent-DLL init entry, exact endpoint typedefs/calling conventions** —
  researcher harvests from Utinni source (see Open Research below).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase 3 ground truth (this repo — READ FIRST)
- `.planning/phases/03-live-injection-foundation/03-GROUNDTRUTH-advertised-hooks.md` — **LOCKED
  axioms.** The name-keyed advertisement contract, the inject/attach idiom, ASLR base via PEB, the
  static-init race + fix, legacy known-RVA literals, the SC-2 falsification, and the architecture fork.
  Do NOT contradict or re-derive.

### Provider side — advertised client (swg-client-v2)
- `D:/Code/swg-client-v2/src/game/client/application/SwgClient/src/shared/engine_hookpoints.h` —
  `EngineHookPoint{name,addr}` / `EngineHookPoints{version,count,entries}`; `ENGINE_HOOKPOINTS_VERSION 6`.
- `D:/Code/swg-client-v2/src/game/client/application/SwgClient/src/win32/engine_advertise.cpp` —
  export `GetEngineHookPoints()` (`:771-777`); lazy `ensureDynamicRowsFilled()` race fix (`:636-687`);
  32-bit guard (`:61`/`:779`).

### Consumer side + inject idiom (Utinni — HARVEST INTO OUR CODE, do not load the DLL)
- `D:/Code/Utinni/UtinniCore/swg/engine_hookpoints.h` — byte-identical shared contract copy.
- `D:/Code/Utinni/UtinniCore/swg/endpoints.h` / `endpoints.cpp` / `endpoints_bindings.cpp` —
  `resolveFromExe()` = `GetProcAddress(GetModuleHandleA(NULL), "GetEngineHookPoints")`; name-keyed
  resolve; `isAdvertisedClient()` / `installable()` gating; the read-verify endpoint typedefs
  (calling conventions — `__thiscall` emulated as `__fastcall`; detoured vs called vs virtual rows).
- `D:/Code/Utinni/Launcher/main.cpp` — attach/inject recipe; ASLR base via PEB (`:222-248`).
- **Legacy known-RVA literals (proven working — harvest, do not re-derive):**
  `D:/Code/Utinni/UtinniCore/swg/object/object.cpp` (`:43-146` — `getTransform_o2w=0x00B22C80`,
  `createObject=0x00B2E760`, `ctor=0x00B21B80`), `game/game.cpp`, `scene/world_snapshot.cpp`, etc.
  Typedefs carry the calling convention.

### Phase-0 plumbing to reuse (this repo)
- `docs/04-live-sync/live-memory-and-ipc.md` — the dual-channel IPC + SharedArrayBuffer design
  (incl. the ⚠ research-correction callout: handle unification, `PROCESS_VM_*` flags,
  `ArrayBuffer.Data()` GC lifetime when the SAB pointer is held in C++). **Verify its format claims
  against ground truth before trusting struct details** (AI-distilled doc).
- `packages/native-core/` — existing N-API addon pattern (`addon.cpp` + `*_binding.cpp`,
  `sab.cpp`/`sab-rw.cpp` SAB plumbing) to extend/mirror for the host-side inject orchestration.
- Phase-0 CONTEXT (`.planning/phases/00-toolchain-de-risk-app-shell/00-CONTEXT.md`) — Path B
  posture (addon in renderer), the in-process same-memory SAB round-trip proof (D-04 there).

### swg-client-v2 / Utinni planning context (background)
- swg-client-v2 `.planning/phases/37-…getenginehookpoints/`, `38-…advertised-client-coverage-completion/`
- Utinni `.planning/phases/24-client-entry-point-advertisement-getenginehookpoints/`

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **Phase-0 SAB plumbing** (`packages/native-core/src/sab.cpp` / `sab-rw.cpp`, the in-process
  same-memory round-trip proven in Plan 00-03) — reuse for the agent→toolkit channel (D-06).
- **native-core N-API pattern** (`addon.cpp` + `tre_binding.cpp`/`iff_binding.cpp`/`mesh_binding.cpp`/
  `anim_binding.cpp`) — the established host-addon binding shape to mirror for inject/RPM bindings.
- **Utinni source** — harvest the inject idiom, name-keyed resolve, endpoint typedefs, and legacy
  RVA literals directly (logic into our code; never load `UtinniCore.dll`).

### Established Patterns
- **Zero-copy binary across N-API** (project constraint) — live memory reads cross as
  ArrayBuffer/typed arrays, never JSON. Heavy work off the main thread.
- **Greenfield for Win32** — no `OpenProcess`/`RPM`/inject code exists yet (grep confirmed); Phase 3
  establishes it.
- **Two native artifacts** — host N-API addon (own arch, WOW64 x64→x86 ok) + injected agent DLL
  (**must be x86** to match the client). This is a new build-target shape for the monorepo.

### Integration Points
- `contracts/` package — add the live-inject IPC message shapes, SAB layout for verified state, and
  the engine-endpoint name catalog (typed end-to-end, per the Phase-0 discipline).
- The dockable shell (Phase 0) — the HUD panel docks into the existing DockviewReact workspace.
- Status bar — owns the ● Live / ○ File-patch mode indicator (D-08).

</code_context>

<specifics>
## Specific Ideas

- **Build the real home once** drove the two biggest calls: in-process agent DLL (D-01) + SAB channel
  now (D-06), rather than a throwaway cross-process read-only shim — because Phase 5's write path
  lives in exactly that DLL + channel.
- **Harvest, don't wrap.** The maintainer explicitly wants Utinni's *code* duplicated into our own
  module, NOT a runtime dependency on `UtinniCore.dll` (older-lib baggage).
- **Maximum-coverage Phase 3:** both entry paths (launch + attach-to-running) and both fenced builds
  (advertised + legacy RVA) are proven here, not deferred.

</specifics>

<deferred>
## Deferred Ideas

- **LIVE-03 gizmo write / 60 fps SAB write path** — Phase 5. Phase 3 builds the DLL + SAB channel it
  will use, but writes (and the GC-pressure soak / dangling-pointer guard) are Phase 5.
- **AOB / signature scanning + build-hash keying + unknown/third-build attach** — explicitly OUT of
  this milestone (GROUNDTRUTH scope fence). A future milestone, not Phase 3.
- **x64 client support** — the advertised export is 32-bit-only (`#if !defined(_WIN64)`); x64 is
  deferred upstream and here.
- **ROADMAP SC-2 rewrite** — D-04 flags the falsified AOB wording; apply the roadmap edit when
  Phase 3 is planned/executed (not a code task — a doc correction).

</deferred>

---

*Phase: 3-Live-Injection Foundation*
*Context gathered: 2026-06-25*
