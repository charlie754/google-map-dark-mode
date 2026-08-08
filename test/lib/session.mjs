/**
 * The sustained-interaction session.
 *
 * Every observation this project had before this file was a PASSIVE page load.
 * That is exactly the failure mode the project has already been burned by twice:
 * an earlier approach produced a correct dark map for about a second and was
 * then overpainted, and a settled screenshot cannot tell that apart from a map
 * that was dark all along. So this driver does two things the older harnesses
 * did not:
 *
 *   1. It drives a long, varied session -- pans in four directions, wheel zooms
 *      across >= 4 zoom levels, a real search, opening a place card, a layer
 *      toggle, and a return to the map -- using page.mouse.* / page.keyboard.*.
 *      Synthetic DOM events do NOT move this map: Maps uses pointer capture and
 *      only honours trusted input, which is why the whole thing is a Playwright
 *      harness rather than a page script.
 *
 *   2. It records a luminance TIME SERIES anchored to navigation start, and
 *      samples again 2500 ms after every gesture settles. The question is not
 *      "did it go dark", it is "did it STAY dark", and only a series can answer
 *      that.
 *
 * The map is rendered by WASM into an OffscreenCanvas transferred to a Web
 * Worker, so getContext/toDataURL throw on the page side. Pixels come from a
 * Playwright screenshot clipped to the map area.
 */

import fs from 'node:fs';
import path from 'node:path';

import { analyse, downscalePng, verdictWord } from './image.mjs';
import { summariseTransports } from './transport.mjs';

export const MAPS_URL = 'https://www.google.com/maps/@29.7604,-95.3698,12z';
export const VIEWPORT = { width: 1440, height: 900 };

/**
 * THE URL SHAPES, and why there is now more than one.
 *
 * An adversarial review found that the content script never injected on
 * `https://www.google.com/maps` (bare) or on `https://www.google.com/maps?q=…`.
 * The app chrome stayed light on both, in both browsers. It survived every gate
 * this project has ever run because both `test/lib/session.mjs` and
 * `test/lib/gate.mjs` pinned MAPS_URL to `/maps/@lat,lng,z` -- which happens to
 * be the one shape that matched under BOTH engines. A single navigation target
 * had quietly become the definition of "Google Maps".
 *
 * Testing one browser is not enough either: Chromium and Gecko genuinely differ
 * on match-pattern path semantics, so a pattern list can be correct in one and
 * wrong in the other. Every shape below is therefore driven in both.
 *
 *   coords  /maps/@lat,lng,z   the deep link, and the shape the sustained
 *                              interaction session runs on
 *   bare    /maps              what typing "google maps" and clicking the first
 *                              result gives you -- the single most common entry
 *                              point there is, and the one that was broken
 *   query   /maps?q=…          the shape every "directions to X" / share link
 *                              and every third-party deep link uses
 *
 * `bare` and `query` are navigated AFTER the interaction session rather than
 * instead of it, so the sustained-interaction evidence is unchanged and these
 * are strictly additional.
 */
export const URL_SHAPES = [
  {
    id: 'coords',
    url: MAPS_URL,
    why: 'deep link with coordinates -- the shape every earlier gate used, and the only one it used',
  },
  {
    id: 'bare',
    url: 'https://www.google.com/maps',
    why: 'no path segment after /maps -- the review found the content script never injected here',
  },
  {
    id: 'query',
    url: 'https://www.google.com/maps?q=Houston+Texas',
    why: 'a query string directly on /maps, with no path segment -- the other broken shape',
  },
];

/**
 * The content script's own marker, read off the document.
 *
 * `theme.js` writes `data-mapsnoir` on <html> itself: `pending` before the
 * settings read answers, then `on` or `off`. Nothing on Google's side writes it.
 * So its PRESENCE is a direct, unambiguous statement that the content script was
 * injected into this document, in a way that a pixel measurement is not -- a
 * dark panel could in principle come from somewhere else, an attribute with our
 * name on it could not. `null` means the script never ran.
 *
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<string|null>}
 */
export async function readInjectionMarker(page) {
  try {
    return await page.evaluate(() => document.documentElement.getAttribute('data-mapsnoir'));
  } catch {
    return null;
  }
}

