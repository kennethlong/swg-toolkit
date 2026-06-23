# Phase 1: Core Engine — IFF + TRE + Verification Harness - Pattern Map

**Mapped:** 2026-06-22
**Files analyzed:** 22 new/modified files (from RESEARCH.md § Recommended Project Structure + VALIDATION.md Wave 0)
**Analogs found:** 18 in-repo (Phase 0) + 4 ground-truth-port analogs / 22

> **Two analog tiers this phase.** Most files are a **port** (RESEARCH.md: "this phase is a port, not an invention"), so each native parser file has TWO analogs:
> 1. **In-repo Phase-0 analog** — the *shape/wiring/style* to copy (binding boilerplate, contracts typing, vitest, CMake, panel chrome).
> 2. **Ground-truth loader analog** (sibling repos, read-only) — the *byte-layout logic* to port line-by-line, per the standing gate (every parser/serializer cites its `swg-client-v2` loader source). Cited with `file:line` from RESEARCH.md (already source-verified).
>
> The planner must reference BOTH for native files: copy the Phase-0 wiring pattern, port the loader logic.

---

## File Classification

| New/Modified File | Role | Data Flow | In-repo Analog (shape) | Ground-truth Analog (logic) | Match Quality |
|-------------------|------|-----------|------------------------|-----------------------------|---------------|
| `packages/native-core/modules/core/io/IInputStream.h` | interface/utility | file-I/O | — (new abstraction) | `TreeFile_SearchNode.cpp:227-330` (`FileStreamer::File::read` usage) | role-new |
| `packages/native-core/modules/core/tre/TreArchive.{h,cpp}` | service (parser) | file-I/O / transform | `src/sab-rw.cpp` (C++ struct+bounds style) | `TreeFile_SearchNode.cpp:226-349, 360-408` + Utinni `TreFile.cs:155-310` | logic-port |
| `packages/native-core/modules/core/tre/TreMount.{h,cpp}` | service (resolver) | transform | — | `TreeFile.cpp:285-461, 511-601` | logic-port |
| `packages/native-core/modules/core/tre/TreBuilder.{h,cpp}` | service (serializer) | file-I/O / transform | — | `TreeFileBuilder.cpp:558-672, 773-833` + Utinni `TreWriter.cs:36-174` | logic-port |
| `packages/native-core/modules/core/tre/TreVersion.h` | config/model | — | `contracts/src/opcodes.ts` (enum-table style) | Utinni `TreVersion.cs:60-105` + `tre_reader.py:33-43,143-150` | logic-port |
| `packages/native-core/modules/core/iff/Iff.{h,cpp}` | service (parser+serializer) | transform | `src/sab-rw.cpp` (C++ style) | `Iff.cpp:56-134, 419-429, 508-555, 1132-1310` + Utinni `IffReader.cs`/`IffWriter.cs` | logic-port |
| `packages/native-core/modules/core/compress/Zlib.{h,cpp}` | utility | transform | — | `TreeFile_SearchNode.cpp:534` (`ZlibCompressor().expand`) + Utinni `TreFile.cs:649-679` | logic-port |
| `packages/native-core/modules/core/CMakeLists.txt` | config | — | `packages/native-core/CMakeLists.txt` | — | role-match |
| `packages/native-core/src/tre_binding.cpp` | binding (controller) | request-response | `src/sab-rw.cpp` + `src/addon.cpp` | — | exact |
| `packages/native-core/src/iff_binding.cpp` | binding (controller) | request-response | `src/sab-rw.cpp` + `src/addon.cpp` | — | exact |
| `packages/native-core/src/addon.cpp` (MODIFY) | binding registry | — | `src/addon.cpp` (itself) | — | exact |
| `packages/native-core/CMakeLists.txt` (MODIFY) | config | — | `CMakeLists.txt` (itself, line 49-51 stub) | — | exact |
| `packages/native-core/index.d.ts` (MODIFY) | types | — | `index.d.ts` (itself) | — | exact |
| `packages/contracts/src/tre.ts` | types/model | — | `contracts/src/ipc.ts` + `sab-layout.ts` | (field set) Utinni `TreRecord.cs`/`TreHeader.cs` | role-match |
| `packages/contracts/src/iff.ts` | types/model | — | `contracts/src/ipc.ts` + `sab-layout.ts` | (field set) `Iff.cpp:1132-1310` node fields | role-match |
| `packages/contracts/src/index.ts` (MODIFY) | barrel | — | `contracts/src/index.ts` (itself) | — | exact |
| `packages/contracts/src/opcodes.ts` (MODIFY) | enum | — | `contracts/src/opcodes.ts` (itself, line 11 stub) | — | exact |
| `packages/harness/assertRoundTrip.ts` | test utility | transform | `native-core/test/hello.test.ts` (vitest+require style) | — | role-new |
| `packages/harness/fixtureRegistry.ts` | test registry | event-driven | `contracts/src/ipc.ts` (typed-union style) | — | role-new |
| `packages/harness/*.test.ts` (roundtrip + sweep) | test | — | `native-core/test/hello.test.ts` | — | exact |
| `packages/harness/fixtures/*` | test data | — | — (regenerate from Utinni `Fixtures/{iff,tre}`) | Utinni `Utinni.Cli.Tests/Fixtures/{iff,tre}` | data-seed |
| `scripts/copy-real-fixtures.js` | utility script | file-I/O | `scripts/check-prereqs.js` (node CLI style) | `tools/tre-compare/verify-*.cfg` (source paths) | role-match |
| `packages/renderer/src/panels/SidebarPanel.tsx` (MODIFY → TRE browser) | component | request-response | `panels/SidebarPanel.tsx` (itself) | — | exact |
| `packages/renderer/src/panels/DataPanel.tsx` (→ IFF tree) + `InspectorPanel.tsx` (→ hex) | component | request-response | `panels/InspectorPanel.tsx` + `StatusBar.tsx` (addon-require pattern) | — | role-match |

