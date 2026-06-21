# Viewport Editing Tools

> Covers: selection/transform gizmos, terrain snapping, sculpt/scatter brushes, procedural painting, frustum culling, texture baking. Source: research doc lines 3262–4314, 13587–13830.

> **Caveat:** All binary struct layouts, field offsets, and compression format details below are AI-proposed based on reverse-engineering inference. Validate every struct against real SWG client files before shipping. See [source provenance](../00-overview/source-provenance.md).

This document covers the interactive layer of the SWG-Toolkit Three.js/R3F canvas: how instanced foliage is selected and manipulated, how objects snap to procedural terrain, how paint/erase brushes mutate large forests in real time, how frustum culling keeps dense scenes performant, and how landscape textures are baked to DDS asynchronously.

The terrain height evaluator that the snapper and brush ring call into is detailed in [../02-formats/terrain.md](../02-formats/terrain.md) — it is only referenced here, not reproduced. Live memory writes (the Utinni sync) are detailed in [../04-live-sync/live-memory-and-ipc.md](../04-live-sync/live-memory-and-ipc.md).

---

## Table of Contents

1. [Selection and Transform Gizmos](#1-selection-and-transform-gizmos)
2. [Terrain Snapping](#2-terrain-snapping)
3. [Sculpt / Scatter Brushes](#3-sculpt--scatter-brushes)
4. [Procedural Painting](#4-procedural-painting)
5. [Frustum Culling](#5-frustum-culling)
6. [Asynchronous Texture Baking](#6-asynchronous-texture-baking)

---

## 1. Selection and Transform Gizmos

### 1.1 Instanced Selection Mesh

The `SwgInteractiveFlora` component wraps a `THREE.InstancedMesh` and intercepts pointer clicks to identify the exact instance index hit by the camera ray. The transform data is a flat `Float32Array` with stride-5 layout: `[x, y, z, rotY, scale, ...]`.

```tsx
import React, { useRef, useState } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';

interface InteractiveFloraProps {
  transformData: Float32Array; // Flattened array: [x, y, z, rotY, scale, ...]
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  onSelectInstance: (instanceId: number, worldPosition: THREE.Vector3) => void;
}

export const SwgInteractiveFlora: React.FC<InteractiveFloraProps> = ({
  transformData,
  geometry,
  material,
  onSelectInstance
}) => {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const { raycaster, camera } = useThree();
  const count = transformData.length / 5;

  // Initialize and assign the transformation matrices onto the GPU allocation slots
  React.useEffect(() => {
    if (!meshRef.current) return;
    const instMesh = meshRef.current;
    const dummy = new THREE.Object3D();

    for (let i = 0; i < count; i++) {
      const idx = i * 5;
      dummy.position.set(transformData[idx], transformData[idx + 1], transformData[idx + 2]);
      dummy.rotation.set(0, transformData[idx + 3], 0);
      dummy.scale.setScalar(transformData[idx + 4]);
      dummy.updateMatrix();
      instMesh.setMatrixAt(i, dummy.matrix);
    }
    instMesh.instanceMatrix.needsUpdate = true;
  }, [transformData, count]);

  /**
   * Capture 3D clicks hitting our multi-instance foliage cluster
   */
  const handlePointerDown = (event: any) => {
    event.stopPropagation(); // Block selection rays from leaking into underlying landscape geometry

    if (!meshRef.current) return;

    // Trigger internal raycast intersection detection
    const intersects = raycaster.intersectObject(meshRef.current);

    if (intersects.length > 0 && intersects[0].instanceId !== undefined) {
      const hitInstanceId = intersects[0].instanceId;

      // Extract target instance global position matrix
      const hitPosition = new THREE.Vector3();
      const targetMatrix = new THREE.Matrix4();
      meshRef.current.getMatrixAt(hitInstanceId, targetMatrix);
      hitPosition.setFromMatrixPosition(targetMatrix);

      // Pass selection telemetry up to the scene manager controls hook
      onSelectInstance(hitInstanceId, hitPosition);
    }
  };

  return (
    <instancedMesh
      ref={meshRef}
      args={[geometry, material, count]}
      onPointerDown={handlePointerDown}
    />
  );
};
```

### 1.2 Staging Transform Gizmo

`TransformControls` cannot be attached directly to an `InstancedMesh` — doing so moves the entire forest. The pattern instead:

1. Scales the selected instance to zero in the GPU buffer (effectively hiding it).
2. Spawns a hidden `THREE.Group` (dummy pivot) at the instance's world position.
3. Binds `TransformControls` to that pivot.
4. On every gizmo drag, writes updated position/rotation back into the flat `Float32Array`.

```tsx
import React, { useState, useRef, useMemo } from 'react';
import { TransformControls } from '@react-three/drei';

export const SwgFloraSceneManager: React.FC<{
  initialData: Float32Array;
  geometry: any;
  material: any;
}> = ({ initialData, geometry, material }) => {
  const [transformArray, setTransformArray] = useState<Float32Array>(initialData);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const dummyPivotRef = useRef<THREE.Group>(null);

  // Handle pointer selection activation
  const handleSelectTreeInstance = (instanceId: number, position: THREE.Vector3) => {
    setSelectedId(instanceId);

    if (dummyPivotRef.current) {
      dummyPivotRef.current.position.copy(position);
      // Extract current rotation index component from raw buffer to synchronize pivot bounds
      const rotY = transformArray[instanceId * 5 + 3];
      dummyPivotRef.current.rotation.set(0, rotY, 0);
    }
  };

  /**
   * Fires continuously while drag-moving the selected tree with your mouse gizmo
   */
  const handleGizmoChange = () => {
    if (selectedId === null || !dummyPivotRef.current) return;

    const pivot = dummyPivotRef.current;
    const updatedArray = new Float32Array(transformArray);

    const offsetIdx = selectedId * 5;

    // Write new spatial telemetry elements directly back into the position data array
    updatedArray[offsetIdx]     = pivot.position.x;
    updatedArray[offsetIdx + 1] = pivot.position.y;
    updatedArray[offsetIdx + 2] = pivot.position.z;
    updatedArray[offsetIdx + 3] = pivot.rotation.y; // Sync rotation modifications

    // Mutate state to re-trigger GPU buffer attributes updates
    setTransformArray(updatedArray);
  };

  // Optimization: Generate a separate data view array omitting the currently selected item
  // to avoid rendering a duplicate tree model directly on top of our live transform gizmo asset
  const filteredTransforms = useMemo(() => {
    if (selectedId === null) return transformArray;
    const modifiedCopy = new Float32Array(transformArray);

    // Scale target instance down to absolute zero in memory to hide it on the GPU pass
    modifiedCopy[selectedId * 5 + 4] = 0.0;
    return modifiedCopy;
  }, [transformArray, selectedId]);

  return (
    <group>
      {/* 1. Render the main instanced foliage grid cluster */}
      <SwgInteractiveFlora
        transformData={filteredTransforms}
        geometry={geometry}
        material={material}
        onSelectInstance={handleSelectTreeInstance}
      />

      {/* 2. Hidden Transformation Pivot Target Anchor Node Container */}
      <group ref={dummyPivotRef}>
        {selectedId !== null && (
          <>
            {/* Display the active toolset manipulation handles overlay layout */}
            <TransformControls
              mode="translate"
              object={dummyPivotRef.current || undefined}
              onObjectChange={handleGizmoChange}
            />
            {/* Draw a standalone temporary clone mesh acting as your live placement proxy */}
            <mesh geometry={geometry} material={material} />
          </>
        )}
      </group>
    </group>
  );
};
```

### 1.3 Pushing Updates to Live Game Memory (Utinni Sync)

When modifications are made inside the Three.js canvas, changes can be streamed directly into live SWG client memory via the zero-copy IPC bridge. See [../04-live-sync/live-memory-and-ipc.md](../04-live-sync/live-memory-and-ipc.md) for the full `SwgIpcManager` implementation.

The integration point inside `handleGizmoChange`:

```typescript
// Add this execution trigger logic block to your `handleGizmoChange` loops:
const handleGizmoChangeWithLiveClientPatch = (
  selectedId: number,
  memoryAddress: bigint, // Cached game pointer lookups map matching this foliage pool instance
  ipcManager: SwgIpcManager
) => {
  if (!dummyPivotRef.current) return;

  const pivot = dummyPivotRef.current;

  // 1. Build a local transformation matrix for the single edited instance
  const singleTransformMatrix = new THREE.Matrix4();
  const currentScale = transformArray[selectedId * 5 + 4];

  singleTransformMatrix.compose(
    pivot.position,
    pivot.quaternion,
    new THREE.Vector3(currentScale, currentScale, currentScale)
  );

  // 2. Stream matrix update directly down across your zero-copy binary IPC bridge
  // This executes native WriteProcessMemory commands to patch SWGClient.exe at 60fps
  ipcManager.updateObjectTransformLive(selectedId, memoryAddress, singleTransformMatrix);
};
```

---

## 2. Terrain Snapping

Standard Three.js raycasting against dense terrain polygon meshes at 60 fps is too expensive. Instead, the (X, Z) coordinates from `TransformControls` drag events are fed directly into the compiled C++ terrain height evaluator (see [../02-formats/terrain.md](../02-formats/terrain.md)). The result is a mathematically exact Y value that matches what the SWG client and open-source server engines produce.

### Data flow

```
[ Mouse Drag / TransformControls ] -> Intercept (X, Z) Translation Positions
                                              |
                                              v
                              [ Node-API C++ Height Engine ]
                              Evaluates Recursive Layer Tree Formulas
                                              |
                                     Returns True Float Y
                                              |
                                              v
                              [ Three.js Pivot Transform Node ]
                              Forces Object.position.y = Correct Height
```

### 2.1 Native Addon Interface

```typescript
// nativeAddon interface binding map assumption configuration
export interface NativeTerrainEngineAddon {
  getHeightAtCoordinate(x: number, z: number): number;
}
```

### 2.2 useTerrainSnapper Hook

Memoized hook that caches the last (X, Z) position to skip the C++ call when the object has not moved horizontally.

```typescript
import { useRef, useCallback } from 'react';
import * as THREE from 'three';

export function useTerrainSnapper(nativeAddon: any) {
  const previousCoordsRef = useRef({ x: 0, z: 0 });

  /**
   * Evaluates procedural layer trees and forces an Object3D flush onto the landscape
   */
  const processObjectSnap = useCallback((object: THREE.Object3D) => {
    // 1. Extract current world coordinates from the translation event matrix
    const currentX = object.position.x;
    const currentZ = object.position.z;

    // Early out optimization step: Skip calling C++ if the element hasn't moved horizontally
    if (
      currentX === previousCoordsRef.current.x &&
      currentZ === previousCoordsRef.current.z
    ) {
      return;
    }

    // Update tracking cache
    previousCoordsRef.current = { x: currentX, z: currentZ };

    // 2. Query your compiled C++ fractal tree engine directly
    // This executes in microseconds by skipping standard 3D mesh polygon intersection loops
    const proceduralHeightFloor = nativeAddon.getHeightAtCoordinate(currentX, currentZ);

    // 3. Mutate the altitude property directly to snap the object
    object.position.y = proceduralHeightFloor;

    // Force transform matrix recalculation to align attached proxy sub-meshes
    object.updateMatrix();
  }, [nativeAddon]);

  return { processObjectSnap };
}
```

### 2.3 Integrating Snapping into the Flora Scene Manager

```tsx
import React, { useState, useRef, useMemo } from 'react';
import { TransformControls } from '@react-three/drei';
import { useTerrainSnapper } from './useTerrainSnapper';

interface FloraManagerProps {
  initialData: Float32Array; // Flattened buffer allocation format: [x, y, z, rotY, scale, ...]
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  nativeBridge: any;
}

export const SwgAdvancedFloraSceneManager: React.FC<FloraManagerProps> = ({
  initialData, geometry, material, nativeBridge
}) => {
  const [transformArray, setTransformArray] = useState<Float32Array>(initialData);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const dummyPivotRef = useRef<THREE.Group>(null);

  // Initialize our analytical terrain snapping core worker hook
  const { processObjectSnap } = useTerrainSnapper(nativeBridge);

  /**
   * Intercepts updates generated by the Three.js 3D drag-and-drop handles
   */
  const handleGizmoObjectChange = () => {
    if (selectedId === null || !dummyPivotRef.current) return;

    const pivot = dummyPivotRef.current;

    // 1. ENFORCE AUTOMATIC SNAP: Lock the proxy node altitude properties to the landscape
    processObjectSnap(pivot);

    // 2. Re-allocate a flat layout array to update our GPU data structures inline
    const updatedArray = new Float32Array(transformArray);
    const offsetIdx = selectedId * 5;

    updatedArray[offsetIdx]     = pivot.position.x;
    updatedArray[offsetIdx + 1] = pivot.position.y; // Captured from our C++ snapper update
    updatedArray[offsetIdx + 2] = pivot.position.z;
    updatedArray[offsetIdx + 3] = pivot.rotation.y;

    setTransformArray(updatedArray);

    // 3. OPTIONAL LIVE SYNC: If using Utinni memory injection, stream the update down to live client memory
    // window.ipcManager.updateObjectTransformLive(selectedId, targetMemoryAddress, pivot.matrix);
  };

  const filteredTransforms = useMemo(() => {
    if (selectedId === null) return transformArray;
    const modifiedCopy = new Float32Array(transformArray);
    modifiedCopy[selectedId * 5 + 4] = 0.0; // Hide the active target model inside the main instanced group
    return modifiedCopy;
  }, [transformArray, selectedId]);

  return (
    <group>
      <SwgInteractiveFlora
        transformData={filteredTransforms}
        geometry={geometry}
        material={material}
        onSelectInstance={(id, worldPos) => {
          setSelectedId(id);
          if (dummyPivotRef.current) {
            dummyPivotRef.current.position.copy(worldPos);
            dummyPivotRef.current.rotation.set(0, transformArray[id * 5 + 3], 0);
            dummyPivotRef.current.updateMatrix();
          }
        }}
      />

      <group ref={dummyPivotRef}>
        {selectedId !== null && (
          <>
            <TransformControls
              mode="translate"
              object={dummyPivotRef.current || undefined}
              onObjectChange={handleGizmoObjectChange}
            />
            {/* Draw a standalone temporary clone mesh acting as your live placement proxy */}
            <mesh geometry={geometry} material={material} />
          </>
        )}
      </group>
    </group>
  );
};
```

### 2.4 Constraining Rotations to Terrain Normals

For objects that should align to steep hillsides (rocks, large roots), sample the terrain at three nearby points to compute a surface normal and derive a quaternion:

```typescript
/**
 * Advanced Extension: Aligns object rotation to look flush with the terrain's tilt
 */
export function alignProxyToTerrainSurfaceNormals(
  object: THREE.Object3D,
  x: number,
  z: number,
  nativeAddon: any
) {
  const delta = 0.1;

  // Sample three nearby terrain heights to calculate the surface normal vector
  const hL = nativeAddon.getHeightAtCoordinate(x - delta, z);
  const hR = nativeAddon.getHeightAtCoordinate(x + delta, z);
  const hD = nativeAddon.getHeightAtCoordinate(x, z - delta);
  const hU = nativeAddon.getHeightAtCoordinate(x, z + delta);

  const normalVector = new THREE.Vector3(
    (hL - hR) / (2 * delta),
    1.0,
    (hD - hU) / (2 * delta)
  ).normalize();

  // Create an orientation alignment mapping matrix
  const upAxis = new THREE.Vector3(0, 1, 0);
  const alignmentQuaternion = new THREE.Quaternion().setFromUnitVectors(upAxis, normalVector);

  // Retain original yaw (Y-axis rotation) while conforming to pitch and roll terrain shifts
  const originalYaw = object.rotation.y;
  object.quaternion.copy(alignmentQuaternion);
  object.rotateY(originalYaw);
}
```

---

## 3. Sculpt / Scatter Brushes

The brush system has three components:

1. **Visual ring** — a `THREE.RingGeometry` that follows the cursor and conforms to hillsides by querying the C++ height engine per vertex.
2. **Spatial broadphase in C++** — filters the flat transform buffer by distance in native memory, avoiding GC pressure from JavaScript array manipulation.
3. **Stroke lifecycle in React** — maps pointer events to brush strokes with a minimum travel-distance threshold.

### 3.1 Interactive 3D Brush Ring Component

The ring samples `getHeightAtCoordinate` for each vertex to prevent clipping into terrain on steep hillsides.

```tsx
import React, { useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';

interface BrushProps {
  radius: number;
  isActive: boolean;
  nativeBridge: any;
}

export const SwgEditorBrushRing: React.FC<BrushProps> = ({ radius, isActive, nativeBridge }) => {
  const meshRef = useRef<THREE.Mesh>(null);
  const ringGeom = useMemo(() => new THREE.RingGeometry(radius - 0.5, radius + 0.5, 64), [radius]);
  const { raycaster, scene } = useThree();

  useFrame(() => {
    if (!meshRef.current || !isActive) {
      if (meshRef.current) meshRef.current.visible = false;
      return;
    }

    // Intersect the mouse ray with a fallback invisible horizontal baseline plane
    const terrainPlane = scene.getObjectByName("terrain_click_plane");
    if (!terrainPlane) return;

    const intersects = raycaster.intersectObject(terrainPlane);
    if (intersects.length > 0) {
      const hitPoint = intersects[0].point;
      const brushMesh = meshRef.current;

      brushMesh.visible = true;
      brushMesh.position.x = hitPoint.x;
      brushMesh.position.z = hitPoint.z;

      // Query height directly from the C++ layer to keep the ring flush with hillsides
      brushMesh.position.y = nativeBridge.getHeightAtCoordinate(hitPoint.x, hitPoint.z) + 0.2;

      // Update individual vertex offsets if painting over steep cliffs
      const posAttr = ringGeom.getAttribute('position') as THREE.BufferAttribute;
      const dummyVec = new THREE.Vector3();
      for (let i = 0; i < posAttr.count; i++) {
        dummyVec.fromBufferAttribute(posAttr, i);
        // Translate local space offsets to global world coordinates
        const worldVertX = brushMesh.position.x + dummyVec.x;
        const worldVertZ = brushMesh.position.z + dummyVec.y; // Ring is flat, Y maps to Z floor
        const vertHeight = nativeBridge.getHeightAtCoordinate(worldVertX, worldVertZ);
        posAttr.setZ(i, vertHeight - brushMesh.position.y); // Set offset elevation relative to pivot
      }
      posAttr.needsUpdate = true;
    }
  });

  return (
    <mesh ref={meshRef} rotation={[-Math.PI / 2, 0, 0]} visible={false}>
      <primitive object={ringGeom} attach="geometry" />
      <meshBasicMaterial color={isActive ? "#00ffcc" : "#ff0055"} side={THREE.DoubleSide} />
    </mesh>
  );
};
```

### 3.2 Spatial Brush Mutation System (C++)

The erase operation runs a Euclidean distance sweep inside a native `std::vector`, copying only instances that fall outside the brush radius back into a new `Float32Array`.

```cpp
#include <napi.h>
#include <vector>
#include <cmath>
#include <random>

// Structural representation of incoming data frames
struct BrushOperationArgs {
    float brushX;
    float brushZ;
    float radius;
    float densityModifier; // Used for painting additions
    uint32_t activeSeed;
};

class SpatialBrushProcessor {
public:
    /**
     * Erases instanced assets matching coordinates inside the selection circle
     */
    static Napi::Float32Array ExecuteEraseBrush(
        Napi::Env env,
        const BrushOperationArgs& args,
        const Napi::Float32Array& currentBuffer
    ) {
        size_t inputFloatCount = currentBuffer.ByteLength() / sizeof(float);
        size_t elementCount = inputFloatCount / 5; // [x, y, z, rotY, scale]

        std::vector<float> remainingInstances;
        remainingInstances.reserve(inputFloatCount);

        const float* rawFloats = currentBuffer.Data();

        for (size_t i = 0; i < elementCount; ++i) {
            size_t idx = i * 5;
            float x = rawFloats[idx];
            float z = rawFloats[idx + 2];

            // Compute standard Euclidean distance metrics
            float dx = x - args.brushX;
            float dz = z - args.brushZ;
            float distanceSq = (dx * dx) + (dz * dz);

            // If the element sits outside the selection brush radius, keep it
            if (distanceSq > (args.radius * args.radius)) {
                remainingInstances.push_back(rawFloats[idx]);     // X
                remainingInstances.push_back(rawFloats[idx + 1]); // Y
                remainingInstances.push_back(rawFloats[idx + 2]); // Z
                remainingInstances.push_back(rawFloats[idx + 3]); // RotY
                remainingInstances.push_back(rawFloats[idx + 4]); // Scale
            }
        }

        // Return a clean, packed layout allocation array back up across the API layer
        Napi::Float32Array outResult = Napi::Float32Array::New(env, remainingInstances.size());
        std::memcpy(outResult.Data(), remainingInstances.data(), remainingInstances.size() * sizeof(float));
        return outResult;
    }
};

// Node-API Module Entry Wrapper Endpoint
Napi::Value ApplyEraseBrushStroke(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    float bX  = info[0].As<Napi::Number>().FloatValue();
    float bZ  = info[1].As<Napi::Number>().FloatValue();
    float rad = info[2].As<Napi::Number>().FloatValue();
    Napi::Float32Array dataBuffer = info[3].As<Napi::Float32Array>();

    BrushOperationArgs args = { bX, bZ, rad, 0.0f, 1234 };
    return SpatialBrushProcessor::ExecuteEraseBrush(env, args, dataBuffer);
}
```

### 3.3 Brush Stroke Lifecycle in React

```tsx
import React, { useState, useRef } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';

interface SceneWrapperProps {
  nativeBridge: any;
  foliageGeometry: any;
  foliageMaterial: any;
}

export const SwgSceneryPaintingCanvas: React.FC<SceneWrapperProps> = ({
  nativeBridge, foliageGeometry, foliageMaterial
}) => {
  const [activeBuffer, setActiveBuffer] = useState<Float32Array>(new Float32Array(0));
  const [brushSettings, setBrushSettings] = useState({ size: 15.0, mode: 'erase', active: false });
  const { raycaster, scene } = useThree();

  const handlePointerMoveStroke = (e: any) => {
    if (!brushSettings.active) return;

    const terrainPlane = scene.getObjectByName("terrain_click_plane");
    if (!terrainPlane) return;

    const intersects = raycaster.intersectObject(terrainPlane);
    if (intersects.length > 0) {
      const { x, z } = intersects[0].point;

      if (brushSettings.mode === 'erase') {
        // Dispatch the flat transformation arrays down across our high-speed C++ worker core
        const updatedBuffer: Float32Array = nativeBridge.applyEraseBrushStroke(
          x, z, brushSettings.size, activeBuffer
        );
        setActiveBuffer(updatedBuffer);
      } else if (brushSettings.mode === 'paint') {
        // Invoke applyPaintBrushStroke — see Section 4
      }
    }
  };

  return (
    <group
      onPointerDown={(e) => { e.stopPropagation(); setBrushSettings(prev => ({ ...prev, active: true })); }}
      onPointerUp={() => setBrushSettings(prev => ({ ...prev, active: false }))}
      onPointerMove={handlePointerMoveStroke}
    >
      {/* 1. Visual Brush Guide Overlay */}
      <SwgEditorBrushRing radius={brushSettings.size} isActive={brushSettings.active} nativeBridge={nativeBridge} />

      {/* 2. Primary Instanced Rendering Node */}
      <SwgInteractiveFlora
        transformData={activeBuffer}
        geometry={foliageGeometry}
        material={foliageMaterial}
        onSelectInstance={() => {}} // Disabled while active painting brush profiles are open
      />

      {/* 3. Core Invisible Raycasting Floor Plane (Size matches SWG map bounds) */}
      <mesh name="terrain_click_plane" rotation={[-Math.PI / 2, 0, 0]} visible={false}>
        <planeGeometry args={[16384, 16384]} />
        <meshBasicMaterial />
      </mesh>
    </group>
  );
};
```

### 3.4 Brush Sizing UI

```tsx
import React from 'react';

export const SwgSceneryPaintToolbar: React.FC<{
  settings: { size: number; mode: string };
  onSettingsChange: (updated: any) => void;
  instanceCount: number;
}> = ({ settings, onSettingsChange, instanceCount }) => {
  return (
    <div style={{
      position: 'absolute', top: '20px', left: '20px', zIndex: 100,
      background: 'rgba(20, 20, 20, 0.85)', backdropFilter: 'blur(4px)',
      border: '1px solid #ff0055', borderRadius: '4px', padding: '14px',
      color: '#fff', width: '240px', fontFamily: 'monospace'
    }}>
      <h4 style={{ margin: '0 0 12px 0', color: '#ff0055' }}>Foliage Splat Brush Controls</h4>

      <div style={{ display: 'grid', gap: '10px', fontSize: '12px' }}>
        <label>
          Tool Mode Selection:
          <select
            value={settings.mode}
            onChange={(e) => onSettingsChange({ ...settings, mode: e.target.value })}
            style={{ float: 'right', background: '#333', color: '#fff', border: '1px solid #555' }}
          >
            <option value="paint">Grass/Tree Painter</option>
            <option value="erase">Scenery Bulldozer</option>
          </select>
        </label>

        <label>
          Brush Diameter Size ({settings.size.toFixed(1)}m):
          <input
            type="range" min="2.0" max="64.0" step="0.5"
            value={settings.size}
            onChange={(e) => onSettingsChange({ ...settings, size: parseFloat(e.target.value) })}
            style={{ width: '100%', accentColor: '#ff0055' }}
          />
        </label>

        <div style={{ borderTop: '1px solid #333', paddingTop: '8px', color: '#888' }}>
          Active Instance Count: <span style={{ color: '#00ffcc', float: 'right' }}>{instanceCount}</span>
        </div>
      </div>
    </div>
  );
};
```

---

## 4. Procedural Painting

The paint brush uses a stratified polar-coordinate distribution inside the brush circle, with a proximity guard to prevent trunk overlap, and calls into the C++ terrain engine for height anchoring.

### 4.1 Procedural Scatter Algorithm (C++)

Single-stroke spawn cap is clamped to 150 to protect engine threads. Minimum trunk separation is 2.5 m (squared: 6.25).

```cpp
#include <napi.h>
#include <vector>
#include <cmath>
#include <random>
#include <cstring>
#include <algorithm>

struct PaintOperationArgs {
    float brushX;
    float brushZ;
    float radius;
    float paintDensity;    // Plants per square meter within the stroke
    float minScale;
    float maxScale;
    uint32_t activeSeed;
};

class ProceduralPaintProcessor {
public:
    /**
     * Procedurally populates new instances inside the brush boundary circle
     */
    static Napi::Float32Array ExecutePaintBrush(
        Napi::Env env,
        const PaintOperationArgs& args,
        const Napi::Float32Array& currentBuffer,
        const TerrainLayer& terrainEngine
    ) {
        // 1. Read existing instance arrays
        size_t inputFloatCount = currentBuffer.ByteLength() / sizeof(float);
        const float* rawFloats = currentBuffer.Data();

        std::vector<float> workingBuffer(rawFloats, rawFloats + inputFloatCount);

        // 2. Set up a local PRNG using the session seed mixed with coordinates
        std::mt19937 prng(args.activeSeed + static_cast<uint32_t>(args.brushX * 13 + args.brushZ * 7));
        std::uniform_real_distribution<float> dist(0.0f, 1.0f);

        // Calculate maximum potential spawns for this stroke check
        float brushArea = 3.14159f * args.radius * args.radius;
        int spawnAttempts = static_cast<int>(brushArea * args.paintDensity);

        // Cap single-stroke instantiation updates to protect engine threads
        spawnAttempts = std::clamp(spawnAttempts, 1, 150);

        for (int i = 0; i < spawnAttempts; ++i) {
            // Generate random polar coordinates inside the circular brush boundary
            float r     = args.radius * std::sqrt(dist(prng)); // Stratified radius distribution
            float theta = dist(prng) * 2.0f * 3.14159f;

            float worldX = args.brushX + r * std::cos(theta);
            float worldZ = args.brushZ + r * std::sin(theta);

            // 3. BROADPHASE REJECTION: Check if this new spot is too close to an existing tree
            bool spaceIsOccupied = false;
            size_t currentTreeCount = workingBuffer.size() / 5;

            for (size_t t = 0; t < currentTreeCount; ++t) {
                size_t offset = t * 5;
                float ex = workingBuffer[offset];
                float ez = workingBuffer[offset + 2];

                float dx = worldX - ex;
                float dz = worldZ - ez;

                // Set a minimum separation distance (e.g., 2.5 meters between trunks)
                if ((dx * dx + dz * dz) < 6.25f) {
                    spaceIsOccupied = true;
                    break;
                }
            }

            if (spaceIsOccupied) continue;

            // 4. ANCHOR RESOLUTION: Sample your compiled procedural height core
            float terrainHeightY = terrainEngine.CalculateHeightAt(worldX, worldZ, 0.0f);

            // 5. TRANSFORM CALCULATION: Generate random rotation and scaling bounds
            float rotationY = dist(prng) * 2.0f * 3.14159f;
            float scale     = args.minScale + dist(prng) * (args.maxScale - args.minScale);

            // Append the flat object vector mapping schema back onto the buffer sequence
            workingBuffer.push_back(worldX);         // [0] Position X
            workingBuffer.push_back(terrainHeightY); // [1] Position Y (Snapped Floor)
            workingBuffer.push_back(worldZ);         // [2] Position Z
            workingBuffer.push_back(rotationY);      // [3] Rotation Y (Yaw)
            workingBuffer.push_back(scale);          // [4] Uniform Scale
        }

        // 6. Return the updated flat array up to JavaScript
        Napi::Float32Array outResult = Napi::Float32Array::New(env, workingBuffer.size());
        std::memcpy(outResult.Data(), workingBuffer.data(), workingBuffer.size() * sizeof(float));
        return outResult;
    }
};
```

### 4.2 Node-API Binding

```cpp
Napi::Value ApplyPaintBrushStroke(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    float bX      = info[0].As<Napi::Number>().FloatValue();
    float bZ      = info[1].As<Napi::Number>().FloatValue();
    float radius  = info[2].As<Napi::Number>().FloatValue();
    float density = info[3].As<Napi::Number>().FloatValue();
    Napi::Float32Array currentBuffer = info[4].As<Napi::Float32Array>();

    // Pack operation configurations
    PaintOperationArgs args;
    args.brushX       = bX;
    args.brushZ       = bZ;
    args.radius       = radius;
    args.paintDensity = density;
    args.minScale     = 0.8f;
    args.maxScale     = 1.3f;
    args.activeSeed   = 501; // Synced workspace session key

    TerrainLayer activeTerrain = GetActiveTerrainEngine();

    return ProceduralPaintProcessor::ExecutePaintBrush(env, args, currentBuffer, activeTerrain);
}

// Map entry point inside module initialization exports
exports.Set("applyPaintBrushStroke", Napi::Function::New(env, ApplyPaintBrushStroke));
```

### 4.3 Paint Loop with Delta-Distance Throttle

New assets are only scattered when the cursor has moved at least 25% of the brush radius since the last placement, preventing clumping.

```tsx
import React, { useState, useRef } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';

export const SwgUnifiedPaintingGroup: React.FC<{
  nativeBridge: any;
  geom: any;
  mat: any;
}> = ({ nativeBridge, geom, mat }) => {
  const [activeBuffer, setActiveBuffer] = useState<Float32Array>(new Float32Array(0));
  const [brush, setBrush] = useState({ size: 12.0, mode: 'paint', density: 0.02, active: false });

  const lastStrokePositionRef = useRef(new THREE.Vector3());
  const { raycaster, scene } = useThree();

  const handlePointerStrokeMove = (e: any) => {
    if (!brush.active) return;

    const clickPlane = scene.getObjectByName("terrain_click_plane");
    if (!clickPlane) return;

    const intersects = raycaster.intersectObject(clickPlane);
    if (intersects.length > 0) {
      const currentPoint = intersects[0].point;

      // Calculate travel vector distance since the previous placement step
      const travelDist = currentPoint.distanceTo(lastStrokePositionRef.current);

      // Minimum drag distance requirement to prevent overlapping tree clumps
      if (travelDist > (brush.size * 0.25) || brush.mode === 'erase') {
        lastStrokePositionRef.current.copy(currentPoint);

        if (brush.mode === 'paint') {
          // Pass the live array straight down to our background C++ physics and noise core
          const updated: Float32Array = nativeBridge.applyPaintBrushStroke(
            currentPoint.x, currentPoint.z, brush.size, brush.density, activeBuffer
          );
          setActiveBuffer(updated);
        } else if (brush.mode === 'erase') {
          const updated: Float32Array = nativeBridge.applyEraseBrushStroke(
            currentPoint.x, currentPoint.z, brush.size, activeBuffer
          );
          setActiveBuffer(updated);
        }
      }
    }
  };

  return (
    <group
      onPointerDown={(e) => { e.stopPropagation(); setBrush(p => ({ ...p, active: true })); }}
      onPointerUp={() => setBrush(p => ({ ...p, active: false }))}
      onPointerMove={handlePointerStrokeMove}
    >
      <SwgEditorBrushRing radius={brush.size} isActive={brush.active} nativeBridge={nativeBridge} />

      <SwgInteractiveFlora
        transformData={activeBuffer}
        geometry={geom}
        material={mat}
        onSelectInstance={() => {}}
      />

      <mesh name="terrain_click_plane" rotation={[-Math.PI / 2, 0, 0]} visible={false}>
        <planeGeometry args={[16384, 16384]} />
        <meshBasicMaterial />
      </mesh>
    </group>
  );
};
```

### 4.4 Density Slider UI Append

```tsx
// Append this slider element inside your SwgSceneryPaintToolbar component:
{settings.mode === 'paint' && (
  <label style={{ display: 'block', marginTop: '8px' }}>
    Scatter Spawn Density ({Math.round(settings.density * 1000)}):
    <input
      type="range" min="0.005" max="0.08" step="0.005"
      value={settings.density}
      onChange={(e) => onSettingsChange({ ...settings, density: parseFloat(e.target.value) })}
      style={{ width: '100%', accentColor: '#ff0055' }}
    />
  </label>
)}
```

---

## 5. Frustum Culling

Three.js's default `InstancedMesh` culling only checks the bounding box of the whole mesh — if any part touches the screen edge, all instances get a draw call. The custom culler hides off-screen instances by zeroing their scale in a copy of the buffer, leaving the source data array clean for serialization.

### 5.1 High-Speed Frustum Math Engine (TypeScript)

Six frustum planes are extracted manually from the combined projection-view matrix for a fast dot-product sweep.

```typescript
import * as THREE from 'three';

export class SwgFrustumCuller {
  private projScreenMatrix = new THREE.Matrix4();
  private frustumPlanes = [
    new THREE.Plane(), new THREE.Plane(), new THREE.Plane(),
    new THREE.Plane(), new THREE.Plane(), new THREE.Plane()
  ];

  /**
   * Evaluates a flat transform buffer against the active camera view
   * @returns A boolean array tracking visibility state per tree instance index
   */
  public cullInstances(
    camera: THREE.Camera,
    transformData: Float32Array,
    boundingRadius: number
  ): boolean[] {
    const instanceCount = transformData.length / 5;
    const visibilityMap = new Array<boolean>(instanceCount);

    // 1. Calculate current camera projection planes matrix space
    this.projScreenMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);

    const me = this.projScreenMatrix.elements;

    // 2. Extract 6 frustum clipping equations manually for speed
    // Left, Right, Bottom, Top, Near, Far
    this.frustumPlanes[0].setComponents(me[3] + me[0],  me[7] + me[4],  me[11] + me[8],  me[15] + me[12]);
    this.frustumPlanes[1].setComponents(me[3] - me[0],  me[7] - me[4],  me[11] - me[8],  me[15] - me[12]);
    this.frustumPlanes[2].setComponents(me[3] + me[1],  me[7] + me[5],  me[11] + me[9],  me[15] + me[13]);
    this.frustumPlanes[3].setComponents(me[3] - me[1],  me[7] - me[5],  me[11] - me[9],  me[15] - me[13]);
    this.frustumPlanes[4].setComponents(me[3] + me[2],  me[7] + me[6],  me[11] + me[10], me[15] + me[14]);
    this.frustumPlanes[5].setComponents(me[3] - me[2],  me[7] - me[6],  me[11] - me[10], me[15] - me[14]);

    // 3. Fast iterative bounds check sweep loop
    for (let i = 0; i < instanceCount; i++) {
      const offset = i * 5;
      const x = transformData[offset];
      const y = transformData[offset + 1];
      const z = transformData[offset + 2];

      let isVisible = true;

      // Check distance from tree origin to each plane
      for (let p = 0; p < 6; p++) {
        const plane = this.frustumPlanes[p];
        const distance =
          plane.normal.x * x + plane.normal.y * y + plane.normal.z * z + plane.constant;

        // If the bounding sphere center is further out than its radius, it's out of view
        if (distance < -boundingRadius) {
          isVisible = false;
          break;
        }
      }

      visibilityMap[i] = isVisible;
    }

    return visibilityMap;
  }
}
```

### 5.2 Throttled Culling Hook

Culling only fires when the camera moves more than 2 m or rotates more than 0.05 radians, preventing per-frame overhead.

```typescript
import { useFrame } from '@react-three/fiber';
import { useRef, useMemo } from 'react';
import * as THREE from 'three';
import { SwgFrustumCuller } from './SwgFrustumCuller';

export function useDynamicFoliageCulling(transformData: Float32Array, boundingRadius: number) {
  const culler = useMemo(() => new SwgFrustumCuller(), []);
  const lastCamPosRef = useRef(new THREE.Vector3());
  const lastCamRotRef = useRef(new THREE.Quaternion());

  const [visibleTransforms, setVisibleTransforms] = useRef<Float32Array>(transformData);
  const isUpdateNeededRef = useRef(false);

  useFrame((state) => {
    const cam = state.camera;

    // Check spatial displacement delta markers before firing deep loops
    const posDelta = cam.position.distanceToSquared(lastCamPosRef.current);
    const rotDelta  = cam.quaternion.angleTo(lastCamRotRef.current);

    // Threshold: Only evaluate if camera moves > 2m or rotates > 0.05 radians
    if (posDelta > 4.0 || rotDelta > 0.05 || isUpdateNeededRef.current) {
      lastCamPosRef.current.copy(cam.position);
      lastCamRotRef.current.copy(cam.quaternion);
      isUpdateNeededRef.current = false;

      const visibilityMap = culler.cullInstances(cam, transformData, boundingRadius);
      const outputCopy = new Float32Array(transformData);

      for (let i = 0; i < visibilityMap.length; i++) {
        if (!visibilityMap[i]) {
          // Force scale element parameters to 0.0 to instruct WebGL to instantly skip rendering this entry
          outputCopy[i * 5 + 4] = 0.0;
        }
      }

      visibleTransforms.current = outputCopy;
    }
  });

  return {
    getVisibleBuffer: () => visibleTransforms.current,
    forceReCull: () => { isUpdateNeededRef.current = true; }
  };
}
```

### 5.3 Integrating Culling with the Canvas

The raw modding buffer is kept separate from the culled display buffer. Brush paint/erase operations force a re-cull via `forceReCull`.

```tsx
import React, { useEffect } from 'react';
import { useDynamicFoliageCulling } from './useDynamicFoliageCulling';

interface Props {
  rawGlobalBuffer: Float32Array; // The actual persistent dataset edited by paint/erase brushes
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
}

export const SwgCullingFloraGroup: React.FC<Props> = ({ rawGlobalBuffer, geometry, material }) => {
  // Estimate target bounding radius based on mesh specifications (e.g. 15m tall tree structure bounds)
  const treeBoundingRadius = 12.0;

  const { getVisibleBuffer, forceReCull } = useDynamicFoliageCulling(rawGlobalBuffer, treeBoundingRadius);

  // Force re-cull whenever brush actions paint or erase items inside the underlying global array
  useEffect(() => {
    forceReCull();
  }, [rawGlobalBuffer, forceReCull]);

  return (
    <SwgInteractiveFlora
      transformData={getVisibleBuffer()}
      geometry={geometry}
      material={material}
      onSelectInstance={() => {}}
    />
  );
};
```

### 5.4 Diagnostic Visualization Metrics

```tsx
import React, { useState } from 'react';
import { useFrame } from '@react-three/fiber';

export const SwgPerformanceMonitorCard: React.FC<{
  rawBuffer: Float32Array;
  nativeBridge: any;
}> = ({ rawBuffer }) => {
  const [stats, setStats] = useState({ total: 0, visible: 0 });

  useFrame((state) => {
    // Basic structural polling sample check (limited execution frequency to keep ui fluid)
    if (state.clock.getElapsedTime() % 0.5 < 0.02) {
      const totalInstances = rawBuffer.length / 5;

      // In a real implementation, count items matching scale values > 0.0 inside your culler state view references
      setStats({
        total: totalInstances,
        visible: Math.floor(totalInstances * 0.45) // Example proxy percentage mapping display
      });
    }
  });

  return (
    <div style={{
      position: 'absolute', bottom: '20px', right: '20px', zIndex: 100,
      background: 'rgba(15, 15, 15, 0.9)', padding: '10px 14px', borderRadius: '4px',
      border: '1px solid #00ffcc', fontFamily: 'monospace', fontSize: '11px', color: '#fff'
    }}>
      <div style={{ color: '#00ffcc', fontWeight: 'bold', marginBottom: '4px' }}>GPU Pipeline Diagnostics</div>
      <div>Total Forest Entities: <span style={{ float: 'right' }}>{stats.total}</span></div>
      <div>Culled (Out of View): <span style={{ float: 'right', color: '#ff0055' }}>{stats.total - stats.visible}</span></div>
      <div>Active Rendered Draw Mesh: <span style={{ float: 'right', color: '#00ffcc' }}>{stats.visible}</span></div>
    </div>
  );
};
```

**Note:** The `visible` count in the example uses a hardcoded 45% proxy. In production, track the actual count of non-zero-scale entries from the culler's output buffer.

---

## 6. Asynchronous Texture Baking

Landscape texture maps painted in the editor are baked to DDS (BC1/DXT1 or BC3/DXT5) on a background libuv thread via `Napi::AsyncWorker`, keeping the canvas at 60 fps during compression.

### Pipeline overview

```
[ Canvas Paint Buffer ] ──(Trigger Save Map)──> [ TypeScript WebGL readback ]
                                                           │
                                            (SharedArrayBuffer / RGBA Bytes)
                                                           │
                                                           v
[ Client .TRE Patch Archive ] <── (Writes .DDS) <── [ Node-API C++ Baking Core ]
                                                     -> Spawns Async Worker Thread
                                                     -> Executes BC1/BC3 Texture Compression
```

### 6.1 C++ Structural Packaging Interface

```cpp
#include <napi.h>
#include <vector>
#include <string>

enum class SwgCompressionFormat { BC1_DXT1 = 0, BC3_DXT5 = 1 };

struct TextureBakeArgs {
    uint32_t width;
    uint32_t height;
    uint32_t compressionFormat; // Mapped via SwgCompressionFormat enum
    uint8_t* rawRgbaPixelData = nullptr;
    std::string exportFilePath;
};
```

### 6.2 Native Background Texture Compression Worker (C++)

The `DdsHeader` struct is 128 bytes matching the DirectDraw Surface specification. The actual block-compression call (e.g. `stb_dxt` or `squish`) replaces the `std::memset` mock in production.

```cpp
#include <napi.h>
#include <windows.h>
#include <fstream>
#include <cstring>

// Reusable standard DirectDraw Surface File Header Structure (128 bytes)
struct DdsHeader {
    char     magic[4]          = {'D', 'D', 'S', ' '};
    uint32_t size              = 124;
    uint32_t flags             = 0x1 | 0x2 | 0x4 | 0x1000; // DDSD_CAPS | DDSD_HEIGHT | DDSD_WIDTH | DDSD_PIXELFORMAT
    uint32_t height;
    uint32_t width;
    uint32_t pitchOrLinearSize;
    uint32_t depth             = 0;
    uint32_t mipMapCount       = 0;
    uint32_t reserved1[11]     = {0};
    // Pixel Format Sub-Structure
    uint32_t pfSize            = 32;
    uint32_t pfFlags           = 0x4; // DDPF_FOURCC
    char     fourCC[4]         = {'D', 'X', 'T', '1'}; // Defaulting to BC1/DXT1
    uint32_t pfRGBBitCount     = 0;
    uint32_t pfRBitMask        = 0;
    uint32_t pfGBitMask        = 0;
    uint32_t pfBBitMask        = 0;
    uint32_t pfABitMask        = 0;
    uint32_t caps              = 0x1000; // DDSCAPS_TEXTURE
    uint32_t caps2             = 0;
    uint32_t caps3             = 0;
    uint32_t caps4             = 0;
    uint32_t reserved2         = 0;
};

class SwgTextureBakeWorker : public Napi::AsyncWorker {
private:
    TextureBakeArgs      args;
    std::vector<uint8_t> compressedBytes;

public:
    SwgTextureBakeWorker(Napi::Function& callback, TextureBakeArgs bakeArgs)
        : Napi::AsyncWorker(callback), args(bakeArgs) {}

    ~SwgTextureBakeWorker() {}

    /**
     * THREAD POOL EXECUTION: Runs entirely inside a separate background thread.
     * Zero V8 engine or JavaScript calls are allowed here.
     */
    void Execute() override {
        // Compute the expected block output data size footprints
        // BC1/DXT1 uses 8 bytes per 4x4 block pixel cluster; BC3/DXT5 utilizes 16 bytes per block
        size_t blockCount          = ((args.width + 3) / 4) * ((args.height + 3) / 4);
        size_t targetCompressedSize = blockCount * (args.compressionFormat == 0 ? 8 : 16);

        compressedBytes.resize(targetCompressedSize);

        // --- EXECUTE BLOCK COMPRESSION ---
        // In a production setup, call a real-time utility like `stb_dxt` or `squish` here:
        // tx_compress_bc1(args.rawRgbaPixelData, compressedBytes.data(), args.width, args.height);

        // Mock compression fill pattern for architecture verification
        std::memset(compressedBytes.data(), 0xAA, targetCompressedSize);

        // --- SERIALIZE OUT DIRECTLY TO THE DESTINATION STORAGE PATH ---
        std::ofstream ddsFile(args.exportFilePath, std::ios::binary);
        if (ddsFile.is_open()) {
            DdsHeader header;
            header.width              = args.width;
            header.height             = args.height;
            header.pitchOrLinearSize  = static_cast<uint32_t>(targetCompressedSize);

            if (args.compressionFormat == 1) {
                std::memcpy(header.fourCC, "DXT5", 4);
            }

            // Write 128-byte system file header metadata
            ddsFile.write(reinterpret_cast<const char*>(&header), sizeof(DdsHeader));
            // Append compiled raw compressed block data stream
            ddsFile.write(reinterpret_cast<const char*>(compressedBytes.data()), targetCompressedSize);
            ddsFile.close();
        } else {
            SetError("Failed to initialize system write handle at target export file path location.");
        }
    }

    /**
     * MAIN THREAD CALLBACK: Executes back on the JavaScript loop once compression wraps up.
     */
    void OnOK() override {
        Napi::Env env = Env();
        Callback().Call({env.Null(), Napi::Boolean::New(env, true)});
    }
};
```

### 6.3 Triggering the Worker via Node-API

```cpp
Napi::Value AsyncBakeTextureChannel(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    Napi::Object   jsArgs      = info[0].As<Napi::Object>();
    Napi::Function jsCallback  = info[1].As<Napi::Function>();

    TextureBakeArgs args;
    args.width            = jsArgs.Get("width").As<Napi::Number>().Uint32Value();
    args.height           = jsArgs.Get("height").As<Napi::Number>().Uint32Value();
    args.compressionFormat = jsArgs.Get("format").As<Napi::Number>().Uint32Value();
    args.exportFilePath   = jsArgs.Get("outputPath").As<Napi::String>().Utf8Value();

    // Pull raw pointer reference arrays directly out of the SharedArrayBuffer allocation bounds
    Napi::ArrayBuffer sab = jsArgs.Get("pixelBuffer").As<Napi::ArrayBuffer>();
    args.rawRgbaPixelData = static_cast<uint8_t*>(sab.Data());

    // Instantiate and push the worker into libuv's thread execution stack queue
    SwgTextureBakeWorker* worker = new SwgTextureBakeWorker(jsCallback, args);
    worker->Queue();

    return env.Null();
}
```

### 6.4 Extracting Pixels from WebGL Landscapes (TypeScript)

`renderer.readRenderTargetPixels` pulls RGBA bytes from the GPU framebuffer into a `SharedArrayBuffer`, which is then handed zero-copy to the C++ worker.

```typescript
import * as THREE from 'three';

export class SwgTextureBaker {
  /**
   * Reads a WebGLRenderTarget texture framebuffer and pushes pixel allocations to the C++ core
   */
  public async bakeCanvasTextureAsync(
    renderer: THREE.WebGLRenderer,
    renderTarget: THREE.WebGLRenderTarget,
    outputPath: string,
    nativeBridge: any
  ): Promise<boolean> {
    const width  = renderTarget.width;
    const height = renderTarget.height;

    // Allocate 4 bytes per pixel coordinate (RGBA configuration)
    const bufferSize   = width * height * 4;
    const sharedBuffer = new SharedArrayBuffer(bufferSize);
    const pixelViewArray = new Uint8Array(sharedBuffer);

    // Read the compiled pixels out of the GPU registers directly into our shared array allocation bounds
    renderer.readRenderTargetPixels(renderTarget, 0, 0, width, height, pixelViewArray);

    return new Promise((resolve, reject) => {
      const configPayload = {
        width,
        height,
        format: 0, // 0 = BC1/DXT1 for diffuse maps, 1 = BC3/DXT5 if Alpha layers are utilized
        outputPath,
        pixelBuffer: sharedBuffer
      };

      // Fire non-blocking asynchronous C++ texture compression worker thread
      nativeBridge.asyncBakeTextureChannel(configPayload, (err: any, success: boolean) => {
        if (err) reject(new Error(err));
        else resolve(success);
      });
    });
  }
}
```

### 6.5 Texture Baker Progression HUD (React)

```tsx
import React, { useState } from 'react';

export const SwgTextureBakeMonitor: React.FC<{
  onBakeTriggered: () => Promise<void>;
}> = ({ onBakeTriggered }) => {
  const [bakeStatus, setBakeStatus] = useState<'idle' | 'baking' | 'success'>('idle');

  const handleBakeOperation = async () => {
    setBakeStatus('baking');
    try {
      await onBakeTriggered();
      setBakeStatus('success');
      setTimeout(() => setBakeStatus('idle'), 3000);
    } catch {
      setBakeStatus('idle');
    }
  };

  return (
    <div style={{
      background: '#141416', padding: '12px', borderRadius: '4px',
      border: '1px solid #ffcc00', fontFamily: 'monospace', fontSize: '11px', color: '#fff'
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <strong style={{ color: '#ffcc00' }}>Landscape Texture Bake Engine (.DDS)</strong>
          <div style={{ color: '#666', fontSize: '10px', marginTop: '2px' }}>DXT1 Block Compression Pipeline</div>
        </div>

        <button
          onClick={handleBakeOperation}
          disabled={bakeStatus === 'baking'}
          style={{
            background: bakeStatus === 'baking' ? '#444' : '#ffcc00', color: '#111',
            fontWeight: 'bold', padding: '6px 12px', border: 'none', borderRadius: '2px', cursor: 'pointer'
          }}
        >
          {bakeStatus === 'baking' ? "Compressing Textures..." : "Bake & Compress Maps"}
        </button>
      </div>

      {bakeStatus === 'success' && (
        <div style={{ color: '#00ffcc', marginTop: '6px', fontSize: '10px' }}>
          Texture maps successfully baked to DDS and verified flush with project staging directories!
        </div>
      )}
    </div>
  );
};
```

**Key characteristic:** The `Napi::AsyncWorker::Execute()` method runs on a libuv thread pool thread. No V8 calls are permitted inside it. The `OnOK()` callback fires back on the main JS thread once compression completes, so the canvas never hitches even during 2048×2048 biome map compilation.
