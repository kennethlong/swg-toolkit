# CONSULT P4.2-01 — Codex — mount call-graph & priority fidelity

You are reviewing a PLAN (not code yet) for the SWG Toolkit. Verify the plan's mount approach against
the REAL client source. Do NOT trust the plan; trust `../swg-client-v2` source + real bytes.

## GIVEN (LOCKED ground truth — do NOT re-derive or contradict; verify the plan AGAINST these)
G1. `TreeFile::install` (../swg-client-v2 `TreeFile.cpp:~84-191`) reads `searchPath`/`searchTree`/`searchTOC`
    entries per priority slot 0→maxSearchPriority. Precedence: higher priority wins; same-priority ties →
    LATER-added wins.
G2. A `.toc` master index (token "TOC"/TAG_0001, magic `" COT1000"`) lists N constituent `.tre` archive
    names in a tree-name block right after a 36-byte header (real `sku0_client.toc`: 131 trees, 193,475
    indexed files). `TOCTreePath` is prepended to each in-.toc archive name.
G3. Real `stage-x64/client.cfg`: searchTOC entries at priorities 0-3, searchTree overlays at 7-8,
    searchPath loose dirs at 5/9/10/11 (priority 10 = the modder override dir; 9 is a DECOY pointing at
    the shared data root). maxSearchPriority=12.

## THE PLAN'S PROPOSED APPROACH (the thing to verify — neutral statement, not endorsed)
To mount the decoupled client's full base, the toolkit will: read each `.toc`'s header + tree-name block
ONLY (not the 193k path index), prepend `TOCTreePath` to each of the 131 names, and feed those `.tre`
paths to the EXISTING native mount (`mountSearchableAsync`) — assigning each expanded `.tre` the
`priority` value of its source `searchTOC` cfg entry. searchTree overlays and searchPath dirs mount at
their own cfg priorities. Final resolution is the toolkit's existing unified priority-DESC /
later-added-wins order in `clientSearchOrder.ts`.

## YOUR ANGLE (call-graph / resolution-order fidelity)
1. Trace `TreeFile::install` + `addSearchTOC`/`addSearchTree`/`addSearchPath` + the SearchNode precedence
   logic in `../swg-client-v2` (TreeFile.cpp + TreeFile_SearchNode.cpp/.h). Read the toolkit's
   `packages/renderer/src/services/clientSearchOrder.ts` and `treAutoMount.ts`.
2. **Core question:** Does mounting the 131 constituent `.tre` archives individually (each at its
   `searchTOC` entry's priority) reproduce the SAME logical-path resolution the engine produces when it
   resolves through the real `.toc`? Identify any case where it would DIVERGE — e.g. a logical path
   present in two archives within the same TOC (which wins?), the cwd-relative fallback the engine tries
   before `TOCTreePath`, or intra-TOC ordering of the 131 names.
3. Is "assign each expanded TRE its source `tocEntry.priority`" correct, or does the engine give the
   131 archives an internal sub-order that flat-priority loses?

## OUTPUT
Concrete findings with file:line citations. State CORRECT / DIVERGES / UNVERIFIED per point. If you find
a divergence, give the smallest counterexample. Do not rewrite the plan.
