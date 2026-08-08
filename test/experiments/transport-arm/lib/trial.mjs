/**
 * LANE E -- transport-arm investigation.
 *
 * One trial = one fresh temp profile, one navigation to Google Maps, ~N seconds
 * of passive observation (no gestures), close. The only thing a trial decides is
 * which base-map transport the session was given:
 *
 *   'proto'  -- /maps/vt/proto?bpb=<protobuf> carried base-map data
 *   'raster' -- no proto at all, and raster /maps/vt/pb= tiles kept coming after
 *               the server-rendered first-paint batch
 *   'raster-firstpaint-only' -- only the initial batch arrived; ambiguous
 *   'none'   -- no base-map traffic at all (navigation failed / consent wall)
 *
 * The first-paint batch matters: BOTH arms begin with the same ~24 raster tiles
 * that the Maps HTML itself points at. Counting raster tiles alone therefore
 * cannot tell the arms apart; only what happens after the batch can.
 *
 * Every request the context makes is recorded, not just /maps/vt/, because the
 * mapcore WASM fetch is the thing most likely to explain the split and it lives
 * under /maps/_/wa/.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, firefox } from '@playwright/test';

import { baseMapKind, styleTokenOf, tileZoomOf, vtBucket, isVtRequest } from '../../../lib/tiles.mjs';
import { analyse } from '../../../lib/image.mjs';

export const MAPS_URL = 'https://www.google.com/maps/@29.7604,-95.3698,12z';
export const HERE = path.dirname(new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const COMMON_CHROMIUM_ARGS = [
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-features=Translate,OptimizationHints',
  '--hide-crash-restore-bubble',
];

function freshProfileDir(tag) {
  const dir = path.join(
    os.tmpdir(),
    'lane-e-profiles',
    `${tag}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
  );
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * @param {object} v variant
 * @param {string} v.name
 * @param {'chromium'|'firefox'} [v.browser]
 * @param {boolean} [v.headless]
 * @param {string[]} [v.args]            extra browser args
 * @param {object} [v.firefoxUserPrefs]
 * @param {string} [v.url]               page to open
 * @param {string} [v.initScript]        MAIN-world script run at document_start
 * @param {RegExp[]} [v.abortMatching]   requests to fail (capability denial)
 * @param {number} [v.observeMs]
 * @param {string} [v.userAgent]
 * @param {'light'|'dark'|'no-preference'} [v.colorScheme]
 * @param {object} [v.geo]               { locale, timezoneId }
 * @param {Array<object>} [v.cookies]
 * @param {boolean} [v.keepProfile]
 */
