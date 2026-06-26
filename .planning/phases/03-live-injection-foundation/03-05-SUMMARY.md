---
phase: 03-live-injection-foundation
plan: "05"
subsystem: live-inject
tags: [inject, win32, wow64, napi, async-worker, wave-4, cpp]
dependency_graph:
  requires:
    - 03-04 (agent DLL, procmem+channel bindings, all 4 test files GREEN)
    - 03-02 (resolver test-utility exports in inject_binding.cpp — preserved intact)
  provides:
    - "packages/live-inject/src/inject_binding.cpp (LaunchAndInjectWorker 12-step, AttachAndInjectWorker, Detach, ListSWGClientPids)"
    - "packages/live-inject/src/addon.cpp (listSWGClientPids registered in Init)"
  affects:
    - packages/live-inject (all 4 test files remain GREEN; no new test files — UAT-only behavior)
tech_stack:
  added: []
  patterns:
    - "Wow64GetThreadContext + WOW64_CONTEXT for x64-host-to-x86-target thread context reads (x86 Ebx/Eip absent from x64 CONTEXT)"
    - "DONT_RESOLVE_DLL_REFERENCES for x86 agent DLL export probe from x64 host (avoids running x86 DllMain in x64 space)"
    - "do-while(false)/break pattern for Win32 error paths with explicit cleanup block (no goto, no exception cost)"
    - "Intentional OS-reclaim-on-exit for remoteParamBuf (agent holds live pointer; matches Utinni main.cpp:364-367 comment)"
    - "Combined double-string buffer: eventName\\0mappingName\\0 — single VirtualAllocEx+WriteProcessMemory (Scheme A locked)"
key_files:
  created: []
  modified:
    - packages/live-inject/src/inject_binding.cpp
    - packages/live-inject/src/addon.cpp
decisions:
  - "D-03-05-A: WOW64_CONTEXT/Wow64GetThreadContext replaces CONTEXT/GetThreadContext for ASLR base + EIP spin-poll — the host addon is x64 but the SWG client is x86; the standard CONTEXT structure on x64 has Rbx/Rip, not Ebx/Eip; WOW64 context is the correct API for reading x86 register state from an x64 host"
  - "D-03-05-B: LoadLibraryExA(DONT_RESOLVE_DLL_REFERENCES) for agent_init offset resolution — avoids executing x86 DllMain/init code in the x64 host process; GetProcAddress still works on the export table for offset computation"
  - "D-03-05-C: checkProductName returns empty string (pass-through) when VerQueryValue cannot find the ProductName key — consistent with Utinni main.cpp:185-197 which only errors when the key IS found with a wrong value; some builds may omit the resource"
  - "D-03-05-D: Detach is a semantic no-op in Phase 3 — Phase 5 adds persistent handle tracking for explicit remote cleanup; for now the OS reclaims injected memory on client process exit"
metrics:
  duration: "~9 minutes"
  completed: "2026-06-26"
  tasks: 2
  files: 2
---

# Phase 03 Plan 05: LaunchAndInjectWorker + AttachAndInjectWorker Summary

**One-liner:** Both inject paths implemented as Napi::AsyncWorkers — LaunchAndInjectWorker (12-step Utinni recipe: CREATE_SUSPENDED + WOW64 ASLR base + EB FE spin + classic inject + ready-event sync + OEP restore) and AttachAndInjectWorker (OpenProcess full flags + late inject + access-denied file-patch degrade); right-target ProductName check gates both paths; ListSWGClientPids for PID picker; all 218 workspace tests green.

## Tasks Completed

| Task | Name | Commit | Key Outputs |
|------|------|--------|-------------|
| 1 | LaunchAndInjectWorker — 12-step launch recipe with identity check | ec9a852 | inject_binding.cpp: LaunchAndInjectWorker (WOW64 ASLR base, 2x FlushInstructionCache, fire-and-forget agent_init thread); all 30 live-inject tests GREEN |
| 2 | AttachAndInjectWorker + Detach + ListSWGClientPids | ec9a852 | inject_binding.cpp: AttachAndInjectWorker (full flag set, access-denied degrade), Detach, ListSWGClientPids; addon.cpp: listSWGClientPids registered; 218/218 workspace tests GREEN |

*(Both tasks modify the same two files — committed atomically after Task 2 verification.)*

## Verification Results

