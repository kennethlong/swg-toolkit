# Phase 5: WYSIWYG Live-Sync & Typed Editors - Pattern Map

**Mapped:** 2026-07-08
**Files analyzed:** 27 (new + extended)
**Analogs found:** 27 / 27 (every file has at least a role-match analog in this repo)

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|--------------------|------|-----------|-----------------|----------------|
| `packages/contracts/src/live-inject.ts` (EXTEND) | contract/config | streaming (seqlock) | itself (existing `LIVE_CHANNEL_LAYOUT`) | exact — extend in place |
| `packages/live-inject/agent/channel.h` (EXTEND) | model (struct + decls) | streaming | itself (existing `LiveState`) | exact |
| `packages/live-inject/agent/channel.cpp` (EXTEND) | service (seqlock writer) | streaming | itself (existing `channelWrite`) — mirror for read-direction command slot | exact |
| `packages/live-inject/agent/write.h` / `write.cpp` (NEW) | service (guard + setter invocation) | event-driven | `packages/live-inject/agent/sentinels.h/.cpp` (pure gate pattern) | role-match |
| `packages/live-inject/agent/agent_main.cpp` (EXTEND) | controller (poll loop) | event-driven | itself (existing poll loop) | exact |
| `packages/live-inject/agent/rva_table.cpp` (EXTEND) | config (RVA/binding table) | request-response | itself (existing `g_agentBindings[]`) | exact |
| `packages/live-inject/src/channel_binding.cpp` (EXTEND) | controller (N-API binding) | streaming | itself (existing `OpenChannel`/`ReadChannelView`) | exact |
| `packages/live-inject/src/inject_binding.cpp` (EXTEND — stop-signal, detach) | controller (N-API binding) | event-driven | itself + `packages/renderer/src/hooks/useLiveService.ts` (`detachUI` already calls a no-op `addon.detach`) | exact |
| `packages/renderer/src/hooks/useCommandWriter.ts` (NEW) | hook | streaming (rAF write loop) | `packages/renderer/src/hooks/useChannelReader.ts` (rAF read loop, seqlock) | exact (mirror direction) |
| `packages/renderer/src/hooks/useLiveService.ts` (EXTEND — wire detach button) | hook/service | request-response | itself | exact |
| `packages/renderer/src/state/liveStore.ts` (EXTEND — COW snapshot, write log, guard state) | store | CRUD (in-memory) | itself | exact |
| `packages/renderer/src/panels/viewport/TransformGizmo.tsx` (NEW) | component (R3F) | event-driven | `packages/renderer/src/panels/viewport/Viewport.tsx` (Canvas/scene host) + drei `TransformControls` (dep) | role-match |
| `packages/renderer/src/panels/viewport/LiveSyncClientCard.tsx` (NEW) | component (HUD overlay) | request-response | `packages/renderer/src/shell/StatusBar.tsx` (state→chip rendering) + `packages/renderer/src/panels/viewport/Viewport.tsx` (`MissingDepsOverlay` absolutely-positioned overlay pattern) | role-match |
| `packages/renderer/src/panels/viewport/GizmoModeRail.tsx` (NEW) | component | event-driven | `packages/renderer/src/panels/deploy/*` segmented-control/toolbar buttons (e.g. `ActionBadge.tsx`) | partial-match |
| `packages/renderer/src/panels/viewport/TransformReadoutBar.tsx` (NEW) | component | streaming (imperative refs) | `packages/renderer/src/panels/viewport/Viewport.tsx` `StatsCollector` (imperative `useFrame`-driven readout, no per-frame React state) | role-match |
| `packages/renderer/src/shell/StatusBar.tsx` (EXTEND — sync/guard/COW segments) | component | request-response | itself (existing live-mode segment + `Dot()` helper) | exact |
| `packages/native-core/modules/core/formats/DataTable.h` / `.cpp` (NEW) | model (parser) | file-I/O (batch parse) | `packages/native-core/modules/core/formats/Effect.h` / `.cpp` (IFF-tree-based, engine-free, `FormatParseError`) | exact structural match (IFF FORM tree) |
| `packages/native-core/modules/core/formats/StringTable.h` / `.cpp` (NEW, `.stf`) | model (parser + serializer) | file-I/O (batch parse+serialize) | `packages/native-core/modules/core/formats/Palette.h` / `.cpp` (PARSER-NATIVE raw-bytes, NOT IFF-tree, has `serializeX` sibling for round-trip) | exact structural match (raw-bytes format, needs serialize) |
| `packages/native-core/src/dtii_binding.cpp` (NEW, or added fns in `mesh_binding.cpp`) | controller (N-API binding) | file-I/O | `packages/native-core/src/mesh_binding.cpp` `ParseEffect` (IFF-tree binding: `extractBytes` + `extractRootNode` + try/catch two-tier) | exact |
| `packages/native-core/src/stf_binding.cpp` (NEW) | controller (N-API binding) | file-I/O | `packages/native-core/src/mesh_binding.cpp` `ParsePalette`/`ParseDds` (raw-bytes binding + `roundTripBytes` serialize-back pattern) | exact |
| `packages/harness/fixtureRegistry.ts` (EXTEND — `registerFormat('dtii', ...)`, `registerFormat('stf', ...)`) | config/registry | batch | itself | exact |
| `packages/harness/test/dtii-roundtrip.test.ts` (NEW) | test | batch | `packages/harness/test/mesh-roundtrip.test.ts` / `tre-roundtrip.test.ts` (uses `assertRoundTrip` + `fixtureRegistry`) | exact |
| `packages/harness/test/stf-roundtrip.test.ts` (NEW) | test | batch | `packages/harness/test/tre-v6000-swgsource-byteexact.test.ts` (byte-exact-not-logical-model gate, per Pitfall 4 warning) | exact |
| `packages/renderer/src/panels/editors/DatatableGridEditor.tsx` (NEW; retires/upgrades `DatatablePanel.tsx`) | component (main-editor-group tab) | CRUD + streaming (virtualized grid) | `packages/renderer/src/panels/tre/VfsTree.tsx` (ROW_HEIGHT/OVERSCAN/ResizeObserver virtualization) + `packages/renderer/src/panels/iff/HexInspector.tsx` (Hex-view toggle target, selected-range highlight) | exact (virtualization) |
| `packages/renderer/src/panels/editors/StfStringsEditor.tsx` (NEW) | component (main-editor-group tab) | CRUD + streaming (virtualized grid) | same as above (sibling anatomy, per UI-SPEC) | exact |
| `packages/renderer/src/panels/editors/shared/GateBar.tsx` / `GateChip.tsx` / `FailBanner.tsx` (NEW) | component (shared) | request-response | `packages/renderer/src/shared/VerificationStatus.tsx` (glyph+color+caption triple-encoded status pill, already used for round-trip pass/fail) | exact (state-machine chip pattern) |
| `packages/renderer/src/panels/editors/SchemaRail.tsx` (NEW) | component | CRUD (read-mostly) | `packages/renderer/src/panels/tre/ShadowChainDetail.tsx` (collapsible kv-row detail panel outside a virtualized list) | role-match |
| `packages/renderer/src/panels/editors/DatatableGridEditor.stage.ts` / staging wiring (uses `＋ Stage`) | service | CRUD | `packages/renderer/src/state/stagingStore.ts` + `packages/renderer/src/panels/deploy/StagingPanelBody.tsx` (`isVirtualPathSafe`, `StagingEntry` upsert) | exact |

