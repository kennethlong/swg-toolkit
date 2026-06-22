---
phase: 0
reviewers: [codex, cursor, sonnet, opus]
reviewed_at: 2026-06-21
plans_reviewed:
  - 00-01-PLAN.md
  - 00-02-PLAN.md
  - 00-03-PLAN.md
  - 00-04-PLAN.md
  - 00-05-PLAN.md
review_method: cross-AI consult crew (CLAUDE.md), de-anchoring protocol — neutral evidence, non-overlapping angles
angles:
  codex: cross-plan interface consistency & dependency DAG
  cursor: ground-truth fact-check of version pins, API signatures, framework behavior
  sonnet: lateral — scope / over-engineering / blind spots / sequencing
  opus: spec & coverage — does each SC/FND have airtight proof?
---

# Cross-AI Plan Review — Phase 0 (Toolchain De-risk & App Shell)

Four independent reviewers, each handed neutral evidence (the plans + version pins flagged as
"verify, don't trust") on a **non-overlapping angle** so convergence is signal, not echo. The
strongest result of the round: Cursor's primary-source fact-check **falsifies a core claim in the
AI-distilled `00-RESEARCH.md`** — exactly the project's #1 risk (see `docs/00-overview/source-provenance.md`).

---

## Codex Review — cross-plan wiring & dependency DAG

**Summary.** IPC message literals line up across all five plans, but there are two integration-time
wiring faults that would fail before/at app boot. Would not execute Phase 0 as-is.

**Strengths**
- IPC literals consistent across contracts and consumers: `hello`, `pong`, `init-port`, `sab-ready`, channel `sab-port` agree across 00-01/03/04/05.
- Wave order broadly right (scaffold/native → Electron wiring → renderer shell → E2E).
- Every `@...SUMMARY.md` include points to a file the referenced plan actually produces.
- No two same-wave plans declare the same `files_modified` path.

**Concerns**
- **HIGH — Vite utility-worker entry path mismatch.** 00-01 Task 2 declares `vite.main.config.ts` inputs as `src/main.ts` + `src/utility-worker.ts`, but 00-03 creates them under `packages/backend/src/`. Unless Forge's Vite root is `packages/backend`, Rollup looks for nonexistent root `src/*` files and 00-03's `utilityProcess.fork()` won't find the emitted `utility-worker.js`.
- **HIGH — `window.__sabValue` producer under-specified / likely not wired.** 00-04 Task 2 requires `ViewportPanel` to set the hook after `onSabPort` fires, but 00-04 says ViewportPanel has only placeholder SAB state and that `window.api` wiring happens in Task 3 — whose `files` list excludes ViewportPanel and wires `onSabPort` only in StatusBar. The grep can pass while the runtime hook is never set, hanging 00-05's SAB specs.
- **MEDIUM — 00-02 consumes 00-01 but declares `depends_on: []` and shares wave 1.** It relies on 00-01's workspace scaffold + root Vitest config, so it isn't truly parallelizable.
- **MEDIUM — 00-05 may edit `ViewportPanel.tsx` ("add it now via Edit") but doesn't declare it in `files_modified`** — violates its own modification boundary and hides a cross-plan repair.
- **LOW — Dead port wiring.** The `port`/`MessagePort` half of `onSabPort`/`sab-port` is never used by preload (it reads only `payload.sab`); the worker replies via `parentPort`, so the transferred `port1` is dead wiring (does not break the SAB payload path).

**Risk: HIGH** until the Vite/backend path mismatch and `__sabValue` ownership are fixed.

---

## Cursor Review — ground-truth fact-check (version pins, API signatures, framework behavior)

**Summary.** Version pins are **real** and mutually plausible (checked via `npm view` on 2026-06-21);
Electron Forge, dockview, cmake-js variable names check out. The blockers are in native-addon and
isolation wiring: `Napi::SharedArrayBuffer::New` is **experimental-gated** (contradicts 00-02/RESEARCH),
the utility→renderer "zero-copy" story is **not proven** across process boundaries, and packaged
`file://` COOP/COEP via `onHeadersReceived` is **not reliably documented**.

