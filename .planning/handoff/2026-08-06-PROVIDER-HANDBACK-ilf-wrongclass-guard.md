# 2026-08-06 — HANDBACK: `.ilf` interior layout refuses wrong-class templates (queued item 4a)

**Pushed.** `origin/master` = `528aa999b`. **No contract change — still v33 / 160 names.** This is an
engine-internal robustness fix; nothing to re-sync, no rebind, no version bump.

Closes the top item of the three you left on 2026-08-04, the one you named
`ClientInteriorLayoutManager.cpp:143`. It was worth raising: it was worse than either of us wrote
down.

---

## 1. What it actually was — both halves were unsound, not just the diagnostic

Your report was that the diagnostic is a `DEBUG_WARNING` compiled out of Release. True, and that is
half of it. Reading the create itself:

```cpp
ClientObject * const o = safe_cast<ClientObject *>(ObjectTemplateList::createObject(name));
if (o) { … endBaselines(); addToWorld(); }
else DEBUG_WARNING(true, ("…invalid interior object template name…Object will be skipped."));
```

* `safe_cast` is a bare `static_cast` in Release (`SafeCast.h:16-18`; it only `dynamic_cast`s and
  asserts in Debug).
* `ObjectTemplateList::createObject` returns whatever the template's own `createObject()` built —
  and **any template class that does not override it gets the base implementation**,
  `new Object(this, NetworkId::cms_invalid)` (`ObjectTemplate.cpp:155-158`). A plain `Object`, not a
  `ClientObject`.

So a row naming a template of the wrong **class** yields a non-null, wrongly-typed pointer that
passes `if (o)` cleanly, and the next virtual call — `endBaselines()`, `addToWorld()` — dispatches
through a vtable slot read from whatever the `Object` layout happens to hold at that offset.

**That is the same shape as the AV that ate four hours of your session**: an indirect call through a
pointer read out of unrelated memory. Your `0xC0000005` DEP at `0x736E6172` (`"rans"`) came in via
the placement path; this is the identical trap sitting on the **load** path, where the blast radius
is larger — a bad row persisted into an `.ilf` crashes on every subsequent load of that building,
for anyone who has the file.

Confirmed it is the LIVE path: `update()` (the budgeted lazy creator), not the dead
`applyInteriorLayout()`.

## 2. The fix

Both create sites now route through a file-local `createInteriorLayoutObject`, which:

1. takes `createObject`'s `Object *` and narrows it with the **virtual** `asClientObject()` — 0 in
   the base (`Object.cpp:2628-2631`), so it is correct in Release. This is already what `update()`
   uses on the portal owner twenty lines above;
2. **deletes** a wrongly-classed object rather than leaking it;
3. reports either failure with `WARNING` — compiled in, routed to the report log via
   `Fatal.cpp InternalWarning` — naming the class it actually got (`typeid(*object).name()`);
4. returns 0, so the caller skips the row. Which is what the original diagnostic already promised:
   *"Object will be skipped."*

Neither half is novel. `SwgCuiQuestJournal` already narrows a `createObject` result with
`asClientObject()` (`:1118-1123`) and disposes with a plain `delete` (`:388`, `:1105`). The helper
just puts the existing idiom where the `.ilf` path always needed it.

Three things checked rather than assumed:

* **`delete` is safe here.** `~Object` handles the never-added case (`if (m_inWorld)` /
  `if (m_attachedToObject)`, `Object.cpp:846-868`), and both callers run in the **alter** phase
  (`GroundScene::update` via `IOET_Update`) — outside the `setDisallowObjectDelete` window, which
  wraps only `IoWinManager::draw` (`Game.cpp:1690-1704`). Deleting inside that window would `FATAL`.
* **The warning cannot storm.** `update()`'s cursor advances past a bad row whether or not it
  created, so each bad row is attempted once per cell-arming, not once per frame.
* **No warning-flood fatal exists** — `ms_numberOfWarningsThisFrame` is only a PIX counter.

The dead `applyInteriorLayout()` path is folded into the same helper. Unreachable today (its gate is
the inverse of `update()`'s and `disableLazyInteriorLayoutCreation` defaults false), but it carried
an identical copy of the trap three lines away.

## 3. What this does and does not change for you

**Your filter is still the right thing to keep.** This makes a wrong-class template a logged,
skipped row instead of a crash — it does not make bad templates *work*, and it is not a licence to
loosen the allowlist. Your own `.ilf` census (29 `object/static/` · 20 `object/tangible/` ·
2 `object/soundobject/`) still describes what actually belongs.

It does mean the failure mode you were one bad persist away from is no longer fatal, and that if a
hand-edited or third-party `.ilf` ever names a wrong class, you get a line naming the file, the
building template, the offending template path, and the class it produced — instead of a dead
client.

**Your todo to validate by reading the candidate template's IFF type from the VFS is still the
principled fix** and is unaffected by this. It moves the check earlier, where you can refuse before
minting; this one is the backstop for rows that got past everything.

## 4. Gates

* Canonical 5-target Release build (`Direct3d11;Direct3d9;Direct3d9_ffp;Direct3d9_vsps;SwgClient`),
  **both platforms: exit 0, 0 unresolved externals, 0 hard errors.** Only pre-existing `LNK4217`
  (libxml2 in `sharedXml`) on Win32.
* Contract untouched: 160 names, `GetEngineHookPoints` still ord-82 at `0x00701420` — the same
  address as the v33 binary, as expected since nothing in the advertise surface moved.
* Renderer DLLs **not** rebuilt — no shared header touched, so no ABI cascade.

**LIVE-VERIFIED (maintainer-launched, gl11 / `rasterMajor=11`):**

* Mos Eisley cantina intact — furniture **and** the band gear (`instrument` / `speaker` /
  `microphone`). Those are a different top-level class from the chairs, so they are the ones that
  would have vanished if the class check were wrong.
* **The stronger control, unplanned:** a speaker moved into the air in a *previous* session was
  still floating in place. That is the **edited, persisted `.ilf`** loading through the new helper
  with its transform applied — not just stock data. Exactly the load path this fix is about.
* Report log, today's run: **0** `interior object template` warnings, **0** `WRONG CLASS`. All 30
  warnings in the run are pre-existing asset noise (Bink DLL, missing textures, CDF
  `index_color_3`, `undead` socials, StringIds) — same categories as the 08-04 and 08-05 runs.

⚠ **The refusal branch itself is UNEXERCISED.** Nothing in that run handed it a wrong-class
template, so `asClientObject()` → 0 → `delete` → `WARNING` has never actually run. A negative test
was designed and deliberately deferred: plant one `draft_schematic` row in a **derived `.ilf` for a
different building** — deliberately *not* `edit_1082874.ilf`, since that is your live working file
and you have byte baselines recorded against it (`34086` / `bb1847fa3144`). Available on request.

## 5. Still open from your list

* **4b — `wsAddObject` executes text on a wrong-class-but-existing template.** Not done. Same class
  of defect as this one, on the placement side, where a validation branch would turn the AV into an
  existing `REFUSED (…)` line. Not blocking you (your filter can no longer produce it).
* **4c — `wsForgetNode` does not un-intern the template name.** Not done; still a knowing decision
  rather than a bug, and your corrected byte-rule (`.ws` unchanged **only** when the template is
  already interned) is the accurate one.
* **Finding 2 / the `cleanupScene`-first change remains yours to test**, and v33's own teardown is
  still unexercised for the same reason.
