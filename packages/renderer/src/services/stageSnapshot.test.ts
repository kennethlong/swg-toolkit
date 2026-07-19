/**
 * packages/renderer/src/services/stageSnapshot.test.ts
 * Covers the Live World Editor → deploy bridge: a saved `.ws` becomes a staged entry.
 */

import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { describe, it, expect, beforeEach } from 'vitest';

import { stageSnapshot, snapshotVirtualPath } from './stageSnapshot';
import { useStagingStore } from '../state/stagingStore';

describe('snapshotVirtualPath', () => {
  it('normalizes to lowercase snapshot/<scene>.ws', () => {
    expect(snapshotVirtualPath('Tatooine')).toBe('snapshot/tatooine.ws');
    expect(snapshotVirtualPath('naboo')).toBe('snapshot/naboo.ws');
  });
});

describe('stageSnapshot', () => {
  let tmpWs: string;
  const bytes = Buffer.from([0x57, 0x53, 0x00, 0x01, 0x02, 0xff, 0x10]);

  beforeEach(() => {
    useStagingStore.getState().clearAll();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stage-snap-test-'));
    tmpWs = path.join(dir, 'tatooine.ws');
    fs.writeFileSync(tmpWs, bytes);
  });

  it('copies the .ws to a stable temp and upserts a modify entry into staging', () => {
    const res = stageSnapshot({ wsFilePath: tmpWs, virtualPath: 'snapshot/Tatooine.ws' });

    // virtualPath normalized; sha is of the real bytes.
    const expectedSha = crypto.createHash('sha256').update(bytes).digest('hex');
    expect(res.virtualPath).toBe('snapshot/tatooine.ws');
    expect(res.sha256).toBe(expectedSha);

    // The staged temp is a real, stable copy of the saved bytes.
    expect(fs.existsSync(res.replacementFilePath)).toBe(true);
    expect(fs.readFileSync(res.replacementFilePath).equals(bytes)).toBe(true);

    // It landed in the staging store as a 'modify' entry (override the stock scene .ws).
    const entry = useStagingStore.getState().entries.find((e) => e.virtualPath === 'snapshot/tatooine.ws');
    expect(entry).toBeDefined();
    expect(entry!.action).toBe('modify');
    expect(entry!.replacementFilePath).toBe(res.replacementFilePath);
    expect(entry!.sha256).toBe(expectedSha);
  });

  it('honors an explicit add action', () => {
    stageSnapshot({ wsFilePath: tmpWs, virtualPath: 'snapshot/newscene.ws', action: 'add' });
    const entry = useStagingStore.getState().entries.find((e) => e.virtualPath === 'snapshot/newscene.ws');
    expect(entry?.action).toBe('add');
  });

  it('upserts by virtualPath — a re-import replaces the prior entry', () => {
    stageSnapshot({ wsFilePath: tmpWs, virtualPath: 'snapshot/tatooine.ws' });
    stageSnapshot({ wsFilePath: tmpWs, virtualPath: 'snapshot/tatooine.ws' });
    const matches = useStagingStore.getState().entries.filter((e) => e.virtualPath === 'snapshot/tatooine.ws');
    expect(matches).toHaveLength(1);
  });
});
