# CONSULT-69 SYNTHESIS — .ilf interior-decoration objects in the live world editor

**Date:** 2026-07-19. **Crew:** Codex (id-band audit) · Cursor (lifecycle + pipeline trace) ·
Opus (persistence design) · Sonnet (archaeology + lateral) · fresh Fable (blind adversarial).
Raw memos: `CONSULT-69-ilf-identity-{codex,cursor}.out` (Opus/Sonnet/Fable memos preserved in
this session's transcript; key content folded below). Evidence pack:
`CONSULT-69-ilf-object-identity-EVIDENCE.md`.

## Verdicts (convergence-from-divergence)

### 1. UNANIMOUS — selection & manipulation are pointer-keyed and (probably) already work on v21

- Cursor's trace: with `allowTargetAnything=true`, an id-less chair **does** land in
  `m_lastSelectedObject` (SwgCuiHud.cpp:1436) — readable via the advertised
  `cuiHud::getTarget` — as a **transient hover pick** (cleared the frame the cursor leaves;
  conditions: ground hud, `m_targetingEnabled`, cursor on the hud page, read same-frame).
  Every CLICK path dead-ends on id 0 at five exact lines (radial gate :2103, lookAt/intended
  :2115-2117, `getObjectById` :2117, CuiAction :135, server menu-select
  CuiRadialMenuManager.cpp:2292).
- Lifetime is friendly: one delete site (`TangibleObject::removeFromWorld`,
  TangibleObject.cpp:502) — building despawn/zone only; NO invalidation from LOD,
  cell-visibility loss, or spawn throttling. Watchers null safely.
- Codebase idiom (Sonnet): every client-only manipulable system uses pointer/Watcher
  identity (hud pick, god-client selection list, structure-placement ghost, 3D viewer).

### 2. NEAR-UNANIMOUS — do NOT mint NetworkIds for .ilf objects (4 reject, Codex "only with guards")

Four independent kill arguments:
- **The id-0 firewall (Fable):** the hover path already selects the pointer while uplinking
  `cms_invalid`. `m_lookAtTarget` is a shared auto-delta on the player — a valid-looking id
  means **every hover uplinks a client-fabricated id to a live server** (CreatureObject.cpp:
  2949-2968 → CreatureController → CM_clientLookAtTarget). Minting removes the firewall.
- **Not an identity anyway (Fable + Cursor):** spawn order is budget-throttle-interleaved
  across cells (resume cursor, ClientInteriorLayoutManager.cpp:131-166) — mint-at-spawn ids
  differ every session; a deterministic mint must derive from (building, cell, row), at
  which point the tuple IS the identity and the id is a lossy hash of it.
- **Contested namespace (Codex):** `NetworkIdManager::addObject` duplicate = WARNING in
  debug, SILENT first-writer-wins in release (NetworkIdManager.cpp:63-67); a colliding mint
  also suppresses legitimate snapshot spawns (`CEC_objectAlreadyExists`).
- **Behavioral flips (Codex):** a valid id arms ~40+ id-keyed reflexes (target pane, examine
  → SERVER attribute batch requests, sit protocol, command-queue target substitution) —
  each a new leak or behavior change to audit.

**Codex nuance that corrects the evidence pack AND Sonnet's "no precedent" claim:** the
engine ALREADY has a client fake-id band — bit 62, `>= 0x4000000000000000`,
`ClientObject::isFakeNetworkId()` (ClientObject.cpp:104-107, :419-428; NetworkId.cpp:19-32) —
used by waypoints, and the radial-menu path already keeps fake ids client-only
(CuiRadialMenuManager.cpp:281-285). So the CONCEPT has precedent — but the band's
server-leak protection is PARTIAL (lookAt/intended/command-queue/attribute uplinks do NOT
check it), and NetworkId's bit layout (bit 63 sign, bit 62 fake, bits 61-54 cluster id)
makes naive band choices hazardous. IF an id is ever truly needed, the shape is: negative
int64 band + a guard sweep across the five uplink paths. The crew's judgment: that guard
sweep buys nothing selection doesn't already have → don't.

### 3. SPLIT (productive) — persistence: three viable models, ONE product question decides

| Model | Champion | Semantics | Cost center |
| --- | --- | --- | --- |
| **(A) Per-template .ilf editing** — provider-owned rebuild over the in-memory template reader (a per-template session SINGLETON on ClientBuildingObjectTemplate — Opus) + dual-write to the loose override .ilf | Opus (recommended-iff), Sonnet #1 | Edit once, changes EVERY instance galaxy-wide (SOE's own semantic) | `ilfApplyToScene` respawn must ride the throttled path; loose .ilf changes retail sessions too (Fable objection) |
| **(B) Materialize-to-.ws** — one-time per-building-instance conversion of .ilf content into ws contained rows using the REAL ws id-allocator (genuine ids, no fake band), then suppress .ilf application for that instance | Sonnet #2, Opus (b) | Per-instance fork; downstream = the existing, verified .ws pipe | Suppression hook in the spawn loop; only works where the building HAS a snapshot cell node (NOT server-streamed POBs); on-disk .ws ids are int32 (Codex) so materialized ids must fit the authored band; one-way divergence from template |
| **(C) Instance-keyed overlay (sidecar)** — kill-switched spawn-seam registry capturing `(buildingId, cellName, rowIndex)` (the one point where the row index exists — ClientInteriorLayoutManager.cpp:146/:217) + ~4 advertised rows (resolve, get-by-key, copy-in transform, hide); consumer-owned sidecar file replayed per-frame through the resolver | Fable | Per-instance, works on ANY building incl. server-streamed; id-0 firewall intact; engine never parses editor files | Replay is consumer-side forever (idempotent per-frame apply); drift tiebreak needed vs upstream .ilf changes; NOT a shareable game-data artifact (it's an editor-runtime overlay) |

**(D) Template-derive + rebind (Kenny, post-synthesis — the current front-runner for
"this one only"):** per-instance editing as PURE DATA through existing channels. Mint a tiny
DERIVED building template (`@base` original + overridden `interiorLayoutFileName` — it is a
`StringParam` on SharedBuildingObjectTemplate.h:61, derivable by construction) + the edited
.ilf copy, both in the loose override dir (`ObjectTemplateList::fetch` resolves new names via
TreeFile — ObjectTemplateList.cpp:94-120 — no CRC-table registration; .ws stores template
NAMES); rebind the instance = remove + re-add the .ws building row with the derived template
name (same .pob crc) + save. Zero engine additions for persistence; ships as pure data
(.ws + 2 loose files) through the toolkit's deploy pipeline. **"User selectable: this one or
all"** = (D) for this-one, (A) for all — 1:1 UX mapping. Caveats: snapshot buildings only
(server-streamed POBs have no row to rebind — the overlay (C) or server cooperation remains
their only per-instance path); live rebind despawns/respawns the building (occupancy guard
correctly forces stepping out); reuse the instance's existing derived template on repeat
edits (no derivation chains); selection/manipulation still needs the pointer-keyed pick
(the decisive experiment is unchanged).

Common ground regardless of model: **the identity key is `(building NetworkId, cellName,
rowIndex-in-cell)`** — the .ilf file's own primary key (deterministic spawn order per cell,
Watcher-vector in file order — Sonnet/Cursor), and a **locator/registry at the spawn seam**
is the one small engine addition every path needs (the index is in hand at spawn and
unrecoverable after the user moves the object).

**The deciding product question (Opus and Sonnet converged on it independently; Fable's
architecture assumes the answer):**

> When you move a chair in one building, must the identical building across the street stay
> unchanged?

- YES (per-instance world dressing) → (C) for live editing everywhere incl. server
  buildings, or (B) where snapshot cell nodes exist and a shareable .ws artifact is wanted.
- NO (repairing/authoring the shared template layouts) → (A), explicitly labeled as
  template-scoped.
- They are not exclusive: (A) as a separate "template layout editor" tool + (C) as the
  world editor's default gesture is a coherent end state (Fable's proposal).

