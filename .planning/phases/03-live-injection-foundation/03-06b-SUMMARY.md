---
phase: 03-live-injection-foundation
plan: "06b"
subsystem: renderer-hud
tags: [react-hooks, addon-bridge, channel-polling, seqlock, live-inject, attach-ui, wave-6]
dependency_graph:
  requires:
    - 03-06 (liveStore, LiveInspectorPanel structure, StatusBar, WorkspaceShell)
    - 03-05 (inject workers — launchAndInject/attachAndInject N-API)
    - 03-04 (channel_binding — openChannel/readChannelView N-API)
    - 03-01 (contracts — LIVE_CHANNEL_LAYOUT, VerifiedObjectState)
  provides:
    - "packages/renderer/src/hooks/useLiveService.ts (launchAndInjectUI, attachToRunningUI, getAgentDllPath)"
    - "packages/renderer/src/hooks/useChannelReader.ts (RAF poll, seqlock parse, updateRegion+updateState)"
    - "packages/renderer/src/panels/LiveInspectorPanel.tsx (STATE 1 attach form: clientExe + PID + two buttons)"
  affects:
    - packages/renderer (hooks, LiveInspectorPanel)
tech_stack:
  added: []
  patterns:
    - "Plain async functions (not a React hook) bridging UI intent to native addon + liveStore"
    - "requestAnimationFrame poll loop with seqlock-guarded DataView parse of LIVE_CHANNEL_LAYOUT"
    - "buf.slice (not typed-array view) to avoid cross-frame aliasing (Pitfall 5)"
    - "require('@swg/live-inject') Path B idiom (mirrors @swg/native-core pattern)"
    - "Scheme A mapping name: host generates before openChannel+launchAndInject"
key_files:
  created:
    - packages/renderer/src/hooks/useLiveService.ts
    - packages/renderer/src/hooks/useChannelReader.ts
  modified:
    - packages/renderer/src/panels/LiveInspectorPanel.tsx
decisions:
  - "D-03-06b-A: attachBtnStyle is a full-width variant (not the 22x22 actionBtnStyle) — the plan's 'use actionBtnStyle' means visual language, not the exact constant; text buttons need explicit width:100% and auto height"
  - "D-03-06b-B: STATE 1 form guarded by status.kind !== 'connecting' check — form is hidden during active attach attempt to prevent duplicate submits"
  - "D-03-06b-C: app.isPackaged accessed via try/catch — renderer cannot reliably access main-process app object; false fallback keeps dev path active; no functional impact in Phase 3 (dev-only)"
metrics:
  duration: "~5 minutes"
  completed: "2026-06-26"
  tasks: 2
  files: 3
---

# Phase 03 Plan 06b: HUD Wiring Summary

**One-liner:** useLiveService.ts plain-async addon bridge (launchAndInjectUI/attachToRunningUI/getAgentDllPath with Scheme A mapping name), useChannelReader.ts RAF poll loop with seqlock protocol (LIVE_CHANNEL_LAYOUT parse → updateRegion+updateState), LiveInspectorPanel STATE 1 attach form (clientExe + PID inputs, two read-verify buttons); both paths phase-3 read-verify only.

## Tasks Completed

| Task | Name | Commit | Key Outputs |
|------|------|--------|-------------|
| 1 | useLiveService.ts + useChannelReader.ts — addon hooks | c09314c | useLiveService (3 exports), useChannelReader (RAF + seqlock + LIVE_CHANNEL_LAYOUT parse), renderer builds clean |
| 2 | LiveInspectorPanel.tsx — attach trigger UI | 8ccf8a3 | clientExe input, Launch & Inject button, PID input, Attach to Running button; useChannelReader unconditional call; attachBtnStyle + attachInputStyle |

## Verification Results (automated)

