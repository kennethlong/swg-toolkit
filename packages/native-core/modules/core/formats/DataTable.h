/**
 * modules/core/formats/DataTable.h — Engine-free C++20 FORM DTII (.iff) datatable parser + serializer.
 *
 * PORT SOURCE:
 *   swg-client-v2 sharedUtility/src/shared/DataTable.cpp:400-476 (_readCell, load/load_0000/load_0001)
 *   swg-client-v2 sharedUtility/src/shared/DataTableWriter.cpp:650-664,723-748,821-912 (_saveTableToIff,
 *     physical write dispatch, Comment-stripping)
 *   swg-client-v2 sharedUtility/src/shared/DataTableColumnType.cpp:84-232 (type-spec parse dispatch)
 *
 * STRUCTURE (verified):
 *   FORM DTII
 *     FORM 0001              <- current/canonical version (this is what serializeDataTable emits)
 *       CHUNK COLS   <- int32 numCols, then numCols NUL-terminated ASCII strings (column names)
 *       CHUNK TYPE   <- numCols NUL-terminated ASCII strings (type-spec strings, e.g. "i", "e(a=0,b=1)")
 *       CHUNK ROWS   <- int32 numRows, then numRows*numCols cells (physical type = getBasicType())
 *     FORM 0000 (legacy, READ-ONLY)  <- DataTable.cpp:449-459, :480-555
 *       CHUNK COLS   <- same as 0001 (NUL-terminated name strings)
 *       CHUNK TYPE   <- numCols int32 DataType codes (0=Int,1=Float,2=String; anything else is FATAL
 *                        client-side) — a DIFFERENT wire shape than 0001's string TYPE chunk. This is
 *                        a correction versus this plan's Interfaces section, which described 0000 as
 *                        "same three-chunk shape" as 0001; ground truth (DataTable.cpp:500-535) shows
 *                        the TYPE chunk is int32-coded, not string-coded, for legacy 0000.
 *       CHUNK ROWS   <- same physical cell layout as 0001
 *
 * STRING ENCODING CORRECTION (verified against ground truth — NOT length-prefixed):
 *   swg-client-v2 Iff.cpp:1539-1564 (Iff::read_string(char*,int)) and :893-897 (insertChunkString) —
 *   DTII string cells (and every COLS/TYPE name) are NUL-TERMINATED ASCII, exactly like every other
 *   native-core format's chunk-string convention (see Mesh.cpp/Effect.cpp ChunkView::readString /
 *   readCString). There is NO 4-byte length prefix on disk. This plan's Interfaces section describes
 *   string cells as "length-prefixed ASCII (IFF read_string convention)" — that phrase is INCORRECT;
 *   the real `read_string` convention IS the NUL-terminated scan, not a length prefix. byteLength for
 *   a String cell = bytes actually consumed on read (content length + 1 for the terminator in the
 *   normal case).
 *
 * Physical-decoder scope per D-12/Pitfall-2 (05-RESEARCH.md): only 3 CellType members exist on the
 * wire (CT_string/CT_int/CT_float — DataTableCell.h:28-32); the other 7 DataType enum values
 * (HashString/Bool/Enum/BitVector/PackedObjVars/z-Enum) are UI/type-spec-string layers over an
 * underlying Int or String column — do not build 10 physical decoders. DT_Comment never appears in a
 * compiled .iff (stripped at spreadsheet-compile time, DataTableWriter.cpp:821-856,898-901) —
 * physicalTypeForSpec throws FormatParseError on a leading 'c' (defensive assertion, not a supported
 * path).
 *
 * Byte-offset contract (per-cell, for the Hex-view highlight 05-08 needs — REVIEWS.md MEDIUM):
 *   cell.byteOffset / cell.byteLength are relative to the start of the ROWS chunk's cell-data span —
 *   i.e. offset 0 is the first byte immediately after the `numRows` int32 header field. byteLength is
 *   4 for Int/Float, and (content length + terminator bytes actually consumed) for String.
 *
 * Threat model (T-05-10 / T-05-11, 05-02-PLAN.md):
 *   Every length-prefixed field (numCols, numRows, per-string length) is bounds-checked against the
 *   remaining buffer BEFORE allocating/reading — never trust a length field to be in-bounds. Unknown
 *   or empty type-spec strings throw FormatParseError rather than silently defaulting to a physical
 *   type.
 */
