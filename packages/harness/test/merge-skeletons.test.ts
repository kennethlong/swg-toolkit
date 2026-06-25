/**
 * merge-skeletons.test.ts — unit tests for the multi-skeleton merge used by
 * composed multi-part skinned .sat (e.g. ackbar = all_b + mon_m_face @ "head").
 *
 * Guards the ground-truth behaviors (CONSULT-MP-AXIOMS):
 *  - bones concatenated in attach order; child parentIndex offset by segment base
 *  - attached segment ROOT reparented to the named transform, found CASE-INSENSITIVELY
 *  - main segment (attach "") keeps its root at -1
 *  - first-wins on bone-name collision; attach-not-found → warning + free root
 */

import { describe, it, expect } from 'vitest';
import { mergeSkeletons, type SkeletonSegment } from '../../renderer/src/panels/viewport/resolver/mergeSkeletons.ts';
import type { SkeletonParseResult, BoneNode } from '../../contracts/src/skeleton.ts';

const Q: [number, number, number, number] = [1, 0, 0, 0];
const V: [number, number, number] = [0, 0, 0];

function bone(name: string, parentIndex: number): BoneNode {
  return { name, parentIndex, bindTranslation: V, preMultiplyRotation: Q, postMultiplyRotation: Q, bindPoseRotation: Q };
}
function skel(bones: BoneNode[]): SkeletonParseResult {
  return { version: '0002', bones, roundTrip: { passed: true } };
}

describe('mergeSkeletons', () => {
  it('concatenates segments in attach order and offsets child parentIndex', () => {
    const main: SkeletonSegment = {
      parseResult: skel([bone('root', -1), bone('Head', 0)]),
      attachmentTransformName: '',
    };
    const face: SkeletonSegment = {
      parseResult: skel([bone('face_root', -1), bone('jaw', 0)]),
      attachmentTransformName: 'head', // lowercase vs "Head" — must match case-insensitively
    };
    const merged = mergeSkeletons([main, face]);

    expect(merged.boneOrder).toEqual(['root', 'Head', 'face_root', 'jaw']);
    // main root stays -1
    expect(merged.parseResult.bones[0]!.parentIndex).toBe(-1);
    // Head's parent (0) unchanged
    expect(merged.parseResult.bones[1]!.parentIndex).toBe(0);
    // face_root reparented to "Head" (merged index 1), case-insensitive
    expect(merged.parseResult.bones[2]!.parentIndex).toBe(1);
    // jaw's local parent (0) offset by face base (2) → 2
    expect(merged.parseResult.bones[3]!.parentIndex).toBe(2);
  });

  it('warns and leaves a free root when the attach transform is not found', () => {
    const main: SkeletonSegment = { parseResult: skel([bone('root', -1)]), attachmentTransformName: '' };
    const face: SkeletonSegment = { parseResult: skel([bone('face_root', -1)]), attachmentTransformName: 'nonexistent' };
    const merged = mergeSkeletons([main, face]);
    expect(merged.parseResult.bones[1]!.parentIndex).toBe(-1);
    expect(merged.warnings.some(w => w.includes('nonexistent'))).toBe(true);
  });

  it('first occurrence wins on a bone-name collision', () => {
    const a: SkeletonSegment = { parseResult: skel([bone('root', -1), bone('shared', 0)]), attachmentTransformName: '' };
    const b: SkeletonSegment = { parseResult: skel([bone('shared', -1)]), attachmentTransformName: 'root' };
    const merged = mergeSkeletons([a, b]);
    // 3 bones kept; the duplicate "shared" still present positionally
    expect(merged.boneOrder).toEqual(['root', 'shared', 'shared']);
    expect(merged.warnings.some(w => w.toLowerCase().includes('collision'))).toBe(true);
  });
});