/**
 * The server-side redirect chain a navigation actually followed.
 *
 * This is recorded for every shape because it is the one thing that could make
 * the whole exercise vacuous: if Google 30x-redirected `/maps` to
 * `/maps/@lat,lng,z` before the document was created, the content script would
 * be matched against the DESTINATION and the test would prove nothing about the
 * bare shape. Reporting the chain lets a reader see that it did not happen
 * rather than take it on trust.
 */
function redirectChain(response) {
  const chain = [];
  try {
    let req = response?.request() ?? null;
    while (req) {
      chain.unshift(req.url());
      req = req.redirectedFrom();
    }
  } catch {
    /* the request object can be gone by now; the chain is diagnostic only */
  }
  return chain;
}

/** Time-series anchors, milliseconds from navigation start. */
export const SERIES_MS = [500, 1500, 3000, 6000, 10000];

/**
 * Map-area clip: viewport-relative so it survives Maps' rotating class names.
 * Left edge clears the results panel (~408 px) and the icon rail (~79 px) with
 * margin; right edge is left of the zoom/pegman controls; bottom is above the
 * attribution bar and the layers widget; top is below the floating search pill.
 */
export function mapClip(vp = VIEWPORT) {
  return {
    x: Math.round(vp.width * 0.46),
    y: Math.round(vp.height * 0.16),
    width: Math.round(vp.width * 0.44),
    height: Math.round(vp.height * 0.62),
  };
}

/**
 * App-chrome sample regions for A4. Deliberately NOT selector-based: every
 * stable id Maps used to have is gone and the class names rotate.
 * `rail` is the left column, which holds the results/place panel once a search
 * has run and the floating panel background before that.
 */
export function chromeClips(vp = VIEWPORT) {
  return {
    rail: { x: 0, y: 96, width: 400, height: Math.round(vp.height - 160) },
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms)));

/**
 * Marker for the deliberate console/pageerror emitted at the end of a session to
 * prove the A5 listeners are attached. Chosen so it cannot be mistaken for the
 * extension's own `[google-map-dark-mode]` log prefix by the attribution filter.
 */
export const LISTENER_PROBE_MARK = 'HARNESS-LISTENER-LIVENESS-PROBE';

/* ---------------------------------------------------------------- gestures */

const PAN_VECTORS = {
  west: [-24, 0],
  north: [0, -22],
  southeast: [18, 18],
  northwest: [-16, -16],
};

async function dragPan(page, area, direction, log) {
  const [dx, dy] = PAN_VECTORS[direction] ?? PAN_VECTORS.west;
  const cx = area.x + area.width / 2;
  const cy = area.y + area.height / 2;
  await page.mouse.move(cx, cy, { steps: 4 });
  await sleep(150);
  await page.mouse.down();
  await sleep(120);
  for (let i = 1; i <= 8; i++) {
    await page.mouse.move(cx + i * dx, cy + i * dy, { steps: 3 });
    await sleep(45);
  }
  await sleep(120);
  await page.mouse.up();
  log(`gesture: drag-pan ${direction} (mouse.down -> 8 moves -> mouse.up)`);
}

async function wheelZoom(page, area, { direction, notches, delta = 240 }, log) {
  const cx = area.x + area.width / 2;
  const cy = area.y + area.height / 2;
  await page.mouse.move(cx, cy, { steps: 2 });
  await sleep(150);
  for (let i = 0; i < notches; i++) {
    await page.mouse.wheel(0, direction === 'in' ? -delta : delta);
    await sleep(280);
  }
  log(`gesture: wheel zoom ${direction} x${notches} (deltaY ${direction === 'in' ? -delta : delta})`);
}

/**
 * Find Maps' search input without depending on a single selector.
 * #searchboxinput is gone from the current build; name="q" has survived so far,
 * and the role/first-text-input fallbacks are there for when it does not.
 */
async function findSearchInput(page) {
  const candidates = [
    'input#searchboxinput',
    'input[name="q"]',
    'input[role="combobox"]',
    'form input[type="text"]',
    'input[type="text"]',
  ];
  for (const sel of candidates) {
    const loc = page.locator(sel).first();
    try {
      if ((await loc.count()) > 0 && (await loc.isVisible({ timeout: 1500 }))) {
        return { locator: loc, selector: sel };
      }
    } catch {
      /* try the next one */
    }
  }
  return null;
}

