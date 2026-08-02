# 2026-08-01 — APPLIED DIRECTLY (Utinni): scoped the "no SWGEmu RVA exists" comment

**Status: DONE.** Filed as a change-request handoff, then applied directly at the maintainer's
instruction — Utinni is effectively wound down in favour of this project, so the never-edit-reference-
repos rule was relaxed for it (see "Rule change" below).

**Applied:** `../Utinni` `master`, commit **`89bac6f`** — *"docs: scope the v17 ws-shim 'no SWGEmu RVA
exists' comment"*. Local only, **not pushed**. Comment-only: no code, no ABI, no rebuild.
File: `UtinniCore/swg/endpoints_bindings.cpp:305-308` → now 305-318.

## What was wrong

The comment was accurate about the **v17 `utinni_ws*` id-keyed READ shims** but read as a claim about
the whole `WorldSnapshot` surface. A toolkit session reading only that file concluded world-snapshot
add/remove/save was **never compiled into the retail client**, and drafted a Milestone-9 plan around an
out-of-process-only design on that false premise.

## The refutation (in the same repo)

`UtinniCore/swg/scene/world_snapshot.cpp` — real SWGEmu RVA literals:
`addNode 0x00B98410`, `removeNode 0x00B98780`, `saveFile 0x00B98120`, `openFile 0x00B97D90`,
`clear 0x00B98290`, `getNodeByNetworkId 0x00B98740`, `getNodeByIndex 0x00B986B0`,
`nodeCount 0x00B986A0`, `nodeCountTotal 0x00B986D0`, `removeFromWorld 0x00B97440`.
Picking: `clientWorld::collide 0x00561350` (`swg/scene/client_world.cpp`).
Cell resolution: `Object::getParentCell 0x00B22C00` (`swg/object/object.cpp`).

The distinction that got lost: the v17 shims are a **newer provider-added API surface** with no legacy
equivalent; the **classic RVA layer** implements comparable capability on retail and is still present
in the working tree.

## Still open (optional, not applied)

The sibling `// ... null on SWGEmu` notes at `:140` (SceneCreator scene load), `:143` (lookAt-target id
read), `:146` (current-scene-id copy-out), `:525` (`m_particleSystems`), `:532` (`playClientEffect`)
carry the same "binding is advertised-only" vs "capability absent from retail" ambiguity. A one-line
group header stating which reading applies would prevent a repeat. Low value — the 305-308 case is the
one that actually bit.

## Rule change (durable)

Previously: never edit `../Utinni` or `../swg-client-v2` directly; emit a change-request handoff,
because the maintainer runs parallel sessions in both. **As of 2026-08-01 that narrows:**

- `../Utinni` — **direct edits OK.** Wound down in favour of this project; no live parallel session to
  conflict with.
- `../swg-client-v2` — **handoff protocol still applies.** The provider is actively shipping handbacks
  into it (v22/v23/v24/v25 in this same directory).

## Provenance

Found while answering "how much of Phase 05.1 works on the non-advertised client?" during 05.1
execution. The maintainer's firsthand report — spawning an armoire in open-world Naboo with a working
gizmo, and attaching to an existing in-world object — is fully explained by the classic RVA layer, and
is what prompted the re-check that falsified the original reading.

Consumer-side record (corrected): `.planning/backlog/milestone-9-swgemu-capability-parity.md`.
