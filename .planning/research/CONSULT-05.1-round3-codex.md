## YOUR ANGLE (Codex — repo tracer / call-graph). Non-overlapping with other reviewers.
For EACH shared identifier the revision touched, trace definition→every consumer across the 15 plans
AND against the real source tree under packages/ (renderer/, contracts/, native/). Confirm both sides
of each seam agree on signature/type/ownership. Specifically verify:
- worldEditorBuildingTemplates map: Plan02 def → Plan06 write → Plan04 read → Plan10/13/14 consume (key = sanitizeId, same everywhere?)
- makeReadVfs export in decorationPersistOrchestrator.ts consumed identically by Plan10 & Plan13
- reconcileMirrorMode return {failures}: sole updateWorkspaceMeta owner? Plan10 double-write eliminated?
- worldEditorStore.refresh(overrideDir, buildingTemplates?) — do ALL call sites (Plan10 mount, Plan13 post-remove, Plan14) pass the 2nd arg?
- Also VERIFY GROUND TRUTH: do the cited overlay.cpp line ranges (e.g. 412-415, 468-471) and the handoff/change-request filenames actually exist in the tree? Flag any fabricated citation.
Report defects as: [SEVERITY] plan(s) — identifier — what disagrees. State CONVERGED if no HIGH remains.

# Cross-AI Plan Review — Phase 05.1 — ROUND 3 (post-R1-R13 convergence check)

You are independently reviewing the REVISED implementation plans for Phase 05.1 of the SWG Toolkit.
Two prior review rounds ran. Round 2 produced a ranked work-list R1-R13 (5 HIGH + 7 MEDIUM + LOW).
A --reviews replan just revised 11 of 15 plans to resolve those items. YOUR JOB THIS ROUND:
verify convergence — (1) is each Round-2 HIGH actually resolved consistently across BOTH sides of its
cross-plan seam, and (2) did the revision introduce any NEW defect, especially at TS interface seams
(shared types, function signatures, module exports, prop threading, reset/ownership semantics).

Round-2 HIGHs were ALL in the TS interface seams between plans. Focus there. Report only real,
specific, actionable defects with plan+identifier+line-of-reasoning. Rank each HIGH/MEDIUM/LOW.
If you believe the phase has CONVERGED (no HIGH remaining), say so explicitly.

## Project context (AGENTS.md excerpt)
# Agent instructions (SWG-Toolkit)

Guidance for AI agents working in this repository. Read by Claude Code (via `CLAUDE.md` →
`@AGENTS.md`), and by Codex / Cursor when consulted in this directory.

This is a **modern, open-source, all-in-one Star Wars Galaxies modding suite** — successor to
Sytner's IFF Editor (SIE) and Utinni. Stack: React 19 + TypeScript + Node-API (N-API) + C++ core,
Three.js / R3F viewport, Electron Forge, live in-game memory injection, Blender bridge, Core3/SWGEmu
parity, MCP + AI layer. Full vision: [.planning/PROJECT.md](.planning/PROJECT.md). Full design:
[docs/README.md](docs/README.md).

## Session startup

Before substantial work, restore context:

1. Read [.planning/PROJECT.md](.planning/PROJECT.md) and, if it exists, [.planning/STATE.md](.planning/STATE.md) — current goals, phase, decisions.
2. Skim [docs/README.md](docs/README.md) to find the reference doc(s) for the subsystem you're touching.
3. If a handoff index exists at `.planning/handoff/README.md`, read the active handoffs (newest/most relevant first). Handoffs live in **`.planning/handoff/`** — one markdown file per workstream, written when context would otherwise be lost.

## ⚠️ The #1 project constraint — verify formats against ground truth

The `docs/` reference library was **distilled from an AI-generated (Gemini) research session.**
High-level architecture is sound, but **every binary format / struct layout / chunk tag in those
docs is plausible-but-unverified and is frequently fabricated.** See
[docs/00-overview/source-provenance.md](docs/00-overview/source-provenance.md).

**Before implementing any parser/serializer:** diff the proposed layout against ground truth —
the real client/server source and **actual asset bytes**. AI consensus is NOT evidence; the real
loader code and a hexdump of a real file are. (This is the project's biggest technical risk and the
direct analog of the "phone a friend" de-anchoring rule in `CLAUDE.md`.)

## Ground-truth reference projects (read access; siblings under `D:\Code\` + drives)

These are authoritative — harvest logic from them and validate formats against them:

| Path | What it is | Use for |
| --- | --- | --- |
| `../swg-client-v2` | Modernized SWG Source **client** (MSBuild) | Canonical client-side IFF/TRE/format parsing logic — the #1 ground truth |
| `../swg-main` | SWG Source **server** (Docker) | Server templates, data tables |
| `../Core3` | SWGEmu cleanroom **server** (WSL2) | Lua templates, client↔server parity (`MMOCoreORB/bin/scripts/managers/templates/`) |

## ROADMAP — Phase 05.1 section
### Phase 5.1: Live World Editor Productization (INSERTED)

**Goal:** Turn the proven model-D interior-decoration persistence pipeline (closed end-to-end 2026-07-31; handoff `2026-07-30-live-world-editor-decoration-persist.md`) from a debug probe into the product surface. Sketch-first per AGENTS.md — three approved sketches are the UI contract, and plans MUST enumerate their distinct elements as `must_haves`:
- **World panel (sketch 019, winner A — Building Tree):** a real dockview `World` tab owning everything rows/fields/text about in-world editing. Buildings own the hierarchy; decorations nest under their building with human-readable persist status; selection detail card; persist history + Scene as collapsed accordions; mirror-mode toggle with per-template/per-instance scope hint; human-readable rebind/save feedback (never raw codes); editor-scene launcher + teleport bookmarks; live-session strip; `+ Add decoration…` entry.
- **In-game HUD (sketch 020, winner A — Status Strip):** replace the CONSULT-69 debug probe with one thin hotkey-driven top-center strip (F arm, G/R move/rotate) with idle/hover/armed/saved/failed states; failures punt detail to the World panel — raw result codes never surface in-game.
- **Spawn flow (sketch 021, winner A — Wizard Modal):** `+ Add decoration…` opens a 016-style picker modal (search + thumbnail grid) → "Place in game" hands a placement ghost to the overlay → click places → two-surface confirm (overlay toast + new row in the World list). **UI leads the plumbing:** the `.ilf` new-row append + row identity for a new node is NOT built yet (today's pipeline edits existing rows only; `wsAddObject` live spawn is proven). Decoration REMOVE rides the same new plumbing (row delete + despawn).

Engineering ride-alongs owed by the pivot (handoff "Remaining follow-ups"):
- **Agent result-mapping fix:** `overlay.cpp:468-471` — explicit `reb == -1` refused branch so a provider "refused" can never fall through to a false save-result; split "endpoint unresolved" from NODE_NOT_FOUND (needs agent rebuild).
- **Rotation-persist confirm** — move is proven live; rotation persistence not yet explicitly confirmed.
- **Mirror-mode UI** — surface `mirrorToStockIlf` (orchestrator default ON, currently no UI) as the World-panel toggle with its scope hint.
- **Editor-scene verify pass** — the provider's §4 canonical visible-verify context (`game::loadScene`); hybrid reload already verified.

**Mode:** mvp
**Requirements**: pivot-driven (model-D productization; extends LIVE-03's WYSIWYG loop; no new parent reqs)
**Depends on:** Phase 5 (viewport gizmo, live-sync channel, overlay foundation), the off-roadmap model-D decoration-persist pipeline (closed 2026-07-31)
**Success Criteria** (what must be TRUE):
  1. A user can hover a decoration in-game, arm/move/rotate/persist it entirely from the productized status-strip HUD (CONSULT-69 debug probe retired), and every failure reads as words with detail routed to the World panel — raw result codes never surface in either UI.
  2. The World panel matches sketch 019-A element-for-element (building tree with nested decorations + persist status, detail card, persist-history + Scene accordions, live-session strip, editor-scene launcher/bookmarks), verified by an observed/missing diff against the sketch.
  3. The mirror-mode toggle controls `mirrorToStockIlf` per persist with a clear per-template vs per-instance scope hint, and the persist path honors it.
  4. A user can ADD a new decoration end-to-end (021-A wizard pick → overlay ghost placement → persisted `.ilf` gains a new row that survives scene reload) and REMOVE a decoration with the same persistence guarantee.
  5. Rotation edits persist and reload correctly, and the agent `-1`-refused mapping fix ships (a refused rebind can never report a save-result).

**Plans:** 15 plans
Plans:
**Wave 0** *(parallel — no cross-plan dependencies)*
- [ ] 05.1-01-PLAN.md — Wave-0 gates: REBIND_REFUSED label fix, .ilf addNode/removeNode, decorationPersist kind=edit|add|remove + byte-exact round-trip tests
- [ ] 05.1-02-PLAN.md — Per-project settings: WorkspaceBindingMeta mirrorToStockIlf + worldEditorBookmarks, projectBinding helpers
- [ ] 05.1-03-PLAN.md — Channel contract extension: CAPTURE kind/cellName (ADD identity) + new unified LIVE_HOST_CMD region (scene actions, placement start/cancel, despawn)
- [ ] 05.1-04-PLAN.md — worldEditorScan.ts (disk-scan-as-truth building tree) + worldEditorStore.ts (session overlay + history + badge)

**Wave 1** *(blocked on Wave 0)*
- [ ] 05.1-05-PLAN.md — Agent HUD rewrite (020-A Status Strip): retire CONSULT-69, F/G/R hotkey capture, verify-wire shipped REBIND_REFUSED/editor-scene ride-alongs [autonomous: false]
- [ ] 05.1-06-PLAN.md — Orchestrator: thread mirrorToStockIlf + reconcileMirrorMode (D-09) + capture.kind=add branch
- [ ] 05.1-07-PLAN.md — Native HOST_CMD channel: agent read+ack (channel.cpp) + host N-API write export (channel_binding.cpp/addon.cpp)

**Wave 2** *(blocked on Wave 1)*
- [ ] 05.1-08-PLAN.md — Renderer hostCommand.ts send* wrappers + useChannelReader.ts result polling
- [ ] 05.1-09-PLAN.md — Agent consumes HOST_CMD (reload/editor-scene/teleport/despawn) + binds wsRemoveNode [autonomous: false]
- [ ] 05.1-10-PLAN.md — World panel shell: dockview registration + tree/mirror-toggle/live-strip/detail-card (019-A core)

**Wave 3** *(blocked on Wave 2)*
- [ ] 05.1-11-PLAN.md — World panel: Activity + Scene accordions, teleport bookmarks, footer
- [ ] 05.1-12-PLAN.md — Agent placement-mode: ghost/reticle/click-spawn/auto-arm + post-save temp-node despawn (021-A frame 2) [autonomous: false]

**Wave 4** *(blocked on Wave 3)*
- [ ] 05.1-13-PLAN.md — World panel Remove row action: removeUndoStore + RemoveUndoToast + data-only/live-despawn remove (D-02/D-03/D-04)

**Wave 5** *(blocked on Wave 4)*
- [ ] 05.1-14-PLAN.md — AddDecorationModal.tsx (021-A wizard) + World panel wiring, honest cell-name-gap degrade (D-04)

**Wave 6** *(blocked on Wave 5)*
- [ ] 05.1-15-PLAN.md — Cell-name change-request handoff + phase sign-off checkpoint (SC1-SC5 observed/missing diff) [autonomous: false]
**UI hint**: yes
## CONTEXT.md (LOCKED user decisions — plans must honor these; do NOT re-derive)
# Phase 05.1: Live World Editor Productization - Context

**Gathered:** 2026-07-31
**Status:** Ready for planning

<domain>
## Phase Boundary

Turn the proven model-D interior-decoration persistence pipeline (closed end-to-end 2026-07-31,
handoff `2026-07-30-live-world-editor-decoration-persist.md`) from the CONSULT-69 debug probe into
the product surface, across three approved sketches that ARE the UI contract (winners locked):

- **World panel (019-A Building Tree)** — a real dockview `World` tab owning everything
  rows/fields/text about in-world editing: building tree with nested decorations + human-readable
  persist status, selection detail card, persist-history + Scene accordions, mirror-mode toggle
  with scope hint, live-session strip, editor-scene launcher + teleport bookmarks,
  `+ Add decoration…` entry.
- **In-game HUD (020-A Status Strip)** — one thin hotkey-driven top-center strip (F arm, G/R
  move/rotate) with idle/hover/armed/saved/failed states, replacing the CONSULT-69 probe. Failures
  punt detail to the World panel; raw result codes never surface in-game.
- **Spawn flow (021-A Wizard Modal)** — `+ Add decoration…` opens a 016-style picker → "Place in
  game" hands a placement ghost to the overlay → click places → two-surface confirm. **UI leads the
  plumbing:** the `.ilf` new-row append + row identity is NOT built (today's pipeline edits
  existing rows only; `wsAddObject` live spawn is proven). REMOVE rides the same new plumbing.

Engineering ride-alongs owed by the pivot (in scope, from the handoff "Remaining follow-ups"):
agent `-1`-refused result-mapping fix (`overlay.cpp:468-471`, split "endpoint unresolved" from
NODE_NOT_FOUND, needs agent rebuild); rotation-persist confirm; `mirrorToStockIlf` UI; the
provider-§4 editor-scene verify pass (satisfied via the Scene launcher below).

**Boundary rule (locked):** point-at-the-world = overlay; rows/fields/text = app panel.

**Out of scope:** per-instance mirror mode's server-side template repoint (UI shows it disabled —
see D-08); general `.ws` editing beyond this pipeline (Phase 7 FMT-02); Blender bridge (Phase 6).

</domain>

<decisions>
## Implementation Decisions

### Add/Remove plumbing (021-A)

- **D-01: Place-then-adjust.** The placement click spawns the live object via the proven
  `wsAddObject` and **auto-arms it in the gizmo** (the same armed state as an existing decoration).
  The user nudges position/rotation, then explicitly Persists. Add = "armed edit whose persist
  appends a row instead of editing one" — **one code path for add and edit.** (Rejected:
  auto-persist on click; stage-in-panel batch persist.)
- **D-02: Any decoration is removable, stock included.** Remove = the edited `.ilf` omits the row
  (+ live despawn), the same model-D data path as moving a stock table. The stock file is never
  touched, so removal is inherently reversible by removing the edit.
- **D-03: Remove is a World-panel row action guarded by an undo toast.** No confirm dialog — the
  undo toast re-adds the row (DeleteUndoToast precedent from the delete-project flow). The in-game
  HUD stays pick/move/persist only; no in-game delete hotkey.
- **D-04: Provider-shim dependencies: planner decides per finding.** Research first establishes
  what add/remove actually needs from `swg-client-v2` (e.g. live despawn of an in-cell decoration).
  Planner then picks block-vs-degrade case-by-case, with the **pre-wire/bind-by-name idiom as the
  default posture** (how the `getContainingBuildingId` blocker was handled: file the change-request
  early, bind by name, no toolkit rebuild when it lands). A "takes effect on scene reload" degrade
  is acceptable interim UX; change-requests go through the relay loop the maintainer runs
  ([[reference-cross-repo-change-request-handoffs]] — never edit the provider repo directly).

### World panel data spine (019-A)

- **D-05: Tree truth = disk scan + session overlay.** The durable building tree derives from
  scanning the override dir (`edit_*.ilf` + derived templates) and diffing against the stock
  `.ilf`; it survives restarts and needs no new store. Live-session state (armed/pending/failed)
  overlays on top while attached. (Rejected: toolkit-side manifest store; disk+journal hybrid.)
- **D-06: Persist history is session-only.** The history accordion shows this session's
  persists/failures from the orchestrator log in memory and clears on app restart. The tree is
  durable; the play-by-play is ephemeral. HUD-punted failure detail lives here (and on the row).
- **D-07: Scene accordion ships all three tools.** (1) Editor-scene **launcher** issuing
  `game::loadScene` into the provider's §4 canonical visible-verify context — this also satisfies
  the owed editor-scene verify pass; (2) **Reload current scene** mirroring the overlay button;
  (3) **teleport bookmarks** = saved teleport targets (building/cell coords) for returning to work
  sites.
- **D-07b: Offline, the panel scans the project-bound client's override dir** (the 04.1
  project↔client binding — the same source the deploy flow trusts). When attached, the attached
  client wins; a mismatch vs the binding gets a visible hint on the live-session strip.

### Mirror-mode toggle (`mirrorToStockIlf`)

- **D-08: Per-project toggle, read at persist time, default ON** (matching the orchestrator
  default). Lives in the World panel, persisted per project (workspace.json idiom). The scope
  control shows **both** modes: "Per-template (all instances of this layout)" active, and
  "Per-instance (server repoint)" as a **disabled option with a 'coming later' hint** — the
  disabled option itself teaches why all instances of a layout change. (Rejected: per-building
  overrides; per-persist prompt; hiding per-instance entirely.)
- **D-09: Flipping the toggle reconciles existing edits.** OFF removes the stock-path shadow
  copies for already-edited buildings; ON creates them. Disk always matches what the toggle claims
  — no stale mirrors (the exact stale-override class that burned the 7/19→7/30 debugging night).
- **D-10: Mirror-OFF hybrid-session warning surfaces in BOTH UIs.** In-game: the saved state
  carries a short "saved (not visible here)" variant so the user isn't confused when the object
  snaps back after reload. App: the persist-result line carries the full detail ("mirror off — not
  visible on hybrid sessions until reload into an editor scene").

### HUD interaction + failure routing (020-A)

- **D-11: Contextual hotkey capture.** The overlay swallows keys only when they're meaningful:
  F only while a decoration is hovered, G/R only while armed, Esc cancels arm. Zero keyboard
  footprint when just playing; no edit-mode to forget. (Accepted risk: F-while-hovering can
  occasionally eat a game keypress — fine for an editor tool.)
- **D-12: Failure punt = badge + detail waiting.** On a failed persist the World tab gets an
  attention badge; the failed decoration's tree row and the history entry carry the full
  human-readable detail (reason, paths, building id). The app **never steals focus** while the
  game is up. Raw result codes appear in NEITHER surface (SC1).
- **D-13: Delta readout in both surfaces, strip compact.** The strip shows a compact live
  cell-space Δ while armed (the numbers belong where the eyes are during a drag); the panel detail
  card shows the full readout (before/after transforms, cell, row). Matches 020-A's armed mock.
- **D-14: Debug trace gated behind a dev toggle, default OFF.** The
  `%TEMP%\swg-toolkit-decoration-debug.log` + assembly tracing stay available via a config/env dev
  toggle for field debugging; the failure detail the panel needs travels through the normal result
  path instead. (Closes the handoff's "gate before sign-off" debt.)

### Claude's Discretion

- **Rotation axis constraint** (yaw-only vs full 3-axis for decoration rotate), gizmo
  snapping/increments, strip position/opacity details — within 020-A's anatomy.
- **Building/decoration display naming** in the tree (template-derived humanization) — within
  019-A's "real data everywhere" examples (node 1082874, alcove1 row 3).
- **World-tab dockview placement + LAYOUT_VERSION bump** — follow the established
  `WorkspaceShell.tsx` registry/versioning pattern.
- **Bookmark storage shape** (per-project workspace.json vs sibling store) — match existing
  per-project persistence idioms.
- **Wave sequencing** — planner's call; note the `.ilf` append plumbing (D-01) underpins both add
  and remove, and the agent result-mapping fix should land before failure-surface polish is
  meaningful.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### UI contract (READ FIRST — sketches are the contract; plans MUST enumerate their distinct
### elements as `must_haves`, per AGENTS.md "Sketches are the UI contract")
- `.planning/sketches/019-world-editor-panel/` (README.md + index.html) — World panel, winner **A
  (Building Tree)**. Required elements listed in the README front section.
- `.planning/sketches/020-overlay-decoration-hud/` (README.md + index.html) — in-game HUD, winner
  **A (Status Strip)**. Note: overlay is ImGui on the game's D3D device — NOT themed by the app.
- `.planning/sketches/021-spawn-decoration-flow/` (README.md + index.html) — spawn flow, winner
  **A (Wizard Modal)**, 016-style picker; "UI leads the plumbing" caveat is the phase's build order.
- `.planning/sketches/016-new-object-from-template/` — the picker idiom 021-A reuses.
- `.planning/ROADMAP.md` §"Phase 5.1" — goal, ride-alongs, success criteria (SC1–SC5).

### Pipeline ground truth (what's proven, what's owed)
- `.planning/handoff/2026-07-30-live-world-editor-decoration-persist.md` — THE closure handoff:
  model-D definition, the night's three root-causes, remaining follow-ups, build/rebuild commands,
  provider/consumer separation.
- `.planning/handoff/2026-07-30-PROVIDER-HANDBACK-getContainingBuildingId-v25.md` — the v25 shim
  the Arm path uses.
- `.planning/handoff/2026-07-30-PROVIDER-HANDBACK-wsSetNodeTemplateName-authored-fix.md` — the
  GroundScene authored-row-erase engine fix (`suppressObject`).
- `.planning/handoff/2026-07-19-PROVIDER-ilf-decoration-editing-CONSULT-ANSWERS.md` — provider's
  answers on `.ilf` decoration editing (incl. the §4 editor-scene verify context); relevant to the
  new-row append design.
- Memory: [[reference-model-d-building-id-resolution]], [[reference-cross-repo-change-request-handoffs]].

### Code the phase extends (verified present this session)
- `packages/live-inject/agent/overlay.cpp` — CONSULT-69 probe to retire (`:617`),
  `armDecorationEdit` (`:382`), `persistDecorationEdit` (`:432`), and the **`-1`-refused
  result-mapping fix site (`:468-471`)**. Agent rebuild required
  (`cmake --build packages/live-inject/agent/build-agent --config Release`, needs node on PATH).
- `packages/renderer/src/services/decorationPersistOrchestrator.ts` — the persist orchestrator
  (mirror default ON lives here; `dbg()` trace to gate per D-14).
- `packages/renderer/src/services/decorationPersist.ts` — assembly + stock-fallback + logging
  (regression-tested).
- `packages/renderer/src/services/ilf.ts`, `buildingTemplate.ts` — `.ilf` parse/assemble + derived
  building template; the new-row append (D-01) extends `ilf.ts`.
- `packages/renderer/src/services/decorationChannel.ts` — CAPTURE/RESULT decode.
- `packages/contracts/src/live-inject.ts` — `LIVE_DECORATION_LAYOUT` (mapping 1308,
  static-asserted both ends). Extend, don't fork; rebuild `@swg/contracts` after edits.
- `packages/renderer/src/workspace/WorkspaceShell.tsx` — dockview panel registry
  (`STATIC_PANEL_IDS`, `LAYOUT_VERSION` bump pattern) for the new World tab.
- `packages/renderer/src/panels/viewport/LiveSyncClientCard.tsx` + `liveStore`/`useLiveService` —
  live-session state feeding the panel's live strip.

### Standing gates
- `AGENTS.md` §"Sketches are the UI contract" — plan/verify rules (must_haves enumeration,
  observed/missing diff at verification).
- `.planning/REQUIREMENTS.md` — LIVE-03 lineage (this phase extends the WYSIWYG loop).

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **The entire model-D pipeline** (orchestrator → assembly → channel → agent rebind → `.ws` save)
  is proven and reused as-is; this phase wraps product UI around it and adds the row-append path.
- **`wsAddObject` live spawn** — proven; becomes the placement-click primitive (D-01).
- **DeleteUndoToast idiom** — the remove guard (D-03).
- **04.1 project↔client binding + `detectClients()`** — override-dir resolution offline (D-07b).
- **016 picker modal idiom** — the 021-A template browser.
- **04.4 console/log infrastructure** — the normal result path that replaces the temp-file trace.

### Established Patterns
- **Sketch-first**: every 019/020/021 element is a plan `must_have`; verification diffs the built
  surface against the sketch (observed/missing).
- **Pre-wire/bind-by-name** for provider dependencies — rows bind null until the shim ships; no
  toolkit rebuild on landing (D-04 default posture).
- **Stale-override hygiene** — disk state must never silently diverge from what the UI claims
  (drove D-05 disk-scan truth and D-09 reconcile-on-flip).
- **Words, never raw codes** — human-readable status everywhere (SC1); the agent `-1` mapping fix
  is the plumbing half of that promise.

### Integration Points
- New `World` dockview tab in `WorkspaceShell.tsx` (registry + LAYOUT_VERSION bump).
- Overlay strip replaces the CONSULT-69 CollapsingHeader in `overlay.cpp` (same ImGui/D3D render
  path, same hover/arm/persist internals).
- `LIVE_DECORATION_LAYOUT` channel extensions for spawn-ghost handoff + remove/despawn commands
  (extend the existing contract, static-assert both ends).
- Persist results flow: agent RESULT → orchestrator → World panel rows/history + HUD state.

</code_context>

<specifics>
## Specific Ideas

- **"Add is just an edit with a new row"** — the maintainer chose the one-code-path model
  deliberately: placement auto-arms the same gizmo state an existing decoration gets.
- **Reconcile-on-flip (D-09)** was chosen explicitly over cheaper "future persists only" because
  stale override state is the documented failure class of the 7/19→7/30 nights.
- **"The disabled option is itself the explanation"** — showing per-instance greyed-out teaches
  why per-template mirroring changes every instance of a layout.
- **HUD honesty in the moment**: the maintainer upgraded the mirror-OFF warning from panel-only to
  both surfaces — "saved (not visible here)" prevents the object-snapped-back confusion.
- Sketch READMEs stress **real data everywhere** (node 1082874, alcove1 row 3,
  edit_1082874.ilf) — the shapes the pipeline actually produces, not lorem placeholders.

</specifics>

<deferred>
## Deferred Ideas

- **Per-instance mirror via server-side template repoint** — visible as a disabled option (D-08);
  the actual server-side mechanism is future work beyond this phase.
- **Durable persist-history journal** — rejected for this phase (D-06 session-only); revisit if
  audit-trail pain shows in real use.
- **In-game delete hotkey** — rejected (D-03); reconsider only if panel-side remove proves too
  slow when clearing rooms.
- **021-B Palette Dock** (persistent searchable palette) — the sketch's noted alternative for
  bulk room decorating; a growth direction if the modal round-trip annoys in practice.

### Reviewed Todos (not folded)
- `todo.match-phase 05.1` → 0 matches (6 pending todos, none phase-relevant). No todos folded or
  displaced.

</deferred>

---

*Phase: 05.1-live-world-editor-productization*
*Context gathered: 2026-07-31*

## REVIEWS.md (Round-2 work-list R1-R13 that the revision addressed)
---
phase: 05.1
round: 2
reviewers: [codex, cursor, sonnet, opus, fable]
reviewed_at: 2026-08-01T06:35:00Z
plans_reviewed: [05.1-01..05.1-15]
review_type: cross-AI convergence review of the --reviews replan (commit f9711c4)
prior_round: round 1 at commit c4e0843 (C1–C13), incorporated by replan f9711c4; round-1 text in git history
full_outputs: .planning/research/CONSULT-71-codex.out, CONSULT-72-cursor.out, CONSULT-73-sonnet.out, CONSULT-74-opus.out, CONSULT-75-fable.out
---

# Cross-AI Plan Review — Phase 05.1 — Round 2 (post-replan convergence check)

Five reviewers on non-overlapping angles, per the de-anchoring protocol, each handed only neutral
evidence (the `c4e0843..f9711c4` diff + real source as ground truth): **Codex** (cross-process wiring
trace), **Cursor** (byte-layout audit), **fresh Sonnet** (UX-contract honesty), **fresh Opus**
(cross-plan data contracts), **fresh Fable** (adversarial fact-check of NEW replan claims + execution
risk). Task files: `.planning/research/CONSULT-71..75-*.md`; full reviews in the matching `.out` files.

**Verdicts:** Cursor CONVERGED · Codex CONCERNS (1 HIGH) · Sonnet CONCERNS (1 HIGH) · Opus CONCERNS
(3 HIGH) · Fable CONCERNS (non-blocking; fact-check largely clean).

**What converged as SOUND (do not re-litigate in the next replan):**
- The **1308→1864 byte layout** is verified four ways: Cursor recomputed every offset under
  `#pragma pack(4)` (no overlaps, strides exact, `hostCmdId`@1836 unpadded); Codex traced size
  ownership with **no orphan sites** (contracts + `channel.cpp:25` + `channel_binding.cpp:58` all owned
  by Plan 03); Opus independently cleared the offset table and `MIRROR_OFF 0x4` against
  `overlay.cpp:461`; Fable verified both 1308 literals at the exact cited lines.
- **Round-1 closures are real**: Fable spot-checked C1/C2/C3/C5/C12 and found them genuinely
  implemented in plan text, not just mentioned. The replan's "verified this session" claims were
  almost universally accurate (exceptions below in R-13).
- Capture kind/cellName encode/decode symmetry (Codex), kind/flag/result string vocabularies,
  `PersistHistoryEntry`/`formatPersistMessage` agreement, zero-async C13 claim, and
  `utinni_wsRemoveNode` 1/0/-1 semantics vs `WorldSnapshot.cpp:2348` (Opus/Fable) all check out.
- Fable **empirically mounted the 27 SWG Infinity TREs and confirmed 298 `interiorlayout/*.ilf`
  entries** — Plan 01's now-REQUIRED real-asset lane is satisfiable on this machine.

---

## ⚑ ROUND-2 WORK-LIST — ranked by severity and convergence

### R1 — [HIGH] Plan 06 breaks the renderer build at the Wave-1 boundary (studioDir required before its only caller updates)
**Codex (source-confirmed).** Plan 06 changes `handleDecorationCapture` to require `studioDir: string | null`
in its ctx (05.1-06-PLAN.md:164-170) and gates itself on renderer `tsc --noEmit` clean (05.1-06:270-272).
The only real caller, `useChannelReader.ts:270-273`, passes `{ mappingName, clientExe }` and is not updated
until Wave-2 Plan 08 (05.1-08:344-347). Plan 06's own verify gate fails as written.
**Fix:** make `studioDir` optional in Plan 06's signature (with Plan 08 making the threading mandatory +
regression-tested, as already planned), or move the one-line call-site update into Plan 06 (no same-wave
file conflict — Plan 08 is Wave 2). Either way, Plan 06's tsc gate must be passable at the Wave-1 boundary.

### R2 — [HIGH] Agent-side ADD globals never reset → first EDIT after any ADD assembles as ADD → duplicate .ilf row
**Opus (source-confirmed).** Plan 12's `g_capKind`/`g_capCellName` have no reset site, and Plan 12 forbids
touching `armDecorationEdit` (verified: `overlay.cpp:382-428` sets neither). After a successful ADD, a
subsequent EDIT capture publishes with stale `kind=add` → orchestrator appends a duplicate row instead of
editing. **Fix:** assign an explicit reset (e.g., arm/capture path clears kind to `edit` and empties
cellName each cycle, in whichever plan owns that seam — likely Plan 05 or 12) + an EDIT-after-ADD
sequence test.

### R3 — [HIGH] Plan 13's remove flow is unimplementable: `WorldEditorBuilding` lacks `buildingTemplateVfsPath`
**Opus (source-confirmed).** `assembleDecorationEdit` requires `buildingTemplateVfsPath`
(`decorationPersist.ts:30,123`), but Plan 04's `WorldEditorBuilding` shape doesn't carry it, so Plan 13's
`removeDecorationRow` cannot build a valid `DecorationEdit`; `derivedTemplatePath` would misdirect the
stock mirror. **Fix:** add the field to Plan 04's scan output (disk scan knows the template path) and
consume it in Plan 13.

### R4 — [HIGH] `makeReadVfs` is module-private; Plans 06/13 take `readVfs` params no caller can construct
**Opus (source-confirmed).** `reconcileMirrorMode` (Plan 06) and `removeDecorationRow` (Plan 13) accept
`overrideDir`/`readVfs`, but `makeReadVfs` at `orchestrator.ts:102` is unexported and no plan exports it
or specifies how WorldPanel builds one. **Fix:** one plan (06) exports the factory (or a wrapper) and
Plans 10/13 name that import explicitly.

### R5 — [HIGH] Locked D-13 silently weakened: detail card cannot show "before/after transforms, cell, row"
**Sonnet (HIGH) + internal plan-checker (independent warning).** D-13 (CONTEXT.md, locked, no discretion
clause) promises the full readout; Plan 10 renders a single current `Position` field, and Plan 04's
`PersistHistoryEntry` carries **no coordinate data at all**, so the promise is structurally unsatisfiable
as planned. Never disclosed anywhere. **Fix (choose one, explicitly):** (a) add before/after transforms +
cell/row to `PersistHistoryEntry` (Plan 04) and render them (Plan 10), or (b) the maintainer amends D-13's
wording and Plan 15's gap ledger records the reduction. (a) is the default absent maintainer input —
locked decisions bind.

### R6 — [MEDIUM] Mirror-flag persisted by two owners reopens the D-09 flag-lies-about-disk window
**Opus.** Plan 06 persists `mirrorToStockIlf` inside `reconcileMirrorMode` AND Plan 10 persists it from
the panel toggle. Two writers, two moments — the exact divergence D-09 exists to prevent. **Fix:** single
owner (reconcile path), panel calls it.

### R7 — [MEDIUM] `removeDecorationRow` uses `mappingName` it never receives
**Opus.** Plan 13's body calls `sendDespawnNode(mappingName, …)` but `mappingName` is not among its
declared params. **Fix:** add the param (or drop the call per the C4 relabel — align with whichever way
C4/R2 resolves).

### R8 — [MEDIUM] `reconcileMirrorMode` typed `: void`/"never throws" yet Plan 06 promises a failure list and Plan 10 wraps it in a dead `catch`
**Opus.** Contract self-contradiction across the two plans. **Fix:** return a result object
(`{failures: […]}`); Plan 10 consumes the return, drops the `catch`.

### R9 — [MEDIUM] Plan 11's revision deleted its `sketch_elements` frontmatter without relocating it
**Fable.** Activity/Scene accordions + footer elements vanished from the sketch-parity contract —
violates the repo's own plan rule (AGENTS.md sketch section). **Fix:** restore the block.

### R10 — [MEDIUM] C6 building-id guard: resolved-id-0 behavior undefined
**Fable.** Plan 12 fails open only on resolver *absence* and refuses on mismatch; a floor click resolving
to id 0 is refused as "wrong building" every time. **Fix:** specify fail-open-on-0 (with the words-only
notice), matching the guard's stated intent.

### R11 — [MEDIUM] Inert stubs lack the honest-copy mandate; CONTEXT.md D-02 wording now contradicts the plans
**Sonnet.** (a) Detail-card stub buttons (Go to / Revert / Edit in game) and footer "Stage to project"
have no mandated non-misleading copy, unlike Remove (C4) and the HOST_CMD log (C9) — risk of shipping the
sketch mock's literal toast strings on dead buttons. (b) `05.1-CONTEXT.md` D-02 still reads "Remove = …
(+ live despawn)" — untouched by the replan — while Plans 13/15 disclose despawn never fires this phase.
**Fix:** add honest-copy acceptance criteria to Plans 10/14; maintainer annotates D-02 (CONTEXT.md is the
maintainer's doc — flag, don't silently edit).

### R12 — [MEDIUM] Remaining Opus contract nits
- MED-9: Plan 08 applies `formatPersistMessage` to **failed** results → success-shaped strings on failures.
- MED-10: Plan 06 threads `capture.cellName` unconditionally → EDITs flip from the proven `resolveNode`
  path to pinned-cell `resolveRowIndex`. Gate cell-pinning on `kind === 'add'`.
- MED-7: building-row id format / `selectedRowId` parser used by Plans 10/14 but defined by neither —
  Plan 04 should define it.
- MED-8: Plan 01's `registerFormat('ilf', …)` signature doesn't satisfy `FormatRegistryEntry`
  (`Uint8Array`/`unknown` vs `Buffer`/`IlfNode[]`) — use the stf-style wrappers the cited precedent uses.
- MED-11: `resolveScanRoot` param list contradicts its own no-import-projectBinding rule; no consumer
  names it.

### R13 — [LOW] Small factual/mechanical corrections (Fable/Cursor/Opus/Sonnet)
- Plan 03 says channel.cpp has "17" offsetof asserts; real count **25**; static_assert message quote is
  paraphrased — cite by symbol, not quote.
- Fallback root `D:/SWGEmu Client/SWGEmu` does not exist on this machine (Infinity install suffices).
- Plan 03 Task 1 acceptance grep uses PCRE `\s` with plain `grep` — use `grep -P` or `[[:space:]]`.
- Plan 03 verify chains with `;` — failures don't stop the chain; use `&&`.
- Cursor L1: new struct fields must be inserted **after `resultEpoch`**, not after
  `captureBuildingTemplate`, despite "CAPTURE section" wording (Plan 03 wording ambiguity).
- Opus LOW: `newO2p` still required for `kind='remove'`; sanitized-vs-raw `buildingId` identity;
  HOST_CMD epoch gating asymmetric (`!=` agent vs `>` renderer) — pick one convention.
- Sonnet L-4: Plan 08's threat model undersells the Console-tab visibility of the coarse log line
  (words-only copy is still compliant; fix the disposition text).
- Fable E3/E5/E6: Plan 08 Task 2 embeds a rejected draft log format mid-prose (confusing to executor);
  REQUIRED .ilf fixture makes the suite machine-dependent by design (state the tradeoff in-plan);
  ARM_FAILED captures parse kind-less during the Plan-05 checkpoint window before Plan 08 lands
  (harmless — note it at the checkpoint so it isn't misread as a defect).

---

## Per-reviewer summaries

| Reviewer | Angle | Verdict | HIGH | Notes |
|---|---|---|---|---|
| Cursor | Byte layout | **CONVERGED** | 0 | Full recomputed byte map ✓; M1 seqlock write/read-order discipline for the discontiguous 1308/1312 span; M2 whole-buffer snapshot model unchanged |
| Codex | Wiring trace | CONCERNS | 1 (R1) | Size ownership, encode/decode symmetry, HOST_CMD pairing all clean |
| Sonnet | UX honesty | CONCERNS | 1 (R5) | All round-1 honesty fixes (C4/C6/C8/C9) audited genuine; new gaps R5, R11 |
| Opus | Data contracts | CONCERNS | 3 (R2,R3,R4) | + 8 MED (R6–R8, R12); cleared byte table, vocabularies, studioDir existence |
| Fable | New-claim fact-check | CONCERNS (non-blocking) | 0 | Replan claims almost universally VERIFIED; closures real; R9, R10, R13 items |

## Consensus summary

- **Agreed sound:** the entire binary channel layer (layout, ownership, symmetry) — four independent
  confirmations; and the round-1 fix set is genuinely applied (adversarially spot-checked).
- **Agreed concern class:** every HIGH this round lives in the **TS interface seams between plans**
  (who exports what, who resets what, which struct carries which field, wave-boundary compilability) —
  the layer below plan-checker granularity and above byte offsets.
- **Divergence worth noting:** only Opus went deep enough on TS contracts to surface R2–R4; no other
  reviewer contradicts them, and each is pinned to real source lines. Treat as confirmed, not majority-voted.

**Recommended next step:** `/gsd:plan-phase 5.1 --reviews` (round-3 targeted replan over R1–R12;
R13 items are one-line plan edits). The byte layer and wave/file topology need no rework.

## THE 15 REVISED PLANS

==================== .planning/phases/05.1-live-world-editor-productization/05.1-01-PLAN.md ====================
---
phase: 05.1-live-world-editor-productization
plan: 01
type: execute
wave: 0
depends_on: []
files_modified:
  - packages/renderer/src/services/decorationChannel.ts
  - packages/renderer/src/services/decorationChannel.test.ts
  - packages/renderer/src/services/ilf.ts
  - packages/renderer/src/services/ilf.test.ts
  - packages/renderer/src/services/decorationPersist.ts
  - packages/renderer/src/services/decorationPersist.test.ts
  - packages/harness/scripts/extract-ilf-fixtures.cjs
  - packages/harness/test/ilf-roundtrip.test.ts
  - packages/harness/fixtures-real/README.md
autonomous: false
requirements: [pivot-driven]
must_haves:
  truths:
    - "decorationResultLabel(REBIND_REFUSED) returns human words, never 'unknown result (-5)' (SC1)"
    - "A new .ilf row can be appended and later deleted without corrupting sibling rows or losing byte-exact round-trip fidelity (SC4)"
    - "assembleDecorationEdit-equivalent add/remove kinds write a correct .ilf + derived template (+ stock mirror when enabled) using the same fail-closed contract as the proven edit path (SC4)"
    - ".ilf is registered in the CORE-05 standing gate (packages/harness/fixtureRegistry.ts) with a REAL client-extracted fixture (not merely a byte-recipe one), and addNode/removeNode round-trip byte-exact against it — matching every other binary format's (tre/iff/dtii/stf/mesh) real-fixture discipline, per the project's ground-truth mandate. This is a REQUIRED assertion, not a skip-on-absent lane (REVIEWS.md C5 — the project has a real client install at D:/SWG Infinity/SWG Infinity/Live, confirmed present this session, so 'no real client available' is not an acceptable excuse for this format)."
  artifacts:
    - path: "packages/renderer/src/services/ilf.ts"
      provides: "addNode/removeNode pure mutators"
      contains: "export function addNode"
    - path: "packages/renderer/src/services/decorationPersist.ts"
      provides: "assembleDecorationEdit accepts a kind discriminator (edit|add|remove)"
    - path: "packages/harness/test/ilf-roundtrip.test.ts"
      provides: "CORE-05 registerFormat('ilf', ...) + byte-recipe/real-asset round-trip + addNode/removeNode assertions, real-asset lane REQUIRED not skipped"
      contains: "registerFormat('ilf'"
  key_links:
    - from: "packages/renderer/src/services/decorationPersist.ts"
      to: "packages/renderer/src/services/ilf.ts"
      via: "addNode/removeNode calls inside assembleDecorationEdit's add/remove branches"
      pattern: "addNode\\(|removeNode\\("
    - from: "packages/harness/test/ilf-roundtrip.test.ts"
      to: "packages/harness/fixtureRegistry.ts"
      via: "registerFormat('ilf', ...) call in beforeAll"
      pattern: "registerFormat\\('ilf'"
---

<objective>
Close the two Wave-0 gaps RESEARCH.md and VALIDATION.md both flag as blocking: (1) `decorationResultLabel()`
has no `REBIND_REFUSED` case, which is a live SC1 violation today (raw `-5` leaks through the one function
whose job is preventing that); (2) `ilf.ts` only edits existing rows — there is no way to append a new row
(ADD, D-01) or delete one (REMOVE, D-02). This plan builds both pure-data primitives and threads them into
`decorationPersist.ts`'s `assembleDecorationEdit` via a new `kind` discriminator (`'edit' | 'add' | 'remove'`),
extending the SAME fail-closed, byte-exact-tested module every later plan in this phase depends on.

Purpose: unblock every downstream ADD/REMOVE task (Waves 1-5) and fix a real, live SC1 defect today. This
revision also closes a ground-truth-mandate gap the checker flagged: `.ilf` had never been registered in
`packages/harness/fixtureRegistry.ts`'s CORE-05 standing gate, unlike every other binary format this project
ships (tre/iff/dtii/stf/mesh) — Tasks 2/3's byte-exact assertions were real but ran only against synthetic
in-code arrays (`makeStockIlf()`, `synthSbot()`), never a real-or-independently-encoded fixture registered in
the cross-package sweep. Task 4 closes that gap; Task 5 is a checkpoint confirming the real-asset lane is
GREEN (not merely acknowledging it as debt — see the CROSS-AI REVIEW REVISION note below).

**CROSS-AI REVIEW REVISION (2026-08-01, C5 — BLOCKER-adjacent HIGH, Codex/Cursor/Opus):** The original Task 4
let the real-asset addNode/removeNode round-trip SKIP cleanly when no real `.ilf` was extractable, and Task 5
offered "acknowledged — still owed" as an acceptable close. The cross-AI crew flagged this as contradicting
AGENTS.md's #1 constraint ("actual asset bytes before implementing any parser/serializer") for a
format-MUTATING change (row append/delete) — a real-asset round-trip must be mandatory here, not optional,
exactly as it already is for every other binary format this project ships. This session confirmed a real
client install exists at `D:/SWG Infinity/SWG Infinity/Live` (real `.tre` archives present, verified via `ls`)
— "no client available" is therefore not a valid reason to skip. Tasks 4 and 5 below are revised accordingly:
the real-asset lane is now a REQUIRED assertion (test FAILS, not skips, if no real `.ilf` extracts), and Task
5's checkpoint no longer offers an "acknowledged — still owed" resume phrase.
Output: `addNode`/`removeNode` in `ilf.ts`; a `kind`-aware `assembleDecorationEdit`; the missing
`REBIND_REFUSED` label case; byte-exact round-trip test coverage for append/delete; `.ilf` registered in the
CORE-05 standing gate with BOTH a byte-recipe fixture AND a required real-asset fixture.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/phases/05.1-live-world-editor-productization/05.1-RESEARCH.md
@.planning/phases/05.1-live-world-editor-productization/05.1-PATTERNS.md
@.planning/phases/05.1-live-world-editor-productization/05.1-VALIDATION.md
@.planning/phases/05.1-live-world-editor-productization/05.1-REVIEWS.md
</context>

<interfaces>
<!-- ilf.ts is dependency-free (module docstring, no imports). addNode/removeNode must stay that way. -->
From packages/renderer/src/services/ilf.ts (current, verbatim):
```typescript
export interface IlfNode { objectTemplateName: string; cellName: string; transform: number[]; }
export function editNodeTransform(nodes: IlfNode[], cellName: string, rowIndex: number, transformO2p: number[]): IlfNode[];
export function resolveNode(nodes: IlfNode[], objectTemplateName: string, transformO2p: number[], epsilon?: number): { cellName: string; rowIndex: number } | null;
```

From packages/renderer/src/services/decorationPersist.ts (current DecorationEdit shape, extend — do not fork):
```typescript
export interface DecorationEdit {
  buildingInstanceId: string;
  buildingTemplateVfsPath: string;
  cellName?: string;
  decorationTemplateName: string;
  originalO2p: number[];
  newO2p: number[];
}
```
</interfaces>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Fix decorationResultLabel REBIND_REFUSED gap</name>
  <files>packages/renderer/src/services/decorationChannel.ts, packages/renderer/src/services/decorationChannel.test.ts</files>
  <read_first>
    packages/renderer/src/services/decorationChannel.ts (lines 74-89, the decorationResultLabel switch)
    packages/renderer/src/services/decorationChannel.test.ts (lines 112-117, the describe block)
    packages/contracts/src/live-inject.ts (LIVE_DECORATION_RESULT.REBIND_REFUSED = -5, already shipped, no contract change)
  </read_first>
  <behavior>
    - decorationResultLabel(LIVE_DECORATION_RESULT.REBIND_REFUSED) returns a string matching /refused/i and
      containing no digit sequence equal to "-5" or "(−5)" (never a raw code).
    - Every other existing case (OK, NODE_NOT_FOUND, BUILDING_ID_MISMATCH, ABORTED, NOT_A_WS_NODE, the six
      SAVE_* codes) is unchanged — this is a pure addition, not a refactor.
  </behavior>
  <action>
    Insert a `case LIVE_DECORATION_RESULT.REBIND_REFUSED:` arm into the existing switch in
    decorationResultLabel(), immediately before the `default` arm, returning
    'rebind refused: template unresolvable or buildout-provenance node' (per PATTERNS.md's exact wording —
    matches the provider's own -1-refused semantics documented in decorationPersistOrchestrator.ts's callers).
    Do not touch any other case.
  </action>
  <verify>
    <automated>npm -w @swg/renderer run test -- decorationChannel</automated>
  </verify>
  <acceptance_criteria>
    decorationChannel.test.ts's decorationResultLabel describe block gains an assertion for REBIND_REFUSED
    matching /refused/i; `grep -c "REBIND_REFUSED" packages/renderer/src/services/decorationChannel.ts`
    (excluding the import line) is >= 1; full file's existing 10 other cases unchanged (diff shows one
    inserted line, zero deletions in the switch body).
  </acceptance_criteria>
  <done>decorationResultLabel never falls through to "unknown result" for REBIND_REFUSED; test is green.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: ilf.ts addNode/removeNode + byte-exact round-trip tests</name>
  <files>packages/renderer/src/services/ilf.ts, packages/renderer/src/services/ilf.test.ts</files>
  <read_first>
    packages/renderer/src/services/ilf.ts (full file — editNodeTransform lines 208-228 is the exact structural
    analog; resolveNode lines 180-201 for the within-cell identity model; module docstring lines 19-21 for the
    order-is-identity invariant)
    packages/renderer/src/services/ilf.test.ts (full file — the `sample` fixture at lines 12-20 and the
    editNodeTransform/round-trip describe blocks are the test idiom to extend, not replace)
  </read_first>
  <behavior>
    - addNode(nodes, newNode) returns a NEW array with newNode appended at the END; does not mutate `nodes`
      or `newNode.transform`; the appended node's within-cell rowIndex (per resolveNode/resolveRowIndex) is
      exactly the count of prior nodes sharing its cellName (guaranteed by append-only — no later node shares
      that cell yet).
    - addNode never throws (append is always valid).
    - removeNode(nodes, cellName, rowIndex) returns a NEW array with exactly that (cellName, rowIndex) node
      removed, all other nodes' object identity/content unchanged, and every LATER same-cell node's
      *effective* rowIndex shifts down by one (verified by re-running resolveRowIndex against the output, not
      by inspecting array position).
    - removeNode throws `ilf: no node at (cell="...", rowIndex=...)` on a missing target — same fail-closed
      contract as editNodeTransform (do not silently no-op).
    - serializeIlf(addNode(...)) -> parseIlf -> serializeIlf is byte-stable (round-trip through the format);
      same for removeNode. This is the byte-exact round-trip the project's ground-truth mandate requires for
      any .ilf format change — ilf.ts's FORM/NODE layout was already verified against
      InteriorLayoutReaderWriter.cpp (module docstring line 6); these tests extend that SAME verified format,
      they do not re-derive it.
  </behavior>
  <action>
    Add `addNode(nodes: IlfNode[], node: IlfNode): IlfNode[]` and
    `removeNode(nodes: IlfNode[], cellName: string, rowIndex: number): IlfNode[]` to ilf.ts, structurally
    matching editNodeTransform's clone-map + per-cell `seen` counter idiom (PATTERNS.md's exact proposed
    bodies, lines 339-358 of RESEARCH.md, already match this idiom verbatim — implement as written there).
    Keep both exports dependency-free (no new imports). Export both alongside the existing exports.
    In ilf.test.ts, add a new `describe('addNode')` and `describe('removeNode')` block using the SAME `sample`
    fixture and the SAME clone/new-array/input-not-mutated assertion triad as the existing editNodeTransform
    block (lines 62-69); add one byte-stability round-trip case per function mirroring lines 29-33; add one
    throw-on-missing-row case for removeNode mirroring lines 76-79; add one case asserting addNode's appended
    node resolves to the correct rowIndex via resolveRowIndex/resolveNode (not just array position).
  </action>
  <verify>
    <automated>npm -w @swg/renderer run test -- ilf</automated>
  </verify>
  <acceptance_criteria>
    All new tests green; `serializeIlf(addNode(sample, newNode))` round-trips byte-identically through
    parseIlf->serializeIlf; `resolveRowIndex(addNode(sample, newNode), newNode.cellName, ...)` returns the
    expected appended index; removeNode throws on an out-of-range (cellName, rowIndex) pair; existing
    editNodeTransform/resolveNode/resolveRowIndex tests remain green (no regression).
  </acceptance_criteria>
  <done>ilf.ts exports addNode/removeNode; both are covered by byte-exact round-trip tests extending the
  existing verified-format test suite.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: decorationPersist.ts kind-aware assembly (edit|add|remove) + byte-exact fixture tests</name>
  <files>packages/renderer/src/services/decorationPersist.ts, packages/renderer/src/services/decorationPersist.test.ts</files>
  <read_first>
    packages/renderer/src/services/decorationPersist.ts (full file — assembleDecorationEdit is the function to
    extend; DecorationEdit/DecorationPersistDeps/DecorationPersistResult are the interfaces to widen; the
    mirror-write block at lines 197-204 is a small, content-identifiable `if (deps.mirrorToStockIlf) { ... }`
    block that Plan 06 later refactors into a shared helper — leave this block's CONTENT unchanged in this
    task, only its surrounding context may shift line numbers as Task 3's edits land above it)
    packages/renderer/src/services/decorationPersist.test.ts (full file — the STOCK_ILF_VFS fixture at line 30
    and the "resolves the row, writes edited .ilf + derived template" test at line 75 is the exact idiom new
    add/remove cases must copy)
    packages/renderer/src/services/ilf.ts (this plan's Task 2 output — addNode/removeNode signatures)
    packages/renderer/src/services/decorationPersistOrchestrator.ts (ROUND 3, R3-seam prep — the local
    `sanitizeId` idiom this task also exports, unchanged in behavior, so Plan 06's new durable
    building-template map can key by the IDENTICAL sanitized id `edit_<id>.ilf`'s filename already uses)
  </read_first>
  <behavior>
    - DecorationEdit gains an optional `kind?: 'edit' | 'add' | 'remove'` field, defaulting to `'edit'` when
      absent (100% backward compatible — the proven live pipeline never sets it and keeps working unchanged).
    - kind='edit': existing behavior, byte-identical, zero regression (already covered by existing tests).
    - kind='add': assembleDecorationEdit does NOT call resolveNode/resolveRowIndex (there is no prior row to
      match); it requires `edit.cellName` to be set (throws a descriptive error if absent — an ADD with no
      cellName is a caller bug, fail closed) and calls addNode() to append a new IlfNode built from
      decorationTemplateName + newO2p into the accumulated-or-stock base (same base-resolution logic as the
      edit path: accumulated edited .ilf first, else stock). Returns a DecorationPersistResult whose rowIndex
      is the newly-appended node's within-cell index.
    - kind='remove': assembleDecorationEdit resolves the target row the SAME way edit does (resolveNode using
      originalO2p/decorationTemplateName, or resolveRowIndex when edit.cellName is pinned) and calls
      removeNode() instead of editNodeTransform(). `newO2p` is unused for this kind (may be omitted/ignored).
    - All three kinds still: write the edited .ilf + derived template into overrideDir; honor
      deps.mirrorToStockIlf (writes/updates the stock-path mirror for add/remove exactly as it already does
      for edit); return the SAME DecorationPersistResult shape (rowIndex, derivedTemplateVfsPath,
      editedIlfVfsPath, stagedEntries) so callers do not need a kind-specific result type.
    - A byte-exact fixture test proves: (a) an ADD assembly followed by parseIlf on the written bytes shows
      the new node appended with the right cellName/template/transform; (b) a REMOVE assembly followed by
      parseIlf shows the target row gone and sibling rows' content unchanged; (c) mirrorToStockIlf=true
      produces a stock-path 'modify' staged entry for both add and remove, matching the existing edit path's
      staged-entry shape.
    - **(ROUND 3 — REVIEWS.md R3/R5 seam prep, 2026-08-01):** `DecorationPersistResult` gains a `cellName:
      string` field — the resolved cell for 'edit'/'remove' (the SAME `resolved.cellName` the function already
      computes internally) or the caller-pinned `edit.cellName` for 'add' (always defined for that kind, per
      this task's own 'add' branch requiring it). This lets Plan 06's `handleDecorationCapture` and Plan 13's
      offline remove path report WHICH cell a persist touched without re-deriving it. `sanitizeId` (currently
      module-private, the exact `<id>` sanitizer that names `edit_<id>.ilf`/`edit_<id>.iff`) is now `export`ed
      unchanged — Plan 06 needs to key a new durable per-building map (R3) by the IDENTICAL sanitized id
      `worldEditorScan.ts` (Plan 04) reads off the override-dir filename, and must not re-implement or drift
      from this function's sanitization rules.
  </behavior>
  <action>
    Widen DecorationEdit with the optional `kind` field (default 'edit' inside assembleDecorationEdit via
    `edit.kind ?? 'edit'`). Branch assembleDecorationEdit's row-resolution + mutation step on kind: keep the
    existing resolveNode/resolveRowIndex + editNodeTransform path for 'edit'; add an 'add' branch requiring
    edit.cellName, building the new IlfNode as
    `{ objectTemplateName: edit.decorationTemplateName, cellName: edit.cellName, transform: edit.newO2p }` and
    calling ilf.ts's addNode; add a 'remove' branch reusing the existing resolve step then calling
    ilf.ts's removeNode instead of editNodeTransform. Keep the orphaned-edit-recovery retry-against-stock
    logic (currently lines 161-172 — an identifiable `if (resolved === null && baseIsAccumulated) { ... }`
    block, exact line numbers may shift as this task's edits land) applying to 'edit' and 'remove' only (an
    'add' has nothing to recover — it always succeeds against whichever base resolved). In
    decorationPersist.test.ts, add fixture-based describe blocks 'assembleDecorationEdit (kind=add)' and
    'assembleDecorationEdit (kind=remove)' copying the existing test's STOCK_ILF_VFS fake-readVfs setup,
    asserting parseIlf on the written bytes shows the correct node set per the behavior above, including one
    mirrorToStockIlf=true case per kind. Add `cellName` to the returned `DecorationPersistResult` object literal
    (populated from `resolved.cellName` for edit/remove, from `edit.cellName` for add) and add `export` to the
    existing `sanitizeId` function declaration (no other change to its body) — ROUND 3, R3 seam prep.
  </action>
  <verify>
    <automated>npm -w @swg/renderer run test -- decorationPersist</automated>
  </verify>
  <acceptance_criteria>
    All existing decorationPersist.test.ts cases remain green (zero regression on the proven edit path); new
    add/remove cases assert exact post-write node sets via parseIlf, not just "no throw"; an add call with no
    edit.cellName throws a descriptive error (asserted via expect(...).toThrow()); a remove call for an
    unresolvable target throws the same "could not resolve" error the edit path already uses; every
    successful assembleDecorationEdit call (all three kinds) returns a `cellName` matching the row it actually
    touched (asserted directly on the return value, not inferred from the written bytes alone); `sanitizeId` is
    importable from outside decorationPersist.ts (`export` present).
  </acceptance_criteria>
  <done>assembleDecorationEdit supports edit/add/remove behind one function, one result shape, fully covered
  by byte-exact fixture tests; the proven edit path is provably unchanged.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 4: Register .ilf in the CORE-05 standing gate — REQUIRED real-asset fixture, byte-exact addNode/removeNode round-trip</name>
  <files>packages/harness/scripts/extract-ilf-fixtures.cjs, packages/harness/test/ilf-roundtrip.test.ts, packages/harness/fixtures-real/README.md</files>
  <read_first>
    packages/harness/scripts/extract-stf-fixtures.cjs (full file — the extraction-script pattern to mirror:
    env-overridable candidate roots, mountTreMount, listMountEntries filtered by VFS prefix, write the first
    matching entry to fixtures-real/&lt;fmt&gt;/, hard-fail with searched roots/pattern printed on zero
    candidates — never a silent no-op)
    packages/harness/test/stf-roundtrip.test.ts (full file — the registerFormat pattern and the
    non-circular byte-recipe fixture idiom: hand-built by local byte-array helpers, NOT produced by calling the
    module's own serialize function — this is the independent-oracle discipline the round-trip proof requires.
    NOTE: this task deliberately does NOT copy stf-roundtrip.test.ts's real-asset SKIP-when-absent behavior —
    see the REVISED behavior below, C5)
    packages/harness/fixtureRegistry.ts (registerFormat/assertSweep — loaderSource MUST match
    /swg-client-v2|Utinni|tre_reader\.py/; the sweep only requires >=1 cited fixture per format, not
    specifically a real-asset one — that is a HARNESS-WIDE policy this task does not change; THIS task adds a
    stronger, format-LOCAL requirement on top of it, per C5)
    packages/harness/fixtures-real/README.md (asset-safety doctrine: fixtures-real/ is gitignored, extraction
    scripts are read-only on the client install, per D-09/D-10)
    packages/renderer/src/services/ilf.ts (this plan's Task 2 output — parseIlf/serializeIlf/addNode/
    removeNode; docstring lines 1-22 cite the InteriorLayoutReaderWriter.cpp:331-378 ground truth this task's
    fixtures reuse as their loaderSource citation)
    packages/renderer/src/services/decorationPersist.test.ts (STOCK_ILF_VFS/makeStockIlf/synthSbot — the
    synthetic in-code fixture Task 3 already uses; this task's harness fixture SUPPLEMENTS that unit-level
    coverage with the project's independent, cross-package CORE-05 gate — it does not replace Task 3's tests)
  </read_first>
  <behavior>
    - `.ilf` appears in `getRegistry()` (packages/harness/fixtureRegistry.ts) exactly like every other binary
      format this project ships (tre/iff/dtii/stf/mesh) — registered via `registerFormat('ilf', { parse:
      parseIlfFile, serialize: serializeIlfFile, fixtures: [...], loaderSource: 'swg-client-v2
      InteriorLayoutReaderWriter.cpp:331-378' })`, importing parseIlf/serializeIlf/addNode/removeNode from
      packages/renderer/src/services/ilf.ts by RELATIVE path (mirrors this repo's existing cross-package
      relative-import convention already used for native-core; vitest resolves the .ts source directly, no
      build step needed). **(ROUND 3 — REVIEWS.md MED-8, Opus):** `parseIlfFile`/`serializeIlfFile` are two
      NEW local wrapper functions, structurally identical to stf-roundtrip.test.ts's own `parseStfFile`/
      `serializeStfFile` wrappers — `FormatRegistryEntry.parse`/`.serialize` (fixtureRegistry.ts) are typed
      `(bytes: Uint8Array) => unknown` / `(parsed: unknown) => Uint8Array`, which `parseIlf(buf: Buffer):
      IlfNode[]`/`serializeIlf(nodes: IlfNode[]): Buffer`'s own signatures do NOT satisfy directly (a `Buffer`
      parameter is not assignable from a bare `Uint8Array`, and a function expecting `IlfNode[]` is not
      assignable to one expecting `unknown` under contravariant function-parameter checking) — `registerFormat`
      MUST be called with the WRAPPERS, never the raw `parseIlf`/`serializeIlf` functions directly, exactly as
      the stf precedent already does.
    - The fixtures array ALWAYS contains one INDEPENDENTLY-ENCODED byte-recipe fixture: raw FORM/INLY/0000/NODE
      bytes hand-built by a local `buildIlfFixture()` helper (mirrors stf-roundtrip.test.ts's buildStfFixture
      non-circularity — NOT produced by calling serializeIlf itself), containing at least 2 nodes sharing one
      cellName (exercises within-cell rowIndex) and 1 node in a second cellName.
    - `packages/harness/scripts/extract-ilf-fixtures.cjs` attempts to extract ONE real `.ilf` from an
      installed client (same candidate-root + env-override convention as extract-stf-fixtures.cjs:
      SWG_ILF_FIXTURE_CLIENT_ROOT, then 'D:/SWG Infinity/SWG Infinity/Live' — CONFIRMED PRESENT this session,
      real `.tre` archives verified on disk — then 'D:/SWGEmu Client/SWGEmu' as a fallback candidate ONLY;
      ROUND 3, REVIEWS.md R13 — Fable confirmed this fallback path does NOT exist on this machine, so it must
      never be treated as the primary/required root — the SWG Infinity install is what actually satisfies this
      task's REQUIRED real-asset lane; the script must skip a nonexistent candidate root silently and continue
      to the next one, per its own "searched roots printed on zero candidates" hard-fail contract, not treat a
      missing fallback as an error on its own),
      searching VFS prefix 'interiorlayout/' for entries ending '.ilf' via listMountEntries, writing the first
      entry whose bytes pass a structural sanity check (FORM tag @ offset 0, 'INLY' subtype @ offset 8, inner
      FORM '0000' at the nested offset — the same tag layout ilf.ts's own docstring documents) to
      fixtures-real/ilf/&lt;basename&gt;.ilf. Hard-fails (non-zero exit, printing searched roots/pattern) on
      zero candidate roots or zero structurally-valid entries — never a silent no-op, matching
      extract-stf-fixtures.cjs's own contract.
    - Byte-exact round-trip (`assertRoundTrip`) passes for the byte-recipe fixture through parseIlf ->
      serializeIlf.
    - `addNode`/`removeNode` round-trip byte-exact against the byte-recipe fixture: addNode(recipe, newNode)
      -> serializeIlf -> parseIlf recovers the appended node at the correct within-cell rowIndex, byte-stable
      on a second round-trip; removeNode(recipe, cellName, rowIndex) -> serializeIlf -> parseIlf shows the
      target row gone, every sibling node byte-identical.
    - **REVISED (2026-08-01, REVIEWS.md C5 — was skip-on-absent, now REQUIRED):** the real-asset lane is NOT
      optional. This task's execution MUST run
      `node packages/harness/scripts/extract-ilf-fixtures.cjs` against the confirmed-present
      `D:/SWG Infinity/SWG Infinity/Live` client (or the env-override root) BEFORE writing the test's
      pass/fail assertions. The nested "real .ilf" describe block in ilf-roundtrip.test.ts runs the SAME
      addNode/removeNode byte-exact assertions unconditionally — if `fixtures-real/ilf/*.ilf` is absent when
      the test suite runs, that describe block FAILS (a thrown/failing assertion, e.g.
      `expect(loadRealIlfFixture()).not.toBeNull()`), it does NOT log a SKIP line and return. The byte-recipe
      fixture registration in getRegistry() stays as an ADDITIONAL, independent-oracle safety net (matching
      every other format's discipline) — it does not substitute for the real-asset requirement this format
      specifically owes per the ground-truth mandate for a format-mutating (append/delete) change.
    - Extend fixtures-real/README.md with a `.ilf` section documenting the extraction command and VFS prefix,
      matching the file's existing `.tre`/doctrine style.
  </behavior>
  <action>
    Create packages/harness/scripts/extract-ilf-fixtures.cjs mirroring extract-stf-fixtures.cjs's structure
    exactly (candidate-root resolution, mountTreMount, listMountEntries filter, write-first-structurally-valid,
    hard-fail-on-zero), swapping the VFS prefix to 'interiorlayout/' and the extension to '.ilf', and swapping
    the native parseStf validation call for a local structural check (inline byte comparison against the
    'FORM'/'INLY'/'0000' tag layout — this script is CJS and does not import the ESM ilf.ts parser; the FULL
    parse/serialize round-trip validation happens in the vitest test file below, which imports ilf.ts directly
    and IS able to resolve TypeScript). Run the extraction script against the confirmed-present
    `D:/SWG Infinity/SWG Infinity/Live` client as part of completing this task (not merely writing the script
    — the fixture file must actually land in packages/harness/fixtures-real/ilf/ before this task is done).
    Create packages/harness/test/ilf-roundtrip.test.ts importing `parseIlf`, `serializeIlf`, `addNode`,
    `removeNode`, and the `IlfNode` type from '../../renderer/src/services/ilf.js' (relative path, '.js'
    extension per this repo's NodeNext-style TS import convention — vitest resolves it to ilf.ts),
    implementing `buildIlfFixture()` as a hand-rolled byte builder (mirrors stf-roundtrip.test.ts's
    buildStfFixture: local le32/asciiz-style byte helpers, NOT a call into serializeIlf), a
    `loadRealIlfFixture()` helper mirroring loadRealStfFixture's "first *.ilf file in fixtures-real/ilf/"
    convention, local `parseIlfFile(bytes: Uint8Array): IlfNode[]` (calls `parseIlf(Buffer.from(bytes.buffer,
    bytes.byteOffset, bytes.byteLength))`) and `serializeIlfFile(parsed: unknown): Uint8Array` (calls `new
    Uint8Array(serializeIlf(parsed as IlfNode[]))`) wrapper functions per MED-8 above, and a `beforeAll` that
    calls `registerFormat('ilf', {...})` — using the WRAPPERS as `parse`/`serialize`, not the raw ilf.ts
    exports — with the fixtures array as specified in the behavior section. Write the round-trip + addNode/removeNode test cases per the behavior
    spec, WITHOUT a conditionally-skipping real-asset describe block — the real-asset case is a plain,
    unconditional `describe`/`it` that fails loudly (not a SKIP) if `loadRealIlfFixture()` returns null. Extend
    fixtures-real/README.md with the `.ilf` section.
  </action>
  <verify>
    <automated>node packages/harness/scripts/extract-ilf-fixtures.cjs &amp;&amp; npx vitest run packages/harness/test/ilf-roundtrip.test.ts packages/harness/test/registry-coverage.test.ts</automated>
  </verify>
  <acceptance_criteria>
    `getRegistry()['ilf']` has >=1 fixture whose loaderSource matches /swg-client-v2|Utinni|tre_reader\.py/
    (registry-coverage.test.ts's sweep stays green with 'ilf' included); the byte-recipe fixture's
    addNode/removeNode round-trip is asserted via assertRoundTrip (byte-exact, not value-level equality);
    `packages/harness/fixtures-real/ilf/` contains at least one extracted `.ilf` file after this task runs;
    the real-asset addNode/removeNode round-trip assertions PASS against it (not skipped, not conditionally
    gated) — the test suite FAILS if this fixture is absent, per C5's mandatory-not-optional requirement.
  </acceptance_criteria>
  <done>`.ilf` is registered in the CORE-05 standing gate exactly like every other binary format this project
  ships (tre/iff/dtii/stf/mesh); addNode/removeNode are proven byte-exact against BOTH a byte-recipe fixture
  AND a REQUIRED real client-extracted fixture, closing the ground-truth-mandate gap the checker flagged and
  the cross-AI crew's C5 finding.</done>
</task>

<task type="checkpoint:human-verify" gate="blocking">
  <name>Task 5: Real-.ilf extraction confirmation checkpoint</name>
  <files>packages/harness/fixtures-real/ilf/</files>
  <action>
    Pause for human verification. Task 4 extracted a real `.ilf` from the confirmed-present
    `D:/SWG Infinity/SWG Infinity/Live` client into packages/harness/fixtures-real/ilf/ (gitignored) and ran
    the byte-exact addNode/removeNode round-trip against it as a REQUIRED (not optional) assertion. Confirm
    the real-asset lane is actually green, per the steps below.
  </action>
  <what-built>
    Task 4 extracted a real `.ilf` from the installed client into packages/harness/fixtures-real/ilf/ and ran
    the SAME addNode/removeNode byte-exact round-trip against it that the byte-recipe fixture already proves.
    Per REVIEWS.md C5, this is now a REQUIRED assertion — the test suite fails if the fixture is absent, so
    reaching this checkpoint at all means the real-asset lane is exercised, not skipped.
  </what-built>
  <how-to-verify>
    1. Confirm `packages/harness/fixtures-real/ilf/` contains at least one `.ilf` file (gitignored — check the
       local filesystem directly, not `git status`).
    2. Run `npx vitest run packages/harness/test/ilf-roundtrip.test.ts` and confirm the real-asset describe
       block's tests are PASSING (there is no skip path to fall back to — if this fails, Task 4 is not
       actually done; do not close this checkpoint, return to Task 4).
    3. Type "confirmed — real .ilf fixture in place and round-trip green" to close this checkpoint.
  </how-to-verify>
  <resume-signal>Type the exact phrase from step 3 once both checks hold. If the real-asset lane is failing or
  the fixture is missing, do NOT approve this checkpoint — report the failure so Task 4 can be completed
  first.</resume-signal>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| renderer → disk (client override dir) | assembleDecorationEdit writes `.ilf`/derived-template bytes into a real client install's loose override directory. |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-05.1-01a | Tampering | decorationPersist.ts (kind='add' path) | mitigate | New IlfNode's `cellName`/`objectTemplateName` are written only as `.ilf` chunk payload bytes (asciiz strings inside a binary chunk), never used to construct a filesystem path directly — the write target path is still `edit_<sanitizeId(buildingInstanceId)>.ilf`, unchanged from the proven edit path (sanitizeId already strips to `[a-z0-9_]`). No new path-construction surface introduced. |
| T-05.1-01b | Repudiation | decorationPersist.ts | accept | Local single-user desktop tool; no multi-user audit requirement for this data-only mutator. |
| T-05.1-01c | Tampering | packages/harness/scripts/extract-ilf-fixtures.cjs | mitigate | Read-only on the client install (mounts and reads TRE archives, never writes them); the ONLY write target is packages/harness/fixtures-real/ilf/ (gitignored, per D-09/D-10 asset-safety doctrine) — mirrors extract-stf-fixtures.cjs's already-accepted threat posture exactly, no new pattern introduced. |
</threat_model>

<verification>
`npm -w @swg/renderer run test -- ilf decorationPersist decorationChannel` green; `tsc --noEmit` clean for
packages/renderer; `node packages/harness/scripts/extract-ilf-fixtures.cjs && npx vitest run
packages/harness/test/ilf-roundtrip.test.ts packages/harness/test/registry-coverage.test.ts` green with the
real-asset lane PASSING (not skipped); Task 5's checkpoint approved only if the real-asset lane is green.
</verification>

<success_criteria>
decorationResultLabel(REBIND_REFUSED) returns words, never a raw code (SC1 fix). ilf.ts exports addNode/
removeNode with byte-exact round-trip coverage (SC4 groundwork). assembleDecorationEdit accepts kind='add'/
'remove' with fixture-verified correctness and zero regression on the proven edit path (SC4/SC5 groundwork).
`.ilf` is registered in the CORE-05 standing gate exactly like every other binary format this project ships,
with BOTH a byte-recipe fixture and a REQUIRED real-asset fixture proving addNode/removeNode byte-exact
(ground-truth mandate, C5).
</success_criteria>

<output>
Create `.planning/phases/05.1-live-world-editor-productization/05.1-01-SUMMARY.md` when done
</output>

==================== .planning/phases/05.1-live-world-editor-productization/05.1-02-PLAN.md ====================
---
phase: 05.1-live-world-editor-productization
plan: 02
type: execute
wave: 0
depends_on: []
files_modified:
  - packages/contracts/src/workspace.ts
  - packages/renderer/src/services/projectBinding.ts
  - packages/renderer/src/services/projectBinding.test.ts
autonomous: true
requirements: [pivot-driven]
must_haves:
  truths:
    - "The mirror-mode default (ON) and any saved teleport bookmarks persist per-project across app restarts (SC3, D-07)"
    - "A building's stock building-template VFS path, once observed on a live capture, is remembered durably per-project so an OFFLINE action (Remove, Plan 13) that never sees a live capture can still resolve it (REVIEWS.md R3 — ground-truth constraint: this value cannot be re-derived from override-dir bytes alone, see this plan's ROUND 3 revision note)"
  artifacts:
    - path: "packages/contracts/src/workspace.ts"
      provides: "WorkspaceBindingMeta.mirrorToStockIlf, .worldEditorBookmarks, and .worldEditorBuildingTemplates fields"
      contains: "mirrorToStockIlf?: boolean"
  key_links:
    - from: "packages/renderer/src/services/projectBinding.ts"
      to: "packages/contracts/src/workspace.ts"
      via: "updateWorkspaceMeta/readWorkspaceJson persisting the new fields"
      pattern: "mirrorToStockIlf"
---

<objective>
Add the per-project persistence surface D-08 (mirror-mode toggle default) and D-07 (teleport bookmarks) both
need, following the SAME-DAY `liveClientExe` precedent exactly — no new file format, no new persistence
mechanism, just three more optional fields on `WorkspaceBindingMeta` written through the existing atomic
tmp+rename `workspace.json` idiom.

**ROUND 3 REVISION (2026-08-01, REVIEWS.md R3 — HIGH, Opus, source-confirmed):** `assembleDecorationEdit`
(Plan 01) requires a `buildingTemplateVfsPath` (the STOCK building template's own VFS path, e.g.
`object/building/tatooine/shared_cantina_tatooine.iff`) for EVERY call, including Plan 13's offline Remove
action — but this value is NOT recoverable from the override dir's bytes alone: `deriveBuildingTemplate`
(buildingTemplate.ts, verified this session against its own test fixture) copies the stock building's bytes
verbatim except `interiorLayoutFileName`, and its DERV/base chunk names a GENERIC shared base template
(`object/building/base/shared_base.iff` in the real cantina fixture), never the SPECIFIC stock building's own
filename — there is no self-referential "this is my own VFS path" field anywhere in the IFF format. A LIVE
capture always carries this value fresh (`capture.buildingTemplateVfsPath`, resolved agent-side), but Remove is
an OFFLINE, disk-scan-driven action with no live capture to read it from. This plan adds a THIRD optional
field, `worldEditorBuildingTemplates?: Record<string, string>` (sanitized building id → stock
`buildingTemplateVfsPath`), populated by Plan 06's orchestrator on every successful live edit/add capture —
reusing this SAME already-established per-project atomic-write mechanism (not a new store, not a new file
format; a `mirrorToStockIlf`-shaped sibling field on the identical `workspace.json`), so Plan 04's scan and
Plan 13's offline Remove can recover the value later without re-deriving it from bytes that don't carry it.

Purpose: give the orchestrator (Plan 06) and the World panel (Plan 10) a settled, tested read/write surface
for mirror-mode + bookmarks + the building-template durable map before any of them consume it.
Output: extended `WorkspaceBindingMeta`; `@swg/contracts` rebuilt; `projectBinding.ts` helpers proven via
tests.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/phases/05.1-live-world-editor-productization/05.1-RESEARCH.md
@.planning/phases/05.1-live-world-editor-productization/05.1-PATTERNS.md
</context>

<interfaces>
From packages/contracts/src/workspace.ts (current WorkspaceBindingMeta, extend verbatim-style):
```typescript
export interface WorkspaceBindingMeta {
  projectName?: string;
  kind: 'client' | 'tre-set' | 'mod-project';
  clientPath: string | null;
  cfgPath?: string;
  treDir?: string;
  pattern?: string;
  serverConfig?: WorkspaceInfo['serverConfig'];
  liveClientExe?: string;
  worldEditorBuildingTemplates?: Record<string, string>;
}
```

From packages/renderer/src/services/projectBinding.ts (current helpers, reuse verbatim — no new persistence code):
```typescript
export function writeWorkspaceJson(studioDir: string, meta: WorkspaceBindingMeta): void;
export function readWorkspaceJson(studioDir: string): WorkspaceBindingMeta;
export function updateWorkspaceMeta(studioDir: string, patch: Partial<WorkspaceBindingMeta>): void;
```
</interfaces>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Extend WorkspaceBindingMeta (mirror toggle + bookmarks) and rebuild contracts</name>
  <files>packages/contracts/src/workspace.ts</files>
  <read_first>
    packages/contracts/src/workspace.ts (full file — the liveClientExe field at lines 102-105 is the exact
    precedent to copy)
  </read_first>
  <action>
    Add three optional fields to `WorkspaceBindingMeta`, immediately after `liveClientExe`: `mirrorToStockIlf?:
    boolean` (D-08: per-project decoration mirror-mode default; treat as `true` when absent — the caller
    resolves the default, this field only stores an explicit override), `worldEditorBookmarks?: { name:
    string; scene: string; x: number; y: number; z: number }[]` (D-07: saved World-panel teleport bookmarks),
    and `worldEditorBuildingTemplates?: Record<string, string>` (ROUND 3, R3: sanitized building id → that
    building's stock `buildingTemplateVfsPath`, the durable memory a live capture observes and an offline
    action like Remove cannot re-derive from bytes — see this plan's ROUND 3 revision note). Doc-comment each
    field the same style as the existing ones (one-line purpose + which decision/finding it serves).
    Run `npm -w @swg/contracts run build` after editing — the renderer imports the gitignored `dist/`, so this
    build step is REQUIRED before Task 2 can type-check against the new fields.
  </action>
  <verify>
    <automated>npm -w @swg/contracts run build &amp;&amp; npm -w @swg/contracts run test</automated>
  </verify>
  <acceptance_criteria>
    `dist/index.js`/`dist/index.d.ts` (or equivalent build output) exposes the two new optional fields on
    WorkspaceBindingMeta; `tsc --noEmit -p packages/contracts` is clean.
  </acceptance_criteria>
  <done>WorkspaceBindingMeta carries mirrorToStockIlf and worldEditorBookmarks; contracts package rebuilt.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: projectBinding.ts read/write coverage for the two new fields</name>
  <files>packages/renderer/src/services/projectBinding.ts, packages/renderer/src/services/projectBinding.test.ts</files>
  <read_first>
    packages/renderer/src/services/projectBinding.ts (full file — writeWorkspaceJson/readWorkspaceJson/
    updateWorkspaceMeta, the atomic tmp+rename write; do not add a second write path)
    packages/renderer/src/services/projectBinding.test.ts (existing test file — mirror its fixture-dir
    setup/teardown pattern for the new cases; do not invent a new fixture idiom)
  </read_first>
  <behavior>
    - updateWorkspaceMeta(studioDir, { mirrorToStockIlf: false }) persists the field; a subsequent
      readWorkspaceJson(studioDir) returns mirrorToStockIlf === false.
    - updateWorkspaceMeta(studioDir, { worldEditorBookmarks: [...] }) persists the array verbatim (name/
      scene/x/y/z all round-trip through JSON without precision loss for typical world coordinates).
    - updateWorkspaceMeta(studioDir, { worldEditorBuildingTemplates: { '1082874': 'object/building/tatooine/
      shared_cantina_tatooine.iff' } }) persists the map verbatim; a SECOND updateWorkspaceMeta call adding a
      different building id to the map does not drop the first (callers are expected to merge — spread the
      PREVIOUS `readWorkspaceJson(studioDir).worldEditorBuildingTemplates` before adding a key — this test
      proves the underlying read/write round-trips the whole object, not that updateWorkspaceMeta itself
      merges nested objects; it does a shallow patch like every other field, per its existing contract).
    - readWorkspaceJson on a workspace.json written BEFORE this change (no mirrorToStockIlf/
      worldEditorBookmarks keys present) returns an object with those fields simply absent/undefined — no
      throw, no default injected at the read layer (default resolution is the CALLER's job, per D-08's "read
      at persist time" contract — this function is a pure passthrough).
    - The write is still atomic tmp+rename (no new write path introduced) — assert by checking no `.tmp` file
      survives after a successful updateWorkspaceMeta call.
  </behavior>
  <action>
    No new functions needed — writeWorkspaceJson/readWorkspaceJson/updateWorkspaceMeta already handle any
    WorkspaceBindingMeta shape generically. Add test cases to projectBinding.test.ts proving the behavior
    above using the SAME temp-dir fixture pattern the existing tests already use (do not add a new helper
    file). If the test file has no existing "extend WorkspaceBindingMeta" precedent to copy (it may only
    cover kind/clientPath today), model the new cases directly after the existing liveClientExe-equivalent
    round-trip assertions if present, or after the simplest existing read/write round-trip test otherwise.
  </action>
  <verify>
    <automated>npm -w @swg/renderer run test -- projectBinding</automated>
  </verify>
  <acceptance_criteria>
    New tests assert byte-for-byte field round-trip for mirrorToStockIlf, worldEditorBookmarks, AND
    worldEditorBuildingTemplates through write-then-read; a pre-existing-file backward-compat case (missing
    keys) is asserted not to throw; no `.tmp` file remains in the fixture dir after a successful write.
  </acceptance_criteria>
  <done>projectBinding.ts proven to read/write mirrorToStockIlf, worldEditorBookmarks, AND
  worldEditorBuildingTemplates through the existing atomic per-project persistence idiom, with backward-compat
  coverage for pre-existing workspace.json files.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| renderer → disk (`.studio/workspace.json`) | Per-project settings file, atomic tmp+rename write, local-only. |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-05.1-02a | Tampering | worldEditorBookmarks (free-text `name`/`scene` fields) | mitigate | Values are stored as plain JSON string/number fields in workspace.json and are NEVER used to construct a filesystem path or shell command — they are display/lookup data only, consumed later (Plan 11) purely as UI text + a teleport-command payload string (bounded 128-byte channel slot per T-05.1-07). No path-construction risk at this layer. |
| T-05.1-02b | Tampering | JSON write | accept | Existing atomic tmp+rename write is unchanged; no new corruption surface introduced by adding optional fields to an already-atomic writer. |
</threat_model>

<verification>
`npm -w @swg/contracts run build && npm -w @swg/renderer run test -- projectBinding` green; `tsc --noEmit`
clean for both packages.
</verification>

<success_criteria>
WorkspaceBindingMeta carries mirrorToStockIlf (D-08), worldEditorBookmarks (D-07), and
worldEditorBuildingTemplates (R3 — the durable per-building stock-template-path memory Plan 06/04/13 need);
all three persist and round-trip through the existing per-project atomic-write idiom, proven by tests, with
zero new persistence mechanism introduced.
</success_criteria>

<output>
Create `.planning/phases/05.1-live-world-editor-productization/05.1-02-SUMMARY.md` when done
</output>

==================== .planning/phases/05.1-live-world-editor-productization/05.1-03-PLAN.md ====================
---
phase: 05.1-live-world-editor-productization
plan: 03
type: execute
wave: 0
depends_on: []
files_modified:
  - packages/contracts/src/live-inject.ts
  - packages/live-inject/agent/channel.h
  - packages/live-inject/agent/channel.cpp
  - packages/live-inject/src/channel_binding.cpp
autonomous: true
requirements: [pivot-driven]
must_haves:
  truths:
    - "The wire contract both C++ sides and the renderer share stays a single named mapping (no second CreateFileMappingA) as it grows to carry ADD identity and the new host->agent action commands (SC4)"
    - "A REBIND_FLAGS.MIRROR_OFF bit exists on both sides of the wire, defined before Plan 06 (writer) or Plan 05 (reader) touch it, so the agent's status strip can render D-10's 'saved (not visible here)' variant without any per-project-settings knowledge (D-10 groundwork)"
    - "channel.cpp's static_assert(sizeof(LiveState)==...) and channel_binding.cpp's CHANNEL_BYTE_SIZE are bumped to 1864 IN THIS PLAN, with offsetof asserts for every new field, so the agent DLL and host addon both build against the size THIS plan defines (REVIEWS.md C1, BLOCKER)"
    - "The agent-side ENCODE of CAPTURE_KIND/CAPTURE_CELL_NAME (channel.h's small DecorationCapture struct + channel.cpp's channelWriteCapture) is implemented in THIS plan, so Plan 12's kind=ADD capture path (which only touches overlay.cpp) has real fields to write into (REVIEWS.md C2, BLOCKER — encode half; the decode half lands in Plan 08)"
  artifacts:
    - path: "packages/contracts/src/live-inject.ts"
      provides: "CAPTURE_KIND/CAPTURE_CELL_NAME fields and the new LIVE_HOST_CMD_LAYOUT region"
      contains: "LIVE_HOST_CMD_ACTION"
    - path: "packages/live-inject/agent/channel.h"
      provides: "LiveState struct mirror of the same layout, byte-for-byte, plus the small DecorationCapture struct's kind/cellName members"
      contains: "hostCmdAction"
    - path: "packages/live-inject/agent/channel.cpp"
      provides: "static_assert(sizeof(LiveState) == 1864, ...) + offsetof asserts for every new field; channelWriteCapture writes kind/cellName inside the existing seqlock span"
      contains: "1864"
    - path: "packages/live-inject/src/channel_binding.cpp"
      provides: "CHANNEL_BYTE_SIZE = 1864"
      contains: "CHANNEL_BYTE_SIZE = 1864"
  key_links:
    - from: "packages/live-inject/agent/channel.h"
      to: "packages/contracts/src/live-inject.ts"
      via: "matching byte offsets (both sides hand-verified against this plan's offset table)"
      pattern: "offset: 1440|hostCmdSeqCounter"
    - from: "packages/live-inject/agent/channel.cpp"
      to: "packages/live-inject/src/channel_binding.cpp"
      via: "both files agree on the SAME total byte size (1864), asserted at compile time (channel.cpp) and used as the mapping/view size (channel_binding.cpp)"
      pattern: "1864"
---

<objective>
Define, in ONE plan and BEFORE any consumer touches them, the two wire-contract extensions the rest of this
phase's ADD/REMOVE/Scene-accordion work builds against: (1) a `kind`/`cellName` extension to the existing
DecorationCapture/CAPTURE region so the agent can tell the renderer "this is a brand-new placement, not an
edit of an existing row" (D-01), including a third `ARM_FAILED` kind reused to surface an arm-attempt failure
reason (C8 — see Task 4); (2) a new, single, reusable `LIVE_HOST_CMD` region carrying host->agent one-shot
action requests (reload scene / load editor scene / teleport / start placement / cancel placement / despawn a
node) with a matching agent-published result — ONE region for all six actions (discriminated by an action
enum), not six separate channel regions, per the file's own "extend, don't fork" doctrine.

**CROSS-AI REVIEW REVISION (2026-08-01, C1 BLOCKER + C2 BLOCKER, Codex/Cursor/Opus/Fable, source-confirmed
this session against real `channel.cpp:25` and `channel_binding.cpp:58`):** The original version of this plan
grew `LiveState` in `contracts/live-inject.ts` and `channel.h` from 1308 to 1864 bytes but left
`channel.cpp:25`'s `static_assert(sizeof(LiveState) == 1308, ...)` and `channel_binding.cpp:58`'s
`CHANNEL_BYTE_SIZE = 1308` completely unowned — the agent DLL would fail to COMPILE at the first Wave-1 build
(Plan 05), in a file Plan 05 does not own, and even if a build somehow proceeded, `channel_binding.cpp`'s
stale 1308 would silently truncate `readChannelView`'s copy, causing Plan 08's offset-1856/1860 reads to
throw a DataView RangeError on every real poll tick while unit tests (which use a synthetic 1864-byte buffer)
stayed green. Separately, the original plan explicitly declined to touch `channel.h`'s SMALL
`DecorationCapture` plain-data struct (the one `persistDecorationEdit` builds and `channelWriteCapture`
writes) and `channel.cpp`'s `channelWriteCapture` body — leaving the ADD-identity kind/cellName ENCODE path
unowned; Plan 12 (files_modified: overlay.cpp only) has no ability to touch channel.h/channel.cpp, so it could
never actually populate those fields on the wire. This revision makes THIS plan own all four size/assert
touchpoints AND the small-struct + channelWriteCapture encode extension. The DECODE half (parseDecorationCapture
in decorationChannel.ts) is fixed in Plan 08 (which already depends on this plan and runs in a strictly later
wave, so no file-overlap/wave conflict is introduced by that split).

This is Interface-First groundwork: no BEHAVIORAL logic lands here beyond the mechanical struct-copy inside
channelWriteCapture, so every later C++ and TypeScript plan in this phase (05, 06, 07, 08, 09, 12) implements
against an already-agreed, ALREADY-COMPILING byte layout instead of re-deriving it or discovering a build
break mid-wave.

Purpose: unblock ADD (D-01), the World panel's Scene accordion (D-07), and REMOVE's live-despawn case (D-02)
with one coherent, minimal channel-protocol extension — and make the whole thing actually BUILD and CARRY DATA
end-to-end, not just type-check.
Output: `packages/contracts/src/live-inject.ts`, `packages/live-inject/agent/channel.h`,
`packages/live-inject/agent/channel.cpp`, and `packages/live-inject/src/channel_binding.cpp` updated in
lock-step, byte-offset-identical, with the struct's total size grown from 1308 to 1864 bytes and BOTH C++
files' size/assert literals bumped to match. A third, small addition (Task 3) defines
`LIVE_DECORATION_REBIND_FLAGS.MIRROR_OFF` — D-10's in-game hybrid-session-warning signal — on both sides,
ahead of Plan 06 (the writer) and Plan 05 (the reader), per the same Interface-First posture. A fourth
addition (Task 4) adds a third CAPTURE kind, `ARM_FAILED`, reusing the CAPTURE_CELL_NAME slot to carry an
arm-failure reason string (C8), so a later plan can wire the World panel's failure history without a NEW
channel field.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/phases/05.1-live-world-editor-productization/05.1-RESEARCH.md
@.planning/phases/05.1-live-world-editor-productization/05.1-PATTERNS.md
@.planning/phases/05.1-live-world-editor-productization/05.1-REVIEWS.md
</context>

<interfaces>
From packages/contracts/src/live-inject.ts (current, DO NOT reorder/renumber existing offsets — only append):
```typescript
export const LIVE_DECORATION_LAYOUT = {
  // ... CAPTURE_SEQ_COUNTER..CAPTURE_BUILDING_TEMPLATE (400-1024), REBIND region (1024-1300),
  // RESULT_CODE: { offset: 1300, length: 4 }, RESULT_EPOCH: { offset: 1304, length: 4 },
} as const;
export const LIVE_CHANNEL_TOTAL_SIZE = 1308;
```
From packages/live-inject/agent/channel.h (current struct tail, DO NOT reorder existing members):
```cpp
struct LiveState {
    // ... existing members through resultEpoch (offset 1304) ...
    uint32_t  resultEpoch;                // offset 1304
};

/** One captured decoration move the agent publishes to the CAPTURE region -- a SEPARATE, SMALLER
 *  plain-data struct than LiveState; this is what persistDecorationEdit builds and
 *  channelWriteCapture copies field-by-field into the LiveState CAPTURE region. */
struct DecorationCapture {
    uint64_t buildingId;
    float    originalO2p[3][4];
    float    newO2p[3][4];
    char     decorationTemplate[256];
    char     buildingTemplate[256];
};
```
From packages/live-inject/agent/channel.cpp (verified `channel.cpp:25` this session -- DO NOT
reorder/remove existing asserts, only append new ones and bump the total):
```cpp
static_assert(sizeof(LiveState) == 1308, "LiveState size must match LIVE_CHANNEL_TOTAL_SIZE");
// ... offsetof asserts through resultEpoch (1304) ...

void channelWriteCapture(const DecorationCapture* cap, uint32_t epoch) {
    // seq -> odd; writes captureEpoch/captureBuildingId/captureOriginalO2p/captureNewO2p/
    // captureDecorationTemplate/captureBuildingTemplate; seq -> even.
}
```
From packages/live-inject/src/channel_binding.cpp (verified `channel_binding.cpp:58` this session):
```cpp
static constexpr size_t CHANNEL_BYTE_SIZE = 1308;  // == sizeof(LiveState); grows to 1864 in this plan
```
</interfaces>

<tasks>

<task type="auto">
  <name>Task 1: CAPTURE kind/cellName extension (ADD identity, D-01) -- contract + agent-side ENCODE</name>
  <files>packages/contracts/src/live-inject.ts, packages/live-inject/agent/channel.h, packages/live-inject/agent/channel.cpp</files>
  <read_first>
    packages/contracts/src/live-inject.ts (full LIVE_DECORATION_LAYOUT block, lines 250-317, and the
    DecorationCapture interface, lines 95-104)
    packages/live-inject/agent/channel.h (full LiveState struct, lines 54-95, and the DecorationCapture
    plain-data struct at lines 149-155 -- note this is a SEPARATE, smaller struct than the channel-region
    struct; BOTH structs need the new members in this revised task -- LiveState (the wire region) AND this
    small struct (what the agent-side caller builds before handing it to channelWriteCapture))
    packages/live-inject/agent/channel.cpp (full file -- `channelWriteCapture`, currently the block that
    copies `cap->buildingId`/`originalO2p`/`newO2p`/`decorationTemplate`/`buildingTemplate` field-by-field into
    `ls->capture*` INSIDE the existing `InterlockedIncrement(seq)` ... `InterlockedIncrement(seq)` critical
    section -- the new kind/cellName copy MUST land inside that SAME critical section, not after it, per
    Opus's L6 finding: the new fields live at offset 1308/1312, non-contiguous with the rest of the CAPTURE
    payload (400-768), so correctness depends ENTIRELY on being written/read inside the existing seqlock span,
    not on physical adjacency)
  </read_first>
  <action>
    In live-inject.ts: add `kind?: 'edit' | 'add' | 'arm-failed'` and `cellName?: string` to the
    `DecorationCapture` interface (doc-comment: kind defaults to 'edit' when absent server-side per Plan 01's
    assembleDecorationEdit contract; cellName is required and meaningful only when kind==='add'; when
    kind==='arm-failed', the SAME cellName field is REPURPOSED to carry a human-readable arm-failure reason
    string instead of a cell name -- the two purposes are mutually exclusive per kind and never overlap for a
    single capture event, C8). Append two new entries to `LIVE_DECORATION_LAYOUT` immediately after
    `RESULT_EPOCH` (offset 1304, length 4): `CAPTURE_KIND: { offset: 1308, length: 4 }` (0=edit, 1=add, 2=
    arm-failed -- document as `LIVE_DECORATION_CAPTURE_KIND`) and `CAPTURE_CELL_NAME: { offset: 1312, length:
    128 }` (asciiz, meaningful for kind===1 as a cell name, for kind===2 as a failure reason string,
    unused for kind===0). Add a new exported const `LIVE_DECORATION_CAPTURE_KIND = { EDIT: 0, ADD: 1,
    ARM_FAILED: 2 } as const`. Update the doc-comment above LIVE_DECORATION_LAYOUT to note the region now runs
    through offset 1440 (1312+128).
    In channel.h: add `uint32_t captureKind;` (offset 1308) and `char captureCellName[128];` (offset 1312) to
    the LiveState struct's decoration-persist CAPTURE section, immediately after `resultEpoch`. Add
    `static constexpr uint32_t DECO_CAPTURE_KIND_EDIT = 0;`,
    `static constexpr uint32_t DECO_CAPTURE_KIND_ADD = 1;`, and
    `static constexpr uint32_t DECO_CAPTURE_KIND_ARM_FAILED = 2;` near the existing DECO_RESULT_* constants.
    ALSO add `uint32_t kind;` and `char cellName[128];` to the SMALL `DecorationCapture` plain-data struct
    (the one near line 149-155, NOT LiveState) -- this is the struct `persistDecorationEdit` builds and hands
    to `channelWriteCapture`; without these two new members here, no agent-side caller can ever populate the
    new wire fields. Update the file-header layout comment block to include the two new LiveState offsets.
    In channel.cpp: extend `channelWriteCapture`'s existing critical section (between the two
    `InterlockedIncrement(seq)` calls) to ALSO copy `cap->kind` into `ls->captureKind` and
    `cap->cellName` into `ls->captureCellName` (memcpy + explicit NUL-termination at
    `sizeof(ls->captureCellName)-1`, matching the existing `captureDecorationTemplate`/`captureBuildingTemplate`
    truncation discipline in the same function) -- this MUST be inside the same seqlock span as the other
    CAPTURE fields, not a separate unlocked write, so a torn read across the non-contiguous offset gap (768 vs
    1308/1312) is impossible.
  </action>
  <verify>
    <automated>npm -w @swg/contracts run build</automated>
  </verify>
  <acceptance_criteria>
    `grep -n "CAPTURE_KIND" packages/contracts/src/live-inject.ts` and
    `grep -n "captureKind" packages/live-inject/agent/channel.h` both show offset 1308; `grep -n
    "CAPTURE_CELL_NAME" packages/contracts/src/live-inject.ts` and `grep -n "captureCellName"
    packages/live-inject/agent/channel.h` both show offset 1312 and length/size 128; `grep -n "kind;"
    packages/live-inject/agent/channel.h` shows a hit inside the SMALL `DecorationCapture` struct (not just
    LiveState); `grep -nP "ls->captureKind\s*=\s*cap->kind" packages/live-inject/agent/channel.cpp` matches (ROUND 3, R13 — use `grep -P`/`grep -nP`, not plain `grep`, since `\s` is a PCRE escape plain POSIX grep does not support on every platform),
    and the match is textually BETWEEN the two `InterlockedIncrement(seq)` lines inside `channelWriteCapture`
    (verified by inspection, not just grep count); `npm -w @swg/contracts run build` succeeds with no type
    errors.
  </acceptance_criteria>
  <done>DecorationCapture/CAPTURE region carries an ADD-identity kind+cellName pair (plus an ARM_FAILED kind
  reusing the cellName slot for a reason string), byte-identical on both the TS contract and the C++ struct,
  AND the agent-side ENCODE path (the small DecorationCapture struct + channelWriteCapture) is real, not just
  declared -- Plan 12/05's callers have actual fields to write into.</done>
</task>

<task type="auto">
  <name>Task 2: New LIVE_HOST_CMD region (scene actions, placement start/cancel, despawn) + total-size bump on ALL FOUR touchpoints</name>
  <files>packages/contracts/src/live-inject.ts, packages/live-inject/agent/channel.h, packages/live-inject/agent/channel.cpp, packages/live-inject/src/channel_binding.cpp</files>
  <read_first>
    packages/contracts/src/live-inject.ts (the REBIND region, lines 266-275, and RESULT fields, lines
    278-281 -- this new region's read/write/ack shape is the SAME "host writes a seqlocked request, agent
    consumes once per new epoch, agent publishes a code-before-epoch result" idiom, just generalized to six
    actions via one action enum instead of one fixed payload shape)
    packages/live-inject/agent/channel.h (DecorationRebind struct, lines 158-163, and the RESULT fields --
    same structural analog for the new HostCommand plain-data struct)
    packages/live-inject/agent/channel.cpp (`channel.cpp:25`, the existing
    `static_assert(sizeof(LiveState) == 1308, ...)` block and its 25 `offsetof` asserts through `resultEpoch`
    (ROUND 3, REVIEWS.md R13 — Fable/Cursor: the real count is 25, not the "17" an earlier draft cited; cite
    the assert set by the SYMBOLS it covers, not a paraphrased count, when describing it in future revisions)
    -- THIS task appends new offsetof asserts for captureKind/captureCellName AND every hostCmd* member, and
    bumps the `== 1308` literal itself to `== 1864`; this is the C1 fix, owned HERE, not left to a later plan)
    packages/live-inject/src/channel_binding.cpp (`channel_binding.cpp:58`,
    `static constexpr size_t CHANNEL_BYTE_SIZE = 1308;` -- THIS task bumps it to 1864; this is the other half
    of the C1 fix)
  </read_first>
  <action>
    In live-inject.ts, append a new exported const `LIVE_HOST_CMD_LAYOUT` (immediately after
    LIVE_DECORATION_LAYOUT, documented as riding the SAME single named mapping -- no second
    CreateFileMappingA) with these fields, starting at offset 1440 (right after CAPTURE_CELL_NAME):
    HOST_CMD_SEQ_COUNTER (1440, 4), HOST_CMD_EPOCH (1444, 4), HOST_CMD_ACTION (1448, 4), HOST_CMD_STR1 (1452,
    256), HOST_CMD_STR2 (1708, 128), HOST_CMD_ID (1836, 8 -- decimal-u64-as-two-u32-halves, same crossing
    pattern CAPTURE_BUILDING_ID already uses), HOST_CMD_VEC3 (1844, 12 -- 3 floats), HOST_CMD_RESULT_CODE
    (1856, 4 -- signed int32, written FIRST), HOST_CMD_RESULT_EPOCH (1860, 4 -- published LAST, same
    code-before-epoch discipline as RESULT_CODE/RESULT_EPOCH). Document per-action payload usage in a comment
    table: RELOAD_CURRENT_SCENE(1)=no payload; LOAD_EDITOR_SCENE(2)=STR1 terrain, STR2 avatar template;
    TELEPORT(3)=VEC3 xyz; START_PLACEMENT(4)=STR1 decoration template, STR2 cellName, ID building id;
    CANCEL_PLACEMENT(5)=no payload; DESPAWN_NODE(6)=ID networkId to remove (result code mirrors
    utinni_wsRemoveNode: 1=removed/0=miss/-1=occupied; other actions use 1=ok/0=endpoint-unresolved-or-failed).
    Add `export const LIVE_HOST_CMD_ACTION = { RELOAD_CURRENT_SCENE: 1, LOAD_EDITOR_SCENE: 2, TELEPORT: 3,
    START_PLACEMENT: 4, CANCEL_PLACEMENT: 5, DESPAWN_NODE: 6 } as const`. Bump
    `LIVE_CHANNEL_TOTAL_SIZE` from 1308 to 1864 (1860+4). Update its doc-comment to explain the new size is
    `sizeof(LiveState)` including the HOST_CMD region.
    In channel.h, append matching struct members to LiveState after `captureCellName`: `LONG
    hostCmdSeqCounter;` (1440), `uint32_t hostCmdEpoch;` (1444), `uint32_t hostCmdAction;` (1448), `char
    hostCmdStr1[256];` (1452), `char hostCmdStr2[128];` (1708), `uint64_t hostCmdId;` (1836), `float
    hostCmdVec3[3];` (1844), `int32_t hostCmdResultCode;` (1856), `uint32_t hostCmdResultEpoch;` (1860). Add
    matching `static constexpr uint32_t HOST_CMD_ACTION_*` constants for all six actions. Add a new plain-data
    `struct HostCommand { uint32_t epoch; uint32_t action; char str1[256]; char str2[128]; uint64_t id; float
    vec3[3]; };` near the existing DecorationRebind struct (this is the read-side snapshot type Plan 07's
    channelReadHostCommand will populate -- no implementation here, just the type). Forward-declare (comment
    only, no body -- implementations land in Plan 07) `bool channelReadHostCommand(HostCommand* out);` and
    `void channelWriteHostCommandResult(int32_t code, uint32_t epoch);` in the "Channel functions" section,
    matching the existing declaration style for channelReadRebind/channelWriteResult. Update
    LIVE_STATE_BYTE_SIZE's usage note and the file-header layout comment block with the final size (1864).
    In channel.cpp: bump the `static_assert(sizeof(LiveState) == 1308, ...)` literal to `1864`; append
    `offsetof` asserts for `captureKind` (1308), `captureCellName` (1312), `hostCmdSeqCounter` (1440),
    `hostCmdEpoch` (1444), `hostCmdAction` (1448), `hostCmdStr1` (1452), `hostCmdStr2` (1708), `hostCmdId`
    (1836), `hostCmdVec3` (1844), `hostCmdResultCode` (1856), `hostCmdResultEpoch` (1860) -- one assert per new
    member, matching the file's existing one-assert-per-member style exactly (do not remove or renumber any
    existing assert).
    In channel_binding.cpp: bump `static constexpr size_t CHANNEL_BYTE_SIZE = 1308;` to `1864`. This single
    literal governs the `CreateFileMappingA` size, the `ArrayBuffer::New` size, and `readChannelView`'s
    whole-view `memcpy` size -- bumping it here (in the SAME plan that grows the struct) is what closes C1: no
    later plan's build can silently run against a stale 1308-byte mapping.
  </action>
  <verify>
    <automated>npm -w @swg/contracts run build && cmake --build packages/live-inject/agent/build-agent --config Release && npm -w @swg/live-inject run build</automated>
  </verify>
  <acceptance_criteria>
    `grep -n "LIVE_CHANNEL_TOTAL_SIZE = 1864" packages/contracts/src/live-inject.ts` matches;
    `grep -n "hostCmdResultEpoch" packages/live-inject/agent/channel.h` shows offset 1860; both files list
    the same six HOST_CMD_ACTION values with the same numeric codes; `grep -n "sizeof(LiveState) == 1864"
    packages/live-inject/agent/channel.cpp` matches (the C1 fix); `grep -n "CHANNEL_BYTE_SIZE = 1864"
    packages/live-inject/src/channel_binding.cpp` matches (the other half of the C1 fix); `npm -w @swg/contracts
    run build`, the agent `cmake --build` command, and `npm -w @swg/live-inject run build` (host addon) ALL
    succeed clean -- this plan's verify is now contracts+agent+host-addon, not contracts-TS-only, per C1's
    fix instruction. A reviewer diffing the two files' offset tables side-by-side finds zero mismatches.
  </acceptance_criteria>
  <done>One new HOST_CMD region exists on both sides of the wire, covering all six host->agent one-shot
  actions this phase needs, still riding the single named mapping. The agent DLL and host addon both build
  clean against the SAME 1864-byte struct defined in this same plan (C1 closed).</done>
</task>

<task type="auto">
  <name>Task 3: REBIND_FLAGS.MIRROR_OFF bit (D-10 in-game hybrid-session warning groundwork)</name>
  <files>packages/contracts/src/live-inject.ts, packages/live-inject/agent/channel.h</files>
  <read_first>
    packages/contracts/src/live-inject.ts (LIVE_DECORATION_REBIND_FLAGS, current: `APPLY: 0x1`, `ABORT: 0x2`)
    packages/live-inject/agent/channel.h (`DECO_REBIND_FLAG_APPLY`/`DECO_REBIND_FLAG_ABORT` constants,
    immediately above the `DECO_RESULT_*` block)
  </read_first>
  <behavior>
    - A third REBIND flag bit, `MIRROR_OFF: 0x4`, exists on both sides of the wire -- purely additive, does
      not renumber or change the meaning of APPLY (0x1) or ABORT (0x2).
    - Doc-comment on both sides states its purpose verbatim: "set by the host alongside APPLY when this
      persist's mirrorToStockIlf resolved to false -- lets the agent's status strip show a distinct 'saved
      (not visible here)' variant per D-10, without the agent needing any knowledge of per-project settings."
    - This task lands NO logic -- only the shared constant, per this plan's own Interface-First doctrine. Plan
      06 (host writer, sets the bit when calling writeRebind) and Plan 05 (agent reader, branches the "saved"
      strip state on it) are the consumers.
  </behavior>
  <action>
    Add `MIRROR_OFF: 0x4` to `LIVE_DECORATION_REBIND_FLAGS` in live-inject.ts with the doc-comment above. Add
    the matching `static constexpr uint32_t DECO_REBIND_FLAG_MIRROR_OFF = 0x4;` to channel.h immediately after
    `DECO_REBIND_FLAG_ABORT`, with the same doc-comment. Do not touch APPLY/ABORT's values or any other
    constant in either file.
  </action>
  <verify>
    <automated>npm -w @swg/contracts run build</automated>
  </verify>
  <acceptance_criteria>
    `grep -n "MIRROR_OFF: 0x4" packages/contracts/src/live-inject.ts` and `grep -n "DECO_REBIND_FLAG_MIRROR_OFF = 0x4" packages/live-inject/agent/channel.h`
    both match; `npm -w @swg/contracts run build` succeeds; APPLY/ABORT values unchanged (0x1/0x2 respectively)
    on both sides.
  </acceptance_criteria>
  <done>A third REBIND flag bit exists on both sides of the wire, ready for Plan 06 (writer) and Plan 05
  (reader) to consume -- D-10's HUD-side signal, defined before either consumer touches it.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| renderer/host addon -> agent (shared-memory channel) | Cross-process, seqlocked shared memory; the agent is an injected DLL inside a possibly third-party-modified game client. |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigate/Accept |
|-----------|----------|-----------|-------------|-----------------|
| T-05.1-03a | Tampering | HOST_CMD_STR1/STR2 fixed-size ASCII slots | mitigate | Both are fixed 256/128-byte null-terminated slots (same fixed-length + explicit-truncation discipline as the existing CAPTURE_DECORATION_TEMPLATE/CAPTURE_BUILDING_TEMPLATE) -- writers (Plan 07 host binding) MUST truncate + null-terminate before memcpy, exactly like writeRebind already does for REBIND_DERIVED_TEMPLATE. Documented here so Plan 07's implementer does not invent a different discipline. |
| T-05.1-03b | Denial of Service | HOST_CMD_ACTION unknown/out-of-range value | mitigate | Documented contract: the agent-side consumer (Plan 09) MUST treat any HOST_CMD_ACTION value outside the six defined constants as a no-op that still publishes HOST_CMD_RESULT_CODE=0/HOST_CMD_RESULT_EPOCH -- fail closed, never crash or spin on a malformed/future-version command. |
| T-05.1-03c | Tampering | CAPTURE_CELL_NAME (128-byte asciiz, dual-purpose as of this revision) | mitigate | Same fixed-length + truncation discipline as existing string slots; consumed later (Plan 01/06 for kind=ADD, Plan 04/06 for kind=ARM_FAILED) only as a `.ilf` chunk payload string or a display-only reason string, never as a raw filesystem path component. |
| T-05.1-03d | Tampering | channel.cpp/channel_binding.cpp size-literal drift | mitigate | Both literals (`sizeof(LiveState) == 1864` static_assert, `CHANNEL_BYTE_SIZE = 1864`) are bumped in THIS SAME plan alongside the struct growth (C1 fix) -- closing the exact class of drift the cross-AI review found (a struct grown in one plan, size literals left stale in files no later plan owned). |
</threat_model>

<verification>
`npm -w @swg/contracts run build`, `cmake --build packages/live-inject/agent/build-agent --config Release`
(agent DLL), and `npm -w @swg/live-inject run build` (host addon) ALL succeed clean; manual side-by-side
offset-table diff between live-inject.ts and channel.h shows zero mismatches; `channel.cpp`'s static_assert
and `channel_binding.cpp`'s CHANNEL_BYTE_SIZE both read 1864.
</verification>

<success_criteria>
Both wire-contract files agree, byte-for-byte, on the ADD-identity CAPTURE extension (including the
ARM_FAILED kind, C8) and the new unified HOST_CMD region, with LIVE_CHANNEL_TOTAL_SIZE consistently 1864 on
BOTH TypeScript AND BOTH C++ build artifacts (channel.cpp's static_assert, channel_binding.cpp's
CHANNEL_BYTE_SIZE) -- ready for Plan 05/07 to build against without any layout renegotiation or a mid-wave
build break. The REBIND_FLAGS.MIRROR_OFF bit is defined and ready for Plan 06/05. The agent-side ENCODE of
kind/cellName is real (channelWriteCapture), not merely declared.
</success_criteria>

<output>
Create `.planning/phases/05.1-live-world-editor-productization/05.1-03-SUMMARY.md` when done
</output>

==================== .planning/phases/05.1-live-world-editor-productization/05.1-04-PLAN.md ====================
---
phase: 05.1-live-world-editor-productization
plan: 04
type: execute
wave: 0
depends_on: []
files_modified:
  - packages/renderer/src/services/worldEditorScan.ts
  - packages/renderer/src/services/worldEditorScan.test.ts
  - packages/renderer/src/state/worldEditorStore.ts
  - packages/renderer/src/state/worldEditorStore.test.ts
autonomous: true
requirements: [pivot-driven]
must_haves:
  truths:
    - "The World panel's building tree derives entirely from a disk scan of the override dir, survives a restart, and needs no new persisted store (D-05, SC2)"
    - "Persist history is session-only, held in memory, and clears on restart (D-06, SC2)"
    - "A persist-history/App-side message for a persist whose mirrorToStockIlf resolved to false carries D-10's full detail verbatim ('mirror off — not visible on hybrid sessions until reload into an editor scene'), never just a bare 'saved' (D-10 App-side wiring)"
    - "An arm-attempt failure (agent-side, before any capture normally reaches the store) can be recorded into the SAME history/badge mechanism via recordArmFailure, so C8's dead-end ('the World panel's own failure-detail contract never gets a real caller') is closed (REVIEWS.md C8)"
    - "A building's WorldEditorBuilding entry carries the stock buildingTemplateVfsPath a live capture observed for it (ROUND 3, R3), read from the per-project durable map (Plan 02) — Plan 13's offline Remove has a real value to assemble against instead of guessing or crashing"
    - "Detail-card/history callers can render D-13's full before/after-transform + cell/row readout, because PersistHistoryEntry now carries that data instead of just an outcome word (ROUND 3, R5 — HIGH, Sonnet)"
  artifacts:
    - path: "packages/renderer/src/services/worldEditorScan.ts"
      provides: "disk-scan-to-building-tree service"
      contains: "export function scanWorldEditorState"
    - path: "packages/renderer/src/state/worldEditorStore.ts"
      provides: "Zustand store: building tree + session overlay + persist history + attention badge; formatPersistMessage (D-10); recordArmFailure (C8); worldEditorBuildingRowId/parseWorldEditorRowId (R12/MED-7)"
      contains: "useWorldEditorStore"
  key_links:
    - from: "packages/renderer/src/state/worldEditorStore.ts"
      to: "packages/renderer/src/services/worldEditorScan.ts"
      via: "store's refresh action calling scanWorldEditorState"
      pattern: "scanWorldEditorState\\("
---

<objective>
Build the two net-new services the World panel (Plan 10/11) needs and has no prior art for in this repo:
`worldEditorScan.ts` (D-05: disk-scan-as-truth building tree — list `edit_*.ilf`/`edit_*.iff` in the override
dir, diff against stock, derive a human display label from the derived template's own DERV/base fields) and
`worldEditorStore.ts` (a Zustand store holding the scanned tree + live-session overlay + session-only persist
history D-06 + an attention badge for failed persists D-12). This is greenfield design work (RESEARCH.md
confirms no scan-loop precedent exists anywhere in this codebase) built entirely from existing verified
primitives (`ilf.ts`, `iffTree.ts`, `clientLocator.ts`/`looseOverrideDeploy.ts`).

Purpose: give the World panel a settled, tested data source before any UI touches it (Interface-First
ordering) and let mirror-mode reconcile-on-flip (Plan 06) share the exact same scan the panel's tree uses,
per RESEARCH's Pitfall 5 warning against building a second scan. Also defines `formatPersistMessage`, the
single, testable contract every future persist-result caller (the base edit path's eventual RESULT-channel
wiring, Plan 13's Remove, Plan 14's Add) uses to build a D-10-compliant `PersistHistoryEntry.message`, so the
App-side "full detail" half of D-10's hybrid-session warning has exactly one implementation, never a
re-derived string.

**ROUND 3 REVISION (2026-08-01, REVIEWS.md R3/R5/MED-7/MED-11):**
- **R3 (HIGH, Opus):** `WorldEditorBuilding` gains `buildingTemplateVfsPath: string` (empty string when unknown
  — see Task 1's revised behavior below). Ground truth (verified this session against buildingTemplate.ts's
  own test fixture): the derived `.iff` on disk does NOT self-reference the stock building's own VFS path (its
  DERV/base chunk names a generic shared base template, not the specific stock building file), so this value
  cannot be re-derived from override-dir bytes alone. Task 1 now reads it from the per-project
  `worldEditorBuildingTemplates` durable map (Plan 02, populated by Plan 06's orchestrator on every live
  capture) instead of parsing it out of the derived template.
- **R5 (HIGH, Sonnet, also flagged independently by the internal plan-checker):** D-13 (CONTEXT.md, locked)
  promises the detail card shows "before/after transforms, cell, row" — but `PersistHistoryEntry` carried none
  of that data. Task 2 widens `PersistHistoryEntry` with optional `beforeTransform`/`afterTransform`/`cellName`/
  `rowIndex` fields, populated by Plan 08's RESULT-time wiring (which already has `capture.originalO2p`/
  `capture.newO2p` and the resolved cellName/rowIndex Plan 01/06 now return) and rendered by Plan 10's detail
  card.
- **MED-7 (Opus):** no plan defined the building-ROW id format `selectedRowId` uses when a BUILDING (not a
  decoration) row is selected, so Plans 10/14 each risked inventing their own ad-hoc parsing. Task 2 adds
  `worldEditorBuildingRowId(buildingId)` and `parseWorldEditorRowId(id)` so every consumer shares one
  definition.
- **MED-11 (Opus):** `resolveScanRoot`'s originally-described signature (`projectStudioDir: string | null`)
  contradicted its own "this module does not import projectBinding.ts" rule — resolving `cfgPath`/`clientPath`
  FROM a studioDir string requires calling `readWorkspaceJson`, which lives in projectBinding.ts. Task 1's
  revised signature accepts the ALREADY-RESOLVED `{ cfgPath, clientPath }` pair directly; the caller (Plan 10's
  WorldPanel, which already calls `readWorkspaceJson` for the mirror toggle) resolves and passes them in, and
  is now named explicitly as the real call site (it was previously unnamed by any plan).

**CROSS-AI REVIEW REVISION (2026-08-01, C8 — MEDIUM, Sonnet/Cursor):** Plan 05's agent-side arm-failure
capture (`g_lastArmFailureReason`) had no store-side landing spot in the original plan set — the World
panel's own D-12 "failure punt = badge + detail waiting" contract was never actually reachable for an ARM
failure specifically (only PERSIST failures reached `recordPersistResult` via Plan 08 Task 3). Task 2 below
adds `recordArmFailure(reason: string): void`, reusing the exact same history/badge machinery
`recordPersistResult` already provides, so Plan 06's orchestrator (which now branches on Plan 03's new
`kind==='arm-failed'` CAPTURE, see Plan 03 Task 1/4 and Plan 05/06's revisions) has a real function to call.
Output: `worldEditorScan.ts` (pure, offline-capable) and `worldEditorStore.ts` (Zustand, + `formatPersistMessage`
+ `recordArmFailure`), both fully unit tested against a synthetic override-dir fixture.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/phases/05.1-live-world-editor-productization/05.1-RESEARCH.md
@.planning/phases/05.1-live-world-editor-productization/05.1-PATTERNS.md
@.planning/phases/05.1-live-world-editor-productization/05.1-CONTEXT.md
@.planning/phases/05.1-live-world-editor-productization/05.1-REVIEWS.md
</context>

<interfaces>
From packages/renderer/src/services/ilf.ts (reuse for reading edit_*.ilf):
```typescript
export function parseIlf(buf: Buffer): IlfNode[];
export interface IlfNode { objectTemplateName: string; cellName: string; transform: number[]; }
```
From packages/renderer/src/services/iffTree.ts (reuse for deriving a building's display label from its
derived template's own DERV/base/appearance chunks — already the basis of buildingTemplate.ts):
```typescript
export function parseIffTree(buf: Buffer, off?: number, end?: number): IffChunk[];
export function findForm(chunks: IffChunk[], tag: string, subType: string): IffForm | null;
```
From packages/renderer/src/services/buildingTemplate.ts (reuse — do not re-derive interiorLayoutFileName parsing):
```typescript
export function readInteriorLayoutFileName(templateBytes: Buffer): string;
```
From packages/renderer/src/services/clientLocator.ts / looseOverrideDeploy.ts (reuse for locating the
override dir to scan, both offline D-07b and live — SAME detector decorationPersistOrchestrator.ts already uses):
```typescript
export function detectClients(opts?: ScanOptions): DetectedClient[];
export function resolveOverrideDir(cfgPath: string, installRoot?: string): string | null;
```
From packages/contracts/src/workspace.ts (Plan 02's ROUND 3 output, reuse verbatim — R3):
```typescript
export interface WorkspaceBindingMeta { /* ...; */ worldEditorBuildingTemplates?: Record<string, string>; }
```
From packages/renderer/src/state/liveStore.ts (status-union + create<T>() pattern to mirror, not import):
```typescript
export type ConnectionStatus = { kind: 'idle' } | { kind: 'connecting' } | { kind: 'attached'; pid: number; mappingName: string } | { kind: 'error'; reason: string };
```
From packages/renderer/src/state/deleteUndoStore.ts (flat pending-array + push pattern to mirror for D-06 history):
```typescript
export interface DeleteUndoStore { pending: TrashEntry[]; push: (entry: TrashEntry) => void; restore: (id: string) => void; }
```
</interfaces>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: worldEditorScan.ts — disk-scan-as-truth building tree (D-05)</name>
  <files>packages/renderer/src/services/worldEditorScan.ts, packages/renderer/src/services/worldEditorScan.test.ts</files>
  <read_first>
    packages/renderer/src/services/ilf.ts (parseIlf, IlfNode)
    packages/renderer/src/services/buildingTemplate.ts (full file — readInteriorLayoutFileName, and the DERV/
    base chunk parsing deriveBuildingTemplate already does, as the label-derivation template to copy)
    packages/renderer/src/services/iffTree.ts (parseIffTree, findForm signatures)
    packages/renderer/src/services/clientLocator.ts (detectClients signature, DetectedClient shape)
    packages/renderer/src/services/looseOverrideDeploy.ts (resolveOverrideDir signature)
  </read_first>
  <behavior>
    - scanWorldEditorState(overrideDir) synchronously lists every `interiorlayout/toolkit/edit_*.ilf` file
      present in overrideDir, and for each, reads the paired `object/building/toolkit/edit_*.iff` (same `<id>`
      suffix) to derive a display label (from the derived template's own DERV/base/appearance chunk fields via
      parseIffTree/findForm — NOT from any `.ws` lookup, which does not exist in this repo and is explicitly
      out of scope per RESEARCH Pattern 1); parses the `.ilf` via parseIlf to enumerate its decoration rows.
    - Returns a plain, serializable tree: one entry per building `{ buildingId: string (from the filename
      suffix), displayLabel: string, editedIlfPath: string, derivedTemplatePath: string, buildingTemplateVfsPath:
      string (ROUND 3, R3 — see below), decorations: { cellName: string, rowIndex: number, objectTemplateName:
      string, transform: number[] }[] }`. `rowIndex` is ALWAYS recomputed fresh from the current parse pass
      (per-cell positional order), never cached or passed in — this is the Pitfall 3 guard RESEARCH explicitly
      calls out.
    - **(ROUND 3, R3)** `buildingTemplateVfsPath` is looked up from a NEW third parameter,
      `buildingTemplates: Record<string, string>` (defaults to `{}` when omitted), keyed by the SAME sanitized
      `<id>` the filename suffix already is (Plan 01's now-exported `sanitizeId`, reused here — this module does
      NOT re-implement sanitization, it imports `sanitizeId` from `decorationPersist.ts`, which is
      dependency-free and safe to import). When the map has no entry for a building (e.g. an edit made in a
      DIFFERENT project/session before this ROUND 3 revision shipped, or a fresh clone that never captured
      live), `buildingTemplateVfsPath` is the empty string `''` — never `undefined`, never a guessed/fabricated
      path — and callers that NEED it (Plan 13's Remove) must fail closed on an empty string rather than pass
      it through to `assembleDecorationEdit`.
    - A building whose `edit_<id>.iff` is missing (orphaned `.ilf` with no paired derived template) is still
      included with displayLabel falling back to the raw numeric id (never throws, never silently drops a
      row — matches the module's fail-closed-but-non-fatal posture for scanning, distinct from the
      fail-closed-by-throwing posture of ilf.ts's mutators).
    - An empty/non-existent overrideDir returns an empty tree, not an error.
    - **(ROUND 3, R12/MED-11 — revised signature)** A `resolveScanRoot(clientExe: string | null,
      offlineBinding: { cfgPath?: string; clientPath: string | null } | null)` helper resolves the dir to scan:
      if clientExe is provided (live-attached), use the SAME resolveRunningClientOverrideDir-equivalent
      resolution (detectClients + longest-installPath-prefix match, mirroring
      decorationPersistOrchestrator.ts's resolveRunningClientOverrideDir) so the attached client wins (D-07b);
      otherwise, when `offlineBinding` is non-null, fall back to `resolveOverrideDir(offlineBinding.cfgPath,
      offlineBinding.clientPath ?? undefined)` so the panel works fully offline. `offlineBinding` is the
      ALREADY-RESOLVED `{ cfgPath, clientPath }` pair — this module still does NOT import projectBinding.ts (no
      circular dependency), but it no longer accepts a bare `projectStudioDir` string either, since deriving
      `cfgPath`/`clientPath` FROM a studioDir would require exactly the import this module forbids. The REAL
      caller is Plan 10's WorldPanel.tsx, which already calls `readWorkspaceJson(studioDir)` for the mirror
      toggle and passes `{ cfgPath: meta.cfgPath, clientPath: meta.clientPath }` straight through — named here
      explicitly so this helper has a real, nameable consumer (MED-11's other finding).
  </behavior>
  <action>
    Create worldEditorScan.ts exporting `scanWorldEditorState(overrideDir: string, buildingTemplates?:
    Record<string, string>): WorldEditorBuilding[]` and a `WorldEditorBuilding`/`WorldEditorDecoration` type
    pair matching the shape above (including `buildingTemplateVfsPath: string`, ROUND 3/R3). Import `sanitizeId`
    from `./decorationPersist` (Plan 01's now-exported helper) to key the `buildingTemplates` lookup identically
    to how `edit_<id>.ilf`'s own `<id>` is derived. Implement the building label derivation by reading the
    derived `.iff`'s DERV/base form the same way buildingTemplate.ts already parses the stock template (reuse
    parseIffTree/findForm — do not hand-roll a second IFF walker). Implement `resolveScanRoot` per its ROUND 3
    revised signature above, using detectClients()/resolveOverrideDir() exactly as
    decorationPersistOrchestrator.ts's resolveRunningClientOverrideDir does for the live case, extended with an
    offline fallback that calls `resolveOverrideDir` directly against the CALLER-SUPPLIED `offlineBinding`
    (never re-deriving it from a studioDir string, per MED-11). Write worldEditorScan.test.ts against a
    synthetic temp-dir fixture (create real `edit_<id>.ilf`/`edit_<id>.iff` bytes via serializeIlf + a minimal
    hand-built IFF FORM, matching buildingTemplate.test.ts's fixture-construction style if one exists) covering:
    multi-building scan, orphaned-.ilf fallback label, empty-dir case, rowIndex correctness after a synthetic
    delete-then-rescan (two scans of the same dir after externally removing one row — proves rowIndex is
    scan-fresh, not cached), and `buildingTemplateVfsPath` resolution: a building present in a seeded
    `buildingTemplates` map returns that exact string; a building ABSENT from the map returns `''` (ROUND 3,
    R3).
  </action>
  <verify>
    <automated>npm -w @swg/renderer run test -- worldEditorScan</automated>
  </verify>
  <acceptance_criteria>
    scanWorldEditorState on a synthetic 2-building fixture returns both buildings with correct decoration
    counts; an orphaned `.ilf` (no paired `.iff`) still appears with a numeric-id fallback label, never
    throws; re-scanning after externally deleting a row shows the remaining rows' rowIndex shifted down
    (proving no caching); empty dir returns `[]`; a building whose sanitized id is a key in the seeded
    `buildingTemplates` map returns that exact `buildingTemplateVfsPath`; a building with no matching key
    returns `buildingTemplateVfsPath: ''` (ROUND 3, R3).
  </acceptance_criteria>
  <done>worldEditorScan.ts exists, offline-capable, fully covered by fixture tests, with zero `.ws`-lookup
  dependency.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: worldEditorStore.ts — tree + session overlay + persist history + badge (D-05/D-06/D-12/C8)</name>
  <files>packages/renderer/src/state/worldEditorStore.ts, packages/renderer/src/state/worldEditorStore.test.ts</files>
  <read_first>
    packages/renderer/src/state/liveStore.ts (lines 26-31 status-union pattern; lines 377-397 create<T>()
    store shape — mirror the STRUCTURE, do not import liveStore itself)
    packages/renderer/src/state/deleteUndoStore.ts (full file — the flat pending-array + push pattern is the
    direct precedent for the session-only persist-history slice)
    packages/renderer/src/services/worldEditorScan.ts (this plan's Task 1 output — scanWorldEditorState,
    WorldEditorBuilding type)
  </read_first>
  <behavior>
    - useWorldEditorStore holds: `tree: WorldEditorBuilding[]` (from the last scan), `selectedRowId: string |
      null` (a stable composite key: `${buildingId}:${cellName}:${rowIndex}` recomputed on each scan — never
      a bare numeric rowIndex, per the Pitfall 3 anti-pattern), `sessionOverlay: Map<rowId, 'armed' | 'saved'
      | 'failed'>` (transient state overlaid on top of the disk-scanned tree while a live session is
      attached), `history: PersistHistoryEntry[]` (session-only, D-06 — append-only, cleared implicitly by
      being a fresh module-scope store on reload, never persisted to disk), `hasFailureBadge: boolean`
      (derived — true whenever any history entry or overlay entry is 'failed' and has not been acknowledged
      by opening the World tab, per D-12's "attention badge" contract).
    - Actions: `refresh(overrideDir: string, buildingTemplates?: Record<string, string>): void` (ROUND 3 —
      the second param threads straight through to `scanWorldEditorState(overrideDir, buildingTemplates)`, so
      R3's durable `buildingTemplateVfsPath` map actually reaches the tree the store exposes; every caller
      (Plans 10/13/14) MUST pass its own `readWorkspaceJson(studioDir).worldEditorBuildingTemplates` here — a
      caller that omits it silently gets `buildingTemplateVfsPath: ''` on every building, defeating R3) (calls
      scanWorldEditorState, replaces `tree`, does NOT clear sessionOverlay/history — those are session state
      independent of disk state), `select(rowId: string | null): void`, `recordPersistResult(entry: PersistHistoryEntry): void` (pushes to history, updates
      sessionOverlay for the affected row, sets hasFailureBadge when the result is a failure), `setArmed(rowId:
      string): void`/`clearArmed(rowId: string): void`, `acknowledgeFailures(): void` (clears hasFailureBadge
      — called when the World tab becomes active, per D-12's "never steal focus" contract: the badge is passive
      until the user looks).
    - `recordArmFailure(reason: string): void` (C8, cross-AI review): appends a `PersistHistoryEntry` with
      `outcome: 'error'`, `buildingLabel: 'unknown'`, `decorationLabel: 'unknown'` (an arm failure happens
      BEFORE a building/decoration is confirmed — there is no richer identity available yet), `message:
      reason` (armDecorationEdit's returned strings are already human-readable words, e.g. "no building id —
      hover a decoration (or click the building), then Arm" — this function does NOT reformat or wrap them,
      it trusts the caller's string is already SC1-clean), and `timestampISO: new Date().toISOString()`; sets
      `hasFailureBadge = true`. Internally this is a thin wrapper around the SAME push+badge logic
      `recordPersistResult` uses (do not duplicate the badge-setting logic in two places — factor it into one
      shared internal helper both actions call).
    - PersistHistoryEntry shape: `{ timestampISO: string; buildingLabel: string; decorationLabel: string;
      outcome: 'ok' | 'warn' | 'error'; message: string (human words, NEVER a raw code — reuses
      decorationResultLabel's output, per SC1) }`.
    - **(ROUND 3, R5)** `PersistHistoryEntry` gains four OPTIONAL fields: `beforeTransform?: number[]`,
      `afterTransform?: number[]` (the decoration's o2p before/after the move — the raw 12-element transform
      arrays, same shape `DecorationCapture.originalO2p`/`.newO2p` already carry), `cellName?: string`,
      `rowIndex?: number` (which `.ilf` row this persist touched — from `assembleDecorationEdit`'s now-widened
      result, Plan 01/06). All four are `undefined` for entries that never had this data available (an
      arm-failure entry via `recordArmFailure`, or a legacy caller that hasn't been updated) — `recordPersistResult`
      and `recordArmFailure`'s own behavior are UNCHANGED by this addition; it is purely a widened interface for
      callers that now have richer data to attach (Plan 08's RESULT-time wiring; Plan 10's detail card renders
      it, D-13).
    - `formatPersistMessage(baseLabel: string, mirrorToStockIlf: boolean): string` (D-10) — the SINGLE place
      that appends the mirror-off detail suffix to a base result label. When `mirrorToStockIlf` is true,
      returns `baseLabel` unchanged. When false, returns `${baseLabel} — mirror off — not visible on hybrid
      sessions until reload into an editor scene` (D-10's exact bracketed wording, verbatim, joined with an
      em dash to match D-10's own punctuation). Pure, no side effects, no
      dependency on worldEditorStore's own state — callable from any future persist-result caller
      (decorationPersistOrchestrator's eventual RESULT-channel wiring, Plan 13's Remove, Plan 14's Add) so
      D-10's App-side full-detail contract has exactly one implementation.
  </behavior>
  <action>
    **(ROUND 3, R12/MED-7)** Export `worldEditorBuildingRowId(buildingId: string): string` (returns
    `buildingId` verbatim — a building row's selectedRowId has no colon-delimited suffix) and
    `parseWorldEditorRowId(id: string): { kind: 'building'; buildingId: string } | { kind: 'decoration';
    buildingId: string; cellName: string; rowIndex: number }` (splits on `:` — exactly 1 segment = a building
    row, exactly 3 segments = a decoration row per `worldEditorRowId`'s own `${buildingId}:${cellName}:${rowIndex}`
    format; anything else throws `worldEditorStore: malformed row id "..."`, fail-closed rather than silently
    guessing) from this same file, co-located with `worldEditorRowId`. Plans 10/14 MUST import and use these
    instead of inventing their own ad-hoc `selectedRowId` parsing (MED-7 — no plan defined this before).
    Create worldEditorStore.ts using Zustand's `create<T>((set, get) => ({...}))` shape, structurally mirroring
    liveStore.ts's discriminated-status idiom for any per-row status fields and deleteUndoStore.ts's flat-array
    idiom for `history`. Export the store hook plus the `PersistHistoryEntry`/row-id-key helper (e.g.
    `worldEditorRowId(buildingId, cellName, rowIndex): string`) so later plans (10/11/13) key off the SAME
    composite id, never a bare index. Factor the shared "push a history entry + set hasFailureBadge on
    failure" logic into one internal helper used by BOTH `recordPersistResult` and `recordArmFailure`. Write
    worldEditorStore.test.ts covering: refresh(overrideDir, buildingTemplates) replaces tree without clearing
    session state, and the resulting tree's buildingTemplateVfsPath values match the passed-in
    buildingTemplates map (ROUND 3, R3 — the plumbing test for the widened refresh signature, not just an
    assertion on worldEditorScan.ts in isolation);
    recordPersistResult with outcome='error' sets hasFailureBadge=true and acknowledgeFailures() clears it;
    two persists to the SAME row_id accumulate in history (both entries kept, not overwritten) matching the
    proven pipeline's own accumulation behavior; `recordArmFailure('no building id — hover a decoration...')`
    appends a history entry with that EXACT message (verbatim, no reformatting) and sets hasFailureBadge=true,
    proving the C8 wiring closes (a real caller can now reach the store's failure-detail contract for an arm
    failure, not just a persist failure). `parseWorldEditorRowId(worldEditorRowId('1082874','alcove1',3))`
    returns `{ kind: 'decoration', buildingId: '1082874', cellName: 'alcove1', rowIndex: 3 }`;
    `parseWorldEditorRowId(worldEditorBuildingRowId('1082874'))` returns `{ kind: 'building', buildingId:
    '1082874' }`; a malformed id (e.g. `'a:b'`, 2 segments) throws (ROUND 3, R12/MED-7). Also export
    `formatPersistMessage(baseLabel, mirrorToStockIlf)` from
    this file (co-located with PersistHistoryEntry, not a separate module) and test it directly:
    mirrorToStockIlf=true returns baseLabel unchanged; mirrorToStockIlf=false returns baseLabel + the exact
    D-10 suffix (assert the FULL string, not a substring match, so a future wording drift is caught).
  </action>
  <verify>
    <automated>npm -w @swg/renderer run test -- worldEditorStore</automated>
  </verify>
  <acceptance_criteria>
    Store tests green; hasFailureBadge is true after a failed recordPersistResult and false after
    acknowledgeFailures(); refresh() preserves sessionOverlay/history across a tree replacement (asserted by
    comparing history.length before/after a refresh() call); formatPersistMessage('saved', true) === 'saved';
    formatPersistMessage('saved', false) === 'saved — mirror off — not visible on hybrid sessions until reload
    into an editor scene' (exact string match); recordArmFailure appends a history entry whose message equals
    its input reason string exactly and sets hasFailureBadge=true; `worldEditorBuildingRowId`/
    `parseWorldEditorRowId` round-trip correctly for both building and decoration ids and throw on a malformed
    id (ROUND 3, R12/MED-7).
  </acceptance_criteria>
  <done>worldEditorStore.ts exists, Zustand-idiomatic, session-only history proven not to leak into any
  persisted store, badge logic proven, and the arm-failure path (C8) has a real, tested landing spot.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| renderer → disk (client override dir, read-only scan) | worldEditorScan.ts reads (never writes) files inside a real client install's loose override directory. |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-05.1-04a | Denial of Service | worldEditorScan.ts (malformed/truncated edit_*.ilf on disk) | mitigate | parseIlf already fails closed (throws) on structurally invalid bytes (ilf.ts's existing contract) — scanWorldEditorState wraps each per-building parse in a try/catch so ONE corrupted file surfaces as a single orphaned/unreadable row in the tree, never aborts the whole scan. |
| T-05.1-04b | Information Disclosure | none material | accept | Local desktop tool reading its own project's override dir; no cross-project or cross-user boundary. |
| T-05.1-04c | Repudiation | recordArmFailure(reason) trusts the caller's string verbatim | accept | The only caller (Plan 06's orchestrator, decoding an ARM_FAILED CAPTURE) sources `reason` from the agent's own already-human-readable armDecorationEdit() return strings (never a raw numeric code — verified against overlay.cpp's existing return-string set) — no new untrusted-input surface. |
</threat_model>

<verification>
`npm -w @swg/renderer run test -- worldEditorScan worldEditorStore` green; `tsc --noEmit` clean for packages/renderer.
</verification>

<success_criteria>
The World panel's future data spine (D-05 disk-scan tree, D-06 session-only history, D-12 badge) exists,
fully unit tested, with zero UI code yet — ready for Plan 10/11 to render against directly. C8's
arm-failure-to-store path (recordArmFailure) exists and is tested, closing the dead-end the cross-AI review
found. ROUND 3: `WorldEditorBuilding.buildingTemplateVfsPath` (R3) and `PersistHistoryEntry`'s before/after-
transform + cell/row fields (R5, D-13) exist; `worldEditorBuildingRowId`/`parseWorldEditorRowId` (MED-7) give
every later plan one shared row-id contract; `resolveScanRoot`'s signature (MED-11) no longer contradicts its
own no-projectBinding-import rule.
</success_criteria>

<output>
Create `.planning/phases/05.1-live-world-editor-productization/05.1-04-SUMMARY.md` when done
</output>

==================== .planning/phases/05.1-live-world-editor-productization/05.1-05-PLAN.md ====================
---
phase: 05.1-live-world-editor-productization
plan: 05
type: execute
wave: 1
depends_on: ["05.1-03"]
files_modified:
  - packages/live-inject/agent/overlay.cpp
autonomous: false
requirements: [pivot-driven]
user_setup:
  - service: local-swg-client
    why: "F/G/R hotkey capture and the retired CONSULT-69 probe can only be verified by hovering a real decoration in a running, injected client"
    dashboard_config:
      - task: "Rebuild the agent DLL and re-inject/re-launch before verifying"
        location: "cmake --build packages/live-inject/agent/build-agent --config Release (node on PATH)"
must_haves:
  truths:
    - "A user can hover a decoration in-game, arm/move/rotate/persist it entirely from the productized status-strip HUD; the CONSULT-69 debug probe is retired (SC1)"
    - "Every HUD failure state reads as words (idle/hover/armed/saved/failed), never a raw result code (SC1)"
    - "When a persist's mirror was off (Plan 03/06's REBIND_FLAGS.MIRROR_OFF), the strip's saved state reads a short, distinct 'saved (not visible here)' variant instead of plain 'saved', so the user is not confused when the object snaps back after reload (D-10)"
    - "An arm-attempt failure is ALSO published to the CAPTURE region (kind=ARM_FAILED, Plan 03 Task 1) so the World panel can record it via worldEditorStore.recordArmFailure — not just stashed in an agent-local global with no reader (REVIEWS.md C8)"
  artifacts:
    - path: "packages/live-inject/agent/overlay.cpp"
      provides: "020-A status-strip render + F/G/R contextual hotkey capture, CONSULT-69 CollapsingHeader removed"
      contains: "renderDecorationStrip"
  key_links:
    - from: "packages/live-inject/agent/overlay.cpp (strip)"
      to: "packages/live-inject/agent/overlay.cpp (armDecorationEdit/persistDecorationEdit)"
      via: "F/G/R hotkeys calling the SAME unchanged arm/persist functions the old probe's buttons called"
      pattern: "armDecorationEdit\\(\\)|persistDecorationEdit\\(\\)"
sketch_elements:
  # 020-A (Status Strip, winner) — every element below is a must_have this plan builds.
  - "one thin top-center strip (single im-panel bar), not the old always-open CollapsingHeader"
  - "object/context label (decoration name + cell + building, e.g. 'Cantina Table · alcove1 · Cantina (Mos Eisley)')"
  - "state readout text cycling idle -> hover -> armed -> saved -> failed, with a compact cell-space delta while armed (D-13)"
  - "Persist button/action, visible only while armed"
  - "Esc/cancel affordance while armed"
  - "hotkey hint text ('F arm · G/R move/rotate')"
---

<objective>
Retire the CONSULT-69 debug probe (an always-visible `CollapsingHeader` of raw pointers, latch buttons, and a
`code %d` result line) and replace it with sketch 020-A's thin, hotkey-driven Status Strip — the productized
in-game half of the boundary rule ("point at the world" = overlay; "rows/fields/text" = the World panel,
Plan 10/11). This is the single largest net-new agent-side surface in the phase: F/G/R contextual hotkey
capture does not exist anywhere in `overlay.cpp` today (verified this session — the current gizmo is toggled
by a persistent checkbox, not hover/hotkey state).

The arm/persist/rebind INTERNALS (`armDecorationEdit`, `persistDecorationEdit`, `applyPendingRebind`) are
reused completely unchanged — only the TRIGGER (hotkey vs. button click) and the RENDER surface change. The
agent `-1`-refused mapping fix (`DECO_RESULT_REBIND_REFUSED`) and the editor-scene/teleport bindings are
ALREADY SHIPPED (commit `36ab9b7`, same day as context-gathering, before this session's research) — this plan
verifies and wires them into the new UI rather than re-implementing them.

**CROSS-AI REVIEW REVISION (2026-08-01, C8 — MEDIUM, Sonnet/Cursor):** The original Task 2 stashed a failed
arm's reason string into a new `g_lastArmFailureReason` global with a note that "wiring it to the World panel
is a later plan's job" — but NO plan in the original 15-plan set actually read that global or transmitted it
anywhere off the agent process. This is now fixed: in addition to the local stash, Task 2 below ALSO
publishes the arm-failure reason through the CAPTURE region using Plan 03's new `kind=ARM_FAILED` (reusing the
`cellName` slot for the reason string, per Plan 03 Task 1) — closing the loop so Plan 06's orchestrator (which
now branches on this kind) can call `worldEditorStore.recordArmFailure(reason)` for real.

Purpose: close SC1 for the in-game half of the loop, stop the raw-code leak the old probe's own text line
committed (`ImGui::Text("... code %d ...")`), and give arm failures a real path off the agent process (C8).
Output: `overlay.cpp`'s render section rewritten; the agent DLL rebuilt and manually smoke-verified in-game.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/phases/05.1-live-world-editor-productization/05.1-RESEARCH.md
@.planning/phases/05.1-live-world-editor-productization/05.1-PATTERNS.md
@.planning/phases/05.1-live-world-editor-productization/05.1-03-SUMMARY.md
@.planning/sketches/020-overlay-decoration-hud/README.md
@.planning/handoff/2026-07-30-live-world-editor-decoration-persist.md
</context>

<interfaces>
From packages/live-inject/agent/overlay.cpp (REUSE unchanged, lines 382-489 — do not modify function bodies,
only their CALL SITES, WITH ONE NARROW EXCEPTION per D-10 — see Task 2):
```cpp
const char* armDecorationEdit();       // lines 382-428, hover-driven, reuse verbatim
const char* persistDecorationEdit();   // lines 432-445, reuse verbatim
void applyPendingRebind();             // lines 451-489, ALREADY has the shipped REBIND_REFUSED branch (472-476)
                                        // D-10 EXCEPTION (Task 2): add exactly ONE line stashing
                                        // rb.flags & DECO_REBIND_FLAG_MIRROR_OFF into a new global right after
                                        // g_lastAppliedRebindEpoch is set — no other line in this function changes.
```
From packages/live-inject/agent/channel.h (Plan 03 Task 3 output, reuse verbatim):
```cpp
static constexpr uint32_t DECO_REBIND_FLAG_MIRROR_OFF = 0x4;  // set by the host alongside APPLY when
                                                                // this persist's mirrorToStockIlf was false
```
From packages/live-inject/agent/channel.h (Plan 03 Task 1 output, reuse verbatim — the C8 wiring point):
```cpp
struct DecorationCapture {
    uint64_t buildingId; float originalO2p[3][4]; float newO2p[3][4];
    char decorationTemplate[256]; char buildingTemplate[256];
    uint32_t kind;        // DECO_CAPTURE_KIND_EDIT(0) / _ADD(1) / _ARM_FAILED(2)
    char cellName[128];   // meaningful for ADD (cell name) OR ARM_FAILED (reused as the reason string)
};
void channelWriteCapture(const DecorationCapture* cap, uint32_t epoch);
```
Globals already available (do not redeclare): `g_capArmed` (bool), `g_capBuildingId` (int64_t),
`g_capDecorationTemplate`/`g_capBuildingTemplate` (char[]), `g_lastDecoResult` (int32_t),
`g_lastDecoResultEpoch` (uint32_t), `g_lastRayObj`/`g_lastHoverObj` (void*), `g_lastHoverTmpl` (char[]),
`g_captureEpoch` (uint32_t, the shared monotonic counter `persistDecorationEdit` already increments and
passes to `channelWriteCapture`).

Existing hotkey idiom to extend (lines 356-364, Esc-to-revert during gizmo drag):
```cpp
if (ImGui::IsKeyDown(ImGuiKey_Escape)) { /* ... */ }
```
Existing input-capture gate to mirror for keyboard (line 516, mouse):
```cpp
if (!io.WantCaptureMouse) { /* hover sampling */ }
```
</interfaces>

<tasks>

<task type="auto">
  <name>Task 1: Retire the CONSULT-69 CollapsingHeader; scaffold the 020-A strip render</name>
  <files>packages/live-inject/agent/overlay.cpp</files>
  <read_first>
    packages/live-inject/agent/overlay.cpp (lines 590-690, the full CollapsingHeader block to DELETE, and
    lines 491-540, renderFrame's structure, to know where the new strip render call goes)
    .planning/sketches/020-overlay-decoration-hud/index.html (lines 152-179, variant A's exact DOM: the
    im-panel strip bar, im-dim object label, im-status-warn state text, im-btn Persist, im-btn ghost Esc,
    im-key hotkey hint spans — this is the visual/copy contract, match its wording style)
  </read_first>
  <action>
    Delete the entire `if (ImGui::CollapsingHeader("In-cell decoration probe (CONSULT-69)")) { ... }` block
    (current lines ~617-689) INCLUDING its raw-code result line (`ImGui::Text("last rebind (epoch %u): code
    %d %s", ...)`) — this line is the exact SC1 violation the new strip must not repeat. Also remove the now-
    dead o2p-readout sub-block and the Latch/Clear-latch/Follow-hover buttons that lived only inside this
    header (their function, driving `g_latchedFocus`, is subsumed by the new hover-to-arm flow in Task 2).
    Keep the "World edit (advertised snapshot)" section (Insert-at-player/cursor, lines 692-770) and the
    "Editor scene"/"Teleport" sections (lines 797-832) UNCHANGED — they are reused as-is by the World panel's
    Scene accordion later (Plan 07/09) and are explicitly out of this task's scope. Add a new top-level
    function `renderDecorationStrip()` called from `renderFrame()` right after `applyPendingRebind()` (so the
    strip always reflects the LATEST rebind result even the same frame it lands). Scaffold it to render one
    ImGui window styled as a thin top-center bar (`ImGuiWindowFlags_NoDecoration | NoMove | NoResize` docked
    near the top of the viewport via `ImGui::SetNextWindowPos` centered on `io.DisplaySize.x/2`), containing:
    an object/context label span, a state-readout text span, a Persist button (visible only when armed), an
    Esc/cancel affordance (visible only when armed), and a static hotkey-hint span reading "F arm · G/R
    move/rotate" — matching 020-A's exact anatomy. Leave the actual state-machine wiring (idle/hover/armed/
    saved/failed transitions) to Task 2; this task only removes the old UI and stands up the new window shell
    with placeholder/idle content so the file still compiles and renders after this task alone.
  </action>
  <verify>
    <automated>cmake --build packages/live-inject/agent/build-agent --config Release</automated>
  </verify>
  <acceptance_criteria>
    `grep -c "CONSULT-69" packages/live-inject/agent/overlay.cpp` is 0 (probe header string fully removed);
    `grep -c "code %d" packages/live-inject/agent/overlay.cpp` is 0 (raw-code text line gone); `grep -c
    "renderDecorationStrip" packages/live-inject/agent/overlay.cpp` is >= 2 (definition + call site from
    renderFrame); the agent DLL rebuilds with zero new compiler warnings introduced by this change;
    `armDecorationEdit`/`persistDecorationEdit`/`applyPendingRebind` function bodies are byte-identical to
    before this task (diff shows zero changes inside those three functions).
  </acceptance_criteria>
  <done>CONSULT-69 probe and its raw-code line are gone; a new thin top-center strip window (renderDecorationStrip)
  renders every frame, arm/persist/rebind internals untouched.</done>
</task>

<task type="auto">
  <name>Task 2: F/G/R contextual hotkey capture + idle/hover/armed/saved/failed state machine (D-11/D-12/D-13) + arm-failure CAPTURE publish (C8)</name>
  <files>packages/live-inject/agent/overlay.cpp</files>
  <read_first>
    packages/live-inject/agent/overlay.cpp (lines 356-364, the Esc-to-revert hotkey idiom — F/G/R follow the
    SAME `ImGui::IsKeyDown`/`IsKeyPressed` pattern; lines 491-540, the hover-sampling block that already
    populates `g_lastRayObj`/`g_lastHoverTmpl` every frame; line 516, the `!io.WantCaptureMouse` gate to
    mirror for keyboard; lines 451-489 `applyPendingRebind` — this task's ONLY touch point inside that
    function is the one-line D-10 stash described below; lines 432-445 `persistDecorationEdit` — the exact
    `DecorationCapture cap = {}; ...; channelWriteCapture(&cap, ++g_captureEpoch);` call shape this task's
    arm-failure publish must mirror, using the SAME shared `g_captureEpoch` counter)
    packages/live-inject/agent/channel.h (Plan 03 Task 3 — `DECO_REBIND_FLAG_MIRROR_OFF`; Plan 03 Task 1 —
    `DecorationCapture.kind`/`.cellName`, `DECO_CAPTURE_KIND_ARM_FAILED`)
    packages/renderer/src/services/decorationChannel.ts (this phase's Plan 01 already fixed
    decorationResultLabel — the STRIP does NOT call this TS function; it needs its OWN small C-string state
    table for the coarse idle/hover/armed/saved/failed STATE label only, per RESEARCH's "Words, never raw
    codes" note — full reason text still lives in the World panel, not here)
  </read_first>
  <behavior>
    - idle: nothing under the cursor is a decoration (g_lastRayObj/g_lastHoverTmpl empty this frame) and
      nothing is armed. Strip shows only the hotkey hint, no object label.
    - hover: g_lastRayObj is non-null and nothing is armed. Strip shows the object label + "press F to arm".
      Pressing F (ImGui::IsKeyPressed(ImGuiKey_F), gated `!io.WantCaptureKeyboard`) calls armDecorationEdit()
      unchanged; on success, transition to armed; on failure, the returned reason string is NOT shown raw in
      the strip (SC1) — show only a generic "couldn't arm — see World panel" state text. The reason string is
      (a) stored locally in a new `g_lastArmFailureReason` global (unchanged from the original design) AND (b)
      **published off the agent process** via `channelWriteCapture` with `cap.kind = DECO_CAPTURE_KIND_ARM_FAILED`
      and `cap.cellName` set to the reason string (truncated/NUL-terminated into the 128-byte slot, same
      discipline as every other fixed string slot in this file), `cap.buildingId = 0`,
      `cap.decorationTemplate`/`cap.buildingTemplate` left empty (unused for this kind), using
      `++g_captureEpoch` (the SAME shared counter `persistDecorationEdit` uses — a fresh epoch either way is
      "a new capture event," regardless of which kind it carries). This is the C8 fix: an arm failure is no
      longer a dead-end local stash — it reaches the renderer's existing CAPTURE poll exactly like a real
      persist capture does, where Plan 06's orchestrator routes it to `worldEditorStore.recordArmFailure`.
    - armed: g_capArmed is true. Strip shows the object label, a compact cell-space delta readout (compute
      from `g_capOriginalO2p` vs. the focus object's current o2p via getObjectTransformO2P, position columns
      only, matching 020-A's "Δ −0.87, 0.00, +0.63" format), the Persist button, and Esc. G enters
      ImGuizmo::TRANSLATE mode, R enters ImGuizmo::ROTATE mode (set `g_gizmoOp`/enable `g_gizmoEnabled` for
      the armed focus — reuse the EXISTING gizmo machinery, do not build a second one). Esc
      (ImGui::IsKeyPressed(ImGuiKey_Escape)) or the Esc button calls the same cancel behavior the old probe's
      Cancel button had (`g_capArmed = false`).
    - saved: the most recent `g_lastDecoResultEpoch` corresponds to a code that decorationResultLabel-
      equivalent classifies as success (DECO_RESULT_OK). Strip shows "saved" (+ a brief auto-clearing timer
      back to idle/hover after ~2s, matching 020-A's demo cadence — implementation detail, Claude's
      discretion on exact seconds) — UNLESS `g_lastRebindMirrorOff` (the D-10 stash, see below) is true for
      THIS SAME epoch, in which case the strip shows "saved (not visible here)" instead of plain "saved"
      (same auto-clear timing) — a short, in-game-appropriate variant of the App-side full detail Plan 04/11
      render ("mirror off — not visible on hybrid sessions until reload into an editor scene"); D-10.
    - failed: the most recent result is any non-OK code. Strip shows "failed — see World panel" (NEVER the
      raw code, NEVER the full reason text — that is D-12's punt-to-panel contract; this strip only needs the
      coarse state word). Persist a `g_lastDecoResult`/`g_lastDecoResultEpoch`-keyed reason so a later plan
      can surface the FULL detail elsewhere (already satisfied for PERSIST failures via the existing
      RESULT/history wiring, Plan 08 Task 3; for ARM failures specifically, satisfied by this task's CAPTURE
      publish above, C8).
    - F only arms while hovering AND nothing else is armed (D-11: zero keyboard footprint otherwise). G/R only
      act while armed. All three gate on `!io.WantCaptureKeyboard` so typing in another ImGui field (e.g. the
      Editor-scene terrain/avatar text inputs) is never hijacked.
    - D-10 stash (the ONE permitted line inside `applyPendingRebind`, per this plan's amended interface
      note): immediately after `g_lastAppliedRebindEpoch = rb.epoch;`, add
      `g_lastRebindMirrorOff = (rb.flags & DECO_REBIND_FLAG_MIRROR_OFF) != 0;` — a new global (declare near
      the other `g_lastDecoResult*` globals), read-only from the strip's saved-state check above. This is the
      ENTIRE change to `applyPendingRebind`'s body; every other line is byte-identical to before this plan.
  </behavior>
  <action>
    Implement the five-state machine described above inside `renderDecorationStrip()` (or a small helper it
    calls), driven by the EXISTING globals (`g_capArmed`, `g_lastRayObj`, `g_lastDecoResult`,
    `g_lastDecoResultEpoch`) plus one new tracking global for "was the last strip-visible transition a fresh
    save/fail this frame" (so the strip can distinguish "still showing an old saved/failed message" from "a
    brand new one just landed" for the auto-clear timer). Add the F/G/R `ImGui::IsKeyPressed`/`IsKeyDown`
    checks gated on `!io.WantCaptureKeyboard`, calling armDecorationEdit()/persistDecorationEdit() (via a new
    F-triggered call site replacing the old "Arm edit from ray object" button, and G/R setting
    `g_gizmoOp`/`g_gizmoEnabled` replacing the old radio buttons for the ARMED FOCUS specifically — leave the
    existing general-purpose gizmo checkbox/radios for the non-decoration "target-else-player" case
    unchanged, since that is a distinct, still-valid workflow this phase does not touch). Add the small
    C-string state-label helper (idle/hover/armed/saved/failed only — five short words, not full reason
    text) local to this file; do not route through decorationResultLabel (that is TypeScript, unreachable
    from C++). Declare `bool g_lastRebindMirrorOff = false;` near the other `g_lastDecoResult*` globals; add
    the ONE-LINE stash inside `applyPendingRebind` per the D-10 behavior bullet above (the function's only
    change). On an arm-attempt FAILURE (armDecorationEdit returns non-null), in addition to the existing
    `g_lastArmFailureReason` stash, build a `DecorationCapture cap = {};` with `cap.kind =
    DECO_CAPTURE_KIND_ARM_FAILED;`, truncate/copy the reason string into `cap.cellName` (127 chars +
    NUL-terminate), and call `channelWriteCapture(&cap, ++g_captureEpoch);` (C8 fix — mirrors
    persistDecorationEdit's own call shape at lines 436-443, reusing the same shared epoch counter).
  </action>
  <verify>
    <automated>cmake --build packages/live-inject/agent/build-agent --config Release</automated>
  </verify>
  <acceptance_criteria>
    Build succeeds with the new state machine; `grep -c "ImGuiKey_F" packages/live-inject/agent/overlay.cpp`
    and `grep -c "WantCaptureKeyboard" packages/live-inject/agent/overlay.cpp` are both >= 1; no code path in
    the new render function formats `g_lastDecoResult`/`code` as a raw number into ImGui text (grep for
    `code %d` and `%d.*result` in the new function returns zero hits); `grep -c "g_lastRebindMirrorOff"
    packages/live-inject/agent/overlay.cpp` is >= 2 (one declaration, one stash-site, one saved-state read);
    a diff of `applyPendingRebind`'s body against its pre-this-plan state shows exactly one inserted line;
    `grep -c "DECO_CAPTURE_KIND_ARM_FAILED" packages/live-inject/agent/overlay.cpp` is >= 1 (the C8 publish
    call site).
  </acceptance_criteria>
  <done>F arms from hover, G/R drive the armed gizmo, Esc cancels, saved/failed states render as words only —
  D-11/D-12/D-13 all satisfied in one state machine reusing the proven arm/persist/rebind internals. An arm
  failure is published off-process via the CAPTURE region (C8), not left as a dead-end local stash.</done>
</task>

<task type="checkpoint:human-verify" gate="blocking">
  <name>Task 3: In-game HUD checkpoint</name>
  <files>packages/live-inject/agent/overlay.cpp</files>
  <action>
    Pause for human verification. Claude has retired the CONSULT-69 probe and built the 020-A hotkey-driven status strip (Tasks 1-2). Rebuild the agent DLL and verify hover/arm/move/rotate/persist entirely via F/G/R hotkeys, with idle/hover/armed/saved/failed states rendering as words only, per the steps below.
  </action>
  <what-built>
    The CONSULT-69 debug probe is retired. A new thin top-center status strip drives hover→F-arm→G/R-move-or-
    rotate→Persist entirely via hotkeys, with idle/hover/armed/saved/failed word states (never raw codes). An
    arm failure is now ALSO published to the CAPTURE region (kind=ARM_FAILED) so the World panel can surface
    it once Plan 06 wires the consuming side (this checkpoint only verifies the in-game HUD half; the World
    panel side is verified later in Plan 15). The already-shipped agent `-1`-refused mapping fix
    (`DECO_RESULT_REBIND_REFUSED`) and the editor-scene/teleport bindings (`gameLoadScene`, player-teleport)
    are confirmed still present and functioning — this plan did not touch them, but they are re-scoped
    ride-alongs per RESEARCH.md and must be spot-checked here rather than assumed.
  </what-built>
  <how-to-verify>
    1. Rebuild the agent DLL: `$env:PATH = "C:\Program Files\nodejs;$env:PATH"; cmake --build
       packages/live-inject/agent/build-agent --config Release`.
    2. Launch/attach to the advertised swg-client-v2 build per the handoff's resume steps (mount the client's
       own TRE set first if using the toolkit's readVfs path — not required for this HUD-only check).
    3. Confirm the CONSULT-69 CollapsingHeader is GONE from the overlay panel — no raw-pointer probe UI
       remains.
    4. Hover a decoration (e.g. the cantina table). Confirm the strip shows the object's name/cell/building
       and "press F to arm" — no button click needed.
    5. Press F. Confirm the strip transitions to "armed" with a Δ readout, and G switches the gizmo to
       translate / R to rotate on that decoration (not the general target-else-player gizmo).
    6. Move the object, press the strip's Persist (or confirm a persist hotkey if one was added). Confirm the
       strip shows "saved" with no raw code visible anywhere in the overlay.
    7. Reproduce a refusal (e.g. arm an object whose building can't resolve) and confirm the strip shows
       "failed — see World panel" — again, no raw code, no `-5`/`-1`/etc. visible in-game.
    8. Confirm Esc cancels an armed edit without persisting.
  </how-to-verify>
  <resume-signal>Type "approved" once all 8 steps hold, or describe which step failed/looked wrong.</resume-signal>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|

| in-game overlay (agent, ImGui/D3D) | Renders inside the game's own D3D device; reads live keyboard/mouse input and calls live-injected engine function pointers. |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-05.1-05a | Elevation of Privilege / Tampering | F/G/R hotkey capture | mitigate | Gated on `!io.WantCaptureKeyboard` (D-11) so the strip never intercepts keystrokes intended for another ImGui text field; F only arms while genuinely hovering a decoration and nothing else is armed, bounding the blast radius of an accidental keypress to "arm the currently-hovered object," which is always human-visible and Esc-cancellable before anything is written to disk. |
| T-05.1-05b | Denial of Service | strip render every frame | accept | Pure ImGui draw calls plus the existing arm/persist/rebind functions (already proven, unchanged) — no new allocation or blocking call added to the per-frame path. |
| T-05.1-05c | Information Disclosure | strip state text | mitigate | Explicit design constraint (SC1): the strip renders only coarse state words, never a raw LIVE_DECORATION_RESULT code or a full reason string — full detail is deliberately withheld from the in-game surface and punted to the World panel (D-12). |
| T-05.1-05d | Repudiation | arm-failure CAPTURE publish (C8) sharing the same epoch counter as real persist captures | mitigate | Both kinds ride the SAME seqlocked CAPTURE region and the SAME monotonic epoch — Plan 06's consumer distinguishes them purely by `capture.kind`, never by epoch value; an ARM_FAILED capture never triggers `assembleDecorationEdit` (Plan 06's kind-branch short-circuits before any disk write), so a malformed/repeated arm-failure publish can at worst spam the World panel's history, never corrupt a `.ilf`. |
</threat_model>

<verification>
`cmake --build packages/live-inject/agent/build-agent --config Release` succeeds with no new warnings;
`grep -c "CONSULT-69"` is 0; `grep -c "code %d"` is 0; the blocking checkpoint's 8 in-game steps all pass.
</verification>

<success_criteria>
020-A's Status Strip fully replaces the CONSULT-69 probe; hover/arm/move/rotate/persist works entirely via
F/G/R hotkeys; every strip state is words, never a raw code — SC1's in-game half is closed and human-verified.
An arm failure now reaches the renderer via the CAPTURE region (C8), not just an agent-local global.
</success_criteria>

<output>
Create `.planning/phases/05.1-live-world-editor-productization/05.1-05-SUMMARY.md` when done
</output>

==================== .planning/phases/05.1-live-world-editor-productization/05.1-06-PLAN.md ====================
---
phase: 05.1-live-world-editor-productization
plan: 06
type: execute
wave: 1
depends_on: ["05.1-01", "05.1-02", "05.1-03", "05.1-04"]
files_modified:
  - packages/renderer/src/services/decorationPersistOrchestrator.ts
  - packages/renderer/src/services/decorationPersistOrchestrator.test.ts
  - packages/renderer/src/services/decorationPersist.ts
  - packages/renderer/src/services/decorationPersist.test.ts
autonomous: true
requirements: [pivot-driven]
must_haves:
  truths:
    - "The mirror-mode toggle controls mirrorToStockIlf per persist, read from the per-project setting (default ON), not a hard-coded literal (SC3)"
    - "Flipping the mirror toggle reconciles ALL already-edited buildings immediately, not just the next persist — disk never claims a stale mirror state (D-09, SC3)"
    - "A kind='add' capture (D-01) is assembled via the same orchestrator path as an edit, appending a row instead of editing one"
    - "When a persist's mirrorToStockIlf resolves to false, the REBIND write to the agent carries REBIND_FLAGS.MIRROR_OFF alongside APPLY, so the in-game strip can render D-10's honesty variant (D-10 HUD-side wiring)"
    - "handleDecorationCapture returns the mirrorToStockIlf value it resolved, so the caller (Plan 08's useChannelReader.ts) can carry that SAME resolved value through to RESULT-time message formatting instead of re-reading settings independently and risking disagreement with the write-time decision (REVIEWS.md C7)"
    - "A capture.kind==='arm-failed' (Plan 03's ARM_FAILED CAPTURE kind, published by Plan 05) short-circuits BEFORE any override-dir resolution or assembleDecorationEdit call, and instead calls worldEditorStore.recordArmFailure with the reason text carried in capture.cellName (REVIEWS.md C8 — closing the consumer half; Plan 05 already publishes the encode half)"
    - "handleDecorationCapture's ctx.studioDir is OPTIONAL, so this plan's own tsc gate stays green at the Wave-1 boundary even though the real caller (useChannelReader.ts) isn't updated to populate it until Plan 08 (Wave 2) — ROUND 3, R1 (HIGH)"
    - "reconcileMirrorMode returns a structured failure list instead of being typed void/'never throws', so Plan 10's caller can actually consume the promised per-building failure reporting instead of wrapping a function that cannot fail in a dead catch (ROUND 3, R8)"
    - "A capture whose cellName is populated is ONLY treated as a pinned-cell hint when capture.kind==='add' — an EDIT capture never accidentally flips from the proven resolveNode path to a pinned resolveRowIndex path due to a stale/leftover cellName (ROUND 3, R12/MED-10)"
  artifacts:
    - path: "packages/renderer/src/services/decorationPersistOrchestrator.ts"
      provides: "mirrorToStockIlf threaded from WorkspaceBindingMeta; reconcileMirrorMode() returning { failures }; capture.kind branch (add + arm-failed); handleDecorationCapture returns { mirrorToStockIlf, cellName?, rowIndex? }; makeReadVfs exported; durable per-building buildingTemplateVfsPath map write"
      contains: "reconcileMirrorMode"
  key_links:
    - from: "packages/renderer/src/services/decorationPersistOrchestrator.ts"
      to: "packages/renderer/src/services/worldEditorScan.ts"
      via: "reconcileMirrorMode reusing scanWorldEditorState as its work list (Pitfall 5 guard)"
      pattern: "scanWorldEditorState\\("
    - from: "packages/renderer/src/services/decorationPersistOrchestrator.ts"
      to: "packages/renderer/src/services/decorationPersist.ts"
      via: "handleDecorationCapture passing edit.kind through to assembleDecorationEdit"
      pattern: "kind:\\s*capture\\.kind"
    - from: "packages/renderer/src/services/decorationPersistOrchestrator.ts"
      to: "packages/renderer/src/state/worldEditorStore.ts"
      via: "capture.kind==='arm-failed' branch calling recordArmFailure(capture.cellName)"
      pattern: "recordArmFailure\\("
---

<objective>
Remove the hard-coded `mirrorToStockIlf: true` literal from `decorationPersistOrchestrator.ts` (the exact
line RESEARCH.md flags as the wiring point) and replace it with a per-project read from
`WorkspaceBindingMeta.mirrorToStockIlf` (Plan 02), defaulting to `true` when absent. Add
`reconcileMirrorMode()` — the function D-09 requires: flipping the toggle must immediately re-run the
mirror-only add/remove step over EVERY building `worldEditorScan.ts` (Plan 04) already finds edited, not just
the next persist, closing the exact stale-override failure class that caused the 7/19→7/30 debugging night.
Also extend `handleDecorationCapture` to branch on the new `capture.kind` field (Plan 03's contract) so an
ADD capture assembles via `assembleDecorationEdit`'s `kind: 'add'` path (Plan 01) instead of the edit path.

**ROUND 3 REVISIONS (2026-08-01, REVIEWS.md R1/R3/R4/R5/R8/MED-10):**
- **R1 (HIGH, Codex, source-confirmed):** `handleDecorationCapture`'s `ctx.studioDir` field is now OPTIONAL
  (`studioDir?: string | null`, treated identically to `null` when absent) instead of required. The real
  caller, `useChannelReader.ts`, is not updated to actually populate it until Plan 08 (Wave 2) — this plan is
  Wave 1, and its own `<verification>` block requires `tsc --noEmit` clean for packages/renderer. A REQUIRED
  field would make that gate fail at the Wave-1 boundary (the existing call site passes only `{ mappingName,
  clientExe }`). Making it optional keeps this plan's gate green without weakening the eventual behavior — Plan
  08 still makes the threading REAL (mandatory in practice, regression-tested) once it fixes the call site;
  this plan's type merely tolerates the transitional state honestly instead of asserting a guarantee no caller
  meets yet.
- **R3 (HIGH, Opus):** `assembleDecorationEdit` needs a STOCK `buildingTemplateVfsPath` on every call, but
  Plan 13's offline Remove has no live capture to read it from (ground truth: the derived `.iff` on disk does
  not self-reference its own stock source path — see Plan 02/04's ROUND 3 notes). Task 1 below ALSO writes the
  observed `capture.buildingTemplateVfsPath` into the new per-project `WorkspaceBindingMeta.
  worldEditorBuildingTemplates` durable map (Plan 02) on every successful edit/add capture, so Plan 04's scan
  and Plan 13's Remove can recover it later.
- **R4 (HIGH, Opus):** `makeReadVfs` (this file, currently module-private) is now `export`ed — Plan 10
  (`reconcileMirrorMode`'s caller) and Plan 13 (`removeDecorationRow`'s caller) both take a `readVfs` parameter
  but had no way to construct one; this plan owns the file, so this plan exports the factory.
- **R5 (HIGH, Sonnet):** `handleDecorationCapture`'s return type gains OPTIONAL `cellName`/`rowIndex` (read
  from `assembleDecorationEdit`'s now-widened `DecorationPersistResult`, Plan 01 ROUND 3) — D-13's detail-card/
  history readout (Plan 04/08/10) needs to know WHICH cell/row a persist touched, not just whether the mirror
  was on.
- **R8 (MEDIUM, Opus):** `reconcileMirrorMode`'s return type changes from `void` to `{ failures: {
  buildingId: string; error: string }[] }` — Plan 10 was written to "wrap it in a dead catch" for a function
  documented as never throwing; the function's OWN behavior spec already says it collects per-building failures
  instead of throwing — this revision makes that contract type-visible so Plan 10 can actually consume it.
- **MED-10 (Opus):** `capture.cellName` is now threaded to `assembleDecorationEdit` ONLY when
  `capture.kind === 'add'` (`cellName: capture.kind === 'add' ? capture.cellName : undefined`), not
  unconditionally — defense-in-depth alongside Plan 12's ROUND 3 fix (R2) that resets the agent-side
  `g_capCellName` global on every fresh EDIT arm: even if a stale/leftover cellName somehow reached this layer,
  an EDIT capture must never be treated as cell-pinned (which would silently swap `resolveNode`'s
  template+position match for a `resolveRowIndex` pinned-cell lookup).

**CROSS-AI REVIEW REVISIONS (2026-08-01):**
- **C10 (MEDIUM, Codex/Opus/Fable):** the original plan's `files_modified` omitted
  `packages/renderer/src/services/decorationPersist.ts` even though Task 1's own action text refactors
  `writeStockMirror`/`removeStockMirror` out of it — a real cross-plan manifest gap (Plan 01 also touches this
  file and lands in wave 0, strictly before this plan's wave 1, so there is no wave conflict; the file was
  simply missing from the list). Fixed by adding it (+ its test file) to `files_modified` below.
- **C7 (MEDIUM, Codex/Opus):** the original design had TWO independent resolutions of `mirrorToStockIlf` for
  the SAME persist — once here at WRITE time (deciding the REBIND flag), and once again at RESULT time in
  Plan 08 Task 3 (by re-reading `readWorkspaceJson`) to build the history message. If the toggle flips
  between those two moments, the two surfaces (in-game strip vs. World panel history) can describe OPPOSITE
  mirror states for the SAME persist, contradicting D-10 (which Plan 15 explicitly verifies together). Fixed
  by changing `handleDecorationCapture`'s return type to carry the resolved `mirrorToStockIlf` value back to
  the caller, so Plan 08 Task 3 stashes THIS value in its `pendingCapture` correlation and formats the
  RESULT-time message from it — one resolution per persist, not two.
- **C8 (MEDIUM, Sonnet/Cursor, consumer half — Plan 05 published the encode half):** `handleDecorationCapture`
  now branches on `capture.kind === 'arm-failed'` BEFORE doing any file I/O, calling
  `useWorldEditorStore.getState().recordArmFailure(capture.cellName)` (Plan 04's new action) and returning
  immediately — no REBIND is sent for this kind (arm failures never reached `armDecorationEdit`'s success
  path, so the agent isn't waiting on a rebind answer for this capture epoch).

Purpose: this is the service-layer half of D-08/D-09 (the toggle UI itself lives in the World panel, Plan
10/11), the orchestrator half of D-01 (ADD capture handling), the single-source-of-truth fix for D-10's
mirror-off reporting (C7), and the consumer half of the arm-failure wiring (C8).
Output: `decorationPersistOrchestrator.ts` reads settings instead of hard-coding them; `reconcileMirrorMode`
is unit tested against a synthetic multi-building override dir; `handleDecorationCapture` returns its resolved
mirrorToStockIlf and branches arm-failed captures into the store.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/phases/05.1-live-world-editor-productization/05.1-RESEARCH.md
@.planning/phases/05.1-live-world-editor-productization/05.1-PATTERNS.md
@.planning/phases/05.1-live-world-editor-productization/05.1-01-SUMMARY.md
@.planning/phases/05.1-live-world-editor-productization/05.1-02-SUMMARY.md
@.planning/phases/05.1-live-world-editor-productization/05.1-04-SUMMARY.md
@.planning/phases/05.1-live-world-editor-productization/05.1-REVIEWS.md
</context>

<interfaces>
From packages/renderer/src/services/decorationPersistOrchestrator.ts (current hard-coded call site, lines
168-176 — the exact literal to replace; the whole function currently returns `void`, revised to return
`{ mirrorToStockIlf: boolean }`):
```typescript
export function handleDecorationCapture(
  epoch: number,
  capture: DecorationCapture,
  ctx: { mappingName: string; clientExe: string | null },
): void {
  // ...
  const result = assembleDecorationEdit(edit, {
    readVfs: makeReadVfs(overrideDir),
    overrideDir,
    log: (m) => dbg(`capture #${epoch}: ${m}`),
    mirrorToStockIlf: true,   // ← replace with a per-project read
  });
  // ...
}
```
Same file, currently module-private (ROUND 3, R4 — `export` this unchanged):
```typescript
function makeReadVfs(overrideDir: string): (vfsPath: string) => Buffer { /* ... */ }
```
From packages/renderer/src/services/projectBinding.ts (Plan 02's target, reuse verbatim):
```typescript
export function readWorkspaceJson(studioDir: string): WorkspaceBindingMeta;
export function updateWorkspaceMeta(studioDir: string, patch: Partial<WorkspaceBindingMeta>): void;
```
From packages/renderer/src/services/worldEditorScan.ts (Plan 04's output, reuse as reconcile's work list —
per RESEARCH Pitfall 5, do NOT build a second scan):
```typescript
export function scanWorldEditorState(overrideDir: string): WorldEditorBuilding[];
```
From packages/renderer/src/services/decorationPersist.ts (Plan 01's kind-aware assembly, extend the call):
```typescript
export interface DecorationEdit { /* ...existing fields... */ kind?: 'edit' | 'add' | 'remove'; }
```
From packages/contracts/src/live-inject.ts (Plan 03 Task 3 output, reuse verbatim — D-10 groundwork):
```typescript
export const LIVE_DECORATION_REBIND_FLAGS = { APPLY: 0x1, ABORT: 0x2, MIRROR_OFF: 0x4 } as const;
```
From packages/contracts/src/live-inject.ts (Plan 03 Task 1 output — the capture.kind union, now three-valued):
```typescript
export interface DecorationCapture { /* ... */ kind?: 'edit' | 'add' | 'arm-failed'; cellName?: string; }
```
From packages/renderer/src/services/decorationPersist.ts (Plan 01's ROUND 3 output — widened result + exported
sanitizeId, reuse verbatim):
```typescript
export interface DecorationPersistResult { rowIndex: number; cellName: string; derivedTemplateVfsPath: string; /* ... */ }
export function sanitizeId(id: string): string;
```
From packages/contracts/src/workspace.ts (Plan 02's ROUND 3 output, reuse verbatim — R3):
```typescript
export interface WorkspaceBindingMeta { /* ...; */ worldEditorBuildingTemplates?: Record<string, string>; }
```
From packages/renderer/src/state/worldEditorStore.ts (Plan 04's output — the C8 consumer):
```typescript
export const useWorldEditorStore: /* ...; recordArmFailure: (reason: string) => void; ... */;
```
</interfaces>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Thread mirrorToStockIlf from settings + reconcileMirrorMode (D-08/D-09) + return resolved value (C7)</name>
  <files>packages/renderer/src/services/decorationPersistOrchestrator.ts, packages/renderer/src/services/decorationPersistOrchestrator.test.ts, packages/renderer/src/services/decorationPersist.ts, packages/renderer/src/services/decorationPersist.test.ts</files>
  <read_first>
    packages/renderer/src/services/decorationPersistOrchestrator.ts (full file — handleDecorationCapture's ctx
    param at lines 146-150 is where studioDir must be threaded in; the function currently returns `void` — this
    task changes its return type)
    packages/renderer/src/services/projectBinding.ts (readWorkspaceJson/updateWorkspaceMeta)
    packages/renderer/src/services/worldEditorScan.ts (scanWorldEditorState — Plan 04 output)
    packages/renderer/src/services/decorationPersist.ts (assembleDecorationEdit's mirrorToStockIlf deps field
    and its stock-path mirror write logic — CURRENTLY an identifiable `if (deps.mirrorToStockIlf) { ... }`
    block, originally at lines 197-204 before Plan 01's Task 3 edits landed; locate it by content — the block
    that writes `mirroredFilePath` and pushes a `'modify'` staged entry — not by a specific line number, since
    Plan 01's kind-aware edits may have shifted it)
    packages/renderer/src/state/worldEditorStore.ts (Plan 04 output — recordArmFailure, the C8 consumer target)
    packages/contracts/src/live-inject.ts (Plan 03 output — DecorationCapture.kind now includes 'arm-failed')
  </read_first>
  <behavior>
    - **(ROUND 3, R1)** handleDecorationCapture's `ctx` param gains `studioDir?: string | null` — OPTIONAL, not
      required (a missing field is treated IDENTICALLY to an explicit `null`). This keeps this plan's own
      `tsc --noEmit` gate green at the Wave-1 boundary, since the real call site (`useChannelReader.ts`) is not
      updated to populate it until Plan 08 (Wave 2) — see this plan's ROUND 3 revision note. When studioDir is
      null/absent (no bound project, or the not-yet-updated caller), mirrorToStockIlf defaults to true (matches
      today's hard-coded behavior — never regress a session with no project context).
    - mirrorToStockIlf is resolved via `readWorkspaceJson(studioDir).mirrorToStockIlf ?? true` immediately
      before calling assembleDecorationEdit, replacing the literal `true`.
    - **(C7) handleDecorationCapture's return type changes from `void` to `{ mirrorToStockIlf: boolean }`.**
      The resolved value is computed ONCE, early in the function (before the try/catch, so it is available
      on EVERY code path including the ABORT/error path), and returned unconditionally at the end of the
      function (both the success return and the catch-block's fallthrough return the SAME resolved value —
      it does not depend on whether assembleDecorationEdit succeeded). This is the value Plan 08 Task 3 must
      stash into its `pendingCapture` correlation and use at RESULT time, instead of independently re-reading
      `readWorkspaceJson` — closing C7's "resolved twice, can disagree" gap.
    - **(C8) A new FIRST branch at the top of handleDecorationCapture:** if `capture.kind === 'arm-failed'`,
      do NOT resolve an override dir, do NOT call assembleDecorationEdit, do NOT call `addon.writeRebind` at
      all (an arm failure never reached a successful arm, so the agent sent no REBIND-awaiting state for this
      epoch) — instead call `useWorldEditorStore.getState().recordArmFailure(capture.cellName ?? '(unknown
      arm failure)')` (capture.cellName carries the reason string for this kind, per Plan 03/05's dual-purpose
      design) and return `{ mirrorToStockIlf: true }` immediately (the mirror value is meaningless for this
      kind — return the harmless default rather than adding a third optional-return shape).
    - `reconcileMirrorMode(studioDir: string, overrideDir: string, readVfs: (vfsPath: string) => Buffer,
      nextValue: boolean): void` — reads `scanWorldEditorState(overrideDir)` for the full list of currently-
      edited buildings; for each, if `nextValue === true` and no stock-path mirror currently exists on disk,
      write one (same bytes as the building's current edited `.ilf` — reuse the mirror-write logic
      assembleDecorationEdit already has, factored into a small shared helper rather than duplicated); if
      `nextValue === false`, delete any existing stock-path mirror file for that building. After reconciling
      every building, calls `updateWorkspaceMeta(studioDir, { mirrorToStockIlf: nextValue })` so the persisted
      flag and disk state land together (never leaving a failed reconcile with a flag that lies about disk
      state — if any per-building reconcile step throws, catch it, continue with the rest, and surface a list
      of failures to the caller rather than aborting the whole reconcile silently).
    - **(ROUND 3, R8)** `reconcileMirrorMode` returns `{ failures: { buildingId: string; error: string }[] }`
      (never `void`) — an empty `failures` array means every building reconciled cleanly; a non-empty array
      lists exactly which buildings failed and why, WITHOUT aborting the rest of the pass (the per-building
      try/catch already described above feeds this return value instead of only logging). This makes the
      function's own "never throws for one bad building" contract type-visible to its caller (Plan 10), instead
      of a documented-but-untyped promise a caller could only observe by wrapping a call in a dead catch.
    - reconcileMirrorMode never THROWS for one bad building; a partial failure is ALWAYS visible in its return
      value, never only in a log line.
    - D-10 (HUD-side wiring): the `addon.writeRebind(...)` call's `flags` argument becomes
      `F.APPLY | (mirrorToStockIlf ? 0 : F.MIRROR_OFF)` instead of the bare `F.APPLY` — this is the ONLY
      change to that call site beyond what mirrorToStockIlf resolution already requires. The agent (Plan 05)
      reads this bit off the SAME REBIND request it already applies; no second write, no new channel region.
    - **(ROUND 3, R5)** handleDecorationCapture's return type widens to `{ mirrorToStockIlf: boolean; cellName?:
      string; rowIndex?: number }`. On a successful assembleDecorationEdit call (kind edit/add), `cellName`/
      `rowIndex` come straight from its now-widened `DecorationPersistResult` (Plan 01 ROUND 3) — the SAME
      values already computed internally, not re-derived. On the arm-failed short-circuit or a caught error,
      `cellName`/`rowIndex` are simply omitted (undefined) — there is no resolved row to report.
    - **(ROUND 3, R3)** On a successful assembleDecorationEdit call for kind edit/add (NEVER for the
      arm-failed short-circuit, which never reaches assembly), when `ctx.studioDir` is non-null AND
      `capture.buildingTemplateVfsPath` is non-empty, call `updateWorkspaceMeta(ctx.studioDir, {
      worldEditorBuildingTemplates: { ...readWorkspaceJson(ctx.studioDir).worldEditorBuildingTemplates,
      [sanitizeId(capture.buildingInstanceId)]: capture.buildingTemplateVfsPath } })` — durably remembering
      this building's stock template path for Plan 13's later, OFFLINE Remove action (which has no live
      capture to read it from). Wrap this write in its own try/catch separate from the main assembly try/catch
      — a failure to persist this BOOKKEEPING map must never abort or fail the persist itself (the `.ilf`
      write and REBIND have already succeeded by this point); log and continue.
    - **(ROUND 3, MED-10)** The `cellName` passed into `assembleDecorationEdit`'s `edit` object is
      `capture.kind === 'add' ? capture.cellName : undefined` — NEVER `capture.cellName` unconditionally. An
      EDIT capture must always resolve via `resolveNode` (template + position match), never accidentally via a
      pinned `resolveRowIndex` lookup, even if a stale/leftover `capture.cellName` somehow arrived non-empty.
  </behavior>
  <action>
    Refactor `assembleDecorationEdit`'s stock-mirror write (packages/renderer/src/services/decorationPersist.ts,
    the `if (deps.mirrorToStockIlf) { ... }` block that writes the mirrored path and pushes a 'modify' staged
    entry) into a small exported helper, e.g. `writeStockMirror(deps, stockIlfVfsPath, editedIlfBytes):
    void` and `removeStockMirror(deps, stockIlfVfsPath): void`, called both from assembleDecorationEdit's
    existing mirrorToStockIlf branch AND from this plan's new reconcileMirrorMode — this is a small
    decorationPersist.ts edit made HERE (not in Plan 01, which already landed) because it is purely a refactor-
    for-reuse with no behavior change to the proven edit path (assert via the existing decorationPersist.test.ts
    suite staying green). In decorationPersistOrchestrator.ts: add the OPTIONAL `studioDir?: string | null` ctx
    field (ROUND 3, R1), resolve mirrorToStockIlf per-project as described EARLY in the function body (before
    the try/catch, treating an absent/null studioDir the same as no project), add the arm-failed short-circuit
    branch as the FIRST statement after that resolution, change the function's return type to `{
    mirrorToStockIlf: boolean; cellName?: string; rowIndex?: number }` (ROUND 3, R5) and return it from every
    exit path (success populates cellName/rowIndex from `result.cellName`/`result.rowIndex`; arm-failed
    short-circuit and the catch block omit them), `export` the existing `makeReadVfs` function unchanged (ROUND
    3, R4), and implement reconcileMirrorMode returning `{ failures: { buildingId: string; error: string }[] }`
    (ROUND 3, R8) using scanWorldEditorState + the two new writeStockMirror/removeStockMirror helpers. Extend
    handleDecorationCapture's edit object to pass `kind: capture.kind === 'add' ? 'add' : 'edit'` and `cellName:
    capture.kind === 'add' ? capture.cellName : undefined` (ROUND 3, MED-10 — gated on kind, never
    unconditional) through to assembleDecorationEdit (Plan 01's DecorationEdit.kind/cellName), so an ADD
    capture from the (not-yet-built) placement flow already assembles correctly once it starts arriving on the
    channel. On a successful edit/add assembly with a non-null `ctx.studioDir` and a non-empty
    `capture.buildingTemplateVfsPath`, ALSO update the durable `worldEditorBuildingTemplates` map on
    `WorkspaceBindingMeta` per the ROUND 3/R3 behavior spec above, importing `sanitizeId` from
    `./decorationPersist` and `readWorkspaceJson`/`updateWorkspaceMeta` from `./projectBinding` (both already
    imported by sibling services in this package). Change the `addon.writeRebind(...)` call site's flags
    argument to `F.APPLY | (mirrorToStockIlf ? 0 : F.MIRROR_OFF)` (D-10) — the `mirrorToStockIlf` local this
    task already resolves is the SAME value that decides this bit; no second resolution.
  </action>
  <verify>
    <automated>npm -w @swg/renderer run test -- decorationPersistOrchestrator decorationPersist</automated>
  </verify>
  <acceptance_criteria>
    A test with two synthetic edited buildings, mirror OFF -> ON, asserts BOTH now have a stock-path mirror
    file matching their edited `.ilf` bytes exactly; ON -> OFF asserts BOTH mirror files are gone; a studioDir
    with no explicit mirrorToStockIlf setting resolves to true (default); a null studioDir also resolves to
    true (no regression for project-less sessions); a capture with kind='add' and a cellName reaches
    assembleDecorationEdit with `kind: 'add'` (asserted via a spy/mock on assembleDecorationEdit or by
    inspecting the written `.ilf`'s appended row); existing decorationPersist.test.ts suite remains 100% green
    after the mirror-write refactor (zero regression). D-14 spot-check: `grep -n "SWG_TOOLKIT_DECO_TRACE" packages/renderer/src/services/decorationPersistOrchestrator.ts` still shows the dbg() gate unchanged (default OFF) after this plan's edits.
    D-10 spot-check: a test with mirrorToStockIlf=false asserts `addon.writeRebind` is called with a flags
    argument that has BOTH `LIVE_DECORATION_REBIND_FLAGS.APPLY` and `.MIRROR_OFF` bits set (bitwise AND check,
    not just truthy); a test with mirrorToStockIlf=true asserts the flags argument has APPLY set and MIRROR_OFF
    NOT set. C7 spot-check: `handleDecorationCapture(...)` returns `{ mirrorToStockIlf: false }` (asserted on
    the return value, not just an internal call) when the project's setting resolves to false, and this
    return value is IDENTICAL for both the success path and a forced assembleDecorationEdit-throws path
    (mocked) — proving the resolution happens once, before the branch, not re-derived per exit. C8 spot-check:
    a capture with `kind: 'arm-failed'` and `cellName: 'no building id — hover a decoration...'` calls
    `useWorldEditorStore.getState().recordArmFailure` with that exact string (spy/mock), does NOT call
    `resolveRunningClientOverrideDir`/`assembleDecorationEdit`/`addon.writeRebind` at all (asserted via
    spies showing zero calls), and the function returns without throwing. ROUND 3/R1 spot-check: calling
    `handleDecorationCapture` with a `ctx` object that OMITS `studioDir` entirely (not even `studioDir:
    undefined`, the field simply absent) type-checks and behaves identically to `studioDir: null` (defaults to
    mirrorToStockIlf=true). ROUND 3/R4 spot-check: `makeReadVfs` is importable from outside this module
    (`export` present). ROUND 3/R5 spot-check: a successful edit-kind capture's return value carries the exact
    `cellName`/`rowIndex` the underlying `assembleDecorationEdit` result reported; an arm-failed capture's
    return value has `cellName`/`rowIndex` both `undefined`. ROUND 3/R8 spot-check: `reconcileMirrorMode`'s
    return value's `failures` array is empty on an all-clean pass and contains one entry per building whose
    mirror write/delete threw (mocked), asserted on the RETURN VALUE, not merely "did not throw". ROUND 3/R3
    spot-check: a successful edit/add capture with a non-null `ctx.studioDir` calls `updateWorkspaceMeta` with a
    `worldEditorBuildingTemplates` patch containing `{ [sanitizeId(capture.buildingInstanceId)]:
    capture.buildingTemplateVfsPath }`, MERGED with whatever `readWorkspaceJson` returned first (asserted via a
    seeded pre-existing map entry for a DIFFERENT building surviving the patch). ROUND 3/MED-10 spot-check: an
    EDIT-kind capture (kind omitted/'edit') carrying a non-empty `capture.cellName` (simulating a stale/leftover
    value) reaches `assembleDecorationEdit` with `edit.cellName === undefined` — never the leftover string.
  </acceptance_criteria>
  <done>mirrorToStockIlf is per-project and reconcile-on-flip is provably reconciling EVERY edited building,
  not just the next persist; ADD captures reach the kind-aware assembly path; the resolved mirrorToStockIlf
  value is returned to the caller once (C7); an arm-failed capture short-circuits into the World panel's
  history (C8).</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| renderer → disk (client override dir) | reconcileMirrorMode writes/deletes stock-path mirror files across potentially many buildings in one pass. |
| renderer poll loop → worldEditorStore (in-process) | The new arm-failed branch (C8) dispatches a store update from agent-published data with no disk write at all. |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-05.1-06a | Tampering | reconcileMirrorMode's per-building loop | mitigate | Reuses the EXACT SAME stock-path resolution (`readInteriorLayoutFileName` off the stock building template) assembleDecorationEdit already uses for the proven edit path — no new path-construction logic, so no new traversal surface. |
| T-05.1-06b | Denial of Service | one corrupted building aborting the whole reconcile | mitigate | Per-building try/catch inside the reconcile loop (behavior spec above) — one bad building's failure is collected and reported, never aborts reconciling the rest, and never leaves the persisted flag out of sync with a reconcile that silently stopped partway. |
| T-05.1-06c | Denial of Service | synchronous, single-threaded write ordering (C13, cross-AI review) | mitigate | `handleDecorationCapture`, `reconcileMirrorMode`, and Plan 13's `removeDecorationRow` are ALL fully synchronous (no `await`/Promise between reading and writing the same `.ilf` — verified this session: zero `async`/`await`/`Promise` tokens in either source file). Node's single-threaded event loop therefore runs each of these three writers to completion before the next callback (poll tick or click handler) executes — true interleaved corruption is not possible under the CURRENT implementation. This invariant MUST be preserved: any future edit that introduces an `await` between a read and its matching write in any of these three functions reintroduces a real lost-update race and must add explicit serialization at that point. |
</threat_model>

<verification>
`npm -w @swg/renderer run test -- decorationPersistOrchestrator decorationPersist` green; `tsc --noEmit`
clean for packages/renderer.
</verification>

<success_criteria>
Mirror-mode is a real per-project setting honored at persist time (SC3); flipping it reconciles disk
immediately and completely (D-09), reporting per-building failures via a real return value (R8); ADD captures
already reach the correct assembly branch before any UI can send one, gated correctly on kind so EDIT never
mis-resolves via a stale cellName (MED-10); the resolved mirrorToStockIlf value is returned once per persist so
RESULT-time formatting (Plan 08) never disagrees with the write-time decision (C7), alongside the resolved
cellName/rowIndex (R5) D-13's detail card needs; an arm-failed capture reaches the World panel's history
without touching the filesystem or the agent's REBIND channel (C8); `ctx.studioDir` is optional so this plan's
own tsc gate passes at the Wave-1 boundary (R1); `makeReadVfs` is exported so Plans 10/13 can build a `readVfs`
(R4); every successful edit/add durably remembers its building's stock template path for Plan 13's offline
Remove (R3).
</success_criteria>

<output>
Create `.planning/phases/05.1-live-world-editor-productization/05.1-06-SUMMARY.md` when done
</output>

==================== .planning/phases/05.1-live-world-editor-productization/05.1-07-PLAN.md ====================
---
phase: 05.1-live-world-editor-productization
plan: 07
type: execute
wave: 1
depends_on: ["05.1-03"]
files_modified:
  - packages/live-inject/agent/channel.cpp
  - packages/live-inject/src/channel_binding.cpp
  - packages/live-inject/src/addon.cpp
autonomous: true
requirements: [pivot-driven]
must_haves:
  truths:
    - "A host-side caller can send one of the six HOST_CMD actions (reload scene, load editor scene, teleport, start/cancel placement, despawn a node) through the SAME single named mapping, and read back the agent's published result (D-07, D-02, D-01 groundwork)"
  artifacts:
    - path: "packages/live-inject/agent/channel.cpp"
      provides: "channelReadHostCommand + channelWriteHostCommandResult (agent side)"
      contains: "channelReadHostCommand"
    - path: "packages/live-inject/src/channel_binding.cpp"
      provides: "N-API writeHostCommand export (host side)"
      contains: "WriteHostCommand"
  key_links:
    - from: "packages/live-inject/src/addon.cpp"
      to: "packages/live-inject/src/channel_binding.cpp"
      via: "exports.Set(\"writeHostCommand\", ...)"
      pattern: "writeHostCommand"
---

<objective>
Implement the C++ read/write halves of Plan 03's new `LIVE_HOST_CMD` region: an agent-side seqlock retry-read
(`channelReadHostCommand`, mirroring the existing `channelReadRebind` idiom exactly) plus an agent-side
single-word result publish (`channelWriteHostCommandResult`, mirroring `channelWriteResult`'s code-before-
epoch discipline); and a host-side N-API write export (`writeHostCommand`, mirroring `writeRebind`'s shape)
so the renderer can eventually send any of the six actions. This plan does NOT wire any actual behavior
(no `overlay.cpp` consumption yet — that is Plan 09) — it proves the wire mechanism itself compiles, opens,
and round-trips on both the agent DLL and the host addon builds.

Purpose: give Plan 09 (agent-side action handling) and Plan 08 (renderer-side send helpers) a working,
buildable channel primitive to consume, per Interface-First ordering.
Output: `channel.cpp`/`channel.h` (channel.h already updated in Plan 03) agent-side functions implemented;
`channel_binding.cpp`/`addon.cpp` host-side N-API export implemented; both packages build clean.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/phases/05.1-live-world-editor-productization/05.1-RESEARCH.md
@.planning/phases/05.1-live-world-editor-productization/05.1-03-SUMMARY.md
</context>

<interfaces>
From packages/live-inject/agent/channel.h (Plan 03's output — the struct fields and HostCommand type already
defined; this plan implements the functions declared there):
```cpp
struct HostCommand { uint32_t epoch; uint32_t action; char str1[256]; char str2[128]; uint64_t id; float vec3[3]; };
bool channelReadHostCommand(HostCommand* out);
void channelWriteHostCommandResult(int32_t code, uint32_t epoch);
```
From packages/live-inject/agent/channel.cpp (existing analog to mirror exactly, lines 206-232):
```cpp
bool channelReadRebind(DecorationRebind* out) { /* seqlock retry-read of the REBIND region */ }
void channelWriteResult(int32_t code, uint32_t epoch) { /* code-before-epoch, InterlockedExchange, no seqlock */ }
```
From packages/live-inject/src/channel_binding.cpp (existing analog to mirror, writeRebind's N-API shape —
read this file's full writeRebind implementation before writing WriteHostCommand):
```
writeRebind(name: string, epoch: number, buildingId: string, derivedTemplate: string, flags: number) -> undefined
```
</interfaces>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Agent-side channelReadHostCommand + channelWriteHostCommandResult</name>
  <files>packages/live-inject/agent/channel.cpp</files>
  <read_first>
    packages/live-inject/agent/channel.cpp (full file — channelReadRebind lines 206-232 and channelWriteResult
    lines 232-250, or wherever they currently sit; these are the EXACT structural analogs)
    packages/live-inject/agent/channel.h (Plan 03's HostCommand struct + LiveState's hostCmd* members —
    already defined, read the final offsets this plan must match)
  </read_first>
  <action>
    Implement `bool channelReadHostCommand(HostCommand* out)` in channel.cpp using the IDENTICAL seqlock
    retry-read pattern channelReadRebind already uses (read hostCmdSeqCounter, bail if odd; copy epoch/
    action/str1/str2/id/vec3 into `*out`; re-read hostCmdSeqCounter, bail if changed — torn read). Implement
    `void channelWriteHostCommandResult(int32_t code, uint32_t epoch)` using the IDENTICAL code-before-epoch,
    InterlockedExchange, no-seqlock pattern channelWriteResult already uses, writing hostCmdResultCode then
    hostCmdResultEpoch. Both functions operate on the SAME mapped view the existing channel functions already
    hold open — do not open a second mapping, do not add a second CreateFileMappingA anywhere.
  </action>
  <verify>
    <automated>cmake --build packages/live-inject/agent/build-agent --config Release</automated>
  </verify>
  <acceptance_criteria>
    Agent DLL builds clean; `channelReadHostCommand`'s retry logic matches `channelReadRebind`'s structure
    line-for-line except for the field set being copied (verified by side-by-side read during review, not an
    automated diff); a torn/mid-write read returns false without touching `*out` (same contract as
    channelReadRebind, verified via the existing pattern's own documented behavior — no NEW unit test
    infrastructure exists for agent-side C++ in this repo, so this task's correctness gate is the build +
    the structural-mirror acceptance criterion, matching how channelReadRebind itself was accepted).
  </acceptance_criteria>
  <done>Agent can read a fresh HOST_CMD epoch and publish a result, using the exact proven seqlock idioms.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Host-side N-API writeHostCommand export</name>
  <files>packages/live-inject/src/channel_binding.cpp, packages/live-inject/src/addon.cpp</files>
  <read_first>
    packages/live-inject/src/channel_binding.cpp (full writeRebind implementation — argument validation,
    string-length truncation into fixed slots, seqlock write sequence — this is the EXACT shape
    WriteHostCommand must follow, including its error-message style: "writeRebind: (name: string, epoch:
    number, ...)")
    packages/live-inject/src/addon.cpp (lines 46-78, the exports.Set(...) registration block and the forward
    declarations comment)
  </read_first>
  <behavior>
    - writeHostCommand(name: string, epoch: number, action: number, str1: string, str2: string, id: string,
      vec3: Float32Array(3) | number[]) -> undefined.
    - Throws a TypeError with a message in the SAME style as writeRebind's ("writeHostCommand: (name: string,
      epoch: number, action: number, str1: string, str2: string, id: string, vec3: Float32Array(3)) expected")
      on any argument-shape mismatch.
    - str1/str2 are truncated to 255/127 chars + null-terminated before the memcpy into the fixed 256/128-byte
      slots (never overflow — same discipline writeRebind already applies to derivedTemplate).
    - id (decimal string) is parsed the same way writeRebind parses buildingId (matches the existing
      _strtoui64-equivalent parse already used there) into the 8-byte hostCmdId field.
    - vec3 writes exactly 3 floats into hostCmdVec3.
    - Throws "writeHostCommand: channel not open — call openChannel first" (same wording style as writeRebind)
      if the named mapping isn't open.
  </behavior>
  <action>
    Implement `Napi::Value WriteHostCommand(const Napi::CallbackInfo& info)` in channel_binding.cpp, copying
    writeRebind's structure: validate argument count/types, look up the open mapping by `name`, truncate/
    null-terminate str1/str2, parse id, seqlock-write (InterlockedIncrement hostCmdSeqCounter to odd, memcpy
    epoch/action/str1/str2/id/vec3, InterlockedIncrement back to even) mirroring writeRebind's own write
    sequence exactly. Register it in addon.cpp's exports block: `exports.Set("writeHostCommand",
    Napi::Function::New(env, WriteHostCommand));`, adding the matching forward declaration alongside the
    existing ones and updating the file's own module-doc comment list of exported functions (mirrors how
    writeRebind is documented there today).
  </action>
  <verify>
    <automated>npm -w @swg/live-inject run build</automated>
  </verify>
  <acceptance_criteria>
    Host addon builds clean; `node -e` smoke check (or an existing native-binding test harness if one exists
    in this package) confirms `require('@swg/live-inject').writeHostCommand` is a function; a malformed-
    argument call throws the documented TypeError message; a call before openChannel throws the documented
    "channel not open" error.
  </acceptance_criteria>
  <done>writeHostCommand is exported from @swg/live-inject, argument-validated and truncation-safe exactly
  like writeRebind.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| renderer/host → agent (shared-memory channel) | Cross-process write into a memory region the injected agent DLL reads every frame. |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-05.1-07a | Tampering | writeHostCommand str1/str2 truncation | mitigate | Explicit truncate-then-null-terminate before memcpy (behavior spec, Task 2) — identical discipline to writeRebind's existing derivedTemplate handling; no unbounded write into the fixed 256/128-byte slots is possible from JS-side input. |
| T-05.1-07b | Denial of Service | agent-side torn/mid-write read | mitigate | channelReadHostCommand follows the proven seqlock retry-read contract (Task 1) — a torn read simply returns false and the caller retries next poll tick; never blocks, never reads partial data. |
</threat_model>

<verification>
`cmake --build packages/live-inject/agent/build-agent --config Release` and `npm -w @swg/live-inject run
build` both succeed clean.
</verification>

<success_criteria>
The HOST_CMD wire mechanism (write from host, read+ack from agent) exists and builds on both sides, proven
structurally identical to the already-shipped REBIND mechanism it mirrors — ready for Plan 08 (renderer send
helpers) and Plan 09 (agent action handling) to build behavior against.
</success_criteria>

<output>
Create `.planning/phases/05.1-live-world-editor-productization/05.1-07-SUMMARY.md` when done
</output>

==================== .planning/phases/05.1-live-world-editor-productization/05.1-08-PLAN.md ====================
---
phase: 05.1-live-world-editor-productization
plan: 08
type: execute
wave: 2
depends_on: ["05.1-03", "05.1-07", "05.1-02", "05.1-04", "05.1-01"]
files_modified:
  - packages/renderer/src/services/hostCommand.ts
  - packages/renderer/src/services/hostCommand.test.ts
  - packages/renderer/src/hooks/useChannelReader.ts
  - packages/renderer/src/hooks/useChannelReader.test.ts
  - packages/renderer/src/services/decorationChannel.ts
  - packages/renderer/src/services/decorationChannel.test.ts
autonomous: true
requirements: [pivot-driven]
must_haves:
  truths:
    - "A renderer caller can send any of the six HOST_CMD actions with one small typed function per action, and observe the agent's ack via the existing channel poll loop, rendered as WORDS not a raw numeric code (D-07 groundwork, D-02 despawn groundwork, D-01 placement groundwork, REVIEWS.md C9)"
    - "A fresh decoration edit/add persist RESULT is recorded into worldEditorStore.recordPersistResult exactly once per epoch, with a words-not-codes D-10-compliant message and D-12's failure badge wired correctly (SC1, SC4, D-10, D-12)"
    - "parseDecorationCapture (decorationChannel.ts) actually DECODES capture.kind/capture.cellName from the wire — Plan 03 defined the offsets and the agent-side encode, but the renderer-side decode was owned by NO plan until this revision; without it, every ADD capture silently assembles as an EDIT (REVIEWS.md C2, BLOCKER — decode half)"
    - "useChannelReader.ts's real call site threads studioDir into handleDecorationCapture's ctx — the ONLY place this was ever going to happen, since Plan 06 defined ctx.studioDir but never had a caller that populated it (REVIEWS.md C3, HIGH)"
    - "The mirror-off boolean used to format a RESULT's history message is the SAME value handleDecorationCapture resolved and returned at CAPTURE time (Plan 06, C7) — not a second, independent readWorkspaceJson call at RESULT time that could disagree with the write-time decision"
    - "A recorded PersistHistoryEntry carries D-13's before/after-transform + cell/row data (from pendingCapture) so the World panel's detail card can render the full readout the locked decision promises, and the mirror-off suffix is applied ONLY to a successful result's message — never appended to a genuine failure's message, which would read as a success-shaped sentence (ROUND 3, R5/MED-9)"
  artifacts:
    - path: "packages/renderer/src/services/hostCommand.ts"
      provides: "typed send* wrapper functions over addon.writeHostCommand + a words-only per-action outcome describer"
      contains: "sendReloadCurrentScene"
    - path: "packages/renderer/src/services/decorationChannel.ts"
      provides: "parseDecorationCapture decodes CAPTURE_KIND/CAPTURE_CELL_NAME into capture.kind/capture.cellName"
      contains: "CAPTURE_KIND"
  key_links:
    - from: "packages/renderer/src/hooks/useChannelReader.ts"
      to: "packages/renderer/src/services/hostCommand.ts"
      via: "parseHostCommandResult read on every poll tick, epoch-gated exactly like the existing decoration RESULT read"
      pattern: "parseHostCommandResult\\("
    - from: "packages/renderer/src/hooks/useChannelReader.ts"
      to: "packages/renderer/src/state/worldEditorStore.ts"
      via: "a fresh decoration edit/add RESULT epoch, correlated with its originating CAPTURE via a pending-capture local, calling recordPersistResult with a formatPersistMessage(...)-built entry"
      pattern: "recordPersistResult\\("
    - from: "packages/renderer/src/hooks/useChannelReader.ts"
      to: "packages/renderer/src/services/decorationPersistOrchestrator.ts"
      via: "handleDecorationCapture(...) called WITH ctx.studioDir populated from useWorkspaceStore, and its return value destructured for mirrorToStockIlf"
      pattern: "ctx\\.studioDir|studioDir:\\s*useWorkspaceStore"
---

<objective>
Build the renderer-side thin wrapper (`hostCommand.ts`) over Plan 07's `addon.writeHostCommand`, one small
typed function per action (`sendReloadCurrentScene`, `sendLoadEditorScene`, `sendTeleport`,
`sendStartPlacement`, `sendCancelPlacement`, `sendDespawnNode`), and extend `useChannelReader.ts`'s existing
poll loop to read back `HOST_CMD_RESULT_CODE`/`HOST_CMD_RESULT_EPOCH` (Plan 03's contract) with the SAME
epoch-gated once-per-result idiom the decoration RESULT read already uses (lines 275-280 today) — so any
future caller (World panel's Scene accordion, Plan 11; the Remove action, Plan 13; the Add wizard, Plan 14)
gets a working send+ack primitive with zero further channel plumbing.

Also closes a wiring gap identified in the 2026-07-31 revision: the base EDIT-path and ADD-path decoration
persist RESULT (the pre-existing CAPTURE/RESULT cycle, not the new HOST_CMD region) was never dispatched into
`worldEditorStore.recordPersistResult` — only `log()`ged. Plan 04 defines `recordPersistResult`/
`formatPersistMessage`; only Plan 13 (Remove) called it, from its own bespoke non-CAPTURE path. Task 3 below
wires the common move/rotate/add → Persist case into the SAME store, closing D-10's App-side mirror-off detail
sentence, D-12's attention badge for a failed base-edit persist, and the one World-panel refresh trigger SC4's
ADD two-surface confirm (Plan 14) depends on.

**ROUND 3 REVISIONS (2026-08-01, REVIEWS.md R5/MED-9):**
- **R5 (HIGH, Sonnet):** Task 3's `pendingCapture` local now ALSO stashes `beforeTransform:
  capture.originalO2p`, `afterTransform: capture.newO2p` (both already present on every `DecorationCapture` —
  no new wire field needed), and `cellName`/`rowIndex` from `handleDecorationCapture`'s now-widened return
  value (Plan 06 ROUND 3). The `PersistHistoryEntry` built at RESULT time carries all four (Plan 04 ROUND 3
  widened the interface to accept them) — closing D-13's locked "before/after transforms, cell, row" promise,
  which `PersistHistoryEntry` previously had no fields for at all.
- **MED-9 (Opus):** the mirror-off suffix (`formatPersistMessage`) is applied ONLY when `res.code === 0`
  (a genuine success). A non-zero result code already produces a real failure label via
  `decorationResultLabel(res.code)` — appending "— mirror off — not visible on hybrid sessions until reload
  into an editor scene" to a FAILURE message would misleadingly imply the persist actually SAVED (just
  invisibly), when it did not save at all. The message construction below is revised accordingly.

**CROSS-AI REVIEW REVISIONS (2026-08-01, source-confirmed this session against real
`decorationChannel.ts:36-61` and `useChannelReader.ts:267-280`):**
- **C2 (BLOCKER, decode half — Cursor/Opus/Fable):** Plan 03 grew the CAPTURE region's wire layout
  (CAPTURE_KIND/CAPTURE_CELL_NAME) and its agent-side ENCODE, but no plan ever taught
  `parseDecorationCapture` (`decorationChannel.ts:36-61`, verified this session — it decodes only the
  original six fields) to actually READ those two new offsets. Without this fix, `capture.kind` is
  `undefined` FOREVER at runtime — every real ADD capture would silently assemble through the EDIT path
  (`resolveNode` finds no match for a freshly-placed node → "could not resolve" → SC4 broken), masked entirely
  by unit tests elsewhere in this phase that hand-construct `capture` objects with `kind` pre-set. Task 3 below
  fixes the decode. This plan already depends on Plan 03; adding this file also creates an implicit
  dependency on Plan 01 (which also touches `decorationChannel.ts`, wave 0) — added to `depends_on` for
  correctness, though no wave change results (this plan is already wave 2, strictly after Plan 01's wave 0).
- **C3 (HIGH — Fable, root cause; reinforces Opus/Codex):** `useChannelReader.ts:267-273` (verified this
  session) calls `handleDecorationCapture(cap.epoch, cap.capture, { mappingName, clientExe })` — Plan 06 added
  a `studioDir` field to the `ctx` parameter's TYPE, but THIS is the only real call site in the entire
  codebase, and it never populated it. Left unfixed, `mirrorToStockIlf` would resolve to the default `true`
  FOREVER in the live app (recreating the exact D-09 stale-mirror class this phase exists to close), and D-10's
  strip variant would never fire live. Task 3 fixes the actual call site.
- **C7 (MEDIUM — Codex/Opus):** Plan 06 now returns `{ mirrorToStockIlf }` from `handleDecorationCapture` (the
  SAME value it used to decide the REBIND flag). Task 3 below stashes THIS returned value in `pendingCapture`
  and uses it — verbatim, not re-read — when the matching RESULT lands, instead of independently calling
  `readWorkspaceJson` a second time at RESULT time.
- **C9 (MEDIUM — Sonnet/Cursor):** the original Task 2 logged HOST_CMD results as a raw
  `"Host command #{epoch}: result {code}."` string. Task 1/2 below add a small, words-only, per-action outcome
  describer (`describeHostCommandResult`) and use it in the log line — closing the literal "raw code visible
  somewhere" defect for the log surface. Rich per-call-site UI toasts (Scene/despawn/placement reading this
  themselves) remain a DOCUMENTED, ACCEPTED gap for a future phase — recorded, not silently implied as built
  (see this plan's `success_criteria`).

Purpose: complete the renderer half of the HOST_CMD channel (Plan 07 built the native half) before any UI
consumes it, per Interface-First ordering; give every decoration persist RESULT — not just Remove — a real
path into the World panel's session history and failure badge; and close the C2/C3/C7/C9 wiring gaps the
cross-AI review found in the SAME functions this plan already owns.
Output: `hostCommand.ts` exported send* functions + a `parseHostCommandResult` reader + a words-only outcome
describer; `decorationChannel.ts`'s `parseDecorationCapture` decodes kind/cellName; `useChannelReader.ts`
polls and logs/dispatches the HOST_CMD result each tick (words-only), threads `studioDir` into the REAL
capture call site, uses the RETURNED mirrorToStockIlf (not a second read), and records every fresh decoration
edit/add RESULT into `worldEditorStore.history`/`hasFailureBadge`.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/phases/05.1-live-world-editor-productization/05.1-RESEARCH.md
@.planning/phases/05.1-live-world-editor-productization/05.1-03-SUMMARY.md
@.planning/phases/05.1-live-world-editor-productization/05.1-07-SUMMARY.md
@.planning/phases/05.1-live-world-editor-productization/05.1-04-SUMMARY.md
@.planning/phases/05.1-live-world-editor-productization/05.1-02-SUMMARY.md
@.planning/phases/05.1-live-world-editor-productization/05.1-01-SUMMARY.md
@.planning/phases/05.1-live-world-editor-productization/05.1-06-SUMMARY.md
@.planning/phases/05.1-live-world-editor-productization/05.1-REVIEWS.md
</context>

<interfaces>
From packages/contracts/src/live-inject.ts (Plan 03's output, reuse verbatim):
```typescript
export const LIVE_HOST_CMD_LAYOUT: { HOST_CMD_SEQ_COUNTER, HOST_CMD_EPOCH, HOST_CMD_ACTION, HOST_CMD_STR1, HOST_CMD_STR2, HOST_CMD_ID, HOST_CMD_VEC3, HOST_CMD_RESULT_CODE, HOST_CMD_RESULT_EPOCH };
export const LIVE_HOST_CMD_ACTION: { RELOAD_CURRENT_SCENE: 1, LOAD_EDITOR_SCENE: 2, TELEPORT: 3, START_PLACEMENT: 4, CANCEL_PLACEMENT: 5, DESPAWN_NODE: 6 };
export const LIVE_DECORATION_LAYOUT: { /* ...; */ CAPTURE_KIND: { offset: 1308, length: 4 }; CAPTURE_CELL_NAME: { offset: 1312, length: 128 }; };
export const LIVE_DECORATION_CAPTURE_KIND: { EDIT: 0, ADD: 1, ARM_FAILED: 2 };
```
From packages/live-inject (Plan 07's output, reuse verbatim):
```typescript
addon.writeHostCommand(name: string, epoch: number, action: number, str1: string, str2: string, id: string, vec3: Float32Array | number[]): void;
```
From packages/renderer/src/services/decorationChannel.ts (verified this session, lines 36-61 — the function
this plan's Task 3 extends; DO NOT change its seqlock structure, only add two more field reads inside the
existing seq1...seq2 span):
```typescript
export function parseDecorationCapture(buf: ArrayBuffer): { epoch: number; capture: DecorationCapture } | null {
  const view = new DataView(buf);
  const D = LIVE_DECORATION_LAYOUT;
  const seq1 = view.getUint32(D.CAPTURE_SEQ_COUNTER.offset, true);
  if ((seq1 & 1) !== 0) return null;
  // ... reads epoch, buildingInstanceId, originalO2p, newO2p, decorationTemplateName, buildingTemplateVfsPath ...
  const seq2 = view.getUint32(D.CAPTURE_SEQ_COUNTER.offset, true);
  if (seq1 !== seq2) return null;
  return { epoch, capture: { /* ...six existing fields... */ } };
}
export function readDecorationResult(buf: ArrayBuffer): { epoch: number; code: number };
export function decorationResultLabel(code: number): string;
```
From packages/renderer/src/hooks/useChannelReader.ts (verified this session, lines 267-280 — the EXACT real
call site this plan's Task 3 fixes; note it currently passes only `{ mappingName, clientExe }`, NEVER
`studioDir`):
```typescript
const cap = parseDecorationCapture(buf);
if (cap !== null && cap.epoch > lastCaptureEpoch) {
  lastCaptureEpoch = cap.epoch;
  handleDecorationCapture(cap.epoch, cap.capture, {
    mappingName,
    clientExe: useLiveStore.getState().clientLabel,
  });
}
const res = readDecorationResult(buf);
if (res.epoch > lastResultEpoch) {
  lastResultEpoch = res.epoch;
  const level = res.code === 0 ? 'info' : 'warn';
  log(level, 'log', `Decoration rebind #${res.epoch}: ${decorationResultLabel(res.code)}.`);
}
```
From packages/renderer/src/services/decorationPersistOrchestrator.ts (Plan 06's ROUND 3 output — now returns
a value, and short-circuits arm-failed captures; `studioDir` is OPTIONAL on the ctx param, R1 — this task's
fix makes the REAL call site populate it anyway, which is what matters at runtime):
```typescript
export function handleDecorationCapture(
  epoch: number,
  capture: DecorationCapture,
  ctx: { mappingName: string; clientExe: string | null; studioDir?: string | null },
): { mirrorToStockIlf: boolean; cellName?: string; rowIndex?: number };
```
From packages/renderer/src/state/worldEditorStore.ts (Plan 04's ROUND 3 output, reuse verbatim — Task 3's
target; PersistHistoryEntry widened per R5):
```typescript
export interface PersistHistoryEntry { timestampISO: string; buildingLabel: string; decorationLabel: string; outcome: 'ok' | 'warn' | 'error'; message: string; beforeTransform?: number[]; afterTransform?: number[]; cellName?: string; rowIndex?: number; }
export function formatPersistMessage(baseLabel: string, mirrorToStockIlf: boolean): string;
export const useWorldEditorStore: /* ...; recordPersistResult: (entry: PersistHistoryEntry) => void; tree: WorldEditorBuilding[]; hasFailureBadge: boolean; ... */;
```
From packages/renderer/src/services/projectBinding.ts (existing, extended by Plan 02 with `mirrorToStockIlf`):
```typescript
export function readWorkspaceJson(studioDir: string): WorkspaceBindingMeta; // .mirrorToStockIlf?: boolean
```
From packages/renderer/src/state/workspaceStore.ts (existing — the active project's studioDir, read-only here):
```typescript
export const useWorkspaceStore: /* ...; studioDir: string | null; ... */;
```
</interfaces>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: hostCommand.ts — typed send* wrappers + epoch counter + words-only outcome describer (C9)</name>
  <files>packages/renderer/src/services/hostCommand.ts, packages/renderer/src/services/hostCommand.test.ts</files>
  <read_first>
    packages/contracts/src/live-inject.ts (LIVE_HOST_CMD_ACTION values and per-action payload comment table —
    Plan 03's output)
    packages/renderer/src/services/decorationPersistOrchestrator.ts (lines 38-42, the `require('@swg/live-
    inject')` Path-B addon-require idiom to mirror — do not import differently)
  </read_first>
  <behavior>
    - A module-local monotonic epoch counter (starts at 1, never resets) is shared across all six send
      functions — the agent's channelReadHostCommand contract treats "new epoch" as "new command," so every
      send must use a fresh, strictly-increasing value regardless of which action it is.
    - sendReloadCurrentScene(mappingName: string): void — action RELOAD_CURRENT_SCENE, empty str1/str2/id/
      vec3.
    - sendLoadEditorScene(mappingName: string, terrain: string, avatarTemplate: string): void — action
      LOAD_EDITOR_SCENE, str1=terrain, str2=avatarTemplate.
    - sendTeleport(mappingName: string, x: number, y: number, z: number): void — action TELEPORT,
      vec3=[x,y,z].
    - sendStartPlacement(mappingName: string, decorationTemplate: string, cellName: string, buildingId:
      string): void — action START_PLACEMENT, str1=decorationTemplate, str2=cellName, id=buildingId.
    - sendCancelPlacement(mappingName: string): void — action CANCEL_PLACEMENT.
    - sendDespawnNode(mappingName: string, networkId: string): void — action DESPAWN_NODE, id=networkId.
    - Each function is a thin, single-purpose wrapper — no business logic, no validation beyond what
      writeHostCommand itself already throws on.
    - **(C9)** `describeHostCommandResult(action: number, code: number): string` — a words-only per-action
      outcome describer (mirrors `decorationResultLabel`'s idiom for a DIFFERENT result space). For
      RELOAD_CURRENT_SCENE/LOAD_EDITOR_SCENE/TELEPORT/START_PLACEMENT/CANCEL_PLACEMENT: `code === 1` → 'ok',
      anything else → 'endpoint unresolved or failed'. For DESPAWN_NODE specifically (mirrors
      utinni_wsRemoveNode's documented 1/0/-1 contract): `1` → 'despawned', `0` → 'not found (already gone or
      buildout-provenance)', `-1` → 'occupied — try again', anything else → 'unknown outcome'. An unrecognized
      `action` value returns `'unknown action'` rather than throwing (fail-closed on a malformed/future-
      version code, matching the agent-side dispatch's own fail-closed discipline from Plan 09).
  </behavior>
  <action>
    Create hostCommand.ts requiring `@swg/live-inject` the SAME way decorationPersistOrchestrator.ts does
    (`const addon = require('@swg/live-inject') as { writeHostCommand: (...) => void }`), a module-scope
    `let hostCmdEpoch = 0;` counter, and the six exported functions above, each incrementing the counter and
    calling `addon.writeHostCommand(mappingName, ++hostCmdEpoch, LIVE_HOST_CMD_ACTION.<ACTION>, str1 ?? '',
    str2 ?? '', id ?? '0', vec3 ?? [0,0,0])`. Also export `parseHostCommandResult(buf: ArrayBuffer): { epoch:
    number; code: number }`, structurally identical to decorationChannel.ts's readDecorationResult but reading
    LIVE_HOST_CMD_LAYOUT.HOST_CMD_RESULT_CODE/HOST_CMD_RESULT_EPOCH. Add `describeHostCommandResult(action,
    code)` per the behavior spec above. Write hostCommand.test.ts mocking the `@swg/live-inject` require the
    same way any existing orchestrator test does (check decorationPersistOrchestrator.test.ts for the mock
    pattern and copy it), asserting each send* function calls writeHostCommand with the correct action code
    and payload shape, that consecutive sends use strictly increasing epochs, and that
    describeHostCommandResult returns the documented words for each (action, code) pair in the behavior spec
    (including the DESPAWN_NODE-specific 1/0/-1 mapping and the unknown-action fallback).
  </action>
  <verify>
    <automated>npm -w @swg/renderer run test -- hostCommand</automated>
  </verify>
  <acceptance_criteria>
    All six send* functions call writeHostCommand with the documented action code and payload mapping
    (asserted per function); epochs strictly increase across calls within a test; parseHostCommandResult
    correctly reads a synthetic ArrayBuffer with known HOST_CMD_RESULT_CODE/EPOCH bytes written at the
    documented offsets; describeHostCommandResult never returns a string containing a bare digit sequence
    equal to the input code (words only, per C9).
  </acceptance_criteria>
  <done>hostCommand.ts exists, fully covered, ready for any UI to call, with a words-only outcome describer.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: useChannelReader.ts — poll and log HOST_CMD results as WORDS (C9)</name>
  <files>packages/renderer/src/hooks/useChannelReader.ts, packages/renderer/src/hooks/useChannelReader.test.ts</files>
  <read_first>
    packages/renderer/src/hooks/useChannelReader.ts (full file — lines 231-280, the poll() closure's local
    lastCaptureEpoch/lastResultEpoch pattern and the decoration-result epoch-gate block to mirror exactly)
    packages/renderer/src/services/hostCommand.ts (this plan's Task 1 output — parseHostCommandResult,
    describeHostCommandResult)
  </read_first>
  <behavior>
    - poll() gains a local `lastHostCmdResultEpoch = 0` (reset per-effect, same lifetime as
      lastCaptureEpoch/lastResultEpoch) AND a local tracking the last-SENT action per epoch is NOT needed here
      — this task only needs the CODE, and describeHostCommandResult needs an `action` value too. Since this
      generic poll-level log line does not know which action a given HOST_CMD_RESULT_EPOCH answers (that
      correlation lives with whichever caller sent it — Plan 11/13/14), this task logs using a best-effort
      generic label: log the raw epoch/code pair through `describeHostCommandResult` called with `action: 0`
      (an unrecognized action, per Task 1's fail-closed contract) ONLY as a fallback if no richer per-action
      caller-side translation exists yet — **REVISED to avoid a misleading "unknown action" log line**: this
      task instead logs `Host command #{epoch}: ${code === 1 ? 'ok' : 'not ok'} (code ${code} — see the action
      site that sent it for a words-only outcome; per-action translation lives in Plan 11/13/14's own callers)`
      is EXPLICITLY REJECTED as still containing a raw code. Instead: log ONLY the words-level summary
      `Host command #{epoch}: ${code === 1 ? 'ok' : 'not ok'}.` — this is a coarse but ALWAYS-words-only line
      (no numeric code appears anywhere in it), acceptable at this generic poll-log layer since the RICH,
      per-action, human-readable outcome (via `describeHostCommandResult(action, code)`) is each specific
      caller's own job once it knows which action it sent (Plan 11's Scene buttons, Plan 13's despawn, Plan
      14's placement) — this generic log line is a coarse diagnostic trace, not the SC1-facing UI surface.
    - Each tick, after the existing decoration-result read, call parseHostCommandResult(buf); if
      `res.epoch > lastHostCmdResultEpoch`, update the tracker and log the coarse words-only outcome above.
    - No regression to the existing decoration CAPTURE/RESULT handling — this is a pure addition alongside it.
  </behavior>
  <action>
    Add the `lastHostCmdResultEpoch` local and the parseHostCommandResult call + words-only log line inside
    poll(), positioned right after the existing `readDecorationResult` block, importing parseHostCommandResult
    from hostCommand.ts. Add or extend useChannelReader.test.ts with a case asserting a synthetic buffer with a
    fresh HOST_CMD_RESULT_EPOCH produces exactly one log call whose message contains NO bare numeric code (a
    regex assertion, e.g. the logged string does not match `/\bcode\s+-?\d+\b/i` or a raw standalone digit
    sequence matching the input code), and a repeat poll with the SAME epoch produces no additional log call
    (epoch-gate correctness, mirroring however the existing decoration-result test already proves this for
    readDecorationResult).
  </action>
  <verify>
    <automated>npm -w @swg/renderer run test -- useChannelReader</automated>
  </verify>
  <acceptance_criteria>
    New test asserts exactly one log emission per fresh HOST_CMD_RESULT_EPOCH, with a message containing no
    raw numeric result code, and zero on a repeat poll of the same epoch; all pre-existing useChannelReader
    tests remain green (zero regression to decoration capture/result or guard-field handling).
  </acceptance_criteria>
  <done>The poll loop observes HOST_CMD results exactly once per epoch, alongside the existing decoration
  capture/result handling, logging a words-only coarse outcome (C9's log-line fix) with zero regression. Rich
  per-action outcome translation is each specific caller's job (Plan 11/13/14) — documented here as an
  intentionally NOT-built richer UX, not silently assumed complete.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: decorationChannel.ts CAPTURE decode (C2) + studioDir threading (C3) + resolved-mirror threading (C7) + wire decoration edit/add persist RESULT into worldEditorStore (D-10/D-12)</name>
  <files>packages/renderer/src/hooks/useChannelReader.ts, packages/renderer/src/hooks/useChannelReader.test.ts, packages/renderer/src/services/decorationChannel.ts, packages/renderer/src/services/decorationChannel.test.ts</files>
  <read_first>
    packages/renderer/src/services/decorationChannel.ts (the REAL, current file — `parseDecorationCapture`
    lines 36-61 decodes only the original six fields; this task adds two more reads INSIDE the existing
    seq1...seq2 span, per Plan 03 Task 1's explicit ordering requirement)
    packages/contracts/src/live-inject.ts (Plan 03's output — `LIVE_DECORATION_LAYOUT.CAPTURE_KIND`/
    `.CAPTURE_CELL_NAME`, `LIVE_DECORATION_CAPTURE_KIND = { EDIT: 0, ADD: 1, ARM_FAILED: 2 }`)
    packages/renderer/src/state/worldEditorStore.ts (Plan 04's ALREADY-LANDED file — read the real, exact
    `PersistHistoryEntry` shape, `recordPersistResult` signature, and `formatPersistMessage` signature;
    treat this file as ground truth over any older plan-doc paraphrase, since Plan 04 executes in Wave 0,
    strictly before this Wave-2 task runs)
    packages/renderer/src/hooks/useChannelReader.ts (the REAL, current call site — lines 267-280, verified
    this session: `handleDecorationCapture(cap.epoch, cap.capture, { mappingName, clientExe:
    useLiveStore.getState().clientLabel })` — studioDir is NEVER passed. This task fixes THIS EXACT call site)
    packages/renderer/src/services/decorationPersistOrchestrator.ts (Plan 06's REVISED
    `handleDecorationCapture` — now returns `{ mirrorToStockIlf: boolean }` and short-circuits
    `capture.kind === 'arm-failed'` before any REBIND is sent)
    packages/renderer/src/state/workspaceStore.ts (useWorkspaceStore — .studioDir accessor for the active
    project, read-only use here, no new write path)
  </read_first>
  <behavior>
    - **(C2 decode fix)** `parseDecorationCapture` reads two MORE fields inside the SAME `seq1`...`seq2`
      seqlock span the existing six reads already use (between the existing field reads and the `seq2`
      re-check — NOT after it): `const kindNum = view.getUint32(D.CAPTURE_KIND.offset, true);` mapped to
      `'edit' | 'add' | 'arm-failed'` via `LIVE_DECORATION_CAPTURE_KIND` (0→'edit', 1→'add', 2→'arm-failed',
      any other value → 'edit' as a fail-safe default — never throw on an unrecognized kind), and
      `const cellNameRaw = readAsciiz(buf, D.CAPTURE_CELL_NAME.offset, D.CAPTURE_CELL_NAME.length);` included
      in the returned `capture` object as `cellName: cellNameRaw || undefined` (empty string becomes
      `undefined`, matching the interface's optional-field contract). The returned `capture` object gains
      `kind` and `cellName` alongside the existing six fields.
    - **(C3 fix — the ACTUAL bug)** `useChannelReader.ts`'s poll() gains
      `const studioDir = useWorkspaceStore.getState().studioDir;` (read once per tick, cheap) and the REAL
      call site is changed from `{ mappingName, clientExe: ... }` to
      `{ mappingName, clientExe: useLiveStore.getState().clientLabel, studioDir }` — this is the ONLY change
      needed to make Plan 06's `ctx.studioDir` resolution actually receive a value in the live app, closing
      C3 (previously: `mirrorToStockIlf` would resolve to the hard-coded `true` default FOREVER in production,
      even with the toggle wired everywhere else).
    - **(C7 fix)** poll() gains a local `let pendingCapture: { epoch: number; capture: DecorationCapture;
      mirrorToStockIlf: boolean; cellName?: string; rowIndex?: number } | null = null;` (reset per-effect, ROUND
      3/R5 widens the shape with `cellName`/`rowIndex`). The CAPTURE epoch-gate block's call to
      `handleDecorationCapture(...)` now captures its return value:
      `const { mirrorToStockIlf, cellName, rowIndex } = handleDecorationCapture(cap.epoch, cap.capture, {
      mappingName, clientExe, studioDir });` — and `pendingCapture` stashes ALL of these returned values, not a
      fresh `readWorkspaceJson` call and not a re-derivation of cellName/rowIndex. **Exception:** when
      `cap.capture.kind === 'arm-failed'`, do NOT set `pendingCapture` at all (Plan 06 never sends a REBIND for
      this kind, so no RESULT will ever arrive to correlate against — leaving a stale `pendingCapture` around
      would risk a LATER, unrelated RESULT epoch incorrectly matching it; simply skip the stash for this kind
      and let the existing `if (cap.epoch > lastCaptureEpoch)` gate still mark the epoch as seen).
    - Immediately after the existing `handleDecorationCapture(...)` call inside the CAPTURE epoch-gate block
      (for non-arm-failed kinds), set `pendingCapture = { epoch: cap.epoch, capture: cap.capture,
      mirrorToStockIlf, cellName, rowIndex };` — this stashes kind/buildingInstanceId/buildingTemplateVfsPath/
      decorationTemplateName/cellName/originalO2p/newO2p (all already on `capture`) PLUS the resolved mirror
      value AND the resolved cellName/rowIndex (ROUND 3/R5) for correlation with the RESULT that answers this
      exact capture (the agent publishes HOST_CMD/decoration RESULT_EPOCH equal to the epoch it was asked to
      rebind, the same value `addon.writeRebind(mappingName, epoch, ...)` already sends).
    - Inside the existing decoration-RESULT epoch-gate block (`if (res.epoch > lastResultEpoch)`), immediately
      after the existing `log(...)` line: if `pendingCapture !== null && pendingCapture.epoch === res.epoch`,
      build a `PersistHistoryEntry` and call `useWorldEditorStore.getState().recordPersistResult(entry)`, then
      set `pendingCapture = null` so a later, unrelated RESULT epoch never reuses a stale capture context. A
      RESULT epoch with no matching pendingCapture (e.g., app restarted mid-cycle, or the matching capture was
      an arm-failed one that never got stashed) is safely skipped — never fabricates an entry, never throws.
    - **(C7, continued; ROUND 3/MED-9 revises which branch this applies to)** `message:
      res.code === 0 ? formatPersistMessage(decorationResultLabel(res.code), pendingCapture.mirrorToStockIlf) :
      decorationResultLabel(res.code)` — the mirror-off suffix is appended ONLY on a genuine success
      (`res.code === 0`); a non-zero (failure) code uses `decorationResultLabel(res.code)` DIRECTLY, with no
      mirror-off suffix, so a failure message never reads as a success-shaped sentence (MED-9 — a failed persist
      did not "save invisibly", it did not save at all). The success branch still uses the STASHED,
      CAPTURE-TIME-RESOLVED value from `pendingCapture.mirrorToStockIlf`, NOT a fresh independent
      `readWorkspaceJson` read at RESULT time (C7's "resolved twice, can disagree" fix, unchanged by this
      revision).
    - Entry fields (ROUND 3/R5 adds the last four): `outcome: res.code === 0 ? 'ok' : 'error'`
      (every nonzero LIVE_DECORATION_RESULT code — e.g. NODE_NOT_FOUND, BUILDING_ID_MISMATCH, any SAVE_*
      refusal — is a genuine failure and MUST set worldEditorStore's `hasFailureBadge` per D-12; there is no
      intermediate 'warn' case for the base edit/add path, since the mirror-off detail is carried in the
      MESSAGE text per D-10, not the outcome tier); `buildingLabel`: best-effort human label —
      `useWorldEditorStore.getState().tree.find((b) => b.buildingId === pendingCapture.capture.buildingInstanceId)
      ?.displayLabel ?? pendingCapture.capture.buildingInstanceId` (never a result code — a raw building id
      string is an identifier, not a code, so this satisfies SC1 even on the fallback branch);
      `decorationLabel: pendingCapture.capture.decorationTemplateName`; `timestampISO: new Date().toISOString()`;
      `beforeTransform: pendingCapture.capture.originalO2p`; `afterTransform: pendingCapture.capture.newO2p`;
      `cellName: pendingCapture.cellName`; `rowIndex: pendingCapture.rowIndex` (ROUND 3/R5 — D-13's locked
      before/after-transform + cell/row promise; the last two are `undefined` if `handleDecorationCapture`
      didn't resolve them, e.g. on a caught-error exit — this is acceptable, the detail card renders what it
      has). If `PersistHistoryEntry`'s real, already-landed shape (per this task's `read_first`) carries any
      additional field beyond these nine, populate it from the same `pendingCapture`/resolution data — do not
      invent a field the real type does not declare, and do not drop one it does.
    - No regression: the pre-existing decoration-RESULT log line and this plan's Task 2 HOST_CMD-result log
      line are both left exactly as-is — this is a pure addition alongside them, not a replacement.
  </behavior>
  <action>
    In decorationChannel.ts: extend `parseDecorationCapture` per the C2 behavior spec above — add the two new
    `view`/`readAsciiz` reads BETWEEN the existing field reads and the `seq2` re-check line, add `kind`/
    `cellName` to the returned `capture` object, and export the kind-number-to-string mapping helper (or
    inline the switch) using `LIVE_DECORATION_CAPTURE_KIND`. Extend decorationChannel.test.ts with cases:
    a synthetic buffer with `CAPTURE_KIND=1` and a `CAPTURE_CELL_NAME` ASCII string decodes
    `capture.kind==='add'` and `capture.cellName` equal to that string; `CAPTURE_KIND=0` (or the field simply
    zeroed, matching a pre-Plan-03 buffer shape) decodes `capture.kind==='edit'` and `capture.cellName===
    undefined`; `CAPTURE_KIND=2` decodes `capture.kind==='arm-failed'`; add ONE integration-style test that
    builds a raw synthetic ArrayBuffer by hand (correct byte offsets per LIVE_DECORATION_LAYOUT, even seqlock
    counter, CAPTURE_KIND=1, a real cellName string) and calls the REAL `parseDecorationCapture` (not a
    mocked capture object) to prove the full decode chain works end-to-end — satisfying the cross-AI review's
    explicit ask for "one integration test that drives a real ADD-kind buffer through parse, not a mocked
    capture" (C2).
    In useChannelReader.ts: add the `const studioDir = useWorkspaceStore.getState().studioDir;` local (import
    `useWorkspaceStore` from `../state/workspaceStore`), fix the REAL `handleDecorationCapture(...)` call site
    to pass `{ mappingName, clientExe: useLiveStore.getState().clientLabel, studioDir }`, capture its return
    value, add the `pendingCapture` local (including the `mirrorToStockIlf` field and the arm-failed
    exclusion), and add the recordPersistResult call (with the entry construction above, using
    `pendingCapture.mirrorToStockIlf` not a fresh read) in the decoration-RESULT epoch-gate block, importing
    `useWorldEditorStore` and `formatPersistMessage` from `../state/worldEditorStore` and `useWorkspaceStore`
    from `../state/workspaceStore`. Extend useChannelReader.test.ts with cases asserting: the
    `handleDecorationCapture` mock/spy is called with a `ctx` object whose `studioDir` matches a seeded
    `useWorkspaceStore` value (C3 — the actual regression test for the actual bug); a fresh edit-kind CAPTURE
    followed by a matching fresh RESULT epoch with code=0 (OK) calls recordPersistResult exactly once with
    `outcome: 'ok'` and a words-only `message` (never containing a raw numeric code); a fresh RESULT with a
    nonzero code (e.g. LIVE_DECORATION_RESULT.NODE_NOT_FOUND) calls recordPersistResult with `outcome:
    'error'`, a `message` that is EXACTLY `decorationResultLabel(res.code)` with NO mirror-off suffix appended
    even when the mocked `handleDecorationCapture` returned `mirrorToStockIlf: false` (ROUND 3/MED-9 — the
    regression test for "never mirror-suffix a failure"), and asserts
    `useWorldEditorStore.getState().hasFailureBadge === true` after the call (D-12); a
    test where the mocked `handleDecorationCapture` returns `{ mirrorToStockIlf: false }` on a SUCCESS result
    (`res.code === 0`) asserts the recorded `message` equals `formatPersistMessage(...)`'s exact returned string
    built from THAT returned value, even when a SEPARATE mocked `readWorkspaceJson` call (if any exists in the
    test's arrangement) would have returned a DIFFERENT value — proving the RETURNED value wins, not an
    independent re-read (C7's actual regression test); a recorded entry's `beforeTransform`/`afterTransform`
    equal the originating capture's `originalO2p`/`newO2p` exactly, and `cellName`/`rowIndex` equal the mocked
    `handleDecorationCapture` return's `cellName`/`rowIndex` exactly (ROUND 3/R5); an arm-failed capture does
    NOT populate `pendingCapture` (asserted by confirming a
    SUBSEQUENT unrelated RESULT epoch, if any, does not spuriously call recordPersistResult using stale
    arm-failed capture data); polling the SAME RESULT epoch a second time produces zero additional
    recordPersistResult calls (idempotency, reusing the existing epoch-gate test idiom); a RESULT epoch that
    arrives with no matching pendingCapture calls neither recordPersistResult nor throws.
  </action>
  <verify>
    <automated>npm -w @swg/renderer run test -- useChannelReader decorationChannel</automated>
  </verify>
  <acceptance_criteria>
    A real (not hand-constructed) synthetic ADD-kind ArrayBuffer decodes correctly through the REAL
    `parseDecorationCapture` (C2's integration-test requirement); a test seeding `useWorkspaceStore` with a
    known `studioDir` asserts `handleDecorationCapture` is called with that EXACT studioDir in its `ctx`
    argument (C3's regression test); a simulated fresh edit-RESULT epoch results in exactly one
    recordPersistResult call carrying a words-not-codes message (never a raw LIVE_DECORATION_RESULT numeric
    code) — traces to SC1; a RESULT with LIVE_DECORATION_RESULT.NODE_NOT_FOUND (or any nonzero code) sets
    `outcome: 'error'`, which worldEditorStore.recordPersistResult turns into `hasFailureBadge === true` —
    traces to D-12; the mirror-off SUCCESS result's recorded message equals `formatPersistMessage(...)`'s exact
    returned string built from the RETURNED (not re-read) mirrorToStockIlf value — traces to D-10/C7; a
    mirror-off FAILURE result's recorded message carries NO mirror-off suffix at all (ROUND 3/MED-9); a
    recorded success entry's `beforeTransform`/`afterTransform`/`cellName`/`rowIndex` match the originating
    capture/resolution exactly (ROUND 3/R5, D-13); repolling
    the identical RESULT epoch produces zero additional recordPersistResult calls (idempotent per epoch) —
    traces to SC4's two-surface-confirm reliability; all pre-existing useChannelReader/decorationChannel tests
    (decoration capture/result, HOST_CMD result from Task 2, guard-field handling, the existing
    decorationResultLabel cases) remain green with zero regression.
  </acceptance_criteria>
  <done>Any base edit or add persist RESULT that lands on the channel is recorded into worldEditorStore's
  session history and attention badge exactly once, with a words-not-codes D-10-compliant message — closing
  the D-10/D-12/SC4 wiring gap the 2026-07-31 revision identified. `parseDecorationCapture` actually decodes
  the ADD-identity fields Plan 03 defined (C2 closed — SC4's ADD path can now actually work end-to-end). The
  real `useChannelReader.ts` call site threads `studioDir` (C3 closed — the mirror toggle actually takes
  effect live). RESULT-time message formatting reuses the CAPTURE-time-resolved mirror value, never a second
independent read (C7 closed), and NEVER appends the mirror-off suffix to a genuine failure message (MED-9
closed). Every recorded entry carries D-13's before/after-transform + cell/row data when available (R5
closed). The pre-existing decoration-RESULT and HOST_CMD-result log lines are unchanged.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| renderer → host addon → agent | hostCommand.ts is the renderer's only entry point into the new HOST_CMD wire mechanism. |
| renderer poll loop → worldEditorStore (in-process) | Task 3 dispatches decoration RESULT outcomes into a Zustand store consumed by the World panel UI — no cross-process or cross-trust-boundary write, purely an in-renderer state update. |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-05.1-08a | Tampering | free-text str1/str2 payloads (scene names, decoration templates, cellNames) | mitigate | These values are passed straight through to writeHostCommand, which truncates/null-terminates into the fixed slots (T-05.1-07a) — hostCommand.ts adds no path-construction or shell-command use of these strings; they are pure IPC payload. |
| T-05.1-08b | Denial of Service | unbounded epoch counter overflow | accept | A uint32 epoch counter incrementing on human-triggered actions (scene loads, teleports, placements, despawns) will not realistically overflow within a session; same accepted-risk class as the existing decoration capture epoch counter. |
| T-05.1-08c | Repudiation | pendingCapture/RESULT correlation feeding worldEditorStore's session history | mitigate | Correlation is gated by the SAME epoch-monotonic checks already proven for CAPTURE/RESULT (`res.epoch > lastResultEpoch`, `pendingCapture.epoch === res.epoch`) — no duplicate or out-of-order history entries are possible; a RESULT with no matching pendingCapture is safely skipped, never fabricates an entry attributing a false building/decoration identity; an arm-failed capture never populates pendingCapture at all, closing the risk of a later unrelated RESULT being mis-attributed to it. |
| T-05.1-08d | Information Disclosure | this plan's generic HOST_CMD poll-log line (C9) | mitigate | Deliberately coarse ("ok"/"not ok" only, no numeric code) at this generic layer — the RICHER per-action words-only outcome (`describeHostCommandResult`) is available for any specific caller (Plan 11/13/14) that knows which action it sent; this plan does not wire those specific call sites itself (documented, accepted gap, not silently assumed built). |
</threat_model>

<verification>
`npm -w @swg/renderer run test -- hostCommand useChannelReader decorationChannel` green; `tsc --noEmit` clean
for packages/renderer.
</verification>

<success_criteria>
Any later UI plan can call one of six typed send* functions and see the agent's ack flow through the existing
poll loop with zero additional channel plumbing, logged as words only at the generic layer (C9's log-line
fix; richer per-action toasts remain a documented, NOT-built gap for Plan 11/13/14 to optionally pick up).
`parseDecorationCapture` actually decodes the ADD-identity fields (C2 closed). The real `useChannelReader.ts`
call site threads `studioDir` so the mirror toggle works live, not just in unit tests (C3 closed). Every base
edit/add decoration persist RESULT — not just Remove — reaches worldEditorStore's session history and failure
badge, using the SAME mirror-resolution value the write decided (C7 closed), closing D-10/D-12/SC4's wiring
gap.
</success_criteria>

<output>
Create `.planning/phases/05.1-live-world-editor-productization/05.1-08-SUMMARY.md` when done
</output>

==================== .planning/phases/05.1-live-world-editor-productization/05.1-09-PLAN.md ====================
---
phase: 05.1-live-world-editor-productization
plan: 09
type: execute
wave: 2
depends_on: ["05.1-05", "05.1-07"]
files_modified:
  - packages/live-inject/agent/overlay.cpp
  - packages/live-inject/agent/rva_table.cpp
autonomous: false
requirements: [pivot-driven]
user_setup:
  - service: local-swg-client
    why: "Scene reload/editor-scene/teleport/despawn commands can only be verified against a running, injected client"
    dashboard_config:
      - task: "Rebuild the agent DLL and re-inject/re-launch before verifying"
        location: "cmake --build packages/live-inject/agent/build-agent --config Release (node on PATH)"
must_haves:
  truths:
    - "The already-bound game::loadScene / teleport / reload-scene engine calls can be triggered remotely via the new HOST_CMD channel, not only from local ImGui buttons (D-07 groundwork for the World panel Scene accordion)"
    - "wsRemoveNode is bound and callable to despawn a this-session live node on request (D-02/D-04 groundwork for REMOVE's live-despawn case)"
  artifacts:
    - path: "packages/live-inject/agent/overlay.cpp"
      provides: "per-frame HOST_CMD consumption for RELOAD_CURRENT_SCENE/LOAD_EDITOR_SCENE/TELEPORT/DESPAWN_NODE"
      contains: "channelReadHostCommand"
    - path: "packages/live-inject/agent/rva_table.cpp"
      provides: "worldSnapshot::wsRemoveNode binding"
      contains: "wsRemoveNode"
  key_links:
    - from: "packages/live-inject/agent/overlay.cpp"
      to: "packages/live-inject/agent/rva_table.cpp"
      via: "the DESPAWN_NODE handler calling the newly-bound wsRemoveNode function pointer"
      pattern: "wsRemoveNode\\("
---

<objective>
Make the agent consume Plan 07's `channelReadHostCommand` once per frame and act on four of the six actions:
`RELOAD_CURRENT_SCENE`, `LOAD_EDITOR_SCENE`, and `TELEPORT` (all three calling the SAME already-bound,
already-shipped engine endpoints the CONSULT-69 probe's manual buttons used — `wsUnloadSnapshot`+`wsLoad`,
`gameLoadScene`, `setTransform_o2w` on the player — no new engine call, just a new REMOTE trigger path) and
`DESPAWN_NODE` (newly binding the already-advertised-but-unbound `worldSnapshot::wsRemoveNode`, scoped per
RESEARCH's Pitfall 2/4 to this-session `wsAddObject`-minted preview nodes only). `START_PLACEMENT`/
`CANCEL_PLACEMENT` are deliberately OUT of this plan's scope — that is Plan 12's dedicated ghost/reticle
placement-mode work, a materially larger state-machine addition.

**PLANNING NOTE (Opus/Fable, cross-AI review, LOW severity, reconciled here):** this plan runs in Wave 2,
strictly AFTER Plan 05 (Wave 1), which rewrites large sections of `overlay.cpp` (retiring the CONSULT-69
`CollapsingHeader` block and adding a new `renderDecorationStrip()` function). Any specific LINE NUMBERS this
plan cites for `overlay.cpp` are PRE-Plan-05 coordinates (this session's actual file state) and WILL have
shifted by the time this plan executes. Locate every cited block by FUNCTION/VARIABLE NAME (e.g.
`applyPendingRebind`, `gameLoadScene`, `g_lastRayObj`, `wsUnloadSnapshot`) via grep, never by trusting the
literal line number below — this applies to every `read_first`/`interfaces` citation in this plan.

Purpose: give the World panel's Scene accordion (Plan 11) and the Remove action's live-despawn case (Plan 13)
a working remote trigger before either UI lands.
Output: `overlay.cpp` gains a `handleHostCommand()` step in the per-frame loop; `rva_table.cpp` binds
`wsRemoveNode`; both manually smoke-verified in-game.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/phases/05.1-live-world-editor-productization/05.1-RESEARCH.md
@.planning/phases/05.1-live-world-editor-productization/05.1-PATTERNS.md
@.planning/phases/05.1-live-world-editor-productization/05.1-05-SUMMARY.md
@.planning/phases/05.1-live-world-editor-productization/05.1-07-SUMMARY.md
</context>

<interfaces>
From packages/live-inject/agent/channel.h (Plan 03/07 output, reuse verbatim):
```cpp
struct HostCommand { uint32_t epoch; uint32_t action; char str1[256]; char str2[128]; uint64_t id; float vec3[3]; };
bool channelReadHostCommand(HostCommand* out);
void channelWriteHostCommandResult(int32_t code, uint32_t epoch);
static constexpr uint32_t HOST_CMD_ACTION_RELOAD_CURRENT_SCENE = 1;
static constexpr uint32_t HOST_CMD_ACTION_LOAD_EDITOR_SCENE   = 2;
static constexpr uint32_t HOST_CMD_ACTION_TELEPORT            = 3;
static constexpr uint32_t HOST_CMD_ACTION_START_PLACEMENT     = 4; // NOT handled by this plan
static constexpr uint32_t HOST_CMD_ACTION_CANCEL_PLACEMENT    = 5; // NOT handled by this plan
static constexpr uint32_t HOST_CMD_ACTION_DESPAWN_NODE        = 6;
```
From packages/live-inject/agent/overlay.cpp (PRE-Plan-05 line numbers, verified this session — LOCATE BY
FUNCTION NAME after Plan 05 has run, per this plan's objective note; the "World edit" reload/editor-scene/
teleport section is UNCHANGED by Plan 05 in CONTENT, only its line offset moves):
```cpp
swg::endpoints::wsUnloadSnapshot(); swg::endpoints::wsLoad(scene);          // reload current scene
swg::endpoints::gameLoadScene(terrain, avatarTemplate);                     // editor scene
swg::endpoints::getPlayer(); swg::endpoints::setTransform_o2w(player, t12); // teleport (identity rotation)
```
From packages/live-inject/agent/rva_table.cpp (the binding-row triad pattern to copy for wsRemoveNode, lines
258-269/348-352 as of this session — grep for `wsAddObject`/`wsSetNodeTemplateName` if these have shifted):
```cpp
typedef int64_t(__cdecl* pWsAddObject)(const char* tmpl, const float* transform12, int64_t containedById);
pWsAddObject wsAddObject = nullptr;
Binding g_agentBindings[] = { {"worldSnapshot::wsAddObject", (void**)&wsAddObject}, /* ... */ };
```
Ground-truth signature (advertised, engine_advertise.cpp:993, WorldSnapshot.cpp:2348-2358 — no provider
change needed):
```cpp
extern "C" int __cdecl utinni_wsRemoveNode(__int64 networkIdInt); // 1 removed / 0 miss(id-less/buildout) / -1 occupied
```
</interfaces>

<tasks>

<task type="auto">
  <name>Task 1: Bind wsRemoveNode</name>
  <files>packages/live-inject/agent/rva_table.cpp</files>
  <read_first>
    packages/live-inject/agent/rva_table.cpp (full file — the wsSetNodeTemplateName/wsAddObject typedef+slot+
    binding-row triad is the exact three-part pattern to copy; this file is NOT touched by Plan 05, so its
    pre-existing line numbers from this session remain accurate)
  </read_first>
  <action>
    Add `typedef int(__cdecl* pWsRemoveNode)(int64_t networkIdInt);` and `pWsRemoveNode wsRemoveNode =
    nullptr;` near the existing wsSetNodeTemplateName declarations, and add
    `{"worldSnapshot::wsRemoveNode", (void**)&wsRemoveNode}` to `g_agentBindings[]` with a comment noting the
    1/0/-1 return contract and the scope constraint (toolkit-session-added preview node despawn ONLY — never
    called on an id-less `.ilf`-sourced decoration, per RESEARCH Pitfall 2/4).
  </action>
  <verify>
    <automated>cmake --build packages/live-inject/agent/build-agent --config Release</automated>
  </verify>
  <acceptance_criteria>
    `grep -n "wsRemoveNode" packages/live-inject/agent/rva_table.cpp` shows both the typedef/slot and the
    binding-row entry; build succeeds.
  </acceptance_criteria>
  <done>wsRemoveNode is bound and callable via swg::endpoints::wsRemoveNode.</done>
</task>

<task type="auto">
  <name>Task 2: handleHostCommand() — RELOAD/LOAD_EDITOR_SCENE/TELEPORT/DESPAWN_NODE</name>
  <files>packages/live-inject/agent/overlay.cpp</files>
  <read_first>
    packages/live-inject/agent/overlay.cpp (locate by NAME, not line number, per this plan's objective note:
    `applyPendingRebind`'s per-frame consume-once-per-epoch structure is the EXACT structural analog for
    handleHostCommand; the reload/editor-scene/teleport call sites — grep for `wsUnloadSnapshot`,
    `gameLoadScene`, `setTransform_o2w` near a "World edit"/"Editor scene"/"Teleport" ImGui section — are
    reused verbatim, not reimplemented)
  </read_first>
  <behavior>
    - Once per frame (called from renderFrame(), alongside applyPendingRebind()), read a fresh HOST_CMD epoch
      via channelReadHostCommand; if epoch is 0 or equal to the last-applied epoch, no-op (same
      once-per-epoch contract as applyPendingRebind).
    - RELOAD_CURRENT_SCENE: calls the SAME wsUnloadSnapshot()+wsLoad(currentScene) sequence the existing
      "Reload current scene" button uses (resolve currentScene via getSceneId, same as today); result code
      1=ok if wsLoad was bound and a scene was resolved, 0 otherwise.
    - LOAD_EDITOR_SCENE: calls gameLoadScene(str1 as terrain, str2 as avatarTemplate) if bound; result 1=ok,
      0=endpoint unresolved.
    - TELEPORT: calls getPlayer()+setTransform_o2w(player, identity-rotation-with-vec3-as-position) exactly
      as the existing teleport button does; result 1=ok, 0=endpoint unresolved or no player.
    - DESPAWN_NODE: parses `id` (uint64) and calls wsRemoveNode(id) if bound; result code is wsRemoveNode's
      OWN return value verbatim (1/0/-1) — do not remap it.
    - Any action value outside these four (i.e. 4/5, START_PLACEMENT/CANCEL_PLACEMENT — reserved for Plan 12)
      OR any unrecognized future value is a no-op that still calls channelWriteHostCommandResult(0, epoch) —
      fail closed, never silently drop the epoch tracking (so Plan 12's future handler can safely coexist by
      widening this same dispatch, not by fighting over epoch tracking).
    - After handling, publish the result via channelWriteHostCommandResult(code, epoch) and update the
      last-applied-epoch tracker.
  </behavior>
  <action>
    Add `void handleHostCommand()` implementing the dispatch above, called from renderFrame() immediately
    after applyPendingRebind(). Reuse the exact existing reload/editor-scene/teleport logic already present in
    the file (grep for the section per read_first above) by extracting the minimal shared call sequence into
    small local helper functions (or calling the exact same endpoint sequence inline) so the EXISTING manual
    ImGui buttons keep working unchanged (do not remove them — Plan 05 already scoped its removal to the
    CONSULT-69 header only; these reload/editor-scene/teleport controls live OUTSIDE that removed block and
    stay as-is for local debugging) while the new remote path reuses the identical engine call sequence, not a
    divergent copy.
  </action>
  <verify>
    <automated>cmake --build packages/live-inject/agent/build-agent --config Release</automated>
  </verify>
  <acceptance_criteria>
    Build succeeds; `grep -n "handleHostCommand" packages/live-inject/agent/overlay.cpp` shows the function
    defined and called from renderFrame(); an out-of-range action value still results in a published
    HOST_CMD_RESULT (verified by code review — a switch/if-else with a fail-closed default branch, not a
    missing-default crash risk).
  </acceptance_criteria>
  <done>Four of the six HOST_CMD actions are consumed once per frame, reusing proven endpoint call sequences,
  with a fail-closed default for the two reserved-for-later actions.</done>
</task>

<task type="checkpoint:human-verify" gate="blocking">
  <name>Task 3: HOST_CMD live checkpoint</name>
  <files>packages/live-inject/agent/overlay.cpp, packages/live-inject/agent/rva_table.cpp</files>
  <action>
    Pause for human verification. Claude has bound wsRemoveNode and wired the agent to consume RELOAD_CURRENT_SCENE/LOAD_EDITOR_SCENE/TELEPORT/DESPAWN_NODE host commands (Tasks 1-2). Rebuild the agent DLL and confirm each of the four remote actions actually triggers its engine call live, per the steps below.
  </action>
  <what-built>
    The agent now consumes remote host commands for reload-current-scene, load-editor-scene, teleport, and
    despawn-node, alongside the existing local ImGui buttons for the first three. wsRemoveNode is bound.
  </what-built>
  <how-to-verify>
    1. Rebuild the agent DLL and re-inject/re-launch.
    2. From a Node REPL or a small throwaway script requiring `@swg/live-inject` directly (not through any UI
       — none exists yet), call `writeHostCommand(mappingName, 1, 1 /* RELOAD_CURRENT_SCENE */, '', '', '0',
       [0,0,0])` while attached to a loaded scene; confirm the scene visibly reloads in-game, matching what
       the existing "Reload current scene" button already does.
    3. Call action 3 (TELEPORT) with a known-good x/y/z; confirm the player teleports, matching the existing
       teleport button's behavior.
    4. Spawn a test object via the existing "Insert at player" button (captures a live `.ws` node id from its
       "Inserted node id" readout), then call action 6 (DESPAWN_NODE) with that id as the `id` string; confirm
       the object disappears in-game and a subsequent despawn of the SAME id (or a stock/never-added
       decoration's id) returns 0/-1 per the documented contract, not a crash.
  </how-to-verify>
  <resume-signal>Type "approved" once all four checks hold, or describe which failed.</resume-signal>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| host addon → agent (HOST_CMD region) | The agent trusts and acts on whatever the host writes into this shared-memory region every frame. |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-05.1-09a | Elevation of Privilege | DESPAWN_NODE acting on an arbitrary id | mitigate | wsRemoveNode's OWN engine-side guard (`wsIsBuildoutNode`) already refuses id-less/buildout-provenance nodes (verified ground truth, WorldSnapshot.cpp:2348-2358) — this plan does not widen that; the RENDERER-side caller (Plan 13) is additionally responsible for only ever sending ids it tracked from its own wsAddObject spawns (RESEARCH Pitfall 4), but the engine-side guard is the actual enforcement boundary, not caller discipline alone. |
| T-05.1-09b | Denial of Service | unrecognized HOST_CMD_ACTION value | mitigate | Explicit fail-closed default branch (behavior spec) — never crashes, never spins, always publishes a result so the host-side epoch tracking never stalls waiting for an ack that will never come. |
| T-05.1-09c | Tampering | TELEPORT vec3 / DESPAWN_NODE id crossing the channel | accept | Same trust model as the existing REBIND region (host and agent are the SAME toolkit's two processes, not a network boundary) — no additional validation beyond what the engine's own APIs already enforce. |
</threat_model>

<verification>
`cmake --build packages/live-inject/agent/build-agent --config Release` succeeds; the blocking checkpoint's
four in-game/script checks all pass.
</verification>

<success_criteria>
Reload/editor-scene/teleport/despawn are all remotely triggerable via the HOST_CMD channel, reusing proven
endpoint call sequences, human-verified live — ready for the World panel (Plan 11) and Remove action (Plan
13) to call.
</success_criteria>

<output>
Create `.planning/phases/05.1-live-world-editor-productization/05.1-09-SUMMARY.md` when done
</output>

==================== .planning/phases/05.1-live-world-editor-productization/05.1-10-PLAN.md ====================
---
phase: 05.1-live-world-editor-productization
plan: 10
type: execute
wave: 2
depends_on: ["05.1-04", "05.1-06"]
files_modified:
  - packages/renderer/src/workspace/WorkspaceShell.tsx
  - packages/renderer/src/workspace/workspace-config.ts
  - packages/renderer/src/panels/world/WorldPanel.tsx
  - packages/renderer/src/panels/world/WorldPanel.test.tsx
autonomous: true
requirements: [pivot-driven]
must_haves:
  truths:
    - "The World panel matches sketch 019-A's building-tree spine element-for-element (SC2) for the tree/detail-card/mirror-toggle/live-strip elements this plan builds; Activity/Scene accordions and the footer land in Plan 11"
    - "The mirror-mode scope control shows a VISIBLE, DISABLED 'Per-instance (server repoint)' option with a 'coming later' hint next to the active 'Per-template' option — D-08 locked decision, not an omission (D-08)"
    - "The World tab's dockview title reflects hasFailureBadge (a visible marker, e.g. an appended glyph), and opening/activating the World tab calls acknowledgeFailures() — D-12's 'attention badge' contract has a REAL renderer, not just store-side logic with no UI consumer (REVIEWS.md C12)"
    - "The live-session strip shows a visible hint when the attached client's install path differs from the project's bound client (D-07b mismatch hint)"
    - "The mirror-mode toggle actually resolves a real overrideDir/readVfs pair and calls reconcileMirrorMode with them — not a call this plan describes but never shows how to construct (ROUND 3, R4)"
    - "mirrorToStockIlf has exactly ONE persistence owner (reconcileMirrorMode) — the panel's toggle never independently calls updateWorkspaceMeta, closing the two-writers-two-moments D-09 risk (ROUND 3, R6)"
    - "The detail card's inert stub buttons (Go to / Revert / Edit in game) show an explicit, honest 'not yet wired' message when clicked — never the sketch mock's literal action-implying toast text ('Reverting row 3…', 'Row pinned to overlay gizmo') (ROUND 3, R11a)"
  artifacts:
    - path: "packages/renderer/src/panels/world/WorldPanel.tsx"
      provides: "the 019-A dockview World tab"
      contains: "Edited buildings"
  key_links:
    - from: "packages/renderer/src/workspace/WorkspaceShell.tsx"
      to: "packages/renderer/src/panels/world/WorldPanel.tsx"
      via: "panelComponents['world'] registration"
      pattern: "world:\\s*WorldPanel"
    - from: "packages/renderer/src/panels/world/WorldPanel.tsx"
      to: "packages/renderer/src/state/worldEditorStore.ts"
      via: "useWorldEditorStore selector reads for the tree/selection; hasFailureBadge drives the dockview tab title; acknowledgeFailures() called on panel activation"
      pattern: "useWorldEditorStore\\("
sketch_elements:
  # 019-A elements this plan builds (the rest land in Plan 11):
  - "dockview World tab in the Inspect | Deploy | World tabstrip"
  - "live-session strip (dot, exe/pid, scene chip, refresh)"
  - "mirror-mode toggle row (switch, label, per-template/per-instance scope hint, PER-TEMPLATE badge)"
  - "scope control shows BOTH modes: 'Per-template (all instances of this layout)' active, AND 'Per-instance (server repoint)' as a VISIBLE, DISABLED option with a 'coming later' hint (D-08 — locked decision; NOT optional, NOT Claude's discretion)"
  - "'Edited buildings' collapsible section with a live count chip"
  - "building tree rows (icon, name, template/node-id subtext, status badge e.g. '3 SAVED' / '1 UNAPPLIED')"
  - "nested decoration rows under their building (indent, name, cell·row subtext, SAVED/ARMED badge)"
  - "selection detail card (Decoration / Cell·row / Position / Last persist / Files, with Go to / Revert / Edit in game actions)"
---

<objective>
Build sketch 019-A's spine: a real dockview `World` tab, registered per `WorkspaceShell.tsx`'s established
5-place contract (`panelComponents`, `STATIC_PANEL_IDS`, `PANEL_TITLES`, `PANEL_REOPEN_POSITIONS`, +
`LAYOUT_VERSION` bump in `workspace-config.ts`), rendering the building-first tree (buildings own the
hierarchy, decorations nest under their building), the mirror-mode toggle (wired to Plan 06's per-project
threading), the live-session strip (reading `liveStore` the same way `StatusBar.tsx` already does), and a
selection detail card. This plan does NOT build the Activity/Scene accordions or the footer's Add-decoration/
Stage buttons — those are Plan 11, kept separate to respect the 2-3 task budget and because they depend on
Plan 08's HOST_CMD wrapper this plan does not need.

**ROUND 3 REVISIONS (2026-08-01, REVIEWS.md R4/R5/R6/R8/R11a/MED-7/MED-11):**
- **R4 (HIGH, Opus):** the original Task 2 said the mirror toggle's onChange "calls reconcileMirrorMode" but
  never showed how `overrideDir`/`readVfs` — two of `reconcileMirrorMode`'s four required parameters — get
  built. Task 2 now explicitly resolves `overrideDir` via `resolveScanRoot` (Plan 04 ROUND 3, imported by name)
  and `readVfs` via `makeReadVfs` (Plan 06 ROUND 3, now exported), the SAME two helpers the refresh() flow
  already needs.
- **R6 (MEDIUM, Opus):** the original design had the toggle's onChange call BOTH `reconcileMirrorMode` (which
  itself calls `updateWorkspaceMeta`, per Plan 06) AND a second, separate `updateWorkspaceMeta` call from this
  panel — two writers, two moments, the exact divergence class D-09 exists to prevent. Fixed: this panel calls
  ONLY `reconcileMirrorMode`; it is the sole owner of persisting `mirrorToStockIlf`.
- **R8 (MEDIUM, Opus):** `reconcileMirrorMode` now returns `{ failures: [...] }` (Plan 06 ROUND 3) instead of
  `void`. The onChange handler consumes the RETURN VALUE (surfacing any per-building failures via `log()`) —
  the dead try/catch this plan originally wrapped a "never throws" function in is replaced with a real
  consumption of the structured result (the try/catch may still exist as defense-in-depth around an unexpected
  throw, but it is no longer the PRIMARY failure-reporting path).
- **R5 (HIGH, Sonnet):** the detail card's "Last persist" field now renders D-13's full readout — before/after
  transform + cell/row — from the matching history entry's new fields (Plan 04 ROUND 3), not just an outcome
  word.
- **R11a (MEDIUM, Sonnet):** the detail card's inert "Go to"/"Revert"/"Edit in game" stub buttons now show an
  explicit, HONEST "not yet wired — coming in a later phase" message on click (or equivalent wording), never
  the sketch mock's literal action-implying strings ("Reverting row 3 to stock transform…", "Row pinned to
  overlay gizmo") — those imply the action actually happened, which would be misleading for a stub.
- **MED-7 (Opus):** row selection now uses Plan 04's `worldEditorBuildingRowId`/`parseWorldEditorRowId`
  (ROUND 3) instead of ad-hoc string construction/parsing.
- **MED-11 (Opus):** `resolveScanRoot` is now called BY NAME, explicitly, from this panel's refresh flow (its
  revised signature per Plan 04 ROUND 3 takes an already-resolved `{ cfgPath, clientPath }` pair, which this
  panel builds from its own `readWorkspaceJson` call).

**CROSS-AI REVIEW REVISION (2026-08-01, C12 — MEDIUM, Cursor/Sonnet):** the original plan's Task 2 defined
`hasFailureBadge`/`acknowledgeFailures()` (Plan 04) as store-side logic but never actually RENDERED the badge
anywhere in the World tab, and never CALLED `acknowledgeFailures()` when the tab is opened — D-12's "failure
punt = badge + detail waiting" contract was half-delivered (the "waiting" half worked, the "badge" half did
not). Task 2 below adds both, reusing the `props.api.setTitle(...)` modified-dot idiom already established in
this repo (`DatatableGridEditor.tsx`/`StfStringsEditor.tsx`/`SidebarPanel.tsx`) and the per-panel
`props.api.onDidActiveChange`/`props.api.isActive` dockview API (verified present in this repo's
`dockview-core` version this session) for the activation hook.
Purpose: close the largest chunk of SC2 (019-A element-for-element parity) with the panel's data-bearing core
before the smaller accordion/footer additions land on top, AND make D-12's attention badge actually visible
(C12).
Output: `World` tab exists, shows the disk-scanned building tree with live-session overlay, mirror toggle
functions end-to-end, selection shows a detail card, the tab title reflects a failure badge and clears it on
activation — verified by a component test enumerating each 019-A element present in this plan's scope.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/phases/05.1-live-world-editor-productization/05.1-RESEARCH.md
@.planning/phases/05.1-live-world-editor-productization/05.1-PATTERNS.md
@.planning/phases/05.1-live-world-editor-productization/05.1-04-SUMMARY.md
@.planning/phases/05.1-live-world-editor-productization/05.1-06-SUMMARY.md
@.planning/sketches/019-world-editor-panel/README.md
@.planning/phases/05.1-live-world-editor-productization/05.1-REVIEWS.md
</context>

<interfaces>
From packages/renderer/src/workspace/WorkspaceShell.tsx (the 4-place registration contract, current shape —
follow verbatim):
```typescript
const panelComponents: Record<string, React.FunctionComponent<IDockviewPanelProps<any>>> = { /* ...existing..., deploy: DeployPanel */ };
const STATIC_PANEL_IDS = ['sidebar', 'viewport', 'inspector', 'data', 'live-inspector', 'deploy', 'vcs', 'console', 'log'] as const;
const PANEL_TITLES: Record<string, string> = { /* ...existing..., deploy: 'Deploy' */ };
const PANEL_REOPEN_POSITIONS: Record<string, { direction: string; referencePanel?: string }> = { /* ...existing..., deploy: { direction: 'within', referencePanel: 'inspector' } */ };
```
From packages/renderer/src/workspace/workspace-config.ts (bump + addPanel pattern, current LAYOUT_VERSION=4):
```typescript
export const LAYOUT_VERSION = 4 as const; // bump to 5 for 'world'
api.addPanel({ id: 'deploy', component: 'deploy', title: 'Deploy', position: { direction: 'within', referencePanel: 'inspector' }, initialWidth: 440 });
```
From packages/renderer/src/panels/editors/DatatableGridEditor.tsx (verified this session — the dockview tab
modified-dot idiom to reuse verbatim for the failure badge, C12):
```typescript
// Dockview tab modified-dot (05-08): mirrors SidebarPanel.tsx's api.setTitle precedent.
api?.setTitle(`${fileName} — Datatable${anyRowModified ? ' ●' : ''}`);
```
From node_modules/dockview-core's panelApi (verified this session — the per-panel activation hook, C12):
```typescript
readonly isActive: boolean;
readonly onDidActiveChange: Event<{ isActive: boolean }>;
```
From packages/renderer/src/state/worldEditorStore.ts (Plan 04 output, reuse verbatim):
```typescript
export const useWorldEditorStore: /* tree, selectedRowId, sessionOverlay, history, hasFailureBadge, acknowledgeFailures, refresh, select, ... */;
export function worldEditorRowId(buildingId: string, cellName: string, rowIndex: number): string;
```
From packages/renderer/src/services/worldEditorScan.ts (Plan 04 ROUND 3 output, WorldEditorBuilding shape +
resolveScanRoot):
```typescript
export interface WorldEditorBuilding { buildingId: string; displayLabel: string; editedIlfPath: string; derivedTemplatePath: string; buildingTemplateVfsPath: string; decorations: { cellName: string; rowIndex: number; objectTemplateName: string; transform: number[] }[]; }
export function resolveScanRoot(clientExe: string | null, offlineBinding: { cfgPath?: string; clientPath: string | null } | null): string | null;
export function scanWorldEditorState(overrideDir: string, buildingTemplates?: Record<string, string>): WorldEditorBuilding[];
```
From packages/renderer/src/services/decorationPersistOrchestrator.ts (Plan 06 ROUND 3 output —
reconcileMirrorMode now returns a failure list, and makeReadVfs is now exported; reuse both for the toggle's
onChange and for resolving `readVfs`):
```typescript
export function reconcileMirrorMode(studioDir: string, overrideDir: string, readVfs: (vfsPath: string) => Buffer, nextValue: boolean): { failures: { buildingId: string; error: string }[] };
export function makeReadVfs(overrideDir: string): (vfsPath: string) => Buffer;
```
From packages/renderer/src/state/worldEditorStore.ts (Plan 04 ROUND 3 output — the shared row-id contract,
MED-7):
```typescript
export function worldEditorBuildingRowId(buildingId: string): string;
export function parseWorldEditorRowId(id: string): { kind: 'building'; buildingId: string } | { kind: 'decoration'; buildingId: string; cellName: string; rowIndex: number };
```
From packages/renderer/src/shell/StatusBar.tsx (the live-store subscription idiom to mirror for the live
strip, lines 35-84):
```typescript
import { useLiveStore } from '../state/liveStore';
const liveStatus = useLiveStore((s) => s.status);
```
From packages/renderer/src/services/projectBinding.ts (existing — WorkspaceBindingMeta.clientPath, for the
D-07b mismatch hint):
```typescript
export function readWorkspaceJson(studioDir: string): WorkspaceBindingMeta; // .clientPath: string | null
```
</interfaces>

<tasks>

<task type="auto">
  <name>Task 1: Register the World panel (5-place dockview contract)</name>
  <files>packages/renderer/src/workspace/WorkspaceShell.tsx, packages/renderer/src/workspace/workspace-config.ts</files>
  <read_first>
    packages/renderer/src/workspace/WorkspaceShell.tsx (lines 55-154, the full registration block — import,
    panelComponents, STATIC_PANEL_IDS, PANEL_TITLES, PANEL_REOPEN_POSITIONS — this is the EXACT contract every
    field must be added to, per the file's own Pitfall 5 docstring warning)
    packages/renderer/src/workspace/workspace-config.ts (full file — LAYOUT_VERSION history comment convention
    at lines 37-42, buildInitialLayout's deploy/vcs addPanel calls at lines 129-141)
  </read_first>
  <action>
    In WorkspaceShell.tsx: import a placeholder `WorldPanel` (created fully in Task 2) from
    '../panels/world/WorldPanel'; add `world: WorldPanel` to `panelComponents`; add `'world'` to
    `STATIC_PANEL_IDS`; add `world: 'World'` to `PANEL_TITLES`; add `world: { direction: 'within',
    referencePanel: 'inspector' }` to `PANEL_REOPEN_POSITIONS` (docks alongside Inspect/Deploy/VCS, matching
    019-A's "Inspect | Deploy | World" tabstrip). In workspace-config.ts: bump `LAYOUT_VERSION` from 4 to 5,
    adding a doc-comment line in the same style as the existing history ("Bumped from 4 → 5 (05.1-10): added
    the 'world' panel — Live World Editor productization."); add an `api.addPanel({ id: 'world', component:
    'world', title: 'World', position: { direction: 'within', referencePanel: 'inspector' } })` call in
    `buildInitialLayout` immediately after the existing `vcs` addPanel call.
  </action>
  <verify>
    <automated>npm -w @swg/renderer run test -- WorkspaceShell workspace-config</automated>
  </verify>
  <acceptance_criteria>
    `grep -n "world:" packages/renderer/src/workspace/WorkspaceShell.tsx` shows all four registrations;
    `grep -n "LAYOUT_VERSION     = 5" packages/renderer/src/workspace/workspace-config.ts` matches; existing
    WorkspaceShell/workspace-config tests remain green (no regression to the version-guard/reopen-menu logic).
  </acceptance_criteria>
  <done>The World panel id is fully registered across all five required places; a returning user's saved
  layout is discarded and rebuilt with the World tab present (LAYOUT_VERSION guard).</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: WorldPanel.tsx — tree, mirror toggle, live strip, detail card, failure badge (019-A core, C12, D-07b)</name>
  <files>packages/renderer/src/panels/world/WorldPanel.tsx, packages/renderer/src/panels/world/WorldPanel.test.tsx</files>
  <read_first>
    .planning/sketches/019-world-editor-panel/index.html (lines 206-314, Variant A's full DOM — the tabstrip,
    live-strip, mirror-row with switch+hint+badge, "Edited buildings" collapsible section with count chip,
    building rows with icon/name/sub/badge, nested indented decoration rows, and the detail card's kv pairs +
    action buttons — match this structure and wording, not just its intent)
    packages/renderer/src/state/worldEditorStore.ts (Plan 04 — tree/selection/refresh/sessionOverlay/
    hasFailureBadge/acknowledgeFailures)
    packages/renderer/src/services/worldEditorScan.ts (Plan 04 — WorldEditorBuilding shape)
    packages/renderer/src/services/decorationPersistOrchestrator.ts (Plan 06 — reconcileMirrorMode)
    packages/renderer/src/services/projectBinding.ts (readWorkspaceJson/updateWorkspaceMeta — for the toggle's
    persisted state, reading the current mirrorToStockIlf value on mount, and reading clientPath for the D-07b
    mismatch hint)
    packages/renderer/src/shell/StatusBar.tsx (lines 35-84, the useLiveStore direct-subscription idiom for
    the live-session strip — dot/exe/pid/scene chip)
    packages/renderer/src/panels/editors/DatatableGridEditor.tsx (lines 294-298, the `props.api.setTitle`
    modified-dot idiom — the direct precedent for C12's failure-badge tab title)
  </read_first>
  <behavior>
    - On mount (and on a manual refresh trigger), calls `scanWorldEditorState`-backed `refresh(overrideDir,
      meta.worldEditorBuildingTemplates)` from worldEditorStore against the resolved override dir
      (project-bound offline per D-07b, or the attached client's dir when `useLiveStore((s) => s.status).kind
      === 'attached'`). **(ROUND 3, R3 seam)** `refresh`'s SECOND argument (Plan 04's widened signature) is
      ALWAYS passed as `meta.worldEditorBuildingTemplates` (the current project's `readWorkspaceJson` result,
      already read here for the mirror toggle) — omitting it would silently make every building's
      `buildingTemplateVfsPath` empty in the rendered tree, defeating R3's detail-card/Remove groundwork.
    - Live-session strip: a dot + `{exe} · pid {pid}` + a scene chip when attached; an idle/disconnected
      variant otherwise — subscribing to `useLiveStore` directly (no prop drilling), matching StatusBar.tsx's
      pattern. **(D-07b)** when attached, if the attached client's exe path does NOT match (as a
      case-insensitive prefix, same comparison `resolveRunningClientOverrideDir` already uses) the project's
      bound `WorkspaceBindingMeta.clientPath`, the strip shows a visible hint (e.g. a small warning glyph +
      "attached client differs from this project's bound client" text) — the attached client still wins for
      scanning purposes (per D-07b's own rule), this is purely an informational hint, never a blocking gate.
    - **(ROUND 3, R4/R6)** Mirror-mode toggle row: a switch reflecting the current project's `mirrorToStockIlf`
      (default true when absent); toggling it resolves `overrideDir` via `resolveScanRoot(attachedExe ?? null,
      { cfgPath: meta.cfgPath, clientPath: meta.clientPath })` (the SAME resolution the refresh effect below
      already performs — reuse it, do not compute overrideDir twice with two different code paths) and builds
      `readVfs` via `makeReadVfs(overrideDir)`, then calls `reconcileMirrorMode(studioDir, overrideDir, readVfs,
      nextValue)` — this is the ONLY place `mirrorToStockIlf` gets persisted (`reconcileMirrorMode` itself calls
      `updateWorkspaceMeta` internally, per Plan 06); this panel's onChange handler does NOT ALSO call
      `updateWorkspaceMeta` directly (R6 — single owner, closing the two-writers-two-moments risk D-09 exists to
      prevent). The handler consumes `reconcileMirrorMode`'s RETURNED `{ failures }` (R8) and, when non-empty,
      surfaces a `log('warn', 'log', ...)` line naming which buildings failed to reconcile (never silently
      swallowed); a hint line reads "per-template: all buildings with this layout show the edit" when ON; a
      `PER-TEMPLATE` badge is shown (matching 019-A).
    - D-08 (LOCKED, not discretionary): the scope control shows BOTH modes side by side — "Per-template (all
      instances of this layout)" as the ACTIVE, clickable option (the switch above controls this one), and
      "Per-instance (server repoint)" as a VISIBLE but DISABLED option (greyed/aria-disabled) carrying a
      "coming later" hint (e.g. a small caption or tooltip reading "server-side per-instance repoint — coming
      later"). D-08's own text is explicit that the disabled option is itself the explanation for why
      per-template mode changes every instance of a layout — omitting the control entirely (as an earlier
      draft of this plan incorrectly did, mislabeling it "Claude's discretion to omit") is NOT an option; only
      the per-instance server-side REPOINT MECHANISM is out of scope (Deferred Ideas), not its disabled UI
      affordance. NOTE for the maintainer: sketch 019-A's index.html does not currently render this disabled
      option either — that is a sketch-vs-decision gap this plan resolves in the DECISION's favor (D-08's
      literal text), per AGENTS.md's rule that decisions and sketches are both source-of-truth and any
      discovered conflict must be surfaced, not silently resolved either way.
    - "Edited buildings" collapsible section header shows a live count chip (`tree.length`).
    - Each building row: an icon, `displayLabel`, a subtext of `derivedTemplatePath`'s basename + `· node
      {buildingId}`, and a status badge derived from that building's decorations' sessionOverlay state (e.g.
      "N SAVED" when all clean, "N UNAPPLIED" when the disk tree has rows the CURRENT session hasn't
      confirmed — Claude's discretion on the exact badge-derivation rule; document it in the component).
    - Each decoration row nests under its building (indented), showing `objectTemplateName`'s basename +
      `{cellName} · row {rowIndex}` and a SAVED/ARMED/FAILED badge from sessionOverlay, keyed by
      `worldEditorRowId(buildingId, cellName, rowIndex)` — NEVER a bare rowIndex (Pitfall 3 guard, carried
      through from Plan 04).
    - **(ROUND 3, MED-7)** Selecting a row (building or decoration) calls `select(rowId)` where `rowId` is built
      via `worldEditorBuildingRowId(buildingId)` for a building row or `worldEditorRowId(buildingId, cellName,
      rowIndex)` for a decoration row (Plan 04's shared helpers — never an ad-hoc string). Rendering the detail
      card reads `parseWorldEditorRowId(selectedRowId)` to discriminate which kind is selected, rather than a
      local colon-split. The detail card below the tree shows: Decoration (objectTemplateName), Cell / row,
      Position (from `transform`'s translation columns, formatted to 2 decimals), Last persist (from the most
      recent matching history entry, or "not yet persisted this session" when none), Files (editedIlfPath +
      derivedTemplatePath basenames + "mirror" when a stock-path mirror exists for that building).
      **(ROUND 3, R5 — D-13)** When a matching history entry carries `beforeTransform`/`afterTransform`/
      `cellName`/`rowIndex` (Plan 04 ROUND 3's widened `PersistHistoryEntry`), the "Last persist" field renders
      the FULL D-13 readout — both transforms' translation columns (e.g. "before (12.3, 0.0, −4.1) → after
      (12.9, 0.0, −3.6)") plus the cell/row — not merely the outcome word; when the matching entry lacks that
      data (an older/incomplete entry, or none exists yet), fall back to the outcome-word-only rendering, never
      throw. **(ROUND 3, R11a)** Detail-card action buttons ("Go to", "Revert", "Edit in game") render as
      present per 019-A but are INERT/stubbed in this plan; clicking any of them shows an explicit, HONEST
      message — e.g. "Go to: not yet wired — coming in a later phase" — via the existing `log()`/toast surface,
      NEVER the sketch mock's literal action-implying copy ("Reverting row 3 to stock transform…", "Row pinned
      to overlay gizmo"), which would misleadingly imply the click actually did something (Go to/Edit in game
      require a live session and are not this plan's scope; Revert requires a data mutation this plan does not
      implement) — the ELEMENTS must be present and visually correct per SC2's sketch-parity requirement even if
      their full behavior lands later; do not silently omit them, and do not borrow the sketch's success-implying
      copy for a button that does nothing.
    - **(C12) Failure badge:** a `useEffect` reacting to `useWorldEditorStore((s) => s.hasFailureBadge)` calls
      `props.api?.setTitle('World' + (hasFailureBadge ? ' ●' : ''))` (the SAME modified-dot idiom
      `DatatableGridEditor.tsx`/`StfStringsEditor.tsx` already establish for this repo's dockview tabs) —
      wrapped in a try/catch (`api unavailable in some test envs`, matching `SidebarPanel.tsx`'s own
      precedent). A SEPARATE `useEffect` subscribes to `props.api.onDidActiveChange` (per-panel dockview
      event) and calls `useWorldEditorStore.getState().acknowledgeFailures()` whenever `props.api.isActive`
      becomes true (mirrors D-12's "never steal focus... the badge is passive until the user looks" contract
      — acknowledging on ACTIVATION, not on mount, so a background-mounted-but-inactive World tab does not
      silently clear a badge the user never saw).
  </behavior>
  <action>
    Create WorldPanel.tsx as a dockview panel component (`React.FunctionComponent<IDockviewPanelProps<any>>`,
    matching every other panel's shape, e.g. DeployPanel). Read `useWorldEditorStore` selectors for tree/
    selection/sessionOverlay/history/hasFailureBadge; read `useLiveStore` for the live strip; call `refresh(overrideDir,
    meta.worldEditorBuildingTemplates)` on mount via a `useEffect`, resolving the scan root by explicitly
    calling `resolveScanRoot(liveStatus.kind === 'attached' ? liveStatus.clientLabel ?? null : null, { cfgPath:
    meta.cfgPath, clientPath: meta.clientPath })` (ROUND 3, MED-11 — named explicitly, not merely described)
    where `meta` is the current project's `readWorkspaceJson(studioDir)` result (also read here for the mirror
    toggle's initial value) — its `worldEditorBuildingTemplates` field is threaded straight into `refresh`'s
    second argument (ROUND 3, R3 seam).
    Implement the mirror toggle's onChange to resolve the SAME `overrideDir` (via `resolveScanRoot`) and a
    `readVfs` (via `makeReadVfs(overrideDir)`, Plan 06 ROUND 3's now-exported factory), then call ONLY
    `reconcileMirrorMode(studioDir, overrideDir, readVfs, nextValue)` (ROUND 3, R4/R6 — do NOT also call
    `updateWorkspaceMeta` from this panel; `reconcileMirrorMode` is the sole persistence owner), consuming its
    returned `{ failures }` (ROUND 3, R8) to surface any per-building failures via the existing `log()` service
    — wrapped in a try/catch as defense-in-depth (do not let a reconcile failure crash the panel), but the
    PRIMARY failure signal is the return value, not the catch. Render the disabled
    "Per-instance (server repoint)" option (a disabled radio/button/label, per D-08 — visible, non-interactive,
    with its "coming later" hint text) ALONGSIDE the active Per-template switch, per the behavior spec above.
    Render the D-07b mismatch hint in the live-session strip per the behavior spec. Render the tree/detail-card
    structure per the behavior spec, matching 019-A's element set enumerated in this plan's frontmatter
    `sketch_elements`, using `worldEditorBuildingRowId`/`parseWorldEditorRowId`/`worldEditorRowId` for all row
    selection (ROUND 3, MED-7). Render the detail card's inert stub buttons with the honest "not yet wired"
    copy per R11a above. Add the two `useEffect`s for the C12 failure-badge tab title + activation-triggered
    `acknowledgeFailures()`. Write WorldPanel.test.tsx (React Testing Library, matching this repo's existing
    panel-test idiom — check DeployPanel.test.tsx or similar for the render/store-seeding pattern) asserting:
    the tabstrip renders 'World'; a seeded worldEditorStore.tree of 2 buildings (one with 2 decorations, one
    with 1) renders both building rows + all 3 decoration rows nested correctly; selecting a decoration row
    shows the detail card with its Decoration/Cell·row/Position/Files fields; toggling the mirror switch calls
    reconcileMirrorMode with the flipped value AND a real `overrideDir`/`readVfs` pair (asserted via a spy on
    `makeReadVfs`/`resolveScanRoot` being called, not just on `reconcileMirrorMode` itself — ROUND 3/R4) and
    does NOT call `updateWorkspaceMeta` directly from this component (ROUND 3/R6, asserted via a spy showing
    zero direct calls); a mocked `reconcileMirrorMode` returning a non-empty `failures` array results in a
    `log('warn', ...)` call naming the failing building(s) (ROUND 3/R8); clicking a detail-card stub button
    ("Go to"/"Revert"/"Edit in game") shows the honest "not yet wired" message, never the sketch's literal
    action-implying toast text (ROUND 3/R11a); a history entry carrying before/after transforms + cell/row
    renders the full D-13 readout in the detail card, and an entry lacking that data falls back to the
    outcome-word-only rendering without throwing (ROUND 3/R5); the "Per-instance (server repoint)" option is
    present in the DOM, carries a disabled attribute/aria-disabled, and its "coming later" hint text is
    queryable; with `hasFailureBadge: true` seeded, a mocked `props.api.setTitle` is called with a string
    containing '●' (C12); simulating `props.api.onDidActiveChange`'s callback firing with `isActive: true`
    calls `acknowledgeFailures()` (spy/mock) exactly once (C12); with a seeded `useLiveStore` attached status
    whose clientLabel/exe path differs from a seeded `WorkspaceBindingMeta.clientPath`, the strip renders the
    D-07b mismatch hint text.
  </action>
  <verify>
    <automated>npm -w @swg/renderer run test -- WorldPanel</automated>
  </verify>
  <acceptance_criteria>
    Component test asserts, by exact text/role query, the presence of: the live-session strip, the mirror
    toggle row with its hint text, the "Edited buildings" section with a count chip matching the seeded
    fixture's building count, every seeded building AND decoration row (by name), and the detail card's five
    kv fields on selection. This is the observed/missing diff SC2 requires, encoded as an automated test
    rather than left to manual inspection alone. D-08 assertion: the "Per-instance (server repoint)" option is
    present and disabled (query returns a disabled control, clicking it produces no reconcileMirrorMode call),
    with its "coming later" hint text present. R4/R6/R8 assertion: the mirror toggle's onChange resolves a real
    `overrideDir`/`readVfs` and calls ONLY `reconcileMirrorMode` (never a direct `updateWorkspaceMeta`), and
    consumes its `{ failures }` return value. R5 assertion: the detail card renders D-13's full before/after +
    cell/row readout when the matching history entry carries it. R11a assertion: stub button clicks produce
    only the honest "not yet wired" text, never the sketch's success-implying copy. C12 assertion: `setTitle` is called with the modified-dot
    suffix when `hasFailureBadge` is true, and `acknowledgeFailures()` fires on panel activation, not on mount
    alone. D-07b assertion: an attached/bound client-path mismatch renders the visible hint text.
  </acceptance_criteria>
  <done>The World tab renders 019-A's tree/mirror-toggle/live-strip/detail-card spine, matching the sketch
  element-for-element for this plan's scope, proven by a component test enumerating each element. D-12's
  attention badge is REAL (tab title + activation-triggered acknowledge, C12 closed). D-07b's binding-mismatch
  hint is present. ROUND 3: the mirror toggle actually resolves and uses a real overrideDir/readVfs (R4),
  has exactly one persistence owner (R6), and surfaces reconcileMirrorMode's real per-building failure list
  (R8); the detail card renders D-13's full before/after-transform + cell/row readout (R5) and its inert stub
  buttons show honest, non-misleading copy (R11a); row selection uses one shared id contract (MED-7).</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| renderer UI → decorationPersistOrchestrator (reconcileMirrorMode) | The mirror toggle's onChange triggers a disk-writing reconcile pass across potentially many buildings, from a single UI click. |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-05.1-10a | Denial of Service | reconcileMirrorMode failure crashing the panel | mitigate | The onChange handler wraps the call in try/catch and routes any failure through the existing `log()` service (behavior spec) — a partial or failed reconcile never crashes the World tab; Plan 06's reconcileMirrorMode itself already fails closed per-building. |
| T-05.1-10b | Tampering | none material | accept | No new user-supplied path/string construction is introduced by this plan's rendering/selection logic — all writes route through Plan 06's already-hardened reconcileMirrorMode. |
| T-05.1-10c | Denial of Service | `props.api.setTitle`/`onDidActiveChange` unavailable in a test/degraded environment | mitigate | Both calls are wrapped in try/catch (matching `SidebarPanel.tsx`'s own precedent) so a missing dockview API surface never crashes the panel render. |
</threat_model>

<verification>
`npm -w @swg/renderer run test -- WorkspaceShell workspace-config WorldPanel` green; `tsc --noEmit` clean for
packages/renderer.
</verification>

<success_criteria>
The World tab exists, is reachable via the Inspect|Deploy|World tabstrip, and renders the 019-A tree/mirror-
toggle/live-strip/detail-card spine element-for-element against real scanned data — closing the largest chunk
of SC2/SC3. D-12's attention badge has a real UI renderer (tab title + activation-triggered acknowledge, C12).
D-07b's binding-mismatch hint is visible in the live-session strip.
</success_criteria>

<output>
Create `.planning/phases/05.1-live-world-editor-productization/05.1-10-SUMMARY.md` when done
</output>

==================== .planning/phases/05.1-live-world-editor-productization/05.1-11-PLAN.md ====================
---
phase: 05.1-live-world-editor-productization
plan: 11
type: execute
wave: 3
depends_on: ["05.1-10", "05.1-08", "05.1-02"]
files_modified:
  - packages/renderer/src/panels/world/WorldPanel.tsx
  - packages/renderer/src/panels/world/WorldPanel.test.tsx
autonomous: false
requirements: [pivot-driven]
must_haves:
  truths:
    - "The Scene accordion's editor-scene launcher satisfies the owed provider-§4 canonical visible-verify pass by issuing game::loadScene from the World panel, not just from the in-game overlay (D-07)"
    - "Persist history (D-06, session-only) is visible in the Activity accordion, with human-readable outcomes only — never a raw result code (SC1)"
    - "An Activity entry whose message carries D-10's full mirror-off detail renders that detail IN FULL, untruncated — the App-side half of D-10's hybrid-session warning (D-10)"
    - "At least one real-Electron exercise of the FULL renderer→addon→agent seam (openChannel/readChannelView/writeHostCommand/parseHostCommandResult) happens in THIS wave, before Waves 4-5 build further on it — closing the project's documented jsdom-green-≠-Electron-runs blind spot for the HOST_CMD mechanism specifically (REVIEWS.md C11)"
  artifacts:
    - path: "packages/renderer/src/panels/world/WorldPanel.tsx"
      provides: "Activity + Scene accordions, teleport bookmarks, footer (+ Add decoration / Stage to project)"
      contains: "Editor scene"
  key_links:
    - from: "packages/renderer/src/panels/world/WorldPanel.tsx"
      to: "packages/renderer/src/services/hostCommand.ts"
      via: "Scene accordion buttons calling sendReloadCurrentScene / sendLoadEditorScene / sendTeleport"
      pattern: "sendLoadEditorScene\\("
sketch_elements:
  # ROUND 3 (2026-08-01, REVIEWS.md R9 — MEDIUM, Fable): this block was dropped from the plan's frontmatter
  # during the round-2 replan without being relocated, violating AGENTS.md's "sketches are the UI contract"
  # plan rule (every plan touching a governed sketch surface must enumerate its distinct elements as
  # must_haves/sketch_elements). Restored here, covering ONLY the 019-A elements THIS plan builds (Plan 10
  # already enumerates the tree/mirror-toggle/live-strip/detail-card spine in its own frontmatter).
  - "Activity accordion (collapsed by default, count chip = history.length, timestamped ok/err/warn status lines rendered as words only, never a raw code — D-06/SC1)"
  - "Activity accordion renders an entry's message IN FULL, untruncated, so D-10's mirror-off full-detail sentence is never clipped (App-side half of D-10)"
  - "Scene accordion (collapsed by default, 'editor' count chip): 'Editor scene ▸ {terrain}' launcher button, 'Reload scene' button, teleport-bookmark rows (glyph + name + coords) — all disabled with a 'no live session' hint when offline (D-07)"
  - "footer: primary '+ Add decoration…' button (stub in this plan, wired by Plan 14) and 'Stage to project' button (stub or trivial re-stage in this plan, per its own behavior spec)"
---

<objective>
Complete sketch 019-A by adding the two remaining collapsed-by-default accordions (Activity, Scene) and the
panel footer. The Activity accordion renders `worldEditorStore`'s session-only persist history (D-06) as
timestamped status lines. The Scene accordion wires THREE tools per D-07: an editor-scene launcher
(`sendLoadEditorScene`, satisfying the owed provider-§4 canonical visible-verify pass — this is the FIRST
time `game::loadScene` is triggerable from the app rather than only the in-game overlay), a "Reload current
scene" button (`sendReloadCurrentScene`), and a teleport-bookmarks list (`sendTeleport` per bookmark, backed
by `WorkspaceBindingMeta.worldEditorBookmarks`, Plan 02). The footer adds the "+ Add decoration…" primary
button (a stub in this plan — Plan 14 wires it to the actual wizard modal) and "Stage to project".

**ROUND 3 REVISIONS (2026-08-01, REVIEWS.md R9/R11a):**
- **R9 (MEDIUM, Fable):** this plan's `sketch_elements` frontmatter block, present in an earlier draft, was
  silently dropped by the round-2 replan without being relocated — a violation of AGENTS.md's own "sketches are
  the UI contract" plan rule (Activity/Scene accordion + footer elements vanished from the sketch-parity
  contract). Restored above.
- **R11a (MEDIUM, Sonnet):** if the footer's "Stage to project" button remains a stub in this plan (per its
  own behavior spec's stated discretion), it MUST show an explicit, honest "not yet wired" message on click —
  never the sketch mock's literal success-implying toast text ("2 files staged to project", which asserts a
  concrete, false result). Task 2's behavior/action below is revised accordingly.

**CROSS-AI REVIEW REVISION (2026-08-01, C11 — MEDIUM, Fable, reinforced by project memory
`reference-rebuild-native-verify-mtime-and-electron`):** every automated test touching the HOST_CMD channel
across Plans 07-14 runs either as a plain Node script (Plan 07/09's checkpoints) or jsdom (Plans 10/11/13/14) —
this project has a documented history of native-addon bugs that are legal in Node but crash/misbehave only
inside the real Electron sandboxed renderer. The FIRST real-Electron exercise of the WHOLE
renderer→addon→agent HOST_CMD seam was, in the original plan set, deferred all the way to Plan 15's phase
sign-off — meaning three more waves (4, 5) would build further UI on an unverified foundation. Task 3 below
adds one cheap, targeted human-verify checkpoint in THIS wave: click "Reload scene" from the World panel in
the REAL packaged/dev app with a live client attached, proving openChannel/readChannelView/writeHostCommand/
parseHostCommandResult actually work under Electron before Plan 12 (placement) and Plan 13 (remove) build on
the same channel path.

Purpose: close the remaining 019-A element gap for SC2, give D-07's Scene tools their first real UI surface
(previously only reachable via manual ImGui text fields in-game), and close the C11 verification gap before
later waves compound on an unverified seam.
Output: WorldPanel.tsx gains the Activity/Scene accordions + footer, all covered by the existing component
test suite extended with the new elements; a human-verify checkpoint confirms the real-Electron HOST_CMD
round trip.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/phases/05.1-live-world-editor-productization/05.1-RESEARCH.md
@.planning/phases/05.1-live-world-editor-productization/05.1-PATTERNS.md
@.planning/phases/05.1-live-world-editor-productization/05.1-10-SUMMARY.md
@.planning/phases/05.1-live-world-editor-productization/05.1-08-SUMMARY.md
@.planning/phases/05.1-live-world-editor-productization/05.1-02-SUMMARY.md
@.planning/phases/05.1-live-world-editor-productization/05.1-04-SUMMARY.md
@.planning/sketches/019-world-editor-panel/README.md
@.planning/phases/05.1-live-world-editor-productization/05.1-REVIEWS.md
</context>

<interfaces>
From packages/renderer/src/services/hostCommand.ts (Plan 08 output, reuse verbatim):
```typescript
export function sendReloadCurrentScene(mappingName: string): void;
export function sendLoadEditorScene(mappingName: string, terrain: string, avatarTemplate: string): void;
export function sendTeleport(mappingName: string, x: number, y: number, z: number): void;
```
From packages/renderer/src/state/worldEditorStore.ts (Plan 04 output, PersistHistoryEntry shape):
```typescript
export interface PersistHistoryEntry { timestampISO: string; buildingLabel: string; decorationLabel: string; outcome: 'ok' | 'warn' | 'error'; message: string; beforeTransform?: number[]; afterTransform?: number[]; cellName?: string; rowIndex?: number; }
// (ROUND 3, R5 — optional fields populated by Plan 08's RESULT-time wiring; this plan's Activity accordion renders ONLY `message`.)
```
From packages/contracts/src/workspace.ts (Plan 02 output):
```typescript
export interface WorkspaceBindingMeta { /* ... */ worldEditorBookmarks?: { name: string; scene: string; x: number; y: number; z: number }[]; }
```
</interfaces>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Activity accordion — session persist history (D-06, SC1)</name>
  <files>packages/renderer/src/panels/world/WorldPanel.tsx, packages/renderer/src/panels/world/WorldPanel.test.tsx</files>
  <read_first>
    .planning/sketches/019-world-editor-panel/index.html (lines 285-292, Variant A's Activity accordion —
    collapsed by default, timestamped ok/err/warn status-line styling)
    packages/renderer/src/state/worldEditorStore.ts (Plan 04 — history: PersistHistoryEntry[])
  </read_first>
  <behavior>
    - A collapsed-by-default "Activity" section with a count chip (`history.length`), expanding to a
      timestamped list of `worldEditorStore.history` entries, most-recent first, each styled by `outcome`
      (ok/warn/error), rendering ONLY `message` (already human-readable per Plan 04's PersistHistoryEntry
      contract — this task never formats a raw code, it renders what the store already gives it).
    - D-10: an entry's `message` is rendered IN FULL — no truncation, no ellipsis, no max-length clamp — so
      when a caller has used Plan 04's `formatPersistMessage` to append the mirror-off suffix ("— mirror off
      — not visible on hybrid sessions until reload into an editor scene"), the FULL sentence is visible in
      the expanded accordion, not just the base "saved"/"failed" word. This is the App-side half of D-10's
      hybrid-session warning (the in-game half is Plan 05's short strip variant).
    - An empty history shows a neutral "no activity yet this session" line, not a blank collapsed section
      that looks broken when expanded.
  </behavior>
  <action>
    Add the Activity accordion section to WorldPanel.tsx, collapsed by default (matching the panel's existing
    accordion toggle idiom from Plan 10's "Edited buildings" section — reuse the SAME collapsible primitive,
    do not invent a second one), rendering `worldEditorStore.history` per the behavior spec. Extend
    WorldPanel.test.tsx with a case seeding 2-3 history entries (mixed outcomes) and asserting each renders
    with the correct outcome styling class/role and its message text, plus an empty-history case asserting
    the neutral placeholder line. Add a D-10-specific case: seed one history entry whose `message` is
    Plan 04's `formatPersistMessage('saved', false)` output (the full mirror-off sentence) and assert the
    RENDERED accordion body contains that entire string verbatim (not just a leading substring like "saved")
    — proves the panel never clips D-10's full detail.
  </action>
  <verify>
    <automated>npm -w @swg/renderer run test -- WorldPanel</automated>
  </verify>
  <acceptance_criteria>
    Test asserts every seeded history entry's message text is present in the rendered accordion body once
    expanded, styled per its outcome; the count chip matches history.length; the empty-history placeholder
    renders when history is []; the D-10 mirror-off entry's FULL message string (including the "— mirror off —
    not visible on hybrid sessions until reload into an editor scene" suffix) is found verbatim in the
    rendered output, not truncated.
  </acceptance_criteria>
  <done>Activity accordion renders session persist history as words, matching 019-A's Activity element.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Scene accordion (editor-scene launcher, reload, teleport bookmarks) + footer</name>
  <files>packages/renderer/src/panels/world/WorldPanel.tsx, packages/renderer/src/panels/world/WorldPanel.test.tsx</files>
  <read_first>
    .planning/sketches/019-world-editor-panel/index.html (lines 294-311, Variant A's Scene accordion —
    Editor scene launcher, Reload scene button, bookmark rows with a teleport icon + coords; and the footer's
    "+ Add decoration…" primary button + "Stage to project" button)
    packages/renderer/src/services/hostCommand.ts (Plan 08 — send* functions)
    packages/renderer/src/services/projectBinding.ts (readWorkspaceJson/updateWorkspaceMeta — for reading/
    persisting worldEditorBookmarks)
  </read_first>
  <behavior>
    - Collapsed-by-default "Scene" section: an "Editor scene ▸ {terrain}" button calling
      `sendLoadEditorScene(mappingName, terrain, avatarTemplate)` — terrain/avatar default to the SAME values
      the overlay's own manual fields default to (`terrain/tatooine.trn`, a human male shared template),
      editable inline (Claude's discretion on exact input affordance, matching 019-A's minimal chrome); a
      "Reload scene" button calling `sendReloadCurrentScene(mappingName)`; both DISABLED with a "no live
      session" hint when `useLiveStore((s) => s.status).kind !== 'attached'` (these are agent RPCs, meaningless
      offline).
    - A teleport-bookmarks list rendering `WorkspaceBindingMeta.worldEditorBookmarks` (read via
      readWorkspaceJson on mount, same as the mirror toggle already does in Plan 10), each row showing name +
      coords, clicking calls `sendTeleport(mappingName, x, y, z)` (also disabled offline). Adding/removing a
      bookmark is Claude's discretion for exact affordance (e.g. a "+ bookmark here" using the live player's
      CURRENT position if available, else a manual x/y/z entry) — persist any change via `updateWorkspaceMeta`
      immediately (same atomic per-project idiom as the mirror toggle).
    - Footer: a primary "+ Add decoration…" button — in THIS plan it is a STUB that logs/toasts "opens the
      template picker" (Plan 14 wires the real modal; per the scope-reduction-prohibition rule this stub is
      acceptable ONLY because 021-A's wizard is explicitly built as its own downstream plan per the phase's
      documented wave sequencing, not a silent scope cut — the button element itself, its label, and its
      position are final per the sketch, only its click target is deferred). A "Stage to project" button —
      also acceptable to stub in this plan (staging already happens automatically via
      decorationPersistOrchestrator.ts's stageDurable on every successful persist per the proven pipeline;
      this button's job, per 019-A, is a manual re-stage affordance for edge cases — wire it to re-run
      stageDurable over the currently-tracked staged entries if that plumbing is trivially reachable here, or
      leave it as an explicit documented stub otherwise; do not fabricate new staging logic in this task).
      **(ROUND 3, R11a)** If left as a stub, its click handler shows an explicit, HONEST "not yet wired" message
      (e.g. via the existing `log()`/toast surface) — NEVER the sketch mock's literal "2 files staged to
      project" text, which asserts a specific, false outcome count.
  </behavior>
  <action>
    Add the Scene accordion and footer to WorldPanel.tsx per the behavior spec, reusing the SAME collapsible
    primitive as Activity/Edited-buildings. Read bookmarks via readWorkspaceJson in the same effect that
    already loads the mirror-toggle value (Plan 10); persist bookmark changes via updateWorkspaceMeta. Gate
    the Scene buttons and bookmark rows on live-attached status per the behavior spec. Extend
    WorldPanel.test.tsx: assert the Editor-scene/Reload buttons are present and disabled when
    useLiveStore is idle, and call sendLoadEditorScene/sendReloadCurrentScene (spy/mock) when attached and
    clicked; seed a worldEditorBookmarks fixture and assert each bookmark row renders + calls sendTeleport
    with its coords on click; assert the footer's "+ Add decoration…" and "Stage to project" buttons are
    present; if "Stage to project" is a stub, assert clicking it shows the honest "not yet wired" text and
    NEVER a string matching /\d+ files? staged/i (ROUND 3, R11a — guards against silently reusing the sketch's
    success-implying mock copy).
  </action>
  <verify>
    <automated>npm -w @swg/renderer run test -- WorldPanel</automated>
  </verify>
  <acceptance_criteria>
    Test asserts Scene-accordion buttons are disabled offline and call the correct hostCommand.ts function
    with the correct arguments when attached; seeded bookmarks render and dispatch sendTeleport with their
    exact coords; footer buttons are present with the exact 019-A labels ("+ Add decoration…", "Stage to
    project").
  </acceptance_criteria>
  <done>019-A's Scene accordion and footer are complete; the editor-scene launcher is reachable from the app
  for the first time, satisfying D-07's owed §4 verify-pass groundwork (live human confirmation happens in
  the phase's final sign-off plan).</done>
</task>

<task type="checkpoint:human-verify" gate="blocking">
  <name>Task 3: Real-Electron HOST_CMD smoke checkpoint (REVIEWS.md C11)</name>
  <files>packages/renderer/src/panels/world/WorldPanel.tsx</files>
  <action>
    Pause for human verification. Tasks 1-2 wired the Scene accordion's "Reload scene" button through
    `hostCommand.ts` → `@swg/live-inject`'s `writeHostCommand` → the agent's HOST_CMD dispatch (Plan 09) → back
    through `parseHostCommandResult`. Every automated test of this seam so far has run in Node or jsdom — this
    checkpoint proves it also works inside the REAL packaged/dev Electron renderer, before Waves 4-5 (Plan 12
    placement, Plan 13 remove) build further on the same channel path.
  </action>
  <what-built>
    The World panel's "Reload scene" button is now the first UI control in this phase to exercise the FULL
    HOST_CMD round trip (openChannel/readChannelView already proven by Phase 3/5; writeHostCommand/
    channelReadHostCommand/channelWriteHostCommandResult/parseHostCommandResult are new to this phase and have
    only been exercised by Node scripts (Plan 07/09's checkpoints) or jsdom component tests (this plan's Tasks
    1-2) until now.
  </what-built>
  <how-to-verify>
    1. Run the real app (`npm start` or the packaged build) with a live SWG client attached (per the standing
       attach flow from Phase 3/5).
    2. Open the World panel, expand the Scene accordion.
    3. Click "Reload scene." Confirm the scene visibly reloads in the ATTACHED CLIENT (not a mocked/simulated
       result) — this proves `writeHostCommand` really wrote into the shared-memory mapping, the agent really
       read+acted on it, and `parseHostCommandResult` really read a real result back, all inside the actual
       Electron renderer process (not Node, not jsdom).
    4. Confirm no console errors/crashes in the DevTools console during this round trip.
  </how-to-verify>
  <resume-signal>Type "approved" once the real-Electron round trip is confirmed working, or describe what
  failed (a failure here is a real, high-value finding — do not let Waves 4-5 proceed on an unverified
  seam without recording it).</resume-signal>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| renderer UI → hostCommand.ts → agent | Scene/teleport buttons trigger live engine calls (scene swap, player teleport) in a running game client from a UI click. |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-05.1-11a | Tampering | teleport bookmark x/y/z free-text entry | mitigate | Values are parsed as numbers before being passed to sendTeleport (which writes them into a fixed 12-byte float slot, T-05.1-08a) — never used as path/command input; a non-numeric entry is rejected at the input layer (no NaN reaches the channel). |
| T-05.1-11b | Elevation of Privilege | Editor-scene launcher swaps the ENTIRE live session to an offline single-player scene (per overlay.cpp's own comment: "replaces any live session!") | mitigate | Buttons are gated behind an explicit human click, disabled when no session is attached, and this is a documented, sketch-locked, intentional D-07 feature (the canonical §4 visible-verify context) — not an accidental trigger; no confirm dialog added per the phase's "words not codes / never steal focus" minimalism, matching how the existing in-game manual button already behaves with no confirm either. |
</threat_model>

<verification>
`npm -w @swg/renderer run test -- WorldPanel` green; `tsc --noEmit` clean for packages/renderer; the blocking
checkpoint's real-Electron round trip confirmed.
</verification>

<success_criteria>
019-A is now element-complete (tree, mirror toggle, live strip, detail card, Activity, Scene, footer) — SC2's
sketch-parity requirement is closeable by the final observed/missing diff in Plan 15. The FULL HOST_CMD seam
(renderer→addon→agent→renderer) is proven working inside the real Electron app, not just Node/jsdom, before
Waves 4-5 build further on it (C11 closed).
</success_criteria>

<output>
Create `.planning/phases/05.1-live-world-editor-productization/05.1-11-SUMMARY.md` when done
</output>

==================== .planning/phases/05.1-live-world-editor-productization/05.1-12-PLAN.md ====================
---
phase: 05.1-live-world-editor-productization
plan: 12
type: execute
wave: 3
depends_on: ["05.1-09", "05.1-03", "05.1-05"]
files_modified:
  - packages/live-inject/agent/overlay.cpp
autonomous: false
requirements: [pivot-driven]
user_setup:
  - service: local-swg-client
    why: "Placement ghost/reticle mode can only be verified against a running, injected client"
    dashboard_config:
      - task: "Rebuild the agent DLL and re-inject/re-launch before verifying"
        location: "cmake --build packages/live-inject/agent/build-agent --config Release (node on PATH)"
must_haves:
  truths:
    - "Clicking 'Place in game' hands a placement ghost to the overlay; clicking the floor spawns the object live via wsAddObject and auto-arms it in the SAME gizmo state an existing decoration edit gets (D-01, SC4)"
    - "A successful ADD persist reconciles the temporary wsAddObject-minted preview node so it does not visibly duplicate on a subsequent scene reload"
    - "A placement click resolved to the WRONG building (not the one the World panel's picker resolved a cellName from) is refused with a words-only strip message, not silently spawned into the wrong container — reduces (does not eliminate) the C6 wrong-cell risk to a wrong-BUILDING guard, the finest-grained check available without the still-unshipped getContainingCellName shim (REVIEWS.md C6)"
    - "A second START_PLACEMENT while placement is already active is a no-op refusal, not a silent swap of the pending ghost/template (Sonnet F10)"
    - "g_capKind/g_capCellName are reset to EDIT/empty on every fresh EDIT-path arm (F hotkey), so a normal edit performed AFTER an ADD in the same session never inherits the prior ADD's kind and silently appends a duplicate .ilf row instead of editing (ROUND 3, R2 — HIGH, Opus)"
    - "A placement click resolving to building id 0 (the resolver's own 'could not resolve' sentinel, distinct from a genuine mismatch) fails OPEN — proceeds to spawn — matching the guard's stated 'fail-open on resolver absence' intent rather than refusing every click as a false wrong-building match (ROUND 3, R10)"
    - "A placement-mode spawn resolves and sets g_capBuildingTemplate (the STOCK building template's own filename) via the SAME getObjectByIdAdvertised+getTemplateFilename lookup armDecorationEdit already uses, so the ADD capture's buildingTemplateVfsPath is real, not stale/empty from whatever the agent last armed via EDIT (ROUND 3, R3 ripple — without this, assembleDecorationEdit's mandatory readVfs(edit.buildingTemplateVfsPath) call fails on a session's first-ever ADD)"
  artifacts:
    - path: "packages/live-inject/agent/overlay.cpp"
      provides: "START_PLACEMENT/CANCEL_PLACEMENT ghost/reticle mode + post-save despawn of the temp preview node on a kind=ADD rebind + building-id click guard"
      contains: "g_placementActive"
  key_links:
    - from: "packages/live-inject/agent/overlay.cpp (placement click handler)"
      to: "packages/live-inject/agent/overlay.cpp (armDecorationEdit tail)"
      via: "auto-arm reusing the SAME g_capArmed/g_latchedFocus/g_capFocus state an existing decoration edit sets"
      pattern: "g_capArmed\\s*=\\s*true"
sketch_elements:
  # 021-A Frame 2 (Place — game overlay), the in-game half this plan builds:
  - "ghost item rendered at the cursor's floor hit"
  - "reticle at the cursor"
  - "placement strip ('Placing: {template}', click/rotate/Esc hint, 'Place here' affordance)"
---

<objective>
Implement 021-A's Frame 2 — the in-game half of the spawn-decoration flow: the agent enters a "placement
mode" on receiving `START_PLACEMENT` (Plan 09's dispatch already routes this action to a no-op; this plan
gives it a real handler), rendering a ghost + reticle at the cursor's `collideScreenRay` floor hit, and on
click spawns the object live via the already-advertised `wsAddObject(template, transform12, containedById)`
(proven, unchanged) at the target cell/building, then AUTO-ARMS it using the SAME tail
`armDecorationEdit` already uses (`g_capArmed = true`, `g_latchedFocus`/`g_capFocus` set to the new object) —
per D-01's "one code path for add and edit" mandate, the user now nudges the newly-placed object with the
SAME gizmo + Persist flow an existing decoration edit already uses, with `kind='add'` and the placement's
`cellName` threaded into the CAPTURE region (Plan 03's contract) so the renderer's orchestrator (Plan 06)
assembles an appended row instead of an edited one. Per RESEARCH.md's own architecture-extension design
(session-verified against ground truth, not re-derived here), the temporary `wsAddObject`-minted preview node
is reconciled (despawned via `wsRemoveNode`, Plan 09's binding) AFTER a successful rebind+save — this keeps
the placed object visibly present for the REST of the current session (matching 021-A Frame 3, which shows
the object still rendered after "✓ placed + saved") while preventing a FUTURE scene reload from double-
spawning it (once from the `.ws`, once from the freshly-appended `.ilf` row).

**ROUND 3 REVISIONS (2026-08-01, REVIEWS.md R2/R10, + one seam ripple from R3):**
- **R2 (HIGH, Opus, source-confirmed):** `g_capKind`/`g_capCellName` (this plan's own new globals, Task 2) had
  no reset site anywhere in the file, and this plan explicitly avoids touching `armDecorationEdit`'s body (the
  F-hotkey arm path Plan 05 built). Left unfixed: after ANY successful ADD, the very next EDIT arm (hovering an
  EXISTING decoration and pressing F) would inherit the stale `g_capKind=1`/`g_capCellName` from the prior ADD,
  so its persist would silently APPEND a duplicate `.ilf` row instead of editing the hovered one — a real,
  session-breaking data-corruption class. Fixed below: Task 1 declares both globals with an EDIT-default
  initializer, and Task 2 adds a two-line reset at the F-triggered arm call site Plan 05 already built (a
  call-site edit, not a body edit to `armDecorationEdit` itself — consistent with this plan's own
  "do not modify armDecorationEdit" posture, and legal because Plan 12 runs in a LATER wave than Plan 05 on the
  SAME already-`files_modified`-declared file).
- **R10 (MEDIUM, Fable):** the C6 building-id guard (Task 2) originally left an ambiguous case: what happens
  when the resolved click building id is exactly `0`? The guard's own stated intent ("fail-open on resolver
  ABSENCE only, never on a resolved MISMATCH") did not say what a resolved `0` means. `0` is
  `getContainingBuildingId`'s own "could not resolve" sentinel (the SAME sentinel `armDecorationEdit` already
  treats as "no id", per its existing `if (bldgId == 0) return "no building id..."` branch) — NOT a genuine
  different-building mismatch. Task 2 is revised to fail OPEN or a resolved `0` (proceed to spawn), matching the
  guard's own stated intent, rather than refusing every click whose click-point resolver happens to return 0.
- **(R3 ripple, not independently numbered in REVIEWS.md but required for R3's fix to actually work end-to-end):**
  `armDecorationEdit`'s tail resolves `g_capBuildingTemplate` (the STOCK building template's own filename) via
  `getObjectByIdAdvertised(&bldgId)` + `getTemplateFilename(bldg)` — this plan's placement/click-to-spawn path
  (Task 2) never mentioned doing the SAME resolution for `g_placementBuildingId`, so an ADD capture's
  `cap.buildingTemplate` would carry whatever was left over from the last EDIT arm (or an empty string on a
  session's first-ever ADD with no prior edit) — and `assembleDecorationEdit`'s FIRST line
  (`deps.readVfs(edit.buildingTemplateVfsPath)`) throws immediately on an invalid path, breaking the entire ADD
  persist. Task 2 is revised to resolve `g_capBuildingTemplate` the SAME way `armDecorationEdit` does, using
  `g_placementBuildingId` in place of the hover-resolved id.

**CROSS-AI REVIEW REVISION (2026-08-01, C6 — HIGH, Codex facet "wrong cell"):** the World panel's ADD wizard
(Plan 14) resolves a `cellName` for the new row by BORROWING it from an existing decoration selected in the
tree — this cellName travels to the agent via `START_PLACEMENT`'s `str2` and is written verbatim into the new
`.ilf` row regardless of WHERE the user actually clicks the floor. Codex's finding: nothing stops the user
from selecting a decoration in `alcove1`, then walking to and clicking in a COMPLETELY DIFFERENT BUILDING,
silently appending an `.ilf` row tagged `alcove1` for an object that visually spawned somewhere else entirely.
This plan cannot fully close the underlying gap (a true per-CELL check needs the still-unshipped
`getContainingCellName` provider shim, filed in Plan 15) — but it CAN close the coarser, still-real
wrong-BUILDING case using the ALREADY-BOUND `getContainingBuildingId` resolver: Task 2 below cross-checks the
floor-click's resolved building id against `g_placementBuildingId` (the building the picker resolved the
borrowed cellName FROM) and REFUSES the click (no spawn) on a mismatch, with a words-only strip message. The
residual same-building-multi-cell risk (clicking a DIFFERENT ROOM within the SAME building) is NOT closable
without the provider shim — it is explicitly disclosed here and in Plan 14/15, not silently left implicit.
**(Sonnet F10)** Task 1 also adds re-entry guarding: a second `START_PLACEMENT` while placement mode is
already active is now a no-op refusal (matching the existing armed-edit exclusivity pattern), instead of
silently swapping the pending template/ghost out from under the user mid-placement.

**Open verification item (do not fabricate the answer — confirm live):** whether `wsSaveSnapshot()`'s ONE
save call (which runs BEFORE this despawn, per RESEARCH's stated ordering) bakes the still-live temp node
into the saved `.ws` bytes such that a SECOND reload cycle re-introduces the duplicate even after this
plan's despawn call runs, is not established by any source read this session — no swg-client-v2 source
excerpt describing `wsSaveSnapshot`'s node-selection scope was found. This plan's blocking checkpoint
explicitly tests TWO consecutive reload cycles (not one) to catch this if it exists; if a duplicate survives
the second reload, that is a real finding to hand back to the maintainer as a follow-up (an extra
`wsSaveSnapshot()` call after the despawn), not something to silently patch over with unverified C++.

Purpose: close the in-game half of SC4's ADD path, and reduce (not eliminate) the C6 wrong-cell risk to the
finest-grained check the currently-available advertised endpoints support.
Output: `overlay.cpp` gains placement-mode ghost rendering, click-to-spawn, auto-arm, a building-id click
guard, re-entry guarding, and a post-save cleanup step — manually smoke-verified live across two reload
cycles.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/phases/05.1-live-world-editor-productization/05.1-RESEARCH.md
@.planning/phases/05.1-live-world-editor-productization/05.1-PATTERNS.md
@.planning/phases/05.1-live-world-editor-productization/05.1-09-SUMMARY.md
@.planning/sketches/021-spawn-decoration-flow/README.md
@.planning/phases/05.1-live-world-editor-productization/05.1-REVIEWS.md
</context>

<interfaces>
From packages/live-inject/agent/overlay.cpp (REUSE unchanged — the exact tail an auto-arm must replicate;
locate by FUNCTION NAME, not line number, since Plan 05/09 (earlier waves) have already edited this file by
the time this plan runs):
```cpp
const char* armDecorationEdit() {
    // ... resolves bldgId via getContainingBuildingId, snapshots g_capOriginalO2p, decoration template ...
    g_latchedFocus = deco; g_capFocus = deco; g_capArmed = true;
    return nullptr;
}
```
Existing advertised, proven endpoint (reuse unchanged):
```cpp
typedef int64_t(__cdecl* pWsAddObject)(const char* tmpl, const float* transform12, int64_t containedById);
pWsAddObject wsAddObject = nullptr;  // engine_advertise.cpp:769
```
Existing advertised resolver (reuse unchanged — the C6 building-id guard's primitive; the SAME resolver
`armDecorationEdit` already calls):
```cpp
typedef int64_t(__cdecl* pGetContainingBuildingId)(void* obj);
pGetContainingBuildingId getContainingBuildingId = nullptr;  // v25 shim, already shipped
```
From packages/live-inject/agent/channel.h (Plan 03's HOST_CMD action codes, already defined):
```cpp
static constexpr uint32_t HOST_CMD_ACTION_START_PLACEMENT  = 4; // str1=decorationTemplate, str2=cellName, id=buildingId
static constexpr uint32_t HOST_CMD_ACTION_CANCEL_PLACEMENT = 5;
uint32_t captureKind;           // offset 1308 — DECO_CAPTURE_KIND_EDIT(0) / _ADD(1) / _ARM_FAILED(2)
char     captureCellName[128];  // offset 1312 — meaningful only when captureKind==ADD (or as a reason string when ARM_FAILED)
```
From packages/live-inject/agent/overlay.cpp (applyPendingRebind's existing RESULT_OK branch — where this
plan's post-save despawn step hooks in, per RESEARCH's own stated "after a successful rebind+save" design;
locate by the `DECO_RESULT_OK` comparison, not a line number):
```cpp
g_lastDecoResult = code;
g_lastDecoResultEpoch = rb.epoch;
channelWriteResult(code, rb.epoch);
if (code == DECO_RESULT_OK && rb.buildingId == static_cast<uint64_t>(g_capBuildingId)) g_capArmed = false;
// ^ this plan's despawn call runs alongside this DECO_RESULT_OK branch, for a kind=ADD rebind only.
```
Existing collideScreenRay usage (reuse for floor-hit sampling; locate by function name):
```cpp
int64_t rid = 0; float rp[3] = {};
g_lastRayHit = swg::endpoints::collideScreenRay(static_cast<int>(io.MousePos.x), static_cast<int>(io.MousePos.y), 0, &rid, rp) != 0;
```
</interfaces>

<tasks>

<task type="auto">
  <name>Task 1: Placement-mode state — enter/render ghost+reticle/cancel + re-entry guard (Sonnet F10)</name>
  <files>packages/live-inject/agent/overlay.cpp</files>
  <read_first>
    packages/live-inject/agent/overlay.cpp (locate by NAME, not line number — the hover/ray sampling structure
    to extend; renderFrame's structure for where the new render step slots in — after handleHostCommand,
    before the decoration strip so the placement UI takes visual precedence while active)
    .planning/sketches/021-spawn-decoration-flow/index.html (lines 193-204, Frame 2's exact DOM: ghost-item,
    reticle, place-strip with "Placing: {template}" + hint text + "Place here" affordance)
  </read_first>
  <behavior>
    - Extend `handleHostCommand()`'s dispatch (Plan 09) so `HOST_CMD_ACTION_START_PLACEMENT` sets
      `g_placementActive = true`, stores `g_placementTemplate` (from str1), `g_placementCellName` (from str2),
      `g_placementBuildingId` (from id) in new module globals, and publishes result 1; `CANCEL_PLACEMENT` (or
      Esc while `g_placementActive`) clears `g_placementActive` and publishes result 1.
    - While `g_placementActive`, render a placement strip (matching 021-A's "Placing: {template}" text + a
      hint "click floor = place · R rotate · Esc cancel") and a ghost marker at the cursor's current
      `collideScreenRay` floor-hit point (sample every frame the same way the existing hover/ray block
      already does — reuse `collideScreenRay`, do not add a second ray-cast mechanism). R while placement-
      active rotates the ghost's preview orientation locally (a simple yaw increment is sufficient — Claude's
      discretion on exact rotation UX, matching "R rotate" from the sketch's hint text) before it's placed;
      this rotation becomes the spawned object's initial transform.
    - Placement mode is exclusive with an already-armed decoration edit (if `g_capArmed` is true, a
      START_PLACEMENT command is a no-op returning result 0 — do not allow two conflicting live edits at
      once; this fail-closed exclusivity mirrors D-01's "one code path" intent by never letting two paths run
      concurrently).
    - **(Sonnet F10)** Placement mode is ALSO exclusive with itself: if `g_placementActive` is ALREADY true
      when a NEW `START_PLACEMENT` arrives, this is ALSO a no-op returning result 0 (same fail-closed pattern
      as the `g_capArmed` exclusivity above) — the pending ghost/template is never silently swapped out from
      under an in-progress placement. The user must CANCEL_PLACEMENT (or click-to-place) the current one
      first before starting a new one.
  </behavior>
  <action>
    Add `bool g_placementActive`, `char g_placementTemplate[256]`, `char g_placementCellName[128]`,
    `int64_t g_placementBuildingId`, and a local yaw-accumulator for the ghost's preview rotation. **(ROUND 3,
    R2)** Also declare `uint32_t g_capKind = 0;` and `char g_capCellName[128] = {};` near these NEW globals
    (they are net-new to the file — first introduced by THIS plan, per Task 2's own use of them — with an
    EDIT-default (`0`/empty) initializer). Extend handleHostCommand's dispatch with the START_PLACEMENT/
    CANCEL_PLACEMENT branches per the behavior spec (currently no-ops per Plan 09's fail-closed default — this
    task is the ONLY place that widens that dispatch, so it must not duplicate Plan 09's existing four-action
    handling, only add these two). The START_PLACEMENT branch's guard clause checks BOTH `g_capArmed` (existing
    exclusivity) AND `g_placementActive` (Sonnet F10's new re-entry guard) before accepting a new placement
    request. Add the placement-strip + ghost render step to renderFrame(), gated on `g_placementActive`.
    **(ROUND 3, R2, continued)** Locate the F-triggered hotkey call site Plan 05 built (the `if
    (ImGui::IsKeyPressed(ImGuiKey_F) ...) { const char* err = armDecorationEdit(); ... }` block inside
    `renderDecorationStrip()`'s helper — locate by the call to `armDecorationEdit()`, not a line number, since
    Plans 05/06/07/09 have all landed by this plan's wave) and add EXACTLY two lines immediately after a
    SUCCESSFUL arm (`err == nullptr`): `g_capKind = 0; g_capCellName[0] = '\0';` — this guarantees a normal
    EDIT arm always clears any stale ADD/ARM_FAILED kind state left over from a prior placement/arm-failure
    cycle, closing R2's duplicate-row risk. This is the ONLY change to Plan 05's F-arm call site; the call to
    `armDecorationEdit()` itself and every other line remain byte-identical.
  </action>
  <verify>
    <automated>cmake --build packages/live-inject/agent/build-agent --config Release</automated>
  </verify>
  <acceptance_criteria>
    Build succeeds; `grep -n "g_placementActive" packages/live-inject/agent/overlay.cpp` shows it read in both
    handleHostCommand and renderFrame; a START_PLACEMENT command while `g_capArmed` is already true is
    verifiable by code inspection to early-return with result 0, not silently override the armed edit; a
    SECOND START_PLACEMENT command while `g_placementActive` is already true is ALSO verifiable by code
    inspection to early-return with result 0, not silently replace `g_placementTemplate`/`g_placementCellName`
    (Sonnet F10). ROUND 3/R2: `grep -n "g_capKind = 0; g_capCellName\[0\] = '\\0';" packages/live-inject/agent/overlay.cpp`
    matches exactly once, and by inspection the match sits immediately after a successful (`err == nullptr`)
    `armDecorationEdit()` call, not inside the placement click handler (that handler SETS g_capKind=1, it must
    never also carry this reset line).
  </acceptance_criteria>
  <done>Placement mode enters/exits correctly, is exclusive with both an active armed edit AND a second
  START_PLACEMENT re-entry, and renders the 021-A Frame-2 ghost+reticle+strip while active.</done>
</task>

<task type="auto">
  <name>Task 2: Click-to-spawn + building-id guard (C6) + auto-arm (kind=ADD) + post-save temp-node despawn</name>
  <files>packages/live-inject/agent/overlay.cpp</files>
  <read_first>
    packages/live-inject/agent/overlay.cpp (locate by NAME, not line number — armDecorationEdit's tail to
    replicate, INCLUDING its `getContainingBuildingId` call, which is this task's C6 guard primitive;
    persistDecorationEdit — this plan's Persist call for a placed object is the SAME function, unchanged;
    applyPendingRebind's DECO_RESULT_OK branch — where this task's despawn call hooks in, per the objective's
    ordering note)
  </read_first>
  <behavior>
    - While `g_placementActive` and the left mouse button is clicked over the WORLD (not an ImGui surface,
      same `!io.WantCaptureMouse` gate as existing hover sampling), and the current-frame `collideScreenRay`
      hit is valid:
      **(C6 building-id guard, NEW; ROUND 3/R10 revises the id==0 case):** first, if
      `swg::endpoints::getContainingBuildingId` is bound, resolve the click hit's building id (via the SAME
      resolver `armDecorationEdit` already calls — pass the ray-hit object/point through the identical
      resolution path) and compare it to `g_placementBuildingId` (the building the World panel's picker
      resolved the borrowed `cellName` FROM, per Plan 14). **(ROUND 3, R10)** A resolved id of exactly `0` is
      the resolver's OWN "could not resolve" sentinel (the SAME sentinel `armDecorationEdit`'s existing
      `if (bldgId == 0) return "no building id..."` branch already treats as "no id", not a genuine
      different-building answer) — treat it IDENTICALLY to the resolver being unbound/absent: fail OPEN,
      proceed to spawn, do NOT refuse the click. Only a resolved id that is BOTH non-zero AND different from
      `g_placementBuildingId` is a genuine MISMATCH. On a genuine MISMATCH: do NOT call `wsAddObject` — instead
      render a one-shot words-only strip message ("wrong building — click inside the building you selected in
      the World panel") and leave placement mode ACTIVE (the user can retry the click without re-opening the
      wizard). On a MATCH, a resolved `0`, or resolver ABSENCE, proceed to spawn as below. This closes the
      wrong-BUILDING facet of C6; the residual same-building-wrong-CELL risk is NOT addressed here (no
      advertised endpoint can resolve it yet — see this plan's objective and the Plan 15 change-request).
      **(ROUND 3, R3 ripple)** Before calling `wsAddObject`, ALSO resolve `g_capBuildingTemplate` for
      `g_placementBuildingId` using the SAME `getObjectByIdAdvertised(&bldgId)` + `getTemplateFilename(bldg)`
      lookup `armDecorationEdit`'s tail already performs (locate by that call pattern, do not re-derive a
      different resolution) — `persistDecorationEdit` always copies `g_capBuildingTemplate` into
      `cap.buildingTemplate` regardless of kind, and `assembleDecorationEdit`'s FIRST operation
      (`deps.readVfs(edit.buildingTemplateVfsPath)`) throws immediately if this is stale/empty; a fresh ADD
      capture MUST carry the REAL stock building-template path for `g_placementBuildingId`, not whatever was
      left over from a prior EDIT arm (or nothing, on a session's first-ever ADD). If this resolution fails
      (building object unavailable), treat it as a spawn failure — do NOT call `wsAddObject` with an empty
      `g_capBuildingTemplate` — and show the same words-only "couldn't resolve building template" class of
      message `armDecorationEdit` already uses for its own equivalent failure.
      Then: call `wsAddObject(g_placementTemplate, currentPreviewTransform12, g_placementBuildingId)`
      (reusing the exact same call shape the existing "Insert at cursor" button already uses),
      capturing the returned live node id into a new `g_placementSpawnedId`. On success (non-zero id): set
      `g_capArmed = true`, `g_latchedFocus`/`g_capFocus` to the spawned object (resolve the Object* the SAME
      way the existing insert flow would need to — if no direct Object* is returned by wsAddObject, resolve it
      via the existing `getObjectByIdAdvertised`-equivalent lookup already used elsewhere in this file for
      building-template resolution), `g_capBuildingId = g_placementBuildingId`, `g_capDecorationTemplate =
      g_placementTemplate`, `g_capOriginalO2p` = the just-spawned transform (so the FIRST persist's "move"
      delta is measured from the placement point, not from the origin); set `g_capKind = 1 /* ADD */`
      and `g_capCellName = g_placementCellName` so persistDecorationEdit's capture write includes them (these
      are the SAME two globals Task 1 now declares with an EDIT-default initializer, ROUND 3/R2); clear
      `g_placementActive`.
    - persistDecorationEdit's existing CAPTURE write is extended (per Plan 03 Task 1, which already grew the
      SMALL `DecorationCapture` struct with `kind`/`cellName` members) to also write `cap.kind`/`cap.cellName`
      from `g_capKind`/`g_capCellName` (defaulting kind to EDIT/cellName empty for the normal edit path — zero
      behavior change there).
    - applyPendingRebind's existing `DECO_RESULT_OK` branch (`code == DECO_RESULT_OK && rb.buildingId ==
      g_capBuildingId`), when the just-applied rebind's ORIGINATING capture was kind=ADD (tracked via a
      `g_pendingRebindWasAdd`/`g_pendingRebindSpawnedId` pair set when the capture was originally sent — the
      REBIND payload itself carries no kind, so this MUST be tracked agent-side locally, not derived from
      `rb`), additionally calls `wsRemoveNode(g_pendingRebindSpawnedId)` — AFTER `wsSaveSnapshot()` has
      already run (this branch only executes once `code == DECO_RESULT_OK`, which already implies the save
      succeeded), matching RESEARCH.md's own stated design. This despawn call happens ONLY for a kind=ADD
      result that is OK — never for a plain edit (no temp node exists) and never on a failed/refused ADD
      persist (the user may still be iterating; leave the preview live so they can retry Persist without
      re-placing).
  </behavior>
  <action>
    Implement the C6 building-id guard check FIRST inside the placement-mode click handler (Task 1), before
    any call to `wsAddObject`, per the ROUND 3/R10-revised id==0 semantics above. Implement the ROUND 3/R3-ripple
    `g_capBuildingTemplate` resolution immediately after the guard passes and before `wsAddObject`. Then
    implement the click-to-spawn handler, the CAPTURE-region kind/cellName write inside persistDecorationEdit
    (using the struct fields Plan 03 already added), and the post-save despawn call inside applyPendingRebind's
    existing DECO_RESULT_OK branch, exactly as specified above. Do not modify `armDecorationEdit`'s BODY itself
    — the auto-arm logic here is a NEW, parallel code path that sets the SAME globals `armDecorationEdit` sets
    (including, now, `g_capBuildingTemplate` via the identical resolution technique), it does not CALL
    `armDecorationEdit` (which requires an existing g_lastRayObj hover target that a freshly-spawned object
    doesn't have this frame). The ROUND 3/R2 two-line reset at the F-arm CALL SITE (Task 1's action) is the one
    permitted touch near `armDecorationEdit`'s call site — it still does not modify the function's own body.
  </action>
  <verify>
    <automated>cmake --build packages/live-inject/agent/build-agent --config Release</automated>
  </verify>
  <acceptance_criteria>
    Build succeeds; `grep -n "g_capKind" packages/live-inject/agent/overlay.cpp` shows it set on the placement
    click path and read inside persistDecorationEdit; `grep -n "wsRemoveNode(g_pendingRebindSpawnedId)"
    packages/live-inject/agent/overlay.cpp` shows the call inside the existing DECO_RESULT_OK branch, gated on
    the kind=ADD tracking flag (not called unconditionally on every RESULT_OK, and not called on any non-OK
    code); `grep -n "getContainingBuildingId" packages/live-inject/agent/overlay.cpp` shows a NEW call site
    inside the placement-click handler (in addition to armDecorationEdit's existing one), gated before
    `wsAddObject` (C6 — verified by code inspection that the mismatch branch returns before reaching
    `wsAddObject`); by inspection, a resolved id of `0` at that call site does NOT take the mismatch-refusal
    branch (ROUND 3/R10). `grep -n "getObjectByIdAdvertised" packages/live-inject/agent/overlay.cpp` shows a
    NEW call site inside the placement-click handler resolving `g_capBuildingTemplate` for
    `g_placementBuildingId`, positioned BEFORE the `wsAddObject` call (ROUND 3/R3 ripple).
  </acceptance_criteria>
  <done>A placement click is refused with a words-only message when it lands in the wrong building (C6's
  wrong-building guard); a valid click spawns live, auto-arms exactly like an existing decoration edit,
  persists as an appended row, and the temp preview node is despawned after a successful rebind+save, matching
  RESEARCH's own verified design.</done>
</task>

<task type="checkpoint:human-verify" gate="blocking">
  <name>Task 3: ADD placement-mode live checkpoint</name>
  <files>packages/live-inject/agent/overlay.cpp</files>
  <action>
    Pause for human verification. Claude has built placement-mode ghost/reticle entry, click-to-spawn auto-arm, the C6 building-id guard, re-entry guarding, and the post-save temp-node despawn (Tasks 1-2). Rebuild the agent DLL and confirm the full ADD round trip survives two consecutive scene-reload cycles, per the steps below.
  </action>
  <what-built>
    021-A's Frame 2: clicking "Place in game" (once Plan 14 wires the modal — for THIS checkpoint, trigger
    START_PLACEMENT directly via a throwaway script calling addon.writeHostCommand, same as Plan 09's
    checkpoint) shows a ghost+reticle at the cursor; clicking the floor spawns the object, auto-arms it, and
    the SAME gizmo+Persist flow an edit uses now appends a new `.ilf` row instead of editing one, with the
    temp preview node reconciled after the save. A click resolved to the WRONG building is refused
    (C6's wrong-building guard).
  </what-built>
  <how-to-verify>
    1. Rebuild the agent DLL and re-inject/re-launch.
    2. From a script (no UI yet), call `writeHostCommand(mappingName, N, 4 /* START_PLACEMENT */,
       '<a valid decoration template path>', '<an existing cellName from a decorated cell>',
       '<that building's id>', [0,0,0])`.
    3. Confirm the in-game overlay shows a ghost + reticle following the cursor with the "Placing: ..." strip.
    4. Click the floor in a DIFFERENT building than the one whose id was passed. Confirm the strip shows the
       "wrong building" refusal message and NO object spawns (C6). Placement mode should remain active.
    5. Click the floor near an existing decoration in the CORRECT building/cell. Confirm the object spawns
       live and the decoration strip (from Plan 05) immediately shows "armed" for the new object.
    5b. **(ROUND 3, R2 — EDIT-after-ADD sequence)** WITHOUT reloading or re-injecting, hover a DIFFERENT,
       PRE-EXISTING decoration (not the one just placed) and press F to arm it via the normal EDIT path.
       Confirm the strip arms normally, move it slightly, Persist, and confirm the World panel / `.ilf` shows
       this as an EDIT to the existing row (its row COUNT for that building does not grow by one) — NOT a
       second appended row. If a duplicate row appears instead, this is R2's exact regression and must be
       reported as a failed step, not silently approved.
    6. Move the just-placed object slightly with G, press Persist. Confirm the strip shows "saved" AND the
       placed object remains visibly present in the current session (matching 021-A Frame 3 — it must NOT
       vanish immediately after persist).
    7. Trigger "Reload current scene." Confirm exactly ONE instance of the new object is visible (loaded from
       the persisted `.ilf` row) — not zero, not two.
    8. Trigger a SECOND "Reload current scene" (or exit and relaunch, then reload). Confirm STILL exactly one
       instance. If a duplicate appears only on this second cycle, this is the open verification item flagged
       in this plan's objective — note it as a finding for a follow-up fix (an additional post-despawn
       `wsSaveSnapshot()` call), do NOT treat step 7 alone as sufficient proof.
    9. Confirm the new row appears in the `.ilf` on disk (spot-check the file, or wait for Plan 15's full
       World-panel-visible verification).
    10. Attempt a SECOND START_PLACEMENT while the first is still active (before clicking); confirm it is
        refused (Sonnet F10) rather than silently swapping the pending template.
  </how-to-verify>
  <resume-signal>Type "approved" once all 11 steps hold (including 5b, ROUND 3/R2's EDIT-after-ADD check), or
  describe which failed (note step 8's duplicate finding explicitly if it occurs — it does not block approval
  of the rest, but must be recorded; a step-5b failure IS blocking — it means R2's fix did not actually close
  the duplicate-row regression).</resume-signal>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| in-game overlay (agent) | Placement mode spawns a live object via an advertised engine call in response to a mouse click while a host-issued placement session is active. |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-05.1-12a | Elevation of Privilege | placement click spawning arbitrary templates | accept | wsAddObject is already the proven, advertised spawn primitive this entire tool's "Insert at player/cursor" feature already uses unchanged (Phase 5.1's own precedent) — this plan adds no new spawn capability, only a new UI TRIGGER (ghost+click) for the SAME call. |
| T-05.1-12b | Denial of Service | leaving a temp preview node live forever on a failed ADD persist | accept | Documented, intentional (behavior spec: despawn only fires on DECO_RESULT_OK) — the user can retry Persist or manually despawn via the existing "World edit" Insert/remove tools; matches D-04's "acceptable interim UX" posture for the ADD path generally. |
| T-05.1-12c | Tampering | placement exclusivity with an already-armed edit AND with itself (re-entry) | mitigate | START_PLACEMENT is a fail-closed no-op (result 0) while `g_capArmed` is already true OR `g_placementActive` is already true (Task 1 behavior spec, Sonnet F10) — prevents two concurrent live-edit sessions, or a mid-placement template swap, from corrupting each other's capture state. |
| T-05.1-12d | Repudiation | temp-node double-spawn across reload cycles | mitigate (pending live verification) | RESEARCH's stated post-save despawn design is implemented as-is; the checkpoint's two-cycle reload test is the ground-truth verification step — an unresolved finding here is escalated as a follow-up, not silently patched with unverified engine-behavior assumptions (per the project's ground-truth mandate). |
| T-05.1-12e | Tampering | placement into the WRONG building via a stale/mismatched cellName borrow (C6) | mitigate (partial — building-level only) | The building-id cross-check (Task 2, C6) refuses a click resolved to a DIFFERENT building than the one the picker borrowed the cellName from, using the already-bound `getContainingBuildingId` resolver. The residual same-building-multi-cell risk (a different ROOM within the SAME building) is NOT closable with currently-advertised endpoints — explicitly disclosed here and in Plan 14/15, filed as the permanent-fix change-request in Plan 15. |
</threat_model>

<verification>
`cmake --build packages/live-inject/agent/build-agent --config Release` succeeds; the blocking checkpoint's 10
steps all pass (or step 8's finding is explicitly recorded).
</verification>

<success_criteria>
021-A's Frame 2 (in-game placement) is fully built and human-verified across two reload cycles: ghost
placement, live spawn, auto-arm, append-not-edit persist, and the temp-node reconcile step matching
RESEARCH's own verified design — the in-game half of SC4's ADD path is closed. A wrong-building placement
click is refused with words, not silently spawned (C6, partial mitigation), EXCEPT a resolved id of 0
(fail-open, R10). A re-entrant START_PLACEMENT is refused, not silently swapped (Sonnet F10). A normal EDIT
arm performed after an ADD in the same session never inherits the ADD's kind and never silently appends a
duplicate row (R2, live-verified via step 5b). An ADD capture always carries a real, freshly-resolved
buildingTemplateVfsPath, not a stale/empty one (R3 ripple).
</success_criteria>

<output>
Create `.planning/phases/05.1-live-world-editor-productization/05.1-12-SUMMARY.md` when done
</output>

==================== .planning/phases/05.1-live-world-editor-productization/05.1-13-PLAN.md ====================
---
phase: 05.1-live-world-editor-productization
plan: 13
type: execute
wave: 4
depends_on: ["05.1-11", "05.1-01", "05.1-08"]
files_modified:
  - packages/renderer/src/state/removeUndoStore.ts
  - packages/renderer/src/state/removeUndoStore.test.ts
  - packages/renderer/src/services/decorationPersistOrchestrator.ts
  - packages/renderer/src/services/decorationPersistOrchestrator.test.ts
  - packages/renderer/src/panels/world/RemoveUndoToast.tsx
  - packages/renderer/src/panels/world/RemoveUndoToast.test.tsx
  - packages/renderer/src/panels/world/WorldPanel.tsx
  - packages/renderer/src/panels/world/WorldPanel.test.tsx
autonomous: true
requirements: [pivot-driven]
must_haves:
  truths:
    - "Any decoration, stock included, is removable as a World-panel row action guarded by an undo toast, with no confirm dialog (D-02/D-03, SC4)"
    - "Remove ALWAYS performs a durable, data-only .ilf row removal (D-02) — this is the guaranteed contract this phase ships. The opportunistic live-despawn branch (sendDespawnNode when a live WS node id is tracked for the row) is implemented and unit-tested as a mechanism, but AS OF THIS PHASE no producer populates a live id on any row the World panel shows, so it is forward-compatible groundwork, not an exercised capability in any session this phase ships — this is stated honestly here rather than implied as delivered (REVIEWS.md C4)"
    - "Remove is reversible via the 8-second undo toast window; after the window elapses, restoring a removed decoration requires manually re-adding it via the Add flow (D-02's 'inherently reversible' claim is scoped to this window, per Sonnet F11)"
    - "removeDecorationRow sources its mandatory buildingTemplateVfsPath from the WorldEditorBuilding the caller already has (Plan 04's durable per-project map, ROUND 3/R3), and fails closed with a words-only message — never crashes on a missing readVfs entry — when that value is unknown for a given building (ROUND 3, R3)"
    - "WorldPanel.tsx builds a real overrideDir/readVfs pair (via Plan 04's resolveScanRoot + Plan 06's now-exported makeReadVfs) before calling removeDecorationRow — not a call the plan describes but never shows how to construct (ROUND 3, R4)"
    - "removeDecorationRow receives mappingName from its caller instead of referencing a variable it was never given (ROUND 3, R7)"
  artifacts:
    - path: "packages/renderer/src/panels/world/RemoveUndoToast.tsx"
      provides: "the D-03 undo-toast affordance"
      contains: "Undo"
    - path: "packages/renderer/src/services/decorationPersistOrchestrator.ts"
      provides: "removeDecorationRow — data-only removeNode + a live-despawn code path that no current caller ever exercises with a non-null id"
      contains: "removeDecorationRow"
  key_links:
    - from: "packages/renderer/src/panels/world/WorldPanel.tsx"
      to: "packages/renderer/src/services/decorationPersistOrchestrator.ts"
      via: "the row's Remove action calling removeDecorationRow"
      pattern: "removeDecorationRow\\("
    - from: "packages/renderer/src/services/decorationPersistOrchestrator.ts"
      to: "packages/renderer/src/services/hostCommand.ts"
      via: "removeDecorationRow's conditional sendDespawnNode call — mechanism exists, no current caller passes a non-null liveNetworkId (see C4 note)"
      pattern: "sendDespawnNode\\("
---

<objective>
Build D-02/D-03's Remove capability: a World-panel row action, guarded by an undo toast (no confirm dialog,
the exact `DeleteUndoToast.tsx` pending-diff precedent scoped to decoration rows), that removes a `.ilf` row
via Plan 01's `assembleDecorationEdit(kind='remove')` and re-derives the building template — the SAME
model-D data path as moving a stock table, per D-02 ("any decoration is removable, stock included; the stock
file is never touched, so removal is inherently reversible"). Undo re-adds the row via the SAME
`kind='add'`-equivalent data path (not a bespoke "undo" mutator), matching the phase's "one code path" ethos.

**ROUND 3 REVISIONS (2026-08-01, REVIEWS.md R3/R4/R7):**
- **R3 (HIGH, Opus, ground-truth confirmed):** `assembleDecorationEdit`'s FIRST operation on every call is
  `deps.readVfs(edit.buildingTemplateVfsPath)` — a value `removeDecorationRow` has no live capture to source
  (Remove is an offline, disk-scan-driven action). `WorldEditorBuilding.buildingTemplateVfsPath` (Plan 04 ROUND
  3) now carries this durably, sourced from the new `WorkspaceBindingMeta.worldEditorBuildingTemplates` map
  (Plan 02/06 ROUND 3) that Plan 06's orchestrator populates on every LIVE edit/add capture. `building.
  buildingTemplateVfsPath` may still be the empty string for a building this project has never captured a live
  edit/add for (e.g., a fresh clone, or a project where every existing edit predates this ROUND 3 revision) —
  Task 1 below fails CLOSED on that case with a clear, words-only error, rather than letting
  `assembleDecorationEdit` throw an unfriendly VFS-resolution error deep inside `readVfs`.
- **R4 (HIGH, Opus):** `removeDecorationRow` takes `overrideDir`/`readVfs` parameters, but no plan showed how
  its caller (WorldPanel.tsx, Task 2) constructs them. Task 2 now explicitly resolves `overrideDir` via Plan
  04's `resolveScanRoot` and `readVfs` via Plan 06's now-exported `makeReadVfs` — the SAME two helpers Plan 10's
  refresh()/mirror-toggle flow already uses (this file is edited by both plans; the pattern is now consistent
  across every WorldPanel.tsx action that needs disk access).
- **R7 (MEDIUM, Opus):** `removeDecorationRow`'s body calls `sendDespawnNode(mappingName, liveNetworkId)` but
  `mappingName` was never among its declared parameters — a real undeclared-variable bug. `removeDecorationRow`
  now takes an explicit `mappingName: string | null` parameter, threaded from `useLiveStore` by its caller
  (WorldPanel.tsx). If `mappingName` is null while `liveNetworkId` is somehow non-null (should not happen in
  practice — there is no live id to despawn without a live session), the despawn call is skipped with a logged
  warning, matching the function's existing best-effort/never-blocks-the-data-removal posture.

**CROSS-AI REVIEW REVISION (2026-08-01, C4 — HIGH, Codex/Sonnet/Cursor):** the original design of this plan's
`removeDecorationRow` accepted a `liveNetworkId: string | null` parameter and, when non-null, ALSO called
`sendDespawnNode` — described as "opportunistic live despawn where tracked." The cross-AI crew found this was
functionally dead code as originally scoped: the live id would need to come from `worldEditorStore`'s session
overlay, but Plan 04's `sessionOverlay` type is `Map<rowId, 'armed' | 'saved' | 'failed'>` — it carries NO
node-id association at all — and Plan 12's placement flow DESPAWNS ITS OWN temp `wsAddObject` node
IMMEDIATELY after a successful persist (per this SAME phase's own design), so by the time a Remove action
could ever act on a row, no row in this phase's delivered scope EVER carries a live id to despawn. Rather than
either (a) building a materially larger cross-cutting feature (threading a live node id into a NAMED
`sessionOverlay` field and deferring Plan 12's auto-cleanup — the crew's alternative option) at this late
stage of an already-large replan, or (b) silently leaving the misleading "opportunistic" framing in place,
this revision takes the crew's OTHER explicitly-offered resolution: **relabel the branch as forward-
compatible groundwork and state plainly that Remove is data-only in every session this phase ships.** The
`liveNetworkId` parameter and the `sendDespawnNode` call inside `removeDecorationRow` are KEPT (they are
correctly implemented and unit-testable in isolation — a future plan that DOES thread a live id through
`sessionOverlay` can call this function with a non-null id and it will work), but Task 2's WorldPanel.tsx
wiring now ALWAYS passes `liveNetworkId: null` (there is no other honest value to pass, since nothing in this
phase's delivered scope populates one), and this plan's `must_haves`/objective say so explicitly rather than
implying an exercised live-despawn path.

**Sonnet F11:** D-02's "inherently reversible" framing is now explicitly scoped to the 8-second undo-toast
window in this plan's must_haves — after that window elapses, the ONLY way to restore a removed decoration is
to manually re-add it via the 021-A Add flow (Plan 14), which is possible (the stock `.ilf` is never touched,
so the decoration's original template+transform are always recoverable by hand) but is NOT itself an
"undo" action once the toast has expired.

For D-04's live-despawn branch (retained as groundwork, per C4 above): `removeDecorationRow` checks whether
the target row is CURRENTLY associated with a live WS node id the toolkit is tracking from this session — as
of this phase, this is ALWAYS null (no producer populates it) — if a future plan adds that tracking, this
same function's existing branch calls `hostCommand.sendDespawnNode` before/alongside the data removal;
otherwise (today, always) the removal is data-only and the row's status reads "removed — reload scene to see
it gone" (matching D-10's honesty-pattern precedent for mirror-off warnings) until the user reloads.

Purpose: close SC4's REMOVE path end-to-end (data-only guaranteed — this is the delivered contract; live
despawn is implemented but not yet reachable, honestly stated per C4).
Output: `removeUndoStore.ts`, `RemoveUndoToast.tsx`, `decorationPersistOrchestrator.ts`'s `removeDecorationRow`,
and the World panel's per-row Remove action, fully tested.

Byte-exact format coverage note: this plan's `removeNode` calls (inside `assembleDecorationEdit(kind='remove')`,
Plan 01) are ALREADY proven byte-exact against both a byte-recipe fixture AND a REQUIRED real `.ilf` asset by
Plan 01 Task 4's revised CORE-05 registration (`packages/harness/test/ilf-roundtrip.test.ts`, C5-revised). This
plan's own tests exercise the ORCHESTRATION/store layer (removeUndoStore, the (currently-always-null)
live-despawn branch, the World-panel row action) — they do NOT re-prove ilf.ts's byte-exact format contract,
per the "inherit, don't duplicate" instruction; Task 1's tests may use lighter in-memory fixtures for
orchestration-level assertions.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/phases/05.1-live-world-editor-productization/05.1-RESEARCH.md
@.planning/phases/05.1-live-world-editor-productization/05.1-PATTERNS.md
@.planning/phases/05.1-live-world-editor-productization/05.1-01-SUMMARY.md
@.planning/phases/05.1-live-world-editor-productization/05.1-08-SUMMARY.md
@.planning/phases/05.1-live-world-editor-productization/05.1-11-SUMMARY.md
@.planning/phases/05.1-live-world-editor-productization/05.1-REVIEWS.md
</context>

<interfaces>
From packages/renderer/src/state/deleteUndoStore.ts (the FULL structural precedent — flat pending array +
push/restore, reuse the shape, scope it to decoration rows):
```typescript
export interface TrashEntry { id: string; /* ... */ }
export interface DeleteUndoStore { pending: TrashEntry[]; push: (entry: TrashEntry) => void; restore: (id: string) => void; }
```
From packages/renderer/src/panels/deploy/DeleteUndoToast.tsx (the full 219-line component — pending-diff
useEffect at lines 68-92, 8s auto-dismiss at lines 30/54-64, toast shell at lines 118-218 — copy the
structure, swap the copy for decoration-removal wording):
```typescript
useEffect(() => {
  const prev = prevRef.current;
  const removed = prev.filter((e) => !new Set(pending.map((p) => p.id)).has(e.id));
  const added = pending.filter((e) => !new Set(prev.map((p) => p.id)).has(e.id));
  // removed.length > 0 → show "restored" toast; added.length > 0 → show "deleted"/"removed" toast + Undo button
  prevRef.current = pending;
}, [pending]);
```
From packages/renderer/src/services/decorationPersist.ts (Plan 01 output, kind-aware assembly):
```typescript
export function assembleDecorationEdit(edit: DecorationEdit & { kind?: 'edit' | 'add' | 'remove' }, deps: DecorationPersistDeps): DecorationPersistResult;
```
From packages/renderer/src/services/hostCommand.ts (Plan 08 output):
```typescript
export function sendDespawnNode(mappingName: string, networkId: string): void;
```
From packages/renderer/src/state/worldEditorStore.ts (Plan 04 output — sessionOverlay carries NO node-id
association, per C4's finding; do not assume otherwise):
```typescript
export function worldEditorRowId(buildingId: string, cellName: string, rowIndex: number): string;
// sessionOverlay: Map<rowId, 'armed' | 'saved' | 'failed'> — NO live-node-id field exists on this map or
// anywhere else in this phase's delivered store shape (C4 finding, confirmed against Plan 04's real,
// already-landed interface by this task's execution time).
```
From packages/renderer/src/services/worldEditorScan.ts (Plan 04 ROUND 3 output — the resolved scan root helper
and the widened building shape, R3/R4):
```typescript
export interface WorldEditorBuilding { buildingId: string; displayLabel: string; editedIlfPath: string; derivedTemplatePath: string; buildingTemplateVfsPath: string; decorations: { cellName: string; rowIndex: number; objectTemplateName: string; transform: number[] }[]; }
export function resolveScanRoot(clientExe: string | null, offlineBinding: { cfgPath?: string; clientPath: string | null } | null): string | null;
```
From packages/renderer/src/services/decorationPersistOrchestrator.ts (Plan 06 ROUND 3 output — now-exported
readVfs factory, R4):
```typescript
export function makeReadVfs(overrideDir: string): (vfsPath: string) => Buffer;
```
</interfaces>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: removeUndoStore.ts + removeDecorationRow (data-only remove, ALWAYS; live-despawn mechanism kept but unreachable, C4)</name>
  <files>packages/renderer/src/state/removeUndoStore.ts, packages/renderer/src/state/removeUndoStore.test.ts, packages/renderer/src/services/decorationPersistOrchestrator.ts, packages/renderer/src/services/decorationPersistOrchestrator.test.ts</files>
  <read_first>
    packages/renderer/src/state/deleteUndoStore.ts (full file — the pending-array + push/restore shape)
    packages/renderer/src/services/decorationPersist.ts (assembleDecorationEdit's kind='add'/'remove'
    branches, Plan 01)
    packages/harness/test/ilf-roundtrip.test.ts (Plan 01 Task 4, C5-revised — the CORE-05 standing-gate
    registration for `.ilf`; addNode/removeNode are ALREADY byte-exact-proven there at the format level,
    against BOTH a byte-recipe AND a REQUIRED real-asset fixture — this plan does not need to re-prove that;
    skim only to confirm the contract this plan's removeNode calls rely on)
    packages/renderer/src/services/decorationPersistOrchestrator.ts (full file — the mirrorToStockIlf
    resolution + stageDurable helpers this new function reuses, Plan 06's reconcileMirrorMode as the sibling
    "full-project-settings-aware" function to structurally match)
    packages/renderer/src/services/hostCommand.ts (sendDespawnNode)
    packages/renderer/src/state/worldEditorStore.ts (sessionOverlay shape, Plan 04 — CONFIRM it carries no
    node-id field, per C4's finding, before writing this task's tests)
  </read_first>
  <behavior>
    - `RemovedRowEntry` (removeUndoStore's pending-entry shape): `{ id: string (worldEditorRowId), buildingId:
      string, cellName: string, rowIndex: number, removedNode: IlfNode (the exact node removed, so Undo can
      re-add it byte-identical) }`.
    - `useRemoveUndoStore`: `pending: RemovedRowEntry[]`, `push(entry)`, `restore(id): RemovedRowEntry |
      undefined` (returns the entry so the caller can re-add it via removeDecorationRow's sibling add path,
      then removes it from `pending`).
    - **(ROUND 3, R3/R7 — revised signature)** `removeDecorationRow(studioDir: string, overrideDir: string,
      readVfs, building: WorldEditorBuilding, cellName: string, rowIndex: number, liveNetworkId: string | null,
      mappingName: string | null): DecorationPersistResult` — resolves `edit.cellName`/`decorationTemplateName`/
      `originalO2p` from the target row (looked up from `building.decorations` by cellName+rowIndex — the
      CALLER, WorldPanel.tsx, already has this from its seeded tree). **(ROUND 3, R3)** BEFORE calling
      `assembleDecorationEdit`, checks `building.buildingTemplateVfsPath` — if it is the empty string (Plan 04
      ROUND 3's documented "unknown" sentinel — this project/building has never observed a live capture for it
      under the new durable-map mechanism), throws a clear, words-only error: `removeDecorationRow: this
      building's stock template path isn't known yet — hover and arm/persist any decoration in it once first,
      then Remove will work` (fail closed, never passes an empty string into `assembleDecorationEdit`, which
      would otherwise throw a much less friendly VFS-resolution error deep inside `readVfs`). Otherwise, calls
      `assembleDecorationEdit({ ...edit, buildingTemplateVfsPath: building.buildingTemplateVfsPath, kind:
      'remove' }, { readVfs, overrideDir, log, mirrorToStockIlf: readWorkspaceJson(studioDir).mirrorToStockIlf
      ?? true })` (same per-project mirror resolution Plan 06 already established — reuse it, do not hard-code
      true here). If `liveNetworkId` is non-null, ALSO calls `sendDespawnNode(mappingName, liveNetworkId)`
      (ROUND 3, R7 — `mappingName` is now a REAL declared parameter, not a free variable; if `mappingName` is
      null while `liveNetworkId` is somehow non-null, skip the despawn call and log a warning rather than
      calling `sendDespawnNode` with a null mapping name) — this is a best-effort call (wrap in try/catch; a
      failed despawn does not block the data removal, which has already succeeded by this point — matches D-02's
      "stock file never touched, removal inherently reversible" framing: the DATA removal is the durable
      contract, live despawn is an opportunistic bonus). **(C4)** As of this phase, `liveNetworkId` is ALWAYS
      passed as `null` by every caller in this codebase (WorldPanel.tsx, Task 2 below) — the function correctly
      implements the non-null branch and it is unit-tested here in isolation (proving the MECHANISM works),
      but it has zero live callers this phase ships. This is groundwork for a future plan, not a delivered
      end-to-end capability — state this in the test file's own top comment, not just in prose elsewhere.
    - An `addBackDecorationRow` sibling function (or reusing assembleDecorationEdit directly with kind='add')
      re-adds a previously-removed node via the SAME add path Plan 01/06 already exercise for ADD — Undo is
      NOT a bespoke code path.
  </behavior>
  <action>
    Create removeUndoStore.ts mirroring deleteUndoStore.ts's `create<T>()` shape (scoped to decoration rows,
    NOT projects — do not import or extend deleteUndoStore.ts itself, this is a sibling store per PATTERNS.md).
    Add `removeDecorationRow` (per its ROUND 3/R3/R7-revised signature above) and the re-add helper to
    decorationPersistOrchestrator.ts, reusing assembleDecorationEdit/readWorkspaceJson/hostCommand.sendDespawnNode
    exactly as specified. Write tests for both: removeUndoStore's push/restore round-trips a RemovedRowEntry
    exactly; removeDecorationRow with liveNetworkId=null (THE ONLY VALUE ANY CURRENT CALLER EVER PASSES, per C4)
    performs the data removal and does NOT call sendDespawnNode (assert via spy); with a non-null liveNetworkId
    AND a non-null mappingName passed DIRECTLY IN A TEST (proving the mechanism works in isolation even though
    no current caller exercises it), it performs the removal AND calls sendDespawnNode with that exact
    (mappingName, liveNetworkId) pair; a non-null liveNetworkId with a NULL mappingName skips the despawn call
    and logs a warning instead of calling sendDespawnNode with a null mapping name (ROUND 3/R7); a
    sendDespawnNode failure (mocked to throw) does not prevent the function from returning its
    DecorationPersistResult (the data removal already committed); a `building` whose `buildingTemplateVfsPath`
    is `''` causes `removeDecorationRow` to throw the words-only "stock template path isn't known yet" error
    BEFORE calling `assembleDecorationEdit` (asserted via a spy showing `assembleDecorationEdit` was never
    called — ROUND 3/R3).
  </action>
  <verify>
    <automated>npm -w @swg/renderer run test -- removeUndoStore decorationPersistOrchestrator</automated>
  </verify>
  <acceptance_criteria>
    Tests assert: data-only remove path never calls sendDespawnNode; a DIRECTLY-passed non-null liveNetworkId +
    mappingName (test-only, proving the mechanism) calls sendDespawnNode with the exact (mappingName,
    liveNetworkId) pair (ROUND 3/R7); a despawn failure is swallowed and logged, never thrown to the caller; a
    non-null liveNetworkId with a null mappingName never calls sendDespawnNode (ROUND 3/R7); removeUndoStore's
    restore() returns the exact removed IlfNode for re-adding; an empty `buildingTemplateVfsPath` throws BEFORE
    any `assembleDecorationEdit`/`readVfs` call, with a words-only message (ROUND 3/R3).
  </acceptance_criteria>
  <done>removeDecorationRow implements D-02's data-only-guaranteed contract and D-04's live-despawn MECHANISM
  (unit-proven, currently unreachable by any real caller — C4's honest characterization, not a fabricated
  "opportunistic" claim); removeUndoStore holds the undo-eligible entries.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: RemoveUndoToast.tsx + World panel row Remove action (data-only, always)</name>
  <files>packages/renderer/src/panels/world/RemoveUndoToast.tsx, packages/renderer/src/panels/world/RemoveUndoToast.test.tsx, packages/renderer/src/panels/world/WorldPanel.tsx, packages/renderer/src/panels/world/WorldPanel.test.tsx</files>
  <read_first>
    packages/renderer/src/panels/deploy/DeleteUndoToast.tsx (full file — this is a near-verbatim structural
    copy target per PATTERNS.md, swap "project deleted" copy for "decoration removed")
    packages/renderer/src/state/removeUndoStore.ts (this plan's Task 1 output)
  </read_first>
  <behavior>
    - RemoveUndoToast.tsx: subscribes to `useRemoveUndoStore((s) => s.pending)`, diffs prev-vs-current each
      render (the SAME append=new-removal / removal=undo detection DeleteUndoToast.tsx already implements),
      shows an 8-second auto-dismissing toast on a new removal ("Cantina Table removed — Undo") with an Undo
      button calling `restore(id)` then re-adding via Task 1's add-back helper; shows a brief confirmation
      toast when an Undo completes. The toast copy makes the 8-second window explicit where reasonable (e.g.
      a subtle countdown or "Undo (8s)" — Claude's discretion on exact presentation, matching 020-A/019-A's
      minimal-chrome style) so the Sonnet F11 reversibility-window scoping is visible to the user, not just
      documented in this plan.
    - **(ROUND 3, R4/R7)** WorldPanel.tsx: each decoration row gains a "Remove" action (icon/button, per-row,
      no confirm dialog — D-03). Its click handler resolves `overrideDir` via `resolveScanRoot(...)` and
      `readVfs` via `makeReadVfs(overrideDir)` — the SAME pattern Plan 10's mirror-toggle onChange already
      established in this same file (reuse it, do not invent a second resolution path), and reads `mappingName`
      from `useLiveStore.getState().status` (the current attached session's mapping name, or `null` when
      offline/idle) — then calls `removeDecorationRow` with the row's building/cellName/rowIndex, the resolved
      `overrideDir`/`readVfs`/`mappingName`, and **`liveNetworkId: null`, ALWAYS** (per C4 — this phase's
      `worldEditorStore.sessionOverlay` carries no node-id association to look up; do not invent one here or
      fabricate a lookup that doesn't exist) — then `useRemoveUndoStore.push(...)` with the removed node, then
      triggers a `refresh(overrideDir, meta.worldEditorBuildingTemplates)` of the tree (Plan 04's widened
      signature — ROUND 3 seam, reuse the SAME `meta`/`overrideDir` this click handler already resolved, do
      not call `refresh()` with only one argument) so the row disappears from the disk-scanned view immediately
      (data removal already committed to disk by this point). If `removeDecorationRow` throws (e.g. ROUND 3/R3's
      "stock template path isn't known yet" case), catch it and surface the message via the existing `log()`
      service — never crash the row's click handler, and never push a `RemovedRowEntry` for a removal that
      didn't actually happen.
    - The row's status badge, for the data-only remove (which is EVERY remove this phase ships, per C4), reads
      "removed — reload scene to see it gone" until the next reload — this is rendered from the row's LAST
      KNOWN state before it vanished from the refreshed tree, i.e., surfaced via a toast/history entry rather
      than a lingering row (once removed from disk, the row is gone from the NEXT scan by definition — the
      "reload to see it gone" honesty message belongs in the toast/Activity-history text, not as a persistent
      row state).
  </behavior>
  <action>
    Create RemoveUndoToast.tsx as a near-verbatim structural copy of DeleteUndoToast.tsx (pending-diff
    useEffect, 8s timer, toast shell), scoped to `useRemoveUndoStore` and decoration-row copy. Render it from
    WorldPanel.tsx (mounted once per panel instance, matching how DeleteUndoToast.tsx is mounted at its own
    panel's top level). Add the per-row Remove action to WorldPanel.tsx's decoration rows per the behavior
    spec, resolving `overrideDir`/`readVfs`/`mappingName` per the ROUND 3/R4/R7 behavior above, ALWAYS passing
    `liveNetworkId: null` (no lookup, no fabricated association — C4), wrapping the call in a try/catch that
    logs a thrown `removeDecorationRow` error via `log()` instead of crashing (ROUND 3/R3), and record a
    `recordPersistResult` entry in `worldEditorStore.history` for the removal (`outcome: 'warn'`, `message:
    "removed — reload scene to see it gone"` — this is the ONLY outcome this phase's Remove ever produces,
    since the live-despawn branch is never exercised; do NOT also implement the 'ok'/"removed and despawned
    live" message variant described in an earlier draft of this plan, since no caller can ever trigger it).
    Extend WorldPanel.test.tsx: seed a tree with one decoration, click its Remove action, assert
    removeDecorationRow was called (spy) WITH `liveNetworkId: null` specifically, and the row disappears after
    refresh; extend RemoveUndoToast.test.tsx (new file) mirroring DeleteUndoToast.test.tsx's existing test
    shape for the append/undo toast lifecycle.
  </action>
  <verify>
    <automated>npm -w @swg/renderer run test -- RemoveUndoToast WorldPanel</automated>
  </verify>
  <acceptance_criteria>
    Tests assert: clicking Remove on a decoration row triggers removeDecorationRow with the correct row
    identity, a real `overrideDir`/`readVfs` pair (ROUND 3/R4), the seeded `mappingName` from `useLiveStore`
    (ROUND 3/R7), AND `liveNetworkId: null` (never a fabricated non-null value) and no confirm dialog appears
    (query for any dialog/modal role returns none); a toast appears with an Undo action; clicking Undo re-adds
    the row (asserted via the add-back helper being called) and a confirmation toast appears; the toast
    auto-dismisses after its timer (mirroring DeleteUndoToast's own timer test, if one exists — copy that
    test's fake-timer idiom); the recorded history entry for a removal is always `outcome: 'warn'` with the
    "reload scene to see it gone" message (never the unreachable 'ok'/despawned-live variant); a seeded row
    whose building has an empty `buildingTemplateVfsPath` shows the honest "not known yet" error via `log()`
    when Remove is clicked, and does NOT push a RemovedRowEntry or show the undo toast (ROUND 3/R3).
  </acceptance_criteria>
  <done>Remove is a guarded, undo-able, no-confirm-dialog row action per D-02/D-03, fully wired into the World
  panel and covered by tests mirroring the proven DeleteUndoToast idiom — data-only ALWAYS, honestly (C4);
  reversible within the 8-second toast window (Sonnet F11).</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| renderer UI → decorationPersistOrchestrator (removeDecorationRow) → disk (+ an unreachable-this-phase live-despawn code path) | A single row-level UI click triggers a disk write (data removal); the conditional live-despawn branch exists but is never invoked with a non-null id by any caller this phase ships (C4). |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-05.1-13a | Repudiation | destructive remove with no confirm dialog | mitigate | D-03's explicit design: the undo toast (8s window, same precedent as the delete-project flow) is the guard, not a confirm dialog — the stock file is NEVER touched (D-02), so the removal is always reversible by re-adding the exact removed node WITHIN the toast window (Sonnet F11 — after the window, manual re-add via the Add flow is required, not automatic undo), bounding the real risk of a no-confirm action. |
| T-05.1-13b | Denial of Service | a failed live despawn blocking the data removal | mitigate | Explicit design (Task 1 behavior spec): sendDespawnNode is wrapped in try/catch and never blocks or reverts the already-committed data removal — the data path is the durable contract, live despawn is best-effort (and, per C4, currently unreachable in practice — this mitigation guards the mechanism's future activation, not a live risk today). |
| T-05.1-13c | Tampering | none new | accept | removeDecorationRow reuses Plan 01's already-hardened assembleDecorationEdit (sanitizeId, fail-closed resolution) with zero new path-construction logic. |
</threat_model>

<verification>
`npm -w @swg/renderer run test -- removeUndoStore decorationPersistOrchestrator RemoveUndoToast WorldPanel`
green; `tsc --noEmit` clean for packages/renderer.
</verification>

<success_criteria>
Any decoration is removable from the World panel, guarded by an undo toast, no confirm dialog; the data
removal is ALWAYS durable and reversible within the 8-second toast window (Sonnet F11's scoped claim); the
live-despawn mechanism is implemented and unit-tested but honestly documented as unreachable by any caller
this phase ships (C4 — no fabricated "opportunistic" claim). SC4's REMOVE path is closed. ROUND 3:
`removeDecorationRow` sources its mandatory `buildingTemplateVfsPath` from the durable per-project map and
fails closed with words when it's unknown (R3); the caller builds a real `overrideDir`/`readVfs` (R4); the
despawn call site's `mappingName` is a real parameter, not an undeclared variable (R7).
</success_criteria>

<output>
Create `.planning/phases/05.1-live-world-editor-productization/05.1-13-SUMMARY.md` when done
</output>

==================== .planning/phases/05.1-live-world-editor-productization/05.1-14-PLAN.md ====================
---
phase: 05.1-live-world-editor-productization
plan: 14
type: execute
wave: 5
depends_on: ["05.1-13", "05.1-03", "05.1-12"]
files_modified:
  - packages/renderer/src/panels/world/AddDecorationModal.tsx
  - packages/renderer/src/panels/world/AddDecorationModal.test.tsx
  - packages/renderer/src/panels/world/WorldPanel.tsx
  - packages/renderer/src/panels/world/WorldPanel.test.tsx
autonomous: true
requirements: [pivot-driven]
must_haves:
  truths:
    - "A user can pick a decoration template from a searchable grid, hand it to the overlay for placement, and see both surfaces confirm once placed and persisted (SC4, 021-A)"
    - "The MVP cell-name resolution degrade (borrow an existing decoration's cellName from the target building) is real and honest — placement into a building with zero existing decorations is refused with words, never a silent failure (D-04)"
    - "The eligible-building set for ADD is scoped to buildings the World panel's disk-scan tree already tracks (i.e., previously-edited buildings with >=1 existing decoration) — NARROWER than RESEARCH.md's originally-recommended 'any building with >=1 decoration, including never-edited stock buildings' scope, because the tree (D-05) only scans the override dir. This narrowing is explicitly disclosed here and in Plan 15's sign-off, not silently shipped as if it were the wider scope (REVIEWS.md C6, Fable facet)"
    - "The freshly-added row is visually marked '(NEW)' in the World-panel tree until acknowledged/refreshed, matching 021-A Frame 3's two-surface confirm (Sonnet F9 / Cursor M5)"
    - "The placement toast/UI copy explicitly warns the user to click only within the SAME room as the borrowed decoration — the residual same-building-wrong-cell risk Plan 12's building-id guard cannot close (REVIEWS.md C6, Codex/Sonnet facets)"
  artifacts:
    - path: "packages/renderer/src/panels/world/AddDecorationModal.tsx"
      provides: "021-A Frame 1 — the wizard modal"
      contains: "Place in game"
  key_links:
    - from: "packages/renderer/src/panels/world/WorldPanel.tsx"
      to: "packages/renderer/src/services/hostCommand.ts"
      via: "the modal's 'Place in game ▸' calling sendStartPlacement with a cellName borrowed from the target building's existing tree data"
      pattern: "sendStartPlacement\\("
sketch_elements:
  # 021-A Frame 1 (Browse — app modal), the last un-built piece of the wizard:
  - "modal head '+ Add decoration to {building} ({cell})'"
  - "search input filtering the template grid"
  - "template thumbnail grid (thumb, name, path per tile, selectable)"
  - "modal footer: preview note text, Cancel button, 'Place in game ▸' primary button"
  # 021-A Frame 3 (Persisted — both surfaces), the confirm this plan wires:
  - "two-surface confirm: a toast/status line AND a new row appearing in the World list, marked distinctly as new"
---

<objective>
Build 021-A's Frame 1 (the "+ Add decoration…" wizard modal) and wire it to the placement flow Plan 12 (agent
ghost/click) and Plan 08 (`sendStartPlacement`) already built, completing the spawn-decoration flow's app-side
half. The modal is a search + thumbnail grid over the mounted VFS's decoration-shaped entries (reusing
`useTreStore`'s already-mounted `vfsEntries` — no new asset-discovery service), matching 016's wizard-modal
chrome per the sketch's own "016-style picker" framing, scoped to decorations only (not 016's full type/derive/
Core3-scaffold workflow, which is out of scope here).

The target `cellName` for the placement — the one genuine provider gap RESEARCH.md identifies (`
CellProperty::getCellName()` is inline/unadvertisable) — is resolved via the MVP degrade RESEARCH explicitly
recommends: the target building must already have at least one existing decoration in the tree (its
`cellName` is borrowed from that existing row's disk data, no live provider call needed); a building with zero
existing decorations refuses placement with an honest, words-not-codes message ("this building has no
decorations yet — add one to an existing building first" or similar), rather than silently failing or
guessing a cell name. The permanent fix (a real provider shim resolving any cell) is filed as a change-request
handoff in Plan 15, per the cross-repo protocol — this plan does NOT edit `../swg-client-v2`.

**CROSS-AI REVIEW REVISIONS (2026-08-01, C6 — HIGH, split across three reviewer facets):**
- **Fable's facet (eligible-building set narrower than RESEARCH's own recommendation):** `worldEditorStore.
  tree` is populated ENTIRELY from `worldEditorScan.ts`'s disk scan of the override dir (D-05) — buildings that
  have NEVER been edited (no `edit_*.ilf` on disk yet) are simply absent from the tree, even if their STOCK
  `.ilf` (readable offline via the mounted VFS) already has >=1 decoration and could, per RESEARCH's own
  stated recommendation, supply a borrowable cellName. Building the stock-`.ilf`-fallback lookup RESEARCH
  envisioned would require the World panel to also enumerate and let the user select never-edited buildings —
  a materially larger scope addition (a new building-discovery UI + a new stock-scan code path) than this
  targeted revision should absorb this late in the phase. Per this plan's own scope-reduction rules (a
  genuine "missing UI to select an unedited building" gap, not laziness), this revision EXPLICITLY DISCLOSES
  the narrowing rather than silently shipping it: ADD is available only for buildings ALREADY visible in the
  World panel's tree (i.e., previously-edited ones with >=1 decoration) — Task 2's behavior spec and this
  plan's `must_haves` say so in these exact words, and Plan 15's sign-off checklist records it as an observed
  scope note, not a silently-passed check.
- **Codex/Sonnet's facet (wrong-cell/wrong-room risk within the borrowed building):** Plan 12 now adds a
  building-ID cross-check guard (refusing a click in the WRONG building), but nothing can verify the click
  landed in the CORRECT ROOM within a multi-cell building (no advertised endpoint resolves a click's cell
  name — that is the exact gap the Plan 15 change-request exists to close). Task 2 below adds an explicit,
  visible warning to the placement-active toast copy: "place only in the SAME ROOM as the decoration you
  selected — this building may have other rooms the toolkit can't tell apart yet." This does not eliminate
  the risk (no code fix is possible without the provider shim) but makes it an INFORMED risk, not a silent
  one.
- **Sonnet F9 / Cursor M5:** the "(NEW)" row marker was named in this plan's `sketch_elements` frontmatter in
  the original version but never appeared in any task's actual behavior/action text or test assertions. Task 2
  below adds it explicitly.

Purpose: close SC4's app-side ADD trigger and the two-surface confirm (021-A Frame 3), with the C6 risk
surfaced honestly rather than silently narrowed or left as an invisible landmine.
Output: `AddDecorationModal.tsx`; the World panel's "+ Add decoration…" button wired to open it with a
resolved building/cell context; a visible confirm once the placement persists, including a "(NEW)" row marker.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/phases/05.1-live-world-editor-productization/05.1-RESEARCH.md
@.planning/phases/05.1-live-world-editor-productization/05.1-PATTERNS.md
@.planning/phases/05.1-live-world-editor-productization/05.1-13-SUMMARY.md
@.planning/phases/05.1-live-world-editor-productization/05.1-12-SUMMARY.md
@.planning/phases/05.1-live-world-editor-productization/05.1-08-SUMMARY.md
@.planning/sketches/021-spawn-decoration-flow/README.md
@.planning/sketches/016-new-object-from-template/README.md
@.planning/phases/05.1-live-world-editor-productization/05.1-REVIEWS.md
</context>

<interfaces>
From packages/renderer/src/services/hostCommand.ts (Plan 08 output, reuse verbatim):
```typescript
export function sendStartPlacement(mappingName: string, decorationTemplate: string, cellName: string, buildingId: string): void;
```
From packages/renderer/src/services/worldEditorScan.ts (Plan 04 ROUND 3 output — the tree data this plan
borrows a cellName from; NOTE: this tree ONLY contains buildings with an existing edit_*.ilf on disk, per D-05
— never-edited/stock-only buildings are absent, per this revision's C6/Fable disclosure):
```typescript
export interface WorldEditorBuilding { buildingId: string; displayLabel: string; editedIlfPath: string; derivedTemplatePath: string; buildingTemplateVfsPath: string; decorations: { cellName: string; rowIndex: number; objectTemplateName: string; transform: number[] }[]; }
```
From packages/renderer/src/state/worldEditorStore.ts (Plan 04 ROUND 3 output — the shared row-id contract,
R12/MED-7; use these instead of any ad-hoc `selectedRowId` string parsing):
```typescript
export function worldEditorBuildingRowId(buildingId: string): string;
export function parseWorldEditorRowId(id: string): { kind: 'building'; buildingId: string } | { kind: 'decoration'; buildingId: string; cellName: string; rowIndex: number };
```
From packages/renderer/src/state/treStore.ts (the mounted VFS entries this modal searches — reuse the SAME
store makeReadVfs already reads from in decorationPersistOrchestrator.ts):
```typescript
export const useTreStore: /* ...; vfsEntries: VfsEntry[]; ... */;
```
From packages/renderer/src/state/worldEditorStore.ts (Plan 04 output, extended by Plan 08 Task 3 — the
`history` growth this plan's refresh-on-growth effect subscribes to):
```typescript
export const useWorldEditorStore: /* ...; history: PersistHistoryEntry[]; ... */;
```
</interfaces>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: AddDecorationModal.tsx — search + thumbnail grid (021-A Frame 1)</name>
  <files>packages/renderer/src/panels/world/AddDecorationModal.tsx, packages/renderer/src/panels/world/AddDecorationModal.test.tsx</files>
  <read_first>
    .planning/sketches/021-spawn-decoration-flow/index.html (lines 170-191, Frame 1's exact DOM: modal-head
    with building/cell context text, search input, tpl-grid of selectable tiles each with thumb/nm/pth, and
    the modal-foot's preview-note + Cancel + "Place in game ▸" primary button)
    packages/renderer/src/state/treStore.ts (vfsEntries shape — path/name fields to filter against)
  </read_first>
  <behavior>
    - Props: `buildingLabel: string`, `cellName: string`, `buildingId: string`, `onCancel: () => void`,
      `onPlace: (templatePath: string) => void` (the caller, WorldPanel.tsx, owns the actual
      sendStartPlacement call + modal-close sequencing — this component is presentation + selection only).
    - Modal head reads "+ Add decoration to {buildingLabel} ({cellName})" per 021-A's exact wording pattern.
    - Search input filters `useTreStore`'s `vfsEntries` by substring match against `path` (case-insensitive),
      scoped to a decoration-shaped prefix convention (paths containing `/furniture/` or `/tangible/` — match
      the SAME convention `.ilf`'s own `objectTemplateName` values already use, e.g.
      `object/tangible/furniture/...`) — do not attempt to enumerate ALL mounted assets unscoped (too broad,
      not what 021-A's "furniture templates" search implies).
    - Each result renders as a tile: a glyph/thumb placeholder, the template's basename (humanized), and its
      full VFS path — matching 021-A's tpl-grid tile shape. Selecting a tile highlights it (single-select).
    - Footer: a preview-note text ("preview loads from the mounted TRE" per the sketch, or a placeholder note
      if a live mesh-viewport preview integration is out of this task's scope — Claude's discretion, document
      the choice), a Cancel button calling `onCancel`, and a "Place in game ▸" primary button (disabled until
      a tile is selected) calling `onPlace(selectedTemplatePath)`.
  </behavior>
  <action>
    Create AddDecorationModal.tsx as a presentational modal component per the behavior spec, reading
    `useTreStore((s) => s.vfsEntries)` and filtering client-side. Write AddDecorationModal.test.tsx seeding a
    small vfsEntries fixture, asserting: the search input filters the grid to matching entries; selecting a
    tile enables "Place in game ▸"; clicking it calls onPlace with the selected entry's exact path; Cancel
    calls onCancel; the modal head shows the passed buildingLabel/cellName.
  </action>
  <verify>
    <automated>npm -w @swg/renderer run test -- AddDecorationModal</automated>
  </verify>
  <acceptance_criteria>
    Test asserts search filtering narrows the visible tile count correctly; onPlace receives the exact
    selected template path; "Place in game ▸" is disabled with nothing selected.
  </acceptance_criteria>
  <done>AddDecorationModal.tsx matches 021-A Frame 1 element-for-element, fully covered by tests.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: World panel wiring — open modal with resolved context (C6-disclosed scope), dispatch placement with a wrong-room warning (C6), confirm on both surfaces incl. a '(NEW)' marker (Sonnet F9/Cursor M5)</name>
  <files>packages/renderer/src/panels/world/WorldPanel.tsx, packages/renderer/src/panels/world/WorldPanel.test.tsx</files>
  <read_first>
    packages/renderer/src/panels/world/WorldPanel.tsx (Plan 10/11's "+ Add decoration…" footer stub — replace
    its toast-only onClick with the real modal-open flow)
    packages/renderer/src/services/hostCommand.ts (sendStartPlacement)
    packages/renderer/src/hooks/useChannelReader.ts (Plan 08 Task 3's ALREADY-LANDED
    `recordPersistResult` wiring — confirms the exact RESULT → `worldEditorStore.history` path this plan's
    refresh-on-growth effect below depends on; this is the dependency the 2026-07-31 revision added to close a
    previously-missing link — do not assume it predates Plan 08)
    .planning/sketches/021-spawn-decoration-flow/index.html (lines 206-219, Frame 3's two-surface confirm —
    overlay toast text style + the World-list's "(NEW)" marked row)
  </read_first>
  <behavior>
    - **(ROUND 3, R12/MED-7)** Clicking "+ Add decoration…" resolves a target building/cellName by calling
      `parseWorldEditorRowId(worldEditorStore.selectedRowId)` (Plan 04's shared discriminator — never a local
      colon-split) if a building or decoration row is currently selected in the tree: for `kind: 'decoration'`,
      use its exact `cellName`; for `kind: 'building'`, use the FIRST cellName among that building's existing
      decorations. **(C6, Fable facet — explicit scope disclosure):** the selectable set here is
      ENTIRELY `worldEditorStore.tree`, which per D-05 only contains previously-EDITED buildings — a
      never-edited stock building (even one whose STOCK `.ilf` already has decorations) is simply not
      selectable in this UI, because it doesn't appear in the tree at all. This is a NARROWER scope than
      RESEARCH.md originally recommended (which considered a stock-`.ilf` fallback lookup for unedited
      buildings) — the narrowing is intentional for this phase (avoiding a larger building-discovery UI
      addition) and is recorded in Plan 15's sign-off, not silently shipped. If the resolved building has ZERO
      existing decorations (`decorations.length === 0`) OR nothing is selected, the button is disabled with a
      hint tooltip/adjacent text reading "select a decorated building first — placing into a brand-new cell
      isn't supported yet" (the honest D-04 degrade message, words not a silent no-op).
    - When a valid context resolves and the user picks a template + clicks "Place in game ▸": close the
      modal, call `sendStartPlacement(mappingName, templatePath, resolvedCellName, resolvedBuildingId)`
      (requires an attached live session — the button/flow is disabled entirely when `useLiveStore` is not
      'attached', matching the Scene accordion's own live-gating precedent from Plan 11), and show a toast
      **(C6, Codex/Sonnet facet — wrong-room warning added)**: "Placement mode active in-game — place the
      object, then Persist. Click ONLY in the SAME ROOM as the decoration you selected in {resolvedCellName}
      — this building may have other rooms the toolkit can't distinguish yet." (the in-game half of the
      handoff; the in-game ghost/ack and the building-ID guard are Plan 12's territory — this toast's job is
      to make the RESIDUAL same-building-wrong-cell risk an INFORMED one, since no code fix for it exists yet).
    - Two-surface confirm (021-A Frame 3): once a subsequent CAPTURE/RESULT cycle lands with
      `capture.kind === 'add'` and a successful result, `worldEditorStore.history` grows by one entry — this
      is the poll loop's `useChannelReader.ts` → `worldEditorStore.recordPersistResult` wiring that
      **Plan 08 Task 3 built** (added in the 2026-07-31 revision specifically to close this gap; before that
      revision, no plan actually dispatched the base edit/add RESULT into the store, so this plan's
      two-surface confirm had no real trigger — this plan's `depends_on` reaches Plan 08 transitively via
      Plan 13, whose own `depends_on` already lists `05.1-08`, and Plan 08's wave (2) is strictly earlier than
      this plan's wave (5), so the wiring is guaranteed to exist by the time this task runs). This plan's job
      is to (a) ensure a `refresh(overrideDir, meta.worldEditorBuildingTemplates)` is triggered promptly after
      that history growth while the World tab is open (e.g., a small effect subscribing to the store's history
      length and re-running refresh on growth, reusing the SAME `overrideDir`/`meta` Plan 10's mount effect
      already resolved in this file — ROUND 3 seam, never call `refresh()` with only one argument) so the new
      row appears without requiring a manual reopen of the tab, AND (b) **(Sonnet F9/Cursor M5)**
      mark the newly-appeared row with a visible "(NEW)" badge/suffix in the tree — tracked via a short-lived
      local Set of "row ids present in this session's history-triggered refresh but not seen in the PREVIOUS
      refresh's row-id set" (a simple before/after diff of `tree`-derived row ids across the refresh call,
      not a server-pushed flag) — clearing the "(NEW)" marker either after a short timeout (matching the
      Persist strip's own ~2s discretion) or when the row is explicitly selected, Claude's discretion on which,
      documented in the component.
  </behavior>
  <action>
    Replace the Plan 11 footer stub's onClick with the modal-open flow described above (track modal-open
    state in local component state), render `<AddDecorationModal>` conditionally with the resolved
    buildingLabel/cellName/buildingId, wire its onPlace to sendStartPlacement + the wrong-room-warning toast +
    close, and add the history-length-triggered refresh effect PLUS the "(NEW)" row-id-diff tracking described
    above. Extend WorldPanel.test.tsx: assert the Add button is disabled with the correct hint when no
    building/undecorated-building is selected; assert it opens the modal with the correct resolved context
    when a valid decoration row is selected; assert selecting a template and clicking Place calls
    sendStartPlacement with the resolved cellName/buildingId (spy/mock) and shows the toast containing BOTH
    "Placement mode active" AND the wrong-room warning text (C6); assert a history-length change (simulating
    Plan 08 Task 3's recordPersistResult having fired) triggers a fresh refresh() call (spy on
    worldEditorScan or the store's refresh action) AND that the row present after the refresh but absent
    before it renders a "(NEW)" marker (Sonnet F9/Cursor M5).
  </action>
  <verify>
    <automated>npm -w @swg/renderer run test -- WorldPanel</automated>
  </verify>
  <acceptance_criteria>
    Tests assert: the Add button correctly gates on a decorated-building selection (D-04's honest degrade,
    scoped per C6's Fable-facet disclosure to tree-visible buildings only); a valid selection + template pick
    calls sendStartPlacement with the borrowed cellName, never a fabricated or empty one; the placement-active
    toast contains the wrong-room warning text (C6, Codex/Sonnet facet); the World panel refreshes
    automatically once a new persist result lands (i.e., once `worldEditorStore.history` grows by one entry
    via Plan 08 Task 3's wiring), without requiring a manual tab close/reopen; the freshly-appeared row after
    that refresh renders a "(NEW)" marker (Sonnet F9/Cursor M5).
  </acceptance_criteria>
  <done>The "+ Add decoration…" flow is fully wired end-to-end from the app side, with an honest, words-based
  degrade for the one genuine provider gap this phase does not solve (with its actual scope — tree-visible
  buildings only — explicitly disclosed, C6) and a visible wrong-room warning for the residual same-building
  risk (C6); the newly-added row is marked "(NEW)" per the sketch (Sonnet F9/Cursor M5); the change-request for
  the permanent cell-name fix is filed in Plan 15.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| renderer UI → hostCommand.ts → agent | The modal's confirmed selection triggers a live in-game placement-mode session from a UI click. |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-05.1-14a | Tampering | template search string / selected path | mitigate | The selected template path is sourced ONLY from `useTreStore`'s already-mounted, already-trusted vfsEntries list (never free-text user input passed directly to sendStartPlacement) — a user can only select a template that genuinely exists in the mounted VFS. |
| T-05.1-14b | Information Disclosure | none material | accept | Local desktop tool browsing its own mounted asset set. |
| T-05.1-14c | Denial of Service / Repudiation | placing into an unresolvable cell (empty building) | mitigate | Explicit fail-closed UI gate (D-04's honest degrade, Task 2 behavior spec) — the button is disabled with a clear reason rather than allowing a placement attempt that would fail deep in the agent with no clear cause. |
| T-05.1-14d | Tampering | a click landing in the WRONG ROOM within the correct (guarded) building — residual C6 risk | mitigate (informational only, no code fix possible) | Plan 12's building-ID guard closes the wrong-BUILDING case; this plan's explicit wrong-room warning toast (C6) makes the residual same-building-multi-cell risk an INFORMED one — no advertised endpoint can verify cell identity yet (the exact gap Plan 15's change-request exists to close). |
</threat_model>

<verification>
`npm -w @swg/renderer run test -- AddDecorationModal WorldPanel` green; `tsc --noEmit` clean for
packages/renderer.
</verification>

<success_criteria>
021-A's Wizard Modal is fully built and wired; the ADD flow's app-side trigger, live-fire smoke test lands
in Plan 15's checkpoint; the one genuine provider gap is degraded honestly, not silently, and its ACTUAL scope
(tree-visible/previously-edited buildings only, narrower than RESEARCH's original recommendation) is disclosed
rather than silently shipped as the wider scope (C6). The freshly-added row is visibly marked "(NEW)" per the
sketch (Sonnet F9/Cursor M5).
</success_criteria>

<output>
Create `.planning/phases/05.1-live-world-editor-productization/05.1-14-SUMMARY.md` when done
</output>

==================== .planning/phases/05.1-live-world-editor-productization/05.1-15-PLAN.md ====================
---
phase: 05.1-live-world-editor-productization
plan: 15
type: execute
wave: 6
depends_on: ["05.1-14", "05.1-11", "05.1-05"]
files_modified:
  - .planning/handoff/2026-XX-XX-CHANGE-REQUEST-getContainingCellName.md
autonomous: false
requirements: [pivot-driven]
must_haves:
  truths:
    - "Rotation edits persist and reload correctly, live-verified with the same rigor the handoff's proven translate smoke test used (SC5)"
    - "The World panel matches sketch 019-A element-for-element, the HUD matches 020-A, and the spawn flow matches 021-A, verified by an observed/missing diff against each sketch (SC2)"
    - "The one genuine provider gap this phase does not solve (cell-name resolution for a brand-new placement) is filed as a change-request handoff, not silently left undocumented"
    - "D-10's mirror-off hybrid-session warning is live-verified in BOTH surfaces together: the in-game strip's short 'saved (not visible here)' variant AND the World panel's full-detail persist-result line (D-10)"
    - "Every documented-but-not-built gap from the 2026-08-01 cross-AI review (C6's narrower ADD-eligible-building scope, C8's un-wired arm-failure World-panel rendering if the store test alone isn't enough, C9's un-built per-action rich toasts, and the detail-card/Stage-to-project inert stubs) is EXPLICITLY RECORDED in this checkpoint's outcome — sign-off does not silently pass over a documented gap as if it were fixed"
  artifacts:
    - path: ".planning/handoff/2026-XX-XX-CHANGE-REQUEST-getContainingCellName.md"
      provides: "the cross-repo change-request per AGENTS.md's provider/consumer separation protocol"
      contains: "getContainingCellName"
---

<objective>
Close the phase. Two things land here: (1) the ONE cross-repo deliverable this phase owes but must not build
directly — a change-request handoff for the permanent cell-name-resolution shim (D-04/A1), following the
EXACT protocol the `getContainingBuildingId` v25 shim already proved
(`.planning/handoff/2026-07-30-CHANGE-REQUEST-getContainingBuildingId.md` — the REAL filename, verified on
disk this session; a prior draft of this plan cited a nonexistent
`2026-07-30-toolkit-getContainingBuildingId-REQUEST.md`, corrected here per REVIEWS.md Fable L9), since
`CellProperty::getCellName()` is inline/unadvertisable for the same structural reason `getContainingBuildingId`
was; (2) a single blocking human-verify checkpoint that closes every remaining SC1-SC5 item this phase's
automated tasks could not prove on their own: SC5's rotation-persist live-fire, SC2's full three-sketch
observed/missing diff, and D-07's owed provider-§4 editor-scene verify pass now that the World panel's Scene
accordion can trigger it directly.

This plan does NOT edit `../swg-client-v2` — per AGENTS.md's cross-repo rule, the change-request goes into
this repo's `.planning/handoff/` inbox for the maintainer to relay, exactly as the v25 shim's request was
handled.

**CROSS-AI REVIEW REVISION (2026-08-01):** this phase's plan set carries several EXPLICITLY DOCUMENTED, NOT
fully closed gaps found by the cross-AI crew and addressed by targeted disclosure rather than a full fix (a
deliberate, proportionate choice recorded in each source plan's own revision note — see REVIEWS.md for the
full findings this section responds to):
- **C4:** Remove's live-despawn is a unit-tested mechanism with NO live caller this phase ships (Plan 13) —
  Remove is data-only in every real session.
- **C6 (Fable facet):** the ADD wizard's eligible-building set (Plan 14) is narrower than RESEARCH.md's
  original recommendation — only buildings ALREADY in the World panel's disk-scanned tree (previously edited)
  are selectable, not any building with a stock decoration.
- **C6 (Codex/Sonnet facets):** Plan 12's building-ID guard closes the wrong-BUILDING placement risk but NOT
  the wrong-ROOM-within-the-same-building risk — Plan 14 adds an explicit warning toast, not a code fix.
- **C8:** an arm-failure now reaches `worldEditorStore.recordArmFailure` (Plan 03/05/06), but no plan added a
  DEDICATED UI rendering for it beyond the shared Activity accordion (Plan 11) already displaying whatever
  `history` contains — this SHOULD surface correctly since `recordArmFailure` pushes into the same `history`
  array Task 2 below already diffs against the sketch, but this checkpoint explicitly re-verifies it live
  (see step 10 below) rather than assuming the store-level wiring alone proves the UI path.
- **C9:** rich, per-action-site HOST_CMD outcome toasts (Scene/despawn/placement each rendering their own
  words-only result) were NOT built — only a coarse words-only log line (Plan 08) exists at the generic layer.
- **Detail-card actions (Go to/Revert/Edit in game) and the footer's "Stage to project" button (Plan 10/11)**
  ship as documented, inert stubs — no plan closes them, and this checkpoint records them as an OBSERVED gap
  rather than silently skipping the check (Sonnet F5/Cursor L1).
This checkpoint's Task 2 step 11 (below) requires the human verifier to EXPLICITLY record each of these as
"observed gap, accepted" rather than let the sign-off pass silently over them.

Purpose: certify the phase's SC1-SC5 as actually, observably true — not merely "all tasks green" — AND ensure
every deliberately-not-fully-closed finding from the cross-AI review is recorded at sign-off, not silently
forgotten.
Output: the change-request handoff file (correct filename); a completed, human-approved verification
checkpoint covering every must-have this phase's automated tests could not reach, plus an explicit gap ledger.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/phases/05.1-live-world-editor-productization/05.1-RESEARCH.md
@.planning/phases/05.1-live-world-editor-productization/05.1-VALIDATION.md
@.planning/phases/05.1-live-world-editor-productization/05.1-REVIEWS.md
@.planning/handoff/2026-07-30-live-world-editor-decoration-persist.md
@.planning/handoff/2026-07-30-CHANGE-REQUEST-getContainingBuildingId.md
@.planning/sketches/019-world-editor-panel/README.md
@.planning/sketches/020-overlay-decoration-hud/README.md
@.planning/sketches/021-spawn-decoration-flow/README.md
</context>

<tasks>

<task type="auto">
  <name>Task 1: File the cell-name-resolution change-request handoff (D-04/A1)</name>
  <files>.planning/handoff/2026-XX-XX-CHANGE-REQUEST-getContainingCellName.md</files>
  <read_first>
    .planning/handoff/2026-07-30-CHANGE-REQUEST-getContainingBuildingId.md (the exact precedent format/tone
    to mirror — a toolkit-mirror change-request document, not a direct edit to the provider repo; verified
    present at THIS exact filename on disk this session)
    .planning/phases/05.1-live-world-editor-productization/05.1-RESEARCH.md ("Open Questions" §1 — the full
    ground-truth citation: `CellProperty::getCellName()` inline at
    `sharedObject/src/shared/portal/CellProperty.h:249`; `PortalProperty::getCellNames()` exists non-inline
    but returns an ABI-unsafe `std::vector<const char*> const&`; `.ws` node addressing uses a numeric
    `cellIndex`, a DIFFERENT identity space than the `.ilf`'s string `cellName`)
  </read_first>
  <action>
    Write a new handoff file at `.planning/handoff/<today's date>-CHANGE-REQUEST-getContainingCellName.md`,
    modeled on the getContainingBuildingId precedent's structure (problem statement, ground-truth citations
    with exact file:line references, the shim options identified during research — a wrapped
    `getContainingCellName(Object*) -> char*` call vs. a POD out-buffer shim over `getCellNames()`'s
    index→name table, framed as a NEED for the provider session to design, not a prescribed signature, per
    A1's own stated uncertainty), the toolkit-side pre-wire/bind-by-name posture this phase used for every
    other provider dependency (D-04's default), and the interim MVP degrade this phase already shipped (Plan
    14: require the target cell to already contain at least one existing decoration; refuse placement into a
    genuinely empty cell with an honest message; Plan 12's building-ID cross-check reduces but does not
    eliminate the wrong-cell risk within a multi-cell building) so the provider session understands this is
    NOT a blocking request — it unblocks a currently-degraded case, not a currently-broken one.
  </action>
  <verify>
    <automated>test -f ".planning/handoff/"*"-CHANGE-REQUEST-getContainingCellName.md"</automated>
  </verify>
  <acceptance_criteria>
    The handoff file exists, cites the exact ground-truth file:line references RESEARCH.md already
    established (no re-derivation, no fabricated new claims), states the interim degrade already shipped
    (including Plan 12's building-ID guard as a partial, not full, mitigation), and follows the cross-repo
    protocol (toolkit-side mirror document, never a direct edit to `../swg-client-v2`).
  </acceptance_criteria>
  <done>The one genuine provider gap this phase leaves open is documented and filed for the maintainer's relay
  loop, not silently dropped.</done>
</task>

<task type="checkpoint:human-verify" gate="blocking">
  <name>Task 2: Phase sign-off checkpoint (incl. explicit gap ledger)</name>
  <files>packages/renderer/src/panels/world/WorldPanel.tsx, packages/live-inject/agent/overlay.cpp</files>
  <action>
    Pause for human verification. Claude has filed the cell-name-resolution change-request handoff (Task 1) and completed every automatable task across this phase's 14 prior plans. This checkpoint certifies SC1-SC5 as observably true against the running app + a live client, per the steps below, AND requires explicit recording of the cross-AI review's documented-but-not-fully-closed gaps.
  </action>
  <what-built>
    The complete productized Live World Editor: 020-A status-strip HUD (Plan 05), 019-A World panel (Plans
    09-11), mirror-mode toggle + reconcile (Plan 06/10), 021-A ADD flow end-to-end (Plans 03/07/08/09/12/14),
    REMOVE with undo (Plan 13, data-only per C4), and the already-shipped agent `-1`-refused fix + editor-scene
    tooling now reachable from the app (Plan 05/09/11). This revision closes the cross-AI review's two BLOCKERs
    (C1 channel-size ownership, C2 ADD kind/cellName encode+decode) and every HIGH finding (C3 studioDir
    threading, C4 honest Remove framing, C5 mandatory real-.ilf fixture, C6 building-ID guard + explicit
    scope/risk disclosure), plus several MEDIUM findings (C7 single mirror resolution, C8 arm-failure wiring,
    C9 words-only HOST_CMD log line, C10 files_modified fix, C11 real-Electron smoke, C12 failure badge
    renderer, C13 documented synchronous-write invariant) and multiple lower-severity single-reviewer items
    (stale line-number citations, "(NEW)" marker, D-07b hint, Sonnet F11 reversibility scoping, Sonnet F10
    re-entry guard, this plan's own handoff-filename fix).
  </what-built>
  <how-to-verify>
    **SC5 — rotation persist:**
    1. Hover a decoration, F-arm, R-rotate it (not just translate), Persist. Confirm "saved." Reload the
       scene (via the World panel's Scene accordion). Confirm the rotation survived, matching the handoff's
       proven translate smoke test but for a rotate-only move.

    **SC2 — sketch-parity observed/missing diff (do this for all three sketches, list any gap found):**
    2. Open `.planning/sketches/019-world-editor-panel/index.html` (Variant A) side-by-side with the real
       World tab. Walk every element from this phase's plan `sketch_elements` lists (tabstrip, live-strip,
       mirror toggle + hint + badge, edited-buildings section + count chip, building/decoration rows + status
       badges, detail card + its five kv fields + three action buttons, Activity accordion, Scene accordion
       + editor-scene/reload/bookmarks, footer's two buttons) and mark each observed/missing.
    3. Open `.planning/sketches/020-overlay-decoration-hud/index.html` (Variant A) side-by-side with the live
       in-game strip. Walk idle/hover/armed/saved/failed states, the Δ readout, Esc, hotkey hint — mark each
       observed/missing.
    4. Open `.planning/sketches/021-spawn-decoration-flow/index.html` (Variant A) side-by-side with a live
       add-decoration run. Walk all three frames (Browse modal, Place ghost/reticle, Persisted two-surface
       confirm, including the "(NEW)" row marker) — mark each observed/missing.

    **D-07 — owed provider-§4 editor-scene verify pass, now from the app:**
    5. From the World panel's Scene accordion, click "Editor scene ▸ {terrain}". Confirm it loads the OFFLINE
       editor scene (matching the provider's canonical §4 visible-verify context) and a previously-persisted
       decoration edit is visible there — closing the handoff's originally-owed follow-up.

    **SC4 — ADD/REMOVE full round trip, reload-survive, incl. the C6 guards:**
    6. Repeat Plan 14's ADD flow end-to-end from the app (search → select → Place in game → click floor →
       Persist). Confirm the World panel shows the new row marked "(NEW)" (two-surface confirm) and it
       survives a scene reload. Confirm the placement toast showed the wrong-room warning (C6).
    7. Attempt a placement click in a DIFFERENT building than the one selected; confirm it is refused with a
       words-only "wrong building" message and nothing spawns (Plan 12's C6 guard).
    8. Remove a stock (never-before-edited) decoration via the World panel. Confirm the undo toast appears, no
       confirm dialog was shown, and after a scene reload the object is gone. Undo a DIFFERENT removal within
       its 8-second window and confirm the row reappears without a reload. Confirm the removal's history entry
       reads "removed — reload scene to see it gone" (the ONLY outcome this phase produces, per C4 — do NOT
       expect a live-despawn variant; if one somehow appears, that is itself a finding to record, not a normal
       success).

    **SC1 — words, never codes, one final spot check:**
    9. Deliberately provoke one failure case (e.g. attempt to arm an object with no resolvable building) and
       confirm NEITHER the in-game strip NOR the World panel ever displays a raw numeric result code anywhere
       in the UI. Confirm the failed ARM attempt appears as a words-only entry in the World panel's Activity
       accordion (C8's wiring — verify this LIVE, do not just trust the unit tests).

    **D-10 — mirror-off hybrid-session warning, BOTH surfaces:**
    10. In the World panel's mirror-mode toggle, switch mirror OFF. Persist an edit on any decoration. Confirm
       the in-game strip's saved state reads the SHORT variant "saved (not visible here)" — not plain "saved".
       Then open the World panel's Activity accordion and confirm the SAME persist's history line carries the
       FULL detail verbatim: "... — mirror off — not visible on hybrid sessions until reload into an editor
       scene". Switch mirror back ON and persist again; confirm the strip reads plain "saved" and the History
       line has no mirror-off suffix.

    **Gap ledger — explicit recording, not a silent pass:**
    11. Record each of the following as "observed, accepted" (or "observed, NOT accepted — escalate") in your
        resume message: (a) Remove is data-only in this session, live-despawn never fired (C4, expected); (b)
        the "+ Add decoration…" flow only offered previously-edited buildings, not stock-only ones (C6/Fable,
        expected); (c) no rich per-action toast appeared for Scene reload/despawn beyond the generic log line
        (C9, expected); (d) the detail card's "Go to"/"Revert"/"Edit in game" buttons and the footer's "Stage
        to project" button did nothing beyond a stub toast, if clicked (Sonnet F5/Cursor L1, expected). If ANY
        of these behaved DIFFERENTLY than described (better OR worse), record that explicitly — it changes the
        phase's actual state.
    12. (R11(b) close-out, REVIEWS.md Round 2) Maintainer action: annotate 05.1-CONTEXT.md's locked D-02
        wording — "Remove = the edited .ilf omits the row (+ live despawn)" — to note that live despawn is
        deferred groundwork this phase (unit-tested, zero live callers; see (a) above). Plans do not edit
        CONTEXT.md; this ledger line is the explicit flag REVIEWS.md R11(b) required.
  </how-to-verify>
  <resume-signal>Type "approved" once all 10 verification checks hold AND the gap ledger (step 11) has been
  recorded, or describe which check failed / which sketch element is missing / which gap-ledger item behaved
  unexpectedly.</resume-signal>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| cross-repo (toolkit ↔ swg-client-v2) | This plan's only cross-repo artifact is a documentation handoff, never a direct code edit to the sibling repo. |
</threat_model>

<verification>
The change-request handoff file exists at the CORRECT, verified-precedent-matching filename pattern and
cites exact ground-truth references; the blocking checkpoint's 10 verification steps all pass and step 11's
gap ledger is explicitly recorded (not silently skipped).
</verification>

<success_criteria>
SC1-SC5 are all observably true, not merely "tasks green": rotation persists, both HUD and World panel are
words-only (including the C8 arm-failure path, live-verified), all three sketches are element-complete
(including the "(NEW)" marker) or gaps are explicitly recorded, ADD/REMOVE survive reload with the C6
building-ID guard demonstrated, and the owed editor-scene verify pass is closed from the app. The one
remaining provider gap is handed off (at the correct filename) not silently dropped. Every cross-AI-review
finding this phase deliberately did not fully close (C4, C6/Fable, C9's rich toasts, the inert stubs) is
explicitly recorded at sign-off, not silently passed over.
</success_criteria>

<output>
Create `.planning/phases/05.1-live-world-editor-productization/05.1-15-SUMMARY.md` when done
</output>
