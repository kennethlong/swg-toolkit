/**
 * packages/renderer/src/panels/viewport/MaterialInspector.tsx
 *
 * Read-only material inspector surface (D-07 multi-map parity inspector).
 *
 * Shows ONE block per shader group (multi-group avatars have multiple blocks).
 * Per block:
 *   - Group label (shader .sht path filename)
 *   - Per-slot rows: slot name, texture filename (mono, ellipsis), format+dims (mono)
 *     e.g. 'DXT5 · 512×512 · 9 mips'
 *   - Unresolved slot: '— none'
 *   - CPU-decoded slot: VerificationStatus warn "CPU-decoded"
 *   - S3TC absent: VerificationStatus warn "S3TC unavailable — using CPU decode"
 *   - Per-group provenance: shader chain + byte-exact ✓ when round-trip passed
 *   - Missing texture: VerificationStatus warn "missing: {name} — magenta placeholder"
 *
 * Reads s3tcWarning from viewportStore.
 *
 * Source: 02-PATTERNS.md § MaterialInspector.tsx
 *         + 02-UI-SPEC.md Surface 4
 */

import React, { useMemo } from 'react';
import VerificationStatus from '../../shared/VerificationStatus.js';
import { useViewportStore } from '../../state/viewportStore.js';
import type { AppearanceResolutionResult, ResolvedMaterial } from './resolver/appearanceResolver.js';
import type { ShaderSlotName, DdsParseResult } from '@swg/contracts';

// ─── nativeCore for parseDds ─────────────────────────────────────────────────

/* eslint-disable @typescript-eslint/no-require-imports */
const nativeCore = require('@swg/native-core') as {
  parseDds: (bytes: ArrayBuffer | Uint8Array) => DdsParseResult;
};
/* eslint-enable @typescript-eslint/no-require-imports */

// ─── Props ────────────────────────────────────────────────────────────────────

export interface MaterialInspectorProps {
  resolution: AppearanceResolutionResult | null;
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const sectionHeadStyle: React.CSSProperties = {
  fontSize: 'var(--text-sm)',
  fontWeight: 600,
  color: 'var(--color-text-muted)',
  padding: '6px 8px 4px',
  borderBottom: '1px solid var(--color-border)',
  userSelect: 'none',
};

const groupHeadStyle: React.CSSProperties = {
  fontSize: 'var(--text-xs)',
  fontWeight: 600,
  color: 'var(--color-text)',
  padding: '5px 8px 3px',
  background: 'rgba(255,255,255,0.03)',
  borderTop: '1px solid var(--color-border)',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const slotRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  padding: '2px 8px',
  gap: 6,
  flexDirection: 'column',
};

const slotNameStyle: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: 'var(--text-xs)',
  color: 'var(--color-text-muted)',
  minWidth: 36,
  flexShrink: 0,
};

const monoFaintStyle: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: 'var(--text-xs)',
  color: 'var(--color-text-faint)',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  maxWidth: 160,
};

const provenanceStyle: React.CSSProperties = {
  padding: '3px 8px 4px',
  fontFamily: 'var(--font-mono)',
  fontSize: 'var(--text-xs)',
  color: 'var(--color-text-faint)',
  borderBottom: '1px solid rgba(255,255,255,0.04)',
};

const emptyStyle: React.CSSProperties = {
  padding: '8px',
  fontFamily: 'var(--font-mono)',
  fontSize: 'var(--text-xs)',
  color: 'var(--color-text-faint)',
};

// ─── Known slot names in display order ───────────────────────────────────────

const SLOT_DISPLAY_ORDER: ShaderSlotName[] = [
  'MAIN', 'NRML', 'CNRM', 'SPEC', 'EMIS', 'ENVM', 'MASK',
];

// ─── DDS format label from raw bytes ─────────────────────────────────────────

interface DdsInfo {
  label: string;  // e.g. "DXT5 · 512×512 · 9 mips"
}

function parseDdsInfo(bytes: ArrayBuffer): DdsInfo | null {
  try {
    const result = nativeCore.parseDds(new Uint8Array(bytes));
    const fmt = result.mips[0]?.format ?? 'unknown';
    return { label: `${fmt} · ${result.width}×${result.height} · ${result.mipCount} mips` };
  } catch (_e) {
    return null;
  }
}

// ─── One slot row ─────────────────────────────────────────────────────────────

interface SlotRowInfo {
  slot: ShaderSlotName;
  texturePath: string | null;
  bytes: ArrayBuffer | null | undefined;
  s3tcWarning: string | null;
}

