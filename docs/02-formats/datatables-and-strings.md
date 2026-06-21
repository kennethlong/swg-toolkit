# Datatables (DTII) and String Tables (.stf)

> Covers: datatables (DTII .iff), string tables (.stf), query engine, DPS charting. Source: research doc lines 6711–6947, 6954–7344, 8160–8546.

> **Provenance caveat:** DTII/.stf chunk layouts, field sizes, CRC polynomial, and TOC descriptor widths are AI-proposed reconstructions. Validate every detail against real `swg-client-v2` source and the Core3 server before relying on them in production. See [source provenance](../00-overview/source-provenance.md).

---

## Overview

SWG separates relational game data from localized text into two distinct binary formats:

- **Datatables (DTII .iff)** — flat binary spreadsheets embedded inside `.iff` containers. Found under `datatables/` in the client `.tre` archives. Used for item profiles, crafting recipes, weapon stats, profession abilities, etc. Columns are typed (`s`/`i`/`f`); rows are a flat little-endian byte stream laid out by the COLS schema.
- **String tables (.stf)** — locale-specific binary files that map CRC32-hashed key identifiers to UTF-16 localized text strings. The client resolves every UI label, dialog line, ability name, and item description through `.stf` lookups keyed by a 32-bit CRC of the identifier (e.g., `item_n:heavy_blaster`).

For generic IFF container reading/writing, see [../01-core-engine/iff-and-tre.md](../01-core-engine/iff-and-tre.md) — only DTII/.stf-specific logic is shown here. For client↔server datatable parity, see [../05-server-integration/core3-parity.md](../05-server-integration/core3-parity.md).

---

## Part 1: Datatables (DTII .iff)

### 1.1 DTII Block Structure

A datatable is an IFF container with a `FORM` tag of type `DTII`. It contains three sequential chunks:

| Chunk | Contents |
|-------|----------|
| `COLS` | `uint32` column count, then alternating null-terminated pairs of column name and type descriptor (`s` = string, `i` = integer, `f` = float) |
| `ROWS` | `uint32` row count |
| `DATA` | Flat little-endian binary stream; layout determined entirely by the column schema order from `COLS` |

### 1.2 C++ Data Models

```cpp
#include <napi.h>
#include <string>
#include <vector>
#include <variant>
#include <cstring>

enum class SwgDbDataType { String, Integer, Float };

struct SwgColumnHeader {
    std::string name;
    SwgDbDataType type;
};

struct SwgDatatableGrid {
    std::vector<SwgColumnHeader> columns;
    uint32_t rowCount = 0;

    // Flat column-oriented storage lists to align with WebGL/JS TypedArray handoffs
    std::vector<int32_t> integerDataCells;
    std::vector<float>   floatDataCells;
    std::vector<std::string> stringDataCells;

    // Maps each (row, col) coordinate to its index in the appropriate typed array
    std::vector<uint32_t> cellDataIndexPointers;
};
```

### 1.3 Binary DTII Parser (C++)

```cpp
class SwgDatatableParser {
public:
    static SwgDatatableGrid ParseDatatableForm(const uint8_t* data, size_t& offset) {
        SwgDatatableGrid table;

        std::string formTag  = TrnBinaryParser::Read4CharTag(data, offset); // FORM
        uint32_t    formSize = TrnBinaryParser::ReadUint32LE(data, offset);
        std::string subType  = TrnBinaryParser::Read4CharTag(data, offset); // "DTII"

        size_t endOffset = offset + formSize - 4;

        while (offset < endOffset) {
            std::string chunkTag  = TrnBinaryParser::Read4CharTag(data, offset);
            uint32_t    chunkSize = TrnBinaryParser::ReadUint32LE(data, offset);
            size_t nextChunkMarker = offset + chunkSize;

            if (chunkTag == "COLS") {
                uint32_t colCount = TrnBinaryParser::ReadUint32LE(data, offset);
                table.columns.reserve(colCount);

                for (uint32_t i = 0; i < colCount; ++i) {
                    std::string colName(reinterpret_cast<const char*>(data + offset));
                    offset += colName.length() + 1;

                    std::string colType(reinterpret_cast<const char*>(data + offset));
                    offset += colType.length() + 1;

                    SwgDbDataType dType = SwgDbDataType::String;
                    if (colType == "i") dType = SwgDbDataType::Integer;
                    if (colType == "f") dType = SwgDbDataType::Float;

                    table.columns.push_back({colName, dType});
                }
            }
            else if (chunkTag == "ROWS") {
                table.rowCount = TrnBinaryParser::ReadUint32LE(data, offset);
                table.cellDataIndexPointers.reserve(table.rowCount * table.columns.size());
            }
            else if (chunkTag == "DATA") {
                // Read rows sequentially using the parsed column type schema
                for (uint32_t r = 0; r < table.rowCount; ++r) {
                    for (const auto& col : table.columns) {
                        if (col.type == SwgDbDataType::Integer) {
                            int32_t val = static_cast<int32_t>(TrnBinaryParser::ReadUint32LE(data, offset));
                            table.cellDataIndexPointers.push_back(static_cast<uint32_t>(table.integerDataCells.size()));
                            table.integerDataCells.push_back(val);
                        }
                        else if (col.type == SwgDbDataType::Float) {
                            float val = TrnBinaryParser::ReadFloatLE(data, offset);
                            table.cellDataIndexPointers.push_back(static_cast<uint32_t>(table.floatDataCells.size()));
                            table.floatDataCells.push_back(val);
                        }
                        else if (col.type == SwgDbDataType::String) {
                            std::string val(reinterpret_cast<const char*>(data + offset));
                            offset += val.length() + 1;
                            table.cellDataIndexPointers.push_back(static_cast<uint32_t>(table.stringDataCells.size()));
                            table.stringDataCells.push_back(val);
                        }
                    }
                }
            }
            offset = nextChunkMarker;
        }
        return table;
    }
};
```

