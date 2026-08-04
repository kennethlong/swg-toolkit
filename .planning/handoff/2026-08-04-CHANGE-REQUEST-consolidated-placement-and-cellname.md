# 2026-08-04 — TOOLKIT → PROVIDER: consolidated request — placement lifetime + cell-name accessor

**From:** SWG-Toolkit live-editor.
**Re:** everything we currently depend on you for, in one document. Two new rows, both thin shims over
statics you already have, plus a status update on work you have already accepted.

We had these queued as separate requests and folded them together instead — they are all on the same
workflow (place a decoration → persist it → verify it), they interact, and the sequencing advice in
Item 3 only makes sense if you can see all three at once.

---

## What we are asking for

| # | Ask | Shape | Why | Priority |
| --- | --- | --- | --- | --- |
| **1** | `utinni_wsForgetNode` — drop a node from the snapshot **without** despawning it | `int __cdecl utinni_wsForgetNode(__int64 networkId)` | The object the modder just placed **vanishes** the instant they hit Persist. Also closes a duplicate-node defect we measured in our own `.ws` output. | **Highest — user-visible defect on the core gesture** |
| **2** | `utinni_getCellName` — expose the existing inline `CellProperty::getCellName()` | `const char* __cdecl utinni_getCellName(void* cellProperty)` | We currently write an **operator-typed** cell name into the `.ilf` instead of one resolved from the placement point. Wrong-cell rows look healthy on disk. Also unblocks a HUD label. | Medium |
| **3** | *(no new ask)* per-building interior refresh — **status update** | already scoped by you | Still wanted, still the right instrument for **edit verification in occupied buildings** — but Item 1 removes it from the placement critical path, so its urgency dropped. | Sequence **after** 1 and 2 |

Both new rows are shims over functions that already exist and already run. Neither adds engine logic.
Section 4 lists what we are deliberately **not** asking for, so you do not spend effort there.

---

---

# ITEM 1 — `wsForgetNode`: drop a node from the snapshot WITHOUT despawning it

**Ask:** one row, a shim over the `WorldSnapshot::removeObject` static you already have.

We hit this from two directions on the same day — a UX complaint from the maintainer and a
byte-level defect we found in our own written `.ws`. Both have the same root cause and the same
one-row fix, so they are in one request.

## 1.1 Why — the core placement gesture currently ends with the object vanishing

Our decoration flow is: click to place → `wsAddObject` mints a **temporary preview** node so the
modder can see and gizmo the thing → Persist → we write an `.ilf` interior-layout row, re-point the
building at a derived template (`wsSetNodeTemplateName`), and `wsSaveSnapshot`.

The `.ilf` row is the persistent representation. The preview node must **not** end up in the `.ws`
— it is a runtime artifact, and a `.ws` copy would be a second, wrong, world-space instance of the
same decoration (see §1.3). So we despawn it with `wsRemoveNode`.

Which means: **the object the modder just placed disappears the instant they hit Persist.** It comes
back only after a scene reload. From the outside that reads as "the editor ate my chair" — on the
one gesture this whole phase exists to deliver. We have had to describe it in the UI as expected
behavior, which is not a sentence we want to keep shipping.

What we actually want is *forget the node, keep the object*. The data leaves the snapshot; the
already-created `Object` stays in the world for the rest of the session, exactly where the modder
put it, and the reload path picks it up from the `.ilf` where it now lives.

## 1.2 What we are asking for

`WorldSnapshot::removeObject (int64)` (`WorldSnapshot.cpp:1556-1571`) already **is** the operation:

```cpp
const WorldSnapshotReaderWriter::Node* const node = ms_reader.find (networkIdInt);
if (node && !node->isDeleted () && node->getSpatialSubdivisionHandle ())
{
    ms_sphereTree.removeObject (node->getSpatialSubdivisionHandle ());
    node->setSpatialSubdivisionHandle (0);
}
ms_reader.removeNode (networkIdInt);
```

Drop the sphere handle (no re-spawn), then `removeNode` → `setDeleted()` + map erase (`WorldSnapshot
ReaderWriter.cpp:1041-1050`), so the row is tombstone-skipped by every later save. **Nothing touches
the live `Object`.** That is precisely the half we need.

