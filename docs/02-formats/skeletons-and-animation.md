# Skeletons and Animation (.sat / .skt / .ans)

> Covers: skeletons (.sat/.skt), animation tracks (.ans), Three.js Skeleton/AnimationClip/AnimationMixer.

> **Verified** against `../swg-client-v2` (`clientSkeletalAnimation/`) + `../swg-blender-plugin` by a 4-consultant cross-AI crew; see `.planning/research/CONSULT-P2-SYNTHESIS.md`. Binary-format sections below replace the previous AI-fabricated layouts. High-level architecture and Three.js-integration prose is preserved where it remains sound.

---

## Overview

In SWG, character models are heavily decoupled across three file types:

- **`.sat`** (Skeletal Appearance Template — `FORM SMAT`) — the auto-compose entry point for a skinned character or creature. It is **not** an animation manifest; it lists the mesh generators (`MSGN` block — paths to `.lmg`/`.mgn` files) and skeleton templates (`SKTI` block — pairs of `skeletonPath` + `attachmentTransformName` pointing to `.skt` files), plus an optional animation-table mapping (`LATX`, v0003+). Runtime class: `SkeletalAppearance2`. (`SkeletalAppearanceTemplate.cpp:786-1136`)
- **`.skt`** (Skeleton Template — `FORM SKTM`) — stores the hierarchical joint tree: bind-pose translation (`BPTR`) and rotation (`BPRO`) per joint, parent index (`PRNT`), pre/post rotation (`RPRE`/`RPST`), and joint order (`JROR`). (`BasicSkeletonTemplate.cpp:151-389`). Multi-skeleton LOD is wrapped in `FORM SLOD`.
- **`.ans`** (Animation Sequence — `FORM KFAT` or `FORM CKAT`) — a keyframe animation file whose **root FORM tag** is the encoding discriminator: `KFAT` = uncompressed quaternion keyframes; `CKAT` = compressed quaternion keyframes. Animation data is completely separate from the skeleton structure; channels are matched to joints **by name**.

For IFF chunk framing and `.tre` archive extraction, see [../01-core-engine/iff-and-tre.md](../01-core-engine/iff-and-tre.md). Only skeleton/animation-specific parsing is shown here.

For composite-appearance assembly (attaching `.mgn` mesh parts onto a shared skeleton), see [./meshes-and-appearances.md](./meshes-and-appearances.md).

For animation-driven audio triggers, see [./audio-and-effects.md](./audio-and-effects.md).

---

## Rigging Containers: .sat and .skt

### IFF Chunk Hierarchy (.skt)

**Verified** against `../swg-client-v2` (`BasicSkeletonTemplate.cpp:151-389`) + `../swg-blender-plugin`; see `.planning/research/CONSULT-P2-SYNTHESIS.md §1.2`.

Inside a `.tre` archive, skeleton files use the following nested IFF chunk layout:

```
FORM SKTM            (root skeleton template form)
  FORM 0001|0002     (version sub-form)
    INFO             joint count + metadata
    NAME             joint name strings (null-terminated ASCII, one per joint)
    PRNT             parent index per joint (int32; -1 = root)
    RPRE             pre-rotation per joint (quaternion)
    RPST             post-rotation per joint (quaternion)
    BPTR             bind-pose translation per joint (3×float32 X,Y,Z)
    BPRO             bind-pose rotation per joint (quaternion, on-disk order w,x,y,z)
    [BPMJ]           optional bind-pose mirror joint data
    JROR             joint rendering order
```

Multi-skeleton LOD is handled by a `FORM SLOD` wrapper that references multiple `SKTM` forms at different detail levels.

> **Note:** `SKTM` is overloaded — it is the root FORM of a `.skt` file **and** the name of an inner chunk inside a `.mgn`/`SKMG` file (the skeleton-template name list). The two uses are structurally unrelated; name the respective parsers distinctly.

The fabricated `FORM BONE → NAME/XFRM/INDX` tree from the previous version of this doc does not exist in the real client source.

---

## Skeleton Parse and Reconstruct

### C++ Structural Rigging Representation

Define native container structs matching the verified binary fields from `FORM SKTM`. Quaternions are stored on disk in `(w,x,y,z)` order (`Quaternion.h:30-33`); the struct below uses that canonical on-disk order.

```cpp
#include <napi.h>
#include <string>
#include <vector>

// On-disk quaternion order: (w, x, y, z) — matches Quaternion.h:30-33 in swg-client-v2.
// For glTF/Blender export: apply X-mirror handedness conversion q -> (w, x, -y, -z),
// then reorder to glTF layout (x, y, z, w). See §Coordinate Convention below.
struct SwgQuaternion {
    float w = 1.0f, x = 0.0f, y = 0.0f, z = 0.0f;
};

struct SwgBoneJoint {
    std::string  name;
    int32_t      parentIndex     = -1;      // PRNT chunk; -1 = root
    float        bindTranslation[3] = {};   // BPTR chunk (X,Y,Z bind-pose position)
    SwgQuaternion bindRotation;             // BPRO chunk (bind-pose rotation, w,x,y,z)
    SwgQuaternion preRotation;              // RPRE chunk
    SwgQuaternion postRotation;             // RPST chunk
};

struct SwgSkeletonRig {
    std::string skeletonName;
    std::vector<SwgBoneJoint> joints;
};
```

### C++ Binary .skt Joint-Hierarchy Parser (FORM SKTM)

The real chunk sequence inside `FORM SKTM → FORM 0001|0002` is: `INFO NAME PRNT RPRE RPST BPTR BPRO [BPMJ] JROR` — each is a parallel array chunk (one entry per joint), not a per-joint nested form. `BasicSkeletonTemplate.cpp:151-389`.

