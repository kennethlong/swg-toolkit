/**
 * index.js — FND-02 no-compiler distribution resolver.
 *
 * Uses node-gyp-build as the single source-of-truth resolver for the native addon.
 * Resolution order (node-gyp-build 4.x):
 *   1. prebuilds/<platform>-<arch>/@swg+native-core.node  (--napi named artifact)
 *   2. build/Release/swg_native_core.node                  (cmake-js dev-tree fallback)
 *
 * Because this is a pure N-API addon (NODE_API_MODULE + NAPI_VERSION=8 + --napi prebuild),
 * ONE prebuilds/ artifact is ABI-stable across Node AND Electron — the same binary that
 * vitest resolves also loads under Electron's utility process. There is NO separate
 * Electron-ABI build (round-3 / Cursor CUR-1). The packaged-Electron RUNTIME LOAD of
 * that one artifact is proven by Plan 05's packaged hard gate.
 *
 * __resolvedPath: exposes the absolute path of the .node file chosen by node-gyp-build.
 * Used by resolve-prebuild.test.ts to assert the non-circular FND-02 proof (build/ moved
 * aside, loaded from prebuilds/, __resolvedPath contains 'prebuilds' — review fix HIGH-1).
 *
 * Anti-pattern: NO second resolution mechanism. node-gyp-build is the one and only resolver.
 * The prebuilds/ layout is populated by the "prebuild" script in package.json (which copies
 * the cmake-js build output into the --napi named directory), not by prebuildify driving cmake-js
 * (round-3 / Cursor CUR-2: prebuildify drives node-gyp, not cmake-js — potential backend mismatch).
 */

'use strict';

const nodeGypBuild = require('node-gyp-build');

// Resolve the .node file path — node-gyp-build exposes a .resolve() method that
// returns the chosen absolute path without actually loading the module.
let resolvedPath;
try {
  resolvedPath = nodeGypBuild.resolve(__dirname);
} catch (_e) {
  resolvedPath = '<unresolved>';
}

// Load the addon through the single resolver
const addon = nodeGypBuild(__dirname);

// Expose the resolved path for the non-circular proof test
addon.__resolvedPath = resolvedPath;

module.exports = addon;
