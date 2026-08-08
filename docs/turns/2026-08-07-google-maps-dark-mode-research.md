# Turn report — Google Maps dark mode: feasibility research + implementation plan

**Date:** 2026-08-07
**Agent seat:** Claude (architect / chair)
**Status:** Complete (research + plan). No implementation started — by design.
**Authority:** Operator request: "Research if it's possible to make Google Maps into dark
mode as same as Google Search via plugin. If yes, draft an implementation plan for both
Firefox and Chrome platform." Invoked alongside `/init` against an empty project directory.

## 1. Objective

Answer whether a browser extension can give `google.com/maps` the dark cartography that
already appears in Google Search's map module, and if so produce a Chrome + Firefox
implementation plan. Secondarily, seed `CLAUDE.md` for the (empty) project.

## 2. Plan / routing

No lanes dispatched. Session policy blocks unprompted subagent delegation, and the work was
live-instrumentation rather than bulk code production. All measurement performed directly
by the chair using the in-app browser (`javascript_tool`, network log, resource timing) and
PowerShell `Invoke-WebRequest` for an independent unauthenticated check.

## 3. What changed

Created (no source code — this turn is research and planning only):

- `CLAUDE.md` — project guidance; greenfield state, the two-surface architecture, the
  one-command re-verification of the core finding, verification discipline, machine constraints.
- `docs/research/2026-08-07-google-maps-dark-mode-feasibility.md` — findings with measurements.
- `docs/plan/2026-08-07-dark-maps-extension-plan.md` — milestones M0–M5, cross-browser
  mechanics, testing, risk register.
- `docs/evidence/tile-z{13,17}-{Roadmap,RoadmapDark}.png` — four downloaded tiles.

## 4. Verification evidence

**Dark tiles exist and are unauthenticated.** Style-name sweep over 18 candidates at
z10/240/423, issued same-origin from the Maps page:

| `set:` value | HTTP | Bytes | Mean RGB |
|---|---|---|---|
| `Roadmap` | 200 | 29 750 | (218, 228, 229) |
| **`RoadmapDark`** | 200 | **27 275** | **(38, 57, 77)** |
| 16 others (`Dark`, `Night`, `DarkMode`, `DarkRoadmap`, `Dusk`, `Satellite`, `Transit`, …) | 200 | 178 | (255, 255, 0) — error tile |

Independently re-fetched at z13 and z17 via PowerShell with **no cookies and no key**
(18–23 KB each) and visually inspected: full dark cartography with labels, road shields,
park fills and POI icons baked in. Google Search's own dark map panel
(`/maps/vt/data=<signed>`, 260×312) measures (28, 47, 63) — same palette family.

**Render architecture.** `mapcore` WASM loaded; canvas probe returns
`Cannot get context from a canvas that has transferred its control to offscreen`
→ WebGL in a Web Worker. Base map at initial render: 28 raster tiles at z10 and 24 at z17,
all from `/maps/vt/pb=…!12m4!1e68!2m2!1sset!2sRoadmap!…`.

**No native dark mode.** With `prefers-color-scheme: dark` active: 1 dark media block across
8 stylesheets, no `color-scheme` meta, no appearance item in the menu inventory, no
dark-related storage keys.

**L2 token remap works end to end.** 386 custom properties on `:root`, 215 colour-valued.
Applying a computed lightness inversion to all 215 changed 3 of 4 probed UI surfaces live:
`rgb(255,255,255)` → `rgb(0,0,0)`, `rgb(242,242,242)` → `rgb(13,13,13)`,
`rgb(0,123,139)` → `rgb(0,197,223)`. Reverted after measurement.

**Firefox/Chrome mechanics.** Firefox retains blocking `webRequest` in MV3 and also supports
`declarativeNetRequest`; Chrome MV3 dropped `webRequestBlocking` for non-policy extensions.
DNR is therefore the shared primary path.

## 5. Gate A / Gate B

- **Gate A (research hygiene): PASS.** Every claim above is backed by a recorded measurement
  or a downloaded artifact, not by recall.
- **Gate B (product depth): NOT APPLICABLE THIS TURN, and deliberately not claimed.** No
  extension exists. The end-to-end claim "an extension turns Maps dark" is *unproven* and is
  the plan's M0 exit gate.

## 6. Residual hazards

- **BLOCKER (for the build, not this turn):** only initial-render tile traffic was observed
  on the styleable endpoint. The test environment could not deliver real gestures — synthetic
  `wheel`/`mousedown` and programmatic `.click()` on the zoom button left the map at `10z`,
  and screenshots were unavailable ("Browser pane is not displayed"). If pan/zoom-time tiles
  take a different path, L1 collapses to the CSS-filter fallback.
- **HIGH:** `RoadmapDark` is undocumented and can be withdrawn without notice.
- **HIGH:** Terms-of-service posture on rewriting tile requests to an undocumented style is
  a judgement call for the project owner, and store reviewers may take a view. Flagged, not
  decided.
- **MEDIUM:** Maps' service worker may cache light tiles past the rewrite.
- **MEDIUM:** token hashes rotate on every Google rebuild; algorithmic derivation is the
  mitigation, and it will still mis-colour some brand/semantic tokens.

## 7. Not done / open items

- No extension code, manifest, ruleset, build or tests.
- Satellite / terrain / transit / traffic layers not characterised under the rewrite.
- Service-worker cache interaction not tested.
- No decision recorded on the ToS question.

## 8. Go / No-Go

**CONDITIONAL GO** for building M0 (the one-rule spike) — and *only* M0. The research
question is answered affirmatively with artifacts, but "the plugin makes Maps dark" is not
yet demonstrated.

**DO NOT START M1–M5 until M0 produces a hand-driven pan/zoom network log showing
`2sRoadmapDark` on every base-map request at three or more zoom levels.**

## 9. Suggested next moves

- **P0** — Build the M0 spike: `manifest.json` + one DNR rule, nothing else. Load unpacked
  in Chrome and Firefox Dev Edition, pan and zoom by hand, capture the network log and a
  screenshot.
- **P1** — If M0 passes: M1 (host coverage, ruleset toggle, health probe, SW-cache check).
  If M0 fails: re-plan around L3 and reset expectations, because filter-based dark mode will
  not match Google Search.
- **P2** — Owner decision on the ToS question before any store submission.

## 10. Artefacts

- This report: `docs/turns/2026-08-07-google-maps-dark-mode-research.md`
- Research: [`docs/research/2026-08-07-google-maps-dark-mode-feasibility.md`](../research/2026-08-07-google-maps-dark-mode-feasibility.md)
- Plan: [`docs/plan/2026-08-07-dark-maps-extension-plan.md`](../plan/2026-08-07-dark-maps-extension-plan.md)
- Project guidance: [`CLAUDE.md`](../../CLAUDE.md)
- Tile evidence: `docs/evidence/tile-z13-Roadmap.png`, `tile-z13-RoadmapDark.png`,
  `tile-z17-Roadmap.png`, `tile-z17-RoadmapDark.png`
- Wiki: **WIKI N/A** (no `wiki/` tree in this project)

No subagent lanes were used this turn.
