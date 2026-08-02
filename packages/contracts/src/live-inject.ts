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

// --- Live World Editor: interior-decoration persist round trip (model D) ------
// The agent captures a moved .ilf decoration; the toolkit assembles the two loose
// override files (edited .ilf + derived building template) and, ONLY THEN, tells the
// agent to rebind the .ws node in place (wsSetNodeTemplateName + wsSaveSnapshot — the
// v23 fail-closed ordering: the derived template must exist on disk before the rebind).
// Three hops, all carried by the single named mapping (see LIVE_DECORATION_LAYOUT):
//   agent → host  CAPTURE  → host surfaces 'live-decoration-captured' to renderer
//   renderer → host 'live-decoration-rebind' → host writes REBIND → agent applies
//   agent → host  RESULT   → host surfaces 'live-decoration-result' to renderer

/** Host → renderer: a decoration move the agent captured in-game (a new CAPTURE_EPOCH).
 *  The renderer feeds this straight into assembleDecorationEdit (DecorationEdit shape). */
export type LiveDecorationCaptured = {
  type: 'live-decoration-captured';
  id: number;
  epoch: number;
  capture: DecorationCapture;
};

/** Renderer → host: after assembleDecorationEdit + staging, the derived template name for
 *  the agent to rebind onto the building node. `abort:true` cancels the pending capture
 *  (e.g. assembly failed — resolveNode couldn't pin the row) so the agent stops waiting. */
export type LiveDecorationRebind = {
  type: 'live-decoration-rebind';
  id: number;
  epoch: number;                  // echoes the captured epoch this answers
  buildingInstanceId: string;     // decimal u64 — cross-checked against the capture
  derivedTemplateVfsPath?: string; // required unless abort
  abort?: boolean;
};

/** Host → renderer: the agent's rebind outcome (a matching RESULT_EPOCH). `code` is a
 *  LIVE_DECORATION_RESULT value. */
export type LiveDecorationResult = {
  type: 'live-decoration-result';
  id: number;
  epoch: number;
  code: number;
};

/** Discriminated union of all live-injection IPC message types. */
export type LiveIpcMessage =
  | LiveAttachRequest
  | LiveAttachResponse
  | LiveAttachError
  | LiveReadRequest
  | LiveStateUpdate
  | LiveDecorationCaptured
  | LiveDecorationRebind
  | LiveDecorationResult;

/**
 * The captured in-game decoration move, decoded from the channel CAPTURE region. Maps 1:1
 * onto DecorationEdit (decorationPersist.ts) minus cellName (which the toolkit DERIVES via
 * resolveNode — the agent can't cheaply read it; CellProperty::getCellName is inline).
 *
 * How each field is captured agent-side, all on the CURRENT advertised contract (no new row):
 *   buildingInstanceId     collideScreenRay outHitObjectId (the networked building .ws node)
 *   buildingTemplateVfsPath getObjectById(buildingId) → getObjectTemplateName
 *   decorationTemplateName  getTemplateFilename(latched decoration)
 *   originalO2p             getObjectTransformO2P(decoration) at latch (before the move)
 *   newO2p                  getObjectTransformO2P(decoration) at persist (after the move)
 */
export interface DecorationCapture {
  /** decimal u64 — the building's .ws node id (names the derived template 1:1). */
  buildingInstanceId: string;
  buildingTemplateVfsPath: string;
  decorationTemplateName: string;
  /** 12 floats, row-major o2p 3×4, at pick time. */
  originalO2p: number[];
  /** 12 floats, row-major o2p 3×4, after the gizmo move. */
  newO2p: number[];
  /** Defaults to 'edit' when absent server-side, per Plan 01's assembleDecorationEdit
   *  contract. 'add' = a brand-new placement (D-01), not an edit of an existing row.
   *  'arm-failed' = an arm-attempt failure (C8) — carries no decoration move at all;
   *  only `cellName` (repurposed as a reason string) is meaningful for this kind. */
  kind?: 'edit' | 'add' | 'arm-failed';
  /** Required and meaningful only when kind==='add' (the target cell name for the new
   *  .ilf row). When kind==='arm-failed', this SAME field is REPURPOSED to carry a
   *  human-readable arm-failure reason string instead of a cell name — the two purposes
   *  are mutually exclusive per kind and never overlap for a single capture event (C8). */
  cellName?: string;
}

