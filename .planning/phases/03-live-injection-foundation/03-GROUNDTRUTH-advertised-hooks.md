# Phase 3 ground truth — swg-client-v2 advertised hooks (v0.9 primary path)

**Status:** LOCKED axioms — read from real source 2026-06-25. Do NOT contradict or re-derive.
Captured before discuss-phase/planning so fresh-context agents inherit it (de-anchoring protocol).

> **Maintainer direction (2026-06-25):** For **v0.9**, target the *advertised* client
> (`swg-client-v2`, which the maintainer rewrote to advertise all hooks) + Utinni-style
> consumption — **proven working**. The stock-**SWGEmu (legacy) client** comes *after* v0.9 in
> sequencing, but it is **already a solved, proven-on-this-machine problem in Utinni**: its engine
> entry points are **known hardcoded RVAs baked as literals in Utinni source** (e.g.
> `object.cpp: getTransform_o2w = (pGetTransform_o2w)0x00B22C80;`, `createObject = …0x00B2E760;`),
> with the calling convention in each typedef. So the legacy path for SWG-Toolkit is a
> **harvest-the-known-offsets-from-Utinni-source** job, **NOT** AOB/signature reverse-engineering.
> **Neither v0.9 client requires AOB scanning** — advertised = name-keyed table; legacy = known RVAs.
> (Live AOB scanning would only matter for a *different/unknown* build, which is out of v0.9 scope.)
> This reframes ROADMAP Phase 3 **SC-2** (which says the *primary* resolver is AOB scanning) — see
> "ROADMAP impact".

---

## Supported builds — SCOPE FENCE (maintainer-confirmed 2026-06-25)

This milestone supports **exactly two client builds. No others.**

| # | Build | Resolution mechanism | Status |
|---|-------|----------------------|--------|
| 1 | **swg-client-v2** (advertised client) | name-keyed `GetEngineHookPoints` table | v0.9 **primary** target |
| 2 | **SWGEmu legacy client** | **known hardcoded RVAs**, harvested from Utinni source | post-v0.9; already proven in Utinni |

**OUT OF SCOPE (do NOT plan for it):** AOB/signature scanning, build-hash keying, and
"attach successfully on a *different/unknown* client build." Both supported builds have a
deterministic, already-known address source — there is nothing to scan. A third/unknown build is a
future milestone, not this one.

---

## The contract (name-keyed engine entry-point advertisement)

`swg-client-v2` exports, from the **client EXE** (not a DLL), an undecorated C entry point that
hands an injected overlay a **name → address** table of engine functions/globals. Resolution is
**by name**, so it survives every client rebuild — no hardcoded RVAs for the advertised client.

### Provider side (swg-client-v2)
- Shared contract header: `src/game/client/application/SwgClient/src/shared/engine_hookpoints.h`
  - `struct EngineHookPoint { const char* name; void* addr; };`
  - `struct EngineHookPoints { unsigned version; unsigned count; const EngineHookPoint* entries; };`
  - `#define ENGINE_HOOKPOINTS_VERSION 6` — currently **99 names** (advisory; contract is name-keyed).
- Export (the file the maintainer wrote):
  `src/game/client/application/SwgClient/src/win32/engine_advertise.cpp`
  - `extern "C" __declspec(dllexport) const EngineHookPoints* __cdecl GetEngineHookPoints();` (`engine_advertise.cpp:771-777`).
    `dllexport` alone forces the undecorated name — no `.def`/`/EXPORT`.
  - Each row's `addr` is taken at **compile time** (`&Symbol` or a thunk) → correct by construction.
  - **32-bit ONLY** — whole TU is `#if !defined(_WIN64)` (`:61`, `:779`); x64 is deferred. The v0.9
    target client is **x86**.
  - **Static-init race fix (matters for the consumer):** 29 "call rows" ship as `{name, 0}`
    placeholders and are filled lazily by `ensureDynamicRowsFilled()` **on the reader's thread**
    inside `GetEngineHookPoints()` (`:636-687`, `:773-777`). A consumer that reads the raw static
    table from a remote thread *before* the exe's CRT `_initterm` runs sees a half-built table
    (the historical "40/96" symptom). **Always resolve via a call to `GetEngineHookPoints()`, never
    by scraping the static array.**

### Consumer side (Utinni — the working reference)
- `UtinniCore/swg/endpoints.h` + `endpoints.cpp` + `endpoints_bindings.cpp`:
  - `resolveFromExe()` = `GetProcAddress(GetModuleHandleA(NULL), "GetEngineHookPoints")`
    (`GetModuleHandle(NULL)` = the host **EXE**, because the export lives in the exe).
  - If present → `resolve(table, bindings, count)` overwrites per-subsystem fn-pointer literals
    **by name**; a missing name leaves the slot at its RVA literal (never nulls a slot — graceful).
  - If **absent** (stock SWGEmu) → strict **no-op**, hardcoded-RVA path unchanged (`D-00`).
  - `isAdvertisedClient()` / `installable(target)` gate each subsystem's detour install.
  - Version mismatch = soft warning; still resolves by name.

### Injection / attach idiom (Utinni `Launcher/main.cpp`) — the working recipe
1. `CreateProcess(..., CREATE_SUSPENDED)`.
2. Read PE entry RVA; **resolve the real ASLR base** from `PEB.ImageBaseAddress` via the suspended
   thread's `EBX+0x08` (x86) — the advertised `SwgClient_r.exe` is `/DYNAMICBASE` (DllCharacteristics
   `0x8140`); preferred `ImageBase` is wrong. Fixed-base `SWGEmu.exe` (`0x0000`) → `0x00400000`
   (`main.cpp:222-248`).
