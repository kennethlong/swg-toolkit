# Phase 05: WYSIWYG Live-Sync & Typed Editors - Context

**Gathered:** 2026-07-07
**Status:** Ready for planning

<domain>
## Phase Boundary

Join the two independently-built halves — the viewport transform gizmo (Phase 2) and the live
injection module (Phase 3) — into the **zero-restart WYSIWYG write loop** over the SharedArrayBuffer
channel, and ship the first two **typed edit surfaces** (DTII datatable grid, `.stf` localized
strings) as the highest-frequency editing entry points.

Delivers **LIVE-03, DATA-01, DATA-02**.

**Phase 3 was READ-VERIFY ONLY** — it deliberately built the agent DLL + SAB channel as the Phase-5
write home (D-01/D-06 of Phase 3). This phase adds the **toolkit→agent write direction** the channel
was designed for, plus the two IFF-structured format editors. All three deliverables are **required
to close the phase** (planner sequences the waves — the tracks are independent enough to parallelize).

**Out of scope (belongs to later phases):**
- World-snapshot (`.ws`) placement editing — Phase 7 (FMT-02). This is why the offline gizmo has no
  real file target in Phase 5 (see D-05).
- Format editors beyond DTII/STF — Phase 7.
- AOB/signature scanning, unknown-build attach, x64 client — fenced out upstream (Phase 3 GROUNDTRUTH).

</domain>

<spec_lock>
## UI Contract (locked via UI-SPEC.md)

**The 05-UI-SPEC is APPROVED (status: approved, 2026-07-07).** It formalizes already-approved
sketches **011-B(+B2)** (viewport gizmo + live-sync HUD → LIVE-03), **014-D** (DTII grid editor →
DATA-01), and **018-A** (`.stf` strings editor → DATA-02), inheriting 009-B's shared
tabstrip/crumb/gate-chip anatomy.

Downstream agents MUST read `05-UI-SPEC.md` before planning or implementing. **Per AGENTS.md
("Sketches are the UI contract") and the gating todo `phase5-plans-must-match-sketches`, every
element enumerated in the UI-SPEC Surface Contracts MUST appear in plan `must_haves` — never a vague
"render the editor".** The visual + interaction contract (HUD anatomy, B2 guard/revert states,
grid/rail/gate-bar, all copy) is settled there and is NOT re-decided here.

**This discussion captured the IMPLEMENTATION decisions the UI-SPEC deliberately leaves open** (how
the write reaches the client, what offline means, where formats parse, phase slicing) — plus **two
deliberate divergences from the UI-SPEC that require errata** (see D-05 and D-08 below).

</spec_lock>

<decisions>
## Implementation Decisions

### Live-write apply path (LIVE-03)

- **D-01: Apply via the client setter, not a raw memory poke.** The agent calls the advertised /
  known-RVA **`object::setTransform_o2w`** (+ `setObjectToWorldDirty`), exactly how the game itself
  moves objects — so render + collision notifications fire and there is no half-updated object.
  Ground-truth verified: the advertised client advertises `object::setTransform_o2w`
  (`engine_advertise.cpp:578` / `:850`); Utinni carries the legacy RVA (`setTransform_o2w = 0x00B22CC0`,
  `object.cpp:148`). Matches the Phase-3 architecture (harvest Utinni idioms, call in-process from the
  x86 agent DLL). **Do NOT use WriteProcessMemory / direct poke of the 48-byte float[3][4].**
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

### Agent lifecycle debt (folded in from Phase 3 — required for the loop)

- **D-04: The three Phase-3 Phase-5-deferred items are must-haves here**, because a repeated
  attach → edit → detach session IS the WYSIWYG workflow:
  1. **Clean agent stop-signal** — unload/clean the poll thread on stop (Phase 3 accumulates one poll
     thread per attach; must not leak across the edit loop).
  2. **Detach/disconnect UI control** — wire a control that calls the existing `detachUI()` export
     (Phase 3 landed the teardown logic but noted "no such button exists yet").
  3. **Legacy networkId 64-bit read** — implement the deferred legacy-path 64-bit `getNetworkId`
     return (Phase 3 returned 0 on legacy; Phase-5 x86 64-bit return convention).

### Offline gizmo semantics (LIVE-05)