// ---------------------------------------------------------------------------
// Channel byte-layout constants
// ---------------------------------------------------------------------------

/**
 * Byte layout for the named file-mapping channel.
 *
 * This ONE named file-mapping carries TWO independent seqlock regions — the
 * pre-existing agent-to-host READ FRAME (offset 0-319, unchanged from Phase 3)
 * and a new host-to-agent COMMAND region (offset 324+, Plan 05-01/D-02) — plus
 * a small set of single-word agent-authoritative status fields. There is
 * deliberately NO second `CreateFileMappingA` call anywhere in the codebase
 * (see 05-RESEARCH.md "Anti-Patterns to Avoid"): one named mapping, one
 * struct, two independently-seqlocked spans.
 *
 * Layout (400 bytes total):
 *   [0..3]     SEQ_COUNTER        — read-frame seqlock LONG (4 bytes, agent-written)
 *   [4..51]    TRANSFORM          — float[3][4] row-major, 12 floats / 48 bytes
 *                                    NOTE: The IPC doc's "64-byte 4×4 matrix" is WRONG for SWG.
 *                                    SWG Transform is 3×4 (float[3][4]) = 48 bytes.
 *   [52..59]   NETWORK_ID         — uint64 (8 bytes)
 *   [60..315]  TEMPLATE_NAME      — null-terminated ASCII (256 bytes max)
 *   [316..319] LIVENESS           — player_non_null(1) | is_over(1) | padding(2)
 *   [320..323] FOCUS_TOKEN        — agent's truncated addrOf(focus) pointer, published
 *                                    into the SAME seqlocked read frame EVERY tick (ROUND 5,
 *                                    REVIEWS.md round-4 maintainer decision #1 — the
 *                                    load-bearing identity-unification fix both the agent's
 *                                    own guard baseline (05-03) and the host's
 *                                    cowSnapshot/writeLog re-key (05-07) key on)
 *   [324..327] COMMAND_SEQ_COUNTER — command-region seqlock LONG (host-written)
 *   [328..375] COMMAND_TRANSFORM  — float[3][4] row-major, target transform (48 bytes)
 *   [376..387] COMMAND_SCALE      — float[3] x/y/z target scale (12 bytes)
 *   [388..391] COMMAND_FLAGS      — LIVE_CMD_FLAGS bits (host-written)
 *   [392..395] GUARD_STATUS       — LIVE_GUARD_FLAGS bits (agent-written, single word)
 *   [396..399] GUARD_ADDR         — x86 pointer of the object last write-guard-checked
 *                                    (agent-written, single word; 0 = none checked yet)
 *
 * LIVE_READFRAME_BYTES (the span channelWrite copies every tick) = 320 —
 * transform + networkId + templateName + liveness + focusToken.
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
  /** Agent's truncated addrOf(focus) pointer — part of the SEQLOCKED READ FRAME,
   *  published every tick (ROUND 5). Distinct from GUARD_ADDR: both are the SAME
   *  truncation of the SAME resolved pointer, but update on different cadences
   *  (every tick vs. only on a guard-checked command). */
  FOCUS_TOKEN:   { offset: 320, length: 4   },
  /** Command-region seqlock LONG (host-written). */
  COMMAND_SEQ_COUNTER: { offset: 324, length: 4  },
  /** Command target transform: 12 floats / 48 bytes (float[3][4], row-major) —
   *  the command slot carries the FULL target state on every write, not a
   *  mode-tagged partial update (planner's discretion per 05-CONTEXT.md). */
  COMMAND_TRANSFORM:   { offset: 328, length: 48 },
  /** Command target scale: float[3] x/y/z (12 bytes) — gated independently of
   *  COMMAND_TRANSFORM by the write-guard (REVIEWS.md Fix B). */
  COMMAND_SCALE:       { offset: 376, length: 12 },
  /** Command flags — see LIVE_CMD_FLAGS. */
  COMMAND_FLAGS:       { offset: 388, length: 4  },
  /** Agent-published guard outcome — see LIVE_GUARD_FLAGS. Single aligned word,
   *  no seqlock (a torn read of one stale-but-valid word is harmless). */
  GUARD_STATUS:        { offset: 392, length: 4  },
  /** Agent-published x86 pointer of the object last write-guard-checked
   *  (REVIEWS.md Fix C — gives the locked guard-blocked banner a real address
   *  to interpolate: "<addr>: expected <bytes>, read <bytes>"). 0 = none yet. */
  GUARD_ADDR:          { offset: 396, length: 4  },
  /** Total byte size of one channel frame. */
  TOTAL_SIZE:    { offset: 0,   length: 400 },
} as const;

