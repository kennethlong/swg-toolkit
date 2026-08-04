/**
 * packages/renderer/src/services/hostCommand.ts
 * Renderer-side thin wrapper over Plan 07's `addon.writeHostCommand` — one small typed send*
 * function per HOST_CMD action (Plan 03's `LIVE_HOST_CMD_LAYOUT`/`LIVE_HOST_CMD_ACTION`), a
 * `parseHostCommandResult` reader mirroring decorationChannel.ts's `readDecorationResult`, and a
 * words-only per-action outcome describer (`describeHostCommandResult`, C9).
 *
 * No business logic here beyond payload shaping — validation/truncation is writeHostCommand's own
 * job (05.1-07). This plan's own HOST_CMD ACK PROTOCOL section (05.1-08-PLAN.md) is the canonical
 * spec for how a caller correlates `sendStartPlacement`'s returned epoch against a later ack; this
 * file only provides the send/read primitives, never the pending-slot state machine itself (that
 * is Plan 14 Task 3's job).
 */

import { LIVE_HOST_CMD_LAYOUT, LIVE_HOST_CMD_ACTION } from '@swg/contracts';

// Path B: require the addon directly (nodeIntegration:true in the renderer) — same idiom as
// decorationPersistOrchestrator.ts / useChannelReader.ts.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const addon = require('@swg/live-inject') as {
  writeHostCommand: (
    name: string,
    epoch: number,
    action: number,
    str1: string,
    str2: string,
    id: string,
    vec3: Float32Array | number[],
  ) => void;
};

/** Module-scope monotonic epoch counter, starts at 1 (first ++ from 0), NEVER resets within a
 *  toolkit session — shared across all six send* functions below, since the agent's
 *  channelReadHostCommand contract treats "new epoch" as "new command" regardless of which
 *  action sent it (see this plan's HOST_CMD ACK PROTOCOL, "Late-ack rule" (ii): the no-false-
 *  match property is a direct consequence of this counter never resetting). */
let hostCmdEpoch = 0;

const ZERO_VEC3: number[] = [0, 0, 0];

export function sendReloadCurrentScene(mappingName: string): void {
  addon.writeHostCommand(
    mappingName,
    ++hostCmdEpoch,
    LIVE_HOST_CMD_ACTION.RELOAD_CURRENT_SCENE,
    '',
    '',
    '0',
    ZERO_VEC3,
  );
}

export function sendLoadEditorScene(mappingName: string, terrain: string, avatarTemplate: string): void {
  addon.writeHostCommand(
    mappingName,
    ++hostCmdEpoch,
    LIVE_HOST_CMD_ACTION.LOAD_EDITOR_SCENE,
    terrain,
    avatarTemplate,
    '0',
    ZERO_VEC3,
  );
}

export function sendTeleport(mappingName: string, x: number, y: number, z: number): void {
  addon.writeHostCommand(
    mappingName,
    ++hostCmdEpoch,
    LIVE_HOST_CMD_ACTION.TELEPORT,
    '',
    '',
    '0',
    [x, y, z],
  );
}

/**
 * (ROUND 10, AA4) The ONLY one of the six send* functions that returns a value — the
 * post-increment `hostCmdEpoch` this call used, i.e. exactly what a subsequent
 * `parseHostCommandResult` will report as `epoch` for this command's ack. Plan 14 correlates this
 * against `worldEditorStore.lastHostCommandResult` (this plan's Task 2 output) to avoid showing a
 * false-positive "active" toast when the agent silently refuses (Plan 12's `g_capArmed`/
 * `g_placementActive` exclusivity guards, both of which return result 0 with zero other signal).
 */
export function sendStartPlacement(
  mappingName: string,
  decorationTemplate: string,
  cellName: string,
  buildingId: string,
): number {
  addon.writeHostCommand(
    mappingName,
    ++hostCmdEpoch,
    LIVE_HOST_CMD_ACTION.START_PLACEMENT,
    decorationTemplate,
    cellName,
    buildingId,
    ZERO_VEC3,
  );
  return hostCmdEpoch;
}

export function sendCancelPlacement(mappingName: string): void {
  addon.writeHostCommand(
    mappingName,
    ++hostCmdEpoch,
    LIVE_HOST_CMD_ACTION.CANCEL_PLACEMENT,
    '',
    '',
    '0',
    ZERO_VEC3,
  );
}

