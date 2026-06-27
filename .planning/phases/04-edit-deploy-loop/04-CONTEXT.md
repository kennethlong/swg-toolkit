# Phase 04: Edit & Deploy Loop - Context

**Gathered:** 2026-06-26
**Status:** Ready for planning

<domain>
## Phase Boundary

Turn the viewer into an editor that **closes the modder loop**: take mod edits, pack
them into a deployable `.tre` patch (DEPLOY-01), activate the patch via the client `.cfg`
search order (DEPLOY-02), provide changeset/snapshot **rollback** (DEPLOY-03), and version
**mod-produced** assets via Git/LFS (DEPLOY-04).

**Depends on Phase 1 only.** The native TRE engine (`buildTre`/`repackTre` with raw-slice
identity) already exists from Phase 1 (Plan 01-04). This phase is the **workflow layer**
around that engine — workspace, staging, packaging, `.cfg` activation, rollback, VCS — NOT
new byte-level format work. Rich in-app/typed editors are Phase 5; in this phase, edits come
from extract-and-modify (the in-app IFF editor is read-only per Phase 1 D-08).

**In scope:** mod project workspace; explicit patch-staging; build deploy patch from staged
deltas; locate client + safe `.cfg` activation; layered changeset rollback; Git/LFS for mod
outputs.

**Out of scope (boundaries):**
- Typed/rich in-app editors (DTII grid, `.stf`, gizmo) — **Phase 5**.
- **Remote differential CDN sync** (layer 4 of the version-control doc) — **v2/deferred**.
- v6000 (encrypted) archives — enumerate-only, cannot be repacked/patched (Phase 1 decision).
- Committing retail/extracted `.tre` bytes to any VCS — hard-banned (copyright + size).

</domain>

<decisions>
## Implementation Decisions

