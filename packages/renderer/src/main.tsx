/**
 * packages/renderer/src/main.tsx
 * Phase 0 Plan 03 — minimal proof entry for Path B (native-in-renderer zero-copy).
 *
 * POSTURE (fallback B — nodeIntegration:true, contextIsolation:false):
 *   The preferred posture (contextBridge) failed: contextBridge cannot transfer a C++
 *   SharedArrayBuffer across isolated-world boundaries (structured-clone throws). In the
 *   fallback posture, the renderer has Node and requires the addon directly — no IPC,
 *   no bridge, no clone. The SAB is allocated in the renderer's own process cluster.
 *
 * NOTE: This is the Phase-0 proof entry ONLY. Plan 00-04 (dark dockable React shell)
 * will replace this with the real React app shell. The window.__* hooks set here are
 * consumed by 00-05's E2E spec (03-sab-roundtrip.spec.ts).
 *
 * PROOF SEQUENCE (bidirectional same-memory):
 *   1. allocateSab(8)            → assert instanceof SharedArrayBuffer (in-process alloc)
 *   2. writeSab(sab, 0, 0xDEAD) → C++ writes sentinel; renderer reads it  (C++ → JS)
 *   3. Int32Array(sab)[1] = nonce → renderer writes nonce
 *      readSab(sab, 1) === nonce  → C++ reads it back                      (JS → C++)
 *   4. new Worker(workerUrl)     → worker reads Int32Array(sab)[0]          (intra-cluster)
 *
 * WINDOW TEST HOOKS (for 00-05 E2E):
 *   window.__transport        = 'B-native-in-renderer'
 *   window.__zeroCopy         = true
 *   window.__sabIsShared      = true  (set after worker confirms it reads the same value)
 *   window.__sabValue         = 0xDEAD (the C++-written sentinel value)
 *   window.__crossWriteOk     = true  (C++ readSab saw the renderer-written nonce)
 *   window.__posture          = 'fallback: nodeIntegration=true, contextIsolation=false'
 */

// With nodeIntegration:true the renderer has Node — require the addon directly.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const nativeCore = require('@swg/native-core') as {
  hello: () => string;
  allocateSab: (byteLength: number) => SharedArrayBuffer;
  writeSab: (sab: SharedArrayBuffer, int32Index: number, value: number) => void;
  readSab: (sab: SharedArrayBuffer, int32Index: number) => number;
};

// Set transport marker immediately
window.__transport = 'B-native-in-renderer';
window.__zeroCopy = true;
window.__posture = 'fallback: nodeIntegration=true, contextIsolation=false';
window.__proofLog = [];

function log(msg: string): void {
  console.log('[proof] ' + msg);
  window.__proofLog.push(msg);
  const el = document.getElementById('proof-log');
  if (el) {
    el.textContent += msg + '\n';
  }
}

