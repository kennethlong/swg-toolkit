# YOUR ANGLE (Fable): fact-check ONLY the NEW claims commit `667225f` injected

The project's standing risk: a `--reviews` replan can inject plausible-but-fabricated file/API/line claims
while fixing the reviewed ones. Rounds 3 and 4 found zero fabrications in the prior replans; verify round 5
kept that record.

Scope: `git diff 07958ef..667225f -- .planning/phases/05.1-live-world-editor-productization/` — ONLY lines
ADDED by this commit. Do not re-litigate pre-existing claims (rounds 3–4 already verified them).

For every added claim that asserts something about the REAL codebase (a file exists, a symbol has a
signature, a line contains X, an algorithm already exists to be "reused", a behavior is "proven"), verify it
against the actual file on disk:

1. The corrected citations: `useChannelReader.ts:272`, `LiveSyncClientCard.tsx:159` (clientLabel),
   `overlay.cpp:443` (`channelWriteCapture` call site) — exact-line check.
2. The claim that Plan 14's "(NEW)" diff "reuses Plan 04's `refresh()` reconciliation algorithm
   (buildingId+cellName+objectTemplateName)" — is that algorithm actually specced in Plan 04 with that exact
   key, or is the reuse claim embellished?
3. Any added claim about `reconcileMirrorMode`'s operations being invertible with existing file APIs.
4. Any added file path, export name, store field, channel constant, or line number not covered above —
   enumerate each, mark TRUE / FALSE / UNVERIFIABLE with the evidence line.

Also flag claims phrased as fact that are actually forward-looking design (should be phrased as executor
tasks). Real source lives in `packages/` (renderer/contracts/agent) in this repo; reference projects are
siblings under D:\Code\ if needed.

Verdict: CONVERGED (factual) if zero load-bearing false claims; otherwise list each false claim with
severity by how load-bearing it is.
