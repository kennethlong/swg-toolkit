# PROVIDER HANDBACK (← swg-client-v2): wsSetNodeTemplateName authored-node MISS — FIXED (engine erased authored rows on server replacement)

**Date:** 2026-07-30 night · **From:** swg-client-v2 · **To:** SWG-Toolkit live-editor.
**Answers:** your `2026-07-30-CHANGE-REQUEST-wsSetNodeTemplateName-authored-lookup.md` + MISS-REPORT.
**Status:** DONE same-night, build-gated + boot smoke, exe restaged (`stage/SwgClient_r.exe`,
2026-07-30 21:01:13 local). **No contract change — still v25 / 147 names** (behavior-only fix;
no re-sync, no rebind needed — same advertised name, MISS→hit flip as you predicted).

## 1. Root cause — your evidence was right, the mechanism was one layer deeper

The lookup was never live-keyed: `find()` searches the authored `m_networkIdNodeMap`, populated
with EVERY authored node at parse. Your byte-verified paradox (node in the file 54s before the
MISS) convicted something *erasing* the row mid-session:

**The SceneCreateObject handler (GroundScene):** when the server streams an object whose id
already exists as a client-cached snapshot spawn — exactly a static POB near the player, on any
hybrid session — it deletes the client copy and called `WorldSnapshot::removeObject(id)`, which
tombstoned AND erased the authored node from the reader map. From that moment, for the rest of
the session:

- `wsSetNodeTemplateName(id)` → MISS (your defect);
- `wsSaveSnapshot` silently DROPPED that authored building + cells from the saved .ws
  (tombstone-skip) — latent data-loss you hadn't hit yet;
- the id allocator's map-miss free-test saw the still-authored id as free (latent collision hole).

Timing fits your log exactly: save-on-load fires at parse completion (row still present), the
server's create lands seconds later, every rebind after that MISSes — and again after every
wsUnload/wsLoad cycle (the server re-replaces each time).

## 2. The fix

New engine-internal `WorldSnapshot::suppressObject(id)`: removes the node's sphere-tree handle
(the entire re-create prevention) but leaves the authored row in the map, un-tombstoned. The
server-replacement path calls it instead of `removeObject` (the advertised `removeObject` row's
semantics are unchanged). Editor-removed (`wsRemoveNode`) ids still MISS — tombstone semantics
per spec, as you accepted.

The MISS log text is corrected too: `(not in authored map -- unknown id or editor-removed)` —
"(no live node)" was wrong and misled us both.

## 3. Secondary ask — self-test hook

It was already config-gated default-off; the writes came from the armed key
`[ClientGame/WorldSnapshot] wsSelfTestSaveOnLoad=1` in `stage/client.cfg` (armed 2026-07-19 for
the Goal-B save gates, long green). **Disarmed.** No load mutates the override dir now.

- Your resurrected `stage/override/snapshot/tatooine.ws` is untouched — it still shadows stock
  with drifted content; consider deleting it to return to a stock baseline until a REAL save.
- The per-cycle size drift (1,380,222 → 1,400,231) is accepted as a real open item on our side
  (suspects: OTNL intern accumulation, cell-expansion rows). It does not block the rebind loop.

## 4. ⚠️ Expectation for the end-to-end smoke (hybrid vs editor scene)

On a HYBRID server session the server re-streams the building on every approach and its copy
supersedes the client-cached spawn — so even after rebind + save + reload, the **visible**
interior on a hybrid session is the SERVER's (stock). The authored edit persists in the .ws
(and re-saves keep it, now that suppression preserves rows), but to SEE the derived template +
edited .ilf spawn, verify on an editor scene (`game::loadScene`) or any context where the
snapshot layer actually spawns the building. Rebind OK / save OK / byte-verify are
session-independent.

## 5. Suggested smoke

1. Tonight's exact repro: hybrid session, cantina, hover decoration → Arm → rebind. Expect
   `[editor.ws] wsSetNodeTemplateName OK: id=1082874 <stock> -> <derived>`.
2. `wsSaveSnapshot` → byte-scan: building row carries the derived template AND the building did
   not vanish from the save despite the server replacement (the §1 data-loss fix).
3. Editor-scene reload → edited interior visible, subtree intact, other instances unchanged —
   the full model-D close-out.

_(Provider-side record: `swg-client-v2/.planning/handoff/2026-07-30-toolkit-wsSetNodeTemplateName-authored-fix-HANDBACK.md`.)_
