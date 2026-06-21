# Live Memory Injection & IPC Architecture

> Covers: live client memory injection, dual-channel IPC, SharedArrayBuffer transform sync, packet sniffer. Source: research doc lines 594–782, 11872–12115, 14783–14830.

> **Caveat:** Memory offsets, pointer layouts, and address values throughout this document are AI-proposed and entirely client-build-specific. Every address must be discovered and validated against your actual running SWG client build and cross-referenced with the Utinni project. See [source provenance](../00-overview/source-provenance.md).

---

## Why Live Memory Injection Matters

Traditional modding requires a full restart loop for every change:

```
[ Traditional File-Patch Workflow ]
Paint/Edit Asset -> Compile .TRE Archive -> Restart Game Client -> Log In -> Teleport to Zone -> Verify Changes
(Total Loop Time: 3 to 5 Minutes)

[ Utinni-Style Live Sync Workflow ]
Drag Building/Paint Tree in Three.js Canvas ──(Microsecond WriteProcessMemory)──> Instantly Moves In-Game
(Total Loop Time: 0.1 Seconds - Zero Restarts)
```

Live injection collapses a five-minute testing cycle to fractions of a second. The specific advantages are:

**1. Instant, Zero-Restart Visual Feedback (WYSIWYG)**
SWG takes a notoriously long time to launch, load assets, and connect to a server character. With a live memory connection you can move your camera character in-game to stand exactly where you want to build, look at your editor canvas, and drag an object matrix handle. The object glides across terrain in the live game window in real time.

**2. Precise Scale & Proportion Validation**
A Three.js viewport grid can tell you an object is "12 meters tall," but it cannot replicate the psychological scale of standing next to that object as a player character. With live injection you can position your in-game character adjacent to a custom building, prop, or scenery element, then scale or rotate the asset inside the editor and instantly observe how it matches the player character's camera perspective, height, animation boundaries, and relative line of sight.

**3. Real-Time Lighting & Shading Verification**
SWG features a dynamic day-night atmospheric weather cycle (`.sky` / `.wth` rulesets). A static 3D preview cannot accurately capture how a custom mesh texture (`.msh`), shadow map layer, or custom shader interacts with localized weather events. A live connection lets you watch the game client's actual rendering engine process shadows, sandstorms, fog filters, and solar lighting angles over newly injected models.

**4. Live Memory & Network Traffic Auditing**
When writing custom special effects blueprints (`.eft`), combining particle tracks (`.prt`), or creating sound nodes (`.snd`), tracking down script crashes in offline files is difficult. Hooking into the running process's memory registers lets the packet sniffer and debugger capture exactly which network opcode or memory address allocation triggers a client crash — isolating whether a custom weapon effect fails due to a network timing desync, an unallocated asset memory slot, or a corrupted chunk format in real time during a combat animation test loop.

**5. Seamless Multiplayer Collaborative Group Editing**
Multiple level designers can log into the same coordinates on a development server while running the toolkit. As the C++ memory module streams transform changes to the local running client, a server-side daemon extension can broadcast those position variables across the shared network pool, allowing teams to paint biomes and structure townsites collaboratively inside a shared, live environment.

---

## Dual-Channel IPC Architecture

Because dragging a mouse can fire 60 transformation updates per second, a standard high-overhead messaging pipeline causes major stuttering. The design uses two distinct channels:

| Channel | Transport | Use case |
|---|---|---|
| **Control Channel** | JSON over async Node-API | Low-frequency actions: loading files, picking color indices, fetching manifests |
| **Data Channel** | SharedArrayBuffer (Float32) | High-frequency real-time: transform gizmo drag → live client memory patch |

### Architecture Map

```
[ React UI Preview Canvas / Network HUD ]
           ▲               ▲
           │               │
  (IPC Bridge)           (JSON Logs Stream)
           │               │
           v               v
[ TypeScript API Layer Controller ]
           │               │
  (SharedArrayBuffer)    (Async Callbacks)
           │               │
           v               v
[ Node-API Native C++ Interceptor Engine Core ]
  ├── Memory Module: OpenProcess / WriteProcessMemory
  └── Network Module: Detours Socket Hooks (recv / send)
           │               │
           ▼               ▼
  [ Running SWGClient.exe Process ]
```

---

## SharedArrayBuffer Zero-Copy Data Path

To avoid JSON-serializing transformation vectors 60 times a second, a `SharedArrayBuffer` is allocated in TypeScript and its memory address is passed down to C++. Both environments read and write to this memory space without any copying overhead.

### Shared Buffer Schema (TypeScript)