### Workspace & Staging
- **D-04-01:** A **mod project workspace = a user-chosen project folder** (IDE-style "open
  project"), located wherever the user wants. Holds a `.studio/` control dir + a Git repo.
  One workspace per mod. (Not app-managed userData — chosen for clean per-mod Git/LFS remotes.)
- **D-04-02:** Edits are staged via an **explicit "add to patch" staging list** (decouples
  "edited" from "will ship"), NOT an implicit edit-the-tree-and-diff model.
- **D-04-03:** A staged item = **virtual path + a replacement file on disk** (produced via
  Extract→edit-externally / drop-in), plus support for **add-new** and **delete (tombstone)**.
  This maps 1:1 onto the native `buildTre` entry shape (`path` + `data` + optional `tombstone`).
  Phase 5 typed editors extend this by emitting their output as a staged entry's bytes — same model.
- **D-04-04:** The deploy patch is built with **`buildTre` of only the staged deltas** — a small
  standalone archive containing just changed/added/deleted entries, mounted at higher `.cfg`
  priority to shadow retail (the standard SWG live-patch mechanism). Deletes are tombstone
  entries (length-0 TOC) — verified to hide the retail file in-client (`find()` `!deleted` loop +
  `TreeFile_SearchNode.cpp:397`). `repackTre` (full-base rebuild) is the wrong shape for a patch
  and stays **unused** in this phase.
  - ⚠ **CORRECTION (04-RESEARCH.md):** the live Infinity client mounts **`EERT5000` (v5000)**,
    confirmed by hexdump — so the patch must be built **`version='5000'`**, NOT `buildTre`'s
    `'0005'` default (or detect the base client's version and match it). A v0005 patch will not load.
  - ⚠ **REFINED (D-04-08):** the patch is built from the **selected version's CUMULATIVE flattened
    deltas** (root→N from the change database), **NOT the live staging list** — this was the core
    bug the crew found (`packPatch` packed the live list, so revert/deploy didn't reflect the chosen
    version). Live staging is just the *uncommitted* working set that becomes the next saved version.

### Versioning + Rollback (DEPLOY-03) — REFINED 2026-06-26 (post cross-AI review, maintainer-clarified)

> The cross-AI crew found the original "Base44 pointer-toggle" plan made rollback **cosmetic**
> (the pointer moved but nothing materialized). The maintainer clarified the intended model below.
> This is a **version graph + per-version file store + materialize-on-deploy** model. It supersedes
> the literal "non-destructive pointer toggle" framing while keeping its non-destructive spirit.

- **D-04-05 (REFINED):** The changeset store IS a **persistent change database** under
  `.studio/changesets/`: each **version** persists (a) a manifest row and (b) the **actual modified
  file bytes** (mod-produced replacement assets) for that version, **plus a `parentId`** so history
  is a navigable **graph** (not a flat list). The Base44 directory-per-layer structure is the right
  bones; validate exact manifest fields against real use.
- **D-04-06:** A version captures the **changed files + mod-produced replacement assets only** —
  never the extracted retail base. Keeps history small and copyright-clean.
- **D-04-07 (REFINED):** **"Save a set of changes" → a new version** (the primary trigger). Deploy
  may also auto-seal. Editing *after reverting to an older version* creates a **branch** off that
  version (maintainer chose "keep both — branch the history"; nothing is lost; the timeline shows
  divergence).
- **D-04-08 (REFINED — supersedes pointer-only toggle):** **Reverting selects any version along the
  history graph; DEPLOY is what materializes it.** Deploying version N rebuilds the client TRE set to
  match the **CUMULATIVE state at N** — flatten the file deltas along the path **root→N** (via
  `parentId`) into the deployed patch (patch-prepend) or onto the isolated base copy (shadow-base).
  "Go back two versions and deploy" → the client exactly matches that version. **Deploy/flatten reads
  from the change database, NEVER the live staging list.** No destructive delete on revert
  (`PurgeChangesetLayer` / `.tar.gz` snapshot engine stay BANNED).
- **D-04-08a (determinism):** flatten emits entries in a **canonical order (sort by `virtualPath`)**
  before `buildTre`, so re-deploying the same version is byte-identical.
- **D-04-08b (guard):** skip sealing a version whose flattened delta equals the parent's (no
  empty/duplicate versions); surface "Nothing new to commit."
- **Scope note:** the maintainer chose to **build this full model now in Phase 4** (not a linear-only
  MVP). Size the changeset + deploy plans accordingly.

### `.cfg` Activation (DEPLOY-02)
- **D-04-09 (CORRECTED by 04-RESEARCH.md — ground truth):** Client/`.cfg` discovery =
  **auto-detect known installs (SWG Infinity + SWGEmu) + manual folder override** (intent stands).
  ⚠ The "reuse `@swg/live-inject`" premise was **FALSE** — live-inject only has
  `launchAndInject(clientExe)` / `attachAndInject(pid)`, **no install/`.cfg` discovery**. The
  client locator is **NEW work** (Windows registry + known install paths + manual override).
  Manual override keeps it non-blocking (OQ-1).
- **D-04-10:** **Offer BOTH deploy/isolation models at workspace setup:**
  - *Default:* **patch-prepend** — add the patch `.tre` at a **free higher `searchTree_<sku>_<NN>=`
    priority slot** (see D-04-12); never touch retail files. Originals stay pristine automatically
    and ARE the compare/reset baseline. Reset = remove the one `.cfg` key + delete the patch.
  - *Opt-in:* **shadow-base "isolated client"** — copy the client TRE base to a **local shadow
    dir** (with a disk-space warning), then **mount the deployed version's flattened patch over the
    shadow at a higher `searchTree` slot** so the shadow set = pristine base copy + the selected
    version's changes (⚠ **CORRECTION/B4:** the original plan copied the base but never applied the
    edits — shadow-base MUST consume the version's flattened patch, same as patch-prepend, just
    against the shadow copy). Real install stays pristine for reset/compare. Shadow is
    **local-only, never git-tracked**.
  - ⚠ **B7/B9 (crew):** the multi-GB shadow copy MUST be **async** (`fs.promises.copyFile`/streams),
    not synchronous (renderer freeze); deploy models are **mutually exclusive per client+session**
    (or `deactivatePatch` does line-surgery on its own key, not a whole-backup restore) to avoid the
    `.bak` clobber where resetting patch-prepend drops the shadow keys.
- **D-04-11:** Workspace is **fully usable with no client detected** — authoring/extract/pack/
  version all work offline; client detection + `.cfg` activation are **deploy-time only**.
  Deploy is disabled behind a clear "point me at a client" prompt until a client is set.
