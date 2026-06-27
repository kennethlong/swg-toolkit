---
id: missing-save-version-action
title: No explicit "Save version" action — sealing a changeset only happens via Deploy auto-seal
created: 2026-06-27
origin: Maintainer UAT — "I added a file to staging and nothing is showing up in Changesets"
severity: high (breaks the documented Stage → Save version → Deploy loop; blocks testing the version graph)
area: renderer / StagingPanel + ChangesetTimelinePanel (changeset sealing UI)
status: pending
related: deploy-tab-combine-staging-and-changesets, staging-workflow-redesign
---

## Symptom

Adding a file to **Staging** never produces a node in **Changesets**. Expected per the model (staging
is the uncommitted working set; you Save version to seal a changeset) — BUT there is **no "Save
version" button anywhere in the UI**, so the user cannot create a changeset except by deploying.

## Root cause (verified)

- `StagingPanel` header has only **Add…** and **Deploy…** buttons.
- `ChangesetTimelinePanel` only wires click → `selectVersion(node.id)` on existing nodes.
- `StagingPanel.handlePackPatch` (which calls `packPatch` + `sealVersion`) exists but is **dead code —
  bound to no button**.
- The ONLY path that seals a changeset is `DeployDialog`'s auto-seal-when-dirty
  (`sealVersion({ sealedBy: 'pack', ... })`) on Deploy.

So the documented loop "Stage → **Save version** → Deploy" is missing its middle step; the standalone
save got collapsed into deploy's auto-seal and the control was never wired.

## Why it matters

- Can't test the version-graph piece independently of deploy.
- The headline UAT test ("revert to an OLDER version → Deploy with no edits → must deploy that version,
  not hang") **requires multiple saved versions to exist** — impossible without a save action that
  isn't tied to deploying.

## INTERIM DONE (2026-06-27) — Save version button wired

A **Save version** button now sits in the Staging header (replacing the moved-out Deploy button) →
opens the shared text modal (default label `Version N`) → `sealVersion({ sealedBy: 'manual', entries,
label })`. N4 "Nothing new" surfaces via `window.alert` instead of crashing. `sealVersion` updates the
changeset store, so the Changesets timeline refreshes immediately. (tsc clean, 28/28 tests green.) The
full first-class treatment still belongs in the combined-tab redesign (sketch 005-B).

## Fix

Add a **Save version** control that calls `sealVersion({ sealedBy: 'user', entries, label })`:
- Minimal interim (to unblock UAT): a button in the Staging header (between Add… and Deploy…), default
  or auto-generated label (NO `window.prompt` — unsupported in Electron; use a small modal like the
  VirtualPathModal, or a default label for now).
- Respect the existing N4 empty/dup guard (`flatEqual`) — no-op when staging == flatten(activeVersion).
- In the redesign (combined Deploy tab, sketch 005-B), Save version is a first-class action in the
  composed surface — see [[deploy-tab-combine-staging-and-changesets]].

## Severity

High — it's a missing step in the core loop and a prerequisite for testing the changeset graph and the
headline revert/deploy test. Interim button is small (reuses `sealVersion`).