```cpp
class SwgRiggingParser {
public:
    static SwgSkeletonRig ParseSkeletonForm(const uint8_t* data, size_t& offset) {
        SwgSkeletonRig rig;

        // FORM SKTM
        TrnBinaryParser::Read4CharTag(data, offset); // "FORM"
        TrnBinaryParser::ReadUint32BE(data, offset); // form size (big-endian per IFF convention)
        TrnBinaryParser::Read4CharTag(data, offset); // "SKTM"

        // FORM 0001|0002 (version sub-form)
        TrnBinaryParser::Read4CharTag(data, offset); // "FORM"
        uint32_t versionFormSize = TrnBinaryParser::ReadUint32BE(data, offset);
        TrnBinaryParser::Read4CharTag(data, offset); // "0001" or "0002"
        size_t endOffset = offset + versionFormSize - 4;

        uint32_t jointCount = 0;

        while (offset < endOffset) {
            std::string chunkTag  = TrnBinaryParser::Read4CharTag(data, offset);
            uint32_t    chunkSize = TrnBinaryParser::ReadUint32BE(data, offset);
            size_t      nextChunk = offset + chunkSize;

            if (chunkTag == "INFO") {
                jointCount = TrnBinaryParser::ReadUint32LE(data, offset);
                rig.joints.resize(jointCount);
            }
            else if (chunkTag == "NAME") {
                // Parallel array of null-terminated ASCII joint name strings
                for (uint32_t i = 0; i < jointCount; ++i) {
                    rig.joints[i].name = std::string(reinterpret_cast<const char*>(data + offset));
                    offset += rig.joints[i].name.length() + 1;
                }
            }
            else if (chunkTag == "PRNT") {
                // Parallel array of int32 parent indices (-1 = root)
                for (uint32_t i = 0; i < jointCount; ++i)
                    rig.joints[i].parentIndex = TrnBinaryParser::ReadInt32LE(data, offset);
            }
            else if (chunkTag == "RPRE") {
                for (uint32_t i = 0; i < jointCount; ++i) {
                    rig.joints[i].preRotation.w = TrnBinaryParser::ReadFloatLE(data, offset);
                    rig.joints[i].preRotation.x = TrnBinaryParser::ReadFloatLE(data, offset);
                    rig.joints[i].preRotation.y = TrnBinaryParser::ReadFloatLE(data, offset);
                    rig.joints[i].preRotation.z = TrnBinaryParser::ReadFloatLE(data, offset);
                }
            }
            else if (chunkTag == "RPST") {
                for (uint32_t i = 0; i < jointCount; ++i) {
                    rig.joints[i].postRotation.w = TrnBinaryParser::ReadFloatLE(data, offset);
                    rig.joints[i].postRotation.x = TrnBinaryParser::ReadFloatLE(data, offset);
                    rig.joints[i].postRotation.y = TrnBinaryParser::ReadFloatLE(data, offset);
                    rig.joints[i].postRotation.z = TrnBinaryParser::ReadFloatLE(data, offset);
                }
            }
            else if (chunkTag == "BPTR") {
                // Bind-pose translation (3×float32 per joint, X,Y,Z)
                for (uint32_t i = 0; i < jointCount; ++i) {
                    rig.joints[i].bindTranslation[0] = TrnBinaryParser::ReadFloatLE(data, offset);
                    rig.joints[i].bindTranslation[1] = TrnBinaryParser::ReadFloatLE(data, offset);
                    rig.joints[i].bindTranslation[2] = TrnBinaryParser::ReadFloatLE(data, offset);
                }
            }
            else if (chunkTag == "BPRO") {
                // Bind-pose rotation (4×float32 per joint, on-disk order w,x,y,z)
                for (uint32_t i = 0; i < jointCount; ++i) {
                    rig.joints[i].bindRotation.w = TrnBinaryParser::ReadFloatLE(data, offset);
                    rig.joints[i].bindRotation.x = TrnBinaryParser::ReadFloatLE(data, offset);
                    rig.joints[i].bindRotation.y = TrnBinaryParser::ReadFloatLE(data, offset);
                    rig.joints[i].bindRotation.z = TrnBinaryParser::ReadFloatLE(data, offset);
                }
            }
            // BPMJ, JROR — skip for now (optional / render-order only)
            offset = nextChunk;
        }
        return rig;
    }
};
```

### Fast Buffer-Transfer Serialization to N-API

Serialize bind-pose transforms directly into typed `Float32Array` buffers. Layout per joint:
`[parentIndex, tx, ty, tz, qw, qx, qy, qz]` = 8 floats (bind translation + bind rotation in
on-disk w,x,y,z order). TypeScript consumers must apply the X-mirror handedness conversion
before sending to Three.js or glTF — see §Coordinate Convention.

```cpp
Napi::Value UnpackRiggingToBuffers(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    Napi::ArrayBuffer inputBuffer = info[0].As<Napi::ArrayBuffer>();

    const uint8_t* rawData = static_cast<const uint8_t*>(inputBuffer.Data());
    size_t offset = 0;

    SwgSkeletonRig rig = SwgRiggingParser::ParseSkeletonForm(rawData, offset);

    // Per joint: [parentIndex, tx, ty, tz, qw, qx, qy, qz] = 8 floats
    // Quaternion order on wire = on-disk (w,x,y,z); convert to Three.js (x,y,z,w) in TS.
    size_t attributesPerJoint = 8;
    Napi::Float32Array jsTransformBuffer = Napi::Float32Array::New(env, rig.joints.size() * attributesPerJoint);
    Napi::Array        jsNameArray       = Napi::Array::New(env, rig.joints.size());

    for (size_t i = 0; i < rig.joints.size(); ++i) {
        size_t idx         = i * attributesPerJoint;
        const auto& joint  = rig.joints[i];

        jsNameArray[i] = Napi::String::New(env, joint.name);

        jsTransformBuffer[idx]     = static_cast<float>(joint.parentIndex);
        jsTransformBuffer[idx + 1] = joint.bindTranslation[0]; // X
        jsTransformBuffer[idx + 2] = joint.bindTranslation[1]; // Y
        jsTransformBuffer[idx + 3] = joint.bindTranslation[2]; // Z
        jsTransformBuffer[idx + 4] = joint.bindRotation.w;
        jsTransformBuffer[idx + 5] = joint.bindRotation.x;
        jsTransformBuffer[idx + 6] = joint.bindRotation.y;
        jsTransformBuffer[idx + 7] = joint.bindRotation.z;
    }

    Napi::Object resultContainer = Napi::Object::New(env);
    resultContainer.Set("names",      jsNameArray);
    resultContainer.Set("transforms", jsTransformBuffer);
    return resultContainer;
}
```

### Reconstructing a THREE.Skeleton in TypeScript

Consume the flat N-API payload and link indices to assemble a working `THREE.Skeleton`.

