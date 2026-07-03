# Angle C (fresh Sonnet — lateral / model): should selecting a version DEPLOY to the live client?

Read the LOCKED ground truth in `.planning/research/CONSULT-VG-00-GROUND-TRUTH.md` first.

Step back from the code and reason about the MODEL. Currently (facts #1, #2): clicking a version row
in the graph immediately reconciles (deploys/reverts) the REAL running game client to that version,
and only moves the "selected" pointer if that deploy succeeds. Consequences observed: selecting a
version that was never built/deployed fails (S1), and selecting-to-view mutates a real client.

The competing model: **decouple selection from deployment.** Selecting a version = move
`activeVersionId`, load its files into the working set, highlight it (NO client mutation). Deploying =
an explicit action (the existing "Deploy vN" button) that reconciles the live client to the selected
version.

Analyze and recommend:
1. Which model is more intuitive and less dangerous for a modding tool that mutates a real game
   client install? Weigh: browsing history, unbuilt versions, accidental client mutation, undo.
2. If decoupling: what happens to the D-08 "selected ≡ live" invariant? Is it still meaningful, or
   should `deployedVersionId` simply lag `activeVersionId` until an explicit Deploy?
3. What breaks if we decouple (undo of a live switch, the "live" pip meaning, silent-reconcile UX)?
4. Migration: the smallest set of behavioral changes to move from "navigate = deploy" to
   "navigate = select; deploy = explicit," WITHOUT a big rewrite.
5. Counter-argument: is there a real user benefit to "navigate = deploy" (instant in-game preview)
   worth keeping? If so, how to keep it safe (e.g. only deploy on an explicit toggle)?

You may read the repo. Give a clear recommendation with rationale, not just options.
