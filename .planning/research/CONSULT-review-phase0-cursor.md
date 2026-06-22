… (base context is in .planning/research/CONSULT-review-phase0-base.md in this same repo — read it first)

# YOUR ANGLE (Cursor): ground-truth verification of API signatures, version pins & framework behavior

You are the detailed code reader / fact-checker. The plans were derived from an AI-generated research
doc that frequently fabricates version numbers and API details. Your job is to VERIFY the concrete
technical claims against reality — npm, the actual library APIs, Electron/Node docs, and the sibling
reference projects. Do NOT review project structure or scope; verify facts.

Check each of these claims and mark VERIFIED / WRONG / UNVERIFIABLE with evidence:

1. **Version pins exist and are mutually compatible** (today is 2026-06-21). Are these real published
   versions? Electron 42.4.1, React 19.2.x, TypeScript 6.0.3, pnpm 11.8.0, @electron-forge/* 7.11.2,
   @electron-forge/plugin-vite 7.11.2, @electron-forge/plugin-auto-unpack-natives 7.11.2,
   dockview / dockview-react 6.6.1, zustand 5.0.14, tailwindcss 4.3.1, @tailwindcss/vite 4.3.1,
   vitest 4.1.9, @playwright/test 1.61.0, node-addon-api 8. Flag any that look fabricated or that pin a
   version that doesn't exist / isn't compatible with the others (e.g. TS major, Electron major↔Node ABI).

2. **`Napi::SharedArrayBuffer::New(env, byteLength)`** (00-02). Does node-addon-api 8 actually expose a
   `SharedArrayBuffer` C++ wrapper class with a `::New(env, size_t)` overload? Is it stable at NAPI_VERSION=8,
   or does it require `NAPI_EXPERIMENTAL`? The plan asserts it does NOT need NAPI_EXPERIMENTAL — verify.
   Check node-addon-api headers (in node_modules once installed, or upstream on GitHub).

3. **SAB transfer semantics** (00-03). The plan transfers a SharedArrayBuffer from a utility process to
   the renderer via `MessageChannelMain` / `win.webContents.postMessage('sab-port', {sab}, [port1])`.
   Verify: (a) `utilityProcess.fork` + `MessageChannelMain` is the correct Electron API set; (b) a
   SharedArrayBuffer survives this hop and stays *shared* (zero-copy) rather than being structured-cloned
   into a copy; (c) whether putting a SAB *inside* a plain object payload (`{sab}`) keeps it shared, and
   whether it should be in the transfer list or not (SABs are shared, not transferred). This is the core
   D-04 proof — if the mechanism actually copies, the "zero-copy round-trip" claim is false.

4. **COOP/COEP in the packaged build** (00-03 / 00-05). The plan relies on `session.webRequest.
   onHeadersReceived` to inject COOP/COEP. Verify this fires for `file://` loads in a packaged Forge app
   (not just the dev server). Is `onHeadersReceived` invoked for file:// protocol responses, or is a
   `protocol.handle` interceptor required? 00-05 flags this as MEDIUM-confidence — confirm or refute.

5. **cmake-js on Windows / MSVC v145.** Is "MSVC v145" the correct toolset id for VS 2022 Build Tools
   (v143 is VS2022; v145 would be a newer toolset)? Verify the toolset version claim. Also confirm
   `CMAKE_JS_INC` / `CMAKE_JS_LIB` / `CMAKE_JS_SRC` are the correct cmake-js-provided variables and that
   the requirements doc's "prebuildify distribution" (FND-02) is consistent with a cmake-js build (the
   plans use cmake-js but never mention prebuildify — note the gap).

6. **dockview API** (00-04): `DockviewReact`, `event.api.fromJSON/toJSON/onDidLayoutChange` — verify these
   are the real dockview-react 6.x APIs and that `addPanel` with the described positions is correct.

Output the 5-section format from the base file, but lead Concerns with anything you found WRONG or
UNVERIFIABLE — a fabricated API signature or version pin here is a HIGH severity blocker.
