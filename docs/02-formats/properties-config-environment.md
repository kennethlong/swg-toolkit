# Properties, Config & Environment Formats

> Covers: client config (`.cfg`), spawns (`.spw`), sky/weather (`.sky`), object properties (`.prp`), + catalog of `.mif`/`.fnt`/`.cmd`. Source: research doc lines 3025–3260, 8738–9472, 13115–13586.

> **Caveat:** Chunk tags (`SPWS`, `PRPT`, `SKYC`) and binary layouts documented here are AI-proposed based on reverse-engineering descriptions, not confirmed source inspection. Validate all chunk identifiers and field offsets against real `swg-client-v2` or `Core3` before shipping. See [source provenance](../00-overview/source-provenance.md).

---

## Other file types (catalog)

A brief map of smaller SWG formats not yet given full deep-dives in this doc set.

| Extension | Name | Purpose |
|-----------|------|---------|
| `.mif` | Movie/Movement Interface Format | Scripted client camera sequences: keyframed coordinate paths, FOV changes, camera shake, lens-flare, and event timeline cues over a continuous track. Visualizing in R3F would allow previewing camera splines inside the editor canvas. |
| `.fnt` | Font Descriptor | Proprietary typography tables mapping character bitmask bounding boxes across companion texture atlases. Defines kerning, line height, and pixel offsets for nameplates, chat frames, and UI text blocks. |
| `.cmd` | Command/Script Registry | Client-side action hook tables: hotkey bindings, command-line execution parameters, input constraints, cooldown processing, and macro loops for player abilities (e.g. `/burstRun`, `/feignDeath`). |
| `.pob` / `.cdf` | Portal Object Blueprint / Collision Description File | Indoor portal-cell building interiors (`.pob`) and bounding collision capsules around static objects (`.cdf`). Full treatment in [collision-and-portals.md](./collision-and-portals.md). |
| `.wth` | Weather Blueprint | Companion to `.sky`; stores weather probabilities such as sandstorm triggers on Tatooine. Parsed the same way as `.sky` timeline tracks. |

---

## Client Config (`.cfg`)

SWG client installations use plain-text `.cfg` files (`swg.cfg`, `live.cfg`, `user.cfg`) to configure the resource system. The key section for modding is `[ResourceSystem]`, where `searchTree=` entries tell the client which `.tre` archives to load and in which priority order. The `.tre`-append / loader mechanics are covered in [iff-and-tre.md](../01-core-engine/iff-and-tre.md); this section covers general `.cfg` parsing and management.

### Config data structure

The parser preserves line order and handles duplicate keys — a plain JS object map would squash them.

```typescript
interface CfgLine {
  type: 'comment' | 'blank' | 'section' | 'pair';
  raw: string;
  key?: string;
  value?: string;
}

export interface SwgCfgManifest {
  filePath: string;
  lines: CfgLine[];
}
```

### Ordered `.cfg` parser engine

```typescript
import * as fs from 'fs/promises';
import * as path from 'path';

export class SwgCfgManager {
  /**
   * Reads and parses an SWG .cfg file into an ordered array tree structure
   */
  public async parseConfigFile(targetPath: string): Promise<SwgCfgManifest> {
    const rawContent = await fs.readFile(targetPath, 'utf-8');
    const lines = rawContent.split(/\r?\n/);

    const parsedLines: CfgLine[] = lines.map((line) => {
      const trimmed = line.trim();

      if (trimmed.length === 0) {
        return { type: 'blank', raw: line };
      }
      if (trimmed.startsWith('#') || trimmed.startsWith(';')) {
        return { type: 'comment', raw: line };
      }
      if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
        return { type: 'section', raw: line, value: trimmed.slice(1, -1) };
      }

      const equalsIdx = line.indexOf('=');
      if (equalsIdx !== -1) {
        return {
          type: 'pair',
          raw: line,
          key: line.slice(0, equalsIdx).trim(),
          value: line.slice(equalsIdx + 1).trim()
        };
      }

      return { type: 'comment', raw: line }; // Fallback
    });

    return { filePath: targetPath, lines: parsedLines };
  }

  /**
   * Registers your patch file safely at the top priority of the resource sequence
   */
  public registerPatchTree(manifest: SwgCfgManifest, patchName: string): SwgCfgManifest {
    const updatedLines = [...manifest.lines];

    // 1. Check if this specific patch file is already registered to avoid duplication
    const alreadyRegistered = updatedLines.some(
      l => l.type === 'pair' && l.key === 'searchTree' && l.value === patchName
    );
    if (alreadyRegistered) return manifest;

    // 2. Find the ResourceSystem target block section
    let resourceSectionIdx = updatedLines.findIndex(
      l => l.type === 'section' && l.value?.toLowerCase() === 'resourcesystem'
    );

    // If the section doesn't exist, append one to the end of the file safely
    if (resourceSectionIdx === -1) {
      updatedLines.push({ type: 'blank', raw: '' });
      updatedLines.push({ type: 'section', raw: '[ResourceSystem]', value: 'ResourceSystem' });
      resourceSectionIdx = updatedLines.length - 1;
    }

    // 3. Insert the new patch file entry immediately following the section declaration header block
    // This gives your custom file absolute override priority over legacy game files
    const patchInsertionEntry: CfgLine = {
      type: 'pair',
      raw: `searchTree=${patchName}`,
      key: 'searchTree',
      value: patchName
    };

    updatedLines.splice(resourceSectionIdx + 1, 0, patchInsertionEntry);
    return { ...manifest, lines: updatedLines };
  }

  /**
   * Serializes the structure array cleanly back into physical configuration text assets
   */
  public async writeConfigFile(manifest: SwgCfgManifest): Promise<void> {
    // Automated Backup Check Layer: Prevent file corruption issues
    const backupPath = `${manifest.filePath}.bak`;
    try {
      await fs.copyFile(manifest.filePath, backupPath);
    } catch {
      // Create backup file quietly if it does not exist
    }

    const outputText = manifest.lines
      .map((line) => {
        if (line.type === 'pair') return `${line.key}=${line.value}`;
        return line.raw;
      })
      .join('\n');

    await fs.writeFile(manifest.filePath, outputText, 'utf-8');
  }
}
```

### Unified configuration manager interface

A high-level wrapper that iterates the three candidate config filenames and patches whichever ones exist:

```typescript
export async function executeAutoConfigPatch(clientDirectory: string, patchFileName: string): Promise<void> {
  const cfgManager = new SwgCfgManager();

  // SWG installations can target either swg.cfg or live.cfg depending on setup types
  const potentialConfigs = ['swg.cfg', 'live.cfg', 'user.cfg'];

  for (const filename of potentialConfigs) {
    const fullPath = path.join(clientDirectory, filename);

    try {
      // Check if file profile is present inside the folder structure
      await fs.access(fullPath);

      console.log(`Auto-Config scanning targeting system: ${filename}`);
      let manifest = await cfgManager.parseConfigFile(fullPath);

      manifest = cfgManager.registerPatchTree(manifest, patchFileName);
      await cfgManager.writeConfigFile(manifest);

      console.log(`Successfully updated active path layout within: ${filename}`);
    } catch (err) {
      // Quietly step past config targets that aren't utilized by this client setup
    }
  }
}
```

