# Phase 5: WYSIWYG Live-Sync & Typed Editors - Research

**Researched:** 2026-07-08
**Domain:** Win32 in-process live memory writes (SharedArrayBuffer command channel) + IFF-structured binary format editors (DTII datatables, .stf localized strings)
**Confidence:** MEDIUM-HIGH (live-write apply mechanism and both binary formats are VERIFIED against real `swg-client-v2` source this session; the exact command-slot wire encoding and a few UI-SPEC assumptions are corrected/flagged below)

## Summary

This phase has three independent-but-coupled tracks, all grounded in code that already exists in
this repo and in `../swg-client-v2` / `../Utinni`. Track 1 (LIVE-03) extends the Phase-3 read-only
SAB channel with a **toolkit→agent write direction**: a second seqlock-guarded "command slot" the
agent polls each client frame and applies via the client's own `Object::setTransform_o2w` setter —
never a raw memory poke. Ground-truth tracing this session found an important correction to
CONTEXT.md's D-01: **`setObjectToWorldDirty` does not need to be called separately** — the real
client's `setTransform_o2w` → `setTransform_o2p` → `positionAndRotationChanged()` call chain
**already calls `setObjectToWorldDirty(true)` internally** and fires the render/collision
notification list. It is also **not advertised** on the advertised-client endpoint table at all, so
there is no way to call it separately even if desired.

> **⚠ CORRECTED 2026-07-08 (maintainer) — SCOPE ERROR IN THIS SECTION.** The original text below
> claimed Scale had "no advertised or legacy-viable write endpoint" and called the legacy RVA
> "useless against the advertised build." That rested on a **wrong scope assumption**: it treated the
> legacy SWGEmu build as fenced out. **SWGEmu is IN scope** — both SWGEmu (legacy known-RVA) and
> swg-client-v2 (advertised) are explicit Phase-5 targets; the only Phase-3 fence is
> AOB/unknown-build/x64. Corrected write paths for `object::setScale`: **(1) legacy SWGEmu** — known
> RVA `0x00B23A10` (`Utinni/.../object.cpp:155`), Utinni-proven, harvest per the Phase-3 idiom;
> **(2) advertised swg-client-v2** — via `GetEngineHookPoints()`; `setScale` is not in the catalog
> dump this session read, but the maintainer's client is intended to advertise the full Utinni
> surface, so this is a **one-row hookpoint addition**, not a missing capability. **Scale IS in scope
> and writes live on both targets.** See CONTEXT.md D-09 (corrected). Pitfall 1 and Open Question 1
> below are superseded by D-09.

~~A second, more consequential finding: **there is no advertised or legacy-viable write endpoint for
object *scale*** — `object::setScale` is absent from `engine_advertise.cpp`'s catalog entirely (only
a legacy Utinni RVA exists, `0x00B23A10`, useless against the advertised build). This is a real scope
gap in the Scale gizmo mode that the planner must explicitly address (see Pitfall 1 and Open
Questions).~~ *(struck — see correction above)*

Tracks 2 and 3 (DATA-01/DATA-02) are grounded directly in the client's own `DataTable`/
`DataTableColumnType`/`DataTableWriter` and `LocalizedStringTable`/`LocalizedStringTableRW` source.
Both formats turned out simpler at the **wire level** than CONTEXT.md's D-07 discussion implies, and
the `.stf` format is **structurally different** from what the approved UI-SPEC (018-A) assumes — this
is exactly the kind of AI-distilled-docs vs. ground-truth gap the project's de-anchoring protocol
exists to catch, and it is flagged prominently below (Pitfall 3, Pitfall 4). DTII's 10 `DataType`
enum values collapse to only **3 physical wire encodings** (int32, float32, length-prefixed ASCII
string) — the other 7 are UI/validation-only semantic subtypes layered over an int or string column,
which actually makes D-07's "full 10-type inline edit" comfortably buildable as one typed-editor
layer over 3 physical decoders, not 10 physical decoders. `.stf` is NOT a single flat
`key|crc32|text` table on disk — it is **two separately-ordered sections** (an id-ascending string
table with a `sourceCrc` used for translation-staleness, and a name-ascending key→id map) that a
byte-exact round-trip must reproduce independently, and the on-disk magic is a 4-byte integer
`0xABCD`, not an ASCII `"STF "` tag.

