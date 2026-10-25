# Turn report — Goat lockup on the in-page panel
**Date:** 2026-08-19
**Agent seat:** Grok Build (architect)
**Status:** Complete
**Branch / cwd:** `F:\google map plugin` (main)
**Authority:** Operator request — put the live lockup from `F:\flight\Goat Website\brand\lockup-hover\` on the plugin panel, leave space between the banner and StarGithub, put the two campaign sentences on top of the banner.

## 1. Objective

Ship the new GOATPROJECT lockup on the in-page Dark Mode panel (the expanded widget, not the toolbar popup). Layout:

1. Star Project on Github
2. a visible gap
3. the two sentences
4. the animated lockup

Sentences, verbatim:

- `Goat Project - Help fight Cancer, Alzheimer's, Parkinson's, COVID-19.`
- `Contribute your idle computer to Earn GOAT.`

## 2. Plan / routing

No implementation lanes. This is a single-file panel change plus one copied asset; the chair (this session) implemented it after a RED offline suite. Council seats assigned at closeout:

| Seat | Vendor | Lens |
|---|---|---|
| Chair | Grok 4.6 (this session) | plan · implement · decide |
| Reviewer | `codex-sol` (GPT-5.6 Sol) | blast radius + store/CSP |
| Reviewer | `gemini-flash` | claim-by-claim evidence |
| Reviewer | `grok` | **skipped** — same vendor as the chair |

## 3. What changed

- `extension/content/brand/goat-lockup-loop.svg` — copy of the live loop lockup (12,665 bytes). Source of truth for the graphic.
- `extension/content/widget.js` — banner block after StarGithub; 16px `margin-top`; two sentences above the mark; lockup inlined as `GOAT_SVG` and imported into the shadow root via `DOMParser` + `importNode` (no `innerHTML`). Click is a native `<a href="https://dagoat.io">`.
- `test/checks/widget-banner.test.mjs` — 5 offline checks, including that the inlined SVG byte-matches the shipped file.
- `test/checks/widget.mjs` — 3 live assertions (gap, copy, painted SVG with ≥6 paths).
- `package.json` — the new offline file is named in `npm test`.

Why the SVG is inlined, not loaded as `<img>`: Maps' page CSP blocks `chrome-extension:` and `blob:` on images. An isolated-world `fetch(runtime.getURL(...))` also failed to land in the live run (placeholder frame only). Parsing a string the content script already holds is the path that painted.

## 4. Verification evidence

### Gate A — offline (input + built artifact)

Command: `node --test test/checks/image.test.mjs test/checks/manifest.test.mjs test/checks/rules.test.mjs test/checks/widget-banner.test.mjs`

```
ℹ tests 47
ℹ pass 47
ℹ fail 0
ℹ duration_ms 147.9866
```

Layer: this is the project's named offline suite plus the new banner file. Not a filtered subset.

Build command: `node tools/build.mjs`

```
dist/chrome/content/brand/goat-lockup-loop.svg  12665 bytes
dist/chrome/content/widget.js  57419 bytes
-- 18 files, 250382 bytes, 2 JSON + 6 JS file(s) parsed OK, 13 manifest reference(s) resolved
dist/firefox/content/brand/goat-lockup-loop.svg  12665 bytes
dist/firefox/content/widget.js  57419 bytes
-- 18 files, 250662 bytes, 2 JSON + 6 JS file(s) parsed OK, 13 manifest reference(s) resolved
```

Layer: built artifact on disk, not the source tree alone. `node --check` ran on every emitted JS.

### Gate B — live widget on Maps (headed Chromium, extension from `dist/chrome/`)

Command: `node test/checks/widget.mjs`

```
WIDGET: 39/39 passed
PASS  Goat banner sits under StarGithub with a gap
      gap=15.9px href=https://dagoat.io
PASS  Goat sentences sit on top of the lockup
      ["Goat Project - Help fight Cancer, Alzheimer’s, Parkinson’s, COVID-19.","Contribute your idle computer to Earn GOAT."]
PASS  Goat lockup image is painted
      mark=244x81.3 paths=6
