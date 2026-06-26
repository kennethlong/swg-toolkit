# Phase 3: Live-Injection Foundation - Research

**Researched:** 2026-06-25
**Domain:** Win32 process injection (x86), engine-entry-point resolution, cross-process shared memory, N-API orchestration
**Confidence:** HIGH for the inject recipe + endpoint typedefs + RVAs (read verbatim from real Utinni / swg-client-v2 source); MEDIUM for the cross-process SAB mechanism and package layout (synthesis from verified constraints); LOW/UNVERIFIED items explicitly tagged inline.

Every load-bearing claim below is tagged. `[VERIFIED: <file:line>]` = read from real client/Utinni source this session. `[CITED: <url>]` = official docs. `[ASSUMED]` = training/standard-Win32 knowledge needing confirmation. `[UNVERIFIED]` = a specific value/struct I could NOT confirm against source — planner must close before merge.

---

<user_constraints>
## User Constraints (from CONTEXT.md + GROUNDTRUTH)

### Locked Decisions (do NOT research alternatives)
- **D-01:** Build **our own injected x86 agent DLL now** (option A). Read-verify runs **in-process** inside the agent (it calls `getTransform_o2w` etc. directly). NOT the cross-process-read-only shortcut. Wrapping/loading `UtinniCore.dll` is OUT — **harvest Utinni's logic into our own code, never load its DLL.**
- **D-02:** Both entry paths in scope — (1) launch-and-inject (`CREATE_SUSPENDED` + PEB ASLR base + `EB FE` spin + classic inject + named-event sync), and (2) attach-to-already-running (`OpenProcess` + late `CreateRemoteThread(LoadLibraryA)`, must handle the static-init race by always calling `GetEngineHookPoints()`).
- **D-03:** Prove BOTH supported builds — advertised client (name-keyed `GetEngineHookPoints`) AND legacy SWGEmu (harvested known RVAs). `isAdvertisedClient()` selects the path.
- **D-04:** ROADMAP SC-2's "AOB/signature scanning" wording is **FALSIFIED** — flag for doc edit, do NOT plan to it. AOB/build-hash/unknown-build = future milestone, OUT.
- **D-05:** Write permitted only when **all four** sentinels pass: (1) sane transform, (2) non-null networkId, (3) readable `object/...` template name, (4) player/world liveness.
- **D-06:** Stand up the agent→toolkit shared-memory channel in Phase 3 — the same channel Phase 5 reuses. Reuse Phase-0 SAB plumbing for the JS-facing surface.
- **D-07:** Dockable inspector surfaces verified state AND a raw memory/region hex view (the heavier half — in scope, treat as stretch).
- **D-08:** When injection unavailable → disabled panel **with reason**; all format editing keeps working; always-visible ● Live / ○ File-patch indicator + not-elevated messaging.

### Claude's Discretion (research + recommend)
- Native package boundary (new `live-inject` package vs extend `native-core` + separate agent-DLL target).
- Elevation/UAC strategy (the graceful-degrade UX is fixed; the privilege path is open).
- Named-event naming, agent-DLL init entry, exact endpoint typedefs/calling conventions (harvest from Utinni).

### Deferred Ideas (OUT OF SCOPE — ignore)
- LIVE-03 gizmo write + 60 fps SAB write path → Phase 5. (Phase 3 builds the DLL + channel it writes through.)
- AOB/signature scanning, build-hash keying, unknown/third-build attach → future milestone.
- x64 client support (advertised export is 32-bit-only).
- ROADMAP SC-2 rewrite (doc correction, not a code task).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| LIVE-01 | User can attach the toolkit to a running SWG client process on Windows | §A inject/attach recipe (both paths) + §C host N-API orchestration + §E elevation/degrade |
| LIVE-02 | System read-verifies an object's live memory state before writing to it | §B agent DLL + 4-sentinel endpoint typedefs/RVAs + §D verified-state channel |
| LIVE-04 | System provides a live memory/packet inspector HUD | §G HUD data contract + raw-region hex view (reuse HexInspector) |
| LIVE-05 | Editor remains fully usable in file-patch mode when injection unavailable | §E/§G `isAdvertisedClient()` + OpenProcess-failure gate → disabled panel + mode indicator (D-08) |

*(LIVE-03 = Phase 5, explicitly OUT.)*
</phase_requirements>

---

## Summary

Phase 3 builds a Win32 live-injection module as two native artifacts that talk over an OS shared-memory region: an **x86 agent DLL** injected into the SWG client (where read-verify runs in-process by calling the engine directly), and a **host-arch N-API orchestrator** in the Electron renderer that launches/attaches/injects and reads verified state back. The entire mechanism — inject recipe, ASLR-base resolution, the name-keyed `GetEngineHookPoints` resolver, the legacy known-RVA table, and the exact endpoint typedefs for all four read-verify sentinels — already exists, byte-for-byte, in the `D:/Code/Utinni` and `D:/Code/swg-client-v2` sibling sources and was read verbatim this session. This is a **harvest-and-port** job, not a reverse-engineering one. AOB scanning is correctly falsified and out of scope.

The single most important architectural correction is in the channel: **the project's own Phase-0 research already proved that a V8 `SharedArrayBuffer` cannot be shared across OS processes** [VERIFIED: docs/04-live-sync/live-memory-and-ipc.md:32]. The agent DLL lives in the *client* process and the host addon lives in the *renderer* process — two distinct OS processes. Therefore D-06's "SharedArrayBuffer channel" must be implemented as a **named OS file-mapping** (`CreateFileMapping`/`MapViewOfFile`) shared between the two processes; the renderer-side JS surface is then an `ArrayBuffer`/SAB wrapper over the mapped view, reusing the Phase-0 in-process SAB plumbing only for the *JS-facing* read, not the cross-process hop. Reconciling this owner/allocator split is the one genuinely new design decision the planner must lock.

