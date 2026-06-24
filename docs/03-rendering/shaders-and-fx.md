# Shaders and FX — Lightsabers, Force Fields, and SWG Shader Templates (.sht)

> Covers: lightsaber shaders + motion trails (.lsb), force-field/shield shaders, `.sht` shader template format (SSHT/CSHD), texture upload, and Three.js material mapping. Source: research doc lines 7345–7897, 11645–11871, 12897–13114; §1.7 + §2 of `.planning/research/CONSULT-P2-SYNTHESIS.md`.

> **Provenance caveat:** The .lsb binary layout, hardpoint naming conventions, and shield parameter structs described here are AI-proposed reconstructions. Validate every field offset, chunk tag, and struct member against the real `swg-client-v2` source before shipping. See [source provenance](../00-overview/source-provenance.md). The `.sht`/SSHT/CSHD, `.pal`, DXT upload, and Three.js material sections below are **verified** against `../swg-client-v2`.

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
3. [SWG Shader Templates (.sht)](#3-swg-shader-templates-sht)
   - 3.1 [SSHT — Static Shader Template](#31-ssht--static-shader-template)
   - 3.2 [Texture Slot Tags](#32-texture-slot-tags)
   - 3.3 [CSHD — Customizable Shader Template](#33-cshd--customizable-shader-template)
   - 3.4 [Customization Pathways](#34-customization-pathways)
   - 3.5 [.pal — Palette File Format](#35-pal--palette-file-format)
   - 3.6 [DXT Texture Upload (WebGL2)](#36-dxt-texture-upload-webgl2)
   - 3.7 [Three.js Material Mapping for SWG Meshes](#37-threejs-material-mapping-for-swg-meshes)

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

## 3. SWG Shader Templates (.sht)

> **Verified** against `../swg-client-v2` (clientGraphics: `StaticShaderTemplate.cpp`, `CustomizableShaderTemplate.cpp`, `Texture.cpp`, `Dds.h`; sharedMath: `PaletteArgb.cpp`) + `../swg-blender-plugin` (`shader_extended.py`, `shader_effects.py`); see `.planning/research/CONSULT-P2-SYNTHESIS.md` §1.7 and `.planning/research/CONSULT-P2-04-sonnet.out`.

A `.sht` file is a **parameter/data file**, not a shader program or node graph. The actual HLSL vertex and pixel programs live in a separate `.eft` **effect file** that the `.sht` names. There are two root IFF forms:

| Root tag | C++ class | Role |
|---|---|---|
| `SSHT` | `StaticShaderTemplate` | Static: names `.eft` + declares texture slots and UV-set indices |
| `CSHD` | `CustomizableShaderTemplate` | Customizable: wraps an `SSHT` and adds per-variable color/texture overrides |
| `SWTS` | `SwitchTextureShaderTemplate` | Switch-texture animated variant |

### 3.1 SSHT — Static Shader Template

`FORM SSHT` (versions `0000`/`0001`) IFF hierarchy (`StaticShaderTemplate.cpp:310-666`):

```
FORM SSHT
  FORM 0000 (or 0001)
    NAME   <effect_path_string>          — path to the .eft effect file (real shader programs)
    FORM MATS (optional)                 — material constants
      FORM 0000
        CHUNK TAG    — uint32 material tag
        CHUNK MATL   — ambient(4f) + diffuse(4f) + emissive(4f) + specular(4f) + specPower(f)
    FORM TXMS (optional)                 — texture slots, one FORM TXM per slot
      FORM TXM
        FORM 0000/0001/0002
          CHUNK DATA  — tag(uint32), placeholder(bool8), wrap_u/v/w(uint8×3),
                        filter_mip/min/mag(uint8×3) [0002: +maxAnisotropy(uint8)]
          <embedded IFF texture reference>
    FORM TCSS (optional)                 — UV-set index assignments
      CHUNK 0000   — pairs: tag(uint32) + tcs_index(uint8)
    FORM TFNS (optional)                 — texture factor constants (packed ARGB uint32)
    FORM TSNS (optional, v0001 only)     — UV scroll speeds per slot
    FORM ARVS (optional)                 — alpha-ref values per pass (uint8)
    FORM SRVS (optional)                 — stencil-ref values per pass (uint32)
```

When `NRML` or `CNRM` is present in `TXMS`, a `DOT3` tangent coordinate set is automatically added pointing at `tcs[last+1]` (`StaticShaderTemplate.cpp:123-128`).

### 3.2 Texture Slot Tags

Confirmed from `StaticShaderTemplate.cpp:32-36` + `shader_effects.py:28-53`:

| Tag | Semantic | Typical DDS format | Notes |
|---|---|---|---|
| `MAIN` | Diffuse / albedo | DXT1 (opaque) or DXT5 (alpha) | Always present |
| `NRML` | Normal map (legacy) | DXT1 or DXT5 | Triggers auto DOT3 tangent channel |
| `CNRM` | Compressed normal (DOT3) | DXT5 or DXT1 | Equivalent to `NRML` in DOT3-era shaders |
| `SPEC` | Specular intensity | DXT1 or A8R8G8B8 | Present in `a_specmap.eft` family |
| `EMIS` | Emissive / glow | DXT5 | Present in emismap/specmap_emis effects |
| `ENVM` | Environment / cube map | Cube DDS | **`placeholder=true` in client** (`StaticShaderTemplate.cpp:load_texture_0000`): the NAME chunk is written for the asset (e.g. `texture/env_theed.dds`, a 128×128 DXT3 cube map) but the client ignores it at runtime and uses the global environment set via `Graphics::setGlobalTexture(TAG_ENVM, ...)`. **Toolkit fix (gap-closure 02-03):** always read the NAME chunk for ENVM — `texturePath` will be the per-shader cube-map DDS path that was historically skipped. Use it to build a `THREE.CompressedCubeTexture` per material instead of relying on `scene.environment`. |
| `MASK` | Environment / AO mask | DXT1 | |
| `DOT3` | Tangent coord set index | N/A | Coordinate set, not a texture |

### 3.3 CSHD — Customizable Shader Template

`FORM CSHD` wraps a full embedded `SSHT` and adds up to three optional customization forms (`CustomizableShaderTemplate.cpp:1453-1605`; confirmed by `shader_extended.py:95-225`):

```
FORM CSHD
  FORM 0000 (or 0001)
    <embedded SSHT form>                   — full base static shader
    FORM MATR (optional)                   — material color customizations
      FORM ENTR  (one per variable)
        CHUNK INFO  — material tag (uint32)
        CHUNK AMCL  — ambient:  variableName(str) [+isPrivate(int8)] + palettePath(str) + defaultIdx(int32)
        CHUNK DFCL  — diffuse:  same layout
        CHUNK EMCL  — emissive: same layout
    FORM TXTR (optional)                   — swappable texture customizations
      CHUNK DATA  — count(int16) + N×pathName(str)   [flat DDS path array]
      FORM CUST
        CHUNK TX1D  — textureTag(uint32) + baseIdx(int16) + count(int16)
                      + varName(str) + isPrivate(int8) + defaultIdx(int16)
    FORM TFAC (optional, version 0001+)    — texture-factor palette customizations
      CHUNK PAL   — varName(str) + isPrivate(int8) + tfactorTag(uint32)
                    + palettePath(str) + defaultIdx(int32)
```

### 3.4 Customization Pathways

Three distinct pathways are applied in `CustomizableShaderTemplate::applyShaderSettings` (`CustomizableShaderTemplate.cpp:1246-1286`):

**Pathway A — Palette index → material color** (`MATR`/`AMCL`/`DFCL`/`EMCL`):
Variable index → `intValues[index]` → `PaletteArgb::getEntry(paletteEntryIndex)` → `VectorArgb` → `Material::setAmbientColor` / `setDiffuseColor` / `setEmissiveColor` → `StaticShader::setMaterial(tag, material)`. Affects D3D fixed-function material color constants.

**Pathway B — Palette index → texture swap** (`TXTR`/`TX1D`):
Variable index → array offset → `CachedTexture::fetchTexture()` → `StaticShader::setTexture(textureTag, *texture)`. Replaces a named slot (e.g., `MAIN`) with one DDS from a flat array.

**Pathway C — Palette index → texture factor tint** (`TFAC`/`PAL`):
Variable index → `PaletteArgb::getEntry(paletteEntryIndex)` → packed `0xAARRGGBB` uint32 → `StaticShader::setTextureFactor(tfactorTag, argbUint32)`. Sets a D3D texture-stage multiply tint register.

Each variable's current value is a single `int` (the palette entry index). For live color customization in the toolkit, store one `int` per variable name; re-apply on change.

### 3.5 .pal — Palette File Format

Standard Microsoft RIFF PAL format (`PaletteArgb.cpp:377-523`):

```
Offset  Size  Field
0       4     'RIFF' magic
4       4     riffChunkLength (LE uint32) = paletteChunkLength + 12
8       4     'PAL ' riff type
12      4     'data' chunk FourCC
16      4     paletteChunkLength (LE uint32) = 4 + entryCount×4
20      1     unknownByte (always 0)
21      1     versionOrComponentCount (3 = RGB, forces alpha to 255)
22      2     entryCount (LE uint16), max 1024
24      entryCount×4  R, G, B, A bytes per entry
```

**Critical:** when `versionOrComponentCount == 3` (all retail `.pal` files), the A byte in each entry is ignored and forced to 255 (`PaletteArgb.cpp:517-521`). Entry memory layout: R, G, B, A. Internal packed storage is A8R8G8B8 (`getArgb()` returns `(A<<24)|(R<<16)|(G<<8)|B`).

### 3.6 DXT Texture Upload (WebGL2)

> **Previous doc claim ("DXT must be CPU-decoded") is WRONG.**

The SWG D3D client uploads DXT surfaces directly to GPU without decompression (`Texture.cpp` `loadSurface`: uses compressed block pitch, locks D3D surface, reads bytes in — no decode step). The WebGL2 equivalent is identical in principle:

| DXT variant | WebGL2 constant | CPU decode needed? |
|---|---|---|
| DXT1 | `COMPRESSED_RGB_S3TC_DXT1_EXT` / `COMPRESSED_RGBA_S3TC_DXT1_EXT` | No — direct GPU upload |
| DXT3 | `COMPRESSED_RGBA_S3TC_DXT3_EXT` | No — direct GPU upload |
| DXT5 | `COMPRESSED_RGBA_S3TC_DXT5_EXT` | No — direct GPU upload |
| DXT2 / DXT4 | No WebGL equivalent | Yes — premultiplied alpha; rare in SWG assets; decode to ARGB_8888 |

Use `THREE.CompressedTexture` with the `WEBGL_compressed_texture_s3tc` extension (available on 99%+ of desktop WebGL2 contexts). CPU-decode path is only needed for DXT2/4 fallback or iOS WebGL1.

### 3.7 Three.js Material Mapping for SWG Meshes

> **`MeshStandardMaterial` is suboptimal for SWG meshes** — it lacks a texture-factor tint uniform and cannot express SWG's D3D texture-stage multiply.

**Recommended: custom `ShaderMaterial`** with the following uniforms (synthesis §2; `CONSULT-P2-04-sonnet.out` §4):

```typescript
const uniforms = THREE.UniformsUtils.merge([
  THREE.UniformsLib.common,
  THREE.UniformsLib.normalmap,
  THREE.UniformsLib.lights,
  THREE.UniformsLib.fog,
  {
    uDiffuseMap:  { value: null as THREE.Texture | null },      // MAIN slot
    uNormalMap:   { value: null as THREE.Texture | null },      // NRML/CNRM slot
    uSpecularMap: { value: null as THREE.Texture | null },      // SPEC slot
    uEmissiveMap: { value: null as THREE.Texture | null },      // EMIS slot
    uEnvMap:      { value: null as THREE.CubeTexture | null },  // ENVM (global scene cube)
    uTexFactor:   { value: new THREE.Vector4(1, 1, 1, 1) },     // TFAC tint (Pathway C)
    uSpecPower:   { value: 16.0 },
  }
]);
```

The SWG D3D texture-factor multiply maps to one GLSL line in the fragment shader:

```glsl
vec4 finalColor = texture2D(uDiffuseMap, vUv) * uTexFactor;
```

**Live customization is zero-allocation.** For Pathway C (tint), mutate the uniform value directly — no `needsUpdate`, no realloc:

```typescript
// User picks palette entry → call this; no shader recompile, no allocation
material.uniforms.uTexFactor.value.set(r / 255, g / 255, b / 255, 1.0);
```

Only set `material.needsUpdate = true` if the shader source changes (not for uniform value changes).

**GPU skinning** composes with customization uniforms without conflict. A custom `ShaderMaterial` targeting a `SkinnedMesh` must include Three.js skinning chunks in the vertex shader:

```glsl
#include <skinning_pars_vertex>
// ... attribute declarations ...
void main() {
  #include <skinning_vertex>
  gl_Position = projectionMatrix * modelViewMatrix * vec4(transformed, 1.0);
}
```

Set `material.skinning = true` (Three.js r152+; in newer Three.js this is automatic for `SkinnedMesh`). The bone-matrix texture (`boneTexture` uniform) coexists with customization uniforms with no conflict.

**`ENVM` per-shader cube map (gap-closure 02-03, verified):**
The SWG client sets a global environment texture via `ShaderPrimitiveSorter`, but each `.sht` that participates in env-mapped specular carries its own `ENVM` NAME chunk pointing at the cube-map DDS (e.g. `texture/env_theed.dds`). In the toolkit:

1. `Shader.cpp` always reads the NAME chunk for the ENVM slot (Bug 1 fix) → `ShaderParseResult.slots[ENVM].texturePath = "texture/env_theed.dds"`.
2. The resolver fetches the DDS bytes into `slotBytes[ENVM]`.
3. `buildDdsTexture` detects `isCubemap=true` (DDS `dwCaps2 & 0x200 = DDSCAPS2_CUBEMAP`) and returns a `THREE.CompressedCubeTexture` from the 6 DXT3 face images (face-major order: +X, -X, +Y, -Y, +Z, -Z).
4. The mesh view wires this cube texture into `mat.uniforms.uEnvMap`.

The GLSL fragment shader multiplies the cubemap reflection by a spec mask (`SPEC.r` if present, else `MAIN.alpha`) — this is the source of the metallic/relief appearance on droids and ships (Bug 3 fix).

**Effect path (gap-closure 02-03, verified):**
Each `.sht` ends with either a `NAME` chunk (cstring path to the `.eft` effect file) or an inline `FORM EFCT`. The client reads this in `StaticShaderTemplate.cpp::load_0001` (effect first) or `::load_0000` (effect last). The toolkit's `Shader.cpp` now scans versionForm children for this NAME/EFCT (Bug 2 fix) → `ShaderParseResult.effectPath = "effect/a_envmask_specmap.eft"`. The resolver then fetches and parses the `.eft` to obtain the sampler role map and blend state used to drive `material.transparent`, `alphaTest`, and `depthWrite`.

### EFCT (.eft) — Shader Effect Format

A `.eft` file is `FORM EFCT` containing version-dispatch children (`FORM 0000` or `FORM 0001`). Each version child holds one or more `FORM IMPL` (implementation tier) entries, each containing `FORM PASS` → `FORM PPSH` → `FORM PTXM` (per-texture-map sampler binding). The best implementation is selected at load time by `ShaderCapability`.

**Verified layout (gap-closure 02-03; source: `swg-client-v2 ShaderEffect.cpp:86-179 + ShaderImplementation.cpp:1692-1738`):**

```
FORM EFCT
  FORM 0000 | 0001       (version)
    FORM IMPL ×N         (implementation tiers; N typically 1–3)
      CHUNK SCAP         (shader capability level — int32 BE; higher = better)
      CHUNK OPTN         (option string, optional)
      FORM PASS ×M
        FORM PPSH ×1     (pixel-shader pass)
          FORM 0001
            CHUNK DATA   { uint8 nSamplers, cstring pshPath }
            FORM PTXM ×nSamplers
              FORM 0002
                CHUNK DATA { int8 textureIndex, uint32LE textureTag }
        CHUNK DATA       (56-byte blend state)
          Offset  Size  Field
          0       1     alphaBlendEnable (bool)
          1       1     blendOperation   (int8, NONE=0, ADD=4, SUBTRACT=5, REVSUBTRACT=6)
          2       1     blendSrc         (int8)
          3       1     blendDst         (int8)
          [skip 44 bytes — material params, unused here]
          48      1     alphaTestEnable  (bool)
          49      1     alphaTestFunc    (int8)
          50      1     alphaTestRef     (uint8)
          51      1     zWrite           (bool)
          [skip 4 bytes]
```

**PTXM tag byte order:** `textureTag` is `uint32LE` (raw memcpy from `iff.read_uint32()` on a LE system). The canonical BE 4-char tag `MAIN` = `0x4D41494E`; stored on disk as bytes `4E 49 41 4D`; read as LE uint32 `0x4D41494E`. Parse high-byte-first to get the ASCII tag string.

**Best IMPL selection:** `bestImplIndex` = index of the IMPL with the highest `maxSCAP` value that has at least one sampler. This matches `ShaderCapability::meetsRequirements` at load time.
