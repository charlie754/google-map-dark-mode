# Turn report — switch rows lift 1.05 like the other controls
**Date:** 2026-08-20
**Agent seat:** Grok Build (architect)
**Status:** Complete
**Branch / cwd:** `F:\google map plugin`
**Authority:** Operator — “There should be Enlarging Animation for switches as well like others”

## 1. Objective

The three switch rows (Dark mode, Map surface, Panels and controls) should enlarge on hover the same way Ko-fi, GitHub, and the lockup do: scale 1.05, press 0.96, animated, no leftover entry-stagger delay.

## 2. Plan / routing

No lanes. CSS only, matching the existing `.shell.is-open .kofi:hover` lift. Council skipped: same token, live 53/53 quotes scale 1.05 on the Dark mode row.

## 3. What changed

- `extension/content/widget.js`
  - `.shell.is-open .row:hover { transform: scale(1.05) }`
  - `.shell.is-open .row:active { transform: scale(0.96) }`
  - hover/active `transition-delay: 0s` (the 60/110/160 ms entry stagger was parking the lift)
  - hover shadow `--glass-shadow-hover`, `border-radius: 9px`
- `test/checks/widget-banner.test.mjs` pins the row scale rules
- `test/checks/widget.mjs` measureLift now includes `.row[data-row="enabled"]`

## 4. Verification evidence

Offline: **53/53** (`node --test` image + manifest + rules + widget-banner).

Live `node test/checks/widget.mjs`:

```
WIDGET: 53/53 passed
PASS  Dark mode switch enlarges on hover (GoatApp scale 1.05)
      rest=none settled=matrix(1.05, 0, 0, 1.05, 0, 0) (scale 1.05)
PASS  Dark mode switch lift is ANIMATED, not a jump
      5 intermediate scales sampled: [1.000, 1.007, 1.017, 1.029, 1.037, 1.043, 1.047, 1.049, 1.050, ...]
PASS  Dark mode switch has no leftover stagger delay on hover
      transition-delay while hovered = "0s"
```

`node tools/package.mjs` rebuilt 1.0.1:

```
chrome   dist/google-map-dark-mode-chrome-1.0.1.zip   sha256 8a930a90f6dbdb1380804543bc19e8b06179b10242ac874c557d37fc62334516
firefox  dist/google-map-dark-mode-firefox-1.0.1.xpi  sha256 27e3704440d74f0c2dd37498b3402963d399f92b310674ca366b4a496f812dc3
```

## 5. Gate A / Gate B

- **Gate A** PASS — 53/53 offline, build OK.
- **Gate B** PASS — live 53/53 including switch lift.

## 6. Residual hazards

- **LOW** — `body__inner` is `overflow: hidden`; 1.05 on a full-width row is the same clip budget as Ko-fi. Measured scale still 1.05.
- **MEDIUM** — Chrome listing screenshot still missing for store upload.

## 7. Not done

- Human store upload
- Firefox live widget
- `test:package` not re-run this turn (zip hashes changed)

## 8. Go/No-Go

**GO** reload unpacked `dist/chrome/` and hover a switch row.

## 9. Next

- **P0** Reload and hover Dark mode / Map surface / Panels.
- **P1** Re-run `test:package` before upload.
- **P2** DO NOT START a version bump.

## 10. Artefacts

- This report: `docs/turns/2026-08-20-switch-row-hover-lift.md`
- WIKI N/A

## 11. Council

Skipped. Live paste quotes scale 1.05 and intermediate samples on `.row[data-row="enabled"]`.
