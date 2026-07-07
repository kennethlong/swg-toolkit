---
sketch: 018
name: stf-strings-editor
question: "How does localized-strings (.stf) editing read — key/CRC/value shape, search, add-key, modified state, save-back, and locale-sibling awareness?"
winner: "A (Flat key/value grid)"
tags: [stf, strings, localization, editor, typed-editors, round-trip-gate, phase-5]
---

# Sketch 018 · .stf Strings Editor

## ✅ Decision — A (Flat key/value grid)

Maintainer pick (2026-07-07): **A wins** — one flat `key | crc32 | text` table, the direct
sibling of the 014 datatable editor. One file = one locale (honest to how `.stf` ships); other
locales are other files in the VFS tree. CRC stays visible but machine-owned (read-only,
recomputed on save; `auto on save` for new keys). B's locale-sibling awareness and C's compact
Inspect-width panel were not selected — if cross-locale pain shows up in real use, B's per-key
sibling readout is the documented fallback direction. Carries into UI-SPEC.md as: the strings
editor is a full editor tab with the same tabstrip/crumb/gate-chip anatomy as 014.

## Design Question

`.stf` string tables (DATA-02) are the second Phase-5 typed editor and the only Phase-5 surface
with zero prior design coverage. Unlike DTII, `.stf` is not an IFF FORM — it's a flat
CRC32-indexed table (`STF␠` magic; ASCII key + UTF-16LE text per entry), and each locale is a
**separate sibling file** (`string/en/item_n.stf`, `string/de/…`). The editor must make the
key → CRC → localized-text shape obvious, keep CRC maintenance invisible (recomputed on save),
and decide how much locale awareness the surface carries.

Content is real-ish `string/en/item_n.stf` name keys aligned with 014's weapons
(`dl44_blaster → "DL-44 Blaster Pistol"`), plus a long quest line to test wrapping.

## How to View

Open `index.html` in a browser (links `../themes/cyan.css`). Switch variants with the top tabs.

- **Double-click a text cell** (A/C) to edit; Enter commits. Modified values triple-encode
  (warn border + tinted bg + ●); the file tab picks up a ● while dirty.
- **`＋ Add key`** inserts a new row with CRC shown as `auto on save`.
- **Search** filters by key AND localized text (A/B/C).
- In **B**, click keys in the list; the editor card shows key / CRC (read-only) / text, plus
  the same key's values in sibling locale files — including the **missing-in-locale** warn state.
- **`Save · run gate`** fakes the rebuild: `rebuilding index + payload…` → `✓ byte-exact
  round-trip · CRC index rebuilt` → staged chip.

## Variants

- **A · Flat key/value grid** — the 014 sibling idiom (path of least resistance): one table,
  columns `key | crc32 | text`. Localization = you opened the `en` file; other locales are other
  files in the VFS tree.
- **B · Master–detail + locales** — key list left, editor card right; locale chips in the header
  and per-key sibling-locale readouts (de/fr/ja, with missing-key warnings). The most
  localization-aware take.
- **C · Compact Inspect-width** — 440px quick-fix surface docked next to Inspect/Deploy: search +
  key/text only (no CRC column), for the "fix one label while looking at the mesh" moment.

## What to Look For

- **Grid vs master–detail** — item-name keys are short (grid-friendly), but quest/dialog strings
  are paragraphs (B's textarea wins). Which default fits the real mix, and could A grow B's
  detail card on demand instead?
- **Does CRC read as machine-owned?** It's shown (trust/debuggability) but never editable, and
  add-key defers it to save. Is that the right prominence — or should it hide entirely?
- **Locale-sibling value (B)** — is cross-locale context per key worth the surface (missing-key
  warnings are a real modder pain), or is per-file editing (A) honest to how `.stf` actually ships?
- **Sibling consistency with 014** — same tabstrip/crumb/gate-chip anatomy; do the two typed
  editors read as one family? Does the gate chip ("CRC index rebuilt") carry the same trust weight
  as 014's byte-exact message?
- **Compact C** — is an Inspect-width strings panel genuinely useful, or should Strings always
  open as a full editor tab like A/B?
