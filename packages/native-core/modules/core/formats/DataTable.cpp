/**
 * modules/core/formats/DataTable.cpp — Engine-free C++20 FORM DTII (.iff) datatable parser + serializer.
 *
 * PORT SOURCE:
 *   swg-client-v2 sharedUtility/src/shared/DataTable.cpp:400-476, :480-555 (_readCell, load_0000, load_0001)
 *   swg-client-v2 sharedUtility/src/shared/DataTableWriter.cpp:650-664,723-748,821-912
 *   swg-client-v2 sharedUtility/src/shared/DataTableColumnType.cpp:84-232
 *
 * Decision D-02: C++20, engine-free (no N-API, no SOE engine headers).
 */

#include "DataTable.h"
#include <cctype>
#include <cstring>

namespace swg_core {
namespace formats {

// ─── Chunk/form tree helpers (mirrors Effect.cpp findChunk/findForm exactly) ───

static const swg_core::iff::IffNode* findChunk(
    const swg_core::iff::IffNode& parent, const char* tag4)
{
    for (const auto& child : parent.children) {
        if (!child.isForm && strncmp(child.tag, tag4, 4) == 0)
            return &child;
    }
    return nullptr;
}

// ─── Raw chunk payload view (mirrors Mesh.cpp's ChunkView exactly) ────────────

struct DtiiChunkView {
    const uint8_t* data;
    uint32_t       size;
    uint32_t       pos = 0;

    bool canRead(uint32_t n) const { return pos + n <= size; }
    uint32_t remaining() const { return pos <= size ? size - pos : 0; }

