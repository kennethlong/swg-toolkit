---
id: product-thesis-shadow-sandbox-and-server-push
title: Product thesis — zero-risk shadow sandbox; + baseline changeset, server TRE push, codec scope
created: 2026-06-27
origin: Maintainer product-definition discussion during Phase-4 UAT
severity: high (defines headline product positioning + several architecture decisions)
area: deploy models / changeset graph / server integration / TRE codec
status: pending
disposition: design + scope decisions for the milestone replan / rework task; 2 ground-truth verifications gate it
related: project-entry-point-and-shadow-redesign, project-binds-and-automounts-client-tres, staging-workflow-redesign
---

## Headline product positioning (maintainer)

> Point at a working client and its TRE set → get a potentially **throwaway** set of changes that
> **only touch the config** required to point at shadow TRE files. **No risk** of putting your original
> game client into a permanently broken state. If you build something worth keeping, **save staged
> changes to a changeset.**

Implications (decisions):
- **Shadow model is the DEFAULT/headline**, not patch-prepend. Patch-prepend drops a `.tre` into the
  client's `Live/` — that touches more than config and weakens the "only config" / "zero-risk"
  promise. (Keep patch-prepend available, but shadow leads.)
- The original client's **base TREs are never written**, and its **original config is restorable**.
  The only mutation is a reversible config change pointing at the shadow.
- "Throwaway by design": Reset deletes the shadow dir; original untouched.

## Make the promise cheap: lazy / virtual file set (maintainer-refined — NOT physical copy/hardlink)

MAINTAINER CORRECTION (preferred over hardlinks): manage a **virtual file set** / copy-on-write — do
NOT copy OR hardlink the base. Unmodified entries resolve from the original client TREs **in place**
(read-only, never touched); only **modified** files materialize into an override archive in the work
dir; the client composes them via search-tree priority at mount time.

- This collapses the shadow-vs-patch distinction: the "shadow TRE files" ARE just the override
  archive(s) holding the deltas + the virtual composition. No physical mirror dir needed.
- Lines up with the changeset model already built: `sealVersion` stores diff-vs-parent deltas only.
  The override archive = `packPatch(flatten(activeVersionId))`.
- The base never moves; the only client mutation is the reversible config pointing at the override.
- Retire the `shadowBaseService` full multi-GB copy. (A physical shadow dir — via hardlinks for ~0 cost
  on same NTFS volume — is only needed for a fully SEPARATE client/server instance, not the common
  "test in my existing client" case.)

## Cleanup robustness — undo = restore original cfg (maintainer, 2026-06-27)

Key insight: the deciding factor between deploy models is **cleanup**, not just deploy cost.

- **Patch-prepend that COPIES the patch into the client** leaves a toolkit footprint *inside* the client
  that must be precisely tracked (deploy record) and individually deleted on Reset. Fragile: lost record
  (cross-session typing gap) → orphaned `.tre`; repeated deploys accumulate files; line-surgery on the
  cfg can mis-fire. The maintainer's concern: "we'd have to delete individual files from the client
  folder, which could be problematic."
- **Keep ALL toolkit files OUT of the client** → undo is just **restore the original cfg from
  `.studio`** (whole-file copy-back, far more robust than line-surgery + track-and-delete).

DECISION:
1. **Undo model = restore the snapshotted original cfg(s) from `.studio`** for ALL deploy modes (snapshot
   on first deploy; copy back on Reset). Supersedes line-surgery as the primary reset path.
2. **Two ways to achieve "nothing in client + cfg-restore undo":**
   - **Absolute-path patch (no copy)** — override `.tre` stays in `.studio/build`, registered by absolute
     `searchTree` path (VERIFIED accepted). Lightweight; the new DEFAULT (replaces copy-into-client).
     Constraint: `.studio` must be at a **space-free** absolute path (ConfigFile whitespace truncation).
   - **Full shadow** — client loads entirely from an isolated mirror (hardlink the base TREs). Opt-in
     "throwaway isolated client" mode. **Kept as a first-class option** (maintainer confirmed — its
     cleanup story is the cleanest and the isolation is total).
3. Retire the copy-the-patch-INTO-the-client default.

## Open question 1 — push server TRE/data updates to a local server

- Client-only changes (mesh/texture/appearance) need NOTHING server-side. Anything the SERVER reads
  (object templates, datatables, etc.) must reach the **server's TRE search path** too, or the change
  won't take effect / will desync client↔server.
