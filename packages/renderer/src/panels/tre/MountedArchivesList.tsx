/**
 * packages/renderer/src/panels/tre/MountedArchivesList.tsx — Priority-ordered archive list.
 *
 * Displays mounted archives in priority order, highest first:
 *   Priority index badge (#1, mono) · filename · version chip · entry count
 *   ONLY v6000 rows carry the "≈ enumerate-only (encrypted)" warn chip.
 *   v0006 rows are readable and carry NO warn chip.
 *   Drag handle ⠿ for future reorder (deferred — priority index shown for now).
 *
 * Source: 01-UI-SPEC.md § "Surface 1 — Mounted Archives list";
 *         01-02-PLAN.md § "must_haves" (v6000 NOT v0006 gets warn chip).
 *
 * Accessibility Rule 5: aria-label + title on all icon-only and chip controls.
 */

import React from 'react';
import type { MountedArchive } from '../../state/treStore.ts';

interface MountedArchivesListProps {
  archives: MountedArchive[];
}

export default function MountedArchivesList({
  archives,
}: MountedArchivesListProps): React.ReactElement {
  if (archives.length === 0) {
    return <></>;
  }

  return (
    <div style={{ flexShrink: 0 }}>
      {/* Section head */}
      <div
        style={{
          fontSize: 'var(--text-md)',
          fontWeight: 600,
          fontFamily: 'var(--font-sans)',
          color: 'var(--color-text)',
          padding: 'var(--space-3) var(--space-4) var(--space-2)',
          borderBottom: '1px solid var(--color-border)',
        }}
      >
        Mounted Archives
      </div>

      {/* Archive rows */}
      {archives.map((arc, displayIdx) => (
        <ArchiveRow key={arc.path} archive={arc} displayIndex={displayIdx + 1} />
      ))}
    </div>
  );
}

function ArchiveRow({
  archive,
  displayIndex,
}: {
  archive: MountedArchive;
  displayIndex: number;
}): React.ReactElement {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-2)',
        padding: 'var(--space-2) var(--space-4)',
        borderBottom: '1px solid var(--color-border)',
        background: 'var(--color-surface)',
      }}
    >
      {/* Drag handle (deferred reorder — still rendered for future use) */}
      <span
        title="Drag to reorder priority"
        style={{
          color: 'var(--color-text-faint)',
          cursor: 'grab',
          fontFamily: 'var(--font-mono)',
          fontSize: 'var(--text-sm)',
          flexShrink: 0,
          userSelect: 'none',
        }}
        aria-hidden="true"
      >
        ⠿
      </span>

      {/* Priority index badge */}
      <span
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 'var(--text-xs)',
          color: 'var(--color-text-faint)',
          flexShrink: 0,
          minWidth: 20,
        }}
      >
        #{displayIndex}
      </span>

      {/* Filename */}
      <span
        style={{
          fontSize: 'var(--text-sm)',
          fontFamily: 'var(--font-sans)',
          color: 'var(--color-text)',
          flex: 1,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
        title={archive.path}
      >
        {archive.filename}
      </span>

      {/* Version chip */}
      <span
        title={`TRE format version ${archive.version}`}
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 'var(--text-xs)',
          color: 'var(--color-text-faint)',
          background: 'var(--color-widget)',
          border: '1px solid var(--color-border-soft)',
          borderRadius: 'var(--radius-sm)',
          padding: '0 var(--space-1)',
          flexShrink: 0,
        }}
      >
        {archive.version}
      </span>

      {/* v6000-only enumerate-only warn chip.
           Source: 01-02-PLAN.md must_haves — ONLY v6000, NOT v0006.
           v0006 is readable; v6000 is encrypted/enumerate-only.
           Accessibility Rule 1: glyph (≈) + warn color + caption. */}
      {archive.isEnumerateOnly && (
        <span
          title="enumerate-only (encrypted) — payloads not extractable"
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--text-xs)',
            color: 'var(--color-warn)',
            background: 'rgba(224, 161, 58, 0.12)',
            border: '1px solid rgba(224, 161, 58, 0.35)',
            borderRadius: 'var(--radius-sm)',
            padding: '0 var(--space-1)',
            flexShrink: 0,
            whiteSpace: 'nowrap',
          }}
        >
          ≈ enumerate-only (encrypted)
        </span>
      )}

      {/* Entry count */}
      <span
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 'var(--text-xs)',
          color: 'var(--color-text-faint)',
          flexShrink: 0,
          textAlign: 'right',
          minWidth: 40,
        }}
      >
        {archive.entryCount.toLocaleString()}
      </span>
    </div>
  );
}
