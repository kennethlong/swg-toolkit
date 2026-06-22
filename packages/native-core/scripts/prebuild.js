/**
 * scripts/prebuild.js — FND-02 "no-compiler distribution" prebuild script.
 *
 * Copies the cmake-js build output (build/Release/swg_native_core.node) into the
 * node-gyp-build prebuilds/ layout so that users without a compiler can load the addon
 * via require('@swg/native-core') → index.js → node-gyp-build → prebuilds/ (no build step).
 *
 * Naming convention (from prebuildify source):
 *   prebuilds/<platform>-<arch>/@swg+native-core.node
 *   where '/' in package name is replaced by '+' (encodeName function in prebuildify).
 *
 * Design note (round-3 / Cursor CUR-2): prebuildify drives node-gyp, NOT cmake-js, so
 * "prebuildify with the cmake-js backend" would be a backend mismatch that may not work.
 * This script avoids that problem by: building with cmake-js (Task 2, already done), then
 * placing the emitted .node into the exact prebuilds/ layout that node-gyp-build resolves.
 * node-gyp-build remains the SINGLE resolver (index.js). This is the concrete, verifiable
 * default. The copy step is the entire mechanism — no second resolver.
 *
 * ABI stability note (round-3 / Cursor CUR-1): this is a PURE N-API addon, so ONE
 * prebuilds/ artifact is ABI-stable across Node AND Electron. The vitest suite and
 * Electron's utility process both load the same file. No separate Electron-ABI build.
 *
 * Usage: node scripts/prebuild.js (runs cmake-js build output into prebuilds/)
 *        Called by the "prebuild" npm script in package.json.
 *        Prerequisite: cmake-js build must have already run (produces build/Release/*.node).
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const packageDir = path.resolve(__dirname, '..');
const platform = process.platform;   // e.g. 'win32'
const arch = process.arch;           // e.g. 'x64'

// Source: cmake-js build output
const sourceNode = path.join(packageDir, 'build', 'Release', 'swg_native_core.node');

// Destination: prebuilds/<platform>-<arch>/@swg+native-core.node
// '@swg/native-core' → '@swg+native-core' (node-gyp-build/prebuildify convention)
const prebuildDir = path.join(packageDir, 'prebuilds', `${platform}-${arch}`);
const destNode = path.join(prebuildDir, '@swg+native-core.node');

// Verify source exists
if (!fs.existsSync(sourceNode)) {
  console.error(`[prebuild] ERROR: cmake-js build output not found: ${sourceNode}`);
  console.error('[prebuild] Run the cmake-js build first: pnpm --filter @swg/native-core exec cmake-js build');
  process.exit(1);
}

// Create destination directory
fs.mkdirSync(prebuildDir, { recursive: true });

// Copy the .node file into the prebuilds/ layout
fs.copyFileSync(sourceNode, destNode);

console.log(`[prebuild] OK: copied ${path.basename(sourceNode)} → prebuilds/${platform}-${arch}/@swg+native-core.node`);
console.log(`[prebuild] node-gyp-build will resolve: ${destNode}`);
console.log(`[prebuild] ABI stability: pure N-API (NAPI_VERSION=8) — one artifact for Node + Electron`);
