---
phase: 0
round: 2
reviewers: [codex, cursor, sonnet, opus]
reviewed_at: 2026-06-21
plans_reviewed:
  - 00-01-PLAN.md
  - 00-02-PLAN.md
  - 00-03-PLAN.md
  - 00-04-PLAN.md
  - 00-05-PLAN.md
review_method: cross-AI consult crew (CLAUDE.md), de-anchoring protocol — neutral evidence, locked ground-truth axioms, non-overlapping angles
prior_round: 00-REVIEWS-r1.md (round 1 — incorporated via /gsd:plan-phase 0 --reviews)
angles:
  cursor: primary-source check — is cross-process (utility→renderer) SAB sharing actually real?
  codex: cross-plan wiring re-trace — port topology + round-1 fix consistency across all 5 plans
  sonnet: lateral — did the round-2 fixes overcorrect a de-risk phase into a heavy one?
  opus: proof quality — could each proof PASS while the thing it claims is FALSE?
---

# Cross-AI Plan Review — Phase 0 (Round 2, post-`--reviews` replan)

Round 2 reviews the plans **after** round 1's findings were folded in. Locked axioms (so the crew
couldn't re-derive round 1's already-falsified claims): (1) `Napi::SharedArrayBuffer` is
experimental-gated — settled, not re-litigated; (2) Electron `postMessage` transfer list accepts
only `MessagePortMain[]`, SAB rides in `message`; (3) the utility process is a separate OS process.
Each reviewer got a different open question. The strongest results: **Cursor's primary-source
verdict that the whole live-sync premise rests on an unproven (and likely-false) cross-process SAB
share**, and **two independent HIGH findings that FND-02's "no-compiler distribution" proof is
circular** (Sonnet + Opus). Round-1 fixes are confirmed to have held (Codex + the plan-checker).

---

## Cursor Review — primary-source: is utility→renderer SAB sharing real?

**Verdict: DEPENDS / not confirmable as SHARED. Primary sources lean THROWS or COPY, not SHARED.**

- **HTML structured-clone + agent clusters:** serializing a `SharedArrayBuffer` reuses the same
  backing block **only within one agent cluster**; across *different* clusters it throws
  `DataCloneError` — there is **no spec'd "clone into an independent SAB copy" fallback**. A
  `crossOriginIsolated` renderer is a web agent in that model; an Electron utility process
  (`process.parentPort`, separate OS child) is **not** in the renderer's cluster.
- **Node:** docs promise SAB sharing **between threads of the same process** only — not across
  `utilityProcess.fork()` separate OS processes.
- **Electron:** documents the IPC *shape* (SAB in `message` via structured clone — axiom 2 is
  correct in revised 00-03) but **never** documents utility→renderer backing-store sharing;
  ecosystem zero-copy patterns are overwhelmingly **main↔renderer**, not **utility↔renderer**.
- **COOP/COEP asymmetry:** `crossOriginIsolated === true` is a renderer *eligibility gate* for
  using SAB; it does **not** unify the utility process into the renderer's agent cluster.

**Likely boundary outcomes:** THROWS (`sab-ready` relay fails before any sentinel test) or COPY
(`0xDEAD` read passes; cross-write *should fail*). SHARED is the **unlikely** outcome per primary
sources. **D-04's "C++ in utility, renderer reads same memory at 60fps" is an empirical de-risk,
not a foregone conclusion — the Phase 0 experiment is the right call.**

**Concerns**
- **C-01 (HIGH)** — utility→renderer same-backing-store is undocumented / not confirmable; the
  D-04 live-sync premise depends on the experiment, not on API guarantees.
- **C-02 (HIGH)** — RESEARCH Pattern 1 / `docs/00-overview/architecture.md` /
  `docs/04-live-sync/live-memory-and-ipc.md` assume zero-copy utility→renderer **without citing
  the boundary**; treat as unverified hypothesis until 00-03 cross-write passes in dev *and* 00-05
  packaged. (Per AGENTS.md, these docs should carry an "unverified" caveat until proven.)
