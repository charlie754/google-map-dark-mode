# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**Google Map Dark Mode** — a Chrome + Firefox MV3 extension that gives `google.com/maps` a real
dark mode. v1.0.0, packaged for both stores: dark map surface *and* dark app chrome, on by
default, verified under sustained interaction on both browsers.

Internals still carry the old code name `maps-noir` in one place on purpose — the
`data-mapsnoir` / `data-mapsnoir-stats` DOM attributes. That oddity is load-bearing: assertion A6
proves the content script injected by checking for a marker nothing on Google's side would ever
write. Do not "tidy" it. The frozen spike add-ons under `test/experiments/firefox-load/ext-*/`
also keep the old id deliberately — they are recorded evidence, not inputs.

## Commands

```bash
node tools/build.mjs        # assemble extension/ -> dist/chrome/ and dist/firefox/
node tools/package.mjs      # build + emit the store ZIP and XPI into dist/
npm test                    # 42 offline checks, ~150 ms, no network, no browser
npm run test:theme          # 28 theme-layer checks (browser, no network)
npm run test:widget         # 36 in-page widget checks (browser + live Maps)
npm run test:dnr            # 2 KB DNR-trap detector (launches a browser)
npm run test:liveness       # CompactLegend token canary (network)
npm run test:amo            # addons-linter, AMO's own validator (network: npx)
npm run test:package        # installs the built ZIP and XPI in real browsers
npm run test:full           # build + offline + theme + dnr + liveness
npm run gate:live:all       # the live gate: Chrome + Firefox + both controls
```

`npm test` names its files explicitly rather than globbing — `node --test` over-collects
everything under a path containing `test/`, which would launch browsers from the "offline" suite.

**Run `npm run test:amo` before every AMO upload.** A manifest can load perfectly and still be
rejected at submission: AMO refused the first 1.0.0 XPI outright for a missing
`data_collection_permissions`, then passed the next one with three warnings. All four findings were
reproducible locally with `addons-linter` — AMO's own validator, one npx away — and all four were
instead discovered by uploading. `test/checks/manifest.test.mjs` pins the parts that can be checked
offline, including that the Firefox version floors stay at or above where the manifest keys they
declare actually exist (140 desktop / 142 Android for `data_collection_permissions`).

Related: **never write `innerHTML` in this extension**, even from a string constant. The widget's
markup is a module-level literal with no dynamic input, and the linter still flags it
`UNSAFE_VAR_ASSIGNMENT`, which puts a security warning in front of a human reviewer. Parse with
`DOMParser` into an inert document and `importNode` the result — it handles the inline SVG too.

Load unpacked from `dist/chrome/`. Firefox cannot side-load an XPI from a profile directory any
more; use DevTools RDP `installTemporaryAddon` (a working client is at
`test/experiments/firefox-load/rdp.mjs`).

## The one thing to understand: three renderer modes, two palette sources

Google Maps picks a renderer client-side by capability probe. Which one you get decides which
lever works, and reasoning about the wrong mode is how this project lost two rounds.

| Mode | When | Base map arrives via | Palette comes from |
|---|---|---|---|
| `mapcore` (WebGL + WASM) | stock headed Chromium, ~35/36 loads | `/maps/vt/proto?bpb=<protobuf>` | **gstatic CompactLegend asset** |
| `canvas+labeler` | Firefox, always | raster `/maps/vt/pb=` + `/maps/vt/stream/pb=…!4e1` | **gstatic CompactLegend asset** |
| `canvas` | WebGL denied, headless, old UA | raster + stream | server, via `!1sset!2s<Style>` on the **stream** URL |

**The key discovery.** The vector renderer's palette is a static, unauthenticated,
style-name-keyed asset:

```
https://www.gstatic.com/maps/res/CompactLegend-Roadmap-<32-hex-version>
```

`CompactLegend-RoadmapDark-<same version>` exists (HTTP 200, ~1.9 MB). Swapping the name is a
**pure string substitution** — no protobuf, no length arithmetic — and it turns the WebGL map into
Google's genuine dark cartography. `Terrain` / `TerrainDark` likewise. Invalid style names 404
cleanly, which is the health canary. Version hashes rotate; two were observed in one day, so never
pin one.

