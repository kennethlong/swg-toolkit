# 2026-07-19 — v23 HANDBACK: worldSnapshot::wsSetNodeTemplateName (model-D lossless rebind)

**Status:** DONE 2026-07-19 night, build-gated + 45s boot smoke, exe restaged.
**Contract v22 → v23, 144 → 145 names.**
**Request:** SWG-Toolkit `2026-07-19-CHANGE-REQUEST-wsSetNodeTemplateName.md` (their CONSULT-70
finding: remove+re-add rebind tombstones the building's WHOLE authored subtree + churns the id
— this row makes per-instance interior persistence lossless).
**NOTE: Utinni development is SUNSET (Kenny, 2026-07-19) — SWG-Toolkit is the SOLE contract
consumer from v23 on. One re-sync, one smoke; no Utinni mirroring.**

## 1. The row

`worldSnapshot::wsSetNodeTemplateName` →
`extern "C" int __cdecl utinni_wsSetNodeTemplateName(__int64 id, const char* name)`

- **In-place template re-point:** interns the new NAME in the snapshot's OTNL table
  (`WorldSnapshotReaderWriter::internObjectTemplateName` — the addObject intern path
  extracted into a public method; find-or-append, existing indices never move) and swaps the
  node's index. **Touches nothing else** — cells, children, id, transform, radius,
  `portalLayoutCrc` all untouched; the LIVE spawned object is untouched (data-only; reload
  spawns from the new template).
- **Returns:** `1` ok / `0` miss (no such authored node — incl. tombstones, whose ids leave
  the map) / `-1` refused (null/empty name; buildout-provenance node; template unresolvable).
- **Fail-closed template check:** `TreeFile::forgetMissingFile(name)` then
  `TreeFile::exists(name)` — stage the derived `.iff` into the loose dir BEFORE calling
  (the forget clears any stale negative-cache miss for a file you wrote seconds ago; a
  refusal logs `template-missing` with that exact hint).
- **pob-crc:** per your stated guarantee the derived template INHERITS `.pob` (never
  overrides) so the node's stored crc stays valid; a violated guarantee fails LOUDLY at
  spawn on reload, never silently.
- Every outcome logs one `[editor.ws] wsSetNodeTemplateName ...` line (OK line shows
  `oldName -> newName`).

## 2. Files changed

- `sharedUtility/WorldSnapshotReaderWriter.{h,cpp}` — `internObjectTemplateName` extracted
  from `addObject` (non-virtual addition; NO layout change → no plugin ABI cascade).
- `clientGame/WorldSnapshot.cpp` — the shim (same TU/discipline as every ws row).
- `engine_worldSnapshot_forward.h`, `engine_advertise.cpp`, `engine_hookpoints.{h,inc}`.
- x64 untouched by construction.

## 3. Gates (all green, 2026-07-19 ~21:57 local)

- Release/Win32 `/t:SwgClient` forced relink (rebuilds sharedUtility + clientGame): exit 0,
  **0 unresolved, 0 compile errors**; exe auto-staged 21:56:58.
- `GetEngineHookPoints` ordinal 82, undecorated. 145 == 145 static_assert holds.
- 45s boot smoke: alive, no new dumps.

## 4. Contract re-sync (consumer — the ONE consumer now)

```
616173956523996757170432c6d4c5fcf0fff89c52d138ea9a8f741be2c85c6d  engine_hookpoints.h
f9797d3f260bd4746b3770bc8271ca92900caac573b00f9e67cf8bdc9615bc07  engine_hookpoints.inc
```

Version-assert 23, count 145. Append-only over v22/v21/v20 — one re-sync covers every
pending bind (`getSceneId`, `collideScreenRayObject`, this).

## 5. Smoke steps (the full model-D changeset, end to end)

1. Stage the derived `.iff` (base + `interiorLayoutFileName` override) + edited `.ilf` into
   the loose dir.
2. `wsSetNodeTemplateName(buildingNodeId, derivedName)` → expect 1 + the `[editor.ws]`
   OK line naming old → new.
3. Negative checks: unknown id → 0; a name you have NOT staged → −1 `template-missing`;
   a buildout id → −1.
4. `wsSaveSnapshot` → 0; parse the saved `.ws` → the node row carries the derived name,
   **subtree intact, id unchanged** (the whole point).
5. Zone out/in (or `wsUnloadSnapshot` + `load(getSceneId())`) → building respawns from the
   derived template → edited interior layout visible; authored in-cell `.ws` content STILL
   PRESENT (the CONSULT-70 loss case, now covered).
6. Sanity: the OTHER instances of the base template are unchanged.

## 6. On the secondary ask (the `Object*` → `(cellName, rowIndex)` resolver)

Deferred pending your consumer-side attempt, as your request suggested. If you need it:
it is implementable provider-side as a PURE READ (rank of the object within its
parentCell's group in the building's file-ordered watcher list — no spawn-seam registry,
no new state; CONSULT-69 synthesis, "resolver" note). One line in a request re-opens it.
