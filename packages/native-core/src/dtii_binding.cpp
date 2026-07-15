/**
 * dtii_binding.cpp — Thin N-API binding for the FORM DTII datatable parser + serializer.
 *
 * Wires parseDataTable()/serializeDataTable() from modules/core/formats/DataTable.h into the
 * N-API addon. This file is a THIN BINDING LAYER ONLY — no parse logic here (Decision D-02).
 *
 * Exports (registered in addon.cpp):
 *   parseDataTable(iffResult: object, srcBytes: ArrayBuffer|Uint8Array) -> DtiiBindingResult
 *   serializeDataTable(table: object) -> ArrayBuffer
 *
 * Return contract:
 *   - Struct/metadata crosses as JS objects (strings, numbers, arrays) — DTII payloads are small
 *     typed cells, not bulk geometry, so no separate binary ArrayBuffer bridge is needed for the
 *     cell values themselves (unlike Mesh's geometry attribute slices).
 *   - Every cell carries its own byteOffset/byteLength (relative to the ROWS chunk's cell-data
 *     span) so a Hex-view consumer (05-08) never needs to re-derive offsets client-side.
 *
 * Source pattern: mesh_binding.cpp (extractBytes + jsToIffNode + two-tier try/catch),
 *                 anim_binding.cpp (standalone-file duplication convention).
 *
 * Decision D-02: No parse logic here; no SOE engine headers.
 */

#include <napi.h>
#include <cstring>
#include <stdexcept>
#include <vector>

#include "iff/Iff.h"
#include "formats/DataTable.h"

// ─── Helpers (duplicated from mesh_binding.cpp to keep this file independent —
//      same convention anim_binding.cpp already follows) ───────────────────────

static std::pair<const uint8_t*, size_t>
extractBytesDtii(const Napi::Value& val, Napi::Env env, const char* argName) {
    if (val.IsArrayBuffer()) {
        auto ab = val.As<Napi::ArrayBuffer>();
        return { static_cast<const uint8_t*>(ab.Data()), ab.ByteLength() };
    }
    if (val.IsTypedArray()) {
        auto ta = val.As<Napi::TypedArray>();
        if (ta.TypedArrayType() == napi_uint8_array) {
            auto u8 = val.As<Napi::Uint8Array>();
            return { u8.Data(), u8.ByteLength() };
        }
    }
    std::string msg = std::string(argName) + " must be an ArrayBuffer or Uint8Array";
    Napi::TypeError::New(env, msg).ThrowAsJavaScriptException();
    return { nullptr, 0 };
}

static swg_core::iff::IffNode jsToIffNodeDtii(const Napi::Object& obj,
                                               const uint8_t* srcBuf, uint32_t srcSize);

static swg_core::iff::IffNode jsToIffNodeDtii(const Napi::Object& obj,
                                               const uint8_t* srcBuf, uint32_t srcSize)
{
    swg_core::iff::IffNode node;

    auto tagStr = obj.Get("tag").As<Napi::String>().Utf8Value();
    std::strncpy(node.tag, tagStr.c_str(), 4);
    node.tag[4] = '\0';

    auto kindStr = obj.Get("kind").As<Napi::String>().Utf8Value();
    node.isForm = (kindStr == "form");
    node.declaredLength = obj.Get("length").As<Napi::Number>().Uint32Value();
    node.byteOffset     = obj.Get("byteOffset").As<Napi::Number>().Uint32Value();
    node.isClean = true;

    uint32_t sliceEnd = node.byteOffset + 8 + node.declaredLength;
    if (srcBuf && sliceEnd <= srcSize) {
        node.capturedSlice.assign(srcBuf + node.byteOffset, srcBuf + sliceEnd);
    }

    if (node.isForm) {
        if (obj.Has("subType")) {
            auto stStr = obj.Get("subType").As<Napi::String>().Utf8Value();
            std::strncpy(node.subType, stStr.c_str(), 4);
            node.subType[4] = '\0';
        }
        if (obj.Has("children") && obj.Get("children").IsArray()) {
            auto arr = obj.Get("children").As<Napi::Array>();
            for (uint32_t i = 0; i < arr.Length(); ++i) {
                auto childVal = arr.Get(i);
                if (childVal.IsObject()) {
                    node.children.push_back(
                        jsToIffNodeDtii(childVal.As<Napi::Object>(), srcBuf, srcSize));
                }
            }
        }
    }
    return node;
}

