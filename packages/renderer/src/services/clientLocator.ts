/**
 * packages/renderer/src/services/clientLocator.ts
 * Client install detection + .cfg chain scanning (DEPLOY-02).
 *
 * Exports:
 *   SharedFileScan              — interface: { skuSuffix, maxSearchPriority, occupiedSlots }
 *   scanSharedFile(rootCfgPath) — B1 fix: walks the FULL .include chain from the root cfg;
 *                                  LAST-wins maxSearchPriority (ConfigFile.cpp:797, N5 fix)
 *   chooseSlot(scan)            — returns next free slot above the highest occupied slot
 *   detectClients()             — probes Windows registry + known paths; all errors caught
 *   addManualClient(installPath)— validates a user-supplied client install path
 *
 * B1 fix (Cursor+Sonnet cross-confirmed):
 *   scanSharedFile MUST walk the full .include chain (swgemu.cfg → swgemu_live.cfg → …).
 *   Scanning only the empty toolkit-owned swgtoolkit.cfg gives occupiedSlots=[] → slot 1,
 *   which is BELOW retail slots 30-54 → shadowed BY retail → silent no-load. Bug.
 *   Fix: always call scanSharedFile(client.cfgRootPath) i.e. swgemu.cfg (the chain root).
 *
 * N5 fix: prior comment "first-wins for maxSearchPriority" was BACKWARDS.
 *   Real engine: ConfigFile.cpp:797 overwrites each time → LAST value seen wins.
 *   Appending swgtoolkit.cfg AFTER swgemu_live.cfg lets any toolkit bump win.
 *
 * Pitfall 3 fix: does NOT reuse the injection addon for install detection.
 *   The injection addon only takes a user-supplied exe path or PID — no install discovery.
 *   Client detection is NEW work (registry + known-path probes).
 *
 * Path B renderer: nodeIntegration:true, contextIsolation:false — fs/path/child_process usable.
 *
 * Source:
 *   swg-client-v2 ConfigFile.cpp:359-518 (.include + maxSearchPriority parsing).
 *   swg-client-v2 ConfigFile.cpp:797 (LAST-wins maxSearchPriority — N5 ground truth).
 *   swg-client-v2 TreeFile.cpp:90-191 (searchTree_<sku>_<priority>= key format).
 *   04-03-PLAN.md Task 2; 04-CONTEXT.md §D-04-09/12; 04-RESEARCH.md §OQ-1.
 */

import path from 'path';
import fs from 'fs';
import { execFileSync } from 'child_process';

import type { DetectedClient } from '@swg/contracts';
import { resolveLayout } from './clientLayout';

// ─── SharedFileScan ────────────────────────────────────────────────────────────

/**
 * Result of scanning the .cfg include chain for SharedFile entries.
 *
 * CANONICAL definition lives here. cfgActivator.ts re-exports from this module —
 * never re-implements these types or functions.
 *
 * Source: ConfigFile.cpp:359-518 (SharedFile section parsing);
 *         TreeFile.cpp:90-191 (searchTree key format).
 */
export interface SharedFileScan {
  /**
   * SKU suffix extracted from the first searchTree key found.
   * Example: '_00_' for 'searchTree_00_30=bottom.tre'.
   * Defaults to '_00_' if no searchTree keys are present.
   */
  skuSuffix: string;
  /**
   * LAST maxSearchPriority value seen across the entire .include chain.
   * LAST-wins per ConfigFile.cpp:797 — each new occurrence overwrites the previous.
   * Default 20 if not set (stock SWGEmu install without a live cfg).
   *
   * N5 fix: the prior plan comment stated "first-wins" — that was BACKWARDS.
   * The real engine (ConfigFile.cpp:797) assigns each value, so the last one wins.
   */
  maxSearchPriority: number;
  /**
   * All numeric priority slots found across the entire .include chain.
   * Example: [30, 31, 32, ..., 54] for a stock Infinity install.
   */
  occupiedSlots: number[];
}

// ─── scanSharedFile ────────────────────────────────────────────────────────────

