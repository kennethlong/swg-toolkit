/**
 * inject_binding.cpp — LaunchAndInject, AttachAndInject, Detach, ListSWGClientPids
 *                       + test-utility resolver exports (Plan 03-02 TDD).
 *
 * Inject implementation (Plan 03-05):
 *   LaunchAndInjectWorker  — 12-step CREATE_SUSPENDED launch recipe (Utinni main.cpp:204-378)
 *   AttachAndInjectWorker  — attach-to-already-running path (OpenProcess + late CreateRemoteThread)
 *   Detach                 — graceful cleanup (OS reclaims on process exit)
 *   ListSWGClientPids      — enumerate running SWG client PIDs via TH32CS_SNAPPROCESS
 *
 * Test-utility exports (Plan 03-02 TDD):
 *   lookupByNameInTable     — pure name-keyed lookup against a synthetic table
 *   resolveFromSyntheticTable — full resolve() path with version-mismatch test
 *   resolveFromExe          — actual Win32 detection (GetModuleHandleA/GetProcAddress)
 *   isAdvertisedClient      — flag set by resolveFromExe / resolveFromSyntheticTable
 *
 * CHANNEL NAMING SCHEME (Scheme A — locked):
 *   JS caller pre-generates:  const mappingName = 'Local\\SwgToolkitLive_' + random;
 *   JS then calls:            await addon.openChannel(mappingName);
 *   Then passes:              await addon.launchAndInject(clientExe, agentDll, mappingName);
 *   The worker writes eventName + '\0' + mappingName + '\0' into remote memory.
 *   The agent calls OpenFileMappingA(mappingName) inside agent_init.
 *
 * SECURITY:
 *   T-03-01: ProductName check via GetFileVersionInfo runs BEFORE inject in BOTH paths.
 *   T-03-05: ERROR_ACCESS_DENIED → structured error → renderer sets file-patch mode (D-08).
 *   No token-privilege escalation / no UAC manifest escalation — degrade only (D-08).
 *
 * WIN32 LIBS:
 *   version.lib — GetFileVersionInfo* / VerQueryValue (not auto-linked by MSVC)
 *   Psapi.lib   — GetModuleFileNameEx (auto-linked on Vista+ via kernel32 re-export)
 *   TlHelp32    — CreateToolhelp32Snapshot / Process32First / Process32Next
 */

#pragma comment(lib, "version.lib")

#include <napi.h>
#include <Windows.h>
#include <TlHelp32.h>
#include <Psapi.h>
#include <string>
#include <vector>
#include <memory>
#include <stdexcept>
#include <cstring>

// EngineHookPoint / EngineHookPoints / ENGINE_HOOKPOINTS_VERSION structs.
// resolve.h is lean-header (no Windows.h) — safe to include here.
#include "../agent/resolve.h"

// ============================================================
// Test-utility state (host N-API addon only — separate from the
// s_advertisedClient in agent/resolve.cpp which lives in the x86 DLL)
// ============================================================
static bool s_testAdvertisedClient = false;

// ============================================================
// Pure inline resolver logic — mirrors agent/resolve.cpp exactly.
// Duplicated here to avoid cross-architecture linking (x64 host <-> x86 agent).
// ============================================================

static const void* testLookupByName(const EngineHookPoints* table, const char* name)
{
    if (table == nullptr || table->entries == nullptr || name == nullptr)
        return nullptr;
    for (unsigned int i = 0; i < table->count; ++i)
    {
        const EngineHookPoint& e = table->entries[i];
        if (e.name != nullptr && std::strcmp(e.name, name) == 0)
            return e.addr;
    }
    return nullptr;
}

// Parse a JS array of {name: string, addr: number} objects into a vector.
struct SyntheticEntry { std::string name; uintptr_t addr; };

static std::vector<SyntheticEntry> parseTableArg(const Napi::Value& val)
{
    std::vector<SyntheticEntry> entries;
    if (!val.IsArray()) return entries;
    Napi::Array arr = val.As<Napi::Array>();
    for (uint32_t i = 0; i < arr.Length(); ++i)
    {
        Napi::Value item = arr[i];
        if (!item.IsObject()) continue;
        Napi::Object obj = item.As<Napi::Object>();
        std::string nm = obj.Has("name") ? obj.Get("name").As<Napi::String>().Utf8Value() : "";
        uintptr_t ad = obj.Has("addr")
            ? static_cast<uintptr_t>(obj.Get("addr").As<Napi::Number>().Int64Value())
            : 0u;
        entries.push_back({nm, ad});
    }
    return entries;
}

// ============================================================
// N-API test-utility exports
// ============================================================

// lookupByNameInTable(tableArray: {name,addr}[], name: string): number | null
//   Pure name-keyed lookup against a synthetic table (no Win32, no live client).
//   Returns the address as a JS Number, or null if not found.
Napi::Value LookupByNameInTable(const Napi::CallbackInfo& info)
{
    Napi::Env env = info.Env();
    if (info.Length() < 2 || !info[0].IsArray() || !info[1].IsString())
        return env.Null();

    auto synth = parseTableArg(info[0]);
    std::string lookupName = info[1].As<Napi::String>().Utf8Value();

    // Build a temporary EngineHookPoints on the stack.
    // rawEntries must outlive the table struct (both are in this scope).
    std::vector<EngineHookPoint> rawEntries(synth.size());
    for (size_t i = 0; i < synth.size(); ++i)
    {
        rawEntries[i].name = synth[i].name.c_str();
        rawEntries[i].addr = reinterpret_cast<void*>(synth[i].addr);
    }
    EngineHookPoints table;
    table.version = ENGINE_HOOKPOINTS_VERSION;
    table.count   = static_cast<unsigned>(rawEntries.size());
    table.entries = rawEntries.data();

    const void* result = testLookupByName(&table, lookupName.c_str());
    if (result == nullptr)
        return env.Null();
    return Napi::Number::New(env,
        static_cast<double>(reinterpret_cast<uintptr_t>(result)));
}

