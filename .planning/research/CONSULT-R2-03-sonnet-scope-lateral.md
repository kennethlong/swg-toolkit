# CONSULT R2-03 — fresh Sonnet — Lateral: did the round-2 fixes overcorrect?

Angle: scope, sequencing, over-engineering, blind spots introduced BY the fixes. You did not
see round 1; judge the current plans fresh.

## LOCKED AXIOMS (given — don't review these)
- Native SAB gating (`NAPI_EXPERIMENTAL` + node-addon-api `^8.8.0`) is correct and settled.
- Whether cross-process SAB sharing is physically possible is a SEPARATE reviewer's job — assume
  it's an open empirical question the plan deliberately tests; don't try to answer it.

## THE OPEN QUESTION (your angle)
Round 1 flagged this as a "prove-the-wiring" DE-RISK phase that had crept into product work. The
replan then ADDED: prebuildify + node-gyp-build + @electron/rebuild distribution, a CI workflow,
`scripts/check-prereqs.js`, `.nvmrc`/`engines`, a cross-write SAB protocol, a real close/relaunch
restart test, and a decoupled `package:ci`. Ask:

1. **Did the de-risk phase overcorrect into a heavy phase?** Is any added machinery (CI,
   @electron/rebuild, prebuildify-for-Electron-ABI) itself a new un-de-risked risk that belongs
   in a later phase, or is each genuinely the cheapest way to retire a Phase-0 unknown?
2. **FND-02 proof circularity** (sanity, not the deep version — that's Opus): prebuilds/ is
   gitignored and generated on the SAME machine that has the compiler, then "resolved without a
   compiler" on that same machine. Does that actually de-risk no-compiler DISTRIBUTION, or just
   prove node-gyp-build can find a local file? Is there a cheaper honest proof, or should FND-02
   be partially descoped?
3. **Sequencing**: the riskiest empirical unknown (can the utility↔renderer SAB actually share?)
   is in 00-03 (wave 2) and only fully asserted in 00-05 (wave 4). Is there an earlier/cheaper
   canary? Should a 30-line spike prove SAB-sharing BEFORE 17 renderer files (00-04) are built?
4. **autonomous flags**: 00-01 + 00-02 now `false` (human checkpoint), 00-03 `true`,
   00-04/00-05 `false`. Sensible, or is 00-03 (the empirically riskiest, possibly-impossible SAB
   share) wrongly unattended?
5. **New blind spots** the fixes introduced: anything in the demux/correlation-id relay, the
   COOP/COEP `file://` fallback, or the prebuildify/ABI path that can silently false-pass?

## Files
- All five: D:/Code/SWG-Toolkit/.planning/phases/00-toolchain-de-risk-app-shell/00-0{1,2,3,4,5}-PLAN.md
- CONTEXT + RESEARCH + UI-SPEC in the same dir (to judge what's genuinely locked vs creep)

Deliverable: markdown, severity-tagged. Be willing to say "this is right-sized, ship it" if so —
don't manufacture concerns. The success signal is a productive disagreement with the other
reviewers, not echo.
