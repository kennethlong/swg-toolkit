# CONSULT-70 — OPUS task: adversarially break model (D)'s `.ws` rebind (spec reasoning)

Read `CONSULT-70-ilf-persistence-GROUNDTRUTH.md` (same dir) FIRST — locked axioms, incl. axiom 7 (model D
CHOSEN; your job is adversarial validation, NOT re-deciding). Read
`../swg-client-v2/.planning/research/CONSULT-69-SYNTHESIS.md` (model D is item (D) there).

**Your angle: try HARD to break model (D)'s "rebind the instance" step end-to-end, then tell us if it survives.**
(D) rebinds one building instance to a per-instance edited interior by: **remove the building's `.ws` row →
re-add a `.ws` row at the same transform with a DERIVED template name (`@base` + overridden
`interiorLayoutFileName`), same `.pob` crc → save**. The derived template + edited `.ilf` live as loose overrides.

Reason about (verify against `../swg-client-v2` where you can; flag what needs live confirmation):

1. **Does remove+re-add preserve the building?** Its cells (ids, count, numbering), its AUTHORED in-cell
   snapshot contents (do they survive, or orphan when the parent row is removed?), collision, portals,
   occupancy guard (the remove is guarded on live occupants — does the user get forced to step out?).
2. **Is the derivation valid?** Can a DERV `.iff` building template override ONLY `interiorLayoutFileName` and
   inherit `.pob`/appearance/everything else? Does the engine treat the derived-name building as identical to
   base except the interior? Any place the base template NAME (not just the `.pob` crc) is load-bearing
   (server parity, buildout provenance, radial, portal linking) such that a derived name diverges?
3. **Idempotency / chains.** On a SECOND edit of the same instance: reuse the existing derived template (no
   `@derived@derived` chains). On MANY edited instances of the same base: N derived templates + N `.ilf` copies
   — does that scale, or collide (naming, TreeFile shadowing)?
4. **Deploy-pipeline fit.** The artifact is `.ws` (changed row) + 2 loose files (derived `.iff` + edited
   `.ilf`) per edited instance. Does the toolkit's stage→seal→deploy handle a mixed `.ws`+templates+`.ilf`
   changeset cleanly? Versioning/undo implications.

**Verdict:** SURVIVES (→ list the invariants the toolkit MUST honor to keep it correct) or BREAKS (→ the exact
failure + file:line + the cheapest correct fallback among A/B/C). Do not hand-wave "D is elegant" — attack it.
Write findings to `CONSULT-70-ilf-persistence-opus.out` (this dir) AND return them as your final message.
