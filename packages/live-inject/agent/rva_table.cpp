/**
 * rva_table.cpp — Legacy known-RVA literals harvested from Utinni source.
 *
 * These are only used when isAdvertisedClient() returns false
 * (legacy SWGEmu clients without GetEngineHookPoints export).
 *
 * // Legacy known-RVA literals harvested from Utinni source — implemented in Plan 03-02
 *
 * Source:
 *   D:/Code/Utinni/UtinniCore/swg/object/object.cpp:43-146
 *   D:/Code/Utinni/UtinniCore/swg/game/game.cpp:41-98
 *
 * Calling-convention rule: Use MSVC __thiscall directly on function pointers.
 * Do NOT hand-emulate __fastcall(ECX,EDX,args).
 * Port typedefs verbatim — MSVC's __thiscall pointer call does the ECX-this passing.
 *
 * TODO: full catalog implementation in Plan 03-02
 */

#include <Windows.h>
