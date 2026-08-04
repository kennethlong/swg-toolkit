# 2026-08-04 — TOOLKIT → PROVIDER: `wsForgetNode` — drop a node from the snapshot WITHOUT despawning it

**From:** SWG-Toolkit live-editor. **Re:** decoration placement (`wsAddObject` → persist to `.ilf`).
**Ask:** one row, a shim over the `WorldSnapshot::removeObject` static you already have.

We hit this from two directions on the same day — a UX complaint from the maintainer and a
byte-level defect we found in our own written `.ws`. Both have the same root cause and the same
one-row fix, so they are in one request.

---

## 1. Why — the core placement gesture currently ends with the object vanishing

Our decoration flow is: click to place → `wsAddObject` mints a **temporary preview** node so the
modder can see and gizmo the thing → Persist → we write an `.ilf` interior-layout row, re-point the
building at a derived template (`wsSetNodeTemplateName`), and `wsSaveSnapshot`.

The `.ilf` row is the persistent representation. The preview node must **not** end up in the `.ws`
— it is a runtime artifact, and a `.ws` copy would be a second, wrong, world-space instance of the
same decoration (see §3). So we despawn it with `wsRemoveNode`.

Which means: **the object the modder just placed disappears the instant they hit Persist.** It comes
back only after a scene reload. From the outside that reads as "the editor ate my chair" — on the
one gesture this whole phase exists to deliver. We have had to describe it in the UI as expected
behavior, which is not a sentence we want to keep shipping.

What we actually want is *forget the node, keep the object*. The data leaves the snapshot; the
already-created `Object` stays in the world for the rest of the session, exactly where the modder
put it, and the reload path picks it up from the `.ilf` where it now lives.

---

## 2. What we are asking for

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
*not* — it would leave the preview row in the snapshot and still write the duplicate in §3.

(c) is the one we would like your read on: the ids we forget were minted by `wsAddObject` from the
allocator band, and after the forget the map-miss free-test would see them as free. We never re-add
at an explicit id, so we believe we are not exposed — but you own that allocator and we would rather
you tell us than have us assume.

---

## 3. The latent bug this also fixes — a duplicate node we measured in our own output

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
fixed it (§4). We are including it because it is the second, sharper argument for the row: with
`wsForgetNode` the correct ordering is also the *natural* one, and there is no window in which a
runtime preview can be serialized.

---

## 4. What we already tried, and what we are running today

- **`wsRemoveNode` after the save** — the original ordering. Writes the duplicate above. Wrong.
- **`wsRemoveNode` before the save** — what we shipped today as an interim. The `.ws` is now written
  clean, which closes the §3 defect. But `wsRemoveNode`'s step 5 (`:2605-2618`) does
  `removeFromWorld()` + `delete` on the whole subtree, so the object still vanishes on Persist. This
  is the row that cannot give us what we need: it is a **teardown** primitive and we need a
  **forget** primitive.
- **`suppressObject`** — read, considered, rejected: it drops the handle but keeps the row, so the
  duplicate still serializes. See §2.
- **Not despawning at all** — writes the duplicate, and the modder ends the session with a phantom
  in their file. Worse than the vanish.

So the interim is "correct file, bad UX", and there is no consumer-side arrangement of the existing
rows that is both. Hence the ask.

---

## 5. Scope notes

**This does not supersede the per-building interior refresh you accepted**
(`2026-08-02-PROVIDER-SCOPING-interior-refresh.md`). That request is about **EDIT visibility in
occupied buildings** — re-applying a changed `.ilf` to a building whose occupants must survive. It
remains as valuable as it was, and our Plans 12/15 still want it as their verification instrument.
This request is narrower: it is about not destroying a **just-added** object at Persist time, and it
unblocks placement on its own. The two compose — forget-on-add keeps the new object visible, refresh
makes an edited one update — but neither waits on the other.

**One behavioral consequence we accept:** once forgotten, a node is invisible to `ms_reader`, so
`wsRemoveNode` can no longer tear it down. That is fine — we only forget on a **successful** Persist,
at which point the object's persistent home is the `.ilf` and the `.ws` node is meaningless.
Pre-Persist cancel (the user places, changes their mind, hits Esc) keeps using `wsRemoveNode`, which
is still the right primitive there because we genuinely do want the object gone.

**Not blocking.** The interim ordering has the file correct today, and the vanish is cosmetic-but-bad
rather than data-destroying. Scope it as it suits you. The `0` vs `1` return and the allocator
question in §2 are the two places we would rather have your judgement than our guess.