It is advertised today only as the **raw static** (`engine_advertise.cpp:1022`,
`worldSnapshot::removeObject`). We would rather not call a raw `void`-returning static across the
ABI and infer success from nothing. Our preferred shape — **id in, result out, no engine types
crossing**, matching the rest of the `utinni_ws*` family:

```
int __cdecl utinni_wsForgetNode(__int64 networkId)   // 1 = forgotten, 0 = not found
```

Add it alongside the existing worldSnapshot mutation rows (`engine_advertise.cpp` ~:1151-1162).

Semantics we are hoping for, stated so you can correct them rather than guess at our intent:

- **Same id space** as `wsRemoveNode` / `wsSetNodeTemplateName` / `wsAddObject`'s return — the `.ws`
  node id. That is the only handle we hold.
- **`1` if a live (non-tombstone) node was found and forgotten, `0` if the id did not resolve.** We
  want to distinguish "we forgot it" from "there was nothing there" so a `0` can surface as a bug in
  our bookkeeping rather than pass silently.
- **The live `Object` is untouched** — still in the world, still rendered, still gizmo-able. This is
  the entire point of the row; if the natural implementation would also despawn, we have the wrong
  primitive and would rather hear that than find out live.
- **No occupancy guard.** `wsRemoveNode` needs one because it deletes a subtree and a `Container`
  dtor cascade-deletes contents. Nothing is deleted here, so there is nothing to protect. (If you
  disagree we will take a `-1` refused code, but we do not think one is warranted.)
