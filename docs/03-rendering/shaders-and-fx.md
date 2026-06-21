# Shaders and FX — Lightsabers, Force Fields, and the Shader-Graph Editor

> Covers: lightsaber shaders + motion trails (.lsb), force-field/shield shaders, visual shader-graph editor (.sht). Source: research doc lines 7345–7897, 11645–11871, 12897–13114.

> **Provenance caveat:** The .lsb and .sht binary layouts, hardpoint naming conventions, and shield parameter structs described here are AI-proposed reconstructions. Validate every field offset, chunk tag, and struct member against the real `swg-client-v2` source before shipping. See [source provenance](../00-overview/source-provenance.md).

IFF reader/writer boilerplate (`IffBinaryWriter`, FORM/chunk framing, little-endian helpers) is documented in [../01-core-engine/iff-and-tre.md](../01-core-engine/iff-and-tre.md). Only .lsb- and .sht-specific parsing and serialization is shown here.

---

## Table of Contents

1. [Lightsabers (.lsb)](#1-lightsabers-lsb)
   - 1.1 [Parsing the .lsb File Structure (C++)](#11-parsing-the-lsb-file-structure-c)
   - 1.2 [Fresnel Aura Glow Shader (Three.js / WebGL)](#12-fresnel-aura-glow-shader-threejs--webgl)
   - 1.3 [Blade Component in React Three Fiber](#13-blade-component-in-react-three-fiber)
   - 1.4 [Crystal Color-Picker Inspector UI](#14-crystal-color-picker-inspector-ui)
   - 1.5 [Weapon Attachment Hardpoints (HPT)](#15-weapon-attachment-hardpoints-hpt)
   - 1.6 [Motion Trails](#16-motion-trails)
   - 1.7 [.lsb Compilation — C++ Serializer and N-API Bridge](#17-lsb-compilation--c-serializer-and-n-api-bridge)
2. [Force Fields and Shield Shaders](#2-force-fields-and-shield-shaders)
   - 2.1 [SwgShieldTemplate — .prp / Blueprint Extension Struct (C++)](#21-swgshieldtemplate--prp--blueprint-extension-struct-c)
   - 2.2 [Procedural Volumetric Force-Field Shader](#22-procedural-volumetric-force-field-shader)
   - 2.3 [Shield Dome Node in React Three Fiber](#23-shield-dome-node-in-react-three-fiber)
   - 2.4 [Force-Field Tuning Properties Panel](#24-force-field-tuning-properties-panel)
3. [Visual Shader-Graph Editor (.sht)](#3-visual-shader-graph-editor-sht)
   - 3.1 [Shader-Graph Architecture](#31-shader-graph-architecture)
   - 3.2 [Installing the Node-Canvas Engine](#32-installing-the-node-canvas-engine)
   - 3.3 [Shader Node Schema (TypeScript)](#33-shader-node-schema-typescript)
   - 3.4 [Live WebGL Fragment Shader Compiler (TypeScript)](#34-live-webgl-fragment-shader-compiler-typescript)
   - 3.5 [@xyflow/react Node Editor UI](#35-xyflowreact-node-editor-ui) *(previously "React Flow" — corrected)*
   - 3.6 [.sht Binary Serialization Engine (C++)](#36-sht-binary-serialization-engine-c)

---

## 1. Lightsabers (.lsb)

The SWG client stores lightsaber visual parameters in Lightsaber Parameter Blueprint (`.lsb`) files, which are lightweight IFF configurations wrapped in a `FORM/LSBP` container. The toolkit reads these values to drive a dual-pass WebGL blade:

- **Pass 1 (Inner Core):** A crisp white `CylinderGeometry` rendered with `MeshBasicMaterial`.
- **Pass 2 (Colored Aura):** A custom `ShaderMaterial` using a Fresnel equation to produce a volumetric neon-glow envelope that retains apparent volume regardless of viewing angle.

### 1.1 Parsing the .lsb File Structure (C++)

```cpp
#include <napi.h>
#include <string>

struct SwgLightsaberTemplate {
    uint32_t id          = 0;
    float coreRadius     = 0.025f;      // Thickness of the absolute white inner beam
    float auraRadius     = 0.140f;      // Radius of the colored neon glow envelope
    float glowIntensity  = 2.5f;        // Saturated brightness amplification
    float trailDuration  = 0.15f;       // Seconds a movement sweep trail persists on screen
    float baseColor[3]   = {0.0f, 1.0f, 0.0f}; // Default RGB (e.g., Jedi Green)
};
```

The file is a `FORM/LSBP` IFF container holding a single `DATA` chunk with these fields packed sequentially as little-endian floats and a leading `uint32_t` id. After parsing, flatten the struct into a JSON object and pass it as WebGL shader uniform values.

### 1.2 Fresnel Aura Glow Shader (Three.js / WebGL)

The fragment shader computes `dot(normal, viewDir)` — the Fresnel term — so glow intensity ramps up at geometry edges where the surface curves away from the camera, producing a volumetric neon-tube appearance rather than a flat 2D cylinder.

```typescript
import * as THREE from 'three';

export function createSwgSaberGlowMaterial(config: any) {
  return new THREE.ShaderMaterial({
    transparent: true,
    blending: THREE.AdditiveBlending, // Forces colors to super-saturate and bloom intensely
    depthWrite: false,                // Prevents rectangular aura alpha boxes from clipping geometry
    side: THREE.DoubleSide,
    uniforms: {
      uGlowColor: { value: new THREE.Color(...config.baseColor) },
      uAuraRadius: { value: config.auraRadius },
      uIntensity:  { value: config.glowIntensity }
    },
    vertexShader: `
      varying vec3 vNormal;
      varying vec3 vViewPosition;

      void main() {
        // Transform the vertex normal into view/camera coordinate space
        vNormal = normalize(normalMatrix * normal);

        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        vViewPosition = -mvPosition.xyz;

        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: `
      uniform vec3  uGlowColor;
      uniform float uIntensity;

      varying vec3 vNormal;
      varying vec3 vViewPosition;

      void main() {
        vec3 normal  = normalize(vNormal);
        vec3 viewDir = normalize(vViewPosition);

        // --- FRESNEL EDGE GLOW EQUATION ---
        // As dot product approaches 0 (edges curve away from camera),
        // the neon aura intensity ramps up dynamically.
        float intensity = 1.0 - max(dot(normal, viewDir), 0.0);

        // Shape the gradient falloff curve exponentially
        float glowFactor = pow(intensity, 3.5) * uIntensity;

        gl_FragColor = vec4(uGlowColor * glowFactor, glowFactor);
      }
    `
  });
}
```

### 1.3 Blade Component in React Three Fiber

```tsx
import React, { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { createSwgSaberGlowMaterial } from './SaberShaders';

interface SaberProps {
  lsbConfig: {
    coreRadius:    number;
    auraRadius:    number;
    glowIntensity: number;
    baseColor:     number[];
  };
  bladeLength?: number;
}

export const SwgLightsaberBladeNode: React.FC<SaberProps> = ({
  lsbConfig,
  bladeLength = 1.2
}) => {
  const innerCoreRef = useRef<THREE.Mesh>(null);
  const outerAuraRef = useRef<THREE.Mesh>(null);

  // Generate our custom shader material bound to .lsb configurations
  const auraMaterial = useMemo(
    () => createSwgSaberGlowMaterial(lsbConfig),
    [lsbConfig]
  );

  return (
    <group name="lightsaber_blade_assembly">
      {/* 1. PASS ONE: The Inner White Laser Core */}
      <mesh ref={innerCoreRef} position={[0, bladeLength / 2, 0]}>
        <cylinderGeometry
          args={[lsbConfig.coreRadius, lsbConfig.coreRadius, bladeLength, 16]}
        />
        <meshBasicMaterial color="#ffffff" />
      </mesh>

      {/* 2. PASS TWO: The Volumetric Neon Aura Glow Envelope */}
      <mesh ref={outerAuraRef} position={[0, bladeLength / 2, 0]}>
        {/* Scale radius outward matching .lsb file parameter definitions */}
        <cylinderGeometry
          args={[lsbConfig.auraRadius, lsbConfig.auraRadius, bladeLength, 32, 1, true]}
        />
        <primitive object={auraMaterial} attach="material" />
      </mesh>
    </group>
  );
};
```

### 1.4 Crystal Color-Picker Inspector UI

Modders can select crystal color frequencies (Blue, Green, Red, rare Purple/Sunrider variants) and manipulate aura and glow parameters; React state changes flow immediately into Three.js shader uniform updates.

```tsx
import React, { useState } from 'react';
import * as THREE from 'three';

export const SwgSaberCrystalInspector: React.FC<{
  initialLsb: any;
  onChange: (updated: any) => void;
}> = ({ initialLsb, onChange }) => {
  const [lsb, setLsb] = useState(initialLsb);

  const handleCrystalColorChange = (hexColor: string) => {
    // Convert hex values to normalized WebGL color floats [R, G, B]
    const color   = new THREE.Color(hexColor);
    const updated = { ...lsb, baseColor: [color.r, color.g, color.b] };
    setLsb(updated);
    onChange(updated); // Re-trigger Three.js canvas uniform updates
  };

  return (
    <div style={{
      background: '#252526', padding: '14px',
      border: '1px solid #00ffcc', borderRadius: '4px',
      color: '#fff', fontFamily: 'monospace', fontSize: '12px'
    }}>
      <h4 style={{ color: '#00ffcc', margin: '0 0 10px 0' }}>
        Adegan Crystal Tuning Palette (`.LSB`)
      </h4>

      <div style={{ display: 'grid', gap: '10px' }}>
        <label>
          Select Force Crystal Frequency:
          <input
            type="color"
            defaultValue="#00ff44"
            onChange={(e) => handleCrystalColorChange(e.target.value)}
            style={{ float: 'right', border: 'none', background: 'transparent', cursor: 'pointer' }}
          />
        </label>

        <label>
          Blade Corona Thickness ({lsb.auraRadius.toFixed(3)}m):
          <input
            type="range" min="0.05" max="0.30" step="0.005"
            value={lsb.auraRadius}
            onChange={(e) => {
              const u = { ...lsb, auraRadius: parseFloat(e.target.value) };
              setLsb(u);
              onChange(u);
            }}
            style={{ width: '100%', accentColor: '#00ffcc' }}
          />
        </label>

        <label>
          Glow Luminescence Saturation:
          <input
            type="range" min="1.0" max="5.0" step="0.1"
            value={lsb.glowIntensity}
            onChange={(e) => {
              const u = { ...lsb, glowIntensity: parseFloat(e.target.value) };
              setLsb(u);
              onChange(u);
            }}
            style={{ width: '100%', accentColor: '#00ffcc' }}
          />
        </label>
      </div>
    </div>
  );
};
```

### 1.5 Weapon Attachment Hardpoints (HPT)

SWG models use an explicit bone-joint naming scheme for item connections. When a character model loads, search the parsed `.skt` skeleton joint list for `hp_right_hand` or `hold_r` and attach the lightsaber assembly `<group>` directly to that bone node. This ensures the blade follows any swings or combat animation tracks (`.ans`) seamlessly.

The glow calculations are computed entirely inside the fragment shader, so attaching multiple blades simultaneously does not require full-screen post-processing bloom passes.

### 1.6 Motion Trails

When a character swings during a combat animation (`.ans` track), the client extrudes a trail behind the blade based on `trailDuration` parsed from the `.lsb` file. The trail is implemented as a **Dynamic Ribbon Mesh** updated every frame inside a `useFrame` hook.

#### Trail Buffer Coordinate Model (TypeScript)

```typescript
import * as THREE from 'three';

interface TrailPoint {
  base:      THREE.Vector3;
  tip:       THREE.Vector3;
  timestamp: number;
}

export class SwgSaberTrailHistory {
  private history: TrailPoint[] = [];

  constructor(private maxLifespanSeconds: number) {}

  /**
   * Caches active matrix transforms on every animation step.
   */
  public pushFramePoints(
    basePos: THREE.Vector3,
    tipPos:  THREE.Vector3,
    currentTime: number
  ) {
    this.history.push({
      base:      basePos.clone(),
      tip:       tipPos.clone(),
      timestamp: currentTime
    });

    // Prune entries that have exceeded the trail duration limit parsed from the .lsb file
    const cutoff = currentTime - this.maxLifespanSeconds;
    this.history  = this.history.filter(point => point.timestamp >= cutoff);
  }

  public getPoints(): TrailPoint[] {
    return this.history;
  }

  public get count(): number {
    return this.history.length;
  }
}
```

#### Motion-Trail Extrusion Shader

The vertex attribute `aVertexBirthTime` encodes the creation timestamp of each ribbon slice so the fragment shader can fade the trail as it ages. `aRibbonU` runs 0.0 at the hilt base to 1.0 at the blade tip, driving a `sin`-shaped vertical fade.

```typescript
export function createSwgTrailMaterial(config: any) {
  return new THREE.ShaderMaterial({
    transparent: true,
    blending:    THREE.AdditiveBlending, // Amplifies brightness across overlapping sweeps
    depthWrite:  false,
    side:        THREE.DoubleSide,
    uniforms: {
      uGlowColor:     { value: new THREE.Color(...config.baseColor) },
      uCurrentTime:   { value: 0 },
      uTrailDuration: { value: config.trailDuration }
    },
    vertexShader: `
      uniform float uCurrentTime;
      uniform float uTrailDuration;

      attribute float aVertexBirthTime;
      attribute float aRibbonU; // 0.0 at hilt base, 1.0 at blade tip

      varying float vAlphaAlpha;
      varying float vRibbonU;

      void main() {
        vRibbonU = aRibbonU;

        // Calculate the age percentage of this slice of the movement sweep
        float age   = uCurrentTime - aVertexBirthTime;
        vAlphaAlpha = clamp(1.0 - (age / uTrailDuration), 0.0, 1.0);

        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3  uGlowColor;
      varying float vAlphaAlpha;
      varying float vRibbonU;

      void main() {
        // Soften the vertical profile edges so the trail fades out toward the tip
        float verticalFade  = sin(vRibbonU * 3.14159);
        float finalOpacity  = vAlphaAlpha * verticalFade * 0.6;

        gl_FragColor = vec4(uGlowColor, finalOpacity);
      }
    `
  });
}
```

#### Interactive Ribbon Mesh in React Three Fiber

Allocates up to 32 slices (64 vertices) and mutates buffer attribute arrays each frame. Triangle indices are built once at construction time.

```tsx
import React, { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { SwgSaberTrailHistory } from './TrailHistory';
import { createSwgTrailMaterial }  from './TrailShaders';

interface TrailProps {
  lsbConfig:    any;
  hiltMeshRef:  React.RefObject<THREE.Mesh>;
  bladeLength?: number;
}

export const SwgSaberMotionTrailNode: React.FC<TrailProps> = ({
  lsbConfig,
  hiltMeshRef,
  bladeLength = 1.2
}) => {
  const meshRef   = useRef<THREE.Mesh>(null);
  const maxSlices = 32;

  const history       = useMemo(() => new SwgSaberTrailHistory(lsbConfig.trailDuration), [lsbConfig]);
  const trailMaterial = useMemo(() => createSwgTrailMaterial(lsbConfig), [lsbConfig]);

  const ribbonGeometry = useMemo(() => {
    const geo        = new THREE.BufferGeometry();
    const positions  = new Float32Array(maxSlices * 2 * 3); // 2 verts per slice, 3 coords each
    const birthTimes = new Float32Array(maxSlices * 2);
    const ribbonUs   = new Float32Array(maxSlices * 2);

    // Build static structural triangle index indices once
    const indices: number[] = [];
    for (let i = 0; i < maxSlices - 1; i++) {
      const idx = i * 2;
      indices.push(idx,     idx + 1, idx + 2);
      indices.push(idx + 1, idx + 3, idx + 2);
    }

    geo.setAttribute('position',         new THREE.BufferAttribute(positions,  3));
    geo.setAttribute('aVertexBirthTime', new THREE.BufferAttribute(birthTimes, 1));
    geo.setAttribute('aRibbonU',         new THREE.BufferAttribute(ribbonUs,   1));
    geo.setIndex(indices);
    return geo;
  }, []);

  useFrame((state) => {
    if (!hiltMeshRef.current || !meshRef.current) return;

    const hilt = hiltMeshRef.current;
    const time = state.clock.getElapsedTime();

    // 1. Resolve active world space position coordinates for the hilt markers
    const baseWorldPos = new THREE.Vector3(0, 0,           0).applyMatrix4(hilt.matrixWorld);
    const tipWorldPos  = new THREE.Vector3(0, bladeLength, 0).applyMatrix4(hilt.matrixWorld);

    // 2. Append the current frame coordinates to the tracking array
    history.pushFramePoints(baseWorldPos, tipWorldPos, time);
    const slices = history.getPoints();

    // 3. Update uniforms and write coordinates back onto the geometry attributes
    trailMaterial.uniforms.uCurrentTime.value = time;

    const posAttr   = ribbonGeometry.getAttribute('position')         as THREE.BufferAttribute;
    const birthAttr = ribbonGeometry.getAttribute('aVertexBirthTime') as THREE.BufferAttribute;
    const uAttr     = ribbonGeometry.getAttribute('aRibbonU')         as THREE.BufferAttribute;

    for (let i = 0; i < maxSlices; i++) {
      // If history pool is filling up, grab entries; otherwise clamp to current frame
      const slice = slices[i] ||
                    slices[slices.length - 1] ||
                    { base: baseWorldPos, tip: tipWorldPos, timestamp: time };
      const idx = i * 2;

      // Assign Hilt Base Vert
      posAttr.setXYZ(idx,     slice.base.x, slice.base.y, slice.base.z);
      birthAttr.setX(idx,     slice.timestamp);
      uAttr.setX(idx,     0.0);

      // Assign Blade Tip Vert
      posAttr.setXYZ(idx + 1, slice.tip.x,  slice.tip.y,  slice.tip.z);
      birthAttr.setX(idx + 1, slice.timestamp);
      uAttr.setX(idx + 1, 1.0);
    }

    posAttr.needsUpdate   = true;
    birthAttr.needsUpdate = true;
    uAttr.needsUpdate     = true;
  });

  return (
    <mesh
      ref={meshRef}
      geometry={ribbonGeometry}
      material={trailMaterial}
      matrixAutoUpdate={false}
    />
  );
};
```

#### Connecting the Motion Rig to Combat Stances

```tsx
export const SwgAnimatedSaberPreviewNode: React.FC<{
  hptBoneRef: THREE.Bone;
  lsbConfig:  any;
}> = ({ hptBoneRef, lsbConfig }) => {
  const hiltAnchorRef = useRef<THREE.Mesh>(null);

  useFrame(() => {
    if (hptBoneRef && hiltAnchorRef.current) {
      // Sync the hilt model directly to the skeleton hand bone matrix transforms
      hiltAnchorRef.current.position.copy(hptBoneRef.position);
      hiltAnchorRef.current.quaternion.copy(hptBoneRef.quaternion);
      hiltAnchorRef.current.updateMatrixWorld(true);
    }
  });

  return (
    <group>
      {/* Base Hilt Model Anchor Mesh */}
      <mesh ref={hiltAnchorRef} name="lightsaber_hilt_pivot">
        <cylinderGeometry args={[0.015, 0.015, 0.25, 8]} />
        <meshStandardMaterial color="#666" metalness={0.9} roughness={0.1} />

        {/* Draw the visual inner core and neon bloom envelope */}
        <SwgLightsaberBladeNode lsbConfig={lsbConfig} />
      </mesh>

      {/* Extrude the movement trail separately into world coordinates */}
      <SwgSaberMotionTrailNode lsbConfig={lsbConfig} hiltMeshRef={hiltAnchorRef} />
    </group>
  );
};
```

### 1.7 .lsb Compilation — C++ Serializer and N-API Bridge

#### Native .lsb Compilation Engine (C++)

Packs the `SwgLightsaberTemplate` struct fields into a `DATA` chunk and encloses it in a `FORM/LSBP` IFF container. Uses `IffBinaryWriter` from [../01-core-engine/iff-and-tre.md](../01-core-engine/iff-and-tre.md).

```cpp
#include <napi.h>
#include <vector>
#include <string>
#include <cstring>

class SwgLsbCompiler {
public:
    /**
     * Serializes lightsaber workspace parameters into a deployable LSBP FORM chunk.
     */
    static std::vector<uint8_t> CompileLightsaberTemplate(
        const SwgLightsaberTemplate& lsb)
    {
        IffBinaryWriter contentWriter;

        // --- PACK THE STRUCTURAL DATA CHUNK ---
        IffBinaryWriter dataWriter;
        dataWriter.WriteUint32(lsb.id);
        dataWriter.WriteFloat(lsb.coreRadius);
        dataWriter.WriteFloat(lsb.auraRadius);
        dataWriter.WriteFloat(lsb.glowIntensity);
        dataWriter.WriteFloat(lsb.trailDuration);

        // Write the normalized RGB color channels sequentially
        dataWriter.WriteFloat(lsb.baseColor[0]); // Red Channel
        dataWriter.WriteFloat(lsb.baseColor[1]); // Green Channel
        dataWriter.WriteFloat(lsb.baseColor[2]); // Blue Channel

        contentWriter.PackChunk("DATA", dataWriter.buffer);

        // --- ENCLOSE WITHIN MASTER FORM -> LSBP CONTAINER ---
        IffBinaryWriter formWriter;
        formWriter.WriteTag("FORM");
        // Payload size = content data size + 4 bytes for the "LSBP" type tag
        formWriter.WriteUint32(
            static_cast<uint32_t>(contentWriter.buffer.size() + 4));
        formWriter.WriteTag("LSBP");
        formWriter.WriteRawBuffer(contentWriter.buffer);

        return formWriter.buffer;
    }
};
```

#### N-API Bridge (C++ to JS)

Unpacks the JavaScript config object, runs the compiler, and returns the result as a zero-copy `ArrayBuffer`.

```cpp
Napi::Value CompileJsToLsbStream(const Napi::CallbackInfo& info) {
    Napi::Env    env      = info.Env();
    Napi::Object jsLsbObj = info.As<Napi::Object>();

    SwgLightsaberTemplate nativeLsb;
    nativeLsb.id            = jsLsbObj.Get("id").As<Napi::Number>().Uint32Value();
    nativeLsb.coreRadius    = jsLsbObj.Get("coreRadius").As<Napi::Number>().FloatValue();
    nativeLsb.auraRadius    = jsLsbObj.Get("auraRadius").As<Napi::Number>().FloatValue();
    nativeLsb.glowIntensity = jsLsbObj.Get("glowIntensity").As<Napi::Number>().FloatValue();
    nativeLsb.trailDuration = jsLsbObj.Get("trailDuration").As<Napi::Number>().FloatValue();

    // Map the internal RGB float array channel parameters
    Napi::Array jsColorArray = jsLsbObj.Get("baseColor").As<Napi::Array>();
    nativeLsb.baseColor[0]  = jsColorArray.Get(uint32_t(0)).As<Napi::Number>().FloatValue();
    nativeLsb.baseColor[1]  = jsColorArray.Get(uint32_t(1)).As<Napi::Number>().FloatValue();
    nativeLsb.baseColor[2]  = jsColorArray.Get(uint32_t(2)).As<Napi::Number>().FloatValue();

    // Execute the inside-out binary serialization compiler loop
    std::vector<uint8_t> compiledLsbBytes =
        SwgLsbCompiler::CompileLightsaberTemplate(nativeLsb);

    // Transfer the compiled binary stream directly into a zero-copy Node.js ArrayBuffer
    Napi::ArrayBuffer outputBuffer =
        Napi::ArrayBuffer::New(env, compiledLsbBytes.size());
    std::memcpy(outputBuffer.Data(),
                compiledLsbBytes.data(),
                compiledLsbBytes.size());

    return outputBuffer;
}

// Register within the native module initializer
exports.Set("compileJsToLsbStream",
            Napi::Function::New(env, CompileJsToLsbStream));
```

#### Integrating the Serializer with React Controls

The `SwgAdvancedSaberCrystalInspector` component adds a compile-and-save button to the existing slider/color UI (`SwgSaberCrystalInspector`). It calls the N-API bridge and routes the output `ArrayBuffer` to disk via the Electron context-isolation API.

```tsx
import React, { useState } from 'react';

export const SwgAdvancedSaberCrystalInspector: React.FC<{
  initialLsb:   any;
  nativeBridge: any;
  onChange:     (updated: any) => void;
}> = ({ initialLsb, nativeBridge, onChange }) => {
  const [lsb, setLsb] = useState(initialLsb);

  const handleExportLsbFile = async () => {
    try {
      // 1. Invoke the high-speed C++ binary serialization compiler loop
      const compiledLsbArrayBuffer: ArrayBuffer =
        nativeBridge.compileJsToLsbStream(lsb);

      // 2. Package raw byte data view out to disk via context isolation bridges
      const finalByteArrayView = new Uint8Array(compiledLsbArrayBuffer);
      const success = await window.api.saveFileToDisk(
        "misc/lightsaber_crystals.lsb",
        finalByteArrayView
      );

      if (success) {
        alert(
          "Successfully serialized crystal parameters into a valid " +
          "SWG lightsaber blueprint (.lsb) binary container!"
        );
      }
    } catch (err: any) {
      console.error("Lightsaber parameters compilation error event:", err);
      alert(`LSB serialization aborted: ${err.message}`);
    }
  };

  return (
    <div style={{
      background: '#252526', padding: '14px',
      border: '1px solid #00ffcc', borderRadius: '4px',
      color: '#fff', fontFamily: 'monospace', fontSize: '12px'
    }}>
      <h4 style={{ color: '#00ffcc', margin: '0 0 10px 0' }}>
        Adegan Crystal Tuning Palette (`.LSB`)
      </h4>

      {/* (Render coreRadius, auraRadius, color selectors from SwgSaberCrystalInspector here) */}

      <button
        onClick={handleExportLsbFile}
        style={{
          marginTop: '12px', width: '100%',
          background: '#00ffcc', color: '#111',
          fontWeight: 'bold', padding: '8px 14px',
          border: 'none', borderRadius: '4px', cursor: 'pointer'
        }}
      >
        Compile Lightsaber Blueprint (.LSB)
      </button>
    </div>
  );
};
```

---

## 2. Force Fields and Shield Shaders

City shields and deflector bubbles use a two-pass custom WebGL pipeline:

1. **Fresnel Rim:** Concentrates glow intensity around the outer edge of the energy dome.
2. **Procedural Pulsing Hex-Grid:** An animated hexagonal energy pattern that ripples over time using sine-wave oscillations and scrolling UV coordinates.

### 2.1 SwgShieldTemplate — .prp / Blueprint Extension Struct (C++)

In SWG, shield scale bounds, energy glow coefficients, and color values are stored inside Object Property Templates (`.prp`) or custom IFF datatables. The C++ layer extracts these variables and returns a flat config block:

```cpp
struct SwgShieldTemplate {
    uint32_t objectId           = 99102;
    float    shieldRadius       = 25.0f;            // Radius of the generated city shield bubble
    float    pulseSpeed         = 1.45f;            // Frequency of the breathing wave oscillation
    float    coreColor[3]       = {0.0f, 0.6f, 1.0f}; // Saturated Jedi Cyan-Blue [R, G, B]
    float    impactGlowIntensity= 3.5f;             // Saturated bloom amplification factor
};
```

### 2.2 Procedural Volumetric Force-Field Shader

The material computes the dot product between the surface normal and the camera view trajectory for the rim glow, then layers an animated hexagonal texture channel on top. Two conflicting UV scroll directions simulate energy ripple interference.

```typescript
import * as THREE from 'three';

export function createSwgShieldForceFieldMaterial(
  config:         any,
  hexGridTexture: THREE.Texture
) {
  // Ensure the shield matrix pattern wraps and tiles seamlessly across the sphere
  hexGridTexture.wrapS = THREE.RepeatWrapping;
  hexGridTexture.wrapT = THREE.RepeatWrapping;

  return new THREE.ShaderMaterial({
    transparent: true,
    blending:    THREE.AdditiveBlending, // Forces overlapping energy vectors to super-saturate
    depthWrite:  false,                  // Blocks the bounding box from clipping underlying meshes
    side:        THREE.DoubleSide,       // Render both inside and outside of the defensive canopy
    uniforms: {
      uTime:       { value: 0 },
      uShieldColor:{ value: new THREE.Color(...config.coreColor) },
      uPulseSpeed: { value: config.pulseSpeed },
      uHexTexture: { value: hexGridTexture },
      uIntensity:  { value: config.impactGlowIntensity }
    },
    vertexShader: `
      varying vec3 vNormal;
      varying vec3 vViewPosition;
      varying vec2 vShieldUv;

      void main() {
        vShieldUv = uv;
        // Transform vertex normals into camera view matrix coordinate tracking layers
        vNormal = normalize(normalMatrix * normal);

        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        vViewPosition   = -mvPosition.xyz;

        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: `
      uniform float      uTime;
      uniform vec3       uShieldColor;
      uniform float      uPulseSpeed;
      uniform sampler2D  uHexTexture;
      uniform float      uIntensity;

      varying vec3 vNormal;
      varying vec3 vViewPosition;
      varying vec2 vShieldUv;

      void main() {
        vec3 normal  = normalize(vNormal);
        vec3 viewDir = normalize(vViewPosition);

        // 1. DYNAMIC COMPUTE FRESNEL OUTER RIM GLOW
        // As dot product hits 0 at the curving horizons, intensity scales up
        float rimFactor    = 1.0 - max(dot(normal, viewDir), 0.0);
        float exponentialRim = pow(rimFactor, 3.0) * uIntensity;

        // 2. PROCEDURAL BREATHING PULSE TIMELINE WAVE
        // Smooth floating breathing multiplier between 0.4 and 1.0
        float pulseMultiplier = 0.7 + sin(uTime * uPulseSpeed) * 0.3;

        // 3. SEAMLESS SCROLLING HEXAGONAL ENERGETIC GRID
        // Distort and scroll UV tracks over two conflicting directions
        // to simulate energy ripples
        vec2 uvScrollA = vShieldUv * 16.0 + vec2(uTime * 0.05,  uTime * 0.02);
        vec2 uvScrollB = vShieldUv * 16.0 - vec2(uTime * 0.02,  uTime * 0.04);

        vec4  hexPatternA    = texture2D(uHexTexture, uvScrollA);
        vec4  hexPatternB    = texture2D(uHexTexture, uvScrollB);
        float combinedHexGrid = (hexPatternA.r * hexPatternB.g) * 2.0;

        // 4. MIX DATA PASSES UNTO FINAL MATRIX
        float finalEnergyField =
            (exponentialRim + (combinedHexGrid * 0.25)) * pulseMultiplier;

        // Output saturated plasma glow
        gl_FragColor = vec4(uShieldColor * finalEnergyField, finalEnergyField * 0.5);
      }
    `
  });
}
```

### 2.3 Shield Dome Node in React Three Fiber

A `SphereGeometry` is cut to half (vertical sweep `0 → Math.PI * 0.5`) to produce a flush ground dome. A `useFrame` hook updates the `uTime` uniform each frame.

```tsx
import React, { useMemo, useRef } from 'react';
import { useFrame, useLoader } from '@react-three/fiber';
import * as THREE from 'three';
import { createSwgShieldForceFieldMaterial } from './ShieldShaders';

interface ShieldProps {
  shieldConfig: {
    objectId:            number;
    shieldRadius:        number;
    pulseSpeed:          number;
    coreColor:           number[];
    impactGlowIntensity: number;
  };
  hexGridTextureUrl: string; // Tiling black/white hex grid pattern mask asset
}

export const SwgCityShieldNode: React.FC<ShieldProps> = ({
  shieldConfig,
  hexGridTextureUrl
}) => {
  const shieldMeshRef = useRef<THREE.Mesh>(null);

  // Load the texture mask via the async loading registry
  const hexTexture = useLoader(THREE.TextureLoader, hexGridTextureUrl);

  const fieldMaterial = useMemo(
    () => createSwgShieldForceFieldMaterial(shieldConfig, hexTexture),
    [shieldConfig, hexTexture]
  );

  // High-frequency uniform tick tracker
  useFrame((state) => {
    if (shieldMeshRef.current) {
      const mat = shieldMeshRef.current.material as THREE.ShaderMaterial;
      mat.uniforms.uTime.value = state.clock.getElapsedTime();
    }
  });

  return (
    <group name={`shield_generator_bubble_${shieldConfig.objectId}`}>
      {/* Hemispherical dome canopy centered over city center anchors */}
      <mesh ref={shieldMeshRef}>
        <sphereGeometry args={[
          shieldConfig.shieldRadius, // Bounding dome scale radius
          64, 32,                    // Mesh segment density resolution
          0, Math.PI * 2,            // Horizontal sweep parameters
          0, Math.PI * 0.5           // Cut sphere in half for flush ground dome
        ]} />
        <primitive object={fieldMaterial} attach="material" />
      </mesh>
    </group>
  );
};
```

### 2.4 Force-Field Tuning Properties Panel

Gives level designers real-time control over dome radius, plasma color, and pulse frequency; changes are injected directly into Three.js canvas uniforms.

```tsx
import React, { useState } from 'react';
import * as THREE from 'three';

export const SwgShieldInspectorCard: React.FC<{
  initialConfig:  any;
  onConfigUpdate: (updated: any) => void;
}> = ({ initialConfig, onConfigUpdate }) => {
  const [cfg, setCfg] = useState(initialConfig);

  const handleShieldColorChange = (hexValue: string) => {
    const color   = new THREE.Color(hexValue);
    const updated = { ...cfg, coreColor: [color.r, color.g, color.b] };
    setCfg(updated);
    onConfigUpdate(updated); // Inject changes into Three.js canvas uniforms
  };

  const handleSliderAdjustment = (propertyKey: string, value: number) => {
    const updated = { ...cfg, [propertyKey]: value };
    setCfg(updated);
    onConfigUpdate(updated);
  };

  return (
    <div style={{
      background: '#1e1e24', padding: '14px',
      border: '1px solid #00ffcc', borderRadius: '4px',
      fontFamily: 'monospace', fontSize: '11px', color: '#fff'
    }}>
      <h5 style={{ color: '#00ffcc', margin: '0 0 10px 0' }}>
        Shield Generator Tuning Core
      </h5>

      <div style={{ display: 'grid', gap: '8px' }}>
        <label>
          Defensive Plasma Frequency:
          <input
            type="color" defaultValue="#0099ff"
            onChange={(e) => handleShieldColorChange(e.target.value)}
            style={{ float: 'right', border: 'none', background: 'transparent', cursor: 'pointer' }}
          />
        </label>

        <label>
          Defensive Dome Radius ({cfg.shieldRadius}m):
          <input
            type="range" min="10" max="150" step="5"
            value={cfg.shieldRadius}
            onChange={(e) =>
              handleSliderAdjustment('shieldRadius', parseInt(e.target.value))}
            style={{ width: '100%', accentColor: '#00ffcc' }}
          />
        </label>

        <label>
          Energy Ripple Frequency (Pulse):
          <input
            type="range" min="0.2" max="3.5" step="0.05"
            value={cfg.pulseSpeed}
            onChange={(e) =>
              handleSliderAdjustment('pulseSpeed', parseFloat(e.target.value))}
            style={{ width: '100%', accentColor: '#00ffcc' }}
          />
        </label>
      </div>
    </div>
  );
};
```

---

## 3. Visual Shader-Graph Editor (.sht)

The shader-graph editor lets artists build multi-texture SWG shader files visually, with live WebGL preview, then serialize the result to the proprietary `.sht` IFF binary format.

### 3.1 Shader-Graph Architecture

> **Correction (research review 2026-06-21):** The node-graph library is **`@xyflow/react` v12** — the current package name for React Flow. The old `reactflow` package name is deprecated; use `@xyflow/react` for all new installs. Source: [`../../.planning/research/STACK.md`](../../.planning/research/STACK.md).

```
[ @xyflow/react UI Node Canvas ] ──(State Change)──> [ TypeScript Graph Compiler ]
             │                                               │
             ├──> (Generates WebGL Custom Fragment Shader) ──┤
             │    -> Live 3D Mesh Preview Canvas             │
             │                                               v
             └──> (Unrolls Connections to Flat Payload) ──> [ C++ Node-API Core ]
                                                            -> Packs IFF Chunks (SHTS / DATA)
                                                            -> Deploys Deployable .SHT Binary
```

### 3.2 Installing the Node-Canvas Engine

```
npm install @xyflow/react
```

### 3.3 Shader Node Schema (TypeScript)

```typescript
export type SwgShaderNodeType =
  | 'TextureSample'
  | 'ColorConstant'
  | 'TexCoordScroll'
  | 'MaterialOutput';

export interface SwgShaderNodeData {
  label:  string;
  type:   SwgShaderNodeType;
  value?: any; // e.g., texture path "art/texture/metal_floor.dds" or color [r, g, b]
}

export interface SwgShaderGraphPayload {
  nodes: Array<{
    id:       string;
    type:     string;
    data:     SwgShaderNodeData;
    position: { x: number; y: number };
  }>;
  edges: Array<{
    id:            string;
    source:        string;
    target:        string;
    sourceHandle?: string;
    targetHandle?: string;
  }>;
}
```

### 3.4 Live WebGL Fragment Shader Compiler (TypeScript)

Parses the active node graph, resolves incoming edge connections, and stitches together a GLSL fragment shader string for instantaneous preview. Supports `TextureSample` (with optional `TexCoordScroll` UV modifier), and `ColorConstant` emissive inputs wired to the `MaterialOutput` node.

```typescript
import { SwgShaderGraphPayload } from './ShaderGraphSchema';

export class SwgShaderGraphCompiler {
  /**
   * Generates custom WebGL fragment shader code from the node graph payload.
   */
  public compileGraphToFragmentShader(
    payload: SwgShaderGraphPayload
  ): string {
    let uniformDeclarations = '';
    let colorCalculations   = 'vec4 baseColor = vec4(0.5, 0.5, 0.5, 1.0);\n';

    // 1. Locate the master Material Output node
    const outputNode = payload.nodes.find(n => n.data.type === 'MaterialOutput');
    if (!outputNode) return this.getFallbackShader();

    // 2. Scan incoming edge structures to trace pixel logic
    payload.edges.forEach((edge) => {
      const sourceNode = payload.nodes.find(n => n.id === edge.source);
      if (!sourceNode) return;

      if (sourceNode.data.type === 'TextureSample' && edge.targetHandle === 'diffuse') {
        const uniformName = `uTex_${sourceNode.id}`;
        uniformDeclarations += `uniform sampler2D ${uniformName};\n`;

        // Check if the texture sample has an attached UV scrolling coordinate node
        const uvEdge   = payload.edges.find(
          e => e.target === sourceNode.id && e.targetHandle === 'uv'
        );
        const uvCoords = uvEdge
          ? `vUv + (uScrollSpeed_${uvEdge.source} * uTime)`
          : 'vUv';

        if (uvEdge) {
          uniformDeclarations += `uniform vec2 uScrollSpeed_${uvEdge.source};\n`;
        }

        colorCalculations = `baseColor = texture2D(${uniformName}, ${uvCoords});\n`;
      }

      if (sourceNode.data.type === 'ColorConstant' && edge.targetHandle === 'emissive') {
        uniformDeclarations += `uniform vec3 uColor_${sourceNode.id};\n`;
        colorCalculations   += `baseColor.rgb += uColor_${sourceNode.id} * 1.5;\n`; // Emissive boost
      }
    });

    return `
      uniform float uTime;
      varying vec2  vUv;
      ${uniformDeclarations}

      void main() {
        ${colorCalculations}
        gl_FragColor = baseColor;
      }
    `;
  }

  private getFallbackShader(): string {
    // Magenta missing-asset indicator
    return `void main() { gl_FragColor = vec4(1.0, 0.0, 1.0, 1.0); }`;
  }
}
```

### 3.5 @xyflow/react Node Editor UI

Provides the drag-and-drop node canvas. Connecting two nodes triggers immediate shader recompilation and preview update.

> **Package name corrected:** import from `@xyflow/react`, not the deprecated `reactflow`. Source: [`../../.planning/research/STACK.md`](../../.planning/research/STACK.md).

```tsx
import React, { useState, useMemo, useCallback } from 'react';
import { ReactFlow, MiniMap, Controls, Background,
  useNodesState, useEdgesState, addEdge } from '@xyflow/react';
import type { Connection, Edge } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { SwgShaderGraphCompiler } from './ShaderGraphCompiler';

const initialNodes = [
  {
    id:       'out_1',
    type:     'default',
    data:     { label: 'Material Output', type: 'MaterialOutput' },
    position: { x: 500, y: 150 }
  },
  {
    id:       'tex_1',
    type:     'input',
    data:     {
      label: 'Texture Sample (.DDS)',
      type:  'TextureSample',
      value: 'art/texture/floor_panel.dds'
    },
    position: { x: 100, y: 50 }
  }
];

const initialEdges = [
  { id: 'e1-2', source: 'tex_1', target: 'out_1', targetHandle: 'diffuse' }
];

export const SwgShaderNodeEditor: React.FC<{
  onShaderCompiled: (fsCode: string, uniforms: any) => void;
}> = ({ onShaderCompiled }) => {
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  const graphCompiler = useMemo(() => new SwgShaderGraphCompiler(), []);

  const onConnect = useCallback(
    (params: Connection | Edge) => {
      setEdges((eds) => {
        const updatedEdges = addEdge(params, eds);
        // Trigger instant shader recompilation on link updates
        const fsCode = graphCompiler.compileGraphToFragmentShader({
          nodes,
          edges: updatedEdges
        });
        onShaderCompiled(fsCode, {});
        return updatedEdges;
      });
    },
    [nodes, setEdges, graphCompiler, onShaderCompiled]
  );

  return (
    <div style={{
      width: '100%', height: '500px',
      background: '#1c1c1f',
      border: '1px solid #333', borderRadius: '4px'
    }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        fitView
      >
        <Controls />
        <MiniMap nodeColor={() => '#ff0055'} style={{ background: '#111' }} />
        <Background color="#333" gap={16} />
      </ReactFlow>
    </div>
  );
};
```

### 3.6 .sht Binary Serialization Engine (C++)

Once the material graph is finalized, the frontend passes the flattened node/edge payload to the C++ core. The compiler builds a `FORM/SHTS` IFF container. Each texture pass becomes a `FORM/PASS` sub-container holding a `TXFM` chunk (texture path and pass id) and an `ANIM` chunk (UV scroll speeds). The `IffBinaryWriter` helper is from [../01-core-engine/iff-and-tre.md](../01-core-engine/iff-and-tre.md).

```cpp
#include <napi.h>
#include <vector>
#include <string>
#include <cstring>

struct ShaderTexturePass {
    uint32_t    passId;
    std::string texturePath;
    float       scrollSpeedX;
    float       scrollSpeedY;
};

struct SwgShaderExportManifest {
    uint32_t shaderTypeFlag = 0; // 0 = Standard Mesh Shader, 1 = Blended Terrain Shader
    std::vector<ShaderTexturePass> texturePasses;
};

class SwgShaderCompiler {
public:
    static std::vector<uint8_t> CompileShaderTemplate(
        const SwgShaderExportManifest& manifest)
    {
        IffBinaryWriter contentWriter;

        // 1. Pack global header settings (DATA chunk)
        IffBinaryWriter dataWriter;
        dataWriter.WriteUint32(manifest.shaderTypeFlag);
        dataWriter.WriteUint32(
            static_cast<uint32_t>(manifest.texturePasses.size()));
        contentWriter.PackChunk("DATA", dataWriter.buffer);

        // 2. Loop over visual node connections inside-out and write pass blocks (PASS FORM)
        for (const auto& pass : manifest.texturePasses) {
            IffBinaryWriter passContentWriter;

            // Pack structural property tags containing texture pathways (TXFM chunk)
            IffBinaryWriter txfmWriter;
            txfmWriter.WriteUint32(pass.passId);
            txfmWriter.WriteString(pass.texturePath);
            passContentWriter.PackChunk("TXFM", txfmWriter.buffer);

            // Pack scrolling vertex offset parameters (ANIM chunk)
            IffBinaryWriter animWriter;
            animWriter.WriteFloat(pass.scrollSpeedX);
            animWriter.WriteFloat(pass.scrollSpeedY);
            passContentWriter.PackChunk("ANIM", animWriter.buffer);

            // Wrap into an active IFF PASS sub-FORM container
            IffBinaryWriter passFormWriter;
            passFormWriter.WriteTag("FORM");
            passFormWriter.WriteUint32(
                static_cast<uint32_t>(passContentWriter.buffer.size() + 4));
            passFormWriter.WriteTag("PASS");
            passFormWriter.WriteRawBuffer(passContentWriter.buffer);

            contentWriter.WriteRawBuffer(passFormWriter.buffer);
        }

        // 3. Wrap everything into the primary master FORM tag carrying the SHTS identifier
        IffBinaryWriter formWriter;
        formWriter.WriteTag("FORM");
        formWriter.WriteUint32(
            static_cast<uint32_t>(contentWriter.buffer.size() + 4));
        formWriter.WriteTag("SHTS");
        formWriter.WriteRawBuffer(contentWriter.buffer);

        return formWriter.buffer;
    }
};

// Node-API Export Wrapper
Napi::Value CompileJsToShtStream(const Napi::CallbackInfo& info) {
    Napi::Env    env        = info.Env();
    Napi::Object jsManifest = info.As<Napi::Object>();

    SwgShaderExportManifest nativeManifest;
    // Unpack texture arrays and handles from incoming graph state properties...

    std::vector<uint8_t> compiledBytes =
        SwgShaderCompiler::CompileShaderTemplate(nativeManifest);

    Napi::ArrayBuffer outputBuffer =
        Napi::ArrayBuffer::New(env, compiledBytes.size());
    std::memcpy(outputBuffer.Data(),
                compiledBytes.data(),
                compiledBytes.size());
    return outputBuffer;
}
```

**IFF layout summary for `.sht`:**

```
FORM/SHTS
  DATA            — shaderTypeFlag (uint32), passCount (uint32)
  FORM/PASS       — one per texture pass
    TXFM          — passId (uint32), texturePath (null-terminated string)
    ANIM          — scrollSpeedX (float), scrollSpeedY (float)
```
