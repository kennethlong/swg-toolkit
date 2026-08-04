/**
 * packages/renderer/src/panels/world/AddDecorationModal.test.tsx
 * Component tests for AddDecorationModal — 05.1-14 Task 1 (021-A Frame 1).
 *
 * Mirrors RemoveUndoToast.test.tsx's shape (seed the store, render, assert on rendered DOM).
 * The modal is presentation + selection only, so every assertion here is about what the user
 * sees and what onPlace/onCancel receive — never about a send, a toast, or the ack protocol
 * (all of which belong to WorldPanel per R9 review BB1).
 */

import React from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import AddDecorationModal, { humanizeTemplateName } from './AddDecorationModal';
import { useTreStore, type VfsEntry } from '../../state/treStore';

function makeEntry(path: string, overrides: Partial<VfsEntry> = {}): VfsEntry {
  return {
    path,
    name: path.split('/').pop() ?? path,
    segments: path.split('/'),
    winnerArchivePath: 'C:/swg/patch_00.tre',
    winnerArchiveFilename: 'patch_00.tre',
    isOverride: false,
    isTombstone: false,
    shadowCount: 0,
    ...overrides,
  } as VfsEntry;
}

const TABLE = 'object/tangible/furniture/all/shared_frn_tatt_table_cantina_table_3.iff';
const CHAIR = 'object/tangible/furniture/all/shared_frn_tatt_chair_cantina_s1.iff';
const CRATE = 'object/tangible/furniture/all/shared_frn_crate_metal_lg.iff';
/** NOT decoration-shaped — must never appear in the grid. */
const CREATURE = 'object/creature/player/shared_human_male.iff';

function seedVfs(entries: VfsEntry[]): void {
  useTreStore.setState({ vfsEntries: entries });
}

function renderModal(overrides: Partial<React.ComponentProps<typeof AddDecorationModal>> = {}) {
  const onPlace = vi.fn();
  const onCancel = vi.fn();
  const utils = render(
    <AddDecorationModal
      buildingLabel="Cantina — Mos Eisley"
      cellName="alcove1"
      buildingId="1082874"
      onCancel={onCancel}
      onPlace={onPlace}
      {...overrides}
    />,
  );
  return { ...utils, onPlace, onCancel };
}

beforeEach(() => {
  seedVfs([makeEntry(TABLE), makeEntry(CHAIR), makeEntry(CRATE), makeEntry(CREATURE)]);
});

afterEach(() => {
  cleanup();
  useTreStore.setState({ vfsEntries: [] });
});

describe('AddDecorationModal — 021-A Frame 1 elements', () => {
  it('renders the modal head with the passed buildingLabel and cellName', () => {
    renderModal();
    expect(screen.getByTestId('add-decoration-context').textContent).toBe(
      'to Cantina — Mos Eisley (alcove1)',
    );
  });

  it('renders a tile per decoration-shaped entry, excluding non-decoration paths', () => {
    renderModal();
    const tiles = screen.getAllByTestId('add-decoration-tile');
    expect(tiles).toHaveLength(3); // TABLE, CHAIR, CRATE — never CREATURE
    expect(screen.queryByText(CREATURE)).toBeNull();
  });

  it('excludes tombstoned entries (a tombstone names a deleted file)', () => {
    seedVfs([makeEntry(TABLE), makeEntry(CHAIR, { isTombstone: true })]);
    renderModal();
    expect(screen.getAllByTestId('add-decoration-tile')).toHaveLength(1);
  });

  it('renders each tile with a humanized name and its full VFS path', () => {
    renderModal();
    expect(screen.getByText('Frn Tatt Table Cantina Table 3')).not.toBeNull();
    expect(screen.getByText(TABLE)).not.toBeNull();
  });

  it('carries the target buildingId as a data attribute', () => {
    renderModal();
    expect(screen.getByTestId('add-decoration-modal').getAttribute('data-building-id')).toBe('1082874');
  });
});

