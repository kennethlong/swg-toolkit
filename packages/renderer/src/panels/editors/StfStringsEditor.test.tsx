/**
 * packages/renderer/src/panels/editors/StfStringsEditor.test.tsx
 * Component tests for the crumb/toolbar/grid anatomy + gate-bar wiring (05-09-PLAN.md Tasks 1-2
 * acceptance criteria) — the `.stf` sibling of DatatableGridEditor.test.tsx (05-06/05-08).
 */

import React from 'react';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { render, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import StfStringsEditor, { type StfStringsEditorParams } from './StfStringsEditor';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = fs.readFileSync(path.join(__dirname, 'StfStringsEditor.tsx'), 'utf-8');

// jsdom has no ResizeObserver — same stub convention as DatatableGridEditor.test.tsx.
if (typeof global.ResizeObserver === 'undefined') {
  global.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

// ─── Mocks ────────────────────────────────────────────────────────────────────

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
// (project-wide precedent: DatatableGridEditor.test.tsx / useLiveService.test.ts header
// comments). Monkey-patch the real, process-cached addon object's methods instead.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const nativeMock = require('@swg/native-core') as {
  parseStf: ReturnType<typeof vi.fn>;
  serializeStf: ReturnType<typeof vi.fn>;
  recomputeSourceCrcFromText: ReturnType<typeof vi.fn>;
};
nativeMock.parseStf = vi.fn();
nativeMock.serializeStf = vi.fn();
nativeMock.recomputeSourceCrcFromText = vi.fn();

const stagingAddEntry = vi.hoisted(() => vi.fn());
vi.mock('../../state/stagingStore', () => ({
  useStagingStore: { getState: () => ({ addEntry: stagingAddEntry }) },
}));

beforeEach(() => {
  nativeMock.parseStf.mockReset();
  nativeMock.serializeStf.mockReset();
  nativeMock.recomputeSourceCrcFromText.mockReset();
  stagingAddEntry.mockReset();
});

// ─── Fixture ──────────────────────────────────────────────────────────────────

const fixtureStfResult: StfStringsEditorParams['stfResult'] = {
  nextUniqueId: 3,
  entries: [
    { id: 1, sourceCrc: 0x11111111, text: 'Hello World' },
    { id: 2, sourceCrc: 0x22222222, text: 'Goodbye' },
  ],
  nameMap: [
    { id: 2, name: 'farewell_bye' },
    { id: 1, name: 'greeting_hello' },
  ],
};

function renderEditor(overrides: Partial<StfStringsEditorParams> = {}) {
  const params: StfStringsEditorParams = {
    stfResult: fixtureStfResult,
    virtualPath: 'string/en/test_table.stf',
    locale: 'en',
    ...overrides,
  };
  // dockview panel props shape: { params, api, containerApi }
  return render(<StfStringsEditor params={params as never} api={{} as never} containerApi={{} as never} />);
}

// ─── Source-level contract tests ───────────────────────────────────────────────

describe('StfStringsEditor — source-level contract', () => {
  it('uses OVERSCAN/ROW_HEIGHT (VfsTree.tsx idiom), not an unvirtualized full render', () => {
    expect(SRC).toContain('OVERSCAN');
    expect(SRC).toContain('ROW_HEIGHT');
  });

  it('imports GateBar/FailBanner from the shared 05-06 files — not a local re-implementation', () => {
    expect(SRC).toContain("import GateBar from './shared/GateBar'");
    expect(SRC).toContain("import FailBanner from './shared/FailBanner'");
  });

  it('REVIEWS.md MEDIUM fix: the ambiguous "auto on save" / "CRC32 auto" copy is fully retired', () => {
    expect(SRC).not.toContain('auto on save');
    expect(SRC).not.toContain('CRC32 auto');
  });

  it('the corrected new-row CRC placeholder copy is present', () => {
    expect((SRC.match(/unset · assigned on first save/g) ?? []).length).toBeGreaterThanOrEqual(1);
  });

  it('the corrected gate-bar footer note copy is present', () => {
    expect(SRC).toContain('sourceCrc preserved on save');
  });

  it('recomputeSourceCrcFromText has exactly ONE call site — the per-row re-sync handler, never the save path', () => {
    const matches = SRC.match(/nativeCore\.recomputeSourceCrcFromText\(/g) ?? [];
    expect(matches.length).toBe(1);
    // Confirm that one call site is inside handleResync, not handleSaveRunGate.
    const resyncFnBody = SRC.slice(SRC.indexOf('const handleResync'), SRC.indexOf('const handleSaveRunGate'));
    expect(resyncFnBody).toContain('nativeCore.recomputeSourceCrcFromText(');
    const saveFnBody = SRC.slice(SRC.indexOf('const handleSaveRunGate'), SRC.indexOf('// ── Virtualization'));
    expect(saveFnBody).not.toContain('recomputeSourceCrcFromText(');
  });
});

// ─── Crumb bar + toolbar anatomy ───────────────────────────────────────────────

describe('StfStringsEditor — crumb bar + toolbar anatomy', () => {
  it('renders the crumb text with locale/magic/count', () => {
    const { getByTestId } = renderEditor();
    const crumb = getByTestId('stf-crumb').textContent ?? '';
    expect(crumb).toContain('string/en/test_table.stf');
    expect(crumb).toContain('STF');
    expect(crumb).toContain('2 entries (2 shown)');
  });

  it('renders the key count chip', () => {
    const { getByTestId } = renderEditor();
    expect(getByTestId('key-count-chip').textContent).toContain('2 / 2 keys');
  });

  it('renders the crc32 column header with the re-sync tooltip', () => {
    const { getByText } = renderEditor();
    const header = getByText('crc32');
    expect(header.getAttribute('title')).toContain('Preserved on save');
  });
});

// ─── crc32 column read-only contract ───────────────────────────────────────────

describe('StfStringsEditor — crc32 column is read-only (never an <input>)', () => {
  it('the crc32 cells never render an <input> element', () => {
    const { container } = renderEditor();
    const crcCells = Array.from(container.querySelectorAll('[data-testid="crc32-cell"]'));
    expect(crcCells.length).toBeGreaterThan(0);
    for (const cell of crcCells) {
      expect(cell.querySelector('input')).toBeFalsy();
    }
  });

  it('renders the hex sourceCrc value for an existing row', () => {
    const { container } = renderEditor();
    const crcCells = Array.from(container.querySelectorAll('[data-testid="crc32-cell"]'));
    const text = crcCells.map((c) => c.textContent).join(' ');
    expect(text).toContain('0x11111111');
    expect(text).toContain('0x22222222');
  });
});

// ─── Search filters by key AND text ────────────────────────────────────────────

describe('StfStringsEditor — search filters by key AND localized text', () => {
  it('a query matching only the localized text (not the key) still filters to that row', () => {
    const { getByPlaceholderText, getByText, queryByText } = renderEditor();
    const search = getByPlaceholderText('Search keys and text…');
    // "Goodbye" is the text for row keyed "farewell_bye" — the query itself does not appear
    // in any key, only in that row's text.
    fireEvent.change(search, { target: { value: 'goodbye' } });
    expect(getByText('Goodbye')).toBeTruthy();
    expect(queryByText('Hello World')).toBeFalsy();
  });

  it('zero-result search renders "No keys match" copy, never a silently blank grid', () => {
    const { getByPlaceholderText, getByText } = renderEditor();
    const search = getByPlaceholderText('Search keys and text…');
    fireEvent.change(search, { target: { value: 'zzz-no-match' } });
    expect(getByText('No keys match "zzz-no-match"')).toBeTruthy();
  });
});

// ─── ＋ Add key — new-row CRC placeholder ───────────────────────────────────────

describe('StfStringsEditor — ＋ Add key', () => {
  it("a new row's sourceCrc reads 'unset · assigned on first save' until the first save", () => {
    const { getByText, container } = renderEditor();
    fireEvent.click(getByText('＋ Add key'));
    const crcCells = Array.from(container.querySelectorAll('[data-testid="crc32-cell"]'));
    const text = crcCells.map((c) => c.textContent).join(' ');
    expect(text).toContain('unset · assigned on first save');
  });

  it('the new row gets an inline, editable key input (existing rows do not)', () => {
    const { getByText, getByLabelText } = renderEditor();
    fireEvent.click(getByText('＋ Add key'));
    expect(getByLabelText('New key name')).toBeTruthy();
  });
});

// ─── Round-trip gate wiring (mirrors DatatableGridEditor.test.tsx 05-08 items 7-8) ────────────

describe('StfStringsEditor — round-trip gate wiring', () => {
  it('save with NO edits: every sourceCrc byte in the serialized output matches the original parsed input (D-10)', () => {
    nativeMock.serializeStf.mockReturnValue(new Uint8Array([1, 2, 3, 4]).buffer);
    nativeMock.parseStf.mockReturnValue({ nextUniqueId: 3, entries: [], nameMap: [] });

    const { getByText } = renderEditor();
    fireEvent.click(getByText('Save · run gate'));

    // First serializeStf call is the FIRST PASS (built from in-memory rows) — the second call
    // re-serializes the (mocked) reparsed result, which is a different object. Only the first
    // call's argument reflects this test's D-10 assertion.
    const firstCallArg = nativeMock.serializeStf.mock.calls[0]![0] as {
      entries: Array<{ id: number; sourceCrc: number; text: string }>;
    };
    const byId = new Map(firstCallArg.entries.map((e) => [e.id, e.sourceCrc]));
    expect(byId.get(1)).toBe(0x11111111);
    expect(byId.get(2)).toBe(0x22222222);
  });

  it('save after an explicit re-sync: ONLY the re-synced row changed', () => {
    nativeMock.recomputeSourceCrcFromText.mockReturnValue(0x99999999);
    nativeMock.serializeStf.mockReturnValue(new Uint8Array([1, 2, 3, 4]).buffer);
    nativeMock.parseStf.mockReturnValue({ nextUniqueId: 3, entries: [], nameMap: [] });

    const { container, getByText } = renderEditor();
    const crcCells = Array.from(container.querySelectorAll('[data-testid="crc32-cell"]'));
    // Row 0 in display order (alpha-by-key: farewell_bye < greeting_hello) is id=2.
    fireEvent.mouseEnter(crcCells[0]!);
    const resyncBtn = crcCells[0]!.querySelector('button');
    expect(resyncBtn).toBeTruthy();
    fireEvent.click(resyncBtn!);

    fireEvent.click(getByText('Save · run gate'));

    const firstCallArg = nativeMock.serializeStf.mock.calls[0]![0] as {
      entries: Array<{ id: number; sourceCrc: number; text: string }>;
    };
    const byId = new Map(firstCallArg.entries.map((e) => [e.id, e.sourceCrc]));
    expect(byId.get(2)).toBe(0x99999999); // re-synced row changed
    expect(byId.get(1)).toBe(0x11111111); // untouched row preserved verbatim
  });

  it('forced mismatch: stagingStore.addEntry is called ZERO times, FailBanner renders', () => {
    let call = 0;
    nativeMock.serializeStf.mockImplementation(() => {
      call += 1;
      return call === 1 ? new Uint8Array([1, 2, 3, 4]).buffer : new Uint8Array([1, 2, 9, 4]).buffer;
    });
    nativeMock.parseStf.mockReturnValue({ nextUniqueId: 3, entries: [], nameMap: [] });

    const { getByText, getByTestId } = renderEditor();
    fireEvent.click(getByText('Save · run gate'));

    expect(stagingAddEntry).not.toHaveBeenCalled();
    expect(getByTestId('gate-bar').getAttribute('data-gate-state')).toBe('fail');
    expect(getByTestId('fail-banner')).toBeTruthy();
    expect(getByTestId('fail-banner').textContent).toContain('Not staged.');
  });

  it('clean round-trip: stagingStore.addEntry called EXACTLY once, gate state pass', () => {
    const bytes = new Uint8Array([1, 2, 3, 4]).buffer;
    nativeMock.serializeStf.mockReturnValue(bytes);
    nativeMock.parseStf.mockReturnValue({ nextUniqueId: 3, entries: [], nameMap: [] });

    const { getByText, getByTestId } = renderEditor();
    fireEvent.click(getByText('Save · run gate'));

    expect(stagingAddEntry).toHaveBeenCalledTimes(1);
    expect(getByTestId('gate-bar').getAttribute('data-gate-state')).toBe('pass');
  });

  it('＋ Stage runs the SAME gate-then-stage flow as Save · run gate', () => {
    const bytes = new Uint8Array([1, 2, 3, 4]).buffer;
    nativeMock.serializeStf.mockReturnValue(bytes);
    nativeMock.parseStf.mockReturnValue({ nextUniqueId: 3, entries: [], nameMap: [] });

    const { getByText } = renderEditor();
    fireEvent.click(getByText('＋ Stage'));

    expect(stagingAddEntry).toHaveBeenCalledTimes(1);
    expect(stagingAddEntry.mock.calls[0]![0]).toMatchObject({
      virtualPath: 'string/en/test_table.stf',
      action: 'modify',
    });
  });

  it('renders the corrected gate-bar footer note', () => {
    const { getByTestId } = renderEditor();
    expect(getByTestId('gate-bar-note').textContent).toBe(
      'values are UTF-16LE · keys ASCII · sourceCrc preserved on save',
    );
  });
});
