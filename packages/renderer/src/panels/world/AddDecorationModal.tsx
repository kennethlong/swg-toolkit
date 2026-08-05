/**
 * packages/renderer/src/panels/world/AddDecorationModal.tsx
 * 021-A Frame 1 — the "+ Add decoration…" wizard modal.
 *
 * PRESENTATION + SELECTION ONLY. This component never calls sendStartPlacement and never shows a
 * toast: the caller (WorldPanel.tsx) owns the send, the pending-slot state machine, and ALL toast
 * display timing per Plan 08's HOST_CMD ACK PROTOCOL (05.1-14 Task 3; R9 review, BB1). This
 * component's entire contract is "the user picked this template path" via onPlace.
 *
 * Search scope: `useTreStore`'s ALREADY-MOUNTED vfsEntries — no new asset-discovery service, no
 * disk walk of its own. Entries are pre-filtered to the decoration-shaped path convention the
 * `.ilf`'s own objectTemplateName values already use (`object/tangible/furniture/...`), because
 * 021-A's search is "furniture templates", not the entire mounted archive set.
 *
 * Source: 05.1-14-PLAN.md Task 1; .planning/sketches/021-spawn-decoration-flow/index.html
 * (Frame 1, lines 170-191: modal-head with building/cell context, search input, tpl-grid of
 * selectable thumb/nm/pth tiles, modal-foot's preview-note + Cancel + "Place in game ▸");
 * DeleteProjectConfirmModal.tsx / DeployDialog.tsx (modal chrome conventions — overlay/panel/
 * header/footer, Escape-closes, backdrop-click-closes).
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';

import { useTreStore, type VfsEntry } from '../../state/treStore';

// ─── Props ────────────────────────────────────────────────────────────────────

export interface AddDecorationModalProps {
  /** Target building's display label — rendered in the modal head's context line. */
  buildingLabel: string;
  /** Target cell, BORROWED from an existing decoration in that building (05.1-14 D-04's MVP
   *  degrade — the caller resolves it; this component only displays it). */
  cellName: string;
  /** Target building id. Carried for the caller's benefit and surfaced as a data attribute so a
   *  test/inspector can confirm WHICH building a rendered modal is targeting. */
  buildingId: string;
  /** Cancel button, backdrop click, or Escape. */
  onCancel: () => void;
  /** "Place in game ▸" with the selected tile's exact VFS path. */
  onPlace: (templatePath: string) => void;
}

// ─── Decoration-shaped scoping ────────────────────────────────────────────────

/**
 * The object classes an interior-layout `.ilf` node may legitimately name.
 *
 * GROUND TRUTH, not convention: every `object/...iff` string in the real
 * `interiorlayout/toolkit/edit_1082874.ilf` (Mos Eisley cantina) — 51 distinct templates:
 *
 *     29  object/static/       item 21, structure 7, creature 1
 *     20  object/tangible/     furniture 14, instrument 4, speaker 1, microphone 1
 *      2  object/soundobject/
 *
 * TOP-LEVEL class is the right granularity, and getting that wrong is how this list was wrong
 * twice in one session. A first pass used `object/tangible/furniture/`, which silently dropped the
 * cantina's own band gear — `object/tangible/instrument/*`, `speaker`, `microphone`, six real
 * decorations sitting in the very building we were testing against.
 *
 * Anchored at the START of the path, deliberately. The ORIGINAL implementation substring-matched
 * `/furniture/` or `/tangible/` ANYWHERE, which was wrong in both directions:
 *
 *   1. It MISSED every `object/static/*` — the largest class (29 of 51), including the object the
 *      maintainer had just rotated successfully.
 *   2. It ADMITTED `object/draft_schematic/furniture/*` — CRAFTING SCHEMATICS, which contain
 *      "/furniture/" but are not world props. Handing one to `wsAddObject` killed the client frame
 *      with an ACCESS_VIOLATION (DEP/execute at 0x736E6172 — a jump into ASCII, i.e. a call through
 *      a pointer read out of string data), swallowed by the agent's outer SEH handler so the click
 *      silently did nothing. Cost a live sign-off session and a wrongly-filed provider report.
 *
 * WHY THE ENGINE DOES NOT CATCH IT, so nobody assumes a safety net exists: the engine's own loader
 * does `safe_cast<ClientObject *>(ObjectTemplateList::createObject(name))` and guards only against
 * NULL — its "invalid interior object template name … Object will be skipped" diagnostic is a
 * `DEBUG_WARNING`, compiled OUT of Release, and `safe_cast` is unchecked there
 * (`ClientInteriorLayoutManager.cpp:143-161`). A wrong-class template that creates non-null yields
 * a bad pointer and the next virtual call crashes. There is no Release-mode guard anywhere below
 * this filter — it IS the guard.
 *
 * The substring rule came from plan text asserting the convention was `object/tangible/furniture/`
 * plus test fixtures carrying the same invented paths. Neither was checked against real `.ilf`
 * bytes. See AGENTS.md's verify-against-ground-truth rule.
 *
 * SCOPE NOTE: still derived from ONE building. Other interiors may use classes absent here. Widen
 * ONLY from real `.ilf` data, never from a plausible guess. The proper long-term fix is to validate
 * a candidate by its template's own IFF type rather than its path — the engine's real rule is "does
 * `createObject` return a ClientObject", which is a type property, not a path property. Filed as a
 * todo. Until then: too narrow costs a missing tile, too broad crashes the client.
 */