**Primary recommendation:** Build the command-slot write path as a straightforward extension of the
existing seqlock channel (same shared mapping, mirrored protocol, agent-side poll-and-apply loop
calling `setTransform_o2w` for Move/Rotate and `setScale` for Scale — see D-09 correction; Scale is
IN scope on both the advertised (add the `GetEngineHookPoints` row) and legacy SWGEmu (RVA
`0x00B23A10`) targets), and build DTII/STF native parse+serialize as two new files in
`packages/native-core/modules/core/formats/` registered with the existing `packages/harness`
CORE-05 fixture registry — reusing the already-verified `Crc.cpp`/`crc32.ts` port for `.stf`'s CRC
fields. Route both UI-SPEC corrections (offline-gizmo copy already flagged as D-05; add the two new
ones found here) back through the plan as errata, the same way D-05/D-07 were handled.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Gizmo drag → transform capture | Renderer (R3F `TransformGizmo`) | — | Pure client-side 3D interaction; drei `TransformControls` already in deps |
| Command-slot write (toolkit→agent) | Native agent (x86 in-process DLL) | Host N-API addon (binding + SAB) | Only the injected agent can call in-process client setters; host just relays the target transform into the shared mapping |
| `setTransform_o2w` invocation | Native agent (x86 in-process) | — | Must run in the client's own address space/thread context per Phase-3 architecture |
| Read-verify guard (pre-write) | Native agent (poll loop, 4-sentinel-style compare) | Renderer (surfaces guard state) | Byte compare must happen agent-side, immediately before the write, to avoid TOCTOU across the IPC hop |
| COW snapshot store | Renderer (`liveStore`/new snapshot store) | — | Snapshot is toolkit bookkeeping, not client state; survives agent restarts within a session |
| Write-log / revert UI | Renderer | — | Pure UI state driven off write events |
| DTII/STF binary parse+serialize | Native core (C++, `native-core/modules/core/formats/`) | — | D-06 locked: byte-exact round-trip gate runs in native, mirrors Mesh/Animation/Effect precedent |
| DTII/STF byte-exact round-trip gate | `packages/harness` (CORE-05 fixture registry) | — | Standing gate; every format registers here |
| DTII grid editor / STF strings editor UI | Renderer (React, dockview tab) | — | Pure presentation + edit-buffer + gate invocation |
| Type-spec interpretation (enum/bitvector/hashstring parsing for UI widgets) | Renderer or native-core (planner's call) | — | Logic is data-driven string parsing (`DataTableColumnType.cpp` algorithm), can live in TS since it never touches raw bytes directly — only the `getBasicType()`-keyed 3-way physical read/write must be native |
| Cross-table enum resolution (`z(...)` type) | Renderer/backend (needs VFS lookup) | Native (if the source table must be parsed) | Requires resolving and reading a *sibling* DataTable by path — a VFS-mount-aware operation, not a pure byte-buffer operation |

## User Constraints (from CONTEXT.md)

<user_constraints>

### Locked Decisions

- **D-01: Apply via the client setter, not a raw memory poke.** The agent calls the advertised /
  known-RVA `object::setTransform_o2w` (+ `setObjectToWorldDirty`), exactly how the game itself
  moves objects — so render + collision notifications fire and there is no half-updated object.
  Ground-truth verified: the advertised client advertises `object::setTransform_o2w`
  (`engine_advertise.cpp:578` / `:850`); Utinni carries the legacy RVA (`setTransform_o2w = 0x00B22CC0`,
  `object.cpp:148`). Matches the Phase-3 architecture (harvest Utinni idioms, call in-process from the
  x86 agent DLL). **Do NOT use WriteProcessMemory / direct poke of the 48-byte float[3][4].**
  > **RESEARCH CORRECTION (this session):** see Pitfall 1 — do not budget a separate
  > `setObjectToWorldDirty` call; it is neither advertised nor necessary (already fires internally).
- **D-02: Toolkit→agent command channel = latest-wins single slot.** A single seqlock-guarded command
  slot in the SAB (mirror of the existing read frame) holds the newest target transform; the agent
  applies whatever is current each client frame. Intermediate drag values are intentionally dropped
  (a live drag wants the final pose, not every micro-step). **Zero allocation in the 60fps path +
  control ping** (LIVE-03 SC1) — no queue, no ring buffer. HUD numbox/delta text updates during drag
  are imperative (refs/direct DOM), never per-frame React state churn (UI-SPEC Surface 1 interaction
  contract).
- **D-03: COW snapshot = attach-time transform, captured per object (once).** On first edit of an
  object (or at attach), capture that object's transform bytes once. **Per-write `revert`** undoes a
  single write-log entry in the client; **`Revert ALL to snapshot`** restores the attach-time
  transform. The **read-verify guard** (Phase 3 D-05 4-sentinel gate + B2) compares live client bytes
  to this snapshot *before* each write and **fails closed** — write refused, real addr + expected/got
  bytes named, **no force-write affordance exists** (its absence is contract, UI-SPEC Surface 1 B2).
  Reconstruct-by-replaying-the-log was rejected in favor of this single attach-baseline model (matches
  the sketch copy "COW snapshot taken at attach").
- **D-04: The three Phase-3 Phase-5-deferred items are must-haves here**, because a repeated
  attach → edit → detach session IS the WYSIWYG workflow:
  1. **Clean agent stop-signal** — unload/clean the poll thread on stop (Phase 3 accumulates one poll
     thread per attach; must not leak across the edit loop).
  2. **Detach/disconnect UI control** — wire a control that calls the existing `detachUI()` export
     (Phase 3 landed the teardown logic but noted "no such button exists yet").
  3. **Legacy networkId 64-bit read** — implement the deferred legacy-path 64-bit `getNetworkId`
     return (Phase 3 returned 0 on legacy; Phase-5 x86 64-bit return convention).
- **D-05: Offline gizmo = disabled-with-reason, NOT staged.** When the client is not injected, the
  gizmo/HUD still render but the gizmo is **non-interactive**, with a clear
  `○ Offline — attach a client to move objects live` reason. LIVE-05 ("editor fully usable offline")
  is satisfied by the **two typed editors working fully offline** — they have real file targets; a
  live object's only file home is a `.ws` placement, which is not editable until Phase 7 (FMT-02).
  **No fake staging for the gizmo.**
  ⚠ **UI-SPEC ERRATUM REQUIRED:** the UI-SPEC live-sync state table shows an offline gizmo write
  target of `→ staged (patch)` (Surface 1 items 2/5/8, state-encoding table). That indicator remains
  correct for the **editors** (which stage to working changes) but is **wrong for the gizmo** under
  D-05 — the plan must update the UI-SPEC gizmo offline copy to the disabled-with-reason state and
  NOT ship a `→ staged (patch)` gizmo write target. Revisit when `.ws` lands in Phase 7.
- **D-06: Native C++ (native-core) parse + serialize for both formats.** Build DTII and STF
  parse/serialize in C++ alongside iff/tre/mesh; run the byte-exact round-trip gate in native
  (CORE-05 precedent); cross the bridge as typed arrays. Reuse the native IFF reader/writer and
  harvest the client's own serializers as the ground-truth oracle: `DataTableWriter` (DTII) and
  `LocalizedStringTableReaderWriter` (STF — read AND write).
- **D-07: Full inline edit for all 10 DTII column types.** SWG DTII has 10 types
  (`DT_Int/Float/String/HashString/Enum/Bool/BitVector/Comment/PackedObjVars/Unknown`), not just the
  sketch's `s/i/f`. Design inline editors for **every** type (Enum dropdowns, Bool checkbox,
  BitVector, PackedObjVars, etc.).
  ⚠ **UI-SPEC EXTENSION FLAG (from CONTEXT):** 014-D specs the grid + `s/i/f` type badges only. This
  decision extends beyond the sketch — the planner must design editors for
  Enum/Bool/BitVector/PackedObjVars/Comment within the 014-D idiom.
  > **RESEARCH REFINEMENT (this session, see Pitfall 2 / Pitfall 3):** `DT_Comment` never appears in
  > a compiled `.iff` DTII at all (stripped at spreadsheet-compile time) — the editor will never
  > actually encounter it and does not need a comment-cell editor. The remaining 9 types reduce to
  > exactly 3 physical wire decoders (int32 / float32 / string); "full 10-type edit" is a **type-spec
  > string interpretation + widget** problem, not a 10-way binary decoder problem — meaningfully
  > lower physical-parsing risk than D-07's framing implies. `DT_Enum`'s `z(tablename)` variant
  > requires resolving and reading a **second, named DataTable** from the VFS to populate its
  > dropdown — flag this as extra scope (Open Question 2).

### Claude's Discretion

- **Wave sequencing** — the maintainer chose "let planner sequence." Order the waves from the
  dependency graph. Note: the shared `GateBar` / `GateChip` / `FailBanner` (ONE implementation across
  014/018 — UI-SPEC Component Inventory) is built once and consumed by both editors, so a natural
  spine is DTII (reference consumer) → STF (sibling reuse); the live-write track (highest unknown:
  new SAB write direction + 60fps zero-alloc + live guard) is independent and can run in parallel.
  Planner picks the actual first slice.
- **DatatablePanel placeholder disposition** — the UI-SPEC Docking row already locks that typed
  editors open as **main-editor-group tabs** (~940–1080px; 018-C 440px-Inspect form rejected). The
  existing bottom-pane `DatatablePanel.tsx` placeholder (008-S8 trio) is therefore retire-or-repurpose
  = planner's call.
- **Gizmo library base** — drei/three `TransformControls` (already a dependency, `@react-three/drei
  10.7.7`) restyled to the sketch's axis hexes + letter labels is permitted.
- **Rot/Scale write-log units & write encoding** — degrees for rot, unitless factor for scale
  (UI-SPEC Flagged Assumption 4); exact rotation/scale channel encoding for D-02's command slot is
  planner's to derive from the `setTransform_o2w` Transform layout (the 48-byte float[3][4] already
  carries full rotation+translation; scale handling flag in plan).
  > **RESEARCH FINDING:** scale is NOT part of `Transform` at all — see Pitfall 1. This directly
  > informs the planner's derivation: rotation lives in the 3x3 sub-block of the same 48-byte
  > payload already used for position; scale is a wholly separate `Object::setScale(Vector)` call
  > that has no advertised endpoint.
- **Elevation/UAC for the write path** — reuse the Phase-3 attach posture; if `setTransform_o2w`
  needs more than the read path, planner surfaces it (Phase 3 D-08 graceful-degrade UX is the fixed
  contract).

### Deferred Ideas (OUT OF SCOPE)

- **World-snapshot (`.ws`) placement editing** — Phase 7 (FMT-02). Becomes the real offline gizmo
  file target; revisit the UI-SPEC `→ staged (patch)` gizmo copy then (D-05).
- **`⇄ Compare to base` diff surface** — sketch 015 is not yet designed. In Phase 5 the button shows
  a disabled/tooltip state or a minimal byte-diff; do not drop it from the crumb bar.
- **018-B per-key sibling-locale readout** — the approved `.stf` growth direction if cross-locale
  pain shows in real use; not built now.
- **Numbox drag-scrub** (Blender-style) — optional polish, not the contract.
- **AOB/signature scanning, unknown-build attach, x64 client** — out of this milestone (Phase 3
  GROUNDTRUTH fence).

</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| LIVE-03 | User can drag a viewport gizmo and see the object move in the running client in real time (zero restart) | Verified `setTransform_o2w` apply mechanism (Pitfall 1 correction), command-slot channel extension design (Architecture Pattern 1), scale-write gap flagged (Open Question 1) |
| DATA-01 | User can view and edit DTII datatables in a virtualized grid and save them back | Verified DTII wire format (3 physical types, comment stripped, `DataTableColumnType` parsing algorithm) — Pitfall 2/3, Code Examples, Standard Stack |
| DATA-02 | User can view and edit `.stf` localized strings and save them back | Verified `.stf` wire format (magic, two-section layout, sourceCrc semantics) — Pitfall 4, Code Examples |

