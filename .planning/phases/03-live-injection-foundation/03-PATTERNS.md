# Phase 3: Live-Injection Foundation - Pattern Map

**Mapped:** 2026-06-25
**Files analyzed:** 20 new/modified files (host addon + agent DLL + contracts + renderer + tests)
**Analogs found:** 17 / 20 (3 are greenfield Win32 with no in-repo analog)

---

## File Classification

| New / Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---------------------|------|-----------|----------------|---------------|
| `packages/live-inject/CMakeLists.txt` | config | build | `packages/native-core/CMakeLists.txt` | exact |
| `packages/live-inject/cmake-js.json` | config | build | `packages/native-core/cmake-js.json` | exact |
| `packages/live-inject/src/addon.cpp` | config | request-response | `packages/native-core/src/addon.cpp` | exact |
| `packages/live-inject/src/inject_binding.cpp` | service | request-response (async) | `packages/native-core/src/tre_binding.cpp` (AsyncWorker) | role-match |
| `packages/live-inject/src/procmem_binding.cpp` | service | request-response | `packages/native-core/src/sab-rw.cpp` | role-match |
| `packages/live-inject/src/channel_binding.cpp` | service | streaming | `packages/native-core/src/sab.cpp` | role-match |
| `packages/live-inject/agent/CMakeLists.txt` | config | build | `packages/native-core/CMakeLists.txt` (diverges: no cmake-js, x86) | partial |
| `packages/live-inject/agent/agent_main.cpp` | middleware | event-driven | *(none — greenfield injected DLL)* | none |
| `packages/live-inject/agent/resolve.cpp` + `resolve.h` | utility | request-response | `packages/native-core/src/sab-rw.cpp` (pure fn shape) | partial |
| `packages/live-inject/agent/rva_table.cpp` | utility | CRUD | *(none — pure data catalog)* | none |
| `packages/live-inject/agent/sentinels.cpp` + `sentinels.h` | utility | request-response | `packages/native-core/src/sab-rw.cpp` (pure fn over buffer) | partial |
| `packages/live-inject/agent/channel.cpp` | service | streaming | `packages/native-core/src/sab.cpp` (memory channel shape) | partial |
| `packages/contracts/src/live-inject.ts` | model | CRUD | `packages/contracts/src/ipc.ts` + `sab-layout.ts` | exact |
| `packages/renderer/src/panels/LiveInspectorPanel.tsx` | component | request-response | `packages/renderer/src/panels/InspectorPanel.tsx` | exact |
| `packages/renderer/src/state/liveStore.ts` | store | event-driven | `packages/renderer/src/state/treStore.ts` | exact |
| `packages/renderer/src/shell/StatusBar.tsx` *(MODIFY)* | component | request-response | itself (existing file) | exact |
| `packages/live-inject/test/resolve.spec.ts` | test | request-response | `packages/native-core/test/resolve-prebuild.test.ts` | role-match |
| `packages/live-inject/test/sentinels.spec.ts` | test | request-response | `packages/harness/test/iff-roundtrip.test.ts` | role-match |
| `packages/live-inject/test/channel-layout.spec.ts` | test | streaming | `packages/harness/test/iff-roundtrip.test.ts` | role-match |
| `packages/live-inject/test/handle.spec.ts` | test | request-response | `packages/native-core/test/resolve-prebuild.test.ts` | role-match |

---

## Pattern Assignments

---

### `packages/live-inject/CMakeLists.txt` (config, build)

**Analog:** `packages/native-core/CMakeLists.txt`

**Complete file (4 sections to copy verbatim, then diverge):**

**C++ standard block** (native-core/CMakeLists.txt lines 1-10 — copy exactly):
```cmake
cmake_minimum_required(VERSION 3.15)
project(swg_live_inject)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)
```

**cmake-js include + glob + shared lib** (lines 13-23 — copy, change project name):
```cmake
include_directories(${CMAKE_JS_INC})

file(GLOB SOURCE_FILES "src/*.cpp")

add_library(${PROJECT_NAME} SHARED ${SOURCE_FILES} ${CMAKE_JS_SRC})
set_target_properties(${PROJECT_NAME} PROPERTIES
    PREFIX ""
    SUFFIX ".node"
)
target_link_libraries(${PROJECT_NAME} ${CMAKE_JS_LIB})
```

**node-addon-api include paths** (lines 31-35 — copy exactly, workspace root pnpm layout):
```cmake
target_include_directories(${PROJECT_NAME} PRIVATE
    ${CMAKE_SOURCE_DIR}/node_modules/node-addon-api
    ${CMAKE_SOURCE_DIR}/../../node_modules/node-addon-api
)
```

**Compile definitions** (lines 44-50 — copy exactly, all three required):
```cmake
target_compile_definitions(${PROJECT_NAME} PRIVATE
    NAPI_DISABLE_CPP_EXCEPTIONS
    NAPI_VERSION=8
    NAPI_EXPERIMENTAL
)
```

**Divergence from native-core:** Do NOT add `add_subdirectory(modules/core)` or link `swg_core` / `swg_zlib` — live-inject has no format-tower static lib. The host addon's only non-cmake-js dependency is Win32 SDK headers (present via MSVC); `kernel32.lib` / `advapi32.lib` link implicitly.

---

### `packages/live-inject/cmake-js.json` (config, build)

**Analog:** `packages/native-core/cmake-js.json` (lines 1-4 — copy exactly):
```json
{
  "generator": "Visual Studio 17 2022",
  "platform": "x64"
}
```

The host addon is x64 (same as native-core). The agent DLL is a separate build entirely (see `agent/CMakeLists.txt` below) and is NOT built through cmake-js.

