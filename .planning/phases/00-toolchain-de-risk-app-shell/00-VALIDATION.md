---
phase: 0
slug: toolchain-de-risk-app-shell
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-21
---

# Phase 0 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | {vitest / jest / playwright — Wave 0 selects & installs (Claude's discretion per CONTEXT.md)} |
| **Config file** | {path or "none — Wave 0 installs"} |
| **Quick run command** | `{quick command}` |
| **Full suite command** | `{full command}` |
| **Estimated runtime** | ~{N} seconds |

---

## Sampling Rate

- **After every task commit:** Run `{quick run command}`
- **After every plan wave:** Run `{full suite command}`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** {N} seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| {N}-01-01 | 01 | 1 | REQ-{XX} | T-{N}-01 / — | {expected secure behavior or "N/A"} | unit | `{command}` | ✅ / ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

> Validation Architecture source: see `00-RESEARCH.md` § Validation Architecture. The five Phase 0
> success criteria each have an objective check the planner must map to a task:
> (1) Electron security posture — assert `contextIsolation`/`nodeIntegration` flags + preload-only bridge;
> (2) native addon hello round-trip — assert returned value observed in renderer;
> (3) `crossOriginIsolated === true` in the packaged renderer (COOP/COEP);
> (4) `contracts/` types compile and import from both backend + renderer (tsc passes);
> (5) dockview layout persists across restart — `toJSON`→reload→`fromJSON` byte/shape match.

---

## Wave 0 Requirements

- [ ] Select & install the test framework (none exists — greenfield repo)
- [ ] Shared fixtures / harness for the SAB round-trip and `crossOriginIsolated` assertions
- [ ] Headless Electron launch path for CI-able shell assertions

*Filled by the planner against the final plan/wave structure.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Dark dockable shell visually correct & panels drag/dock | FND-05 | Visual/interaction judgment | Launch app; drag a panel to a 5-way drop zone; restart; confirm layout restored |

*Automated coverage handles the wiring proof (criteria 1–4); panel docking feel is manual.*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < {N}s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
