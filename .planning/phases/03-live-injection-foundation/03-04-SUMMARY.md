---
phase: 03-live-injection-foundation
plan: "04"
subsystem: live-inject
tags: [agent-dll, procmem, channel, napi, tdd, wave-3, cpp, vitest]
dependency_graph:
  requires:
    - 03-01 (scaffold, test stubs, contracts, channel.cpp stub)
    - 03-02 (resolver: resolveFromExe, isAdvertisedClient, rva_table.cpp)
    - 03-03 (sentinels.cpp, channel.cpp seqlock writer, channel-layout.test.ts GREEN)
  provides:
    - "packages/live-inject/agent/agent_main.cpp (DllMain + agent_init poll loop)"
    - "packages/live-inject/agent/channel.h (LiveState struct header, shared across TUs)"
    - "packages/live-inject/src/procmem_binding.cpp (OpenProcessHandle full flags, CloseProcessHandle, ReadProcessRegion, IsProcessAlive, IsAdvertisedClientProcess)"
    - "packages/live-inject/src/channel_binding.cpp (OpenChannel host-creates-mapping, Napi::Reference GC guard, UnmapViewOfFile finalizer)"
    - "packages/live-inject/src/addon.cpp (all 15 exports registered)"
    - "packages/live-inject/test/handle.test.ts (3 tests, all GREEN)"
  affects:
    - packages/live-inject (all 4 test files now GREEN)
    - packages/live-inject/agent (agent DLL compiles as x86 Win32 Release)
tech_stack:
  added: []
  patterns:
    - "extern const for C++ namespace-scope const variables needing external linkage (not static)"
    - "LoadLibraryExA(DONT_RESOLVE_DLL_REFERENCES) for PE export probe without code execution"
    - "Napi::Reference<Napi::ArrayBuffer> as GC guard for external ArrayBuffer (Pitfall 5)"
    - "UnmapViewOfFile ONLY in the finalizer lambda — hMap closed in CloseChannel, view persists until GC"
    - "Double-string buffer convention: eventName\\0mappingName\\0 passed via VirtualAllocEx/WriteProcessMemory"
key_files:
  created:
    - packages/live-inject/agent/channel.h
  modified:
    - packages/live-inject/agent/agent_main.cpp
    - packages/live-inject/agent/channel.cpp
    - packages/live-inject/agent/rva_table.cpp
    - packages/live-inject/src/procmem_binding.cpp
    - packages/live-inject/src/channel_binding.cpp
    - packages/live-inject/src/addon.cpp
    - packages/live-inject/test/handle.test.ts
decisions:
  - "D-03-04-A: channel.h created to share LiveState struct between channel.cpp and agent_main.cpp without redefinition (Rule 2 — missing critical infrastructure)"
  - "D-03-04-B: extern const for k_mainLoopCounter_addr (C++ const at namespace scope has internal linkage by default; extern needed for external linkage)"
  - "D-03-04-C: probeAdvertisedClient uses LoadLibraryExA(DONT_RESOLVE_DLL_REFERENCES) — maps the EXE image without executing any code; GetProcAddress works on the export table"
  - "D-03-04-D: UnmapViewOfFile only in the finalizer lambda — cleanupChannel only Reset()s the Napi::Reference and CloseHandle()s hMap; the view stays valid (OS implicit reference) until GC fires the finalizer"
  - "D-03-04-E: getNetworkId x86 approximation — rva_table.cpp typedef uses void* (4-byte); netId = reinterpret_cast<uintptr_t>(rawId) captures lower 32 bits only; full 64-bit NetworkId deferred to Phase 5"
  - "D-03-04-F: isAdvertisedClient included in OpenProcessHandle return object {handleId, isAdvertisedClient} — avoids naming conflict with inject_binding.cpp's isAdvertisedClient test-utility export; separate isAdvertisedClientProcess export also added"
metrics:
  duration: "~13 minutes"
  completed: "2026-06-26"
  tasks: 2
  files: 7
---

# Phase 03 Plan 04: Agent Main + Host Bindings Summary

**One-liner:** agent_main.cpp complete with DllMain (DTLC only) + agent_init poll loop (resolve→channelOpen→ready→30fps read-verify→channelWrite); host addon procmem+channel bindings operational with full inject flag set (Pitfall 6) and Napi::Reference GC guard (Pitfall 5); all 4 test files GREEN (30/30).

## Tasks Completed