/** Span (bytes) of the read-frame that channelWrite copies every tick —
 *  transform + networkId + templateName + liveness + focusToken. Named
 *  constant (not struct-size arithmetic) so extending LiveState for the
 *  command slot can never silently widen this write span (T-05-01). */
export const LIVE_READFRAME_BYTES = 320;

/**
 * Host-to-agent command flags (COMMAND_FLAGS bits). Agent-observed, host-written.
 */
export const LIVE_CMD_FLAGS = {
  /** D-04 clean agent stop-signal — the agent closes its channel handle and
   *  sets GUARD_STATUS.STOPPING once it honors this. */
  STOP_REQUESTED:   0x1,
  /** REVIEWS.md Opus MEDIUM — an explicit "Revert ALL" asks the agent to
   *  re-baseline its expected-bytes state to the CURRENT live bytes without
   *  applying any transform this iteration; never accepts an arbitrary
   *  forward-write target (T-05-26). */
  REBASELINE_GUARD: 0x2,
} as const;

/**
 * Agent-to-host guard status flags (GUARD_STATUS bits). Host-observed, agent-written.
 */
export const LIVE_GUARD_FLAGS = {
  /** Renamed from the original single WRITE_REFUSED bit — same bit value, no
   *  compat break. Set when the live transform bytes no longer match the
   *  agent's locally-tracked expected transform. */
  TRANSFORM_REFUSED: 0x1,
  /** REVIEWS.md Fix B — scale is gated independently of transform; either bit
   *  may be set alone. Set when the live scale bytes no longer match the
   *  agent's locally-tracked expected scale. */
  SCALE_REFUSED:     0x2,
  /** REVIEWS.md round-3 maintainer decision #5 — dedicated, agent-published
   *  sticky acknowledgement bit, distinct from the latest-wins command slot.
   *  The agent sets this once, immediately before honoring STOP_REQUESTED and
   *  closing its own channel handle, so a host-side detach retry-loop can
   *  observe a genuine "the agent is stopping" signal that a later drag
   *  command overwriting COMMAND_FLAGS on the SAME slot cannot silently erase. */
  STOPPING:          0x4,
} as const;

// ---------------------------------------------------------------------------
// Live World Editor: decoration-persist channel region (model D)
// ---------------------------------------------------------------------------

/**
 * The interior-decoration persist round trip rides the SAME single named mapping (still no
 * second CreateFileMappingA — the mapping simply GROWS from 400 to LIVE_CHANNEL_TOTAL_SIZE
 * bytes; both C++ sides bump CHANNEL_BYTE_SIZE / the LiveState struct + add offset
 * static_asserts, exactly as they mirror LIVE_CHANNEL_LAYOUT today).
 *
 * This is a DISCRETE request/response, not per-tick state, so it's driven by monotonic
 * EPOCH counters rather than the read-frame cadence:
 *   - Agent bumps CAPTURE_EPOCH once per "Persist" click, after writing the payload under
 *     CAPTURE_SEQ. Host processes each epoch exactly once (tracks last-seen).
 *   - Host writes the REBIND payload + REBIND_EPOCH = the captured epoch, under REBIND_SEQ.
 *     Agent applies each new REBIND_EPOCH once (wsSetNodeTemplateName + wsSaveSnapshot), or
 *     skips it if REBIND_FLAGS has ABORT.
 *   - Agent writes RESULT_CODE then publishes RESULT_EPOCH (code-before-epoch ordering, same
 *     single-word no-seqlock discipline as GUARD_STATUS: host reads CODE only once EPOCH
 *     matches the epoch it awaits). Host surfaces it as 'live-decoration-result'.
 *
 * String slots are fixed 256-byte null-terminated ASCII (VFS paths are ~40-60 chars; 256 is
 * the same headroom TEMPLATE_NAME uses). Transforms are float[3][4] row-major o2p, 48 bytes.
 */
