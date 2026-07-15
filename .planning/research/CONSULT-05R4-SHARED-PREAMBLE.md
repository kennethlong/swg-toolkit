# Phase 05 round-4 review — SHARED PREAMBLE (locked ground truth + claimed round-4 changes)

You are one of four INDEPENDENT reviewers of a plan replan. Do NOT trust the plan's own
self-assessment prose. Verify every claim against the REAL source files cited below. A productive
*disagreement* grounded in source is more valuable than agreement.

## What changed and why (context, treat as background — not as truth to accept)

Phase 05 joins a viewport gizmo + an injected x86 agent into a zero-restart WYSIWYG write loop over a
SharedArrayBuffer channel (plus two typed IFF editors not under review here). A round-3 cross-AI review
found the prior replan landed its fixes but its two headline changes each opened a NEW provable HIGH,
plus one unmet-intent HIGH. The maintainer decided five fixes; a round-4 replan CLAIMS to have applied
them. Your job: confirm each is REAL and correct in the plan text + against source, or find where it
still fails.

## LOCKED ground-truth axioms — do NOT re-derive or contradict (verified by Codex in round 3 vs real source)

1. Advertised (swg-client-v2) targeting catalog rows EXIST at these lines in
   `D:/Code/swg-client-v2/src/game/client/application/SwgClient/src/win32/engine_advertise.cpp`:
   `cuiHud::getTarget` (:703, thunk `engine_hudGetLastSelectedObject` :374-377), `cuiHud::g_instance`
   (:704), `network::getObjectById` (:707 → NetworkIdManager::getObjectById). Catalog KEY must be the
   exact string `cuiHud::getTarget`.
2. Legacy (Utinni) RVAs in `D:/Code/Utinni/UtinniCore/swg/`:
   `idManagerGetObjectById=0x00B380E0` (misc/network.cpp:39 literal, :32 typedef, `__cdecl const int64_t&`);
   `cachedNetworkIdGetObject=0x00B30160` (misc/network.cpp:42 literal, :35 typedef, `__thiscall`);
   `+1432` player-lookAt-target slot (game/game.cpp:733, a CachedNetworkId ptr in the CreatureObject);
   `setTransform_o2w=0x00B22CC0` (object/object.cpp:148); `setScale=0x00B23A10` (object/object.cpp:155).
   Utinni gates the advertised lookAt path off (`getPlayerLookAtTargetObjectNetworkId` returns 0 when
   `isAdvertisedClient()`, game.cpp:721-724).
3. 396-byte channel layout (contract in `packages/contracts` / `contracts/live-inject.ts`, native
   `channel.h`): read-frame [4..319] (`LIVE_READFRAME_BYTES=316`); host write [320..387]
   (cmdSeq 320 / transform 324 / scale 372 / flags 384); agent guard [388..395]
   (GUARD_STATUS 388, GUARD_ADDR 392). 05-01 lands the growth to 396; it is authoritative over any stale
   320-byte comment.
4. `kLegacyScaleOffset = 0x44` is a PLANNER-COMPUTED candidate (summed member sizes from Utinni
   `object.h:76-107`), NOT disassembly-measured — it is explicitly flagged "VALIDATE LIVE". Verify only
   that the derivation logic is sound; do NOT treat 0x44 as ground truth.
5. Liveness bit4 `scaleUnavailableOnBuild` / bit5 `scaleGuardUnavailableOnBuild` are "computed once
   after resolve" and that is SAFE (inputs immutable post-init). Do not flag it.

## The five round-4 changes CLAIMED applied (VERIFY each against the plan text + real source)

1. **Baseline re-key on focus change** — 05-03 (agent): a static `s_expectedCapturedAgainst` (raw void*)
   compared to the freshly-resolved `focus` each iteration; on mismatch `s_expectedCaptured=false` (re-arm
   the first-sentinel capture) then `s_expectedCapturedAgainst=focus`. 05-07 (host): `cowSnapshot` gains
   `networkId`/`templateName`; on focus-identity change it re-captures + resets `writeLog`/`guardState`/
   `lastDiscardedChange`. Intent: restore locked D-03 "snapshot per object (once)".
2. **Gated + unified rebaseline** — 05-03: the REBASELINE mutation moved LEXICALLY inside the
   `cmdSeq != lastAppliedCmdSeq` (seq-new) + non-torn guard (once-per-command, atomic with apply); BOTH
   channels rebaseline to the LIVE value at that instant (scale via the `m_scale` member-offset read,
   replacing the old `cmd.scale` pin). A line-order (`grep -n`) acceptance criterion is claimed.
3. **Targeting honesty (option a)** — 05-11: inline `⚠ viewing <loaded>, moving <target>` warning when the
   loaded viewport asset name ≠ `verifiedState.templateName` (pure disclosure, no gate). 05-03: the
   self-contradicting "closes the round-1 finding" note rewritten to "makes the fallback real/symmetric
   on both builds; viewport↔live binding deferred to Phase 7 `.ws`". 05-12: a DELIBERATE-MISMATCH UAT step
   replaces the old gap-hiding "object matching the live focus object" wording. 05-10/05-12: LIVE-03
   language softened.
4. **Off-thread UAF mitigation (accept-watched + mitigate)** — 05-03: a `__try/__except` SEH block spans
   the ENTIRE resolve→read→apply span (both builds' focus chains incl. the advertised two-step
   `hudInstance` window); an access violation degrades to one skipped frame + a transient liveness bit6
   `agentFaultRecovered`, never a client crash. 05-12: UAT watch item names the SEH bound + the
   `hudInstance` window.
5. **Wiring gaps + minors** — 05-01: STOP sticky bit `GUARD_FLAG_STOPPING` (GUARD_STATUS bit 0x4), zero
   channel growth (396 stays 396); 05-03: agent publishes it before `channelClose()`. 05-07: explicit
   `GUARD_ADDR` (offset 392) decode + a synthetic `0xDEADBEEF` test; `lastDiscardedChange` reshaped
   per-channel `{addr, transform?, scale?}`; bit5 documented agent-only-until-handoff; `detachUI`
   retry-loop polling the STOPPING bit. Citation fix: `cachedNetworkIdGetObject` literal at network.cpp:42
   (typedef :35); Utinni path prefixes `swg/misc/network.cpp`, `swg/game/game.cpp`, `swg/ui/cui_manager.cpp`.

## Files to read
- Plans: `.planning/phases/05-wysiwyg-live-sync-typed-editors/05-01-PLAN.md`, `05-03-PLAN.md`,
  `05-04-PLAN.md`, `05-07-PLAN.md`, `05-10-PLAN.md`, `05-11-PLAN.md`, `05-12-PLAN.md`
- Locked decisions: `.../05-CONTEXT.md` (D-01..D-12). Round-3 findings + maintainer decisions:
  `.../05-REVIEWS.md`.
- Real source: the Utinni + swg-client-v2 paths cited above.

## Output
A markdown review with: per-change VERDICT (CLOSED / STILL-OPEN / NEW-ISSUE) with the exact plan
line or source line that proves it, severity (HIGH/MEDIUM/LOW) for anything not closed, and an overall
risk verdict. Ground every claim in a file:line. If you cannot verify against source, say so — do not
infer from the plan's prose.
