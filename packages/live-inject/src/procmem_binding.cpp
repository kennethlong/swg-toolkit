/**
 * procmem_binding.cpp — Process handle lifecycle and memory-read bindings.
 *
 * Exports (all registered in addon.cpp):
 *   openProcessHandle(pid, forInject)  → {handleId: string, isAdvertisedClient: boolean}
 *   closeProcessHandle(handleId)       → undefined (idempotent — double-close safe)
 *   readProcessRegion(handleId, addr, byteCount) → ArrayBuffer (copy; RPM always copies)
 *   isProcessAlive(handleId)           → boolean
 *   isAdvertisedClientProcess(handleId) → boolean
 *
 * FLAG SET (RESEARCH.md §Pitfall 6 — corrected from SC-1):
 *   forInject=true:  PROCESS_CREATE_THREAD | PROCESS_QUERY_INFORMATION |
 *                    PROCESS_VM_OPERATION | PROCESS_VM_READ | PROCESS_VM_WRITE
 *   forInject=false: PROCESS_VM_READ only (read-only RPM, no inject)
 *
 * SECURITY (T-03-05, D-08):
 *   ERROR_ACCESS_DENIED → structured error message with reason explaining
 *   that same-integrity process or SeDebugPrivilege is needed.
 *   Never auto-escalate — renderer sets file-patch mode on this error.
 *
 * BOUNDS CHECK (T-03-04):
 *   readProcessRegion rejects byteCount > 4096.
 *   ReadProcessMemory return value is checked before trusting any byte.
 *
 * Pattern: validate → extract → call → return (from sab-rw.cpp:29-67).
 */

#include <napi.h>
#include <Windows.h>
#include <Psapi.h>
#include <string>
#include <unordered_map>
#include <sstream>

// ---------------------------------------------------------------------------
// Module-global handle map: handleId ("swg:<pid>") → HANDLE
// ---------------------------------------------------------------------------

static std::unordered_map<std::string, HANDLE> s_handles;

// ---------------------------------------------------------------------------
// probeAdvertisedClient — check if the process exports GetEngineHookPoints.
//
// Uses DONT_RESOLVE_DLL_REFERENCES so no code runs from the EXE.
// Requires PROCESS_QUERY_INFORMATION (present when forInject=true).
// Returns false on any failure (safe default → file-patch mode).
// ---------------------------------------------------------------------------

static bool probeAdvertisedClient(HANDLE hProcess) {
    char exePath[MAX_PATH] = {};
    DWORD len = MAX_PATH;
    if (!QueryFullProcessImageNameA(hProcess, 0, exePath, &len)) return false;

    // Load the EXE as an image without executing code or resolving imports.
    // DONT_RESOLVE_DLL_REFERENCES: maps the image, never calls DllMain, never
    // processes the import table — so missing game DLLs are not a problem.
    // GetProcAddress works on the export table of such a module.
    HMODULE hMod = LoadLibraryExA(exePath, nullptr, DONT_RESOLVE_DLL_REFERENCES);
    if (!hMod) return false;

    bool found = (GetProcAddress(hMod, "GetEngineHookPoints") != nullptr);
    FreeLibrary(hMod);
    return found;
}

// ---------------------------------------------------------------------------
// OpenProcessHandle
//
// openProcessHandle(pid: number, forInject: boolean)
//   → { handleId: string, isAdvertisedClient: boolean }
//
// Returns an Napi::Object so the renderer can immediately set the mode
// indicator without a second round-trip (D-08).
// ---------------------------------------------------------------------------

Napi::Value OpenProcessHandle(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 2 || !info[0].IsNumber() || !info[1].IsBoolean()) {
        Napi::TypeError::New(env,
            "openProcessHandle: (pid: number, forInject: boolean) required")
            .ThrowAsJavaScriptException();
        return env.Undefined();
    }

    DWORD pid       = info[0].As<Napi::Number>().Uint32Value();
    bool  forInject = info[1].As<Napi::Boolean>().Value();

    // Full inject flag set (RESEARCH.md §Pitfall 6 — corrected; SC-1 is incomplete):
    // CreateRemoteThread requires PROCESS_CREATE_THREAD + PROCESS_QUERY_INFORMATION.
    DWORD flags = forInject
        ? (PROCESS_CREATE_THREAD    |
           PROCESS_QUERY_INFORMATION|
           PROCESS_VM_OPERATION     |
           PROCESS_VM_READ          |
           PROCESS_VM_WRITE)
        : PROCESS_VM_READ;  // read-only RPM — no inject

    HANDLE hProcess = OpenProcess(flags, FALSE, pid);
    if (!hProcess) {
        DWORD err = GetLastError();
        std::string msg;
        if (err == ERROR_ACCESS_DENIED) {
            msg = "openProcessHandle: access denied (pid=" + std::to_string(pid) + "). "
                  "Requires same-integrity process or SeDebugPrivilege not held; "
                  "toolkit running in file-patch mode (D-08).";
        } else {
            msg = "openProcessHandle: OpenProcess failed (pid=" + std::to_string(pid) +
                  " error=" + std::to_string(err) + ")";
        }
        Napi::Error::New(env, msg).ThrowAsJavaScriptException();
        return env.Undefined();
    }

    // Probe whether the process exports GetEngineHookPoints (advertised SWG client).
    // Only possible when forInject=true (we have PROCESS_QUERY_INFORMATION).
    // For forInject=false (read-only), return false — file-patch is the safe default.
    bool isAdv = forInject ? probeAdvertisedClient(hProcess) : false;

    // Register handle under a deterministic key
    std::string handleId = "swg:" + std::to_string(pid);
    if (s_handles.count(handleId)) {
        // Replace existing handle for the same pid (re-open after process restart, etc.)
        CloseHandle(s_handles[handleId]);
    }
    s_handles[handleId] = hProcess;

    // Return {handleId, isAdvertisedClient} so the renderer can set the mode
    // indicator immediately without a second IPC round-trip.
    Napi::Object result = Napi::Object::New(env);
    result.Set("handleId",           Napi::String::New(env, handleId));
    result.Set("isAdvertisedClient", Napi::Boolean::New(env, isAdv));
    return result;
}

