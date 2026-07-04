/**
 * packages/renderer/src/panels/deploy/DeleteProjectConfirmModal.tsx
 * Shared descriptive delete-confirm modal — sketch 017 (Variant B) elements #3-#13.
 *
 * Consumed by both `ProjectListDialog`'s and `WorkspaceEntry`'s per-row kebab "Delete
 * project…" menu item. Reads the target project's manifest (via getStudioDir + readManifest
 * — store-independent, works whether or not the project is the currently-open workspace) to
 * render numbered plan lines that vary by deploy model:
 *   - loose-model  ('overrideDir' in the carrier changeset's deployRecord)
 *   - cfg-model    (deployRecord present, cfg shape)
 *   - never-deployed (no deployRecord on any changeset)
 *
 * Round-2 in-flight guard: the Delete button disables itself (label → "Deleting…") for the
 * duration of the caller's onConfirm() call, closing the double-click/double-submit race a
 * second click before the first deleteProject() call resolves would otherwise cause. Cancel is
 * also disabled while in flight (no cancelling out from under an in-flight delete).
 *
 * Locked undo contract (identical wording in 04.4-01/10/14): the undo note below states the
 * project is "parked, not destroyed" — it must NEVER imply the client is re-deployed on Undo.
 *
 * Source: 04.4-10-PLAN.md Task 1; .planning/sketches/017-delete-project-flow/index.html
 * (openConfirm() plan-line branching, elements #3-#13); DeployDialog.tsx (modal chrome
 * conventions mirrored here — overlay/panel/header/footer, Escape-closes).
 */

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import path from 'path';

import { getStudioDir } from '../../services/workspaceService';
import { readManifest } from '../../services/changesetService';
import { detectClients } from '../../services/clientLocator';
import { isConfinedToRoot } from '../../services/pathSafety';
import type { CfgDeployRecord, LooseDeployRecord } from '@swg/contracts';

// ─── Props ────────────────────────────────────────────────────────────────────

export interface DeleteProjectConfirmModalProps {
  /** Absolute project folder — the umbrella folder handed to deleteProject(). */
  projectFolder: string;
  /** Display name shown in the intro line and header. */
  projectName: string;
  /** True when this project IS the currently-open workspace (renders the amber warn-line). */
  isCurrentlyOpen: boolean;
  /** Called when the user clicks "Delete project" — caller awaits its own deleteProject() call. */
  onConfirm: () => void | Promise<void>;
  /** Called when the user cancels (Cancel button, backdrop click, or Escape). */
  onCancel: () => void;
}

// ─── Deploy-model label helper ─────────────────────────────────────────────────

/**
 * Best-effort human label for the client a deployRecord targets. Tries to match a detected
 * client install; falls back to the parent-folder basename of the record's own path; falls
 * back further to a generic "the client" if neither is available. Never throws.
 */
function deriveClientLabel(rec: CfgDeployRecord | LooseDeployRecord | undefined): string {
  if (!rec) return 'the client';
  try {
    const detected = detectClients();
    if ('overrideDir' in rec) {
      const match = detected.find((c) => isConfinedToRoot(rec.overrideDir, c.installPath));
      if (match) return match.name;
      const base = path.basename(path.dirname(rec.overrideDir));
      return base || 'the client';
    }
    const cfgRec = rec as CfgDeployRecord;
    const match = detected.find((c) => c.cfgRootPath === cfgRec.includeTargetPath);
    if (match) return match.name;
    const base = path.basename(path.dirname(cfgRec.includeTargetPath ?? ''));
    return base || 'the client';
  } catch {
    return 'the client';
  }
}

// ─── PlanLine ───────────────────────────────────────────────────────────────────

function Bold({ children }: { children: React.ReactNode }): React.ReactElement {
  return <span style={{ color: 'var(--color-text)', fontWeight: 600 }}>{children}</span>;
}