SWG engine space is **left-handed, Y-up**. Three.js uses right-handed, Y-up. The conversion is an
**X-axis mirror**: negate X on positions; on quaternions apply `q=(w,x,y,z) → (w,x,-y,-z)`, then
reorder to Three.js `(x,y,z,w)`. See §Coordinate Convention for the derivation.

The N-API buffer layout per joint: `[parentIndex, tx, ty, tz, qw, qx, qy, qz]` — indices 4-7 are
the bind-rotation in on-disk `(w,x,y,z)` order.

```typescript
import * as THREE from 'three';

export interface SwgJointNode {
  name: string;
  parentIndex: number;
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
}

/**
 * Convert a SWG on-disk quaternion (w,x,y,z, left-handed Y-up) to a Three.js Quaternion
 * (x,y,z,w, right-handed Y-up) by applying an X-axis mirror: q → (w, x, -y, -z).
 */
function swgQuatToThree(qw: number, qx: number, qy: number, qz: number): THREE.Quaternion {
  // X-mirror handedness: negate y and z imaginary parts; keep w and x.
  // Then reorder from (w,x,y,z) to Three.js constructor order (x,y,z,w).
  return new THREE.Quaternion(qx, -qy, -qz, qw);
}

export function buildThreeSkeletonFromNative(napiResult: any): THREE.Skeleton {
  const names: string[]          = napiResult.names;
  const transforms: Float32Array = napiResult.transforms;
  const jointCount               = names.length;

  const boneArray: THREE.Bone[] = [];

  // 1. Instantiate individual structural Bone elements
  for (let i = 0; i < jointCount; i++) {
    const idx  = i * 8;
    const bone = new THREE.Bone();
    bone.name  = names[i];

    // Bind translation: negate X to convert left-handed → right-handed
    bone.position.set(-transforms[idx + 1], transforms[idx + 2], transforms[idx + 3]);

    // Bind rotation: on-disk (w,x,y,z) → X-mirror → Three.js (x,y,z,w)
    bone.quaternion.copy(
      swgQuatToThree(transforms[idx + 4], transforms[idx + 5], transforms[idx + 6], transforms[idx + 7])
    );

    boneArray.push(bone);
  }

  // 2. Link parenting slots sequentially to establish the scene graph tree
  for (let i = 0; i < jointCount; i++) {
    const parentIndex = Math.floor(transforms[i * 8]);
    if (parentIndex !== -1 && boneArray[parentIndex]) {
      boneArray[parentIndex].add(boneArray[i]);
    }
  }

  // 3. Return compiled master wrapper ready for SkinnedMesh binding
  return new THREE.Skeleton(boneArray);
}
```

---

## Skeleton Visualization in the R3F Canvas

To inspect joint matrices without attaching a skin, render the skeleton graph directly using a `THREE.SkeletonHelper` overlay. SWG rigs typically define element `[0]` as the global ground root.

```tsx
import React, { useMemo, useRef, useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { buildThreeSkeletonFromNative } from './SkeletonUtils';

interface RigViewerProps {
  napiPayload: any;
}

export const SwgSkeletonRigVisualizer: React.FC<RigViewerProps> = ({ napiPayload }) => {
  const groupRef = useRef<THREE.Group>(null);
  const { scene } = useThree();

  // 1. Compile the native transformation buffer data into a functional Three Skeleton
  const skeleton = useMemo(() => {
    return buildThreeSkeletonFromNative(napiPayload);
  }, [napiPayload]);

  useEffect(() => {
    if (!groupRef.current || skeleton.bones.length === 0) return;

    // 2. Find the absolute root bone node in the array (parentIndex was -1)
    // SWG rigs typically define the initial element as the global ground root point
    const rootBone = skeleton.bones[0];
    groupRef.current.add(rootBone);

    // 3. Attach standard 3D bone linkage armature gizmos for inspection
    const helper = new THREE.SkeletonHelper(rootBone);
    scene.add(helper);

    return () => {
      scene.remove(helper);
    };
  }, [skeleton, scene]);

  return (
    <group ref={groupRef}>
      {/* Standalone rig bones are now part of the 3D space, ready to accept .mgn mesh attachments */}
    </group>
  );
};
```

---

## Animation Tracks: .ans

**Verified** against `../swg-client-v2` (`CompressedKeyframeAnimationTemplate.cpp`, `KeyframeSkeletalAnimationTemplate.cpp`, `CompressedQuaternion.cpp`) + `../swg-blender-plugin` (`animation.py`, `animation_compressed.py`, `compressed_quaternion.py`); see `.planning/research/CONSULT-P2-SYNTHESIS.md §1.6` and `CONSULT-P2-03-opus.out`.

The fabricated `FORM ANST / CHNL / POSK / ROTK` tree from the previous version of this doc does **not exist** in the real client. Every byte-level claim in the prior parser (float-time keys, `qx,qy,qz,qw` order, no compression) was wrong.

### IFF Chunk Hierarchy (.ans)

The **root FORM tag** is the encoding discriminator — there is no `ANST` form:

```
FORM KFAT  (uncompressed keyframe — KeyframeSkeletalAnimationTemplate)
  FORM 0002|0003      (version; 0002=legacy Euler baked to quat, 0003=native quat — prefer 0003)
    INFO              fps:float32  + 6 int32 counts (KFAT): frameCount, transformInfoCount,
                        rotationChannelCount, staticRotationCount,
                        translationChannelCount, staticTranslationCount
    FORM XFRM
      XFIN  ×transformInfoCount    per-joint descriptor (joint NAME + channel indices, see §below)
    [FORM AROT]                    animated rotation channels
      QCHN  ×rotationChannelCount  keyCount:int32 + per-key {frame:int32, quat:(w,x,y,z) 4×float32}
    [SROT]                         static rotations — keyCount×(w,x,y,z) 4×float32 each
    [FORM ATRN]                    animated translation channels (3 INDEPENDENT scalar axes)
      CHNL  ×translationChannelCount  keyCount:int32 + per-key {frame:int32, value:float32}
    [STRN]                         static translations — one float32 per static axis
    [FORM MSGS] [LOCT] [QCHN-locomotion]   optional

FORM CKAT  (compressed keyframe — CompressedKeyframeAnimationTemplate)
  FORM 0001
    INFO              fps:float32 + 6 int16 counts (same fields as KFAT, narrower)
    FORM XFRM
      XFIN  ×transformCount        same fields as KFAT XFIN but indices are int16, mask is uint8
    [FORM AROT]
      QCHN  ×rotationChannelCount  keyCount:int16 + xFmt:uint8 yFmt:uint8 zFmt:uint8
                                   + per-key {frame:int16, packed:uint32}  (see §Compressed Quaternion)
    [SROT]                         xFmt:uint8 yFmt:uint8 zFmt:uint8 + packed:uint32 each
    [FORM ATRN]
      CHNL  ×translationChannelCount  keyCount:int16 + per-key {frame:int16, value:float32}
    [STRN]                         static translations — float32 each
    [FORM MSGS] [LOCT] [QCHN-locomotion]   optional
```