- **C-03 (MEDIUM)** — cross-write lacks `Atomics`; real sharing could *rarely* false-fail on
  weakly-ordered paths. *(NOTE: Opus disagrees — see Divergent Views. Opus's IPC-ordering argument
  is the stronger one; net resolution is "plain writes are correct here, pin the invariant.")*
- **C-04 (MEDIUM)** — architecture tension: `docs/04-live-sync` allocates the SAB in TS and passes
  into C++, while D-02 puts C++ in the utility. If utility↔renderer sharing fails, live-sync must
  pivot (OS shared memory, main-owned buffer, or drop the utility from the hot path).
- **C-05 (LOW)** — `must_haves` "MessagePort used for cross-write ack" is false on static trace
  (converges with Codex).

**Validated:** the cross-write test **correctly detects a copy-only outcome (AIRTIGHT vs
false-pass)** — it re-reads `view[RENDER_IDX]`, not the echoed arg, so a copy fails loudly.

**Risk: HIGH** on the live-sync premise — but as an *unknown to retire*, not a plan defect.

---

## Codex Review — cross-plan wiring re-trace (port topology + fix consistency)

**Port-Topology Verdict — HIGH: `port1`/`port2` are dead wiring for the cross-write ack as
specified.** The real flow: renderer `ipcRenderer.invoke('cross-write-sab')` → main
`ipcMain.handle` → `worker.postMessage({type:'cross-write',id,value})` → utility replies via
`process.parentPort.postMessage({type:'sab-cross-write-ack',...})` → main demux → resolves the
renderer invoke. The transferred `MessagePort` is **never used**. The cross-write proof is still
real (it tests SAB sharing), but three claims are **false** and must be corrected:
- `must_haves.truth` "The transferred MessagePort is USED (carries the cross-write ack)" (L32)
- the `key_link` "cross-write ack over the live port" (L57)
- the interface prose saying the port carries the ack (L101)

**Fix:** either route `crossWriteSab()` over `port1`/`port2` (utility replies on its port), **or**
drop the "port is used" truth/key_link and describe the real route
(`ipcRenderer.invoke → ipcMain.handle → utility parentPort → main demux → invoke response`).

**Secondary checks**
- **MEDIUM** — contracts omit the correlation `id`: Plan 01 defines `HelloRequest`/`HelloResponse`/
  `SabCrossWriteAck` **without `id`**, but Plan 03's demux requires `id` on `hello`/`pong`/
  `cross-write`/`sab-cross-write-ack`. Add `id` fields to contracts, or define internal
  worker-message types. (Type gap — would force untyped `id` access.)
- **LOW/PASS** — Vite worker path is a single source of truth (`packages/backend/src/utility-worker.ts`
  in both 00-01 and 00-03). Round-1 `src/*` mismatch is gone.
- **PASS** — `__sabValue`/`__sabIsShared`/`__crossWriteOk` ownership consistent: StatusBar owns
  them (00-04), 00-05 only reads and explicitly forbids editing ViewportPanel.
- **PASS** — IPC literals align (`hello`,`pong`,`sab-ready`,`init-port`,`sab-cross-write-ack`,
  `cross-write`,`sab-port`). DAG acyclic; no same-wave file collisions; FND-01..05 all covered.

**Risk: MEDIUM** — one false wiring claim + one contract type gap; structure is otherwise sound.

---

## Sonnet Review — lateral (did the round-2 fixes overcorrect?)

**Summary: substantially right-sized.** The added machinery (`check-prereqs.js`, `.nvmrc`/
`engines`, CI scoped to non-packaged gates, prebuildify/node-gyp-build, `package:ci`, real
close/relaunch restart) each maps to a genuine Phase-0 unknown or a previously-absent hygiene
requirement — not speculative future-proofing. The 17-file 00-04 count matches the locked UI-SPEC
deliverables (5 themes, 4 panel stubs, chrome, CSS tokens), not invented polish.