### Mod publisher UI — config toggle

Add an auto-registration checkbox to the React frontend dashboard so modders can build an asset bundle and inject it into the client's boot config with a single click:

```tsx
import React, { useState } from 'react';

interface AutomationProps {
  nativeBridge: any;
  clientDirectoryPath: string; // Passed from user preferences system configuration states
  patchArchiveName: string;    // e.g. "patch_custom_tatooine.tre"
  onPublishTrigger: () => Promise<void>;
}

export const SwgClientAutomationControls: React.FC<AutomationProps> = ({
  nativeBridge,
  clientDirectoryPath,
  patchArchiveName,
  onPublishTrigger
}) => {
  const [autoRegisterEnabled, setAutoRegisterEnabled] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);

  const handleExecuteFullPipeline = async () => {
    setIsProcessing(true);
    try {
      // 1. Call your existing compilation and .tre generation pipeline
      await onPublishTrigger();

      // 2. Conditional branch trigger: Execute automatic config registration patches
      if (autoRegisterEnabled) {
        // Dispatches structural file mapping directly down through the IPC background API
        await window.api.registerPatchInClientConfig(clientDirectoryPath, patchArchiveName);
      }

      alert("Pipeline Execution Complete! Archive generated and registered inside your local test client setup.");
    } catch (err: any) {
      alert(`Pipeline Halted: ${err.message}`);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div style={{ background: '#1a1a1a', padding: '16px', borderRadius: '4px', border: '1px solid #ff0055' }}>
      <h4 style={{ color: '#ff0055', margin: '0 0 12px 0' }}>Client Launcher Configuration Integration</h4>

      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '14px' }}>
        <input
          type="checkbox"
          id="autoCfg"
          checked={autoRegisterEnabled}
          onChange={(e) => setAutoRegisterEnabled(e.target.checked)}
          style={{ cursor: 'pointer' }}
        />
        <label htmlFor="autoCfg" style={{ color: '#e0e0e0', fontSize: '12px', cursor: 'pointer' }}>
          Automatically edit client configuration files to activate patch on export
        </label>
      </div>

      <button
        onClick={handleExecuteFullPipeline}
        disabled={isProcessing}
        style={{
          width: '100%',
          background: isProcessing ? '#555' : '#ff0055',
          color: '#fff',
          fontWeight: 'bold',
          padding: '10px',
          border: 'none',
          borderRadius: '4px',
          cursor: isProcessing ? 'not-allowed' : 'pointer'
        }}
      >
        {isProcessing ? "Processing Bundle Data..." : "Build, Pack & Launch Mod Test Target"}
      </button>
    </div>
  );
};
```

---

## Spawns (`.spw`)

While client snapshot `.ws` files store hardcoded object transforms, Spawn Files (`.spw`) define dynamic creature and event population rules across map surfaces: spatial coordinates, creature family types, group density bounds, respawn cooldown ticks, and patrol paths.

### IFF structure

```
FORM -> SPWS
  SPDL  — Spawn Dictionary List: flat null-terminated string array of creature template paths
           (e.g. object/mobile/shared_jawa.iff, object/mobile/shared_krayt_dragon.iff)
  SPRE  — Spawn Region count (uint32 total number of zones)
  SPDA  — Spawn Region Data: sequential blocks of [regionId, templateIndex, x, y, z, radius, maxCount, spawnType]
```

Spawn type values: `0` = Constant Static, `1` = Dynamic Wave, `2` = Random Lair.

### C++ structural models

```cpp
#include <napi.h>
#include <string>
#include <vector>
#include <cstring>

struct SwgSpawnRegion {
    uint32_t regionId;
    uint32_t templateIndex; // Maps to the parsed string dictionary array index
    float x, y, z;          // Center world coordinates
    float radius;            // Spawn circle boundary radius
    uint32_t maxCount;       // Maximum concurrent creature count
    uint32_t spawnType;      // 0 = Constant Static, 1 = Dynamic Wave, 2 = Random Lair
};

struct SwgSpawnManifest {
    std::vector<std::string> templateDictionary;
    std::vector<SwgSpawnRegion> regions;
};
```

### Binary `.spw` parser (C++)

```cpp
class SwgSpawnParser {
public:
    static SwgSpawnManifest ParseSpawnForm(const uint8_t* data, size_t& offset) {
        SwgSpawnManifest manifest;

        std::string formTag = TrnBinaryParser::Read4CharTag(data, offset); // FORM
        uint32_t formSize   = TrnBinaryParser::ReadUint32LE(data, offset);
        std::string subType = TrnBinaryParser::Read4CharTag(data, offset); // "SPWS"

        if (formTag != "FORM" || subType != "SPWS") {
            throw std::runtime_error("Target file buffer is not a valid SWG Spawn Profile (.spw) container.");
        }

        size_t endOffset = offset + formSize - 4;

        while (offset < endOffset) {
            std::string chunkTag  = TrnBinaryParser::Read4CharTag(data, offset);
            uint32_t chunkSize    = TrnBinaryParser::ReadUint32LE(data, offset);
            size_t nextChunkMarker = offset + chunkSize;

            if (chunkTag == "SPDL") {
                // --- PARSE CREATURE TEMPLATE DICTIONARY LIST ---
                uint32_t dictionarySize = TrnBinaryParser::ReadUint32LE(data, offset);
                manifest.templateDictionary.reserve(dictionarySize);

                for (uint32_t i = 0; i < dictionarySize; ++i) {
                    std::string creatureTemplate(reinterpret_cast<const char*>(data + offset));
                    offset += creatureTemplate.length() + 1; // Increment past null terminator
                    manifest.templateDictionary.push_back(creatureTemplate);
                }
            }
            else if (chunkTag == "SPDA") {
                // --- PARSE SPATIAL REGION COORDINATE DATA ---
                uint32_t regionCount = TrnBinaryParser::ReadUint32LE(data, offset);
                manifest.regions.reserve(regionCount);

                for (uint32_t i = 0; i < regionCount; ++i) {
                    SwgSpawnRegion region;
                    region.regionId      = TrnBinaryParser::ReadUint32LE(data, offset);
                    region.templateIndex = TrnBinaryParser::ReadUint32LE(data, offset);

                    // Unpack center spatial coordinate matrices
                    region.x = TrnBinaryParser::ReadFloatLE(data, offset);
                    region.y = TrnBinaryParser::ReadFloatLE(data, offset);
                    region.z = TrnBinaryParser::ReadFloatLE(data, offset);

                    region.radius    = TrnBinaryParser::ReadFloatLE(data, offset);
                    region.maxCount  = TrnBinaryParser::ReadUint32LE(data, offset);
                    region.spawnType = TrnBinaryParser::ReadUint32LE(data, offset);

                    manifest.regions.push_back(region);
                }
            }
            offset = nextChunkMarker; // Fast-forward cleanly past unhandled chunks
        }
        return manifest;
    }
};
```

### N-API buffer serialization

Passes spawn data to JS as a flat `Float32Array` — 8 floats per region: `[regionId, templateIndex, x, y, z, radius, maxCount, spawnType]`.

