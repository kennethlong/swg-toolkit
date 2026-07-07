/**
 * packages/renderer/src/services/core3ServerPush.ts
 * Core3 (WSL2) server-side TRE push — the server-side analog of `cfgActivator` (D-22/D-23).
 *
 * Exports:
 *   pushCore3TreOverride(confDir, studioDir, activeVersionId, manifest, projectSlug) — build +
 *     register a per-version override .tre in the LIVE Core3 tree's conf/config-local.lua,
 *     PLUS persist the returned record to studioDir/serverPush.core3.json (cross-restart).
 *   readCore3PushRecord(studioDir)     — never-throws read of the persisted record.
 *   resetCore3TreOverride(record)      — PURE undo-the-write; does NOT clear the record file.
 *   clearCore3PushRecordFile(studioDir) — standalone; the caller's (04.4-12's) job, in order.
 *   translateLinuxPathToHost(linuxPath, opts?) — pure Linux→host path-translation helper.
 *
 * PATH CONTRACT (locked, identical in 04.4-12): `confDir` is the CALLER-RESOLVED conf/ directory
 * (`path.join(serverConfig.path, 'conf')`, where `serverConfig.path` is the Core3 `MMOCoreORB/bin`
 * directory). This module NEVER re-derives confDir from serverConfig.path.
 *
 * RESET-RECORD-CLEAR CONTRACT (round-2, locked): `resetCore3TreOverride` undoes the Lua/tre WRITE
 * only. Clearing `serverPush.core3.json` is EXCLUSIVELY the caller's job — 04.4-12's Reset handler
 * calls `resetCore3TreOverride(record)` THEN `clearCore3PushRecordFile(studioDir)`, explicitly, in
 * that order.
 *
 * Ground truth (verified this session against the real `../Core3` source tree — see
 * docs/05-server-integration/core3-parity.md "Verified: Product-Thesis Close-Out" section):
 *   - ConfigManager.cpp:23-93 — config.lua runs first, config-local.lua second in the SAME Lua VM
 *     (only if present) — config-local.lua's `Core3.TrePath = ...` OVERRIDES config.lua's value;
 *     `table.insert` into the already-populated `Core3.TreFiles` works without redeclaring it.
 *   - DataArchiveStore.cpp:59-63/56-88 — TreFiles/TrePath consumed EXACTLY ONCE at boot
 *     (loadTres hard-guard); no runtime reload exists — every push needs a server restart.
 *   - TreeFileRecord.h:109-130 — payload bytes are re-read from disk PER REQUEST against the
 *     boot-time index (stored offset/size) — overwriting an already-mounted .tre in place serves
 *     garbage until restart. Hence: TOKENED filename per push, never overwrite in place.
 *   - SortedVector.h NO_DUPLICATE insert plan — FIRST-listed archive wins a virtual-path
 *     collision — `table.insert(Core3.TreFiles, 1, ...)` (prepend) is the correct override point.
 *   - TreeFile.cpp:41-86 — Core3 parses only TRE v0005/v0006; packPatch's `buildTre` v'5000' =
 *     on-disk `EERT5000` = v0005 → compatible.
 *
 * Source: 04.4-07-PLAN.md Task 3; 04.4-RESEARCH.md ADDENDUM (Server-Push Mounts & Reload
 * Semantics); cfgActivator.ts (atomic tmp+rename + line-surgery discipline mirrored here).
 */

import fs from 'fs';
import path from 'path';

import type { WorkspaceChangesetManifest } from '@swg/contracts';

import { flatten } from './changesetService';
import { packPatch } from './packPatch';

// ─── Core3PushRecord ──────────────────────────────────────────────────────────

/**
 * Record of a successful Core3 TRE push. Persisted to `studioDir/serverPush.core3.json`
 * (atomic tmp+rename) so it survives a panel remount or app restart — the record needed by
 * 04.4-12's Reset button is not only in-memory React state.
 */
