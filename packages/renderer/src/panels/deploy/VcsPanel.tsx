/**
 * packages/renderer/src/panels/deploy/VcsPanel.tsx
 * Dockable VCS (Git/LFS) panel — Phase 4 DEPLOY-04 surface.
 *
 * Surfaces:
 *   - git-lfs status banner: 'git-lfs {version} · {n} pointers' or absent warning
 *   - App-side pre-commit guard result: 'guard passed — mod outputs only' or blocked message
 *   - Commit message textarea (var(--color-bg) — NOT --color-input which is undefined)
 *   - Commit button (calls getGuardStatus, then gitCommit with .studio changeset paths)
 *   - Push button (calls gitPush)
 *   - Recent commit log feed
 *   - Server Push section (04.4-12) — visible only when workspace.serverConfig is set; dispatches
 *     on serverConfig.type ('core3-wsl2' -> core3ServerPush.ts / 'swgsource-docker' ->
 *     swgMainServerPush.ts), rehydrates its last-push record from disk on mount so Reset survives
 *     a panel remount or app restart, and shows per-flavor post-push reload guidance.
 *
 * On mount: probes git-lfs availability, loads recent log via refreshLog, and rehydrates the
 * Server Push record (if any) from studioDir/serverPush.{core3,swgmain}.json.
 *
 * UI-SPEC copy contract (verbatim):
 *   LFS present:  'git-lfs {version} · {n} pointers'
 *   LFS absent:   'git-lfs not found — large binaries will bloat history. Install git-lfs to enable LFS routing.'
 *   Guard pass:   'guard passed — mod outputs only'
 *   Guard fail:   'blocked: {file} looks like retail/.tre bytes — never commit a patch or retail archive.'
 *   Commit done:  'committed {shortSha}'
 *   Core3 push guidance:    'Pushed. Restart Core3 to load it — the server reads its TRE list once at boot.'
 *   swg-main push guidance: 'Pushed. New files are live for not-yet-loaded assets; already-loaded
 *                            datatables/templates need the server console's reloadTable/reloadServerTemplate
 *                            (or a restart).'
 *
 * ROUND-2 LOCKED CONTRACT: resetCore3TreOverride/resetSwgMainOverride NEVER clear their persisted
 * serverPush.*.json record file themselves — this panel's handleServerReset is the SOLE caller
 * that explicitly clears it, unconditionally, immediately after a successful reset* call.
 *
 * Panel head structure follows LiveInspectorPanel.tsx (04-PATTERNS.md §VcsPanel.tsx).
 * All git calls go through gitLfsService — this component never calls child_process directly.
 *
 * Source: 04-05-PLAN.md Task 2; 04-CONTEXT.md §D-04-13..16; 04-PATTERNS.md §VcsPanel.tsx;
 *         04.4-12-PLAN.md (Server Push section); 04.4-07/08-PLAN.md (core3ServerPush.ts /
 *         swgMainServerPush.ts).
 */

import React, { useState, useEffect, useCallback } from 'react';
import type { IDockviewPanelProps } from 'dockview';
import path from 'path';

import type { LooseDeployRecord } from '@swg/contracts';

import { useVcsStore }    from '../../state/vcsStore';
import { useWorkspaceStore } from '../../state/workspaceStore';
import VerificationStatus  from '../../shared/VerificationStatus';
import AsyncProgress       from '../../shared/AsyncProgress';
import {
  gitCommit,
  gitPush,
  refreshLog,
  getGuardStatus,
  probeLfsStatus,
} from '../../services/gitLfsService';
import { readManifest } from '../../services/changesetService';
import {
  pushCore3TreOverride,
  resetCore3TreOverride,
  readCore3PushRecord,
  clearCore3PushRecordFile,
  type Core3PushRecord,
} from '../../services/core3ServerPush';
import {
  pushSwgMainOverride,
  resetSwgMainOverride,
  readSwgMainPushRecord,
  clearSwgMainPushRecordFile,
} from '../../services/swgMainServerPush';

