/**
 * packages/renderer/src/services/clientLayout.ts
 * D-13: Release-pattern detection table + layout resolver.
 *
 * Exports:
 *   ClientLayout  — interface describing a known SWG client folder layout
 *   KNOWN_LAYOUTS — table of measured release patterns (Infinity + SWGEmu)
 *   resolveLayout(installPath) — classify a folder against the table; returns null
 *                                when no pattern matches so the caller can surface
 *                                the manual-override UI (Surface 3).
 *
 * Design:
 *   The table replaces the hardcoded 'swgemu.cfg' / 'Live/' literals scattered across
 *   clientLocator.ts and projectBinding.ts (RESEARCH.md §Pattern 3).
 *
 *   Table seed values are from measured real-world installs:
 *     • SWG Infinity — cfg: swgemu.cfg, TREs: Live/ subdir, maxSearchPriority: 60
 *     • SWGEmu       — cfg: swgemu.cfg, TREs: install root, maxSearchPriority: 27
 *   [A1] client.cfg releases + custom TRE dirs are UNKNOWN → resolveLayout returns null
 *   → user enters manual override (cfgFile + treSubdir) in the wizard / ProjectBindingBar.
 *
 *   KNOWN_LAYOUTS is exported so callers can enumerate releases for display labels.
 *   resolveLayout is the canonical probe; it MUST be called with the install root.
 *
 * Security:
 *   All fs calls are read-only (existsSync + readdirSync). No shell-out or exec.
 *   try-catch per-layout guards against unreadable dirs (T-04.1-21 / T-04.1-22).
 *
 * Source: 04.1-09-PLAN.md Task 2; 04.1-PATTERNS.md §clientLayout.ts;
 *         04.1-RESEARCH.md §Pattern 3 (table seed + resolver behavior).
 */

import * as path from 'path';
import * as fs from 'fs';

// ─── ClientLayout ─────────────────────────────────────────────────────────────

/**
 * A resolved or user-supplied client folder layout.
 *
 * Used for both auto-detected layouts (from KNOWN_LAYOUTS) and manual overrides
 * (user-entered cfgFile + treSubdir when resolveLayout returns null).
 * The `release` field holds the matched entry name ('SWG Infinity', 'SWGEmu')
 * or 'manual' for user-overridden layouts.
 */
export interface ClientLayout {
  /** Human-readable release pattern name (e.g. 'SWG Infinity', 'SWGEmu', 'manual'). */
  release: string;
  /** cfg filename at the install root (e.g. 'swgemu.cfg', 'client.cfg'). */
  cfgFile: string;
  /**
   * Subdirectory under the install root that contains .tre files.
   * Empty string ('') = TREs are in the install root itself (SWGEmu layout).
   * 'Live' = TREs are in <installRoot>/Live/ (SWG Infinity layout).
   * For treDirFromCfg layouts, '' means the actual TRE dir is resolved from the cfg at mount time.
   */
  treSubdir: string;
  /**
   * maxSearchPriority from this release's chain — INFORMATIONAL ONLY.
   * The real value is always read from the .cfg chain by scanSharedFile;
   * this value is used for display/confirmation in the wizard (D-13).
   */
  maxSearchPriority: number;
  /**
   * When true, the TRE directory is resolved from the cfg's TOCTreePath / searchTOC_* entries
   * at mount time rather than from a fixed treSubdir under the install root.
   * Applies to decoupled builds (e.g. swg-client-v2) where the binary dir has zero local .tre.
   * resolveLayout skips the local .tre check for this layout row (see Plan 02).
   *
   * Source: 04.2-PATTERNS.md §clientLayout.ts; CLIENT-02.
   */
  treDirFromCfg?: true;
}

// ─── KNOWN_LAYOUTS ────────────────────────────────────────────────────────────

/**
 * Release-pattern table seeded from measured UAT installs (RESEARCH.md §Pattern 3).
 *
 * Probe order matters:
 *   1. SWG Infinity (Live/ subdir): checked FIRST because Infinity has BOTH swgemu.cfg
 *      AND TREs in Live/. A root-only check (SWGEmu pattern) would match incorrectly
 *      on an Infinity install if the install root also has .tre files.
 *   2. SWGEmu (root TREs): matched when Live/ is absent or empty.
 *
 * Extending this table (e.g. a 'client.cfg' release) adds support without touching
 * any consumer; the resolver loops the table in order.
 */
export const KNOWN_LAYOUTS: ClientLayout[] = [
  {
    release:           'SWG Infinity',
    cfgFile:           'swgemu.cfg',
    treSubdir:         'Live',
    maxSearchPriority: 60,
  },
  {
    release:           'SWGEmu',
    cfgFile:           'swgemu.cfg',
    treSubdir:         '',
    maxSearchPriority: 27,
  },
  // [A1] 'client.cfg' releases — cfgFile and treSubdir vary by release/server;
  // these cannot be auto-detected without measuring a real install.
  // → resolveLayout returns null; user enters manual override (wizard + ProjectBindingBar).
];

// ─── resolveLayout ────────────────────────────────────────────────────────────

/**
 * Classify a client install folder against the KNOWN_LAYOUTS table.
 *
 * For each layout (in probe order):
 *   1. Check that layout.cfgFile exists at installPath
 *   2. Check that the TRE directory (installPath or installPath/treSubdir) contains
 *      at least one .tre file
 *   3. If both are true, return the matching ClientLayout
 *
 * Returns null when:
 *   - No known pattern matches (unknown release or non-standard layout)
 *   - The folder does not look like a client install at all
 *   - Any fs error during probing (permissions, broken symlinks, etc.)
 *
 * The caller should surface the manual-override UI (Surface 3) when null is returned.
 *
 * T-04.1-22: override paths are resolved + existence-checked by the caller;
 * resolveLayout itself only reads, never writes or executes.
 *
 * @param installPath  Absolute path to the suspected client install root.
 * @returns The matching ClientLayout from KNOWN_LAYOUTS, or null.
 */
export function resolveLayout(installPath: string): ClientLayout | null {
  for (const layout of KNOWN_LAYOUTS) {
    try {
      const cfgPath = path.join(installPath, layout.cfgFile);
      const treDir  = layout.treSubdir
        ? path.join(installPath, layout.treSubdir)
        : installPath;

      if (
        fs.existsSync(cfgPath) &&
        fs.existsSync(treDir) &&
        fs.readdirSync(treDir).some((f) => f.endsWith('.tre'))
      ) {
        return layout;
      }
    } catch {
      // Directory unreadable / broken symlink / permission error — skip this layout
      // and continue to the next one rather than propagating (T-04.1-22).
    }
  }
  return null;
}
