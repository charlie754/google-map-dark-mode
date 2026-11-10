# Store listing copy — Google Map Dark Mode 1.0.5

Everything a reviewer or a submission form will ask for, written out. Nothing
here can be submitted by an assistant: both stores need an account holder to sign
in, accept a developer agreement, and — for Chrome — pay a one-time US$5
registration fee.

**Artifacts to upload** (produced by `node tools/package.mjs`):

| Store | File |
| --- | --- |
| Chrome Web Store | `dist/google-map-dark-mode-chrome-1.0.5.zip` |
| addons.mozilla.org | `dist/google-map-dark-mode-firefox-1.0.5.xpi` |

The version in both file names comes from the manifests and is checked against
the archived manifest at package time; it is never typed in twice.

**1.0.5** (2026-11-09) — the Transit layer is now dark too: Maps switches to a
separate Transit palette when Layers → Transit is on, and the extension now asks
for Google's dark version of it (Chrome and Firefox). Terrain also covers Google's
newer vector terrain palette, which some setups use and which stayed light, and
the mountains (hillshade and landcover) are now dark too on computers where Maps
draws with the graphics card. In Firefox, the panel now shows the
same GOAT Cam banner as Chrome, built into the add-on: Firefox makes no request to
goatcam.dagoat.io and asks for no data-collection permission (it declares none).
Chrome behaviour is unchanged.

**1.0.4** (2026-11-06) — the GOAT Cam banner can now be updated without a new
release. While the panel is open, the extension may download a signed promo file
and photo from goatcam.dagoat.io (at most every 6 hours), checks the signature,
size and expiry date, and shows it; offline, or if the file is bad or expired, the
panel shows the original DaGoat.io banner instead. In Firefox the download stays
off in this version, so Firefox users see the DaGoat.io banner. The panel also
stays on screen, and scrolls, in short windows at high browser zoom.
Dark-mode behaviour is unchanged.

**1.0.3** (2026-10-25) — the banner under StarGithub now promotes the author's
own app, GOAT Cam (it turns an iPhone into a webcam for a Windows 11 PC),
replacing the Goat Project lockup. Same place: one line of copy above a plate
that is the only link. The plate is the GOAT Cam site's own coffee photo, edge to
edge, with the GOAT Cam wordmark on it and an App Store QR code that enlarges
when hovered or keyboard-focused so a phone can scan it; the goat mark, seal,
meteors and the second line of copy are gone. Motion plays only on hover or
focus, and reduced-motion mode keeps nothing that travels. The plate opens
https://goatcam.dagoat.io in a new tab. In 1.0.3 the photo and QR code shipped
inside the extension and showing the banner made no network request.
Dark-mode behaviour is unchanged.

**1.0.2** (2026-08-20) — same Goat lockup as 1.0.1, plus panel hover polish:
toggle pills enlarge on hover (not the whole row); the Dark Mode header lifts
while the panel is open. Dark-mode behaviour is unchanged. 1.0.0 and 1.0.1
archives stay in `dist/`. AMO already published 1.0.1, so this is the next
Firefox upload.

**1.0.1** (2026-08-19) — in-page panel carries the GOATPROJECT lockup and two
campaign lines under StarGithub. Dark-mode behaviour is unchanged from 1.0.0.

---

## Decide these before the first upload

| Thing | Now | Why it matters |
| --- | --- | --- |
| Firefox add-on ID | `google-map-dark-mode@charlie754.github.io` | Settled 2026-08-08. Matches the author's existing convention (`webp-save-as@charlie754.github.io`) and the repository slug. Permanent on AMO once submitted — do not change it after the first upload. Lives in `extension/manifest.firefox.json` under `browser_specific_settings.gecko.id`; the harness derives it from the manifest, so it needs no test edits. Verified: Firefox installs it with zero warnings and `runtime.id` reports it back. |
| Chrome extension ID | assigned on first upload | Chrome ignores the gecko id and assigns its own. |
| `homepage_url` | not set | Optional. Both stores show it. `https://github.com/charlie754/google-map-dark-mode` is the obvious value. |
| Author | not set | Optional; shown on both stores. |
| Privacy policy URL | `PRIVACY.md` in the repo | Pointing at `PRIVACY.md` documents the local storage keys, the Google palette self-check, and the signed promo banner download from `goatcam.dagoat.io` so store review and the data-usage declaration match. |
| Screenshots | none yet | Chrome requires at least one at 1280×800 or 640×400. AMO does not require any but shows them if present. A side-by-side of Maps with and without the extension is the obvious shot. |

---

## Name and descriptions

**Name:** Google Map Dark Mode

**Short description / summary (under 132 characters for Chrome, 250 for AMO):**

> A real dark mode for Google Maps — using Google's own dark map style, not a
> filter. Unofficial; not affiliated with Google.

**Full description:**

