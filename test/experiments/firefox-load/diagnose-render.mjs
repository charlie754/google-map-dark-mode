#!/usr/bin/env node
/**
 * Why is the Firefox map light at 2.1s when 100% of the tile requests Playwright
 * can see were rewritten to RoadmapDark?
 *
 * Two instruments Playwright alone does not provide:
 *
 *  1. A `webRequest` logger add-on (probe-ext/). `webRequest` sits below the
 *     Web Worker boundary, so it sees the mapcore worker's fetches. If Firefox
 *     really is in the raster arm, this is what proves it -- and if Playwright's
 *     request stream has been blind to a whole transport, this is what exposes
 *     it.
 *  2. A DOM inventory of the map surface: canvases vs <img> tiles vs CSS
 *     backgrounds, with sizes and stacking, sampled before and after the moment
 *     the pixels go light.
 *
 * Usage: node test/experiments/firefox-load/diagnose-render.mjs [shipped|variant|none]
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { firefox } from '@playwright/test';
import { connectWithRetry, installTemporaryAddon, RdpClient } from './rdp.mjs';
import { analyse } from '../../lib/image.mjs';
import { mapClip, VIEWPORT, MAPS_URL } from '../../lib/gate.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..');
const ART = path.join(HERE, 'artifacts');
const LOGGER = path.join(HERE, 'probe-ext');
const which = process.argv[2] ?? 'variant';
const EXT =
  which === 'variant'
    ? path.join(HERE, 'ext-variant')
    : which === 'shipped'
      ? path.join(ROOT, 'dist', 'firefox')
      : null;
const PORT = Number(process.env.RDP_PORT ?? 6180);

/**
 * The id of whichever build is under test, read from its own manifest rather
 * than hard-coded. A single literal cannot be right for both any more:
 * `ext-variant/` is frozen on `maps-noir@local.test` while `dist/firefox` now
 * carries the AMO id.
 */
const GECKO_ID = EXT
  ? JSON.parse(fs.readFileSync(path.join(EXT, 'manifest.json'), 'utf8'))
      ?.browser_specific_settings?.gecko?.id
  : null;