</phase_requirements>

## Project Constraints (from CLAUDE.md / AGENTS.md)

- Every binary format layout claim in this document that could not be checked against `../swg-client-v2`
  source in this session is tagged `[ASSUMED]`; everything else cites an exact `file:line`.
- No parser/serializer plan may rely on `docs/` alone; `docs/02-formats/datatables-and-strings.md`
  is AI-proposed and must be corrected against the citations in this document before merge (standing
  project gate, CLAUDE.md "#1 project constraint").
- Live-injection code stays Windows-only, gated behind explicit attach; no auto-escalation of
  privileges (reuse Phase-3 D-08 graceful-degrade).
- Match existing code style; minimize diff scope — DTII/STF native modules should mirror the
  `packages/native-core/modules/core/formats/{Mesh,Animation,Effect}.{h,cpp}` pattern exactly, not
  invent a new module layout.
- Binary payloads cross the N-API bridge zero-copy as typed arrays, never JSON (architecture.md).
- Sketches are the UI contract — every element in 05-UI-SPEC.md's Surface Contracts is a plan
  `must_have`; this document's two new corrections (Pitfall 3 crumb-bar note, Pitfall 4 STF layout)
  must be routed back as additional errata alongside the CONTEXT-flagged D-05/D-07 ones.

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@react-three/drei` | 10.7.7 [VERIFIED: packages/renderer/package.json] | `TransformControls` gizmo base | Already a project dependency; UI-SPEC Flagged Assumption 1 permits restyling it rather than a from-scratch gizmo |
| `three` | 0.184.0 [VERIFIED: packages/renderer/package.json] | R3F scene / gizmo math | Already the project's 3D engine |
| `node-addon-api` | ^8.8.0 [ASSUMED — carried from Phase 0/1 pin, not re-verified this session] | C++ ⇄ JS bridge for the new command-slot binding + DTII/STF native modules | Existing ABI-stable N-API pattern (`channel_binding.cpp`, `iff_binding.cpp`) |
| `dockview-react` | 6.6.1 [VERIFIED: packages/renderer/package.json] | Main-editor-group tabs for DTII/STF editors | Existing docking system; UI-SPEC locks typed editors as main-group tabs |

No new external packages are required for this phase — it is 95% new architecture (write channel,
two new native format modules) built on top of already-vetted, already-installed dependencies.

### Package Legitimacy Audit

**Not applicable — no new external packages are introduced by this phase.** All libraries used
(`@react-three/drei`, `three`, `node-addon-api`, `dockview-react`) are pre-existing, already-vetted
project dependencies confirmed present in `packages/renderer/package.json`. The Package Legitimacy
Gate protocol (slopcheck / registry verification) is skipped as genuinely not applicable, not as a
degraded/`[ASSUMED]` fallback.

## Architecture Patterns

### System Architecture Diagram

```
 Renderer (React)                    Host N-API addon (x64)          Agent DLL (x86, in-process)
┌──────────────────────┐            ┌─────────────────────┐         ┌───────────────────────────┐
│ TransformGizmo (R3F)  │            │                     │         │                           │
│  drag → target xform  │            │                     │         │                           │
│         │              │           │                     │         │                           │
│         ▼              │  writeCommand(mappingName, xf)  │         │                           │
│ LiveSyncClientCard /   │──────────▶│ CommandSlot seqlock │────────▶│ agent poll loop (60fps):  │
│ TransformReadoutBar    │   IPC     │ write into SAME      │  SAB   │  1. read command slot      │
│  (imperative refs,     │           │ shared mapping used  │ (file- │     (seqlock retry-read)   │
│   no per-frame state)  │           │ for the read frame   │ mapping│  2. read-verify guard:     │
│                        │           │ (extends              │  view) │     live bytes == COW      │
│         ▲              │           │ LIVE_CHANNEL_LAYOUT) │        │     snapshot? else REFUSE  │
│         │ read frame   │◀──────────│                      │◀───────│  3. IF pass: call          │
│ (existing, unchanged)  │  readChannelView()               │         │     object::setTransform_o2w│
│                        │           │                      │         │     (fires notifyList +   │
│ COW snapshot store     │           │                      │         │      setObjectToWorldDirty  │
│ (attach-time capture)  │           │                      │         │      INTERNALLY — no       │
│ Write-log / revert UI  │           │                      │         │      separate call needed) │
└──────────────────────┘            └─────────────────────┘         │  4. write verified state   │
                                                                       │     back to READ frame     │
                                                                       │     (existing channelWrite) │
                                                                       └───────────────────────────┘

 Native core (C++)                                    packages/harness (CORE-05 gate)
┌───────────────────────────────┐                     ┌─────────────────────────────┐
│ modules/core/formats/         │  registerFormat()   │ fixtureRegistry.ts           │
│  DataTable.{h,cpp}  (DTII)    │────────────────────▶│  parse/serialize/fixtures    │
│  StringTable.{h,cpp} (.stf)   │                      │  loaderSource citation       │
│  reuse Iff.{h,cpp} reader/    │                      │  assertSweep() CI gate       │
│  writer + Crc.cpp (.stf CRC)  │                      └─────────────────────────────┘
└───────────────────────────────┘
        │ typed-array bridge (zero-copy)
        ▼
 Renderer: DatatableGridEditor / StfStringsEditor (dockview main-group tabs)
```

### Recommended Project Structure

```
packages/live-inject/
├── agent/
│   ├── channel.h / channel.cpp     # EXTEND: add commandSlot read + seqlock-retry read helper
│   ├── agent_main.cpp              # EXTEND: poll loop calls read-verify-guard + setTransform_o2w;
│   │                                #         add stop-signal check (D-04.1)
│   └── write.cpp / write.h         # NEW: read-verify guard + setTransform_o2w invocation, isolated
│                                    #      from channel plumbing for testability
├── src/
│   └── channel_binding.cpp         # EXTEND: writeCommand(mappingName, transformBytes) export
packages/contracts/src/
└── live-inject.ts                  # EXTEND: LIVE_CHANNEL_LAYOUT gains a COMMAND_SLOT region (do
                                     #         not invent a parallel/second mapping — same SAB)