**Key differences from the fabricated layout:**
- Root is `KFAT` or `CKAT`, not `ANST`. The tag is the discriminator.
- Counts are `int32` in KFAT, `int16` in CKAT.
- Per-joint data lives in `XFIN` chunks inside a single `FORM XFRM` (not per-bone `CHNL` forms).
- Rotation is a single `QCHN` per animated joint (one quaternion stream), not `ROTK`.
- Translation is **three independent scalar `CHNL` channels** (x, y, z separately), gated by `translation_mask` bits — not a `POSK` vector array.
- Key "time" is an **integer frame index** (`int32` KFAT / `int16` CKAT); seconds = `frame / fps`.
- On-disk quaternion component order is **(w, x, y, z)** for raw floats (`Iff.cpp:1486-1490`).
- `CKAT` uses a compressed `uint32` quaternion (x=11b, y=11b, z=10b; w is dropped and reconstructed).

### XFIN Per-Joint Descriptor

Each `XFIN` chunk (inside `FORM XFRM`) names a joint and records its channel indices:

| Field | KFAT 0003 type | CKAT 0001 type | Notes |
|---|---|---|---|
| name | null-terminated string | null-terminated string | Matched to skeleton joint BY NAME |
| hasAnimatedRotation | int8 | int8 | Non-zero = animated; else static |
| rotationChannelIndex | int32 | int16 | Index into AROT pool (animated) or SROT pool (static) |
| translationMask | uint32 | uint8 | SATCCF bits: 0x08=xAnimated, 0x10=yAnimated, 0x20=zAnimated |
| xTranslationChannelIndex | int32 | int16 | Index into ATRN pool (if bit set) or STRN pool (if static) |
| yTranslationChannelIndex | int32 | int16 | |
| zTranslationChannelIndex | int32 | int16 | |

`KeyframeSkeletalAnimationTemplateDef.h:13-25`; KFAT XFIN: `KeyframeSkeletalAnimationTemplate.cpp:1543-1553`; CKAT XFIN: `CompressedKeyframeAnimationTemplate.cpp:1223-1232`.

### Compressed Quaternion Decode (CKAT QCHN)

Each `QCHN` record in a CKAT file stores three format bytes followed by per-key `uint32` packed values. **`CompressedQuaternion.cpp:82-100, 370-419`** (primary) ≡ `compressed_quaternion.py:79-86` (Python second oracle).

**Bit packing:**
```
packed_uint32 = (xPacked << 21) | (yPacked << 10) | zPacked
  x : 11 bits  — bits 31..21  (value mask 0x3FF, sign bit 0x400)
  y : 11 bits  — bits 20..10  (value mask 0x3FF, sign bit 0x400)
  z : 10 bits  — bits 9..0   (value mask 0x1FF, sign bit 0x200)
  w : NOT stored; reconstructed as w = sqrt(max(0.0, 1 - (x²+y²+z²)))
```

**Per-component format byte** (`xFmt`/`yFmt`/`zFmt`) encodes a precision level and a base value:
- High bits select one of 7 precision levels (`s_formatPrecisionInfo`, `CompressedQuaternion.cpp:108-117`):
  `baseCount = 1<<shift`; `baseSeparation = 2/(baseCount+1)`.
- Low bits = `baseIndex i` (0..baseCount-1); `baseValue = -1.0 + (i+1) * baseSeparation`.
- `half_range = 2.0 / (baseCount + 1)` (equals `baseSeparation`).
- 11-bit expand factor = `half_range / 1023.0`; 10-bit expand factor = `half_range / 511.0`.

**Decode formula:**
```python
x_field = (data >> 21) & 0x7FF       # 11 bits
y_field = (data >> 10) & 0x7FF
z_field =  data        & 0x3FF       # 10 bits

def expand_eleven(field, fmt_byte):
    base, p = lookup(fmt_byte)       # from precomputed 255-entry table
    f = half_range(p) / 1023.0
    mag = (field & 0x3FF) * f        # 10 magnitude bits
    return base - mag if (field & 0x400) else base + mag

def expand_ten(field, fmt_byte):
    base, p = lookup(fmt_byte)
    f = half_range(p) / 511.0
    mag = (field & 0x1FF) * f        # 9 magnitude bits
    return base - mag if (field & 0x200) else base + mag

x = expand_eleven(x_field, xFmt)
y = expand_eleven(y_field, yFmt)
z = expand_ten   (z_field, zFmt)
w = sqrt(max(0.0, 1.0 - (x*x + y*y + z*z)))  # clamp protects against NaN; see §open items
```

This is **not** smallest-three encoding; it is per-component min/max quantization with a dropped `w`.

**Interpolation:** rotation = slerp between bracketing keys; translation = linear lerp. Time = `frame / fps` (no per-key float time stored). No explicit loop flag in the format — looping is a higher-level playback policy. (`CompressedKeyframeAnimationTemplate.cpp:712-764, 768-809`)

**Key culling on load:** CKAT drops redundant keys at read time — keep key `i` in QCHN iff
`(i==0 || i==keyCount-1 || !(i&1)) && compressed != lastCompressed`; translation keeps
`i==0 || last || mid || |value-last|>2*epsilon`. KFAT does not cull. (`CKAT.cpp:570-584, 640-660`)

### Open Implementation Items

