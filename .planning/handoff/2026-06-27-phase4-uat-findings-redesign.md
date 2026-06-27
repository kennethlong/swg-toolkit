# Handoff — Phase 4 in-client UAT: findings + redesign north star (sketch 005-B)

**Date:** 2026-06-27 · **Branch:** `main` · **Status:** UAT in progress (deploy loop not yet fully
verified end-to-end). This doc consolidates the maintainer's design feedback + every gap found during
the in-client UAT, with **sketch 005-B as the approved design** for the deploy surface. One entry point
for the eventual **redesign session**. Detailed items live as individual todos in
`.planning/todos/pending/` (linked below).

> Companion to `2026-06-27-phase4-code-complete-uat-pending.md` (the code-complete handoff). This one
> is the UAT-findings + redesign layer on top of it.

---

## The design north star — sketch 005-B (APPROVED, diverged-from)

`.planning/sketches/005-deploy-inspect-tab/` (`winner: "B"`). The Deploy UI was approved as **ONE tab**:
**staging list (working changes) + version graph + Deploy… modal CTA, all stacked in the inspector dock
slot** (~380px+ wide). The Phase-4 handoff described it the same way ("Deploy tab = Staging OVER the
Version graph + Deploy button").

**The executor diverged** — built three separate Dockview tabs (`Staging` / `Changesets` / `Version
Control`). Fragmenting working-changes from version-history across tabs is the maintainer's #1 usability
friction. **The redesign = build what 005-B already approved** (NOT a fresh design). VCS stays its own
tab (separate axis — git persistence).

---

## Product thesis (maintainer, this session) — fold into PROJECT.md at replan

"Point at a working client + its TRE set → a **throwaway, zero-risk** mod sandbox; the only mutation is
**reversible config** pointing at shadow TRE files; the original client can never be permanently broken;
keep what you like as a **changeset**." Implies: **shadow model is the default** (not patch-prepend);
use a **lazy/virtual file set** (base read in place, only modified files materialize into the override
archive — matches the existing changeset-delta model), NOT a multi-GB copy. See
`product-thesis-shadow-sandbox-and-server-push.md`.

---

## Runtime bugs FOUND + FIXED this session (real-Electron only; jsdom/vitest missed all three)

All passed the 28/28 renderer gate because jsdom/Node stub exactly what Electron breaks on — the
executor-integration blind spot, live. Fixes are HMR'd into the running app; **not yet committed**.

1. **Node builtins externalized by Vite** → renderer crash at module load (`child_process.execFile`).
   Fix: `vite.renderer.config.ts` plugin resolves builtins to runtime `require()` (the Path-B
   mechanism `@swg/native-core` already uses). Fixes the whole class (9 files).
2. **`openWorkspace` on a non-workspace folder failed silently** (console-only). Fix: `WorkspaceEntry`
   now offers confirm-to-create + renders the error inline.
3. **`window.prompt()` unsupported in Electron** (staging Add… / drag-drop threw). Fix: replaced with
   an in-app `VirtualPathModal`.

→ These three motivate `e2e-deploy-flow-coverage.md` (Playwright + planned MCP harness; design test
hook points into features — memory `design-test-hook-points-for-harness`).

---

## Design / wiring GAPS found (all logged as todos)

| Gap | Todo |
|---|---|
| Deploy UI split across 3 tabs vs sketch 005-B's one combined tab (CENTERPIECE) | `deploy-tab-combine-staging-and-changesets.md` |
| No explicit **Save version** action — changeset only seals via Deploy auto-seal; `handlePackPatch` is dead code | `missing-save-version-action.md` |
| **Deploy button** is on Staging; conceptually belongs with the version graph (deploys `flatten(activeVersionId)`) | (in the combine-tab todo) |
| **Stage from the TRE browser** — no Extract→Add path; manual virtual-path entry; misleading empty-state copy | `staging-workflow-redesign.md` |
| Project should **bind to a client + auto-mount its base TREs** on open (TRE browser stays empty today) | `project-binds-and-automounts-client-tres.md` |
| **Project entry point** belongs in the Assets tab next to Mount Archive…; detect TRE-set vs client | `project-entry-point-and-shadow-redesign.md` |
| **Default Baseline changeset** (pristine = shadow matches source) at project creation | `product-thesis-shadow-sandbox-and-server-push.md` |
| **No reopen-closed-panel / reset-layout** affordance (soft-bricks the UI) | `no-reopen-closed-panel-or-reset-layout.md` |
| Shadow model = lazy/virtual, retire multi-GB copy; **server TRE push** to local Core3/swg-main | `product-thesis-shadow-sandbox-and-server-push.md` |

---

## Ground-truth verifications queued ("A" — run against real source/bytes, NOT consensus)

1. **Absolute `searchTree` cfg paths** accepted by the client? (`TreeFile.cpp:115-149`, `../swg-client-v2`).
2. **Server TRE search-path config** for Core3 + swg-main (server-side `cfgActivator` analog).
3. **v6000 = zlib or encrypted?** Maintainer challenges memory `tre-version-oracles-and-v6000-encryption`
   (asserts v6000 is plain zlib, swg-main ships one, should be readable/writable). Verify reader
   (`inflate` vs decrypt) + a real swg-main 6000 TRE hexdump; correct memory + `docs/02-formats` if zlib.

---

## Where UAT stands / next

**✅ PLUMBING CONFIRMED END-TO-END (2026-06-27).** Full loop ran in-client: New Project → Add… (file +
virtual-path modal) → Save version (seals a changeset) → Changesets (node appears) → Deploy… (select
client → patch-prepend) → **patch loaded in-game**. Disk verified: patch `.tre` in the client TRE dir,
`searchTree_00_26=` in `swgtoolkit.cfg`, `.include "swgtoolkit.cfg"` in `swgemu.cfg`. The engine
(`stagingStore`, `changesetService`, `DeployDialog`, `packPatch`, `cfgActivator`) is sound — **the work
left is the UI/UX redesign, not the plumbing.**

**Interim fixes applied this session (uncommitted, HMR-tested in-app):**
- `vite.renderer.config.ts` — node-builtins → runtime require (fixes the renderer crash class).
- `WorkspaceEntry.tsx` — confirm-to-create + inline error (silent open-fail).
- `StagingPanel.tsx` — `VirtualPathModal` replaces unsupported `window.prompt()`; **Save version**
  button added (seals via `sealVersion`); Deploy button removed (moved to Changesets).
- `ChangesetTimelinePanel.tsx` — **Deploy…** bottom action bar (its correct home).
- `DeployDialog.tsx` — Browse IPC array-type fix (was silently failing) + TRE-dir detection
  (`Live/`-vs-root, fixes SWGEmu deploy).

**Next workstream = the REDESIGN session.** Build sketch 005-B (combined Deploy tab), the project↔client
binding (`.studio` under a space-free app root, snapshot original cfg, auto-bind + auto-select client),
client-layout detection + manual cfg override, stage-from-TRE-browser, baseline changeset, and the
lazy/virtual shadow model. All gaps are todos in `todos/pending/`. Remaining ground-truth: server-side
TRE search-path (verification #2) for the server-push feature — not gating the client redesign.
