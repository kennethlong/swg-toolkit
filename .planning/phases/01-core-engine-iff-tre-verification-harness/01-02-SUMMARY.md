---
phase: "01"
plan: "02"
subsystem: "core-engine / renderer"
tags:
  - tre-vfs
  - override-resolution
  - async-worker
  - ui-surface-1
  - zustand
  - shadow-chain
dependency_graph:
  requires:
    - "01-01"  # TRE read core + binding + harness infrastructure
  provides:
    - "TreMount override resolver (priority-based, tie-break verified)"
    - "resolveChain() with tombstone support"
    - "AsyncWorker TRE mount (off-main-thread, CORE-06)"
    - "TRE VFS Browser UI (Surface 1, D-06)"
    - "Zustand 5 treStore"
    - "mount/vfs StatusBar counters"
  affects:
    - "packages/native-core (TreMount.h/cpp, TreArchive.h/cpp, addon.cpp, tre_binding.cpp)"
    - "packages/harness (new test suites)"
    - "packages/renderer (new panels/state, SidebarPanel, StatusBar)"
    - "packages/contracts (dist rebuilt to include tre.d.ts)"
tech_stack:
  added:
    - "TreMount C++ class (priority-sorted std::vector<TreMountNode>)"
    - "Napi::AsyncWorker for off-thread TRE parse (CORE-06)"
    - "Zustand 5 (useTreStore — already in devDeps)"
    - "std::lower_bound priority insert from TreeFile.cpp:304"
    - "globMatch() two-pointer backtracking (* and ?)"
  patterns:
    - "Path B: require('@swg/native-core') directly in renderer (nodeIntegration:true)"
    - "Binary stays binary: ArrayBuffer payloads, never JSON (AGENTS.md)"
    - "v6000 enumerate-only gate: readMountEntry throws for encrypted archives"
    - "Search returns indices only (T-01-06 mitigation — never ship full name list)"
    - "3px DCC base grid via var(--space-*) tokens throughout"
    - "Accessibility Rule 5: aria-label + title on every icon-only control"
key_files:
  created:
    - "packages/native-core/modules/core/tre/TreMount.h"
    - "packages/native-core/modules/core/tre/TreMount.cpp"
    - "packages/harness/test/tre-override.test.ts"
    - "packages/harness/test/tre-async-zerocopy.test.ts"
    - "packages/renderer/src/state/treStore.ts"
    - "packages/renderer/src/panels/tre/TreVfsBrowser.tsx"
    - "packages/renderer/src/panels/tre/MountedArchivesList.tsx"
    - "packages/renderer/src/panels/tre/VfsTree.tsx"
    - "packages/renderer/src/panels/tre/VfsSearchField.tsx"
    - "packages/renderer/src/panels/tre/ShadowChainDetail.tsx"
    - "packages/renderer/src/shared/AsyncProgress.tsx"
  modified:
    - "packages/native-core/modules/core/tre/TreArchive.h (resolveTombstoneIndex)"
    - "packages/native-core/modules/core/tre/TreArchive.cpp (resolveTombstoneIndex)"
    - "packages/native-core/modules/core/CMakeLists.txt (TreMount.cpp added)"
    - "packages/native-core/src/tre_binding.cpp (mountTreMount, resolveEntry, resolveChain, searchMount, readMountEntry, disposeTreMount, mountArchiveAsync, mountSearchableAsync)"
    - "packages/native-core/src/addon.cpp (register new exports)"
    - "packages/native-core/index.d.ts (new TS interfaces + function declarations)"
    - "packages/renderer/src/panels/SidebarPanel.tsx (seed body → TreVfsBrowser)"
    - "packages/renderer/src/shell/StatusBar.tsx (mount/vfs counters)"
    - "packages/harness/fixtures/tre/README.md"
decisions:
  - "Same-priority tie-break: SECOND-mounted equal-priority archive wins (verified by passing test from TreeFile.cpp:294-296 code-vs-comment ambiguity)"
  - "resolveChain is OUR algorithm — the real client doesn't expose chains; invariant: resolveChain.winner === resolve.winner for non-tombstone"
  - "v6000 is enumerate-only (encrypted); v0006 is fully readable — warn chip appears ONLY on v6000 rows"
  - "Search returns matched indices only, never full name list (T-01-06 mitigation)"
  - "fixUpFileName: lowercase, backslash→slash, collapse repeated slashes, strip ./ and ../ (ported from TreeFile.cpp:511-601)"
  - "CRC-32: IEEE 0xEDB88320, init=0xFFFFFFFF, finalXOR=0xFFFFFFFF (matches Crc.cpp)"
  - "Test fixtures synthesized in-memory at runtime (not committed to disk)"
  - "Path B addon access: require('@swg/native-core') directly in renderer (nodeIntegration:true)"
