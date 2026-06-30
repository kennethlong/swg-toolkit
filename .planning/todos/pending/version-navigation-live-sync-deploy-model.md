---
id: version-navigation-live-sync-deploy-model
title: Couple the live client to the selected version — per-version deploy model + reconcile-to-version engine (forward apply / backward revert)
created: 2026-06-29
origin: Maintainer UAT 04.x — "The version needs to keep track of what type of deployment it was deployed with (absolute path or loose files). Then when you walk from the current version backwards through the version tree you know how to revert each version properly. Each version needs a directory with its files so when you remove them from the live folder by reverting, you can repopulate when the user clicks a later version — copy the files from the version folder to the live folder via the loose-files or absolute path."
severity: high (core deploy/revert value loop; current model is confusing — selecting a version only updates a preview, the live client is a separate sticky deploy; reverting/Baseline does not make the client mirror the selected version)
area: renderer (changesetService + new deploy-navigation service + DeployDialog/VersionHistoryBody) + deploy primitives (looseOverrideDeploy / cfgActivator)
status: pending
resolves_phase: "04.3"
related: deploy-tab-combine-staging-and-changesets, product-thesis-shadow-sandbox-and-server-push, client-deploy-design-tenets, project-binds-and-automounts-client-tres
---

## Target model — the live client mirrors the SELECTED version

Navigating the version tree IS deploying: choosing version V makes the live client reflect
`flatten(V)`. Walking backward reverts later versions' files; clicking forward re-applies them.
For this to be correct + reversible, each version must know (a) HOW it was deployed (absolute-path
vs loose-files) and (b) exactly which files it owns.

## Already-existing substrate (reuse, do not rebuild)

- **Per-version file folders:** `studios/<project>/changesets/<versionId>/files/` already stores each
  version's bytes (diff-vs-parent). `changesetService.flatten(versionId)` reconstructs the FULL file
  set for any version by walking the parentId chain (last-writer-wins). → "a directory of files per
  version" exists; flatten gives the materialized set.
- **Per-version deploy record:** each `SwgChangeset` already carries `deployRecord` (CfgDeployRecord |
  LooseDeployRecord) — the deploy-type tag exists, just isn't used to drive revert.
- **Revert/apply primitives:** `looseOverrideDeploy.deployLoose`/`resetLoose` (B3 snapshot+restore),
  `cfgActivator.restoreCfg`/`activatePatch`, absolute-path writer.
- **Pointers:** manifest `activeVersionId` (selected) + `deployedVersionId` (what's live).

## Genuinely new pieces

1. **First-class per-version deploy model.** Store `deployModel: DeployModel` on the version (or the
   deploy record consistently), so revert knows the method even after a fresh dialog open. (The current
   `deployModel` RADIO resets to absolute-path on reopen and is unreliable — the root of the Baseline-
   revert bug fixed provisionally in e6c2cc0 by sniffing the record shape; this makes it explicit.)
2. **Reconcile-to-version engine** — `syncLiveToVersion(targetId)`: make the live override state EQUAL
   `flatten(target)`:
   - desired = flatten(target); current = flatten(deployedVersionId) (or a tracked live-set).
   - files in desired not matching live → write from the version folder via the file's deploy model
     (loose: copy into the searchPath override dir; absolute: stage .tre + cfg searchTree). Snapshot the
     stock original first (B3) if overriding a pre-existing base/override file.
   - files in live not in desired → remove + restore the stock original from the B3 snapshot.
   - set deployedVersionId = target.
   One operation handles BOTH backward-revert and forward-reapply (it's a diff-and-apply between two
   flattened states). Baseline = flatten(BASELINE) = empty → full restore to stock.
3. **Couple selection to the live client.** Clicking a version triggers `syncLiveToVersion` behind an
   explicit confirm (it mutates the real client). `deployedVersionId` tracks where live currently is;
   the version row shows ● deployed vs ● selected and they converge after a sync.
4. **B3 across versions.** Snapshot stock-original on first override; restore whenever a file leaves the
   target set. The snapshot is of the STOCK base (not an intermediate version) — intermediate versions'
   bytes come from their version folders, so any target is reachable directly.

## Deploy-model picker scope (maintainer, 2026-06-29)

The deploy-model radio (absolute-path / loose-override / Advanced) governs ONLY a NEW forward
deploy of the working/new version — it sets how THAT version is written. It must NOT be selectable
when reverting or navigating to an existing version: every existing version already carries its own
loose/absolute flag, and the reconcile engine uses each version's own flag to apply/revert its files.
⇒ Hide/disable the picker in any revert/navigate context (Baseline reset, clicking an existing
version); show it only when staging+deploying a new version forward.

## Version-history is not drawn as a branch tree (maintainer, 2026-06-29)

`VersionHistoryBody.tsx` renders a FLAT list — branch nodes only get a left-border + extra indent,
NOT the visual branching graph specced in sketches `002-version-graph-timeline` and
`005-deploy-inspect-tab` (`.planning/sketches/…`). The data model IS correct (selecting an older
version then Save sets the new node's `parentId` to it → a real branch; `branchSet()` detects it), but
the maintainer's branch off v-prior shows as a plain row, not a tree. The rework must render the graph
faithfully to the sketch: node circles connected by lines, the curved branch-from connector (e.g. "v4
branch from v2"), active (●teal) / deployed (●) / `root` / `main` markers, branch-point labels, and the
footer summary ("N versions · M branches · active: … · deployed: …"). Sketches are the source of truth
([[feedback-sketches-are-ui-source-of-truth]]).

## Acceptance criteria

1. Each deployed version records its deploy model; revert uses it (not the live radio).
6. Deploy-model picker is shown ONLY for a new forward deploy; hidden when reverting/navigating to an
   existing version (each version's stored flag drives its own apply/revert).
7. Version history renders as the visual branch TREE per sketches 002 + 005 (connector lines, branch-from
   curve, active/deployed/root/main markers) — a branch created off a non-tip version is drawn as a branch,
   not a flat row.
2. Clicking version V (incl. Baseline) reconciles the live client to flatten(V): added/changed files
   written via the right path; removed files restored to stock (B3 sha256 match).
3. Forward then backward then forward navigation is idempotent: live bytes for a path == that version's
   bytes; Baseline == stock (client.cfg byte-identical for loose; cfg byte-pristine for absolute).
4. Works for BOTH a loose-override (swg-client-v2) and an absolute-path/cfg (SWGEmu/Infinity) project.
5. Confirm prompt before mutating the live client; non-client projects unaffected.

## Notes / sequencing

- This SUPERSEDES the current "select = preview only, Deploy = apply" model and folds in the Baseline-
  revert + stale-banner messaging issues (e6c2cc0 was a provisional fix on the old model).
- Subsumes the current "Reset deployment" button gap: today Reset only renders in the dialog's post-deploy
  `done` phase (DeployDialog open effect forces `phase:'idle'` on reopen), so a reopened deployed project
  has no visible Reset affordance — the only idle-state revert path is select-Baseline → "Deploy Baseline
  (revert to stock)". The redesign makes revert a first-class action from any state (click any version).
- It's a redesign of the deploy↔version coupling (data model + new service + UX) — its own plan/phase,
  not an inline patch. Candidate: a dedicated 04.x phase after the current dev-client UAT, or fold into
  the deploy-tab redesign todo.
- Honors `client-deploy-design-tenets` (non-destructive, snapshot+restore, never clobber a working cfg).