---

### `packages/live-inject/src/addon.cpp` (config, request-response)

**Analog:** `packages/native-core/src/addon.cpp`

**File-header block + includes + forward-decl shape** (lines 1-45):
```cpp
/**
 * addon.cpp — NODE_API_MODULE registration for swg_live_inject.
 *
 * [document the exports per binding file]
 */

#include <napi.h>

// Forward declarations (implemented in inject_binding.cpp)
Napi::Value LaunchAndInject(const Napi::CallbackInfo& info);
Napi::Value AttachAndInject(const Napi::CallbackInfo& info);
Napi::Value Detach(const Napi::CallbackInfo& info);

// Forward declarations (implemented in procmem_binding.cpp)
Napi::Value OpenProcessHandle(const Napi::CallbackInfo& info);
Napi::Value CloseProcessHandle(const Napi::CallbackInfo& info);
Napi::Value ReadProcessRegion(const Napi::CallbackInfo& info);
Napi::Value IsProcessAlive(const Napi::CallbackInfo& info);

// Forward declarations (implemented in channel_binding.cpp)
Napi::Value OpenChannel(const Napi::CallbackInfo& info);
Napi::Value CloseChannel(const Napi::CallbackInfo& info);
Napi::Value ReadChannelView(const Napi::CallbackInfo& info);
```

**Init function + NODE_API_MODULE** (lines 133-194 — copy shape):
```cpp
Napi::Object Init(Napi::Env env, Napi::Object exports) {
    // Inject/attach/detach
    exports.Set("launchAndInject", Napi::Function::New(env, LaunchAndInject));
    exports.Set("attachAndInject", Napi::Function::New(env, AttachAndInject));
    exports.Set("detach",          Napi::Function::New(env, Detach));

    // Process handle lifecycle
    exports.Set("openProcessHandle",  Napi::Function::New(env, OpenProcessHandle));
    exports.Set("closeProcessHandle", Napi::Function::New(env, CloseProcessHandle));
    exports.Set("readProcessRegion",  Napi::Function::New(env, ReadProcessRegion));
    exports.Set("isProcessAlive",     Napi::Function::New(env, IsProcessAlive));

    // File-mapping channel
    exports.Set("openChannel",     Napi::Function::New(env, OpenChannel));
    exports.Set("closeChannel",    Napi::Function::New(env, CloseChannel));
    exports.Set("readChannelView", Napi::Function::New(env, ReadChannelView));

    return exports;
}

NODE_API_MODULE(swg_live_inject, Init)
```

---

### `packages/live-inject/src/inject_binding.cpp` (service, async request-response)

**Analog:** `packages/native-core/src/tre_binding.cpp` — AsyncWorker pattern

**File-header + includes** (tre_binding.cpp lines 34-46 — adapt includes):
```cpp
#include <napi.h>
#include <Windows.h>
#include <TlHelp32.h>
#include <string>
#include <vector>
#include <memory>
#include <stdexcept>
```

**AsyncWorker class shape** (tre_binding.cpp lines 595-662 — copy structure verbatim):
```cpp
class LaunchAndInjectWorker : public Napi::AsyncWorker {
public:
    LaunchAndInjectWorker(Napi::Env env,
                          std::string clientExe,
                          std::string agentDllPath,
                          Napi::Promise::Deferred deferred)
        : Napi::AsyncWorker(env)
        , m_clientExe(std::move(clientExe))
        , m_agentDllPath(std::move(agentDllPath))
        , m_deferred(std::move(deferred))
    {}

    // Runs on the libuv threadpool (NOT the main thread — no Napi calls allowed here)
    void Execute() override {
        try {
            // Win32 launch-and-inject recipe (Utinni main.cpp:204-378):
            // 1. CreateProcess(CREATE_SUSPENDED)
            // 2. resolve ASLR base via PEB.ImageBaseAddress (EBX+0x08)
            // 3. save OEP, patch EB FE, FlushInstructionCache, ResumeThread, spin-poll EIP
            // 4. VirtualAllocEx + WriteProcessMemory(dllPath) + CreateRemoteThread(LoadLibraryA)
            // 5. resolve agent_init offset locally, CreateRemoteThread(remoteBase+offset, eventNamePtr)
            // 6. WaitForSingleObject(hReadyEvent, 30000)
            // 7. SuspendThread, restore OEP + FlushInstructionCache, ResumeThread
            // ... store m_pid on success
        } catch (const std::exception& ex) {
            SetError(ex.what());
        }
    }

    // Called on the main thread after Execute() completes
    void OnOK() override {
        Napi::Env env = Env();
        Napi::HandleScope scope(env);
        Napi::Object result = Napi::Object::New(env);
        result.Set("pid",    Napi::Number::New(env, m_pid));
        result.Set("handle", Napi::String::New(env, m_handle));
        m_deferred.Resolve(result);
    }

    void OnError(const Napi::Error& e) override {
        m_deferred.Reject(e.Value());
    }
private:
    std::string                m_clientExe;
    std::string                m_agentDllPath;
    Napi::Promise::Deferred    m_deferred;
    DWORD                      m_pid    = 0;
    std::string                m_handle;
};
```