metrics:
  duration: "~4h (across two sessions, second resumed from context summary)"
  completed: "2026-06-22"
  tasks_completed: 2
  tasks_total: 3
  files_created: 11
  files_modified: 9
---

# Phase 01 Plan 02: TreMount Override Resolver + VFS Browser UI Summary

**One-liner:** Priority-based TreMount override resolver with resolveChain/AsyncWorker binding and full TRE VFS Browser UI wired to the native pipeline via Zustand 5.

## Tasks Completed

| Task | Description | Commit |
|------|-------------|--------|
| 1 | TreMount override resolver + AsyncWorker binding + harness tests (CORE-01, CORE-02, CORE-06) | `61de191` |
| 2 | TRE VFS Browser UI wired to native pipeline (D-06) | `b4e1e2d` |
| 3 | Human-verify checkpoint | PENDING — see checkpoint below |

## Task 1: TreMount Override Resolver + AsyncWorker (CORE-01, CORE-02, CORE-06)

### What was implemented

**TreMount C++ class** (`packages/native-core/modules/core/tre/TreMount.h/cpp`):
- `addArchive()`: `std::lower_bound` with lambda `existing.priority > newNode.priority` — mirrors TreeFile.cpp:304 exactly
- `fixUpFileName()`: lowercase, backslash→slash, collapse repeated slashes, strip `./` and `../`
- `resolve()`: first-match priority walk, tombstone detection via `resolveTombstoneIndex()`
- `resolveChain()`: collects all archives containing the file; winner = first; shadows = rest
- `globMatch()`: two-pointer backtracking for `*`; single-char `?`; case-insensitive
- `search()`: substring (`std::string::find`) or glob over all archive entries

**AsyncWorker binding** (`packages/native-core/src/tre_binding.cpp`):
- `MountArchiveAsyncWorker::Execute()` — runs on libuv threadpool; parses archive; no Napi calls
- `MountArchiveAsyncWorker::OnOK()` — on main thread; stores TreMount in g_mounts; resolves Promise
- `MountSearchableAsyncWorker` — multi-archive async mount

**New N-API exports** (registered in `addon.cpp`):
- `mountTreMount`, `resolveEntry`, `resolveChain`, `searchMount`, `readMountEntry`, `disposeTreMount`, `mountArchiveAsync`, `mountSearchableAsync`

**Harness tests** (TDD pattern):
- `tre-override.test.ts`: 16 tests — higher-priority wins, tombstone shadows, same-priority tie-break, resolveChain invariants, 3-archive with tombstone-in-middle, tombstone-only
- `tre-async-zerocopy.test.ts`: 16 tests — Promise return, ArrayBuffer payload, wall-clock non-blocking (instrumented tick-counter), v6000 extraction refusal, substring search, glob `*`, glob `?`, 100k-entry search latency

### Settled ambiguity (ground-truth verified)
The code-vs-comment ambiguity in TreeFile.cpp:294-296 is resolved: **second-mounted equal-priority archive wins** (inserts before first, so it's returned first by `lower_bound` scan). Test `same-priority tie-break: second-mounted wins` confirms this behavior.

## Task 2: TRE VFS Browser UI (D-06)

### What was implemented

**Zustand 5 treStore** (`packages/renderer/src/state/treStore.ts`):
- `MountedArchive`, `VfsEntry`, `ShadowChainDisplay`, `MountStatus`, `SearchState` types
- Actions: `beginMount`, `mountComplete`, `mountError`, `setSearch`, `selectEntry`, `reset`

**Surface 1 components** (all spacing via `var(--space-*)` tokens, no hard-coded pixels):
- `TreVfsBrowser.tsx` (≥60 lines): mount toolbar, empty state, error state, search + tree layout; Path B addon access via `require('@swg/native-core')`
- `MountedArchivesList.tsx`: priority rows with `#N` badge, version chip, entry count; v6000-ONLY warn chip `≈ enumerate-only (encrypted)` — v0006 rows have no chip
- `VfsTree.tsx`: flat list with `⧉` override glyph (`aria-label="Overrides N lower archive(s)"`), `⊘` tombstone glyph, selected-file shadow chain inline; encrypted v6000 selected entry shows `🔒 encrypted payload — not extractable`
- `VfsSearchField.tsx`: 120ms debounce, `[*]` glob toggle, live match count; full `aria-label`/`title` on all controls
- `ShadowChainDetail.tsx` (≥25 lines): `resolves from: {archive} ✓ wins` / `shadows: {archive}` / tombstone `⊘ deleted here — hides lower archives`
- `AsyncProgress.tsx`: 3px bar, determinate/indeterminate animation, Cancel action

**Shell integrations:**
- `SidebarPanel.tsx`: seed body replaced with `<TreVfsBrowser/>` (panel header chrome preserved)
- `StatusBar.tsx`: added `mount: [N archives]`, `vfs: [N files]`, `⟳ mounting {filename} {pct}%` indicators via `useTreStore`

**Exact copy strings per UI-SPEC Copywriting Contract:**
- Empty heading: "No archive mounted"
- Empty body: "Mount Archive… to browse a .tre virtual filesystem"
- CTA: "Mount Archive…"
- Search empty: `No files match "{query}"` + "Clear search"

**Verification:** `npx tsc --noEmit --skipLibCheck` in `packages/renderer` — zero errors.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] contracts/dist out of date**
- **Found during:** Task 2 tsc check
- **Issue:** `packages/contracts/dist/index.d.ts` did not include `tre.js` export — `TreVersion` type was invisible to renderer and treStore.ts
- **Fix:** `npx tsc --build` inside `packages/contracts/` to regenerate dist (src/index.ts already had `export * from './tre.js'`)
- **Files modified:** `packages/contracts/dist/index.d.ts` (gitignored — not committed)
- **Commit:** N/A (dist gitignored); `pnpm-lock.yaml` included in task 2 commit

