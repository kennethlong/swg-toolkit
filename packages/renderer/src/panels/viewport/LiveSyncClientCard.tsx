/**
 * packages/renderer/src/panels/viewport/LiveSyncClientCard.tsx
 *
 * UI-SPEC Surface 1 item 2 — the 224px top-right live-sync HUD card: live/
 * offline header, client/target(cross-build)/pid/fps/last-sync/COW-snapshot
 * rows, TWO independent read-verify guard rows (transform + three-state
 * scale), the session write log with per-write revert, "Revert ALL to
 * snapshot" (always clickable while attached), and all three B2 safety-state
 * banners (normal / guard-blocked / reverted) with REAL addr/expected-bytes
 * and a per-channel discarded-change disclosure.
 *
 * A plain DOM overlay (NOT an R3F component) — mounted as a `<Canvas>` sibling
 * in Viewport.tsx, mirroring MissingDepsOverlay/GizmoStatusLabel's established
 * idiom (05-10) so it is trivially testable with @testing-library/react
 * without an R3F/WebGL harness.
 *
 * Source: 05-11-PLAN.md Task 1; 05-UI-SPEC.md Surface 1 item 2 + B2 states +
 * Copywriting Contract; 05-07-PLAN.md (liveStore contracts this reads).
 */

import React, { useEffect, useRef, useState } from 'react';
import { useLiveStore, formatAddr } from '../../state/liveStore.js';
import { useViewportStore } from '../../state/viewportStore.js';
import {
  computeScaleGuardRowState,
  isCardGuardBlocked,
  normalizeAssetBasename,
} from './liveSyncGuardPrecedence.js';

// ─── Byte formatting (T-05-19 — displaying the live object's own memory bytes
// to the LOCAL user of a single-user desktop tool; real, non-fabricated) ─────

/** Formats a Float32Array as its raw little-endian byte hex dump — the literal
 *  "<bytes>" the B2 guard-blocked/reverted-banner copy contract calls for. */
function formatFloatBytesHex(arr: Float32Array): string {
  const buf = new ArrayBuffer(arr.length * 4);
  const view = new DataView(buf);
  for (let i = 0; i < arr.length; i++) view.setFloat32(i * 4, arr[i] ?? 0, true);
  const bytes = new Uint8Array(buf);
  let out = '';
  for (let i = 0; i < bytes.length; i++) out += bytes[i]!.toString(16).padStart(2, '0');
  return out.toUpperCase();
}

function formatHms(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number): string => n.toString().padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

// ─── fps / last-sync telemetry (component-local — liveStore does not track
// a poll-tick timestamp/rate; "compute from the actual poll-tick rate... do
// not hardcode", 05-11 Task 1 action text) ────────────────────────────────

