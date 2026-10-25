# Turn report — Dark Mode pill lifts while the panel is open
**Date:** 2026-08-20
**Agent seat:** Grok Build (architect)
**Status:** Complete
**Authority:** Operator — enlarge the Dark Mode On/Off row while the panel is open and hovering it.

## 1. Objective
The header pill (“Dark Mode” / On/Off) scales **1.05** on hover and **0.96** on press, **only when `.shell.is-open`**. Collapsed hover still only opens the panel (shell 1.025). Switch rows are unchanged.

## 2. What changed
- `extension/content/widget.js`
  - `.shell.is-open .pill:hover { transform: scale(1.05) }`
  - `.shell.is-open .pill:active { transform: scale(0.96) }`
  - Open state insets the pill 8px so the scale is not clipped by `overflow: hidden`
- `test/checks/widget-banner.test.mjs` pins the open-only hover rule

## 3. Verification
`node --test test/checks/widget-banner.test.mjs` → **11/11**. `node tools/build.mjs` wrote dist. Live widget suite not run this turn.

## 4. Go/No-Go
**GO** reload unpacked `dist/chrome/`, open the panel, hover the Dark Mode header.

## 5. Artefacts
`docs/turns/2026-08-20-pill-open-hover-lift.md`. WIKI N/A.

## 6. Council
Skipped. CSS hover on one element.