const DECORATION_CLASS_PREFIXES = [
  'object/static/',
  'object/tangible/',
  'object/soundobject/',
] as const;

/**
 * 021-A searches placeable decoration templates, not every mounted asset. Tombstones are excluded
 * — a tombstoned entry names a DELETED file, which would resolve to nothing if placed.
 */
function isDecorationShaped(e: VfsEntry): boolean {
  if (e.isTombstone) return false;
  const p = e.path.toLowerCase();
  // Real interior-layout nodes always name a compiled template.
  if (!p.endsWith('.iff')) return false;
  return DECORATION_CLASS_PREFIXES.some((prefix) => p.startsWith(prefix));
}

/** `shared_frn_tatt_table_cantina_table_3.iff` → `Frn Tatt Table Cantina Table 3`. */
export function humanizeTemplateName(vfsPath: string): string {
  const base = vfsPath.split('/').pop() ?? vfsPath;
  const stem = base.replace(/\.iff$/i, '').replace(/^shared_/i, '');
  const words = stem.split(/[_\s]+/).filter(Boolean);
  if (words.length === 0) return stem;
  return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

/** Stable per-tile glyph so the grid reads as varied like 021-A's, without inventing thumbnails
 *  we cannot render. Deterministic in the path, so a tile keeps its glyph across re-renders. */
const TILE_GLYPHS = ['▦', '▤', '◫', '▥', '◍', '▣'];
function glyphFor(vfsPath: string): string {
  let h = 0;
  for (let i = 0; i < vfsPath.length; i += 1) h = (h * 31 + vfsPath.charCodeAt(i)) >>> 0;
  return TILE_GLYPHS[h % TILE_GLYPHS.length];
}

/**
 * Render cap. The mounted VFS can hold tens of thousands of decoration-shaped entries and the
 * grid is un-virtualized; rendering all of them would hang the panel. The cap is DISCLOSED in the
 * footer whenever it truncates (never a silent narrowing) — the user is told the count and asked
 * to refine, rather than being shown a quietly incomplete grid.
 */
const MAX_RENDERED_TILES = 200;

// ─── Component ────────────────────────────────────────────────────────────────

export default function AddDecorationModal({
  buildingLabel,
  cellName,
  buildingId,
  onCancel,
  onPlace,
}: AddDecorationModalProps): React.ReactElement {
  const vfsEntries = useTreStore((s) => s.vfsEntries);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string | null>(null);

  const decorationEntries = useMemo(() => vfsEntries.filter(isDecorationShaped), [vfsEntries]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return decorationEntries;
    return decorationEntries.filter((e) => e.path.toLowerCase().includes(q));
  }, [decorationEntries, query]);

  const visible = matches.slice(0, MAX_RENDERED_TILES);
  const truncatedBy = matches.length - visible.length;

  // A selection that no longer matches the current filter must not stay armed behind the scenes —
  // otherwise "Place in game ▸" would send a template the user can no longer see.
  useEffect(() => {
    if (selected !== null && !matches.some((e) => e.path === selected)) setSelected(null);
  }, [matches, selected]);

  const handleCancel = useCallback(() => onCancel(), [onCancel]);

  // Escape closes — mirrors DeleteProjectConfirmModal/DeployDialog's own convention.
  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') handleCancel();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [handleCancel]);

  return (
    <div role="presentation" onClick={handleCancel} style={overlayStyle}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Add decoration"
        data-testid="add-decoration-modal"
        data-building-id={buildingId}
        onClick={(e) => e.stopPropagation()}
        style={panelStyle}
      >
        {/* modal-head — 021-A: "＋ Add decoration   to {building} ({cell})" */}
        <div style={headerStyle}>
          <span style={{ fontWeight: 600, fontSize: 'var(--text-md)', color: 'var(--color-text)' }}>
            ＋ Add decoration
          </span>
          <span
            data-testid="add-decoration-context"
            style={{
              marginLeft: 'auto',
              color: 'var(--color-text-faint)',
              fontSize: 'var(--text-xs)',
            }}
          >
            to {buildingLabel} ({cellName})
          </span>
        </div>

        <div style={{ padding: 'var(--space-4)' }}>
          <input
            type="text"
            aria-label="Search furniture templates"
            data-testid="add-decoration-search"
            placeholder="Search furniture templates…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={searchStyle}
          />

          <div data-testid="add-decoration-grid" style={gridStyle}>
            {visible.map((e) => {
              const isSel = selected === e.path;
              return (
                <div
                  key={e.path}
                  role="option"
                  aria-selected={isSel}
                  data-testid="add-decoration-tile"
                  onClick={() => setSelected(e.path)}
                  style={{
                    ...tileStyle,
                    borderColor: isSel ? 'var(--color-accent)' : 'var(--color-border-soft)',
                    background: isSel ? 'var(--color-accent-dim)' : 'var(--color-widget)',
                  }}
                >
                  <div aria-hidden="true" style={thumbStyle}>
                    {glyphFor(e.path)}
                  </div>
                  <div style={tileNameStyle}>{humanizeTemplateName(e.path)}</div>
                  <div style={tilePathStyle}>{e.path}</div>
                </div>
              );
            })}
            {visible.length === 0 && (
              <div data-testid="add-decoration-empty" style={emptyStyle}>
                No furniture templates match that search.
              </div>
            )}
          </div>
        </div>

        <div style={footerStyle}>
          <span style={previewNoteStyle}>
            {/* Honest note (Task 1's documented discretion): no mesh-viewport preview is wired to
                this modal, so the tile's full VFS path — shown on every tile — is the identity of
                what will be placed. Claiming a preview the modal cannot render would be worse
                than saying plainly that there isn't one. */}
            {truncatedBy > 0
              ? `showing ${visible.length} of ${matches.length} matches — refine the search to narrow it`
              : 'no mesh preview yet — the path on each tile is the template that will be placed'}
          </span>
          <button type="button" style={secondaryBtnStyle} onClick={handleCancel} aria-label="Cancel">
            Cancel
          </button>
          <button
            type="button"
            style={primaryBtnStyle(selected === null)}
            disabled={selected === null}
            onClick={() => {
              if (selected !== null) onPlace(selected);
            }}
            aria-label="Place in game"
          >
            Place in game ▸
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const overlayStyle: React.CSSProperties = {
  position: 'fixed', inset: 0, zIndex: 1100,
  background: 'rgba(0,0,0,0.55)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
};

const panelStyle: React.CSSProperties = {
  width: 560, maxWidth: '92vw',
  background: 'var(--color-surface)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-md)',
  boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
  overflow: 'hidden',
  fontFamily: 'var(--font-sans)',
};

const headerStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8, height: 40,
  padding: '0 var(--space-4)', background: 'var(--color-header)',
  borderBottom: '1px solid var(--color-border)',
};

const searchStyle: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box',
  background: 'var(--color-widget)',
  color: 'var(--color-text)',
  border: '1px solid var(--color-border-soft)',
  borderRadius: 'var(--radius-sm)',
  font: 'var(--text-sm)/1.4 var(--font-sans)',
  padding: '6px 8px',
  marginBottom: 'var(--space-3)',
};

const gridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(158px, 1fr))',
  gap: 8,
  maxHeight: 320,
  overflowY: 'auto',
};

const tileStyle: React.CSSProperties = {
  border: '1px solid var(--color-border-soft)',
  borderRadius: 'var(--radius-sm)',
  padding: 8,
  cursor: 'pointer',
  overflow: 'hidden',
};

const thumbStyle: React.CSSProperties = {
  fontSize: 22, textAlign: 'center', color: 'var(--color-text-faint)', marginBottom: 4,
};

const tileNameStyle: React.CSSProperties = {
  fontSize: 'var(--text-xs)', color: 'var(--color-text)',
  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
};

const tilePathStyle: React.CSSProperties = {
  fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--color-text-faint)',
  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
};

const emptyStyle: React.CSSProperties = {
  gridColumn: '1 / -1', padding: '18px 4px', textAlign: 'center',
  fontSize: 'var(--text-xs)', color: 'var(--color-text-faint)',
};

const footerStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8,
  padding: 'var(--space-3) var(--space-4)',
  borderTop: '1px solid var(--color-border)',
  background: 'var(--color-header)',
};

const previewNoteStyle: React.CSSProperties = {
  flex: 1, alignSelf: 'center',
  fontSize: 'var(--text-xs)', color: 'var(--color-text-faint)',
};

const secondaryBtnStyle: React.CSSProperties = {
  background: 'var(--color-widget)',
  color: 'var(--color-text)',
  border: '1px solid var(--color-border-soft)',
  borderRadius: 'var(--radius-sm)',
  font: '600 var(--text-xs)/1 var(--font-sans)',
  padding: '5px 10px',
  cursor: 'pointer',
};

function primaryBtnStyle(disabled: boolean): React.CSSProperties {
  return {
    ...secondaryBtnStyle,
    background: disabled ? 'var(--color-widget)' : 'var(--color-accent)',
    color: disabled ? 'var(--color-text-faint)' : 'var(--color-accent-text)',
    border: '1px solid transparent',
    cursor: disabled ? 'not-allowed' : 'pointer',
  };
}
