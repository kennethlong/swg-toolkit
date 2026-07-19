cmake_minimum_required(VERSION 3.15)

# ── vcpkg toolchain (must be resolved BEFORE project()) ──────────────────────
# The render-overlay deps (imgui + imguizmo, Slice-0 spike) come from vcpkg,
# built with the x86-windows-static triplet so their CRT linkage is /MT and the
# libs fold into this self-contained DLL (KERNEL32-only runtime dep — see the
# /MT rationale below). We reuse Utinni's proven imgui/imguizmo version pair via
# agent/vcpkg.json + vcpkg-configuration.json (same registry baseline).
#
# If the caller already passed -DCMAKE_TOOLCHAIN_FILE we respect it. Otherwise we
# auto-locate vcpkg's toolchain from $VCPKG_ROOT, then from the VS-bundled copy.
if(NOT DEFINED CMAKE_TOOLCHAIN_FILE)
    set(_agent_vcpkg_candidates "")
    if(DEFINED ENV{VCPKG_ROOT})
        list(APPEND _agent_vcpkg_candidates "$ENV{VCPKG_ROOT}/scripts/buildsystems/vcpkg.cmake")
    endif()
    # VS-bundled vcpkg (Community/Professional/Enterprise, VS 2022 and VS 18)
    foreach(_vs_root
            "C:/Program Files/Microsoft Visual Studio/2022/Community"
            "C:/Program Files/Microsoft Visual Studio/2022/Professional"
            "C:/Program Files/Microsoft Visual Studio/2022/Enterprise"
            "D:/Program Files/Microsoft Visual Studio/18/Community")
        list(APPEND _agent_vcpkg_candidates "${_vs_root}/VC/vcpkg/scripts/buildsystems/vcpkg.cmake")
    endforeach()
    foreach(_cand ${_agent_vcpkg_candidates})
        if(EXISTS "${_cand}")
            set(CMAKE_TOOLCHAIN_FILE "${_cand}" CACHE STRING "vcpkg toolchain (auto-located)")
            break()
        endif()
    endforeach()
    if(NOT DEFINED CMAKE_TOOLCHAIN_FILE)
        message(FATAL_ERROR
            "vcpkg toolchain not found. Set VCPKG_ROOT or pass "
            "-DCMAKE_TOOLCHAIN_FILE=<vcpkg>/scripts/buildsystems/vcpkg.cmake")
    endif()
endif()
# Static triplet => /MT libs that match this DLL's static CRT.
if(NOT DEFINED VCPKG_TARGET_TRIPLET)
    set(VCPKG_TARGET_TRIPLET "x86-windows-static" CACHE STRING "vcpkg triplet (static /MT x86)")
endif()

project(swg_toolkit_agent)

# ARCH REQUIREMENT: This DLL must be x86 (Win32) to match the SWG client (x86).
# Build separately from the host addon:
#   cmake -B build-agent -A Win32 -G "Visual Studio 17 2022"
#   cmake --build build-agent --config Release
# The host addon (../CMakeLists.txt) is x64 via cmake-js.
# These are TWO SEPARATE cmake invocations — never try to build both from one cmake root.

# x86 MSVC TOOLSET REQUIRED: Confirm 'MSVC v143 C++ x64/x86 build tools' is
# installed in VS 17 2022 before building. Missing = blocking. Check:
#   vswhere -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -format list
# Run the following from a Developer PowerShell to confirm x86 toolset presence before Plan 03-02:
#   vswhere -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -format list
# A missing x86 toolset is a hard blocker for the agent build — install via VS Installer
# "MSVC v143 ... x86/x64 build tools" component before proceeding.

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

# STATIC CRT (/MT) — MANDATORY for an injected DLL.
# The agent is loaded by a remote LoadLibraryA inside the SWG client process,
# whose DLL search path is the client's own directory. A dynamic-CRT (/MD) build
# depends on VCRUNTIME140.dll + the UCRT api-ms-win-crt-*.dll, none of which sit
# beside the old x86 client — so the remote LoadLibraryA returns NULL and
# injection fails with "DLL not loaded". Static-linking the CRT leaves only a
# KERNEL32 dependency, making the agent self-contained. CMP0091 (NEW since the
# 3.15 minimum above) enables the MSVC_RUNTIME_LIBRARY abstraction.
set(CMAKE_MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>")

# Plain Win32 DLL — NOT an N-API module.
# No cmake-js, no node-addon-api includes, no NAPI_* defines.
# kernel32.lib links implicitly (MSVC default Win32 lib set).
# The Windows SDK headers come from MSVC's default include path.

file(GLOB AGENT_SOURCES "*.cpp")

# DetourXS — function-detour lib for the D3D9 Present-vtable hook (Slice-0).
# Vendored as source (Utinni compiles it directly too); folds into the /MT DLL.
set(DETOURXS_DIR "${CMAKE_CURRENT_SOURCE_DIR}/third_party/DetourXS")
list(APPEND AGENT_SOURCES
    "${DETOURXS_DIR}/detourxs.cpp"
    "${DETOURXS_DIR}/ADE32.cpp")

# exports.def forces the public export name for agent_init to its UNDECORATED
# form. agent_init is __stdcall (WINAPI) as required by CreateRemoteThread, which
# on x86 would otherwise decorate the export to `_agent_init@4`. The host injector
# looks it up by the clean name `agent_init` via GetProcAddress, so the .def is
# mandatory for injection to succeed. MSVC consumes a .def listed in the target
# sources as its /DEF module-definition file.
add_library(${PROJECT_NAME} SHARED ${AGENT_SOURCES} exports.def)
set_target_properties(${PROJECT_NAME} PROPERTIES
    PREFIX ""
    SUFFIX ".dll"
)

target_include_directories(${PROJECT_NAME} PRIVATE "${DETOURXS_DIR}")

# ── Render-overlay deps (Slice-0 spike) ──────────────────────────────────────
# imgui (with the dx9 + dx11 + win32 backends compiled in via the vcpkg features)
# and imguizmo, both static /MT from the x86-windows-static triplet.
#
# System libs: d3d11 + dxgi (advertised gl11 client — the Present hook target),
# d3dcompiler (imgui's DX11 backend compiles its shaders at init), imm32 (imgui's
# win32 backend IME), d3d9 (kept for the future legacy-SWGEmu D3D9 overlay path).
# These are OS DLLs present on any D3D11-capable Windows and alongside the client,
# so they do NOT break the remote-LoadLibraryA self-containment (unlike the CRT).
find_package(imgui CONFIG REQUIRED)
find_package(imguizmo CONFIG REQUIRED)
target_link_libraries(${PROJECT_NAME} PRIVATE
    imgui::imgui
    imguizmo::imguizmo
    d3d11
    dxgi
    d3dcompiler
    imm32
    d3d9)
