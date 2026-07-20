# CONSULT-70 SYNTHESIS — `.ilf` decoration PERSISTENCE (model D validation)

**Date:** 2026-07-19. **Crew:** Codex (load/rebind trace) · Cursor (`.ilf` format/writeability) · Opus
(adversarial `.ws`-rebind) · Sonnet (hidden-flaw/lateral). Raw: `CONSULT-70-ilf-persistence-{codex.rawout,
cursor.out,opus.out,sonnet.out}`. Task: VALIDATE model (D) (chosen — axiom 7), not re-decide.

## VERDICT: **GO on model (D)** — with ONE correction: it is NOT "zero engine rows."

Model (D)'s **direction and derivation engine are proven sound by all four** (file:line). But the crew
**diverged on the `.ws` rebind**, and the divergence is the whole payoff:

- Codex / Cursor / Sonnet: "(D) needs no new provider row — `wsRemoveNode`+`wsAddObject` already exist."
- **Opus (adversarial, correct): that specified mechanism is DATA-LOSSY and FALSIFIED for the demonstrated
  building.** `wsRemoveNode` tombstones the node's ENTIRE subtree — the building's cells **and every authored
  `.ws` object inside them**; `wsAddObject` re-adds a POB with **freshly-created EMPTY cells** and no channel
  for the original contents. The demonstrated cantina HAS authored in-cell `.ws` content (Wave-3 provenance:
  ids in cantina cell 1134566 that "MUST serialize", `WorldSnapshot.cpp:2494-2501`). So naive remove+re-add
  writes the cantina back with **empty cells** → the edited `.ilf` furniture returns, but the authored ceiling
  fixtures/lights/fan are **permanently dropped on reload.** Also mints a fresh building id (`:2175`).

**The honest answer to "is (D) pure data, zero engine additions?" → NO** whenever the target building has
authored interior `.ws` content. The clean fix is ONE tiny provider row (below), still the cheapest of all
models (< C's ~4 rows).

## What IS pure-consumer (proven sound, no provider work)

1. **`.ilf` read/edit/write** (Cursor + Sonnet, `InteriorLayoutReaderWriter.cpp:331-378`): the simplest IFF in
   the engine — `FORM INLY → FORM 0000 → CHUNK NODE×N`, each = `{templateName str, cellName str, 3×4 float32
   o2p}`. No CRC, no checksum, no baked index. The toolkit's native-core IFF (or the Blender writer) produces a
   byte-valid edit in ~30 lines. SwgGodClient has written `.ilf` consumer-side since ~2002. **No `.ilf`-save row.**
2. **Derived-template mint** (Codex + Opus + Sonnet): a `DERV` `.iff` over the stock building template, overriding
   ONLY `interiorLayoutFileName` (a `StringParam`, `SharedBuildingObjectTemplate.h:61`) — inherits `.pob`/portal/
   appearance automatically (`getPortalLayoutFilename` falls through to base), so the node's `portalLayoutCrc`
   stays identical and passes the spawn-time consistency check (`WorldSnapshot.cpp:210-227`). Resolves loose by
   name via TreeFile, **no CRC-table registration** (`ObjectTemplateList.cpp:94-106`). `.ws` stores template
   NAMES, so re-pointing the node to the derived name is a name-layer edit. Consumer-side `.iff` write.
3. **Deploy** (Opus): the artifact = 1 `.ws` + 2 loose files (derived `.iff` + edited `.ilf`) → 3 staged entries
   into SearchPath(0) through the existing stage→seal→deploy; undo reverts all three. Fine.

## The ONE provider row (I'll drive the change request)

**`wsSetNodeTemplateName(int64 id, const char* name)`** — intern the derived name (the intern logic already
exists, `WorldSnapshotReaderWriter.cpp:913-923`) + `setObjectTemplateNameIndex`, then `wsSaveSnapshot`. **In-place
name swap: zero subtree churn, zero id change, no occupancy despawn, authored content untouched. ~10 lines.**
This replaces the falsified remove+re-add. (Fallbacks if the provider row is ever refused: an id-preserving
`wsAddNodeAt` subtree replay — fragile, multi-row; or model (B) materialize-to-`.ws` — leave the building, add
edited furniture as authored `.ws` children, needs an `.ilf`-suppression hook. Both are more work than the one row.)

## Invariants the toolkit MUST honor (baked into the build)

1. **Rebind via `wsSetNodeTemplateName` (in-place), NEVER `wsRemoveNode`+`wsAddObject`** on a building with
   authored `.ws` children (probe `wsGetChildCount` first). [Opus Defect A]
2. **(D) applies only to genuine `.ws`-file nodes.** `wsRemoveNode`→0 (or a buildout/server discriminator) ⇒
   refuse / fall back — same rule as the floating-NPC server chair. [Opus C / Sonnet §3]
3. **Name the derived template by the building INSTANCE id; never content-dedupe.** The `.ilf` reader is owned
   per-template-NAME, so 1:1 instance→derived-name is the ONLY thing making (D) per-instance vs (A). Assert it.
   [Sonnet §1b]
4. **Inherit `.pob`/`portalLayoutFilename` — never override** (keeps the crc matched). [Codex + Opus + Sonnet]
5. **Reuse the existing derived template on repeat edits; edit its `.ilf` in place — never derive-from-derived.**
6. **`.ilf` edit: preserve within-cell NODE order (row index = identity); write o2p (not the gizmo's o2w).**
   [Cursor] → the toolkit converts the moved object's o2w back to cell-relative o2p.
7. Deploy all 3 artifacts together; force the user out first (interior re-apply despawns/respawns).

## Live probes to run BEFORE shipping (maintainer drives smoke)

- **P1 (Sonnet):** same-session double-edit — edit a decoration → rebind → edit again WITHOUT relaunch →
  rebind → does the second move render, or does a stale cached `.ilf` reader win? (ObjectTemplate cache
  refcount-to-zero, `DataResourceList.h:335-351` — reads correct, unproven live.)
- **P2 (Opus/Cursor):** confirm the target building HAS authored `.ws` in-cell content (governs invariant 1),
  and is a client `.ws` node not server-streamed (governs invariant 2).
- **P3 (Cursor):** the "which `.ilf` entry did I pick?" resolver — mapping the picked `Object*` →
  `(cellName, rowIndex)`. Read-only; may want a small provider resolver row if not derivable consumer-side.

## Build plan (consumer)

1. `.ilf` reader/writer in native-core (or TS) — pure data (invariant 6).
2. Derived-template `.iff` minting (DERV @base + `interiorLayoutFileName`), instance-id-named (invariant 3-5).
3. Bind `wsSetNodeTemplateName` (once the provider ships it) → in-place rebind (invariant 1).
4. The pick→`(cell,row)` resolver (P3).
5. Stage all 3 as a changeset → existing deploy pipeline (invariant 7).
6. Guardrails (invariant 2) + the P1/P2 live probes.
