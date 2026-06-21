# Skeletons and Animation (.sat / .skt / .ans)

> Covers: skeletons (.sat/.skt), animation tracks (.ans), Three.js Skeleton/AnimationClip/AnimationMixer. Source: research doc lines 6235–6710.

> **Caveat:** Format and struct details below are AI-proposed based on reverse-engineering analysis. Validate all field offsets, chunk tags, and data layouts against the real `swg-client-v2` source before treating them as authoritative. See [source provenance](../00-overview/source-provenance.md).

---

## Overview

In SWG, character models are heavily decoupled across three file types:

- **`.sat`** (Skeleton Animation Template) — master animation manifest listing valid bone structures for a specific race or creature type (e.g., Human Male vs. Wookiee Male). Acts as the top-level container that names which `.skt` and `.ans` files are valid for that entity.
- **`.skt`** (Skeleton File) — stores the actual hierarchical joint transformations: bind-pose position/rotation per bone, bone-length matrices, and parent-child slot indices.
- **`.ans`** (Animation Sequence) — a compressed timeline of localised transform keys (rotations and translations) keyed to specific bone names. Animation data is completely separate from the skeleton structure.

For IFF chunk framing and `.tre` archive extraction, see [../01-core-engine/iff-and-tre.md](../01-core-engine/iff-and-tre.md). Only skeleton/animation-specific parsing is shown here.

For composite-appearance assembly (attaching `.mgn` mesh parts onto a shared skeleton), see [./meshes-and-appearances.md](./meshes-and-appearances.md).

For animation-driven audio triggers, see [./audio-and-effects.md](./audio-and-effects.md).

---

## Rigging Containers: .sat and .skt

### IFF Chunk Hierarchy (.skt)

Inside a `.tre` archive, skeleton files use the following nested IFF chunk layout:

```
FORM -> SKTM   (Skeleton Master Container)
  FORM -> BONE (Joint Structural Group)
    NAME       null-terminated ASCII bone identifier (e.g. "root", "pelvis", "spine1", "r_shoulder")
    XFRM       local bind-pose transform: position [x, y, z] + quaternion [x, y, z, w]
    INDX/PRNT  int32 parent bone index in the flat array; -1 = root node
```

---

## Skeleton Parse and Reconstruct

### C++ Structural Rigging Representation

Define native container structs matching the binary fields read from the IFF stream.

```cpp
#include <napi.h>
#include <string>
#include <vector>

struct SwgBoneJoint {
    std::string name;
    int32_t parentIndex = -1; // -1 if this joint is the absolute root node
    float localPosition[3] = {0.0f, 0.0f, 0.0f};
    float localRotation[4] = {0.0f, 0.0f, 0.0f, 1.0f}; // XYZW Quaternion
};

struct SwgSkeletonRig {
    std::string skeletonName;
    std::vector<SwgBoneJoint> joints;
};
```

### C++ Binary .skt Joint-Hierarchy Parser

```cpp
class SwgRiggingParser {
public:
    static SwgSkeletonRig ParseSkeletonForm(const uint8_t* data, size_t& offset) {
        SwgSkeletonRig rig;

        std::string formTag = TrnBinaryParser::Read4CharTag(data, offset); // "FORM"
        uint32_t formSize   = TrnBinaryParser::ReadUint32LE(data, offset);
        std::string subType = TrnBinaryParser::Read4CharTag(data, offset); // "SKTM"

        size_t endOffset = offset + formSize - 4;

        while (offset < endOffset) {
            std::string chunkTag    = TrnBinaryParser::Read4CharTag(data, offset);
            uint32_t    chunkSize   = TrnBinaryParser::ReadUint32LE(data, offset);
            size_t      nextChunkMarker = offset + chunkSize;

            if (chunkTag == "BONE") {
                uint32_t totalBones = TrnBinaryParser::ReadUint32LE(data, offset);
                rig.joints.reserve(totalBones);

                for (uint32_t i = 0; i < totalBones; ++i) {
                    SwgBoneJoint joint;

                    // 1. Unpack null-terminated joint string identifiers
                    joint.name = std::string(reinterpret_cast<const char*>(data + offset));
                    offset += joint.name.length() + 1;

                    // 2. Unpack structural parenting tracking indices
                    joint.parentIndex = static_cast<int32_t>(TrnBinaryParser::ReadUint32LE(data, offset));

                    // 3. Extract resting/bind transformation vectors (XFRM layout)
                    joint.localPosition[0] = TrnBinaryParser::ReadFloatLE(data, offset);
                    joint.localPosition[1] = TrnBinaryParser::ReadFloatLE(data, offset);
                    joint.localPosition[2] = TrnBinaryParser::ReadFloatLE(data, offset);

                    joint.localRotation[0] = TrnBinaryParser::ReadFloatLE(data, offset);
                    joint.localRotation[1] = TrnBinaryParser::ReadFloatLE(data, offset);
                    joint.localRotation[2] = TrnBinaryParser::ReadFloatLE(data, offset);
                    joint.localRotation[3] = TrnBinaryParser::ReadFloatLE(data, offset);

                    rig.joints.push_back(joint);
                }
            }
            offset = nextChunkMarker;
        }
        return rig;
    }
};
```

