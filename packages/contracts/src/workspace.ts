/**
 * packages/contracts/src/workspace.ts
 * Type definitions for Phase 4 mod project workspace.
 *
 * No runtime code — types and const objects only.
 *
 * Source: D-04-01 (workspace = user-chosen project folder + .studio/ control dir).
 */

// ---------------------------------------------------------------------------
// Workspace
// ---------------------------------------------------------------------------

/**
 * Metadata for an open mod project workspace.
 *
 * Source: D-04-01; Phase 4 04-01-PLAN.md Task 1.
 */
export interface WorkspaceInfo {
  /** Absolute path to the workspace root folder (user-chosen). */
  folderPath: string;
  /** Absolute path to the .studio/ control dir — always folderPath + '/.studio'. */
  studioDir: string;
  /** Human-readable name — path.basename(folderPath). */
  workspaceName: string;
  /** Absolute path to the detected SWG client install root, or null if not yet set. */
  clientPath: string | null;
}
