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
import type { MeshParseResult, SkeletonParseResult, AnimationParseResult } from '@swg/contracts';
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

  // ─── Animation (VIEW-03 / D-08) ──────────────────────────────────────────

  /**
   * Currently loaded animation parse result (CKAT-0001 or KFAT-0003).
   * Null when no animation is selected or KFAT-0002-unsupported is returned.
   * Note: the keyframe ArrayBuffer is carried on the native AnimationParseResult from
   * the N-API bridge; this field stores the full result including the .keyframes ArrayBuffer
   * and .channelTable. The binary data stays binary (not JSON).
   */
  parsedAnimation: AnimationParseResult & {
    keyframes: ArrayBuffer;
    channelTable: {
      rotationChannels: Array<{ byteOffset: number; keyCount: number }>;
      staticRotByteOffset: number;
      staticRotationCount: number;
      translationChannels: Array<{ byteOffset: number; keyCount: number }>;
      staticTransByteOffset: number;
      staticTranslationCount: number;
    };
  } | null;

  /**
   * Whether the THREE.SkeletonHelper bone wire is visible in the viewport.
   * Toggled by the ⊹ skeleton-helper chip in AnimationTransport.
   */
  skeletonHelperVisible: boolean;

  /**
   * VFS paths for .ans files available for the loaded skeleton.
   * Populated from the LATX animation-table mapping (or heuristic fallback).
   * Used to populate the AnimationTransport .ans picker dropdown.
   */
  ansPickerOptions: string[];

  // ─── Source-entry fields (for Extract in 02-05 + resolver) ───────────────

  /** S3TC unavailability warning (set once when WEBGL_compressed_texture_s3tc is absent). */
  s3tcWarning: string | null;

  /** Native TRE mount handle string (from treStore). */
  sourceMountHandle: string | null;

  /** Winning archive index within the mount (for readMountEntry). */
  sourceArchiveIndex: number | null;

  /** TOC entry index within the winning archive. */
  sourceEntryIndex: number | null;

  /** Normalized path of the source entry in the VFS. */
  sourceEntryPath: string | null;

  // ─── Export / Extract (02-05) ────────────────────────────────────────────

  /** Whether the ExportDialog modal is open. */
  exportDialogOpen: boolean;

  /**
   * Last successfully exported filename (basename only, e.g. "creature_id.glb").
   * Displayed in the VerificationStatus success chip.
   */
  lastExportFilename: string | null;

  // ─── Actions ─────────────────────────────────────────────────────────────

  /** Open or close the ExportDialog modal. */
  setExportDialogOpen: (open: boolean) => void;

  /** Record a successful export filename. */
  setLastExportFilename: (name: string | null) => void;

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

  /** Record S3TC unavailability warning (called once from ddsTexture.ts). */
  setS3tcWarning: (msg: string) => void;

  /** Set the current animation (CKAT-0001 or KFAT-0003 parse result + binary buffers). */
  setParsedAnimation: (anim: ViewportStore['parsedAnimation']) => void;

  /** Clear the current animation and reset transport to frame 0. */
  clearAnimation: () => void;

  /** Show/hide the THREE.SkeletonHelper bone wire overlay. */
  setSkeletonHelperVisible: (visible: boolean) => void;

  /**
   * Set the list of .ans VFS paths available for the loaded skeleton.
   * Called by the appearance resolver when a skeleton loads (from LATX chain or heuristic).
   */
  setAnsPickerOptions: (paths: string[]) => void;

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
  loadStatus:            { kind: 'idle' },
  resolution:            null,
  parsedMesh:            null,
  parsedSkeleton:        null,
  isSkinned:             false,
  selectedLod:           0,
  renderMode:            'textured',
  customizationIndices:  {},
  transportState:        initialTransportState,
  parsedAnimation:       null,
  skeletonHelperVisible: false,
  ansPickerOptions:      [],
  s3tcWarning:           null,
  sourceMountHandle:     null,
  sourceArchiveIndex:    null,
  sourceEntryIndex:      null,
  sourceEntryPath:       null,
  exportDialogOpen:      false,
  lastExportFilename:    null,

  beginLoad: (filename, mountHandle, archiveIndex, entryIndex, entryPath) =>
    set({
      loadStatus:         { kind: 'loading', filename },
      resolution:         null,
      parsedMesh:         null,
      parsedSkeleton:     null,
      isSkinned:          false,
      parsedAnimation:    null,
      ansPickerOptions:   [],
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

  setS3tcWarning: (msg) => set({ s3tcWarning: msg }),

  setParsedAnimation: (anim) =>
    set({
      parsedAnimation: anim,
      transportState:  { ...initialTransportState, totalFrames: anim?.frameCount ?? 0 },
    }),

  clearAnimation: () =>
    set({
      parsedAnimation: null,
      transportState:  initialTransportState,
    }),

  setSkeletonHelperVisible: (visible) => set({ skeletonHelperVisible: visible }),

  setAnsPickerOptions: (paths) => set({ ansPickerOptions: paths }),

  setExportDialogOpen: (open) => set({ exportDialogOpen: open }),

  setLastExportFilename: (name) => set({ lastExportFilename: name }),

  reset: () =>
    set({
      loadStatus:            { kind: 'idle' },
      resolution:            null,
      parsedMesh:            null,
      parsedSkeleton:        null,
      isSkinned:             false,
      selectedLod:           0,
      renderMode:            'textured',
      customizationIndices:  {},
      transportState:        initialTransportState,
      parsedAnimation:       null,
      skeletonHelperVisible: false,
      ansPickerOptions:      [],
      s3tcWarning:           null,
      sourceMountHandle:     null,
      sourceArchiveIndex:    null,
      sourceEntryIndex:      null,
      sourceEntryPath:       null,
      exportDialogOpen:      false,
      lastExportFilename:    null,
    }),
}));
