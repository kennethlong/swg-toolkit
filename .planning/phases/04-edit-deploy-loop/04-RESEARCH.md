# Phase 4: Edit & Deploy Loop - Research

**Researched:** 2026-06-26
**Domain:** Mod workflow layer — TRE patch packaging, client `.cfg` activation, layered changeset rollback, Git/LFS for mod outputs
**Confidence:** HIGH (DEPLOY-01/02 verified against swg-client-v2 source + real Infinity client bytes; DEPLOY-03/04 schemas verified-with-corrections against ground truth and locked decisions)

## Summary

This phase is a **workflow layer**, not byte-format work — the native TRE engine (`buildTre`/`repackTre`), the IFF round-trip gate, the TRE mount/override resolver, and Extract are all already implemented (Phase 1–2). The four requirements wire those existing primitives into: a mod workspace, an explicit staging list, a deploy-patch builder, a safe `.cfg` activator, a non-destructive changeset rollback, and a Git/LFS posture that versions only mod outputs.

The single highest-value finding is the **ground-truth `.cfg` search-tree mechanism**, which differs materially from the AI-distilled docs and from the wording in REQUIREMENTS/CONTEXT. The real SWGEmu/Infinity client (and SOE engine `swg-client-v2`) does **not** use a literal repeated `searchTree=` directive. It uses **uniquely numbered keys `searchTree_<sku>_<priority>=file.tre`** inside a `[SharedFile]` section, where the numeric suffix **is** the priority and **higher number wins** (`a->getPriority() > b->getPriority()`, sorted highest-first; `find()` returns the first match). The live Infinity install mounts **`EERT5000` (v5000)** archives with `maxSearchPriority=60` and the highest occupied slot at 54 — so a mod patch should be built as **version `'5000'`** and registered at a **free higher slot (e.g. 55)**. This is verified against `swg-client-v2/.../TreeFile.cpp` + `ConfigFile.cpp` AND a hexdump/parse of the real `D:\SWG Infinity\...\Live\*.cfg` and `*.tre`.

Two locked-decision premises need correction before planning (details below): (1) the D-04-09 claim that `@swg/live-inject` already contains client *install* detection is **false** — live-inject only takes a user-supplied exe path or a PID; install/`.cfg` discovery is **new work**; and (2) the AI-distilled changeset doc's `PurgeChangesetLayer` (destructive `fs::remove_all`) and the separate `.tar.gz` snapshot engine both **contradict** the locked non-destructive single-history model (D-04-08/D-04-13) and must be rejected, while the doc's `activeVersionIndex`-pointer VFS is the correct, keepable core.

**Primary recommendation:** Build DEPLOY-01 on the existing `buildTre(entries, version='5000')`; activate via a `searchTree_<sku>_<NN>=` line written into a toolkit-owned `.cfg` that we `.include` from the client root cfg (never the launcher-regenerated `user.cfg`/`options.cfg`); model rollback as a JSON `activeVersionIndex` pointer over immutable on-disk changeset layers (no native delete); and route only mod-output binaries through LFS while gitignoring the rebuildable patch `.tre` and hard-banning retail bytes.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions (D-04-01 … D-04-15 — verbatim)

**Workspace & Staging**
- **D-04-01:** A mod project workspace = a user-chosen project folder (IDE-style "open project"), located wherever the user wants. Holds a `.studio/` control dir + a Git repo. One workspace per mod. (Not app-managed userData — chosen for clean per-mod Git/LFS remotes.)
- **D-04-02:** Edits are staged via an explicit "add to patch" staging list (decouples "edited" from "will ship"), NOT an implicit edit-the-tree-and-diff model.
- **D-04-03:** A staged item = virtual path + a replacement file on disk (produced via Extract→edit-externally / drop-in), plus support for add-new and delete (tombstone). This maps 1:1 onto the native `buildTre` entry shape (`path` + `data` + optional `tombstone`). Phase 5 typed editors extend this by emitting their output as a staged entry's bytes — same model.
- **D-04-04:** The deploy patch is built with `buildTre` of only the staged deltas — a small standalone archive containing just changed/added/deleted entries, mounted at higher `.cfg` priority to shadow retail (the standard SWG live-patch mechanism). Deletes are tombstone entries (length-0 TOC). `repackTre` (full-base rebuild) is the wrong shape for a patch and stays unused in this phase.

**Rollback (DEPLOY-03)**
- **D-04-05:** Rollback uses a layered changeset-stack ("Base44") model — maintainer's experience-backed choice. NOT a tentative AI-proposed selection. ⚠ Caveat scoped narrowly: validate the exact manifest field schema in the AI-distilled doc against real use before locking it — the *architecture* is the maintainer's decision, only the specific field layout needs ground-truth confirmation.
- **D-04-06:** A changeset captures the staging list + mod-produced replacement assets only — never the extracted retail base. Keeps history small and copyright-clean.
- **D-04-07:** A new changeset layer is sealed on both triggers: a manual checkpoint (user "commit changeset" anytime) and an auto-seal on pack/deploy (every deploy is guaranteed a rollback point for the exact shipped state).
- **D-04-08:** Rollback is a non-destructive version toggle — set the active-version pointer down; higher layers remain on disk (greyed in the timeline) and are re-activatable (redo). No `PurgeChangesetLayer`-style destructive delete on rollback. Work is never lost.

**`.cfg` Activation (DEPLOY-02)**
- **D-04-09:** Client/`.cfg` discovery = auto-detect known installs (SWG Infinity + SWGEmu) + manual folder override. Reuse the client-detection logic already in `@swg/live-inject` rather than writing new detection. *(⚠ See Open Question OQ-1 — this reuse premise is largely false; install discovery is new work.)*
- **D-04-10:** Offer BOTH deploy/isolation models at workspace setup:
  - *Default:* patch-prepend — add the patch `.tre` at higher `searchTree=` priority; never touch retail files. Originals stay pristine automatically and ARE the compare/reset baseline. Reset = remove the one `.cfg` line + delete the patch.
  - *Opt-in:* shadow-base "isolated client" — copy the client TRE base to a local shadow dir (with a disk-space warning), repoint the client base at the shadow, apply patches there; real install stays as the pristine reset/compare source. The shadow is local-only, never git-tracked.