/**
 * Walk the full .include chain from a root .cfg file and collect SharedFile entries.
 *
 * B1 fix: previously callers passed the empty toolkit cfg, yielding occupiedSlots=[] →
 * chooseSlot returned 1, which is BELOW retail (retail slots 30-54) → the toolkit patch
 * was silently shadowed by retail and never loaded. This function MUST be called with
 * the CLIENT root cfg (e.g. swgemu.cfg), not the toolkit-owned cfg.
 *
 * N5: LAST-wins for maxSearchPriority (ConfigFile.cpp:797). Each .include'd file that
 * sets maxSearchPriority overwrites the previous value.
 *
 * .include line syntax: .include "filename.cfg" (quotes required; path relative to dir).
 * Circular include guard via Set<string> of absolute paths.
 *
 * @param rootCfgPath  Absolute path to the client root cfg (e.g. swgemu.cfg).
 * @returns SharedFileScan with LAST-wins maxSearchPriority and all occupied slots.
 */
export function scanSharedFile(rootCfgPath: string): SharedFileScan {
  const result: SharedFileScan = {
    skuSuffix: '_00_',
    maxSearchPriority: 20,  // ConfigFile default when not set
    occupiedSlots: [],
  };
  const visited = new Set<string>();

  function processFile(cfgPath: string): void {
    const absPath = path.resolve(cfgPath);
    if (visited.has(absPath)) return;  // circular include guard
    visited.add(absPath);
    if (!fs.existsSync(absPath)) return;

    const text = fs.readFileSync(absPath, 'utf8');
    const dir = path.dirname(absPath);

    for (const line of text.split(/\r?\n/)) {
      // maxSearchPriority: LAST-wins (ConfigFile.cpp:797) — each new value overwrites.
      // N5: NOT first-wins — the last occurrence across the full chain is used.
      const maxMatch = line.match(/^\s*maxSearchPriority\s*=\s*(\d+)/);
      if (maxMatch) {
        result.maxSearchPriority = parseInt(maxMatch[1], 10);
      }

      // searchTree_<sku>_<NN>= entries (e.g. searchTree_00_30=live1.tre)
      // The numeric suffix IS the priority (higher wins, first-match per TreeFile.cpp).
      const treeMatch = line.match(/^\s*searchTree(_\d+_)(\d+)\s*=/);
      if (treeMatch) {
        result.skuSuffix = treeMatch[1];
        result.occupiedSlots.push(parseInt(treeMatch[2], 10));
      }

      // .include "filename.cfg" — recurse into included file (relative to current dir)
      const includeMatch = line.match(/^\.include\s+"([^"]+)"/);
      if (includeMatch) {
        processFile(path.join(dir, includeMatch[1]));
      }
    }
  }

  processFile(rootCfgPath);
  return result;
}

// ─── chooseSlot ────────────────────────────────────────────────────────────────

/**
 * Choose a free priority slot for the toolkit patch.
 *
 * Returns max(occupiedSlots) + 1 — the next slot above the highest occupied.
 * For a stock Infinity install (slots 30-54), returns 55.
 *
 * With the B1 fix, scan ALWAYS comes from scanSharedFile(swgemu.cfg), so occupiedSlots
 * always contains the retail slots (30-54) and this function returns 55, not 1.
 *
 * N5: prior comment "chooseSlot on empty yields 1" is now PREVENTED by the B1 fix —
 * callers must always use scanSharedFile(swgemu.cfg), not the empty toolkit cfg.
 *
 * @param scan  Result of scanSharedFile(clientRootCfgPath) — the FULL chain scan.
 * @returns     The next free priority slot number.
 */
export function chooseSlot(scan: SharedFileScan): number {
  if (scan.occupiedSlots.length === 0) {
    // No retail slots found (e.g. SWGEmu without a live cfg).
    // Use a safe default below maxSearchPriority.
    return Math.max(1, scan.maxSearchPriority - 5);
  }
  return Math.max(...scan.occupiedSlots) + 1;
}

// ─── Known client paths ───────────────────────────────────────────────────────

