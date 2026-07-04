# swg-main Server Push — Client–Server Parity (Second Flavor)

> **Scope note:** this file covers the swg-main (VirtualBox VM) server-push mechanism ONLY. It
> is kept deliberately separate from [`core3-parity.md`](./core3-parity.md) (Core3/SWGEmu's
> TRE-search-path push) — swg-main has **no TRE-archive concept server-side at all**;
> `exe/shared/servercommon.cfg`'s `[SharedFile] searchPath0/1/2=` reads game data directly from
> loose compiled source directories. This is architecturally a **server-side
> `looseOverrideDeploy`**, not a TRE push — the two server flavors are independently
> completable, no-shared-abstraction mechanisms by design (04.4-RESEARCH.md Pitfall 4).
>
> Everything in this file is confirmed against the real `../swg-main` source tree and the
> maintainer's live VirtualBox VM instance — it is NOT an AI-proposed section (contrast with
> `core3-parity.md`'s upper sections, which remain AI-proposed design sketches per
> [source provenance](../00-overview/source-provenance.md)).

---

## Verified: swg-main Server Push (2026-07-03)

### The mechanism

- `packages/renderer/src/services/swgMainServerPush.ts` exports:
  - `resolveSwgMainOverrideDir(servercommonCfgPath)` — parses `[SharedFile] searchPath<N>=` and
    resolves the winning (highest-priority-tier) directory.
  - `pushSwgMainOverride(servercommonCfgPath, studioDir, activeVersionId, manifest)` — flattens
    the active version's staged entries and writes them into the resolved directory by porting
    `looseOverrideDeploy.deployLoose` verbatim (B3 pre-existing-file snapshot,
    `isVirtualPathSafe`/`isConfinedToRoot` guards, atomic tmp+rename), then persists the
    returned record to `studioDir/serverPush.swgmain.json` (atomic tmp+rename, mirroring
    `changesetService.writeManifest`).
  - `readSwgMainPushRecord(studioDir)` — never-throws read of the persisted record.
  - `resetSwgMainOverride(record)` — a thin wrapper of `looseOverrideDeploy.resetLoose` (byte-for-byte
    identical restore semantics; the restore logic is NOT duplicated).
  - `clearSwgMainPushRecordFile(studioDir)` — standalone best-effort unlink.

### PATH CONTRACT (locked, identical in 04.4-12)

`serverConfig.path` (serverConfig type `'swgsource-docker'` — a historical label; the actual
deployment is a VirtualBox VM, see below) is the swg-main REPO ROOT. `servercommonCfgPath` is
ALWAYS `path.join(serverConfig.path, 'exe', 'shared', 'servercommon.cfg')` — **VERIFIED
2026-07-03 by a direct filesystem check**: `D:/Code/swg-main/exe/shared/servercommon.cfg` exists
at exactly that relative path. This is a cited fact, not a guess; callers (04.4-12) use this exact
join and never re-derive it from a different relative path.

### RESET-RECORD-CLEAR CONTRACT (round-2, locked)

`resetSwgMainOverride(record)` undoes the loose-file write only — it never touches
`serverPush.swgmain.json`. Clearing that persisted record file after a successful reset is
EXCLUSIVELY the caller's (04.4-12's) job: its Reset handler calls `resetSwgMainOverride(record)`
THEN `clearSwgMainPushRecordFile(studioDir)`, explicitly, in that order. This matches 04.4-07's
identical `resetCore3TreOverride`/`clearCore3PushRecordFile` contract for the Core3 flavor.

---

### swg-main `searchPathN` priority resolution — verified against real source, WITH A CORRECTION

Read directly from `../swg-main/src/engine/shared/library/sharedFile/src/shared/TreeFile.cpp`
this session (the "sharedFile" library — literally shared source between client and server
builds off this codebase):

- **`TreeFile::install`** (`TreeFile.cpp:84-149`) reads `[SharedFile] searchPath<N>=` for `N`
  ascending `0..maxPriority`, once per process (a second `install()` call `DEBUG_FATAL`s). For a
  key with multiple declared values (e.g. two `searchPath2=` lines), `ConfigFile::getKeyString`
  is called with `index=0,1,2,...` in FILE-DECLARATION order — confirmed against
  `ConfigFile::Key::addValue` (`sharedFoundation/ConfigFile.cpp:1133-1137`, `push_back` onto an
  ordered `std::list`) and `ConfigFile::Key::getAsString` (lines 1207-1218, forward iteration
  from `begin()`). `TreeFile::addSearchPath(value, priority)` (`TreeFile.cpp:322-325`) is called
  once per declared value, in that same file order, and funnels into `addSearchNode`.
