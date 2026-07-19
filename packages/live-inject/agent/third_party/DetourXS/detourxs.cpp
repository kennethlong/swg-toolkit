#include "DetourXS.h"
#include <cstdlib>
#include <cstdio>
#include <windows.h>
#include <libloaderapi.h>
#include <memoryapi.h>

// SWG-Toolkit vendoring: the upstream (Utinni) copy of this guard logged via
// utinni::log::warning. The toolkit agent has no such logger and stays
// KERNEL32-only, so warnings go to OutputDebugStringA (visible in DebugView /
// the attached debugger) — keeping the unmapped-target guard's behavior intact.
namespace utinni { namespace log {
    inline void warning(const char* text) { OutputDebugStringA(text); }
} }

// Utinni guard (Phase 24): a detour target that was NOT resolved from the
// GetEngineHookPoints advertised catalog still holds its raw SWGEmu absolute
// address. On the ASLR-relocated advertised client that address is unmapped, and
// GetDetourLenAuto() disassembles bytes AT the target to size the detour -- reading
// an unmapped target faults (0xC0000005, the createDetours crash). This validates
// the target is committed + executable before any read. On SWGEmu every target is a
// valid mapped address, so this never rejects (the path stays byte-for-byte unchanged).
static bool utinniIsDetourTargetExecutable(LPCVOID addr, SIZE_T needBytes)
{
    if (addr == nullptr)
        return false;

    MEMORY_BASIC_INFORMATION mbi;
    if (VirtualQuery(addr, &mbi, sizeof(mbi)) == 0)
        return false;
    if (mbi.State != MEM_COMMIT)
        return false;
    if (mbi.Protect & PAGE_GUARD)
        return false;

    const DWORD base = mbi.Protect & 0xFF; // strip PAGE_GUARD/NOCACHE/WRITECOMBINE modifiers
    const bool executable = (base == PAGE_EXECUTE) || (base == PAGE_EXECUTE_READ) ||
                            (base == PAGE_EXECUTE_READWRITE) || (base == PAGE_EXECUTE_WRITECOPY);
    if (!executable)
        return false;

    // Ensure the bytes the disassembler may touch lie inside this committed region.
    const BYTE* regionEnd = (const BYTE*)mbi.BaseAddress + mbi.RegionSize;
    if ((const BYTE*)addr + needBytes > regionEnd)
        return false;

    return true;
}

#define DETOUR_MAX_SRCH_OPLEN 64

#define JMP32_SZ 5
#define BIT32_SZ 4

// jmp32 sig
#define SIG_SZ 3
#define SIG_OP_0 0xCC
#define SIG_OP_1 0x90
#define SIG_OP_2 0xC3
namespace Detour
{
    LPVOID CheckPointer(LPVOID Address);
    int GetDetourLen(int patchType);
    int GetDetourLenAuto(PBYTE &pbFuncOrig, int minDetLen);

    DWORD CheckPointer(DWORD Address)
    {
	    BYTE call = *(BYTE*)Address;

    #ifdef DEBUGLOG
	    bool jumpFound = false;
	    if (call == 0xE8 || call == 0xE9) {
		    jumpFound = true;
		    //dbglog("Jump detected: 0x%08X", Address);
	    }
    #endif

	    while (call == 0xE8 || call == 0xE9) {
    #ifdef DEBUGLOG
		    //log(" -> ");
    #endif
		    Address = Address + *(DWORD*)(Address + 1) + 5;
    #ifdef DEBUGLOG
		    //log("0x%08X", Address);
    #endif
		    call = *(BYTE*)Address;
	    }

    #ifdef DEBUGLOG
	    if (jumpFound)
		    logln();
    #endif
	    return Address;
    }

    LPVOID Create(LPVOID lpFuncOrig, LPVOID lpFuncDetour, int detourLen)
    {
	    return Create(lpFuncOrig, lpFuncDetour, DETOUR_TYPE_JMP, detourLen);
    }

    // Thin wrapper for APIs
    LPVOID Create(LPCSTR lpModuleName, LPCSTR lpProcName, LPVOID lpFuncDetour, DETOUR_TYPE patchType, int detourLen)
    {
	    LPVOID lpFuncOrig = nullptr;

	    if ((lpFuncOrig = GetProcAddress(GetModuleHandle(lpModuleName), lpProcName)) == nullptr)
		    return nullptr;

	    return Create((LPVOID)CheckPointer((DWORD)lpFuncOrig), lpFuncDetour, patchType, detourLen);
    }

