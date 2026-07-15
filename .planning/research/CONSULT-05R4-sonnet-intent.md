# Round-4 review — SONNET angle: intent-closure / lateral / honesty

Read `.planning/research/CONSULT-05R4-SHARED-PREAMBLE.md` first (locked axioms + the five claimed
changes). Then take THIS angle only (leave citations, byte-layout, and concurrency-invariants to the
other three reviewers):

**In round 3 you found the WYSIWYG promise unmet AND the plan self-contradicting about it. The maintainer
chose option (a): keep the narrow capability but be HONEST about it (a HUD mismatch warning + fixed prose
+ a deliberate-mismatch UAT + softened LIVE-03 language). Your job: is the round-4 replan now actually
honest, and does the UAT genuinely surface the gap instead of hiding it?** Think like a modder who did
NOT read the plan — only uses the tool.

Verify specifically:

1. **The self-contradiction is gone.** Round-3 05-03 said both "there is NO template→live-Object* resolver
   … does not attempt" AND "this round actually closes the round-1 viewport-mesh finding". Confirm the
   round-4 05-03 note now says ONLY the honest version ("makes the fallback real/symmetric on both builds;
   does NOT close the viewport↔live binding gap, deferred to Phase 7 `.ws`") with NO residual "closes for
   real" language anywhere in 05-03 OR 05-10. Grep for it. A single surviving overclaim is a MEDIUM.

2. **The HUD warning actually fires in the failure case.** 05-11 claims an inline `⚠ viewing <loaded>,
   moving <target>` warning driven by loaded-asset-name vs `verifiedState.templateName`. Walk the modder
   scenario: load Stormtrooper mesh, attach, do NOT select a Stormtrooper in-game, drag. Does the warning
   fire? Now the coincidence case: load `womprat`, have an UNRELATED `womprat` NPC selected — the names
   match by string but are different networkIds. Does the plan warn (or at least not falsely reassure)?
   Is the comparison name-only (fragile) — and if so, is that limitation disclosed?

3. **The UAT surfaces the gap.** Round-3: 05-12 pre-arranged the one scenario where the gap is invisible
   ("object matching the live focus object"). Confirm 05-12 now has a REQUIRED (not optional) step that
   deliberately loads asset X while an unrelated object Y is selected, and records the maintainer
   acknowledging the ⚠ warning + the moved-Y-not-X behavior. If the UAT still only tests the matching
   case, the gap is still hidden — HIGH.

4. **LIVE-03 status honesty.** Wherever LIVE-03 is marked delivered (05-10, 05-12, must_haves), is the
   language softened to reflect that viewport↔live binding is deferred? Or does something still imply
   "drag the thing you loaded and it moves"? Flag any place a reader would conclude the binding works.

5. **Lateral check.** Anything ELSE the round-4 edits make dishonest or confusing as a side effect — e.g.
   the re-key / STOP-bit / SEH additions creating a user-visible behavior the UI doesn't explain, or a
   liveness bit shown as a capability that's actually a self-compare?

Output: per-item VERDICT (HONEST-NOW / STILL-MISLEADING / NEW-CONFUSION) with the plan line proving it,
severity for anything not honest, and an overall: could a modder who trusts this tool be misled about
what moved? Anchor to plan file:line.
