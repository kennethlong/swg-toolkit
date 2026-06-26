/**
 * packages/renderer/src/panels/viewport/export/buildAnimationClip.ts
 *
 * buildAnimationClip — build a THREE.AnimationClip from SWG sparse keyframe data.
 *
 * THE CRITICAL RULE: COMPOSE-THEN-MIRROR (L5 axiom, rank-1 risk guard)
 * ──────────────────────────────────────────────────────────────────────
 * SWG keyframe quats are NOT the bone's final local rotation. Per Skeleton.cpp:1273-1279:
 *
 *   localRot(f) = postMul · (keyQuat(f) · bindPoseRot · preMul)
 *   localPos(f) = bindTranslation + animDelta(f)
 *
 * We must evaluate localRot(f) at each sparse key frame f and THEN apply the X-mirror
 * (flip · M · flip, which maps THREE quat (x,y,z,w) → (x,-y,-z,w)).
 *
 * Raw-key mirroring (mirrorQuat(keyQuat) then compose) is PROVABLY WRONG — it commutes
 * the mirror past the non-commutative composition, giving a different rotation for any
 * joint where pre/bind/post are non-identity (i.e. almost every joint in practice).
 *
 * ALGORITHM
 * ─────────
 * For each joint (joint.name → mapped to bone in parsedSkeleton):
 *   Rotation (hasAnimatedRotation = true):
 *     At each sparse key frame f in the rotation channel:
 *       1. Load raw keyframe quat (w,x,y,z) from keyframes buffer.
 *       2. Reorder to THREE.Quaternion (x,y,z,w).
 *       3. Compose: result = postMul · (rawKey · bindPoseRot · preMul)
 *       4. Mirror:  mirrorQuat(result) = (result.x, -result.y, -result.z, result.w)
 *       5. Store as (x,y,z,w) in QuaternionKeyframeTrack values.
 *
 *   Translation (translationMask ≠ 0):
 *     Collect union of all sparse frame indices across x/y/z animated axes.
 *     At each merged frame f, for each axis:
 *       - animated axis → lerp between adjacent channel keys at f
 *       - static axis   → staticTranslations[chIdx]
 *     localPos = bindTranslation + delta
 *     Mirror: x → -x
 *     Store as (-localX, localY, localZ) in VectorKeyframeTrack values.
 *
 * ASSERTION GUARD (rank-1 risk)
 * ──────────────────────────────
 * For the first joint with a non-identity bindPoseRot (|y|+|z| > 0.01),
 * assert that the composed quat differs from the raw key. Logs a console.error
 * if they are equal — indicating that composition was accidentally skipped.
 *
 * Source: swg-client-v2 Skeleton.cpp:1273-1279, CompressedKeyframeAnimation.cpp.
 *         SkinnedMeshView.tsx (useAnimationSampler — same composition + sampler).
 *         CONSULT-P2-05-AXIOMS.md L5 + Opus angle-4 derivation.
 */

import * as THREE from 'three';
import type { ViewportStore } from '../../../state/viewportStore.js';
import type { SkeletonParseResult } from '@swg/contracts';

// ─── Re-export for test access ────────────────────────────────────────────────
// (The test in harness reimplements these formulas independently; exporting here
//  allows future in-renderer integration tests without code duplication.)

/** Compose SWG joint local rotation per Skeleton.cpp:1273-1279. */
export function composeBoneQuat(
  keyQuat:      THREE.Quaternion,
  bindPoseRot:  THREE.Quaternion,
  preMul:       THREE.Quaternion,
  postMul:      THREE.Quaternion,
): THREE.Quaternion {
  // result = postMul · (keyQuat · bindPoseRot · preMul)
  const result = keyQuat.clone().multiply(bindPoseRot).multiply(preMul);
  result.premultiply(postMul);
  return result.normalize();
}

