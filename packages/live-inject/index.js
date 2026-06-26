/**
 * index.js — native addon entry point for @swg/live-inject.
 *
 * Without this file, `require('@swg/live-inject')` (used by the renderer's
 * useLiveService.ts, Path B) fails to resolve and the entire live panel is dead
 * even though the UI buttons are wired. Mirrors @swg/native-core/index.js.
 *
 * Uses node-gyp-build as the single source-of-truth resolver:
 *   1. prebuilds/<platform>-<arch>/@swg+live-inject.node  (--napi named artifact)
 *   2. build/Release/swg_live_inject.node                  (cmake-js dev-tree fallback)
 *
 * Pure N-API addon (NODE_API_MODULE, --napi prebuild) → ONE artifact is ABI-stable
 * across Node AND Electron; the same binary vitest resolves loads under Electron.
 *
 * PACKAGED BUILD: when loaded from resources/ (extraResource), node-gyp-build may
 * be unavailable — fall back to a direct require() of the known prebuilds/ path.
 */

'use strict';

const path = require('node:path');
const os = require('node:os');

// Direct prebuild loader — used when node-gyp-build is not available (packaged).
// --napi artifact filename convention: @swg/live-inject → @swg+live-inject.node
function loadDirect(dir) {
  const prebuiltPath = path.join(
    dir, 'prebuilds', os.platform() + '-' + os.arch(), '@swg+live-inject.node',
  );
  const addon = require(prebuiltPath);
  addon.__resolvedPath = prebuiltPath;
  return addon;
}

let addon;

try {
  const nodeGypBuild = require('node-gyp-build');

  let resolvedPath;
  try {
    resolvedPath = nodeGypBuild.resolve(__dirname);
  } catch (_e) {
    resolvedPath = '<unresolved>';
  }

  addon = nodeGypBuild(__dirname);
  addon.__resolvedPath = resolvedPath;
} catch (_ngbErr) {
  try {
    addon = loadDirect(__dirname);
  } catch (directErr) {
    throw new Error(
      'Failed to load @swg/live-inject:\n' +
      '  node-gyp-build: not available (packaged extraResource)\n' +
      '  direct prebuilds/ load: ' + directErr.message + '\n' +
      '  __dirname: ' + __dirname,
    );
  }
}

module.exports = addon;
