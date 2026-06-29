# Phase 04.2 Plan Review — Cross-AI Crew Synthesis (2026-06-28)

Four independent consultants, non-overlapping angles, de-anchoring protocol (locked axioms held fixed,
each verifying the plan AGAINST real `../swg-client-v2` source + real `sku0_client.toc` bytes). The signal
is **convergence-from-divergence**: where two independent angles land on the same defect, it's real.

## Verdict: NOT ready to execute. Multiple genuine correctness bugs in mount wiring + deploy lifecycle.

The plan-checker passed (plan-internal consistency). The crew — reading real source + bytes — found
defects the checker structurally cannot see: runtime-wiring bugs (store replace, priority compaction),
ground-truth resolution divergence, and a reset-lifecycle hole that fails the UAT.

---

## What's SOLID (risk retired)
- **`.toc` byte format — VERIFIED (Cursor).** 36-byte header + 131 null-terminated Latin-1 names (2757 B);
  magic `" COT1000"`, all LE; `names[0]=bottom.tre`. The **2793-byte oracle slice is correct** (36+2757).
  Format work is de-risked; the planner's Fix-4 number holds.
- **Outer priority model — CORRECT (Codex + Opus).** One `.toc` = one search node at its cfg priority;
  `addSearchNode` uses `lower_bound(a.priority > b.priority)` → later-added wins (the source's own
  doc-comment says "after" and is STALE — do not re-anchor on it). searchTOC/searchTree/searchPath
  outer precedence is right.

---

## BLOCKER-class (break main-line behavior or a success criterion — must fix before execute)

### B1 — Double-mount clobbers the searchTree overlays (Opus X-1)
Plan 03 calls `mountTrePaths` twice (searchTree, then TOC). `mountComplete` (`treStore.ts:159-170`) does a
full `set({...})` REPLACE → the second mount **erases the searchTree overlays from the store**. The two
highest-priority archive nodes (the override TREs — the entire point of searchTree) vanish.
Counterexample: P in `swgsource_3.0.tre`(@8) and `sku3.toc`(@3) → engine serves the tree; plan serves sku3.

### B2 — Priority compaction scrambles cross-family order (Opus X-2)
Even merged into one mount, `clientSearchOrder.ts:137` remaps searchTrees to COMPACT `[2,1]` while TOC
`.tre` carry RAW `[0,1,2,3]`. So "TOC (0–3) sits below trees (7–8)" is FALSE post-remap: `swgsource_3.0`
lands at native 2, BELOW `sku3` at native 3. Cross-family precedence inverts.
→ **Root fix (Opus):** build ONE `ordered` list across all three families, sort by
`(priority DESC, sku DESC, cfgIndex DESC)`, assign a single strictly-descending native-priority sequence
to the whole list, feed to ONE mount call. Loose dirs inserted at their REAL rank — not unconditionally on top.