- **CKAT `w` reconstruction:** C++ does not clamp the `sqrt`; Python clamps `max(0, ...)`. Adopt the clamp — it is numerically safe and the two oracles agree on valid data.
- **Quaternion IR order:** On-disk `(w,x,y,z)` for raw KFAT; compressed path (CKAT) expands to `(x,y,z)` then derives `w`. Normalize to one internal order (recommend `(x,y,z,w)` glTF-style) on ingest before mixing KFAT and CKAT channels.
- **KFAT 0002 (legacy Euler):** C++ bakes Euler channels to quaternions on load (`buildQuaternionKeyframesFromEulers`). Defer — `0003` + `CKAT` are the priority and fully agreed by both oracles.

---

## Animation Parse and Bridge

The C++ structs and parser below reflect the **real** `KFAT`/`CKAT` format. The previous version's
`SwgAnimationParser` dispatched on a non-existent `ANST/CHNL/POSK/ROTK` tree and read float-time
keys in the wrong quaternion order — all replaced here.

### C++ Animation Timeline Structs

```cpp
#include <napi.h>
#include <string>
#include <vector>
#include <cstdint>

// Rotation key: integer frame index + quaternion in on-disk order (w,x,y,z).
// Time in seconds = frame / fps.  (KeyframeSkeletalAnimationTemplate.cpp:526-538)
struct RotationKey {
    int32_t frame;
    float   w, x, y, z;  // on-disk (w,x,y,z); convert to Three.js (x,y,z,w) in TS
};

// Translation key: integer frame + scalar value for ONE axis.
// Translation is three independent scalar channels, not a [x,y,z] vector per key.
// (KeyframeSkeletalAnimationTemplate.cpp:579-591)
struct TranslationKey {
    int32_t frame;
    float   value;
};

// One animated joint's channel data (KFAT uncompressed — full float quaternions)
struct SwgJointChannelKFAT {
    std::string boneTargetName;           // from XFIN name string
    bool        hasAnimatedRotation = false;
    std::vector<RotationKey>    rotationKeys;  // from AROT/QCHN; empty if static
    float                       staticRotW = 1, staticRotX = 0, staticRotY = 0, staticRotZ = 0; // from SROT
    // Translation: per-axis, independently animated or static
    bool  xAnimated = false, yAnimated = false, zAnimated = false;
    std::vector<TranslationKey> xKeys, yKeys, zKeys;  // from ATRN/CHNL
    float staticX = 0, staticY = 0, staticZ = 0;      // from STRN
};

struct SwgAnimationSequence {
    std::string animationName;
    float       fps           = 30.0f;
    int32_t     frameCount    = 0;
    // duration = (frameCount - 1) / fps; looping decided by higher-level playback, not this format
    std::vector<SwgJointChannelKFAT> joints;
};
```

### C++ Binary .ans Parser (KFAT 0003 — uncompressed quaternion, priority path)

The CKAT (compressed) path requires the compressed quaternion decoder from `CompressedQuaternion.cpp`
and is best implemented as a separate class mirroring `CompressedKeyframeAnimationTemplate.cpp`.
The KFAT 0003 path shown here is the simpler reference; both share the same `XFIN`-then-channel-pools
architecture. `KeyframeSkeletalAnimationTemplate.cpp:1518-1640`.

