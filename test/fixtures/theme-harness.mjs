/**
 * Harness for the app-chrome theme layer (`extension/content/theme.js`).
 *
 * WHY A BROWSER
 * -------------
 * The theme's whole mechanism is `getComputedStyle` on `:root`: enumerating
 * custom properties, resolving `var()` chains through probe elements, and
 * writing back with `important`. None of that exists outside a real CSS engine,
 * and a stub of it would be a stub of the exact thing under test. So this runs
 * Playwright's bundled Chromium against a local `file://` fixture -- no network,
 * no Google, no extension packaging.
 *
 * WHY A FIXTURE AND NOT LIVE MAPS
 * -------------------------------
 * Findings F2 and F4 need palettes that live Maps will not produce on request:
 * an already-dark token set, and a `:root` alias sheet arriving strictly after
 * the pass that overrode its target. Both defects survived review precisely
 * because nothing could construct those states.
 *
 * HOW THE CONTENT SCRIPT IS EMULATED
 * ----------------------------------
 * `addInitScript` runs before any page script, which is the same position a
 * `document_start` content script occupies. `theme.css` is linked from the
 * fixture's <head>. The one thing this does NOT reproduce is the isolated
 * world: here theme.js shares a global with the page. Nothing in the file
 * depends on world separation -- it reads computed styles and writes inline
 * properties, both of which cross worlds anyway -- but it does mean the fake
 * `chrome` namespace below is visible to the fixture, which is harmless and is
 * what makes the settings path drivable at all.
 */

import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PNG } from 'pngjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');

export const THEME_JS = path.join(ROOT, 'extension', 'content', 'theme.js');
export const FIXTURE_URL = pathToFileURL(path.join(HERE, 'theme-fixture.html')).href;

/** The shipped source, read fresh so a mutant never leaks between tests. */
export function themeSource() {
  return fs.readFileSync(THEME_JS, 'utf8');
}

/* =========================================================================
 * Palettes
 *
 * Hash-named like the real thing, with the handful of readable names the
 * fixture's own stylesheet consumes. Values are chosen so the already-dark
 * guard's arithmetic is unambiguous: "light" is L > 0.7 and "dark" is L < 0.35
 * in OKLab, and mid-lightness colours (which the guard ignores) are kept out of
 * the counts on purpose.
 * ========================================================================= */

const LIGHT_SURFACES = [
  '#f8f9fa', '#f1f3f4', '#e8eaed', '#dadce0', '#fafafa', '#f5f5f5',
  '#eeeeee', '#e0e0e0', '#efefef', '#fcfcfc', '#f7f7f7', '#eaeaea',
  '#e6e6e6', '#dcdcdc', '#d9d9d9', '#f0f0f0', '#fdfdfd', '#ededed',
];

const LIGHT_TEXTS = ['#202124', '#111111', '#0d0d0d', '#202020', '#191919'];

const DARK_SURFACES = [
  '#131314', '#1b1b1b', '#202124', '#242424', '#282828', '#2b2b2b',
  '#1f1f1f', '#161616', '#1d1d1d', '#232323', '#272727', '#2a2a2a',
  '#121212', '#181818', '#1a1a1a', '#212121', '#252525', '#292929',
  '#0e0e0e', '#101010', '#141414', '#171717', '#1c1c1c', '#1e1e1e',
  '#222222', '#262626', '#2c2c2c', '#2d2d2d', '#2e2e2e', '#303030',
];

const DARK_TEXTS = ['#e8eaed', '#ffffff', '#dadce0', '#f1f3f4', '#eeeeee'];

/* Hash-shaped names like Maps' own `--t5b35d265ba7ac78d`. The base is kept
 * under Number.MAX_SAFE_INTEGER on purpose: a 64-bit-looking literal loses
 * precision in `toString(16)` and silently collapses distinct indices onto the
 * same name, which quietly halves the palette. */
const hashName = (i) => '--t' + (0x5b35d265ba7a + i * 0x111).toString(16);

