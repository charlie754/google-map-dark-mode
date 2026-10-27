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
  const GOAT_LOCKUP_CSS = "/* GOAT Cam banner v2. A copy of the master stylesheet, goatcam-banner.css in the\n   GOAT Cam repository's brand/goatcam-banner folder (2026-10-26), with its\n   comments removed; no rule is changed. Change the master, then copy it again.\n   Photo: \"White cup and MacBook\" by Alex Knight, CC0 1.0. */\n.goat {\n  --gc-950: #140d08; --gc-gold: #f0c07a; --gc-cream: #f8eedf; --gc-cream-soft: #d8c2a5;\n  --gc-line: rgba(248, 238, 223, .14);\n  --gc-serif: \"Palatino Linotype\", Palatino, \"Book Antiqua\", \"Iowan Old Style\", \"URW Palladio L\", P052, Georgia, serif;\n  --gc-sans: \"Segoe UI Variable Text\", \"Segoe UI\", system-ui, -apple-system, \"Helvetica Neue\", Roboto, Arial, sans-serif;\n  --gc-mono: ui-monospace, \"Cascadia Mono\", \"Cascadia Code\", Consolas, \"SF Mono\", Menlo, monospace;\n  --gc-in: cubic-bezier(.16, 1, .3, 1);\n  --gc-out: cubic-bezier(.4, 0, .2, 1);\n  --gc-t-out: 360ms;\n  --gc-ink: var(--ink-cream, #f0e6d2);\n  --gc-lift: translateY(-2px);\n  --gc-press: scale(.98);\n  --gc-lift-shadow: 0 18px 44px rgba(0, 0, 0, .55), 0 0 0 1px rgba(240, 192, 122, .22);\n  --gc-qr: 72px;\n  --gc-qr-zoom: 2.2223;\n  --gc-arm: 9px;\n  display: block; box-sizing: border-box; width: 100%; margin: 0; padding: 0;\n  color: var(--gc-ink); font: 400 10.5px/1.4 var(--gc-sans); text-align: left; -webkit-font-smoothing: antialiased;\n}\n.goat *, .goat *::before, .goat *::after { box-sizing: border-box; }\n\n.goat__copy { display: block; margin: 0 0 8px; padding: 2px 0 1px; }\n.goat__line { display: block; margin: 0; font-size: 10.5px; line-height: 1.4; font-weight: 500; color: var(--gc-ink); text-wrap: pretty; }\n.goat__line em { font: italic 700 1.14em/1 var(--gc-serif); color: var(--gc-gold); letter-spacing: .02em; }\n\n.goat .goat-lockup {\n  position: relative; z-index: 2; display: block; width: 100%; height: var(--gc-h, 136px); margin: 0; padding: 0;\n  border: 1px solid var(--gc-line); border-radius: 10px; background: var(--gc-950);\n  color: var(--gc-cream); line-height: 1; text-decoration: none; cursor: pointer; -webkit-tap-highlight-color: transparent;\n  transition: transform var(--gc-t-out) var(--gc-out), box-shadow var(--gc-t-out) var(--gc-out);\n}\n.goat .goat-lockup:hover { color: var(--gc-cream); text-decoration: none; }\n.goat .goat-lockup:focus-visible { outline: 2px solid var(--gc-gold); outline-offset: 2px; }\n\n.gc-photo {\n  position: absolute; inset: 0; z-index: 0; display: block; overflow: hidden; border-radius: 9px;\n  container-type: size; background: var(--gc-950);\n}\n.gc-photo__frame {\n  position: absolute; left: var(--gc-px, 0%); top: var(--gc-py, 50%); display: block;\n  width: 100%; width: max(100cqw, 100cqh * 800 / 498); aspect-ratio: 800 / 498;\n  translate: calc(var(--gc-px, 0%) * -1) calc(var(--gc-py, 50%) * -1);\n  transform-origin: 30% 55%; transition: transform var(--gc-t-out) var(--gc-out);\n}\n.gc-photo__img {\n  display: block; width: 100%; height: 100%; max-width: none; margin: 0; border: 0;\n  object-fit: cover; user-select: none; -webkit-user-drag: none;\n}\n.gc-photo::after { content: \"\"; position: absolute; inset: 0; pointer-events: none; background: var(--gc-scrim, none); }\n.gc-steam {\n  position: absolute; left: 13%; bottom: 41.5%; width: 7.5%; height: auto; aspect-ratio: 60 / 120;\n  translate: -50% 0; overflow: visible; opacity: 0; filter: blur(.5px);\n  transition: opacity var(--gc-t-out) var(--gc-out);\n}\n.gc-steam path {\n  fill: none; stroke: rgba(255, 247, 236, .9); stroke-width: 6; stroke-linecap: round;\n  stroke-dasharray: 44 100; stroke-dashoffset: 44; animation: gc-steam 3.2s linear infinite paused;\n}\n.gc-steam path:nth-child(2) { animation-duration: 3.7s; animation-delay: -1.3s; }\n.gc-steam path:nth-child(3) { animation-duration: 2.9s; animation-delay: -2.2s; }\n\n.gc-vf {\n  --gc-m: conic-gradient(at var(--gc-arm) var(--gc-arm), #0000 75%, #000 0) 0 0 / calc(100% - var(--gc-arm)) calc(100% - var(--gc-arm));\n  position: absolute; z-index: 1; pointer-events: none;\n  inset: var(--gc-vf-t, 6px) var(--gc-vf-r, 6px) var(--gc-vf-b, 6px) var(--gc-vf-l, 6px);\n  border: 2px solid rgba(248, 238, 223, .62); -webkit-mask: var(--gc-m); mask: var(--gc-m);\n  transition: inset var(--gc-t-out) var(--gc-out);\n}\n.gc-vf::after {\n  content: \"\"; position: absolute; inset: -2px; border: 2px solid var(--gc-gold); opacity: 0;\n  transition: opacity var(--gc-t-out) var(--gc-out);\n}\n\n.gc-osd {\n  position: absolute; z-index: 1; top: 3px; left: calc(var(--gc-vf-l, 6px) + var(--gc-arm) + 4px);\n  display: flex; align-items: center; gap: 3px; margin: 0; padding: 2px 4px; border-radius: 4px;\n  background: rgba(20, 13, 8, .62); color: var(--gc-cream);\n  font: 500 var(--gc-osd-fs, 6.5px)/1 var(--gc-mono); letter-spacing: .05em; font-variant-numeric: tabular-nums; white-space: nowrap;\n}\n.gc-osd__dot { flex: none; width: var(--gc-dot, 5px); height: var(--gc-dot, 5px); border-radius: 50%; background: var(--gc-gold); }\n\n.goat .goat-lockup__word {\n  position: absolute; z-index: 1; left: var(--gc-word-x, 16px); top: var(--gc-word-y, 12px);\n  display: flex; flex-direction: column; align-items: flex-start; gap: var(--gc-word-gap, 5px); pointer-events: none;\n}\n.goat .goat-lockup__word::before {\n  content: \"\"; position: absolute; z-index: -1; inset: -10px -14px;\n  background: radial-gradient(closest-side, rgba(20, 13, 8, .62), rgba(20, 13, 8, .3) 60%, rgba(20, 13, 8, 0));\n}\n.goat .goat-lockup__name { display: block; font: 400 var(--gc-name, 17px)/1 var(--gc-serif); letter-spacing: -.005em; color: var(--gc-cream); white-space: nowrap; }\n.goat .goat-lockup__tag {\n  display: flex; gap: .4em; font: 600 var(--gc-tag, 6.5px)/1.25 var(--gc-sans); letter-spacing: var(--gc-tag-track, .15em);\n  text-transform: uppercase; color: var(--gc-cream-soft); white-space: nowrap; transition: color var(--gc-t-out) var(--gc-out);\n}\n\n.gc-qr {\n  position: absolute; z-index: 3; top: var(--gc-qr-y, auto); right: var(--gc-qr-x, 14px); bottom: var(--gc-qr-b, auto);\n  display: block; width: var(--gc-qr); height: var(--gc-qr); overflow: hidden; border-radius: 6px; background: #fbf5ea;\n  box-shadow: 0 6px 16px -8px rgba(0, 0, 0, .7); transform-origin: var(--gc-qr-origin, 100% 100%);\n  transition: scale 120ms var(--gc-out), box-shadow 120ms var(--gc-out);\n}\n.gc-qr svg { display: block; width: 100%; height: 100%; shape-rendering: crispEdges; }\n.gc-qr:hover, .goat-lockup:focus-visible .gc-qr {\n  scale: var(--gc-qr-zoom);\n  box-shadow: 0 8px 20px -6px rgba(0, 0, 0, .75), 0 0 0 1px rgba(201, 138, 70, .55);\n  transition-duration: 200ms; transition-timing-function: var(--gc-in);\n}\n\n.goat-lockup:is(:hover, :focus-visible, .is-active) .gc-photo__frame { transform: scale(1.06); transition: transform 1200ms var(--gc-in); }\n.goat-lockup:is(:hover, :focus-visible, .is-active) .gc-steam { opacity: 1; transition: opacity 700ms var(--gc-in) 150ms; }\n.goat-lockup:is(:hover, :focus-visible, .is-active) .gc-steam path { animation-play-state: running; }\n.goat-lockup:is(:hover, :focus-visible, .is-active) .gc-vf {\n  inset: calc(var(--gc-vf-t, 6px) + 3px) calc(var(--gc-vf-r, 6px) + 3px) calc(var(--gc-vf-b, 6px) + 3px) calc(var(--gc-vf-l, 6px) + 3px);\n  transition: inset 420ms var(--gc-in);\n}\n.goat-lockup:is(:hover, :focus-visible, .is-active) .gc-vf::after { opacity: 1; transition: opacity 300ms linear 140ms; }\n.goat-lockup:is(:hover, :focus-visible, .is-active) .gc-osd__dot { animation: gc-tally 2.4s .5s ease-in-out infinite; }\n.goat-lockup:is(:hover, :focus-visible, .is-active) .goat-lockup__tag { color: var(--gc-cream); transition-duration: 630ms; }\n\n.goat:not(.goat--gated) .goat-lockup:hover {\n  transform: var(--gc-lift); box-shadow: var(--gc-lift-shadow);\n  transition: transform 420ms var(--gc-in), box-shadow 420ms var(--gc-in);\n}\n.goat:not(.goat--gated) .goat-lockup:active { transform: var(--gc-press); transition-duration: 120ms; }\n\n@keyframes gc-steam { 0% { stroke-dashoffset: 44; opacity: 0; translate: 0 0; } 18% { opacity: .95; } 65% { opacity: .6; } 100% { stroke-dashoffset: -100; opacity: 0; translate: 2px -6px; } }\n@keyframes gc-tally { 0%, 100% { opacity: 1; } 50% { opacity: .3; } }\n\n.goat--panel .goat-lockup { --gc-h: 136px; }\n.goat--panel .gc-photo {\n  --gc-px: 0%; --gc-py: 55%;\n  --gc-scrim: linear-gradient(to bottom, rgba(20, 13, 8, .8), rgba(20, 13, 8, .42) 30%, rgba(20, 13, 8, 0) 52%);\n}\n.goat--panel .gc-qr { --gc-qr-x: 14px; --gc-qr-b: 14px; --gc-qr-origin: 100% 100%; }\n.goat--panel .gc-osd { left: auto; right: calc(var(--gc-vf-r, 6px) + var(--gc-arm) + 4px); }\n.goat--panel .goat-lockup__word { --gc-word-x: 22px; --gc-word-y: 14px; }\n\n.goat--settings .goat-lockup {\n  --gc-h: 150px; --gc-qr: 74px; --gc-qr-zoom: 2.1622; --gc-arm: 11px;\n}\n.goat--settings .gc-photo { --gc-px: 0%; --gc-py: 68%; --gc-scrim: linear-gradient(to left, rgba(20, 13, 8, .55), rgba(20, 13, 8, 0) 30%); }\n.goat--settings .gc-qr { --gc-qr-x: 18px; --gc-qr-y: calc((var(--gc-h) - 2px - var(--gc-qr)) / 2); --gc-qr-origin: 100% 50%; }\n.goat--settings .gc-vf { --gc-vf-t: 7px; --gc-vf-l: 7px; --gc-vf-b: 7px; --gc-vf-r: 7px; }\n.goat--settings .gc-osd { --gc-osd-fs: 7px; --gc-dot: 7px; top: 4px; left: 22px; gap: 4px; padding: 3px 5px; }\n.goat--settings .goat-lockup__word { --gc-word-x: 222px; --gc-word-y: 34px; --gc-name: 30px; --gc-tag: 8.5px; --gc-word-gap: 9px; }\n\n.goat--strip { display: inline-flex; flex-wrap: nowrap; align-items: center; gap: 10px; width: auto; max-width: none; }\n.goat--strip .goat__copy { flex: none; width: 136px; margin: 0; }\n.goat--strip .goat-lockup {\n  flex: none; width: 356px; --gc-h: 76px; --gc-qr-zoom: 1; --gc-arm: 8px;\n  --gc-lift: none;\n}\n.goat--strip .gc-photo { --gc-px: 0%; --gc-py: 70%; }\n.goat--strip .gc-qr { --gc-qr-x: 1px; --gc-qr-y: calc((var(--gc-h) - 2px - var(--gc-qr)) / 2); border-radius: 8px; }\n.goat--strip .gc-vf { --gc-vf-t: 5px; --gc-vf-l: 5px; --gc-vf-b: 5px; --gc-vf-r: 82px; }\n.goat--strip .gc-osd { display: none; }\n.goat--strip .goat-lockup__word { --gc-word-x: 128px; --gc-word-y: 3px; --gc-name: 16px; --gc-tag: 6.5px; --gc-word-gap: 3px; }\n.goat--strip .goat-lockup__tag { flex-direction: column; gap: 1px; }\n.goat--strip .gc-tag__sep { display: none; }\n\n@media (prefers-reduced-motion: reduce) {\n  .gc-steam { display: none; }\n  .gc-qr, .gc-qr:hover, .goat-lockup:focus-visible .gc-qr { transition: none; }\n  .goat-lockup:is(:hover, :focus-visible, .is-active) .gc-photo__frame { transform: none; }\n  .goat-lockup:is(:hover, :focus-visible, .is-active) .gc-vf { inset: var(--gc-vf-t, 6px) var(--gc-vf-r, 6px) var(--gc-vf-b, 6px) var(--gc-vf-l, 6px); }\n  .goat-lockup:is(:hover, :focus-visible, .is-active) .gc-osd__dot { animation: none; }\n  .goat .goat-lockup, .goat:not(.goat--gated) .goat-lockup:hover, .goat:not(.goat--gated) .goat-lockup:active { transform: none; }\n}\n";

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
    '</div>' +
    '<a class="goat-lockup" href="' + GOAT_URL + '" target="_blank" rel="noopener noreferrer" aria-label="GOAT Cam &mdash; open goatcam.dagoat.io" data-goat-mark>' +
    '<span class="gc-photo" aria-hidden="true"><span class="gc-photo__frame">' +
    '<img class="gc-photo__img" src="data:image/webp;base64,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" alt="" width="800" height="498" draggable="false">' +
    '<svg class="gc-steam" viewBox="0 0 60 120" focusable="false"><path pathLength="100" d="M22 118C14 100 30 88 22 70S14 40 24 22"/><path pathLength="100" d="M32 118C40 98 24 84 33 64S42 36 32 14"/><path pathLength="100" d="M42 118C36 102 48 90 41 74S36 50 44 34"/></svg></span></span>' +
    '<span class="gc-vf" aria-hidden="true"></span><span class="gc-osd" aria-hidden="true"><span class="gc-osd__dot"></span>1080p &middot; 60 fps</span>' +
    '<span class="goat-lockup__word"><span class="goat-lockup__name">GOAT Cam</span><span class="goat-lockup__tag"><span class="gc-tag__a">iPhone app</span><span class="gc-tag__sep">&middot;</span><span class="gc-tag__b">On the App Store</span></span></span>' +
    '<span class="gc-qr"><svg viewBox="0 0 37 37" shape-rendering="crispEdges" role="img" aria-label="QR code that opens GOAT Cam on the App Store" xmlns="http://www.w3.org/2000/svg" focusable="false"><rect width="37" height="37" fill="#fbf5ea"/>' +
    '<path fill="#1c130c" d="M4 4h1v1h-1zM5 4h1v1h-1zM6 4h1v1h-1zM7 4h1v1h-1zM8 4h1v1h-1zM9 4h1v1h-1zM10 4h1v1h-1zM12 4h1v1h-1zM13 4h1v1h-1zM17 4h1v1h-1zM20 4h1v1h-1zM22 4h1v1h-1zM24 4h1v1h-1zM26 4h1v1h-1zM27 4h1v1h-1zM28 4h1v1h-1zM29 4h1v1h-1zM30 4h1v1h-1zM31 4h1v1h-1zM32 4h1v1h-1zM4 5h1v1h-1zM10 5h1v1h-1zM12 5h1v1h-1zM14 5h1v1h-1zM16 5h1v1h-1zM18 5h1v1h-1zM21 5h1v1h-1zM23 5h1v1h-1zM26 5h1v1h-1zM32 5h1v1h-1zM4 6h1v1h-1zM6 6h1v1h-1zM7 6h1v1h-1zM8 6h1v1h-1zM10 6h1v1h-1zM12 6h1v1h-1zM17 6h1v1h-1zM18 6h1v1h-1zM19 6h1v1h-1zM20 6h1v1h-1zM23 6h1v1h-1zM24 6h1v1h-1zM26 6h1v1h-1zM28 6h1v1h-1zM29 6h1v1h-1zM30 6h1v1h-1zM32 6h1v1h-1zM4 7h1v1h-1zM6 7h1v1h-1zM7 7h1v1h-1zM8 7h1v1h-1zM10 7h1v1h-1zM14 7h1v1h-1zM16 7h1v1h-1zM17 7h1v1h-1zM18 7h1v1h-1zM19 7h1v1h-1zM21 7h1v1h-1zM23 7h1v1h-1zM24 7h1v1h-1zM26 7h1v1h-1zM28 7h1v1h-1zM29 7h1v1h-1zM30 7h1v1h-1zM32 7h1v1h-1zM4 8h1v1h-1zM6 8h1v1h-1zM7 8h1v1h-1zM8 8h1v1h-1zM10 8h1v1h-1zM12 8h1v1h-1zM15 8h1v1h-1zM21 8h1v1h-1zM22 8h1v1h-1zM23 8h1v1h-1zM26 8h1v1h-1zM28 8h1v1h-1zM29 8h1v1h-1zM30 8h1v1h-1zM32 8h1v1h-1zM4 9h1v1h-1zM10 9h1v1h-1zM13 9h1v1h-1zM14 9h1v1h-1zM15 9h1v1h-1zM20 9h1v1h-1zM21 9h1v1h-1zM22 9h1v1h-1zM24 9h1v1h-1zM26 9h1v1h-1zM32 9h1v1h-1zM4 10h1v1h-1zM5 10h1v1h-1zM6 10h1v1h-1zM7 10h1v1h-1zM8 10h1v1h-1zM9 10h1v1h-1zM10 10h1v1h-1zM12 10h1v1h-1zM14 10h1v1h-1zM16 10h1v1h-1zM18 10h1v1h-1zM20 10h1v1h-1zM22 10h1v1h-1zM24 10h1v1h-1zM26 10h1v1h-1zM27 10h1v1h-1zM28 10h1v1h-1zM29 10h1v1h-1zM30 10h1v1h-1zM31 10h1v1h-1zM32 10h1v1h-1zM13 11h1v1h-1zM16 11h1v1h-1zM17 11h1v1h-1zM19 11h1v1h-1zM20 11h1v1h-1zM4 12h1v1h-1zM7 12h1v1h-1zM8 12h1v1h-1zM9 12h1v1h-1zM10 12h1v1h-1zM11 12h1v1h-1zM12 12h1v1h-1zM13 12h1v1h-1zM14 12h1v1h-1zM15 12h1v1h-1zM16 12h1v1h-1zM19 12h1v1h-1zM21 12h1v1h-1zM25 12h1v1h-1zM28 12h1v1h-1zM30 12h1v1h-1zM31 12h1v1h-1zM32 12h1v1h-1zM5 13h1v1h-1zM7 13h1v1h-1zM8 13h1v1h-1zM9 13h1v1h-1zM12 13h1v1h-1zM15 13h1v1h-1zM16 13h1v1h-1zM19 13h1v1h-1zM20 13h1v1h-1zM23 13h1v1h-1zM28 13h1v1h-1zM30 13h1v1h-1zM31 13h1v1h-1zM5 14h1v1h-1zM6 14h1v1h-1zM7 14h1v1h-1zM9 14h1v1h-1zM10 14h1v1h-1zM15 14h1v1h-1zM17 14h1v1h-1zM19 14h1v1h-1zM21 14h1v1h-1zM22 14h1v1h-1zM26 14h1v1h-1zM30 14h1v1h-1zM4 15h1v1h-1zM5 15h1v1h-1zM6 15h1v1h-1zM7 15h1v1h-1zM8 15h1v1h-1zM9 15h1v1h-1zM11 15h1v1h-1zM13 15h1v1h-1zM14 15h1v1h-1zM19 15h1v1h-1zM20 15h1v1h-1zM21 15h1v1h-1zM22 15h1v1h-1zM23 15h1v1h-1zM27 15h1v1h-1zM28 15h1v1h-1zM29 15h1v1h-1zM32 15h1v1h-1zM4 16h1v1h-1zM6 16h1v1h-1zM7 16h1v1h-1zM10 16h1v1h-1zM11 16h1v1h-1zM13 16h1v1h-1zM15 16h1v1h-1zM16 16h1v1h-1zM17 16h1v1h-1zM18 16h1v1h-1zM19 16h1v1h-1zM23 16h1v1h-1zM24 16h1v1h-1zM26 16h1v1h-1zM32 16h1v1h-1zM8 17h1v1h-1zM11 17h1v1h-1zM13 17h1v1h-1zM14 17h1v1h-1zM18 17h1v1h-1zM19 17h1v1h-1zM26 17h1v1h-1zM27 17h1v1h-1zM28 17h1v1h-1zM29 17h1v1h-1zM30 17h1v1h-1zM31 17h1v1h-1zM32 17h1v1h-1zM4 18h1v1h-1zM5 18h1v1h-1zM6 18h1v1h-1zM7 18h1v1h-1zM8 18h1v1h-1zM9 18h1v1h-1zM10 18h1v1h-1zM13 18h1v1h-1zM14 18h1v1h-1zM16 18h1v1h-1zM18 18h1v1h-1zM19 18h1v1h-1zM20 18h1v1h-1zM22 18h1v1h-1zM23 18h1v1h-1zM25 18h1v1h-1zM26 18h1v1h-1zM28 18h1v1h-1zM30 18h1v1h-1zM32 18h1v1h-1zM4 19h1v1h-1zM7 19h1v1h-1zM12 19h1v1h-1zM13 19h1v1h-1zM16 19h1v1h-1zM17 19h1v1h-1zM18 19h1v1h-1zM19 19h1v1h-1zM22 19h1v1h-1zM23 19h1v1h-1zM25 19h1v1h-1zM26 19h1v1h-1zM28 19h1v1h-1zM30 19h1v1h-1zM32 19h1v1h-1zM7 20h1v1h-1zM8 20h1v1h-1zM10 20h1v1h-1zM11 20h1v1h-1zM12 20h1v1h-1zM13 20h1v1h-1zM14 20h1v1h-1zM16 20h1v1h-1zM19 20h1v1h-1zM20 20h1v1h-1zM22 20h1v1h-1zM23 20h1v1h-1zM24 20h1v1h-1zM29 20h1v1h-1zM4 21h1v1h-1zM5 21h1v1h-1zM7 21h1v1h-1zM8 21h1v1h-1zM9 21h1v1h-1zM11 21h1v1h-1zM13 21h1v1h-1zM16 21h1v1h-1zM19 21h1v1h-1zM20 21h1v1h-1zM22 21h1v1h-1zM23 21h1v1h-1zM25 21h1v1h-1zM28 21h1v1h-1zM30 21h1v1h-1zM31 21h1v1h-1zM4 22h1v1h-1zM5 22h1v1h-1zM6 22h1v1h-1zM10 22h1v1h-1zM11 22h1v1h-1zM12 22h1v1h-1zM13 22h1v1h-1zM14 22h1v1h-1zM15 22h1v1h-1zM16 22h1v1h-1zM17 22h1v1h-1zM18 22h1v1h-1zM19 22h1v1h-1zM23 22h1v1h-1zM25 22h1v1h-1zM26 22h1v1h-1zM27 22h1v1h-1zM28 22h1v1h-1zM29 22h1v1h-1zM32 22h1v1h-1zM4 23h1v1h-1zM5 23h1v1h-1zM6 23h1v1h-1zM7 23h1v1h-1zM9 23h1v1h-1zM14 23h1v1h-1zM15 23h1v1h-1zM16 23h1v1h-1zM17 23h1v1h-1zM23 23h1v1h-1zM28 23h1v1h-1zM29 23h1v1h-1zM30 23h1v1h-1zM4 24h1v1h-1zM5 24h1v1h-1zM6 24h1v1h-1zM9 24h1v1h-1zM10 24h1v1h-1zM12 24h1v1h-1zM13 24h1v1h-1zM15 24h1v1h-1zM17 24h1v1h-1zM19 24h1v1h-1zM21 24h1v1h-1zM23 24h1v1h-1zM24 24h1v1h-1zM25 24h1v1h-1zM26 24h1v1h-1zM27 24h1v1h-1zM28 24h1v1h-1zM29 24h1v1h-1zM30 24h1v1h-1zM31 24h1v1h-1zM12 25h1v1h-1zM17 25h1v1h-1zM19 25h1v1h-1zM20 25h1v1h-1zM21 25h1v1h-1zM22 25h1v1h-1zM24 25h1v1h-1zM28 25h1v1h-1zM29 25h1v1h-1zM4 26h1v1h-1zM5 26h1v1h-1zM6 26h1v1h-1zM7 26h1v1h-1zM8 26h1v1h-1zM9 26h1v1h-1zM10 26h1v1h-1zM12 26h1v1h-1zM14 26h1v1h-1zM16 26h1v1h-1zM17 26h1v1h-1zM19 26h1v1h-1zM21 26h1v1h-1zM22 26h1v1h-1zM23 26h1v1h-1zM24 26h1v1h-1zM26 26h1v1h-1zM28 26h1v1h-1zM29 26h1v1h-1zM4 27h1v1h-1zM10 27h1v1h-1zM12 27h1v1h-1zM14 27h1v1h-1zM16 27h1v1h-1zM17 27h1v1h-1zM20 27h1v1h-1zM21 27h1v1h-1zM23 27h1v1h-1zM24 27h1v1h-1zM28 27h1v1h-1zM31 27h1v1h-1zM4 28h1v1h-1zM6 28h1v1h-1zM7 28h1v1h-1zM8 28h1v1h-1zM10 28h1v1h-1zM12 28h1v1h-1zM13 28h1v1h-1zM14 28h1v1h-1zM17 28h1v1h-1zM23 28h1v1h-1zM24 28h1v1h-1zM25 28h1v1h-1zM26 28h1v1h-1zM27 28h1v1h-1zM28 28h1v1h-1zM29 28h1v1h-1zM32 28h1v1h-1zM4 29h1v1h-1zM6 29h1v1h-1zM7 29h1v1h-1zM8 29h1v1h-1zM10 29h1v1h-1zM12 29h1v1h-1zM13 29h1v1h-1zM16 29h1v1h-1zM18 29h1v1h-1zM19 29h1v1h-1zM22 29h1v1h-1zM23 29h1v1h-1zM24 29h1v1h-1zM25 29h1v1h-1zM27 29h1v1h-1zM32 29h1v1h-1zM4 30h1v1h-1zM6 30h1v1h-1zM7 30h1v1h-1zM8 30h1v1h-1zM10 30h1v1h-1zM14 30h1v1h-1zM16 30h1v1h-1zM18 30h1v1h-1zM19 30h1v1h-1zM20 30h1v1h-1zM24 30h1v1h-1zM27 30h1v1h-1zM28 30h1v1h-1zM30 30h1v1h-1zM31 30h1v1h-1zM32 30h1v1h-1zM4 31h1v1h-1zM10 31h1v1h-1zM13 31h1v1h-1zM14 31h1v1h-1zM17 31h1v1h-1zM18 31h1v1h-1zM19 31h1v1h-1zM22 31h1v1h-1zM26 31h1v1h-1zM27 31h1v1h-1zM28 31h1v1h-1zM29 31h1v1h-1zM30 31h1v1h-1zM32 31h1v1h-1zM4 32h1v1h-1zM5 32h1v1h-1zM6 32h1v1h-1zM7 32h1v1h-1zM8 32h1v1h-1zM9 32h1v1h-1zM10 32h1v1h-1zM12 32h1v1h-1zM13 32h1v1h-1zM15 32h1v1h-1zM18 32h1v1h-1zM19 32h1v1h-1zM20 32h1v1h-1zM22 32h1v1h-1zM23 32h1v1h-1zM24 32h1v1h-1zM25 32h1v1h-1zM27 32h1v1h-1zM28 32h1v1h-1z"/>' +
    '</svg></span>' +
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
