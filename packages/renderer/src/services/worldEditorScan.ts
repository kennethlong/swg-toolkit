/**
 * packages/renderer/src/services/worldEditorScan.ts
 * Disk-scan-as-truth building tree for the World panel (D-05).
 *
 * Lists every `interiorlayout/toolkit/edit_<id>.ilf` file in the resolved override dir and,
 * for each, reads the paired `object/building/toolkit/edit_<id>.iff` derived template (same
 * sanitized `<id>` suffix decorationPersist.ts already writes — see sanitizeId) to derive a
 * human display label and enumerate decoration rows. `rowIndex` is ALWAYS recomputed fresh
 * from the current parse pass (per-cell positional order), never cached — the Pitfall 3 guard
 * RESEARCH.md calls out.
 *
 * Offline-capable (D-07b): a pure fs scan, no live channel/agent dependency. Zero `.ws`-lookup
 * dependency — no `.ws` parser exists in this repo and building-general `.ws` editing is out of
 * scope (Phase 7 FMT-02). The display label instead comes from the derived template's own
 * DERV/base chunk (RESEARCH.md Pattern 1) — the same `.iff` structure buildingTemplate.ts already
 * parses.
 *
 * `buildingTemplateVfsPath` (ROUND 3, R3): the derived `.iff` on disk does NOT self-reference the
 * stock building's own VFS path (its DERV/base chunk names a generic shared base template, not
 * the specific stock building file) — so this value cannot be re-derived from override-dir bytes
 * alone. It is looked up from the caller-supplied `buildingTemplates` map (Plan 02's durable
 * per-project `worldEditorBuildingTemplates`, populated by Plan 06's orchestrator on every live
 * capture), keyed by the SAME raw `<id>` string this scan already extracts from the filename —
 * that filename suffix already IS `sanitizeId`'s output, so this module does NOT import
 * `sanitizeId` (or anything else) from `./decorationPersist` (ROUND-3-REVIEW R5 — keeps this
 * plan's Wave-0 `depends_on: []` boundary intact).
 */

import fs from 'fs';
import path from 'path';

import type { DetectedClient } from '@swg/contracts';

import { parseIlf, type IlfNode } from './ilf';
import { parseIffTree, findForm, type IffLeaf } from './iffTree';
import { detectClients } from './clientLocator';
import { resolveOverrideDir } from './looseOverrideDeploy';

const EDIT_ILF_DIR = ['interiorlayout', 'toolkit'];
const EDIT_TEMPLATE_DIR = ['object', 'building', 'toolkit'];
const EDIT_PREFIX = 'edit_';
const EDIT_ILF_SUFFIX = '.ilf';
const EDIT_TEMPLATE_SUFFIX = '.iff';

export interface WorldEditorDecoration {
  cellName: string;
  /** Within-cell file-order index, recomputed fresh every scan (never cached). */
  rowIndex: number;
  objectTemplateName: string;
  /** 12 floats, o2p, row-major 3×4 — see ilf.ts's IlfNode. */
  transform: number[];
}

export interface WorldEditorBuilding {
  /** The raw `<id>` suffix from `edit_<id>.ilf` — already `sanitizeId`'s output. */
  buildingId: string;
  /** Human label derived from the derived template's own DERV/base chunk; falls back to the
   *  raw `buildingId` when the paired `.iff` is missing/unreadable — never throws. */
  displayLabel: string;
  editedIlfPath: string;
  derivedTemplatePath: string;
  /** Stock building template's own VFS path, from the caller-supplied durable map — empty
   *  string when unknown (ROUND 3, R3). Never `undefined`, never guessed. */
  buildingTemplateVfsPath: string;
  decorations: WorldEditorDecoration[];
}

function readAsciiz(buf: Buffer, off: number): string {
  let end = off;
  while (end < buf.length && buf[end] !== 0) end++;
  return buf.toString('ascii', off, end);
}

/**
 * Derive a human display label from a derived template's own DERV/base chunk (RESEARCH.md
 * Pattern 1) — reuses the generic `iffTree.ts`/`findForm` walker already used by
 * buildingTemplate.ts; never a `.ws` lookup. Returns '' when there's nothing usable to read
 * (caller falls back to the raw numeric id).
 */
function deriveDisplayLabel(templateBytes: Buffer): string {
  try {
    const tree = parseIffTree(templateBytes);
    const derv = findForm(tree, 'FORM', 'DERV');
    if (!derv) return '';
    const baseLeaf = derv.children.find((c): c is IffLeaf => c.kind === 'leaf' && c.tag === 'XXXX');
    if (!baseLeaf) return '';
    const basePath = readAsciiz(baseLeaf.payload, 0);
    if (!basePath) return '';
    const base = basePath.split('/').pop() ?? basePath;
    return base.replace(/\.iff$/i, '').replace(/^shared_/, '');
  } catch {
    return '';
  }
}

/** Enumerate `nodes` into decoration rows, recomputing each row's within-cell index fresh from
 *  THIS parse pass (never cached — Pitfall 3 guard: a caller must never persist/reuse a prior
 *  scan's rowIndex across a Remove-driven reindex). */
