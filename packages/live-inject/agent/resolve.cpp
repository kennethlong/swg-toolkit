/**
 * resolve.cpp — Engine hook point resolver stubs.
 *
 * Full implementation in Plan 03-02.
 * Harvested source: Utinni UtinniCore/swg/endpoints.cpp:114-185 (pure lookupByName)
 *                   and endpoints_bindings.cpp:802-825 (resolveFromExe).
 */

#include "resolve.h"

namespace swg {
namespace endpoints {

static bool s_advertisedClient = false;

bool resolveFromExe() {
    // TODO: implement in Plan 03-02
    // 1. GetModuleHandleA(nullptr) → hExe
    // 2. GetProcAddress(hExe, "GetEngineHookPoints")
    // 3. If found: call it, resolve name-keyed bindings
    // 4. If not found: s_advertisedClient = false (legacy SWGEmu path)
    return false;
}

bool isAdvertisedClient() {
    return s_advertisedClient;
}

void* lookupByName(const EngineHookPoints* table, const char* name) {
    // TODO: implement in Plan 03-02
    return nullptr;
}

} // namespace endpoints
} // namespace swg