- **D-05: Offline gizmo = disabled-with-reason, NOT staged.** When the client is not injected, the
  gizmo/HUD still render but the gizmo is **non-interactive**, with a clear
  `○ Offline — attach a client to move objects live` reason. LIVE-05 ("editor fully usable offline")
  is satisfied by the **two typed editors working fully offline** — they have real file targets; a
  live object's only file home is a `.ws` placement, which is not editable until Phase 7 (FMT-02).
  **No fake staging for the gizmo.** Rejected: (a) pulling `.ws` read/write forward into Phase 5, and
  (b) local-preview-only (move evaporates on reload).
  ⚠ **UI-SPEC ERRATUM REQUIRED:** the UI-SPEC live-sync state table shows an offline gizmo write
  target of `→ staged (patch)` (Surface 1 items 2/5/8, state-encoding table). That indicator remains
  correct for the **editors** (which stage to working changes) but is **wrong for the gizmo** under
  D-05 — the plan must update the UI-SPEC gizmo offline copy to the disabled-with-reason state and
  NOT ship a `→ staged (patch)` gizmo write target. Revisit when `.ws` lands in Phase 7 (018-B-style
  growth direction analog).

### DTII / STF parse boundary & scope (DATA-01, DATA-02)

- **D-06: Native C++ (native-core) parse + serialize for both formats.** Build DTII and STF
  parse/serialize in C++ alongside iff/tre/mesh; run the **byte-exact round-trip gate in native**
  (CORE-05 precedent); cross the bridge as typed arrays. Reuse the native IFF reader/writer and
  **harvest the client's own serializers as the ground-truth oracle**: `DataTableWriter` (DTII) and
  `LocalizedStringTableReaderWriter` (STF — read AND write). Rejected: TS-over-exposed-IFF-tree
  (a second serialization path outside the proven native round-trip harness).
- **D-07: Full inline edit for all 10 DTII column types.** SWG DTII has 10 types
  (`DT_Int/Float/String/HashString/Enum/Bool/BitVector/Comment/PackedObjVars/Unknown`), not just the
  sketch's `s/i/f`. Design inline editors for **every** type (Enum dropdowns, Bool checkbox,
  BitVector, PackedObjVars, etc.). Rejected: "parse-all-edit-primitives" (recommended but declined)
  and "s/i/f-only-refuse-the-rest".
  ⚠ **UI-SPEC EXTENSION FLAG:** 014-D specs the grid + `s/i/f` type badges only. This decision
  extends beyond the sketch — the planner must design editors for Enum/Bool/BitVector/PackedObjVars/
  Comment **within the 014-D idiom** (same grid/cell/modified-triple-encoding anatomy, same
  GateBar/FailBanner), and the type-badge set widens beyond `s/i/f` (keep the letter-carries-type +
  color-reinforcement accessibility rule). This is an in-idiom extension, not a redesign.

### Session addenda — research-driven maintainer decisions (2026-07-08)

Resolved from `05-RESEARCH.md` Open Questions after the ground-truth pass (`af1c1a4`):

- **D-09: Scale gizmo mode IS in scope and writes live on BOTH target builds.** *(Corrected 2026-07-08
  by maintainer — supersedes the initial "disabled-with-reason descope", which rested on a research
  scope error: it wrongly treated the legacy SWGEmu build as fenced out. SWGEmu and swg-client-v2 are
  BOTH explicit in-scope targets — the only Phase-3 fence is AOB/unknown-build/x64, NOT SWGEmu.)*
  Ground-truth write paths for `object::setScale`:
  - **Legacy SWGEmu (in scope):** known RVA `setScale = 0x00B23A10` (`Utinni/UtinniCore/swg/object/object.cpp:155`,
    `pSetScale = void(__thiscall*)(Object*, Vector& scale)`) — harvest per the Phase-3 in-process idiom,
    exactly as Move/Rotate are.
  - **swg-client-v2 advertised (in scope):** written via the advertised `GetEngineHookPoints()` table
    (`engine_advertise.cpp:456`, `s_engineHookPoints[]`). `object::setScale` is not in the current
    catalog dump the research read, but the maintainer's advertised client is intended to advertise the
    full Utinni surface — so this is a **one-row hookpoint addition** (add `object::setScale` alongside
    `setTransform_o2w`), not a missing capability. **Plan task: confirm/add the advertised `setScale`
    hookpoint row, then wire Scale writes on the advertised path.**
  D-01's `setTransform_o2w` remains sufficient for Move+Rotate (ground-truth trace `Object.cpp:1450→744→1250`
  shows it internally calls `setObjectToWorldDirty(true)` and fires the full notification list — a separate
  `setObjectToWorldDirty` call is neither needed nor advertised, correcting D-01's parenthetical). Scale
  writes through `setScale(Vector)` (its own call, separate from the 48-byte transform). Disabled-with-reason
  now applies ONLY to a genuinely-unknown/fenced build lacking the hook — never to the two in-scope targets.