// resolveFromSyntheticTable(tableArray: {name,addr}[], targetName: string, version?: number)
//   : number | null
//   Exercises the full resolve() path including the version-mismatch soft-warning.
//   Builds a single binding for targetName, calls resolve logic, returns the slot value.
//   Sets s_testAdvertisedClient = true (simulates having received a valid table).
Napi::Value ResolveFromSyntheticTable(const Napi::CallbackInfo& info)
{
    Napi::Env env = info.Env();
    if (info.Length() < 2 || !info[0].IsArray() || !info[1].IsString())
        return env.Null();

    auto synth = parseTableArg(info[0]);
    std::string targetName = info[1].As<Napi::String>().Utf8Value();
    unsigned version = (info.Length() >= 3 && info[2].IsNumber())
        ? info[2].As<Napi::Number>().Uint32Value()
        : static_cast<unsigned>(ENGINE_HOOKPOINTS_VERSION);

    // Build temporary EngineHookPoints.
    std::vector<EngineHookPoint> rawEntries(synth.size());
    for (size_t i = 0; i < synth.size(); ++i)
    {
        rawEntries[i].name = synth[i].name.c_str();
        rawEntries[i].addr = reinterpret_cast<void*>(synth[i].addr);
    }
    EngineHookPoints table;
    table.version = version;
    table.count   = static_cast<unsigned>(rawEntries.size());
    table.entries = rawEntries.data();

    // Version-mismatch soft warning (same behavior as agent/resolve.cpp:resolve()).
    if (version != ENGINE_HOOKPOINTS_VERSION)
        OutputDebugStringA("resolveFromSyntheticTable: version mismatch -- resolving by name anyway");

    // Perform the lookup (mirrors the resolve() inner loop for a single binding).
    const void* addr = testLookupByName(&table, targetName.c_str());
    if (addr != nullptr)
    {
        // Valid table given -> simulate the advertised-client path.
        s_testAdvertisedClient = true;
        return Napi::Number::New(env,
            static_cast<double>(reinterpret_cast<uintptr_t>(addr)));
    }
    return env.Null();
}

// resolveFromExe(): boolean
//   Calls the actual Win32 detection: GetModuleHandleA(nullptr) + GetProcAddress.
//   In node.exe context (no live SWGClient), GetEngineHookPoints is absent ->
//   sets s_testAdvertisedClient=false, returns false.
//   This is the same code path as agent/resolve.cpp:resolveFromExe().
Napi::Value ResolveFromExe(const Napi::CallbackInfo& info)
{
    Napi::Env env = info.Env();
    using pGetEngineHookPoints = const EngineHookPoints*(__cdecl*)();
    HMODULE hExe = GetModuleHandleA(nullptr);
    auto pGet = reinterpret_cast<pGetEngineHookPoints>(
        GetProcAddress(hExe, "GetEngineHookPoints"));
    if (pGet == nullptr)
    {
        s_testAdvertisedClient = false;
        return Napi::Boolean::New(env, false);
    }
    s_testAdvertisedClient = true;
    return Napi::Boolean::New(env, true);
}

// isAdvertisedClient(): boolean
//   Returns s_testAdvertisedClient (set by resolveFromExe or resolveFromSyntheticTable).
Napi::Value IsAdvertisedClient(const Napi::CallbackInfo& info)
{
    return Napi::Boolean::New(info.Env(), s_testAdvertisedClient);
}

// ============================================================
// Shared helpers
// ============================================================

// checkProductName — right-target identity check (T-03-01).
// Reads the ProductName from the PE version resource.
// Returns empty string on success (ProductName == "Star Wars Galaxies") or
// a non-empty error string on failure.
// Mirrors Utinni main.cpp:175-197 and RESEARCH.md §Known Threat Patterns.
static std::string checkProductName(const std::string& exePath)
{
    DWORD dummy = 0;
    const DWORD verSize = GetFileVersionInfoSizeA(exePath.c_str(), &dummy);
    if (verSize == 0)
        return "Cannot verify target identity: GetFileVersionInfoSize failed for " + exePath;

    std::vector<BYTE> buf(verSize);
    if (!GetFileVersionInfoA(exePath.c_str(), 0, verSize, buf.data()))
        return "Cannot verify target identity: GetFileVersionInfoA failed";

    LPVOID pName = nullptr;
    UINT   nameLen = 0;
    // "\\StringFileInfo\\040904B0\\ProductName" is the English (040904B0) product name.
    if (VerQueryValueA(buf.data(), "\\StringFileInfo\\040904B0\\ProductName",
                       &pName, &nameLen) && pName != nullptr)
    {
        const char* productName = static_cast<const char*>(pName);
        if (std::strcmp(productName, "Star Wars Galaxies") != 0)
            return std::string("Not a Star Wars Galaxies client: ") + productName;
    }
    // If VerQueryValue fails to find the key, pass through (some builds may omit it).
    return "";
}