- **D-04-11:** Workspace is fully usable with no client detected — authoring/extract/pack/version all work offline; client detection + `.cfg` activation are deploy-time only. Deploy is disabled behind a clear "point me at a client" prompt until a client is set.
- **D-04-12 (locked by DEPLOY-02 itself):** `.cfg` write is BOM-free, atomic, preserves duplicate `searchTree=` entries in priority order, backs up the `.cfg` before edit, and records the insertion so rollback can cleanly remove it. *(⚠ See Pitfall P-2 — "duplicate `searchTree=` entries" must be read as "existing `searchTree_NN_MM=` keys"; the real format uses unique numeric-suffixed keys, not literal duplicates.)*

**Git/LFS (DEPLOY-04)**
- **D-04-13:** The Git repo lives in the workspace folder (one per mod) and versions the changeset store (`.studio/changesets/` + manifest + staging metadata). Git is the collaboration/remote backbone underneath the in-app changeset rollback UX — one history system, not two competing ones.
- **D-04-14:** The built patch `.tre` is gitignored — it's a build artifact flattened from the active changeset stack on demand, fully derivable, so it's not committed. A separate "Release" action can export/attach it for distribution.
- **D-04-15:** "Never commit retail/extracted bytes" is enforced with defense in depth: auto-written `.gitignore` (`extracted_vanilla_base/`, the shadow TRE dir, build artifacts) + auto-written `.gitattributes` (route mod-output binaries through LFS) + explicit-path staging (never blind `git add .`) + a pre-commit size/origin guard that blocks suspiciously large or retail-fingerprinted `.tre` files with a clear error.

### Claude's Discretion
- Exact on-disk layout of `.studio/` (changesets dir naming, manifest filenames) — propose a concrete layout in planning, grounded in the version-control doc's schema (validate fields).
- The specific client install-path/registry keys used for auto-detection — derive from the live-inject detection code + the installed clients (`D:\SWG Infinity`, `D:\SWGEmu Client`).
- UI surfaces (staging panel, changeset timeline, deploy dialog, VCS panel) — the doc provides reference React components; treat as starting designs, fit to the existing dockview shell.

### Deferred Ideas (OUT OF SCOPE)
- Remote differential CDN sync (SHA-256 broadphase + targeted compressed delivery, layer 4 of the version-control doc) — v2/deferred. Not in Phase 4.
- App auto-update / Squirrel / asset-template streaming — app distribution, not mod deploy.
- Typed/rich in-app editors (DTII grid, `.stf`, gizmo) — Phase 5.
- v6000 (encrypted) archives — enumerate-only, cannot be repacked/patched.
- Committing retail/extracted `.tre` bytes to any VCS — hard-banned.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| DEPLOY-01 | User can repack edits into a deployable `.tre` patch archive that the client loads. | Existing `buildTre(entries, version)` (index.d.ts:472-518) takes exactly the `{path, data, tombstone}` staging shape. Build with `version='5000'` to match the live Infinity client's `EERT5000` archives. Tombstone (length-0) shadow confirmed loadable: `TreeFile.cpp:437-461` `find()` `!deleted` loop + `TreeFile_SearchNode.cpp:397` `length==0 ⇒ deleted`. |
| DEPLOY-02 | System updates client `.cfg` search order with safe, BOM-free, atomic, backed-up write preserving priority order. | Ground truth: `searchTree_<sku>_<priority>=file.tre` in `[SharedFile]`; higher suffix wins; `maxSearchPriority` gates scan. Verified `TreeFile.cpp:102-149,285-308` + `ConfigFile.cpp:359-518` + real `swgemu_live.cfg`. Safe write target + atomic/BOM/backup pattern in DEPLOY-02 section below. |
| DEPLOY-03 | User can roll back via changeset/snapshot history that reverts the workspace to a prior state. | Base44 model: keep the doc's `WorkspaceChangesetManifest.activeVersionIndex` pointer + immutable on-disk layers (version-control-and-backup.md:530-607). Reject `PurgeChangesetLayer` (destructive). Rollback = JSON pointer write, not native. |
| DEPLOY-04 | User can version mod-produced assets via Git/LFS; fresh clone small, no retail `.tre` in `git log`. | git 2.49 + git-lfs 3.6.1 present. Auto-write `.gitignore` + corrected `.gitattributes` (gitignore `*.tre`, LFS the changeset payload binaries), explicit-path staging, pre-commit guard. Renderer is Path B node-capable (`useLiveService.ts:22` imports `fs`); shell out to git via `child_process`. |
</phase_requirements>

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Build deploy patch from staged deltas (DEPLOY-01) | native-core C++ (`buildTre`) | renderer (assembles entry array, zero-copy `ArrayBuffer`) | Heavy zlib + byte-exact assembly already lives in C++; binary crosses bridge zero-copy per AGENTS.md. |
| `.cfg` parse/locate/write (DEPLOY-02) | renderer (Path B node `fs`) or main | — | Text-file edit; no native code needed. Path B renderer already imports `fs`. |
| Client install discovery (DEPLOY-02) | renderer/main (registry + known-path probe) | live-inject (only for running-process exe path) | Filesystem/registry probing; live-inject offers no install discovery (see OQ-1). |
| Changeset store + manifest + rollback toggle (DEPLOY-03) | renderer/main (JSON + fs) | — | Pure metadata + file moves; the doc's native rollback engine is rejected (destructive). |
| Patch flatten (changeset stack → one `.tre`) (DEPLOY-01/03) | renderer (resolve top-down) → native-core `buildTre` | — | VFS resolution in JS, byte assembly in C++. |
| Git/LFS operations (DEPLOY-04) | renderer/main (`child_process` → system git/git-lfs) | — | Standard CLI shell-out; no native binding. |
| Pre-commit retail-bytes guard (DEPLOY-04) | git hook (workspace `.git/hooks/pre-commit`) AND app-side staging guard | — | Defense in depth (D-04-15); hook catches CLI commits, app guard catches in-app commits. |

