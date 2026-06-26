/**
 * resolve.h — Engine hook point contract structs and resolver declarations.
 *
 * Contract structs verbatim from engine_hookpoints.h:77-93
 * (byte-identical in swg-client-v2 and Utinni repos).
 *
 * LEAN-HEADER CONTRACT (mirrors Utinni endpoints.h design): includes only
 * <cstddef> and <cstring> — no Windows.h, no injection headers.
 * The pure lookupByName/resolve functions are Win32-free and can be
 * unit-tested standalone without any DLL access (D-03b).
 */

#pragma once
#include <cstddef>
#include <cstring>

// Contract structs — MUST match engine_advertise.cpp exactly.
// Verbatim from engine_hookpoints.h:77-93.
struct EngineHookPoint  { const char* name; void* addr; };
struct EngineHookPoints { unsigned version; unsigned count; const EngineHookPoint* entries; };
#define ENGINE_HOOKPOINTS_VERSION 6

namespace swg {
namespace endpoints {

/**
 * One binding: a stable contract name → the storage cell of the existing
 * fn-pointer literal (void** so the resolver can overwrite any concrete typedef
 * the subsystem declared — the cast back to the typed pointer is the subsystem's,
 * unchanged). Ported from Utinni endpoints.h Binding struct.
 */
struct Binding {
    const char* name;  // contract name, e.g. "object::getTransform_o2w"
    void**      slot;  // &typed_fn_pointer — overwritten on the advertised-client path
};

/**
 * Pure / Win32-free linear scan of table->entries for `name`.
 * Returns the borrowed addr or nullptr if name not found or table is null/partial.
 * A missing name NEVER nulls the caller's slot — graceful degrade only.
 * (Ported from Utinni endpoints.cpp:114-130.)
 */
const void* lookupByName(const EngineHookPoints* table, const char* name);

/**
 * For each binding whose name is found in table with a non-null addr,
 * overwrites *slot with that addr; a missing name leaves the RVA literal UNTOUCHED.
 * A version mismatch logs a soft warning (OutputDebugStringA) but still resolves by name.
 * Returns the count of names resolved.
 * (Ported from Utinni endpoints.cpp:132-201.)
 */
int resolve(const EngineHookPoints* table, const Binding* bindings, size_t count);

/**
 * Win32 shell: GetModuleHandleA(nullptr) + GetProcAddress("GetEngineHookPoints").
 * Found → s_advertisedClient=true, calls resolve() with g_agentBindings, returns true.
 * Not found → s_advertisedClient=false, STRICT NO-OP, RVA literals unchanged, returns false.
 * (Ported from Utinni endpoints_bindings.cpp:809-856.)
 */
bool resolveFromExe();

/**
 * Returns true if resolveFromExe() found the GetEngineHookPoints export (advertised client).
 * Returns false for legacy SWGEmu (export absent — hardcoded RVA path active).
 */
bool isAdvertisedClient();

} // namespace endpoints
} // namespace swg