/** Mirror a THREE.Quaternion (x,y,z,w) by the X-reflection plane.
 *
 *  Derivation: SWG on-disk quat (w,x,y,z) → mirror → (w,x,-y,-z)
 *  → reorder to THREE (x,y,z,w): (x,-y,-z,w).
 *  Equivalently: conjugate by flip = diag(-1,1,1) flips y and z in THREE format.
 */
export function mirrorQuat(q: THREE.Quaternion): THREE.Quaternion {
  return new THREE.Quaternion(q.x, -q.y, -q.z, q.w);
}

// ─── Constants ────────────────────────────────────────────────────────────────

// SATCCF translation animate bits (KeyframeSkeletalAnimationTemplateDef.h)
const SATCCF_X_TRANS = 0x08; // bit 3; y = bit 4, z = bit 5

// ─── Channel data (same layout as PrebuiltAnimData in SkinnedMeshView) ────────

interface RotationChannelData {
  frames: Int32Array;
  quats:  Float32Array; // (w,x,y,z) × keyCount
}

interface TranslationChannelData {
  frames:  Int32Array;
  values:  Float32Array;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Reorder on-disk (w,x,y,z) → THREE.Quaternion (x,y,z,w). */
function quatFromDisk(w: number, x: number, y: number, z: number): THREE.Quaternion {
  return new THREE.Quaternion(x, y, z, w);
}

/**
 * Binary-search the frames array for the largest index ≤ queryFrame.
 * Same algorithm as SkinnedMeshView.tsx binarySearchBracket.
 */
function binarySearchBracket(frames: Int32Array, keyCount: number, queryFrame: number): number {
  if (keyCount === 0) return 0;
  if (queryFrame <= frames[0]!) return 0;
  if (queryFrame >= frames[keyCount - 1]!) return keyCount - 1;
  let lo = 0;
  let hi = keyCount - 1;
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1;
    if (frames[mid]! <= queryFrame) lo = mid;
    else hi = mid;
  }
  return lo;
}

/**
 * Sample a single-axis translation channel at frame f.
 * Returns the delta to add to bindTranslation for that axis.
 */
function sampleTranslationAxis(
  f:                  number,
  isAnimated:         boolean,
  ch:                 TranslationChannelData | undefined,
  chIdx:              number,
  staticTranslations: Float32Array,
): number {
  if (isAnimated && ch && ch.frames.length > 0) {
    const kc = ch.frames.length;
    const k0 = binarySearchBracket(ch.frames, kc, f);
    const k1 = Math.min(k0 + 1, kc - 1);
    const fA = ch.frames[k0]!;
    const fB = ch.frames[k1]!;
    const frac = fA === fB ? 0 : (f - fA) / (fB - fA);
    return ch.values[k0]! + (ch.values[k1]! - ch.values[k0]!) * frac;
  }
  if (chIdx >= 0 && chIdx < staticTranslations.length) {
    return staticTranslations[chIdx]!;
  }
  return 0;
}

// ─── Pre-build channel data ──────────────────────────────────────────────────

type ParsedAnimation = NonNullable<ViewportStore['parsedAnimation']>;

interface BuiltChannels {
  rotChannels:        RotationChannelData[];
  staticRotations:    Float32Array;
  transChannels:      TranslationChannelData[];
  staticTranslations: Float32Array;
}