// classicDllInject — Pattern 2 (Utinni main.cpp:43-78 inject() inner step).
// Injects agentDllPath into hProcess via VirtualAllocEx+WriteProcessMemory+CreateRemoteThread(LoadLibraryA).
// Returns the remote module base (HMODULE truncated to DWORD on x86 — OK) on success,
// or sets errorOut and returns 0 on failure.
static DWORD classicDllInject(HANDLE hProcess,
                               const std::string& agentDllPath,
                               std::string& errorOut)
{
    // Allocate and write DLL path string into the target process.
    // MEM_COMMIT zeroes the page, so the null terminator is already there.
    LPVOID lpMem = VirtualAllocEx(hProcess, nullptr,
                                  agentDllPath.length(),
                                  MEM_COMMIT | MEM_RESERVE,
                                  PAGE_EXECUTE_READWRITE);
    if (!lpMem)
    {
        errorOut = "VirtualAllocEx for DLL path failed (err=" + std::to_string(GetLastError()) + ")";
        return 0;
    }

    if (!WriteProcessMemory(hProcess, lpMem,
                            agentDllPath.c_str(), agentDllPath.length(), nullptr))
    {
        VirtualFreeEx(hProcess, lpMem, 0, MEM_RELEASE);
        errorOut = "WriteProcessMemory for DLL path failed";
        return 0;
    }

    // LoadLibraryA has the same VA in the target process (kernel32 maps at the same base
    // across all processes on the same OS session — the standard classic inject assumption).
    LPVOID pLoadLib = reinterpret_cast<LPVOID>(
        GetProcAddress(GetModuleHandleA("kernel32.dll"), "LoadLibraryA"));
    if (!pLoadLib)
    {
        VirtualFreeEx(hProcess, lpMem, 0, MEM_RELEASE);
        errorOut = "GetProcAddress for LoadLibraryA failed";
        return 0;
    }

    HANDLE hThread = CreateRemoteThread(hProcess, nullptr, 0,
                                        reinterpret_cast<LPTHREAD_START_ROUTINE>(pLoadLib),
                                        lpMem, 0, nullptr);
    if (!hThread)
    {
        VirtualFreeEx(hProcess, lpMem, 0, MEM_RELEASE);
        errorOut = "CreateRemoteThread(LoadLibraryA) failed (err=" + std::to_string(GetLastError()) + ")";
        return 0;
    }

    WaitForSingleObject(hThread, INFINITE);

    DWORD hRemoteModule = 0;
    if (!GetExitCodeThread(hThread, &hRemoteModule))
    {
        CloseHandle(hThread);
        VirtualFreeEx(hProcess, lpMem, 0, MEM_RELEASE);
        errorOut = "GetExitCodeThread(LoadLibraryA thread) failed";
        return 0;
    }
    CloseHandle(hThread);

    // Free the remote DLL path allocation — LoadLibraryA copied it already.
    VirtualFreeEx(hProcess, lpMem, 0, MEM_RELEASE);

    if (hRemoteModule == 0)
    {
        errorOut = "LoadLibraryA in target returned NULL — DLL not loaded";
        return 0;
    }
    return hRemoteModule;
}

// resolveAgentInitOffset — load agentDllPath locally, get agent_init offset,
// free immediately. Returns offset on success or sets errorOut and returns 0.
// NOTE: On x64 host, LoadLibraryA loads the x86 agent DLL as a data-only image.
//       DONT_RESOLVE_DLL_REFERENCES is used to avoid running x86 DllMain in x64 space.
//       GetProcAddress still resolves exports from the export table.
static SIZE_T resolveAgentInitOffset(const std::string& agentDllPath,
                                     std::string& errorOut)
{
    HMODULE localBase = LoadLibraryExA(agentDllPath.c_str(), nullptr,
                                       DONT_RESOLVE_DLL_REFERENCES);
    if (!localBase)
    {
        errorOut = "Local LoadLibraryEx(" + agentDllPath + ") failed for agent_init resolution";
        return 0;
    }
    FARPROC localProc = GetProcAddress(localBase, "agent_init");
    if (!localProc)
    {
        FreeLibrary(localBase);
        errorOut = "agent_init export not found in " + agentDllPath;
        return 0;
    }
    // ptrdiff_t (signed __int64 on x64) -> SIZE_T via static_cast.
    SIZE_T offset = static_cast<SIZE_T>(
        reinterpret_cast<BYTE*>(localProc) - reinterpret_cast<BYTE*>(localBase));
    FreeLibrary(localBase);
    return offset;
}

// ============================================================
// LaunchAndInjectWorker — 12-step CREATE_SUSPENDED launch recipe
// Source: Utinni Launcher/main.cpp:204-378 (ported faithfully)
// ASLR fix: main.cpp:224-248 (PEB.ImageBaseAddress via EBX+0x08)
// I-cache flush: main.cpp:289-294 (after EB FE patch) and main.cpp:345-362 (after OEP restore)
// ============================================================

class LaunchAndInjectWorker : public Napi::AsyncWorker {
public:
    LaunchAndInjectWorker(Napi::Env env,
                          std::string clientExe,
                          std::string agentDllPath,
                          std::string channelMappingName,
                          Napi::Promise::Deferred deferred)
        : Napi::AsyncWorker(env)
        , m_clientExe(std::move(clientExe))
        , m_agentDllPath(std::move(agentDllPath))
        , m_channelMappingName(std::move(channelMappingName))
        , m_deferred(std::move(deferred))
    {}

