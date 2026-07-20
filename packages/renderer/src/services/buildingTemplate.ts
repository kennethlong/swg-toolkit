/**
 * packages/renderer/src/services/buildingTemplate.ts
 * Model-D derived-building-template minter (pure consumer).
 *
 * Given a stock building-template `.iff` (SBOT — a DERV already, verified against the real
 * shared_cantina_tatooine.iff), produce a per-instance derived template that is byte-identical
 * EXCEPT its `interiorLayoutFileName` param, re-pointed at an edited `.ilf`. That template +
 * the edited `.ilf` go to the loose dir; `wsSetNodeTemplateName` re-points the instance's `.ws`
 * node at the derived name → only that one building loads the edited interior (CONSULT-70).
 *
 * Param encoding (from the real cantina, verified): inside `FORM SBOT → FORM 0001`, a `PCNT`
 * leaf (LE int32 param count) then `XXXX` param leaves = `"<paramName>\0"` + 1 type byte
 * (0x00 = no value / 0x01 = single string) + (if 0x01) `"<value>\0"`.
 *
 * Invariants (CONSULT-70): change ONLY interiorLayoutFileName — never `.pob`/portal (inherited,
 * keeps the .ws portalLayoutCrc matched). Name the derived template by BUILDING INSTANCE id,
 * never dedupe (else per-instance collapses to per-template).
 */

import { parseIffTree, serializeIffTree, type IffChunk, type IffForm, type IffLeaf } from './iffTree';

const PARAM_NAME = 'interiorLayoutFileName';
const PARAM_TAG = 'XXXX';
const TYPE_SINGLE = 0x01;

function asForm(chunks: IffChunk[], subType: string): IffForm | undefined {
  return chunks.find((c): c is IffForm => c.kind === 'form' && c.subType === subType);
}

/** The paramName prefix of a template param leaf (the null-terminated name at payload start). */
function paramNameOf(leaf: IffLeaf): string {
  const p = leaf.payload;
  let i = 0;
  while (i < p.length && p[i] !== 0) i++;
  return p.toString('ascii', 0, i);
}

function makeInteriorLayoutParam(ilfPath: string): IffLeaf {
  const payload = Buffer.concat([
    Buffer.from(`${PARAM_NAME}\0`, 'ascii'),
    Buffer.from([TYPE_SINGLE]),
    Buffer.from(`${ilfPath}\0`, 'ascii'),
  ]);
  return { kind: 'leaf', tag: PARAM_TAG, payload };
}

/** Read a stock template's current interiorLayoutFileName (empty string if unset/inherited). */
export function readInteriorLayoutFileName(templateBytes: Buffer): string {
  const sbot = asForm(parseIffTree(templateBytes), 'SBOT');
  const form0001 = sbot && asForm(sbot.children, '0001');
  if (!form0001) return '';
  const leaf = form0001.children.find(
    (c): c is IffLeaf => c.kind === 'leaf' && c.tag === PARAM_TAG && paramNameOf(c) === PARAM_NAME,
  );
  if (!leaf) return '';
  const nameEnd = PARAM_NAME.length + 1; // past "name\0"
  if (leaf.payload[nameEnd] !== TYPE_SINGLE) return ''; // 0x00 = no value
  const valStart = nameEnd + 1;
  let end = valStart;
  while (end < leaf.payload.length && leaf.payload[end] !== 0) end++;
  return leaf.payload.toString('ascii', valStart, end);
}

/**
 * Produce a derived building template: the stock bytes with interiorLayoutFileName re-pointed
 * at `newIlfPath` (normalized lowercase, forward slashes — TRE convention). Everything else
 * (DERV base, portal/appearance params, the STOT/SHOT levels) is preserved verbatim.
 */
export function deriveBuildingTemplate(stockBytes: Buffer, newIlfPath: string): Buffer {
  const path = newIlfPath.replace(/\\/g, '/').toLowerCase();

  const tree = parseIffTree(stockBytes);
  const sbot = asForm(tree, 'SBOT');
  if (!sbot) throw new Error('buildingTemplate: not an SBOT building template');
  const form0001 = asForm(sbot.children, '0001');
  if (!form0001) throw new Error('buildingTemplate: SBOT missing FORM 0001');

  const existing = form0001.children.find(
    (c): c is IffLeaf => c.kind === 'leaf' && c.tag === PARAM_TAG && paramNameOf(c) === PARAM_NAME,
  );

  if (existing) {
    existing.payload = makeInteriorLayoutParam(path).payload;
  } else {
    // Not present (inherited from base) — add it and bump the LE-int32 param count.
    form0001.children.push(makeInteriorLayoutParam(path));
    const pcnt = form0001.children.find(
      (c): c is IffLeaf => c.kind === 'leaf' && c.tag === 'PCNT',
    );
    if (!pcnt || pcnt.payload.length < 4) throw new Error('buildingTemplate: SBOT 0001 missing PCNT');
    const count = Buffer.from(pcnt.payload); // copy — never mutate the source view
    count.writeInt32LE(count.readInt32LE(0) + 1, 0);
    pcnt.payload = count;
  }

  return serializeIffTree(tree);
}
