/**
 * packages/renderer/src/services/decorationChannel.ts
 * Renderer-side decode of the decoration-persist channel region (model D). Pure functions over
 * the channel ArrayBuffer — the same whole-view buffer useChannelReader already polls.
 *
 * CAPTURE (agent → host) is seqlocked exactly like the read frame: read seq (odd ⇒ mid-write ⇒
 * null), read epoch + payload, re-read seq (changed ⇒ torn ⇒ null). RESULT (agent → host) is two
 * single aligned words the agent publishes code-before-epoch, so a plain read is safe (once a new
 * epoch is visible its code is already written).
 *
 * The u64 building id crosses as a DECIMAL STRING (DecorationCapture.buildingInstanceId) — a JS
 * number can't hold a full 64-bit .ws node id losslessly; writeRebind parses it back with _strtoui64.
 */

import { LIVE_DECORATION_LAYOUT, LIVE_DECORATION_RESULT, LIVE_DECORATION_CAPTURE_KIND } from '@swg/contracts';
import type { DecorationCapture } from '@swg/contracts';

function readFloats(view: DataView, offset: number, count: number): number[] {
  const out: number[] = new Array(count);
  for (let i = 0; i < count; i++) out[i] = view.getFloat32(offset + i * 4, true);
  return out;
}

/**
 * Read a NUL-terminated string the agent wrote into the channel.
 *
 * DECODES AS UTF-8, NOT ASCII — do not "simplify" this back.
 * `new TextDecoder('ascii')` is a WHATWG alias for **windows-1252**, which cannot represent
 * anything the agent writes above 0x7F. `overlay.cpp` deliberately emits UTF-8 em-dashes
 * (`\xE2\x80\x94`) in its user-facing strings to match the sketch typography — e.g.
 * `"not inside a building — interior decorations only"` (overlay.cpp:540). Under the old ascii
 * decode those three bytes surfaced in the World panel's Activity accordion as the mojibake
 * `â€"`, which is what a maintainer actually saw live on 2026-08-07.
 *
 * UTF-8 is a strict superset of ASCII, so the two pure-path callers below
 * (decorationTemplateName / buildingTemplateVfsPath, both VFS paths) decode identically; only
 * the dual-purpose cellName slot — which carries a failure REASON on kind=ARM_FAILED — changes.
 */
function readAsciiz(buf: ArrayBuffer, offset: number, maxLen: number): string {
  const bytes = new Uint8Array(buf, offset, maxLen);
  let nul = bytes.indexOf(0);
  if (nul < 0) nul = maxLen;
  return new TextDecoder('utf-8').decode(bytes.slice(0, nul));
}

/**
 * Seqlock-read the CAPTURE region. Returns `{ epoch, capture }` or null on a mid-write/torn read.
 * `epoch === 0` means nothing captured yet; the caller processes each epoch strictly greater than
 * the last it handled.
 */
export function parseDecorationCapture(
  buf: ArrayBuffer,
): { epoch: number; capture: DecorationCapture } | null {
  const view = new DataView(buf);
  const D = LIVE_DECORATION_LAYOUT;

  const seq1 = view.getUint32(D.CAPTURE_SEQ_COUNTER.offset, true);
  if ((seq1 & 1) !== 0) return null; // writer mid-write

  const epoch = view.getUint32(D.CAPTURE_EPOCH.offset, true);
  const idLo = view.getUint32(D.CAPTURE_BUILDING_ID.offset, true);
  const idHi = view.getUint32(D.CAPTURE_BUILDING_ID.offset + 4, true);
  const buildingInstanceId = (((BigInt(idHi) << 32n) | BigInt(idLo))).toString();
  const originalO2p = readFloats(view, D.CAPTURE_ORIGINAL_O2P.offset, 12);
  const newO2p = readFloats(view, D.CAPTURE_NEW_O2P.offset, 12);
  const decorationTemplateName = readAsciiz(buf, D.CAPTURE_DECORATION_TEMPLATE.offset, D.CAPTURE_DECORATION_TEMPLATE.length);
  const buildingTemplateVfsPath = readAsciiz(buf, D.CAPTURE_BUILDING_TEMPLATE.offset, D.CAPTURE_BUILDING_TEMPLATE.length);

  // (05.1-08 Task 3, C2) CAPTURE_KIND/CAPTURE_CELL_NAME — non-contiguous with the fields above
  // (1308/1312 vs 512-1024) but still INSIDE the same seq1...seq2 seqlock span (Plan 03 Task 1's
  // explicit ordering requirement: correctness depends on seqlock span membership, not physical
  // byte adjacency).
  const kindNum = view.getUint32(D.CAPTURE_KIND.offset, true);
  const kind =
    kindNum === LIVE_DECORATION_CAPTURE_KIND.ADD ? 'add'
    : kindNum === LIVE_DECORATION_CAPTURE_KIND.ARM_FAILED ? 'arm-failed'
    : 'edit'; // fail-safe default — never throw on an unrecognized kind value
  const cellNameRaw = readAsciiz(buf, D.CAPTURE_CELL_NAME.offset, D.CAPTURE_CELL_NAME.length);
  const cellName = cellNameRaw || undefined;

  const seq2 = view.getUint32(D.CAPTURE_SEQ_COUNTER.offset, true);
  if (seq1 !== seq2) return null; // torn read

  return {
    epoch,
    capture: { buildingInstanceId, buildingTemplateVfsPath, decorationTemplateName, originalO2p, newO2p, kind, cellName },
  };
}

/** Read the RESULT words. `epoch === 0` means no result yet; `code` is a LIVE_DECORATION_RESULT value
 *  (negative for pre-save refusals — read as signed). */
export function readDecorationResult(buf: ArrayBuffer): { epoch: number; code: number } {
  const view = new DataView(buf);
  const D = LIVE_DECORATION_LAYOUT;
  const epoch = view.getUint32(D.RESULT_EPOCH.offset, true);
  const code = view.getInt32(D.RESULT_CODE.offset, true);
  return { epoch, code };
}

/** Human-readable label for a LIVE_DECORATION_RESULT code (UI/log). */
export function decorationResultLabel(code: number): string {
  switch (code) {
    case LIVE_DECORATION_RESULT.OK: return 'ok — rebound & saved';
    case LIVE_DECORATION_RESULT.SAVE_NO_SNAPSHOT: return 'save failed: no snapshot loaded';
    case LIVE_DECORATION_RESULT.SAVE_NO_LOOSE_PATH: return 'save failed: no writable loose SearchPath';
    case LIVE_DECORATION_RESULT.SAVE_SHADOWED: return 'save failed: destination shadowed';
    case LIVE_DECORATION_RESULT.SAVE_ID_OVERFLOW: return 'save failed: id int32 overflow';
    case LIVE_DECORATION_RESULT.SAVE_INTEGRITY: return 'save failed: buildout-set integrity';
    case LIVE_DECORATION_RESULT.SAVE_WRITE_FAILURE: return 'save failed: write error';
    case LIVE_DECORATION_RESULT.NODE_NOT_FOUND: return 'rebind refused: .ws node not found';
    case LIVE_DECORATION_RESULT.BUILDING_ID_MISMATCH: return 'rebind refused: building id mismatch';
    case LIVE_DECORATION_RESULT.ABORTED: return 'aborted';
    case LIVE_DECORATION_RESULT.NOT_A_WS_NODE: return 'rebind refused: not a client .ws node';
    case LIVE_DECORATION_RESULT.REBIND_REFUSED: return 'rebind refused: template unresolvable or buildout-provenance node';
    default: return `unknown result (${code})`;
  }
}
