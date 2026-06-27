# CONSULT P4.1-02 — Cursor (detailed file:line reader): deploy-safety / zero-risk-reversibility audit

You are reviewing an EXECUTION PLAN before it is built. Your job: verify the planned deploy/shadow
re-architecture actually delivers the "zero-risk, fully reversible, client stays pristine" guarantee.
Trace the real services + the plan's changes. Report concrete safety gaps only (file:line). Do NOT
redesign or opine on UX.

## Treat as GIVEN (LOCKED — do not re-derive or challenge)
1. Absolute `searchTree_<sku>_<NN>=<absolute path>` values ARE accepted verbatim (verified vs swg-client-v2 TreeFile.cpp:130-138/:360-372, TreeFile_SearchNode.cpp:249-264, OsFile.cpp:86). Priorities search high→low.
2. CONSTRAINT: a `searchTree` value truncates at the FIRST WHITESPACE → the override .tre must live at a whitespace-free absolute path; `.studio` under a space-free app root.
3. v6000 encrypted/out-of-scope; standard 0004/0005 zlib; patch version='5000'.

## Read
- Plans: .planning/phases/04.1-deploy-project-ux/04.1-06-PLAN.md (.studio relocation + Baseline), 04.1-07-PLAN.md (hardlink + cfg snapshot/restore + dup-header + absolute-path default), and skim 04.1-01..11 for context.
- Grounding: .planning/phases/04.1-deploy-project-ux/{04.1-CONTEXT.md (D-05/D-06/D-07/D-08), 04.1-RESEARCH.md (Security Domain), 04.1-PATTERNS.md}
- REAL source: packages/renderer/src/services/{cfgActivator,shadowBaseService,workspaceService,changesetService,clientLocator}.ts; packages/renderer/src/panels/deploy/DeployDialog.tsx

## Your angle (ONLY this — others cover symbol-wiring, UX, model-invariants)
Does the plan, AS WRITTEN, guarantee:
- **Client stays pristine:** zero toolkit files written into the client install except the one reversible `.cfg` edit? (Today cfgActivator writes a `.bak` next to the cfg; the plan moves it to `.studio`. Confirm no other write touches the client dir — patch in `.studio/build`, snapshots in `.studio`.)
- **Undo restores exactly:** is undo a whole-file restore of the snapshotted original cfg (not fragile line-surgery)? Snapshot taken BEFORE first mutation, restored on Reset? Any path where a failed/partial write corrupts the cfg with no clean restore?
- **Absolute-path default correctness:** the override `.tre` registered by a whitespace-free absolute path; atomic BOM-free write preserved; no duplicate `[SharedFile]` header after TWO deploys (the bug the plan fixes — confirm the fix is idempotent across repeated deploys).
- **Hardlink full-shadow safety:** fs.link only base `.tre` from the detected TRE dir into a CONTAINED shadow dir; dest-containment validated before link; EXDEV (cross-volume) falls back to copy; Reset deletes the shadow, base untouched. Any way a hardlink/symlink escapes the work dir?
- **Path-traversal:** Extract→Add derived virtual paths reuse the existing isVirtualPathSafe guard?

Report each as SAFE (with the citation that proves it) or GAP (file:line + the exact failure scenario + smallest fix). Rank gaps by blast radius (could it brick the user's real client?).
