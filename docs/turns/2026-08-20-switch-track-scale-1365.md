# Turn report — switch-button hover scale +30%
**Date:** 2026-08-20
**Agent seat:** Grok Build (architect)
**Status:** Complete
**Authority:** Operator — increase switch enlarging effect by 30%; no tests, they will try it.

## 1. Objective

Hover scale on the toggle pills only (not the row, not Ko-fi/GitHub/lockup): 1.05 × 1.30 = **1.365**. Press stays 0.96.

## 2. What changed

- `extension/content/widget.js` — `.shell.is-open .track:not(:disabled):hover { transform: scale(1.365) }`
- `test/checks/widget-banner.test.mjs` — pin updated so `npm test` still matches source

## 3. Verification

`node tools/build.mjs` wrote `dist/chrome/content/widget.js`. Live widget suite **not run** (operator request).

## 4. Not done

Live headed check. Store re-package.

## 5. Go/No-Go

**GO** reload unpacked `dist/chrome/` and hover a toggle.

## 6. Artefacts

`docs/turns/2026-08-20-switch-track-scale-1365.md`. WIKI N/A.

## 7. Council

Skipped. One CSS number.
