/**
 * packages/renderer/src/services/treAutoMount.ts
 * TRE auto-mount helpers for client projects.
 *
 * Exports:
 *   autoMountClient(installPath, cfgPath?) — unified single-mount for a client install
 *     (B1: one mountTrePaths call; B2: cross-family sort; B4: isOverride gate).
 *     cfgPath = the binding's resolved client cfg; when omitted, the cfg is derived from
 *     installPath (directory form). This is the live mount path for kind:'client' projects
 *     (workspaceService.openWorkspace) — it expands searchTOC into the full archive set,
 *     which the legacy autoMountTarget (searchTree-only) does NOT.
 *   autoMountTarget(params)      — legacy standalone/tre-set mount (workspaceService compat)
 *
 * B1 root cause (treStore.ts:159): the store's mountComplete does a full Zustand set({})
 * which REPLACES all state. Calling mountTrePaths twice erased everything from the first
 * call. Fix: build ONE ordered list across all cfg families and call mountTrePaths ONCE.
 *
 * B2 root cause: per-family compact sequences ignored raw priority context across families,
 * allowing a low-priority TOC TRE to silently outrank a high-priority searchTree TRE.
 * Fix: unified sort on rawPriority DESC before compact assignment.
 *
 * B4 root cause: injectLooseDirOverlay was called with unconditional isOverride=true.
 * Fix: compare looseDirRawPriority against maxTreRawPriority.
 *
 * Sources: 04.2-03-PLAN.md; 04.2-RESEARCH.md §Capability 2; 04.2-PATTERNS.md §treAutoMount.ts
 */

import * as path from 'path';
import * as fs   from 'fs';
import { resolveClientMountOrder } from './clientSearchOrder';
import { readTocTreeNames }        from './tocReader';
import { mountTrePaths, mountTreMountWithTocPaths, mountComplete, injectLooseDirOverlay, beginMountStatus, endMountStatusIfPending } from './treMount';
import { log } from './logService';
import type { ClientMountOrder }   from './clientSearchOrder';

// ─── MountNode (internal) ─────────────────────────────────────────────────────

/** Internal ordered TRE descriptor — NOT exported. */
interface MountNode {
  kind:        'tre';
  path:        string;
  rawPriority: number;
  /** Tie-break: sku of origin (0 for searchTree, tocEntry index for TOC family). */
  sku:         number;
  /** Tie-break within same sku/priority. */
  cfgIndex:    number;
}

// ─── buildTreNodes ────────────────────────────────────────────────────────────

/**
 * Build the unified ordered TRE node list from a ClientMountOrder.
 *
 * 1. searchTree family: one node per trePath (rawPriority from searchTreeRawPriorities).
 * 2. tocEntry family: for each tocEntry, expand to .tre names via readTocTreeNames; try
 *    each TOCTreePath prefix with existsSync; push on first match; warn + skip on miss.
 * 3. Sort all nodes: rawPriority DESC, sku DESC, cfgIndex DESC.
 */
function buildTreNodes(order: ClientMountOrder): MountNode[] {
  const nodes: MountNode[] = [];

  // ── searchTree family ──────────────────────────────────────────────────────
  for (let i = 0; i < order.trePaths.length; i++) {
    nodes.push({
      kind:        'tre',
      path:        order.trePaths[i]!,
      rawPriority: order.searchTreeRawPriorities[i] ?? 0,
      sku:         0,
      cfgIndex:    i,
    });
  }

  // ── tocEntry family ────────────────────────────────────────────────────────
  for (let t = 0; t < order.tocEntries.length; t++) {
    const tocEntry = order.tocEntries[t]!;
    let treeNames: string[];
    try {
      treeNames = readTocTreeNames(tocEntry.tocFilePath);
    } catch (err) {
      console.warn('[treAutoMount] failed to read TOC tree names from', tocEntry.tocFilePath, ':', err);
      continue;
    }

    for (const name of treeNames) {
      let found = false;
      for (const prefix of order.tocTreePaths) {
        const candidate = path.join(prefix, name);
        if (fs.existsSync(candidate)) {
          nodes.push({
            kind:        'tre',
            path:        candidate,
            rawPriority: tocEntry.priority,
            sku:         t,
            cfgIndex:    t,
          });
          found = true;
          break; // next name
        }
      }
      if (!found) {
        console.warn('[treAutoMount] missing .tre (no matching TOCTreePath prefix):', name);
      }
    }
  }

  // ── Unified sort: rawPriority DESC, sku DESC, cfgIndex DESC ───────────────
  nodes.sort(
    (a, b) =>
      (b.rawPriority - a.rawPriority) ||
      (b.sku         - a.sku        ) ||
      (b.cfgIndex    - a.cfgIndex   ),
  );

  return nodes;
}

