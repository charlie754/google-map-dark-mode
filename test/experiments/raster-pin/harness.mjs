/**
 * LANE C -- raster-pin experiments.
 *
 * Question: can Google Maps be pinned to its RASTER transport, so that the
 * proven-dark `set:RoadmapDark` raster layer becomes the permanent renderer
 * instead of being overpainted by the WASM vector renderer at ~900-1400 ms?
 *
 * This harness deliberately does NOT reuse test/lib/gate.mjs's runGate(): that
 * function hard-codes one intervention (rewrite-only) and one phase list, and
 * its early-frame loop drifts because it does not subtract screenshot time. The
 * whole finding here lives in *when* darkness dies, so the time series has to be
 * anchored to an absolute t0. Everything else -- pixel analysis, request
 * classification, protobuf parsing -- is imported from test/lib unchanged.
 *
 * Owned by lane C. Nothing outside test/experiments/raster-pin/ is written.
 */

import { chromium } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { analyse } from '../../lib/image.mjs';
import { VtRecorder, summarise } from '../../lib/recorder.mjs';
import {
  isBaseMapTile,
  isProtoTileRequest,
  styleToken,
  darkTwin,
  baseMapKind,
  tileZoomOf,
  urlZoom,
} from '../../lib/tiles.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ARTIFACTS = path.join(HERE, 'artifacts');

export const MAPS_URL = 'https://www.google.com/maps/@29.7604,-95.3698,12z';
export const VIEWPORT = { width: 1440, height: 900 };

/** Same viewport-relative map clip the M0 gate uses, so numbers are comparable. */
export function mapClip(vp = VIEWPORT) {
  return {
    x: Math.round(vp.width * 0.46),
    y: Math.round(vp.height * 0.16),
    width: Math.round(vp.width * 0.44),
    height: Math.round(vp.height * 0.62),
  };
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms)));

/* --------------------------------------------------------------- matchers */

/**
 * Match on the PATH only. The first cut of this tested the whole URL, which
 * also matched Google's own `/maps/preview/log204` error beacon -- the beacon
 * body percent-encodes the failing `...mapcore.O.wasm` filename. That silently
 * widened the E2 intervention from "block the wasm" to "block the wasm and
 * suppress Google's telemetry about it", and inflated the wasm request count.
 */
function pathOf(u) {
  try {
    return new URL(u).pathname;
  } catch {
    return String(u);
  }
}
const isWasm = (u) => /\.wasm$/.test(pathOf(u));
const isMapcoreJs = (u) => /^\/maps\/_\/wa\/.*\.js$/.test(pathOf(u));
const isProto = (u) => pathOf(u).startsWith('/maps/vt/proto');

/**
 * `/maps/vt/pb=` is two transports wearing one URL prefix. The format selector
 * sits immediately after the style token:
 *   !1sset!2sRoadmap!4e0!5m1!1e0!23i…              -> server-painted PNG
 *   !1sset!2sRoadmap!4e1!5m4!1e4!8m2!1e0!1e1!…     -> vector tile data
 * Only the `!4e0` form honours `set:RoadmapDark` in the pixels; the `!4e1` form
 * is geometry that the client styles itself, so the dark token is inert there.
 */
export function pbFormat(u) {
  if (!u.includes('/maps/vt/pb=')) return null;
  const m = u.match(/!1sset!2s[A-Za-z_]+!4e(\d)/);
  return m ? `4e${m[1]}` : null;
}
const isPbVector = (u) => pbFormat(u) === '4e1';

/**
 * A FOURTH base-map transport, and the one that broke every earlier reading in
 * this lane: `/maps/vt/stream/pb=!1m7!8m6!1m3!1i{z}!2i{x}!3i{y}!2i{n}!3x{mask}
 * ...!1sset!2sRoadmap!4e1!...`, served as chunked
 * application/vnd.google.octet-stream-compressible. It is a BATCH of vector
 * tiles in one streamed response, and it is what actually paints the map in the
 * non-WASM arm. Both this repo's `vtBucket()` and the shipped DNR rule file it
 * under "other" and leave it alone -- which is why an arm can request 100%
 * RoadmapDark tiles and still render a fully light map.
 */
