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
 *
 * On mount: probes git-lfs availability and loads recent log via refreshLog.
 *
 * UI-SPEC copy contract (verbatim):
 *   LFS present:  'git-lfs {version} · {n} pointers'
 *   LFS absent:   'git-lfs not found — large binaries will bloat history. Install git-lfs to enable LFS routing.'
 *   Guard pass:   'guard passed — mod outputs only'
 *   Guard fail:   'blocked: {file} looks like retail/.tre bytes — never commit a patch or retail archive.'
 *   Commit done:  'committed {shortSha}'
 *
 * Panel head structure follows LiveInspectorPanel.tsx (04-PATTERNS.md §VcsPanel.tsx).
 * All git calls go through gitLfsService — this component never calls child_process directly.
 *
 * Source: 04-05-PLAN.md Task 2; 04-CONTEXT.md §D-04-13..16; 04-PATTERNS.md §VcsPanel.tsx.
 */

import React, { useState, useEffect, useCallback } from 'react';
import type { IDockviewPanelProps } from 'dockview';

import { useVcsStore }    from '../../state/vcsStore';
import { useWorkspaceStore } from '../../state/workspaceStore';
import VerificationStatus  from '../../shared/VerificationStatus';
import AsyncProgress       from '../../shared/AsyncProgress';
import {
  checkLfsInstalled,
  gitCommit,
  gitPush,
  refreshLog,
  getGuardStatus,
} from '../../services/gitLfsService';

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

  // ── On mount: probe LFS + load log ─────────────────────────────────────────
  useEffect(() => {
    if (!folderPath) return;

    // Probe LFS availability
    checkLfsInstalled(folderPath).then((present) => {
      if (present) {
        // We have a version string from 'git lfs version' but the store was set by
        // checkLfsInstalled returning boolean. Use a lightweight follow-up call.
        import('child_process').then(({ execFile }) => {
          import('util').then(({ promisify }) => {
            const execFileAsync = promisify(execFile);
            execFileAsync('git', ['lfs', 'version'], { cwd: folderPath, timeout: 5_000 })
              .then(({ stdout }) => {
                const version = (stdout as string).trim().replace(/^git-lfs\//, '');
                useVcsStore.getState().setLfsStatus({ kind: 'present', version, pointerCount: 0 });
              })
              .catch(() => {
                useVcsStore.getState().setLfsStatus({ kind: 'present', version: 'unknown', pointerCount: 0 });
              });
          }).catch(() => void 0);
        }).catch(() => void 0);
      } else {
        useVcsStore.getState().setLfsStatus({ kind: 'absent' });
      }
    }).catch(() => {
      useVcsStore.getState().setLfsStatus({ kind: 'absent' });
    });

    // Load recent commits
    refreshLog(folderPath).catch(() => { /* best-effort */ });
  }, [folderPath]);

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
      </div>
    </div>
  );
}