    // Runs on the libuv threadpool — no Napi calls allowed here.
    void Execute() override
    {
        // Handle tracking for cleanup on any error path.
        PROCESS_INFORMATION pi  = {};
        bool piValid             = false;
        bool succeeded           = false;
        HANDLE hPeFile           = INVALID_HANDLE_VALUE;
        HANDLE hPeMap            = nullptr;
        LPVOID dosView           = nullptr;
        HANDLE hReady            = nullptr;
        LPVOID remoteParamBuf    = nullptr;   // intentional OS-reclaim on process exit (per Utinni comment)

        do {  // once — break on error; cleanup block follows

            // ------------------------------------------------------------------
            // RIGHT-TARGET CHECK (T-03-01): must run BEFORE CreateProcess.
            // Mirrors Utinni main.cpp:175-197.
            // ------------------------------------------------------------------
            {
                std::string idErr = checkProductName(m_clientExe);
                if (!idErr.empty()) { SetError(idErr); break; }
            }

            // ------------------------------------------------------------------
            // Step 1: CreateProcess(CREATE_SUSPENDED)  [main.cpp:211]
            // ------------------------------------------------------------------
            STARTUPINFOA si = {};
            si.cb = sizeof(si);
            if (!CreateProcessA(m_clientExe.c_str(), nullptr, nullptr, nullptr,
                                FALSE,
                                CREATE_SUSPENDED | DETACHED_PROCESS,
                                nullptr, nullptr, &si, &pi))
            {
                SetError("CreateProcess failed (err=" + std::to_string(GetLastError()) + ")");
                break;
            }
            piValid = true;

            // ------------------------------------------------------------------
            // Step 2: Map PE file, read AddressOfEntryPoint (entry RVA)  [main.cpp:218-222]
            // ------------------------------------------------------------------
            hPeFile = CreateFileA(m_clientExe.c_str(), GENERIC_READ, FILE_SHARE_READ,
                                   nullptr, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, nullptr);
            if (hPeFile == INVALID_HANDLE_VALUE)
            {
                SetError("CreateFile for PE map failed (err=" + std::to_string(GetLastError()) + ")");
                break;
            }
            hPeMap = CreateFileMapping(hPeFile, nullptr, PAGE_READONLY, 0, 0, nullptr);
            if (!hPeMap)
            {
                SetError("CreateFileMapping for PE map failed");
                break;
            }
            dosView = MapViewOfFile(hPeMap, FILE_MAP_READ, 0, 0, 0);
            if (!dosView)
            {
                SetError("MapViewOfFile for PE map failed");
                break;
            }
            auto* dosHdr  = reinterpret_cast<PIMAGE_DOS_HEADER>(dosView);
            auto* peHdr   = reinterpret_cast<PIMAGE_NT_HEADERS>(
                                reinterpret_cast<BYTE*>(dosView) + dosHdr->e_lfanew);
            const DWORD entryRva    = peHdr->OptionalHeader.AddressOfEntryPoint;
            const DWORD_PTR prefBase = peHdr->OptionalHeader.ImageBase;
            // Done reading — unmap immediately.
            UnmapViewOfFile(dosView); dosView = nullptr;
            CloseHandle(hPeMap);     hPeMap   = nullptr;
            CloseHandle(hPeFile);    hPeFile  = INVALID_HANDLE_VALUE;

            // ------------------------------------------------------------------
            // Step 3: Resolve actual ASLR load base from PEB.ImageBaseAddress  [main.cpp:224-248]
            // On x86, the initial thread of a CREATE_SUSPENDED process has EBX = PEB.
            // PEB.ImageBaseAddress is at PEB+0x08.
            // Fixed-base SWGEmu (DllCharacteristics == 0x0000) falls through to preferred base.
            // CRITICAL: using the preferred image base on DYNAMICBASE clients causes the spin-wait
            //           to time out (the real entry is at a different VA after ASLR relocation).
            //
            // x64-host note: The host addon is x64; the target client is x86 under WOW64.
            // Use Wow64GetThreadContext (+ WOW64_CONTEXT) to read x86 registers — the standard
            // CONTEXT structure on x64 lacks Ebx/Eip (it has Rbx/Rip instead).
            // ------------------------------------------------------------------
            DWORD_PTR actualBase = prefBase;
            {
                WOW64_CONTEXT startCtx = {};
                startCtx.ContextFlags = WOW64_CONTEXT_INTEGER;
                if (Wow64GetThreadContext(pi.hThread, &startCtx))
                {
                    DWORD remoteImageBase = 0;
                    if (ReadProcessMemory(pi.hProcess,
                                          reinterpret_cast<LPCVOID>(
                                              static_cast<DWORD_PTR>(startCtx.Ebx) + 0x08),
                                          &remoteImageBase, sizeof(remoteImageBase), nullptr)
                        && remoteImageBase != 0)
                    {
                        actualBase = static_cast<DWORD_PTR>(remoteImageBase);
                    }
                    // If remoteImageBase == 0 (fixed-base SWGEmu): use prefBase (already set).
                }
            }
            LPVOID entry = reinterpret_cast<LPVOID>(actualBase + entryRva);

            // ------------------------------------------------------------------
            // Step 4: Save original 2 OEP bytes  [main.cpp:261-262]
            // ------------------------------------------------------------------
            unsigned char oep[2] = {};
            if (!ReadProcessMemory(pi.hProcess, entry, oep, 2, nullptr))
            {
                SetError("ReadProcessMemory for OEP save failed (err=" + std::to_string(GetLastError()) + ")");
                break;
            }

            // ------------------------------------------------------------------
            // Step 5: Create ready event BEFORE patching  [main.cpp:268-269]
            //         Naming: "Local\SwgToolkitAgent_<pid>" (mirrors Utinni UtinniReady_<pid>)
            // ------------------------------------------------------------------
            const std::string readyEventName = "Local\\SwgToolkitAgent_" + std::to_string(pi.dwProcessId);
            hReady = CreateEventA(nullptr, TRUE /* manual-reset */, FALSE /* initially-false */,
                                  readyEventName.c_str());
            if (!hReady)
            {
                SetError("CreateEventA for ready event failed (err=" + std::to_string(GetLastError()) + ")");
                break;
            }

            // ------------------------------------------------------------------
            // Step 6: VirtualAllocEx + WriteProcessMemory combined param buffer  [main.cpp:277-284]
            //         Buffer: eventName + '\0' + channelMappingName + '\0'
            //         The agent reads param as: const char* evName = (char*)lpParam;
            //                                   const char* mapName = evName + strlen(evName) + 1;
            // ------------------------------------------------------------------
            const size_t paramSize = readyEventName.size() + 1   // eventName\0
                                   + m_channelMappingName.size() + 1; // mappingName\0
            remoteParamBuf = VirtualAllocEx(pi.hProcess, nullptr, paramSize,
                                            MEM_COMMIT | MEM_RESERVE, PAGE_READWRITE);
            if (!remoteParamBuf)
            {
                SetError("VirtualAllocEx for param buffer failed (err=" + std::to_string(GetLastError()) + ")");
                break;
            }
            {
                // Build param buffer in local memory.
                std::vector<char> paramLocal(paramSize);
                std::memcpy(paramLocal.data(),
                            readyEventName.c_str(), readyEventName.size() + 1);
                std::memcpy(paramLocal.data() + readyEventName.size() + 1,
                            m_channelMappingName.c_str(), m_channelMappingName.size() + 1);
                if (!WriteProcessMemory(pi.hProcess, remoteParamBuf,
                                        paramLocal.data(), paramSize, nullptr))
                {
                    SetError("WriteProcessMemory for param buffer failed");
                    break;
                }
            }

            // ------------------------------------------------------------------
            // Step 7: Patch entry with EB FE (jmp-to-self infinite loop)  [main.cpp:287-294]
            //         Flush I-cache #1 MANDATORY after patch (main.cpp:289-294).
            //         Without this, CPU I-cache holds pre-patch bytes -> nondeterministic.
            // ------------------------------------------------------------------
            const unsigned char ebFe[2] = {0xEB, 0xFE};
            if (!WriteProcessMemory(pi.hProcess, entry, ebFe, 2, nullptr))
            {
                SetError("WriteProcessMemory for EB FE patch failed");
                break;
            }
            FlushInstructionCache(pi.hProcess, entry, 2); // MANDATORY — Utinni main.cpp:289-294

            // ------------------------------------------------------------------
            // Step 8: ResumeThread; spin-poll EIP == entry  [main.cpp:310-324]
            //         Budget: 50 x Sleep(100) = 5 seconds.
            //         x64-host note: use Wow64GetThreadContext (WOW64_CONTEXT) to read
            //         the x86 Eip register of the suspended x86 thread.
            // ------------------------------------------------------------------
            ResumeThread(pi.hThread);
            {
                WOW64_CONTEXT ctx = {};
                bool hitEntry = false;
                const DWORD entryDword = static_cast<DWORD>(reinterpret_cast<DWORD_PTR>(entry));
                for (unsigned i = 0; i < 50; ++i)
                {
                    Sleep(100);
                    ctx = {};
                    ctx.ContextFlags = WOW64_CONTEXT_CONTROL;
                    Wow64GetThreadContext(pi.hThread, &ctx);
                    if (ctx.Eip == entryDword)
                    {
                        hitEntry = true;
                        break;
                    }
                }
                if (!hitEntry)
                {
                    SetError("Timed out waiting for EIP to reach entry point (EB FE spin-wait)");
                    break;
                }
            }

            // ------------------------------------------------------------------
            // Step 9: Classic DLL inject (inner step)  [main.cpp:43-78]
            //         VirtualAllocEx + WriteProcessMemory(agentDllPath) +
            //         CreateRemoteThread(LoadLibraryA) -> WaitForSingleObject ->
            //         GetExitCodeThread -> remoteModuleBase
            // ------------------------------------------------------------------
            std::string injectErr;
            const DWORD remoteModuleBase = classicDllInject(pi.hProcess, m_agentDllPath, injectErr);
            if (remoteModuleBase == 0)
            {
                SetError("Classic DLL inject failed: " + injectErr);
                break;
            }

            // ------------------------------------------------------------------
            // Step 10: Resolve agent_init offset locally + fire remote thread  [main.cpp:80-115]
            //          LoadLibraryA(agentDllPath) -> GetProcAddress("agent_init") ->
            //          offset = proc - localBase -> FreeLibrary.
            //          CreateRemoteThread(remoteBase+offset, remoteParamBuf) — fire and forget.
            //          Do NOT WaitForSingleObject on this thread (it runs the poll loop forever).
            // ------------------------------------------------------------------
            {
                std::string offErr;
                const SIZE_T agentInitOffset = resolveAgentInitOffset(m_agentDllPath, offErr);
                if (agentInitOffset == 0)
                {
                    SetError("agent_init offset resolution failed: " + offErr);
                    break;
                }
                LPVOID remoteAgentInit = reinterpret_cast<LPVOID>(
                    static_cast<DWORD>(remoteModuleBase) + agentInitOffset);
                HANDLE hInitThread = CreateRemoteThread(
                    pi.hProcess, nullptr, 0,
                    reinterpret_cast<LPTHREAD_START_ROUTINE>(remoteAgentInit),
                    remoteParamBuf,   // agent reads eventName + mappingName from here
                    0, nullptr);
                if (!hInitThread)
                {
                    SetError("CreateRemoteThread(agent_init) failed (err=" + std::to_string(GetLastError()) + ")");
                    break;
                }
                // Intentionally do NOT wait — the agent_init thread runs the poll loop forever.
                // OS reclaims handle on SWG process exit. (Utinni main.cpp:115: "CloseHandle(hInitThread)")
                CloseHandle(hInitThread);
            }

            // ------------------------------------------------------------------
            // Step 11: WaitForSingleObject(hReadyEvent, 30000)  [main.cpp:337]
            //          The agent signals it when agent_init completes initialization.
            // ------------------------------------------------------------------
            {
                const DWORD waitResult = WaitForSingleObject(hReady, 30000);
                if (waitResult != WAIT_OBJECT_0)
                {
                    SetError("Agent init timed out after 30s (WAIT_TIMEOUT)");
                    break;
                }
            }

            // ------------------------------------------------------------------
            // Step 12: SuspendThread, restore OEP + Flush I-cache #2, ResumeThread
            //          [main.cpp:345-362]
            //          Flush I-cache #2 MANDATORY after restore (main.cpp:345-362).
            //          Without this, the main thread executes cached EB FE instead of the
            //          original bytes after resume.
            // ------------------------------------------------------------------
            SuspendThread(pi.hThread);
            WriteProcessMemory(pi.hProcess, entry, oep, 2, nullptr); // restore original entry
            FlushInstructionCache(pi.hProcess, entry, 2); // MANDATORY — Utinni main.cpp:345-362
            ResumeThread(pi.hThread);

            // Success path.
            succeeded = true;
            m_pid = pi.dwProcessId;

        } while (false);  // end do-once

        // ------------------------------------------------------------------
        // Cleanup (always runs, including on success)
        // ------------------------------------------------------------------
        if (hReady) { CloseHandle(hReady); hReady = nullptr; }
        if (dosView) { UnmapViewOfFile(dosView); dosView = nullptr; }
        if (hPeMap) { CloseHandle(hPeMap); hPeMap = nullptr; }
        if (hPeFile != INVALID_HANDLE_VALUE) { CloseHandle(hPeFile); hPeFile = INVALID_HANDLE_VALUE; }

        if (piValid)
        {
            if (!succeeded && pi.hProcess)
            {
                // Terminate the suspended/partially-launched process on any error.
                TerminateProcess(pi.hProcess, 1);
                // Also free the remote param buf on error (it won't be used by the agent).
                if (remoteParamBuf) VirtualFreeEx(pi.hProcess, remoteParamBuf, 0, MEM_RELEASE);
            }
            // On success: remoteParamBuf is an intentional OS-reclaim-on-exit leak —
            // the agent holds a pointer to it for the process lifetime. (Utinni comment main.cpp:364-367)
            if (pi.hThread)  { CloseHandle(pi.hThread);  pi.hThread  = nullptr; }
            if (pi.hProcess) { CloseHandle(pi.hProcess); pi.hProcess = nullptr; }
        }
    }

