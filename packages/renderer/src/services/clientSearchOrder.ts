/**
 * packages/renderer/src/services/clientSearchOrder.ts
 * Replicate the SWG client's TRE search precedence from the cfg chain's [SharedFile]
 * searchTree entries, so the toolkit mounts the EXACT set + order the client loads.
 *
 * GROUND TRUTH — swg-client-v2 TreeFile.cpp (verified 2026-06-28):
 *   - install(): for each sku (ascending), for priority 0..maxSearchPriority (ascending),
 *     read every `searchTree<sku><priority>` value in cfg index order and addSearchTree()
 *     (TreeFile.cpp:104-138). maxSearchPriority default 20, LAST-wins across the chain.
 *   - addSearchNode keeps ms_searchNodes sorted by searchNodePriorityOrder = a.priority >
 *     b.priority (DESC), inserting via lower_bound BEFORE equal-priority nodes
 *     (TreeFile.cpp:286, 303-305) → among equal priority, the LAST-added wins.
 *   - File lookup walks ms_searchNodes from begin() and the FIRST node containing the file
 *     wins (TreeFile.cpp:455-457) → highest priority wins; ties broken by add order.
 *
 * Equivalent final order: sort entries by (priority DESC, addOrder DESC), where addOrder
 * follows the install loop (sku ascending, then priority ascending, then cfg index). We
 * then assign strictly-descending mount priorities so the native mount's first-match
 * resolution reproduces the client's precedence exactly (no native tie-break needed).
 *
 * Extended (Plan 04.2-02) to also parse searchTOC, searchPath, and TOCTreePath entries.
 * The full ClientMountOrder now carries looseDirs/looseDirPriorities/tocEntries/
 * tocTreePaths/searchTreeRawPriorities/maxPriority for Plan 03 unified-mount compaction
 * and Plan 05 override-dir guard.
 *
 * searchTree filenames are relative to the client's working dir (= install root); absolute
 * values are used as-is. The toolkit's own deploy cfg (swgtoolkit.cfg) is excluded so the
 * mounted set is the pristine client base.
 */

import path from 'path';

// Path B fs (nodeIntegration:true) — never bundled by Vite.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const fs = require('fs') as typeof import('fs');

import { resolveLayout } from './clientLayout';

/** The toolkit's own deploy cfg — excluded from the base mount set. */
const TOOLKIT_CFG = 'swgtoolkit.cfg';

/** Entry family — which cfg key family produced this entry. */
type EntryFamily = 'searchTree' | 'searchTOC' | 'searchPath';

interface RawEntry {
  sku:       number;  // parsed from the _NN_ suffix (0 when no sku suffix)
  priority:  number;  // the numeric slot — higher wins
  fileName:  string;  // resolved value (after stripQuotes); relative or absolute
  baseDir:   string;  // dir of the cfg file the entry was declared in
  order:     number;  // global parse-encounter index (for stable index-within-key order)
  family:    EntryFamily;  // which cfg key family produced this entry
}

/**
 * Strip surrounding double-quotes from a cfg value.
 * SWG cfg files quote paths that contain spaces: "D:/path with spaces/foo.toc"
 * Must be applied to searchTOC, searchPath, and TOCTreePath values before any
 * fs.existsSync call (T-04.2-07 — Pitfall 1: quote-stripping).
 *
 * Does NOT strip searchTree values (those are never quoted in real client cfgs).
 *
 * Exported for use by looseOverrideDeploy.ts (Plan 04).
 */
export function stripQuotes(val: string): string {
  return val.startsWith('"') && val.endsWith('"') ? val.slice(1, -1) : val;
}

/**
 * Parse the [SharedFile] search entries (searchTree, searchTOC, searchPath, TOCTreePath)
 * across the full `.include` chain. Returns the entries, the resolved maxSearchPriority
 * (LAST-wins), and all TOCTreePath values collected across the chain.
 *
 * Previously named parseSearchTree (internal only). Renamed to parseSearchNodes and
 * exported so looseOverrideDeploy.ts (Plan 04) can call it directly for resolveOverrideDir.
 *
 * Source: 04.2-PATTERNS.md §clientSearchOrder.ts; 04.2-RESEARCH.md §Capability 2.
 */
