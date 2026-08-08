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
}
.pill:focus-visible { outline: 2px solid var(--accent); outline-offset: -3px; border-radius: var(--glass-radius); }

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
.row, .kofi, .gh {
  opacity: 0;
  transform: translateY(-6px);
  transition: opacity var(--dur-fast) var(--ease), transform var(--dur-base) var(--ease),
              box-shadow var(--dur-base) var(--ease), background var(--dur-fast) var(--ease);
}
.shell.is-open .row,
.shell.is-open .kofi,
.shell.is-open .gh { opacity: 1; transform: none; }
/* Keyed by data-row, not :nth-of-type -- the rows share a parent with a rule
   and two paragraphs, so type counting would silently address the wrong ones. */
.shell.is-open .row[data-row="enabled"]    { transition-delay: 60ms; }
.shell.is-open .row[data-row="darkMap"]    { transition-delay: 110ms; }
.shell.is-open .row[data-row="darkChrome"] { transition-delay: 160ms; }
.shell.is-open .kofi { transition-delay: 210ms; }
.shell.is-open .gh   { transition-delay: 250ms; }

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
  transition: background var(--dur-base) var(--ease), box-shadow var(--dur-base) var(--ease);
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
   and the lift would be a coin flip. */
.shell.is-open .kofi:hover,
.shell.is-open .gh:hover { transform: scale(1.05); }
.shell.is-open .kofi:active,
.shell.is-open .gh:active { transform: scale(0.96); }

/* The entry stagger above parks a 210ms/250ms transition-delay on these two
   buttons, and a delay set in one rule keeps applying in every other state.
   Hovering therefore sat still for a fifth of a second before the scale began,
   which reads as "the button does not animate" -- and it is invisible to any
   assertion that only samples the final transform. Clear it for the pointer
   states so the lift starts on the same frame as the pointer arrives. */
.shell.is-open .kofi:hover, .shell.is-open .kofi:active,
.shell.is-open .gh:hover,   .shell.is-open .gh:active { transition-delay: 0s; }

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

/* The GitHub button is the last thing in the panel; nothing follows it, so it
   carries the closing margin itself. */
.gh { margin-bottom: 2px; }

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
  .shell, .shell:hover, .body, .row, .kofi, .gh, .moon, .chev, .thumb, .track {
    transition: none !important;
    transform: none !important;
  }
  .kofi:hover .steam, .kofi:focus-visible .steam, .kofi:hover .cup__body { animation: none !important; }
  .gh__sweep, .gh__bar, .gh__star svg, .gh__glow { animation: none !important; }
  .gh:hover .gh__star, .gh:hover .gh__label { transform: none !important; }
  /* Without the rise animation the rows still need to be visible when open. */
  .shell.is-open .row, .shell.is-open .kofi, .shell.is-open .gh { opacity: 1; }
}
`;

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
    style.textContent = CSS;
    const wrap = doc.createElement('div');
    wrap.innerHTML = HTML;
    shadow.appendChild(style);
    shadow.appendChild(wrap.firstChild);

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