export const LIVE_DECORATION_LAYOUT = {
  // --- CAPTURE region (agent → host), seqlocked by CAPTURE_SEQ_COUNTER ---
  CAPTURE_SEQ_COUNTER:       { offset: 400,  length: 4   },
  /** Monotonic; bumped once per captured edit. 0 = nothing captured yet. */
  CAPTURE_EPOCH:             { offset: 404,  length: 4   },
  /** u64 building .ws node id (collideScreenRay outHitObjectId). */
  CAPTURE_BUILDING_ID:       { offset: 408,  length: 8   },
  /** o2p at pick time — feeds resolveNode. */
  CAPTURE_ORIGINAL_O2P:      { offset: 416,  length: 48  },
  /** o2p after the move — written into the edited .ilf. */
  CAPTURE_NEW_O2P:           { offset: 464,  length: 48  },
  /** asciiz decoration object template. */
  CAPTURE_DECORATION_TEMPLATE: { offset: 512, length: 256 },
  /** asciiz stock building template VFS path. */
  CAPTURE_BUILDING_TEMPLATE: { offset: 768,  length: 256 },

  // --- REBIND region (host → agent), seqlocked by REBIND_SEQ_COUNTER ---
  REBIND_SEQ_COUNTER:        { offset: 1024, length: 4   },
  /** Echoes the CAPTURE_EPOCH being answered. */
  REBIND_EPOCH:              { offset: 1028, length: 4   },
  /** LIVE_DECORATION_REBIND_FLAGS. */
  REBIND_FLAGS:              { offset: 1032, length: 4   },
  /** u64 — must equal the captured building id (agent cross-checks; refuses on mismatch). */
  REBIND_BUILDING_ID:        { offset: 1036, length: 8   },
  /** asciiz derived building template VFS path (the wsSetNodeTemplateName arg). */
  REBIND_DERIVED_TEMPLATE:   { offset: 1044, length: 256 },

  // --- RESULT (agent → host), single aligned words, no seqlock (GUARD_STATUS discipline) ---
  /** LIVE_DECORATION_RESULT code. Written BEFORE RESULT_EPOCH. */
  RESULT_CODE:               { offset: 1300, length: 4   },
  /** Echoes the epoch the agent applied. Published LAST. 0 = no result yet. */
  RESULT_EPOCH:              { offset: 1304, length: 4   },

  // --- CAPTURE kind/cellName extension (05.1-03, D-01/C8) — SAME seqlock span as the
  //     rest of CAPTURE (captureSeqCounter @ 400), even though these two fields are
  //     non-contiguous with the CAPTURE_*_TEMPLATE fields above (768..1024 vs 1308/1312) ---
  /** LIVE_DECORATION_CAPTURE_KIND: 0=edit, 1=add, 2=arm-failed. */
  CAPTURE_KIND:              { offset: 1308, length: 4   },
  /** asciiz, dual-purpose: kind===1 (add) → cell name; kind===2 (arm-failed) → a
   *  human-readable failure reason string; unused for kind===0 (edit). */
  CAPTURE_CELL_NAME:         { offset: 1312, length: 128 },
} as const;

/** LIVE_DECORATION_CAPTURE_KIND — CAPTURE_KIND field values (05.1-03, D-01/C8). */
export const LIVE_DECORATION_CAPTURE_KIND = {
  EDIT:       0,
  ADD:        1,
  ARM_FAILED: 2,
} as const;

