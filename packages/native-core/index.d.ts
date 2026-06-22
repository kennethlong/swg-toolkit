/**
 * index.d.ts — TypeScript type declarations for the @swg/native-core addon.
 *
 * These types match the exports registered in addon.cpp:
 *   exports.Set("hello",       ...) → hello(): string
 *   exports.Set("allocateSab", ...) → allocateSab(byteLength: number): SharedArrayBuffer
 *
 * Consumed by:
 *   - packages/backend/src/utility-worker.ts (via require('@swg/native-core'))
 *   - Vitest unit tests in packages/native-core/test/hello.test.ts
 */

/**
 * Returns the string "pong". Proves the C++ → N-API → JS call chain works.
 */
export function hello(): string;

/**
 * Allocates a new SharedArrayBuffer of the given byte length in C++ and
 * returns it to JavaScript. The allocation is owned by the Node.js heap.
 *
 * @param byteLength - Number of bytes to allocate. Zero is allowed (edge case).
 * @returns A SharedArrayBuffer of exactly byteLength bytes.
 *
 * Note: Requires NAPI_EXPERIMENTAL compile def (Napi::SharedArrayBuffer is
 * experimental-gated in node-addon-api >= 8.6.0; see CMakeLists.txt).
 */
export function allocateSab(byteLength: number): SharedArrayBuffer;

/**
 * Resolved path of the .node file that was loaded by node-gyp-build.
 * Set by index.js via require('node-gyp-build').resolve(__dirname).
 * Used by resolve-prebuild.test.ts to assert non-circular FND-02 proof.
 */
export const __resolvedPath: string;
