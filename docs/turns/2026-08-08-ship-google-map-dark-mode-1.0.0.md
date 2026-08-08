# Turn report — shipping Google Map Dark Mode 1.0.0

**Date:** 2026-08-08
**Agent seat:** Claude (architect / chair)
**Status:** Complete. Packaged, published, and store-ready pending human upload steps.
**Authority:** Operator goal: *"finish the plugin, name 'Google Map Dark Mode', ready ship to
firefox and chrome platform. UI default turn on dark mode. Same add a Ko-fi donation tab like last
firefox plugin. Git push."*

## 1. Objective

Take the working M0–M2 prototype to a shippable v1.0.0: renamed, with a user interface that
defaults to dark, a Ko-fi tab matching the author's previous extension, packaged for both stores,
and pushed to a public repository.

## 2. Plan / routing

`codex-sol` unavailable (GPT quota until 2026-08-09). Six `fable-implementer` lanes plus the
four-lens adversarial review workflow launched in the previous turn.

| Lane | Objective | Outcome |
|---|---|---|
| — | 4-lens adversarial review (workflow `wf_57c8be03-35e`, 56 agents) | 51 findings → 12 survived refutation → 1 HIGH |
| I | Rename, F1 fix, regional TLDs, Terrain arms | Widened rules 3/4 to `(Roadmap\|Terrain)` rather than adding rule ids — correctly, see §6 |
| J | Popup + options, Ko-fi tab, dark by default | 7 files; found and fixed two contrast defects its own first pass would have shipped |
| K | Settings backend, F3/F5/F7 | Auto-disable remediation, `unverified` verdict, packed-build rule oracle |
| L | Theme settings gate, F2/F4/F6, theme test layer | 28 tests, 9 mutation controls; found the `var()` substitution trap |
| M | Test reconciliation, packaging, store metadata | 35 offline checks, ZIP + XPI, README/LICENSE/PRIVACY/store-listing |
| N | Gecko id rename for AMO | `google-map-dark-mode@charlie754.github.io` |

## 3. What changed

**Renamed** to "Google Map Dark Mode" v1.0.0 throughout; Gecko id moved off the `@local.test`
placeholder to the author's existing convention (`webp-save-as@charlie754.github.io` → same shape).

**New UI.** `extension/popup/` and `extension/options/`: master switch plus separate map-surface and
app-chrome toggles, all defaulting **on**. Ko-fi block ported from `F:\firefox plugin` — same URL
(`ko-fi.com/irp_hongkong`), same handle, same unpushy copy, same `tabs.create` + `window.close()`
reasoning. Options page carries an honest "Known limitations" section.

**Settings backend.** `storage.local.settings = {enabled, darkMap, darkChrome}`, all true by
default, with `enabled && darkMap` driving `updateEnabledRulesets` in the same transaction as the
write, and a rollback if storage refuses after the engine moved.

**Coverage.** Terrain arms added to the tile transports; 20 regional `google.<cctld>` domains; the
bare `/maps` and `?q=` URL shapes.

**Packaging.** `tools/package.mjs` emits `google-map-dark-mode-chrome-1.0.0.zip` (182,035 B) and
`-firefox-1.0.0.xpi` (182,172 B), each verified by reading its own central directory back off disk.

**Published.** `https://github.com/charlie754/google-map-dark-mode`, public, `main` at `084c6a9`.

## 4. Verification evidence

**Chair-run, this session:**

```
node tools/package.mjs  -> both archives, manifest.json at root, forward slashes only, exit 0
npm test                -> 35/35, 121 ms
ship-string sweep       -> zero "Maps Noir" / "local.test" in dist/
dist/firefox gecko id   -> google-map-dark-mode@charlie754.github.io
dist/chrome manifest    -> Google Map Dark Mode v1.0.0
git ls-remote origin main -> 084c6a9da9d69f69604de1464365ea7505270dfd  (matches local HEAD)
gh repo view            -> visibility PUBLIC, default branch main
GET github.com/charlie754/google-map-dark-mode -> 200
```

**Lane-run, chair-read:**

- **The one HIGH is fixed and proven on the failing URL.** Bare `https://www.google.com/maps`
  returns HTTP 200 with a *single-entry* redirect chain — the document really is created at
  `/maps`, and the `/maps/@lat,lng,z` that appears later is Maps' own History rewrite. Pre-fix,
  Firefox read `data-mapsnoir=null` on both the bare and query shapes and Chrome on the query shape;
  post-fix all read `on`, in both engines, with controls reading `null`.
- **Live gate, both browsers, all six assertions incl. the new A6:**
  `chrome PASS [A1 A2 A3 A4 A5 A6]`, `firefox PASS [...]`, both controls PASS on the inverses.
  Firefox A2 470/470 dark, A3 35/35 samples dark.
- **Packaged artifacts install and work:** the XPI activates in Firefox (`backgroundScriptStatus:
  RUNNING`, new id, zero warnings); the ZIP's contents load in Chromium and render a dark Maps at
  3 s / 6 s / 10 s, `data-mapsnoir="on"`.
- **Settings drive the engine:** eight transitions, `getEnabledRulesets()` followed
  `enabled && darkMap` every time.
