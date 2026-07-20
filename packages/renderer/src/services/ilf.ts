/**
 * packages/renderer/src/services/ilf.ts
 * Interior-layout (`.ilf`) reader/writer — the pure-consumer half of model (D) for
 * per-instance interior-decoration persistence (Live World Editor).
 *
 * Format (CONSULT-70, verified against swg-client-v2 InteriorLayoutReaderWriter.cpp:331-378):
 *   FORM 'INLY'
 *     FORM '0000'                       ← only supported version
 *       CHUNK 'NODE' × N
 *         asciiz objectTemplateName     (null-terminated ASCII)
 *         asciiz cellName               (null-terminated ASCII)
 *         12 × float32 LE               Transform o2p, 3×4 row-major (cols 0..2 rotation, col 3 pos)
 *
 * IFF block headers (4-char tag + u32 length) are BIG-endian; the length of a FORM INCLUDES its
 * 4-byte subtype tag; leaf-chunk length is the payload byte count. Float scalars are LITTLE-endian.
 * No CRC, no checksum, no baked spatial index — moving one node's transform and re-serializing
 * yields a file the client loads identically except for that placement.
 *
 * INVARIANT (CONSULT-70): within-cell NODE order is the object's identity (row index). Nodes are
 * kept in file order and re-emitted in that order — never reordered. Transforms are o2p
 * (object-to-parent-CELL); the gizmo's o2w must be converted to o2p before being written here.
 */

export interface IlfNode {
  /** Object template path, e.g. "object/tangible/furniture/tatooine/shared_frn_tatt_table_cantina_table_3.iff". */
  objectTemplateName: string;
  /** Cell name (matches a POB portal cell). */
  cellName: string;
  /** 12 floats, o2p, row-major 3×4 (m00 m01 m02 m03 m10 … m23). */
  transform: number[];
}

const TAG_LEN = 4;
const HEADER_LEN = 8; // 4-char tag + u32 length
const TRANSFORM_FLOATS = 12;
const TRANSFORM_BYTES = TRANSFORM_FLOATS * 4;

function readTag(buf: Buffer, off: number): string {
  return buf.toString('ascii', off, off + TAG_LEN);
}

function readAsciiz(buf: Buffer, off: number): string {
  let end = off;
  while (end < buf.length && buf[end] !== 0) end++;
  return buf.toString('ascii', off, end);
}

// ── Parse ────────────────────────────────────────────────────────────────────

/**
 * Parse a `.ilf` buffer into an ordered node list. Throws on a structurally invalid file
 * (wrong tags / unsupported version) — fail closed rather than silently mis-edit.
 */
export function parseIlf(buf: Buffer): IlfNode[] {
  // FORM 'INLY'
  if (readTag(buf, 0) !== 'FORM' || readTag(buf, HEADER_LEN) !== 'INLY') {
    throw new Error('ilf: not a FORM INLY file');
  }
  // FORM '0000' immediately inside INLY (INLY payload starts after FORM header + the INLY subtype tag).
  const inlyContentStart = HEADER_LEN + TAG_LEN;
  if (readTag(buf, inlyContentStart) !== 'FORM' || readTag(buf, inlyContentStart + HEADER_LEN) !== '0000') {
    throw new Error('ilf: unsupported version (expected FORM 0000)');
  }
  const form0000Len = buf.readUInt32BE(inlyContentStart + TAG_LEN); // includes the 4-byte '0000' subtype
  const nodesStart = inlyContentStart + HEADER_LEN + TAG_LEN;
  const nodesEnd = inlyContentStart + HEADER_LEN + form0000Len; // == nodesStart + (form0000Len - TAG_LEN)

  const nodes: IlfNode[] = [];
  let p = nodesStart;
  while (p + HEADER_LEN <= nodesEnd) {
    const tag = readTag(buf, p);
    const len = buf.readUInt32BE(p + TAG_LEN);
    const payloadStart = p + HEADER_LEN;
    if (tag !== 'NODE') {
      // Unknown chunk — skip it verbatim by declared length (robust, though .ilf only has NODE).
      p = payloadStart + len;
      continue;
    }
    let r = payloadStart;
    const objectTemplateName = readAsciiz(buf, r);
    r += objectTemplateName.length + 1;
    const cellName = readAsciiz(buf, r);
    r += cellName.length + 1;
    const transform: number[] = [];
    for (let i = 0; i < TRANSFORM_FLOATS; i++) {
      transform.push(buf.readFloatLE(r));
      r += 4;
    }
    nodes.push({ objectTemplateName, cellName, transform });
    p = payloadStart + len; // advance by the declared chunk length (tolerates any trailing bytes)
  }
  return nodes;
}

// ── Serialize ─────────────────────────────────────────────────────────────────

function chunkNode(node: IlfNode): Buffer {
  if (node.transform.length !== TRANSFORM_FLOATS) {
    throw new Error(`ilf: node transform must be ${TRANSFORM_FLOATS} floats, got ${node.transform.length}`);
  }
  const tmpl = Buffer.from(node.objectTemplateName, 'ascii');
  const cell = Buffer.from(node.cellName, 'ascii');
  const payload = Buffer.alloc(tmpl.length + 1 + cell.length + 1 + TRANSFORM_BYTES);
  let o = 0;
  tmpl.copy(payload, o); o += tmpl.length; payload[o++] = 0;
  cell.copy(payload, o); o += cell.length; payload[o++] = 0;
  for (let i = 0; i < TRANSFORM_FLOATS; i++) { payload.writeFloatLE(node.transform[i], o); o += 4; }

  const header = Buffer.alloc(HEADER_LEN);
  header.write('NODE', 0, 'ascii');
  header.writeUInt32BE(payload.length, TAG_LEN);
  return Buffer.concat([header, payload]);
}

/** Wrap `contents` in a FORM whose length INCLUDES the 4-byte subtype (SWG IFF convention). */
function wrapForm(subType: string, contents: Buffer): Buffer {
  const header = Buffer.alloc(HEADER_LEN);
  header.write('FORM', 0, 'ascii');
  header.writeUInt32BE(TAG_LEN + contents.length, TAG_LEN);
  const sub = Buffer.alloc(TAG_LEN);
  sub.write(subType, 0, 'ascii');
  return Buffer.concat([header, sub, contents]);
}

/** Serialize nodes back to a `.ilf` buffer, preserving their order (within-cell order = identity). */
export function serializeIlf(nodes: IlfNode[]): Buffer {
  const body = Buffer.concat(nodes.map(chunkNode));
  return wrapForm('INLY', wrapForm('0000', body));
}

// ── Edit helper ───────────────────────────────────────────────────────────────

/**
 * Replace the o2p transform of the `rowIndex`-th node in `cellName` (0-based, in file order —
 * the within-cell identity). Returns a NEW array (does not mutate the input). Throws if the
 * (cellName, rowIndex) doesn't resolve — fail closed rather than edit the wrong object.
 */
export function editNodeTransform(
  nodes: IlfNode[],
  cellName: string,
  rowIndex: number,
  transformO2p: number[],
): IlfNode[] {
  if (transformO2p.length !== TRANSFORM_FLOATS) {
    throw new Error(`ilf: transform must be ${TRANSFORM_FLOATS} floats`);
  }
  const out = nodes.map((n) => ({ ...n, transform: [...n.transform] }));
  let seen = -1;
  for (const n of out) {
    if (n.cellName !== cellName) continue;
    seen++;
    if (seen === rowIndex) {
      n.transform = [...transformO2p];
      return out;
    }
  }
  throw new Error(`ilf: no node at (cell="${cellName}", rowIndex=${rowIndex})`);
}
