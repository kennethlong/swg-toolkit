# CONSULT-70 — `.ilf` interior-decoration PERSISTENCE (shared ground truth)

**LOCKED AXIOMS — do NOT re-derive, contradict, or re-open. Treat as given. Reason FROM these.**

1. **The layer.** Furniture inside SWG POB (player-occupiable building) interiors is the **interior-layout
   (`.ilf`)** layer: client-only objects spawned per-cell from a **per-building-TEMPLATE** `.ilf` file
   (`ClientInteriorLayoutManager`), with **NO NetworkId ever assigned**. MEASURED LIVE (advertised gl11 client):
   a cantina table returns `cuiHud::getTarget` = null, networkId 0; a sittable "chair" is actually a
   server-streamed tangible (networkId 1127094080) — NOT a decoration.

2. **Selection + live move is SOLVED.** The toolkit selects+moves a pure `.ilf` decoration TODAY via the
   advertised v22 row `clientWorld::collideScreenRayObject` (returns the raw borrowed `Object*`); the gizmo
   drives its transform live. PROVEN (moved a `shared_frn_tatt_table_cantina_table_3.iff` table). **PERSISTENCE
   is the ONLY open piece** — a moved decoration reverts on scene reload / next session.

3. **Do NOT mint NetworkIds for `.ilf` objects** (crew verdict, 4/5 reject, LOCKED): `m_lookAtTarget` is a
   shared auto-delta on the player, so a valid-looking id auto-uplinks a client-fabricated id to the LIVE
   server on every hover. Rejected.

4. **The toolkit deploy pipeline (EXISTS, verified in-repo).** An edit = a staged file entry
   (`{virtualPath, replacementFilePath, action}`) → `sealVersion` → deploy as a **loose override** into the
   client's winning SearchPath, which **== the toolkit's override dir**. `.ws` world snapshots store object
   **template NAMES** (strings) + transforms — NOT crcs. `wsAddObject(tmpl, transform12, containedById)` /
   `wsRemoveNode(id)` / `wsSaveSnapshot()` are advertised + working.

5. **The four candidate models** (from the provider crew, `../swg-client-v2/.planning/research/CONSULT-69-SYNTHESIS.md`
   — READ IT + `CONSULT-69-cursor-ilf-lifecycle-pipeline.md` + `CONSULT-69-ilf-object-identity-EVIDENCE.md`):
   - **(A) per-template `.ilf` edit** — edit the building's `.ilf`; changes EVERY instance of that template
     galaxy-wide. Engine writer exists (`InteriorLayoutReaderWriter::{save,clear,addObject}`, sharedUtility).
   - **(B) materialize-to-`.ws`** — one-time convert `.ilf` content into `.ws` contained rows via the real ws
     id-allocator; only where the building HAS a snapshot cell node (NOT server-streamed POBs).
   - **(C) instance-keyed sidecar** — consumer-owned overlay `(buildingId, cellName, rowIndex)` replayed
     per-frame; needs ~4 new advertised rows; works on ANY building incl. server-streamed.
   - **(D) template-derive + rebind** (front-runner, "this one only"): mint a DERIVED building template
     (`@base` original + overridden `interiorLayoutFileName` — a `StringParam` on `SharedBuildingObjectTemplate`)
     + an edited `.ilf` copy, BOTH in the loose override dir (`ObjectTemplateList::fetch` resolves new names via
     TreeFile, no CRC-table registration; `.ws` stores template NAMES); rebind the instance = remove + re-add the
     `.ws` building row with the derived template name (same `.pob` crc) + save. **Pure data through the deploy
     pipeline, ZERO engine additions.** SNAPSHOT buildings only (server-streamed POBs have no `.ws` row to rebind).

6. **The deciding PRODUCT QUESTION:** *"When you move a chair in one building, must the identical building
   across the street stay unchanged?"* YES → per-instance (D/C/B). NO → per-template (A). The toolkit is a
   **world-building + deploy tool** (edits ship as versioned data assets), NOT a live-server admin tool.

7. **DECISION ALREADY MADE — do NOT re-open it.** The maintainer has chosen **per-instance** semantics and
   **model (D) template-derive + rebind** as the direction. The crew's job is NOT to pick a model or argue
   A-vs-D. It is to **ADVERSARIALLY VALIDATE (D)** and de-risk the build:
   - **THE load-bearing question:** is (D) actually **"pure data, ZERO engine additions"**, or does it quietly
     need ONE provider row? The crux: **can the toolkit WRITE a `.ilf` file consumer-side** (parse it, move one
     entry's transform, write it back byte-valid), or must it call the engine's `InteriorLayoutReaderWriter`
     (→ a new advertised `.ilf`-save row)? Answer with the real `.ilf` byte format + read/write path.
   - Does (D)'s mechanism actually WORK against the real client loader (derived template name resolves loose,
     `interiorLayoutFileName` override changes the loaded `.ilf`, `.ws` rebind preserves the building)?
   - What are (D)'s failure modes, and what is the MINIMAL provider dependency (ideally none) to ship it?
   If — and only if — a consultant finds (D) genuinely UNSOUND (not just "A is philosophically nicer"), say so
   loudly with file:line proof and name the cheapest correct fallback. Otherwise: make (D) bulletproof.

**Reference repos (read freely, file:line your claims):** `../swg-client-v2` (the advertised client — #1 ground
truth), `../Utinni` (frozen but authoritative reference, esp. legacy patterns). Do NOT propose minting ids
(axiom 3). Do NOT re-litigate that selection works (axiom 2). Do NOT re-decide the model (axiom 7). Answer the
SPECIFIC angle in your task file.