const isStream = (u) => pathOf(u).startsWith('/maps/vt/stream');

/* ---------------------------------------------------------------- launch */

const COMMON_ARGS = [
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-features=Translate,OptimizationHints',
  '--hide-crash-restore-bubble',
];

async function launch({ profileDir, extensionDir, log, serviceWorkers }) {
  const args = [
    ...COMMON_ARGS,
    ...(extensionDir
      ? [`--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`]
      : []),
  ];
  const ctx = await chromium.launchPersistentContext(profileDir, {
    headless: false,
    viewport: VIEWPORT,
    args,
    ignoreDefaultArgs: ['--disable-extensions'],
    locale: 'en-US',
    timezoneId: 'America/Chicago',
    colorScheme: 'dark',
    /*
     * Maps registers `/maps/preview/sw` roughly a minute into a healthy
     * session. Playwright's context.route does NOT intercept requests a service
     * worker makes, so from that moment on this harness is blind to, and
     * powerless over, any tile the SW fetches -- while context.on('request')
     * may or may not still report it. That is a limitation of THIS harness, not
     * of the product: an extension's declarativeNetRequest sits below the SW
     * and does see those requests. `serviceWorkers: 'block'` removes the
     * variable so a blocking result means what it says.
     */
    ...(serviceWorkers ? { serviceWorkers } : {}),
  });
  log(
    `launch: bundled chromium${extensionDir ? ` + unpacked extension ${extensionDir}` : ''}` +
      `${serviceWorkers ? ` serviceWorkers=${serviceWorkers}` : ''}`
  );
  return ctx;
}

/* ---------------------------------------------------------- interception */

/**
 * Arm the harness-side network intervention.
 *
 * `intervention` fields:
 *   rasterRewrite : boolean          rewrite !2sRoadmap! -> !2sRoadmapDark!
 *   protoRewrite  : boolean          rewrite the protobuf style token too
 *   proto         : 'pass'|'abort'|'blocked'|'empty200'|'404'
 *   wasm          : 'pass'|'abort'|'blocked'|'empty200'
 *   mapcoreJs     : 'pass'|'abort'|'blocked'
 *
 * Runaway guard: every intervention counts its own kills and stops intervening
 * past HARD_CAP so a retry storm cannot hammer Google.
 */
const HARD_CAP = 4000;

export function newStats() {
  return {
    rasterRewritten: 0,
    protoRewritten: 0,
    protoKilled: 0,
    protoPassed: 0,
    pb4e1Killed: 0,
    streamKilled: 0,
    wasmKilled: 0,
    mapcoreJsKilled: 0,
    capHit: false,
    routeErrors: 0,
  };
}