describe('AddDecorationModal — search filtering', () => {
  it('narrows the visible tile count to matching entries', () => {
    renderModal();
    expect(screen.getAllByTestId('add-decoration-tile')).toHaveLength(3);

    fireEvent.change(screen.getByTestId('add-decoration-search'), { target: { value: 'chair' } });

    const tiles = screen.getAllByTestId('add-decoration-tile');
    expect(tiles).toHaveLength(1);
    expect(screen.getByText(CHAIR)).not.toBeNull();
  });

  it('matches case-insensitively against the path', () => {
    renderModal();
    fireEvent.change(screen.getByTestId('add-decoration-search'), { target: { value: 'CRATE_METAL' } });
    expect(screen.getAllByTestId('add-decoration-tile')).toHaveLength(1);
  });

  it('shows an empty-state message when nothing matches', () => {
    renderModal();
    fireEvent.change(screen.getByTestId('add-decoration-search'), { target: { value: 'zzz-no-match' } });
    expect(screen.queryAllByTestId('add-decoration-tile')).toHaveLength(0);
    expect(screen.getByTestId('add-decoration-empty')).not.toBeNull();
  });

  it('restores the full list when the search is cleared', () => {
    renderModal();
    const search = screen.getByTestId('add-decoration-search');
    fireEvent.change(search, { target: { value: 'chair' } });
    expect(screen.getAllByTestId('add-decoration-tile')).toHaveLength(1);
    fireEvent.change(search, { target: { value: '' } });
    expect(screen.getAllByTestId('add-decoration-tile')).toHaveLength(3);
  });
});

describe('AddDecorationModal — selection and placement', () => {
  it('disables "Place in game ▸" until a tile is selected', () => {
    renderModal();
    const place = screen.getByRole('button', { name: 'Place in game' }) as HTMLButtonElement;
    expect(place.disabled).toBe(true);

    fireEvent.click(screen.getAllByTestId('add-decoration-tile')[0]);
    expect((screen.getByRole('button', { name: 'Place in game' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('marks the selected tile aria-selected (single-select)', () => {
    renderModal();
    const tiles = screen.getAllByTestId('add-decoration-tile');
    fireEvent.click(tiles[0]);
    expect(tiles[0].getAttribute('aria-selected')).toBe('true');

    fireEvent.click(tiles[1]);
    expect(screen.getAllByTestId('add-decoration-tile')[0].getAttribute('aria-selected')).toBe('false');
    expect(screen.getAllByTestId('add-decoration-tile')[1].getAttribute('aria-selected')).toBe('true');
  });

  it('calls onPlace with the selected entry EXACT path', () => {
    const { onPlace } = renderModal();
    // Select via the rendered path text so the assertion cannot pass on a wrong tile.
    fireEvent.change(screen.getByTestId('add-decoration-search'), { target: { value: 'chair' } });
    fireEvent.click(screen.getAllByTestId('add-decoration-tile')[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Place in game' }));

    expect(onPlace).toHaveBeenCalledTimes(1);
    expect(onPlace).toHaveBeenCalledWith(CHAIR);
  });

  it('drops a selection that the current filter no longer matches', () => {
    const { onPlace } = renderModal();
    fireEvent.click(screen.getAllByTestId('add-decoration-tile')[0]); // select the table
    fireEvent.change(screen.getByTestId('add-decoration-search'), { target: { value: 'chair' } });

    // The armed selection is gone — Place must be disabled again rather than sending an
    // invisible template.
    expect((screen.getByRole('button', { name: 'Place in game' }) as HTMLButtonElement).disabled).toBe(true);
    expect(onPlace).not.toHaveBeenCalled();
  });

  it('calls onCancel from the Cancel button', () => {
    const { onCancel } = renderModal();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('calls onCancel on Escape', () => {
    const { onCancel } = renderModal();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('never calls onPlace when Place is clicked with nothing selected', () => {
    const { onPlace } = renderModal();
    fireEvent.click(screen.getByRole('button', { name: 'Place in game' }));
    expect(onPlace).not.toHaveBeenCalled();
  });
});

describe('AddDecorationModal — render cap is disclosed, never silent', () => {
  it('caps the grid and states the true match count in the footer', () => {
    seedVfs(
      Array.from({ length: 250 }, (_, i) =>
        makeEntry(`object/tangible/furniture/all/shared_frn_item_${i}.iff`),
      ),
    );
    renderModal();

    expect(screen.getAllByTestId('add-decoration-tile')).toHaveLength(200);
    // The user is TOLD the grid is truncated and by how much — not shown a quietly partial list.
    expect(screen.getByText(/showing 200 of 250 matches/)).not.toBeNull();
  });
});

describe('humanizeTemplateName', () => {
  it('strips the shared_ prefix and .iff extension and title-cases the rest', () => {
    expect(humanizeTemplateName(TABLE)).toBe('Frn Tatt Table Cantina Table 3');
  });

  it('handles a path with no directory or extension', () => {
    expect(humanizeTemplateName('crate')).toBe('Crate');
  });
});
