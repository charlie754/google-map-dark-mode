/**
 * LANE D -- the Firefox gate.
 *
 * The shipped harness (`test/lib/gate.mjs`) side-loads an XPI into
 * `<profile>/extensions/`. On this Gecko build that is a no-op: the add-on is
 * never recorded in `extensions.json` at all, so every Firefox "extension" run
 * so far has in fact been a second control run. This module launches the same
 * Playwright-driven Firefox and installs the *same built directory* over the
 * DevTools Remote Debugging Protocol (`installTemporaryAddon`) instead -- the
 * mechanism `web-ext run` uses internally, minus the undriveable browser.
 *
 * Everything downstream of the load is deliberately the shipped harness:
 * `VtRecorder`/`summarise` for the network, `analyse` for the pixels,
 * `verdicts` for A1/A2/A3, and `mapClip`/`VIEWPORT`/`MAPS_URL` for framing, all
 * imported from `test/lib/`. The gesture and settle routines are re-stated here
 * only because `test/lib/gate.mjs` does not export them; the parameters are
 * copied verbatim so the numbers stay comparable with the Chromium runs.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { firefox } from '@playwright/test';

import { VtRecorder, summarise } from '../../lib/recorder.mjs';
import { analyse } from '../../lib/image.mjs';
import { urlZoom } from '../../lib/tiles.mjs';
import { mapClip, VIEWPORT, MAPS_URL } from '../../lib/gate.mjs';
import { connectWithRetry, installTemporaryAddon } from './rdp.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, '..', '..', '..');
export const ARTIFACTS = path.join(HERE, 'artifacts');
const PROFILES = path.join(ROOT, 'test', '.profiles');
export const SHIPPED_EXT_DIR = path.join(ROOT, 'dist', 'firefox');
export const VARIANT_EXT_DIR = path.join(HERE, 'ext-variant');
export const BLOCK_EXT_DIR = path.join(HERE, 'ext-block');

const sleep = (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms)));

/**
 * The add-on id of the directory being installed, read from its own manifest.
 *
 * This was the literal `maps-noir@local.test`, which was simultaneously true of
 * all three directories above. It no longer is: the shipped extension now
 * carries its AMO id, while `ext-variant/` and `ext-block/` keep the old one
 * because they are frozen evidence of an earlier experiment and are not being
 * renamed. A literal would find no `listAddons` entry for whichever of the two
 * it was not pinned to, and every field of the load proof downstream would read
 * `undefined` without anything throwing.
 *
 * @param {string} extDir unpacked add-on directory
 * @returns {string} browser_specific_settings.gecko.id
 */
export function geckoIdOf(extDir) {
  const manifestPath = path.join(extDir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) throw new Error(`no manifest.json in ${extDir}`);
  const id = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))?.browser_specific_settings?.gecko?.id;
  if (!id) throw new Error(`manifest at ${manifestPath} has no browser_specific_settings.gecko.id`);
  return id;
}

/**
 * Which static ruleset an unpacked add-on actually declares, and its rules.
 *
 * This used to be `readFileSync(extDir + '/rules/dark-tiles.json')` with the
 * ruleset id `dark_tiles` hard-coded beside it. Both were true of the shipped
 * extension in M0 and neither is true now: the file is `rules/dark-map.json` and
 * the id is `dark_map`, so this module has been throwing ENOENT against
 * `dist/firefox/` for as long as that rename has been in place. Nothing noticed,
 * because it is in no npm script.
 *
 * Reading both out of the add-on's own manifest fixes that permanently AND makes
 * the function correct for the two experiment builds beside it
 * (`ext-variant/`, `ext-block/`), which still legitimately declare
 * `dark_tiles` / `rules/dark-tiles.json` and are not going to be renamed --
 * they are frozen evidence of an earlier experiment.
 *
 * @param {string} extDir unpacked add-on directory
 * @returns {{rulesetIds: string[], rulesetPaths: string[], rules: object[]}}
 */
export function staticRulesetInfo(extDir) {
  const manifestPath = path.join(extDir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) throw new Error(`no manifest.json in ${extDir}`);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const resources = manifest?.declarative_net_request?.rule_resources ?? [];
  if (resources.length === 0) {
    throw new Error(`${manifestPath} declares no declarative_net_request.rule_resources`);
  }
  const rules = [];
  for (const r of resources) {
    const abs = path.join(extDir, ...String(r.path).split('/'));
    if (!fs.existsSync(abs)) {
      throw new Error(`${manifestPath} points at a ruleset that is not there: ${r.path}`);
    }
    rules.push(...JSON.parse(fs.readFileSync(abs, 'utf8')));
  }
  return {
    rulesetIds: resources.map((r) => r.id),
    rulesetPaths: resources.map((r) => r.path),
    rules,
  };
}

