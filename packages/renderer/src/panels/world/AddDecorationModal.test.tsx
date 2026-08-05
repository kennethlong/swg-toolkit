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

// Real paths, lifted from interiorlayout/toolkit/edit_1082874.ilf (Mos Eisley cantina). The
// previous fixtures were invented and carried a convention the real bytes do not use, which is how
// the substring-filter defect survived review.
const BOTTLE = 'object/static/item/shared_item_bottle_tall.iff';           // object/static/*   (28 real)
const CHAIR = 'object/tangible/furniture/cheap/shared_chair_s01.iff';      // tangible/furniture (20 real)
const LAMP = 'object/tangible/furniture/all/shared_frn_all_lamp_free_s01.iff';
const SOUND = 'object/soundobject/shared_soundobject_cantina_large.iff';   // soundobject       (2 real)

/** NOT decoration-shaped — must never appear in the grid. */
const CREATURE = 'object/creature/player/shared_human_male.iff';
/**
 * THE REGRESSION. A crafting schematic contains "/furniture/" but is not a world prop. The
 * original substring filter offered these, and placing one killed the client frame with an
 * ACCESS_VIOLATION swallowed by the agent's SEH handler — a silent no-op that cost a live sign-off
 * session on 2026-08-04.
 */
const SCHEMATIC = 'object/draft_schematic/furniture/shared_furniture_painting_wall_s01.iff';

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
  seedVfs([
    makeEntry(BOTTLE), makeEntry(CHAIR), makeEntry(LAMP), makeEntry(SOUND),
    makeEntry(CREATURE), makeEntry(SCHEMATIC),
  ]);
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
    expect(tiles).toHaveLength(4); // BOTTLE, CHAIR, LAMP, SOUND
    expect(screen.queryByText(CREATURE)).toBeNull();
    expect(screen.queryByText(SCHEMATIC)).toBeNull();
  });

  it('excludes tombstoned entries (a tombstone names a deleted file)', () => {
    seedVfs([makeEntry(BOTTLE), makeEntry(CHAIR, { isTombstone: true })]);
    renderModal();
    expect(screen.getAllByTestId('add-decoration-tile')).toHaveLength(1);
  });

  it('renders each tile with a humanized name and its full VFS path', () => {
    renderModal();
    expect(screen.getByText('Item Bottle Tall')).not.toBeNull();
    expect(screen.getByText(BOTTLE)).not.toBeNull();
  });

  it('carries the target buildingId as a data attribute', () => {
    renderModal();
    expect(screen.getByTestId('add-decoration-modal').getAttribute('data-building-id')).toBe('1082874');
  });
});

describe('AddDecorationModal — template class filter (ground truth from real .ilf bytes)', () => {
  it('REGRESSION: never offers a draft schematic, even though its path contains "/furniture/"', () => {
    // The literal 2026-08-04 defect. A substring test for "/furniture/" matched
    // object/draft_schematic/furniture/*, the modal offered a crafting schematic as a placeable
    // prop, and wsAddObject died on it with an ACCESS_VIOLATION that the agent's SEH handler
    // swallowed -- so the click silently did nothing and it took a DBWIN trace to find.
    seedVfs([makeEntry(SCHEMATIC)]);
    renderModal();
    expect(screen.queryAllByTestId('add-decoration-tile')).toHaveLength(0);
    expect(screen.getByTestId('add-decoration-empty')).not.toBeNull();
  });

  it('offers all three classes the real cantina .ilf actually uses', () => {
    seedVfs([makeEntry(BOTTLE), makeEntry(CHAIR), makeEntry(SOUND)]);
    renderModal();
    expect(screen.getAllByTestId('add-decoration-tile')).toHaveLength(3);
    for (const p of [BOTTLE, CHAIR, SOUND]) expect(screen.getByText(p)).not.toBeNull();
  });

  it('REGRESSION: offers object/tangible subtrees BEYOND furniture', () => {
    // A first fix used `object/tangible/furniture/` and silently dropped the cantina's own band
    // gear — six real decorations in the building under test. Top-level class is the boundary.
    const BAND = [
      'object/tangible/instrument/shared_mandoviol.iff',
      'object/tangible/instrument/shared_fanfar.iff',
      'object/tangible/microphone/shared_microphone.iff',
      'object/tangible/speaker/shared_speaker.iff',
    ];
    seedVfs(BAND.map((p) => makeEntry(p)));
    renderModal();
    expect(screen.getAllByTestId('add-decoration-tile')).toHaveLength(BAND.length);
  });

  it('offers object/static subtrees beyond item (structure, creature)', () => {
    const STATICS = [
      'object/static/structure/general/shared_streetlamp_style_01.iff',
      'object/static/creature/shared_endor_roba.iff',
    ];
    seedVfs(STATICS.map((p) => makeEntry(p)));
    renderModal();
    expect(screen.getAllByTestId('add-decoration-tile')).toHaveLength(STATICS.length);
  });

  it('anchors on the class prefix rather than matching it anywhere in the path', () => {
    // Both contain a legitimate class name as a SUBSTRING but are not that class.
    seedVfs([
      makeEntry('object/draft_schematic/furniture/shared_chair_s01.iff'),
      makeEntry('object/weapon/ranged/object/static/lookalike.iff'),
    ]);
    renderModal();
    expect(screen.queryAllByTestId('add-decoration-tile')).toHaveLength(0);
  });

  it('requires a compiled .iff template', () => {
    seedVfs([makeEntry('object/static/item/shared_item_bottle_tall.txt')]);
    renderModal();
    expect(screen.queryAllByTestId('add-decoration-tile')).toHaveLength(0);
  });
});

describe('AddDecorationModal — search filtering', () => {
  it('narrows the visible tile count to matching entries', () => {
    renderModal();
    expect(screen.getAllByTestId('add-decoration-tile')).toHaveLength(4);

    fireEvent.change(screen.getByTestId('add-decoration-search'), { target: { value: 'chair' } });

    const tiles = screen.getAllByTestId('add-decoration-tile');
    expect(tiles).toHaveLength(1);
    expect(screen.getByText(CHAIR)).not.toBeNull();
  });

  it('matches case-insensitively against the path', () => {
    renderModal();
    fireEvent.change(screen.getByTestId('add-decoration-search'), { target: { value: 'LAMP_FREE_S01' } });
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
    expect(screen.getAllByTestId('add-decoration-tile')).toHaveLength(4);
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
    expect(humanizeTemplateName(BOTTLE)).toBe('Item Bottle Tall');
  });

  it('handles a path with no directory or extension', () => {
    expect(humanizeTemplateName('crate')).toBe('Crate');
  });
});