Historical note (Sonnet's archaeology): SOE never authored .ilf directly — the god client
placed REAL server objects with the normal gizmo and `ActionsGame::onSaveInteriorLayout`
(SwgGodClient/ActionsGame.cpp:277-370) FLATTENED the live cell into the .ilf (identity
deliberately discarded). "Edit live real objects, bake at the end" is the original pattern —
model (B) is its closest descendant.

## THE DECISIVE EXPERIMENT (consumer-only, zero engine changes, run BEFORE any freeze)

Fable's design, corroborated by Cursor's trace conditions:

1. `cuiPreferences::setAllowTargetAnything(true)`; enter a POB interior; hover a decoration
   object.
2. Per frame (Present hook), read `cuiHud::getTarget` AND `clientWorld::collideScreenRay`
   at the cursor pixel.
3. **PASS:** getTarget returns a stable non-null Object* while hovered, and it is NOT the
   object `network::getObjectById(collideScreenRay.outHitObjectId)` resolves (the ray walks
   up to the networked building; the hud pick keeps the chair — divergence proves the
   pointer path reaches the decoration). Latch the pointer on the hover frame; drive the
   gizmo transform rows against it; observe live movement.
4. **Free rider:** leave draw range, return, re-hover — the pointer MUST differ (measured
   proof there is no session-stable handle; kills id-minting with data).
5. **FAIL:** null or building-root → the pick seam needs provider work first (cost model
   changes; re-consult).

If PASS: selection + manipulation ship on v21 as-is; the only provider wave needed is the
spawn-seam registry + resolver rows, gated on the product question above.

## Recommended sequencing (provider position)

1. Toolkit runs the experiment (an afternoon; kill switch = `setAllowTargetAnything(false)`).
2. Kenny + maintainer answer the product question (template-wide vs per-instance).
3. THEN a freeze request: (C)-shaped registry+4 rows, and/or (A)-shaped template-editor
   surface (Opus's row sketch with generation guards), and/or (B) materialization — per the
   answer. Id-minting stays rejected; if ever revisited, negative band + 5-path uplink
   guard sweep is the only viable shape (Codex).