async function runProof(): Promise<void> {
  log('--- Path B bidirectional same-memory proof ---');
  log('crossOriginIsolated=' + self.crossOriginIsolated);
  log('posture=' + window.__posture);

  // ── STEP 0: hello() round-trip ─────────────────────────────────────────────
  const helloResult = nativeCore.hello();
  if (helloResult === 'pong') {
    log('PASS: nativeCore.hello()=' + JSON.stringify(helloResult));
  } else {
    log('FAIL: nativeCore.hello() returned ' + JSON.stringify(helloResult));
    return;
  }

  // ── STEP 1: allocateSab ────────────────────────────────────────────────────
  const sab = nativeCore.allocateSab(8);
  if (!(sab instanceof SharedArrayBuffer)) {
    log('FAIL: allocateSab did not return a SharedArrayBuffer (got ' + typeof sab + ')');
    return;
  }
  log('PASS: allocateSab(8) instanceof SharedArrayBuffer, byteLength=' + sab.byteLength);

  const view = new Int32Array(sab);

  // ── STEP 2: C++ writes 0xDEAD → renderer reads it (C++ → JS direction) ───
  nativeCore.writeSab(sab, 0, 0xDEAD);
  const readBack = view[0];
  if (readBack === 0xDEAD) {
    log('PASS: C++ writeSab(sab,0,0xDEAD) → Int32Array(sab)[0]=0x' + readBack.toString(16).toUpperCase() + ' (C++ → JS same memory)');
    window.__sabValue = readBack;
  } else {
    log('FAIL: C++ writeSab wrote 0xDEAD but renderer sees ' + readBack);
    return;
  }

  // ── STEP 3: Renderer writes nonce → C++ reads it back (JS → C++ direction) ─
  const nonce = Math.floor(Math.random() * 0x7FFFFFFF) + 1;
  view[1] = nonce;
  const observed = nativeCore.readSab(sab, 1);
  if (observed === nonce) {
    log('PASS: Renderer wrote nonce=' + nonce + ' → C++ readSab(sab,1)=' + observed + ' (JS → C++ same memory)');
    window.__crossWriteOk = true;
  } else {
    log('FAIL: Renderer wrote nonce=' + nonce + ' but C++ readSab returned ' + observed);
    window.__crossWriteOk = false;
    return;
  }

  // ── STEP 4: Share SAB with a Web Worker ────────────────────────────────────
  // The worker reads Int32Array(sab)[0] and posts the value back.
  // If it matches 0xDEAD, the SAB is shared within the renderer cluster (intra-cluster).
  try {
    const workerSrc = `
      self.onmessage = function(e) {
        const sab = e.data;
        const view = new Int32Array(sab);
        const val = view[0];
        self.postMessage({ val: val });
      };
    `;
    const blob = new Blob([workerSrc], { type: 'text/javascript' });
    const workerUrl = URL.createObjectURL(blob);
    const worker = new Worker(workerUrl);

    const workerResult = await new Promise<number>((resolve, reject) => {
      worker.onmessage = (e: MessageEvent<{ val: number }>) => resolve(e.data.val);
      worker.onerror = (err) => reject(new Error('Worker error: ' + err.message));
      worker.postMessage(sab);
    });

    URL.revokeObjectURL(workerUrl);

    if (workerResult === 0xDEAD) {
      log('PASS: Worker sees Int32Array(sab)[0]=0x' + workerResult.toString(16).toUpperCase() + ' (intra-cluster SAB share)');
      window.__sabIsShared = true;
    } else {
      log('FAIL: Worker sees ' + workerResult + ' but expected 0xDEAD');
      window.__sabIsShared = false;
    }
  } catch (err) {
    log('FAIL: Worker share threw: ' + String(err));
    window.__sabIsShared = false;
  }

  // ── SUMMARY ────────────────────────────────────────────────────────────────
  const allPass = window.__sabValue === 0xDEAD && window.__crossWriteOk && window.__sabIsShared;
  if (allPass) {
    log('=== ALL PROOF ASSERTIONS PASSED — Path B zero-copy confirmed ===');
    log('transport=' + window.__transport);
    log('zeroCopy=' + window.__zeroCopy);
    log('sabValue=0x' + window.__sabValue.toString(16));
    log('crossWriteOk=' + window.__crossWriteOk);
    log('sabIsShared=' + window.__sabIsShared);
    log('posture=' + window.__posture);
  } else {
    log('=== ONE OR MORE ASSERTIONS FAILED — see above ===');
  }

  // Update the DOM result indicator
  const result = document.getElementById('proof-result');
  if (result) {
    result.textContent = allPass ? 'ALL PASSED' : 'FAILED';
    result.style.color = allPass ? '#00ff88' : '#ff4444';
  }
}

// Run proof when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => void runProof());
} else {
  void runProof();
}

// Type declarations for window test hooks
declare global {
  interface Window {
    __transport: string;
    __zeroCopy: boolean;
    __sabIsShared: boolean;
    __sabValue: number;
    __crossWriteOk: boolean;
    __posture: string;
    __proofLog: string[];
  }
}
