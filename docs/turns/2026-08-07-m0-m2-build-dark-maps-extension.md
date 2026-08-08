# Turn report — building Maps Noir: M0 gate, M1 dark map, M2 dark chrome

**Date:** 2026-08-07
**Agent seat:** Claude (architect / chair)
**Status:** Complete for M0–M2. M0.9 (adversarial review) in flight at time of writing.
**Authority:** Operator: "Start building the plugin. You may use Subagents to reduce token and
review each turns of your work. GPT currently is out of usage until Aug 9th."

## 1. Objective

Build the extension. Gate it honestly. The plan's M0 was a single unproven link — whether
interaction-time base-map tiles carry a rewritable style token — and nothing downstream was allowed
to start until that was settled.

## 2. Plan / routing

`codex-sol` unavailable (GPT quota, per operator). Seven `fable-implementer` lanes plus a four-lens
adversarial review workflow. Every lane got the five-part spec and disjoint file ownership; no lane
was permitted a mutating git command.

| Lane | Objective | Outcome |
|---|---|---|
| A | M0 extension scaffold + one DNR rule + health probe | Delivered; correctly escalated that the ledger was aspirational |
| B | Playwright gate harness with trusted gestures | Delivered; found the proto transport and reported M0 as **failed** |
| C | Can Maps be pinned to the raster transport? | Conditionally yes — but the app never mounts |
| D | Get the extension loading on Firefox | RDP `installTemporaryAddon`; disproved the "raster arm ⇒ dark" premise |
| E | What decides the transport, and where does the vector palette come from? | **Found the answer**: the gstatic `CompactLegend` asset |
| F | Production rule engine across all three renderer modes | 4 rules, per-rule `testMatchOutcome` self-check |
| G | Dark app chrome via Material 3 token remap | 209 tokens overridden, OKLCH transform, photos untouched |
| H | Integrated gate under sustained interaction + regression suite | 33/33 dark on both browsers; 29 offline checks |

Three lanes (C/D/E) ran concurrently on different browsers to avoid contention. Lanes F and G ran
concurrently against a pre-agreed manifest contract.

## 3. What changed

New: `extension/` (2 manifests, `rules/dark-map.json`, `background.js`, `content/theme.{js,css}`,
icons), `tools/build.mjs`, `test/` (live gate, 4 check suites, libs, fixtures),
`test/experiments/{raster-pin,firefox-load,transport-arm}/`, `package.json`,
`playwright.config.mjs`, `.gitignore`.

Revised: `CLAUDE.md` and `docs/research/…-feasibility.md` (the latter's conclusion was superseded
the same day; a correction section now says so at the top), `.workflow/LEDGER.md`.

### How it works

Four `declarativeNetRequest` redirect rules:

1. `gstatic.com/maps/res/CompactLegend-Roadmap-<hash>` → `-RoadmapDark-<hash>` — **the one that
   matters**; supplies the palette for the WebGL vector renderer
2. the `Terrain` → `TerrainDark` equivalent
3. `/maps/vt/stream/pb=` style token — for plain `canvas` mode
4. `/maps/vt/pb=` first-paint raster token — kills a ~1 s light flash

Plus a content script that enumerates Maps' 217 colour-valued Material 3 custom properties at
runtime, transforms lightness in OKLCH, and writes them back on `:root`.

## 4. Verification evidence

**Chair-run, this session:**

```
node tools/build.mjs      -> 9 files x 2 targets, 12 manifest refs resolved, exit 0
npm test                  -> 29/29 pass, 116 ms   (incl. 7 mutation proofs, cross-product loop freedom)
npm run test:liveness     -> 5/5 pass  (Roadmap/RoadmapDark/Terrain/TerrainDark 200 on 2 live versions;
                                        nonsense names 404, so 200 means the style exists)
```

**Chair-inspected artifacts:** `extension-firstpaint-500ms.png` (complete dark map) versus
`control-firstpaint-500ms.png` (same viewport, same instant, light) — the mutation control that
reframed the whole problem; `transport-arm/data/shots/ext-legend-dark-*.png`; and
`test/artifacts/live/chrome/chrome-fullwindow.png` — dark map, dark results panel, dark place card,
photographs full-colour and untouched, review stars still gold, traffic overlay live.

**Independently re-fetched by the chair**, not taken from lane prose:

| Style | 4311471e…3ba | e3dec3f8…7f4 |
|---|---|---|
| `Roadmap` / `RoadmapDark` | 200, 2 056 525 B / 200, 1 938 292 B | 200, 2 072 796 B / 200, 1 954 715 B |
| `Terrain` / `TerrainDark` | 200 / 200 | 200 / 200 |
| `Satellite`, `NotAStyle` | 404 | 404 |

**Live gate, sustained interaction** (pans in four directions, six wheel-zoom bursts, layer toggle,
search, place card, return to map):