- **The usual `finishLoadNow()` prologue** if `ms_parsePending` — `removeObject` already does this,
  and the CONSULT-60 reasoning ("a mid-parse miss would let the node parse in later WITH its sphere
  handle") applies to us identically.

**Why it is thin:** a shim over an existing static, no new logic, no guard, no new state.

### One thing we read in your own comment and want to confirm we are reading right

The block above `suppressObject` (`WorldSnapshot.cpp:1573-1584`) explains why `removeObject` was
*wrong* for the GroundScene client-cached-replacement path — its `removeNode` "silently drops that
authored row from every later `wsSaveSnapshot` (tombstone-skip)" and "makes the id allocator's
map-miss free-test see a still-authored id as free."

**For us, (b) is the feature, not the hazard.** Dropping the row from every later save is exactly
what we are asking for — the node is a runtime preview, not authored data, and we want it gone from
the file. So `removeObject` is the right base and `suppressObject` (handle-only, row survives) is
*not* — it would leave the preview row in the snapshot and still write the duplicate in §1.3.

(c) is the one we would like your read on: the ids we forget were minted by `wsAddObject` from the
allocator band, and after the forget the map-miss free-test would see them as free. We never re-add
at an explicit id, so we believe we are not exposed — but you own that allocator and we would rather
you tell us than have us assume.

## 1.3 The latent bug this also fixes — a duplicate node we measured in our own output

This is not a theory. We found it in the maintainer's `stage/override/snapshot/tatooine.ws` and
verified it byte-for-byte.

Because we call `wsSaveSnapshot()` **before** `wsRemoveNode()`, the preview object is still live in
`ms_reader` at save time and **gets serialized**. `utinni_wsSaveSnapshot` (`:2767`) calls
`ms_reader.saveFiltered(dest, wsSaveIncludeTopLevelNode, 0)`; that filter (`:2719-2722`) only
excludes buildout **top-level** nodes, and the child recursion
(`WorldSnapshotReaderWriter.cpp:479-481`) applies only the tombstone skip — so a runtime **child**
node of an authored building is never filtered out.

Two such nodes, both 84 bytes (52-byte `DATA` payload + 32 bytes of IFF framing), both children of
building node `1082874`:

| file offset (FORM NODE) | DATA at | networkId | containedBy | tmplIdx | cellIdx | radius |
| --- | --- | --- | --- | --- | --- | --- |
| 124,860 | 124,892 | 9995372 | 1082874 | 273 | 0 | 512 |
| 124,944 | 124,976 | 9995373 | 1082874 | 706 | 0 | 512 |

They are duplicates of the `.ilf` rows to full float precision:

```
building world Y 5.0  +  ilf cell-relative Y  1.2416062355  =  6.2416062355  == ws node A Y
building world Y 5.0  +  ilf cell-relative Y -0.8999919891  =  4.1000080109  == ws node B Y
```

Three more tells: `radius 512` is `cs_wsDefaultAddRadius` (`WorldSnapshot.cpp:2378`) while every
authored in-cell decoration carries 32 or 50; the ids sit in the 9,995,xxx runtime-mint band rather
than the 1,0xx,xxx buildout range; and they are parented to the **building** with `cellIndex=0`, so
they carry **world-space** coordinates where an authored in-cell decoration carries cell-relative.

**And the engine cannot dedupe them.** The building's derived template names its own layout
(`interiorLayoutFileName = interiorlayout/toolkit/edit_1082874.ilf`);
`ClientBuildingObjectTemplate::postLoad (:186-190)` loads it and
`ClientInteriorLayoutManager::update (:119-168)` instantiates it — neither reads the world snapshot.
`.ilf`-created objects are **never given a NetworkId** (`ClientInteriorLayoutManager.cpp:141-157`),
so `createObject`'s `CEC_objectAlreadyExists` guard (`WorldSnapshot.cpp:257`) cannot fire. A scene
load therefore instantiates a **phantom second copy**, in the wrong space, that no id-based teardown
can reach.

Nothing in this section is a request against your code — the ordering is ours and we have already
fixed it (§1.4). We are including it because it is the second, sharper argument for the row: with
`wsForgetNode` the correct ordering is also the *natural* one, and there is no window in which a
runtime preview can be serialized.

## 1.4 What we already tried, and what we are running today

- **`wsRemoveNode` after the save** — the original ordering. Writes the duplicate above. Wrong.
- **`wsRemoveNode` before the save** — what we shipped today as an interim. The `.ws` is now written
  clean, which closes the §1.3 defect. But `wsRemoveNode`'s step 5 (`:2605-2618`) does
  `removeFromWorld()` + `delete` on the whole subtree, so the object still vanishes on Persist. This
  is the row that cannot give us what we need: it is a **teardown** primitive and we need a
  **forget** primitive.
- **`suppressObject`** — read, considered, rejected: it drops the handle but keeps the row, so the
  duplicate still serializes. See §1.2.
- **Not despawning at all** — writes the duplicate, and the modder ends the session with a phantom
  in their file. Worse than the vanish.

So the interim is "correct file, bad UX", and there is no consumer-side arrangement of the existing
rows that is both. Hence the ask.

## 1.5 Scope notes

**This does not supersede the per-building interior refresh you accepted**
(`2026-08-02-PROVIDER-SCOPING-interior-refresh.md`). That request is about **EDIT visibility in
occupied buildings** — re-applying a changed `.ilf` to a building whose occupants must survive. It
remains wanted; **Item 3 below is our honest status update on how its urgency has changed** now that
this row exists on paper. This request is narrower: it is about not destroying a **just-added**
object at Persist time, and it unblocks placement on its own. The two compose — forget-on-add keeps
the new object visible, refresh makes an edited one update — but neither waits on the other.

**One behavioral consequence we accept:** once forgotten, a node is invisible to `ms_reader`, so
`wsRemoveNode` can no longer tear it down. That is fine — we only forget on a **successful** Persist,
at which point the object's persistent home is the `.ilf` and the `.ws` node is meaningless.
Pre-Persist cancel (the user places, changes their mind, hits Esc) keeps using `wsRemoveNode`, which
is still the right primitive there because we genuinely do want the object gone.

**Not blocking.** The interim ordering has the file correct today, and the vanish is cosmetic-but-bad
rather than data-destroying. Scope it as it suits you. The `0` vs `1` return and the allocator
question in §1.2 are the two places we would rather have your judgement than our guess.

---

---

# ITEM 2 — a cell-NAME accessor (this is much smaller than the request we told you was coming)

**This supersedes the `getContainingCellName` change request our Plan 05.1-15 was going to file.**
That plan was scoped to ask you to *build* a cell-name resolution shim — walk from an object to its
containing cell to a name, or a POD out-buffer shim over `getCellNames()`'s index→name mapping. We
went and read your source before writing it, and **almost all of that ask evaporated.** What is
actually missing is one wrapper over a function you already have. We are telling you the larger
version is withdrawn so it does not sit in your queue at its old size.

## 2.1 Why — we write a cell name we did **not** derive, into a file where it is load-bearing

Our `.ilf` writer emits, per decoration row: `asciiz objectTemplateName`, `asciiz cellName`, then 12
LE floats of `o2p` transform (`packages/renderer/src/services/ilf.ts:6-21`, verified against
`InteriorLayoutReaderWriter.cpp:331-378`). **The cell name is a literal string in the row** — verified
in the maintainer's real `stage/override/interiorlayout/toolkit/edit_1082874.ilf`, where the first
`NODE` chunk begins at file offset **24**, its payload at **32**, and the `cellName` asciiz sits at
offset **95**: `66 6f 79 65 72 31 00` = `"foyer1\0"`, immediately followed by the transform's first
float at 102 (`00 00 80 3f` = 1.0f).

That file has **262 NODE rows across 11 distinct cells** — `foyer1`, `foyer2`, `cantina`, `alcove1`
through `alcove5`, `stage`, `back_hallway`, `back_entrance`. So "which cell" is a real, 11-way choice
in the primary decorating target, not a formality.

**And we do not resolve it.** `g_capCellName` in our injected agent is copied verbatim from the
caller-supplied `HOST_CMD` payload — `packages/live-inject/agent/overlay.cpp:1705` stores `cmd.str2`
into `g_placementCellName`, and `:886` copies that straight into `g_capCellName` at capture time.
Nothing between those two points consults the placement point. Note the asymmetry one line earlier at
`:880`: the building id **is** derived from the click ("the container actually clicked, not the
preselection"). The cell name is the one field in the row that is still hearsay.

In a live session the operator typed `foyer1` and that exact string was written into the `.ilf` NODE
row. It happened to be right. Had the object actually been placed in `foyer2` or in the main
`cantina` cell, **the row would have been silently wrong on disk while looking perfectly healthy** —
correct template, correct transform, correct framing, wrong room. There is no checksum and no
validation pass that would catch it; the only symptom is a decoration appearing in the wrong room on
the next load.

This also serves a design principle the maintainer has recorded explicitly
(`.planning/todos/pending/exterior-ws-node-editing.md:21-24`) — the container must be resolved from
the **placement point**, never from the player:

> *"The decision should be made based on the placement location, not the player location. If I'm
> standing in the cantina door, I can place a world object just outside the door — that goes to `.ws`
> not `.ilf`. And the opposite is also true: if I'm just outside the cantina door, I can place an
> object just inside the door and that goes into `.ilf`, not world."*

A caller-supplied string cannot honour that. A name read from the cell that actually contains the
placement point does, by construction.

## 2.2 One row closes TWO consumers

**(a) Correctness of persisted data** — the `.ilf` row above. This is the one that can quietly corrupt
a modder's file.

**(b) An in-game HUD label.** Sketch 020-A specifies a three-segment overlay strip —
`Cantina Table · alcove1 · Cantina (Mos Eisley)` (decoration · cell · building). We ship two segments;
the middle one is missing. `.planning/todos/pending/hud-cell-name-label-segment.md` is blocked on
exactly this row, and records that all 150 rows of your advertised catalog were audited against
`engine_hookpoints.inc` (contract v26): `object::getParentCell` returns the cell *object* and
`objectTemplate::getPortalLayoutFilename` returns the `.pob` path, but **nothing returns a cell name
string**. Where it bites: in a multi-room POB (the player house in that session had `hall3`,
`bedroom3`, `kitchen`, `elevator1`, `livingroom1`, `foyer1`) two identical chairs in two different
rooms produce an identical strip label. The cell name is the only disambiguator.

## 2.3 What we are asking for — and why it is one line

`CellProperty::getCellName()` **already exists and already returns exactly the string we need**:

- declared at `CellProperty.h:120` — `const char *getCellName() const;`
- inline definition at `CellProperty.h:249-252` — `return m_cellName;`
- `getCellNameCrc()` sits beside it at `:121` (declaration) and `:256-259` (inline).

**It is INLINE. That, and only that, is why we cannot read it.** There is no out-of-line symbol to
advertise or hook. Nothing is conceptually missing from the engine — this is purely an ABI-visibility
gap, the same shape as `object::isChildObject` (v29, also inline → shim).

And **we already hold the `CellProperty*` it needs.** `clientWorld::findCellAtWorldPosition(x,y,z)` is
advertised (`engine_advertise.cpp:1195`, v28 — annotated "THE placement-routing primitive… NEVER null
— falls back to the world cell"), and our placement path already calls it:
`packages/live-inject/agent/overlay.cpp:856` resolves the destination cell from the ray hit point, and
`agent/rva_table.cpp:472` binds the row.

So the composition is:

```
findCellAtWorldPosition(placementPoint) -> CellProperty*   [we already have this, already called]
getCellName(cellProperty)               -> "foyer1"        [the only thing missing]
```

Suggested shape, offered so you can correct it rather than guess at our intent — the exact signature
is yours:

```
const char* __cdecl utinni_getCellName(void* cellProperty)
```

Semantics we are hoping for:

- **Takes the `CellProperty*` we already hold** from `findCellAtWorldPosition`. We deliberately are
  **not** asking for an object→cell walk; we do not need one, and the placement point is the correct
  input per §2.1.
- **`0` for a null input.** We will null-check regardless.
- **The world cell:** we expect it returns `"world"` rather than null, since
  `CellProperty.cpp:225` sets `ms_worldCellProperty->m_cellName = "world"`. Please confirm — we will
  treat *either* answer as "not an interior cell, do not write an `.ilf` row", but we would rather
  code against the real one than infer it.
- **Borrowed pointer, game-thread-only**, matching the rest of the boundary.

### Two questions we would rather you answer than assume

**1. Lifetime / ownership of the returned pointer.** Is it stable for as long as the cell exists, or
should we copy it into our own buffer immediately? Reading `CellProperty.cpp:456`, `m_cellName =
cellTemplate.getName()` — so it appears to be owned by the cell template, not by `CellProperty`, and
its lifetime is that template's. If that is right, "stable while the building is loaded" is our
reading, but we will `strncpy` it on receipt at your word either way. If you would rather hand back a
copy-out (`int utinni_getCellName(void* cellProperty, char* buf, int cap)`, the `wsGetSavePath`
pattern at `engine_advertise.cpp:1163`), that also works for us and sidesteps the question entirely —
your call.

**2. Would you rather hand back the CRC?** `getCellNameCrc()` is right beside it and is a trivially
ABI-safe `uint32`. **We need the string**, because the `.ilf` NODE row stores a literal cell-name
string — verified in real bytes at offset 95 of `edit_1082874.ilf` above, not inferred from a doc.
We cannot reverse a normalized CRC back into the name to write it. (The CRC would still be useful to
us as a cheap comparison key if it is free to expose, but it does not substitute.)

**Not blocking.** Our current path works whenever the caller-supplied name happens to be right, which
in practice it has been, because the operator has been placing where they said they were. It is a
latent correctness hazard rather than a live failure, and the HUD label degrades gracefully to two
segments today.

---

---

# ITEM 3 — per-building interior refresh: STATUS UPDATE, not a new ask

**This is not a request.** You accepted this on 2026-08-02
(`2026-08-02-PROVIDER-SCOPING-interior-refresh.md` — *"We are taking it"*) and it is queued on your
side as *"the next substantive item"* (§5 of that scoping). We are updating you because Item 1
changes its urgency, and you should be able to re-sequence with that in hand rather than discover it
after building.

## 3.1 Still wanted. Do not cancel it.

Nothing about §1 of our original request (`2026-08-02-CHANGE-REQUEST-interior-refresh.md`) has been
retracted. Your replacement design is better than what we asked for and we still want it:
delete the client-cached interior objects per cell → reset that cell's created-count cursor → let the
budgeted `update()` re-create from the current layout (your scoping §2), inheriting the CONSULT-46
throttle for free. Your correction that `ClientInteriorLayoutManager::applyInteriorLayout` is **dead
code in this configuration** — gated off by `ms_disableLazyInteriorLayoutCreation`, with `update()`
being the live path, and add-only besides (your §1 (a) and (b)) — cost us nothing, because we had
filed the request but written no code against it. Our plans reference the capability, not the
mechanism.

## 3.2 But the urgency dropped, and we should say so plainly

**We originally leaned on interior refresh to fix the placement vanish.** Our own Plan 05.1-12
close-out names it as the root cause of that carve-out: the reconciliation despawn assumes the
building re-renders from the new `.ilf`, which an occupied building never does. So refresh was, in our
heads, on the critical path for the core placement gesture.

**With `wsForgetNode` (Item 1) the placement path no longer needs any redraw at all.** There is
nothing to re-render, because nothing is destroyed — the object simply stays where the user put it,
and the snapshot forgets about it. Interior refresh is therefore **no longer blocking placement.**

## 3.3 It remains the right instrument for the other half — EDIT verification in occupied buildings

The half that Item 1 does **not** touch is the one your original §2 residual named:

> *"Edit an occupied building, reload, and your edit will not appear."*

The canonical model-D loop — *persist the edit, reload, confirm it took* — still reports a **false
failure** in an occupied building, because a building with server-owned occupants is kept across a
reload and renders its pre-edit state until a zone change or relog. The cantina is our primary
decorating target and it is exactly that case: `[ws.unload] reason=wsUnload node=1082874 live=1
cells=16 contents=54 serverOwned=54` — your own log, in
`2026-08-02-PROVIDER-HANDBACK-unload-guard-npc-fix.md:27`. 54 server-owned occupants, all of which
correctly survive, and a stale interior as the price.

Item 1 fixes *placement* visibility. Interior refresh is still the only thing that fixes *edit*
visibility. They are complementary, not alternatives.

## 3.4 Our suggested sequencing

**Items 1 and 2 ahead of interior refresh.** Both new rows are thin shims over statics that already
exist and already run — no new engine logic, no new state, no design question beyond the two
clarifications we asked for. Interior refresh is real design work by comparison, and your own scoping
already found that the obvious entry point is dead code and that three questions remain open (§4 of
your scoping: exactly which objects the teardown deletes, mid-parse behaviour, and whether the cursor
reset alone suffices).

Getting 1 and 2 first also improves the refresh work: with `wsForgetNode` in place, our in-session
preview nodes are removed from the snapshot on Persist rather than lingering, which narrows the
"does the teardown catch in-session placements" hazard we flagged in
`2026-08-02-TOOLKIT-NOTE-interior-refresh-insession-objects.md`. That note still stands — the
unpersisted preview between click and Persist must not be swept — but the window is smaller and
better-defined.

Nothing here is a schedule demand. If refresh is already half-built, finish it; the sequencing advice
is about value-per-hour, not about us waiting on anything.

---

---

# 4. Explicitly OUT OF SCOPE — please do not spend effort on these

Two things that look adjacent, that we considered, and that we have concluded are **ours to build,
not yours**. Recording them so they do not end up in your queue by inference.

**4.1 Exterior `.ws` node authoring.** The maintainer wants to place objects *outside* buildings, and
that reads like an engine gap. It is not.
`.planning/todos/pending/exterior-ws-node-editing.md:64-66` states it plainly: the capability *"is
blocked by the toolkit having exactly ONE persist route, not by any client limitation."* Your
`wsAddObject` already accepts a real `containedById` — your own catalog note at
`engine_advertise.cpp:1151` confirms it mints `id..id+cellCount` with atomic POB cell expansion, and
world is a legal container. What is missing is entirely on our side: a `.ws`-node persist route
parallel to our `.ilf` route, a branch that routes on `buildingId` instead of refusing, and
world-panel representation for exterior nodes (that file, §"What is actually missing (our side)").
We have it scoped as its own phase. **No ask.**

**4.2 A building DISPLAY name.** Sketch 020-A wants `Cantina (Mos Eisley)`; our overlay shows
`Cantina Tatooine`, because `prettifyTemplateLabel()` in `overlay.cpp` derives it from the template
path (`shared_cantina_tatooine.iff` → strip dir → drop `shared_` → drop `.iff` → underscores to
spaces → title case). The real display name is absent from the template path entirely — but it is
**not** absent from the client's data, and we can already read it. Our World panel derives good labels
host-side from the `.iff`'s own `FORM SBOT → FORM DERV → leaf` chain (05.1-04, verified against a real
`shared_cantina_tatooine.iff` on disk). The only reason the two surfaces disagree is that the injected
x86 agent has no VFS access while the host process does — and we control the shared-memory channel
between them, so we can simply push the resolved name across ourselves.
`.planning/todos/pending/hud-cell-name-label-segment.md:39-47` records both halves. **No ask.**

Note the contrast with Item 2, which is the reason we are being explicit here: the *cell* name
genuinely has no host-side source — it is runtime portal state, not a file we can parse — whereas the
*building* display name is sitting in an `.iff` we already read. That asymmetry is why one of them is
a request and the other is not.