**Dispatch function shape** (tre_binding.cpp lines 669-687):
```cpp
Napi::Value LaunchAndInject(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 2 || !info[0].IsString() || !info[1].IsString()) {
        Napi::TypeError::New(env, "launchAndInject: expected (clientExe: string, agentDllPath: string)")
            .ThrowAsJavaScriptException();
        return env.Undefined();
    }

    const std::string clientExe     = info[0].As<Napi::String>().Utf8Value();
    const std::string agentDllPath  = info[1].As<Napi::String>().Utf8Value();

    auto deferred = Napi::Promise::Deferred::New(env);
    Napi::Promise promise = deferred.Promise();

    auto* worker = new LaunchAndInjectWorker(env, clientExe, agentDllPath, std::move(deferred));
    worker->Queue();

    return promise;
}
```

**Win32 ingredient to harvest** (Utinni `Launcher/main.cpp:43-78` — classic inject inner step):
```cpp
// Classic DLL injection (the inner step — works for both launch and attach paths)
LPVOID lpMem = VirtualAllocEx(hProcess, nullptr, dllPath.length(),
                               MEM_COMMIT|MEM_RESERVE, PAGE_EXECUTE_READWRITE);
WriteProcessMemory(hProcess, lpMem, dllPath.c_str(), dllPath.length(), nullptr);
LPVOID pLoadLib = GetProcAddress(GetModuleHandle("kernel32.dll"), "LoadLibraryA");
HANDLE hThread = CreateRemoteThread(hProcess, nullptr, 0,
                    (LPTHREAD_START_ROUTINE)pLoadLib, lpMem, 0, nullptr);
WaitForSingleObject(hThread, INFINITE);
DWORD hRemoteModule; GetExitCodeThread(hThread, &hRemoteModule);
```

**ASLR base resolution to harvest** (Utinni `main.cpp:233-248`):
```cpp
// Read PEB.ImageBaseAddress from the suspended thread's EBX register (x86 only)
CONTEXT startCtx = {}; startCtx.ContextFlags = CONTEXT_INTEGER;
GetThreadContext(hThread, &startCtx);
DWORD remoteImageBase = 0;
ReadProcessMemory(hProcess, (LPCVOID)((DWORD)startCtx.Ebx + 0x08),
                  &remoteImageBase, sizeof(DWORD), nullptr);
// Fixed-base SWGEmu: DllCharacteristics == 0 → use OptionalHeader.ImageBase (0x00400000)
if (remoteImageBase == 0) remoteImageBase = peHeader->OptionalHeader.ImageBase;
```

**Named-event sync idiom to harvest** (Utinni `main.cpp:268-269`):
```cpp
// Create the ready event BEFORE patching (naming: "Local\\<Name>_<pid>")
HANDLE hReadyEvent = CreateEventA(nullptr, TRUE, FALSE, "Local\\SwgToolkitAgent_12345");
```

---

### `packages/live-inject/src/procmem_binding.cpp` (service, request-response)

**Analog:** `packages/native-core/src/sab-rw.cpp`

**Validate → extract → call → return ArrayBuffer shape** (sab-rw.cpp lines 29-67 for validation + tre_binding.cpp line 183 for ArrayBuffer return):
```cpp
Napi::Value ReadProcessRegion(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    // Argument validation — same pattern as sab-rw.cpp
    if (info.Length() < 3) {
        Napi::TypeError::New(env, "readProcessRegion: (handle: string, addr: number, byteCount: number) required")
            .ThrowAsJavaScriptException();
        return env.Undefined();
    }
    if (!info[0].IsString() || !info[1].IsNumber() || !info[2].IsNumber()) {
        Napi::TypeError::New(env, "readProcessRegion: type mismatch")
            .ThrowAsJavaScriptException();
        return env.Undefined();
    }

    // ... resolve handle → HANDLE, call ReadProcessMemory ...

    // ArrayBuffer return — same as tre_binding.cpp:183
    Napi::ArrayBuffer buf = Napi::ArrayBuffer::New(env, byteLen);
    ReadProcessMemory(hProcess, (LPCVOID)addr,
                      buf.Data(), byteLen, nullptr);
    return buf;
}
```

**OpenProcess flag set to harvest** (RESEARCH.md §Pitfall 6 — use the full set for inject):
```cpp
// For attach-to-running + inject path:
HANDLE hProcess = OpenProcess(
    PROCESS_CREATE_THREAD | PROCESS_QUERY_INFORMATION |
    PROCESS_VM_OPERATION  | PROCESS_VM_READ           | PROCESS_VM_WRITE,
    FALSE, pid);
// For read-only RPM after injection is complete, VM_READ alone suffices.
```

---

### `packages/live-inject/src/channel_binding.cpp` (service, streaming)

**Analog:** `packages/native-core/src/sab.cpp`

**Validate → allocate/open → return wrapper shape** (sab.cpp lines 19-36 — adapt):
```cpp
Napi::Value OpenChannel(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 1 || !info[0].IsString()) {
        Napi::TypeError::New(env, "openChannel: (mappingName: string) required")
            .ThrowAsJavaScriptException();
        return env.Undefined();
    }
    const std::string name = info[0].As<Napi::String>().Utf8Value();

    HANDLE hMap = OpenFileMappingA(FILE_MAP_READ, FALSE, name.c_str());
    if (!hMap) { /* throw Napi::Error ... */ }

    void* view = MapViewOfFile(hMap, FILE_MAP_READ, 0, 0, CHANNEL_BYTE_SIZE);
    if (!view) { CloseHandle(hMap); /* throw ... */ }

    // External ArrayBuffer over the mapped view with UnmapViewOfFile finalizer.
    // CRITICAL: hold a Napi::Reference to prevent GC dangling-pointer (RESEARCH Pitfall 5).
    auto ab = Napi::ArrayBuffer::New(env, view, CHANNEL_BYTE_SIZE,
        [](Napi::BasicEnv, void* data) { UnmapViewOfFile(data); });
    // Store handle + reference in per-channel state ...
    return ab;
}
```