```cpp
Napi::Value DeconstructSpawnFile(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    Napi::ArrayBuffer inputBuffer = info.As<Napi::ArrayBuffer>();

    const uint8_t* rawData = static_cast<const uint8_t*>(inputBuffer.Data());
    size_t byteLength = inputBuffer.ByteLength();

    try {
        size_t offset = 0;
        SwgSpawnManifest manifest = SwgSpawnParser::ParseSpawnForm(rawData, offset);

        // 1. Pack creature template strings dictionary
        Napi::Array jsDict = Napi::Array::New(env, manifest.templateDictionary.size());
        for (size_t i = 0; i < manifest.templateDictionary.size(); ++i) {
            jsDict[i] = Napi::String::New(env, manifest.templateDictionary[i]);
        }

        // 2. Unroll metrics into a flat Float32Array
        // Attributes per entry: [regionId, templateIndex, x, y, z, radius, maxCount, spawnType] = 8 floats
        size_t floatCountPerRegion = 8;
        Napi::Float32Array jsRegionBuffer = Napi::Float32Array::New(
            env, manifest.regions.size() * floatCountPerRegion
        );

        for (size_t i = 0; i < manifest.regions.size(); ++i) {
            size_t idx = i * floatCountPerRegion;
            const auto& region = manifest.regions[i];

            jsRegionBuffer[idx]     = static_cast<float>(region.regionId);
            jsRegionBuffer[idx + 1] = static_cast<float>(region.templateIndex);
            jsRegionBuffer[idx + 2] = region.x;
            jsRegionBuffer[idx + 3] = region.y;
            jsRegionBuffer[idx + 4] = region.z;
            jsRegionBuffer[idx + 5] = region.radius;
            jsRegionBuffer[idx + 6] = static_cast<float>(region.maxCount);
            jsRegionBuffer[idx + 7] = static_cast<float>(region.spawnType);
        }

        Napi::Object resultContainer = Napi::Object::New(env);
        resultContainer.Set("dictionary", jsDict);
        resultContainer.Set("regions", jsRegionBuffer);
        return resultContainer;
    }
    catch (const std::exception& e) {
        Napi::TypeError::New(env, e.what()).ThrowAsJavaScriptException();
        return env.Null();
    }
}
```

### Interactive spawn rings in Three.js

Decode the flat array and render each zone as a circle conforming to terrain height, using `@react-three/drei`'s `Line`:

```tsx
import React, { useMemo } from 'react';
import * as THREE from 'three';
import { Line } from '@react-three/drei';

interface SpawnRegionNode {
  regionId: number;
  creatureTemplate: string;
  position: [number, number, number];
  radius: number;
  maxCount: number;
}

export const SwgSpawnZoneVisualizer: React.FC<{ region: SpawnRegionNode; nativeBridge: any }> = ({
  region,
  nativeBridge
}) => {
  // Generate circle coordinate points projected along the horizontal ground plane contours
  const circlePoints3D = useMemo(() => {
    const points: THREE.Vector3[] = [];
    const segments = 64;
    const [cx, , cz] = region.position;

    for (let i = 0; i <= segments; i++) {
      const theta = (i / segments) * Math.PI * 2;
      const xOffset = region.radius * Math.cos(theta);
      const zOffset = region.radius * Math.sin(theta);

      const worldX = cx + xOffset;
      const worldZ = cz + zOffset;

      // Query our C++ height engine inline to conform the wireframe onto hill contours
      const terrainHeightY = nativeBridge.getHeightAtCoordinate(worldX, worldZ) + 0.5;
      points.push(new THREE.Vector3(worldX, terrainHeightY, worldZ));
    }
    return points;
  }, [region, nativeBridge]);

  return (
    <group>
      {/* The Floating Outline Boundary Ring */}
      <Line
        points={circlePoints3D}
        color="#ffcc00"
        lineWidth={2}
      />

      {/* Optional Center Marker Object Hub Anchor */}
      <mesh position={[region.position[0], region.position[1] + 1.0, region.position[2]]}>
        <boxGeometry args={[1, 2, 1]} />
        <meshBasicMaterial color="#ffcc00" wireframe />
      </mesh>
    </group>
  );
};
```

### Spawn monitor explorer panel

Sidebar listing all regions, with click-to-focus camera:

```tsx
import React, { useState } from 'react';

export const SwgSpawnInspectorPanel: React.FC<{
  spawnRegionsList: SpawnRegionNode[];
  onFocusRegion: (pos: [number, number, number]) => void;
}> = ({ spawnRegionsList, onFocusRegion }) => {
  const [selectedZoneId, setSelectedZoneId] = useState<number | null>(null);

  return (
    <div style={{
      background: '#1e1e1e', padding: '14px', borderRadius: '4px',
      border: '1px solid #ffcc00', color: '#fff', fontFamily: 'monospace', fontSize: '12px'
    }}>
      <h4 style={{ color: '#ffcc00', margin: '0 0 10px 0' }}>Planetary Spawn Registry Explorer (.SPW)</h4>

      <div style={{ maxHeight: '250px', overflowY: 'auto', border: '1px solid #333', background: '#111' }}>
        {spawnRegionsList.map((zone) => (
          <div
            key={zone.regionId}
            onClick={() => { setSelectedZoneId(zone.regionId); onFocusRegion(zone.position); }}
            style={{
              padding: '6px 8px', borderBottom: '1px solid #222', cursor: 'pointer',
              background: selectedZoneId === zone.regionId ? '#443300' : 'transparent'
            }}
          >
            <strong>ID: #{zone.regionId}</strong> - {zone.creatureTemplate.split('/').pop()?.replace('shared_', '')}
            <div style={{ color: '#888', fontSize: '11px', marginTop: '2px' }}>
              Radius: <span style={{ color: '#00ffcc' }}>{zone.radius}m</span> | Cap: <span>{zone.maxCount} NPCs</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
```

---

## Sky / Weather (`.sky`)

SWG skies are data-driven: the client reads a binary `.sky` profile containing cyclical tables of color transitions, ambient illumination vectors, fog thresholds, and sun color steps tracking an internal 24-hour cycle. The companion `.wth` Weather Blueprint stores weather probabilities and is parsed the same way.

### IFF structure

```
FORM -> SKYC  (Sky Configuration Master Container)
  FORM -> TIME  (Time Timeline Tracks Block — minute marks 0–1440)
    AMBT  — Ambient Color Track: flat background lighting [r, g, b] per time step
    DIRT  — Directional Color Track: direct sunlight colors and casting angles
    FOGC  — Fog Color & Density: RGB horizon hue + exponent density coefficient per step
```

### C++ structural sky timeline layout

```cpp
#include <napi.h>
#include <string>
#include <vector>

struct SkyColorFrame {
    float timePercent; // 0.0 to 1.0 (replaces 0-1440 minute marks for clean WebGL math)
    float r, g, b;
};

struct SkyFogFrame {
    float timePercent;
    float r, g, b;
    float density;
};

struct SwgSkyTemplate {
    uint32_t id = 0;
    std::string planetProfileName = "tatooine_desert_sky";
    std::vector<SkyColorFrame> ambientTimeline;
    std::vector<SkyColorFrame> directionalTimeline;
    std::vector<SkyFogFrame>   fogTimeline;
};
```

### Extracting timelines to N-API arrays (C++)

Flattens timelines to `Float32Array`s: ambient uses 4 floats/frame `[timePercent, r, g, b]`; fog uses 5 `[timePercent, r, g, b, density]`.

