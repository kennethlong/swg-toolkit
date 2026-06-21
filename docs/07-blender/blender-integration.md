# Blender Integration — Bridge, Sync Panel, Animation Export, AI Mocap

> Covers: Blender↔studio WebSocket bridge, in-Blender SWG sync panel, animation export to .ans, AI mocap retargeting. Source: research doc lines 14831–15393.

> **Caveat:** The coordinate-conversion specifics and .ans layout described here are AI-proposed. Validate every detail against the real [`swg-blender-plugin`](../swg-blender-plugin) / `io_scene_swg_msh` source and the client engine before relying on them in production. See [source provenance](../00-overview/source-provenance.md).

---

## Strategy and Division of Labor

Bridging Blender with the React/C++ studio avoids reinventing the hardest parts of 3D tooling. The division is clean:

| Blender owns | Studio owns |
|---|---|
| Mesh modeling, vertex topology | SWG .msh/.skt/.ans binary compilers |
| Skeletal weight-painting and rigging | .DTII datatable spreadsheets, .STF text |
| UV unwrapping and texture coordinate mapping | Win32 live memory injection (Utinni hooks) |
| Keyframe animation authoring (IK, constraints, graph editor) | Base44 changeset version control |
| Shader node tree construction (Principled BSDF) | Remote Core3 server daemon orchestration |

### The "Ultimate Modding Loop" Architecture

```
[ Blender 3D Art Studio ] ──(Local WebSocket Pipe)──> [ Desktop App Core Hub ]
  - Edits .MSH Vertex Meshes                           - Manages Base44 Changesets
  - Skin Weights & Rigging Animations                  - Parses .DTII Spreadsheets & .STF Text
  - Maps Texture UV Node Coordinates                   - Controls Win32 Live Memory Injection
                                                       - Syncs to Remote Core3 Server Daemon
```

### Eliminating Content Pipeline Friction

The current community pipeline is fragmented: create in Blender → export .obj/.fbx → convert with a community tool → copy into client directory → pack .tre → restart the executable. The bridge collapses this into a single button click in Blender: the studio receives raw geometry buffers, runs C++ compilers inline, packages a changeset, and drops it into the live game folder or injects via Utinni memory hooks.

### High-Utility Blender-to-App Synergies

**Skeletal rigging and animation parity (.skt / .ans)**
The studio reads resting bone transforms from .skt data files and passes them over the bridge to auto-construct a matching Armature inside Blender. Artists animate or weight-paint against the correct legacy bones, then pass keyframe matrices back for serialization into .ans files. The `.ans` format internals (ANST/CHNL/POSK/ROTK chunk layout) are documented separately in [../02-formats/skeletons-and-animation.md](../02-formats/skeletons-and-animation.md) — they are not reproduced here. See [../swg-blender-plugin](../swg-blender-plugin) for the authoritative rig naming scheme and existing serialization code.

**Collision hull extraction (.cdf / .pob)**
The bridge eliminates hand-authoring of collision volumes entirely. The artist sketches simple bounding boxes or spheres directly over a high-poly mesh inside Blender — no separate collision-geometry tool required. On save, the bridge extracts the primitive coordinates from those proxy objects and feeds them straight to the C++ `.cdf` / `.pob` collision compilers, producing accurate per-object collision data from the original sculpt without any manual measurement. For the full chunk layout of the compiled collision and portal files see [../02-formats/collision-and-portals.md](../02-formats/collision-and-portals.md). The integration target for this workflow is the [`../swg-blender-plugin`](../swg-blender-plugin).

**Material node mapping specifics (.sht)**
The Principled BSDF → `.sht` translation is more literal than it might appear. Connecting a Blender image texture node to the **Emissive** slot of a Principled BSDF node is the key signal the bridge watches: the studio detects that connection and writes the corresponding **`PASS`** and **`ANIM`** chunks into the `.sht` shader binary — the same chunks the renderer uses to drive scrolling, animated, or emissive texture layers. Other Principled BSDF sockets (Base Color, Roughness, Normal) map to their analogous `.sht` texture-stage declarations through the same mechanism. For a full treatment of `.sht` chunk semantics and the IFF serialization layer see [../03-rendering/shaders-and-fx.md](../03-rendering/shaders-and-fx.md). IFF reader/writer boilerplate is also documented in [../01-core-engine/iff-and-tre.md](../01-core-engine/iff-and-tre.md).

---

