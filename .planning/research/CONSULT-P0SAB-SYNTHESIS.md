# Phase 0 SAB architecture — cross-AI consult synthesis & pivot decision

**Date:** 2026-06-22 · **Trigger:** 00-03 architecture gate · **Status:** finding CONFIRMED, pivot identified, perf measured

## The finding (measured at the 00-03 gate)

Sharing one `SharedArrayBuffer` backing store between an Electron **Node process (main or utility)**
and the **renderer** is **impossible in Electron 42** — every IPC/MessagePort mechanism throws
`Error: An object could not be cloned` for a SAB (plain-JS SAB, addon-independent), while plain objects
and `ArrayBuffer`s pass. This **falsifies locked decisions D-02 + D-04** and the `docs/` "MessageChannel +
SAB transfer = zero-copy" claim. The C++ N-API addon itself loads in the utility process and allocates
a working SAB (the allocation is fine; only the cross-process *transport* of a SAB is impossible).

## Four-way convergence (independent bases — de-anchoring protocol)

| Consultant | Basis | Verdict |
|---|---|---|
| Opus | ECMAScript/HTML spec + V8 cage/isolate-group | IMPOSSIBLE BY CONSTRUCTION (~0.97). SAB namable only within one agent cluster / process cage; Node main/utility are not in the renderer's cluster. |
| Cursor | Electron 42 `.d.ts` + C++ source | No supported mechanism. Transfer lists are `MessagePort`-only; the exact error string is in `shell/common/v8_util.cc` (`SerializeV8Value`). Knobs (COOP/COEP, sandbox, worker) don't change it. Nearest cross-proc primitive = experimental `sharedTexture` (GPU). |
| Codex | Real reference SWG tools (`../Utinni`, `../swg-client-v2`) | None use cross-process SAB. Utinni does live view by **DLL injection + in-process D3D9/ImGui**; asset bytes are copied as plain arrays. No Electron/CEF large-buffer IPC anywhere. |
| Sonnet | Lateral working transports | 6 viable transports, none needing cross-process SAB. Recommends transferable-`ArrayBuffer` over MessagePort + renderer-owned SAB for a parsing Worker. |

The spec-permitted zero-copy-*in-renderer* path (Opus): the **renderer** owns the SAB (shared only with
its own Web Worker; legal under crossOriginIsolated); native bytes arrive separately at the boundary.

## Performance reality (measured, Electron 42, utility→main, frame-paced ping-pong)

| Payload/frame | transfers/s | throughput | ms/transfer | move or copy |
|---|---|---|---|---|
| 256 KB | 1762 | 462 MB/s | 0.57 ms | **COPY** (`sourceDetached=false`) |
| 1 MB | 401 | 421 MB/s | 2.49 ms | **COPY** |
| 4 MB | 114 | 477 MB/s | 8.79 ms | **COPY** |
| 16 MB | 29 | 489 MB/s | 34.3 ms | **COPY** |

- The cross-process `ArrayBuffer` is **copied, not moved** (the "transferable move" the pivot assumed
  does not happen across Electron's process boundary — confirms Cursor: transfer lists are port-only).
- Boundary ceiling ≈ **450–490 MB/s**. Against a 60fps (16.6 ms) budget:
  - **≤ 1 MB/frame → comfortable 60fps** (≤2.5 ms, ≤15% of budget). Delta/changed-region sync fits here.
  - **4 MB/frame → marginal** (8.8 ms, ~53% of budget).
  - **≥ 16 MB/frame → cannot hit 60fps** (34 ms; ~29fps ceiling).

## Two transport options for the pivot (isolation ⇄ performance tradeoff)

**A. IPC copy (sandbox-preserving).** Utility owns the data; copy small **deltas (≤1–2 MB/frame)** to the
renderer over a MessagePort at ~450 MB/s; renderer owns a SAB shared with its parsing Web Worker. Keeps
utility crash-isolation + renderer sandbox. Good for delta-based live sync + bounded asset snapshots.
**Not** for large full-frame-every-frame streaming.

**B. Native-in-renderer (true zero-copy).** Run the C++ addon **in the renderer process** (`sandbox:false`
+ nodeIntegration for that window): C++ allocates the SAB in-process, the renderer reads the *same* memory
with **no IPC and no copy** — the original zero-copy intent. Cost: renderer runs native code (weaker
isolation; lose crash-isolation for that path). Acceptable for a **trusted desktop modding tool** — this
is the Utinni model (native + UI in one process). Reserve for the hot path / large payloads.

**Recommendation:** default to **A** for the general pipeline (preserves the security posture Phase 0 just
built), and keep **B** as the documented high-performance hot-path option for Phase 3 live-sync if profiling
on real payloads demands it. The honest Phase-0 proof (FND-03) becomes "native bytes reach the renderer with
correct contents over the chosen transport" (copy acknowledged) — replacing the falsified same-memory nonce.

## Required doc corrections (flip UNVERIFIED → FALSIFIED, add corrected transport)
- `docs/00-overview/architecture.md` (SAB data-channel section + pivot ladder)
- `docs/04-live-sync/live-memory-and-ipc.md`
- `.planning/phases/00-toolchain-de-risk-app-shell/00-RESEARCH.md` ("State of the Art" table row)
- `00-CONTEXT.md` D-02/D-04 (revise the locked decisions)

## Downstream replan
- **00-03**: rewrite `main.ts`/`preload.ts`/`utility-worker.ts` for the chosen transport + new proof.
- **00-04**: StatusBar transport-proof driver (replaces nonce cross-write).
- **00-05**: SC-4 test → transport proof. (00-01, 00-02 stand.)

Raw consultant reports: `CONSULT-P0SAB-{opus,cursor,codex,sonnet}.out` (+ task files `*.md`).