async function doSearch(page, term, log, result) {
  const found = await findSearchInput(page);
  if (!found) {
    log(`gesture: search SKIPPED -- no search input matched any candidate selector`);
    result.gestureNotes.push('search: no search input found');
    return false;
  }
  await found.locator.click({ timeout: 10000 });
  await sleep(200);
  await found.locator.fill('');
  await page.keyboard.type(term, { delay: 90 });
  await sleep(600);
  await page.keyboard.press('Enter');
  log(`gesture: search "${term}" typed into ${found.selector} + Enter`);
  result.gestureNotes.push(`search: typed into ${found.selector}`);
  return true;
}

async function openPlaceCard(page, log, result) {
  // Result rows are anchors to /maps/place/. Clicking one opens the place card.
  const loc = page.locator('a[href*="/maps/place/"]').first();
  try {
    await loc.waitFor({ state: 'visible', timeout: 15000 });
    const box = await loc.boundingBox();
    if (box) {
      await page.mouse.move(box.x + box.width / 2, box.y + Math.min(30, box.height / 2), { steps: 3 });
      await sleep(150);
      await page.mouse.click(box.x + box.width / 2, box.y + Math.min(30, box.height / 2));
      log(`gesture: clicked first /maps/place/ result at (${Math.round(box.x)}, ${Math.round(box.y)})`);
      result.gestureNotes.push('place-card: clicked first result link');
      return true;
    }
  } catch (err) {
    log(`gesture: place card SKIPPED -- ${err.message.split('\n')[0]}`);
    result.gestureNotes.push(`place-card: not reachable (${err.message.split('\n')[0]})`);
  }
  return false;
}

/**
 * Layer toggle.
 *
 * The layers control is the mini-map thumbnail in the bottom-left corner. It has
 * no accessible name matching /layers/ (measured: nothing on the page does), and
 * its class names rotate. What IS durable is that hovering it expands a menu of
 * `role="menuitemcheckbox"` buttons -- Terrain, Traffic, Transit, Biking,
 * Street View -- each carrying aria-checked. So this hovers the corner and then
 * drives the menu by role.
 *
 * It deliberately does NOT click Terrain or Satellite, but the reason has
 * changed and is worth stating precisely. It used to be that rules 3 and 4
 * matched only `!1sset!2sRoadmap!`, so a Terrain tile was outside the shipped
 * regexes by construction and toggling Terrain would have measured an unshipped
 * claim. They now match `!2s(Roadmap|Terrain)!` and the offline corpus covers
 * both arms (test/checks/rules.test.mjs, "THE TERRAIN ARM"). What remains is a
 * narrower objection: A3's dark/light thresholds are calibrated against Roadmap
 * cartography, and Terrain's relief shading is a different picture entirely, so
 * a Terrain frame scored against those numbers would be an untrustworthy
 * verdict rather than a stricter one. Satellite is photography and is out of
 * scope by design. Traffic is an overlay: it exercises the layer machinery and
 * forces a re-render without moving the base style.
 *
 * NOT DONE, and recorded here rather than implied away: no gate has ever driven
 * live Maps in Terrain mode. The Terrain arm is proven offline and by the
 * extension's own self-check, not on the wire.
 */
/**
 * Candidate hover points for the widget, in order. It sits at the bottom-left of
 * the MAP AREA, not of the viewport, so once a results or place panel is open it
 * is pushed right by the panel width (and the first point lands on the panel
 * instead). Measured at 1440x900: x=94..169 with no panel. Each candidate is
 * tried until the expanded menu produces items with a real bounding box.
 */
const LAYER_WIDGET_POINTS = [
  { x: 131, y: 840 },
  { x: 525, y: 840 },
  { x: 620, y: 840 },
];
const BASE_MAP_STYLE_OPTIONS = /terrain|satellite|globe|labels/i;