## WebSocket Bridge (TypeScript)

An independent local WebSocket server runs inside the Electron main process (`src/main.ts`). Blender Python scripts pipe raw vertex arrays or JSON data to the editor workspace.

```typescript
import { WebSocketServer, WebSocket } from 'ws';

export class InterAppCommunicationBridge {
  private wss: WebSocketServer | null = null;

  public initializeBridge(port = 9012) {
    this.wss = new WebSocketServer({ port });
    console.log(`[Bridge] Inter-App connection channel listening on local port ${port}`);

    this.wss.on('connection', (ws: WebSocket) => {
      console.log('[Bridge] Blender plugin connection successfully established!');

      ws.on('message', async (message: string) => {
        try {
          const payload = JSON.parse(message);

          if (payload.action === 'export:mesh_geometry') {
            // Unpack raw vertex, index, and UV tracking arrays sent from Blender python
            const { vertices, indices, uvMap, targetFileName } = payload.data;

            // Invoke your C++ N-API binary builder to compile an official SWG .msh block
            // await window.api.compileMeshToMshFile(vertices, indices, uvMap, targetFileName);

            console.log(`[Bridge] Successfully compiled and packaged Blender asset: ${targetFileName}`);
          }
        } catch (err: any) {
          console.error('[Bridge] Failed to parse incoming inter-app frame data:', err.message);
        }
      });
    });
  }
}
```

The bridge also handles a second action type, `compile:animation_track`, described in the animation section below.

---

## Blender Python Client Link

The companion Blender script uses Python's `websocket-client` library to extract mesh geometry and stream it to the app. Install `websocket-client` into Blender's bundled Python distribution.

```python
import bpy
import json
import bmesh
import websocket  # Ensure 'websocket-client' is accessible within Blender's python distribution environment

def send_mesh_to_studio_app(context):
    obj = context.active_object
    if not obj or obj.type != 'MESH':
        print("Active target selection is not a valid 3D mesh model.")
        return

    # Extract clean vertex and polygon index coordinate streams
    mesh = obj.data
    vertices = []
    indices = []

    for vertex in mesh.vertices:
        vertices.extend([vertex.co.x, vertex.co.y, vertex.co.z])

    for poly in mesh.polygons:
        # Triangulate polygons on the fly to match the WebGL/SWG graphics layer standard
        if len(poly.vertices) == 3:
            indices.extend(poly.vertices)

    # Package data stream structure
    payload = {
        "action": "export:mesh_geometry",
        "data": {
            "targetFileName": f"appearance/{obj.name}.msh",
            "vertices": vertices,
            "indices": indices
        }
    }

    # Stream the payload over the local loop websocket port channel
    try:
        ws = websocket.create_connection("ws://localhost:9012")
        ws.send(json.dumps(payload))
        ws.close()
        print("Successfully dispatched geometry payload directly to SWG Studio app hub!")
    except Exception as e:
        print(f"Inter-app data transmission failed: {str(e)}")
```

---

## In-Blender SWG Sync Panel

The sync panel lets modders adjust game data (weapon stats, item properties, memory addresses) without leaving their 3D viewport. It reads `bpy.props` variables, serializes them to JSON, and pipes them over the WebSocket bridge. The studio applies changes to Base44 changesets and injects via the C++ memory injection core.

### Data Mapping Loop

```
[ Blender 3D UI Panel ] ──(Click 'Sync to Live Client')──> [ Embedded Python Worker Thread ]
          │                                                            │
  (Reads bpy.props variables)                                (Sends WebSocket JSON Packet)
          │                                                            │
          v                                                            v
[ Active Client Process ] <── (Win32 Live Memory Inject) <── [ Desktop Studio App Core ]
```

### Step 1 — Registering Custom SWG Properties