## Standard Stack

This phase adds almost no third-party dependencies — it composes existing in-repo primitives and the system `git`/`git-lfs` CLIs. Node built-ins (`fs`, `path`, `os`, `crypto`, `child_process`) cover the rest.

### Core
| Library / Primitive | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@swg/native-core` `buildTre` | in-repo (Phase 1 01-04) | Build the deploy patch `.tre` from staged deltas | `[VERIFIED: index.d.ts:472-518]` Already implements the exact `{path,data,tombstone}` shape + byte-determinism + zlib L6. |
| system `git` | 2.49.0.windows.1 | Version the changeset store | `[VERIFIED: git --version]` Present on this machine. |
| system `git-lfs` | 3.6.1 | Route mod-output binaries off the main history | `[VERIFIED: git lfs version]` Present. |
| Node `crypto` (SHA-256) | Node 24 built-in | Changeset delta hashing + retail-fingerprint guard | `[VERIFIED: Node stdlib]` No native SHA worker needed at this scale (the doc's `wincrypt` C++ worker is for the deferred CDN layer). |
| Node `fs`/`child_process` | Node 24 built-in | `.cfg` write, git shell-out, file staging | `[VERIFIED: useLiveService.ts:22]` Path B renderer already uses `fs` directly. |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `node-stream-zip` / `tar` | n/a — **do NOT add** | (doc proposes `.tar.gz` snapshots) | Skip — the `.tar.gz` snapshot engine (doc §2) is a second history system, banned by D-04-13. |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Shell out to system `git` | `isomorphic-git` / `simple-git` | `isomorphic-git` has weak LFS support; `simple-git` is just a wrapper over the same CLI. The doc and D-04-15 assume the system CLI (git hooks, `git lfs`); shelling out is the lowest-risk choice. Verify git-lfs presence at workspace init and surface a clear error if absent. `[ASSUMED]` |
| Writing our own `.cfg` we `.include` | Editing `swgemu_live.cfg` in place | Editing `swgemu_live.cfg` risks launcher clobber (it carries the server patch manifest); a toolkit-owned `.include`d cfg is clobber-safe and works for stock SWGEmu too. |

**Installation:** No `npm install` required for the core path. Verify CLI tools at workspace init:
```bash
git --version          # confirmed 2.49.0.windows.1
git lfs version        # confirmed git-lfs/3.6.1
```

## Package Legitimacy Audit

This phase installs **no new external npm packages** for the core path. The only optional candidates (`simple-git`, `tar`) are not recommended (see Alternatives / Supporting). If the planner chooses to add one, it must run the Package Legitimacy Gate before install and gate it behind a `checkpoint:human-verify` task.

| Package | Registry | Disposition |
|---------|----------|-------------|
| (none) | — | No external packages required. |

## Architecture Patterns

### System Architecture Diagram

```
                EXTRACT (Phase 2 02-05)
  mounted retail TRE ──readMountEntry──> replacement file on disk (.studio working copy)
                                              │  (user edits externally / drops in)
                                              v
  ┌──────────────── MOD WORKSPACE (user-chosen folder) ─────────────────────────┐
  │                                                                              │
  │  [ Staging List ]  add/modify/delete entries                                │
  │   entry = { virtualPath, replacementFilePath | tombstone }                  │
  │        │                                                                     │
  │        │  "Commit changeset" (manual)  ──┐                                   │
  │        v                                  │                                  │
  │  .studio/changesets/<id>/<virtualPath>    │  seal layer (immutable)          │
  │  .studio/changesets/manifest.json  <──────┘  activeVersionIndex++            │
  │   (Git-versioned: D-04-13)                                                   │
  │        │                                                                     │
  │        │  "Pack patch" (auto-seals a changeset too: D-04-07)                 │
  │        v                                                                     │
  │  flatten active stack top-down ──> entries[]  ──> buildTre(entries,'5000')   │
  │        │                                              │                      │
  │        v                                              v                      │
  │  patch.tre (GITIGNORED build artifact: D-04-14) <─ ArrayBuffer (zero-copy)   │
  └────────┬─────────────────────────────────────────────────────────────────────┘
           │  DEPLOY  (gated until a client is set: D-04-11)
           v
  ┌─ patch-prepend (default) ─────────────┐   ┌─ shadow-base (opt-in) ──────────┐
  │ copy patch.tre into client dir        │   │ copy client TRE base → shadow   │
  │ write searchTree_<sku>_<NN>=patch.tre │   │ repoint client base at shadow   │
  │   into toolkit-owned .include'd .cfg  │   │ apply patch there; real install │
  │   (NN > max occupied, ≤ maxSearchPri) │   │ stays pristine reset source     │
  │ backup .cfg + record insertion        │   └─────────────────────────────────┘
  └───────────────┬───────────────────────┘
                  v
        SWG client (swgemu.exe) — TreeFile::install() scans [SharedFile],
        higher searchTree priority shadows retail (find() first-match-wins)
