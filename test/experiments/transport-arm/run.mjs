/**
 * LANE E trial runner.
 *
 *   node run.mjs <variant> [trials] [pauseMs]
 *
 * Writes test/experiments/transport-arm/data/trials-<variant>.json (full request
 * logs) and appends one line per trial to data/trials.ndjson (slim).
 *
 * Live third-party service: trials are serial, each is one page load, and there
 * is a pause between them. Do not raise the trial count without raising the pause.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runTrial, slim, MAPS_URL } from './lib/trial.mjs';
import { protoUrlWithStyle } from '../../lib/bpb.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(HERE, 'data');
fs.mkdirSync(DATA, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------- init scripts */

/** Deny WebGL to the page AND to workers, without touching anything else. */
const DENY_WEBGL = `
(() => {
  const deny = (t) => t === 'webgl' || t === 'webgl2' || t === 'experimental-webgl' || t === 'webgl2-compute';
  const patch = (proto) => {
    if (!proto || !proto.getContext) return;
    const orig = proto.getContext;
    proto.getContext = function (type, ...rest) {
      if (deny(String(type))) return null;
      return orig.call(this, type, ...rest);
    };
  };
  patch(self.HTMLCanvasElement && self.HTMLCanvasElement.prototype);
  patch(self.OffscreenCanvas && self.OffscreenCanvas.prototype);
  try { delete self.WebGL2RenderingContext; } catch (e) {}
  try { delete self.WebGLRenderingContext; } catch (e) {}
})();
`;

/** Deny WebAssembly outright. */
const DENY_WASM = `
(() => {
  try { Object.defineProperty(self, 'WebAssembly', { get: () => undefined, configurable: true }); } catch (e) {}
})();
`;

/** Deny OffscreenCanvas (the transfer path the worker renderer needs). */
const DENY_OFFSCREEN = `
(() => {
  try { delete self.OffscreenCanvas; } catch (e) {}
  try {
    const p = self.HTMLCanvasElement && self.HTMLCanvasElement.prototype;
    if (p) p.transferControlToOffscreen = function () { throw new Error('denied'); };
  } catch (e) {}
})();
`;

/* ----------------------------------------------------------------- variants */