packages/native-core/modules/core/formats/
├── DataTable.h / DataTable.cpp     # NEW: DTII parse+serialize (mirror Mesh.{h,cpp} pattern)
└── StringTable.h / StringTable.cpp # NEW: .stf parse+serialize (mirror Effect.{h,cpp} pattern)
packages/harness/
└── fixtureRegistry.ts              # EXTEND: registerFormat('dtii', ...), registerFormat('stf', ...)
packages/renderer/src/panels/
├── DatatablePanel.tsx              # RETIRE or upgrade → DatatableGridEditor (planner's call)
├── viewport/TransformGizmo.tsx     # NEW
├── viewport/LiveSyncClientCard.tsx # NEW
└── editors/StfStringsEditor.tsx    # NEW
```

### Pattern 1: Command-slot write channel (extends the existing seqlock, does not replace it)

**What:** A second region inside the *same* named file-mapping the agent already opens
(`Local\SwgToolkitLive_<uuid>`), holding the latest target transform. Host writes it (seqlock-guarded,
same increment-write-increment protocol as `channelWrite` in `channel.cpp`); agent's existing poll
loop reads it once per iteration (retry-read on odd/changed seq, same pattern the host uses today to
read the existing 320-byte frame).

**When to use:** Any toolkit→agent directive that needs to reach the client at frame rate with zero
allocation. This phase only needs one command (target transform), but the slot should be shaped as a
small tagged struct so a future command (e.g. detach signal, per Pitfall on D-04.1) can share the
same region without a new mapping.

**Example (extend `channel.h`, mirrors the existing struct exactly):**
```cpp
// Source: packages/live-inject/agent/channel.h (existing LiveState, this session's extension)
#pragma pack(push, 4)
struct LiveState {
    LONG      seqCounter;        // offset   0  (existing read frame)
    float     transform[3][4];   // offset   4
    uint64_t  networkId;         // offset  52
    char      templateName[256]; // offset  60
    uint32_t  liveness;          // offset 316
    // --- NEW: command slot (toolkit -> agent), own seqlock, own region ---
    LONG      cmdSeqCounter;     // offset 320  new
    float     cmdTransform[3][4];// offset 324  target transform (same 48-byte layout)
    uint32_t  cmdFlags;          // offset 372  bit0 = "apply pending", bit1 = "stop requested" (D-04.1)
};
#pragma pack(pop)
// TOTAL_SIZE grows from 320 -> 376; update LIVE_CHANNEL_LAYOUT in contracts/live-inject.ts to match,
// do NOT create a second CreateFileMappingA region.
```

**Read-verify guard (agent-side, immediately before calling the setter):**
```cpp
// Pseudocode — mirrors the existing 4-sentinel gate discipline (sentinels.h) but compares
// against the COW snapshot rather than sanity bounds.
float liveBytes[3][4];
memcpy(liveBytes, swg::endpoints::getTransform_o2w(player), TRANSFORM_BYTE_SIZE);
if (memcmp(liveBytes, cowSnapshotBytes, TRANSFORM_BYTE_SIZE) != 0) {
    // FAIL CLOSED — do not call the setter. Report addr + expected/got bytes upstream
    // via the existing read frame (extend `liveness` or add a guard-status field).
} else {
    Transform t; /* construct from cmdTransform */
    swg::endpoints::setTransform_o2w(player, t);  // internally fires setObjectToWorldDirty + notifications
}
```

### Pattern 2: DTII column-type interpretation (type-spec string → basic wire type + UI widget)

**What:** `DataTableColumnType`'s first-character dispatch (`i`/`f`/`s`/`c`/`h`/`p`/`b`/`e(...)`/
`v(...)`/`z(...)`) maps every column to exactly one of 3 physical encodings (`getBasicType()` ∈
{Int, Float, String}) plus a richer semantic `getType()` used only to choose the UI widget and
validate/convert user input. Port this dispatch logic (not the physical read/write) as a small,
independently testable module — it never touches raw file bytes, only the type-spec string.

**Example (verified 1:1 against source):**
```cpp
// Source: swg-client-v2/src/engine/shared/library/sharedUtility/src/shared/DataTableColumnType.cpp:99-229
// type == 'i' -> basicType = Int          (plain int32 column)
// type == 'f' -> basicType = Float        (plain float32 column)
// type == 's' -> basicType = String       (plain length-prefixed ASCII column)
// type == 'c' -> basicType = Comment      (NEVER present in a compiled .iff — see Pitfall 2)
// type == 'h' -> basicType = Int,  type = HashString   (UI shows text, wire stores Crc::normalizeAndCalculate(text))
// type == 'b' -> basicType = Int,  type = Bool         (UI shows checkbox, wire stores 0/1)
// type == 'e(a=0,b=1,...)' -> basicType = Int, type = Enum      (UI shows dropdown of labels, wire stores looked-up int)
// type == 'v(a=1,b=2,...)' -> basicType = Int, type = BitVector (UI shows multi-select, wire stores OR'd (1<<(bit-1)) int)
// type == 'p' -> basicType = String, type = PackedObjVars       (UI shows structured name|type|value editor, wire stores the pipe-delimited string verbatim)
// type == 'z(tableName)' -> basicType = Int, type = Enum sourced from ANOTHER DataTable (see Open Question 2)
```

### Pattern 3: `.stf` two-section layout (must round-trip BOTH sections independently)

**What:** A compiled `.stf` is not one flat table. It is a header, then an **id-ascending** string
section (each entry: id, sourceCrc, UTF-16 length, UTF-16 text), then a **name-ascending** key→id
map (each entry: id, ASCII-length, ASCII name). A byte-exact round-trip must reproduce both
sections' independent sort orders (`std::map<id_type,...>` and `std::map<std::string,id_type>`
respectively) — NOT whatever order the UI grid displays rows in.

**Example (verified against source, see Code Examples for full annotated layout):**
```cpp
// Source: swg-client-v2/src/external/ours/library/localization/src/shared/
//         LocalizedStringTable.cpp:368-405 (header) + :227-308 (load_0001, string section)
//         LocalizedStringTableReaderWriter.cpp:145-203 (write — BOTH sections)
// magic (long, 4 bytes) == 0xABCD   -- NOT ascii "STF "
// version (char, 1 byte) == 1       -- FILE_VERSION constant, LocalizedStringTable.cpp:72
// next_unique_id (unsigned long, 4 bytes)
// num_entries (unsigned long, 4 bytes)
// num_entries * { id(4B), sourceCrc(4B), buflen(4B), buflen*2 bytes UTF-16LE text }   -- id order
// num_entries * { id(4B), buflen(4B), buflen bytes ASCII name }                       -- name order
```

### Anti-Patterns to Avoid

- **Building a 10-way physical cell decoder for DTII.** Only 3 physical decoders exist
  (`DataTableCell::CellType` = `CT_string`/`CT_int`/`CT_float` — `DataTableCell.h:28-32`). Route the
  other 7 semantic types through the type-spec interpreter (Pattern 2), not through 10 parallel byte
  layouts.
- **Recomputing `.stf`'s "crc32" column as a naive hash of the row's own text on save.** The on-disk
  field is `sourceCrc` — the CRC of the *source-language* text used to produce a *translation*, not a
  self-hash (see Pitfall 4). Blindly overwriting it with `crc32(thisText)` silently breaks the
  engine's translation-staleness detection for every non-default-locale file.
- **Treating the command slot as a second `CreateFileMappingA` call.** It must live in the *same*
  named mapping the agent already opens in `agent_init` — a second mapping would require a second
  `OpenFileMappingA` call and name-passing scheme the agent does not currently have wired.
- **Calling `setObjectToWorldDirty` as a distinct agent-side step.** It is not advertised and is not
  needed — see Pitfall 1.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| CRC32 for `.stf` `sourceCrc`/key ordering checks | A new CRC implementation | `packages/native-core/modules/core/tre/Crc.cpp` / `packages/renderer/src/services/crc32.ts` | Already verified against `swg-client-v2/sharedFoundation/src/shared/Crc.cpp` (poly `0x04C11DB7`, init/final `0xFFFFFFFF`) — the exact same table `LocalizedString.cpp`'s `generateCrc()` uses |
| IFF FORM/chunk read/write for DTII | A second IFF parser | Existing `packages/native-core/modules/core/iff/Iff.{h,cpp}` reader/writer (Phase 1 CORE-04/05) | DTII is `FORM DTII > FORM 0001 > {CHUNK COLS, CHUNK TYPE, CHUNK ROWS}` — a normal IFF tree, no bespoke framing |
| Byte-exact round-trip test harness | A new fixture/assertion mechanism | `packages/harness/fixtureRegistry.ts` + `assertRoundTrip.ts` | Standing CORE-05 gate; `registry-coverage.test.ts` already sweeps every registered format |
| Virtualized grid rendering | A new virtualization scheme | Existing `VfsTree`/`HexInspector` `ROW_HEIGHT` + manual `scrollTop` + `OVERSCAN` pattern (Phase 1/2 precedent, confirmed in STATE.md) | Proven at 244k-row scale already in this codebase |
| Seqlock read/retry protocol | A new synchronization primitive | Mirror the existing `channelWrite`/host-reader pattern (`channel.cpp:69-89`) for the new command slot | Already correctly implemented and tested for the read direction; the write direction is the same protocol run in the opposite role |

**Key insight:** almost everything this phase needs already has a proven, working precedent
somewhere in this repo (seqlock channel, IFF reader, CRC, virtualized grid, fixture harness). The
genuinely new work is (a) wiring a second data-flow direction through an existing channel, and (b)
two new native format modules that are simpler at the byte level than they first appear.

## Common Pitfalls

### Pitfall 1: Assuming `setObjectToWorldDirty` must be called separately (and that Scale has a write path)
**What goes wrong:** Budgeting agent work to resolve and call `object::setObjectToWorldDirty` as a
second endpoint after `setTransform_o2w`, and assuming the Scale gizmo mode can write through the
same mechanism.
**Why it happens:** CONTEXT.md's D-01 says the agent calls "`setTransform_o2w` (+
`setObjectToWorldDirty`)" based on the legacy Utinni RVA table, which does expose both as separate
exports (`object.cpp:148,169`). But ground-truth tracing the *implementation* this session
(`Object.cpp:1450-1471` → `Object.h:744-749` (`setTransform_o2p`) → `Object.cpp:1250-1272`
(`positionAndRotationChanged`)) shows `setTransform_o2w` **internally calls
`setObjectToWorldDirty(true)`** and fires the full notification list on every call — no separate
invocation is possible or necessary. Separately, `engine_advertise.cpp`'s catalog (lines 568-583)
does **not** include `object::setScale` at all — only `getTransform_o2w`/`setTransform_o2w`,
`getPosition_w`/`setPosition_w`, `getAppearance`/`setAppearance`, `move_p`, and a handful of others
are advertised. `Object::setScale(const Vector&)` (`Object.h:228`, `Object.cpp:2205`) has **no
advertised endpoint** — only a legacy Utinni RVA (`0x00B23A10`, `object.cpp:155`) that only works
against the (out-of-scope-fenced) legacy SWGEmu build.
**How to avoid:** (1) Drop the separate `setObjectToWorldDirty` call from the write-path task list —
one endpoint (`setTransform_o2w`) is sufficient and correct. (2) Treat the Scale gizmo mode as a
**known gap on the advertised client**: either descope Scale live-writes for Phase 5 (UI shows the
Scale rail button but the write-target indicator reads a disabled/no-endpoint state, similar in
spirit to D-05's offline-disabled pattern) or budget a follow-up ground-truth pass to find/confirm
whether `swg-client-v2`'s advertise table can be extended (this is upstream client code the toolkit
does not control, so this is a real architectural constraint, not just missing research).
**Warning signs:** A plan task that says "resolve `setObjectToWorldDirty` by name" or "wire Scale
gizmo write via `setTransform_o2w`" (scale isn't in that struct at all) should be treated as a red
flag at plan-check time.

### Pitfall 2: Assuming DTII needs 10 distinct physical cell decoders
**What goes wrong:** Building (or budgeting time to build) 10 separate binary read/write code paths
for `DT_Int/Float/String/HashString/Enum/Bool/BitVector/Comment/PackedObjVars/Unknown`.
**Why it happens:** The enum has 10 members and CONTEXT.md's D-07 discussion (correctly) says "all
10 types" need inline editors. But `DataTable::_readCell` (`DataTable.cpp:400-440`) and
`DataTableWriter::_saveRows`/`_getNewCell` (`DataTableWriter.cpp:723-748`, `860-912`) both switch on
`getBasicType()`, which only ever returns `DT_Int`, `DT_Float`, `DT_String`, or `DT_Comment` — and
`DataTableCell`'s own `CellType` enum (`DataTableCell.h:28-32`) physically has only 3 members
(`CT_string`, `CT_int`, `CT_float`). `HashString`/`Enum`/`Bool`/`BitVector` all set
`m_basicType = DT_Int` (`DataTableColumnType.cpp:119-193`); `PackedObjVars` sets
`m_basicType = DT_String` (`:124-127`).
**How to avoid:** Build exactly 3 physical decoders (int32 LE, float32 LE, length-prefixed ASCII
string) keyed by `getBasicType()`, then layer a **type-spec string interpreter** (Pattern 2) on top
that decides which UI widget to render and how to convert the widget's value to/from the underlying
int or string before it ever reaches the physical decoder. This is meaningfully less native-parsing
risk than "10 types" suggests, but requires porting `DataTableColumnType`'s parsing algorithm
(chomp/`getDelimStr`/enum-map building, `DataTableColumnType.cpp:84-232`) faithfully for the
Enum/BitVector/HashString/PackedObjVars widgets to validate/convert correctly.
**Warning signs:** A plan task titled "implement DT_Enum binary reader" (there is no such thing —
Enum's wire encoding is just int32) is a sign the 10-types framing was taken too literally.

### Pitfall 3: `DT_Comment` columns never appear in a compiled `.iff` — and the crumb bar's "DATA" label may not be a literal IFF node
**What goes wrong:** Building a comment-cell inline editor, or expecting a "Comment" type badge to
ever appear when opening a real datatable.
**Why it happens:** `DataTableWriter::_saveColumns`/`_saveTypes` (`DataTableWriter.cpp:821-856`)
explicitly **skip** any column whose `getType() == DT_Comment` when writing the `COLS`/`TYPE`
chunks, and `_saveRows`'s `DT_Comment` case writes zero bytes (`:898-901`). Comment columns exist
only in the authoring-tool's in-memory model (spreadsheet/XML source) and are compiled away before
the file ever reaches disk — the toolkit, which edits compiled `.iff` files, will never see one.
Separately: the UI-SPEC crumb bar copy is `FORM DTII ▸ FORM 0001 ▸ DATA` (05-UI-SPEC.md Surface 2
item 2), but the real IFF tree under `FORM 0001` is three **sibling** chunks — `COLS`, `TYPE`,
`ROWS` — not a single `DATA` leaf (`DataTableWriter.cpp:650-664`). This may be an intentional UI
abstraction (the grid view visually represents "the data" as one concept spanning all three chunks)
rather than a literal claim about the IFF tree — flagged as Open Question 3, not a hard erratum,
since it doesn't necessarily contradict anything actionable.
**How to avoid:** Do not build a Comment-type inline editor or expect to encounter one in real
fixtures. Confirm with the maintainer (or treat as cosmetic) whether the crumb bar's "DATA" segment
is meant to literally reflect an IFF path (in which case it should read
`FORM DTII ▸ FORM 0001 ▸ COLS+TYPE+ROWS` or similar) or is an intentional grid-view abstraction.
**Warning signs:** A round-trip fixture that includes a `DT_Comment` type-spec string in its `TYPE`
chunk was not extracted from a real compiled asset (or the extraction tooling didn't compile it the
normal way) — treat it as suspect.

### Pitfall 4: `.stf` is not a flat `key | crc32 | text` table — UI-SPEC's assumed layout is wrong at the byte level
**What goes wrong:** Serializing edits back to `.stf` as one ordered list of
`{key, crc, text}` rows in whatever order the grid displays them, and recomputing "crc32" as
`crc32(thisRow.text)` on save.
**Why it happens:** The approved UI-SPEC (018-A, formalizing sketch 018) presents `.stf` as a flat
grid with columns `key | crc32 | localized text` and copy `values are UTF-16LE · keys ASCII · CRC32
auto` — a reasonable **display** model but not the real **on-disk** layout. Ground truth
(`LocalizedStringTable.cpp:227-308`, `LocalizedStringTableReaderWriter.cpp:107-203`) shows:
1. **Two independently-ordered sections**, not one table: an id-ascending string section
   (`std::map<id_type, LocalizedString*> m_map`) and a name-ascending key→id map
   (`std::map<std::string, id_type> m_nameMap`). A byte-exact round-trip must re-serialize both
   sections in their *own* map's natural sort order (numeric-ascending by id; lexicographic-ascending
   by ASCII name), independent of whatever order the UI displays rows in (likely alpha-by-key, which
   happens to match the name-map order but NOT the id-map order).
2. The per-string CRC field written to disk is **`m_sourceCrc`** — "the Crc of the string that was
   used to generate the translated text" (`LocalizedString.h:69-70`) — **not** a hash of the key, and
   **not** a fresh hash of the row's own current text. For a base/default-locale file this is
   typically `nullCrc` (`0xFFFFFFFF`); for a translated-locale file it should track the *English
   source's* current CRC so consumers can detect stale translations. Overwriting it with
   `crc32(ownText)` on every save would silently break this staleness-detection mechanism for every
   translated locale file the toolkit touches.
3. The **magic number is `0xABCD`** (a 4-byte `long`, `LocalizedStringTable.cpp:77`), not an ASCII
   `"STF "` tag as the UI-SPEC crumb copy (`string/<locale>/<file>.stf · STF␠ · <N> entries`) implies.
   The 4 bytes on disk are `CD AB 00 00` (little-endian `0x0000ABCD`), not printable text.
**How to avoid:** (1) Model the in-memory representation as the client does — an id-keyed map plus a
name-keyed map, both maintained in sync — and serialize each independently in its own sort order.
(2) Do NOT recompute `sourceCrc` from the row's own text; either preserve it verbatim on
edit-that-doesn't-touch-this-row, or (if the maintainer wants this behavior) explicitly set it to the
*current default-locale text's* CRC — this needs a product decision, not a silent "auto" default (see
Open Question 4). (3) Route this whole finding back to the UI-SPEC as an erratum, the same way D-05
was handled — the crumb bar's `STF␠` display label can stay as a human-readable badge (it's not
wrong to *show* "STF" to the user) but the copy `values are UTF-16LE · keys ASCII · CRC32 auto`
needs a footnote or correction so implementers don't build the naive self-hash.
**Warning signs:** A round-trip test that only checks "same rows, same text" without checking exact
byte-for-byte section ordering and the literal `sourceCrc` values will falsely pass while producing
a *readable but non-identical* file — the CORE-05 gate must diff raw bytes, not a re-parsed logical
model, to catch this class of near-miss.

### Pitfall 5: Cross-arch / in-process constraints already solved by Phase 3 — don't re-derive them
**What goes wrong:** Re-investigating WOW64 cross-arch resolution, calling-convention emulation, or
remote-thread injection mechanics as if they were new problems for the write path.
**Why it happens:** The write path feels like new territory, but it runs inside the *same* already-
injected x86 agent DLL, in the *same* poll loop, using the *same* `__thiscall`/`__cdecl` typedef
conventions already established in `rva_table.cpp`/`resolve.cpp`. There is no new injection, no new
cross-arch resolution — `object::setTransform_o2w`'s slot is filled by the exact same
name-keyed/RVA-literal mechanism already used for `getTransform_o2w`.
**How to avoid:** Add `setTransform_o2w` (and, if pursued, `setScale`) to the existing
`g_agentBindings[]` table in `rva_table.cpp` and the advertised-name catalog lookup — do not
introduce a second resolution mechanism.
**Warning signs:** A plan task re-describing WOW64/CreateRemoteThread mechanics for this phase is
almost certainly scope creep — that machinery is Phase-3-complete and reused as-is.

## Code Examples

### DTII: full verified column-type dispatch table

```
// Source: swg-client-v2/src/engine/shared/library/sharedUtility/src/shared/
//         DataTableColumnType.h:24-38 (enum) + DataTableColumnType.cpp:84-232 (parse dispatch)
//         DataTable.cpp:400-440 (_readCell, physical read) + DataTableWriter.cpp:723-748,860-912 (physical write)

