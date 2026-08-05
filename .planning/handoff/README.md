# Handoff index

Active handoffs (newest first). One file per workstream; read the active one before resuming.

- **[2026-08-05-SESSION-HANDOFF-phase05.1-sign-off-in-progress.md](2026-08-05-SESSION-HANDOFF-phase05.1-sign-off-in-progress.md)** — ACTIVE. ← start here.
  Phase **05.1 is 17/18**; only **05.1-15** (phase close) remains. Its Task 1 is done; Task 2 is the
  13-step live sign-off checkpoint, **3 steps passed** (1 SC5 rotation, 6 ADD round trip + `(NEW)`
  marker + deferred toast, 7 refusal paths). Working doc:
  `05.1-15-CHECKPOINT-WORKSHEET.md` — running order, pre-filled step-12 gap ledger with code
  citations, paste-ready step-13 annotations. **Carries the v33 investigation**, whose conclusion
  reversed twice: reported as a blocking `wsAddObject` regression, retracted after a provider-staged
  v32 control and a `.ws` swap both reproduced identically, and finally closed as OURS — a substring
  filter admitting `object/draft_schematic/*` (crafting schematics) as placeable props. Three layers
  of silence hid it (agent SEH swallow, our own rate limiter, three refusal paths writing to a
  variable nothing rendered); all three now fixed. **Also corrects the `.ws` byte rule** the previous
  handoff stated too broadly, and records that the engine has NO Release-mode guard below our
  template filter (`ClientInteriorLayoutManager.cpp:143`, `DEBUG_WARNING` + unchecked `safe_cast`).
  Supersedes the wave3-to-wave5 handoff below.

- **[2026-08-04-SESSION-HANDOFF-phase05.1-wave3-to-wave5.md](2026-08-04-SESSION-HANDOFF-phase05.1-wave3-to-wave5.md)** — superseded by the above (05.1-14 closed since; sign-off checkpoint now in progress).
  Phase **05.1 is 16/18**; waves 3-4 closed (plans 11, 12, 13), resume at **Wave 5 (plan 05.1-14,
  the Add-decoration wizard)** via `/gsd:execute-phase 05.1`. Provider contract **v32** — all three
  new rows (`wsForgetNode`, `getCellName`, `refreshInteriorLayout`) consumed AND live-verified.
  **The placement feature now works end to end:** a placed decoration stays visible through Persist,
  its cell name is derived from the placement point rather than operator-supplied, and an occupied
  building can be refreshed in place. **✅ The stale artifacts are FIXED (2026-08-04)** — and there
  were **three**, not the two originally flagged: both `verification_instrument_changed` blocks
  (05.1-15 and 05.1-12) now name `refreshInteriorLayout` as the correct instrument in an occupied
  building, and 05.1-12's SUMMARY carve-outs **#1 AND #2** are marked RESOLVED (`wsForgetNode`,
  `getCellName`) along with the downstream cascade — 05.1-15 no longer requires filing a cell-name
  change-request that has no gap left to file. Only carve-outs 3 and 4 remain open.
  **Both outbound handoffs are filed to the provider inbox** (untracked; maintainer relays).
  Also documents a real defect
  found live: every placement was being written TWICE (`.ilf` row **and** a malformed world-space
  `.ws` node), root-caused, fixed, and the two stale nodes pruned from the maintainer's snapshot.
  Supersedes the wave-2 handoff below.

- **[2026-08-02-phase05.1-wave2-complete-live-findings.md](2026-08-02-phase05.1-wave2-complete-live-findings.md)** — superseded by the above; kept for its defect history.
  Phase **05.1 Waves 1-2 COMPLETE (11/16)**; resume at **Wave 3 (plans 11, 12)** via
  `/gsd:execute-phase 05.1`. **Plan 05.1-16 was INSERTED** this session (phase is 16 plans now) after a
  live checkpoint CRASHED the client — re-entrant `loadScene` from the Present hook; fixed with a
  game-thread deferred queue + Utinni's two-frame `cleanupScene`→`loadScene` sequence.
  **⚠ TWO BLOCKERS before Wave 3:** (a) "Reload current scene" is LOSSY — snapshot objects return as
  un-registered ghosts with no collision, which INVALIDATES the reload-to-confirm-persistence step in
  Plans 12 AND 15 (a correctly-persisted object reads as missing); (b) Plan 11's D-07 bookmarks inherit
  two teleport defects (no cell reparenting → see-through interiors; stale player pointer after reload).
  **Six defects found by live checkpoints, none by any automated gate** — including one that broke the
  ROOT aggregate suite while the package-scoped suite stayed green. **Plan 12 was REVISED** (`01869df`):
  placement container now derives from the CLICK POINT, not the player or the picker preselection
  (maintainer decision — a doorway makes them disagree), and R10's fail-open-on-building-id-0 rule was
  REVERSED as falsified. HEAD `d35b55d`, clean, not pushed; aggregate suite 80 files / 724 passed.
  Supersedes the CONVERGED handoff below.

