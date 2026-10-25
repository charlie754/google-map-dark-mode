# Turn report — lockup: tagline under Goatproject, two rows aligned
**Date:** 2026-08-19
**Agent seat:** Grok Build (architect)
**Status:** Complete
**Branch / cwd:** `F:\google map plugin` (main)
**Authority:** Operator — “it shall directly under GoatProject, same as design. If too narrow just smaller the font size” then “Align two rows”.

## 1. Objective

Stack `THE PEOPLE'S COMPUTE COMMONS` directly under `GOATPROJECT` (design lockup: mark + two-line word column). Left-align the two type rows. If 272px is too narrow, shrink type — do not wrap the tagline under the goat.

## 2. Plan / routing

No lanes. Layout-only CSS on the panel lockup. Council skipped: visual + live geometry, no new surface.

## 3. What changed

- `extension/content/widget.js` panel CSS:
  - `flex-wrap: nowrap` on `.goat-lockup` so the tag cannot drop under the mark
  - `.goat-lockup__word` is a column with `align-items: flex-start`
  - name + tag: `text-indent: 0`, `text-align: left`, `white-space: nowrap`
  - floors: `--gl-name-min: 13px`, `--gl-tag-min: 7px` (design is 20 / 10; panel is 272px)
  - tag tracking `0.12em` so the 28-character line fits on one row
- `test/checks/widget-banner.test.mjs` pins the floors, nowrap, and under-name markup
- `test/checks/widget.mjs` asserts tag under name (`dx < 3px`), one row, and to the right of the mark

Markup was already name-then-tag inside `__word`. No HTML change.

## 4. Verification evidence

Offline (`node --test` on image + manifest + rules + widget-banner): **52/52 passed**.

Local 272px preview (Playwright, no Maps): `dx=0`, `under=true`, `clipped=false`, name 13px, tag 7px.

Live `node test/checks/widget.mjs`:

```
WIDGET: 48/48 passed
PASS  People's Compute Commons sits under Goatproject on one row
      {"tag":"The People’s Compute Commons","tagVisible":true,"tagOneRow":true,"tagUnderName":true,"tagRightOfMark":true}
```

First live run 42/48 was the headed-cursor flake (panel already 272px). Rerun 48/48.

Shot: `test/artifacts/widget/3c-goat-banner.png` — two rows left-aligned beside the mark, not full-width under the plate.

## 5. Gate A / Gate B status

- **Gate A** PASS — offline 52/52, `node tools/build.mjs` wrote `dist/chrome/content/widget.js` 60839 bytes.
- **Gate B** PASS — live 48/48, including tag-under-name geometry.

## 6. Residual hazards

- **LOW** — headed widget check still flakes if the OS pointer sits on the panel (first run 42/48 this turn). Rerun after parking is required.
- **LOW** — name 13px / tag 7px are panel overrides of the design floors (20 / 10). Readable in the shot; not hero-scale.
- **MEDIUM** — `dist/google-map-dark-mode-chrome-1.0.1.zip` / `.xpi` were not rebuilt this turn. Reload unpacked from `dist/chrome/`.

## 7. Not done / open items

- AMO / `npm run test:amo`
- Firefox live widget
- Repackage 1.0.1 zip/xpi

## 8. Go/No-Go

**GO** reload unpacked `dist/chrome/` — two rows aligned under Goatproject.

**NO-GO** store upload until AMO + Firefox live.

## 9. Suggested next moves

- **P0** Reload the unpacked extension to see the stacked lockup.
- **P1** Repackage 1.0.1 if this is the last panel copy/lockup change.
- **P2** DO NOT START AMO until Firefox live widget is green.

## 10. Artefacts

- This report: `docs/turns/2026-08-19-lockup-align-two-rows.md`
- WIKI N/A (no `wiki/` tree)
- Shots: `test/artifacts/widget/3c-goat-banner.png`, `3c-goat-banner-paper.png`

## 11. Council

Skipped. Layout-only; live 48/48 quotes tag-under-name geometry; screenshot confirms both rows share a left edge.
