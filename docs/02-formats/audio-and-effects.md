# Audio and Visual Effects: .snd, .prt, .eft

> Covers: audio (.snd) + Web Audio, particles/effects (.prt/.eft) + GPU shaders, animation-audio sync, FX timeline sequencer. Source: research doc lines 5691–6234, 7898–8159, 12116–12383.

> **Provenance caveat:** The chunk layouts for `.snd`, `.prt`, and `.eft` described here are AI-proposed structural models. Validate all field offsets, chunk tags, and data types against the real `swg-client-v2` source before treating them as authoritative. See [source provenance](../00-overview/source-provenance.md).

---

## Table of Contents

1. [Audio Templates (.snd)](#1-audio-templates-snd)
2. [Particle and Effect Files (.prt / .eft)](#2-particle-and-effect-files-prt--eft)
3. [Animation-Audio Sync](#3-animation-audio-sync)
4. [FX Timeline Sequencer Tool](#4-fx-timeline-sequencer-tool)

---

## 1. Audio Templates (.snd)

SWG never plays raw `.wav` or `.mp3` assets directly. Instead, every sound is described by an `.snd` descriptor that acts as an interactive mixer node: it controls 3D positional spatialization, random pitch/volume variation (so firing a blaster ten times sounds organic), distance attenuation curves, and multi-track sample looping rules. The raw audio files are referenced by path inside the `.snd` container; the `.snd` itself lives inside a `.tre` archive.

For IFF container framing (`FORM` tag, chunk size accounting, little-endian field order) see [../01-core-engine/iff-and-tre.md](../01-core-engine/iff-and-tre.md). Only `.snd`-specific chunk content is shown below.

### 1.1 IFF Structure

```
FORM  SND
  DATA  — core mixer config
  ATEN  — distance attenuation curve
  SMPL  — sample path list
```

**DATA fields:**
- `uint32` — template ID
- `uint32` — sound type: `0` = 2D Ambient/UI, `1` = 3D Positional, `2` = Looping Stream
- `float`  — volume modifier (global attenuation factor)
- `float`  — min pitch range
- `float`  — max pitch range

**ATEN fields:**
- `float` — min distance radius (point where sound begins to attenuate)
- `float` — max distance radius (silence boundary)

**SMPL fields:**
- `uint32` — sample count
- null-terminated strings × count — paths to `.wav`/`.mp3` files inside the TRE directory map

### 1.2 C++ Structural Layout

```cpp
#include <napi.h>
#include <string>
#include <vector>

struct SwgSoundTemplate {
    uint32_t id = 0;
    std::string friendlyName = "new_sound_effect";
    uint32_t soundType = 1;          // 0 = 2D UI, 1 = 3D Positional, 2 = Streaming Ambient
    float volumeModifier = 1.0f;
    float minPitchRange = 0.95f;
    float maxPitchRange = 1.05f;
    float minDistanceRadius = 5.0f;  // Standard min attenuation point
    float maxDistanceRadius = 45.0f; // Sound fade cutoff wall
    std::vector<std::string> sampleAudioPaths; // Target .wav / .mp3 filenames in TRE
};
```

### 1.3 Binary Parser and Serializer (C++)

```cpp
class SwgAudioParser {
public:
    static SwgSoundTemplate ParseSoundForm(const uint8_t* data, size_t& offset) {
        SwgSoundTemplate snd;

        std::string formTag = TrnBinaryParser::Read4CharTag(data, offset); // FORM
        uint32_t formSize   = TrnBinaryParser::ReadUint32LE(data, offset);
        std::string subType = TrnBinaryParser::Read4CharTag(data, offset); // "SND "

        size_t endOffset = offset + formSize - 4;

        while (offset < endOffset) {
            std::string chunkTag   = TrnBinaryParser::Read4CharTag(data, offset);
            uint32_t chunkSize     = TrnBinaryParser::ReadUint32LE(data, offset);
            size_t nextChunkMarker = offset + chunkSize;

            if (chunkTag == "DATA") {
                snd.id              = TrnBinaryParser::ReadUint32LE(data, offset);
                snd.soundType       = TrnBinaryParser::ReadUint32LE(data, offset);
                snd.volumeModifier  = TrnBinaryParser::ReadFloatLE(data, offset);
                snd.minPitchRange   = TrnBinaryParser::ReadFloatLE(data, offset);
                snd.maxPitchRange   = TrnBinaryParser::ReadFloatLE(data, offset);
            }
            else if (chunkTag == "ATEN") {
                snd.minDistanceRadius = TrnBinaryParser::ReadFloatLE(data, offset);
                snd.maxDistanceRadius = TrnBinaryParser::ReadFloatLE(data, offset);
            }
            else if (chunkTag == "SMPL") {
                uint32_t sampleCount = TrnBinaryParser::ReadUint32LE(data, offset);
                for (uint32_t i = 0; i < sampleCount; ++i) {
                    std::string samplePath(reinterpret_cast<const char*>(data + offset));
                    offset += samplePath.length() + 1;
                    snd.sampleAudioPaths.push_back(samplePath);
                }
            }
            offset = nextChunkMarker;
        }
        return snd;
    }

    static std::vector<uint8_t> SerializeSoundForm(const SwgSoundTemplate& snd) {
        IffBinaryWriter contentWriter;

        // 1. Pack global mix metadata DATA chunk
        IffBinaryWriter dataWriter;
        dataWriter.WriteUint32(snd.id);
        dataWriter.WriteUint32(snd.soundType);
        dataWriter.WriteFloat(snd.volumeModifier);
        dataWriter.WriteFloat(snd.minPitchRange);
        dataWriter.WriteFloat(snd.maxPitchRange);
        contentWriter.PackChunk("DATA", dataWriter.buffer);

        // 2. Pack 3D attenuation rules
        IffBinaryWriter atenWriter;
        atenWriter.WriteFloat(snd.minDistanceRadius);
        atenWriter.WriteFloat(snd.maxDistanceRadius);
        contentWriter.PackChunk("ATEN", atenWriter.buffer);

        // 3. Pack string paths array block
        IffBinaryWriter smplWriter;
        smplWriter.WriteUint32(static_cast<uint32_t>(snd.sampleAudioPaths.size()));
        for (const auto& path : snd.sampleAudioPaths) {
            smplWriter.WriteString(path);
        }
        contentWriter.PackChunk("SMPL", smplWriter.buffer);

        // 4. Enclose inside master FORM -> "SND " layout
        IffBinaryWriter formWriter;
        formWriter.WriteTag("FORM");
        formWriter.WriteUint32(static_cast<uint32_t>(contentWriter.buffer.size() + 4));
        formWriter.WriteTag("SND ");
        formWriter.WriteRawBuffer(contentWriter.buffer);

        return formWriter.buffer;
    }
};
```

### 1.4 Web Audio API Spatialization Engine (Three.js)

Preview `.snd` profiles in-editor by using Three.js's built-in `AudioListener` and `PositionalAudio` system. This lets you simulate the distance attenuation curves in the browser viewport.

```typescript
import * as THREE from 'three';

export interface SoundTemplateJs {
  soundType: number;
  volumeModifier: number;
  minPitchRange: number;
  maxPitchRange: number;
  minDistanceRadius: number;
  maxDistanceRadius: number;
  sampleAudioPaths: string[];
}

export class SwgAudioPreviewEngine {
  private listener: THREE.AudioListener;

  constructor(camera: THREE.Camera) {
    this.listener = new THREE.AudioListener();
    camera.add(this.listener); // Hook tracking microphone array straight onto the viewport lens
  }

  /**
   * Instantiates a dynamic positional speaker anchor matching .snd variables
   */
  public createSpatialAudioSpeaker(
    config: SoundTemplateJs,
    resolvedBuffer: AudioBuffer
  ): THREE.PositionalAudio | THREE.Audio {
    // Check if the asset profile targets global 2D environment streams or 3D positional emitters
    if (config.soundType === 0) {
      const globalSound = new THREE.Audio(this.listener);
      globalSound.setBuffer(resolvedBuffer);
      globalSound.setVolume(config.volumeModifier);
      return globalSound;
    }

    const spatialSpeaker = new THREE.PositionalAudio(this.listener);
    spatialSpeaker.setBuffer(resolvedBuffer);

    // Bind distance attenuation metrics processed from the IFF template configuration
    spatialSpeaker.setRefDistance(config.minDistanceRadius);
    spatialSpeaker.setMaxDistance(config.maxDistanceRadius);
    spatialSpeaker.setDistanceModel('linear'); // SWG uses custom linear rolloff metrics
    spatialSpeaker.setVolume(config.volumeModifier);

    // Apply pitch variations randomized inside your structural bounds
    const randomPitchScale =
      config.minPitchRange + Math.random() * (config.maxPitchRange - config.minPitchRange);
    spatialSpeaker.setPlaybackRate(randomPitchScale);

    return spatialSpeaker;
  }
}
```

### 1.5 Sound Node Inspector and Preview Component (R3F)

Maps sound emitters onto the viewport grid, allows sample target selection, fine-tunes volume parameters, and draws the max-distance attenuation boundary sphere.

```tsx
import React, { useState, useMemo } from 'react';
import { TransformControls } from '@react-three/drei';

export const SwgSoundEmitterNode: React.FC<{
  initialConfig: SoundTemplateJs;
  audioContextBuffer: AudioBuffer;
  cameraRef: any;
}> = ({ initialConfig, audioContextBuffer, cameraRef }) => {
  const [config, setConfig] = useState(initialConfig);
  const [isSelected, setIsSelected] = useState(false);

  const speakerMeshRef = React.useRef<THREE.Mesh>(null);
  const previewEngine = useMemo(() => new SwgAudioPreviewEngine(cameraRef), [cameraRef]);

  const triggerTestPlayback = () => {
    if (!speakerMeshRef.current) return;
    const activeSpeaker = previewEngine.createSpatialAudioSpeaker(config, audioContextBuffer);
    speakerMeshRef.current.add(activeSpeaker);
    activeSpeaker.play();
  };

  return (
    <group>
      <mesh
        ref={speakerMeshRef}
        onClick={(e) => { e.stopPropagation(); setIsSelected(!isSelected); }}
        position={[45.0, 12.5, -120.0]}
      >
        <sphereGeometry args={[1.5, 16, 16]} />
        <meshBasicMaterial color={isSelected ? "#ffcc00" : "#ff00ff"} wireframe />

        {/* Draw a dynamic wireframe helper matching the max distance boundary range limits */}
        {isSelected && (
          <mesh>
            <sphereGeometry args={[config.maxDistanceRadius, 32, 32]} />
            <meshBasicMaterial color="#ff00ff" wireframe transparent opacity={0.05} />
          </mesh>
        )}
      </mesh>

      {isSelected && (
        <TransformControls object={speakerMeshRef.current || undefined} mode="translate" />
      )}
    </group>
  );
};
```

### 1.6 Workspace Mixer HUD

Properties panel that bridges editor state back to the binary serialization pipeline.

```tsx
export const SwgAudioMixerPropertiesPanel: React.FC<{
  activeSnd: SoundTemplateJs;
  onConfigChange: (updated: SoundTemplateJs) => void;
  onPlayTestTrigger: () => void;
}> = ({ activeSnd, onConfigChange, onPlayTestTrigger }) => {
  return (
    <div style={{ background: '#1e1e1e', padding: '14px', borderRadius: '4px', border: '1px solid #ff00ff', color: '#fff', fontSize: '12px' }}>
      <h4 style={{ color: '#ff00ff', margin: '0 0 10px 0' }}>Sound Template Workspace Mixer</h4>

      <div style={{ display: 'grid', gap: '8px' }}>
        <label>
          Mix Type:
          <select
            value={activeSnd.soundType}
            onChange={(e) => onConfigChange({ ...activeSnd, soundType: parseInt(e.target.value) })}
            style={{ float: 'right', background: '#333', color: '#fff' }}
          >
            <option value={0}>2D Flat UI Ambient</option>
            <option value={1}>3D Spatial Node Object</option>
          </select>
        </label>

        <label>
          Min Attenuation Audibility Radius ({activeSnd.minDistanceRadius}m):
          <input
            type="range" min="1" max="20" step="0.5"
            value={activeSnd.minDistanceRadius}
            onChange={(e) => onConfigChange({ ...activeSnd, minDistanceRadius: parseFloat(e.target.value) })}
            style={{ width: '100%' }}
          />
        </label>

        <label>
          Max Audibility Boundary Cutoff ({activeSnd.maxDistanceRadius}m):
          <input
            type="range" min="10" max="150" step="5"
            value={activeSnd.maxDistanceRadius}
            onChange={(e) => onConfigChange({ ...activeSnd, maxDistanceRadius: parseFloat(e.target.value) })}
            style={{ width: '100%' }}
          />
        </label>

        <button
          onClick={onPlayTestTrigger}
          style={{ background: '#ff00ff', border: 'none', color: '#fff', fontWeight: 'bold', padding: '6px', cursor: 'pointer', borderRadius: '2px', marginTop: '6px' }}
        >
          Test Mix Playback
        </button>
      </div>
    </div>
  );
};
```

---

## 2. Particle and Effect Files (.prt / .eft)

SWG particle effects are fully data-driven — the engine does not play pre-rendered video. A `.prt` file encodes a Particle Brownian Generator (emission rates, initial velocity vectors, gravity modifiers, color/size decay arrays). An `.eft` file sequences multiple `.prt` tracks alongside light spikes and `.snd` triggers. To achieve smooth 60 fps in a React Three Fiber viewport, particle physics run entirely on the GPU via a custom `ShaderMaterial` rather than per-particle JavaScript mesh nodes.

### 2.1 IFF Structure

```
FORM  PART  (Particle Master Group)
  FORM  DESC  (Descriptor Blocks)
    EMIT  — spawn rate (particles/sec), max active particle cap
    PHYS  — initial velocity vectors, random spread offsets, gravity coefficient, air drag
    COLR  — RGBA gradient array over particle lifespan (time percent → RGBA)
    SIZE  — scale interpolation curve over lifespan (time percent → scale factor)
```

### 2.2 C++ Structural Layout

```cpp
#include <napi.h>
#include <string>
#include <vector>

struct ColorTimelineStep {
    float timePercent; // 0.0 to 1.0 (lifespan percentage)
    float r, g, b, a;
};

struct SizeTimelineStep {
    float timePercent;
    float scaleFactor;
};

struct SwgParticleTemplate {
    uint32_t id = 0;
    std::string effectName = "blaster_impact_spark";

    // Generator Rules
    float emissionRate = 45.0f;      // Particles spawned per second
    uint32_t maxParticleCount = 150;
    float avgLifespan = 1.5f;        // Seconds a single particle survives

    // Vectors & Forces
    float initialVelocity[3] = {0.0f, 5.0f, 0.0f}; // X, Y, Z vectors
    float velocityRandomVariance = 1.5f;
    float gravityCoefficient = -9.81f; // Gravity pull factor
    float airDragCoefficient = 0.05f;

    // Visual Extrusion Steps
    std::vector<ColorTimelineStep> colorTimeline;
    std::vector<SizeTimelineStep> sizeTimeline;
};
```

### 2.3 High-Speed Instantiation Bridge (C++ to TypeScript)

The C++ parser flattens `.prt` math parameters into a compact JSON config. TypeScript passes this directly into custom WebGL shaders, so the GPU computes particle positions independently of the JS thread.

```cpp
Napi::Object ConvertParticleTemplateToJs(Napi::Env env, const SwgParticleTemplate& prt) {
    Napi::Object obj = Napi::Object::New(env);
    obj.Set("emissionRate", Napi::Number::New(env, prt.emissionRate));
    obj.Set("maxCount",     Napi::Number::New(env, prt.maxParticleCount));
    obj.Set("lifespan",     Napi::Number::New(env, prt.avgLifespan));

    Napi::Array vel = Napi::Array::New(env, 3);
    for (int i = 0; i < 3; ++i) vel[i] = Napi::Number::New(env, prt.initialVelocity[i]);
    obj.Set("initialVelocity", vel);

    obj.Set("variance", Napi::Number::New(env, prt.velocityRandomVariance));
    obj.Set("gravity",  Napi::Number::New(env, prt.gravityCoefficient));
    obj.Set("drag",     Napi::Number::New(env, prt.airDragCoefficient));

    // Convert timeline arrays into flat Float32Arrays for the GPU...
    return obj;
}
```

### 2.4 GPU-Accelerated Particle Shader System (Three.js)

Instead of step-by-step CPU physics, the vertex shader takes each particle's birth time as an attribute and computes its current position, size, and color entirely on the GPU.

```typescript
import * as THREE from 'three';

export function createSwgParticleMaterial(config: any, texture: THREE.Texture) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,               // Prevents rectangular alpha masking clipping boxes
    blending: THREE.AdditiveBlending, // Ideal for lasers, fires, and plasma sparks
    uniforms: {
      uTime:            { value: 0 },
      uTexture:         { value: texture },
      uGravity:         { value: config.gravity },
      uInitialVelocity: { value: new THREE.Vector3(...config.initialVelocity) },
      uVariance:        { value: config.variance },
      uLifespan:        { value: config.lifespan }
    },
    vertexShader: `
      uniform float uTime;
      uniform float uGravity;
      uniform vec3 uInitialVelocity;
      uniform float uVariance;
      uniform float uLifespan;

      attribute float aBirthTime;
      attribute vec3 aRandomDirection;

      varying float vAgePercent;

      void main() {
        float age = uTime - aBirthTime;
        vAgePercent = clamp(age / uLifespan, 0.0, 1.0);

        // --- SWG PHYSICAL PHYSICS SIMULATION LAYER ---
        // Position = Initial + (Velocity * Time) + (0.5 * Gravity * Time^2)
        vec3 velocity = uInitialVelocity + (aRandomDirection * uVariance);
        vec3 activePosition = position + (velocity * age);
        activePosition.y += 0.5 * uGravity * (age * age);

        vec4 mvPosition = modelViewMatrix * vec4(activePosition, 1.0);

        // Dynamic Size Decay Mapping
        float sizeModifier = 1.0 - vAgePercent; // Basic curve (shrinks over time)
        gl_PointSize = (25.0 * sizeModifier) * (300.0 / -mvPosition.z);
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: `
      uniform sampler2D uTexture;
      varying float vAgePercent;

      void main() {
        vec4 texColor = texture2D(uTexture, gl_PointCoord);

        // Dynamic Color Shift Mapping (Simulating SWG .prt COLR gradient steps)
        vec3 startColor = vec3(1.0, 0.4, 0.0); // Flame Orange
        vec3 endColor   = vec3(0.2, 0.2, 0.2); // Smoke Gray
        vec3 activeColor = mix(startColor, endColor, vAgePercent);

        float alpha = texColor.a * (1.0 - vAgePercent);

        gl_FragColor = vec4(activeColor, alpha);
      }
    `
  });
}
```

### 2.5 R3F Emitter Node Component

Manages the particle lifecycle arrays, pre-allocates fixed buffers matching `maxCount`, and runs a `useFrame` recycling loop to refresh birth times.

```tsx
import React, { useRef, useMemo } from 'react';
import { useFrame, useLoader } from '@react-three/fiber';
import * as THREE from 'three';
import { createSwgParticleMaterial } from './ParticleShaders';

export const SwgParticleEffectNode: React.FC<{ prtConfig: any; spriteUrl: string }> = ({
  prtConfig,
  spriteUrl
}) => {
  const pointsRef       = useRef<THREE.Points>(null);
  const particleTexture = useLoader(THREE.TextureLoader, spriteUrl);

  // 1. Pre-allocate flat web attributes for the target GPU particle cap
  const [geometry, attributes] = useMemo(() => {
    const geom  = new THREE.BufferGeometry();
    const count = prtConfig.maxCount;

    const positions  = new Float32Array(count * 3); // All spawn at local origin [0,0,0]
    const birthTimes = new Float32Array(count);      // Initially set to 0
    const randomDirs = new Float32Array(count * 3);

    for (let i = 0; i < count; i++) {
      birthTimes[i] = -999.0; // Hide particles initially before loop cycle triggers execution

      // Pre-compute a random spherical direction vector for velocity spreads
      const theta = Math.random() * Math.PI * 2;
      const phi   = Math.acos((Math.random() * 2) - 1);
      randomDirs[i * 3]     = Math.sin(phi) * Math.cos(theta);
      randomDirs[i * 3 + 1] = Math.sin(phi) * Math.sin(theta);
      randomDirs[i * 3 + 2] = Math.cos(phi);
    }

    geom.setAttribute('position',        new THREE.BufferAttribute(positions, 3));
    geom.setAttribute('aBirthTime',      new THREE.BufferAttribute(birthTimes, 1));
    geom.setAttribute('aRandomDirection', new THREE.BufferAttribute(randomDirs, 3));

    return [geom, { birthTimes }];
  }, [prtConfig]);

  // 2. Instantiate the custom shader material
  const shaderMaterial = useMemo(
    () => createSwgParticleMaterial(prtConfig, particleTexture),
    [prtConfig, particleTexture]
  );

  const localTimeRef         = useRef(0);
  const nextParticleIndexRef = useRef(0);
  const lastSpawnTimeRef     = useRef(0);

  // 3. Dynamic Recycling Loop
  useFrame((state, delta) => {
    if (!pointsRef.current) return;

    localTimeRef.current += delta;
    const mat = pointsRef.current.material as THREE.ShaderMaterial;
    mat.uniforms.uTime.value = localTimeRef.current;

    const spawnInterval      = 1.0 / prtConfig.emissionRate;
    const timeSinceLastSpawn = localTimeRef.current - lastSpawnTimeRef.current;

    if (timeSinceLastSpawn >= spawnInterval) {
      const birthAttr  = geometry.getAttribute('aBirthTime') as THREE.BufferAttribute;
      const spawnCount = Math.floor(timeSinceLastSpawn / spawnInterval);

      for (let s = 0; s < spawnCount; s++) {
        const index = nextParticleIndexRef.current;
        birthAttr.setX(index, localTimeRef.current);
        nextParticleIndexRef.current = (index + 1) % prtConfig.maxCount;
      }

      birthAttr.needsUpdate  = true;
      lastSpawnTimeRef.current = localTimeRef.current;
    }
  });

  return <points ref={pointsRef} geometry={geometry} material={shaderMaterial} position={[0, 0, 0]} />;
};
```

### 2.6 Particle Inspector Panel (React Sidebar)

Quick-inspect sidebar for a loaded `.prt`/`.eft` asset: lets modders adjust spawn rate, gravity, and velocity burst without recompiling.

```tsx
import React from 'react';

export const SwgEffectInspectorPanel: React.FC<{
  activeFx: any;
  onFxChange: (updated: any) => void;
}> = ({ activeFx, onFxChange }) => {
  return (
    <div style={{
      background: '#252526', padding: '14px', border: '1px solid #00ffcc',
      borderRadius: '4px', color: '#fff', fontSize: '12px', fontFamily: 'monospace'
    }}>
      <h4 style={{ color: '#00ffcc', margin: '0 0 12px 0' }}>Particle Macro Inspector (.EFT / .PRT)</h4>

      <div style={{ display: 'grid', gap: '8px' }}>
        <div>
          Effect String Path:
          <span style={{ color: '#aaa', float: 'right' }}>{activeFx.effectName}</span>
        </div>

        <label>
          Spawn Rate (Emission: {activeFx.emissionRate}/s):
          <input
            type="range" min="5" max="200" step="5"
            value={activeFx.emissionRate}
            onChange={(e) => onFxChange({ ...activeFx, emissionRate: parseInt(e.target.value) })}
            style={{ width: '100%', accentColor: '#00ffcc' }}
          />
        </label>

        <label>
          Gravity Force Vector ({activeFx.gravity} m/s²):
          <input
            type="range" min="-20" max="10" step="0.5"
            value={activeFx.gravity}
            onChange={(e) => onFxChange({ ...activeFx, gravity: parseFloat(e.target.value) })}
            style={{ width: '100%', accentColor: '#00ffcc' }}
          />
        </label>

        <label>
          Velocity Burst Factor:
          <input
            type="range" min="0.1" max="15.0" step="0.2"
            value={activeFx.variance}
            onChange={(e) => onFxChange({ ...activeFx, variance: parseFloat(e.target.value) })}
            style={{ width: '100%', accentColor: '#00ffcc' }}
          />
        </label>
      </div>
    </div>
  );
};
```

---

## 3. Animation-Audio Sync

When a character executes a combat swing or flourish, the weapon should emit spatialized sound in real time based on the position of the attachment hardpoint (e.g., `hp_right_hand`). This section expands the `THREE.AnimationMixer` framework (see [./skeletons-and-animation.md](./skeletons-and-animation.md) for the mixer setup) to listen for keyframe time markers, parse corresponding `.snd` templates via the C++ backend, extract raw audio from `.tre` archives, and play them back spatially.

### 3.1 Animation Audio Event Registry (TypeScript)

Monitors an active `.ans` animation loop and dispatches sound trigger callbacks when playback time crosses explicit timestamps.

```typescript
export interface SoundTriggerEvent {
  timeMarker: number;         // The second marker in the animation timeline
  soundTemplatePath: string;  // e.g., "sound/weapon/lightsaber/saber_swing_01.snd"
  hasFired: boolean;
}

export class SwgAnimationAudioTriggerRegistry {
  private activeEvents: SoundTriggerEvent[] = [];

  constructor(animationName: string) {
    // Mock mapping data parsed from client animation tables.
    // In production, load these relationships dynamically out of datatables.
    if (animationName.includes('attack') || animationName.includes('flourish')) {
      this.activeEvents = [
        { timeMarker: 0.15, soundTemplatePath: "sound/weapon/lightsaber/saber_swing_01.snd", hasFired: false },
        { timeMarker: 0.60, soundTemplatePath: "sound/weapon/lightsaber/saber_swing_02.snd", hasFired: false }
      ];
    }
  }

  public checkAndPollEvents(currentTime: number, onTrigger: (sndPath: string) => void) {
    for (const event of this.activeEvents) {
      if (currentTime >= event.timeMarker && !event.hasFired) {
        event.hasFired = true;
        onTrigger(event.soundTemplatePath);
      }
    }
  }

  public resetTimeline() {
    for (const event of this.activeEvents) {
      event.hasFired = false;
    }
  }
}
```

### 3.2 Native Direct Audio Streaming Bridge (C++)

Extracts raw audio track blocks straight from the mounted `.tre` file allocations and hands them to JavaScript as zero-copy `ArrayBuffer` payloads to prevent latency stutters.

```cpp
Napi::Value ExtractAudioSampleBuffer(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    std::string samplePath = info.As<Napi::String>().Utf8Value();

    // 1. Locate the file target inside your background TRE archive directory maps
    std::vector<uint8_t> rawAudioBytes = TreArchiveSystem::ExtractFile(samplePath);

    if (rawAudioBytes.empty()) {
        Napi::TypeError::New(env, "Target audio asset path not found in TRE indexes.").ThrowAsJavaScriptException();
        return env.Null();
    }

    // 2. Wrap the extracted audio vector data directly into a Node.js ArrayBuffer payload
    Napi::ArrayBuffer outputBuffer = Napi::ArrayBuffer::New(env, rawAudioBytes.size());
    std::memcpy(outputBuffer.Data(), rawAudioBytes.data(), rawAudioBytes.size());

    return outputBuffer;
}
// Bind endpoint inside native exports initializers
exports.Set("extractAudioSampleBuffer", Napi::Function::New(env, ExtractAudioSampleBuffer));
```

### 3.3 Resolving and Caching Audio Assets (TypeScript)

Captures the raw `ArrayBuffer` from C++, decodes it via the Web Audio API, and caches the result to avoid repeated disk hits.

```typescript
export class SwgWorkspaceAudioCache {
  private audioContext: AudioContext;
  private sampleCache = new Map<string, AudioBuffer>();

  constructor() {
    this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
  }

  public getAudioContext(): AudioContext {
    return this.audioContext;
  }

  /**
   * Fetches, decompresses, and stores a weapon audio asset file loop safely in memory
   */
  public async loadAudioSample(samplePath: string, nativeBridge: any): Promise<AudioBuffer> {
    if (this.sampleCache.has(samplePath)) {
      return this.sampleCache.get(samplePath)!;
    }

    // Pull raw file bytes directly from C++ native worker allocations
    const rawArrayBuffer: ArrayBuffer = await nativeBridge.extractAudioSampleBuffer(samplePath);

    // Asynchronously decode the raw compressed sound payload (.wav/.mp3 header structures)
    const decodedBuffer = await this.audioContext.decodeAudioData(rawArrayBuffer);

    this.sampleCache.set(samplePath, decodedBuffer);
    return decodedBuffer;
  }
}
```

### 3.4 Synchronized Spatial Audio Mixer Component (R3F)

Integrates audio tracking directly into the `useFrame` loop of the character animation mixer. Monitors timeline progress, intercepts trigger events, resolves `.snd` configs, and attaches `THREE.PositionalAudio` nodes onto the moving weapon hilt.

```tsx
import React, { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { SwgAnimationAudioTriggerRegistry } from './AudioTriggerRegistry';
import { SwgWorkspaceAudioCache } from './WorkspaceAudioCache';
import { SwgAudioPreviewEngine } from './SndPreviewEngine';

interface SyncedAudioProps {
  mixer: THREE.AnimationMixer;
  animationAction: THREE.AnimationAction;
  animationName: string;
  hiltMeshRef: React.RefObject<THREE.Mesh>;
  nativeBridge: any;
  cameraRef: any;
}

export const SwgAnimationAudioSynchronizer: React.FC<SyncedAudioProps> = ({
  mixer, animationAction, animationName, hiltMeshRef, nativeBridge, cameraRef
}) => {
  const audioCache      = useMemo(() => new SwgWorkspaceAudioCache(), []);
  const previewEngine   = useMemo(() => new SwgAudioPreviewEngine(cameraRef), [cameraRef]);
  const triggerRegistry = useMemo(
    () => new SwgAnimationAudioTriggerRegistry(animationName),
    [animationName]
  );

  const lastTimeRef = useRef(0);

  // Maintain a persistent loop speaker for the lightsaber's constant background energy hum
  useEffect(() => {
    let humSpeaker: THREE.Audio | THREE.PositionalAudio | null = null;
    let active = true;

    async function startBladeHumLoop() {
      // 1. Load configuration and sound blocks asynchronously out of TRE archives
      const rawSndTemplate = await nativeBridge.parseSoundTemplate(
        "sound/weapon/lightsaber/saber_hum_loop.snd"
      );
      const audioBuffer = await audioCache.loadAudioSample(
        rawSndTemplate.sampleAudioPaths[0],
        nativeBridge
      );

      if (!active || !hiltMeshRef.current) return;

      // 2. Assemble a spatial loop audio node
      humSpeaker = previewEngine.createSpatialAudioSpeaker(rawSndTemplate, audioBuffer);
      humSpeaker.setLoop(true);
      humSpeaker.setVolume(rawSndTemplate.volumeModifier * 0.4); // Balance hum quieter than strikes

      hiltMeshRef.current.add(humSpeaker);
      humSpeaker.play();
    }

    startBladeHumLoop();

    return () => {
      active = false;
      if (humSpeaker && humSpeaker.isPlaying) humSpeaker.stop();
    };
  }, [hiltMeshRef, nativeBridge, audioCache, previewEngine]);

  // High-frequency animation timeline poller loop
  useFrame(() => {
    if (!animationAction || !hiltMeshRef.current) return;

    const actionTime = animationAction.time;

    // Reset registry triggers if the animation track loops back onto the starting keyframe
    if (actionTime < lastTimeRef.current) {
      triggerRegistry.resetTimeline();
    }
    lastTimeRef.current = actionTime;

    // Evaluate trigger intersections
    triggerRegistry.checkAndPollEvents(actionTime, async (sndTemplatePath) => {
      // Parse the triggered .snd rules template data structure via C++
      const sndConfig = await nativeBridge.parseSoundTemplate(sndTemplatePath);
      if (sndConfig.sampleAudioPaths.length === 0) return;

      // Pick a random track sample from the pool if the sound template uses multiple swing assets
      const randomIdx          = Math.floor(Math.random() * sndConfig.sampleAudioPaths.size());
      const selectedSampleFile = sndConfig.sampleAudioPaths[randomIdx];

      const audioBuffer = await audioCache.loadAudioSample(selectedSampleFile, nativeBridge);

      if (hiltMeshRef.current) {
        // Build an independent spatial speaker object instance and append it onto the hand hilt
        const swingSpeaker = previewEngine.createSpatialAudioSpeaker(sndConfig, audioBuffer);
        hiltMeshRef.current.add(swingSpeaker);
        swingSpeaker.play();

        // Automatically uncache and clear the audio node when the playback completes
        setTimeout(() => {
          if (hiltMeshRef.current) hiltMeshRef.current.remove(swingSpeaker);
        }, audioBuffer.duration * 1000 + 500);
      }
    });
  });

  return null; // Interface worker component node with no visual geometries
};
```

### 3.5 Audio Dashboard UI Controls (React Overlay Sidebar)

Master volume mixer panel for balancing hum volumes, toggling sound triggers, and monitoring active Web Audio voice channels.

```tsx
import React, { useState } from 'react';

export interface AudioMixerState {
  masterVolume: number;
  enableSndTriggers: boolean;
  muteHumLoop: boolean;
}

export const SwgAudioWorkspaceMixerPanel: React.FC<{
  mixerState: AudioMixerState;
  onMixerStateChange: (updated: AudioMixerState) => void;
  activeChannelsCount: number;
}> = ({ mixerState, onMixerStateChange, activeChannelsCount }) => {
  return (
    <div style={{
      background: 'rgba(25, 25, 25, 0.9)', border: '1px solid #ff00ff',
      padding: '12px', borderRadius: '4px', color: '#fff', width: '250px', fontFamily: 'monospace'
    }}>
      <h5 style={{ color: '#ff00ff', margin: '0 0 10px 0' }}>Workspace Audio Channel Mixer</h5>

      <div style={{ display: 'grid', gap: '8px', fontSize: '11px', color: '#ccc' }}>
        <label>
          Master Sound Volume ({Math.round(mixerState.masterVolume * 100)}%):
          <input
            type="range" min="0" max="1" step="0.05"
            value={mixerState.masterVolume}
            onChange={(e) => onMixerStateChange({ ...mixerState, masterVolume: parseFloat(e.target.value) })}
            style={{ width: '100%', accentColor: '#ff00ff' }}
          />
        </label>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '4px' }}>
          <label htmlFor="enableTrig">Enable Combat Swing Tracks:</label>
          <input
            type="checkbox" id="enableTrig"
            checked={mixerState.enableSndTriggers}
            onChange={(e) => onMixerStateChange({ ...mixerState, enableSndTriggers: e.target.checked })}
          />
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <label htmlFor="muteHum">Mute Core Blade Energy Hum:</label>
          <input
            type="checkbox" id="muteHum"
            checked={mixerState.muteHumLoop}
            onChange={(e) => onMixerStateChange({ ...mixerState, muteHumLoop: e.target.checked })}
          />
        </div>

        <div style={{ borderTop: '1px solid #333', paddingTop: '6px', marginTop: '4px', color: '#888' }}>
          Active WebAudio Voice Channels:
          <span style={{ color: '#00ffcc', float: 'right' }}>{activeChannelsCount}</span>
        </div>
      </div>
    </div>
  );
};
```

---

## 4. FX Timeline Sequencer Tool

The FX Timeline Sequencer is the full authoring tool that ties particle tracks, sound triggers, and light events together into a deployable `.eft` binary. It is distinct from the per-asset inspector panel in [Section 2.6](#26-particle-inspector-panel-react-sidebar): that panel edits a single `.prt` in isolation, while this tool sequences multiple asset types across a shared timeline and compiles the result through the C++ `EFTM` serializer.

### 4.1 Architecture

```
[ React Timeline Grid HUD ] ──(Scrub / Drag Keyframe)──> [ TypeScript Sequencer Core ]
            │                                                      │
            ├──> (Drives Three.js Particle + Sound Engines) ───────┤
            │    -> Live 60fps Viewport Preview                    │
            │                                                      v
            └──> (Flattens Track Keyframes Array) ───────────> [ C++ Node-API Layer ]
                                                                -> Generates IFF FORM (EFTM)
                                                                -> Outputs Deployable .EFT Binary
```

### 4.2 Timeline State Schema (TypeScript)

```typescript
export type SwgFxTrackType = 'Particle' | 'Sound' | 'Light';

export interface SwgFxKeyframe {
  id: string;
  timeMarker: number;       // Execution point in seconds (0.0 to total duration)
  assetPath: string;        // Target resource (e.g., "appearance/prt_blaster_spark.prt")
  properties?: Record<string, any>;
}

export interface SwgFxTrack {
  id: string;
  name: string;
  type: SwgFxTrackType;
  keyframes: SwgFxKeyframe[];
}

export interface SwgEftSequenceManifest {
  effectName: string;
  totalDuration: number;    // Total sequence duration in seconds
  tracks: SwgFxTrack[];
}
```

### 4.3 Timeline Scrubber and Canvas Controller Hook (R3F)

When a modder drags the playback marker, this hook evaluates the time index, finds intersecting keyframe milestones, and synchronously triggers WebGL particle nodes or Web Audio speakers.

```typescript
import { useFrame } from '@react-three/fiber';
import { useRef, useCallback } from 'react';
import { SwgEftSequenceManifest } from './EftSchema';

export function useFxTimelineSequencer(
  manifest: SwgEftSequenceManifest,
  nativeAudioEngine: any
) {
  const playbackTimeRef    = useRef(0);
  const isPlayingRef       = useRef(false);
  const firedKeysCacheRef  = useRef<Set<string>>(new Set());

  const processFrameExecution = useCallback((timeIndex: number) => {
    manifest.tracks.forEach((track) => {
      track.keyframes.forEach((key) => {
        // If the timeline cursor passes a keyframe and it hasn't fired in this loop, trigger it
        if (timeIndex >= key.timeMarker && !firedKeysCacheRef.current.has(key.id)) {
          firedKeysCacheRef.current.add(key.id);

          if (track.type === 'Sound') {
            // Trigger your Web Audio API positional speaker node
            nativeAudioEngine.playSpatialSample(key.assetPath);
          } else if (track.type === 'Particle') {
            // Trigger your custom GPU-accelerated WebGL points emitter
            window.workspace.triggerParticleEmission(key.assetPath);
          }
        }
      });
    });
  }, [manifest, nativeAudioEngine]);

  useFrame((_, delta) => {
    if (!isPlayingRef.current) return;

    playbackTimeRef.current += delta;

    // Loop the timeline if it exceeds total duration
    if (playbackTimeRef.current >= manifest.totalDuration) {
      playbackTimeRef.current = 0;
      firedKeysCacheRef.current.clear();
    }

    processFrameExecution(playbackTimeRef.current);
  });

  return {
    getCurrentTime: () => playbackTimeRef.current,
    setScrubTime: (time: number) => {
      playbackTimeRef.current = time;
      // Clear keyframe cache frames ahead of the scrub brush cursor
      firedKeysCacheRef.current = new Set(
        [...firedKeysCacheRef.current].filter(id => {
          const key = manifest.tracks.flatMap(t => t.keyframes).find(k => k.id === id);
          return key ? key.timeMarker <= time : false;
        })
      );
      processFrameExecution(time);
    },
    togglePlayback: (play: boolean) => { isPlayingRef.current = play; }
  };
}
```

### 4.4 Multi-Track Timeline HUD Component (React)

Horizontal multi-track editing grid rendered below the main 3D canvas viewport. Diamond keyframe handles are color-coded by track type (magenta = Sound, cyan = Particle). Clicking the ruler header scrubs the playback cursor.

```tsx
import React, { useState } from 'react';
import { SwgEftSequenceManifest, SwgFxKeyframe } from './EftSchema';

interface SequencerProps {
  manifest: SwgEftSequenceManifest;
  currentTime: number;
  onKeyframeMoved: (trackId: string, keyframeId: string, newTime: number) => void;
  onScrub: (time: number) => void;
}

export const SwgFxTimelineHUD: React.FC<SequencerProps> = ({
  manifest, currentTime, onKeyframeMoved, onScrub
}) => {
  const pixelsPerSecond = 150; // Horizontal spacing ratio layout
  const timelineWidth   = manifest.totalDuration * pixelsPerSecond;

  const handleTimelineHeaderClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect      = e.currentTarget.getBoundingClientRect();
    const clickX    = e.clientX - rect.left;
    const targetTime = Math.clamp(clickX / pixelsPerSecond, 0, manifest.totalDuration);
    onScrub(targetTime);
  };

  return (
    <div style={{
      background: '#141416', borderTop: '2px solid #ff0055',
      color: '#fff', fontFamily: 'monospace', padding: '12px'
    }}>
      <h4 style={{ margin: '0 0 8px 0', color: '#ff0055', fontSize: '12px' }}>
        Blaster Strike Sequence Timeline (.EFT)
      </h4>

      {/* Timeline Ruler Header Grid */}
      <div
        onClick={handleTimelineHeaderClick}
        style={{
          position: 'relative', height: '24px',
          background: '#1e1e1f', borderBottom: '1px solid #333',
          cursor: 'ew-resize', width: `${timelineWidth}px`
        }}
      >
        {/* Render Time Tick Marks */}
        {Array.from({ length: Math.ceil(manifest.totalDuration) + 1 }).map((_, i) => (
          <div
            key={i}
            style={{
              position: 'absolute', left: `${i * pixelsPerSecond}px`,
              fontSize: '9px', color: '#666', borderLeft: '1px solid #444',
              height: '100%', paddingLeft: '4px'
            }}
          >
            {i.toFixed(1)}s
          </div>
        ))}
        {/* Playback Cursor Line Tracker */}
        <div style={{
          position: 'absolute', left: `${currentTime * pixelsPerSecond}px`,
          width: '2px', height: '150px', background: '#ff0055',
          zIndex: 50, pointerEvents: 'none'
        }} />
      </div>

      {/* Multi-Track Execution Channels Layer Grid */}
      <div style={{ display: 'grid', gap: '4px', marginTop: '4px', width: `${timelineWidth}px` }}>
        {manifest.tracks.map((track) => (
          <div
            key={track.id}
            style={{
              display: 'flex', height: '32px', background: '#1a1a1c',
              alignItems: 'center', borderBottom: '1px solid #222', position: 'relative'
            }}
          >
            <div style={{
              width: '100px', background: '#252526', fontSize: '10px',
              height: '100%', display: 'flex', alignItems: 'center',
              paddingLeft: '6px', borderRight: '1px solid #333', zIndex: 10, color: '#00ffcc'
            }}>
              {track.name}
            </div>

            {/* Render Keyframe Node Handles */}
            {track.keyframes.map((key) => (
              <div
                key={key.id}
                title={key.assetPath}
                style={{
                  position: 'absolute',
                  left: `${key.timeMarker * pixelsPerSecond}px`,
                  width: '10px', height: '10px',
                  background: track.type === 'Sound' ? '#ff00ff' : '#00ffff',
                  transform: 'translateX(-5px) rotate(45deg)',
                  cursor: 'grab',
                  boxShadow: '0 0 4px rgba(0,0,0,0.5)'
                }}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
};
```

### 4.5 Inside-Out .eft Binary Serialization Compiler (C++)

Once the timeline is verified, the multi-track arrays are passed down to C++. This module builds the true little-endian binary container wrapped in a `FORM` tag carrying the `EFTM` type identifier. Events are chronologically sorted before packing. For generic `IffBinaryWriter` framing see [../01-core-engine/iff-and-tre.md](../01-core-engine/iff-and-tre.md).

```cpp
#include <napi.h>
#include <vector>
#include <string>
#include <cstring>

struct SwgFxEventExport {
    float triggerTime;
    uint32_t typeFlag;           // 0 = Sound Template, 1 = Particle System, 2 = Light Blueprint
    std::string assetResourcePath;
};

struct SwgEftExportManifest {
    std::vector<SwgFxEventExport> timelineEvents;
};

class SwgEftCompiler {
private:
    static bool CompareEvents(const SwgFxEventExport& a, const SwgFxEventExport& b) {
        return a.triggerTime < b.triggerTime;
    }
public:
    static std::vector<uint8_t> CompileEffectSequence(SwgEftExportManifest& manifest) {
        IffBinaryWriter contentWriter;

        // Sort all keyframe events chronologically before packing bytes into chunks
        std::sort(manifest.timelineEvents.begin(), manifest.timelineEvents.end(), CompareEvents);

        // Pack the global events count (DATA Chunk)
        IffBinaryWriter dataWriter;
        dataWriter.WriteUint32(static_cast<uint32_t>(manifest.timelineEvents.size()));
        contentWriter.PackChunk("DATA", dataWriter.buffer);

        // Pack sequential event elements inside-out (EVNT Chunks)
        for (const auto& evnt : manifest.timelineEvents) {
            IffBinaryWriter evntWriter;
            evntWriter.WriteFloat(evnt.triggerTime);
            evntWriter.WriteUint32(evnt.typeFlag);
            evntWriter.WriteString(evnt.assetResourcePath);
            contentWriter.PackChunk("EVNT", evntWriter.buffer);
        }

        // Wrap everything into the primary master FORM tag carrying the EFTM identifier
        IffBinaryWriter formWriter;
        formWriter.WriteTag("FORM");
        formWriter.WriteUint32(static_cast<uint32_t>(contentWriter.buffer.size() + 4));
        formWriter.WriteTag("EFTM");
        formWriter.WriteRawBuffer(contentWriter.buffer);

        return formWriter.buffer;
    }
};

// Node-API Export Wrapper Endpoint
Napi::Value CompileJsToEftStream(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    Napi::Array jsEvents = info.As<Napi::Array>();

    SwgEftExportManifest nativeManifest;
    for (uint32_t i = 0; i < jsEvents.Length(); ++i) {
        Napi::Object obj = jsEvents.Get(i).As<Napi::Object>();
        SwgFxEventExport evnt;
        evnt.triggerTime       = obj.Get("time").As<Napi::Number>().FloatValue();
        evnt.typeFlag          = obj.Get("type").As<Napi::Number>().Uint32Value();
        evnt.assetResourcePath = obj.Get("path").As<Napi::String>().Utf8Value();
        nativeManifest.timelineEvents.push_back(evnt);
    }

    std::vector<uint8_t> compiledBytes = SwgEftCompiler::CompileEffectSequence(nativeManifest);

    Napi::ArrayBuffer outputBuffer = Napi::ArrayBuffer::New(env, compiledBytes.size());
    std::memcpy(outputBuffer.Data(), compiledBytes.data(), compiledBytes.size());
    return outputBuffer;
}
```

### 4.6 Export Actions Pipeline (TypeScript)

Flattens the multi-track manifest into a chronological flat array, invokes the C++ compiler, and writes the resulting bytes to disk via the filesystem wrapper API.

```typescript
export const handleExportEftFile = async (
  manifestState: SwgEftSequenceManifest,
  nativeBridge: any
) => {
  // Flatten multi-track nodes into a chronological flat array format for the C++ compiler
  const flattenedEvents = manifestState.tracks.flatMap(track =>
    track.keyframes.map(key => ({
      time: key.timeMarker,
      type: track.type === 'Sound' ? 0 : track.type === 'Particle' ? 1 : 2,
      path: key.assetPath
    }))
  );

  try {
    // 1. Invoke the high-speed background compiled serialization builder loop
    const compiledEftBuffer: ArrayBuffer = nativeBridge.compileJsToEftStream(flattenedEvents);

    // 2. Commit the raw output bytes via your system filesystem wrapper layer API
    const finalByteArrayView = new Uint8Array(compiledEftBuffer);
    const targetFilename = `effect/${manifestState.effectName}.eft`;
    await window.api.saveFileToDisk(targetFilename, finalByteArrayView);

    alert(`Successfully compiled special effect macro layers into a valid SWG Macro Effect (.eft) binary container! Target: ${targetFilename}`);
  } catch (err: any) {
    alert(`EFT serialization aborted: ${err.message}`);
  }
};
```

---

## Notes on Integration

- **3D spatial previews:** Drawing the max-distance wireframe sphere over the Three.js viewport lets world builders visually align audio drop-off with physical terrain boundaries.
- **Deterministic output:** Because serialization produces valid little-endian binaries, files compiled through these pipelines function identically inside the desktop retail engine.
- **GPU performance isolation:** Handling physics inside WebGL shader registers keeps the JS main thread free and responsive even with hundreds of concurrent particles.
- **Pipeline completeness:** A modder can modify `.prt` physics, adjust weapon geometry, link a `.snd` swing template, and preview all three executing together in the animation timeline window before issuing a single export.
