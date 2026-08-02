/**
 * packages/renderer/src/services/decorationChannel.test.ts
 * Round-trip + seqlock coverage for the renderer-side CAPTURE/RESULT decode.
 */

import { describe, it, expect } from 'vitest';

import {
  LIVE_DECORATION_LAYOUT,
  LIVE_CHANNEL_TOTAL_SIZE,
  LIVE_DECORATION_RESULT,
  LIVE_DECORATION_CAPTURE_KIND,
} from '@swg/contracts';
import { parseDecorationCapture, readDecorationResult, decorationResultLabel } from './decorationChannel';

const D = LIVE_DECORATION_LAYOUT;

function makeBuf(): { buf: ArrayBuffer; view: DataView } {
  const buf = new ArrayBuffer(LIVE_CHANNEL_TOTAL_SIZE);
  return { buf, view: new DataView(buf) };
}

function writeAsciiz(view: DataView, offset: number, s: string): void {
  for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  view.setUint8(offset + s.length, 0);
}

function writeCapture(
  view: DataView,
  opts: { seq: number; epoch: number; buildingId: bigint; original: number[]; next: number[]; deco: string; bldg: string },
): void {
  view.setUint32(D.CAPTURE_SEQ_COUNTER.offset, opts.seq, true);
  view.setUint32(D.CAPTURE_EPOCH.offset, opts.epoch, true);
  view.setUint32(D.CAPTURE_BUILDING_ID.offset, Number(opts.buildingId & 0xffffffffn), true);
  view.setUint32(D.CAPTURE_BUILDING_ID.offset + 4, Number(opts.buildingId >> 32n), true);
  for (let i = 0; i < 12; i++) view.setFloat32(D.CAPTURE_ORIGINAL_O2P.offset + i * 4, opts.original[i], true);
  for (let i = 0; i < 12; i++) view.setFloat32(D.CAPTURE_NEW_O2P.offset + i * 4, opts.next[i], true);
  writeAsciiz(view, D.CAPTURE_DECORATION_TEMPLATE.offset, opts.deco);
  writeAsciiz(view, D.CAPTURE_BUILDING_TEMPLATE.offset, opts.bldg);
}

const orig = [1, 0, 0, 5.5, 0, 1, 0, 6.25, 0, 0, 1, 7.75];
const moved = [1, 0, 0, 50.5, 0, 1, 0, 60.25, 0, 0, 1, 70.75];
const DECO = 'object/tangible/furniture/shared_frn_table.iff';
const BLDG = 'object/building/tatooine/shared_cantina_tatooine.iff';
const BIG_ID = 1099511628033n; // > 2^32, exercises the hi/lo split

describe('parseDecorationCapture', () => {
  it('round-trips a captured edit (even seq)', () => {
    const { buf, view } = makeBuf();
    writeCapture(view, { seq: 2, epoch: 7, buildingId: BIG_ID, original: orig, next: moved, deco: DECO, bldg: BLDG });

    const r = parseDecorationCapture(buf);
    expect(r).not.toBeNull();
    expect(r!.epoch).toBe(7);
    expect(r!.capture.buildingInstanceId).toBe(BIG_ID.toString()); // decimal u64, lossless
    expect(r!.capture.decorationTemplateName).toBe(DECO);
    expect(r!.capture.buildingTemplateVfsPath).toBe(BLDG);
    expect(r!.capture.originalO2p).toEqual(orig);
    expect(r!.capture.newO2p).toEqual(moved);
  });

  it('returns null on a mid-write (odd seq)', () => {
    const { buf, view } = makeBuf();
    writeCapture(view, { seq: 3, epoch: 7, buildingId: BIG_ID, original: orig, next: moved, deco: DECO, bldg: BLDG });
    expect(parseDecorationCapture(buf)).toBeNull();
  });

  it('returns null on a torn read (seq changes mid-parse)', () => {
    const { buf, view } = makeBuf();
    writeCapture(view, { seq: 2, epoch: 7, buildingId: BIG_ID, original: orig, next: moved, deco: DECO, bldg: BLDG });
    // Simulate a writer bumping the seq after our first read: patch getUint32 to advance on 2nd seq read.
    let seqReads = 0;
    const realGet = DataView.prototype.getUint32;
    const spy = function (this: DataView, off: number, le?: boolean): number {
      if (off === D.CAPTURE_SEQ_COUNTER.offset) { seqReads++; return seqReads === 1 ? 2 : 4; }
      return realGet.call(this, off, le);
    } as typeof DataView.prototype.getUint32;
    DataView.prototype.getUint32 = spy;
    try {
      expect(parseDecorationCapture(buf)).toBeNull();
    } finally {
      DataView.prototype.getUint32 = realGet;
    }
  });

  it('reads epoch 0 (nothing captured) from a zeroed buffer', () => {
    const { buf } = makeBuf();
    const r = parseDecorationCapture(buf);
    expect(r).not.toBeNull();
    expect(r!.epoch).toBe(0);
  });
});

