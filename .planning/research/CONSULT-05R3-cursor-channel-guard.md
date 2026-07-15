# Cross-AI Plan Review — Phase 5, ROUND 3 — CURSOR angle (channel byte-layout + guard integrity)

You are one of four independent reviewers of an implementation plan for a Star Wars Galaxies modding
toolkit. Your angle: the **SharedArrayBuffer channel byte-layout** and the **guard/liveness state
machine** — is it internally consistent across the plans that touch it, and does the round-3 replan's
new `scaleUnavailableOnBuild` bit and revised revert model wire correctly end-to-end?

## Architecture (treat as given)
An x86 agent DLL injected into the running SWG client shares a fixed-layout SharedArrayBuffer with the
toolkit. A seqlock-guarded read frame streams live object state to the toolkit; the round-3 plans add a
toolkit→agent **write command slot** (latest-wins, single slot) plus a **guard word** (guardStatus /
guardAddr) that fails writes closed when live bytes don't match the toolkit's snapshot. A **liveness**
bitfield reports per-build capability degradation.

## Plans to read (in full, from the repo)
- `.planning/phases/05-wysiwyg-live-sync-typed-editors/05-01-PLAN.md` (channel layout growth — contracts)
- `.planning/phases/05-wysiwyg-live-sync-typed-editors/05-03-PLAN.md` (agent-side guard + liveness bits)
- `.planning/phases/05-wysiwyg-live-sync-typed-editors/05-04-PLAN.md` (host-side write command binding)
- `.planning/phases/05-wysiwyg-live-sync-typed-editors/05-07-PLAN.md` (renderer decode of guard/liveness + revert)
- `.planning/phases/05-wysiwyg-live-sync-typed-editors/05-11-PLAN.md` (guard/tamper banner UX)
- Existing contract to extend (do NOT let the plan invent a parallel layout):
  `packages/contracts/src/live-inject.ts`

## Prior-round facts you can treat as established (round 2 confirmed these)
- The 396-byte layout was verified non-overlapping and identical across 05-01/04/07; `LIVE_READFRAME_BYTES=316`
  math was correct; host seqlock payload `324..387` does not touch `GUARD_STATUS`/`GUARD_ADDR` (`388..395`).
- A prior plan-text defect: 05-04 `must_haves` said the host WriteCommand span ends at **391**; the
  actual memcpy ends at **387**. Verify this was corrected in the current file.

## What the round-3 replan CLAIMS to have changed (verify each against the actual files)
1. **W2 fix — new liveness bit4 `scaleUnavailableOnBuild`.** Previously `SCALE_REFUSED` (guard bit `0x2`)
   was set for TWO unrelated causes: a real scale tamper OR `setScale` simply being unresolved on the
   advertised build — causing a false "tamper" banner on essentially every advertised-build run. The fix:
   stop setting `SCALE_REFUSED` for `!setScale` alone; add liveness bit4 `scaleUnavailableOnBuild`,
   computed ONCE after resolve as `isAdvertisedClient() && setScale == nullptr`. 05-07 decodes bit4;
   05-11 precedence: bit4 set → "Scale unavailable on this build"; `guardState.scale === 'blocked'`
   WITHOUT bit4 → tamper banner. Claim: **zero channel-size growth** (bit reuses the liveness word).
2. **Revert model.** Round 2 found `revertWrite`/`revertAll` sent `writeRebaselineGuard` then the revert
   write **unconditionally on every revert**, which trivially makes the guard pass — silently discarding
   any external change the guard would have caught (an effective force-write for the revert case, which
   D-03 says must not exist). Agreed fix: only rebaseline when `guardState === 'blocked'`, and surface
   what external change was discarded. Also a liveness bug: rebaseline + revert are two commands on a
   single-slot seq-keyed channel fired back-to-back; the agent may poll only the later one and miss the
   rebaseline. Verify the current 05-07 gates on `blocked` AND handles the two-command race (ack-gate or
   coalesce into one apply-after-rebaseline command).

## Your task (Cursor — byte + state integrity)
Do a precise file:line trace and answer:
1. Is the byte layout STILL non-overlapping and identical across 05-01/03/04/07 after the replan? Did
   adding bit4 or the revert changes shift any offset or grow the frame? Recompute the spans.
2. Does bit4 `scaleUnavailableOnBuild` decode consistently in 05-07 and drive the correct precedence in
   05-11 (bit4 → "unavailable", blocked-without-bit4 → tamper)? Is there any state where BOTH fire, or
   neither, and the UX is ambiguous?
3. Does the revised revert path actually gate on `blocked` (not unconditional), and is the two-command
   rebaseline+revert race genuinely closed (ack-gate/coalesce) or just described? Trace the exact
   sequence the agent polls.
4. Is `contracts/live-inject.ts` extended, not forked? Any field the renderer decodes that the contract
   doesn't define (or vice versa)?
5. Any off-by-one, sign, endianness, or alignment issue in the guard word / liveness bitfield.

## Output format (markdown)
1. **Summary** — one paragraph: is the channel + guard state machine internally consistent post-replan?
2. **Verified** — spans/offsets/decodes you re-derived and CONFIRMED (with file:line + the number).
3. **Concerns** — bullets, severity HIGH / MEDIUM / LOW, each with the exact file:line + byte offset.
4. **Suggestions** — specific.
5. **Risk Assessment** — LOW / MEDIUM / HIGH + justification.

Be concrete about numbers. A layout claim is only "verified" if you recomputed it.
