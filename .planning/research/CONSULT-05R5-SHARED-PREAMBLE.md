# Phase 05 round-5 review — SHARED PREAMBLE (what changed since round 4)

You are one of four INDEPENDENT reviewers. Do NOT trust the plan's self-assessment prose — verify against
the real plan text + real source. A grounded disagreement is worth more than agreement.

## Context (background, not truth to accept)

Phase 05 = a zero-restart WYSIWYG write loop over a SharedArrayBuffer channel between an x86 agent DLL
(injected into the user's own SWG client — authorized single-user tool) and an x64 host. Rounds 1-4
closed the crash BLOCKER and two provable HIGHs. The round-4 crew dropped the verdict to MEDIUM but found
the round-4 baseline-re-key left a **host/agent identity-key mismatch** (host keyed on
`(networkId, templateName)`, agent on the raw `focus` pointer; legacy `networkId≡0` → same-template
objects collide → Revert All force-writes the wrong object's pose; fails OPEN) plus a lossy focus-flip
case. The maintainer chose Path A. **This round-5 replan CLAIMS to have applied the four Path-A fixes.**
Confirm each is real and correct, and — most importantly — that fix #1 actually closes both round-4
MEDIUMs WITHOUT opening a new one.

## LOCKED ground-truth axioms — do NOT re-derive or contradict
- The SWG client is x86 (32-bit): a live `Object*` is a 32-bit pointer, so
  `static_cast<uint32_t>(reinterpret_cast<uintptr_t>(focus))` is the FULL pointer value (no truncation).
- Legacy RVAs: `setTransform_o2w=0x00B22CC0`, `setScale=0x00B23A10`,
  `cachedNetworkIdGetObject=0x00B30160` (network.cpp:42 literal/:35 typedef),
  `idManagerGetObjectById=0x00B380E0`, `+1432` player-lookAt slot (game.cpp:733); legacy `networkId≡0` on
  the focus path (Fix E — LOCKED, the +1432 slot is the player's TARGET, not the object's own id).
- Advertised catalog KEYS `cuiHud::getTarget` / `cuiHud::g_instance` / `network::getObjectById` are
  correct; round 4 found their line citations in engine_advertise.cpp are 705/706/709 (round-5 claims to
  have fixed them from the old 703/704/707).
- `kLegacyScaleOffset = 0x44` is a PLANNER-COMPUTED VALIDATE-LIVE candidate, not measured.
- The round-3/round-4 CLOSED work is CLOSED — do NOT re-litigate: the gated rebaseline (grep-proven
  05-03:~1011), the agent-side baseline re-key, the SEH span, the 396→(now 400) layout discipline, the
  STOP sticky bit, the 05-12 mismatch UAT. Only the round-5 residue below is in scope.

## The FOUR round-5 changes CLAIMED applied (VERIFY each)
1. **Identity unification (the load-bearing fix).** A NEW read-frame field `FOCUS_TOKEN` at offset 320
   (len 4), the agent's own truncated `addrOf(focus)`, published into the SEQLOCKED READ FRAME **every
   tick** (not just into GUARD_ADDR at apply). This GROWS the layout: command region shifts +4
   (COMMAND_SEQ 324, COMMAND_TRANSFORM 328, COMMAND_SCALE 376, COMMAND_FLAGS 388, GUARD_STATUS 392,
   GUARD_ADDR 396); `LIVE_READFRAME_BYTES` 316→320; TOTAL 396→400. The host re-keys
   `cowSnapshot`/`writeLog` on `focusToken` (NOT `networkId`/`templateName`), and a per-identity
   `identityCache: Map<focusToken, IdentitySlot>` replaces the single snapshot slot so a focus-flip
   A→B→A restores rather than re-captures. Lands in 05-01 (layout), 05-03 (agent publish), 05-04
   (host write span + CHANNEL_BYTE_SIZE), 05-07 (host decode + re-key + cache), 05-12 (soak byte asserts).
2. **Overclaim purge.** The "closes ... for real" phrase struck from 05-03 success_criteria + 05-10
   T-05-30; 05-10's unauthorized (a)/(b) split deleted; the banned phrase now only in `#` archived lines.
3. **HUD name-only caveat.** 05-11 renders "(name match only — not a verified object identity)" when the
   loaded-asset basename matches the target templateName basename (was: silent → false reassurance).
4. **Minors.** bit6 `agentFaultRecovered` documented agent-only; `liveStore.guardAddr` named in 05-11's
   guard-blocked banner; scale-only `lastDiscardedChange.got` uses a `gotVerified` flag + honest copy (no
   second channel field this round — deliberate); advertised catalog citations → 705/706/709 in 05-03;
   `getPlayer()` pulled inside the `__try` span; "only identity source" softened (Object::networkId is a
   real field, object.h:86).

## Files
- Plans: `.planning/phases/05-wysiwyg-live-sync-typed-editors/05-01,03,04,07,10,11,12-PLAN.md`
- `.../05-REVIEWS.md` (round 4 + the "MAINTAINER DECISIONS Path A" block = the spec this round applied).
- Real source under `D:/Code/Utinni` and `D:/Code/swg-client-v2`.

## Output
Per-change VERDICT (CLOSED / STILL-OPEN / NEW-ISSUE) with the exact plan or source file:line that proves
it, severity for anything not closed, overall risk verdict. Ground every claim in a file:line.
