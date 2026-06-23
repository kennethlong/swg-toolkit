/**
 * packages/renderer/src/state/iffStore.ts — Zustand store for IFF viewer state.
 *
 * Manages:
 *   - Parsed IFF result (roots, trailingBytes, roundTrip status)
 *   - Currently selected node (IffNode + pre-order index)
 *   - Selected byte range (for HexInspector highlight)
 *   - Parse status (idle / parsing / done / error)
 *   - Raw source bytes (zero-copy ArrayBuffer for HexInspector)
 *
 * Source: 01-UI-SPEC.md § "Surface 2 — IFF FORM/Chunk Tree Viewer" +
 *         § "Surface 3 — Hex/ASCII Inspector Pane".
 * Pattern: packages/renderer/src/state/treStore.ts (Zustand 5 store).
 */

import { create } from 'zustand';
import type { IffNode, IffTrailingBytes, IffRoundTripStatus } from '@swg/contracts';

// ─── Types ───────────────────────────────────────────────────────────────────

/** The parsed IFF tree result (mirrors IffParseResultNative but uses contracts types). */
export interface IffParseResult {
  roots: IffNode[];
  trailingBytes: IffTrailingBytes | null;
  roundTrip: IffRoundTripStatus;
}

/** Parse operation status. */
export type IffParseStatus =
  | { kind: 'idle' }
  | { kind: 'parsing'; filename: string }
  | { kind: 'done'; filename: string }
  | { kind: 'error'; filename: string; reason: string; offset?: number };

/** A selected IFF node with its pre-order traversal index. */
export interface SelectedIffNode {
  node: IffNode;
  /** Pre-order index (0 = first root). Used for getChunkBytes(). */
  preorderIndex: number;
  /** Byte range of this node in the source buffer: [start, end). */
  byteStart: number;
  byteEnd: number;
}

// ─── Store interface ──────────────────────────────────────────────────────────

export interface IffStore {
  /** Name of the currently displayed file. */
  filename: string | null;

  /** Parsed IFF result (null if not yet loaded). */
  parseResult: IffParseResult | null;

  /** Raw source bytes (kept for getChunkBytes zero-copy requests). */
  sourceBytes: ArrayBuffer | null;

  /** Parse status. */
  parseStatus: IffParseStatus;

  /** Currently selected IFF node (null if none). */
  selectedNode: SelectedIffNode | null;

  /** Hover byte index in the HexInspector (for cross-highlight). */
  hoveredByteIndex: number | null;

  // ─── Actions ─────────────────────────────────────────────────────────────

  /** Start parsing a file. */
  beginParse: (filename: string) => void;

  /** Store the parse result and source bytes. */
  parseComplete: (
    filename: string,
    result: IffParseResult,
    sourceBytes: ArrayBuffer,
  ) => void;

  /** Record a parse error. */
  parseError: (filename: string, reason: string, offset?: number) => void;

  /** Select an IFF node. */
  selectNode: (node: SelectedIffNode | null) => void;

  /** Update the hovered byte index. */
  setHoveredByte: (index: number | null) => void;

  /** Reset to idle (e.g., when the VFS selection changes to a non-IFF file). */
  reset: () => void;
}

// ─── Store implementation ─────────────────────────────────────────────────────

export const useIffStore = create<IffStore>((set) => ({
  filename:    null,
  parseResult: null,
  sourceBytes: null,
  parseStatus: { kind: 'idle' },
  selectedNode: null,
  hoveredByteIndex: null,

  beginParse: (filename) =>
    set({ parseStatus: { kind: 'parsing', filename }, selectedNode: null }),

  parseComplete: (filename, result, sourceBytes) =>
    set({
      filename,
      parseResult: result,
      sourceBytes,
      parseStatus: { kind: 'done', filename },
      selectedNode: null,
    }),

  parseError: (filename, reason, offset) =>
    set({
      filename,
      parseStatus: { kind: 'error', filename, reason, offset },
      parseResult: null,
      selectedNode: null,
    }),

  selectNode: (node) => set({ selectedNode: node }),

  setHoveredByte: (index) => set({ hoveredByteIndex: index }),

  reset: () =>
    set({
      filename:    null,
      parseResult: null,
      sourceBytes: null,
      parseStatus: { kind: 'idle' },
      selectedNode: null,
      hoveredByteIndex: null,
    }),
}));
