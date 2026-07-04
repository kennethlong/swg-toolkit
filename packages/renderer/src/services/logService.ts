/**
 * packages/renderer/src/services/logService.ts — Console mirroring + structured
 * app-event logging (D-12 "dev stream" + "structured app events").
 *
 * `installConsoleCapture()` is the SINGLE call site 04.4-11 extends in-place (see the
 * marked insertion point below) to also forward main-process log lines over IPC. It:
 *   - wraps console.log/warn/error so every call also appends a `channel:'console'`
 *     entry to logStore, WITHOUT silencing the original console output;
 *   - installs `window` 'error' and 'unhandledrejection' listeners that likewise
 *     append `channel:'console', level:'error'` entries;
 *   - is idempotent (`installed` guard) so calling it more than once in production
 *     code is always safe.
 *
 * `resetConsoleCaptureForTests()` (round-2 fix) is a TEST-ONLY escape hatch: it
 * restores the pre-wrap console.* methods, removes the window listeners, and clears
 * the `installed` guard so a LATER installConsoleCapture() call (in a different test
 * file, with its own Vitest module registry) re-wraps cleanly instead of no-op'ing.
 *
 * `log(level, channel, message)` is the direct structured-event API used by
 * instrumentation call sites (plan 11 app events, plan 10 delete-flow events) —
 * it does not go through the console.* wrap at all.
 *
 * Source: 04.4-02-PLAN.md Task 2 (round 2 revision).
 */

import { useLogStore } from '../state/logStore';
import type { LogEntry } from '../state/logStore';
import type { MainLogEvent } from '@swg/contracts';

type ConsoleMethod = 'log' | 'warn' | 'error';

let installed = false;

let originalLog: typeof console.log;
let originalWarn: typeof console.warn;
let originalError: typeof console.error;

function methodToLevel(method: ConsoleMethod): LogEntry['level'] {
  if (method === 'warn') return 'warn';
  if (method === 'error') return 'error';
  return 'info';
}

function stringifyArgs(args: unknown[]): string {
  return args.map(String).join(' ');
}

function onWindowError(event: ErrorEvent): void {
  const message = event.message || (event.error ? String(event.error) : 'window error');
  useLogStore.getState().append({ level: 'error', channel: 'console', message });
}

function onUnhandledRejection(event: PromiseRejectionEvent): void {
  const message = `Unhandled rejection: ${String(event.reason)}`;
  useLogStore.getState().append({ level: 'error', channel: 'console', message });
}

/**
 * Install console.* mirroring + window error listeners. Idempotent — safe to call
 * from multiple module-scope side-effect sites (only the first call takes effect).
 */
export function installConsoleCapture(): void {
  if (installed) return;
  installed = true;

  originalLog = console.log;
  originalWarn = console.warn;
  originalError = console.error;

  console.log = (...args: unknown[]) => {
    originalLog(...args);
    useLogStore.getState().append({ level: methodToLevel('log'), channel: 'console', message: stringifyArgs(args) });
  };
  console.warn = (...args: unknown[]) => {
    originalWarn(...args);
    useLogStore.getState().append({ level: methodToLevel('warn'), channel: 'console', message: stringifyArgs(args) });
  };
  console.error = (...args: unknown[]) => {
    originalError(...args);
    useLogStore.getState().append({ level: methodToLevel('error'), channel: 'console', message: stringifyArgs(args) });
  };

  window.addEventListener('error', onWindowError);
  window.addEventListener('unhandledrejection', onUnhandledRejection);

  // 04.4-11: main-process log-forward subscription, folded into this SAME function
  // (not a new exported function/call site — see module doc comment). Guarded by
  // process.env['VITEST'] (matches 04.4-02's own idiom exactly, so it protects
  // logService.test.ts's DIRECT call to installConsoleCapture() — that test bypasses
  // ConsolePanel.tsx's module-scope VITEST guard entirely). The try/catch +
  // optional-chaining is defense-in-depth for any OTHER non-Electron caller.
  if (typeof process === 'undefined' || process.env['VITEST'] !== '1') {
    try {
      // Path B (nodeIntegration:true) — never bundled by Vite.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { ipcRenderer } = require('electron') as {
        ipcRenderer: { on(channel: string, listener: (...args: unknown[]) => void): void };
      };
      ipcRenderer?.on?.('main-log', (_event: unknown, entry: unknown) => {
        const e = entry as MainLogEvent;
        log(e.level, 'log', e.message);
      });
    } catch {
      /* not running inside Electron (e.g. a Vitest/Node context) — no-op */
    }
  }
}

/**
 * Append a structured app-event entry directly (not via console.* wrap).
 * Used by instrumentation call sites for mounts/deploys/reconciles/injections/restores.
 */
export function log(level: LogEntry['level'], channel: LogEntry['channel'], message: string): void {
  useLogStore.getState().append({ level, channel, message });
}

/**
 * TEST-ONLY: undo installConsoleCapture() — restores the original console.* methods,
 * removes the window listeners this module added, and clears the `installed` guard so
 * a later installConsoleCapture() call (in a different test file) re-wraps cleanly.
 * Not called from any production code path.
 */
export function resetConsoleCaptureForTests(): void {
  if (!installed) return;

  console.log = originalLog;
  console.warn = originalWarn;
  console.error = originalError;

  window.removeEventListener('error', onWindowError);
  window.removeEventListener('unhandledrejection', onUnhandledRejection);

  installed = false;
}