const V = {
  /* --- baselines --- */
  'chromium-headed': { browser: 'chromium', headless: false },
  'chromium-headless': { browser: 'chromium', headless: true },
  'firefox-headed': { browser: 'firefox', headless: false },
  'firefox-headless': { browser: 'firefox', headless: true },

  /* --- capability denial (chromium, headed baseline) --- */
  'chromium-no-webgl-flag': { browser: 'chromium', headless: false, args: ['--disable-webgl', '--disable-webgl2'] },
  'chromium-no-webgl-js': { browser: 'chromium', headless: false, initScript: DENY_WEBGL },
  'chromium-no-wasm-js': { browser: 'chromium', headless: false, initScript: DENY_WASM },
  'chromium-no-offscreen-js': { browser: 'chromium', headless: false, initScript: DENY_OFFSCREEN },
  'chromium-block-mapcore': {
    browser: 'chromium',
    headless: false,
    abortMatching: [/mapcore/i, /\.wasm(\?|$)/],
  },
  'chromium-block-wasm-only': { browser: 'chromium', headless: false, abortMatching: [/\.wasm(\?|$)/] },

  /* --- URL entry points --- */
  'url-force-lite': { browser: 'chromium', headless: false, url: `${MAPS_URL}?force=lite` },
  'url-force-canvas': { browser: 'chromium', headless: false, url: `${MAPS_URL}?force=canvas` },
  'url-output-classic': { browser: 'chromium', headless: false, url: `${MAPS_URL}?output=classic` },
  'url-nowebgl': { browser: 'chromium', headless: false, url: `${MAPS_URL}?force=webgl=0` },
  'url-maps-google-com': {
    browser: 'chromium',
    headless: false,
    url: 'https://maps.google.com/maps/@29.7604,-95.3698,12z',
  },
  'url-basic': { browser: 'chromium', headless: false, url: 'https://www.google.com/maps?force=lite&q=Houston' },

  /* --- identity / locale --- */
  'ua-old-chrome': {
    browser: 'chromium',
    headless: false,
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/70.0.3538.110 Safari/537.36',
  },
  'ua-ie11': {
    browser: 'chromium',
    headless: false,
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Trident/7.0; rv:11.0) like Gecko',
  },
  'geo-de': { browser: 'chromium', headless: false, geo: { locale: 'de-DE', timezoneId: 'Europe/Berlin' } },
  'colorscheme-light': { browser: 'chromium', headless: false, colorScheme: 'light' },

  /* --- Q4: does the vector renderer take its palette from the CompactLegend asset? --- */
  'shot-baseline': { browser: 'chromium', headless: false, screenshot: true, observeMs: 14000 },
  'shot-legend-dark': {
    browser: 'chromium',
    headless: false,
    screenshot: true,
    observeMs: 14000,
    rewrite: [{ from: /CompactLegend-Roadmap-/, to: 'CompactLegend-RoadmapDark-' }],
  },
  'shot-legend-dark-plus-proto': {
    browser: 'chromium',
    headless: false,
    screenshot: true,
    observeMs: 14000,
    rewrite: [
      { from: /CompactLegend-Roadmap-/, to: 'CompactLegend-RoadmapDark-' },
      { from: /(\/maps\/vt\/pb=.*!1sset!2s)Roadmap(!)/, to: '$1RoadmapDark$2' },
      { fn: (u) => (u.includes('/maps/vt/proto?bpb=') ? protoUrlWithStyle(u, 'RoadmapDark') : null) },
    ],
  },
  'shot-proto-dark-only': {
    browser: 'chromium',
    headless: false,
    screenshot: true,
    observeMs: 14000,
    rewrite: [{ fn: (u) => (u.includes('/maps/vt/proto?bpb=') ? protoUrlWithStyle(u, 'RoadmapDark') : null) }],
  },

  /* --- the product claim: force raster AND darken it --- */
  'shot-nowebgl-light': {
    browser: 'chromium',
    headless: false,
    screenshot: true,
    observeMs: 14000,
    initScript: DENY_WEBGL,
  },
  'shot-nowebgl-dark': {
    browser: 'chromium',
    headless: false,
    screenshot: true,
    observeMs: 14000,
    initScript: DENY_WEBGL,
    sampleTileBodies: 4,
    rewrite: [{ from: /(\/maps\/vt\/pb=.*!1sset!2s)Roadmap(!)/, to: '$1RoadmapDark$2' }],
  },
  /* Same, but ALSO swap the legend -- does the no-WebGL renderer read it? */
  'shot-nowebgl-dark-plus-legend': {
    browser: 'chromium',
    headless: false,
    screenshot: true,
    observeMs: 14000,
    initScript: DENY_WEBGL,
    sampleTileBodies: 4,
    fullShot: true,
    rewrite: [
      { from: /CompactLegend-Roadmap-/, to: 'CompactLegend-RoadmapDark-' },
      { from: /(\/maps\/vt\/pb=.*!1sset!2s)Roadmap(!)/, to: '$1RoadmapDark$2' },
      { from: /(\/maps\/vt\/stream\/pb=.*!1sset!2s)Roadmap(!)/, to: '$1RoadmapDark$2' },
    ],
  },
  /* The mechanism as a real MV3 declarativeNetRequest rule, not harness routing. */
  'ext-legend-dark': {
    browser: 'chromium',
    headless: false,
    screenshot: true,
    fullShot: true,
    observeMs: 14000,
    extensionDir: path.join(HERE, 'legend-extension'),
  },

  /* Q3: is the assignment sticky within one profile? 4 navigations, one profile. */
  'sticky-4': { browser: 'chromium', headless: false, navigations: 4, perNavMs: 9000, observeMs: 9000 },
  'sticky-firefox-4': { browser: 'firefox', headless: false, navigations: 4, perNavMs: 9000, observeMs: 9000 },

  /* ?force=canvas -- a client-settable switch that picks the raster renderer. */
  'shot-force-canvas': {
    browser: 'chromium',
    headless: false,
    url: `${MAPS_URL}?force=canvas`,
    screenshot: true,
    observeMs: 14000,
    fullShot: true,
  },
  'shot-force-canvas-stream-dark': {
    browser: 'chromium',
    headless: false,
    url: `${MAPS_URL}?force=canvas`,
    screenshot: true,
    observeMs: 14000,
    fullShot: true,
    rewrite: [{ from: /(\/maps\/vt\/stream\/pb=.*!1sset!2s)Roadmap(!)/, to: '$1RoadmapDark$2' }],
  },
  'shot-force-canvas-all-dark': {
    browser: 'chromium',
    headless: false,
    url: `${MAPS_URL}?force=canvas`,
    screenshot: true,
    observeMs: 14000,
    fullShot: true,
    rewrite: [
      { from: /CompactLegend-Roadmap-/, to: 'CompactLegend-RoadmapDark-' },
      { from: /(\/maps\/vt\/pb=.*!1sset!2s)Roadmap(!)/, to: '$1RoadmapDark$2' },
      { from: /(\/maps\/vt\/stream\/pb=.*!1sset!2s)Roadmap(!)/, to: '$1RoadmapDark$2' },
    ],
  },
  'shot-nowebgl-stream-only': {
    browser: 'chromium',
    headless: false,
    screenshot: true,
    observeMs: 14000,
    initScript: DENY_WEBGL,
    rewrite: [{ from: /(\/maps\/vt\/stream\/pb=.*!1sset!2s)Roadmap(!)/, to: '$1RoadmapDark$2' }],
  },
  'shot-stream-only': {
    browser: 'chromium',
    headless: false,
    screenshot: true,
    observeMs: 14000,
    rewrite: [{ from: /(\/maps\/vt\/stream\/pb=.*!1sset!2s)Roadmap(!)/, to: '$1RoadmapDark$2' }],
  },
  /* Isolates the legend: no tile rewrite, no stream rewrite, WebGL denied. */
  'shot-nowebgl-legend-only': {
    browser: 'chromium',
    headless: false,
    screenshot: true,
    observeMs: 14000,
    initScript: DENY_WEBGL,
    rewrite: [{ from: /CompactLegend-Roadmap-/, to: 'CompactLegend-RoadmapDark-' }],
  },
  /* Firefox, legend only. */
  'shot-firefox-legend-only': {
    browser: 'firefox',
    headless: false,
    screenshot: true,
    observeMs: 14000,
    rewrite: [{ from: /CompactLegend-Roadmap-/, to: 'CompactLegend-RoadmapDark-' }],
  },
  'shot-firefox-baseline': { browser: 'firefox', headless: false, screenshot: true, observeMs: 14000 },
  /* Control for the tile-body instrument: no rewrite at all. */
  'shot-nowebgl-light-bodies': {
    browser: 'chromium',
    headless: false,
    screenshot: true,
    observeMs: 14000,
    initScript: DENY_WEBGL,
    sampleTileBodies: 4,
  },
};

