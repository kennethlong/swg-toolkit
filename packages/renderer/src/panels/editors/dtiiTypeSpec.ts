/**
 * packages/renderer/src/panels/editors/dtiiTypeSpec.ts
 * Pure, framework-free interpreter for the DTII column type-spec STRING grammar.
 *
 * This is a UI/widget-selection layer ONLY — the native core (05-02-PLAN.md) already enforces
 * the physical 3-way dispatch (int32/float32/NUL-terminated string) and is the actual safety
 * boundary (physicalTypeForSpec in DataTable.h/.cpp). This module never crosses the N-API bridge
 * and has zero React/native-core imports.
 *
 * PORT SOURCE (semantic type-spec STRING grammar, not the physical read/write):
 *   D:/Code/swg-client-v2/src/engine/shared/library/sharedUtility/src/shared/DataTableColumnType.cpp
 *   lines 84-232 (DataTableColumnType constructor's chomp/getDelimStr dispatch).
 *
 * Dispatch order (REVIEWS.md MEDIUM fix — z(...) crash guard): a leading `z(` is checked BEFORE
 * `e(`, so a table-sourced enum (`z(tableName)` — bare table name, no `=`) can never reach the
 * `e(...)` key=value label-map parser and throw/mis-parse. This is enforced BY CONSTRUCTION: the
 * dispatch below tests `z(` first and returns immediately.
 *
 * Never throws on malformed/unrecognized input — degrades to `{kind:'unknown', raw}` instead
 * (T-05-29 mitigation; this module is a display/widget-selection helper, not a validating parser).
 */

// ─── Public types ──────────────────────────────────────────────────────────────

interface WithDefaultLabel {
  /** Optional `[default]`-suffix marker (e.g. `s[required]`, `e(a=0,b=1)[a]`) — captured per
   *  DataTableColumnType.cpp's bracket-suffix convention, not required to be acted on here. */
  defaultLabel?: string;
}

export type TypeSpecInfo =
  | ({ kind: 'int' } & WithDefaultLabel)
  | ({ kind: 'float' } & WithDefaultLabel)
  | ({ kind: 'string' } & WithDefaultLabel)
  | ({ kind: 'hashstring' } & WithDefaultLabel)
  | ({ kind: 'bool' } & WithDefaultLabel)
  | ({ kind: 'packedObjVars' } & WithDefaultLabel)
  | ({ kind: 'enum'; labels: Record<string, number> } & WithDefaultLabel)
  | ({ kind: 'bitvector'; flags: Record<string, number> } & WithDefaultLabel)
  | ({ kind: 'enum-table'; tableName: string } & WithDefaultLabel)
  | { kind: 'unknown'; raw: string };

// ─── Ground-truth-ported string helpers (DataTableColumnType.cpp getDelimStr) ──────────────────

/**
 * Extract the substring between the FIRST occurrence of `left` and the LAST occurrence of
 * `right` — mirrors `getDelimStr` (DataTableColumnType.cpp:31-40) exactly, including its
 * "whole-string" scan behavior (not scoped to a sub-slice).
 *
 * Returns `null` when either delimiter is absent OR `right` occurs before `left` — this is a
 * DELIBERATE strengthening over the C++ original (which would return a garbage/negative-length
 * substring in that case): a malformed spec like `e(malformed` (no closing paren) must degrade
 * to `unknown`, not silently produce an empty/garbage label map.
 */
function getDelimStr(str: string, left: string, right: string): string | null {
  const lPos = str.indexOf(left);
  const rPos = str.lastIndexOf(right);
  if (lPos === -1 || rPos === -1 || rPos <= lPos) return null;
  return str.substring(lPos + 1, rPos);
}

/**
 * Parses a `label=value,label=value,...` list (already extracted from between the parens) into
 * a label->int map. Ports the EXACT algorithm from DataTableColumnType.cpp:144-153/171-183
 * (append trailing comma, repeatedly find '=' then the first ',', slice, erase-from-front).
 */
