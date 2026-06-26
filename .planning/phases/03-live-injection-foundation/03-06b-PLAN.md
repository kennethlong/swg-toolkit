---
phase: 03-live-injection-foundation
plan: "06b"
type: execute
wave: 6
depends_on:
  - 03-06
files_modified:
  - packages/renderer/src/hooks/useLiveService.ts
  - packages/renderer/src/hooks/useChannelReader.ts
  - packages/renderer/src/panels/LiveInspectorPanel.tsx
autonomous: false
requirements:
  - LIVE-04
  - LIVE-05

must_haves:
  truths:
    - "Clicking 'Attach / Launch & Inject' in LiveInspectorPanel STATE 1 calls beginAttach then the addon (read-verify only — no write path exists in the UI)"
    - "useLiveService routes the addon promise to liveStore: resolve → attachComplete(pid, mappingName); reject containing 'file-patch mode' → attachError(reason)"
    - "useChannelReader, once status.kind === 'attached', polls addon.readChannelView in a requestAnimationFrame loop and calls liveStore.updateState with parsed VerifiedObjectState"
    - "Seqlock retry: reader returns null (skips frame) when seq is odd; re-reads seq after payload and returns null if seq changed"
    - "Manual UAT on advertised client: HUD shows read-verified state; resolved endpoint count ~97 (not ~40)"
    - "Manual UAT on legacy SWGEmu client: the RVA-table path attaches and shows state"
    - "useChannelReader calls liveStore.updateRegion with the raw channel bytes on each successful poll, enabling the HexInspector (STATE 3) raw memory view (D-07)"
  artifacts:
    - path: packages/renderer/src/hooks/useLiveService.ts
      provides: "launchAndInjectUI(clientExe) async function; routes addon promise to liveStore actions"
      exports: ["launchAndInjectUI", "attachToRunningUI", "getAgentDllPath"]
    - path: packages/renderer/src/hooks/useChannelReader.ts
      provides: "useChannelReader() React hook; RAF poll loop; seqlock-guarded parse of LIVE_CHANNEL_LAYOUT bytes"
      exports: ["useChannelReader"]
    - path: packages/renderer/src/panels/LiveInspectorPanel.tsx
      provides: "STATE 1 updated: clientExe input + Attach button wired to useLiveService; useChannelReader called unconditionally"
      contains: "Attach"
  key_links:
    - from: packages/renderer/src/panels/LiveInspectorPanel.tsx
      to: packages/renderer/src/hooks/useLiveService.ts
      via: "launchAndInjectUI(clientExe) called on button click; STATE 1 body"
      pattern: "launchAndInjectUI"
    - from: packages/renderer/src/hooks/useLiveService.ts
      to: packages/renderer/src/state/liveStore.ts
      via: "useLiveStore.getState().beginAttach / attachComplete / attachError"
      pattern: "attachComplete|attachError"
    - from: packages/renderer/src/hooks/useChannelReader.ts
      to: packages/renderer/src/state/liveStore.ts
      via: "useLiveStore.getState().updateState(parsed)"
      pattern: "updateState"
    - from: packages/renderer/src/hooks/useChannelReader.ts
      to: packages/contracts/src/live-inject.ts
      via: "LIVE_CHANNEL_LAYOUT offsets guide the DataView reads (seqlock + payload)"
      pattern: "LIVE_CHANNEL_LAYOUT"
    - from: packages/renderer/src/hooks/useChannelReader.ts
      to: packages/renderer/src/state/liveStore.ts
      via: "useLiveStore.getState().updateRegion(new Uint8Array(buf)) called on each successful poll (D-07)"
      pattern: "updateRegion"
---

<objective>
Wire the three missing HUD integration pieces: attach trigger UI in LiveInspectorPanel STATE 1,
addon-to-store service (useLiveService.ts), and channel polling loop (useChannelReader.ts).
Gate on manual UAT checkpoint.

Purpose: Without this plan, "HUD shows live state" is structurally impossible — the store exists
and the panel renders state, but nothing calls the addon, nothing opens the channel, and nothing
reads back verified data. This plan closes all three gaps and proves them on a real client.

Output: useLiveService.ts, useChannelReader.ts, LiveInspectorPanel.tsx updated with attach UI,
manual UAT approved on both advertised and legacy SWGEmu clients.
</objective>

<execution_context>
@D:\Code\SWG-Toolkit\.claude\get-shit-done\workflows\execute-plan.md
@D:\Code\SWG-Toolkit\.claude\get-shit-done\templates\summary.md
</execution_context>