// ─── Server Push types ──────────────────────────────────────────────────────

type ServerPushRecord = Core3PushRecord | LooseDeployRecord;

/** Best-effort read of the current manifest's activeVersionId — never throws. */
function activeVersionIdFor(studioDir: string): string | null {
  try {
    return readManifest(studioDir).activeVersionId ?? null;
  } catch {
    return null;
  }
}

// ─── Button styles (mirrors ExportDialog.tsx lines 483-506) ──────────────────

function primaryBtnStyle(disabled: boolean): React.CSSProperties {
  return {
    background:   disabled ? 'var(--color-widget)' : 'var(--color-accent)',
    border:       'none',
    color:        disabled ? 'var(--color-text-faint)' : 'var(--color-accent-text)',
    borderRadius: 'var(--radius-sm)',
    padding:      '6px 16px',
    cursor:       disabled ? 'not-allowed' : 'pointer',
    fontSize:     'var(--text-sm)',
    fontWeight:   600,
    opacity:      disabled ? 0.6 : 1,
    transition:   'opacity 0.1s ease',
  };
}

const secondaryBtnStyle: React.CSSProperties = {
  background:   'transparent',
  border:       '1px solid var(--color-border)',
  color:        'var(--color-text-muted)',
  borderRadius: 'var(--radius-sm)',
  padding:      '3px 10px',
  cursor:       'pointer',
  fontSize:     'var(--text-xs)',
};

// ─── Panel ────────────────────────────────────────────────────────────────────