### Fast Buffer-Transfer Serialization to N-API

To avoid heavy nested JSON, serialize raw floating-point transforms directly into typed `Float32Array` buffers. Layout per bone: `[parentIndex, px, py, pz, qx, qy, qz, qw]` = 8 floats.

```cpp
Napi::Value UnpackRiggingToBuffers(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    Napi::ArrayBuffer inputBuffer = info[0].As<Napi::ArrayBuffer>();

    const uint8_t* rawData = static_cast<const uint8_t*>(inputBuffer.Data());
    size_t offset = 0;

    SwgSkeletonRig rig = SwgRiggingParser::ParseSkeletonForm(rawData, offset);

    // Schema mapping per bone node: [parentIndex, px, py, pz, qx, qy, qz, qw] = 8 floats per joint
    size_t attributesPerJoint = 8;
    Napi::Float32Array jsTransformBuffer = Napi::Float32Array::New(env, rig.joints.size() * attributesPerJoint);
    Napi::Array        jsNameArray       = Napi::Array::New(env, rig.joints.size());

    for (size_t i = 0; i < rig.joints.size(); ++i) {
        size_t idx         = i * attributesPerJoint;
        const auto& joint  = rig.joints[i];

        jsNameArray[i] = Napi::String::New(env, joint.name);

        jsTransformBuffer[idx]     = static_cast<float>(joint.parentIndex);
        jsTransformBuffer[idx + 1] = joint.localPosition[0];
        jsTransformBuffer[idx + 2] = joint.localPosition[1];
        jsTransformBuffer[idx + 3] = joint.localPosition[2];
        jsTransformBuffer[idx + 4] = joint.localRotation[0];
        jsTransformBuffer[idx + 5] = joint.localRotation[1];
        jsTransformBuffer[idx + 6] = joint.localRotation[2];
        jsTransformBuffer[idx + 7] = joint.localRotation[3];
    }

    Napi::Object resultContainer = Napi::Object::New(env);
    resultContainer.Set("names",      jsNameArray);
    resultContainer.Set("transforms", jsTransformBuffer);
    return resultContainer;
}
```

### Reconstructing a THREE.Skeleton in TypeScript

Consume the flat N-API payload and link indices to assemble a working `THREE.Skeleton`.

```typescript
import * as THREE from 'three';

export interface SwgJointNode {
  name: string;
  parentIndex: number;
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
}

export function buildThreeSkeletonFromNative(napiResult: any): THREE.Skeleton {
  const names: string[]        = napiResult.names;
  const transforms: Float32Array = napiResult.transforms;
  const jointCount               = names.length;

  const boneArray: THREE.Bone[] = [];

  // 1. Instantiate individual structural Bone elements
  for (let i = 0; i < jointCount; i++) {
    const idx  = i * 8;
    const bone = new THREE.Bone();
    bone.name  = names[i];

    // Assign local resting bind transform properties
    bone.position.set(transforms[idx + 1], transforms[idx + 2], transforms[idx + 3]);
    bone.quaternion.set(transforms[idx + 4], transforms[idx + 5], transforms[idx + 6], transforms[idx + 7]);

    boneArray.push(bone);
  }

  // 2. Link parenting slots sequentially to establish the scene graph tree
  for (let i = 0; i < jointCount; i++) {
    const idx         = i * 8;
    const parentIndex = Math.floor(transforms[idx]);

    if (parentIndex !== -1 && boneArray[parentIndex]) {
      boneArray[parentIndex].add(boneArray[i]); // Parenting node update
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

### IFF Chunk Hierarchy (.ans)

```
FORM -> ANST   (Animation Track Master Container)
  FORM -> CHNL (Channel Block — one per bone)
    NAME       null-terminated bone identifier string
    POSK       ordered binary array of position keys: [time, x, y, z] per entry
    ROTK       ordered binary array of rotation keys: [time, qx, qy, qz, qw] per entry