**Primary recommendation:** Add a new `packages/live-inject/` package with TWO independent CMake targets — a host-side N-API `.node` addon (host arch, x64, extends the established `native-core` binding pattern) and a standalone **plain-Win32 x86** agent DLL (NOT an N-API module). Port the inject recipe from `Launcher/main.cpp` and the resolver + sentinel endpoint typedefs from `endpoints*.cpp` / `object.cpp` / `game.cpp` verbatim. Implement the agent→host channel as a named file-mapping with a seqlock-guarded struct. Keep `resolve()` + the four sentinel checks as pure, Win32-free functions (Utinni proves they are unit-testable standalone) so the bulk of Phase 3 is validated without a live client; gate the irreducible launch+inject+read on manual UAT.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Launch / attach / inject orchestration | Host N-API addon (renderer, x64) | — | Win32 `CreateProcess`/`OpenProcess`/`CreateRemoteThread` driven from Node; off-main-thread via `AsyncWorker` |
| In-process engine calls (read-verify sentinels) | **Agent DLL (client process, x86)** | — | D-01: must run inside the client to call `__thiscall` engine fns on live `Object*`s; this is the eventual Phase-5 write home |
| Engine endpoint resolution (name-keyed + RVA) | Agent DLL (in-process) | — | `GetProcAddress(GetModuleHandle(NULL),"GetEngineHookPoints")` only works in-process; RVA table is process-local addresses |
| Cross-process state transport | OS file-mapping (kernel object) | — | V8 SAB cannot cross processes (proven); named `CreateFileMapping` is the only zero-copy cross-process path |
| Verified-state → JS | Host addon → renderer (in-process) | — | Map the file-mapping view, expose as `ArrayBuffer` to JS (reuse Phase-0 SAB read pattern) |
| HUD render + mode indicator | Renderer (React/Dockview) | — | Dockview panel + StatusBar; consumes the contracts type |
| File-patch fallback | Renderer (UX) + host (detect gate) | — | `isAdvertisedClient()` + OpenProcess result drive the disabled state |

---

## Standard Stack

This is a Win32/C++/N-API phase. There are **no new npm packages** and **no new third-party native libraries** required for Phase 3. The stack is the Windows SDK + the already-pinned `node-addon-api`, plus harvested source.

### Core
| Component | Version | Purpose | Why Standard |
|-----------|---------|---------|--------------|
| Win32 API (`Windows.h`, `TlHelp32.h`) | Windows SDK (installed w/ VS 17 2022) | `CreateProcess`, `OpenProcess`, `VirtualAllocEx`, `WriteProcessMemory`, `CreateRemoteThread`, `CreateFileMapping`, named events | The only API for process creation/injection/shared-memory on Windows [VERIFIED: Launcher/main.cpp uses exactly these] |
| `node-addon-api` | ^8.8.0 (already pinned) | Host-side N-API binding; `Napi::AsyncWorker`, external `ArrayBuffer` | Established repo pattern [VERIFIED: native-core/CMakeLists.txt:45] |
| cmake-js | 8.0.0 (already in repo, host addon) | Builds the **x64** `.node` host addon | Existing toolchain [VERIFIED: native-core/cmake-js.json] |
| CMake + MSVC (`-A Win32`) | VS 17 2022 toolset | Builds the **x86** agent DLL as a plain Win32 DLL (NOT via cmake-js) | Agent runs in the client with no Node runtime — it is not an N-API module |

### Supporting (deferred to Phase 5 — do NOT install in Phase 3)
| Library | Purpose | When |
|---------|---------|------|
| Microsoft Detours | Function detours for the 60fps write path / packet sniffer | Phase 5 (write) — the IPC doc's packet sniffer is NOT a Phase-3 deliverable |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Named file-mapping for the channel | MessagePort copy (~450 MB/s) | Copy, not zero-copy; and SAB throws `could not be cloned` cross-process [VERIFIED: live-memory-and-ipc.md:32]. File-mapping is the correct zero-copy choice. |
| Classic `LoadLibraryA` inject | Manual mapping / reflective inject | Unnecessary complexity; Utinni's classic inject is proven on this exact client [VERIFIED: main.cpp:43-116] |
| Plain x86 CMake for the agent | cmake-js for the agent too | cmake-js targets `.node` Node addons; the agent is a bare injected DLL with no Node ABI — plain CMake is correct |

**Installation:** No `npm install`. The agent DLL needs the **x86 (Win32) MSVC toolset** present in the VS 17 2022 install (the repo currently builds x64 only — confirm the x86 toolset/build-tools component is installed; `vswhere` or VS Installer "MSVC … x86/x64" component).

---

## Package Legitimacy Audit

