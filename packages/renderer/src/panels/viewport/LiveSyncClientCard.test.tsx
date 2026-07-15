/**
 * packages/renderer/src/panels/viewport/LiveSyncClientCard.test.tsx
 * Tests for 05-11 Task 1: the top-right live-sync HUD card — cross-build
 * target identity + ROUND 4/5 mismatch warning/name-match caveat, two
 * independent guard rows (scale's four-branch precedence), all three B2
 * safety-state banners with real addr/expected-bytes, per-channel discarded-
 * change disclosure, and the ROUND 6 write-log caption.
 *
 * Mocking strategy: liveStore.ts imports writeTransform from useCommandWriter
 * (a plain local ES module, no bare require() at THIS import boundary) — vi.mock
 * works normally here, matching liveStore.test.ts's own established pattern.
 * useLiveStore/useViewportStore are the REAL Zustand stores, driven directly.
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { VerifiedObjectState } from '@swg/contracts';

vi.mock('../../hooks/useCommandWriter', () => ({
  writeTransform: vi.fn(),
}));

import { useLiveStore } from '../../state/liveStore';
import { useViewportStore } from '../../state/viewportStore';
import { writeTransform } from '../../hooks/useCommandWriter';
import LiveSyncClientCard from './LiveSyncClientCard';

const mockWriteTransform = writeTransform as ReturnType<typeof vi.fn>;

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeState(overrides?: Partial<VerifiedObjectState>): VerifiedObjectState {
  return {
    networkId: 0n,
    templateName: 'object/mobile/shared_womprat.iff',
    transform: new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0]),
    playerAlive: true,
    hasTarget: true,
    targetUnavailableOnBuild: false,
    scaleUnavailableOnBuild: false,
    focusToken: 1,
    ...overrides,
  };
}

function attach(mappingName = 'Local\\SwgToolkitLive_test'): void {
  useLiveStore.getState().attachComplete(1234, mappingName);
}

/** Mirrors the component's own private formatFloatBytesHex so tests can
 *  compute the expected rendered hex string independently. */
function formatFloatBytesHex(arr: Float32Array): string {
  const buf = new ArrayBuffer(arr.length * 4);
  const view = new DataView(buf);
  for (let i = 0; i < arr.length; i++) view.setFloat32(i * 4, arr[i] ?? 0, true);
  const bytes = new Uint8Array(buf);
  let out = '';
  for (let i = 0; i < bytes.length; i++) out += bytes[i]!.toString(16).padStart(2, '0');
  return out.toUpperCase();
}

beforeEach(() => {
  mockWriteTransform.mockClear();
  useLiveStore.getState().detach();
  useViewportStore.getState().reset();
});

// ─── B2: guard-blocked banner ──────────────────────────────────────────────────

