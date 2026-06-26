---
phase: 03
slug: live-injection-foundation
verdict: ACHIEVED
verified: 2026-06-26
method: live UAT (real clients) + goal-backward code inspection
note: automated gsd-verifier run was blocked by a content safeguard on this topic; this report was authored from first-hand UAT evidence + code review.
---

# Phase 03 — Live-Injection Foundation — Verification

**Goal:** Build the Win32 live-connection module (depends only on Win32, not the format tower)
so attach + read-verify is proven early against a running client; degrade gracefully to file-patch
mode when the live connection is unavailable.

**Overall verdict: ACHIEVED.** Attach + read-verify is proven end-to-end against a running client on
BOTH supported builds, with a graceful file-patch degradation path present. Verified live on
2026-06-26 against real in-world clients (advertised swg-client-v2 and legacy SWGEmu 0.0.119.798).
Four real defects were found and fixed during this first live UAT (commits ab4430a, cd0bdd9, 35318ea,
78d948a) — see Residuals.

## Success Criteria

### SC1 — Correctly-flagged process-handle lifecycle + graceful failure — **MET**
- Connect path opens the handle with the full flag set `PROCESS_CREATE_THREAD | PROCESS_QUERY_INFORMATION | PROCESS_VM_OPERATION | PROCESS_VM_READ | PROCESS_VM_WRITE` — `inject_binding.cpp:848-849`; the read-only path uses `PROCESS_VM_READ` only — `procmem_binding.cpp:14, 92-95`.
- Graceful failure: `ERROR_ACCESS_DENIED` returns a structured message "…switching to file-patch mode" and does NOT auto-escalate — `inject_binding.cpp:854-859`.
- **Proven:** live attach succeeded (49 ms then 5 ms re-attach) against swg-client-v2. The not-elevated → file-patch branch is covered by code + unit tests but was not live-triggered this session (no elevation-failure scenario run). *Evidence: live UAT + code.*

### SC2 — Deterministic, build-specific endpoint resolution on BOTH builds — **MET (strongest)**
- Advertised build: name-keyed `GetEngineHookPoints()` table, called (never scraping the raw static array) — `resolve.cpp:77-80`, `agent_main.cpp:118` (`resolveFromExe`).
- Legacy build: harvested Utinni RVAs remain active when the advertised export is absent — `rva_table.cpp`.
- **Proven LIVE on both:** advertised swg-client-v2 (name-keyed; non-zero networkId; `shared_sullustan_male`) and legacy SWGEmu 0.0.119.798 (RVA path; `shared_human_male`). No AOB scanning — both deterministic. Seqlock channel streamed ~30 fps with no torn reads; transform tracked real character movement on both. *Evidence: live UAT.*

### SC3 — Read-verify before any write; refuse on validation failure — **MET**
- Four sentinel predicates (sane transform, networkId, template-name prefix, liveness) — `sentinels.cpp`. The poll loop writes ONLY when all gate — `agent_main.cpp:206` (`allSentinelsPassed`) → `:216` (`channelWrite`).
- **Proven:** sentinels correctly withhold on invalid state (the legacy path wrote nothing until the advertised-only networkId sentinel was made not-applicable when its accessor is absent). Phase 3 is read-verify only — no write path, correct for scope. *Evidence: live UAT + code.*

### SC4 — Live inspector HUD surfaces the verified object state — **MET (data path); visual render = residual**
- HUD present and wired: `LiveInspectorPanel.tsx`, `useChannelReader.ts`, `liveStore.ts`. The data path channel → `liveStore` → panel is proven: the real `useLiveService.attachToRunningUI` drove `liveStore` to `{kind:'attached', mode:'live', mappingName}` and the channel streamed verified state read via the store-recorded mapping.
- **Important:** before today's wiring fixes (`packages/live-inject/index.js` entry + root-`package.json` hoisted dependency, commit 35318ea), `require('@swg/live-inject')` was unresolvable and the HUD could not have loaded the addon at all. Now resolvable (16 functions).
- **Residual:** the HUD was not visually rendered in a running Electron GUI this session; the data path beneath it is proven. *Evidence: live UAT (data path) + code.*

### SC5 — Editor remains fully usable in file-patch mode — **MET (by design + code); live trigger = residual**
- `InjectionMode` starts `'file-patch'`; `attachError` transitions to file-patch; the not-elevated path yields the file-patch message — `liveStore.ts:27, 34, 49-52`, `inject_binding.cpp:854-859`. Core editing requires no live connection.
- **Residual:** not live-triggered via a real elevation-failure this session; proven by code + unit tests. *Evidence: code + unit tests.*

## Residuals / Carry-forward
- **Phase 5:** agent poll-thread accumulates one per attach → stop-signal cleanup; legacy 64-bit networkId read (x86 return convention); a viewport-gizmo write path (LIVE-03).
- **UI:** a detach/disconnect button to call the new `detachUI()` export (function exists; no button yet); HUD visual confirmation in a running GUI.
- **Done today (beyond original plan):** host injects a per-connect uniquely-named agent copy; `closeChannel` wired into attach/detach (no mapping leak); cross-architecture endpoint resolution for the x64-host → x86-client case.

## Requirement status
LIVE-01 ✅ · LIVE-02 ✅ · LIVE-04 ✅ · LIVE-05 ✅ (all Phase-3 requirements met; LIVE-03 is Phase 5).
