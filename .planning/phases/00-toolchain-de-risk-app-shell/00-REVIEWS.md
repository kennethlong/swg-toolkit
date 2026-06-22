---
phase: 0
round: 3
reviewers: [codex, cursor, sonnet, opus]
reviewed_at: 2026-06-21
plans_reviewed:
  - 00-01-PLAN.md
  - 00-02-PLAN.md
  - 00-03-PLAN.md
  - 00-04-PLAN.md
  - 00-05-PLAN.md
review_method: cross-AI consult crew (CLAUDE.md), de-anchoring protocol — adversarial round-3 angles aimed at what two rounds of layered edits could have broken or left as proxy (deliberately anti-echo)
prior_rounds: 00-REVIEWS-r1.md (round 1), 00-REVIEWS-r2.md (round 2)
angles:
  cursor: primary-source check of a NEW round-2 claim — "prebuild targets the Electron 42 ABI"
  codex: delta re-trace of the six round-2 fixes for contradictions / hang paths
  sonnet: lateral — over-fitting from layered edits + fail-fast economics of the likely-negative SAB experiment
  opus: proof quality — any residual proxy after two rounds + Nyquist independence + FND-02 wording drift
---

# Cross-AI Plan Review — Phase 0 (Round 3)

Round 3 deliberately hunted for what two rounds of revision could have BROKEN or left as proxy
(anti-echo: each reviewer was told a clean PASS is a valid result, not to manufacture concerns).
The loop has largely **converged**: Opus returns GO on proof quality, Codex finds no hang path,
Sonnet judges the plans right-sized with no execution-delaying restructure. The one substantive new
finding is **Cursor's — a third de-anchoring catch**: the round-2 replan introduced a NEW
plausible-but-wrong claim ("the prebuild targets the Electron 42 ABI") that N-API ABI-stability makes
a category error. None of the round-3 findings are correctness blockers; all are wording/wiring/
economics refinements.

---

## Cursor Review — primary-source: is the "Electron 42 ABI prebuild" claim real?

**Verdict: OVER-ENGINEERED — N-API makes a separate "Electron 42 ABI" prebuild moot. (HIGH wording /
threat-model category error; implementation risk only if someone follows the @electron/rebuild path
literally.)**

For a pure `node-addon-api` / `NODE_API_MODULE` addon built with `prebuildify --napi`, **N-API is
ABI-stable across Node *and* Electron** — one `prebuilds/<platform>-<arch>/` artifact loads in both
bare-Node (vitest) and Electron's utility process **without recompilation**. There is **no separate
Electron `MODULE_VERSION` prebuild** to produce or exercise. Primary sources: Node `n-api.md` (ABI
stable across majors, runs without recompilation); node-gyp-build (`tags.abi` is ignored when the
`napi` tag is present; `runtimeAgnostic` accepts a `node.napi.node` under Electron); prebuildify
README ("compatible with Electron > 3"; with N-API you produce prebuilds per *runtime* — node vs
electron — **not** per Electron ABI integer).

**Category error in the plans:** FND-02 / 00-02 Task 3 / threat T-00-21 / the 00-05 Nyquist bullet
treat "Electron 42 ABI" like a `process.versions.modules` prebuild tag. That model applies to
*non-N-API* addons (`electron.abi127.node`). This addon is `NODE_API_MODULE` + `NAPI_VERSION=8` +
`prebuildify --napi` — the N-API stability model, where the Electron-vs-Node ABI distinction is
intentionally erased at the binary level. `@electron/rebuild` (cited as "required after npm install")
is belt-and-suspenders for *legacy* ABI-tagged modules, not a requirement here.

**What stays correct (do NOT remove):**
- prebuildify → `prebuilds/` → `index.js` → node-gyp-build as the single FND-02 resolution path.
- The non-circular proof (move `build/`→`build.bak`, assert `__resolvedPath` under `prebuilds/`) —
  **valid regardless of N-API framing.**
- 05-packaged as a HARD gate — but reframed as proof of **packaged-Electron runtime load**, not proof
  of a distinct Electron-ABI artifact.

**Concerns**
- **CUR-1 (HIGH)** — drop/replace the "Electron 42 ABI prebuild" language (FND-02, 00-02 Task 3,
  T-00-21, 00-05 Nyquist, RESEARCH FND-02 row) with: *"Produce an N-API (`--napi`) prebuild; prove
  non-circular resolution by moving `build/` aside; prove Electron runtime load in the 05-packaged
  gate (same binary — no separate Electron MODULE_VERSION prebuild)."* Reframe T-00-21 from "ABI
  mismatch" to "prebuild missing / dlopen failure / experimental header feature unavailable."
