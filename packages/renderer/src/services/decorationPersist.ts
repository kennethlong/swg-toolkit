/**
 * packages/renderer/src/services/decorationPersist.ts
 * Model-D toolkit-side assembly: turn a captured in-game decoration move into the two loose
 * override files (edited `.ilf` + derived building template) that make that ONE building
 * instance load the edited interior.
 *
 * The agent (runtime side) captures the edit and reports it (see DecorationEdit). This function
 * is the pure toolkit half — no agent, no channel, no live state — so it's fully unit-testable.
 * The caller then: (1) tells the agent `wsSetNodeTemplateName(nodeId, result.derivedTemplateVfsPath)`
 * + `wsSaveSnapshot` (which must happen AFTER these files exist — the v23 fail-closed staging rule),
 * and (2) stages result.stagedEntries + the saved `.ws` through the deploy pipeline.
 *
 * CONSULT-70 invariants honored: change ONLY interiorLayoutFileName (deriveBuildingTemplate inherits
 * the `.pob` → the `.ws` portalLayoutCrc stays valid); name the derived template by BUILDING INSTANCE
 * id, never dedupe (else per-instance collapses to per-template); resolve the row from the object's
 * original o2p; write the moved o2p.
 */

import fs from 'fs';
import path from 'path';

import { parseIlf, serializeIlf, editNodeTransform, resolveRowIndex, resolveNode, addNode, removeNode, type IlfNode } from './ilf';
import { deriveBuildingTemplate, readInteriorLayoutFileName } from './buildingTemplate';

export interface DecorationEdit {
  /** The building's `.ws` node id (or any per-instance key) — names the derived template 1:1. */
  buildingInstanceId: string;
  /** VFS path of the stock building template, e.g. object/building/tatooine/shared_cantina_tatooine.iff. */
  buildingTemplateVfsPath: string;
  /**
   * Cell the decoration lives in (`.ilf` cellName). Optional: the agent usually can't read it
   * (`CellProperty::getCellName` is inline / un-advertised), so when omitted it's DERIVED by
   * matching template + originalO2p across all cells (resolveNode). Pass it only as a
   * disambiguation hint for the rare identical-prop-in-two-cells case.
   */
  cellName?: string;
  /** The moved decoration's object template name. */
  decorationTemplateName: string;
  /** The decoration's o2p at PICK time (before the move) — used to resolve its `.ilf` row. */
  originalO2p: number[];
  /** The decoration's o2p AFTER the move — written into the `.ilf`. */
  newO2p: number[];
  /**
   * Which `.ilf` mutation to perform. Defaults to 'edit' when absent — 100% backward compatible
   * with the proven live pipeline, which never sets it.
   *   - 'edit': existing behavior (resolve + editNodeTransform), byte-identical, zero regression.
   *   - 'add': append a new node (no prior row to resolve). Requires `cellName` (fail closed —
   *     an ADD with no cellName is a caller bug). `originalO2p` is unused; `newO2p` is the new
   *     node's transform.
   *   - 'remove': resolve the target row the SAME way 'edit' does, then delete it. `newO2p` is
   *     unused for this kind.
   */
  kind?: 'edit' | 'add' | 'remove';
}

export interface DecorationPersistDeps {
  /** Read stock/override bytes for a VFS path from the mounted TRE (readVfsEntryBytes). Throws if absent. */
  readVfs: (vfsPath: string) => Buffer;
  /** Absolute loose override dir root (== the client's winning SearchPath). */
  overrideDir: string;
  /** Write bytes to an absolute path (creating parents). Defaults to fs. Injected in tests. */
  writeFile?: (absPath: string, bytes: Buffer) => void;
  /** Trace sink for resolve/assembly steps (wired to the orchestrator's debug log). */
  log?: (msg: string) => void;
  /**
   * Also write the edited `.ilf` at the STOCK ilf path in the override dir (per-TEMPLATE visibility).
   * On a hybrid server session the server re-streams static POBs from the STOCK template, so the
   * instance-scoped rebind is invisible in-game — but the client reads the interior layout locally,
   * so shadowing the stock `.ilf` path makes the edit visible on EVERY instance of that layout
   * (per-template, not per-instance — the §4 trade-off, maintainer-approved 2026-07-31).
   */
  mirrorToStockIlf?: boolean;
}

