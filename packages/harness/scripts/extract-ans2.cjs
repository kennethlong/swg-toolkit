/**
 * extract-ans2.cjs — Extract real .ans fixtures directly from TRE archives.
 */
'use strict';
const nc = require('../../native-core/index.js');
const fs = require('fs');
const path = require('path');

const TRE_DIR = 'D:/SWG Infinity/SWG Infinity/Live';
const OUT_DIR = path.join(__dirname, '../fixtures-real/animation');
fs.mkdirSync(OUT_DIR, { recursive: true });

const treFiles = fs.readdirSync(TRE_DIR)
  .filter(f => f.endsWith('.tre'))
  .map(f => path.join(TRE_DIR, f));

console.log(`Mounting ${treFiles.length} TRE archives...`);
const handle = nc.mountTreMount(treFiles, treFiles.map((_, i) => i));
console.log('Mounted. Searching...');

const hits = nc.searchMount(handle, { text: '.ans', mode: 'substring' });
console.log(`Found ${hits.length} .ans entries`);

let ckatCount = 0, kfatCount = 0, kfat0002Count = 0;
const ckatFiles = [], kfatFiles = [];

for (const hit of hits) {
  if (ckatCount >= 2 && kfatCount >= 2) break;

  try {
    const bytes = nc.readMountEntry(handle, hit.archiveIndex, hit.entryIndex);
    const u8 = new Uint8Array(bytes);

    // Get entry name from archive listing
    const entries = nc.listMountEntries(handle, hit.archiveIndex);
    const entry = entries[hit.entryIndex];
    if (!entry) continue;
    const entryPath = entry.path;
    if (!entryPath.endsWith('.ans')) continue;

    const iff = nc.parseIff(u8);
    const anim = nc.parseAnimation(iff, u8);

    const fname = path.basename(entryPath).replace(/[^a-zA-Z0-9._-]/g, '_');

    if (anim.variant === 'CKAT-0001' && ckatCount < 2) {
      const outPath = path.join(OUT_DIR, fname);
      fs.writeFileSync(outPath, Buffer.from(u8));
      ckatFiles.push(fname);
      console.log(`CKAT [${ckatCount+1}]: ${entryPath} -> ${fname} (fps=${anim.fps.toFixed(1)}, frames=${anim.frameCount}, joints=${anim.joints.length})`);
      ckatCount++;
    } else if (anim.variant === 'KFAT-0003' && kfatCount < 2) {
      const outPath = path.join(OUT_DIR, fname);
      fs.writeFileSync(outPath, Buffer.from(u8));
      kfatFiles.push(fname);
      console.log(`KFAT [${kfatCount+1}]: ${entryPath} -> ${fname} (fps=${anim.fps.toFixed(1)}, frames=${anim.frameCount}, joints=${anim.joints.length})`);
      kfatCount++;
    }
  } catch (e) {
    // Skip broken entries silently
  }
}

// Try to find KFAT 0002 in remaining entries
for (const hit of hits) {
  if (kfat0002Count >= 1) break;
  try {
    const bytes = nc.readMountEntry(handle, hit.archiveIndex, hit.entryIndex);
    const u8 = new Uint8Array(bytes);
    const entries = nc.listMountEntries(handle, hit.archiveIndex);
    const entry = entries[hit.entryIndex];
    if (!entry || !entry.path.endsWith('.ans')) continue;
    const iff = nc.parseIff(u8);
    const anim = nc.parseAnimation(iff, u8);
    if (anim.variant === 'KFAT-0002-unsupported') {
      const fname = path.basename(entry.path).replace(/[^a-zA-Z0-9._-]/g, '_');
      fs.writeFileSync(path.join(OUT_DIR, fname), Buffer.from(u8));
      console.log(`KFAT-0002: ${entry.path} -> ${fname}`);
      kfat0002Count++;
    }
  } catch (_) {}
}

nc.disposeTreMount(handle);

console.log(`\nDone. CKAT=${ckatCount} KFAT-0003=${kfatCount} KFAT-0002=${kfat0002Count}`);
console.log('CKAT files:', ckatFiles);
console.log('KFAT files:', kfatFiles);
