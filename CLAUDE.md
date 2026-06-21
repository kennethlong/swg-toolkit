@AGENTS.md

---

# Claude-specific operating notes (tracked)

Claude-facing guidance for this repo: the cross-AI consult crew and the de-anchoring protocol. The
shared project manual is in `AGENTS.md` above. (Tracked in git per the maintainer's choice — the
crew invocation paths below are machine-specific to the maintainer's workstation.)

## Phone a friend (cross-AI consult crew)

Four independent consultants, run in parallel while you keep working. **Don't lead them** — hand
neutral evidence (real source excerpts, hexdumps, facts as "treat as given"), never your hypothesis.
Fan out on **different** angles so they cross-check; convergence-from-divergence is the real signal.
Fire-and-continue (background), read each result as it lands.

- **Codex** (repo tracer / call-graph). Run via the **PowerShell tool**, prompt via stdin:
  - First: `$env:PATH = "C:\Program Files\nodejs;$env:PATH"` (the npm shim calls bare `node`).
  - `C:\Users\kenne\AppData\Roaming\npm\codex.cmd exec --skip-git-repo-check --sandbox read-only -`
  - If config regresses (`unknown variant 'disabled'`): add `-c windows.sandbox=unelevated`. **Never** set `disabled`.
  - Output: slice between the **last lone `codex` marker line** and the `tokens used` line.
- **Cursor** (most detailed code reader; give it byte-map / file:line trace tasks):
  - `C:\Users\kenne\AppData\Local\cursor-agent\cursor-agent.cmd -p --mode ask --trust --output-format text`
  - `--mode ask` = read-only. Binary is `cursor-agent`, not `cursor agent`. Output is clean prose.
- **fresh Sonnet** — lateral / out-of-the-box. Spawn via Agent tool, `model: sonnet`.
- **fresh Opus** — math/spec reasoning. Spawn via Agent tool, `model: opus`.

Notes:
- `command -v` / `Get-Command` report codex/cursor as MISSING — they're installed but not on the
  non-interactive PATH. Always invoke by full path.
- **All four can read the repo AND the reference projects** (`../swg-client-v2`, `../Core3`,
  `../Utinni`, `../swg-blender-plugin`, etc.). Give them real source-reading tasks, not just doc research.
- **Auto-detect output encoding** (varies by capture path): BOM check, else null-byte density in the
  first ~400 bytes → UTF-16LE; else UTF-8. Don't hardcode.
- Write each task to `.planning/research/CONSULT-NN-<who>-<topic>.md`, outputs to `...-<who>.out`.

## Ground truth beats consensus (de-anchoring protocol)

This project's biggest risk is the **AI-distilled formats** in `docs/` — plausible but often
fabricated (see `docs/00-overview/source-provenance.md`). The crew can fall into the same trap: four
LLMs reasoning from the same AI-generated doc will happily agree on a **wrong** struct layout.

**Ground truth here = the real loader code in `../swg-client-v2` (and `../Core3`) + a hexdump of an
actual `.tre`/asset file.** When a format question matters, that is the evidence — not crew consensus.

Breaking a false-consensus round (when all four agree but real source/bytes disagree):
1. **Lead with the measured ground truth as LOCKED axioms** — the actual struct from the client
   source, the real byte offsets from a hexdump — stated as "do NOT contradict or re-derive," numbered, at the top of every task file.
2. **Explicitly mark the doc's proposed framing FALSIFIED and BAN it** from the answer, or they'll re-derive it from the same doc.
3. **Point at the now-specific open question with non-overlapping angles** so they can't collapse onto one answer. A productive *split* is the success signal, not agreement.

Full protocol in memory: `feedback_consultant_crew_protocol` (originated in the swg-client-v2 work,
where the ground-truth oracle was RenderDoc; here it's the real client source + asset bytes).

## Claude-specific notes

- Reference projects are **sibling dirs** (`../swg-client-v2`, etc.) — outside this repo root; read them with absolute or `../` paths.
- The `docs/` tree is the grounding library — cite it (`docs/02-formats/<file>.md`) when reasoning about a format, and **update it when you verify or correct a layout** (drop the "AI-proposed" caveat for that section).
- MCP servers: none configured for this repo yet (no `.mcp.json`). Add one if a tool (e.g. a TRE inspector) warrants it.