export function parseSearchNodes(rootCfgPath: string): {
  entries: RawEntry[];
  maxPriority: number;
  tocTreePaths: string[];
} {
  const entries: RawEntry[] = [];
  let maxPriority = 20;            // ConfigFile default (TreeFile.cpp:102)
  let order = 0;
  const visited = new Set<string>();
  const tocTreePaths: string[] = [];

  function processFile(cfgPath: string): void {
    const abs = path.resolve(cfgPath);
    if (visited.has(abs)) return;  // circular-include guard
    visited.add(abs);
    if (!fs.existsSync(abs)) return;

    const baseDir = path.dirname(abs);
    for (const line of fs.readFileSync(abs, 'utf8').split(/\r?\n/)) {
      const max = line.match(/^\s*maxSearchPriority\s*=\s*(\d+)/);
      if (max) { maxPriority = parseInt(max[1], 10); continue; }

      // searchTree_<sku>_<priority>=file   OR   searchTree<priority>=file (no sku)
      const tree = line.match(/^\s*searchTree(?:_(\d+)_)?(\d+)\s*=\s*(.+?)\s*$/);
      if (tree) {
        entries.push({
          sku:      tree[1] !== undefined ? parseInt(tree[1], 10) : 0,
          priority: parseInt(tree[2], 10),
          fileName: tree[3],  // searchTree values are not quoted in real client cfgs
          baseDir,
          order:    order++,
          family:   'searchTree',
        });
        continue;
      }

      // searchTOC_<sku>_<priority>="path/to/sku.toc"
      // Values are quoted when the path contains spaces — stripQuotes before use (T-04.2-07).
      const toc = line.match(/^\s*searchTOC(?:_(\d+)_)?(\d+)\s*=\s*(.+?)\s*$/);
      if (toc) {
        entries.push({
          sku:      toc[1] !== undefined ? parseInt(toc[1], 10) : 0,
          priority: parseInt(toc[2], 10),
          fileName: stripQuotes(toc[3]),
          baseDir,
          order:    order++,
          family:   'searchTOC',
        });
        continue;
      }

      // searchPath_<sku>_<priority>="absolute/loose/dir"
      // Values are quoted when the path contains spaces — stripQuotes before use (T-04.2-07).
      const sp = line.match(/^\s*searchPath(?:_(\d+)_)?(\d+)\s*=\s*(.+?)\s*$/);
      if (sp) {
        entries.push({
          sku:      sp[1] !== undefined ? parseInt(sp[1], 10) : 0,
          priority: parseInt(sp[2], 10),
          fileName: stripQuotes(sp[3]),
          baseDir,
          order:    order++,
          family:   'searchPath',
        });
        continue;
      }

      // TOCTreePath="absolute/data/root/" — can repeat; collect all values.
      // Used by Plan 03 tocReader to prefix constituent .tre archive names.
      const ttp = line.match(/^\s*TOCTreePath\s*=\s*(.+?)\s*$/);
      if (ttp) {
        tocTreePaths.push(stripQuotes(ttp[1]));
        continue;
      }

      const inc = line.match(/^\.include\s+"([^"]+)"/);
      if (inc) {
        // Skip the toolkit's own deploy cfg — we want the pristine client base set.
        if (path.basename(inc[1]).toLowerCase() === TOOLKIT_CFG) continue;
        processFile(path.join(baseDir, inc[1]));
      }
    }
  }

  processFile(rootCfgPath);
  return { entries, maxPriority, tocTreePaths };
}

