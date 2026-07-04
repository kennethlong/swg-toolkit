# Consult task (fresh Opus, round-3 spot-check): decision-table consistency after round-2 edits

You are auditing a freshly revised 15-plan set against its locked decision table for internal
consistency. Read-only; spec-consistency lens. This is planning-document review for an
open-source modding toolkit (no live-memory work in this phase).

## Locked axioms (treat as given, do NOT re-derive or contradict)

1. D-04a maintainer ruling: undo after project delete = restore project bytes from `.trash` only; NO automatic re-deploy; the client stays in its delete-restored state. This ruling is settled — do not reopen whether it is the right design.
2. D-24 mount ground truth: Core3 live tree via `\\wsl.localhost\<distro>` UNC (local checkout is dead at runtime), TrePath resolves config-local.lua-first (`/mnt/d/...` → host drive letter), restart-required reload; swg-main via VirtualBox VM Samba share, live-for-new-assets + `reloadTable`/`reloadServerTemplate` reload semantics.
3. Where a plan's REVISION NOTE says a review claim was REJECTED with code evidence, take the rejection as given.

## Evidence to read

- `.planning/phases/04.4-ux-polish-deploy-hardening/04.4-CONTEXT.md` — the full D-01..D-24 decision table
- All 15 plans: `.planning/phases/04.4-ux-polish-deploy-hardening/04.4-{01..15}-PLAN.md`
- `.planning/ROADMAP.md` Phase 04.4 section (success criteria SC #1–#5)

## Your questions (consistency audit — classify, don't silently resolve)

For each finding, classify as: CONSISTENT / NARROWS-INTENT (needs a maintainer ruling; flag the
ambiguity, do not resolve it yourself) / CONTRADICTS (hard defect). Two known candidates plus a sweep:

a) D-21 says "make the TRE read/write path a pluggable codec interface ... so custom compression/encryption can be dropped in." Plan 04.4-06 scopes the seam to per-entry payload compression only, leaving TOC/name-block zlib hardcoded, with a stated chicken-and-egg rationale. Does the plan's scoping satisfy D-21's literal wording? Its plausible intent? Classify.
b) ROADMAP SC #2 says the Playwright suite drives "the full deploy loop ... with zero console errors" (unqualified). Plan 04.4-13 explicitly scopes E2E to the cfg-model fixture only (documented as a conscious boundary). Classify against SC #2's wording and intent.
c) Sweep the remaining decisions (D-01..D-24) and SC #1/#3/#4/#5 against the plan set: any decision whose round-2 edits made two plans state different contracts for the same thing (e.g. who clears a record file, ordering contracts, undo semantics, wave placement promises)? Any plan text that still contradicts D-04a or D-24 anywhere?

Cite plan file + section for every claim. A clean CONSISTENT verdict is a valid answer if that is what the documents show.
