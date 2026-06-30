/**
 * packages/renderer/src/panels/deploy/NewProjectWizard.test.tsx
 * Component tests for NewProjectWizard — P4/P6/P7/P8/P12 sketch 007-C (04.3-08 Task 3).
 *
 * Tests:
 *   1 — P12: wizard header has a × close button
 *   2 — P6: Step 1 shows an editable project folder input (not just a read-only hint)
 *   3 — P6: Step 1 shows a "Browse…" button for the project folder
 *   4 — P11 KEEP: paginated Back/Next stepper is present (Back+Next buttons, step counter)
 *   5 — P4 wizard: Step 2 renders "✗ not found" rows for known clients not detected
 *   6 — P4 wizard: Step 2 renders detected client radio rows as well
 *   7 — P7: Step 3 shows a Browse button for the server folder (when server is "Yes")
 *   8 — P8: Step 3 shows separate Host and Port inputs (not a single combined "host:port" field)
 *
 * Source: 04.3-08-PLAN.md Task 3; sketch 007-C.
 */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mocks ────────────────────────────────────────────────────────────────────

// electron IPC: mock pick-dir to resolve with []
vi.mock('electron', () => ({
  ipcRenderer: {
    invoke: vi.fn().mockResolvedValue([]),
  },
}));

// clientLocator: one detected + one missing
vi.mock('../../services/clientLocator', () => ({
  detectClients: vi.fn().mockReturnValue([
    { name: 'SWG Infinity', installPath: 'D:\\SWG Infinity\\SWG Infinity', cfgRootPath: '', treVersion: '5000' },
  ]),
  getKnownClientPaths: vi.fn().mockReturnValue([
    { name: 'SWG Infinity', installPath: 'D:\\SWG Infinity\\SWG Infinity' },
    { name: 'SWGEmu',       installPath: 'D:\\SWGEmu Client\\SWGEmu' },
  ]),
}));

// clientLayout: return null so D-13 manual override section is hidden
vi.mock('../../services/clientLayout', () => ({
  resolveLayout: vi.fn().mockReturnValue(null),
}));

// projectBinding: stub initProject
vi.mock('../../services/projectBinding', () => ({
  initProject:       vi.fn().mockResolvedValue(undefined),
  detectFolderKind:  vi.fn().mockReturnValue(null),
}));

// workspaceService: stub getDefaultProjectFolder
vi.mock('../../services/workspaceService', () => ({
  getDefaultProjectFolder: vi.fn().mockReturnValue('D:\\SWG-Projects\\my-project'),
}));

// ─── Imports ──────────────────────────────────────────────────────────────────

import NewProjectWizard from './NewProjectWizard';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const noop = vi.fn();

function renderOpenWizard() {
  return render(<NewProjectWizard open={true} onClose={noop} />);
}

// Navigate to step 2 by filling in step 1 and clicking Next
async function navigateToStep2() {
  renderOpenWizard();
  // Fill in project name (Step 1)
  const nameInput = screen.getByLabelText(/project name/i);
  fireEvent.change(nameInput, { target: { value: 'Test Project' } });
  // folder should auto-populate from name; verify Next is enabled then click it
  await waitFor(() => {
    const btn = screen.getByText('Next') as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
  });
  fireEvent.click(screen.getByText('Next'));
  // Now on Step 2 — both "Step 2 of 4" and "STEP 2 — BIND CLIENT" match, use findAll
  await waitFor(() => {
    const els = screen.getAllByText(/STEP 2/i);
    expect(els.length).toBeGreaterThan(0);
  });
}

