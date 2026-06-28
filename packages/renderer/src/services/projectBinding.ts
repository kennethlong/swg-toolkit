/**
 * packages/renderer/src/services/projectBinding.ts
 * First end-to-end vertical slice of PROJ-01: detect → persist → auto-mount.
 *
 * Exports:
 *   detectFolderKind(folderPath)      — classify a folder as 'client'|'tre-set'|'mod-project'
 *   readWorkspaceJson(studioDir)      — read WorkspaceBindingMeta from .studio/workspace.json
 *   writeWorkspaceJson(studioDir, m)  — write WorkspaceBindingMeta atomically (tmp+rename)
 *   initProject(folder)               — detect → persist → open workspace → auto-mount TREs
 *
 * Trust boundaries (T-04.1-02/03/04):
 *   - workspace.json written only under the resolved studioDir (never into the client)
 *   - TRE enumeration is restricted to files under treDir only; no symlink traversal
 *   - Detection errors are caught+propagated; the store's openError() is called on failure
 *
 * Source: 04.1-02-PLAN.md Task 3; 04.1-PATTERNS.md §projectBinding.ts.
 */

import * as fs from 'fs';
import * as path from 'path';

import type { WorkspaceBindingMeta } from '@swg/contracts';
import { getStudioDir, openWorkspace } from './workspaceService';
import { mountTrePaths } from './treMount';
import { resolveLayout, type ClientLayout } from './clientLayout';

// ─── Constants ────────────────────────────────────────────────────────────────

/** cfg filenames that signal a client install. Checked in order; first match wins. */
const CFG_NAMES = ['swgemu.cfg', 'client.cfg'] as const;

// ─── detectFolderKind ────────────────────────────────────────────────────────

/**
 * Classify a folder as a SWG client install, a bare TRE set, or a generic mod project.
 *
 * Detection logic (probe order matches clientLocator.ts):
 *   1. 'client'      — folder has a cfg file (swgemu.cfg or client.cfg) AND at least one .tre
 *                      file (in a Live/ subdir if present, else in the folder root)
 *   2. 'tre-set'     — folder has .tre files in its root but no cfg file
 *   3. 'mod-project' — neither cfg nor .tre files found
 *
 * Never throws — unreadable directories fall through to 'mod-project'.
 */
export function detectFolderKind(folderPath: string): 'client' | 'tre-set' | 'mod-project' {
  // 1. Check for client: known cfg file + .tre files in Live/ or root
  for (const cfgName of CFG_NAMES) {
    if (fs.existsSync(path.join(folderPath, cfgName))) {
      try {
        const liveDir  = path.join(folderPath, 'Live');
        const checkDir = fs.existsSync(liveDir) ? liveDir : folderPath;
        const hasTre   = fs.readdirSync(checkDir).some((f) => f.endsWith('.tre'));
        if (hasTre) return 'client';
      } catch {
        // Directory unreadable (permissions / broken symlink) — fall through
      }
    }
  }

  // 2. Check for bare TRE set: .tre files in root but no cfg
  try {
    const hasTreRoot = fs.readdirSync(folderPath).some((f) => f.endsWith('.tre'));
    if (hasTreRoot) return 'tre-set';
  } catch {
    // Fall through to mod-project
  }

  return 'mod-project';
}

// ─── Workspace JSON helpers ───────────────────────────────────────────────────

/**
 * Read WorkspaceBindingMeta from .studio/workspace.json.
 * Returns a safe default { kind:'mod-project', clientPath:null } when the file is absent
 * or malformed (T-04.1-04: detection never throws unguarded).
 */
export function readWorkspaceJson(studioDir: string): WorkspaceBindingMeta {
  const filePath = path.join(studioDir, 'workspace.json');
  if (!fs.existsSync(filePath)) {
    return { kind: 'mod-project', clientPath: null };
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as WorkspaceBindingMeta;
  } catch {
    return { kind: 'mod-project', clientPath: null };
  }
}

/**
 * Persist WorkspaceBindingMeta to .studio/workspace.json using atomic tmp+rename.
 * T-04.1-02: writes only under studioDir (never into the client install dir).
 * BOM-free utf8 per the Shared "Atomic file write pattern".
 */