static swg_core::iff::IffNode extractRootNodeDtii(const Napi::Object& iffResult,
                                                   const uint8_t* srcData, uint32_t srcSize)
{
    if (!iffResult.Has("roots") || !iffResult.Get("roots").IsArray()) {
        throw std::runtime_error("iffResult: missing 'roots' array");
    }
    auto roots = iffResult.Get("roots").As<Napi::Array>();
    if (roots.Length() == 0) {
        throw std::runtime_error("iffResult: 'roots' array is empty");
    }
    auto rv = roots.Get(0u);
    if (!rv.IsObject()) throw std::runtime_error("iffResult: roots[0] is not an object");
    return jsToIffNodeDtii(rv.As<Napi::Object>(), srcData, srcSize);
}

// ─── PhysicalType <-> JS string ────────────────────────────────────────────────

static const char* physicalTypeToJsString(swg_core::formats::PhysicalType t) {
    switch (t) {
        case swg_core::formats::PhysicalType::Int:    return "int";
        case swg_core::formats::PhysicalType::Float:  return "float";
        case swg_core::formats::PhysicalType::String: return "string";
    }
    return "int";
}

static swg_core::formats::PhysicalType physicalTypeFromJsString(const std::string& s) {
    if (s == "int")    return swg_core::formats::PhysicalType::Int;
    if (s == "float")  return swg_core::formats::PhysicalType::Float;
    if (s == "string") return swg_core::formats::PhysicalType::String;
    throw std::runtime_error("serializeDataTable: cell.type must be 'int'|'float'|'string' (got '" + s + "')");
}

// ─── ParseDataTable ────────────────────────────────────────────────────────────

/**
 * parseDataTable(iffResult: object, srcBytes: ArrayBuffer|Uint8Array) -> {
 *   formatTag: string,       // "DTII"
 *   version: string,         // "0001" or "0000"
 *   columns: Array<{ name: string, typeSpec: string }>,
 *   rows: Array<Array<{
 *     type: 'int' | 'float' | 'string',
 *     value: number | string,
 *     byteOffset: number,   // relative to the ROWS chunk's cell-data span
 *     byteLength: number,
 *   }>>,
 * }
 */
Napi::Value ParseDataTable(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 2 || !info[0].IsObject()) {
        Napi::TypeError::New(env, "parseDataTable: (iffResult: object, srcBytes: ArrayBuffer|Uint8Array) required")
            .ThrowAsJavaScriptException();
        return env.Undefined();
    }

    auto [srcData, srcSize] = extractBytesDtii(info[1], env, "parseDataTable srcBytes");
    if (!srcData) return env.Undefined();

    swg_core::iff::IffNode root;
    swg_core::formats::DataTableResult dtResult;

    try {
        root = extractRootNodeDtii(info[0].As<Napi::Object>(), srcData, static_cast<uint32_t>(srcSize));
        dtResult = swg_core::formats::parseDataTable(root, srcData, static_cast<uint32_t>(srcSize));
    } catch (const swg_core::formats::FormatParseError& e) {
        Napi::Error::New(env, std::string("parseDataTable error: ") + e.what())
            .ThrowAsJavaScriptException();
        return env.Undefined();
    } catch (const std::exception& e) {
        Napi::Error::New(env, std::string("parseDataTable internal error: ") + e.what())
            .ThrowAsJavaScriptException();
        return env.Undefined();
    }

    auto result = Napi::Object::New(env);
    result.Set("formatTag", Napi::String::New(env, dtResult.formatTag));
    result.Set("version",   Napi::String::New(env, dtResult.version));

    auto colsArr = Napi::Array::New(env, dtResult.columns.size());
    for (size_t i = 0; i < dtResult.columns.size(); ++i) {
        auto cobj = Napi::Object::New(env);
        cobj.Set("name",     Napi::String::New(env, dtResult.columns[i].name));
        cobj.Set("typeSpec", Napi::String::New(env, dtResult.columns[i].typeSpec));
        colsArr.Set(static_cast<uint32_t>(i), cobj);
    }
    result.Set("columns", colsArr);

    auto rowsArr = Napi::Array::New(env, dtResult.rows.size());
    for (size_t r = 0; r < dtResult.rows.size(); ++r) {
        const auto& row = dtResult.rows[r];
        auto rowArr = Napi::Array::New(env, row.size());
        for (size_t c = 0; c < row.size(); ++c) {
            const auto& cell = row[c];
            auto cellObj = Napi::Object::New(env);
            cellObj.Set("type", Napi::String::New(env, physicalTypeToJsString(cell.type)));
            switch (cell.type) {
                case swg_core::formats::PhysicalType::Int:
                    cellObj.Set("value", Napi::Number::New(env, cell.intValue));
                    break;
                case swg_core::formats::PhysicalType::Float:
                    cellObj.Set("value", Napi::Number::New(env, cell.floatValue));
                    break;
                case swg_core::formats::PhysicalType::String:
                    cellObj.Set("value", Napi::String::New(env, cell.stringValue));
                    break;
            }
            cellObj.Set("byteOffset", Napi::Number::New(env, cell.byteOffset));
            cellObj.Set("byteLength", Napi::Number::New(env, cell.byteLength));
            rowArr.Set(static_cast<uint32_t>(c), cellObj);
        }
        rowsArr.Set(static_cast<uint32_t>(r), rowArr);
    }
    result.Set("rows", rowsArr);

    return result;
}

