/**
 * packages/renderer/src/services/gitLfsService.ts
 * Plain async functions (NOT a React hook) for Git/LFS workspace operations.
 *
 * SECURITY (D-04-16): ALL git shell-outs use execFile with argument arrays.
 * exec(`git commit -m "${msg}"`) is BANNED — command injection via commit message / path.
 *
 * Exports (all named):
 *   checkLfsInstalled(repoPath)   — returns true if 'git lfs version' exits 0
 *   initLfsTracking(repoPath)     — runs 'git lfs install --local' in the repo
 *   gitCommit(repoPath, msg, paths) — stages explicit paths + commits (never git add .)
 *   gitPush(repoPath)             — 'git push' the current branch
 *   refreshLog(repoPath)          — reads git log and updates vcsStore
 *   getGuardStatus(repoPath, paths) — app-side pre-commit guard (D-04-15 defense-in-depth)
 *
 * Path B renderer: nodeIntegration:true, contextIsolation:false — fs/child_process are
 * accessible directly in the renderer process.
 *
 * Source: 04-05-PLAN.md Task 2; 04-CONTEXT.md §D-04-15/16;
 *         04-RESEARCH.md §Pre-commit retail-bytes guard; 04-PATTERNS.md §gitLfsService.ts.
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';

import { useVcsStore } from '../state/vcsStore';
import type { GuardResult, LogEntry } from '../state/vcsStore';

// SECURITY: all git shell-outs use execFile with argument arrays (D-04-16).
// exec() with string interpolation is BANNED — it allows command injection via msg/paths.
const execFileAsync = promisify(execFile);

// ─── Internal helper ──────────────────────────────────────────────────────────

/**
 * Thin wrapper over execFileAsync for git commands.
 * Returns stdout on success; throws on non-zero exit (with stderr in message).
 * All args are passed as discrete array elements — no shell interpolation.
 */
async function git(repoPath: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, {
    cwd: repoPath,
    encoding: 'utf8',
    timeout: 60_000,
  });
  return (stdout as unknown as string).trim();
}

// ─── Message sanitizer (T-04-23 defense-in-depth) ────────────────────────────

/**
 * Strip null bytes and ASCII control characters from a commit message.
 * execFile arg-array isolation means these can't cause injection, but stripping
 * them prevents git from rejecting the message or storing garbage bytes.
 */
function sanitizeMessage(msg: string): string {
  // Remove null bytes and control chars (U+0000–U+001F except tab/newline).
  return msg.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
}

// ─── Path validation (T-04-24) ───────────────────────────────────────────────

/**
 * Validate that every stagePath is a relative path with no leading '..'.
 * Each path is passed as a discrete execFile arg element (never shell-interpolated),
 * but we still enforce that paths stay workspace-relative (T-04-24).
 */
function validateStagePaths(stagePaths: string[]): void {
  for (const p of stagePaths) {
    if (path.isAbsolute(p)) {
      throw new Error(`Stage path must be relative, not absolute: ${p}`);
    }
    const normalized = path.normalize(p);
    if (normalized.startsWith('..')) {
      throw new Error(`Stage path must not escape the workspace root (no '..'): ${p}`);
    }
  }
}

// ─── Exports ──────────────────────────────────────────────────────────────────

/**
 * Probe whether git-lfs is installed and reachable.
 * Uses execFile with argument array (D-04-16). Returns true on success; false on any error.
 */
