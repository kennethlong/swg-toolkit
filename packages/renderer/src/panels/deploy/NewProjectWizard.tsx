/**
 * packages/renderer/src/panels/deploy/NewProjectWizard.tsx
 * PROJ-01 New-Project wizard — 4-step stepper modal (007-C).
 *
 * Steps:
 *   1. Name & location — folder via workspace:pick-dir IPC
 *   2. Bind client — detected-install radio rows + Browse + unconfirmed-directory branch
 *      M6: "Yes, treat as client" forces kind:'client', overriding detectFolderKind
 *   3. Local server (optional, CAPTURE ONLY — D-01): type + path + host:port; no push UI
 *   4. Seed assets — client TRE set (recommended) vs start empty
 *      M5: "start empty" does NOT suppress auto-mount for a client binding; it only skips
 *      staging pre-population (a future concern; no staging seed logic in this phase)
 *
 * On Finish → calls projectBinding.initProject(folder, { overrideKind, serverConfig })
 *
 * Accessibility: role="dialog" aria-modal, Esc cancels, backdrop click cancels,
 * autofocus first input per step (Accessibility Rule 1).
 *
 * W1 fix: primaryBtnStyle / secondaryBtnStyle are LOCAL — NOT shared via ExportDialog.
 *
 * Source: 04.1-04-PLAN.md Task 2; 04.1-UI-SPEC.md Surface 2 §007-C, Surface 3;
 *         04.1-PATTERNS.md §NewProjectWizard.tsx.
 */

import React, {
  useState,
  useCallback,
  useEffect,
  useRef,
} from 'react';
import { detectClients } from '../../services/clientLocator';
import type { DetectedClient, TypedIpcRenderer } from '@swg/contracts';
import * as projectBinding from '../../services/projectBinding';
import type { InitProjectOptions } from '../../services/projectBinding';
import { resolveLayout, type ClientLayout } from '../../services/clientLayout';

// ─── IPC bridge (Path B — same pattern as WorkspaceEntry.tsx) ────────────────
// TypedIpcRenderer from @swg/contracts is the single source of truth for channel types.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { ipcRenderer } = require('electron') as { ipcRenderer: TypedIpcRenderer };

// ─── Button styles (W1 fix — LOCAL const functions) ───────────────────────────

function primaryBtnStyle(disabled: boolean): React.CSSProperties {
  return {
    background:   disabled ? 'var(--color-widget)' : 'var(--color-accent)',
    border:       'none',
    color:        disabled ? 'var(--color-text-faint)' : 'var(--color-accent-text)',
    borderRadius: 'var(--radius-sm)',
    padding:      '4px 14px',
    cursor:       disabled ? 'not-allowed' : 'pointer',
    fontSize:     'var(--text-sm)',
    fontWeight:   600,
    opacity:      disabled ? 0.6 : 1,
    transition:   'opacity 0.1s ease',
    flexShrink:   0,
  };
}

const secondaryBtnStyle: React.CSSProperties = {
  background:   'transparent',
  border:       '1px solid var(--color-border)',
  color:        'var(--color-text-muted)',
  borderRadius: 'var(--radius-sm)',
  padding:      '4px 10px',
  cursor:       'pointer',
  fontSize:     'var(--text-xs)',
  flexShrink:   0,
};

// ─── Wizard data types ────────────────────────────────────────────────────────

/** Server type for step 3 (D-01 capture-only). */
type ServerType = 'core3-wsl2' | 'swgsource-docker';

/** State accumulated across wizard steps. */
interface WizardState {
  /** Step 1: absolute path to the project folder. */
  folder:     string;
  /** Step 2: the client binding choice. */
  bindChoice: BindChoice;
  /**
   * D-13: manual layout override from Step 2 when resolveLayout() returns null
   * for a confirmed-client folder (unknown release pattern).
   * Passed to initProject as InitProjectOptions.manualLayout.
   */
  manualLayout?: ClientLayout;
  /** Step 3: optional server config (undefined = not using a local server). */
  serverConfig?: InitProjectOptions['serverConfig'];
  /** Step 4: false = use client TRE set (recommended); true = start with empty staging. */
  startEmpty: boolean;
}

type BindChoice =
  | { kind: 'client';      client: DetectedClient }    // auto-detected client selected
  | { kind: 'client-override'; folder: string }         // M6: user-confirmed unclassified dir
  | { kind: 'mod-project'; folder: string }             // non-client project (no bound client)
  | null;                                               // step 2 not yet completed

