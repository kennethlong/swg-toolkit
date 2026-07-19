/**
 * packages/renderer/src/services/snapshotWatcher.ts
 * Watches the client's loose override dir for `.ws` files the in-game editor saved.
 *
 * `wsSaveSnapshot` (the agent) writes `<saveRoot>/snapshot/<scene>.ws`, and the save root
 * IS the winning loose SearchPath — the same directory the toolkit's loose deploy resolves
 * to (resolveOverrideDir). So a save lands inside the toolkit's own override dir; this
 * watcher notices it and queues it for confirm-then-import (snapshotImportStore).
 *
 * Single active watcher (one project open at a time). Existing `.ws` files are seeded at
 * start so a fresh open doesn't re-import scenes saved in a prior session — only post-start
 * content changes fire. Content is hashed (not just mtime) so duplicate fs.watch events and
 * no-op touches don't produce spurious prompts.
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

import { snapshotVirtualPath } from './stageSnapshot';
import { log } from './logService';
import { useSnapshotImportStore } from '../state/snapshotImportStore';

const SETTLE_MS = 400; // fs.watch fires several events per save; settle before hashing.

let watcher: fs.FSWatcher | null = null;
let watchedDir: string | null = null;
const lastSha = new Map<string, string>();
const settleTimers = new Map<string, ReturnType<typeof setTimeout>>();

function shaOf(filePath: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

/**
 * Begin watching `<overrideDir>/snapshot` for saved `.ws` files. Idempotent for the same
 * dir; switching dirs tears down the prior watch first.
 */
export function startSnapshotWatch(overrideDir: string): void {
  const snapDir = path.join(overrideDir, 'snapshot');
  if (watchedDir === snapDir && watcher) return;
  stopSnapshotWatch();

  try {
    fs.mkdirSync(snapDir, { recursive: true });
  } catch {
    /* dir may already exist / be unwritable — fs.watch below will surface real failures */
  }

  // Seed existing files so only post-start changes fire.
  try {
    for (const f of fs.readdirSync(snapDir)) {
      if (f.toLowerCase().endsWith('.ws')) {
        const p = path.join(snapDir, f);
        try {
          lastSha.set(p, shaOf(p));
        } catch {
          /* mid-write / vanished — ignore */
        }
      }
    }
  } catch {
    /* snapshot dir unreadable — nothing to seed */
  }

  try {
    watcher = fs.watch(snapDir, { persistent: false }, (_event, filename) => {
      if (!filename) return;
      const name = String(filename);
      if (!name.toLowerCase().endsWith('.ws')) return;
      const wsFilePath = path.join(snapDir, name);

      const prev = settleTimers.get(wsFilePath);
      if (prev) clearTimeout(prev);
      settleTimers.set(
        wsFilePath,
        setTimeout(() => {
          settleTimers.delete(wsFilePath);
          let sha: string;
          try {
            sha = shaOf(wsFilePath);
          } catch {
            return; // deleted or still being written
          }
          if (lastSha.get(wsFilePath) === sha) return; // content unchanged
          lastSha.set(wsFilePath, sha);

          const sceneId = path.basename(name, path.extname(name));
          useSnapshotImportStore.getState().add({
            wsFilePath,
            virtualPath: snapshotVirtualPath(sceneId),
            sceneId,
            sha256: sha,
            detectedAt: new Date().toISOString(),
          });
          log('info', 'log', `In-game world edit detected: ${sceneId}.ws`);
        }, SETTLE_MS),
      );
    });
    watchedDir = snapDir;
  } catch (e) {
    log('warn', 'log', `Snapshot watch failed for ${snapDir}: ${String((e as Error)?.message ?? e)}`);
    watcher = null;
    watchedDir = null;
  }
}

export function stopSnapshotWatch(): void {
  if (watcher) {
    try {
      watcher.close();
    } catch {
      /* already closed */
    }
    watcher = null;
  }
  for (const t of settleTimers.values()) clearTimeout(t);
  settleTimers.clear();
  lastSha.clear();
  watchedDir = null;
}
