cmake_minimum_required(VERSION 3.15)
project(swg_core_lib)

# Engine-free C++20 static library — no N-API, no SOE engine deps.
# Decision D-02: whole native-core package unified on C++20.
set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

# ── Source files ──────────────────────────────────────────────────────────────
set(CORE_SOURCES
    compress/Zlib.cpp
    tre/TreArchive.cpp
)

# ── Static library ────────────────────────────────────────────────────────────
add_library(swg_core STATIC ${CORE_SOURCES})

# ── Include directories ───────────────────────────────────────────────────────
# Include the modules/core root so callers can #include "io/IInputStream.h" etc.
target_include_directories(swg_core PUBLIC
    ${CMAKE_CURRENT_SOURCE_DIR}
)

# ── zlib ─────────────────────────────────────────────────────────────────────
# Strategy: use Node.js's bundled zlib headers (from CMAKE_JS_INC) and link
# against node.lib (CMAKE_JS_LIB) which exports zlib inflate/deflate symbols
# since Node.js embeds zlib internally.
#
# CMAKE_JS_INC is set by cmake-js to the Node.js headers directory (contains zlib.h).
# cmake-js sets this globally in the parent CMakeLists.txt; propagate it here.
#
# Fallback: find_package(ZLIB) for non-cmake-js builds (e.g. CI runners with system zlib).
if(DEFINED CMAKE_JS_INC)
    target_include_directories(swg_core PUBLIC ${CMAKE_JS_INC})
    # zlib symbols come from node.lib (linked by the addon target that uses this lib)
    # No separate target_link_libraries needed for the static lib itself.
    target_compile_definitions(swg_core PRIVATE SWG_ZLIB_FROM_NODE=1)
    message(STATUS "swg_core: using Node.js bundled zlib from ${CMAKE_JS_INC}")
else()
    find_package(ZLIB REQUIRED)
    target_link_libraries(swg_core PUBLIC ZLIB::ZLIB)
    message(STATUS "swg_core: using system zlib")
endif()

# Compile definitions — safety + clarity
target_compile_definitions(swg_core PRIVATE
    # Suppress MSVC "deprecated" warnings for standard C functions
    _CRT_SECURE_NO_WARNINGS
)
