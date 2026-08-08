# Turn report — AMO submission: one blocking error, then three warnings

**Date:** 2026-08-08
**Agent seat:** Claude (architect / chair)
**Status:** Complete
**Authority:** Operator reports from the AMO upload form — "unable to upload to
firefox" (validation error), then the three-warning validation summary.

## 1. Objective

Get `google-map-dark-mode-firefox-1.0.0.xpi` through AMO validation clean, and
make the failures reproducible locally so the next one is not found by uploading.

## 2. Plan / routing

No lanes. Two small manifest changes, one DOM-construction change, and a test
file; the spec-writing cost would have exceeded the work.

## 3. What changed

| Path | Change |
|---|---|
| `extension/manifest.firefox.json` | `data_collection_permissions: {required:["none"]}`; `gecko.strict_min_version` 128 → 140; new `gecko_android.strict_min_version` 142 |
| `extension/content/widget.js` | `wrap.innerHTML = HTML` → `DOMParser().parseFromString` + `importNode` |
| `test/checks/manifest.test.mjs` | new — 7 store-acceptance checks |
| `package.json` | `manifest.test.mjs` wired into `npm test`; new `test:amo` script |
| `CLAUDE.md` | the pre-upload rule and the innerHTML ban |

Commits `09b1919` (the blocking error) and `b43c3d5` (the three warnings), both
pushed.

## 4. Verification evidence

**The blocking error.** AMO: *"The data_collection_permissions property is
missing."* Declared `required: ["none"]`, which is accurate — settings are in
`storage.local`, there is no analytics, and the two outbound requests
`background.js` makes are `credentials: "omit"` health probes against gstatic.

- `npm test` 35 → 41 checks, all passing.
- Mutation-proven: deleting the key fails 3 checks naming it; restoring returns
  41/41.
- Key read back out of the built XPI, not from the source beside it.

**The three warnings.** Reproduced and cleared with `addons-linter`, which is the
same validator AMO runs:

| | errors | warnings |
|---|---|---|
| before | 0 | 3 |
| after | 0 | 0 |

- Mutation-proven: restoring the `innerHTML` write and the 128 floor inside
  `dist/firefox` brings all 3 warnings back.
- The rebuilt **XPI itself** lints clean (`0 errors, 0 notices, 0 warnings`), not
  merely the directory.
- `npm test` 42/42; `npm run test:widget` **36/36** — the DOM-construction change
  is on the widget's mount path, so this is the check that matters.
- `npm run build` re-emits and `node --check` parses all 6 JS files.

Version floors: Firefox 142 shipped 2025-08-19 and ESR 140 is a live ESR branch,
so raising the floor costs no realistic user. Verified against the release
calendar rather than assumed.

## 5. Gate A / Gate B

- **Gate A:** pass — builds, packages, 42 offline + 36 widget checks green,
  artifacts lint clean.
- **Gate B:** pass for *submission acceptance*, which is what was asked. **Not**
  proven for runtime behaviour on Firefox — see below.

## 6. Residual hazards

- **HIGH — the `DOMParser` change has never run in Firefox.** It is verified in
  Chrome (36/36 widget checks) and the API is standard, but the widget's mount
  path now differs from the one that was tested there, and Firefox is the
  browser this submission targets. `npm run gate:live:firefox` has still never
  been run with the widget at all.
- **MEDIUM — `test:amo` depends on `npx --yes addons-linter`**, so it fetches on
  first use and floats to whatever version is current. That is deliberate (AMO's
  validator also moves), but it means the check can change behaviour without a
  commit here.
- **LOW — raising the floor to 140/142 is not covered by any runtime check.**
  Nothing verifies the extension actually works on 140; the floor is a claim
  about where the manifest keys exist, not about tested compatibility.

## 7. Not done / open items

- `npm run gate:live:firefox` — unchanged from the last two turns, and now more
  pressing than before because of the mount-path change.
- Chrome Web Store submission has not been re-validated after these changes.
  `browser_specific_settings` is gecko-only and the offline suite asserts it
  stays out of the Chrome manifest, but that is an argument, not a run.

## 8. Go / No-Go

**CONDITIONAL GO** for re-uploading to AMO. The artifact is clean by AMO's own
validator, which is the whole of what the operator asked for.

The condition is on *shipping*, not on uploading: **run
`npm run gate:live:firefox` before the listing goes public.** A reviewer
installing on Firefox exercises a path nothing has run since the widget was
built.

## 9. Suggested next moves

- **P0** — `npm run gate:live:firefox`. **DO NOT publish the AMO listing until
  this passes**; a broken widget on Firefox would be found by a reviewer.
- **P1** — re-run `npm run test:package` so both artifacts are proven to install
  from the archive, not just from `dist/`.
- **P2** — consider pinning `addons-linter` as a devDependency if reproducibility
  of the check matters more than tracking AMO.

## 10. Artefacts

- This report: `docs/turns/2026-08-08-amo-submission-warnings.md`
- Commits: `09b1919`, `b43c3d5`
- Upload-ready: `dist/google-map-dark-mode-firefox-1.0.0.xpi` (224,069 bytes)
- WIKI N/A — no `wiki/` tree in this repository.

## Postscript — why this took two rounds

Both rounds were the same miss. `addons-linter` is AMO's validator, it is one
`npx` away, and it reports every one of these four findings offline in seconds.
I had a browser-install check and a live Chrome gate, so I treated store
acceptance as covered; it was not, and each finding cost the operator an upload
attempt to discover. `test:amo` exists now, and `CLAUDE.md` says to run it before
every upload.