**Strengths**
- Version pins are **not fabricated** — every pin resolves on npm today (electron@42.4.1, typescript@6.0.3, pnpm@11.8.0, @electron-forge/*@7.11.2, dockview@6.6.1, tailwindcss@4.3.1, vitest@4.1.9, @playwright/test@1.61.0).
- Electron API surface is real: `utilityProcess.fork`, `MessageChannelMain`, `webContents.postMessage(channel, msg, transfer?)`, `session.webRequest.onHeadersReceived`.
- dockview-react 6.6.1 API matches the plan (`DockviewReact`, `fromJSON/toJSON/onDidLayoutChange`, `addPanel` directions).
- cmake-js 8 variables `CMAKE_JS_INC/LIB/SRC` correct; **MSVC `v145` confirmed** in `../swg-client-v2` `.vcxproj`.

**Concerns** (verified-WRONG / UNVERIFIABLE first)
- **HIGH — `Napi::SharedArrayBuffer::New` requires `NAPI_EXPERIMENTAL` and node-addon-api ≥ 8.6.0.** node-addon-api 8.8.0 `doc/shared_array_buffer.md` states it is *"only available when using `NAPI_EXPERIMENTAL"`* (`#ifdef NODE_API_EXPERIMENTAL_HAS_SHAREDARRAYBUFFER`); the class is **absent** in 8.0–8.5; underlying `node_api_create_sharedarraybuffer` added in Node v24.9.0 as experimental. **00-02's CMake defs and RESEARCH Pitfall 4/A4 ("does NOT need NAPI_EXPERIMENTAL") are incorrect.** Building with only `NAPI_VERSION=8` will not compile / skip SAB → **`allocateSab` is a Phase-0 blocker**.
- **HIGH — utility→renderer "zero-copy" SAB not established.** Utility process is a separate OS process (not a worker thread). Electron's `postMessage` transfer list is `MessagePortMain[]` only — no SAB transfer API. A value round-trip (read `0xDEAD`) may pass via structured clone; same backing store across utility↔renderer is **not documented**. D-04's "zero-copy" premise (the live-sync 60fps channel) is **not proven** by the cited APIs.
- **HIGH — FND-02 vs 00-02:** requirements promise "cmake-js (**prebuildify distribution**)"; plans implement cmake-js only. `prebuildify`/`node-gyp-build` exist on npm but are **never integrated**.
- **MEDIUM — packaged `file://` + COOP/COEP via `onHeadersReceived` is UNVERIFIABLE.** Electron security tutorial says HTTP-header injection doesn't work for `file://` (meta-tag fallback) and recommends `protocol.handle`. RESEARCH's "VERIFIED" label is overconfident; **00-05's packaged spec is the essential gate, not a confirmation.**
- **MEDIUM — `node-addon-api 8`** unpinned at minor hides that 8.0–8.5 lack the SAB class. Pin `^8.8.0`.
- **MEDIUM — MSVC v145** is right for swg-client-v2 but a default VS 2022 install is typically **v143**; cmake-js uses whatever MSVC is active — no v145 enforcement.
- **LOW — dockview pixel sizing** (240/280/200) needs explicit `initialWidth/initialHeight` in `addPanel`.

**Risk: HIGH** for the native + isolation path. Treat RESEARCH's "VERIFIED" labels on SAB creation
and `file://` headers as **AI-consensus artifacts, not ground truth**, until 00-02 compiles with
`NAPI_EXPERIMENTAL` and 00-05 passes `crossOriginIsolated === true` + a cross-write SAB test.

---

## Sonnet Review — lateral (scope, blind spots, sequencing)

**Summary.** Architecture is sound and appropriately ambitious, but the plans have crept beyond
"prove the wiring," and the riskiest integration proof (packaged COOP/COEP + SAB) sits at the very
last task of the last wave with no early signal. Sequencing is the deepest structural problem; Plan 04
scope inflation is second.

**Strengths**
- Packaged-binary COOP/COEP + SAB proof (05) is genuinely valuable and usually skipped.
- Utility-process isolation (D-02) called out now avoids a later retrofit.
- `contracts/` keystone (shared discriminated-union IPC types) prevents type drift.
- Threat-model entries are specific and cross-reference the code they protect.
- TDD RED before the cmake-js build (00-02) catches the most opaque failure surface early.

**Concerns**
- **HIGH — 00-04 scope:** 17 renderer files + 5 themes (incl. full high-contrast WCAG override), panel chips, 48px gizmo, fake "4,812 verts" — product work, not proof-of-wiring; inflates the wave-3 blast radius.
- **HIGH — 00-05 Task 3 runs `pnpm package` (60–120s, native rebuild) inside `test.beforeAll()`** — a 2-min blocking build coupled to the test; makes local iteration miserable, non-idempotent, likely to get disabled. Decouple into a `package:ci` script + `PACKAGED_EXE_PATH` env var.
- **HIGH — No CI configuration anywhere** in the five plans; "automated verification" is only locally verified. Headless Electron needs xvfb on Linux; MSVC env on Windows.
- **HIGH — cmake-js failure path not de-risked before wiring.** No `cmake`/MSVC preflight; a fresh contributor without VS 2022 Build Tools fails cryptically mid-00-02 after finishing 00-01. Add `scripts/check-prereqs.js`.
- **MEDIUM — Experimental Forge Vite plugin (D-01) is named but not de-risked** — no spike, no fallback, no canary; failure surfaces only in wave 2.
- **MEDIUM — `ipcMain.handle('hello')` race (00-03 Task 1):** `worker.once('message', d => { if (d.type==='pong') resolve(...) })` — the once-listener is consumed by the first message; if `sab-ready` arrives first, the guard skips it, the listener is spent, and `window.api.hello()` **hangs forever**. Use a persistent demux handler or correlation IDs. *(Concrete latent bug.)*
- **MEDIUM — WCAG aria-label `wc -l >= 10` gate is theater** (one element with 10 labels passes); premature for a de-risk phase.
- **MEDIUM — `autonomous` flags inverted:** the riskiest plans (01 scaffold, 02 cmake-js) are `autonomous: true`; the mechanical UI/E2E plans (04, 05) are `false`. Add a human checkpoint after `pnpm install`/cmake-js build.
- **MEDIUM — No `.nvmrc` / `engines`;** addon ABI must match Electron 42's Node — silent "invalid binding" failures otherwise.
- **MEDIUM — prebuildify in FND-02 / CONTEXT but implemented in no plan** — ambiguity that will confuse the executor.
- **MEDIUM — Layout persistence test uses `page.reload()`, not a real restart** — doesn't exercise main-process re-init; passes even if real-restart persistence is broken.
- **LOW — hello (SC-2) conflated into 01-boot.spec.ts;** LOW — `__sabValue` double-source-of-truth between 00-04 and 00-05.

**Risk: MEDIUM-HIGH.** The only truly risky integration is gated behind 40+ tasks and 17 files with
no early signal; and the correct packaged test is coupled to a 2-min build that will get disabled in practice.

---

## Opus Review — spec & coverage (proof quality)

**Summary.** Unusually disciplined: every SC has a named spec and the highest-value de-risk (packaged
COOP/COEP, SC-3) is genuinely well covered. But coverage is strong on *presence* of tests and weak on
*proof quality* in the two places that matter most to the phase's purpose.

**Strengths**
- **SC-3 packaged proof is airtight** — 00-05 Task 3 launches the real `out/` binary with no dev server and asserts `crossOriginIsolated` + the SAB sentinel; explicitly forces `webRequest.onHeadersReceived`.
- SC→spec mapping otherwise complete and 1:1 (SC-1→01-boot, SC-2→01-boot, SC-3→02+05, SC-4→03, SC-5→04).
- FND-04 proven directly (`tsc --noEmit` on contracts + enforced `workspace:*` imports).
- SC-1 verified via the authoritative `webContents.getWebPreferences()` + negative `window.require/process` checks.
- TDD RED→GREEN on the addon surfaces toolchain failure before wiring.

**Concerns**
- **HIGH — SC-4 / D-04: "zero-copy / shared" is never tested; a copy passes every assertion.** A serialized copy across the IPC hop yields the identical `57005`. No assertion that the arrived object `instanceof SharedArrayBuffer`, and no same-memory observability test. The single most important proof in the phase is a proxy.
- **HIGH — FND-02: prebuildify required but implemented nowhere.** REQUIREMENTS + CONTEXT pin "prebuildify distribution"; 00-01 even justifies externalizing native-core "via node-gyp-build" — but 00-02 only runs `cmake-js build` → `build/Release/...node` and `main` points straight at it. No `prebuilds/` layout, no `node-gyp-build` entry. Internal inconsistency; `AutoUnpackNatives` masks the gap so 05 still passes.
- **MEDIUM — SC-5 "survives restart" proven by `page.reload()`, not a process restart.** 00-04's must_haves literally say "reload." Only the human checkpoint truly restarts. 05 already closes/relaunches the process but tests only isolation/SAB — the machinery is right there, unused for SC-5.
- **MEDIUM — Nyquist self-certified against a placeholder.** At review time 00-VALIDATION.md is still the unfilled template; 00-05 Task 2 both authors the SC-5 test *and* flips `nyquist_compliant: true` and ticks its own sign-off. No independent gate.
- **LOW — SC-2 mapping mislabeled** (01-boot artifact tagged SC-1 only); **LOW — `tsc --noEmit`** is a compile-time proxy for FND-04's runtime "imported by both."

**Risk: MEDIUM.** The scaffold will build and pass its suite, and packaged COOP/COEP is genuinely
retired — but the two criteria the phase *exists to de-risk* (SC-4 zero-copy, FND-02 distribution)
have the weakest proofs, so a green suite can credibly report "Phase 0 complete" while the zero-copy
channel and no-compiler distribution remain unproven.

---

## Consensus Summary

### Agreed strengths (2+ reviewers)
- **`contracts/` keystone discriminated-union IPC types** — cited by Codex, Sonnet, Opus as the right architectural call; literals verified consistent end-to-end.
- **Packaged-binary COOP/COEP + SAB proof (00-05 Task 3)** — Sonnet, Opus, and Cursor all single it out as the highest-value, usually-skipped de-risk. (Cursor reframes it as *essential*, not confirmation.)
- **TDD RED→GREEN on the cmake-js addon (00-02)** — Sonnet + Opus: surfaces the most opaque build failure before wiring.
- **Version pins & UI-library APIs are real** — Cursor verified via `npm view`; dockview/Electron/cmake-js surfaces confirmed.

### Agreed concerns (raised independently by 2+ reviewers — highest priority)
1. **🔴 prebuildify (FND-02) is required but implemented in NO plan — 3/4 reviewers (Cursor HIGH, Opus HIGH, Sonnet MEDIUM).** The Vite externalization comment relies on `node-gyp-build`, which the cmake-js-only build never produces. Either add a 00-02 prebuildify task (RESEARCH names `prebuildify@6` + `node-gyp-build@4`) or formally descope it from FND-02 — today it is neither.
2. **🔴 SC-4 / D-04 "zero-copy" is unproven — a copy passes the sentinel test (Opus HIGH, Cursor HIGH).** Both prescribe the same fix: a **cross-write test** — utility writes, renderer reads, then the *other side* writes a second sentinel and the first reads it back **without re-posting**. Same-memory observability is the only thing distinguishing zero-copy from a copy. Cursor escalates further: cross-process SAB sharing across utility↔renderer may be **copy-only at the utility boundary** and is undocumented — this threatens the whole live-sync premise, not just the test.
3. **🟠 SC-5 "survives restart" is proven by `page.reload()`, not a real process restart (Opus MEDIUM, Sonnet MEDIUM).** Both note 00-05 already has close/relaunch machinery that should be reused to make SC-5 an automated restart test.
4. **🟠 The `window.__sabValue` test hook has unclear/likely-broken ownership (Codex HIGH, Sonnet LOW).** 00-04 assigns it to ViewportPanel but wires `onSabPort` only in StatusBar; make it a named `must_haves.truths` entry in 00-04 and remove the conditional "add it if missing" from 00-05.

### The de-anchoring result (ground truth beats consensus)
**Cursor's HIGH finding falsifies `00-RESEARCH.md` Pitfall 4 with primary sources:**
`Napi::SharedArrayBuffer::New` **requires `NAPI_EXPERIMENTAL`** and **node-addon-api ≥ 8.6.0** — the
research doc (and 00-02, which inherits it) explicitly assert the opposite. This is the project's #1
risk made concrete: four-LLM "consensus" from the same AI-generated doc would have happily agreed on a
spec that **won't compile**. The other three reviewers, reasoning from the plan text, did **not** catch
this — only the reviewer tasked to check primary sources did. **Action: update `00-02`, `00-RESEARCH.md`
Pitfall 4/A4, and pin `node-addon-api@^8.8.0`; this gate should block execution.**

### Divergent / single-reviewer findings worth investigating
- **Codex (HIGH):** Vite utility-worker input path mismatch (00-01 `src/*` vs 00-03 `packages/backend/src/*`) — concrete build-time break; needs a single source-of-truth path mapping.
- **Sonnet (MEDIUM, concrete bug):** `worker.once('message')` hello relay race — `window.api.hello()` hangs if `sab-ready` precedes `pong`. Use a persistent demux handler / correlation IDs.
- **Sonnet (HIGH):** `pnpm package` embedded in the E2E `beforeAll` — decouple into `package:ci` + `PACKAGED_EXE_PATH`.
- **Sonnet (HIGH):** no CI, no `scripts/check-prereqs.js`, no `.nvmrc`/`engines`, inverted `autonomous` flags (riskiest plans run unattended).
- **Cursor (MEDIUM):** packaged `file://` COOP/COEP via `onHeadersReceived` may be unreliable — plan a `protocol.handle('app://')` or meta-tag fallback. (Aligns with Opus's dev-vs-packaged caution and elevates it to a mechanism doubt.)
- **Cursor (MEDIUM):** MSVC **v145 vs default v143** — cmake-js uses whatever MSVC is active; no enforcement.
- **Opus / Sonnet (MEDIUM):** Nyquist `nyquist_compliant: true` is self-certified by the same plan (00-05) that authors the tests, against a placeholder VALIDATION.md.
- **Codex (LOW):** dead `MessagePort` wiring in the `sab-port` path.

### Overall risk: **HIGH**
Three of four reviewers rate the native + isolation path HIGH (Codex, Cursor, Sonnet MEDIUM-HIGH;
Opus MEDIUM on proof-integrity). The plan is well-structured and most facts check out, but it carries
**one verified-wrong blocker** (NAPI_EXPERIMENTAL), **two HIGH proof gaps that the phase exists to
de-risk** (zero-copy SAB, prebuildify distribution), and **concrete wiring faults** (Vite path,
`__sabValue` ownership, hello race) that would fail at integration. None are fatal; all are fixable
inside the existing plan structure with targeted edits before execution.

---

## Recommended actions before executing Phase 0 (priority order)
1. **[BLOCKER]** Fix `Napi::SharedArrayBuffer::New`: add `NAPI_EXPERIMENTAL` to 00-02's CMake defs, pin `node-addon-api@^8.8.0`, and correct `00-RESEARCH.md` Pitfall 4/A4. Drop the "AI-proposed" caveat only after this compiles.
2. **[BLOCKER]** Resolve prebuildify (FND-02): add a 00-02 prebuildify + `node-gyp-build` task **or** descope it from FND-02/CONTEXT. Make the `.node` resolution path one source of truth.
3. **[HIGH]** Add a same-memory **cross-write SAB test** to 00-03/00-05 so D-04 proves sharing, not value; assert `instanceof SharedArrayBuffer` in the renderer.
4. **[HIGH]** Fix the Vite utility-worker input path (00-01 ↔ 00-03) and the `__sabValue` hook ownership (make it a named 00-04 truth).
5. **[HIGH]** Decouple `pnpm package` from the E2E suite (`package:ci` + `PACKAGED_EXE_PATH`); add a minimal CI workflow + `scripts/check-prereqs.js` + `.nvmrc`/`engines`.
6. **[MEDIUM]** Make SC-5 a real close/relaunch restart test (reuse 05's machinery). Fix the `worker.once` hello race. Plan a `protocol.handle`/meta-tag COOP/COEP fallback. Reconsider the inverted `autonomous` flags. Decouple the Nyquist sign-off from the test-authoring plan.

To incorporate this feedback into the plans:
```
/gsd:plan-phase 0 --reviews
```
