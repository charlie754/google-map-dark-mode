# Requirements ledger — Google Maps dark-mode extension ("Maps Noir")

**Owner:** Claude (chair). **Opened:** 2026-08-07. **Last revised:** 2026-08-07 (post-M1).
**Authority:** [docs/plan/2026-08-07-dark-maps-extension-plan.md](../docs/plan/2026-08-07-dark-maps-extension-plan.md)

Lane availability: `codex-sol` / `codex-implementer` **UNAVAILABLE until 2026-08-09** (GPT quota
exhausted — operator statement). Used this session: `fable-implementer` ×7, plus a 4-lens
adversarial review workflow.

**Correction, 2026-08-07:** the first version of this ledger marked M0.1–M0.9 `DONE` before any
artifact existed. Lane A correctly escalated it as aspirational. Every state below is now backed by
a named artifact. Do not mark an item done here before its evidence exists.

---

## M0 — feasibility gate: **PASSED**, by a mechanism the plan did not anticipate

The plan assumed the base map was one raster transport with an ASCII style token. It is three
renderer modes, and the decisive lever is not a tile URL at all.

| # | Item | State | Evidence |
|---|---|---|---|
| M0.1 | Extension scaffold, per-target manifests, `tools/build.mjs` | DONE | `node tools/build.mjs` → 9 files × 2 targets, exit 0 |
| M0.2 | Raster tile rewrite rule | DONE | rule 4 in `extension/rules/dark-map.json` |
| M0.3 | Startup health probe | DONE (superseded by M1.4) | `extension/background.js` |
| M0.4 | Playwright harness, real trusted gestures | DONE | `test/live-gate.mjs` |
| M0.5 | Assertions A1–A5 | DONE | `test/lib/live-assertions.mjs` |
| M0.6 | Mutation control run | DONE | `voidGate: false`; controls fail A2/A3/A4 |
| M0.7 | **Chair runs the gate and reads raw output** | **DONE** | chair ran `npm test` 29/29, `npm run test:liveness` 5/5; chair inspected `extension-firstpaint-500ms.png`, `control-firstpaint-500ms.png`, `chrome-fullwindow.png` |
| M0.8 | Firefox loads and passes the same gate | DONE | RDP `installTemporaryAddon`; 251/251 tiles rewritten, 33/33 dark samples |
| M0.9 | Adversarial review | IN PROGRESS | 4-lens review workflow `wf_57c8be03-35e` |

**What M0 actually established.** Rewriting only raster tiles yields a correct dark map for ~1–6 s
which the vector renderer then overpaints. The vector renderer's palette is a separate static,
unauthenticated, style-name-keyed asset — `https://www.gstatic.com/maps/res/CompactLegend-<Style>-<hash>`
— and `RoadmapDark` / `TerrainDark` variants exist. Swapping the name is a pure string substitution.

---

## M1 — dark map across all renderer modes: **DONE**

| # | Item | State | Evidence |
|---|---|---|---|
| M1.1 | Rule 1 — `CompactLegend-Roadmap` → `RoadmapDark` | DONE | `testMatchOutcome` matched, live redirects observed |
| M1.2 | Rule 2 — `CompactLegend-Terrain` → `TerrainDark` | DONE | same |
| M1.3 | Rule 3 — `/maps/vt/stream/pb=` token | DONE | thin: 1 live request (Firefox), rewritten |
| M1.4 | Rules self-check + health probe with rule-immune canary | DONE | 2 KB-trap mutation test fires, `verdict=rules-broken` |
| M1.5 | Sustained-interaction proof | DONE | Chrome 33/33 dark over 140 s; Firefox 33/33 over 100 s |
| M1.6 | `classify()` rejects a dead canvas | DONE | thresholds `distinct ≥ 24 ∧ stdev ≥ 5`, calibrated on 321 frames |

## M2 — dark app chrome: **DONE**

| # | Item | State | Evidence |
|---|---|---|---|
| M2.1 | Runtime-derived Material 3 token remap, OKLCH transform | DONE | 386 tokens found, 217 colour-valued, 209 overridden |
| M2.2 | Value-keyed exception table (never hash-keyed) | DONE | 21 entries, 11 live hits |
| M2.3 | No white flash | DONE | first content frame: baseline whiteFrac 1.0000, themed 0 |
| M2.4 | Idempotent + reversible | DONE | 209/209/209 across three passes, 0 values changed |
| M2.5 | Map surface untouched by the theme | DONE | mean RGB delta (0.00, 0.00, 0.00) across three measurements |
| M2.6 | Contrast | DONE | all sampled text/buttons ≥ 4.5:1; body 13.20:1, secondary 8.37:1 |

