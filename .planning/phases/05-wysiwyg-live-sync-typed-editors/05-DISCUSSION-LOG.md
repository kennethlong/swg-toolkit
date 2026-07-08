# Phase 05: WYSIWYG Live-Sync & Typed Editors - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-07
**Phase:** 05-wysiwyg-live-sync-typed-editors
**Areas discussed:** Live-write apply path, Offline gizmo semantics, DTII/STF parse boundary, Phase slicing / MVP

> Context: the 05-UI-SPEC is already approved, so the visual/interaction contract was NOT re-opened.
> Discussion targeted only the implementation gray areas the sketches leave open.

---

## Live-write apply path (LIVE-03)

### Apply mechanism

| Option | Description | Selected |
|--------|-------------|----------|
| Client setter (setTransform_o2w) | Agent calls advertised/RVA object::setTransform_o2w + setObjectToWorldDirty; fires render/collision notifications, no half-updated object. Both builds support it. | ✓ |
| Raw memory write to transform | WriteProcessMemory/in-process poke of the 48-byte float[3][4]; risks torn/half-updated object unless dirty flag also poked. | |
| Let research decide | Defer setter-vs-poke; lock only in-process via agent DLL. | |

**User's choice:** Client setter (setTransform_o2w)
**Notes:** Ground truth verified this session — advertised client advertises `object::setTransform_o2w` (engine_advertise.cpp:578/850); Utinni legacy RVA `0x00B22CC0` (object.cpp:148). Move objects the way the game does.

### Write cadence / command channel

| Option | Description | Selected |
|--------|-------------|----------|
| Latest-wins single slot | One seqlock-guarded command slot holds newest target transform; agent applies current each frame. Drops intermediate drag values (correct for a drag). Zero alloc, no queue. | ✓ |
| Command ring buffer | Fixed ring the agent drains in order; preserves every step but needs backpressure, more than a drag needs. | |
| Let research decide | Lock only "no alloc + control ping." | |

**User's choice:** Latest-wins single slot

### COW snapshot / revert

| Option | Description | Selected |
|--------|-------------|----------|
| Attach-time transform, per object | Capture transform bytes once at first edit/attach; per-write revert undoes a log entry, Revert ALL restores attach-time; guard compares live bytes to snapshot before each write. | ✓ |
| Full write-log replay | No baseline; reconstruct by unwinding the log. More flexible, heavier, diverges from single-snapshot sketch model. | |
| Let research decide | Lock guard-before-write + fails-closed only. | |

**User's choice:** Attach-time transform, per object

### Agent lifecycle debt (Phase 3 → Phase 5)

| Option | Description | Selected |
|--------|-------------|----------|
| Fold in — required for the loop | Stop-signal/thread cleanup + detach control + legacy 64-bit networkId read all must-haves. | ✓ |
| Only what the write path needs | Just stop-signal/cleanup; detach UI + legacy networkId stay follow-up todos. | |
| Defer all three | Keep as todos; reuse existing attach as-is. | |

**User's choice:** Fold in — required for the loop
**Notes:** A repeated attach/edit/detach session IS the WYSIWYG workflow.

---

## Offline gizmo semantics (LIVE-05)

| Option | Description | Selected |
|--------|-------------|----------|
| Disabled-with-reason (LIVE-05 honest) | Gizmo non-interactive offline with clear reason; LIVE-05 satisfied by the typed editors (real file targets). No fake staging. | ✓ |
| Stage to .ws placement (pull Phase 7 fwd) | Bring minimal .ws object-placement read/write forward as the offline target; honors sketch literally but widens phase. | |
| Local preview only, no stage | Gizmo moves object in toolkit viewport only, writes nothing; move evaporates on reload. | |

**User's choice:** Disabled-with-reason (LIVE-05 honest)
**Notes:** A live object's only file home is a `.ws` placement (Phase 7 / FMT-02). Deliberate divergence from the UI-SPEC's `→ staged (patch)` gizmo copy — flagged as an erratum in CONTEXT (D-05). The indicator stays valid for the editors.

---

## DTII/STF parse boundary & scope (DATA-01/02)

### Parse layer

| Option | Description | Selected |
|--------|-------------|----------|
| Native C++ (native-core) | Parse+serialize in C++, byte-exact gate in native (CORE-05), harvest DataTableWriter / LocalizedStringTableReaderWriter. | ✓ |
| TS over exposed IFF tree | Parse in TS over IFF chunk tree; faster iteration but second serialization path outside the proven harness. | |
| Let research decide | Lock gate + oracle; planner picks layer. | |

**User's choice:** Native C++ (native-core)
**Notes:** Ground truth this session — DataTable.cpp/DataTableColumnType.h (10 types), DataTableWriter.h (DTII serializer oracle), LocalizedStringTableReaderWriter (STF read+write oracle).

### DTII column-type scope

| Option | Description | Selected |
|--------|-------------|----------|
| Parse all, edit primitives | Round-trip all 10 types; inline-edit only String/Int/Float, others read-only. (Recommended) | |
| Full edit for all 10 types | Inline editors for every type incl. Enum/Bool/BitVector/PackedObjVars. | ✓ |
| s/i/f only, refuse the rest | Only String/Int/Float; refuse others. Many real datatables un-openable. | |

**User's choice:** Full edit for all 10 types
**Notes:** Extends beyond 014-D (sketch specs s/i/f only). Flagged in CONTEXT (D-07) — planner designs the extra editors within the 014-D idiom; type-badge set widens.

---

## Phase slicing / MVP

### Completion scope

| Option | Description | Selected |
|--------|-------------|----------|
| All three required | LIVE-03 + DATA-01 + DATA-02 all ship to close Phase 5. | ✓ |
| Gizmo-write MVP, editors fast-follow | LIVE-03 closes phase; DTII/STF split off. | |
| Editors MVP, gizmo-write fast-follow | DTII+STF first; defer gizmo-write. | |

**User's choice:** All three required

### First vertical slice

| Option | Description | Selected |
|--------|-------------|----------|
| Gizmo-write loop first | Build the highest-unknown track first to de-risk early. (Recommended) | |
| DTII editor first | Reference for shared gate/grid components; lower risk. | |
| Let planner sequence | Lock "all three in scope"; planner orders waves from the dependency graph. | ✓ |

**User's choice:** Let planner sequence

---

## Claude's Discretion

- Wave sequencing (planner orders from dependency graph; shared GateBar/FailBanner built once).
- DatatablePanel placeholder disposition (retire/repurpose — editor placement already locked to main-group tab by UI-SPEC).
- Gizmo library base (drei/three TransformControls restyled — UI-SPEC Flagged Assumption 1).
- Rot/Scale write-log units + exact command-slot encoding (degrees/factor; planner derives from Transform layout).
- Elevation/UAC for the write path (reuse Phase-3 attach posture; surface if setter needs more).

## Deferred Ideas

- World-snapshot (.ws) placement editing — Phase 7 (FMT-02); becomes the real offline gizmo target.
- `⇄ Compare to base` diff surface (sketch 015 undesigned) — disabled/tooltip or minimal byte-diff; don't drop the button.
- 018-B per-key sibling-locale readout — approved .stf growth direction, not built now.
- Numbox drag-scrub — optional polish, not contract.
- AOB scanning / unknown-build attach / x64 client — out of milestone (Phase 3 GROUNDTRUTH fence).
