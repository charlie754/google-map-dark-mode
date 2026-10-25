# Turn report — replace lockup with new brand/lockup-hover
**Date:** 2026-08-19
**Agent seat:** Grok Build (architect)
**Status:** Complete
**Authority:** Operator — `F:\flight\Goat Website\brand\lockup-hover\` has a new design; put that original into the plugin.

## 1. Objective

Swap the plugin lockup for the current hover component: baked 羊 outline, type floors, `--gl-seal-scale`. Keep panel plates, 1.05 lift, hover-only motion, and campaign copy.

## 2. Plan / routing

No lanes. Council skipped — live 47/47 includes painted paths=7 (the extra 羊 path) and hover cross-fade.

## 3. What changed

- `extension/content/brand/goat-lockup-hover.css` copied from the design folder.
- Widget markup: `.gl-strokes` six lines → `.gl-char` SimSun 羊 path.
- Panel is 272px (design needs ~340px with tagline): hide `.goat-lockup__tag`, `--gl-seal-scale: 1.7`, `--gl-name-min: 15px` so GOATPROJECT is not clipped.

## 4. Verification

Banner offline 9/9. Live:

```
WIDGET: 47/47 passed
PASS  Goat lockup is painted
      mark=52.3x59.4 paths=7
PASS  Goat lockup animates on hover
      {"meteors":"1","thumb":"1","face":"rgb(200, 65, 47)"}
```

Shots `3c-goat-banner.png` (羊 in the stamp, full GOATPROJECT) and `3d-goat-lockup-hover.png` (thumbs-up + meteors).

First live run 43/47 was Ko-fi `PANEL-NOT-OPEN` after the results path, not the lockup. Rerun 47/47.

## 5. Gates

A PASS. B PASS 47/47.

## 6. Hazards

LOW — name floor 15px is a panel override of the design’s 20px floor, required to fit 272px.

## 7. Not done

AMO. Firefox live widget.

## 8. Go/No-Go

**GO** reload `dist/chrome/`.

## 9. Next

Reload unpacked extension; hover the lockup.

## 10. Artefacts

`docs/turns/2026-08-19-replace-lockup-yang-stamp.md`. WIKI N/A.

## 11. Council

Skipped.