    void OnOK() override
    {
        Napi::Env env = Env();
        Napi::HandleScope scope(env);
        Napi::Object result = Napi::Object::New(env);
        result.Set("pid",      Napi::Number::New(env, static_cast<double>(m_pid)));
        result.Set("handleId", Napi::String::New(env, "inject:" + std::to_string(m_pid)));
        m_deferred.Resolve(result);
    }

    void OnError(const Napi::Error& e) override
    {
        m_deferred.Reject(e.Value());
    }

private:
    std::string              m_clientExe;
    std::string              m_agentDllPath;
    std::string              m_channelMappingName;
    Napi::Promise::Deferred  m_deferred;
    DWORD                    m_pid = 0;
};

// launchAndInject(clientExe: string, agentDllPath: string, channelMappingName: string): Promise<{pid,handleId}>
Napi::Value LaunchAndInject(const Napi::CallbackInfo& info)
{
    Napi::Env env = info.Env();

    if (info.Length() < 3
        || !info[0].IsString()
        || !info[1].IsString()
        || !info[2].IsString())
    {
        Napi::TypeError::New(env,
            "launchAndInject: expected (clientExe: string, agentDllPath: string, channelMappingName: string)")
            .ThrowAsJavaScriptException();
        return env.Undefined();
    }

    const std::string clientExe          = info[0].As<Napi::String>().Utf8Value();
    const std::string agentDllPath       = info[1].As<Napi::String>().Utf8Value();
    const std::string channelMappingName = info[2].As<Napi::String>().Utf8Value();

    auto deferred = Napi::Promise::Deferred::New(env);
    Napi::Promise promise = deferred.Promise();

    auto* worker = new LaunchAndInjectWorker(env, clientExe, agentDllPath,
                                              channelMappingName, std::move(deferred));
    worker->Queue();
    return promise;
}

