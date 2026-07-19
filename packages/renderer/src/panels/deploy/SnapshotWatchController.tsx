/**
 * packages/renderer/src/panels/deploy/SnapshotWatchController.tsx
 * Starts/stops the in-game world-edit watcher over the active project's lifetime.
 *
 * When a client-bound workspace is ready, resolve its loose override dir (where the agent's
 * wsSaveSnapshot writes) and watch it; tear down on close / project switch. Renders nothing.
 * Mounted once in App.tsx beside <SnapshotImportToast />.
 */

import { useEffect } from 'react';

import { useWorkspaceStore } from '../../state/workspaceStore';
import { useSnapshotWatchStore } from '../../state/snapshotWatchStore';
import { resolveOverrideDir } from '../../services/looseOverrideDeploy';
import { startSnapshotWatch, stopSnapshotWatch } from '../../services/snapshotWatcher';

export default function SnapshotWatchController(): null {
  const status = useWorkspaceStore((s) => s.status);
  const enabled = useSnapshotWatchStore((s) => s.enabled);

  useEffect(() => {
    // Opt-in (default OFF) AND a client-bound ready workspace with a resolvable override dir.
    if (enabled && status.kind === 'ready' && status.info.kind === 'client' && status.info.cfgPath && status.info.clientPath) {
      const overrideDir = resolveOverrideDir(status.info.cfgPath, status.info.clientPath);
      if (overrideDir) {
        startSnapshotWatch(overrideDir);
        return () => stopSnapshotWatch();
      }
    }
    // Disabled, or not a client-bound ready workspace (or no override dir) — no stale watch.
    stopSnapshotWatch();
    return undefined;
  }, [enabled, status]);

  return null;
}