Four DNR rules in `extension/rules/dark-map.json` cover all three modes. Rule 1 (the legend) is the
one that matters; rule 4 (first-paint raster tiles) exists only to kill a ~1 s light flash.

### Dead ends — proven, do not retry

- **Rewriting the `set:` token inside `/maps/vt/proto?bpb=`.** Structurally impossible for a regex:
  `Roadmap`(7) → `RoadmapDark`(11) needs three nested protobuf length prefixes incremented and the
  base64 re-encoded. `regexSubstitution` has no arithmetic.
- **Rewriting only the raster `/maps/vt/pb=` tiles.** Produces a correct dark map for ~1–6 s that
  the vector renderer then overpaints. A single settled screenshot cannot distinguish "never
  darkened" from "darkened then covered" — always capture a time series anchored to navigation.
- **Blocking `/maps/vt/proto` or the mapcore WASM** to force the raster path. It does pin Maps to
  raster and the map stays dark, but the app never mounts: 5 accessible controls vs 22, no
  attribution bar, empty search results. The fallback only engages when the vector transport is
  dead from the first request, and that same bootstrap failure is what breaks the app.
- Patching `shaderSource` / `fetch` / `XHR` / `Image.src` from a content script. The GL context
  lives in a Web Worker behind a transferred `OffscreenCanvas`; page-world hooks never see it.
- `?force=lite`, `?output=classic`, `maps.google.com`, deleting `OffscreenCanvas`.

### The 2 KB DNR trap — this will cost you an afternoon

Chrome **silently skips** a DNR rule whose `regexFilter` exceeds a 2 KB compiled-memory budget.
The extension loads fine, `getEnabledRulesets()` still returns the ruleset, and the only symptom is
that the map stays light. Writing the legend version tail as `(-[0-9a-f]{32})$` is enough to trip
it; `(-.*)$` is not. Never infer rule health from "the ruleset is enabled" — assert
`testMatchOutcome` per rule. `npm run test:dnr` is the standing regression test for exactly this.
(`testMatchOutcome` does not exist on Firefox, so the self-check degrades to `unknown` there.)

## App chrome: remap tokens, never write selectors

Every legacy hook is gone — `#omnibox`, `#pane`, `#content-container`, `#searchboxinput`, `#QA0Szd`
are all absent; only `#gb` survives, and class names are obfuscated and rotate. A selector-based
theme is a permanent treadmill.

Maps is built on Material 3 design tokens: **386 CSS custom properties on `:root`, 217
colour-valued**, mostly hash-named (`--t5b35d265ba7ac78d: #1f1f1f`). `extension/content/theme.js`
enumerates them at runtime, resolves each through a paired-probe trick (two hidden subtrees
inheriting different colours — a real colour makes both children agree, a non-colour makes them
disagree, which also resolves `var()` chains), transforms lightness in OKLCH, and writes back with
`important` on `:root`. An isolated-world content script is sufficient; no MAIN-world injection.

Rules that keep it from looking like a generic dark-mode extension:
- **Derive, never hard-code token names** — hashes rotate on every Google rebuild.
- **Key exceptions by resolved colour value**, not token name, for the same reason.
- **Never invert translucent black** (shadows and scrims) or translucent white (washes over
  imagery), and never go near photos, Street View, satellite, or avatars.
- **Never touch the map canvas** — it is already dark by other means. Regression check: map-area
  mean RGB must not move when the theme toggles.

## The on-page widget

`extension/content/widget.js` is a self-contained control that mounts into a
**shadow root** on the Maps page. The shadow boundary is load-bearing, not
hygiene: `theme.js` rewrites every colour-valued custom property on `:root`, so
without it the widget's own palette would be transformed along with Maps'. Its
CSS therefore lives in a template literal in that file, not in a
manifest-registered `.css`.

It positions itself **by measurement, never by selector** — same reason as the
theme. Two passes: find Google's occupied left column (if occupied, move onto the
map), then find the lowest painted thing overlapping the column we are about to
occupy and sit below it. The second pass must include `button` and `a` at a low
minimum width, because over the map the obstruction is the category chip row —
individual ~100px buttons in a transparent container. A card-shaped probe misses
them entirely and lands the panel on top of Google's filters.

