---
id: project-binds-and-automounts-client-tres
title: Project should bind to a client install and auto-mount its base TREs on open
created: 2026-06-27
origin: Maintainer UAT feedback (Phase-4 deploy-loop in-client UAT) — "if I open/create a project shouldn't the TRE browser change to that project's TRE files?"
severity: medium
area: renderer / workspace ↔ TRE VFS browser wiring (cross-phase: Phase-1 TreVfsBrowser + Phase-4 workspace)
status: pending
disposition: deferred to milestone replan (maintainer chose "log for replan" over wiring it mid-UAT)
---

## The coherence gap

The **TRE browser** (`TreVfsBrowser`, Phase-1) and the **project/workspace** (Phase-4) are currently
disconnected. Opening or creating a project does **not** change what the TRE browser shows — you still
have to manually `Mount Archive…` each `.tre`.

The maintainer's mental model on first contact: "open project → the TRE view should reflect that
project." That's a reasonable expectation the current UX doesn't meet.

## Why it isn't automatic today (the real model)

- A **project/workspace is not a set of TRE files.** It's a folder of *loose modified assets* + a
  version graph (changesets in `.studio/changesets/manifest.json`). Those loose assets get packed into
  a patch `.tre` only at **deploy** time. The project's "own files" surface in the **Staging panel**,
  not the TRE browser.
- The **TREs you browse to find things to mod belong to the client**, not the project.
- The workspace doesn't even remember which client it targets: `WorkspaceInfo.clientPath` is `null` on
  open and is only chosen later in the Deploy dialog (Section A auto-detects `D:\SWG Infinity`).

## Proposed enhancement (the good UX the maintainer is pointing at)

Bind a project to a client install and auto-mount that client's base TREs on project open:

1. **Persist the client path in the workspace** — add `clientPath` to the changeset manifest (or a
   small `workspace.json`), set it the first time the user picks/deploys to a client. (Mind the
   existing `WorkspaceInfo.clientPath` field — currently always null.)
2. **Auto-mount on open** — when a project opens with a bound `clientPath`, mount that client's base
   TREs into `treStore` (the same path `mountSearchableAsync` + the full `.include`/search-tree scan
   used by `clientLocator`/`cfgActivator` already walk), so the browser lands ready to browse/extract.
3. **Override indicators** — with the project's patch layered, the VfsTree override pips should show
   the patch shadowing the base (this is what the resolve-chain UI already renders for mounted layers).
4. **First-open affordance** — if a freshly created project has no bound client yet, offer a
   "Choose client to mod against…" prompt instead of an empty browser.

## Detect-and-bind on open/create (maintainer, 2026-06-27)

When a folder is opened/created as a project, **detect whether it is a client install** (presence of
`swgemu.cfg` / client exe / `Live/` — `clientLocator` has the detection bones), and if so:

- **Mark it `isClient`** and **persist it as the bound `clientPath`** automatically (no manual step).
- **`DeployDialog` auto-selects the bound client** → the "Deploy patch" button is **enabled by
  default** (today it gates on `!selectedClient`, and auto-detected clients are NOT auto-selected, so
  the button looks broken until the user clicks the Section-A radio). This subsumes the "auto-select a
  single detected client" nit.
- Extend `WorkspaceInfo`/manifest with `clientPath` + a `kind: 'client' | 'tre-set' | 'mod-project'`
  tag (pairs with the TRE-set-vs-client detection in `project-entry-point-and-shadow-redesign`).

### DECIDED (maintainer, 2026-06-27) — `.studio/` lives OUTSIDE the client; client stays pristine

Chose **(b)**. The client install directory is **never written to except the live `.cfg` edits**.

- **`.studio/` lives under the app root by default** — a toolkit-managed directory structure (e.g.
  `<appRoot>/.studio/<project>/`), NOT inside the client. `createWorkspace` must stop scaffolding
  `.studio/` + `.gitignore` + `git init` into the (client) project root.
- **Snapshot the original `.cfg` file(s) into `.studio/`** before any mutation, so the client config
  is **exactly restorable** (full-file original, not just line-surgery). Today `cfgActivator` takes a
  `.bak` NEXT TO the cfg (i.e. in the client dir) — move that backup into `.studio/` so the client dir
  gets ZERO toolkit files (no stray `.bak` either). Restore = copy the stored original back.
- Workspace binds to the client via a stored `clientPath`; detect+mark+auto-bind behavior unchanged.

### ✅ RESOLVED 2026-06-27 — absolute external searchTree paths ARE ACCEPTED (this model is a GO)

Verified against real `swg-client-v2` source (consult agent, full chain quoted): a
`searchTree_<sku>_<NN>=<value>` value is used **verbatim** — no base dir prepended — straight to Win32
`CreateFile`. Chain: `TreeFile.cpp:130-138` (raw cfg value) → `addSearchTree` `:360-372` (existence
check, no prepend) → `SearchTree` ctor `TreeFile_SearchNode.cpp:249-264` (`FileStreamer::open` verbatim)
→ `OsFile.cpp:86` `CreateFile`. Priorities search high→low (`TreeFile.cpp:285-287`) so a high slot
shadows stock.

⇒ The override `.tre` CAN live under the app root and be registered by **absolute path**
(`searchTree_00_30=D:\Toolkit\.studio\build\patch.tre`). The `shadowBaseService` "absolute paths
rejected" worry is **FALSIFIED**.
- **CAVEAT:** a *relative* value resolves against the client CWD (install root) — so ALWAYS write a
  **full absolute path** for the override under app root. (Backslashes or forward slashes both fine.)
- No separate "absolute tree" cfg key needed; `searchTree_<sku>_<NN>` takes an absolute path directly.
  (`searchAbsolute=<priority>` is an unrelated per-asset-lookup fallback, NOT a path key.)

## Scope / dependencies

- Cross-phase: touches Phase-1 `TreVfsBrowser`/`treStore` + Phase-4 workspace/manifest. Beyond
  Phase-4's deploy-loop scope — schedule at the milestone replan alongside the other deferred items
  (cross-session shadow reset, live-world-terrain placement).
- Reuses existing machinery: `mountSearchableAsync`, the cfg search-tree scan (`cfgActivator`/
  `clientLocator`), and the manifest read/write in `workspaceService`/`changesetService`.

## Severity

Medium — not a correctness bug; the deploy loop works without it. But it's the missing connective
tissue that makes "open a project" feel coherent, and it's the maintainer's first-impression
expectation. Worth doing early in the next milestone.