export async function runTrial(v) {
  const browserName = v.browser ?? 'chromium';
  const observeMs = v.observeMs ?? 12000;
  const profileDir = freshProfileDir(v.name);
  const started = Date.now();

  const out = {
    variant: v.name,
    browser: browserName,
    headless: v.headless ?? false,
    url: v.url ?? MAPS_URL,
    startedAt: new Date().toISOString(),
    profileDir,
    ok: false,
    error: null,
    consentWall: false,
    finalPageUrl: null,
    gEp: null,
    counts: {},
    arm: 'none',
    firstProtoAtMs: null,
    firstRasterAtMs: null,
    lastBaseMapAtMs: null,
    rasterZooms: [],
    protoZooms: [],
    styleTokens: {},
    wasmRequests: [],
    workerScripts: [],
    vtBuckets: {},
    nonVtSample: [],
    webgl: null,
    caps: null,
    cookies: [],
    experimentIds: [],
    allRequests: [],
  };

  let context = null;
  try {
    const base = {
      headless: v.headless ?? false,
      viewport: { width: 1440, height: 900 },
      locale: v.geo?.locale ?? 'en-US',
      timezoneId: v.geo?.timezoneId ?? 'America/Chicago',
      colorScheme: v.colorScheme ?? 'dark',
    };
    if (v.userAgent) base.userAgent = v.userAgent;

    if (browserName === 'firefox') {
      context = await firefox.launchPersistentContext(profileDir, {
        ...base,
        firefoxUserPrefs: {
          'browser.shell.checkDefaultBrowser': false,
          ...(v.firefoxUserPrefs ?? {}),
        },
      });
    } else {
      const extArgs = v.extensionDir
        ? [`--disable-extensions-except=${v.extensionDir}`, `--load-extension=${v.extensionDir}`]
        : [];
      context = await chromium.launchPersistentContext(profileDir, {
        ...base,
        args: [...COMMON_CHROMIUM_ARGS, ...extArgs, ...(v.args ?? [])],
        ignoreDefaultArgs: ['--disable-extensions'],
      });
      if (v.extensionDir) {
        // Wait for the service worker so the ruleset is definitely live, then
        // read back what Chrome actually loaded -- an invalid rule is silent.
        const sw =
          context.serviceWorkers()[0] ??
          (await context.waitForEvent('serviceworker', { timeout: 10000 }).catch(() => null));
        out.extension = { serviceWorker: sw ? sw.url() : null };
        if (sw) {
          out.extension.state = await sw
            .evaluate(async () => ({
              enabledRulesets: await chrome.declarativeNetRequest.getEnabledRulesets(),
              testMatch: await chrome.declarativeNetRequest.testMatchOutcome({
                url: 'https://www.gstatic.com/maps/res/CompactLegend-Roadmap-4311471e3660cd049e8ede59d279b3ba',
                type: 'xmlhttprequest',
                initiator: 'https://www.google.com',
                method: 'get',
              }),
              testMatchDarkAgain: await chrome.declarativeNetRequest.testMatchOutcome({
                url: 'https://www.gstatic.com/maps/res/CompactLegend-RoadmapDark-4311471e3660cd049e8ede59d279b3ba',
                type: 'xmlhttprequest',
                initiator: 'https://www.google.com',
                method: 'get',
              }),
            }))
            .catch((e) => ({ error: String(e) }));
        }
      }
    }

    if (v.cookies?.length) await context.addCookies(v.cookies);
    if (v.initScript) await context.addInitScript({ content: v.initScript });

    const t0 = Date.now();
    const rec = [];
    context.on('request', (req) => {
      let url;
      try {
        url = req.url();
      } catch {
        return;
      }
      rec.push({ url, at: Date.now() - t0, type: safe(() => req.resourceType()) });
    });

    if (v.abortMatching?.length || v.rewrite?.length) {
      out.blocked = [];
      out.rewritten = [];
      await context.route('**/*', async (route) => {
        const u = route.request().url();
        if (v.abortMatching?.some((re) => re.test(u))) {
          out.blocked.push(u.slice(0, 200));
          await route.abort('failed');
          return;
        }
        for (const r of v.rewrite ?? []) {
          if (r.fn) {
            const nu = r.fn(u);
            if (nu && nu !== u) {
              out.rewritten.push(`${u.slice(0, 100)} -> ${nu.slice(0, 100)}`);
              await route.continue({ url: nu });
              return;
            }
            continue;
          }
          if (r.from.test(u)) {
            const nu = u.replace(r.from, r.to);
            if (nu !== u) {
              out.rewritten.push(`${u.slice(0, 120)} -> ${nu.slice(0, 120)}`);
              await route.continue({ url: nu });
              return;
            }
          }
        }
        await route.continue();
      });
    }

    if (v.sampleTileBodies) {
      out.tileBodies = [];
      const wanted = v.sampleTileBodies;
      context.on('response', async (res) => {
        try {
          const u = res.url();
          if (baseMapKind(u) !== 'raster') return;
          if (out.tileBodies.length >= wanted) return;
          const slot = out.tileBodies.push({ url: u.slice(-70), status: res.status() }) - 1;
          const body = await res.body();
          out.tileBodies[slot].bytes = body.length;
          out.tileBodies[slot].mean = body.length > 500 ? analyse(body) : 'too-small(error tile?)';
        } catch (e) {
          /* body unavailable */
        }
      });
    }

    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto(out.url, { waitUntil: 'domcontentloaded', timeout: 90000 });
    if (/consent\.google\.|\/sorry\//.test(page.url())) out.consentWall = true;

    // Passive observation. Stop early once the arm is unambiguous AND traffic
    // has gone quiet, so a decided trial does not keep hitting Google.
    const deadline = Date.now() + observeMs;
    for (;;) {
      await sleep(500);
      if (Date.now() > deadline) break;
      const cls = classify(rec);
      if (!v.screenshot && cls.arm === 'proto' && Date.now() - t0 > 7000) break;
    }

    // Stickiness probe: repeat the navigation inside the SAME profile and
    // classify each pass independently, so a per-session re-roll would show up
    // as a mixed sequence.
    if (v.navigations && v.navigations > 1) {
      out.passes = [{ ...classify(rec), navAtMs: 0 }];
      for (let n = 1; n < v.navigations; n++) {
        const mark = rec.length;
        const navAt = Date.now() - t0;
        await page.goto(out.url, { waitUntil: 'domcontentloaded', timeout: 90000 });
        const end = Date.now() + (v.perNavMs ?? 9000);
        while (Date.now() < end) await sleep(500);
        out.passes.push({ ...classify(rec.slice(mark)), navAtMs: navAt });
      }
    }

    out.finalPageUrl = page.url();
    const gm = out.finalPageUrl.match(/[?&]g_ep=([^&]+)/);
    out.gEp = gm ? decodeURIComponent(gm[1]) : null;

    if (v.screenshot) {
      const clip = {
        x: Math.round(1440 * 0.46),
        y: Math.round(900 * 0.16),
        width: Math.round(1440 * 0.44),
        height: Math.round(900 * 0.62),
      };
      const buf = await page.screenshot({ clip });
      out.pixels = analyse(buf);
      if (v.screenshotDir) {
        fs.mkdirSync(v.screenshotDir, { recursive: true });
        out.screenshot = path.join(v.screenshotDir, `${v.name}-${Date.now().toString(36)}.png`);
        fs.writeFileSync(out.screenshot, buf);
        if (v.fullShot) {
          const full = await page.screenshot();
          out.fullScreenshot = out.screenshot.replace(/\.png$/, '-full.png');
          fs.writeFileSync(out.fullScreenshot, full);
        }
      }
    }

    out.webgl = await page
      .evaluate(() => {
        const r = { webgl1: false, webgl2: false, renderer: null, vendor: null };
        try {
          const c = document.createElement('canvas');
          const g2 = c.getContext('webgl2');
          const g1 = g2 ?? c.getContext('webgl');
          r.webgl2 = !!g2;
          r.webgl1 = !!g1;
          if (g1) {
            const d = g1.getExtension('WEBGL_debug_renderer_info');
            r.renderer = d ? g1.getParameter(d.UNMASKED_RENDERER_WEBGL) : g1.getParameter(g1.RENDERER);
            r.vendor = d ? g1.getParameter(d.UNMASKED_VENDOR_WEBGL) : g1.getParameter(g1.VENDOR);
          }
        } catch (e) {
          r.error = String(e);
        }
        return r;
      })
      .catch((e) => ({ error: String(e) }));

    out.caps = await page
      .evaluate(() => ({
        ua: navigator.userAgent,
        hardwareConcurrency: navigator.hardwareConcurrency,
        deviceMemory: navigator.deviceMemory ?? null,
        offscreenCanvas: typeof OffscreenCanvas !== 'undefined',
        wasm: typeof WebAssembly !== 'undefined',
        wasmStreaming: typeof WebAssembly !== 'undefined' && typeof WebAssembly.instantiateStreaming === 'function',
        sab: typeof SharedArrayBuffer !== 'undefined',
        crossOriginIsolated: self.crossOriginIsolated,
        dpr: devicePixelRatio,
      }))
      .catch((e) => ({ error: String(e) }));

    out.cookies = (await context.cookies()).map((c) => ({
      name: c.name,
      domain: c.domain,
      len: String(c.value).length,
      value: c.name === 'SOCS' || c.name === 'AEC' ? c.value : undefined,
    }));

    Object.assign(out, classify(rec));
    out.allRequests = rec;
    out.ok = true;
  } catch (err) {
    out.error = String(err && err.stack ? err.stack.split('\n')[0] : err);
  } finally {
    try {
      if (context) await context.close();
    } catch {
      /* ignore */
    }
    if (!v.keepProfile) {
      try {
        fs.rmSync(profileDir, { recursive: true, force: true, maxRetries: 3 });
      } catch {
        /* ignore */
      }
    }
  }
  out.durationMs = Date.now() - started;
  return out;
}

function safe(fn) {
  try {
    return fn();
  } catch {
    return null;
  }
}

/** Derive arm + counters from a raw request list. Pure, so it can be re-run on stored data. */
export function classify(rec) {
  const counts = { raster: 0, proto: 0, vt: 0, total: rec.length, rasterAfterFirstProto: 0 };
  const rasterZooms = new Set();
  const protoZooms = new Set();
  const styleTokens = {};
  const vtBuckets = {};
  const wasmRequests = [];
  const workerScripts = [];
  const expIds = new Set();
  let firstProtoAtMs = null;
  let firstRasterAtMs = null;
  let lastBaseMapAtMs = null;
  const rasterAts = [];

  const rendererModules = new Set();
  const wasmModules = new Set();
  for (const r of rec) {
    if (/\.wasm(\?|$)/.test(r.url) || /mapcore/.test(r.url)) wasmRequests.push({ url: r.url.slice(0, 160), at: r.at });
    const wm = r.url.match(/\/maps\/_\/js\/k=maps\.w\.[^/]*\/[^?]*\/m=([a-zA-Z0-9,_]+)/);
    if (wm) for (const m of wm[1].split(',')) rendererModules.add(m);
    const wa = r.url.match(/\/maps\/_\/wa\/w\.[^.]+\.([A-Za-z]+)\.O\./);
    if (wa) wasmModules.add(wa[1]);
    if (r.type === 'script' && /worker/i.test(r.url)) workerScripts.push(r.url.slice(0, 160));
    if (!isVtRequest(r.url)) continue;
    counts.vt++;
    const b = vtBucket(r.url);
    vtBuckets[b] = (vtBuckets[b] ?? 0) + 1;
    const kind = baseMapKind(r.url);
    if (!kind) continue;
    lastBaseMapAtMs = r.at;
    const tok = styleTokenOf(r.url) ?? '?';
    styleTokens[tok] = (styleTokens[tok] ?? 0) + 1;
    const z = tileZoomOf(r.url);
    if (kind === 'raster') {
      counts.raster++;
      rasterAts.push(r.at);
      if (firstRasterAtMs === null) firstRasterAtMs = r.at;
      if (z != null) rasterZooms.add(z);
      for (const m of r.url.matchAll(/!23i(\d+)/g)) expIds.add(Number(m[1]));
    } else {
      counts.proto++;
      if (firstProtoAtMs === null) firstProtoAtMs = r.at;
      if (z != null) protoZooms.add(z);
    }
  }
  if (firstProtoAtMs !== null) {
    counts.rasterAfterFirstProto = rasterAts.filter((a) => a > firstProtoAtMs + 500).length;
  }

  let arm;
  if (counts.proto > 0) arm = 'proto';
  else if (counts.raster > 30) arm = 'raster';
  else if (counts.raster > 0) arm = 'raster-firstpaint-only';
  else arm = 'none';

  return {
    arm,
    counts,
    firstProtoAtMs,
    firstRasterAtMs,
    lastBaseMapAtMs,
    rasterZooms: [...rasterZooms].sort((a, b) => a - b),
    protoZooms: [...protoZooms].sort((a, b) => a - b),
    styleTokens,
    vtBuckets,
    wasmRequests,
    workerScripts,
    rendererModules: [...rendererModules].sort(),
    wasmModules: [...wasmModules].sort(),
    experimentIds: [...expIds].sort((a, b) => a - b),
  };
}

/** Trim a trial record for the summary file (drops the full request list). */
export function slim(t) {
  const { allRequests, ...rest } = t;
  return {
    ...rest,
    nonVtSample: (allRequests ?? [])
      .filter((r) => !isVtRequest(r.url) && /\/maps\//.test(r.url))
      .slice(0, 40)
      .map((r) => `${r.at}ms ${r.type} ${r.url.slice(0, 150)}`),
  };
}