| | Chrome | Chrome control | Firefox | Firefox control |
|---|---|---|---|---|
| A1 zoom levels | PASS `[1,2,4,6,9,10,12,13]` | PASS | PASS `[10,11,12,13,14]` | PASS |
| A2 rewritten | **26/26** | 0/26 (inverse) | **251/251** | 0/247 (inverse) |
| A3 luminance | **33/33 DARK** over 140 s | 33/33 LIGHT | **33/33 DARK** over 100 s | 33/33 LIGHT |
| A4 chrome UI | PASS, lum 29–46 | lum 235–250 | PASS | lum 235–249 |
| A5 console/page errors | 0 attributable | PASS | 0 attributable | PASS |

`voidGate: false` — both controls fail every positive assertion, and the runner throws rather than
reporting a pass if they do not.

**Contrast:** every sampled text and button ≥ 4.5:1 — body 13.20:1, secondary 8.37:1, links 8.61:1.
**Map untouched by the theme:** mean RGB delta (0.00, 0.00, 0.00) across three measurements.
**No white flash:** baseline first content frame is 100% white; themed is 0%.

## 5. Gate A / Gate B

- **Gate A (build/hygiene): PASS.** Build clean, 29 offline checks green, both targets emit.
- **Gate B (product depth): PASS for M0–M2.** Not "a type exists" — the full path is traced:
  request rewritten → asset served → renderer paints → pixels measured dark → darkness survives
  140 s of real gestures → mutation control fails without the extension. On both browsers.

## 6. Residual hazards

- **HIGH — Terrain gap on the tile transports.** Rules 3/4 match `!2sRoadmap!` literally, so
  `!2sTerrain!` raster/stream tiles are unrewritten *by construction*. mapcore is covered by rule 2;
  the raster arm (all Firefox) is not. Proven at the regex level, pinned as a `KNOWN GAP` test,
  never driven live in Terrain mode.
- **HIGH — `#gb` account bar is outside the token system.** Hard-coded `#ffffff` on `#0b57d0`: a
  full-brightness Sign-in button on a dark UI. The app-launcher glyph sits at 1.66:1 — pre-existing
  and pixel-proven unchanged by us, but still bad.
- **HIGH — the whole thing rests on undocumented internals.** A style name, an asset path shape, a
  URL grammar, a CSS token scheme. Version hashes rotated twice in one day. The health probe covers
  the known break modes; unknown ones will surface as a light map.
- **MEDIUM** — `box-shadow`s are hard-coded `rgba(0,0,0,…)` in CSS rules, not tokens; correctly
  preserved, so dark panels lose drop-shadow separation.
- **MEDIUM** — `testMatchOutcome` does not exist on Firefox; its self-check reports `unknown`.
  Firefox rules are proven by 251/251 on-wire tokens, not by introspection.
- **MEDIUM** — single trial per mode in the final gate; nothing here is a repeated-trial statistic.
- **Undecided, operator's call** — terms-of-service posture on redirecting Google's palette asset.

## 7. Not done / open items

Options UI and popup (M3). Packaging polish (M4). Store submission (M5). Never exercised: satellite,
Street View, directions, `/maps/embed`, regional `google.<cctld>` hosts — the manifest does not even
match regional TLDs. `test/experiments/firefox-load/gate-run.mjs` is stale (reads the deleted
`rules/dark-tiles.json`); not referenced by any npm script. Nothing has been committed — the project
tree is entirely untracked, deliberately, because the git root is shared.

## 8. Go / No-Go

**GO for M0–M2 as a milestone.** The gate that was supposed to kill this project passed, on both
browsers, under sustained interaction, with a valid mutation control.

**CONDITIONAL** on the adversarial review, which was still running when this was written; its
verdict must be read and its findings resolved before M3.

**DO NOT START M5 (store submission)** until the terms-of-service question is decided by the
operator, and the Terrain gap is either closed or explicitly accepted as a documented limitation.

## 9. Suggested next moves

- **P0** — Read the review workflow output and resolve anything it upgrades to BLOCKER.
- **P0** — Close the Terrain gap: add `!2sTerrain!` → `!2sTerrainDark!` rules for the raster and
  stream transports, and drive Maps in Terrain mode to confirm those tiles are actually requested.
- **P1** — `#gb`: decide whether a narrowly-scoped rule is worth the blast radius on the account
  avatar and multicolour app-launcher glyphs.
- **P1** — Regional TLD coverage in the manifest and rules; `/maps/embed`.
- **P2** — Options UI (on/off, follow-system, map-only/chrome-only), reusing the theme script's
  existing undo path.

## 10. Artefacts

- This report: `docs/turns/2026-08-07-m0-m2-build-dark-maps-extension.md`
- [Research, with §6 correction](../research/2026-08-07-google-maps-dark-mode-feasibility.md)
- [Plan](../plan/2026-08-07-dark-maps-extension-plan.md) · [Ledger](../../.workflow/LEDGER.md) · [CLAUDE.md](../../CLAUDE.md)
- Live gate evidence: `test/artifacts/live/{chrome,firefox}/{result.json,summary.json}` + PNGs
- Experiment evidence: `test/experiments/{raster-pin,firefox-load,transport-arm}/`
- Review workflow: `wf_57c8be03-35e`
- Wiki: **WIKI N/A** (no `wiki/` tree in this project)