    LPVOID Create(LPVOID lpFuncOrig, LPVOID lpFuncDetour, DETOUR_TYPE patchType, int detourLen)
    {
	    // Utinni guard (Phase 24): skip a detour whose target is not committed +
	    // executable -- i.e. an endpoint left at its raw SWGEmu literal because it
	    // was not in the advertised catalog, which is unmapped on the relocated
	    // advertised client. Returning lpFuncOrig unchanged honours the dual-path
	    // design's "unresolved => don't install" precondition and prevents the
	    // 0xC0000005 read fault in GetDetourLenAuto() below. DETOUR_MAX_SRCH_OPLEN
	    // bounds how far the disassembler can walk past the target.
	    if (!utinniIsDetourTargetExecutable(lpFuncOrig, DETOUR_MAX_SRCH_OPLEN))
	    {
		    char dbg[112];
		    _snprintf_s(dbg, sizeof(dbg), _TRUNCATE,
		                "Detour::Create skipped unmapped target 0x%08X (endpoint unresolved on advertised client)",
		                (DWORD)(DWORD_PTR)lpFuncOrig);
		    utinni::log::warning(dbg);
		    return lpFuncOrig;
	    }

	    LPVOID lpMallocPtr = nullptr;
	    DWORD dwProt = NULL;
	    PBYTE pbMallocPtr = nullptr;
	    PBYTE pbFuncOrig = (PBYTE)lpFuncOrig;
	    PBYTE pbFuncDetour = (PBYTE)lpFuncDetour;
	    PBYTE pbPatchBuf = nullptr;
	    int minDetLen = 0;
	    int detLen = 0;

	    // Get detour length
	    if ((minDetLen = GetDetourLen(patchType)) == 0)
		    return nullptr;

	    if (detourLen != DETOUR_LEN_AUTO)
	    {
		    detLen = detourLen;
		    // Explicit length must be >= the patch type's required size, otherwise
		    // the case-specific writes below overflow pbPatchBuf (e.g. PUSH_RET writes
		    // pbPatchBuf[5] which is OOB if detLen=5) AND the terminating opcode never
		    // gets copied back to the target, leaving the patched function malformed.
		    if (detLen < minDetLen)
			    return nullptr;
	    }
	    else if ((detLen = GetDetourLenAuto(pbFuncOrig, minDetLen)) < minDetLen)
		    return nullptr;

	    // Alloc mem for the overwritten bytes
	    if ((lpMallocPtr = (LPVOID)malloc(detLen + JMP32_SZ + SIG_SZ)) == nullptr)
		    return nullptr;

	    pbMallocPtr = (PBYTE)lpMallocPtr;

	    // Enable writing to original
	    VirtualProtect(pbMallocPtr, detLen + JMP32_SZ + SIG_SZ, PAGE_EXECUTE_READWRITE, &dwProt);
	    VirtualProtect(lpFuncOrig, detLen, PAGE_READWRITE, &dwProt);

	    // Write overwritten bytes to the malloc
	    memcpy(lpMallocPtr, lpFuncOrig, detLen);
	    pbMallocPtr += detLen;
	    pbMallocPtr[0] = 0xE9;
	    *(DWORD*)(pbMallocPtr + 1) = (DWORD)((pbFuncOrig + detLen) - pbMallocPtr) - JMP32_SZ;
	    pbMallocPtr += JMP32_SZ;
	    pbMallocPtr[0] = SIG_OP_0;
	    pbMallocPtr[1] = SIG_OP_1;
	    pbMallocPtr[2] = SIG_OP_2;

	    // Create a buffer to prepare the detour bytes
	    pbPatchBuf = new BYTE[detLen];
	    memset(pbPatchBuf, 0x90, detLen);

	    switch (patchType)
	    {
	    case DETOUR_TYPE_JMP:
		    pbPatchBuf[0] = 0xE9;
		    *(DWORD*)&pbPatchBuf[1] = (DWORD)(pbFuncDetour - pbFuncOrig) - 5;
		    break;

	    case DETOUR_TYPE_PUSH_RET:
		    pbPatchBuf[0] = 0x68;
		    *(DWORD*)&pbPatchBuf[1] = (DWORD)pbFuncDetour;
		    pbPatchBuf[5] = 0xC3;
		    break;

	    case DETOUR_TYPE_NOP_JMP:
		    pbPatchBuf[0] = 0x90;
		    pbPatchBuf[1] = 0xE9;
		    *(DWORD*)&pbPatchBuf[2] = (DWORD)(pbFuncDetour - pbFuncOrig) - 6;
		    break;

	    case DETOUR_TYPE_NOP_NOP_JMP:
		    pbPatchBuf[0] = 0x90;
		    pbPatchBuf[1] = 0x90;
		    pbPatchBuf[2] = 0xE9;
		    *(DWORD*)&pbPatchBuf[3] = (DWORD)(pbFuncDetour - pbFuncOrig) - 7;
		    break;

	    case DETOUR_TYPE_STC_JC:
		    pbPatchBuf[0] = 0xF9;
		    pbPatchBuf[1] = 0x0F;
		    pbPatchBuf[2] = 0x82;
		    *(DWORD*)&pbPatchBuf[3] = (DWORD)(pbFuncDetour - pbFuncOrig) - 7;
		    break;

	    case DETOUR_TYPE_CLC_JNC:
		    pbPatchBuf[0] = 0xF8;
		    pbPatchBuf[1] = 0x0F;
		    pbPatchBuf[2] = 0x83;
		    *(DWORD*)&pbPatchBuf[3] = (DWORD)(pbFuncDetour - pbFuncOrig) - 7;
		    break;


        case DETOUR_TYPE_PATCH_CALL:
            pbPatchBuf[0] = 0xE8;
            *(DWORD*)&pbPatchBuf[1] = (DWORD)pbFuncDetour;
            break;
	    default:
		    return nullptr;
	    }

	    // Write the detour
	    for (int i = 0; i<detLen; i++)
		    pbFuncOrig[i] = pbPatchBuf[i];

	    // 2026-05-19: pbPatchBuf was allocated with `new BYTE[detLen]` (line 110),
	    // so scalar `delete pbPatchBuf` is undefined behaviour and triggers the
	    // Debug CRT's HEAP_CORRUPTION check at injection time. Use the matching
	    // array delete; in Release builds the prior code likely left the heap in
	    // a degraded state which is a plausible root cause of downstream weirdness
	    // (silent stalls, CLR exceptions inside SWG) seen during 2026-05-19 UAT.
	    delete[] pbPatchBuf;

	    // Reset original mem flags. The 4th arg is an out-pointer; the original
	    // code allocated a fresh DWORD with `new DWORD` and never freed it (leak
	    // on every Detour::Create call). Use a local instead.
	    DWORD dwOldProt = 0;
	    VirtualProtect(lpFuncOrig, detLen, dwProt, &dwOldProt);

	    return lpMallocPtr;
    }

