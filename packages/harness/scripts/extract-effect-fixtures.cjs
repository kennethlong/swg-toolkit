/**
 * extract-effect-fixtures.cjs — Extract the real a_envmask_specmap.eft shader-effect fixture
 * (and its companion body-droid .sht shader-template) from a real client install.
 * One-time script to populate the CORE-05 gitignored real-fixture gate for FORM EFCT.
 *
 * Mirrors extract-ans-fixtures.cjs's mount/search/read structure. NOTE (deviation from the
 * extract-ans-fixtures.cjs "resolveEntry(handle, entry.path)" pattern): searchMount() hits are
 * {entryIndex, archiveIndex} ONLY — no `.path` field (T-01-06: search never ships full names in
 * bulk). resolveEntry() needs an exact VFS path string, which we don't have from a substring
 * search. readMountEntry(handle, archiveIndex, entryIndex) works DIRECTLY off a search hit's
 * indices with no path needed — so we read every hit's bytes and let parseIff/parseEffect
 * (or parseShader) validate the format, skipping non-matching entries via try/catch.
 *
 * Client root resolution (round-1 revision, Opus's "parameterize the client root"):
 *   process.env['SWG_EFT_FIXTURE_CLIENT_ROOT'] ?? 'D:/SWG Infinity/SWG Infinity/Live'
 * The maintainer's own machine is the only expected runner, but the root is env-overridable
 * so this isn't hardcoded with zero fallback.
 *
 * Failure mode (round-1 revision — the prior plan lacked this): if the client root does not
 * exist, OR the search for the effect fixture returns zero entries, OR no hit parses as a valid
 * FORM EFCT, this script exits NON-ZERO and prints the exact root searched + pattern used.
 * No silent no-op.
 *
 * Usage: node scripts/extract-effect-fixtures.cjs
 *        (optionally: SWG_EFT_FIXTURE_CLIENT_ROOT=<path> node scripts/extract-effect-fixtures.cjs)
 */

'use strict';
const nativeCore = require('../../native-core/index.js');
const fs = require('fs');
const path = require('path');

const CLIENT_ROOT = process.env['SWG_EFT_FIXTURE_CLIENT_ROOT'] ?? 'D:/SWG Infinity/SWG Infinity/Live';
const EFT_OUT_DIR = path.join(__dirname, '../fixtures-real/effect');
const SHT_OUT_DIR = path.join(__dirname, '../fixtures-real/shader');

const EFT_PATTERN = 'a_envmask_specmap';
const EFT_OUT_NAME = 'a_envmask_specmap.eft';
const SHT_PATTERN = 'body_droid_m_01_r_3';
const SHT_OUT_NAME = 'body_droid_m_01_r_3.sht';

function fail(message) {
  console.error(`[extract-effect-fixtures] ERROR: ${message}`);
  console.error(`[extract-effect-fixtures] Client root searched: ${CLIENT_ROOT}`);
  process.exit(1);
}

// ─── Loud not-found path: client root missing ────────────────────────────────
if (!fs.existsSync(CLIENT_ROOT)) {
  fail(`Client root does not exist: ${CLIENT_ROOT}`);
}

const treFiles = fs.readdirSync(CLIENT_ROOT)
  .filter(f => f.endsWith('.tre'))
  .map(f => path.join(CLIENT_ROOT, f));

if (treFiles.length === 0) {
  fail(`No .tre archives found under client root: ${CLIENT_ROOT}`);
}

console.log(`[extract-effect-fixtures] Mounting ${treFiles.length} TRE archives from ${CLIENT_ROOT}...`);
const priorities = treFiles.map((_, i) => i);
const handle = nativeCore.mountTreMount(treFiles, priorities);
console.log('[extract-effect-fixtures] Mounted.');

// ─── Extract a_envmask_specmap.eft ───────────────────────────────────────────
fs.mkdirSync(EFT_OUT_DIR, { recursive: true });

