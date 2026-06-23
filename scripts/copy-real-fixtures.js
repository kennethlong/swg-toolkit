'use strict';
/**
 * scripts/copy-real-fixtures.js — Copy a small sample of real TRE archives into
 * packages/harness/fixtures-real/ for the CI-BLOCKING field-order arbiter.
 *
 * Safety rules (D-10):
 *   - NEVER mutates originals — uses fs.copyFile (read-only copy)
 *   - Copies at most SAMPLE_PER_CLIENT files per client install
 *   - Copies the SMALLEST files first (minimises disk usage)
 *   - The target directory (.gitignore'd) is NEVER committed
 *
 * Usage:
 *   node scripts/copy-real-fixtures.js
 *
 * Clients sampled:
 *   - D:\SWG Infinity        (v0005)
 *   - D:\SWGEmu Client\SWGEmu (v0005)
 *   - D:\Stardust TREs        (v0005, if present)
 *   - D:\SWG Restoration      (v6000, if present)
 *
 * Source: D-10 asset safety policy; D-12 arbiter MUST-RUN requirement.
 */

const fs   = require('fs');
const path = require('path');

const DEST_DIR          = path.join(__dirname, '..', 'packages', 'harness', 'fixtures-real');
const SAMPLE_PER_CLIENT = 3;   // copy at most 3 .tre files per client (smallest first)
const MAX_FILE_SIZE     = 64 * 1024 * 1024; // 64 MB cap per file

// Known SWG client root directories and their expected TRE version
const CLIENTS = [
  { dir: 'D:\\SWG Infinity',          label: 'Infinity',    version: '0005' },
  { dir: 'D:\\SWGEmu Client\\SWGEmu', label: 'SWGEmu',     version: '0005' },
  { dir: 'D:\\Stardust TREs',         label: 'Stardust',   version: '0005' },
  { dir: 'D:\\SWG Restoration',       label: 'Restoration', version: '6000' },
];

fs.mkdirSync(DEST_DIR, { recursive: true });

let totalCopied = 0;
let totalSkipped = 0;

for (const client of CLIENTS) {
  if (!fs.existsSync(client.dir)) {
    console.log(`[SKIP] ${client.label}: directory not found at ${client.dir}`);
    continue;
  }

  // List all .tre files directly in the client root (not recursive — top-level only)
  let treFiles;
  try {
    treFiles = fs.readdirSync(client.dir)
      .filter((f) => f.toLowerCase().endsWith('.tre'))
      .map((f) => ({
        name: f,
        full: path.join(client.dir, f),
        size: fs.statSync(path.join(client.dir, f)).size,
      }))
      .filter((f) => f.size <= MAX_FILE_SIZE)
      .sort((a, b) => a.size - b.size); // smallest first
  } catch (err) {
    console.log(`[ERR]  ${client.label}: could not read directory: ${err.message}`);
    continue;
  }

  if (treFiles.length === 0) {
    console.log(`[WARN] ${client.label}: no .tre files found in ${client.dir}`);
    continue;
  }

  const sample = treFiles.slice(0, SAMPLE_PER_CLIENT);
  for (const f of sample) {
    // Verify magic and version tag before copying
    let magic = '', version = '';
    try {
      const handle = fs.openSync(f.full, 'r');
      const hdr = Buffer.alloc(8);
      fs.readSync(handle, hdr, 0, 8, 0);
      fs.closeSync(handle);
      magic   = hdr.subarray(0, 4).toString('ascii');
      version = hdr.subarray(4, 8).toString('ascii');
    } catch (err) {
      console.log(`[SKIP] ${f.name}: could not read header: ${err.message}`);
      totalSkipped++;
      continue;
    }

    if (magic !== 'EERT') {
      console.log(`[SKIP] ${f.name}: unexpected magic '${magic}' (expected 'EERT')`);
      totalSkipped++;
      continue;
    }

    // Prefix the destination filename with the client label to avoid collisions
    const destName = `${client.label.toLowerCase()}-${f.name}`;
    const destPath = path.join(DEST_DIR, destName);

    if (fs.existsSync(destPath)) {
      console.log(`[SKIP] ${destName}: already exists in fixtures-real/`);
      continue;
    }

    fs.copyFileSync(f.full, destPath, fs.constants.COPYFILE_EXCL);
    console.log(`[COPY] ${client.label} ${f.name} (${(f.size/1024).toFixed(1)} KB, version=${version}) -> ${destName}`);
    totalCopied++;
  }
}

console.log(`\nDone: ${totalCopied} copied, ${totalSkipped} skipped.`);
console.log(`Run: pnpm vitest run -t "tre fieldorder arbiter"`);
