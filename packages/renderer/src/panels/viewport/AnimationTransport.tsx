/**
 * packages/renderer/src/panels/viewport/AnimationTransport.tsx
 *
 * Animation Transport bar — Surface 5 per 02-UI-SPEC.md.
 *
 * A 30px footer bar with:
 *   - .ans picker (populated from ansPickerOptions, loaded via the LATX chain or heuristic fallback)
 *   - Play/Pause, Prev/Next frame buttons (glyph-only, aria-label + title per Rule 5)
 *   - Scrubber: <input type=range> (keyboard ←/→ step ±1, Home/End)
 *   - Frame counter in mono: '{current}/{total} · {t}s'
 *   - Loop toggle ↺ chip
 *   - Speed chips: 0.25× / 0.5× / 1× / 2×
 *   - Skeleton-helper toggle ⊹ chip
 *
 * State boundary:
 *   - Transport BUTTONS set DISCRETE state (play/pause/loop/speed/step) via setTransportState.
 *     These are user events, NOT per-frame mutations.
 *   - The continuous frame advance happens in SkinnedMeshView.tsx useFrame (ref clock).
 *     The ref clock flushes currentFrame to the store THROTTLED (~10×/s), so the scrubber
 *     follows without per-frame Zustand churn. This component reads that throttled value.
 *
 * KFAT-0002 handling:
 *   - Selecting a KFAT-0002 animation sets a warn badge and keeps the skeleton in bind pose.
 *   - No mis-rendering — variant='KFAT-0002-unsupported' is surfaced here, not passed to useFrame.
 *
 * Accessibility: Rule 5 — every glyph-only control has aria-label + title.
 *                Rule 1 — active state uses accent fill + glyph swap (never color alone).
 *
 * Source: 02-UI-SPEC.md Surface 5; 02-PATTERNS.md § AnimationTransport.tsx
 */

import React, { useCallback, useRef } from 'react';
import { useViewportStore } from '../../state/viewportStore.js';

// ─── nativeCore for parseAnimation ───────────────────────────────────────────

/* eslint-disable @typescript-eslint/no-require-imports */
const nativeCore = require('@swg/native-core') as {
  parseIff: (bytes: ArrayBuffer | Uint8Array) => unknown;
  parseAnimation: (iff: unknown, bytes: ArrayBuffer | Uint8Array) => ViewportStore['parsedAnimation'];
  readMountEntry: (mountHandle: string, archiveIndex: number, entryIndex: number) => ArrayBuffer;
  resolveEntry: (mountHandle: string, path: string) => {
    winner: unknown;
    archiveIndex: number | undefined;
    entryIndex: number | undefined;
  };
};
/* eslint-enable @typescript-eslint/no-require-imports */

// Pull in ViewportStore type only (not the value — avoids circular dep)
import type { ViewportStore } from '../../state/viewportStore.js';

// ─── Speed options ────────────────────────────────────────────────────────────

const SPEED_OPTIONS = [0.25, 0.5, 1, 2] as const;

// ─── Component ────────────────────────────────────────────────────────────────

