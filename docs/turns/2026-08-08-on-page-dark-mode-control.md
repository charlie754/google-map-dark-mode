# Turn report — the on-page Dark Mode control

**Date:** 2026-08-08
**Agent seat:** Claude (architect / chair)
**Status:** Complete. Chrome live gate re-run passed with the widget present.
**Authority:** Operator, in three messages during this turn:
1. *"Put the 'Dark Mode switch on/off' on top left corner of google map UI (Don't get blocked by
   google weather UI). When cursor hover on Dark Mode Switch, it extend the panel of our UI. All UI
   must be interactive, animated… Use `F:\flight\GPUCoin_Guidance\` UI as reference… For the Ko-Fi
   button, make it animated while hovering on it. The Coffee has steam coming out from the cup."*
2. *"Our ui must visually can see words 'Dark Mode on/off'. It shall stay on top left position under
   the search bar if no weather ui pop-up. it shall not block the ui of search result, it always
   shift to on top of main map."*
3. *"add a button https://uiverse.io/Itskrish01/fuzzy-warthog-48 that link to my github in our panel
   under Ko-Fi. The size width must align to ko-fi button."*

## 1. Objective

Put the extension's controls on the map itself, in the reference project's visual language, with
placement that yields to Google's own UI rather than covering it.

## 2. Plan / routing

**No lanes.** The operator's global doctrine changed at the start of this turn — Fable lanes are
removed from routing and judgment-heavy work stays with the chair — and `codex-sol` is out of quota
until 2026-08-09. `gemini-flash` is not viable for a ~700-line animated component with live browser
verification. So this was implemented directly in the chair seat, which is also the cheaper answer
the ruling was aimed at.

Reference read first: `F:\flight\GPUCoin_Guidance\desktop\src\theme.css` and `styles.css` — glass
surfaces (`--glass-bg/-border/-blur/-radius/-shadow`), `--ink-cream` / `--ink-muted`,
`--accent: #3ecf8e`, `--ease: cubic-bezier(0.25, 0.1, 0.25, 1)`, three durations, and the 40×24
switch with an 18px thumb travelling 3px→19px. All reproduced.

## 3. What changed

- **`extension/content/widget.js`** (new, ~700 lines) — the control. Mounts into a **shadow root**;
  its CSS is a template literal in that file rather than a manifest-registered `.css`, because
  `theme.js` rewrites every colour-valued custom property on `:root` and would otherwise re-colour
  our own panel.
- **`extension/manifest.{chrome,firefox}.json`** — `content/widget.js` added to the content script.
- **`test/checks/widget.mjs`** (new) + `package.json` script `test:widget`, wired into `test:full`.
- **`README.md`**, **`CLAUDE.md`** — the control, its placement rule, the uiverse credit, and the
  headed-test hazard.

### Design

