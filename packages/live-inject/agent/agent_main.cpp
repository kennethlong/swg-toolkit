/**
 * agent_main.cpp — DllMain and agent_init entry point stubs.
 *
 * DllMain: do NOTHING except DisableThreadLibraryCalls.
 * All real work runs on agent_init's thread (called via CreateRemoteThread
 * from the launcher), NOT in DllMain. Rationale: loader lock + uninitialized CRT.
 *
 * Shape harvested from Utinni Launcher/main.cpp:80-115 and UtinniCore DllMain pattern.
 *
 * TODO: full implementation in Plan 03-04 (agent_main task)
 */

#include <Windows.h>

BOOL APIENTRY DllMain(HMODULE hModule, DWORD reason, LPVOID) {
    if (reason == DLL_PROCESS_ATTACH)
        DisableThreadLibraryCalls(hModule);
    return TRUE;
}

// agent_init — the real entry point, fired on a fresh remote thread by the launcher.
// lpReadyEventName: pointer to a C-string in our process (written there by the launcher).
extern "C" __declspec(dllexport)
DWORD WINAPI agent_init(LPVOID lpReadyEventName) {
    // TODO: full implementation in Plan 03-04
    // Steps (see PATTERNS.md §agent_main.cpp):
    // 1. Open the ready event by name (lpReadyEventName)
    // 2. resolveFromExe() — name-keyed endpoint resolution
    // 3. Create/open file-mapping channel
    // 4. SetEvent(hReady) — unblock launcher
    // 5. Enter the read-verify poll loop
    return 0;
}