export interface DecorationPersistResult {
  /** The `.ilf` row that was edited/added/removed (within-cell index). */
  rowIndex: number;
  /**
   * The cell this persist touched — `resolved.cellName` for 'edit'/'remove', or the
   * caller-pinned `edit.cellName` for 'add' (always defined for that kind). Lets callers report
   * which cell a persist touched without re-deriving it (ROUND 3 — REVIEWS.md R3/R5).
   */
  cellName: string;
  /** VFS path of the derived template — feed this to wsSetNodeTemplateName(nodeId, this). */
  derivedTemplateVfsPath: string;
  /** VFS path of the edited `.ilf` the derived template points at. */
  editedIlfVfsPath: string;
  derivedTemplateFilePath: string;
  editedIlfFilePath: string;
  /**
   * Loose files to stage. The two instance-scoped files are 'add' (new names, shadow no stock asset);
   * the optional stock-path mirror (mirrorToStockIlf) is 'modify' — it shadows a shipped `.ilf`.
   */
  stagedEntries: { virtualPath: string; filePath: string; action: 'add' | 'modify' }[];
}

/** Sanitize an id for use in a filename (`edit_<id>.ilf`/`edit_<id>.iff`). Exported so Plan 06's
 *  durable per-building map can key by the IDENTICAL sanitized id `worldEditorScan.ts` reads off
 *  the override-dir filename, without re-implementing or drifting from these rules. */
export function sanitizeId(id: string): string {
  return id.replace(/[^a-z0-9_]/gi, '_').toLowerCase() || 'x';
}

function defaultWrite(absPath: string, bytes: Buffer): void {
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, bytes);
}

/**
 * Write `editedIlfBytes` at the STOCK `.ilf` VFS path inside `deps.overrideDir` (the
 * per-TEMPLATE visibility mirror — see DecorationPersistDeps.mirrorToStockIlf) and return the
 * staged entry to append. Extracted out of assembleDecorationEdit's own mirror branch (which
 * still calls this) so decorationPersistOrchestrator.ts's `reconcileMirrorMode` (05.1-06,
 * D-09) can reuse the EXACT SAME write logic outside a single persist's assembly — a pure
 * refactor-for-reuse, no behavior change to the proven edit path.
 */
export function writeStockMirror(
  deps: { overrideDir: string; writeFile?: (absPath: string, bytes: Buffer) => void },
  stockIlfVfsPath: string,
  editedIlfBytes: Buffer,
): { virtualPath: string; filePath: string; action: 'modify' } {
  const write = deps.writeFile ?? defaultWrite;
  const mirroredFilePath = path.join(deps.overrideDir, stockIlfVfsPath);
  write(mirroredFilePath, editedIlfBytes);
  return { virtualPath: stockIlfVfsPath, filePath: mirroredFilePath, action: 'modify' };
}

