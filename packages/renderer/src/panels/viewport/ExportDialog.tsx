/**
 * packages/renderer/src/panels/viewport/ExportDialog.tsx
 *
 * ExportDialog — modal for glTF (.glb) export and raw-byte Extract.
 *
 * SURFACE 7 (VIEW-05)
 * ────────────────────
 * Two actions exposed from ViewportPanel header buttons ("Export…" / "Extract…"):
 *
 *   Export → glTF (.glb):
 *     1. Show options: Include Skeleton (default: true) + Include Animation (default: true,
 *        enabled only when parsedAnimation is set).
 *     2. On confirm: getLiveScene() → buildExportScene() → GLTFExporter.parseAsync() →
 *        .glb ArrayBuffer → download as {basename}.glb.
 *     3. Show AsyncProgress "Exporting glTF…" during export.
 *     4. Show VerificationStatus pass "exported {filename}" on success.
 *     5. Show VerificationStatus fail on error with a Retry button.
 *
 *   Extract → raw bytes:
 *     - Reads sourceMountHandle + sourceArchiveIndex + sourceEntryIndex from viewportStore.
 *     - Calls nativeCore.readMountEntry(handle, archiveIndex, entryIndex) → ArrayBuffer.
 *     - Downloads as the original filename (sourceEntryPath basename).
 *     - No dialog needed: fire immediately when the button is clicked.
 *     - Success / error shown as VerificationStatus (inline, near button) via store.
 *
 * NOTES
 * ─────
 * - glTF ONLY: ColladaExporter was removed from three@0.184.0. No format radio.
 * - THREE.ShaderMaterial is converted to MeshStandardMaterial (toStandardMaterial).
 * - DXT CompressedTexture is CPU-decoded to RGBA DataTexture (decodeDxt).
 * - X-mirror is BAKED into the deep clone (applyXMirror). The live scene is never touched.
 * - Compose-then-mirror (L5): animation quats are composed (postMul·key·bindRot·preMul),
 *   THEN mirrored. Raw-key mirroring would be wrong.
 * - Extract is read-only (D-10): never writes to or mutates the mounted archive.
 *
 * Source: 02-05-PLAN.md Task 1, 02-UI-SPEC.md Surface 7 (VIEW-05).
 *         getLiveScene() (Viewport.tsx), buildExportScene, buildAnimationClip, GLTFExporter.
 */

import React, { useState, useCallback } from 'react';
import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { useViewportStore } from '../../state/viewportStore.js';
import { getLiveScene } from './Viewport.js';
import { buildExportScene } from './export/buildExportScene.js';
import { buildAnimationClip } from './export/buildAnimationClip.js';
import AsyncProgress from '../../shared/AsyncProgress.js';
import VerificationStatus from '../../shared/VerificationStatus.js';

// ─── nativeCore for readMountEntry (Extract path) ────────────────────────────
/* eslint-disable @typescript-eslint/no-require-imports */
const nativeCore = require('@swg/native-core') as {
  readMountEntry: (handle: string, archiveIndex: number, entryIndex: number) => ArrayBuffer;
};
/* eslint-enable @typescript-eslint/no-require-imports */

// ─── Types ────────────────────────────────────────────────────────────────────

type ExportPhase =
  | { kind: 'idle' }
  | { kind: 'exporting' }
  | { kind: 'done'; filename: string }
  | { kind: 'error'; message: string };

// ─── Download helper ──────────────────────────────────────────────────────────