```cpp
Napi::Value UnpackSkyTimelineToBuffers(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    // (Assume internal parsing functions have extracted the SwgSkyTemplate layout here)
    SwgSkyTemplate skyTemplate = GetActiveParsedSkyTemplate();

    Napi::Object resultContainer = Napi::Object::New(env);

    // Unroll Ambient Timeline: [timePercent, r, g, b] = 4 floats per keyframe row
    Napi::Float32Array jsAmbientBuffer = Napi::Float32Array::New(env, skyTemplate.ambientTimeline.size() * 4);
    for (size_t i = 0; i < skyTemplate.ambientTimeline.size(); ++i) {
        size_t idx = i * 4;
        jsAmbientBuffer[idx]     = skyTemplate.ambientTimeline[i].timePercent;
        jsAmbientBuffer[idx + 1] = skyTemplate.ambientTimeline[i].r;
        jsAmbientBuffer[idx + 2] = skyTemplate.ambientTimeline[i].g;
        jsAmbientBuffer[idx + 3] = skyTemplate.ambientTimeline[i].b;
    }
    resultContainer.Set("ambientTrack", jsAmbientBuffer);

    // Unroll Fog Timeline: [timePercent, r, g, b, density] = 5 floats per keyframe row
    Napi::Float32Array jsFogBuffer = Napi::Float32Array::New(env, skyTemplate.fogTimeline.size() * 5);
    for (size_t i = 0; i < skyTemplate.fogTimeline.size(); ++i) {
        size_t idx = i * 5;
        jsFogBuffer[idx]     = skyTemplate.fogTimeline[i].timePercent;
        jsFogBuffer[idx + 1] = skyTemplate.fogTimeline[i].r;
        jsFogBuffer[idx + 2] = skyTemplate.fogTimeline[i].g;
        jsFogBuffer[idx + 3] = skyTemplate.fogTimeline[i].b;
        jsFogBuffer[idx + 4] = skyTemplate.fogTimeline[i].density;
    }
    resultContainer.Set("fogTrack", jsFogBuffer);

    return resultContainer;
}
```

### Linear timeline color-interpolation engine (TypeScript)

Given a time percentage (e.g. `0.25` = 06:00 AM), finds the adjacent bounding keyframes and lerps between them:

```typescript
import * as THREE from 'three';

export class SwgSkyTimelineResolver {
  /**
   * Linearly interpolates a 3-channel color coordinate from flat native buffers
   */
  public sampleColorTrack(trackData: Float32Array, stride: number, targetTime: number): THREE.Color {
    const frameCount = trackData.length / stride;

    // Fallback safeguard for empty tracks
    if (frameCount === 0) return new THREE.Color(1, 1, 1);

    // Handle single-frame or static track configurations
    if (frameCount === 1) return new THREE.Color(trackData[1], trackData[2], trackData[3]);

    // Track loop boundaries assignment pointers
    let leftIdx = 0;
    let rightIdx = 0;

    for (let i = 0; i < frameCount - 1; i++) {
      const currTime = trackData[i * stride];
      const nextTime = trackData[(i + 1) * stride];

      if (targetTime >= currTime && targetTime <= nextTime) {
        leftIdx  = i * stride;
        rightIdx = (i + 1) * stride;
        break;
      }
    }

    const tMin = trackData[leftIdx];
    const tMax = trackData[rightIdx];

    // Calculate the interpolation factor between 0.0 and 1.0
    const alpha = (tMax - tMin) > 0 ? (targetTime - tMin) / (tMax - tMin) : 0.0;

    const r = THREE.MathUtils.lerp(trackData[leftIdx + 1], trackData[rightIdx + 1], alpha);
    const g = THREE.MathUtils.lerp(trackData[leftIdx + 2], trackData[rightIdx + 2], alpha);
    const b = THREE.MathUtils.lerp(trackData[leftIdx + 3], trackData[rightIdx + 3], alpha);

    return new THREE.Color(r, g, b);
  }
}
```

### Dynamic canvas environment-lighting node (R3F)

Integrates with `useFrame` to sample sky tracks and update `AmbientLight`, `DirectionalLight`, and `FogExp2` every frame:

```tsx
import React, { useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { SwgSkyTimelineResolver } from './SkyTimelineResolver';

interface SkyLightingProps {
  napiSkyPayload: any;
  timeOfDayPercent: number; // Controlled by an inspector slider (0.0 to 1.0)
}

export const SwgSkyEnvironmentLighting: React.FC<SkyLightingProps> = ({ napiSkyPayload, timeOfDayPercent }) => {
  const ambientLightRef = useRef<THREE.AmbientLight>(null);
  const sunLightRef     = useRef<THREE.DirectionalLight>(null);
  const { scene } = useThree();

  const resolver = useMemo(() => new SwgSkyTimelineResolver(), []);

  useFrame(() => {
    // 1. Resolve active color configurations matching our time cycle indices
    const currentAmbientColor = resolver.sampleColorTrack(napiSkyPayload.ambientTrack, 4, timeOfDayPercent);
    const currentFogColor     = resolver.sampleColorTrack(napiSkyPayload.fogTrack, 5, timeOfDayPercent);

    // 2. Tint Three.js global light nodes directly
    if (ambientLightRef.current) {
      ambientLightRef.current.color.copy(currentAmbientColor);
    }

    // 3. Process dynamic solar positioning vectors
    if (sunLightRef.current) {
      // Calculate rotation orbits: convert time percentages directly to radian angles
      const solarAngle = timeOfDayPercent * Math.PI * 2 - (Math.PI / 2);

      // Position the sun in a broad arc path across the sky ceiling grid
      sunLightRef.current.position.set(
        Math.cos(solarAngle) * 500.0,
        Math.sin(solarAngle) * 500.0,
        0.0
      );
    }

    // 4. Update the parent WebGL scene's ambient background fog and clearing colors
    scene.background = currentFogColor;
    if (scene.fog && scene.fog instanceof THREE.FogExp2) {
      scene.fog.color.copy(currentFogColor);
      scene.fog.density = 0.0025; // Balanced fallback base constant factor
    }
  });

  return (
    <group name="swg_sky_lighting_matrix">
      <ambientLight ref={ambientLightRef} intensity={0.6} />
      <directionalLight
        ref={sunLightRef}
        intensity={1.2}
        castShadow
        shadow-mapSize={[2048, 2048]}
      />
      {/* Attach a persistent background exponential fog framework onto the scene container node */}
      <primitive object={useMemo(() => new THREE.FogExp2('#111', 0.002), [])} attach="fog" />
    </group>
  );
};
```

### Time-of-day slider dashboard