### Deferred Items

**1. VfsTree full chain build via native resolveChain**
- `buildChain()` in VfsRow returns `null` for single-archive entries (no shadows). Full chain building (calling `resolveChain()` natively for each row on hover) is deferred to Phase 2 because it would require a batch-resolve on mount for all 100k+ entries.
- The `TreVfsBrowser.handleSelectEntry` handler calls `resolveChain()` on click — shadow chain IS shown on selection for multi-archive files.

**2. Priority reorder drag**
- Drag handle `⠿` is rendered in `MountedArchivesList` but wired as a visual placeholder only (deferred — no DnD library yet).

**3. Archive version detection**
- `MountedArchive.version` defaults to `'v0005'` in `TreVfsBrowser.handleMountClick()`. Real version detection requires extending the native binding to expose `TreArchive::version()` — tracked for a minor follow-up. The v6000 `isEnumerateOnly` flag also defaults to `false` in this initial wiring; full version/flag population requires the same native extension.

## Known Stubs

| Location | Stub | Reason | Future plan |
|----------|------|---------|-------------|
| `TreVfsBrowser.tsx:handleMountClick` | `version: 'v0005'` hardcoded | Native binding doesn't yet expose per-archive version string | Phase 1 minor: expose `TreArchive::version()` in N-API |
| `TreVfsBrowser.tsx:handleMountClick` | `isEnumerateOnly: false` hardcoded | Same as above — needs native version to set | Same |
| `VfsTree.tsx:buildChain` | Returns `null` (single-click chain) | Full chain delegated to TreVfsBrowser.handleSelectEntry | Already wired on click |

These stubs do NOT prevent the plan goal (D-06 TRE VFS browser): the tree renders, search works, shadow chains show on selection, v6000 extraction refusal is enforced in the native layer. Version chip display and enumerate-only warn chip will be corrected when the native version accessor is added.

## Threat Surface Scan

No new network endpoints, auth paths, or IPC channels introduced.

- `TreVfsBrowser` opens OS file picker via Electron dialog (user-initiated, sync, no background network)
- `readMountEntry` extraction REFUSED for v6000 archives (security invariant preserved from Task 1)
- Path B `require('@swg/native-core')` is the existing in-process access pattern (established in Plan 00-03)
- No new trust boundaries introduced

## Self-Check: PASSED

Files verified present:
- `packages/renderer/src/state/treStore.ts` — FOUND
- `packages/renderer/src/panels/tre/TreVfsBrowser.tsx` — FOUND
- `packages/renderer/src/panels/tre/MountedArchivesList.tsx` — FOUND
- `packages/renderer/src/panels/tre/VfsTree.tsx` — FOUND
- `packages/renderer/src/panels/tre/VfsSearchField.tsx` — FOUND
- `packages/renderer/src/panels/tre/ShadowChainDetail.tsx` — FOUND
- `packages/renderer/src/shared/AsyncProgress.tsx` — FOUND
- `.planning/phases/01-core-engine-iff-tre-verification-harness/01-02-SUMMARY.md` — FOUND (this file)

Commits verified present:
- `61de191` (Task 1) — FOUND
- `b4e1e2d` (Task 2) — FOUND

TypeScript: `npx tsc --noEmit --skipLibCheck` in `packages/renderer` — ZERO ERRORS
