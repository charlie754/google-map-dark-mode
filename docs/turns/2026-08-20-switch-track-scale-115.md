# Turn report — switch hover scale 1.15
**Date:** 2026-08-20
**Agent seat:** Grok Build (architect)
**Status:** Complete
**Authority:** Operator — “set to 1.15”

## 1. Objective
Toggle-pill hover scale is **1.15**. Press stays 0.96. Row / Ko-fi / GitHub / lockup unchanged.

## 2. What changed
- `extension/content/widget.js` — `.track:not(:disabled):hover { transform: scale(1.15) }`
- `test/checks/widget-banner.test.mjs` — pin updated

## 3. Verification
`node tools/build.mjs` wrote `dist/chrome/content/widget.js`. Live suite not run.

## 4. Go/No-Go
**GO** reload unpacked `dist/chrome/`.

## 5. Artefacts
`docs/turns/2026-08-20-switch-track-scale-115.md`. WIKI N/A.

## 6. Council
Skipped. One CSS number.
