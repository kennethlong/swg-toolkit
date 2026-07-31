# Change request (→ swg-client-v2): v23 `wsSetNodeTemplateName` must resolve AUTHORED nodes, not LIVE nodes

**Date:** 2026-07-30 · **From:** SWG-Toolkit live-editor · **To:** swg-client-v2 (advertised catalog owner).
**Filed to provider inbox:** `swg-client-v2/.planning/handoff/2026-07-30-toolkit-wsSetNodeTemplateName-authored-vs-live-MISS-REPORT.md`.

## Why

Model-D end-to-end now fails at exactly one step. Fresh boot, player in the Mos Eisley cantina, snapshot
loaded and byte-verified to contain authored node 1082874 (16× LE-u32, incl. its cells) — yet:

```
[editor.ws] wsSetNodeTemplateName MISS: id=1082874 (no live node)
```

v23 spec says `0` = "no such **authored** node"; the implementation resolves via a **live**-node map. A
static POB the server streams (or that persists across ws unload/load) never has a live ws node, so the
rebind can never hit it. v23 gates were build+boot only — this path likely never returned 1 live.

## The ask

Look the id up in the loaded `WorldSnapshotReaderWriter` authored node set (what `wsSaveSnapshot`
serializes). No live node needed — v23 itself: "the LIVE spawned object is untouched (data-only)".

Secondary: gate the `SELF-TEST save-on-load` hook (it writes `override/snapshot/<scene>.ws` on EVERY
load — tonight it resurrected a stale experiment snapshot we'd renamed away, and it drifts the file size
each cycle).

## Everything proven live tonight (for the record)

- v25 `getContainingBuildingId`: hover a `.ilf` decoration → correct building id + template (stock ws id).
- Full toolkit pipeline: capture → override-dir resolution → assembly (row `alcove1[3]` resolved, edited
  `.ilf` + derived `object/building/toolkit/edit_1082874.iff` written + staged) → APPLY → agent rebind
  call → RESULT round trip. Only the in-game lookup MISSes.
- New this session: orphaned-edit recovery (failed rebind leaves a stale accumulated `.ilf`; assembly now
  falls back to stock) + full assembly tracing in `%TEMP%\swg-toolkit-decoration-debug.log`.