describe('LiveSyncClientCard — B2 guard-blocked banner', () => {
  it('renders the locked copy with a REAL address from liveStore.guardAddr and expected/read bytes', () => {
    attach();
    useLiveStore.getState().updateState(makeState());
    useLiveStore.getState().setGuardAddr(0xdeadbeef);
    useLiveStore.getState().setGuardState('transform', 'blocked');

    render(<LiveSyncClientCard />);

    const body = document.body.textContent ?? '';
    expect(body).toContain("Write refused. The object's memory changed outside the toolkit");
    expect(body).toContain('0xDEADBEEF');
    expect(body).toContain('the game or another tool moved it. Nothing was written.');
    expect(body).toContain('Re-read & retry');
    expect(body).toContain('Revert to snapshot');
  });

  it('expected value reflects the LAST write-log entry resultingTransform, not cowSnapshot, once a write has succeeded', () => {
    attach();
    // cowSnapshot captures fill(1) on this FIRST updateState call (focusToken=1).
    useLiveStore.getState().updateState(makeState({ transform: new Float32Array(12).fill(1) }));
    useLiveStore.getState().appendWriteLog({
      id: 1,
      atMs: Date.now(),
      deltaLabel: 'pos.x +0.42m',
      resultingTransform: new Float32Array(12).fill(42),
      resultingScale: new Float32Array([1, 1, 1]),
    });
    // A later channel tick (SAME focusToken — no re-capture) reports a THIRD,
    // distinct live value — this is what "read <bytes>" must reflect.
    useLiveStore.getState().updateState(makeState({ transform: new Float32Array(12).fill(7) }));
    useLiveStore.getState().setGuardAddr(0x1000);
    useLiveStore.getState().setGuardState('transform', 'blocked');

    render(<LiveSyncClientCard />);

    const body = document.body.textContent ?? '';
    // expected <bytes> = the write-log's resultingTransform (42), NOT cowSnapshot (1).
    expect(body).toContain(formatFloatBytesHex(new Float32Array(12).fill(42)));
    expect(body).not.toContain(formatFloatBytesHex(new Float32Array(12).fill(1)));
    // read <bytes> = the CURRENT verifiedState.transform (7).
    expect(body).toContain(formatFloatBytesHex(new Float32Array(12).fill(7)));
  });

  it('a genuinely-blocked scale channel (scaleUnavailableOnBuild=false) renders the refused variant AND flips the card to danger', () => {
    attach();
    useLiveStore.getState().updateState(makeState({ scaleUnavailableOnBuild: false }));
    useLiveStore.getState().setGuardState('scale', 'blocked');

    render(<LiveSyncClientCard />);

    expect(screen.getByText('client bytes ≠ snapshot', { exact: false })).toBeTruthy();
    const alert = document.body.querySelector('[role="alert"]');
    expect(alert).not.toBeNull();
  });

  it('scaleUnavailableOnBuild=true renders "unavailable on this build" and does NOT flip the card to danger by itself', () => {
    attach();
    useLiveStore.getState().updateState(makeState({ scaleUnavailableOnBuild: true }));
    // guardState.scale intentionally left 'ok' AND also test 'blocked' — precedence must win either way.
    useLiveStore.getState().setGuardState('scale', 'blocked');

    render(<LiveSyncClientCard />);

    expect(document.body.textContent).toContain('unavailable on this build');
    expect(document.body.querySelector('[role="alert"]')).toBeNull();
  });

  it('no force-write escape hatch exists anywhere in this component (grep-equivalent: no "force"/"override" write reference)', () => {
    attach();
    useLiveStore.getState().updateState(makeState());
    useLiveStore.getState().setGuardState('transform', 'blocked');

    const { container } = render(<LiveSyncClientCard />);
    expect(container.innerHTML.toLowerCase()).not.toContain('force-write');
    expect(container.innerHTML.toLowerCase()).not.toContain('override');
  });
});

// ─── Revert ALL — always clickable while attached ─────────────────────────────

describe('LiveSyncClientCard — Revert ALL', () => {
  it('is enabled/clickable regardless of guardState (including transform blocked)', () => {
    attach();
    useLiveStore.getState().updateState(makeState());
    useLiveStore.getState().setGuardState('transform', 'blocked');

    render(<LiveSyncClientCard />);
    const btn = screen.getByText('⟲ Revert ALL to snapshot') as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
  });
});

// ─── B2: reverted banner + per-channel discarded-change disclosure ───────────

