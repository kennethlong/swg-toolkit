---
created: 2026-08-07
source: provider handback 2026-08-07-PROVIDER-HANDBACK-editor-scene-rearm.md §5 — flagged by the provider, ours to fix
severity: low (papercut on an uncommitted action — NOT data loss of persisted work)
---

# `Reload scene` discards in-flight edits with no warning

## ⚠ Scope first — the provider's phrasing overstates this for OUR flows

Their §5 warns that "every unpersisted `wsAddObject` / `wsSetNodeTemplateName` / moved transform
lives in `ms_reader` until `wsSaveSnapshot`". True of the **engine**. Not an accurate description of
the toolkit's persist path, which was checked at the call-site level rather than accepted:

- **`wsSaveSnapshot` has exactly ONE call site on our side** — `overlay.cpp:707`, inside
  `applyPendingRebind`'s rebind-apply branch. Every Persist writes the `.ws` to disk immediately.
- **The loose `.ilf` files land even earlier** — `decorationPersistOrchestrator` writes them to the
  override dir *before* it sends the REBIND.

So **nothing persisted is ever at risk.** A Persist is on the spot, not deferred.

## What IS at risk

In-flight work only, i.e. state between an action and its Persist:

1. A decoration **placed but not yet persisted** — `wsAddObject` mints a preview node that lives in
   `ms_reader` until Persist forgets it (`wsForgetNode`) and saves.
2. A decoration **armed and dragged but not yet persisted** — a live object transform with no disk
   write behind it yet.

Both are things a user would reasonably expect a scene reload to discard. The gap is that we don't
*say so*.

## The fix — targeted, not a blanket confirm

An always-on confirmation would be over-engineered: most `Reload scene` clicks have nothing in
flight and would train the user to dismiss it, which is worse than no dialog.

We already track exactly the state that matters:

- `g_capArmed` (agent) — an edit is armed
- `g_placementActive` / `g_placementSpawnedId` (agent) — a placement preview is live
- the renderer's pending-placement lock (Plan 14's ack protocol)

So: warn **only** when one of those is set, naming what will be lost ("a placement you haven't
persisted yet"). With nothing in flight, no prompt at all.

The agent-side halves are not currently published to the renderer. Cheapest route is likely a single
"edit in flight" bit on the existing CAPTURE/status region rather than three new fields — see how
`g_lastRebindMirrorOff` is stashed and read for the shape.

## Why it is LOW priority

- Nothing persisted can be lost.
- The reload is **no longer required for correctness** — the provider's same-scene re-arm fix
  (2026-08-07, verified live) means an editor scene comes up fully populated without it, so the
  button gets pressed far less often than it did during 05.1.
- Comparable tools (SwgGodClient, Utinni) expose the same rebuild as an explicit user action with no
  guard at all; Utinni's `unloadSnapshot()` is a bare pass-through.

Related: [[reference-live-sync-liveness-and-poll-loop]], and the placement/ack protocol in Plan 14.
