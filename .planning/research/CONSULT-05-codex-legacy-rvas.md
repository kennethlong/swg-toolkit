# Task: verify a set of legacy (x86 SWGEmu) RVA literals against real source

You are a repo tracer. Treat the addresses below as **claims to confirm or refute against the actual
source files** — do NOT reason from plausibility, open the files and check the cited lines.

Ground-truth files (read them):
- `D:/Code/Utinni/UtinniCore/swg/object/object.cpp`
- `D:/Code/Utinni/UtinniCore/swg/game/game.cpp`
- `D:/Code/Utinni/UtinniCore/swg/misc/network.cpp`

## Claims to check (each independently: CONFIRMED / REFUTED / NOT-FOUND, with the real file:line + the
actual literal you find)

1. `setTransform_o2w = 0x00B22CC0` at object.cpp:148
2. `setScale = 0x00B23A10` at object.cpp:155
3. `getPlayer = 0x00425140` at game.cpp:73
4. `getPlayerCreatureObject = 0x004251D0` at game.cpp:74 (a DIFFERENT accessor than getPlayer)
5. The `+1432` offset: `(uint8_t*)getPlayerCreatureObject() + 1432` is used as a **CachedNetworkId
   pointer** embedded in the CreatureObject struct, around game.cpp:726-733, described in a comment as a
   "lookAt-target" slot — i.e. it is a TARGET, NOT the player's own networkId.
6. `cachedNetworkIdGetObject = 0x00B30160` at network.cpp:39,42, `__thiscall`
7. Around network.cpp:74-85 there is a `Network::getCachedObjectById` (or similar) that gates the
   `cachedNetworkIdGetObject` call behind `!isAdvertisedClient()` (i.e. it is legacy-only).
8. `idManagerGetObjectById = 0x00B380E0` at network.cpp:39, named `utinni::Network::getObjectById`
   (arbitrary NetworkId -> Object* resolver).
9. Is there any occurrence of a **getScale** accessor RVA anywhere in these files? (The claim under test
   is that NO legacy getScale RVA exists in Utinni's vendored source — confirm or refute by grep.)

## Output
For each numbered claim: verdict + the exact line you found (or "no such literal/line"). Flag any address
that is present but at a DIFFERENT line than cited, or any line whose literal differs from the claimed
address. End with a one-line overall: are these legacy RVAs safe to bind as-is?
