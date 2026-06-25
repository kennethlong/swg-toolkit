/**
 * packages/renderer/src/panels/viewport/resolver/mergeSkeletons.ts
 *
 * Merge N skeleton segments (main + attached) into ONE SkeletonParseResult for a
 * multi-skeleton skinned .sat (e.g. ackbar = all_b + mon_m_face @ "head").
 *
 * Ground truth (swg-client-v2 Skeleton.cpp:862-913, drawJointFramesNow:1297-1304):
 *   - Transforms occupy contiguous blocks in skeleton-segment ATTACH ORDER.
 *   - An attached segment's ROOT joint is reparented to the named transform
 *     ("head") found in an already-attached segment; the root joint STAYS in the
 *     hierarchy (typically identity). There is NO extra attach offset in the .sat.
 *   - Name lookup is CASE-INSENSITIVE (CrcLowerString). all_b has a bone "Head";
 *     the .sat attach name is "head" — so the lookup MUST be case-insensitive.
 *   - Combined transform-name map: first-match-wins on collision (verified disjoint
 *     for ackbar: all_b 38 bones vs mon_m_face 12 bones, zero overlap).
 *
 * A mesh part binds to bones by NAME against this merged set (CONSULT-MP-AXIOMS A3),
 * so the merged `boneOrder` (names in merged index order) MUST be passed to
 * parseSkeletalMesh for every part — its skinIndices then index the merged skeleton.
 */

import type { SkeletonParseResult, BoneNode } from '@swg/contracts';

/** One skeleton segment + where it attaches in the already-merged bone set. */
export interface SkeletonSegment {
  parseResult: SkeletonParseResult;
  /** SMAT skeletonRefs[i].attachmentTransformName. "" = main segment (no reparent). */
  attachmentTransformName: string;
}

export interface MergedSkeleton {
  /** One concatenated skeleton (attach-order). bones[0] is the main segment's root. */
  parseResult: SkeletonParseResult;
  /** Bone names in merged index order — the boneOrder for parseSkeletalMesh remap. */
  boneOrder: string[];
  /** Non-fatal diagnostics (attach-not-found, name collisions). */
  warnings: string[];
}

/**
 * Merge skeleton segments in attach order. The FIRST segment is the main skeleton
 * (attachmentTransformName === ""), so put it first so bones[0] is the main root.
 */
export function mergeSkeletons(segments: SkeletonSegment[]): MergedSkeleton {
  const bones: BoneNode[] = [];
  const boneOrder: string[] = [];
  const warnings: string[] = [];

  // Case-insensitive name → FIRST merged index (matches SWG's combined map: first-wins).
  const nameToIndex = new Map<string, number>();

  for (const seg of segments) {
    const base = bones.length; // running offset for THIS segment
    const segBones = seg.parseResult.bones;

    // Resolve the reparent target ONCE against already-merged bones (case-insensitive).
    let attachParentIndex = -1;
    const attach = seg.attachmentTransformName;
    if (attach && attach.length > 0) {
      const found = nameToIndex.get(attach.toLowerCase());
      if (found !== undefined) {
        attachParentIndex = found;
      } else {
        warnings.push(`attach transform "${attach}" not found; segment root left as a free root`);
        attachParentIndex = -1;
      }
    }

    for (let i = 0; i < segBones.length; i++) {
      const src = segBones[i]!;
      const isSegmentRoot = src.parentIndex < 0;

      // A2: attached segment root reparents to the named transform; main root stays -1.
      const parentIndex = isSegmentRoot ? attachParentIndex : src.parentIndex + base;

      const lname = src.name.toLowerCase();
      if (nameToIndex.has(lname)) {
        // Keep the bone (index-based refs still resolve) but first occurrence owns the
        // name→index map, matching SWG's single combined transform map (first-wins).
        warnings.push(`bone-name collision "${src.name}"; first occurrence keeps the name binding`);
      } else {
        nameToIndex.set(lname, base + i);
      }

      bones.push({
        name: src.name,
        parentIndex,
        bindTranslation: src.bindTranslation,
        preMultiplyRotation: src.preMultiplyRotation,
        postMultiplyRotation: src.postMultiplyRotation,
        bindPoseRotation: src.bindPoseRotation,
      });
      boneOrder.push(src.name);
    }
  }

  return {
    parseResult: {
      version: segments[0]?.parseResult.version ?? '0002',
      bones,
      roundTrip: { passed: true },
    },
    boneOrder,
    warnings,
  };
}