export interface Core3PushRecord {
  /** Absolute path to the conf/ directory this push targeted (caller-resolved). */
  confDir: string;
  /** Absolute path to config-local.lua (created or pre-existing) that holds our insert line. */
  configLocalPath: string;
  /** Resolved HOST-form TrePath directory the archive was copied into. */
  trePath: string;
  /** Tokened archive filename, e.g. "swgtoolkit_myproject_a1b2c3d4.tre". */
  treFileName: string;
  /** The exact `table.insert(...)` line written into config-local.lua. */
  insertedLine: string;
  /** True when config-local.lua did NOT exist before this push (toolkit-created). */
  wasConfigLocalCreatedByToolkit: boolean;
}

// ─── Sanitization helpers (T-04.4-12 mitigation) ──────────────────────────────

/**
 * Lua-string-safe + filesystem-safe token: strips every character outside
 * [a-zA-Z0-9_-], replacing each with '_'. This ELIMINATES quotes, backslashes,
 * and newlines entirely (rather than escaping them) — the resulting token can
 * never break out of the generated Lua string literal and is always a valid
 * Windows/POSIX filename fragment.
 */
function sanitizeToken(input: string): string {
  const safe = input.replace(/[^a-zA-Z0-9_-]/g, '_');
  return safe || '_';
}

/** Short, filesystem+Lua-safe token derived from a changeset version id. */
function deriveVersionToken(activeVersionId: string): string {
  return sanitizeToken(activeVersionId).slice(0, 12) || '_';
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ─── translateLinuxPathToHost ─────────────────────────────────────────────────

export interface TranslateLinuxPathOpts {
  /** WSL2 distro name (e.g. "Debian"). Required to translate a non-/mnt absolute Linux path. */
  distro?: string;
}

/**
 * Translate a Linux-side TrePath value (as read from Core3's config.lua/config-local.lua) into
 * a host-visible (Windows) path.
 *
 * Rules (RESEARCH.md ADDENDUM "Server-Push Mounts & Reload Semantics"):
 *   - Already a Windows drive path or UNC path -> passthrough unchanged.
 *   - `/mnt/<x>/rest` (WSL2's automount convention for Windows drives) -> `<X>:\rest`.
 *   - Any OTHER absolute Linux path -> `\\wsl.localhost\<distro>\<path>`, where `<distro>` comes
 *     from `opts.distro` (the caller derives it from a `\\wsl.localhost\<distro>\...`-shaped
 *     confDir when available). Throws a clearly-named error if no distro can be determined —
 *     never silently guesses a wrong path.
 */
export function translateLinuxPathToHost(linuxPath: string, opts?: TranslateLinuxPathOpts): string {
  // Already a Windows drive path (either slash style) or a UNC path -- passthrough unchanged.
  if (/^[A-Za-z]:[\\/]/.test(linuxPath) || linuxPath.startsWith('\\\\')) {
    return linuxPath;
  }

  // /mnt/<x>/rest -> <X>:\rest
  const mntMatch = /^\/mnt\/([a-zA-Z])(\/(.*))?$/.exec(linuxPath);
  if (mntMatch) {
    const drive = mntMatch[1].toUpperCase();
    const rest = (mntMatch[3] ?? '').replace(/\//g, '\\');
    return rest ? `${drive}:\\${rest}` : `${drive}:\\`;
  }

  // Any other absolute Linux path -> \\wsl.localhost\<distro>\<path>
  if (linuxPath.startsWith('/')) {
    const distro = opts?.distro;
    if (!distro) {
      throw new Error(
        `translateLinuxPathToHost: cannot translate "${linuxPath}" — no WSL2 distro could be ` +
          'determined (pass opts.distro, or resolve confDir from a \\\\wsl.localhost\\<distro>\\... UNC root)',
      );
    }
    const rest = linuxPath.replace(/^\//, '').replace(/\//g, '\\');
    return `\\\\wsl.localhost\\${distro}\\${rest}`;
  }

  throw new Error(`translateLinuxPathToHost: unrecognized path shape — not absolute: "${linuxPath}"`);
}

// ─── WSL UNC distro derivation ─────────────────────────────────────────────────

const WSL_UNC_RE = /^\\\\wsl\.localhost\\([^\\]+)\\/i;

/** Derive the WSL2 distro name from a `\\wsl.localhost\<distro>\...`-shaped confDir, if any. */
function deriveDistroFromConfDir(confDir: string): string | undefined {
  const m = WSL_UNC_RE.exec(confDir);
  return m ? m[1] : undefined;
}

// ─── TrePath extraction (config-local-first resolution order) ────────────────

/** Extract `Core3.TrePath = "..."` (dotted assignment style, used by config-local.lua). */
function extractDottedTrePath(luaContent: string): string | null {
  const m = /Core3\s*\.\s*TrePath\s*=\s*"([^"]*)"/.exec(luaContent);
  return m ? m[1] : null;
}

/** Extract `TrePath = "..."` (bare field inside the `Core3 = { ... }` table literal). */
function extractBareTrePath(luaContent: string): string | null {
  const m = /\bTrePath\s*=\s*"([^"]*)"/.exec(luaContent);
  return m ? m[1] : null;
}

