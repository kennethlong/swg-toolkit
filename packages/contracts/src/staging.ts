/**
 * packages/contracts/src/staging.ts
 * Type definitions for Phase 4 explicit staging list (DEPLOY-02/03).
 *
 * Maps 1:1 onto TreBuilderEntryNative for buildTre (DEPLOY-01).
 * No runtime code — types and const objects only.
 *
 * Source: D-04-03 + packages/native-core/index.d.ts TreBuilderEntryNative.
 */

// ---------------------------------------------------------------------------
// Staging action
// ---------------------------------------------------------------------------

/**
 * What to do with a staged entry in the deploy patch.
 *
 * Source: D-04-03.
 */
export type StagingAction = 'add' | 'modify' | 'delete';

// ---------------------------------------------------------------------------
// Staging entry
// ---------------------------------------------------------------------------

/**
 * One explicitly staged file entry.
 *
 * Maps 1:1 onto TreBuilderEntryNative ({path, data?, tombstone?}) for buildTre.
 * Decouples "this file was edited" from "this file will ship" (D-04-02).
 *
 * Source: D-04-03 + packages/native-core/index.d.ts TreBuilderEntryNative.
 */
export interface StagingEntry {
  /**
   * Normalized VFS virtual path (archive-relative, forward-slashes, lowercase).
   * Example: "appearance/player.apt"
   */
  virtualPath: string;
  /** What to do with this entry in the built patch. */
  action: StagingAction;
  /**
   * Absolute path to the on-disk replacement file.
   * Required for 'add' and 'modify'. Undefined for 'delete' tombstones.
   * Resolved from storedFileRef on flatten, or from user's external file when live.
   */
  replacementFilePath?: string;
  /**
   * SHA-256 hex digest of the replacement bytes at the time of staging.
   * Used for drift detection (file changed after staging but before pack).
   */
  sha256?: string;
}