- Shape: a **server deploy target** that registers the same override archive into the server's TRE
  config — the server-side analog of `cfgActivator`. Mechanism differs per flavor (Core3 vs swg-main)
  → needs grounding against real server configs. Likely its own phase (`docs/05-server-integration`).
- Nice-to-have: detect WHICH staged virtual paths are server-relevant, push only when needed.
- GROUND-TRUTH NEEDED: how do Core3 (`../Core3`, WSL2) and swg-main (`../swg-main`, Docker) configure
  their TRE/data search path? (server cfg analog of the client searchTree mechanism.)

## Open question 2 — default baseline changeset (pristine = shadow matches source)

- DECISION: **yes.** Seed the version graph at project creation with a **`Baseline` root node, zero
  deltas** = pristine client (shadow == source exactly).
- Benefits: a real "before" node for before/after live testing; explicit "unmodified" state; a
  guaranteed graph root every real changeset branches from; "reset to stock" == select Baseline →
  deploy (empty override set).
- Today: manifest starts empty (`activeVersionId: null`, `changesets: []`) — no root node. This is a
  deliberate add to `createWorkspace` / `changesetService`.

## Open question 3 — server/TRE compatibility scope

- SUPPORTED: stock **SWGEmu/Core3** + **SWG Source/swg-main** TRE formats and uncustomized derivatives
  (TRE v0005/v0006, the verified crc-first TOC + forward CRC-32 layout — see memory
  `tre-version-oracles-and-v6000-encryption`).
- ⚠ **v6000 — RE-VERIFY (maintainer challenges the stored memory).** Memory
  `tre-version-oracles-and-v6000-encryption` says "v6000 enumerate-only (encrypted)". Maintainer
  asserts v6000 is **just zlib compression, NOT proprietary encryption**, that **SWG Source (swg-main)
  ships a 6000-format TRE**, and that we **should support reading (and likely writing) it**. This is a
  #1-constraint ground-truth question — do NOT trust the memory OR recollection. Verify against the
  real client TRE reader (`../swg-client-v2` TreeFile / version-6000 path: zlib `inflate` vs decrypt?)
  + a hexdump of a real swg-main 6000 TRE. If zlib: v6000 moves IN-scope for read+write, and the
  memory + `docs/02-formats` must be corrected. (Added to the verification list below.)
- OUT OF SCOPE (for writing overrides): genuinely encrypted/proprietary variants only (if any).
- OPEN-SOURCE EXTENSIBILITY: a fork (e.g. Restoration w/ proprietary compression) should be able to
  wire in their codec. ARCHITECTURE CONSTRAINT: make the **TRE read/write path a pluggable codec
  interface**, not hardcoded, so custom compression/encryption can be dropped in.

## Two ground-truth verifications that gate this (consult-crew candidates)

1. ~~**Absolute `searchTree` cfg paths** accepted?~~ **✅ RESOLVED 2026-06-27 — ACCEPTED.** Verified vs
   real `swg-client-v2` source: searchTree value used verbatim → `CreateFile`, no base-dir prepend
   (`TreeFile.cpp:130-138`/`360-372`, `TreeFile_SearchNode.cpp:249-264`, `OsFile.cpp:86`). The override
   `.tre` CAN live under the app root and be registered by absolute path. Caveat: relative values
   resolve against client CWD → always write a full absolute path. See
   `project-binds-and-automounts-client-tres` §RESOLVED.
2. **Server TRE search-path config** for Core3 + swg-main (mechanism for question 1).
3. ~~**v6000 = zlib or encrypted?**~~ **✅ RESOLVED 2026-06-27** (agent vs source + real Infinity bytes):
   standard TRE **0004/0005** ("EERT5000") = **plain zlib, READ+WRITE in scope** (stock `inflate`/
   `deflate`, no cipher; official `TreeFileBuilder` does the same). Stock client reader handles ONLY
   0004/0005. "6000" = **Restoration's proprietary-ENCRYPTED** variant (enumerable, payloads not
   decryptable) — out of scope for content, pluggable-codec extension point. No plain-zlib 6000 sample
   found (swg-main = server repo, no `.tre`; SWG Source client uses the same 0004/0005-only reader).
   Memory `tre-version-oracles-and-v6000-encryption` updated.

## Severity

High — defines the headline positioning and several architecture decisions (default model, hardlink
shadow, baseline node, pluggable codec, server push). Most are design/scope, not code-now; verify the
two ground-truth items before committing the shadow + server layout.
