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
 * DIFFERENT result space (HOST_CMD_RESULT_CODE, not LIVE_DECORATION_RESULT). DESPAWN_NODE has its
 * own 1/0/-1 contract (mirrors utinni_wsRemoveNode); every other action uses 1=ok / 0=endpoint-
 * unresolved-or-failed. An unrecognized `action` value fails closed with 'unknown action' rather
 * than throwing, matching the agent-side dispatch's own fail-closed discipline (Plan 09).
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