**Concerns**
- **HIGH — FND-02 prebuild proof is circular on the same dev machine.** prebuilds/ is generated by
  prebuildify with MSVC present, then "no-compiler distribution" is "proven" by node-gyp-build
  resolving it on that same box with `build/Release` co-resident. That reduces to "node-gyp-build
  found a file I just placed." **Fix:** after prebuildify, `rm`/rename `build/` and re-run the
  suite — it must pass through `prebuilds/` alone (one-line verify step), or honestly downgrade the
  SUMMARY wording to "same-machine smoke test only."
- **MEDIUM — 00-03 is `autonomous: true` despite being the empirically riskiest plan.** It wires
  COOP/COEP ordering, the port transfer, the demux, and the cross-write — the plan most likely to
  surface the architecture-altering "SAB is copy-only at the utility boundary" finding. Running it
  unattended until 00-05 means 00-04's 17 files get built atop a possibly-false wiring model.
  **Fix:** make 00-03 `autonomous: false` with a checkpoint that stops if `__crossWriteOk` is false
  before 00-04 begins.
- **MEDIUM — correlation-id resolver leak.** `pendingHello`/`pendingCrossWrite` Maps are never
  cleaned up if the utility crashes mid-request → the renderer's `hello()`/`crossWriteSab()` hangs
  forever with no error. The whole point of the utility process is crash isolation, so this is a
  real path. **Fix (~4 lines):** on utility `exit`, reject all pending promises. Or tag as an
  explicitly-deferred Phase-0 gap in the threat model.