function downloadBlob(blob: Blob, filename: string): void {
  const url    = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href     = url;
  anchor.download = filename;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

// ─── ExportDialog component ───────────────────────────────────────────────────

export default function ExportDialog(): React.ReactElement | null {
  const {
    exportDialogOpen,
    setExportDialogOpen,
    parsedSkeleton,
    parsedAnimation,
    sourceMountHandle,
    sourceArchiveIndex,
    sourceEntryIndex,
    sourceEntryPath,
    loadStatus,
    setLastExportFilename,
  } = useViewportStore();

  const [includeSkeleton,  setIncludeSkeleton]  = useState(true);
  const [includeAnimation, setIncludeAnimation] = useState(true);
  const [phase, setPhase] = useState<ExportPhase>({ kind: 'idle' });

  const isDone = loadStatus.kind === 'done';
  const baseFilename = isDone && 'filename' in loadStatus
    ? (loadStatus.filename.split('/').pop()?.split('.')[0] ?? 'model')
    : 'model';

  const canAnimate = !!parsedAnimation && includeSkeleton;
  const hasSkeleton = !!parsedSkeleton;

  // ── Export handler ──────────────────────────────────────────────────────────
  const handleExport = useCallback(async () => {
    const scene = getLiveScene();
    if (!scene) {
      setPhase({ kind: 'error', message: 'No scene loaded — open a mesh first.' });
      return;
    }
    if (!parsedSkeleton) {
      setPhase({ kind: 'error', message: 'No skeleton data — cannot export skinned mesh.' });
      return;
    }

    setPhase({ kind: 'exporting' });

    try {
      // Build export clone (deep clone + material conversion; live scene untouched)
      const exportRoot = buildExportScene(scene, parsedSkeleton, {
        includeSkeleton,
        includeAnimation,
      });

      // Build animation clip if requested and available
      let clip: THREE.AnimationClip | null = null;
      if (includeAnimation && canAnimate && parsedAnimation) {
        clip = buildAnimationClip(parsedAnimation, parsedSkeleton);
        if (!clip) {
          console.warn('[ExportDialog] buildAnimationClip returned null — exporting without animation.');
        }
      }

      // GLTFExporter.parseAsync returns ArrayBuffer when binary: true
      const exporter = new GLTFExporter();
      const glb = await exporter.parseAsync(exportRoot, {
        binary:     true,
        animations: clip ? [clip] : [],
        // includeCustomExtensions: false (default)
      }) as ArrayBuffer;

      const filename = `${baseFilename}.glb`;
      downloadBlob(new Blob([glb], { type: 'model/gltf-binary' }), filename);

      setLastExportFilename(filename);
      setPhase({ kind: 'done', filename });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[ExportDialog] Export failed:', err);
      setPhase({ kind: 'error', message: msg });
    }
  }, [
    parsedSkeleton, parsedAnimation, includeSkeleton, includeAnimation,
    canAnimate, baseFilename, setLastExportFilename,
  ]);

  const handleRetry = useCallback(() => {
    setPhase({ kind: 'idle' });
  }, []);

  const handleClose = useCallback(() => {
    setExportDialogOpen(false);
    setPhase({ kind: 'idle' });
  }, [setExportDialogOpen]);

  if (!exportDialogOpen) return null;

  // ── Modal render ─────────────────────────────────────────────────────────────
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Export / Extract"
      style={overlayStyle}
      onClick={handleClose} // clicking backdrop closes
    >
      <div
        style={panelStyle}
        onClick={e => e.stopPropagation()} // prevent backdrop close inside panel
      >
        {/* Header */}
        <div style={headerStyle}>
          <span style={{ fontWeight: 600, fontSize: 'var(--text-sm)', color: 'var(--color-text)' }}>
            Export / Extract
          </span>
          <button
            aria-label="Close export dialog"
            title="Close"
            onClick={handleClose}
            style={closeBtnStyle}
          >
            ×
          </button>
        </div>

        {/* Divider */}
        <div style={{ height: 1, background: 'var(--color-border)' }} />

        {/* glTF Export section */}
        <div style={sectionStyle}>
          <div style={sectionTitleStyle}>
            Export as glTF 2.0 (.glb)
          </div>

          {/* Y-up · X-mirror notice */}
          <div style={noteStyle}>
            Y-up · X-mirror applied · ShaderMaterial → PBR
          </div>

          {/* Options */}
          <label style={checkboxRowStyle}>
            <input
              type="checkbox"
              checked={includeSkeleton}
              disabled={!hasSkeleton}
              onChange={e => setIncludeSkeleton(e.target.checked)}
              style={{ accentColor: 'var(--color-accent)' }}
            />
            <span style={checkboxLabelStyle}>
              Include Skeleton
              {!hasSkeleton && <span style={dimStyle}> (no skeleton)</span>}
            </span>
          </label>

          <label style={checkboxRowStyle}>
            <input
              type="checkbox"
              checked={includeAnimation && canAnimate}
              disabled={!canAnimate}
              onChange={e => setIncludeAnimation(e.target.checked)}
              style={{ accentColor: 'var(--color-accent)' }}
            />
            <span style={checkboxLabelStyle}>
              Include Animation
              {!parsedAnimation && <span style={dimStyle}> (no animation loaded)</span>}
              {parsedAnimation && !includeSkeleton && <span style={dimStyle}> (requires skeleton)</span>}
            </span>
          </label>

          {/* Progress / status / action */}
          <div style={{ marginTop: 'var(--space-3)' }}>
            {phase.kind === 'idle' && (
              <button
                aria-label="Export glTF"
                title="Export as .glb"
                onClick={handleExport}
                disabled={!isDone}
                style={primaryBtnStyle(!isDone)}
              >
                Export…
              </button>
            )}

            {phase.kind === 'exporting' && (
              <AsyncProgress caption="Exporting glTF…" />
            )}

            {phase.kind === 'done' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                <VerificationStatus variant="pass" caption={`exported ${phase.filename}`} />
                <button
                  aria-label="Export again"
                  onClick={handleRetry}
                  style={secondaryBtnStyle}
                >
                  Again
                </button>
              </div>
            )}

            {phase.kind === 'error' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                <VerificationStatus
                  variant="fail"
                  caption={`Export failed: ${phase.message.slice(0, 80)}`}
                  ariaLabel="Export failed"
                />
                <button
                  aria-label="Retry export"
                  onClick={handleRetry}
                  style={secondaryBtnStyle}
                >
                  Retry
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Divider */}
        <div style={{ height: 1, background: 'var(--color-border)' }} />

        {/* Extract section */}
        <ExtractSection
          mountHandle={sourceMountHandle}
          archiveIndex={sourceArchiveIndex}
          entryIndex={sourceEntryIndex}
          entryPath={sourceEntryPath}
          isDone={isDone}
        />
      </div>
    </div>
  );
}