> Google Maps on the web has no dark mode. This adds one.
>
> It is not a colour filter and not an inverted screenshot. Google already draws
> a dark version of its own maps — the night cartography you have seen in the
> Maps mobile app — and serves the palette for it from its own servers. This
> extension asks Google Maps for that palette instead of the light one. The
> colours you get are the ones Google's cartographers chose, at every zoom level.
>
> The interface around the map is darkened separately, by reading the colour
> values Maps has already set on the page and darkening each one while keeping
> its hue. Photographs, satellite imagery, Street View and avatars are left
> exactly as they are, because a darkened photograph is not a night view.
>
> • Dark map and dark interface, on by default
> • Three switches: master, dark map, dark interface — turn any of them off
> • No account, no analytics, no tracking, and settings stored locally on your device
> • The panel also shows a small first-party banner for the author's own iPhone app, GOAT Cam.
>   There is no ad network; while the panel is open, the extension may download a
>   signed promo card and image from goatcam.dagoat.io (Chrome only; the Firefox
>   add-on has the banner built in and makes no such request), and clicking it opens goatcam.dagoat.io while its QR code links to the App Store.
> • Free and open source under the MIT licence
>
> It checks its own health: if Google stops serving the dark map style, the
> extension notices and switches itself off rather than leave Maps broken.
>
> Unofficial. Not affiliated with, endorsed by, sponsored by or connected to
> Google. "Google" and "Google Maps" are trademarks of Google LLC. This extension
> relies on undocumented behaviour of the Google Maps website, which Google can
> change or remove at any time, and if that happens the extension will stop
> working.
>
> Source: https://github.com/charlie754/google-map-dark-mode

**Category:** Chrome Web Store — *Tools* (secondary: *Accessibility*).
AMO — *Appearance*.

**Chrome "single purpose" statement:**

> Renders the Google Maps website in dark colours — the map surface, by asking
> Google Maps for Google's own dark map palette instead of its light one, and the
> surrounding interface, by darkening the colour values the page already
> declares — with an in-page control panel that includes a first-party promo for
> the developer's own app (GOAT Cam).

---

## Permission justifications

Write these into Chrome's per-permission justification fields, and use the same
wording if an AMO reviewer asks. Each one says what the permission is for and
what it is *not* used for, because the second half is what a reviewer is actually
checking.

### `declarativeNetRequestWithHostAccess`

> The extension's core function is to redirect one Google request to a different
> Google address. Google Maps fetches its map palette from
> `https://www.gstatic.com/maps/res/CompactLegend-Roadmap-<version>`; a dark
> variant of that same asset, `CompactLegend-RoadmapDark-<version>`, is served by
> Google from the same host. Four static rules rewrite that one name, and the
> equivalent style token on Maps' tile requests. The destination is always
> another Google address on a host the user has already granted; nothing is
> redirected to any third party, no request is blocked, and no header is
> modified.
>
> `declarativeNetRequestWithHostAccess` is chosen over `declarativeNetRequest`
> deliberately, because it is the narrower of the two: the rules only apply to
> the hosts listed in `host_permissions` and nowhere else.
>
> The extension does **not** request `webRequest`. `declarativeNetRequest` gives
> an extension no way to observe the URLs its rules act on, so this design cannot
> read the user's traffic even in principle — the rules are a static JSON file
> the browser applies on the extension's behalf.

### `storage`

> Stores the user's three on/off switches, the result of the extension's own
> last self-check, whether the extension has disabled itself because it
> detected a fault, and the cached GOAT Cam promo record, image set and display
> choice. `chrome.storage.local` only — `storage.sync` is deliberately
> not used, because that area would place extension data on a remote server via
> the user's Google account. All stored values stay in local extension storage
> on the device, with no user account or tracking identifier.

### `alarms`

> Re-runs the self-check every six hours. This extension depends on an
> undocumented Google asset that can be withdrawn at any time; when that happens
> the extension must notice and disable its own redirect rules, because leaving
> them armed against a missing asset breaks the Google Maps interface for the
> user. A Manifest V3 service worker is torn down when idle, so a periodic alarm
> is the only way to wake it for that check.

### Host permission: `https://www.gstatic.com/maps/res/*`

> The map palette asset lives here. This is the request the extension redirects,
> and the path is narrowed to `/maps/res/` — the extension has no access to the
> rest of `gstatic.com`. The self-check also sends two `HEAD` requests here, with
> credentials omitted, to confirm the dark palette is still being served.

### Host permissions: `https://www.google.com/*`, `https://maps.google.com/*` and twenty regional `google.<cctld>` domains

> Google Maps is served from `google.com/maps` and from a per-country domain —
> `google.co.uk/maps`, `google.de/maps`, `google.co.jp/maps` and so on — and a
> user in that country is redirected to their local one automatically. Each is a
> separate origin, so each must be listed; there is no wildcard that covers
> them, and a wildcard over `google.*` would be far broader than what is needed.
>
> On these hosts the extension does two things and nothing else: it applies the
> map-tile rules described above, and it runs one content script on `/maps`
> pages that recolours the page's own CSS custom properties. That script reads
> colour values and writes colour values. It does not read page text, search
> queries, location, saved places, form input or cookies, and it never sends map
> activity or page content anywhere; while the in-page panel is open, it may ask
> the background script to refresh the signed GOAT Cam promo card from
> `goatcam.dagoat.io`.
>
> The full list is 22 Google origins plus `gstatic.com/maps/res/*`:
> `google.com`, `maps.google.com`, `google.co.uk`,
> `google.de`, `google.fr`, `google.it`, `google.es`, `google.nl`, `google.pl`,
> `google.se`, `google.com.tr`, `google.ca`, `google.com.mx`, `google.com.br`,
> `google.co.jp`, `google.co.in`, `google.co.id`, `google.co.kr`,
> `google.com.hk`, `google.com.tw`, `google.com.sg`, `google.com.au`.