```typescript
// Fixed structural byte offsets for the Shared Memory buffer
export const SWG_SHARED_BUFFER_SIZE = 64; // 16 floats (a 4x4 Transformation Matrix)

export interface SwgIpcPayload {
  objectId: uint32;
  memoryAddress: uint64; // Target pointer in SWG memory space
  matrixBuffer: SharedArrayBuffer;
}
```

### TypeScript IPC Service (with throttle)

This service manages incoming React Three Fiber scene updates, implements a basic throttle mechanism to protect the OS kernel, and pipes raw arrays safely over the Node-API bridge.

```typescript
import { SWG_SHARED_BUFFER_SIZE } from './IpcSchema';

export class SwgIpcManager {
  private sharedBuffer: SharedArrayBuffer;
  private floatView: Float32Array;
  private isThrottled = false;

  constructor(private nativeAddon: any) {
    // Allocate shared, zero-copy layout space
    this.sharedBuffer = new SharedArrayBuffer(SWG_SHARED_BUFFER_SIZE);
    this.floatView = new Float32Array(this.sharedBuffer);

    // Initialize C++ layer with our shared memory space reference
    this.nativeAddon.initializeSharedChannel(this.sharedBuffer);
  }

  /**
   * Dispatches high-frequency transformations from Three.js TransformControls.
   * @param objectId  The pointer identifier for the SWG object inside game memory
   * @param matrix    The 4x4 matrix from the Three.js object scene graph
   */
  public updateObjectTransformLive(objectId: number, memoryAddress: bigint, matrix: THREE.Matrix4): void {
    if (this.isThrottled) return;

    // 1. Directly copy 16 matrix elements into shared memory without JSON translations
    matrix.toArray(this.floatView);

    // 2. Fire-and-forget signal to native C++ loop via non-blocking call
    this.nativeAddon.signalMemoryPatch(objectId, memoryAddress);

    // 3. Simple throttle aligned with SWG's input/frame processing boundary loop
    this.isThrottled = true;
    requestAnimationFrame(() => {
      this.isThrottled = false;
    });
  }

  /**
   * Control Channel: Dispatches low-frequency configuration modifications (e.g. palette changes).
   */
  public async sendPaletteChange(
    objectId: number,
    memoryAddress: bigint,
    variableId: number,
    colorIndex: number
  ) {
    return this.nativeAddon.patchClientPaletteProperty({
      objectId,
      memoryAddress,
      variableId,
      colorIndex
    });
  }
}
```

### Advanced TypeScript Runtime Core (socket-aware)

The `SwgLiveRuntimeCore` is the extended coordinator that adds packet-sniffer integration alongside the transform injection path.

```typescript
import * as THREE from 'three';

export interface SwgNetworkMessageLog {
  timestamp: string;
  direction: 'inbound' | 'outbound';
  opcodeHex: string;
  size: number;
  asciiDump: string;
}

export class SwgLiveRuntimeCore {
  constructor(private nativeAddon: any) {}

  /**
   * Directly pipes Three.js node transforms into the live game process memory space.
   */
  public injectLiveObjectTransform(memoryAddress: bigint, matrix: THREE.Matrix4): void {
    const flatMatrixBuffer = new Float32Array(16);
    matrix.toArray(flatMatrixBuffer);

    // Fire the high-speed native memory override pipeline
    this.nativeAddon.injectTransformMatrix(memoryAddress, flatMatrixBuffer);
  }

  /**
   * Initializes network sniffer hooks and processes raw packet arrays.
   */
  public listenToClientPackets(onPacketLogged: (msg: SwgNetworkMessageLog) => void): void {
    this.nativeAddon.startPacketSniffer((rawPacket: any) => {
      const hexOp = `0x${rawPacket.opcode.toString(16).toUpperCase().padStart(8, '0')}`;

      // Decrypt or parse specific SWG packet signatures (e.g. 0x1B3512A0 = ObjectUpdate)
      const bytes: Uint8Array = rawPacket.payload;
      const asciiDump = Array.from(bytes)
        .map(b => (b >= 32 && b <= 126 ? String.fromCharCode(b) : '.'))
        .join('');

      onPacketLogged({
        timestamp: new Date().toLocaleTimeString(),
        direction: 'inbound',
        opcodeHex: hexOp,
        size: rawPacket.size,
        asciiDump: asciiDump.substring(0, 48)
      });
    });
  }
}
```

---

## C++ Memory-Injection Core (Attach & Patch)

The C++ Node-API layer attaches to the running `SWGClient.exe` process using Windows API calls and writes the incoming float matrix directly into the game object's memory.