export function writeWorkspaceJson(studioDir: string, meta: WorkspaceBindingMeta): void {
  // Ensure studioDir exists before writing (initProject always calls this)
  fs.mkdirSync(studioDir, { recursive: true });
  const filePath = path.join(studioDir, 'workspace.json');
  const tmp      = filePath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(meta, null, 2), 'utf8');
  fs.renameSync(tmp, filePath);  // atomic on same-volume rename
}

// ─── initProject ─────────────────────────────────────────────────────────────

// ─── InitProjectOptions ───────────────────────────────────────────────────────

/**
 * Optional overrides for initProject — used by the NewProjectWizard (04.1-04).
 *
 * overrideKind: M6 — "Yes, treat as client" in the wizard's unconfirmed-directory branch
 *   forces kind:'client', overriding detectFolderKind which would otherwise classify the
 *   folder as mod-project. The user-confirmed choice persists via writeWorkspaceJson.
 *
 * serverConfig: D-01 — capture-only local-server association from wizard step 3;
 *   stored into workspace.json; never executed or pushed in Phase 4.1.
 */
export interface InitProjectOptions {
  /**
   * Project display name (umbrella). Defaults to basename(projectFolder).
   */
  projectName?: string;
  /**
   * The TRE set this project targets — a client install root or a standalone TRE folder.
   * DECOUPLE: the project folder (the first arg) is the umbrella identity; the target is a
   * separate path referenced by the project. When omitted, the project folder itself is
   * treated as the target (legacy behavior — kept so existing call sites still work).
   */
  targetPath?: string;
  /**
   * Target kind hint: 'client' (full install) or 'standalone' (loose .tre folder).
   * When omitted, the target is auto-detected (or uses overrideKind).
   */
  targetKind?: 'client' | 'standalone';
  /**
   * Override the auto-detected folder kind (M6 user-confirmed client override).
   * When provided, detection is skipped and this value persists to workspace.json.
   */
  overrideKind?: 'client' | 'tre-set' | 'mod-project';
  /**
   * Capture-only server association from wizard step 3 (D-01).
   * Persisted to workspace.json; no push UI in Phase 4.1.
   */
  serverConfig?: {
    type: 'core3-wsl2' | 'swgsource-docker';
    path: string;
    hostPort: string;
  };
  /**
   * D-13 manual override: user-entered cfgFile + treSubdir from the wizard when
   * resolveLayout() returns null for an unclassified client folder.
   * When provided, this layout is used instead of resolveLayout auto-detection.
   * Persists into workspace.json as cfgPath / treDir / pattern = manualLayout.release.
   */
  manualLayout?: ClientLayout;
}

/**
 * Detect → persist → open → auto-mount.
 *
 * Steps:
 *   1. detectFolderKind(folder) — or use options.overrideKind (M6)
 *   2. Resolve cfgPath + treDir (client only)
 *   3. Write .studio/workspace.json atomically (T-04.1-02)
 *   4. Call openWorkspace(folder) to populate workspaceStore with real kind + clientPath
 *   5. If client: enumerate .tre files from treDir, call mountTrePaths with ascending
 *      priorities (M5 — mounting is UNCONDITIONAL for client-kind; no wizard gate)
 *
 * Auto-mount failure is non-fatal (logged, not re-thrown) — the workspace is still usable
 * even if the TRE mount fails. openWorkspace failure IS re-thrown.
 *
 * T-04.1-03: .tre enumeration is restricted to files in treDir only (no sub-directories,
 * no symlink traversal outside treDir).
 */