#pragma once

#include <cstdint>
#include <string>
#include <vector>
#include "iff/Iff.h"
#include "Mesh.h"  // FormatParseError

namespace swg_core {
namespace formats {

// ─── DataTable result structs ─────────────────────────────────────────────────

/** The 3 physical wire encodings DTII cells ever use (DataTableCell.h:28-32). */
enum class PhysicalType { Int, Float, String };

/**
 * One column's schema. `typeSpec` is the RAW type-spec string exactly as it appears in the
 * TYPE chunk (e.g. "i", "s[required]", "e(a=0,b=1)[a]") — native does NOT interpret it beyond
 * determining the 3-way physical dispatch (physicalTypeForSpec); semantic interpretation
 * (Enum labels, BitVector bits, HashString CRC, PackedObjVars structure) is a UI/renderer concern.
 */
struct DataTableColumn {
    std::string name;
    std::string typeSpec;
};

/**
 * One physical cell. Exactly one of intValue/floatValue/stringValue is meaningful, selected by
 * `type`. byteOffset/byteLength describe the exact byte span this cell occupies within the ROWS
 * chunk's cell-data span (see byte-offset contract above).
 */
struct DataTableCell {
    PhysicalType type = PhysicalType::Int;
    int32_t      intValue = 0;
    float        floatValue = 0.0f;
    std::string  stringValue;
    uint32_t     byteOffset = 0;
    uint32_t     byteLength = 0;
};

struct DataTableResult {
    std::string formatTag;   // "DTII"
    std::string version;     // "0001" (canonical) or "0000" (legacy, read-only)
    std::vector<DataTableColumn> columns;
    std::vector<std::vector<DataTableCell>> rows;  // rows[r][c], row-major
};

// ─── Public API ────────────────────────────────────────────────────────────────

/**
 * Determine the physical wire type for a column's type-spec string by inspecting only its
 * first non-whitespace character, per the verified dispatch table (DataTableColumnType.cpp:84-232):
 *   'i' -> Int, 'f' -> Float, 's' -> String,
 *   'h'/'b'/'e'/'v'/'z' -> Int (HashString/Bool/Enum/BitVector/table-sourced Enum — all DT_Int basicType),
 *   'p' -> String (PackedObjVars — DT_String basicType).
 * Throws FormatParseError on a leading 'c' (DT_Comment — never appears in a compiled .iff), on an
 * empty/whitespace-only string, or on any other unrecognized character (T-05-11 — never silently
 * default an unknown column to a physical type).
 */
PhysicalType physicalTypeForSpec(const std::string& typeSpec);

/**
 * Parse a FORM DTII (.iff) datatable from an already-parsed IFF tree.
 * Throws FormatParseError on malformed input (missing chunks, out-of-bounds length fields,
 * an unrecognized/Comment type-spec character).
 *
 * Source: DataTable.cpp:400-476 (_readCell, load/load_0000/load_0001).
 */
DataTableResult parseDataTable(const swg_core::iff::IffNode& root,
                                const uint8_t* srcData, uint32_t srcSize);

/**
 * Serialize a DataTableResult back to canonical FORM DTII > FORM 0001 bytes, byte-identical to
 * what a real client compile would produce for the same logical content. Always emits version
 * 0001 (the writer's only output format — DataTableWriter.cpp:650-664) regardless of the version
 * the table was originally parsed from. Ignores per-cell byteOffset/byteLength on input (parse-time
 * diagnostic metadata only) — recomputes the actual output layout independently by writing cells
 * in column-then-row order.
 *
 * Source: DataTableWriter.cpp:650-664 (_saveTableToIff), :821-856 (_saveColumns/_saveTypes),
 *         :860-912 (_saveRows).
 */
std::vector<uint8_t> serializeDataTable(const DataTableResult& table);

} // namespace formats
} // namespace swg_core
