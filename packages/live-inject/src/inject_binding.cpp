/**
 * inject_binding.cpp — LaunchAndInject, AttachAndInject, Detach stubs
 *                       + test-utility resolver exports (Plan 03-02 TDD).
 *
 * Full Win32 inject implementation lands in Plan 03-04.
 * Shape follows native-core/src/tre_binding.cpp AsyncWorker pattern.
 *
 * Test-utility exports (Plan 03-02):
 *   lookupByNameInTable     — pure name-keyed lookup against a synthetic table
 *   resolveFromSyntheticTable — full resolve() path with version-mismatch test
 *   resolveFromExe          — actual Win32 detection (GetModuleHandleA/GetProcAddress)
 *   isAdvertisedClient      — flag set by resolveFromExe / resolveFromSyntheticTable
 *
 * These exercise the same resolver algorithm as agent/resolve.cpp without linking
 * to the agent DLL's rva_table.cpp binding array (the host N-API addon is x64;
 * the agent DLL is x86 — separate cmake invocations).
 */

#include <napi.h>
#include <Windows.h>
#include <TlHelp32.h>
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
// Duplicated here to avoid cross-architecture linking (x64 host ↔ x86 agent).
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
        // Valid table given → simulate the advertised-client path.
        s_testAdvertisedClient = true;
        return Napi::Number::New(env,
            static_cast<double>(reinterpret_cast<uintptr_t>(addr)));
    }
    return env.Null();
}

// resolveFromExe(): boolean
//   Calls the actual Win32 detection: GetModuleHandleA(nullptr) + GetProcAddress.
//   In node.exe context (no live SWGClient), GetEngineHookPoints is absent →
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
// Original inject/detach stubs (full implementation in Plan 03-04)
// ============================================================

// TODO: LaunchAndInjectWorker full implementation in Plan 03-04
Napi::Value LaunchAndInject(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    return env.Undefined();
}

// TODO: AttachAndInjectWorker full implementation in Plan 03-04
Napi::Value AttachAndInject(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    return env.Undefined();
}

// TODO: Detach full implementation in Plan 03-04
Napi::Value Detach(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    return env.Undefined();
}
