# Turn report — hover-only lockup + 1.05 lift
**Date:** 2026-08-19
**Agent seat:** Grok Build (architect)
**Status:** Complete
**Authority:** Operator — "Animation only hovering on it, look at our design folder" then "also missing enlarging effect, same as other buttons"

## 1. Objective

Replace the auto-looping SVG with the hover lockup from `F:\flight\Goat Website\brand\lockup-hover\`. Motion plays only while the pointer is on the lockup. Add the same 1.05 / 0.96 lift as Ko-fi and GitHub.

## 2. Plan / routing

No lanes. Design file is `goat-lockup-hover.css` + the HTML lockup block. Council skipped: the live widget script already asserts idle-until-hover, hover animation, and 1.05 lift with intermediate scales.

## 3. What changed

- Removed looping `goat-lockup-loop.svg` from the widget (and from `extension/content/brand/`).
- Shipped `extension/content/brand/goat-lockup-hover.css` and inlined it into the shadow stylesheet (`GOAT_LOCKUP_CSS`).
- Markup is the design `<span class="goat-lockup">` (mark + wordmark). `:hover` is on `.goat-lockup` only — opening the panel or hovering the sentences does not play it.
- `.shell.is-open .goat-lockup:hover { transform: scale(1.05) }` and `:active { scale(0.96) }`, same shadow as GitHub, stagger delay cleared on pointer.
- Sentences and 16px gap under StarGithub unchanged. Link still `https://dagoat.io`.

## 4. Verification evidence

Offline (`package.json` `"test"` argv):

```
ℹ tests 49
ℹ pass 49
ℹ fail 0
```

(7 banner checks including hover-gated meteors and `scale(1.05)`.)

Live, headed, `dist/chrome/`:

```
node test/checks/widget.mjs
WIDGET: 45/45 passed
PASS  Goat lockup is idle until hover (panel open is not enough)
      rest meteors=0 thumb=0
PASS  Goat lockup animates on hover
      {"meteors":"1","thumb":"1","face":"rgb(200, 65, 47)"}
PASS  Goat lockup enlarges on hover (GoatApp scale 1.05)
      rest=none settled=matrix(1.05, 0, 0, 1.05, 0, 0) (scale 1.05)
PASS  Goat lockup lift is ANIMATED, not a jump
      6 intermediate scales sampled: [1.000, 1.007, …, 1.050]
```

Shots: `test/artifacts/widget/3c-goat-banner.png` (idle) and `3d-goat-lockup-hover.png` (meteors + lift).

Layer: canonical widget script tally, plus the two PNGs.

## 5. Gate A / Gate B

- **Gate A:** PASS 49/49
- **Gate B:** PASS 45/45 live widget

## 6. Residual hazards

- **LOW** — lockup is 11px to fit 272px; wordmark is tight. Readable in the shot.
- **LOW** — 1.0.1 zip/xpi must be rebuilt after this change (packager run this turn).
- **MEDIUM** — store promo / `test:amo` still open from earlier.

## 7. Not done

- Firefox live widget not re-run.
- `test:amo` not run.

## 8. Go/No-Go

**GO** for unpacked `dist/chrome/` (reload the extension). Hover the lockup: stamp, meteors, thumbs-up, and 1.05 lift. Opening the panel alone leaves it still.

**NO-GO** for store upload until `test:amo`.

## 9. Next moves

- P1: reload unpacked `dist/chrome/` and hover the lockup.
- P2: `npm run test:amo` before upload.

## 10. Artefacts

- This report: `docs/turns/2026-08-19-hover-lockup-lift.md`
- **WIKI N/A**

## 11. Council

Skipped. Live assertions already name idle, hover motion, and 1.05 lift with intermediate scales — the same checks a reviewer would demand.