// ─── Extract section ──────────────────────────────────────────────────────────

interface ExtractSectionProps {
  mountHandle:  string | null;
  archiveIndex: number | null;
  entryIndex:   number | null;
  entryPath:    string | null;
  isDone:       boolean;
}

type ExtractPhase =
  | { kind: 'idle' }
  | { kind: 'done'; filename: string; bytes: number }
  | { kind: 'error'; message: string };

function ExtractSection({
  mountHandle, archiveIndex, entryIndex, entryPath, isDone,
}: ExtractSectionProps): React.ReactElement {
  const [phase, setPhase] = useState<ExtractPhase>({ kind: 'idle' });

  const canExtract = isDone && mountHandle !== null && archiveIndex !== null && entryIndex !== null;
  const filename   = entryPath?.split('/').pop() ?? 'entry.bin';

  const handleExtract = useCallback(() => {
    if (!canExtract || mountHandle === null || archiveIndex === null || entryIndex === null) return;

    try {
      // readMountEntry is synchronous (in-process native, <1 ms for typical entries)
      const bytes = nativeCore.readMountEntry(mountHandle, archiveIndex, entryIndex);
      downloadBlob(new Blob([bytes], { type: 'application/octet-stream' }), filename);
      setPhase({ kind: 'done', filename, bytes: bytes.byteLength });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[ExportDialog] Extract failed:', err);
      setPhase({ kind: 'error', message: msg });
    }
  }, [canExtract, mountHandle, archiveIndex, entryIndex, filename]);

  return (
    <div style={sectionStyle}>
      <div style={sectionTitleStyle}>
        Extract raw bytes
      </div>

      <div style={noteStyle}>
        {canExtract ? `Source: ${entryPath ?? filename}` : 'No entry loaded'}
      </div>

      <div style={{ marginTop: 'var(--space-3)' }}>
        {(phase.kind === 'idle' || phase.kind === 'error') && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            <button
              aria-label="Extract raw bytes"
              title={canExtract ? `Extract ${filename}` : 'No entry loaded'}
              disabled={!canExtract}
              onClick={handleExtract}
              style={primaryBtnStyle(!canExtract)}
            >
              Extract…
            </button>
            {phase.kind === 'error' && (
              <VerificationStatus
                variant="fail"
                caption={`Extract failed: ${phase.message.slice(0, 80)}`}
                ariaLabel="Extract failed"
              />
            )}
          </div>
        )}

        {phase.kind === 'done' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <VerificationStatus
              variant="pass"
              caption={`extracted ${phase.filename} (${(phase.bytes / 1024).toFixed(1)} KB)`}
            />
            <button
              aria-label="Extract again"
              onClick={() => setPhase({ kind: 'idle' })}
              style={secondaryBtnStyle}
            >
              Again
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const overlayStyle: React.CSSProperties = {
  position:       'fixed',
  inset:          0,
  background:     'rgba(0, 0, 0, 0.55)',
  display:        'flex',
  alignItems:     'center',
  justifyContent: 'center',
  zIndex:         50,
};

const panelStyle: React.CSSProperties = {
  background:  'var(--color-surface)',
  border:      '1px solid var(--color-border)',
  borderRadius: 'var(--radius-md)',
  boxShadow:   '0 8px 32px rgba(0,0,0,0.6)',
  width:       320,
  maxWidth:    '90vw',
  display:     'flex',
  flexDirection: 'column',
  overflow:    'hidden',
};

const headerStyle: React.CSSProperties = {
  display:        'flex',
  alignItems:     'center',
  justifyContent: 'space-between',
  padding:        'var(--space-3) var(--space-4)',
};

const closeBtnStyle: React.CSSProperties = {
  background:    'transparent',
  border:        'none',
  color:         'var(--color-text-faint)',
  cursor:        'pointer',
  fontSize:      'var(--text-md)',
  width:         22,
  height:        22,
  display:       'flex',
  alignItems:    'center',
  justifyContent:'center',
  borderRadius:  'var(--radius-sm)',
  padding:       0,
};

const sectionStyle: React.CSSProperties = {
  display:       'flex',
  flexDirection: 'column',
  gap:           'var(--space-2)',
  padding:       'var(--space-4)',
};

const sectionTitleStyle: React.CSSProperties = {
  fontSize:   'var(--text-xs)',
  fontWeight: 600,
  color:      'var(--color-text-muted)',
  letterSpacing: '0.03em',
  textTransform: 'uppercase',
};

const noteStyle: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize:   'var(--text-xs)',
  color:      'var(--color-text-faint)',
};

const checkboxRowStyle: React.CSSProperties = {
  display:    'flex',
  alignItems: 'center',
  gap:        'var(--space-2)',
  cursor:     'pointer',
};

const checkboxLabelStyle: React.CSSProperties = {
  fontSize: 'var(--text-sm)',
  color:    'var(--color-text)',
};

const dimStyle: React.CSSProperties = {
  color:    'var(--color-text-faint)',
  fontSize: 'var(--text-xs)',
};

function primaryBtnStyle(disabled: boolean): React.CSSProperties {
  return {
    background:   disabled ? 'var(--color-widget)' : 'var(--color-accent)',
    border:       'none',
    color:        disabled ? 'var(--color-text-faint)' : 'var(--color-accent-text)',
    borderRadius: 'var(--radius-sm)',
    padding:      '6px 16px',
    cursor:       disabled ? 'not-allowed' : 'pointer',
    fontSize:     'var(--text-sm)',
    fontWeight:   600,
    opacity:      disabled ? 0.6 : 1,
    transition:   'opacity 0.1s ease',
  };
}

const secondaryBtnStyle: React.CSSProperties = {
  background:   'transparent',
  border:       '1px solid var(--color-border)',
  color:        'var(--color-text-muted)',
  borderRadius: 'var(--radius-sm)',
  padding:      '3px 10px',
  cursor:       'pointer',
  fontSize:     'var(--text-xs)',
};