Type-spec char   DataType (semantic)   getBasicType()   Wire encoding                         UI widget (D-07 scope)
--------------   -------------------   --------------   -----------------------------------   ----------------------
'i'              DT_Int                DT_Int           int32 LE                              numeric input
'f'              DT_Float              DT_Float         float32 LE                            numeric input
's'              DT_String             DT_String        length-prefixed ASCII (iff read_string)  text input
'c'              DT_Comment            DT_Comment       NEVER on disk (stripped at compile)   N/A — never appears
'h'              DT_HashString         DT_Int           int32 LE (Crc::normalizeAndCalculate) text input, CRC computed on save
'b'              DT_Bool               DT_Int           int32 LE (0 or 1)                     checkbox
'e(a=0,b=1,...)' DT_Enum               DT_Int           int32 LE (looked-up value)            dropdown of labels
'v(a=1,b=2,...)' DT_BitVector          DT_Int           int32 LE (OR'd 1<<(bit-1) flags)       multi-select checkboxes
'p'              DT_PackedObjVars      DT_String        length-prefixed ASCII                 structured name|type|value editor
'z(tableName)'   DT_Enum (table-sourced) DT_Int         int32 LE (looked-up value)             dropdown; labels loaded from a SIBLING DataTable (Open Question 2)
```

### DTII: IFF tree shape (verified)

```
// Source: DataTableWriter.cpp:650-664 (_saveTableToIff) + DataTable.cpp:444-476 (load)
FORM DTII
  FORM 0001              <- version tag (TAG_0000 legacy also supported on read, DataTable.cpp:449-459)
    CHUNK COLS            <- int32 numCols, then numCols null-terminated-ish IFF strings (column names)
    CHUNK TYPE             <- numCols IFF strings (the type-spec strings, e.g. "i", "s[required]", "e(a=0,b=1)[a]")
    CHUNK ROWS             <- int32 numRows, then numRows*numCols cells in column-major-per-row order,
                              each cell physically encoded per its column's getBasicType()
```

### `.stf`: full verified binary layout

```
// Source: LocalizedStringTable.cpp:368-405 (openLoadFile: magic+version)
//         LocalizedStringTable.cpp:227-308 (load_0001: next_unique_id, num_entries, string section, name section)
//         LocalizedString.cpp:233-279 (load_0001: per-string id/sourceCrc/buflen/text)
//         LocalizedStringTableReaderWriter.cpp:107-141,145-203 (str_write / write — the serializer oracle)

Offset  Size            Field                 Notes
0       4               magic                 long, value 0xABCD (LE bytes: CD AB 00 00) -- NOT ascii "STF "
4       1               version               char, value 1 (FILE_VERSION, LocalizedStringTable.cpp:72)
5       4               next_unique_id        unsigned long (id_type)
9       4               num_entries           unsigned long (id_type) -- count of strings AND count of name entries (same N)
        -- STRING SECTION (num_entries times), iterated in ASCENDING id order (std::map<id_type,...>) --
        4               id                    unsigned long
        4               sourceCrc             unsigned long -- CRC of the SOURCE-language text (see Pitfall 4), NOT self-hash
        4               buflen                unsigned long -- length in UTF-16 code units (char16_t), NOT bytes
        buflen*2        text                  UTF-16LE (char16_t[], no null terminator on disk)
        -- NAME-MAP SECTION (num_entries times), iterated in ASCENDING name order (std::map<std::string,id_type>) --
        4               id                    unsigned long -- which string this name refers to
        4               buflen                unsigned long -- length in ASCII bytes
        buflen          name                  ASCII bytes (no null terminator on disk)
```

## State of the Art

| Old Approach (docs/ AI-proposed assumption) | Current Approach (verified) | When Changed | Impact |
|--------------------|------------------|---------------|--------|
| `.stf` magic = ASCII `"STF "` tag | `.stf` magic = 4-byte integer `0xABCD` | Verified this session against `LocalizedStringTable.cpp:77,388` | Any parser checking for an ASCII tag will reject every real `.stf` file |
| `.stf` = one flat key/crc/text table | `.stf` = two independently-ordered sections (id-map string table + name-ascending key map) | Verified this session | Round-trip must preserve both orderings independently, not the display order |
| DTII "10 types" implies 10 physical wire formats | Only 3 physical wire formats (int32/float32/string); the other 7 are semantic subtypes of Int or String | Verified this session against `DataTableCell.h`/`DataTableColumnType.cpp` | Native parser scope is much smaller than D-07's framing suggests |
| Write path needs `setTransform_o2w` + `setObjectToWorldDirty` (CONTEXT D-01) | `setTransform_o2w` alone is sufficient — it internally calls `setObjectToWorldDirty` and fires notifications | Verified this session against `Object.cpp:1450-1471,1250-1272` | One fewer endpoint to resolve/advertise; also `setObjectToWorldDirty` isn't advertised at all, so this correction is load-bearing, not just simplifying |

**Deprecated/outdated:**
- Any docs/ passage describing `.stf` as ASCII-tagged or single-table should be corrected the next
  time `docs/02-formats/datatables-and-strings.md` is touched (standing project gate).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|----------------|
| A1 | `node-addon-api` pinned at `^8.8.0` still applies unchanged for the new native modules | Standard Stack | Low — this is an existing repo-wide pin from Phase 0/1, not a new dependency choice; only risk is staleness of the version number cited, not the approach |
| A2 | The IFF reader's `read_string`/chunk-string convention already implemented in `packages/native-core/modules/core/iff/Iff.cpp` is compatible with DTII's `COLS`/`TYPE`/`ROWS` string chunks without modification | Don't Hand-Roll, Code Examples | Medium — if the existing IFF string helper doesn't match the client's `insertChunkString`/`read_string` null-termination convention exactly, DTII string columns could round-trip incorrectly; verify against a real extracted DTII fixture before trusting byte-exactness |
| A3 | The exact bit layout the planner should choose for encoding rotation-as-degrees / scale-as-factor in the write-log UI (vs. the raw radians/Vector the engine uses internally) is UI-display-only and doesn't affect the wire encoding | Architecture Patterns / Discretion | Low — this is explicitly flagged as planner's discretion in CONTEXT, this document only adds the scale-has-no-endpoint constraint on top |

**If this table is empty:** N/A — see entries above. All *format byte-layout* claims (DTII, `.stf`,
Transform, LiveState) and the `setTransform_o2w`/`setObjectToWorldDirty`/`setScale` advertise-catalog
findings are `[VERIFIED]` against exact `file:line` citations in `../swg-client-v2` / `../Utinni` /
this repo, not `[ASSUMED]`.

## Open Questions

1. **How should the Scale gizmo mode behave on the advertised client, given `setScale` has no
   advertised endpoint?**
   - What we know: `object::setScale` is absent from `engine_advertise.cpp`'s full catalog; only a
     legacy Utinni RVA (`0x00B23A10`) exists, which only helps against the out-of-scope-fenced legacy
     SWGEmu build.
   - What's unclear: whether the maintainer wants Scale descoped for Phase 5 entirely (UI shows the
     mode but write-target reads a disabled/no-endpoint state, echoing D-05's disabled-with-reason
     pattern), silently no-op with a toast, or whether there's an alternate advertised endpoint this
     session didn't find (e.g. an appearance-level scale setter reachable via `setAppearance`).
   - Recommendation: surface this to the maintainer as a scoped decision before planning locks Scale
     mode's write behavior; in the meantime, plan Scale mode's UI to at minimum not silently pretend
     to work when it can't reach the client.

2. **`z(tableName)` DT_Enum variant needs to load a sibling DataTable — how does that interact with
   the toolkit's VFS/mount model?**
   - What we know: `DataTableColumnType`'s `'z'` branch calls `DataTableManager::getTable(fileName,
     true)` (`DataTableColumnType.cpp:203`) to populate its enum labels from another table's first two
     columns.
   - What's unclear: whether the toolkit needs an equivalent `DataTableManager`-like registry/cache to
     resolve `z(...)` columns' dropdown options (requiring the sibling table to be mounted/resolvable
     in the currently-open project's VFS), or whether Phase 5 can treat `z(...)` as a read-only/opaque
     int column until a later phase.
   - Recommendation: check whether any of the real fixture datatables actually use `'z'` columns before
     over-building this; if rare, treat as a documented editor limitation (numeric-only edit, no
     dropdown) rather than blocking the phase on a full cross-table resolution system.

3. **Is the UI-SPEC crumb bar's `FORM DTII ▸ FORM 0001 ▸ DATA` meant to reflect the literal IFF tree,
   or is "DATA" an intentional abstraction over the three sibling `COLS`/`TYPE`/`ROWS` chunks?**
   - What we know: the real tree has no `DATA` node — `FORM 0001` directly contains three sibling
     chunks.
   - What's unclear: designer intent — is this cosmetic labeling (fine) or an assumption that will
     confuse someone diffing the crumb against the Hex view's real offsets (018-A/014-D's Hex toggle
     shows real chunk offsets)?
   - Recommendation: low-stakes — confirm with a one-line maintainer check or just change the crumb to
     name the real chunks; does not block planning either way.

4. **What should happen to `.stf`'s `sourceCrc` field when the toolkit edits a string?**
   - What we know: on disk it's the CRC of the *source-language* text a translation was generated
     from, not a hash of the edited row itself; the UI-SPEC's "CRC32 auto" copy implies a naive
     self-hash that would corrupt this semantic for every translated-locale file.
   - What's unclear: whether the toolkit is expected to (a) leave `sourceCrc` byte-identical unless
     the maintainer explicitly re-syncs a translation, (b) offer an explicit "mark as re-synced to
     current source" action that recomputes it from the *default-locale* file's current text, or
     (c) only ever edit the base/default-locale file in Phase 5 (in which case `sourceCrc` is always
     `nullCrc` and this is moot for now).
   - Recommendation: this is a real product decision, not a research gap — surface it to the
     maintainer before the planner locks the STF editor's save semantics; in the meantime, the safest
     default is "preserve `sourceCrc` verbatim on every edit unless explicitly told otherwise."

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest (workspace-wide; each package has a local `vitest.config.ts` per Phase-3-Plan-01 convention) |
| Config file | `packages/live-inject/vitest.config.ts`, `packages/harness/vitest.config.ts` (per-package, hoisted vitest) |
| Quick run command | `pnpm --filter @swg/live-inject test` / `pnpm --filter @swg/harness test` (adjust filter names to actual package.json `name` fields) |
| Full suite command | `pnpm -r test` (repo-wide) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| LIVE-03 | Command-slot layout matches contract constants (offsets/sizes) | unit | `vitest run packages/contracts/test/live-inject.test.ts` (extend existing layout sanity test, per Phase-3-Plan-01's "TRANSFORM.length=48 locked by passing test from day 1" precedent) | ❌ Wave 0 — extend existing channel-layout test |
| LIVE-03 | Read-verify guard fails closed on byte mismatch | unit | `vitest run packages/live-inject/test/write-guard.test.ts` (pure, Win32-free — mirror `sentinels.h`'s testability pattern) | ❌ Wave 0 |
| LIVE-03 | 60fps zero-allocation soak / no dangling native pointer under GC pressure | manual/soak | `autonomous:false` human-verify checkpoint against a real injected client (mirrors Phase-3's `03-06b-PLAN.md` in-world UAT pattern) | ❌ Wave 0 — no automated substitute exists for a live GC-pressure soak against a real process |
| DATA-01 | DTII byte-exact round-trip on real extracted asset | unit | `vitest run packages/harness/test/dtii-roundtrip.test.ts` (new, registered via `registerFormat('dtii', ...)`) | ❌ Wave 0 |
| DATA-01 | All 9 real (non-Comment) column types parse+edit+serialize correctly | unit | Extend the same round-trip test with a synthetic fixture exercising Enum/Bool/BitVector/HashString/PackedObjVars columns (mirrors Phase-1's D-09 "synthesize from byte recipes, never copy goldens" convention) | ❌ Wave 0 |
| DATA-02 | `.stf` byte-exact round-trip, BOTH sections' independent sort orders preserved | unit | `vitest run packages/harness/test/stf-roundtrip.test.ts` (new; must assert on raw bytes, not a re-parsed logical model — see Pitfall 4 warning sign) | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** the relevant package's `vitest run` (fast, package-scoped).
- **Per wave merge:** `pnpm -r test` (full suite) + `packages/harness`'s `registry-coverage.test.ts`
  sweep (asserts every registered format has ≥1 fixture with a valid `loaderSource` citation).
- **Phase gate:** full suite green + the live-write soak-test human-verify checkpoint approved before
  `/gsd:verify-work`.

### Wave 0 Gaps

- [ ] `packages/contracts/test/` — extend the existing channel-layout sanity test to cover the new
      command-slot offsets/sizes (mirrors the `TRANSFORM.length=48` locked-test precedent).
- [ ] `packages/live-inject/test/write-guard.test.ts` — pure read-verify-guard unit tests (Win32-free,
      byte-buffer-only, mirroring `sentinels.h`'s testability discipline).
- [ ] `packages/harness/test/dtii-roundtrip.test.ts` + a committed synthetic DTII fixture exercising
      all 9 real column types (per D-09: synthesize from byte recipes, do not hand-copy an external
      golden).
- [ ] `packages/harness/test/stf-roundtrip.test.ts` + a committed synthetic `.stf` fixture with at
      least 3 entries whose id-order and name-order differ (to actually exercise the two-section
      ordering — a fixture where both orders coincidentally match would not catch Pitfall 4's failure
      mode).
- [ ] Real-asset fixtures for both formats extracted from an installed client (`D:/SWG Infinity` or
      `D:/SWGEmu Client/SWGEmu`), per the existing gitignored `fixtures-real/` convention (D-10).

## Security Domain

> `security_enforcement` is absent from `.planning/config.json` (treated as enabled per protocol).
> This is a trusted local desktop tool with no network-facing auth surface — ASVS categories below
> are scoped accordingly; most do not apply.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-------------------|
| V2 Authentication | No | Single-user local desktop tool; no auth surface introduced by this phase |
| V3 Session Management | No | N/A |
| V4 Access Control | No | N/A — Windows process-handle access control (`PROCESS_VM_WRITE` etc.) is already Phase-3's concern and unchanged here |
| V5 Input Validation | Yes | DTII/STF cell edits must be validated per column type-spec (`DataTableColumnType::mangleValue` semantics, `DataTableColumnType.cpp:382-473`) before being coerced to their physical int/float/string encoding — reuse/port this validation, don't hand-roll a looser one |
| V6 Cryptography | Partial | The CRC32 used in `.stf`/TRE is a data-integrity checksum, not a cryptographic hash — do not treat it as tamper-resistant; this is already the existing project posture, unchanged here |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|----------------------|
| Malicious/malformed `.stf`/DTII file causing an out-of-bounds read (attacker-controlled `buflen` fields) | Tampering / DoS | Bounds-check every length-prefixed field against remaining buffer size before allocating/reading (mirrors the existing IFF reader's discipline); this is exactly the kind of file the toolkit itself produces, but a hand-crafted malicious mod file is a realistic threat model for a modding tool that opens third-party assets |
| Command-slot write applied without the read-verify guard (a race or a skipped check) | Tampering | Fail-closed by construction (D-03) — no force-write affordance exists; keep it that way rather than adding an "override" escape hatch later |
| Dangling native pointer on GC of the command-slot ArrayBuffer under memory pressure | Tampering / DoS (process crash) | Reuse the exact GC-guard pattern already proven in `channel_binding.cpp` (`Napi::Reference` refcount + finalizer-owns-view-lifetime) for the new command-slot binding — do not invent a second lifetime-management scheme |

## Sources

### Primary (HIGH confidence — verified this session via direct source read)
- `D:/Code/swg-client-v2/src/engine/shared/library/sharedObject/src/shared/object/Object.cpp:1450-1471,1250-1272,2205-2219` — `setTransform_o2w`/`setTransform_o2p`/`positionAndRotationChanged`/`setScale` implementations
- `D:/Code/swg-client-v2/src/engine/shared/library/sharedObject/src/shared/object/Object.h:227-251,744-749` — `Object` public setter declarations, inline `setTransform_o2p`
- `D:/Code/swg-client-v2/src/game/client/application/SwgClient/src/win32/engine_advertise.cpp:568-598` — full advertised `object::*` catalog (confirms `setScale` absence, `setTransform_o2w`/`setPosition_w` presence)
- `D:/Code/Utinni/UtinniCore/swg/object/object.cpp:85-190` — legacy RVA typedefs/literals (`setTransform_o2w=0x00B22CC0`, `setScale=0x00B23A10`, `setObjectToWorldDirty=0x00B24CE0`)
- `D:/Code/swg-client-v2/src/engine/shared/library/sharedMath/src/shared/Transform.h:52` — `typedef real matrix_t[3][4]` confirming the 48-byte layout and that scale is not part of Transform
- `D:/Code/swg-client-v2/src/engine/shared/library/sharedUtility/src/shared/DataTable.cpp:400-476` — `_readCell`, `load`/`load_0000`/`load_0001`
- `D:/Code/swg-client-v2/src/engine/shared/library/sharedUtility/src/shared/DataTableColumnType.h:24-38,DataTableColumnType.cpp:84-232,382-473` — full 10-type enum + parse dispatch + `mangleValue`
- `D:/Code/swg-client-v2/src/engine/shared/library/sharedUtility/src/shared/DataTableCell.h:28-65` — physical `CellType` enum (only 3 members)
- `D:/Code/swg-client-v2/src/engine/shared/library/sharedUtility/src/shared/DataTableWriter.cpp:650-664,723-748,821-912` — IFF tree shape + physical write dispatch + Comment-stripping
- `D:/Code/swg-client-v2/src/external/ours/library/localization/src/shared/LocalizedStringTable.cpp:72,77,227-308,368-405,496-499` — magic/version constants, `load_0001`, `openLoadFile`
- `D:/Code/swg-client-v2/src/external/ours/library/localization/src/shared/LocalizedString.h:41-42,66-72` + `LocalizedString.cpp:20-95,178-329` — `id_type`/`crc_type` sizes, `sourceCrc` semantics, CRC table (matches project's existing `Crc.cpp`)
- `D:/Code/swg-client-v2/src/external/ours/library/localization/src/shared/LocalizedStringTableReaderWriter.cpp:107-203` — the write-side serializer oracle (both sections)
- `D:/Code/swg-client-v2/src/external/ours/library/unicode/src/shared/Unicode.h:26` — `unicode_char_t = char16_t`
- `D:/Code/SWG-Toolkit/packages/live-inject/agent/{channel.h,channel.cpp,agent_main.cpp,rva_table.cpp}` — existing seqlock/resolve/poll-loop architecture this phase extends
- `D:/Code/SWG-Toolkit/packages/live-inject/src/{channel_binding.cpp,inject_binding.cpp}` — existing host-side bindings, GC-guard pattern, current no-op `Detach()`
- `D:/Code/SWG-Toolkit/packages/contracts/src/live-inject.ts` — current `LIVE_CHANNEL_LAYOUT` (320 bytes) to be extended
- `D:/Code/SWG-Toolkit/packages/harness/fixtureRegistry.ts` — CORE-05 registration mechanism
- `D:/Code/SWG-Toolkit/packages/native-core/modules/core/formats/*` — existing format-module directory convention to mirror
- `D:/Code/SWG-Toolkit/packages/renderer/src/panels/DatatablePanel.tsx` — confirmed placeholder-only
- `D:/Code/SWG-Toolkit/packages/renderer/src/hooks/useLiveService.ts` — existing `detachUI()`/`closeActiveChannel()` (Phase-3 D-04 groundwork already landed)
- `D:/Code/SWG-Toolkit/packages/renderer/src/services/crc32.ts` — existing verified CRC32 port, reusable for `.stf`
- `D:/Code/SWG-Toolkit/packages/renderer/package.json` — confirms `@react-three/drei@10.7.7`, `three@0.184.0`, `dockview-react@6.6.1` already installed

### Secondary (MEDIUM confidence)
- `.planning/phases/05-wysiwyg-live-sync-typed-editors/05-CONTEXT.md` / `05-UI-SPEC.md` / `05-DISCUSSION-LOG.md` — locked decisions and UI contract this research corrects/extends in specific, cited places
- `.planning/STATE.md` — Phase 2/3 accumulated facts (SAB channel, seqlock, cross-arch injection, agent lifecycle debt)

### Tertiary (LOW confidence)
- None — every substantive claim in this document traces to a cited source file above or is explicitly logged in the Assumptions table.

## Metadata

**Confidence breakdown:**
- Live-write apply mechanism: HIGH — verified against actual `Object.cpp` implementation, not just the advertise/RVA tables
- DTII wire format: HIGH — verified against both the reader (`DataTable.cpp`) and writer (`DataTableWriter.cpp`) sides
- `.stf` wire format: HIGH — verified against reader (`LocalizedStringTable.cpp`/`LocalizedString.cpp`) and writer (`LocalizedStringTableReaderWriter.cpp`) sides
- Command-slot exact wire layout (offsets 320-375 proposed above): MEDIUM — the *pattern* (seqlock, same mapping, mirrored protocol) is directly derived from existing verified code, but the exact struct layout is this session's proposal, not yet implemented/tested
- Scale write-path gap: HIGH — confirmed absent from the full advertised catalog via direct grep of `engine_advertise.cpp`
- Security domain: MEDIUM — scoped by reasoning from the existing project posture (no prior security audit of this exact surface exists to cite)

**Research date:** 2026-07-08
**Valid until:** 30 days (stable — this phase's ground truth is pinned to a checked-in reference codebase, not a fast-moving external dependency)