async function toggleLayer(page, log, result) {
  for (const point of LAYER_WIDGET_POINTS) {
    try {
      // Move away first, or a second hover over the same spot is a no-op.
      await page.mouse.move(point.x + 260, point.y - 300, { steps: 3 });
      await sleep(400);
      await page.mouse.move(point.x, point.y, { steps: 6 });
      await sleep(1800); // the widget expands on hover
      const items = page.locator('[role="menuitemcheckbox"]');
      const n = await items.count();
      if (n === 0) {
        log(`  layer widget: no menuitemcheckbox after hovering (${point.x},${point.y})`);
        continue;
      }
      const candidates = [];
      for (let i = 0; i < n; i++) {
        const it = items.nth(i);
        const label = ((await it.getAttribute('aria-label')) ?? (await it.textContent()) ?? '').trim();
        candidates.push({ i, label, checked: await it.getAttribute('aria-checked'), box: await it.boundingBox() });
      }
      log(
        `  layer menu @(${point.x},${point.y}): ` +
          JSON.stringify(candidates.map((c) => ({ label: c.label, checked: c.checked, visible: Boolean(c.box) })))
      );
      const visible = candidates.filter((c) => c.box);
      if (visible.length === 0) {
        log(`  layer widget: ${n} menu items exist but none has a bounding box at (${point.x},${point.y}) -- widget is covered`);
        continue;
      }
      // Traffic is an OVERLAY. Terrain/Satellite change the base-map STYLE,
      // which A3's luminance thresholds are not calibrated for -- see the
      // header note on toggleLayer.
      const pick =
        visible.find((c) => /traffic/i.test(c.label)) ??
        visible.find((c) => !BASE_MAP_STYLE_OPTIONS.test(c.label));
      if (!pick) {
        log('gesture: layer toggle SKIPPED -- only base-map style options were visible, and those are out of scope');
        result.gestureNotes.push(`layer: only base-map style options visible (${visible.map((c) => c.label).join(', ')})`);
        return false;
      }
      await page.mouse.click(pick.box.x + pick.box.width / 2, pick.box.y + pick.box.height / 2);
      await sleep(1500);
      const after = await items.nth(pick.i).getAttribute('aria-checked').catch(() => null);
      const flipped = after !== null && after !== pick.checked;
      log(
        `gesture: layer toggled "${pick.label}" aria-checked ${pick.checked} -> ${after}` +
          (flipped ? '' : '  (WARNING: aria-checked did not change)')
      );
      result.gestureNotes.push(`layer: toggled "${pick.label}" aria-checked ${pick.checked} -> ${after}`);
      result.layerToggle = {
        label: pick.label,
        before: pick.checked,
        after,
        flipped,
        hoverPoint: point,
        menu: candidates.map(({ label, checked, box }) => ({ label, checked, visible: Boolean(box) })),
      };
      return flipped;
    } catch (err) {
      log(`  layer widget attempt at (${point.x},${point.y}) threw: ${err.message.split('\n')[0]}`);
    }
  }
  log('gesture: layer toggle SKIPPED -- no reachable layers widget at any candidate point');
  result.gestureNotes.push('layer: no reachable widget');
  result.layerToggle = { reached: false };
  return false;
}

async function backToMap(page, area, log, result) {
  await page.keyboard.press('Escape');
  await sleep(400);
  await page.keyboard.press('Escape');
  await sleep(400);
  // Click on empty map to make sure focus is back on the canvas.
  await page.mouse.click(area.x + area.width * 0.85, area.y + area.height * 0.85);
  await sleep(400);
  log('gesture: Escape x2 + click on map to return to the map surface');
  result.gestureNotes.push('back-to-map: Escape x2 + map click');
  return true;
}

/* ------------------------------------------------------------------ settle */

async function settle(rec, { minMs = 2600, quietMs = 1600, maxMs = 12000 } = {}) {
  const start = Date.now();
  await sleep(minMs);
  while (Date.now() - start < maxMs) {
    if (Date.now() - rec.lastAt > quietMs) break;
    await sleep(250);
  }
  return Date.now() - start;
}

/* ---------------------------------------------------------------- sampling */

function urlZoom(pageUrl) {
  const m = String(pageUrl).match(/@(-?[\d.]+),(-?[\d.]+),([\d.]+)([zam])/);
  return m ? { lat: Number(m[1]), lng: Number(m[2]), zoom: Number(m[3]) } : null;
}

/** Two frames are "the same" if nothing measurable moved between them. */
function sameFrame(a, b) {
  if (!a || !b) return false;
  return (
    a.r === b.r &&
    a.g === b.g &&
    a.b === b.b &&
    a.stdev === b.stdev &&
    a.distinctColours === b.distinctColours
  );
}

/* --------------------------------------------------------------- the drive */

