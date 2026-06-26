cmake_minimum_required(VERSION 3.15)
project(swg_live_inject)

# host addon — x64 via cmake-js;
# agent DLL is a SEPARATE build in agent/ (plain Win32, -A Win32)

# C++20: matches the standard used by native-core (Decision D-02).
set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

# cmake-js provides CMAKE_JS_INC, CMAKE_JS_LIB, CMAKE_JS_SRC automatically
include_directories(${CMAKE_JS_INC})

# Glob all .cpp sources in src/
file(GLOB SOURCE_FILES "src/*.cpp")

# Build as a shared library (.node extension)
add_library(${PROJECT_NAME} SHARED ${SOURCE_FILES} ${CMAKE_JS_SRC})
set_target_properties(${PROJECT_NAME} PROPERTIES
    PREFIX ""
    SUFFIX ".node"
)
target_link_libraries(${PROJECT_NAME} ${CMAKE_JS_LIB})

# node-addon-api: include the napi.h header.
# In a pnpm workspace with nodeLinker:hoisted, node-addon-api is hoisted to the
# workspace root (two levels above packages/live-inject). We search both the
# package-local node_modules (bare-npm / non-pnpm installs) and the workspace
# root node_modules (pnpm hoisted layout). cmake-js sets CMAKE_SOURCE_DIR to
# the directory containing this CMakeLists.txt (packages/live-inject/).
target_include_directories(${PROJECT_NAME} PRIVATE
    ${CMAKE_SOURCE_DIR}/node_modules/node-addon-api
    ${CMAKE_SOURCE_DIR}/../../node_modules/node-addon-api
)

# Compile definitions (ALL THREE REQUIRED):
# - NAPI_DISABLE_CPP_EXCEPTIONS: use value-return style, not C++ exceptions
# - NAPI_VERSION=8: target N-API version 8
# - NAPI_EXPERIMENTAL: required to enable experimental N-API features
target_compile_definitions(${PROJECT_NAME} PRIVATE
    NAPI_DISABLE_CPP_EXCEPTIONS
    NAPI_VERSION=8
    NAPI_EXPERIMENTAL
)

# NOTE: Do NOT add add_subdirectory(modules/core) or link swg_core/swg_zlib.
# live-inject has no format-tower dependency — its only non-cmake-js dependency
# is Win32 SDK headers (present via MSVC); kernel32.lib / advapi32.lib link implicitly.
