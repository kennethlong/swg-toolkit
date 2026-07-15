/**
 * packages/renderer/src/panels/editors/DatatableGridEditor.test.tsx
 * Component tests for the crumb/toolbar/grid anatomy (05-06-PLAN.md Task 3 acceptance criteria).
 */

import React from 'react';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { render, fireEvent } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import DatatableGridEditor, { type DatatableGridEditorParams } from './DatatableGridEditor';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// jsdom has no ResizeObserver — same stub convention as DeployDialog.test.tsx.
if (typeof global.ResizeObserver === 'undefined') {
  global.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

// A 7-column fixture exercising 7 of the 9 non-Comment type-spec kinds (string/int/float/bool/
// enum/bitvector/enum-table) — enough to prove the widened badge/widget dispatch without
// duplicating dtiiTypeSpec.test.ts's own exhaustive grammar coverage.
const fixtureTable: DatatableGridEditorParams['table'] = {
  formatTag: 'DTII',
  version: '0001',
  columns: [
    { name: 'name', typeSpec: 's' },
    { name: 'count', typeSpec: 'i' },
    { name: 'ratio', typeSpec: 'f' },
    { name: 'active', typeSpec: 'b' },
    { name: 'category', typeSpec: 'e(a=0,b=1,c=2)' },
    { name: 'perms', typeSpec: 'v(read=1,write=2,exec=3)' },
    { name: 'faction', typeSpec: 'z(faction_table.iff)' },
  ],
  rows: [
    [
      { type: 'string', value: 'Alpha', byteOffset: 0, byteLength: 6 },
      { type: 'int', value: 5, byteOffset: 0, byteLength: 4 },
      { type: 'float', value: 1.5, byteOffset: 0, byteLength: 4 },
      { type: 'int', value: 1, byteOffset: 0, byteLength: 4 },
      { type: 'int', value: 1, byteOffset: 0, byteLength: 4 },
      { type: 'int', value: 3, byteOffset: 0, byteLength: 4 },
      { type: 'int', value: 7, byteOffset: 0, byteLength: 4 },
    ],
    [
      { type: 'string', value: 'Beta', byteOffset: 0, byteLength: 5 },
      { type: 'int', value: 9, byteOffset: 0, byteLength: 4 },
      { type: 'float', value: 2.25, byteOffset: 0, byteLength: 4 },
      { type: 'int', value: 0, byteOffset: 0, byteLength: 4 },
      { type: 'int', value: 0, byteOffset: 0, byteLength: 4 },
      { type: 'int', value: 0, byteOffset: 0, byteLength: 4 },
      { type: 'int', value: 12, byteOffset: 0, byteLength: 4 },
    ],
  ],
};

function renderGrid(overrides: Partial<DatatableGridEditorParams> = {}) {
  const params: DatatableGridEditorParams = {
    table: fixtureTable,
    virtualPath: 'test/fixture.iff',
    ...overrides,
  };
  // dockview panel props shape: { params, api, containerApi }
  return render(<DatatableGridEditor params={params as never} api={{} as never} containerApi={{} as never} />);
}

describe('DatatableGridEditor — source-level virtualization contract', () => {
  it('uses OVERSCAN (VfsTree.tsx idiom), not an unvirtualized full render', () => {
    const src = fs.readFileSync(path.join(__dirname, 'DatatableGridEditor.tsx'), 'utf-8');
    expect(src).toContain('OVERSCAN');
    expect(src).toContain('ROW_HEIGHT');
  });

  it('imports parseTypeSpec from dtiiTypeSpec — does not re-implement the grammar inline', () => {
    const src = fs.readFileSync(path.join(__dirname, 'DatatableGridEditor.tsx'), 'utf-8');
    expect(src).toMatch(/import\s*\{[^}]*parseTypeSpec[^}]*\}\s*from\s*['"]\.\/dtiiTypeSpec['"]/);
  });
});

describe('DatatableGridEditor — crumb bar + toolbar anatomy', () => {
  it('renders the DTII crumb text', () => {
    const { getByText } = renderGrid();
    expect(getByText(/FORM DTII/)).toBeTruthy();
  });

  it('renders the Grid | Hex segmented toggle and switches to a hex placeholder', () => {
    const { getByRole, getByTestId } = renderGrid();
    const hexToggle = getByRole('radio', { name: 'hex' });
    fireEvent.click(hexToggle);
    expect(getByTestId('hex-view-placeholder')).toBeTruthy();
  });

  it('renders the row/col count chip', () => {
    const { getByTestId } = renderGrid();
    expect(getByTestId('row-count-chip').textContent).toContain('2 rows');
    expect(getByTestId('row-count-chip').textContent).toContain('7 cols');
  });
});

describe('DatatableGridEditor — type badges (D-07 widened set)', () => {
  it('renders a distinct badge letter for each non-Comment kind present in the fixture', () => {
    const { container } = renderGrid();
    const badges = Array.from(container.querySelectorAll('[data-testid="type-badge"]'));
    const kinds = badges.map((b) => b.getAttribute('data-kind'));
    expect(kinds).toEqual(
      expect.arrayContaining(['string', 'int', 'float', 'bool', 'enum', 'bitvector', 'enum-table']),
    );
  });
});

describe('DatatableGridEditor — z(...) enum-table is read-only (REVIEWS.md MEDIUM fix)', () => {
  it('a cell in the z(...) column has no <select>/dropdown on double-click', () => {
    const { container } = renderGrid();
    const cells = Array.from(container.querySelectorAll('[role="gridcell"]'));
    // faction is the 7th (last) column -> every 7th gridcell starting at index 6
    const factionCell = cells[6];
    expect(factionCell).toBeTruthy();
    fireEvent.doubleClick(factionCell!);
    expect(container.querySelector('select')).toBeFalsy();
  });
});

describe('DatatableGridEditor — filter zero-result', () => {
  it('renders "No rows match" copy, never a silently blank grid', () => {
    const { getByPlaceholderText, getByText } = renderGrid();
    const filterInput = getByPlaceholderText('Filter rows…');
    fireEvent.change(filterInput, { target: { value: 'zzz-no-match' } });
    expect(getByText('No rows match "zzz-no-match"')).toBeTruthy();
  });
});

describe('DatatableGridEditor — modified-cell triple encoding', () => {
  it('an edited cell shows border + tint + " ●" suffix simultaneously', () => {
    const { container } = renderGrid();
    // Double-click the first row's "count" cell (int column, index 1) to open its editor.
    const cells = Array.from(container.querySelectorAll('[role="gridcell"]'));
    const countCell = cells[1]; // row0: name(0) count(1) ...
    expect(countCell).toBeTruthy();
    fireEvent.doubleClick(countCell!);
    const input = container.querySelector('input[type="number"]') as HTMLInputElement;
    expect(input).toBeTruthy();
    fireEvent.change(input, { target: { value: '99' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    // Re-query — the cell has re-rendered as a display cell with the modified encoding.
    const updatedCells = Array.from(container.querySelectorAll('[role="gridcell"]'));
    const updatedCount = updatedCells[1] as HTMLElement;
    expect(updatedCount.getAttribute('data-modified')).toBe('true');
    expect(updatedCount.style.borderLeft).toContain('inset');
    expect(updatedCount.style.background).toContain('230, 180, 80');
    expect(updatedCount.textContent).toBe('99 ●');
  });
});
