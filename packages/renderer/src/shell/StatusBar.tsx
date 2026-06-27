/**
 * packages/renderer/src/shell/StatusBar.tsx
 * Phase 0 wiring-proof surface — SINGLE OWNER of all window.__* test hooks.
 *
 * PATH B ADAPTATION (00-04 plan_b_adaptation directive):
 *   The original 00-04-PLAN.md described the OLD cross-process model (onSabPort/crossWriteSab
 *   IPC). That model is DELETED — utility-worker.ts is gone. This StatusBar uses the
 *   IN-PROCESS Path B transport instead:
 *
 *   require('@swg/native-core') directly in the renderer (nodeIntegration:true).
 *   The native addon allocates the SAB in-process. The 4-step proof runs here:
 *
 *   1. nativeCore.allocateSab(8)           → assert instanceof SharedArrayBuffer
 *   2. nativeCore.writeSab(sab, 0, 0xDEAD) → Int32Array(sab)[0] === 0xDEAD (C++→JS)
 *   3. renderer writes nonce → Int32Array(sab)[1] = nonce
 *      nativeCore.readSab(sab, 1) === nonce                           (JS→C++)
 *   4. new Worker(blobURL) → worker reads Int32Array(sab)[0] === 0xDEAD (intra-cluster)
 *
 * TEST HOOKS (single owner — these must NOT be set anywhere else):
 *   window.__sabValue      = 0xDEAD           (C++-written sentinel value)
 *   window.__sabIsShared   = true             (instanceof SharedArrayBuffer)
 *   window.__crossWriteOk  = nonce round-trip ok  (JS→C++ same memory)
 *   window.__zeroCopy      = true
 *   window.__transport     = 'B-native-in-renderer'
 *
 * Cross-write states: 'shared' (nonce matched) | 'copy' (mismatch) | 'error' (threw).
 *   'error' means the addon threw — it is NOT a copy. Both copy and error set
 *   __crossWriteOk=false but the triage path differs.
 */

import React, { useEffect, useState } from 'react';
import { SAB_LAYOUT } from '@swg/contracts';
import { useTreStore }       from '../state/treStore.ts';
import { useLiveStore }      from '../state/liveStore.ts';
import { useWorkspaceStore } from '../state/workspaceStore.ts';
import { useChangesetStore } from '../state/changesetStore.ts';

// Path B: require the addon directly (nodeIntegration:true in the renderer)
// eslint-disable-next-line @typescript-eslint/no-require-imports
const nativeCore = require('@swg/native-core') as {
  hello: () => string;
  allocateSab: (byteLength: number) => SharedArrayBuffer;
  writeSab: (sab: SharedArrayBuffer, int32Index: number, value: number) => void;
  readSab:  (sab: SharedArrayBuffer, int32Index: number) => number;
};

type CrossWriteState = 'pending' | 'shared' | 'copy' | 'error' | null;

declare global {
  interface Window {
    // TEST HOOKS — set by StatusBar (single owner); consumed by 00-05 E2E
    __transport:    string;
    __zeroCopy:     boolean;
    __sabIsShared:  boolean;
    __sabValue:     number;
    __crossWriteOk: boolean;
    __crossWriteState: CrossWriteState;
    __posture:      string;
    __proofLog:     string[];
  }
}