// ============================================================
// AttachAndInjectWorker — attach-to-already-running path
// Source: RESEARCH.md §Pattern 2 (attach-to-running note) + §Pitfall 6
// No CREATE_SUSPENDED / EB FE dance — client is already running.
// STATIC-INIT RACE NOTE: already-running client's CRT is fully initialized.
// The agent resolves via GetEngineHookPoints() (calls the fn, never scrapes
// the raw static array), so no extra host-side sync is needed here. (D-02.2)
// ============================================================

class AttachAndInjectWorker : public Napi::AsyncWorker {
public:
    AttachAndInjectWorker(Napi::Env env,
                          DWORD pid,
                          std::string agentDllPath,
                          std::string channelMappingName,
                          Napi::Promise::Deferred deferred)
        : Napi::AsyncWorker(env)
        , m_pid(pid)
        , m_agentDllPath(std::move(agentDllPath))
        , m_channelMappingName(std::move(channelMappingName))
        , m_deferred(std::move(deferred))
    {}

    void Execute() override
    {
        bool succeeded      = false;
        HANDLE hProcess     = nullptr;
        HANDLE hReady       = nullptr;
        LPVOID remoteParam  = nullptr;   // intentional OS-reclaim on process exit

        do {  // once

            // ------------------------------------------------------------------
            // OPEN HANDLE with full flag set  [RESEARCH.md §Pitfall 6]
            //   PROCESS_CREATE_THREAD    — for CreateRemoteThread
            //   PROCESS_QUERY_INFORMATION — for GetModuleFileNameEx
            //   PROCESS_VM_OPERATION      — for VirtualAllocEx
            //   PROCESS_VM_READ           — for ReadProcessMemory
            //   PROCESS_VM_WRITE          — for WriteProcessMemory
            // ------------------------------------------------------------------
            hProcess = OpenProcess(
                PROCESS_CREATE_THREAD | PROCESS_QUERY_INFORMATION |
                PROCESS_VM_OPERATION  | PROCESS_VM_READ           | PROCESS_VM_WRITE,
                FALSE, m_pid);
            if (!hProcess)
            {
                const DWORD err = GetLastError();
                if (err == ERROR_ACCESS_DENIED)
                {
                    // T-03-05 / D-08: do NOT auto-escalate — degrade to file-patch mode.
                    // The renderer detects this specific phrase and sets mode = 'file-patch'.
                    SetError("Requires same-integrity process or SeDebugPrivilege not held"
                             " — switching to file-patch mode");
                }
                else
                {
                    SetError("OpenProcess failed (err=" + std::to_string(err) + ")");
                }
                break;
            }

            // ------------------------------------------------------------------
            // RIGHT-TARGET CHECK (T-03-01): same identity check as launch path.
            // Use QueryFullProcessImageNameA (kernel32, Vista+) to get EXE path.
            // ------------------------------------------------------------------
            {
                char exePath[MAX_PATH] = {};
                DWORD exePathLen = MAX_PATH;
                if (!QueryFullProcessImageNameA(hProcess, 0, exePath, &exePathLen))
                {
                    SetError("QueryFullProcessImageNameA failed (err=" + std::to_string(GetLastError()) + ")");
                    break;
                }
                std::string idErr = checkProductName(std::string(exePath));
                if (!idErr.empty()) { SetError(idErr); break; }
            }

            // ------------------------------------------------------------------
            // Prepare combined param string:  "Local\\SwgToolkitAgent_<pid>\0" + mappingName + "\0"
            // ------------------------------------------------------------------
            const std::string readyEventName = "Local\\SwgToolkitAgent_" + std::to_string(m_pid);
            const size_t paramSize = readyEventName.size() + 1 + m_channelMappingName.size() + 1;

            remoteParam = VirtualAllocEx(hProcess, nullptr, paramSize,
                                         MEM_COMMIT | MEM_RESERVE, PAGE_READWRITE);
            if (!remoteParam)
            {
                SetError("VirtualAllocEx for param buffer failed (err=" + std::to_string(GetLastError()) + ")");
                break;
            }
            {
                std::vector<char> paramLocal(paramSize);
                std::memcpy(paramLocal.data(),
                            readyEventName.c_str(), readyEventName.size() + 1);
                std::memcpy(paramLocal.data() + readyEventName.size() + 1,
                            m_channelMappingName.c_str(), m_channelMappingName.size() + 1);
                if (!WriteProcessMemory(hProcess, remoteParam,
                                        paramLocal.data(), paramSize, nullptr))
                {
                    SetError("WriteProcessMemory for param buffer failed");
                    break;
                }
            }

            // ------------------------------------------------------------------
            // Create ready event (host-side; agent opens via OpenEventA)
            // ------------------------------------------------------------------
            hReady = CreateEventA(nullptr, TRUE, FALSE, readyEventName.c_str());
            if (!hReady)
            {
                SetError("CreateEventA for ready event failed (err=" + std::to_string(GetLastError()) + ")");
                break;
            }

            // ------------------------------------------------------------------
            // LATE-INJECT: classic DLL inject (no EB FE dance — client is live)
            // Same inner step as LaunchAndInjectWorker step 9.
            // ------------------------------------------------------------------
            std::string injectErr;
            const DWORD remoteModuleBase = classicDllInject(hProcess, m_agentDllPath, injectErr);
            if (remoteModuleBase == 0)
            {
                SetError("Classic DLL inject failed: " + injectErr);
                break;
            }

            // ------------------------------------------------------------------
            // Resolve agent_init offset + fire remote thread (fire and forget)
            // STATIC-INIT RACE NOTE: already-running client has completed CRT _initterm.
            // The agent's resolveFromExe() always calls GetEngineHookPoints() (the fn),
            // never reads the raw static array — sufficient for the attach path. (D-02.2)
            // ------------------------------------------------------------------
            {
                std::string offErr;
                const SIZE_T agentInitOffset = resolveAgentInitOffset(m_agentDllPath, offErr);
                if (agentInitOffset == 0)
                {
                    SetError("agent_init offset resolution failed: " + offErr);
                    break;
                }
                LPVOID remoteAgentInit = reinterpret_cast<LPVOID>(
                    static_cast<DWORD>(remoteModuleBase) + agentInitOffset);
                HANDLE hInitThread = CreateRemoteThread(
                    hProcess, nullptr, 0,
                    reinterpret_cast<LPTHREAD_START_ROUTINE>(remoteAgentInit),
                    remoteParam, 0, nullptr);
                if (!hInitThread)
                {
                    SetError("CreateRemoteThread(agent_init) failed (err=" + std::to_string(GetLastError()) + ")");
                    break;
                }
                // Fire and forget — the poll thread runs for the process lifetime.
                CloseHandle(hInitThread);
            }

            // ------------------------------------------------------------------
            // Wait for agent_init to signal the ready event (30s budget)
            // ------------------------------------------------------------------
            {
                const DWORD waitResult = WaitForSingleObject(hReady, 30000);
                if (waitResult != WAIT_OBJECT_0)
                {
                    SetError("Agent init timed out after 30s (WAIT_TIMEOUT)");
                    break;
                }
            }

            succeeded = true;

        } while (false);

        // Cleanup
        if (hReady) { CloseHandle(hReady); hReady = nullptr; }
        if (hProcess)
        {
            if (!succeeded)
            {
                // Free remote param on error (agent didn't start, no dangling pointer).
                if (remoteParam) VirtualFreeEx(hProcess, remoteParam, 0, MEM_RELEASE);
            }
            // On success: remoteParam is intentionally leaked (OS reclaims on exit).
            CloseHandle(hProcess);
            hProcess = nullptr;
        }
    }