```cpp
class SwgAnimationParser {
public:
    static SwgAnimationSequence ParseKFAT0003(const uint8_t* data, size_t& offset) {
        SwgAnimationSequence anim;

        // FORM KFAT
        TrnBinaryParser::Read4CharTag(data, offset); // "FORM"
        TrnBinaryParser::ReadUint32BE(data, offset);
        TrnBinaryParser::Read4CharTag(data, offset); // "KFAT"

        // FORM 0003
        TrnBinaryParser::Read4CharTag(data, offset); // "FORM"
        uint32_t versionFormSize = TrnBinaryParser::ReadUint32BE(data, offset);
        TrnBinaryParser::Read4CharTag(data, offset); // "0003"
        size_t endOffset = offset + versionFormSize - 4;

        // --- Descriptor state from XFIN ---
        int32_t transformInfoCount = 0, rotChannelCount = 0, staticRotCount = 0;
        int32_t transChannelCount  = 0, staticTransCount = 0;

        // XFIN descriptors (joint→channel index mapping)
        struct XfinRecord {
            std::string name;
            bool    hasAnimRot;
            int32_t rotIdx;
            uint32_t transMask;
            int32_t xIdx, yIdx, zIdx;
        };
        std::vector<XfinRecord> xfins;

        // Flat channel pools — indexed by XFIN indices
        std::vector<std::vector<RotationKey>>    animRotPools;
        std::vector<RotationKey>                 staticRotPool; // one per static rot entry
        std::vector<std::vector<TranslationKey>> transChannelPool;
        std::vector<float>                       staticTransPool;

        while (offset < endOffset) {
            std::string tag      = TrnBinaryParser::Read4CharTag(data, offset);
            uint32_t    chunkSz  = TrnBinaryParser::ReadUint32BE(data, offset);
            size_t      nextChunk = offset + chunkSz;

            if (tag == "INFO") {
                anim.fps            = TrnBinaryParser::ReadFloatLE(data, offset);
                anim.frameCount     = TrnBinaryParser::ReadInt32LE(data, offset);
                transformInfoCount  = TrnBinaryParser::ReadInt32LE(data, offset);
                rotChannelCount     = TrnBinaryParser::ReadInt32LE(data, offset);
                staticRotCount      = TrnBinaryParser::ReadInt32LE(data, offset);
                transChannelCount   = TrnBinaryParser::ReadInt32LE(data, offset);
                staticTransCount    = TrnBinaryParser::ReadInt32LE(data, offset);
                xfins.resize(transformInfoCount);
                animRotPools.resize(rotChannelCount);
                staticRotPool.resize(staticRotCount);
                transChannelPool.resize(transChannelCount);
                staticTransPool.resize(staticTransCount);
            }
            else if (tag == "FORM") {
                std::string subTag = TrnBinaryParser::Read4CharTag(data, offset);
                size_t subEnd = nextChunk;

                if (subTag == "XFRM") {
                    // Read XFIN chunks — one per joint
                    int xfinIdx = 0;
                    while (offset < subEnd && xfinIdx < transformInfoCount) {
                        std::string ct = TrnBinaryParser::Read4CharTag(data, offset);
                        uint32_t    cs = TrnBinaryParser::ReadUint32BE(data, offset);
                        size_t      cn = offset + cs;
                        if (ct == "XFIN") {
                            auto& x       = xfins[xfinIdx++];
                            x.name        = TrnBinaryParser::ReadNullTermString(data, offset);
                            x.hasAnimRot  = TrnBinaryParser::ReadInt8(data, offset) != 0;
                            x.rotIdx      = TrnBinaryParser::ReadInt32LE(data, offset);
                            x.transMask   = TrnBinaryParser::ReadUint32LE(data, offset);
                            x.xIdx        = TrnBinaryParser::ReadInt32LE(data, offset);
                            x.yIdx        = TrnBinaryParser::ReadInt32LE(data, offset);
                            x.zIdx        = TrnBinaryParser::ReadInt32LE(data, offset);
                        }
                        offset = cn;
                    }
                }
                else if (subTag == "AROT") {
                    // Read QCHN chunks (one per animated rotation channel)
                    int poolIdx = 0;
                    while (offset < subEnd && poolIdx < rotChannelCount) {
                        std::string ct = TrnBinaryParser::Read4CharTag(data, offset);
                        uint32_t    cs = TrnBinaryParser::ReadUint32BE(data, offset);
                        size_t      cn = offset + cs;
                        if (ct == "QCHN") {
                            int32_t keyCount = TrnBinaryParser::ReadInt32LE(data, offset);
                            animRotPools[poolIdx].resize(keyCount);
                            for (int32_t k = 0; k < keyCount; ++k) {
                                auto& rk  = animRotPools[poolIdx][k];
                                rk.frame  = TrnBinaryParser::ReadInt32LE(data, offset);
                                // On-disk quaternion order: w, x, y, z
                                rk.w      = TrnBinaryParser::ReadFloatLE(data, offset);
                                rk.x      = TrnBinaryParser::ReadFloatLE(data, offset);
                                rk.y      = TrnBinaryParser::ReadFloatLE(data, offset);
                                rk.z      = TrnBinaryParser::ReadFloatLE(data, offset);
                            }
                            ++poolIdx;
                        }
                        offset = cn;
                    }
                }
                else if (subTag == "ATRN") {
                    // Read CHNL chunks — one per animated translation scalar axis
                    int poolIdx = 0;
                    while (offset < subEnd && poolIdx < transChannelCount) {
                        std::string ct = TrnBinaryParser::Read4CharTag(data, offset);
                        uint32_t    cs = TrnBinaryParser::ReadUint32BE(data, offset);
                        size_t      cn = offset + cs;
                        if (ct == "CHNL") {
                            int32_t keyCount = TrnBinaryParser::ReadInt32LE(data, offset);
                            transChannelPool[poolIdx].resize(keyCount);
                            for (int32_t k = 0; k < keyCount; ++k) {
                                auto& tk = transChannelPool[poolIdx][k];
                                tk.frame = TrnBinaryParser::ReadInt32LE(data, offset);
                                tk.value = TrnBinaryParser::ReadFloatLE(data, offset);
                            }
                            ++poolIdx;
                        }
                        offset = cn;
                    }
                }
            }
            else if (tag == "SROT") {
                // Static rotation pool — (w,x,y,z) float32 quats
                for (int i = 0; i < staticRotCount; ++i) {
                    staticRotPool[i].frame = -1; // static = constant
                    staticRotPool[i].w     = TrnBinaryParser::ReadFloatLE(data, offset);
                    staticRotPool[i].x     = TrnBinaryParser::ReadFloatLE(data, offset);
                    staticRotPool[i].y     = TrnBinaryParser::ReadFloatLE(data, offset);
                    staticRotPool[i].z     = TrnBinaryParser::ReadFloatLE(data, offset);
                }
            }
            else if (tag == "STRN") {
                for (int i = 0; i < staticTransCount; ++i)
                    staticTransPool[i] = TrnBinaryParser::ReadFloatLE(data, offset);
            }
            offset = nextChunk;
        }

        // Assemble per-joint channel records from XFIN descriptors + flat pools
        anim.joints.resize(xfins.size());
        for (size_t i = 0; i < xfins.size(); ++i) {
            const auto& x = xfins[i];
            auto& jc       = anim.joints[i];
            jc.boneTargetName      = x.name;
            jc.hasAnimatedRotation = x.hasAnimRot;
            if (x.hasAnimRot && x.rotIdx < rotChannelCount)
                jc.rotationKeys = animRotPools[x.rotIdx];
            else if (!x.hasAnimRot && x.rotIdx < staticRotCount) {
                const auto& sr = staticRotPool[x.rotIdx];
                jc.staticRotW = sr.w; jc.staticRotX = sr.x;
                jc.staticRotY = sr.y; jc.staticRotZ = sr.z;
            }
            // SATCCF translation bits: 0x08=xAnim, 0x10=yAnim, 0x20=zAnim
            jc.xAnimated = (x.transMask & 0x08) != 0;
            jc.yAnimated = (x.transMask & 0x10) != 0;
            jc.zAnimated = (x.transMask & 0x20) != 0;
            if (jc.xAnimated && x.xIdx < transChannelCount) jc.xKeys = transChannelPool[x.xIdx];
            else if (!jc.xAnimated && x.xIdx < staticTransCount)  jc.staticX = staticTransPool[x.xIdx];
            if (jc.yAnimated && x.yIdx < transChannelCount) jc.yKeys = transChannelPool[x.yIdx];
            else if (!jc.yAnimated && x.yIdx < staticTransCount)  jc.staticY = staticTransPool[x.yIdx];
            if (jc.zAnimated && x.zIdx < transChannelCount) jc.zKeys = transChannelPool[x.zIdx];
            else if (!jc.zAnimated && x.zIdx < staticTransCount)  jc.staticZ = staticTransPool[x.zIdx];
        }
        return anim;
    }
};
```

### Packing Timelines for the JS Bridge (N-API)

Pack per-joint channel data into flat `Float32Array` buffers. Layout:
- Rotation keys (animated): `[frame, w, x, y, z]` = 5 floats per key (on-disk w,x,y,z order; convert to Three.js in TS)
- Translation keys (per-axis): `[frame, value]` = 2 floats per key; three separate arrays (x/y/z)
- Duration: `(frameCount - 1) / fps`