/** Tokens every palette carries, to exercise the non-obvious branches. */
function commonTokens(surface) {
  return [
    // Not colours at all.
    ['--t9000000000000001', '8px'],
    ['--t9000000000000002', '1.5'],
    // Translucent black and white: never inverted, in either direction.
    ['--shadow', 'rgba(0, 0, 0, 0.3)'],
    ['--wash', 'rgba(255, 255, 255, 0.12)'],
    // A vivid accent the exception table maps to itself.
    ['--star', '#ffbb29'],
    // An alias declared in the SAME sheet as its target. Safe by construction,
    // and here to prove the F4 fix does not sweep it up with the late ones.
    ['--alias-same-pass', 'var(' + surface + ')'],
  ];
}

/** A conventional light Maps palette: 22 light + 6 dark countable tokens. */
export function lightPalette() {
  const tokens = [
    ['--surface', '#ffffff'],
    ['--surface-container', '#f2f2f2'],
    ['--on-surface', '#1f1f1f'],
    ['--on-surface-variant', '#5e5e5e'],
    ['--outline', '#e3e3e3'],
    ['--primary', '#0b57d0'],
    ['--on-primary', '#ffffff'],
  ];
  LIGHT_SURFACES.forEach((v, i) => tokens.push([hashName(i), v]));
  LIGHT_TEXTS.forEach((v, i) => tokens.push([hashName(100 + i), v]));
  return tokens.concat(commonTokens('--surface'));
}

/**
 * The palette Google would ship if they gave Maps its own dark chrome.
 *
 * Measured by the guard itself: 35 dark, 9 light, light fraction 0.205. Real
 * Material 3 dark schemes look like this -- the surface and container roles
 * vastly outnumber the "on-" roles that stay light. Inverting it is the failure
 * the already-dark guard exists to prevent, and `--tok0` reproduces the review's
 * own example (`rgb(10,10,10)` came out at `rgb(232,232,232)`).
 *
 * @param {number} [surfaceCount] how many dark surface tokens to include
 */
export function darkPalette(surfaceCount = DARK_SURFACES.length) {
  const tokens = [
    ['--tok0', 'rgb(10, 10, 10)'],
    ['--surface', '#0a0a0a'],
    ['--surface-container', '#1f1f1f'],
    ['--on-surface', '#e8eaed'],
    ['--on-surface-variant', '#c4c7c5'],
    ['--outline', '#3c4043'],
    ['--primary', '#a8c7fa'],
    ['--on-primary', '#062e6f'],
  ];
  DARK_SURFACES.slice(0, surfaceCount).forEach((v, i) => tokens.push([hashName(i), v]));
  DARK_TEXTS.forEach((v, i) => tokens.push([hashName(100 + i), v]));
  return tokens.concat(commonTokens('--surface'));
}

/**
 * The same scheme with fewer surface tokens: 23 dark, 9 light, light fraction
 * 0.281. Visibly a dark palette to a human, and ABOVE the guard's 0.25
 * threshold, so the guard does not fire on it. That threshold is inherited, not
 * introduced by the F2 fix, and it has never been calibrated against a real
 * Google dark chrome because none exists yet. The test that consumes this
 * palette exists to pin where the boundary actually sits.
 */
export function marginalDarkPalette() {
  return darkPalette(18);
}

/**
 * Eight dark tokens and nothing else: a partial mid-ladder fragment, below the
 * evidence floor. The guard must refuse to reach a verdict on this.
 */
export function thinDarkPalette() {
  return [
    ['--surface', '#0a0a0a'],
    ['--surface-container', '#131314'],
    ['--on-surface', '#1b1b1b'],
    ['--on-surface-variant', '#202124'],
    ['--outline', '#242424'],
    ['--primary', '#282828'],
    ['--on-primary', '#2b2b2b'],
    ['--t9000000000000009', '#1f1f1f'],
  ];
}

/* =========================================================================
 * Browser plumbing
 * ========================================================================= */

export async function launchBrowser() {
  return chromium.launch({ headless: true });
}