export async function arm(context, intervention, rec, log, stats = newStats()) {

  const kill = async (route, how) => {
    if (how === 'abort') return route.abort();
    if (how === 'blocked') return route.abort('blockedbyclient');
    if (how === 'empty200')
      return route.fulfill({ status: 200, body: '', headers: { 'content-type': 'application/octet-stream' } });
    if (how === '404') return route.fulfill({ status: 404, body: '' });
    return route.continue();
  };

  const needVtRoute =
    intervention.rasterRewrite ||
    intervention.protoRewrite ||
    (intervention.proto && intervention.proto !== 'pass') ||
    (intervention.pb4e1 && intervention.pb4e1 !== 'pass') ||
    (intervention.stream && intervention.stream !== 'pass');

  if (needVtRoute) {
    const { protoUrlWithStyle } = await import('../../lib/bpb.mjs');
    await context.route(
      (u) => String(u).includes('/maps/vt/'),
      async (route) => {
        const url = route.request().url();
        try {
          if (isProto(url)) {
            const mode = intervention.proto ?? 'pass';
            if (mode !== 'pass') {
              if (stats.protoKilled >= HARD_CAP) {
                stats.capHit = true;
                return route.continue();
              }
              stats.protoKilled += 1;
              return await kill(route, mode);
            }
            stats.protoPassed += 1;
            if (intervention.protoRewrite && isProtoTileRequest(url)) {
              const target = protoUrlWithStyle(url, 'RoadmapDark');
              if (target && target !== url) {
                stats.protoRewritten += 1;
                rec.rewrites.set(url, target);
                return await route.continue({ url: target });
              }
            }
            return await route.continue();
          }

          if (intervention.stream && intervention.stream !== 'pass' && isStream(url)) {
            if (stats.streamKilled >= HARD_CAP) {
              stats.capHit = true;
              return route.continue();
            }
            stats.streamKilled += 1;
            return await kill(route, intervention.stream);
          }

          if (intervention.pb4e1 && intervention.pb4e1 !== 'pass' && isPbVector(url)) {
            if (stats.pb4e1Killed >= HARD_CAP) {
              stats.capHit = true;
              return route.continue();
            }
            stats.pb4e1Killed += 1;
            return await kill(route, intervention.pb4e1);
          }

          if (intervention.rasterRewrite && isBaseMapTile(url) && styleToken(url) === 'Roadmap') {
            const target = darkTwin(url);
            if (target && target !== url) {
              stats.rasterRewritten += 1;
              rec.rewrites.set(url, target);
              return await route.continue({ url: target });
            }
          }
          return await route.continue();
        } catch (err) {
          stats.routeErrors += 1;
          try {
            await route.continue();
          } catch {
            /* request already gone */
          }
        }
      }
    );
    log(
      `route armed on /maps/vt/: rasterRewrite=${!!intervention.rasterRewrite} ` +
        `protoRewrite=${!!intervention.protoRewrite} proto=${intervention.proto ?? 'pass'} ` +
        `pb4e1=${intervention.pb4e1 ?? 'pass'} stream=${intervention.stream ?? 'pass'}`
    );
  }

  if (intervention.wasm && intervention.wasm !== 'pass') {
    await context.route(
      (u) => isWasm(String(u)),
      async (route) => {
        const url = route.request().url();
        if (stats.wasmKilled >= 200) {
          stats.capHit = true;
          return route.continue();
        }
        stats.wasmKilled += 1;
        log(`wasm ${intervention.wasm}: ${url}`);
        try {
          return await kill(route, intervention.wasm);
        } catch {
          stats.routeErrors += 1;
          try {
            await route.continue();
          } catch {
            /* gone */
          }
        }
      }
    );
    log(`route armed on *.wasm: ${intervention.wasm}`);
  }

  if (intervention.mapcoreJs && intervention.mapcoreJs !== 'pass') {
    await context.route(
      (u) => isMapcoreJs(String(u)),
      async (route) => {
        const url = route.request().url();
        if (stats.mapcoreJsKilled >= 200) {
          stats.capHit = true;
          return route.continue();
        }
        stats.mapcoreJsKilled += 1;
        log(`mapcore-js ${intervention.mapcoreJs}: ${url}`);
        try {
          return await kill(route, intervention.mapcoreJs);
        } catch {
          stats.routeErrors += 1;
          try {
            await route.continue();
          } catch {
            /* gone */
          }
        }
      }
    );
    log(`route armed on /maps/_/wa/*.js: ${intervention.mapcoreJs}`);
  }

  return stats;
}

/* ------------------------------------------------- capability suppression */

/**
 * The other way to reach the raster transport: do not break the vector
 * renderer's network, make the app never choose it. These run at document_start
 * in the page's MAIN world -- which is exactly what an MV3 content script with
 * `world: "MAIN"`, `run_at: "document_start"` can do, so anything that works
 * here is shippable.
 */
export const INIT_SCRIPTS = {
  'no-wasm': `(() => {
    try { delete globalThis.WebAssembly; } catch (e) {}
    try {
      Object.defineProperty(globalThis, 'WebAssembly', {
        value: undefined, configurable: true, writable: true,
      });
    } catch (e) {}
  })();`,

  'no-offscreen': `(() => {
    try { delete globalThis.OffscreenCanvas; } catch (e) {}
    try { delete HTMLCanvasElement.prototype.transferControlToOffscreen; } catch (e) {}
  })();`,

  'no-webgl': `(() => {
    const orig = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
      if (typeof type === 'string' && /webgl/i.test(type)) return null;
      return orig.call(this, type, ...rest);
    };
    try { delete globalThis.WebGL2RenderingContext; } catch (e) {}
  })();`,
};