/**
 * Resolve the Linux-side TrePath value with config-local-first precedence (ConfigManager runs
 * config-local.lua SECOND in the same Lua VM, so its assignment wins).
 *
 * config-local.lua accepts BOTH assignment shapes (D-22 real-server finding, 2026-07-06):
 *   - dotted `Core3.TrePath = "..."` — mutates the Core3 table, read by parse pass 1.
 *   - bare-global `TrePath = "..."` — the LEGACY style. ConfigManager.cpp:57-75 runs a second
 *     parse pass over the Lua GLOBAL table with prefix "Core3" AFTER the Core3-table pass, so a
 *     bare global becomes Core3.TrePath and OVERRIDES the table value. The maintainer's real
 *     live config-local.lua uses exactly this shape; resolving only the dotted form fell back
 *     to config.lua's stock /home/swgemu default and EPERM'd on a nonexistent WSL home dir.
 */
function resolveLinuxTrePath(confDir: string, configLocalPath: string, configLuaPath: string): string {
  if (fs.existsSync(configLocalPath)) {
    const localContent = fs.readFileSync(configLocalPath, 'utf8');
    const dotted = extractDottedTrePath(localContent);
    if (dotted !== null) return dotted;
    const bareLocal = extractBareTrePath(localContent);
    if (bareLocal !== null) return bareLocal;
  }

  const configContent = fs.readFileSync(configLuaPath, 'utf8');
  const bare = extractBareTrePath(configContent);
  if (bare === null) {
    throw new Error(`Core3 conf/config.lua does not declare TrePath: ${configLuaPath}`);
  }
  return bare;
}

// ─── serverPush.core3.json persistence ────────────────────────────────────────

function getCore3PushRecordPath(studioDir: string): string {
  return path.join(studioDir, 'serverPush.core3.json');
}

/**
 * Read the persisted Core3 push record, or `null` if absent or malformed.
 * Never throws — mirrors `changesetService.readManifest`'s defensive-parse style.
 */
export function readCore3PushRecord(studioDir: string): Core3PushRecord | null {
  const p = getCore3PushRecordPath(studioDir);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8')) as Core3PushRecord;
  } catch {
    return null;
  }
}

/**
 * Best-effort unlink of `serverPush.core3.json` — never throws.
 *
 * STANDALONE export. `resetCore3TreOverride` NEVER calls this (round-2 locked contract) —
 * 04.4-12's Reset handler is the only caller that invokes both, explicitly, in order:
 * `resetCore3TreOverride(record)` THEN `clearCore3PushRecordFile(studioDir)`.
 */
export function clearCore3PushRecordFile(studioDir: string): void {
  try {
    fs.unlinkSync(getCore3PushRecordPath(studioDir));
  } catch {
    // best-effort — file may already be gone
  }
}

function writeCore3PushRecord(studioDir: string, record: Core3PushRecord): void {
  const p = getCore3PushRecordPath(studioDir);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = p + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(record, null, 2), 'utf8');
  fs.renameSync(tmp, p);
}

// ─── pushCore3TreOverride ──────────────────────────────────────────────────────

