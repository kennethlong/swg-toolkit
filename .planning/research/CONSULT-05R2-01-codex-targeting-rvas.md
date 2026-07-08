# Consult task — Codex (repo-tracer / ground-truth) — Phase 5 round-2 review

You are one of four independent reviewers. Your angle: **repo-tracer / ground-truth**. Read the REAL
source and confirm or refute specific address/struct claims. Do NOT reason from the plan's prose — open
the cited files and check the bytes/offsets/lines yourself. A productive DISAGREEMENT with the other
reviewers is the goal, not agreement.

## LOCKED ground truth (treat as GIVEN — do NOT re-derive or re-litigate these; they were fixed this round)
1. The advertised swg-client-v2 build must NEVER crash on a live write. `object::setScale` is seeded
   `nullptr` and only assigned a legacy absolute RVA when `!isAdvertisedClient()`; `applyWrite` calls
   each setter only if its pointer is non-null. (This BLOCKER fix is settled — do not re-argue it.)
2. Legacy networkId is intentionally UNAVAILABLE (the old `+1432`-as-networkId read was removed). The
   `+1432` offset is now used ONLY for target resolution. (Settled — do not re-argue.)

## Your job: verify the NEW object-targeting mechanism against real source
The replan added (Phase-5 scope decision) an agent "focus object" resolution chain. The plan claims,
as concrete source-grounded facts, ALL of the following. For EACH, open the named file at the named
lines and report CONFIRMED / WRONG / CANT-VERIFY with what you actually found:

- `getPlayerCreatureObject` = RVA `0x004251D0` — D:/Code/Utinni/UtinniCore/swg/game/game.cpp:74
- `getPlayer` = RVA `0x00425140` — game.cpp:73 (already-bound accessor)
- `setTransform_o2w` = RVA `0x00B22CC0` — D:/Code/Utinni/UtinniCore/swg/object/object.cpp:148
- `setScale` = RVA `0x00B23A10` — object.cpp:155
- `cachedNetworkIdGetObject` = RVA `0x00B30160`, `__thiscall` — D:/Code/Utinni/UtinniCore/swg/misc/network.cpp:39,42
- The `+1432` offset from `getPlayerCreatureObject()` is a `CachedNetworkId` pointer embedded in the
  CreatureObject struct = the player's LOOK-AT TARGET slot (game.cpp:704-746). Confirm `+1432` is the
  look-at-target slot and NOT the object's own networkId.
- `Network::getCachedObjectById` gates its `cachedNetworkIdGetObject` call behind `!isAdvertisedClient()`
  (network.cpp:74-85), and `getPlayerLookAtTargetObjectNetworkId` returns 0 when `isAdvertisedClient()`
  (game.cpp:721-724). Confirm both gates exist as described — the agent will mirror them.
- `object::setScale` is ABSENT from the advertised catalog while `object::setTransform_o2w`/`setPosition_w`
  ARE advertised, at D:/Code/swg-client-v2/.../win32/engine_advertise.cpp:~578/~850. Confirm.
- There EXISTS an advertised-safe generic id->Object* resolver `network::getObjectById` RVA `0x00B380E0`
  (plan says so but does NOT use it this phase). Confirm it exists.

## The one open question I most need you to answer
The plan resolves the focus object as **the player's in-game LOOK-AT TARGET** (legacy only), falling back
to the player. Is there anything in the Utinni/swg-client-v2 source that would let the agent instead
resolve **an arbitrary object by networkId/template** (i.e. the specific mesh a user is viewing), on
EITHER build? Point at the real accessor if one exists (`network::getObjectById` 0x00B380E0? something in
object.cpp?). I need to know whether "move the object you're viewing" is source-reachable or whether
"player's look-at target / player" is genuinely the ceiling for this phase.

Output: a terse list of CONFIRMED/WRONG/CANT-VERIFY per claim with the actual line you saw, then a 3-5
line answer to the open question, then a one-line risk verdict (LOW/MEDIUM/HIGH) on the targeting track.