- **[2026-08-01-phase05.1-CONVERGED-ready-to-execute.md](2026-08-01-phase05.1-CONVERGED-ready-to-execute.md)** — superseded by the Wave-2 handoff above (that plan set is now 11/16 executed).
  Phase **05.1 plan set CONVERGED** after a 13-round cross-AI review loop (unanimous 5/5, 0 findings;
  HIGH trajectory 7→7→6→2→1→0). **Ready to execute: `/clear` → `/gsd:execute-phase 05.1`** (15 plans,
  6 waves, 6 human-verify checkpoints at 01/05/09/11/12/15). Two proven pillars — reset-before-render
  (Plan 04) and the HOST_CMD ack protocol as a total state × event table (Plan 08, the one canonical
  spec others cite) — are SETTLED. Live injection in play (Windows, gate on confirm); native C++
  rebuilds needed for agent/channel/overlay plans (rebuild + verify in real Electron, not just Node).
  05.1-15 emits a cross-repo cell-name change-request + does the SC1–SC5 sketch diff. Also this session:
  Phase 5.2 (Guided Workflows) scoped+inserted; 2 provider docs adopted into `docs/`. HEAD `1fb4dcd`,
  clean, not pushed. Supersedes the decoration-persist handoff below (which built the pipeline 05.1 productizes).

- **[2026-07-30-live-world-editor-decoration-persist.md](2026-07-30-live-world-editor-decoration-persist.md)** — superseded by the 05.1-CONVERGED handoff above (05.1 productizes this pipeline). Historical build record.
  Model-D interior-decoration persistence **built, wired, and proven LIVE end-to-end** except ONE blocker: the
  in-game **building `.ws` node id** can't be resolved (`collideScreenRay`→0 for decorations, CELL id for wall
  clicks; `getParent` not advertised). Fix = one provider shim **`object::getContainingBuildingId`** — request
  filed to the provider inbox (maintainer relays) + consumer **PRE-WIRED** (`826b8ed`, lights up on exe restage,
  no toolkit rebuild). Full round trip proven: capture → orchestrator assembles edited `.ilf` + derived template
  → `writeRebind` → agent `wsSetNodeTemplateName`+`wsSaveSnapshot` → RESULT. Override-dir resolution fixed via
  `detectClients()`. Resume steps + build cmds + debug-trace path in the handoff. HEAD `826b8ed`, pushed.
  Supersedes the pivot handoff below.

