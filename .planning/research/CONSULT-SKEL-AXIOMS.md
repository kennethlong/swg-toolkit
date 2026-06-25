# LOCKED AXIOMS — SWG skeletal bind-pose ↔ animation composition

These are measured ground truth from `../swg-client-v2`. **Treat as given. Do NOT re-derive,
contradict, or "simplify" them.** Numbered so you can cite them.

- **A1.** `.skt` = `FORM SKTM → FORM 0001|0002`, chunks in order:
  `INFO, NAME, PRNT, RPRE, RPST, BPTR, BPRO, [BPMJ (v0001 only)], JROR`.
- **A2.** `BasicSkeletonTemplate.cpp:246-277` reads, **per joint**:
  - `RPRE` → `m_preMultiplyRotations` via `read_floatQuaternion` → **4×float32 (w,x,y,z)**
  - `RPST` → `m_postMultiplyRotations` via `read_floatQuaternion` → **4×float32 (w,x,y,z)**
  - `BPTR` → `m_bindPoseTranslations`  via `read_floatVector`     → **3×float32 (x,y,z)**
  - `BPRO` → `m_bindPoseRotations`     via `read_floatQuaternion` → **4×float32 (w,x,y,z)**  ← a QUATERNION, not a vec3
- **A3.** Per-joint local (jointToParent) transform — `Skeleton.cpp:1273-1285`, verbatim:
  ```
  animatedRotation         = animationResolverRotation * bindPoseRotations[j];
  localToParentRotation    = postMultiplyRotations[j] * (animatedRotation * preMultiplyRotations[j]);
  localToParentTranslation = bindPoseTranslations[j] + animationResolverTranslation;
  // then: localToParentRotation.getTransformPreserveTranslation(&t); t.setPosition_p(localToParentTranslation);
  ```
- **A4.** `animationResolverRotation/Translation` is the per-joint animation output:
  - joint absent from the .ans → identity rotation / zero translation (`CompressedKeyframeAnimation.cpp:1069-1073`)
  - animated joint → keyframe quaternion (slerp of bracketing keys)
  - static joint → `staticRotations[rotationChannelIndex]` (`CompressedKeyframeAnimation.cpp:1091`)
  - translation per axis: animated→channel, else `staticTranslations[translationChannelIndex[ax]]`;
    SATCCF translation flag bits are 3/4/5 (`SATCCF_xTranslation=0x08`).
- **A5.** All disk quaternions are **(w,x,y,z)** order (`Iff::read_floatQuaternion`).
- **A6.** Target engine: **THREE.js r0.184**. `THREE.Quaternion` is stored **(x,y,z,w)**, right-handed,
  `q*v*q⁻¹`. `bone.quaternion` is the joint's **local** (to-parent) rotation; `bone.position` its local translation.

## FALSIFIED / BANNED framing
The current SWG-Toolkit renderer sets `bone.quaternion = (the animation quaternion)` directly and
`bone.quaternion = preRot` for the rest pose. **This is FALSE** per A3 — the local rotation is the
**four-quaternion composition** `postMul · (animResolverRot · bindPoseRot) · preMul`. Do NOT propose or
re-derive "the bone local rotation equals the animation quaternion." Do NOT assume bind pose = RPRE alone.

## Current SWG-Toolkit state (facts, not to defend)
- `packages/native-core/modules/core/formats/Skeleton.cpp:193-197` reads **BPRO as 3 floats** into a
  field `preRotOff` (BUG vs A2 — should be a 4-float quaternion). RPRE/RPST are read as 4-float quats
  into `preRot`/`postRot`. BPTR→`bindPos` (3 floats).
- `packages/renderer/.../resolver/appearanceResolver.ts:264-273` maps only `bindRotation=preRot`,
  `bindTranslation=bindPos`; it discards postRot and the (mis-read) BPRO.
- `packages/renderer/.../viewport/SkinnedMeshView.tsx` `buildSkeleton()` sets `bone.quaternion=bindRotation`
  (=RPRE) and `bone.position=bindTranslation`; the sampler overwrites `bone.quaternion` with the raw
  animation quaternion. No pre/post/bindPoseRot composition anywhere.

## Observed symptoms (to explain, not assume)
Single skinned subject `protocol_droid_red.sat` (39-bone skeleton). Animation plays; torso rotates and
looks roughly right; **legs stay stiff and swing rigidly with the pelvis**; after adding static-rotation
support, **the head disappeared** (off-screen / collapsed).
