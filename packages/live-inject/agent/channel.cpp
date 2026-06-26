/**
 * channel.cpp — CreateFileMapping seqlock writer stubs (agent side).
 *
 * The host creates the file-mapping before inject; the agent opens it here.
 * Naming convention: "Local\\SwgToolkitLive_<pid>"
 * (mirrors Utinni main.cpp "Local\\UtinniReady_<pid>")
 *
 * Full implementation in Plan 03-05.
 * Shape follows native-core/src/sab.cpp OpenFileMappingA/MapViewOfFile pattern.
 */

#include <Windows.h>

static HANDLE s_hMap  = nullptr;
static void*  s_view  = nullptr;

// TODO: implement in Plan 03-05
bool channelOpen(const char* mappingName, size_t byteSize) {
    return false;
}

// TODO: implement in Plan 03-05
// Seqlock write: increment seq (odd), write payload, increment seq (even).
// Reader on the host side: reads seq, reads payload, reads seq again; retry if odd or changed.
void channelWrite(const void* state, size_t stateSize) {
    // stub
}

// TODO: implement in Plan 03-05
void channelClose() {
    if (s_view)  { UnmapViewOfFile(s_view); s_view = nullptr; }
    if (s_hMap)  { CloseHandle(s_hMap);     s_hMap = nullptr; }
}