```

### Component Responsibilities
| Component | File (proposed) | Responsibility |
|-----------|-----------------|----------------|
| Workspace service | `packages/renderer/src/services/workspaceService.ts` | Open/create workspace folder, scaffold `.studio/`, init git repo, write `.gitignore`/`.gitattributes`, install pre-commit hook. |
| Staging store | `packages/renderer/src/state/stagingStore.ts` (Zustand) | The explicit add-to-patch list (D-04-02/03); entries map 1:1 to `TreBuilderEntryNative`. |
| Changeset service | `packages/renderer/src/services/changesetService.ts` | Seal layer (manual + auto-on-pack), manifest read/write, `activeVersionIndex` toggle (rollback/redo). |
| Patch builder | reuses native `buildTre`; thin wrapper `packPatch.ts` | Flatten active stack → entry array → `buildTre(entries, version)`; write gitignored `patch.tre`. |
| Cfg activator | `packages/renderer/src/services/cfgActivator.ts` | Locate client cfg chain, compute free priority slot, atomic BOM-free write, backup, record insertion for rollback. |
| Client locator | `packages/renderer/src/services/clientLocator.ts` | Registry/known-path probe for installs + manual override (NEW — not in live-inject). |
| Git service | `packages/renderer/src/services/gitLfsService.ts` | `child_process` git/git-lfs; explicit-path staging; pre-commit guard. |
| New contracts | `packages/contracts/src/{workspace,staging,changeset,deploy}.ts` | Typed surfaces; register in `contracts/src/index.ts`. Rebuild `@swg/contracts` after edits (Phase 2 gotcha). |

### Pattern 1: Deploy patch built from staged deltas (DEPLOY-01)
**What:** Map each staging entry to a `TreBuilderEntryNative`, call `buildTre` once.
**When:** On "Pack patch" and on flatten-active-stack.
```typescript
// Source: index.d.ts:472-518 (buildTre / TreBuilderEntryNative)
// version '5000' matches the live Infinity client's EERT5000 archives (verified by hexdump)
const entries: TreBuilderEntryNative[] = staged.map((s) =>
  s.action === 'delete'
    ? { path: s.virtualPath, tombstone: true }              // length-0 TOC ⇒ shadows retail
    : { path: s.virtualPath, data: readFileSync(s.replacementFilePath) }
);
const patchBytes: ArrayBuffer = buildTre(entries, '5000');
```

### Pattern 2: Ground-truth `.cfg` activation (DEPLOY-02)
**What:** Insert one `searchTree_<sku>_<NN>=patch.tre` key at a free, higher priority.
**When:** On deploy (patch-prepend model).
```
[SharedFile]
    maxSearchPriority=60                 ; gate — must be ≥ NN; bump if needed
    searchTree_00_55=swgtoolkit_mymod.tre   ; NN=55 > highest occupied (54) ⇒ shadows all retail
```
Write this block into a toolkit-owned cfg (e.g. `swgtoolkit.cfg`) and add a single `.include "swgtoolkit.cfg"` line to the client root `swgemu.cfg`. Record `{cfgPath, includeLine, keyName, slot, backupPath}` for clean rollback.

### Anti-Patterns to Avoid
- **Writing `searchTree=` (no suffix) or literal duplicate keys.** The engine builds the key string as `searchTree%s%d` (`TreeFile.cpp:133`); a bare `searchTree=` is never read. Use the `_<sku>_<priority>` form matching the existing cfg.
- **Editing `user.cfg`/`options.cfg`.** Both are "Auto-generated by Infinity Launcher" (header comment) → clobbered on next launch. Edit a toolkit-owned `.include`d file instead.
- **Editing `swgemu_live.cfg` in place.** Carries the server patch manifest; risky and launcher-managed.
- **Native `PurgeChangesetLayer` on rollback.** Destructive `fs::remove_all` violates D-04-08. Rollback is a JSON pointer write.
- **`git add .`** Violates D-04-15 explicit-path-staging. Stage `.studio/` paths explicitly.
- **LFS-tracking `*.tre`.** Invites committing patch/retail bytes; contradicts D-04-14/15. Gitignore `*.tre`; LFS the changeset payload binaries.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| TRE byte assembly + zlib + MD5 trailer | A new packer | `buildTre` (index.d.ts:515) | Byte-determinism + raw-slice identity already proven in Phase 1 01-04. |
| Tombstone/override resolution preview | A new resolver | `resolveEntry`/`resolveChain`/`listMountEntries` (index.d.ts:206-304) | Mirrors client `find()` semantics; reuse to preview what the patch shadows before deploy. |
| `.cfg` semantics (priority, includes, comments, duplicate keys) | A guessed parser | Match `ConfigFile.cpp:359-518` exactly | The format has non-obvious rules (`#`/`;` comments, `.include`, `&` multi-assign, section merge across includes, duplicate-key accumulation). |
| SHA-256 hashing | The doc's `wincrypt` C++ AsyncWorker | Node `crypto.createHash('sha256')` | At workspace scale this is trivially fast in JS; the native worker is for the deferred CDN layer only. |
| Git plumbing | Reimplementing index/LFS | system `git`/`git-lfs` via `child_process` | git-lfs filter integration + hooks require the real CLI. |

**Key insight:** Phase 4 writes almost no new binary or algorithmic code. The risk is **integration correctness** (does the built patch actually load and shadow in the real client?) and **safety** (no retail bytes in git, no clobbered cfg). Budget verification, not invention.

## Common Pitfalls

### Pitfall 1: Patch built with the wrong TRE version won't be the one the client mounts
**What goes wrong:** `buildTre` defaults to `'0005'` (TREE0005). The live Infinity client mounts `EERT5000` (v5000) archives.
**Why:** Each shard ships a particular TRE version; an archive in a version the client doesn't expect may be ignored or mishandled.
**How to avoid:** Default the patch version to `'5000'`, or better, **detect** the version of an existing mounted client `.tre` and match it. Make version a deploy parameter.
**Warning signs:** Patch present in cfg + correct priority but its files don't appear in-game.
`[VERIFIED: hexdump of D:\SWG Infinity\...\Live\bottom.tre = "EERT5000"; index.d.ts:508 version param]`

### Pitfall 2: "Preserve duplicate `searchTree=` entries" is a mis-specification
**What goes wrong:** Implementing a writer that looks for repeated `searchTree=` lines finds none and/or writes a key the engine never reads.
**Why:** The AI doc and the D-04-12 wording assume a bare repeated directive. The real keys are `searchTree_<sku>_<priority>` (unique numeric suffix = priority). The ConfigFile parser *does* support literal duplicate identical keys (`addValue`, `ConfigFile.cpp:509-516`), but retail/Infinity cfgs never use that; they use unique suffixes.
**How to avoid:** Treat the requirement as "do not disturb existing `searchTree_*` keys; pick a free, higher numeric slot; ensure `maxSearchPriority ≥ slot`." Detect the existing sku suffix (`_00_`) and reuse it.
**Warning signs:** A planner task says "find and preserve `searchTree=` lines."
`[VERIFIED: TreeFile.cpp:118-149; ConfigFile.cpp:436-517; real swgemu_live.cfg]`