function buildChannels(anim: ParsedAnimation): BuiltChannels {
  const ct   = anim.channelTable;
  const kfDv = new DataView(anim.keyframes);

  const rotChannels: RotationChannelData[] = ct.rotationChannels.map(ch => {
    const base     = ch.byteOffset;
    const keyCount = kfDv.getInt32(base, true);
    const safeKc   = Math.min(keyCount, ch.keyCount);
    const frames   = new Int32Array(safeKc);
    const quats    = new Float32Array(safeKc * 4); // (w,x,y,z)
    const framesBase = base + 4;
    const quatsBase  = base + 4 + safeKc * 4;
    for (let k = 0; k < safeKc; k++) {
      frames[k] = kfDv.getInt32(framesBase + k * 4, true);
    }
    for (let k = 0; k < safeKc; k++) {
      const qBase       = quatsBase + k * 16;
      quats[k * 4 + 0] = kfDv.getFloat32(qBase + 0,  true); // w
      quats[k * 4 + 1] = kfDv.getFloat32(qBase + 4,  true); // x
      quats[k * 4 + 2] = kfDv.getFloat32(qBase + 8,  true); // y
      quats[k * 4 + 3] = kfDv.getFloat32(qBase + 12, true); // z
    }
    return { frames, quats };
  });

  const staticRotCount   = ct.staticRotationCount;
  const staticRotations  = new Float32Array(staticRotCount * 4);
  for (let i = 0; i < staticRotCount; i++) {
    const base             = ct.staticRotByteOffset + i * 16;
    staticRotations[i * 4 + 0] = kfDv.getFloat32(base + 0,  true); // w
    staticRotations[i * 4 + 1] = kfDv.getFloat32(base + 4,  true); // x
    staticRotations[i * 4 + 2] = kfDv.getFloat32(base + 8,  true); // y
    staticRotations[i * 4 + 3] = kfDv.getFloat32(base + 12, true); // z
  }

  const transChannels: TranslationChannelData[] = ct.translationChannels.map(ch => {
    const base     = ch.byteOffset;
    const keyCount = kfDv.getInt32(base, true);
    const safeKc   = Math.min(keyCount, ch.keyCount);
    const frames   = new Int32Array(safeKc);
    const values   = new Float32Array(safeKc);
    const framesBase = base + 4;
    const valuesBase = base + 4 + safeKc * 4;
    for (let k = 0; k < safeKc; k++) {
      frames[k] = kfDv.getInt32(framesBase + k * 4, true);
      values[k] = kfDv.getFloat32(valuesBase + k * 4, true);
    }
    return { frames, values };
  });

  const staticTransCount    = ct.staticTranslationCount;
  const staticTranslations  = new Float32Array(staticTransCount);
  for (let i = 0; i < staticTransCount; i++) {
    staticTranslations[i] = kfDv.getFloat32(ct.staticTransByteOffset + i * 4, true);
  }

  return { rotChannels, staticRotations, transChannels, staticTranslations };
}

// ─── Assertion guard ─────────────────────────────────────────────────────────

let _assertionFired = false; // fire once per session

/** Guard against "raw-key passthrough" — the rank-1 composition error. */
function assertComposeHappens(
  composed:    THREE.Quaternion,
  rawKey:      THREE.Quaternion,
  bindPoseRot: THREE.Quaternion,
  boneName:    string,
): void {
  if (_assertionFired) return;

  // Only assert for joints where bindPoseRot is non-identity (otherwise composed == rawKey is expected)
  const bpHasRotation = Math.abs(bindPoseRot.y) + Math.abs(bindPoseRot.z) > 0.01;
  if (!bpHasRotation) return;

  _assertionFired = true;

  const dx = Math.abs(composed.x - rawKey.x);
  const dy = Math.abs(composed.y - rawKey.y);
  const dz = Math.abs(composed.z - rawKey.z);
  const dw = Math.abs(composed.w - rawKey.w);

  if (dx + dy + dz + dw < 0.001) {
    console.error(
      `[buildAnimationClip] RANK-1 ASSERTION: joint "${boneName}" composed quat ≈ raw key quat.`,
      'This means composition was skipped. L5 violation — check postMul·(key·bindRot·preMul).',
      { composed: { x: composed.x, y: composed.y, z: composed.z, w: composed.w },
        rawKey:   { x: rawKey.x,   y: rawKey.y,   z: rawKey.z,   w: rawKey.w } },
    );
  } else {
    console.debug(
      `[buildAnimationClip] Composition assertion PASSED for joint "${boneName}":`,
      'composed differs from raw key (L5 satisfied).',
    );
  }
}

// ─── Main builder ─────────────────────────────────────────────────────────────

