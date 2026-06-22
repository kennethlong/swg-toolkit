#!/usr/bin/env node
// scripts/check-prereqs.js — Preflight check for cmake + MSVC + Node version
// Run via: node scripts/check-prereqs.js  OR  pnpm prereqs
// Also invoked by the "preinstall" script (warn-only: exits 0 to allow install to proceed)
// Exit code: 0 if cmake + MSVC present (Node mismatch is a warning, not a hard fail)
//            non-zero if cmake or MSVC is missing

'use strict';

const { execSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

let failed = false;

// ─── Helper: run a command and return its stdout, or null on failure ───────────
function tryRun(cmd, args = []) {
  const result = spawnSync(cmd, args, { encoding: 'utf8', timeout: 10000 });
  if (result.error || result.status !== 0) return null;
  return (result.stdout || '').trim();
}

// ─── 1. Check cmake >= 3.15 ────────────────────────────────────────────────────
console.log('Checking cmake...');
const cmakeOutput = tryRun('cmake', ['--version']);
if (!cmakeOutput) {
  console.error(
    '  [FAIL] cmake not found or not in PATH.\n' +
    '         Install cmake >= 3.15 from https://cmake.org/download/ or:\n' +
    '           winget install Kitware.CMake\n' +
    '         Then ensure cmake is in your PATH.'
  );
  failed = true;
} else {
  // Parse version: "cmake version X.Y.Z"
  const match = cmakeOutput.match(/cmake version (\d+)\.(\d+)\.(\d+)/i);
  if (!match) {
    console.warn('  [WARN] Could not parse cmake version from output:', cmakeOutput.split('\n')[0]);
    // Don't fail — cmake may be present but have different output format
  } else {
    const major = parseInt(match[1], 10);
    const minor = parseInt(match[2], 10);
    const patch = parseInt(match[3], 10);
    const versionStr = `${major}.${minor}.${patch}`;
    const meetsMinimum = major > 3 || (major === 3 && minor >= 15);
    if (!meetsMinimum) {
      console.error(
        `  [FAIL] cmake ${versionStr} is too old — need >= 3.15.\n` +
        `         Install a newer version from https://cmake.org/download/`
      );
      failed = true;
    } else {
      console.log(`  [OK]   cmake ${versionStr} found.`);
    }
  }
}

// ─── 2. On win32: check for MSVC C++ toolset ──────────────────────────────────
if (os.platform() === 'win32') {
  console.log('Checking MSVC C++ toolset (Windows)...');
  let msvcFound = false;
  let msvcVersion = 'unknown';

  // Method 1: check for cl.exe via "where cl"
  const clResult = tryRun('where', ['cl']);
  if (clResult) {
    // Try to determine if it's v143 (VS2022) or v145 (VS2022 17.10+)
    // cmake-js uses whatever MSVC is active; we just confirm presence
    // Check the path for VS version hints
    if (clResult.includes('2022') || clResult.toLowerCase().includes('v143') || clResult.toLowerCase().includes('v145')) {
      msvcVersion = clResult.includes('v145') ? 'v145 (VS2022 17.10+)' : 'v143 (VS2022)';
    } else if (clResult.includes('2019') || clResult.toLowerCase().includes('v142')) {
      msvcVersion = 'v142 (VS2019)';
    } else if (clResult.includes('2017') || clResult.toLowerCase().includes('v141')) {
      msvcVersion = 'v141 (VS2017)';
    } else {
      msvcVersion = 'detected (version unknown from path)';
    }
    msvcFound = true;
  }

  // Method 2: check vswhere for any C++ workload
  if (!msvcFound) {
    const vswherePaths = [
      'C:\\Program Files (x86)\\Microsoft Visual Studio\\Installer\\vswhere.exe',
      'C:\\Program Files\\Microsoft Visual Studio\\Installer\\vswhere.exe',
    ];
    for (const vswhereExe of vswherePaths) {
      if (fs.existsSync(vswhereExe)) {
        const vswhereResult = tryRun(vswhereExe, [
          '-latest',
          '-requires', 'Microsoft.VisualCpp.Tools.HostX64.TargetX64',
          '-property', 'installationVersion',
        ]);
        if (vswhereResult) {
          // Parse VS installation version to toolset version
          const vsMajor = parseInt(vswhereResult.split('.')[0], 10);
          if (vsMajor >= 17) {
            // VS2022: check for v145 (17.10+) vs v143
            const minor = parseInt(vswhereResult.split('.')[1] || '0', 10);
            msvcVersion = minor >= 10 ? 'v145 (VS2022 17.10+)' : 'v143 (VS2022)';
          } else if (vsMajor === 16) {
            msvcVersion = 'v142 (VS2019)';
          } else {
            msvcVersion = `VS${vsMajor} (unknown toolset)`;
          }
          msvcFound = true;
          break;
        }
      }
    }
  }

  // Method 3: check for known VS Build Tools install locations
  if (!msvcFound) {
    const vsDirs = [
      'C:\\Program Files\\Microsoft Visual Studio\\2022',
      'C:\\Program Files (x86)\\Microsoft Visual Studio\\2022',
      'C:\\Program Files\\Microsoft Visual Studio\\2019',
      'C:\\Program Files (x86)\\Microsoft Visual Studio\\2019',
    ];
    for (const vsDir of vsDirs) {
      if (fs.existsSync(vsDir)) {
        msvcFound = true;
        msvcVersion = vsDir.includes('2022') ? 'v143/v145 (VS2022 dir found)' : 'v142 (VS2019 dir found)';
        break;
      }
    }
  }

  if (!msvcFound) {
    console.error(
      '  [FAIL] MSVC C++ build tools not found.\n' +
      '         Install Visual Studio 2022 Build Tools with the\n' +
      '         "Desktop development with C++" workload:\n' +
      '           https://visualstudio.microsoft.com/visual-cpp-build-tools/\n' +
      '         OR install the full Visual Studio 2022 Community edition.\n' +
      '         Note: cmake-js uses whatever MSVC toolset is active (v143 or v145 both work).'
    );
    failed = true;
  } else {
    console.log(`  [OK]   MSVC toolset found: ${msvcVersion}`);
  }
} else {
  console.log('  [SKIP] MSVC check not applicable on non-Windows platform.');
}

// ─── 3. Check Node.js version matches engines.node ───────────────────────────
console.log('Checking Node.js version...');
const nvmrcPath = path.join(__dirname, '..', '.nvmrc');
const pkgPath = path.join(__dirname, '..', 'package.json');

let expectedNode = null;
try {
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  expectedNode = (pkg.engines && pkg.engines.node) || null;
} catch (_) {}

let nvmrcNode = null;
try {
  nvmrcNode = fs.readFileSync(nvmrcPath, 'utf8').trim();
} catch (_) {}

const currentNodeVersion = process.version; // e.g. "v24.15.0"
const currentMajor = parseInt(currentNodeVersion.replace('v', '').split('.')[0], 10);
const expectedMajor = nvmrcNode ? parseInt(nvmrcNode.split('.')[0], 10) : null;

if (expectedMajor !== null && currentMajor !== expectedMajor) {
  console.warn(
    `  [WARN] Node.js version mismatch.\n` +
    `         Running:  ${currentNodeVersion}\n` +
    `         Expected: v${nvmrcNode || 'unknown'} (from .nvmrc)\n` +
    `         Engines:  ${expectedNode || 'not set'} (from package.json)\n` +
    `         This is a WARNING, not a hard failure — vitest runs on bare Node.\n` +
    `         The single N-API prebuild (--napi) is ABI-stable across Node + Electron.\n` +
    `         To switch: use nvm or fnm: nvm use ${nvmrcNode}`
  );
} else if (expectedMajor !== null) {
  console.log(`  [OK]   Node.js ${currentNodeVersion} matches .nvmrc (${nvmrcNode}).`);
} else {
  console.log(`  [OK]   Node.js ${currentNodeVersion} (no .nvmrc to compare against).`);
}

// ─── Result ──────────────────────────────────────────────────────────────────
if (failed) {
  console.error('\n[PREREQ FAIL] One or more prerequisites are missing. See above for fix instructions.');
  process.exit(1);
} else {
  console.log('\n[PREREQ OK] All required prerequisites are present.');
  process.exit(0);
}
