---
created: 2026-08-02
source: 05.1-09 live checkpoint — remote RELOAD_CURRENT_SCENE acked code=1 but left the world degraded
affects: Plan 05.1-12 (ADD verification uses reload), Plan 05.1-15 (sign-off uses reload), any "reload to see your change" workflow
severity: high — silently invalidates a verification step several plans depend on
---

# "Reload current scene" is LOSSY — objects come back as un-registered ghosts

## Observed (maintainer, live, 2026-08-02)

Remote `RELOAD_CURRENT_SCENE` acked `code=1`. The scene did reload. Then:

- **Most buildings were GONE** — the cantina simply was not there.
- **Collision was gone too** — able to run straight through where walls should be, up to NPCs
  (the creature trainer) known to be behind them.
- **NPCs were fine throughout** — they came back immediately (server-streamed, not snapshot nodes).
- **Snapshot creatures did NOT** — banthas, dewbacks were missing alongside the buildings.
- **After running around for a while, everything popped in AT ONCE** — "like I crossed a portal
  boundary" — and, decisively, *"the banthas came back as well when the buildings came back"*. One
  restoration event for the whole snapshot set, not several.

An ack of `code=1` is therefore NOT evidence the world is intact. The agent truthfully reports that
the engine call was made; it says nothing about the resulting world state.

## Mechanism (strongly indicated, not yet proven)

Our reload is the whole of it — `overlay.cpp`, "Reload current scene":

```cpp
if (swg::endpoints::wsUnloadSnapshot) swg::endpoints::wsUnloadSnapshot();
swg::endpoints::wsLoad(scene);
```

Utinni's equivalent layer binds several things we never call
(`../Utinni/UtinniCore/swg/scene/world_snapshot.cpp`):

| Symbol | RVA | Why it likely matters |
| --- | --- | --- |
| `getNodeSpatialSubdivisionHandle` | `0x00B97390` | spatial/render/collision registration per node |
| `setNodeSpatialSubdivisionHandle` | `0x00B973A0` | ditto — Utinni manipulates these explicitly (:449-459) |
| `removeFromWorld` | `0x00B97440` | world de-registration distinct from snapshot removal |
| `unload` | `0x0059C1D0` | note at :162-163: *"unload resets the sticky ms_sceneName so reload isn't empty"* |
| `clearPreloadList` | `0x00404D50` | preload state, alongside a `0x191113C` preload flag |

Utinni's own comment records that they hit a reload-comes-back-wrong problem and needed more than
unload+load to fix it. "Objects exist but are invisible AND non-colliding until a later spatial pass
picks them up" is consistent with skipping the spatial-subdivision / preload steps.

### A buildout hypothesis was considered and is RULED OUT by follow-up evidence

Initial reasoning: Tatooine has 68 v2 buildout tables and `saveFiltered` excludes buildout NODES from
the authored snapshot (`.planning/handoff/2026-07-31-PROVIDER-NOTE-ws-size-drift-CLOSED.md`), so
`wsLoad` restoring only the authored snapshot could explain missing open-world buildings.

**Falsified by the maintainer's follow-up: "the banthas came back as well when the buildings came
back."** Buildout-sourced and authored content would be restored by different mechanisms and would not
reappear in the same instant. Everything missing returned together, in one step.

That leaves ONE mechanism, and it is the simpler one: every SNAPSHOT-sourced object (buildings,
banthas, dewbacks alike) was left un-registered in the render/collision world by the reload, and a
single later spatial pass re-registered the whole set at once. NPCs were never affected because they
are server-streamed rather than snapshot nodes — which is exactly the split observed.

Do not spend time on the buildout path; the spatial-registration/preload sequence above is the lead.

## Why this matters well beyond cosmetics

1. **It invalidates a verification step several plans depend on.** Plan 05.1-12's ADD checkpoint says
   *"Trigger 'Reload current scene'. Confirm exactly ONE instance of the new object is visible — not
   zero, not two"*, and repeats it for a second cycle. Plan 05.1-15's sign-off likewise reloads to
   confirm a rotation persisted. If reload leaves ghosts, **an object that persisted correctly can
   read as missing**, and a verifier would report a false failure — or worse, "fix" a non-bug.
2. **Collision loss breaks placement.** Plan 05.1-12's click-to-place resolves the container from
   `collideScreenRay` at the click point. With building collision unregistered, a click that should
   hit a cell floor hits terrain (or nothing) and resolves to building id `0` — which, under the
   2026-08-02 revision, now correctly REFUSES. So placement immediately after a reload will refuse
   legitimate interior clicks until the world re-registers. Correct behavior, confusing symptom.
3. **An interior decoration cannot render if its building did not come back.** A "did my edit
   persist?" check performed right after a reload is measuring the wrong thing.

## Guidance until fixed

- **Do NOT treat a reload as a clean-world checkpoint.** A full scene load (editor scene, or relaunch)
  goes through `cleanupScene` + `loadScene` and is the reliable path.
- If a reload IS used, move around first and confirm buildings/collision have re-registered before
  concluding anything about persistence.
- Reword the affected checkpoint steps in Plans 12 and 15 to say so, rather than leaving a verifier to
  discover it mid-sign-off.

## Not fixed here

Pre-existing: the "Reload current scene" button is Slice-0 code; Plan 05.1-09 only exposed it
remotely, and its ack behaviour is correct (the call WAS made). Fixing the reload sequence means
binding and sequencing the Utinni symbols above, which is its own scoped piece of work with a live
verification loop.
