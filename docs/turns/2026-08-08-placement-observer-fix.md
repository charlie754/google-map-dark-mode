# Turn report — the widget never re-placed, and a GoatApp hover lift

**Date:** 2026-08-08
**Agent seat:** Claude (architect / chair)
**Status:** Complete. Chrome live gate re-run passed.
**Authority:** Operator bug report: *"when click on search bar of Search Google Maps, ui didn't shift
to prevent covering search panel / same as search result, ui still covering"*, plus *"on button, add
effect enlarge the button like GoatApp when hovering the sections. Also add shadow on it same as
GoatApp sessions."*

## 1. Objective

Fix two reported placement bugs and add the reference app's hover treatment to the panel's buttons.

## 2. Plan / routing

Solo, in the chair seat: `codex-sol` is out of quota until 2026-08-09 and the Fable lanes are retired
by the 2026-08-07 ruling. A fan-out was declined deliberately — every lane here would have had to
drive a browser against live Google Maps, and concurrent sessions hammering a third-party service is
not a cost I am willing to spend on parallelism. Measurement first, then a single fix, then one
verification pass.

## 3. Root cause

**One cause, both bugs, and it was not the placement maths.** The `MutationObserver` was created with
`subtree: false`, which reports only direct children of `<body>`. Maps builds the suggestions
dropdown, the results list and the place card deep inside the tree, so the observer never fired and
`place()` was never called after boot.

Measured, with the extension loaded and the results column plainly open:

```
=== D. results panel ===
  widget: {"l":88,"t":184,"w":158,"h":48} mode: top-left     <- never moved
  box  l= 72 t=  0 w=408 h=900  shadow=yes                   <- the panel it was covering
```

The geometry logic would have handled that correctly the moment it ran. Nothing ever asked it to.

A second, smaller defect sat behind it: even once running, pass 1 required a left-column panel to be
at least half the viewport tall, which caught the results list but **not** the suggestions dropdown.

### The numbers the fix now encodes

Measured at 1366×900:

| overlay | rect | required response |
|---|---|---|
| search field | `l=88 t=12 w=376 h=48` | sit below |
| weather / traffic card | `l=88 t=72 w=376 h=100` | sit below |
| search suggestions | `l=88 t=60 w=376 h=246` | move onto the map |
| results / place list | `l=72 t=0 w=408 h=900` | move onto the map |

Height separates them cleanly, so height is the test: `LEFT_COLUMN_MIN_HEIGHT = 160` sits in the gap
between the 100px card and the 246px dropdown.

## 4. What changed

- **`extension/content/widget.js`**
  - observer → `subtree: true`, debounced with a 220 ms rate limit; `focusin` and `click` wired too,
    because focus precedes the dropdown's DOM by a frame or two
  - pass 1 keys on height (`>= 160`) rather than `>= 50%` of viewport
  - Ko-fi and GitHub buttons take GoatApp's hover treatment: `scale(1.05)` hover, `scale(0.96)`
    press, and `--glass-shadow-hover` (`0 18px 44px rgba(0,0,0,0.55)`) — the same values
    `.glass:hover` and `.primary-cta` use in the reference app
- **`test/checks/widget.mjs`** — an interactive path: click the real search field, type, assert, press
  Enter, assert. Plus four hover-lift assertions. 20 → 28 checks.
- **`test/probe-placement-cost.mjs`** — new; measures the scan cost and reposition rate.
- **`CLAUDE.md`** — the observer trap and the measured geometry table.

## 5. Verification evidence

`npm run test:widget` **28/28**; `npm run test:full` green; Chrome live gate **PASS
[A1:ok A2:ok A3:ok A4:ok A5:ok A6:ok]**.

The assertions that matter, driven through the real UI rather than by navigating to a results URL:

```
interactive: idle, tucked under Google's cards   mode=top-left widget=[88,184,158,48] overlap=null
interactive: suggestions dropdown is not covered mode=on-map   widget=[476,65,158,48] overlap=null
interactive: results panel is not covered        mode=on-map   widget=[492,65,158,48] overlap=null
Ko-fi enlarges on hover                          rest=none hover=matrix(1.05,0,0,1.05,0,0)
Ko-fi gains the GoatApp hover shadow             rgba(0,0,0,0.55) 0px 18px 44px, rgba(210,65,62,0.45) 0px 10px 26px
GitHub button enlarges on hover                  hover=matrix(1.05,0,0,1.05,0,0)
GitHub button gains the GoatApp hover shadow     rgba(0,0,0,0.55) 0px 18px 44px
```

**The old test would not have caught this bug, and that is the important part.** It navigated
straight to `/maps/search/coffee/…`, so placement ran once on boot with the panel already present and
passed. The failure only exists on the interactive path. That path is now the check.

### Performance of the subtree observer, measured not assumed

```
scan cost vs the live Maps DOM   best 0.2ms   median 0.4ms   worst 0.5ms   (395 elements, 90 considered)
repositions during 14s of pan + zoom + search   17  (~1.18/s)
ceiling at the 220ms rate limit                 ~4.5 scans/s ~= 1.8ms/s of main thread
```

Under 0.2% of one core in the worst case. `node test/probe-placement-cost.mjs` re-measures.

## 6. Gate A / Gate B

- **Gate A: PASS.** Syntax clean, build byte-identical to source, full suite green.
- **Gate B: PASS.** The reported failures were reproduced, root-caused with a measurement, fixed, and
  re-verified through the same interactive path the operator used — not a proxy for it.

## 7. Residual hazards

- **MEDIUM — `LEFT_COLUMN_MIN_HEIGHT = 160` is calibrated on one viewport (1366×900) in one locale.**
  A materially shorter suggestions dropdown, or a taller weather card, would land on the wrong side of
  it. It is a measured constant, not a derived one.
- **MEDIUM — two self-inflicted near-misses this turn, both caught by tooling rather than by me.**
  A backtick inside a CSS comment terminated the template literal, and `tools/build.mjs` **emitted the
  broken file anyway** — it validates JSON and manifest references but never syntax-checks JS. Worth
  adding a `node --check` to the build. Separately, the new hover scale broke my own width assertion
  because it measured `getBoundingClientRect()` while the pointer sat on the button; the fix was to
  assert on `offsetWidth`, which is what "width matches" actually means.
- **LOW — Firefox unverified with these changes.** Nothing engine-specific is involved.
- **LOW — the widget moves onto the map while the transient suggestions dropdown is open**, and back
  when it closes. That is the requested behaviour, but it is movement the user will notice.

## 8. Not done

`npm run gate:live:firefox` after these changes. No reduced-motion evidence captured. The build still
does not syntax-check the JS it copies.

## 9. Go / No-Go

**GO.** Both reported bugs are fixed and proven through the reporting path; the hover treatment
matches the reference app's own values.

## 10. Artefacts

- This report: `docs/turns/2026-08-08-placement-observer-fix.md`
- Previous: [on-page control](2026-08-08-on-page-dark-mode-control.md)
- Evidence: `test/artifacts/widget/7-suggestions.png`, `8-results-interactive.png`, `9-hover-lift.png`
- Gate log: `test/artifacts/gate-after-placement-fix.log`
- Wiki: **WIKI N/A**