    void OnOK() override
    {
        Napi::Env env = Env();
        Napi::HandleScope scope(env);
        Napi::Object result = Napi::Object::New(env);
        result.Set("pid",      Napi::Number::New(env, static_cast<double>(m_pid)));
        result.Set("handleId", Napi::String::New(env, "inject:" + std::to_string(m_pid)));
        m_deferred.Resolve(result);
    }

    void OnError(const Napi::Error& e) override
    {
        m_deferred.Reject(e.Value());
    }

private:
    DWORD                    m_pid;
    std::string              m_agentDllPath;
    std::string              m_channelMappingName;
    Napi::Promise::Deferred  m_deferred;
};

// attachAndInject(pid: number, agentDllPath: string, channelMappingName: string): Promise<{pid,handleId}>
Napi::Value AttachAndInject(const Napi::CallbackInfo& info)
{
    Napi::Env env = info.Env();

    if (info.Length() < 3
        || !info[0].IsNumber()
        || !info[1].IsString()
        || !info[2].IsString())
    {
        Napi::TypeError::New(env,
            "attachAndInject: expected (pid: number, agentDllPath: string, channelMappingName: string)")
            .ThrowAsJavaScriptException();
        return env.Undefined();
    }

    const DWORD       pid                = static_cast<DWORD>(info[0].As<Napi::Number>().Uint32Value());
    const std::string agentDllPath       = info[1].As<Napi::String>().Utf8Value();
    const std::string channelMappingName = info[2].As<Napi::String>().Utf8Value();

    auto deferred = Napi::Promise::Deferred::New(env);
    Napi::Promise promise = deferred.Promise();

    auto* worker = new AttachAndInjectWorker(env, pid, agentDllPath,
                                              channelMappingName, std::move(deferred));
    worker->Queue();
    return promise;
}

