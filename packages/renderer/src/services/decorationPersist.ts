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

import { parseIlf, serializeIlf, editNodeTransform, resolveRowIndex } from './ilf';
import { deriveBuildingTemplate, readInteriorLayoutFileName } from './buildingTemplate';

export interface DecorationEdit {
  /** The building's `.ws` node id (or any per-instance key) — names the derived template 1:1. */
  buildingInstanceId: string;
  /** VFS path of the stock building template, e.g. object/building/tatooine/shared_cantina_tatooine.iff. */
  buildingTemplateVfsPath: string;
  /** Cell the decoration lives in (matches a POB portal cell + the `.ilf` cellName). */
  cellName: string;
  /** The moved decoration's object template name. */
  decorationTemplateName: string;
  /** The decoration's o2p at PICK time (before the move) — used to resolve its `.ilf` row. */
  originalO2p: number[];
  /** The decoration's o2p AFTER the move — written into the `.ilf`. */
  newO2p: number[];
}

export interface DecorationPersistDeps {
  /** Read stock/override bytes for a VFS path from the mounted TRE (readVfsEntryBytes). Throws if absent. */
  readVfs: (vfsPath: string) => Buffer;
  /** Absolute loose override dir root (== the client's winning SearchPath). */
  overrideDir: string;
  /** Write bytes to an absolute path (creating parents). Defaults to fs. Injected in tests. */
  writeFile?: (absPath: string, bytes: Buffer) => void;
}

export interface DecorationPersistResult {
  /** The `.ilf` row that was edited (within-cell index). */
  rowIndex: number;
  /** VFS path of the derived template — feed this to wsSetNodeTemplateName(nodeId, this). */
  derivedTemplateVfsPath: string;
  /** VFS path of the edited `.ilf` the derived template points at. */
  editedIlfVfsPath: string;
  derivedTemplateFilePath: string;
  editedIlfFilePath: string;
  /** The two new loose files to stage (both 'add' — new instance-scoped names, shadow no stock asset). */
  stagedEntries: { virtualPath: string; filePath: string; action: 'add' }[];
}

function sanitizeId(id: string): string {
  return id.replace(/[^a-z0-9_]/gi, '_').toLowerCase() || 'x';
}

function defaultWrite(absPath: string, bytes: Buffer): void {
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, bytes);
}

/**
 * Assemble the two loose override files for one decoration move. Returns the derived template's VFS
 * path (for the agent's wsSetNodeTemplateName) + the entries to stage. Throws if the picked
 * decoration can't be resolved in the stock `.ilf` (fail closed — never persist the wrong object).
 */
export function assembleDecorationEdit(edit: DecorationEdit, deps: DecorationPersistDeps): DecorationPersistResult {
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

  // Base .ilf: the accumulated edited copy if a prior edit of THIS instance exists, else the stock.
  // (readVfs sees the loose override dir, so once written the edited copy resolves — repeat edits
  // accumulate instead of reverting each other.)
  let baseIlf: Buffer;
  try {
    baseIlf = deps.readVfs(editedIlfVfsPath);
  } catch {
    baseIlf = deps.readVfs(stockIlfVfs);
  }
  const nodes = parseIlf(baseIlf);

  const rowIndex = resolveRowIndex(nodes, edit.cellName, edit.decorationTemplateName, edit.originalO2p);
  if (rowIndex === null) {
    throw new Error(
      `decorationPersist: could not resolve picked ${edit.decorationTemplateName} in cell ${edit.cellName}`,
    );
  }

  const editedIlf = serializeIlf(editNodeTransform(nodes, edit.cellName, rowIndex, edit.newO2p));
  const derivedTemplate = deriveBuildingTemplate(stockIff, editedIlfVfsPath);

  const editedIlfFilePath = path.join(deps.overrideDir, editedIlfVfsPath);
  const derivedTemplateFilePath = path.join(deps.overrideDir, derivedTemplateVfsPath);
  write(editedIlfFilePath, editedIlf);
  write(derivedTemplateFilePath, derivedTemplate);

  return {
    rowIndex,
    derivedTemplateVfsPath,
    editedIlfVfsPath,
    derivedTemplateFilePath,
    editedIlfFilePath,
    stagedEntries: [
      { virtualPath: editedIlfVfsPath, filePath: editedIlfFilePath, action: 'add' },
      { virtualPath: derivedTemplateVfsPath, filePath: derivedTemplateFilePath, action: 'add' },
    ],
  };
}