// ---------------------------------------------------------------------------
// CloseProcessHandle — idempotent, double-close safe
// ---------------------------------------------------------------------------

Napi::Value CloseProcessHandle(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 1 || !info[0].IsString()) {
        Napi::TypeError::New(env, "closeProcessHandle: (handleId: string) required")
            .ThrowAsJavaScriptException();
        return env.Undefined();
    }

    const std::string handleId = info[0].As<Napi::String>().Utf8Value();
    auto it = s_handles.find(handleId);
    if (it == s_handles.end()) {
        return env.Undefined();  // already closed — idempotent
    }

    CloseHandle(it->second);
    s_handles.erase(it);
    return env.Undefined();
}

// ---------------------------------------------------------------------------
// ReadProcessRegion
//
// readProcessRegion(handleId: string, addr: number, byteCount: number)
//   → ArrayBuffer  (copy; ReadProcessMemory always copies)
//
// Bounds: byteCount ≤ 4096 (T-03-04 mitigation).
// ---------------------------------------------------------------------------

Napi::Value ReadProcessRegion(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 3 ||
        !info[0].IsString() || !info[1].IsNumber() || !info[2].IsNumber()) {
        Napi::TypeError::New(env,
            "readProcessRegion: (handleId: string, addr: number, byteCount: number) required")
            .ThrowAsJavaScriptException();
        return env.Undefined();
    }

    const std::string handleId = info[0].As<Napi::String>().Utf8Value();
    DWORD_PTR addr   = static_cast<DWORD_PTR>(info[1].As<Napi::Number>().Int64Value());
    size_t    byteCount = static_cast<size_t>(info[2].As<Napi::Number>().Uint32Value());

    // T-03-04: bounds-check to limit information disclosure / crash surface.
    if (byteCount > 4096) {
        Napi::RangeError::New(env,
            "readProcessRegion: byteCount must be <= 4096 (T-03-04)")
            .ThrowAsJavaScriptException();
        return env.Undefined();
    }

    auto it = s_handles.find(handleId);
    if (it == s_handles.end()) {
        Napi::Error::New(env, "readProcessRegion: unknown handleId").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    Napi::ArrayBuffer buf = Napi::ArrayBuffer::New(env, byteCount);
    SIZE_T bytesRead = 0;
    BOOL ok = ReadProcessMemory(it->second,
                                reinterpret_cast<LPCVOID>(addr),
                                buf.Data(),
                                byteCount,
                                &bytesRead);
    if (!ok || bytesRead != byteCount) {
        Napi::Error::New(env,
            "readProcessRegion: ReadProcessMemory failed (addr=" +
            std::to_string(addr) + " error=" + std::to_string(GetLastError()) + ")")
            .ThrowAsJavaScriptException();
        return env.Undefined();
    }
    return buf;
}

// ---------------------------------------------------------------------------
// IsProcessAlive — GetExitCodeProcess → STILL_ACTIVE
// ---------------------------------------------------------------------------

Napi::Value IsProcessAlive(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 1 || !info[0].IsString()) {
        Napi::TypeError::New(env, "isProcessAlive: (handleId: string) required")
            .ThrowAsJavaScriptException();
        return env.Undefined();
    }

    const std::string handleId = info[0].As<Napi::String>().Utf8Value();
    auto it = s_handles.find(handleId);
    if (it == s_handles.end()) {
        return Napi::Boolean::New(env, false);  // not found → treat as dead
    }

    DWORD exitCode = 0;
    if (!GetExitCodeProcess(it->second, &exitCode)) {
        return Napi::Boolean::New(env, false);
    }
    return Napi::Boolean::New(env, exitCode == STILL_ACTIVE);
}

// ---------------------------------------------------------------------------
// IsAdvertisedClientProcess — re-probe using an already-open handle.
//
// Callable after OpenProcessHandle to re-check without re-opening.
// Returns false for unknown handleId (safe default).
// ---------------------------------------------------------------------------

Napi::Value IsAdvertisedClientProcess(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 1 || !info[0].IsString()) {
        Napi::TypeError::New(env, "isAdvertisedClientProcess: (handleId: string) required")
            .ThrowAsJavaScriptException();
        return env.Undefined();
    }

    const std::string handleId = info[0].As<Napi::String>().Utf8Value();
    auto it = s_handles.find(handleId);
    if (it == s_handles.end()) {
        return Napi::Boolean::New(env, false);
    }
    return Napi::Boolean::New(env, probeAdvertisedClient(it->second));
}
