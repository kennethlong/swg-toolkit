# Task: verify advertised-build (swg-client-v2) catalog/source claims against real source

You are a precise code reader. Open the actual files and confirm or refute each claim at the cited
location. Do NOT infer from naming plausibility — read the lines.

Ground-truth files (read them):
- `D:/Code/swg-client-v2/src/game/client/application/SwgClient/src/win32/engine_advertise.cpp`
- `D:/Code/swg-client-v2/src/engine/shared/library/sharedObject/src/shared/object/NetworkIdManager.cpp`
- `D:/Code/swg-client-v2/src/engine/shared/library/sharedObject/include/public/sharedObject/Object.h`
  (and/or the sibling `.../src/shared/object/Object.h`)

## Claims to check (each: CONFIRMED / REFUTED / NOT-FOUND with the real file:line and the exact text)

1. `engine_advertise.cpp:707` contains a catalog/hook-point row for a `NetworkIdManager::getObjectById`
   equivalent (an arbitrary NetworkId -> Object* resolver advertised to external tools).
2. `NetworkIdManager.cpp:72-79` implements that `getObjectById` — report its real signature and calling
   convention.
3. `engine_advertise.cpp:703-704` contains a catalog row for `SwgCuiHud::getLastSelectedObject()`
   (the currently selected / world-picked object).
4. `Object.h:512-515` contains `inline const Vector &getScale() const { return m_scale; }` (a live
   read accessor for scale). Report the real line and exact declaration.
5. Search `s_engineHookPoints[]` (the advertised catalog array) in engine_advertise.cpp for any
   `object::getScale` or `object::setScale` row. The claim under test: **neither getScale NOR setScale
   is currently advertised** (both are known gaps). Confirm or refute — list every `object::` row you
   find so we can see what IS advertised.
6. Independently: what is the catalog KEY STRING and calling convention the advertised build uses for
   getObjectById at :707 (the plan needs the exact string to bind against)?

## Output
Per claim: verdict + exact file:line + literal text. Then a short list of ALL `object::*` catalog rows
present in engine_advertise.cpp. End with one line: are the two ROUND-2 targeting rows (getObjectById,
getLastSelectedObject) genuinely ALREADY present, or must they be added?