## Pattern Assignments

### `packages/contracts/src/live-inject.ts` (contract, streaming) — EXTEND

**Analog:** itself (existing `LIVE_CHANNEL_LAYOUT`, `packages/contracts/src/live-inject.ts:56-70`)

**Existing layout to extend (lines 44-70):**
```typescript
export const LIVE_CHANNEL_LAYOUT = {
  SEQ_COUNTER:   { offset: 0,   length: 4   },
  TRANSFORM:     { offset: 4,   length: 48  },
  NETWORK_ID:    { offset: 52,  length: 8   },
  TEMPLATE_NAME: { offset: 60,  length: 256 },
  LIVENESS:      { offset: 316, length: 4   },
  TOTAL_SIZE:    { offset: 0,   length: 320 },
} as const;
```

**Extension pattern (RESEARCH.md Pattern 1, verbatim proposal — same object, grows TOTAL_SIZE, do NOT create a second layout constant):**
```cpp
// New fields appended at offset 320+ (mirrors channel.h struct below):
// COMMAND_SEQ_COUNTER: { offset: 320, length: 4 }
// COMMAND_TRANSFORM:   { offset: 324, length: 48 }
// COMMAND_FLAGS:       { offset: 372, length: 4 }
// TOTAL_SIZE grows 320 -> 376
```

Also extend the `LiveIpcMessage` union (lines 33-38) with a `live-write-command` message type following the exact discriminated-union style already used for `LiveAttachRequest`/`LiveStateUpdate` (lines 17-30).

---

### `packages/live-inject/agent/channel.h` / `channel.cpp` (model + service, streaming) — EXTEND

**Analog:** itself. The existing `LiveState` struct (`channel.h:33-40`) and `channelWrite` seqlock protocol (`channel.cpp:69-89`) are the template to mirror for the write direction.

**Struct to extend** (`channel.h:32-40`):
```cpp
#pragma pack(push, 4)
struct LiveState {
    LONG      seqCounter;        // offset   0
    float     transform[3][4];   // offset   4
    uint64_t  networkId;         // offset  52
    char      templateName[256]; // offset  60
    uint32_t  liveness;          // offset 316
    // NEW — command slot (toolkit -> agent), own seqlock, own region:
    // LONG      cmdSeqCounter;     // offset 320
    // float     cmdTransform[3][4];// offset 324
    // uint32_t  cmdFlags;          // offset 372  bit0=apply-pending, bit1=stop-requested
};
#pragma pack(pop)
```

**Seqlock protocol to mirror in reverse** (`channel.cpp:69-89`, `InterlockedIncrement` odd→copy→even):
```cpp
void channelWrite(const LiveState* state) {
    volatile LONG* seq = static_cast<volatile LONG*>(s_view);
    InterlockedIncrement(seq);                 // seq -> odd
    std::memcpy(static_cast<char*>(s_view) + sizeof(LONG), &state->transform,
                sizeof(LiveState) - sizeof(LONG));
    InterlockedIncrement(seq);                 // seq -> even
}
```
For the command slot, the AGENT is the reader and the HOST is the writer — same protocol, opposite roles. Add a `channelReadCommand(LiveState* out)` function in `channel.cpp` that retry-reads the `cmdSeqCounter` region exactly the way `useChannelReader.ts`'s `parseChannelView` (renderer-side) already retry-reads the existing read frame (see below) — do not invent a new retry algorithm.

Also keep the existing `static_assert(sizeof(LiveState) == 320, ...)` block (`channel.cpp:24-34`) and add matching asserts for the new offsets (320/324/372) — this is the layout-regression-catch pattern already established here.

---

### `packages/live-inject/agent/write.h` / `write.cpp` (NEW — service, event-driven)

**Analog:** `packages/live-inject/agent/sentinels.h` (pure, Win32-free, testable-standalone gate pattern)