3. Patch entry with `EB FE` (spin), `FlushInstructionCache`, `ResumeThread`, poll `EIP == entry`.
4. Classic DLL inject: `VirtualAllocEx` + `WriteProcessMemory`(dll path) + `CreateRemoteThread(LoadLibraryA)`.
5. `CreateRemoteThread` on the payload's `utinni_init` (remote addr = remote base + local-resolved offset).
6. Named-event sync (`Local\UtinniReady_<pid>`, 30s) → `SuspendThread` → restore original entry bytes →
   `ResumeThread`. (Injection happens on the launcher thread, init runs on a fresh remote thread —
   not in `DllMain`.)

---

## What this means for SWG-Toolkit Phase 3 (open design Qs for discuss-phase — do NOT pre-decide here)

- **Resolution = exported table by name** for v0.9, not AOB. Endpoints relevant to "read-verify before
  write" already exist in the catalog: `game::getPlayer`, `game::getPlayerCreatureObject`,
  `object::getTransform_o2w`, `object::getNetworkId`, `object::getObjectTemplateName`,
  `game::g_runningFlags`(→`isOver`), `game::g_mainLoopCounter`.
- **Architecture fork (the big one):** Utinni runs an **in-process native DLL** (UtinniCore.dll) that
  calls `GetEngineHookPoints` in-process. SWG-Toolkit is Electron + N-API. Three candidate shapes:
  - (A) build a SWG-Toolkit **agent DLL** injected into the client (mirrors Utinni; needed eventually
    to *call* engine fns for the Phase-5 WYSIWYG SAB channel);
  - (B) **cross-process read-only**: `CreateRemoteThread(GetEngineHookPoints)` → `GetExitCodeThread`
    (EAX = table ptr) → `ReadProcessMemory` the struct + entries → resolve names → `ReadProcessMemory`
    at resolved addresses for read-verify. Sufficient for Phase 3 (read-only), no in-proc code-run;
  - (C) wrap/reuse UtinniCore.dll directly.
  Phase 3 is **read-verify only** (LIVE-03 gizmo write is Phase 5), so (B) may carry v0.9 — but (A)
  is the eventual home. **Maintainer decides in discuss-phase.**
- **Calling-convention landmines** (if/when calling, not just reading): `__thiscall` emulated as
  `__fastcall(pThis /*ECX*/, dummy /*EDX*/, args)`; **detoured** rows advertise the *real* entry
  (`pmfRealEntry`, delta==0), **called** rows use forwarders; **virtual** methods are SKIPPED
  (resolve off the live vtable). Consumer typedefs must match MSVC's emitted convention exactly.
- **Arch match:** target is x86 → a SWG-Toolkit agent DLL (option A) must be x86; cross-process
  RPM/WPM (option B) works x64→x86 under WOW64.
- **`isAdvertisedClient()` gating** is the clean detect: export present → advertised client (v0.9
  path); absent → SWGEmu (deferred). This is the natural "graceful degrade / file-patch fallback"
  (LIVE-05) trigger too.

## ROADMAP impact (flag for the maintainer — not yet applied)
Phase 3 **SC-2** currently reads: *"resolves target addresses at runtime via signature/AOB scanning
(mined from Utinni, build-hash-keyed) … attaches successfully on a different client build."* This is
**FALSIFIED for the v0.9 clients** — neither uses AOB scanning:
- **Advertised client (swg-client-v2, v0.9 primary):** name-keyed resolution via `GetEngineHookPoints`.
- **Legacy SWGEmu client (post-v0.9):** **known hardcoded RVAs** already implemented + proven in
  Utinni source — a **harvest-from-source** job, not scanning.

AOB/build-hash scanning is only relevant to a *different/unknown* build (out of v0.9 scope). SC-2
should be re-scoped/split accordingly when Phase 3 is discussed/planned.

## Source citations (ground truth)
- `D:/Code/swg-client-v2/src/game/client/application/SwgClient/src/shared/engine_hookpoints.h`
- `D:/Code/swg-client-v2/src/game/client/application/SwgClient/src/win32/engine_advertise.cpp` (export `:771-777`; race fix `:636-687`; 32-bit guard `:61`/`:779`)
- `D:/Code/Utinni/UtinniCore/swg/engine_hookpoints.h` (byte-identical shared copy)
- `D:/Code/Utinni/UtinniCore/swg/endpoints.h` / `endpoints.cpp` / `endpoints_bindings.cpp`
- `D:/Code/Utinni/Launcher/main.cpp` (attach/inject idiom; ASLR base via PEB `:222-248`)
- **Legacy SWGEmu known-RVA literals** (proven working): `D:/Code/Utinni/UtinniCore/swg/**/*.cpp`
  — e.g. `object/object.cpp:43-146` (`getTransform_o2w = …0x00B22C80`, `createObject = …0x00B2E760`,
  `ctor = …0x00B21B80`), `game/game.cpp`, `scene/world_snapshot.cpp`, etc. Typedefs carry the
  calling convention (`__cdecl`/`__thiscall`). Harvest these; do not re-derive.
- swg-client-v2 planning context: `.planning/phases/37-…getenginehookpoints/`, `38-…advertised-client-coverage-completion/`; Utinni: `.planning/phases/24-client-entry-point-advertisement-getenginehookpoints/`
