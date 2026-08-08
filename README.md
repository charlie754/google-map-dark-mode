# Google Map Dark Mode

A dark mode for Google Maps on the web that uses **Google's own dark
cartography** — not a filter, not an inverted screenshot, not a CSS hue rotate.
Chrome and Firefox, Manifest V3, no dependencies, no servers, no tracking.

Unofficial. Not affiliated with, endorsed by, or connected to Google.

![The extension running on Google Maps: the on-page panel, the three switches, and the map turning dark](docs/media/demo.gif)

<img src="docs/evidence/tile-z13-Roadmap.png" width="256" alt="Google's light map tile"> <img src="docs/evidence/tile-z13-RoadmapDark.png" width="256" alt="Google's own dark map tile, which is what this extension makes Maps use">

*Left: what Maps normally serves. Right: what it serves when asked for the dark
style. Both are Google's, and both come from Google's servers.*

---

## How it works

This is the interesting part, and it is worth stating plainly because it is not
what dark-mode extensions usually do.

### The map surface: a string substitution

Google Maps renders the base map in one of three ways, chosen client-side by a
capability probe. In the two you will actually get on a desktop browser, the map
geometry arrives without any colours in it. The palette comes separately, from a
static, unauthenticated, style-name-keyed asset on `gstatic.com`:

```
https://www.gstatic.com/maps/res/CompactLegend-Roadmap-<32-hex-version>
```

`CompactLegend-RoadmapDark-<the same version>` also exists, is served with
HTTP 200, and is about 1.9 MB of Google's own night cartography — the palette
behind the dark map you have seen in the Maps mobile app. `Terrain` and
`TerrainDark` likewise.

So darkening the map is a **pure string substitution on a URL**. No protobuf
surgery, no length arithmetic, no re-encoding: four
`declarativeNetRequest` rules rewrite `Roadmap` to `RoadmapDark` in Google's own
request, and the WebGL renderer draws Google's real dark map. The colours you get
are the ones Google's cartographers chose, at every zoom level, with the label
haloes and road casings they designed for a dark background.

Four rules, because three renderer modes take their palette from two different
places:

| Rule | Rewrites | Covers |
| --- | --- | --- |
| 1 | `CompactLegend-Roadmap-<v>` → `-RoadmapDark-` | the vector renderer (stock desktop Chrome) and Firefox's canvas+labeler renderer — **the one that matters** |
| 2 | `CompactLegend-Terrain-<v>` → `-TerrainDark-` | the same, for the Terrain base map |
| 3 | `/maps/vt/stream/pb=…!2s(Roadmap\|Terrain)!` → `…Dark!` | the plain-canvas fallback, which colours server-side |
| 4 | `/maps/vt/pb=…!2s(Roadmap\|Terrain)!` → `…Dark!` | the first-paint raster grid, present in every mode — its only job is to remove a ~1 second light flash |

An invalid style name 404s cleanly, which is how the extension can tell whether
this still works (see *Self-check*, below).

### The interface: remapping design tokens, never selectors

Maps' surrounding UI is built on Material 3 design tokens: several hundred CSS
custom properties on `:root`, most of them hash-named
(`--t5b35d265ba7ac78d: #1f1f1f`). The hashes rotate on every Google rebuild, the
class names are obfuscated, and every stable element id Maps used to have is
gone. Anything written against a selector or a token name is a permanent
treadmill.

So the content script does not write selectors. It enumerates whatever custom
properties are on the page at runtime, works out which of them are colours,
transforms each one's lightness in OKLCH — a colour space where changing
lightness leaves the hue where it was — and writes them back. Exceptions are
keyed by resolved colour *value*, never by token name, for the same reason.

It deliberately leaves alone: the map canvas (already dark by other means),
photographs, Street View, satellite imagery, avatars, translucent black shadows
and scrims, and translucent white washes over imagery. Inverting those is what
makes a generic dark-mode extension look broken.

### Self-check, and switching itself off

Chrome silently drops a `declarativeNetRequest` rule whose compiled regex exceeds
a 2 KB memory budget. The extension still installs, the ruleset still reports as
enabled, no error is raised anywhere, and the only symptom is that the map stays
light. So the extension never infers health from "the ruleset is enabled": on
startup and every six hours it puts every rule through a real matching oracle
against a real captured URL, and separately checks that Google is still serving
the dark palette.

If it finds that the dark style has stopped being served, it **disables its own
ruleset**. That is not politeness. Measured: with the rules still armed and the
dark palette gone, Maps' palette fetch 404s, and Maps never finishes mounting —
46 buttons become 6, the zoom controls, Street View, the Layers widget and the
attribution bar all vanish. A handsome dark map with no working Maps underneath
it is worse than no extension at all.

---

## Install

**Chrome / Edge / Brave** — not yet on the Chrome Web Store. To load it yourself:

```bash
node tools/build.mjs
```

then open `chrome://extensions`, turn on **Developer mode**, click **Load
unpacked**, and choose `dist/chrome/`.

**Firefox** — not yet on addons.mozilla.org. Firefox will not install an unsigned
XPI permanently, so load it temporarily:

```bash
node tools/package.mjs
```

then open `about:debugging#/runtime/this-firefox`, click **Load Temporary
Add-on…**, and choose `dist/google-map-dark-mode-firefox-1.0.0.xpi`. A temporary
add-on is removed when Firefox closes.

Dark mode is **on by default**. The toolbar button has three switches: a master
one, the dark map, and the dark interface, each of which can be turned off
independently.

---

## The on-page control

The toolbar popup is a long way from where you are actually looking, so the same
three switches are also on the map itself: a small **Dark Mode** pill that reads
its own state, and expands into the full panel when you hover or focus it.