// ─── 05.1-08 Task 3, C2: CAPTURE_KIND / CAPTURE_CELL_NAME decode ────────────────────────────────

function writeCellName(view: DataView, s: string): void {
  for (let i = 0; i < s.length; i++) view.setUint8(D.CAPTURE_CELL_NAME.offset + i, s.charCodeAt(i));
  view.setUint8(D.CAPTURE_CELL_NAME.offset + s.length, 0);
}

describe('parseDecorationCapture — CAPTURE_KIND/CAPTURE_CELL_NAME decode (05.1-08 Task 3, C2)', () => {
  it('CAPTURE_KIND=1 (ADD) with a CAPTURE_CELL_NAME string decodes kind==="add" and the exact cellName', () => {
    const { buf, view } = makeBuf();
    writeCapture(view, { seq: 2, epoch: 1, buildingId: BIG_ID, original: orig, next: moved, deco: DECO, bldg: BLDG });
    view.setUint32(D.CAPTURE_KIND.offset, LIVE_DECORATION_CAPTURE_KIND.ADD, true);
    writeCellName(view, 'cell1');

    const r = parseDecorationCapture(buf);
    expect(r).not.toBeNull();
    expect(r!.capture.kind).toBe('add');
    expect(r!.capture.cellName).toBe('cell1');
  });

  it('CAPTURE_KIND=0 (or a zeroed field, matching a pre-Plan-03 buffer) decodes kind==="edit" and cellName===undefined', () => {
    const { buf, view } = makeBuf();
    writeCapture(view, { seq: 2, epoch: 1, buildingId: BIG_ID, original: orig, next: moved, deco: DECO, bldg: BLDG });
    // CAPTURE_KIND/CAPTURE_CELL_NAME left zeroed — simulates a pre-05.1-03 agent buffer.

    const r = parseDecorationCapture(buf);
    expect(r).not.toBeNull();
    expect(r!.capture.kind).toBe('edit');
    expect(r!.capture.cellName).toBeUndefined();
  });

  it('CAPTURE_KIND=2 (ARM_FAILED) decodes kind==="arm-failed"', () => {
    const { buf, view } = makeBuf();
    writeCapture(view, { seq: 2, epoch: 1, buildingId: BIG_ID, original: orig, next: moved, deco: DECO, bldg: BLDG });
    view.setUint32(D.CAPTURE_KIND.offset, LIVE_DECORATION_CAPTURE_KIND.ARM_FAILED, true);
    writeCellName(view, 'could not resolve target cell');

    const r = parseDecorationCapture(buf);
    expect(r).not.toBeNull();
    expect(r!.capture.kind).toBe('arm-failed');
    expect(r!.capture.cellName).toBe('could not resolve target cell');
  });

  it('an unrecognized CAPTURE_KIND value fails safe to "edit" rather than throwing', () => {
    const { buf, view } = makeBuf();
    writeCapture(view, { seq: 2, epoch: 1, buildingId: BIG_ID, original: orig, next: moved, deco: DECO, bldg: BLDG });
    view.setUint32(D.CAPTURE_KIND.offset, 99, true);

    expect(() => parseDecorationCapture(buf)).not.toThrow();
    expect(parseDecorationCapture(buf)!.capture.kind).toBe('edit');
  });

  it('integration: a REAL, hand-built ADD-kind ArrayBuffer decodes end-to-end through the REAL parseDecorationCapture (C2 — not a mocked capture object)', () => {
    const buf = new ArrayBuffer(LIVE_CHANNEL_TOTAL_SIZE);
    const view = new DataView(buf);
    const buildingId = 555555n;

    view.setUint32(D.CAPTURE_SEQ_COUNTER.offset, 4, true); // even
    view.setUint32(D.CAPTURE_EPOCH.offset, 11, true);
    view.setUint32(D.CAPTURE_BUILDING_ID.offset, Number(buildingId & 0xffffffffn), true);
    view.setUint32(D.CAPTURE_BUILDING_ID.offset + 4, Number(buildingId >> 32n), true);
    for (let i = 0; i < 12; i++) view.setFloat32(D.CAPTURE_ORIGINAL_O2P.offset + i * 4, orig[i], true);
    for (let i = 0; i < 12; i++) view.setFloat32(D.CAPTURE_NEW_O2P.offset + i * 4, moved[i], true);
    // asciiz writers, matching writeAsciiz's convention
    const writeStr = (offset: number, s: string) => {
      for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
      view.setUint8(offset + s.length, 0);
    };
    writeStr(D.CAPTURE_DECORATION_TEMPLATE.offset, DECO);
    writeStr(D.CAPTURE_BUILDING_TEMPLATE.offset, BLDG);
    view.setUint32(D.CAPTURE_KIND.offset, LIVE_DECORATION_CAPTURE_KIND.ADD, true);
    writeStr(D.CAPTURE_CELL_NAME.offset, 'cell_interior_1');

    const r = parseDecorationCapture(buf);
    expect(r).not.toBeNull();
    expect(r!.epoch).toBe(11);
    expect(r!.capture.kind).toBe('add');
    expect(r!.capture.cellName).toBe('cell_interior_1');
    expect(r!.capture.buildingInstanceId).toBe(buildingId.toString());
    expect(r!.capture.decorationTemplateName).toBe(DECO);
    expect(r!.capture.buildingTemplateVfsPath).toBe(BLDG);
  });
});

