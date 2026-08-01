# YOUR ANGLE (Opus): locked-decision fidelity, design-pick integrity, and graph/spec math

Authorization context: this is the maintainer's own open-source SWG modding toolkit; the "live" features
are out-of-process editor tooling for the maintainer's locally-run game client, already designed and
reviewed across five rounds. You are reviewing PLANNING DOCUMENTS (markdown), not writing injection code.

Working directory: D:\Code\SWG-Toolkit. Read the preamble (below) first, then execute this task.

Your axis: does the round-5 replan (commit `3d0a605`) keep faith with the LOCKED decisions and upheld
design picks, and is the plan-set's internal math still sound? Do not trace call graphs (Codex has that)
or check line citations (Cursor/Fable have those).

1. **Locked decisions D-01–D-14 (`05.1-CONTEXT.md`) vs the six revised plans:** for each decision the
   revisions touch (Undo semantics, Remove behavior, "(NEW)" marking, mirror-mode reconcile, error
   surfacing), verify the revised text still delivers the decision as locked — not a quietly narrowed
   version. Explicitly re-examine the two standing scope reductions with fresh eyes: (a) D-02's
   "(+ live despawn)" delivered only as an unreachable mechanism; (b) any V-fix that further narrows what
   the user actually gets. Distinguish "disclosed and adjudicated" from "newly narrowed this round."
2. **The two ROUND-4 DESIGN PICKS after their V-fixes:** round 5 upheld the picks in concept but found
   mechanism defects. Verify the V2/V3 fixes leave the content-identity "(NEW)" pick actually delivering
   its stated purpose (a restored row is never marked NEW; a genuinely new row always is — check the
   claim against the pick's own rationale text), and the V4/V7 fixes leave two-phase reconcile still
   satisfying its atomicity claim as WRITTEN in Plan 06 (is "atomic" now qualified correctly given
   `diskState: 'uncertain'` exists — i.e., does any plan still over-claim "never partial"?).
3. **Success criteria SC1–SC5 (`.planning/ROADMAP.md` Phase 5.1):** map each SC to the plans that
   deliver it post-revision. Any SC weakened by the V-fixes (e.g., wording that now promises less than
   the SC does)?
4. **Spec math:** Plan 15's verification script claims 13 numbered steps — count them. The gap ledger
   claims items (a)–(g) — are all seven present, distinct, and each tied to a disclosed reduction or
   accepted risk? Wave math: 6 waves, wave = max(dep waves)+1, acyclic — spot-check the revised plans'
   frontmatter. Threat-model IDs cited in the revisions (e.g., T-05.1-06d, T-05.1-13b) — do they exist
   in the named plans' `<threat_model>` blocks?
5. **Adjudication:** end with an explicit verdict per design pick: KEEP / KEEP-WITH-FIX / VETO, with one
   sentence of reasoning each.

Cite plan/CONTEXT/ROADMAP file + line for every claim.
