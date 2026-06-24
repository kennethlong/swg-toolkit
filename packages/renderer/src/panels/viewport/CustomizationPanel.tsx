/**
 * packages/renderer/src/panels/viewport/CustomizationPanel.tsx
 *
 * Live palette customization panel (D-06).
 *
 * Derives customization variables from ALL shader groups (multi-group avatars expose
 * vars on several groups). De-duplicates by variable name. Hidden when no vars present.
 *
 * Per-variable row:
 *   - Variable name (--text-sm)
 *   - Palette entries as 18×18px swatch strip, 3px gap, --radius-sm
 *   - Current selection: 2px accent ring (position + ring, not color alone — UI-SPEC Rule 1)
 *   - aria-label + title on each swatch button (Accessibility Rule 5)
 *   - Live '#AARRGGBB' readout (mono --text-xs)
 *   - 'Reset' button → defaultIndex per variable
 *
 * When palette bytes are available via slotBytes (palette-texture-factor / palette-material-color),
 * parse and display the actual RGBA swatches. Otherwise show placeholder.
 *
 * Swatch click → setCustomizationIndex(var, idx) → ShaderMaterial uniform mutation in useFrame
 * via viewportStore (zero-alloc: no new objects in useFrame).
 *
 * Source: 02-PATTERNS.md § CustomizationPanel.tsx
 *         + 02-UI-SPEC.md Surface 3
 */

import React, { useCallback, useMemo } from 'react';
import VerificationStatus from '../../shared/VerificationStatus.js';
import { useViewportStore } from '../../state/viewportStore.js';
import type { AppearanceResolutionResult } from './resolver/appearanceResolver.js';
import type { ShaderCustomizationVar, PaletteParseResult } from '@swg/contracts';

// ─── nativeCore for parsePalette ─────────────────────────────────────────────

/* eslint-disable @typescript-eslint/no-require-imports */
const nativeCore = require('@swg/native-core') as {
  parsePalette: (bytes: ArrayBuffer | Uint8Array) => PaletteParseResult;
};
/* eslint-enable @typescript-eslint/no-require-imports */

// ─── Props ────────────────────────────────────────────────────────────────────

export interface CustomizationPanelProps {
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

const varRowStyle: React.CSSProperties = {
  padding: '4px 8px',
  borderBottom: '1px solid rgba(255,255,255,0.04)',
};

const varNameStyle: React.CSSProperties = {
  fontSize: 'var(--text-sm)',
  color: 'var(--color-text-muted)',
  marginBottom: 2,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const monoStyle: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: 'var(--text-xs)',
  color: 'var(--color-text-faint)',
};

const swatchRowStyle: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 3,
  marginTop: 4,
  marginBottom: 4,
};

