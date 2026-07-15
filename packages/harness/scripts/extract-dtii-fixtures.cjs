/**
 * extract-dtii-fixtures.cjs — Extract one real FORM DTII (.iff) datatable fixture from an
 * installed client. One-time script to populate the CORE-05 gitignored real-fixture gate for
 * DATA-01's standing byte-exact round-trip requirement (05-02-PLAN.md Task 4).
 *
 * Client root resolution (mirrors extract-effect-fixtures.cjs's env-overridable-root convention,
 * the MORE RECENT pattern — preferred over extract-ans-fixtures.cjs's hardcoded-path style):
 *   process.env['SWG_DTII_FIXTURE_CLIENT_ROOT'] ?? try in order:
 *     'D:/SWG Infinity/SWG Infinity/Live'
 *     'D:/SWGEmu Client/SWGEmu'
 *
 * VFS prefix (confirmed by an interactive mount+search pass this session — real SWG datatables
 * live under 'datatables/', e.g. 'datatables/appearance/appearance_table.iff'):
 *   Uses listMountEntries() (not searchMount(), whose hits carry {archiveIndex, entryIndex} ONLY —
 *   no .path field, T-01-06) to get real basenames, filtered to paths starting with 'datatables/'
 *   and ending '.iff'.
 *
 * Version gate: serializeDataTable() ALWAYS emits canonical FORM 0001 (DataTableWriter.cpp:650-664
 * is the writer's only output shape) regardless of the version a file was parsed from. Picking a
 * legacy FORM 0000 asset would make the round-trip gate legitimately (and misleadingly) fail on a
 * version mismatch, not a parser bug — so this script only accepts version === '0001' candidates,
 * which is what every real compiled datatable in a modern client build already is.
 *
 * Failure mode: if the client root does not exist, OR no datatables/*.iff entries are found, OR no
 * entry parses as a valid version-0001 FORM DTII, this script exits NON-ZERO and prints the exact
 * root(s)/pattern searched. No silent no-op (mirrors 04.4-05's extract-effect-fixtures.cjs fix).
 *
 * Usage: node scripts/extract-dtii-fixtures.cjs
 *        (optionally: SWG_DTII_FIXTURE_CLIENT_ROOT=<path> node scripts/extract-dtii-fixtures.cjs)
 */

'use strict';
const nativeCore = require('../../native-core/index.js');
const fs = require('fs');
const path = require('path');

const CANDIDATE_ROOTS = process.env['SWG_DTII_FIXTURE_CLIENT_ROOT']
  ? [process.env['SWG_DTII_FIXTURE_CLIENT_ROOT']]
  : ['D:/SWG Infinity/SWG Infinity/Live', 'D:/SWGEmu Client/SWGEmu'];

const OUT_DIR = path.join(__dirname, '../fixtures-real/datatable');
const VFS_PREFIX = 'datatables/';

function fail(message) {
  console.error(`[extract-dtii-fixtures] ERROR: ${message}`);
  console.error(`[extract-dtii-fixtures] Client root(s) searched: ${CANDIDATE_ROOTS.join(', ')}`);
  console.error(`[extract-dtii-fixtures] VFS pattern searched: ${VFS_PREFIX}*.iff`);
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

console.log(`[extract-dtii-fixtures] Mounting ${treFiles.length} TRE archives from ${clientRoot}...`);
const priorities = treFiles.map((_, i) => i);
const handle = nativeCore.mountTreMount(treFiles, priorities);
console.log('[extract-dtii-fixtures] Mounted.');

// ─── Find datatables/*.iff candidates via listMountEntries (has real paths;
//      searchMount() hits do not — T-01-06) ───────────────────────────────────
const allEntries = nativeCore.listMountEntries(handle);
const candidates = allEntries.filter(
  (e) => !e.isTombstone && e.path.startsWith(VFS_PREFIX) && e.path.endsWith('.iff'),
);
console.log(`[extract-dtii-fixtures] Found ${candidates.length} entries matching "${VFS_PREFIX}*.iff".`);

if (candidates.length === 0) {
  nativeCore.disposeTreMount(handle);
  fail(`No entries found under VFS prefix "${VFS_PREFIX}" ending ".iff".`);
}

// ─── Pick the first candidate that resolves + parses as a valid version-0001
//      FORM DTII (proves it's real, well-formed, and round-trippable against
//      our canonical-0001-only serializer) ────────────────────────────────────
fs.mkdirSync(OUT_DIR, { recursive: true });

let picked = null;
let tried = 0;
for (const entry of candidates) {
  tried++;
  try {
    const r = nativeCore.resolveEntry(handle, entry.path);
    if (!r.winner || r.archiveIndex < 0 || r.entryIndex < 0) continue;

    const bytes = new Uint8Array(nativeCore.readMountEntry(handle, r.archiveIndex, r.entryIndex));
    const iff = nativeCore.parseIff(bytes);
    const result = nativeCore.parseDataTable(iff, bytes);
    if (result.formatTag !== 'DTII' || result.version !== '0001') continue;

    picked = { path: entry.path, bytes, result };
    break;
  } catch (e) {
    // Not a parseable FORM DTII (or a legacy/malformed entry) — skip.
  }
}

if (!picked) {
  nativeCore.disposeTreMount(handle);
  fail(
    `Checked ${tried} candidate(s) under "${VFS_PREFIX}*.iff" but none parsed as a valid ` +
    `version-0001 FORM DTII — the datatable fixture could not be extracted.`,
  );
}

const outName = path.basename(picked.path);
const outPath = path.join(OUT_DIR, outName);
fs.writeFileSync(outPath, Buffer.from(picked.bytes));
console.log(
  `[extract-dtii-fixtures] DTII: ${picked.path} -> ${outPath} ` +
  `(columns=${picked.result.columns.length}, rows=${picked.result.rows.length}, ` +
  `bytes=${picked.bytes.length})`,
);

nativeCore.disposeTreMount(handle);

console.log(`\n[extract-dtii-fixtures] Done. Extracted "${outName}" from ${tried} candidate(s) checked.`);
console.log(
  `[extract-dtii-fixtures] The dtii-roundtrip.test.ts real-asset lane loads ` +
  `"datatable/${outName}" — re-run this script (it always picks the alphabetically-first ` +
  `datatables/*.iff entry via listMountEntries' sorted-by-path order) if you need a different fixture.`,
);