describe('readDecorationResult', () => {
  it('reads a negative refusal code (int32)', () => {
    const { buf, view } = makeBuf();
    view.setInt32(D.RESULT_CODE.offset, LIVE_DECORATION_RESULT.NODE_NOT_FOUND, true); // -1
    view.setUint32(D.RESULT_EPOCH.offset, 4, true);
    const r = readDecorationResult(buf);
    expect(r.epoch).toBe(4);
    expect(r.code).toBe(LIVE_DECORATION_RESULT.NODE_NOT_FOUND);
  });

  it('reads OK', () => {
    const { buf, view } = makeBuf();
    view.setInt32(D.RESULT_CODE.offset, LIVE_DECORATION_RESULT.OK, true);
    view.setUint32(D.RESULT_EPOCH.offset, 9, true);
    expect(readDecorationResult(buf)).toEqual({ epoch: 9, code: 0 });
  });
});

describe('decorationResultLabel', () => {
  it('labels ok and a refusal', () => {
    expect(decorationResultLabel(LIVE_DECORATION_RESULT.OK)).toMatch(/ok/i);
    expect(decorationResultLabel(LIVE_DECORATION_RESULT.NOT_A_WS_NODE)).toMatch(/\.ws node/i);
  });

  it('labels REBIND_REFUSED with human words, never a raw code', () => {
    const label = decorationResultLabel(LIVE_DECORATION_RESULT.REBIND_REFUSED);
    expect(label).toMatch(/refused/i);
    expect(label).not.toMatch(/-5/);
    expect(label).not.toMatch(/unknown result/i);
  });
});