/* --------------------------------------------------------------- gestures */

export async function dragPan(page, area, log, { dx = -22, dy = -13, steps = 8 } = {}) {
  const cx = area.x + area.width / 2;
  const cy = area.y + area.height / 2;
  await page.mouse.move(cx, cy, { steps: 4 });
  await sleep(150);
  await page.mouse.down();
  await sleep(120);
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(cx + i * dx, cy + i * dy, { steps: 3 });
    await sleep(45);
  }
  await sleep(120);
  await page.mouse.up();
  log(`gesture: drag-pan (${steps} moves, d=${dx},${dy})`);
}

export async function wheelZoom(page, area, { direction, notches, delta = 240 }, log) {
  const cx = area.x + area.width / 2;
  const cy = area.y + area.height / 2;
  await page.mouse.move(cx, cy, { steps: 2 });
  await sleep(150);
  for (let i = 0; i < notches; i++) {
    await page.mouse.wheel(0, direction === 'in' ? -delta : delta);
    await sleep(260);
  }
  log(`gesture: wheel zoom ${direction} x${notches}`);
}

async function settle(rec, { minMs = 2600, quietMs = 1600, maxMs = 12000 } = {}) {
  const start = Date.now();
  await sleep(minMs);
  while (Date.now() - start < maxMs) {
    if (Date.now() - rec.lastVtAt > quietMs) break;
    await sleep(250);
  }
  return Date.now() - start;
}

/* ------------------------------------------------------------------- flow */

const ERROR_NEEDLES = [
  "can't load Google Maps correctly",
  'cannot load Google Maps',
  'Something went wrong',
  'Try reloading',
  'unable to load',
  'Reload this page',
];

/**
 * Chrome inventory. The map going dark is only half the question; the other
 * half is whether the surrounding application survived. These are looked up by
 * accessible name, which is the only stable handle Maps has left (class names
 * rotate on every Google rebuild).
 */
const CHROME_CONTROLS = {
  zoomIn: '[aria-label="Zoom in"]',
  zoomOut: '[aria-label="Zoom out"]',
  pegman: '[aria-label*="Street View"], [aria-label*="Pegman"]',
  layers: '[aria-label*="Layers"], [aria-label*="imagery"], [aria-label*="street map"]',
  myLocation: '[aria-label*="Your Location"], [aria-label*="your location"]',
  searchBox: 'input[aria-label*="Search"], input#searchboxinput, input[name="q"]',
  directions: '[aria-label="Directions"]',
  categoryChips: '[aria-label="Restaurants"], [aria-label="Hotels"]',
  signIn: 'a[aria-label*="Sign in"], [href*="ServiceLogin"]',
  attribution: 'a[href*="google.com/intl"], [aria-label*="Terms"]',
  menu: '[aria-label="Menu"]',
  tileImgs: 'img[src*="/maps/vt/"]',
};

export async function pageHealth(page) {
  try {
    return await page.evaluate(
      ({ needles, controls }) => {
        const text = document.body ? document.body.innerText : '';
        const found = needles.filter((n) => text.toLowerCase().includes(n.toLowerCase()));
        const present = {};
        for (const [k, sel] of Object.entries(controls)) {
          try {
            present[k] = document.querySelectorAll(sel).length;
          } catch {
            present[k] = 'selector-error';
          }
        }
        return {
          canvases: document.querySelectorAll('canvas').length,
          canvasSizes: [...document.querySelectorAll('canvas')]
            .slice(0, 4)
            .map((c) => `${c.width}x${c.height}`),
          imgs: document.querySelectorAll('img').length,
          /* CSS background images are a paint source that an <img> census misses. */
          bgImages: [...document.querySelectorAll('div,section,canvas')]
            .map((e) => getComputedStyle(e).backgroundImage)
            .filter((v) => v && v !== 'none')
            .map((v) => v.slice(0, 160))
            .slice(0, 15),
          /* What is actually on screen, as opposed to what was requested. If
           * the map is painted by DOM images their srcs say which transport
           * won; if it is painted into a canvas they will be absent. */
          imgSrcs: [...document.querySelectorAll('img')]
            .map((i) => ({
              src: (i.currentSrc || i.src || '').slice(0, 180),
              w: i.naturalWidth,
              h: i.naturalHeight,
              shown: i.offsetWidth * i.offsetHeight > 0,
            }))
            .filter((i) => i.src)
            .slice(0, 25),
          chrome: present,
          errorBannerNeedles: found,
          bodyText: text.slice(0, 500),
          textLength: text.length,
          title: document.title,
        };
      },
      { needles: ERROR_NEEDLES, controls: CHROME_CONTROLS }
    );
  } catch (err) {
    return { error: String(err.message) };
  }
}