// ─── autoMountClient ──────────────────────────────────────────────────────────

/**
 * Mount the full client TRE set for `installPath` using the unified single-mount strategy.
 *
 * Step sequence (B1 compliance — each called EXACTLY ONCE):
 *   1. resolveClientMountOrder → unified ClientMountOrder
 *   2. buildTreNodes → ONE ordered list (searchTree + expanded TOC, sorted by rawPriority DESC)
 *   3. Assign compact priorities (treNodes.length down to 1)
 *   4. mountTrePaths(allPaths, compactPriorities) — ONCE
 *   5. injectLooseDirOverlay for each loose dir (isOverride gated on B4 condition)
 *   6. mountComplete() — ONCE
 *
 * Non-fatal: errors are logged, never thrown.
 */
export async function autoMountClient(installPath: string, cfgPath?: string, treDir?: string): Promise<void> {
  beginMountStatus('Client TRE set');  // show the TRE-browser spinner for the whole auto-mount
  try {
    // Use the binding's resolved client cfg when provided so we mount the EXACT cfg the
    // client loads (e.g. stage-x64/client.cfg for swg-client-v2). Fall back to installPath
    // (directory form — resolveClientMountOrder derives the cfg via resolveLayout) for
    // one-arg callers/tests. installPath is always the install root for relative resolution.
    const order = resolveClientMountOrder(cfgPath ?? installPath, installPath);
    if (!order) {
      // No cfg-declared mount order (the cfg has no searchTree/searchTOC/searchPath entries).
      // Fall back to a plain directory scan of treDir — preserves the legacy autoMountTarget
      // behavior for a minimal-cfg client (e.g. a swgemu.cfg with no searchTree but .tre files
      // present in Live/). A real client cfg always declares its set, so this only fires for
      // the simplified/standalone case. T-04.1-03: only .tre directly in treDir (no sub-dirs).
      if (treDir) {
        const treFiles = fs.readdirSync(treDir)
          .filter(f => f.endsWith('.tre') && !f.includes('/') && !f.includes('\\'))
          .sort();
        if (treFiles.length > 0) {
          await mountTrePaths(treFiles.map(f => path.join(treDir, f)), treFiles.map((_, i) => i + 1));
          mountComplete();
          log('info', 'log', `Mounted ${treFiles.length} archives for ${installPath} (directory scan)`);
          return;
        }
      }
      console.warn('[autoMountClient] no mount order resolved for', installPath);
      endMountStatusIfPending();  // nothing mounted — clear the spinner
      return;
    }

    // Build ONE ordered list across all TRE families.
    const treNodes = buildTreNodes(order);

    // Compact priorities: highest compact = most important (index 0 = treNodes.length).
    const compactPriorities = treNodes.map((_, i) => treNodes.length - i);

    // Mount all TRE archives in a single call (B1 fix — no second call).
    // MOUNT-01/06: searchTOC clients route through mountTreMountWithTocPaths so the
    // native layer sources entries from the master .toc (empty-internal-TOC v6000
    // containers contribute their entries). searchTree-only clients use mountTrePaths
    // (unchanged — Infinity/SWGEmu regression guard MOUNT-06).
    if (order.tocEntries.length > 0) {
      const tocEntry = order.tocEntries[0]!;
      await mountTreMountWithTocPaths(
        treNodes.map(n => n.path),
        compactPriorities,
        tocEntry.tocFilePath,
        order.tocTreePaths[0] ?? '',
      );
    } else {
      await mountTrePaths(treNodes.map(n => n.path), compactPriorities);
    }

    // maxTreRawPriority: the highest raw priority among searchTree TREs.
    // Used to gate isOverride for loose dirs (B4 fix).
    const maxTreRawPriority = order.searchTreeRawPriorities.length > 0
      ? Math.max(...order.searchTreeRawPriorities)
      : 0;

    // Inject loose-dir overlays (B4: conditional isOverride).
    for (let i = 0; i < order.looseDirs.length; i++) {
      const dir         = order.looseDirs[i]!;
      const rawPriority = order.looseDirPriorities[i] ?? 0;
      injectLooseDirOverlay(dir, { isOverride: rawPriority > maxTreRawPriority });
    }

    // Signal pipeline complete (B1 structural gate — called ONCE).
    mountComplete();
    log('info', 'log', `Mounted ${treNodes.length} archives for ${installPath}`);
  } catch (err) {
    console.error('[autoMountClient] mount failed:', err);
    log('warn', 'log', `Mount failed for ${installPath}: ${(err as Error)?.message ?? String(err)}`);
    endMountStatusIfPending();  // clear the spinner on failure
  }
}

