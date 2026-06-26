# Phase 04: Edit & Deploy Loop - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-26
**Phase:** 04-edit-deploy-loop
**Areas discussed:** Workspace & staging, Rollback model, .cfg activation, Git/LFS scope

---

## Workspace & Staging

| Option | Description | Selected |
|--------|-------------|----------|
| A user-chosen project folder | User picks/creates a folder; holds `.studio/` + git repo; IDE-style open-project | ✓ |
| Managed under app userData | Toolkit owns the location | |

| Option | Description | Selected |
|--------|-------------|----------|
| Extract-to-workspace, edit in place (implicit diff) | Staged tree IS the changeset | |
| Explicit 'add to patch' staging list | Decouples "edited" from "will ship" | ✓ |

| Option | Description | Selected |
|--------|-------------|----------|
| Replacement file on disk | Staged entry = virtual path + replacement file (+ add/delete) | ✓ (Claude decided) |
| Only in-app edits | Unrealistic — IFF editor read-only, typed editors are Phase 5 | |

| Option | Description | Selected |
|--------|-------------|----------|
| buildTre of only staged deltas | Small standalone patch, shadows retail at higher priority | ✓ (Claude decided) |
| repackTre of a full base archive | Full-size rebuild — wrong shape for a deploy patch | |

**User's choice:** User-chosen project folder + explicit staging list; delegated the stage-source
and patch-build mechanics to Claude.
**Notes:** Claude resolved the two delegated items grounded in the existing native API and SWG
search-order patching: replacement-file-on-disk staging (maps to `buildTre` `{path,data,tombstone}`)
and `buildTre`-of-deltas for the patch. Read-only Phase-1 IFF editor + Phase-5 typed editors framed
the realistic Phase-4 edit source.

---

## Rollback Model

| Option | Description | Selected |
|--------|-------------|----------|
| Git-commit-backed history | Changeset history = Git commits (Claude's recommendation) | |
| Offline .tar.gz snapshots | Separate snapshot store, independent of Git | |
| Layered changeset-stack VFS (Base44) | Immutable per-file delta layers, version toggle | ✓ |

| Option | Description | Selected |
|--------|-------------|----------|
| The staging list + replacement assets | Mod-produced deltas only, never retail base | ✓ |
| The whole workspace tree | Risks bloating history with retail bytes | |

| Option | Description | Selected |
|--------|-------------|----------|
| Both: manual checkpoint + auto-on-pack | Deliberate checkpoints + guaranteed deploy record | ✓ |
| Manual checkpoint only | | |
| Auto-on-pack only | | |

| Option | Description | Selected |
|--------|-------------|----------|
| Non-destructive version toggle | Higher layers greyed + re-activatable; no work lost | ✓ |
| Destructive purge | Irreversible delete of higher layers | |

**User's choice:** Base44 layered changeset-stack VFS; staging-list+replacement-assets granularity;
both triggers; non-destructive version toggle.
**Notes:** User **explicitly corrected** Claude's "AI-proposed/heavy" framing: *"I proposed Base44
style versioning because I have used it and it's a good fit."* — an experience-backed decision, not a
naive pick. Caveat narrowed to validating only the doc's exact manifest field schema. Reconciles with
Git/LFS choice: Git versions the changeset store (one history, not two).

---

## .cfg Activation

| Option | Description | Selected |
|--------|-------------|----------|
| Auto-detect known installs + manual override | Detect Infinity + SWGEmu, pick from list, manual fallback | ✓ |
| Manual folder pick only | | |

| Option | Description | Selected |
|--------|-------------|----------|
| Copy into client tree + prepend searchTree (patch-prepend) | Patch shadows retail; originals untouched | ✓ (as the default of "both") |
| Reference patch in place from workspace | Client depends on workspace path staying put | |
| Shadow-base (isolated) | Copy TRE base to local shadow, repoint client base | ✓ (as opt-in of "both") |
| Offer both at workspace setup | Default patch-prepend + opt-in shadow-base | ✓ |

| Option | Description | Selected |
|--------|-------------|----------|
| Workspace works without a client | Author/extract/pack/version offline; deploy gated | ✓ |
| Require a client to create a workspace | | |

**User's choice:** Auto-detect + manual override; **offer both** deploy models (patch-prepend default
+ shadow-base opt-in); workspace usable with no client.
**Notes:** User opened a deeper idea — *shadow the original TRE set, offer to copy + repoint the client
base at the shadow, enabling reset + original-vs-shadow compare.* Claude reconciled it with the hard
copyright constraint (retail TREs never git-tracked) and showed patch-prepend already keeps originals
pristine/comparable for free; shadow-base adds full isolation/reset at a multi-GB local-copy cost. User
chose to offer both. Shadow is local-only, never versioned.

---

## Git/LFS Scope

| Option | Description | Selected |
|--------|-------------|----------|
| Gitignore the patch .tre — changesets are source of truth | Patch is a rebuildable artifact | ✓ |
| Commit the patch .tre via LFS | Stores a redundant derivable binary | |

| Option | Description | Selected |
|--------|-------------|----------|
| Auto .gitignore + LFS attrs + explicit-path staging | Belt-and-suspenders | |
| Add a pre-commit size/origin guard too | Strongest safety for a forkable open-source tool | ✓ |

**User's choice:** Gitignore the built patch (changesets = source of truth; Release action exports it);
defense-in-depth guard including a pre-commit size/origin check.
**Notes:** Confirmed Git versions the changeset store; changeset rollback UX and Git are one history
system, not two. Retail/extracted bytes hard-banned via `.gitignore` + LFS `.gitattributes` +
explicit-path staging + pre-commit guard.

---

## Claude's Discretion

- Stage-source model (replacement-file-on-disk) and patch-build mechanism (`buildTre` of deltas) —
  delegated and resolved from the existing native API + SWG patching mechanics.
- `.studio/` on-disk layout, client install-path/registry detection keys, and UI surface specifics —
  to be proposed in planning, grounded in the version-control doc (schema validated) and live-inject.

## Deferred Ideas

- Remote differential CDN sync (version-control doc layer 4) — v2/deferred.
- App auto-update / Squirrel / asset-template streaming (packaging doc §6) — app distribution, not
  mod deploy.
- `todo.match-phase` hits were keyword false-positives — reviewed, not folded.
