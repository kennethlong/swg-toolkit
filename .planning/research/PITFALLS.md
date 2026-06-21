# Pitfalls Research

**Domain:** All-in-one SWG modding suite — Electron + React/TS + Three.js/R3F + C++ Node-API + Win32 process-memory injection + Blender bridge + Core3 parity
**Researched:** 2026-06-21
**Confidence:** HIGH on the cross-cutting platform pitfalls (N-API lifetime, Three.js GC, Electron security, SharedArrayBuffer isolation, Git/LFS, Core3 drift — all verified against official docs and grounded in this project's own `docs/`); HIGH on the headline format-verification risk (project's own `source-provenance.md` states it explicitly); MEDIUM on the exact magnitude of Win32 anti-cheat/AV friction (community-reported, varies per server/AV vendor).

> **The one-line summary for the roadmap:** Every binary layout in `docs/` is an AI-proposed *hypothesis*, not a spec. The single highest-leverage discipline for this project is to **validate each format against `swg-client-v2` source + real asset bytes before writing the parser**, and to make that validation a gate in every format phase — not a one-time task.

---

## Critical Pitfalls

### Pitfall 1: Building parsers from AI-proposed binary layouts as if they were specs

**What goes wrong:**
The `docs/` set was distilled from an ~88k-word Gemini session. Per the project's own `docs/00-overview/source-provenance.md`, the **SWG binary format and struct layouts are rated "LOW — VERIFY"**: chunk tags (`BPOLY`, `ADAT`, `OTPL`, `NODD`, `SPWS`, `CDFS`, `TREE0005`), field orders, byte offsets, and sizes are "plausible reconstructions, frequently invented or approximated." If a developer reads `docs/01-core-engine/iff-and-tre.md` or `docs/02-formats/*` and implements the parser exactly as written, the parser will appear to work on tiny/synthetic inputs and then fail — silently or catastrophically — on real client assets. Concrete already-visible examples in the docs: the `TREE0005` 20-byte `TreIndexEntry` layout, the claim that SWG IFF size fields are little-endian (classic IFF is big-endian — this is the kind of detail that is *exactly* 50/50 and must be checked against bytes), the `BPOLY` child-chunk order, and the `-4` FORM-size arithmetic (`endOffset = offset + formSize - 4`) which only holds if the sub-type tag is counted in `formSize` the way the doc assumes.

**Why it happens:**
The docs are well-structured, code-bearing, and *read* authoritatively. The provenance caveat lives in one overview file; the format files each repeat a short caveat banner that is easy to skim past when you are heads-down implementing. AI-generated binary code compiles and runs, so "it parsed without throwing" is mistaken for "it parsed correctly."

**How to avoid:**
Treat the proposed code's *structure* (parser/serializer/registry/React-inspector pattern) as good and the *field-level details* as untrusted. For each format, before writing the parser:
1. Find the format's loader in `../swg-client-v2` (the single most authoritative reference) and read the actual struct/read order.
2. Cross-check against community parsers already on the maintainer's machine: `../io_scene_swg_msh`, `../swg-blender-plugin`, SIE behavior, and `../Core3`/`../swg-main` for server-side tables.
3. **Round-trip test against real bytes**: parse a real asset extracted from an installed client (Infinity/SWGEmu), re-serialize, and assert byte-for-byte equality (or document every intentional difference). A parser that cannot reproduce the original file does not understand the format.
4. When a layout is confirmed/corrected, update the doc and drop the "AI-proposed" caveat for that section (the provenance doc already prescribes this).

Make this a **standing gate**: no format parser merges without (a) a cited `swg-client-v2` source reference and (b) a passing round-trip test on a real asset. Build a tiny "format fixtures" harness early (Phase 1) so every later format phase inherits the discipline for free.

**Warning signs:**
- A parser passes on hand-written/synthetic buffers but throws, reads garbage, or produces NaN floats / absurd vertex counts on a real extracted asset.
- `chunkSize`/`formSize` arithmetic that "almost" lines up — off-by-4 or off-by-12 leftover bytes at the end of a FORM walk (the `offset = nextChunk` skip in the docs *hides* these errors by silently resyncing, so unknown trailing bytes never surface).
- Endianness "works" only because test data is symmetric; real multi-byte counts come out byte-swapped (e.g. a vertex count of `0x01000000` = 16,777,216).
- No `swg-client-v2` file path cited in the PR that adds a parser.

**Phase to address:**
Phase 1 (core engine: IFF + TRE + first mesh) must establish the verification harness and round-trip discipline. *Every* subsequent format phase (terrain, flora, skeletons, datatables, world snapshots, collision, audio, particles, object templates) re-applies it. This is the project's recurring tax — budget for it in each format phase's estimate, not just once.

