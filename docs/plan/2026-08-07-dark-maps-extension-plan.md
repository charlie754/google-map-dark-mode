# Implementation plan — dark mode for Google Maps web (Chrome + Firefox)

**Date:** 2026-08-07
**Status:** Draft for approval — no code written yet
**Depends on:** [`../research/2026-08-07-google-maps-dark-mode-feasibility.md`](../research/2026-08-07-google-maps-dark-mode-feasibility.md)

---

## 1. Strategy in one paragraph

The page splits cleanly into two surfaces that need two completely different techniques,
and **both have been verified live**:

| Surface | Technique | Status |
|---|---|---|
| **L1 — the map itself** (WebGL canvas, worker-rendered) | Rewrite the base-map tile URL `!2sRoadmap!` → `!2sRoadmapDark!` at the **network layer**, so Google's own servers return dark cartography | Dark tiles proven real & unauthenticated; interaction-time coverage **unproven — M0 gate** |
| **L2 — the app chrome** (side panel, search, cards, buttons) | Recompute Maps' ~215 colour-valued **Material 3 CSS custom properties** and override them on `:root` | **Proven live**: white panel `#fff` → `#000`, `#f2f2f2` → `#0d0d0d`, accent `rgb(0,123,139)` → `rgb(0,197,223)` |

No `filter: invert()`. No shader injection. Nothing that mangles photos or POI icons.

---

## 2. L1 — the map surface

### 2.1 The rewrite

Match Maps' base-map tile requests and substitute the style token:

```
regexFilter:        ^(https://[^/]+\.google\.[a-z.]{2,10}/maps/vt/pb=[^!]*(?:![^!]*)*?!2s)Roadmap(!.*)$
regexSubstitution:  \1RoadmapDark\2
```

In practice the simpler `^(https://[^/]+/maps/vt/pb=.*!2s)Roadmap(!.*)$` scoped by host
permissions is enough; keep the regex as tight as the RE2 budget allows.

Notes that matter:
- The trailing `!` in the capture is what prevents a **redirect loop** — the rewritten URL
  contains `!2sRoadmapDark!`, which the pattern cannot match again.
- `resourceTypes` must include `image`, `xmlhttprequest` and `other`: tiles are requested
  both from the page and from the mapcore **Web Worker**, and worker `fetch` is classified
  as `xmlhttprequest`. This is the whole reason the network layer is the right hook — it
  sits below the worker boundary that defeats every in-page JS hook.
- Host coverage: `www.google.com`, `maps.google.com`, regional `google.<cctld>`, and
  `/maps/embed` iframes.

### 2.2 Health probe (mandatory)

`RoadmapDark` is an **undocumented internal token**. On startup, and once every 24 h, the
background script fetches a fixed known tile with the dark token:

