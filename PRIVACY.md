# Privacy policy — Google Map Dark Mode

**Last updated: 2026-08-07. Applies to version 1.0.0.**

## The short version

This extension collects nothing, sends nothing, and has no analytics.

There is no server belonging to this extension. There is no account, no sign-in,
no identifier of any kind assigned to you or your browser, and no crash or usage
reporting. Nothing you do in Google Maps is recorded, and nothing about you
leaves your computer because of this extension.

## What it stores, and where

One thing, in your browser's local extension storage
(`chrome.storage.local`), which never leaves the device:

| Key | What it is |
| --- | --- |
| `settings` | Your three on/off switches: master, dark map, dark interface. |
| `health` | The result of the extension's own last self-check — which of its four rules matched, and whether Google is still serving the dark palette. |
| `rulesetState` | Whether the extension switched itself off because it detected a fault, and why. |
| `legendVersion` | The version hash of Google's palette asset, if one has been observed. Not tied to you; it is the same string for everyone using Maps that day. |

`storage.sync` is deliberately **not** used. That area syncs through your Google
account and would put extension data on Google's servers; `storage.local` does
not.

You can erase all of it by removing the extension.

## What it sends over the network

Three requests, and only these three. All are made by the extension's own
background script, all carry `credentials: "omit"` (so no cookies, no session,
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
type, and it sends nothing anywhere.

## Links you click

The popup and options page have two buttons: Ko-fi and Source. Nothing is
requested from either site until you click one, and clicking one just opens a
normal browser tab. Those sites then apply their own privacy policies, exactly as
if you had typed the address yourself.

## Permissions, in one line each

| Permission | Why |
| --- | --- |
| `declarativeNetRequestWithHostAccess` | To perform the palette redirect. The `WithHostAccess` form is the narrower one: rules apply only to the sites listed below. |
| `storage` | The four local keys above. |
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
