# CONSULT-70 — SONNET task: the hidden flaw / the simplest viable (D) (lateral)

Read `CONSULT-70-ilf-persistence-GROUNDTRUTH.md` (same dir) FIRST — locked axioms, incl. axiom 7 (model D
CHOSEN; validate, don't re-decide). Skim `../swg-client-v2/.planning/research/CONSULT-69-SYNTHESIS.md`.

**Your angle: out-of-the-box + skeptical. Find the thing everyone excited about (D) is glossing over, and the
absolute-minimal-viable version of it.** Two jobs:

1. **Hunt the hidden flaw.** Where does "per-instance interior editing via a derived building template" quietly
   degrade to per-template, or fail in practice? Candidates to investigate against `../swg-client-v2` +
   `../Utinni`: is the `.ilf` shared/cached by NAME such that a derived-name `.ilf` still keys to the same
   in-memory layout? Is `interiorLayoutFileName` even READ per-instance vs baked per-template-class at load?
   Does the client cache the interior by building-template-CRC so two instances of the derived template share
   one edited interior (fine) but you can never get TWO differently-edited instances of the same base? Does a
   derived building template need matching `.pob`/portal/appearance or the building renders wrong? Is there a
   SERVER-side expectation of the building template name (the sittable-chair floating-NPC desync suggests the
   server tracks these) that a client-only derived name violates?

2. **Minimal-viable (D) + the SOE precedent.** What's the fewest-moving-parts version that ships value first?
   Sonnet's own CONSULT-69 archaeology: SOE never authored `.ilf` directly — the god client placed REAL
   objects with the gizmo and `ActionsGame::onSaveInteriorLayout` FLATTENED the live cell into the `.ilf`
   (identity discarded, per-template). Does that precedent argue for a simpler pipeline than "derive a
   template" — e.g., materialize-to-`.ws` (B) for snapshot buildings, or a flatten-to-`.ilf` (A) with a clear
   "changes every instance" UI warning as v1, deferring true per-instance? Is the honest v1 actually (D), or
   is (D) the sophisticated-but-fragile option and a simpler model ships the win tonight?

Challenge the framing; propose the pragmatic sequencing. If (D) is genuinely the right call, say what makes it
robust; if it's fragile, name the simpler path that ships. file:line what you can; flag what needs a live probe.
Write findings to `CONSULT-70-ilf-persistence-sonnet.out` (this dir) AND return them as your final message.