// ─── Props ────────────────────────────────────────────────────────────────────

export interface NewProjectWizardProps {
  open:    boolean;
  onClose: () => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

const TOTAL_STEPS = 4;

export default function NewProjectWizard({ open, onClose }: NewProjectWizardProps): React.ReactElement | null {
  const [step, setStep] = useState(1);
  const [wizard, setWizard] = useState<WizardState>({
    folder:     '',
    bindChoice: null,
    startEmpty: false,
  });
  const [error, setError]       = useState<string | null>(null);
  const [busy, setBusy]         = useState(false);
  const [clients, setClients]   = useState<DetectedClient[]>([]);
  const firstInputRef = useRef<HTMLInputElement | HTMLButtonElement>(null);

  // Load detected clients once when step 2 becomes active
  useEffect(() => {
    if (step === 2) {
      try { setClients(detectClients()); } catch { setClients([]); }
    }
  }, [step]);

  // Autofocus first input when step changes (Accessibility Rule 1)
  useEffect(() => {
    if (firstInputRef.current) {
      firstInputRef.current.focus();
    }
  }, [step]);

  // Keyboard: Esc cancels (StagingPanel.tsx:547-551 pattern)
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') onClose();
  }, [onClose]);

  // ─── Step 1: folder picker ─────────────────────────────────────────────────

  const handlePickFolder = useCallback(async () => {
    setError(null);
    try {
      const paths = await ipcRenderer.invoke('workspace:pick-dir');
      if (paths.length > 0 && paths[0]) {
        setWizard((w) => ({ ...w, folder: paths[0] }));
      }
    } catch (err) {
      setError(String((err as Error)?.message ?? err));
    }
  }, []);

  // ─── Navigation ───────────────────────────────────────────────────────────

  const canProceed = useCallback((): boolean => {
    switch (step) {
      case 1: return wizard.folder.trim().length > 0;
      case 2: return wizard.bindChoice !== null;
      case 3: return true; // step 3 is optional
      case 4: return true;
      default: return false;
    }
  }, [step, wizard]);

  const handleNext = useCallback(() => {
    if (!canProceed()) return;
    setError(null);
    setStep((s) => Math.min(s + 1, TOTAL_STEPS));
  }, [canProceed]);

  const handleBack = useCallback(() => {
    setError(null);
    setStep((s) => Math.max(s - 1, 1));
  }, []);

  // ─── Finish ───────────────────────────────────────────────────────────────

  const handleFinish = useCallback(async () => {
    if (!canProceed() || busy) return;
    setError(null);
    setBusy(true);
    try {
      const folder = wizard.bindChoice !== null && wizard.bindChoice.kind === 'client'
        ? wizard.bindChoice.client.installPath
        : wizard.bindChoice !== null && wizard.bindChoice.kind === 'client-override'
          ? wizard.bindChoice.folder
          : wizard.folder;

      const overrideKind: InitProjectOptions['overrideKind'] =
        wizard.bindChoice?.kind === 'client' ? 'client' :
        wizard.bindChoice?.kind === 'client-override' ? 'client' :
        wizard.bindChoice?.kind === 'mod-project' ? 'mod-project' :
        undefined;

      await projectBinding.initProject(folder, {
        overrideKind,
        serverConfig: wizard.serverConfig,
        // D-13: pass manual override when the user filled in cfgFile + treSubdir
        // (occurs when resolveLayout returned null for the confirmed client folder)
        manualLayout: wizard.manualLayout,
      });

      onClose();
    } catch (err) {
      setError(String((err as Error)?.message ?? err));
    } finally {
      setBusy(false);
    }
  }, [canProceed, busy, wizard, onClose]);

  if (!open) return null;

  const stepLabel = step < TOTAL_STEPS ? 'Next' : busy ? 'Creating…' : 'Create project';

  return (
    // Backdrop — click dismisses (StagingPanel.tsx:507-522 overlay pattern)
    <div
      role="dialog"
      aria-modal="true"
      aria-label="New Project"
      onClick={onClose}
      onKeyDown={handleKeyDown}
      style={{
        position:       'fixed',
        inset:          0,
        background:     'rgba(0,0,0,0.5)',
        display:        'flex',
        alignItems:     'center',
        justifyContent: 'center',
        zIndex:         1000,
      }}
    >
      {/* Dialog panel — stop propagation so clicks inside don't close */}
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          display:       'flex',
          flexDirection: 'column',
          gap:           'var(--space-3)',
          width:         520,
          maxWidth:      '90vw',
          padding:       'var(--space-4)',
          background:    'var(--color-surface)',
          border:        '1px solid var(--color-border)',
          borderRadius:  'var(--radius-md)',
          color:         'var(--color-text)',
          fontFamily:    'var(--font-sans)',
        }}
      >
        {/* ── Header ───────────────────────────────────────────────────── */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 'var(--text-md)', fontWeight: 600 }}>
            New Project
          </span>
          <span
            style={{
              fontSize: 'var(--text-xs)',
              color:    'var(--color-text-muted)',
              fontFamily: 'var(--font-mono)',
            }}
          >
            Step {step} of {TOTAL_STEPS}
          </span>
        </div>

        {/* ── Step progress dots ─────────────────────────────────────── */}
        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          {Array.from({ length: TOTAL_STEPS }, (_, i) => (
            <div
              key={i}
              style={{
                height:       3,
                flex:         1,
                borderRadius: 2,
                background:   i + 1 <= step ? 'var(--color-accent)' : 'var(--color-border)',
                transition:   'background 0.15s ease',
              }}
            />
          ))}
        </div>

        {/* ── Step content ──────────────────────────────────────────── */}
        <div style={{ minHeight: 160 }}>
          {step === 1 && <Step1NameLocation wizard={wizard} setWizard={setWizard} onPickFolder={handlePickFolder} firstInputRef={firstInputRef as React.RefObject<HTMLButtonElement>} />}
          {step === 2 && <Step2BindClient wizard={wizard} setWizard={setWizard} clients={clients} onPickFolder={handlePickFolder} firstInputRef={firstInputRef as React.RefObject<HTMLButtonElement>} />}
          {step === 3 && <Step3LocalServer wizard={wizard} setWizard={setWizard} />}
          {step === 4 && <Step4SeedAssets wizard={wizard} setWizard={setWizard} />}
        </div>

        {/* ── Inline error (WorkspaceEntry.tsx:167-181 pattern) ─────── */}
        {error && (
          <span
            role="alert"
            style={{
              color:       'var(--color-danger, #f87171)',
              fontSize:    'var(--text-sm)',
              whiteSpace:  'pre-wrap',
            }}
          >
            {error}
          </span>
        )}

        {/* ── Button row (StagingPanel.tsx:569-584 pattern) ─────────── */}
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--space-2)' }}>
          <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
            <button style={secondaryBtnStyle} onClick={onClose} disabled={busy}>
              Cancel
            </button>
            {step > 1 && (
              <button style={secondaryBtnStyle} onClick={handleBack} disabled={busy}>
                Back
              </button>
            )}
          </div>

          <button
            style={primaryBtnStyle(!canProceed() || busy)}
            disabled={!canProceed() || busy}
            onClick={step < TOTAL_STEPS ? handleNext : () => void handleFinish()}
          >
            {stepLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Step 1: Name & Location ──────────────────────────────────────────────────

interface Step1Props {
  wizard:       WizardState;
  setWizard:    React.Dispatch<React.SetStateAction<WizardState>>;
  onPickFolder: () => Promise<void>;
  firstInputRef: React.RefObject<HTMLButtonElement>;
}

function Step1NameLocation({ wizard, onPickFolder, firstInputRef }: Step1Props): React.ReactElement {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      <div>
        <div style={sectionLabelStyle}>STEP 1 — NAME & LOCATION</div>
        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)', margin: 0, marginTop: 'var(--space-2)' }}>
          Choose where your project files will be stored. A <code>.studio/</code> directory will be created here.
        </p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
        <span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)' }}>
          Project folder
        </span>
        <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
          <span
            style={{
              flex:         1,
              fontFamily:   'var(--font-mono)',
              fontSize:     'var(--text-xs)',
              color:        wizard.folder ? 'var(--color-text)' : 'var(--color-text-faint)',
              background:   'var(--color-widget)',
              border:       '1px solid var(--color-border)',
              borderRadius: 'var(--radius-sm)',
              padding:      '4px 8px',
              overflow:     'hidden',
              textOverflow: 'ellipsis',
              whiteSpace:   'nowrap',
              minWidth:     0,
            }}
          >
            {wizard.folder || 'No folder selected'}
          </span>
          <button
            ref={firstInputRef}
            style={browseButtonStyle}
            onClick={() => void onPickFolder()}
            aria-label="Browse for project folder"
          >
            Browse…
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Step 2: Bind Client ──────────────────────────────────────────────────────

