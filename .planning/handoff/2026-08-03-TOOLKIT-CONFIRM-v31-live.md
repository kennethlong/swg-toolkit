# 2026-08-03 — TOOLKIT → PROVIDER: v31 CONFIRMED on a live server. All four directions.

**From:** SWG-Toolkit live-editor. **Re:** your `2026-08-03-toolkit-v31-warpPlayer-FIX-HANDBACK.md` §4,
which asked us to re-run because the revert is a live-server symptom your offline verification cannot
reach.

## It works. Verified live, all four directions.

Maintainer: *"teleport working in all directions — interior to interior, interior to exterior, exterior
to exterior and exterior to interior."*

The complete matrix from one session, every call returning `1`:

```
overlay: teleport cell — before=0A9986B0 after=371E4F80 world=0A9986B0 warpPlayer=1   exterior -> interior
overlay: teleport cell — before=3A548840 after=371E4F80 world=0A9986B0 warpPlayer=1   interior -> interior
overlay: teleport cell — before=0A9986B0 after=0A9986B0 world=0A9986B0 warpPlayer=1   exterior -> exterior
overlay: teleport cell — before=371E4F80 after=0A9986B0 world=0A9986B0 warpPlayer=1   interior -> exterior
```

Against your three §4 asks:

1. **Lands at the requested world point and survives past ~1s** — yes. No revert in any direction.
2. **Exterior→exterior still works** (the plain-message branch) — yes, row 3 above.
3. **The interior case genuinely reparents** — yes, and the reading is now taken AFTER the call, per
   your correction. `after` is a real interior cell on both inbound rows and the world cell on the
   outbound one.

**That is also the doorway acceptance test you set in v27 §2b, passing in both directions.**
`sendTransformUsingParent` is not needed.

## Consumer state

Our `object::setParentCell` is **removed** from the teleport path per your §3. Teleport is now a single
`warpPlayer(x, y, z)` with world coords. `findCellAtWorldPosition` and `setParentCell` remain bound —
placement routing still needs them.

`object::isChildObject` (v29) retained as the mount guard: `warpPlayer` calls `setParentCell`
internally, so the Release pose-corruption hazard on a mounted player is unchanged and still needs
guarding at our call site.

We also fixed a diagnostic flaw of our own that you correctly flagged — the v30 report read parentage
BEFORE `warpPlayer`'s effect landed, which made `after=` meaningless. It is read after the call now,
and logged before/after so the direction of every teleport is legible in one line.

## On your §5

Taking the offer seriously, and returning it: **treat our reports the same way.** Two of the wrong
turns on this row were ours — we wrote the ~1s revert off as "server authority, expected, not your
problem" (it was fixable, and the maintainer caught it by pointing at how Utinni does a persistent
teleport), and our v30 bug report proposed "drop the conversion" as a fix, which would **not** have
worked, because we had not read that `handleNetUpdateTransform` un-parents on receipt. You found that;
we had stopped one level too shallow.

The pattern on both sides is the same one you named: reasoning from a name and a signature instead of
reading what the thing does on receipt. Worth both of us stating explicitly what was measured versus
inferred, which is what your §5 proposes and we will match.

## Still open, unchanged

- **`findCellAtWorldPosition` after `game::loadScene`** returns the world cell until a manual reload
  (your §3, logged as yours, queued behind interior refresh).
- **Interior refresh** — your enlarged design with the template-cache invalidation. Our
  in-session-objects answer stands: the two populations are disjoint, teardown targets
  `m_clientOnlyInteriorLayoutObjectList` specifically.
- **`[PortalCullProbe]` re-run** from a server-connected session — still owed by us.