- **`TreeFile::searchNodePriorityOrder`** (`:285-288`) = `a->getPriority() > b->getPriority()`;
  **`addSearchNode`** (`:299-308`) inserts via
  `std::lower_bound(begin, end, newNode, searchNodePriorityOrder)` — **priority DESC confirmed**
  (a higher numeric `N` is searched before a lower one).
- **`TreeFile::open`** (`:711-715`) walks `ms_searchNodes` from `begin()` to `end()`; the first
  node whose `open()` returns a non-null, non-deleted result wins — **first-match-wins
  confirmed**.

#### Tie-break within a priority tier — CORRECTED (this session)

The `04.4-RESEARCH.md` ADDENDUM ("Server-Push Mounts & Reload Semantics", 2026-07-03
mount-research pass) asserted, reading the `:294-296` comment at face value, that a tie within a
priority tier resolves to the **earlier-declared** value winning — stating this as a correction
of a prior "later-added wins" assumption. **That assertion is FALSIFIED** and is corrected here,
for two independent reasons:

1. **A from-scratch re-derivation of the actual code** (not the comment) this session: for an
   exact-priority tie, `std::lower_bound(begin, end, newNode, comp)` with
   `comp(a,b) = a.priority > b.priority` returns the position of the **first existing
   equal-priority element**, and `ms_searchNodes.insert(insertionPoint, newNode)` places the
   *new* node **before** that position — i.e. before every pre-existing tied element. The
   most-recently-added node therefore ends up **earliest** in the search order (`ms_searchNodes`
   is walked front-to-back) and **wins**. The `:294-296` comment ("new nodes... inserted after
   the last priority match") does not match the code's actual behavior.
2. **This exact comment-vs-code ambiguity, for the SAME shared mechanism, was already settled by
   a real passing test in this repo** — the client-side TRE-archive mount resolver shares the
   identical `addSearchNode`/`searchNodePriorityOrder`/`std::lower_bound` logic (same
   `TreeFile.cpp`, same shared library):
   - `packages/native-core/modules/core/tre/TreMount.h:13-20` documents: "the client code at
     TreeFile.cpp:294-296 comments that equal-priority nodes insert AFTER the last match, but
     the code ... actually ... inserts the NEW node BEFORE the existing same-priority nodes —
     so the MOST RECENTLY MOUNTED equal-priority archive wins."
   - `packages/harness/test/tre-override.test.ts` ("tre priority tie-break" suite,
     `expect(result.winner).toBe(pathB)`, `pathB` being the SECOND-mounted archive at an equal
     priority) is a real, currently-passing test that measures this.
   - `.planning/STATE.md` records this as a locked decision: "[Phase 01, Plan 02]: Same-priority
     tie-break: SECOND-mounted equal-priority archive wins (verified by test from
     TreeFile.cpp:294-296 code-vs-comment ambiguity)".

   There is no server-specific override of `addSearchNode` — `addSearchPath` (server-side loose
   dirs) and the client's archive-mount path both call the exact same function.

**Corrected conclusion (locked):** within a `searchPath<N>` tier with multiple declared values, the
**LAST-DECLARED value in the file wins** (it is installed last, therefore inserted earliest in
`ms_searchNodes`, therefore searched first). For the real `servercommon.cfg` shown below, the
winning `searchPath2` value is the SECOND line, `../../data/sku.0/sys.server/compiled/game/` —
**not** the first line (`sys.shared/compiled/game/`) as the RESEARCH.md ADDENDUM stated.
`resolveSwgMainOverrideDir` and `swgMainServerPush.test.ts` implement/pin this corrected rule.

```ini
[SharedFile]
searchPath2=../../data/sku.0/sys.shared/compiled/game/
searchPath2=../../data/sku.0/sys.server/compiled/game/   <- WINS (last-declared, tier 2 = highest)
searchPath1=../../data/sku.0/sys.shared/built/game/
searchPath1=../../data/sku.0/sys.server/built/game/
searchPath0=../../data/sku.0/sys.client/compiled/clientdata/
```

---

## Mounting the live swg-main (VirtualBox VM) from Windows — walkthrough

Ground-truthed against the maintainer's running server this session (04.4-RESEARCH.md ADDENDUM
"Server-Push Mounts & Reload Semantics"):

