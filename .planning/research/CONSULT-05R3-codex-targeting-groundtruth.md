# Cross-AI Plan Review — Phase 5, ROUND 3 — CODEX angle (repo tracer / ground truth)

You are one of four independent reviewers of an implementation plan for a Star Wars Galaxies modding
toolkit. Your job: verify the plan's **ground-truth source claims** against the real code — do NOT
trust the plan's own self-assessment prose. A plan that cites a source line is only correct if that
line actually says what the plan claims.

## What this phase does (brief, treat as given)
Phase 5 joins a 3D viewport transform gizmo (Phase 2) with a live memory-injection agent (Phase 3)
into a zero-restart "move an object in-game live" write loop, plus two typed IFF editors (DTII
datatable grid, `.stf` strings). The live agent is an x86 DLL injected into the running SWG client
that calls the client's own setters in-process (harvested from Utinni / advertised via a hookpoint
catalog), communicating with the toolkit over a SharedArrayBuffer channel.

## The plans to read (this is a re-review of an uncommitted replan)
Read these in full from the repo:
- `.planning/phases/05-wysiwyg-live-sync-typed-editors/05-03-PLAN.md` (agent write path + targeting + guard — the big one)
- `.planning/phases/05-wysiwyg-live-sync-typed-editors/05-10-PLAN.md` (gizmo→viewport binding)
- `.planning/phases/05-wysiwyg-live-sync-typed-editors/05-CONTEXT.md` (decisions D-01..D-12)

## Prior-round context (round 2 raised these; the replan claims to have addressed them)
Round 2's headline finding: the previous targeting mechanism moved "the player's in-game look-at
target" (legacy-only, via a `getPlayerCreatureObject()+1432 → cachedNetworkIdGetObject` chain) — an
object generally **unrelated** to the mesh loaded in the toolkit's viewport. The maintainer chose to
**pursue the stronger cross-build path** the prior Codex round surfaced. The replan now claims:
- An arbitrary `NetworkId → Object*` resolver exists on **both** builds: legacy `idManagerGetObjectById`
  (RVA `0x00B380E0`, Utinni `network.cpp:39`) and advertised `NetworkIdManager::getObjectById`
  (catalog row `engine_advertise.cpp:707`, impl `NetworkIdManager.cpp:72-79`).
- The **advertised** build additionally has a direct viewed/picked-object path:
  `SwgCuiHud::getLastSelectedObject()` (`engine_advertise.cpp:703-704`), wrapped by Utinni as
  `CuiManager::getSelectedObject()` (`cui_manager.cpp:183-205`).
- The replan asserts THREE catalog rows are "ALL THREE already present in the maintainer's current
  engine_advertise.cpp": `network::getObjectById` (:707), `cuiHud::getTarget` (:703, a `__fastcall`
  thunk over `SwgCuiHud::getLastSelectedObject`, name-mismatched in the catalog), and
  `cuiHud::g_instance` (:704, `SwgCuiHudFactory::findMediatorForCurrentHud`).
- Advertised build now calls `getSelectedObject()`; if non-null, `focus = that object`.
- Legacy keeps the `+1432` CachedNetworkId chain; the replan CORRECTS a prior false claim ("legacy has
  no independent networkId source") and re-cites `cachedNetworkIdGetObject` from `network.cpp:39,42`
  to `network.cpp:35`, and the +1432 chain as `game.cpp:733 → 745 → object.cpp:260-268 → network.cpp:84`.

## Your task (Codex — ground truth)
Read the REAL source and adjudicate each claim above. Ground-truth references (read access):
- `D:/Code/swg-client-v2/src/game/client/application/SwgClient/src/win32/engine_advertise.cpp`
- `D:/Code/Utinni/UtinniCore/swg/object/object.cpp`, `.../swg/network/network.cpp`, `.../cui/cui_manager.cpp`, `.../swg/misc/game.cpp`
- `D:/Code/swg-client-v2/.../NetworkIdManager.cpp` / `.h`, `SwgCuiHud.h/.cpp`, `CreatureObject.h`

Specifically:
1. Do the three advertised catalog rows actually exist at the cited line numbers, with the claimed
   binding/signature/calling-convention? Flag any row that is NOT present (the replan says "confirm-not-add,
   only add if genuinely missing" — is that safe, or is a row actually missing and being assumed present?).
2. Is `getLastSelectedObject` genuinely reachable and does the `getTarget` name-mismatch matter for the
   catalog-key lookup the agent does at runtime?
3. Are the legacy RVAs and the corrected `network.cpp` line citations accurate? Is the +1432 call-graph
   correction real or hand-waved?
4. **Lifetime/correctness of the new path:** `getSelectedObject()` returns an `Object*` that the sim
   thread can delete/relocate. Does the plan resolve `focus` and then call the setter safely, or is there
   a use-after-free / torn-target window widened by the new resolver? (Round 2 flagged this as a MEDIUM
   for the old path — is it better or worse now?)
5. Any citation in the replan that does NOT match source → name it with the real line.

## Output format (markdown)
1. **Summary** — one paragraph: are the new targeting claims ground-truth-sound?
2. **Verified claims** — each replan claim you CONFIRMED against source (with the real file:line).
3. **Concerns** — bullets with severity HIGH / MEDIUM / LOW; each must cite the real source line that
   contradicts or fails to support the plan.
4. **Suggestions** — specific, source-grounded.
5. **Risk Assessment** — overall LOW / MEDIUM / HIGH with justification.

Do not pad. If a claim checks out, say so in one line and move on. The signal we want is where the
plan's prose and the real source DISAGREE.