function parseLabelValueMap(inner: string): Record<string, number> {
  const map: Record<string, number> = {};
  let list = inner + ',';
  for (;;) {
    const eqPos = list.indexOf('=');
    if (eqPos === -1) break;
    const endPos = list.indexOf(',');
    if (endPos === -1) break; // malformed trailing content — stop rather than loop forever
    const label = list.substring(0, eqPos);
    const valStr = list.substring(eqPos + 1, endPos);
    const val = parseInt(valStr, 10);
    map[label] = Number.isNaN(val) ? 0 : val;
    list = list.substring(endPos + 1);
  }
  return map;
}

// ─── BitVector wire-encoding helper ─────────────────────────────────────────────

/**
 * Converts a 1-based bit index (as stored in a bitvector column's `flags` map) to its OR-able
 * wire mask, per DataTableColumnType.cpp:182 (`(*m_enumMap)[label] = 1 << (bit - 1)`).
 */
export function bitVectorFlagToMask(bit: number): number {
  return 1 << (bit - 1);
}

// ─── Physical-type dispatch (DataTable.h physicalTypeForSpec basicType mirror) ─────────────────

/**
 * Physical storage type for a column's parsed type-spec — mirrors physicalTypeForSpec's
 * basicType dispatch (DataTable.h): float->Float, string/packedObjVars->String, everything
 * else (int/hashstring/bool/enum/bitvector/enum-table/unknown)->Int.
 *
 * Single source of truth for the UI's "storage type" concept — consumed by both
 * DatatableGridEditor.tsx (cell coercion) and SchemaRail.tsx (`Schema · COLS/TYPE` storage
 * label) so the two never drift out of sync (05-08).
 */
export function physicalTypeForKind(kind: TypeSpecInfo['kind']): 'int' | 'float' | 'string' {
  switch (kind) {
    case 'float': return 'float';
    case 'string':
    case 'packedObjVars':
      return 'string';
    default:
      return 'int';
  }
}

// ─── Main dispatch ──────────────────────────────────────────────────────────────

export function parseTypeSpec(raw: string): TypeSpecInfo {
  const trimmed = (raw ?? '').trim();

  if (trimmed.length === 0) {
    return { kind: 'unknown', raw };
  }

  // Bracket-suffix default marker (e.g. `s[required]`, `e(a=0,b=1)[a]`) — scanned over the WHOLE
  // raw string, same as DataTableColumnType.cpp's m_defaultValue = getDelimStr(desc, '[', ']').
  const bracketSuffix = getDelimStr(trimmed, '[', ']');
  const defaultLabel = bracketSuffix != null && bracketSuffix.length > 0 ? bracketSuffix : undefined;
  const withDefault = <T extends object>(obj: T): T & WithDefaultLabel =>
    defaultLabel !== undefined ? ({ ...obj, defaultLabel }) : obj;

  // z(...) MUST be checked before e(...) — structurally impossible to reach the e(...) key=value
  // grammar (REVIEWS.md MEDIUM fix). z(...)'s inner content is a bare table name, no '='.
  if (/^z\(/i.test(trimmed)) {
    const inner = getDelimStr(trimmed, '(', ')');
    if (inner === null) return { kind: 'unknown', raw };
    return withDefault({ kind: 'enum-table', tableName: inner.trim() });
  }

  if (/^e\(/i.test(trimmed)) {
    const inner = getDelimStr(trimmed, '(', ')');
    if (inner === null) return { kind: 'unknown', raw };
    return withDefault({ kind: 'enum', labels: parseLabelValueMap(inner) });
  }

  if (/^v\(/i.test(trimmed)) {
    const inner = getDelimStr(trimmed, '(', ')');
    if (inner === null) return { kind: 'unknown', raw };
    return withDefault({ kind: 'bitvector', flags: parseLabelValueMap(inner) });
  }

  const firstChar = trimmed[0]!.toLowerCase();
  switch (firstChar) {
    case 'i': return withDefault({ kind: 'int' });
    case 'f': return withDefault({ kind: 'float' });
    case 's': return withDefault({ kind: 'string' });
    case 'h': return withDefault({ kind: 'hashstring' });
    case 'b': return withDefault({ kind: 'bool' });
    case 'p': return withDefault({ kind: 'packedObjVars' });
    default:
      return { kind: 'unknown', raw };
  }
}
