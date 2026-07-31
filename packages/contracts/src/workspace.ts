/**
 * packages/contracts/src/workspace.ts
 * Type definitions for Phase 4 mod project workspace.
 *
 * No runtime code — types and const objects only.
 *
 * Source: D-04-01 (workspace = user-chosen project folder + .studio/ control dir).
 * Extended: Phase 4.1 04.1-01-PLAN.md Task 1 — kind discriminator + binding fields (D-10/D-13/D-01).
 */

// ---------------------------------------------------------------------------
// Workspace
// ---------------------------------------------------------------------------

/**
 * Metadata for an open mod project workspace.
 *
 * Source: D-04-01; Phase 4 04-01-PLAN.md Task 1.
 * Extended: Phase 4.1 D-10 (kind), D-13 (cfgPath/treDir/pattern), D-01 (serverConfig capture-only).
 */
export interface WorkspaceInfo {
  /**
   * Absolute path to the PROJECT (umbrella) folder under the app project store
   * (…/swg-toolkit/projects/<name>). The project is decoupled from its target: a client
   * install is referenced via clientPath/treDir/cfgPath, NOT used as the project folder.
   */
  folderPath: string;
  /** Project display name (umbrella). Defaults to basename(folderPath) when absent. */
  projectName?: string;
  /** Absolute path to the studio control dir (…/swg-toolkit/studios/<name>). */
  studioDir: string;
  /** Human-readable name — path.basename(folderPath). */
  workspaceName: string;
  /**
   * Absolute path to the TARGET client install root (the project's deploy target), or
   * null when the target is a standalone TRE set / not yet bound. This is a PROPERTY of
   * the project — never the project's own identity (see folderPath).
   */
  clientPath: string | null;
  /**
   * Project binding kind — discriminates what the workspace folder IS.
   * D-10: required; set on open/create; plans 02/06 set the real detected value.
   * 'mod-project' is the safe default when no client install is detected.
   */
  kind: 'client' | 'tre-set' | 'mod-project';
  /**
   * Absolute path to the resolved cfg file (e.g. /path/to/swgemu.cfg).
   * D-13: present when kind === 'client' and layout was resolved.
   */
  cfgPath?: string;
  /**
   * Absolute path to the resolved TRE directory (e.g. /path/to/Live/).
   * D-13: present when kind === 'client' and layout was resolved.
   */
  treDir?: string;
  /**
   * Matched release pattern name (e.g. 'SWG Infinity', 'SWGEmu').
   * D-13: present when kind === 'client' and auto-detection succeeded.
   */
  pattern?: string;
  /**
   * Local-server association — CAPTURE ONLY (D-01).
   * Stores type/path/host:port for the optional 007 wizard step 3.
   * No server push in Phase 4.1 — Phase 8 gates on ground-truth verification.
   */
  serverConfig?: {
    /** Server runtime kind. */
    type: 'core3-wsl2' | 'swgsource-docker';
    /** Absolute path to the server root (e.g. WSL mount or Docker volume path). */
    path: string;
    /** host:port the server listens on, e.g. '127.0.0.1:44463'. */
    hostPort: string;
  };
}

// ---------------------------------------------------------------------------
// WorkspaceBindingMeta
// ---------------------------------------------------------------------------

/**
 * The persisted subset of WorkspaceInfo that projectBinding reads/writes to
 * .studio/workspace.json. Plans 02/06 read and write this when detecting the
 * project kind and binding a client path.
 *
 * Source: Phase 4.1 04.1-01-PLAN.md Task 1 — W2 fix; D-10/D-13/D-01.
 */
export interface WorkspaceBindingMeta {
  /** Project display name (umbrella). Persisted so the studio can be relocated/renamed. */
  projectName?: string;
  /** Project binding kind — describes the TARGET (see WorkspaceInfo.kind). */
  kind: 'client' | 'tre-set' | 'mod-project';
  /** Absolute path to the target client install root, or null (standalone / unbound). */
  clientPath: string | null;
  /** Resolved cfg file path — see WorkspaceInfo.cfgPath. */
  cfgPath?: string;
  /** Resolved TRE directory path — see WorkspaceInfo.treDir. */
  treDir?: string;
  /** Matched release pattern name — see WorkspaceInfo.pattern. */
  pattern?: string;
  /** Local-server association — see WorkspaceInfo.serverConfig. */
  serverConfig?: WorkspaceInfo['serverConfig'];
  /** Live Inspector: last client executable launched for THIS project (defaults the
   *  Launch & Inject field when the project opens; more specific than clientPath —
   *  a full exe path, e.g. a decoupled stage build's SwgClient_r.exe). */
  liveClientExe?: string;
}
