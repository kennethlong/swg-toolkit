/**
 * packages/renderer/src/services/clientSearchOrder.test.ts
 * Locks the TreeFile.cpp-verified precedence (see clientSearchOrder.ts header):
 * priority DESC wins; equal priority → later-added (higher sku, then later cfg line) wins;
 * the toolkit's own swgtoolkit.cfg is excluded; missing files are skipped; no searchTree
 * → null (caller falls back to a dir scan).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import os from 'os';
import path from 'path';
import fs from 'fs';
import { resolveClientMountOrder } from './clientSearchOrder';

let dir: string;
const tre = (name: string) => fs.writeFileSync(path.join(dir, name), 'EERT5000');
const cfg = (name: string, body: string) => fs.writeFileSync(path.join(dir, name), body);
const names = (paths: string[]) => paths.map((p) => path.basename(p));

beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'swg-searchorder-')); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

describe('resolveClientMountOrder', () => {
  it('orders by priority DESC and resolves filenames against the install root', () => {
    ['a.tre', 'b.tre', 'c.tre'].forEach(tre);
    cfg('root.cfg', '.include "live.cfg"\n');
    cfg('live.cfg', '[SharedFile]\nmaxSearchPriority=27\nsearchTree_00_1=c.tre\nsearchTree_00_25=a.tre\nsearchTree_00_10=b.tre\n');

    const res = resolveClientMountOrder(path.join(dir, 'root.cfg'), dir)!;
    expect(names(res.trePaths)).toEqual(['a.tre', 'b.tre', 'c.tre']); // 25 > 10 > 1
    // strictly-descending mount priorities preserve precedence through the native mount
    expect(res.priorities).toEqual([3, 2, 1]);
  });

  it('equal priority → later cfg line wins (TreeFile lower_bound-before-equal)', () => {
    ['x.tre', 'y.tre'].forEach(tre);
    cfg('root.cfg', '[SharedFile]\nmaxSearchPriority=20\nsearchTree_00_14=x.tre\nsearchTree_00_14=y.tre\n');
    const res = resolveClientMountOrder(path.join(dir, 'root.cfg'), dir)!;
    expect(names(res.trePaths)).toEqual(['y.tre', 'x.tre']); // later line wins
  });

  it('equal priority → higher sku wins (added later in the install loop)', () => {
    ['s0.tre', 's1.tre'].forEach(tre);
    cfg('root.cfg', '[SharedFile]\nmaxSearchPriority=20\nsearchTree_00_5=s0.tre\nsearchTree_01_5=s1.tre\n');
    const res = resolveClientMountOrder(path.join(dir, 'root.cfg'), dir)!;
    expect(names(res.trePaths)).toEqual(['s1.tre', 's0.tre']); // sku 1 wins the tie
  });

  it('excludes the toolkit deploy cfg and skips missing files', () => {
    ['real.tre'].forEach(tre); // toolkit.tre intentionally NOT created
    cfg('root.cfg', '.include "live.cfg"\n.include "swgtoolkit.cfg"\n');
    cfg('live.cfg', '[SharedFile]\nmaxSearchPriority=20\nsearchTree_00_5=real.tre\nsearchTree_00_3=ghost.tre\n');
    cfg('swgtoolkit.cfg', '[SharedFile]\nsearchTree_00_19=toolkit.tre\n');
    const res = resolveClientMountOrder(path.join(dir, 'root.cfg'), dir)!;
    expect(names(res.trePaths)).toEqual(['real.tre']); // ghost (missing) + toolkit (excluded) dropped
  });

  it('drops entries above maxSearchPriority', () => {
    ['keep.tre', 'over.tre'].forEach(tre);
    cfg('root.cfg', '[SharedFile]\nmaxSearchPriority=20\nsearchTree_00_19=keep.tre\nsearchTree_00_25=over.tre\n');
    const res = resolveClientMountOrder(path.join(dir, 'root.cfg'), dir)!;
    expect(names(res.trePaths)).toEqual(['keep.tre']);
  });

  it('returns null when there is no searchTree config (caller falls back to dir scan)', () => {
    cfg('root.cfg', '.include "options.cfg"\n');
    cfg('options.cfg', '[ClientGame]\nsomeKey=1\n');
    expect(resolveClientMountOrder(path.join(dir, 'root.cfg'), dir)).toBeNull();
  });

  // ---------------------------------------------------------------------------
  // Wave-0 extensions — RED until Plan 02 implements searchTOC/searchPath support
  // ---------------------------------------------------------------------------
  // These tests reference fields (looseDirs, tocEntries, searchTreeRawPriorities,
  // looseDirPriorities) that resolveClientMountOrder does not yet return.
  // All four tests FAIL until Plan 02 extends ClientMountOrder + parseSearchNodes.

  it('(ext-a) quote-stripping: searchTOC value with surrounding double-quotes parses to unquoted path', () => {
    // cfg values with embedded spaces are quoted: searchTOC_00_0="path with spaces/foo.toc"
    // resolveClientMountOrder must strip the leading and trailing '"' before returning.
    cfg(
      'root.cfg',
      '[SharedFile]\nmaxSearchPriority=20\nsearchTOC_00_0="' +
        path.join(dir, 'path with spaces') +
        '/sku0.toc"\n',
    );
    const res = resolveClientMountOrder(path.join(dir, 'root.cfg'), dir);
    // RED: tocEntries not yet returned by resolveClientMountOrder
    const tocEntries = (res as any)?.tocEntries as Array<{ tocFilePath: string }> | undefined;
    expect(tocEntries).toBeDefined();
    expect(tocEntries![0].tocFilePath).not.toMatch(/^"/);  // no leading quote
    expect(tocEntries![0].tocFilePath).not.toMatch(/"$/);  // no trailing quote
  });

  it('(ext-b) looseDirs ordered by priority DESC: three searchPath entries at priorities 5, 9, 10', () => {
    // searchPath (loose dirs) must be returned ordered high-priority first.
    // This matches the deploy-target selection rule: MAX-priority searchPath = override dir.
    const dir5  = path.join(dir, 'loose5');
    const dir9  = path.join(dir, 'loose9');
    const dir10 = path.join(dir, 'loose10');
    [dir5, dir9, dir10].forEach((d) => require('fs').mkdirSync(d, { recursive: true }));
    cfg(
      'root.cfg',
      '[SharedFile]\nmaxSearchPriority=20\n' +
        `searchPath_00_5="${dir5}"\n` +
        `searchPath_00_9="${dir9}"\n` +
        `searchPath_00_10="${dir10}"\n`,
    );
    const res = resolveClientMountOrder(path.join(dir, 'root.cfg'), dir);
    // RED: looseDirs / looseDirPriorities not yet returned by resolveClientMountOrder
    const looseDirs = (res as any)?.looseDirs as string[] | undefined;
    const looseDirPriorities = (res as any)?.looseDirPriorities as number[] | undefined;
    expect(looseDirs).toBeDefined();
    expect(looseDirs![0]).toBe(dir10);   // priority 10 first
    expect(looseDirs![1]).toBe(dir9);    // priority 9 second
    expect(looseDirs![2]).toBe(dir5);    // priority 5 last
    expect(looseDirPriorities).toEqual([10, 9, 5]);
  });

  it('(ext-c) searchTreeRawPriorities: two searchTree entries at priorities 7 and 8', () => {
    ['p7.tre', 'p8.tre'].forEach(tre);
    cfg(
      'root.cfg',
      '[SharedFile]\nmaxSearchPriority=20\nsearchTree_00_7=p7.tre\nsearchTree_00_8=p8.tre\n',
    );
    const res = resolveClientMountOrder(path.join(dir, 'root.cfg'), dir)!;
    // RED: searchTreeRawPriorities not yet returned by resolveClientMountOrder
    const rawPriorities = (res as any)?.searchTreeRawPriorities as number[] | undefined;
    expect(rawPriorities).toBeDefined();
    // Priority 8 is higher, so p8.tre is at index 0 → rawPriorities[0]=8
    expect(rawPriorities).toEqual([8, 7]);
  });

  it('(ext-d) regression: searchTree-only cfg still produces identical trePaths+priorities', () => {
    // Verifies that adding searchPath/searchTOC parsing doesn't break the existing
    // searchTree-only path. The result must be byte-identical to the pre-extension behavior.
    ['a.tre', 'b.tre'].forEach(tre);
    cfg(
      'root.cfg',
      '[SharedFile]\nmaxSearchPriority=20\nsearchTree_00_10=a.tre\nsearchTree_00_5=b.tre\n',
    );
    const res = resolveClientMountOrder(path.join(dir, 'root.cfg'), dir)!;
    // These are the existing fields — must not change after extension
    expect(names(res.trePaths)).toEqual(['a.tre', 'b.tre']); // 10 > 5
    expect(res.priorities).toEqual([2, 1]);
  });
});