### 1.4 N-API Serialization: Fast Buffer Transfer

Numeric columns cross the N-API bridge as raw `Int32Array`/`Float32Array` buffers via `memcpy` — avoiding per-element boxing overhead and keeping the V8 thread unblocked for large datatables (e.g., `object_template_weapon.iff`).

```cpp
Napi::Value UnpackDatatableToJs(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    Napi::ArrayBuffer inputBuffer = info.As<Napi::ArrayBuffer>();

    const uint8_t* rawData = static_cast<const uint8_t*>(inputBuffer.Data());
    size_t offset = 0;

    SwgDatatableGrid table = SwgDatatableParser::ParseDatatableForm(rawData, offset);

    Napi::Object resultContainer = Napi::Object::New(env);
    resultContainer.Set("rowCount", Napi::Number::New(env, table.rowCount));

    // 1. Pack column schema headers
    Napi::Array jsHeaders = Napi::Array::New(env, table.columns.size());
    for (size_t i = 0; i < table.columns.size(); ++i) {
        Napi::Object colObj = Napi::Object::New(env);
        colObj.Set("name", Napi::String::New(env, table.columns[i].name));
        colObj.Set("type", Napi::Number::New(env, static_cast<int>(table.columns[i].type)));
        jsHeaders[i] = colObj;
    }
    resultContainer.Set("columns", jsHeaders);

    // 2. Pack flat numeric buffers
    Napi::Int32Array jsIntBuffer = Napi::Int32Array::New(env, table.integerDataCells.size());
    std::memcpy(jsIntBuffer.Data(), table.integerDataCells.data(), table.integerDataCells.size() * sizeof(int32_t));
    resultContainer.Set("intCells", jsIntBuffer);

    Napi::Float32Array jsFloatBuffer = Napi::Float32Array::New(env, table.floatDataCells.size());
    std::memcpy(jsFloatBuffer.Data(), table.floatDataCells.data(), table.floatDataCells.size() * sizeof(float));
    resultContainer.Set("floatCells", jsFloatBuffer);

    // 3. Pack string array
    Napi::Array jsStringArray = Napi::Array::New(env, table.stringDataCells.size());
    for (size_t i = 0; i < table.stringDataCells.size(); ++i) {
        jsStringArray[i] = Napi::String::New(env, table.stringDataCells[i]);
    }
    resultContainer.Set("stringCells", jsStringArray);

    // 4. Pack matrix index pointer coordinates
    Napi::Uint32Array jsIndexMap = Napi::Uint32Array::New(env, table.cellDataIndexPointers.size());
    std::memcpy(jsIndexMap.Data(), table.cellDataIndexPointers.data(), table.cellDataIndexPointers.size() * sizeof(uint32_t));
    resultContainer.Set("indexMap", jsIndexMap);

    return resultContainer;
}
```

### 1.5 TypeScript Spreadsheet Access Model

```typescript
export class SwgVirtualSpreadsheet {
  constructor(private rawData: any) {}

  get rowCount(): number { return this.rawData.rowCount; }
  get columns(): { name: string; type: number }[] { return this.rawData.columns; }

  /**
   * Resolves a cell value at a given row and column index directly from the binary data blocks.
   * type enum: 0 = String, 1 = Integer, 2 = Float
   */
  public getCellValue(rowIndex: number, colIndex: number): string | number {
    const colCount  = this.columns.length;
    const mapIndex  = (rowIndex * colCount) + colIndex;
    const dataPointer = this.rawData.indexMap[mapIndex];
    const columnType  = this.columns[colIndex].type;

    switch (columnType) {
      case 1: return this.rawData.intCells[dataPointer];
      case 2: return this.rawData.floatCells[dataPointer];
      case 0:
      default: return this.rawData.stringCells[dataPointer];
    }
  }
}
```

### 1.6 Virtualized Database Grid Panel (React)

Uses `react-window` `FixedSizeList` so that spreadsheets with 50,000+ rows render at 60 fps — only visible rows are mounted in the DOM.

