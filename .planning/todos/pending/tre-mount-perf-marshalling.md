---
id: tre-mount-perf-marshalling
title: TRE mount is slow — ~250k entries marshalled synchronously to JS on the main thread
created: 2026-06-24
origin: Phase 02 checkpoint testing (02-02 human-verify); root cause is Phase-1 TRE code
severity: high
area: native-core / TRE read path
status: done
---

## Symptom

Mounting a full client TRE set takes **over a minute** with the UI frozen; even a single
large `.tre` feels slow. Surfaced during Phase-02 02-02 viewport verification. Measured set:
**~245,698 entries across 27 archives** (full retail/patch sets run higher).

## Root cause (read-only trace, 2026-06-24)

The *parse* is fine and already off-thread (`mountSearchableAsync`). The cost is post-parse
VFS materialization + bridge marshalling, on the **main thread**:

1. **(biggest win)** `listMountEntries` (`packages/native-core/src/tre_binding.cpp:~439-453`)
   builds ~250k `Napi::Object`s (6 `Set()` + 2 string allocs each ≈ 1.5M `Set` calls) on the
   main/renderer thread — it's a plain synchronous binding, not an `AsyncWorker`. Then
   `TreVfsBrowser.tsx:~137-150` re-`.map()`s all 250k into fresh JS objects with a
   `.split('/')` each. **This bridge crossing is the minute.** Violates the architecture rule
   ("never marshal huge JS structures at mount").
   FIX: return `entryCount` only + lazy-page via `getMountEntriesPage(handle, offset, limit)`
   (or hand back ONE zero-copy columnar ArrayBuffer — string blob + `Uint32Array` offsets —
   built inside the worker). Virtualize the VFS tree.

2. `TreMount::vfsEntries()` (`packages/native-core/.../TreMount.cpp:~360-421`) rebuilds a
   250k-key `unordered_map<std::string,...>`, double-copies every name
   (`TreArchive.cpp:~382-384 nameAt` copies into a thread_local string, caller copies again),
   and `std::sort`s by string compare. ~2 heap allocs/entry × 250k in the worker.
   FIX: `nameAt` returns `string_view`/`const char*` into the name block (no copy); key dedup
   on `string_view` or CRC; `reserve()`; sort indices not value-copies.

3. `TreMount::search` (`TreMount.cpp:~269-326`) — same per-entry string-copy anti-pattern
   (renderer currently filters `vfsEntries` in JS, so only bites if native search is used).
   Clean up alongside #2.

4. `FileInputStream` reopens the archive by path on every entry read
   (`tre_binding.cpp:~492`) — minor at mount, real for repeated reads of an 855 MB `.tre`.
   FIX: keep a persistent (ideally mmap'd) handle on the `TreMountNode`.

NOT the problem: `TreArchive::parse` reads only header + TOC + name block (one inflate each),
does NOT recompute per-entry CRC-32 — matches the client's single-shot reads. The minute is
marshalling volume, not byte reading.

## Resolution (2026-06-24)

**Status: DONE** — both #1 and #2 were fixed in one atomic pass. #3 and #4 deferred as planned.

### What was fixed

**#1 (THE BIG WIN) — Columnar ArrayBuffer bridge (eliminating ~1.5M Napi::Set calls):**
- Added `TreMountColumnar` struct + `vfsEntriesColumnar()` to `TreMount.h`/`.cpp`.
- `MountSearchableAsyncWorker::Execute()` now calls `vfsEntriesColumnar()` OFF the main thread,
  caching the result on the `TreMount` object via `setCachedColumnar()`.
- New `getMountEntriesColumnar(handle: string) → ArrayBuffer` synchronous binding in
  `tre_binding.cpp` + registered in `addon.cpp`. Returns the pre-built blob as ONE
  `Napi::ArrayBuffer::New + memcpy` instead of ~1.5M `Napi::Set()` calls.
- Renderer: `TreVfsBrowser.tsx` now calls `getMountEntriesColumnar` + `decodeMountEntriesColumnar()`
  (a pure-JS typed-array decoder) instead of `listMountEntries(...).map(...)`. Search and
  viewport open-handler are fully intact (both filter/use the decoded `VfsEntry[]` array).
- `listMountEntries` binding is kept registered (backward-compat, no tests use it directly).

**#2 (C++ hot-path copies) — `namePtr()` + `string_view` dedup:**
- Added `TreArchive::namePtr(int)` returning `const char*` into the name block (zero-copy).
- Added `TreArchive::nameBlock()` for bulk blob access.
- `vfsEntries()` and `vfsEntriesColumnar()` now use `string_view` keyed `unordered_map`
  (custom FNV-1a hash, `reserve()`'d) and `namePtr()` — no heap allocation per entry.
- `search()` uses `namePtr()` instead of `nameAt()` (eliminates `thread_local` copy).

### What was NOT done (#3/#4 — deferred as planned)

- **#3**: `TreMount::search()` copy pattern cleaned up to use `namePtr()` (done incidentally,
  as the change was in the same code path). The renderer still does JS-side filtering.
- **#4**: Persistent mmap file handle on `TreMountNode` — not needed for this fix, still
  deferred. Each `readMountEntry` still reopens by path.

### Tests added
- 6 new tests in `tre-async-zerocopy.test.ts` under `getMountEntriesColumnar`:
  - Returns `ArrayBuffer` (not array of objects) — perf contract test
  - Decodes to correct entry count and paths
  - Override + shadowCount flags correct for two-archive mount
  - Tombstone flag set for length==0 entries
  - Available on async-mounted handles (pre-built off-thread)
  - Perf gate: 100k entries in <500ms synchronous path (async path is near-instant)
- Total: 135 tests passing (was 129).
