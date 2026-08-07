/**
 * list-interiors.cjs — which building templates actually ship an interior layout?
 *
 * Step 11 needs TWO instances of ONE building template that are both enterable and carry
 * arm-able decorations. `.ilf` files are named after the PORTAL LAYOUT (.pob), not the building
 * template — e.g. building `shared_cantina_tatooine.iff` uses `shared_cantina_mos_eisley_tatooine.ilf`
 * — so this prints the real `interiorlayout/` inventory and greps it for our candidates rather
 * than assuming the names line up.
 */
'use strict';
const nativeCore = require('../../native-core/index.js');
const fs = require('fs');
const path = require('path');

const root = process.env['SWG_CLIENT_ROOT'] ?? 'D:/Code/swg-client-v2/stage';
let treFiles = [];
for (const dir of [root, 'D:/SWG Infinity/SWG Infinity/Live']) {
  if (!fs.existsSync(dir)) continue;
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.tre')).map((f) => path.join(dir, f));
  if (files.length > 0) { treFiles = files; console.log(`root: ${dir} (${files.length} .tre)`); break; }
}
if (!treFiles.length) { console.error('no .tre archives found'); process.exit(1); }

const handle = nativeCore.mountTreMount(treFiles, treFiles.map((_, i) => i));
const all = nativeCore.listMountEntries(handle);
const ilfs = all
  .filter((e) => !e.isTombstone && e.path.startsWith('interiorlayout/') && e.path.endsWith('.ilf'))
  .map((e) => e.path.replace('interiorlayout/', '').replace('.ilf', ''));

console.log(`total interiorlayout/*.ilf entries: ${ilfs.length}\n`);

const probes = ['cantina', 'cloning', 'bank', 'shuttleport', 'starport', 'hospital',
                'guild_commerce', 'guild_combat', 'parking_garage', 'housing_tatt', 'filler'];
for (const p of probes) {
  const hits = ilfs.filter((n) => n.includes(p)).sort();
  console.log(`${p.padEnd(16)} ${String(hits.length).padStart(3)}  ${hits.slice(0, 4).join(', ')}${hits.length > 4 ? ' …' : ''}`);
}
nativeCore.disposeTreMount(handle);