// ─── SerializeDataTable ────────────────────────────────────────────────────────

/**
 * serializeDataTable(table: { columns, rows }) -> ArrayBuffer
 *
 * Takes the same { columns, rows } shape ParseDataTable returns (byteOffset/byteLength on input
 * cells are ignored — parse-time diagnostic metadata only, not round-tripped). Returns the
 * canonical FORM DTII > FORM 0001 bytes.
 */
Napi::Value SerializeDataTable(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 1 || !info[0].IsObject()) {
        Napi::TypeError::New(env, "serializeDataTable: (table: object) required")
            .ThrowAsJavaScriptException();
        return env.Undefined();
    }

    Napi::Object tableObj = info[0].As<Napi::Object>();
    swg_core::formats::DataTableResult table;
    std::vector<uint8_t> serialized;

    try {
        if (!tableObj.Has("columns") || !tableObj.Get("columns").IsArray())
            throw std::runtime_error("serializeDataTable: table.columns must be an array");
        auto colsArr = tableObj.Get("columns").As<Napi::Array>();
        table.columns.reserve(colsArr.Length());
        for (uint32_t i = 0; i < colsArr.Length(); ++i) {
            auto cv = colsArr.Get(i);
            if (!cv.IsObject()) throw std::runtime_error("serializeDataTable: columns[] entries must be objects");
            auto cobj = cv.As<Napi::Object>();
            swg_core::formats::DataTableColumn col;
            col.name     = cobj.Get("name").As<Napi::String>().Utf8Value();
            col.typeSpec = cobj.Get("typeSpec").As<Napi::String>().Utf8Value();
            table.columns.push_back(std::move(col));
        }

        if (!tableObj.Has("rows") || !tableObj.Get("rows").IsArray())
            throw std::runtime_error("serializeDataTable: table.rows must be an array");
        auto rowsArr = tableObj.Get("rows").As<Napi::Array>();
        table.rows.reserve(rowsArr.Length());
        for (uint32_t r = 0; r < rowsArr.Length(); ++r) {
            auto rv = rowsArr.Get(r);
            if (!rv.IsArray()) throw std::runtime_error("serializeDataTable: rows[] entries must be arrays");
            auto rowArr = rv.As<Napi::Array>();
            std::vector<swg_core::formats::DataTableCell> row;
            row.reserve(rowArr.Length());
            for (uint32_t c = 0; c < rowArr.Length(); ++c) {
                auto cv = rowArr.Get(c);
                if (!cv.IsObject()) throw std::runtime_error("serializeDataTable: row cell entries must be objects");
                auto cellObj = cv.As<Napi::Object>();
                swg_core::formats::DataTableCell cell;
                std::string typeStr = cellObj.Get("type").As<Napi::String>().Utf8Value();
                cell.type = physicalTypeFromJsString(typeStr);
                auto valueVal = cellObj.Get("value");
                switch (cell.type) {
                    case swg_core::formats::PhysicalType::Int:
                        cell.intValue = valueVal.As<Napi::Number>().Int32Value();
                        break;
                    case swg_core::formats::PhysicalType::Float:
                        cell.floatValue = valueVal.As<Napi::Number>().FloatValue();
                        break;
                    case swg_core::formats::PhysicalType::String:
                        cell.stringValue = valueVal.As<Napi::String>().Utf8Value();
                        break;
                }
                // cell.byteOffset/byteLength intentionally left at defaults — input values (if
                // present on the JS object) are parse-time diagnostic metadata only, never
                // consulted by serializeDataTable (it recomputes the real output layout).
                row.push_back(std::move(cell));
            }
            table.rows.push_back(std::move(row));
        }

        serialized = swg_core::formats::serializeDataTable(table);
    } catch (const swg_core::formats::FormatParseError& e) {
        Napi::Error::New(env, std::string("serializeDataTable error: ") + e.what())
            .ThrowAsJavaScriptException();
        return env.Undefined();
    } catch (const std::exception& e) {
        Napi::Error::New(env, std::string("serializeDataTable internal error: ") + e.what())
            .ThrowAsJavaScriptException();
        return env.Undefined();
    }

    auto ab = Napi::ArrayBuffer::New(env, serialized.size());
    if (!serialized.empty()) {
        std::memcpy(ab.Data(), serialized.data(), serialized.size());
    }
    return ab;
}