```tsx
import React, { useState } from 'react';

export const SwgTimeOfDayControllerPanel: React.FC<{ onTimeChange: (percent: number) => void }> = ({ onTimeChange }) => {
  const [timePercent, setTimePercent] = useState(0.5); // Default to midday (12:00 PM)

  // Convert decimal percentage parameters back into a readable 24h clock string formatting layout
  const formatTimeLabel = (percent: number): string => {
    const totalMinutes = Math.floor(percent * 1440);
    const hours   = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
  };

  const handleSliderDrag = (val: number) => {
    setTimePercent(val);
    onTimeChange(val); // Re-trigger the illumination interpolation engines across your canvas
  };

  return (
    <div style={{
      position: 'absolute', top: '20px', right: '20px', zIndex: 100,
      background: 'rgba(20, 20, 20, 0.9)', border: '1px solid #00ffcc',
      padding: '12px', borderRadius: '4px', color: '#fff', width: '230px', fontFamily: 'monospace'
    }}>
      <h5 style={{ color: '#00ffcc', margin: '0 0 8px 0' }}>Atmospheric Cycle Controls (.SKY)</h5>

      <div style={{ display: 'grid', gap: '6px', fontSize: '11px' }}>
        <div>Active Environment Clock: <span style={{ float: 'right', color: '#ffcc00', fontWeight: 'bold' }}>{formatTimeLabel(timePercent)}</span></div>

        <input
          type="range" min="0.0" max="0.999" step="0.005"
          value={timePercent}
          onChange={(e) => handleSliderDrag(parseFloat(e.target.value))}
          style={{ width: '100%', accentColor: '#00ffcc', marginTop: '4px' }}
        />

        <div style={{ display: 'flex', justifyContent: 'space-between', color: '#666', fontSize: '9px', marginTop: '2px' }}>
          <span>00:00 (Midnight)</span>
          <span>12:00 (Noon)</span>
        </div>
      </div>
    </div>
  );
};
```

### `.sky` serialization — inside-out strategy

The flow is:

```
[ TS Timeline State Changes ]
  --> (Map 0.0–1.0 percentages back to 0–1440 integer minute marks)
  --> (Serialize AMBT, DIRT, FOGC chunks)
  --> (Compute footprint sizes)
  --> (Wrap in FORM -> SKYC structure)
  --> [ Deployable .sky binary ]
```

#### Extended C++ structs for export

```cpp
#include <napi.h>
#include <vector>
#include <string>
#include <cstring>
#include <algorithm>

struct SwgSkyColorKeyframe {
    uint32_t minuteMark; // 0 to 1440 tracking minutes in a day
    float r, g, b;
};

struct SwgSkyFogKeyframe {
    uint32_t minuteMark;
    float r, g, b;
    float density;
};

struct SwgSkyExportManifest {
    uint32_t id = 0;
    std::vector<SwgSkyColorKeyframe> ambientTrack;
    std::vector<SwgSkyColorKeyframe> directionalTrack;
    std::vector<SwgSkyFogKeyframe>   fogTrack;
};
```

#### Serializing track chunks (C++)

```cpp
class SwgSkyCompiler {
private:
    static bool CompareColorKeys(const SwgSkyColorKeyframe& a, const SwgSkyColorKeyframe& b) {
        return a.minuteMark < b.minuteMark;
    }
    static bool CompareFogKeys(const SwgSkyFogKeyframe& a, const SwgSkyFogKeyframe& b) {
        return a.minuteMark < b.minuteMark;
    }

public:
    static std::vector<uint8_t> SerializeSkyForm(SwgSkyExportManifest& manifest) {
        IffBinaryWriter contentWriter;

        // Sort all timelines chronologically before packing bytes
        std::sort(manifest.ambientTrack.begin(),     manifest.ambientTrack.end(),     CompareColorKeys);
        std::sort(manifest.directionalTrack.begin(), manifest.directionalTrack.end(), CompareColorKeys);
        std::sort(manifest.fogTrack.begin(),         manifest.fogTrack.end(),         CompareFogKeys);

        // 1. Pack Ambient Track (AMBT Chunk)
        IffBinaryWriter ambtWriter;
        ambtWriter.WriteUint32(static_cast<uint32_t>(manifest.ambientTrack.size()));
        for (const auto& key : manifest.ambientTrack) {
            ambtWriter.WriteUint32(key.minuteMark);
            ambtWriter.WriteFloat(key.r);
            ambtWriter.WriteFloat(key.g);
            ambtWriter.WriteFloat(key.b);
        }
        contentWriter.PackChunk("AMBT", ambtWriter.buffer);

        // 2. Pack Directional Sunlight Track (DIRT Chunk)
        IffBinaryWriter dirtWriter;
        dirtWriter.WriteUint32(static_cast<uint32_t>(manifest.directionalTrack.size()));
        for (const auto& key : manifest.directionalTrack) {
            dirtWriter.WriteUint32(key.minuteMark);
            dirtWriter.WriteFloat(key.r);
            dirtWriter.WriteFloat(key.g);
            dirtWriter.WriteFloat(key.b);
        }
        contentWriter.PackChunk("DIRT", dirtWriter.buffer);

        // 3. Pack Atmospheric Horizon Fog Track (FOGC Chunk)
        IffBinaryWriter fogcWriter;
        fogcWriter.WriteUint32(static_cast<uint32_t>(manifest.fogTrack.size()));
        for (const auto& key : manifest.fogTrack) {
            fogcWriter.WriteUint32(key.minuteMark);
            fogcWriter.WriteFloat(key.r);
            fogcWriter.WriteFloat(key.g);
            fogcWriter.WriteFloat(key.b);
            fogcWriter.WriteFloat(key.density);
        }
        contentWriter.PackChunk("FOGC", fogcWriter.buffer);

        // 4. Wrap everything inside a primary master FORM container carrying the SKYC Type Tag
        IffBinaryWriter formWriter;
        formWriter.WriteTag("FORM");
        formWriter.WriteUint32(static_cast<uint32_t>(contentWriter.buffer.size() + 4));
        formWriter.WriteTag("SKYC");
        formWriter.WriteRawBuffer(contentWriter.buffer);

        return formWriter.buffer;
    }
};
```

#### N-API map — JS to sky binary (C++)

Takes unrolled `Float32Array`s from TypeScript, converts 0.0–1.0 percentages back to 0–1440 integer minute marks, and returns a zero-copy `ArrayBuffer`:

```cpp
Napi::Value CompileJsToSkyStream(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    Napi::Object jsManifestObj = info.As<Napi::Object>();

    SwgSkyExportManifest manifest;
    manifest.id = jsManifestObj.Get("id").As<Napi::Number>().Uint32Value();

    // 1. Map Unrolled Ambient Array: [timePercent, r, g, b] = 4 floats per row
    Napi::Float32Array jsAmbient = jsManifestObj.Get("ambientTrack").As<Napi::Float32Array>();
    size_t ambCount = jsAmbient.Length() / 4;
    manifest.ambientTrack.reserve(ambCount);
    for (size_t i = 0; i < ambCount; ++i) {
        size_t idx = i * 4;
        SwgSkyColorKeyframe key;
        // Translate 0.0-1.0 percentage floats back to 0-1440 integer minute indices
        key.minuteMark = static_cast<uint32_t>(std::round(jsAmbient[idx] * 1440.0f));
        key.r = jsAmbient[idx + 1];
        key.g = jsAmbient[idx + 2];
        key.b = jsAmbient[idx + 3];
        manifest.ambientTrack.push_back(key);
    }

    // 2. Map Unrolled Fog Array: [timePercent, r, g, b, density] = 5 floats per row
    Napi::Float32Array jsFog = jsManifestObj.Get("fogTrack").As<Napi::Float32Array>();
    size_t fogCount = jsFog.Length() / 5;
    manifest.fogTrack.reserve(fogCount);
    for (size_t i = 0; i < fogCount; ++i) {
        size_t idx = i * 5;
        SwgSkyFogKeyframe key;
        key.minuteMark = static_cast<uint32_t>(std::round(jsFog[idx] * 1440.0f));
        key.r       = jsFog[idx + 1];
        key.g       = jsFog[idx + 2];
        key.b       = jsFog[idx + 3];
        key.density = jsFog[idx + 4];
        manifest.fogTrack.push_back(key);
    }

    // Run the inside-out binary serialization compiler loop
    std::vector<uint8_t> compiledSkyBytes = SwgSkyCompiler::SerializeSkyForm(manifest);

    Napi::ArrayBuffer outputBuffer = Napi::ArrayBuffer::New(env, compiledSkyBytes.size());
    std::memcpy(outputBuffer.Data(), compiledSkyBytes.data(), compiledSkyBytes.size());

    return outputBuffer;
}
// Bind endpoint within native initializers
exports.Set("compileJsToSkyStream", Napi::Function::New(env, CompileJsToSkyStream));
```

