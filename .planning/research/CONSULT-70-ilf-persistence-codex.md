# CONSULT-70 — CODEX task: does model (D)'s LOAD/REBIND mechanism actually work? (repo trace)

Read `CONSULT-70-ilf-persistence-GROUNDTRUTH.md` (same dir) FIRST — locked axioms, incl. axiom 7 (model D is
CHOSEN; validate it, don't re-decide). Also read `../swg-client-v2/.planning/research/CONSULT-69-SYNTHESIS.md`.

**Your angle: trace the real swg-client-v2 client LOAD path and confirm/REFUTE, with file:line, that model (D)
loads correctly.** (D) = derive a building template (`@base` original + overridden `interiorLayoutFileName`) +
an edited `.ilf` copy, both in the loose override dir; rebind the `.ws` building row to the derived template
name. Trace and answer each, YES/NO + file:line in `../swg-client-v2`:

1. **Derived template name resolution.** Does `ObjectTemplateList::fetch` (and the `.iff` template loader)
   resolve a *brand-new* derived template NAME purely from the loose override dir via TreeFile/SearchPath,
   with **no CRC-table pre-registration**? What must the derived `.iff` contain (a `@base`/DERV chain over the
   stock `shared_*` building template)? Is `interiorLayoutFileName` actually an **overridable** field in a
   derived template (a `StringParam` on `SharedBuildingObjectTemplate`), i.e. can a DERV template set only
   that one field and inherit the rest?

2. **`.ilf` selection at build spawn.** When the building spawns, where does it read `interiorLayoutFileName`
   and hand it to `ClientInteriorLayoutManager`? Confirm the overridden value (→ our edited `.ilf` copy)
   is what actually gets loaded for THAT instance, not the stock `.ilf`.

3. **`.ws` rebind.** Does the `.ws` building row store the template **NAME** (string), so remove+re-add with
   the derived name works? Does the building's `.pob` (portal/cell) crc need to match the base (D assumes
   "same `.pob` crc")? Trace `WorldSnapshot` load → `createObject` → cell creation to confirm what's keyed on
   the template vs the row.

4. **Minimal provider dependency.** Given the above, does (D) need ANY new advertised row to LOAD/REBIND (vs.
   the already-advertised `wsAddObject`/`wsRemoveNode`/`wsSaveSnapshot`)? Name it precisely if so; ideally none.

Be a skeptic: if any link is broken (name won't resolve, override won't take, crc must differ, cache defeats
per-instance), say so LOUDLY with the file:line that proves it. Convergence with the other consultants comes
from independent evidence — trace it yourself, don't defer to the synthesis doc.

Write your findings to `CONSULT-70-ilf-persistence-codex.out` (this dir) AND print them.