1. **The running server is a VirtualBox VM, not Docker.** The maintainer's swg-main runs in the
   official **SWGSource v3.0.2 VirtualBox VM** (openSUSE guest, bridged NIC — currently
   `192.168.1.200`, DHCP-assigned so it can drift; re-check the VM's IP if the share stops
   resolving). The `'swgsource-docker'` serverConfig type literal remains (shipped contract) but
   is historical labeling only.
2. **Push target is the LIVE server tree, reached via Samba.** The VM exports a Samba share
   named `SWG` (the `swg` user's home); the live server tree is host-visible at
   `\\<vm-ip>\SWG\swg-main`. Verified this session with the documented default credentials
   (`swg`/`swg`): `exe\shared\servercommon.cfg` and the full `data\sku.0\sys.{client,server,shared}`
   searchPath targets are all directly readable/writable from Windows over SMB. The live
   `servercommon.cfg` `[SharedFile]` block is line-identical to the `D:\Code\swg-main` checkout's.
   The sibling `D:\Code\swg-main` checkout used for source-reading in this repo is a
   **source/build tree the running server does not read** — writes there have zero effect on the
   live instance; it is valid for fixture-style testing only.
3. **One-time SMB credential setup.** Windows needs an SMB session for `fs` to write over that
   UNC path: either a persistent `cmdkey /add:<vm-ip> /user:swg /pass:...`, or a `net use
   \\<vm-ip>\SWG /user:swg ...` session. This is the "walk them through" step for the
   wizard/docs UI that wires `pushSwgMainOverride` into a project's server-push settings.
   `serverConfig.path` may therefore be a UNC root — no drive-letter assumptions anywhere in
   `swgMainServerPush.ts`'s path handling (`isConfinedToRoot` holds for `\\ip\share\...` roots).
4. **A `D:\SharedVM` vboxsf shared folder also exists but is empty/unused** — SMB is the working
   bridge for this deployment; do not rely on the vboxsf mount.

## Reload semantics a pusher must know

- `[SharedFile] searchPath<N>` is read **once per process at startup**
  (`TreeFile::install`, `TreeFile.cpp:84-149`; a second `install()` call `DEBUG_FATAL`s) — each
  server process (e.g. `SwgGameServer`) installs its search-node list independently, and **there
  is no runtime re-scan**.
- A loose `SearchPath` node is a **live disk passthrough** — `open()` hits the disk at request
  time with no boot-time index (`TreeFile_SearchNode.cpp:142-150`). A file pushed into an
  already-installed `searchPath<N>` directory is therefore served **immediately** for any asset
  not yet cached above the `TreeFile` layer.
- **Caveat: the `searchPath<N>` directory must exist at boot** — the `SearchPath` constructor
  `FATAL`s otherwise (`TreeFile.cpp:62-65`). Pushing into an EXISTING tier directory (this
  mechanism's design) is correct; adding a brand-new `searchPath` line would require both a
  pre-existing directory AND a server restart, and is out of scope for this push mechanism.
- **Caches above `TreeFile` hold already-loaded data until explicitly commanded.** There is
  **no automatic file-change detection anywhere**. Data already loaded into server-side caches
  (datatables, templates, etc.) needs an explicit console command to re-read:
  - `reloadTable` — reloads a datatable; broadcasts to all game servers
    (`ConsoleCommandParserServer.cpp:609-626`).
  - `reloadServerTemplate` — reloads an object template
    (`ConsoleCommandParserObject.cpp:1962-1986`).
  - Related: `reloadCommandTable`, `reloadAdminTable`, `reloadTerrain`, script `reload`.
- **`.tre` archives can NEVER be hot-mounted** on this server flavor — there is no TRE-archive
  concept server-side to begin with; this entire mechanism operates on loose files under an
  already-installed `searchPath<N>` directory.
- **Practical guidance for the toolkit's push UI:** after a successful `pushSwgMainOverride`
  call, surface mandatory copy along these lines: "Newly-added or never-yet-loaded assets are
  served immediately. Already-cached data (datatables, templates, etc.) needs `reloadTable` /
  `reloadServerTemplate` (or a full server restart) to pick up the change."
