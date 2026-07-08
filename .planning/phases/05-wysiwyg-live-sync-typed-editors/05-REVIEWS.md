---
phase: 5
reviewers: [codex, cursor, sonnet, opus]
reviewed_at: 2026-07-08
plans_reviewed: [05-01-PLAN.md, 05-02-PLAN.md, 05-03-PLAN.md, 05-04-PLAN.md, 05-05-PLAN.md, 05-06-PLAN.md, 05-07-PLAN.md, 05-08-PLAN.md, 05-09-PLAN.md, 05-10-PLAN.md, 05-11-PLAN.md, 05-12-PLAN.md]
angles: {codex: "repo-tracer / ground-truth", cursor: "channel-integrity", sonnet: "lateral / blind-spots", opus: "spec-correctness / invariants"}
---

# Cross-AI Plan Review — Phase 5 (WYSIWYG Live-Sync & Typed Editors)

Four independent reviewers, each handed the plans plus the locked ground truth (as given) and pointed at
a **different** angle so they cross-check rather than co-anchor. All four read the real client/agent
source. Convergence from divergent angles is the signal.

Overall risk: **MEDIUM-HIGH** (three reviewers rated MEDIUM-HIGH, Codex rated HIGH). The DATA-01/DATA-02
format tracks are LOW risk and well-grounded; **all four HIGH findings are concentrated in the LIVE-03
live-write track (05-03 and its reflections in 05-10/05-11/05-12).** None require re-architecting — they
are targeted omissions in the resolution model, the guard, and the channel layout.

---

## Consensus Summary

### ⛔ Agreed BLOCKER — `setScale` crashes the advertised client on the first write (all 4 reviewers)

Every reviewer independently flagged this; Opus and Codex verified it against source. The chain:

1. `applyWrite` (05-03 Task 2) calls **both** `setTransform_o2w` **and** `setScale` unconditionally on
   every guard-passing write, and the acceptance criterion *mandates* "never one without the other."
2. On the advertised swg-client-v2 build, `object::setScale` is **absent** from the advertised catalog
   (`engine_advertise.cpp:578/850` has `setTransform_o2w`, no `setScale`) — verified by Opus and Codex.
3. The resolver leaves a slot **untouched** on a name-miss (`resolve.h:43-52` / `resolve.cpp:64`), and
   `setScale` is seeded to the **legacy SWGEmu RVA `0x00B23A10`** (`rva_table.cpp`) — unlike
   `getNetworkId`/`g_mainLoopCounter`/`g_runningFlags`, which are seeded `nullptr` precisely so a
   null-check disables them. So `setScale` can never be null-gated away and stays pointing at a stale
   absolute address in a *different, freshly-compiled* binary.
4. Therefore, on the advertised target — before the maintainer hand-adds the upstream `engine_advertise.cpp`
   row — the **first live write of ANY kind (Move/Rotate included) calls `0x00B23A10` → access violation /
   client crash.** SC #1 ("object moves… zero restart") is unachievable on that target as written.