---

## Pattern Assignments

### `src/tre_binding.cpp` / `src/iff_binding.cpp` (binding, request-response)

**In-repo analog:** `packages/native-core/src/sab-rw.cpp` — THE binding-style template. Copy the
argument-count guard → type guard → bounds check → extract → call-lib → return shape verbatim.

**Argument validation + error pattern** (`sab-rw.cpp:29-67`):
```cpp
Napi::Value WriteSab(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 3) {
        Napi::TypeError::New(env, "writeSab: (...) required").ThrowAsJavaScriptException();
        return env.Undefined();
    }
    if (!info[0].IsSharedArrayBuffer()) { /* TypeError */ return env.Undefined(); }
    // ... extract args ...
    if ((uint64_t)int32Index * 4 + 4 > sab.ByteLength()) {       // bounds (division/sub form)
        Napi::RangeError::New(env, "... out of bounds").ThrowAsJavaScriptException();
        return env.Undefined();
    }
```
> **Use the SAME validate-then-act shape** for `mountArchive(paths[])`, `readEntry(idx)`,
> `parseIff(bytes)`, `serializeIff(tree)`, `repackTre(...)`. The binding stays THIN — it only
> validates, marshals to/from the engine-free lib in `modules/core/`, and returns. No parse logic
> in the binding (D-02).

**Zero-copy return contract** (RESEARCH § Async Worker Model): file payloads / IFF chunk slices
return as `Napi::ArrayBuffer`/`SharedArrayBuffer`, never JSON. Only *structure* (TOC entries, IFF
node metadata) crosses as contracts-typed JS objects. Allocation style is in `sab.cpp:35`
(`Napi::SharedArrayBuffer::New(env, byteLength)`).

**AsyncWorker (NEW — no Phase-0 analog):** heavy ops (`mountArchive`, large `parseIff`, `repackTre`)
wrap a `Napi::AsyncWorker` returning a Promise (RESEARCH "RESOLVED: Napi::AsyncWorker"). Lifetime
caution (Pitfall 6): hold a `Napi::Reference` to any input ArrayBuffer for the worker's duration, or
copy into a C++-owned buffer before going off-thread.