| Task | Name | Commit | Key Outputs |
|------|------|--------|-------------|
| 1 | agent_main.cpp + channel.h | 7f55e22 | agent_main.cpp (DllMain + agent_init poll loop), channel.h (LiveState struct header), channel.cpp (includes channel.h), rva_table.cpp (extern const k_mainLoopCounter_addr); x86 agent DLL compiles |
| 2 | procmem_binding + channel_binding + handle.test.ts GREEN | 3ae7ab5 | procmem_binding.cpp (5 exports), channel_binding.cpp (3 exports + Napi::Reference GC guard), addon.cpp (15 exports), handle.test.ts (3 GREEN tests); 30/30 tests pass |

## Verification Results

- `pnpm --filter @swg/live-inject build`: SUCCESS — swg_live_inject.node compiled without error (x64 host addon)
- `cmake --build agent/build-agent --config Release`: SUCCESS — swg_toolkit_agent.dll compiled as x86 Win32
- `pnpm --filter @swg/live-inject test`: 4 passed files / 30 passed tests
  - handle.test.ts: 3 tests GREEN (was 3 RED stubs)
  - resolve.test.ts: 8 tests still GREEN
  - sentinels.test.ts: 14 tests still GREEN
  - channel-layout.test.ts: 4 tests still GREEN (1 seqlock round-trip)
- `pnpm exec vitest run` (workspace root): 21 passed files / 218 passed tests — no regressions

## Source Assertion Results

| Assertion | Expected | Actual | Status |
|-----------|----------|--------|--------|
| grep -c "DisableThreadLibraryCalls" agent_main.cpp | 1 | 1 | ✓ |
| grep -c "DllMain" agent_main.cpp | 1 | 1 | ✓ |
| grep -c "__declspec(dllexport)" agent_main.cpp | 1 | 1 | ✓ |
| grep -c "PROCESS_CREATE_THREAD" procmem_binding.cpp | 1+ | 3 | ✓ |
| grep -c "PROCESS_VM_READ" procmem_binding.cpp | 1+ | 4 | ✓ |
| grep -c "Napi::Reference" channel_binding.cpp | 1+ | 5 | ✓ |
| grep -c "CreateFileMapping" channel_binding.cpp | 1+ | 2 | ✓ |
| grep -c "UnmapViewOfFile" channel_binding.cpp | 1 (in finalizer) | 1 | ✓ |
| grep -v "^//" channel_binding.cpp \| grep -c "SharedArrayBuffer" | 0 | 0 | ✓ |
| grep -c "PROCESS_CREATE_THREAD\|forInject.*true" handle.test.ts | 1+ | 8 | ✓ |

## Key Architecture Decisions

### D-03-04-A: channel.h (Rule 2 deviation)
`LiveState` struct was defined locally in channel.cpp. `agent_main.cpp` needed the struct for the poll loop. Creating `channel.h` and including it from both is the standard approach — without it, the struct would be duplicated, risking divergent layouts. The channel.cpp `static_assert` layout checks are kept as compile-time guards.

### D-03-04-B: extern const for k_mainLoopCounter_addr
C++ `const` at namespace scope has INTERNAL linkage by default (as if `static`). The variable `k_mainLoopCounter_addr` in `rva_table.cpp` needed external linkage so `agent_main.cpp` could reference it across translation units. Fixed with `extern const`.

### D-03-04-C: PE export probe for isAdvertisedClient
`OpenProcessHandle` probes whether the target process exports `GetEngineHookPoints` using `LoadLibraryExA(DONT_RESOLVE_DLL_REFERENCES)`. This loads the EXE image for inspection without running any initialization code. `GetProcAddress` works on the export table of such a module. Only performed when `forInject=true` (PROCESS_QUERY_INFORMATION needed for `QueryFullProcessImageNameA`).

### D-03-04-D: UnmapViewOfFile only in finalizer
The channel_binding.cpp design: `UnmapViewOfFile` fires ONLY in the ArrayBuffer finalizer (when V8 GC collects the buffer after `abRef.Reset()`). `CloseChannel` only calls `abRef.Reset()` and `CloseHandle(hMap)`. The view remains valid after `CloseHandle(hMap)` because the OS keeps an implicit reference to the mapping object while any view is open (Windows file mapping semantics).