5. Worse, **05-12 Task 2 step 3 documents the wrong failure mode** ("advertised Scale silently no-ops at
   the resolver level") — so the UAT would misattribute the crash.

**Fix (consensus):** per-endpoint resolved-flag; seed `setScale = nullptr` and install the legacy literal
only when `!isAdvertisedClient()`; `applyWrite` calls `setScale` **only if non-null** (relax "never one
without the other"); 05-10/05-11 surface Scale as disabled-with-reason when the endpoint is unresolved on
the specific attached build; correct 05-12 step 3. This preserves D-09 intent (Scale works once the row is
added) without crashing before it is. Also widen 05-03's `user_setup`: the upstream row is a prerequisite
for **any** advertised-target write under the current unconditional `applyWrite`, not just Scale.

### 🔴 Agreed HIGH — Scale is a first-class write channel with NO guard and NO revert (all 4 reviewers)

`checkWriteGuard` (05-01 Task 2) compares only the 12 transform floats; `setScale` mutates `m_scale` +
appearance + extent independently of `Transform` (`Object.cpp:2205`). So an external scale change passes
the guard, the toolkit silently stomps it, and **"Revert ALL to snapshot" never restores attach-time
scale** (05-07 reverts transform using *current* scale). **Fix:** add `s_expectedScale[3]` to the guard,
COW snapshot, write-log, and revert; gate `setScale` on its own pass/fail.

### 🔴 HIGH — Guard-blocked banner needs a real `<addr>` the channel never carries (Sonnet; corroborated by Cursor/Opus on the "expected bytes" split)

The locked UI-SPEC copy is `Write refused. The object's memory changed outside the toolkit (<addr>:
expected <bytes>, read <bytes>)` with real values. **No `LiveState`/channel field carries an address**
(fields: seq, transform, networkId, templateName, liveness, cmd*, guardStatus). 05-11 hand-waves deriving
it client-side but only produces expected/got, never an addr → ships a placeholder or broken template.
**Additionally**, 05-11 derives "expected" from the attach-time `cowSnapshot`, but the agent guard baseline
*evolves* after each successful write (05-03 sets `s_expectedTransform = cmd.transform`) — so a mid-session
guard failure shows the **wrong expected bytes**. **Fix:** add a real address field to the channel (the
agent has the object pointer in scope); make 05-11 read "expected" from the last applied write, not the
snapshot.

### 🔴 HIGH — Guard false-fails on non-world-cell (interior) objects (Opus — corrects Cursor's "it's fine")

Divergence resolved by source trace: for a **world-cell** object `setTransform_o2w` stores the matrix
verbatim (`Object.cpp:1450-1458` → `Object.h:744-749`) so exact-compare passes on writes 2..N (Cursor was
right *for this case*). But for a **non-world-cell** object it stores `objectToCell = invert(cellToWorld)·
objectToWorld` (`Object.cpp:1460-1470`); the read-back differs from `cmd.transform` by float rounding →
exact compare **false-fails write N+1 and refuses all subsequent writes**. Same for any object the game's
own sim nudges between frames. **Fix:** after a successful apply, set `s_expectedTransform` from a fresh
`getTransform_o2w` read-back (what was actually stored), not from `cmd.transform` — keeps the exact-compare
D-03 invariant while tracking reality.

### 🔴 HIGH — Legacy networkId offset `+1432` is the wrong field (Codex)

05-03 Task 2 claims `playerCreature + 1432` is the legacy networkId; in Utinni `+1432` is the player
**look-at target** slot (`game.cpp:714`), not the object's own networkId (`object.h:80`). **Fix:** drop the
`+1432` implementation — keep legacy networkId *unavailable* rather than *wrong* — unless a correct
source-backed offset is found.

### 🔴 HIGH — Live gizmo always moves the player avatar, never the viewed mesh (Sonnet)

The agent poll loop resolves only `getPlayer()`; there is no object-selection/targeting mechanism in any
of the 12 plans. But 05-10 attaches the gizmo to "the currently-loaded viewport object" — which can be any
mesh (creature/item). Drag a gizmo on a non-player mesh while attached → the player's own avatar moves,
invisibly to the viewport. Nothing in CONTEXT/RESEARCH/UI-SPEC states this limitation or warns in HUD copy.
**Needs a maintainer scope decision** (is Phase-5 live-move player-only?) + honest HUD copy either way.

### 🟠 Agreed MEDIUM

- **05-09 STF UI plan still says "CRC32 auto on save" / "auto on save"** (Codex, `05-09:117,177`) — the
  D-10/D-11 errata fix reached the UI-SPEC and native 05-05 but **not** the 05-09 UI plan. Replace with
  `sourceCrc preserved / unset / explicit "mark re-synced to source"`.
- **ROADMAP SC1 "no allocation in the 60fps path" is only half-met** (Cursor) — the write path is
  zero-alloc, but the read path `useChannelReader` still allocates every RAF tick (`new Uint8Array(buf)`
  `:99`, `buf.slice()` `:54-56`). The 05-12 soak tests the write binding, not the renderer RAF loop.
- **Blocked guard also blocks its own revert** (Opus) — revert routes through the same guarded path; once
  blocked, all writes incl. revert are refused → object stuck until re-attach. SC #2 narrowed. **Fix:** let
  "Revert ALL" re-baseline the guard to current live bytes (explicit user action, still no forward
  force-write), or document re-attach as recovery.
- **Off-thread setter invocation is new & unproven** (Opus) — Phase 3 was read-only; Phase 5 writes object
  state from the `Sleep(16)` poll thread, racing the render/sim thread (`positionAndRotationChanged`
  recompute). Inherent to D-01, but unvalidated; 05-12 soak only covers host-side GC. Add a UAT watch item
  for crashes under sustained dragging.
- **`z(tableName)` DTII column can crash the edit widget** (Sonnet) — 05-06 groups `z(...)` with `e(...)`
  Enum for widget dispatch; running the `e(a=0,b=1)` label-map parser on a bare table name will misparse/
  throw on real fixtures. Special-case `z(...)` as read-only numeric.
- **DTII type-spec sub-parser (enum labels / bitvector / `[default]` suffix) has no task, artifact, or
  fixture** (Sonnet) — nontrivial `DataTableColumnType.cpp` chomp/getDelimStr porting hidden inline in the
  already-large 05-06 UI task, with zero fixture coverage. Carve it out as a tested module.
- **Hex-view per-cell byte offsets** (Surface-2 must-have) depend on a Wave-1 (05-02) native return shape
  that Wave-3 (05-08) "isn't sure exists" and defers to "a follow-up note" (Sonnet) — resolve the field in
  05-02 itself, not after it's complete.

### 🟡 Agreed LOW / hygiene

- No UAT/error-handling for **client crash or attach dropped mid-drag** (Sonnet, Opus).
- No user-facing error state for a **corrupted/malformed DTII or `.stf`** open (Sonnet).
- No **dirty-tab-close confirmation** in either typed editor (Sonnet).
- **High-contrast theme** verification has no task (Sonnet).
- **Universal (Q) gizmo mode** left with 3 divergent candidate implementations (Sonnet).
- DTII legacy **`FORM 0000`** re-emit not guarded (Opus) — serialize hardcodes `FORM 0001`.
- In-editor "Save · run gate" proves **idempotence, not fidelity** to original bytes for unedited cells
  (Opus) — low risk (float32↔64 exact), add a one-line assertion.
- `05-RESEARCH.md` Pattern-1 struct sketch is **stale (376 bytes, no `COMMAND_SCALE`)** — plans supersede
  it at 392 bytes; an executor reading only RESEARCH could pack fields wrong (Cursor).
- Missing `aria`/`role` parity on the Grid|Hex toggle and the client-card banners (Sonnet).
- ROADMAP SC2 wording implies Phase-4 `changesetService` integration; actual design is ephemeral
  in-memory revert — clarify (Sonnet).

### Divergences worth noting (the cross-check working)

- **Successive-drag guard:** Cursor concluded successive guarded drags work (agent evolves `s_expected`);
  Opus refined this — true for world-cell objects, **false** for interior objects (float-rounded read-back).
  Opus's source-traced version wins.
- **Severity of `setScale`:** Cursor/Sonnet framed it as "unconditional dual-setter, add a null guard";
  Codex/Opus escalated it to "crashes the advertised client on the first write of any kind." The escalated
  reading is source-verified and correct.

### Agreed strengths (2+ reviewers)

- Both format serializers faithfully reversed against real source (`.stf` `0xABCD` two-section +
  `sourceCrc`-verbatim; DTII 10→3 physical types via `getBasicType()`, `DT_Comment` a non-issue).
- The 05-01 fix replacing `sizeof(LiveState)-sizeof(LONG)` with a named `LIVE_READFRAME_BYTES=316` catches
  a real latent over-copy bug before it ships.
- The 392-byte command slot is a clean, non-overlapping, byte-identical-across-plans second seqlock in the
  same mapping; write path genuinely zero-alloc.
- Two-layer fixture gate (synthetic-committed + gitignored real-asset) correctly restored (05-02/05-05 T4).
- Shared GateBar/FailBanner built once and reused by the `.stf` sibling; D-05 offline erratum applied
  consistently in 05-10/05-11.

---

## Codex Review (repo-tracer / ground-truth angle)

**Summary**

The 12 plans are mostly faithful to the Phase 5 ground truth and should deliver the DTII/STF editor 
foundations well. The format plans match the real client source for DTII’s 3 physical encodings and 
STF’s `0xABCD` two-section layout. The main risk is in the live-write track: several plan details 
around Scale, advertised hook resolution, legacy networkId, and guard/revert semantics contradict 
the actual source or the locked scope. I would not execute these plans unchanged.

**Strengths**

- DTII plan correctly follows `getBasicType()` as the physical decoder boundary: client read/write 
dispatches only int/float/string, while `DT_Comment` is stripped by writer code.
- STF plan correctly rejects the old flat-table/ASCII-tag assumption: real source uses magic 
`0xABCD`, version byte, id-ordered string section, name-ordered map section, and verbatim 
`sourceCrc`.
- Plans add the right two-layer fixture pattern: committed synthetic fixtures plus gitignored 
real-asset lanes.
- The SAB command slot design stays in the same mapping and calls client setters rather than raw 
`WriteProcessMemory`.

**Concerns**

- **HIGH: advertised `setScale` fallback is unsafe, not a no-op.**  
  [05-03-PLAN.md](<D:/Code/SWG-Toolkit/.planning/phases/05-wysiwyg-live-sync-typed-editors/05-03-PLAN
.md:121>) says missing advertised `object::setScale` leaves the legacy RVA active. The resolver 
really does leave slots untouched on misses 
([resolve.cpp](<D:/Code/SWG-Toolkit/packages/live-inject/agent/resolve.cpp:64>)), and 
`engine_advertise.cpp` currently advertises `setTransform_o2w` but not `setScale` ([engine_advertise.
cpp](<D:/Code/swg-client-v2/src/game/client/application/SwgClient/src/win32/engine_advertise.cpp:568>
)). On swg-client-v2, calling legacy absolute VA `0x00B23A10` is not a graceful no-op; it risks 
calling the wrong code or crashing.

- **HIGH: legacy networkId offset is misidentified.**  
  [05-03-PLAN.md](<D:/Code/SWG-Toolkit/.planning/phases/05-wysiwyg-live-sync-typed-editors/05-03-PLAN
.md:98>) claims `playerCreature + 1432` is legacy networkId. In Utinni, `+1432` is explicitly the 
player look-at target slot, not the object’s own networkId 
([game.cpp](<D:/Code/Utinni/UtinniCore/swg/game/game.cpp:714>)). Utinni’s object wrapper has 
`networkId` at a different struct field 
([object.h](<D:/Code/Utinni/UtinniCore/swg/object/object.h:80>)). This would report the wrong ID.

- **HIGH: Scale is written but not guarded or reverted as first-class state.**  
  The real client’s `Object::setScale()` mutates `m_scale`, appearance scale, and extent 
independently of `Transform` ([Object.cpp](<D:/Code/swg-client-v2/src/engine/shared/library/sharedObj
ect/src/shared/object/Object.cpp:2205>)). But 
[05-01](<D:/Code/SWG-Toolkit/.planning/phases/05-wysiwyg-live-sync-typed-editors/05-01-PLAN.md:192>) 
only compares 12 transform floats, 
[05-03](<D:/Code/SWG-Toolkit/.planning/phases/05-wysiwyg-live-sync-typed-editors/05-03-PLAN.md:153>) 
calls `setScale` after that transform-only guard, and 
[05-07](<D:/Code/SWG-Toolkit/.planning/phases/05-wysiwyg-live-sync-typed-editors/05-07-PLAN.md:177>) 
reverts transform using the current scale. External scale changes would not fail closed, and “Revert 
ALL” would not restore attach-time scale.

- **MEDIUM: final UAT weakens locked scope for advertised Scale.**  
  [05-12-PLAN.md](<D:/Code/SWG-Toolkit/.planning/phases/05-wysiwyg-live-sync-typed-editors/05-12-PLAN
.md:88>) allows advertised Scale to become a follow-up, but the phase scope says both swg-client-v2 
and SWGEmu Scale are in scope, and the same plan’s success criteria require Scale on both targets ([0
5-12-PLAN.md](<D:/Code/SWG-Toolkit/.planning/phases/05-wysiwyg-live-sync-typed-editors/05-12-PLAN.md:
151>)).

- **MEDIUM: STF UI plan still has retired CRC copy.**  
  [05-09-PLAN.md](<D:/Code/SWG-Toolkit/.planning/phases/05-wysiwyg-live-sync-typed-editors/05-09-PLAN
.md:117>) and [05-09-PLAN.md](<D:/Code/SWG-Toolkit/.planning/phases/05-wysiwyg-live-sync-typed-editor
s/05-09-PLAN.md:177>) still say “auto on save” / “CRC32 auto,” contradicting the real `sourceCrc` 
preservation semantics verified in `LocalizedStringTableReaderWriter` ([LocalizedStringTableReaderWri
ter.cpp](<D:/Code/swg-client-v2/src/external/ours/library/localization/src/shared/LocalizedStringTabl
eReaderWriter.cpp:107>)).

**Suggestions**

- Require the `object::setScale` advertised hookpoint before 05-03 is considered complete, or 
explicitly null/gate `setScale` on advertised clients when the hook is unresolved. Do not leave a 
legacy RVA callable on advertised builds.
- Remove the `+1432` legacy networkId implementation unless a correct source-backed player networkId 
offset is found. Keep legacy networkId unavailable rather than wrong.
- Extend command state, guard state, COW snapshot, write log, and revert logic to include scale 
bytes. Guard `setScale` against attach-time/last-known scale exactly as transform is guarded.
- Make 05-12 a hard fail if advertised Scale is not working; record missing upstream hookpoint as a 
blocker, not a follow-up.
- Replace remaining STF “auto on save” copy with `sourceCrc preserved` / `unset` / explicit “mark 
re-synced to source.”

**Risk Assessment: HIGH**

Format-editor risk is medium-low after the current corrections. Live-write risk is high because the 
advertised Scale path can call an invalid legacy RVA, legacy networkId is sourced from the wrong 
field, and the guard/revert model does not cover Scale even though Scale is in scope.
---

## Cursor Review (channel-integrity angle)


## 1. Summary

The twelve plans are **architecturally sound** for the phase goal: they extend the existing Phase-3 file-mapping channel (not a second mapping) with a mirrored seqlock command region, wire guarded setter calls on the agent, expose `writeCommand` on the host, and sequence DTII/STF editors on a shared gate spine. The **392-byte layout is internally consistent** across 05-01 / 05-04 / 05-07, and 05-01 correctly fixes the load-bearing `channelWrite` over-copy bug in today's code. **Successive guarded drags will work** because 05-03 updates `s_expectedTransform` after each successful apply — but that **diverges** from D-03/RESEARCH wording and from 05-11's HUD "expected bytes" derivation (`cowSnapshot`), which would mis-report after the first successful write. The **write** path is genuinely zero-allocation per plan; the **read** poll loop is not, which may miss ROADMAP SC1 literally. Overall: plans are **executable and will likely close LIVE-03 + DATA-01/02**, with a handful of correctness gaps a checker should force-resolve before Wave 2 agent integration.

---

## 2. Strengths

- **Correct bidirectional seqlock design.** Read frame: agent `InterlockedIncrement → memcpy → InterlockedIncrement` (`channel.cpp:74-88`); host reads with odd-seq + torn-read retry (`useChannelReader.ts:48-73`). Write frame: host `WriteCommand` mirrors the same shape at offset 320 (`05-04-PLAN.md` Task 1); agent `channelReadCommand` is specified to mirror `parseChannelView` (`05-01-PLAN.md` Task 1). This is the right mirror of the existing protocol.
- **Catches a real regression before it ships.** Today `channelWrite` copies `sizeof(LiveState) - sizeof(LONG)` bytes (`channel.cpp:81-84`). Once `LiveState` grows, that **would stomp the command region**. 05-01's `LIVE_READFRAME_BYTES = 316` constant directly addresses this (`05-01-PLAN.md` Task 1; interfaces cite `channel.cpp:103-110`).
- **392-byte layout is non-overlapping and aligned across plans.**

  | Field | Offset | Length | Ends |
  |---|---:|---:|---:|
  | Read seq + frame | 0 | 320 | 320 |
  | `COMMAND_SEQ_COUNTER` | 320 | 4 | 324 |
  | `COMMAND_TRANSFORM` | 324 | 48 | 372 |
  | `COMMAND_SCALE` | 372 | 12 | 384 |
  | `COMMAND_FLAGS` | 384 | 4 | 388 |
  | `GUARD_STATUS` | 388 | 4 | 392 |

  Identical in `05-01-PLAN.md` Task 1, `05-04-PLAN.md` interfaces, and `05-07-PLAN.md` interfaces.
- **Single mapping discipline preserved.** No second `CreateFileMappingA`; host bumps `CHANNEL_BYTE_SIZE` 320→392 (`channel_binding.cpp:35-36`, `05-04-PLAN.md`); agent uses `sizeof(LiveState)` via `LIVE_STATE_BYTE_SIZE` (`agent_main.cpp:122`, `channel.h:42`).
- **Write-path zero-allocation is concretely specified.** `useCommandWriter.ts` module-level `Float32Array(12)` + `Float32Array(3)`, identity-tested across 100+ calls (`05-07-PLAN.md` Task 1); gizmo calls `writeTransform` imperatively (`05-10-PLAN.md` must_haves).
- **Guarded apply is single-gated.** `applyWrite` only inside `checkWriteGuard(...).passed` (`05-03-PLAN.md` Task 2 behavior + acceptance grep criteria); no force-write path (`05-11-PLAN.md`, D-03).
- **Latest-wins command dedup.** `cmdSeq` vs `lastAppliedCmdSeq` prevents re-applying stale commands (`05-03-PLAN.md` Task 2 behavior) — matches D-02 single-slot semantics.
- **DTII/STF tracks honor ground truth.** 3 physical DTII encodings + two-layer fixtures (`05-02-PLAN.md`); STF two-section layout + `sourceCrc` preserve (`05-05`, `05-09`); wave deps (DTII spine → STF sibling) are sensible.

---

## 3. Concerns

### Channel-integrity (primary angle)

| Severity | Concern |
|---|---|
| **HIGH** | **STOP_REQUESTED can be starved when `player == nullptr`.** `agent_main.cpp` early-continues on null player (`agent_main.cpp:137-141`) *before* any command read. 05-03's action says stop is "FIRST after computing player," but behavior nests stop inside post-`channelWrite` command handling. Detach while the world isn't loaded → poll thread may spin on `Sleep(100)` and never observe `STOP_REQUESTED` → violates D-04.1 clean stop. |
| **HIGH** | **Guard "expected bytes" UI ≠ agent guard semantics after first write.** Agent compares live transform to **evolving** `s_expectedTransform`, updated on each success (`05-03-PLAN.md` Task 2: `update s_expectedTransform = cmd.transform`). Renderer `cowSnapshot` is **attach-once** (`05-07-PLAN.md` Task 2; D-03). 05-11 derives blocked-banner "expected" from `cowSnapshot`, not last-known-good (`05-11-PLAN.md` Task 1 lines 177-179). After drag #1 succeeds, an external tamper block would show **wrong expected bytes** in the HUD while the agent guard is correct. |
| **MEDIUM** | **D-03 / RESEARCH pseudocode still says attach-time `cowSnapshotBytes`.** `05-RESEARCH.md` Pattern 1 pseudocode (`memcmp(liveBytes, cowSnapshotBytes, ...)`) contradicts 05-03's evolving expected. Implementation will work for successive drags; **documentation and UI** will not unless reconciled. |
| **MEDIUM** | **ROADMAP SC1 "no allocation in the 60fps path" is only half-met.** Write path: zero-alloc (`05-07`). Read path: `useChannelReader` still allocates every RAF tick — `new Uint8Array(buf)` (`useChannelReader.ts:99`) and `buf.slice()` for transform (`useChannelReader.ts:54-56`). No plan task optimizes this; 05-12 soak tests GC on `writeCommand`/`readChannelView`, not the renderer RAF loop. |
| **MEDIUM** | **`applyWrite` calls both setters unconditionally with no null checks.** 05-03 requires `setTransform_o2w` + `setScale` every apply. `setScale` is **not** in `engine_advertise.cpp` today (grep: only `setTransform_o2w` at `:578`/`:850`). Legacy RVAs exist (`Utinni/object.cpp:148,155`), but a partial-resolve or fenced build could null-deref. Plans document upstream `user_setup` for advertised `setScale` but not a runtime guard before call. |
| **MEDIUM** | **`checkWriteGuard` compares transform only, not scale.** Full command carries scale (`05-01`); guard ignores `cmdScale`. External scale-only mutation would pass guard; next write overwrites scale from (possibly stale) renderer values. |
| **LOW** | **`GUARD_STATUS` is written via `InterlockedExchange`, read by JS without seqlock** (`05-01` Task 1). Acceptable for a single `uint32_t` on x86, but host could theoretically observe a torn value if layout ever widens — not an issue at 4 bytes. |
| **LOW** | **05-RESEARCH Pattern 1 example is stale (376 bytes, no `COMMAND_SCALE`, `cmdFlags` at 372).** Plans supersede it (392 with scale at 372), but an executor reading only RESEARCH could pack fields wrong. |
| **LOW** | **Memory ordering is implicit.** Plans rely on `InterlockedIncrement` (same as Phase 3). No `std::atomic` — fine on Win32/x86 for this seqlock; worth a one-line comment in `channelReadCommand` for parity with `channel.cpp:9-15`. |

### Cross-track / dependency

| Severity | Concern |
|---|---|
| **MEDIUM** | **Wave 2 agent integration (05-03) before host export (05-04) is fine for native build, but 05-07 needs both.** Dependency graph is correct; no circularity. |
| **MEDIUM** | **05-10 gizmo doesn't gate writes on `guardState === 'blocked'`.** Writes still fire; agent refuses. Functional but wastes channel traffic; 05-11 says no force-write (good) but doesn't require write suppression in gizmo. |
| **LOW** | **Scale source on Move/Rotate drags not explicit in 05-10.** Must pass current scale from `verifiedState` on every `writeTransform` or risk resetting scale — implied by 05-01 "full target state" but not a 05-10 acceptance criterion. |

---

## 4. Suggestions

1. **05-03: Read command slot (incl. `STOP_REQUESTED`) at the top of the loop, before the `player == nullptr` continue.** Honor stop even when the world isn't loaded; then `channelClose(); return 0`. Resolves the HIGH stop-starvation bug.
2. **Reconcile guard semantics in one sentence across 05-CONTEXT D-03, 05-RESEARCH Pattern 1, 05-11:** agent guard uses **last successful toolkit write** (initialized from attach-time read); renderer `cowSnapshot` is **revert baseline only**. Update 05-11 blocked banner to show `writeLog[last]?.resultingTransform ?? cowSnapshot` as expected, or add `lastKnownGoodTransform` to `liveStore` updated when `guardState` flips to `'ok'` after apply.
3. **05-03 `applyWrite`: guard both fn pointers** — if `!setTransform_o2w || !setScale`, set `GUARD_FLAG_WRITE_REFUSED` and skip (graceful degrade per Phase-3 `resolve()` contract).
4. **05-01 / `channel.cpp`: update `static_assert(sizeof(LiveState) == 320)` → `392`** explicitly (plan adds field asserts but doesn't name the size assert line).
5. **05-07 or 05-12: add a read-path allocation budget** — e.g. reuse one `Float32Array(12)` in `parseChannelView` via `DataView` + manual copy instead of `buf.slice()`, and drop per-frame `new Uint8Array(buf)` for HexInspector if SC1 is literal.
6. **05-10 acceptance: every `writeTransform` includes scale from `verifiedState`** (or last applied scale ref), especially in Move/Rotate modes.
7. **05-04: mirror offsets as named `constexpr` in C++** (not magic `320`/`324` literals only) to match `LIVE_CHANNEL_LAYOUT` and survive future edits.
8. **Executor note: ignore 05-RESEARCH's 376-byte struct sketch; 05-01's 392-byte layout is authoritative.**

---

## 5. Risk Assessment

**Overall: MEDIUM**

**Justification:** The channel extension is the hardest part of LIVE-03, and the plans get the core mechanics right — mirrored seqlock, fixed read-frame span, single mapping, latest-wins dedup, and evolving agent-side expected transform (so **two successive successful drags will not false-fail the guard**). Verified against existing code:

```69:88:packages/live-inject/agent/channel.cpp
void channelWrite(const LiveState* state) {
    ...
    InterlockedIncrement(seq);
    std::memcpy(
        static_cast<char*>(s_view) + sizeof(LONG),
        &state->transform,
        sizeof(LiveState) - sizeof(LONG)   // ← must become LIVE_READFRAME_BYTES (316)
    );
    InterlockedIncrement(seq);
}
```

```48:73:packages/renderer/src/hooks/useChannelReader.ts
  const seq1 = view.getUint32(L.SEQ_COUNTER.offset, true);
  if ((seq1 & 1) !== 0) return null;
  // ... payload read ...
  const seq2 = view.getUint32(L.SEQ_COUNTER.offset, true);
  if (seq1 !== seq2) return null;
```

The write mirror in 05-04 (`InterlockedIncrement` at 320 → payload → `InterlockedIncrement`) is structurally correct. Risk stays **MEDIUM** (not LOW) because of: (1) stop-signal starvation on null player, (2) guard UI/semantics split after first write, (3) unconditional dual-setter calls without null guards, (4) read-path allocations vs SC1 wording, and (5) external `engine_advertise.cpp` work for advertised `setScale`. None are plan-fatal if fixed during Wave 2; DTII/STF tracks look lower-risk and well-grounded.

---

## Channel-Integrity Answers (Concrete)

### Is the write direction a correct mirror of the existing seqlock read protocol?

**Yes, by design.** Existing: agent odd→payload→even (`channel.cpp:74-88`); host odd-check + torn-read retry (`useChannelReader.ts:48-73`). Proposed: host odd→payload→even at offset 320 (`05-04-PLAN.md` Task 1); agent `channelReadCommand` with same retry idiom (`05-01-PLAN.md` Task 1, citing `useChannelReader.ts`). `InterlockedIncrement` provides adequate publication ordering on Win32 — same primitive both sides. No separate dirty-flag call needed (matches locked ground truth #1; 05-03 calls setters only).

### Is the ~392-byte layout non-overlapping and byte-identical across 05-01 / 05-04 / 05-07?

**Yes.** All three specify: 320/4, 324/48, 372/12, 384/4, 388/4, total 392. Arithmetic: 320+4+48+12+4+4 = 392; read frame ends at 320; command region starts at 320. **Critical:** until 05-01 lands, growing `LiveState` without fixing `channelWrite` byte count would **overlap** command into read-frame writes (`channel.cpp:81-84`).

### Is the 60fps write path genuinely zero-allocation?

**Write path: yes, as specified.** `preallocTransform` / `preallocScale` at module scope (`05-07-PLAN.md` Task 1); `writeCommand` does in-place `memcpy` on the mapped view (`05-04-PLAN.md`); no per-drag `Float32Array` creation (05-10 must_haves). **Full 60fps loop: no** — `useChannelReader` still allocates per frame (`useChannelReader.ts:99`, `:54-56`). That predates Phase 5 and isn't addressed in these plans.

### Does the read-verify guard work across two successive successful drags?

**On the agent: yes**, with 05-03's evolving expected:

1. Attach: `s_expectedTransform ← T₀` (first sentinel-passing read, `05-03-PLAN.md` Task 2).
2. Drag 1 command `T₁`: live `T₀` == expected `T₀` → pass → apply → `s_expectedTransform ← T₁`.
3. Drag 2 command `T₂`: live `T₁` == expected `T₁` → pass → apply → `s_expectedTransform ← T₂`.

**If guard always used attach-time snapshot** (D-03 literal / RESEARCH pseudocode): drag 2 would compare live `T₁` vs expected `T₀` → **false block**. Plans wisely avoid that on the agent, but **05-07 `cowSnapshot` + 05-11 HUD still behave attach-time**, so observability and revert semantics can disagree with the actual guard after write #1 — fix per Suggestions §2.
---

## Sonnet Review (lateral / blind-spots angle)

*Angle: lateral / blind-spots (out-of-the-box, non-byte-level).*

## Summary

The 12-plan, 6-wave decomposition is well-engineered at the level it was designed for: the wave/dependency graph is internally consistent, the shared UI components (GateBar/FailBanner/editorTabs) are genuinely built once and reused, and the byte-exact gate is enforced as a hard invariant (not just described) at both the native and UI layers. However, stepping back from byte-level correctness, several cross-plan gaps surface that a format-focused reviewer would likely miss — most importantly, the read-verify guard (the safety mechanism the whole phase's "no force-write" promise rests on) silently does not cover the Scale channel, and the guard-blocked banner's locked copy requires a real memory address that no plan ever wires through the channel. There's also an unreconciled ambiguity about what "the object" actually is (always the player avatar, never the mesh you're viewing). These are real defects a plan-checker focused on internal consistency and UI-SPEC coverage would plausibly pass.

## HIGH concerns

1. **The read-verify guard never covers Scale, contradicting locked axiom 4.** `checkWriteGuard` (05-01 Task 2) takes only `float liveXform[3][4]`/`expectedXform[3][4]` — no scale snapshot or comparator anywhere. Yet 05-03 Task 2 calls both setters "unconditionally" on a transform-guard pass. If something external changes the live object's scale between writes, the guard (which only inspects the transform) still passes, and the toolkit silently stomps the externally-set scale with its own stale value. Scale is an entire write channel operating with no fail-closed protection.
2. **No plan ever puts a memory address on the channel, yet the locked banner copy requires one.** The UI-SPEC Copywriting Contract mandates `Write refused. The object's memory changed outside the toolkit (<addr>: expected <bytes>, read <bytes>)` with "real values in mono." `LiveState`'s full field list (seqCounter/transform/networkId/templateName/liveness + cmdSeqCounter/cmdTransform/cmdScale/cmdFlags/guardStatus) has no address field. 05-11 Task 1 hand-waves deriving it client-side but only produces expected/got, never an address → ships a placeholder or broken template.
3. **The guard-blocked banner's "expected" bytes will be wrong after the first successful write.** 05-11 derives the banner "expected" from `cowSnapshot` (attach-time), but 05-03 Task 2 updates the comparison baseline after every successful write (`s_expectedTransform = cmd.transform`). So a real guard failure on write #6 was checked against write #5's transform, not the original pose — the banner shows the wrong "expected" in exactly the scenario it exists to explain.
4. **`z(tableName)` DTII columns risk a parse crash in the edit widget, not just a UI nuance.** 05-06 Task 2 groups `z(...)` with plain `e(...)` Enum for badge/widget dispatch without special-casing `z(tableName)`'s syntax (bare table name, no `key=value`) against the `e(a=0,b=1,...)` label-map parser. Run the enum-label parser on a `z(...)` string and it misparses or throws on real fixtures.
5. **The live write target is always "the player," never "the object you're viewing" — and nothing reconciles this.** The agent poll loop (inherited from Phase 3) resolves only `getPlayer()`. No object-selection/targeting mechanism in any of the 12 plans. 05-10 attaches the gizmo to "the currently-loaded viewport object" — which can be any mesh. Drag a gizmo on a non-player mesh while attached live and the visible mesh does not move — the player's avatar moves, invisibly. Nothing states this limitation; a fresh user absolutely hits it.

## MEDIUM concerns

6. DTII type-spec semantic sub-parser (enum labels, bitvector flags, `[default]` suffix) has no dedicated task/artifact/fixture — nontrivial `DataTableColumnType.cpp` chomp/getDelimStr porting hidden inline in 05-06 Task 2 with zero fixture coverage.
7. Hex-view cell-highlighting (Surface-2 must-have) depends on a Wave-1 native binding shape that Wave-3 (05-08 Task 1) "isn't sure exists" and defers to "a follow-up note" — no clean mechanism to amend a completed Wave-1 artifact; risk it ships fabricated or missing.
8. No plan/UAT tests "client crash / attach dropped mid-drag." 05-12's GC-soak only exercises the write-channel binding lifecycle, not the injected process disappearing mid-write.
9. No user-facing error handling for a corrupted/malformed real DTII or `.stf` — parsers throw (good) but the VfsTree double-click→parse→open-tab flow (05-08/05-09 Task 3) never mentions try/catch or an error-state UI.
10. No dirty-tab-close guard in either typed editor — silent data loss on tab close.
11. UI-SPEC "verify all three surfaces under high-contrast theme" has no corresponding task.
12. "Universal (Q)" gizmo mode left with three materially different candidate implementations (05-10 Task 1) — a UI-SPEC-locked user-facing mode left to executor discretion.

## LOW

13. `aria-pressed`/`radiogroup` explicit for GizmoModeRail but not the Grid|Hex toggle. 14. Client-card banners not explicitly required to carry `role="alert"`/`status`. 15. ROADMAP SC2 wording implies Phase-4 `changesetService` integration; actual design is ephemeral in-memory. 16. Real-asset fixture gate depends on maintainer-local paths (can't run in CI) — Phase-1 precedent, worth re-flagging. 17. No in-flight guard on "Save · run gate" against a double-click race.

## Risk: MEDIUM-HIGH

Structure/sequencing/shared-component discipline are solid — not a decomposition problem. But two HIGH findings (unguarded Scale channel; guard banner data provenance) sit directly on the phase's core safety promise, and both would only surface during real in-world UAT (05-12) — potentially after the maintainer already spent time on the other 11 plans. Fixing items 1–5 before/during execution (not after 05-12) brings this to LOW.

---

## Opus Review (spec-correctness / invariants angle)

*Angle: spec-level achievability / math & invariants. Verified against real client source in `../swg-client-v2` and the existing agent code in `packages/live-inject`.*

## Summary

For the **happy path**, the success criteria are achievable: the two format round-trip gates are faithfully reverse-engineered against the real serializers (both writers re-verified line-by-line), and the 60fps zero-alloc write channel is a clean, correct extension of the proven Phase-3 seqlock. However, **one HIGH-severity correctness defect makes SC #1 unachievable on the advertised (swg-client-v2) target as planned**: the plans repeatedly assume an unresolved `object::setScale` "gracefully no-ops," but the resolver contract leaves a **stale legacy RVA literal** in the slot, and `applyWrite` calls `setScale` **unconditionally on every write** — so the first Move/Rotate drag on the advertised build calls a wrong/likely-unmapped address and crashes the client. Two further guard-invariant concerns affect successive writes to non-world-cell objects and the revert path's ability to recover from a blocked guard.

## Strengths

- Both format serializers faithfully reversed. `.stf` save order confirmed magic → version → `next_unique` → `num_entries` → id-ascending string section → name-ascending name section (`LocalizedStringTableReaderWriter.cpp:309-324` + `:145-203` + `str_write` `:107-141`); `sourceCrc` written verbatim (`:112,118`). 05-05 Task 1's "preserve parse order, never re-sort, never recompute sourceCrc" reproduces this exactly. DTII matches `DataTableWriter.cpp` COLS/TYPE/ROWS (`:821-912`).
- The "preserve source order → identity round-trip is trivial" insight (05-05) is correct: the client re-sorts both sections into `std::map`s on load, so on-disk order is cosmetic to the engine; a toolkit that preserves read order is byte-exact by construction and still loads. Angle #1's "id-order vs name-order divergence" risk is genuinely closed.
- Command channel is a clean second seqlock in the same mapping (counters at 0 and 320, no shared-write contention; `guardStatus` at 388 is a single aligned word via `InterlockedExchange`, no torn read). The 05-01 `LIVE_READFRAME_BYTES=316` fix genuinely prevents the read-frame write from stomping the command region — a real latent bug caught.
- Zero-alloc path correctly specified (05-07: two module-level `Float32Array`s reused for process lifetime; identity-check test). Latest-wins single slot with seqlock retry-read has no lost-update hazard (final pose wins by design).
- D-05 offline-gizmo erratum applied consistently (05-10/05-11). Two-layer fixture gate correctly restored (05-02/05-05 T4).

## HIGH — `setScale` on the advertised build calls a stale legacy address; crashes on the first write

The "gracefully no-ops" assumption is false given the real resolver contract:
- `resolve()` overwrites a slot only when the name is found; a missing name leaves the RVA literal **untouched** (`resolve.h:43-52`).
- 05-03 Task 1 seeds `setScale = (pSetScale)0x00B23A10` — a legacy SWGEmu RVA. Endpoints with no legacy address (`getNetworkId`, `g_mainLoopCounter`, `g_runningFlags`) are seeded `nullptr` (`rva_table.cpp:69,78,89`) precisely so a null-check disables them. `setScale` is seeded non-null, so it can never be null-checked away.
- `object::setScale` is **absent** from the advertised catalog while `object::setTransform_o2w` is present (`engine_advertise.cpp:578/850`). On advertised swg-client-v2 the `setScale` slot stays at `0x00B23A10` — a legacy address in a different, freshly-compiled binary → wrong function or unmapped page.
- 05-03 Task 2 calls both setters unconditionally on every guard-passing write ("never one without the other") → fires on **every Move/Rotate drag**, not just Scale mode.

Net: on the advertised target, before the upstream `engine_advertise.cpp` row is added, the first live write of any kind → almost certainly an access violation / client crash. Baked in three places: 05-03 Task 2 acceptance; **05-12 Task 2 step 3 states the wrong failure mode** ("Scale on the ADVERTISED target is expected to silently no-op… per the graceful-degrade contract" — it will not no-op); 05-10 truth ("Scale mode… never disabled-with-reason on either in-scope target"). **Fix:** per-endpoint resolution — seed `setScale=nullptr`, install the legacy literal only when `!isAdvertisedClient()`, leave null on advertised if unresolved; `applyWrite` calls `setScale` only if non-null (relax "never one without the other"); 05-10/05-11 show Scale disabled-with-reason when unresolved on that build.

## MEDIUM/HIGH — Read-verify guard false-fails on successive writes to non-world-cell objects

The guard compares live bytes to `s_expectedTransform` and after success sets `s_expected = cmd.transform` (the value sent) with an **exact** float compare (05-01/05-03). Safe only when the client stores the o2w verbatim. Traced: for a **world-cell** object `setTransform_o2w` short-circuits to `setTransform_o2p` → `m_objectToParent = new…Transform` verbatim (`Object.cpp:1450-1458` → `Object.h:744-749`) → read-back byte-identical → passes on writes 2..N (good). But for a **non-world-cell** object it stores `objectToCell = invert(cellToWorld)·objectToWorld` (`Object.cpp:1460-1470`); the reconstructed o2w read next frame differs from `cmd.transform` by float rounding → exact compare **false-fails write N+1** and refuses all subsequent writes. Same for any object the sim nudges between frames. **Fix:** after a successful apply, set `s_expectedTransform` from a fresh `getTransform_o2w` read-back (what was actually stored), not from `cmd.transform` — keeps exact-compare while tracking reality.

## MEDIUM — A blocked guard also blocks its own remediation (revert)

`revertWrite`/`revertAll` route through the same guarded `writeTransform` path (05-07 Task 2, correctly per T-05-14). But once the guard is blocked (live ≠ `s_expected`), the agent refuses all writes including the revert (no path re-syncs `s_expected` except the one-time attach capture). So the object is stuck un-writable until re-attach; combined with the previous concern, an interior object that false-blocks after write 1 cannot even be reverted. SC #2 ("a bad live write can be reverted") holds for a sequence of the toolkit's own writes on a world object, but not once the guard trips. **Fix (preferred):** let "Revert ALL to snapshot" carry a flag that re-syncs `s_expected` to current live bytes before applying (explicit user re-baseline, still no silent forward force-write); or document re-attach as the recovery path in the UI.

## MEDIUM — Off-thread setter invocation is new and unproven

Phase 3 was read-only. Phase 5 writes object state from the poll thread (`Sleep(16)`), not a game-mainloop hook. Calling `setTransform_o2w`/`setScale` — which fire the notification list and recompute o2w (`positionAndRotationChanged`) — from a non-game thread races the render/sim thread on the same object. Inherent to locked D-01, not a plan defect, but unvalidated and uncalled-out. 05-12 soak only covers host-side GC/channel lifetime. **Fix:** add a UAT watch item for intermittent crashes under sustained dragging; consider (future) applying writes from a per-frame hook.

## LOW

- DTII legacy `FORM 0000` re-emit not guarded (05-02 hardcodes re-emitting `FORM 0001`); struct carries `version` but no fixture/acceptance guards the `0000` case. Emit the version actually read, or explicitly scope out `0000`.
- In-editor "Save · run gate" (05-08) proves idempotence (two serializations equal), not fidelity of **unedited** cells to the original bytes. float32↔64 is exact so risk is low and the CORE-05 raw-asset gate catches non-idempotent parsing; add a one-line assertion that unedited cells serialize to their original bytes.
- The client's own save runs `unfubarMicrosoftInvalidTextCharacters` on strings (`LocalizedStringTableReaderWriter.cpp:290-292`); the toolkit's `serializeStf` won't. Fine (real on-disk assets are already unfubar'd; the gate is toolkit-parse→toolkit-serialize identity), but never compare toolkit output against a *client-resaved* file expecting equality.

## Risk: MEDIUM-HIGH

Format tracks (DATA-01/02) LOW. Live-write (LIVE-03) carries the HIGH `setScale` crash (SC #1 unachievable on advertised as written) plus two MEDIUM guard-invariant defects that narrow SC #2 to world-cell objects. All concentrated in 05-03 and its UI/UAT reflections (05-10/11/12), fixable with small well-scoped changes to the resolution model and the guard's baseline update — none require re-architecting the channel. With those fixes, risk drops to LOW-MEDIUM.

Key files verified: `Object.cpp:1450-1471`, `Object.h:744-749`, `engine_advertise.cpp:578/850`, `LocalizedStringTableReaderWriter.cpp:107-203,309-324`, `DataTableWriter.cpp:821-912`; `packages/live-inject/agent/rva_table.cpp`, `resolve.h`.
