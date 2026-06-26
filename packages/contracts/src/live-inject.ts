/**
 * packages/contracts/src/live-inject.ts
 * Type definitions for Phase 3 live injection.
 *
 * IPC message union (discriminated, per ipc.ts pattern).
 * Byte-layout constants (per sab-layout.ts pattern).
 * Engine endpoint name catalog.
 * VerifiedObjectState interface.
 *
 * No runtime code — types and const objects only.
 */

// ---------------------------------------------------------------------------
// IPC message union
// ---------------------------------------------------------------------------

/** Sent by renderer to attach+inject into a client process. */
export type LiveAttachRequest  = { type: 'live-attach';       id: number; clientExe: string; agentDll: string };

/** Sent by host addon after successful inject. */
export type LiveAttachResponse = { type: 'live-attached';     id: number; pid: number; mappingName: string };

/** Inject failed or client not found. */
export type LiveAttachError    = { type: 'live-attach-error'; id: number; reason: string };

/** Renderer polls the channel for a fresh read. */
export type LiveReadRequest    = { type: 'live-read';         id: number };

/** Host addon returns the latest verified state from the channel. */
export type LiveStateUpdate    = { type: 'live-state';        id: number; state: VerifiedObjectState | null };

/** Discriminated union of all live-injection IPC message types. */
export type LiveIpcMessage =
  | LiveAttachRequest
  | LiveAttachResponse
  | LiveAttachError
  | LiveReadRequest
  | LiveStateUpdate;

// ---------------------------------------------------------------------------
// Channel byte-layout constants
// ---------------------------------------------------------------------------

/**
 * Byte layout for the named file-mapping channel (host read side).
 *
 * Layout (320 bytes total):
 *   [0..3]   SEQ_COUNTER   — seqlock LONG (4 bytes)
 *   [4..51]  TRANSFORM     — float[3][4] row-major, 12 floats / 48 bytes
 *                            NOTE: The IPC doc's "64-byte 4×4 matrix" is WRONG for SWG.
 *                            SWG Transform is 3×4 (float[3][4]) = 48 bytes.
 *   [52..59] NETWORK_ID    — uint64 (8 bytes)
 *   [60..315] TEMPLATE_NAME — null-terminated ASCII (256 bytes max)
 *   [316..319] LIVENESS    — player_non_null(1) | is_over(1) | padding(2)
 */
export const LIVE_CHANNEL_LAYOUT = {
  /** Seqlock counter (LONG = 4 bytes at offset 0). */
  SEQ_COUNTER:   { offset: 0,   length: 4   },
  /** Transform matrix: 12 floats / 48 bytes (float[3][4], row-major).
   *  Translation is column 3: mat[0][3], mat[1][3], mat[2][3]. */
  TRANSFORM:     { offset: 4,   length: 48  },
  /** NetworkId: uint64 (8 bytes). */
  NETWORK_ID:    { offset: 52,  length: 8   },
  /** Template name: null-terminated ASCII (256 bytes max). */
  TEMPLATE_NAME: { offset: 60,  length: 256 },
  /** Liveness flags: player_non_null(1) | is_over(1) | padding(2). */
  LIVENESS:      { offset: 316, length: 4   },
  /** Total byte size of one channel frame. */
  TOTAL_SIZE:    { offset: 0,   length: 320 },
} as const;

// ---------------------------------------------------------------------------
// Engine endpoint name catalog
// ---------------------------------------------------------------------------

/**
 * Engine endpoint names for the name-keyed resolution table.
 * These are the string keys passed to lookupByName().
 * Values must match exactly what swg-client-v2 engine_advertise.cpp advertises.
 */
export const ENGINE_ENDPOINT_NAMES = {
  GET_TRANSFORM_O2W:        'object::getTransform_o2w',
  GET_NETWORK_ID:           'object::getNetworkId',
  GET_OBJECT_TEMPLATE_NAME: 'object::getObjectTemplateName',
  GET_PLAYER:               'game::getPlayer',
  G_RUNNING_FLAGS:          'game::g_runningFlags',
  G_MAIN_LOOP_COUNTER:      'game::g_mainLoopCounter',
} as const;

// ---------------------------------------------------------------------------
// Verified object state
// ---------------------------------------------------------------------------

/** Fully verified snapshot of one SWG object's live state. */
export interface VerifiedObjectState {
  /** uint64 from getNetworkId */
  networkId:    bigint;
  /** ASCII "object/..." path */
  templateName: string;
  /** 12 floats, row-major float[3][4] */
  transform:    Float32Array;
  /** All 4 sentinels passed */
  playerAlive:  boolean;
}
