cmake_minimum_required(VERSION 3.15)
project(swg_native_core)

# Require C++17 for node-addon-api 8 (uses std::string_view in napi-inl.h)
set(CMAKE_CXX_STANDARD 17)
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
# workspace root (two levels above packages/native-core). We search both the
# package-local node_modules (bare-npm / non-pnpm installs) and the workspace
# root node_modules (pnpm hoisted layout). cmake-js sets CMAKE_SOURCE_DIR to
# the directory containing this CMakeLists.txt (packages/native-core/).
target_include_directories(${PROJECT_NAME} PRIVATE
    ${CMAKE_SOURCE_DIR}/node_modules/node-addon-api
    ${CMAKE_SOURCE_DIR}/../../node_modules/node-addon-api
)

# Compile definitions (ALL THREE REQUIRED):
# - NAPI_DISABLE_CPP_EXCEPTIONS: use value-return style, not C++ exceptions
# - NAPI_VERSION=8: target N-API version 8 (required for SharedArrayBuffer)
# - NAPI_EXPERIMENTAL: REQUIRED to enable Napi::SharedArrayBuffer::New
#   Ground truth (RESEARCH Pitfall 4): Napi::SharedArrayBuffer is gated by
#   #ifdef NODE_API_EXPERIMENTAL_HAS_SHAREDARRAYBUFFER in napi.h, which is
#   only defined when NAPI_EXPERIMENTAL is set. Without it, the SAB symbol
#   fails to compile ("undefined symbol Napi::SharedArrayBuffer").
#   node-addon-api >= 8.6.0 is required (class lands in 8.6.0); pinned at ^8.8.0.
target_compile_definitions(${PROJECT_NAME} PRIVATE
    NAPI_DISABLE_CPP_EXCEPTIONS
    NAPI_VERSION=8
    NAPI_EXPERIMENTAL
)

# Phase 1 seed:
# add_subdirectory(modules/core) when TRE/IFF C++ lands
# (do NOT add an actual add_subdirectory here — no CMakeLists.txt in modules/ yet)