**RESEARCH cross-process channel note (RESEARCH.md §Pitfall 4 — never forget):**
> V8 SAB cannot cross OS processes (`could not be cloned`). The file-mapping IS the cross-process hop; `ArrayBuffer::New` over the mapped view is the renderer-side JS surface only. Do NOT attempt to `Napi::SharedArrayBuffer::New` over this pointer.

---

### `packages/live-inject/agent/CMakeLists.txt` (config, build — partial analog)

**Analog:** `packages/native-core/CMakeLists.txt` (shape only — significant divergence)

**Copy the C++ standard block** (native-core/CMakeLists.txt lines 1-10):
```cmake
cmake_minimum_required(VERSION 3.15)
project(swg_toolkit_agent)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)
```

**Diverge: plain DLL, no cmake-js, x86 platform, no N-API:**
```cmake
# Plain Win32 DLL — NOT an N-API module. Build with:
#   cmake -B build-agent -A Win32 -G "Visual Studio 17 2022"
#   cmake --build build-agent --config Release

file(GLOB AGENT_SOURCES "*.cpp")

add_library(${PROJECT_NAME} SHARED ${AGENT_SOURCES})
set_target_properties(${PROJECT_NAME} PROPERTIES
    PREFIX ""
    SUFFIX ".dll"
)
# No cmake-js, no node-addon-api includes, no NAPI_* defines.
# kernel32.lib links implicitly (MSVC default Win32 lib set).
# The Windows SDK headers come from MSVC's default include path.
```

**Key constraint to document in the file:**
```cmake
# ARCH REQUIREMENT: This DLL must be x86 (Win32) to match the SWG client (x86).
# Build with -A Win32. The host addon (../CMakeLists.txt) is x64 via cmake-js.
# These are TWO SEPARATE cmake invocations — never try to build both from one cmake root.
```

---

### `packages/live-inject/agent/agent_main.cpp` (middleware, event-driven — no in-repo analog)

**No in-repo analog.** Harvest source: `D:/Code/Utinni/Launcher/main.cpp:80-115` (remote thread init) + Utinni `UtinniCore/` DllMain pattern.

**Critical shape to harvest (Utinni main.cpp:80-115 idiom):**
```cpp
// DllMain: do NOTHING except DisableThreadLibraryCalls.
// All real work runs on agent_init's thread (called by a separate CreateRemoteThread
// from the launcher), NOT in DllMain. Rationale: loader lock + uninitialized CRT.
BOOL APIENTRY DllMain(HMODULE hModule, DWORD reason, LPVOID) {
    if (reason == DLL_PROCESS_ATTACH)
        DisableThreadLibraryCalls(hModule);
    return TRUE;
}

// agent_init — the real entry point, fired on a fresh remote thread.
// lpReadyEventName: pointer to a C-string in our process (written there by the launcher).
extern "C" __declspec(dllexport)
DWORD WINAPI agent_init(LPVOID lpReadyEventName) {
    // 1. Open the ready event (name was written into our address space by the launcher)
    HANDLE hReady = OpenEventA(EVENT_MODIFY_STATE, FALSE,
                                static_cast<const char*>(lpReadyEventName));
    // 2. Resolve endpoints
    swg::endpoints::resolveFromExe();
    // 3. Create / open the file-mapping channel
    // 4. SetEvent(hReady) — unblock the launcher (WaitForSingleObject, main.cpp:337)
    SetEvent(hReady);
    CloseHandle(hReady);
    // 5. Enter the read-verify poll loop
    // ...
    return 0;
}
```

**Key: the `__declspec(dllexport)` alone forces the undecorated name** (same idiom as `GetEngineHookPoints` in `engine_advertise.cpp:766-771`). No `.def` file needed.

---

### `packages/live-inject/agent/resolve.cpp` + `resolve.h` (utility, request-response)

**Analog:** `packages/native-core/src/sab-rw.cpp` (pure function shape — no Win32, no N-API needed for the pure layer)

**Harvest verbatim from:** `D:/Code/Utinni/UtinniCore/swg/endpoints.cpp:114-185` (pure `resolve()`/`lookupByName()`) and `endpoints_bindings.cpp:802-825` (`resolveFromExe()`).

**Contract structs to copy verbatim** (from `engine_hookpoints.h:77-93` — byte-identical in both repos):
```cpp
struct EngineHookPoint  { const char* name; void* addr; };
struct EngineHookPoints { unsigned version; unsigned count; const EngineHookPoint* entries; };
#define ENGINE_HOOKPOINTS_VERSION 6
```

**resolveFromExe pattern** (endpoints_bindings.cpp:802-825):
```cpp
// In-process only: GetModuleHandle(NULL) = the host EXE (export lives in the exe)
HMODULE hExe = GetModuleHandleA(nullptr);
auto pGet = (const EngineHookPoints*(__cdecl*)())GetProcAddress(hExe, "GetEngineHookPoints");
if (!pGet) {
    s_advertisedClient = false;  // SWGEmu legacy path: RVA literals stand
    return false;
}
s_advertisedClient = true;
const EngineHookPoints* table = pGet();   // CALL it — NEVER scrape the static array
resolve(table, s_bindings, count);        // name-keyed overwrite of fn-pointer slots
return true;
```

**Pure `lookupByName` shape** (endpoints.cpp:169-175 — Win32-free, testable standalone):
```cpp
// A missing name leaves the slot at its RVA literal (never nulls a slot — graceful)
static void* lookupByName(const EngineHookPoints* table, const char* name) {
    for (unsigned i = 0; i < table->count; ++i) {
        if (strcmp(table->entries[i].name, name) == 0)
            return table->entries[i].addr;
    }
    return nullptr;  // not found → caller leaves slot unchanged
}
```