#### React export widget

```tsx
import React from 'react';

interface ExporterProps {
  nativeBridge: any;
  ambientTrackBuffer: Float32Array; // The active unrolled tracking arrays currently driving your lights
  fogTrackBuffer: Float32Array;
}

export const SwgAtmosphereExporterWidget: React.FC<ExporterProps> = ({
  nativeBridge,
  ambientTrackBuffer,
  fogTrackBuffer
}) => {
  const handleExportSkyConfigFile = async () => {
    const exportPayload = {
      id: 701, // Workspace profile tracking index
      ambientTrack: ambientTrackBuffer,
      fogTrack: fogTrackBuffer
    };

    try {
      // 1. Invoke the high-speed C++ binary serialization compiler loop
      const compiledSkyArrayBuffer: ArrayBuffer = nativeBridge.compileJsToSkyStream(exportPayload);

      // 2. Package raw byte data view out to disk via context isolation bridges
      const finalByteArrayView = new Uint8Array(compiledSkyArrayBuffer);
      const success = await window.api.saveFileToDisk("sky/tatooine_custom.sky", finalByteArrayView);

      if (success) {
        alert("Successfully serialized active timeline parameters into a valid SWG Sky Profile (.sky) binary container!");
      }
    }
    catch (err: any) {
      console.error("Atmospheric parameters compilation error event:", err);
      alert(`Sky profile serialization aborted: ${err.message}`);
    }
  };

  return (
    <button
      onClick={handleExportSkyConfigFile}
      style={{
        marginTop: '10px', width: '100%', background: '#00ffcc', color: '#111',
        fontWeight: 'bold', padding: '8px 14px', border: 'none', borderRadius: '4px',
        fontFamily: 'monospace', fontSize: '11px', cursor: 'pointer'
      }}
    >
      Compile Atmospheric Profile (.SKY)
    </button>
  );
};
```

---

## Object Property Templates (`.prp`)

While `.msh` files hold raw visual vertex models and `.ws` files track spatial map snapshots, `.prp` templates are the structural bridge dictating custom object-level variables: decorative attachment nodes, shield dome radius caps, dynamic lighting colors, and asset-specific health or interaction properties.

### IFF structure

```
FORM -> PRPT  (Property Template Master Group)
  DATA        — uint32 objectId
  FORM -> PROP  (one per property entry)
    NAME      — null-terminated ASCII string: variable identifier (e.g. shield_radius, glow_color, particle_attachment_node)
    TYPE      — uint32 data type flag: 0 = String, 1 = Integer, 2 = Float, 3 = Vector3D
    VALU      — variable data payload, interpreted per TYPE
```

### C++ property data models

```cpp
#include <napi.h>
#include <string>
#include <vector>
#include <cstring>

enum class SwgPropType { String = 0, Integer = 1, Float = 2, Vector = 3 };

struct SwgPropertyEntry {
    std::string keyName;
    uint32_t    dataType; // Mapped via SwgPropType enum

    // Extents properties (interpreted based on dataType)
    int32_t  intVal    = 0;
    float    floatVal1 = 0.0f;
    float    floatVal2 = 0.0f;
    float    floatVal3 = 0.0f;
    std::string stringVal = "";
};

struct SwgPropertyManifest {
    uint32_t objectId = 0;
    std::vector<SwgPropertyEntry> properties;
};
```

### Binary `.prp` parser loop (C++)

```cpp
class SwgPrpParser {
public:
    static SwgPropertyManifest ParsePropertyForm(const uint8_t* data, size_t& offset) {
        SwgPropertyManifest manifest;

        std::string formTag = TrnBinaryParser::Read4CharTag(data, offset); // FORM
        uint32_t formSize   = TrnBinaryParser::ReadUint32LE(data, offset);
        std::string subType = TrnBinaryParser::Read4CharTag(data, offset); // "PRPT"

        if (formTag != "FORM" || subType != "PRPT") {
            throw std::runtime_error("Target file buffer is not a valid SWG Property Template (.prp) container.");
        }

        size_t endOffset = offset + formSize - 4;

        while (offset < endOffset) {
            std::string chunkTag   = TrnBinaryParser::Read4CharTag(data, offset);
            uint32_t chunkSize     = TrnBinaryParser::ReadUint32LE(data, offset);
            size_t nextChunkMarker = offset + chunkSize;

            if (chunkTag == "FORM") {
                std::string formType = TrnBinaryParser::Read4CharTag(data, offset);

                if (formType == "PROP") {
                    SwgPropertyEntry prop;
                    size_t propEnd = nextChunkMarker;

                    while (offset < propEnd) {
                        std::string subTag  = TrnBinaryParser::Read4CharTag(data, offset);
                        uint32_t subSize    = TrnBinaryParser::ReadUint32LE(data, offset);
                        size_t subNext      = offset + subSize;

                        if (subTag == "NAME") {
                            prop.keyName = std::string(reinterpret_cast<const char*>(data + offset));
                        }
                        else if (subTag == "TYPE") {
                            prop.dataType = TrnBinaryParser::ReadUint32LE(data, offset);
                        }
                        else if (subTag == "VALU") {
                            if (prop.dataType == static_cast<uint32_t>(SwgPropType::Integer)) {
                                prop.intVal = static_cast<int32_t>(TrnBinaryParser::ReadUint32LE(data, offset));
                            }
                            else if (prop.dataType == static_cast<uint32_t>(SwgPropType::Float)) {
                                prop.floatVal1 = TrnBinaryParser::ReadFloatLE(data, offset);
                            }
                            else if (prop.dataType == static_cast<uint32_t>(SwgPropType::Vector)) {
                                prop.floatVal1 = TrnBinaryParser::ReadFloatLE(data, offset); // X
                                prop.floatVal2 = TrnBinaryParser::ReadFloatLE(data, offset); // Y
                                prop.floatVal3 = TrnBinaryParser::ReadFloatLE(data, offset); // Z
                            }
                            else if (prop.dataType == static_cast<uint32_t>(SwgPropType::String)) {
                                prop.stringVal = std::string(reinterpret_cast<const char*>(data + offset));
                            }
                        }
                        offset = subNext;
                    }
                    manifest.properties.push_back(prop);
                }
            }
            else if (chunkTag == "DATA") {
                manifest.objectId = TrnBinaryParser::ReadUint32LE(data, offset);
            }
            offset = nextChunkMarker;
        }
        return manifest;
    }
};
```

