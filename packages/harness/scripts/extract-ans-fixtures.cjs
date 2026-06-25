/**
 * extract-ans-fixtures.js — Extract real .ans animation files from TRE archives.
 * One-time script to get fixture files for CORE-05 tests.
 * Usage: node scripts/extract-ans-fixtures.js
 */

'use strict';
const nativeCore = require('../../native-core/index.js');
const fs = require('fs');
const path = require('path');

const TRE_DIR = 'D:/SWG Infinity/SWG Infinity/Live';
const OUT_DIR = path.join(__dirname, '../fixtures-real/animation');
fs.mkdirSync(OUT_DIR, { recursive: true });

// TRE files to search (appearance + files archives most likely to have .ans)
const treFiles = fs.readdirSync(TRE_DIR)
  .filter(f => f.endsWith('.tre'))
  .map(f => path.join(TRE_DIR, f));

console.log(`Mounting ${treFiles.length} TRE archives...`);
const priorities = treFiles.map((_, i) => i);
const handle = nativeCore.mountTreMount(treFiles, priorities);
console.log('Mounted.');

// Search for .ans entries
const results = nativeCore.searchMount(handle, { text: '.ans', mode: 'substring' });
console.log(`Found ${results.length} .ans entries in mount.`);

if (results.length === 0) {
  console.error('No .ans entries found — check TRE paths');
  process.exit(1);
}

// Try to find a mix of CKAT and KFAT animations
const seen = new Set();
let ckatExtracted = 0;
let kfatExtracted = 0;

for (const entry of results) {
  if (ckatExtracted >= 2 && kfatExtracted >= 2) break;
  if (seen.has(entry.path)) continue;
  seen.add(entry.path);

  try {
    const { winner, archiveIndex, entryIndex } = nativeCore.resolveEntry(handle, entry.path);
    if (!winner || archiveIndex === undefined || entryIndex === undefined) continue;

    const bytes = nativeCore.readMountEntry(handle, archiveIndex, entryIndex);
    const u8 = new Uint8Array(bytes);

    // Quick check: parse it
    const iff = nativeCore.parseIff(u8);
    const anim = nativeCore.parseAnimation(iff, u8);

    const fname = path.basename(entry.path);

    if (anim.variant === 'CKAT-0001' && ckatExtracted < 2) {
      const outPath = path.join(OUT_DIR, fname);
      fs.writeFileSync(outPath, Buffer.from(u8));
      console.log(`CKAT: ${entry.path} -> ${outPath} (fps=${anim.fps}, frames=${anim.frameCount}, joints=${anim.joints.length})`);
      ckatExtracted++;
    } else if (anim.variant === 'KFAT-0003' && kfatExtracted < 2) {
      const outPath = path.join(OUT_DIR, fname);
      fs.writeFileSync(outPath, Buffer.from(u8));
      console.log(`KFAT: ${entry.path} -> ${outPath} (fps=${anim.fps}, frames=${anim.frameCount}, joints=${anim.joints.length})`);
      kfatExtracted++;
    }
  } catch (e) {
    // skip broken entries
  }
}

// Try to find a KFAT 0002 sample if present
let kfat0002 = 0;
for (const entry of results) {
  if (kfat0002 >= 1) break;
  if (seen.has(entry.path) && !entry.path.includes('0002')) continue;
  try {
    const { winner, archiveIndex, entryIndex } = nativeCore.resolveEntry(handle, entry.path);
    if (!winner) continue;
    const bytes = nativeCore.readMountEntry(handle, archiveIndex, entryIndex);
    const u8 = new Uint8Array(bytes);
    const iff = nativeCore.parseIff(u8);
    const anim = nativeCore.parseAnimation(iff, u8);
    if (anim.variant === 'KFAT-0002-unsupported') {
      const outPath = path.join(OUT_DIR, path.basename(entry.path));
      fs.writeFileSync(outPath, Buffer.from(u8));
      console.log(`KFAT-0002: ${entry.path} -> ${outPath}`);
      kfat0002++;
    }
  } catch (_) {}
}

nativeCore.disposeTreMount(handle);

console.log(`\nExtracted: CKAT=${ckatExtracted}, KFAT-0003=${kfatExtracted}, KFAT-0002=${kfat0002}`);
if (ckatExtracted === 0 && kfatExtracted === 0) {
  console.error('ERROR: No animations extracted — parser may be broken');
  process.exit(1);
}