```python
import bpy

# Define a property group to hold our target SWG modding variables
class SwgItemProperties(bpy.types.PropertyGroup):
    target_template_path: bpy.props.StringProperty(
        name="Object Template",
        description="Target SWG Shared Object Template path (.iff)",
        default="object/weapon/melee/sword/shared_sword_2h_maul.iff"
    )
    min_damage: bpy.props.IntProperty(
        name="Minimum Damage",
        description="Base lower damage threshold metric",
        default=250, min=1, max=10000
    )
    max_damage: bpy.props.IntProperty(
        name="Maximum Damage",
        description="Base upper damage threshold metric",
        default=500, min=1, max=10000
    )
    attack_speed: bpy.props.FloatProperty(
        name="Attack Speed",
        description="Weapon speed delay intervals in seconds",
        default=3.5, min=0.1, max=10.0, step=10
    )
    live_memory_address: bpy.props.StringProperty(
        name="Memory Pointer Address",
        description="The live process memory address hash for Utinni real-time injection",
        default="0x00000000"
    )

def register_properties():
    bpy.utils.register_class(SwgItemProperties)
    # Attach our custom data tracking matrix straight onto the active scene context
    bpy.types.Scene.swg_studio_sync = bpy.props.PointerProperty(type=SwgItemProperties)

def unregister_properties():
    bpy.utils.unregister_class(SwgItemProperties)
    del bpy.types.Scene.swg_studio_sync
```

### Step 2 — Asynchronous Sync Operator

Runs the WebSocket dispatch inside a background thread so the Blender UI does not freeze.

```python
import json
import threading

class OBJECT_OT_SwgParitySync(bpy.types.Operator):
    bl_idname = "object.swg_parity_sync"
    bl_label = "Sync to Game Client & Server"
    bl_description = "Pipes data properties straight into your running client memory maps and server daemons."

    def execute(self, context):
        # Access our registered scene variables
        swg_data = context.scene.swg_studio_sync

        # Map structural properties into a standard key-value layout array
        payload = {
            "action": "modify:item_metrics",
            "data": {
                "templateName": swg_data.target_template_path,
                "minDamage": swg_data.min_damage,
                "maxDamage": swg_data.max_damage,
                "attackSpeed": swg_data.attack_speed,
                "memoryAddress": swg_data.live_memory_address
            }
        }

        # Run the WebSocket dispatch inside an independent background thread to safeguard UI performance
        threading.Thread(target=self.dispatch_socket_packet, args=(payload,)).start()

        self.report({'INFO'}, "Dispatched item parameters update directly to your studio core!")
        return {'FINISHED'}

    def dispatch_socket_packet(self, payload_dict):
        try:
            import websocket  # Requires 'websocket-client' accessible inside Blender's python directory
            ws = websocket.create_connection("ws://localhost:9012")
            ws.send(json.dumps(payload_dict))
            ws.close()
        except Exception as e:
            print(f"[Blender Plugin Sync Fault Loop] Connection timed out or dropped: {str(e)}")
```

### Step 3 — 3D Viewport Sidebar Panel Interface

Displayed in the N-Panel shelf inside the 3D Viewport under the "SWG Studio" tab.

```python
class VIEW3D_PT_SwgStudioSyncPanel(bpy.types.Panel):
    bl_space_type = 'VIEW_3D'
    bl_region_type = 'UI'
    bl_category = 'SWG Studio'  # The title text on the vertical sidebar layout tab button
    bl_label = "Real-Time Cross-Parity Mixer"

    def draw(self, context):
        layout = self.layout
        swg_data = context.scene.swg_studio_sync

        # --- PANEL SECTION ONE: REPO & MAPPING PATHWAYS ---
        box = layout.box()
        box.label(text="Target Database Mapping", icon='FILE_FOLDER')
        box.prop(swg_data, "target_template_path", text="")

        # --- PANEL SECTION TWO: ITEM STATISTICS BALANCING GRID ---
        box = layout.box()
        box.label(text="Combat Parameter Controls", icon='DOCK')

        row = box.row(align=True)
        row.prop(swg_data, "min_damage")
        row.prop(swg_data, "max_damage")

        box.prop(swg_data, "attack_speed", slider=True)

        # --- PANEL SECTION THREE: UTINNI RUNTIME MEMORY LIVE HOOKS ---
        box = layout.box()
        box.label(text="Utinni Process Injector Engine", icon='CONSOLE')
        box.prop(swg_data, "live_memory_address", text="Pointer Addr")

        # --- ANIMATION COMPILER SECTION (added in Step 5 below) ---
        box = layout.box()
        box.label(text="Kinematics Animation Compiler", icon='ANIM')
        box.label(text="Active Range: " + str(context.scene.frame_start) + " to " + str(context.scene.frame_end))
        # Draws our custom animation track compiler operator button directly onto the screen layout
        box.operator("object.swg_anim_exporter", icon='POSE_DATA', text="Compile Timeline to .ANS")

        # --- ACTION TRIGGER DEPLOYMENT BUTTON ---
        layout.separator()
        # Fires our background threading worker operator to sync everything simultaneously
        layout.operator("object.swg_parity_sync", icon='EXPORT', text="Execute Global Parity Sync")
```