---

### `src/addon.cpp` (MODIFY — binding registry)

**Analog:** itself (`addon.cpp:16-31`). Copy the forward-declare-then-`exports.Set` pattern exactly.
```cpp
// Forward declarations (implemented in *_binding.cpp)
Napi::Value MountArchive(const Napi::CallbackInfo&);
Napi::Value ParseIff(const Napi::CallbackInfo&);
// ...
Napi::Object Init(Napi::Env env, Napi::Object exports) {
    exports.Set("hello",        Napi::Function::New(env, Hello));      // keep Phase-0 exports
    exports.Set("allocateSab",  Napi::Function::New(env, AllocateSab));
    exports.Set("mountArchive", Napi::Function::New(env, MountArchive)); // NEW
    exports.Set("parseIff",     Napi::Function::New(env, ParseIff));     // NEW
    return exports;
}
```
> Every new export MUST get a matching declaration in `index.d.ts` (the file's own header comment
> states "Exports exactly match the TypeScript surface in index.d.ts").

---

### `modules/core/CMakeLists.txt` + root `CMakeLists.txt` (MODIFY — config)

**Analog:** `packages/native-core/CMakeLists.txt` — the root file has an explicit seed at lines 49-51:
```cmake
# Phase 1 seed:
# add_subdirectory(modules/core) when TRE/IFF C++ lands
```
**Reuse the established compile defs + include-dir dual-path discipline** (`CMakeLists.txt:29-47`):
`NAPI_DISABLE_CPP_EXCEPTIONS`, `NAPI_VERSION=8`, `NAPI_EXPERIMENTAL`; search BOTH
`${CMAKE_SOURCE_DIR}/node_modules/node-addon-api` and the hoisted `../../node_modules/...`.
**New for the core lib:** the whole `native-core` package is unified on **C++20** (D-02, decided
2026-06-22) — bump the addon target `set(CMAKE_CXX_STANDARD 17)` → `20` (`CMakeLists.txt:5`) AND set
`CMAKE_CXX_STANDARD 20` on the new `modules/core` target, so addon + `sab`/`sab-rw` + `modules/core`
all compile under one standard (no 17/20 split). Add zlib via `find_package(ZLIB)` / vendor (VALIDATION
Wave 0 task); the lib links **no napi** (engine-free), the binding links the lib.

---

### `packages/contracts/src/tre.ts` + `iff.ts` (types/model)

**Analog:** `packages/contracts/src/ipc.ts` — the typed-discriminated-union + doc-comment style;
and `sab-layout.ts` for the `as const` byte-offset-record style.

**Pattern — discriminated union + per-field provenance comment** (`ipc.ts:13-54`):
```ts
export type HelloRequest  = { type: 'hello'; id: number };
export type HelloResponse = { type: 'pong'; id: number; value: string };
export type IpcMessage = HelloRequest | HelloResponse | /* ... */;
```
**Apply to `tre.ts`:** `TreEntry` (path, crc, uncompressedSize, compressedSize, offset, compressor,
archiveIndex), `TreMountConfig` (ordered archive paths + priorities), `TreSearchQuery`/`TreSearchHit`
(matched indices — RESEARCH: native returns indices, not the 100k-entry list). Field set mirrors the
verified 6-field TOC record (RESEARCH § TRE TOC entry, CRC-first).
**Apply to `iff.ts`:** `IffNode { tag: string; length: number; byteOffset: number; kind: 'form'|'leaf';
subType?: string; children?: IffNode[] }` (RESEARCH § IFF parse model — tag/declared-length/abs
header offset/kind/subType/children; plus a "trailing bytes" node per RESEARCH).

**Barrel + enum updates:** add `export * from './tre.js'` / `'./iff.js'` to `index.ts` (matches
`index.ts:5-7` `.js`-suffixed ESM re-exports); extend `NativeOpcode` at the `opcodes.ts:11` stub
(`// Phase 1 will add TRE/IFF opcodes here`).