const eftHits = nativeCore.searchMount(handle, { text: EFT_PATTERN, mode: 'substring' });
console.log(`[extract-effect-fixtures] Found ${eftHits.length} entries matching "${EFT_PATTERN}" (all archives).`);

if (eftHits.length === 0) {
  nativeCore.disposeTreMount(handle);
  fail(`Search pattern "${EFT_PATTERN}" (mode=substring) returned zero entries — the effect fixture could not be located.`);
}

let eftExtracted = 0;
for (const hit of eftHits) {
  if (eftExtracted >= 1) break;
  try {
    const bytes = nativeCore.readMountEntry(handle, hit.archiveIndex, hit.entryIndex);
    const u8 = new Uint8Array(bytes);

    // Sanity check: parse it before committing to disk — parseEffect throws if root
    // isn't FORM EFCT, which is how we filter non-.eft hits (no path field to check).
    const iff = nativeCore.parseIff(u8);
    const result = nativeCore.parseEffect(iff, u8);
    if (result.formatTag !== 'EFCT') continue;

    const outPath = path.join(EFT_OUT_DIR, EFT_OUT_NAME);
    fs.writeFileSync(outPath, Buffer.from(u8));
    console.log(`[extract-effect-fixtures] EFT: archive[${hit.archiveIndex}]/entry[${hit.entryIndex}] -> ${outPath} (impls=${result.impls.length})`);
    eftExtracted++;
  } catch (e) {
    // Not a parseable FORM EFCT (or a v6000 enumerate-only archive) — skip.
  }
}

if (eftExtracted === 0) {
  nativeCore.disposeTreMount(handle);
  fail(`Search pattern "${EFT_PATTERN}" matched ${eftHits.length} entries but none parsed as a valid FORM EFCT — the effect fixture could not be extracted.`);
}

// ─── Extract companion body-droid .sht (Bug-1 regression fixture) ───────────
// Confirm it doesn't already exist on disk from a prior phase before re-extracting.
fs.mkdirSync(SHT_OUT_DIR, { recursive: true });
const existingShtPath = path.join(SHT_OUT_DIR, SHT_OUT_NAME);

if (fs.existsSync(existingShtPath)) {
  console.log(`[extract-effect-fixtures] SHT: ${SHT_OUT_NAME} already present at ${existingShtPath} — skipping re-extraction.`);
} else {
  const shtHits = nativeCore.searchMount(handle, { text: SHT_PATTERN, mode: 'substring' });
  console.log(`[extract-effect-fixtures] Found ${shtHits.length} entries matching "${SHT_PATTERN}" (all archives).`);

  let shtExtracted = 0;
  for (const hit of shtHits) {
    if (shtExtracted >= 1) break;
    try {
      const bytes = nativeCore.readMountEntry(handle, hit.archiveIndex, hit.entryIndex);
      const u8 = new Uint8Array(bytes);

      const iff = nativeCore.parseIff(u8);
      const result = nativeCore.parseShader(iff, u8);
      const envmSlot = result.slots.find((s) => s.slot === 'ENVM');
      if (!envmSlot || !envmSlot.texturePath) continue; // need the ENVM-slot variant for Bug-1

      fs.writeFileSync(existingShtPath, Buffer.from(u8));
      console.log(`[extract-effect-fixtures] SHT: archive[${hit.archiveIndex}]/entry[${hit.entryIndex}] -> ${existingShtPath}`);
      shtExtracted++;
    } catch (e) {
      // Not a parseable FORM SSHT with an ENVM slot — skip.
    }
  }

  if (shtExtracted === 0) {
    console.warn(`[extract-effect-fixtures] WARNING: could not extract a ".sht" matching "${SHT_PATTERN}" with a populated ENVM slot — Bug-1 regression fixture NOT extracted (non-fatal, this fixture may already be covered elsewhere).`);
  }
}

nativeCore.disposeTreMount(handle);

console.log(`\n[extract-effect-fixtures] Done. EFT extracted=${eftExtracted}.`);