/**
 * A well-known SWG distro name shown as a "not found" row when the content scan
 * did not turn it up on disk (P4 sketch 007-B). Matched to detected clients by
 * NAME (case-insensitive), not by a hardcoded path — detection is now content-based
 * (scanForClients finds installs wherever their .tre files live), so a fixed path
 * list would produce false "not found" rows for installs sitting in renamed dirs.
 *
 * `installPath` is optional/informational only (a hint for the tooltip); the
 * found-vs-missing decision is by name.
 */
export interface KnownClientPath {
  name: string;
  installPath?: string;
}

/**
 * Return the curated list of popular SWG distros for the welcome screen.
 *
 * These are matched by NAME against detectClients()/scanForClients() results:
 * any curated distro whose name is not among the detected names is shown as a
 * "✗ not found" informational row (sketch 007-B P4). This intentionally does NOT
 * gate detection — a distro installed under any folder name is still auto-detected
 * by its .tre content; this list only decides which well-known names to surface as
 * "not installed" hints.
 *
 * Source: 04.3-08-PLAN.md P4; client-detection-and-layout-model.md (content-based detection).
 */
export function getKnownClientPaths(): KnownClientPath[] {
  return [
    { name: 'SWG Infinity' },
    { name: 'SWGEmu' },
    { name: 'SWG Restoration' },
    { name: 'SWG Legends' },
  ];
}

// ─── Content-based scan (find installs by their .tre files, not by folder name) ──

/**
 * Directory basenames that are never worth descending into during a scan
 * (system trees, package caches, junk). Skipped even by the deep scan.
 */
const ALWAYS_PRUNE = new Set<string>([
  'windows', '$recycle.bin', 'system volume information', '$winreagent',
  'recovery', 'perflogs', 'msocache', '$sysreset', 'config.msi', 'node_modules',
]);

/**
 * Additional heavy trees pruned by the SHALLOW (default) scan for speed. The deep
 * "Scan all drives" scan does NOT prune these, so a client installed under e.g.
 * a user profile or Program Files is still found when the user opts in.
 */
const SHALLOW_ONLY_PRUNE = new Set<string>([
  'program files', 'program files (x86)', 'programdata', 'users', 'appdata',
  'intel', 'amd', 'nvidia',
]);

/**
 * Generic container-dir names that are NOT the distro's identity. When the .tre
 * dir has one of these basenames, the friendly name is taken from its PARENT
 * (e.g. …\SWG Infinity\SWG Infinity\Live → "SWG Infinity"; …\SWG Beyond\Win64 → "SWG Beyond").
 */
const GENERIC_DIR_NAMES = new Set<string>([
  'live', 'win64', 'win32', 'bin', 'client', 'clientside', 'game', 'gamedata', 'data',
]);

/** Enumerate existing fixed-drive roots (C:\ … Z:\). */
function getScanRoots(): string[] {
  const roots: string[] = [];
  for (let code = 'C'.charCodeAt(0); code <= 'Z'.charCodeAt(0); code++) {
    const root = `${String.fromCharCode(code)}:\\`;
    try { if (fs.existsSync(root)) roots.push(root); } catch { /* skip */ }
  }
  return roots;
}

/** Derive a human-readable distro name from the directory that holds the .tre files. */
function deriveClientName(treDir: string): string {
  const base = path.basename(treDir);
  if (GENERIC_DIR_NAMES.has(base.toLowerCase())) {
    const parent = path.basename(path.dirname(treDir));
    if (parent) return parent;
  }
  return base;
}

/**
 * Classify a directory KNOWN to contain .tre files into a DetectedClient.
 * Requires a recognized cfg beside the archives (resolveLayout) — a bare .tre
 * folder with no cfg (e.g. an extraction dump) is skipped so it can't be bound/deployed.
 */
function classifyClientDir(treDir: string): DetectedClient | null {
  const layout = resolveLayout(treDir);
  if (!layout) return null;
  const cfgRootPath = path.join(treDir, layout.cfgFile);
  if (!fs.existsSync(cfgRootPath)) return null;
  return {
    name:        deriveClientName(treDir),
    installPath: treDir,
    cfgRootPath,
    treVersion:  _detectTreVersion(treDir),
  };
}