- **Auto-disable survives restart** and does not re-arm a user-disabled ruleset.
- **Theme:** 28/28 with 9 mutation controls; live token pass 386 found / 217 colour / 209 overridden,
  body text 13.2:1, worst token-driven style 8.37:1; map-area mean RGB identical with the theme on,
  off and on again.
- **UI:** popup 12/12 and options 46/46 contrast checks pass; all controls keyboard-reachable with a
  visible focus ring; Ko-fi opens exactly `https://ko-fi.com/irp_hongkong`.

## 5. Gate A / Gate B

- **Gate A: PASS.** Build clean, 35 offline + 28 theme + 31 DNR-trap + 5 liveness checks green, both
  archives emit and verify.
- **Gate B: PASS.** Not presence — effect. Both *packaged* artifacts were installed in real browsers
  and produced a dark, interactive Maps; the settings toggles move the actual DNR engine; the fixed
  URL shapes were proven on the exact URLs that previously failed, in both engines, with controls.

## 6. Residual hazards

- **HIGH — undocumented dependency.** `RoadmapDark`, the `CompactLegend` path shape, and Maps' token
  scheme are all internal Google details. Version hashes rotated twice in one day. Mitigated: the
  health probe now *disables* the ruleset on `token-dead`/`rules-broken` rather than leaving a broken
  map, and the popup explains it in plain English.
- **HIGH — `#gb` account bar** is outside Maps' token system; hard-coded white-on-Google-blue. The
  app-launcher glyph measures 1.18:1 against our surface. Pre-existing and pixel-proven unchanged by
  us, but visible.
- **MEDIUM — a `token-dead` state breaks the Maps app, not just its colours.** Measured: with the
  palette 404ing, the map renders dark but Maps mounts 6 controls instead of 46, with no attribution
  bar, zoom, pegman or Layers. The auto-disable branch is what keeps users out of that state; if
  anyone ever proposes leaving the rules armed on `token-dead`, the options-page copy becomes a lie.
- **MEDIUM — Chrome caches the service-worker script** for unpacked extensions across restarts *and*
  version bumps. Cost two verification attempts before it was found. Now encoded in
  `test/lib/chrome-profile.mjs` and used on every Chromium launch.
- **MEDIUM — breadth untested.** 20 regional TLDs declared, none driven. Terrain proven offline and
  by Chrome's engine, never driven live. Directions, `/maps/embed`, Street View untouched.
- **MEDIUM — Firefox rule health** degrades to the weaker dynamic-mirror oracle; `testMatchOutcome`
  does not exist there. Rules are proven on Firefox by on-wire tokens, not introspection.
- **The codebase is internally split between two names.** `data-mapsnoir` / `__mapsNoirTheme` and the
  frozen spike add-ons keep the old code name **deliberately** — A6's argument depends on a marker
  nothing on Google's side would write. Recorded in `CLAUDE.md` so it is not "tidied".

## 7. Not done / open items

**Human steps, cannot be automated:** Chrome Web Store developer account + US$5 fee, AMO account,
at least one 1280×800 store screenshot, and the uploads themselves. See `docs/store-listing.md`.

**Undecided, operator's call:** the terms-of-service posture on redirecting Google's palette asset.
This is stated plainly in the README and the store listing rather than hidden, but it is a
judgement I should not make. Naming the extension "Google Map Dark Mode" is a related trademark
question; the description leads with "Unofficial" and ends "not affiliated with Google".

Not run this turn: `npm run test:package` end-to-end after the final rebuild (its Firefox half ran
under Lane N), and `npm run gate:live:all` after the last two comment-only edits.

## 8. Go / No-Go

**GO** on the operator's goal: named, both platforms packaged and installed-and-verified, dark on by
default, Ko-fi tab matching the previous plugin, pushed public.

**CONDITIONAL GO on store submission** — the artifacts are ready and the two blockers a reviewer
would have hit (dead Source link, placeholder add-on id) are closed. Remaining conditions are the
human account/screenshot steps and the operator's ToS decision.

## 9. Suggested next moves

- **P0** — Operator decides the ToS/trademark posture before uploading.
- **P1** — Produce store screenshots; upload to both stores.
- **P1** — Drive one regional TLD and one live Terrain session; both are declared-but-unexercised.
- **P2** — `#gb` account bar: decide whether a narrowly-scoped rule is worth the blast radius on the
  avatar and multicolour app-launcher glyphs.

## 10. Artefacts

- This report: `docs/turns/2026-08-08-ship-google-map-dark-mode-1.0.0.md`
- Previous turn: [M0–M2 build](2026-08-07-m0-m2-build-dark-maps-extension.md)
- [README](../../README.md) · [PRIVACY](../../PRIVACY.md) · [store listing](../store-listing.md) · [CLAUDE.md](../../CLAUDE.md) · [ledger](../../.workflow/LEDGER.md)
- Repository: https://github.com/charlie754/google-map-dark-mode (public, `main` @ `084c6a9`)
- Store artifacts: `dist/google-map-dark-mode-chrome-1.0.0.zip`, `dist/google-map-dark-mode-firefox-1.0.0.xpi`
- Review workflow: `wf_57c8be03-35e` — 56 agents, 51 candidate findings, 12 survivors
- Wiki: **WIKI N/A**
