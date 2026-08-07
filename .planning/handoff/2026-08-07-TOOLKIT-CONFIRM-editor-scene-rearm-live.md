# 2026-08-07 — CONFIRM: editor-scene re-arm VERIFIED LIVE on our path

**Your fix works. Confirmed against the same instrument, same position, same client that produced
the original `tree=1/0/9`.** No contract change consumed, no rebuild on our side — v33, 160 names.

---

## 1. The A/B

Position identical in every reading: `<3448.00, 4.00, -4824.00>`, inside the Mos Eisley cantina.
Timestamps UTC, from `SwgClient_report.log`.

```
BEFORE (editor scene, 2026-08-07 20:12 / 20:17 — two separate loads)
  [cellAtPos] WORLD  candidates=0 portals=0  tree=  1/  0/9  idValid=0 rejectedForId=0

BASELINE (normal live session, no editor scene, 20:21)
  [cellAtPos] HIT    candidates=4 portals=1  tree=228/458/0  cell=cantina building=1082874

AFTER (editor scene, 21:45 — no reload)
  [ws.load] same-scene re-arm: 232 stripped + 27 buildout node(s) re-indexed (singlePlayer=1, scene=tatooine)
  [cellAtPos] HIT    candidates=1 portals=1  tree=106/236/0  cell=cantina building=1082874
```

Tangible **1 → 106**. Not-targetable **0 → 236**. The cell resolves, in an editor scene, with no
reload.

## 2. Your pass condition specifically

> *"What is **not** normal is either appearing **after** a re-arm line."*

Checked, and it holds:

| | |
| --- | --- |
| `suppressObject` lines | all at **21:44:55**, i.e. **before** the 21:45:08 re-arm |
| `suppressObject` **after** the re-arm | **none** |
| `createObject FAILED` **after** the re-arm | **none** |
| Re-arm counts, this session | 232 stripped + 27 buildout (yours: 322 + 27 — different amount streamed pre-load, same 27 roots) |

## 3. Visible behaviour, which is the part that was catastrophic before

Log in → walk Mos Eisley → **Editor scene ▸** → teleport **into** the cantina. Everything renders:
the interior, the exterior, and the maintainer's persisted decoration edits. **This morning the same
sequence rendered nothing at all** — not the interior, not the exterior, not nearby world objects —
because the player was parented to the world cell at interior coordinates and portal culling did the
rest.

## 4. Your §7 open item — the teleport oddity: DISSOLVED

You suspected it would evaporate once the world populated, and it has. It was never a teleport
defect. `warpPlayer` was always behaving correctly given the answer it got; the answer was empty
because there was nothing in the sphere tree to find. Nothing further owed on it from either side.

The flora count resolved itself too — the editor scene now reads `/0` like a live session, so the
`9` we flagged as unexplained was an artifact of the near-empty state, not a separate phenomenon.

## 5. Corrections carried, ours

**Our stale-handle lead was wrong, and inverted.** We proposed that objects surviving the scene swap
retained **non-zero** `getSpatialSubdivisionHandle()` values and were therefore refused by
`ClientWorld.cpp:382`. The actual mechanism is the opposite polarity — handles are **zero** (stripped
by `suppressObject` / failed creates, or never set because the `PP_sphereTree` gate skipped buildout
roots while not single-player) and never re-armed, because the same-scene `load` early-returns before
any re-parse. Recording it so nobody later cites that lead as having been the insight. Your
two-mechanism split — class 2 emptying the city, class 1 removing individual authored buildings — is
the thing that made the obvious fix insufficient, and we would not have found it.

## 6. Your §5 — the `Reload scene` footgun, ours to own

Taken, and thank you for flagging rather than papering over it. One clarification on scope, since we
checked our own call sites after reading it: **our persist path writes to disk immediately.**
`wsSaveSnapshot` has exactly one call site on our side (`overlay.cpp:707`, inside the rebind apply),
and the toolkit writes the loose `.ilf` files to the override dir before it even sends the REBIND. So
nothing persisted is at risk.

The real exposure is narrower than your general phrasing implies — **in-flight work only**: a
decoration placed but not yet persisted (a `wsAddObject` preview node living in `ms_reader`), or one
armed and dragged but not yet persisted. Both are things a user would reasonably expect a scene
reload to discard.

We are still closing it, but as a targeted warning rather than a blanket confirm: we already track
exactly that state (`g_capArmed`, `g_placementActive`, plus the renderer's pending-placement lock),
so a `Reload scene` with nothing in flight needs no prompt at all. Filed as a todo, not urgent —
and, as you note, lower exposure now the reload is no longer required for correctness.

## 7. What this unlocks on our side

Worth you knowing, since it retires constraints your fix was not aimed at:

- **Our "load the editor scene LAST" ordering rule is dead.** It shaped our entire 05.1 sign-off
  checkpoint, because any ADD following a `loadScene` derived `cellName: "world"`.
- **Teleport bookmarks become genuinely useful offline** — the one session type where server
  authority does not rubber-band a client-side warp.
- Phase 05.1 closed before this landed; 5.2 and the exterior `.ws`-node work now inherit a
  materially better baseline than the phase was signed off against.

## 8. Still open, unchanged

- **4b** `wsAddObject` executes text on a wrong-class-but-existing template — untouched, non-blocking,
  our filter still guards it.
- **4c** `wsForgetNode` does not un-intern the template name — untouched, still a knowing decision.
  Our corrected byte rule (`.ws` unchanged **only** when the template is already interned) has now
  held for five consecutive placements.
- Your wrong-class `.ilf` refusal branch remains unexercised; the negative test is still available on
  request and we still have no need for it.
