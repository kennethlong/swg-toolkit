# Provider → SWG-Toolkit: interior-decoration (.ilf) editing — consult results, the experiment to run, and the decision tree

**Date:** 2026-07-19 · **From:** swg-client-v2 provider session · **To:** SWG-Toolkit live-editor session.
**Companion:** `2026-07-19-PROVIDER-CONSULT-69-SYNTHESIS-copy.md` (same directory — the full
5-consultant synthesis this memo summarizes). Nothing here requires a new contract version;
**everything below runs on v21** (the `getSceneId` handback you're already re-syncing for).

## Context — how we got here

Your hybrid in-cell consult (answered in full in
`swg-client-v2/.planning/handoff/2026-07-19-utinni-hybrid-incell-ANSWERS.md`) established
that the furniture you couldn't remove or target inside cantina-class interiors is a THIRD
content layer: **interior-layout (.ilf)** — client-only objects spawned per-cell from a
per-TEMPLATE layout file, with **no NetworkId ever assigned**. Your remove batch hit
snapshot rows scattered planet-wide (name-match, not spatial); the visible furniture was
never snapshot data. Kenny then asked the provider side the obvious next question — "can we
give these objects a guid and make them editable?" — and we ran a 5-consultant design round
(Codex / Cursor / Opus / Sonnet / fresh-context Fable) on it. Results below are
source-verified with file:line in the companion synthesis.

## Verdict 1 (unanimous): no ids — selection is POINTER-keyed, and it probably already works for you

- Minting NetworkIds for .ilf objects is REJECTED. Highlights: the hover pick already
  captures the object pointer while deliberately uplinking `cms_invalid` — the id-0 state is
  a **firewall**; a valid-looking id would auto-delta to your live server on every hover
  (`m_lookAtTarget` is a shared variable). Spawn order is budget-throttle-interleaved, so
  mint-at-spawn ids wouldn't be session-stable anyway. And the engine's own precedent for
  client-only manipulable objects (structure-placement ghost, god-client selection, 3D
  viewers) is pointer/Watcher identity, never a fabricated id.
- What this means for you TODAY: with `cuiPreferences::setAllowTargetAnything(true)`, an
  id-less chair **lands in the hud's selection watcher** — which you already bind as
  **`cuiHud::getTarget`** — as a *transient hover pick* (cleared the frame the cursor moves
  off; latch it in your Present-hook click handler). Every id-keyed CLICK path (radial,
  lookAt brackets, `getObjectById`) dead-ends on id 0 — that's what your smoke saw; the
  pointer path underneath is intact.
- Pointer lifetime: valid until the owning BUILDING leaves world (one delete site engine-
  side). No invalidation from LOD, cell-visibility flicker, or spawn throttling. Re-validate
  per frame; never cache across a zone.

## THE DECISIVE EXPERIMENT — please run this first (consumer-only, ~an afternoon, zero engine changes)

1. `cuiPreferences::setAllowTargetAnything(true)`. Enter a POB interior (any decorated
   building). Hover a decoration object (chair/table).
2. Each frame, read BOTH `cuiHud::getTarget` and `clientWorld::collideScreenRay` at the
   cursor pixel.
3. **PASS:** `getTarget` returns a stable non-null `Object*` while hovered, and it is NOT
   the object `network::getObjectById(collideScreenRay.outHitObjectId)` resolves — the ray
   row walks up to the networked BUILDING while the hud pick keeps the CHAIR; that
   divergence proves the pointer path reaches the decoration itself. Then: latch the
   pointer on the hover frame and drive your gizmo against the advertised object transform
   rows — the chair should move live.
4. **Free rider:** walk out of the building's draw range, come back, re-hover — the pointer
   WILL differ (these objects have no session-stable handle; that's the measured proof
   behind verdict 1).
5. **FAIL (null, or getTarget returns the building):** report back — the pick seam needs
   provider work and the cost model changes.

Kill switch: `setAllowTargetAnything(false)`. If PASS: **selection + live manipulation ship
on v21 with no new rows.**

## Verdict 2: persistence — user-selectable "this one" vs "all of them" (Kenny's design)

Moves made with the gizmo revert on cell reload (the .ilf respawns from its file). Two
persistence mechanisms, mapping 1:1 onto a UI toggle:

- **"Change only this one" → template-derive + rebind (pure data, no engine changes):**
  write a TINY derived building template (`@base` original + overridden
  `interiorLayoutFileName` — it is a derivable `StringParam`) + your edited .ilf copy, both
  into the loose override dir (new template NAMES resolve via TreeFile; no CRC-table
  registration; .ws rows store names); rebind the instance = remove + re-add its .ws
  building row with the derived template name (same .pob crc) + `wsSaveSnapshot`. The edit
  ships as pure data (.ws + 2 loose files) through your deploy pipeline. Live rebind
  despawns/respawns the building — the occupancy guard will correctly refuse while you
  stand inside (step out to commit). Reuse the instance's derived template on repeat edits.
  **Limit: snapshot buildings only** — a server-streamed POB (e.g. the actual Mos Eisley
  cantina) has no .ws row to rebind; per-instance editing there needs either a
  consumer-side overlay (option C in the synthesis) or server-side cooperation.
- **"Change ALL instances" → edit the original .ilf:** this is the one path that needs a
  small provider surface (enumerate/move/add/remove/save over the engine's existing
  `InteriorLayoutReaderWriter` — the writer API already exists; we'd mirror the ws-wave
  conventions: generation counter, typed result enum, loose-dir save + negative-cache
  invalidation, kill switch). **Send a freeze request when/if you want this mode** — row
  sketches are in the companion synthesis (Opus's section).

Historical footnote that validates the whole shape: SOE never hand-authored .ilf files —
the god client placed REAL objects with the normal gizmo and a bake action flattened the
live cell into the .ilf (`SwgGodClient/ActionsGame.cpp:277-370`, still in-tree). "Edit live
objects, persist as data" is the format's native workflow.

## What we're asking of you

1. Run the experiment; report PASS/FAIL (+ the free-rider observation).
2. Tell us which persistence modes you actually want (this-one / all / both) — "both,
   user-selectable" is the provider-endorsed design.
3. If you want "change all": send the freeze request for the .ilf-editing rows.
4. Unrelated but pending: the v21 re-sync + `getSceneId` bind/smoke (handback
   `2026-07-19-toolkit-getsceneid-v21-HANDBACK.md` in the provider repo — sha256s there).

## Pointers (provider repo, all pushed on master)

- Full synthesis: `.planning/research/CONSULT-69-SYNTHESIS.md` (copy alongside this memo)
- Raw consultant memos: `.planning/research/CONSULT-69-ilf-identity-{codex,cursor}.out`
- Evidence pack: `.planning/research/CONSULT-69-ilf-object-identity-EVIDENCE.md`
- Hybrid in-cell ANSWERS (the three-layer model + layer-triage oracle):
  `.planning/handoff/2026-07-19-utinni-hybrid-incell-ANSWERS.md`
