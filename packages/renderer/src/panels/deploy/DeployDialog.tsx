/**
 * packages/renderer/src/panels/deploy/DeployDialog.tsx
 * STUB — real implementation in plan 04-06.
 *
 * Modal deploy dialog: client picker + deploy model radios + cfg-slot preview
 * + build/activate progress (Surface 4 of UI-SPEC).
 *
 * The real implementation is a structural clone of ExportDialog.tsx with:
 *   Section A — Target client (auto-detected installs + manual override, D-04-09)
 *   Section B — Deploy model (patch-prepend default vs shadow-base opt-in, D-04-10)
 *   Section C — Config slot preview (D-04-12)
 *   Build→activate progress + success/failure + rollback/reset affordance
 *
 * Source: 04-02-PLAN.md Task 2 (stub to allow StagingPanel to compile).
 */

import React from 'react';

export interface DeployDialogProps {
  /** Called when the dialog should close (Cancel or X). */
  onClose: () => void;
}

/**
 * STUB: Deploy dialog — opens modal for client selection + patch build/activate.
 * Returns null (renders nothing) until implemented in 04-06.
 */
export function DeployDialog(_props: DeployDialogProps): React.ReactElement | null {
  return null;
}
