/**
 * extract-ilf-fixtures.cjs — Extract one real `.ilf` interior-layout fixture from an installed
 * client. One-time script to populate the CORE-05 gitignored real-fixture gate for the addNode/
 * removeNode append/delete round-trip requirement (05.1-01-PLAN.md Task 4).
 *
 * Client root resolution (mirrors extract-stf-fixtures.cjs's env-overridable-root convention):
 *   process.env['SWG_ILF_FIXTURE_CLIENT_ROOT'] ?? try in order:
 *     'D:/SWG Infinity/SWG Infinity/Live'   (CONFIRMED PRESENT this session — 27 .tre archives)
 *     'D:/SWGEmu Client/SWGEmu'             (fallback candidate ONLY — ROUND 3 REVIEWS.md R13
 *                                             confirmed this does NOT exist on this machine; a
 *                                             missing candidate is skipped silently, never an error
 *                                             on its own — only zero USABLE roots hard-fails)
 *
 * VFS prefix (per ilf.ts's module docstring / CONSULT-70 ground truth — interior-layout files
 * live under 'interiorlayout/'):
 *   Uses listMountEntries() (not searchMount(), whose hits carry {archiveIndex, entryIndex} ONLY —
 *   no .path field, T-01-06) to get real basenames, filtered to paths starting with
 *   'interiorlayout/' and ending '.ilf'.
 *
 * This script is CJS and does NOT import the ESM ilf.ts parser — it validates candidates with an
 * inline structural check against the same FORM/INLY/0000 tag layout ilf.ts's own docstring
 * documents (FORM @ offset 0, 'INLY' subtype @ offset 8, inner FORM '0000' at the nested offset).
 * The FULL parse/serialize round-trip validation happens in ilf-roundtrip.test.ts, which imports
 * ilf.ts directly and can resolve TypeScript.
 *
 * Failure mode: if no candidate client root exists, OR no interiorlayout/*.ilf entries are found,
 * OR no entry passes the structural sanity check, this script exits NON-ZERO and prints the exact
 * root(s)/pattern searched. No silent no-op (mirrors extract-stf-fixtures.cjs's own contract).
 *
 * Usage: node scripts/extract-ilf-fixtures.cjs
 *        (optionally: SWG_ILF_FIXTURE_CLIENT_ROOT=<path> node scripts/extract-ilf-fixtures.cjs)
 */

'use strict';
const nativeCore = require('../../native-core/index.js');
const fs = require('fs');
const path = require('path');

const CANDIDATE_ROOTS = process.env['SWG_ILF_FIXTURE_CLIENT_ROOT']
  ? [process.env['SWG_ILF_FIXTURE_CLIENT_ROOT']]
  : ['D:/SWG Infinity/SWG Infinity/Live', 'D:/SWGEmu Client/SWGEmu'];

const OUT_DIR = path.join(__dirname, '../fixtures-real/ilf');
const VFS_PREFIX = 'interiorlayout/';

function fail(message) {
  console.error(`[extract-ilf-fixtures] ERROR: ${message}`);
  console.error(`[extract-ilf-fixtures] Client root(s) searched: ${CANDIDATE_ROOTS.join(', ')}`);
  console.error(`[extract-ilf-fixtures] VFS pattern searched: ${VFS_PREFIX}*.ilf`);
  process.exit(1);
}

// ─── Structural sanity check (mirrors ilf.ts's own FORM/INLY/0000 tag layout, without importing
//      the TS parser — this script is CJS) ──────────────────────────────────────────────────────
function looksLikeIlf(bytes) {
  if (bytes.length < 24) return false;
  const tag = (off) => Buffer.from(bytes.buffer, bytes.byteOffset + off, 4).toString('ascii');
  return tag(0) === 'FORM' && tag(8) === 'INLY' && tag(12) === 'FORM' && tag(20) === '0000';
}

// ─── Resolve a usable client root — a missing candidate is skipped silently, never an error on
//      its own (ROUND 3, R13: the SWGEmu fallback does not exist on this machine) ────────────────
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

console.log(`[extract-ilf-fixtures] Mounting ${treFiles.length} TRE archives from ${clientRoot}...`);
const priorities = treFiles.map((_, i) => i);
const handle = nativeCore.mountTreMount(treFiles, priorities);
console.log('[extract-ilf-fixtures] Mounted.');

// ─── Find interiorlayout/*.ilf candidates via listMountEntries (has real paths;
//      searchMount() hits do not — T-01-06) ────────────────────────────────────
const allEntries = nativeCore.listMountEntries(handle);
const candidates = allEntries.filter(
  (e) => !e.isTombstone && e.path.startsWith(VFS_PREFIX) && e.path.endsWith('.ilf'),
);
console.log(`[extract-ilf-fixtures] Found ${candidates.length} entries matching "${VFS_PREFIX}*.ilf".`);

if (candidates.length === 0) {
  nativeCore.disposeTreMount(handle);
  fail(`No entries found under VFS prefix "${VFS_PREFIX}" ending ".ilf".`);
}

// ─── Pick the first candidate that resolves + passes the structural sanity check ──────────────
fs.mkdirSync(OUT_DIR, { recursive: true });

let picked = null;
let tried = 0;
for (const entry of candidates) {
  tried++;
  try {
    const r = nativeCore.resolveEntry(handle, entry.path);
    if (!r.winner || r.archiveIndex < 0 || r.entryIndex < 0) continue;

    const bytes = new Uint8Array(nativeCore.readMountEntry(handle, r.archiveIndex, r.entryIndex));
    if (!looksLikeIlf(bytes)) continue;

    picked = { path: entry.path, bytes };
    break;
  } catch (e) {
    // Not a resolvable/readable entry — skip.
  }
}

if (!picked) {
  nativeCore.disposeTreMount(handle);
  fail(
    `Checked ${tried} candidate(s) under "${VFS_PREFIX}*.ilf" but none passed the structural ` +
    `FORM/INLY/0000 sanity check — the interior-layout fixture could not be extracted.`,
  );
}

const outName = path.basename(picked.path);
const outPath = path.join(OUT_DIR, outName);
fs.writeFileSync(outPath, Buffer.from(picked.bytes));
console.log(
  `[extract-ilf-fixtures] ILF: ${picked.path} -> ${outPath} (bytes=${picked.bytes.length})`,
);

nativeCore.disposeTreMount(handle);

console.log(`\n[extract-ilf-fixtures] Done. Extracted "${outName}" from ${tried} candidate(s) checked.`);
console.log(
  `[extract-ilf-fixtures] The ilf-roundtrip.test.ts real-asset lane loads the first ` +
  `"*.ilf" file it finds under "fixtures-real/ilf/" — re-run this script (it always picks the ` +
  `first-listed interiorlayout/*.ilf entry via listMountEntries' order) if you need a different fixture.`,
);