- **D-04-12 (CORRECTED by 04-RESEARCH.md — ground truth):** The real engine reads
  **`searchTree_<sku>_<priority>=<file>.tre`** keys inside a **`[SharedFile]`** section
  (`TreeFile.cpp:90-191`; `ConfigFile.cpp:359-518`). The numeric suffix **IS** the priority,
  **higher number wins**, first-match (`searchNodePriorityOrder a>b`); `maxSearchPriority` gates
  the scan. So "preserve duplicate entries" means: **keep all existing `searchTree_NN_MM=` keys
  untouched and add the patch at a FREE higher-priority slot** below `maxSearchPriority` (real
  Infinity `swgemu_live.cfg`: `maxSearchPriority=60`, slots `_00_30..54` used → use **55**).
  Write **target = a toolkit-owned `swgtoolkit.cfg`** pulled in via **`.include "swgtoolkit.cfg"`**
  added once to the stable root `swgemu.cfg` — **NEVER** edit launcher-clobbered
  `user.cfg`/`options.cfg`. Write is **CRLF, BOM-free, atomic**, backs up the edited `.cfg`,
  records the insertion for clean rollback. (Persistence-across-relaunch = UAT item OQ-2.)
  - ⚠ **B1 (Cursor + Sonnet, cross-confirmed):** `scanSharedFile` MUST **walk the full `.include`
    chain** from the root `swgemu.cfg` (→ `swgemu_live.cfg` …) to learn the **true** `occupiedSlots`
    (30–54) + `maxSearchPriority`. Scanning the empty toolkit-owned `swgtoolkit.cfg` alone yields
    `occupiedSlots=[]` → slot **1**, which is BELOW retail and gets **shadowed BY retail** (silent
    no-load). The insert must use the full-chain scan, and `chooseSlot` then returns 55.
  - ⚠ **B1 (Cursor):** duplicate `maxSearchPriority` across includes is **LAST-wins**
    (`ConfigFile.cpp:797`), NOT first-wins (the earlier note was backwards). Read the **last**
    `maxSearchPriority`; append `.include "swgtoolkit.cfg"` **after** `swgemu_live.cfg` so any
    toolkit bump wins. For Infinity (max=60, slot 55) no bump is needed.

### Git/LFS (DEPLOY-04)
- **D-04-13:** The **Git repo lives in the workspace folder (one per mod)** and **versions the
  changeset store** (`.studio/changesets/` + manifest + staging metadata). Git is the
  collaboration/remote backbone *underneath* the in-app changeset rollback UX — **one history
  system, not two competing ones**.
- **D-04-14:** The **built patch `.tre` is gitignored** — it's a build artifact flattened from
  the active changeset stack on demand, fully derivable, so it's not committed. A separate
  "Release" action can export/attach it for distribution.
- **D-04-15:** "Never commit retail/extracted bytes" is enforced with **defense in depth**:
  auto-written `.gitignore` (`extracted_vanilla_base/`, the shadow TRE dir, build artifacts) +
  auto-written `.gitattributes` (route mod-output binaries through LFS) + **explicit-path
  staging** (never blind `git add .`) + a **pre-commit size/origin guard** that blocks
  suspiciously large or retail-fingerprinted `.tre` files with a clear error. (Open-source tool —
  forks/clones must stay clean and small.)
- **D-04-16 (added from 04-RESEARCH.md — security):** All git/git-lfs shelling from Node MUST use
  **`execFile` with argument arrays**, never `exec` with interpolated command strings (the
  AI-distilled doc's `exec(\`git commit -m "${msg}"\`)` pattern is a **command-injection vector** on
  attacker-influenced commit messages / paths). git 2.49 + git-lfs 3.6.1 confirmed present; check
  git-lfs presence before LFS ops and surface a clear error if absent.

### Claude's Discretion
- Exact on-disk layout of `.studio/` (changesets dir naming, manifest filenames) — propose a
  concrete layout in planning, grounded in the version-control doc's schema (validate fields).
- The specific client install-path/registry keys used for auto-detection — NEW component (not in
  live-inject, per D-04-09); confirm registry keys + known install paths against the installed
  clients (`D:\SWG Infinity`; note `D:\SWGEmu Client` is currently EMPTY — SWGEmu parity rests on
  the shared swg-client-v2 engine, and stock `maxSearchPriority` defaults to 20 so may need bumping).
- UI surfaces (staging panel, changeset timeline, deploy dialog, VCS panel) — the doc provides
  reference React components; treat as starting designs, fit to the existing dockview shell.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Workflow — packaging, VCS, rollback (primary)
- `docs/06-workflow/version-control-and-backup.md` — DEPLOY-03/04 source: Git/LFS pipeline +
  `.gitattributes` rules, local snapshots, **Base44 changeset-stack VFS** (the chosen rollback
  model), and the **retail-`.tre` no-commit WARNING**. ⚠ Manifest/interface schemas are
  **AI-proposed — validate the exact fields** (per D-04-05) before locking.
- `docs/06-workflow/packaging-and-distribution.md` — mostly app packaging (Electron Forge/
  Squirrel, **out of scope here**); relevant bit = the `registerPatchInClientConfig(clientDir,
  patchName)` **`.cfg` patch-registration hook** shape (DEPLOY-02).

### Core engine — TRE build/flatten (the engine this phase drives)
- `docs/01-core-engine/iff-and-tre.md` — `.tre` build/repack + flatten-changeset-stack-into-TRE
  reference. The engine itself is already implemented in Phase 1.
- `packages/native-core/index.d.ts` — **existing** `buildTre(entries, version)` and
  `repackTre(sourcePath, edits, version)` API (with the raw-slice-identity contract +
  tombstone support). DEPLOY-01 builds on `buildTre`.