/**
 * A fake `chrome.storage` for the page world.
 *
 * Serialised into the page by Playwright, so it must be self-contained and
 * ES5-ish. Modes cover every shape theme.js has to survive: both API forms, a
 * slow answer, an answer that never comes, a missing record and a rejection.
 */
function installStorageStub(config) {
  var state = { settings: config.settings };
  var listeners = [];
  var pending = [];
  var g = window;

  function answer() {
    return config.mode === 'missing' ? {} : { settings: state.settings };
  }

  g.chrome = {
    // No `onMessage`: this fixture drives the settings path, not the message
    // path, and theme.js must tolerate a runtime object without it.
    runtime: {},
    storage: {
      local: {
        get: function (key, cb) {
          if (config.mode === 'callback') {
            if (typeof cb === 'function') {
              setTimeout(function () { cb(answer()); }, 0);
            }
            return undefined; // force theme.js onto the callback path
          }
          if (config.mode === 'reject') {
            return Promise.reject(new Error('storage unavailable'));
          }
          return new Promise(function (resolve) {
            if (config.mode === 'never') return;
            if (config.mode === 'manual') { pending.push(resolve); return; }
            if (config.delayMs > 0) {
              setTimeout(function () { resolve(answer()); }, config.delayMs);
              return;
            }
            resolve(answer());
          });
        },
        set: function (obj) {
          if (obj && obj.settings) g.__storageStub.change(obj.settings);
          return Promise.resolve();
        },
      },
      onChanged: {
        addListener: function (fn) { listeners.push(fn); },
      },
    },
  };

  g.__storageStub = {
    listenerCount: function () { return listeners.length; },
    current: function () { return state.settings; },
    /** Release a `manual`-mode read. */
    release: function () {
      var waiting = pending.splice(0, pending.length);
      for (var i = 0; i < waiting.length; i++) waiting[i](answer());
      return waiting.length;
    },
    /** Write and broadcast, exactly as the background does. */
    change: function (next, area) {
      var oldValue = state.settings;
      state.settings = next;
      for (var i = 0; i < listeners.length; i++) {
        listeners[i]({ settings: { oldValue: oldValue, newValue: next } }, area || 'local');
      }
      return listeners.length;
    },
  };
}

/**
 * Open the fixture with theme.js installed as a document_start script.
 *
 * @param {import('@playwright/test').Browser} browser
 * @param {object} [opts]
 * @param {Array<[string,string]>} [opts.tokens]   palette, default light
 * @param {string} [opts.source]                   theme.js source (for mutants)
 * @param {object} [opts.settings]                 the stored record
 * @param {string} [opts.storageMode]              immediate|delayed|manual|never|missing|reject|callback
 * @param {number} [opts.storageDelayMs]
 *
 * Naming a `settings` record OR a `storageMode` installs the fake `chrome`
 * namespace. Naming neither leaves the page without an extension context at
 * all, which is the shape most of these tests want: theme.js then has nothing
 * to wait for and applies synchronously at document_start.
 */
export async function openFixture(browser, opts = {}) {
  const context = await browser.newContext({ viewport: { width: 800, height: 600 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (err) => errors.push(String(err)));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push('console: ' + msg.text());
  });

  if (opts.settings !== undefined || opts.storageMode !== undefined) {
    await page.addInitScript(installStorageStub, {
      settings: opts.settings === undefined ? null : opts.settings,
      mode: opts.storageMode || 'immediate',
      delayMs: opts.storageDelayMs || 0,
    });
  }

  const tokens = opts.tokens || lightPalette();
  const source = opts.source === undefined ? themeSource() : opts.source;

  // Both of these only touch `window`, so they are safe at addInitScript time,
  // which is before the parser has created a document element. theme.js itself
  // is NOT injected here for exactly that reason -- the fixture's <head> runs it
  // (see the comment there).
  await page.addInitScript(
    (payload) => {
      window.__mapsNoirFixture = { tokens: payload.tokens };
      window.__themeSource = payload.source;
    },
    { tokens, source }
  );

  await page.goto(FIXTURE_URL);
  page.__errors = errors;
  page.__context = context;
  return page;
}