export default function AnimationTransport(): React.ReactElement | null {
  const {
    parsedSkeleton,
    parsedAnimation,
    transportState,
    ansPickerOptions,
    skeletonHelperVisible,
    sourceMountHandle,
    setTransportState,
    setParsedAnimation,
    setSkeletonHelperVisible,
  } = useViewportStore();

  // Warn state for KFAT-0002-unsupported selections
  const kfat0002WarnRef = useRef(false);

  const { playing, currentFrame, totalFrames, speed, loop } = transportState;

  // ─── Picker change ────────────────────────────────────────────────────────
  // NOTE: ALL hooks must run unconditionally and in a stable order — the early
  // "no skeleton" return below MUST come after every hook, or React throws
  // "rendered more hooks than during the previous render" when parsedSkeleton
  // transitions null → non-null.
  const handlePickerChange = useCallback(async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const path = e.target.value;
    if (!path || !sourceMountHandle) return;

    kfat0002WarnRef.current = false;

    try {
      const resolved = nativeCore.resolveEntry(sourceMountHandle, path);
      if (resolved.archiveIndex == null || resolved.entryIndex == null) return;

      const bytes = nativeCore.readMountEntry(
        sourceMountHandle,
        resolved.archiveIndex,
        resolved.entryIndex,
      );
      const u8 = new Uint8Array(bytes);
      const iff = nativeCore.parseIff(u8);
      const anim = nativeCore.parseAnimation(iff, u8);

      if (anim && anim.variant === 'KFAT-0002-unsupported') {
        kfat0002WarnRef.current = true;
        // Do NOT call setParsedAnimation — keep skeleton in bind pose.
        // Force a re-render by setting a no-op transport update.
        setTransportState({ playing: false, currentFrame: 0 });
        return;
      }

      if (anim) {
        setParsedAnimation(anim);
      }
    } catch (_e) {
      // Silently fail — the animation path may not resolve in the current mount.
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceMountHandle]);

  const fps = parsedAnimation?.fps ?? 30;
  const timeSec = fps > 0 ? (currentFrame / fps).toFixed(2) : '0.00';

  // ─── Scrubber handlers ────────────────────────────────────────────────────

  const handleScrub = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setTransportState({ currentFrame: Number(e.target.value), playing: false });
  }, [setTransportState]);

  const handleScrubKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowLeft')  { e.preventDefault(); setTransportState({ currentFrame: Math.max(0, currentFrame - 1), playing: false }); }
    if (e.key === 'ArrowRight') { e.preventDefault(); setTransportState({ currentFrame: Math.min(totalFrames > 0 ? totalFrames - 1 : 0, currentFrame + 1), playing: false }); }
    if (e.key === 'Home')       { e.preventDefault(); setTransportState({ currentFrame: 0, playing: false }); }
    if (e.key === 'End')        { e.preventDefault(); setTransportState({ currentFrame: totalFrames > 0 ? totalFrames - 1 : 0, playing: false }); }
  }, [currentFrame, totalFrames, setTransportState]);

  // ─── No skeleton — transport hidden (AFTER all hooks; see note above) ──────
  if (!parsedSkeleton) {
    return (
      <div style={barStyle}>
        <span style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)' }}>
          Load a skinned mesh or skeleton to animate
        </span>
      </div>
    );
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  // Compute variant label
  const variantLabel =
    parsedAnimation?.variant === 'CKAT-0001' ? 'CKAT 0001' :
    parsedAnimation?.variant === 'KFAT-0003' ? 'KFAT 0003' :
    null;

  return (
    <div style={barStyle} aria-label="Animation transport">

      {/* .ans picker */}
      <select
        value=""
        onChange={handlePickerChange}
        style={pickerStyle}
        aria-label="Choose an animation"
        title="Choose an animation"
      >
        <option value="">Choose an animation…</option>
        {ansPickerOptions.map(path => (
          <option key={path} value={path}>
            {path.split('/').pop() ?? path}
          </option>
        ))}
      </select>

      {/* Variant tag (mono) */}
      {variantLabel && (
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--color-info)', flexShrink: 0 }}>
          {variantLabel}
        </span>
      )}

      {/* KFAT-0002 warn */}
      {kfat0002WarnRef.current && (
        <span style={{ color: 'var(--color-warn)', fontSize: 'var(--text-xs)', flexShrink: 0 }}>
          ≈ unsupported legacy animation (KFAT 0002) — skipped
        </span>
      )}

      {/* Prev frame */}
      <button
        aria-label="Previous frame"
        title="Previous frame"
        style={btnStyle}
        onClick={() => setTransportState({ currentFrame: Math.max(0, currentFrame - 1), playing: false })}
        disabled={!parsedAnimation}
      >
        ⏮
      </button>

      {/* Play / Pause */}
      <button
        aria-label={playing ? 'Pause animation' : 'Play animation'}
        title={playing ? 'Pause animation' : 'Play animation'}
        style={chipStyle(playing)}
        onClick={() => setTransportState({ playing: !playing })}
        disabled={!parsedAnimation}
      >
        {playing ? '⏸' : '▶'}
      </button>

      {/* Next frame */}
      <button
        aria-label="Next frame"
        title="Next frame"
        style={btnStyle}
        onClick={() => setTransportState({ currentFrame: Math.min(totalFrames > 0 ? totalFrames - 1 : 0, currentFrame + 1), playing: false })}
        disabled={!parsedAnimation}
      >
        ⏭
      </button>

      {/* Scrubber */}
      <input
        type="range"
        min={0}
        max={totalFrames > 0 ? totalFrames - 1 : 0}
        value={currentFrame}
        onChange={handleScrub}
        onKeyDown={handleScrubKeyDown}
        disabled={!parsedAnimation}
        aria-label="Animation scrubber"
        title="Animation scrubber"
        style={scrubberStyle}
      />

      {/* Frame counter (mono) */}
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--color-text-faint)', flexShrink: 0, minWidth: 100 }}>
        {currentFrame}/{totalFrames} · {timeSec}s
      </span>

      {/* Loop toggle */}
      <button
        aria-label="Toggle loop"
        title="Toggle loop"
        style={chipStyle(loop)}
        onClick={() => setTransportState({ loop: !loop })}
      >
        ↺
      </button>

      {/* Speed chips */}
      {SPEED_OPTIONS.map(s => (
        <button
          key={s}
          aria-label={`Set speed to ${s}×`}
          title={`${s}×`}
          style={{ ...chipStyle(speed === s), fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', padding: '2px 5px' }}
          onClick={() => setTransportState({ speed: s })}
        >
          {s}×
        </button>
      ))}

      {/* Skeleton helper toggle */}
      <button
        aria-label="Toggle skeleton helper"
        title="Toggle skeleton helper"
        style={chipStyle(skeletonHelperVisible)}
        onClick={() => setSkeletonHelperVisible(!skeletonHelperVisible)}
      >
        ⊹
      </button>
    </div>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const barStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  height: 30, // = --tabstrip-h for visual rhythm
  background: 'var(--color-header)',
  borderTop: '1px solid var(--color-border)',
  padding: '0 var(--space-4)',
  gap: 'var(--space-2)',
  flexShrink: 0,
  overflowX: 'auto',
};

const pickerStyle: React.CSSProperties = {
  background: 'var(--color-surface)',
  border: '1px solid var(--color-border)',
  color: 'var(--color-text)',
  borderRadius: 'var(--radius-sm)',
  fontSize: 'var(--text-sm)',
  height: 20,
  maxWidth: 200,
  flexShrink: 1,
  cursor: 'pointer',
};

const btnStyle: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  color: 'var(--color-text-faint)',
  cursor: 'pointer',
  fontSize: 'var(--text-sm)',
  width: 22,
  height: 22,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: 'var(--radius-sm)',
  padding: 0,
  flexShrink: 0,
  transition: 'background 0.12s ease, color 0.12s ease',
};

function chipStyle(active: boolean): React.CSSProperties {
  return {
    background: active ? 'var(--color-accent)' : 'rgba(20,20,20,0.7)',
    border: `1px solid ${active ? 'var(--color-accent)' : 'var(--color-border-soft)'}`,
    color: active ? 'var(--color-accent-text)' : 'var(--color-text-muted)',
    borderRadius: 'var(--radius-sm)',
    padding: '2px 6px',
    cursor: 'pointer',
    fontSize: 'var(--text-sm)',
    backdropFilter: active ? undefined : 'blur(4px)',
    transition: 'background 0.12s ease, color 0.12s ease',
    lineHeight: 1,
    flexShrink: 0,
  };
}

const scrubberStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 60,
  height: 4,
  accentColor: 'var(--color-accent)',
  cursor: 'pointer',
};