function PlanLine({
  n, warn, children,
}: { n: number; warn?: boolean; children: React.ReactNode }): React.ReactElement {
  return (
    <div
      style={{
        display: 'flex', gap: 10, padding: '5px var(--space-3)',
        fontSize: 'var(--text-sm)', alignItems: 'baseline',
        color: warn ? 'var(--color-warn)' : 'var(--color-text-muted)',
      }}
    >
      <span
        style={{
          fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', flex: '0 0 14px',
          color: warn ? 'var(--color-warn)' : 'var(--color-accent)',
        }}
      >
        {n}
      </span>
      <span>{children}</span>
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function DeleteProjectConfirmModal({
  projectFolder, projectName, isCurrentlyOpen, onConfirm, onCancel,
}: DeleteProjectConfirmModalProps): React.ReactElement {
  const [isDeleting, setIsDeleting] = useState(false);
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  // Determine the deploy-model plan line + version count from the target project's manifest.
  // Store-independent (never useWorkspaceStore) — works for a project that is NOT the open
  // workspace, per the plan's interfaces note.
  const { planLine, versionCount } = useMemo(() => {
    let manifest: ReturnType<typeof readManifest>;
    try {
      manifest = readManifest(getStudioDir(projectFolder));
    } catch {
      manifest = { activeVersionId: null, deployedVersionId: null, changesets: [] };
    }
    const carrierId = manifest.deployedVersionId ?? manifest.activeVersionId;
    const carrier = carrierId ? manifest.changesets.find((c) => c.id === carrierId) : undefined;
    const rec = carrier?.deployRecord;

    let line: React.ReactNode;
    if (rec && 'overrideDir' in rec) {
      const clientLabel = deriveClientLabel(rec);
      line = (
        <>Revert loose overrides in <Bold>{clientLabel}</Bold> — restore snapshotted originals, remove toolkit-added files.</>
      );
    } else if (rec) {
      const clientLabel = deriveClientLabel(rec);
      const cfgFile = path.basename((rec as CfgDeployRecord).includeTargetPath ?? '') || 'the client config';
      line = (
        <>Restore <Bold>{clientLabel}</Bold>&rsquo;s <Bold>{cfgFile}</Bold> from the pre-deploy snapshot (byte-pristine).</>
      );
    } else {
      line = <>No client changes were ever deployed — <Bold>nothing to restore</Bold>.</>;
    }
    return { planLine: line, versionCount: manifest.changesets.length };
  }, [projectFolder]);

  const handleCancel = useCallback(() => {
    if (isDeleting) return;
    onCancel();
  }, [isDeleting, onCancel]);

  const handleConfirm = useCallback(() => {
    if (isDeleting) return;
    setIsDeleting(true);
    // Call onConfirm() SYNCHRONOUSLY on click (not inside a .then()) so a second click
    // immediately after the first is guaranteed to observe isDeleting===true already set —
    // no microtask delay between "Delete clicked" and "the caller's deleteProject() started".
    const result = onConfirm();
    void Promise.resolve(result).finally(() => {
      if (mountedRef.current) setIsDeleting(false);
    });
  }, [isDeleting, onConfirm]);

  // Escape closes (mirrors DeployDialog.tsx / ProjectListDialog.tsx's own Escape-close
  // convention) — guarded against closing while a delete is in flight.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleCancel();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [handleCancel]);

  return (
    <div
      role="presentation"
      onClick={handleCancel}
      style={overlayStyle}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Delete project?"
        data-testid="delete-project-confirm-modal"
        onClick={(e) => e.stopPropagation()}
        style={panelStyle}
      >
        <div style={headerStyle}>
          <span aria-hidden="true" style={{ color: 'var(--color-danger)', fontSize: 15 }}>⚠</span>
          <span style={{ fontWeight: 600, fontSize: 'var(--text-md)', color: 'var(--color-text)' }}>
            Delete project?
          </span>
        </div>

        <div style={{ padding: 'var(--space-4)' }}>
          <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text)', marginBottom: 'var(--space-3)' }}>
            Delete <Bold>{projectName}</Bold>? Here&rsquo;s exactly what will happen:
          </div>

          <div style={planBoxStyle}>
            <PlanLine n={1}>{planLine}</PlanLine>
            <PlanLine n={2}>
              Park the project + all <Bold>{versionCount}</Bold> saved versions in the session
              trash (nothing destroyed).
            </PlanLine>
            <PlanLine n={3}>Remove it from this list and from Recent projects.</PlanLine>
            {isCurrentlyOpen && (
              <PlanLine n={4} warn>
                This project is <Bold>currently open</Bold> — the workspace will close and
                return to Welcome.
              </PlanLine>
            )}
          </div>

          <div style={undoNoteStyle}>
            <span aria-hidden="true" style={{ color: 'var(--color-accent)' }}>↩</span>
            <span>
              Undoable until you close the app — the project and all its versions are parked,
              not destroyed.
            </span>
          </div>
        </div>

        <div style={footerStyle}>
          <button
            style={secondaryBtnStyle}
            disabled={isDeleting}
            onClick={handleCancel}
            aria-label="Cancel"
          >
            Cancel
          </button>
          <button
            style={dangerBtnStyle(isDeleting)}
            disabled={isDeleting}
            onClick={handleConfirm}
            aria-label="Delete project"
          >
            {isDeleting ? 'Deleting…' : 'Delete project'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const overlayStyle: React.CSSProperties = {
  position: 'fixed', inset: 0, zIndex: 1100,
  background: 'rgba(0,0,0,0.55)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
};

const panelStyle: React.CSSProperties = {
  width: 430, maxWidth: '92vw',
  background: 'var(--color-surface)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-md)',
  boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
  overflow: 'hidden',
  fontFamily: 'var(--font-sans)',
};

const headerStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8, height: 40,
  padding: '0 var(--space-4)', background: 'var(--color-header)',
  borderBottom: '1px solid var(--color-border)',
};

const planBoxStyle: React.CSSProperties = {
  border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)',
  background: 'var(--color-surface-2)', padding: 'var(--space-2) 0',
  marginBottom: 'var(--space-3)',
};

const undoNoteStyle: React.CSSProperties = {
  display: 'flex', gap: 8, alignItems: 'baseline',
  fontSize: 'var(--text-xs)', color: 'var(--color-text-faint)',
  padding: 'var(--space-2) var(--space-1) 0',
};

const footerStyle: React.CSSProperties = {
  display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-2)',
  padding: 'var(--space-3) var(--space-4)', background: 'var(--color-header)',
  borderTop: '1px solid var(--color-border)',
};

const secondaryBtnStyle: React.CSSProperties = {
  background: 'var(--color-widget)', color: 'var(--color-text)',
  border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)',
  fontWeight: 600, fontSize: 'var(--text-sm)', padding: '7px 14px', cursor: 'pointer',
};

function dangerBtnStyle(disabled: boolean): React.CSSProperties {
  return {
    background: 'var(--color-danger)', borderColor: 'var(--color-danger)',
    border: '1px solid var(--color-danger)', color: '#fff',
    borderRadius: 'var(--radius-sm)', fontWeight: 600, fontSize: 'var(--text-sm)',
    padding: '7px 14px', cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.75 : 1,
  };
}
