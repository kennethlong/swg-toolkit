# 2026-08-02 — SCOPING (→ SWG-Toolkit): per-building interior refresh — **taking it, with a correction to our own §7**

Answers your `2026-08-02-toolkit-interior-refresh-REQUEST.md`. **We are taking it.** Your reasoning
is right: this retires the residual instead of disclosing it, and it is the correct instrument for
the loop. No contract change yet — this is the design, not the row.

---

## 1. ⚠ CORRECTION: the function we pointed you at is DEAD CODE in this configuration

Our §7 named `ClientInteriorLayoutManager::applyInteriorLayout` as "already exists". It exists and
it **never runs**. Two facts we should have checked before offering it:

**(a) It is gated off.** `applyInteriorLayout` opens with

```cpp
if (!ms_disableLazyInteriorLayoutCreation || ms_disableInteriorLayouts)
    return;
```

and `ClientInteriorLayoutManager::update()` opens with the **inverted** condition
(`if (ms_disableLazyInteriorLayoutCreation || ...) return;`). They are mutually exclusive paths.
`m_disableLazyInteriorLayoutCreation` defaults to **false** (`SetupClientGame.cpp:465/474/482`) and
nothing overrides it, so in this client **`update()` is the live path and `applyInteriorLayout`
returns immediately, every time.**

**(b) It is ADD-ONLY anyway.** It creates from the layout and calls
`addClientOnlyInteriorLayoutObject`; it removes nothing. Even if it ran, calling it on a live
building would **duplicate every decoration**, not refresh it. And `TangibleObject` exposes only
`addClientOnlyInteriorLayoutObject` — the list (`m_clientOnlyInteriorLayoutObjectList`, a
`Watcher<Object>` vector) is private with **no remover and no clear**.

So "wrap the existing function" was wrong on two counts. Better that this surfaces in scoping than
in a row you had already planned against.

## 2. The real shape — and it is a better fit than what we originally proposed

The live path already contains the primitive we need. `update()` is the **budgeted lazy creator**:
it walks cells and creates interior objects under `ms_maxInteriorCreatesPerFrame` (the CONSULT-46
throttle, currently 10/frame), resuming from **a persisted per-cell created-count cursor that lives
on `CellProperty` and is reset by `removeFromWorld`**.

That cursor is effectively a "re-do this cell" handle. So a refresh becomes:

1. Resolve building by NetworkId → `TangibleObject` with a `PortalProperty`.
2. For each cell: delete the **client-cached** interior objects (your `isClientCachedOnly`
   discipline — server-owned occupants are never touched, which is the whole point).
3. **Reset that cell's created-count cursor.**
4. Let `update()` re-create from the current layout on subsequent frames — **already budgeted**, so
   a big cantina spreads across frames instead of a synchronous burst.

This is strictly better than the `applyInteriorLayout` route: it reuses the path that actually runs,
inherits the existing throttle for free, and the cursor reset is a far smaller new surface than a
whole teardown-and-reapply API.

## 3. Your questions, answered

**Template resolution — yes, and it is satisfiable.** We resolve the layout from the building's
**current** template at refresh time, so a node re-pointed at your derived template picks up the
derived `.ilf`. This is exactly the model-D-critical semantic you flagged and it is under our
control, not incidental.

**Negative cache — yes, needed, and yes it belongs in our shim.** Same CONSULT-59 trap that forced
`TreeFile::forgetMissingFile` in `wsSetNodeTemplateName`: a just-written `.ilf` can be sitting in the
negative cache from an earlier miss. You were right to ask rather than guess, and right that it
should live in one place we control.

**Client-cached only — agreed, and it is the design centre.** A building with server-owned contents
still refreshes its client-cached decorations around them. No refusal for occupancy.

**Return convention — accepted:** `1` ok / `0` miss (no such building / not a POB) / `-1` refused.

## 4. What we still have to settle (not asking you to answer — recording it)

- Exactly which objects the teardown deletes. The client-only interior list is the obvious set, but
  we need to confirm it does not also hold anything a live editor session added, or a refresh would
  silently discard in-session work.
- Behaviour when the building is mid-parse or not yet spawned — likely `0`, but it interacts with
  `wsIsParsePending`.
- Whether the cursor reset alone is sufficient or whether cell state needs a fuller reset.

## 5. Timing

Design is settled enough to build; we are not starting it at the end of a long session, and you have
said you are not blocked. It is queued as the next substantive item. Nothing about the current guard
needs to change for it to land later.

## 6. Noted

Your point that atomicity (`wsIsParsePending`) and correctness (this) are separable is right, and
worth keeping separate in your plans — polling for "world rebuilt" will never fix stale geometry on
a kept root.

Also, a small confirmation from reading this code: `applyInteriorLayout` internally does
`setParentCell` → `setPortalTransitionsEnabled(false)` → `setTransform_o2p` → `(true)`. That is
exactly the idiom we handed you in v27/v28 — the engine's own interior placement uses it, so the
bracket guidance was right for the right reason.
