---
sketch: 007
name: project-entry
question: "What does the project front door surface — an Open/Create Project control beside Mount Archive in the Assets panel header — and how does the project ↔ client binding (plus optional local server, and the unconfirmed-directory branch) read?"
winner: "synthesis (A header + C wizard + B first-run)"
tags: [onboarding, project, client-binding, local-server, front-door, mount, phase-4, phase-8]
---

# Sketch 007 · Project Entry

## ✅ Decision — Synthesis (all three compose into one flow)

These variants aren't competing layouts; they're complementary pieces of a single onboarding flow,
so the winner is a **synthesis**:

- **A — persistent header front door:** the equal-width `＋ Project ▾` split-button + `Mount` live in
  the Assets panel header at all times; the bound state shows the project bar + client chip and a
  populated tree.
- **C — the wizard `＋ Project` opens:** the 4-step modal (Name & location · Bind client · **Local
  server (optional)** · Seed assets), including the **unconfirmed-directory** "is this a client
  install?" branch.
- **B — first-run / empty state:** the welcome takeover (recent projects + detected-clients auto-scan)
  is what an empty Assets panel shows before any project is open.

Carries into UI-SPEC.md as: header-embedded project control, a New-Project wizard with optional
local-server association, the unconfirmed-directory → client/non-client decision, and a first-run
welcome state. Non-client projects are now a first-class concept.

## Design Question

How does the whole workflow *initiate*? A project binds to one client install (the deploy
target, via the .cfg slot mechanism) and either seeds its asset set from that client's TRE set
or starts empty + mounts loose archives. This sketch explores what the **front door** surfaces:
an Open/Create Project control beside **Mount Archive** in the Assets panel header, and how the
**project ↔ client binding** reads once a project is open.

Key distinction surfaced across all variants: **seed from the client's TRE set (recommended)**
vs **start empty** — the "client-vs-TRE-set detection" decision.

## How to View

Open `index.html` in a browser (self-contained; links `../themes/cyan.css`). Switch variants
with the top nav. Sketch toolbar (bottom-right): theme picker, **`toggle: empty ⇄ bound`**
(drives variant A's two states), and annotate.

- **A:** click the toolbar `toggle` button (or a Recent / New / Open action) to flip empty ⇄ bound; click the `▾` caret for the split-button menu.
- **C:** the wizard opens on load; close it (×/Cancel/backdrop) and reopen via the header `＋ Project` button or the statusbar "reopen wizard".

## Variants

- **A · Header split-button** (path of least resistance) — Assets `.panel-head` gets a `[＋ Project ▾]` split-button (menu: New / Open… / Open Recent) plus `[Mount Archive]`. Empty state = centered card in the tree area; bound state = a project bar with name **DL-44 Overhaul** + bound-client chip **⛁ SWG Infinity · EERT5000** and a populated tree.
- **B · First-run welcome** — Assets panel body becomes a full welcome takeover: Recent projects, an auto-scan "Detected clients" list (SWG Infinity ✓ ready · SWGEmu ✗ not found), and big New / Open / Mount actions. Viewport/Inspector/data panes are dimmed until a project loads.
- **C · New-Project modal wizard** — same header buttons; `＋ Project` opens a single-column **4-step** stepper modal over a dimmed shell, reusing sketch 003's overlay pattern:
  1. **Name & location**
  2. **Bind client** — auto-detected installs as radio rows; the **Browse for client folder…** link demonstrates the **unconfirmed-directory branch** (see below).
  3. **Local server (optional)** — "Are you running a local server for this project?" Yes/No; **Yes** reveals server **type** (Core3 / WSL2 · SWG Source / Docker), **path**, and **host:port** (`127.0.0.1:44463`). Wires server-side deploy (datatables, Lua / object templates) + client↔server parity.
  4. **Seed assets** — client TRE set vs empty.

### Two onboarding branches added (per maintainer requirements)

- **Local server association** — on first opening a project bound to a client install, the wizard asks whether a local server is running and captures the params to wire it in (type · path · host:port). This is the front door for Phase-8 client↔server parity and server-side deploy. In variant A's bound state it surfaces as a **Local server** row in the inspector's *Project binding* group.
- **Unconfirmed-directory branch** — if the user browses to a folder we **can't confirm** is a client install (no EERT5000 `.tre` set / no client exe), the wizard surfaces a warning card and asks **"Is this a client install?"** → **Yes, treat as client** (deploy-to-client enabled, user-confirmed) or **No, non-client project** (no bound client; deploy-to-client disabled — assets / server-only). This makes *non-client projects* a first-class concept.

## What to Look For

- **Discoverability vs ceremony:** A folds the front door into the existing panel header (cheapest, least chrome); B greets first-run users with context; C is the most guided but gates work behind a modal. Which matches how often a user actually switches projects?
- **How the binding reads once open:** compare A's persistent project bar + client chip (always visible while you work) against B/C where the binding is only shown during onboarding. Is the bound-client chip worth permanent header space?
- **The seed decision (TRE set vs empty):** only C makes it an explicit wizard step. In A/B it's implicit (status line / inspector "seed source"). Should choosing the seed source be a deliberate gate or a sensible default you can change later?
- **Accessibility:** every state cue carries glyph + border/bg + label — bound-client chip (⛁ + text), detected ✓ ready / ✗ not-found pills — never colour alone. Check each still reads under the High-contrast theme.
- **Mount placement:** it sits beside the project control in every variant (a project can start empty + mount loose archives). Does pairing them clarify or muddy the "project vs loose archive" mental model?
- **Local server step (C):** is the optional Yes/No + reveal the right weight, or should server wiring be deferred out of new-project entirely into Project Settings? Are type · path · host:port the right minimum params?
- **Unconfirmed-directory branch (C):** does the "Is this a client install?" question read clearly, and does "non-client project" (no bound client) feel like a legitimate path or a dead end? This is the only place the app admits a project might not target a client.
