cmake_minimum_required(VERSION 3.15)
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

# Plain Win32 DLL — NOT an N-API module.
# No cmake-js, no node-addon-api includes, no NAPI_* defines.
# kernel32.lib links implicitly (MSVC default Win32 lib set).
# The Windows SDK headers come from MSVC's default include path.

file(GLOB AGENT_SOURCES "*.cpp")

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