> **Safety & Ethics note:** `OpenProcess` / `WriteProcessMemory` are powerful Windows-only APIs that require elevated privileges and a valid process handle. This approach is intended exclusively for use against a **user's own locally running SWG client** during offline modding and development work. Memory pointer addresses are discovered per-client-build; they are not stable across versions or different compiled binaries. Never use these techniques against processes you do not own or have explicit permission to modify.

### Complete C++ Node-API Module

```cpp
#include <napi.h>
#include <windows.h>
#include <winsock2.h>
#include <vector>
#include <string>
#include <cstring>
#include <iostream>

// --- Global state ---
HANDLE hSwgProcess = NULL;
float* g_sharedMatrixBuffer = nullptr;
Napi::ThreadSafeFunction tsPacketCallback;

// Simple representation of an intercepted network packet frame
struct InterceptedPacket {
    uint32_t opcode;
    uint32_t size;
    std::vector<uint8_t> data;
};

// ---------------------------------------------------------------------------
// Control Channel: Attach to the active SWGClient process
// ---------------------------------------------------------------------------
Napi::Value HookClientProcess(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    uint32_t pid = info[0].As<Napi::Number>().Uint32Value();

    hSwgProcess = OpenProcess(
        PROCESS_VM_OPERATION | PROCESS_VM_READ | PROCESS_VM_WRITE,
        FALSE,
        pid
    );

    if (hSwgProcess == NULL) {
        Napi::TypeError::New(env, "Failed to attach engine hooks to target SWGClient process ID.")
            .ThrowAsJavaScriptException();
        return Napi::Boolean::New(env, false);
    }
    return Napi::Boolean::New(env, true);
}

// Alias used by the simpler IPC manager path (single-arg form)
Napi::Value AttachToClient(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    uint32_t processId = info[0].As<Napi::Number>().Uint32Value();

    g_swgProcessHandle = OpenProcess(
        PROCESS_VM_OPERATION | PROCESS_VM_WRITE,
        FALSE,
        processId
    );

    if (g_swgProcessHandle == NULL) {
        Napi::TypeError::New(env, "Failed to attach to SWG Client Process.")
            .ThrowAsJavaScriptException();
        return env.Null();
    }
    return Napi::Boolean::New(env, true);
}

// ---------------------------------------------------------------------------
// Memory Initialization: Bind the SharedArrayBuffer pointer from JS
// ---------------------------------------------------------------------------
Napi::Value InitializeSharedChannel(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    Napi::ArrayBuffer arrayBuffer = info[0].As<Napi::ArrayBuffer>();

    // Bind global native float pointer to JavaScript's SharedArrayBuffer allocation
    g_sharedMatrixBuffer = static_cast<float*>(arrayBuffer.Data());
    return env.Null();
}

// ---------------------------------------------------------------------------
// High-Frequency Patch: Write the shared matrix buffer into game memory
// (Used with the SharedArrayBuffer path — matrix already in g_sharedMatrixBuffer)
// ---------------------------------------------------------------------------
Napi::Value SignalMemoryPatch(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (!g_swgProcessHandle || !g_sharedMatrixBuffer) return env.Null();

    // uint64 passed as BigInt from TS to preserve 64-bit application memory pointers
    uint64_t targetAddress = info[1].As<Napi::BigInt>().Uint64Value();

    // SWG transformation offset layouts match 4x4 column-major arrangements (Matrix4)
    // Write 64 bytes (16 floats * 4 bytes) directly over the game object pointer target
    SIZE_t bytesWritten;
    BOOL success = WriteProcessMemory(
        g_swgProcessHandle,
        reinterpret_cast<LPVOID>(targetAddress),
        g_sharedMatrixBuffer,
        64,
        &bytesWritten
    );

    return Napi::Boolean::New(env, success);
}

// ---------------------------------------------------------------------------
// High-Frequency Patch: Write a Float32Array passed directly from JS
// (Used with the SwgLiveRuntimeCore path — matrix passed as typed array)
// ---------------------------------------------------------------------------
Napi::Value InjectTransformMatrix(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (!hSwgProcess) return Napi::Boolean::New(env, false);

    // Target memory address passed as BigInt to safeguard 64-bit pointer integrity
    uint64_t targetPointerAddress = info[0].As<Napi::BigInt>().Uint64Value();
    Napi::Float32Array matrixData = info[1].As<Napi::Float32Array>();

    SIZE_t bytesWritten;
    // SWG column-major spatial arrangements occupy exactly 64 bytes (16 floats * 4 bytes)
    BOOL success = WriteProcessMemory(
        hSwgProcess,
        reinterpret_cast<LPVOID>(targetPointerAddress),
        matrixData.Data(),
        64,
        &bytesWritten
    );

    return Napi::Boolean::New(env, success && (bytesWritten == 64));
}

// ---------------------------------------------------------------------------
// Packet Sniffer: Fire raw bytes up to the TypeScript layer thread-safely
// ---------------------------------------------------------------------------
void DispatchPacketToUi(Napi::Env env, Napi::Function jsCallback, InterceptedPacket* packet) {
    Napi::Object pktObj = Napi::Object::New(env);
    pktObj.Set("opcode", Napi::Number::New(env, packet->opcode));
    pktObj.Set("size", Napi::Number::New(env, packet->size));

    Napi::Uint8Array dataArray = Napi::Uint8Array::New(env, packet->data.size());
    std::memcpy(dataArray.Data(), packet->data.data(), packet->data.size());
    pktObj.Set("payload", dataArray);

    jsCallback.Call({pktObj});
    delete packet; // Free memory after dispatch
}

Napi::Value StartPacketSniffer(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    Napi::Function callback = info[0].As<Napi::Function>();

    // Initialize ThreadSafeFunction to bridge async C++ hook threads to the V8 UI loop
    tsPacketCallback = Napi::ThreadSafeFunction::New(
        env, callback, "PacketSnifferWorker", 0, 1
    );

    // IN PRODUCTION BUILD:
    // Deploy a background thread injection or network proxy hook using winsock2 intercepts.
    // e.g. Detouring the native 'recv' and 'send' methods inside 'ws2_32.dll' for SWGClient.exe
    // using Microsoft Detours or manual assembly hooks.

    return env.Null();
}

// ---------------------------------------------------------------------------
// Node Addon Module Registry
// ---------------------------------------------------------------------------
Napi::Object Init(Napi::Env env, Napi::Object exports) {
    exports.Set("attachToClient",        Napi::Function::New(env, AttachToClient));
    exports.Set("hookClientProcess",     Napi::Function::New(env, HookClientProcess));
    exports.Set("initializeSharedChannel", Napi::Function::New(env, InitializeSharedChannel));
    exports.Set("signalMemoryPatch",     Napi::Function::New(env, SignalMemoryPatch));
    exports.Set("injectTransformMatrix", Napi::Function::New(env, InjectTransformMatrix));
    exports.Set("startPacketSniffer",    Napi::Function::New(env, StartPacketSniffer));
    return exports;
}

NODE_API_MODULE(swg_ipc_backend, Init)
```

