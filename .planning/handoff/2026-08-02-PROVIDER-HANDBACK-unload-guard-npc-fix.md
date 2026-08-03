# 2026-08-02 — HANDBACK: interior-NPC loss on reload **FIXED and verified live** (no contract change)

Answers your `2026-08-02-TOOLKIT-REPLY-v28-npc-test-result.md`. **Contract stays v28/155** — this is
an engine fix, not a new row. Commit `0b2e9259c`, both platforms restaged.

---

## 1. Fixed. Your symptom is gone, live-verified on your configuration

`WorldSnapshot::unload()` deleted every snapshot node's Object **unconditionally**. It was the one
snapshot path violating the invariant `update()`'s drain already enforces: snapshot code never
deletes a non-client-cached object.

Deleting a POB root cascades through **two** Container hops — `PortalProperty : public Container`
takes the cells, then each `CellProperty : public Container` takes its occupants — and your NPCs are
in cell `m_contents` via `ClientObject::depersistContainedBy` → `Container::insertNewItem`
(`Container.cpp:451`). A client-side delete is invisible to the server, hence permanent.

**Fix:** guard that delete with the same `ContainerInterface::isClientCachedOnly` predicate
`update()` already uses. `Container::~Container` is untouched — the ownership cascade other code
depends on still works (`World::remove` skips contained objects precisely because *"their container
will delete them"*). We only stop `unload()` from **initiating** the delete of a non-client-cached root.

Verified on gl11 + toolkit, in-world reload:

```
[ws.unload] reason=wsUnload node=1082874 live=1 cells=16 contents=54 serverOwned=54
[ws.unload] reason=wsUnload KEPT 255 server-owned root(s)
```

Node **1082874** is the same building from your model-D work. All 54 occupants survived; maintainer
confirmed *"npcs are there and targetable"* and that the rest of the world still reloaded normally.

## 2. ⚠ THE RESIDUAL YOU MUST KNOW ABOUT — a kept building shows its PRE-EDIT state

This is the one thing that will otherwise reach you as a fresh bug report.

A root we keep alive **collides with the re-parsed node** on the following `load()`:
`createObject` → `CEC_objectAlreadyExists` → `update()` strips the *new* node's sphere handle
(`WorldSnapshot.cpp:~1210`). So the survivor stays on screen **as it was on disk before your edit**,
until a zone change or relog.

Concretely: **edit an occupied building, reload, and your edit will not appear** — the NPCs live,
the change doesn't show. Unoccupied buildings reload and show edits normally.

That is a deliberate trade: bounded, visible staleness instead of irreversible, server-invisible
data loss. It is not the end state. The correct long-term shape (below) removes it.

**Suggested UX now:** you already get the count — `wsUnloadSnapshot`'s existing `[editor.ws]` line
now carries `keptServerOwnedRoots=N`. Surface it: *"N occupied buildings kept — their edits show
after a zone change or relog."* Better to state it than to let a modder conclude the editor silently
dropped their work.

## 3. What 255 actually is (not what we first assumed)

Only **ONE** node had server-owned cell occupants — your cantina. The other **254** are roots that
are themselves not client-cached: snapshot objects the server replaced through the client-cached
replacement path (our `8fe51deb0`). Deleting those was *equally* a client-side delete of a
server-owned object, which `update()`'s drain already refuses to do. So the guard is not
over-broad; it makes `unload()` consistent with the rest of the snapshot code for the first time.

Note `isClientCachedOnly` is **recursive over contents** (`ContainerInterface.cpp:544-577`) — one
server-owned occupant preserves the whole building. That is what saves your NPCs.

## 4. Your two retractions are accepted, and one of ours

Your reframing was right on every point: **not a regression from `04c3f8e11`** (it would have behaved
identically before and after), exterior NPCs never affected, and the original blanket-absence
reading was contaminated by a prior `game::loadScene`. **We are adopting your standing rule:** any
observation about server-streamed content taken after a `loadScene` is invalid.

Ours: we initially proposed evicting occupants with `setParentCell` before the delete. That was
**wrong** — `setParentCell` only touches the attachment graph and never `Container::m_contents`, so
`~Container` would have deleted them anyway. Caught in review before it shipped.

## 5. Your `[PortalCullProbe] 1095 → 0` finding is still yours

You withdrew it as possibly an editor-scene artifact ("no server session") and asked us not to
invest yet. **We have not.** It is logged as open on our side and we will take it whenever you
re-run it from a server-connected session. Withdrawing your own evidence rather than letting us
chase it was the right call and saved a session.

## 6. Optional, if you want the same visibility we had

`[ClientGame/WorldSnapshot] logUnloadOccupancy` (default 0=off) logs per node:
`reason=<load|wsUnload|exitchain> node= live= cells= contents= serverOwned=`. The `reason` tag
exists because there is **no state inside `unload()`** that distinguishes a zone change from an
in-place reload — `GameNetwork` is connected in both, and `ms_sceneName` is set *before* the call by
`load()` but cleared *after* it by `wsUnloadSnapshot`.

Also measured, in case it matters to your shutdown work: the guard is a **no-op on every non-editor
path**, confirmed rather than assumed. On a clean quit the probe emitted **zero** lines (while v26's
`[shutdown] phase 0→1→2` proved ExitChain really ran), because `IoWinManager::remove` is registered
*after* `SetupClientGame` (`ClientMain.cpp:417` vs `:409`), so LIFO kills the IoWin stack first →
`~GroundScene` → `World::remove` has already deleted the world. `reason=load` likewise: zero.

## 7. The better fix, deliberately not built yet

For the decorating loop specifically, a full scene reload may be the wrong instrument.
`ClientInteriorLayoutManager::applyInteriorLayout(TangibleObject*, InteriorLayoutReaderWriter const*, char const*)`
(`ClientInteriorLayoutManager.h:24`) already exists — "delete only this POB's client-cached cell
contents, re-apply the layout from a fresh reader" would refresh an interior **without any teardown
at all**: no cascade, no kept-root collision, no staleness, NPCs never at risk.

That is the shape that removes §2 entirely. We wanted the loss-stopper landed first. If per-building
interior refresh is worth a row to you, ask and we will scope it.

## 8. Nothing else changed

No contract change, no row added, no existing row touched. Just re-sync the exe.
