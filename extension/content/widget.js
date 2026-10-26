'use strict';
/**
 * Google Map Dark Mode -- the in-page control.
 *
 * A floating switch anchored to the top-left of the Maps viewport that expands
 * into a full control panel on hover or focus. It is the only way to reach the
 * settings without opening the toolbar popup, and on a maximised Maps window
 * the toolbar is a long way from where the user is looking.
 *
 * WHY A SHADOW ROOT
 * -----------------
 * This widget lives inside Google's document, and both directions of leakage
 * are real problems. Maps' own stylesheets would otherwise reach in (they set
 * things like `button { font: inherit }` and a global box-sizing), and our
 * rules would reach out. More importantly the sibling content script,
 * theme.js, rewrites every colour-valued custom property on `:root` -- if this
 * widget inherited from that cascade its palette would be transformed along
 * with Maps' own, which is exactly wrong: our chrome is already dark and is
 * not Google's to re-colour. A closed-over shadow root settles all of it, so
 * the styles below are deliberately NOT in a manifest-registered .css file.
 *
 * WHERE IT SITS
 * -------------
 * "Top left, and not covered by Google's weather card" is the requirement, but
 * that card is conditional -- it appears for some viewports and locations and
 * not others, and Maps' class names are obfuscated and rotate, so a selector
 * cannot find it. Instead we measure: find Google's own top-left overlay stack
 * geometrically and sit below whatever is actually there. See placement().
 */