/**
 * Build a THREE.AnimationClip from a SWG parsed animation.
 *
 * @param anim            Parsed animation (CKAT-0001 or KFAT-0003) with keyframes + channelTable.
 * @param parsedSkeleton  Skeleton parsed result (for bindPoseRotation, preMul, postMul, bindTrans).
 * @returns THREE.AnimationClip ready for GLTFExporter — or null if no tracks could be built.
 */
export function buildAnimationClip(
  anim:            ParsedAnimation,
  parsedSkeleton:  SkeletonParseResult,
): THREE.AnimationClip | null {
  _assertionFired = false; // reset per export

  const fps = anim.fps > 0 ? anim.fps : 30;
  const { rotChannels, staticRotations, transChannels, staticTranslations } = buildChannels(anim);

  // Build name→bone index from parsedSkeleton for composition data lookup
  const boneNameToIdx = new Map<string, number>();
  for (let i = 0; i < parsedSkeleton.bones.length; i++) {
    boneNameToIdx.set(parsedSkeleton.bones[i]!.name.toLowerCase(), i);
  }

  const tracks: THREE.KeyframeTrack[] = [];

  for (const joint of anim.joints) {
    const boneName = joint.name;

    // Lookup bone in parsedSkeleton (case-insensitive, matching SkinnedMeshView)
    const boneIdx = boneNameToIdx.get(boneName.toLowerCase());
    if (boneIdx == null) continue;

    const boneData = parsedSkeleton.bones[boneIdx];
    if (!boneData) continue;

    // Track path MUST use the actual skeleton bone name (camelCase, e.g. "lThigh"), NOT the
    // .ans joint.name (often lowercase, e.g. "lthigh"). THREE.Bone.name is set from the skeleton
    // bone name in SkinnedMeshView, and GLTFExporter binds tracks by EXACT node name
    // (PropertyBinding.findNode). Using joint.name dropped 34/39 limb tracks → stiff legs (02-04 lesson).
    const trackName = boneData.name;

    // Per-joint composition data (from parsedSkeleton RPRE/RPST/BPRO/BPTR)
    // Reorder from on-disk (w,x,y,z) to THREE.Quaternion (x,y,z,w).
    const preMul      = quatFromDisk(
      boneData.preMultiplyRotation[0]!, boneData.preMultiplyRotation[1]!,
      boneData.preMultiplyRotation[2]!, boneData.preMultiplyRotation[3]!,
    );
    const postMul     = quatFromDisk(
      boneData.postMultiplyRotation[0]!, boneData.postMultiplyRotation[1]!,
      boneData.postMultiplyRotation[2]!, boneData.postMultiplyRotation[3]!,
    );
    const bindPoseRot = quatFromDisk(
      boneData.bindPoseRotation[0]!, boneData.bindPoseRotation[1]!,
      boneData.bindPoseRotation[2]!, boneData.bindPoseRotation[3]!,
    );
    const bindTrans = new THREE.Vector3(
      boneData.bindTranslation[0]!, boneData.bindTranslation[1]!, boneData.bindTranslation[2]!,
    );

    // ── Rotation track ─────────────────────────────────────────────────────
    let rotTrackAdded = false;

    if (joint.hasAnimatedRotation && joint.rotationChannelIndex >= 0) {
      const ch = rotChannels[joint.rotationChannelIndex];
      if (ch && ch.frames.length > 0) {
        const kc     = ch.frames.length;
        const times  = new Float32Array(kc);
        const values = new Float32Array(kc * 4); // x, y, z, w per key

        for (let k = 0; k < kc; k++) {
          const frame = ch.frames[k]!;
          const w = ch.quats[k * 4 + 0]!;
          const x = ch.quats[k * 4 + 1]!;
          const y = ch.quats[k * 4 + 2]!;
          const z = ch.quats[k * 4 + 3]!;

          // 1. Raw keyframe quat in THREE format (x,y,z,w)
          const rawKey = quatFromDisk(w, x, y, z);

          // 2. Compose: postMul · (rawKey · bindPoseRot · preMul)  [L5]
          const composed = composeBoneQuat(rawKey, bindPoseRot, preMul, postMul);

          // 3. Rank-1 assertion: check composition actually happened
          if (k === 0) assertComposeHappens(composed, rawKey, bindPoseRot, boneName);

          // 4. Mirror: (x, -y, -z, w)  [flip.M.flip → THREE quat y,z negate]
          const mirrored = mirrorQuat(composed);

          times[k]         = frame / fps;
          values[k * 4 + 0] = mirrored.x;
          values[k * 4 + 1] = mirrored.y;
          values[k * 4 + 2] = mirrored.z;
          values[k * 4 + 3] = mirrored.w;
        }

        tracks.push(new THREE.QuaternionKeyframeTrack(
          `${trackName}.quaternion`,
          Array.from(times),
          Array.from(values),
        ));
        rotTrackAdded = true;
      }
    }

    if (!rotTrackAdded && joint.rotationChannelIndex >= 0 && !joint.hasAnimatedRotation) {
      // Static rotation — emit a single-frame track at t=0 (rest pose, already set on bone)
      const sidx = joint.rotationChannelIndex;
      if (sidx * 4 + 3 < staticRotations.length) {
        const w = staticRotations[sidx * 4 + 0]!;
        const x = staticRotations[sidx * 4 + 1]!;
        const y = staticRotations[sidx * 4 + 2]!;
        const z = staticRotations[sidx * 4 + 3]!;
        const rawKey  = quatFromDisk(w, x, y, z);
        const composed = composeBoneQuat(rawKey, bindPoseRot, preMul, postMul);
        const mirrored = mirrorQuat(composed);
        tracks.push(new THREE.QuaternionKeyframeTrack(
          `${trackName}.quaternion`,
          [0],
          [mirrored.x, mirrored.y, mirrored.z, mirrored.w],
        ));
      }
    }

    // ── Translation track ──────────────────────────────────────────────────
    if (joint.translationMask !== 0) {
      // Collect union of all animated frame indices across x/y/z axes
      const allFrames = new Set<number>();

      for (let ax = 0; ax < 3; ax++) {
        const chIdx     = joint.translationChannelIndex[ax];
        if (chIdx == null || chIdx < 0) continue;
        const isAnimated = (joint.translationMask & (SATCCF_X_TRANS << ax)) !== 0;
        if (!isAnimated) continue;
        const ch = transChannels[chIdx];
        if (!ch) continue;
        for (let k = 0; k < ch.frames.length; k++) {
          allFrames.add(ch.frames[k]!);
        }
      }

      if (allFrames.size > 0) {
        const sortedFrames = Array.from(allFrames).sort((a, b) => a - b);
        const times:  number[] = [];
        const values: number[] = [];

        for (const f of sortedFrames) {
          // Per-axis: sample animated or read static
          const deltas = [0, 0, 0];
          for (let ax = 0; ax < 3; ax++) {
            const chIdx     = joint.translationChannelIndex[ax];
            if (chIdx == null || chIdx < 0) continue;
            const isAnimated = (joint.translationMask & (SATCCF_X_TRANS << ax)) !== 0;
            deltas[ax] = sampleTranslationAxis(
              f,
              isAnimated,
              isAnimated ? transChannels[chIdx] : undefined,
              chIdx,
              staticTranslations,
            );
          }

          // localPos = bindTrans + delta; then mirror x → -x
          const localX = bindTrans.x + (deltas[0] ?? 0);
          const localY = bindTrans.y + (deltas[1] ?? 0);
          const localZ = bindTrans.z + (deltas[2] ?? 0);

          times.push(f / fps);
          values.push(-localX, localY, localZ); // X mirrored
        }

        tracks.push(new THREE.VectorKeyframeTrack(
          `${trackName}.position`,
          times,
          values,
        ));
      }
    }
  }

  if (tracks.length === 0) {
    console.warn('[buildAnimationClip] No keyframe tracks built — animation has no animated joints.');
    return null;
  }

  const duration = (anim.frameCount > 0 ? anim.frameCount - 1 : 0) / fps;
  return new THREE.AnimationClip('SWGAnim', duration, tracks);
}
