# Turn report — black / paper lockup plates
**Date:** 2026-08-19
**Agent seat:** Grok Build (architect)
**Status:** Complete
**Authority:** Operator — lockup missing black background; use black in Maps dark mode and white/paper when not.

## 1. Objective

Make the hover lockup readable by giving it the two grounds from the brand folder: near-black (`goat-lockup-horizontal-dark.png`) when Dark mode is On, paper (`goat-lockup-horizontal-paper.png` / `.goat-lockup--paper`) when Dark mode is Off.

## 2. Plan / routing

No lanes. Plate colours taken from the design folder (`#0b0b0d` dark, `#f6efe6` paper). Mode follows `settings.enabled` (the master Dark Mode switch). Council skipped: live script asserts both RGB values.

## 3. What changed

- `.goat-lockup` is a padded, rounded plate. Default background `#0b0b0d`.
- `.goat-lockup--paper` background `#f6efe6` and the design-file ink tokens.
- `render()` toggles `--paper` when `settings.enabled` is false.

## 4. Verification evidence

Offline banner file: 8/8 including the plate test.

Live `node test/checks/widget.mjs`:

```
WIDGET: 47/47 passed
PASS  lockup uses the black plate while Dark mode is On
      paper=false bg=rgb(11, 11, 13)
PASS  paper plate is the light lockup ground
      {"bg":"rgb(246, 239, 230)","r":246,"g":239,"b":230}
```

Shots: `test/artifacts/widget/3c-goat-banner.png` (black plate) and `3c-goat-banner-paper.png` (paper plate).

## 5. Gate A / Gate B

- **A:** PASS (banner tests + build)
- **B:** PASS 47/47 live widget

## 6. Hazards

- **LOW** — paper live check forces the class; the `enabled === false` path is the `render()` toggle, covered offline. Turning Dark mode Off reloads the tab, so the class is applied on the next mount.
- Store `test:amo` still not run.

## 7. Not done

Firefox live widget. AMO lint.

## 8. Go/No-Go

**GO** unpacked `dist/chrome/` (reload). Dark mode On → black card. Dark mode Off → paper card.

## 9. Next

Reload the extension. Hover the lockup on a dark map.

## 10. Artefacts

- This report: `docs/turns/2026-08-19-lockup-dark-paper-plates.md`
- **WIKI N/A**

## 11. Council

Skipped. Live RGB for both plates is the product evidence.