function SlotRow({ slot, texturePath, bytes, s3tcWarning }: SlotRowInfo): React.ReactElement {
  const filename = texturePath ? (texturePath.split('/').pop() ?? texturePath) : null;
  const ddsInfo = bytes ? parseDdsInfo(bytes) : null;

  return (
    <div style={{ padding: '2px 8px 4px', borderBottom: '1px solid rgba(255,255,255,0.02)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={slotNameStyle}>{slot}</span>
        {filename ? (
          <span style={monoFaintStyle} title={texturePath ?? undefined}>{filename}</span>
        ) : (
          <span style={{ ...monoFaintStyle, color: 'rgba(255,255,255,0.2)' }}>— none</span>
        )}
      </div>
      {ddsInfo && (
        <div style={{ paddingLeft: 42 }}>
          <span style={{ ...monoFaintStyle, color: 'rgba(255,255,255,0.35)', fontSize: 'var(--text-xs)' }}>
            {ddsInfo.label}
          </span>
        </div>
      )}
      {filename && !bytes && (
        <div style={{ paddingLeft: 42 }}>
          <VerificationStatus
            variant="warn"
            caption={`missing: ${filename} — magenta placeholder`}
          />
        </div>
      )}
      {bytes && !ddsInfo && (
        <div style={{ paddingLeft: 42 }}>
          <VerificationStatus variant="warn" caption="DDS parse error — placeholder used" />
        </div>
      )}
      {bytes && s3tcWarning && slot === 'MAIN' && (
        <div style={{ paddingLeft: 42 }}>
          <VerificationStatus variant="warn" caption="S3TC unavailable — using CPU decode" />
        </div>
      )}
    </div>
  );
}

// ─── One material group block ─────────────────────────────────────────────────

interface GroupBlockProps {
  groupIndex: number;
  mat: ResolvedMaterial;
  s3tcWarning: string | null;
}

function GroupBlock({ groupIndex, mat, s3tcWarning }: GroupBlockProps): React.ReactElement {
  const shaderName = mat.shaderResult.effectPath || mat.shaderResult.variant;
  const shaderFilename = shaderName.split('/').pop() ?? shaderName;

  // Collect all slots in display order: defined slots first, then ENVM placeholder
  const renderedSlots = useMemo(() => {
    const rendered: React.ReactElement[] = [];
    for (const slot of SLOT_DISPLAY_ORDER) {
      const slotDef = mat.shaderResult.slots.find(s => s.slot === slot);
      if (!slotDef) continue; // slot not declared in this shader
      const bytes = mat.slotBytes[slot];
      rendered.push(
        <SlotRow
          key={slot}
          slot={slot}
          texturePath={slotDef.texturePath}
          bytes={bytes}
          s3tcWarning={s3tcWarning}
        />,
      );
    }
    return rendered;
  }, [mat, s3tcWarning]);

  const roundTripPassed = mat.shaderResult.roundTrip?.passed ?? false;

  return (
    <div style={{ borderBottom: '1px solid var(--color-border)' }}>
      {/* Group header */}
      <div style={groupHeadStyle} title={shaderName}>
        Group {groupIndex}: {shaderFilename}
      </div>

      {/* Slot rows */}
      {renderedSlots.length > 0 ? renderedSlots : (
        <div style={{ padding: '4px 8px' }}>
          <span style={{ ...monoFaintStyle, color: 'rgba(255,255,255,0.2)' }}>No texture slots</span>
        </div>
      )}

      {/* Provenance line */}
      <div style={provenanceStyle}>
        <span style={{ color: 'rgba(255,255,255,0.3)' }}>
          {mat.shaderResult.variant}
        </span>
        {' '}
        {roundTripPassed ? (
          <VerificationStatus variant="pass" caption="byte-exact ✓" />
        ) : (
          <VerificationStatus variant="warn" caption="round-trip not verified" />
        )}
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function MaterialInspector({
  resolution,
}: MaterialInspectorProps): React.ReactElement {
  const { s3tcWarning } = useViewportStore(s => ({ s3tcWarning: s.s3tcWarning }));

  if (!resolution || resolution.materials.length === 0) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <div style={sectionHeadStyle}>Material</div>
        <div style={emptyStyle}>No material loaded</div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <div style={sectionHeadStyle}>Material</div>

      {/* S3TC global warning (shown once at top when absent) */}
      {s3tcWarning && (
        <div style={{ padding: '4px 8px' }}>
          <VerificationStatus variant="warn" caption="S3TC unavailable — using CPU decode" />
        </div>
      )}

      {/* One block per shader group */}
      {resolution.materials.map((mat, i) => (
        <GroupBlock
          key={i}
          groupIndex={i}
          mat={mat}
          s3tcWarning={s3tcWarning}
        />
      ))}
    </div>
  );
}
