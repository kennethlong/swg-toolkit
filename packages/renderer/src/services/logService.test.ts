/**
 * packages/renderer/src/services/logService.test.ts
 * RED-phase tests for the logStore ring buffer + logService console-capture API
 * (Plan 04.4-02, requirement inapp-console-log-tabs-inactive).
 *
 * Behavior under test:
 *   - logStore.append/clear ring buffer capped at 2000 entries (FIFO, oldest dropped).
 *   - installConsoleCapture() wraps console.log/warn/error, forwarding entries into the
 *     store as channel:'console' while still invoking the ORIGINAL console.* method.
 *   - installConsoleCapture() is idempotent (double-install does not double-wrap).
 *   - log(level, channel, message) appends a structured channel:'log' entry directly.
 *   - window 'error' / 'unhandledrejection' produce channel:'console', level:'error' entries.
 *   - resetConsoleCaptureForTests() genuinely unwraps console.* and removes the window
 *     listeners, clearing the `installed` guard so a later installConsoleCapture() re-wraps.
 *
 * Source: 04.4-02-PLAN.md Task 1 (round-2 revision — resetConsoleCaptureForTests added).
 *
 * @vitest-environment jsdom
 * (needs window/ErrorEvent; the root vitest.config.ts defaults to environment:node)
 */

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';

import { useLogStore } from '../state/logStore';
import { installConsoleCapture, log, resetConsoleCaptureForTests } from './logService';

beforeEach(() => {
  useLogStore.getState().clear();
});

afterEach(() => {
  resetConsoleCaptureForTests();
  useLogStore.getState().clear();
});

describe('logStore ring buffer', () => {
  it('caps at 2000 entries, dropping oldest (FIFO)', () => {
    for (let i = 0; i < 2001; i++) {
      useLogStore.getState().append({ level: 'info', channel: 'log', message: `msg-${i}` });
    }
    const { entries } = useLogStore.getState();
    expect(entries.length).toBe(2000);
    // Oldest entry (msg-0) dropped; newest (msg-2000) retained.
    expect(entries[0]!.message).toBe('msg-1');
    expect(entries[entries.length - 1]!.message).toBe('msg-2000');
  });

  it('clear() empties entries', () => {
    useLogStore.getState().append({ level: 'info', channel: 'log', message: 'x' });
    useLogStore.getState().clear();
    expect(useLogStore.getState().entries).toEqual([]);
  });
});

describe('logService.installConsoleCapture', () => {
  it('mirrors console.log/warn/error into the store with correct levels, without silencing the original', () => {
    const originalLog = console.log;
    const originalWarn = console.warn;
    const originalError = console.error;
    const logSpy = vi.spyOn(console, 'log');
    const warnSpy = vi.spyOn(console, 'warn');
    const errorSpy = vi.spyOn(console, 'error');

    installConsoleCapture();

    console.log('x');
    console.warn('y');
    console.error('z');

    expect(logSpy).toHaveBeenCalledWith('x');
    expect(warnSpy).toHaveBeenCalledWith('y');
    expect(errorSpy).toHaveBeenCalledWith('z');

    const consoleEntries = useLogStore.getState().entries.filter((e) => e.channel === 'console');
    expect(consoleEntries.some((e) => e.level === 'info' && e.message.includes('x'))).toBe(true);
    expect(consoleEntries.some((e) => e.level === 'warn' && e.message.includes('y'))).toBe(true);
    expect(consoleEntries.some((e) => e.level === 'error' && e.message.includes('z'))).toBe(true);

    logSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
    // Sanity: originals are still the real functions being wrapped-around (not silenced).
    expect(originalLog).toBeTypeOf('function');
    expect(originalWarn).toBeTypeOf('function');
    expect(originalError).toBeTypeOf('function');
  });

  it('is idempotent — a second install() call does not double-wrap', () => {
    installConsoleCapture();
    installConsoleCapture();

    useLogStore.getState().clear();
    console.log('once');

    const consoleEntries = useLogStore
      .getState()
      .entries.filter((e) => e.channel === 'console' && e.message.includes('once'));
    expect(consoleEntries.length).toBe(1);
  });

  it('window error and unhandledrejection events produce channel:console level:error entries', () => {
    installConsoleCapture();
    useLogStore.getState().clear();

    const errorEvent = new ErrorEvent('error', { message: 'synthetic window error' });
    window.dispatchEvent(errorEvent);

    const rejectionEvent = new Event('unhandledrejection') as PromiseRejectionEvent;
    Object.defineProperty(rejectionEvent, 'reason', { value: 'synthetic rejection' });
    window.dispatchEvent(rejectionEvent);

    const entries = useLogStore.getState().entries;
    expect(entries.some((e) => e.channel === 'console' && e.level === 'error' && e.message.includes('synthetic window error'))).toBe(true);
    expect(entries.some((e) => e.channel === 'console' && e.level === 'error' && e.message.includes('synthetic rejection'))).toBe(true);
  });
});

describe('logService.log', () => {
  it('appends a structured channel:log entry', () => {
    log('warn', 'log', 'structured app event');
    const entries = useLogStore.getState().entries;
    expect(entries.some((e) => e.channel === 'log' && e.level === 'warn' && e.message === 'structured app event')).toBe(true);
  });
});

describe('logService.resetConsoleCaptureForTests', () => {
  it('restores the ORIGINAL console.log reference (genuinely unwrapped)', () => {
    const originalLog = console.log;
    installConsoleCapture();
    expect(console.log).not.toBe(originalLog);

    resetConsoleCaptureForTests();
    expect(console.log).toBe(originalLog);
  });

  it('removes the window error/unhandledrejection listeners this module added', () => {
    installConsoleCapture();
    resetConsoleCaptureForTests();
    useLogStore.getState().clear();

    const errorEvent = new ErrorEvent('error', { message: 'post-reset error' });
    window.dispatchEvent(errorEvent);

    expect(useLogStore.getState().entries.length).toBe(0);
  });

  it('allows installConsoleCapture() to re-wrap successfully after a reset', () => {
    installConsoleCapture();
    resetConsoleCaptureForTests();
    installConsoleCapture();
    useLogStore.getState().clear();

    console.log('re-wrapped');

    const entries = useLogStore.getState().entries.filter((e) => e.message.includes('re-wrapped'));
    expect(entries.length).toBe(1);
  });
});
