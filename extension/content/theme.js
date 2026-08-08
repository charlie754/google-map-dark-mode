/*
 * Google Map Dark Mode -- app-chrome dark theme, runtime layer.
 *
 * WHAT THIS DOES
 * --------------
 * Google Maps' web app is built on Material 3 design tokens exposed as CSS
 * custom properties on `:root` -- ~386 of them, ~215 colour-valued. Nearly all
 * are hash-named (`--t5b35d265ba7ac78d`) and the hashes change on every Google
 * rebuild, so this file never mentions a token name. It enumerates them at
 * runtime, works out which ones resolve to real colours, computes a dark
 * counterpart in OKLCH, and writes the result back onto `:root` as an
 * `!important` inline custom property. Overriding the tokens re-themes the side
 * panel, search box, chips, cards and buttons in one shot.
 *
 * WHAT THIS DOES NOT DO
 * ---------------------
 *   - No `filter: invert()`, no `hue-rotate`, no blend modes. Photographs,
 *     Street View, satellite imagery, place photos and avatars are never
 *     touched: this file only ever writes CSS custom properties and two
 *     attributes on <html>.
 *   - No Google class or id selectors. They are obfuscated and rotate.
 *   - Nothing that reaches the map canvas. The map surface is made dark by the
 *     tile-style network rewrite; re-styling it here would be a regression.
 *
 * WHEN IT DOES IT
 * ---------------
 * Only when `storage.local.settings` says `enabled && darkChrome`, and it
 * follows that record live: turning the switch off reverts an open Maps tab
 * without a reload, turning it back on re-derives the whole token set. Section
 * 10 carries the ordering argument for the window between the static CSS layer
 * painting and the asynchronous settings read answering.
 *
 * SHAPE
 * -----
 *   OKLab/OKLCH maths -> colour parsing -> token resolution (probe elements)
 *   -> transform -> value-keyed exception table -> apply -> scheduling ->
 *   control surface -> settings.
 *
 * Runs in the isolated world at document_start. No page-world injection, no
 * dependencies, no build step.
 */

