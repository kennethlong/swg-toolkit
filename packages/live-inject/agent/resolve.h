/**
 * resolve.h — Engine hook point contract structs and resolver declarations.
 *
 * Contract structs copied verbatim from engine_hookpoints.h:77-93
 * (byte-identical in swg-client-v2 and Utinni repos).
 *
 * // Implementation in Plan 03-02
 */

#pragma once
#include <Windows.h>

// Contract structs — MUST match engine_advertise.cpp exactly.
// engine_hookpoints.h:77-93
struct EngineHookPoint  { const char* name; void* addr; };
struct EngineHookPoints { unsigned version; unsigned count; const EngineHookPoint* entries; };
#define ENGINE_HOOKPOINTS_VERSION 6

namespace swg {
namespace endpoints {

/**
 * In-process resolution: calls GetEngineHookPoints() from the EXE's export table.
 * Returns true if the advertised client table was found and applied.
 * Returns false if this is a legacy SWGEmu client (no GetEngineHookPoints export) —
 * in that case, RVA literals from rva_table.cpp remain active.
 *
 * Implementation in Plan 03-02.
 */
bool resolveFromExe();

/**
 * Returns true if the loaded EXE exports GetEngineHookPoints (advertised client).
 * Returns false for legacy SWGEmu (no export).
 *
 * Implementation in Plan 03-02.
 */
bool isAdvertisedClient();

/**
 * Look up a single function pointer by name from the hook-points table.
 * A missing name returns nullptr — the caller leaves the slot unchanged (graceful).
 * Pure / Win32-free / testable standalone.
 *
 * Implementation in Plan 03-02.
 */
void* lookupByName(const EngineHookPoints* table, const char* name);

} // namespace endpoints
} // namespace swg