- **D-10: `.stf` `sourceCrc` = preserve verbatim on save + explicit "re-sync to source" action.** Research
  falsified the UI-SPEC's "CRC32 auto on save" assumption: the per-string `sourceCrc` on disk is the CRC
  of the **source-language** text a translation was generated from (a translation-staleness marker), NOT
  a self-hash of the edited row (verified vs `LocalizedString.cpp:generateCrc()` +
  `LocalizedStringTableReaderWriter`). **Default save behavior: preserve `sourceCrc` byte-identical** —
  never recompute it from the edited row's own text (that would corrupt staleness for every
  translated-locale file and, per Pitfall 4, could falsely pass the round-trip gate while breaking
  semantics). **Plus an explicit, opt-in "mark re-synced to source" action** that recomputes `sourceCrc`
  from the default-locale file's current text. The naive auto-CRC-on-save copy is a **UI-SPEC ERRATUM**.

- **D-11 (STF layout erratum): `.stf` is two independently-ordered sections, not a flat `key|crc32|text`
  grid.** Magic is a 4-byte integer `0xABCD` (not ASCII `"STF "`). File = an id-ascending string table
  (each entry: `id(4B), sourceCrc(4B), buflen(4B), buflen*2 bytes UTF-16LE text`) followed by a
  name-ascending key→id map. The editor MUST round-trip BOTH sections independently (Pitfall 4). This is
  a **UI-SPEC ERRATUM** the plan must fold in alongside D-05/D-07.

- **D-12: DTII 10 types collapse to 3 physical wire encodings.** The 10 `DataType` values map to exactly
  3 `DataTableCell::CellType` encodings (int32/float32/string) via `getBasicType()`; the other 7 are
  type-spec-string-driven UI/validation layers over an int or string column. `DT_Comment` never appears
  in a compiled `.iff` (stripped at spreadsheet-compile time) — do not build a physical decoder for it.
  D-07's "editors for all 10 types" stands as a **UI concern**, but the native round-trip decoder needs
  only the 3 physical types. **`z(tableName)` DT_Enum** (loads labels from a sibling DataTable) is treated
  as a **read-only/opaque int column** in Phase 5 unless a real fixture uses it (Open Question 2 safe
  default — no cross-table `DataTableManager` resolution built now). The crumb bar's `DATA` node is a
  cosmetic label — plan may name the real `COLS`/`TYPE`/`ROWS` chunks (Open Question 3, low-stakes).

### Claude's Discretion / Planner decides

- **Wave sequencing** — the maintainer chose "let planner sequence." Order the waves from the
  dependency graph. Note: the shared `GateBar` / `GateChip` / `FailBanner` (ONE implementation across
  014/018 — UI-SPEC Component Inventory) is built once and consumed by both editors, so a natural
  spine is DTII (reference consumer) → STF (sibling reuse); the live-write track (highest unknown:
  new SAB write direction + 60fps zero-alloc + live guard) is independent and can run in parallel.
  Planner picks the actual first slice.
- **DatatablePanel placeholder disposition** — the UI-SPEC Docking row already locks that typed
  editors open as **main-editor-group tabs** (~940–1080px; 018-C 440px-Inspect form rejected). The
  existing bottom-pane `DatatablePanel.tsx` placeholder (008-S8 trio) is therefore **retire-or-
  repurpose = planner's call** (UI-SPEC Flagged Assumption 2).
- **Gizmo library base** — drei/three `TransformControls` (already a dependency) restyled to the
  sketch's axis hexes + letter labels is permitted (UI-SPEC Flagged Assumption 1 + Registry Safety).
- **Rot/Scale write-log units & write encoding** — degrees for rot, unitless factor for scale
  (UI-SPEC Flagged Assumption 4); exact rotation/scale channel encoding for D-02's command slot is
  planner's to derive from the `setTransform_o2w` Transform layout (the 48-byte float[3][4] already
  carries full rotation+translation; scale handling flag in plan).
- **Elevation/UAC for the write path** — reuse the Phase-3 attach posture; if `setTransform_o2w`
  needs more than the read path, planner surfaces it (Phase 3 D-08 graceful-degrade UX is the fixed
  contract).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### UI contract (READ FIRST — locks every surface element)
- `.planning/phases/05-wysiwyg-live-sync-typed-editors/05-UI-SPEC.md` — the approved design contract
  for all three surfaces; every enumerated element is a plan `must_have`. **Note the two errata this
  CONTEXT flags: D-05 (offline gizmo copy) and D-07 (DTII 10-type editor extension).**
