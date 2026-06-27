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

// ─── detectClients ────────────────────────────────────────────────────────────

/**
 * Auto-detect SWG client installations on this machine.
 *
 * Probes:
 *   1. Windows registry (HKCU\Software\SWG Infinity, HKCU\Software\SWGEmu)
 *   2. Known install paths on common drives
 *
 * Every probe is wrapped in try/catch. Returns [] (not throws) if all probes fail.
 * Never reuses the injection addon (Pitfall 3 — the injection addon has no install discovery).
 *
 * Source: 04-CONTEXT.md §D-04-09; 04-RESEARCH.md §OQ-1.
 */
export function detectClients(): DetectedClient[] {
  if (process.platform !== 'win32') return [];

  const candidates: DetectedClient[] = [];

  // 1. Known install paths (most reliable — registry varies by installer version)
  const knownPaths: Array<{ name: string; installPath: string; cfgFile: string }> = [
    {
      name: 'SWG Infinity',
      installPath: 'D:\\SWG Infinity\\SWG Infinity',
      cfgFile: 'swgemu.cfg',
    },
    {
      name: 'SWGEmu',
      installPath: 'D:\\SWGEmu Client\\SWGEmu',
      cfgFile: 'swgemu.cfg',
    },
    {
      name: 'SWG Infinity (C:)',
      installPath: 'C:\\SWG Infinity\\SWG Infinity',
      cfgFile: 'swgemu.cfg',
    },
    {
      name: 'SWGEmu (C:)',
      installPath: 'C:\\SWGEmu\\SWGEmu',
      cfgFile: 'swgemu.cfg',
    },
  ];

  for (const known of knownPaths) {
    try {
      const cfgRootPath = path.join(known.installPath, known.cfgFile);
      if (fs.existsSync(cfgRootPath)) {
        // Peek at the first .tre to read the version
        const treVersion = _detectTreVersion(known.installPath);
        candidates.push({
          name: known.name,
          installPath: known.installPath,
          cfgRootPath,
          treVersion,
        });
      }
    } catch {
      // Silently skip inaccessible paths (Pitfall 3 + T-04-12)
    }
  }

  // 2. Windows registry probes
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
      });
      const match = stdout.match(/REG_SZ\s+(.+)/);
      if (!match) continue;

      const installPath = match[1].trim();
      const cfgRootPath = path.join(installPath, 'swgemu.cfg');
      if (!fs.existsSync(cfgRootPath)) continue;

      // Avoid duplicates from known-path probes
      const alreadyFound = candidates.some(c => c.installPath === installPath);
      if (alreadyFound) continue;

      const treVersion = _detectTreVersion(installPath);
      const name = key.toLowerCase().includes('infinity') ? 'SWG Infinity (registry)' : 'SWGEmu (registry)';
      candidates.push({ name, installPath, cfgRootPath, treVersion });
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
 * Returns null if the path does not look like a valid SWG install
 * (swgemu.cfg must exist at the given path).
 *
 * D-04-11: workspace is fully usable offline; manual override is the final fallback.
 *
 * @param installPath  Absolute path to the client install root (user-supplied).
 * @returns DetectedClient if valid, null if swgemu.cfg not found.
 */
export function addManualClient(installPath: string): DetectedClient | null {
  try {
    const cfgRootPath = path.join(installPath, 'swgemu.cfg');
    if (!fs.existsSync(cfgRootPath)) return null;

    const treVersion = _detectTreVersion(installPath);
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
 * Read the TRE version string from the first archive found in the client's Live/ dir.
 * Returns '5000' for Infinity (EERT5000), '0005' for older clients, or 'unknown'.
 *
 * Reads just the first 8 bytes (magic + version) of the first .tre file found.
 * Fails silently and returns 'unknown' if no .tre files are present or inaccessible.
 *
 * Source: 04-RESEARCH.md §Pitfall 1 (v5000 magic bytes; hexdump verified).
 */
function _detectTreVersion(installPath: string): string {
  try {
    const liveDir = path.join(installPath, 'Live');
    if (!fs.existsSync(liveDir)) return 'unknown';

    const treFiles = fs.readdirSync(liveDir).filter(f => f.endsWith('.tre'));
    if (treFiles.length === 0) return 'unknown';

    const fd = fs.openSync(path.join(liveDir, treFiles[0]), 'r');
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