export async function initProject(folder: string, options?: InitProjectOptions): Promise<void> {
  // DECOUPLE: `folder` is the PROJECT (umbrella) folder = identity; the TARGET TRE set
  // (a client install or standalone .tre folder) is a separate path. Legacy callers that
  // pass only a client path get target = projectFolder (old behavior).
  const projectFolder = path.resolve(folder);
  const target        = options?.targetPath ? path.resolve(options.targetPath) : projectFolder;
  const studioDir     = getStudioDir(projectFolder);  // keyed by project, NOT target
  const projectName   = options?.projectName ?? path.basename(projectFolder);

  // Ensure the project umbrella folder exists (a new project under the app store won't
  // exist yet; openWorkspace requires the folder to be present). Existing dirs untouched.
  fs.mkdirSync(projectFolder, { recursive: true });

  // ── 1. Resolve target kind ────────────────────────────────────────────────
  // 'standalone' target → persisted as kind 'tre-set'. Otherwise detect on the TARGET
  // (not the project folder) or honor the M6 override.
  const kind: 'client' | 'tre-set' | 'mod-project' =
    options?.targetKind === 'standalone' ? 'tre-set'
    : (options?.overrideKind ?? detectFolderKind(target));

  // ── 2. Resolve cfg/tre paths from the TARGET ──────────────────────────────
  let cfgPath: string | undefined;
  let treDir:  string | undefined;
  let pattern: string | undefined;

  if (kind === 'client') {
    if (options?.manualLayout) {
      // D-13: user-entered manual override (wizard → "Yes, treat as client" path +
      // manual cfgFile + treSubdir). Honored over auto-detect (T-04.1-22: paths are
      // existence-checked by cfgActivator / treMount at use time; not validated here
      // to allow entries for installs not yet downloaded).
      const ml = options.manualLayout;
      cfgPath  = path.join(target, ml.cfgFile);
      treDir   = ml.treSubdir ? path.join(target, ml.treSubdir) : target;
      pattern  = ml.release;
    } else {
      // D-13: auto-detect via release-pattern table (replaces hardcoded 'swgemu.cfg'
      // / 'Live/' literals from the original implementation).
      const layout = resolveLayout(target);
      if (layout) {
        cfgPath = path.join(target, layout.cfgFile);
        treDir  = layout.treSubdir ? path.join(target, layout.treSubdir) : target;
        pattern = layout.release;
      } else {
        // Fallback for confirmed-client folders with an unknown layout (e.g. client.cfg
        // or non-standard TRE dir — resolveLayout returned null but the user confirmed
        // via overrideKind:'client'). Probe CFG_NAMES and fall back to install root for
        // treDir; the wizard / ProjectBindingBar should have surfaced a manual-override
        // prompt, but we handle it gracefully here in case it was skipped.
        for (const cfgName of CFG_NAMES) {
          const candidate = path.join(target, cfgName);
          if (fs.existsSync(candidate)) {
            cfgPath = candidate;
            break;
          }
        }
        const liveDir = path.join(target, 'Live');
        treDir        = fs.existsSync(liveDir) ? liveDir : target;
        // pattern stays undefined — no known release name
      }
    }
  } else if (kind === 'tre-set') {
    // Standalone TRE set: the target folder IS the TRE dir (no client cfg).
    treDir = target;
  }

  // ── 3. Persist to .studio/workspace.json ─────────────────────────────────
  const meta: WorkspaceBindingMeta = {
    projectName,
    kind,
    clientPath: kind === 'client' ? target : null,
    cfgPath,
    treDir,
    pattern,
    // D-01: capture-only server association from wizard step 3 (if provided)
    ...(options?.serverConfig ? { serverConfig: options.serverConfig } : {}),
  };
  writeWorkspaceJson(studioDir, meta);

  // ── 4. Open workspace (populates workspaceStore with real kind + clientPath) ──
  // openWorkspace reads workspace.json and passes kind+clientPath to openComplete.
  // Error pattern: workspaceService already calls openError(); re-throw for caller.
  await openWorkspace(projectFolder);

  // ── 5. Auto-mount the target TRE set (M5) — client OR standalone ──────────
  if (treDir !== undefined) {
    try {
      // T-04.1-03: enumerate only .tre files directly in treDir (no sub-dirs, no symlinks
      // outside treDir, no path injection via filename).
      const treFiles = fs.readdirSync(treDir)
        .filter((f) => f.endsWith('.tre') && !f.includes('/') && !f.includes('\\'))
        .sort();  // ascending alphabetical = ascending priority (TRE-dir order)

      if (treFiles.length === 0) return;

      const trePaths   = treFiles.map((f) => path.join(treDir!, f));
      const priorities = treFiles.map((_, i) => i + 1);  // 1-based ascending
      await mountTrePaths(trePaths, priorities);
    } catch (err) {
      // Non-fatal: log but do not re-throw — the workspace is still usable without a mount
      console.error('[projectBinding] auto-mount failed:', err);
    }
  }
}
