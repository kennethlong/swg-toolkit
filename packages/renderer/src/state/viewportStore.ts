/**
 * packages/renderer/src/state/viewportStore.ts — Zustand store for 3D viewport state.
 *
 * Manages:
 *   - Loaded mesh + skeleton + animation (parsed results from native layer)
 *   - Appearance resolution result + missing-deps list
 *   - LOD selection, render mode, customization indices
 *   - Animation transport state (playing, currentFrame, speed, loop)
 *   - Viewport load status (idle / loading / done / error)
 *   - Source-entry fields for Extract (02-05): mountHandle, archiveIndex, entryIndex, entryPath
 *
 * Source: packages/renderer/src/state/iffStore.ts (Zustand 5 store pattern).
 */

import { create } from 'zustand';
import type { MeshParseResult, SkeletonParseResult } from '@swg/contracts';
import type { AppearanceResolutionResult } from '../panels/viewport/resolver/appearanceResolver.js';

// ─── Types ───────────────────────────────────────────────────────────────────

/** Viewport load operation status. */
export type ViewportLoadStatus =
  | { kind: 'idle' }
  | { kind: 'loading'; filename: string }
  | { kind: 'done'; filename: string; mode: 'composed' | 'composed-static' | 'leaf' }
  | { kind: 'error'; filename: string; reason: string; offset?: number };

/** Animation transport state. */
export interface TransportState {
  playing: boolean;
  currentFrame: number;
  totalFrames: number;
  speed: number;
  loop: boolean;
}

// ─── Store interface ──────────────────────────────────────────────────────────

export interface ViewportStore {
  /** Viewport load status. */
  loadStatus: ViewportLoadStatus;

  /** Full appearance resolution result (meshes, skeleton, materials, missing[]). */
  resolution: AppearanceResolutionResult | null;

  /** Parsed mesh result (shaderGroups + geometry ArrayBuffer). */
  parsedMesh: MeshParseResult | null;

  /** Parsed skeleton result (bones[], boneNames[]). */
  parsedSkeleton: SkeletonParseResult | null;

  /** Drives StaticMeshView (false) vs SkinnedMeshView (true) selection. */
  isSkinned: boolean;

  /** Currently selected LOD level index. */
  selectedLod: number;

  /** Render mode — drives wireframe / solid / textured material. */
  renderMode: 'solid' | 'wire' | 'textured';

  /** Customization variable index map (variable name → palette index). */
  customizationIndices: Record<string, number>;

  /** Animation transport state. */
  transportState: TransportState;

  // ─── Source-entry fields (for Extract in 02-05 + resolver) ───────────────

  /** Native TRE mount handle string (from treStore). */
  sourceMountHandle: string | null;

  /** Winning archive index within the mount (for readMountEntry). */
  sourceArchiveIndex: number | null;

  /** TOC entry index within the winning archive. */
  sourceEntryIndex: number | null;

  /** Normalized path of the source entry in the VFS. */
  sourceEntryPath: string | null;

  // ─── Actions ─────────────────────────────────────────────────────────────

  /** Begin loading a file. Sets status to 'loading' and records source-entry fields. */
  beginLoad: (
    filename: string,
    mountHandle: string,
    archiveIndex: number,
    entryIndex: number,
    entryPath: string,
  ) => void;

  /** Record a successful load. */
  loadComplete: (
    filename: string,
    mode: 'composed' | 'composed-static' | 'leaf',
    resolution: AppearanceResolutionResult,
    isSkinned: boolean,
    parsedMesh?: MeshParseResult | null,
    parsedSkeleton?: SkeletonParseResult | null,
  ) => void;

  /** Record a load error. */
  loadError: (filename: string, reason: string, offset?: number) => void;

  /** Select a LOD level. */
  setSelectedLod: (lod: number) => void;

  /** Change render mode. */
  setRenderMode: (mode: 'solid' | 'wire' | 'textured') => void;

  /** Update a single customization variable index. */
  setCustomizationIndex: (variable: string, index: number) => void;

  /** Merge partial transport state. */
  setTransportState: (partial: Partial<TransportState>) => void;

  /** Reset to idle. */
  reset: () => void;
}

// ─── Initial state ─────────────────────────────────────────────────────────

const initialTransportState: TransportState = {
  playing: false,
  currentFrame: 0,
  totalFrames: 0,
  speed: 1,
  loop: false,
};

// ─── Store implementation ─────────────────────────────────────────────────────

export const useViewportStore = create<ViewportStore>((set) => ({
  loadStatus:           { kind: 'idle' },
  resolution:           null,
  parsedMesh:           null,
  parsedSkeleton:       null,
  isSkinned:            false,
  selectedLod:          0,
  renderMode:           'textured',
  customizationIndices: {},
  transportState:       initialTransportState,
  sourceMountHandle:    null,
  sourceArchiveIndex:   null,
  sourceEntryIndex:     null,
  sourceEntryPath:      null,

  beginLoad: (filename, mountHandle, archiveIndex, entryIndex, entryPath) =>
    set({
      loadStatus:         { kind: 'loading', filename },
      resolution:         null,
      parsedMesh:         null,
      parsedSkeleton:     null,
      isSkinned:          false,
      sourceMountHandle:  mountHandle,
      sourceArchiveIndex: archiveIndex,
      sourceEntryIndex:   entryIndex,
      sourceEntryPath:    entryPath,
    }),

  loadComplete: (filename, mode, resolution, isSkinned, parsedMesh, parsedSkeleton) =>
    set({
      loadStatus:     { kind: 'done', filename, mode },
      resolution,
      isSkinned,
      parsedMesh:     parsedMesh ?? null,
      parsedSkeleton: parsedSkeleton ?? null,
      selectedLod:    0,
    }),

  loadError: (filename, reason, offset) =>
    set({
      loadStatus:     { kind: 'error', filename, reason, offset },
      resolution:     null,
      parsedMesh:     null,
      parsedSkeleton: null,
    }),

  setSelectedLod: (lod) => set({ selectedLod: lod }),

  setRenderMode: (mode) => set({ renderMode: mode }),

  setCustomizationIndex: (variable, index) =>
    set((state) => ({
      customizationIndices: { ...state.customizationIndices, [variable]: index },
    })),

  setTransportState: (partial) =>
    set((state) => ({
      transportState: { ...state.transportState, ...partial },
    })),

  reset: () =>
    set({
      loadStatus:           { kind: 'idle' },
      resolution:           null,
      parsedMesh:           null,
      parsedSkeleton:       null,
      isSkinned:            false,
      selectedLod:          0,
      renderMode:           'textured',
      customizationIndices: {},
      transportState:       initialTransportState,
      sourceMountHandle:    null,
      sourceArchiveIndex:   null,
      sourceEntryIndex:     null,
      sourceEntryPath:      null,
    }),
}));