---

### `packages/live-inject/agent/rva_table.cpp` (utility, CRUD — no in-repo analog)

**No in-repo analog** (pure data catalog). Closest concept: `packages/contracts/src/sab-layout.ts` (typed constants catalog).

**Harvest source:** `D:/Code/Utinni/UtinniCore/swg/object/object.cpp:43-146` and `game/game.cpp:41-98`.

**C++ data-catalog pattern to use:**
```cpp
// rva_table.cpp — Legacy SWGEmu known-RVA literals (harvested from Utinni source).
// These are only used when isAdvertisedClient() returns false.
// Port typedefs verbatim — calling convention is in the typedef.

// object.cpp:101 — getTransform_o2w RVA (proven working in Utinni)
typedef swg::math::Transform*(__thiscall* pGetTransform_o2w)(Object*);
static pGetTransform_o2w getTransform_o2w = (pGetTransform_o2w)0x00B22C80;

// game.cpp:48,64 — getPlayer RVA
typedef Object*(__cdecl* pGetPlayer)();
static pGetPlayer getPlayer = (pGetPlayer)0x00425140;

// object.cpp:129,174 — getTemplateFilename (legacy substitute for getObjectTemplateName)
typedef const char*(__thiscall* pGetTemplateFilename)(Object*);
static pGetTemplateFilename getTemplateFilename = (pGetTemplateFilename)0x00B23C40;

// game.cpp:87 — mainLoopCounter global (read directly)
static const DWORD k_mainLoopCounter_addr = 0x1908830;
```

**Calling-convention rule** (RESEARCH.md §Read-Verify Endpoints — use MSVC `__thiscall` directly):
> Do NOT hand-emulate `__fastcall(ECX,EDX,args)`. Port the typedefs verbatim with `__thiscall` on the pointer — MSVC's `__thiscall` pointer call does the ECX-this passing automatically.

---

### `packages/live-inject/agent/sentinels.cpp` + `sentinels.h` (utility, request-response)

**Analog:** `packages/native-core/src/sab-rw.cpp` (pure functions over typed buffers, bounds-checked)

**Pure predicate shape** (mirror sab-rw.cpp validate → bounds-check → read → return):
```cpp
// sentinels.h — 4-sentinel gate (pure / Win32-free — testable standalone)
// All functions operate on byte buffers; no live process calls.

struct SentinelResult { bool passed; const char* failReason; };

// Sentinel 1: sane transform (finite, ~orthonormal, translation within world bounds)
// Input: raw 48-byte buffer from getTransform_o2w (float[3][4], row-major)
SentinelResult checkTransform(const float* mat3x4);

// Sentinel 2: non-null networkId
SentinelResult checkNetworkId(uint64_t id);

// Sentinel 3: readable object/... template name (ASCII, starts with "object/")
SentinelResult checkTemplateName(const char* name, size_t maxLen);

// Sentinel 4: player/world liveness (getPlayer non-null, !isOver, counter advancing)
SentinelResult checkLiveness(bool playerNonNull, bool isOver, int loopCounterDelta);

// All four must pass for the write gate to open (D-05)
bool allSentinelsPassed(const SentinelResult results[4]);
```

**Transform layout** (RESEARCH.md §Transform memory layout — VERIFIED):
```cpp
// swg::math::Transform = float[3][4], 12 floats / 48 bytes, row-major.
// Translation is column 3: mat[0][3], mat[1][3], mat[2][3].
// The IPC doc's "64-byte 4×4 matrix" is WRONG for SWG — use 48 bytes.
static constexpr size_t TRANSFORM_BYTE_SIZE = 48;
```

---

### `packages/live-inject/agent/channel.cpp` (service, streaming)

**Analog:** `packages/native-core/src/sab.cpp` (channel allocation/init shape — adapt to Win32 file-mapping)

**Shape from sab.cpp lines 19-36, adapted to Win32 CreateFileMapping:**
```cpp
// channel.cpp — CreateFileMapping + seqlock writer (agent side)
// The HOST creates the mapping (before inject); the agent opens it here.
// Naming: "Local\\SwgToolkitLive_<pid>" (mirrors main.cpp "Local\\UtinniReady_<pid>")

bool channelOpen(const char* mappingName, size_t byteSize) {
    // Agent opens a file-mapping created by the host
    s_hMap  = OpenFileMappingA(FILE_MAP_WRITE, FALSE, mappingName);
    if (!s_hMap) return false;
    s_view  = MapViewOfFile(s_hMap, FILE_MAP_WRITE, 0, 0, byteSize);
    return (s_view != nullptr);
}

// Seqlock write: increment seq (odd), write payload, increment seq (even)
// Reader on the host side: reads seq, reads payload, reads seq again; retry if odd or changed.
void channelWrite(const LiveState* state) {
    volatile LONG* seq = (LONG*)s_view;
    InterlockedIncrement(seq);          // seq odd → write in progress
    memcpy((char*)s_view + sizeof(LONG), state, sizeof(LiveState));
    InterlockedIncrement(seq);          // seq even → write complete
}
```

---

### `packages/contracts/src/live-inject.ts` (model, CRUD)

**Analog:** `packages/contracts/src/ipc.ts` + `packages/contracts/src/sab-layout.ts`

