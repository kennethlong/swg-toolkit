/**
 * packages/renderer/src/panels/editors/DatatableGridEditor.test.tsx
 * Component tests for the crumb/toolbar/grid anatomy (05-06-PLAN.md Task 3 acceptance criteria)
 * plus the SchemaRail/Hex-view/round-trip-gate wiring added by 05-08-PLAN.md.
 */

import React from 'react';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { render, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
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

// ─── Mocks (05-08) ────────────────────────────────────────────────────────────

// fs: preserve readFileSync (this test file's own source-level grep tests use the REAL 'node:fs'
// import above, but jsdom+vitest may alias 'fs' === 'node:fs' — importActual keeps both safe)
// while stubbing the write path the round-trip gate's stage-on-pass branch calls.
vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    default: { ...actual, mkdirSync: vi.fn(), writeFileSync: vi.fn() },
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
  };
});

// @swg/native-core is a bare require() of a native addon — vi.mock does NOT intercept this
// (confirmed project-wide: useLiveService.test.ts / useCommandWriter.test.ts header comments,
// for the sibling @swg/live-inject addon). Monkey-patch the real, process-cached addon object's
// methods instead — DatatableGridEditor.tsx's own `require('@swg/native-core')` resolves to the
// SAME cached module object (Node's require cache is keyed by resolved path), so mutating these
// properties here is visible to the component at call time.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const nativeMock = require('@swg/native-core') as {
  parseIff: ReturnType<typeof vi.fn>;
  parseDataTable: ReturnType<typeof vi.fn>;
  serializeDataTable: ReturnType<typeof vi.fn>;
};
nativeMock.parseIff = vi.fn();
nativeMock.parseDataTable = vi.fn();
nativeMock.serializeDataTable = vi.fn();

const stagingAddEntry = vi.hoisted(() => vi.fn());
vi.mock('../../state/stagingStore', () => ({
  useStagingStore: { getState: () => ({ addEntry: stagingAddEntry }) },
}));

