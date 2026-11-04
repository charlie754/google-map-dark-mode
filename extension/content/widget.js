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
  const GOAT_LOCKUP_CSS = "/* GOAT Cam banner v2. A copy of the master stylesheet, goatcam-banner.css in the\n   GOAT Cam repository's brand/goatcam-banner folder (2026-10-26), with its\n   comments removed; no rule is changed. Change the master, then copy it again.\n   Photo: \"White cup and MacBook\" by Alex Knight, CC0 1.0. */\n.goat {\n  --gc-950: #140d08; --gc-gold: #f0c07a; --gc-cream: #f8eedf; --gc-cream-soft: #d8c2a5;\n  --gc-line: rgba(248, 238, 223, .14);\n  --gc-serif: \"Palatino Linotype\", Palatino, \"Book Antiqua\", \"Iowan Old Style\", \"URW Palladio L\", P052, Georgia, serif;\n  --gc-sans: \"Segoe UI Variable Text\", \"Segoe UI\", system-ui, -apple-system, \"Helvetica Neue\", Roboto, Arial, sans-serif;\n  --gc-mono: ui-monospace, \"Cascadia Mono\", \"Cascadia Code\", Consolas, \"SF Mono\", Menlo, monospace;\n  --gc-in: cubic-bezier(.16, 1, .3, 1);\n  --gc-out: cubic-bezier(.4, 0, .2, 1);\n  --gc-t-out: 360ms;\n  --gc-ink: var(--ink-cream, #f0e6d2);\n  --gc-lift: translateY(-2px);\n  --gc-press: scale(.98);\n  --gc-lift-shadow: 0 18px 44px rgba(0, 0, 0, .55), 0 0 0 1px rgba(240, 192, 122, .22);\n  --gc-qr: 72px;\n  --gc-qr-zoom: 2.2223;\n  --gc-arm: 9px;\n  display: block; box-sizing: border-box; width: 100%; margin: 0; padding: 0;\n  color: var(--gc-ink); font: 400 10.5px/1.4 var(--gc-sans); text-align: left; -webkit-font-smoothing: antialiased;\n}\n.goat *, .goat *::before, .goat *::after { box-sizing: border-box; }\n\n.goat__copy { display: block; margin: 0 0 8px; padding: 2px 0 1px; }\n.goat__line { display: block; margin: 0; font-size: 10.5px; line-height: 1.4; font-weight: 500; color: var(--gc-ink); text-wrap: pretty; }\n.goat__line em { font: italic 700 1.14em/1 var(--gc-serif); color: var(--gc-gold); letter-spacing: .02em; }\n\n.goat .goat-lockup {\n  position: relative; z-index: 2; display: block; width: 100%; height: var(--gc-h, 136px); margin: 0; padding: 0;\n  border: 1px solid var(--gc-line); border-radius: 10px; background: var(--gc-950);\n  color: var(--gc-cream); line-height: 1; text-decoration: none; cursor: pointer; -webkit-tap-highlight-color: transparent;\n  transition: transform var(--gc-t-out) var(--gc-out), box-shadow var(--gc-t-out) var(--gc-out);\n}\n.goat .goat-lockup:hover { color: var(--gc-cream); text-decoration: none; }\n.goat .goat-lockup:focus-visible { outline: 2px solid var(--gc-gold); outline-offset: 2px; }\n\n.gc-photo {\n  position: absolute; inset: 0; z-index: 0; display: block; overflow: hidden; border-radius: 9px;\n  container-type: size; background: var(--gc-950);\n}\n.gc-photo__frame {\n  position: absolute; left: var(--gc-px, 0%); top: var(--gc-py, 50%); display: block;\n  width: 100%; width: max(100cqw, 100cqh * 800 / 498); aspect-ratio: 800 / 498;\n  translate: calc(var(--gc-px, 0%) * -1) calc(var(--gc-py, 50%) * -1);\n  transform-origin: 30% 55%; transition: transform var(--gc-t-out) var(--gc-out);\n}\n.gc-photo__img {\n  display: block; width: 100%; height: 100%; max-width: none; margin: 0; border: 0;\n  object-fit: cover; user-select: none; -webkit-user-drag: none;\n}\n.gc-photo::after { content: \"\"; position: absolute; inset: 0; pointer-events: none; background: var(--gc-scrim, none); }\n.gc-steam {\n  position: absolute; left: 13%; bottom: 41.5%; width: 7.5%; height: auto; aspect-ratio: 60 / 120;\n  translate: -50% 0; overflow: visible; opacity: 0; filter: blur(.5px);\n  transition: opacity var(--gc-t-out) var(--gc-out);\n}\n.gc-steam path {\n  fill: none; stroke: rgba(255, 247, 236, .9); stroke-width: 6; stroke-linecap: round;\n  stroke-dasharray: 44 100; stroke-dashoffset: 44; animation: gc-steam 3.2s linear infinite paused;\n}\n.gc-steam path:nth-child(2) { animation-duration: 3.7s; animation-delay: -1.3s; }\n.gc-steam path:nth-child(3) { animation-duration: 2.9s; animation-delay: -2.2s; }\n\n.gc-vf {\n  --gc-m: conic-gradient(at var(--gc-arm) var(--gc-arm), #0000 75%, #000 0) 0 0 / calc(100% - var(--gc-arm)) calc(100% - var(--gc-arm));\n  position: absolute; z-index: 1; pointer-events: none;\n  inset: var(--gc-vf-t, 6px) var(--gc-vf-r, 6px) var(--gc-vf-b, 6px) var(--gc-vf-l, 6px);\n  border: 2px solid rgba(248, 238, 223, .62); -webkit-mask: var(--gc-m); mask: var(--gc-m);\n  transition: inset var(--gc-t-out) var(--gc-out);\n}\n.gc-vf::after {\n  content: \"\"; position: absolute; inset: -2px; border: 2px solid var(--gc-gold); opacity: 0;\n  transition: opacity var(--gc-t-out) var(--gc-out);\n}\n\n.gc-osd {\n  position: absolute; z-index: 1; top: 3px; left: calc(var(--gc-vf-l, 6px) + var(--gc-arm) + 4px);\n  display: flex; align-items: center; gap: 3px; margin: 0; padding: 2px 4px; border-radius: 4px;\n  background: rgba(20, 13, 8, .62); color: var(--gc-cream);\n  font: 500 var(--gc-osd-fs, 6.5px)/1 var(--gc-mono); letter-spacing: .05em; font-variant-numeric: tabular-nums; white-space: nowrap;\n}\n.gc-osd__dot { flex: none; width: var(--gc-dot, 5px); height: var(--gc-dot, 5px); border-radius: 50%; background: var(--gc-gold); }\n\n.goat .goat-lockup__word {\n  position: absolute; z-index: 1; left: var(--gc-word-x, 16px); top: var(--gc-word-y, 12px);\n  display: flex; flex-direction: column; align-items: flex-start; gap: var(--gc-word-gap, 5px); pointer-events: none;\n}\n.goat .goat-lockup__word::before {\n  content: \"\"; position: absolute; z-index: -1; inset: -10px -14px;\n  background: radial-gradient(closest-side, rgba(20, 13, 8, .62), rgba(20, 13, 8, .3) 60%, rgba(20, 13, 8, 0));\n}\n.goat .goat-lockup__name { display: block; font: 400 var(--gc-name, 17px)/1 var(--gc-serif); letter-spacing: -.005em; color: var(--gc-cream); white-space: nowrap; }\n.goat .goat-lockup__tag {\n  display: flex; gap: .4em; font: 600 var(--gc-tag, 6.5px)/1.25 var(--gc-sans); letter-spacing: var(--gc-tag-track, .15em);\n  text-transform: uppercase; color: var(--gc-cream-soft); white-space: nowrap; transition: color var(--gc-t-out) var(--gc-out);\n}\n\n.gc-qr {\n  position: absolute; z-index: 3; top: var(--gc-qr-y, auto); right: var(--gc-qr-x, 14px); bottom: var(--gc-qr-b, auto);\n  display: block; width: var(--gc-qr); height: var(--gc-qr); overflow: hidden; border-radius: 6px; background: #fbf5ea;\n  box-shadow: 0 6px 16px -8px rgba(0, 0, 0, .7); transform-origin: var(--gc-qr-origin, 100% 100%);\n  transition: scale 120ms var(--gc-out), box-shadow 120ms var(--gc-out);\n}\n.gc-qr svg { display: block; width: 100%; height: 100%; shape-rendering: crispEdges; }\n.gc-qr:hover, .goat-lockup:focus-visible .gc-qr {\n  scale: var(--gc-qr-zoom);\n  box-shadow: 0 8px 20px -6px rgba(0, 0, 0, .75), 0 0 0 1px rgba(201, 138, 70, .55);\n  transition-duration: 200ms; transition-timing-function: var(--gc-in);\n}\n\n.goat-lockup:is(:hover, :focus-visible, .is-active) .gc-photo__frame { transform: scale(1.06); transition: transform 1200ms var(--gc-in); }\n.goat-lockup:is(:hover, :focus-visible, .is-active) .gc-steam { opacity: 1; transition: opacity 700ms var(--gc-in) 150ms; }\n.goat-lockup:is(:hover, :focus-visible, .is-active) .gc-steam path { animation-play-state: running; }\n.goat-lockup:is(:hover, :focus-visible, .is-active) .gc-vf {\n  inset: calc(var(--gc-vf-t, 6px) + 3px) calc(var(--gc-vf-r, 6px) + 3px) calc(var(--gc-vf-b, 6px) + 3px) calc(var(--gc-vf-l, 6px) + 3px);\n  transition: inset 420ms var(--gc-in);\n}\n.goat-lockup:is(:hover, :focus-visible, .is-active) .gc-vf::after { opacity: 1; transition: opacity 300ms linear 140ms; }\n.goat-lockup:is(:hover, :focus-visible, .is-active) .gc-osd__dot { animation: gc-tally 2.4s .5s ease-in-out infinite; }\n.goat-lockup:is(:hover, :focus-visible, .is-active) .goat-lockup__tag { color: var(--gc-cream); transition-duration: 630ms; }\n\n.goat:not(.goat--gated) .goat-lockup:hover {\n  transform: var(--gc-lift); box-shadow: var(--gc-lift-shadow);\n  transition: transform 420ms var(--gc-in), box-shadow 420ms var(--gc-in);\n}\n.goat:not(.goat--gated) .goat-lockup:active { transform: var(--gc-press); transition-duration: 120ms; }\n\n@keyframes gc-steam { 0% { stroke-dashoffset: 44; opacity: 0; translate: 0 0; } 18% { opacity: .95; } 65% { opacity: .6; } 100% { stroke-dashoffset: -100; opacity: 0; translate: 2px -6px; } }\n@keyframes gc-tally { 0%, 100% { opacity: 1; } 50% { opacity: .3; } }\n\n.goat--panel .goat-lockup { --gc-h: 136px; }\n.goat--panel .gc-photo {\n  --gc-px: 0%; --gc-py: 55%;\n  --gc-scrim: linear-gradient(to bottom, rgba(20, 13, 8, .8), rgba(20, 13, 8, .42) 30%, rgba(20, 13, 8, 0) 52%);\n}\n.goat--panel .gc-qr { --gc-qr-x: 14px; --gc-qr-b: 14px; --gc-qr-origin: 100% 100%; }\n.goat--panel .gc-osd { left: auto; right: calc(var(--gc-vf-r, 6px) + var(--gc-arm) + 4px); }\n.goat--panel .goat-lockup__word { --gc-word-x: 22px; --gc-word-y: 14px; }\n\n.goat--settings .goat-lockup {\n  --gc-h: 150px; --gc-qr: 74px; --gc-qr-zoom: 2.1622; --gc-arm: 11px;\n}\n.goat--settings .gc-photo { --gc-px: 0%; --gc-py: 68%; --gc-scrim: linear-gradient(to left, rgba(20, 13, 8, .55), rgba(20, 13, 8, 0) 30%); }\n.goat--settings .gc-qr { --gc-qr-x: 18px; --gc-qr-y: calc((var(--gc-h) - 2px - var(--gc-qr)) / 2); --gc-qr-origin: 100% 50%; }\n.goat--settings .gc-vf { --gc-vf-t: 7px; --gc-vf-l: 7px; --gc-vf-b: 7px; --gc-vf-r: 7px; }\n.goat--settings .gc-osd { --gc-osd-fs: 7px; --gc-dot: 7px; top: 4px; left: 22px; gap: 4px; padding: 3px 5px; }\n.goat--settings .goat-lockup__word { --gc-word-x: 222px; --gc-word-y: 34px; --gc-name: 30px; --gc-tag: 8.5px; --gc-word-gap: 9px; }\n\n.goat--strip { display: inline-flex; flex-wrap: nowrap; align-items: center; gap: 10px; width: auto; max-width: none; }\n.goat--strip .goat__copy { flex: none; width: 136px; margin: 0; }\n.goat--strip .goat-lockup {\n  flex: none; width: 356px; --gc-h: 76px; --gc-qr-zoom: 1; --gc-arm: 8px;\n  --gc-lift: none;\n}\n.goat--strip .gc-photo { --gc-px: 0%; --gc-py: 70%; }\n.goat--strip .gc-qr { --gc-qr-x: 1px; --gc-qr-y: calc((var(--gc-h) - 2px - var(--gc-qr)) / 2); border-radius: 8px; }\n.goat--strip .gc-vf { --gc-vf-t: 5px; --gc-vf-l: 5px; --gc-vf-b: 5px; --gc-vf-r: 82px; }\n.goat--strip .gc-osd { display: none; }\n.goat--strip .goat-lockup__word { --gc-word-x: 128px; --gc-word-y: 3px; --gc-name: 16px; --gc-tag: 6.5px; --gc-word-gap: 3px; }\n.goat--strip .goat-lockup__tag { flex-direction: column; gap: 1px; }\n.goat--strip .gc-tag__sep { display: none; }\n\n@media (prefers-reduced-motion: reduce) {\n  .gc-steam { display: none; }\n  .gc-qr, .gc-qr:hover, .goat-lockup:focus-visible .gc-qr { transition: none; }\n  .goat-lockup:is(:hover, :focus-visible, .is-active) .gc-photo__frame { transform: none; }\n  .goat-lockup:is(:hover, :focus-visible, .is-active) .gc-vf { inset: var(--gc-vf-t, 6px) var(--gc-vf-r, 6px) var(--gc-vf-b, 6px) var(--gc-vf-l, 6px); }\n  .goat-lockup:is(:hover, :focus-visible, .is-active) .gc-osd__dot { animation: none; }\n  .goat .goat-lockup, .goat:not(.goat--gated) .goat-lockup:hover, .goat:not(.goat--gated) .goat-lockup:active { transform: none; }\n}\n\n/* Runtime renderer scopes the two campaign variants independently. */\n.goat--online {\n  position: relative; display: block; box-sizing: border-box; width: 100%;\n  margin: 0; color: var(--gc-ink); font: 400 10.5px/1.4 var(--gc-sans);\n  text-align: left; -webkit-font-smoothing: antialiased;\n}\n.goat--online .goat-lockup {\n  position: relative; z-index: 2; display: block; width: 100%; height: 136px;\n  margin: 0; padding: 0; overflow: visible; border: 1px solid var(--gc-line);\n  border-radius: 10px; background: var(--gc-950); color: var(--gc-cream);\n  line-height: 1; text-decoration: none; cursor: pointer;\n  transition: transform var(--gc-t-out) var(--gc-out), box-shadow var(--gc-t-out) var(--gc-out);\n}\n.goat--online .gc-photo { inset: 0; border-radius: 9px; overflow: hidden; }\n.goat--online .gc-photo__frame { transition: transform var(--gc-t-out) var(--gc-out); }\n.goat--online .gc-textbox {\n  position: absolute; z-index: 2; display: flex; flex-direction: column; align-items: flex-start;\n  gap: 4px; overflow: hidden; pointer-events: none; color: var(--gc-cream);\n}\n.goat--online .gc-textbox .goat__line {\n  display: block; max-width: 100%; margin: 0; color: var(--gc-cream); font: 600 10px/1.15 var(--gc-sans);\n  text-wrap: pretty; overflow-wrap: anywhere;\n}\n.goat--online .goat-lockup__word {\n  position: static; z-index: auto; display: flex; min-width: 0; max-width: 100%;\n  flex-direction: column; align-items: flex-start; gap: 4px; pointer-events: none;\n}\n.goat--online .goat-lockup__name,\n.goat--online .goat-lockup__tag,\n.goat--online .gc-badge {\n  display: block; min-width: 0; max-width: 100%; margin: 0; padding: 0; overflow: hidden;\n  color: var(--gc-cream); white-space: normal; overflow-wrap: anywhere;\n}\n.goat--online .goat-lockup__name { font: 700 16px/1 var(--gc-serif); letter-spacing: 0; }\n.goat--online .goat-lockup__tag { font: 600 7px/1.25 var(--gc-sans); letter-spacing: .04em; color: var(--gc-cream-soft); }\n.goat--online .gc-badge {\n  width: max-content; max-width: 100%; padding: 3px 6px; border: 1px solid rgba(240, 192, 122, .46);\n  border-radius: 999px; background: rgba(20, 13, 8, .72); color: var(--gc-gold);\n  font: 700 7px/1 var(--gc-sans); letter-spacing: .03em; white-space: nowrap;\n}\n.goat--online .gc-vf { z-index: 1; }\n.goat--online .gc-steam { z-index: 2; }\n.goat--online .gc-qr { top: auto; right: 14px; bottom: 14px; }\n.goat--online .goat-lockup:is(:hover, :focus-visible, .is-active) .gc-photo__frame {\n  transform: scale(1.06); transition: transform 1200ms var(--gc-in);\n}\n.goat--online .goat-lockup:is(:hover, :focus-visible, .is-active) .gc-steam { opacity: 1; }\n.goat--online .goat-lockup:hover {\n  transform: translateY(-2px); box-shadow: var(--gc-lift-shadow);\n  transition: transform 420ms var(--gc-in), box-shadow 420ms var(--gc-in);\n}\n.goat--online .goat-lockup:active { transform: scale(.98); transition-duration: 120ms; }\n\n.goat--dagoat {\n  display: block; box-sizing: border-box; width: 100%; margin-top: 16px; margin-bottom: 2px;\n  color: var(--ink-cream, #f0e6d2); font: 400 10.5px/1.4 var(--gc-sans); text-align: left;\n}\n.goat--dagoat .goat__copy { display: flex; flex-direction: column; gap: 4px; margin: 0 0 8px; padding: 2px 0 1px; }\n.goat--dagoat .goat__line { display: block; margin: 0; color: inherit; font-size: 10.5px; line-height: 1.4; font-weight: 500; }\n.goat--dagoat .goat__line--ask { color: var(--ink-muted, #a99f8c); font-weight: 400; }\n.goat--dagoat .goat-lockup {\n  position: relative; display: flex; flex-wrap: nowrap; align-items: center; width: 100%; max-width: 100%;\n  gap: .65em; box-sizing: border-box; padding: 10px; border: 0; border-radius: 8px;\n  overflow: hidden; background: #0b0b0d; color: inherit; cursor: pointer; text-decoration: none;\n  transition: transform var(--dur-base, 300ms) var(--ease, ease), box-shadow var(--dur-base, 300ms) var(--ease, ease);\n}\n.goat--dagoat .goat-lockup:focus-visible { outline: 2px solid var(--accent, #3ecf8e); outline-offset: 2px; }\n.goat--dagoat .goat-lockup__meteors { position: absolute; inset: -22% -12%; z-index: 0; overflow: hidden; pointer-events: none; opacity: 0; transition: opacity 360ms var(--gl-out); }\n.goat--dagoat .goat-lockup__meteors i { position: absolute; top: 0; left: 0; width: 1px; height: var(--gl-m-h, 4.4em); border-radius: 1px; background: linear-gradient(to bottom, transparent, rgba(236, 231, 219, .68)); rotate: 34deg; translate: 3.2em -4.8em; animation: gl-meteor var(--gl-m-d, 3.3s) linear var(--gl-m-delay, 0s) infinite; }\n.goat--dagoat .goat-lockup__meteors i::after { content: \"\"; position: absolute; left: 50%; bottom: 0; width: 2.5px; height: 2.5px; border-radius: 50%; background: #ece7db; box-shadow: 0 0 7px 1px rgba(236, 231, 219, .55); translate: -50% 40%; }\n.goat--dagoat .goat-lockup__meteors i:nth-child(1) { left: 74%; top: 6%; --gl-m-h: 5.2em; --gl-m-d: 2.85s; }\n.goat--dagoat .goat-lockup__meteors i:nth-child(2) { left: 52%; top: -4%; --gl-m-h: 3.4em; --gl-m-d: 3.9s; --gl-m-delay: -.48s; }\n.goat--dagoat .goat-lockup__meteors i:nth-child(3) { left: 89%; top: 22%; --gl-m-h: 4.6em; --gl-m-d: 3.15s; --gl-m-delay: -1.11s; }\n.goat--dagoat .goat-lockup__meteors i:nth-child(4) { left: 33%; top: 12%; --gl-m-h: 2.8em; --gl-m-d: 4.65s; --gl-m-delay: -1.65s; }\n.goat--dagoat .goat-lockup__meteors i:nth-child(5) { left: 64%; top: 38%; --gl-m-h: 3.9em; --gl-m-d: 3.6s; --gl-m-delay: -.27s; }\n.goat--dagoat .goat-lockup__meteors i:nth-child(6) { left: 18%; top: -8%; --gl-m-h: 4.1em; --gl-m-d: 4.2s; --gl-m-delay: -1.43s; }\n.goat--dagoat .goat-lockup__meteors i:nth-child(7) { left: 97%; top: -2%; --gl-m-h: 3.1em; --gl-m-d: 3.45s; --gl-m-delay: -2.18s; }\n.goat--dagoat .goat-lockup__meteors i:nth-child(8) { left: 44%; top: 30%; --gl-m-h: 5.6em; --gl-m-d: 2.55s; --gl-m-delay: -.87s; }\n.goat--dagoat .goat-lockup__meteors i:nth-child(9) { left: 82%; top: 48%; --gl-m-h: 2.6em; --gl-m-d: 5.1s; --gl-m-delay: -2.7s; }\n.goat--dagoat .goat-lockup__mark { position: relative; z-index: 1; display: block; height: 5.4em; flex: none; }\n.goat--dagoat .goat-lockup__svg { display: block; width: auto; height: 100%; overflow: visible; }\n.goat--dagoat .gl-head > * { fill: #ece7db; }\n.goat--dagoat .gl-seal { transform-box: fill-box; transform-origin: 50% 50%; transform: scale(1.36); }\n.goat--dagoat .gl-seal-face { fill: #b3382c; transition: fill 360ms var(--gl-out); }\n.goat--dagoat .gl-seal-glow { fill: #b3382c; opacity: 0; filter: blur(5px); transition: opacity 360ms var(--gl-out); }\n.goat--dagoat .gl-char { fill: #f6efe6; opacity: 1; transition: opacity 360ms var(--gl-out); }\n.goat--dagoat .gl-thumb { fill: #f6efe6; opacity: 0; transition: opacity 450ms linear 180ms; }\n.goat--dagoat .gl-burst, .goat--dagoat .gl-ray, .goat--dagoat .gl-ring, .goat--dagoat .gl-ember { opacity: 0; }\n.goat--dagoat .gl-ray { stroke: #f7ead6; stroke-width: 3.2; stroke-linecap: round; stroke-dasharray: 9 32; stroke-dashoffset: 9; }\n.goat--dagoat .gl-ring { fill: none; stroke: #f7ead6; stroke-width: 3; }\n.goat--dagoat .gl-ember { fill: #f7ead6; }\n.goat--dagoat .goat-lockup__word { position: relative; z-index: 1; display: flex; min-width: 0; flex: 1 1 auto; flex-direction: column; align-items: flex-start; justify-content: center; gap: .4em; font-family: var(--gc-sans); font-weight: 300; }\n.goat--dagoat .goat-lockup__name, .goat--dagoat .goat-lockup__tag { display: block; width: max-content; max-width: 100%; margin: 0; padding: 0; text-align: left; text-indent: 0; white-space: nowrap; }\n.goat--dagoat .goat-lockup__name { color: #f2f3f5; font-size: max(13px, 1em); line-height: 1; letter-spacing: .18em; text-transform: uppercase; }\n.goat--dagoat .goat-lockup__tag { color: #9b9da4; font-size: 7px; line-height: 1; letter-spacing: .12em; text-transform: uppercase; }\n.goat--dagoat .goat-lockup:hover .goat-lockup__meteors, .goat--dagoat .goat-lockup:focus-visible .goat-lockup__meteors, .goat--dagoat .goat-lockup.is-active .goat-lockup__meteors { opacity: 1; }\n.goat--dagoat .goat-lockup:hover .gl-seal-face, .goat--dagoat .goat-lockup:focus-visible .gl-seal-face, .goat--dagoat .goat-lockup.is-active .gl-seal-face { fill: #c8412f; }\n.goat--dagoat .goat-lockup:hover .gl-seal-glow, .goat--dagoat .goat-lockup:focus-visible .gl-seal-glow, .goat--dagoat .goat-lockup.is-active .gl-seal-glow { opacity: .7; }\n.goat--dagoat .goat-lockup:hover .gl-char, .goat--dagoat .goat-lockup:focus-visible .gl-char, .goat--dagoat .goat-lockup.is-active .gl-char { opacity: 0; }\n.goat--dagoat .goat-lockup:hover .gl-thumb, .goat--dagoat .goat-lockup:focus-visible .gl-thumb, .goat--dagoat .goat-lockup.is-active .gl-thumb { opacity: 1; }\n.goat--dagoat .goat-lockup:hover .gl-burst, .goat--dagoat .goat-lockup:focus-visible .gl-burst, .goat--dagoat .goat-lockup.is-active .gl-burst { opacity: 1; }\n@keyframes gl-meteor { 0% { translate: 3.2em -4.8em; opacity: 0; } 9% { opacity: 1; } 68% { opacity: 1; } 100% { translate: -3.4em 5.1em; opacity: 0; } }\n\n@media (prefers-reduced-motion: reduce) {\n  .goat--dagoat .goat-lockup__meteors i { animation: none; translate: 0 0; opacity: .5; }\n  .goat--dagoat .goat-lockup, .goat--dagoat .goat-lockup:hover { transform: none; }\n}\n";

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
.shell.is-capped { max-height: var(--gmdm-panel-max-height); }
.shell.is-capped .body { height: max(0px, calc(var(--gmdm-panel-max-height) - 48px)); min-height: 0; overflow: hidden; }
.shell.is-capped .body__inner { overflow-y: auto; }

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
 *  - the lift (the master's translateY(-2px)), gated on the open panel like
 *    Ko-fi and GitHub. The markup carries .goat--gated, which switches the
 *    master's ungated lift off; this is the gate from the master README
 *    ("Lift gating"). Reduced motion is covered by the .goat-lockup entry in
 *    the block at the end of this sheet.
 * Animation is :hover / :focus-visible / .is-active on .goat-lockup only --
 * hovering the sentence or StarGithub must not play it. The QR zooms to
 * 160px on .gc-qr:hover or plate :focus-visible, growing up and left over the
 * sentence; .body__inner and .shell clip it, so the room it needs is checked
 * in test/checks/widget-banner-shots.mjs. */

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

  /* Online campaign layout is runtime-only: keep the published lockup copy
     above byte-identical while giving the signed renderer its own geometry. */
  const GOAT_ONLINE_FIX_CSS =
    ".goat--online .goat__copy { display: block; margin: 0 0 8px; padding: 2px 0 1px; }\n" +
    ".goat--online .goat__line { display: block; width: 100%; max-width: 100%; margin: 0; overflow: hidden; }\n" +
    ".goat--online .goat-lockup__word { position: absolute; z-index: 1; left: 22px; top: 14px; " +
      "display: flex; width: calc(50% - 2px); max-width: calc(50% - 2px); min-width: 0; " +
      "flex-direction: column; align-items: flex-start; gap: 4px; overflow: hidden; pointer-events: none; }\n" +
    ".goat--online .goat-lockup__name, .goat--online .goat-lockup__tag { " +
      "display: block; flex: none; width: 100%; min-width: 0; max-width: 100%; overflow: hidden; white-space: nowrap; }\n" +
    ".goat--online .goat-lockup__name { font-size: 15px; }\n" +
    ".goat--online .goat-lockup__tag { font-size: 6px; }\n" +
    ".goat--online .gc-badge { position: absolute; z-index: 2; top: 12px; right: 8px; " +
      "display: flex; align-items: center; gap: 3px; width: calc(50% - 28px); max-width: calc(50% - 28px); " +
      "overflow: hidden; white-space: nowrap; }\n" +
    ".goat--online .gc-badge { font: 500 6.5px/1.2 var(--gc-mono); padding: 2px 4px; letter-spacing: .05em; font-variant-numeric: tabular-nums; }\n" +
    ".goat--online .gc-badge__text { display: block; flex: 1 1 auto; min-width: 0; max-width: 100%; overflow: hidden; white-space: nowrap; }\n" +
    ".goat--online .gc-badge .gc-osd__dot { flex: none; }\n" +
    "@media (max-height: 450px) and (min-resolution: 1.5dppx) {\n" +
      "  .goat--online .gc-qr { bottom: 31px; }\n" +
    "}\n" +
    "@media (prefers-reduced-motion: reduce) {\n" +
      "  .goat--online .goat-lockup:hover, .goat--online .goat-lockup:active { transform: none; box-shadow: none; }\n" +
      "  .goat--online .goat-lockup:is(:hover, :focus-visible, .is-active) .gc-photo__frame { transform: none; }\n" +
      "  .goat--online .goat-lockup:is(:hover, :focus-visible, .is-active) .gc-vf { inset: var(--gc-vf-t, 6px) var(--gc-vf-r, 6px) var(--gc-vf-b, 6px) var(--gc-vf-l, 6px); }\n" +
    "}\n";
  const CSS_ALL = CSS + "\n" + GOAT_LOCKUP_CSS + "\n" + GOAT_ONLINE_FIX_CSS;

  // goatcam-banner-render:begin
  function renderGoatBanner(mount, model) {
    const d = mount.ownerDocument || document;
    const SVG_NS = 'http://www.w3.org/2000/svg';
    const make = function (tag, className, parent) {
      const el = d.createElement(tag);
      if (className) el.className = className;
      if (parent) parent.appendChild(el);
      return el;
    };
    const svg = function (tag, className, parent) {
      const el = d.createElementNS(SVG_NS, tag);
      if (className) el.setAttribute('class', className);
      if (parent) parent.appendChild(el);
      return el;
    };
    const attr = function (el, name, value) {
      el.setAttribute(name, String(value));
      return el;
    };
    const clamp01 = function (value, fallback) {
      const n = Number(value);
      return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : fallback;
    };
    const fits = function (el) {
      return el.scrollWidth <= el.clientWidth;
    };
    const shrinkText = function (el) {
      const size = Number.parseFloat(d.defaultView.getComputedStyle(el).fontSize);
      el.style.fontSize = (Number.isFinite(size) ? size * 0.85 : 10) + 'px';
    };
    const fitText = function (el, value) {
      const raw = String(value == null ? '' : value);
      el.textContent = raw;
      if (!raw || !el.clientWidth || fits(el)) return;
      shrinkText(el);
      if (fits(el)) return;
      let shortened = raw;
      while (shortened.length > 1 && !fits(el)) {
        shortened = shortened.slice(0, -1).trimEnd();
        el.textContent = shortened + '…';
      }
      if (!el.textContent.endsWith('…')) el.textContent = shortened + '…';
    };
    const addHeadline = function (parent, banner) {
      const line = make('span', 'goat__line', parent);
      const headline = String(banner.headline == null ? '' : banner.headline);
      const emphasized = typeof banner.headlineEm === 'string' && banner.headlineEm &&
        headline.includes(banner.headlineEm) ? banner.headlineEm : '';
      if (!emphasized) {
        fitText(line, headline);
        return line;
      }
      const at = headline.indexOf(emphasized);
      line.appendChild(d.createTextNode(headline.slice(0, at)));
      const em = make('em', '', line);
      em.textContent = emphasized;
      line.appendChild(d.createTextNode(headline.slice(at + emphasized.length)));
      if (!fits(line)) {
        shrinkText(line);
        if (!fits(line)) {
          let shortened = headline;
          while (shortened.length > 1 && !fits(line)) {
            shortened = shortened.slice(0, -1).trimEnd();
            line.textContent = shortened + '\u2026';
          }
          if (!line.textContent.endsWith('\u2026')) line.textContent = shortened + '\u2026';
        }
      }
      return line;
    };
    const addTagline = function (parent, banner) {
      const tag = make('span', 'goat-lockup__tag', parent);
      fitText(tag, Array.isArray(banner.tagline) ? banner.tagline.join(' · ') : '');
      return tag;
    };
    const addBadge = function (parent, banner) {
      if (!banner.badge) return null;
      const badge = make('span', 'gc-osd gc-badge', parent);
      attr(badge, 'aria-hidden', 'true');
      const dot = make('span', 'gc-osd__dot', badge);
      attr(dot, 'aria-hidden', 'true');
      const label = make('span', 'gc-badge__text', badge);
      fitText(label, banner.badge);
      return badge;
    };
    const addQr = function (parent, banner) {
      const qrWrap = make('span', 'gc-qr', parent);
      const qr = banner.qr && typeof banner.qr === 'object' ? banner.qr : {};
      const size = Number(qr.size) === 37 ? 37 : 37;
      const code = svg('svg', '', qrWrap);
      attr(code, 'viewBox', '0 0 ' + size + ' ' + size);
      attr(code, 'shape-rendering', 'crispEdges');
      attr(code, 'role', 'img');
      attr(code, 'aria-label', banner.labels && banner.labels.qr || 'QR code');
      attr(code, 'focusable', 'false');
      const rows = Array.isArray(qr.rows) ? qr.rows : [];
      let pathData = '';
      for (let y = 0; y < size; y++) {
        const row = typeof rows[y] === 'string' ? rows[y] : '';
        for (let x = 0; x < size; x++) {
          if (row[x] === '1') pathData += 'M' + x + ' ' + y + 'h1v1h-1z';
        }
      }
      const path = svg('path', '', code);
      attr(path, 'fill', '#1c130c');
      attr(path, 'd', pathData);
      return qrWrap;
    };
    const addSteam = function (parent) {
      const steam = svg('svg', 'gc-steam', parent);
      attr(steam, 'viewBox', '0 0 60 120');
      attr(steam, 'focusable', 'false');
      const paths = [
        'M22 118C14 100 30 88 22 70S14 40 24 22',
        'M32 118C40 98 24 84 33 64S42 36 32 14',
        'M42 118C36 102 48 90 41 74S36 50 44 34',
      ];
      for (const pathData of paths) {
        const path = svg('path', '', steam);
        attr(path, 'pathLength', '100');
        attr(path, 'd', pathData);
      }
      return steam;
    };
    const addDagoatMark = function (parent) {
      const mark = make('span', 'goat-lockup__mark', parent);
      attr(mark, 'aria-hidden', 'true');
      const main = svg('svg', 'goat-lockup__svg', mark);
      attr(main, 'viewBox', '46 -16 220 250');
      attr(main, 'focusable', 'false');
      const head = svg('g', 'gl-head', main);
      for (const dValue of [
        'M62 210 C74 148 120 98 190 80 C152 106 106 150 82 216 Z',
        'M186 84 C214 62 226 32 210 8 C216 36 200 62 174 80 Z',
        'M170 82 C190 60 194 34 180 16 C186 40 172 62 156 78 Z',
        'M188 82 C206 90 218 104 222 122 C212 106 200 94 182 90 Z',
        'M206 122 C215 134 217 149 209 160 C212 147 208 133 200 127 Z',
      ]) {
        const path = svg('path', '', head);
        attr(path, 'd', dValue);
      }
      const eye = svg('circle', '', head);
      attr(eye, 'cx', '197'); attr(eye, 'cy', '99'); attr(eye, 'r', '3.6');
      const seal = svg('g', 'gl-seal', main);
      for (const className of ['gl-seal-glow', 'gl-seal-face']) {
        const rect = svg('rect', className, seal);
        attr(rect, 'x', '214'); attr(rect, 'y', '182'); attr(rect, 'width', '36');
        attr(rect, 'height', '36'); attr(rect, 'rx', '4');
      }
      const glyph = svg('svg', 'gl-glyph', seal);
      attr(glyph, 'x', '214'); attr(glyph, 'y', '182'); attr(glyph, 'width', '36');
      attr(glyph, 'height', '36'); attr(glyph, 'viewBox', '0 0 100 100');
      const thumb = svg('path', 'gl-thumb', glyph);
      attr(thumb, 'd', 'M30 50 C26 50 24 52 24 56 L24 87 C24 91 26 93 30 93 L73 93 C79 93 84 90 85 84 L89 55 C90 49 86 44 80 44 L63 44 C65 38 67 25 65 18 C63 12 55 12 53 18 C51 24 53 33 51 42 C50 47 47 50 42 50 Z');
      attr(thumb, 'transform', 'translate(-5 -3)');
      const character = svg('path', 'gl-char', glyph);
      attr(character, 'd', 'M33.5 18.12Q39.14 21.51 41.54 23.62Q43.93 25.74 43.65 27.85Q43.37 29.97 42.24 30.96Q41.11 31.94 40.55 31.94Q39.42 31.94 38.57 29.12Q37.45 25.17 32.93 18.97ZM20.52 33.07H52.68Q58.89 23.76 60.86 16.99L66.79 20.66Q63.96 22.07 61.14 25.74Q58.04 29.41 54.37 33.07H68.2L72.43 28.84L77.79 34.77H51.55V47.46H63.96L68.2 43.79L72.99 49.15H51.55V62.13H71.58L76.1 57.9L81.46 63.82H51.55V73.7Q51.55 76.8 51.83 81.32L47.04 83.01Q47.32 78.78 47.32 63.82H27.85Q24.19 63.82 21.08 64.67L18.54 62.13H47.32V49.15H35.47Q31.8 49.15 28.7 50L26.16 47.46H47.32V34.77H29.83Q26.16 34.77 23.06 35.61Z');
      const burst = svg('g', 'gl-burst', glyph);
      attr(burst, 'transform', 'translate(53 0)'); attr(burst, 'fill', 'none');
      const ring = svg('circle', 'gl-ring', burst);
      attr(ring, 'cx', '0'); attr(ring, 'cy', '0'); attr(ring, 'r', '12');
      const rays = [-168, -138, -108, -76, -44, -14];
      for (let i = 0; i < rays.length; i++) {
        const ray = svg('line', 'gl-ray gl-ray--' + (i + 1), burst);
        attr(ray, 'transform', 'rotate(' + rays[i] + ')'); attr(ray, 'x1', '10');
        attr(ray, 'y1', '0'); attr(ray, 'x2', '40'); attr(ray, 'y2', '0');
      }
      for (const [name, cx, cy, r] of [['a', -7, -2, 2.2], ['b', 8, -5, 1.9], ['c', 0, -9, 1.6]]) {
        const ember = svg('circle', 'gl-ember gl-ember--' + name, burst);
        attr(ember, 'cx', cx); attr(ember, 'cy', cy); attr(ember, 'r', r);
      }
      return mark;
    };
    const renderDagoat = function () {
      const banner = make('div', 'goat goat--panel goat--gated goat--dagoat');
      const copy = make('div', 'goat__copy', banner);
      const line1 = make('span', 'goat__line', copy);
      line1.textContent = 'Goat Project - Help fight Cancer, Alzheimer’s, Parkinson’s, COVID-19, Dengue, Hepatitis C etc.';
      const line2 = make('span', 'goat__line goat__line--ask', copy);
      line2.textContent = 'Contribute your idle compute to Earn GOAT.';
      const link = make('a', 'goat-lockup', banner);
      attr(link, 'href', 'https://dagoat.io'); attr(link, 'target', '_blank');
      attr(link, 'rel', 'noopener noreferrer'); attr(link, 'data-goat-mark', '');
      attr(link, 'aria-label', 'DaGoat - open dagoat.io');
      const meteors = make('span', 'goat-lockup__meteors', link);
      attr(meteors, 'aria-hidden', 'true');
      for (let i = 0; i < 9; i++) make('i', '', meteors);
      addDagoatMark(link);
      const word = make('span', 'goat-lockup__word', link);
      const name = make('span', 'goat-lockup__name', word); name.textContent = 'Goatproject';
      const tag = make('span', 'goat-lockup__tag', word); tag.textContent = 'The People’s Compute Commons';
      return banner;
    };
    const renderOnline = function (banner, photo) {
      const root = make('div', 'goat goat--panel goat--gated goat--online');
      const copy = make('div', 'goat__copy', root);
      addHeadline(copy, banner);
      const link = make('a', 'goat-lockup', root);
      attr(link, 'href', banner.link); attr(link, 'target', '_blank');
      attr(link, 'rel', 'noopener noreferrer');
      attr(link, 'aria-label', banner.labels && banner.labels.link || 'GOAT Cam');
      attr(link, 'data-goat-mark', '');
      const image = make('span', 'gc-photo', link); attr(image, 'aria-hidden', 'true');
      const frame = make('span', 'gc-photo__frame', image);
      const img = make('img', 'gc-photo__img', frame);
      attr(img, 'src', photo.dataUrl); attr(img, 'alt', '');
      attr(img, 'width', banner.photo.w); attr(img, 'height', banner.photo.h);
      attr(img, 'draggable', 'false');
      const focus = banner.photo.focus || [0.3, 0.55];
      const focusX = clamp01(focus[0], 0.3);
      const focusY = clamp01(focus[1], 0.55);
      image.style.setProperty('--gc-px', (focusX * 100) + '%');
      image.style.setProperty('--gc-py', (focusY * 100) + '%');
      img.style.objectPosition = (focusX * 100) + '% ' + (focusY * 100) + '%';
      const steamAt = banner.photo.steamAt || [0.17, 0.62];
      if (banner.effects && banner.effects.steam) {
        const steam = addSteam(image);
        steam.style.left = (clamp01(steamAt[0], 0.17) * 100) + '%';
        steam.style.top = (clamp01(steamAt[1], 0.62) * 100) + '%';
        steam.style.bottom = 'auto';
        steam.style.translate = '-50% -50%';
      }
      if (banner.effects && banner.effects.viewfinder) make('span', 'gc-vf', image);
      // photo.textBox is intentionally ignored; the publisher preview does not use it.
      const word = make('span', 'goat-lockup__word', link);
      const name = make('span', 'goat-lockup__name', word); fitText(name, banner.wordmark);
      addTagline(word, banner);
      addBadge(link, banner);
      addQr(link, banner);
      return root;
    };
    const selected = model && model.kind === 'online' && model.banner && model.photo &&
      model.photo.kind === 'webp' && typeof model.photo.dataUrl === 'string'
      ? renderOnline(model.banner, model.photo) : renderDagoat();
    mount.replaceChildren(selected);
    if (selected.classList.contains('goat--online') && model && model.banner) {
      const copy = selected.querySelector('.goat__copy');
      copy.replaceChildren();
      addHeadline(copy, model.banner);
      const name = selected.querySelector('.goat-lockup__name');
      const tag = selected.querySelector('.goat-lockup__tag');
      if (name) fitText(name, model.banner.wordmark);
      if (tag) fitText(tag, Array.isArray(model.banner.tagline) ? model.banner.tagline.join(' · ') : '');
      const badgeText = selected.querySelector('.gc-badge__text');
      if (badgeText) fitText(badgeText, model.banner.badge);
    }
  }
  // goatcam-banner-render:end

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
    '<div class="goat-mount" data-goat-banner></div>' +

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
  let bannerMount = null;
  let bannerPort = null;
  let bannerDisplay = null;
  let bannerModel = { kind: 'dagoat' };
  let bannerPendingDisplay = null;
  let bannerReadSerial = 0;
  let bannerHovered = false;
  let bannerFocused = false;
  let bannerVisibilityBound = false;

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
    const panelHeight = shell && shell.classList.contains('is-open') ? shell.scrollHeight : 0;
    const panelMaxTop = panelHeight ? Math.max(MIN_TOP, vh - panelHeight - 8) : MAX_TOP;
    const finalTop = Math.max(MIN_TOP, Math.min(MAX_TOP, panelMaxTop, Math.round(top)));
    const panelMaxHeight = Math.max(0, vh - finalTop - 8);

    return {
      top: finalTop,
      // Never let the panel run off the right edge on a narrow window.
      left: Math.max(8, Math.min(vw - OPEN_WIDTH - 8, Math.round(finalLeft))),
      onMap: panelRight > 0,
      capped: Boolean(panelHeight && panelHeight > panelMaxHeight),
      panelMaxHeight,
    };
  }

  let placeQueued = false;
  function place() {
    if (placeQueued || !host) return;
    placeQueued = true;
    requestAnimationFrame(function () {
      placeQueued = false;
      if (!host) return;
      if (shell.classList.contains('is-capped')) {
        shell.classList.remove('is-capped');
        shell.style.removeProperty('--gmdm-panel-max-height');
      }
      const p = placement();
      shell.classList.toggle('is-capped', p.capped);
      if (p.capped) shell.style.setProperty('--gmdm-panel-max-height', p.panelMaxHeight + 'px');
      else shell.style.removeProperty('--gmdm-panel-max-height');
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
    const wasOpen = shell.classList.contains('is-open');
    shell.classList.toggle('is-open', open);
    if (pill) pill.setAttribute('aria-expanded', open ? 'true' : 'false');
    place();
    if (open && !wasOpen) {
      connectBannerPort();
      loadBannerDisplay();
      setTimeout(place, 360);
    } else if (!open && wasOpen) {
      bannerPendingDisplay = null;
      closeBannerPort();
    }
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

  /* -------------------------------------------------------------- goatcam */

  function bannerPost(message) {
    if (!bannerPort || typeof bannerPort.postMessage !== 'function') return;
    try { bannerPort.postMessage(message); } catch (_) { /* port is gone */ }
  }

  function closeBannerPort() {
    const port = bannerPort;
    bannerPort = null;
    if (!port || typeof port.disconnect !== 'function') return;
    try { port.disconnect(); } catch (_) { /* already disconnected */ }
  }

  function connectBannerPort() {
    if (!shell || !shell.classList.contains('is-open') || bannerPort ||
        !api || !api.runtime || typeof api.runtime.connect !== 'function') return;
    try {
      const port = api.runtime.connect({ name: 'goatcamBanner' });
      bannerPort = port;
      if (port && port.onDisconnect && typeof port.onDisconnect.addListener === 'function') {
        port.onDisconnect.addListener(function () {
          if (bannerPort !== port) return;
          bannerPort = null;
          if (shell && shell.classList.contains('is-open')) connectBannerPort();
        });
      }
    } catch (_) { bannerPort = null; }
  }

  function localGet(key) {
    return new Promise(function (resolve) {
      if (!api || !api.storage || !api.storage.local || typeof api.storage.local.get !== 'function') {
        resolve(null);
        return;
      }
      let settled = false;
      const done = function (value) {
        if (settled) return;
        settled = true;
        resolve(value || null);
      };
      try {
        const result = api.storage.local.get(key, done);
        if (result && typeof result.then === 'function') result.then(done, function () { done(null); });
      } catch (_) { done(null); }
      setTimeout(function () { done(null); }, 2000);
    });
  }

  function inUnit(value) {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
  }

  function validBannerObject(banner) {
    if (!banner || typeof banner !== 'object' || typeof banner.headline !== 'string' ||
        typeof banner.wordmark !== 'string' || !Array.isArray(banner.tagline) ||
        banner.tagline.length > 2 || banner.tagline.some(function (part) { return typeof part !== 'string'; }) ||
        !banner.effects || typeof banner.effects.viewfinder !== 'boolean' ||
        typeof banner.effects.steam !== 'boolean' || typeof banner.link !== 'string' ||
        !banner.qr || banner.qr.size !== 37 || !Array.isArray(banner.qr.rows) || banner.qr.rows.length !== 37 ||
        banner.qr.rows.some(function (row) { return typeof row !== 'string' || row.length !== 37 || !/^[01]+$/.test(row); }) ||
        !banner.photo || typeof banner.photo.w !== 'number' || typeof banner.photo.h !== 'number' ||
        !Array.isArray(banner.photo.focus) || !inUnit(banner.photo.focus[0]) || !inUnit(banner.photo.focus[1]) ||
        !Array.isArray(banner.photo.steamAt) || !inUnit(banner.photo.steamAt[0]) || !inUnit(banner.photo.steamAt[1]) ||
        !Array.isArray(banner.photo.textBox) || banner.photo.textBox.length !== 4 ||
        !inUnit(banner.photo.textBox[0]) || !inUnit(banner.photo.textBox[1]) ||
        !inUnit(banner.photo.textBox[2]) || !inUnit(banner.photo.textBox[3]) ||
        !banner.labels || typeof banner.labels.link !== 'string' || typeof banner.labels.qr !== 'string') return false;
    if (banner.headlineEm != null && (typeof banner.headlineEm !== 'string' || !banner.headline.includes(banner.headlineEm))) return false;
    if (banner.badge != null && typeof banner.badge !== 'string') return false;
    return true;
  }

  function base64(value) {
    return typeof value === 'string' && value.length > 0 && value.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(value);
  }

  async function bannerModelFor(display) {
    if (!display || display.kind === 'dagoat') return { kind: 'dagoat' };
    if (display.kind !== 'online' || typeof display.sha256 !== 'string' || !validBannerObject(display.banner) ||
        typeof display.expiresMs !== 'number' || display.expiresMs <= Date.now()) return { kind: 'dagoat' };
    const key = 'goatcamBanner.set.' + display.sha256;
    const got = await localGet(key);
    const stored = got && got[key];
    if (!stored || !base64(stored.signed) || !base64(stored.webp) || stored.webp.length > 400000) {
      return { kind: 'dagoat' };
    }
    return {
      kind: 'online',
      banner: display.banner,
      photo: { kind: 'webp', dataUrl: 'data:image/webp;base64,' + stored.webp },
    };
  }

  function bindBannerEvents() {
    if (!bannerMount) return;
    const lockup = bannerMount.querySelector('.goat-lockup');
    if (!lockup) return;
    lockup.addEventListener('pointerenter', function () {
      bannerHovered = true;
      bannerPost({ type: 'pointer', over: true });
    });
    lockup.addEventListener('pointerleave', function () {
      bannerHovered = false;
      bannerPost({ type: 'pointer', over: false });
      if (!bannerFocused && bannerPendingDisplay) {
        const next = bannerPendingDisplay;
        bannerPendingDisplay = null;
        drawBannerDisplay(next);
      }
    });
    lockup.addEventListener('focusin', function () {
      bannerFocused = true;
      lockup.classList.add('is-active');
      bannerPost({ type: 'focus', inside: true });
    });
    lockup.addEventListener('focusout', function (event) {
      if (event.relatedTarget && lockup.contains(event.relatedTarget)) return;
      bannerFocused = false;
      lockup.classList.remove('is-active');
      bannerPost({ type: 'focus', inside: false });
      if (!bannerHovered && bannerPendingDisplay) {
        const next = bannerPendingDisplay;
        bannerPendingDisplay = null;
        drawBannerDisplay(next);
      }
    });
    lockup.addEventListener('click', function (event) {
      if (bannerModel.kind !== 'online' || !bannerDisplay || bannerDisplay.expiresMs > Date.now()) return;
      event.preventDefault();
      drawBannerModel({ kind: 'dagoat' });
      bannerPost({ type: 'click' });
    });
  }

  function drawBannerModel(model) {
    if (!bannerMount) return;
    bannerReadSerial += 1;
    bannerHovered = false;
    bannerFocused = false;
    bannerModel = model && model.kind === 'online' ? model : { kind: 'dagoat' };
    renderGoatBanner(bannerMount, bannerModel);
    bindBannerEvents();
    place();
  }

  async function drawBannerDisplay(display) {
    if (!bannerMount) return;
    const serial = ++bannerReadSerial;
    bannerDisplay = display && typeof display === 'object' ? display : null;
    const model = await bannerModelFor(bannerDisplay);
    if (serial !== bannerReadSerial) return;
    drawBannerModel(model);
  }

  function applyBannerDisplay(display) {
    bannerDisplay = display && typeof display === 'object' ? display : null;
    if (!shell || !shell.classList.contains('is-open')) return;
    const immediate = Boolean(bannerDisplay && bannerDisplay.immediate);
    if (!immediate && (bannerHovered || bannerFocused)) {
      bannerPendingDisplay = bannerDisplay;
      return;
    }
    bannerPendingDisplay = null;
    drawBannerDisplay(bannerDisplay);
  }

  async function loadBannerDisplay() {
    const got = await localGet('goatcamBanner.display');
    if (!shell || !shell.classList.contains('is-open')) return;
    const display = got && got['goatcamBanner.display'];
    applyBannerDisplay(display || { kind: 'dagoat' });
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
    bannerMount = shadow.querySelector('[data-goat-banner]');
    drawBannerModel({ kind: 'dagoat' });

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

    if (!bannerVisibilityBound) {
      bannerVisibilityBound = true;
      doc.addEventListener('visibilitychange', function () {
        if (doc.visibilityState !== 'visible') return;
        if (bannerModel.kind === 'online' && bannerDisplay && bannerDisplay.expiresMs <= Date.now()) {
          drawBannerModel({ kind: 'dagoat' });
        }
        bannerPost({ type: 'resume' });
      });
    }

    if (api && api.storage && api.storage.onChanged) {
      api.storage.onChanged.addListener(function (changes, area) {
        if (area !== 'local') return;
        const bannerChange = changes['goatcamBanner.display'];
        if (bannerChange) applyBannerDisplay(bannerChange.newValue);
        if (!changes.settings) return;
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