// ─── autoMountTarget (legacy) ─────────────────────────────────────────────────

// Path B fs (nodeIntegration:true) — never bundled by Vite.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const legacyFs = require('fs') as typeof import('fs');

export interface AutoMountParams {
  kind:     'client' | 'tre-set' | 'mod-project';
  /** Resolved client root cfg (for the searchTree order) — client only. */
  cfgPath?: string;
  /** Directory whose .tre files are mounted. */
  treDir?:  string;
  /** Install root that relative searchTree filenames resolve against (client only). */
  target:   string;
}

/**
 * Legacy mount for standalone targets (workspaceService.ts compat).
 * Mount the project's target TRE set. Non-fatal: errors are logged, never thrown.
 * No-op when there is no treDir.
 */
export async function autoMountTarget(params: AutoMountParams): Promise<void> {
  const { kind, cfgPath, treDir, target } = params;
  if (!treDir) return;
  beginMountStatus('TRE set');  // show the TRE-browser spinner for the whole auto-mount
  try {
    let trePaths:   string[];
    let priorities: number[];

    // Client: mount the exact set + precedence the client loads (from the cfg searchTree).
    const order = kind === 'client' && cfgPath ? resolveClientMountOrder(cfgPath, target) : null;
    if (order) {
      ({ trePaths, priorities } = order);
    } else {
      // Standalone target (or a cfg with no searchTree): plain directory scan.
      // T-04.1-03: only .tre files directly in treDir (no sub-dirs / path injection).
      const treFiles = legacyFs.readdirSync(treDir)
        .filter((f) => f.endsWith('.tre') && !f.includes('/') && !f.includes('\\'))
        .sort();  // ascending alphabetical = ascending priority
      if (treFiles.length === 0) { endMountStatusIfPending(); return; }
      trePaths   = treFiles.map((f) => path.join(treDir, f));
      priorities = treFiles.map((_, i) => i + 1);
    }

    await mountTrePaths(trePaths, priorities);
    log('info', 'log', `Mounted ${trePaths.length} archives for ${target}`);
  } catch (err) {
    console.error('[autoMountTarget] mount failed:', err);
    log('warn', 'log', `Mount failed for ${target}: ${(err as Error)?.message ?? String(err)}`);
    endMountStatusIfPending();  // clear the spinner on failure
  }
}