```cpp
Napi::Value UnpackAnimationToJsPayload(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    Napi::ArrayBuffer inputBuffer = info[0].As<Napi::ArrayBuffer>();
    const uint8_t* rawData = static_cast<const uint8_t*>(inputBuffer.Data());
    size_t offset = 0;

    SwgAnimationSequence anim = SwgAnimationParser::ParseKFAT0003(rawData, offset);
    float duration = anim.frameCount > 1 ? (float)(anim.frameCount - 1) / anim.fps : 0.0f;

    Napi::Object jsResult = Napi::Object::New(env);
    jsResult.Set("fps",      Napi::Number::New(env, anim.fps));
    jsResult.Set("duration", Napi::Number::New(env, duration));

    Napi::Array jsChannelsArray = Napi::Array::New(env, anim.joints.size());

    for (size_t i = 0; i < anim.joints.size(); ++i) {
        const auto& jc = anim.joints[i];
        Napi::Object jsChannelObj = Napi::Object::New(env);
        jsChannelObj.Set("boneName",           Napi::String::New(env, jc.boneTargetName));
        jsChannelObj.Set("hasAnimatedRotation", Napi::Boolean::New(env, jc.hasAnimatedRotation));

        // Rotation: [frame, w, x, y, z] per key (on-disk quaternion order; convert in TS)
        if (jc.hasAnimatedRotation) {
            Napi::Float32Array rotArr = Napi::Float32Array::New(env, jc.rotationKeys.size() * 5);
            for (size_t k = 0; k < jc.rotationKeys.size(); ++k) {
                size_t idx        = k * 5;
                rotArr[idx]       = (float)jc.rotationKeys[k].frame;
                rotArr[idx + 1]   = jc.rotationKeys[k].w;
                rotArr[idx + 2]   = jc.rotationKeys[k].x;
                rotArr[idx + 3]   = jc.rotationKeys[k].y;
                rotArr[idx + 4]   = jc.rotationKeys[k].z;
            }
            jsChannelObj.Set("rotationKeys", rotArr);
        } else {
            // Static: single quaternion [w, x, y, z]
            Napi::Float32Array rotArr = Napi::Float32Array::New(env, 4);
            rotArr[0] = jc.staticRotW; rotArr[1] = jc.staticRotX;
            rotArr[2] = jc.staticRotY; rotArr[3] = jc.staticRotZ;
            jsChannelObj.Set("staticRotation", rotArr);
        }

        // Translation: [frame, value] per key, per axis; or static float
        auto packAxis = [&](const std::vector<TranslationKey>& keys, bool animated, float staticVal,
                            const char* animKey, const char* staticKey) {
            if (animated) {
                Napi::Float32Array arr = Napi::Float32Array::New(env, keys.size() * 2);
                for (size_t k = 0; k < keys.size(); ++k) {
                    arr[k * 2]     = (float)keys[k].frame;
                    arr[k * 2 + 1] = keys[k].value;
                }
                jsChannelObj.Set(animKey, arr);
            } else {
                jsChannelObj.Set(staticKey, Napi::Number::New(env, staticVal));
            }
        };
        packAxis(jc.xKeys, jc.xAnimated, jc.staticX, "xKeys", "staticX");
        packAxis(jc.yKeys, jc.yAnimated, jc.staticY, "yKeys", "staticY");
        packAxis(jc.zKeys, jc.zAnimated, jc.staticZ, "zKeys", "staticZ");

        jsChannelsArray[i] = jsChannelObj;
    }

    jsResult.Set("channels", jsChannelsArray);
    return jsResult;
}
```

---

## AnimationClip Construction

### Compiling a THREE.AnimationClip in TypeScript

Decode the N-API buffers into `VectorKeyframeTrack` and `QuaternionKeyframeTrack` instances.

Key conversions from SWG on-disk format to Three.js:
- Frame index → seconds: `time = frame / fps`
- Quaternion order: on-disk `(w,x,y,z)` → Three.js `(x,y,z,w)` via `new THREE.Quaternion(x, y, z, w)`
- Handedness (left→right): positions negate X; rotations apply X-mirror: `(w,x,y,z) → (w,x,-y,-z)` before reordering
- Translation is three independent scalar tracks, not a single [x,y,z] vector track
- Three.js `QuaternionKeyframeTrack` uses slerp by default — matches the engine (`CKAT.cpp:762`)

```typescript
import * as THREE from 'three';

/** Convert a SWG on-disk quaternion (w,x,y,z, left-handed) to Three.js (x,y,z,w, right-handed). */
function swgQuatToThreeValues(w: number, x: number, y: number, z: number): [number, number, number, number] {
  // X-mirror: negate y and z; then reorder (w,x,y,z) → Three.js (x,y,z,w)
  return [x, -y, -z, w];
}

export function buildThreeAnimationClip(napiAnimPayload: any, clipName: string): THREE.AnimationClip {
  const fps: number    = napiAnimPayload.fps;
  const duration: number = napiAnimPayload.duration;
  const tracks: THREE.KeyframeTrack[] = [];

  for (const ch of napiAnimPayload.channels) {
    const boneName: string = ch.boneName;

    // 1. Rotation track
    if (ch.hasAnimatedRotation && ch.rotationKeys) {
      const rotData: Float32Array = ch.rotationKeys; // [frame, w, x, y, z] × N
      const times: number[]  = [];
      const values: number[] = [];
      for (let i = 0; i < rotData.length; i += 5) {
        times.push(rotData[i] / fps);    // integer frame → seconds
        const [qx, qy, qz, qw] = swgQuatToThreeValues(rotData[i+1], rotData[i+2], rotData[i+3], rotData[i+4]);
        values.push(qx, qy, qz, qw);
      }
      tracks.push(new THREE.QuaternionKeyframeTrack(`${boneName}.quaternion`, times, values));
    }
    // Static rotation: constant quaternion track (single key at t=0 and t=duration)
    else if (ch.staticRotation) {
      const sr: Float32Array = ch.staticRotation; // [w, x, y, z]
      const [qx, qy, qz, qw] = swgQuatToThreeValues(sr[0], sr[1], sr[2], sr[3]);
      tracks.push(new THREE.QuaternionKeyframeTrack(
        `${boneName}.quaternion`, [0, duration], [qx, qy, qz, qw, qx, qy, qz, qw]
      ));
    }

    // 2. Translation: x/y/z are INDEPENDENT scalar channels.
    // Reconstruct a combined .position track by merging keys across all three axes.
    // For a faithful initial implementation, use one VectorKeyframeTrack per joint
    // built from the union of all three axes' key frames (lerp-fill missing axes).
    // Here we use a simplified approach — merge animated keys and fill static axes.
    const buildTranslationTrack = () => {
      const keySet = new Map<number, [number, number, number]>();

      const fillAxis = (keysData: Float32Array | undefined, staticVal: number | undefined,
                        axis: 0 | 1 | 2) => {
        if (keysData) {
          for (let i = 0; i < keysData.length; i += 2) {
            const frame = keysData[i];
            if (!keySet.has(frame)) keySet.set(frame, [0, 0, 0]);
            keySet.get(frame)![axis] = keysData[i + 1];
          }
        } else if (staticVal !== undefined) {
          // Will be filled in the merge pass below
          keySet.forEach(v => { v[axis] = staticVal; });
        }
      };

      fillAxis(ch.xKeys, ch.staticX, 0);
      fillAxis(ch.yKeys, ch.staticY, 1);
      fillAxis(ch.zKeys, ch.staticZ, 2);

      if (keySet.size === 0) return;

      const sortedFrames = Array.from(keySet.keys()).sort((a, b) => a - b);
      const times: number[]  = sortedFrames.map(f => f / fps);
      const values: number[] = [];
      for (const f of sortedFrames) {
        const [tx, ty, tz] = keySet.get(f)!;
        // X-mirror: negate X for left→right-handed conversion
        values.push(-tx, ty, tz);
      }
      tracks.push(new THREE.VectorKeyframeTrack(`${boneName}.position`, times, values));
    };

    if (ch.xKeys || ch.yKeys || ch.zKeys || ch.staticX !== undefined ||
        ch.staticY !== undefined || ch.staticZ !== undefined) {
      buildTranslationTrack();
    }
  }

  return new THREE.AnimationClip(clipName, duration, tracks);
}
```