- **[2026-07-19-phase05-closed-pivot-to-live-world-editor.md](2026-07-19-phase05-closed-pivot-to-live-world-editor.md)** — superseded by the decoration-persist handoff above.
  Phase 05 **CLOSED** (12/12, LIVE-03 done; Task-2 checkpoint accepted at the thin slice). The live loop works
  end-to-end after fixing **5 real in-app bugs** (Electron-42 external-buffer channel `70a5dd3`, agent-DLL path
  `5ca53d5`, launch cwd `b9d63fd`, process-liveness detach `86a8593`, + Browse button `a11ff97`). In-app UAT
  revealed the real requirement is an **in-GAME gizmo** (relative object placement in the live scene) — a Utinni
  spike + **5-consultant crew** established this is a different **in-process + in-render** architecture. Decision:
  **build it.** Locked plan (crew synthesis): vendor ONLY the render overlay (Present hook + ImGui/ImGuizmo) into
  the x86 agent, reach select/insert/snapshot via the **shared `engine_hookpoints.h` contract** (extend
  `rva_table.cpp`, don't fork editing source), **standalone game window**, **game-thread command queue**, editing
  model in Electron. **Next work = the Slice-0 spike** (go/no-go gate) — start at step 1 (vendor imgui/imguizmo/
  DetourXS into the `/MT` x86 agent, verify it still injects). Read: `.planning/research/{SPIKE-utinni-world-editor-gaps,
  CONSULT-UTINNI-SYNTHESIS,SLICE-0-SPIKE-PLAN}.md`. HEAD `63d4113`, clean, not pushed. Supersedes all Phase-05 handoffs below.

- **[2026-07-09-phase05-m-scale-offset-confirmation-request.md](2026-07-09-phase05-m-scale-offset-confirmation-request.md)** — NON-BLOCKING BACKUP CONFIRMATION, not the active workstream (see the round-6 handoff below for that). Cross-repo ask for `Object::m_scale`'s per-build byte offset: (1) Utinni/legacy session — confirm/correct the planner-computed `0x44` candidate against a live debugger read; (2) swg-client-v2/advertised session — report the compiled member's real byte offset. Both asks are explicitly non-blocking — 05-03's agent already unblocks itself via a live-validated member-offset read (legacy unconditional, advertised gated behind `s_advertisedScaleOffsetConfirmed`, degrading honestly via liveness bit5 until confirmed). Supersedes the never-created `2026-07-08-phase05-getscale-accessor-request.md` ask with a narrower, offset-only request.

- **[2026-07-12-phase05-plan-review-round6.md](2026-07-12-phase05-plan-review-round6.md)** — ACTIVE. ← start here.
  Phase **05** round-6 replan (structural pointer-ABA close, option a) **done** + plan-checker **PASSED
  clean** (0 warnings) + LIGHT round-6 crew (Opus + Cursor) **done**. Verdict **LOW**: the reachable ABA
  paths are CLOSED both sides, layout byte-identical (no new bytes/reads), LRU can't evict the active slot.
  Opus found ONE **MEDIUM correctness pin** to land before execute — the agent `templateName` cross-check
  is type-ambiguous (`const char*`; a pointer compare would silently no-op the agent-side fix; the symbol
  grep can't catch it) → specify content/hash compare + a behavioral test — plus 3 LOW nits. Opus: "once
  item 1 is pinned, safe to execute." No HIGH. Everything **UNCOMMITTED**, HEAD `22ef1ac`, not pushed.
  Trend HIGH→MEDIUM→LOW-MEDIUM→LOW is terminating. Supersedes the round-5 handoff below.

- **[2026-07-12-phase05-plan-review-round5.md](2026-07-12-phase05-plan-review-round5.md)** — superseded by the round-6 handoff above.
  Phase **05** round-5 `--reviews` replan (Path A, identity unification) **done** + plan-checker **PASSED**
  + round-5 crew **done**. Verdict **round-4 MEDIUM → round-5 LOW-MEDIUM**: both round-4 MEDIUMs CLOSED
  (tested), the 396→400 `FOCUS_TOKEN` layout is byte-consistent, overclaim/HUD honesty closed — but Opus
  found the fix opened ONE narrower new fail-open (**pointer-ABA** on the never-invalidated identity cache,
  MEDIUM). No HIGH. Everything **UNCOMMITTED**, HEAD `22ef1ac`, not pushed. Awaiting maintainer: close ABA
  via **(a)** structural (template/networkId cross-check on cache hit + bounded LRU → round-6 replan) or
  **(b)** documented accept-watch + UAT item. Opus: safe to execute with either. Supersedes the round-4
  handoff below.

- **[2026-07-12-phase05-plan-review-round4.md](2026-07-12-phase05-plan-review-round4.md)** — superseded by the round-5 handoff above.
  Phase **05** round-4 `--reviews` replan **done** + plan-checker **PASSED** + round-4 crew **done**.
  Verdict **round-3 HIGH → round-4 MEDIUM**: the two provable HIGHs are CLOSED (one grep-proven), but
  the round-4 baseline-re-key fix left a **host/agent identity-key mismatch** — Opus (fails-open legacy
  revert force-write) and Sonnet (name-only HUD false-reassurance) converged on the same root cause
  (**template-name ≠ unique object identity**), plus a lossy focus-flip MEDIUM and a surviving overclaim.
  No HIGH remains. Everything **UNCOMMITTED**, HEAD `22ef1ac`, not pushed. Awaiting maintainer decision:
  **Path A** round-5 replan folding Opus rec #1 (unify identity) + minors, or **Path B** accept the two
  legacy-revert MEDIUMs as documented limitations + cheap doc fixes → execute. Supersedes the round-3
  handoff below.

- **[2026-07-09-phase05-plan-review-round3.md](2026-07-09-phase05-plan-review-round3.md)** — superseded by the round-4 handoff above.
  Phase **05 (WYSIWYG Live-Sync & Typed Editors)** planning + **3 cross-AI review rounds done**. The round-3
  `--reviews` replan (folding the four round-2 decisions: targeting 1b, W2 bit4 scale-guard, revert coalesce,
  byte prose) is **UNCOMMITTED in the working tree** (7 plan files + STATE.md) — the round-3 review reviewed
  exactly that state; **do nothing destructive before preserving it.** Verdict **HIGH — do NOT execute
  05-03/05-07 as written:** round-2 mechanical fixes all confirmed landed, but the two headline changes each
  opened a new provable HIGH (ungated rebaseline defeats the transform guard; once-per-attach baseline
  unreconciled with the per-frame focus resolver breaks D-03), plus the WYSIWYG viewport-asset→live-object
  promise is still unmet + self-contradicting in 05-03. Three maintainer decisions (#1 re-key baseline,
  #2 gate+unify rebaseline, #3 targeting honesty a-vs-b) in `05-REVIEWS.md`, then `/gsd:plan-phase 5 --reviews`.
  HEAD `2be9586`, not pushed. Supersedes the 04.3 handoff for the active workstream.

- **[2026-07-01-phase-04.3-uat-and-sonnet5-config.md](2026-07-01-phase-04.3-uat-and-sonnet5-config.md)** — superseded by the Phase-05 handoff above (04.3 closed; Phase 04.4 then 05 came since).
  Phase **04.3 is 11/12 done, D-16 crew gate = GO** (F-2 searchTOC-extraction blocker + F-3/F-4/F-5 found and
  fixed; v6000 tests reconciled to per-payload truth; full suite green). Paused at **plan 13 — the combined
  in-client UAT** (manual `human-verify` checkpoint on both a searchTree and a searchTOC client; UAT-RESULTS
  skeleton staged). Execution ran **sequential-on-main** (`use_worktrees=false` — native monorepo, no worktree
  node_modules). Also carries **Task 1: point the crew "fresh Sonnet" + GSD `sonnet` tier at the new
  `claude-sonnet-5`** (verified real via live docs; Sonnet 4.6 now legacy). Not pushed.

- **[2026-06-29-phase04.2-uat-iteration-and-04.3-created.md](2026-06-29-phase04.2-uat-iteration-and-04.3-created.md)** — superseded by the 04.3 handoff above (04.3 was planned + executed to the UAT since).
  Phase **04.2 plans 01–05 executed + merged** (worktree, all GREEN); **04.2-06 UAT OPEN** and walked
  interactively — surfaced a string of bugs/gaps. Small ones fixed inline on `main` (mount wiring, loose-entry
  Extract/viewer, version-selection messaging + Baseline loose-revert stopgap, Hardlink-shadow→Advanced, mount
  spinner, detect-list filter). Big reworks captured as 3 todos and bundled into a **new inserted Phase 04.3**
  (Versioning Model & SearchTOC Mount Completion — plan 01 = crew UI-vs-sketch gap review). Also shipped an
  AGENTS.md "Sketches are the UI contract" rule and corrected the v6000 memory (dual-format, not encrypted).
  Nothing marked complete. HEAD `6864b90`, not pushed. **Next:** likely `/gsd:plan-phase 04.3` then a combined
  UAT (confirm with maintainer); 04.1-11 + 04.2-06 UATs still open and superseded by 04.3's combined UAT.

- **[2026-06-29-phase04.2-planned-crew-reviewed.md](2026-06-29-phase04.2-planned-crew-reviewed.md)** — SUPERSEDED (04.2 was executed; see the handoff above).
  Phase 04.2 (Dev-Client Support & Loose-Override Deploy) **planned, NOT executed**: 6 plans / 5 waves,
  plan-checker PASS (0 blockers), finalized after a full 4-AI de-anchoring crew review + ground-truth
  fact-check that caught **8 defects the plan-checker couldn't see** (mount-wiring B1/B2/B4, reset B3,
  deploy lifecycle H2/H3, and the TOC duplicate-resolution corrected to engine-faithful CRC binary
  search). `.toc` byte format VERIFIED. Resume: `/clear` → `/gsd:execute-phase 04.2`. HEAD `5aed03f`.
  **Watch:** crc32 oracle `3830594` unverified (confirm vs Crc.cpp); real-byte tests skipIf assets absent.
  04.1's UAT (below) is still open and precedes 04.2 numerically.

- **[2026-06-28-phase04.1-deploy-uat-iteration.md](2026-06-28-phase04.1-deploy-uat-iteration.md)** — ACTIVE (04.1 UAT still open).
  Phase 04.1 (deploy-project-ux): all 11 plans executed; long in-client UAT round (the 04.1-11
  checkpoint, still open). Landed the **project-model decouple** (project = umbrella under
  `projects\<name>` that *references* a target client/standalone; in-app Open Project dialog;
  auto-mount on every open), the **native-core seam** (blank-screen fix), the **first-run Welcome
  takeover** (sketch 007-B), **TreeFile.cpp-faithful TRE mount order**, **swgtoolkit.cfg moved into
  the studio** (client gets one absolute `.include`), test isolation, and a big UX round (staged-item
  right-click Open-in-viewer/Unstage, unsaved-changes deploy prompt, badges). HEAD `ae99267`.
  **Open:** in-game absolute-path load check → Hardlink-Shadow keep/remove decision; finish the
  04.1-11 UAT script; then verify + complete the phase. New memories: project-model-umbrella-and-target,
  feedback-sketches-are-ui-source-of-truth, reference-treefile-searchtree-precedence.

- **[2026-06-27-frontier-sketches-007-011-016-DONE.md](2026-06-27-frontier-sketches-007-011-016-DONE.md)** — DONE (committed + pushed `73e1e5e`).
  `/gsd-sketch` frontier session: 6 sketches with winners — **007** project front door (client binding +
  optional local-server + non-client-project branch), **008** Deploy tab composed into the shell (one
  `Inspect|Deploy` group, auto-widen ~440px), **009** SIE-successor IFF editor (typed fields + DATA grid),
  **010** Inspect content (hybrid stat-chips), **011** viewport HUD + live-sync, **016** New-Object wizard
  (derive an instance of the fixed engine type set). Captures 5 product decisions (incl. type-vs-instance,
  now in `docs/02-formats/object-templates.md`), the shared **chrome kit** + a `.panel-tabs` scroll-bug fix
  (also retro-fixed 001/002/004), and open follow-ups (012–015; **014 datatable grid** is the load-bearing
  one). Answers two Phase-4 redesign todos (project-entry, combined deploy tab). Layers on the redesign
  handoff below.

- **[2026-06-27-phase4-uat-findings-redesign.md](2026-06-27-phase4-uat-findings-redesign.md)** — ACTIVE.
  In-client UAT findings + **redesign north star = sketch 005-B** (one combined Deploy tab; the executor
  diverged into 3 tabs). Consolidates the maintainer's product thesis (zero-risk shadow sandbox,
  lazy/virtual files), 3 real-Electron bugs found+fixed (vite builtins / silent open / `prompt()`), all
  design+wiring gaps (each a todo in `todos/pending/`), and 3 queued ground-truth traces (absolute cfg
  paths, server TRE push, **v6000 zlib-vs-encrypted** — challenges a stored memory). One entry point for
  the redesign session. Layers on top of the code-complete handoff below.

- **[2026-06-27-phase4-code-complete-uat-pending.md](2026-06-27-phase4-code-complete-uat-pending.md)** — ACTIVE.
  Phase 4 (Edit & Deploy Loop) **code-complete** — all 8 plans built/merged/integrated on `main`
  (`…→2c9137e`), gates green (renderer 28/28, native 6/6). **Next = maintainer runs the 2 in-client UATs**
  (patch-prepend deploy + shadow-base) → then mark `04-06`/`04-06b` complete, run verifier, close out.
  Carries the version-graph model, cfg ground-truth, UI layout, build/run gotchas, and the full review
  journey (plan-checker + 2 crew rounds — all findings closed). **Not pushed.** Supersedes the Phase-3
  handoff for the active workstream.

- **[2026-06-26-phase3-live-connect-DONE-replan-ready.md](2026-06-26-phase3-live-connect-DONE-replan-ready.md)** — superseded (Phase 3 DONE; its "replan" pointer was overtaken — we built Phase 4 instead).
  Phase 3 (live-connection foundation) **VERIFIED & closed out** — proven live on both client builds;
  4 defects fixed + app wiring + close-out, all pushed (`…→4df1912`). Next workstream = **replan the
  remaining milestone phases** (2, 4, 5, 6, 7, 8) and fold in the parked live-world-terrain decision.
  Carries Phase-5 inputs, the reusable Path-B native-wiring pattern, and build/run gotchas.

- **[2026-06-25-phase2-skinned-anim-and-material-DONE.md](2026-06-25-phase2-skinned-anim-and-material-DONE.md)** — ACTIVE.
  Phase 2 ~90%. 02-04 (animation) DONE & working (skinned `.sat` render + multi-part + multi-skeleton +
  playback) plus a full material-fidelity pass (MATL spec, CSHD, normal-map RGBA8/magenta fix, shadow
  floor). All committed + pushed (`…→5b15cc6`). Next workstream = **02-05 export** (not started).
  Full state, key facts, build/run gotchas, backlog.

- [2026-06-25-phase2-skinned-animation-blocker.md](2026-06-25-phase2-skinned-animation-blocker.md) — RESOLVED.
  The original skinned-`.sat` UI lockup blocker. Superseded by the DONE handoff above (the lockup and
  every follow-on bug were fixed this session). Kept for history.