---

### Pitfall 2: N-API native work blocking the main thread on multi-GB files

**What goes wrong:**
TRE archives are multi-GB; meshes, terrain, and textures are large. If TRE decompression, IFF chunk-walking, zlib, or SHA-256 hashing runs synchronously inside an N-API method called on the JS main thread, the entire Electron renderer (or the Node main process) freezes for seconds-to-minutes — the UI hangs, the 3D canvas stops, and the app looks crashed. The docs' own architecture rule ("heavy work → async C++ worker threads, never the main thread") exists precisely to prevent this, but several code samples in `docs/` (e.g. `BuildTrePatchArchive`, `compileDirectoryToTreStream`, the per-item `compileJsToDatatableStream`) are written as **synchronous** `Napi::Value` functions that do real work inline.

**Why it happens:**
Synchronous N-API methods are far easier to write and demo than `Napi::AsyncWorker` / `Napi::ThreadSafeFunction` plumbing. The sync versions work fine on small test files, so the threading is deferred — then never revisited until a real 2 GB archive locks the app.

**How to avoid:**
Anything that touches a whole file or archive must run on a worker thread from day one. Use `Napi::AsyncWorker` (as the docs correctly do for `SwgHashWorker`) or a thread pool, returning a Promise to JS. Reserve synchronous N-API calls for trivial, bounded operations (read a small header, look up a manifest entry). For the live-injection hot path, the *write* itself (`WriteProcessMemory` of 64 bytes) is fine synchronously, but anything that scans or reads large regions is not.

**Warning signs:**
- Spinner never appears because the thread that would render it is the thread doing the work; UI is frozen, not "loading."
- DevTools shows a single long task on the main thread; `requestAnimationFrame` callbacks stall.
- Profiling shows zlib/`compress()`/file I/O on the main V8 thread.
- The function signature is `Napi::Value Foo(const Napi::CallbackInfo&)` doing file I/O and returning a finished buffer, rather than returning a Promise.

**Phase to address:**
Phase 1 (core engine) — bake the AsyncWorker pattern into the TRE mount/decompress and IFF parse paths before any format work piles on top. Retrofitting threading after editors depend on sync APIs is expensive.

---

### Pitfall 3: ArrayBuffer / SharedArrayBuffer pointer lifetime — use-after-free across the N-API boundary

**What goes wrong:**
The live-sync design caches a raw native pointer to JS-owned memory: `InitializeSharedChannel` does `g_sharedMatrixBuffer = static_cast<float*>(arrayBuffer.Data())` and stores it in a global, then `SignalMemoryPatch` reads `g_sharedMatrixBuffer` on later calls. Per node-addon-api's own docs, **the `Data()` pointer becomes invalid as soon as the ArrayBuffer is garbage-collected** unless a *strong reference* is held: "The embedder should make sure to hold a strong reference to the ArrayBuffer while accessing this pointer." If the JS side ever drops its reference to the `SharedArrayBuffer` (or the buffer is detached/transferred to a worker), the cached global pointer dangles — and the next `WriteProcessMemory` reads freed memory and streams garbage into the live game client's address space, which can corrupt or crash `SWGClient.exe`. The same hazard applies to any cached pointer from a transferable/detachable `ArrayBuffer`.

**Why it happens:**
Caching the pointer once and reusing it is the obvious way to hit "zero-copy, sub-millisecond" goals, and it works for the whole demo session because GC happens not to collect the buffer. It is a latent, timing-dependent bug.

**How to avoid:**
- Hold a `Napi::Reference`/persistent strong reference to the backing `(Shared)ArrayBuffer` for as long as C++ caches its data pointer; release it in a finalizer.
- Prefer passing the typed array *into* the call each time (the `InjectTransformMatrix` path that takes `info[1].As<Napi::Float32Array>()`) over caching a global pointer, unless the SharedArrayBuffer is explicitly kept alive and never detached.
- Never transfer the SharedArrayBuffer to a Worker while C++ holds its pointer.
- Validate `bytesWritten == 64` and the process handle on every patch; treat a failed write as "detach and stop," not "retry blindly."

**Warning signs:**
- Live injection works for a while, then starts writing garbage / crashing the client after some idle time or after a GC-heavy operation (loading a big asset).
- Intermittent, unreproducible client crashes that correlate with memory pressure in the editor.
- Any `static`/global `T* = buffer.Data()` with no corresponding strong reference or finalizer.

**Phase to address:**
The live-sync / memory-injection phase. Make the lifetime contract (who owns the buffer, who keeps it alive, when the pointer is released) an explicit design item, not an implementation detail.

---