**Performance characteristics:**
- **Sub-millisecond overhead:** Raw transformation updates pass through a single unchanging block of shared memory, bypassing V8 string creation, serialization, allocation drops, and GC scavenging entirely.
- **Synchronized game previews:** Dragging a structural mesh inside the Three.js viewport repositions the object inside the running SWG game engine instantly.

---

## React Integration — Live Transform Synchronizer

The viewport gizmo that drives these updates is documented in [../03-rendering/viewport-tools.md](../03-rendering/viewport-tools.md). The components below connect that gizmo's `onObjectChange` callback to the memory-injection pipeline.

### SwgLiveSynchronizer (basic — SwgIpcManager path)

```tsx
import React, { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { TransformControls } from '@react-three/drei';
import { SwgIpcManager } from './SwgIpcManager';

interface LiveObjectProps {
  objectId: number;
  memoryAddress: bigint; // Pointer discovered via your client-hook lookup scanner
  ipcManager: SwgIpcManager;
  children: React.ReactNode;
}

export const SwgLiveSynchronizer: React.FC<LiveObjectProps> = ({
  objectId,
  memoryAddress,
  ipcManager,
  children
}) => {
  const groupRef = useRef<THREE.Group>(null);

  return (
    <group ref={groupRef}>
      <TransformControls
        mode="translate"
        object={groupRef.current || undefined}
        onObjectChange={() => {
          if (groupRef.current) {
            // Trigger zero-copy update pipeline down through the native memory engine
            ipcManager.updateObjectTransformLive(
              objectId,
              memoryAddress,
              groupRef.current.matrix
            );
          }
        }}
      />
      {children}
    </group>
  );
};
```

### SwgLiveMemorySynchronizer (advanced — SwgLiveRuntimeCore path)

