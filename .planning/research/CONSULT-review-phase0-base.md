# Cross-AI Plan Review — SWG-Toolkit Phase 0 (Toolchain De-risk & App Shell)

You are an independent reviewer of the implementation plans for **Phase 0** of the SWG-Toolkit
project. Provide structured, adversarial feedback on plan quality, completeness, correctness, and
risk. **You have read access to this repo AND the sibling reference projects** (`../swg-client-v2`,
`../Core3`, `../Utinni`, etc.) — use them. Verify claims against reality; do not just reason from the
plan text.

## What Phase 0 is

Greenfield repo. Phase 0 is **de-risk + scaffold only** — NO SWG format parsing yet. It must:
1. Bootstrap a pnpm monorepo (packages: `contracts`, `native-core`, `backend`, `renderer`).
2. Build a minimal C++ Node-API addon via **cmake-js** (`hello()` → "pong", `allocateSab(n)` → SharedArrayBuffer).
3. Lock the Electron security posture (contextIsolation, nodeIntegration:false, sandbox, narrow preload).
4. Enable cross-origin isolation (COOP/COEP) so SharedArrayBuffer works in the renderer.
5. Prove a **real zero-copy SharedArrayBuffer round-trip**: C++ (in a dedicated Electron *utility process*)
   allocates a 4-byte SAB, writes `0xDEAD` to Int32[0], transfers it via `MessageChannelMain` to the
   renderer, which reads `0xDEAD` back — with `crossOriginIsolated === true`.
6. Ship a dark, dockable, persistent 4-panel workspace (dockview) with theme system + layout persistence.
7. Full E2E suite (Playwright + Electron) verifying all 5 success criteria, including a **packaged-binary** test.

## The 5 success criteria (what must be TRUE)

1. App boots: `contextIsolation: true`, `nodeIntegration: false`, renderer calls native only via a narrow typed validated preload bridge (no Node in renderer).
2. C++ N-API addon builds via cmake-js, loads in main/utility (never sandboxed renderer), returns a value from "hello" observable in renderer.
3. `crossOriginIsolated === true` in the **packaged** renderer (COOP/COEP set) → SharedArrayBuffer allocatable.
4. A shared-types `contracts/` package compiles and is imported by both backend and renderer.
5. User sees a dark dockable persistent 4-panel workspace whose layout survives restart.

## Requirements addressed: FND-01..FND-05

## Locked decisions (do NOT re-litigate — from CONTEXT.md)
- **D-01:** Electron Forge + Vite plugin (user's explicit choice; research flagged the Forge Vite plugin "experimental").
- **D-02:** native addon runs in a dedicated **utility process** (crash isolation); SAB transferred utility→renderer.
- **D-03:** pnpm workspaces; `contracts` is the keystone shared-types package.
- **D-04:** wiring proof goes all the way to a real zero-copy SAB round-trip (not just a hello call).

## Stack version pins claimed in the plans (TREAT AS SUSPECT — verify against npm/real packages)
Electron 42.4.1, React 19.2.x, TypeScript 6.0.3, pnpm 11.8.0, @electron-forge/* 7.11.2,
dockview / dockview-react 6.6.1, zustand 5.0.14, tailwindcss 4.3.1, @tailwindcss/vite 4.3.1,
vitest 4.1.9, @playwright/test 1.61.0, node-addon-api 8, cmake-js (Windows MSVC v145).

## Files to review (in this repo)
- `.planning/phases/00-toolchain-de-risk-app-shell/00-01-PLAN.md` — monorepo scaffold + contracts + test harness
- `.planning/phases/00-toolchain-de-risk-app-shell/00-02-PLAN.md` — cmake-js C++ addon (TDD)
- `.planning/phases/00-toolchain-de-risk-app-shell/00-03-PLAN.md` — Electron security + COOP/COEP + utility process + SAB pipeline
- `.planning/phases/00-toolchain-de-risk-app-shell/00-04-PLAN.md` — dockview shell, themes, StatusBar
- `.planning/phases/00-toolchain-de-risk-app-shell/00-05-PLAN.md` — Playwright E2E suite + packaged-binary spec
- Supporting: `00-CONTEXT.md`, `00-RESEARCH.md` (50k — the AI-generated research the plans lean on), `00-UI-SPEC.md`, `00-VALIDATION.md`
- Project: `.planning/PROJECT.md`, `.planning/ROADMAP.md`, `.planning/REQUIREMENTS.md`

## ⚠️ Project's #1 known risk
The `docs/` and the `00-RESEARCH.md` were distilled from an AI (Gemini) research session — **plausible
but frequently fabricated** API details, version numbers, and signatures. The real loader code in
`../swg-client-v2` and actual package behavior are ground truth, NOT the research doc. Where a plan
asserts an API signature, header order, version pin, or framework behavior, **verify it** rather than
trusting it.

## Output format (markdown)
1. **Summary** — one-paragraph overall assessment.
2. **Strengths** — bullet points.
3. **Concerns** — bullets, each tagged severity **HIGH / MEDIUM / LOW**, with the specific plan/task and *why*.
4. **Suggestions** — specific, actionable improvements.
5. **Risk Assessment** — overall LOW/MEDIUM/HIGH with justification.

Be concrete and cite plan/task IDs (e.g. "00-03 Task 1"). Flag anything you cannot verify as such.
A productive disagreement with the other reviewers is more valuable than agreement — say what YOU see.
