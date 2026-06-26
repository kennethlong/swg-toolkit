/**
 * resolve.cpp — Engine hook point resolver.
 *
 * Ported from Utinni (MIT License, Philip Klatt):
 *   endpoints.cpp:114-201    (pure lookupByName + resolve)
 *   endpoints_bindings.cpp:809-856 (resolveFromExe Win32 shell)
 *
 * Key invariants (per GROUNDTRUTH-advertised-hooks.md §Consumer side):
 *   - GetModuleHandle(NULL) = the host EXE (export lives in exe, not a DLL)
 *   - CALL GetEngineHookPoints() — NEVER scrape the raw static array (static-init race)
 *   - Export absent → STRICT NO-OP; RVA literals from rva_table.cpp remain active (D-00)
 *   - Version mismatch → soft warning; still resolves by name (never aborts)
 */

#include "resolve.h"
#include <Windows.h>    // GetModuleHandleA, GetProcAddress, OutputDebugStringA

// Forward declarations of the binding table (defined in rva_table.cpp, same DLL).
// The host N-API addon (x64) does NOT compile rva_table.cpp — it uses its own
// inline test-utility equivalents in inject_binding.cpp.
namespace swg { namespace endpoints {
    extern Binding g_agentBindings[];
    extern size_t  g_agentBindingCount;
}}

namespace swg {
namespace endpoints {

static bool s_advertisedClient;  // zero-initialized (static storage)

const void* lookupByName(const EngineHookPoints* table, const char* name)
{
    // Null-safe: null/partial table or null name → nullptr, no deref.
    if (table == nullptr || table->entries == nullptr || name == nullptr)
        return nullptr;

    for (unsigned int i = 0; i < table->count; ++i)
    {
        const EngineHookPoint& e = table->entries[i];
        if (e.name != nullptr && std::strcmp(e.name, name) == 0)
            return e.addr;  // may itself be null → caller treats as "not bindable"
    }
    return nullptr;
}

int resolve(const EngineHookPoints* table, const Binding* bindings, size_t count)
{
    if (table == nullptr || table->entries == nullptr || table->count == 0 ||
        bindings == nullptr || count == 0)
        return 0;

    // Version drift: soft warning, still resolves BY NAME.
    // (Ported from Utinni endpoints.cpp:146-149.)
    if (table->version != ENGINE_HOOKPOINTS_VERSION)
        OutputDebugStringA("endpoints: contract version mismatch -- resolving by name anyway");

    int resolved = 0;
    for (size_t i = 0; i < count; ++i)
    {
        const Binding& b = bindings[i];
        if (b.name == nullptr || b.slot == nullptr)
            continue;  // malformed row → skip, never deref

        const void* addr = lookupByName(table, b.name);
        if (addr != nullptr)
        {
            // Overwrite the literal in place; the subsystem's typed pointer now
            // points at the advertised function instead of the hardcoded RVA.
            *b.slot = const_cast<void*>(addr);
            ++resolved;
        }
        // Miss: leave the RVA literal UNTOUCHED (graceful degrade — never null a slot).
    }
    return resolved;
}

bool resolveFromExe()
{
    // Ported from endpoints_bindings.cpp:809-831 (Utinni).
    using pGetEngineHookPoints = const EngineHookPoints*(__cdecl*)();

    HMODULE hExe = GetModuleHandleA(nullptr);  // the injected SWG client exe
    auto pGet = reinterpret_cast<pGetEngineHookPoints>(
        GetProcAddress(hExe, "GetEngineHookPoints"));

    if (pGet == nullptr)
    {
        // SWGEmu Pre-CU: no export → STRICT NO-OP.
        // Every swg::* RVA literal is left exactly as-is (D-00).
        s_advertisedClient = false;
        OutputDebugStringA("endpoints: no GetEngineHookPoints export -- RVA path (SWGEmu Pre-CU)");
        return false;
    }

    // Advertised client: latch the dual-path flag BEFORE resolving so the per-subsystem
    // install gate (isAdvertisedClient()) is armed before any createDetours() runs.
    s_advertisedClient = true;

    // Call GetEngineHookPoints() — NEVER read the raw static array (static-init race fix).
    // See GROUNDTRUTH-advertised-hooks.md §Static-init race fix (engine_advertise.cpp:636-687).
    const EngineHookPoints* table = pGet();
    resolve(table, g_agentBindings, g_agentBindingCount);
    return true;
}

bool isAdvertisedClient()
{
    return s_advertisedClient;
}

} // namespace endpoints
} // namespace swg