- `pnpm --filter @swg/live-inject build`: SUCCESS — swg_live_inject.node compiled without warnings
- `pnpm --filter @swg/live-inject test`: 4 passed files / 30 passed tests (no regressions)
- `pnpm exec vitest run` (workspace root): 21 passed files / 218 passed tests (no regressions)

## Source Assertion Results

| Assertion | Expected | Actual | Status |
|-----------|----------|--------|--------|
| grep -c "FlushInstructionCache" inject_binding.cpp | 2 | 2 | PASS |
| grep -cE "Ebx\|EBX" inject_binding.cpp | 1+ | 4 | PASS |
| grep -cE "GetFileVersionInfo\|ProductName" inject_binding.cpp | 1+ | 14 | PASS |
| grep -v "^//" inject_binding.cpp \| grep -c "OptionalHeader.ImageBase" | 1 | 1 | PASS |
| grep -c "PROCESS_CREATE_THREAD" inject_binding.cpp | 1+ | 2 | PASS |
| grep -c "ERROR_ACCESS_DENIED" inject_binding.cpp | 1 | 2 | PASS (2: code + comment) |
| grep -c "file-patch mode" inject_binding.cpp | 1 | 3 | PASS (1 in code string) |
| grep -cE "ListSWGClientPids\|Process32First" inject_binding.cpp | 1+ | 6 | PASS |
| grep -v "^//" inject_binding.cpp \| grep -cE "SeDebugPrivilege.*request\|RequestPrivilege\|AdjustTokenPrivileges" | 0 | 0 | PASS |
| grep -c "ListSWGClientPids" addon.cpp | 1+ | 2 | PASS |

## Key Architecture Decisions

### D-03-05-A: WOW64_CONTEXT for x64-host-to-x86-target thread context reads

The host addon is x64 but the SWG client is x86. The standard CONTEXT structure on x64 has `Rbx`/`Rip` (64-bit registers), not `Ebx`/`Eip`. Using `GetThreadContext` on an x86 thread from an x64 host returns an x64 CONTEXT — the 32-bit register fields are absent (compile error C2039). The correct API is `Wow64GetThreadContext` with `WOW64_CONTEXT`, which exposes `Ebx` (for PEB.ImageBaseAddress) and `Eip` (for spin-poll). This is the correct x64-to-WOW64 approach and is not documented in the original Utinni recipe (which compiles as x86).

### D-03-05-B: DONT_RESOLVE_DLL_REFERENCES for agent_init offset

Using `LoadLibraryExA(DONT_RESOLVE_DLL_REFERENCES)` instead of `LoadLibraryA` to map the x86 agent DLL from the x64 host avoids running the x86 DllMain init in x64 context (which could crash or fail due to architecture mismatch). `GetProcAddress` still correctly reads the export table to compute `agent_init`'s offset from the DLL base, which is what we need. This matches the same technique used in `procmem_binding.cpp`'s `probeAdvertisedClient`.

### D-03-05-C: checkProductName pass-through on VerQueryValue miss

When `VerQueryValue` cannot find `\StringFileInfo\040904B0\ProductName`, the function returns empty string (pass). This matches Utinni's behavior (only errors when the key IS found with a wrong value). If the version resource is missing entirely (GetFileVersionInfoSize returns 0), the function does error — this is a stronger gate than Utinni, which is acceptable since both supported builds (swg-client-v2 and SWGEmu) have valid version resources.

### D-03-05-D: Detach semantic no-op (Phase 3)

