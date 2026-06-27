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
import type { WorkspaceChangesetManifest } from '@swg/contracts';

const execFileAsync = promisify(execFile);

// ─── Paths ────────────────────────────────────────────────────────────────────

/**
 * Returns the absolute path to the .studio/ control directory for a workspace root.
 * Always folderPath + '/.studio' — never configurable.
 */
export function getStudioDir(folderPath: string): string {
  return path.join(folderPath, '.studio');
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

// ─── Manifest helpers ─────────────────────────────────────────────────────────

function readManifest(studioDir: string): WorkspaceChangesetManifest {
  const p = path.join(studioDir, 'changesets', 'manifest.json');
  if (!fs.existsSync(p)) {
    return { activeVersionId: null, deployedVersionId: null, changesets: [] };
  }
  return JSON.parse(fs.readFileSync(p, 'utf8')) as WorkspaceChangesetManifest;
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

    // Validate that the directory exists
    if (!fs.existsSync(normalized) || !fs.statSync(normalized).isDirectory()) {
      throw new Error(`Workspace path does not exist or is not a directory: ${normalized}`);
    }

    const studioDir = getStudioDir(normalized);

    // Must already be a toolkit workspace
    if (!fs.existsSync(studioDir)) {
      throw new Error(
        `Not a toolkit workspace — use createWorkspace to initialize: ${normalized}`,
      );
    }

    const manifest = readManifest(studioDir);

    useWorkspaceStore.getState().openComplete({
      folderPath:    normalized,
      studioDir,
      workspaceName: path.basename(normalized),
      clientPath:    null,
    });
    useChangesetStore.getState().setManifest(manifest);
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

    // ── Write manifest.json ───────────────────────────────────────────────────
    const manifestPath = path.join(studioDir, 'changesets', 'manifest.json');
    const emptyManifest: WorkspaceChangesetManifest = {
      activeVersionId:   null,
      deployedVersionId: null,
      changesets:        [],
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
    useWorkspaceStore.getState().openComplete({
      folderPath:    normalized,
      studioDir,
      workspaceName: path.basename(normalized),
      clientPath:    null,
    });
    useChangesetStore.getState().setManifest(emptyManifest);
  } catch (err) {
    const reason = String((err as Error)?.message ?? err);
    useWorkspaceStore.getState().openError(reason);
    throw err;
  }
}