/**
 * Run one scenario end to end.
 *
 * cfg = {
 *   label, intervention, extensionDir, phases, series, note
 * }
 */
export async function runScenario(cfg) {
  const {
    label,
    intervention = {},
    extensionDir = null,
    series = [500, 900, 1400, 2000, 3000, 4500, 6000, 9000],
    phases = defaultPhases(),
    note = '',
  } = cfg;

  fs.mkdirSync(ARTIFACTS, { recursive: true });
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), `rasterpin-${label}-`));

  const lines = [];
  const log = (m) => {
    const line = `[${label}] ${m}`;
    lines.push(line);
    // eslint-disable-next-line no-console
    console.log(line);
  };

  const result = {
    label,
    note,
    intervention,
    extensionDir,
    startedAt: new Date().toISOString(),
    profileDir,
    series: [],
    phases: [],
    consoleErrors: [],
    pageErrors: [],
    failedRequests: [],
    bigResponses: [],
    requests: null,
    interventionStats: null,
    health: null,
    errors: [],
    log: lines,
  };

  log(`intervention = ${JSON.stringify(intervention)}${extensionDir ? ` ext=${extensionDir}` : ''}`);

  const context = await launch({
    profileDir,
    extensionDir,
    log,
    serviceWorkers: cfg.serviceWorkers ?? null,
  });
  result.serviceWorkersMode = cfg.serviceWorkers ?? 'allow(default)';
  const rec = new VtRecorder();
  rec.attach(context);

  /* Broad request census: everything, bucketed, so a blocked resource shows up
   * as a real observation rather than an assumption. */
  const census = new Map();
  const wasmSeen = new Set();
  const mapcoreJsSeen = new Set();
  context.on('request', (req) => {
    let u;
    try {
      u = req.url();
    } catch {
      return;
    }
    if (isWasm(u)) wasmSeen.add(u);
    if (isMapcoreJs(u)) mapcoreJsSeen.add(u);
    const key = bucketOf(u);
    census.set(key, (census.get(key) ?? 0) + 1);
  });
  /*
   * Full-traffic census, on demand. The VtRecorder only sees `/maps/vt/`, which
   * is fine until a run renders a complete map while every base-map request it
   * can see was blocked -- at which point "I did not observe the paint source"
   * has to be turned into "here is every byte that arrived".
   */
  if (cfg.fullCensus) {
    context.on('response', async (resp) => {
      try {
        const u = resp.url();
        if (u.startsWith('data:')) return;
        if (result.bigResponses.length >= 300) return;
        const len = Number(resp.headers()['content-length'] ?? 0);
        const ct = resp.headers()['content-type'] ?? '';
        if (len >= 4000 || /image|octet-stream|protobuf/.test(ct)) {
          result.bigResponses.push({
            url: u.slice(0, 260),
            status: resp.status(),
            contentType: ct,
            contentLength: len,
            bucket: bucketOf(u),
          });
        }
      } catch {
        /* response gone */
      }
    });
  }

  context.on('requestfailed', (req) => {
    try {
      if (result.failedRequests.length < 400)
        result.failedRequests.push({
          url: req.url().slice(0, 200),
          failure: req.failure()?.errorText ?? null,
          bucket: bucketOf(req.url()),
        });
    } catch {
      /* ignore */
    }
  });

  /*
   * `delayMs` is a diagnostic, not a shippable shape: arm the /maps/vt/ route
   * only after the app has had time to finish mounting. It separates "blocking
   * the vector transport breaks the chrome" from "blocking it during bootstrap
   * breaks the chrome" -- two very different problems.
   */
  const stats = newStats();
  const vtIntervention = { ...intervention };
  const deferVt = Number(intervention.delayMs) > 0;
  if (deferVt) {
    await arm(
      context,
      { ...intervention, rasterRewrite: false, protoRewrite: false, proto: 'pass', pb4e1: 'pass' },
      rec,
      log,
      stats
    );
    log(`vt route DEFERRED until +${intervention.delayMs}ms`);
  } else {
    await arm(context, intervention, rec, log, stats);
  }
  result.interventionStats = stats;

  if (intervention.initScript) {
    const src = INIT_SCRIPTS[intervention.initScript];
    if (!src) throw new Error(`unknown initScript "${intervention.initScript}"`);
    await context.addInitScript({ content: src });
    log(`init script armed (document_start, MAIN world): ${intervention.initScript}`);
  }

  try {
    if (extensionDir) {
      let sw = context.serviceWorkers()[0] ?? null;
      if (!sw) {
        try {
          sw = await context.waitForEvent('serviceworker', { timeout: 20000 });
        } catch {
          sw = null;
        }
      }
      if (sw) {
        result.serviceWorkerUrl = sw.url();
        const m = sw.url().match(/^chrome-extension:\/\/([a-p]+)\//);
        result.extensionId = m ? m[1] : null;
        log(`extension service worker: ${sw.url()}`);
        try {
          result.dnrProbe = await sw.evaluate(async () => {
            const out = {};
            try {
              out.enabledRulesets = await chrome.declarativeNetRequest.getEnabledRulesets();
            } catch (e) {
              out.enabledRulesetsError = String(e);
            }
            return out;
          });
          log(`dnr enabled rulesets: ${JSON.stringify(result.dnrProbe)}`);
        } catch (e) {
          result.dnrProbe = { error: String(e.message) };
        }
      } else {
        log('extension service worker NOT observed in 20s');
      }
    }

    const page = context.pages()[0] ?? (await context.newPage());
    await page.setViewportSize(VIEWPORT);
    const area = mapClip(VIEWPORT);

    page.on('console', (msg) => {
      if (msg.type() !== 'error') return;
      if (result.consoleErrors.length < 200) result.consoleErrors.push(msg.text().slice(0, 300));
    });
    page.on('pageerror', (err) => {
      if (result.pageErrors.length < 100) result.pageErrors.push(String(err.message).slice(0, 300));
    });

    rec.setPhase('navigate');
    const t0 = Date.now();
    await page.goto(MAPS_URL, { waitUntil: 'domcontentloaded', timeout: 90000 });
    log(`goto returned at +${Date.now() - t0}ms -> ${page.url()}`);
    if (/consent\.google\.|\/sorry\//.test(page.url())) {
      result.consentWall = page.url();
      log(`CONSENT/INTERSTITIAL WALL: ${page.url()}`);
    }

    /* --- time series anchored to t0, not to the previous frame ------------- */
    let vtArmed = !deferVt;
    rec.setPhase('first-paint');
    for (const target of series) {
      await sleep(target - (Date.now() - t0));
      if (!vtArmed && Date.now() - t0 >= Number(intervention.delayMs)) {
        await arm(
          context,
          { ...vtIntervention, wasm: 'pass', mapcoreJs: 'pass' },
          rec,
          log,
          stats
        );
        vtArmed = true;
        log(`vt route armed late at +${Date.now() - t0}ms`);
      }
      const atMs = Date.now() - t0;
      try {
        const buf = await page.screenshot({ clip: area });
        const name = `${label}-t${String(target).padStart(5, '0')}.png`;
        fs.writeFileSync(path.join(ARTIFACTS, name), buf);
        const px = analyse(buf);
        result.series.push({
          targetMs: target,
          atMs,
          screenshot: `test/experiments/raster-pin/artifacts/${name}`,
          pixels: px,
        });
        log(
          `t=${String(target).padStart(5)}ms (actual ${String(atMs).padStart(5)}) ` +
            `meanRGB=(${px.r}, ${px.g}, ${px.b}) lum=${px.luminance} ` +
            `${px.isDark ? 'DARK' : px.isLight ? 'LIGHT' : 'AMBIGUOUS'}`
        );
      } catch (err) {
        log(`series t=${target}ms screenshot failed: ${err.message}`);
        result.series.push({ targetMs: target, atMs, error: err.message });
      }
    }

    await page.waitForLoadState('networkidle', { timeout: 45000 }).catch(() => {
      log('networkidle not reached in 45s (live Maps keeps polling; continuing)');
    });

    if (!vtArmed) {
      await sleep(Number(intervention.delayMs) - (Date.now() - t0));
      await arm(context, { ...vtIntervention, wasm: 'pass', mapcoreJs: 'pass' }, rec, log, stats);
      vtArmed = true;
      log(`vt route armed late at +${Date.now() - t0}ms (post-networkidle)`);
      const buf = await page.screenshot({ clip: area });
      fs.writeFileSync(path.join(ARTIFACTS, `${label}-at-arm.png`), buf);
      const px = analyse(buf);
      result.atArmFrame = { atMs: Date.now() - t0, pixels: px };
      log(`at-arm meanRGB=(${px.r}, ${px.g}, ${px.b}) lum=${px.luminance}`);
      result.healthAtArm = await pageHealth(page);
      log(`health at arm: chrome=${JSON.stringify(result.healthAtArm.chrome)} textLen=${result.healthAtArm.textLength}`);
    }

    for (const ph of phases) {
      rec.setPhase(ph.name);
      const before = rec.count;
      const zoomsBefore = new Set(rec.records.map((r) => r.url).map(tileZoomOf));
      let gestureError = null;
      if (ph.gesture) {
        try {
          await ph.gesture(page, area, log);
        } catch (err) {
          gestureError = String(err.message);
          log(`gesture ${ph.name} FAILED: ${err.message}`);
        }
      }
      const settled = await settle(rec, ph.settle);
      const shot = `${label}-${ph.name}.png`;
      const buf = await page.screenshot({ clip: area });
      fs.writeFileSync(path.join(ARTIFACTS, shot), buf);
      const px = analyse(buf);
      const uz = urlZoom(page.url());

      const during = rec.records.slice(before);
      const kinds = { raster: 0, proto: 0, other: 0 };
      const zoomsSeen = new Set();
      for (const r of during) {
        const k = baseMapKind(r.url);
        if (k === 'raster') kinds.raster += 1;
        else if (k === 'proto') kinds.proto += 1;
        else kinds.other += 1;
        const z = tileZoomOf(r.url);
        if (Number.isFinite(z)) zoomsSeen.add(z);
      }

      const entry = {
        phase: ph.name,
        settleMs: settled,
        gestureError,
        vtDuringPhase: rec.count - before,
        baseMapDuringPhase: kinds,
        zoomsDuringPhase: [...zoomsSeen].sort((a, b) => a - b),
        pageUrl: page.url(),
        urlZoom: uz?.zoom ?? null,
        screenshot: `test/experiments/raster-pin/artifacts/${shot}`,
        pixels: px,
      };
      if (ph.probe) {
        try {
          entry.probe = await ph.probe(page, log);
        } catch (err) {
          entry.probe = { error: String(err.message) };
        }
      }
      result.phases.push(entry);
      log(
        `phase ${ph.name.padEnd(14)} urlZoom=${String(uz?.zoom ?? '?').padStart(5)} ` +
          `vt+${String(entry.vtDuringPhase).padStart(4)} ` +
          `raster=${String(kinds.raster).padStart(3)} proto=${String(kinds.proto).padStart(3)} ` +
          `zooms=[${entry.zoomsDuringPhase.join(',')}] ` +
          `meanRGB=(${px.r}, ${px.g}, ${px.b}) lum=${px.luminance} ` +
          `${px.isDark ? 'DARK' : px.isLight ? 'LIGHT' : 'AMBIGUOUS'}`
      );
      void zoomsBefore;
    }

    result.health = await pageHealth(page);
    /* A page service worker would fetch tiles outside context.route's reach,
     * which would make every "blocked" count above a claim rather than a fact. */
    result.pageServiceWorkers = context
      .serviceWorkers()
      .map((w) => w.url())
      .filter((u) => !u.startsWith('chrome-extension://'));
    log(`page service workers: ${JSON.stringify(result.pageServiceWorkers)}`);
    log(`health: ${JSON.stringify({ ...result.health, imgSrcs: undefined, bodyText: undefined })}`);
    log(`imgSrcs: ${JSON.stringify(result.health.imgSrcs)}`);
    result.finalPageUrl = page.url();
    const full = path.join(ARTIFACTS, `${label}-fullwindow.png`);
    fs.writeFileSync(full, await page.screenshot());
    result.fullWindowScreenshot = `test/experiments/raster-pin/artifacts/${label}-fullwindow.png`;
  } catch (err) {
    result.errors.push(String(err && err.stack ? err.stack : err));
    log(`ERROR: ${err.message}`);
  } finally {
    result.interventionStats = { ...stats };
    result.wasmRequests = [...wasmSeen];
    result.mapcoreJsRequests = [...mapcoreJsSeen].slice(0, 20);
    result.requestCensus = Object.fromEntries(
      [...census.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40)
    );
    const analysed = await rec.analyse().catch((e) => {
      result.errors.push(`analyse: ${e.message}`);
      return [];
    });
    result.requests = summarise(analysed);
    result.requestLog = analysed.slice(0, 1200).map((r) => ({
      url: r.url.slice(0, 220),
      phase: r.phase,
      at: r.at,
      bucket: r.bucket,
      kind: r.kind,
      token: r.token,
      zoom: r.zoom,
      status: r.status,
      terminal: r.terminal,
    }));
    await context.close().catch(() => {});
    try {
      fs.rmSync(profileDir, { recursive: true, force: true, maxRetries: 3 });
    } catch {
      /* Windows sometimes holds the profile; it is in os.tmpdir() */
    }
    result.finishedAt = new Date().toISOString();
    fs.mkdirSync(ARTIFACTS, { recursive: true });
    fs.writeFileSync(
      path.join(ARTIFACTS, `result-${label}.json`),
      JSON.stringify(result, null, 2)
    );
    log(`wrote test/experiments/raster-pin/artifacts/result-${label}.json`);
  }

  return result;
}