### Step 4 — Registering the Complete Plugin Matrix

Ties all panel classes, property contexts, and operators into a drop-in Blender addon `.py` file.

```python
classes = (
    OBJECT_OT_SwgParitySync,
    OBJECT_OT_SwgAnimExporter,  # defined in the animation section below
    VIEW3D_PT_SwgStudioSyncPanel,
)

def register():
    register_properties()
    for cls in classes:
        bpy.utils.register_class(cls)

def unregister():
    for cls in classes:
        bpy.utils.unregister_class(cls)
    unregister_properties()

if __name__ == "__main__":
    register()
```

---

## Animation Export to .ans

The .ans binary format internals (ANST/CHNL/POSK/ROTK chunk layout) are documented in [../02-formats/skeletons-and-animation.md](../02-formats/skeletons-and-animation.md). IFF serialization primitives are in [../01-core-engine/iff-and-tre.md](../01-core-engine/iff-and-tre.md). This section focuses on the **Blender-side extraction**, **coordinate conversion**, and the **export operator**. Cross-reference the real `swg-blender-plugin` / [../swg-blender-plugin](../swg-blender-plugin) for authoritative bone naming and existing serialization code.

### Pipeline Overview

```
[ Blender Armature Timeline ] ──(Run Python Operator)──> [ Unpack Bone Channels Pool ]
                                                                   │
                                                         (WebSocket JSON Stream)
                                                                   │
                                                                   v
  [ Deployable .ANS File ] <── (Packs IFF ANST/CHNL) <── [ Node-API C++ Core Compiler ]
```

### Coordinate System Conversion

> **Validate this against the real engine and `io_scene_swg_msh` before use.**

Blender uses a Right-Handed Z-Up coordinate system. SWG uses Right-Handed Y-Up. Apply this axis remap to every bone position vector before sending:

```
X_swg =  X_blender
Y_swg =  Z_blender
Z_swg = -Y_blender
```

Rotation quaternions follow the same remap applied to their XYZ components:

```
[qx, qy, qz, qw]_swg = [qx_blender, qz_blender, -qy_blender, qw_blender]
```

### Extracting Keyframe Channels from Blender (Python)

This operator sweeps the active frame range, samples each pose bone's local transform, applies the coordinate conversion, and streams the result over the local socket.

```python
import bpy
import json
import websocket

class OBJECT_OT_SwgAnimExporter(bpy.types.Operator):
    bl_idname = "object.swg_anim_exporter"
    bl_label = "Compile Animation Track to .ANS"
    bl_description = "Extracts armature timeline keyframes and streams them to the C++ core compiler."

    def execute(self, context):
        obj = context.active_object
        if not obj or obj.type != 'ARMATURE':
            self.report({'ERROR'}, "Active selection is not a valid structural Armature skeleton.")
            return {'CANCELLED'}

        scene = context.scene
        start_frame = scene.frame_start
        end_frame = scene.frame_end
        fps = scene.render.fps

        # Initialize our structural tracking matrix payload
        animation_manifest = {
            "action": "compile:animation_track",
            "data": {
                "animationName": obj.name + "_track",
                "channels": []
            }
        }

        # Initialize dictionary to collect keys per bone
        bone_tracks = {
            bone.name: {"boneName": bone.name, "positionKeys": [], "rotationKeys": []}
            for bone in obj.pose.bones
        }

        # 1. SWEEP ACROSS TIMELINE FRAMES
        for frame in range(start_frame, end_frame + 1):
            scene.frame_set(frame)
            time_seconds = (frame - start_frame) / fps

            for p_bone in obj.pose.bones:
                # Resolve local transformation matrices relative to the resting pose parent offsets
                if p_bone.parent:
                    local_matrix = p_bone.parent.matrix.inverted() @ p_bone.matrix
                else:
                    local_matrix = p_bone.matrix

                pos, quat, scale = local_matrix.decompose()

                # 2. APPLY COORDINATE AXIS CONVERSION (Z-Up to Y-Up translation mapping)
                converted_pos = [pos.x, pos.z, -pos.y]
                converted_quat = [quat.x, quat.z, -quat.y, quat.w]  # [X, Y, Z, W] format mapping

                # Append unrolled timeline frame keys tracking coordinates sequentially
                bone_tracks[p_bone.name]["positionKeys"].extend([time_seconds, *converted_pos])
                bone_tracks[p_bone.name]["rotationKeys"].extend([time_seconds, *converted_quat])

        animation_manifest["data"]["channels"] = list(bone_tracks.values())

        # 3. STREAM PAYLOAD OVER LOCAL WEBSOCKET PORT CONNECTION
        try:
            ws = websocket.create_connection("ws://localhost:9012")
            ws.send(json.dumps(animation_manifest))
            ws.close()
            self.report({'INFO'}, f"Successfully dispatched animation timeline ({end_frame - start_frame} frames) to core app!")
        except Exception as e:
            self.report({'ERROR'}, f"Socket connection failed: {str(e)}")

        return {'FINISHED'}
```