```tsx
import React, { useMemo } from 'react';
import { FixedSizeList as List } from 'react-window';
import { SwgVirtualSpreadsheet } from './SpreadsheetModel';

export const SwgDatabaseGridPanel: React.FC<{ rawNapiTableData: any }> = ({ rawNapiTableData }) => {
  const sheet = useMemo(() => new SwgVirtualSpreadsheet(rawNapiTableData), [rawNapiTableData]);

  const RowComponent = ({ index, style }: { index: number; style: React.CSSProperties }) => {
    return (
      <div style={{ ...style, display: 'flex', borderBottom: '1px solid #2a2a2a', alignItems: 'center', background: index % 2 === 0 ? '#1e1e1e' : '#151515' }}>
        <div style={{ width: '60px', color: '#ff0055', paddingLeft: '8px', fontSize: '11px' }}>#{index}</div>
        {sheet.columns.map((col, colIdx) => (
          <div key={col.name} style={{ flex: 1, padding: '0 8px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#e0e0e0', fontSize: '12px' }}>
            {sheet.getCellValue(index, colIdx)}
          </div>
        ))}
      </div>
    );
  };

  return (
    <div style={{ background: '#111', borderRadius: '4px', border: '1px solid #333', padding: '12px', fontFamily: 'monospace' }}>
      <h3 style={{ color: '#00ffcc', margin: '0 0 12px 0' }}>Client Relational Datatable Inspector (.IFF / DTII)</h3>

      {/* Header row */}
      <div style={{ display: 'flex', background: '#252526', borderBottom: '2px solid #ff0055', fontWeight: 'bold', color: '#00ffcc', padding: '6px 0' }}>
        <div style={{ width: '60px', paddingLeft: '8px' }}>ROW</div>
        {sheet.columns.map(col => (
          <div key={col.name} style={{ flex: 1, padding: '0 8px', fontSize: '11px' }}>{col.name.toUpperCase()}</div>
        ))}
      </div>

      {/* Virtualized scroll canvas */}
      <List
        height={450}
        itemCount={sheet.rowCount}
        itemSize={28}
        width="100%"
      >
        {RowComponent}
      </List>
    </div>
  );
};
```

---

## Part 2: Weapon DTII Query Engine

Filtering large datasets inside JavaScript is slow. Instead, filtering, conditional logic, and range queries run natively in C++ against the flat parsed columns, and only the matching result set is returned to the React UI.

### 2.1 C++ Query Structures

```cpp
#include <napi.h>
#include <string>
#include <vector>
#include <unordered_map>

enum class QueryOp { Equals, Contains, GreaterThan, LessThan };

struct ColumnQueryFilter {
    std::string columnName;
    QueryOp     operation;
    std::string stringValue;
    float       numericValue = 0.0f;
};

struct WeaponMetricRow {
    std::string templateName;
    int32_t     minDamage;
    int32_t     maxDamage;
    float       attackSpeed;
    float       attackRange;
    int32_t     damageType;
};
```

### 2.2 Native Query Engine (C++)

Cache-friendly linear sweep over `cellDataIndexPointers` with early-out on first failing filter.

```cpp
class SwgDatatableQueryEngine {
public:
    static std::vector<WeaponMetricRow> QueryWeaponMetrics(
        const SwgDatatableGrid& table,
        const std::vector<ColumnQueryFilter>& filters
    ) {
        std::vector<WeaponMetricRow> matchedRows;
        size_t colCount = table.columns.size();

        // Build a quick lookup map of column names to index slots
        std::unordered_map<std::string, size_t> colIndexMap;
        for (size_t i = 0; i < colCount; ++i) {
            colIndexMap[table.columns[i].name] = i;
        }

        // Identify key weapon columns
        size_t nameCol   = colIndexMap.count("template_name") ? colIndexMap["template_name"] : 0;
        size_t minDamCol = colIndexMap.count("min_damage")    ? colIndexMap["min_damage"]    : 0;
        size_t maxDamCol = colIndexMap.count("max_damage")    ? colIndexMap["max_damage"]    : 0;
        size_t speedCol  = colIndexMap.count("attack_speed")  ? colIndexMap["attack_speed"]  : 0;
        size_t rangeCol  = colIndexMap.count("max_range")     ? colIndexMap["max_range"]     : 0;
        size_t typeCol   = colIndexMap.count("damage_type")   ? colIndexMap["damage_type"]   : 0;

        for (uint32_t r = 0; r < table.rowCount; ++r) {
            bool rowPassesFilters = true;

            for (const auto& filter : filters) {
                if (!colIndexMap.count(filter.columnName)) continue;

                size_t   colIdx  = colIndexMap[filter.columnName];
                size_t   mapIdx  = (r * colCount) + colIdx;
                uint32_t dataPtr = table.cellDataIndexPointers[mapIdx];
                SwgDbDataType colType = table.columns[colIdx].type;

                if (colType == SwgDbDataType::Integer) {
                    int32_t cellVal = table.integerDataCells[dataPtr];
                    if (filter.operation == QueryOp::GreaterThan && !(cellVal > filter.numericValue)) rowPassesFilters = false;
                    if (filter.operation == QueryOp::LessThan    && !(cellVal < filter.numericValue)) rowPassesFilters = false;
                    if (filter.operation == QueryOp::Equals      && !(cellVal == static_cast<int32_t>(filter.numericValue))) rowPassesFilters = false;
                }
                else if (colType == SwgDbDataType::Float) {
                    float cellVal = table.floatDataCells[dataPtr];
                    if (filter.operation == QueryOp::GreaterThan && !(cellVal > filter.numericValue)) rowPassesFilters = false;
                    if (filter.operation == QueryOp::LessThan    && !(cellVal < filter.numericValue)) rowPassesFilters = false;
                }
                else if (colType == SwgDbDataType::String) {
                    const std::string& cellVal = table.stringDataCells[dataPtr];
                    if (filter.operation == QueryOp::Contains && cellVal.find(filter.stringValue) == std::string::npos) rowPassesFilters = false;
                    if (filter.operation == QueryOp::Equals   && cellVal != filter.stringValue) rowPassesFilters = false;
                }

                if (!rowPassesFilters) break; // Early out on first failure
            }

            if (rowPassesFilters) {
                WeaponMetricRow weapon;
                weapon.templateName = table.stringDataCells [table.cellDataIndexPointers[(r * colCount) + nameCol]];
                weapon.minDamage    = table.integerDataCells[table.cellDataIndexPointers[(r * colCount) + minDamCol]];
                weapon.maxDamage    = table.integerDataCells[table.cellDataIndexPointers[(r * colCount) + maxDamCol]];
                weapon.attackSpeed  = table.floatDataCells  [table.cellDataIndexPointers[(r * colCount) + speedCol]];
                weapon.attackRange  = table.floatDataCells  [table.cellDataIndexPointers[(r * colCount) + rangeCol]];
                weapon.damageType   = table.integerDataCells[table.cellDataIndexPointers[(r * colCount) + typeCol]];
                matchedRows.push_back(weapon);
            }
        }

        return matchedRows;
    }
};
```