/* ------------------------------------------------- the third transport ---- */
/*
 * `test/lib/tiles.mjs` defines a base-map tile as a URL containing
 * `/maps/vt/pb=`. Measured on Firefox that definition sees only the first-paint
 * raster layer. The vector renderer's data arrives on a THIRD endpoint that the
 * shipped classifier has no name for:
 *
 *   https://www.google.com/maps/vt/stream/pb=!1m7!8m6!1m3!1i12!2i960!3i1691...
 *     ...!2m3!1e0!2sm!3i789555512!3m8!2sen!3sus!5e1105!12m4!1e68!2m2!1sset!2sRoadmap!4e1!...
 *
 * Same `!1sset!2s<Style>` selector, in plain ASCII, differing from the raster
 * form only by the extra `stream/` path segment and `!4e1` (vector) in place of
 * `!4e0` (raster PNG). It is therefore just as rewritable by a regex -- but the
 * shipped rule's `regexFilter` hard-codes `/maps/vt/pb=` and cannot match it.
 * These helpers exist so the report can state that with numbers rather than
 * silently folding the requests into an "other" bucket.
 */

const STREAM_MARK = '/maps/vt/stream/pb=';
const SET_MARK = '!1sset!2s';

export function isStreamRequest(url) {
  return typeof url === 'string' && url.includes(STREAM_MARK);
}

export function streamStyleToken(url) {
  const i = url.indexOf(SET_MARK);
  if (i < 0) return null;
  const rest = url.slice(i + SET_MARK.length);
  const j = rest.indexOf('!');
  return j < 0 ? rest : rest.slice(0, j);
}

/** The `!<n>e<k>!2s<layer>!` group: `m` is the base map, `crisis2`/`lore-rec` are overlays. */
export function streamLayer(url) {
  return url.match(/!1e\d+!2s([A-Za-z0-9_-]+)!/)?.[1] ?? null;
}

/** A base-map vector-data stream: layer `m`, carrying an explicit style selector. */
export function isStreamBaseMap(url) {
  return isStreamRequest(url) && streamLayer(url) === 'm' && streamStyleToken(url) !== null;
}

export function summariseStream(rows) {
  const all = rows.filter((r) => isStreamRequest(r.url) && r.phase !== 'boot');
  const base = all.filter((r) => isStreamBaseMap(r.url));
  const tally = (list, fn) => {
    const out = {};
    for (const r of list) {
      const k = String(fn(r));
      out[k] = (out[k] ?? 0) + 1;
    }
    return out;
  };
  return {
    streamRequests: all.length,
    byLayer: tally(all, (r) => streamLayer(r.url)),
    baseMapStreamRequests: base.length,
    tokens: tally(base, (r) => streamStyleToken(r.url)),
    phases: tally(base, (r) => r.phase),
    statuses: tally(base, (r) => r.status),
    resourceTypes: tally(base, (r) => r.resourceType),
    sample: base.slice(0, 3).map((r) => r.url),
  };
}

/* ------------------------------------------------------------- gestures --- */
/* Parameters identical to test/lib/gate.mjs. Synthetic DOM events do not move
 * this map; page.mouse.* goes through Juggler and produces trusted input. */

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

async function settle(rec, { minMs = 2600, quietMs = 1600, maxMs = 12000 } = {}) {
  const start = Date.now();
  await sleep(minMs);
  while (Date.now() - start < maxMs) {
    if (Date.now() - rec.lastVtAt > quietMs) break;
    await sleep(250);
  }
  return Date.now() - start;
}

/* ------------------------------------------------------------- the run ---- */

/**
 * @param {{label: string, withExtension: boolean, rdpPort: number, extDir?: string, variant?: string}} opts
 */