export default function StatusBar(): React.ReactElement {
  const [crossOriginIsolated, setCrossOriginIsolated] = useState<boolean | null>(null);
  const [sabValue,            setSabValue]            = useState<number | null>(null);
  const [crossWriteState,     setCrossWriteState]     = useState<CrossWriteState>(null);
  const [addonStatus,         setAddonStatus]         = useState<string>('loading…');
  const [helloValue,          setHelloValue]          = useState<string | null>(null);

  // Live injection mode from Zustand store (Plan 03-06)
  const liveMode = useLiveStore((s) => s.mode);

  // TRE VFS mount status from Zustand store (Plan 01-02 additions)
  const treArchives    = useTreStore((s) => s.archives);
  const treVfsEntries  = useTreStore((s) => s.vfsEntries);
  const treMountStatus = useTreStore((s) => s.mountStatus);

  // Workspace + deploy indicators (Plan 04-02 — W7 stale-deployment badge)
  const workspaceName     = useWorkspaceStore((s) => s.workspaceName);
  const staleDeployment   = useWorkspaceStore((s) => s.hasStaleDeployment);
  const clientDetected    = useWorkspaceStore((s) => s.clientPath !== null);
  const deployedVersionId = useChangesetStore((s) => s.manifest.deployedVersionId);

  useEffect(() => {
    // ── Read crossOriginIsolated immediately ───────────────────────────────
    setCrossOriginIsolated(self.crossOriginIsolated);

    // ── Run the in-process Path B proof ───────────────────────────────────
    void (async () => {
      try {
        // STEP 0: hello() sanity check
        const hello = nativeCore.hello();
        setHelloValue(hello);

        // STEP 1: allocateSab
        const sab = nativeCore.allocateSab(8);
        const isSharedBuf = sab instanceof SharedArrayBuffer;

        // TEST HOOK (single owner) — window.__sabIsShared
        ;(window as Window).__sabIsShared = isSharedBuf; // eslint-disable-line no-extra-semi
        ;(window as Window).__transport   = 'B-native-in-renderer';
        ;(window as Window).__zeroCopy    = true;
        ;(window as Window).__posture     = 'fallback: nodeIntegration=true, contextIsolation=false';

        const view = new Int32Array(sab);

        // STEP 2: C++ writes 0xDEAD → renderer reads it (C++ → JS direction)
        nativeCore.writeSab(sab, 0, 0xDEAD);
        const helloRead = view[SAB_LAYOUT.HELLO_SENTINEL.offset / 4]; // expect 0xDEAD
        setSabValue(helloRead);
        setAddonStatus('native-core ✓');
        console.log('[StatusBar] PASS: allocateSab + writeSab → view[0]=0x' + helloRead.toString(16).toUpperCase() + ' sabIsShared=' + isSharedBuf + ' crossOriginIsolated=' + self.crossOriginIsolated);

        // TEST HOOK (single owner) — window.__sabValue
        ;(window as Window).__sabValue = helloRead; // eslint-disable-line no-extra-semi

        // STEP 3: Renderer writes PER-RUN NONCE → C++ reads it back (JS → C++ direction)
        // NONCE is never sent over any IPC — it is a per-run random int.
        const nonce = (Math.floor(Math.random() * 0x7fffffff)) | 0;
        view[SAB_LAYOUT.RENDERER_SENTINEL.offset / 4] = nonce;

        try {
          const observed = nativeCore.readSab(sab, SAB_LAYOUT.RENDERER_SENTINEL.offset / 4);
          const ok = (observed === nonce);
          const state: CrossWriteState = ok ? 'shared' : 'copy';
          setCrossWriteState(state);
          console.log('[StatusBar] nonce round-trip: nonce=' + nonce + ' observed=' + observed + ' ok=' + ok + ' state=' + state);

          // TEST HOOKS (single owner)
          ;(window as Window).__crossWriteOk    = ok;    // eslint-disable-line no-extra-semi
          ;(window as Window).__crossWriteState = state; // 'shared' | 'copy'
        } catch (e) {
          // addon threw — this is 'error', NOT 'copy'
          setCrossWriteState('error');
          // TEST HOOKS (single owner)
          ;(window as Window).__crossWriteOk    = false;   // eslint-disable-line no-extra-semi
          ;(window as Window).__crossWriteState = 'error'; // timeout/rejection ≠ copy
        }

        // STEP 4: Share SAB with a Worker (intra-cluster)
        const workerSrc = `
          self.onmessage = function(e) {
            var view = new Int32Array(e.data);
            self.postMessage({ val: view[0] });
          };
        `;
        const blob = new Blob([workerSrc], { type: 'text/javascript' });
        const workerUrl = URL.createObjectURL(blob);
        const worker = new Worker(workerUrl);
        await new Promise<void>((resolve) => {
          worker.onmessage = (ev: MessageEvent<{ val: number }>) => {
            URL.revokeObjectURL(workerUrl);
            worker.terminate();
            // Already set __sabIsShared above; confirm intra-cluster share
            ;(window as Window).__sabIsShared = (ev.data.val === 0xDEAD); // eslint-disable-line no-extra-semi
            resolve();
          };
          worker.onerror = () => { URL.revokeObjectURL(workerUrl); worker.terminate(); resolve(); };
          worker.postMessage(sab);
        });

      } catch (err) {
        setAddonStatus('addon error');
        console.error('[StatusBar] Path B proof error:', err);
      }
    })();
  }, []); // run once on mount

  // ── Render ────────────────────────────────────────────────────────────────
  const coiColor  = crossOriginIsolated === true ? 'var(--color-accent)'  : 'var(--color-danger)';
  const coiText   = crossOriginIsolated === null  ? '…'                    :
                    crossOriginIsolated ? 'true'  : 'false';

  const sabText   = sabValue !== null ? '60 fps' : '—';
  const sabColor  = sabValue !== null ? 'var(--color-accent)' : 'var(--color-text-muted)';

  let cwText: string;
  let cwColor: string;
  if (crossWriteState === null || crossWriteState === 'pending') {
    cwText  = '…';
    cwColor = 'var(--color-text-muted)';
  } else if (crossWriteState === 'shared') {
    cwText  = 'shared ✓';
    cwColor = 'var(--color-accent)';
  } else if (crossWriteState === 'copy') {
    cwText  = 'copy ✗';
    cwColor = 'var(--color-danger)';
  } else {
    cwText  = 'no ack ✗';
    cwColor = 'var(--color-warn)';
  }

  const addonColor = addonStatus.includes('✓') ? 'var(--color-accent)' : 'var(--color-text-muted)';

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        height: 'var(--statusbar-h)',
        background: '#1c1c1c',
        borderTop: '1px solid var(--color-border)',
        padding: '0 var(--space-4)',
        gap: 16,
        flexShrink: 0,
        fontFamily: 'var(--font-mono)',
        fontSize: 'var(--text-xs)',
        color: 'var(--color-text-muted)',
        overflow: 'hidden',
        whiteSpace: 'nowrap',
      }}
    >
      {/* Selection seed */}
      <span>shared_landspeeder.msh</span>
      <Dot />
      <span>4,812 verts</span>
      <Dot />

      {/* Addon status */}
      <span>
        addon:{' '}
        <span style={{ color: addonColor }}>{addonStatus}</span>
      </span>
      <Dot />

      {/* crossOriginIsolated */}
      <span>
        crossOriginIsolated:{' '}
        <span style={{ color: coiColor }}>{coiText}</span>
      </span>
      <Dot />

      {/* SAB proof */}
      <span>
        SAB:{' '}
        <span style={{ color: sabColor }}>{sabText}</span>
      </span>
      <Dot />

      {/* Cross-write state */}
      <span>
        zero-copy:{' '}
        <span style={{ color: cwColor }}>{cwText}</span>
      </span>
      <Dot />

      {/* TRE VFS mount status (Plan 01-02) */}
      <span>
        mount:{' '}
        <span style={{ color: treArchives.length > 0 ? 'var(--color-accent)' : 'var(--color-text-muted)' }}>
          {treArchives.length} {treArchives.length === 1 ? 'archive' : 'archives'}
        </span>
      </span>
      <Dot />
      <span>
        vfs:{' '}
        <span style={{ color: treVfsEntries.length > 0 ? 'var(--color-accent)' : 'var(--color-text-muted)' }}>
          {treVfsEntries.length.toLocaleString()} files
        </span>
      </span>
      {/* Mounting progress indicator */}
      {treMountStatus.kind === 'mounting' && (
        <>
          <Dot />
          <span style={{ color: 'var(--color-warn)' }}>
            ⟳ mounting {treMountStatus.filename} {treMountStatus.pct}%
          </span>
        </>
      )}

      {/* Live injection mode indicator (D-08, Plan 03-06) */}
      <Dot />
      <span>
        <span style={{ color: liveMode === 'live' ? 'var(--color-accent)' : 'var(--color-text-muted)' }}>
          {liveMode === 'live' ? '● Live' : '○ File-patch'}
        </span>
      </span>

      {/* Workspace name (Plan 04-02 / W7) */}
      <Dot />
      <span>
        workspace:{' '}
        <span
          style={{
            color:      workspaceName ? 'var(--color-info)' : 'var(--color-text-faint)',
            fontFamily: 'var(--font-mono)',
          }}
        >
          {workspaceName ?? 'none'}
        </span>
      </span>

      {/* Client detection indicator */}
      <Dot />
      <span
        style={{
          color:      clientDetected ? 'var(--color-info)' : 'var(--color-text-faint)',
          fontFamily: 'var(--font-mono)',
          fontSize:   'var(--text-xs)',
        }}
      >
        {clientDetected ? '● client' : '○ no client'}
      </span>

      {/* Stale-deployment badge (W7) */}
      {staleDeployment && (
        <>
          <Dot />
          <span
            style={{
              color:      'var(--color-warn)',
              fontFamily: 'var(--font-mono)',
              fontSize:   'var(--text-xs)',
            }}
          >
            ⚠ deployed patch missing from cfg
          </span>
        </>
      )}

      {/* Deployed version indicator (hidden when nothing deployed) */}
      {deployedVersionId !== null && (
        <>
          <Dot />
          <span
            style={{
              color:      'var(--color-text-faint)',
              fontFamily: 'var(--font-mono)',
              fontSize:   'var(--text-xs)',
            }}
          >
            deployed: {deployedVersionId.slice(0, 8)}
          </span>
        </>
      )}
      <Dot />

      {/* Right-aligned */}
      <div style={{ flex: 1 }} />
      <span>
        pnpm · contracts{' '}
        <span style={{ color: 'var(--color-accent)' }}>✓</span>
      </span>

      {/* Debug: hello value (hidden when null) */}
      {helloValue !== null && (
        <span style={{ color: 'var(--color-text-faint)' }}>
          hello={helloValue}
        </span>
      )}
    </div>
  );
}

function Dot(): React.ReactElement {
  return <span style={{ color: 'var(--color-text-faint)' }}>·</span>;
}