### 2.3 N-API Query Bridge (C++)

Operation enum mapping (matches the JS side): `0=Equals, 1=Contains, 2=GreaterThan, 3=LessThan`.

```cpp
Napi::Value QueryWeaponTableMetrics(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    Napi::Object jsQueryObj = info.As<Napi::Object>();
    Napi::Array  jsFilters  = jsQueryObj.Get("filters").As<Napi::Array>();

    std::vector<ColumnQueryFilter> nativeFilters;
    for (uint32_t i = 0; i < jsFilters.Length(); ++i) {
        Napi::Object fObj = jsFilters.Get(i).As<Napi::Object>();
        ColumnQueryFilter filter;
        filter.columnName = fObj.Get("column").As<Napi::String>().Utf8Value();
        filter.operation  = static_cast<QueryOp>(fObj.Get("op").As<Napi::Number>().Uint32Value());

        if (fObj.Has("stringValue"))  filter.stringValue  = fObj.Get("stringValue").As<Napi::String>().Utf8Value();
        if (fObj.Has("numericValue")) filter.numericValue = fObj.Get("numericValue").As<Napi::Number>().FloatValue();

        nativeFilters.push_back(filter);
    }

    SwgDatatableGrid activeTable = GetActiveLoadedDatatable();
    auto results = SwgDatatableQueryEngine::QueryWeaponMetrics(activeTable, nativeFilters);

    Napi::Array jsResultsArray = Napi::Array::New(env, results.size());
    for (size_t i = 0; i < results.size(); ++i) {
        Napi::Object wObj = Napi::Object::New(env);
        wObj.Set("templateName", Napi::String::New(env, results[i].templateName));
        wObj.Set("minDamage",    Napi::Number::New(env, results[i].minDamage));
        wObj.Set("maxDamage",    Napi::Number::New(env, results[i].maxDamage));
        wObj.Set("attackSpeed",  Napi::Number::New(env, results[i].attackSpeed));
        wObj.Set("attackRange",  Napi::Number::New(env, results[i].attackRange));
        wObj.Set("damageType",   Napi::Number::New(env, results[i].damageType));
        jsResultsArray[i] = wObj;
    }

    return jsResultsArray;
}
```

### 2.4 Weapon Filter Dashboard (React)

```tsx
import React, { useState } from 'react';

interface WeaponMetric {
  templateName: string;
  minDamage:    number;
  maxDamage:    number;
  attackSpeed:  number;
  attackRange:  number;
  damageType:   number;
}

export const SwgWeaponQueryPanel: React.FC<{ nativeBridge: any }> = ({ nativeBridge }) => {
  const [minDamageFilter, setMinDamageFilter] = useState(250);
  const [textSearch,      setTextSearch]      = useState('lightsaber');
  const [queriedMetrics,  setQueriedMetrics]  = useState<WeaponMetric[]>([]);

  const handleExecuteWeaponQuery = async () => {
    // Operation mappings: 0=Equals, 1=Contains, 2=GreaterThan, 3=LessThan
    const queryPayload = {
      filters: [
        { column: 'template_name', op: 1, stringValue:  textSearch },
        { column: 'min_damage',    op: 2, numericValue: minDamageFilter }
      ]
    };
    const filteredResults: WeaponMetric[] = await nativeBridge.queryWeaponTableMetrics(queryPayload);
    setQueriedMetrics(filteredResults);
  };

  return (
    <div style={{ background: '#252526', padding: '14px', borderRadius: '4px', color: '#fff', fontFamily: 'monospace' }}>
      <h4 style={{ color: '#00ffcc', margin: '0 0 12px 0' }}>Weapon Balance Template Auditor</h4>

      <div style={{ display: 'grid', gap: '8px', marginBottom: '12px', fontSize: '12px' }}>
        <label>
          Filter Path Name Contains:
          <input
            type="text"
            value={textSearch}
            onChange={(e) => setTextSearch(e.target.value)}
            style={{ width: '100%', background: '#111', color: '#fff', border: '1px solid #555', padding: '4px' }}
          />
        </label>

        <label>
          Minimum Target Base Damage ({minDamageFilter} DMG):
          <input
            type="range" min="0" max="1000" step="25"
            value={minDamageFilter}
            onChange={(e) => setMinDamageFilter(parseInt(e.target.value))}
            style={{ width: '100%', accentColor: '#00ffcc' }}
          />
        </label>

        <button
          onClick={handleExecuteWeaponQuery}
          style={{ background: '#00ffcc', color: '#111', fontWeight: 'bold', border: 'none', padding: '8px', cursor: 'pointer', borderRadius: '2px' }}
        >
          Run Complex Matrix Query
        </button>
      </div>

      <div style={{ maxHeight: '200px', overflowY: 'auto', background: '#111', padding: '6px', fontSize: '11px', border: '1px solid #333' }}>
        {queriedMetrics.map((wpn, i) => (
          <div key={i} style={{ borderBottom: '1px solid #222', padding: '4px 0', color: '#aaa' }}>
            <span style={{ color: '#fff', fontWeight: 'bold' }}>{wpn.templateName.split('/').pop()}</span>
            <div style={{ color: '#888', paddingLeft: '14px' }}>
              Damage: <span style={{ color: '#ff0055' }}>{wpn.minDamage}-{wpn.maxDamage}</span> |{' '}
              Speed: <span style={{ color: '#00ffcc' }}>{wpn.attackSpeed}s</span> |{' '}
              Range: <span>{wpn.attackRange}m</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
```