- `.planning/phases/01-core-engine-iff-tre-verification-harness/01-04-*` — TRE builder/repacker
  plan + summary (block write order, zlib L6, MD5 trailer, determinism guarantees).

### Client detection (reuse for `.cfg` locate)
- `packages/live-inject/` — Phase 3 client-detection/launch-and-attach code; reuse its install/
  process discovery for DEPLOY-02 auto-detect (D-04-09).

### Project rules / constraints
- `.planning/REQUIREMENTS.md` §Edit & Deploy Loop (DEPLOY-01..04) + Standing byte-exact gate.
- `docs/00-overview/source-provenance.md` — why AI-distilled doc schemas must be verified.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`buildTre` / `repackTre`** (`packages/native-core`, Phase 1 01-04): the deploy-patch builder.
  `buildTre(entries[], version)` takes `{path, data, tombstone}` entries — exactly the staging
  model (D-04-03/04). Determinism + raw-slice identity already proven.
- **TRE mount/resolver** (Phase 1 01-02): priority/override resolution + shadow chains — the
  conceptual basis for how a higher-priority patch shadows retail (informs `.cfg` search-order).
- **`@swg/live-inject` client detection** (Phase 3): locating installed/running clients — reuse
  for DEPLOY-02 auto-detect (D-04-09).
- **Extract** (Phase 2 02-05): `readMountEntry` + viewportStore source-entry fields already
  write byte-complete entries to disk — the front half of the extract→edit→stage flow.
- **Dockview shell + virtualized panels** (Phase 0/1): host for the staging panel, changeset
  timeline, deploy dialog, VCS panel.

### Established Patterns
- **Native binary work crosses the bridge zero-copy** (ArrayBuffer), heavy work off-thread —
  packing a patch should follow this (AsyncWorker, not main-thread).
- **Native↔contract conformance guards** (Phase 2): add a guard for any new native binding field
  this phase introduces.
- **Byte-exact round-trip standing gate**: a built patch `.tre` must round-trip / load correctly;
  DEPLOY-01 inherits the gate (cite `swg-client-v2` loader, verify on a real built patch).

### Integration Points
- Git/`.cfg`/filesystem operations run in the **Node-capable renderer (Path B)** or main —
  follow the existing process posture; shell out to system `git`/`git-lfs` via child_process
  (per the doc's `SwgGitLfsService`).
- New `contracts/` types for: workspace, staging list, changeset manifest, deploy/activation
  result. Rebuild `@swg/contracts` after edits (Phase 2 build gotcha).

</code_context>

<specifics>
## Specific Ideas

- **Shadow-base reset/compare** (maintainer's idea, D-04-10): a local shadow copy of the client
  TRE base lets the user reset the TRE base and diff "shadow vs pristine original." Folded in as
  the opt-in isolated-client mode — local-only, never versioned (copyright/size).
- **Base44 layered versioning** is the maintainer's deliberate, experience-backed pick for
  rollback — not a default. Build the real layered-stack UX (active-version toggle, greyed
  re-activatable layers), not a simpler snapshot substitute.

</specifics>

<deferred>
## Deferred Ideas

- **Cross-session shadow-base reset (post-MVP tech debt — plan-checker W-NEW-2):** the shadow-base
  deploy stores a `ShadowDeployRecord` into the changeset's `deployRecord` field via an
  `as unknown as CfgDeployRecord` cast. **Within-session** reset works (covered by 04-06b UAT) since
  it uses the live in-memory record; **cross-session** reset (reading the record back from
  `manifest.json` in a later session) would mis-type the shadow fields. Fix when needed: make
  `SwgChangeset.deployRecord` a discriminated union (`CfgDeployRecord | ShadowDeployRecord`) or add a
  `deployModelKind` tag. Accepted as post-MVP — not in the Phase-4 UAT checklist.
- **Remote differential CDN sync** (SHA-256 broadphase + targeted compressed delivery, layer 4 of
  the version-control doc) — explicitly v2/deferred per REQUIREMENTS. Not in Phase 4.
- **App auto-update / Squirrel / asset-template streaming** (packaging doc §6) — app distribution,
  not mod deploy. Separate concern, not this phase.
- **Reviewed Todos (not folded):** the `todo.match-phase` hits (`inapp-console-log-tabs-inactive`,
  `tre-mount-perf-marshalling`, `viewport-shader-blend-mode`) were keyword false-positives — none
  relate to edit/deploy/`.tre`-patch/`.cfg`. Not folded.

</deferred>

---

*Phase: 04-edit-deploy-loop*
*Context gathered: 2026-06-26*