**The observer must be `subtree: true`.** It was `subtree: false`, which only
reports direct children of `<body>`; Maps builds the suggestions dropdown, the
results list and the place card deep in the tree, so the observer never fired and
the widget never re-placed — measured sitting at `{l:88, t:184}` with mode
`top-left` while the results column was open at `{l:72, w:408, h:900}`. The
placement maths was right the whole time; nothing asked it to run. `focusin` and
`click` are also wired, because focus precedes the dropdown's DOM by a frame or
two.

Measured left-column geometry at 1366×900, which is what the thresholds encode:

| overlay | rect | widget response |
|---|---|---|
| search field | `l=88 t=12 w=376 h=48` | sit below |
| weather/traffic card | `l=88 t=72 w=376 h=100` | sit below |
| search suggestions | `l=88 t=60 w=376 h=246` | **move onto the map** |
| results / place list | `l=72 t=0 w=408 h=900` | **move onto the map** |

Height is the discriminator (`LEFT_COLUMN_MIN_HEIGHT = 160`): the card is 100,
the dropdown 246. The earlier `height >= 50% of viewport` test caught only the
results list, which is why the dropdown was covered.

Cost of the subtree observer, measured rather than feared: Maps' body holds
**395** matching elements, 90 survive the cheap rect filter, median scan **0.4 ms**.
A busy session repositions ~1.2×/s; the 220 ms rate limit caps the worst case at
~1.8 ms per second of main thread. `node test/probe-placement-cost.mjs` re-measures.

**`npm run test:widget` is headed on purpose and parks the physical cursor
first.** It was written headed, passed 12/12 alone, then failed 5 of 12 inside
`test:full` because a headed browser also receives the real OS pointer — wherever
the mouse was left decided whether the panel was hovered open. Headless was tried
and removes the pointer, but Chromium headless does not load the unpacked
extension here (measured: 0/3, twice). So the check parks the cursor via
PowerShell and asserts `no stray pointer over the widget at rest` outright.
Note the parking must use `-EncodedCommand`; Node's Windows argv quoting mangled
the `-Command` form on every run while the same text pasted into a shell worked.

## Verification discipline

- **Assert on mean canvas RGB, never screenshot diffs** — map data churns constantly. Light map
  ≈ (223, 231, 230); dark ≈ (36, 54, 76).
- **A dark reading is not a dark map.** `classify()` in `test/lib/image.mjs` once scored a
  pure-black *broken* canvas as DARK. It now requires `distinct12BitColours ≥ 24 ∧ stdev ≥ 5`,
  calibrated against 321 real frames; `isDark` and `isLight` can now both be false.
- **Capture a time series, not a settled frame.** Sample at 500/1500/3000/6000/10000 ms and after
  every gesture. Whether darkness *survives* is the whole question.
- **Synthetic DOM events do not move Maps** — it uses gesture capture. Only Playwright
  `page.mouse.*` (trusted input via CDP) works. Programmatic `.click()` on the zoom button and
  `dispatchEvent(new WheelEvent(...))` both leave the map where it was.
- **Every gate needs its mutation control.** If the extension-absent run does not fail the positive
  assertions, the gate is void — the runner throws rather than reporting a pass.

## Local machine constraints

- Playwright is pinned to **1.62.0** to match the populated `ms-playwright` browser cache
  (`chromium-1234`, `firefox-1538`). A floating version downloads a different build.
- Chrome stable and Firefox Developer Edition are installed, but Playwright cannot attach to Dev
  Edition (it needs a Juggler build) — the Firefox gate uses Playwright's bundled Firefox.
- **Playwright/Vite output is swallowed by the RTK hook.** Use `rtk proxy <cmd>` for raw stderr.
- **Git root is `F:\`, not this directory**, and it is shared with unrelated projects and live
  concurrent sessions — one committed to the shared root mid-session while lanes were running.
  `git status` here shows other projects' files. Scope every path explicitly, stage and commit in a
  single invocation, and never run `git checkout --`, `reset`, `clean`, or `stash`.