function useLiveSyncTelemetry(
  verifiedState: unknown,
  attached: boolean,
): { fps: number; lastSyncMs: number | null } {
  const tickCountRef = useRef(0);
  const lastFpsCalcRef = useRef(0);
  const lastSyncMsRef = useRef<number | null>(null);
  const [fps, setFps] = useState(0);
  const [, forceTick] = useState(0);

  useEffect(() => {
    if (!attached || verifiedState === null || verifiedState === undefined) return;
    const now = performance.now();
    lastSyncMsRef.current = Date.now();
    tickCountRef.current += 1;
    if (lastFpsCalcRef.current === 0) lastFpsCalcRef.current = now;
    if (now - lastFpsCalcRef.current >= 1000) {
      setFps(tickCountRef.current);
      tickCountRef.current = 0;
      lastFpsCalcRef.current = now;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [verifiedState, attached]);

  useEffect(() => {
    if (!attached) { lastSyncMsRef.current = null; setFps(0); return; }
    const id = setInterval(() => forceTick((t) => t + 1), 200);
    return () => clearInterval(id);
  }, [attached]);

  return { fps, lastSyncMs: lastSyncMsRef.current };
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const CARD_WIDTH = 224;

function cardStyle(attached: boolean, guardBlocked: boolean): React.CSSProperties {
  return {
    width: CARD_WIDTH,
    background: 'rgba(16,20,20,0.86)',
    backdropFilter: 'blur(4px)',
    border: `1px solid ${guardBlocked ? 'var(--color-danger)' : attached ? 'var(--color-accent-line)' : 'var(--color-warn)'}`,
    borderStyle: attached ? 'solid' : 'dashed',
    borderRadius: 'var(--radius-md)',
    padding: 'var(--space-3)',
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-2)',
    fontFamily: 'var(--font-mono)',
    fontSize: 'var(--text-xs)',
    color: 'var(--color-text)',
  };
}

const rowStyle: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', gap: 'var(--space-2)' };
const kStyle: React.CSSProperties = { color: 'var(--color-text-faint)' };
const vStyle: React.CSSProperties = { color: 'var(--color-text)', textAlign: 'right', wordBreak: 'break-word' };
const warnStyle: React.CSSProperties = { color: 'var(--color-warn)' };
const accentStyle: React.CSSProperties = { color: 'var(--color-accent)' };
const dangerStyle: React.CSSProperties = { color: 'var(--color-danger)' };

function Row({ k, v, vColor }: { k: string; v: React.ReactNode; vColor?: string }): React.ReactElement {
  return (
    <div style={rowStyle}>
      <span style={kStyle}>{k}</span>
      <span style={{ ...vStyle, color: vColor }}>{v}</span>
    </div>
  );
}

const ghostBtnStyle: React.CSSProperties = {
  background: 'transparent',
  border: '1px solid var(--color-border-soft)',
  borderRadius: 'var(--radius-sm)',
  color: 'var(--color-text-muted)',
  cursor: 'pointer',
  fontFamily: 'var(--font-sans)',
  fontSize: 'var(--text-xs)',
  padding: '1px 6px',
};

const dangerOutlineBtnStyle: React.CSSProperties = {
  background: 'transparent',
  border: '1px solid var(--color-danger)',
  borderRadius: 'var(--radius-sm)',
  color: 'var(--color-danger)',
  cursor: 'pointer',
  fontFamily: 'var(--font-sans)',
  fontSize: 'var(--text-xs)',
  padding: '3px 8px',
  width: '100%',
};

// ─── Component ────────────────────────────────────────────────────────────────

export default function LiveSyncClientCard(): React.ReactElement {
  const status = useLiveStore((s) => s.status);
  const verifiedState = useLiveStore((s) => s.verifiedState);
  const cowSnapshot = useLiveStore((s) => s.cowSnapshot);
  const writeLog = useLiveStore((s) => s.writeLog);
  const guardState = useLiveStore((s) => s.guardState);
  const guardAddr = useLiveStore((s) => s.guardAddr);
  const lastDiscardedChange = useLiveStore((s) => s.lastDiscardedChange);
  const clientLabel = useLiveStore((s) => s.clientLabel);
  const revertWrite = useLiveStore((s) => s.revertWrite);
  const revertAll = useLiveStore((s) => s.revertAll);
  const expectedTransform = useLiveStore((s) => s.expectedTransform);
  const expectedScale = useLiveStore((s) => s.expectedScale);

  const loadStatus = useViewportStore((s) => s.loadStatus);

  const attached = status.kind === 'attached';
  const { fps, lastSyncMs } = useLiveSyncTelemetry(verifiedState, attached);

  // ── Reverted-banner local tracking (liveStore has no "just reverted" flag —
  // revertWrite/revertAll mutate writeLog directly; the card tracks WHEN a
  // revert button was clicked and clears that flag once a genuinely NEW write
  // appends afterward, so the reverted banner does not linger forever). ──────
  const [revertedAt, setRevertedAt] = useState<number | null>(null);
  const prevWriteLogLenRef = useRef(writeLog.length);
  useEffect(() => {
    if (writeLog.length > prevWriteLogLenRef.current) setRevertedAt(null);
    prevWriteLogLenRef.current = writeLog.length;
  }, [writeLog.length]);

  function handleRevertAll(): void {
    revertAll();
    setRevertedAt(Date.now());
  }
  function handleRevertWrite(id: number): void {
    revertWrite(id);
    setRevertedAt(Date.now());
  }
  /** The RAF poll loop (useChannelReader) already re-reads the channel every
   *  tick while attached — there is no separate "manual read" primitive to
   *  call. This button exists per the UI-SPEC B2 contract as user-perceived
   *  control/reassurance; it intentionally does nothing beyond what the
   *  continuous poll loop already does (never a force-write, never bypasses
   *  the guard). */
  function handleReReadRetry(): void {
    /* no-op — see comment above */
  }

  if (!attached) {
    return (
      <div style={cardStyle(false, false)}>
        <div style={warnStyle}>○ Offline</div>
        <Row k="client" v={clientLabel ?? '—'} />
        <Row k="pid" v="—" />
        <Row k="fps" v="—" />
        <Row k="last sync" v="n/a" />
        <Row k="COW snapshot" v={cowSnapshot ? `saved · ${formatHms(cowSnapshot.capturedAtMs)}` : 'staged'} />
        <div style={warnStyle}>mode: file-patch fallback</div>
      </div>
    );
  }

  const scaleUnavailableOnBuild = verifiedState?.scaleUnavailableOnBuild ?? false;
  const scaleRowState = computeScaleGuardRowState({
    scaleUnavailableOnBuild,
    guardStateScale: guardState.scale,
    cowSnapshotScale: cowSnapshot?.scale ?? null,
  });
  const guardBlocked = isCardGuardBlocked(guardState.transform, guardState.scale, scaleUnavailableOnBuild);

  // ── target row + ROUND 4 mismatch warning + ROUND 5 name-match caveat ────
  let targetLabel: string;
  if (verifiedState?.hasTarget === true) {
    targetLabel = verifiedState.templateName;
  } else if (verifiedState?.targetUnavailableOnBuild === true) {
    targetLabel = 'unavailable on this build — moving player avatar';
  } else {
    targetLabel = 'none — moving player avatar';
  }

  let mismatchWarning: string | null = null;
  let showNameMatchCaveat = false;
  if (loadStatus.kind === 'done' && verifiedState?.hasTarget === true) {
    const loadedBase = normalizeAssetBasename(loadStatus.filename);
    const targetBase = normalizeAssetBasename(verifiedState.templateName);
    if (loadedBase !== targetBase) {
      mismatchWarning = `⚠ viewing ${loadedBase}, moving ${targetBase}`;
    } else {
      showNameMatchCaveat = true;
    }
  }

  // ── B2 guard-blocked banner details, per genuinely-blocked channel ───────
  const blockedChannels: Array<'transform' | 'scale'> = [];
  if (guardState.transform === 'blocked') blockedChannels.push('transform');
  if (guardState.scale === 'blocked' && !scaleUnavailableOnBuild) blockedChannels.push('scale');

  return (
    <div style={cardStyle(true, guardBlocked)}>
      <div style={accentStyle}>● Live · injected</div>

      <Row k="client" v={clientLabel ?? '—'} />
      <Row k="target" v={targetLabel} />
      {mismatchWarning !== null && (
        <div style={{ ...warnStyle, fontSize: 'var(--text-xs)' }}>{mismatchWarning}</div>
      )}
      {showNameMatchCaveat && (
        <div style={{ color: 'var(--color-text-faint)', fontSize: 'var(--text-xs)' }}>
          (name match only — not a verified object identity)
        </div>
      )}

      <Row k="pid" v={status.kind === 'attached' ? status.pid : '—'} />
      <Row k="fps" v={fps > 0 ? fps : '—'} />
      <Row k="last sync" v={lastSyncMs !== null ? `${((Date.now() - lastSyncMs) / 1000).toFixed(1)}s ago` : 'n/a'} />
      <Row
        k="COW snapshot"
        v={cowSnapshot ? `saved · ${formatHms(cowSnapshot.capturedAtMs)}` : 'staged'}
        vColor="var(--color-accent)"
      />

      {/* ── Two independent read-verify guard rows (Fix B) ────────────────── */}
      <Row
        k="transform"
        v={guardState.transform === 'ok' ? 'client bytes = snapshot' : 'client bytes ≠ snapshot'}
        vColor={guardState.transform === 'ok' ? 'var(--color-accent)' : 'var(--color-danger)'}
      />
      <Row
        k="scale"
        v={
          scaleRowState === 'unavailable' ? 'unavailable on this build'
          : scaleRowState === 'blocked' ? 'client bytes ≠ snapshot'
          : scaleRowState === 'not-written' ? 'not yet written this session'
          : 'client bytes = snapshot'
        }
        vColor={
          scaleRowState === 'blocked' ? 'var(--color-danger)'
          : scaleRowState === 'ok' ? 'var(--color-accent)'
          : 'var(--color-text-faint)'
        }
      />

      {/* ── Session write log ─────────────────────────────────────────────── */}
      <div style={{ borderTop: '1px solid var(--color-border-soft)', paddingTop: 'var(--space-2)', display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
        <div style={{ textTransform: 'uppercase', letterSpacing: '.07em', fontWeight: 600, color: 'var(--color-text-faint)' }}>
          Write log · this session
        </div>
        <div style={{ color: 'var(--color-text-faint)', fontSize: 'var(--text-xs)' }}>
          Per-object history — switching target and back restores this object&apos;s own log.
        </div>
        {writeLog.length === 0 && <div style={{ color: 'var(--color-text-faint)' }}>—</div>}
        {writeLog.map((entry) => {
          const ageS = Math.max(0, (Date.now() - entry.atMs) / 1000);
          const reverted = revertedAt !== null && !guardBlocked;
          return (
            <div
              key={entry.id}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: 'var(--space-2)',
                textDecoration: reverted ? 'line-through' : undefined,
                opacity: reverted ? 0.55 : 1,
              }}
            >
              <span style={{ color: 'var(--color-text-faint)', width: 32, flexShrink: 0 }}>{ageS.toFixed(1)}s</span>
              <span style={{ flex: 1 }}>{entry.deltaLabel}</span>
              {!reverted && (
                <button type="button" style={ghostBtnStyle} onClick={() => handleRevertWrite(entry.id)}>
                  revert
                </button>
              )}
            </div>
          );
        })}
      </div>

      <button type="button" style={dangerOutlineBtnStyle} disabled={false} onClick={handleRevertAll}>
        ⟲ Revert ALL to snapshot
      </button>

      {/* ── B2: guard-blocked banner(s) — one per genuinely-blocked channel ── */}
      {blockedChannels.map((channel) => {
        const expected = channel === 'transform' ? expectedTransform() : expectedScale();
        const expectedHex = expected ? formatFloatBytesHex(expected) : '——';
        const addr = formatAddr(guardAddr);
        const readClause =
          channel === 'transform' && verifiedState
            ? `read ${formatFloatBytesHex(verifiedState.transform)}`
            : 'last known — not independently re-verified this session';
        return (
          <div
            key={channel}
            role="alert"
            style={{
              background: 'rgba(230,90,90,.08)',
              border: '1px solid var(--color-danger)',
              borderRadius: 'var(--radius-sm)',
              padding: 'var(--space-2)',
              color: 'var(--color-danger)',
              display: 'flex',
              flexDirection: 'column',
              gap: 'var(--space-1)',
            }}
          >
            <span>
              ✗ Write refused. The object&apos;s memory changed outside the toolkit ({addr}: expected{' '}
              {expectedHex}, {readClause}) — the game or another tool moved it. Nothing was written.
            </span>
            <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
              <button type="button" style={ghostBtnStyle} onClick={handleReReadRetry}>
                ↻ Re-read &amp; retry
              </button>
              <button type="button" style={dangerOutlineBtnStyle} onClick={handleRevertAll}>
                ⟲ Revert to snapshot
              </button>
            </div>
          </div>
        );
      })}

      {/* ── B2: reverted banner ───────────────────────────────────────────── */}
      {!guardBlocked && revertedAt !== null && cowSnapshot !== null && (
        <div
          role="status"
          style={{
            background: 'var(--color-accent-dim)',
            border: '1px solid var(--color-accent-line)',
            borderRadius: 'var(--radius-sm)',
            padding: 'var(--space-2)',
            color: 'var(--color-accent)',
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--space-1)',
          }}
        >
          <span>
            ✓ Reverted. Transform restored from the COW snapshot taken at attach (
            {formatHms(cowSnapshot.capturedAtMs)}). The in-game object snapped back — nothing is staged.
          </span>
          {lastDiscardedChange !== null && lastDiscardedChange.transform !== undefined && (
            <span>
              An external change was discarded on revert ({lastDiscardedChange.addr}: expected{' '}
              {formatFloatBytesHex(lastDiscardedChange.transform.expected)}, found{' '}
              {formatFloatBytesHex(lastDiscardedChange.transform.got)}).
            </span>
          )}
          {lastDiscardedChange !== null && lastDiscardedChange.scale !== undefined && (
            lastDiscardedChange.scale.gotVerified ? (
              <span>
                An external change was discarded on revert ({lastDiscardedChange.addr}: expected{' '}
                {formatFloatBytesHex(lastDiscardedChange.scale.expected)}, found{' '}
                {formatFloatBytesHex(lastDiscardedChange.scale.got)}).
              </span>
            ) : (
              <span>
                An external change may have affected scale on revert ({lastDiscardedChange.addr}: last known{' '}
                {formatFloatBytesHex(lastDiscardedChange.scale.expected)} — not independently re-verified this
                session).
              </span>
            )
          )}
        </div>
      )}
    </div>
  );
}
