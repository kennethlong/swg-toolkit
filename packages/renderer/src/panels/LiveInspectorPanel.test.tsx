/**
 * packages/renderer/src/panels/LiveInspectorPanel.test.tsx
 * Tests for the Detach control (05-07 Task 2, D-04 item 2).
 *
 * Mocking strategy: useChannelReader/useLiveService are plain local ES module
 * imports — vi.mock intercepts them normally, sidestepping the native addon
 * entirely (this component's own concern is conditional rendering + the
 * onClick wiring, not the channel-read/write plumbing those hooks own).
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { IDockviewPanelProps } from 'dockview';

vi.mock('../hooks/useChannelReader', () => ({
  useChannelReader: vi.fn(),
}));

const mockDetachUI = vi.hoisted(() => vi.fn());
vi.mock('../hooks/useLiveService', () => ({
  launchAndInjectUI: vi.fn(),
  attachToRunningUI: vi.fn(),
  detachUI: mockDetachUI,
}));

import { useLiveStore } from '../state/liveStore';
import LiveInspectorPanel from './LiveInspectorPanel';

function renderPanel(): void {
  render(<LiveInspectorPanel {...({} as IDockviewPanelProps)} />);
}

beforeEach(() => {
  mockDetachUI.mockClear();
  useLiveStore.getState().detach();
});

describe('LiveInspectorPanel Detach control (05-07 Task 2, D-04 item 2)', () => {
  it('does NOT render a Detach button when idle', () => {
    renderPanel();
    expect(screen.queryByText('Detach')).toBeNull();
  });

  it('renders a Detach button when attached, and clicking it calls detachUI()', () => {
    useLiveStore.getState().attachComplete(1234, 'Local\\SwgToolkitLive_panel');
    renderPanel();

    const button = screen.getByText('Detach');
    expect(button).toBeTruthy();
    fireEvent.click(button);
    expect(mockDetachUI).toHaveBeenCalledTimes(1);
  });
});
