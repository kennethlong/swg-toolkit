---
id: cfg-duplicate-sharedfile-header
title: swgtoolkit.cfg gets a duplicate [SharedFile] header on deploy
created: 2026-06-27
origin: Maintainer UAT — disk check after a successful deploy
severity: low (cosmetic; client tolerates it, searchTree still resolves)
area: renderer / DeployDialog + cfgActivator (swgtoolkit.cfg creation)
status: pending
---

## Symptom

After a successful patch-prepend deploy, `swgtoolkit.cfg` contains TWO `[SharedFile]` headers:
```
[SharedFile]
[SharedFile]
	searchTree_00_26=swgtoolkit_SWGEmu_eafd.tre
```

## Cause

`DeployDialog` step 2 creates the file with `[SharedFile]\r\n` when it doesn't exist
(`DeployDialog.tsx` ~:338-340), and `activatePatch` (cfgActivator) ALSO ensures/writes a `[SharedFile]`
section → two headers.

## Impact

Cosmetic only. INI-style parsers (incl. the SWG client ConfigFile) tolerate duplicate section headers —
the `searchTree_00_26=` key still resolves and the patch loaded fine in-game (UAT confirmed). But it's
sloppy and could confuse a human reading the file.

## Fix

Pick ONE owner of the `[SharedFile]` header. Either DeployDialog creates an EMPTY file (let
`activatePatch` add the section), or `activatePatch` checks for an existing `[SharedFile]` before adding
one. Idempotent section handling. One-liner either way; verify a second deploy doesn't add a third.

## Severity

Low / cosmetic. Bundle with the deploy/cfg rework.