### Pitfall 3: `@swg/live-inject` has no install/`.cfg` detection to reuse
**What goes wrong:** A task assumes D-04-09 reuse and finds nothing — live-inject only exposes `launchAndInject(clientExe, …)` and `attachAndInject(pid, …)`.
**Why:** Phase 3 detection = *running process / user-supplied exe path*, not *installed-folder discovery*.
**How to avoid:** Build a small `clientLocator` (Windows registry + known paths `D:\SWG Infinity\…`, `D:\SWGEmu Client\…` + manual override). The one reusable bridge: if a client is *running*, derive its install dir from the process exe path. See OQ-1.
**Warning signs:** "Import detectClient from @swg/live-inject."
`[VERIFIED: live-inject/src/*.cpp + useLiveService.ts — no install discovery exists]`

### Pitfall 4: Launcher-regenerated cfg files get clobbered
**What goes wrong:** Writing the searchTree line into `user.cfg`/`options.cfg`; it vanishes on next launch.
**Why:** Both are "Auto-generated by Infinity Launcher" (verified header).
**How to avoid:** Write into a toolkit-owned cfg `.include`d from the stable root `swgemu.cfg`. The root only contains `.include` lines and is not regenerated. Note `user_infinity.cfg` is already `.include`d but missing — the parser tolerates missing includes (`ConfigFile.cpp:386-387` WARNING not fatal), so creating it is also viable.
**Warning signs:** Patch deactivates after relaunch.
`[VERIFIED: header comments + ConfigFile.cpp:386-387]`

### Pitfall 5: BOM / line-ending / atomicity corruption of `.cfg`
**What goes wrong:** Writing a UTF-8 BOM or mixed EOLs breaks the parser or causes diff churn.
**Why:** `ConfigFile::loadFile` reads raw bytes and parses byte-wise; a leading BOM would corrupt the first section/key. Real cfgs are BOM-free; line endings are mixed across files (root `swgemu.cfg` is CRLF, `swgemu_live.cfg` is LF).
**How to avoid:** BOM-free always; preserve the *existing* file's EOL style when editing; for a new toolkit cfg pick one style and be consistent. Write atomically (temp file + rename) and back up the original first (D-04-12).
**Warning signs:** Client fails to read config, or git shows whole-file churn.
`[VERIFIED: hexdumps — no BOM; CRLF/LF mix confirmed; ConfigFile.cpp:315-337 raw byte read]`