export function sendDespawnNode(mappingName: string, networkId: string): void {
  addon.writeHostCommand(
    mappingName,
    ++hostCmdEpoch,
    LIVE_HOST_CMD_ACTION.DESPAWN_NODE,
    '',
    '',
    networkId,
    ZERO_VEC3,
  );
}

/**
 * (contract v32) Rebuild ONE building's interior from its current `.ilf`, in place, with no scene
 * reload — the edit-visibility instrument for an occupied building, which is kept across a reload
 * and keeps rendering its pre-edit interior until a zone change or relog.
 *
 * DELIBERATELY-TRIGGERED ONLY. Never call this as part of a persist: the refresh recreates the
 * building's `.ilf`-sourced decorations but does NOT remove a just-persisted preview object (the
 * agent forgets that node rather than despawning it, so the object stays live), which would leave
 * two visible copies of the same decoration. The agent also refuses while a snapshot parse is in
 * flight or while a decoration is armed — both surface as code 0.
 */
export function sendRefreshInterior(mappingName: string, buildingId: string): void {
  addon.writeHostCommand(
    mappingName,
    ++hostCmdEpoch,
    LIVE_HOST_CMD_ACTION.REFRESH_INTERIOR,
    '',
    '',
    buildingId,
    ZERO_VEC3,
  );
}

/** Read the HOST_CMD RESULT words. `epoch === 0` means no result yet; `code` is a signed int32 —
 *  the DESPAWN_NODE-specific 1/0/-1 contract, or the generic 1=ok/0=endpoint-unresolved-or-failed
 *  contract every other action uses (see `describeHostCommandResult`). */
export function parseHostCommandResult(buf: ArrayBuffer): { epoch: number; code: number } {
  const view = new DataView(buf);
  const L = LIVE_HOST_CMD_LAYOUT;
  const epoch = view.getUint32(L.HOST_CMD_RESULT_EPOCH.offset, true);
  const code = view.getInt32(L.HOST_CMD_RESULT_CODE.offset, true);
  return { epoch, code };
}

/**
 * (C9) A words-only per-action outcome describer — mirrors `decorationResultLabel`'s idiom for a
 * DIFFERENT result space (HOST_CMD_RESULT_CODE, not LIVE_DECORATION_RESULT). DESPAWN_NODE and
 * REFRESH_INTERIOR each have their own 1/0/-1 contract (mirroring the advertised
 * `worldSnapshot::wsRemoveNode` and `clientInteriorLayoutManager::refreshInteriorLayout`
 * respectively); every other action uses 1=ok / 0=endpoint-unresolved-or-failed. An unrecognized
 * `action` value fails closed with 'unknown action' rather than throwing, matching the agent-side
 * dispatch's own fail-closed discipline (Plan 09).
 */
export function describeHostCommandResult(action: number, code: number): string {
  if (action === LIVE_HOST_CMD_ACTION.DESPAWN_NODE) {
    switch (code) {
      case 1: return 'despawned';
      case 0: return 'not found (already gone or buildout-provenance)';
      case -1: return 'occupied — try again';
      default: return 'unknown outcome';
    }
  }

  if (action === LIVE_HOST_CMD_ACTION.REFRESH_INTERIOR) {
    switch (code) {
      case 1: return 'interior rebuilt';
      // The agent folds its own two refusals into the engine's 0 — a parse still in flight, and a
      // decoration currently armed (a refresh frees and recreates the layout objects, so it must
      // not run while the overlay holds one). Neither is distinguishable from the engine's own
      // "no such object / not a POB / not a building template", so the words cover all of them.
      case 0: return 'not refreshed (no such building, not a POB, still loading, or an edit is armed)';
      case -1: return 'layout reload failed';
      default: return 'unknown outcome';
    }
  }

  switch (action) {
    case LIVE_HOST_CMD_ACTION.RELOAD_CURRENT_SCENE:
    case LIVE_HOST_CMD_ACTION.LOAD_EDITOR_SCENE:
    case LIVE_HOST_CMD_ACTION.TELEPORT:
    case LIVE_HOST_CMD_ACTION.START_PLACEMENT:
    case LIVE_HOST_CMD_ACTION.CANCEL_PLACEMENT:
      return code === 1 ? 'ok' : 'endpoint unresolved or failed';
    default:
      return 'unknown action';
  }
}