- **CUR-2 (MEDIUM)** — **prebuildify drives `node-gyp`, not `cmake-js`** (per prebuildify `build()`),
  but 00-02 Task 3 says "prebuildify with the cmake-js backend." This is a real **build-backend
  wiring** gap: prebuildify may not drive a cmake-js-built addon out of the box. Resolve the
  mechanism (a cmake-js-native prebuild step that emits the `prebuilds/` layout, or a verified
  prebuildify+cmake-js path) before relying on it. *(Most actionable round-3 finding — could bite at
  00-02 execution.)*
- **CUR-3 (MEDIUM)** — `NAPI_EXPERIMENTAL` / `node_api_create_sharedarraybuffer` availability in
  **Electron 42's embedded Node headers** is a compile/header risk (distinct from ABI). Confirm the
  symbol exists in Electron 42's Node header set, not just bare Node v24.9+.
- **CUR-4 (LOW)** — filename detail: `--napi` emits `prebuilds/<plat>-<arch>/@swg+native-core.node`,
  not `<abi>.node`; the 00-02 Task 3 wording is imprecise (the `__resolvedPath` proof is unaffected).

**Risk: MEDIUM** — a wording category error + one real backend-wiring gap (CUR-2). The FND-02 proof
*structure* is sound.

---

## Codex Review — delta re-trace of the six round-2 fixes

**Verdict: No HANG path found. Deltas internally consistent except one trivial grep-vs-comment
contradiction.**

- **Delta 1 (argless `crossWriteSab` + nonce) — LOW FAIL.** Behavior is consistent (preload argless;
  main forwards no value; StatusBar keeps the nonce in local scope and compares `echoed === nonce`).
  BUT 00-03 instructs implementers to include a *comment* containing `event.data.value`, while the
  verify gate requires `grep -c 'event.data.value' == 0`. If the instructed comment is written
  literally, the plan's own gate fails. Fix: reword the comment guidance so it doesn't contain the
  banned token (or relax the grep to target code, not comments).
- **Delta 2 (`id` correlation) — PASS.** The worker echoes `event.data.id` on BOTH reply paths
  (`pong` and `sab-cross-write-ack`). No missing-`id` unresolved-promise hang.
- **Delta 3 (`build.bak` move) — PASS.** Build in Task 2; `build/` moved only inside Task 4's proof
  and restored in `afterAll/finally`; human checkpoint verifies restoration; 00-05 packaging is
  out-of-band via `package:ci`. No window where `build/` is absent when something needs it.
- **Delta 4 (early canary + architecture-gate DAG) — PASS.** 00-03 (wave 2, depends [01,02]) holds a
  blocking cross-write checkpoint; 00-04 (wave 3) depends on 00-03. Gate genuinely precedes the
  17-file wave. No same-wave file collision.
- **Delta 5 (`__crossWriteState` enum) — PASS.** Set to shared/copy/error and read consistently in
  dev + packaged E2E; legacy `__crossWriteOk` is only read alongside `state === 'shared'`, no
  contradiction.

**Risk: LOW** — one cosmetic plan-internal contradiction; the round-2 edits are otherwise sound.

---

## Sonnet Review — lateral (over-fitting + fail-fast economics)

**Verdict A (over-fitted?): right-sized overall — MEDIUM, two trims.** The added machinery
(non-circular FND-02 proof, correlation-id demux, reject-on-exit, nonce hardening, single-owner SAB
hook) genuinely earns its keep; no contradictory acceptance criteria across plans; the inline
review-tag archaeology is verbose comments, not real complexity.
- **SON-A (MEDIUM)** — the early canary in `utility-worker.ts` is mildly redundant with 00-02's unit
  tests (both prove allocation; neither proves sharing). Trim opportunity, not a blocker.
- **SON-B (LOW)** — the CI "parse reporter for ≥3 assertions" guard is fragile; Playwright's
  `--forbid-only` is the standard mechanism for the same "nothing silently skipped" protection.