### Pitfall 6: The AI changeset doc embeds two banned mechanisms
**What goes wrong:** Implementing the doc literally adds a destructive `PurgeChangesetLayer` and a parallel `.tar.gz` snapshot engine.
**Why:** The doc predates the locked decisions. `PurgeChangesetLayer` (`remove_all`) violates D-04-08; the `.tar.gz` snapshot system (doc §2) is a second history, violating D-04-13.
**How to avoid:** Keep only the manifest + `activeVersionIndex`-pointer VFS (doc:530-607). Rollback/redo = move the pointer; layers persist on disk and grey out (the doc's timeline UI already renders `isRolledBack = versionIndex > activeVersion`). No native engine.
**Warning signs:** A task references `PurgeChangesetLayer`, `SwgLocalBackupManager`, or `snapshot_<id>.tar.gz`.
`[CITED: docs/06-workflow/version-control-and-backup.md:266-388,610-647]`

## Runtime State Inventory

This is partly a deploy/activation phase that mutates external client state, so a state inventory applies (focused on what the toolkit writes outside its own repo):

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None the toolkit must migrate. The mod's own changeset store lives under `.studio/` (new, git-versioned). | None. |
| Live service config | **Client `.cfg` chain** (`swgemu.cfg` → includes). DEPLOY-02 mutates this *outside* git. Insertion must be recorded (key, file, backup path) so rollback/reset removes exactly the added line. | Backup before edit; record insertion; provide reset. |
| OS-registered state | **Windows registry** install keys are the likely client-locator source (SWGEmu/Infinity launchers register install paths). Probe read-only; never written. | Read-only probe in `clientLocator`. |
| Secrets/env vars | None. | None — verified by scope (no auth in this phase). |
| Build artifacts | **Patch `.tre`** is a derived build artifact (gitignored, D-04-14). **Shadow-base TRE copy** (opt-in) is a large local-only artifact (gitignored). | Auto-write `.gitignore` entries; rebuild patch on demand. |

**The canonical question — "after every repo file is updated, what runtime systems still have old state?":** the client `.cfg` (handled via recorded insertion + backup + reset) and the deployed patch `.tre` in the client dir (handled via reset = remove cfg line + delete patch). Both are explicitly tracked for rollback per D-04-12 and D-04-10.

## Code Examples

### Locate the client cfg chain and find a free priority slot (DEPLOY-02)
```typescript
// Parse the [SharedFile] section across the .include chain, mirroring ConfigFile.cpp semantics.
// Source: swg-client-v2 ConfigFile.cpp:359-518 (processLine/processKeys), TreeFile.cpp:102-149.
interface SharedFileScan {
  skuSuffix: string;          // e.g. "_00_"  (sprintf "_%02d_", sku) — TreeFile.cpp:115
  maxSearchPriority: number;  // default 20 if unset — TreeFile.cpp:102
  occupiedSlots: number[];    // numeric suffixes already used by searchTree_<sku>_<NN>
}
function chooseSlot(scan: SharedFileScan): number {
  const next = Math.max(0, ...scan.occupiedSlots) + 1;   // higher number wins — TreeFile.cpp:287
  return next;                                            // caller bumps maxSearchPriority if next > it
}
```

### Atomic, BOM-free cfg write with backup (DEPLOY-02 / D-04-12)
```typescript
import fs from 'fs';
import path from 'path';
// 1. backup
fs.copyFileSync(cfgPath, cfgPath + '.swgtoolkit.bak');
// 2. compose new content preserving existing EOL; NO BOM
const eol = existing.includes('\r\n') ? '\r\n' : '\n';
const next = existing.replace(/\r?\n?$/, eol) + `[SharedFile]${eol}\tsearchTree${sku}${slot}=${patchName}${eol}`;
// 3. atomic: temp + rename (same volume)
const tmp = cfgPath + '.tmp';
fs.writeFileSync(tmp, next, { encoding: 'utf8' }); // utf8 writeFileSync emits NO BOM
fs.renameSync(tmp, cfgPath);
// 4. record { cfgPath, keyName: `searchTree${sku}${slot}`, slot, backupPath } for rollback
```

### Corrected `.gitattributes`/`.gitignore` for the mod workspace (DEPLOY-04)
```gitattributes
# .gitattributes (auto-written into the MOD WORKSPACE repo, not the toolkit repo)
# LFS-route the mod-OUTPUT binaries that ARE versioned (the changeset payload assets):
*.dds  filter=lfs diff=lfs merge=lfs -text
*.png  filter=lfs diff=lfs merge=lfs -text
*.msh  filter=lfs diff=lfs merge=lfs -text
*.mgn  filter=lfs diff=lfs merge=lfs -text
*.ans  filter=lfs diff=lfs merge=lfs -text
# NOTE: do NOT LFS-track *.tre — it is gitignored (rebuildable patch artifact, D-04-14).
```
```gitignore
# .gitignore (auto-written into the MOD WORKSPACE repo)
extracted_vanilla_base/      # retail bytes — NEVER tracked (D-04-15)
*.tre                        # built patch is a derivable artifact (D-04-14)
.studio/shadow/              # opt-in shadow-base TRE copy — local-only (D-04-10)
.studio/build/               # transient pack outputs
```

### Pre-commit retail-bytes guard (DEPLOY-04 / D-04-15)
```bash
#!/bin/sh
# .git/hooks/pre-commit — block large or retail-fingerprinted .tre files
for f in $(git diff --cached --name-only); do
  case "$f" in
    *.tre) echo "REJECTED: $f — .tre is gitignored/rebuildable; never commit a patch or retail archive." >&2; exit 1;;
  esac
  sz=$(git cat-file -s ":$f" 2>/dev/null || echo 0)
  if [ "$sz" -gt 52428800 ]; then echo "REJECTED: $f is ${sz} bytes (>50MB). Use LFS or exclude." >&2; exit 1; fi
done
```

## State of the Art

| Old Approach (AI docs) | Current Approach (ground truth) | Why |
|------------------------|----------------------------------|-----|
| `searchTree=patch.tre` (single directive) | `searchTree_<sku>_<priority>=patch.tre` (unique numeric-suffix keys) | The engine string-builds the key per priority; bare `searchTree=` is never read. |
| `PurgeChangesetLayer` native delete on rollback | `activeVersionIndex` pointer toggle, layers persist | D-04-08 non-destructive; doc engine is destructive. |
| `.tar.gz` local snapshot engine (doc §2) | Single changeset stack IS the history | D-04-13 one-history. |
| LFS-track `*.tre` | Gitignore `*.tre`; LFS payload binaries | D-04-14/15 copyright + size safety. |
| Native `wincrypt` SHA worker | Node `crypto` SHA-256 | CDN-scale optimization not needed in this phase. |

**Deprecated/outdated for this phase:**
- Doc §4 Remote Differential Sync — deferred (v2).
- Doc's `contextBridge` preload examples — the project runs **Path B** (`nodeIntegration:true`, `contextIsolation:false`); renderer calls `fs`/`child_process` directly (FND-01/02). Do not reintroduce a contextBridge surface for these ops.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Building the patch as `version='5000'` (matching the live client's `EERT5000`) makes it mount correctly; the byte-exact gate is satisfied by a loads-in-client check. | DEPLOY-01 / Pitfall 1 | Patch present but inert; needs a real in-client load test to confirm (only Infinity available — SWGEmu not installed). |
| A2 | Writing a toolkit-owned cfg `.include`d from `swgemu.cfg` survives launcher runs (root cfg is stable). | DEPLOY-02 / Pitfall 4 | Insertion clobbered on relaunch if the launcher rewrites the root cfg. Verify by relaunch test; fall back to `user_infinity.cfg` creation. |
| A3 | Stock SWGEmu uses the same `searchTree_<sku>_<priority>` + `maxSearchPriority` convention as Infinity (Infinity is SWGEmu-derived). | DEPLOY-02 | SWGEmu not installed here; could not byte-verify a second client. The engine source (`swg-client-v2`) is shared, so HIGH confidence, but the default `maxSearchPriority=20` (vs Infinity's 60) means a stock client may need the value bumped to admit a high slot. |
| A4 | Windows registry holds SWGEmu/Infinity install paths usable by the client locator. | DEPLOY-02 / OQ-1 | If absent, fall back to known-path probe + manual override (D-04-09 already allows manual override, so non-blocking). |
| A5 | `child_process` git/git-lfs from the Path B renderer is the right process posture (vs main). | DEPLOY-04 | If a future packaged build tightens the renderer, these may need to move to main/IPC. Low risk now; `fs` is already used in-renderer. `[ASSUMED]` |
| A6 | The changeset payload binary extensions to LFS-track are the mod-output set (`.dds/.png/.msh/.mgn/.ans`); the exact list is discretionary. | DEPLOY-04 | Wrong list just means some binaries bloat history or some text is mis-binned; tunable post-hoc. |

## Open Questions

1. **OQ-1 — Client install discovery (D-04-09 reuse premise is false).**
   - What we know: `@swg/live-inject` exposes only `launchAndInject(clientExe)` / `attachAndInject(pid)`; no install/`.cfg` discovery exists (verified across `live-inject/src/*.cpp` + `useLiveService.ts`).
   - What's unclear: which Windows registry keys SWGEmu/Infinity launchers write; whether a running-process exe-path bridge is worth wiring.
   - Recommendation: plan a small new `clientLocator` (registry read + known-path probe `D:\SWG Infinity\…`, `D:\SWGEmu Client\…` + manual override). The manual override (already in D-04-09) makes this non-blocking even if auto-detect is imperfect. Optionally derive install dir from a live PID's exe path as a bonus.

2. **OQ-2 — Which exact cfg file to write (root `.include` vs `user_infinity.cfg`).**
   - What we know: root `swgemu.cfg` is stable (only `.include`s) and CRLF; `user_infinity.cfg` is already `.include`d but missing; `user.cfg`/`options.cfg` are launcher-clobbered.
   - What's unclear: whether the Infinity launcher ever rewrites `swgemu.cfg` or creates `user_infinity.cfg`.
   - Recommendation: default to adding `.include "swgtoolkit.cfg"` to the root cfg + a toolkit-owned `swgtoolkit.cfg`; verify persistence with a relaunch UAT; document `user_infinity.cfg` as the fallback target.

3. **OQ-3 — Changeset manifest deploy-record fields.**
   - What we know: the doc schema (`SwgChangeset`, `TreFileDelta`, `WorkspaceChangesetManifest`) covers id/versionIndex/label/timestamp/deltas + `activeVersionIndex`, which is sufficient for non-destructive toggle.
   - What's unclear: D-04-07 (auto-seal on pack) and D-04-12 (record cfg insertion) need extra metadata the doc schema lacks — e.g. `sealedBy: 'manual' | 'pack'`, and a `deployRecord { cfgPath, keyName, slot, backupPath, patchVersion }`.
   - Recommendation: extend `SwgChangeset` with `sealedBy` and an optional `deployRecord`; keep the rest of the doc schema. Flag these as the only schema additions needed (the D-04-05 caveat is thus satisfiable).

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `git` | DEPLOY-04 | ✓ | 2.49.0.windows.1 | none (blocking — surface clear error) |
| `git-lfs` | DEPLOY-04 | ✓ | 3.6.1 | Workspace works without LFS, but warn; binaries bloat history |
| `@swg/native-core` `buildTre` | DEPLOY-01 | ✓ | in-repo (Phase 1 01-04) | none — core primitive |
| SWG Infinity client | DEPLOY-02 in-client verify | ✓ | `D:\SWG Infinity\...\Live\` (EERT5000, swgemu.exe) | — |
| SWGEmu stock client | DEPLOY-02 second-client verify | ✗ | not installed (`D:\SWGEmu Client\SWGEmu` empty) | Verify against Infinity only; rely on shared `swg-client-v2` engine source for SWGEmu parity (A3) |
| Node `crypto`/`fs`/`child_process` | DEPLOY-03/04 | ✓ | Node 24 built-in | — |

**Missing dependencies with no fallback:** none blocking.
**Missing dependencies with fallback:** SWGEmu stock client not installed — DEPLOY-02 can only be byte-verified against Infinity; document SWGEmu parity as A3/inference, plan a `checkpoint:human-verify` if a stock client becomes available.

## Validation Architecture

`workflow.nyquist_validation` was not found disabled, so this section applies. Test framework is **Vitest** (project convention `.test.ts`, hoisted vitest with per-package `vitest.config.ts` — STATE.md Phase 03 note).

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest (per-package config) |
| Config file | `packages/<pkg>/vitest.config.ts` |
| Quick run command | `pnpm --filter @swg/<pkg> test` |
| Full suite command | `pnpm -r test` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| DEPLOY-01 | Staging entries → `buildTre` produces a deterministic patch; tombstone entry has length-0 TOC | unit | `pnpm --filter @swg/native-core test` (extend) | ❌ Wave 0 (`packPatch.test.ts`) |
| DEPLOY-01 | Built patch mounts via existing resolver and shadows a retail path (`resolveEntry` winner = patch) | integration | `pnpm --filter @swg/native-core test` | ❌ Wave 0 (`patch-shadow.test.ts`) |
| DEPLOY-01 | Built patch loads in the real client (Infinity) and the modded file appears | manual (UAT) | n/a — `checkpoint:human-verify` | ❌ (UAT) |
| DEPLOY-02 | `[SharedFile]` scan returns sku suffix, maxSearchPriority, occupied slots from a fixture cfg | unit | `pnpm --filter @swg/renderer test` | ❌ Wave 0 (`cfgScan.test.ts`) |
| DEPLOY-02 | Writer inserts free higher slot, preserves existing keys, BOM-free, preserves EOL, writes backup | unit | `pnpm --filter @swg/renderer test` | ❌ Wave 0 (`cfgActivator.test.ts`) — use real Infinity cfg copies as fixtures |
| DEPLOY-02 | Reset removes exactly the inserted key + restores backup | unit | same | ❌ Wave 0 |
| DEPLOY-03 | `activeVersionIndex` toggle re-resolves VFS top-down; layers persist on disk after rollback | unit | `pnpm --filter @swg/renderer test` | ❌ Wave 0 (`changeset.test.ts`) |
| DEPLOY-03 | Redo (raise pointer) re-activates a greyed layer; nothing deleted | unit | same | ❌ Wave 0 |
| DEPLOY-04 | `.gitattributes`/`.gitignore` auto-written; `*.tre` ignored; pre-commit guard rejects a staged `.tre` | integration | `pnpm --filter @swg/renderer test` (temp repo) | ❌ Wave 0 (`gitLfs.test.ts`) |
| DEPLOY-04 | Explicit-path staging never runs `git add .`; fresh clone has no `.tre` in `git log` | integration | same | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `pnpm --filter @swg/<pkg> test` for the touched package.
- **Per wave merge:** `pnpm -r test`.
- **Phase gate:** full suite green + an in-client UAT (Infinity) that the patch loads and shadows, before `/gsd:verify-work`.

### Wave 0 Gaps
- [ ] `packages/native-core/test/packPatch.test.ts` — DEPLOY-01 determinism + tombstone TOC.
- [ ] `packages/native-core/test/patch-shadow.test.ts` — built patch shadows retail via resolver.
- [ ] `packages/renderer/test/cfgScan.test.ts` + `cfgActivator.test.ts` — DEPLOY-02 (fixtures = **copies of the real Infinity cfgs**, gitignored if they contain retail tre names? names are fine; keep small text fixtures).
- [ ] `packages/renderer/test/changeset.test.ts` — DEPLOY-03 pointer toggle/redo non-destructive.
- [ ] `packages/renderer/test/gitLfs.test.ts` — DEPLOY-04 attributes/ignore/guard in a temp repo.
- [ ] Contracts: new `workspace.ts`/`staging.ts`/`changeset.ts`/`deploy.ts` + a native↔contract conformance guard for any new native field (Phase 2 pattern — though this phase likely adds none, since `buildTre` already exists).

## Security Domain

`security_enforcement` is not disabled, so this section applies. This phase writes to the filesystem outside the repo and shells out to git — the relevant risks are path/command injection and copyright/secret leakage, not auth.

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | n/a (local desktop tool) |
| V3 Session Management | no | n/a |
| V4 Access Control | no | n/a |
| V5 Input Validation | yes | Validate workspace path, client dir, patch name, commit message before use in `fs`/`child_process`. |
| V6 Cryptography | partial | SHA-256 via Node `crypto` for delta hashing/fingerprint — never hand-roll. |
| V12 Files & Resources | yes | Path-traversal guard on virtual paths (`..`), atomic writes, never write outside workspace/client dir. |

### Known Threat Patterns for this stack
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Command injection via commit message / paths into `child_process` git | Tampering / EoP | Use `execFile`/`spawn` with arg arrays (NOT `exec` string interpolation — the doc's `execAsync(\`git commit -m "${msg}"\`)` is injectable). |
| Path traversal in staged `virtualPath` writing into the client dir | Tampering | Normalize + reject `..`/absolute escapes before joining into changeset/client paths. |
| Copyright leak: retail `.tre`/extracted bytes committed | Info Disclosure | Defense-in-depth D-04-15: gitignore + LFS routing + explicit staging + pre-commit guard (size + `.tre` reject). |
| Cfg corruption / clobber of game config | Tampering / DoS | Backup before edit, atomic temp+rename, write only toolkit-owned `.include`d cfg, record insertion for clean reset. |
| Arbitrary client-dir write (deploy to wrong folder) | Tampering | Confirm detected/overridden client dir; gate deploy behind explicit client selection (D-04-11). |

**Note for the planner:** the AI doc's `SwgGitLfsService` uses `exec` with template-string interpolation (`version-control-and-backup.md:141,147`) — this is a command-injection vector. Re-implement with `execFile('git', ['commit','-m',msg], …)`.

## Sources

### Primary (HIGH confidence — ground truth)
- `swg-client-v2/src/engine/shared/library/sharedFile/src/shared/TreeFile.cpp` — `install()` :90-191 (searchTree key build, `maxSearchPriority`), `searchNodePriorityOrder` :285-288 (higher wins), `addSearchNode` :299-308, `find()` :437-461 (first-match + `!deleted` tombstone shadow).
- `swg-client-v2/.../sharedFile/.../TreeFile_SearchNode.cpp` — `localExists` :360-399 (`length==0 ⇒ deleted` tombstone), `SearchTree::open` :478-537, compressed TOC.
- `swg-client-v2/src/engine/shared/library/sharedFoundation/src/shared/ConfigFile.cpp` — `processLine` :359-429 (`#`/`;` comments, `.include` :369-394, section merge :410-423), `processKeys` :436-518 (key/value, duplicate-key `addValue` :509-516, `&` multi-assign, comment terminators).
- Real client bytes: `D:\SWG Infinity\SWG Infinity\Live\` — `swgemu.cfg` (`.include` chain, CRLF, no BOM), `swgemu_live.cfg` (`[SharedFile]` `maxSearchPriority=60`, `searchTree_00_30..54`, LF), `user.cfg`/`options.cfg` ("Auto-generated by Infinity Launcher"); `bottom.tre`/`infinity_custom_02.tre`/`mtg_patch_023.tre` magic = `EERT5000`.
- `packages/native-core/index.d.ts` — `buildTre`/`TreBuilderEntryNative` :472-518, `repackTre` :543-547, `resolveEntry`/`resolveChain`/`listMountEntries` :206-304 (version strings, tombstone, block order).
- `packages/renderer/src/hooks/useLiveService.ts` — live-inject surface (`launchAndInject`/`attachAndInject` only; no install detection); Path B `fs` import.
- `packages/live-inject/src/*.cpp`, `agent/*` — confirms inject/procmem/channel only; no client-locator.

### Secondary (MEDIUM — AI-distilled, verified-with-corrections)
- `docs/06-workflow/version-control-and-backup.md` — Base44 schema (:530-607 keepable; :266-388 `.tar.gz` and :610-647 `PurgeChangesetLayer` rejected; :141/:147 `exec` injection flagged).
- `docs/06-workflow/packaging-and-distribution.md:181-193` — `registerPatchInClientConfig(clientDir, patchName)` hook shape (interface only; uses contextBridge — not applicable under Path B).
- `.gitattributes` (toolkit repo) — existing binary/LFS posture (the mod-workspace files are separate, auto-written).

### Tertiary (LOW — to validate in-client)
- A1/A2/A3 in the Assumptions Log — patch-version load, cfg persistence across relaunch, SWGEmu-stock parity — require an in-client UAT.

## Metadata

**Confidence breakdown:**
- DEPLOY-01 (patch build): HIGH — primitive exists; only the version default (`'5000'` vs `'0005'`) and an in-client load UAT remain.
- DEPLOY-02 (cfg activation): HIGH on mechanism (engine source + real bytes); MEDIUM on the exact write-target file persistence (OQ-2/A2, needs relaunch UAT).
- DEPLOY-03 (rollback): HIGH — model verified against doc + locked decisions; only schema additions (`sealedBy`, `deployRecord`) needed.
- DEPLOY-04 (Git/LFS): HIGH — tooling present; corrections to the doc's attributes/exec-injection identified.
- Client locator (D-04-09): MEDIUM-LOW — reuse premise false; new small component, registry keys unconfirmed (A4/OQ-1).

**Cross-AI consult crew:** Not invoked — primary ground truth (real client source + asset bytes) was directly readable and decisive per the de-anchoring protocol. If the planner wants an independent cross-check, the highest-value targets are A2 (cfg persistence) and A3 (SWGEmu parity).

**Research date:** 2026-06-26
**Valid until:** ~2026-07-26 (stable — engine source and client format are fixed; only the toolkit's own `buildTre`/contracts could shift).