---

## Animation Mixing and Playback in R3F

Use a `THREE.AnimationMixer` updated inside an R3F `useFrame` loop to calculate and blend bone transformations smoothly at 60 fps.

```tsx
import React, { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { buildThreeAnimationClip } from './AnimationUtils';

interface ActorPlaybackProps {
  skinnedMeshGroup: THREE.Group; // The multi-part character model assembled previously
  rawNapiAnimData: any;
  animationTrackName: string;
}

export const SwgActorAnimationMixer: React.FC<ActorPlaybackProps> = ({
  skinnedMeshGroup,
  rawNapiAnimData,
  animationTrackName
}) => {
  const mixerRef = useRef<THREE.AnimationMixer | null>(null);

  // 1. Compile the native tracking buffer data into a functional THREE.AnimationClip
  const animationClip = useMemo(() => {
    return buildThreeAnimationClip(rawNapiAnimData, animationTrackName);
  }, [rawNapiAnimData, animationTrackName]);

  useEffect(() => {
    if (!skinnedMeshGroup) return;

    // 2. Initialize mixer targeted directly at your character model scene node
    const mixer = new THREE.AnimationMixer(skinnedMeshGroup);
    mixerRef.current = mixer;

    // 3. Queue up the clip and set it to loop smoothly
    const action = mixer.clipAction(animationClip);
    action.setEffectiveWeight(1.0);
    action.play();

    return () => {
      action.stop();
      mixer.uncacheClip(animationClip);
    };
  }, [skinnedMeshGroup, animationClip]);

  // 4. Update timeline frames continuously at 60fps on the WebGL render step
  useFrame((state, delta) => {
    if (mixerRef.current) {
      mixerRef.current.update(delta);
    }
  });

  return null; // Abstract driver component — no standalone geometric mesh output
};
```

---

## Coordinate Convention

**Verified** against `../swg-blender-plugin` (`export_animation.py:154-162`, `coords.py:13-26`); see `.planning/research/CONSULT-P2-SYNTHESIS.md §6` and `CONSULT-P2-03-opus.out §5`.

SWG engine space is **left-handed, Y-up, units = meters**. Standard basis: X right, Y up, Z forward (into screen). On-disk quaternion component order is **(w, x, y, z)** for all raw float quaternions (`Quaternion.h:30-33`).

### Converting to Right-Handed Y-Up (glTF / Blender)

Because both SWG and glTF/Blender are Y-up, the only difference is handedness. The conversion is an **X-axis mirror**:

| Data type | SWG on-disk | Right-handed target |
|---|---|---|
| Position / translation | `(x, y, z)` | `(-x, y, z)` — negate X |
| Rotation quaternion | `(w, x, y, z)` | `(w, x, -y, -z)` — negate y,z imaginary parts |
| glTF quaternion order | — | additionally reorder to `(x, y, z, w)` |

The rotation rule derives from the similarity transform `M' = F·M·F` with `F = diag(-1, 1, 1)` (mirror matrix), which is equivalent to `q = (w,x,y,z) → (w,x,-y,-z)` for pure rotations. The matrix form is exact and is what the Blender exporter uses (`export_animation.py:158-161`).

> **Static-mesh note:** The Blender plugin applies an additional +90° CCW rotation about X (`coords.py:5-7`, `IMPORT_ROTATION_EULER`) as a Blender presentation choice for static meshes. Do **not** bake that into skeleton or animation math.

---

## Notes

- **Multi-track blending:** Integrating `.ans` files with `THREE.AnimationMixer` enables cross-fading and interpolation between clips (e.g., blending an idle loop into a run animation without skeletal snapping). Call `mixer.clipAction(clip).crossFadeTo(otherAction, duration, true)` for smooth transitions.
- **Composite character assembly:** With the `.skt` parser in place, `.sat` (`FORM SMAT`) drives component-based character assembly. The `MSGN` block lists the mesh generators (`.lmg`/`.mgn`) and the `SKTI` block pairs each skeleton path with an attachment-transform name. Modders select a skeleton archetype, attach `.mgn` mesh parts (boots, armor, hair) onto shared bone targets by name, and verify bind weights — see [./meshes-and-appearances.md](./meshes-and-appearances.md).
- **Bind-pose accuracy:** The `BPTR`/`BPRO` chunks read from `FORM SKTM` give the exact rest-pose translation and rotation per joint as used by the retail client. Apply the X-mirror conversion (see §Coordinate Convention) before assembling the Three.js skeleton.
