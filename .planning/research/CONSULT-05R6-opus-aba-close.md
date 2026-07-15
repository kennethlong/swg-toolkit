# Round-6 review (LIGHT) — OPUS: does the structural ABA close actually work, on both sides?

You are the invariant reviewer who FOUND the round-5 pointer-ABA fail-open. The round-6 replan claims to
close it structurally (maintainer option a). Verify from control flow; do NOT trust the plan's prose.

## Context (locked — do NOT re-litigate)
Phase 05 live-sync write loop (authorized single-user tool, x86 client). Prior rounds closed a crash
BLOCKER + two HIGHs + two MEDIUMs. Round 5's identity-unification (a read-frame `FOCUS_TOKEN` = raw x86
`Object*`, host `identityCache: Map<focusToken, IdentitySlot>`, agent `s_expectedCapturedAgainst`) closed
the round-4 same-template revert + focus-flip MEDIUMs but opened pointer-ABA: despawn A → client reallocs
C at A's old address → target C → host HITS A's stale cache slot / agent skips re-capture → Revert All
writes A's pose to C (fail-open, dual host+agent blind spot). x86 = full pointer (Codex-verified, locked).
The 400-byte layout, gated rebaseline, SEH span, STOP bit, both round-4 MEDIUM closures are all CLOSED —
do NOT re-review them.

## The round-6 fix CLAIMED applied (verify)
- **05-07 (host):** on every `identityCache.get(focusToken)` HIT, cross-check the cached slot's
  `templateName`/`networkId` vs the CURRENT read-frame state; on mismatch → evict + recreate (safe miss),
  NOT restore. Plus a bounded LRU (cap ~64, `lastActiveMs`-based eviction). No channel growth (reuses
  already-decoded fields).
- **05-03 (agent mirror):** `s_expectedCapturedAgainst` paired with captured `templateName`/`networkId`;
  re-capture on pointer mismatch OR identity mismatch.

## Verify (read 05-03, 05-07 PLAN.md in .planning/phases/05-wysiwyg-live-sync-typed-editors/)
1. **Cross-template ABA — now CLOSED?** Reconstruct: edit A (rock.iff); A despawns; C (crate.iff) reallocs
   at A's address; target C. Does the host cross-check catch `crate.iff != rock.iff` on the cache HIT and
   recreate C's slot (so Revert All uses C's own baseline, not A's)? Does the agent mirror also re-capture
   (so C's guard baseline is C's, not A's stale one)? Confirm BOTH sides — a one-sided fix still fails open
   on the unprotected side.
2. **Same-template ABA residue — correctly accept-watched?** Edit rock A; A despawns; rock C (same
   rock.iff, legacy networkId≡0) reallocs at A's address; target C. The cross-check can't distinguish them
   (`rock.iff==rock.iff`, `0==0`) → still collides. Is this residue explicitly accept-watched (threat entry
   + 05-12 UAT step), NOT silently claimed closed? Confirm the plan does not overclaim.
3. **NEW hazards the cross-check / LRU introduce — hunt:**
   - **LRU evicts an ACTIVE slot?** With cap 64, can the currently-edited identity be evicted (e.g., 64
     other objects targeted in between) — losing its baseline/writeLog mid-edit? Is the active slot
     protected from eviction, or `lastActiveMs`-refreshed each tick so it's never LRU-victim?
   - **Cross-check false-evict?** Can a legitimate same object ever transiently report a different
     templateName/networkId (torn read? load-in-progress?) and get wrongly evicted+recreated, dropping its
     history? (Recall FOCUS_TOKEN + templateName + networkId all ride the same read-frame seqlock.)
   - **Host/agent divergence on the cross-check?** Host evicts-recreates on identity mismatch; agent
     re-captures on identity mismatch. Do they use the SAME identity signal so they can't disagree about
     whether C is new?
4. **Regression:** did the cross-check/LRU perturb any CLOSED path? (Should be pure additive comparison.)

Output: per-item VERDICT (CLOSED / STILL-OPEN / NEW-ISSUE) with interleavings + plan line numbers,
severity for anything open, and a FINAL call: is the plan safe to execute now, or is one more turn needed?
