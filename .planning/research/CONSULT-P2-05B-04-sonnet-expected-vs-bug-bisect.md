# Angle 4 (lateral) — separate the EXPECTED fidelity gap from the actual BUG; predict post-fix

FIRST read `.planning/research/CONSULT-P2-05B-AXIOMS.md` (LOCKED ground truth L1–L5).
Look at the two reference images: C:/Users/kenne/Downloads/redrobo1.png (live, glossy clean C-3PO) and
C:/Users/kenne/Downloads/redrobo3.png (export in Blender — grungy/matte, scrambled face, eyes glow).

You are the lateral reviewer. Don't dig into one subsystem — bound the problem:

1. **Expected vs bug.** The export intentionally DROPS specular + environment reflection + the 0.40 ambient
   floor (L5); the live droid is glossy reflective metal. Quantify how much of the "catty mess / grungy" look
   is the EXPECTED loss of gloss+reflection on a smooth metal face (a tracked fidelity gap, not a bug) vs a
   genuine defect. A reflective face rendered matte-diffuse-only legitimately looks flat/odd — is that most of
   what we're seeing?

2. **The confirmed emissive bug (L3).** Predict what the face/part looks like AFTER fixing emissive to use the
   alpha mask (L2) instead of RGB. Will the near-white glow go away and the face read correctly, or will a
   scramble remain (implicating geometry/UV — see angle 3)?

3. **Cheapest bisecting experiments** (things the maintainer can do in ONE export each) to attribute the
   residual: e.g. (a) export with emissive fully OFF — does the face still scramble? (b) compare a flat body
   panel vs the face under identical Blender lighting; (c) toggle Blender Studio vs a single sun light. Order
   them by information-per-effort.

4. **Scope call.** Given this is Phase 2's export MVP (interchange that opens in DCC tools), which residuals
   are worth fixing NOW vs deferring to the VIEW-MAT-FIDELITY backlog (specular/env/lighting)? Recommend the
   stopping line so we don't chase glossy-shader parity that glTF-PBR can't cheaply express.

Output: a ranked attribution (X% expected-gloss-gap, Y% emissive bug, Z% suspected geometry), the predicted
post-emissive-fix state, the bisect experiments in priority order, and a clear "fix now vs defer" line.