/**
 * TRUE when `vfsPath` names a file the toolkit itself AUTHORS — an `interiorlayout/toolkit/*.ilf`
 * derived edit file. Such a path can NEVER legitimately be a stock mirror TARGET: a mirror is a
 * shadow of a SHIPPED stock layout, and the toolkit dir contains only the user's own work.
 *
 * --- INCIDENT 2026-08-07: this predicate exists because its absence destroyed a user's file. ---
 * `worldEditorBuildingTemplates` is documented (worldEditorScan.ts:62-64) to hold each building's
 * STOCK template path, but the orchestrator wrote whatever template the AGENT reported. Once a
 * rebind has landed in the `.ws`, an editor-scene capture reports the DERIVED template, so the map
 * silently self-poisoned. reconcileMirrorMode then resolved that building's "stock mirror path" by
 * reading the DERIVED template — which declares `interiorlayout/toolkit/edit_<id>.ilf` — so the
 * mirror path became the user's own edit file, and mirror-OFF unlinked it. 34,422 bytes of
 * persisted work, deleted by a toggle, with zero errors reported on either pass.
 * Root cause is fixed upstream (see resolveStockBuildingTemplate + the Phase-2a cross-check), but
 * this guard is the invariant that makes the whole CLASS impossible regardless of how the path was
 * derived — a mirror is never a file we authored.
 */
export function isToolkitAuthoredIlfPath(vfsPath: string): boolean {
  return /(^|\/)interiorlayout\/toolkit\//i.test(vfsPath.replace(/\\/g, '/'));
}

/**
 * Delete the stock-path mirror file at `stockIlfVfsPath` inside `deps.overrideDir` (mirror mode
 * turned off, or reconcileMirrorMode's rollback undoing a prior write). Throws if the file does
 * not exist — callers that need "delete if present" semantics check existence first
 * (reconcileMirrorMode does; assembleDecorationEdit never calls this today).
 *
 * REFUSES a toolkit-authored path (see isToolkitAuthoredIlfPath). The guard lives in the PRIMITIVE,
 * not at the call site, because there are TWO destructive routes here — reconcileMirrorMode's
 * mirror-OFF branch and its rollback of a prior write — and a call-site guard would cover one and
 * miss the other. Throwing (rather than silently skipping) is deliberate: the OFF branch turns it
 * into a reported failure entry with zero writes, and the rollback's per-entry catch already
 * degrades it to the documented `diskState: 'uncertain'` residual. A silent skip would leave the
 * same invisible wrongness that made the original incident take a crew of four to find.
 */
export function removeStockMirror(deps: { overrideDir: string }, stockIlfVfsPath: string): void {
  if (isToolkitAuthoredIlfPath(stockIlfVfsPath)) {
    throw new Error(
      `refusing to delete ${stockIlfVfsPath} as a stock mirror — that path is a toolkit-authored ` +
      `edit file, not a mirror of a shipped layout. This means a building's stock template path ` +
      `resolved to a derived template; the durable worldEditorBuildingTemplates map is likely stale.`,
    );
  }
  const filePath = path.join(deps.overrideDir, stockIlfVfsPath);
  fs.unlinkSync(filePath);
}

const fmtPos = (t: number[]): string => `(${t[3]?.toFixed(3)},${t[7]?.toFixed(3)},${t[11]?.toFixed(3)})`;

/** Top-3 template-matching rows by transform distance — the "why didn't it match" diagnostic. */
function nearestCandidates(nodes: IlfNode[], templateName: string, o2p: number[]): string {
  const perCell = new Map<string, number>();
  const cands: { cell: string; row: number; dist: number; pos: string }[] = [];
  for (const n of nodes) {
    const idx = perCell.get(n.cellName) ?? 0;
    perCell.set(n.cellName, idx + 1);
    if (n.objectTemplateName !== templateName) continue;
    let d = 0;
    for (let i = 0; i < 12; i++) {
      const dx = n.transform[i]! - o2p[i]!;
      d += dx * dx;
    }
    cands.push({ cell: n.cellName, row: idx, dist: Math.sqrt(d), pos: fmtPos(n.transform) });
  }
  if (cands.length === 0) return `no rows with template ${templateName} in any cell`;
  cands.sort((a, b) => a.dist - b.dist);
  return cands
    .slice(0, 3)
    .map((c) => `${c.cell}[${c.row}] dist=${c.dist.toFixed(4)} pos=${c.pos}`)
    .join(' · ');
}

