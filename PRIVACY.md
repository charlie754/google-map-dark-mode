# Privacy policy — Google Map Dark Mode

**Last updated: 2026-11-09. Applies to versions 1.0.0 to 1.0.5.**
The GOAT Cam banner was introduced in 1.0.3, and the signed promo update from `goatcam.dagoat.io` described below arrived in 1.0.4 (Chrome only in 1.0.4; from 1.0.5 also in Firefox, after you opt in — see below). 1.0.1 and 1.0.2 showed a
Goat Project banner linking to dagoat.io instead, and 1.0.0 showed no banner.

## The short version

This extension has no account, no analytics, no tracking, and stores its
settings locally on your device.

There is no user account, no sign-in, no user or browser identifier assigned to
you, and no crash or usage reporting. Nothing you do in Google Maps is recorded
or transmitted; the only network requests the extension makes are Google's dark
palette health checks and the promo card download from
goatcam.dagoat.io described below.

## What it stores, and where

All extension state is kept in your browser's local extension storage
(`chrome.storage.local`) on your device:

| Key | What it is |
| --- | --- |
| `settings` | Your three on/off switches: master, dark map, dark interface. |
| `health` | The result of the extension's own last self-check — which of its four rules matched, and whether Google is still serving the dark palette. |
| `rulesetState` | Whether the extension switched itself off because it detected a fault, and why. |
| `legendVersion` | The version hash of Google's palette asset, if one has been observed. Not tied to you; it is the same string for everyone using Maps that day. |
| `goatcamBanner.record` | Cached signed banner file downloaded from `goatcam.dagoat.io`; local only. |
| `goatcamBanner.set.<hash>` | Cached banner image data keyed by content hash; local only. |
| `goatcamBanner.display` | Cached banner display choice and state; local only. |

`storage.sync` is deliberately **not** used. That area syncs through your Google
account and would put extension data on Google's servers; `storage.local` does
not.

You can erase all of it by removing the extension.

## What it sends over the network

For the map dark-mode self-check, the extension's background script makes three
requests to Google, all with `credentials: "omit"` (so no cookies, no session,
nothing that identifies you), and none of them contain anything derived from
your browsing:

1. `HEAD https://www.gstatic.com/maps/res/CompactLegend-RoadmapSatellite-<version>`
2. `HEAD https://www.gstatic.com/maps/res/CompactLegend-RoadmapDark-<version>`
3. `GET  https://www.google.com/maps/vt/pb=…!1sset!2sRoadmapDark!…` — one fixed
   map tile over Houston, the same tile for every user

They exist for one purpose: to check that Google is still serving the dark
palette this extension depends on. If it stops, the extension switches itself
off rather than leave you with a broken Maps. They run when the browser starts
and then at most once every six hours.

These are the same servers Google Maps is already talking to while you use it.

To update the promo card in its own panel, the extension may download a signed public file and image from goatcam.dagoat.io over HTTPS, at most every 6 hours and only while the panel is open. That request carries what every web request carries — your IP address and your browser's user agent and language — plus the extension's public ID; nothing else is sent. In Firefox this happens only if you turn on the optional technical and interaction data permission.

In Firefox that permission is off unless you choose it: in the add-on's install prompt, with the **GOAT Cam banner updates** switch in the toolbar popup or on the settings page (from 1.0.5), or under about:addons → Permissions and data. Turning it off again stops the download; the panel then shows the banner bundled with the extension.

## What it does to Maps' own requests

While you are on Google Maps, the extension redirects Google's own palette
requests from the light palette to Google's own dark palette — for example
`CompactLegend-Roadmap-<hash>` becomes `CompactLegend-RoadmapDark-<hash>`, on
`gstatic.com`. The destination is always another Google address. Nothing is
redirected to any third party, nothing is added to those requests, and their
contents are never read by the extension: the redirect is performed by the
browser's `declarativeNetRequest` engine from a static rule file, which by design
cannot report back what it saw.

That last point is worth stating plainly, because it is the strongest privacy
property here and it is structural rather than a promise: `declarativeNetRequest`
gives an extension no way to observe the URLs it acts on. This extension does not
have the `webRequest` permission and could not watch your traffic if it wanted
to.

## What the interface script does

A content script runs on Google Maps pages. It reads the colour values Maps has
already set on the page, darkens them, and writes them back. It does not read
your searches, your location, your saved places, the page text, or anything you
type, and it never transmits your Maps activity or page content; when you open
the extension's panel, it may request a promo banner update from the extension's
background script as described above.

## Links you click

The popup and options page have two buttons: Ko-fi and Source. Nothing is
requested from either site until you click one, and clicking one just opens a
normal browser tab. Those sites then apply their own privacy policies, exactly as
if you had typed the address yourself.

The panel on the map works the same way for clicks. Besides Ko-fi and "Star Project on
Github", it carries a banner for the author's own app, GOAT Cam. A default banner
photo and QR code are bundled with the extension, and while the panel is open the
extension may download a signed promo update from `goatcam.dagoat.io` as
described above. Clicking it opens https://goatcam.dagoat.io in a
new tab, with nothing about you added to the address. The QR code is only a
picture of an App Store link: the extension never opens it, and it goes
somewhere only if you point your phone's camera at it.

## Permissions, in one line each

| Permission | Why |
| --- | --- |
| `declarativeNetRequestWithHostAccess` | To perform the palette redirect. The `WithHostAccess` form is the narrower one: rules apply only to the sites listed below. |
| `storage` | The local keys listed above. |
| `alarms` | To re-run the six-hourly self-check. |
| Host access to `google.*/maps` and `gstatic.com/maps/res/*` | The redirect and the interface script only work on the pages the map is on. Nothing else is accessed. |

## Verifying all of this

The extension is open source under the MIT licence and nothing in it is minified,
bundled or obfuscated — the files in the package are the files in the repository.
Every claim above can be checked directly:

```bash
# every network call the extension can make (three fetches, one of them internal)
grep -rn "fetch(" extension/

# no analytics, no telemetry, no identifiers
grep -rniE "analytics|telemetry|beacon|tracking|uuid|fingerprint" extension/

# every host that appears anywhere in the source
grep -rhoE "https?://[a-zA-Z0-9.-]+" extension/ | sort -u
```

## Contact

Issues: <https://github.com/charlie754/google-map-dark-mode/issues>