    int32_t readI32LE() {
        if (!canRead(4)) throw FormatParseError("DataTable: unexpected end of chunk data (int32)");
        int32_t v;
        std::memcpy(&v, data + pos, 4);
        pos += 4;
        return v;
    }
    float readF32() {
        if (!canRead(4)) throw FormatParseError("DataTable: unexpected end of chunk data (float32)");
        float v;
        std::memcpy(&v, data + pos, 4);
        pos += 4;
        return v;
    }
    // NUL-terminated ASCII string (Iff::read_string convention — Iff.cpp:1539-1564).
    // Returns the consumed byte count via outConsumed (includes the NUL terminator when one was
    // actually found; if the chunk ends before a terminator, stops at end-of-chunk without a
    // trailing NUL, matching the existing native-core ChunkView::readString precedent).
    std::string readString(uint32_t* outConsumed = nullptr) {
        const uint32_t start = pos;
        std::string s;
        while (pos < size) {
            char c = static_cast<char>(data[pos++]);
            if (c == '\0') break;
            s += c;
        }
        if (outConsumed) *outConsumed = pos - start;
        return s;
    }
};

static DtiiChunkView chunkPayload(const swg_core::iff::IffNode& leaf,
                                   const uint8_t* srcData, uint32_t srcSize)
{
    if (leaf.isForm) throw FormatParseError("DataTable: chunkPayload called on form node");
    const uint32_t payloadStart = leaf.byteOffset + 8;
    const uint32_t payloadLen   = leaf.declaredLength;
    const uint64_t end = static_cast<uint64_t>(leaf.byteOffset) + 8ull + leaf.declaredLength;
    if (end > srcSize)
        throw FormatParseError("DataTable: chunk extends beyond source buffer");
    return { srcData + payloadStart, payloadLen, 0 };
}

// ─── physicalTypeForSpec ───────────────────────────────────────────────────────

PhysicalType physicalTypeForSpec(const std::string& typeSpec)
{
    size_t i = 0;
    while (i < typeSpec.size() && std::isspace(static_cast<unsigned char>(typeSpec[i]))) ++i;
    if (i >= typeSpec.size())
        throw FormatParseError("DataTable: empty type-spec string");

    const char c = static_cast<char>(std::tolower(static_cast<unsigned char>(typeSpec[i])));
    switch (c) {
        case 'i': return PhysicalType::Int;
        case 'f': return PhysicalType::Float;
        case 's': return PhysicalType::String;
        // Semantic DT_Int specializations (DataTableColumnType.cpp:119-193): HashString, Bool,
        // Enum, BitVector, table-sourced Enum (z) — all m_basicType = DT_Int.
        case 'h':
        case 'b':
        case 'e':
        case 'v':
        case 'z':
            return PhysicalType::Int;
        // Semantic DT_String specialization (DataTableColumnType.cpp:124-127): PackedObjVars.
        case 'p':
            return PhysicalType::String;
        case 'c':
            throw FormatParseError(
                "DataTable: DT_Comment column encountered — Comment columns never appear in a "
                "compiled .iff (DataTableWriter.cpp:821-856,898-901 strips them at compile time)");
        default:
            throw FormatParseError(
                std::string("DataTable: unrecognized type-spec character '") + c + "'");
    }
}

// ─── parseDataTable ─────────────────────────────────────────────────────────────

// Legacy FORM 0000 TYPE chunk: numCols * int32 DataType codes (DataTable.cpp:500-535).
// Only DT_Int(0)/DT_Float(1)/DT_String(2) are valid on disk; anything else is client-FATAL.
static std::string legacyTypeCodeToSpec(int32_t code)
{
    switch (code) {
        case 0: return "i"; // DT_Int
        case 1: return "f"; // DT_Float
        case 2: return "s"; // DT_String
        default:
            throw FormatParseError(
                "DataTable: FORM 0000 TYPE chunk contains an unsupported DataType code "
                "(only Int/Float/String are valid in the legacy version, DataTable.cpp:521-533)");
    }
}

DataTableResult parseDataTable(const swg_core::iff::IffNode& root,
                                const uint8_t* srcData, uint32_t srcSize)
{
    DataTableResult result;

    if (!root.isForm || strncmp(root.subType, "DTII", 4) != 0)
        throw FormatParseError("parseDataTable: root is not FORM DTII");
    result.formatTag = "DTII";

    // Find the version form: FORM 0001 (canonical) or legacy FORM 0000.
    const swg_core::iff::IffNode* versionForm = nullptr;
    for (const auto& child : root.children) {
        if (child.isForm &&
            (strncmp(child.subType, "0001", 4) == 0 || strncmp(child.subType, "0000", 4) == 0)) {
            versionForm = &child;
            break;
        }
    }
    if (!versionForm)
        throw FormatParseError("parseDataTable: FORM DTII missing version form (0001/0000)");
    result.version = std::string(versionForm->subType, 4);
    const bool isLegacy0000 = (result.version == "0000");

    const auto* colsNode = findChunk(*versionForm, "COLS");
    const auto* typeNode = findChunk(*versionForm, "TYPE");
    const auto* rowsNode = findChunk(*versionForm, "ROWS");
    if (!colsNode) throw FormatParseError("parseDataTable: missing CHUNK COLS");
    if (!typeNode) throw FormatParseError("parseDataTable: missing CHUNK TYPE");
    if (!rowsNode) throw FormatParseError("parseDataTable: missing CHUNK ROWS");

    // ── CHUNK COLS: int32 numCols, then numCols NUL-terminated name strings ──
    auto colsCv = chunkPayload(*colsNode, srcData, srcSize);
    const int32_t numColsSigned = colsCv.readI32LE();
    if (numColsSigned < 0 || static_cast<uint32_t>(numColsSigned) > colsCv.remaining())
        throw FormatParseError("parseDataTable: COLS numCols out of bounds for remaining chunk bytes");
    const uint32_t numCols = static_cast<uint32_t>(numColsSigned);

    std::vector<std::string> colNames;
    colNames.reserve(numCols);
    for (uint32_t i = 0; i < numCols; ++i) colNames.push_back(colsCv.readString());

    // ── CHUNK TYPE: version-dependent shape ──
    auto typeCv = chunkPayload(*typeNode, srcData, srcSize);
    std::vector<std::string> typeSpecs;
    typeSpecs.reserve(numCols);
    if (isLegacy0000) {
        // int32 DataType codes, bounds-checked before the read loop (T-05-10).
        if (static_cast<uint64_t>(numCols) * 4ull > typeCv.remaining())
            throw FormatParseError("parseDataTable: legacy TYPE chunk too short for declared numCols");
        for (uint32_t i = 0; i < numCols; ++i)
            typeSpecs.push_back(legacyTypeCodeToSpec(typeCv.readI32LE()));
    } else {
        for (uint32_t i = 0; i < numCols; ++i) typeSpecs.push_back(typeCv.readString());
    }

    result.columns.reserve(numCols);
    for (uint32_t i = 0; i < numCols; ++i) {
        // Validate dispatch eagerly — throws FormatParseError on 'c' or an unrecognized char.
        (void)physicalTypeForSpec(typeSpecs[i]);
        DataTableColumn col;
        col.name = colNames[i];
        col.typeSpec = typeSpecs[i];
        result.columns.push_back(std::move(col));
    }

    // ── CHUNK ROWS: int32 numRows, then numRows*numCols cells ──
    auto rowsCv = chunkPayload(*rowsNode, srcData, srcSize);
    const int32_t numRowsSigned = rowsCv.readI32LE();

    // Bounds-check numRows against remaining bytes BEFORE reserving/reading (T-05-10) — compute
    // the minimum possible bytes a single row can occupy (4 for Int/Float, 1 for an empty
    // NUL-terminated String) and reject a numRows that could not possibly fit.
    uint32_t minRowBytes = 0;
    for (const auto& col : result.columns)
        minRowBytes += (physicalTypeForSpec(col.typeSpec) == PhysicalType::String) ? 1u : 4u;
    if (minRowBytes == 0) minRowBytes = 1; // guard a 0-column table

    if (numRowsSigned < 0 ||
        (static_cast<uint64_t>(numRowsSigned) * static_cast<uint64_t>(minRowBytes)) > rowsCv.remaining())
        throw FormatParseError("parseDataTable: ROWS numRows out of bounds for remaining chunk bytes");
    const uint32_t numRows = static_cast<uint32_t>(numRowsSigned);

    result.rows.reserve(numRows);
    uint32_t cursor = 0; // relative to the first byte after the numRows field (byte-offset contract)
    for (uint32_t r = 0; r < numRows; ++r) {
        std::vector<DataTableCell> row;
        row.reserve(numCols);
        for (uint32_t c = 0; c < numCols; ++c) {
            const PhysicalType pt = physicalTypeForSpec(result.columns[c].typeSpec);
            DataTableCell cell;
            cell.type = pt;
            cell.byteOffset = cursor;

            switch (pt) {
                case PhysicalType::Int:
                    cell.intValue = rowsCv.readI32LE();
                    cell.byteLength = 4;
                    break;
                case PhysicalType::Float:
                    cell.floatValue = rowsCv.readF32();
                    cell.byteLength = 4;
                    break;
                case PhysicalType::String: {
                    uint32_t consumed = 0;
                    cell.stringValue = rowsCv.readString(&consumed);
                    cell.byteLength = consumed;
                    break;
                }
            }

            cursor += cell.byteLength;
            row.push_back(std::move(cell));
        }
        result.rows.push_back(std::move(row));
    }

    return result;
}

// ─── serializeDataTable ─────────────────────────────────────────────────────────

// Big-endian 32-bit write — mirrors Iff.cpp's writeBe32 convention exactly
// (structural FORM/chunk tags + lengths are always big-endian).
static void writeBe32(std::vector<uint8_t>& out, uint32_t v)
{
    out.push_back(static_cast<uint8_t>((v >> 24) & 0xFF));
    out.push_back(static_cast<uint8_t>((v >> 16) & 0xFF));
    out.push_back(static_cast<uint8_t>((v >> 8) & 0xFF));
    out.push_back(static_cast<uint8_t>(v & 0xFF));
}

// Little-endian 32-bit write — DTII chunk PAYLOAD fields (numCols/numRows/int cells/float bits)
// are raw memcpy on LE Windows, same convention as every other native-core format's DATA payload.
static void writeLE32(std::vector<uint8_t>& out, uint32_t v)
{
    out.push_back(static_cast<uint8_t>(v & 0xFF));
    out.push_back(static_cast<uint8_t>((v >> 8) & 0xFF));
    out.push_back(static_cast<uint8_t>((v >> 16) & 0xFF));
    out.push_back(static_cast<uint8_t>((v >> 24) & 0xFF));
}

static void writeCString(std::vector<uint8_t>& out, const std::string& s)
{
    out.insert(out.end(), s.begin(), s.end());
    out.push_back(0);
}

static uint32_t tagBytes(const char* tag4)
{
    return (static_cast<uint32_t>(static_cast<uint8_t>(tag4[0])) << 24) |
           (static_cast<uint32_t>(static_cast<uint8_t>(tag4[1])) << 16) |
           (static_cast<uint32_t>(static_cast<uint8_t>(tag4[2])) << 8) |
            static_cast<uint32_t>(static_cast<uint8_t>(tag4[3]));
}

// Append a leaf chunk: tag(4, BE) + length(4, BE) + payload. No pad byte (IffWriter.cs:141 /
// Iff.cpp write convention — every existing native-core serializer follows this).
static void appendLeafChunk(std::vector<uint8_t>& out, const char* tag4,
                             const std::vector<uint8_t>& payload)
{
    writeBe32(out, tagBytes(tag4));
    writeBe32(out, static_cast<uint32_t>(payload.size()));
    out.insert(out.end(), payload.begin(), payload.end());
}

// Append a FORM: 'FORM'(4,BE) + innerLen(4,BE) + subType(4,BE) + childBytes.
// innerLen = 4 (subType) + childBytes.size() — Iff.cpp:643 convention (innerLen includes the
// 4-byte subtype), matching Iff.cpp's serializeNode exactly.
static void appendForm(std::vector<uint8_t>& out, const char* subType4,
                        const std::vector<uint8_t>& childBytes)
{
    const uint32_t innerLen = static_cast<uint32_t>(4 + childBytes.size());
    writeBe32(out, tagBytes("FORM"));
    writeBe32(out, innerLen);
    writeBe32(out, tagBytes(subType4));
    out.insert(out.end(), childBytes.begin(), childBytes.end());
}

std::vector<uint8_t> serializeDataTable(const DataTableResult& table)
{
    const uint32_t numCols = static_cast<uint32_t>(table.columns.size());

    // ── CHUNK COLS payload: int32 numCols + numCols NUL-terminated names ──
    std::vector<uint8_t> colsPayload;
    writeLE32(colsPayload, numCols);
    for (const auto& col : table.columns) writeCString(colsPayload, col.name);

    // ── CHUNK TYPE payload: numCols NUL-terminated type-spec strings ──
    std::vector<uint8_t> typePayload;
    for (const auto& col : table.columns) writeCString(typePayload, col.typeSpec);

    // ── CHUNK ROWS payload: int32 numRows + numRows*numCols physical cells ──
    std::vector<uint8_t> rowsPayload;
    writeLE32(rowsPayload, static_cast<uint32_t>(table.rows.size()));
    for (const auto& row : table.rows) {
        for (uint32_t c = 0; c < numCols; ++c) {
            const DataTableCell& cell = row[c];
            const PhysicalType pt = physicalTypeForSpec(table.columns[c].typeSpec);
            switch (pt) {
                case PhysicalType::Int:
                    writeLE32(rowsPayload, static_cast<uint32_t>(cell.intValue));
                    break;
                case PhysicalType::Float: {
                    uint32_t bits;
                    std::memcpy(&bits, &cell.floatValue, 4);
                    writeLE32(rowsPayload, bits);
                    break;
                }
                case PhysicalType::String:
                    writeCString(rowsPayload, cell.stringValue);
                    break;
            }
        }
    }

    // ── Assemble FORM 0001 { CHUNK COLS, CHUNK TYPE, CHUNK ROWS } ──
    std::vector<uint8_t> form0001Body;
    appendLeafChunk(form0001Body, "COLS", colsPayload);
    appendLeafChunk(form0001Body, "TYPE", typePayload);
    appendLeafChunk(form0001Body, "ROWS", rowsPayload);

    std::vector<uint8_t> form0001Bytes;
    appendForm(form0001Bytes, "0001", form0001Body);

    // ── Assemble FORM DTII { FORM 0001 } ──
    std::vector<uint8_t> out;
    appendForm(out, "DTII", form0001Bytes);
    return out;
}

} // namespace formats
} // namespace swg_core