/**
 * Unified mount order output from a client cfg chain.
 *
 * trePaths/priorities — the searchTree .tre paths in client precedence order (index 0 =
 *   highest precedence), with strictly-descending compact priorities. Backward-compat.
 * searchTreeRawPriorities — raw cfg priorities parallel to trePaths (e.g. [8, 7]).
 *   Plan 03 treAutoMount uses these for unified cross-family priority compaction (B2 fix)
 *   instead of the compact priorities.
 * looseDirs — searchPath dirs sorted priority DESC (looseDirs[0] = deploy target).
 * looseDirPriorities — raw cfg priorities parallel to looseDirs (e.g. [10, 9, 5]).
 *   Plan 03 uses these for compaction; Plan 04 resolveOverrideDir picks index 0 (max).
 * tocEntries — searchTOC entries NOT yet expanded to .tre paths (Plan 03 expandTocEntries).
 * tocTreePaths — TOCTreePath values for resolving tocEntry tree names (Plan 03).
 * maxPriority — resolved maxSearchPriority from the full cfg chain (Plan 05 guard).
 *
 * Source: 04.2-PLAN.md §interfaces block; 04.2-PATTERNS.md §clientSearchOrder.ts.
 */
export interface ClientMountOrder {
  /** Absolute .tre paths in client precedence order (index 0 = highest precedence),
   *  searchTree family only. */
  trePaths:   string[];
  /** Compact mount priorities for trePaths (strictly descending); searchTree only.
   *  Plan 03 treAutoMount IGNORES these and uses searchTreeRawPriorities for unified
   *  cross-family compaction (B2 root fix). Kept for backward compat with call sites
   *  that used the pre-extension ClientMountOrder. */
  priorities: number[];
  /** Raw cfg priorities parallel to trePaths (e.g. [8, 7] for the live swg-client-v2 cfg).
   *  Used by Plan 03 for cross-family unified priority compaction (B2 root fix). */
  searchTreeRawPriorities: number[];
  /** searchPath dirs sorted by priority DESC (looseDirs[0] = max priority = deploy target). */
  looseDirs:  string[];
  /** Raw cfg priorities parallel to looseDirs (e.g. [10, 9, 5] for the live cfg).
   *  Used by Plan 03 for unified compaction and Plan 04 resolveOverrideDir (pick index 0). */
  looseDirPriorities: number[];
  /** searchTOC entries NOT yet expanded to .tre paths — expansion is in Plan 03 treAutoMount. */
  tocEntries: Array<{ tocFilePath: string; priority: number }>;
  /** TOCTreePath values for resolving tocEntry tree names (Plan 03 expandTocEntries). */
  tocTreePaths: string[];
  /** Resolved maxSearchPriority from the full cfg chain (used by Plan 05 override-dir guard). */
  maxPriority: number;
}

/**
 * Build the client's full mount order from the cfg chain.
 *
 * cfgPath may be:
 *   (a) a direct .cfg file path   — read it directly (e.g. 'D:/Code/swg-client-v2/stage-x64/client.cfg')
 *   (b) an install directory      — derive cfg via resolveLayout(cfgPath)?.cfgFile ?? 'swgemu.cfg'
 *
 * Returns null ONLY when the cfg has zero entries across all three families
 * (searchTree + searchTOC + searchPath). A pure-searchTOC or pure-searchPath client is
 * valid and returns a non-null ClientMountOrder with empty trePaths.
 *
 * @param cfgPath     Direct .cfg file path OR install directory (auto-detected via statSync).
 * @param installRoot Absolute install root that relative searchTree filenames resolve against.
 *
 * Source: 04.2-PLAN.md Task 2; 04.2-PATTERNS.md §clientSearchOrder.ts; CLIENT-02, TRE-05.
 */
