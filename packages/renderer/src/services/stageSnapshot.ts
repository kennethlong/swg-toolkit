/**
 * packages/renderer/src/services/stageSnapshot.ts
 * Live World Editor → deploy pipeline bridge.
 *
 * Turns a `.ws` the in-game editor saved (via the agent's `wsSaveSnapshot`, written to
 * the client's loose SearchPath) into a normal staged changeset entry — so it flows
 * through the SAME stage → seal → deploy machinery as an STF or datatable edit
 * (mirrors StfStringsEditor.tsx:332-348 / DatatableGridEditor's materialize-to-temp
 * pattern). Once staged it appears in Working changes, seals into a version on Save,
 * and deploys via the loose/cfg model in syncLiveToVersion.
 *
 * This function is deliberately I/O-only and decision-independent: it takes an explicit
 * on-disk `.ws` path + its VFS virtual path, so it works regardless of HOW the toolkit
 * located the saved file (agent-reported path vs. scanning the override dir — the open
 * flow decision handled by the caller).
 */

import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';

import type { StagingAction } from '@swg/contracts';

import { useStagingStore } from '../state/stagingStore';

/** World snapshots live under `snapshot/<sceneId>.ws` in the TRE namespace. */
export function snapshotVirtualPath(sceneId: string): string {
  return `snapshot/${sceneId}.ws`.replace(/\\/g, '/').toLowerCase();
}

export interface StageSnapshotParams {
  /** Absolute path to the `.ws` the agent just saved (under the client's save root). */
  wsFilePath: string;
  /**
   * VFS virtual path for the entry (archive-relative, forward-slashes, lowercase),
   * e.g. `snapshot/tatooine.ws`. Use snapshotVirtualPath(sceneId) to build it.
   */
  virtualPath: string;
  /**
   * 'modify' when overriding the stock scene `.ws` (the usual case — the base TRE
   * already ships one); 'add' for a scene the base game doesn't contain. Default 'modify'.
   */
  action?: StagingAction;
}

export interface StageSnapshotResult {
  virtualPath: string;
  sha256: string;
  /** The stable temp copy the seal/pack pipeline reads from. */
  replacementFilePath: string;
}

/**
 * Copy the saved `.ws` into a stable staging temp and add it to the staging store.
 * The copy insulates the staged bytes from a later in-game re-save overwriting the
 * client's live loose file before the version is sealed (drift), matching how the
 * editors snapshot their serialized bytes to a temp before addEntry.
 */
export function stageSnapshot(params: StageSnapshotParams): StageSnapshotResult {
  const virtualPath = params.virtualPath.replace(/\\/g, '/').toLowerCase();

  const buf = fs.readFileSync(params.wsFilePath);

  const tmpDir = path.join(os.tmpdir(), 'swg-toolkit-editor-stage');
  fs.mkdirSync(tmpDir, { recursive: true });
  const safeName = virtualPath.replace(/[\\/:*?"<>|]/g, '_');
  const tmpPath = path.join(tmpDir, `${Date.now()}-${safeName}`);
  fs.writeFileSync(tmpPath, buf);

  const sha256 = crypto.createHash('sha256').update(buf).digest('hex');

  useStagingStore.getState().addEntry({
    virtualPath,
    action: params.action ?? 'modify',
    replacementFilePath: tmpPath,
    sha256,
  });

  return { virtualPath, sha256, replacementFilePath: tmpPath };
}
