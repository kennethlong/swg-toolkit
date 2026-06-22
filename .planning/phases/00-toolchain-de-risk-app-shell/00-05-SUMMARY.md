# 00-05 SUMMARY — E2E suite + packaged HARD gate + Nyquist sign-off (Path B)

**Plan:** 00-05 · **Requirements:** FND-01..05 · **Status:** complete · **Date:** 2026-06-22

## What was built

Five Playwright + Electron E2E specs verifying all Phase 0 success criteria against the **as-built
Path B** architecture (native-in-renderer, in-process zero-copy), plus the packaged HARD gate and an
independent Nyquist sign-off. The boot/isolation specs were **inverted** from the original (falsified)
cross-process model to the real posture.

| Spec | Asserts | Result |
|---|---|---|
| `01-boot.spec.ts` | AS-BUILT Path B posture: `contextIsolation===false`, `nodeIntegration===true`, `sandbox===false`, `window.require` is a function, `hello()`='pong' (deliberate tradeoff, FND-01 revised) | ✅ |
| `02-isolation.spec.ts` | `crossOriginIsolated===true`; `new SharedArrayBuffer(4)` does not throw | ✅ |
| `03-sab-roundtrip.spec.ts` | in-process proof via StatusBar hooks: `__sabValue===57005`, `__sabIsShared`, `__crossWriteOk`, `__crossWriteState==='shared'`, `__zeroCopy`; contracts `tsc` (FND-04) | ✅ |
| `04-workspace.spec.ts` | 4 panels; layout/theme in localStorage; **REAL close + relaunch** persistence against the real `app.getPath('userData')` (SC-5) | ✅ |
| `05-packaged.spec.ts` | **HARD gate** — packaged binary: COI=true, 0xDEAD sentinel, nonce round-trip ok, state=shared, `--napi` prebuild RUNTIME-LOADED in the packaged renderer (FND-02) | ✅ 7/7 |

Independently re-verified by the orchestrator: dev suite green; the packaged binary's zero-copy proof
observed directly in the real `out/swg-toolkit-win32-x64/swg-toolkit.exe`.

## Packaged HARD gate — harness rewrite (the key fix)

The first implementation drove the packaged gate with Playwright `_electron.launch({ executablePath })`
(then `chromium.connectOverCDP`). Both **hang intermittently** attaching to the *packaged* Electron app
on Windows — verified 30–180s timeouts across repeated clean runs; the reported "7/7" was **not
reproducible**. The packaged app itself is fine (it boots and proves zero-copy when launched directly).

**Fix:** rewrote `05-packaged.spec.ts` to OBSERVE the real binary instead of attaching CDP — run it with
`ELECTRON_ENABLE_LOGGING=1`, capture stdout/stderr, and assert the StatusBar's in-process Path B proof
markers (`crossOriginIsolated=true`, `view[0]=0xDEAD`, `nonce round-trip … ok=true`, `state=shared`,
the `PASS` line). Now **reliably 7/7 in ~1.4s**, with the Electron helper process tree killed (no leaks).

## Other test-harness corrections
- `e2e/01-04`: removed the invalid `test.beforeAll(fn, timeout)` arg (timeout is set by
  `describe.configure` + the global config) and cast `getLastWebPreferences()` — **e2e `tsc` now 0 errors**.
- `playwright.config.ts`: `retries: 2` to absorb `_electron.launch` launch flakiness in the dev specs
  (infrastructure flakiness under sequential contention — not a product defect; each spec passes in
  isolation). The log-capture packaged gate does NOT flake, so retries never mask a real gate failure.

## Nyquist sign-off — signoff-pass

`nyquist_compliant: true` (see `00-VALIDATION.md` § Sign-off notes). Certifies EXACTLY: FND-02
non-circular resolution (00-02) + packaged-Electron RUNTIME LOAD of the single ABI-stable `--napi`
prebuild **in the renderer** (Path B) — NOT a full no-compiler proof, NOT a separate Electron-ABI build,
NOT cross-process SAB (proven impossible — `CONSULT-P0SAB-SYNTHESIS.md`).

## Self-Check: PASSED
All five success criteria proven and independently re-verified; packaged hard gate reliable; e2e tsc clean.
