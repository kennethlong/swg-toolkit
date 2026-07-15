/**
 * packages/renderer/src/panels/editors/shared/GateBar.test.tsx
 * Covers the 4-state gate machine (05-06-PLAN.md Task 1 acceptance criteria) and FailBanner's
 * role="alert" contract.
 */

import React from 'react';
import { render } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import GateBar from './GateBar';
import FailBanner from './FailBanner';

const LABELS = {
  notRunLabel: 'round-trip gate: not run',
  runningLabel: 'round-trip gate: re-encoding DTII…',
  passLabel: '✓ byte-exact round-trip (1234 B)',
  failLabel: '✗ round-trip mismatch — not staged',
};

describe('GateBar', () => {
  it('not-run state renders the neutral caption, no staged chip', () => {
    const { getByText, queryByTestId } = render(<GateBar state="not-run" {...LABELS} />);
    expect(getByText(LABELS.notRunLabel)).toBeTruthy();
    expect(queryByTestId('gate-staged-chip')).toBeFalsy();
  });

  it('running state renders a dashed-border pill with the running caption', () => {
    const { getByText, container } = render(<GateBar state="running" {...LABELS} />);
    expect(getByText(LABELS.runningLabel)).toBeTruthy();
    expect(container.querySelector('span[data-dashed-border="true"]')).toBeTruthy();
  });

  it('pass state renders the pass caption AND the adjacent staged chip', () => {
    const { getByText, getByTestId } = render(<GateBar state="pass" {...LABELS} />);
    expect(getByText(LABELS.passLabel)).toBeTruthy();
    expect(getByTestId('gate-staged-chip').textContent).toContain('staged in working changes');
  });

  it('fail state renders the fail caption, no staged chip', () => {
    const { getByText, queryByTestId } = render(<GateBar state="fail" {...LABELS} />);
    expect(getByText(LABELS.failLabel)).toBeTruthy();
    expect(queryByTestId('gate-staged-chip')).toBeFalsy();
  });

  it('all four states are visually distinct via data-gate-state', () => {
    const states: Array<'not-run' | 'running' | 'pass' | 'fail'> = ['not-run', 'running', 'pass', 'fail'];
    const rendered = states.map((state) => {
      const { container } = render(<GateBar state={state} {...LABELS} />);
      return container.querySelector('[data-testid="gate-bar"]')?.getAttribute('data-gate-state');
    });
    expect(new Set(rendered).size).toBe(4);
  });
});

describe('FailBanner', () => {
  it('root element has role="alert"', () => {
    const { getByRole } = render(
      <FailBanner
        message="Round-trip gate FAILED at DATA+0x120 — expected 04, wrote 05. Not staged."
        actions={[{ label: 'Jump to bytes', onClick: vi.fn() }, { label: 'Revert cell', onClick: vi.fn() }]}
      />,
    );
    const alert = getByRole('alert');
    expect(alert).toBeTruthy();
    expect(alert.textContent).toContain('Not staged.');
  });

  it('invokes the action callback on click', () => {
    const onClick = vi.fn();
    const { getByText } = render(
      <FailBanner message="failure" actions={[{ label: 'Jump to bytes', onClick }]} />,
    );
    getByText('Jump to bytes').click();
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