---

### `packages/harness/assertRoundTrip.ts` + `fixtureRegistry.ts` + tests (CORE-05)

**Analog:** `packages/native-core/test/hello.test.ts` — the vitest + CJS-`require`-through-the-resolver
idiom and the per-test descriptive naming.

**Addon-load idiom** (`hello.test.ts:19-21`) — the harness links the lib headless via the SAME prebuild:
```ts
// CommonJS require — .node addon is CJS; load through the resolver
// eslint-disable-next-line @typescript-eslint/no-require-imports
const nativeCore = require('../index.js');
```
**`assertRoundTrip(parse, serialize, fixtureBytes)`** — parse → reserialize → assert
`serialized === fixtureBytes` byte-for-byte; on mismatch dump first-differing-offset + hex window
(SIE-style). **`fixtureRegistry`** = manifest `formatId → { parse, serialize, fixtures[], loaderSource }`
where each fixture records the `swg-client-v2 file:line` it was validated against (standing-gate
per-fixture). **Sweep test** FAILS CI if any registered format has zero fixtures OR any fixture lacks a
`loaderSource` citation (RESEARCH § Verification Harness). Phase-1 registry has two entries: `tre`, `iff`.

**vitest project wiring** (VALIDATION): add a `native-core`/`harness` project; quick command
`pnpm vitest run --project native-core`. Root config to extend: `vitest.config.ts` (note `pool: 'forks'`
at line 22 — keep; isolates native addon per file; the `@swg/*` aliases at lines 24-29 already resolve
contracts + native-core for the harness).

**Real-asset lane** opt-in when `fixtures-real/` is populated (gitignored, D-10); CI on a clean clone
skips it.

---

### `scripts/copy-real-fixtures.js` (utility script, file-I/O)