- response ≥ 5 KB → healthy
- response ≈ 178 bytes (Google's yellow "invalid style" tile) or non-200 → **token is
  dead**: disable the DNR ruleset, set the action-icon badge to a warning, and fall back to
  L3.

Never let a user see a yellow error tile.

### 2.3 L3 — the fallback, only if the probe fails or M0 fails

CSS `filter: invert(1) hue-rotate(180deg)` on the map-surface container (the `<div>` that
holds the two stacked canvases — currently `div.D21QYe`, selected structurally, never by
that literal class). Verified to apply cleanly without breaking compositing. Ships
**disabled**; it is a degraded mode, and the UI must say so.

---

## 3. L2 — the app chrome

### 3.1 Why token remapping, not selector hunting

Every stable hook the old Maps had is **gone** in the current build — `#omnibox`, `#pane`,
`#content-container`, `#searchboxinput`, `#QA0Szd` are all absent; only `#gb` (the Google
bar) survives, and class names are obfuscated and rotate (`D21QYe`, `Qyw4Zb`, `LoJzbe`).
Any selector-based dark theme is a permanent maintenance treadmill.

But Maps is built on Material 3 design tokens: **386 CSS custom properties on `:root`, 215
of them colour-valued**. 356 are hash-named (`--t5b35d265ba7ac78d: #1f1f1f`); 30 carry
readable names (`--web-maps-color-state-layer-on-surface-hover`) and mostly *reference* the
hashed ones. Overriding the hashed tokens re-themes the entire chrome at once.

### 3.2 Derive, don't hard-code

Hash names change whenever Google rebuilds, so the extension must **never ship a table of
token names**. At runtime:

1. Enumerate every `--*` property on `getComputedStyle(document.documentElement)`.
2. Keep the ones whose value parses as a colour.
3. Map each to its dark counterpart — invert perceived lightness, preserve hue and alpha.
   (The verification pass used a relative-luminance scale with a ×3 clamp; production
   should do this in OKLCH for better hue stability and contrast control.)
4. Write the results back with `setProperty(name, value, 'important')` on `:root`.

A content script in the isolated world can do all of this — no MAIN-world injection needed.

### 3.3 Exceptions

An algorithmic pass will get a handful of tokens wrong: Google brand colours, POI category
colours, the `#gb` bar, anything already dark. Ship a small **hand-curated override table**
applied after the algorithmic pass, keyed by *resolved light value* (e.g. "wherever the
token equals `#1a73e8`, use `#8ab4f8`") rather than by hash name — value-keyed rules
survive hash rotation.

### 3.4 Avoiding the white flash

- `document_start`: static stylesheet setting `color-scheme: dark` plus a dark page
  background, so first paint is never white.
- Then run the remap on `requestAnimationFrame` once stylesheets exist, and re-run from a
  `MutationObserver` on `<head>` — Maps lazy-loads CSS modules after first paint.
- Cache the derived table in `chrome.storage.session`, keyed by a fingerprint of the
  stylesheet set, so warm loads apply in one frame.

---

## 4. Milestones

| # | Milestone | Exit gate (evidence required) |
|---|---|---|
| **M0** | **Feasibility spike.** Unpacked extension, one DNR rule, nothing else. Load in Chrome and Firefox, open Maps, **pan and zoom by hand**. | Screenshot of a dark Maps **plus** a devtools network log showing `2sRoadmapDark` on *every* base-map request during pan/zoom at ≥3 zoom levels. **If interaction-time tiles bypass this endpoint, stop and re-plan around L3.** |
| M1 | Tile layer hardened: regional TLDs, `maps.google.com`, `/maps/embed`; ruleset toggled via `updateEnabledRulesets`; health probe; service-worker cache interaction checked. | Rule matches logged on 5 TLDs; probe flips to fallback when fed a deliberately bad token. |
| M2 | L2 token remap shipped: derivation, exception table, flash prevention. | Before/after screenshots of side panel, search, place card, directions panel; WCAG AA contrast check on body text and buttons. |
| M3 | Options UI: on/off, follow-system, map-only / chrome-only, fallback toggle. | State survives reload and syncs across tabs. |
| M4 | Cross-browser packaging: Chrome MV3 service worker vs Firefox MV3 event page; shared source, per-target manifest. | Clean load in Chrome stable and Firefox Dev Edition from the built artifacts. |
| M5 | Store submission: privacy justification, screenshots, listing copy. | Packages pass `web-ext lint` and Chrome's upload validation. |

M0 is not a formality. It is the single unproven link in the chain.

---

## 5. Cross-browser mechanics

Shared source, two generated manifests.

**Chrome (MV3)**
- `"permissions": ["declarativeNetRequestWithHostAccess", "storage"]` — the
  `WithHostAccess` variant confines rules to hosts already granted, which reads far better
  in review than blanket `declarativeNetRequest`.
- `"host_permissions"`: the Google Maps origins only.
- `"background": { "service_worker": "background.js" }`
- Static ruleset declared in `declarative_net_request.rule_resources`, shipped `enabled:
  false`, switched on at runtime.

**Firefox (MV3)**
- Also supports `declarativeNetRequest`, so the same ruleset works — keep DNR as the shared
  primary path.
- Firefox **retains blocking `webRequest`** in MV3 (unlike Chrome), so
  `webRequest.onBeforeRequest` → `{redirectUrl}` is available as a documented escape hatch
  if Gecko's DNR regex redirect misbehaves. Do not build on it unless DNR fails.
- `"background": { "scripts": ["background.js"] }` (event page, not a service worker).
- `"browser_specific_settings": { "gecko": { "id": "…", "strict_min_version": "128.0" } }`
  — required for AMO signing.
- Firefox orders rulesets session > dynamic > static, which Chrome does not guarantee.
  With one rule this is moot; keep it that way.

Build step: `esbuild` for JS, plus a tiny script that emits `manifest.json` per target from
a shared base. No framework — this extension is a few hundred lines.

---

## 6. Testing on this machine

Constraints already established here:

- **Firefox:** only Dev Edition is installed. Use an unsigned XPI + a temp profile + a
  pinned extension UUID for fully headless end-to-end runs.
- **Playwright/Vite output is swallowed by the RTK hook** — run those through
  `rtk proxy <cmd>` whenever raw stderr matters.
- Chrome: launch with `--load-extension` + `--disable-extensions-except` against a temp
  profile.

Test layers:
1. **Unit** — colour transform (light→dark) and the health-probe classifier (178-byte
   yellow tile vs real tile) as pure functions.
2. **Rule** — `declarativeNetRequest.testMatchOutcome` against a captured corpus of real
   tile URLs. On Firefox this needs `declarativeNetRequestFeedback` and
   `extensions.dnr.feedback = true`.
3. **E2E** — drive real Maps, assert every `/maps/vt` base-map request carries
   `RoadmapDark`, and sample the rendered canvas's mean RGB to confirm it is dark.
   Sampling mean RGB is the assertion that actually catches regressions; a screenshot diff
   will thrash on map-data churn.

---

## 7. Risk register

| Sev | Risk | Mitigation |
|---|---|---|
| **BLOCKER** | Interaction-time tiles may not use the styleable endpoint — unverified. | M0 gate before any further build. |
| **HIGH** | `RoadmapDark` is undocumented; Google can drop it without notice. | Startup + daily health probe; automatic fallback to L3; badge warning. |
| **HIGH** | Google Maps' terms of service are not obviously friendly to rewriting tile requests to an undocumented style. This is a judgement call for the project owner, and store reviewers may take a view. | Decide before M5. Note that restyling extensions exist on both stores today. |
| MEDIUM | Maps' service worker may serve cached light tiles past the rewrite. | Verify in M1; if needed, vary a cache-irrelevant pb field or clear the SW cache on toggle. |
| MEDIUM | Token hashes rotate on every Google rebuild. | Never hard-code hash names; derive at runtime; key exceptions by resolved colour value. |
| MEDIUM | Algorithmic inversion will mis-colour some brand/semantic tokens. | Curated value-keyed exception table + contrast tests in M2. |
| LOW | Satellite / terrain / transit / traffic layers not yet characterised under the rewrite. | Enumerate in M1; satellite needs no dark styling, only its chrome does. |
| LOW | Chrome MV3 review friction on network-redirect permissions. | `declarativeNetRequestWithHostAccess` + minimal host permissions + a plain-English privacy justification. |

---

## 8. Explicitly out of scope

Street View, satellite and user photography stay untouched — they are photographic content
and inverting them is what makes generic dark-mode extensions look broken. Mobile browsers
are out (neither store ships desktop-style extensions to them in a usable way for this).

---

## 9. Honest expectation setting

L1 delivers cartography **identical in kind** to the dark map in Google Search, because it
*is* the same styling, served by the same Google endpoint.

L2 will not be pixel-identical to a Google-authored dark theme, because **no such theme
exists for Maps web** — the extension is authoring it. A derived M3 palette gets close and
stays maintainable, but it is our design, not Google's.
