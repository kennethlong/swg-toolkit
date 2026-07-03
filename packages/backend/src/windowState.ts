/**
 * packages/backend/src/windowState.ts
 * Persist + restore the main window's size, position, monitor, and maximized state
 * across restarts (userData/window-state.json).
 *
 * Monitor safety: the saved position implicitly encodes which monitor the window was on
 * (Electron places a window on whichever display contains its x/y). On restore we validate
 * the saved rect against the CURRENTLY connected displays — if the monitor it lived on is
 * gone (unplugged, resolution change), we drop the stale position and re-center on the
 * primary display rather than opening the window off-screen where it can't be reached.
 *
 * Storage is a plain JSON file (not localStorage) because window bounds are a main-process
 * concern known before the renderer loads.
 */

import { app, screen, type BrowserWindow, type Rectangle } from 'electron';
import path from 'node:path';
import fs from 'node:fs';

const STATE_FILE = 'window-state.json';

const DEFAULT_WIDTH = 1280;
const DEFAULT_HEIGHT = 800;
const MIN_WIDTH = 640;
const MIN_HEIGHT = 480;

/** A visible sliver at least this large (px, both axes) counts as "reachable on screen". */
const MIN_VISIBLE = 100;

/** Debounce window for resize/move persistence (ms). */
const SAVE_DEBOUNCE_MS = 400;

interface WindowState {
  x?: number;
  y?: number;
  width: number;
  height: number;
  isMaximized: boolean;
}

export interface InitialWindowState {
  x?: number;
  y?: number;
  width: number;
  height: number;
  isMaximized: boolean;
}

function stateFilePath(): string {
  return path.join(app.getPath('userData'), STATE_FILE);
}

/** Read + shape-validate the persisted state. Returns null on missing/corrupt file. */
function readState(): WindowState | null {
  try {
    const s = JSON.parse(fs.readFileSync(stateFilePath(), 'utf8')) as Partial<WindowState>;
    if (typeof s.width === 'number' && typeof s.height === 'number') {
      return {
        x: typeof s.x === 'number' ? s.x : undefined,
        y: typeof s.y === 'number' ? s.y : undefined,
        width: s.width,
        height: s.height,
        isMaximized: s.isMaximized === true,
      };
    }
  } catch {
    /* missing / unreadable / malformed → fall back to defaults */
  }
  return null;
}

/**
 * True when at least a MIN_VISIBLE×MIN_VISIBLE sliver of `bounds` overlaps some connected
 * display's work area — i.e. the window would be reachable/draggable rather than orphaned
 * on a monitor that is no longer attached.
 */
function isVisibleOnSomeDisplay(bounds: Rectangle): boolean {
  return screen.getAllDisplays().some((d) => {
    const wa = d.workArea;
    const ix = Math.max(bounds.x, wa.x);
    const iy = Math.max(bounds.y, wa.y);
    const iw = Math.min(bounds.x + bounds.width, wa.x + wa.width) - ix;
    const ih = Math.min(bounds.y + bounds.height, wa.y + wa.height) - iy;
    return iw >= MIN_VISIBLE && ih >= MIN_VISIBLE;
  });
}

/**
 * Compute the BrowserWindow bounds + maximized intent to open with.
 *
 * - No saved state → centered default (omit x/y so Electron centers on the primary display).
 * - Saved state whose position is still visible on a connected monitor → reused verbatim
 *   (this restores the exact monitor + location).
 * - Saved state whose monitor is gone → keep the size (clamped to the primary work area)
 *   but drop x/y so it re-centers on the primary display.
 */
export function getInitialWindowState(): InitialWindowState {
  const s = readState();
  if (!s) {
    return { width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT, isMaximized: false };
  }

  let width = Math.max(MIN_WIDTH, Math.round(s.width));
  let height = Math.max(MIN_HEIGHT, Math.round(s.height));

  if (
    s.x !== undefined &&
    s.y !== undefined &&
    isVisibleOnSomeDisplay({ x: s.x, y: s.y, width, height })
  ) {
    return { x: s.x, y: s.y, width, height, isMaximized: s.isMaximized };
  }

  // Saved monitor/position no longer valid — re-center on primary, keep maximized intent.
  const wa = screen.getPrimaryDisplay().workArea;
  width = Math.min(width, wa.width);
  height = Math.min(height, wa.height);
  return { width, height, isMaximized: s.isMaximized };
}

/**
 * Attach listeners that persist the window's geometry as it changes and on close.
 *
 * Saves getNormalBounds() (the RESTORED rect, valid even while maximized) plus the
 * maximized flag — so a maximized window reopens maximized but "un-maximizes" back to
 * its prior floating size/position.
 */
export function manageWindowState(win: BrowserWindow): void {
  let timer: ReturnType<typeof setTimeout> | null = null;

  const persist = (): void => {
    if (win.isDestroyed()) return;
    // getNormalBounds() returns the pre-maximize/pre-minimize bounds, so restore works.
    const b = win.getNormalBounds();
    const state: WindowState = {
      x: b.x,
      y: b.y,
      width: b.width,
      height: b.height,
      isMaximized: win.isMaximized(),
    };
    try {
      fs.writeFileSync(stateFilePath(), JSON.stringify(state, null, 2), 'utf8');
    } catch {
      /* best-effort — a failed write must never crash the app */
    }
  };

  const debounced = (): void => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(persist, SAVE_DEBOUNCE_MS);
  };

  win.on('resize', debounced);
  win.on('move', debounced);
  win.on('maximize', debounced);
  win.on('unmaximize', debounced);
  win.on('close', () => {
    if (timer) clearTimeout(timer);
    persist(); // flush synchronously on close
  });
}
