/**
 * extract-stock-ilf.cjs — pull the PRISTINE shared_cloning_facility.ilf out of the mounted TREs.
 *
 * Needed to answer: when two buildings share one stock mirror path, does the second building's
 * persist ACCUMULATE onto the first's edit, or REPLACE it? Diffing each derived edit_<id>.ilf
 * against the untouched stock is the only way to tell — comparing the two derived files against
 * each other cannot distinguish the two cases.
 */
'use strict';
const nativeCore = require('../../native-core/index.js');
const fs = require('fs');
const path = require('path');

const root = 'D:/SWG Infinity/SWG Infinity/Live';
const treFiles = fs.readdirSync(root).filter((f) => f.endsWith('.tre')).map((f) => path.join(root, f));
const handle = nativeCore.mountTreMount(treFiles, treFiles.map((_, i) => i));

const want = 'interiorlayout/shared_cloning_facility.ilf';
const hit = nativeCore.resolveEntry(handle, want);
if (!hit || !hit.winner || hit.tombstone) {
  console.error(`NOT FOUND: ${want}`);
  process.exit(1);
}
const bytes = nativeCore.readMountEntry(handle, hit.archiveIndex, hit.entryIndex);
const out = process.argv[2];
fs.writeFileSync(out, Buffer.from(bytes));
console.log(`wrote ${out} (${bytes.byteLength} bytes) from archiveIndex=${hit.archiveIndex}`);
nativeCore.disposeTreMount(handle);