- `.planning/todos/pending/phase5-plans-must-match-sketches.md` — the gating rule (UI-SPEC `locked_by`).
- `.planning/sketches/011-viewport-gizmo/`, `014-datatable-grid-editor/`, `018-stf-strings-editor/`,
  `009-iff-tree-hex/` — the governing sketches the UI-SPEC formalizes.

### Live-write ground truth (LIVE-03) — verified in this session
- `D:/Code/swg-client-v2/src/game/client/application/SwgClient/src/win32/engine_advertise.cpp` —
  advertises `object::setTransform_o2w` (`:578` catalog row, `:850` binding) and `object::setPosition_w`
  (`:580`/`:852`). This is the D-01 setter oracle for the advertised client.
- `D:/Code/Utinni/UtinniCore/swg/object/object.cpp` — legacy known-RVA write idioms to harvest:
  `setTransform_o2w = 0x00B22CC0` (`:148`), `setPosition = 0x00B23960` (`:153`),
  `setObjectToWorldDirty = 0x00B24CE0` (`:169`), `move = 0x00B23960` (`:145`); `__thiscall` typedefs
  carry the calling convention (emulate as `__fastcall`, per Phase 3).
- `.planning/phases/03-live-injection-foundation/03-CONTEXT.md` + `03-GROUNDTRUTH-advertised-hooks.md`
  — LOCKED Phase-3 axioms: agent-DLL-in-process architecture (D-01), SAB channel as the write home
  (D-06), the 4-sentinel read-verify gate (D-05), name-keyed vs known-RVA resolution.
- `packages/contracts/src/live-inject.ts` — existing channel contract: `LIVE_CHANNEL_LAYOUT`
  (320-byte read frame, seqlock at 0, `TRANSFORM` = float[3][4]/48B at offset 4), `LiveIpcMessage`
  union, `VerifiedObjectState`. **Extend this for the toolkit→agent command slot (D-02) — do not
  invent a parallel layout.**
- `packages/live-inject/` — host addon (`inject_binding.cpp`, `channel_binding.cpp`,
  `procmem_binding.cpp`) + x86 agent (`agent/agent_main.cpp`, `channel.cpp/.h`, `resolve.cpp`,
  `rva_table.cpp`, `sentinels.cpp`). The write path + stop-signal + detach live here.
- `packages/renderer/src/…` (Phase 3): `liveStore.ts`, `useLiveService`, `useChannelReader` —
  attach state / pid / mode feeding the client card + statusbar (UI-SPEC Component Inventory).

### DTII / STF format ground truth (DATA-01/02) — verified in this session
- `D:/Code/swg-client-v2/src/engine/shared/library/sharedUtility/src/shared/DataTable.cpp` +
  `include/public/sharedUtility/DataTableColumnType.h` — the 10 `DT_*` column types (D-07 scope).
- `D:/Code/swg-client-v2/src/engine/shared/library/sharedUtility/include/public/sharedUtility/DataTableWriter.h`
  — the DTII **serializer oracle** for the byte-exact gate (D-06).
- `D:/Code/swg-client-v2/src/engine/shared/library/…/LocalizedStringTableReaderWriter` (localization
  library) — the `.stf` **read+write oracle** (D-06). ⚠ AI-distilled `docs/` layout must be verified
  against this source before merge (standing gate).
- `docs/02-formats/datatables-and-strings.md` — AI-proposed DTII/STF design; **verify against the
  client source above, update the doc when confirmed** (drop the AI-proposed caveat for verified
  sections).
- `packages/native-core/` — established IFF/TRE/mesh native parse+serialize + the CORE-05 byte-exact
  round-trip harness to reuse for DTII/STF (D-06).