### B3 — `resetLoose` destroys a pre-existing override file + fails UAT step 6 (Sonnet CRITICAL)
`ksk_all_spaceterminal.dds` is ALREADY in `stage\override\texture\` (from the 2026-06-28 hand-proof).
`deployLoose` records `preExisted=true` and overwrites; `resetLoose` then SKIPS it (`!preExisted` gate) →
original bytes gone forever, AND UAT step 6 ("verify file is REMOVED") fails → "pre-existing contents
intact" criterion silently violated. The unit test only checks the file isn't deleted, never that content
is restored.
→ Fix: snapshot `preExisted` files to `<studioDir>/snapshots/...` before overwrite; RESTORE (not skip) on reset.

### B4 — Loose overlay marks EVERY searchPath always-top (Opus Q1 caveat)
The TS overlay marks every searchPath `isOverride` (always wins), but real searchPath dirs sit at varied
priorities (5, 9, 10). A path in `ilm_extract`@5 AND a searchTree@8 → plan shows ilm_extract; engine →
tree@8. Loose dirs must resolve at their real priority rank (folds into the B2 root fix).

---

## HIGH (real correctness gaps, narrower scope)

### H1 — Intra-TOC duplicate resolution DIVERGES (Codex + Opus — CONVERGENT)
`SearchTOC` does NOT search the 131 TREs in order. It reads the TOC's full **193k file index**,
binary-searches by logical path, and uses that entry's `treeFileIndex` to pick the serving TRE. The plan
reads only the header+tree-name block (no index) → for duplicate logical paths it resolves by flat
later-added-wins instead.
Counterexample (Codex, real bytes): `string/ja/space/space_faction.stf` is in `patch_24_client_00.tre`
(tree 54) and `patch_15_02.tre` (tree 42); engine → `patch_15_02.tre` (TOC idx 112857); plan → `patch_24`.
Scope: ~3 duplicate paths / 193,475 in sku0. **Deploy E2E unaffected** (override @10 is above all TOC).
→ PRODUCT DECISION: (a) build the 193k-index reader now for full fidelity, or (b) accept as a documented
MVP limitation + log a warning when a duplicate logical path is detected (research deferred the index reader).

### H2 — Cross-deploy stale-file orphaning (Sonnet HIGH-1)
Deploy V1 writes A+B; deploy V2 writes A; V1's record is replaced; `resetLoose(V2)` never sees B → B
orphaned forever. Research called for "track and prune"; Plan 04 doesn't implement it.
→ Fix: `deployLoose` loads the prior `LooseDeployRecord` and `resetLoose(prior)` before writing.

### H3 — Hardcoded `swgemu.cfg` fallback defeats client.cfg installs (Sonnet HIGH-2)
`DeployDialog` (~line 140) fallback builds `path.join(boundClientPath,'swgemu.cfg')` for an unknown
install → `resolveOverrideDir` reads a non-existent cfg → null → deploy errors.
→ One-line fix: `resolveLayout(boundClientPath)?.cfgFile ?? 'swgemu.cfg'`.

---

## MED / LOW
- **MED (Cursor) — path-safety hardening:** `startsWith(overrideDir)` has a prefix-collision
  (`D:\override_evil` ⊃ `D:\override`) → use `+ path.sep`; drive-relative `C:foo` passes `isVirtualPathSafe`
  → tighten regex to reject `^[A-Za-z]:`; symlink/junction under overrideDir not inspected.
- **MED (Sonnet) — warn-only `delete`:** UI says "deployed" but the file stays → old texture keeps
  overriding. Surface skipped deletes in the dialog.
- **MED (Opus Q3) — `maxSearchPriority < 10` footgun:** override@10 filtered out → write target silently
  becomes the shared data root@9. Add a guard: refuse/ warn if `looseDirs[0]` priority > maxSearchPriority.
- **MED (Sonnet) — crash-orphan recovery:** mid-reset crash loses the record → next deploy can't diff. Pair
  with B3's `.swgtoolkit.bak` markers to identify toolkit-owned files.
- **LOW — A1 missing-tre logging (Sonnet MED-3):** log skipped tree-names (no `existsSync`) vs header count.
- **LOW — sku gating (Opus Q4 / Sonnet LOW-1):** `gameFeatures=33297` → all 4 skus load for THIS cfg, so
  mount-all is correct here; conditional break only for installs that gate a sku OFF. Log a fidelity note.

---

## Convergence map
| Finding | Codex | Cursor | Opus | Sonnet |
|---|---|---|---|---|
| .toc byte format correct | — | ✅ VERIFIED | — | — |
| Outer priority model correct | ✅ | — | ✅ | — |
| Intra-TOC duplicate divergence (H1) | ✅ counterexample | — | ✅ CONDITIONAL BREAK | (A1 noted) |
| Mount wiring breaks (B1/B2) | (impl. unverified) | — | ✅ X-1, X-2 | — |
| Reset destroys preExisted file (B3) | — | — | — | ✅ CRITICAL |
| Loose overlay over-prioritized (B4) | — | — | ✅ | — |
| Deploy lifecycle gaps (H2/delete/crash) | — | — | — | ✅ |
| Path-safety hardening | — | ✅ | — | — |

## Recommendation
Revise Plan 03 (single ordered mount per Opus root fix; B1/B2/B4), Plan 04 (B3 snapshot/restore + H2
prune + path-safety hardening + delete surfacing), Plan 05 (H3 cfg fallback). Resolve H1 as a product
decision (full index reader vs documented limitation + warning). Then re-check and execute.
