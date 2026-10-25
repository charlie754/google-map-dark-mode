# Turn report — idle compute copy + 1.0.1 store packages
**Date:** 2026-08-19
**Agent seat:** Grok Build (architect)
**Status:** Complete (packages on disk; store upload is human)
**Branch / cwd:** `F:\google map plugin`
**Authority:** Operator — fix typo “computer” → “compute”, then ready to ship Chrome and Firefox.

## 1. Objective

Replace `Contribute your idle computer to Earn GOAT.` with `Contribute your idle compute to Earn GOAT.`, then emit and verify the 1.0.1 Chrome zip and Firefox xpi.

## 2. Plan / routing

No implementation lanes. Copy + this project’s store pipeline (`package.mjs`, addons-linter, `test:package`, live widget).

**Council seats (this turn):**
- `gemini-flash` — claim-by-claim evidence sweep (write findings first)
- `codex-sol` — AMO/CWS ship hazards and what the report omits
- `grok` — store-artifact judgement (zip/xpi layer, not source)

gstack `/ship` (git PR) was not used: git root is `F:\`, shared, and the ask is store packages not a GitHub PR.

## 3. What changed

| Path | Change |
|---|---|
| `extension/content/widget.js` | `idle computer` → `idle compute` |
| `test/checks/widget-banner.test.mjs` | LINE_2 + `doesNotMatch(/idle computer/)` |
| `test/checks/widget.mjs` | live assertion quotes the new sentence |

Historical turn reports and consultant reviews still say “computer”. That is correct.

Version stays **1.0.1** (not yet uploaded).

## 4. Verification evidence

### Offline
`node --test test/checks/image.test.mjs test/checks/manifest.test.mjs test/checks/rules.test.mjs test/checks/widget-banner.test.mjs`

```
ℹ tests 52
ℹ pass 52
ℹ fail 0
```

### Built artifacts (not source)
`dist/chrome/content/widget.js` and `dist/firefox/content/widget.js`: `idle compute` true, `idle computer` false.

From the packaged archives via `readZipFiles`:

```
dist/google-map-dark-mode-chrome-1.0.1.zip
  idle compute true
  idle computer false
dist/google-map-dark-mode-firefox-1.0.1.xpi
  idle compute true
  idle computer false
```

`node tools/package.mjs` (verbatim close):

```
packaging "Google Map Dark Mode" version 1.0.1
Chrome Web Store
  dist/google-map-dark-mode-chrome-1.0.1.zip
  255733 bytes (249.7 KiB)   sha256 ca0643d7a098a44f72e3050c1c31841bd664da2f827b157e08c2623b3e45a834
addons.mozilla.org
  dist/google-map-dark-mode-firefox-1.0.1.xpi
  256013 bytes (250.0 KiB)   sha256 dcacecc836e3ea8103f6cefd74f641249f6b216b1628da85a8ca9c94a0e16a6b
both archives verified from disk: manifest.json at root, forward slashes only
```

### AMO linter (built `dist/firefox`, not source)
`npx.cmd --yes addons-linter dist/firefox`

```
Validation Summary:
errors          0
notices         0
warnings        0
```

### test:full pieces
- theme: `ℹ tests 28` `ℹ pass 28`
- DNR: `2 KB TRAP DETECTOR: 31/31 checks passed`
- liveness: `TOKEN LIVENESS: 5/5 checks passed`

### Live widget (`node test/checks/widget.mjs`)
Third run:

```
WIDGET: 48/48 passed
PASS  Goat sentences sit on top of the lockup
      ["Goat Project - Help fight Cancer, Alzheimer’s, Parkinson’s, COVID-19, Dengue, Hepatitis C etc.","Contribute your idle compute to Earn GOAT."]
```

Shot `test/artifacts/widget/3c-goat-banner.png` shows “Contribute your idle compute to Earn GOAT.”

First two live runs flaked (stray OS pointer / hover miss after the results path). Copy assertion passed on all three.

### Store install (`node test/checks/package-install.mjs`)

```
STORE ARTIFACT CHECKS: 17/17 passed
ARM1.xpi-installed  temporarilyInstalled=true warnings=[]
ARM2.LIVE: the map is dark, from the packaged build
        3/3 rendered frames DARK: 3000ms=(35.95,54.05,76.24) DARK
ARM2.LIVE: the content script injected
        data-mapsnoir = "on"
```

## 5. Gate A / Gate B status

- **Gate A** PASS — offline 52/52, package disk check, addons-linter 0/0/0.
- **Gate B** PASS for Chrome panel copy and Chrome zip live dark map. Firefox XPI loads and background is healthy. Firefox **in-page widget** on Maps was not run.

## 6. Residual hazards

- **MEDIUM** — Chrome Web Store listing still needs at least one screenshot (1280×800 or 640×400). `docs/store-listing.md` still says “Screenshots: none yet”. Packages can upload; the Chrome form will block without a shot.
- **MEDIUM** — Firefox live widget (headed Maps + panel) not run this turn. XPI install + background health is ARM1, not the panel.
- **LOW** — headed widget flake (stray pointer). Rerun was 48/48.
- **LOW** — third-party Goat campaign on a Maps dark-mode listing (prior Council). Unchanged this turn.

## 7. Not done / open items

- Human upload to Chrome Web Store and AMO (cannot be done by an assistant)
- Chrome listing screenshot
- Firefox live widget
- `gate:live:all` (full Chrome + Firefox map interaction) — not re-run; ARM2 zip live dark map is the store-artifact substitute this turn
- Git commit (git root is `F:\`; not requested)

## 8. Go/No-Go

**CONDITIONAL GO** to upload the two files:

- Chrome: `dist/google-map-dark-mode-chrome-1.0.1.zip` (sha256 `ca0643d7a098a44f72e3050c1c31841bd664da2f827b157e08c2623b3e45a834`)
- Firefox: `dist/google-map-dark-mode-firefox-1.0.1.xpi` (sha256 `dcacecc836e3ea8103f6cefd74f641249f6b216b1628da85a8ca9c94a0e16a6b`)

Conditions: operator supplies Chrome screenshot(s); listing copy from `docs/store-listing.md`; AMO already lint-clean.

**NO-GO** to claim “submitted” — upload is human.

## 9. Suggested next moves

- **P0** Upload the zip/xpi. Chrome needs a screenshot before the form accepts.
- **P1** Firefox live widget if you want panel proof on Gecko, not only XPI load.
- **P2** DO NOT START a version bump — 1.0.1 is the unpublished store cut.

## 10. Artefacts

- This report: `docs/turns/2026-08-19-idle-compute-ship.md`
- WIKI N/A
- Packages: paths + sha256 in §4
- Council files (after dispatch): `consultant/2026-08-19-compute-copy-ship-*.md`

## 11. Council

Dispatched this turn after this report was written. Seats and lenses in §2. Verdicts appended after return.
