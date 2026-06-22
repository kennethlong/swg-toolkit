# CONSULT R3-04 — fresh Opus — Proof quality: any residual proxy after two rounds?

Third round. Two rounds of proof-tightening are in. Your job: a final adversarial pass for any
proof that STILL passes while its claim is false — plus the one self-certification concern that has
lingered. You did NOT see rounds 1-2.

## LOCKED AXIOMS (given)
- NAPI gating settled. SAB-sharing is a deliberate likely-negative experiment; YOUR concern is only
  whether the TESTS correctly distinguish outcomes and whether sign-offs are independent — not the
  physics.

## OPEN QUESTIONS (your angle)
1. **Residual proxies.** Trace SC-1..SC-5 and FND-01..05 to their concrete assertions one more time.
   After two rounds, is there ANY criterion still proven only by a source-text `grep` with no
   behavioral counterpart, or any assertion that a copy/echo/skip world could still satisfy? Pay
   special attention to anything the round-2 edits TOUCHED (argless crossWriteSab + nonce; the
   build.bak/__resolvedPath FND-02 proof; the Object.keys allowlist; SC-5 real userData; the
   05-packaged skip=fail gate). For each, one-word verdict AIRTIGHT / PROXY / FLAKY / FALSE-PASSABLE.
2. **Nyquist self-certification (the lingering one).** VALIDATION.md is a TEMPLATE today; 00-05 Task 2
   fills the Per-Task Verification Map AND authors the SC tests, while 00-05 Task 4 flips
   `nyquist_compliant`. Is the sign-off ACTUALLY independent now, or does the SAME plan (00-05) both
   author the tests and certify their adequacy? An independent gate means the certifier is NOT the
   author. Is Task 4 genuinely separable from Task 2, or is it self-grading? If self-grading, what's
   the minimal fix (e.g., the verifier at phase-close re-derives coverage, or a different plan/agent
   owns the flip)?
3. **FND-02 honest-downgrade integrity.** The wording was downgraded to "non-circular resolution +
   Electron-ABI packaged load; full no-compiler-MACHINE proof deferred to CI." Does the 00-05 Nyquist
   bullet and the 00-02 SUMMARY scope genuinely MATCH (no drift where one claims more than the other),
   and does anything downstream (a must_haves truth, a success_criterion) still overclaim FND-02 as
   fully proven? Could execution legitimately report "FND-02 done" while only the deferred-to-CI
   partial proof ran?

## Deliverable
markdown. A residual-proxy table (criterion → verdict → failure path if not airtight). Then a clear
call on the Nyquist independence question (INDEPENDENT / SELF-GRADING + minimal fix). Then FND-02
wording-drift verdict. If everything is airtight after two rounds, say so — that is a valid and
important result for a go/no-go decision.

## Files
- All five 00-0{1,2,3,4,5}-PLAN.md + RESEARCH + VALIDATION in
  D:/Code/SWG-Toolkit/.planning/phases/00-toolchain-de-risk-app-shell/