function toDecorations(nodes: IlfNode[]): WorldEditorDecoration[] {
  const perCell = new Map<string, number>();
  return nodes.map((n) => {
    const rowIndex = perCell.get(n.cellName) ?? 0;
    perCell.set(n.cellName, rowIndex + 1);
    return { cellName: n.cellName, rowIndex, objectTemplateName: n.objectTemplateName, transform: n.transform };
  });
}

/**
 * Synchronously list every `interiorlayout/toolkit/edit_<id>.ilf` in `overrideDir`, pair it with
 * its `object/building/toolkit/edit_<id>.iff` derived template, and return one
 * `WorldEditorBuilding` per file. An empty/non-existent `overrideDir` returns an empty tree, not
 * an error. A malformed/truncated `.ilf` (T-05.1-04a) or a missing paired `.iff` (orphaned edit)
 * still surfaces as a single row with a fallback label — never aborts the whole scan.
 */
export function scanWorldEditorState(
  overrideDir: string,
  buildingTemplates: Record<string, string> = {},
): WorldEditorBuilding[] {
  const ilfDir = path.join(overrideDir, ...EDIT_ILF_DIR);
  let entries: string[];
  try {
    entries = fs.readdirSync(ilfDir);
  } catch {
    return [];
  }

  const buildings: WorldEditorBuilding[] = [];
  for (const entryName of entries) {
    if (!entryName.startsWith(EDIT_PREFIX) || !entryName.toLowerCase().endsWith(EDIT_ILF_SUFFIX)) continue;
    const buildingId = entryName.slice(EDIT_PREFIX.length, entryName.length - EDIT_ILF_SUFFIX.length);
    const editedIlfPath = path.join(ilfDir, entryName);
    const templateFileName = `${EDIT_PREFIX}${buildingId}${EDIT_TEMPLATE_SUFFIX}`;
    const derivedTemplatePath = path.join(overrideDir, ...EDIT_TEMPLATE_DIR, templateFileName);

    let decorations: WorldEditorDecoration[] = [];
    try {
      decorations = toDecorations(parseIlf(fs.readFileSync(editedIlfPath)));
    } catch {
      // Corrupted/truncated .ilf (T-05.1-04a) — surfaces as one unreadable row, never aborts
      // the whole scan.
      decorations = [];
    }

    let displayLabel = buildingId;
    try {
      const label = deriveDisplayLabel(fs.readFileSync(derivedTemplatePath));
      if (label) displayLabel = label;
    } catch {
      // Orphaned .ilf (no paired .iff) — falls back to the raw numeric id, never throws.
    }

    buildings.push({
      buildingId,
      displayLabel,
      editedIlfPath,
      derivedTemplatePath,
      buildingTemplateVfsPath: buildingTemplates[buildingId] ?? '',
      decorations,
    });
  }
  return buildings;
}

/**
 * Resolve the dir to scan: when `clientExe` is provided (live-attached), use the SAME
 * detectClients() + longest-installPath-prefix match decorationPersistOrchestrator.ts's
 * resolveRunningClientOverrideDir uses, so the attached client wins (D-07b). Otherwise, when
 * `offlineBinding` is non-null AND its `cfgPath` is defined, fall back to
 * `resolveOverrideDir(offlineBinding.cfgPath, offlineBinding.clientPath ?? undefined)` so the
 * panel works fully offline. `offlineBinding` is the ALREADY-RESOLVED `{ cfgPath, clientPath }`
 * pair — this module does NOT import projectBinding.ts (no circular dependency) and never
 * re-derives cfgPath/clientPath from a bare studioDir string (ROUND 3, R12/MED-11). Returns null
 * (never throws) when neither source resolves, including when `offlineBinding` is non-null but
 * its `cfgPath` is undefined (ROUND-3-REVIEW R9 — `resolveOverrideDir` requires a non-optional
 * `cfgPath` and must never be called with an unchecked optional value).
 */
export function resolveScanRoot(
  clientExe: string | null,
  offlineBinding: { cfgPath?: string; clientPath: string | null } | null,
): string | null {
  if (clientExe) {
    const exeNorm = clientExe.replace(/\\/g, '/').toLowerCase();
    let best: { c: DetectedClient; len: number } | null = null;
    try {
      const clients = detectClients();
      for (const c of clients) {
        const inst = c.installPath.replace(/\\/g, '/').toLowerCase();
        if ((exeNorm === inst || exeNorm.startsWith(`${inst}/`)) && (!best || inst.length > best.len)) {
          best = { c, len: inst.length };
        }
      }
    } catch {
      return null;
    }
    if (!best) return null;
    return resolveOverrideDir(best.c.cfgRootPath, best.c.installPath);
  }

  if (offlineBinding === null || offlineBinding.cfgPath === undefined) return null;
  return resolveOverrideDir(offlineBinding.cfgPath, offlineBinding.clientPath ?? undefined);
}
