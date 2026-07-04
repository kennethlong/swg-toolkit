# Consult task (fresh Sonnet, round-3 spot-check): 04.4-12/04.4-15 split — execution seams

You are reviewing ONE structural change in a plan set: the extraction of a blocking real-server
checkpoint out of plan 04.4-12 into a new Wave-3 plan 04.4-15. Read-only; lateral/integration lens.

## Locked axioms (treat as given, do NOT re-derive or contradict)

1. Execution model: plans run in waves; a wave starts only when the previous wave's plans ALL complete. `autonomous: false` plans block on a human checkpoint.
2. The split's purpose: 04.4-12 (server-push UI wiring) is now fully autonomous in Wave 2; 04.4-15 (real-server round-trip checkpoint, `depends_on: ["04.4-12"]`, `autonomous: false`, `files_modified: []`) sits in Wave 3.
3. Contract locked in round 2: `resetCore3TreOverride` / `resetSwgMainOverride` are pure undo-the-write functions; clearing the persisted `serverPush.*.json` record files is EXCLUSIVELY 04.4-12's (the caller's) job.

## Evidence to read

- `.planning/phases/04.4-ux-polish-deploy-hardening/04.4-12-PLAN.md` and `04.4-15-PLAN.md` (the split pair)
- `.planning/phases/04.4-ux-polish-deploy-hardening/04.4-07-PLAN.md` and `04.4-08-PLAN.md` (the services 12 wires up)
- The wave table in `.planning/ROADMAP.md` Phase 04.4 section

## Your questions (integration-seam hunt — find what the split severed)

a) Orphan scan: does 04.4-12 still reference any content that moved to 04.4-15 (task numbers, acceptance criteria, "Task 3", checkpoint copy), or vice versa — anything that reads as if the other plan's content were still local?
b) Verification gap: 04.4-12 now completes "autonomously" — do its acceptance criteria still prove anything real without the server round-trip, or did the split hollow them out to jsdom-green-style assertions? What is the weakest criterion left?
c) Failure routing: if 04.4-15's real-server checkpoint FAILS in Wave 3, which plan's work gets reopened, and is there anything in Wave 3 (04.4-04, 04.4-14) that would have already built on 12's output by then? Is the blast radius acceptable or does the split create a late-discovery trap?
d) Anything else the split severed that the plans don't acknowledge.

Answer from the actual plan text; quote the lines you rely on.