export function resolveClientMountOrder(cfgPath: string, installRoot: string): ClientMountOrder | null {
  // Two-arg form: detect whether cfgPath is a file or directory.
  // statSync wrapped in try/catch — returns false (directory form) on any error.
  let resolvedCfgPath: string;
  try {
    const stat = fs.statSync(cfgPath);
    if (stat.isFile()) {
      resolvedCfgPath = cfgPath;
    } else {
      // cfgPath is a directory — derive the cfg file via resolveLayout.
      const layout = resolveLayout(cfgPath);
      resolvedCfgPath = path.join(cfgPath, layout?.cfgFile ?? 'swgemu.cfg');
    }
  } catch {
    // cfgPath does not exist or is not accessible — treat as a direct file path and
    // let parseSearchNodes handle the missing-file case (existsSync guard).
    resolvedCfgPath = cfgPath;
  }

  const { entries, maxPriority, tocTreePaths } = parseSearchNodes(resolvedCfgPath);
  if (entries.length === 0) return null;

  // Sort all entries by the same TreeFile precedence rule:
  // priority DESC, sku DESC (later sku = added later in install loop), order DESC
  // (later cfg line within same sku+priority = later-added = higher precedence).
  const sortFn = (a: RawEntry, b: RawEntry): number =>
    b.priority - a.priority ||
    b.sku      - a.sku      ||
    b.order    - a.order;

  // ── searchTree family ──────────────────────────────────────────────────────
  // Existing behavior: resolve to absolute paths, skip missing files, de-dup.
  // NEW: also populate searchTreeRawPriorities (parallel to trePaths, raw cfg priority).
  const orderedTree = entries
    .filter(e => e.family === 'searchTree' && e.priority <= maxPriority)
    .sort(sortFn);

  // Shared seen set — de-dup across ALL three families by resolved absolute path.
  const seen = new Set<string>();
  const trePaths: string[] = [];
  const searchTreeRawPriorities: number[] = [];

  for (const e of orderedTree) {
    const abs = path.isAbsolute(e.fileName) ? e.fileName : path.join(installRoot, e.fileName);
    const key = abs.toLowerCase();
    if (seen.has(key)) continue;
    if (!fs.existsSync(abs)) continue;   // skip missing .tre files (client WARNs + skips)
    seen.add(key);
    trePaths.push(abs);
    searchTreeRawPriorities.push(e.priority);  // raw cfg priority, parallel to trePaths
  }

  // Strictly-descending compact priorities preserve the exact precedence through the native
  // mount (which resolves higher-priority-first): index 0 gets the largest number.
  // Plan 03 ignores these in favor of searchTreeRawPriorities for unified compaction.
  const priorities = trePaths.map((_, i) => trePaths.length - i);

  // ── searchPath family (loose dirs) ────────────────────────────────────────
  // Sorted priority DESC: looseDirs[0] = max-priority = deploy target dir.
  // looseDirPriorities is the parallel raw-priority array for Plan 03 compaction.
  // No existsSync check: dirs may not exist yet (created at deploy time).
  const orderedPath = entries
    .filter(e => e.family === 'searchPath' && e.priority <= maxPriority)
    .sort(sortFn);

  const looseDirs: string[] = [];
  const looseDirPriorities: number[] = [];

  for (const e of orderedPath) {
    const abs = path.isAbsolute(e.fileName) ? e.fileName : path.join(installRoot, e.fileName);
    const key = abs.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    looseDirs.push(abs);
    looseDirPriorities.push(e.priority);
  }

  // ── searchTOC family ──────────────────────────────────────────────────────
  // TOC entries are NOT expanded here — expansion (tree-name block read + TOCTreePath prefix)
  // is performed by Plan 03 treAutoMount / tocReader.ts.
  // Priority order matches the other families (DESC): tocEntries[0] = highest-priority TOC.
  const orderedToc = entries
    .filter(e => e.family === 'searchTOC' && e.priority <= maxPriority)
    .sort(sortFn);

  const tocEntries: Array<{ tocFilePath: string; priority: number }> = [];

  for (const e of orderedToc) {
    const abs = path.isAbsolute(e.fileName) ? e.fileName : path.join(installRoot, e.fileName);
    const key = abs.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    tocEntries.push({ tocFilePath: abs, priority: e.priority });
  }

  // Return null ONLY when all three families have zero entries after filtering.
  // A pure-searchTOC client (no searchTree) is valid — Plan 03 needs tocEntries.
  if (trePaths.length === 0 && looseDirs.length === 0 && tocEntries.length === 0) {
    return null;
  }

  return {
    trePaths,
    priorities,
    searchTreeRawPriorities,
    looseDirs,
    looseDirPriorities,
    tocEntries,
    tocTreePaths,
    maxPriority,
  };
}