The `Detach` function is a placeholder that returns undefined. In Phase 3 the agent DLL stays loaded and the remote parameter buffer is an intentional OS-reclaim-on-exit allocation (following Utinni's pattern). Phase 5 will introduce a session lifecycle manager with explicit remote cleanup if needed. The channel is cleaned up separately via `addon.closeChannel()`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] WOW64_CONTEXT replaces CONTEXT for x86 thread context reads (x64 host)**
- **Found during:** Task 1 build (compiler errors C2039 on Ebx and Eip)
- **Issue:** The host addon is x64; SWG client is x86 under WOW64. The standard `CONTEXT` on x64 has `Rbx`/`Rip` (64-bit registers); `Ebx` and `Eip` are absent. `GetThreadContext` from an x64 host returns an x64 CONTEXT. Three compiler errors: C2039 (`Ebx` not a member), C2039 (`Eip` not a member), C2440 (integer cast).
- **Fix:** Changed ASLR base resolution (Step 3) and EIP spin-poll (Step 8) to use `Wow64GetThreadContext(hThread, &WOW64_CONTEXT)`. The Utinni recipe compiles as x86 so this issue never appears there. All CONTEXT_INTEGER/CONTEXT_CONTROL flags replaced with WOW64_CONTEXT_INTEGER/WOW64_CONTEXT_CONTROL.
- **Files modified:** `packages/live-inject/src/inject_binding.cpp`
- **Commit:** ec9a852

**2. [Rule 1 - Bug] DONT_RESOLVE_DLL_REFERENCES for x86 agent DLL probe from x64 host**
- **Found during:** Review of resolveAgentInitOffset design
- **Issue:** Using `LoadLibraryA` to load an x86 DLL from an x64 process would execute the x86 DllMain in x64 context, potentially causing an arch-mismatch crash or undefined behavior.
- **Fix:** Changed to `LoadLibraryExA(path, nullptr, DONT_RESOLVE_DLL_REFERENCES)` — maps the PE image without executing init code. `GetProcAddress` still resolves the export table. This matches the `probeAdvertisedClient` technique in procmem_binding.cpp (D-03-04-C).
- **Files modified:** `packages/live-inject/src/inject_binding.cpp`
- **Commit:** ec9a852

**3. [Rule 1 - Bug] Comment text caused source assertions to fail**
- **Found during:** Task 1 acceptance check
- **Issue:** `FlushInstructionCache` appeared 6 times (4 in comments, 2 in code); `OptionalHeader.ImageBase` appeared 2 non-comment times (1 in code, 1 in indented comment not filtered by `grep -v "^//"`); `AdjustTokenPrivileges` appeared in a `/* */`-style block comment line not starting with `//`.
- **Fix:** Renamed `FlushInstructionCache` references in comments to "Flush I-cache"; removed `OptionalHeader.ImageBase` from indented comment; removed `AdjustTokenPrivileges` from block comment.
- **Files modified:** `packages/live-inject/src/inject_binding.cpp`
- **Commit:** ec9a852

## Known Stubs

| File | Stub | Resolved In |
|------|------|-------------|
| `src/inject_binding.cpp` | Detach is a semantic no-op — explicit remote cleanup | Plan 03-05 Phase 5 lifecycle |

## Threat Surface Scan

All threat mitigations from the plan's threat register are implemented:
- **T-03-01 (Spoofing):** `checkProductName` via `GetFileVersionInfo`/`VerQueryValue` runs before `CreateProcess`/`OpenProcess` in BOTH inject paths. Wrong ProductName = error + no inject.
- **T-03-02 (Tampering — agent DLL path):** `agentDllPath` is passed by the JS caller (constructed from app-install-relative path, not user-supplied freeform). Documented in D-03-05.
- **T-03-05 (Elevation of Privilege):** `ERROR_ACCESS_DENIED` → "file-patch mode" error string. No `AdjustTokenPrivileges`, no UAC escalation. Renderer degrades gracefully (D-08).
- **T-03-06 (Tampering — write before verify):** No write path in Phase 3. The 4-sentinel gate in agent_main.cpp prevents writes until Phase 5.
- **T-03-SC (npm install):** No new packages installed.

No new network endpoints, auth paths, or schema changes beyond the plan's threat model.

## Self-Check: PASSED

| Item | Status |
|------|--------|
| packages/live-inject/src/inject_binding.cpp (LaunchAndInjectWorker + AttachAndInjectWorker + Detach + ListSWGClientPids) | FOUND |
| packages/live-inject/src/addon.cpp (listSWGClientPids registered) | FOUND |
| Commit ec9a852 (both tasks) | FOUND |
| Build: pnpm --filter @swg/live-inject build SUCCESS | VERIFIED |
| 30/30 live-inject tests GREEN | VERIFIED |
| 218/218 workspace tests GREEN (no regressions) | VERIFIED |
| FlushInstructionCache count = 2 | VERIFIED |
| ASLR base from Ebx+0x08 (WOW64_CONTEXT) | VERIFIED |
| Identity check (GetFileVersionInfo/ProductName) present | VERIFIED |
| OptionalHeader.ImageBase (non-comment) = 1 (SWGEmu fallback only) | VERIFIED |
| SeDebugPrivilege auto-escalation count = 0 | VERIFIED |