/**
 * Options controlling how the content scan searches for client installs.
 */
export interface ScanOptions {
  /** Roots to scan. Default: all existing fixed drives (C:\ … Z:\). */
  roots?: string[];
  /** Max recursion depth from each root. Default: 3 (shallow) / 8 (deep). */
  maxDepth?: number;
  /** Exhaustive mode — higher depth + no shallow-only pruning (the "Scan all drives" button). */
  deep?: boolean;
}

/**
 * Find SWG client installs by locating directories that CONTAIN .tre files, rather
 * than matching hardcoded folder names. This handles the real-world variety of layouts:
 *   • …\SWG Infinity\SWG Infinity\Live  (cfg + tre in a Live/ subdir)
 *   • …\SWGEmu-Client\SWGEmu            (cfg + tre at root; folder name varies)
 *   • C:\EmpireInFlames                 (SWGEmu-based, tre at root)
 *   • …\SWG Beyond\Win64                (client.cfg + tre in a Win64/ subdir)
 *
 * A directory containing ≥1 .tre is treated as a client (classified via resolveLayout;
 * a cfg beside the archives is required). The walk does NOT descend into a client's own
 * subtree once found. Errors per-directory are swallowed (unreadable/permission dirs skipped).
 *
 * Every fs call is read-only. Never reuses the injection addon (Pitfall 3).
 *
 * Source: client-detection-and-layout-model.md (maintainer: "look for the TRE files").
 */
export function scanForClients(opts: ScanOptions = {}): DetectedClient[] {
  if (process.platform !== 'win32') return [];

  const deep     = opts.deep === true;
  const maxDepth = opts.maxDepth ?? (deep ? 8 : 3);
  const roots    = opts.roots ?? getScanRoots();
  const found: DetectedClient[] = [];
  const seen = new Set<string>();

  function walk(dir: string, depth: number): void {
    if (depth > maxDepth) return;
    let entries: import('fs').Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // unreadable / permission denied — skip this branch
    }

    // If THIS dir holds archives, it's a client: classify and stop descending here.
    const hasTre = entries.some((e) => e.isFile() && e.name.toLowerCase().endsWith('.tre'));
    if (hasTre) {
      const client = classifyClientDir(dir);
      if (client) {
        const key = client.installPath.toLowerCase();
        if (!seen.has(key)) { seen.add(key); found.push(client); }
      }
      return;
    }

    // Otherwise descend into subdirectories (bounded by maxDepth + prune sets).
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const name = e.name.toLowerCase();
      if (name.startsWith('.') || name.startsWith('$')) continue;
      if (ALWAYS_PRUNE.has(name)) continue;
      if (!deep && SHALLOW_ONLY_PRUNE.has(name)) continue;
      walk(path.join(dir, e.name), depth + 1);
    }
  }

  for (const root of roots) walk(root, 0);
  return found;
}

// ─── detectClients ────────────────────────────────────────────────────────────

/**
 * Decoupled dev/modder clients (swg-client-v2 stage builds): a binary dir with
 * client.cfg but ZERO local .tre files (data dir is external, resolved from cfg).
 * These have no .tre signature, so the content scan can't find them — they're probed
 * by explicit path. resolveLayout matches them via the treDirFromCfg row.
 * Source: 04.2-PATTERNS.md §clientLocator.ts; 04.2-RESEARCH.md §Capability 1.
 */
const DECOUPLED_DEV_CANDIDATES: Array<{ name: string; installPath: string }> = [
  { name: 'swg-client-v2 (stage-x64)',    installPath: 'D:\\Code\\swg-client-v2\\stage-x64' },
  { name: 'swg-client-v2 (stage, 32-bit)', installPath: 'D:\\Code\\swg-client-v2\\stage' },
];

