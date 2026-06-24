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
    tre/Crc.cpp
    tre/TreArchive.cpp
    tre/TreMount.cpp
    tre/TreBuilder.cpp
    iff/Iff.cpp
    geometry/DeIndex.cpp
    formats/Mesh.cpp
    formats/MeshLod.cpp
    formats/Shader.cpp
    formats/Palette.cpp
    formats/Dds.cpp
    formats/LodDistanceTable.cpp
    formats/SkeletalMeshGen.cpp
    formats/Skeleton.cpp
    formats/SkeletalAppearance.cpp
    formats/StaticAppearance.cpp
    formats/DetailAppearance.cpp
)

# ── Vendored zlib 1.2.3 (static) ───────────────────────────────────────────────
# Strategy: compile the SWG client's own zlib 1.2.3 (vendored under compress/zlib/)
# directly into a static lib. This makes the addon HOST-INDEPENDENT: it carries its
# own inflate/deflate and no longer resolves zlib symbols from the host executable's
# exports.
#
# WHY (defect being fixed): the previous SWG_ZLIB_FROM_NODE strategy relied on the
# host process exporting plain `inflate`/`inflateInit2_`/`inflateEnd`. node.exe does
# export those, but electron.exe prefixes them `Cr_z_*` and exports no plain names —
# so the addon hard-crashed the Electron renderer with ERROR_PROC_NOT_FOUND
# (0xC06D007F) on the first inflate call. Vendoring zlib statically fixes this.
#
# Ground truth: zlib 1.2.3 is the SAME zlib the original SWG client shipped, vendored
# from ../swg-client-v2/src/external/3rd/library/zlib-1.2.3/.
set(SWG_ZLIB_DIR ${CMAKE_CURRENT_SOURCE_DIR}/compress/zlib)
set(SWG_ZLIB_SOURCES
    ${SWG_ZLIB_DIR}/adler32.c
    ${SWG_ZLIB_DIR}/crc32.c
    ${SWG_ZLIB_DIR}/inflate.c
    ${SWG_ZLIB_DIR}/inftrees.c
    ${SWG_ZLIB_DIR}/inffast.c
    ${SWG_ZLIB_DIR}/zutil.c
    ${SWG_ZLIB_DIR}/deflate.c
    ${SWG_ZLIB_DIR}/trees.c
    ${SWG_ZLIB_DIR}/compress.c
    ${SWG_ZLIB_DIR}/uncompr.c
)

add_library(swg_zlib STATIC ${SWG_ZLIB_SOURCES})
target_include_directories(swg_zlib PUBLIC ${SWG_ZLIB_DIR})

# MSVC: zlib 1.2.3 emits deprecation / possible-loss-of-data warnings. Silence them
# for the vendored translation units ONLY (do not weaken warnings for swg_core proper).
if(MSVC)
    target_compile_options(swg_zlib PRIVATE /W0)
    target_compile_definitions(swg_zlib PRIVATE _CRT_SECURE_NO_WARNINGS _CRT_NONSTDC_NO_WARNINGS)
else()
    target_compile_options(swg_zlib PRIVATE -w)
endif()

# ── Static library ────────────────────────────────────────────────────────────
add_library(swg_core STATIC ${CORE_SOURCES})

# ── Include directories ───────────────────────────────────────────────────────
# Include the modules/core root so callers can #include "io/IInputStream.h" etc.
target_include_directories(swg_core PUBLIC
    ${CMAKE_CURRENT_SOURCE_DIR}
)

# ── zlib link ──────────────────────────────────────────────────────────────────
# Link the vendored static zlib. PRIVATE BEFORE so the vendored zlib 1.2.3 header
# wins over Node's bundled zlib.h (1.3.1) that is also on the include path via
# CMAKE_JS_INC — #include <zlib.h> in compress/Zlib.cpp MUST resolve to 1.2.3.
target_link_libraries(swg_core PRIVATE swg_zlib)
target_include_directories(swg_core BEFORE PRIVATE ${SWG_ZLIB_DIR})

# Compile definitions — safety + clarity
target_compile_definitions(swg_core PRIVATE
    # Suppress MSVC "deprecated" warnings for standard C functions
    _CRT_SECURE_NO_WARNINGS
)