---

## Part 3: DPS Charting

Uses **Recharts** (`npm install recharts`) to render weapon balance curves directly from query results, without exporting to external spreadsheets.

The DPS formula: `DPS = (minDamage + maxDamage) / (2 × attackSpeed)`

### 3.1 Analytical Data Conversion (TypeScript)

```typescript
export interface WeaponMetric {
  templateName: string;
  minDamage:    number;
  maxDamage:    number;
  attackSpeed:  number;
  attackRange:  number;
  damageType:   number;
}

export interface ChartCoordinates {
  weaponLabel: string;
  baseDps:     number; // Sustained: (min+max)/2 / speed
  burstDps:    number; // Ceiling:   max / speed
  speed:       number;
}

/**
 * Maps raw backend item rows into clean coordinates for the graphing canvas.
 * Sorted highest baseDps first.
 */
export function processWeaponDpsPayload(metrics: WeaponMetric[]): ChartCoordinates[] {
  return metrics.map((item) => {
    const cleanLabel = item.templateName.split('/').pop()?.replace('.iff', '') || 'Unknown Weapon';

    // Core SWG DPS equation: (Min + Max) / 2 / Speed
    const averageDamage    = (item.minDamage + item.maxDamage) / 2.0;
    const computedBaseDps  = item.attackSpeed > 0 ? (averageDamage / item.attackSpeed) : 0;

    // Burst ceiling: Max / Speed
    const computedBurstDps = item.attackSpeed > 0 ? (item.maxDamage / item.attackSpeed) : 0;

    return {
      weaponLabel: cleanLabel,
      baseDps:     parseFloat(computedBaseDps.toFixed(1)),
      burstDps:    parseFloat(computedBurstDps.toFixed(1)),
      speed:       item.attackSpeed
    };
  }).sort((a, b) => b.baseDps - a.baseDps);
}
```

### 3.2 Interactive DPS Curve Graph (React)

```tsx
import React, { useMemo } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer
} from 'recharts';
import { processWeaponDpsPayload, WeaponMetric } from './DpsUtils';

interface VisualizerProps {
  weaponDataset: WeaponMetric[];
}

export const SwgWeaponDpsVisualizer: React.FC<VisualizerProps> = ({ weaponDataset }) => {
  const chartData = useMemo(() => processWeaponDpsPayload(weaponDataset), [weaponDataset]);

  if (chartData.length === 0) {
    return (
      <div style={{ height: '300px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#1e1e1e', border: '1px dashed #444', borderRadius: '4px', color: '#666', fontSize: '12px' }}>
        No items loaded. Run an inspector search to map weapon DPS metrics curves.
      </div>
    );
  }

  return (
    <div style={{ background: '#1e1e1e', border: '1px solid #3c3c3c', borderRadius: '4px', padding: '16px', marginTop: '14px' }}>
      <h4 style={{ color: '#00ffcc', margin: '0 0 4px 0', fontFamily: 'monospace' }}>Automated Sustained DPS Comparison Grid</h4>
      <p style={{ fontSize: '11px', color: '#888', margin: '0 0 16px 0', fontFamily: 'monospace' }}>
        Calculates DPS = (Min+Max) / (2 * Speed) dynamically across imported datatable templates.
      </p>

      <div style={{ width: '100%', height: 320, fontFamily: 'monospace', fontSize: '11px' }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={chartData}
            margin={{ top: 10, right: 10, left: -20, bottom: 20 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#2d2d2d" />
            <XAxis
              dataKey="weaponLabel"
              stroke="#888"
              angle={-25}
              textAnchor="end"
              interval={0}
              height={50}
            />
            <YAxis
              stroke="#888"
              label={{ value: 'Sustained Damage / Sec', angle: -90, position: 'insideLeft', offset: 10, fill: '#888' }}
            />
            <Tooltip
              contentStyle={{ background: '#111', border: '1px solid #ff0055', borderRadius: '2px', color: '#fff' }}
              itemStyle={{ color: '#00ffcc' }}
            />
            <Legend wrapperStyle={{ paddingTop: '10px' }} />
            <Bar dataKey="baseDps"  name="Sustained Base DPS" fill="#00ffcc" radius={[2, 2, 0, 0]} />
            <Bar dataKey="burstDps" name="Peak Burst Cap"      fill="#ff0055" radius={[2, 2, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};
```

### 3.3 Complete Balancing Canvas (React)