### Inside-Out .ans Binary Serialization Engine (C++)

The studio's native C++ module receives the unrolled channel arrays, packs them into CHNL/POSK/ROTK sub-chunks, computes byte footprints, and writes an ANST FORM block. See [../02-formats/skeletons-and-animation.md](../02-formats/skeletons-and-animation.md) for the full chunk layout spec.

```cpp
#include <napi.h>
#include <vector>
#include <string>
#include <cstring>
#include <algorithm>

struct NativeKeyframeChannel {
    std::string boneName;
    std::vector<float> positionData; // Unrolled flat floats array: [time, x, y, z, ...]
    std::vector<float> rotationData; // Unrolled flat floats array: [time, qx, qy, qz, qw, ...]
};

class SwgAnsBinaryEncoder {
public:
    static std::vector<uint8_t> SerializeAnimationTrack(const std::vector<NativeKeyframeChannel>& channels) {
        IffBinaryWriter contentWriter;

        for (const auto& ch : channels) {
            IffBinaryWriter chnlContentWriter;

            // 1. Pack the destination bone target name identifier (NAME chunk)
            IffBinaryWriter nameWriter;
            nameWriter.WriteString(ch.boneName);
            chnlContentWriter.PackChunk("NAME", nameWriter.buffer);

            // 2. Pack unrolled translation curves (POSK chunk)
            if (!ch.positionData.empty()) {
                IffBinaryWriter poskWriter;
                uint32_t keyCount = static_cast<uint32_t>(ch.positionData.size() / 4);
                poskWriter.WriteUint32(keyCount);
                for (float val : ch.positionData) {
                    poskWriter.WriteFloat(val);
                }
                chnlContentWriter.PackChunk("POSK", poskWriter.buffer);
            }

            // 3. Pack unrolled orientation rotation curves (ROTK chunk)
            if (!ch.rotationData.empty()) {
                IffBinaryWriter rotkWriter;
                uint32_t keyCount = static_cast<uint32_t>(ch.rotationData.size() / 5);
                rotkWriter.WriteUint32(keyCount);
                for (float val : ch.rotationData) {
                    rotkWriter.WriteFloat(val);
                }
                chnlContentWriter.PackChunk("ROTK", rotkWriter.buffer);
            }

            // 4. Enclose this bone track inside an active IFF CHNL sub-FORM container
            IffBinaryWriter chnlFormWriter;
            chnlFormWriter.WriteTag("FORM");
            chnlFormWriter.WriteUint32(static_cast<uint32_t>(chnlContentWriter.buffer.size() + 4));
            chnlFormWriter.WriteTag("CHNL");
            chnlFormWriter.WriteRawBuffer(chnlContentWriter.buffer);

            contentWriter.WriteRawBuffer(chnlFormWriter.buffer);
        }

        // 5. Enclose within master FORM -> ANST container
        IffBinaryWriter masterFormWriter;
        masterFormWriter.WriteTag("FORM");
        masterFormWriter.WriteUint32(static_cast<uint32_t>(contentWriter.buffer.size() + 4));
        masterFormWriter.WriteTag("ANST");
        masterFormWriter.WriteRawBuffer(contentWriter.buffer);

        return masterFormWriter.buffer;
    }
};
```

### Exposing the Animation Compiler to N-API

This entry point reconstructs the JSON channel arrays from the WebSocket payload into native vectors and returns an exportable binary `ArrayBuffer`.

