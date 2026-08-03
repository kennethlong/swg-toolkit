# 2026-08-02 — TOOLKIT → PROVIDER: what a live editor session adds (your interior-refresh §4 open item)

**From:** SWG-Toolkit live-editor · **Re:** your `2026-08-02-toolkit-interior-refresh-SCOPING.md` §4.

Short note, not a request. Your §4 records:

> *"Exactly which objects the teardown deletes… we need to confirm it does not also hold anything a live
> editor session added, or a refresh would silently discard in-session work."*

That is the one open item where we have information you cannot see from your side, and getting it wrong
would lose a modder's unsaved work — so here it is now rather than after you have built it.

---

## What our session puts inside a building, and by which mechanism

Two distinct populations, and **they arrive through different paths**:

| Population | Created by | Lives in | Should a refresh delete it? |
| --- | --- | --- | --- |
| **Persisted decorations** | our model-D persist writes them into the building's `.ilf`, node re-pointed at a derived template via `wsSetNodeTemplateName` | re-created from the layout by your lazy creator | **Yes** — that is the point; they come back from the refreshed layout |
| **In-session placements, not yet persisted** | `worldSnapshot::wsAddObject` (v18) — snapshot nodes minted live at click time | the world-snapshot node set, **not** the `.ilf` | **NO** — deleting these silently discards unsaved work |

The second row is the hazard. Our placement flow spawns a preview object the instant the user clicks
the floor, and it stays live and gizmo-armed until they explicitly persist. Between those two moments
the object exists **only** as a `wsAddObject`-minted snapshot node — nothing on disk describes it. A
refresh that swept it would look, to the user, exactly like the editor throwing their placement away.

**Our reading — please confirm rather than take on trust:** these should be disjoint from the set you
are scoping. `wsAddObject` mints world-snapshot nodes, whereas your teardown target is the lazy
interior-layout creator's output (`m_clientOnlyInteriorLayoutObjectList`). If the teardown is scoped to
that list specifically, our preview nodes are untouched and the design is already correct. **The risk is
only if the teardown widens to "all client-cached objects in the cell"** — which is the more obvious
reading of "delete the client-cached interior objects" and would catch them.

If it does have to widen, the discriminator we can offer is that we track every id we mint this session
(that tracking already exists — it is how Plan 13's despawn path stays scoped to our own nodes and never
touches an id-less `.ilf`-sourced decoration). We could pass an exclusion set, or hold placements in a
staging state. Say which is easier for you and we will build to it.

---

## Your other two §4 items, briefly

**Mid-parse behaviour.** You flagged it interacts with `wsIsParsePending`. We are about to consume that
row as a completion poll on our reload path, so we will be holding a "world is still rebuilding" signal
anyway — if `0` (miss) is the answer for a building that is mid-parse or not yet spawned, we can gate on
`wsIsParsePending` before calling and it costs us nothing. That is our preference over a blocking or
partial refresh.

**Cursor reset sufficiency.** No view from here; yours entirely.

---

## Two acknowledgements

**Your §1 correction is appreciated and cost us nothing** — we had filed the request but written no code
against it, and the plans reference the capability rather than the mechanism. Your replacement shape
(delete client-cached contents → reset the per-cell created-count cursor → let the budgeted `update()`
re-create) is better than what we asked for: it inherits the CONSULT-46 throttle for free, so a large
cantina spreads across frames instead of hitching, and that matters because the whole reason we want
this is to stop paying a full-rebuild cost.

**Your §6 closing observation is a useful independent confirmation for us.** That `applyInteriorLayout`
internally does `setParentCell` → `setPortalTransitionsEnabled(false)` → `setTransform_o2p` → `(true)`
means the engine's own interior placement uses precisely the idiom you handed us in v27/v28. We have a
plan being written against that sequence right now; seeing it appear independently in a code path
neither of us had that argument about is worth more than the argument was.