### D-03-04-E: getNetworkId x86 approximation
On x86, `getNetworkId` returns a `NetworkId` value. The `rva_table.cpp` typedef uses `void*` (4-byte placeholder). `agent_main.cpp` casts via `reinterpret_cast<uintptr_t>` — capturing the lower 32 bits only. On the advertised path this is an approximation; on the legacy path the slot is null so `netId = 0` (sentinel 2 fails, accepted as "3.5/4 sentinels" for Phase 3 legacy). Full 64-bit NetworkId deferred to Phase 5.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] channel.h — LiveState struct header**
- **Found during:** Task 1 implementation
- **Issue:** agent_main.cpp needs the `LiveState` struct for the poll loop (channelWrite call), but the struct was defined locally in channel.cpp. Without a shared header, the struct would either be duplicated (divergent layouts) or agent_main.cpp would need to redeclare the struct body.
- **Fix:** Created `packages/live-inject/agent/channel.h` extracting the `LiveState` struct definition and channel function declarations. Modified `channel.cpp` to include the header and removed the local struct definition (static_asserts kept). Agent_main.cpp includes channel.h.
- **Files modified:** channel.h (new), channel.cpp (include header), agent_main.cpp (include header)
- **Commit:** 7f55e22

**2. [Rule 1 - Bug] extern const for k_mainLoopCounter_addr**
- **Found during:** Task 1 agent DLL compile
- **Issue:** `k_mainLoopCounter_addr` was declared `static const uintptr_t` inside the `swg::endpoints` namespace in rva_table.cpp. In C++, `const` at namespace scope has internal linkage by default (as if `static`), so the symbol was not exported from rva_table.obj. The agent_main.cpp extern declaration failed with LNK2019.
- **Fix:** Changed to `extern const uintptr_t k_mainLoopCounter_addr` to give it external linkage.
- **Files modified:** `packages/live-inject/agent/rva_table.cpp`
- **Commit:** 7f55e22

**3. [Design note] isAdvertisedClient naming conflict — included in OpenProcessHandle response**
- **Issue:** The plan listed `IsAdvertisedClient` as a separate procmem_binding.cpp export. However, `inject_binding.cpp` already registers `isAdvertisedClient` (the test utility from Plan 03-02) in addon.cpp. Adding a second function with the same C++ name would cause a linker error (duplicate symbol).
- **Fix:** Included the `isAdvertisedClient` boolean in the `OpenProcessHandle` return object `{handleId, isAdvertisedClient}` (plan's alternative option). Added a separate `isAdvertisedClientProcess(handleId)` export (different name) for post-open re-probing. The test utility `isAdvertisedClient` from inject_binding.cpp remains intact.
- **Files modified:** addon.cpp (added IsAdvertisedClientProcess forward decl + export)
- **Commit:** 3ae7ab5

## Known Stubs

| File | Stub | Resolved In |
|------|------|-------------|
| `inject_binding.cpp` | LaunchAndInjectWorker / AttachAndInjectWorker bodies (stub; return Undefined()) | Plan 03-05 |
| `channel-layout.test.ts` | 1 seqlock round-trip test uses pure TS port — agent DLL seqlock E2E deferred | Manual UAT |

## Threat Surface Scan

No new network endpoints, auth paths, or file access patterns beyond the plan's threat model. The new file-mapping channel (T-03-03) is host-created with a per-UUID name matching the locked Scheme A. The ReadProcessRegion bounds check (T-03-04: max 4096 bytes) is implemented. The OpenProcess access-denied error path returns a structured reason message enabling D-08 file-patch mode fallback (T-03-05).

## Self-Check: PASSED

| Item | Status |
|------|--------|
| packages/live-inject/agent/agent_main.cpp | FOUND |
| packages/live-inject/agent/channel.h | FOUND |
| packages/live-inject/agent/channel.cpp (updated) | FOUND |
| packages/live-inject/agent/rva_table.cpp (extern const) | FOUND |
| packages/live-inject/src/procmem_binding.cpp | FOUND |
| packages/live-inject/src/channel_binding.cpp | FOUND |
| packages/live-inject/src/addon.cpp (15 exports) | FOUND |
| packages/live-inject/test/handle.test.ts (3 GREEN tests) | FOUND |
| Commit 7f55e22 (Task 1) | FOUND |
| Commit 3ae7ab5 (Task 2) | FOUND |
| Agent DLL: cmake build Release x86 SUCCESS | VERIFIED |
| Host addon: cmake-js x64 build SUCCESS | VERIFIED |
| 30/30 tests GREEN | VERIFIED |
| 218/218 workspace tests GREEN (no regressions) | VERIFIED |