<context>
@.planning/ROADMAP.md
@.planning/phases/03-live-injection-foundation/03-CONTEXT.md
@.planning/phases/03-live-injection-foundation/03-RESEARCH.md
@.planning/phases/03-live-injection-foundation/03-PATTERNS.md
@.planning/phases/03-live-injection-foundation/03-06-SUMMARY.md

<interfaces>
<!-- liveStore actions — from packages/renderer/src/state/liveStore.ts (Plan 03-06 Task 1) -->
useLiveStore.getState().beginAttach(clientExe: string): void
useLiveStore.getState().attachComplete(pid: number, mappingName: string): void
useLiveStore.getState().attachError(reason: string): void
useLiveStore.getState().updateState(state: VerifiedObjectState | null): void
useLiveStore.getState().updateRegion(bytes: Uint8Array): void
// status: ConnectionStatus = { kind: 'idle' | 'connecting' | 'attached'; pid?; mappingName? } | { kind: 'error'; reason }

<!-- native addon surface — from packages/live-inject/src/addon.cpp registrations (Plans 03-04/03-05) -->
// All calls go through require('@swg/live-inject') in Electron renderer context.
// Synchronous:
addon.openChannel(name: string): ArrayBuffer   // creates file-mapping, returns mapped view
// Async (AsyncWorker):
addon.launchAndInject(clientExe: string, agentDllPath: string, mappingName: string): Promise<{pid: number}>
addon.attachAndInject(pid: number, agentDllPath: string, mappingName: string): Promise<{pid: number}>
// Channel read (synchronous, returns current mapped view):
addon.readChannelView(name: string): ArrayBuffer | null

<!-- LIVE_CHANNEL_LAYOUT — from packages/contracts/src/live-inject.ts (Plan 03-01 Task 2) -->
// SEQ_COUNTER: { offset: 0, length: 4 }       — uint32 seqlock counter (odd = write in progress)
// TRANSFORM:   { offset: 4, length: 48 }       — 12 floats, Float32Array, row-major 3x4
// NETWORK_ID:  { offset: 52, length: 8 }       — uint64 (lo=uint32 at 52, hi=uint32 at 56)
// TEMPLATE_NAME: { offset: 60, length: 256 }   — null-terminated ASCII
// LIVENESS:    { offset: 316, length: 4 }       — bit 0: player_non_null, bit 1: is_over
// TOTAL_SIZE:  { offset: 0, length: 320 }

<!-- Seqlock read protocol (must match agent channel.cpp write) -->
// 1. Read seq1 = view.getUint32(0, true)
// 2. If (seq1 & 1) !== 0: writer active — return null (caller retries next RAF frame)
// 3. Read payload (transform, networkId, templateName, liveness)
// 4. Read seq2 = view.getUint32(0, true)
// 5. If seq1 !== seq2: torn read — return null
// 6. Return parsed VerifiedObjectState

<!-- Naming scheme A (locked — see 03-05 Task 1) -->
// JS generates: 'Local\\SwgToolkitLive_' + Math.random().toString(36).slice(2,10)
// BEFORE calling openChannel and launchAndInject — both receive the same name.