export async function closePage(page) {
  if (page && page.__context) await page.__context.close();
}

/** The stats object the theme mirrors onto `<html data-mapsnoir-stats>`. */
export async function readStats(page) {
  return page.evaluate(() => {
    const raw = document.documentElement.getAttribute('data-mapsnoir-stats');
    return raw ? JSON.parse(raw) : null;
  });
}

/**
 * Wait until the pass loop has stopped moving.
 *
 * `minMs` exists because the F2 assertion is about a state SURVIVING the ladder:
 * the no-growth branch used to relabel `skipped-already-dark` as `settled` three
 * ladder passes later, so an assertion that fired early would miss it. The
 * ladder's third rung is at 400 ms and its fourth at 900 ms.
 */
export async function waitForQuiet(page, { minMs = 1100, timeout = 20000 } = {}) {
  await page.waitForFunction(
    (min) => {
      const raw = document.documentElement.getAttribute('data-mapsnoir-stats');
      if (!raw) return false;
      const s = JSON.parse(raw);
      if (s.state === 'starting' || s.state === 'running') return false;
      return Date.now() - s.startedAt >= min;
    },
    minMs,
    { timeout }
  );
  return readStats(page);
}

/** Computed (substituted) value of every custom property on :root. */
export function tokenValues(page) {
  return page.evaluate(() => window.__fixture.tokenValues());
}

/** Colours as actually painted onto the fixture's elements. */
export function paintedColours(page) {
  return page.evaluate(() => window.__fixture.paintedColours());
}

/** Append a `:root` sheet the way Maps lands a lazy CSS module. */
export function addSheet(page, css, id) {
  return page.evaluate(({ c, i }) => window.__fixture.addSheet(c, i), { c: css, i: id });
}

/** Drive the theme's own re-scan and return how many tokens it wrote. */
export function runPass(page) {
  return page.evaluate(() => window.__mapsNoirTheme.apply());
}

/** Everything the theme has written, name -> {light, dark}. */
export function overrides(page) {
  return page.evaluate(() => window.__mapsNoirTheme.overrides());
}

/** Flip settings through the fake storage, as the background would. */
export function changeSettings(page, next) {
  return page.evaluate((n) => window.__storageStub.change(n), next);
}

export function releaseStorage(page) {
  return page.evaluate(() => window.__storageStub.release());
}

export function attribute(page, name) {
  return page.evaluate((n) => document.documentElement.getAttribute(n), name);
}

/* =========================================================================
 * Pixels
 * ========================================================================= */

/** Mean RGB of a PNG buffer. */
export function meanRgb(buffer) {
  const png = PNG.sync.read(buffer);
  let r = 0, g = 0, b = 0;
  const n = png.width * png.height;
  for (let i = 0; i < png.data.length; i += 4) {
    r += png.data[i];
    g += png.data[i + 1];
    b += png.data[i + 2];
  }
  return {
    r: Math.round((r / n) * 100) / 100,
    g: Math.round((g / n) * 100) / 100,
    b: Math.round((b / n) * 100) / 100,
    pixels: n,
  };
}

export async function elementMeanRgb(page, selector) {
  const el = await page.locator(selector).elementHandle();
  const shot = await el.screenshot();
  return meanRgb(shot);
}

/* =========================================================================
 * Contrast
 * ========================================================================= */

const chan = (v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));

/** WCAG relative luminance of an `rgb(...)` string. */
export function relativeLuminance(css) {
  const m = /rgba?\(([^)]+)\)/.exec(css);
  if (!m) return null;
  const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
  return 0.2126 * chan(p[0] / 255) + 0.7152 * chan(p[1] / 255) + 0.0722 * chan(p[2] / 255);
}

/** WCAG contrast ratio between two `rgb(...)` strings, or null. */
export function contrastRatio(a, b) {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  if (la === null || lb === null) return null;
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
}