interface Step2Props {
  wizard:       WizardState;
  setWizard:    React.Dispatch<React.SetStateAction<WizardState>>;
  clients:      DetectedClient[];
  onPickFolder: () => Promise<void>;
  firstInputRef: React.RefObject<HTMLButtonElement>;
}

function Step2BindClient({ wizard, setWizard, clients, firstInputRef }: Step2Props): React.ReactElement {
  const [browsedFolder, setBrowsedFolder] = useState('');
  const [unconfirmedAnswer, setUnconfirmedAnswer] = useState<'client' | 'non-client' | null>(null);
  const [isBrowsed, setIsBrowsed] = useState(false);

  // D-13: manual-override inputs (cfgFile + treSubdir) used when resolveLayout returns null
  const [manualCfgFile, setManualCfgFile]       = useState('');
  const [manualTreSubdir, setManualTreSubdir]   = useState('');

  // ── Folder kind + layout detection ──────────────────────────────────────────

  // Check if the currently browsed folder is classifiable as a client
  const browsedKind = browsedFolder
    ? projectBinding.detectFolderKind(browsedFolder)
    : null;
  // Unconfirmed: browsed but couldn't auto-classify as client
  const isUnconfirmed = isBrowsed && browsedKind !== 'client' && browsedKind !== null;

  // D-13: resolve layout for the currently selected client install path
  const selectedInstallPath: string | null = (
    wizard.bindChoice?.kind === 'client'          ? wizard.bindChoice.client.installPath :
    wizard.bindChoice?.kind === 'client-override' ? wizard.bindChoice.folder :
    null
  );
  const detectedLayout: ClientLayout | null = selectedInstallPath
    ? resolveLayout(selectedInstallPath)
    : null;

  // When layout IS detected, clear any manual override from WizardState
  // When layout is null AND a client is selected, the manual form is shown below
  useEffect(() => {
    if (detectedLayout) {
      // Auto-detection succeeded; clear any previously entered manual layout
      setWizard((w) => ({ ...w, manualLayout: undefined }));
    }
  }, [detectedLayout, setWizard]);

  // ── IPC bridge ──────────────────────────────────────────────────────────────
  // TypedIpcRenderer from @swg/contracts — channel types are enforced at module level above.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { ipcRenderer: ipc } = require('electron') as { ipcRenderer: TypedIpcRenderer };

  const handleBrowse = useCallback(async () => {
    try {
      const paths = await ipc.invoke('workspace:pick-dir');
      if (paths.length > 0 && paths[0]) {
        const folder = paths[0];
        setBrowsedFolder(folder);
        setIsBrowsed(true);
        setUnconfirmedAnswer(null);
        // Auto-select if the folder is unambiguously a client
        const kind = projectBinding.detectFolderKind(folder);
        if (kind === 'client') {
          setWizard((w) => ({
            ...w,
            folder:       folder,
            bindChoice:   { kind: 'client-override', folder },
            manualLayout: undefined,  // reset manual; will re-detect via resolveLayout
          }));
        }
      }
    } catch {
      // ignore picker cancel
    }
  }, [ipc, setWizard]);

  // M6: user-confirmed override — "Yes, treat as client"
  const handleUnconfirmedYes = useCallback(() => {
    setUnconfirmedAnswer('client');
    setWizard((w) => ({
      ...w,
      folder:     browsedFolder,
      bindChoice: { kind: 'client-override', folder: browsedFolder },
    }));
  }, [browsedFolder, setWizard]);

  // Non-client: no bound client, deploy disabled
  const handleUnconfirmedNo = useCallback(() => {
    setUnconfirmedAnswer('non-client');
    setWizard((w) => ({
      ...w,
      folder:       w.folder || browsedFolder,
      bindChoice:   { kind: 'mod-project', folder: w.folder || browsedFolder },
      manualLayout: undefined,
    }));
  }, [browsedFolder, setWizard]);

  // D-13: apply manual-override values → persist into WizardState.manualLayout
  const handleApplyManualOverride = useCallback(() => {
    if (!manualCfgFile.trim()) return;
    const ml: ClientLayout = {
      release:           'manual',
      cfgFile:           manualCfgFile.trim(),
      treSubdir:         manualTreSubdir.trim(),
      maxSearchPriority: 0,  // informational; real value read from cfg chain at deploy time
    };
    setWizard((w) => ({ ...w, manualLayout: ml }));
  }, [manualCfgFile, manualTreSubdir, setWizard]);

  // Sync manual layout whenever inputs change (live-update WizardState)
  useEffect(() => {
    if (!selectedInstallPath) return;
    if (detectedLayout) return;  // auto-detect succeeded; no manual needed
    if (!manualCfgFile.trim()) return;  // nothing entered yet

    const ml: ClientLayout = {
      release:           'manual',
      cfgFile:           manualCfgFile.trim(),
      treSubdir:         manualTreSubdir.trim(),
      maxSearchPriority: 0,
    };
    setWizard((w) => ({ ...w, manualLayout: ml }));
  }, [manualCfgFile, manualTreSubdir, detectedLayout, selectedInstallPath, setWizard]);

  // ── Helpers ─────────────────────────────────────────────────────────────────

  /** True when manual override has been fully entered (cfgFile required). */
  const hasManualOverride = wizard.manualLayout !== undefined && wizard.manualLayout.cfgFile !== '';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      <div>
        <div style={sectionLabelStyle}>STEP 2 — BIND CLIENT</div>
        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)', margin: 0, marginTop: 'var(--space-2)' }}>
          Select a SWG client install to bind. This enables deploy-to-client and auto-mounts its TRE archives.
        </p>
      </div>

      {/* Detected client radios */}
      {clients.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', marginBottom: 'var(--space-1)' }}>
            Detected installs
          </span>
          {clients.map((client) => {
            const isSelected =
              wizard.bindChoice?.kind === 'client' &&
              wizard.bindChoice.client.installPath === client.installPath;
            return (
              <div
                key={client.installPath}
                onClick={() => setWizard((w) => ({
                  ...w,
                  folder:       w.folder || client.installPath,
                  bindChoice:   { kind: 'client', client },
                  manualLayout: undefined,
                }))}
                style={{
                  display:      'flex',
                  alignItems:   'center',
                  gap:          'var(--space-2)',
                  padding:      'var(--space-2) var(--space-3)',
                  background:   isSelected ? 'var(--color-accent-dim)' : 'var(--color-surface-2)',
                  border:       isSelected ? '1px solid var(--color-accent-line)' : '1px solid transparent',
                  borderRadius: 'var(--radius-sm)',
                  cursor:       'pointer',
                }}
              >
                {/* Radio indicator */}
                <span style={{ color: isSelected ? 'var(--color-accent)' : 'var(--color-text-faint)', fontSize: 'var(--text-xs)' }}>
                  {isSelected ? '●' : '○'}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 'var(--text-sm)', fontWeight: isSelected ? 600 : 400 }}>
                    {client.name}
                  </div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--color-text-faint)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {client.installPath}
                  </div>
                </div>
                {/* ✓ ready pill (Accessibility Rule 1: glyph + border + text) */}
                <span
                  style={{
                    fontSize:     'var(--text-xs)',
                    padding:      '1px 6px',
                    borderRadius: 'var(--radius-sm)',
                    border:       '1px solid var(--color-accent-line)',
                    color:        'var(--color-accent)',
                    flexShrink:   0,
                    fontFamily:   'var(--font-mono)',
                  }}
                >
                  ✓ ready
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* Browse for client folder */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <button
            ref={firstInputRef}
            style={browseButtonStyle}
            onClick={() => void handleBrowse()}
            aria-label="Browse for client folder"
          >
            Browse for client folder…
          </button>
          {browsedFolder && (
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--color-text-faint)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
              {browsedFolder}
            </span>
          )}
        </div>

        {/* Surface 3 — Unconfirmed-directory branch (detectFolderKind != client) */}
        {isUnconfirmed && unconfirmedAnswer === null && (
          <div
            style={{
              padding:       'var(--space-3)',
              background:    'rgba(224, 161, 58, 0.08)',
              border:        '1px solid var(--color-warn, #e0a13a)',
              borderRadius:  'var(--radius-sm)',
              display:       'flex',
              flexDirection: 'column',
              gap:           'var(--space-2)',
            }}
          >
            <span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-warn, #e0a13a)', fontWeight: 600 }}>
              ⚠ Unconfirmed directory
            </span>
            <span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)' }}>
              {/* Copywriting Contract: "Is this a client install?" */}
              Is this a client install?
            </span>
            <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
              {/* M6: "Yes" forces kind:'client' regardless of detectFolderKind result */}
              <button style={secondaryBtnStyle} onClick={handleUnconfirmedYes}>
                Yes, treat as client
              </button>
              <button style={secondaryBtnStyle} onClick={handleUnconfirmedNo}>
                No, non-client project
              </button>
            </div>
          </div>
        )}

        {/* Confirmed: Yes → client (M6) */}
        {isUnconfirmed && unconfirmedAnswer === 'client' && (
          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-accent)', fontFamily: 'var(--font-mono)' }}>
            ✓ Will be treated as a client install. Deploy will be enabled.
          </div>
        )}

        {/* Confirmed: No → non-client (mod-project, deploy disabled) */}
        {isUnconfirmed && unconfirmedAnswer === 'non-client' && (
          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
            {/* Copywriting Contract */}
            No bound client — deploy-to-client is disabled for this project.
          </div>
        )}
      </div>

      {/* ── D-13: Detected-layout section (Surface 3 confirm/correct) ───────── */}
      {selectedInstallPath && detectedLayout && (
        <div
          style={{
            padding:       'var(--space-2) var(--space-3)',
            background:    'var(--color-surface-2)',
            border:        '1px solid var(--color-border)',
            borderRadius:  'var(--radius-sm)',
            display:       'flex',
            flexDirection: 'column',
            gap:           'var(--space-1)',
          }}
        >
          <span style={{ ...sectionLabelStyle, marginBottom: 'var(--space-1)' }}>
            DETECTED LAYOUT
          </span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)', fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)' }}>
            <span style={{ color: 'var(--color-text-muted)' }}>
              pattern:
              <span style={{ color: 'var(--color-text)', marginLeft: 'var(--space-2)' }}>
                {detectedLayout.release}
              </span>
            </span>
            <span style={{ color: 'var(--color-text-muted)' }}>
              cfg:
              <span style={{ color: 'var(--color-text)', marginLeft: 'var(--space-2)' }}>
                {detectedLayout.cfgFile}
              </span>
            </span>
            <span style={{ color: 'var(--color-text-muted)' }}>
              TREs:
              <span style={{ color: 'var(--color-text)', marginLeft: 'var(--space-2)' }}>
                {detectedLayout.treSubdir ? `${detectedLayout.treSubdir}/` : '(install root)'}
              </span>
            </span>
            <span style={{ color: 'var(--color-text-muted)' }}>
              maxSearchPriority:
              <span style={{ color: 'var(--color-text)', marginLeft: 'var(--space-2)' }}>
                {detectedLayout.maxSearchPriority}
              </span>
            </span>
          </div>
        </div>
      )}

      {/* ── D-13: Layout-unknown manual-override section ─────────────────────── */}
      {/* Shown when: a client IS confirmed but resolveLayout returned null        */}
      {selectedInstallPath && !detectedLayout && wizard.bindChoice?.kind !== 'mod-project' && !isUnconfirmed && (
        <div
          style={{
            padding:       'var(--space-3)',
            background:    'rgba(224, 161, 58, 0.08)',
            border:        '1px solid var(--color-warn, #e0a13a)',
            borderRadius:  'var(--radius-sm)',
            display:       'flex',
            flexDirection: 'column',
            gap:           'var(--space-2)',
          }}
        >
          {/* ⚠ triple-encoded: glyph + border (on container) + text color */}
          <span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-warn, #e0a13a)', fontWeight: 600 }}>
            ⚠ Layout not recognized
          </span>
          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
            This client folder uses an unrecognized layout. Enter the cfg filename and TRE
            directory so the toolkit can locate your archives.
          </span>

          {/* cfgFile input */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
              cfg filename (e.g. swgemu.cfg, client.cfg)
            </span>
            <input
              type="text"
              value={manualCfgFile}
              onChange={(e) => setManualCfgFile(e.target.value)}
              placeholder="swgemu.cfg"
              style={{ ...inputStyle, fontFamily: 'var(--font-mono)' }}
              aria-label="Client cfg filename"
            />
          </div>

          {/* treSubdir input */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
              TRE subdirectory (leave blank if TREs are in the install root)
            </span>
            <input
              type="text"
              value={manualTreSubdir}
              onChange={(e) => setManualTreSubdir(e.target.value)}
              placeholder="Live"
              style={{ ...inputStyle, fontFamily: 'var(--font-mono)' }}
              aria-label="TRE subdirectory"
            />
          </div>

          {/* Confirmation feedback */}
          {hasManualOverride && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
              <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-accent)', fontFamily: 'var(--font-mono)' }}>
                ✓ Override set:
              </span>
              <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', fontFamily: 'var(--font-mono)' }}>
                cfg={wizard.manualLayout!.cfgFile}
                {wizard.manualLayout!.treSubdir
                  ? ` · TREs=${wizard.manualLayout!.treSubdir}/`
                  : ' · TREs=(root)'}
              </span>
            </div>
          )}

          {/* Apply button — explicitly sets manualLayout even if inputs didn't change */}
          <button
            style={{ ...secondaryBtnStyle, alignSelf: 'flex-start' }}
            onClick={handleApplyManualOverride}
            disabled={!manualCfgFile.trim()}
          >
            Apply override
          </button>
        </div>
      )}

      {/* Skip: no client (mod-project) */}
      {wizard.bindChoice === null && (
        <button
          style={{ ...secondaryBtnStyle, alignSelf: 'flex-start', fontSize: 'var(--text-xs)' }}
          onClick={() => setWizard((w) => ({ ...w, bindChoice: { kind: 'mod-project', folder: w.folder } }))}
        >
          Skip — no client
        </button>
      )}
      {wizard.bindChoice?.kind === 'mod-project' && (
        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
          No bound client — deploy-to-client is disabled for this project.
        </div>
      )}
    </div>
  );
}