<!-- InspectorPanel.tsx actionBtnStyle (existing constant, copy verbatim) -->
// const actionBtnStyle = { ... } — read from InspectorPanel.tsx:108-122 in Plan 03-06 Task 2
// Use the same constant in LiveInspectorPanel for the Attach button.
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: useLiveService.ts + useChannelReader.ts — addon integration hooks</name>
  <files>
    packages/renderer/src/hooks/useLiveService.ts,
    packages/renderer/src/hooks/useChannelReader.ts
  </files>
  <read_first>
    packages/renderer/src/state/liveStore.ts — read the full file (created in Plan 03-06 Task 1) to confirm store action signatures before wiring.
    PATTERNS.md §treStore.ts — read for the addon require() import pattern used elsewhere in the renderer (how @swg/native-core is imported; mirror this for @swg/live-inject).
    RESEARCH.md §Common Pitfalls §Pitfall 5 — seqlock GC guard: never cache ArrayBuffer.Data() across frames; always call addon.readChannelView() fresh each RAF tick.
    packages/contracts/src/live-inject.ts — read LIVE_CHANNEL_LAYOUT and VerifiedObjectState (created in Plan 03-01 Task 2) to confirm offset values before writing parseChannelView.
    CONTEXT.md §D-01 and §D-08 — D-01: read-verify runs in-process in agent; D-08: OpenProcess fail → file-patch mode (attachError surfaces the reason).
  </read_first>
  <action>
    Phase 3 is READ-VERIFY ONLY. Neither hook has any write path.

    packages/renderer/src/hooks/useLiveService.ts:
    This module bridges UI intent (user clicked Attach) to the native addon and routes results
    to liveStore. It is NOT a React hook (no useEffect) — it exports plain async functions so
    the button handler in LiveInspectorPanel can await them.

    Import the addon: const addon = require('@swg/live-inject') (same idiom as @swg/native-core
    in the renderer — read treStore.ts for the exact require() path and any error handling around
    missing native module).

    Import useLiveStore from '../state/liveStore'.

    Export getAgentDllPath(): string
    Returns the absolute path to the injected agent DLL. In development: path.join(__dirname,
    '../../packages/live-inject/agent/build-agent/Release/swg_toolkit_agent.dll'). In packaged
    Electron: path.join(process.resourcesPath, 'agent', 'swg_toolkit_agent.dll').
    Use app.isPackaged from electron (require('electron').app) to select the path.

    Export async function launchAndInjectUI(clientExe: string): Promise<void>
    1. Generate mappingName = 'Local\\SwgToolkitLive_' + Math.random().toString(36).slice(2,10).
       (Scheme A — host generates before constructing the worker; see 03-05 Task 1 note.)
    2. useLiveStore.getState().beginAttach(clientExe).
    3. addon.openChannel(mappingName) — synchronous call that creates the file-mapping.
       If it throws: useLiveStore.getState().attachError('Channel open failed: ' + e.message). Return.
    4. const agentDll = getAgentDllPath().
    5. addon.launchAndInject(clientExe, agentDll, mappingName) — returns Promise<{pid: number}>.
       On resolve: useLiveStore.getState().attachComplete(result.pid, mappingName).
       On reject: const reason = String(err?.message ?? err);
                 useLiveStore.getState().attachError(reason).
                 (The 'file-patch mode' substring in the reason string causes LiveInspectorPanel
                 STATE 1 to display the fallback reason per D-08 — no special branching needed
                 because attachError always sets mode='file-patch'.)

    Export async function attachToRunningUI(pid: number): Promise<void>
    Same pattern as launchAndInjectUI but calls addon.attachAndInject(pid, agentDll, mappingName).

    packages/renderer/src/hooks/useChannelReader.ts:
    A React hook that polls the channel ArrayBuffer on requestAnimationFrame once attached.
    Parses seqlock-guarded bytes into VerifiedObjectState using LIVE_CHANNEL_LAYOUT offsets.

    import { useEffect, useRef } from 'react'.
    import { useLiveStore } from '../state/liveStore'.
    import { LIVE_CHANNEL_LAYOUT, VerifiedObjectState } from '@swg/contracts'.
    const addon = require('@swg/live-inject').

    export function useChannelReader(): void:
      const status = useLiveStore((s) => s.status).
      const rafRef = useRef<number>(0).

      useEffect(() => {
        if (status.kind !== 'attached') return;
        const mappingName = status.mappingName;

        function poll() {
          const buf: ArrayBuffer | null = addon.readChannelView(mappingName);
          if (buf) {
            useLiveStore.getState().updateRegion(new Uint8Array(buf));
            const state = parseChannelView(buf);
            if (state !== null) useLiveStore.getState().updateState(state);
          }
          rafRef.current = requestAnimationFrame(poll);
        }
        rafRef.current = requestAnimationFrame(poll);
        return () => { cancelAnimationFrame(rafRef.current); };
      }, [status.kind === 'attached' ? (status as any).mappingName : null]);

    function parseChannelView(buf: ArrayBuffer): VerifiedObjectState | null:
      const view = new DataView(buf);
      const L = LIVE_CHANNEL_LAYOUT;

      Seqlock step 1 — read seq1:
        const seq1 = view.getUint32(L.SEQ_COUNTER.offset, true);
        if ((seq1 & 1) !== 0) return null;   // writer is mid-write; skip this frame

      Read payload:
        const transform = new Float32Array(buf.slice(L.TRANSFORM.offset, L.TRANSFORM.offset + L.TRANSFORM.length));
        (Use buf.slice NOT a view — the buf may be from a new ArrayBuffer returned by readChannelView
        each frame; do NOT hold a typed-array view into a previous frame's buffer across frames.)
        const networkIdLo = view.getUint32(L.NETWORK_ID.offset, true);
        const networkIdHi = view.getUint32(L.NETWORK_ID.offset + 4, true);
        const networkId = (BigInt(networkIdHi) << 32n) | BigInt(networkIdLo);
        Read templateName: Uint8Array(buf, L.TEMPLATE_NAME.offset, L.TEMPLATE_NAME.length),
          find null terminator, TextDecoder('ascii').decode(slice).
        const livenessFlags = view.getUint32(L.LIVENESS.offset, true);
        const playerAlive = (livenessFlags & 0x1) !== 0 && (livenessFlags & 0x2) === 0;

      Seqlock step 2 — torn-read check:
        const seq2 = view.getUint32(L.SEQ_COUNTER.offset, true);
        if (seq1 !== seq2) return null;   // writer changed seq during our read; skip

      return { networkId, templateName, transform, playerAlive } as VerifiedObjectState.
  </action>
  <verify>
    <automated>pnpm --filter @swg/renderer build 2>&1 | tail -5</automated>
  </verify>
  <acceptance_criteria>
    renderer builds without TypeScript error.
    grep -c "launchAndInjectUI" packages/renderer/src/hooks/useLiveService.ts gives 1.
    grep -c "attachToRunningUI" packages/renderer/src/hooks/useLiveService.ts gives 1.
    grep -c "getAgentDllPath" packages/renderer/src/hooks/useLiveService.ts gives 1.
    grep -c "requestAnimationFrame" packages/renderer/src/hooks/useChannelReader.ts gives 2 (request + cancel).
    grep -c "LIVE_CHANNEL_LAYOUT" packages/renderer/src/hooks/useChannelReader.ts gives 1+.
    grep -c "seq1.*&.*1\|seqlock\|SEQ_COUNTER" packages/renderer/src/hooks/useChannelReader.ts gives 1+ (seqlock protocol present).
    grep -c "updateRegion" packages/renderer/src/hooks/useChannelReader.ts gives 1 (raw bytes fed to HexInspector via liveStore).
    grep -v "^//" packages/renderer/src/hooks/useLiveService.ts | grep -c "WriteProcess\|write.*memory\|inject.*write" gives 0 (no write path).
  </acceptance_criteria>
  <done>useLiveService.ts exports launchAndInjectUI/attachToRunningUI/getAgentDllPath; useChannelReader.ts polls channel with seqlock protocol and feeds raw bytes to updateRegion; both files build without TS error</done>
</task>

<task type="auto">
  <name>Task 2: LiveInspectorPanel.tsx — attach trigger UI in STATE 1</name>
  <files>
    packages/renderer/src/panels/LiveInspectorPanel.tsx
  </files>
  <read_first>
    packages/renderer/src/panels/LiveInspectorPanel.tsx — read the full file as created in Plan 03-06 Task 2. Find the STATE 1 section (mode === 'file-patch' OR idle) and the TODO comment marking the attach trigger injection point.
    packages/renderer/src/panels/InspectorPanel.tsx:108-122 — actionBtnStyle constant (copy verbatim; established in Plan 03-06 Task 2 but needed here for the Attach button).
    PATTERNS.md §LiveInspectorPanel.tsx — disabled state layout, input field style, button style.
    CONTEXT.md §D-08 — explicit user action required; no auto-inject; disabled state shows reason; all format editing keeps working.
    CONTEXT.md §D-02 — both launch-and-inject (primary) and attach-to-running (secondary) paths are in scope.
    packages/renderer/src/hooks/useLiveService.ts — launchAndInjectUI, attachToRunningUI signatures (created in Task 1).
    packages/renderer/src/hooks/useChannelReader.ts — useChannelReader() (created in Task 1, must be called unconditionally in the component).
  </read_first>
  <action>
    This is a follow-on edit to LiveInspectorPanel.tsx created in Plan 03-06 Task 2.
    Phase 3 is READ-VERIFY ONLY. The Attach button only triggers read+verify; no write path exists.

    Add imports at the top of LiveInspectorPanel.tsx:
      import { launchAndInjectUI, attachToRunningUI } from '../hooks/useLiveService';
      import { useChannelReader } from '../hooks/useChannelReader';

    Inside the LiveInspectorPanel component body, add at the top (unconditional):
      useChannelReader();   // activates RAF poll when status is attached; no-ops otherwise

    Add local state near other useState declarations:
      const [clientExe, setClientExe] = useState('');
      const [attachPid, setAttachPid] = useState('');
      const isConnecting = useLiveStore((s) => s.status.kind === 'connecting');

    STATE 1 body (replace the TODO comment with the attach form):
    Retain the existing "○ File-patch mode" heading and disabledReason display.
    Below that, add an attach form section:

    Section heading: "Attach to SWG Client" (font-size text-xs, color text-muted, marginTop space-3).

    PRIMARY PATH — Launch & Inject:
    - Label: "Client executable" (font-size text-xs, color text-muted).
    - Text input: value={clientExe}, onChange={(e) => setClientExe(e.target.value),
      placeholder="C:\path\to\SwgClient_r.exe" (or SWGEmu.exe).
      Style: width 100%, font-size text-xs, background var(--color-input), color var(--color-text),
      border 1px solid var(--color-border), borderRadius 2px, padding var(--space-1) var(--space-2).
    - Button using actionBtnStyle: label "Launch & Inject (read-verify)".
      disabled={isConnecting || !clientExe.trim()}.
      onClick: async handler — call launchAndInjectUI(clientExe.trim()).
      (Do NOT inline the addon call or mapping name generation; the service handles that.)

    SECONDARY PATH — Attach to Running:
    - Label: "Running client PID" (font-size text-xs, color text-muted, marginTop space-2).
    - Number input: value={attachPid}, onChange={(e) => setAttachPid(e.target.value),
      placeholder="PID (e.g. 1234)".
      Style: same as clientExe input.
    - Button using actionBtnStyle: label "Attach to Running (read-verify)".
      disabled={isConnecting || !attachPid.trim() || isNaN(Number(attachPid))}.
      onClick: async handler — call attachToRunningUI(Number(attachPid)).

    Keep all existing STATE 2 (verified state display) and STATE 3 (HexInspector raw view) logic
    unchanged from Plan 03-06 Task 2.

    NOTE: The two button labels explicitly say "(read-verify)" to make the read-only nature of
    Phase 3 clear to the user. The write path (Phase 5) will add its own UI.
  </action>
  <verify>
    <automated>pnpm --filter @swg/renderer build 2>&1 | tail -5 && grep -c "Launch.*Inject\|launchAndInjectUI" packages/renderer/src/panels/LiveInspectorPanel.tsx</automated>
  </verify>
  <acceptance_criteria>
    renderer builds without TypeScript error.
    grep -c "launchAndInjectUI" packages/renderer/src/panels/LiveInspectorPanel.tsx gives 1.
    grep -c "attachToRunningUI" packages/renderer/src/panels/LiveInspectorPanel.tsx gives 1.
    grep -c "useChannelReader" packages/renderer/src/panels/LiveInspectorPanel.tsx gives 1 (unconditional call).
    grep -c "Launch.*Inject\|Attach.*Running" packages/renderer/src/panels/LiveInspectorPanel.tsx gives 2 (both button labels).
    grep -v "^//" packages/renderer/src/panels/LiveInspectorPanel.tsx | grep -c "write\|WriteProcess" gives 0 (read-only).
  </acceptance_criteria>
  <done>LiveInspectorPanel STATE 1 has clientExe input + Launch & Inject button + PID input + Attach to Running button; useChannelReader called unconditionally; renderer builds</done>
</task>

<task type="checkpoint:human-verify" gate="blocking">
  <what-built>
    - packages/live-inject/ complete: x86 agent DLL + x64 host N-API addon + Vitest test suite
    - All 4 automated test specs GREEN (resolve + sentinels + channel-layout + handle)
    - LiveInspectorPanel with attach form (Launch & Inject + Attach to Running)
    - useLiveService.ts routing addon promise to liveStore
    - useChannelReader.ts polling channel with seqlock protocol
    - ● Live / ○ File-patch always visible in StatusBar
    - Both inject paths (launch + attach-to-running) implemented
    - Both supported builds (advertised name-keyed + legacy RVA) handled
    - ROADMAP SC-2 corrected (no AOB wording)
  </what-built>
  <how-to-verify>
    Run `pnpm dev` to start the Electron app. Confirm ○ File-patch shows in the StatusBar with no
    client attached.

    MANUAL UAT CHECKLIST — both clients required:

    === ADVERTISED CLIENT (swg-client-v2 build) ===
    1. Open Live Inspector panel. Fill in path to SwgClient_r.exe. Click "Launch & Inject (read-verify)".
       Expected: status transitions connecting → ● Live; LiveInspectorPanel shows networkId/templateName/transform.
       Expected: resolved endpoint count logged as ~97 (NOT ~40 — the half-built-table failure mode).
    2. Log in to the game, select a character. Confirm the transform position changes as you move.
    3. Open a TRE archive in the VFS browser while ● Live is active. Confirm it works normally.
    4. Kill the client. Confirm HUD reverts to ○ File-patch with reason.

    === ATTACH-TO-ALREADY-RUNNING PATH ===
    5. Launch SwgClient_r.exe manually, log in. Enter the PID in "Attach to Running", click button.
       Expected: HUD shows ● Live. Confirmed static-init race is non-issue (agent calls GetEngineHookPoints()).

    === LEGACY SWGEmu CLIENT ===
    6. Point toolkit at SWGEmu.exe. Attach.
       Expected: RVA-table path; HUD shows ● Live with transform/templateName from the legacy path.
       (If networkId is STILL UNVERIFIED, confirm "3.5/4 sentinels" behavior matches the SUMMARY note.)

    === FILE-PATCH FALLBACK ===
    7. Run as a standard user (non-elevated) against a higher-integrity client, or with no client running.
       Expected: ○ File-patch in StatusBar; LiveInspectorPanel shows disabled state with reason.
       Expected: TRE browser, IFF inspector, and 3D viewport all still work normally.

    === RAW HEX VIEW (D-07 stretch) ===
    8. With ● Live active, expand the "Raw Memory View" section in LiveInspectorPanel.
       Expected: HexInspector shows the transform region bytes (or any RPM region read).

    Type "approved" if all checklist items pass, or describe any failures.
  </how-to-verify>
  <resume-signal>Type "approved" or describe issues found</resume-signal>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Renderer UI → useLiveService → native addon | User-initiated attach; clientExe and pid inputs must not allow injection into arbitrary processes |
| useChannelReader → LIVE_CHANNEL_LAYOUT bytes | Bytes from client memory are untrusted; seqlock prevents torn reads but does not validate content — sentinels in the agent are the validation gate |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-03-01 | Spoofing | clientExe input → launchAndInjectUI | mitigate | ProductName check in LaunchAndInjectWorker.Execute() is the authoritative gate; the UI clientExe is user-supplied but the inject only proceeds if ProductName == "Star Wars Galaxies" |
| T-03-05 | Elevation of Privilege | attachAndInject ACCESS_DENIED → attachError | mitigate | useLiveService always calls attachError on reject; mode='file-patch' with reason shown in UI; no auto-escalation path (D-08) |
| T-03-06 | Tampering | no write path in Phase 3 | mitigate | Neither useLiveService nor useChannelReader has a write path; the only data flow is agent→channel→liveStore.updateState (read direction) |
| T-03-04 | Info-disclosure | parseChannelView reads untrusted bytes | accept | bytes are displayed only in HexInspector + parsed into VerifiedObjectState fields; no eval, no deserialization, no pointer dereference in the renderer |
| T-03-SC | Tampering | npm/pip/cargo installs | accept | No new packages; N/A |
</threat_model>

<verification>
pnpm --filter @swg/renderer build succeeds.
pnpm -r test: all 4 spec files GREEN (no regressions).
grep -c "launchAndInjectUI" packages/renderer/src/panels/LiveInspectorPanel.tsx gives 1.
grep -c "requestAnimationFrame" packages/renderer/src/hooks/useChannelReader.ts gives 2.
grep -c "seq1.*&.*1\|SEQ_COUNTER" packages/renderer/src/hooks/useChannelReader.ts gives 1+.
grep -c "updateRegion" packages/renderer/src/hooks/useChannelReader.ts gives 1.
Manual UAT approved on advertised client (resolved count ~97, not ~40) and legacy SWGEmu client.
</verification>

<success_criteria>
Phase 3 is complete when:
- All 4 automated specs GREEN (resolve + sentinels + channel-layout + handle)
- Renderer builds with LiveInspectorPanel attach form + useLiveService + useChannelReader
- ROADMAP SC-2 corrected
- Manual UAT approved on advertised client (resolved count ~97) and legacy SWGEmu client
- File-patch fallback confirmed: all format editing works without injection
</success_criteria>

<output>
Create .planning/phases/03-live-injection-foundation/03-06b-SUMMARY.md when done.
Update .planning/STATE.md: Phase 03 complete.
</output>