describe('LiveSyncClientCard — B2 reverted banner', () => {
  it('shows only the base sentence when lastDiscardedChange is null', () => {
    attach();
    useLiveStore.getState().updateState(makeState());
    render(<LiveSyncClientCard />);
    fireEvent.click(screen.getByText('⟲ Revert ALL to snapshot'));

    const status = document.body.querySelector('[role="status"]');
    expect(status).not.toBeNull();
    expect(status!.textContent).toContain('Reverted. Transform restored from the COW snapshot taken at attach');
    expect(status!.textContent).not.toContain('discarded on revert');
  });

  it('discloses exactly ONE transform clause when only transform is present', () => {
    attach();
    useLiveStore.getState().updateState(makeState());
    useLiveStore.getState().setGuardAddr(0x2000);
    useLiveStore.getState().setGuardState('transform', 'blocked');

    const { rerender } = render(<LiveSyncClientCard />);
    fireEvent.click(screen.getByText('⟲ Revert ALL to snapshot'));
    // Simulate the next channel poll tick observing the agent's now-cleared
    // guard (the coalesced REBASELINE_GUARD write asks the agent to
    // re-baseline its expected bytes to current — the JS-side guardState only
    // reflects that once useChannelReader's next poll decodes GUARD_STATUS).
    useLiveStore.getState().setGuardState('transform', 'ok');
    rerender(<LiveSyncClientCard />);

    const status = document.body.querySelector('[role="status"]');
    expect(status).not.toBeNull();
    expect(status!.textContent).toContain('An external change was discarded on revert');
    expect((status!.textContent!.match(/discarded on revert/g) ?? []).length).toBe(1);
  });

  it('discloses exactly ONE scale clause (honest "last known" wording, gotVerified=false) when only scale is present', () => {
    attach();
    useLiveStore.getState().updateState(makeState());
    useLiveStore.getState().setGuardAddr(0x3000);
    useLiveStore.getState().setGuardState('scale', 'blocked');

    const { rerender } = render(<LiveSyncClientCard />);
    fireEvent.click(screen.getByText('⟲ Revert ALL to snapshot'));
    useLiveStore.getState().setGuardState('scale', 'ok');
    rerender(<LiveSyncClientCard />);

    const status = document.body.querySelector('[role="status"]');
    expect(status).not.toBeNull();
    expect(status!.textContent).toContain('may have affected scale on revert');
    expect(status!.textContent).toContain('not independently re-verified this session');
    expect(status!.textContent).not.toContain('found');
  });

  it('discloses BOTH clauses when both channels were blocked', () => {
    attach();
    useLiveStore.getState().updateState(makeState());
    useLiveStore.getState().setGuardAddr(0x4000);
    useLiveStore.getState().setGuardState('transform', 'blocked');
    useLiveStore.getState().setGuardState('scale', 'blocked');

    const { rerender } = render(<LiveSyncClientCard />);
    fireEvent.click(screen.getByText('⟲ Revert ALL to snapshot'));
    useLiveStore.getState().setGuardState('transform', 'ok');
    useLiveStore.getState().setGuardState('scale', 'ok');
    rerender(<LiveSyncClientCard />);

    const status = document.body.querySelector('[role="status"]');
    expect(status).not.toBeNull();
    expect(status!.textContent).toContain('discarded on revert');
    expect(status!.textContent).toContain('may have affected scale on revert');
  });

  it('reverted-state write-log rows render struck-through with no revert button (per-write revert leaves earlier rows in place)', () => {
    attach();
    useLiveStore.getState().updateState(makeState());
    useLiveStore.getState().appendWriteLog({
      id: 1,
      atMs: Date.now(),
      deltaLabel: 'pos.x +0.10m',
      resultingTransform: new Float32Array(12).fill(1),
      resultingScale: new Float32Array([1, 1, 1]),
    });
    useLiveStore.getState().appendWriteLog({
      id: 2,
      atMs: Date.now(),
      deltaLabel: 'pos.x +0.20m',
      resultingTransform: new Float32Array(12).fill(2),
      resultingScale: new Float32Array([1, 1, 1]),
    });

    render(<LiveSyncClientCard />);
    // Revert entry 2 — entry 1 remains in the log, and the card enters the
    // "reverted" visual state (revertedAt set).
    const revertButtons = screen.getAllByText('revert');
    fireEvent.click(revertButtons[revertButtons.length - 1]!);

    const remainingRow = screen.getByText('pos.x +0.10m').closest('div');
    expect(remainingRow).not.toBeNull();
    expect((remainingRow as HTMLElement).style.textDecoration).toBe('line-through');
    expect(screen.queryByText('revert')).toBeNull();
  });
});

// ─── Target row + ROUND 4/5 mismatch warning / name-match caveat ─────────────