/**
 * Auto-detect SWG client installations on this machine.
 *
 * Probes, in order (deduped by installPath):
 *   1. Content scan — directories containing .tre files (shallow, all fixed drives).
 *   2. Decoupled dev clients (swg-client-v2 stage builds) — explicit paths (no .tre signature).
 *   3. Windows registry (HKCU/HKLM SWG Infinity + SWGEmu InstallPath).
 *
 * @param opts  Passed through to the content scan. `{ deep: true }` runs the exhaustive
 *              "Scan all drives" search (used by the Welcome button).
 *
 * Every probe is wrapped in try/catch. Returns [] (not throws) if all probes fail.
 * Never reuses the injection addon for install detection (Pitfall 3).
 *
 * Source: 04-CONTEXT.md §D-04-09; 04-RESEARCH.md §OQ-1; client-detection-and-layout-model.md.
 */
export function detectClients(opts: ScanOptions = {}): DetectedClient[] {
  if (process.platform !== 'win32') return [];

  const candidates: DetectedClient[] = [];
  const seen = new Set<string>();
  const add = (c: DetectedClient): void => {
    const key = path.resolve(c.installPath).toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push(c);
  };

  // 1. Content scan — find installs by their .tre files (folder names vary).
  try {
    for (const c of scanForClients(opts)) add(c);
  } catch { /* scan failure — fall through to explicit probes */ }

  // 2. Decoupled dev clients (no local .tre → invisible to the content scan).
  for (const cand of DECOUPLED_DEV_CANDIDATES) {
    try {
      const layout = resolveLayout(cand.installPath);
      if (!layout) continue;
      add({
        name:        cand.name,
        installPath: cand.installPath,
        cfgRootPath: path.join(cand.installPath, layout.cfgFile),
        treVersion:  _detectTreVersion(cand.installPath),
      });
    } catch { /* skip inaccessible path (Pitfall 3 + T-04-12) */ }
  }

  // 3. Windows registry probes
  const registryKeys = [
    ['HKCU\\Software\\SWG Infinity', 'InstallPath'],
    ['HKCU\\Software\\SWGEmu', 'InstallPath'],
    ['HKLM\\Software\\SWG Infinity', 'InstallPath'],
    ['HKLM\\Software\\SWGEmu', 'InstallPath'],
    ['HKLM\\Software\\WOW6432Node\\SWG Infinity', 'InstallPath'],
    ['HKLM\\Software\\WOW6432Node\\SWGEmu', 'InstallPath'],
  ];

  for (const [key, valueName] of registryKeys) {
    try {
      // Use reg.exe via execFileSync (argument array — not string interpolation)
      // D-04-16: all shell-outs use execFile with argument arrays (never exec with interpolation).
      const stdout = execFileSync('reg', ['query', key, '/v', valueName], {
        encoding: 'utf8',
        timeout: 5000,
        // Ignore stderr so reg.exe's "unable to find the specified registry key" message
        // for an absent key (the common, expected case) never leaks to the terminal.
        // stdout stays piped (returned); the catch below handles the non-zero exit.
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      const match = stdout.match(/REG_SZ\s+(.+)/);
      if (!match) continue;

      const installPath = match[1].trim();

      // D-13: resolveLayout() replaces the hardcoded 'swgemu.cfg' probe; it also
      // confirms the TRE dir has archives so we don't add empty/partial installs.
      const layout = resolveLayout(installPath);
      if (!layout) continue;

      const cfgRootPath = path.join(installPath, layout.cfgFile);
      const treVersion = _detectTreVersion(installPath);
      const name = key.toLowerCase().includes('infinity') ? 'SWG Infinity (registry)' : 'SWGEmu (registry)';
      // add() dedupes against content-scan + dev-client + prior registry hits.
      add({ name, installPath, cfgRootPath, treVersion });
    } catch {
      // Registry key absent or reg.exe failed — silently skip (T-04-12)
    }
  }

  return candidates;
}

// ─── addManualClient ─────────────────────────────────────────────────────────

/**
 * Validate and construct a DetectedClient from a user-supplied install path.
 *
 * Returns null if the path does not look like a valid SWG install.
 *
 * D-04-11: workspace is fully usable offline; manual override is the final fallback.
 *
 * Extended for CLIENT-02: when `opts.cfgFileName` is supplied, bypasses resolveLayout
 * entirely so that decoupled installs (e.g. swg-client-v2) with external TRE dirs can
 * be registered even when auto-detection would return null.
 *
 * @param installPath  Absolute path to the client install root (user-supplied).
 * @param opts         Optional explicit overrides — bypass resolveLayout when present.
 *   opts.cfgFileName  cfg filename to use instead of auto-detecting (e.g. 'client.cfg').
 *   opts.treDir       Absolute path to the TRE directory; passed to _detectTreVersion so
 *                     the version probe reads from the real data dir, not the binary dir.
 * @returns DetectedClient if valid, null on any error.
 *
 * Source: 04.2-PATTERNS.md §clientLocator.ts; CLIENT-02.
 */
export function addManualClient(
  installPath: string,
  opts?: { cfgFileName?: string; treDir?: string },
): DetectedClient | null {
  try {
    if (opts?.cfgFileName) {
      // Explicit override: bypass resolveLayout; construct the client directly.
      // Used for decoupled installs (swg-client-v2) where resolveLayout would return null
      // because auto-detect requires the TRE dir at the install root (which is absent here).
      const cfgRootPath = path.join(installPath, opts.cfgFileName);
      const treVersion  = _detectTreVersion(installPath, opts.treDir);
      return {
        name: 'Manual Install',
        installPath,
        cfgRootPath,
        treVersion,
      };
    }

    // D-13: resolveLayout() replaces the hardcoded 'swgemu.cfg' check so that
    // manual installs with a known non-standard cfgFile are still accepted.
    const layout = resolveLayout(installPath);
    if (!layout) return null;

    const cfgRootPath = path.join(installPath, layout.cfgFile);
    const treVersion  = _detectTreVersion(installPath);
    return {
      name: 'Manual Install',
      installPath,
      cfgRootPath,
      treVersion,
    };
  } catch {
    return null;
  }
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Read the TRE version string from the first archive found in the TRE directory.
 * Returns '5000' for Infinity (EERT5000), '0005' for older clients, or 'unknown'.
 *
 * Reads just the first 8 bytes (magic + version) of the first .tre file found.
 * Fails silently and returns 'unknown' if no .tre files are present or inaccessible.
 *
 * @param installPath     Absolute path to the client install root.
 * @param explicitTreDir  When supplied, use this dir instead of computing from installPath +
 *                        treSubdir. Required for decoupled installs (treDirFromCfg layouts)
 *                        where the TRE data lives in an external dir, not under installPath.
 *
 * Source: 04-RESEARCH.md §Pitfall 1 (v5000 magic bytes; hexdump verified).
 *         CLIENT-02 extension: explicit treDir for swg-client-v2 decoupled layout.
 */
function _detectTreVersion(installPath: string, explicitTreDir?: string): string {
  try {
    let treDir: string;
    if (explicitTreDir !== undefined) {
      // Caller supplied the TRE dir directly (addManualClient with opts.treDir).
      // Bypasses resolveLayout — used for decoupled installs with external data.
      treDir = explicitTreDir;
    } else {
      // D-13: resolveLayout() replaces the hardcoded 'Live/' subdir assumption.
      // SWGEmu stores TREs at the install root; Infinity in Live/. Both are resolved
      // correctly by the release-pattern table.
      const layout = resolveLayout(installPath);
      if (!layout) return 'unknown';
      treDir = layout.treSubdir
        ? path.join(installPath, layout.treSubdir)
        : installPath;
    }

    if (!fs.existsSync(treDir)) return 'unknown';
    const treFiles = fs.readdirSync(treDir).filter(f => f.endsWith('.tre'));
    if (treFiles.length === 0) return 'unknown';

    const fd = fs.openSync(path.join(treDir, treFiles[0]), 'r');
    try {
      const header = Buffer.alloc(8);
      fs.readSync(fd, header, 0, 8, 0);
      // Bytes 0-3: magic 'EERT'; bytes 4-7: version string (ASCII)
      const version = header.slice(4, 8).toString('ascii');
      return version;
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return 'unknown';
  }
}
