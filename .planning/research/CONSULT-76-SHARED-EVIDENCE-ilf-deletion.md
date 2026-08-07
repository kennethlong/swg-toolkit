# CONSULT-76 — shared evidence packet: a file was deleted and we do not know by what

**Repo:** `D:\Code\SWG-Toolkit` (Electron + React + TypeScript renderer; a C++ x86 agent DLL
injected into a game client, not relevant below unless you find otherwise).

**Read this as facts to explain. It deliberately contains NO hypothesis** — two have already been
formed and both turned out inconsistent with the code, so they are withheld to avoid anchoring you.

---

## 1. The observed transition

A file was deleted from disk. Nobody intended to delete it. It contained a user's persisted work.

```
PATH DELETED:
  D:\Code\swg-client-v2\stage\override\interiorlayout\toolkit\edit_1082874.ilf
  (34,422 bytes, 269 "NODE" records — an interior-layout binary)
```

**Immediately before** (17:08–17:13 local, 2026-08-07):

```
  interiorlayout/toolkit/edit_1082874.ilf          34422 B  17:13   <-- later DELETED
  interiorlayout/toolkit/edit_1105879.ilf           5775 B  (prev day)
  interiorlayout/toolkit/edit_1106500.ilf           5775 B  (prev day)
  interiorlayout/shared_cantina_mos_eisley_tatooine.ilf  34194 B  (prev day 19:41)
  interiorlayout/shared_cloning_facility.ilf         5775 B  (prev day 20:57)
  object/building/toolkit/edit_1082874.iff          1547 B  17:13
  object/building/toolkit/edit_1105879.iff          1563 B  (prev day)
  object/building/toolkit/edit_1106500.iff          1563 B  (prev day)
```

**Immediately after** (~17:19–17:20):

```
  interiorlayout/toolkit/edit_1082874.ilf          *** GONE ***
  interiorlayout/toolkit/edit_1105879.ilf           5775 B  (unchanged)
  interiorlayout/toolkit/edit_1106500.ilf           5775 B  (unchanged)
  interiorlayout/shared_cantina_mos_eisley_tatooine.ilf  34194 B  UNCHANGED (still prev day 19:41)
  interiorlayout/shared_cloning_facility.ilf         5775 B  REWRITTEN at 17:19:54
  object/building/toolkit/edit_1082874.iff          1547 B  UNCHANGED (survived)
```

Directory mtime of `interiorlayout/toolkit/` became 17:19, consistent with an entry being removed
then.

## 2. The only user action in that window

The user toggled a UI setting **off and then on again**: a per-project boolean called
`mirrorToStockIlf`, persisted in
`C:\Users\kenne\AppData\Local\swg-toolkit\studios\swg-client-v2_(stage,_32-bit)\workspace.json`.
After the toggle cycle that file reads `"mirrorToStockIlf": true`.

The same `workspace.json` contains:

```json
"worldEditorBuildingTemplates": {
  "1082874": "object/building/tatooine/shared_cantina_tatooine.iff",
  "1105879": "object/building/tatooine/shared_cloning_facility_tatooine.iff",
  "1106500": "object/building/tatooine/shared_cloning_facility_tatooine.iff"
}
```

## 3. Relevant filesystem facts, verified

- There is **no** loose file at `<overrideDir>/object/building/tatooine/shared_cantina_tatooine.iff`.
  The only `.iff` files under `<overrideDir>/object/` are the three `object/building/toolkit/edit_*.iff`
  listed above.
- `<overrideDir>` resolves to `D:\Code\swg-client-v2\stage\override`.
- The derived template `object/building/toolkit/edit_1082874.iff` internally declares the string
  `interiorlayout/toolkit/edit_1082874.ilf`.
- The real stock building template (available only from mounted `.tre` archives, not on loose disk)
  declares `interiorlayout/shared_cantina_mos_eisley_tatooine.ilf`.

## 4. Entry points worth knowing about (not a claim that any of them did it)

- `packages/renderer/src/services/decorationPersistOrchestrator.ts` — `reconcileMirrorMode()`
- `packages/renderer/src/services/decorationPersist.ts` — `writeStockMirror()`, `removeStockMirror()`,
  `assembleDecorationEdit()`
- `packages/renderer/src/services/worldEditorScan.ts` — `scanWorldEditorState()`
- `packages/renderer/src/panels/world/WorldPanel.tsx` — the toggle's click handler
- The renderer runs with `nodeIntegration: true`; `fs` is the real Node `fs`.

## 5. A second, possibly related anomaly in the same session

Three persists earlier the same afternoon (16:5x–17:13) wrote **only**
`interiorlayout/toolkit/edit_1082874.ilf` and `object/building/toolkit/edit_1082874.iff`. A UI
staging list for those persists showed exactly `2 staged · 2 add · 0 modify · 0 delete`. A
historical version of the same operation (2026-07-31) staged **three** files, the third being
`interiorlayout/shared_cantina_mos_eisley_tatooine.ilf`.

Whether this is the same root cause or unrelated is unknown.