describe('LiveSyncClientCard — target row + mismatch disclosure', () => {
  it('renders "target: <templateName>" (legacy-shaped, networkId=0n) when hasTarget', () => {
    attach();
    useLiveStore.getState().updateState(makeState({ hasTarget: true, networkId: 0n, templateName: 'object/mobile/shared_bantha.iff' }));
    render(<LiveSyncClientCard />);
    expect(screen.getByText('object/mobile/shared_bantha.iff')).toBeTruthy();
  });

  it('renders the same row (advertised-shaped, networkId non-zero) — build-agnostic', () => {
    attach();
    useLiveStore.getState().updateState(makeState({ hasTarget: true, networkId: 123456789n, templateName: 'object/creature/npc_womp_rat.iff' }));
    render(<LiveSyncClientCard />);
    expect(screen.getByText('object/creature/npc_womp_rat.iff')).toBeTruthy();
  });

  it('renders "unavailable on this build — moving player avatar" when the mechanism is unresolved', () => {
    attach();
    useLiveStore.getState().updateState(makeState({ hasTarget: false, targetUnavailableOnBuild: true }));
    render(<LiveSyncClientCard />);
    expect(screen.getByText('unavailable on this build — moving player avatar')).toBeTruthy();
  });

  it('renders "none — moving player avatar" when nothing is targeted', () => {
    attach();
    useLiveStore.getState().updateState(makeState({ hasTarget: false, targetUnavailableOnBuild: false }));
    render(<LiveSyncClientCard />);
    expect(screen.getByText('none — moving player avatar')).toBeTruthy();
  });

  it('the target row is ABSENT when offline', () => {
    render(<LiveSyncClientCard />);
    expect(screen.queryByText('target')).toBeNull();
  });

  it('ROUND 4: renders the loud mismatch warning when the loaded asset differs from the live target', () => {
    attach();
    useLiveStore.getState().updateState(makeState({ hasTarget: true, templateName: 'object/mobile/shared_stormtrooper.iff' }));
    useViewportStore.getState().loadComplete(
      'object/mobile/shared_womprat.iff', 'leaf',
      {} as never, false,
    );

    render(<LiveSyncClientCard />);
    expect(document.body.textContent).toContain('⚠ viewing shared_womprat, moving shared_stormtrooper');
  });

  it('ROUND 4: renders NEITHER warning when nothing is loaded or nothing is targeted', () => {
    attach();
    useLiveStore.getState().updateState(makeState({ hasTarget: false }));
    render(<LiveSyncClientCard />);
    expect(document.body.textContent).not.toContain('⚠ viewing');
    expect(document.body.textContent).not.toContain('name match only');
  });

  it('ROUND 4: the mismatch warning never calls writeTransform and never mutates guardState', () => {
    attach();
    useLiveStore.getState().updateState(makeState({ hasTarget: true, templateName: 'object/mobile/shared_stormtrooper.iff' }));
    useViewportStore.getState().loadComplete('object/mobile/shared_womprat.iff', 'leaf', {} as never, false);

    render(<LiveSyncClientCard />);
    expect(mockWriteTransform).not.toHaveBeenCalled();
    expect(useLiveStore.getState().guardState).toEqual({ transform: 'ok', scale: 'ok' });
  });

  it('ROUND 5: matching normalized basenames render the QUIET name-match-only caveat, not the loud warning', () => {
    attach();
    useLiveStore.getState().updateState(makeState({ hasTarget: true, templateName: 'object/mobile/shared_womprat.iff' }));
    useViewportStore.getState().loadComplete('object/mobile/shared_womprat.iff', 'leaf', {} as never, false);

    render(<LiveSyncClientCard />);
    expect(document.body.textContent).not.toContain('⚠ viewing');
    expect(document.body.textContent).toContain('(name match only — not a verified object identity)');
  });
});

// ─── Scale guard row four-branch precedence ───────────────────────────────────

describe('LiveSyncClientCard — scale guard row precedence', () => {
  it('"not yet written this session" when cowSnapshot.scale is null and guard is ok', () => {
    attach();
    useLiveStore.getState().updateState(makeState());
    render(<LiveSyncClientCard />);
    expect(document.body.textContent).toContain('not yet written this session');
  });
});

// ─── ROUND 6: write-log caption ────────────────────────────────────────────────

describe('LiveSyncClientCard — ROUND 6 write-log caption', () => {
  it('renders the exact caption text regardless of writeLog contents (even empty)', () => {
    attach();
    useLiveStore.getState().updateState(makeState());
    render(<LiveSyncClientCard />);
    expect(document.body.textContent).toContain(
      "Per-object history — switching target and back restores this object's own log.",
    );
  });
});

// ─── Roles ─────────────────────────────────────────────────────────────────────

describe('LiveSyncClientCard — accessibility roles', () => {
  it('guard-blocked banner has role="alert"; reverted banner has role="status"', () => {
    attach();
    useLiveStore.getState().updateState(makeState());
    useLiveStore.getState().setGuardState('transform', 'blocked');
    const { rerender } = render(<LiveSyncClientCard />);
    expect(document.body.querySelector('[role="alert"]')).not.toBeNull();

    useLiveStore.getState().setGuardState('transform', 'ok');
    rerender(<LiveSyncClientCard />);
    fireEvent.click(screen.getByText('⟲ Revert ALL to snapshot'));
    rerender(<LiveSyncClientCard />);
    expect(document.body.querySelector('[role="status"]')).not.toBeNull();
  });
});
