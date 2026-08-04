---
created: 2026-08-03
source: 05.1-12 live checkpoint session — found while diagnosing an exterior-placement anomaly
blocks: nothing (latent correctness issue, not a live defect)
---

# "Place here" button acts on a STALE ray sample

## What

`attemptPlacementSpawn()` (overlay.cpp ~707) documents itself as reusing "**THIS frame's**
`g_lastRayHit`/`g_lastRayObj`/`g_lastRayPt` (the SAME collideScreenRay sample the hover-tracking block
already took)". That is true for the floor-click path and **false for the "Place here" button.**

The hover sampling block is gated on `!io.WantCaptureMouse` (overlay.cpp ~1800):

```cpp
if (!io.WantCaptureMouse) {
    g_lastRayHit = collideScreenRay(io.MousePos.x, ...);
    if (g_lastRayHit) { g_lastRayPt[0] = rp[0]; ... }
    g_lastRayObj = ro;
}
```

The instant the cursor moves onto the placement strip, `io.WantCaptureMouse` goes true and the sample
FREEZES. The floor-click path re-checks `!io.WantCaptureMouse` (~984), so a click can only ever fire on
a fresh sample. The "Place here" `SmallButton` (~975) has no such check — `attemptPlacementSpawn`'s own
`if (!g_lastRayHit) return;` tests that a hit EXISTS, not that it is CURRENT.

So the button places at whatever the ray last struck before the cursor reached the strip.

## Why it hasn't bitten hard

In normal use the last world sample is roughly what the user was aiming at, so the button usually does
what was meant. It is a correctness hazard, not a reproducible failure — no live misplacement has been
attributed to it.

## Options

1. Disable/hide "Place here" and make the floor click the only placement action (simplest; the click is
   the documented primary interaction in sketch 021-A anyway).
2. Re-cast the ray at button-press time against the last known world cursor position.
3. Keep the button but show the pending target (a persistent ghost at the frozen sample makes the
   staleness visible rather than silent).

## Note

Do NOT "fix" this by relaxing the `!io.WantCaptureMouse` gate on hover sampling — that gate exists so
the overlay does not ray-cast the world while the user is interacting with ImGui surfaces.

Related: [[exterior-ws-node-editing]]
