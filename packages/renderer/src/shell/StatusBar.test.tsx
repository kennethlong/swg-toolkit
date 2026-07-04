/**
 * packages/renderer/src/shell/StatusBar.test.tsx
 * Component tests for StatusBar — sketch 008 gaps S6 + S7 + P9 scan message.
 *
 * Tests:
 *   1 — S7: 'live: vN — label' renders when manifest has a deployedVersionId
 *   2 — S7: no 'deployed:' text in non-comment rendered output (old hashed indicator gone)
 *   3 — S6: '.sb-state' element renders when activePanelId is set in dockStateStore
 *   4 — P9: scan message from clientScanStore is rendered when present
 *   5 — KEEP: existing diagnostic chips (addon, SAB, zero-copy) still render
 *
 * Mocking strategy:
 *   - @swg/native-core: mocked to prevent load errors in jsdom
 *   - Worker: stubbed globally (not available in Node/jsdom)
 *   - SAB: mocked allocateSab returns plain ArrayBuffer (tests don't need real SAB)
 *
 * Source: 04.3-09-PLAN.md Task 2.
 */

import React from 'react';
import { render, screen, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { SwgChangeset, WorkspaceChangesetManifest } from '@swg/contracts';

// ─── Mock native-core BEFORE importing StatusBar ────────────────────────────
// vi.mock is hoisted by Vitest to run before imports.

vi.mock('@swg/native-core', () => ({
  hello:       () => 'hello-from-mock',
  allocateSab: () => new ArrayBuffer(8),   // jsdom: plain buffer
  writeSab:    () => {},
  readSab:     () => 0,
}));

// ─── Stub Worker (not available in Node/jsdom) ───────────────────────────────

let origWorker: typeof Worker | undefined;
beforeEach(() => {
  origWorker = (global as Record<string, unknown>)['Worker'] as typeof Worker | undefined;
  (global as Record<string, unknown>)['Worker'] = class StubWorker {
    postMessage() {}
    terminate() {}
    set onmessage(_: unknown) {}
    set onerror(_: unknown) {}
  };
  // Stub URL.createObjectURL / revokeObjectURL used in step 4
  if (!URL.createObjectURL) {
    (URL as unknown as Record<string, unknown>).createObjectURL = () => 'blob:stub';
    (URL as unknown as Record<string, unknown>).revokeObjectURL = () => {};
  }
});
afterEach(() => {
  (global as Record<string, unknown>)['Worker'] = origWorker;
});

// ─── Import after mocks ───────────────────────────────────────────────────────

import StatusBar from './StatusBar';
import { useChangesetStore }  from '../state/changesetStore';
import { useDockStateStore }  from '../state/dockStateStore';
import { useClientScanStore } from '../state/clientScanStore';
import { useViewportStore }   from '../state/viewportStore';
import { BASELINE_ID }        from '@swg/contracts';
import type { MeshParseResult } from '@swg/contracts';
import type { AppearanceResolutionResult } from '../panels/viewport/resolver/appearanceResolver';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildChangeset(idx: number, label: string): SwgChangeset {
  return {
    id:        `cs-${idx}`,
    parentId:  idx === 0 ? null : `cs-${idx - 1}`,
    label,
    timestamp: `2026-06-2${idx}T12:00:00.000Z`,
    deltas:    [],
    sealedBy:  'manual',
  } as SwgChangeset;
}

function buildManifest(
  changesets: SwgChangeset[],
  deployedVersionId: string | null,
): WorkspaceChangesetManifest {
  return { activeVersionId: null, deployedVersionId, changesets };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('StatusBar — S7: live: vN indicator', () => {

  beforeEach(() => {
    // Reset stores
    useChangesetStore.setState({
      manifest: { activeVersionId: null, deployedVersionId: null, changesets: [] },
      sealStatus: { kind: 'idle' },
    });
    useDockStateStore.setState({ activePanelId: null, dockWidth: 290 });
    useClientScanStore.setState({ message: null });
  });

  it('Test 1: renders "live: vN — label" when deployedVersionId is set', async () => {
    const cs = buildChangeset(0, 'Buffed DL-44 damage');
    useChangesetStore.setState({
      manifest: buildManifest([cs], cs.id),
      sealStatus: { kind: 'idle' },
    });

    await act(async () => {
      render(<StatusBar />);
    });

    // Should show "live: " followed by "v1 — Buffed DL-44 damage"
    const liveEl = document.body.querySelector('[style*="color: var(--color-info)"], [style*="color:var(--color-info)"]');
    const bodyText = document.body.textContent ?? '';
    expect(bodyText).toContain('live:');
    expect(bodyText).toContain('v1');
    expect(bodyText).toContain('Buffed DL-44 damage');
  });

  it('Test 2: old "deployed:" hashed indicator is NOT present in rendered output', async () => {
    const cs = buildChangeset(0, 'Test changeset');
    useChangesetStore.setState({
      manifest: buildManifest([cs], cs.id),
      sealStatus: { kind: 'idle' },
    });

    await act(async () => {
      render(<StatusBar />);
    });

    // The old "deployed: <hash>" pattern must be absent
    expect(document.body.textContent).not.toContain('deployed:');
  });

  it('Test 1b: shows "live: baseline" for BASELINE_ID', async () => {
    const baseline = buildChangeset(0, 'Baseline');
    // Simulate BASELINE_ID
    useChangesetStore.setState({
      manifest: buildManifest([baseline], BASELINE_ID),
      sealStatus: { kind: 'idle' },
    });

    await act(async () => {
      render(<StatusBar />);
    });

    expect(document.body.textContent).toContain('live:');
    expect(document.body.textContent).toContain('baseline');
  });

});

describe('StatusBar — S6: sb-state chip', () => {

  beforeEach(() => {
    useChangesetStore.setState({
      manifest: { activeVersionId: null, deployedVersionId: null, changesets: [] },
      sealStatus: { kind: 'idle' },
    });
    useClientScanStore.setState({ message: null });
  });

  it('Test 3: sb-state element renders "Deploy active · dock 440px" when deploy is active', async () => {
    useDockStateStore.setState({ activePanelId: 'deploy', dockWidth: 440 });

    await act(async () => {
      render(<StatusBar />);
    });

    const sbState = document.body.querySelector('.sb-state');
    expect(sbState).not.toBeNull();
    expect((sbState as HTMLElement).textContent).toContain('Deploy active');
    expect((sbState as HTMLElement).textContent).toContain('440px');
  });

  it('Test 3b: sb-state renders "Inspect active · dock 290px" when inspector is active', async () => {
    useDockStateStore.setState({ activePanelId: 'inspector', dockWidth: 290 });

    await act(async () => {
      render(<StatusBar />);
    });

    const sbState = document.body.querySelector('.sb-state');
    expect(sbState).not.toBeNull();
    expect((sbState as HTMLElement).textContent).toContain('Inspect active');
    expect((sbState as HTMLElement).textContent).toContain('290px');
  });

  it('Test 3c: sb-state element is NOT rendered when activePanelId is null', async () => {
    useDockStateStore.setState({ activePanelId: null, dockWidth: 290 });

    await act(async () => {
      render(<StatusBar />);
    });

    // No .sb-state chip when dock is idle
    expect(document.body.querySelector('.sb-state')).toBeNull();
  });

});

describe('StatusBar — P9: first-run scan message', () => {

  beforeEach(() => {
    useChangesetStore.setState({
      manifest: { activeVersionId: null, deployedVersionId: null, changesets: [] },
      sealStatus: { kind: 'idle' },
    });
    useDockStateStore.setState({ activePanelId: null, dockWidth: 290 });
  });

  it('Test 4: scan message from clientScanStore is rendered when present', async () => {
    useClientScanStore.setState({ message: 'detected: SWG Infinity ✓ · SWGEmu ✗' });

    await act(async () => {
      render(<StatusBar />);
    });

    expect(document.body.textContent).toContain('detected: SWG Infinity');
    expect(document.body.textContent).toContain('SWGEmu ✗');
  });

  it('Test 4b: scan message is NOT rendered when null', async () => {
    useClientScanStore.setState({ message: null });

    await act(async () => {
      render(<StatusBar />);
    });

    // Should not see "detected:" when message is null
    expect(document.body.textContent).not.toContain('detected:');
  });

});

describe('StatusBar — KEEP: existing diagnostic chips', () => {

  beforeEach(() => {
    useChangesetStore.setState({
      manifest: { activeVersionId: null, deployedVersionId: null, changesets: [] },
      sealStatus: { kind: 'idle' },
    });
    useDockStateStore.setState({ activePanelId: null, dockWidth: 290 });
    useClientScanStore.setState({ message: null });
  });

  it('Test 5: addon chip still present', async () => {
    await act(async () => {
      render(<StatusBar />);
    });
    expect(document.body.textContent).toContain('addon:');
  });

  it('Test 5b: pnpm contracts chip still present', async () => {
    await act(async () => {
      render(<StatusBar />);
    });
    expect(document.body.textContent).toContain('pnpm');
  });

});

describe('StatusBar — 04.4-03: live mesh name / vert-count chip', () => {

  beforeEach(() => {
    useChangesetStore.setState({
      manifest: { activeVersionId: null, deployedVersionId: null, changesets: [] },
      sealStatus: { kind: 'idle' },
    });
    useDockStateStore.setState({ activePanelId: null, dockWidth: 290 });
    useClientScanStore.setState({ message: null });
    useViewportStore.getState().reset();
  });

  it('Test 6: idle state renders "—" / "—" for the mesh chip (never the old hardcoded landspeeder text)', async () => {
    await act(async () => {
      render(<StatusBar />);
    });

    expect(document.body.textContent).not.toContain('shared_landspeeder.msh');
    expect(document.body.textContent).not.toContain('4,812 verts');
    expect(document.body.textContent).toContain('— verts');
  });

  it('Test 7: after loadComplete, renders the loaded filename and summed vert count', async () => {
    const meshStub = {
      shaderGroups: [{ vertexCount: 100 }, { vertexCount: 50 }],
    } as unknown as MeshParseResult;
    const resolutionStub = {} as AppearanceResolutionResult;

    useViewportStore.getState().loadComplete('foo.msh', 'leaf', resolutionStub, false, meshStub);

    await act(async () => {
      render(<StatusBar />);
    });

    expect(document.body.textContent).toContain('foo.msh');
    expect(document.body.textContent).toContain('150 verts');
  });

});