**Verdict B (fail-fast?): gate placement correct — HIGH economics issue + one underspecified pivot.**
- **SON-C (HIGH)** — the full **packaged-gate CI apparatus** (`package:ci` + `PACKAGED_EXE_PATH` +
  reporter-parse) is laid down **unconditionally in 00-01**, before the cross-write experiment
  resolves. If the experiment fails at the 00-03 architecture gate, that CI machinery is dead-on-
  arrival and must be re-specified after the pivot. Fix (cheap, no delay): split CI into (a) a lean
  scaffold+unit job (always required) and (b) a packaged-gate job added/gated only after the 00-03
  gate confirms the experiment survived. *(The architecture gate itself is correctly placed before
  00-04 — this is purely about not pre-investing the dependent CI.)*
- **SON-D (LOW)** — pivot option 2 (OS shared memory) is named but not actionable (no API/package/
  mechanism). Acceptable since option 1 (main-owned SAB) is the correct first pivot and is
  well-specified, but flag it.

**Risk: MEDIUM** — neither verdict calls for an execution-delaying restructure; SON-C is a one-line
CI conditional + a note.

---

## Opus Review — proof quality (residual proxy / Nyquist independence / FND-02 drift)

**Verdict: GO on proof quality. No criterion remains PROXY / FLAKY / FALSE-PASSABLE after two rounds.**

Residual-proxy sweep — every SC has a behavioral assertion; the remaining source greps
(`worker.once`==0, `event.data.value`==0, `0xBEEF`==0, `page.reload`==0) are *guards on the proof
method*, not the proof itself:
- **SC-1 / preload allowlist** — `Object.keys(window.api).sort() === ['crossWriteSab','hello','onSabPort']`
  is AIRTIGHT (enumerates the runtime surface; the old grep proxy is retired).
- **SC-4 cross-write (nonce)** — AIRTIGHT: the per-run nonce defeats both remaining false-pass worlds
  — a copy reads stale/zero `view[1]` → `'copy'` → fail; an arg-echo world has nothing to echo
  (argless IPC). Strongest proof in the phase.