/**
 * Assemble the two loose override files for one decoration move. Returns the derived template's VFS
 * path (for the agent's wsSetNodeTemplateName) + the entries to stage. Throws if the picked
 * decoration can't be resolved in the stock `.ilf` (fail closed — never persist the wrong object).
 */
export function assembleDecorationEdit(edit: DecorationEdit, deps: DecorationPersistDeps): DecorationPersistResult {
  const kind = edit.kind ?? 'edit';
  const id = sanitizeId(edit.buildingInstanceId);
  const write = deps.writeFile ?? defaultWrite;

  const stockIff = deps.readVfs(edit.buildingTemplateVfsPath);
  const stockIlfVfs = readInteriorLayoutFileName(stockIff);
  if (!stockIlfVfs) {
    throw new Error(`decorationPersist: ${edit.buildingTemplateVfsPath} has no interiorLayoutFileName`);
  }

  // Instance-scoped derived names in a toolkit-only subdir (shadows nothing shipped; 1:1 per instance).
  const editedIlfVfsPath = `interiorlayout/toolkit/edit_${id}.ilf`;
  const derivedTemplateVfsPath = `object/building/toolkit/edit_${id}.iff`;

  const logf = deps.log ?? ((): void => undefined);

  // Base .ilf: the accumulated edited copy if a prior edit of THIS instance exists, else the stock.
  // (readVfs sees the loose override dir, so once written the edited copy resolves — repeat edits
  // accumulate instead of reverting each other.)
  let nodes: IlfNode[];
  let baseIsAccumulated: boolean;
  try {
    nodes = parseIlf(deps.readVfs(editedIlfVfsPath));
    baseIsAccumulated = true;
  } catch {
    nodes = parseIlf(deps.readVfs(stockIlfVfs));
    baseIsAccumulated = false;
  }
  logf(
    `assemble: base=${baseIsAccumulated ? `accumulated ${editedIlfVfsPath}` : `stock ${stockIlfVfs}`} ` +
    `(${nodes.length} rows), deco=${edit.decorationTemplateName} origPos=${fmtPos(edit.originalO2p)} newPos=${fmtPos(edit.newO2p)}`,
  );

  let resultCellName: string;
  let resultRowIndex: number;
  let mutatedNodes: IlfNode[];

  if (kind === 'add') {
    // No prior row to match — an ADD requires the caller to pin the cell (fail closed; a missing
    // cellName here is a caller bug, not something to guess at).
    if (edit.cellName === undefined) {
      throw new Error('decorationPersist: kind="add" requires edit.cellName (there is no prior row to derive it from)');
    }
    resultCellName = edit.cellName;
    // The new node's within-cell rowIndex is the count of prior nodes sharing its cell — matches
    // addNode's own append-only guarantee (ilf.ts).
    resultRowIndex = nodes.filter((n) => n.cellName === resultCellName).length;
    const newNode: IlfNode = {
      objectTemplateName: edit.decorationTemplateName,
      cellName: resultCellName,
      transform: edit.newO2p,
    };
    mutatedNodes = addNode(nodes, newNode);
    logf(`assemble: add cell=${resultCellName} row=${resultRowIndex} template=${edit.decorationTemplateName}`);
  } else {
    // 'edit' and 'remove' share the SAME resolve step + orphaned-edit-recovery — both need to find
    // the existing row before mutating it.
    const tryResolve = (ns: IlfNode[]): { cellName: string; rowIndex: number } | null => {
      if (edit.cellName !== undefined) {
        const r = resolveRowIndex(ns, edit.cellName, edit.decorationTemplateName, edit.originalO2p);
        return r === null ? null : { cellName: edit.cellName, rowIndex: r };
      }
      return resolveNode(ns, edit.decorationTemplateName, edit.originalO2p);
    };

    let resolved = tryResolve(nodes);
    if (resolved === null && baseIsAccumulated) {
      // Orphaned-edit recovery: a prior persist wrote the edited .ilf but its rebind never landed,
      // so the live world still spawns from the STOCK layout — the captured o2p matches stock rows,
      // not the accumulated copy. Resolve (and re-base the edit) against stock; the write below then
      // replaces the orphaned copy with stock + this edit.
      logf(`assemble: no match in accumulated base — nearest: ${nearestCandidates(nodes, edit.decorationTemplateName, edit.originalO2p)}`);
      logf(`assemble: retrying against stock ${stockIlfVfs}`);
      const stockNodes = parseIlf(deps.readVfs(stockIlfVfs));
      resolved = tryResolve(stockNodes);
      if (resolved !== null) nodes = stockNodes;
    }
    if (resolved === null) {
      logf(`assemble: FAIL — nearest: ${nearestCandidates(nodes, edit.decorationTemplateName, edit.originalO2p)}`);
      throw new Error(
        edit.cellName !== undefined
          ? `decorationPersist: could not resolve picked ${edit.decorationTemplateName} in cell ${edit.cellName}`
          : `decorationPersist: could not resolve picked ${edit.decorationTemplateName} in any cell`,
      );
    }
    resultCellName = resolved.cellName;
    resultRowIndex = resolved.rowIndex;
    logf(`assemble: resolved cell=${resultCellName} row=${resultRowIndex}`);

    mutatedNodes = kind === 'remove'
      ? removeNode(nodes, resultCellName, resultRowIndex)
      : editNodeTransform(nodes, resultCellName, resultRowIndex, edit.newO2p);
  }

  const editedIlf = serializeIlf(mutatedNodes);
  const derivedTemplate = deriveBuildingTemplate(stockIff, editedIlfVfsPath);

  const editedIlfFilePath = path.join(deps.overrideDir, editedIlfVfsPath);
  const derivedTemplateFilePath = path.join(deps.overrideDir, derivedTemplateVfsPath);
  write(editedIlfFilePath, editedIlf);
  write(derivedTemplateFilePath, derivedTemplate);

  const stagedEntries: DecorationPersistResult['stagedEntries'] = [
    { virtualPath: editedIlfVfsPath, filePath: editedIlfFilePath, action: 'add' },
    { virtualPath: derivedTemplateVfsPath, filePath: derivedTemplateFilePath, action: 'add' },
  ];

  // Per-template visibility mirror: shadow the STOCK ilf path so server-streamed instances (which
  // spawn from the stock template) read the edited layout too. Scope caveat traced loudly.
  if (deps.mirrorToStockIlf) {
    // SKIP, never throw, when the resolved "stock" path is the file we just wrote. A throw here
    // would abort AFTER editedIlfFilePath was already written above — a half-applied persist, worse
    // than a missing mirror. Skipping keeps the edit intact and says so loudly.
    // (Incident 2026-08-07: with a self-poisoned building-template map this collapse was SILENT —
    // the mirror "wrote" onto the edit file itself, so the real stock mirror silently went stale for
    // a full day while every persist reported success. See isToolkitAuthoredIlfPath.)
    if (stockIlfVfs === editedIlfVfsPath || isToolkitAuthoredIlfPath(stockIlfVfs)) {
      logf(
        `assemble: MIRROR SKIPPED — resolved stock path ${stockIlfVfs} is this building's own edit ` +
        `file, so mirroring would be a no-op and the real stock mirror would silently go stale. ` +
        `The building's stock template path is wrong (derived template recorded as stock?).`,
      );
    } else {
      stagedEntries.push(writeStockMirror(deps, stockIlfVfs, editedIlf));
      logf(`assemble: mirrored edited .ilf to STOCK path ${stockIlfVfs} (per-TEMPLATE — every instance of this layout shows the edit)`);
    }
  }

  return {
    rowIndex: resultRowIndex,
    cellName: resultCellName,
    derivedTemplateVfsPath,
    editedIlfVfsPath,
    derivedTemplateFilePath,
    editedIlfFilePath,
    stagedEntries,
  };
}
