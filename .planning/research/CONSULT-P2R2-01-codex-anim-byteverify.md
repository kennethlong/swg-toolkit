# Verification task — confirm/refute Plan 02-04 animation byte layout against real loader source

You are independently verifying a plan against ground-truth C++ loader source. **Do not trust the plan;
open the real source files and check byte-for-byte.** Report every discrepancy. If a claim matches, say
so with the confirming line range. If it does not, give the corrected layout with line cites.

## The plan's claims to check (Plan 02-04, file `.planning/phases/02-3d-mesh-viewport-mvp-proof/02-04-PLAN.md`)

Read that plan's Task 1 byte tables + the `must_haves` block. The plan asserts:

1. **CKAT-0001 INFO** = `float32 fps` then **6×int16**: `frameCount, transformInfoCount, rotationChannelCount, staticRotationCount, translationChannelCount, staticTranslationCount` (frameCount FIRST).
2. **KFAT-0003 INFO** = `float32 fps` then **6×int32**, same field names/order.
3. **CKAT-0001 XFIN** = `string name; int8 hasAnimatedRotations; int16 rotationChannelIndex; uint8 translationMask; int16 ×3 translation channel indices`.
4. **KFAT-0003 XFIN** = `string name; int8 hasAnimatedRotations; int32 rotationChannelIndex; uint32 translationMask; int32 ×3`.
5. **CKAT-0001 QCHN** = `int16 keyCount; uint8 xFormat,yFormat,zFormat ONCE PER CHANNEL (not per key); then per key int16 frame + uint32 compressedRotation`.
6. **KFAT-0003 QCHN** = sparse: `int32 keyCount; per key int32 frame + read_floatQuaternion() (4×float32)`.
7. **SROT** differs: CKAT = `uint8 x,y,z fmt + uint32 packed`; KFAT = raw `floatQuaternion` (4×float32).
8. **On-disk quaternion order is (w,x,y,z)**; reorder to Three.js (x,y,z,w) once.
9. The plan mandates the compressed-quaternion decode be a **VERBATIM PORT** of `CompressedQuaternion::install()` + `doExpand()` (255-entry `s_formatData` table built from `formatId | baseIndex`), and adopts `w = sqrt(max(0, 1-(x²+y²+z²)))`.

## Ground-truth source (open these — absolute paths)

- `D:/Code/swg-client-v2/src/engine/client/library/clientSkeletalAnimation/src/shared/animation/CompressedKeyframeAnimationTemplate.cpp`
- `D:/Code/swg-client-v2/src/engine/client/library/clientSkeletalAnimation/src/shared/animation/KeyframeSkeletalAnimationTemplate.cpp`
- `D:/Code/swg-client-v2/src/engine/shared/library/sharedMath/src/shared/CompressedQuaternion.cpp`

## Your output

For each of the 9 claims: CONFIRMED (with line range) or WRONG (with the actual layout + line range).
Then a one-line verdict: do the plan's CKAT/KFAT byte tables and the install()-port instruction match
the loader, or will they desync on a real `.ans`? Keep it tight and source-cited.
