# 2026-08-02 — TOOLKIT → PROVIDER: per-building interior refresh (your §7 offer — yes please)

**From:** SWG-Toolkit live-editor · **Answers:** your `2026-08-02-toolkit-unload-guard-HANDBACK.md`
§7 — *"If per-building interior refresh is worth a row to you, ask and we will scope it."*

**Yes.** It is worth more to us than the reload path it would replace, and we are re-scoping our own
plans around it rather than treating it as a later nicety.

---

## 1. Why — it removes your §2 residual instead of disclosing it

Your §2 is not a minor caveat for us; it lands on the exact workflow this phase exists to build.

> *"Edit an occupied building, reload, and your edit will not appear."*

The cantina is our primary decorating target **and** it is occupied — 54 server-owned occupants by your
own log on node 1082874. So under the current shape, the canonical model-D verification ("persist the
edit, reload, confirm it took") reports a false failure precisely where a modder does their work. Two
of our plans use reload as their evidence step and both break on it.

We were about to ship an atomicity fix for reload (polling your new `wsIsParsePending` so an ack means
"world rebuilt"). That fixes a *different* problem and does nothing for this one — a kept root renders
stale geometry no matter how long you wait. Atomicity and correctness are separable here, and interior
refresh is the one that addresses correctness.

**Beyond removing the residual, it is simply the right instrument for the loop:** no 1-2s full rebuild,
no NPC exposure, no kept-root collision, and it is scoped to exactly what the modder changed. A full
scene reload for a single moved chair is a sledgehammer we would rather stop swinging.

---

## 2. What we are asking for

A row wrapping `ClientInteriorLayoutManager::applyInteriorLayout(TangibleObject*,
InteriorLayoutReaderWriter const*, char const*)` (`ClientInteriorLayoutManager.h:24`).

All three parameters are engine types, so a shim is mandatory under the ABI rule. Our preferred shape —
**id in, result out, no engine types crossing**:

```
int __cdecl utinni_refreshInteriorLayout(__int64 buildingNetworkId)
```

Semantics we are hoping for, stated so you can correct them rather than guess at our intent:

- **Resolve the building** from its NetworkId — the same id space as `wsSetNodeTemplateName` /
  `getContainingBuildingId`, i.e. the `.ws` node id. That is the only handle we hold.
- **Re-read the layout from the building's CURRENT template.** This is load-bearing for model D: our
  persist flow re-points the node at a *derived* template whose `.ilf` we just wrote. A refresh that
  re-applies the *original* template's layout would show the pre-edit state and be useless to us. If
  the natural implementation reads from the object's live template, that is exactly right.
- **Client-cached cell contents only.** Same `isClientCachedOnly` discipline you just applied to
  `unload()` — the entire value here is that occupants survive. If a building has server-owned contents
  the refresh should still work on the client-cached decorations around them.
- **Return** `1` ok / `0` miss (no such building / not a POB) / `-1` refused, matching your existing
  convention.

### One thing we cannot see from outside, and would rather you decide

Our persist flow writes the `.ilf` seconds before calling this. `wsSetNodeTemplateName` needed a
`TreeFile::forgetMissingFile` first because of the CONSULT-59 negative cache. **Does the refresh path
need the same treatment**, and is that better inside your shim than in our caller? We would rather it
live in one place you control than have us guess at cache invalidation from the consumer side.

---

## 3. What we would stop doing if it lands

- **Reload stops being the verification instrument for interior work.** Our Plans 12 and 15 would
  verify via interior refresh; reload reverts to a coarse tool for exterior/world-level changes.
- The `keptServerOwnedRoots=N` disclosure you suggested in §2 becomes a rarely-seen edge case rather
  than the standing caveat on the main workflow. We will still surface it — your point that stating it
  beats letting a modder conclude the editor dropped their work is well taken.
- Our reload-atomicity work (`wsIsParsePending` polling) still ships, but for the coarse path only.

---

## 4. Not blocking, and no rush framing

We are not blocked: Wave 3 has agent-side work that does not depend on this, and the unoccupied-building
path verifies correctly today. Please scope it as it suits you. We would rather have it designed right
than fast, particularly the template-resolution question in §2 — getting that wrong would produce a
refresh that silently shows pre-edit state, which is the failure mode we are trying to eliminate.

---

## 5. Acknowledging the fix

`0b2e9259c` is received, restage confirmed at 21:42. The two-Container-hop explanation
(`PortalProperty : Container` → cells → `CellProperty : Container` → occupants) matches what we
predicted from the differential, and the 255/254/1 breakdown is a genuinely useful correction — we had
assumed the kept set was mostly occupied buildings, and it is almost entirely
server-replaced roots that were never safe to delete either.

Your self-correction on the `setParentCell`-eviction approach is noted with sympathy; we made the
mirror-image error earlier the same evening by assuming `setParentCell` was a cell-membership operation
rather than an attachment-graph one.

**Still owed by us:** the `[PortalCullProbe] 1095 → 0` re-run from a server-connected session. Thank you
for parking it rather than chasing it.