// ============================================================
// Detach — graceful cleanup (the OS reclaims remote allocations on process exit)
// ============================================================

// detach(handleId: string): undefined
Napi::Value Detach(const Napi::CallbackInfo& info)
{
    // Phase 3: no persistent inject handle map in inject_binding.cpp.
    // The injected agent and file-mapping channel are kernel objects; they survive
    // as long as the SWG process lives and are reclaimed by the OS on process exit.
    // Explicit remote cleanup (VirtualFreeEx of agent memory) would require
    // OpenProcess + the original remote addresses — deferred to Phase 5 when the
    // full session lifecycle is managed.
    // The channel file-mapping is cleaned up via addon.closeChannel().
    return info.Env().Undefined();
}

// ============================================================
// ListSWGClientPids — enumerate running SWG client PIDs
// Used by the renderer's "Attach to running" UI to populate a PID picker.
// ============================================================

// listSWGClientPids(): number[]
Napi::Value ListSWGClientPids(const Napi::CallbackInfo& info)
{
    Napi::Env env = info.Env();
    Napi::Array result = Napi::Array::New(env);
    uint32_t idx = 0;

    HANDLE hSnap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
    if (hSnap == INVALID_HANDLE_VALUE)
        return result;

    PROCESSENTRY32 pe = {};
    pe.dwSize = sizeof(pe);

    if (Process32First(hSnap, &pe))
    {
        do
        {
            // Both supported SWG client builds — RESEARCH.md §Supported builds.
            if (_stricmp(pe.szExeFile, "SwgClient_r.exe") == 0
                || _stricmp(pe.szExeFile, "SWGEmu.exe") == 0)
            {
                result.Set(idx++, Napi::Number::New(env, static_cast<double>(pe.th32ProcessID)));
            }
        } while (Process32Next(hSnap, &pe));
    }

    CloseHandle(hSnap);
    return result;
}