export async function runFirefoxGate({ label, withExtension, rdpPort, extDir = SHIPPED_EXT_DIR, variant = 'shipped' }) {
  fs.mkdirSync(ARTIFACTS, { recursive: true });
  fs.mkdirSync(PROFILES, { recursive: true });
  const profileDir = fs.mkdtempSync(path.join(PROFILES, `ffload-${label}-`));

  const lines = [];
  const log = (msg) => {
    const line = `[${label}] ${msg}`;
    lines.push(line);
    console.log(line);
  };

  const result = {
    label,
    withExtension,
    variant: withExtension ? variant : 'none',
    extensionDir: withExtension ? extDir : null,
    loadMechanism: withExtension ? 'rdp:installTemporaryAddon' : 'none (control)',
    browserName: 'firefox',
    executable: firefox.executablePath(),
    rdpPort,
    startedAt: new Date().toISOString(),
    profileDir,
    extensionLoaded: false,
    loadProof: null,
    postRunProbe: null,
    consentWallHit: false,
    finalPageUrl: null,
    timeSeries: [],
    phases: [],
    requests: null,
    errors: [],
    log: lines,
  };

  const prefs = {
    // The DevTools server, and no human prompt in front of it.
    'devtools.debugger.remote-enabled': true,
    'devtools.debugger.prompt-connection': false,
    'devtools.chrome.enabled': true,
    // Belt and braces: unsigned add-ons. installTemporaryAddon does not itself
    // require this, but leaving it on costs nothing and removes one variable.
    'xpinstall.signatures.required': false,
    'extensions.dnr.feedback': true,
    'browser.shell.checkDefaultBrowser': false,
    'browser.aboutwelcome.enabled': false,
  };

  const ctx = await firefox.launchPersistentContext(profileDir, {
    headless: false,
    viewport: VIEWPORT,
    locale: 'en-US',
    timezoneId: 'America/Chicago',
    colorScheme: 'dark',
    args: ['-start-debugger-server', String(rdpPort)],
    firefoxUserPrefs: prefs,
  });
  log(`launch: playwright bundled firefox (${firefox.executablePath()})`);

  const rec = new VtRecorder();
  rec.attach(ctx);

  let rdp = null;
  let geckoId = null;
  try {
    /* --- load the add-on ------------------------------------------------- */
    if (withExtension) {
      const { client, attempt } = await connectWithRetry(rdpPort, { attempts: 30, delayMs: 500 });
      rdp = client;
      log(`RDP connected on 127.0.0.1:${rdpPort} (attempt ${attempt})`);
      geckoId = geckoIdOf(extDir);
      const { rulesetIds, rulesetPaths, rules } = staticRulesetInfo(extDir);
      log(
        `installing variant="${variant}" from ${extDir}; ruleset(s) ${JSON.stringify(rulesetIds)} ` +
          `from ${JSON.stringify(rulesetPaths)}; ${rules.length} static rule(s): ` +
          rules.map((r) => r.condition?.regexFilter).join(' | ')
      );
      result.staticRules = rules;
      result.rulesetIds = rulesetIds;
      const installed = await installTemporaryAddon(client, extDir);
      const entry = installed.listed.find((a) => a.id === geckoId) ?? null;
      const uuid = String(entry?.manifestURL ?? '').match(/moz-extension:\/\/([0-9a-f-]+)\//)?.[1] ?? null;
      log(
        `installTemporaryAddon -> id=${installed.addon?.id} ; listAddons: ` +
          `temporarilyInstalled=${entry?.temporarilyInstalled} ` +
          `backgroundScriptStatus=${entry?.backgroundScriptStatus} ` +
          `warnings=${JSON.stringify(entry?.warnings ?? null)} uuid=${uuid}`
      );
      const bg = await evalInBackground(client, entry?.actor, log);
      result.loadProof = {
        installReply: installed.addon,
        listAddonsEntry: entry,
        mozExtensionUuid: uuid,
        backgroundEval: bg,
      };
      result.extensionLoaded =
        entry?.temporarilyInstalled === true &&
        Array.isArray(bg?.parsed?.enabledRulesets) &&
        rulesetIds.every((id) => bg.parsed.enabledRulesets.includes(id));
      log(
        `extension load verdict: ${result.extensionLoaded ? 'ACTIVE' : 'NOT PROVEN'} ` +
          `(enabledRulesets=${JSON.stringify(bg?.parsed?.enabledRulesets ?? null)}, ` +
          `healthProbe=${JSON.stringify(bg?.parsed?.health?.healthProbe ?? null)})`
      );
      if (!result.extensionLoaded) {
        throw new Error('add-on did not come up active; aborting before touching Google');
      }
    } else {
      log('control run: no add-on installed (identical launch otherwise)');
    }

    /* --- drive Maps ------------------------------------------------------- */
    const page = ctx.pages()[0] ?? (await ctx.newPage());
    await page.setViewportSize(VIEWPORT);
    const area = mapClip(VIEWPORT);
    log(`map clip: x=${area.x} y=${area.y} w=${area.width} h=${area.height}`);

    rec.setPhase('navigate');
    const navStart = Date.now();
    log(`goto ${MAPS_URL}`);
    await page.goto(MAPS_URL, { waitUntil: 'domcontentloaded', timeout: 90000 });
    if (/consent\.google\.|\/sorry\//.test(page.url())) {
      result.consentWallHit = true;
      log(`CONSENT/INTERSTITIAL WALL: ${page.url()}`);
    }

    /* A3 as a time series. The Chromium runs showed a genuinely dark first paint
     * being overpainted light at ~1.4s by the vector renderer; a single settled
     * frame cannot tell that apart from "never darkened". */
    rec.setPhase('first-paint');
    for (const at of [500, 900, 1400, 2100, 3000, 4500, 6500]) {
      await sleep(at - (Date.now() - navStart));
      const px = await shoot(page, area, `${label}-t${at}ms`, result, log, { atMs: at });
      if (px) result.timeSeries.push({ atMs: at, ...px });
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

      /* Two frames per phase: at settle, and +2500ms later. The second one is
       * what catches an overpaint that arrives after the network went quiet. */
      const atSettle = await shoot(page, area, `${label}-${ph.name}`, result, log, { phase: ph.name });
      await sleep(2500);
      const late = await shoot(page, area, `${label}-${ph.name}-plus2500`, result, log, {
        phase: `${ph.name}+2500ms`,
      });

      const uz = urlZoom(page.url());
      const entry = {
        phase: ph.name,
        settleMs: settled,
        vtRequestsDuringPhase: rec.count - before,
        pageUrl: page.url(),
        urlZoom: uz?.zoom ?? null,
        screenshot: `test/experiments/firefox-load/artifacts/${label}-${ph.name}.png`,
        pixels: atSettle,
        latePixels: late,
      };
      result.phases.push(entry);
      log(
        `phase ${ph.name.padEnd(9)} url-zoom=${String(uz?.zoom ?? '?').padStart(5)} ` +
          `vt+${String(entry.vtRequestsDuringPhase).padStart(3)} ` +
          `settled=(${atSettle?.r}, ${atSettle?.g}, ${atSettle?.b}) lum=${atSettle?.luminance} ` +
          `${atSettle?.isDark ? 'DARK' : atSettle?.isLight ? 'LIGHT' : 'AMBIGUOUS'} | ` +
          `+2500ms=(${late?.r}, ${late?.g}, ${late?.b}) lum=${late?.luminance} ` +
          `${late?.isDark ? 'DARK' : late?.isLight ? 'LIGHT' : 'AMBIGUOUS'}`
      );
    }

    result.finalPageUrl = page.url();
    const full = path.join(ARTIFACTS, `${label}-fullwindow.png`);
    fs.writeFileSync(full, await page.screenshot());
    result.fullWindowScreenshot = `test/experiments/firefox-load/artifacts/${label}-fullwindow.png`;

    /* --- was the add-on still armed at the end? --------------------------- */
    if (withExtension && rdp) {
      try {
        const listed = await rdp.request({ to: 'root', type: 'listAddons' }, { timeoutMs: 15000 });
        const entry = (listed.addons ?? []).find((a) => a.id === geckoId) ?? null;
        const bg = await evalInBackground(rdp, entry?.actor, log);
        result.postRunProbe = { listAddonsEntry: entry, backgroundEval: bg };
        log(
          `post-run probe: temporarilyInstalled=${entry?.temporarilyInstalled} ` +
            `backgroundScriptStatus=${entry?.backgroundScriptStatus} ` +
            `enabledRulesets=${JSON.stringify(bg?.parsed?.enabledRulesets ?? null)}`
        );
      } catch (err) {
        log(`post-run probe failed: ${err.message}`);
      }
    }
  } catch (err) {
    result.errors.push(String(err?.stack ?? err));
    log(`ERROR: ${err.message}`);
  } finally {
    const analysed = await rec.analyse().catch((e) => {
      result.errors.push(`analyse: ${e.message}`);
      return [];
    });
    result.requests = summarise(analysed);
    result.streamRequests = summariseStream(analysed);
    log(
      `stream endpoint: ${result.streamRequests.streamRequests} requests, ` +
        `${result.streamRequests.baseMapStreamRequests} of them base-map ` +
        `(layers ${JSON.stringify(result.streamRequests.byLayer)}), ` +
        `tokens ${JSON.stringify(result.streamRequests.tokens)}`
    );
    result.requestLog = analysed.map((r) => ({
      url: r.url,
      phase: r.phase,
      at: r.at,
      bucket: r.bucket,
      kind: r.kind,
      base: r.base,
      token: r.token,
      zoom: r.zoom,
      status: r.status,
      resourceType: r.resourceType,
      streamBaseMap: isStreamBaseMap(r.url) || undefined,
      streamToken: isStreamRequest(r.url) ? streamStyleToken(r.url) : undefined,
      terminal: r.terminal,
      supersededBy: r.supersededBy,
      redirectedFromUrl: r.redirectedFromUrl,
      redirectedTo: r.redirectedTo,
    }));
    try {
      rdp?.close();
    } catch {
      /* socket already gone */
    }
    await ctx.close().catch(() => {});
    try {
      fs.rmSync(profileDir, { recursive: true, force: true, maxRetries: 3 });
    } catch {
      /* Windows sometimes holds the profile briefly; .gitignore covers it */
    }
    result.finishedAt = new Date().toISOString();
  }

  return result;
}

/* ---------------------------------------------------------------- helpers -- */

async function shoot(page, area, name, result, log, meta) {
  try {
    const buf = await page.screenshot({ clip: area });
    fs.writeFileSync(path.join(ARTIFACTS, `${name}.png`), buf);
    const px = analyse(buf);
    if (meta.atMs !== undefined) {
      log(
        `t=${String(meta.atMs).padStart(4)}ms meanRGB=(${px.r}, ${px.g}, ${px.b}) lum=${px.luminance} ` +
          `dDark=${px.distToDarkRef} dLight=${px.distToLightRef} ` +
          `${px.isDark ? 'DARK' : px.isLight ? 'LIGHT' : 'AMBIGUOUS'}`
      );
    }
    return { ...px, screenshot: `test/experiments/firefox-load/artifacts/${name}.png` };
  } catch (err) {
    log(`screenshot ${name} failed: ${err.message}`);
    result.errors.push(`screenshot ${name}: ${err.message}`);
    return null;
  }
}

/**
 * Evaluate in the add-on's background context over RDP.
 *
 * The modern descriptor actor has no `getTarget`; the target form arrives as an
 * unsolicited `target-available-form` notification after `watchTargets`. Both
 * shapes are attempted so this keeps working across Gecko versions.
 */
async function evalInBackground(client, descriptorActor, log) {
  if (!descriptorActor) return { error: 'no descriptor actor' };
  let consoleActor = null;
  let how = null;

  try {
    const t = await client.request({ to: descriptorActor, type: 'getTarget' }, { timeoutMs: 10000 });
    consoleActor = t?.frame?.consoleActor ?? t?.form?.consoleActor ?? null;
    if (consoleActor) how = 'descriptor.getTarget';
  } catch {
    /* expected on Gecko >= ~115 */
  }

  if (!consoleActor) {
    try {
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
      consoleActor = form?.consoleActor ?? null;
      if (consoleActor) how = 'watcher.watchTargets(frame)';
    } catch (err) {
      log?.(`background eval: watcher path failed: ${err.message}`);
    }
  }

  if (!consoleActor) return { error: 'no console actor reachable' };

  const expr = `(async () => {
    const api = globalThis.browser ?? globalThis.chrome;
    const out = { hasDnr: Boolean(api?.declarativeNetRequest) };
    try { out.enabledRulesets = await api.declarativeNetRequest.getEnabledRulesets(); }
    catch (e) { out.enabledRulesetsError = String(e); }
    try { out.dynamicRules = (await api.declarativeNetRequest.getDynamicRules()).length; }
    catch (e) { out.dynamicRulesError = String(e); }
    try { out.sessionRules = (await api.declarativeNetRequest.getSessionRules()).length; }
    catch (e) { out.sessionRulesError = String(e); }
    try { out.health = await api.storage.local.get('healthProbe'); }
    catch (e) { out.healthError = String(e); }
    try { out.manifestName = api.runtime.getManifest().name; } catch (e) { out.manifestError = String(e); }
    return JSON.stringify(out);
  })()`;

  const ack = await client.request(
    { to: consoleActor, type: 'evaluateJSAsync', text: expr, mapped: { await: true } },
    { timeoutMs: 30000 }
  );
  let packet = null;
  for (let i = 0; i < 60 && !packet; i++) {
    packet = client.notifications.find(
      (n) => n.type === 'evaluationResult' && n.resultID === ack.resultID
    );
    if (!packet) await sleep(250);
  }
  let parsed = null;
  try {
    parsed = JSON.parse(packet?.result);
  } catch {
    parsed = null;
  }
  return { how, consoleActor, hasException: packet?.hasException ?? null, raw: packet?.result ?? null, parsed };
}
