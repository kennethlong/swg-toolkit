# Cross-AI Plan Review — Phase 5, ROUND 3 — OPUS angle (spec-correctness / invariants / races)

You are one of four independent reviewers of an implementation plan. Your angle: **invariants,
concurrency, and fail-safe correctness.** You reason precisely about state machines, races, and the
exact conditions under which a safety guard holds or fails. You are the reviewer who confirms whether a
"fails-safe" claim is actually true under adversarial timing.

## System model (treat as given)
An x86 agent DLL runs inside the SWG client's process and, each client frame, reads a toolkit→agent
command slot from a SharedArrayBuffer and applies it by calling the client's own `setTransform_o2w` /
`setScale`. Before each write, a read-verify guard compares current live object bytes to the toolkit's
captured snapshot and **fails closed** (refuses the write, reports the mismatch). The command slot is
**single, latest-wins, seq-keyed** — the agent polls the newest command each frame and intentionally
drops intermediate values. Target resolution finds the live `Object*` fresh each frame.

## Plans to read (in full, from the repo)
- `.planning/phases/05-wysiwyg-live-sync-typed-editors/05-03-PLAN.md` (agent guard + resolution + setters)
- `.planning/phases/05-wysiwyg-live-sync-typed-editors/05-07-PLAN.md` (renderer revert/rebaseline logic)
- `.planning/phases/05-wysiwyg-live-sync-typed-editors/05-04-PLAN.md` (host write command binding)
- `.planning/phases/05-wysiwyg-live-sync-typed-editors/05-CONTEXT.md` (D-02 latest-wins slot, D-03 guard/COW)

## Round-2 invariant findings the replan claims to have fixed (verify each holds under timing)
1. **Revert rebaseline race.** Round 2: `revertWrite`/`revertAll` sent `writeRebaselineGuard` (seq N)
   then the revert write (seq N+1) back-to-back on the single-slot channel; the agent may poll only
   seq N+1 and MISS the rebaseline → revert runs against the un-rebaselined baseline and stays blocked
   (fails safe, but flaky — defeats the un-stick purpose). Agreed fix: ack-gate the revert on an observed
   guard-status clear, OR coalesce rebaseline+revert into ONE "apply-after-rebaseline" command. Verify
   which the replan chose and whether it actually removes the race (no interleaving of a third command,
   no lost-wakeup, seq monotonicity preserved).
2. **Revert should only rebaseline when `guardState === 'blocked'`** (not unconditionally) — else every
   revert is an effective force-write. Verify the guard condition and that a tamper landing between the
   check and the write re-blocks (fails safe forward — no foreign data ever reaches `setTransform_o2w`).
3. **Off-thread setter lifetime race.** The sim thread can delete/relocate the resolved `focus` between
   resolution and the setter call → write-to-freed / torn state. Round 2 said the 4-sentinel + torn-read
   checks guard *reads*, not the setter's target lifetime; the new dual-setter + resolver chain widens
   the window. Verify whether the replan added any mitigation or a UAT watch item, and whether the
   fail-safe claim survives a mid-resolution parent move.
4. **Fix-D (interior read-back) is STATIC-cell only.** Refreshing `s_expectedTransform` from a fresh
   `getTransform_o2w(focus)` survives static non-world-cell/interior objects but DRIFTS for a
   dynamically-moving parent (mount/vehicle/POB) → guard false-fails independent of tamper. Verify the
   plan added the "static non-world-cell only" caveat rather than claiming unqualified "survives
   non-world-cell objects."

## Your task (Opus — invariants)
For each of the four above, state precisely: **the invariant, whether the replan's mechanism preserves
it, and the exact interleaving (if any) that violates it.** Then scan for NEW invariant violations the
round-3 changes introduced (the new `getSelectedObject` resolution path, bit4 `scaleUnavailableOnBuild`
computed "once after resolve" — is "once" safe if resolution can change per frame or the setter is
re-resolved on a different build state?). Distinguish memory-UNSAFE (corruption/UAF) from
intent-UNSAFE (wrong-but-not-crashing) from flaky (fails-safe-but-unreliable).

## Output format (markdown)
1. **Summary** — one paragraph: are the safety invariants preserved under adversarial timing?
2. **Invariant-by-invariant** — for each of the 4 findings + any new ones: INVARIANT / MECHANISM /
   HOLDS or VIOLATED-BY-INTERLEAVING (name the exact sequence).
3. **Concerns** — bullets, severity HIGH / MEDIUM / LOW, classified memory-unsafe vs intent-unsafe vs flaky.
4. **Suggestions** — specific, minimal.
5. **Risk Assessment** — LOW / MEDIUM / HIGH + justification.

Precision over breadth. One proven interleaving that breaks an invariant is worth more than ten vague
worries.
