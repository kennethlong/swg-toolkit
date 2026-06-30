// @vitest-environment node
/**
 * packages/renderer/src/services/changesetService.test.ts
 * Focused unit tests for setLiveVersion (Plan 04.3-04 Task 3).
 *
 * Acceptance criteria (VER-06 / D-08):
 *   (1) setLiveVersion(x) sets BOTH activeVersionId AND deployedVersionId to x atomically.
 *   (2) Both fields remain present in the persisted manifest (no field deletion).
 *   (3) setLiveVersion(null) sets both pointers to null (no version deployed).
 *   (4) setLiveVersion(BASELINE_ID) is valid even when BASELINE_ID is not in changesets[]
 *       (H2c: Baseline is a special pristine state that always exists conceptually).
 *
 * Uses real temp directories + real manifest reads/writes — no fs mocking needed.
 *
 * Source: 04.3-04-PLAN.md Task 3; 04.3-RESEARCH.md D-08 (single "live" pointer).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

import { useWorkspaceStore } from '../state/workspaceStore';
import {
  readManifest,
  writeManifest,
  seedBaseline,
  setLiveVersion,
} from './changesetService';
import { BASELINE_ID } from '@swg/contracts';
import type { SwgChangeset } from '@swg/contracts';

// ---------------------------------------------------------------------------
// Temp-dir lifecycle
// ---------------------------------------------------------------------------

let studioDir: string;

beforeEach(() => {
  studioDir = fs.mkdtempSync(path.join(os.tmpdir(), 'swg-setlive-test-'));
  // Point the workspace store at our temp studio dir so changesetService finds it.
  useWorkspaceStore.setState({ studioDir });
});

afterEach(() => {
  fs.rmSync(studioDir, { recursive: true, force: true });
  useWorkspaceStore.setState({ studioDir: null });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function addChangeset(id: string, parentId: string | null = BASELINE_ID): void {
  const m = readManifest(studioDir);
  const cs: SwgChangeset = {
    id,
    parentId,
    label: id,
    timestamp: new Date().toISOString(),
    sealedBy: 'manual',
    deltas: [],
  };
  m.changesets.push(cs);
  writeManifest(studioDir, m);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('setLiveVersion (D-08 single live pointer)', () => {
  it('(1) sets both activeVersionId and deployedVersionId to the target id atomically', () => {
    seedBaseline(studioDir);
    addChangeset('v1');

    setLiveVersion('v1');

    const m = readManifest(studioDir);
    expect(m.activeVersionId).toBe('v1');
    expect(m.deployedVersionId).toBe('v1');
    // Invariant: both pointers are EQUAL after setLiveVersion (D-08)
    expect(m.activeVersionId).toBe(m.deployedVersionId);
  });

  it('(2) both pointer fields are present in the persisted manifest (no field deletion)', () => {
    seedBaseline(studioDir);
    addChangeset('v2');

    setLiveVersion('v2');

    const m = readManifest(studioDir);
    expect(Object.prototype.hasOwnProperty.call(m, 'activeVersionId')).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(m, 'deployedVersionId')).toBe(true);
  });

  it('(3) setLiveVersion(null) sets both pointers to null', () => {
    seedBaseline(studioDir);
    addChangeset('v1');
    // First set to v1, then clear
    setLiveVersion('v1');
    setLiveVersion(null);

    const m = readManifest(studioDir);
    expect(m.activeVersionId).toBeNull();
    expect(m.deployedVersionId).toBeNull();
  });

  it('(4) setLiveVersion(BASELINE_ID) is valid (pristine state — always exists conceptually)', () => {
    seedBaseline(studioDir);

    // Baseline is always reachable; should not throw
    expect(() => setLiveVersion(BASELINE_ID)).not.toThrow();

    const m = readManifest(studioDir);
    expect(m.activeVersionId).toBe(BASELINE_ID);
    expect(m.deployedVersionId).toBe(BASELINE_ID);
  });
});