/**
 * @param {object} o
 * @param {import('@playwright/test').BrowserContext} o.context
 * @param {import('./session-recorder.mjs').SessionRecorder} o.rec
 * @param {string} o.label            artifact prefix
 * @param {string} o.artifactsDir     absolute
 * @param {(s: string) => void} o.log
 * @param {object} o.result           mutated in place
 */
export async function driveSession({ context, rec, label, artifactsDir, log, result }) {
  fs.mkdirSync(artifactsDir, { recursive: true });

  const page = context.pages()[0] ?? (await context.newPage());
  await page.setViewportSize(VIEWPORT);
  const area = mapClip(VIEWPORT);
  const clips = chromeClips(VIEWPORT);
  result.mapClip = area;
  result.chromeClips = clips;
  result.gestureNotes ??= [];
  log(`map clip: x=${area.x} y=${area.y} w=${area.width} h=${area.height}`);

  /* --- A5 wiring: console + page errors ---------------------------------- */
  const consoleErrors = [];
  const pageErrors = [];
  const requestFailures = [];
  /* A5 reporting "0 errors" is only meaningful if the listeners are alive.
   * Measured: live Maps emits ZERO console messages of any type in this
   * Chromium, so "0" is exactly what a dead listener would also produce. These
   * counters plus the deliberate probe at the end of the session are what tell
   * the two apart, and A5 fails if the probe is not observed. */
  const listenerProof = { consoleMessagesAnyType: 0, consoleProbeSeen: false, pageErrorProbeSeen: false };
  page.on('console', (msg) => {
    listenerProof.consoleMessagesAnyType += 1;
    const text = msg.text();
    if (text.includes(LISTENER_PROBE_MARK)) listenerProof.consoleProbeSeen = true;
    if (msg.type() !== 'error') return;
    if (text.includes(LISTENER_PROBE_MARK)) return; // our own probe is not a finding
    let locUrl = null;
    try {
      locUrl = msg.location()?.url ?? null;
    } catch {
      /* ignore */
    }
    consoleErrors.push({ text: text.slice(0, 500), url: locUrl, at: Date.now() - rec.startedAt });
  });
  page.on('pageerror', (err) => {
    const message = String(err?.message ?? err);
    if (message.includes(LISTENER_PROBE_MARK)) {
      listenerProof.pageErrorProbeSeen = true;
      return; // our own probe is not a finding
    }
    pageErrors.push({
      message: message.slice(0, 500),
      stack: String(err?.stack ?? '').slice(0, 800),
      at: Date.now() - rec.startedAt,
    });
  });
  result.listenerProof = listenerProof;
  page.on('requestfailed', (req) => {
    try {
      const u = req.url();
      if (!/\/maps\/vt\/|CompactLegend/.test(u)) return;
      requestFailures.push({ url: u.slice(0, 300), failure: req.failure()?.errorText ?? null });
    } catch {
      /* ignore */
    }
  });
  result.consoleErrors = consoleErrors;
  result.pageErrors = pageErrors;
  result.requestFailures = requestFailures;

  /* --- sampling helpers --------------------------------------------------- */
  result.samples = [];
  result.chromeSamples = [];

  const shootMap = async ({ sampleLabel, phase, atMsFromNav, write = true }) => {
    let buf;
    try {
      buf = await page.screenshot({ clip: area, timeout: 20000 });
    } catch (err) {
      log(`  screenshot ${sampleLabel} FAILED: ${err.message.split('\n')[0]}`);
      result.errors.push(`screenshot ${sampleLabel}: ${err.message.split('\n')[0]}`);
      return null;
    }
    const px = analyse(buf);
    let file = null;
    if (write) {
      file = `${label}-${sampleLabel}.png`;
      // One third scale on disk. Every assertion runs on the full-size buffer
      // above; the file exists only for a human to glance at, and the earlier
      // experiment lanes left 112 MB of full-size PNGs behind.
      fs.writeFileSync(path.join(artifactsDir, file), downscalePng(buf, 3));
    }
    const entry = {
      sample: sampleLabel,
      phase,
      atMsFromNav,
      pixels: px,
      verdict: verdictWord(px),
      screenshot: file,
    };
    result.samples.push(entry);
    log(
      `  sample ${sampleLabel.padEnd(22)} t=${String(atMsFromNav).padStart(6)}ms ` +
        `rgb=(${String(px.r).padStart(6)},${String(px.g).padStart(6)},${String(px.b).padStart(6)}) ` +
        `lum=${String(px.luminance).padStart(6)} sd=${String(px.stdev).padStart(6)} ` +
        `colours=${String(px.distinctColours).padStart(4)} -> ${entry.verdict}` +
        (px.invalidReason ? `  [${px.invalidReason}]` : '')
    );
    return entry;
  };

  const shootChrome = async (phase) => {
    for (const [name, clip] of Object.entries(clips)) {
      try {
        const buf = await page.screenshot({ clip, timeout: 20000 });
        const px = analyse(buf);
        const file = `${label}-chrome-${name}-${phase}.png`;
        fs.writeFileSync(path.join(artifactsDir, file), downscalePng(buf, 3));
        result.chromeSamples.push({ region: name, phase, pixels: px, screenshot: file });
        log(
          `  chrome ${name.padEnd(10)} @${phase.padEnd(14)} rgb=(${px.r},${px.g},${px.b}) lum=${px.luminance}` +
            ` sd=${px.stdev} colours=${px.distinctColours}`
        );
      } catch (err) {
        log(`  chrome sample ${name}@${phase} failed: ${err.message.split('\n')[0]}`);
      }
    }
    // The search box moves and is sized by its content, so it is located rather
    // than clipped blind.
    try {
      const found = await findSearchInput(page);
      if (found) {
        const box = await found.locator.boundingBox();
        if (box && box.width > 20 && box.height > 8) {
          const clip = {
            x: Math.max(0, Math.round(box.x)),
            y: Math.max(0, Math.round(box.y)),
            width: Math.round(box.width),
            height: Math.round(box.height),
          };
          const buf = await page.screenshot({ clip, timeout: 20000 });
          const px = analyse(buf);
          const file = `${label}-chrome-searchbox-${phase}.png`;
          fs.writeFileSync(path.join(artifactsDir, file), buf);
          result.chromeSamples.push({
            region: 'searchbox',
            phase,
            selector: found.selector,
            clip,
            pixels: px,
            screenshot: file,
          });
          log(
            `  chrome searchbox  @${phase.padEnd(14)} rgb=(${px.r},${px.g},${px.b}) lum=${px.luminance}` +
              `  [${found.selector} at ${clip.x},${clip.y} ${clip.width}x${clip.height}]`
          );
        }
      } else {
        log(`  chrome searchbox  @${phase}: no search input found`);
      }
    } catch (err) {
      log(`  chrome searchbox @${phase} failed: ${err.message.split('\n')[0]}`);
    }
  };

  /* --- navigate ----------------------------------------------------------- */
  rec.setPhase('navigate');
  const navStart = Date.now();
  result.navStart = new Date(navStart).toISOString();
  log(`goto ${MAPS_URL}`);
  const navResponse = await page.goto(MAPS_URL, { waitUntil: 'domcontentloaded', timeout: 90000 });
  if (/consent\.google\.|\/sorry\//.test(page.url())) {
    result.consentWallHit = true;
    log(`CONSENT/INTERSTITIAL WALL: ${page.url()}`);
  }
  result.urlShapes = [
    {
      id: 'coords',
      why: URL_SHAPES[0].why,
      requested: MAPS_URL,
      landed: page.url(),
      httpStatus: navResponse?.status() ?? null,
      serverRedirects: redirectChain(navResponse),
      marker: null, // filled in below, once the settings read has had time to answer
    },
  ];

  /* --- the time series, anchored to navigation start ---------------------- */
  rec.setPhase('first-paint');
  log('--- luminance time series (anchored to navigation start) ---');
  for (const at of SERIES_MS) {
    await sleep(at - (Date.now() - navStart));
    await shootMap({ sampleLabel: `t${String(at).padStart(5, '0')}ms`, phase: 'first-paint', atMsFromNav: at });
  }

  await page.waitForLoadState('networkidle', { timeout: 45000 }).catch(() => {
    log('networkidle not reached in 45s (live Maps keeps polling; continuing)');
  });

  result.urlShapes[0].marker = await readInjectionMarker(page);
  result.urlShapes[0].landed = page.url();
  log(
    `url shape coords: requested ${MAPS_URL} -> landed ${page.url()} ` +
      `[data-mapsnoir=${JSON.stringify(result.urlShapes[0].marker)}] ` +
      `server redirects: ${JSON.stringify(result.urlShapes[0].serverRedirects)}`
  );

  /* --- the sustained session ---------------------------------------------- */
  const phases = [
    { name: 'initial', gesture: null, chrome: true },
    { name: 'pan-west', gesture: (p) => dragPan(p, area, 'west', log) },
    { name: 'zoom-in-1', gesture: (p) => wheelZoom(p, area, { direction: 'in', notches: 3 }, log) },
    { name: 'pan-north', gesture: (p) => dragPan(p, area, 'north', log) },
    { name: 'zoom-in-2', gesture: (p) => wheelZoom(p, area, { direction: 'in', notches: 3 }, log) },
    { name: 'zoom-out-1', gesture: (p) => wheelZoom(p, area, { direction: 'out', notches: 4 }, log) },
    { name: 'pan-southeast', gesture: (p) => dragPan(p, area, 'southeast', log) },
    { name: 'zoom-out-2', gesture: (p) => wheelZoom(p, area, { direction: 'out', notches: 2 }, log) },
    // The layers widget lives at the bottom-left of the MAP AREA, so it is
    // toggled while the map is unobstructed. Doing it after the place card put
    // the results panel on top of the widget and the click silently missed.
    { name: 'layer-toggle', gesture: (p) => toggleLayer(p, log, result) },
    { name: 'search', gesture: (p) => doSearch(p, 'coffee', log, result), chrome: true },
    { name: 'place-card', gesture: (p) => openPlaceCard(p, log, result), chrome: true },
    { name: 'back-to-map', gesture: (p) => backToMap(p, area, log, result), chrome: true },
    { name: 'pan-final', gesture: (p) => dragPan(p, area, 'northwest', log) },
    { name: 'zoom-final', gesture: (p) => wheelZoom(p, area, { direction: 'in', notches: 2 }, log) },
  ];

  result.phases = [];
  for (const ph of phases) {
    rec.setPhase(ph.name);
    const before = rec.count;
    log(`--- phase ${ph.name} ---`);
    if (ph.gesture) {
      try {
        await ph.gesture(page);
      } catch (err) {
        log(`  gesture ${ph.name} threw: ${err.message.split('\n')[0]}`);
        result.gestureNotes.push(`${ph.name}: threw ${err.message.split('\n')[0]}`);
      }
    }
    const settleMs = await settle(rec);
    const atSettle = await shootMap({
      sampleLabel: ph.name,
      phase: ph.name,
      atMsFromNav: Date.now() - navStart,
    });
    await sleep(2500);
    /* The +2500 ms frame is the one that catches an overpaint arriving after
     * the network went quiet. Its NUMBERS are always recorded and always
     * asserted on; its PNG is written only when it differs from the settle
     * frame, because in a healthy run the two are pixel-identical and writing
     * both doubles the artifact pile for nothing. */
    const late = await shootMap({
      sampleLabel: `${ph.name}+2500`,
      phase: ph.name,
      atMsFromNav: Date.now() - navStart,
      write: false,
    });
    if (late && atSettle && !sameFrame(atSettle.pixels, late.pixels)) {
      const buf = await page.screenshot({ clip: area, timeout: 20000 }).catch(() => null);
      if (buf) {
        const f = `${label}-${ph.name}+2500-DIFFERS.png`;
        fs.writeFileSync(path.join(artifactsDir, f), downscalePng(buf, 3));
        late.screenshot = f;
        log(`  NOTE: the +2500ms frame differs from the settle frame; written to ${f}`);
      }
    }
    if (ph.chrome) await shootChrome(ph.name);

    const uz = urlZoom(page.url());
    result.phases.push({
      phase: ph.name,
      settleMs,
      requestsDuringPhase: rec.count - before,
      pageUrl: page.url(),
      urlZoom: uz?.zoom ?? null,
      settled: atSettle,
      late,
    });
    log(
      `  phase ${ph.name.padEnd(14)} url-zoom=${String(uz?.zoom ?? '?').padStart(6)} ` +
        `req+${String(rec.count - before).padStart(4)} settle=${settleMs}ms ` +
        `settled=${atSettle?.verdict ?? 'MISSING'} +2500=${late?.verdict ?? 'MISSING'}`
    );
  }

  /* --- the other URL shapes ------------------------------------------------
   * Same page, same context, fresh navigations. Each one is short on purpose:
   * this is a live third-party site and the question here is binary -- did the
   * content script inject, and is the chrome dark -- not whether darkness
   * survives interaction, which the session above has already answered.
   * ---------------------------------------------------------------------- */
  for (const shape of URL_SHAPES.slice(1)) {
    rec.setPhase(`url-${shape.id}`);
    log(`--- url shape ${shape.id}: ${shape.url} ---`);
    const entry = {
      id: shape.id,
      why: shape.why,
      requested: shape.url,
      landed: null,
      httpStatus: null,
      serverRedirects: [],
      marker: null,
      error: null,
    };
    try {
      const resp = await page.goto(shape.url, { waitUntil: 'domcontentloaded', timeout: 90000 });
      entry.httpStatus = resp?.status() ?? null;
      entry.serverRedirects = redirectChain(resp);
      if (/consent\.google\.|\/sorry\//.test(page.url())) {
        result.consentWallHit = true;
        log(`CONSENT/INTERSTITIAL WALL on ${shape.id}: ${page.url()}`);
      }
      // The theme resolves its settings read asynchronously and then walks a
      // ladder of passes; 6 s clears both comfortably and keeps the visit short.
      await sleep(6000);
      await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
      entry.marker = await readInjectionMarker(page);
      entry.landed = page.url();
      await shootMap({
        sampleLabel: `url-${shape.id}`,
        phase: `url-${shape.id}`,
        atMsFromNav: Date.now() - navStart,
      });
      await shootChrome(`url-${shape.id}`);
    } catch (err) {
      entry.error = err.message.split('\n')[0];
      log(`  url shape ${shape.id} FAILED: ${entry.error}`);
      result.errors.push(`url shape ${shape.id}: ${entry.error}`);
    }
    result.urlShapes.push(entry);
    log(
      `  url shape ${shape.id}: requested ${entry.requested} -> landed ${entry.landed} ` +
        `http=${entry.httpStatus} [data-mapsnoir=${JSON.stringify(entry.marker)}] ` +
        `server redirects: ${JSON.stringify(entry.serverRedirects)}`
    );
  }

  /* --- prove the A5 listeners were alive ---------------------------------- */
  try {
    await page.evaluate((mark) => {
      console.error(`${mark} console listener liveness probe`);
      setTimeout(() => {
        throw new Error(`${mark} pageerror listener liveness probe`);
      }, 0);
    }, LISTENER_PROBE_MARK);
    await sleep(1200);
  } catch (err) {
    log(`listener liveness probe failed to run: ${err.message.split('\n')[0]}`);
  }
  log(
    `A5 listener proof: console messages seen (any type)=${listenerProof.consoleMessagesAnyType}, ` +
      `console probe observed=${listenerProof.consoleProbeSeen}, pageerror probe observed=${listenerProof.pageErrorProbeSeen}`
  );

  result.finalPageUrl = page.url();
  try {
    const full = await page.screenshot({ timeout: 20000 });
    fs.writeFileSync(path.join(artifactsDir, `${label}-fullwindow.png`), downscalePng(full, 2));
    result.fullWindowScreenshot = `${label}-fullwindow.png`;
  } catch (err) {
    log(`full-window screenshot failed: ${err.message.split('\n')[0]}`);
  }

  return page;
}

/** Roll the recorder up once the browser is closed. */
export async function finaliseRequests(rec, result) {
  const analysed = await rec.analyse().catch((e) => {
    result.errors.push(`request analyse: ${e.message}`);
    return [];
  });
  result.requests = summariseTransports(analysed);
  result.requestLog = analysed.map((r) => ({
    url: r.url,
    phase: r.phase,
    at: r.at,
    status: r.status,
    resourceType: r.resourceType,
    transport: r.c.transport,
    bucket: r.c.bucket,
    baseMap: r.c.baseMap,
    rewritable: r.c.rewritable,
    token: r.c.token,
    dark: r.c.dark,
    zoom: r.c.zoom,
    legendVersion: r.c.legendVersion,
    terminal: r.terminal,
    supersededBy: r.supersededBy,
  }));
  return analysed;
}

export { sleep, urlZoom };
