# Phase 0 REPLAN (draft — pending review, NOT yet executed)

**Trigger:** the 00-03 architecture gate falsified the SAB-sharing model. **Evidence:**
[CONSULT-P0SAB-SYNTHESIS.md](../../research/CONSULT-P0SAB-SYNTHESIS.md) (4-way cross-AI convergence + measured perf).
**Decisions taken with the maintainer:** (1) spike transport A vs B head-to-head in Phase 0 and pick on
data; (2) draft this replan and PAUSE before executing.

> Status of existing work: **00-01 and 00-02 stand** (monorepo, contracts, native addon, non-circular
> prebuild — all verified). The three Electron-launch infra fixes are committed. 00-03's current
> `main.ts`/`preload.ts`/`utility-worker.ts` are committed but will be **rewritten** by this replan.

---

## 1. Revised decisions (proposed — replaces the LOCKED D-02/D-04)

- **D-02 (was: "native addon in a dedicated utility process, never main/renderer").**
  → **Revise:** addon *placement* is now transport-dependent and is the subject of the 00-03 spike.
  Path A keeps the addon in the utility process (sandbox preserved). Path B colocates the addon in a
  `sandbox:false` renderer/worker for true zero-copy. The Phase-0 spike decides; the loser is documented
  as the alternate for Phase 3.
- **D-04 (was: "real zero-copy SAB round-trip, proven by same-memory cross-write").**
  → **FALSIFIED as written** (cross-process SAB sharing is impossible in Electron 42 — proven). **Revise to:**
  "native bytes reach the renderer via the transport chosen by the 00-03 spike; *true* zero-copy is
  available only via native-in-renderer (Path B)." The same-memory nonce cross-write proof is **removed**.

## 2. Doc corrections to apply (first execution step — flip UNVERIFIED → FALSIFIED + correct transport)

| File | Change |
|---|---|
| `docs/00-overview/architecture.md` | SAB data-channel + caveat: mark utility/main→renderer SAB sharing **FALSIFIED** (cite synthesis); replace with the two real transports (copy-deltas / native-in-renderer); keep the pivot ladder, corrected. |
| `docs/04-live-sync/live-memory-and-ipc.md` | Same correction; note cross-process `ArrayBuffer` is a **copy** (~450 MB/s measured), not a move. |
| `00-RESEARCH.md` "State of the Art" table | Fix the `MessageChannelMain + SharedArrayBuffer transferred | Electron 14+ | Zero-copy` row: Electron 14+ added **port** transfer, NOT cross-process SAB; cross-process AB = copy. |
| `00-CONTEXT.md` | Update D-02/D-04 per §1. |

## 3. Rewritten 00-03 — "Native→renderer transport: measure A vs B, then build the winner"

`autonomous: false` (one decision checkpoint). Requirements: FND-01, FND-03 (re-scoped).

- **Task 1 — A/B spike harness.** Measure, frame-paced, on representative payloads
  (64 KB / 256 KB / 1 MB / 4 MB delta + a 16 MB full-frame):
  - **A (sandboxed copy):** C++ (utility) writes bytes → `ArrayBuffer` copied to a `sandbox:true`
    renderer over MessagePort. Record MB/s, ms/frame, max sustainable fps, and `sourceDetached` (= copy).
  - **B (native-in-renderer):** addon loaded in a `sandbox:false` renderer (or its Worker), allocates the
    SAB in-process, writes; renderer reads the **same memory** (assert a renderer write is visible to a
    C++ re-read = true zero-copy). Confirm `crossOriginIsolated` still holds and the SAB is shareable with
    a Web Worker. Record read latency.
  - Output a results table to `00-VALIDATION.md` (or `00-SPIKE-RESULTS.md`).
- **Task 2 — Transport decision checkpoint (`checkpoint:decision`, blocking).** Present the A/B numbers;
  maintainer picks the Phase-0 transport (recommended default: **A** for the general pipeline + **B**
  documented as the hot-path option). Records the choice + rationale.
- **Task 3 — Implement the chosen transport.** Rewrite `main.ts`/`preload.ts`/`utility-worker.ts` for the
  winner. Keep COOP/COEP, `crossOriginIsolated`, contextIsolation (A), the narrow preload bridge, and the
  demux/correlation-id/reject-on-exit machinery (still needed for the IPC path). **New proof (replaces the
  nonce cross-write):**
  - A: renderer receives an `ArrayBuffer` (instanceof) carrying the exact C++-written pattern (0xDEAD
    sentinel + a C++-written per-run nonce verified in the renderer) → native→renderer delivery proven;
    copy semantics acknowledged via `sourceDetached`.
  - B: renderer (in-process addon) reads the C++-written SAB; a renderer write is visible to a C++ re-read
    → true same-memory zero-copy proven.

