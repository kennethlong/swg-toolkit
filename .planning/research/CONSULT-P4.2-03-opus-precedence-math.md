# CONSULT P4.2-03 — Opus — precedence/resolution math

Reviewing a PLAN for the SWG Toolkit. Reason about resolution-order correctness. Ground truth =
`../swg-client-v2` source; verify, don't trust the plan.

## GIVEN (LOCKED — do NOT re-derive; reason WITHIN these)
G1. Engine resolution (`TreeFile::install` + SearchNode precedence, `../swg-client-v2`
    `TreeFile.cpp`/`TreeFile_SearchNode.cpp`): entries register per priority slot 0→maxSearchPriority;
    higher priority wins; same-priority ties → LATER-added wins.
G2. Real `stage-x64/client.cfg` slot map: searchTOC_00_0..03_3 at priorities 0,1,2,3; searchTree
    overlays at 7,8; searchPath dirs at 5, 9, 10, 11 (10 = modder override dir; 9 = DECOY → shared data
    root). maxSearchPriority=12. Each searchTOC expands to 131 `.tre` archives.

## THE PLAN'S MODEL (verify the math)
The toolkit assigns each expanded `.tre` the `priority` of its source searchTOC entry (so all 131 from
`searchTOC_00_0` sit at priority 0, etc.), searchTree overlays at 7/8, loose searchPath dirs surfaced via
a TS VFS overlay, and resolves everything through one unified priority-DESC / later-added-wins order. The
loose-override deploy writes into `looseDirs[0]` = the MAX-priority searchPath (priority 10).

## YOUR ANGLE (prove-or-break the ordering)
1. For an arbitrary logical path P present in: a base archive (searchTOC priority 2), a searchTree overlay
   (priority 8), AND the override dir (priority 10) — does the plan's model resolve P to the SAME winner as
   the engine? Walk both orderings.
2. **Same-priority ties:** within one searchTOC's 131 archives all sharing one priority, and across the
   two searchTree overlays sharing adjacent priorities — does "later-added wins" hold identically when the
   131 are flattened into the unified list? Does flattening preserve add-order?
3. **The decoy:** confirm that `looseDirs[0]` = max-priority (10), NOT 9, is what guarantees the override
   wins over the shared-root searchPath at 9 — and that nothing in the plan could pick 9 or 5.
4. Edge: does mounting ALL sku TOCs (ignoring `gameFeatures` bits) change any resolution the engine would
   make differently (i.e., could a higher-sku TOC shadow a base file the engine wouldn't load)?

## OUTPUT
For each: HOLDS / BREAKS, with the reasoning chain. If BREAKS, the minimal counterexample (paths,
priorities, expected vs plan winner). Do not rewrite the plan.