### Data usage declaration (Chrome's privacy tab)

> The extension has no user account, no analytics, no tracking, no telemetry,
> and stores settings locally. For its dark-palette self-check, it makes two
> `HEAD` requests and one fixed map-tile `GET` to Google's own servers, all with
> credentials omitted, whose sole purpose is to check that the dark map style is
> still available. To update the promo card in its own panel, the extension may download a signed public file and image from goatcam.dagoat.io over HTTPS, at most every 6 hours and only while the panel is open. That request carries what every web request carries — your IP address and your browser's user agent and language — plus the extension's public ID; nothing else is sent. This happens in Chrome only; the Firefox add-on has the banner built in and never contacts goatcam.dagoat.io. Full statement:
> https://github.com/charlie754/google-map-dark-mode/blob/main/PRIVACY.md

---

## Things a reviewer will probably ask, answered

**"Is this affiliated with Google?"**

> No. It is unofficial and unaffiliated. The listing says so in the description,
> the extension's own manifest description says so, and the options page says so.
> "Google" and "Google Maps" are trademarks of Google LLC. The name describes
> what the extension does to a website; it does not claim to be published by
> Google.

**"You are redirecting requests to another site."**

> To a different address on Google's own servers, from Google's light map palette
> to Google's dark one. `gstatic.com` → `gstatic.com`, `google.com` →
> `google.com`. The rules are four lines of static JSON in the package
> (`rules/dark-map.json`) and can be read in full in under a minute; each is
> anchored to a Google host and each rewrites one style name.

**"Why does the code make network requests at all?"**

> For dark-mode health checks, it makes three requests on a six-hour timer, all
> to Google and all with credentials omitted, containing nothing derived from the
> user: two `HEAD`s that ask whether the dark palette is still being served, and
> one `GET` of a single fixed map tile over Houston — the same tile for every
> user — because that endpoint returns HTTP 200 with a 178-byte error image
> rather than a 404, so its size is the only available signal. If the answer is
> that the dark style is gone, the extension disables its own rules. In addition,
> while the panel is open, it may download a signed public promo file and image
> from `goatcam.dagoat.io` at most every 6 hours (Chrome only; the Firefox add-on
> ships that banner inside the package and makes no request for it).

**"The panel shows a banner for another product."**

> It is a first-party promo for the author's own app, GOAT Cam, and nothing
> else: there is no ad network and no third-party advertising. A fallback photo
> (`data:` image, CC0 "White cup and MacBook" by Alex Knight) and inline SVG QR
> code are bundled inside the package, and while the panel is open the extension
> may download a signed promo update and image from `goatcam.dagoat.io` over
> HTTPS (cached locally in `chrome.storage.local`). It never contacts the App
> Store directly. Clicking the banner opens `https://goatcam.dagoat.io` in a new
> tab (`rel="noopener noreferrer"`, no query string), exactly like the Ko-fi and
> GitHub buttons. The QR code is a picture of an App Store link; only a phone
> camera can follow it.

**"Is any of the code minified, bundled or obfuscated?"**

> No. There is no build step beyond copying files and swapping in the
> per-browser manifest. The files in the package are the files in the
> repository. AMO source-code upload should not be required.

**"What happens if Google changes something?"**

> The extension detects it and switches itself off, and the toolbar badge shows
> a warning. This is stated in the listing rather than hidden: the description
> says the extension relies on undocumented Google behaviour that can change at
> any time.

---

## What must not be claimed

Recorded here so a future edit of the copy above does not quietly cross one of
these lines:

- Do **not** imply Google affiliation, endorsement, sponsorship or partnership,
  in the name, the icon, the screenshots or the copy.
- Do **not** claim this is "Google Maps dark mode" as though it were a Google
  feature being unlocked. It is a third-party extension that changes which of
  Google's own assets the page requests.
- Do **not** claim it works everywhere. Satellite, Street View, directions,
  `/maps/embed` and the regional domains are untested; the description does not
  claim them.
- Do **not** claim it is permanent or guaranteed. It depends on undocumented
  behaviour, and the listing says so.
- Do **not** describe the health check as "monitoring" or "diagnostics" in a way
  that could read as collecting anything. It checks a Google URL, not the user.
- Do **not** describe GOAT Cam as a microphone (version 1 is camera-only) or
  quote a price for it, here or in the banner.

---

## After the first release

Version numbers must increase for every upload. They live in
`extension/manifest.chrome.json` and `extension/manifest.firefox.json`, and
`node tools/package.mjs` fails loudly if the two disagree. AMO rejects a
re-upload of an existing version outright; Chrome does the same.