### Pitfall 4: SharedArrayBuffer silently unavailable in the Electron renderer (no cross-origin isolation)

**What goes wrong:**
The entire high-frequency "data channel" (60 fps transform → live memory) depends on `SharedArrayBuffer`. Since the Spectre mitigations, `SharedArrayBuffer` is **only available in cross-origin-isolated, secure contexts**; in a renderer that is not cross-origin isolated, `SharedArrayBuffer` is either undefined or throws on construction, and `self.crossOriginIsolated` is `false`. A team can build the whole IPC layer against `SharedArrayBuffer` and discover at integration time that the renderer can't even allocate one.

**Why it happens:**
It works in a quick Node/test context but not in the packaged Electron renderer, because nobody set the COOP/COEP response headers for the app's content. The failure surfaces late and looks like an Electron/Chromium bug rather than a missing header.

**How to avoid:**
In the Electron main process, set the isolation headers on the app's responses (e.g. via `session.defaultSession.webRequest.onHeadersReceived`): `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp`. Verify `self.crossOriginIsolated === true` in the renderer console as an explicit acceptance check. Be aware COEP `require-corp` will also force every cross-origin sub-resource (fonts, CDN images) to opt in via CORP/CORS — plan asset loading accordingly. Have a non-shared fallback path (post a regular `ArrayBuffer` per frame, throttled) so the feature degrades instead of crashing if isolation can't be guaranteed.

**Warning signs:**
- `ReferenceError: SharedArrayBuffer is not defined` or `crossOriginIsolated` is `false` in the renderer.
- Third-party assets stop loading the moment COEP is enabled.

**Phase to address:**
App-shell/foundation phase (Electron Forge setup) — decide and verify isolation before the live-sync phase builds on SharedArrayBuffer. Flag the live-sync phase as dependent on this.

---

### Pitfall 5: Win32 memory-injection pointer offsets are per-build and brittle

**What goes wrong:**
The live-edit killer feature writes a matrix to a target address in `SWGClient.exe`. Per the docs' own caveat, **every memory offset/pointer layout is client-build-specific and not stable across versions or recompiles**. Hard-coding addresses (or shipping a static offset table) means the feature silently breaks the moment the maintainer rebuilds `swg-client-v2`, a server ships a client patch, or a user runs Infinity vs. SWGEmu. Worse, a *stale* address that now points at unrelated memory turns "move a building" into "corrupt the client and crash it." The provided C++ also has real defects that compound this: two divergent globals (`hSwgProcess` vs `g_swgProcessHandle`) used inconsistently across `HookClientProcess`/`AttachToClient`/`SignalMemoryPatch`; one attach path requests `PROCESS_VM_WRITE` without `PROCESS_VM_OPERATION`; and a `SIZE_t` typo (should be `SIZE_T`). None of these survive contact with a compiler/real client untouched.

**Why it happens:**
Offsets found once (via Cheat Engine / mining Utinni) work on the developer's exact binary, so they get hard-coded. The fragility is invisible until the binary changes.

**How to avoid:**
- **Never hard-code addresses.** Discover them at runtime via signature/AOB scanning or by reusing Utinni's resolution logic (`../Utinni`/`UtinniPlugins` are explicitly on the machine to mine). Resolve through known module bases + pattern scans, validated each attach.
- Read-verify before write: confirm the target region looks like the expected object (sane matrix / known sentinel) before writing; refuse to patch if validation fails.
- Tie offset profiles to a detected client build hash so the wrong profile can't load against the wrong binary.
- Fix the handle/flag/typo bugs and standardize on a single process-handle global with a clear attach/detach lifecycle; always request `PROCESS_VM_OPERATION | PROCESS_VM_READ | PROCESS_VM_WRITE`.

**Warning signs:**
- Injection works on the dev's client and immediately fails (or crashes the client) on a different install/build.
- Writes "succeed" (`WriteProcessMemory` returns true) but nothing moves in-game, or the wrong thing moves — a sign the address resolved to the wrong object.
- `bytesWritten != 64` or `WriteProcessMemory` returning false intermittently.

**Phase to address:**
Live-sync / memory-injection phase. Make runtime address resolution + a read-verify guard part of the *minimum* feature, not a later hardening step.

---

### Pitfall 6: Anti-cheat, antivirus, and OS privilege friction around process injection