```

---

## Animation Parse and Bridge

### C++ Animation Timeline Structs

```cpp
#include <napi.h>
#include <string>
#include <vector>

struct VectorKeyframe {
    float time;
    float x, y, z;
};

struct QuaternionKeyframe {
    float time;
    float qx, qy, qz, qw;
};

struct SwgBoneChannelTrack {
    std::string boneTargetName;
    std::vector<VectorKeyframe>    positionKeys;
    std::vector<QuaternionKeyframe> rotationKeys;
};

struct SwgAnimationSequence {
    std::string animationName;
    float       totalDurationSeconds = 0.0f;
    std::vector<SwgBoneChannelTrack> boneChannels;
};
```

### C++ Binary .ans Timeline-Track Parser

```cpp
class SwgAnimationParser {
public:
    static SwgAnimationSequence ParseAnimationForm(const uint8_t* data, size_t& offset) {
        SwgAnimationSequence anim;

        std::string formTag = TrnBinaryParser::Read4CharTag(data, offset); // "FORM"
        uint32_t formSize   = TrnBinaryParser::ReadUint32LE(data, offset);
        std::string subType = TrnBinaryParser::Read4CharTag(data, offset); // "ANST"

        size_t endOffset = offset + formSize - 4;

        while (offset < endOffset) {
            std::string chunkTag        = TrnBinaryParser::Read4CharTag(data, offset);
            uint32_t    chunkSize       = TrnBinaryParser::ReadUint32LE(data, offset);
            size_t      nextChunkMarker = offset + chunkSize;

            if (chunkTag == "FORM") {
                std::string formType = TrnBinaryParser::Read4CharTag(data, offset);

                if (formType == "CHNL") {
                    SwgBoneChannelTrack channel;
                    size_t chnlEndOffset = nextChunkMarker;

                    while (offset < chnlEndOffset) {
                        std::string subChunkTag  = TrnBinaryParser::Read4CharTag(data, offset);
                        uint32_t    subChunkSize = TrnBinaryParser::ReadUint32LE(data, offset);
                        size_t      nextSubMarker = offset + subChunkSize;

                        if (subChunkTag == "NAME") {
                            channel.boneTargetName = std::string(reinterpret_cast<const char*>(data + offset));
                        }
                        else if (subChunkTag == "POSK") {
                            uint32_t keyCount = TrnBinaryParser::ReadUint32LE(data, offset);
                            channel.positionKeys.reserve(keyCount);
                            for (uint32_t k = 0; k < keyCount; ++k) {
                                float t = TrnBinaryParser::ReadFloatLE(data, offset);
                                float x = TrnBinaryParser::ReadFloatLE(data, offset);
                                float y = TrnBinaryParser::ReadFloatLE(data, offset);
                                float z = TrnBinaryParser::ReadFloatLE(data, offset);
                                channel.positionKeys.push_back({t, x, y, z});
                                anim.totalDurationSeconds = std::max(anim.totalDurationSeconds, t);
                            }
                        }
                        else if (subChunkTag == "ROTK") {
                            uint32_t keyCount = TrnBinaryParser::ReadUint32LE(data, offset);
                            channel.rotationKeys.reserve(keyCount);
                            for (uint32_t k = 0; k < keyCount; ++k) {
                                float t  = TrnBinaryParser::ReadFloatLE(data, offset);
                                float qx = TrnBinaryParser::ReadFloatLE(data, offset);
                                float qy = TrnBinaryParser::ReadFloatLE(data, offset);
                                float qz = TrnBinaryParser::ReadFloatLE(data, offset);
                                float qw = TrnBinaryParser::ReadFloatLE(data, offset);
                                channel.rotationKeys.push_back({t, qx, qy, qz, qw});
                                anim.totalDurationSeconds = std::max(anim.totalDurationSeconds, t);
                            }
                        }
                        offset = nextSubMarker;
                    }
                    anim.boneChannels.push_back(channel);
                }
            }
            offset = nextChunkMarker;
        }
        return anim;
    }
};
```

### Packing Timelines for the JS Bridge (N-API)

Compress timeline data into unrolled flat `Float32Array` buffers to avoid heavy nested array pools.
- Position keys: `[time, x, y, z]` = 4 floats per keyframe
- Rotation keys: `[time, qx, qy, qz, qw]` = 5 floats per keyframe

```cpp
Napi::Value UnpackAnimationToJsPayload(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    Napi::ArrayBuffer inputBuffer = info[0].As<Napi::ArrayBuffer>();

    const uint8_t* rawData = static_cast<const uint8_t*>(inputBuffer.Data());
    size_t offset = 0;

    SwgAnimationSequence anim = SwgAnimationParser::ParseAnimationForm(rawData, offset);

    Napi::Object jsResult = Napi::Object::New(env);
    jsResult.Set("duration", Napi::Number::New(env, anim.totalDurationSeconds));

    Napi::Array jsChannelsArray = Napi::Array::New(env, anim.boneChannels.size());

    for (size_t i = 0; i < anim.boneChannels.size(); ++i) {
        const auto& channel = anim.boneChannels[i];
        Napi::Object jsChannelObj = Napi::Object::New(env);
        jsChannelObj.Set("boneName", Napi::String::New(env, channel.boneTargetName));

        // Unroll Translation curve keys [time, x, y, z] = 4 floats per keyframe
        Napi::Float32Array posArray = Napi::Float32Array::New(env, channel.positionKeys.size() * 4);
        for (size_t k = 0; k < channel.positionKeys.size(); ++k) {
            size_t idx       = k * 4;
            posArray[idx]    = channel.positionKeys[k].time;
            posArray[idx + 1] = channel.positionKeys[k].x;
            posArray[idx + 2] = channel.positionKeys[k].y;
            posArray[idx + 3] = channel.positionKeys[k].z;
        }
        jsChannelObj.Set("positionKeys", posArray);

        // Unroll Rotation curve keys [time, qx, qy, qz, qw] = 5 floats per keyframe
        Napi::Float32Array rotArray = Napi::Float32Array::New(env, channel.rotationKeys.size() * 5);
        for (size_t k = 0; k < channel.rotationKeys.size(); ++k) {
            size_t idx       = k * 5;
            rotArray[idx]    = channel.rotationKeys[k].time;
            rotArray[idx + 1] = channel.rotationKeys[k].qx;
            rotArray[idx + 2] = channel.rotationKeys[k].qy;
            rotArray[idx + 3] = channel.rotationKeys[k].qz;
            rotArray[idx + 4] = channel.rotationKeys[k].qw;
        }
        jsChannelObj.Set("rotationKeys", rotArray);

        jsChannelsArray[i] = jsChannelObj;
    }

    jsResult.Set("channels", jsChannelsArray);
    return jsResult;
}
```

---

## AnimationClip Construction

### Compiling a THREE.AnimationClip in TypeScript

Decode the unrolled buffers and reconstruct them into `VectorKeyframeTrack` and `QuaternionKeyframeTrack` instances, then wrap them in an `AnimationClip`.

```typescript
import * as THREE from 'three';

