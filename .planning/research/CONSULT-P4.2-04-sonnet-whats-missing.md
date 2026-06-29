# CONSULT P4.2-04 — Sonnet — lateral / what's unplanned

Reviewing a PLAN set for SWG Toolkit Phase 04.2 (dev-client support + loose-override deploy). Your job:
find what the plan MISSES — failure modes, regressions, unstated assumptions. Be the skeptic. Ground
truth = real source + the actual installs; don't trust the plan's framing.

## CONTEXT (neutral)
The phase adds: (1) detect `client.cfg`-style decoupled clients (binary dir, zero local `.tre`, external
TRE data by absolute path) + manual override; (2) mount the full base via `searchTOC` (.toc index) +
`searchPath` loose dirs, not just `searchTree`; (3) a "deploy by writing loose files into the top-priority
`searchPath` override dir" mode (no TRE pack, no cfg edit). Existing searchTree-only clients (SWGEmu at
`D:\SWGEmu-Client\SWGEmu`, Infinity at `D:\SWG Infinity\SWG Infinity`) must NOT regress.

## KEY PLAN ASSUMPTIONS TO ATTACK
- A1: mounting the 131 constituent `.tre`s individually yields the SAME file set as the `.toc` global
  index. (Is that safe? When would it not?)
- A2: `client.cfg` and `swgemu.cfg` are mutually exclusive per install, so the new detection row won't
  mis-classify existing installs.
- The loose-override `delete` action: staged deletes can't tombstone a base-TRE file via a loose dir; the
  plan only `console.warn`s. Is that acceptable or a silent footgun?
- `resetLoose` removes only files it created (tracked via a `preExisted` flag + a deploy record). What
  breaks this? (crash mid-deploy; user hand-edits the override dir between deploy and reset; same file
  staged by two deploys; the override dir also being the engine's real override the modder uses by hand.)

## YOUR ANGLE (the lateral sweep)
1. Read the 6 plans in `.planning/phases/04.2-dev-client-support-loose-override-deploy/`, the existing
   `clientLayout.ts`/`clientLocator.ts`/`treAutoMount.ts`/`DeployDialog.tsx`, and the 3 real installs'
   cfgs if available. What failure mode is UNPLANNED?
2. Regression: what specific behavior on SWGEmu/Infinity could the shared-file changes
   (`clientSearchOrder.ts`, `clientLayout.ts`, `treAutoMount.ts`) silently break?
3. Reset/idempotency robustness of the loose-override deploy across crashes, re-deploys, and manual edits.
4. Anything about the decoupled client (generated cfg regen clobbering, the data root being shared across
   stage clients, absolute-path whitespace) the plan under-handles.

## OUTPUT
A ranked list of gaps (HIGH/MED/LOW) with the concrete scenario and a one-line suggested mitigation each.
Lead with the single most likely real-world break. Do not rewrite the plan.
