/**
 * packages/renderer/src/services/iffTree.ts
 * Minimal mutable IFF tree — parse to nodes, edit a leaf's payload, re-serialize with
 * recomputed container lengths. Used by the model-D derived-building-template minter.
 *
 * SWG IFF: each block = 4-char tag + u32 BE length. Container tags (FORM/LIST/'CAT ') are
 * followed by a 4-char subtype then children (the length INCLUDES the 4-byte subtype). Any
 * other tag is a leaf whose length is its payload byte count. (Matches contracts/src/iff.ts
 * + swg-client-v2 Iff.cpp, verified by a byte-exact round-trip of a real client template.)
 */

const CONTAINER_TAGS = new Set(['FORM', 'LIST', 'CAT ']);
const TAG_LEN = 4;
const HEADER_LEN = 8;

export interface IffLeaf {
  kind: 'leaf';
  tag: string;
  payload: Buffer;
}
export interface IffForm {
  kind: 'form';
  tag: string; // 'FORM' | 'LIST' | 'CAT '
  subType: string;
  children: IffChunk[];
}
export type IffChunk = IffLeaf | IffForm;

/** Parse all top-level blocks in buf[off, end) into an ordered tree. */
export function parseIffTree(buf: Buffer, off = 0, end: number = buf.length): IffChunk[] {
  const out: IffChunk[] = [];
  let p = off;
  while (p + HEADER_LEN <= end) {
    const tag = buf.toString('ascii', p, p + TAG_LEN);
    const len = buf.readUInt32BE(p + TAG_LEN);
    const bodyStart = p + HEADER_LEN;
    const bodyEnd = bodyStart + len;
    if (CONTAINER_TAGS.has(tag)) {
      const subType = buf.toString('ascii', bodyStart, bodyStart + TAG_LEN);
      out.push({ kind: 'form', tag, subType, children: parseIffTree(buf, bodyStart + TAG_LEN, bodyEnd) });
    } else {
      out.push({ kind: 'leaf', tag, payload: buf.subarray(bodyStart, bodyEnd) });
    }
    p = bodyEnd;
  }
  return out;
}

function serializeChunk(c: IffChunk): Buffer {
  if (c.kind === 'leaf') {
    const header = Buffer.alloc(HEADER_LEN);
    header.write(c.tag, 0, 'ascii');
    header.writeUInt32BE(c.payload.length, TAG_LEN);
    return Buffer.concat([header, c.payload]);
  }
  const contents = serializeIffTree(c.children);
  const header = Buffer.alloc(HEADER_LEN);
  header.write(c.tag, 0, 'ascii');
  header.writeUInt32BE(TAG_LEN + contents.length, TAG_LEN); // length INCLUDES the subtype tag
  const sub = Buffer.alloc(TAG_LEN);
  sub.write(c.subType, 0, 'ascii');
  return Buffer.concat([header, sub, contents]);
}

/** Serialize a tree back to bytes, recomputing every container length from its children. */
export function serializeIffTree(chunks: IffChunk[]): Buffer {
  return Buffer.concat(chunks.map(serializeChunk));
}

/** Depth-first find the first form matching (tag, subType). */
export function findForm(chunks: IffChunk[], tag: string, subType: string): IffForm | null {
  for (const c of chunks) {
    if (c.kind === 'form') {
      if (c.tag === tag && c.subType === subType) return c;
      const nested = findForm(c.children, tag, subType);
      if (nested) return nested;
    }
  }
  return null;
}
