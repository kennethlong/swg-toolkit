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
 * searchTree filenames are relative to the client's working dir (= install root); absolute
 * values are used as-is. The toolkit's own deploy cfg (swgtoolkit.cfg) is excluded so the
 * mounted set is the pristine client base.
 */

import path from 'path';

// Path B fs (nodeIntegration:true) — never bundled by Vite.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const fs = require('fs') as typeof import('fs');

/** The toolkit's own deploy cfg — excluded from the base mount set. */
const TOOLKIT_CFG = 'swgtoolkit.cfg';

interface RawEntry {
  sku:       number;  // parsed from the _NN_ suffix (0 when no sku suffix)
  priority:  number;  // the numeric slot — higher wins
  fileName:  string;  // searchTree value (relative to install root, or absolute)
  baseDir:   string;  // dir of the cfg file the entry was declared in
  order:     number;  // global parse-encounter index (for stable index-within-key order)
}

/**
 * Parse the [SharedFile] searchTree entries across the full `.include` chain.
 * Returns the entries plus the resolved maxSearchPriority (LAST-wins).
 */
function parseSearchTree(rootCfgPath: string): { entries: RawEntry[]; maxPriority: number } {
  const entries: RawEntry[] = [];
  let maxPriority = 20;            // ConfigFile default (TreeFile.cpp:102)
  let order = 0;
  const visited = new Set<string>();

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
          fileName: tree[3],
          baseDir,
          order:    order++,
        });
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
  return { entries, maxPriority };
}

export interface ClientMountOrder {
  /** Absolute .tre paths in client precedence order (index 0 = highest precedence). */
  trePaths:   string[];
  /** Parallel mount priorities (strictly descending) reproducing that precedence. */
  priorities: number[];
}

/**
 * Build the client's TRE mount order from the cfg chain. Returns null when the cfg has no
 * searchTree config (caller should fall back to a plain directory scan).
 *
 * @param rootCfgPath  absolute path to the client root cfg (e.g. <install>/swgemu.cfg)
 * @param installRoot  absolute install root that relative searchTree filenames resolve against
 */
export function resolveClientMountOrder(rootCfgPath: string, installRoot: string): ClientMountOrder | null {
  const { entries, maxPriority } = parseSearchTree(rootCfgPath);
  if (entries.length === 0) return null;

  // Drop entries above maxSearchPriority (the client only scans priority <= max), then
  // order them as TreeFile would: priority DESC, and within equal priority the later-added
  // wins. Add order = sku ascending, then priority ascending, then cfg index — which for a
  // fixed priority reduces to (sku ASC, order ASC); "later wins" → (sku DESC, order DESC).
  const ordered = entries
    .filter((e) => e.priority <= maxPriority)
    .sort((a, b) =>
      b.priority - a.priority ||   // higher priority first
      b.sku      - a.sku      ||   // ties: higher sku first (added later)
      b.order    - a.order,        // then later cfg line first
    );

  // Resolve to absolute paths; skip missing files (the client WARNs and skips), and
  // de-dup the same file appearing under multiple slots (first/highest precedence wins).
  const seen = new Set<string>();
  const trePaths: string[] = [];
  for (const e of ordered) {
    const abs = path.isAbsolute(e.fileName) ? e.fileName : path.join(installRoot, e.fileName);
    const key = abs.toLowerCase();
    if (seen.has(key)) continue;
    if (!fs.existsSync(abs)) continue;
    seen.add(key);
    trePaths.push(abs);
  }

  if (trePaths.length === 0) return null;

  // Strictly-descending priorities preserve the exact precedence through the native mount
  // (which resolves higher-priority-first): index 0 gets the largest number.
  const priorities = trePaths.map((_, i) => trePaths.length - i);
  return { trePaths, priorities };
}
