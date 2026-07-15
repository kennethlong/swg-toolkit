/**
 * extract-stf-fixtures.cjs — Extract one real `.stf` localized-string-table fixture from an
 * installed client. One-time script to populate the CORE-05 gitignored real-fixture gate for
 * DATA-02's standing byte-exact round-trip requirement (05-05-PLAN.md Task 4).
 *
 * Client root resolution (mirrors extract-effect-fixtures.cjs's env-overridable-root convention,
 * the MORE RECENT pattern — preferred over extract-ans-fixtures.cjs's hardcoded-path style):
 *   process.env['SWG_STF_FIXTURE_CLIENT_ROOT'] ?? try in order:
 *     'D:/SWG Infinity/SWG Infinity/Live'
 *     'D:/SWGEmu Client/SWGEmu'
 *
 * VFS prefix (confirmed by an interactive mount+listMountEntries pass this session — real SWG
 * localized-string tables live under 'string/<locale>/', e.g. 'string/en/armor_rehue.stf'):
 *   Uses listMountEntries() (not searchMount(), whose hits carry {archiveIndex, entryIndex} ONLY —
 *   no .path field, T-01-06) to get real basenames, filtered to paths starting with 'string/'
 *   and ending '.stf'.
 *
 * Failure mode: if the client root does not exist, OR no string/*.stf entries are found, OR no
 * entry parses as a valid `.stf` (magic 0xABCD), this script exits NON-ZERO and prints the exact
 * root(s)/pattern searched. No silent no-op (mirrors 04.4-05's extract-effect-fixtures.cjs fix).
 *
 * Usage: node scripts/extract-stf-fixtures.cjs
 *        (optionally: SWG_STF_FIXTURE_CLIENT_ROOT=<path> node scripts/extract-stf-fixtures.cjs)
 */

'use strict';
const nativeCore = require('../../native-core/index.js');
const fs = require('fs');
const path = require('path');

const CANDIDATE_ROOTS = process.env['SWG_STF_FIXTURE_CLIENT_ROOT']
  ? [process.env['SWG_STF_FIXTURE_CLIENT_ROOT']]
  : ['D:/SWG Infinity/SWG Infinity/Live', 'D:/SWGEmu Client/SWGEmu'];

const OUT_DIR = path.join(__dirname, '../fixtures-real/stf');
const VFS_PREFIX = 'string/';

function fail(message) {
  console.error(`[extract-stf-fixtures] ERROR: ${message}`);
  console.error(`[extract-stf-fixtures] Client root(s) searched: ${CANDIDATE_ROOTS.join(', ')}`);
  console.error(`[extract-stf-fixtures] VFS pattern searched: ${VFS_PREFIX}<locale>/*.stf`);
  process.exit(1);
}

// ─── Resolve a usable client root ──────────────────────────────────────────────
let clientRoot = null;
let treFiles = [];
for (const candidate of CANDIDATE_ROOTS) {
  if (!fs.existsSync(candidate)) continue;
  const files = fs.readdirSync(candidate)
    .filter((f) => f.endsWith('.tre'))
    .map((f) => path.join(candidate, f));
  if (files.length > 0) {
    clientRoot = candidate;
    treFiles = files;
    break;
  }
}

if (!clientRoot) {
  fail(`No usable client root found (none of the searched roots exist or contain .tre archives).`);
}

console.log(`[extract-stf-fixtures] Mounting ${treFiles.length} TRE archives from ${clientRoot}...`);
const priorities = treFiles.map((_, i) => i);
const handle = nativeCore.mountTreMount(treFiles, priorities);
console.log('[extract-stf-fixtures] Mounted.');

// ─── Find string/<locale>/*.stf candidates via listMountEntries (has real paths;
//      searchMount() hits do not — T-01-06) ────────────────────────────────────
const allEntries = nativeCore.listMountEntries(handle);
const candidates = allEntries.filter(
  (e) => !e.isTombstone && e.path.startsWith(VFS_PREFIX) && e.path.endsWith('.stf'),
);
console.log(`[extract-stf-fixtures] Found ${candidates.length} entries matching "${VFS_PREFIX}*/*.stf".`);

if (candidates.length === 0) {
  nativeCore.disposeTreMount(handle);
  fail(`No entries found under VFS prefix "${VFS_PREFIX}" ending ".stf".`);
}

// ─── Pick the first candidate that resolves + parses as a valid `.stf` (proves it's
//      real, well-formed, magic 0xABCD, and round-trippable) ──────────────────────
fs.mkdirSync(OUT_DIR, { recursive: true });

let picked = null;
let tried = 0;
for (const entry of candidates) {
  tried++;
  try {
    const r = nativeCore.resolveEntry(handle, entry.path);
    if (!r.winner || r.archiveIndex < 0 || r.entryIndex < 0) continue;

    const bytes = new Uint8Array(nativeCore.readMountEntry(handle, r.archiveIndex, r.entryIndex));
    const result = nativeCore.parseStf(bytes);

    picked = { path: entry.path, bytes, result };
    break;
  } catch (e) {
    // Not a parseable `.stf` (or a malformed entry) — skip.
  }
}

if (!picked) {
  nativeCore.disposeTreMount(handle);
  fail(
    `Checked ${tried} candidate(s) under "${VFS_PREFIX}*/*.stf" but none parsed as a valid ` +
    `.stf — the localized-string-table fixture could not be extracted.`,
  );
}

const outName = path.basename(picked.path);
const outPath = path.join(OUT_DIR, outName);
fs.writeFileSync(outPath, Buffer.from(picked.bytes));
console.log(
  `[extract-stf-fixtures] STF: ${picked.path} -> ${outPath} ` +
  `(entries=${picked.result.entries.length}, nameMap=${picked.result.nameMap.length}, ` +
  `bytes=${picked.bytes.length})`,
);

nativeCore.disposeTreMount(handle);

console.log(`\n[extract-stf-fixtures] Done. Extracted "${outName}" from ${tried} candidate(s) checked.`);
console.log(
  `[extract-stf-fixtures] The stf-roundtrip.test.ts real-asset lane loads the first ` +
  `"*.stf" file it finds under "fixtures-real/stf/" — re-run this script (it always picks the ` +
  `first-listed string/<locale>/*.stf entry via listMountEntries' order) if you need a different fixture.`,
);