**Discriminated union shape** (ipc.ts lines 14-54 — copy pattern):
```typescript
/** Sent by renderer to attach+inject into a client process. */
export type LiveAttachRequest  = { type: 'live-attach'; id: number; clientExe: string; agentDll: string };

/** Sent by host addon after successful inject. */
export type LiveAttachResponse = { type: 'live-attached'; id: number; pid: number; mappingName: string };

/** Inject failed or client not found. */
export type LiveAttachError    = { type: 'live-attach-error'; id: number; reason: string };

/** Renderer polls the channel for a fresh read. */
export type LiveReadRequest    = { type: 'live-read'; id: number };

/** Host addon returns the latest verified state from the channel. */
export type LiveStateUpdate    = { type: 'live-state'; id: number; state: VerifiedObjectState | null };

export type LiveIpcMessage =
  | LiveAttachRequest | LiveAttachResponse | LiveAttachError
  | LiveReadRequest   | LiveStateUpdate;
```

**Byte-layout constants shape** (sab-layout.ts lines 10-26 — copy pattern):
```typescript
/** Byte layout for the named file-mapping channel (host read side). */
export const LIVE_CHANNEL_LAYOUT = {
  /** Seqlock counter (LONG = 4 bytes at offset 0). */
  SEQ_COUNTER:   { offset: 0,  length: 4  },
  /** Transform matrix: 12 floats / 48 bytes (float[3][4], row-major). */
  TRANSFORM:     { offset: 4,  length: 48 },
  /** NetworkId: uint64 (8 bytes). */
  NETWORK_ID:    { offset: 52, length: 8  },
  /** Template name: null-terminated ASCII (256 bytes max). */
  TEMPLATE_NAME: { offset: 60, length: 256 },
  /** Liveness flags: player_non_null(1) | is_over(1) | padding(2) (4 bytes). */
  LIVENESS:      { offset: 316, length: 4 },
  /** Total byte size of one channel frame. */
  TOTAL_SIZE:    { offset: 0, length: 320 },
} as const;
```

**Endpoint-name catalog shape** (mirror the sab-layout typed constants pattern):
```typescript
/** Engine endpoint names for the name-keyed resolution table.
 *  These are the string keys passed to lookupByName().
 *  Values must match exactly what swg-client-v2 engine_advertise.cpp advertises. */
export const ENGINE_ENDPOINT_NAMES = {
  GET_TRANSFORM_O2W:       'object::getTransform_o2w',
  GET_NETWORK_ID:          'object::getNetworkId',
  GET_OBJECT_TEMPLATE_NAME:'object::getObjectTemplateName',
  GET_PLAYER:              'game::getPlayer',
  G_RUNNING_FLAGS:         'game::g_runningFlags',
  G_MAIN_LOOP_COUNTER:     'game::g_mainLoopCounter',
} as const;
```

**Verified-state type:**
```typescript
export interface VerifiedObjectState {
  networkId:    bigint;           // uint64 from getNetworkId
  templateName: string;           // ASCII "object/..." path
  transform:    Float32Array;     // 12 floats, row-major [3][4]
  playerAlive:  boolean;          // all 4 sentinels passed
}
```

**Export from index.ts** (contracts/src/index.ts lines 1-14 — add):
```typescript
export * from './live-inject.js';
```

---

### `packages/renderer/src/panels/LiveInspectorPanel.tsx` (component, request-response)

**Analog:** `packages/renderer/src/panels/InspectorPanel.tsx`

**Panel layout shell** (InspectorPanel.tsx lines 12-106 — copy exactly, rename):
```tsx
export default function LiveInspectorPanel(_props: IDockviewPanelProps): React.ReactElement {
  // ... same outer div + panel-head + collapse button + body pattern
}
```

**Panel head style** (InspectorPanel.tsx lines 27-50 — copy exactly):
```tsx
<div style={{
  display: 'flex', alignItems: 'center',
  height: 'var(--tabstrip-h)',
  background: 'var(--color-header)',
  borderBottom: '1px solid var(--color-border)',
  padding: '0 var(--space-2)', gap: 'var(--space-2)', flexShrink: 0,
}}>
```