```

Layer: the canonical widget script's own tally. Shot `test/artifacts/widget/3c-goat-banner.png` shows the cream goat, red stamp, GOATPROJECT wordmark, and both sentences above it, with a clear gap under StarGithub.

First live run (blob `<img>`) reported 39/39 but the shot was a black rectangle — the painted assertion measured the empty frame's box. That assertion now requires `svg.goat__mark` with ≥6 `<path>` nodes. The passing run above is after that fix.

## 5. Gate A / Gate B status

- **Gate A:** PASS — 47/47 offline, both targets built and syntax-checked.
- **Gate B:** PASS — 39/39 live widget, including the three new banner checks, and a screenshot that shows the lockup, not a placeholder.

## 6. Residual hazards

- **MEDIUM** — AMO may treat a third-party promo (dagoat.io) on a Maps dark-mode extension as unrelated advertising. Not a functional defect; a reviewer question at upload.
- **MEDIUM** — `GOAT_SVG` is a copy of the file. Drift is pinned by an offline equality test, but anyone who edits only the `.svg` and skips `npm test` can ship a stale inline copy. There is no build step that re-embeds it.
- **LOW** — `url(#gl-blur)` inside an inlined SVG in a shadow root may not resolve the glow filter. The mark, stamp, and wordmark do not depend on it.
- **LOW** — The expanded panel is taller (~430px). Placement still clears Google's cards; on a short window with the widget pushed toward `MAX_TOP` (460) the bottom of the banner can clip.

## 7. Not done / open items

- Toolbar popup and options page were not branded. The request named StarGithub, which exists only on the in-page panel.
- The hover-lockup HTML/CSS component (as opposed to the loop SVG) was not embedded. The loop SVG is the drop-in banner from the same folder and auto-plays without a second hover.
- Firefox live widget run was not repeated this turn. Offline build of `dist/firefox/` succeeded; Gate B was Chrome-headed only.
- Council reviews are dispatched after this report is written.

## 8. Go/No-Go for claimed next step

**GO** to keep this on the unpacked `dist/chrome/` load. **CONDITIONAL GO** for a store upload: run `npm run test:amo` first (not run this turn), and decide whether the Goat promo is in-scope for the listing.

## 9. Suggested next moves

- P0: none for the requested layout.
- P1: run `npm run test:amo` before any AMO/CWS upload.
- P2: if the operator wants the *hover* lockup (CSS component) instead of the looping SVG, say so — that is a different embed.
- **DO NOT START** a store package bump until AMO lint has been run on the new widget.js.

## 10. Artefacts

- This report: `docs/turns/2026-08-19-goat-lockup-panel-banner.md`
- Live shot: `test/artifacts/widget/3c-goat-banner.png`
- **WIKI N/A** — this repo has no `wiki/` tree.

## 11. Council

Assigned in §2. Reviewers were not given each other's output.

| Seat | File | Verdict |
|---|---|---|
| gemini-flash (evidence) | `consultant/2026-08-19-goat-banner-gemini-review.md` | **CONDITIONAL GO** unpacked Chrome |
| codex-sol (blast radius) | `consultant/2026-08-19-goat-banner-codex-review.md` | **CONDITIONAL GO** unpacked Chrome; **NO-GO** store upload |
| grok | skipped | same vendor as chair |

### Conditions settled with artifacts (not prose)

**Named Gate A suite.** gemini-flash treated the four-file `node --test` as a possible filtered subset. The named `npm test` script **is** those four files. Input file `package.json` line 10:

```
"test": "node --test test/checks/image.test.mjs test/checks/manifest.test.mjs test/checks/rules.test.mjs test/checks/widget-banner.test.mjs",
```

The 47/47 tally in §4 is that script's command, invoked as `node --test …` because `npm.ps1` is execution-policy blocked on this machine. Same argv.

**Apostrophes.** Operator copy used ASCII `'`. Markup uses `Alzheimer&rsquo;s` / `Parkinson&rsquo;s` so the HTML can live in a single-quoted JS string. Live `textContent` is U+2019, which is what `&rsquo;` decodes to. Visible sentence is the one requested.

**innerHTML.** Both seats independently found no assignment. Chair confirms: `DOMParser` + `importNode` only.

**Firefox `required: ["none"]` vs dagoat.io.** codex-sol: not a contradiction — user-clicked `<a target="_blank" rel="noopener noreferrer">`, no fetch. Chair agrees. Residual is AMO *purpose* (promo on a Maps extension), already MEDIUM/HIGH in §6 and a founder call for upload, not for unpacked load.

### Conditions left open (store only)

Agree with both seats: **NO-GO for AMO/CWS upload** until `npm run test:amo` on the built Firefox tree, an explicit yes on the Goat campaign in the listing, and a Firefox live widget run. That was already §8.

### Remaining disagreement — how it was settled

gemini-flash HIGH on Gate A naming is **closed** by the `package.json` script body above. No other NO-GO on unpacked `dist/chrome/`.

codex-sol MEDIUM on `MAX_TOP` clamping top rather than bottom is accepted as a sharper statement of the existing LOW/MEDIUM clip note; not a ship-stop for this request.

**Turn verdict after Council:** **GO** for unpacked `dist/chrome/` load. **NO-GO** for store package. No item OPEN DESPITE REVIEW.
