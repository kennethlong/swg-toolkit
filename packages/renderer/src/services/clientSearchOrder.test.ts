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
});