**Disabled state pattern** (from InspectorPanel.tsx's "No selection" empty state, lines 97-103 — adapt for D-08):
```tsx
{/* Disabled state: injection unavailable (D-08) */}
{mode === 'file-patch' && (
  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 'var(--space-2)',
                padding: 'var(--space-3) 10px', color: 'var(--color-text-muted)',
                fontSize: 'var(--text-sm)' }}>
    <span>○ File-patch mode</span>
    <span style={{ color: 'var(--color-text-faint)', fontSize: 'var(--text-xs)' }}>
      {disabledReason}
    </span>
  </div>
)}
```

**HexInspector reuse** (from HexInspector.tsx — the raw memory view for D-07 stretch):
```tsx
import HexInspector from './iff/HexInspector';
// ...
<HexInspector
  bytes={regionBytes}          // Uint8Array from a ReadProcessMemory call
  selectedRange={null}
  onHoverByte={setHoveredByte}
  hoveredByteIndex={hoveredByte}
/>
```

**actionBtnStyle constant** (InspectorPanel.tsx lines 108-122 — copy verbatim):
```tsx
const actionBtnStyle: React.CSSProperties = {
  background: 'transparent', border: 'none',
  color: 'var(--color-text-faint)', cursor: 'pointer',
  fontSize: 'var(--text-sm)', width: 22, height: 22,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  borderRadius: 'var(--radius-sm)', padding: 0,
  transition: 'background 0.12s ease, color 0.12s ease',
};
```

**Panel registration in WorkspaceShell.tsx** (WorkspaceShell.tsx lines 23-29 — add 'live-inspector' entry):
```tsx
const panelComponents = {
  sidebar:        SidebarPanel,
  viewport:       ViewportPanel,
  inspector:      InspectorPanel,
  data:           DataPanel,
  'live-inspector': LiveInspectorPanel,   // ADD
};
```

---

### `packages/renderer/src/state/liveStore.ts` (store, event-driven)

**Analog:** `packages/renderer/src/state/treStore.ts`

**Store boilerplate** (treStore.ts lines 1-19 — copy header pattern):
```typescript
/**
 * packages/renderer/src/state/liveStore.ts — Zustand store for live injection session state.
 *
 * Manages: connection status, verified object state, mode (live/file-patch), disabledReason.
 */

import { create } from 'zustand';
import type { VerifiedObjectState } from '@swg/contracts';
```

**Union type pattern** (treStore.ts lines 74-78 — copy for connection status):
```typescript
export type ConnectionStatus =
  | { kind: 'idle' }
  | { kind: 'connecting' }
  | { kind: 'attached'; pid: number; mappingName: string }
  | { kind: 'error'; reason: string };

export type InjectionMode = 'live' | 'file-patch';
```

**Store interface + create() pattern** (treStore.ts lines 88-199 — copy shape):
```typescript
export interface LiveStore {
  status:         ConnectionStatus;
  mode:           InjectionMode;
  disabledReason: string | null;
  verifiedState:  VerifiedObjectState | null;
  regionBytes:    Uint8Array | null;   // raw hex view source

  // Actions
  beginAttach:    (clientExe: string) => void;
  attachComplete: (pid: number, mappingName: string) => void;
  attachError:    (reason: string) => void;
  setMode:        (mode: InjectionMode, reason?: string) => void;
  updateState:    (state: VerifiedObjectState | null) => void;
  updateRegion:   (bytes: Uint8Array | null) => void;
  detach:         () => void;
}

export const useLiveStore = create<LiveStore>((set) => ({
  status:         { kind: 'idle' },
  mode:           'file-patch',
  disabledReason: null,
  verifiedState:  null,
  regionBytes:    null,

  beginAttach: (clientExe) => set({ status: { kind: 'connecting' }, disabledReason: null }),
  attachComplete: (pid, mappingName) =>
    set({ status: { kind: 'attached', pid, mappingName }, mode: 'live' }),
  attachError: (reason) =>
    set({ status: { kind: 'error', reason }, mode: 'file-patch', disabledReason: reason }),
  setMode: (mode, reason) =>
    set({ mode, disabledReason: reason ?? null }),
  updateState: (state) => set({ verifiedState: state }),
  updateRegion: (bytes)  => set({ regionBytes: bytes }),
  detach: () => set({
    status: { kind: 'idle' }, mode: 'file-patch',
    verifiedState: null, regionBytes: null, disabledReason: null,
  }),
}));
```

---

### `packages/renderer/src/shell/StatusBar.tsx` (MODIFY — add mode indicator)

**Analog:** itself (StatusBar.tsx lines 60-278)

**Existing indicator pattern to copy** (StatusBar.tsx lines 206-214 — the `addon:` item shape):
```tsx
<span>
  addon:{' '}
  <span style={{ color: addonColor }}>{addonStatus}</span>
</span>
<Dot />
```

**New ● Live / ○ File-patch indicator** (add after the existing items, same pattern):
```tsx
{/* Live injection mode indicator (D-08) */}
<span>
  <span style={{ color: liveMode === 'live' ? 'var(--color-accent)' : 'var(--color-text-muted)' }}>
    {liveMode === 'live' ? '● Live' : '○ File-patch'}
  </span>
</span>
<Dot />
```

**Zustand import to add** (treStore.ts import pattern, StatusBar.tsx lines 68-70):
```tsx
import { useLiveStore } from '../state/liveStore';
// Inside StatusBar():
const liveMode = useLiveStore((s) => s.mode);
```

---

### `packages/live-inject/test/resolve.spec.ts` (test, request-response)

**Analog:** `packages/native-core/test/resolve-prebuild.test.ts`

**Vitest import + describe/it/expect shape** (resolve-prebuild.test.ts lines 31-35):
```typescript
import { describe, it, expect } from 'vitest';
```

**Pure unit test shape** (resolve-prebuild.test.ts lines 97-130 — adapt for synthetic-table resolve):
```typescript
describe('name-keyed resolve — synthetic EngineHookPoints table', () => {
  const syntheticTable = buildSyntheticTable([
    { name: 'object::getTransform_o2w', addr: 0x00B22C80 },
    { name: 'game::getPlayer',          addr: 0x00425140 },
  ]);

  it('resolves a known name to the correct address', () => {
    const addr = lookupByName(syntheticTable, 'game::getPlayer');
    expect(addr).toBe(0x00425140);
  });

  it('returns null for an unknown name (graceful — slot unchanged)', () => {
    const addr = lookupByName(syntheticTable, 'nonexistent::fn');
    expect(addr).toBeNull();
  });

  it('version mismatch is a soft warning — still resolves by name', () => {
    // ...
  });
});
```

---

### `packages/live-inject/test/sentinels.spec.ts` (test, request-response)

**Analog:** `packages/harness/test/iff-roundtrip.test.ts`

**Fixture + describe/it shape** (iff-roundtrip.test.ts lines 27-60 — adapt for byte fixtures):
```typescript
import { describe, it, expect } from 'vitest';
// Import fixture files from packages/harness/fixtures-real/live/ (captured from real client)

describe('sentinel: checkTransform', () => {
  it('passes for a well-formed finite orthonormal transform', () => {
    const mat = new Float32Array(12); // identity-like
    // ... populate mat ...
    const result = checkTransform(mat);
    expect(result.passed).toBe(true);
  });

  it('fails for an all-NaN matrix', () => {
    const mat = new Float32Array(12).fill(NaN);
    const result = checkTransform(mat);
    expect(result.passed).toBe(false);
    expect(result.failReason).toContain('NaN');
  });
});
```

---

### `packages/live-inject/test/channel-layout.spec.ts` (test, streaming)

**Analog:** `packages/harness/test/iff-roundtrip.test.ts` (round-trip shape)

Tests the seqlock writer + reader struct layout without a real file-mapping (in-process mock):
```typescript
describe('channel layout round-trip (seqlock)', () => {
  it('write LiveState → read LiveState gives identical values', () => {
    const buf = new ArrayBuffer(LIVE_CHANNEL_LAYOUT.TOTAL_SIZE.length);
    // ... write via seqlock pattern ... read back ...
    expect(readState.networkId).toBe(writtenState.networkId);
    expect(readState.templateName).toBe('object/creature/player.iff');
  });

  it('seqlock seq is even after a complete write', () => {
    // ...
  });
});
```

---

### `packages/live-inject/test/handle.spec.ts` (test, request-response)

**Analog:** `packages/native-core/test/resolve-prebuild.test.ts`

Tests the OpenProcess handle lifecycle with a mock (no real client needed):
```typescript
describe('OpenProcess handle lifecycle', () => {
  it('openProcessHandle returns a handle string on success (mocked)', () => { /* ... */ });
  it('closeProcessHandle is idempotent (double-close does not throw)', () => { /* ... */ });
  it('openProcessHandle with the correct flag set includes PROCESS_VM_READ', () => { /* ... */ });
});
```

---

## Shared Patterns

### N-API error handling (all `*_binding.cpp` files)
**Source:** `packages/native-core/src/sab-rw.cpp` lines 29-48 and `packages/native-core/src/tre_binding.cpp` lines 68-109

Apply to: `inject_binding.cpp`, `procmem_binding.cpp`, `channel_binding.cpp`

```cpp
// Type check first, then throw — NEVER return undefined after a throw
if (info.Length() < N || !info[0].IsXxx()) {
    Napi::TypeError::New(env, "fnName: (param: Type) required")
        .ThrowAsJavaScriptException();
    return env.Undefined();
}
// try/catch for std::exception from Win32 wrappers:
try {
    // ... call Win32 ...
} catch (const std::exception& ex) {
    Napi::Error::New(env, std::string("fnName: ") + ex.what())
        .ThrowAsJavaScriptException();
    return env.Undefined();
}
```

### ArrayBuffer return (all functions returning binary)
**Source:** `packages/native-core/src/tre_binding.cpp` line 183 + `mesh_binding.cpp` line 213

Apply to: `procmem_binding.cpp` (ReadProcessRegion), `channel_binding.cpp` (ReadChannelView)

```cpp
Napi::ArrayBuffer buf = Napi::ArrayBuffer::New(env, byteLen);
memcpy(buf.Data(), srcBytes, byteLen);
return buf;
```

### AsyncWorker Promise pattern (async operations)
**Source:** `packages/native-core/src/tre_binding.cpp` lines 595-687

Apply to: `inject_binding.cpp` (LaunchAndInjectWorker, AttachAndInjectWorker)

```cpp
auto deferred = Napi::Promise::Deferred::New(env);
Napi::Promise promise = deferred.Promise();
auto* worker = new MyWorker(env, args..., std::move(deferred));
worker->Queue();
return promise;
```

### Contracts discriminated union pattern
**Source:** `packages/contracts/src/ipc.ts` lines 14-54

Apply to: `packages/contracts/src/live-inject.ts`

Every IPC variant carries a `type` literal + `id: number`. The union is the single export for discriminated dispatch.

### Zustand store pattern
**Source:** `packages/renderer/src/state/treStore.ts` lines 138-207

Apply to: `packages/renderer/src/state/liveStore.ts`

Pattern: `create<Interface>((set) => ({ ...initialState, actionName: (args) => set({...}) }))`.

### Dockview panel registration
**Source:** `packages/renderer/src/workspace/WorkspaceShell.tsx` lines 23-29

Apply to: registering `LiveInspectorPanel` in the `panelComponents` record before `fromJSON` is called.

### StatusBar indicator style
**Source:** `packages/renderer/src/shell/StatusBar.tsx` lines 206-214, 230-234, 276-278

Apply to: the new ● Live / ○ File-patch mode indicator in StatusBar.tsx.

---

## No Analog Found

Files with no close in-repo match — planner should reference RESEARCH.md harvested source directly:

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `packages/live-inject/agent/agent_main.cpp` | middleware | event-driven | No injected Win32 DLL exists in this repo. Harvest shape from `D:/Code/Utinni/Launcher/main.cpp:80-115` and Utinni DllMain. |
| `packages/live-inject/agent/rva_table.cpp` | utility | CRUD | Pure data catalog of literal addresses — no C++ equivalent in this repo. Harvest from `D:/Code/Utinni/UtinniCore/swg/object/object.cpp:43-146` and `game/game.cpp:41-98`. |

---

## Metadata

**Analog search scope:** `packages/native-core/src/`, `packages/contracts/src/`, `packages/renderer/src/panels/`, `packages/renderer/src/state/`, `packages/renderer/src/shell/`, `packages/native-core/test/`, `packages/harness/test/`
**Files scanned:** ~40 files read; ~160 files glob-enumerated
**Pattern extraction date:** 2026-06-25