export function buildThreeAnimationClip(napiAnimPayload: any, clipName: string): THREE.AnimationClip {
  const duration = napiAnimPayload.duration;
  const tracks: THREE.KeyframeTrack[] = [];

  for (const ch of napiAnimPayload.channels) {
    const boneName = ch.boneName;

    // 1. Process Translation curve attributes
    const posData: Float32Array = ch.positionKeys;
    if (posData.length > 0) {
      const times: number[]  = [];
      const values: number[] = [];
      for (let i = 0; i < posData.length; i += 4) {
        times.push(posData[i]);
        values.push(posData[i + 1], posData[i + 2], posData[i + 3]);
      }
      // Target reference formatting tells Three.js to affect this specific bone node's position property
      tracks.push(new THREE.VectorKeyframeTrack(`${boneName}.position`, times, values));
    }

    // 2. Process Rotation curve attributes
    const rotData: Float32Array = ch.rotationKeys;
    if (rotData.length > 0) {
      const times: number[]  = [];
      const values: number[] = [];
      for (let i = 0; i < rotData.length; i += 5) {
        times.push(rotData[i]);
        values.push(rotData[i + 1], rotData[i + 2], rotData[i + 3], rotData[i + 4]);
      }
      tracks.push(new THREE.QuaternionKeyframeTrack(`${boneName}.quaternion`, times, values));
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

## Notes

- **Multi-track blending:** Integrating `.ans` files with `THREE.AnimationMixer` enables cross-fading and interpolation between clips (e.g., blending an idle loop into a run animation without skeletal snapping). Call `mixer.clipAction(clip).crossFadeTo(otherAction, duration, true)` for smooth transitions.
- **Composite character assembly:** With the `.skt` parser in place, `.sat` manifests can drive component-based character assembly. Modders select a skeleton archetype, attach `.mgn` mesh parts (boots, armor, hair) onto shared bone targets, and verify bind weights — see [./meshes-and-appearances.md](./meshes-and-appearances.md).
- **Bind-pose accuracy:** Because this parser reads resting bind matrices directly from the raw client vectors, any bone adjustments performed in the canvas will mirror the retail client transform space precisely.
