# CONSULT P4-02 — Cursor — Phase 4 .cfg + patch-format mechanics re-verification

You are the byte/format oracle reviewing IMPLEMENTATION PLANS (not code yet) for an SWG modding
toolkit's "Edit & Deploy Loop". Your job: independently re-verify the patch-activation format mechanics
the plans rely on, against the REAL client source and a REAL client config — and flag any place the
plans would write a `.cfg` the engine won't honor, or build a patch the client won't load.

## Ground truth to VERIFY (do not assume the plans are right — check the source/bytes yourself)
The plans claim all of the following. Confirm or REFUTE each against `../swg-client-v2` source and the
real config in `D:/SWG Infinity` (and the `.tre` bytes there):
- CLAIM-A: The engine reads TRE search paths via `searchTree_<sku>_<priority>=<file>.tre` keys inside a
  `[SharedFile]` section; the numeric suffix IS the priority; HIGHER number wins; first-match;
  `maxSearchPriority` gates the scan. (Plans cite TreeFile.cpp:90-191,285-308,437-461 + ConfigFile.cpp:359-518.)
- CLAIM-B: The live client mounts `EERT5000` (v5000) archives, so a patch must be built version='5000'
  (NOT '0005'). (Plans cite hexdump of live `.tre`.)
- CLAIM-C: A length-0 "tombstone" entry in a higher-priority archive HIDES the retail file
  (delete semantics). (Plans cite TreeFile_SearchNode.cpp:397 + find() !deleted loop.)
- CLAIM-D: Safe write target = a toolkit-owned `swgtoolkit.cfg` pulled in via `.include "swgtoolkit.cfg"`
  added once to the stable root `swgemu.cfg`; never `user.cfg`/`options.cfg`. The plans' `cfgActivator`
  writes CRLF, BOM-free, atomic temp+rename, with a backup.

## The plans to audit (read these)
- `.planning/phases/04-edit-deploy-loop/04-03-PLAN.md` (packPatch + clientLocator + cfgActivator — the core)
- `.planning/phases/04-edit-deploy-loop/04-06-PLAN.md` + `04-06b-PLAN.md` (deploy dialog + shadow-base)
- Refs in same dir: `04-RESEARCH.md`, `04-CONTEXT.md`

## Your angle — correctness of the cfg write + patch build (cite swg-client-v2 file:line + real cfg)
1. Verify CLAIM-A..D against the actual `../swg-client-v2` source AND the real
   `D:/SWG Infinity/.../swgemu_live.cfg` (or whichever cfg the client actually reads). Quote the real
   directives. Is the `.include` directive actually supported by ConfigFile, and does an included
   `[SharedFile]` block merge correctly with the root one?
2. The slot-selection logic: plans pick the next FREE slot = `Math.max(0, ...occupiedSlots)+1`, and bump
   `maxSearchPriority` (by +5) only if the chosen slot exceeds it. Does the REAL ConfigFile resolve a
   DUPLICATE `maxSearchPriority` (one in swgemu.cfg, one in the included swgtoolkit.cfg) as
   first-value-wins or last-wins? If first-wins, a bump in the included file is IGNORED and a high slot
   silently never scans → patch fails. This is the highest-risk question — answer it from source.
3. Does the real cfg parser tolerate the plans' write format (CRLF, leading tab on keys, BOM-free)? Any
   parsing quirk (case sensitivity, section re-open, comment syntax) the plans get wrong?
4. The shadow-base repoint (`04-06b`): plans repoint the client base by adding the shadow TREs as
   higher-priority `searchTree` entries (NOT a base-dir directive). Is that sufficient to make the
   client load the shadow set over retail, or is a real base-directory directive required? If a
   base-dir directive exists in swg-client-v2 config, name it (file:line).

Report CONFIRM / REFUTE per claim with cited evidence. Rank issues BLOCKER > WARNING > NIT. The
duplicate-`maxSearchPriority` resolution (item 2) is the single most important thing to nail.