---

## M0.9 — adversarial review: **DONE** (2026-08-07)

Workflow `wf_57c8be03-35e`, 56 agents, 4 lenses, every finding independently attacked by a refuter.
**51 candidates → 12 survivors → 1 HIGH.** The core mechanism held: the reviewer's closing words
were *"the surviving set is one real bug and a tail of minor debt."*

| Finding | Sev | State |
|---|---|---|
| F1 content script never injects on bare `/maps` or `?q=` | HIGH | **FIXED** and proven on the failing URLs in both engines |
| F2 already-dark guard unreachable | MED | **FIXED** — latched guard + evidence floor |
| F3 detected failure had no remediation | MED | **FIXED** — auto-disable, persisted, cause-keyed re-enable |
| F4 late alias tokens inverted twice | MED | **FIXED** — sentinel cascade probe |
| F5 `combineVerdict` reported healthy when unverified | LOW | **FIXED** — `unverified` verdict + packed-build oracle |
| F6 `MAX_PASSES` a lifetime budget | LOW | **FIXED** — refunded on productive passes |
| F7 health record never refreshed | LOW | **FIXED** — 6 h alarm, sequenced after F3 |

## M3 / M4 — UI and packaging: **DONE** (2026-08-08)

Renamed to **Google Map Dark Mode** v1.0.0. Popup + options, dark on by default, Ko-fi tab matching
the author's previous extension. Gecko id `google-map-dark-mode@charlie754.github.io`. Store
artifacts built and **installed in real browsers**: XPI activates in Firefox, ZIP contents render a
dark Maps in Chromium. Published: https://github.com/charlie754/google-map-dark-mode @ `084c6a9`.

## M5 — store submission: **BLOCKED on human steps + one operator decision**

Both reviewer-facing blockers are closed (Source link live, add-on id shippable). Remaining: store
accounts, the US$5 Chrome fee, at least one 1280×800 screenshot, the uploads — and the operator's
ToS/trademark decision, which is not mine to make.

---

## OPEN — carried forward

| Sev | Item |
|---|---|
| ~~HIGH~~ | ~~Terrain gap on tile transports~~ — **CLOSED 2026-08-08.** Rules 3/4 widened to `(Roadmap\|Terrain)`; corpus entries and mutation proofs added. Still never driven live in Terrain mode. |
| HIGH | **`#gb` Google account bar is outside the token system** — hard-coded `#ffffff` on `#0b57d0`. A full-brightness Sign-in button on a dark UI. App-launcher glyph sits at 1.66:1, pre-existing and pixel-proven unchanged. |
| MEDIUM | Panel `box-shadow`s are hard-coded `rgba(0,0,0,…)` in CSS rules, not tokens; correctly preserved, so dark panels lose drop-shadow separation. |
| MEDIUM | Never exercised: satellite, Street View, directions, `/maps/embed`, regional `google.<cctld>` hosts. Manifest does not even match regional TLDs. |
| MEDIUM | `testMatchOutcome` does not exist on Firefox → self-check reports `rules: "unknown"`. Firefox rules proven only by on-wire tokens. |
| MEDIUM | Single trial per mode in the final gate. Nothing here is a repeated-trial statistic. |
| LOW | `test/experiments/firefox-load/gate-run.mjs` is stale — reads the deleted `rules/dark-tiles.json`. Not in any npm script. |
| — | **Undecided, operator's call:** terms-of-service posture on redirecting Google's palette asset, before any store submission. |

## M3–M5 — NOT STARTED

Options UI · packaging polish · store submission. **DO NOT START M5** until the ToS question is
decided and the M0.9 review findings are resolved.

---

## Standing constraints for every lane

1. Git root is `F:\`, shared with unrelated projects and concurrent sessions.
   **No lane runs `git commit`, `git checkout --`, `git reset`, `git clean`, or `git stash`.**
   Confirmed live this session: a concurrent session committed to the shared root mid-run.
2. Never claim complete without pasted command output. Exit code 0 is not evidence.
3. State what was not done, explicitly.