(function () {
  const doc = document;
  const root = doc.documentElement;
  if (!root || root.__gmdmWidgetLoaded) return;
  root.__gmdmWidgetLoaded = true;

  const api = globalThis.browser ?? globalThis.chrome;

  /* ---------------------------------------------------------------- config */

  const HOST_ID = 'gmdm-widget-host';
  const KOFI_URL = 'https://ko-fi.com/irp_hongkong';
  const KOFI_HANDLE = '@IRP_HongKong';
  const GITHUB_URL = 'https://github.com/charlie754/google-map-dark-mode';
  const GOAT_URL = 'https://goatcam.dagoat.io';
  const GOAT_LOCKUP_CSS = "/* GOAT Cam banner. A copy of the master stylesheet, goatcam-banner.css in the\n   GOAT Cam repository's brand/goatcam-banner folder (2026-10-25), with its\n   comments removed; no rule is changed. Change the master, then copy it again.\n   Photo: \"White cup and MacBook\" by Alex Knight, CC0 1.0. */\n.goat {\n  --gc-950: #140d08; --gc-900: #1c130c; --gc-caramel: #c98a46; --gc-caramel-deep: #8f4f1c;\n  --gc-gold: #f0c07a; --gc-cream: #f8eedf; --gc-cream-soft: #d8c2a5; --gc-muted: #b09878;\n  --gc-line: rgba(248, 238, 223, .14);\n  --gc-serif: \"Palatino Linotype\", Palatino, \"Book Antiqua\", \"Iowan Old Style\", \"URW Palladio L\", P052, Georgia, serif;\n  --gc-sans: \"Segoe UI Variable Text\", \"Segoe UI\", system-ui, -apple-system, \"Helvetica Neue\", Roboto, Arial, sans-serif;\n  --gc-mono: ui-monospace, \"Cascadia Mono\", \"Cascadia Code\", Consolas, \"SF Mono\", Menlo, monospace;\n  --gc-in: cubic-bezier(.16, 1, .3, 1);\n  --gc-out: cubic-bezier(.4, 0, .2, 1);\n  --gc-t-out: 360ms;\n  --gc-ink: var(--ink-cream, #f0e6d2);\n  --gc-ink-muted: var(--ink-muted, #a99f8c);\n  --gc-lift: scale(1.05);\n  --gc-press: scale(.96);\n  --gc-lift-shadow: 0 18px 44px rgba(0, 0, 0, .55), 0 0 0 1px rgba(240, 192, 122, .22);\n  --gl-cream: var(--gc-cream); --gl-glyph: #f6efe6; --gl-seal: var(--gc-caramel-deep); --gl-seal-lit: var(--gc-caramel);\n  --gl-name: var(--gc-cream); --gl-tag: var(--gc-muted); --gl-spark: var(--gc-gold);\n  --gl-meteor-tail: rgba(248, 238, 223, 0); --gl-meteor-head: rgba(240, 192, 122, .7); --gl-meteor-halo: rgba(240, 192, 122, .5);\n  --gl-in: var(--gc-in); --gl-out: var(--gc-out); --gl-t-out: var(--gc-t-out); --gl-t-fade: 450ms; --gl-seal-scale: 1;\n  display: block; box-sizing: border-box; width: 100%; margin: 0; padding: 0;\n  color: var(--gc-ink); font: 400 10.5px/1.4 var(--gc-sans); text-align: left; -webkit-font-smoothing: antialiased;\n}\n.goat *, .goat *::before, .goat *::after { box-sizing: border-box; }\n\n.goat__copy { display: flex; flex-direction: column; gap: 4px; margin: 0 0 8px; padding: 2px 0 0; }\n.goat__line { display: block; margin: 0; font-size: 10.5px; line-height: 1.4; font-weight: 500; color: var(--gc-ink); text-wrap: pretty; }\n.goat__line--ask { color: var(--gc-ink-muted); font-weight: 400; }\n.goat__line em { font: italic 700 1.14em/1 var(--gc-serif); color: var(--gc-gold); letter-spacing: .02em; }\n\n.goat .goat-lockup {\n  position: relative; display: grid; isolation: isolate; width: 100%; max-width: 100%; min-width: 0; margin: 0;\n  border: 1px solid var(--gc-line); border-radius: 10px; background: var(--gc-950);\n  overflow: hidden; overflow: clip;\n  color: var(--gc-cream); font-size: 7.2px; line-height: 1; text-decoration: none; cursor: pointer;\n  -webkit-tap-highlight-color: transparent;\n  transition: transform var(--gc-t-out) var(--gc-out), box-shadow var(--gc-t-out) var(--gc-out);\n}\n.goat .goat-lockup:hover { color: var(--gc-cream); text-decoration: none; }\n.goat .goat-lockup:focus-visible { outline: 2px solid var(--gc-gold); outline-offset: 2px; }\n.goat-lockup ::selection { background: var(--gc-caramel-deep); color: #f6efe6; }\n\n.gc-photo {\n  --gc-arm: 9px; --gc-vf-in: 6px;\n  grid-area: photo; position: relative; z-index: 1; display: block; min-width: 0;\n  overflow: hidden; container-type: size; background: var(--gc-950);\n  --gc-edge: linear-gradient(to left, #0000, #000 3px);\n  -webkit-mask: var(--gc-edge); mask: var(--gc-edge);\n}\n.gc-photo__frame {\n  position: absolute; left: var(--gc-px, 50%); top: var(--gc-py, 40%); display: block;\n  width: 100%; width: max(100cqw, 100cqh * 264 / 222); aspect-ratio: 264 / 222;\n  translate: calc(var(--gc-px, 50%) * -1) calc(var(--gc-py, 40%) * -1);\n  transform-origin: 48% 42%; transition: transform var(--gc-t-out) var(--gc-out);\n}\n.gc-photo__img {\n  display: block; width: 100%; height: 100%; max-width: none; margin: 0; border: 0;\n  object-fit: cover; user-select: none; -webkit-user-drag: none;\n}\n.gc-photo::after {\n  content: \"\"; position: absolute; inset: 0; z-index: 1; pointer-events: none;\n  background: var(--gc-scrim, linear-gradient(to right, rgba(20, 13, 8, 0) 62%, var(--gc-950)));\n}\n.gc-steam {\n  position: absolute; left: 58%; bottom: 75%; width: 24%; height: auto; aspect-ratio: 60 / 120;\n  translate: -50% 0; overflow: visible; opacity: 0; filter: blur(.6px);\n  transition: opacity var(--gc-t-out) var(--gc-out);\n}\n.gc-steam path {\n  fill: none; stroke: rgba(255, 247, 236, .9); stroke-width: 6; stroke-linecap: round;\n  stroke-dasharray: 44 100; stroke-dashoffset: 44; animation: gc-steam 3.2s linear infinite paused;\n}\n.gc-steam path:nth-child(2) { animation-duration: 3.7s; animation-delay: -1.3s; }\n.gc-steam path:nth-child(3) { animation-duration: 2.9s; animation-delay: -2.2s; }\n\n.gc-vf {\n  --gc-m: conic-gradient(at var(--gc-arm) var(--gc-arm), #0000 75%, #000 0) 0 0 / calc(100% - var(--gc-arm)) calc(100% - var(--gc-arm));\n  position: absolute; z-index: 2; pointer-events: none;\n  inset: var(--gc-vf-in) var(--gc-vf-in) calc(var(--gc-vf-in) + var(--gc-vf-b, 0px));\n  border: 2px solid rgba(248, 238, 223, .62); -webkit-mask: var(--gc-m); mask: var(--gc-m);\n  transition: inset var(--gc-t-out) var(--gc-out);\n}\n.gc-vf::after {\n  content: \"\"; position: absolute; inset: -2px; border: 2px solid var(--gc-gold); opacity: 0;\n  transition: opacity var(--gc-t-out) var(--gc-out);\n}\n\n.gc-osd {\n  position: absolute; z-index: 3; top: 3px; left: calc(var(--gc-vf-in) + var(--gc-arm) + 6px);\n  display: flex; align-items: flex-start; gap: 3px; margin: 0; padding: 3px 4px; border-radius: 4px;\n  background: rgba(20, 13, 8, .62); color: var(--gc-cream);\n  font: 500 var(--gc-osd-fs, 6.5px)/1 var(--gc-mono); letter-spacing: .05em; font-variant-numeric: tabular-nums; white-space: nowrap;\n}\n.gc-osd__dot { flex: none; width: var(--gc-dot, 5px); height: var(--gc-dot, 5px); margin-top: 1px; border-radius: 50%; background: var(--gc-gold); }\n.gc-osd__t { display: flex; flex-direction: column; gap: 2px; }\n.gc-osd__sep { display: none; }\n\n.gc-qr { grid-area: qr; position: relative; z-index: 2; display: flex; align-items: center; gap: 10px; min-width: 0; }\n.gc-qr__tile {\n  flex: none; display: block; width: var(--gc-qr, 72px); height: var(--gc-qr, 72px); overflow: hidden;\n  border-radius: var(--gc-qr-r, 6px); background: #fbf5ea;\n  box-shadow: 0 6px 16px -8px rgba(0, 0, 0, .7), 0 0 0 0 rgba(201, 138, 70, 0);\n  transition: box-shadow var(--gc-t-out) var(--gc-out);\n}\n.gc-qr__tile svg { display: block; width: 100%; height: 100%; shape-rendering: crispEdges; }\n.gc-qr__cap { display: none; flex-direction: column; gap: 2px; color: var(--gc-cream-soft); font: 600 11px/1.3 var(--gc-sans); white-space: nowrap; }\n.gc-qr__cap span { color: var(--gc-muted); font-weight: 400; }\n\n.goat-lockup__mark { grid-area: mark; position: relative; z-index: 1; display: block; height: 5.4em; align-self: center; }\n.goat-lockup__svg { display: block; height: 100%; width: auto; overflow: visible; }\n.gl-head > * { fill: var(--gl-cream); }\n.gl-seal { transform-box: fill-box; transform-origin: 50% 50%; transform: scale(var(--gl-seal-scale, 1)); }\n.gl-seal-face { fill: var(--gl-seal); transition: fill var(--gl-t-out) var(--gl-out); }\n.gl-seal-glow { fill: var(--gl-seal-lit); opacity: 0; filter: blur(5px); transition: opacity var(--gl-t-out) var(--gl-out); }\n.gl-glyph { overflow: visible; }\n.gl-char { fill: var(--gl-glyph); opacity: 1; transition: opacity var(--gl-t-out) var(--gl-out); }\n.gl-thumb { fill: var(--gl-glyph); opacity: 0; transition: opacity var(--gl-t-out) var(--gl-out); }\n.gl-burst { opacity: 0; }\n.gl-ray { stroke: var(--gl-spark); stroke-width: 3.2; stroke-linecap: round; stroke-dasharray: 9 32; stroke-dashoffset: 9; opacity: 0; }\n.gl-ring { fill: none; stroke: var(--gl-spark); stroke-width: 3; opacity: 0; transform-box: fill-box; transform-origin: 50% 50%; }\n.gl-ember { fill: var(--gl-spark); opacity: 0; transform-box: fill-box; transform-origin: 50% 50%; }\n.goat-lockup__word {\n  grid-area: word; position: relative; z-index: 1; display: flex; flex-direction: column;\n  align-items: flex-start; justify-content: center; gap: var(--gc-word-gap, 5px); min-width: 0;\n}\n.goat-lockup__name {\n  display: block; margin: 0; padding: 0; font: 400 var(--gc-name, 18px)/1 var(--gc-serif); letter-spacing: -.005em;\n  text-transform: none; text-indent: 0; color: var(--gl-name); white-space: nowrap;\n}\n.goat-lockup__tag {\n  display: block; margin: 0; padding: 0; font: 600 var(--gc-tag, 7px)/1.25 var(--gc-sans);\n  letter-spacing: var(--gc-tag-track, .14em); text-transform: uppercase; text-indent: 0; color: var(--gl-tag);\n  white-space: nowrap; transition: color var(--gl-t-out) var(--gl-out);\n}\n.gc-tag__sep { white-space: pre; }\n\n.goat-lockup__meteors {\n  grid-row: mark; grid-column: mark-start / word-end; position: absolute; inset: var(--gc-meteor-inset, -22% -12%);\n  z-index: 0; overflow: hidden; pointer-events: none; opacity: 0; transition: opacity var(--gl-t-out) var(--gl-out);\n  -webkit-mask-image: radial-gradient(120% 100% at 40% 45%, #000 34%, transparent 78%);\n  mask-image: radial-gradient(120% 100% at 40% 45%, #000 34%, transparent 78%);\n}\n.goat-lockup__meteors i {\n  position: absolute; top: 0; left: 0; width: 1px; height: var(--gl-m-h, 4.4em); border-radius: 1px;\n  background: linear-gradient(to bottom, var(--gl-meteor-tail), var(--gl-meteor-head));\n  rotate: 34deg; translate: 3.2em -4.8em;\n  animation: gl-meteor var(--gl-m-d, 3.3s) linear var(--gl-m-delay, 0s) infinite paused;\n}\n.goat-lockup__meteors i::after {\n  content: \"\"; position: absolute; left: 50%; bottom: 0; width: 2.5px; height: 2.5px; border-radius: 50%;\n  background: var(--gl-cream); box-shadow: 0 0 7px 1px var(--gl-meteor-halo); translate: -50% 40%;\n}\n.goat-lockup__meteors i:nth-child(1) { left: 74%; top: 6%;  --gl-m-h: 5.2em; --gl-m-d: 2.85s; --gl-m-delay: 0s; }\n.goat-lockup__meteors i:nth-child(2) { left: 52%; top: -4%; --gl-m-h: 3.4em; --gl-m-d: 3.9s;  --gl-m-delay: -.48s; }\n.goat-lockup__meteors i:nth-child(3) { left: 89%; top: 22%; --gl-m-h: 4.6em; --gl-m-d: 3.15s; --gl-m-delay: -1.11s; }\n.goat-lockup__meteors i:nth-child(4) { left: 33%; top: 12%; --gl-m-h: 2.8em; --gl-m-d: 4.65s; --gl-m-delay: -1.65s; }\n.goat-lockup__meteors i:nth-child(5) { left: 64%; top: 38%; --gl-m-h: 3.9em; --gl-m-d: 3.6s;  --gl-m-delay: -.27s; }\n.goat-lockup__meteors i:nth-child(6) { left: 18%; top: -8%; --gl-m-h: 4.1em; --gl-m-d: 4.2s;  --gl-m-delay: -1.43s; }\n.goat-lockup__meteors i:nth-child(7) { left: 97%; top: -2%; --gl-m-h: 3.1em; --gl-m-d: 3.45s; --gl-m-delay: -2.18s; }\n.goat-lockup__meteors i:nth-child(8) { left: 44%; top: 30%; --gl-m-h: 5.6em; --gl-m-d: 2.55s; --gl-m-delay: -.87s; }\n.goat-lockup__meteors i:nth-child(9) { left: 82%; top: 48%; --gl-m-h: 2.6em; --gl-m-d: 5.1s;  --gl-m-delay: -2.7s; }\n\n.goat-lockup:is(:hover, :focus-visible, .is-active) .goat-lockup__meteors { opacity: 1; transition-duration: 630ms; }\n.goat-lockup:is(:hover, :focus-visible, .is-active) .goat-lockup__meteors i,\n.goat-lockup:is(:hover, :focus-visible, .is-active) .gc-steam path { animation-play-state: running; }\n.goat-lockup:is(:hover, :focus-visible, .is-active) .goat-lockup__tag { color: var(--gl-name); transition-duration: 630ms; }\n.goat-lockup:is(:hover, :focus-visible, .is-active) .gl-seal-face { fill: var(--gl-seal-lit); transition-duration: 690ms; }\n.goat-lockup:is(:hover, :focus-visible, .is-active) .gl-seal-glow { opacity: .7; transition: opacity 690ms var(--gl-in); }\n.goat-lockup:is(:hover, :focus-visible, .is-active) .gl-char { opacity: 0; transition: opacity var(--gl-t-fade) linear; }\n.goat-lockup:is(:hover, :focus-visible, .is-active) .gl-thumb { opacity: 1; transition: opacity var(--gl-t-fade) linear 180ms; }\n.goat-lockup:is(:hover, :focus-visible, .is-active) .gl-burst { opacity: 1; }\n.goat-lockup:is(:hover, :focus-visible, .is-active) .gl-ray { animation: gl-ray 690ms var(--gl-in) var(--gl-ray-lag, 0ms) both; }\n.goat-lockup:is(:hover, :focus-visible, .is-active) .gl-ring { animation: gl-ring 930ms var(--gl-in) 705ms both; }\n.goat-lockup:is(:hover, :focus-visible, .is-active) .gl-ember { animation: gl-ember 1350ms var(--gl-in) var(--gl-ember-lag, 840ms) both; }\n.gl-ray--1 { --gl-ray-lag: 720ms; } .gl-ray--2 { --gl-ray-lag: 765ms; } .gl-ray--3 { --gl-ray-lag: 738ms; }\n.gl-ray--4 { --gl-ray-lag: 792ms; } .gl-ray--5 { --gl-ray-lag: 752ms; } .gl-ray--6 { --gl-ray-lag: 816ms; }\n.gl-ember--a { --gl-ember-lag: 840ms; --gl-ex: -13px; --gl-ey: -28px; }\n.gl-ember--b { --gl-ember-lag: 975ms; --gl-ex: 15px;  --gl-ey: -21px; }\n.gl-ember--c { --gl-ember-lag: 908ms; --gl-ex: 3px;   --gl-ey: -34px; }\n.goat-lockup:is(:hover, :focus-visible, .is-active) .gc-photo__frame { transform: scale(1.06); transition: transform 1200ms var(--gc-in); }\n.goat-lockup:is(:hover, :focus-visible, .is-active) .gc-vf {\n  inset: calc(var(--gc-vf-in) + 3px) calc(var(--gc-vf-in) + 3px) calc(var(--gc-vf-in) + var(--gc-vf-b, 0px) + 3px);\n  transition: inset 420ms var(--gc-in);\n}\n.goat-lockup:is(:hover, :focus-visible, .is-active) .gc-vf::after { opacity: 1; transition: opacity 300ms linear 140ms; }\n.goat-lockup:is(:hover, :focus-visible, .is-active) .gc-osd__dot { animation: gc-tally 2.4s .5s ease-in-out infinite; }\n.goat-lockup:is(:hover, :focus-visible, .is-active) .gc-steam { opacity: 1; transition: opacity 700ms var(--gc-in) 150ms; }\n.goat-lockup:is(:hover, :focus-visible, .is-active) .gc-qr__tile {\n  box-shadow: 0 6px 16px -8px rgba(0, 0, 0, .7), 0 0 0 2px rgba(201, 138, 70, .6), 0 0 14px rgba(201, 138, 70, .28);\n  transition: box-shadow 630ms var(--gc-in);\n}\n\n.goat:not(.goat--gated) .goat-lockup:hover {\n  transform: var(--gc-lift); box-shadow: var(--gc-lift-shadow);\n  transition: transform 420ms var(--gc-in), box-shadow 420ms var(--gc-in);\n}\n.goat:not(.goat--gated) .goat-lockup:active { transform: var(--gc-press); transition-duration: 120ms; }\n\n@keyframes gl-meteor { 0% { translate: 3.2em -4.8em; opacity: 0; } 9% { opacity: 1; } 68% { opacity: 1; } 100% { translate: -3.4em 5.1em; opacity: 0; } }\n@keyframes gl-ray { 0% { stroke-dashoffset: 9; opacity: 0; } 22% { opacity: 1; } 100% { stroke-dashoffset: -32; opacity: 0; } }\n@keyframes gl-ring { 0% { transform: scale(.3); opacity: 0; } 18% { opacity: .85; } 100% { transform: scale(1.9); opacity: 0; } }\n@keyframes gl-ember {\n  0% { transform: translate(0, 0) scale(.4); opacity: 0; } 25% { opacity: .9; }\n  100% { transform: translate(var(--gl-ex, 6px), var(--gl-ey, -16px)) scale(1); opacity: 0; }\n}\n@keyframes gc-steam { 0% { stroke-dashoffset: 44; opacity: 0; translate: 0 0; } 18% { opacity: .95; } 65% { opacity: .6; } 100% { stroke-dashoffset: -100; opacity: 0; translate: 2px -6px; } }\n@keyframes gc-tally { 0%, 100% { opacity: 1; } 50% { opacity: .3; } }\n\n.goat--panel .goat-lockup {\n  font-size: 7.2px; --gl-seal-scale: 1.8; --gc-meteor-inset: -40% 0 -20%;\n  grid-template-columns: auto minmax(0, 1fr) 72px; grid-template-rows: 72px auto;\n  grid-template-areas: \"photo photo qr\" \"mark word word\"; gap: 4px 8px; padding: 7px 7px 7px 10px;\n}\n.goat--panel .gc-photo {\n  margin: -7px 0 -24px -10px; --gc-px: 46%; --gc-py: 8%; --gc-vf-b: 22px;\n  --gc-scrim: linear-gradient(to right, rgba(20, 13, 8, 0) 70%, var(--gc-950)), linear-gradient(to bottom, rgba(20, 13, 8, 0) 52%, rgba(20, 13, 8, .86) 78%, var(--gc-950) 94%);\n  --gc-edge: linear-gradient(to left, #0000, #000 3px), linear-gradient(to top, #0000, #000 3px);\n  -webkit-mask-composite: source-in; mask-composite: intersect;\n}\n\n.goat--panel .gc-osd { --gc-osd-fs: 6.5px; align-items: center; gap: 3px; padding: 2px 4px; left: calc(var(--gc-vf-in) + var(--gc-arm) + 3px); }\n.goat--panel .gc-osd__t { display: block; }\n.goat--panel .gc-osd__sep { display: inline; white-space: pre; }\n.goat--panel .gc-osd__dot { margin-top: 0; }\n.goat--panel .gc-steam { left: 63%; }\n\n.goat--settings .goat-lockup {\n  font-size: 13px; --gl-seal-scale: 1.25; --gc-name: 26px; --gc-tag: 8px; --gc-tag-track: .15em; --gc-word-gap: 8px;\n  --gc-qr: 74px; --gc-qr-r: 7px; --gc-lift: scale(1.02); --gc-press: scale(.99);\n  grid-template-columns: 128px auto minmax(0, 1fr) auto; grid-template-areas: \"photo mark word qr\";\n  align-items: center; column-gap: 14px; padding: 13px 14px 13px 0;\n}\n.goat--settings .gc-photo { --gc-arm: 11px; --gc-vf-in: 7px; --gc-px: 46%; --gc-py: 42%; align-self: stretch; margin: -13px 0; }\n.goat--settings .gc-osd { --gc-osd-fs: 7px; --gc-dot: 7px; top: 4px; gap: 4px; padding: 3px 5px; }\n.goat--settings .gc-qr__cap { display: flex; }\n\n.goat--strip { display: inline-flex; flex-wrap: nowrap; align-items: center; gap: 10px; width: auto; max-width: none; }\n.goat--strip .goat__copy { flex: none; width: 160px; margin: 0; gap: 3px; }\n.goat--strip .goat-lockup {\n  flex: none; width: max-content; height: 76px; font-size: 8px; --gl-seal-scale: 1.6; --gc-tag: 7px; --gc-word-gap: 4px;\n  --gc-qr-r: 8px; --gc-meteor-inset: -22% -10%; --gc-lift: scale(1.02); --gc-press: scale(.99);\n  grid-template-columns: 96px auto auto 72px; grid-template-areas: \"photo mark word qr\";\n  align-items: center; column-gap: 10px; padding: 1px 1px 1px 0;\n}\n.goat--strip .gc-photo { --gc-arm: 8px; --gc-vf-in: 5px; --gc-px: 50%; --gc-py: 40%; align-self: stretch; margin: -1px 0; }\n.goat--strip .gc-osd, .goat--strip .gc-tag__sep { display: none; }\n.goat--strip .goat-lockup__tag { display: flex; flex-direction: column; }\n\n@media (prefers-reduced-motion: reduce) {\n  .goat-lockup__meteors i { animation: none; translate: 0 0; opacity: .5; }\n  .gc-steam { display: none; }\n  .goat-lockup:is(:hover, :focus-visible, .is-active) .gl-ray,\n  .goat-lockup:is(:hover, :focus-visible, .is-active) .gl-ember { animation: none; opacity: 0; }\n  .goat-lockup:is(:hover, :focus-visible, .is-active) .gl-ring { animation: none; opacity: .5; transform: scale(1.15); transition: opacity 330ms linear 300ms; }\n  .goat-lockup:is(:hover, :focus-visible, .is-active) .gc-photo__frame { transform: none; }\n  .goat-lockup:is(:hover, :focus-visible, .is-active) .gc-vf { inset: var(--gc-vf-in) var(--gc-vf-in) calc(var(--gc-vf-in) + var(--gc-vf-b, 0px)); }\n  .goat-lockup:is(:hover, :focus-visible, .is-active) .gc-osd__dot { animation: none; }\n  .goat .goat-lockup, .goat:not(.goat--gated) .goat-lockup:hover, .goat:not(.goat--gated) .goat-lockup:active { transform: none; }\n}\n";

  /** Gap between Google's lowest top-left card and our pill. */
  const STACK_GAP = 12;
  /** Expanded panel width. Must match `.shell.is-open`; used for collision maths. */
  const OPEN_WIDTH = 272;
  /** Fallbacks used until a measurement succeeds, and as clamps afterwards. */
  const MIN_TOP = 12;
  const MAX_TOP = 460;
  const FALLBACK_TOP = 190;
  const FALLBACK_LEFT = 16;
  /** The region we consider "Google's top-left stack" when probing. */
  const PROBE_MAX_LEFT = 460;
  const PROBE_MAX_TOP = 420;
  const PROBE_MIN_WIDTH = 180;
  const PROBE_MIN_HEIGHT = 28;
  /** Pass 2 counts anything chip-sized upward, not just full cards. */
  const OBSTACLE_MIN_WIDTH = 56;
  /** Above this, a left-column overlay is a panel we must vacate, not a card we
   *  sit under. Measured: weather/traffic card 100px, suggestions 246px. */
  const LEFT_COLUMN_MIN_HEIGHT = 160;

  const DEFAULT_SETTINGS = { enabled: true, darkMap: true, darkChrome: true };

  /* ----------------------------------------------------------------- style
   * The design vocabulary is lifted from the GOAT desktop app's theme.css so
   * the two products read as one hand: glass surfaces, the same easing curve,
   * the same three durations, the same accent. Values are inlined rather than
   * referenced because a shadow root does not inherit the page's custom
   * properties, and we would not want Maps' :root anyway (see file header). */

  const CSS = `
:host {
  all: initial;
  position: fixed;
  z-index: 2147483000;
  font-family: -apple-system, "Segoe UI", system-ui, Roboto, sans-serif;
  contain: layout style;
}

* { box-sizing: border-box; }

:host {
  --glass-bg: rgba(28, 26, 38, 0.62);
  --glass-border: rgba(255, 255, 255, 0.13);
  --glass-blur: 16px;
  --glass-radius: 14px;
  --glass-shadow: 0 8px 22px rgba(0, 0, 0, 0.32);
  --glass-shadow-hover: 0 18px 44px rgba(0, 0, 0, 0.55);
  --ink-cream: #f0e6d2;
  --ink-muted: #a99f8c;
  --accent: #3ecf8e;
  --accent-ink: #0e2419;
  --switch-off: #4a4557;
  --kofi: #d2413e;
  --ease: cubic-bezier(0.25, 0.1, 0.25, 1);
  --dur-fast: 200ms;
  --dur-base: 300ms;
  --dur-slow: 420ms;
}

/* Collapsed still shows the words "Dark Mode" and its On/Off state -- an icon
   alone does not tell you whether the thing is currently on, which is the one
   fact the control exists to convey. */
.shell {
  width: 158px;
  background: var(--glass-bg);
  border: 0.5px solid var(--glass-border);
  border-radius: var(--glass-radius);
  box-shadow: var(--glass-shadow);
  backdrop-filter: blur(var(--glass-blur)) saturate(1.3);
  -webkit-backdrop-filter: blur(var(--glass-blur)) saturate(1.3);
  overflow: hidden;
  color: var(--ink-cream);
  transition:
    width var(--dur-base) var(--ease),
    box-shadow var(--dur-base) var(--ease),
    transform var(--dur-base) var(--ease);
}

.shell:hover { transform: scale(1.025); box-shadow: var(--glass-shadow-hover); }
.shell.is-open { width: 272px; transform: none; box-shadow: var(--glass-shadow-hover); }

/* ---- the always-visible pill ---- */

.pill {
  all: unset;
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  height: 46px;
  padding: 0 13px;
  cursor: pointer;
  box-sizing: border-box;
  transition: transform var(--dur-base) var(--ease);
}
.pill:focus-visible { outline: 2px solid var(--accent); outline-offset: -3px; border-radius: var(--glass-radius); }
/* Inset when open so 1.05 fits inside the shell's overflow:hidden. */
.shell.is-open .pill {
  width: calc(100% - 16px);
  margin: 2px 8px 0;
  border-radius: 10px;
}
.shell.is-open .pill:hover { transform: scale(1.05); }
.shell.is-open .pill:active { transform: scale(0.96); }

.moon {
  flex: 0 0 20px;
  width: 20px;
  height: 20px;
  color: var(--ink-muted);
  transition: color var(--dur-base) var(--ease), transform var(--dur-slow) var(--ease);
}
.shell.is-on .moon { color: var(--accent); }
.shell.is-open .moon { transform: rotate(-18deg); }

/* The label is clipped away with the shell when collapsed, so it needs no
   separate hiding rule -- but it must not wrap or it reflows mid-animation. */
.pill__text { display: flex; flex-direction: column; min-width: 0; white-space: nowrap; }
.pill__title { font-size: 12.5px; font-weight: 600; letter-spacing: 0.2px; }
.pill__state { font-size: 10.5px; color: var(--ink-muted); transition: color var(--dur-base) var(--ease); }
.shell.is-on .pill__state { color: var(--accent); }

.chev {
  margin-left: auto;
  width: 14px;
  height: 14px;
  color: var(--ink-muted);
  transition: transform var(--dur-base) var(--ease);
}
.shell.is-open .chev { transform: rotate(180deg); }

/* ---- the expanding body ----
   grid-template-rows 0fr -> 1fr is the one way to transition to an intrinsic
   height without measuring it in JS, which would desync the moment the panel's
   content changes. The inner wrapper needs min-height:0 for it to collapse. */

.body {
  display: grid;
  grid-template-rows: 0fr;
  transition: grid-template-rows var(--dur-base) var(--ease);
}
.shell.is-open .body { grid-template-rows: 1fr; }
.body__inner { overflow: hidden; min-height: 0; }
.body__pad { padding: 2px 13px 13px; }

.rule { height: 0.5px; background: var(--glass-border); margin: 0 0 10px; }

/* Rows fade and rise in, staggered, so the panel assembles rather than
   appearing. Delays are only on the way in; closing is immediate so the panel
   never appears to hesitate when the pointer leaves. */
.row, .kofi, .gh, .goat {
  opacity: 0;
  transform: translateY(-6px);
  transition: opacity var(--dur-fast) var(--ease), transform var(--dur-base) var(--ease),
              box-shadow var(--dur-base) var(--ease), background var(--dur-fast) var(--ease);
}
.shell.is-open .row,
.shell.is-open .kofi,
.shell.is-open .gh,
.shell.is-open .goat { opacity: 1; transform: none; }
/* Keyed by data-row, not :nth-of-type -- the rows share a parent with a rule
   and two paragraphs, so type counting would silently address the wrong ones. */
.shell.is-open .row[data-row="enabled"]    { transition-delay: 60ms; }
.shell.is-open .row[data-row="darkMap"]    { transition-delay: 110ms; }
.shell.is-open .row[data-row="darkChrome"] { transition-delay: 160ms; }
.shell.is-open .kofi { transition-delay: 210ms; }
.shell.is-open .gh   { transition-delay: 250ms; }
.shell.is-open .goat { transition-delay: 290ms; }

/* ---- switch rows ---- */

.row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 0;
}
.row__text { min-width: 0; flex: 1; }
.row__label { display: block; font-size: 12px; font-weight: 500; }
.row__hint { display: block; font-size: 10.5px; color: var(--ink-muted); margin-top: 1px; }
.row.is-sub { padding-left: 8px; }
.row.is-muted .row__label, .row.is-muted .row__hint { color: var(--switch-off); }

.track {
  all: unset;
  flex: 0 0 40px;
  width: 40px;
  height: 24px;
  border-radius: 12px;
  background: var(--switch-off);
  position: relative;
  cursor: pointer;
  transition: background var(--dur-base) var(--ease), box-shadow var(--dur-base) var(--ease),
              transform var(--dur-base) var(--ease);
}
.track.on { background: var(--accent); box-shadow: 0 0 14px rgba(62, 207, 142, 0.35); }
.track:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.track:disabled { cursor: not-allowed; opacity: 0.45; }
.thumb {
  position: absolute;
  top: 3px;
  left: 3px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: #fff;
  transition: left var(--dur-base) var(--ease);
}
.track.on .thumb { left: 19px; }
.track:not(:disabled):active .thumb { width: 22px; }

/* ---- Ko-fi ---- */

.kofi {
  all: unset;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 9px;
  width: 100%;
  box-sizing: border-box;
  margin-top: 4px;
  padding: 9px 12px;
  border-radius: 11px;
  background: var(--kofi);
  color: #fff;
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
  box-shadow: 0 6px 18px rgba(210, 65, 62, 0.28);
  /* Re-declared here, and this is not redundant: the "all: unset" at the top of
     this rule resets transition to none, and this rule comes AFTER the
     .row/.kofi/.gh block that sets it. Without this the hover scale applied
     instantly -- the button jumped to 1.05 with no animation whatsoever, which
     is exactly what it looked like. */
  transition: opacity var(--dur-fast) var(--ease), transform var(--dur-base) var(--ease),
              box-shadow var(--dur-base) var(--ease), background var(--dur-fast) var(--ease);
}
/* The stagger transition above owns opacity/transform, so hover adds its own
   properties rather than replacing the shorthand. */
.kofi:hover { background: #e04b48; }
.kofi:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }

/* Hover lift, taken from the GOAT desktop app so both products answer the
   pointer the same way: .glass:hover scales and swaps in --glass-shadow-hover,
   .primary-cta scales 1.05 on hover and 0.96 on press.
   Scoped under .shell.is-open because the entry-stagger rule parks transform
   at none at the same specificity -- unscoped, whichever came last would win
   and the lift would be a coin flip. The GOAT Cam banner's lift is gated the
   same way, with the banner's own tokens: see "GOAT Cam banner" below. */
.shell.is-open .kofi:hover,
.shell.is-open .gh:hover { transform: scale(1.05); }
.shell.is-open .kofi:active,
.shell.is-open .gh:active { transform: scale(0.96); }
.shell.is-open .track:not(:disabled):hover { transform: scale(1.15); }
.shell.is-open .track:not(:disabled):active { transform: scale(0.96); }

/* The entry stagger above parks a 210ms/250ms transition-delay on these two
   buttons, and a delay set in one rule keeps applying in every other state.
   Hovering therefore sat still for a fifth of a second before the scale began,
   which reads as "the button does not animate" -- and it is invisible to any
   assertion that only samples the final transform. Clear it for the pointer
   states so the lift starts on the same frame as the pointer arrives. */
.shell.is-open .kofi:hover, .shell.is-open .kofi:active,
.shell.is-open .gh:hover,   .shell.is-open .gh:active,
.shell.is-open .track:hover, .shell.is-open .track:active { transition-delay: 0s; }

.kofi:hover { box-shadow: var(--glass-shadow-hover), 0 10px 26px rgba(210, 65, 62, 0.45); }
.gh:hover { box-shadow: var(--glass-shadow-hover); }
/* Title over handle, matching the toolbar popup. Laying them side by side
   fits at 272px on paper but wraps the title the moment the font falls back. */
.kofi__label { display: flex; flex-direction: column; align-items: flex-start; line-height: 1.25; }
.kofi__handle { color: rgba(255, 255, 255, 0.82); font-weight: 500; font-size: 11px; }

.cup { width: 22px; height: 22px; overflow: visible; }

/* Steam. Three wisps on staggered delays, drifting as they rise so it reads as
   convection rather than three identical lines. Paused (not merely invisible)
   until hover, so it costs nothing while the panel is idle. */
.steam { opacity: 0; transform-origin: 50% 100%; }
.kofi:hover .steam,
.kofi:focus-visible .steam { animation: steam 2s var(--ease) infinite; }
.kofi:hover .steam--b,
.kofi:focus-visible .steam--b { animation-delay: 0.45s; }
.kofi:hover .steam--c,
.kofi:focus-visible .steam--c { animation-delay: 0.9s; }

@keyframes steam {
  0%   { opacity: 0;    transform: translateY(1px)  translateX(0)     scale(0.6); }
  22%  { opacity: 0.85; }
  55%  { opacity: 0.55; transform: translateY(-5px) translateX(1.2px) scale(1); }
  100% { opacity: 0;    transform: translateY(-10px) translateX(-1px) scale(1.25); }
}

.kofi:hover .cup__body { animation: cup-tilt 2s var(--ease) infinite; transform-origin: 50% 80%; }
@keyframes cup-tilt {
  0%, 100% { transform: rotate(0deg); }
  50%      { transform: rotate(-3.5deg); }
}

/* ---- GitHub button ----
 * Ported from uiverse.io/Itskrish01/fuzzy-warthog-48, which is published as
 * Tailwind utility classes; this is the same component rewritten as plain CSS
 * because a shadow root has no Tailwind. The four @keyframes it references are
 * NOT published on that page (they live in the author's own Tailwind config),
 * so they are reconstructed here from how each is used: a gradient blob swept
 * across the border, that blob scaling as it goes, the star turning, and a
 * blurred glow behind the star breathing. Widths match .kofi exactly. */

.gh {
  all: unset;
  position: relative;
  display: block;
  box-sizing: border-box;
  width: 100%;
  margin-top: 8px;
  padding: 1px;
  border-radius: 999px;
  background: #262626;
  overflow: hidden;
  cursor: pointer;
  /* See the note on .kofi: the "all: unset" above wipes the transition this
     rule would otherwise inherit from the .row/.kofi/.gh block. */
  transition: opacity var(--dur-fast) var(--ease), transform var(--dur-base) var(--ease),
              box-shadow var(--dur-base) var(--ease);
}
.gh:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

.gh__corner { position: absolute; inset: 0; border-radius: 999px; overflow: hidden; pointer-events: none; }
.gh__blob {
  display: block; width: 96px; height: 96px;
  transform: translate(-50%, -33%); filter: blur(20px);
  background: linear-gradient(135deg, #7a69f9, #f26378, #f5833f);
}
.gh__sweep {
  position: absolute; inset: 0; pointer-events: none;
  animation: gh-border-translate 10s ease-in-out infinite alternate;
}
.gh__bar {
  display: block; height: 100%; width: 48px; border-radius: 999px;
  transform: translateX(-50%); filter: blur(20px);
  background: linear-gradient(135deg, #7a69f9, #f26378, #f5833f);
  animation: gh-border-scale 10s ease-in-out infinite alternate;
}
.gh__inner {
  position: relative; z-index: 1;
  display: flex; align-items: center; justify-content: center; gap: 7px;
  padding: 8px 16px 8px 12px;
  border-radius: 999px;
  background: rgba(10, 10, 10, 0.9);
}
.gh__star { position: relative; display: inline-flex; transition: transform 500ms var(--ease); }
.gh:hover .gh__star { transform: scale(1.05) rotate(360deg); }
.gh__star svg { display: block; animation: gh-star-rotate 14s cubic-bezier(0.68, -0.55, 0.27, 1.55) infinite alternate; }
.gh__glow {
  position: absolute; top: 50%; left: 50%; width: 44px; height: 44px;
  border-radius: 999px; transform: translate(-50%, -50%); filter: blur(16px); opacity: 0.3;
  background: linear-gradient(135deg, #3bc4f2, #7a69f9, #f26378, #f5833f);
  animation: gh-star-shine 14s ease-in-out infinite alternate;
}
.gh__label {
  font-size: 12px; font-weight: 600; white-space: nowrap;
  background: linear-gradient(to bottom, #fff, rgba(255, 255, 255, 0.5));
  -webkit-background-clip: text; background-clip: text; color: transparent;
  transition: transform var(--dur-fast) var(--ease);
}
.gh:hover .gh__label { transform: scale(1.05); }

@keyframes gh-border-translate { from { transform: translateX(0); } to { transform: translateX(100%); } }
@keyframes gh-border-scale { from { transform: translateX(-50%) scale(1); } to { transform: translateX(-50%) scale(2); } }
@keyframes gh-star-rotate { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
@keyframes gh-star-shine {
  from { opacity: 0.14; transform: translate(-50%, -50%) scale(0.8); }
  to   { opacity: 0.45; transform: translate(-50%, -50%) scale(1.2); }
}

.gh { margin-bottom: 0; }

/* ---- GOAT Cam banner: host glue ----
 * The banner itself is the master GOAT Cam sheet, GOAT_LOCKUP_CSS (a copy of
 * brand/goatcam-banner.css), appended after this sheet. Nothing here restyles
 * it; this panel adds only two things:
 *  - the gap under StarGithub. The master's .goat rule zeroes margin and comes
 *    later in the cascade, so this rule carries a second class to outrank it.
 *  - the lift, gated on the open panel like Ko-fi and GitHub. The markup
 *    carries .goat--gated, which switches the master's ungated lift off; this
 *    is the gate from the master README ("Lift"). Reduced motion is covered by
 *    the .goat-lockup entry in the block at the end of this sheet.
 * Animation is :hover / :focus-visible / .is-active on .goat-lockup only --
 * hovering the sentences or StarGithub must not play it. */

.body__pad .goat {
  margin-top: 16px;
  margin-bottom: 2px;
}
.shell.is-open .goat--gated .goat-lockup:hover {
  transform: var(--gc-lift);
  box-shadow: var(--gc-lift-shadow);
  transition: transform 420ms var(--gc-in), box-shadow 420ms var(--gc-in);
}
.shell.is-open .goat--gated .goat-lockup:active { transform: var(--gc-press); transition-duration: 120ms; }

/* ---- health notice, only rendered when something is actually wrong ---- */
.warn {
  display: none;
  margin: 8px 0 0;
  padding: 7px 9px;
  border-radius: 9px;
  font-size: 10.5px;
  line-height: 1.45;
  background: rgba(229, 72, 77, 0.14);
  border: 0.5px solid rgba(229, 72, 77, 0.4);
  color: #f3b9bb;
}
.shell.has-warning .warn { display: block; }

@media (prefers-reduced-motion: reduce) {
  .shell, .shell:hover, .body, .row, .pill, .kofi, .gh, .goat, .goat-lockup, .moon, .chev, .thumb, .track {
    transition: none !important;
    transform: none !important;
  }
  .kofi:hover .steam, .kofi:focus-visible .steam, .kofi:hover .cup__body { animation: none !important; }
  .gh__sweep, .gh__bar, .gh__star svg, .gh__glow { animation: none !important; }
  .gh:hover .gh__star, .gh:hover .gh__label { transform: none !important; }
  /* Without the rise animation the rows still need to be visible when open. */
  .shell.is-open .row, .shell.is-open .kofi, .shell.is-open .gh, .shell.is-open .goat { opacity: 1; }
}
`;

  const CSS_ALL = CSS + "\n" + GOAT_LOCKUP_CSS;

  /* ---------------------------------------------------------------- markup */

  const SVG_MOON =
    '<svg class="moon" viewBox="0 0 24 24" fill="none" aria-hidden="true">' +
    '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" fill="currentColor"/></svg>';

  const SVG_CHEV =
    '<svg class="chev" viewBox="0 0 24 24" fill="none" aria-hidden="true">' +
    '<path d="m6 9 6 6 6-6" stroke="currentColor" stroke-width="2.4" ' +
    'stroke-linecap="round" stroke-linejoin="round"/></svg>';

  const SVG_CUP =
    '<svg class="cup" viewBox="0 0 24 24" fill="none" aria-hidden="true">' +
    '<g class="steam steam--a"><path d="M9 6.4c0-1 .9-1.2.9-2.2S9 2.6 9 2.6" ' +
    'stroke="currentColor" stroke-width="1.5" stroke-linecap="round" opacity="0.9"/></g>' +
    '<g class="steam steam--b"><path d="M12 6.4c0-1 .9-1.2.9-2.2S12 2.6 12 2.6" ' +
    'stroke="currentColor" stroke-width="1.5" stroke-linecap="round" opacity="0.9"/></g>' +
    '<g class="steam steam--c"><path d="M15 6.4c0-1 .9-1.2.9-2.2S15 2.6 15 2.6" ' +
    'stroke="currentColor" stroke-width="1.5" stroke-linecap="round" opacity="0.9"/></g>' +
    '<g class="cup__body">' +
    '<path d="M4 9h12v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5V9Z" fill="currentColor"/>' +
    '<path d="M16 10.5h1.6a2.4 2.4 0 0 1 0 4.8H16" stroke="currentColor" ' +
    'stroke-width="1.7" fill="none"/>' +
    '<path d="M3 21h14" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>' +
    '</g></svg>';

  /* The star path is the component's own, kept verbatim so the shape and its
     three-stop gradient are the published ones rather than an approximation.
     Gradient ids are namespaced -- this markup lands in a shadow root inside
     Google's document, and a bare `paint0_linear` would be a collision waiting
     to happen. */
  const SVG_STAR =
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">' +
    '<path d="M11.5268 2.29489C11.5706 2.20635 11.6383 2.13183 11.7223 2.07972C11.8062 2.02761 ' +
    '11.903 2 12.0018 2C12.1006 2 12.1974 2.02761 12.2813 2.07972C12.3653 2.13183 12.433 2.20635 ' +
    '12.4768 2.29489L14.7868 6.97389C14.939 7.28186 15.1636 7.5483 15.4414 7.75035C15.7192 7.95239 ' +
    '16.0419 8.08401 16.3818 8.13389L21.5478 8.88989C21.6457 8.90408 21.7376 8.94537 21.8133 ' +
    '9.00909C21.8889 9.07282 21.9452 9.15644 21.9758 9.2505C22.0064 9.34456 22.0101 9.4453 21.9864 ' +
    '9.54133C21.9627 9.63736 21.9126 9.72485 21.8418 9.79389L18.1058 13.4319C17.8594 13.672 17.6751 ' +
    '13.9684 17.5686 14.2955C17.4622 14.6227 17.4369 14.9708 17.4948 15.3099L18.3768 20.4499C18.3941 ' +
    '20.5477 18.3835 20.6485 18.3463 20.7406C18.3091 20.8327 18.2467 20.9125 18.1663 20.9709C18.086 ' +
    '21.0293 17.9908 21.0639 17.8917 21.0708C17.7926 21.0777 17.6935 21.0566 17.6058 21.0099L12.9878 ' +
    '18.5819C12.6835 18.4221 12.345 18.3386 12.0013 18.3386C11.6576 18.3386 11.3191 18.4221 11.0148 ' +
    '18.5819L6.3978 21.0099C6.31013 21.0563 6.2112 21.0772 6.11225 21.0701C6.0133 21.0631 5.91832 ' +
    '21.0285 5.83809 20.9701C5.75787 20.9118 5.69563 20.8321 5.65846 20.7401C5.62128 20.6482 5.61066 ' +
    '20.5476 5.6278 20.4499L6.5088 15.3109C6.567 14.9716 6.54178 14.6233 6.43534 14.2959C6.32889 ' +
    '13.9686 6.14441 13.672 5.8978 13.4319L2.1618 9.79489C2.09039 9.72593 2.03979 9.63829 2.01576 ' +
    '9.54197C1.99173 9.44565 1.99524 9.34451 2.02588 9.25008C2.05652 9.15566 2.11307 9.07174 2.18908 ' +
    '9.00788C2.26509 8.94402 2.3575 8.90279 2.4558 8.88889L7.6208 8.13389C7.96106 8.08439 8.28419 ' +
    '7.95295 8.56238 7.75088C8.84058 7.54881 9.0655 7.28216 9.2178 6.97389L11.5268 2.29489Z" ' +
    'fill="url(#gmdmStarFill)" stroke="url(#gmdmStarStroke)" stroke-linecap="round" stroke-linejoin="round"/>' +
    '<defs>' +
    '<linearGradient id="gmdmStarFill" x1="-0.5" y1="9" x2="15.5" y2="-1.5" gradientUnits="userSpaceOnUse">' +
    '<stop stop-color="#7A69F9"/><stop offset="0.575" stop-color="#F26378"/><stop offset="1" stop-color="#F5833F"/>' +
    '</linearGradient>' +
    '<linearGradient id="gmdmStarStroke" x1="-0.5" y1="9" x2="15.5" y2="-1.5" gradientUnits="userSpaceOnUse">' +
    '<stop stop-color="#7A69F9"/><stop offset="0.575" stop-color="#F26378"/><stop offset="1" stop-color="#F5833F"/>' +
    '</linearGradient>' +
    '</defs></svg>';

  function switchRow(key, label, hint, sub) {
    return (
      '<div class="row' + (sub ? ' is-sub' : '') + '" data-row="' + key + '">' +
      '<span class="row__text">' +
      '<span class="row__label" id="gmdm-lbl-' + key + '">' + label + '</span>' +
      '<span class="row__hint">' + hint + '</span>' +
      '</span>' +
      '<button type="button" class="track" role="switch" aria-checked="false" ' +
      'data-key="' + key + '" aria-labelledby="gmdm-lbl-' + key + '">' +
      '<span class="thumb"></span></button></div>'
    );
  }

  const HTML =
    '<div class="shell" part="shell">' +
    '<button type="button" class="pill" aria-expanded="false" aria-controls="gmdm-body">' +
    SVG_MOON +
    '<span class="pill__text">' +
    '<span class="pill__title">Dark Mode</span>' +
    '<span class="pill__state" data-state>On</span>' +
    '</span>' + SVG_CHEV +
    '</button>' +
    '<div class="body" id="gmdm-body">' +
    '<div class="body__inner"><div class="body__pad">' +
    '<div class="rule"></div>' +
    switchRow('enabled', 'Dark mode', 'Everything below', false) +
    switchRow('darkMap', 'Map surface', "Google's own dark cartography", true) +
    switchRow('darkChrome', 'Panels and controls', 'Search, menus, buttons', true) +
    '<p class="warn" data-warn></p>' +
    '<button type="button" class="kofi">' + SVG_CUP +
    '<span class="kofi__label"><span>Support me on Ko-fi</span>' +
    '<span class="kofi__handle">' + KOFI_HANDLE + '</span></span></button>' +
    '<button type="button" class="gh">' +
    '<span class="gh__corner"><span class="gh__blob"></span></span>' +
    '<span class="gh__sweep"><span class="gh__bar"></span></span>' +
    '<span class="gh__inner">' +
    '<span class="gh__star">' + SVG_STAR + '<span class="gh__glow"></span></span>' +
    '<span class="gh__label">Star Project on Github</span>' +
    '</span></button>' +
    '<div class="goat goat--panel goat--gated">' +
    '<div class="goat__copy">' +
    '<span class="goat__line">GOAT Cam &mdash; your iPhone, <em>NOW</em> your PC&rsquo;s webcam.</span>' +
    '<span class="goat__line goat__line--ask">Free Windows&nbsp;11 app &middot; USB or Wi&#8209;Fi &middot; Scan for the iPhone app.</span>' +
    '</div>' +
    '<a class="goat-lockup" href="' + GOAT_URL + '" target="_blank" rel="noopener noreferrer" aria-label="GOAT Cam &mdash; open goatcam.dagoat.io" data-goat-mark>' +
    '<span class="gc-photo" aria-hidden="true"><span class="gc-photo__frame">' +
    '<img class="gc-photo__img" src="data:image/webp;base64,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" alt="" width="264" height="222" draggable="false">' +
    '<svg class="gc-steam" viewBox="0 0 60 120" focusable="false"><path pathLength="100" d="M22 118C14 100 30 88 22 70S14 40 24 22"/><path pathLength="100" d="M32 118C40 98 24 84 33 64S42 36 32 14"/><path pathLength="100" d="M42 118C36 102 48 90 41 74S36 50 44 34"/></svg></span><span class="gc-vf"></span><span class="gc-osd"><span class="gc-osd__dot"></span><span class="gc-osd__t"><span>1080p</span><span class="gc-osd__sep"> &middot; </span><span>60 fps</span></span></span></span>' +
    '<span class="goat-lockup__meteors" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></span>' +
    '<span class="goat-lockup__mark" aria-hidden="true"><svg class="goat-lockup__svg" viewBox="46 -16 220 250" xmlns="http://www.w3.org/2000/svg" focusable="false"><g class="gl-head"><path d="M62 210 C74 148 120 98 190 80 C152 106 106 150 82 216 Z"/><path d="M186 84 C214 62 226 32 210 8 C216 36 200 62 174 80 Z"/><path d="M170 82 C190 60 194 34 180 16 C186 40 172 62 156 78 Z"/><path d="M188 82 C206 90 218 104 222 122 C212 106 200 94 182 90 Z"/><path d="M206 122 C215 134 217 149 209 160 C212 147 208 133 200 127 Z"/><circle cx="197" cy="99" r="3.6"/></g><g class="gl-seal"><rect class="gl-seal-glow" x="214" y="182" width="36" height="36" rx="4"/><rect class="gl-seal-face" x="214" y="182" width="36" height="36" rx="4"/><svg class="gl-glyph" x="214" y="182" width="36" height="36" viewBox="0 0 100 100"><path class="gl-thumb" d="M30 50 C26 50 24 52 24 56 L24 87 C24 91 26 93 30 93 L73 93 C79 93 84 90 85 84 L89 55 C90 49 86 44 80 44 L63 44 C65 38 67 25 65 18 C63 12 55 12 53 18 C51 24 53 33 51 42 C50 47 47 50 42 50 Z" transform="translate(-5 -3)"/><path class="gl-char" d="M33.5 18.12Q39.14 21.51 41.54 23.62Q43.93 25.74 43.65 27.85Q43.37 29.97 42.24 30.96Q41.11 31.94 40.55 31.94Q39.42 31.94 38.57 29.12Q37.45 25.17 32.93 18.97ZM20.52 33.07H52.68Q58.89 23.76 60.86 16.99L66.79 20.66Q63.96 22.07 61.14 25.74Q58.04 29.41 54.37 33.07H68.2L72.43 28.84L77.79 34.77H51.55V47.46H63.96L68.2 43.79L72.99 49.15H51.55V62.13H71.58L76.1 57.9L81.46 63.82H51.55V73.7Q51.55 76.8 51.83 81.32L47.04 83.01Q47.32 78.78 47.32 63.82H27.85Q24.19 63.82 21.08 64.67L18.54 62.13H47.32V49.15H35.47Q31.8 49.15 28.7 50L26.16 47.46H47.32V34.77H29.83Q26.16 34.77 23.06 35.61Z"/><g class="gl-burst" transform="translate(53 0)" fill="none"><circle class="gl-ring" cx="0" cy="0" r="12"/><line class="gl-ray gl-ray--1" transform="rotate(-168)" x1="10" y1="0" x2="40" y2="0"/><line class="gl-ray gl-ray--2" transform="rotate(-138)" x1="10" y1="0" x2="40" y2="0"/><line class="gl-ray gl-ray--3" transform="rotate(-108)" x1="10" y1="0" x2="40" y2="0"/><line class="gl-ray gl-ray--4" transform="rotate(-76)" x1="10" y1="0" x2="40" y2="0"/><line class="gl-ray gl-ray--5" transform="rotate(-44)" x1="10" y1="0" x2="40" y2="0"/><line class="gl-ray gl-ray--6" transform="rotate(-14)" x1="10" y1="0" x2="40" y2="0"/><circle class="gl-ember gl-ember--a" cx="-7" cy="-2" r="2.2"/><circle class="gl-ember gl-ember--b" cx="8" cy="-5" r="1.9"/><circle class="gl-ember gl-ember--c" cx="0" cy="-9" r="1.6"/></g></svg></g></svg></span>' +
    '<span class="goat-lockup__word"><span class="goat-lockup__name">GOAT Cam</span><span class="goat-lockup__tag"><span class="gc-tag__a">iPhone app</span><span class="gc-tag__sep"> &middot; </span><span class="gc-tag__b">On the App Store</span></span></span>' +
    '<span class="gc-qr"><span class="gc-qr__tile"><svg viewBox="0 0 37 37" shape-rendering="crispEdges" role="img" aria-label="QR code that opens GOAT Cam on the App Store" xmlns="http://www.w3.org/2000/svg" focusable="false"><rect width="37" height="37" fill="#fbf5ea"/>' +
    '<path fill="#1c130c" d="M4 4h1v1h-1zM5 4h1v1h-1zM6 4h1v1h-1zM7 4h1v1h-1zM8 4h1v1h-1zM9 4h1v1h-1zM10 4h1v1h-1zM12 4h1v1h-1zM13 4h1v1h-1zM17 4h1v1h-1zM20 4h1v1h-1zM22 4h1v1h-1zM24 4h1v1h-1zM26 4h1v1h-1zM27 4h1v1h-1zM28 4h1v1h-1zM29 4h1v1h-1zM30 4h1v1h-1zM31 4h1v1h-1zM32 4h1v1h-1zM4 5h1v1h-1zM10 5h1v1h-1zM12 5h1v1h-1zM14 5h1v1h-1zM16 5h1v1h-1zM18 5h1v1h-1zM21 5h1v1h-1zM23 5h1v1h-1zM26 5h1v1h-1zM32 5h1v1h-1zM4 6h1v1h-1zM6 6h1v1h-1zM7 6h1v1h-1zM8 6h1v1h-1zM10 6h1v1h-1zM12 6h1v1h-1zM17 6h1v1h-1zM18 6h1v1h-1zM19 6h1v1h-1zM20 6h1v1h-1zM23 6h1v1h-1zM24 6h1v1h-1zM26 6h1v1h-1zM28 6h1v1h-1zM29 6h1v1h-1zM30 6h1v1h-1zM32 6h1v1h-1zM4 7h1v1h-1zM6 7h1v1h-1zM7 7h1v1h-1zM8 7h1v1h-1zM10 7h1v1h-1zM14 7h1v1h-1zM16 7h1v1h-1zM17 7h1v1h-1zM18 7h1v1h-1zM19 7h1v1h-1zM21 7h1v1h-1zM23 7h1v1h-1zM24 7h1v1h-1zM26 7h1v1h-1zM28 7h1v1h-1zM29 7h1v1h-1zM30 7h1v1h-1zM32 7h1v1h-1zM4 8h1v1h-1zM6 8h1v1h-1zM7 8h1v1h-1zM8 8h1v1h-1zM10 8h1v1h-1zM12 8h1v1h-1zM15 8h1v1h-1zM21 8h1v1h-1zM22 8h1v1h-1zM23 8h1v1h-1zM26 8h1v1h-1zM28 8h1v1h-1zM29 8h1v1h-1zM30 8h1v1h-1zM32 8h1v1h-1zM4 9h1v1h-1zM10 9h1v1h-1zM13 9h1v1h-1zM14 9h1v1h-1zM15 9h1v1h-1zM20 9h1v1h-1zM21 9h1v1h-1zM22 9h1v1h-1zM24 9h1v1h-1zM26 9h1v1h-1zM32 9h1v1h-1zM4 10h1v1h-1zM5 10h1v1h-1zM6 10h1v1h-1zM7 10h1v1h-1zM8 10h1v1h-1zM9 10h1v1h-1zM10 10h1v1h-1zM12 10h1v1h-1zM14 10h1v1h-1zM16 10h1v1h-1zM18 10h1v1h-1zM20 10h1v1h-1zM22 10h1v1h-1zM24 10h1v1h-1zM26 10h1v1h-1zM27 10h1v1h-1zM28 10h1v1h-1zM29 10h1v1h-1zM30 10h1v1h-1zM31 10h1v1h-1zM32 10h1v1h-1zM13 11h1v1h-1zM16 11h1v1h-1zM17 11h1v1h-1zM19 11h1v1h-1zM20 11h1v1h-1zM4 12h1v1h-1zM7 12h1v1h-1zM8 12h1v1h-1zM9 12h1v1h-1zM10 12h1v1h-1zM11 12h1v1h-1zM12 12h1v1h-1zM13 12h1v1h-1zM14 12h1v1h-1zM15 12h1v1h-1zM16 12h1v1h-1zM19 12h1v1h-1zM21 12h1v1h-1zM25 12h1v1h-1zM28 12h1v1h-1zM30 12h1v1h-1zM31 12h1v1h-1zM32 12h1v1h-1zM5 13h1v1h-1zM7 13h1v1h-1zM8 13h1v1h-1zM9 13h1v1h-1zM12 13h1v1h-1zM15 13h1v1h-1zM16 13h1v1h-1zM19 13h1v1h-1zM20 13h1v1h-1zM23 13h1v1h-1zM28 13h1v1h-1zM30 13h1v1h-1zM31 13h1v1h-1zM5 14h1v1h-1zM6 14h1v1h-1zM7 14h1v1h-1zM9 14h1v1h-1zM10 14h1v1h-1zM15 14h1v1h-1zM17 14h1v1h-1zM19 14h1v1h-1zM21 14h1v1h-1zM22 14h1v1h-1zM26 14h1v1h-1zM30 14h1v1h-1zM4 15h1v1h-1zM5 15h1v1h-1zM6 15h1v1h-1zM7 15h1v1h-1zM8 15h1v1h-1zM9 15h1v1h-1zM11 15h1v1h-1zM13 15h1v1h-1zM14 15h1v1h-1zM19 15h1v1h-1zM20 15h1v1h-1zM21 15h1v1h-1zM22 15h1v1h-1zM23 15h1v1h-1zM27 15h1v1h-1zM28 15h1v1h-1zM29 15h1v1h-1zM32 15h1v1h-1zM4 16h1v1h-1zM6 16h1v1h-1zM7 16h1v1h-1zM10 16h1v1h-1zM11 16h1v1h-1zM13 16h1v1h-1zM15 16h1v1h-1zM16 16h1v1h-1zM17 16h1v1h-1zM18 16h1v1h-1zM19 16h1v1h-1zM23 16h1v1h-1zM24 16h1v1h-1zM26 16h1v1h-1zM32 16h1v1h-1zM8 17h1v1h-1zM11 17h1v1h-1zM13 17h1v1h-1zM14 17h1v1h-1zM18 17h1v1h-1zM19 17h1v1h-1zM26 17h1v1h-1zM27 17h1v1h-1zM28 17h1v1h-1zM29 17h1v1h-1zM30 17h1v1h-1zM31 17h1v1h-1zM32 17h1v1h-1zM4 18h1v1h-1zM5 18h1v1h-1zM6 18h1v1h-1zM7 18h1v1h-1zM8 18h1v1h-1zM9 18h1v1h-1zM10 18h1v1h-1zM13 18h1v1h-1zM14 18h1v1h-1zM16 18h1v1h-1zM18 18h1v1h-1zM19 18h1v1h-1zM20 18h1v1h-1zM22 18h1v1h-1zM23 18h1v1h-1zM25 18h1v1h-1zM26 18h1v1h-1zM28 18h1v1h-1zM30 18h1v1h-1zM32 18h1v1h-1zM4 19h1v1h-1zM7 19h1v1h-1zM12 19h1v1h-1zM13 19h1v1h-1zM16 19h1v1h-1zM17 19h1v1h-1zM18 19h1v1h-1zM19 19h1v1h-1zM22 19h1v1h-1zM23 19h1v1h-1zM25 19h1v1h-1zM26 19h1v1h-1zM28 19h1v1h-1zM30 19h1v1h-1zM32 19h1v1h-1zM7 20h1v1h-1zM8 20h1v1h-1zM10 20h1v1h-1zM11 20h1v1h-1zM12 20h1v1h-1zM13 20h1v1h-1zM14 20h1v1h-1zM16 20h1v1h-1zM19 20h1v1h-1zM20 20h1v1h-1zM22 20h1v1h-1zM23 20h1v1h-1zM24 20h1v1h-1zM29 20h1v1h-1zM4 21h1v1h-1zM5 21h1v1h-1zM7 21h1v1h-1zM8 21h1v1h-1zM9 21h1v1h-1zM11 21h1v1h-1zM13 21h1v1h-1zM16 21h1v1h-1zM19 21h1v1h-1zM20 21h1v1h-1zM22 21h1v1h-1zM23 21h1v1h-1zM25 21h1v1h-1zM28 21h1v1h-1zM30 21h1v1h-1zM31 21h1v1h-1zM4 22h1v1h-1zM5 22h1v1h-1zM6 22h1v1h-1zM10 22h1v1h-1zM11 22h1v1h-1zM12 22h1v1h-1zM13 22h1v1h-1zM14 22h1v1h-1zM15 22h1v1h-1zM16 22h1v1h-1zM17 22h1v1h-1zM18 22h1v1h-1zM19 22h1v1h-1zM23 22h1v1h-1zM25 22h1v1h-1zM26 22h1v1h-1zM27 22h1v1h-1zM28 22h1v1h-1zM29 22h1v1h-1zM32 22h1v1h-1zM4 23h1v1h-1zM5 23h1v1h-1zM6 23h1v1h-1zM7 23h1v1h-1zM9 23h1v1h-1zM14 23h1v1h-1zM15 23h1v1h-1zM16 23h1v1h-1zM17 23h1v1h-1zM23 23h1v1h-1zM28 23h1v1h-1zM29 23h1v1h-1zM30 23h1v1h-1zM4 24h1v1h-1zM5 24h1v1h-1zM6 24h1v1h-1zM9 24h1v1h-1zM10 24h1v1h-1zM12 24h1v1h-1zM13 24h1v1h-1zM15 24h1v1h-1zM17 24h1v1h-1zM19 24h1v1h-1zM21 24h1v1h-1zM23 24h1v1h-1zM24 24h1v1h-1zM25 24h1v1h-1zM26 24h1v1h-1zM27 24h1v1h-1zM28 24h1v1h-1zM29 24h1v1h-1zM30 24h1v1h-1zM31 24h1v1h-1zM12 25h1v1h-1zM17 25h1v1h-1zM19 25h1v1h-1zM20 25h1v1h-1zM21 25h1v1h-1zM22 25h1v1h-1zM24 25h1v1h-1zM28 25h1v1h-1zM29 25h1v1h-1zM4 26h1v1h-1zM5 26h1v1h-1zM6 26h1v1h-1zM7 26h1v1h-1zM8 26h1v1h-1zM9 26h1v1h-1zM10 26h1v1h-1zM12 26h1v1h-1zM14 26h1v1h-1zM16 26h1v1h-1zM17 26h1v1h-1zM19 26h1v1h-1zM21 26h1v1h-1zM22 26h1v1h-1zM23 26h1v1h-1zM24 26h1v1h-1zM26 26h1v1h-1zM28 26h1v1h-1zM29 26h1v1h-1zM4 27h1v1h-1zM10 27h1v1h-1zM12 27h1v1h-1zM14 27h1v1h-1zM16 27h1v1h-1zM17 27h1v1h-1zM20 27h1v1h-1zM21 27h1v1h-1zM23 27h1v1h-1zM24 27h1v1h-1zM28 27h1v1h-1zM31 27h1v1h-1zM4 28h1v1h-1zM6 28h1v1h-1zM7 28h1v1h-1zM8 28h1v1h-1zM10 28h1v1h-1zM12 28h1v1h-1zM13 28h1v1h-1zM14 28h1v1h-1zM17 28h1v1h-1zM23 28h1v1h-1zM24 28h1v1h-1zM25 28h1v1h-1zM26 28h1v1h-1zM27 28h1v1h-1zM28 28h1v1h-1zM29 28h1v1h-1zM32 28h1v1h-1zM4 29h1v1h-1zM6 29h1v1h-1zM7 29h1v1h-1zM8 29h1v1h-1zM10 29h1v1h-1zM12 29h1v1h-1zM13 29h1v1h-1zM16 29h1v1h-1zM18 29h1v1h-1zM19 29h1v1h-1zM22 29h1v1h-1zM23 29h1v1h-1zM24 29h1v1h-1zM25 29h1v1h-1zM27 29h1v1h-1zM32 29h1v1h-1zM4 30h1v1h-1zM6 30h1v1h-1zM7 30h1v1h-1zM8 30h1v1h-1zM10 30h1v1h-1zM14 30h1v1h-1zM16 30h1v1h-1zM18 30h1v1h-1zM19 30h1v1h-1zM20 30h1v1h-1zM24 30h1v1h-1zM27 30h1v1h-1zM28 30h1v1h-1zM30 30h1v1h-1zM31 30h1v1h-1zM32 30h1v1h-1zM4 31h1v1h-1zM10 31h1v1h-1zM13 31h1v1h-1zM14 31h1v1h-1zM17 31h1v1h-1zM18 31h1v1h-1zM19 31h1v1h-1zM22 31h1v1h-1zM26 31h1v1h-1zM27 31h1v1h-1zM28 31h1v1h-1zM29 31h1v1h-1zM30 31h1v1h-1zM32 31h1v1h-1zM4 32h1v1h-1zM5 32h1v1h-1zM6 32h1v1h-1zM7 32h1v1h-1zM8 32h1v1h-1zM9 32h1v1h-1zM10 32h1v1h-1zM12 32h1v1h-1zM13 32h1v1h-1zM15 32h1v1h-1zM18 32h1v1h-1zM19 32h1v1h-1zM20 32h1v1h-1zM22 32h1v1h-1zM23 32h1v1h-1zM24 32h1v1h-1zM25 32h1v1h-1zM27 32h1v1h-1zM28 32h1v1h-1z"/>' +
    '</svg></span><span class="gc-qr__cap">iPhone app<span>On the App Store</span></span></span>' +
    '</a>' +
    '</div>' +
    '</div></div></div></div>';

  /* ------------------------------------------------------------------ state */

  let settings = Object.assign({}, DEFAULT_SETTINGS);
  let host = null;
  let shadow = null;
  let shell = null;
  let pill = null;
  let openTimer = 0;
  let closeTimer = 0;
  let pinned = false; // click-to-pin, so touch and keyboard users get a latch
  let reloading = false; // a map-affecting setting changed; the page is going back

  /* --------------------------------------------------------------- placement
   * Google's top-left overlay stack is the search field plus, conditionally, a
   * weather/traffic card. Both are unnamed divs with rotating class names, so
   * we find them by geometry: visible, near the top-left, card-shaped, and not
   * the map surface itself. We then sit below the lowest one.
   *
   * Deliberately conservative -- when the probe finds nothing recognisable it
   * falls back to a fixed offset that clears the search field, rather than
   * risking a position on top of Google's own controls. */

  function isPainted(cs) {
    // What separates Google's real overlay surfaces from the many transparent
    // positioning wrappers around them.
    return (
      (cs.backgroundColor && !/^rgba?\((?:0, 0, 0, 0|0,0,0,0)\)$/.test(cs.backgroundColor)) ||
      (cs.boxShadow && cs.boxShadow !== 'none')
    );
  }

  function visible(cs) {
    return cs.visibility !== 'hidden' && cs.display !== 'none' && cs.opacity !== '0';
  }

  function placement() {
    const vh = window.innerHeight;
    const vw = window.innerWidth;
    const els = doc.body ? doc.body.querySelectorAll('div, form, header') : [];

    /* Pass 1 -- has Google taken over the left column? Three different things
       do that and all of them must push us onto the map:

         search suggestions   l=88  t=60  w=376  h=246
         results list         l=72  t=0   w=408  h=900
         place details        same column as the results list

       and one thing must NOT, because the requirement is to sit under it:

         weather/traffic card l=88  t=72  w=376  h=100

       Height is what separates them, so that is the test. The earlier
       `height >= 50% of viewport` only caught the results list, which is why
       the suggestions dropdown was covered. */
    let panelRight = -1;
    for (let i = 0; i < els.length; i++) {
      const el = els[i];
      if (host && (el === host || el.contains(host))) continue;
      const r = el.getBoundingClientRect();
      if (r.left > 140 || r.right < 200 || r.right > vw * 0.6) continue;
      if (r.top > 200 || r.height < LEFT_COLUMN_MIN_HEIGHT) continue;
      if (r.width < 260 || r.width > 560) continue;
      const cs = getComputedStyle(el);
      if (!visible(cs) || !isPainted(cs)) continue;
      if (r.right > panelRight) panelRight = r.right;
    }

    const left =
      panelRight > 0
        ? Math.round(panelRight + STACK_GAP)
        : null; // null means "align to Google's own top-left column"

    /* Pass 2 -- the lowest painted thing that actually sits above us. Only
       elements whose horizontal span overlaps the column we are about to
       occupy count, so the weather card stops mattering the moment we move
       onto the map.

       `button` and `a` are in the query, and the minimum width is much smaller
       than pass 1's, because over the map the obstruction is Google's category
       chip row ("Restaurants", "Hotels", "All filters"). Those are individual
       buttons ~100px wide inside a transparent container: a card-shaped probe
       looking only at wide painted divs sails straight past them and lands the
       panel on top of the filters, which is exactly what this must not do. */
    const probeLeft = left === null ? 0 : left;
    const probeRight = probeLeft + OPEN_WIDTH;
    const obstacles = doc.body
      ? doc.body.querySelectorAll('div, form, header, button, a')
      : [];
    let bottom = 0;
    let colLeft = -1;

    for (let i = 0; i < obstacles.length; i++) {
      const el = obstacles[i];
      if (host && (el === host || el.contains(host))) continue;

      const r = el.getBoundingClientRect();
      if (r.top < 0 || r.top > PROBE_MAX_TOP) continue;
      if (r.height < PROBE_MIN_HEIGHT || r.height > 320) continue;
      if (r.height > vh * 0.6) continue; // rails and the map canvas are not cards
      if (r.width < OBSTACLE_MIN_WIDTH || r.width > vw * 0.9) continue;
      if (r.right <= probeLeft || r.left >= probeRight) continue; // different column

      if (left === null && (r.left < 0 || r.left > PROBE_MAX_LEFT)) continue;

      const cs = getComputedStyle(el);
      if (!visible(cs) || !isPainted(cs)) continue;

      if (r.bottom > bottom) bottom = r.bottom;
      // Column alignment still comes from real cards, not from a stray chip.
      if (r.width >= PROBE_MIN_WIDTH && (colLeft < 0 || r.left < colLeft)) colLeft = r.left;
    }

    const top = bottom > 0 ? bottom + STACK_GAP : left === null ? FALLBACK_TOP : MIN_TOP;
    const finalLeft = left === null ? (colLeft < 0 ? FALLBACK_LEFT : colLeft) : left;

    return {
      top: Math.max(MIN_TOP, Math.min(MAX_TOP, Math.round(top))),
      // Never let the panel run off the right edge on a narrow window.
      left: Math.max(8, Math.min(vw - OPEN_WIDTH - 8, Math.round(finalLeft))),
      onMap: panelRight > 0,
    };
  }

  let placeQueued = false;
  function place() {
    if (placeQueued || !host) return;
    placeQueued = true;
    requestAnimationFrame(function () {
      placeQueued = false;
      if (!host) return;
      const p = placement();
      host.style.top = p.top + 'px';
      host.style.left = p.left + 'px';
      // Mirrored onto the DOM so the harness can assert which mode we chose
      // rather than inferring it from coordinates.
      host.dataset.gmdmPlacement = p.onMap ? 'on-map' : 'top-left';
    });
  }

  /* ------------------------------------------------------------------ open */

  function setOpen(open) {
    if (!shell) return;
    shell.classList.toggle('is-open', open);
    if (pill) pill.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  function openSoon() {
    clearTimeout(closeTimer);
    clearTimeout(openTimer);
    // A short intent delay: sweeping the pointer across the corner on the way
    // to Google's own controls should not fling the panel open.
    openTimer = setTimeout(function () { setOpen(true); }, 90);
  }

  function closeSoon() {
    if (pinned) return;
    clearTimeout(openTimer);
    clearTimeout(closeTimer);
    closeTimer = setTimeout(function () { setOpen(false); }, 220);
  }

  /* --------------------------------------------------------------- settings */

  function send(message) {
    return new Promise(function (resolve) {
      let settled = false;
      const done = function (v) { if (!settled) { settled = true; resolve(v); } };
      try {
        const r = api.runtime.sendMessage(message, function (resp) {
          void api.runtime.lastError;
          done(resp);
        });
        if (r && typeof r.then === 'function') r.then(done, function () { done(null); });
      } catch (_) { done(null); }
      setTimeout(function () { done(null); }, 2000);
    });
  }

  function render() {
    if (!shell) return;
    const on = Boolean(settings.enabled);
    shell.classList.toggle('is-on', on);

    const state = shadow.querySelector('[data-state]');
    if (state) state.textContent = on ? 'On' : 'Off';

    const tracks = shadow.querySelectorAll('.track');
    for (let i = 0; i < tracks.length; i++) {
      const key = tracks[i].dataset.key;
      const value = Boolean(settings[key]);
      tracks[i].classList.toggle('on', value);
      tracks[i].setAttribute('aria-checked', value ? 'true' : 'false');
      // The two sub-switches are meaningless while the master is off. Disable
      // rather than hide, so the panel does not change height on toggle.
      const isSub = key !== 'enabled';
      tracks[i].disabled = isSub && !on;
      const row = tracks[i].closest('.row');
      if (row) row.classList.toggle('is-muted', isSub && !on);
    }
  }

  async function loadSettings() {
    const got = await send({ type: 'getSettings' });
    if (got && typeof got === 'object') {
      for (const k of Object.keys(DEFAULT_SETTINGS)) {
        if (typeof got[k] === 'boolean') settings[k] = got[k];
      }
    }
    render();
  }

  async function patch(key, value) {
    const previous = settings[key];
    settings[key] = value;
    render(); // optimistic: the switch must feel instant
    const res = await send({ type: 'setSettings', patch: { [key]: value } });
    if (!res || res.ok !== true) {
      settings[key] = previous; // the background refused; put it back
      render();
      return;
    }
    if (res.settings) Object.assign(settings, res.settings);
    render();
  }

  async function loadHealth() {
    const h = await send({ type: 'getHealth' });
    if (!h || !shell) return;
    const bad = h.verdict === 'token-dead' || h.verdict === 'rules-broken';
    shell.classList.toggle('has-warning', bad);
    if (bad) {
      const warn = shadow.querySelector('[data-warn]');
      if (warn) {
        warn.textContent =
          h.verdict === 'token-dead'
            ? 'Google is no longer serving the dark map style. The rules have been switched off so Maps still works; an updated version of this extension is needed.'
            : 'Dark mode has stopped working and the rules have been switched off. An updated version of this extension is needed.';
      }
    }
  }

  /* ------------------------------------------------------------------ build */

  function build() {
    if (!doc.body || doc.getElementById(HOST_ID)) return;

    host = doc.createElement('div');
    host.id = HOST_ID;
    host.style.cssText = 'position:fixed;top:' + FALLBACK_TOP + 'px;left:' + FALLBACK_LEFT +
      'px;z-index:2147483000;';
    // Not a Maps control: keep it out of the page's tab flow ordering games and
    // out of any screen-reader landmark Google declares.
    host.setAttribute('data-gmdm-widget', '');

    shadow = host.attachShadow({ mode: 'open' });
    const style = doc.createElement('style');
    style.textContent = CSS_ALL;
    // Parsed, not assigned to innerHTML. HTML is a module-level constant built
    // entirely from string literals -- nothing from the page, storage or the
    // network reaches it -- so the two are equivalent here. But AMO's linter
    // cannot prove that and flags every innerHTML write as "unsafe assignment",
    // which puts a security warning in front of a human reviewer on every
    // submission. DOMParser produces an inert document: no scripts run, no
    // subresources load, and the result is imported rather than adopted.
    const parsed = new DOMParser().parseFromString(HTML, 'text/html');
    shadow.appendChild(style);
    shadow.appendChild(doc.importNode(parsed.body.firstElementChild, true));

    doc.body.appendChild(host);

    shell = shadow.querySelector('.shell');
    pill = shadow.querySelector('.pill');

    shell.addEventListener('mouseenter', openSoon);
    shell.addEventListener('mouseleave', closeSoon);
    shell.addEventListener('focusin', function () { clearTimeout(closeTimer); setOpen(true); });
    shell.addEventListener('focusout', function (e) {
      if (!shell.contains(e.relatedTarget)) { pinned = false; closeSoon(); }
    });

    // Click latches the panel open, so touch and keyboard users are not
    // required to hold a hover they cannot express.
    pill.addEventListener('click', function () {
      if (pinned && shell.classList.contains('is-open')) {
        pinned = false;
        setOpen(false);
      } else {
        pinned = true;
        clearTimeout(closeTimer);
        setOpen(true);
      }
    });

    shadow.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && shell.classList.contains('is-open')) {
        pinned = false;
        setOpen(false);
        pill.focus();
      }
    });

    const tracks = shadow.querySelectorAll('.track');
    for (let i = 0; i < tracks.length; i++) {
      tracks[i].addEventListener('click', function (e) {
        const key = e.currentTarget.dataset.key;
        patch(key, !settings[key]);
      });
    }

    // A content script cannot use tabs.create; the background has no handler
    // for this and adding one would be a new message for a link. window.open
    // with noopener is the correct primitive here.
    shadow.querySelector('.kofi').addEventListener('click', function () {
      window.open(KOFI_URL, '_blank', 'noopener,noreferrer');
    });
    shadow.querySelector('.gh').addEventListener('click', function () {
      window.open(GITHUB_URL, '_blank', 'noopener,noreferrer');
    });
    const lockup = shadow.querySelector('.goat-lockup');
    if (lockup) {
      lockup.addEventListener('focusin', function () { lockup.classList.add('is-active'); });
      lockup.addEventListener('focusout', function () { lockup.classList.remove('is-active'); });
      if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) {
        lockup.addEventListener('click', function (event) {
          if (lockup.classList.contains('is-active')) return;
          event.preventDefault();
          lockup.classList.add('is-active');
          clearTimeout(lockup._glTimer);
          lockup._glTimer = setTimeout(function () { lockup.classList.remove('is-active'); }, 2400);
        });
      }
    }
    render();
    place();
    loadSettings();
    loadHealth();
  }

  /* -------------------------------------------------------------- lifecycle */

  function watch() {
    window.addEventListener('resize', place, { passive: true });

    /* THE BUG THIS FIXES, recorded so it is not reintroduced.
     *
     * This observer used `subtree: false`, which only reports direct children
     * of <body>. Maps builds the suggestions dropdown, the results list and the
     * place card deep inside the tree, so the observer never fired for any of
     * them and the panel simply never re-placed -- measured sitting at
     * {l:88, t:184} with mode "top-left" while the results column was plainly
     * open at {l:72, w:408, h:900}. The placement maths was right the whole
     * time; nothing was ever asking it to run.
     *
     * A subtree observer on Google Maps fires constantly, so the expensive scan
     * is both debounced and rate-limited. Our own writes cannot feed back: the
     * widget is inside a shadow root (invisible to this observer) and its
     * position is set via style/dataset attributes, which childList ignores.
     */
    let debounce = 0;
    let lastScan = 0;
    const RESCAN_MIN_MS = 220;

    const schedule = function () {
      clearTimeout(debounce);
      const since = performance.now() - lastScan;
      const wait = since >= RESCAN_MIN_MS ? 120 : RESCAN_MIN_MS - since + 40;
      debounce = setTimeout(function () {
        lastScan = performance.now();
        if (!doc.getElementById(HOST_ID)) build(); // Maps wiped the body
        place();
      }, wait);
    };

    const mo = new MutationObserver(schedule);
    if (doc.body) mo.observe(doc.body, { childList: true, subtree: true });

    /* Focus is the earliest signal that the search field is about to open its
       dropdown; the DOM mutation follows a frame or two later. Listening for
       both means we start moving with the panel rather than behind it. */
    doc.addEventListener('focusin', schedule, true);
    doc.addEventListener('click', schedule, true);
    window.addEventListener('popstate', schedule);

    if (api && api.storage && api.storage.onChanged) {
      api.storage.onChanged.addListener(function (changes, area) {
        if (area !== 'local' || !changes.settings) return;
        const next = changes.settings.newValue;
        if (!next) return;

        /* Which settings need the page back?
         *
         * `darkChrome` is genuinely live -- theme.js re-derives the palette from
         * :root and repaints on the spot, no reload.
         *
         * `darkMap` and `enabled` are not, and cannot be. The map surface is
         * painted by Maps' WebGL renderer from the CompactLegend palette it
         * fetches ONCE per session; our rule decides which variant that fetch
         * returns. Flipping the rule afterwards changes nothing already in the
         * renderer, and Maps exposes no way to make it re-fetch. So the switch
         * looked broken: correct on the next load, inert until then.
         *
         * Reloading is therefore the mechanism, not a workaround. It is cheap
         * here because Maps keeps its whole view state -- coordinates, zoom,
         * place, search -- in the URL, so the page comes back where it was.
         *
         * Ordering is already safe: the background applies the ruleset BEFORE
         * it writes settings, so by the time this listener runs the engine is
         * in its new state and the reload re-fetches the right palette. */
        /* Compare the event's own oldValue against its newValue, NOT against
           our `settings`. patch() updates `settings` optimistically the instant
           the switch is clicked so the control feels instant, which means by
           the time this listener runs the local copy already holds the new
           value and a local comparison always says "nothing changed" -- the
           reload silently never fired. The event carries the truth. */
        const prev = changes.settings.oldValue || DEFAULT_SETTINGS;
        const mapAffecting =
          (typeof next.darkMap === 'boolean' && next.darkMap !== prev.darkMap) ||
          (typeof next.enabled === 'boolean' && next.enabled !== prev.enabled);

        for (const k of Object.keys(DEFAULT_SETTINGS)) {
          if (typeof next[k] === 'boolean') settings[k] = next[k];
        }
        render();

        if (!mapAffecting || reloading) return;
        reloading = true;
        // Say so, rather than appearing to refresh itself for no reason.
        const state = shadow && shadow.querySelector('[data-state]');
        if (state) state.textContent = 'Applying…';
        // Long enough for that word to paint; short enough to feel immediate.
        setTimeout(function () { location.reload(); }, 180);
      });
    }
  }

  function boot() {
    build();
    watch();
  }

  if (doc.body) boot();
  else doc.addEventListener('DOMContentLoaded', boot, { once: true });
})();