**No external packages are installed in Phase 3.** The stack is the Windows SDK (OS-provided), the already-vendored `node-addon-api` (^8.8.0, present and in use across native-core), and source harvested from the local sibling repos. slopcheck is therefore N/A — there is nothing to verify against npm/PyPI/crates. Should the planner decide to pull in Microsoft Detours early (NOT recommended — it's a Phase-5 concern), it must run the Package Legitimacy Gate at that time.

| Package | Registry | Disposition |
|---------|----------|-------------|
| node-addon-api ^8.8.0 | npm (already installed) | Pre-existing, in use — no new install |
| *(none new)* | — | — |

---

## Architecture Patterns

### System Architecture Diagram

```
                       ELECTRON RENDERER PROCESS (host arch, x64 under WOW64)
  ┌──────────────────────────────────────────────────────────────────────────┐
  │  React HUD (Dockview panel)        StatusBar ● Live / ○ File-patch         │
  │        ▲  verified state (ArrayBuffer, zero-copy)   ▲ mode                  │
  │        │                                            │                       │
  │  ┌─────┴──────────────── host N-API addon (.node) ──┴───────────────────┐   │
  │  │  launch/attach/inject orchestration (Napi::AsyncWorker, off main)    │   │
  │  │  CreateProcess(SUSPENDED) | OpenProcess | VirtualAllocEx |           │   │
  │  │  WriteProcessMemory | CreateRemoteThread(LoadLibraryA) | named-event │   │
  │  │  MapViewOfFile(view) ──► expose as external ArrayBuffer to JS        │   │
  │  └───────┬───────────────────────────────────────────────▲─────────────┘   │
  └──────────┼───────────────────────────────────────────────┼─────────────────┘
             │ inject DLL + remote init thread                │ reads same kernel
             │                                                │ file-mapping pages
             ▼                                                │
                       SWG CLIENT PROCESS  (x86, /DYNAMICBASE or fixed-base)
  ┌──────────┼────────────────────────────────────────────────┼────────────────┐
  │  ┌───────▼──────────── injected AGENT DLL (x86) ───────────┴────────────┐    │
  │  │  agent_init (remote thread, NOT DllMain) → signal named ready event  │    │
  │  │  resolveFromExe(): GetProcAddress(GetModuleHandle(NULL),             │    │
  │  │       "GetEngineHookPoints")  →  present? name-keyed : RVA-table     │    │
  │  │  read-verify: getPlayer/getObjectById → getTransform_o2w,           │    │
  │  │       getNetworkId, getObjectTemplateName, isOver, mainLoopCounter   │    │
  │  │  write 4 sentinels + state into the file-mapping (seqlock)           │    │
  │  └─────────────────────────────────┬───────────────────────────────────┘    │
  │     calls __thiscall/__cdecl engine fns on live Object*                 │    │
  │  ┌─────────────────────────────────▼───────────────────────────────────┐    │
  │  │  SWG engine: Game::getPlayer(), Object::getTransform_o2w(), ...      │    │
  │  └──────────────────────────────────────────────────────────────────────┘    │
  └────────────────────────────────────────────────────────────────────────────┘
            ▲
            └── named kernel file-mapping "Local\\SwgToolkitLive_<pid>" spans both processes (zero-copy)
```

### Recommended Project Structure
```
packages/live-inject/                 # NEW package
├── CMakeLists.txt                     # host addon (x64) — mirrors native-core
├── cmake-js.json                      # { "generator":"Visual Studio 17 2022", "platform":"x64" }
├── src/                               # host-side N-API (host arch)
│   ├── addon.cpp                      # NODE_API_MODULE registration (mirror native-core/addon.cpp)
│   ├── inject_binding.cpp             # launch/attach/inject orchestration (AsyncWorker)
│   ├── procmem_binding.cpp            # OpenProcess handle lifecycle + ReadProcessMemory region reads
│   └── channel_binding.cpp           # OpenFileMapping/MapViewOfFile → external ArrayBuffer
├── agent/                             # the injected x86 DLL — SEPARATE build
│   ├── CMakeLists.txt                 # plain Win32, set CMAKE_GENERATOR_PLATFORM=Win32 (x86)
│   ├── agent_main.cpp                 # agent_init export (remote-thread entry), named-event signal
│   ├── resolve.cpp / resolve.h        # PORT of endpoints.cpp resolve()/lookupByName (Win32-free → testable)
│   ├── rva_table.cpp                  # legacy known-RVA literals harvested from Utinni
│   ├── sentinels.cpp / sentinels.h    # the 4 sentinel checks (pure over byte buffers → testable)
│   └── channel.cpp                    # CreateFileMapping + seqlock writer
└── test/                              # vitest + native unit tests (resolve, sentinels, layout round-trip)
```
*(Alternative: extend `native-core` for the host side and add only `agent/` as a sibling. Recommended to keep live-inject self-contained because the agent's x86 build is a fundamentally different target shape that should not contaminate native-core's x64 glob.)*

### Pattern 1: Launch-and-inject recipe (PRIMARY path, D-02.1)
**What:** The exact ordered Win32 sequence, harvested from `Launcher/main.cpp`.
**Source:** [VERIFIED: D:/Code/Utinni/Launcher/main.cpp:204-378]

1. `CreateProcess(clientExe, cmdLine, …, CREATE_SUSPENDED, …, &procInfo)` [main.cpp:211].
2. Map the client EXE file, read `peHeader->OptionalHeader.AddressOfEntryPoint` (entry RVA) [main.cpp:218-222].
3. **Resolve the real ASLR load base** (the critical fix): the suspended initial thread has `EBX = PEB` on x86; read `PEB.ImageBaseAddress` at `EBX+0x08` via `GetThreadContext(CONTEXT_INTEGER)` + `ReadProcessMemory(hProcess, startCtx.Ebx+0x08, &remoteImageBase, 4)`. Fixed-base `SWGEmu.exe` falls through to `OptionalHeader.ImageBase` (0x00400000) [VERIFIED: main.cpp:233-248]. `entry = actualBase + entryRva`.
4. Save original 2 entry bytes (`ReadProcessMemory(entry, oep, 2)`) [main.cpp:261-262].
5. Create the named ready event **before** the patch: `CreateEventA(nullptr, TRUE /*manual reset*/, FALSE, "Local\\UtinniReady_<pid>")` [VERIFIED: main.cpp:268-269]. **Naming idiom:** `Local\\<Name>_<dwProcessId>`.
6. `VirtualAllocEx` the event-name C-string into the remote process, `WriteProcessMemory` it [main.cpp:277-284] — this pointer is passed as the agent-init `lpThreadParam`.
7. Patch entry with `EB FE` (relative jmp-to-self, infinite spin): `WriteProcessMemory(entry, {0xEB,0xFE}, 2)` then **`FlushInstructionCache(hProcess, entry, 2)`** (mandatory — without it the I-cache runs stale bytes, nondeterministic) [VERIFIED: main.cpp:287-294].
8. `ResumeThread`; poll `GetThreadContext(CONTEXT_CONTROL)` until `context.Eip == entry` (≤50× `Sleep(100)` = 5s budget); timeout → error [main.cpp:310-324].
9. **Inject** (see Pattern 2): `VirtualAllocEx`+`WriteProcessMemory`(dll path)+`CreateRemoteThread(LoadLibraryA, remotePathPtr)`; wait, `GetExitCodeThread` → remote `hModule` base [main.cpp:51-78].
10. Resolve `agent_init` offset locally (`LoadLibraryA(dll)` → `GetProcAddress("agent_init")` → `offset = proc - localBase` → `FreeLibrary`), then `CreateRemoteThread(remoteBase+offset, remoteEventNamePtr)`. **Do NOT** `WaitForSingleObject` on this thread (it may run a message loop forever) [VERIFIED: main.cpp:80-115].
11. `WaitForSingleObject(hReadyEvent, 30000)` — the agent signals it when init completes [main.cpp:337].
12. `SuspendThread` → restore OEP (`WriteProcessMemory(entry, oep, 2)` + `FlushInstructionCache`) → `ResumeThread` [VERIFIED: main.cpp:345-362].

**When to use:** the toolkit launches the client itself. This path **sidesteps the static-init "40/96 half-built table" race** because the ready-event sync happens *after* the client CRT `_initterm` has run.

### Pattern 2: Classic DLL injection (the inner step)
**Source:** [VERIFIED: main.cpp:43-78]
```cpp
// remote = the suspended/running client process handle
LPVOID lpMem = VirtualAllocEx(hProcess, nullptr, dllPath.length(), MEM_COMMIT|MEM_RESERVE, PAGE_EXECUTE_READWRITE);
WriteProcessMemory(hProcess, lpMem, dllPath.c_str(), dllPath.length(), nullptr);
LPVOID pLoadLib = GetProcAddress(GetModuleHandle("kernel32.dll"), "LoadLibraryA"); // same RVA in target
HANDLE hThread = CreateRemoteThread(hProcess, nullptr, 0, (LPTHREAD_START_ROUTINE)pLoadLib, lpMem, 0, nullptr);
WaitForSingleObject(hThread, INFINITE);
DWORD hRemoteModule; GetExitCodeThread(hThread, &hRemoteModule); // = remote HMODULE base (truncated to 32-bit — x86 OK)
```
**Note for attach-to-running (D-02.2):** same inner step, but there is **no `CREATE_SUSPENDED`/`EB FE` dance** — you `OpenProcess` a live PID and late-inject. Because the client's CRT is already initialized, the static-init race is moot **only if you always resolve via `GetEngineHookPoints()`** (never scrape the raw static array) [VERIFIED: GROUNDTRUTH axiom 4; engine_advertise.cpp:636-687].

### Pattern 3: Agent DLL shape (D-01)
**What:** Mirror Utinni's `utinni_init` — a named **init export fired on a fresh remote thread, NOT in `DllMain`**.
**Source:** [VERIFIED: main.cpp:80-115 (remote-thread init), :106-107 (lpThreadParam = event name)]
- Export: `extern "C" __declspec(dllexport) DWORD WINAPI agent_init(LPVOID lpReadyEventName);` — `dllexport` alone forces the undecorated name (same idiom the provider uses for `GetEngineHookPoints` [VERIFIED: engine_advertise.cpp:766-771]).
- `DllMain` must do **nothing** beyond `DisableThreadLibraryCalls` — no engine calls, no resolve (loader-lock + CRT-not-ready). All real work runs in `agent_init`'s thread [VERIFIED: the whole reason main.cpp:80-115 fires a *separate* remote thread, not relying on DllMain].
- `agent_init`: (1) `OpenEventA` the passed name; (2) `swg::endpoints::resolveFromExe()`; (3) set up the file-mapping channel; (4) `SetEvent(hReady)` to unblock the launcher; (5) enter the read-verify loop (poll → write state into mapping).

### Pattern 4: Endpoint resolution — name-keyed + RVA fallback
**What:** Port `resolveFromExe()` verbatim. It is the detect/degrade gate (LIVE-05 trigger).
**Source:** [VERIFIED: endpoints_bindings.cpp:802-825, endpoints.cpp:114-185]
```cpp
// resolveFromExe(): GetModuleHandle(NULL) = the host EXE (export lives in the exe, not a dll)
HMODULE hExe = GetModuleHandleA(nullptr);
auto pGet = (const EngineHookPoints*(__cdecl*)())GetProcAddress(hExe, "GetEngineHookPoints");
if (!pGet) { /* SWGEmu legacy: STRICT NO-OP, RVA literals stand */ return false; }
s_advertisedClient = true;
const EngineHookPoints* table = pGet();           // CALL it — never scrape the static array
resolve(table, s_bindings, count);                // name-keyed overwrite of fn-pointer slots
```
- `resolve()` is **pure / Win32-free** (proven unit-testable standalone — Utinni's Option-A split) [VERIFIED: endpoints.cpp header note :40-43, :132-185]. A missing name leaves the RVA literal untouched (graceful, never nulls a slot) [VERIFIED: endpoints.cpp:169-175].
- Contract structs (copy verbatim — byte-identical in both repos) [VERIFIED: engine_hookpoints.h:77-93]:
  ```cpp
  struct EngineHookPoint  { const char* name; void* addr; };
  struct EngineHookPoints { unsigned version; unsigned count; const EngineHookPoint* entries; };
  #define ENGINE_HOOKPOINTS_VERSION 6   // 99 names; advisory — contract is name-keyed
  ```
- Version mismatch = soft warning, still resolves by name [VERIFIED: endpoints.cpp:144-147].

### Anti-Patterns to Avoid
- **Scraping the static hookpoint array from a remote thread** → sees the half-built "40/96" table (29 call-rows are `{name,0}` placeholders filled lazily on the reader's thread inside `GetEngineHookPoints()`). ALWAYS call the function [VERIFIED: engine_advertise.cpp:625-687].
- **Doing engine work in `DllMain`** → loader lock + uninitialized CRT. Use a remote init thread [VERIFIED: main.cpp:80-115 rationale].
- **Adding entry-RVA to `OptionalHeader.ImageBase`** on the advertised `/DYNAMICBASE` client → wrong VA, patch lands on stale memory, spin-wait times out. Read PEB.ImageBaseAddress [VERIFIED: main.cpp:224-248].
- **Treating the agent→host channel as a V8 SAB shared cross-process** → throws `could not be cloned`; it is impossible [VERIFIED: live-memory-and-ipc.md:32]. Use a file-mapping.
- **Caching `arrayBuffer.Data()` without a strong ref** → dangling pointer when V8 GC collects the buffer. Hold a `Napi::Reference` [VERIFIED: live-memory-and-ipc.md:19, doc bug #4].

---

## Read-Verify Endpoints (the 4 sentinels) — exact typedefs, calling conventions, RVAs

**Calling-convention rule (VERIFIED, supersedes the GROUNDTRUTH's "`__fastcall` emulation" phrasing):** Utinni's real typedefs use the MSVC `__thiscall` keyword **directly** on the function pointer for member functions, and `__cdecl` for free/static functions. Port the typedefs verbatim — do not hand-emulate `__fastcall(ECX,EDX,args)`; MSVC's `__thiscall` pointer call does the ECX-this passing for you. [VERIFIED: object.cpp:62-189, game.cpp:41-98]

All four sentinel member functions are confirmed **NON-VIRTUAL** Object members (advertised as real entries, safe to call directly — not via vtable) [VERIFIED: object.cpp:176-182 "advertises these NON-VIRTUAL Object members"; engine_advertise.cpp:654-659 advertises real entry via `pmfToVoid(&Object::method)`].

| # | Sentinel check | Endpoint | Typedef (port verbatim) | Advertised name | Legacy RVA |
|---|----------------|----------|--------------------------|-----------------|-----------|
| 1 | Sane transform | `object::getTransform_o2w` | `swg::math::Transform*(__thiscall*)(Object*)` | `object::getTransform_o2w` | **0x00B22C80** [object.cpp:101,146] |
| 2 | Non-null networkId | `object::getNetworkId` | `swgptr(__thiscall*)(Object*)` | `object::getNetworkId` | **none — advertised-only** [object.cpp:185,189] ⚠ |
| 3 | Readable template name | `object::getObjectTemplateName` | `const char*(__thiscall*)(Object*)` | `object::getObjectTemplateName` | **none — advertised-only** [object.cpp:184,188] ⚠ |
| 4a | Player non-null | `game::getPlayer` | `Object*(__cdecl*)()` | `game::getPlayer` | **0x00425140** [game.cpp:48,64] |
| 4b | Not over (`isOver` false) | `game::g_runningFlags` | `bool(__cdecl*)()` | `game::g_runningFlags` | **none — advertised-only** [game.cpp:80,81] ⚠ |
| 4c | Main loop advancing | `game::g_mainLoopCounter` | `int(__cdecl*)()` | `game::g_mainLoopCounter` | **none — advertised-only** [game.cpp:89,90] ⚠ |

### ⚠ CRITICAL planning nuance: the legacy path resolves 4 of the 6 endpoints DIFFERENTLY
`getNetworkId`, `getObjectTemplateName`, `g_runningFlags`(isOver), and `g_mainLoopCounter` have **NO legacy SWGEmu RVA** — they were added as advertised-only slots (start `nullptr`). The legacy SWGEmu consumer satisfies the same sentinels via alternate sources [VERIFIED: object.cpp:176-189, game.cpp:73-90 comments]:
- **Template name (legacy):** use `object::getTemplateFilename` RVA **0x00B23C40** (`const char*(__thiscall*)(Object*)`) instead of `getObjectTemplateName` [VERIFIED: object.cpp:129,174].
- **isOver (legacy):** the consumer reads two engine safety-flag globals directly via `memory::read` [VERIFIED: game.cpp:76-79 comment]. Exact addresses NOT in the files read — [UNVERIFIED], planner must harvest from the SWGEmu read-site.
- **mainLoopCounter (legacy):** read the global at **0x1908830** directly [VERIFIED: game.cpp:87 comment].
- **networkId (legacy):** no `getNetworkId` RVA. The id is reachable as an Object struct field; the look-at target path reads `playerCreature + 1432` as the cached id [VERIFIED: game.cpp:656-665]. A clean legacy `getNetworkId` accessor is **[UNVERIFIED]** — planner must confirm the SWGEmu source of networkId before claiming the legacy 4-sentinel gate is complete.

**Planning implication:** the sentinel layer needs **two resolver back-ends** (advertised: name-keyed; legacy: RVA table + 2 raw global reads + a struct-offset read), not one. Budget a task to close the four legacy [UNVERIFIED] sources against the SWGEmu read-sites in Utinni.

### How the agent obtains the `Object*` to verify
- **Liveness / first proof target:** `game::getPlayer()` or `game::getPlayerCreatureObject()` (`Object*(__cdecl*)()`, RVAs 0x00425140 / 0x004251D0) [VERIFIED: game.cpp:64-65].
- **A selected/look-at object (toward Phase 5):** `Game::getPlayerLookAtTargetObject()` = read cached id at `playerCreature+1432` → `Object::getObjectById(id)` → `Network::getCachedObjectById` (RVA **0x00B30160**) / `idManagerGetObjectById` (RVA **0x00B380E0**) [VERIFIED: game.cpp:656-678, network.cpp:38-41, object.cpp:259-267]. The `+1432` offset is a build-specific magic number [UNVERIFIED for the advertised build].

### Transform memory layout (for the SAB byte map)
`swg::math::Transform` = `float matrix[3][4]` — **12 floats / 48 bytes, row-major** (3 rows × 4 cols; translation is column 3: `matrix[i][3]`) [VERIFIED: swg_math.h:69]. `Vector` = `{float X,Y,Z}` [VERIFIED: swg_math.h:47-50]. The IPC doc's "64-byte 4×4 matrix" is **WRONG for SWG** — SWG transforms are 3×4/48 bytes. Use 48 bytes (or pad to 64 for a full mat4 if the gizmo needs it, but the engine read is 48).

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Engine address discovery | An AOB/signature scanner | Port `resolveFromExe()` (name-keyed) + the harvested RVA table | AOB is falsified & out of scope; both builds have deterministic address sources [GROUNDTRUTH axiom 1] |
| ASLR base resolution | Parse relocations / scan | Read `PEB.ImageBaseAddress` via suspended-thread `EBX+0x08` | Exactly what the working launcher does [VERIFIED: main.cpp:233-248] |
| Cross-process transport | A custom socket/pipe protocol for the 60fps path | Named `CreateFileMapping` + seqlock | Zero-copy, lock-free reads; the only mechanism that survives the Phase-5 write load [VERIFIED: SAB-cross-process falsified, live-memory-and-ipc.md:32] |
| Endpoint resolve unit-testing | A mocked injected client | Port the **pure** `resolve()`/`lookupByName()` and test vs a synthetic table | Utinni's Option-A split proves this is testable with zero injection [VERIFIED: endpoints.cpp:40-43] |
| Hex/region viewer | A new virtualized hex grid | Reuse the Phase-1 `HexInspector` (already virtualized) | Built + proven [VERIFIED: STATE.md:115] |
| Mode indicator UI | A bespoke status widget | Extend the existing StatusBar | Phase-0 component owns the bottom bar |

**Key insight:** Phase 3 is ~80% a faithful port of code that already runs on this exact pair of clients. The risk is not algorithmic — it is (a) getting the cross-process channel right (the one genuinely new design), (b) closing the four legacy-RVA gaps, and (c) the x86/x64 build split.

---

## Runtime State Inventory

Phase 3 is greenfield Win32 code (grep-confirmed no existing inject code [VERIFIED: 03-CONTEXT.md:162]), not a rename/refactor. **No stored data, live-service config, OS-registered state, secrets, or build artifacts carry forward a renamed string.** One forward-looking note: the agent DLL and the file-mapping use a process-scoped name `Local\\SwgToolkitLive_<pid>` — a per-launch kernel object that the OS reclaims on process exit; no persistent registration. **Nothing to inventory — verified by greenfield status.**

---

## Common Pitfalls

### Pitfall 1: Half-built hookpoint table (the "40/96" race)
**What goes wrong:** Reading the advertised table too early (from a remote thread before the client CRT static-init runs) returns a table whose 29 call-rows are still null.
**Root cause:** MSVC defers the whole array tail from the first dynamically-initialized row; the fix ships those rows as `{name,0}` placeholders filled lazily inside `GetEngineHookPoints()` on the reader's thread [VERIFIED: engine_advertise.cpp:620-687].
**How to avoid:** Always resolve by **calling** `GetEngineHookPoints()`; in the launch path, sync via the ready event *after* `_initterm`. **Warning sign:** resolved count ≈ 40 of ~97.

### Pitfall 2: Stale instruction cache after the EB FE patch
**What goes wrong:** The client sometimes runs through the entry unpatched (nondeterministic).
**Root cause:** CPU I-cache holds pre-patch bytes.
**How to avoid:** `FlushInstructionCache(hProcess, entry, 2)` after **both** the patch and the restore [VERIFIED: main.cpp:289-294, 347-349].

### Pitfall 3: Wrong load base on the ASLR client
**What goes wrong:** Spin-wait times out though the SWG window opens.
**Root cause:** Using `OptionalHeader.ImageBase` (preferred) instead of the relocated base.
**How to avoid:** Read PEB.ImageBaseAddress at `EBX+0x08` [VERIFIED: main.cpp:224-248].

### Pitfall 4: SAB cannot cross OS processes (the channel trap)
**What goes wrong:** Passing a V8 SAB from the agent's process to the renderer (or vice versa) throws `An object could not be cloned`.
**Root cause:** A SAB is namable only within one V8 agent-cluster/process cage [VERIFIED: live-memory-and-ipc.md:32].
**How to avoid:** Cross-process hop = named file-mapping; the JS-facing SAB/ArrayBuffer is created **inside** the renderer over the mapped view.

### Pitfall 5: Dangling `arrayBuffer.Data()` pointer
**What goes wrong:** Silent memory corruption during live reads.
**Root cause:** Caching the raw data pointer while V8 GC's the JS buffer.
**How to avoid:** Hold a `Napi::Reference<Napi::ArrayBuffer>` alongside the pointer [VERIFIED: live-memory-and-ipc.md:19].

### Pitfall 6: SC-1's handle flag set is insufficient for the inject path
**What goes wrong:** `OpenProcess(PROCESS_VM_OPERATION|VM_READ|VM_WRITE)` succeeds but `CreateRemoteThread` fails with ACCESS_DENIED.
**Root cause:** Remote-thread injection also needs `PROCESS_CREATE_THREAD` and `PROCESS_QUERY_INFORMATION` (or `QUERY_LIMITED_INFORMATION`) [CITED: learn.microsoft.com Process Security and Access Rights].
**How to avoid:** For attach-to-running inject use the fuller set: `PROCESS_CREATE_THREAD | PROCESS_QUERY_INFORMATION | PROCESS_VM_OPERATION | PROCESS_VM_READ | PROCESS_VM_WRITE`. The SC-1 read-verify-only set is fine for pure RPM after injection. **Flag SC-1 wording to the maintainer.**

---

## State of the Art

| Old Approach | Current Approach | Why |
|--------------|------------------|-----|
| Hardcoded RVAs for the advertised client | Name-keyed `GetEngineHookPoints` table | Survives every client rebuild (the maintainer rewrote swg-client-v2 to advertise) [VERIFIED: engine_hookpoints.h:6-13] |
| AOB/signature scanning (ROADMAP SC-2 wording) | Name-keyed (advertised) + harvested RVAs (legacy) | Both supported builds have deterministic address sources — nothing to scan [GROUNDTRUTH; D-04] |
| Utility-process SAB shared to renderer | In-renderer native addon (Path B) + file-mapping for cross-*OS*-process | Cross-process V8 SAB proven impossible [VERIFIED: live-memory-and-ipc.md:32] |

**Deprecated/outdated:**
- The `docs/04-live-sync/live-memory-and-ipc.md` C++ sample (64-byte matrix, dual `hSwgProcess`/`g_swgProcessHandle` globals, `SIZE_t` typo, TS-allocated SAB passed to C++, packet sniffer) — **do not port verbatim**; it carries documented bugs and a falsified cross-process SAB model [VERIFIED: doc's own correction block :9-32]. Use it only for the *shape* of the N-API surface.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Same-integrity OpenProcess+CreateRemoteThread needs **no admin/SeDebugPrivilege**; only higher-integrity targets do | §Elevation | If wrong, the no-admin UX promise (D-08) breaks; mitigated by the degrade path |
| A2 | A new `packages/live-inject/` with a host x64 addon + a plain-x86 agent CMake target is the right boundary | §Package layout | Planner's call (Claude's discretion) — alternative is extend native-core |
| A3 | The four legacy-only sentinel sources (networkId, isOver globals, mainLoopCounter @0x1908830, template via getTemplateFilename) fully reconstruct the gate on SWGEmu | §Sentinels | If a legacy networkId source is missing, the legacy 4-sentinel gate is incomplete — flagged [UNVERIFIED] |
| A4 | `agent_init` named-event idiom `Local\\SwgToolkitLive_<pid>` (mirroring `Local\\UtinniReady_<pid>`) is sufficient sync | §Pattern 1/3 | Low — directly mirrors proven Utinni idiom |
| A5 | Seqlock over a 48-byte transform in the file-mapping gives torn-read-free reads without locks | §SAB layout | Standard lock-free pattern; verify under Phase-5 write load |

---

## Open Questions (RESOLVED)

1. **Legacy networkId / isOver-globals sources** — getNetworkId & isOver have no legacy RVA.
   RESOLVED: Plan 03-02 Task 2 closes the legacy-RVA gaps: harvests networkId struct-offset and isOver safety-flag globals from the Utinni SWGEmu read-sites; marks any remaining gaps as "3.5/4 verified" in the SUMMARY.
   - Known: mainLoopCounter @0x1908830, template via getTemplateFilename @0x00B23C40 [VERIFIED].
   - Unclear: the exact SWGEmu addresses/struct-offsets for networkId and the two isOver safety-flag globals.
   - Recommendation: a Phase-3 task to harvest these from the Utinni SWGEmu read-sites (game.cpp safety-flag read; object struct) and add them to the RVA table; until then mark the legacy gate "3.5/4 verified".

2. **Channel ownership: who creates the file-mapping?** Agent (in client) or host (in renderer)?
   RESOLVED: Plans 03-03/03-04 lock Scheme A — host creates the file-mapping (OpenChannel in channel_binding.cpp, Plan 03-04 Task 2) with a JS-pre-generated name BEFORE calling LaunchAndInjectWorker; agent OpenFileMappingA uses the same name. See Plan 03-05 Task 1 CHANNEL NAMING SCHEME note.
   - Recommendation: **host creates** `CreateFileMapping(INVALID_HANDLE_VALUE,…,name)` before inject and passes the *name* to the agent via the same remote-string mechanism as the ready-event name; agent `OpenFileMapping`s it. Symmetric with main.cpp:277-284. Confirm in discuss/plan.

3. **`+1432` look-at offset and `Object` ctor `allocate(160)` size** are build-specific magic numbers [VERIFIED in legacy Utinni; UNVERIFIED for the advertised build].
   RESOLVED: Deferred to Phase 5 — Phase 3 read-verify leans on getPlayer() only (no offset needed); look-at-target object selection is a Phase 5 gizmo concern.
   Phase 3 read-verify can lean on `getPlayer()` (no offset needed); defer look-at-target selection to Phase 5 where the gizmo picks the object.

4. **x86 toolset availability** — the repo builds x64 only (cmake-js platform x64).
   RESOLVED: Plan 03-01 Wave-0 env check (Task 1b) documents the result of the vswhere toolset probe in the SUMMARY; absent toolset is a hard blocker flagged before any C++ compilation task.
   Confirm the VS 17 2022 **x86 MSVC build tools** component is installed before planning the agent build (Environment Availability below).

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Windows SDK (Win32 headers) | Inject + file-mapping | ✓ (with VS 17 2022) | — | none needed |
| MSVC **x64** toolset | Host N-API addon | ✓ | VS 17 2022 | — |
| MSVC **x86 (Win32)** toolset | Agent DLL | **? VERIFY** | — | **blocking if absent** — install via VS Installer ("MSVC … C++ x64/x86 build tools") |
| node-addon-api ^8.8.0 | Host addon | ✓ | 8.8.0 | — |
| cmake-js 8.0.0 | Host `.node` build | ✓ | 8.0.0 | — |
| A supported SWG client (advertised swg-client-v2 build + legacy SWGEmu client) | Manual UAT only | ✓ (D:/SWG Infinity, D:/SWGEmu Client) | — | UAT only; unit tests need no client |

**Missing dependency to verify before planning:** the x86 MSVC build-tools component. If absent, the agent DLL cannot compile — a hard blocker the planner must front-load as a Wave-0 environment task.

---

## Validation Architecture

> nyquist_validation is enabled (config.json `workflow.nyquist_validation: true`). This section drives VALIDATION.md.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.9 (JS/TS) + native C++ unit tests compiled into the test build; Playwright 1.61.0 for renderer E2E |
| Config file | per-package `vitest` via `pnpm test` (root `test: vitest run`) |
| Quick run command | `pnpm --filter @swg/live-inject test` (proposed) |
| Full suite command | `pnpm -r test` |

### Validation seams (the key design output)
The phase is testable because the proven Utinni split keeps the algorithmic core Win32-free:
- **Pure & unit-testable WITHOUT a client:** `resolve()`/`lookupByName()` (name-keyed resolve vs a synthetic `EngineHookPoints` table) [VERIFIED testable: endpoints.cpp:40-43]; the 4 sentinel predicates (finite+~orthonormal transform over a 48-byte buffer, non-zero networkId, ASCII `object/...` template-path check, liveness counter-advance logic) as pure functions over captured byte fixtures; the legacy RVA table (name→addr map); the file-mapping struct **layout round-trip** (write struct → read struct, same process); the host handle-lifecycle behind a thin interface with a mock (open→use→close, double-close guard).
- **Requires a REAL running client (manual UAT only):** actual `CreateProcess(SUSPENDED)`+ASLR-base+`EB FE`+inject+resume; real in-process `GetEngineHookPoints()` call + resolved-count assertion (expect ~97, NOT 40); real read-verify of a live player object; the not-elevated/higher-integrity degrade behavior.

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| LIVE-01 | Handle lifecycle: open with correct flag set, close once, guard double-close | unit (mock Win32) | `pnpm --filter @swg/live-inject test handle` | ❌ Wave 0 |
| LIVE-01 | Real launch+inject+resume reaches in-world | manual UAT | (checklist; real client) | ❌ Wave 0 |
| LIVE-02 | Name-keyed resolve vs synthetic table → expected slots bound | unit | `…test resolve` | ❌ Wave 0 |
| LIVE-02 | 4 sentinel predicates on captured byte fixtures (pass + each failure mode) | unit | `…test sentinels` | ❌ Wave 0 |
| LIVE-02 | Real read-verify gates a write attempt (refuse on fail) | manual UAT | (real client) | ❌ Wave 0 |
| LIVE-02 | Channel struct layout round-trip (seqlock no torn read) | unit | `…test channel-layout` | ❌ Wave 0 |
| LIVE-04 | HUD renders verified-state contract; hex view over a region ArrayBuffer | renderer E2E | `pnpm test:e2e live-hud` | ❌ Wave 0 |
| LIVE-05 | Detect gate false (no export / OpenProcess fail) → disabled panel + reason; editing still works | renderer E2E | `pnpm test:e2e file-patch-mode` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** the relevant `pnpm --filter @swg/live-inject test <suite>` quick run.
- **Per wave merge:** `pnpm -r test` (full vitest) + the native unit suite.
- **Phase gate:** full suite green + the manual-UAT checklist signed against both a real advertised client and a real legacy SWGEmu client before `/gsd:verify-work`.

### Wave 0 Gaps
- [ ] `packages/live-inject/test/resolve.spec` — synthetic-table name-keyed resolve (covers LIVE-02)
- [ ] `packages/live-inject/test/sentinels.spec` — 4 predicates over byte fixtures (LIVE-02)
- [ ] `packages/live-inject/test/channel-layout.spec` — file-mapping struct + seqlock round-trip (LIVE-02/D-06)
- [ ] `packages/live-inject/test/handle.spec` — mocked OpenProcess lifecycle (LIVE-01)
- [ ] Captured byte fixtures: a real `getTransform_o2w` 48-byte transform, a networkId, an `object/...` template string (harvest from a live client once, store as fixtures — mirrors the Phase-1 `fixtures-real/` discipline)
- [ ] Manual-UAT checklist doc (launch+inject+read on advertised AND legacy clients; resolved-count ~97 assertion)
- [ ] Environment task: confirm/install the x86 MSVC toolset

---

## Security Domain

> security_enforcement is not set to false in config → treated as enabled.

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | No auth surface in this phase |
| V3 Session Management | no | — |
| V4 Access Control | **yes** | The toolkit performs `WriteProcessMemory`/`CreateRemoteThread` — gate ALL injection behind explicit user confirmation (CLAUDE.md: "gate live memory injection behind explicit confirmation"); operate only on the user's own same-user client |
| V5 Input Validation | **yes** | Validate every value read from the foreign process (template-name pointer derefs, transform finiteness, networkId range) **before** trusting it — the read-verify sentinels ARE this control (D-05). Treat all client memory as untrusted input. |
| V6 Cryptography | no | — |

### Known Threat Patterns for a Win32 injector
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Injecting into the wrong / a malicious process | Spoofing/Elevation | Verify the target is the user's own SWG client (Utinni checks `ProductName == "Star Wars Galaxies"` via `GetFileVersionInfo` [VERIFIED: main.cpp:185-197]) before inject |
| Reading a wild pointer from client memory (crash/info-leak) | DoS/Info-disclosure | Bounds-check + `VirtualQuery`-guard every foreign read; the sentinel `installable()`/`isCommittedExecutable` pattern is the model [VERIFIED: endpoints_bindings.cpp:776-792] |
| Silent privilege escalation request | Elevation | Do NOT auto-request admin; same-integrity is sufficient for same-user clients (A1). Surface the reason and degrade (D-08) rather than escalate. |
| Writing before verifying (Phase 5 risk, guarded now) | Tampering | The 4-sentinel gate refuses writes when validation fails — build it correctly in Phase 3 (D-05) |

---

## Sources

### Primary (HIGH confidence — real source read this session)
- `D:/Code/Utinni/Launcher/main.cpp` — full inject/attach recipe (:43-116 inject, :204-378 launch, :224-248 ASLR base, :268-269 named event, :287-294 EB FE + flush)
- `D:/Code/Utinni/UtinniCore/swg/endpoints.h` / `endpoints.cpp` / `endpoints_bindings.cpp` — resolver (`resolveFromExe` :802-825, pure `resolve` :132-185, s_bindings catalog :425-579, `isAdvertisedClient`/`installable` :770-800)
- `D:/Code/Utinni/UtinniCore/swg/object/object.cpp` — sentinel typedefs + RVAs (:84-189, :259-267), getObjectById
- `D:/Code/Utinni/UtinniCore/swg/game/game.cpp` — getPlayer/isOver/mainLoopCounter (:41-98), getPlayerLookAtTargetObject (:656-678)
- `D:/Code/Utinni/UtinniCore/swg/misc/network.cpp` — getObjectById RVAs (:30-58)
- `D:/Code/Utinni/UtinniCore/swg/misc/swg_math.h` — Transform `float[3][4]` (:69), Vector (:47-50)
- `D:/Code/swg-client-v2/.../win32/engine_advertise.cpp` — provider export (:766-777), static-init race fix (:620-687)
- `D:/Code/Utinni/UtinniCore/swg/engine_hookpoints.h` — contract structs + version (:71-93)
- `packages/native-core/{CMakeLists.txt,cmake-js.json,src/addon.cpp,src/sab-rw.cpp}` — established host-addon + SAB pattern
- `packages/contracts/src/sab-layout.ts` — existing SAB byte-offset contract pattern
- `docs/04-live-sync/live-memory-and-ipc.md` — the cross-process SAB **falsification** + N-API surface shape + the 5 corrected bugs (used as a negative/cautionary source, NOT as code to port)

### Secondary (MEDIUM confidence)
- [CITED: learn.microsoft.com/.../process-security-and-access-rights] — OpenProcess/CreateRemoteThread access-right requirements; same-integrity vs higher-integrity injection (A1)

### Tertiary (LOW / UNVERIFIED — flagged for the planner)
- Legacy SWGEmu source addresses for networkId and the two isOver safety-flag globals — not in the files read; harvest before claiming the legacy gate complete
- `+1432` look-at offset and `allocate(160)` ctor size for the advertised build — build-specific, defer to Phase 5

---

## Metadata

**Confidence breakdown:**
- Inject/attach recipe: HIGH — read verbatim from the working launcher, with the rationale comments intact.
- Endpoint typedefs + advertised RVAs/names: HIGH — read from both consumer and provider source; cross-checked (Utinni binding ↔ swg-client-v2 advertise).
- Legacy-path sentinel sources: MEDIUM — 2 of 4 verified (mainLoopCounter, template); 2 of 4 [UNVERIFIED] (networkId, isOver globals).
- Cross-process channel mechanism: HIGH that SAB-cross-process is impossible (project-proven); MEDIUM on the exact file-mapping ownership/seqlock design (synthesis, needs plan lock).
- Package/build layout: MEDIUM — sound recommendation, but it is explicitly Claude's-discretion / planner's call, and the x86 toolset is unverified.
- Elevation model: MEDIUM — standard Windows behavior, MS-Learn-cited, tagged A1.

**Research date:** 2026-06-25
**Valid until:** ~2026-07-25 for the Win32/MS-Learn material (stable); the harvested source is version-pinned to the local sibling repos and does not expire as long as those builds are the targets.
