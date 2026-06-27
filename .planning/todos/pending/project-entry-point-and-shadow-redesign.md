---
id: project-entry-point-and-shadow-redesign
title: Project entry point in Assets tab + rethink the shadow-files model (hardlinks vs full copy)
created: 2026-06-27
origin: Maintainer design discussion during Phase-4 UAT
severity: medium-high (UX + architecture)
area: renderer / Assets tab (TRE browser) + workspace entry + deploy shadow models
status: pending
disposition: design note for the rework task; open question on shadow strategy + one ground-truth verification needed
related: project-binds-and-automounts-client-tres, staging-workflow-redesign, e2e-deploy-flow-coverage
---

## Proposal (maintainer)

1. **Move the project entry point to the Assets tab** — add an **Open/Create Project** button next to
   **Mount Archive…** (TRE browser lives in Assets). Opening it presents the folder picker to select
   the project root. This makes "start a project" the natural front door, co-located with the browser,
   instead of buried as the Staging/Changesets empty-state.
2. **Detect the selected folder's kind** — read it and decide: a bare **TRE set** (just `.tre` files)
   vs a **client directory** (has `swgemu.cfg` / client exe / `Live/`). `clientLocator` already has
   client-detection bones (cfg `.include` chain scan) to build on.
3. **If it's a client:** leave the client essentially untouched, shadow the TREs into a work dir, and
   only change config to point at the shadow. Maintainer explicitly open on HOW the shadow works.

## What already exists (don't rebuild)

- **Two deploy models built:** `patch-prepend` (small override `.tre` + one `searchTree_NN=` cfg line;
  base TREs untouched) and `shadow-base` (`shadowBaseService.ts` — currently a **full multi-GB copy**
  of the base TRE set to `.studio/shadow/`, patch mounted above).
- `clientLocator` — client discovery + `scanSharedFile` full `.include`-chain search-tree scan.
- `cfgActivator` — toolkit-owned `swgtoolkit.cfg` pulled in via `.include` appended to `swgemu.cfg`;
  CRLF/BOM-free, atomic, line-surgery deactivate.

## Shadow design spectrum (the discussion)

Key realization: **you do NOT need to copy the TREs to leave the client untouched.** SWG's search-tree
priority lets a small higher-priority archive shadow the base in place.

| Model | What | Client mutation | Cost | Status |
|---|---|---|---|---|
| A. Patch-prepend | base in place; small override `.tre` (changed assets only) + 1 cfg line | cfg line + small file in Live/ | tiny | built |
| B. Shadow config root | like A but never edit client `swgemu.cfg`; separate cfg + launch profile | none to client-owned files | tiny | partial |
| C. Full shadow | copy whole TRE set to work dir, mount patch over, point cfg at shadow | none | multi-GB copy | built |
| D. Hardlink shadow | complete shadow TRE dir via **hardlinks** of unchanged base TREs + write only changed override | none | tiny (NTFS same-volume) | NOT built |

**Decision driver — what is the shadow protecting against?**
- "Never corrupt base TREs" → A already guarantees this (base never written; override additive +
  reversible via Reset). Multi-GB copy buys nothing.
- "Never touch client config files either" → B (separate config root), still no TRE copy.
- "Throwaway, fully-isolated client" → C/D; **D (hardlinks)** gives C's isolation at A's cost.

**Recommendation:** default to a refined **patch-prepend (A)**; offer **hardlink-shadow (D)** as opt-in
full isolation; **retire the multi-GB physical copy** as a default (swap `shadowBaseService` copy →
hardlink). Open for maintainer input.

## Hard constraint to verify FIRST (ground truth)

`shadowBaseService` UAT note: **absolute `searchTree` cfg values may be rejected by the client**
(`TreeFile.cpp:115-149`, UNVERIFIED). If true, any override/shadow archive must live in a
**client-relative subdir**, which constrains where work files can go for ALL models above. Verify
against real client source (`../swg-client-v2` TreeFile.cpp path resolution) + a real cfg before
committing to work-dir location. Good candidate for a consult-crew ground-truth trace.

## Severity

Medium-high — not blocking the current deploy loop, but it defines the project's core front-door UX and
the isolation model. Worth designing carefully (and verifying the absolute-path constraint) before the
rework task.