// Navigate to step 3 by filling step 1 → selecting a client in step 2 → Next
async function navigateToStep3() {
  await navigateToStep2();
  // Click the detected client row (SWG Infinity) to select it
  const swgInfinityRow = await screen.findByText('SWG Infinity');
  fireEvent.click(swgInfinityRow);
  // Click Next to go to Step 3
  await waitFor(() => {
    const btn = screen.getByText('Next') as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
  });
  fireEvent.click(screen.getByText('Next'));
  await waitFor(() => {
    const els = screen.getAllByText(/STEP 3/i);
    expect(els.length).toBeGreaterThan(0);
  });
}

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  noop.mockClear();
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('NewProjectWizard — P4/P6/P7/P8/P12 sketch 007-C', () => {

  it('(1) P12: wizard header has a × close button', () => {
    renderOpenWizard();
    // The close button should have aria-label "Close wizard"
    const closeBtn = screen.getByLabelText('Close wizard');
    expect(closeBtn).toBeTruthy();
    expect(closeBtn.textContent?.trim()).toBe('×');
  });

  it('(2) P6: Step 1 shows an editable project folder input (not read-only hint)', () => {
    renderOpenWizard();
    // The project folder input should be an editable text input
    const folderInput = screen.getByLabelText('Project folder');
    expect(folderInput.tagName).toBe('INPUT');
    expect((folderInput as HTMLInputElement).type).toBe('text');
    // Should NOT have the old "Stored in" read-only hint
    expect(screen.queryByText(/Stored in/i)).toBeNull();
  });

  it('(3) P6: Step 1 shows a "⊕ Browse…" button for the project folder', () => {
    renderOpenWizard();
    const browseBtn = screen.getByTitle('Browse for project folder');
    expect(browseBtn).toBeTruthy();
  });

  it('(4) P11 KEEP: paginated Back/Next stepper is present', () => {
    renderOpenWizard();
    // Step counter "Step 1 of 4" present
    expect(screen.getByText(/Step 1 of 4/i)).toBeTruthy();
    // Next button present (Back is absent on step 1)
    expect(screen.getByText('Next')).toBeTruthy();
    expect(screen.queryByText('Back')).toBeNull(); // no Back on step 1
  });

  it('(5) P4 wizard: Step 2 renders "✗ not found" row for SWGEmu', async () => {
    await navigateToStep2();
    // SWGEmu is NOT in the detected list but IS in getKnownClientPaths → "✗ not found"
    await waitFor(() => {
      expect(screen.getByText('SWGEmu')).toBeTruthy();
    });
    // The not-found pill should appear
    const notFoundEls = screen.getAllByText(/not found/i);
    expect(notFoundEls.length).toBeGreaterThan(0);
  });

  it('(6) P4 wizard: Step 2 renders detected client (SWG Infinity) radio row', async () => {
    await navigateToStep2();
    await waitFor(() => {
      expect(screen.getByText('SWG Infinity')).toBeTruthy();
    });
    // Should have a "✓ ready" pill
    const readyEl = screen.getByText(/ready/i);
    expect(readyEl).toBeTruthy();
  });

  it('(7) P7: Step 3 shows a Browse button for the server folder when Yes is selected', async () => {
    await navigateToStep3();
    // Click "Yes" to enable server fields
    const yesBtn = screen.getByText('Yes');
    fireEvent.click(yesBtn);
    await waitFor(() => {
      const browseBtn = screen.getByLabelText('Browse for server folder');
      expect(browseBtn).toBeTruthy();
    });
  });

  it('(8) P8: Step 3 shows separate Host and Port inputs when Yes is selected', async () => {
    await navigateToStep3();
    // Click "Yes" to enable server fields
    const yesBtn = screen.getByText('Yes');
    fireEvent.click(yesBtn);
    await waitFor(() => {
      // Should have SEPARATE host and port inputs (not a single "host:port" field)
      const hostInput = screen.getByLabelText('Server host');
      const portInput = screen.getByLabelText('Server port');
      expect(hostInput).toBeTruthy();
      expect(portInput).toBeTruthy();
      // Verify they are separate (not the same element)
      expect(hostInput).not.toBe(portInput);
      // Host defaults to 127.0.0.1, port to 44463
      expect((hostInput as HTMLInputElement).value).toBe('127.0.0.1');
      expect((portInput as HTMLInputElement).value).toBe('44463');
    });
  });

});
