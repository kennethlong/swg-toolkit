# CONSULT-70 — CURSOR task: can the TOOLKIT write a `.ilf` consumer-side? (the make-or-break for model D)

Read `CONSULT-70-ilf-persistence-GROUNDTRUTH.md` (same dir) FIRST — locked axioms, incl. axiom 7 (model D
CHOSEN; validate it). This is **THE load-bearing question** for whether (D) is "pure data, zero engine rows."

**Your angle: the `.ilf` (interior-layout) FILE FORMAT + read/write path — can a consumer (the toolkit, in
TypeScript/Node or its C++ native core) produce a byte-VALID edited `.ilf` (take the stock `.ilf`, move ONE
entry's transform, write it back), WITHOUT calling the engine?** Trace against ground truth:

1. **The format.** Read the `.ilf` reader+writer in `../swg-client-v2` — `InteriorLayoutReaderWriter`
   (sharedUtility) and whatever `ClientInteriorLayoutManager` parses. Give the concrete byte layout: IFF
   chunk structure (form/tags/versions), the per-object record (template name string? crc? the transform —
   3x4 float row-major? quat? position), counts, cell association, any ordering/index invariant. file:line.

2. **Writeability.** Is the format a plain IFF the toolkit's existing IFF/TRE tooling can round-trip
   (`../swg-blender-plugin`, `swg_pipeline/*`, or the toolkit's own IFF reader), or does it embed anything a
   naive rewrite would corrupt (crc-of-contents, a sphere-tree/extent baked at author time, template-CRC refs
   that must be re-registered)? Would moving one entry's transform and re-serializing produce a file the
   client loads identically except for that one object?

3. **VERDICT (the answer that decides D's cost):**
   - **PURE-CONSUMER:** the toolkit can read+edit+write the `.ilf` itself → (D) needs NO provider row for the
     `.ilf` half. Give the minimal writer recipe.
   - **NEEDS A PROVIDER ROW:** the format has an engine-only invariant → (D) needs an advertised
     `.ilf`-save/edit row (spec it: signature, what it does). Name exactly what forces engine involvement.

4. Cross-check: does `../Utinni` have any `.ilf` read/write code to corroborate the format?

Be precise and adversarial — a wrong "pure-consumer" verdict costs a day mid-build. file:line every claim.
Write your findings to `CONSULT-70-ilf-persistence-cursor.out` (this dir) AND print them.