### N-API flat layout serialization

Unrolls numeric fields to a `Float32Array` with stride 5 `[dataType, intVal, f1, f2, f3]`, plus parallel `names` and `stringValues` arrays:

```cpp
Napi::Value DeconstructPrpFile(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    Napi::ArrayBuffer inputBuffer = info.As<Napi::ArrayBuffer>();

    const uint8_t* rawData = static_cast<const uint8_t*>(inputBuffer.Data());
    size_t byteLength = inputBuffer.ByteLength();

    try {
        size_t offset = 0;
        SwgPropertyManifest manifest = SwgPrpParser::ParsePropertyForm(rawData, offset);

        Napi::Object resultContainer = Napi::Object::New(env);
        resultContainer.Set("objectId", Napi::Number::New(env, manifest.objectId));

        // Unroll numerical parameters: [dataType, intVal, f1, f2, f3] = 5 floats per entry
        size_t floatCountPerProp = 5;
        Napi::Float32Array jsNumericBuffer = Napi::Float32Array::New(
            env, manifest.properties.size() * floatCountPerProp
        );

        Napi::Array jsNamesArray   = Napi::Array::New(env, manifest.properties.size());
        Napi::Array jsStringsArray = Napi::Array::New(env, manifest.properties.size());

        for (size_t i = 0; i < manifest.properties.size(); ++i) {
            size_t idx = i * floatCountPerProp;
            const auto& prop = manifest.properties[i];

            jsNamesArray[i]   = Napi::String::New(env, prop.keyName);
            jsStringsArray[i] = Napi::String::New(env, prop.stringVal);

            jsNumericBuffer[idx]     = static_cast<float>(prop.dataType);
            jsNumericBuffer[idx + 1] = static_cast<float>(prop.intVal);
            jsNumericBuffer[idx + 2] = prop.floatVal1;
            jsNumericBuffer[idx + 3] = prop.floatVal2;
            jsNumericBuffer[idx + 4] = prop.floatVal3;
        }

        resultContainer.Set("names",        jsNamesArray);
        resultContainer.Set("stringValues", jsStringsArray);
        resultContainer.Set("numericValues", jsNumericBuffer);
        return resultContainer;
    }
    catch (const std::exception& e) {
        Napi::TypeError::New(env, e.what()).ThrowAsJavaScriptException();
        return env.Null();
    }
}
```

### TypeScript property resolver

Parses the unrolled N-API payload back into structured JavaScript objects:

```typescript
export interface ResolvedProperty {
  key: string;
  type: 'String' | 'Integer' | 'Float' | 'Vector';
  value: string | number | [number, number, number];
}

export function parseNativePropertyPayload(napiResult: any): ResolvedProperty[] {
  const names: string[]         = napiResult.names;
  const stringValues: string[]  = napiResult.stringValues;
  const numericValues: Float32Array = napiResult.numericValues;

  const propertyCount = names.length;
  const resolvedProperties: ResolvedProperty[] = [];

  for (let i = 0; i < propertyCount; i++) {
    const offset   = i * 5;
    const dataType = Math.floor(numericValues[offset]);

    let typeStr: ResolvedProperty['type'] = 'String';
    let value: any = '';

    if (dataType === 1) { // Integer
      typeStr = 'Integer';
      value   = Math.floor(numericValues[offset + 1]);
    } else if (dataType === 2) { // Float
      typeStr = 'Float';
      value   = numericValues[offset + 2];
    } else if (dataType === 3) { // Vector
      typeStr = 'Vector';
      value   = [numericValues[offset + 2], numericValues[offset + 3], numericValues[offset + 4]];
    } else { // String
      typeStr = 'String';
      value   = stringValues[i];
    }

    resolvedProperties.push({ key: names[i], type: typeStr, value });
  }

  return resolvedProperties;
}
```

### Blueprint variables inspector (React UI)

Renders an editable property grid in the right-side attributes sidebar — scalar/string fields as inputs, Vector3D as three side-by-side number inputs:

```tsx
import React, { useMemo } from 'react';
import { parseNativePropertyPayload, ResolvedProperty } from './PropertyUtils';

export const SwgObjectBlueprintInspectorCard: React.FC<{
  rawNapiPrpData: any;
  onVariableModified: (key: string, newVal: any) => void;
}> = ({ rawNapiPrpData, onVariableModified }) => {
  // Parse flat backend memory buffers into structured layout lists
  const propertiesList = useMemo(() => {
    return parseNativePropertyPayload(rawNapiPrpData);
  }, [rawNapiPrpData]);

  return (
    <div style={{
      background: '#1e1e24', padding: '14px', border: '1px solid #ffcc00',
      borderRadius: '4px', fontFamily: 'monospace', fontSize: '11px', color: '#fff'
    }}>
      <h5 style={{ color: '#ffcc00', margin: '0 0 10px 0' }}>Template Variables Inspector (.PRP)</h5>

      <div style={{ display: 'grid', gap: '8px', maxHeight: '300px', overflowY: 'auto' }}>
        {propertiesList.map((prop) => (
          <div key={prop.key} style={{ borderBottom: '1px solid #2d2d35', paddingBottom: '6px' }}>
            <div style={{ color: '#00ffcc', fontWeight: 'bold', marginBottom: '2px' }}>{prop.key}</div>
            <div style={{ fontSize: '9px', color: '#666', marginBottom: '2px' }}>Type: {prop.type}</div>

            {prop.type === 'Vector' && Array.isArray(prop.value) ? (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '4px' }}>
                {['X', 'Y', 'Z'].map((axis, idx) => (
                  <input
                    key={axis}
                    type="number"
                    defaultValue={(prop.value as number[])[idx]}
                    style={{ background: '#111', border: '1px solid #444', color: '#fff', padding: '2px', fontSize: '11px' }}
                  />
                ))}
              </div>
            ) : (
              <input
                type={prop.type === 'String' ? 'text' : 'number'}
                defaultValue={prop.value as any}
                onChange={(e) => onVariableModified(prop.key, e.target.value)}
                style={{ width: '100%', background: '#111', border: '1px solid #444', color: '#fff', padding: '4px', boxSizing: 'border-box' }}
              />
            )}
          </div>
        ))}
      </div>
    </div>
  );
};
```

### `.prp` serialization — inside-out strategy

```
[ TS Property State Changes ]
  --> (Encode values matching Integer, Float, or Vector)
  --> (Pack into PROP FORM chunks: NAME + TYPE + VALU sub-chunks)
  --> (Prepend header + DATA chunk with objectId)
  --> (Wrap in FORM -> PRPT structure)
  --> [ Deployable .prp binary ]
```

#### C++ property export structs

```cpp
#include <napi.h>
#include <vector>
#include <string>
#include <cstring>
#include <cstdint>

struct SwgPropertyExportEntry {
    std::string keyName;
    uint32_t    dataType;  // 0 = String, 1 = Integer, 2 = Float, 3 = Vector
    int32_t     intVal;
    float       floatVal1;
    float       floatVal2;
    float       floatVal3;
    std::string stringVal;
};

struct SwgPrpExportManifest {
    uint32_t objectId;
    std::vector<SwgPropertyExportEntry> properties;
};
```