/** Total mapping size once the decoration region (through CAPTURE_CELL_NAME, offset
 *  1440) AND the HOST_CMD region (through HOST_CMD_RESULT_EPOCH, offset 1864) are both
 *  included (was 1308, then 400 before that). Exactly sizeof(LiveState) under
 *  #pragma pack(4). Host CHANNEL_BYTE_SIZE + agent LIVE_STATE_BYTE_SIZE both equal this. */
export const LIVE_CHANNEL_TOTAL_SIZE = 1864;

/** Host → agent rebind flags (REBIND_FLAGS bits). */
export const LIVE_DECORATION_REBIND_FLAGS = {
  /** Apply the rebind: wsSetNodeTemplateName(buildingId, derivedTemplate) + wsSaveSnapshot. */
  APPLY: 0x1,
  /** Cancel the pending capture (assembly failed / user backed out) — agent clears its
   *  pending state and writes RESULT_CODE = ABORTED without touching the snapshot. */
  ABORT: 0x2,
} as const;

/** Agent → host rebind outcome (RESULT_CODE). Extends the wsSaveSnapshot result space so a
 *  save failure surfaces its specific reason; the negative codes are decoration-specific
 *  pre-save refusals. */
export const LIVE_DECORATION_RESULT = {
  OK:                 0,   // rebound + saved
  // 1..6 mirror wsSaveSnapshot's typed result enum (no-snapshot, no-loose-path, shadowed, …)
  SAVE_NO_SNAPSHOT:   1,
  SAVE_NO_LOOSE_PATH: 2,
  SAVE_SHADOWED:      3,
  SAVE_ID_OVERFLOW:   4,
  SAVE_INTEGRITY:     5,
  SAVE_WRITE_FAILURE: 6,
  // decoration-specific refusals (fail-closed, nothing mutated)
  NODE_NOT_FOUND:     -1,  // wsSetNodeTemplateName couldn't resolve buildingInstanceId
  BUILDING_ID_MISMATCH: -2, // REBIND_BUILDING_ID != the captured id
  ABORTED:            -3,  // host sent ABORT
  NOT_A_WS_NODE:      -4,  // building is server-streamed / buildout, not a client .ws node (invariant 2)
  REBIND_REFUSED:     -5,  // wsSetNodeTemplateName returned -1 (empty name / buildout node / template unresolvable) — save NOT attempted
} as const;

// ---------------------------------------------------------------------------
// Live World Editor: unified HOST_CMD channel region (05.1-03)
// ---------------------------------------------------------------------------

/**
 * One new, single, reusable host → agent one-shot action-request region, riding the SAME
 * single named mapping (still no second CreateFileMappingA — the mapping grows from 1440
 * to LIVE_CHANNEL_TOTAL_SIZE=1864 bytes). Carries all SIX host → agent actions this phase
 * needs (reload scene / load editor scene / teleport / start placement / cancel placement /
 * despawn a node), discriminated by HOST_CMD_ACTION, rather than six separate channel
 * regions — per the file's own "extend, don't fork" doctrine.
 *
 * Same request/response idiom as REBIND/RESULT above, generalized: the host writes a
 * seqlocked request under HOST_CMD_SEQ_COUNTER and bumps HOST_CMD_EPOCH; the agent applies
 * each new epoch exactly once and publishes HOST_CMD_RESULT_CODE (written FIRST) then
 * HOST_CMD_RESULT_EPOCH (published LAST) — the same code-before-epoch, no-seqlock
 * discipline as RESULT_CODE/RESULT_EPOCH.
 *
 * Per-action payload usage:
 *   RELOAD_CURRENT_SCENE(1)  — no payload.
 *   LOAD_EDITOR_SCENE(2)     — STR1 terrain, STR2 avatar template.
 *   TELEPORT(3)              — VEC3 xyz.
 *   START_PLACEMENT(4)       — STR1 decoration template, STR2 cellName, ID building id.
 *   CANCEL_PLACEMENT(5)      — no payload.
 *   DESPAWN_NODE(6)          — ID networkId to remove. Result code mirrors
 *                               utinni_wsRemoveNode: 1=removed / 0=miss / -1=occupied.
 *                               All OTHER actions use 1=ok / 0=endpoint-unresolved-or-failed.
 */