fs.mkdirSync(ART, { recursive: true });
const profiles = path.join(ROOT, 'test', '.profiles');
fs.mkdirSync(profiles, { recursive: true });
const profileDir = fs.mkdtempSync(path.join(profiles, 'ffdiag-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms)));

const ctx = await firefox.launchPersistentContext(profileDir, {
  headless: false,
  viewport: VIEWPORT,
  locale: 'en-US',
  timezoneId: 'America/Chicago',
  colorScheme: 'dark',
  args: ['-start-debugger-server', String(PORT)],
  firefoxUserPrefs: {
    'devtools.debugger.remote-enabled': true,
    'devtools.debugger.prompt-connection': false,
    'devtools.chrome.enabled': true,
    'xpinstall.signatures.required': false,
    'browser.shell.checkDefaultBrowser': false,
  },
});

const { client } = await connectWithRetry(PORT, { attempts: 30, delayMs: 500 });

// Logger first, so it is armed before the add-on under test does anything.
const logger = await installTemporaryAddon(client, LOGGER);
console.log(`logger installed: ${JSON.stringify(logger.addon)}`);
const loggerEntry = logger.listed.find((a) => a.id === 'lane-d-logger@local.test');

let underTest = null;
if (EXT) {
  const r = await installTemporaryAddon(client, EXT);
  const e = r.listed.find((a) => a.id === GECKO_ID);
  underTest = e;
  console.log(
    `under test (${which}) installed: temporarilyInstalled=${e?.temporarilyInstalled} bg=${e?.backgroundScriptStatus}`
  );
}
console.log(`logger entry: temporarilyInstalled=${loggerEntry?.temporarilyInstalled} bg=${loggerEntry?.backgroundScriptStatus} warnings=${JSON.stringify(loggerEntry?.warnings)}`);

const area = mapClip(VIEWPORT);
const page = ctx.pages()[0] ?? (await ctx.newPage());
await page.setViewportSize(VIEWPORT);

const DOM_PROBE = `(() => {
  const info = { url: location.href, dpr: devicePixelRatio };
  const vis = (el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return {
      rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
      display: cs.display, visibility: cs.visibility, opacity: cs.opacity,
      zIndex: cs.zIndex, filter: cs.filter, background: cs.backgroundColor,
    };
  };
  info.canvases = [...document.querySelectorAll('canvas')].map((c) => ({
    w: c.width, h: c.height, cls: c.className, ...vis(c),
  }));
  const imgs = [...document.querySelectorAll('img')].filter((i) => /\\/maps\\/vt\\//.test(i.src || ''));
  info.vtImgCount = imgs.length;
  info.vtImgSample = imgs.slice(0, 6).map((i) => ({ src: i.src.slice(0, 220), w: i.naturalWidth, h: i.naturalHeight, ...vis(i) }));
  const bgEls = [...document.querySelectorAll('*')].filter((e) => {
    const b = getComputedStyle(e).backgroundImage;
    return b && b.includes('/maps/vt/');
  });
  info.vtBackgroundCount = bgEls.length;
  info.vtBackgroundSample = bgEls.slice(0, 6).map((e) => ({
    tag: e.tagName, cls: e.className,
    bg: getComputedStyle(e).backgroundImage.slice(0, 260), ...vis(e),
  }));
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2') || c.getContext('webgl');
    if (gl) {
      const dbg = gl.getExtension('WEBGL_debug_renderer_info');
      info.webgl = {
        version: gl.getParameter(gl.VERSION),
        vendor: dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
        renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
      };
    } else info.webgl = null;
  } catch (e) { info.webglError = String(e); }
  info.offscreenCanvas = typeof OffscreenCanvas !== 'undefined';
  info.resourceEntries = performance.getEntriesByType('resource')
    .filter((e) => /\\/maps\\/vt\\//.test(e.name))
    .map((e) => ({ name: e.name.slice(0, 200), size: e.transferSize, decoded: e.decodedBodySize, init: e.initiatorType, start: Math.round(e.startTime) }));
  return info;
})()`;

const dumps = {};
async function snap(tag) {
  const buf = await page.screenshot({ clip: area });
  fs.writeFileSync(path.join(ART, `diag-${which}-${tag}.png`), buf);
  const px = analyse(buf);
  const dom = await page.evaluate(DOM_PROBE).catch((e) => ({ error: String(e) }));
  dumps[tag] = { pixels: px, dom };
  console.log(
    `\n[${tag}] meanRGB=(${px.r}, ${px.g}, ${px.b}) lum=${px.luminance} ${px.isDark ? 'DARK' : px.isLight ? 'LIGHT' : 'AMBIGUOUS'}`
  );
  console.log(`  canvases: ${JSON.stringify(dom.canvases)}`);
  console.log(`  vt <img>: ${dom.vtImgCount}  vt css-bg: ${dom.vtBackgroundCount}`);
  if (dom.vtImgCount) console.log(`  img sample: ${JSON.stringify(dom.vtImgSample, null, 1).slice(0, 1200)}`);
  if (dom.vtBackgroundCount) console.log(`  bg sample: ${JSON.stringify(dom.vtBackgroundSample, null, 1).slice(0, 1200)}`);
  console.log(`  webgl: ${JSON.stringify(dom.webgl)} offscreenCanvas=${dom.offscreenCanvas}`);
  console.log(`  perf vt entries: ${dom.resourceEntries?.length ?? 0}`);
}

const t0 = Date.now();
await page.goto(MAPS_URL, { waitUntil: 'domcontentloaded', timeout: 90000 });
await sleep(800 - (Date.now() - t0));
await snap('t800');
await sleep(4000 - (Date.now() - t0));
await snap('t4000');

// One pan, then look again.
const cx = area.x + area.width / 2;
const cy = area.y + area.height / 2;
await page.mouse.move(cx, cy, { steps: 4 });
await page.mouse.down();
for (let i = 1; i <= 8; i++) {
  await page.mouse.move(cx - i * 22, cy - i * 13, { steps: 3 });
  await sleep(45);
}
await page.mouse.up();
await sleep(4000);
await snap('after-pan');

/* --- read the logger's ground-truth request list -------------------------- */
async function evalIn(descriptorActor, expr) {
  const w = await client.request({ to: descriptorActor, type: 'getWatcher' }, { timeoutMs: 15000 });
  const watcher = w.actor ?? w.watcher ?? w?.form?.actor;
  const before = client.notifications.length;
  await client.request({ to: watcher, type: 'watchTargets', targetType: 'frame' }, { timeoutMs: 20000 });
  await sleep(1500);
  const form = client.notifications
    .slice(before)
    .filter((n) => n.type === 'target-available-form')
    .map((n) => n.target)
    .find((f) => f?.consoleActor);
  if (!form) throw new Error('no console actor for ' + descriptorActor);
  const ack = await client.request(
    { to: form.consoleActor, type: 'evaluateJSAsync', text: expr, mapped: { await: true } },
    { timeoutMs: 30000 }
  );
  let packet = null;
  for (let i = 0; i < 80 && !packet; i++) {
    packet = client.notifications.find((n) => n.type === 'evaluationResult' && n.resultID === ack.resultID);
    if (!packet) await sleep(250);
  }
  if (packet?.hasException) throw new Error('eval threw: ' + JSON.stringify(packet).slice(0, 500));
  return packet?.result;
}

const REPORT = `(() => {
  const L = globalThis.__laneD;
  const styleOf = (u) => { const i = u.indexOf('!1sset!2s'); if (i < 0) return null;
    const r = u.slice(i + 9); const j = r.indexOf('!'); return j < 0 ? r : r.slice(0, j); };
  const fam = (u) => {
    try {
      const url = new URL(u);
      if (!/google/.test(url.hostname)) return url.hostname;
      if (u.includes('/maps/vt/stream/pb=')) return 'vt/stream/pb';
      if (u.includes('/maps/vt/proto')) return 'vt/proto';
      if (u.includes('/maps/vt/icon/')) return 'vt/icon';
      if (u.includes('/maps/vt/data=')) return 'vt/data';
      if (u.includes('/maps/vt/pb=')) return 'vt/pb';
      if (u.includes('/maps/vt/')) return 'vt/other';
      return url.hostname + url.pathname.split('/').slice(0, 3).join('/');
    } catch { return 'unparsable'; }
  };
  const byFam = {}, styleByFam = {}, typeByFam = {};
  for (const r of L.requests) {
    const f = fam(r.url);
    byFam[f] = (byFam[f] ?? 0) + 1;
    const s = styleOf(r.url);
    if (s) { (styleByFam[f] ??= {}); styleByFam[f][s] = (styleByFam[f][s] ?? 0) + 1; }
    (typeByFam[f] ??= {}); typeByFam[f][r.type] = (typeByFam[f][r.type] ?? 0) + 1;
  }
  const vt = L.requests.filter((r) => r.url.includes('/maps/vt/'));
  const workerOrigin = {};
  for (const r of vt) { const k = String(r.documentUrl ?? r.originUrl ?? 'none'); workerOrigin[k] = (workerOrigin[k] ?? 0) + 1; }
  const redirects = L.redirects.filter((r) => r.from.includes('/maps/vt/'));
  return JSON.stringify({
    totalRequests: L.requests.length,
    totalVt: vt.length,
    byFamily: byFam,
    styleTokensByFamily: styleByFam,
    typesByFamily: typeByFam,
    vtOriginators: workerOrigin,
    vtRedirects: redirects.length,
    vtRedirectSample: redirects.slice(0, 3).map((r) => ({ from: r.from.slice(0, 130), to: r.to.slice(0, 130), status: r.status })),
    errors: L.errors.filter((e) => e.url.includes('/maps/')).slice(0, 20),
    vtCompletedFromCache: L.completed.filter((c) => c.url.includes('/maps/vt/') && c.fromCache).length,
    bigCompositeSample: L.requests.filter((r) => /!2m2!1u\\d{3,}!2u\\d{3,}/.test(r.url)).slice(0, 4).map((r) => ({ url: r.url.slice(0, 260), type: r.type })),
  });
})()`;

let report = null;
try {
  const raw = await evalIn(loggerEntry.actor, REPORT);
  report = JSON.parse(raw);
  console.log('\n================ webRequest ground truth ================');
  console.log(JSON.stringify(report, null, 2).slice(0, 6000));
} catch (err) {
  console.log(`logger read FAILED: ${err.message}`);
}

fs.writeFileSync(
  path.join(ART, `diagnose-${which}.json`),
  JSON.stringify({ which, dumps, webRequestReport: report }, null, 2)
);

client.close();
await ctx.close().catch(() => {});
fs.rmSync(profileDir, { recursive: true, force: true, maxRetries: 3 });
console.log(`\nwrote ${path.join(ART, `diagnose-${which}.json`)}`);