    bool Remove(LPVOID lpDetourCreatePtr)
    {
	    PBYTE pbMallocPtr = nullptr;
	    DWORD dwFuncOrig = NULL;
	    DWORD dwProt = NULL;
	    int i = 0;

	    if ((pbMallocPtr = (PBYTE)lpDetourCreatePtr) == nullptr)
		    return false;

	    // Find the orig jmp32 opcode sig
	    for (i = 0; i <= DETOUR_MAX_SRCH_OPLEN; i++)
	    {
		    if (pbMallocPtr[i] == SIG_OP_0
			    && pbMallocPtr[i + 1] == SIG_OP_1
			    && pbMallocPtr[i + 2] == SIG_OP_2)
			    break;

		    if (i == DETOUR_MAX_SRCH_OPLEN)
			    return false;
	    }

	    // Calculate the original address
	    pbMallocPtr += (i - JMP32_SZ + 1); // Inc to jmp
	    dwFuncOrig = *(DWORD*)pbMallocPtr; // Get 32bit jmp
	    pbMallocPtr += BIT32_SZ; // Inc to end of jmp
	    dwFuncOrig += (DWORD)pbMallocPtr; // Add this addr to 32bit jmp
	    dwFuncOrig -= (i - JMP32_SZ); // Dec by detour len to get to start of orig

								      // Write the overwritten bytes back to the original
	    VirtualProtect((LPVOID)dwFuncOrig, (i - JMP32_SZ), PAGE_READWRITE, &dwProt);
	    memcpy((LPVOID)dwFuncOrig, lpDetourCreatePtr, (i - JMP32_SZ));
	    // 2026-05-19: same `new DWORD` leak fix as Detour::Create. Use a local.
	    DWORD dwOldProt = 0;
	    VirtualProtect((LPVOID)dwFuncOrig, (i - JMP32_SZ), dwProt, &dwOldProt);

	    return true;
    }

    int GetDetourLen(int patchType)
    {
	    switch (patchType)
	    {
        case DETOUR_TYPE_PATCH_CALL:
	    case DETOUR_TYPE_JMP:
		    return 5;

	    case DETOUR_TYPE_PUSH_RET:
	    case DETOUR_TYPE_NOP_JMP:
		    return 6;

	    case DETOUR_TYPE_NOP_NOP_JMP:
	    case DETOUR_TYPE_STC_JC:
	    case DETOUR_TYPE_CLC_JNC:
		    return 7;

	    default:
		    return 0;
	    }
    }

    int GetDetourLenAuto(PBYTE &pbFuncOrig, int minDetLen)
    {
	    int len = 0;
	    PBYTE pbCurOp = pbFuncOrig;

	    while (len < minDetLen)
	    {
		    int i = oplen(pbCurOp);

		    if (i == 0 || i == -1)
			    return 0;

		    if (len > DETOUR_MAX_SRCH_OPLEN)
			    return 0;

		    len += i;
		    pbCurOp += i;
	    }

	    return len;
    }

}