It places itself by measurement rather than by selector, because Maps' class
names are obfuscated and rotate:

- normally it sits in the top-left, **below** whatever Google has put there —
  the search field alone, or the weather and traffic card when that appears
- when you run a search, Google's results column takes over the left side, so
  the pill **moves onto the map** instead, and drops below the category filter
  chips rather than covering them
- it re-measures on resize and whenever Maps rebuilds that corner

It lives in a shadow root. That is not incidental: the sibling content script
rewrites every colour-valued custom property on `:root`, and without the shadow
boundary this panel's own palette would be transformed along with Maps'.

Credits: the GitHub button is [fuzzy-warthog-48 by
Itskrish01](https://uiverse.io/Itskrish01/fuzzy-warthog-48) from uiverse.io,
rewritten from Tailwind utilities into plain CSS so it works inside the shadow
root. The four keyframes it references are not published on that page — they
live in the author's own Tailwind config — so those are reconstructed from how
each one is used. The rest of the panel follows the glass/accent vocabulary of
the GOAT desktop app.

---

## Limitations — the honest list

- **This depends on undocumented Google behaviour.** Nothing here is a public
  API. Google can rename the palette asset, stop serving the dark variant, or
  change how Maps requests it, on any day and without notice. If that happens the
  extension detects it and switches itself off, but it cannot fix it.
- **Satellite and Street View are not darkened, on purpose.** They are
  photographs. A darkened photograph is not a night view, it is a broken one.
- **The Google account bar in the top right stays light.** That strip is drawn
  outside the token system the rest of Maps uses, with its colours written into
  the page directly, so there is nothing there to remap.
- **Panel drop-shadows lose definition.** Maps hard-codes them as
  `rgba(0,0,0,…)` in CSS rules rather than as tokens. Inverting a translucent
  black shadow is one of the things that makes dark-mode extensions look wrong,
  so they are correctly left alone — at the cost of less separation between dark
  panels.
- **Never exercised:** directions, `/maps/embed`, Street View, and the regional
  `google.<cctld>` domains. Twenty regional domains are in the manifest —
  `google.co.uk`, `google.de`, `google.co.jp` and so on — and not one of them has
  ever been driven by the gate. Everything proven live was proven on
  `google.com`.
- **Terrain is proven offline, not live.** The rules cover the Terrain base map
  and Chrome's own engine confirms they match, but no gate has driven live Maps
  with Terrain selected.
- **Firefox rule health degrades to "unknown".** `testMatchOutcome` does not
  exist there, so the self-check falls back to a weaker oracle that proves the
  engine compiled each rule but not that it matched.
- **One trial per browser.** The live gate results are single runs, not
  repeated-trial statistics.

---

## Build and test

Node 24, `npm install`. No runtime dependencies; the only dev dependencies are
Playwright and pngjs, both used by the harness and neither shipped.

```bash
node tools/build.mjs      # extension/ -> dist/chrome/ and dist/firefox/
node tools/package.mjs    # build, then the store ZIP and XPI, verified from disk

npm test                  # 35 offline checks, ~130 ms, no network, no browser
npm run test:theme        # 28 interface-theme checks (browser, no network)
npm run test:dnr          # the 2 KB DNR trap detector (browser)
npm run test:liveness     # is Google still serving the dark palette? (network)
npm run test:package      # install the built ZIP and XPI in real browsers
npm run test:full         # build + the four offline/browser suites above

npm run gate:live:all     # the live gate: Chrome + Firefox + both controls
```

`npm test` names its two files explicitly rather than globbing: `node --test`
over-collects everything under a path containing `test/`, which would launch
browsers from the suite that is supposed to be offline.

**The shipped version number lives in `extension/manifest.chrome.json` and
`extension/manifest.firefox.json`, and nowhere else.** `package.json` is the
harness's, not the extension's. `tools/package.mjs` reads the version from the
built manifests and refuses to package if the two disagree.

### How this project verifies things

Some of this is unusual, and all of it was learned the hard way:

- **Assertions are on mean canvas RGB, never screenshot diffs.** Live map data
  churns constantly. Light map ≈ (223, 231, 230); dark ≈ (36, 54, 76).
- **A dark reading is not a dark map.** The classifier once scored a pure-black
  *broken* canvas as DARK. It now requires ≥ 24 distinct quantised colours and a
  standard deviation ≥ 5, calibrated against 321 real frames, and "dark" and
  "light" can now both be false.
- **A time series, not a settled frame.** An earlier approach produced a
  correct dark map for about a second before the vector renderer painted over
  it, and a single settled screenshot cannot tell that apart from a map that was
  dark all along.
- **Synthetic DOM events do not move this map.** Maps uses gesture capture and
  honours only trusted input, which is why the gate is a Playwright harness
  driving real pointer events rather than a page script.
- **Every gate has a mutation control.** If a run with the extension *absent*
  still satisfies the positive assertions, the gate declares itself VOID rather
  than passing — because then those assertions were never measuring the
  extension. Every offline mutation test likewise feeds the suite a deliberately
  broken ruleset and requires it to be caught.

---

## Privacy

Nothing is collected, nothing is transmitted, there are no analytics and there is
no server. The full statement, with the greps to verify it yourself, is in
[PRIVACY.md](PRIVACY.md).

## Licence

MIT — see [LICENSE](LICENSE).

## Support

If this is useful to you, you can leave a tip:

**[☕ Ko-fi — @IRP_HongKong](https://ko-fi.com/irp_hongkong)**

It is free and open source and staying that way. A tip is a one-off; nothing in
the extension changes either way.
