/**
 * packages/renderer/src/panels/editors/SchemaRail.test.tsx
 * Component tests for SchemaRail (05-08-PLAN.md Task 1 acceptance criteria).
 */

import React from 'react';
import { render, fireEvent } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import SchemaRail, { type SchemaRailProps } from './SchemaRail';

const baseProps: SchemaRailProps = {
  columns: [
    { name: 'name', kind: 'string' },
    { name: 'count', kind: 'int' },
    { name: 'ratio', kind: 'float' },
  ],
  selectedRow: null,
  gateState: { lastRun: 'never', result: { kind: 'none' }, bytes: null },
};

describe('SchemaRail — Schema · COLS/TYPE section', () => {
  it('renders one row per column with a type badge + name + storage type', () => {
    const { getByText, getAllByTestId } = render(<SchemaRail {...baseProps} />);
    expect(getByText('name')).toBeTruthy();
    expect(getByText('ascii·z')).toBeTruthy();
    expect(getByText('count')).toBeTruthy();
    expect(getByText('int32')).toBeTruthy();
    expect(getByText('ratio')).toBeTruthy();
    expect(getByText('float32')).toBeTruthy();
    expect(getAllByTestId('type-badge').length).toBe(3);
  });
});

describe('SchemaRail — Selected row section', () => {
  it('renders "Click a row…" when selectedRow is null', () => {
    const { getByText } = render(<SchemaRail {...baseProps} />);
    expect(getByText('Click a row…')).toBeTruthy();
  });

  it('renders a populated kv list when selectedRow is provided, modified values in warn', () => {
    const { getByText } = render(
      <SchemaRail
        {...baseProps}
        selectedRow={[
          { name: 'name', value: 'Alpha', modified: false },
          { name: 'count', value: '99', modified: true },
        ]}
      />,
    );
    expect(getByText('Alpha')).toBeTruthy();
    const modifiedValue = getByText('99');
    expect(modifiedValue.style.color).toContain('warn');
  });
});

describe('SchemaRail — Round-trip gate section', () => {
  it('renders never/—/— before any gate run', () => {
    const { getByText, getAllByText } = render(<SchemaRail {...baseProps} />);
    expect(getByText('never')).toBeTruthy();
    // Both 'result' (none) and 'bytes' (null) render '—' before any gate run.
    expect(getAllByText('—').length).toBe(2);
  });

  it('renders pass state', () => {
    const { getByText } = render(
      <SchemaRail {...baseProps} gateState={{ lastRun: 'just now', result: { kind: 'pass' }, bytes: 512 }} />,
    );
    expect(getByText('just now')).toBeTruthy();
    expect(getByText('✓ byte-exact')).toBeTruthy();
    expect(getByText('DATA 512 B')).toBeTruthy();
  });

  it('renders fail state with the mismatch offset', () => {
    const { getByText } = render(
      <SchemaRail {...baseProps} gateState={{ lastRun: 'just now', result: { kind: 'fail', offset: 0x2a }, bytes: null }} />,
    );
    expect(getByText('✗ mismatch @0x2A')).toBeTruthy();
  });
});

describe('SchemaRail — independently collapsible sections', () => {
  it('collapsing one section does not affect the others’ expanded state', () => {
    const { getByText, queryByText } = render(
      <SchemaRail
        {...baseProps}
        selectedRow={[{ name: 'nameField', value: 'Alpha', modified: false }]}
      />,
    );

    // All three sections start expanded (defaultExpanded).
    expect(getByText('name')).toBeTruthy(); // Schema section column row
    expect(getByText('Alpha')).toBeTruthy(); // Selected row section
    expect(getByText('never')).toBeTruthy(); // Round-trip gate section

    // Collapse the "Schema · COLS / TYPE" section only.
    fireEvent.click(getByText('Schema · COLS / TYPE'));

    // Its content disappears...
    expect(queryByText('ascii·z')).toBeFalsy();
    // ...but the other two sections' content is untouched.
    expect(getByText('Alpha')).toBeTruthy();
    expect(getByText('never')).toBeTruthy();
  });
});
