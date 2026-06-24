/**
 * packages/contracts/src/animation.ts — Animation (.ans) format contract types.
 *
 * The animation parse result crosses the N-API boundary as typed JSON (joint info,
 * variant, fps, frameCount) plus binary ArrayBuffers for raw keyframe streams.
 *
 * Binary ArrayBuffer path / no JSON for keyframe data (AGENTS.md binary-stays-binary rule).
 *
 * Keys are SPARSE (frame-indexed), NOT one record per frame. Interpolation requires
 * binary-searching the per-channel key lists for the two bracketing frames.
 *
 * Animation variants:
 *   KFAT-0003 — uncompressed quaternion (4×float32 per key, disk order w,x,y,z)
 *   CKAT-0001 — compressed quaternion (1×uint32 per key with 3 uint8 format bytes per channel)
 *   KFAT-0002 — legacy Euler (unsupported v1; return variant discriminator + warning)
 *
 * Ground truth:
 *   swg-client-v2 KeyframeSkeletalAnimationTemplate.cpp:1518-1620 (KFAT load_0003)
 *   swg-client-v2 CompressedKeyframeAnimationTemplate.cpp:1198-1313 (CKAT load_0001)
 *   swg-client-v2 CompressedQuaternion.cpp:82-122,156-228,370-419 (CKAT decoder)
 *   Synthesis CONSULT-P2-SYNTHESIS.md §1.6 (verified 2026-06-23, post-REVIEWS correction)
 *
 * Quaternion order on disk: (w,x,y,z) per Iff::read_floatQuaternion.
 * CKAT w is derived: w = sqrt(max(0, 1 − x²−y²−z²))  ← clamp adopted (synthesis §5).
 *
 * Source (pattern): packages/contracts/src/iff.ts
 */

/**
 * Discriminator for the animation encoding variant.
 * Consumers check this before accessing keyframe data.
 *
 * Source: root FORM tag + inner version FORM:
 *   FORM KFAT → FORM 0003 → KFAT-0003
 *   FORM CKAT → FORM 0001 → CKAT-0001
 *   FORM KFAT → FORM 0002 → KFAT-0002-unsupported (legacy Euler; no keyframe decode)
 */
export type AnimationVariant = 'KFAT-0003' | 'CKAT-0001' | 'KFAT-0002-unsupported';

/**
 * Per-joint channel descriptor from the XFIN records in the XFRM form.
 *
 * Field widths differ between KFAT (int32) and CKAT (int16) — the int/int16 widths
 * are on-disk differences; the contract types are all number here for simplicity.
 *
 * Source: swg-client-v2 KeyframeSkeletalAnimationTemplate.cpp:523-553 (KFAT XFIN)
 *         swg-client-v2 CompressedKeyframeAnimationTemplate.cpp:553-594 (CKAT XFIN)
 */
export interface AnimationJoint {
  /**
   * Joint name (from XFIN string). Used for name-keyed binding to Skeleton bones.
   * Source: XFIN string field.
   */
  name: string;
  /**
   * Whether this joint has animated (per-key) rotation data.
   * If false, uses a static rotation from SROT.
   * Source: XFIN int8 hasAnimatedRotations field.
   */
  hasAnimatedRotation: boolean;
  /**
   * Index into the rotation channel array (AROT form, QCHN chunks).
   * Meaningful only when hasAnimatedRotation === true.
   * For CKAT: int16; for KFAT: int32.
   * Source: XFIN rotationChannelIndex field.
   */
  rotationChannelIndex: number;
  /**
   * Bitmask: bit 0 = has X translation, bit 1 = Y, bit 2 = Z.
   * Each set bit indicates a separate CHNL/translation channel is animated for that axis.
   * For CKAT: uint8; for KFAT: uint32.
   * Source: XFIN translationMask field.
   */
  translationMask: number;
  /**
   * Per-axis translation channel indices: [xChannelIdx, yChannelIdx, zChannelIdx].
   * Index into ATRN form's CHNL chunks. -1 for a static or absent axis.
   * For CKAT: int16; for KFAT: int32.
   * Source: XFIN {x,y,z}TranslationChannelIndex fields.
   */
  translationChannelIndex: [number, number, number];
}

/**
 * Full result of parsing a .ans (FORM KFAT | FORM CKAT) animation file.
 *
 * The AnimationJoint array carries the XFIN sparse-channel descriptor for every joint.
 * Keyframe binary data crosses as ArrayBuffer (not included in this typed result).
 *
 * Source: swg-client-v2 KeyframeSkeletalAnimationTemplate.cpp:1518-1620 (KFAT)
 *         swg-client-v2 CompressedKeyframeAnimationTemplate.cpp:1198-1313 (CKAT)
 */
export interface AnimationParseResult {
  /**
   * Animation encoding variant.
   * Consumers must check this before accessing keyframe data.
   */
  variant: AnimationVariant;
  /**
   * Playback rate in frames per second.
   * Source: INFO chunk float32 fps field.
   */
  fps: number;
  /**
   * Total frame count (integer).
   * For KFAT: int32; for CKAT: int16 — both stored as number here.
   * Source: INFO chunk frameCount field.
   */
  frameCount: number;
  /**
   * Per-joint sparse-channel descriptors from the XFIN records in the XFRM form.
   * One entry per joint (transformInfoCount in INFO).
   */
  joints: AnimationJoint[];
  /** IFF-level round-trip status (from the generic-IFF parse layer). */
  roundTrip: { passed: boolean; failOffset?: number };
}