Links the query panel and the DPS visualizer into a single split-view dashboard. Modifying weapon constraints and re-running the query recalculates and redraws the chart immediately.

```tsx
import React, { useState } from 'react';
import { SwgWeaponQueryPanel }    from './SwgWeaponQueryPanel';
import { SwgWeaponDpsVisualizer } from './SwgWeaponDpsVisualizer';

export const SwgItemBalancingDashboard: React.FC<{ nativeBridge: any }> = ({ nativeBridge }) => {
  const [activeMetrics, setActiveMetrics] = useState<WeaponMetric[]>([]);

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: '16px', padding: '16px', background: '#111', height: '100vh' }}>

      {/* Left sidebar: query filters and result list */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <SwgWeaponQueryPanel
          nativeBridge={nativeBridge}
          onQueryComplete={(results) => setActiveMetrics(results)}
        />
      </div>

      {/* Right canvas: DPS chart + virtualized spreadsheet */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', overflowY: 'auto' }}>
        <SwgWeaponDpsVisualizer weaponDataset={activeMetrics} />
        {/* Render SwgDatabaseGridPanel here for the raw spreadsheet view */}
      </div>
    </div>
  );
};
```

---

## Part 4: String Tables (.stf)

### 4.1 .stf File Structure

`.stf` files use a direct binary layout optimized for CRC32 hash lookups, not an IFF FORM hierarchy:

| Field | Size | Notes |
|-------|------|-------|
| Magic header | 4 bytes | `STF ` (0x20465453) |
| Version | 4 bytes | Typically `0x00000002` |
| Entry count | 4 bytes | Number of key-value pairs |
| Index block | `entryCount × 16 bytes` | Per entry: CRC32 hash (4), padding (4), absolute payload offset (4), padding (4) |
| Payload block | variable | Sequence of: `uint32` key length + key bytes (ASCII) + `uint32` text length + text chars (UTF-16 LE, 2 bytes/char) |

### 4.2 Native C++ Data Structures

```cpp
#include <napi.h>
#include <string>
#include <vector>
#include <cstdint>

// Individual string table entry
struct StfStringEntry {
    uint32_t      crc32Hash  = 0;  // CRC32 of the key label string
    std::string   keyLabel;        // e.g., "heavy_blaster"
    std::wstring  localizedText;   // UTF-16/UCS-2 wide characters
};

struct SwgStringTable {
    uint32_t version = 2;
    std::vector<StfStringEntry> rows;
};
```

### 4.3 Binary .stf Parser and CRC32 Builder (C++)

The CRC32 uses the standard IEEE 802.3 polynomial (`0xEDB88320`, reflected). This is .stf-specific — the client engine hashes key identifiers with this algorithm before looking them up in the index block.

```cpp
class SwgStfEngine {
public:
    // Standard IEEE 802.3 CRC32 hashing (polynomial 0xEDB88320)
    static uint32_t CalculateCRC32(const std::string& str) {
        uint32_t crc = 0xFFFFFFFF;
        for (char c : str) {
            crc ^= static_cast<uint8_t>(c);
            for (int i = 0; i < 8; ++i) {
                if (crc & 1) crc = (crc >> 1) ^ 0xEDB88320;
                else         crc >>= 1;
            }
        }
        return ~crc;
    }

    /**
     * Parses a raw byte stream from an .stf file into native memory structures.
     */
    static SwgStringTable ParseStfBuffer(const uint8_t* buffer, size_t totalBytes) {
        SwgStringTable table;
        size_t offset = 0;

        char magic[4];
        std::memcpy(magic, buffer + offset, 4);
        offset += 4;

        if (std::strncmp(magic, "STF ", 4) != 0) {
            throw std::runtime_error("Target file payload is not a valid SWG String Table (.stf) file structure.");
        }

        table.version = *reinterpret_cast<const uint32_t*>(buffer + offset);
        offset += 4;

        uint32_t entryCount = *reinterpret_cast<const uint32_t*>(buffer + offset);
        offset += 4;

        // Skip index block to reach payload block directly
        size_t indexBlockOffset = offset;
        offset += entryCount * 16; // 16 bytes per index descriptor

        table.rows.resize(entryCount);

        for (uint32_t i = 0; i < entryCount; ++i) {
            uint32_t keyLen = *reinterpret_cast<const uint32_t*>(buffer + offset);
            offset += 4;

            std::string key(reinterpret_cast<const char*>(buffer + offset), keyLen);
            offset += keyLen;

            uint32_t textLen = *reinterpret_cast<const uint32_t*>(buffer + offset);
            offset += 4;

            std::wstring localizedText(reinterpret_cast<const wchar_t*>(buffer + offset), textLen);
            offset += textLen * 2; // 2 bytes per UTF-16 char

            table.rows[i].keyLabel      = key;
            table.rows[i].crc32Hash     = CalculateCRC32(key);
            table.rows[i].localizedText = localizedText;
        }

        return table;
    }
};
```

### 4.4 N-API Serialization: String Trees to JavaScript

Wide UTF-16 strings are converted to UTF-8 for N-API compatibility.