/**
 * Build this project's active-version override archive and register it into the LIVE Core3
 * tree's `conf/config-local.lua`, persisting the record for cross-restart Reset.
 *
 * @param confDir          CALLER-RESOLVED conf/ directory (path.join(serverConfig.path, 'conf')).
 * @param studioDir        Absolute path to the toolkit studio dir.
 * @param activeVersionId  The changeset version to build the override archive from.
 * @param manifest         Full workspace changeset manifest (passed to flatten()).
 * @param projectSlug      Human-readable project identifier — sanitized before embedding.
 */
export function pushCore3TreOverride(
  confDir: string,
  studioDir: string,
  activeVersionId: string,
  manifest: WorkspaceChangesetManifest,
  projectSlug: string,
): Core3PushRecord {
  // (1) Liveness pre-check — actionable error, not a raw ENOENT.
  const configLuaPath = path.join(confDir, 'config.lua');
  if (!fs.existsSync(configLuaPath)) {
    throw new Error(
      `Core3 conf/config.lua not found at ${configLuaPath} — confirm serverConfig.path points at the MMOCoreORB/bin directory`,
    );
  }

  // (2) Sanitize the project slug (T-04.4-12 — Lua injection mitigation).
  const safeSlug = sanitizeToken(projectSlug);

  // (3) Derive the tokened archive name and build the override archive from THIS project's
  // active version — independent of whatever deploy model the CLIENT side used.
  const versionToken = deriveVersionToken(activeVersionId);
  const treFileName = `swgtoolkit_${safeSlug}_${versionToken}.tre`;

  const entries = flatten(activeVersionId, manifest, studioDir);
  const builtTrePath = path.join(studioDir, 'build', treFileName);
  packPatch(entries, builtTrePath);

  // (4) Resolve Core3.TrePath (config-local-first) then translate to a host path.
  const configLocalPath = path.join(confDir, 'config-local.lua');
  const wasConfigLocalPreExisting = fs.existsSync(configLocalPath);

  const linuxTrePath = resolveLinuxTrePath(confDir, configLocalPath, configLuaPath);
  const distro = deriveDistroFromConfDir(confDir);
  const hostTrePath = translateLinuxPathToHost(linuxTrePath, { distro });

  // Read the prior record (if any) BEFORE mutating anything, so a differently-named prior
  // archive can be best-effort unlinked AFTER the new copy lands (never before — never leave
  // a window with zero archives present).
  const priorRecord = readCore3PushRecord(studioDir);

  // (5) Copy the built .tre into the resolved host dir under the TOKENED name. NEVER overwrite
  // a differently-named prior archive in place — a running Core3 re-reads payload bytes against
  // a stale boot-time index (TreeFileRecord.h:109-130).
  fs.mkdirSync(hostTrePath, { recursive: true });
  const destTrePath = path.join(hostTrePath, treFileName);
  const tmpDestTrePath = destTrePath + '.tmp';
  fs.copyFileSync(builtTrePath, tmpDestTrePath);
  fs.renameSync(tmpDestTrePath, destTrePath);

  if (priorRecord && priorRecord.treFileName !== treFileName) {
    try {
      fs.unlinkSync(path.join(priorRecord.trePath, priorRecord.treFileName));
    } catch {
      // best-effort — prior archive may already be gone
    }
  }

  // (6) Read (or create) config-local.lua; idempotent replace-or-append of our toolkit line
  // (mirrors cfgActivator.ensureInclude's idempotency discipline).
  //
  // WR-03 fix: the replace target is THIS project's exact prior line from the persisted
  // record — NOT a slug-prefix regex. sanitizeToken keeps '_' in slugs, so a prefix
  // pattern for slug "my" (`swgtoolkit_my_[^"]*`) would ALSO match project "my_proj"'s
  // line and silently clobber ANOTHER project's mount when two projects push to the
  // same Core3 server. Matching priorRecord.insertedLine verbatim scopes the surgery
  // to our own prior push (the same discipline resetCore3TreOverride already uses).
  const insertedLine = `table.insert(Core3.TreFiles, 1, "${treFileName}")`;
  const exactLinePattern = (line: string): RegExp =>
    new RegExp(`^[\\t ]*${escapeRegex(line)}[\\t ]*$`, 'm');
  const newLinePattern = exactLinePattern(insertedLine);
  const priorLinePattern =
    priorRecord && priorRecord.insertedLine !== insertedLine
      ? exactLinePattern(priorRecord.insertedLine)
      : null;

  let newConfigLocalContent: string;
  if (wasConfigLocalPreExisting) {
    const existing = fs.readFileSync(configLocalPath, 'utf8');
    const eol = existing.includes('\r\n') ? '\r\n' : '\n';
    if (newLinePattern.test(existing)) {
      // Idempotent re-push: our exact line is already present — leave the file as-is.
      newConfigLocalContent = existing;
    } else if (priorLinePattern && priorLinePattern.test(existing)) {
      newConfigLocalContent = existing.replace(priorLinePattern, insertedLine);
    } else {
      newConfigLocalContent = existing.trimEnd() + eol + insertedLine + eol;
    }
  } else {
    newConfigLocalContent = insertedLine + '\n';
  }

  const tmpConfigLocalPath = configLocalPath + '.tmp';
  fs.writeFileSync(tmpConfigLocalPath, newConfigLocalContent, { encoding: 'utf8' });
  fs.renameSync(tmpConfigLocalPath, configLocalPath);

  // (7) Persist the record atomically for cross-restart Reset (04.4-12's VcsPanel reads this).
  const record: Core3PushRecord = {
    confDir,
    configLocalPath,
    trePath: hostTrePath,
    treFileName,
    insertedLine,
    wasConfigLocalCreatedByToolkit: !wasConfigLocalPreExisting,
  };
  writeCore3PushRecord(studioDir, record);

  return record;
}