const resetBtnStyle: React.CSSProperties = {
  background: 'transparent',
  border: '1px solid var(--color-border-soft)',
  color: 'var(--color-text-faint)',
  borderRadius: 'var(--radius-sm)',
  padding: '2px 6px',
  cursor: 'pointer',
  fontSize: 'var(--text-xs)',
  fontFamily: 'var(--font-sans)',
  marginTop: 2,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toArgbHex(r: number, g: number, b: number, a: number): string {
  const hex = (v: number) => v.toString(16).padStart(2, '0').toUpperCase();
  return `#${hex(a)}${hex(r)}${hex(g)}${hex(b)}`;
}

function rgbToCssColor(r: number, g: number, b: number): string {
  return `rgb(${r},${g},${b})`;
}

// ─── Palette loader (parses .pal bytes from slotBytes) ────────────────────────

/**
 * Given a customization var, find its palette bytes in the resolution slotBytes.
 * The palette path is stored in cVar.palettePath; the resolver fetches .pal bytes
 * into slotBytes under a custom key derived from the palette path filename.
 * Since ShaderSlotName doesn't cover palette files directly, we look for bytes
 * whose palette path filename matches across all materials.
 *
 * Returns null if palette bytes are not found (show placeholder UI).
 */
function findPaletteBytes(
  resolution: AppearanceResolutionResult,
  cVar: ShaderCustomizationVar,
): ArrayBuffer | null {
  // The resolver stores palette bytes under the slot name when the pathway is
  // palette-texture-factor or palette-material-color. The key used is the
  // ShaderSlotName that the customization var affects (affectedSlot).
  // Since palette bytes aren't stored with a standard slot key in the current
  // resolver implementation, we check if any slotBytes value is a .pal file
  // by trying to parse it. As a heuristic, look at materials for the affectedSlot
  // or return null and rely on the color swatch display without parsed palette.
  // Full wiring would require the resolver to also store palettePath→bytes.
  for (const mat of resolution.materials) {
    const affectedSlot = cVar.affectedSlot;
    if (affectedSlot) {
      const bytes = mat.slotBytes[affectedSlot];
      if (bytes) return bytes;
    }
  }
  return null;
}

/**
 * Parse a palette from raw bytes (silently return null on failure).
 */
function parsePaletteSafe(bytes: ArrayBuffer): PaletteParseResult | null {
  try {
    return nativeCore.parsePalette(new Uint8Array(bytes));
  } catch (_e) {
    return null;
  }
}

// ─── One swatch button ────────────────────────────────────────────────────────

interface SwatchProps {
  varName: string;
  index: number;
  r: number;
  g: number;
  b: number;
  a: number;
  isSelected: boolean;
  onSelect: (varName: string, index: number) => void;
}

function Swatch({ varName, index, r, g, b, a, isSelected, onSelect }: SwatchProps): React.ReactElement {
  const argbHex = toArgbHex(r, g, b, a);
  return (
    <button
      style={{
        width: 18,
        height: 18,
        background: rgbToCssColor(r, g, b),
        borderRadius: 'var(--radius-sm)',
        border: isSelected ? '2px solid var(--color-accent)' : '2px solid transparent',
        outline: isSelected ? '1px solid rgba(255,255,255,0.3)' : 'none',
        cursor: 'pointer',
        padding: 0,
        flexShrink: 0,
        opacity: a < 255 ? a / 255 * 0.7 + 0.3 : 1,
      }}
      aria-label={`Set ${varName} to palette index ${index}`}
      title={argbHex}
      onClick={() => onSelect(varName, index)}
    />
  );
}

// ─── One variable row ─────────────────────────────────────────────────────────

interface VarRowProps {
  cVar: ShaderCustomizationVar;
  currentIndex: number;
  palette: PaletteParseResult | null;
  onSelect: (varName: string, index: number) => void;
  onReset: (varName: string, defaultIndex: number) => void;
}

function VarRow({ cVar, currentIndex, palette, onSelect, onReset }: VarRowProps): React.ReactElement {
  const clampedIdx = palette
    ? Math.max(0, Math.min(currentIndex, palette.entryCount - 1))
    : currentIndex;

  const currentEntry = palette?.entries[clampedIdx];
  const currentArgbHex = currentEntry
    ? toArgbHex(currentEntry.r, currentEntry.g, currentEntry.b, currentEntry.a)
    : '#FFFFFFFF';

  // T-02-13: ui swatch strip is bounded by entryCount
  const swatchCount = palette ? palette.entryCount : 0;

  return (
    <div style={varRowStyle}>
      {/* Variable name + current index */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'space-between' }}>
        <span style={varNameStyle} title={cVar.name}>{cVar.name}</span>
        <button
          style={resetBtnStyle}
          onClick={() => onReset(cVar.name, cVar.defaultIndex)}
          aria-label={`Reset ${cVar.name} to default`}
          title={`Reset to index ${cVar.defaultIndex}`}
        >
          Reset
        </button>
      </div>

      {/* Palette path + current value (mono) */}
      <div style={{ ...monoStyle, marginBottom: 3 }}>
        {cVar.palettePath.split('/').pop() ?? cVar.palettePath}
        {' '}
        <span style={{ color: 'var(--color-text-muted)' }}>
          [{clampedIdx}] {currentArgbHex}
        </span>
      </div>

      {/* Swatch strip */}
      {palette ? (
        <div style={swatchRowStyle}>
          {Array.from({ length: swatchCount }, (_, i) => {
            const entry = palette.entries[i];
            if (!entry) return null;
            return (
              <Swatch
                key={i}
                varName={cVar.name}
                index={i}
                r={entry.r}
                g={entry.g}
                b={entry.b}
                a={entry.a}
                isSelected={i === clampedIdx}
                onSelect={onSelect}
              />
            );
          })}
        </div>
      ) : (
        // Palette bytes not available — show warning
        <VerificationStatus
          variant="warn"
          caption={`palette missing: ${cVar.palettePath.split('/').pop() ?? cVar.palettePath} — showing default tint`}
        />
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function CustomizationPanel({
  resolution,
}: CustomizationPanelProps): React.ReactElement | null {
  const { customizationIndices, setCustomizationIndex } = useViewportStore(s => ({
    customizationIndices: s.customizationIndices,
    setCustomizationIndex: s.setCustomizationIndex,
  }));

  // Derive customization vars from ALL groups (multi-group avatars)
  const allVars = useMemo((): ShaderCustomizationVar[] => {
    if (!resolution) return [];
    const seen = new Set<string>();
    const vars: ShaderCustomizationVar[] = [];
    for (const mat of resolution.materials) {
      for (const cVar of mat.shaderResult.customizationVars) {
        if (!seen.has(cVar.name)) {
          seen.add(cVar.name);
          vars.push(cVar);
        }
      }
    }
    return vars;
  }, [resolution]);

  // Parse palette for each var (derive from slotBytes when available)
  const palettes = useMemo((): Map<string, PaletteParseResult | null> => {
    const map = new Map<string, PaletteParseResult | null>();
    if (!resolution) return map;
    for (const cVar of allVars) {
      const bytes = findPaletteBytes(resolution, cVar);
      map.set(cVar.name, bytes ? parsePaletteSafe(bytes) : null);
    }
    return map;
  }, [resolution, allVars]);

  const handleSwatchClick = useCallback((varName: string, index: number) => {
    setCustomizationIndex(varName, index);
  }, [setCustomizationIndex]);

  const handleReset = useCallback((varName: string, defaultIndex: number) => {
    setCustomizationIndex(varName, defaultIndex);
  }, [setCustomizationIndex]);

  // Hide if no customization vars
  if (allVars.length === 0) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <div style={sectionHeadStyle}>Customization</div>
      {allVars.map(cVar => (
        <VarRow
          key={cVar.name}
          cVar={cVar}
          currentIndex={customizationIndices[cVar.name] ?? cVar.defaultIndex}
          palette={palettes.get(cVar.name) ?? null}
          onSelect={handleSwatchClick}
          onReset={handleReset}
        />
      ))}
    </div>
  );
}