- **LOW — `file://` COOP/COEP fallback** has no decision criteria among its three strategies
  (`onHeadersReceived` for file://, `protocol.handle('app://')`, `<meta>`) — add a priority ladder.
- **LOW — 00-01 Task 4 human gate asks to confirm `pnpm start` boots**, but `main.ts` doesn't exist
  until 00-03 → false-fail risk. Replace with `pnpm install` + `check-prereqs.js`, or add a stub
  `main.ts` to 00-01.

**Risk: MEDIUM** — right-sized; ship after the HIGH and two MEDIUMs are addressed or acknowledged.

---

## Opus Review — proof quality (could a proof PASS while its claim is FALSE?)

| Proof | Verdict | Failure path if not airtight |
|---|---|---|
| Cross-write — Atomics/ordering | **AIRTIGHT** | IPC round-trip *is* the happens-before edge; read is IPC-triggered after the write; plain writes correct, Atomics not needed |
| Cross-write — shared-vs-copy logic | **PROXY → AIRTIGHT w/ nonce** | Utility echoing `event.data.value` instead of reading `view[1]` passes in a copy-only world (assertion compares against the same `0xBEEF` literal it sent) |
| FND-02 no-compiler distribution | **PROXY** | Prebuild built with MSVC present + `build/Release` co-resident; green can't prove load came from `prebuilds/` or that no compiler was needed; Electron-ABI never exercised except in a skippable spec |
| SC-5 real restart | **AIRTIGHT (mech) / PROXY (env)** | Injected `userDataDir` masks a production "writes to default-temp / non-persisted path" bug; no test covers the default path |
| Preload allowlist | **PROXY** | `grep -c exposeInMainWorld == 1` passes for one fat exposure; no `Object.keys(window.api)` check |
| SC-3 packaged file:// | **PROXY** | The production-path proof lives in a `test.skip`-able spec; suite stays green when it skips |

**On Atomics (the flagged question):** does **not** apply — the utility's re-read is causally
ordered after the renderer's write by a four-hop serialized IPC chain; there is no concurrent
reader racing the writer. `Atomics` would be belt-and-suspenders; its absence is **not** a flake
source. (Pin the invariant "utility reads view[1] only on-demand after the IPC message" in a
comment so a future refactor can't silently break it.) **The untouched-slot choice is genuinely
clever** — a fresh copy reads 0 (C++ only writes view[0]), so it can't collide with 0xBEEF.

**HIGH** — FND-02 is the weakest proof in the phase **and the Nyquist sign-off (00-05 Task 4)
explicitly calls it "proven."** Either add the `rm -rf build/` + PATH-scrub (or move-build-aside +
assert loaded path) re-resolution, or downgrade the wording. **Do not let Task 4 flip
`nyquist_compliant: true` on the current proxy.** Compounded: unit tests run under bare Node/vitest
but the binary that matters loads under **Electron's ABI** — the only place that's exercised is the
skippable 05-packaged spec.

**MEDIUM** — (1) cross-write **echo-shortcut** false-pass: renderer should write a **nonce the
utility is never told over IPC** and assert against it (one-line change, closes the only false-pass
in the heart-of-the-phase proof). (2) SC-5 `userDataDir` masking — assert against the real
`app.getPath('userData')` or add a packaged restart-persistence check. (3) **Skippable production
gates**: 05-packaged (SC-3 file:// + cross-write-in-binary + Electron-ABI) can silently skip → CI/
checkpoint must treat a **skip as a fail**. (4) Preload allowlist proven by grep, not by
enumerating `window.api` keys → add `Object.keys(window.api)` membership assertion to 01-boot.

**LOW** — pin the IPC-ordering invariant in a comment; distinguish "cross-write timeout (no port)"
from "=== false" in triage.

**Risk: MEDIUM** — SC-4 cross-write is a well-designed discriminator held back only by the one-line
echo hole; **FND-02 is a proxy dressed as a proof and the Nyquist gate certifies it.** Do not pass
Nyquist sign-off until FND-02 is tightened/downgraded and the nonce hardening lands; the single
most important structural fix is making the skippable packaged spec a hard gate.

---

## Consensus Summary

### Agreed strengths (2+ reviewers)
- **The cross-write test is the correct shared-vs-copy discriminator and fails loudly on a copy**
  (Cursor + Opus, independently; the untouched-slot design praised by Opus).
- **Round-1 fixes held** — Vite worker path single-source, `__sabValue` single owner, DAG/coverage
  clean (Codex), and the phase is right-sized, not over-engineered (Sonnet).
- **The packaged-binary proof remains the highest-value de-risk** (carried over from round 1).

### Agreed concerns (raised independently by 2+ — highest priority)
1. **🔴 FND-02 "no-compiler distribution" proof is circular / a PROXY (Sonnet HIGH + Opus HIGH).**
   Built with MSVC present, resolved on the same box with `build/Release` co-resident; the green
   test can't prove the load came from `prebuilds/` or that no compiler was needed. Worse, the
   Nyquist sign-off certifies it "proven." **Fix:** `rm`/move `build/` (+ scrub MSVC from PATH) and
   re-resolve through `prebuilds/` alone, exercising the **Electron ABI** — or honestly downgrade
   the success-criterion + Nyquist wording.
2. **🔴 The transferred `MessagePort` is dead wiring; the "port is used" claims are false (Codex
   HIGH + Cursor C-05 + the prior plan-checker WARNING — 3 sources).** Correct the `must_haves`
   truth/key_link/interface prose, or actually route the cross-write over the port.
3. **🟠 The utility→renderer SAB-sharing premise (D-04/FND-03) is unproven and primary sources lean
   against it (Cursor HIGH; Sonnet's autonomy concern is the operational corollary).** This is the
   phase's reason to exist — but it must be treated as a *likely-negative experiment*: 00-03 should
   be `autonomous: false`, a failing cross-write must **block** (not silently green) the
   Nyquist/SUMMARY "live-sync proven" claim, and the architecture-pivot contingency (OS shm /
   main-owned buffer / drop utility from hot path) should be written down now.
4. **🟠 Production-path proofs hide behind a skippable spec (Opus MEDIUM, aligned w/ Cursor C-02).**
   05-packaged carries SC-3 file://, cross-write-in-binary, and the only Electron-ABI exercise —
   yet it can `test.skip`. CI/checkpoint must treat a skip as a fail.

### Divergent / single-reviewer findings worth carrying
- **DIVERGENCE — Atomics (Cursor C-03 MEDIUM vs Opus AIRTIGHT).** Cursor flags missing `Atomics` as
  a flake risk; Opus argues the IPC round-trip supplies the happens-before edge so plain writes are
  correct and demanding Atomics misdiagnoses the ordering. **Resolution: Opus is right for the
  current on-demand-after-IPC design** — keep plain writes, pin the invariant in a comment; only add
  Atomics if real flakes appear or the read ever becomes concurrent. (This is the productive split
  the de-anchoring protocol is meant to produce.)
- **Opus (MEDIUM, sharp):** cross-write **echo-shortcut false-pass** — assert against a nonce the
  utility is never told over IPC. The only false-pass left in the core proof.
- **Codex (MEDIUM):** contracts omit the `id` correlation field the runtime demux requires.
- **Sonnet (MEDIUM):** correlation-id resolver leak — reject pending promises on utility exit.
- **Opus (MEDIUM):** SC-5 injected `userDataDir` can mask a production non-persistent-path bug.
- **Opus (MEDIUM):** preload allowlist proven by grep, not by `Object.keys(window.api)`.
- **Sonnet (LOW):** 00-01 `pnpm start` human gate can't pass yet (no `main.ts` until 00-03).
- **Cursor (C-02):** `docs/00-overview/architecture.md` + `docs/04-live-sync/live-memory-and-ipc.md`
  assert zero-copy without citing the utility↔renderer boundary → mark unverified (AGENTS.md rule).

### Overall risk: **MEDIUM**
No verified-wrong *compile* blocker this round (round 1's NAPI_EXPERIMENTAL is fixed and confirmed).
The plans are well-structured and most round-1 fixes held. What remains: **two HIGH proof-integrity
issues** (FND-02 proxy + the Nyquist gate that would certify it), **one genuine architecture unknown
the phase is correctly built to surface** (utility→renderer SAB sharing, likely-negative), and a set
of MEDIUM tightening fixes — all addressable inside the existing plan structure.

---

## Recommended actions before executing Phase 0 (priority order)
1. **[HIGH]** FND-02: add a non-circular proof (`rm`/move `build/` + scrub MSVC from PATH, re-resolve
   through `prebuilds/` alone, against the **Electron ABI**) **or** downgrade the success-criterion +
   Nyquist wording. Do not let 00-05 Task 4 flip `nyquist_compliant: true` on a proxy.
2. **[HIGH]** Make 05-packaged a **hard gate** (skip = fail) in CI + the human checkpoint — it's the
   only place SC-3 file://, cross-write-in-binary, and the Electron-ABI prebuild are exercised.
3. **[HIGH / architecture]** Treat utility→renderer SAB sharing as a likely-negative experiment:
   00-03 → `autonomous: false`; a failing cross-write must block the "live-sync proven" claim; write
   the pivot contingency (OS shm / main-owned buffer / drop utility from hot path) into CONTEXT now;
   consider a ~30-line SAB-sharing spike **before** 00-04's 17 files.
4. **[MEDIUM]** Cross-write **nonce** hardening (close the echo-shortcut false-pass).
5. **[MEDIUM]** Correct the **port-topology** claims (drop "port is used", or route the ack over
   `port1`/`port2`). Add the `id` correlation field to contracts. Reject pending promises on utility
   exit. Add `Object.keys(window.api)` allowlist assertion. Assert SC-5 against the real userData
   path. Fix the 00-01 `pnpm start` gate.
6. **[LOW]** Keep plain writes (no Atomics) but pin the IPC-ordering invariant in a comment; add a
   `file://` fallback priority ladder; distinguish cross-write timeout vs `=== false` in triage;
   mark the `docs/` zero-copy assumptions unverified until the experiment resolves.

To incorporate this feedback into the plans:
```
/gsd:plan-phase 0 --reviews
```