## 4. Rewritten 00-04 — Dark dockable shell (unchanged) + transport-proof StatusBar

FND-05 shell work is unaffected. Only the StatusBar's SAB-hooks change: replace the nonce-cross-write
driver with the **chosen-transport proof driver** + a live throughput/transport-status indicator. The
`window.__*` test-hook contract is updated to the new proof (delivery-ok / transport / MB/s).

## 5. Rewritten 00-05 — E2E proof of the chosen transport + Nyquist

`03-sab-roundtrip.spec.ts` → assert the **chosen-transport** proof through the real pipeline (correct
bytes for A; same-memory for B), dev **and** packaged. Other specs (boot/isolation/workspace/packaged
hard gate) stand. Nyquist sign-off certifies only what's proven: native→renderer delivery via transport
X (+ FND-02 as already proven) — **never** cross-process SAB.

## 6. What stays
00-01, 00-02 unchanged. COOP/COEP + `crossOriginIsolated` + the packaged hard gate + the FND-02
non-circular prebuild proof all remain valid and reused.

---

---

## DECISION (2026-06-22) — Path B chosen (native-in-renderer, revise FND-01)

Spike run on a throwaway `sandbox:false` harness over an http (COI) origin. **Measured A vs B:**

| | A (sandboxed IPC copy) | B (native-in-renderer) |
|---|---|---|
| Throughput | ~450 MB/s, **copy**, scales w/ payload | **~10,600 MB/s**, zero-copy, in-process |
| 60fps | OK ≤1 MB/frame; fails ≥16 MB | OK at any realistic payload |
| Posture | contextIsolation+sandbox, native-in-utility | sandbox:false, native loads in renderer |
| FND-01 | ✅ | ❌ violated (Node/native in renderer) |
| Crash isolation | utility crash spares renderer | native crash takes renderer |

B confirmed working: addon loads in renderer, `allocateSab` → in-process SAB, `crossOriginIsolated=true`
(COOP/COEP over http origin), renderer reads/writes directly, **Web Worker shares the same C++ SAB**.

**Maintainer decision: adopt B as the PRIMARY transport; explicitly revise FND-01.**

### Consequences for the B-based replan
- **FND-01** ("renderer calls native only via a narrow validated preload bridge; no Node in renderer")
  is **revised**: native code now runs in the renderer process. To minimize the security loss, the
  implementation MUST try the *least-insecure working* B posture first and document which holds:
  1. **Preferred:** `sandbox:false` + `contextIsolation:true` + `nodeIntegration:false`, with a **preload**
     (runs with Node because sandbox:false) that `require`s the addon and exposes a narrow API + the SAB to
     the isolated main world via `contextBridge`. Keeps the isolated world + narrow surface (most of FND-01's
     intent) while achieving in-process zero-copy. **Verify a C++ SAB survives the contextBridge hand-off.**
  2. **Fallback (proven):** `sandbox:false` + `nodeIntegration:true` + `contextIsolation:false` (full Node
     in the renderer main world). Use only if (1) cannot share the SAB across the contextBridge boundary.
  Document the chosen posture + the exact revised FND-01 text + the residual risk + COI requirement
  (COOP/COEP still mandatory; COI is independent of sandbox).
- **D-02** (native in a dedicated utility process) — **dropped** for the SAB path; the addon loads in the
  renderer. The utility process is no longer on the data path (may be retained later for crash-isolated
  parsing, out of Phase-0 scope).
- **D-04** — proof becomes a true **in-process same-memory** round-trip: C++ writes a sentinel into the SAB
  → renderer reads it; renderer writes a per-run nonce → a native re-read sees it. Add the two small addon
  exports needed (`writeSab`/`readSab` or equivalent) to 00-02's `native-core` to drive the bidirectional proof.
- **00-03** rewrite: main creates the COI renderer (chosen B posture, COOP/COEP before load); renderer/preload
  loads the addon, allocates the SAB, runs the same-memory proof, shares it with a Web Worker. Remove the
  utility-fork SAB relay + the cross-process nonce machinery.
- **00-04**: StatusBar reads the in-renderer SAB directly (no IPC relay) + shows the zero-copy proof status.
- **00-05**: SC-4 spec asserts the in-process same-memory proof (dev + packaged). Nyquist certifies B zero-copy.
- **Docs**: apply the §2 corrections AND record the FND-01 revision in `REQUIREMENTS.md` + `00-CONTEXT.md`.