// ─── resetCore3TreOverride ─────────────────────────────────────────────────────

/**
 * Undo a `pushCore3TreOverride` call — PURE "undo the Lua/tre write" function.
 *
 * - If config-local.lua was toolkit-created (did not exist before the first push), it is
 *   DELETED entirely.
 * - Otherwise, targeted LINE SURGERY removes ONLY the `insertedLine` (mirrors
 *   `cfgActivator.deactivatePatch`'s discipline) — a config-local.lua that pre-existed with
 *   OTHER content (including its own TrePath line) is left otherwise intact.
 * - Best-effort unlinks the pushed archive — never throws (the file may already be gone or
 *   briefly locked by a running server).
 *
 * ROUND-2 LOCKED CONTRACT: this function MUST NOT touch `serverPush.core3.json` — clearing that
 * persisted record file is EXCLUSIVELY the caller's (04.4-12's) job via
 * `clearCore3PushRecordFile`, called separately, after this function returns.
 */
export function resetCore3TreOverride(record: Core3PushRecord): void {
  if (record.wasConfigLocalCreatedByToolkit) {
    try {
      fs.unlinkSync(record.configLocalPath);
    } catch {
      // best-effort — file may already be gone
    }
  } else {
    try {
      const content = fs.readFileSync(record.configLocalPath, 'utf8');
      const eol = content.includes('\r\n') ? '\r\n' : '\n';
      const escapedLine = escapeRegex(record.insertedLine);
      const lineWithOptionalIndentPattern = new RegExp('^[\\t ]*' + escapedLine + '[\\t ]*$', 'gm');

      const newContent = content
        .replace(lineWithOptionalIndentPattern, '')
        .replace(/(\r?\n){3,}/g, eol + eol);

      const tmp = record.configLocalPath + '.tmp';
      fs.writeFileSync(tmp, newContent, { encoding: 'utf8' });
      fs.renameSync(tmp, record.configLocalPath);
    } catch {
      // best-effort — config-local.lua may already be gone/unreadable
    }
  }

  // Best-effort unlink of the pushed archive — never throws.
  try {
    fs.unlinkSync(path.join(record.trePath, record.treFileName));
  } catch {
    // best-effort — archive may already be gone or briefly locked by a running server
  }

  // INTENTIONALLY does NOT touch serverPush.core3.json (round-2 locked contract).
}