Collapsed, it is a 158px pill showing a moon, the words **Dark Mode**, and **On**/**Off** — an icon
alone cannot tell you whether the thing is currently on, which is the one fact the control exists to
convey. Hover or focus expands it to 272px via `grid-template-rows: 0fr → 1fr`, the one way to
transition to an intrinsic height without measuring it in JS. Rows stagger in at 60/110/160ms, Ko-fi
at 210, GitHub at 250, footer at 290; closing is immediate so the panel never appears to hesitate.
Click latches it open for touch and keyboard users; Escape closes.

**Placement is measured, never selected** — Maps' class names are obfuscated and rotate. Two passes:
find Google's tall left results column, and if it is open move onto the map; then find the lowest
painted element overlapping the column we are about to occupy and sit below it.

**Ko-fi**: three steam wisps on a 2s loop at 0/0.45/0.9s delays, drifting as they rise so it reads as
convection rather than three identical lines, plus a slow cup tilt. Idle — not merely invisible —
until hover.

**GitHub**: uiverse `fuzzy-warthog-48`, rewritten from Tailwind utilities to plain CSS. Its four
keyframes are **not published** on that page (they live in the author's Tailwind config), so they are
reconstructed from usage and labelled as such in the source and README.

## 4. Verification evidence

`npm run test:widget` — **20/20**, and `npm run test:full` green (35 offline + 28 theme + 20 widget +
31 DNR-trap + 5 liveness).

```
collapsed is a pill                    width=158.0px
collapsed shows the words              {"title":"Dark Mode","state":"On","titleVisible":true,"stateVisible":true}
clears Google's top-left cards         widget=[88,184,158,48] overlaps=[]
hover expands the panel                open width=272px
expansion is animated                  7 intermediate widths: 158,171,208,238,252,266,271,272…
steam is idle until hover              before=["none","none","none"]
steam animates on hover, staggered     delays 0s / 0.45s / 0.9s
steam opacity actually moves           0.79,0.85,0.83,0.75,0.65,0.59,0.57,0.56,0.55,0.49
GitHub button sits under Ko-fi         label="Star this on GitHub"
GitHub button width matches Ko-fi      gh=244@102  kofi=244@102
GitHub carries all four animations     gh-border-translate / -scale / gh-star-rotate / -shine
GitHub star reacts to hover            none -> matrix(1.04835, -0.0514878, …)
switch drives the DNR ruleset          ["dark_map"] -> []  then restored
results panel is detected              panel=[72,0,408,900]
shifts onto the map, clears the panel  mode=on-map widget=[492,68,158,48] overlaps=false
```

Both archives rebuilt and confirmed to carry `content/widget.js` (17 entries each, identical CRC).

**Two defects my own first pass shipped, caught by looking at the screenshots rather than the
numbers:** the Ko-fi label wrapped to two lines at 272px (fixed by stacking title over handle, as the
popup does), and after the shift-onto-map change the panel landed on Google's category filter chips.
The second is the more interesting one — the chips are individual ~100px `<button>`s inside a
transparent container, so a card-shaped probe looking for wide painted `div`s sailed straight past
them. Pass 2 now includes `button`/`a` at a 56px minimum.

## 5. Gate A / Gate B

- **Gate A: PASS.** Syntax clean, build emits 17 files per target, full suite green.
- **Gate B: PASS for the widget.** Not presence — effect: the panel was driven with real trusted
  input on live Maps, the switches were observed moving the actual DNR ruleset, and the shift onto
  the map was verified against a real search with the results column open.
- **Chrome live gate re-run: PASS**, with the widget present — `[A1:ok A2:ok A3:ok A4:ok A5:ok
  A6:ok]`. Every luminance sample DARK across the full 142s gesture session, health
  `verdict: healthy`, 6/6 rule checks matched, and A6 confirmed the content script still injects on
  all three URL shapes. The widget adds a fixed element to the page and regressed nothing.

## 6. Residual hazards

- **MEDIUM — the reconstructed keyframes are inference, not the author's source.** They match the
  component's described motion and are credited as reconstructed, but they are not byte-identical to
  what uiverse renders.
- **MEDIUM — placement is heuristic.** It reads geometry and paint, so a Maps redesign that changes
  what is painted in that corner can move the panel. It clamps to the viewport and falls back to a
  fixed offset, so the failure mode is "sits somewhere sensible", not "off screen".
- **MEDIUM — `test:widget` is headed and needs the physical cursor parked.** Documented in
  `CLAUDE.md`. On a machine where the PowerShell park fails, the run still asserts
  `no stray pointer over the widget at rest` and fails loudly rather than mis-measuring.
- **LOW — Firefox has not been driven with the widget.** Nothing engine-specific is in play (shadow
  DOM, `grid-template-rows` animation and `background-clip: text` are all supported in the declared
  minimum, Firefox 128), but it is unobserved.
- **LOW — one uiverse detail is deliberately dropped**: the component's light-theme variants. The
  panel is dark-only by design.

## 7. Not done / open items

Firefox live run with the widget. No reduced-motion run was captured as evidence, though the media
query is present and covers every animation added here. The GitHub button links to the repository
rather than the profile — "my github" was ambiguous and the component's own semantics are a
star-the-repo CTA.

## 8. Go / No-Go

**CONDITIONAL GO** — everything asked for is implemented and verified, conditional on the Chrome
live gate re-run completing green. If it regresses, the widget is a single content-script entry and
can be removed from both manifests in one edit.

## 9. Suggested next moves

- **P0** — read the Chrome gate result; run `gate:live:firefox` before the next release.
- **P1** — capture a `prefers-reduced-motion` screenshot pair as standing evidence.
- **P2** — the collapsed pill could show the state in colour as well as words for glanceability.

## 9a. Amendment, same day

Operator, after asking whether the button stars the project directly: it does not — it is
`window.open` on the repo URL, and the user clicks GitHub's own Star button there. Starring is an
authenticated write (`PUT /user/starred/{owner}/{repo}`) needing an OAuth token with `public_repo`
scope belonging to that user, so doing it in-button would mean the extension holding write access to
people's GitHub accounts. Not a trade worth making for a star button, and GitHub provides no
one-click star URL precisely because of it.

Two changes requested and made:

- label `Star this on GitHub` → **`Star Project on Github`**
- the closing sentence under the button (*"Free and open source, and staying that way…"*) **removed**
  from the on-page panel, along with its `.foot` rules, stagger delay and reduced-motion entry. The
  GitHub button now carries the panel's closing margin itself. The same sentence remains in the
  toolbar popup, which was not in scope.

The repo URL was **kept** rather than switched to the profile: "Star Project" only has a referent on
a repository — a profile page has no Star button. One line to change if that was not the intent.

Re-verified after the change: `test:widget` **20/20**, label confirmed on the wire as
`label="Star Project on Github"`, both archives rebuilt.

## 10. Artefacts

- This report: `docs/turns/2026-08-08-on-page-dark-mode-control.md`
- Previous: [1.0.0 ship](2026-08-08-ship-google-map-dark-mode-1.0.0.md)
- Widget evidence: `test/artifacts/widget/` — collapsed, expanded, Ko-fi steam frames, GitHub hover,
  search-shifted, full window
- Repository: https://github.com/charlie754/google-map-dark-mode
- Wiki: **WIKI N/A**