```cpp
Napi::Value DeconstructStfToJs(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    Napi::ArrayBuffer inputBuffer = info.As<Napi::ArrayBuffer>();

    const uint8_t* rawData   = static_cast<const uint8_t*>(inputBuffer.Data());
    size_t         byteLength = inputBuffer.ByteLength();

    try {
        SwgStringTable stfTable = SwgStfEngine::ParseStfBuffer(rawData, byteLength);
        Napi::Array jsRowsArray = Napi::Array::New(env, stfTable.rows.size());

        for (size_t i = 0; i < stfTable.rows.size(); ++i) {
            Napi::Object rowObj = Napi::Object::New(env);
            const auto& entry   = stfTable.rows[i];

            rowObj.Set("hash", Napi::Number::New(env, entry.crc32Hash));
            rowObj.Set("key",  Napi::String::New(env, entry.keyLabel));

            // Convert wide string to UTF-8 for Node-API
            std::wstring_convert<std::codecvt_utf8_utf16<wchar_t>> converter;
            std::string utf8Text = converter.to_bytes(entry.localizedText);
            rowObj.Set("text", Napi::String::New(env, utf8Text));

            jsRowsArray[i] = rowObj;
        }

        return jsRowsArray;
    }
    catch (const std::exception& e) {
        Napi::TypeError::New(env, e.what()).ThrowAsJavaScriptException();
        return env.Null();
    }
}
```

### 4.5 Localization String Management Panel (React)

```tsx
import React, { useState, useMemo } from 'react';

interface StfRow {
  hash: number;
  key:  string;
  text: string;
}

export const SwgLocalizationEditorPanel: React.FC<{
  initialRows:    StfRow[];
  onSaveTrigger:  (updatedRows: StfRow[]) => void;
}> = ({ initialRows, onSaveTrigger }) => {
  const [rows,        setRows]        = useState<StfRow[]>(initialRows);
  const [searchQuery, setSearchQuery] = useState('');

  const filteredRows = useMemo(() => {
    return rows.filter(r =>
      r.key.toLowerCase().includes(searchQuery.toLowerCase()) ||
      r.text.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [rows, searchQuery]);

  const handleCellTextChange = (index: number, newText: string) => {
    const updated = [...rows];
    updated[index].text = newText;
    setRows(updated);
  };

  return (
    <div style={{ background: '#1e1e1e', padding: '16px', borderRadius: '4px', border: '1px solid #00ffcc', color: '#fff', fontFamily: 'monospace' }}>
      <h3 style={{ color: '#00ffcc', margin: '0 0 12px 0' }}>Localization String Matrix Table Editor (.STF)</h3>

      <input
        type="text"
        placeholder="Search string keys or translated text content..."
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        style={{ width: '100%', background: '#2d2d2d', border: '1px solid #555', padding: '8px', color: '#fff', marginBottom: '12px', borderRadius: '2px' }}
      />

      <div style={{ maxHeight: '350px', overflowY: 'auto', border: '1px solid #333' }}>
        {/* Sticky header */}
        <div style={{ display: 'flex', background: '#252526', position: 'sticky', top: 0, zIndex: 10, padding: '6px 0', borderBottom: '2px solid #00ffcc', color: '#00ffcc', fontSize: '11px' }}>
          <div style={{ width: '120px', paddingLeft: '8px' }}>CRC32 HASH</div>
          <div style={{ flex: 1,  padding: '0 8px' }}>INTERNAL RESOURCE KEY</div>
          <div style={{ flex: 2,  padding: '0 8px' }}>LOCALIZED TRANSLATION TEXT</div>
        </div>

        {filteredRows.map((row, idx) => (
          <div key={row.key} style={{ display: 'flex', borderBottom: '1px solid #2a2a2a', padding: '4px 0', alignItems: 'center', background: idx % 2 === 0 ? '#1a1a1a' : '#222' }}>
            <div style={{ width: '120px', paddingLeft: '8px', fontSize: '10px', color: '#888' }}>0x{row.hash.toString(16).toUpperCase()}</div>
            <div style={{ flex: 1, padding: '0 8px', color: '#ff0055', fontSize: '12px', fontWeight: 'bold' }}>{row.key}</div>
            <div style={{ flex: 2, padding: '0 8px' }}>
              <input
                type="text"
                value={row.text}
                onChange={(e) => handleCellTextChange(idx, e.target.value)}
                style={{ width: '100%', background: 'transparent', border: 'none', color: '#e0e0e0', fontSize: '12px', outline: 'none' }}
              />
            </div>
          </div>
        ))}
      </div>

      <button
        onClick={() => onSaveTrigger(rows)}
        style={{ marginTop: '12px', background: '#00ffcc', color: '#111', fontWeight: 'bold', padding: '8px 14px', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
      >
        Compile String File (.STF)
      </button>
    </div>
  );
};
```

---

## Part 5: Reverse .stf Serialization (Compiler)

To write modified string rows back to a binary `.stf` file the client can load, the compiler uses an inside-out two-pass strategy:

```
[ TS Row Array Updates ] --> (Compute Key CRC32 Hashes) --> (Encode Text to UTF-16)
                                                                      |
                                                                      v
[ Deployable .stf Binary ] <-- (Prepend Header + TOC) <-- (Calculate Absolute Offsets)
```

### 5.1 Binary Writer Utility (C++)

```cpp
#include <napi.h>
#include <vector>
#include <string>
#include <cstring>
#include <codecvt>
#include <locale>

class StfBinaryWriter {
public:
    std::vector<uint8_t> buffer;

    void WriteBytes(const void* data, size_t size) {
        const uint8_t* bytePtr = static_cast<const uint8_t*>(data);
        buffer.insert(buffer.end(), bytePtr, bytePtr + size);
    }

    void WriteUint32(uint32_t value) {
        WriteBytes(&value, 4);
    }

    void WriteStringASCII(const std::string& str) {
        WriteBytes(str.data(), str.length());
    }

    void WriteStringUTF16(const std::wstring& wstr) {
        WriteBytes(wstr.data(), wstr.length() * 2); // 2 bytes per char
    }
};
```