#### Serializing property sub-FORMs (C++)

```cpp
class SwgPrpCompiler {
public:
    static std::vector<uint8_t> SerializePrpForm(const SwgPrpExportManifest& manifest) {
        IffBinaryWriter contentWriter;

        // 1. PACK SEPARATE PROPERTY SUB-FORMS
        for (const auto& prop : manifest.properties) {
            IffBinaryWriter propContentWriter;

            // Pack variable text identifier name (NAME chunk)
            IffBinaryWriter nameWriter;
            nameWriter.WriteString(prop.keyName);
            propContentWriter.PackChunk("NAME", nameWriter.buffer);

            // Pack data type flag identifier (TYPE chunk)
            IffBinaryWriter typeWriter;
            typeWriter.WriteUint32(prop.dataType);
            propContentWriter.PackChunk("TYPE", typeWriter.buffer);

            // Pack dynamic value payload allocation block (VALU chunk)
            IffBinaryWriter valueWriter;
            if (prop.dataType == 1) { // Integer
                valueWriter.WriteUint32(static_cast<uint32_t>(prop.intVal));
            } else if (prop.dataType == 2) { // Float
                valueWriter.WriteFloat(prop.floatVal1);
            } else if (prop.dataType == 3) { // Vector
                valueWriter.WriteFloat(prop.floatVal1); // X
                valueWriter.WriteFloat(prop.floatVal2); // Y
                valueWriter.WriteFloat(prop.floatVal3); // Z
            } else { // String
                valueWriter.WriteString(prop.stringVal);
            }
            propContentWriter.PackChunk("VALU", valueWriter.buffer);

            // Wrap everything cleanly into a parent sub-FORM container carrying the PROP tag
            IffBinaryWriter propFormWriter;
            propFormWriter.WriteTag("FORM");
            propFormWriter.WriteUint32(static_cast<uint32_t>(propContentWriter.buffer.size() + 4));
            propFormWriter.WriteTag("PROP");
            propFormWriter.WriteRawBuffer(propContentWriter.buffer);

            contentWriter.WriteRawBuffer(propFormWriter.buffer);
        }

        // 2. PREPEND METADATA IDENTIFIER BLOCK (DATA Chunk)
        IffBinaryWriter dataWriter;
        dataWriter.WriteUint32(manifest.objectId);

        IffBinaryWriter masterFileWriter;
        masterFileWriter.WriteTag("FORM");

        // Compute absolute root payload footprints size
        uint32_t dataChunkFootprint = static_cast<uint32_t>(dataWriter.buffer.size() + 8); // Tag (4) + Size (4)
        uint32_t totalFormSize = 4 + dataChunkFootprint + static_cast<uint32_t>(contentWriter.buffer.size());

        masterFileWriter.WriteUint32(totalFormSize);
        masterFileWriter.WriteTag("PRPT"); // Property Master Container Tag

        masterFileWriter.PackChunk("DATA", dataWriter.buffer);
        masterFileWriter.WriteRawBuffer(contentWriter.buffer);

        return masterFileWriter.buffer;
    }
};
```

#### N-API map — JS to `.prp` binary (C++)

```cpp
Napi::Value CompileJsToPrpStream(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    Napi::Object jsPayload = info.As<Napi::Object>();

    SwgPrpExportManifest manifest;
    manifest.objectId = jsPayload.Get("objectId").As<Napi::Number>().Uint32Value();

    Napi::Array        jsNames    = jsPayload.Get("names").As<Napi::Array>();
    Napi::Array        jsStrings  = jsPayload.Get("stringValues").As<Napi::Array>();
    Napi::Float32Array jsNumerics = jsPayload.Get("numericValues").As<Napi::Float32Array>();

    size_t propertyCount = jsNames.Length();
    manifest.properties.reserve(propertyCount);

    for (size_t i = 0; i < propertyCount; ++i) {
        size_t idx = i * 5; // Stride of 5 floats matching our unrolling layout schema
        SwgPropertyExportEntry prop;

        prop.keyName   = jsNames.Get(i).As<Napi::String>().Utf8Value();
        prop.stringVal = jsStrings.Get(i).As<Napi::String>().Utf8Value();

        prop.dataType  = static_cast<uint32_t>(jsNumerics[idx]);
        prop.intVal    = static_cast<int32_t>(jsNumerics[idx + 1]);
        prop.floatVal1 = jsNumerics[idx + 2];
        prop.floatVal2 = jsNumerics[idx + 3];
        prop.floatVal3 = jsNumerics[idx + 4];

        manifest.properties.push_back(prop);
    }

    // Execute the inside-out binary serialization compiler loop
    std::vector<uint8_t> compiledPrpBytes = SwgPrpCompiler::SerializePrpForm(manifest);

    Napi::ArrayBuffer outputBuffer = Napi::ArrayBuffer::New(env, compiledPrpBytes.size());
    std::memcpy(outputBuffer.Data(), compiledPrpBytes.data(), compiledPrpBytes.size());

    return outputBuffer;
}
// Bind endpoint within native exports module initializers
exports.Set("compileJsToPrpStream", Napi::Function::New(env, CompileJsToPrpStream));
```

#### React export widget

```tsx
import React from 'react';

interface ExporterProps {
  nativeBridge: any;
  objectId: number;
  namesArray: string[];
  stringValuesArray: string[];
  numericValuesBuffer: Float32Array;
  associatedModelName: string; // e.g., "shared_plasma_shield_generator"
}

export const SwgPropertyExporterWidget: React.FC<ExporterProps> = ({
  nativeBridge,
  objectId,
  namesArray,
  stringValuesArray,
  numericValuesBuffer,
  associatedModelName
}) => {
  const handleExportPrpFile = async () => {
    const exportPayload = {
      objectId,
      names: namesArray,
      stringValues: stringValuesArray,
      numericValues: numericValuesBuffer
    };

    try {
      // 1. Invoke the high-speed C++ binary serialization compiler loop
      const compiledPrpArrayBuffer: ArrayBuffer = nativeBridge.compileJsToPrpStream(exportPayload);

      // 2. Package raw byte data view out to disk via context isolation bridges
      const finalByteArrayView = new Uint8Array(compiledPrpArrayBuffer);
      const targetFilename = `object/properties/${associatedModelName}.prp`;
      const success = await window.api.saveFileToDisk(targetFilename, finalByteArrayView);

      if (success) {
        alert(`Successfully serialized variable modifications into a valid SWG Property Template (.prp) binary container! Target: ${targetFilename}`);
      }
    }
    catch (err: any) {
      console.error("Property parameters compilation error event:", err);
      alert(`PRP serialization aborted: ${err.message}`);
    }
  };

  return (
    <button
      onClick={handleExportPrpFile}
      style={{
        marginTop: '12px', width: '100%', background: '#ffcc00', color: '#111',
        fontWeight: 'bold', padding: '10px 14px', border: 'none', borderRadius: '4px',
        fontFamily: 'monospace', fontSize: '11px', cursor: 'pointer'
      }}
    >
      Compile Property Template (.PRP)
    </button>
  );
};
```
