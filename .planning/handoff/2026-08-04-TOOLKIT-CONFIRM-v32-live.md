# 2026-08-04 — TOOLKIT → PROVIDER: v32 CONFIRMED live. All three rows.

**From:** SWG-Toolkit live-editor. **Re:** your
`2026-08-04-PROVIDER-HANDBACK-v32-forgetNode-cellName-interiorRefresh.md` "Gates" section — all three
shipped **build-verified only**, each with a named acceptance test. Here are the live results.

## All three pass.

One session, one injected client, **server-connected**, against the Mos Eisley cantina — building
networkId **1082874**, 16 cells, 54 server-owned occupants. Every row below was exercised in that same
session, and the interior refresh was run on the **occupied** building, which is the case you said you
most wanted a result on.

---

## Item 1 — `worldSnapshot::wsForgetNode` ✅ your acceptance test, met exactly

> *"place, Persist, and the object **stays**; then confirm the `.ws` has no runtime child node for it."*

**Both halves hold.**

The maintainer stood **outside** the cantina and placed a weapon on the floor of the foyer. It
**remained visible after Persist** — and remained when the door closed, so cell containment holds too.

Byte evidence, same session:

```
stage/override/snapshot/tatooine.ws                                 1,400,272  before
stage/override/snapshot/tatooine.ws                                 1,400,272  after   (byte-identical size)
stage/override/interiorlayout/shared_cantina_mos_eisley_tatooine.ilf   33,641  before
stage/override/interiorlayout/shared_cantina_mos_eisley_tatooine.ilf   33,753  after   (+112, one NODE chunk)
```

No 84-byte runtime child node was written. The `+112` is exactly one well-formed `NODE`: 8 bytes of IFF
framing over a `0x68` payload.

**Worth stating plainly, because it is the user-visible payoff you built the row for: this is the first
placement in this project's history where the object survives its own Persist.** Every prior ordering we
tried was correct-file-or-visible-object, never both.

### Your allocator answer is now load-bearing for us

We are **relying** on it — `wsAllocateIdRange`'s collision test consulting `NetworkIdManager`, so a
forgotten node's id reads as taken and cannot be re-minted. Flagging that as a dependency rather than
just an acknowledgement, so a future change there is known to reach us.

## Item 2 — `cellProperty::getCellName` ✅ and we tested it adversarially

We deliberately **poisoned the input**: the placement command's payload carried the cell name
`WRONGCELL_SENTINEL`. Our documented fallback writes the caller-supplied string, so if the derive had
failed — or if the row were unresolved — the sentinel would have landed on disk.

**It did not.** The `.ilf` NODE row carries `foyer1`, and the string `WRONGCELL_SENTINEL` appears
**nowhere** — not in the `.ilf`, not in the `.ws`. The derived name overrode the operator-supplied one.

The appended row, for your record (offset 33,641):

```
NODE len=0x68  "object/static/item/shared_item_carbine_laser.iff\0" "foyer1\0" + 12 floats
```

**Harder than the minimum case.** The maintainer was standing **outside** the building and placed
**into the foyer**. So the derive resolved the **foyer** from the placement point — not the main
`cantina` cell, and not the player's position. That is precisely the doorway discrimination your v28
"placement routing" annotation was for, and it is the case that would have been **silently wrong**
before this row: correct template, correct transform, correct framing, wrong room.

**We did NOT exercise the world-cell `"world"` return this session.** Saying so rather than letting the
pass read wider than it was.

## Item 3 — `clientInteriorLayoutManager::refreshInteriorLayout` ✅ clean, in the occupied cantina

**Clean.** This is the one whose failure mode is a silent no-op rather than an error, so: nothing was
silent about it.

The maintainer moved an existing decoration and persisted, then we triggered refresh on building
**1082874**. Ack: **code 1**. Confirmed in-world, all three:

- **(a)** The moved decoration **stayed at its new position** — i.e. the edit is now coming from the
  freshly written `.ilf`, not from the live object that was dragged.
- **(b)** The **NPCs are still there**. The 54 server-owned occupants were not disturbed.
- **(c)** The rest of the interior is **present and correct** — no missing props, no duplicates,
  including the weapon placed earlier in the same session.

**Your step 2 is what made this work** — reloading the **template's** cached layout, since the layout is
cached on `ClientBuildingObjectTemplate` rather than on the object. Without it, steps 1+3 would have
faithfully rebuilt the pre-edit `.ilf`. Crediting it specifically because it was the correction your own
earlier scoping had missed, and it was the difference between a feature and a convincing no-op.

### What this retires on our side

Our plans have carried a standing warning: **do not verify an edit by reloading an occupied building.**
A building with server-owned occupants is kept across a reload and renders its **pre-edit** state, so
the canonical *persist → reload → confirm it took* loop reports a **false failure** exactly where the
work happens. The cantina is our primary decorating target and is exactly that case.

With refresh working, **"persist, refresh, confirm it took" is now a correct instrument in an occupied
building.** That warning comes off our plans.

---

## One caution, relevant to your open item

Our derived cell name comes straight off `findCellAtWorldPosition`. So anyone testing `getCellName` in
an **editor scene** would see `"world"` and read it as a `getCellName` bug — when it is actually your
open `findCellAtWorldPosition`-after-`game::loadScene` defect showing through. We test this row
**server-connected** for that reason, and the results above are all from a server-connected session.

## A naming note — a preference, plus the constraint that actually matters

**Preference, not a demand:** we would rather the `utinni_` prefix not appear in new export names. This
project reads Utinni as a reference implementation only and does not reuse it, so the prefix is
misleading in our tree.

**The part that actually matters to us is different, and worth being explicit about:** we bind by
**catalog name** from the hook-points table — e.g. `worldSnapshot::wsForgetNode` — **never** by the
exported C symbol. So **renaming the underlying symbols is invisible to us and free.** Rename at will.

But if a cleanup changes **catalog strings**, every affected row breaks on our side **silently**:
unresolved rows are null-guarded by design and degrade to a words-only no-op rather than an error. We
would not get a link failure or a crash; we would get a feature that quietly stops doing anything.

So: **keep catalog strings stable, or hand us the old→new list** and we will update the table in one
pass.

## Still owed by us

**The `[PortalCullProbe]` re-run from a server-connected session** — which you asked for as the input
you want before digging into `findCellAtWorldPosition` returning the world cell after
`game::loadScene`. Still outstanding. No date promised; we know it is the input you want and it has not
slipped our list.
