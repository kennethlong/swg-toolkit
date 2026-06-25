# Cursor task — byte layout + quaternion convention verification (swg-client-v2)

Read the LOCKED axioms first: `.planning/research/CONSULT-SKEL-AXIOMS.md`. Do not contradict them.

Ground truth repo: `D:\Code\swg-client-v2`. Read real source; cite file:line.

## Your angle: pin the exact byte layout AND the exact rotation-composition semantics.

1. **BPRO width + float order.** Confirm `read_floatQuaternion` reads 4×float32 per element and the
   in-memory component order it produces (w,x,y,z vs x,y,z,w). Find its definition (Iff.cpp /
   read_floatQuaternion) and `Quaternion`'s constructor/member order. State definitively: for BPRO and
   the animation SROT/keyframe quaternions, which 4 floats map to which quaternion components.
2. **Quaternion multiply convention.** Read `Quaternion::operator*` (and `multiply`) in
   `swg-client-v2` (sharedMath / Quaternion.cpp). Is it Hamilton product? For `a * b`, when applied to a
   vector, is the effect "apply b first, then a" or the reverse? Is it right- or left-handed? Does the
   engine rotate vectors as `v' = q * v * q^-1`?
3. **Quaternion → matrix.** Read `Quaternion::getTransform` / `getTransformPreserveTranslation` and
   `Transform::setPosition_p`. Is the resulting `Transform` row-major or column-major, and does it
   transform points as `p' = M * p` or `p' = p * M`? (i.e., is SWG's Transform a row-vector or
   column-vector convention?)
4. **Net composition order.** Given axiom A3
   `localToParentRotation = postMul * (animatedRotation * preMul)` with
   `animatedRotation = animResolverRot * bindPoseRot`, expand the full ordered product of the four
   quaternions and state, in plain "apply X then Y then Z" terms, the order rotations are applied to a
   point. This is the single most important output: the unambiguous applied-order.

## Deliverable
For each of the 4 items: the file:line evidence + a one-line definitive statement. End with the
fully-expanded four-quaternion product and its applied-order in words. No code.