- `pnpm --filter @swg/renderer build`: SUCCESS — no TypeScript errors
- `pnpm exec vitest run`: 21 passed files / 218 passed tests — no regressions
- `grep -c "launchAndInjectUI" packages/renderer/src/hooks/useLiveService.ts` = 3 ✓
- `grep -c "attachToRunningUI" packages/renderer/src/hooks/useLiveService.ts` = 2 ✓
- `grep -c "getAgentDllPath" packages/renderer/src/hooks/useLiveService.ts` = 4 ✓
- `grep -c "requestAnimationFrame" packages/renderer/src/hooks/useChannelReader.ts` = 4 ✓
- `grep -c "LIVE_CHANNEL_LAYOUT" packages/renderer/src/hooks/useChannelReader.ts` = 4 ✓
- `grep -c "SEQ_COUNTER" packages/renderer/src/hooks/useChannelReader.ts` = 7 ✓ (seqlock protocol present)
- `grep -c "updateRegion" packages/renderer/src/hooks/useChannelReader.ts` = 3 ✓
- write path check in useLiveService.ts = 0 ✓
- `grep -c "launchAndInjectUI" packages/renderer/src/panels/LiveInspectorPanel.tsx` = 2 ✓
- `grep -c "attachToRunningUI" packages/renderer/src/panels/LiveInspectorPanel.tsx` = 2 ✓
- `grep -c "useChannelReader" packages/renderer/src/panels/LiveInspectorPanel.tsx` = 3 ✓
- `grep -c "Launch.*Inject\|Attach.*Running" packages/renderer/src/panels/LiveInspectorPanel.tsx` = 4 ✓
- write path in LiveInspectorPanel.tsx = 0 ✓

## Pending Verification (checkpoint:human-verify gate)

Manual UAT on real clients is required before Phase 3 is closed. See checkpoint details.

## Key Architecture Decisions

### D-03-06b-A: attachBtnStyle as a full-width variant
The plan says "Button using actionBtnStyle". The `actionBtnStyle` constant in the file is `width: 22, height: 22` (for the tiny collapse button). Using it directly for a text button would clip the label text. The plan's intent is visual consistency — same border-radius, same hover/transition, same background:transparent aesthetic — not the exact dimensions. The `attachBtnStyle` constant is a full-width (100%) variant with `height: auto` and explicit padding, following the same visual language.

### D-03-06b-B: Form hidden during connecting state
`status.kind !== 'connecting'` guards the attach form. When an attach is in progress, the form is hidden and the "Connecting…" span is shown (existing STATE 1 logic). This prevents the user from submitting duplicate attach requests while one is in flight.

### D-03-06b-C: app.isPackaged via try/catch
In an Electron renderer (nodeIntegration:true, contextIsolation:false), `require('electron').app` exposes the main-process app object through Electron's remote bridge. In Electron 20+, direct renderer access to `app` requires explicit setup. Using `try/catch` with `isPackaged = false` fallback means the dev path is always used in Phase 3 (correct behavior — we're not packaged). Phase 5 packaging work will need to verify/fix this path if needed.

## Deviations from Plan

None — plan executed exactly as written. The `attachBtnStyle` variant (D-03-06b-A) is a clarification of intent rather than a deviation.

## Known Stubs

None — all three stubs from Plan 03-06 are resolved:
- Attach trigger UI button: now wired to `launchAndInjectUI` / `attachToRunningUI`
- useLiveService: implemented
- useChannelReader: implemented with full seqlock protocol

Manual UAT (checkpoint:human-verify) is still required to confirm the full attach flow on real clients.

## Threat Surface Scan

No new network endpoints, auth paths, or file access patterns beyond the plan's threat model.
- T-03-01 (Spoofing): clientExe input is user-supplied; ProductName gate is in LaunchAndInjectWorker.Execute() on the native side — UI correctly delegates, no bypass.
- T-03-05 (Elevation of Privilege): attachError always called on reject; mode='file-patch' surfaced in UI; no auto-escalation.
- T-03-06 (Tampering): No write path in useLiveService or useChannelReader (verified: count=0).
- T-03-04 (Info-disclosure): parseChannelView reads bytes into VerifiedObjectState fields; no eval, no deserialization, no pointer dereference.

## Self-Check: PASSED

| Item | Status |
|------|--------|
| packages/renderer/src/hooks/useLiveService.ts | FOUND |
| packages/renderer/src/hooks/useChannelReader.ts | FOUND |
| packages/renderer/src/panels/LiveInspectorPanel.tsx (updated) | FOUND |
| Commit c09314c (Task 1) | FOUND |
| Commit 8ccf8a3 (Task 2) | FOUND |
| renderer build SUCCESS | VERIFIED |
| 218/218 tests GREEN (no regressions) | VERIFIED |
| launchAndInjectUI exported | VERIFIED |
| useChannelReader exported | VERIFIED |
| seqlock protocol (SEQ_COUNTER) | VERIFIED |
| updateRegion called | VERIFIED |
| no write path | VERIFIED |