(() => {
  'use strict';

  const doc = document;
  const root = doc.documentElement;
  if (!root || root.__mapsNoirThemeLoaded) return;
  root.__mapsNoirThemeLoaded = true;

  /* =====================================================================
   * 1. Tunables
   * ===================================================================== */

  /*
   * Neutral ramp. A light-theme colour with OKLab lightness L becomes
   *
   *     L' = L_HI - (L_HI - L_LO) * L ** GAMMA
   *
   * A plain `1 - L` inversion sends white to pure black and leaves mid greys
   * where they are, which is what makes naive dark modes look bruised and
   * makes secondary text fail contrast. GAMMA > 1 bends the curve so the dark
   * end of the light palette (text) lands high and the light end (surfaces)
   * lands in a narrow dark band, preserving Material's elevation ordering:
   * in a light theme `surface` is the lightest colour and containers are
   * darker; reversed, `surface` becomes the darkest and containers sit above
   * it, exactly as Material's own dark scheme is built.
   *
   * Measured against the live token set these constants give:
   *   #ffffff -> #181818   surface
   *   #f2f2f2 -> #232323   container
   *   #e3e3e3 -> #303030   outline
   *   #1f1f1f -> #e0e0e0   body text        (12.6:1 on the new surface)
   *   #5e5e5e -> #b1b1b1   secondary text   ( 7.7:1 on the new surface)
   */
  const L_HI = 0.95;
  const L_LO = 0.21;
  const GAMMA = 1.9;

  /* Below this OKLCH chroma a colour counts as neutral and rides the ramp
   * above. Maps' greys measure C < 0.015; its palest tinted containers
   * measure C ~ 0.04, so the boundary is comfortably clear of both. */
  const NEUTRAL_CHROMA = 0.035;

  /* A colour that is both light and saturated (a rating star, a warning
   * marker) is meant to be looked at, not to be a surface. It already reads
   * on a dark background, so it is left alone rather than darkened. */
  const VIVID_L = 0.78;
  const VIVID_C = 0.11;

  /* Below this lightness a chromatic colour is a light-theme "on-container"
   * foreground -- dark teal text on a pale teal chip. It has to become light. */
  const DEEP_L = 0.38;

  /* Bounded retry ladder, in ms after the script starts. Maps lazy-loads CSS
   * modules after first paint, so a single pass at load misses tokens. */
  const RETRY_DELAYS = [0, 120, 400, 900, 1800, 3500, 6000, 10000];

  /* Stop the ladder once this many consecutive passes find no new tokens. */
  const NO_GROWTH_STOP = 3;

  /*
   * Ceiling on CONSECUTIVE UNPRODUCTIVE passes, so a pathological mutation
   * storm on <head> cannot turn the observer into an unbounded loop.
   *
   * This counter is deliberately NOT a lifetime budget. It was one until
   * finding F6: `stats.passes >= MAX_PASSES` is a total-passes cap whose only
   * reset lived in `redo()`, which nothing reachable called, so a long-lived
   * tab that kept legitimately gaining tokens (every place card opens a CSS
   * module) would eventually spend the budget on productive work and then stop
   * theming for the rest of its life. A pass that writes tokens now resets it,
   * exactly as the no-growth logic below already does.
   *
   * Reaching the cap therefore needs 60 consecutive passes that found nothing
   * to write. With the 150 ms trailing debounce that is at least ~9 s of
   * continuous <head> churn yielding no new tokens, at which point giving up is
   * the correct answer rather than a lost feature.
   */
  const MAX_UNPRODUCTIVE_PASSES = 60;

  /* Debounce for <head> mutations. */
  const MUTATION_DEBOUNCE_MS = 150;

  /*
   * Minimum number of opaque, colour-valued tokens the already-dark guard needs
   * before it is allowed to reach a verdict. Shared with `paletteDarkness` so
   * the "is there enough evidence" question is asked in exactly one place.
   *
   * Load-bearing (finding F2). The guard latches on its first verdict, and the
   * ladder's early passes see a partial token set: Maps' first stylesheet can
   * land a handful of dark-ish tokens before the surface palette arrives.
   * Letting a verdict be reached on that partial set would let a mid-ladder
   * fragment trip the ratio test and silently disable the whole theme.
   */
  const GUARD_MIN_EVIDENCE = 20;

  /*
   * Value-keyed exception table, applied AFTER the algorithmic pass.
   *
   * Keyed by the *resolved light colour*, lower-case `#rrggbb`, never by token
   * name -- names are hashes and rotate, values do not. Alpha is preserved
   * from the original token, so a brand colour used at 8% as a state layer
   * gets the same replacement at 8%.
   *
   * Each entry exists because the algorithm gets that specific colour wrong:
   * brand hues the maths would drift, semantic colours whose Material dark
   * counterpart is already published, and vivid colours that must not be
   * darkened at all (mapped to themselves, so the intent is explicit rather
   * than implied by a threshold).
   */
  const EXCEPTIONS = new Map([
    // Google brand blue and its Material dark-scheme counterparts. Google's
    // own dark surfaces use these; the algorithm would drift the hue violet.
    ['#0b57d0', '#a8c7fa'],
    ['#1a73e8', '#8ab4f8'],
    ['#4285f4', '#8ab4f8'],
    ['#1967d2', '#a8c7fa'],
    ['#174ea6', '#a8c7fa'],
    ['#345bf1', '#aec6ff'], // "Ask Maps" / Gemini blue

    // Reds. Material 3 publishes #f2b8b5 / #ffb4ab for dark error roles.
    ['#b3261e', '#f2b8b5'],
    ['#d32f28', '#ffb4ab'],
    ['#ea4335', '#f28b82'],
    ['#d93025', '#f28b82'],
    ['#c5221f', '#f28b82'],

    // Greens.
    ['#34a853', '#81c995'],
    ['#188038', '#81c995'],
    ['#137333', '#81c995'],
    ['#0f9d58', '#81c995'],

    // Ambers and golds. #ffbb29 is the review-star fill: darkening it turns
    // five gold stars into five brown smudges, which is very visible.
    ['#ffbb29', '#ffbb29'],
    ['#fbbc04', '#fbbc04'],
    ['#f9ab00', '#fdd663'],
    ['#e8710a', '#fbad63'],

    // POI category hues, kept recognisable rather than re-derived.
    ['#c54105', '#ffb59a'], // orange
    ['#d01884', '#ff9ecb'], // magenta
  ]);

  /* =====================================================================
   * 2. Colour maths (OKLab / OKLCH, Bjorn Ottosson's coefficients)
   * ===================================================================== */

  const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);

  const srgbToLinear = (c) =>
    c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);

  const linearToSrgb = (c) =>
    c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;

  /** sRGB (0..1) -> OKLab. */
  function rgbToOklab(r, g, b) {
    const R = srgbToLinear(r);
    const G = srgbToLinear(g);
    const B = srgbToLinear(b);
    const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
    const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
    const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
    return [
      0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
      1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
      0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
    ];
  }

  /** OKLab -> sRGB (0..1), unclamped so gamut can be tested. */
  function oklabToRgb(L, A, B) {
    const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
    const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
    const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
    return [
      linearToSrgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
      linearToSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
      linearToSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
    ];
  }

  const EPS = 1e-4;
  const inGamut = (c) =>
    c[0] >= -EPS && c[0] <= 1 + EPS &&
    c[1] >= -EPS && c[1] <= 1 + EPS &&
    c[2] >= -EPS && c[2] <= 1 + EPS;

  /**
   * OKLCH -> sRGB, reducing chroma until the colour fits in sRGB. Holding
   * lightness and hue fixed and giving up chroma is what keeps an out-of-gamut
   * accent the same colour instead of letting a naive clamp shift its hue.
   */
  function oklchToRgb(L, C, hRad) {
    const cos = Math.cos(hRad);
    const sin = Math.sin(hRad);
    let candidate = oklabToRgb(L, C * cos, C * sin);
    if (inGamut(candidate)) return candidate.map(clamp01);
    let lo = 0;
    let hi = C;
    let best = oklabToRgb(L, 0, 0);
    for (let i = 0; i < 18; i++) {
      const mid = (lo + hi) / 2;
      candidate = oklabToRgb(L, mid * cos, mid * sin);
      if (inGamut(candidate)) {
        lo = mid;
        best = candidate;
      } else {
        hi = mid;
      }
    }
    return best.map(clamp01);
  }

  /* =====================================================================
   * 3. Colour parsing / formatting
   * ===================================================================== */

  const HEX_RE = /^#([0-9a-f]{3,8})$/i;
  const FN_RE = /^(rgba?|hsla?|color)\(([^)]*)\)$/i;

  /**
   * Parse a computed CSS colour into {r,g,b,a} with channels in 0..1.
   * Chrome serialises computed `color` as `rgb()`, `rgba()` or
   * `color(srgb ...)`; the rest is defensive against future serialisations.
   * Returns null for anything that is not a resolvable colour.
   */
  function parseColour(str) {
    if (!str) return null;
    const s = str.trim().toLowerCase();
    if (s === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };

    const hex = HEX_RE.exec(s);
    if (hex) {
      const h = hex[1];
      const x = (i, n) => parseInt(n === 1 ? h[i] + h[i] : h.slice(i * 2, i * 2 + 2), 16) / 255;
      if (h.length === 3 || h.length === 4) {
        return { r: x(0, 1), g: x(1, 1), b: x(2, 1), a: h.length === 4 ? x(3, 1) : 1 };
      }
      if (h.length === 6 || h.length === 8) {
        return { r: x(0, 2), g: x(1, 2), b: x(2, 2), a: h.length === 8 ? x(3, 2) : 1 };
      }
      return null;
    }

    const fn = FN_RE.exec(s);
    if (!fn) return null;
    const name = fn[1];
    const parts = fn[2].replace(/\//g, ' / ').split(/[\s,]+/).filter(Boolean);

    let alphaIdx = parts.indexOf('/');
    let alpha = 1;
    if (alphaIdx >= 0) {
      alpha = numberOrPercent(parts[alphaIdx + 1], 1);
      parts.splice(alphaIdx, 2);
    }

    if (name === 'color') {
      // color(<space> r g b [/ a]) -- only sRGB-family spaces are handled;
      // anything else is left to the caller to skip.
      const space = parts.shift();
      if (space !== 'srgb' && space !== 'srgb-linear') return null;
      if (parts.length < 3) return null;
      let r = numberOrPercent(parts[0], 1);
      let g = numberOrPercent(parts[1], 1);
      let b = numberOrPercent(parts[2], 1);
      if (parts.length > 3 && alphaIdx < 0) alpha = numberOrPercent(parts[3], 1);
      if (space === 'srgb-linear') {
        r = linearToSrgb(r);
        g = linearToSrgb(g);
        b = linearToSrgb(b);
      }
      return { r: clamp01(r), g: clamp01(g), b: clamp01(b), a: clamp01(alpha) };
    }

    if (name === 'rgb' || name === 'rgba') {
      if (parts.length < 3) return null;
      if (parts.length > 3 && alphaIdx < 0) alpha = numberOrPercent(parts[3], 1);
      return {
        r: clamp01(numberOrPercent(parts[0], 255)),
        g: clamp01(numberOrPercent(parts[1], 255)),
        b: clamp01(numberOrPercent(parts[2], 255)),
        a: clamp01(alpha),
      };
    }

    if (name === 'hsl' || name === 'hsla') {
      if (parts.length < 3) return null;
      if (parts.length > 3 && alphaIdx < 0) alpha = numberOrPercent(parts[3], 1);
      const rgb = hslToRgb(
        parseFloat(parts[0]) || 0,
        (parseFloat(parts[1]) || 0) / 100,
        (parseFloat(parts[2]) || 0) / 100
      );
      return { r: rgb[0], g: rgb[1], b: rgb[2], a: clamp01(alpha) };
    }

    return null;
  }

  /** "50%" -> 0.5 when scale is 1; "128" -> 128/255 when scale is 255. */
  function numberOrPercent(token, scale) {
    if (token === undefined) return 1;
    if (token === 'none') return 0;
    if (token.endsWith('%')) return parseFloat(token) / 100;
    const n = parseFloat(token);
    return Number.isNaN(n) ? 0 : n / scale;
  }

  function hslToRgb(h, s, l) {
    const k = (n) => (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const f = (n) => clamp01(l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1))));
    return [f(0), f(8), f(4)];
  }

  const to255 = (x) => Math.max(0, Math.min(255, Math.round(x * 255)));

  const toHex = (c) =>
    '#' +
    [to255(c.r), to255(c.g), to255(c.b)]
      .map((v) => v.toString(16).padStart(2, '0'))
      .join('');

  /** Serialise back to CSS. Legacy rgb()/rgba() for maximum compatibility. */
  function formatColour(c) {
    const r = to255(c.r);
    const g = to255(c.g);
    const b = to255(c.b);
    if (c.a >= 0.999) return `rgb(${r}, ${g}, ${b})`;
    return `rgba(${r}, ${g}, ${b}, ${Math.round(c.a * 1000) / 1000})`;
  }

  /* =====================================================================
   * 4. The transform
   * ===================================================================== */

  /**
   * Light colour -> dark counterpart, in OKLCH so hue survives and lightness
   * is controllable. Pure function: the same input always yields the same
   * output, which is half of what makes the pass idempotent (the other half is
   * never feeding an already-converted value back in).
   *
   * @param {{r:number,g:number,b:number,a:number}} c
   * @returns {{colour:{r:number,g:number,b:number,a:number}, reason:string}}
   */
  function darken(c) {
    // Fully transparent: nothing to see, and rewriting it only bloats the
    // inline style.
    if (c.a <= 0.001) return { colour: c, reason: 'transparent' };

    const hexKey = toHex(c);

    // Value-keyed exceptions win over the algorithm. Alpha is carried across.
    const override = EXCEPTIONS.get(hexKey);
    if (override) {
      const o = parseColour(override);
      if (o) return { colour: { r: o.r, g: o.g, b: o.b, a: c.a }, reason: 'exception' };
    }

    // Translucent pure black is a shadow, a scrim or a media wash -- never a
    // surface. Inverting it to translucent white is the classic and very
    // visible dark-mode failure, so it is left exactly as it is.
    if (c.a < 0.999 && hexKey === '#000000') {
      return { colour: c, reason: 'translucent-black' };
    }

    // Translucent pure white is the mirror case: a highlight or a wash that
    // sits over imagery or over a permanently dark control. Turning it into
    // translucent black would darken photographs.
    if (c.a < 0.999 && hexKey === '#ffffff') {
      return { colour: c, reason: 'translucent-white' };
    }

    const [L, A, B] = rgbToOklab(c.r, c.g, c.b);
    const C = Math.hypot(A, B);
    const h = Math.atan2(B, A);

    let nL;
    let nC;
    let reason;

    if (C < NEUTRAL_CHROMA) {
      // Greys and near-greys: the ramp.
      nL = L_HI - (L_HI - L_LO) * Math.pow(L, GAMMA);
      nC = C;
      reason = 'neutral';
    } else if (L >= VIVID_L && C >= VIVID_C) {
      // Light and saturated: a rating star, a warning marker. Already legible
      // on a dark background; leave it alone.
      nL = L;
      nC = C;
      reason = 'vivid-keep';
    } else if (L >= VIVID_L) {
      // A pale tinted container (a chip fill, a highlighted row). Becomes a
      // dark tinted container: same hue, deep, with the tint kept subtle so it
      // does not compete with real accents.
      nL = 0.2 + (1 - L) * 0.55;
      nC = Math.min(C * 1.1, 0.075);
      reason = 'tinted-surface';
    } else if (L <= DEEP_L) {
      // A dark chromatic foreground -- dark teal text on a pale teal chip.
      // Its container just became dark, so it has to become light.
      nL = 0.86 - (DEEP_L - L) * 0.25;
      nC = Math.min(C, 0.11);
      reason = 'deep-accent';
    } else {
      // Mid-lightness accent: the primary colour, links, active icons. Keep
      // the hue, lift lightness into the band that reads on dark. This mirrors
      // Material's own light-40 -> dark-80 tone shift.
      nL = 0.74 + (L - DEEP_L) * 0.15;
      nC = Math.min(C, 0.13);
      reason = 'accent';
    }

    const [r, g, b] = oklchToRgb(nL, nC, h);
    return { colour: { r, g, b, a: c.a }, reason };
  }

  /* =====================================================================
   * 5. Token discovery and resolution
   * ===================================================================== */

  const OURS = '__mapsNoirProbe';

  /** Marked so the <head>/<html> observer never reacts to our own DOM. */
  function isOurs(node) {
    return !!(node && node.nodeType === 1 && node[OURS]);
  }

  let probeA = null;
  let probeB = null;

  function probeContainers() {
    if (probeA && probeA.isConnected && probeB && probeB.isConnected) {
      return [probeA, probeB];
    }
    const make = (colour) => {
      const el = doc.createElement('div');
      el[OURS] = true;
      el.setAttribute('aria-hidden', 'true');
      // display:none still resolves inherited/computed colour, and costs no
      // layout. The explicit colour is the sentinel (see resolveTokens).
      el.style.cssText = 'display:none !important;color:' + colour;
      root.appendChild(el);
      return el;
    };
    probeA = make('rgb(1, 2, 3)');
    probeB = make('rgb(254, 253, 252)');
    return [probeA, probeB];
  }

  /** Every `--*` custom property currently visible on :root. */
  function customPropertyNames() {
    const cs = getComputedStyle(root);
    const names = [];
    for (let i = 0; i < cs.length; i++) {
      const n = cs.item(i);
      if (n.charCodeAt(0) === 45 && n.charCodeAt(1) === 45) names.push(n);
    }
    return names;
  }

  /**
   * Resolve token names to concrete colours.
   *
   * A custom property's computed value can be anything -- `8px`, `1.5`, a
   * `var()` chain, a gradient fragment. The only reliable way to know whether
   * it resolves to a colour is to make the engine resolve it. Two probe
   * subtrees inherit two different colours; each gets a child with
   * `color: var(--token)`. If the token is a real colour both children compute
   * the same value; if it is not, `color` is invalid at computed-value time,
   * each child falls back to its own inherited colour, and the two disagree.
   *
   * This also gives full `var()` chain resolution for free, which matters
   * because Maps' ~30 readable-named tokens are aliases of the hashed ones.
   *
   * @param {string[]} names
   * @returns {Map<string, string>} name -> computed colour string
   */
  function resolveTokens(names) {
    const out = new Map();
    if (names.length === 0) return out;

    const [a, b] = probeContainers();
    const sa = [];
    const sb = [];
    for (const name of names) {
      const x = doc.createElement('span');
      x[OURS] = true;
      x.style.color = 'var(' + name + ')';
      a.appendChild(x);
      sa.push(x);

      const y = doc.createElement('span');
      y[OURS] = true;
      y.style.color = 'var(' + name + ')';
      b.appendChild(y);
      sb.push(y);
    }

    // Reads happen after all writes, so the engine recalculates style once.
    for (let i = 0; i < names.length; i++) {
      const ca = getComputedStyle(sa[i]).color;
      const cb = getComputedStyle(sb[i]).color;
      if (ca && ca === cb) out.set(names[i], ca);
    }

    a.textContent = '';
    b.textContent = '';
    return out;
  }

  /* =====================================================================
   * 6. State and the pass itself
   * ===================================================================== */

  /** name -> { light: string, dark: string } for everything we have written. */
  const applied = new Map();

  /**
   * name -> the value it resolves to, for tokens that are aliases of something
   * we have already overridden (finding F4). They are deliberately never
   * written: they already resolve, through `var()`, to our dark value.
   */
  const aliased = new Map();

  /**
   * name -> transform reason, for every token that resolved to a colour,
   * whether or not it was written. Keyed per name rather than counted per
   * pass, because non-colour and left-alone tokens are re-probed on every
   * pass and a per-pass counter would inflate with every re-run.
   */
  const decided = new Map();

  /** Names seen that do not resolve to a colour at all. */
  const nonColour = new Set();

  /** One entry per pass: what it saw and what it changed. */
  const passLog = [];

  const stats = {
    passes: 0,
    tokensFound: 0,
    colourValued: 0,
    nonColour: 0,
    unparsed: 0,
    overridden: 0,
    exceptions: 0,
    leftUnchanged: 0,
    reasons: {},
    firstProductivePass: -1,
    gainedAfterFirstProductivePass: 0,
    lastPassNewTokens: 0,
    aliasSkipped: 0,
    /* How often the F4 sentinel probe ran, and how many value-matching
     * candidates it examined. Both stay 0 on a page with no late alias sheets,
     * which is how you tell "the check found nothing" from "the check never
     * ran". */
    aliasProbes: 0,
    aliasSuspects: 0,
    unproductivePasses: 0,
    passLog,
    startedAt: Date.now(),
    lastPassAt: 0,
    state: 'starting',
    /* Filled in by the already-dark guard the one time it reaches a verdict. */
    guard: null,
    /* Mirrors the settings this instance is running under, and where they came
     * from ('default' | 'storage' | 'onChanged' | 'unavailable' | 'message'). */
    settings: null,
    offReason: null,
    /*
     * When this script started, and when it first knew what the user wanted,
     * both on `performance.now()` -- the same clock as the document's paint
     * entries. The gap between them is the window section 10 argues about, and
     * comparing it against `performance.getEntriesByType('paint')[0].startTime`
     * is what turns "the window is short" from a claim into a measurement.
     */
    bootAtMs: Math.round(performance.now()),
    settingsResolvedAtMs: -1,
  };

  /** Recompute the derived counters from the per-name maps. */
  function tally() {
    const reasons = {};
    let exceptions = 0;
    for (const reason of decided.values()) {
      reasons[reason] = (reasons[reason] || 0) + 1;
      if (reason === 'exception') exceptions++;
    }
    stats.reasons = reasons;
    stats.exceptions = exceptions;
    stats.colourValued = decided.size;
    stats.nonColour = nonColour.size;
    stats.overridden = applied.size;
    stats.aliasSkipped = aliased.size;
    stats.leftUnchanged = decided.size - applied.size;
  }

  /*
   * `enabled` starts false. Nothing is applied until the settings read in
   * section 10 says so -- see the ordering note there for why the static CSS
   * layer does NOT wait for the same answer.
   */
  let enabled = false;
  let alreadyDark = false;

  /* The already-dark guard has reached a verdict and must not run again.
   * Latched rather than "pass 0 only": at document_start the only stylesheet in
   * the document is our own theme.css, which declares zero custom properties,
   * so a first-pass-only guard can never see a palette at all (finding F2). */
  let guardEvaluated = false;

  /* Consecutive passes that wrote nothing. See MAX_UNPRODUCTIVE_PASSES. */
  let unproductive = 0;

  function publishStats() {
    try {
      root.setAttribute('data-mapsnoir-stats', JSON.stringify(stats));
    } catch (_) {
      /* attribute writes can only fail if the document is gone */
    }
  }

  /**
   * Is this page already dark before we touch it? Guards against Google
   * shipping their own dark chrome later: inverting an already-dark palette
   * would put us straight back to white.
   *
   * Only ever consulted against untouched values, before the first write.
   *
   * Returns the evidence alongside the verdict rather than folding "not enough
   * evidence" into "not dark". The caller needs to tell those two apart: a
   * no-evidence answer must leave the guard unlatched so a later pass can still
   * reach a verdict, while a real answer latches it forever.
   *
   * @param {Array<{r:number,g:number,b:number,a:number}>} colours
   * @returns {{evidence:number, light:number, dark:number, lightFraction:number, isDark:boolean}}
   */
  function paletteDarkness(colours) {
    let light = 0;
    let dark = 0;
    for (const c of colours) {
      if (c.a < 0.999) continue; // translucent tokens say nothing about the scheme
      const L = rgbToOklab(c.r, c.g, c.b)[0];
      if (L > 0.7) light++;
      else if (L < 0.35) dark++;
    }
    const evidence = light + dark;
    const lightFraction = evidence === 0 ? 1 : light / evidence;
    return {
      evidence,
      light,
      dark,
      lightFraction,
      isDark: evidence >= GUARD_MIN_EVIDENCE && lightFraction < 0.25,
    };
  }

  /**
   * Canonical `rgb()` / `rgba()` form of a computed colour string, or null if
   * it is not a colour this file understands.
   *
   * Used to compare a freshly resolved token against values we wrote earlier.
   * Comparing the raw strings would be a serialisation bet: we write
   * `rgb(24, 24, 24)`, and while both engines currently hand that exact string
   * back from `getComputedStyle`, a token reaching the same colour by another
   * route (`color(srgb ...)`, a hex literal) would compare unequal and silently
   * defeat the alias check below.
   */
  function canonicalColour(value) {
    const c = parseColour(value);
    return c ? formatColour(c) : null;
  }

  /**
   * A distinctive colour used to interrogate the cascade. Chosen so that
   * setting a token to it visibly changes anything that resolves through it,
   * and picked away from any value we have actually written.
   */
  function pickSentinel(avoid) {
    const candidates = ['rgb(1, 254, 3)', 'rgb(254, 1, 3)', 'rgb(3, 1, 254)'];
    for (const c of candidates) if (!avoid.has(c)) return c;
    return candidates[0];
  }

  /**
   * Finding F4: which of `todo` are aliases of tokens we have already
   * overridden?
   *
   * The hazard. Overrides are written on `:root` with `important`, so a token
   * declared by a stylesheet that lands in a LATER pass -- `--panel-bg:
   * var(--surface)` -- computes to our own dark value, not to Maps' original.
   * `applied.has(n)` cannot see this: the name is new. Darkening it again is
   * not idempotent, and the second trip through the ramp lands back near where
   * it started: `#ffffff -> rgb(24,24,24) -> rgb(226,226,226)`.
   *
   * Two things are NOT the hazard and must not be swept up with it:
   *
   *   - Aliases declared in the SAME pass as their target. Every value in
   *     `resolved` was read before any write in this pass, so they resolve to
   *     Maps' original colour and are handled correctly already.
   *   - A genuine Maps token whose own literal value happens to equal one of
   *     our outputs. `#181818` is a real Maps colour AND our output for
   *     `#ffffff`; as a Maps token it is dark *text* that has to become light.
   *     Skipping every token that merely matches a value in the applied dark
   *     set -- the naive form of this fix -- would leave that text unreadable.
   *
   * So a value match is only a suspicion, and the cascade itself settles it:
   * flip every override that produced the suspected value to a sentinel colour,
   * re-resolve, and see whether the suspect follows. Something that follows is
   * substituting our value through `var()`; something that does not is a
   * literal of its own that merely looks the same.
   *
   * The flip is invisible. Custom-property substitution happens at
   * computed-value time on `:root`, so redeclaring the target on a probe
   * subtree would NOT re-resolve an alias declared on `:root` -- the real
   * property has to move. It moves and moves back inside one synchronous block,
   * with only forced style recalculation in between, so no frame can be
   * composited while the sentinel is in place.
   *
   * @param {string[]} todo
   * @param {Map<string,string>} resolved   name -> computed colour string
   * @param {Map<string,string|null>} canon name -> canonical form of the above
   * @returns {Set<string>}
   */
  function aliasesOfOurOverrides(todo, resolved, canon) {
    const out = new Set();
    if (applied.size === 0 || todo.length === 0) return out;

    // Dark values written in EARLIER passes. `applied` has not been touched yet
    // this pass, so this is exactly that set.
    const priorDark = new Set();
    for (const rec of applied.values()) priorDark.add(rec.dark);

    const suspects = [];
    const suspectValues = new Set();
    for (const name of todo) {
      const c = canon.get(name);
      if (c && priorDark.has(c)) {
        suspects.push(name);
        suspectValues.add(c);
      }
    }
    if (suspects.length === 0) return out;
    stats.aliasSuspects += suspects.length;

    const flipped = [];
    for (const [name, rec] of applied) {
      if (suspectValues.has(rec.dark)) flipped.push(name);
    }
    if (flipped.length === 0) return out;

    stats.aliasProbes++;
    const sentinel = pickSentinel(suspectValues);
    let reprobed;
    try {
      for (const name of flipped) root.style.setProperty(name, sentinel, 'important');
      reprobed = resolveTokens(suspects);
    } finally {
      for (const name of flipped) {
        root.style.setProperty(name, applied.get(name).dark, 'important');
      }
    }

    for (const name of suspects) {
      const after = reprobed.get(name);
      // `undefined` means it stopped resolving to a colour at all under the
      // sentinel, which is not evidence of aliasing -- treat it as a literal
      // and let the normal path decide.
      if (after !== undefined && after !== resolved.get(name)) out.add(name);
    }
    return out;
  }

  /**
   * One pass: find tokens we have not handled yet, resolve them, transform
   * them, write them.
   *
   * Idempotent by construction. A token already in `applied` is never read
   * again -- its computed value is now our dark value, so re-reading it is the
   * one thing that could compound. Running this function twice in a row does
   * exactly nothing the second time.
   */
  function pass() {
    if (!enabled || alreadyDark) return 0;
    if (unproductive >= MAX_UNPRODUCTIVE_PASSES) {
      stats.state = 'pass-cap-reached';
      return 0;
    }

    const names = customPropertyNames();
    stats.tokensFound = names.length;

    const todo = [];
    for (const n of names) {
      if (!applied.has(n) && !aliased.has(n)) todo.push(n);
    }

    const resolved = resolveTokens(todo);

    // Parse once, use three times (guard, alias check, write loop).
    const parsedByName = new Map();
    const canon = new Map();
    for (const [name, value] of resolved) {
      const c = parseColour(value);
      parsedByName.set(name, c);
      canon.set(name, c ? formatColour(c) : null);
    }

    /* --- the already-dark guard (finding F2) --------------------------
     * Runs before any write, at most once per activation, and only once it has
     * enough of the palette in front of it to mean anything. It cannot be
     * pinned to "pass 0": at document_start the only stylesheet in the document
     * is our own, which declares no custom properties at all. */
    if (!guardEvaluated && applied.size === 0) {
      const parsed = [];
      for (const c of parsedByName.values()) if (c) parsed.push(c);
      const verdict = paletteDarkness(parsed);
      if (verdict.evidence >= GUARD_MIN_EVIDENCE) {
        guardEvaluated = true;
        stats.guard = {
          atPass: stats.passes + 1,
          evidence: verdict.evidence,
          light: verdict.light,
          dark: verdict.dark,
          lightFraction: Math.round(verdict.lightFraction * 1000) / 1000,
          isDark: verdict.isDark,
        };
        if (verdict.isDark) {
          alreadyDark = true;
          stats.state = 'skipped-already-dark';
          stats.passes++;
          publishStats();
          return 0;
        }
      }
    }

    /* --- aliases of our own overrides (finding F4) -------------------- */
    const aliases = aliasesOfOurOverrides(todo, resolved, canon);

    let wrote = 0;
    let unparsed = 0;

    for (const name of todo) {
      const value = resolved.get(name);
      if (value === undefined) {
        // Did not resolve to a colour at all (a length, a number, a keyword).
        nonColour.add(name);
        decided.delete(name);
        continue;
      }
      nonColour.delete(name);

      if (aliases.has(name)) {
        // Already dark, by way of the token it aliases. Recorded so later
        // passes stop re-probing it, and never written: writing anything here
        // is what would invert it a second time.
        aliased.set(name, value);
        decided.set(name, 'alias-of-override');
        continue;
      }

      const light = parsedByName.get(name);
      if (!light) {
        // Resolved to something the engine calls a colour but this parser does
        // not understand -- a colour space we do not handle. Counted, skipped.
        unparsed++;
        nonColour.add(name);
        continue;
      }

      const { colour: dark, reason } = darken(light);
      decided.set(name, reason);

      const out = formatColour(dark);
      if (out === formatColour(light)) continue; // nothing worth writing

      root.style.setProperty(name, out, 'important');
      applied.set(name, { light: formatColour(light), dark: out });
      wrote++;
    }

    stats.passes++;
    stats.lastPassNewTokens = wrote;
    stats.unparsed = unparsed;
    stats.lastPassAt = Date.now() - stats.startedAt;
    // Finding F6: the budget is spent by unproductive passes and refunded by
    // productive ones. It is not a lifetime cap.
    unproductive = wrote > 0 ? 0 : unproductive + 1;
    stats.unproductivePasses = unproductive;
    tally();

    if (wrote > 0) {
      if (stats.firstProductivePass < 0) stats.firstProductivePass = stats.passes;
      else stats.gainedAfterFirstProductivePass += wrote;
    }
    passLog.push({
      pass: stats.passes,
      atMs: stats.lastPassAt,
      found: names.length,
      probed: todo.length,
      wrote,
    });

    if (stats.state === 'starting' || stats.state === 'running') {
      stats.state = 'running';
    }
    publishStats();
    return wrote;
  }

  /* =====================================================================
   * 7. Enable / disable
   * ===================================================================== */

  /**
   * Put the page back exactly as it was found: every override removed, the
   * static CSS layer switched off through its attribute gate, all scheduling
   * torn down. Also used as a DOM event listener, so the argument may be an
   * Event rather than a reason string.
   *
   * @param {string|Event} [reason]
   */
  function undo(reason) {
    for (const name of applied.keys()) root.style.removeProperty(name);
    applied.clear();
    aliased.clear();
    decided.clear();
    nonColour.clear();
    enabled = false;
    stopScheduling();
    root.setAttribute('data-mapsnoir', 'off'); // also reverts theme.css
    tally();
    stats.state = 'off';
    stats.offReason = typeof reason === 'string' ? reason : 'manual';
    publishStats();
  }

  /**
   * Start, or restart after an undo. Everything that could carry state across
   * from the previous life is reset here -- including the already-dark latch,
   * which has to be re-earned because `undo` has just restored the original
   * light palette the guard would be judging.
   */
  function redo() {
    if (enabled) return;
    enabled = true;
    alreadyDark = false;
    guardEvaluated = false;
    unproductive = 0;
    noGrowth = 0;
    stats.passes = 0;
    stats.firstProductivePass = -1;
    stats.gainedAfterFirstProductivePass = 0;
    stats.guard = null;
    stats.offReason = null;
    passLog.length = 0;
    stats.startedAt = Date.now();
    stats.state = 'running';
    root.setAttribute('data-mapsnoir', 'on');
    publishStats();
    // Synchronous first pass: a caller that has just turned the theme back on
    // can read the result without waiting for a frame.
    runPass('redo');
    startScheduling();
  }

  /* =====================================================================
   * 8. Scheduling
   *
   * Two mechanisms, both bounded:
   *   - a fixed retry ladder that stops as soon as the token set stops
   *     growing, because Maps' lazy CSS modules land at unpredictable times
   *     during the first few seconds;
   *   - a MutationObserver on <head> childList only (never subtree), which is
   *     event-driven rather than polling, and is the thing that catches a CSS
   *     module loaded minutes later when the user opens a place card.
   * ===================================================================== */

  let noGrowth = 0;
  const timers = new Set();
  let headObserver = null;
  let bootstrapObserver = null;
  let debounceTimer = 0;

  /*
   * States that describe why the pass loop has stopped for good. `settled`
   * means "ran to completion and found everything"; overwriting one of these
   * with it would report success for a run that deliberately did nothing
   * (finding F2 -- the already-dark skip was being relabelled `settled` by the
   * very next no-growth pass, so the one state that proves the guard fired was
   * never observable).
   */
  const TERMINAL_STATES = new Set(['skipped-already-dark', 'off', 'pass-cap-reached']);

  function runPass(tag) {
    const wrote = pass();
    if (wrote === 0) noGrowth++;
    else noGrowth = 0;
    if (tag === 'ladder' && noGrowth >= NO_GROWTH_STOP) {
      for (const t of timers) clearTimeout(t);
      timers.clear();
      if (!TERMINAL_STATES.has(stats.state)) stats.state = 'settled';
      publishStats();
    }
    return wrote;
  }

  function scheduleLadder() {
    for (const delay of RETRY_DELAYS) {
      const t = setTimeout(() => {
        timers.delete(t);
        if (!enabled) return;
        if (delay === 0) requestAnimationFrame(() => runPass('ladder'));
        else runPass('ladder');
      }, delay);
      timers.add(t);
    }
  }

  function onHeadMutation(records) {
    // Ignore our own probe nodes, and anything that is not an added element.
    let interesting = false;
    for (const rec of records) {
      for (const node of rec.addedNodes) {
        if (node.nodeType !== 1 || isOurs(node)) continue;
        interesting = true;
        break;
      }
      if (interesting) break;
    }
    if (!interesting || !enabled) return;
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => runPass('observer'), MUTATION_DEBOUNCE_MS);
  }

  function attachHeadObserver() {
    if (headObserver || !doc.head) return;
    headObserver = new MutationObserver(onHeadMutation);
    headObserver.observe(doc.head, { childList: true });
    if (bootstrapObserver) {
      bootstrapObserver.disconnect();
      bootstrapObserver = null;
    }
  }

  /* The document lifecycle fires once per document, so its listeners are
   * attached once per document too -- not once per redo(), which would pile up
   * dead `{once: true}` listeners every time the user flicked the switch. */
  let lifecycleHooked = false;

  function startScheduling() {
    scheduleLadder();
    if (doc.head) {
      attachHeadObserver();
    } else {
      // <head> does not exist yet at document_start on a cold parse. Watch
      // <html> only until it appears, then hand over.
      bootstrapObserver = new MutationObserver(() => attachHeadObserver());
      bootstrapObserver.observe(root, { childList: true });
    }
    if (lifecycleHooked) return;
    lifecycleHooked = true;
    doc.addEventListener('DOMContentLoaded', () => {
      if (!enabled) return;
      attachHeadObserver();
      runPass('domcontentloaded');
    }, { once: true });
    window.addEventListener('load', () => {
      if (!enabled) return;
      runPass('load');
    }, { once: true });
  }

  function stopScheduling() {
    for (const t of timers) clearTimeout(t);
    timers.clear();
    clearTimeout(debounceTimer);
    if (headObserver) {
      headObserver.disconnect();
      headObserver = null;
    }
    if (bootstrapObserver) {
      bootstrapObserver.disconnect();
      bootstrapObserver = null;
    }
  }

  /* =====================================================================
   * 9. Control surface
   *
   * Three ways in, because three different callers need one each:
   *   - `window.__mapsNoirTheme` for anything sharing this isolated world;
   *   - DOM events, which is the only channel a page-world script or a test
   *     harness running `page.evaluate` can reach;
   *   - runtime messages, for the options UI once it exists.
   * The `data-mapsnoir-stats` attribute mirrors state onto the DOM so a caller
   * in any world can read it without a round trip.
   * ===================================================================== */

  const api = {
    apply: () => runPass('manual'),
    undo,
    redo,
    isEnabled: () => enabled,
    stats: () => JSON.parse(JSON.stringify(stats)),
    overrides: () => Object.fromEntries(applied),
    settings: () => Object.assign({}, settings),
    darken, // exported for unit testing of the transform
  };
  window.__mapsNoirTheme = api;

  doc.addEventListener('mapsnoir:theme-off', () => setActive(false, 'event'));
  doc.addEventListener('mapsnoir:theme-on', () => setActive(true, 'event'));
  doc.addEventListener('mapsnoir:theme-rerun', () => runPass('manual'));

  try {
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
      chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
        if (!msg || msg.type !== 'mapsnoir:theme') return false;
        if (msg.action === 'off') setActive(false, 'message');
        else if (msg.action === 'on') setActive(true, 'message');
        else if (msg.action === 'rerun') runPass('manual');
        sendResponse({ ok: true, stats: api.stats() });
        return false;
      });
    }
  } catch (_) {
    /* no extension APIs available (e.g. injected as a plain page script) */
  }

  /* =====================================================================
   * 10. Settings
   *
   * `storage.local.settings` is the single source of truth, written by the
   * popup and the options page (through the background). This file owns one
   * question out of the three: `enabled && darkChrome`. `darkMap` is the DNR
   * ruleset's business and is read here only to be reported back in stats.
   *
   * THE ORDERING HAZARD, AND WHICH WAY IT FAILS
   * -------------------------------------------
   * theme.css is injected at `document_start` and paints immediately. Reading
   * `storage.local` is asynchronous. Between those two moments the content
   * script does not know whether the user wants a dark page, and there is no
   * synchronous way for it to find out: content scripts have no synchronous
   * extension storage, `localStorage` at this origin belongs to Google Maps and
   * is not ours to write, and holding first paint is not on offer.
   *
   * So the window cannot be eliminated, only pointed. It is pointed DARK: the
   * CSS gate is `html:not([data-mapsnoir="off"])`, which applies while the
   * attribute reads `pending`, and only a resolved "off" switches it back.
   * Three reasons, in order of weight:
   *
   *   1. All three settings default to true, and the value is only ever
   *      non-default because the user went and turned it off. Failing dark is
   *      failing towards what the overwhelming majority of loads want.
   *   2. The two mistakes are not equally bad. A white flash on a user who
   *      asked for dark is the exact defect theme.css exists to prevent, and it
   *      is the painful one -- a full-brightness frame in a dark room. A dark
   *      frame on a user who turned the theme off is a few milliseconds of the
   *      wrong background colour on a page that is still blank.
   *   3. The window is short and bounded at both ends. The read is issued as
   *      the first thing this script does, before the retry ladder, before the
   *      observers; and if it never answers at all, SETTINGS_TIMEOUT_MS falls
   *      through to the defaults rather than leaving the page half-themed
   *      forever.
   *
   * Measured on live Maps in Chrome, both settings states, with `bootAtMs`,
   * `settingsResolvedAtMs` and the document's own paint entries on one clock:
   *
   *   enabled   boot 107 ms -> settings 114 ms   first-paint 260 ms
   *   disabled  boot 114 ms -> settings 123 ms   first-paint 284 ms
   *
   * The read answered in 7 and 9 ms respectively, roughly 150 ms before the
   * first frame was composited in either case. So the window is real but no
   * frame falls inside it: a disabled user does not merely get the attribute
   * set "eventually", the revert lands in the same task as the storage callback
   * and well before anything is painted. Those two counters exist so that claim
   * stays checkable rather than becoming folklore.
   * ===================================================================== */

  const SETTINGS_KEY = 'settings';
  const SETTINGS_DEFAULT = { enabled: true, darkMap: true, darkChrome: true };
  const SETTINGS_KEYS = ['enabled', 'darkMap', 'darkChrome'];

  /* If storage never answers, stop waiting and use the defaults. */
  const SETTINGS_TIMEOUT_MS = 2000;

  let settings = Object.assign({}, SETTINGS_DEFAULT);

  /** Have we acted on a settings value at least once? */
  let activated = false;

  /** Has a live update superseded the initial read? */
  let settingsSuperseded = false;

  /**
   * Coerce whatever is in storage into the three booleans, defaulting anything
   * missing or of the wrong type to true. A half-written record must not be
   * able to turn the theme off by accident.
   */
  function normaliseSettings(value) {
    const out = Object.assign({}, SETTINGS_DEFAULT);
    if (value && typeof value === 'object') {
      for (const k of SETTINGS_KEYS) {
        if (typeof value[k] === 'boolean') out[k] = value[k];
      }
    }
    return out;
  }

  /** This file's share of the settings: the app chrome, not the map. */
  const wantsChrome = (s) => s.enabled === true && s.darkChrome === true;

  /**
   * The one place that turns the theme on or off. Idempotent: being told the
   * same thing twice does nothing the second time, which matters because the
   * initial read and the first change event can both carry the same value.
   *
   * @param {boolean} active
   * @param {string} source
   */
  function setActive(active, source) {
    if (stats.settingsResolvedAtMs < 0) stats.settingsResolvedAtMs = Math.round(performance.now());
    stats.settings = {
      enabled: settings.enabled,
      darkMap: settings.darkMap,
      darkChrome: settings.darkChrome,
      source,
    };
    if (activated && active === enabled) {
      publishStats();
      return;
    }
    activated = true;
    if (active) redo();
    else undo(source);
  }

  /**
   * `chrome` exists in content scripts on both engines; `browser` is Firefox's
   * native spelling and is accepted as a fallback. Returns null when there is
   * no extension context at all -- which is the case when this file is loaded
   * as a plain page script, as the fixture tests do.
   */
  function storageHost() {
    try {
      const host =
        (typeof chrome !== 'undefined' && chrome) ||
        (typeof browser !== 'undefined' && browser) ||
        null;
      if (host && host.storage && host.storage.local &&
          typeof host.storage.local.get === 'function') {
        return host;
      }
    } catch (_) {
      /* accessing the namespace can throw in a hostile page world */
    }
    return null;
  }

  /**
   * Read the settings record, tolerating both API shapes and answering with
   * null rather than hanging.
   *
   * @param {any} host
   * @returns {Promise<any>} the storage result object, or null
   */
  function readSettings(host) {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      };
      const timer = setTimeout(() => finish(null), SETTINGS_TIMEOUT_MS);
      try {
        // Promise form: Firefox always, Chrome MV3 when no callback is passed.
        const maybe = host.storage.local.get(SETTINGS_KEY);
        if (maybe && typeof maybe.then === 'function') {
          maybe.then(finish, () => finish(null));
          return;
        }
        // Callback form, for anything that did not return a promise.
        host.storage.local.get(SETTINGS_KEY, (res) => {
          const err = host.runtime && host.runtime.lastError;
          finish(err ? null : res);
        });
      } catch (_) {
        finish(null);
      }
    });
  }

  /* =====================================================================
   * 11. Go
   * ===================================================================== */

  const host = storageHost();

  if (!host) {
    // No extension storage: nothing can have turned the theme off, so there is
    // no window to fail in and no reason to defer a frame.
    setActive(wantsChrome(settings), 'default');
  } else {
    // Dark until told otherwise -- see the ordering note above. The attribute
    // is set rather than left absent so that the pending state is visible to a
    // harness; `pending` is not `off`, so theme.css still applies.
    root.setAttribute('data-mapsnoir', 'pending');
    publishStats();

    // Subscribe BEFORE reading, so a change that lands during the read is not
    // dropped in the gap between the two.
    try {
      if (host.storage.onChanged && host.storage.onChanged.addListener) {
        host.storage.onChanged.addListener((changes, area) => {
          if (area && area !== 'local') return;
          if (!changes || !changes[SETTINGS_KEY]) return;
          settingsSuperseded = true;
          settings = normaliseSettings(changes[SETTINGS_KEY].newValue);
          setActive(wantsChrome(settings), 'onChanged');
        });
      }
    } catch (_) {
      /* no onChanged: the theme still applies, it just will not follow a live
         edit until the next page load */
    }

    readSettings(host).then((res) => {
      // A live change that arrived first is newer than this read by
      // definition; do not let a slow read walk it back.
      if (settingsSuperseded) return;
      const found = res && typeof res === 'object' ? res[SETTINGS_KEY] : undefined;
      settings = normaliseSettings(found);
      setActive(wantsChrome(settings), res === null ? 'unavailable' : 'storage');
    });
  }
})();
