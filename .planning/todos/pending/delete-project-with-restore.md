---
id: delete-project-with-restore
title: Delete a project — must restore the client to stock (cfg-pristine / loose-override reset) before removing
created: 2026-06-29
origin: Maintainer UAT note during 04.2-06 — "How do I delete a project? Delete should also restore the config file to its original settings."
severity: high (no in-app delete exists today; manual folder-delete orphans a modified client cfg and/or deployed override files)
area: renderer / project lifecycle (ProjectListDialog + new deleteProject service + restore reuse)
status: pending
related: client-detection-and-layout-model, project-entry-point-and-shadow-redesign, project-binds-and-automounts-client-tres, client-deploy-design-tenets
---

## Problem — there is no in-app way to delete a project, and a naive delete clobbers the client

There is currently NO delete/remove/unbind affordance anywhere (Open Project dialog, recents, or a
service). The only way to remove a project is to manually delete two folders:

- Studio record (authoritative): `%LOCALAPPDATA%\swg-toolkit\studios\<ProjectId>` (project basename, spaces → `_`)
- Umbrella folder: `%LOCALAPPDATA%\swg-toolkit\projects\<ProjectName>`

Manual deletion does **not** restore the client. That is the maintainer's core requirement: **delete
must return the client to stock first.** What "stock" means is deploy-model-dependent:

| Deploy model | Client mutation on deploy | Restore-on-delete must do |
|---|---|---|
| cfg-insertion (SWGEmu / Infinity, `swgemu.cfg`) | `swgemu.cfg` modified (`.include` + slot bump) | `restoreCfg(rootCfgPath, snapshot)` — byte-pristine whole-file restore (fallback `deactivatePatch` line-surgery for pre-07 records) |
| absolute-path (04.1 default) | `searchTree=<abs>` written into cfg | `restoreCfg` or `deactivatePatch` |
| loose-override (04.2, swg-client-v2) | cfg UNTOUCHED; loose files written into `searchPath` override dir | `resetLoose(record)` — restore pre-existing originals from the B3 snapshot, unlink toolkit-added files |

The restore machinery already exists and is exactly what the Deploy dialog's **Reset** uses
(`cfgActivator.restoreCfg` / `deactivatePatch`, `looseOverrideDeploy.resetLoose`). Delete should reuse it.

## Acceptance criteria

1. A delete affordance in the Open Project dialog (and ideally the recents row) — destructive-action
   styling + an explicit confirm (it mutates a real client cfg / removes deployed files).
2. `deleteProject(projectFolder)` service that, in order:
   a. reads the project's active deploy record (manifest) and runs the **model-appropriate Reset**
      (restoreCfg / deactivatePatch / resetLoose) so the bound client is byte-pristine and any
      deployed override files are reverted — NON-fatal per-step, but surface failures to the user;
   b. removes the studio dir (`studios/<id>`), the umbrella folder (`projects/<name>`), and the
      recents entry;
   c. if the deleted project is the currently-open one, closes the workspace + returns to the Welcome entry.
3. Idempotent + safe: deleting a never-deployed project just removes folders (no cfg touch). Deleting a
   project whose snapshot is missing falls back gracefully (skip restore, warn) — never throws.
4. Tests: cfg-insertion delete → cfg sha256 == pre-deploy; loose-override delete → pre-existing override
   file restored (B3 sha256) + toolkit-added file removed; never-deployed delete → folders gone, no cfg I/O.

## Notes

- Deferred out of Phase 04.2 (maintainer decision, 2026-06-29) to keep the dev-client / loose-override
  UAT focused. Candidate for a dedicated project-lifecycle phase or a 04.x follow-up.
- Honors the `client-deploy-design-tenets` memory: "never clobber a working client config (snapshot+restore)."
  An orphaned project that deployed via cfg-insertion and was deleted without restore is the exact
  failure mode that tenet guards against.