export async function checkLfsInstalled(repoPath: string): Promise<boolean> {
  try {
    await execFileAsync('git', ['lfs', 'version'], { cwd: repoPath, timeout: 5_000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Install git-lfs filter hooks in the local repo config.
 * Calls 'git lfs install --local' so the .gitattributes filter=lfs directives
 * are activated for 'git add' filter operations.
 *
 * Called once at workspace open when LFS is confirmed present.
 */
export async function initLfsTracking(repoPath: string): Promise<void> {
  await git(repoPath, ['lfs', 'install', '--local']);
}

/**
 * Stage the explicitly-listed paths and commit with the given message.
 *
 * Guards (D-04-15):
 *   - stagePaths.length === 0 → throw (never use git add . as implicit fallback)
 *   - message empty → throw
 *
 * Security (D-04-16, T-04-23, T-04-24):
 *   - message is sanitized (null bytes + control chars stripped)
 *   - message is a DISCRETE execFile argv element, never shell-interpolated
 *   - stagePaths are DISCRETE argv elements with path validation (no absolute, no '..')
 *
 * Returns the short SHA of the new commit (first 7 chars of git rev-parse HEAD).
 * On success: updates vcsStore.commitComplete; calls refreshLog.
 * On error:   updates vcsStore.commitError and rethrows.
 */
export async function gitCommit(
  repoPath: string,
  message: string,
  stagePaths: string[],
): Promise<string> {
  // Guards
  if (stagePaths.length === 0) {
    throw new Error('No paths to stage — never use git add . (D-04-15): explicit path list required');
  }
  if (!message.trim()) {
    throw new Error('Commit message required');
  }

  // T-04-24: Validate paths stay workspace-relative
  validateStagePaths(stagePaths);

  // T-04-23: Sanitize message (defense-in-depth; arg-array isolation is the primary guard)
  const sanitizedMessage = sanitizeMessage(message);

  const store = useVcsStore.getState();
  store.beginCommit();

  try {
    // Stage only the explicitly-listed paths (never 'git add .' — D-04-15)
    await git(repoPath, ['add', '--', ...stagePaths]);

    // Commit — message is a discrete argv element, NOT shell-interpolated (D-04-16)
    await git(repoPath, ['commit', '-m', sanitizedMessage]);

    // Read back the short SHA
    const shortSha = await git(repoPath, ['rev-parse', '--short', 'HEAD']);

    store.commitComplete(shortSha);

    // Refresh the log asynchronously (best-effort — don't fail the commit if this errors)
    refreshLog(repoPath).catch(() => { /* best-effort */ });

    return shortSha;
  } catch (err) {
    const reason = String((err as Error)?.message ?? err);
    store.commitError(reason);
    throw err;
  }
}

/**
 * Push the current branch to origin.
 * Uses execFile arg arrays (D-04-16). Updates commitStatus to error on failure.
 */
export async function gitPush(repoPath: string): Promise<void> {
  const store = useVcsStore.getState();
  try {
    await git(repoPath, ['push']);
  } catch (err) {
    const reason = String((err as Error)?.message ?? err);
    store.commitError(reason);
    throw err;
  }
}

/**
 * Read recent commits from git log and update vcsStore.log.
 * Format: shortSha TAB subject TAB relativeTime (git format="%h%x09%s%x09%ar")
 * Best-effort — swallows errors (called from UI on mount / after commit).
 */
export async function refreshLog(repoPath: string): Promise<void> {
  try {
    const stdout = await git(repoPath, [
      'log',
      '--format=%h\t%s\t%ar',
      '-20',
    ]);
    if (!stdout.trim()) {
      useVcsStore.getState().setLog([]);
      return;
    }
    const entries: LogEntry[] = stdout
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [shortSha = '', subject = '', relativeTime = ''] = line.split('\t');
        return { shortSha, subject, relativeTime };
      });
    useVcsStore.getState().setLog(entries);
  } catch {
    // Repository may have no commits yet — swallow silently
    useVcsStore.getState().setLog([]);
  }
}

/**
 * App-side pre-commit guard (D-04-15 defense-in-depth).
 * Checks the currently-staged files for:
 *   - Any *.tre file (blocked — gitignored / retail artifact)
 *   - Any file > 50 MB (blocked — should use LFS or be excluded)
 *
 * Returns { passed: true } if clear, { passed: false; file; reason } if blocked.
 * Updates vcsStore.guardResult.
 *
 * This mirrors the .git/hooks/pre-commit check (hook covers CLI; this covers in-app commits).
 */
export async function getGuardStatus(repoPath: string): Promise<GuardResult> {
  try {
    const stagedList = await git(repoPath, ['diff', '--cached', '--name-only']);
    const files = stagedList.split('\n').filter(Boolean);

    for (const f of files) {
      // Block *.tre files (gitignored rebuild artifact — never commit; D-04-14/15)
      if (f.endsWith('.tre')) {
        const result: GuardResult = {
          passed: false,
          file: f,
          reason: 'looks like retail/.tre bytes — never commit a patch or retail archive.',
        };
        useVcsStore.getState().setGuardResult(result);
        return result;
      }

      // Block files > 50 MB (size guard — use LFS or exclude; D-04-15)
      try {
        const sizeStr = await git(repoPath, ['cat-file', '-s', `:${f}`]);
        const size = parseInt(sizeStr, 10);
        if (!isNaN(size) && size > 52_428_800) {
          const result: GuardResult = {
            passed: false,
            file: f,
            reason: `file is ${(size / 1_048_576).toFixed(1)} MB (>50 MB). Use LFS or exclude.`,
          };
          useVcsStore.getState().setGuardResult(result);
          return result;
        }
      } catch {
        // cat-file -s may fail for LFS pointers (which are small) — treat as pass
      }
    }

    const passed: GuardResult = { passed: true };
    useVcsStore.getState().setGuardResult(passed);
    return passed;
  } catch {
    // No staged files or git error — treat as pass (hook is the final gate)
    const passed: GuardResult = { passed: true };
    useVcsStore.getState().setGuardResult(passed);
    return passed;
  }
}

// Default export for `import gitCommit from '...'` compatibility (plan uses default import).
export default gitCommit;
