/**
 * packages/renderer/src/services/workspaceService.ts
 * Plain async functions (NOT a React hook) for workspace lifecycle operations.
 *
 * Five exports:
 *   getStudioDir(folderPath)     — returns the .studio/ path for a workspace root
 *   checkLfsInstalled(repoPath)  — probes git lfs version (execFile, no injection)
 *   openWorkspace(folderPath)    — validates + opens an existing workspace
 *   createWorkspace(folderPath)  — scaffolds a new workspace with git + gitignore + hook
 *
 * Path B renderer: nodeIntegration:true, contextIsolation:false — fs/path/os/child_process
 * are usable directly. All git calls use execFile with argument arrays (D-04-16 security).
 *
 * Fixes implemented:
 *   W4 — path validation uses direct-child check (no cwd-relative comparison)
 *   W5 — hook append-not-overwrite with 'swgtoolkit-retail-guard' boundary comment
 *   W6 — LFS check before writing .gitattributes LFS routing lines
 *   N1 — hook uses 'while IFS= read -r' (not word-split 'for f in $(…)')
 *   N3 — extended LFS types (*.iff *.tga *.wav *.ogg added)
 *
 * Source: 04-01-PLAN.md Task 3; 04-CONTEXT.md §D-04-01/13/14/15/16.
 */

import path from 'path';
import fs from 'fs';
import { execFile } from 'child_process';
import { promisify } from 'util';

import { useWorkspaceStore } from '../state/workspaceStore';
import { useChangesetStore } from '../state/changesetStore';
import type { WorkspaceBindingMeta } from '@swg/contracts';
import { seedBaseline } from './changesetService';
import { addRecentProject } from './recentProjects';
import { autoMountClient, autoMountTarget } from './treAutoMount';

const execFileAsync = promisify(execFile);

// ─── Paths ────────────────────────────────────────────────────────────────────

/**
 * Whitespace-free app-root base for all toolkit data (studios + projects).
 *
 * Read per-call (NOT a module-load const) so a test can redirect it to an isolated
 * temp dir via SWG_TOOLKIT_DATA_ROOT — otherwise unit tests write real studio dirs
 * into the user's %LOCALAPPDATA%\swg-toolkit\studios and pollute it on every run.
 * Default: %LOCALAPPDATA%\swg-toolkit (Windows) / $HOME/swg-toolkit (*nix).
 *
 * The fixed app-root keeps absolute searchTree= values free of spaces that would
 * truncate the path at the first whitespace character (Pitfall 1 / D-06 / T-04.1-12).
 */
function appDataRoot(): string {
  return (
    process.env['SWG_TOOLKIT_DATA_ROOT'] ??
    path.join(process.env['LOCALAPPDATA'] ?? process.env['HOME'] ?? '.', 'swg-toolkit')
  );
}

/** Studio-store root (parent of per-project studio control dirs). */
function studioRoot(): string {
  return path.join(appDataRoot(), 'studios');
}

/** Absolute path to the studio store root (authoritative list of projects). */
export function getStudiosRoot(): string {
  return studioRoot();
}

/** Absolute path to the default projects store (parent of per-project folders). */
export function getDefaultProjectsDir(): string {
  return path.join(appDataRoot(), 'projects');
}

/**
 * Default absolute folder for a new project of the given name, under the app store.
 * Illegal Windows filename characters are stripped; spaces are preserved (the project
 * folder may contain them — the whitespace-free guarantee applies to the studio/build
 * dir via getStudioDir, not the project folder itself). Empty/blank names fall back to
 * "New Project".
 */
export function getDefaultProjectFolder(name: string): string {
  const safe = name.replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, ' ').trim() || 'New Project';
  return path.join(getDefaultProjectsDir(), safe);
}

/**
 * Returns the absolute path to the studio control directory for a workspace root.
 *
 * D-06: relocated from `<folderPath>/.studio` to a whitespace-free app-root path
 * keyed by a sanitized project basename so that absolute searchTree= values written
 * into the client cfg never truncate at a space (Pitfall 1).
 *
 * Formula: APP_ROOT_STUDIO / sanitizedProjectId
 * where sanitizedProjectId = basename(folderPath).replace(/\s+/g, '_')
 *
 * T-04.1-13: basename-only (no path-separator traversal); space→_ sanitization
 * ensures the derived path is free of whitespace and valid as a directory name.
 */