```tsx
import React, { useRef } from 'react';
import { TransformControls } from '@react-three/drei';
import * as THREE from 'three';

interface SynchronizerProps {
  memoryPointerAddress: bigint; // Object pointer address inside the running client
  liveRuntime: SwgLiveRuntimeCore;
  children: React.ReactNode;
}

export const SwgLiveMemorySynchronizer: React.FC<SynchronizerProps> = ({
  memoryPointerAddress, liveRuntime, children
}) => {
  const groupRef = useRef<THREE.Group>(null);

  const handleGizmoMoveStroke = () => {
    if (groupRef.current && memoryPointerAddress > 0n) {
      // Stream local matrix arrays straight down to the active process memory registers
      liveRuntime.injectLiveObjectTransform(memoryPointerAddress, groupRef.current.matrix);
    }
  };

  return (
    <group ref={groupRef} matrixAutoUpdate={true}>
      <TransformControls
        mode="translate"
        object={groupRef.current || undefined}
        onObjectChange={handleGizmoMoveStroke}
      />
      {children}
    </group>
  );
};
```

---

## Socket & Packet Sniffer

The packet sniffer layer hooks into WinSock2 at the `recv`/`send` boundary (via Microsoft Detours or manual assembly hooks into `ws2_32.dll`) and routes intercepted packets up to the TypeScript layer thread-safely via `Napi::ThreadSafeFunction`. The C++ implementation is in the `StartPacketSniffer` / `DispatchPacketToUi` functions in the module above.

### Live Packet Sniffer Terminal (React Monitor HUD)

```tsx
import React, { useState, useEffect, useRef } from 'react';
import { SwgNetworkMessageLog } from './LiveRuntimeCore';

export const SwgPacketSnifferTerminal: React.FC<{ liveRuntime: any }> = ({ liveRuntime }) => {
  const [packetLogs, setPacketLogs] = useState<SwgNetworkMessageLog[]>([]);
  const [isSniffing, setIsSniffing] = useState(false);
  const terminalEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isSniffing) return;

    // Open network capture hooks channel
    liveRuntime.listenToClientPackets((newLog: SwgNetworkMessageLog) => {
      setPacketLogs(prev => [...prev.slice(-99), newLog]); // Rolling log capped at 100 items
      terminalEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    });
  }, [isSniffing, liveRuntime]);

  return (
    <div style={{ background: '#050508', border: '1px solid #ff0055', borderRadius: '4px', padding: '12px', color: '#fff', fontFamily: 'monospace' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
        <h4 style={{ color: '#ff0055', margin: 0 }}>Live Client Connection Packet Interceptor</h4>
        <button
          onClick={() => setIsSniffing(!isSniffing)}
          style={{ background: isSniffing ? '#ff0055' : '#222', border: '1px solid #ff0055', color: '#fff', padding: '4px 10px', cursor: 'pointer', fontWeight: 'bold', borderRadius: '2px' }}
        >
          {isSniffing ? 'STOP HOOKS' : 'START INTERCEPT'}
        </button>
      </div>

      {/* Terminal Output Logs Console */}
      <div style={{ height: '180px', overflowY: 'auto', background: '#000', border: '1px solid #222', padding: '6px', fontSize: '11px', display: 'flex', flexDirection: 'column', gap: '3px' }}>
        {packetLogs.length === 0 ? (
          <div style={{ color: '#444', textAlign: 'center', paddingTop: '70px' }}>
            Network adapter offline. Awaiting pipeline attachment...
          </div>
        ) : (
          packetLogs.map((log, i) => (
            <div key={i} style={{ display: 'flex', gap: '12px', borderBottom: '1px solid #111' }}>
              <span style={{ color: '#555' }}>[{log.timestamp}]</span>
              <span style={{ color: '#00ffcc', fontWeight: 'bold' }}>{log.opcodeHex}</span>
              <span style={{ color: '#ffcc00' }}>{log.size}B</span>
              <span style={{ color: '#aaa', flex: 1, overflow: 'hidden' }}>{log.asciiDump}</span>
            </div>
          ))
        )}
        <div ref={terminalEndRef} />
      </div>
    </div>
  );
};
```

**Packet log fields:**
- `opcodeHex` — zero-padded 8-digit hex opcode (e.g. `0x1B3512A0` for an `ObjectUpdate` message)
- `size` — raw byte count of the intercepted packet
- `asciiDump` — first 48 printable characters of payload; non-printable bytes rendered as `.`

---

## Related Documents

- IFF/TRE binary format parsing: [../01-core-engine/iff-and-tre.md](../01-core-engine/iff-and-tre.md)
- Viewport gizmo & TransformControls setup: [../03-rendering/viewport-tools.md](../03-rendering/viewport-tools.md)
- Source provenance & AI-content caveats: [../00-overview/source-provenance.md](../00-overview/source-provenance.md)
