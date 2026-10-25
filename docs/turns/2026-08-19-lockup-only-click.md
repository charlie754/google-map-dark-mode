# Turn report — lockup is the only Goat click target
**Date:** 2026-08-19
**Agent seat:** Grok Build (architect)
**Status:** Complete
**Branch / cwd:** `F:\google map plugin`
**Authority:** Operator — “it should only clickable on banner, not rest of the sentence”

## 1. Objective

The two campaign sentences must not be a link. Only the GOATPROJECT lockup (the black/paper banner) opens `https://dagoat.io`.

## 2. Plan / routing

No lanes. Markup + CSS + JS handler + tests. Council skipped: click-target change; live assertion quotes `lockupTag=A` and `copyInsideLink=false`.

## 3. What changed

- `extension/content/widget.js`
  - `.goat` is a `div` (layout only). Sentences live in `.goat__copy` with no `href`.
  - `.goat-lockup` is the `<a href="https://dagoat.io">`.
  - Cursor/focus-visible on the lockup, not the sentences.
  - Coarse-pointer first-tap handler binds to the lockup.
- `test/checks/widget-banner.test.mjs` — href is on `<a class="goat-lockup">`; no `<a class="goat">`; copy closes before the lockup `<a>`.
- `test/checks/widget.mjs` — live: `lockup.tagName === 'A'`, `.goat` is not an `<a>`, `.goat__copy` is not inside an `<a>`.

## 4. Verification evidence

Offline: `node --test` image + manifest + rules + widget-banner → **52/52**.

Live `node test/checks/widget.mjs`:

```
WIDGET: 49/49 passed
PASS  only the lockup is the Goat link, not the sentences
      {"lockupTag":"A","goatIsLink":false,"copyInsideLink":false,"href":"https://dagoat.io"}
```

Built archives (`readZipFiles` on the packaged files):

```
dist/google-map-dark-mode-chrome-1.0.1.zip
  a.goat-lockup true  a.goat false  div.goat true  idle compute true
dist/google-map-dark-mode-firefox-1.0.1.xpi
  a.goat-lockup true  a.goat false  div.goat true  idle compute true
```

`npx.cmd --yes addons-linter dist/firefox` → errors 0, notices 0, warnings 0.

`node tools/package.mjs`:

```
chrome   dist/google-map-dark-mode-chrome-1.0.1.zip   255584 bytes
         sha256 4e947d1b342223d713b3b747205c2c942dd7f636c5c26dac83dace451ade8ae9
firefox  dist/google-map-dark-mode-firefox-1.0.1.xpi  255864 bytes
         sha256 9d0083d7a978882bdc7d51a0958d22f44944cdf95949484190857d18c24bb8a6
```

## 5. Gate A / Gate B status

- **Gate A** PASS — 52/52, linter 0/0/0, archives match build.
- **Gate B** PASS — live 49/49 including lockup-only href. `node test/checks/package-install.mjs` → **STORE ARTIFACT CHECKS: 17/17 passed** (XPI installed, zip live map DARK 3/3).

## 6. Residual hazards

- **MEDIUM** — Chrome listing still needs a screenshot (`docs/store-listing.md`).
- **LOW** — sentences are selectable text now; no pointer cursor on them.

## 7. Not done

- Human store upload
- Chrome listing screenshot
- Firefox live widget on Maps
- `gate:live:all`

## 8. Go/No-Go

**CONDITIONAL GO** to upload these rebuilt 1.0.1 files (not the previous hashes). Chrome still needs a listing screenshot.

## 9. Next moves

- **P0** Reload unpacked `dist/chrome/` — click the sentences (no navigation), click the banner (dagoat.io).
- **P1** Upload zip/xpi when listing screenshot is ready.
- **P2** DO NOT START a version bump.

## 10. Artefacts

- This report: `docs/turns/2026-08-19-lockup-only-click.md`
- WIKI N/A

## 11. Council

Skipped. Live 49/49 quotes the click-target geometry; archive-layer grep confirms `<a class="goat-lockup">` and no `<a class="goat">`.
