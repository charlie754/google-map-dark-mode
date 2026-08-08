# Store listing copy — Google Map Dark Mode 1.0.0

Everything a reviewer or a submission form will ask for, written out. Nothing
here can be submitted by an assistant: both stores need an account holder to sign
in, accept a developer agreement, and — for Chrome — pay a one-time US$5
registration fee.

**Artifacts to upload** (produced by `node tools/package.mjs`):

| Store | File |
| --- | --- |
| Chrome Web Store | `dist/google-map-dark-mode-chrome-1.0.0.zip` |
| addons.mozilla.org | `dist/google-map-dark-mode-firefox-1.0.0.xpi` |

The version in both file names comes from the manifests and is checked against
the archived manifest at package time; it is never typed in twice.

---

## Decide these before the first upload

| Thing | Now | Why it matters |
| --- | --- | --- |
| Firefox add-on ID | `google-map-dark-mode@charlie754.github.io` | Settled 2026-08-08. Matches the author's existing convention (`webp-save-as@charlie754.github.io`) and the repository slug. Permanent on AMO once submitted — do not change it after the first upload. Lives in `extension/manifest.firefox.json` under `browser_specific_settings.gecko.id`; the harness derives it from the manifest, so it needs no test edits. Verified: Firefox installs it with zero warnings and `runtime.id` reports it back. |
| Chrome extension ID | assigned on first upload | Chrome ignores the gecko id and assigns its own. |
| `homepage_url` | not set | Optional. Both stores show it. `https://github.com/charlie754/google-map-dark-mode` is the obvious value. |
| Author | not set | Optional; shown on both stores. |
| Privacy policy URL | `PRIVACY.md` in the repo | Neither store requires one when nothing is collected, but pointing at a real document makes review faster. Chrome's data-usage tab wants an explicit "no data collected" declaration either way. |
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
> • Nothing collected, nothing transmitted, no analytics, no accounts, no servers
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

> Renders the Google Maps website in dark colours: the map surface, by asking
> Google Maps for Google's own dark map palette instead of its light one, and the
> surrounding interface, by darkening the colour values the page already
> declares.

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
> last self-check, and whether the extension has disabled itself because it
> detected a fault. `chrome.storage.local` only — `storage.sync` is deliberately
> not used, because that area would place extension data on a remote server via
> the user's Google account. Nothing user-identifying is stored and nothing is
> transmitted.

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
> queries, location, saved places, form input or cookies, and it transmits
> nothing.
>
> The full list is 22 Google origins plus `gstatic.com/maps/res/*`:
> `google.com`, `maps.google.com`, `google.co.uk`,
> `google.de`, `google.fr`, `google.it`, `google.es`, `google.nl`, `google.pl`,
> `google.se`, `google.com.tr`, `google.ca`, `google.com.mx`, `google.com.br`,
> `google.co.jp`, `google.co.in`, `google.co.id`, `google.co.kr`,
> `google.com.hk`, `google.com.tw`, `google.com.sg`, `google.com.au`.

### Data usage declaration (Chrome's privacy tab)

> Discloses **no** data collection of any category. The extension has no server,
> no analytics, no telemetry, no identifiers and no remote logging. Its only
> outbound requests are two `HEAD` requests and one fixed map-tile `GET` to
> Google's own servers, all with credentials omitted, whose sole purpose is to
> check that the dark map style is still available. Full statement:
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

**"Why does the code make network requests at all if it collects nothing?"**

> Three requests, on a six-hour timer, all to Google and all with credentials
> omitted, all containing nothing derived from the user: two `HEAD`s that ask
> whether the dark palette is still being served, and one `GET` of a single fixed
> map tile over Houston — the same tile for every user — because that endpoint
> returns HTTP 200 with a 178-byte error image rather than a 404, so its size is
> the only available signal. If the answer is that the dark style is gone, the
> extension disables its own rules.

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

---

## After the first release

Version numbers must increase for every upload. They live in
`extension/manifest.chrome.json` and `extension/manifest.firefox.json`, and
`node tools/package.mjs` fails loudly if the two disagree. AMO rejects a
re-upload of an existing version outright; Chrome does the same.
