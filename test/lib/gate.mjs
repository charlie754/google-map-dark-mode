/**
 * The M0 flow: launch a browser (optionally with an unpacked extension), drive
 * REAL pointer gestures against live Google Maps, and record what the network
 * and the pixels say.
 *
 * Synthetic DOM events do not move this map -- Maps uses gesture capture and
 * only honours trusted input. `page.mouse.*` dispatches through CDP, which is
 * the entire reason this harness exists rather than a page script.
 *
 * The map is rendered by WASM into an OffscreenCanvas transferred to a Web
 * Worker, so `getContext`/`toDataURL` throw on the page side. Pixels are read
 * from a Playwright screenshot clipped to the map area instead.
 */

import { chromium, firefox } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { VtRecorder, summarise } from './recorder.mjs';
import { zipDirectory } from './zip.mjs';
import { purgeServiceWorkerCache } from './chrome-profile.mjs';
import { analyse } from './image.mjs';
import {
  urlZoom,
  isBaseMapTile,
  isProtoTileRequest,
  styleToken,
  darkTwin,
} from './tiles.mjs';
import { protoUrlWithStyle } from './bpb.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, '..', '..');
export const ARTIFACTS = path.join(ROOT, 'test', 'artifacts');
export const PROFILES = path.join(ROOT, 'test', '.profiles');

/**
 * ONE URL shape, and that is a known limitation of THIS harness.
 *
 * This is the M0-era gate (`npm run gate`, `gate:all`, `gate:firefox`). It
 * predates the app-chrome work and has no A4/A6 equivalent, so it measures the
 * map surface only -- for which the shape of the entry URL does not matter.
 *
 * It is NOT the harness that covers URL shapes. Pinning MAPS_URL here and in
 * test/lib/session.mjs is exactly how a real bug survived the whole project: the
 * content script never injected on `/maps` or `/maps?q=…`, and no gate noticed,
 * because `/maps/@lat,lng,z` is the one shape that matched in both engines. That
 * coverage lives in `test/lib/session.mjs` (URL_SHAPES) and is asserted by A4's
 * `A4-shapes` companion and by A6 in `test/lib/live-assertions.mjs`. If you are
 * adding a URL-shape case, add it there, not here.
 */
export const MAPS_URL = 'https://www.google.com/maps/@29.7604,-95.3698,12z';
const VIEWPORT = { width: 1440, height: 900 };

/**
 * Map-area clip: viewport-relative so it survives Maps' rotating class names.
 * Left edge is right of the search panel (~408px) plus the icon rail (~79px);
 * right edge is left of the zoom/pegman controls; bottom is above the
 * attribution bar and the layers widget; top is below the floating search pill.
 */
