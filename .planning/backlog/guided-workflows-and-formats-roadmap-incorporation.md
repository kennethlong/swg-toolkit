# Roadmap incorporation — Guided Workflows + verified asset-format reference

**Opened:** 2026-08-01 · **Status:** decision pending (timeline)
**Source:** two docs adopted 2026-08-01 from the swg-client-v2 provider session (at the maintainer's
direction). The AI-driven guided-wizard **concept originated with the maintainer (Kenny)**; the
provider session elaborated the design.

- `docs/02-formats/asset-format-census-and-editing-guide.md` — ground-truth-verified format reference (§10 = roadmap input).
- `docs/09-ai-mcp/guided-workflows-and-ai-layer.md` — guided-workflow engine + AI-layer design proposal.
- Received handoffs: `.planning/handoff/2026-08-01-PROVIDER-{DOC,NOTE,HANDOFF}-*.md`.

This note captures the two roadmap-shaping payloads pulled out of those docs so they get an explicit
yes/no rather than sitting inside reference prose.

---

## A. Guided Workflows — proposed new phase + requirements

**Proposal:** a declarative *Guided Workflow* engine (flows = data, one per mod archetype) layered on
the existing services, with four consumer faces sharing one permission model: (A) human UI wizard —
no AI; (B) external MCP agents the user already owns — Claude Code/Cursor/Copilot; (C) optional
embedded BYO-credential agent; (D) AI-02 spot assists (unchanged). Tier A needs no AI and no MCP.

**Demand evidence (first real community data this project has had):** ModTheGalaxy census — the #1
download is a *modding tool* (SIE); the most-walked paths are texture/UI mods; the #1 newbie question
is asset discovery ("which .dds in which .tre is that object?"). Per-server legality is load-bearing:
SWG Legends sanctions modding but **bans terrain/footstep/collision/animation/interior-layout mods** —
so **per-server policy must be a first-class concept**, not a footnote.

**The one real new service both proposals need:** the **asset-discovery resolver**
(template → appearance chain → `.sht` → `.dds` walk; formats guide §5.1). Highest-value single
addition — answers the community's #1 question and every W1 wizard reuses it.

**Proposed requirements to add:**
- **WF-01** — guided workflows for the top mod archetypes, fully operable without AI.
- **WF-02** — workflows exposed through the MCP server with human-custody confirmation (agent
  `workflow.confirm` *requests*; the grant comes from the user in the toolkit — no self-approval).
- **AI-03** — optional embedded agent with user-supplied credentials can drive any workflow,
  stopping at every confirmation boundary.

**Wizard build order (from the design doc §3):** W1 texture-reskin + packaging/policy-checker →
W2 UI-scale/theme + appearance-swap + sound → W3 interior-decoration (retrofit sketch 021 as flow #1)
+ new-item/prop (needs formats §10 P1) + creature/wearable reskin → W4 building-edit / buildout /
server-content / ReShade.

## B. Formats-guide §10 — evidence-based backlog for Phase 7 (Format Editors)

The formats guide §10 replaces Phase 7's current "TBD" with a demand-ranked, gap-analyzed queue,
each item de-risked by a working era binary and/or library-grade engine RW code
(`D:\Code\swg-client\exe\win32\`, and the SOE source in swg-client-v2):

- **P1 — Object-template authoring** (revive `TemplateCompiler` + native CSTB emitter). The hub of
  every composition chain; ecosystem-wide gap; era exe exists as interim. Unblocks the W3 "new prop".
- **P2 — Buildout authoring** in the live world editor (schema fully recovered from `BuildoutAreaSupport.cpp`).
- **P3 — `.cdf` record-level editor** (Miff-bypass; the `.mif` macro header is lost anyway).
- **P4 — FX suite** (`.prt` first — engine RW + live preview via attach; then `.cef/.swh/.ltn/.snd`).
- **P5 — SwgGodClient leftovers** — region/trigger editing; template-palette + drag-drop placement UX.
- **P6 — Terrain** (revive `Turf` as CLI verifier first, then staged native `.trn/.lay` editing) —
  largest open gap in the whole ecosystem; client-side terrain mods are also *banned on Legends*.
- **Continuous** — a "legacy tools" launcher wrapping era binaries; mine `DataLint` path rules into deploy gates.

Explicitly not pursuing: MayaExporter revival (swg-blender-plugin owns DCC), UiBuilder, ops tools,
`.qst` XML round-trip.

---

## Timeline decision — DECIDED 2026-08-01

Queue is all unexecuted ahead of this: **4.4 → 5 → 5.1 (in convergence-review loop) → 6 → 7 → 8**.
Inserting a workflows phase is a *relative-priority* decision (workflows vs Blender), not a queue-jump —
5.1 still finishes and executes first.

**Decision:** insert **Phase 5.2 "Guided Workflows I + AI Layer"** after 5.1, **before Blender (6)**,
with **the AI capability in hand** — NOT deferred to Phase 8. Maintainer's rationale: having the AI
capabilities available *during* the workflows build will refine/reshape how the wizards are done, so
dogfood the AI-driven wizard as it's built rather than building tier-A first and bolting AI on in Phase 8.

Scope landed in 5.2 (ROADMAP + REQUIREMENTS updated 2026-08-01):
- Flow engine + **asset-discovery resolver** + W1 wizards (texture reskin, packaging + per-server-policy checker), tier-A human-driven (**WF-01**).
- **Minimal MCP `workflow.*` surface** so external agents (Claude Code/Cursor/Copilot) drive wizards with human-custody confirmation (**WF-02**) — pulled forward from Phase 8.
- **Optional embedded BYO-credential agent** (**AI-03**) — tier-C SDK/OAuth verified against the Claude API reference at build time.
- Sketch-021 decoration flow retrofit as engine-hosted flow #1.

Consequences recorded:
- **Phase 8 AI-01 narrows** to broadening the MCP surface to the full backend service set + AI-02 advisory assists — no longer the first MCP work.
- **Blender (Phase 6) stays put**, slides one execution slot behind 5.2 (decoupled sidecar, no downstream dependency; audience already served by swg-blender-plugin).
- **Formats §10 P1–P6 queue** → the concrete plan for **Phase 7 (Format Editors)** (still to be folded into Phase 7's detail when 7 is planned; some items — the asset-discovery resolver, and P1 template-compile as a dependency of the W3 "new prop" wizard — surface earlier via 5.2/its wizards).

Still TBD (not blocking): plan-out of Phase 5.2 (run `/gsd:discuss-phase 5.2` → `/gsd:plan-phase 5.2`
when 5.1 is executing/done); folding §10 into Phase 7's detail; a maintained per-server policy data file;
the tier-C subscription-OAuth licensing check.