**What goes wrong:**
`OpenProcess(PROCESS_VM_WRITE)` + `WriteProcessMemory` + WinSock `recv`/`send` Detours hooks is, behaviorally, indistinguishable from a cheat/malware. Consequences: (a) AV/EDR (Defender, etc.) may quarantine the native addon or the app; (b) any anti-cheat on a target server will flag or ban the account — using this against a *live production server you don't own* is both a ban risk and an ethics/ToS violation; (c) `OpenProcess` against another process typically requires the editor to run elevated or with `SeDebugPrivilege`, and UAC/standard-user setups will fail to attach; (d) packet-sniffing via `ws2_32.dll` Detours is even more likely to trip heuristics. The docs' safety note correctly scopes this to "the user's own locally running client for offline modding" — that scoping must be enforced in product behavior, not just documentation.

**Why it happens:**
It works on the developer's machine (dev runs elevated, AV exclusions set, offline client). Real users hit UAC, Defender, and SmartScreen, and some will point it at servers they don't control.

**How to avoid:**
- Scope and message the feature as **local, offline, your-own-client only**; do not encourage or enable use against third-party live servers (matches the docs' ethics note).
- Expect AV friction: code-sign the app and the native addon; document Defender exclusions; test on a clean non-dev Windows install with default Defender on.
- Handle the privilege case explicitly: detect failure to `OpenProcess`, explain elevation/`SeDebugPrivilege` requirements, and fail gracefully (the editor must remain fully usable in file-patch mode without injection).
- Keep injection and packet-hooking **opt-in** and clearly gated, isolated from the always-on editor core so AV reactions to the injection module don't take down the whole app.

**Warning signs:**
- App or `.node` addon silently disappears (quarantined) after build/download; SmartScreen warnings on first run.
- Attach fails only for non-admin users; works only when "Run as administrator."
- Reports of account flags/bans (a sign someone pointed it at a live server).

**Phase to address:**
Live-sync phase, plus packaging/distribution phase (signing, AV testing on clean machines). Architecturally isolate the injection module early.

---

### Pitfall 7: Electron security — disabled context isolation / leaky preload

**What goes wrong:**
This app runs native code that can `WriteProcessMemory`, spawn `child_process` git/system commands, and read/write arbitrary disk paths. If the renderer is configured with `nodeIntegration: true` / `contextIsolation: false`, or the preload `exposeInMainWorld` surface is too broad (e.g. exposing a generic "run this command" or "write this file anywhere" API), then any XSS — or a malicious community changeset / mod manifest / Lua/JSON that gets rendered or interpreted — gains a path to full RCE and to driving the memory-injection and git subsystems. The docs' preload examples (e.g. `triggerGitLfsPublish`, `saveFileToDisk('C:/SWG_Client/...')`) expose powerful operations; if these aren't validated and narrowly scoped, they become the attack surface.

**Why it happens:**
`contextIsolation: false` / `nodeIntegration: true` is the path of least resistance for calling Node from React, and broad preload APIs are convenient. The risk is invisible until untrusted content (a downloaded changeset, a shared workspace, a Mod-Hub package) enters the app.

**How to avoid:**
- Keep Electron's secure defaults: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` where feasible; expose only a **minimal, typed, validated** API via `contextBridge`.
- Each preload method validates and constrains inputs: `saveFileToDisk` must enforce an allow-listed root (the workspace), never accept arbitrary absolute paths from the renderer; git operations must validate repo paths and never interpolate untrusted strings into shell commands (the docs' `git commit -m "${cleanMsg}"` via `exec` is a command-injection smell — use `execFile`/arg arrays, not string interpolation).
- Treat all downloaded content (changesets, manifests, Lua, remote sync payloads) as untrusted: verify SHA-256 (the design already hashes), never `eval`/execute it, and load it in least-privilege contexts.
- Set a strict CSP for the renderer.

**Warning signs:**
- `webPreferences` with `nodeIntegration: true` or `contextIsolation: false`.
- Preload exposes broad capabilities (raw `fs`, raw `child_process`, "exec arbitrary command/path").
- Shell commands built by string interpolation of user/remote input.

**Phase to address:**
App-shell/foundation phase — lock the security posture before features accrete. Re-audit at the workflow phase (git, remote sync, Mod-Hub) when untrusted content enters.

---

### Pitfall 8: Three.js / R3F per-frame allocation and GC churn

**What goes wrong:**
SWG scenes have thousands of small objects (foliage, props, spawn markers). The live-sync path runs at 60 fps. Allocating in the render/`useFrame` hot loop — `new THREE.Vector3()`, `new Matrix4()`, `matrix.toArray(new Float32Array(16))` per frame (as `SwgLiveRuntimeCore.injectLiveObjectTransform` does: it allocates a fresh `Float32Array(16)` on every gizmo move), creating new geometries/materials on reload, or rebuilding React state every frame — produces GC pauses that show up as visible frame hitches exactly when the user is dragging something and wants smoothness.

**Why it happens:**
Idiomatic JS/React encourages "create a new value each render." It's invisible at low object counts and only bites once a real planet's worth of geometry is on screen.

**How to avoid:**
- Reuse module-scope scratch objects (`Vector3`/`Matrix4`/`Float32Array`) in hot loops; never `new` per frame (the architecture doc states this rule — enforce it).
- Mutate `BufferGeometry` attributes in place on reload instead of destroying/recreating geometry.
- Throttle high-frequency IPC to the frame/input boundary (the docs' `requestAnimationFrame`-gated throttle is correct — keep it).
- Keep 60 fps transform updates *out* of React state/Zustand re-renders; drive them through refs and `useFrame`, syncing React state only at coarse boundaries.

**Warning signs:**
- DevTools Performance shows sawtooth heap with frequent minor-GC; frame time spikes correlate with GC.
- Stutter that worsens as scene object count grows; smooth at 50 objects, janky at 5,000.
- `new Vector3/Matrix4/Float32Array` or geometry/material construction inside `useFrame`/render.

**Phase to address:**
Rendering/viewport phase (establish the reuse + instancing patterns), reinforced in the live-sync phase (the 60 fps path).

---

### Pitfall 9: Not instancing repeated geometry (draw-call explosion)

**What goes wrong:**
SWG worlds are dominated by repeated foliage, rocks, and spawn markers. Rendering each as its own `Mesh` produces thousands of draw calls and tanks framerate well before a full planet is loaded. The architecture doc explicitly calls for `InstancedMesh` for "foliage, spawn markers, crowds" — skipping it is a predictable performance wall.

**Why it happens:**
One-mesh-per-object is the simplest thing that renders correctly; instancing requires a different data model (per-instance matrices) and is deferred until the framerate problem forces it — by which point the scene-graph and editing model assume individual meshes.

**How to avoid:**
Design the world/flora viewport around `InstancedMesh` from the start: per-instance transform arrays, instance picking for selection, and in-place updates of `instanceMatrix`. Budget draw calls explicitly (target a ceiling) and measure on a real dense scene, not a handful of test props.

**Warning signs:**
- Renderer info shows draw calls in the thousands.
- Framerate collapses as foliage density increases; a single tree is fine, a forest is unusable.

**Phase to address:**
World-snapshot / flora / terrain rendering phases. Make instancing a design constraint of those phases, not an optimization pass.

---

### Pitfall 10: Committing copyrighted multi-GB retail `.tre` archives to Git/LFS

**What goes wrong:**
Retail/base-client `.tre` archives are multi-GB copyrighted SOE/Daybreak assets. Committing them — even via LFS — creates (a) a copyright violation, (b) an effectively un-cloneable repo, and (c) GitHub LFS bandwidth/storage overruns and bills. The docs explicitly warn against this; the danger is that the auto-`.gitattributes`/`git add .` automation (`executePublishPipeline` runs `git add .`) makes it *easy* to sweep a whole workspace — including extracted vanilla assets sitting in the working tree — into a commit.

**Why it happens:**
"Version everything" is the default instinct, the LFS automation lowers friction, and a blanket `git add .` doesn't distinguish mod outputs from extracted base assets.

**How to avoid:**
- LFS-track only **mod-produced** outputs (compiled patch `.tre`, exported `.trn`/`.msh`, etc.), never raw client archives or extracted vanilla trees.
- Keep extracted vanilla assets in an ignored directory (`extracted_vanilla_base/`, `.studio/`) and ship a robust `.gitignore` alongside the `.gitattributes` automation; never `git add .` blindly — stage explicitly or stage from the mod-output dir only.
- Pull base assets on demand from a local install / authorized source; never bundle them in history.
- Set LFS size guardrails / pre-commit checks that reject staging files above a threshold or matching the retail-archive fingerprint.

**Warning signs:**
- Clone/pull takes forever or hits LFS quota errors; repo size balloons.
- `git status` shows GB-scale files staged; `.tre` files appearing in history that aren't mod outputs.

**Phase to address:**
Workflow / version-control phase. The verification here is concrete: a fresh clone is small and fast, and no retail archive appears in `git log`.

---

### Pitfall 11: Client/server parity drift (Core3 Lua vs. client `.iff`)

**What goes wrong:**
The client reads stats from `.iff` DTII tables in `.tre`; the server derives authoritative values from Core3 Lua templates. Edit one without the other and you get rubber-banding (visual vs. server attack speed), collision/terrain desync, or outright client crashes when structural tables diverge. The dual-track pipeline in `docs/05-server-integration/core3-parity.md` is the intended fix, but it has two failure modes of its own: (a) the **Core3 paths/Lua schema are themselves AI-proposed** and must be verified against the real `MMOCoreORB` tree, and (b) the dual write is **not atomic** — if the client `.iff` write succeeds and the Lua write fails (or vice versa), you've *created* drift while believing you prevented it.

**Why it happens:**
It's tempting to edit the client `.iff` in the visual editor and forget the server side, or to trust the generated Lua path without checking it resolves in the actual Core3 layout. Non-transactional "write both then hope" pipelines drift on partial failure.

**How to avoid:**
- Verify Core3 paths/schema against the actual `../Core3`/`MMOCoreORB` tree before relying on the generator (same provenance discipline as the binary formats).
- Make the dual-track deploy as close to transactional as possible: stage both outputs, validate both, then commit both; on any failure, roll back both (the changeset/snapshot system supports this). Never leave one side written and the other not.
- Add a **parity audit** that diffs the relevant client `.iff` values against the server Lua values and reports drift, independent of the deploy path — so drift introduced by hand-editing either side is caught.
- Don't ship the remote deployment daemon as designed: it binds `0.0.0.0` with no auth/TLS/rate-limit (the doc flags this). It needs a real security review before any network exposure.

**Warning signs:**
- A weapon's tooltip speed/damage doesn't match in-combat behavior; rubber-banding on movement.
- Generated Lua lands at a path Core3 never reads (wrong category derivation, wrong root).
- Client crashes after a "successful" deploy where only one side actually updated.

**Phase to address:**
Server-integration / parity phase. Gate it on Core3-tree verification and a standalone parity-audit tool; treat the deployment daemon as a separate, security-reviewed subproject.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Implement a format parser straight from the `docs/` layout without checking `swg-client-v2` | Fast first render; demo works | Wrong on real assets; silent corruption; rewrite + lost trust | **Never** for ship; OK only as a throwaway spike clearly labeled unverified |
| Synchronous N-API for file/archive work | Simple, no AsyncWorker plumbing | UI freezes on real multi-GB files; expensive retrofit | Only for trivially small, bounded reads (headers, manifest lookups) |
| Cache a global `T* = buffer.Data()` for the SharedArrayBuffer | "Zero-copy" hot path | Use-after-free → live client corruption | Only with a held strong reference + finalizer + no-detach guarantee |
| Hard-code memory offsets found via Cheat Engine | Injection works today on dev's client | Breaks/crashes on any other build; per-patch maintenance forever | Only as a throwaway proof-of-concept; never shipped |
| `nodeIntegration: true` / `contextIsolation: false` to call Node from React | Easiest renderer→Node calls | RCE surface for any untrusted mod/changeset | Never (this app handles untrusted community content + native injection) |
| `git add .` in the publish pipeline | One-button commit | Sweeps copyrighted/extracted GB assets into history | Only if `.gitignore` + size guardrails provably exclude base assets |
| New `Vector3`/`Matrix4`/`Float32Array` per frame | Idiomatic, readable | GC hitching at real object counts | Only outside hot loops (setup/coarse events) |
| One `Mesh` per foliage/prop instead of `InstancedMesh` | Simplest correct render | Draw-call wall; can't load a real planet | Only for <~hundreds of objects / static previews |
| Non-atomic client+server dual write | Simple pipeline | Creates drift on partial failure | Never for production deploy; stage-validate-commit-both instead |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| `swg-client-v2` (ground truth) | Treating `docs/` layouts as the spec | Read the actual loader; round-trip-test against real bytes before trusting any layout |
| Live `SWGClient.exe` (Win32) | Hard-coded offsets; inconsistent process-handle globals; `OpenProcess` missing `PROCESS_VM_OPERATION` | Runtime AOB/signature resolution (mine Utinni); single handle lifecycle; full VM flags; read-verify before write |
| SharedArrayBuffer in Electron renderer | Assuming it's available by default | Set COOP/COEP headers, verify `crossOriginIsolated`; provide a non-shared fallback |
| node-addon-api ArrayBuffer | Caching `Data()` pointer without a strong ref | Hold `Napi::Reference` + finalizer, or pass the typed array per call |
| Git LFS / GitHub | LFS-tracking everything incl. retail `.tre` | LFS for mod outputs only; ignore base/extracted assets; size guardrails |
| Core3 / MMOCoreORB | Trusting AI-proposed Lua paths/schema; non-atomic dual write | Verify against the real tree; transactional stage-validate-commit-both; standalone parity audit |
| Blender bridge (WebSocket) | Trusting the `.ans`/animation round-trip layout from docs | Same format-verification discipline; validate exported `.ans` against `swg-client-v2`/community plugin |
| DDS textures | Assuming the browser renders `.dds` | Transcode `.dds`→png/webp in the C++ layer (or use Three.js `DDSLoader` deliberately) |
| `.cfg` loader (swg.cfg/live.cfg) | Naive key=value parser collapsing duplicate `searchTree=` keys | Preserve duplicate keys as ordered entries; insert at correct priority; atomic write + backup |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Main-thread native parse/decompress | UI frozen (not "loading"); long task on main thread | AsyncWorker / thread pool for all whole-file work | First real multi-GB TRE / large mesh |
| Per-frame GC churn in `useFrame` | Sawtooth heap, frame-time spikes while dragging | Reuse scratch objects; refs over React state in hot loop | A few thousand scene objects |
| No instancing for foliage | Thousands of draw calls; framerate collapses | `InstancedMesh` + per-instance matrices from the start | A real dense planet/biome |
| JSON-serializing geometry/terrain/audio across N-API | V8 main-thread stall/crash on big payloads | Typed arrays / ArrayBuffer only for bulk binary (docs' core rule) | Any real-size mesh/terrain/texture |
| Re-creating geometry on every chunk reload | Hitch on every edit; GPU upload storms | Mutate `BufferGeometry` attributes in place | Frequent live edits |
| Re-hashing entire workspace on every sync check on main thread | UI stalls during "check for updates" | Native AsyncWorker SHA-256 (docs do this) — keep it off-main-thread | Thousands of local assets |

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| `contextIsolation:false` / `nodeIntegration:true` | XSS / malicious mod → full RCE driving native injection | Secure Electron defaults; minimal typed `contextBridge` API |
| Broad preload (raw fs / child_process / arbitrary path) | Untrusted changeset writes anywhere / runs anything | Allow-list workspace root; validate every arg; `execFile` not interpolated `exec` |
| Shell command built by string interpolation (`git commit -m "${msg}"`) | Command injection via commit message / repo path | Arg arrays (`execFile`/`spawn`), never string-built shell |
| Executing/`eval`-ing downloaded changesets/manifests/Lua | RCE from Mod-Hub content | Treat all remote content as data; verify SHA-256; never execute |
| Deployment daemon on `0.0.0.0`, no auth/TLS (per doc) | Remote unauth control of server files/templates | Bind private iface; bearer/mTLS auth; rate-limit; security review before exposure |
| Injection/packet-hook against servers you don't own | Account ban; ToS/ethics/legal violation | Scope to local offline own-client only; don't enable third-party-server use |
| Shipping unsigned native addon | AV quarantine; SmartScreen; user can't run | Code-sign app + `.node`; test on clean Defender-on machine |

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Editor unusable without injection/admin/elevation | Non-admin users locked out of core editing | File-patch mode fully works standalone; injection is an opt-in enhancement |
| Silent wrong-parse (renders something, but it's wrong) | Modder ships broken assets, loses trust | Surface verification/round-trip status; warn on unverified formats |
| No undo for a destructive live memory write or deploy | One bad drag corrupts the live client / both environments | Snapshot/changeset rollback wired to live ops; read-verify guard before write |
| AV quarantine with no explanation | App "vanishes" after download | Pre-warn about Defender exclusions; sign; document |
| Long freeze with no feedback during big TRE op | Looks crashed | AsyncWorker + real progress (only possible if work is off-main-thread) |

## "Looks Done But Isn't" Checklist

- [ ] **Format parser:** Often missing real-asset validation — verify it round-trips a real extracted asset byte-for-byte and cites a `swg-client-v2` source, not just that it parsed a synthetic buffer.
- [ ] **TRE/IFF endianness & FORM sizing:** Often assumed — verify size-field endianness and that FORM-size arithmetic leaves zero unexplained trailing bytes on real files.
- [ ] **N-API heavy op:** Often still synchronous — verify it returns a Promise and runs on a worker; confirm UI stays at 60 fps during a 2 GB operation.
- [ ] **SharedArrayBuffer path:** Often built without isolation — verify `self.crossOriginIsolated === true` in the packaged renderer, and that a cached native pointer has a strong reference.
- [ ] **Memory injection:** Often offset-hard-coded — verify it resolves addresses at runtime and read-verifies before writing on a *different* client build.
- [ ] **Electron security:** Often left on insecure defaults — verify `contextIsolation:true`, narrow preload, allow-listed paths, no interpolated shell.
- [ ] **Git/LFS:** Often sweeps base assets — verify a fresh clone is small and `git log` contains no retail `.tre`.
- [ ] **Core3 parity:** Often one-sided/non-atomic — verify the parity audit reports zero drift and a forced partial-failure rolls back both sides.
- [ ] **Live-edit rollback:** Often missing — verify a bad live write/deploy can be reverted via snapshot/changeset.

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Parser built on wrong layout | MEDIUM–HIGH | Stop; verify against `swg-client-v2`; rebuild fixtures + round-trip tests; correct doc and drop AI caveat |
| Main-thread-blocking N-API | MEDIUM | Wrap in `AsyncWorker`, return Promise; ripple through callers (worse the more editors depend on the sync API) |
| Dangling SharedArrayBuffer pointer | MEDIUM | Add strong ref + finalizer, or switch to per-call typed-array passing; audit for other cached `Data()` pointers |
| Hard-coded offsets | MEDIUM | Replace with AOB/signature resolution (mine Utinni); add build-hash-keyed profiles + read-verify guard |
| Insecure Electron posture | LOW–MEDIUM if early, HIGH if late | Flip to secure defaults; narrow preload; refactor renderer→main calls; add CSP — cheap before features accrete, costly after |
| Retail `.tre` in Git history | HIGH | History rewrite (filter-repo/BFG) + force-push (breaks clones); add ignores + guardrails to prevent recurrence |
| Parity drift shipped | MEDIUM | Run parity audit; regenerate the lagging side; make future deploys transactional |

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| AI-proposed format layouts (the headline) | Phase 1 core engine, then **every** format phase | Round-trip on real asset + cited `swg-client-v2` source, per format |
| Main-thread-blocking N-API | Phase 1 core engine | 60 fps UI during a real multi-GB op |
| ArrayBuffer pointer lifetime | Live-sync phase | Strong ref/finalizer present; soak-test live injection through GC pressure |
| SharedArrayBuffer isolation | App-shell phase (blocks live-sync) | `crossOriginIsolated === true` in packaged renderer |
| Per-build memory offsets | Live-sync phase | Attaches + read-verifies on a *different* client build |
| Anti-cheat / AV / privilege | Live-sync + packaging phase | Runs on clean Defender-on machine; graceful non-admin fallback; signed addon |
| Electron context isolation / preload | App-shell phase (re-audit at workflow phase) | Secure defaults; narrow validated preload; no interpolated shell; CSP set |
| Three.js per-frame GC churn | Rendering/viewport phase (reinforced live-sync) | No allocation in `useFrame`; flat heap while dragging |
| No instancing | World-snapshot / flora / terrain phases | Draw-call ceiling met on a dense scene |
| Retail `.tre` in Git/LFS | Workflow / version-control phase | Small fresh clone; clean `git log` |
| Core3 parity drift | Server-integration phase | Parity audit = zero drift; transactional rollback on partial failure |

## Sources

- Project docs (ground truth for this domain): `.planning/PROJECT.md`; `docs/00-overview/source-provenance.md` (the AI-format-trust caveat — rates SWG binary layouts "LOW — VERIFY"); `docs/00-overview/architecture.md` (performance principles: off-main-thread work, reuse-don't-allocate, instancing, zero-copy); `docs/04-live-sync/live-memory-and-ipc.md` (injection safety/offset caveats; SharedArrayBuffer path; the `hSwgProcess`/`g_swgProcessHandle` + `SIZE_t` + `OpenProcess`-flag defects); `docs/06-workflow/version-control-and-backup.md` (LFS + the "don't commit retail `.tre`" warning + `git add .` automation); `docs/05-server-integration/core3-parity.md` (drift problem, AI-proposed Core3 paths, `0.0.0.0` daemon caveat); `docs/01-core-engine/iff-and-tre.md` (IFF endianness/FORM-size/TREE0005 layout claims, duplicate-`searchTree=` cfg note).
- [node-addon-api ArrayBuffer docs](https://github.com/nodejs/node-addon-api/blob/main/doc/array_buffer.md) and [External data lifetime issue #258](https://github.com/nodejs/node-addon-api/issues/258) — `Data()` pointer invalid after GC unless a strong reference is held (confirms Pitfall 3).
- [When can I assume the data pointer remains constant — nodejs/help #1194](https://github.com/nodejs/help/issues/1194) — pointer stability caveats across N-API.
- [MDN: SharedArrayBuffer](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/SharedArrayBuffer) and [web.dev: COOP/COEP cross-origin isolation](https://web.dev/articles/coop-coep) — SharedArrayBuffer requires a cross-origin-isolated secure context; how to set COOP/COEP in Electron (confirms Pitfall 4).
- [Electron security checklist (context isolation, sandbox, preload)](https://www.electronjs.org/docs/latest/tutorial/security) — basis for Pitfall 7's secure-defaults guidance.

---
*Pitfalls research for: SWG modding suite (Electron/React/TS/Three.js + C++ N-API + Win32 injection + Blender + Core3)*
*Researched: 2026-06-21*