function mapClip(vp) {
  return {
    x: Math.round(vp.width * 0.46),
    y: Math.round(vp.height * 0.16),
    width: Math.round(vp.width * 0.44),
    height: Math.round(vp.height * 0.62),
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------------ launch */

function chromiumExtensionArgs(extDir) {
  return [
    `--disable-extensions-except=${extDir}`,
    `--load-extension=${extDir}`,
  ];
}

const COMMON_CHROMIUM_ARGS = [
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-features=Translate,OptimizationHints',
  '--hide-crash-restore-bubble',
];

/**
 * Launch Chromium. Prefers Playwright's bundled build; falls back to installed
 * Chrome stable (`channel: 'chrome'`) if the bundled one refuses the extension.
 * Which one was used is recorded in the result.
 */
async function launchChromium({ profileDir, extDir, log }) {
  // See test/lib/chrome-profile.mjs: Chrome keeps the compiled service worker
  // for an unpacked extension in the profile, across restarts and across a
  // manifest version bump. Unconditional so a reused profile cannot bring the
  // hazard back unnoticed.
  const purge = purgeServiceWorkerCache(profileDir);
  log(
    `service-worker cache purge: ${
      purge.removed.length ? `removed ${purge.removed.join(', ')}` : 'nothing to remove (fresh profile)'
    }`
  );
  const args = [...COMMON_CHROMIUM_ARGS, ...(extDir ? chromiumExtensionArgs(extDir) : [])];
  const base = {
    headless: false,
    viewport: VIEWPORT,
    args,
    ignoreDefaultArgs: ['--disable-extensions'],
    locale: 'en-US',
    timezoneId: 'America/Chicago',
    colorScheme: 'dark',
  };

  try {
    const ctx = await chromium.launchPersistentContext(profileDir, base);
    log(`launch: playwright bundled chromium (${chromium.executablePath()})`);
    return { context: ctx, launchMethod: 'bundled-chromium', executable: chromium.executablePath() };
  } catch (err) {
    log(`launch: bundled chromium FAILED -> ${err.message}`);
    const ctx = await chromium.launchPersistentContext(profileDir, { ...base, channel: 'chrome' });
    log('launch: fell back to channel="chrome" (installed Chrome stable)');
    return { context: ctx, launchMethod: 'channel-chrome', executable: 'channel:chrome' };
  }
}

/**
 * Firefox: Playwright cannot drive the installed Developer Edition, so this
 * uses the bundled build and side-loads a built XPI into the profile.
 */
async function launchFirefox({ profileDir, extDir, log }) {
  const prefs = {
    'xpinstall.signatures.required': false,
    'extensions.autoDisableScopes': 0,
    'extensions.enabledScopes': 15,
    'extensions.installDistroAddons': false,
    'extensions.dnr.feedback': true,
    'extensions.langpacks.signatures.required': false,
    'browser.shell.checkDefaultBrowser': false,
  };

  let xpi = null;
  if (extDir) {
    xpi = installFirefoxXpi(profileDir, extDir, log);
  }

  const ctx = await firefox.launchPersistentContext(profileDir, {
    headless: false,
    viewport: VIEWPORT,
    locale: 'en-US',
    timezoneId: 'America/Chicago',
    colorScheme: 'dark',
    firefoxUserPrefs: prefs,
  });
  log(`launch: playwright bundled firefox (${firefox.executablePath()})`);
  return { context: ctx, launchMethod: 'bundled-firefox', executable: firefox.executablePath(), xpi };
}

/** Zip the unpacked extension and drop it in <profile>/extensions/<gecko-id>.xpi. */
function installFirefoxXpi(profileDir, extDir, log) {
  const manifestPath = path.join(extDir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) throw new Error(`no manifest.json in ${extDir}`);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const geckoId = manifest?.browser_specific_settings?.gecko?.id;
  if (!geckoId) {
    throw new Error(
      `manifest at ${manifestPath} has no browser_specific_settings.gecko.id; ` +
        'Firefox refuses a side-loaded XPI whose filename does not match the manifest id'
    );
  }
  const xpiPath = path.join(profileDir, 'extensions', `${geckoId}.xpi`);
  // Deliberately NOT PowerShell's Compress-Archive: it writes backslash path
  // separators, producing an XPI Firefox declines without ever recording it.
  const { entries, bytes } = zipDirectory(extDir, xpiPath);
  log(`firefox: side-loaded ${xpiPath} (${bytes} bytes, ${entries.length} entries: ${entries.join(', ')})`);
  return xpiPath;
}

/* --------------------------------------------------------------- gestures */

async function dragPan(page, area, log) {
  const cx = area.x + area.width / 2;
  const cy = area.y + area.height / 2;
  await page.mouse.move(cx, cy, { steps: 4 });
  await sleep(150);
  await page.mouse.down();
  await sleep(120);
  for (let i = 1; i <= 8; i++) {
    await page.mouse.move(cx - i * 22, cy - i * 13, { steps: 3 });
    await sleep(45);
  }
  await sleep(120);
  await page.mouse.up();
  log('gesture: drag-pan (mouse.down -> 8 moves -> mouse.up)');
}

async function wheelZoom(page, area, { direction, notches, delta = 240 }, log) {
  const cx = area.x + area.width / 2;
  const cy = area.y + area.height / 2;
  await page.mouse.move(cx, cy, { steps: 2 });
  await sleep(150);
  for (let i = 0; i < notches; i++) {
    await page.mouse.wheel(0, direction === 'in' ? -delta : delta);
    await sleep(260);
  }
  log(`gesture: wheel zoom ${direction} x${notches} (deltaY ${direction === 'in' ? -delta : delta})`);
}

/* ----------------------------------------------------------------- settle */

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

export async function runGate(options) {
  const {
    mode,
    browserName = 'chromium',
    extensionDir = null,
    label = mode,
  } = options;

  fs.mkdirSync(ARTIFACTS, { recursive: true });
  fs.mkdirSync(PROFILES, { recursive: true });
  const profileDir = fs.mkdtempSync(path.join(PROFILES, `${label}-`));

  const lines = [];
  const log = (msg) => {
    const line = `[${label}] ${msg}`;
    lines.push(line);
    // eslint-disable-next-line no-console
    console.log(line);
  };

  const result = {
    mode,
    label,
    browserName,
    extensionDir,
    startedAt: new Date().toISOString(),
    profileDir,
    launchMethod: null,
    executable: null,
    extensionLoaded: false,
    extensionId: null,
    serviceWorkerUrl: null,
    consentWallHit: false,
    finalPageUrl: null,
    earlyFrames: [],
    phases: [],
    requests: null,
    assertions: {},
    errors: [],
    log: lines,
  };

  log(`mode=${mode} browser=${browserName} extension=${extensionDir ?? '<none>'}`);
  if (extensionDir) {
    if (!fs.existsSync(path.join(extensionDir, 'manifest.json'))) {
      throw new Error(
        `extension directory has no manifest.json: ${extensionDir}\n` +
          'Run `npm run build` (tools/build.mjs, owned by the extension lane) first, ' +
          'or point GATE_EXT_DIR at a built extension.'
      );
    }
    const m = JSON.parse(fs.readFileSync(path.join(extensionDir, 'manifest.json'), 'utf8'));
    log(`extension manifest: name="${m.name}" version=${m.version} mv=${m.manifest_version}`);
    result.extensionManifest = m;
  }

  const launched =
    browserName === 'firefox'
      ? await launchFirefox({ profileDir, extDir: extensionDir, log })
      : await launchChromium({ profileDir, extDir: extensionDir, log });

  const context = launched.context;
  result.launchMethod = launched.launchMethod;
  result.executable = launched.executable;
  if (launched.xpi) result.xpi = launched.xpi;

  const rec = new VtRecorder();
  rec.attach(context);

  /*
   * `route-rewrite` mode. Not an extension -- a harness-side interception that
   * rewrites the style token on BOTH transports, including the base64 protobuf
   * one that a declarativeNetRequest regex provably cannot reach. Its only job
   * is to answer the M0 question on its own terms: if something rewrote the
   * interaction-time style token, would Maps render dark cartography? A pass
   * here is a statement about the endpoint, not about any shipped extension.
   */
  if (options.routeRewrite) {
    result.routeRewrite = true;
    let rasterHits = 0;
    let protoHits = 0;
    let failures = 0;
    await context.route(/\/maps\/vt\//, async (route) => {
      const url = route.request().url();
      let target = null;
      try {
        if (isBaseMapTile(url) && styleToken(url) === 'Roadmap') {
          target = darkTwin(url);
          if (target) rasterHits += 1;
        } else if (isProtoTileRequest(url)) {
          target = protoUrlWithStyle(url, 'RoadmapDark');
          if (target) protoHits += 1;
        }
      } catch {
        target = null;
      }
      try {
        if (target && target !== url) {
          rec.rewrites.set(url, target);
          await route.continue({ url: target });
        } else {
          await route.continue();
        }
      } catch (err) {
        failures += 1;
        try {
          await route.continue();
        } catch {
          /* request already gone */
        }
      }
    });
    result.routeStats = () => ({ rasterHits, protoHits, failures });
    log('route-rewrite interception armed on /maps/vt/ (raster + proto)');
  }

  try {
    // --- wait for the extension background to come up -----------------------
    if (extensionDir) {
      // Firefox MV3 uses an event page, never a service worker, so waiting for
      // one there is 20s of guaranteed nothing. There the proof the extension
      // loaded is the rewritten tokens in the request log.
      let sw = context.serviceWorkers()[0] ?? null;
      if (!sw && browserName !== 'firefox') {
        try {
          sw = await context.waitForEvent('serviceworker', { timeout: 20000 });
        } catch {
          sw = null;
        }
      }
      if (sw) {
        result.serviceWorkerUrl = sw.url();
        const idMatch = sw.url().match(/^chrome-extension:\/\/([a-p]+)\//);
        result.extensionId = idMatch ? idMatch[1] : null;
        log(`service worker active: ${sw.url()}`);

        // Ask the extension's own worker what DNR state it is in. This is what
        // separates "the rule did not match" from "the extension never loaded"
        // when the gate fails. Best-effort: testMatchOutcome needs the
        // declarativeNetRequestFeedback permission, which the product may not have.
        try {
          result.dnrProbe = await sw.evaluate(async () => {
            const out = {};
            try {
              out.enabledRulesets = await chrome.declarativeNetRequest.getEnabledRulesets();
            } catch (e) {
              out.enabledRulesetsError = String(e);
            }
            try {
              out.sessionRules = (await chrome.declarativeNetRequest.getSessionRules()).length;
              out.dynamicRules = (await chrome.declarativeNetRequest.getDynamicRules()).length;
            } catch (e) {
              out.ruleCountError = String(e);
            }
            const sample =
              'https://www.google.com/maps/vt/pb=!1m4!1m3!1i13!2i1925!3i3385!2m3!1e0!2sm' +
              '!3i789555512!3m8!2sen!3sus!5e1105!12m4!1e68!2m2!1sset!2sRoadmap!4e0!5m1!1e0';
            out.sampleTile = sample;
            try {
              out.testMatchOutcome = await chrome.declarativeNetRequest.testMatchOutcome({
                url: sample,
                initiator: 'https://www.google.com',
                type: 'xmlhttprequest',
                method: 'get',
              });
            } catch (e) {
              out.testMatchOutcomeError = String(e);
            }
            return out;
          });
          log(`dnr probe: ${JSON.stringify(result.dnrProbe)}`);
        } catch (err) {
          log(`dnr probe unavailable: ${err.message}`);
          result.dnrProbe = { error: err.message };
        }
      } else {
        log('service worker NOT observed within 20s (Firefox event pages never emit one)');
      }

      // Independent proof the extension is really installed: read its manifest
      // back out of the browser over the extension origin.
      if (result.extensionId) {
        const probe = await context.newPage();
        try {
          const resp = await probe.goto(
            `chrome-extension://${result.extensionId}/manifest.json`,
            { timeout: 10000 }
          );
          const body = await probe.evaluate(() => document.body.innerText);
          const parsed = JSON.parse(body);
          result.extensionLoaded = resp?.ok() === true;
          log(
            `extension load verified: id=${result.extensionId} status=${resp?.status()} ` +
              `name="${parsed.name}" rulesets=${JSON.stringify(
                parsed?.declarative_net_request?.rule_resources ?? null
              )}`
          );
          result.loadedManifest = parsed;
        } catch (err) {
          log(`extension manifest read-back FAILED: ${err.message}`);
          result.errors.push(`manifest read-back: ${err.message}`);
        } finally {
          await probe.close().catch(() => {});
        }
      }
    }

    const page = context.pages()[0] ?? (await context.newPage());
    await page.setViewportSize(VIEWPORT);
    const area = mapClip(VIEWPORT);
    log(`map clip: x=${area.x} y=${area.y} w=${area.width} h=${area.height}`);

    // --- navigate -----------------------------------------------------------
    rec.setPhase('navigate');
    log(`goto ${MAPS_URL}`);
    await page.goto(MAPS_URL, { waitUntil: 'domcontentloaded', timeout: 90000 });
    if (/consent\.google\.|\/sorry\//.test(page.url())) {
      result.consentWallHit = true;
      log(`CONSENT/INTERSTITIAL WALL: ${page.url()}`);
    }
    // NOTE: the first-paint frames below must be captured BEFORE waiting for
    // networkidle, or the raster layer will already have been replaced.

    /*
     * First-paint frames. Maps paints a raster base map immediately and (in the
     * vector arm) replaces it with the WASM/vector render a second or two later.
     * A screenshot taken only after settling therefore cannot tell "the raster
     * layer was never darkened" apart from "the raster layer was darkened and
     * then covered up". These frames are diagnostic only -- they are never
     * asserted on, because an early frame can legitimately be a blank canvas.
     */
    rec.setPhase('first-paint');
    for (const delay of [500, 900, 1400, 2100, 3200]) {
      await sleep(delay - (result.earlyFrames.at(-1)?.atMs ?? 0));
      try {
        const buf = await page.screenshot({ clip: area });
        const name = `${label}-firstpaint-${delay}ms.png`;
        fs.writeFileSync(path.join(ARTIFACTS, name), buf);
        const px = analyse(buf);
        result.earlyFrames.push({
          atMs: delay,
          screenshot: `test/artifacts/${name}`,
          pixels: px,
        });
        log(
          `first-paint @${String(delay).padStart(4)}ms meanRGB=(${px.r}, ${px.g}, ${px.b}) ` +
            `lum=${px.luminance} ${px.isDark ? 'DARK' : px.isLight ? 'LIGHT' : 'AMBIGUOUS'}`
        );
      } catch (err) {
        log(`first-paint @${delay}ms screenshot failed: ${err.message}`);
      }
    }

    await page.waitForLoadState('networkidle', { timeout: 45000 }).catch(() => {
      log('networkidle not reached in 45s (live Maps keeps polling; continuing)');
    });

    const phases = [
      { name: 'initial', gesture: null },
      { name: 'pan', gesture: (p) => dragPan(p, area, log) },
      { name: 'zoom-in-1', gesture: (p) => wheelZoom(p, area, { direction: 'in', notches: 3 }, log) },
      { name: 'zoom-in-2', gesture: (p) => wheelZoom(p, area, { direction: 'in', notches: 3 }, log) },
      { name: 'zoom-out', gesture: (p) => wheelZoom(p, area, { direction: 'out', notches: 4 }, log) },
    ];

    for (const ph of phases) {
      rec.setPhase(ph.name);
      const before = rec.count;
      if (ph.gesture) await ph.gesture(page);
      const settled = await settle(rec);
      const shotName = `${label}-${ph.name}.png`;
      const shotPath = path.join(ARTIFACTS, shotName);
      const buf = await page.screenshot({ clip: area });
      fs.writeFileSync(shotPath, buf);
      const px = analyse(buf);
      const uz = urlZoom(page.url());
      const entry = {
        phase: ph.name,
        settleMs: settled,
        vtRequestsDuringPhase: rec.count - before,
        pageUrl: page.url(),
        urlZoom: uz?.zoom ?? null,
        screenshot: path.relative(ROOT, shotPath).replace(/\\/g, '/'),
        pixels: px,
      };
      result.phases.push(entry);
      log(
        `phase ${ph.name.padEnd(9)} url-zoom=${String(uz?.zoom ?? '?').padStart(5)} ` +
          `vt+${String(entry.vtRequestsDuringPhase).padStart(3)} ` +
          `meanRGB=(${px.r}, ${px.g}, ${px.b}) lum=${px.luminance} ` +
          `dDark=${px.distToDarkRef} dLight=${px.distToLightRef} ` +
          `${px.isDark ? 'DARK' : px.isLight ? 'LIGHT' : 'AMBIGUOUS'}`
      );
    }

    result.finalPageUrl = page.url();

    // Full-window screenshot for the human reader.
    const full = path.join(ARTIFACTS, `${label}-fullwindow.png`);
    fs.writeFileSync(full, await page.screenshot());
    result.fullWindowScreenshot = path.relative(ROOT, full).replace(/\\/g, '/');
  } catch (err) {
    result.errors.push(String(err && err.stack ? err.stack : err));
    log(`ERROR: ${err.message}`);
  } finally {
    if (typeof result.routeStats === 'function') {
      const s = result.routeStats();
      result.routeStats = s;
      log(`route-rewrite stats: raster=${s.rasterHits} proto=${s.protoHits} failures=${s.failures}`);
    }
    const analysed = await rec.analyse().catch((e) => {
      result.errors.push(`analyse: ${e.message}`);
      return [];
    });
    result.requests = summarise(analysed);
    result.requestLog = analysed.map((r) => ({
      url: r.url,
      originalUrl: r.originalUrl,
      rewrittenByHarness: r.rewrittenByHarness,
      phase: r.phase,
      at: r.at,
      bucket: r.bucket,
      kind: r.kind,
      base: r.base,
      token: r.token,
      zoom: r.zoom,
      coords: r.coords,
      status: r.status,
      terminal: r.terminal,
      supersededBy: r.supersededBy,
    }));
    await context.close().catch(() => {});
    try {
      fs.rmSync(profileDir, { recursive: true, force: true, maxRetries: 3 });
    } catch {
      /* Windows sometimes holds the profile briefly; .gitignore covers it */
    }
    result.finishedAt = new Date().toISOString();
  }

  return result;
}

export { mapClip, VIEWPORT };