**Analog:** `scripts/check-prereqs.js` — the `'use strict'` node-CLI pattern: `require('node:fs/path/os')`,
`[OK]/[WARN]/[FAIL]` console reporting, explicit `process.exit` codes, win32-path handling.
> Source archives come from the `tre-compare verify-*.cfg` paths and the corrected client→version map
> (RESEARCH § Measured client map): Infinity `D:\SWG Infinity\SWG Infinity\Live\`, SWGEmu
> `D:\SWGEmu-Client\` (NOT the CONTEXT `D:\SWGEmu Client\SWGEmu` path — verified wrong), Stardust
> `D:\Stardust TREs\`, Restoration `D:\SWG Restoration\` (v0006). **Copy to a gitignored scratch dir;
> never mutate the reference installs** (D-10).

---

### `packages/renderer/src/panels/SidebarPanel.tsx` (→ TRE browser) + `DataPanel.tsx` (→ IFF tree) + `InspectorPanel.tsx` (→ hex)

**Analog:** `panels/SidebarPanel.tsx` / `InspectorPanel.tsx` — the dockview panel chrome
(panel-head + collapse toggle + body), all styling via CSS custom props (`var(--color-*)`,
`var(--space-*)`), `IDockviewPanelProps` typing, and **Accessibility Rule 5** (aria-label + title on
every icon-only control, `SidebarPanel.tsx:66-94`). Replace the seed body ("No archive mounted",
`SidebarPanel.tsx:115-118`) with the live VFS tree / FORM tree / hex pane.

**Addon access from the renderer** — copy `StatusBar.tsx:34-41` (Path B: `require` the addon directly,
nodeIntegration:true; no contextBridge — see `preload.ts:25` rationale):
```ts
// eslint-disable-next-line @typescript-eslint/no-require-imports
const nativeCore = require('@swg/native-core') as { /* mountArchive, parseIff, readEntry, ... */ };
```
> D-06/D-07 surface only (read-focused): TRE VFS browser with shadow/override chain shown; generic
> FORM/chunk tree; hex/ASCII inspector (offset │ hex │ ascii) for the selected leaf. **No in-UI IFF
> editing** (D-08) — the write path is proven by the harness, not the UI.

---

## Shared Patterns

### Native binding validation + zero-copy (apply to both `*_binding.cpp`)
**Source:** `packages/native-core/src/sab-rw.cpp:29-67` (validate→bounds→extract→return) +
`src/sab.cpp:35` (`Napi::SharedArrayBuffer::New`).
**Apply to:** every native export. Binary payloads return as `ArrayBuffer`/SAB; only structure as JSON.
Heavy ops wrap `Napi::AsyncWorker`; hold a `Napi::Reference` across the async boundary (Pitfall 6).

### Engine-free injectable IO (the D-02 abstraction every TRE/IFF file uses)
**Source-derived from:** `TreeFile_SearchNode.cpp:227-330` (`FileStreamer::File::read(offset,buf,len)`).
**Apply to:** all of `modules/core/` — replace `FileStreamer`/`Os`/`ConfigFile`/`Mutex` with
`IInputStream { int read(int offset, void* dst, int len); int length() const; }`. `MemoryInputStream`
(harness + zero-copy ArrayBuffer path) and `FileInputStream` (mount). No globals, RAII, C++20 (D-02).

### Standing-gate citation discipline (apply to every parser/serializer + fixture)
**Source:** REQUIREMENTS.md standing gate + `fixtureRegistry.loaderSource`.
**Apply to:** every `modules/core/*.cpp` carries a header comment citing its `swg-client-v2`
`file:line` (e.g. `Iff.cpp:419-429` for serialize); every harness fixture records the loader source it
was validated against; the sweep test enforces it.

### Security caps on untrusted binary input (apply to all parsers)
**Source:** Utinni caps (RESEARCH § Security): `TreFile.cs:223-265`, `IffReader.cs:174-195`.
**Apply to:** TRE (per-record/block ≤ 256 MB; division-form count check `recordCount > Max/stride`;
subtraction-form offset bound `offset > streamLen - len`; zlib output cap = `min(declared, Max)`),
IFF (per-chunk ≤ 64 MB; reject `childEnd > parentEnd`; reject non-`0x20–0x7E` FourCC). Under Path B a
parser crash takes down the UI — reject hostile input cleanly. The Utinni `malformed-*` fixtures
exercise these.

### Contracts typing discipline (apply to `tre.ts`, `iff.ts`)
**Source:** `packages/contracts/src/ipc.ts` (discriminated unions + provenance doc-comments),
`index.ts:5-7` (`.js`-suffixed barrel re-exports), `opcodes.ts:9-13` (const-enum).
**Apply to:** all native↔backend↔renderer message/result types cross typed end-to-end; binary stays
binary (only structure is typed, never the payload bytes).

---

## Ground-Truth Port Map (logic analogs — the "what to port" table)

> These are NOT in-repo; they are the read-only sibling sources to port line-by-line. Each native file
> above cites these. Reproduced here so the planner can drop them straight into plan action steps.

| New native file | Port FROM (primary, swg-client-v2) | Cross-check (Utinni C# / tre-compare py) |
|-----------------|-----------------------------------|------------------------------------------|
| `tre/TreArchive.cpp` (header+TOC+name parse, binary-search resolve, inflate) | `TreeFile_SearchNode.cpp:226-349` (parse), `:360-408` (resolve + tombstone), `:534` (zlib) | `TreFile.cs:155-310` (version dispatch, framing); `tre_reader.py:33-43,143-150` (36-byte header `"<4s4s7I"`, CRC-first stride 24/32) |
| `tre/TreMount.cpp` (priority list + shadow resolve + name fixup) | `TreeFile.cpp:285-308` (priority sort), `:437-461` (first-match), `:511-601` (`fixUpFileName`) | override order from `verify-*.cfg`; tombstone `length==0` |
| `tre/TreBuilder.cpp` (write order, MD5 block, double header, compressor) | `TreeFileBuilder.cpp:558-597` (`writeFile`), `:601-654` (TOC+names), `:658-672` (MD5), `:773-833` (block order + header re-write) | `TreWriter.cs:36-85,166-174` (per-record raw-slice identity; recompress only edits) |
| `tre/TreVersion.h` (version → stride/crc-first/enumerate-only) | `TreeFile_SearchNode.cpp:278-280` (accepts 0004/0005 only) | `TreVersion.cs:60-105` + `tre_reader.py` (extends 0006/5000/6000; v6000 enumerate-only, encrypted) |
| `compress/Zlib.cpp` (inflate branch on compressor code) | `TreeFile_SearchNode.cpp:13,534` (`CT_zlib`) | `TreFile.cs:595-679` (code 1 = raw deflate; code 2 = RFC1950 framed; **handle code 1, don't fatal**) |
| `iff/Iff.cpp` (BE FORM/chunk walk + byte-exact serialize) | `Iff.cpp:56-134` (stack+validate), `:419-429` (verbatim write), `:508-555` (BE read via `ntohl`), `:637-644,697,713` (`htonl` write, FORM len +sizeof(Tag)), `:1076-1095` (FORM discriminator), `:1132-1310` (walk) | `IffReader.cs:307-327` (no-pad DETECT), `IffWriter.cs:98-187` (hybrid-DOM verbatim re-emit, emit NO pad) |

**Locked byte-layout facts (RESEARCH § Ground-Truth Reconciliation — do not re-derive):**
- TRE magic on disk = `EERT`; version reads forward as ASCII `"0005"`/`"0006"`/etc.
- TRE header = 36 bytes `"<4s4s7I"`; TOC = **CRC-first** all versions (3 oracles agree), stride 24 (0004/0005/5000) or 32 (0006/6000).
- v6000 (Restoration) payloads are **encrypted → enumerate-only**; byte-exact payload round-trip only on v0005.
- IFF = **big-endian** tags+lengths (`ntohl`/`htonl`); payload scalars native-LE; **no pad ever**; FORM-only container; FORM length **includes** the 4-byte subtype tag.
- TRE writer emits an MD5 trailer the reader ignores; byte-identical repack must reproduce it + response-file payload order + zlib level 6.

---

## No Analog Found (in-repo)

These files have no Phase-0 in-repo shape analog (use the cited ground-truth source + RESEARCH patterns):

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `modules/core/io/IInputStream.h` | interface | file-I/O | First IO abstraction in the repo; derive from `TreeFile_SearchNode.cpp:227-330` |
| `modules/core/tre/TreMount.{h,cpp}` | resolver | transform | No prior priority/override resolver; port `TreeFile.cpp:285-461` |
| `packages/harness/*` (assertRoundTrip, fixtureRegistry) | test harness | transform/event-driven | No prior reusable round-trip harness; vitest *style* from `hello.test.ts`, mechanism is new (Claude's-discretion design in RESEARCH) |

---

## Metadata

**Analog search scope:** `packages/native-core/{src,test,CMakeLists.txt}`, `packages/contracts/src/`,
`packages/renderer/src/{panels,shell}/`, `packages/backend/src/`, `scripts/`, root `vitest.config.ts`;
ground-truth siblings `../swg-client-v2/src/engine/shared/library/sharedFile/` (+ `application/TreeFileBuilder`),
`../swg-client-v2/tools/tre-compare/`, `../Utinni/UtinniCoreDotNet/Formats/{Iff,Tre}`.
**Files scanned (in-repo, read):** addon.cpp, sab.cpp, sab-rw.cpp, CMakeLists.txt, index.{d.ts,js},
package.json, test/hello.test.ts, contracts/{ipc,sab-layout,opcodes,index}.ts, contracts/package.json,
renderer panels (Sidebar/Inspector/StatusBar), backend/preload.ts, scripts/check-prereqs.js,
vitest.config.ts. Ground-truth `Iff.cpp` endianness lines spot-verified (`ntohl`/`htonl` at 522/539/637/643/713).
**Pattern extraction date:** 2026-06-22