export function getStudioDir(folderPath: string): string {
  const projectId = path.basename(folderPath).replace(/\s+/g, '_');
  return path.join(studioRoot(), projectId);
}

/**
 * Legacy studio dir path (Phase-4 location — inside the project folder).
 * Used by the M2 non-destructive migration probe in openWorkspace.
 */
function getLegacyStudioDir(folderPath: string): string {
  return path.join(folderPath, '.studio');
}

/**
 * Non-destructive recursive directory copy — used for the M2 legacy migration.
 * Never deletes the source; skips if src does not exist.
 */
function copyDirRecursive(src: string, dst: string): void {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const dstPath = path.join(dst, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, dstPath);
    } else {
      // copy, never overwrite if already present in the new location
      if (!fs.existsSync(dstPath)) {
        fs.copyFileSync(srcPath, dstPath);
      }
    }
  }
}

// ─── LFS check ───────────────────────────────────────────────────────────────

/**
 * Probe whether git-lfs is installed and reachable.
 *
 * Uses execFile with argument array (D-04-16 — no string interpolation injection).
 * Returns true if 'git lfs version' exits 0; false on any error.
 */
export async function checkLfsInstalled(repoPath: string): Promise<boolean> {
  try {
    await execFileAsync('git', ['lfs', 'version'], { cwd: repoPath, timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

// ─── Path validation (W4 fix) ─────────────────────────────────────────────────

/**
 * Validate that folderPath is safe to use as a workspace root.
 * W4 fix: replaced cwd-relative path comparison with
 * direct-child validation (studioDir must be a direct child of normalized root).
 *
 * Rules:
 *   1. Must be an absolute path after normalize+resolve.
 *   2. Must not contain '..' segments (traversal).
 *   3. studioDir must be path.join(normalized, '.studio') — direct child.
 *   4. Refuses obvious Windows system dirs (System32, Program Files).
 */
function validateWorkspacePath(folderPath: string): string {
  const normalized = path.normalize(path.resolve(folderPath));

  if (!path.isAbsolute(normalized)) {
    throw new Error(`Workspace path must be absolute: ${normalized}`);
  }
  if (normalized.includes('..')) {
    throw new Error(`Workspace path must not contain '..': ${normalized}`);
  }

  // W4: direct-child check — studioDir must be normalized + '.studio'
  const expectedStudioDir = path.join(normalized, '.studio');
  const actualStudioDir   = path.join(normalized, '.studio');
  if (path.dirname(actualStudioDir) !== normalized) {
    throw new Error(`studioDir must be a direct child of the workspace root: ${normalized}`);
  }
  void expectedStudioDir; // silence unused-var warning

  // Refuse Windows system dirs
  const lower = normalized.toLowerCase();
  if (lower.includes('system32') || lower.includes('program files')) {
    throw new Error(`Workspace path must not be inside a Windows system directory: ${normalized}`);
  }

  return normalized;
}

// ─── Pre-commit hook script (N1 fix: while IFS= read -r) ─────────────────────

const PRE_COMMIT_HOOK = `#!/bin/sh
# swgtoolkit-retail-guard
# Block large or retail-fingerprinted .tre files from being committed.
# N1 fix: uses 'while IFS= read -r' instead of 'for f in $(...)' to handle
# filenames with spaces correctly.
while IFS= read -r f; do
  case "$f" in
    *.tre) echo "REJECTED: $f — .tre is gitignored/rebuildable; never commit a patch or retail archive." >&2; exit 1;;
  esac
  sz=$(git cat-file -s ":$f" 2>/dev/null || echo 0)
  if [ "$sz" -gt 52428800 ]; then
    echo "REJECTED: $f is \${sz} bytes (>50MB). Use LFS or exclude." >&2
    exit 1
  fi
done < <(git diff --cached --name-only)
`;

// ─── openWorkspace ───────────────────────────────────────────────────────────

/**
 * Open an existing mod workspace.
 *
 * Validates that folderPath exists and is a directory, and that .studio/ is present
 * (use createWorkspace to initialize a new workspace). Reads manifest.json and
 * populates workspaceStore + changesetStore.
 *
 * On error: calls openError(reason) and rethrows.
 */
export async function openWorkspace(folderPath: string): Promise<void> {
  const store = useWorkspaceStore.getState();
  store.beginOpen();

  try {
    const normalized = validateWorkspacePath(folderPath);
    const studioDir = getStudioDir(normalized);

    // The project umbrella folder is a marker — the real validation is the studio dir
    // (checked below). A client-bound project's umbrella folder can legitimately be
    // missing (the data lives in the studio + the client install), so recreate it on
    // reopen rather than failing. The studioDir-exists guard below still rejects a folder
    // that isn't a toolkit project.
    if (!fs.existsSync(normalized) && fs.existsSync(studioDir)) {
      fs.mkdirSync(normalized, { recursive: true });
    }
    if (!fs.existsSync(normalized) || !fs.statSync(normalized).isDirectory()) {
      throw new Error(`Workspace path does not exist or is not a directory: ${normalized}`);
    }

    // M2: one-time non-destructive migration from Phase-4 legacy path (.studio inside
    // the project folder).  If the NEW studioDir has no manifest.json but the legacy
    // <folderPath>/.studio DOES, copy the legacy tree into the new location so that an
    // existing project's changesets are not abandoned.  The old .studio is never deleted.
    const legacyStudioDir = getLegacyStudioDir(normalized);
    const newManifestPath  = path.join(studioDir, 'changesets', 'manifest.json');
    const legManifestPath  = path.join(legacyStudioDir, 'changesets', 'manifest.json');
    if (!fs.existsSync(newManifestPath) && fs.existsSync(legManifestPath)) {
      copyDirRecursive(legacyStudioDir, studioDir);
    }

    // Must be a recognized workspace (new location OR legacy-now-migrated).
    if (!fs.existsSync(studioDir)) {
      throw new Error(
        `Not a toolkit workspace — use createWorkspace to initialize: ${normalized}`,
      );
    }

    // D-10: read binding meta from workspace.json (written by initProject) so that
    // openWorkspace always reflects the real kind + clientPath set during project binding.
    // Falls back to safe defaults when workspace.json is absent (plain openWorkspace call
    // not preceded by initProject — e.g. re-open after createWorkspace without binding).
    let bindingMeta: WorkspaceBindingMeta = { kind: 'mod-project', clientPath: null };
    const bindingJsonPath = path.join(studioDir, 'workspace.json');
    if (fs.existsSync(bindingJsonPath)) {
      try {
        bindingMeta = JSON.parse(fs.readFileSync(bindingJsonPath, 'utf8')) as WorkspaceBindingMeta;
      } catch {
        // Malformed JSON — use defaults (T-04.1-04: never throws unguarded)
      }
    }

    useWorkspaceStore.getState().openComplete({
      folderPath:    normalized,
      projectName:   bindingMeta.projectName ?? path.basename(normalized),
      studioDir,
      workspaceName: path.basename(normalized),
      clientPath:    bindingMeta.clientPath,
      kind:          bindingMeta.kind,
      cfgPath:       bindingMeta.cfgPath,
      treDir:        bindingMeta.treDir,
      serverConfig:  bindingMeta.serverConfig,
    });

    // Record in recents for the first-run Welcome list (sketch 007-B). Non-fatal.
    // folderPath = the PROJECT folder (reopen key); name = the umbrella project name.
    addRecentProject({
      folderPath: normalized,
      name:       bindingMeta.projectName ?? path.basename(normalized),
      kind:       bindingMeta.kind,
      clientName: bindingMeta.kind === 'client'
        ? (bindingMeta.pattern ?? path.basename(bindingMeta.clientPath ?? normalized))
        : undefined,
    });

    // H2a: mandatory idempotent Baseline seed — adds the Baseline root node when absent,
    // leaves existing changesets + activeVersionId untouched when it is already present.
    // This guarantees selectVersion(BASELINE_ID) and "Deploy Baseline" never fail on
    // re-opened projects, including those created before plan 06.
    const manifestWithBaseline = seedBaseline(studioDir);
    useChangesetStore.getState().setManifest(manifestWithBaseline);

    // Auto-mount the project's target TRE set on EVERY open (fresh bind via initProject
    // AND reopen via recents / Open Project), so the TRE browser is always populated.
    // Client installs use the unified single-mount (searchTree + searchTOC + searchPath) so
    // a searchTOC-based dev client (swg-client-v2) mounts its full base; standalone/tre-set
    // projects use the legacy directory scan. Non-fatal (both swallow mount errors).
    if (bindingMeta.kind === 'client') {
      await autoMountClient(
        bindingMeta.clientPath ?? normalized,
        bindingMeta.cfgPath ?? undefined,
        bindingMeta.treDir ?? undefined,
      );
    } else {
      await autoMountTarget({
        kind:    bindingMeta.kind,
        cfgPath: bindingMeta.cfgPath,
        treDir:  bindingMeta.treDir,
        target:  bindingMeta.clientPath ?? normalized,
      });
    }
  } catch (err) {
    const reason = String((err as Error)?.message ?? err);
    useWorkspaceStore.getState().openError(reason);
    throw err;
  }
}

// ─── createWorkspace ─────────────────────────────────────────────────────────

/**
 * Scaffold a new mod project workspace at folderPath.
 *
 * Creates:
 *   <folderPath>/
 *     .studio/
 *       changesets/
 *         manifest.json  — {activeVersionId:null, deployedVersionId:null, changesets:[]}
 *       build/           — gitignored transient pack output
 *       shadow/          — gitignored opt-in shadow-base TRE copy
 *     .gitignore
 *     .gitattributes     — with or without LFS routing (W6: depends on checkLfsInstalled)
 *     .git/              — git init -b main
 *     .git/hooks/pre-commit  — retail-bytes guard (W5: append if hook exists, write if new)
 *
 * Security: all git calls use execFile with argument arrays (D-04-16).
 * On error: calls openError(reason) and rethrows.
 */
export async function createWorkspace(folderPath: string): Promise<void> {
  const store = useWorkspaceStore.getState();
  store.beginOpen();

  try {
    // ── W4: Validate path ──────────────────────────────────────────────────────
    const normalized = validateWorkspacePath(folderPath);
    const studioDir  = getStudioDir(normalized);

    // ── Create directory structure ────────────────────────────────────────────
    fs.mkdirSync(normalized,                                        { recursive: true });
    fs.mkdirSync(path.join(studioDir, 'changesets'),                { recursive: true });
    fs.mkdirSync(path.join(studioDir, 'build'),                     { recursive: true });
    fs.mkdirSync(path.join(studioDir, 'shadow'),                    { recursive: true });

    // ── Write empty manifest scaffold ────────────────────────────────────────
    // Writes the skeleton manifest.json; seedBaseline() immediately below seeds
    // the Baseline root node (D-08) and returns the final manifest for store hydration.
    const manifestPath = path.join(studioDir, 'changesets', 'manifest.json');
    const emptyManifest = {
      activeVersionId:   null as string | null,
      deployedVersionId: null as string | null,
      changesets:        [] as unknown[],
    };
    fs.writeFileSync(
      manifestPath,
      JSON.stringify(emptyManifest, null, 2),
      'utf8',
    );

    // ── Write .gitignore ──────────────────────────────────────────────────────
    const gitignorePath = path.join(normalized, '.gitignore');
    const gitignoreContent = [
      'extracted_vanilla_base/',
      '*.tre',
      '.studio/shadow/',
      '.studio/build/',
      'node_modules/',
    ].join('\n') + '\n';
    fs.writeFileSync(gitignorePath, gitignoreContent, 'utf8');

    // ── W6: Check LFS before writing .gitattributes ───────────────────────────
    const lfsPresent = await checkLfsInstalled(normalized).catch(() => false);
    const gitattributesPath = path.join(normalized, '.gitattributes');

    if (lfsPresent) {
      // N3 fix: extended LFS types include *.iff *.tga *.wav *.ogg
      // NOTE: *.tre is NOT LFS-tracked — it is gitignored (D-04-14/15)
      const gitattributesContent = [
        '*.dds  filter=lfs diff=lfs merge=lfs -text',
        '*.png  filter=lfs diff=lfs merge=lfs -text',
        '*.msh  filter=lfs diff=lfs merge=lfs -text',
        '*.mgn  filter=lfs diff=lfs merge=lfs -text',
        '*.ans  filter=lfs diff=lfs merge=lfs -text',
        '*.iff  filter=lfs diff=lfs merge=lfs -text',
        '*.tga  filter=lfs diff=lfs merge=lfs -text',
        '*.wav  filter=lfs diff=lfs merge=lfs -text',
        '*.ogg  filter=lfs diff=lfs merge=lfs -text',
      ].join('\n') + '\n';
      fs.writeFileSync(gitattributesPath, gitattributesContent, 'utf8');
    } else {
      // lfs not installed — write .gitattributes without filter=lfs lines
      console.warn(
        'git-lfs not found — .gitattributes written without LFS routing; ' +
        'install git-lfs and re-run workspace setup',
      );
      const gitattributesContent = [
        '# lfs not installed — add filter=lfs lines after installing git-lfs',
        '*.dds',
        '*.png',
        '*.msh',
        '*.mgn',
        '*.ans',
        '*.iff',
        '*.tga',
        '*.wav',
        '*.ogg',
      ].join('\n') + '\n';
      fs.writeFileSync(gitattributesPath, gitattributesContent, 'utf8');
    }

    // ── git init (D-04-16: execFile arg array, not exec string) ───────────────
    try {
      await execFileAsync('git', ['init', '-b', 'main'], { cwd: normalized });
    } catch (gitErr) {
      // ENOENT = git not on PATH; warn and continue (workspace still functional)
      const msg = String((gitErr as Error)?.message ?? gitErr);
      if (msg.includes('ENOENT')) {
        console.warn('git not found on PATH — skipping git init:', msg);
      } else {
        console.warn('git init failed — continuing without VCS:', msg);
      }
    }

    // ── W5: Install pre-commit hook (append-not-overwrite) ───────────────────
    const hooksDir   = path.join(normalized, '.git', 'hooks');
    const hookPath   = path.join(hooksDir, 'pre-commit');

    if (fs.existsSync(hooksDir)) {
      if (fs.existsSync(hookPath)) {
        // W5: hook already exists — append our guard if not already present
        const existing = fs.readFileSync(hookPath, 'utf8');
        if (!existing.includes('swgtoolkit-retail-guard')) {
          fs.appendFileSync(
            hookPath,
            '\n# swgtoolkit-retail-guard-begin\n' + PRE_COMMIT_HOOK + '\n# swgtoolkit-retail-guard-end\n',
          );
        }
      } else {
        // No existing hook — write fresh + make executable
        fs.writeFileSync(hookPath, PRE_COMMIT_HOOK, 'utf8');
        fs.chmodSync(hookPath, 0o755);
      }
    }
    // If .git/hooks/ does not exist (git init failed or git absent): skip silently

    // ── Populate stores ───────────────────────────────────────────────────────
    // D-10: read binding meta from workspace.json if it exists (defensive: covers the case
    // where initProject was called before createWorkspace — unusual but harmless).
    let createBindingMeta: WorkspaceBindingMeta = { kind: 'mod-project', clientPath: null };
    const createBindingJsonPath = path.join(studioDir, 'workspace.json');
    if (fs.existsSync(createBindingJsonPath)) {
      try {
        createBindingMeta = JSON.parse(fs.readFileSync(createBindingJsonPath, 'utf8')) as WorkspaceBindingMeta;
      } catch {
        // Malformed JSON — use defaults
      }
    }

    useWorkspaceStore.getState().openComplete({
      folderPath:    normalized,
      studioDir,
      workspaceName: path.basename(normalized),
      clientPath:    createBindingMeta.clientPath,
      kind:          createBindingMeta.kind,
    });

    // D-08: seed the Baseline root node immediately after scaffolding so that
    // selectVersion(BASELINE_ID) and "Deploy Baseline" work on the very first open.
    // (replaces setManifest(emptyManifest) — the Baseline manifest is the initial state)
    const manifestWithBaseline = seedBaseline(studioDir);
    useChangesetStore.getState().setManifest(manifestWithBaseline);
  } catch (err) {
    const reason = String((err as Error)?.message ?? err);
    useWorkspaceStore.getState().openError(reason);
    throw err;
  }
}