export const LIVE_HOST_CMD_LAYOUT = {
  HOST_CMD_SEQ_COUNTER: { offset: 1440, length: 4   },
  HOST_CMD_EPOCH:        { offset: 1444, length: 4   },
  /** LIVE_HOST_CMD_ACTION. */
  HOST_CMD_ACTION:       { offset: 1448, length: 4   },
  HOST_CMD_STR1:          { offset: 1452, length: 256 },
  HOST_CMD_STR2:          { offset: 1708, length: 128 },
  /** decimal-u64-as-two-u32-halves — same crossing pattern CAPTURE_BUILDING_ID uses. */
  HOST_CMD_ID:            { offset: 1836, length: 8   },
  /** 3 floats. */
  HOST_CMD_VEC3:          { offset: 1844, length: 12  },
  /** signed int32. Written FIRST. */
  HOST_CMD_RESULT_CODE:   { offset: 1856, length: 4   },
  /** Published LAST (code-before-epoch discipline). */
  HOST_CMD_RESULT_EPOCH:  { offset: 1860, length: 4   },
} as const;

/** LIVE_HOST_CMD_ACTION — the six host → agent one-shot actions this phase needs. */
export const LIVE_HOST_CMD_ACTION = {
  RELOAD_CURRENT_SCENE: 1,
  LOAD_EDITOR_SCENE:    2,
  TELEPORT:             3,
  START_PLACEMENT:      4,
  CANCEL_PLACEMENT:     5,
  DESPAWN_NODE:         6,
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

/**
 * Fully verified snapshot of one SWG object's live state.
 *
 * The five boolean/numeric fields below (hasTarget through focusToken) are ALL
 * decoded from the SAME 400-byte read frame's LIVENESS (offset 316) and
 * FOCUS_TOKEN (offset 320) fields — no new channel offset was added for
 * hasTarget/targetUnavailableOnBuild/scaleUnavailableOnBuild (they are bits
 * 2/3/4 of the pre-existing LIVENESS word); FOCUS_TOKEN is its own 4-byte
 * field but rides the SAME seqlock as transform/networkId/templateName/
 * liveness (05-01 ROUND 5).
 */
export interface VerifiedObjectState {
  /** uint64 from getNetworkId */
  networkId:    bigint;
  /** ASCII "object/..." path */
  templateName: string;
  /** 12 floats, row-major float[3][4] */
  transform:    Float32Array;
  /** All 4 sentinels passed */
  playerAlive:  boolean;
  /** LIVENESS bit2 — the agent resolved a real "focus" object this tick
   *  (either build's targeting mechanism). False when nothing is targeted
   *  (the player is shown as a fallback) OR when the mechanism itself is
   *  unresolved on this build (see targetUnavailableOnBuild). */
  hasTarget: boolean;
  /** LIVENESS bit3 (REVIEWS.md ROUND 2 redefinition) — true when the
   *  targeting-resolution MECHANISM itself is unresolved on this build,
   *  never merely "nothing is currently targeted." True on EITHER build now,
   *  not a legacy-vs-advertised split. */
  targetUnavailableOnBuild: boolean;
  /** LIVENESS bit4 (ROUND 2 NEW) — true when this is the advertised build AND
   *  the setScale endpoint could not be resolved, meaning Scale writes are
   *  guaranteed to be refused this session (distinct from a genuine
   *  guard-tamper SCALE_REFUSED, which requires a resolved setter). */
  scaleUnavailableOnBuild: boolean;
  /** FOCUS_TOKEN (offset 320) — the agent's own truncated addrOf(focus)
   *  pointer, published every tick as PART OF the seqlocked read frame
   *  (05-01/05-03 ROUND 5, REVIEWS.md round-4 maintainer decision #1). This
   *  is the LOAD-BEARING per-object identity signal liveStore's
   *  captureSnapshotIfNeeded re-keys its per-identity cache on — NEVER
   *  (networkId, templateName), which collapses to (0, templateName) on
   *  legacy (networkId is always 0 there, Fix E). Distinct from `guardAddr`
   *  (liveStore field, GUARD_ADDR offset 396), which only updates on a
   *  guard-checked apply, not every tick. */
  focusToken: number;
}