// ─── Step 3: Local Server (optional, CAPTURE ONLY) ────────────────────────────

interface Step3Props {
  wizard:    WizardState;
  setWizard: React.Dispatch<React.SetStateAction<WizardState>>;
}

function Step3LocalServer({ wizard, setWizard }: Step3Props): React.ReactElement {
  const [useServer, setUseServer] = useState(false);
  const [serverType, setServerType] = useState<ServerType>('core3-wsl2');
  const [serverPath, setServerPath] = useState('');
  const [hostPort, setHostPort] = useState('127.0.0.1:44463');

  // Sync changes to wizard state (capture-only, D-01 — no push UI)
  useEffect(() => {
    if (useServer) {
      setWizard((w) => ({
        ...w,
        serverConfig: { type: serverType, path: serverPath, hostPort },
      }));
    } else {
      setWizard((w) => ({ ...w, serverConfig: undefined }));
    }
  }, [useServer, serverType, serverPath, hostPort, setWizard]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      <div>
        <div style={sectionLabelStyle}>STEP 3 — LOCAL SERVER (OPTIONAL)</div>
        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)', margin: 0, marginTop: 'var(--space-2)' }}>
          {/* Copywriting Contract: local-server step prompt */}
          Are you running a local server for this project?
        </p>
      </div>

      {/* Yes / No toggle */}
      <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
        <button
          style={{ ...secondaryBtnStyle, border: useServer ? '1px solid var(--color-accent)' : undefined, color: useServer ? 'var(--color-accent)' : undefined }}
          onClick={() => setUseServer(true)}
        >
          Yes
        </button>
        <button
          style={{ ...secondaryBtnStyle, border: !useServer ? '1px solid var(--color-accent)' : undefined, color: !useServer ? 'var(--color-accent)' : undefined }}
          onClick={() => setUseServer(false)}
        >
          No
        </button>
      </div>

      {useServer && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          {/* Server type */}
          <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
            {(['core3-wsl2', 'swgsource-docker'] as ServerType[]).map((t) => (
              <button
                key={t}
                style={{ ...secondaryBtnStyle, border: serverType === t ? '1px solid var(--color-accent)' : undefined, color: serverType === t ? 'var(--color-accent)' : undefined }}
                onClick={() => setServerType(t)}
              >
                {t === 'core3-wsl2' ? 'Core3 / WSL2' : 'SWG Source / Docker'}
              </button>
            ))}
          </div>

          {/* Server path */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>Server path</span>
            <input
              type="text"
              value={serverPath}
              onChange={(e) => setServerPath(e.target.value)}
              placeholder={serverType === 'core3-wsl2' ? '/path/to/Core3' : '/path/to/server'}
              style={inputStyle}
              aria-label="Server path"
            />
          </div>

          {/* host:port */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
            {/* Copywriting Contract: host:port placeholder 127.0.0.1:44463 */}
            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>Host:port</span>
            <input
              type="text"
              value={hostPort}
              onChange={(e) => setHostPort(e.target.value)}
              placeholder="127.0.0.1:44463"
              style={{ ...inputStyle, fontFamily: 'var(--font-mono)' }}
              aria-label="Server host and port"
            />
          </div>

          {/* D-01 notice: CAPTURE ONLY, no server-push UI in Phase 4.1 */}
          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-info, #4a8cff)', display: 'flex', gap: 'var(--space-1)', alignItems: 'flex-start' }}>
            <span>ℹ</span>
            <span>This captures the server connection for reference only. Live server sync is available in a future phase.</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Step 4: Seed Assets ──────────────────────────────────────────────────────

interface Step4Props {
  wizard:    WizardState;
  setWizard: React.Dispatch<React.SetStateAction<WizardState>>;
}

function Step4SeedAssets({ wizard, setWizard }: Step4Props): React.ReactElement {
  const hasClient =
    wizard.bindChoice?.kind === 'client' ||
    wizard.bindChoice?.kind === 'client-override';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      <div>
        <div style={sectionLabelStyle}>STEP 4 — SEED ASSETS</div>
        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)', margin: 0, marginTop: 'var(--space-2)' }}>
          Choose how to populate the initial staging area.
          {hasClient && (
            <>
              {' '}The client TRE archives are always auto-mounted regardless of this choice.
            </>
          )}
        </p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
        {/* Option 1: Use client TRE set (recommended) */}
        {hasClient && (
          <div
            onClick={() => setWizard((w) => ({ ...w, startEmpty: false }))}
            style={{
              display:      'flex',
              gap:          'var(--space-2)',
              alignItems:   'flex-start',
              padding:      'var(--space-3)',
              background:   !wizard.startEmpty ? 'var(--color-accent-dim)' : 'var(--color-surface-2)',
              border:       !wizard.startEmpty ? '1px solid var(--color-accent-line)' : '1px solid transparent',
              borderRadius: 'var(--radius-sm)',
              cursor:       'pointer',
            }}
          >
            <span style={{ color: !wizard.startEmpty ? 'var(--color-accent)' : 'var(--color-text-faint)', fontSize: 'var(--text-xs)', marginTop: 2 }}>
              {!wizard.startEmpty ? '●' : '○'}
            </span>
            <div>
              <div style={{ fontSize: 'var(--text-sm)', fontWeight: !wizard.startEmpty ? 600 : 400 }}>
                Use client TRE set (recommended)
              </div>
              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', marginTop: 'var(--space-1)' }}>
                Pre-populate the staging area with the client's mounted TRE assets. Start modding immediately.
              </div>
            </div>
          </div>
        )}

        {/* Option 2: Start empty */}
        <div
          onClick={() => setWizard((w) => ({ ...w, startEmpty: true }))}
          style={{
            display:      'flex',
            gap:          'var(--space-2)',
            alignItems:   'flex-start',
            padding:      'var(--space-3)',
            background:   wizard.startEmpty ? 'var(--color-accent-dim)' : 'var(--color-surface-2)',
            border:       wizard.startEmpty ? '1px solid var(--color-accent-line)' : '1px solid transparent',
            borderRadius: 'var(--radius-sm)',
            cursor:       'pointer',
          }}
        >
          <span style={{ color: wizard.startEmpty ? 'var(--color-accent)' : 'var(--color-text-faint)', fontSize: 'var(--text-xs)', marginTop: 2 }}>
            {wizard.startEmpty ? '●' : '○'}
          </span>
          <div>
            <div style={{ fontSize: 'var(--text-sm)', fontWeight: wizard.startEmpty ? 600 : 400 }}>
              Start empty
            </div>
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', marginTop: 'var(--space-1)' }}>
              {/* M5: "start empty" does NOT suppress client TRE auto-mount */}
              Begin with an empty staging area. Add files later via the TRE browser.
              {hasClient && ' Base TRE archives are still auto-mounted.'}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Shared styles ────────────────────────────────────────────────────────────

const sectionLabelStyle: React.CSSProperties = {
  fontSize:      'var(--text-xs)',
  fontWeight:    600,
  letterSpacing: '0.03em',
  textTransform: 'uppercase',
  color:         'var(--color-text-muted)',
};

const browseButtonStyle: React.CSSProperties = {
  background:   'transparent',
  border:       '1px solid var(--color-border)',
  color:        'var(--color-text-muted)',
  borderRadius: 'var(--radius-sm)',
  padding:      '4px 10px',
  cursor:       'pointer',
  fontSize:     'var(--text-xs)',
  flexShrink:   0,
};

const inputStyle: React.CSSProperties = {
  background:   'var(--color-widget)',
  border:       '1px solid var(--color-border)',
  borderRadius: 'var(--radius-sm)',
  color:        'var(--color-text)',
  fontFamily:   'var(--font-sans)',
  fontSize:     'var(--text-sm)',
  padding:      '4px 8px',
  width:        '100%',
  boxSizing:    'border-box',
  outline:      'none',
};