- **FND-02 non-circular resolve** — AIRTIGHT *for what it claims* (resolution non-circularity, not
  "no compiler present" — which the plan explicitly doesn't claim).
- **SC-3 packaged + 05 skip=fail** — AIRTIGHT: skip→fail enforced two ways (env-var removes the skip
  branch; reporter-parse fails on 0 assertions), and the enforcement is itself an 00-01 acceptance
  criterion.
- **SC-5 real userData** — AIRTIGHT with one documented seam (the isolated-HOME carve-out is correct
  but a careless executor could regress to `--user-data-dir`). **OPUS-1 (LOW):** add a negative grep —
  `--user-data-dir` must NOT appear in 04-workspace.spec — to self-police the seam.

**Nyquist independence: INDEPENDENT (human-gated).** 00-05 Task 2 authors the tests + fills
VALIDATION.md; Task 4 is a separate `checkpoint:decision` that audits (writes no tests) and flips
`nyquist_compliant`. Residual seam: both tasks run in the same plan / same executor agent, so
independence leans on the **human** `signoff` resume-signal (which is present, `gate="blocking"`).
**OPUS-2 (LOW, optional):** route the flip through the phase-close `gsd-verifier` (a different agent)
for machine-independence rather than human-gated independence. Belt-and-suspenders.

**FND-02 wording-drift: NO DRIFT.** The 00-02 SUMMARY mandate and the 00-05 Nyquist bullet certify the
same two components (non-circular resolve + Electron-ABI packaged load) with the same explicit
exclusion (no no-compiler-machine proof); 00-05 hard-references "wording matches the 00-02 SUMMARY."
The literal FND-02 requirement is *narrower* than what's proven, so the honest downgrade doesn't
under-deliver, and no `must_haves`/`success_criterion` overclaims FND-02 as fully proven. Execution
cannot report "FND-02 done" on only the deferred-to-CI partial — both in-scope halves are gated green.
*(NOTE: Opus's "Electron-ABI load" framing here inherits the plan's wording, which Cursor CUR-1 shows
is a category error — the substance Opus verifies (packaged runtime load) is correct; only the label
needs fixing.)*

**Risk: LOW** — go on proof quality; two optional LOW hardening items.

---

## Consensus Summary

### Convergence — the loop has largely settled
Three of four reviewers independently signal the plans are **sound and execution-ready** after minor
fixes: Opus GO (no residual proxy, Nyquist independent, FND-02 no drift), Codex no-hang (5/5 deltas
consistent bar one cosmetic grep), Sonnet "right-sized, no execution-delaying restructure." This is
genuine convergence from divergent angles, not echo — each was tasked to break the plans and reports
back what little it found.

### Agreed / highest-priority concerns
1. **🟠 "Electron 42 ABI prebuild" is a category error (Cursor HIGH; Opus notes the same label is
   loose).** N-API is ABI-stable — one `--napi` prebuild serves Node + Electron. **Fix = wording**
   across FND-02 / 00-02 Task 3 / T-00-21 / 00-05 Nyquist / RESEARCH; the proof structure stays.
2. **🟠 prebuildify backend wiring (Cursor MEDIUM) — the one finding that could bite at execution.**
   prebuildify drives node-gyp, but the addon is cmake-js. Resolve the prebuild mechanism before
   00-02 relies on it (cmake-js-native prebuild emitting `prebuilds/`, or a verified path).
3. **🟠 Packaged-gate CI pre-invested before the experiment resolves (Sonnet HIGH).** Split CI into a
   lean always-on job + a packaged-gate job gated on the 00-03 architecture-gate outcome. One-line
   conditional; doesn't delay execution.

### Lower-priority / single-reviewer
- **Codex (LOW):** 00-03's "write a comment containing `event.data.value`" contradicts its own
  `grep -c 'event.data.value' == 0` gate — reword the comment guidance.
- **Cursor (MEDIUM):** confirm `NAPI_EXPERIMENTAL`/`node_api_create_sharedarraybuffer` exists in
  Electron 42's embedded Node headers (compile-time, distinct from ABI).
- **Sonnet (MEDIUM/LOW):** trim the redundant early canary; replace the CI assertion-count guard with
  Playwright `--forbid-only`; flesh out pivot option 2 (OS shm) or accept option 1 as the real first
  pivot.
- **Opus (LOW×2):** negative `--user-data-dir` grep in 04-workspace; optionally route the Nyquist
  flip through the phase-close verifier for machine-independence.
- **Cursor (LOW):** `--napi` prebuild filename is `@swg+native-core.node`, not `<abi>.node`.

### Divergence
Minimal this round — the productive disagreement was resolved in round 2 (Atomics: Opus's IPC-ordering
argument prevailed; plans keep plain writes). Round 3 reviewers largely agree; Cursor's HIGH is the
only finding that materially changes a plan claim, and it's a framing/wording correction plus one
wiring gap, not a contested judgment.

### Overall risk: **LOW–MEDIUM**
No correctness blocker, no hang path, no residual proxy, Nyquist independent, FND-02 wording internally
consistent. Remaining work: one wording category-error correction (Electron-ABI), one real
implementation-wiring gap to resolve (prebuildify vs cmake-js), one cheap CI-economics split, and a
handful of LOW polish items. The cross-AI loop has effectively converged — further rounds would be
low-yield; the only unknown left (does utility→renderer SAB actually share?) can only be resolved by
*executing* the experiment, which the plans are now correctly built to surface.

---

## Recommended actions (priority order)
1. **[HIGH — wording]** Replace "Electron 42 ABI prebuild" language with the N-API framing (one
   prebuild serves both runtimes; 05-packaged proves packaged-Electron *runtime load*, not a separate
   ABI artifact) across FND-02 / 00-02 Task 3 / T-00-21 / 00-05 Nyquist / RESEARCH FND-02 row.
2. **[MEDIUM — wiring, the one that bites]** Resolve the prebuildify-vs-cmake-js backend: specify a
   cmake-js-native prebuild step that emits the `prebuilds/<plat>-<arch>/` layout (or a verified
   prebuildify+cmake-js path). Confirm `NAPI_EXPERIMENTAL` SAB symbol exists in Electron 42 headers.
3. **[MEDIUM — economics]** Split CI: lean scaffold+unit job (always) + packaged-gate job gated on the
   00-03 architecture-gate outcome.
4. **[LOW]** Reword 00-03's `event.data.value` comment so it doesn't trip the grep gate; trim the
   redundant canary; swap the CI assertion-count guard for `--forbid-only`; add a negative
   `--user-data-dir` grep to 04-workspace; flesh out / accept pivot option 2; fix the `--napi`
   prebuild filename wording; optionally route the Nyquist flip through the phase-close verifier.

To incorporate this feedback into the plans:
```
/gsd:plan-phase 0 --reviews
```
(Or proceed to `/gsd:execute-phase 0` — the prebuildify backend gap (action 2) surfaces at 00-02,
which is already a blocking human checkpoint, and all remaining items are wording/economics/polish.)