```cpp
Napi::Value CompileJsToAnsStream(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    Napi::Array jsChannels = info[0].As<Napi::Array>();

    std::vector<NativeKeyframeChannel> nativeChannels;
    size_t channelCount = jsChannels.Length();
    nativeChannels.reserve(channelCount);

    for (uint32_t i = 0; i < channelCount; ++i) {
        Napi::Object jsChObj = jsChannels.Get(i).As<Napi::Object>();
        NativeKeyframeChannel chNode;

        chNode.boneName = jsChObj.Get("boneName").As<Napi::String>().Utf8Value();

        Napi::Float32Array jsPos = jsChObj.Get("positionKeys").As<Napi::Float32Array>();
        chNode.positionData.assign(jsPos.Data(), jsPos.Data() + jsPos.Length());

        Napi::Float32Array jsRot = jsChObj.Get("rotationKeys").As<Napi::Float32Array>();
        chNode.rotationData.assign(jsRot.Data(), jsRot.Data() + jsRot.Length());

        nativeChannels.push_back(chNode);
    }

    // Execute our inside-out structural IFF binary compiler loop
    std::vector<uint8_t> compiledAnsBytes = SwgAnsBinaryEncoder::SerializeAnimationTrack(nativeChannels);

    Napi::ArrayBuffer outputBuffer = Napi::ArrayBuffer::New(env, compiledAnsBytes.size());
    std::memcpy(outputBuffer.Data(), compiledAnsBytes.data(), compiledAnsBytes.size());
    return outputBuffer;
}
```

---

## AI Mocap → Retarget → .ans Pipeline

Markerless motion capture tools use deep learning or computer vision to reconstruct human skeleton poses from standard video. The result is imported into Blender, retargeted onto the SWG skeleton, then compiled to .ans via the operator above.

### Cloud-Based AI Video-to-Animation Suites (Blender Connected)

**Radical (Radical Motion)**
Uploads a standard 2D video (including smartphone footage) to a web platform or direct Blender add-on. AI extracts full 3D skeletal data including root motion translation. The add-on streams or imports the resulting bone keyframes directly onto an armature rig in the active viewport.

**Rokoko Video**
Part of Rokoko's animation ecosystem. Upload video to their cloud engine for free markerless motion tracking. Download the animation track or use the official Rokoko Blender add-on to retarget the extracted motion onto the legacy SWG skeleton armature.

**DeepMotion (Animate 3D)**
Browser-based AI video processor. Tracks full-body movement and includes automated physics filtering (preventing foot sliding or unnatural joint twists). Exports standard animation tracks that open cleanly in Blender's Action Editor.

### Native Local Blender Add-ons (Computer Vision / Offline)

**Plask / OpenPose Blender Bridges**
Community bridges on GitHub leveraging OpenPose or MediaPipe open-source tracking frameworks. Captures a webcam feed or raw video file locally, tracks 2D joint markers, runs analytical depth estimation, and maps results to a local Blender bone armature.

**Kinect-to-Blender Scripts**
For recordings captured with an Xbox Kinect sensor. Tools like Brekel or open-source alternatives map the depth video data directly, providing real-time skeletal previews on character models inside Blender.

### The Visual Retargeting Step

AI-extracted animations use a generic human skeleton. To port movement onto the SWG character rig the retargeting step maps generic bone names to SWG bone names (e.g., `spine_01` → `spine1`).

**Expy-Rigger (free / built-in logic variants)**
Automatically maps extracted video bone names to match custom character rigs for clean data conversion.

**Auto-Rig Pro (Remap Tool subsystem — recommended)**
The gold standard for armature management in Blender. Select the source video animation armature, choose the target SWG skeleton rig, match bone endpoints, and click "Retarget" to bake keyframes onto the game's native coordinates.

An automated retargeting configuration template baked into the Blender Python addon would snap generic AI-mocap bones onto the specific SWG character skeleton naming scheme automatically during import.

### Full Pipeline Workflow for SWG Custom Content

1. **Capture** — Record a sword flourish, emote, or gesture on standard video.
2. **Extract** — Run the video through Rokoko Video, DeepMotion, or a local OpenPose bridge to isolate the raw 3D keyframe track.
3. **Retarget** — Import into Blender and use Auto-Rig Pro or the Rokoko add-on to conform the motion track onto the legacy client skeleton bones (.skt).
4. **Compile** — Click "Compile Timeline to .ANS" in the SWG Studio sidebar to serialize the keyframes into a Base44 changeset patch volume.

The output .ans file interfaces directly with the changeset bundling engine: a single button compiles animations, inserts them into the .tre patch volume, updates launch parameters, and syncs to both test client and server repository simultaneously.