**Sentinel signature style to mirror** (`sentinels.h:18-52`):
```cpp
struct SentinelResult { bool passed; const char* failReason; };
SentinelResult checkTransform(const float* mat3x4);
bool allSentinelsPassed(const SentinelResult results[4]);
```

**Read-verify guard for the write path (RESEARCH.md Pattern 1, agent-side, pure byte-compare — mirror this file's testability discipline: no live Win32 calls in the compare itself):**
```cpp
// Pseudocode from RESEARCH.md — mirrors the 4-sentinel gate but compares
// against the COW snapshot rather than sanity bounds.
float liveBytes[3][4];
memcpy(liveBytes, swg::endpoints::getTransform_o2w(player), TRANSFORM_BYTE_SIZE);
if (memcmp(liveBytes, cowSnapshotBytes, TRANSFORM_BYTE_SIZE) != 0) {
    // FAIL CLOSED — do not call the setter.
} else {
    swg::endpoints::setTransform_o2w(player, t);  // internally fires setObjectToWorldDirty
}
```
D-01/Pitfall-1 correction: call `setTransform_o2w` ONLY — it internally calls `setObjectToWorldDirty(true)` (verified `Object.cpp:1450-1471,1250-1272`). Do not budget a separate call.

---

### `packages/live-inject/agent/agent_main.cpp` (controller, event-driven) — EXTEND

**Analog:** itself (existing poll loop, `agent_main.cpp:132-222`)

**Current loop shape to extend** (add: read command slot, run write.cpp guard, call setter, raise to 60fps, add stop-signal check):
```cpp
// agent_main.cpp:135-220 (existing read-only loop)
while (true) {
    void* player = swg::endpoints::getPlayer ? swg::endpoints::getPlayer() : nullptr;
    if (!player) { Sleep(100); continue; }
    // ... existing 4-sentinel read-verify + channelWrite(&state) ...
    Sleep(33);  // Phase 5: raise to ~16ms (60fps) AND add a stop-signal check here
}
```
Add the stop-signal check (D-04.1) as a new condition inside the loop (checked each iteration, mirrors how `cmdFlags` bit1 = "stop requested" was proposed in the channel.h extension above) — this closes the Phase-3-deferred "clean agent stop-signal" debt in the same loop that already exists, not a new thread.

**Calling-convention note preserved from the file header (`agent_main.cpp:35-39`):** member fns are `__thiscall` (ECX auto), free fns `__cdecl` — the new `setTransform_o2w`/`setScale` fn-pointer typedefs must follow this exactly, same as `pGetTransform_o2w` already does.

---

### `packages/live-inject/agent/rva_table.cpp` (config, request-response) — EXTEND

**Analog:** itself (existing `g_agentBindings[]` table, `rva_table.cpp:98-106`)

**Pattern to replicate for the new write endpoints (D-01 setTransform_o2w write variant + D-09 setScale):**
```cpp
// Existing pattern (rva_table.cpp:49-51, 98-105):
pGetTransform_o2w getTransform_o2w = (pGetTransform_o2w)0x00B22C80;
Binding g_agentBindings[] = {
    {"object::getTransform_o2w",      (void**)&getTransform_o2w},
    // ... existing rows ...
};
```
Add: a `setTransform_o2w` fn-pointer slot seeded with the legacy RVA `0x00B22CC0` (Utinni `object.cpp:148`) and bound to advertised name `"object::setTransform_o2w"` (verified present, `engine_advertise.cpp:578/850`); a `setScale` fn-pointer slot seeded with legacy RVA `0x00B23A10` (Utinni `object.cpp:155`) and bound to advertised name `"object::setScale"` — per D-09 this is a **new row the maintainer's advertised client build must also add** (`engine_advertise.cpp:456` catalog), flagged as a plan task, not just a toolkit-side change. Follow the exact `Binding{name, (void**)&slot}` shape already used for every other row.

---

### `packages/live-inject/src/channel_binding.cpp` (controller, streaming) — EXTEND

**Analog:** itself (`OpenChannel`/`CloseChannel`/`ReadChannelView`, full file already read — `channel_binding.cpp:83-179`)

**GC-guard pattern to reuse verbatim for the new `writeCommand()` export** (`channel_binding.cpp:45-72`, `Napi::Reference` refcount=1 + finalizer-owns-view-lifetime — RESEARCH.md's Security Domain explicitly calls out reusing this, not inventing a second lifetime scheme):
```cpp
struct ChannelState {
    HANDLE hMap = nullptr;
    Napi::Reference<Napi::ArrayBuffer> abRef;  // GC guard
};
static void cleanupChannel(const std::string& name) {
    auto it = s_channels.find(name);
    if (it == s_channels.end()) return;
    it->second.abRef.Reset();             // allow GC -> finalizer releases view
    if (it->second.hMap) { CloseHandle(it->second.hMap); it->second.hMap = nullptr; }
    s_channels.erase(it);
}
```
`writeCommand(mappingName, transformBytes)` writes into the SAME 320→376-byte mapping (channel_binding.cpp:36 `CHANNEL_BYTE_SIZE` const must grow to 376) — CHANNEL_BYTE_SIZE is a single source of truth to update, per the file's own header comment about a single named mapping ("Scheme A").

---

### `packages/renderer/src/hooks/useCommandWriter.ts` (NEW hook, streaming/rAF)

**Analog:** `packages/renderer/src/hooks/useChannelReader.ts` (full file read — rAF poll loop + seqlock parse, `useChannelReader.ts:88-110`)

**rAF loop shape to mirror (write direction, same seqlock discipline, same "attached"-only gating):**
```typescript
// useChannelReader.ts:88-110 pattern — reverse direction for the command slot
export function useChannelReader(): void {
  const status = useLiveStore((s) => s.status);
  const rafRef = useRef<number>(0);
  useEffect(() => {
    if (status.kind !== 'attached') return;
    const mappingName = status.mappingName;
    function poll() {
      const buf = addon.readChannelView(mappingName);
      if (buf) { /* parse + updateState */ }
      rafRef.current = requestAnimationFrame(poll);
    }
    rafRef.current = requestAnimationFrame(poll);
    return () => cancelAnimationFrame(rafRef.current);
  }, [status.kind === 'attached' ? status.mappingName : null]);
}
```
Key deviation D-02 requires: the write side does NOT poll every frame reading — it writes ONLY on gizmo-drag/numbox-edit events (latest-wins single slot), so `useCommandWriter` exposes an imperative `writeTransform(mappingName, xf)` function called from `TransformGizmo`'s drag handler, not a `useEffect` RAF loop. Zero-allocation constraint (LIVE-03 SC1): reuse one pre-allocated `Float32Array`/`ArrayBuffer` across calls — never allocate inside the drag handler, mirroring `useChannelReader.ts:52-56`'s comment about avoiding cross-frame aliasing (there via `buf.slice`; here the constraint is the opposite — reuse the same buffer, never slice/copy per-frame).

---

### `packages/renderer/src/state/liveStore.ts` (store, CRUD) — EXTEND

**Analog:** itself (full file read — `liveStore.ts:1-96`)

**Existing store shape to extend with COW snapshot / write-log / guard state:**
```typescript
// liveStore.ts:31-59 (existing interface + actions)
export interface LiveStore {
  status: ConnectionStatus;
  mode: InjectionMode;
  disabledReason: string | null;
  verifiedState: VerifiedObjectState | null;
  regionBytes: Uint8Array | null;
  // NEW for Phase 5:
  // cowSnapshot: Float32Array | null;       // attach-time transform (D-03)
  // writeLog: WriteLogEntry[];               // session write log (B2)
  // guardState: 'ok' | 'blocked';            // read-verify guard (B2)
  beginAttach: (clientExe: string) => void;
  attachComplete: (pid: number, mappingName: string) => void;
  // ... existing actions unchanged ...
}
export const useLiveStore = create<LiveStore>((set) => ({
  status: { kind: 'idle' }, mode: 'file-patch', /* ...existing... */
}));
```
Follow the exact `set({...})` per-action style already used (each action is a small pure updater, e.g. `attachComplete`/`detach` at `liveStore.ts:73-95`) — do not introduce a different state-management idiom for the new fields.

---

### `packages/renderer/src/panels/viewport/TransformGizmo.tsx` / `LiveSyncClientCard.tsx` / `GizmoModeRail.tsx` / `TransformReadoutBar.tsx` (NEW components)

**Analog:** `packages/renderer/src/panels/viewport/Viewport.tsx` (full file read — Canvas host, imperative `useFrame` stats collector, absolutely-positioned overlay pattern)

**Imperative-update-without-React-state pattern to mirror for the HUD/readout (LIVE-03 SC1 zero-alloc constraint — `Viewport.tsx:50-71` `StatsCollector`):**
```typescript
// Viewport.tsx:50-71 — useFrame throttled callback, NOT React state per frame
function StatsCollector({ onStats }: { onStats: (stats: FrameStats) => void }): null {
  const { gl } = useThree();
  const lastFrame = useRef<number>(0);
  useFrame(() => {
    const now = performance.now();
    if (now - lastFrame.current < 200) return; // update throttle
    lastFrame.current = now;
    onStats({ /* ... */ });
  });
  return null;
}
```
`TransformReadoutBar`'s numbox refs must be updated via direct DOM (`ref.current.textContent = ...`) during drag, exactly analogous to how `StatsCollector` throttles/pushes without triggering a full React re-render tree — UI-SPEC's "imperative refs/direct DOM, never per-frame React state churn" contract.

**Overlay-over-canvas pattern to mirror** (`Viewport.tsx:103-128`, `MissingDepsOverlay`):
```typescript
export function MissingDepsOverlay(): React.ReactElement | null {
  const { resolution } = useViewportStore();
  const missing = resolution?.missing ?? [];
  if (missing.length === 0) return null;
  return (
    <div style={{ position: 'absolute', bottom: 32, left: 8, /* translucent chip style */ }}>
      ⚠ {missing.length} missing dep{missing.length > 1 ? 's' : ''}
    </div>
  );
}
```
`LiveSyncClientCard` (top-right 224px) and `GizmoModeRail` (left-edge) are siblings of this pattern — absolutely-positioned DOM rendered alongside (not inside) the `<Canvas>`, reading Zustand store state (`useLiveStore`) the same way `MissingDepsOverlay` reads `useViewportStore`.

**Gizmo base:** drei `TransformControls` (already a dependency, `@react-three/drei@10.7.7` per `packages/renderer/package.json`) restyled per UI-SPEC axis hexes — UI-SPEC Flagged Assumption 1 explicitly permits this; no from-scratch gizmo math needed.

---

### `packages/renderer/src/shell/StatusBar.tsx` (component, request-response) — EXTEND

**Analog:** itself (full file read — existing live-mode segment, `StatusBar.tsx:338-344`)

**Existing segment to extend with sync/guard/COW mirrors:**
```typescript
// StatusBar.tsx:74-75 (existing store read) + :338-344 (existing render)
const liveMode = useLiveStore((s) => s.mode);
// ...
<Dot />
<span>
  <span style={{ color: liveMode === 'live' ? 'var(--color-accent)' : 'var(--color-text-muted)' }}>
    {liveMode === 'live' ? '● Live' : '○ File-patch'}
  </span>
</span>
```
Add `guard:` and `COW snapshot` segments immediately adjacent using the same `<Dot />` separator helper (`StatusBar.tsx:422-424`) and the same "read store value → map to glyph+color+text" idiom used throughout this file (e.g. the `staleDeployment` badge at `StatusBar.tsx:372-386`).

---

### `packages/native-core/modules/core/formats/DataTable.h` / `.cpp` (NEW — DTII parser, file-I/O)

**Analog:** `packages/native-core/modules/core/formats/Effect.h` (full file read — IFF-tree-based, engine-free, port-source-cited header doc pattern)

**Header doc-comment structure to mirror exactly** (`Effect.h:1-53`):
```cpp
/**
 * modules/core/formats/DataTable.h — Engine-free C++20 FORM DTII (.iff) datatable parser.
 *
 * PORT SOURCE:
 *   swg-client-v2 sharedUtility/src/shared/DataTable.cpp:400-476 (_readCell, load/load_0000/load_0001)
 *   swg-client-v2 sharedUtility/src/shared/DataTableWriter.cpp:650-664,723-748,821-912 (_saveTableToIff, physical write, Comment-stripping)
 *   swg-client-v2 sharedUtility/src/shared/DataTableColumnType.cpp:84-232,382-473 (type-spec dispatch, mangleValue)
 *
 * STRUCTURE (verified):
 *   FORM DTII
 *     FORM 0001 (TAG_0000 legacy also supported on read)
 *       CHUNK COLS   <- int32 numCols, then numCols column-name strings
 *       CHUNK TYPE   <- numCols type-spec strings (e.g. "i", "s[required]", "e(a=0,b=1)[a]")
 *       CHUNK ROWS   <- int32 numRows, then numRows*numCols cells (physical type = getBasicType())
 */
#pragma once
#include "iff/Iff.h"
#include "Mesh.h"  // FormatParseError
namespace swg_core { namespace formats {
struct DataTableResult { /* columns, types, rows — only 3 physical CellType members */ };
DataTableResult parseDataTable(const swg_core::iff::IffNode& root, const uint8_t* srcData, uint32_t srcSize);
std::vector<uint8_t> serializeDataTable(const DataTableResult& table);  // NEW — DTII needs write-back (Palette pattern)
}}
```
Physical-decoder scope per D-12/Pitfall-2: only 3 `CellType` members exist on the wire (`CT_string`/`CT_int`/`CT_float` — `DataTableCell.h:28-32`); the other 7 `DataType` enum values are UI/type-spec layers over Int or String — do not build 10 physical decoders. `DT_Comment` never appears on disk (stripped at compile) — do not build a decoder branch for it (verified `DataTableWriter.cpp:821-856,898-901`).

**Why Effect.h is the analog and Mesh.h is not:** both DTII and EFCT walk an `IffNode` tree with FORM/CHUNK children and select/collect typed sub-structures (EFCT: IMPL→PASS→PPSH→PTXM; DTII: COLS/TYPE/ROWS siblings) — Mesh.h's shape (geometry attribute slices crossing as raw ArrayBuffer) doesn't apply; DTII's payload is small typed cells that cross as plain JS values, same as Effect's `impls`/`blend`/`samplers` do.

---

### `packages/native-core/modules/core/formats/StringTable.h` / `.cpp` (NEW — `.stf` parser+serializer, file-I/O)

**Analog:** `packages/native-core/modules/core/formats/Palette.h` (full file read — PARSER-NATIVE raw-bytes format, NOT an IFF tree, has a `serializeX` sibling)

**Header doc-comment + API-shape pattern to mirror exactly** (`Palette.h:1-72`):
```cpp
/**
 * modules/core/formats/StringTable.h — Engine-free C++20 .stf localized-string-table parser.
 *
 * PORT SOURCE:
 *   swg-client-v2 localization/src/shared/LocalizedStringTable.cpp:72,77,227-308,368-405 (magic/version, load_0001)
 *   swg-client-v2 localization/src/shared/LocalizedString.cpp:20-95,178-329 (per-string id/sourceCrc/buflen/text)
 *   swg-client-v2 localization/src/shared/LocalizedStringTableReaderWriter.cpp:107-203 (write — BOTH sections, the serializer oracle)
 *
 * NOTE: This is a PARSER-NATIVE format (not IFF) — magic is 0xABCD (4-byte int, NOT ASCII "STF ").
 *   Two independently-ordered sections: id-ascending string table (id,sourceCrc,buflen,UTF-16LE text)
 *   then name-ascending key->id map (id,buflen,ASCII name). MUST round-trip both orderings
 *   independently of UI display order (Pitfall 4 / D-11).
 */
#pragma once
#include "Mesh.h"  // FormatParseError
namespace swg_core { namespace formats {
struct StfEntry { uint32_t id; uint32_t sourceCrc; std::u16string text; };
struct StfResult { uint32_t nextUniqueId; std::vector<StfEntry> byId; std::vector<std::pair<std::string,uint32_t>> nameToId; };
StfResult parseStf(const uint8_t* data, uint32_t size);
std::vector<uint8_t> serializeStf(const StfResult& table);  // MUST preserve sourceCrc verbatim (D-10)
}}
```
**Serialize-sibling pattern to mirror exactly** (`Palette.h:63-69`, `Palette.cpp:105-149` — `serializePalette` re-emits canonical bytes from the parsed struct for round-trip testing):
```cpp
// Palette.cpp:105+ — the shape every StringTable.cpp::serializeStf should follow:
std::vector<uint8_t> serializePalette(const PaletteResult& palette) { /* re-emit header + entries */ }
```
D-10 constraint: `serializeStf` must NOT recompute `sourceCrc` from the row's own text — preserve verbatim unless an explicit "re-sync to source" action requests recompute (a distinct, opt-in code path, not the default save path).

---

### `packages/native-core/src/dtii_binding.cpp` / `stf_binding.cpp` (NEW N-API bindings)

**Analog:** `packages/native-core/src/mesh_binding.cpp` — specifically `ParseEffect` (IFF-tree binding, lines 886-960) for DTII, and `ParsePalette`/`ParseDds` (raw-bytes + `roundTripBytes` serialize-back, lines 392-499) for STF.

**Two-tier catch + extractBytes/extractRootNode helper pattern to reuse verbatim** (`mesh_binding.cpp:46-124`, `152-178`):
```cpp
static std::pair<const uint8_t*, size_t> extractBytes(const Napi::Value& val, Napi::Env env, const char* argName) { /* ... */ }
static swg_core::iff::IffNode extractRootNode(const Napi::Object& iffResult, const uint8_t* srcData, uint32_t srcSize) { /* ... */ }

Napi::Value ParseDataTable(const Napi::CallbackInfo& info) {
    // mirrors ParseEffect (mesh_binding.cpp:886-912): extractBytes, extractRootNode, try/catch
    // FormatParseError -> Napi::Error "parseX error: ..."; std::exception -> "parseX internal error: ..."
}
```
For STF's write-back binding, mirror `ParsePalette`'s round-trip-bytes tail (`mesh_binding.cpp:433-439`):
```cpp
auto serialized = swg_core::formats::serializeStf(stfResult);
auto ab = Napi::ArrayBuffer::New(env, serialized.size());
if (!serialized.empty()) std::memcpy(ab.Data(), serialized.data(), serialized.size());
result.Set("roundTripBytes", ab);
```
Register both new bindings in `packages/native-core/src/addon.cpp` alongside the existing `mesh_binding.cpp`/`iff_binding.cpp` exports (file not yet read this session — locate the existing `Napi::Export`-style registration block there and append, do not restructure it).

---

### `packages/harness/fixtureRegistry.ts` (EXTEND) + `dtii-roundtrip.test.ts` / `stf-roundtrip.test.ts` (NEW)

**Analog:** itself (full file read, `fixtureRegistry.ts:1-131`) for the registry; `packages/harness/assertRoundTrip.ts` (full file read) for the test body.

**`registerFormat` call shape to follow exactly** (`fixtureRegistry.ts:78-90`):
```typescript
registerFormat('dtii', {
  parse: (bytes) => parseDataTableWasmOrNative(bytes),
  serialize: (parsed) => serializeDataTableWasmOrNative(parsed),
  fixtures: [{ name: 'synthetic-all-types', bytes: fixtureBytes, loaderSource: 'swg-client-v2 DataTableWriter.cpp:650-664' }],
  loaderSource: 'swg-client-v2 DataTable.cpp:400-476',
});
```
`loaderSource` MUST match `/swg-client-v2|Utinni|tre_reader\.py/` (`fixtureRegistry.ts:107` `CITATION_RE`) or the `assertSweep()` CI gate fails — every fixture needs a real citation, not a doc reference.

**Round-trip assertion to reuse verbatim** (`assertRoundTrip.ts:28-55`, already generic over `parse`/`serialize`):
```typescript
export function assertRoundTrip(parse, serialize, fixtureBytes: Uint8Array): void {
  const parsed = parse(fixtureBytes);
  const actual = serialize(parsed);
  // length check, then byte-for-byte scan, throws with hex-window diagnostic on mismatch
}
```
Per Pitfall 4's warning sign: the `.stf` test MUST diff raw bytes via this exact function (not a re-parsed logical-model comparison) — `assertRoundTrip` already does this correctly; do not write a custom "same rows, same text" comparator instead.

D-09 synthetic-fixture convention (referenced in RESEARCH's Validation Architecture, Wave-0 gaps): synthesize fixture bytes from byte recipes in the test file itself, never hand-copy an external golden — mirror whatever existing `*-roundtrip.test.ts` (e.g. `mesh-roundtrip.test.ts`) does for its synthetic fixtures.

---

### `packages/renderer/src/panels/editors/DatatableGridEditor.tsx` / `StfStringsEditor.tsx` (NEW; retires/upgrades `DatatablePanel.tsx`)

**Analog (virtualization):** `packages/renderer/src/panels/tre/VfsTree.tsx` (full file read — `ROW_HEIGHT`/`OVERSCAN`/`ResizeObserver` pattern, lines 43-46, 74-118)

**Virtualization scaffold to reuse verbatim** (`VfsTree.tsx:43-118`):
```typescript
const ROW_HEIGHT = 30;   // DTII: cell padding 5px 10px per UI-SPEC; STF: 6px 10px — adjust per sketch
const OVERSCAN = 8;
// ResizeObserver -> viewHeight state; onScroll -> scrollTop state;
// firstVisible/visibleCount/startRow/endRow/topPad/bottomPad derived math — copy exactly
// top-pad spacer + windowed rows + bottom-pad spacer, inside a totalHeight-tall inner div
```
This is the SAME scaffold `StagingPanelBody.tsx` also reuses (`StagingPanelBody.tsx:54-60`, explicit comment "must match VfsTree, HexInspector") — three consumers of one virtualization idiom in this repo already; DTII/STF grids are the fourth and fifth.

**Analog (hex view / byte-highlight target):** `packages/renderer/src/panels/iff/HexInspector.tsx` (full file read — sticky ruler, selected-range highlight, hover cross-highlight, `BYTES_PER_ROW=16`/`ROW_HEIGHT=18`). The DTII editor's `Hex | Grid` toggle target reuses this component directly (pass the DATA chunk bytes + a `selectedRange` computed from the edited cell's byte offset) — do not build a second hex renderer.

**Row-selection / staged-badge pattern to mirror:** `VfsTree.tsx`'s `VfsRow` component (`VfsTree.tsx:257-443`) shows the "isSelected → accent bg + inset border" + "isStaged → ✓ staged badge" + "hover-only action button" idioms (lines 312-320, 386-410, 414-440) that the grid's modified-cell / staged-row states should follow structurally (triple-encoding border+tint+glyph is the UI-SPEC's own contract, but the *component wiring* — per-row Zustand selector, hover state, conditional badge render — is this file's idiom).

---

### `packages/renderer/src/panels/editors/shared/GateBar.tsx` / `GateChip.tsx` / `FailBanner.tsx` (NEW shared components)

**Analog:** `packages/renderer/src/shared/VerificationStatus.tsx` (full file read — the ONLY existing shared glyph+color+caption status-pill component in this repo, already used for round-trip pass/fail elsewhere)

**Triple-encoded variant-pill pattern to reuse/extend directly (this is the exact same state machine the Gate needs — not-run/running/pass/fail is a superset of pass/fail/warn/neutral already modeled here):**
```typescript
// VerificationStatus.tsx:22-49 — extend VARIANT_CONFIG with 'running' (dashed border, info text)
// for GateChip, or import/wrap VerificationStatus directly for the pass/fail states and add
// a 'running' variant alongside 'pass'/'fail'/'warn'/'neutral'.
export type VerificationVariant = 'pass' | 'fail' | 'warn' | 'parse-error' | 'neutral';
const VARIANT_CONFIG: Record<VerificationVariant, { glyph: string; colorVar: string; ariaRole?: string }> = {
  'pass': { glyph: '✓', colorVar: 'var(--color-accent)' },
  'fail': { glyph: '✕', colorVar: 'var(--color-danger)' },
  // ...
};
```
Strongly prefer **extending `VerificationStatus.tsx` with a `'running'` variant** (dashed border needs a wrapper `<span>` style, not just color) over building `GateChip` from scratch — the glyph+color+caption+`role`/`aria-label` contract is identical to UI-SPEC's Gate Bar requirements (`✓ byte-exact round-trip (<N> B)` / `✗ round-trip mismatch — not staged`). `GateBar` (the footer container) and `FailBanner` (the danger-tint expanded diagnostic) are new layout wrappers around this existing pill.

---

### `packages/renderer/src/panels/editors/SchemaRail.tsx` (NEW)

**Analog:** `packages/renderer/src/panels/tre/ShadowChainDetail.tsx` (collapsible kv-row detail panel rendered outside a virtualized list — referenced/imported by `VfsTree.tsx:27,237` as the "selected entry detail" pane)

The rail's three collapsible sections (`Schema · COLS/TYPE`, `Selected row`, `Round-trip gate`) follow the same "fixed detail panel outside the scrolling list, populated from the current selection" structure `VfsTree.tsx` already uses for its `ShadowChainDetail`/encrypted-notice panel (`VfsTree.tsx:212-240`).

---

### Staging integration (`＋ Stage` / `→ staged in working changes`)

**Analog:** `packages/renderer/src/state/stagingStore.ts` (full file read) + `packages/renderer/src/panels/deploy/StagingPanelBody.tsx` (first 150 lines read)

**Entry upsert pattern to reuse exactly** (`stagingStore.ts:72-82`):
```typescript
addEntry: (e: StagingEntry) => {
  if (!isVirtualPathSafe(e.virtualPath)) return;   // M1 path-safety gate — reuse, don't re-derive
  set((state) => ({
    entries: [...state.entries.filter((x) => x.virtualPath !== e.virtualPath), e],
  }));
},
```
The editors' `＋ Stage` / post-gate-pass auto-stage action should call `useStagingStore.getState().addEntry(...)` with a `StagingEntry` (`packages/contracts/src/staging.ts:34-...` — `virtualPath`, `action`, `replacementFilePath`, `sha256`) built from the just-serialized (gate-passed) bytes, the same shape `StagingPanelBody`'s `computeSha256`/`getFileSizeBytes` helpers (`StagingPanelBody.tsx:97-119`) already produce for file-based staging.

---

## Shared Patterns

### Seqlock read/retry protocol (LIVE-03 command slot)
**Source:** `packages/live-inject/agent/channel.cpp:69-89` (write side, agent→host direction) + `packages/renderer/src/hooks/useChannelReader.ts:44-76` (`parseChannelView`, read side, host-JS direction)
**Apply to:** `write.cpp` (agent-side command-slot reader), `channel_binding.cpp` (host-side command-slot writer), `useCommandWriter.ts` (renderer-side command-slot writer)
```typescript
// useChannelReader.ts:48-73 — the retry-read shape every new reader must mirror:
const seq1 = view.getUint32(SEQ_OFFSET, true);
if ((seq1 & 1) !== 0) return null;           // odd = writer mid-write
/* read payload */
const seq2 = view.getUint32(SEQ_OFFSET, true);
if (seq1 !== seq2) return null;              // torn read
```

### FormatParseError + two-tier catch (DTII/STF native parse)
**Source:** `packages/native-core/src/mesh_binding.cpp:167-178` (repeated identically for every `ParseX` function in the file)
**Apply to:** `ParseDataTable`, `ParseStf` binding functions
```cpp
try {
    root = extractRootNode(info[0].As<Napi::Object>(), srcData, static_cast<uint32_t>(srcSize));
    result = swg_core::formats::parseX(root, srcData, static_cast<uint32_t>(srcSize));
} catch (const swg_core::formats::FormatParseError& e) {
    Napi::Error::New(env, std::string("parseX error: ") + e.what()).ThrowAsJavaScriptException();
    return env.Undefined();
} catch (const std::exception& e) {
    Napi::Error::New(env, std::string("parseX internal error: ") + e.what()).ThrowAsJavaScriptException();
    return env.Undefined();
}
```

### Virtualized list scaffold (DTII/STF grids)
**Source:** `packages/renderer/src/panels/tre/VfsTree.tsx:43-118` (ROW_HEIGHT/OVERSCAN + ResizeObserver + scrollTop windowing math) — already reused 3x in this repo (`VfsTree`, `HexInspector`, `StagingPanelBody`)
**Apply to:** `DatatableGridEditor.tsx`, `StfStringsEditor.tsx`
Copy the constant names, the `useEffect`+`ResizeObserver` block, and the `startRow`/`endRow`/`topPad`/`bottomPad` derivation verbatim — only `ROW_HEIGHT` value and row-renderer component differ per surface.

### Triple-encoded state pill (gate states, live/offline, modified cells)
**Source:** `packages/renderer/src/shared/VerificationStatus.tsx` (full file, glyph+color+caption+optional `role="alert"`)
**Apply to:** `GateChip`, live/offline chip in `LiveSyncClientCard`, modified-cell markers in both grid editors
Extend `VerificationVariant`/`VARIANT_CONFIG` rather than hand-rolling a new pill component — this is the ONE existing implementation of the Accessibility Rule 1 "state never color alone" contract in the codebase.

### CRC32 (`.stf` `sourceCrc`, translation-staleness)
**Source:** `packages/renderer/src/services/crc32.ts` (full file read — table-based port, forward poly `0x04C11DB7`, init/final `0xFFFFFFFF`, verified against `swg-client-v2 Crc.cpp`) + native `packages/native-core/modules/core/tre/Crc.cpp` (not read this session, cited as the C++ oracle by the TS file's own header comment)
**Apply to:** the native `StringTable.cpp` CRC computation (native side must port the same table/algorithm, not re-derive it) and the renderer's "mark re-synced to source" action (D-10) if it needs a JS-side recompute preview before save
```typescript
// crc32.ts:53-61 — reuse this exact algorithm; do not write a second CRC implementation
export function crc32(input: string): number {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < input.length; i++) {
    const byte = input.charCodeAt(i) & 0xFF;
    const idx = ((crc >>> 24) ^ byte) & 0xFF;
    crc = (CRC_TABLE[idx]! ^ ((crc << 8) >>> 0)) >>> 0;
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}
```
Note: `.stf`'s `sourceCrc` is a CRC of *text content* (UTF-16LE string), not a *path* like this function's existing caller (`tocReader.ts`) — the polynomial/table is identical, but the input-byte convention differs (UTF-16LE code units vs Latin-1 path chars); do not assume the exact `crc32(input: string)` call signature transfers unchanged, port the algorithm not the call site.

### Advertised-name + legacy-RVA dual resolution (D-09 setScale)
**Source:** `packages/live-inject/agent/rva_table.cpp:1-108` (full file read) + `packages/live-inject/agent/resolve.h` (full file read, `Binding`/`lookupByName`/`resolve`/`resolveFromExe`)
**Apply to:** any new engine endpoint the write path needs (`setTransform_o2w` write variant, `setScale`)
```cpp
// resolve.h:32-52 — the ONE resolution mechanism; do not add a second lookup scheme
struct Binding { const char* name; void** slot; };
int resolve(const EngineHookPoints* table, const Binding* bindings, size_t count);
```
A missing name on the advertised table NEVER nulls the slot (graceful degrade) — legacy RVA literal remains active untouched (`resolve.h:47`). This is the exact mechanism Pitfall 5 in RESEARCH.md says must NOT be re-derived.

## No Analog Found

None. Every file in CONTEXT.md's `code_context`/`canonical_refs` and RESEARCH.md's "Recommended Project Structure" has at least a role-and-data-flow match already living in this repo (see table above). The closest thing to a gap is `GateBar`/`FailBanner` as *container* components (no existing gate-bar footer or fail-banner layout exists yet) — but their content primitive (`VerificationStatus.tsx`) and their consumer wiring (staging, round-trip test results) both have exact analogs, so this is a compose-from-existing-parts task, not a from-scratch design.

## Metadata

**Analog search scope:** `packages/contracts/src`, `packages/live-inject/{agent,src}`, `packages/native-core/{modules/core/formats,src}`, `packages/harness`, `packages/renderer/src/{panels,hooks,state,shell,shared}`.
**Files scanned (read in full or in large targeted excerpts):** `live-inject.ts`, `channel.h`, `channel.cpp`, `agent_main.cpp`, `rva_table.cpp`, `resolve.h`, `sentinels.h`, `channel_binding.cpp`, `useLiveService.ts`, `useChannelReader.ts`, `liveStore.ts`, `Effect.h`, `Palette.h`, `mesh_binding.cpp`, `fixtureRegistry.ts`, `assertRoundTrip.ts`, `VfsTree.tsx`, `HexInspector.tsx`, `Viewport.tsx`, `StatusBar.tsx`, `stagingStore.ts`, `DatatablePanel.tsx`, `crc32.ts`, `StagingPanelBody.tsx` (partial), `VerificationStatus.tsx`.
**Pattern extraction date:** 2026-07-08

---

*Phase: 05-wysiwyg-live-sync-typed-editors*