function bucketOf(u) {
  if (isWasm(u)) return 'wasm';
  if (isMapcoreJs(u)) return 'mapcore-js';
  if (u.includes('/maps/vt/stream')) return 'vt-stream';
  if (u.includes('/maps/vt/proto')) return 'vt-proto';
  if (u.includes('/maps/vt/pb=')) return 'vt-raster-pb';
  if (u.includes('/maps/vt/')) return 'vt-other';
  if (u.includes('/maps/preview/')) return 'maps-preview-rpc';
  if (u.includes('/maps/_/')) return 'maps-underscore';
  if (u.includes('gen_204')) return 'gen_204';
  try {
    return new URL(u).origin;
  } catch {
    return 'other';
  }
}

export function defaultPhases() {
  return [
    { name: 'settled', gesture: null },
    { name: 'pan', gesture: (p, a, l) => dragPan(p, a, l) },
    { name: 'zoom-in-1', gesture: (p, a, l) => wheelZoom(p, a, { direction: 'in', notches: 3 }, l) },
    { name: 'zoom-in-2', gesture: (p, a, l) => wheelZoom(p, a, { direction: 'in', notches: 3 }, l) },
    { name: 'zoom-out', gesture: (p, a, l) => wheelZoom(p, a, { direction: 'out', notches: 4 }, l) },
  ];
}

/** One-line summary line used by every runner. */
export function summaryLine(result) {
  const s = result.series.map((f) => `${f.targetMs}:${f.pixels ? f.pixels.luminance : 'ERR'}`).join(' ');
  const p = result.phases.map((f) => `${f.phase}:${f.pixels.luminance}`).join(' ');
  return `${result.label}\n  series lum  ${s}\n  phase  lum  ${p}\n  byKind ${JSON.stringify(
    result.requests?.byKind ?? null
  )}`;
}