export default function VcsPanel(_props: IDockviewPanelProps): React.ReactElement {
  const [commitMsg, setCommitMsg] = useState('');

  // Workspace state
  const folderPath = useWorkspaceStore((s) => s.folderPath);

  // VCS state from store
  const commitStatus = useVcsStore((s) => s.commitStatus);
  const lfsStatus    = useVcsStore((s) => s.lfsStatus);
  const guardResult  = useVcsStore((s) => s.guardResult);
  const log          = useVcsStore((s) => s.log);

  // ── Server Push state (04.4-12) ─────────────────────────────────────────────
  const serverConfig = useWorkspaceStore((s) =>
    s.status.kind === 'ready' ? s.status.info.serverConfig : undefined,
  );
  const studioDir     = useWorkspaceStore((s) => s.studioDir);
  const workspaceName = useWorkspaceStore((s) => s.workspaceName);

  const [pushRecord, setPushRecord] = useState<ServerPushRecord | null>(null);
  const [pushBusy, setPushBusy]     = useState(false);
  const [pushError, setPushError]   = useState<string | null>(null);
  const [pushGuidance, setPushGuidance] = useState<string | null>(null);
  const [resetError, setResetError] = useState<string | null>(null);

  // ── On mount: probe LFS + load log ─────────────────────────────────────────
  useEffect(() => {
    if (!folderPath) return;

    // Probe LFS availability and update vcsStore.lfsStatus via gitLfsService.
    // VcsPanel never calls child_process directly — all git I/O goes through gitLfsService.
    probeLfsStatus(folderPath).catch(() => {
      useVcsStore.getState().setLfsStatus({ kind: 'absent' });
    });

    // Load recent commits
    refreshLog(folderPath).catch(() => { /* best-effort */ });
  }, [folderPath]);

  // ── Server Push: rehydrate the last push record from disk (04.4-12) ────────
  // Runs on mount and whenever serverConfig/studioDir change — this is what makes the Reset
  // button available again after a panel remount or app restart, not just in-memory state.
  useEffect(() => {
    setPushError(null);
    setResetError(null);
    setPushGuidance(null);

    if (!serverConfig || !studioDir) {
      setPushRecord(null);
      return;
    }

    const record =
      serverConfig.type === 'core3-wsl2'
        ? readCore3PushRecord(studioDir)
        : readSwgMainPushRecord(studioDir);
    setPushRecord(record);
  }, [serverConfig, studioDir]);

  // Gates the Push button — a never-saved project has nothing to push.
  const activeVersionId = studioDir ? activeVersionIdFor(studioDir) : null;

  // ── Server Push handlers ─────────────────────────────────────────────────────
  const handleServerPush = useCallback(async () => {
    if (!serverConfig || !studioDir || !workspaceName || !activeVersionId) return;
    if (pushBusy) return;

    setPushBusy(true);
    setPushError(null);
    setPushGuidance(null);

    try {
      const manifest = readManifest(studioDir);

      if (serverConfig.type === 'core3-wsl2') {
        const confDir = path.join(serverConfig.path, 'conf');
        // Round-2 note: projectSlug is display-name-derived and shares getStudioDir's
        // pre-existing basename-collision surface — see 04.4-12-PLAN.md objective. Not fixed here.
        const record = pushCore3TreOverride(
          confDir,
          studioDir,
          activeVersionId,
          manifest,
          path.basename(workspaceName),
        );
        setPushRecord(record);
        setPushGuidance(
          'Pushed. Restart Core3 to load it — the server reads its TRE list once at boot.',
        );
      } else {
        const servercommonCfgPath = path.join(serverConfig.path, 'exe', 'shared', 'servercommon.cfg');
        const record = pushSwgMainOverride(servercommonCfgPath, studioDir, activeVersionId, manifest);
        setPushRecord(record);
        setPushGuidance(
          'Pushed. New files are live for not-yet-loaded assets; already-loaded ' +
            'datatables/templates need the server console\'s reloadTable/reloadServerTemplate (or a restart).',
        );
      }
    } catch (err) {
      setPushError(String((err as Error)?.message ?? err));
    } finally {
      setPushBusy(false);
    }
  }, [serverConfig, studioDir, workspaceName, activeVersionId, pushBusy]);

  const handleServerReset = useCallback(() => {
    if (!serverConfig || !studioDir || !pushRecord) return;

    setResetError(null);

    try {
      if (serverConfig.type === 'core3-wsl2') {
        resetCore3TreOverride(pushRecord as Core3PushRecord);
      } else {
        resetSwgMainOverride(pushRecord as LooseDeployRecord);
      }

      // ROUND-2 LOCKED CONTRACT: reset* NEVER clears the persisted record file itself — the
      // Reset handler ALWAYS calls the matching clear function explicitly, right after a
      // successful reset, unconditionally.
      if (serverConfig.type === 'core3-wsl2') {
        clearCore3PushRecordFile(studioDir);
      } else {
        clearSwgMainPushRecordFile(studioDir);
      }

      setPushRecord(null);
      setPushGuidance(null);
    } catch (err) {
      setResetError(String((err as Error)?.message ?? err));
    }
  }, [serverConfig, studioDir, pushRecord]);

  // ── Commit handler ──────────────────────────────────────────────────────────
  const handleCommit = useCallback(async () => {
    if (!folderPath || !commitMsg.trim()) return;
    if (commitStatus.kind === 'committing') return;

    // App-side guard (D-04-15 defense-in-depth)
    const guard = await getGuardStatus(folderPath);
    if (!guard?.passed) return; // guardResult in store now shows the failure

    // Stage the .studio changeset metadata explicitly (D-04-15: never git add .)
    const stagePaths = ['.studio'];

    try {
      await gitCommit(folderPath, commitMsg, stagePaths);
      setCommitMsg('');
    } catch {
      // commitError already in vcsStore from gitCommit
    }
  }, [folderPath, commitMsg, commitStatus.kind]);

  // ── Push handler ────────────────────────────────────────────────────────────
  const handlePush = useCallback(async () => {
    if (!folderPath) return;
    try {
      await gitPush(folderPath);
    } catch {
      // error surfaced via vcsStore
    }
  }, [folderPath]);

  // ── Derived UI state ────────────────────────────────────────────────────────
  const isCommitting  = commitStatus.kind === 'committing';
  const canCommit     = Boolean(commitMsg.trim()) && Boolean(folderPath) && !isCommitting;
  const noWorkspace   = !folderPath;

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div
      style={{
        display:       'flex',
        flexDirection: 'column',
        height:        '100%',
        background:    'var(--color-surface)',
        color:         'var(--color-text)',
        fontFamily:    'var(--font-sans)',
        overflow:      'hidden',
      }}
    >
      {/* Panel head */}
      <div
        style={{
          display:      'flex',
          alignItems:   'center',
          height:       'var(--tabstrip-h)',
          background:   'var(--color-header)',
          borderBottom: '1px solid var(--color-border)',
          padding:      '0 var(--space-2)',
          gap:          'var(--space-2)',
          flexShrink:   0,
        }}
      >
        <span
          style={{
            fontFamily: 'var(--font-sans)',
            fontSize:   'var(--text-sm)',
            fontWeight: 600,
            color:      'var(--color-text)',
          }}
        >
          Git / LFS
        </span>
      </div>

      {/* Body */}
      <div
        style={{
          flex:          1,
          overflowY:     'auto',
          display:       'flex',
          flexDirection: 'column',
          gap:           'var(--space-3)',
          padding:       'var(--space-3)',
          minHeight:     0,
        }}
      >
        {/* No workspace state */}
        {noWorkspace && (
          <div
            style={{
              display:       'flex',
              flexDirection: 'column',
              alignItems:    'center',
              justifyContent:'center',
              flex:          1,
              gap:           'var(--space-2)',
              color:         'var(--color-text-muted)',
              fontSize:      'var(--text-sm)',
              textAlign:     'center',
              padding:       'var(--space-4)',
            }}
          >
            <span>No mod workspace open</span>
            <span style={{ color: 'var(--color-text-faint)', fontSize: 'var(--text-xs)' }}>
              Open or create a workspace to use Git/LFS.
            </span>
          </div>
        )}

        {/* LFS status banner */}
        {!noWorkspace && lfsStatus.kind !== 'unknown' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            {lfsStatus.kind === 'present' ? (
              <VerificationStatus
                variant="pass"
                caption={`git-lfs ${lfsStatus.version} · ${lfsStatus.pointerCount} pointers`}
              />
            ) : (
              <VerificationStatus
                variant="warn"
                caption="git-lfs not found — large binaries will bloat history. Install git-lfs to enable LFS routing."
              />
            )}
          </div>
        )}

        {/* Pre-commit guard result */}
        {!noWorkspace && guardResult !== null && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            {guardResult.passed ? (
              <VerificationStatus
                variant="pass"
                caption="guard passed — mod outputs only"
              />
            ) : (
              <VerificationStatus
                variant="fail"
                caption={`blocked: ${guardResult.file} looks like retail/.tre bytes — never commit a patch or retail archive.`}
                ariaLabel="Pre-commit guard failed"
              />
            )}
          </div>
        )}

        {/* Commit message textarea */}
        {!noWorkspace && (
          <textarea
            aria-label="Commit message"
            placeholder="Describe this changeset…"
            value={commitMsg}
            onChange={(e) => setCommitMsg(e.currentTarget.value)}
            rows={4}
            style={{
              // CRITICAL: var(--color-bg) NOT var(--color-input) — --color-input is undefined (W3)
              background:   'var(--color-bg)',
              border:       '1px solid var(--color-border)',
              borderRadius: 'var(--radius-sm)',
              padding:      'var(--space-2)',
              fontFamily:   'var(--font-sans)',
              fontSize:     'var(--text-base)',
              color:        'var(--color-text)',
              resize:       'vertical',
              width:        '100%',
              boxSizing:    'border-box',
            }}
          />
        )}

        {/* Commit in-flight progress */}
        {isCommitting && (
          <AsyncProgress caption="Committing changeset…" />
        )}

        {/* Commit status feedback */}
        {!isCommitting && commitStatus.kind === 'done' && (
          <VerificationStatus
            variant="pass"
            caption={`committed ${commitStatus.shortSha}`}
          />
        )}
        {!isCommitting && commitStatus.kind === 'error' && (
          <VerificationStatus
            variant="fail"
            caption={`commit failed — ${commitStatus.reason}`}
          />
        )}

        {/* Action buttons */}
        {!noWorkspace && (
          <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
            <button
              aria-label="Commit changeset"
              title={canCommit ? 'Commit staged mod outputs' : 'Enter a commit message first'}
              disabled={!canCommit}
              onClick={() => void handleCommit()}
              style={primaryBtnStyle(!canCommit)}
            >
              Commit
            </button>
            <button
              aria-label="Push to remote"
              title="Push commits to remote (git push)"
              onClick={() => void handlePush()}
              style={secondaryBtnStyle}
            >
              Push
            </button>
          </div>
        )}

        {/* Commit log feed */}
        {!noWorkspace && log.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
            <span
              style={{
                fontSize:    'var(--text-xs)',
                color:       'var(--color-text-faint)',
                fontFamily:  'var(--font-sans)',
                marginBottom:'var(--space-1)',
              }}
            >
              Recent commits
            </span>
            {log.map((entry) => (
              <div
                key={entry.shortSha}
                style={{
                  display:    'flex',
                  alignItems: 'baseline',
                  gap:        'var(--space-2)',
                  fontSize:   'var(--text-xs)',
                }}
              >
                <code
                  style={{
                    fontFamily:  'var(--font-mono)',
                    color:       'var(--color-accent)',
                    flexShrink:  0,
                  }}
                >
                  {entry.shortSha}
                </code>
                <span
                  style={{
                    color:        'var(--color-text)',
                    flex:         1,
                    overflow:     'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace:   'nowrap',
                  }}
                >
                  {entry.subject}
                </span>
                <span
                  style={{
                    color:      'var(--color-text-faint)',
                    flexShrink: 0,
                  }}
                >
                  {entry.relativeTime}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Server Push section (04.4-12) — visible ONLY when workspace.serverConfig is set */}
        {!noWorkspace && serverConfig && (
          <div
            style={{
              display:       'flex',
              flexDirection: 'column',
              gap:           'var(--space-2)',
              paddingTop:    'var(--space-3)',
              borderTop:     '1px solid var(--color-border)',
            }}
          >
            <span
              style={{
                fontFamily: 'var(--font-sans)',
                fontSize:   'var(--text-sm)',
                fontWeight: 600,
                color:      'var(--color-text)',
              }}
            >
              Server Push
            </span>

            <div
              style={{
                display:       'flex',
                flexDirection: 'column',
                fontSize:      'var(--text-xs)',
                color:         'var(--color-text-muted)',
              }}
            >
              <span>{serverConfig.type}</span>
              <span style={{ color: 'var(--color-text-faint)', wordBreak: 'break-all' }}>
                {serverConfig.path}
              </span>
            </div>

            <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
              <button
                aria-label="Push to Server"
                title={
                  activeVersionId
                    ? 'Push the active version override to this server'
                    : 'no saved version yet'
                }
                disabled={!activeVersionId || pushBusy}
                onClick={() => void handleServerPush()}
                style={primaryBtnStyle(!activeVersionId || pushBusy)}
              >
                Push to Server
              </button>
              {pushRecord && (
                <button
                  aria-label="Reset server push"
                  title="Undo the server push"
                  onClick={handleServerReset}
                  style={secondaryBtnStyle}
                >
                  Reset
                </button>
              )}
            </div>

            {!activeVersionId && (
              <span style={{ color: 'var(--color-text-faint)', fontSize: 'var(--text-xs)' }}>
                no saved version yet
              </span>
            )}

            {pushBusy && <AsyncProgress caption="Pushing to server…" />}

            {pushError && (
              <VerificationStatus
                variant="fail"
                caption={`push failed — ${pushError}`}
              />
            )}

            {pushGuidance && (
              <VerificationStatus variant="pass" caption={pushGuidance} />
            )}

            {resetError && (
              <VerificationStatus
                variant="fail"
                caption={`reset failed — ${resetError}`}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