beforeEach(() => {
  nativeMock.parseIff.mockReset();
  nativeMock.parseDataTable.mockReset();
  nativeMock.serializeDataTable.mockReset();
  stagingAddEntry.mockReset();
});

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
      { type: 'int', value: 5, byteOffset: 6, byteLength: 4 },
      { type: 'float', value: 1.5, byteOffset: 10, byteLength: 4 },
      { type: 'int', value: 1, byteOffset: 14, byteLength: 4 },
      { type: 'int', value: 1, byteOffset: 18, byteLength: 4 },
      { type: 'int', value: 3, byteOffset: 22, byteLength: 4 },
      { type: 'int', value: 7, byteOffset: 26, byteLength: 4 },
    ],
    [
      { type: 'string', value: 'Beta', byteOffset: 30, byteLength: 5 },
      { type: 'int', value: 9, byteOffset: 35, byteLength: 4 },
      { type: 'float', value: 2.25, byteOffset: 39, byteLength: 4 },
      { type: 'int', value: 0, byteOffset: 43, byteLength: 4 },
      { type: 'int', value: 0, byteOffset: 47, byteLength: 4 },
      { type: 'int', value: 0, byteOffset: 51, byteLength: 4 },
      { type: 'int', value: 12, byteOffset: 55, byteLength: 4 },
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

  it('renders the Grid | Hex segmented toggle and switches to the real Hex view', () => {
    const { getByRole, queryByTestId } = renderGrid();
    const hexToggle = getByRole('radio', { name: 'hex' });
    fireEvent.click(hexToggle);
    // 05-08: the placeholder is retired — no hex-view-placeholder test id exists anymore.
    expect(queryByTestId('hex-view-placeholder')).toBeFalsy();
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

// ─── 05-08: SchemaRail (item 5) ──────────────────────────────────────────────────

describe('DatatableGridEditor — SchemaRail wiring (05-08 item 5)', () => {
  it('mounts SchemaRail with the grid columns and no selected row initially', () => {
    const { getByTestId, getByText } = renderGrid();
    expect(getByTestId('schema-rail')).toBeTruthy();
    expect(getByText('Click a row…')).toBeTruthy();
  });

  it('clicking a row populates SchemaRail Selected row inspector', () => {
    const { container, getByTestId } = renderGrid();
    // Click the first data row's first cell (selects the whole row).
    const gridCells = Array.from(container.querySelectorAll('[role="gridcell"]'));
    fireEvent.click(gridCells[0]!); // first cell of first row ("Alpha")
    // "Alpha" now appears in both the grid cell AND SchemaRail's Selected-row inspector —
    // scope the assertion to the rail itself to avoid an ambiguous getByText match.
    expect(getByTestId('schema-rail').textContent).toContain('Alpha');
  });
});

// ─── 05-08: Hex view (item 6) ─────────────────────────────────────────────────────

describe('DatatableGridEditor — Hex view real target (05-08 item 6)', () => {
  it('renders the real HexInspector component (empty state when no sourceBytes supplied)', () => {
    const { getByRole, getByText, queryByTestId } = renderGrid();
    fireEvent.click(getByRole('radio', { name: 'hex' }));
    expect(queryByTestId('hex-view-placeholder')).toBeFalsy();
    expect(getByText('No bytes to inspect')).toBeTruthy();
  });

  it('computes selectedRange DIRECTLY from cell.byteOffset/byteLength — no re-derivation helper', () => {
    const src = fs.readFileSync(path.join(__dirname, 'DatatableGridEditor.tsx'), 'utf-8');
    expect(src).toMatch(/start:\s*lastEditedCell\.byteOffset/);
    expect(src).toMatch(/end:\s*lastEditedCell\.byteOffset\s*\+\s*lastEditedCell\.byteLength/);
    // No separate offset-calculation helper was invented for this.
    expect(src).not.toMatch(/function\s+(compute|derive)ByteOffset/i);
  });

  it('highlights the edited cell bytes and renders the highlighted caption after a cell edit', () => {
    // A minimal synthetic IFF tree: FORM DTII > FORM 0001 > CHUNK ROWS (byteOffset=0, length=64).
    // ROWS payload starts at 0+8+4=12; ends at 0+8+64=72. Feed 100 bytes of sourceBytes.
    const iffRoots = [
      {
        tag: 'FORM', kind: 'form' as const, subType: 'DTII', byteOffset: 0, length: 200,
        children: [
          {
            tag: 'FORM', kind: 'form' as const, subType: '0001', byteOffset: 12, length: 180,
            children: [
              { tag: 'ROWS', kind: 'leaf' as const, byteOffset: 20, length: 64 },
            ],
          },
        ],
      },
    ];
    const sourceBytes = new Uint8Array(100).buffer;

    const { container, getByRole, getByTestId } = renderGrid({ sourceBytes, iffRoots });

    // Double-click + commit an edit on the first row's "count" cell (byteOffset:6, byteLength:4).
    const cells = Array.from(container.querySelectorAll('[role="gridcell"]'));
    fireEvent.doubleClick(cells[1]!);
    const input = container.querySelector('input[type="number"]') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '42' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    fireEvent.click(getByRole('radio', { name: 'hex' }));

    expect(getByTestId('hex-caption').textContent).toBe(
      'highlighted: count (int) row 1 — the cell you edit in Grid view is these bytes',
    );
  });
});

// ─── 05-08: Round-trip gate wiring (items 7-8, T-05-21) ──────────────────────────

describe('DatatableGridEditor — round-trip gate wiring (05-08 items 7-8)', () => {
  it('clean round-trip: stagingStore.addEntry called EXACTLY once, gate state pass', () => {
    const bytes = new Uint8Array([1, 2, 3, 4]).buffer;
    nativeMock.serializeDataTable.mockReturnValue(bytes);
    nativeMock.parseIff.mockReturnValue({ roots: [] });
    nativeMock.parseDataTable.mockReturnValue({ formatTag: 'DTII', version: '0001', columns: [], rows: [] });

    const { getByText, getByTestId } = renderGrid();
    fireEvent.click(getByText('Save · run gate'));

    expect(stagingAddEntry).toHaveBeenCalledTimes(1);
    expect(getByTestId('gate-bar').getAttribute('data-gate-state')).toBe('pass');
  });

  it('forced mismatch (corrupted second serializeDataTable call): addEntry called ZERO times, gate fail', () => {
    let call = 0;
    nativeMock.serializeDataTable.mockImplementation(() => {
      call += 1;
      return call === 1 ? new Uint8Array([1, 2, 3, 4]).buffer : new Uint8Array([1, 2, 9, 4]).buffer;
    });
    nativeMock.parseIff.mockReturnValue({ roots: [] });
    nativeMock.parseDataTable.mockReturnValue({ formatTag: 'DTII', version: '0001', columns: [], rows: [] });

    const { getByText, getByTestId } = renderGrid();
    fireEvent.click(getByText('Save · run gate'));

    expect(stagingAddEntry).not.toHaveBeenCalled();
    expect(getByTestId('gate-bar').getAttribute('data-gate-state')).toBe('fail');
  });

  it('FailBanner message matches assertRoundTrip.ts hex-window style (0x-prefixed offset, expected/wrote byte rows)', () => {
    let call = 0;
    nativeMock.serializeDataTable.mockImplementation(() => {
      call += 1;
      return call === 1 ? new Uint8Array([1, 2, 3, 4]).buffer : new Uint8Array([1, 2, 9, 4]).buffer;
    });
    nativeMock.parseIff.mockReturnValue({ roots: [] });
    nativeMock.parseDataTable.mockReturnValue({ formatTag: 'DTII', version: '0001', columns: [], rows: [] });

    const { getByText, getByTestId } = renderGrid();
    fireEvent.click(getByText('Save · run gate'));

    const banner = getByTestId('fail-banner');
    expect(banner.textContent).toMatch(/DATA\+0x[0-9A-F]+/);
    expect(banner.textContent).toMatch(/expected [0-9A-F]{2}( [0-9A-F]{2})*/);
    expect(banner.textContent).toMatch(/wrote [0-9A-F]{2}( [0-9A-F]{2})*/);
    expect(banner.textContent).toContain('Not staged.');
  });

  it('＋ Stage runs the SAME gate-then-stage flow as Save · run gate (not a separate weaker path)', () => {
    const bytes = new Uint8Array([1, 2, 3, 4]).buffer;
    nativeMock.serializeDataTable.mockReturnValue(bytes);
    nativeMock.parseIff.mockReturnValue({ roots: [] });
    nativeMock.parseDataTable.mockReturnValue({ formatTag: 'DTII', version: '0001', columns: [], rows: [] });

    const { getByText } = renderGrid();
    fireEvent.click(getByText('＋ Stage'));

    expect(stagingAddEntry).toHaveBeenCalledTimes(1);
    expect(stagingAddEntry.mock.calls[0]![0]).toMatchObject({
      virtualPath: 'test/fixture.iff',
      action: 'modify',
    });
  });
});