- `packages/renderer/src/panels/DatatablePanel.tsx` — the placeholder to retire/upgrade (planner's call).

### Standing gate
- `.planning/REQUIREMENTS.md` — LIVE-03 / DATA-01 / DATA-02 definitions + the standing byte-exact
  round-trip gate (no parser merges without a cited `swg-client-v2` loader + real-asset round-trip).
- `docs/00-overview/source-provenance.md` — why every `docs/` binary layout is a hypothesis to verify.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **Phase-3 agent DLL + SAB channel** (`packages/live-inject/agent/*`, `channel.cpp/.h`) — the write
  home. Read side is seqlock at 320-byte frame; add the latest-wins command slot (D-02) here.
- **Phase-3 host addon** (`inject_binding.cpp` / `channel_binding.cpp` / `procmem_binding.cpp`) —
  extend with the write/command binding + stop-signal + detach wiring (D-04).
- **`liveStore` / `useLiveService` / `useChannelReader`** — attach/pid/mode state for the client card,
  statusbar, and the detach control (D-04.2).
- **native-core IFF reader/writer + CORE-05 harness** — DTII/STF parse+serialize + round-trip gate
  (D-06); mirror the `*_binding.cpp` + off-thread pattern used by mesh/tre.
- **Shared UI**: `Viewport.tsx`/R3F (gizmo + HUD host), `StatusBar.tsx` (extend with sync/mode/guard/
  COW segments), staging/changeset flow (`stagingStore`, DeployPanel working changes) = target of the
  editors' `＋ Stage` + post-gate `→ staged in working changes` chip, dockview tab chrome.

### Established Patterns
- **In-process agent, call-don't-poke** — D-01 continues Phase 3's "harvest Utinni logic, call
  endpoints in-process from the x86 agent" model; the setter is the correct write primitive.
- **Zero-copy / zero-alloc hot path** — binary stays binary across N-API; the 60fps write path
  allocates nothing (D-02); HUD updates imperative during drag.
- **Byte-exact round-trip gate** (CORE-05) — every format is "done" only after round-tripping a real
  asset against a cited client-loader source; DTII/STF run this in native (D-06).
- **Virtualize large grids** (VfsTree/HexInspector precedent) — DATA-01 requires virtualized grids;
  real datatables/stf have thousands of rows (UI-SPEC Flagged Assumption 6).

### Integration Points
- `packages/contracts/src/live-inject.ts` — add the command-slot layout + write IPC message shapes
  (typed end-to-end; extend, don't fork the existing 320-byte layout).
- Viewport R3F scene — gizmo + absolutely-positioned DOM HUD overlays over the canvas.
- StatusBar — the live↔offline mode indicator + guard/COW mirror (every surface switches together).
- Staging/changeset — the editors' gate-pass staging target (the gizmo does NOT stage — D-05).

</code_context>

<specifics>
## Specific Ideas

- **"Call the setter, not poke the bytes"** was the maintainer's explicit choice — move objects the
  way the game does (`setTransform_o2w` + dirty flag) so nothing renders half-updated. Ground truth
  confirmed the setter is advertised (advertised build) and RVA-known (legacy) on both fenced builds.
- **"Latest-wins single slot"** — a drag should land the final pose; dropping intermediate frames is
  correct, not lossy. No ring buffer.
- **Offline honesty** — the maintainer rejected fake staging: LIVE-05 is honored by the *editors*
  working offline, not by pretending a live-object move has a file home before Phase 7. This is a
  conscious, flagged departure from the approved sketch's `→ staged (patch)` gizmo copy.
- **"Any real datatable must open AND be fully editable"** drove D-07 (full 10-type edit) over the
  safer parse-all-edit-primitives recommendation — accept the added editor scope for Enum/Bool/
  BitVector/PackedObjVars, built inside the 014-D idiom.

</specifics>

<deferred>
## Deferred Ideas

- **World-snapshot (`.ws`) placement editing** — Phase 7 (FMT-02). Becomes the real offline gizmo
  file target; revisit the UI-SPEC `→ staged (patch)` gizmo copy then (D-05).
- **`⇄ Compare to base` diff surface** — sketch 015 is not yet designed. In Phase 5 the button shows
  a disabled/tooltip state or a minimal byte-diff; **do not drop it from the crumb bar** (UI-SPEC
  Flagged Assumption 7).
- **018-B per-key sibling-locale readout** — the approved `.stf` growth direction if cross-locale
  pain shows in real use; not built now (UI-SPEC Surface 3).
- **Numbox drag-scrub** (Blender-style) — optional polish, not the contract (UI-SPEC Flagged
  Assumption 5).
- **AOB/signature scanning, unknown-build attach, x64 client** — out of this milestone (Phase 3
  GROUNDTRUTH fence).

### Reviewed Todos (not folded)
- No `.planning/todos/pending/` items matched Phase 5's scope on the automated pass
  (`todo.match-phase 05` → 0 matches). The gating todo `phase5-plans-must-match-sketches` is the
  UI-SPEC `locked_by` and is honored via `<spec_lock>`, not folded as a work item. Other pending
  todos (`server-binding-post-create-ux`, `vcs-panel-sketch-and-placement`,
  `e2e-leaked-temp-studios`, `product-thesis-shadow-sandbox-and-server-push`) are Phase-4-lineage /
  backlog items, out of Phase 5 scope.

</deferred>

---

*Phase: 05-wysiwyg-live-sync-typed-editors*
*Context gathered: 2026-07-07*
