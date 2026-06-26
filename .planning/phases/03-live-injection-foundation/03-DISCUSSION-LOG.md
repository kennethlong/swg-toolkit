# Phase 3: Live-Injection Foundation - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-25
**Phase:** 03-live-injection-foundation
**Areas discussed:** Attach shape, Attach-vs-launch, Build coverage, Read-verify gate, HUD + fallback, Agent comms, Native layout

---

## Attach shape

User pre-empted with: *"We can duplicate code from Utinni, but I don't want to wrap that DLL, it has
some dependencies on older libs."* → Option C (wrap `UtinniCore.dll`) eliminated before the question.

| Option | Description | Selected |
|--------|-------------|----------|
| (B) Cross-process read-only | RPM/WPM from our process; no injected DLL; simplest but not the Phase-5 home | |
| (A) Our own agent DLL now | Inject our x86 DLL, in-proc resolve + read-verify; IS the Phase-5 SAB-write home | ✓ |
| (C) Wrap/reuse UtinniCore.dll | (removed — older-lib dependency baggage) | ✗ removed |

**User's choice:** (A) Our own agent DLL now — build the real Phase-5 home once.
**Notes:** Harvest Utinni's inject + endpoints logic into our own code; never load its DLL.

---

## Attach vs launch

| Option | Description | Selected |
|--------|-------------|----------|
| Attach to already-running | OpenProcess a live PID; simplest for read-only | |
| Launch-and-inject (Utinni recipe) | CreateProcess SUSPENDED + EB FE spin + inject + named-event sync | ✓ (primary) |
| Attach now, launch later | Defer launch path | |

Follow-up (SC-1 wording tension): launch-only vs also attach-to-running.

| Option | Description | Selected |
|--------|-------------|----------|
| Launch-from-toolkit only | Reinterpret SC-1; smallest surface | |
| Both: launch + attach-to-running | Primary launch+inject; ALSO OpenProcess + late-inject (handles user-already-launched) | ✓ |
| Launch now, attach later | Defer attach path | |

**User's choice:** Both entry paths in Phase 3 (launch primary + attach-to-running secondary with
static-init-race handling).

---

## Build coverage

| Option | Description | Selected |
|--------|-------------|----------|
| Advertised client only (legacy deferred) | Prove v0.9 name-keyed path; design RVA fallback unwired | |
| Both builds in Phase 3 | Advertised (name-keyed) + legacy SWGEmu (harvest known RVAs), both proven | ✓ |

**User's choice:** Both builds proven in Phase 3. Rescopes the falsified ROADMAP SC-2 (AOB → deterministic sources).

---

## Read-verify gate (LIVE-02 / SC-3)

Multi-select — **all four** checks required before a write is allowed:

| Check | Selected |
|-------|----------|
| Sane transform matrix (`getTransform_o2w`) | ✓ |
| Non-null networkId (`getNetworkId`) | ✓ |
| Template name readable (`getObjectTemplateName`) | ✓ |
| Player/world liveness (`getPlayer` / `isOver` / `mainLoopCounter`) | ✓ |

**User's choice:** All four sentinels.

---

## HUD + fallback (LIVE-04 / LIVE-05)

Multi-select across both sub-areas:

| Item | Selected |
|------|----------|
| HUD: verified object state only | ✓ |
| HUD: + raw memory/packet view | ✓ |
| Fallback: panel disables, editors unaffected | ✓ |
| Fallback: explicit mode indicator + messaging | ✓ |

**User's choice:** Full-scope HUD (object state + raw memory/packet view); fallback = panel disables
with reason + always-visible ● Live / ○ File-patch indicator. All editors remain usable.

---

## Agent comms

| Option | Description | Selected |
|--------|-------------|----------|
| SharedArrayBuffer region now | Stand up the Phase-5 SAB channel in Phase 3 for read-verify reporting | ✓ |
| Named pipe now, SAB at Phase 5 | Simpler now; defer perf channel | |
| Host RPMs resolved addresses directly | Minimal agent surface | |

**User's choice:** SAB region now — same channel Phase 5 writes through; reuse Phase-0 plumbing.

---

## Native layout

| Option | Description | Selected |
|--------|-------------|----------|
| New `live-inject` package | Host addon + x86 agent DLL isolated from native-core | |
| Extend native-core + agent-DLL target | Fewer packages; mixes Win32-only into native-core | |
| Planner decides | Lock only: x86 agent DLL is its own artifact, host = N-API | ✓ |

**User's choice:** Planner decides the package boundary. Locked: agent DLL is a separate x86 artifact; host orchestration is N-API.

---

## Claude's Discretion / Planner decides
- Native package boundary (new package vs extend native-core).
- Elevation/UAC strategy (when admin is required vs same-integrity launch) — UX contract (graceful degrade) is fixed.
- Named-event naming, agent-DLL init entry, exact endpoint typedefs/calling conventions — harvested from Utinni source at research time.

## Deferred Ideas
- LIVE-03 gizmo write / 60 fps SAB write path — Phase 5 (DLL + channel built here).
- AOB/signature scanning, build-hash keying, unknown/third-build attach — future milestone (scope fence).
- x64 client support — advertised export is 32-bit-only; deferred.
- ROADMAP SC-2 rewrite — apply the doc correction when Phase 3 is planned/executed.