### 5.2 Core Compilation Engine (C++)

Two passes: payload sizing to compute absolute offsets, then TOC + payload assembly.

```cpp
struct StfIndexDescriptor {
    uint32_t crc32Hash;
    uint32_t absolutePositionOffset;
};

class SwgStfCompiler {
public:
    static std::vector<uint8_t> CompileStringTable(const std::vector<StfStringEntry>& inputRows) {
        StfBinaryWriter masterWriter;

        uint32_t entryCount = static_cast<uint32_t>(inputRows.size());

        // 1. Write magic, version, entry count
        masterWriter.WriteBytes("STF ", 4);
        masterWriter.WriteUint32(2);           // Version 0002
        masterWriter.WriteUint32(entryCount);

        // Header (12 bytes) + TOC (16 bytes per entry)
        uint32_t currentPayloadOffset = 12 + (entryCount * 16);

        std::vector<StfIndexDescriptor> indexBlock;
        indexBlock.reserve(entryCount);

        StfBinaryWriter payloadWriter;

        // 2. Inside-out: compile payload and calculate offsets simultaneously
        for (const auto& row : inputRows) {
            uint32_t hash = SwgStfEngine::CalculateCRC32(row.keyLabel);
            indexBlock.push_back({ hash, currentPayloadOffset });

            uint32_t keyLen = static_cast<uint32_t>(row.keyLabel.length());
            payloadWriter.WriteUint32(keyLen);
            payloadWriter.WriteStringASCII(row.keyLabel);

            uint32_t textLen = static_cast<uint32_t>(row.localizedText.length());
            payloadWriter.WriteUint32(textLen);
            payloadWriter.WriteStringUTF16(row.localizedText);

            // Update absolute offset for the next entry
            currentPayloadOffset = 12 + (entryCount * 16) + static_cast<uint32_t>(payloadWriter.buffer.size());
        }

        // 3. Write TOC index block
        for (const auto& descriptor : indexBlock) {
            masterWriter.WriteUint32(descriptor.crc32Hash);
            masterWriter.WriteUint32(0); // 4-byte padding placeholder
            masterWriter.WriteUint32(descriptor.absolutePositionOffset);
            masterWriter.WriteUint32(0); // 4-byte secondary padding placeholder
        }

        // 4. Append compiled string payload
        masterWriter.buffer.insert(
            masterWriter.buffer.end(),
            payloadWriter.buffer.begin(),
            payloadWriter.buffer.end()
        );

        return masterWriter.buffer;
    }
};
```

### 5.3 N-API Compiler Bridge (C++)

Takes a JS row array, converts UTF-8 text back to `std::wstring`, compiles, and returns a zero-copy `ArrayBuffer`.

```cpp
Napi::Value CompileJsToStringTableStream(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    Napi::Array jsRows = info.As<Napi::Array>();

    std::vector<StfStringEntry> nativeRows;
    nativeRows.reserve(jsRows.Length());

    std::wstring_convert<std::codecvt_utf8_utf16<wchar_t>> converter;

    for (uint32_t i = 0; i < jsRows.Length(); ++i) {
        Napi::Object jsRowObj = jsRows.Get(i).As<Napi::Object>();
        StfStringEntry entry;

        entry.keyLabel = jsRowObj.Get("key").As<Napi::String>().Utf8Value();

        std::string utf8Text  = jsRowObj.Get("text").As<Napi::String>().Utf8Value();
        entry.localizedText   = converter.from_bytes(utf8Text);

        nativeRows.push_back(entry);
    }

    std::vector<uint8_t> compiledStfBytes = SwgStfCompiler::CompileStringTable(nativeRows);

    Napi::ArrayBuffer outputBuffer = Napi::ArrayBuffer::New(env, compiledStfBytes.size());
    std::memcpy(outputBuffer.Data(), compiledStfBytes.data(), compiledStfBytes.size());

    return outputBuffer;
}

// Module export registration
exports.Set("compileJsToStringTableStream", Napi::Function::New(env, CompileJsToStringTableStream));
```

### 5.4 React Build Dispatch

Wires the N-API compiler to the `onSaveTrigger` callback of `SwgLocalizationEditorPanel`.

```typescript
const handleCompileAndExportStfFile = async (updatedRows: any[]) => {
  try {
    // 1. Call the C++ binary serialization compiler
    const compiledStfArrayBuffer: ArrayBuffer = window.nativeBridge.compileJsToStringTableStream(updatedRows);

    // 2. Write to disk via context-isolation bridge
    const finalByteArrayView = new Uint8Array(compiledStfArrayBuffer);
    const success = await window.api.saveFileToDisk('string/en/custom_strings.stf', finalByteArrayView);

    if (success) {
      alert('Successfully serialized updated entries into a valid SWG String Table (.stf) binary package!');
    }
  }
  catch (err: any) {
    console.error('String table generation failure event:', err);
    alert(`STF compilation aborted: ${err.message}`);
  }
};
```

Pass `handleCompileAndExportStfFile` as the `onSaveTrigger` prop to `SwgLocalizationEditorPanel`.