/* --------------------------------------------------------------------- main */

const variantName = process.argv[2];
const trials = Number(process.argv[3] ?? 1);
const pauseMs = Number(process.argv[4] ?? 6000);

if (!variantName || !V[variantName]) {
  console.error(`unknown variant. known:\n  ${Object.keys(V).join('\n  ')}`);
  process.exit(2);
}

const cfg = { name: variantName, screenshotDir: path.join(DATA, 'shots'), ...V[variantName] };
const results = [];
for (let i = 0; i < trials; i++) {
  const t = await runTrial(cfg);
  results.push(t);
  const line = [
    `${variantName} #${i + 1}/${trials}`,
    `arm=${t.arm}`,
    `raster=${t.counts.raster ?? 0}`,
    `proto=${t.counts.proto ?? 0}`,
    `rend=[${(t.rendererModules ?? []).join('|')}]`,
    `wa=[${(t.wasmModules ?? []).join('|')}]`,
    `webgl2=${t.webgl?.webgl2}`,
    t.pixels ? `rgb=(${t.pixels.r},${t.pixels.g},${t.pixels.b}) lum=${t.pixels.luminance} dark=${t.pixels.isDark}` : '',
    t.rewritten ? `rw=${t.rewritten.length}` : '',
    `${t.durationMs}ms`,
    t.error ? `ERR ${t.error}` : '',
  ].join(' ');
  console.log(line);
  fs.appendFileSync(path.join(DATA, 'trials.ndjson'), JSON.stringify(slim(t)) + '\n');
  if (i < trials - 1) await sleep(pauseMs);
}

fs.writeFileSync(path.join(DATA, `trials-${variantName}.json`), JSON.stringify(results, null, 1));
const tally = {};
for (const r of results) tally[r.arm] = (tally[r.arm] ?? 0) + 1;
console.log(`\n${variantName}: ${trials} trials -> ${JSON.stringify(tally)}`);
