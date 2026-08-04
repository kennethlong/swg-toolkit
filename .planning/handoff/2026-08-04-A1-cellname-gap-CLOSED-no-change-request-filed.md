# 2026-08-04 — A1 cell-name resolution: CLOSED by contract v32. No change-request filed.

**Status of 05.1-15 Task 1: complete by resolution, not by filing.** This file is the record.

Task 1 as written directed us to file
`.planning/handoff/<date>-CHANGE-REQUEST-getContainingCellName.md`, requesting a provider shim to
resolve a cell name for a brand-new placement. **That request must not be sent: the provider already
shipped the capability, we already consumed it, and it is live-verified.** Filing it would ask for
work that is done.

This is a toolkit-side record only — nothing goes to the provider inbox for this item.

---

## What the gap was

`05.1-RESEARCH.md` "Open Questions" §1 established, from real client source:

- `CellProperty::getCellName()` is **inline** at `sharedObject/src/shared/portal/CellProperty.h:249`,
  so it has no exported symbol to bind against.
- `PortalProperty::getCellNames()` exists non-inline but returns an ABI-unsafe
  `std::vector<const char*> const&`.
- `.ws` node addressing uses a numeric `cellIndex` — a **different identity space** from the
  `.ilf`'s string `cellName`.

Consequence at plan time: a brand-new placement had no way to learn which room it landed in, so
Plan 14 shipped the D-04 degrade (borrow a `cellName` from an existing decoration in the target
building) and Plan 12's building-id guard closed only the wrong-BUILDING case.

## What closed it

Provider contract **v32** shipped `cellProperty::getCellName` as a POD copy-out shim:

```
int getCellName(void* cell, char* buf, int cap)   // returns needed length INCLUDING NUL
```

Consumed in `packages/live-inject/agent/overlay.cpp:999-1022`. The agent derives the name from
`destCell` — the **same** `CellProperty*` the `setParentCell` reparent already resolved via
`findCellAtWorldPosition(g_lastRayPt)`, so by construction it is the cell containing the placement
point — and **overrides** the caller-supplied name with it. The caller-supplied name survives only
as a fallback on a pre-v32 exe or a failed/truncated derive, and that fallback is announced in the
words-only debug idiom rather than silently writing a truncation.

**Live-verified adversarially** (`.planning/handoff/2026-08-04-TOOLKIT-CONFIRM-v32-live.md`): the
placement payload deliberately carried `WRONGCELL_SENTINEL`; the `.ilf` row recorded `foyer1`, and
the sentinel appears in neither the `.ilf` nor the `.ws`. The harder discrimination also held — the
maintainer stood **outside** the building and placed **into the foyer**, and the derive resolved
`foyer1` rather than the main `cantina` cell or the player's position.

## What this means for the phase's own disclosures — read before the sign-off

The A1 closure narrows two things this phase documented as risks. Stating the narrowing precisely
rather than either ignoring it or overclaiming:

- **C6's same-building wrong-ROOM residual is closed server-connected.** Both the persisted row and
  the live object now follow the click point: the `.ilf` `cellName` is derived from `destCell`, and
  the spawned object is reparented into that same `destCell` via `setParentCell`. The room is
  correct regardless of what the app sent.
- **Plan 14's D-04 borrow is now cosmetic on the write path.** The borrowed `cellName` still gates
  the trigger and labels the modal, but it no longer determines what lands on disk. The
  eligible-building narrowing (C6/Fable) therefore remains a real **UI** scope limit — it is what
  makes a building selectable at all — but it is no longer a correctness risk for the row's cell.
- **The residual that IS still open is the provider's**, and it is why we test server-connected:
  `findCellAtWorldPosition` returns the **world cell** after `game::loadScene`, so in an EDITOR
  SCENE `destCell` is the world cell and the derive yields `"world"`. That is their queued item, not
  ours; our `[PortalCullProbe]` capture is the input they asked for and is delivered.

**Consequence for the sign-off checkpoint:** Plan 14's success toast still carries the wrong-room
warning. That copy is now **conservative rather than necessary** for a server-connected session. It
is not wrong — no code change is proposed here — but a verifier should record it as "warning shown,
and the underlying risk it warns about is now closed server-connected by v32", not as evidence that
the risk is live.

## Why no change-request document exists

Per the cross-repo protocol we never edit `../swg-client-v2` directly; we file a request and the
maintainer relays. There is nothing to relay: the shim exists, is bound by catalog name
(`cellProperty::getCellName`), is consumed, and is confirmed. The correct artifact is this record.

Cross-references:
- `05.1-12-SUMMARY.md` carve-out #2 — marked RESOLVED 2026-08-04 (`a136541`).
- `05.1-15-PLAN.md` `must_haves` and `files_modified` — amended in the same commit so neither still
  requires filing this request.
- `05.1-14-SUMMARY.md` "Notes for Plan 15".
