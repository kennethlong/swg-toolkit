/**
 * packages/contracts/src/skeleton.ts — Skeleton (.skt) format contract types.
 *
 * The skeleton parse result crosses the N-API boundary as typed JSON only.
 * (No binary payload — skeleton data is small structured metadata, not geometry.)
 *
 * Ground truth:
 *   swg-client-v2 BasicSkeletonTemplate.cpp:151-389
 *   Chunks: INFO NAME PRNT RPRE RPST BPTR BPRO [BPMJ] JROR
 *   FORM SKTM → FORM 000{1,2}
 *
 * Quaternion order: on-disk is (w,x,y,z) per Iff::read_floatQuaternion;
 * the intermediate representation preserved here is (w,x,y,z) to match disk.
 * Consumers must document any reorder before passing to Three.js (which uses (x,y,z,w)).
 *
 * SKTM is overloaded — it is the root FORM of a .skt file AND an inner chunk of a .mgn
 * listing the skeleton templates it requires. This type represents the .skt root FORM.
 * (Synthesis delta #7 — do NOT conflate the two uses.)
 *
 * Source (pattern): packages/contracts/src/iff.ts
 */

/**
 * One bone node from a parsed SKTM skeleton.
 *
 * parentIndex === -1 for the root bone (no parent).
 * Bind pose (rest pose) is the transformation applied before any animation.
 *
 * Source: swg-client-v2 BasicSkeletonTemplate.cpp:151-389
 *   PRNT → parentIndex (int16), BPTR → bindTranslation (3×float32), BPRO → bindRotation (4×float32)
 *   Quaternion order on disk: (w,x,y,z) per read_floatQuaternion.
 */
export interface BoneNode {
  /** Bone name from the NAME chunk. Used for name-keyed binding. */
  name: string;
  /**
   * Index of the parent bone in the bones array. -1 for the root bone.
   * Source: PRNT chunk — int16 per bone.
   */
  parentIndex: number;
  /**
   * Bind-pose (rest-pose) translation: [x, y, z] in engine space.
   * Source: BPTR chunk — 3×float32. Engine space: left-handed Y-up (meters).
   */
  bindTranslation: [number, number, number];
  /**
   * preMultiply rotation quaternion [w, x, y, z]. Source: RPRE chunk — 4×float32.
   * Part of the SWG joint composition (see preMultiply in BasicSkeletonTemplate).
   */
  preMultiplyRotation: [number, number, number, number];
  /**
   * postMultiply rotation quaternion [w, x, y, z]. Source: RPST chunk — 4×float32.
   */
  postMultiplyRotation: [number, number, number, number];
  /**
   * Bind-pose rotation quaternion [w, x, y, z]. Source: BPRO chunk — 4×float32.
   * On-disk order is (w,x,y,z); consumers reorder to (x,y,z,w) for Three.js.
   *
   * The full SWG joint local rotation is:
   *   localRotation = postMultiply · (animResolverRot · bindPoseRotation) · preMultiply
   * (Skeleton.cpp:1273-1285). At rest (animResolverRot = identity) it is
   *   postMultiply · bindPoseRotation · preMultiply.
   */
  bindPoseRotation: [number, number, number, number];
}

/**
 * Full result of parsing a .skt (FORM SKTM) file.
 *
 * Source: swg-client-v2 BasicSkeletonTemplate.cpp:151-389 (load_0001/load_0002)
 */
export interface SkeletonParseResult {
  /**
   * Version string from the inner FORM (e.g. '0001' or '0002').
   * Source: FORM 000x subType in the IFF container.
   */
  version: string;
  /** All bone nodes in the skeleton, in the order they appear in the SKTM data. */
  bones: BoneNode[];
  /** IFF-level round-trip status (from the generic-IFF parse layer). */
  roundTrip: { passed: boolean; failOffset?: number };
}
