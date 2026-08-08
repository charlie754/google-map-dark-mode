#!/usr/bin/env node
/**
 * THE LIVE GATE -- the integrated, sustained-interaction proof.
 *
 *   node test/live-gate.mjs chrome            dist/chrome, extension expected dark
 *   node test/live-gate.mjs chrome-control    no extension, expected light
 *   node test/live-gate.mjs firefox           dist/firefox via RDP, expected dark
 *   node test/live-gate.mjs firefox-control   no add-on, expected light
 *   node test/live-gate.mjs all               all four, in that order
 *
 * This talks to live Google Maps. Runs are strictly sequential and there is no
 * retry loop; one invocation is one session per mode.
 *
 * The control run is load-bearing. If a run with no extension satisfies the
 * positive A2/A3/A4, the assertions do not measure the extension and the gate is
 * declared VOID rather than passed -- see test/lib/live-assertions.mjs.
 */

import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, firefox } from '@playwright/test';

import { SessionRecorder } from './lib/session-recorder.mjs';
import { driveSession, finaliseRequests, MAPS_URL, URL_SHAPES, VIEWPORT } from './lib/session.mjs';
import { verdicts, renderVerdicts } from './lib/live-assertions.mjs';
import { purgeServiceWorkerCache } from './lib/chrome-profile.mjs';
import { installAndProbe, relistAddon, evalInBackground, STATE_EXPR } from './lib/firefox-addon.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, '..');
const ARTIFACTS = path.join(ROOT, 'test', 'artifacts', 'live');
const PROFILES = path.join(ROOT, 'test', '.profiles');

const MODES = {
  chrome: { browser: 'chromium', extension: true, expectation: 'dark' },
  'chrome-control': { browser: 'chromium', extension: false, expectation: 'light' },
  firefox: { browser: 'firefox', extension: true, expectation: 'dark' },
  'firefox-control': { browser: 'firefox', extension: false, expectation: 'light' },
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------------ launch */

const COMMON_CHROMIUM_ARGS = [
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-features=Translate,OptimizationHints',
  '--hide-crash-restore-bubble',
];

async function launchChromium({ profileDir, extDir, log }) {
  // Chrome serves the CACHED service-worker script for an unpacked extension
  // across a restart AND across a manifest version bump, so a profile that has
  // been used before can run the previous background.js while reporting the new
  // version. This profile is a fresh mkdtemp and the purge is a no-op today; it
  // is unconditional so that reusing a profile later cannot silently reintroduce
  // the hazard. See test/lib/chrome-profile.mjs.
  const purge = purgeServiceWorkerCache(profileDir);
  log(
    `service-worker cache purge: ${
      purge.removed.length ? `removed ${purge.removed.join(', ')}` : 'nothing to remove (fresh profile)'
    }`
  );
  const args = [
    ...COMMON_CHROMIUM_ARGS,
    ...(extDir ? [`--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`] : []),
  ];
  const base = {
    headless: false,
    viewport: VIEWPORT,
    args,
    ignoreDefaultArgs: ['--disable-extensions'],
    locale: 'en-US',
    timezoneId: 'America/Chicago',
    colorScheme: 'dark',
  };
  const ctx = await chromium.launchPersistentContext(profileDir, base);
  log(`launch: playwright bundled chromium (${chromium.executablePath()})`);
  return { context: ctx, launchMethod: 'bundled-chromium', executable: chromium.executablePath() };
}

async function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const p = srv.address().port;
      srv.close(() => resolve(p));
    });
  });
}

async function launchFirefox({ profileDir, rdpPort, log }) {
  const ctx = await firefox.launchPersistentContext(profileDir, {
    headless: false,
    viewport: VIEWPORT,
    locale: 'en-US',
    timezoneId: 'America/Chicago',
    colorScheme: 'dark',
    args: ['-start-debugger-server', String(rdpPort)],
    firefoxUserPrefs: {
      'devtools.debugger.remote-enabled': true,
      'devtools.debugger.prompt-connection': false,
      'devtools.chrome.enabled': true,
      'xpinstall.signatures.required': false,
      'extensions.dnr.feedback': true,
      'browser.shell.checkDefaultBrowser': false,
      'browser.aboutwelcome.enabled': false,
    },
  });
  log(`launch: playwright bundled firefox (${firefox.executablePath()})`);
  return { context: ctx, launchMethod: 'bundled-firefox', executable: firefox.executablePath() };
}

/* --------------------------------------------------------------- one run -- */

export async function runMode(mode) {
  const cfg = MODES[mode];
  if (!cfg) throw new Error(`unknown mode "${mode}"; expected one of ${Object.keys(MODES).join(', ')}`);

  const extDir = cfg.extension
    ? process.env.GATE_EXT_DIR ?? path.join(ROOT, 'dist', cfg.browser === 'firefox' ? 'firefox' : 'chrome')
    : null;
  if (extDir && !fs.existsSync(path.join(extDir, 'manifest.json'))) {
    throw new Error(`mode=${mode} needs a built extension at ${extDir}; run \`npm run build\` first`);
  }

  const artifactsDir = path.join(ARTIFACTS, mode);
  fs.mkdirSync(artifactsDir, { recursive: true });
  fs.mkdirSync(PROFILES, { recursive: true });
  const profileDir = fs.mkdtempSync(path.join(PROFILES, `live-${mode}-`));

  const lines = [];
  const log = (msg) => {
    const line = `[${mode}] ${msg}`;
    lines.push(line);
    console.log(line);
  };

  const result = {
    mode,
    expectation: cfg.expectation,
    browserName: cfg.browser,
    extensionDir: extDir,
    startedAt: new Date().toISOString(),
    profileDir,
    mapsUrl: MAPS_URL,
    urlShapesPlanned: URL_SHAPES.map((s) => ({ id: s.id, url: s.url, why: s.why })),
    viewport: VIEWPORT,
    extensionLoaded: false,
    extensionId: null,
    mozExtensionUuid: null,
    consentWallHit: false,
    errors: [],
    log: lines,
  };

  log('='.repeat(96));
  log(`LIVE GATE  mode=${mode}  expectation=${cfg.expectation}  extension=${extDir ?? '<none, control>'}`);
  log('='.repeat(96));

  if (extDir) {
    const m = JSON.parse(fs.readFileSync(path.join(extDir, 'manifest.json'), 'utf8'));
    result.extensionManifest = { name: m.name, version: m.version, mv: m.manifest_version };
    result.rulesetIds = (m.declarative_net_request?.rule_resources ?? []).map((r) => r.id);
    result.geckoId = m.browser_specific_settings?.gecko?.id ?? null;
    log(`extension manifest: name="${m.name}" v${m.version} mv=${m.manifest_version} rulesets=${JSON.stringify(result.rulesetIds)}`);
  }

  let rdpPort = null;
  let launched;
  if (cfg.browser === 'firefox') {
    rdpPort = await freePort();
    launched = await launchFirefox({ profileDir, rdpPort, log });
  } else {
    launched = await launchChromium({ profileDir, extDir, log });
  }
  const context = launched.context;
  result.launchMethod = launched.launchMethod;
  result.executable = launched.executable;
  result.rdpPort = rdpPort;

  const rec = new SessionRecorder();
  rec.attach(context);

  let rdp = null;
  try {
    /* --- prove the extension is really loaded --------------------------- */
    if (extDir && cfg.browser === 'firefox') {
      const inst = await installAndProbe(rdpPort, extDir, result.geckoId, log);
      rdp = inst.client;
      result.mozExtensionUuid = inst.uuid;
      result.firefoxAddonEntry = {
        id: inst.entry?.id,
        temporarilyInstalled: inst.entry?.temporarilyInstalled,
        backgroundScriptStatus: inst.entry?.backgroundScriptStatus,
        warnings: inst.entry?.warnings ?? null,
      };
      const bg = await evalInBackground(rdp, inst.descriptorActor, STATE_EXPR, log);
      result.backgroundState = bg.parsed;
      result.backgroundEvalRaw = bg.raw?.slice?.(0, 4000) ?? null;
      log(`background state: ${JSON.stringify(bg.parsed)}`);
      result.extensionLoaded =
        inst.entry?.temporarilyInstalled === true &&
        Array.isArray(bg.parsed?.enabledRulesets) &&
        bg.parsed.enabledRulesets.length > 0;
      if (!result.extensionLoaded) {
        throw new Error(
          'add-on did not come up with an enabled ruleset; aborting before touching Google ' +
            `(entry=${JSON.stringify(result.firefoxAddonEntry)} bg=${JSON.stringify(bg.parsed)})`
        );
      }
      log(`extension load verdict: ACTIVE (rulesets ${JSON.stringify(bg.parsed.enabledRulesets)})`);
    } else if (extDir) {
      let sw = context.serviceWorkers()[0] ?? null;
      if (!sw) {
        try {
          sw = await context.waitForEvent('serviceworker', { timeout: 30000 });
        } catch {
          sw = null;
        }
      }
      if (!sw) throw new Error('no extension service worker appeared within 30s');
      result.serviceWorkerUrl = sw.url();
      result.extensionId = sw.url().match(/^chrome-extension:\/\/([a-p]+)\//)?.[1] ?? null;
      log(`service worker active: ${sw.url()}`);

      result.backgroundState = await sw.evaluate(async () => {
        const out = {};
        try {
          out.enabledRulesets = await chrome.declarativeNetRequest.getEnabledRulesets();
        } catch (e) {
          out.enabledRulesetsError = String(e);
        }
        try {
          out.dynamicRules = (await chrome.declarativeNetRequest.getDynamicRules()).length;
          out.sessionRules = (await chrome.declarativeNetRequest.getSessionRules()).length;
        } catch (e) {
          out.ruleCountError = String(e);
        }
        try {
          out.manifestName = chrome.runtime.getManifest().name;
        } catch (e) {
          out.manifestError = String(e);
        }
        // Read from storage, not runtime.sendMessage: a service worker's own
        // sendMessage does not reach its own onMessage listener. background.js
        // writes the record on onInstalled, which always fires on this fresh
        // profile.
        try {
          let rec = null;
          for (let i = 0; i < 60 && !rec; i++) {
            rec = (await chrome.storage.local.get('health'))?.health ?? null;
            if (!rec) await new Promise((r) => setTimeout(r, 500));
          }
          out.health = rec
            ? {
                verdict: rec.verdict,
                rules: rec.rules?.status,
                legend: rec.legend?.status,
                raster: rec.raster?.status,
                ruleChecks: (rec.rules?.checks ?? []).map((c) => ({
                  id: c.ruleId,
                  name: c.name,
                  matched: c.matched,
                  rewriteOk: c.rewriteOk,
                  loopFreeOffline: c.loopFreeOffline,
                  loopFreeLive: c.loopFreeLive,
                  note: c.note,
                })),
              }
            : null;
        } catch (e) {
          out.healthError = String(e);
        }
        return out;
      });
      log(`background state: ${JSON.stringify(result.backgroundState)}`);

      // Independent proof of installation: read the manifest back over the
      // extension origin. getEnabledRulesets alone stays green even when a rule
      // was silently dropped, so it is never treated as proof on its own.
      const probe = await context.newPage();
      try {
        const resp = await probe.goto(`chrome-extension://${result.extensionId}/manifest.json`, { timeout: 15000 });
        const parsed = JSON.parse(await probe.evaluate(() => document.body.innerText));
        result.extensionLoaded = resp?.ok() === true;
        log(`extension load verified: id=${result.extensionId} status=${resp?.status()} name="${parsed.name}"`);
      } finally {
        await probe.close().catch(() => {});
      }
      if (!result.extensionLoaded) throw new Error('extension manifest read-back failed');
    } else {
      log('control run: no extension loaded (identical launch otherwise)');
    }

    /* --- drive the session ---------------------------------------------- */
    await driveSession({ context, rec, label: mode, artifactsDir, log, result });

    /* --- was the extension still armed at the end? ----------------------- */
    if (extDir && cfg.browser === 'firefox' && rdp) {
      try {
        const entry = await relistAddon(rdp, result.geckoId);
        const bg = await evalInBackground(rdp, entry?.actor, STATE_EXPR, log);
        result.postRunState = {
          temporarilyInstalled: entry?.temporarilyInstalled,
          backgroundScriptStatus: entry?.backgroundScriptStatus,
          state: bg.parsed,
        };
        log(`post-run probe: ${JSON.stringify(result.postRunState)}`);
      } catch (err) {
        log(`post-run probe failed: ${err.message}`);
      }
    } else if (extDir) {
      try {
        const sw = context.serviceWorkers()[0];
        result.postRunState = sw
          ? await sw.evaluate(async () => ({
              enabledRulesets: await chrome.declarativeNetRequest.getEnabledRulesets(),
            }))
          : { note: 'service worker had been torn down by the end of the run' };
        log(`post-run probe: ${JSON.stringify(result.postRunState)}`);
      } catch (err) {
        result.postRunState = { error: err.message };
        log(`post-run probe failed: ${err.message}`);
      }
    }
  } catch (err) {
    result.errors.push(String(err?.stack ?? err));
    log(`ERROR: ${err.message}`);
  } finally {
    await finaliseRequests(rec, result);
    try {
      rdp?.close();
    } catch {
      /* socket already gone */
    }
    await context.close().catch(() => {});
    try {
      fs.rmSync(profileDir, { recursive: true, force: true, maxRetries: 3 });
    } catch {
      /* Windows sometimes holds the profile briefly; .gitignore covers it */
    }
    result.finishedAt = new Date().toISOString();
  }

  result.verdicts = verdicts(result, cfg.expectation);
  const report = renderReport(result);
  console.log(report);

  fs.writeFileSync(path.join(artifactsDir, 'result.json'), JSON.stringify(result, null, 2));
  fs.writeFileSync(path.join(artifactsDir, 'console.log'), `${lines.join('\n')}\n${report}\n`);
  log(`artifacts: ${path.relative(ROOT, artifactsDir).replace(/\\/g, '/')}/`);
  return result;
}

/* ------------------------------------------------------------------ report */

function renderReport(result) {
  const s = result.requests ?? {};
  const v = result.verdicts;
  const t = (k) => s.byTransport?.[k] ?? {};
  const out = [
    '',
    '-'.repeat(96),
    `RUN SUMMARY  [${result.mode}]  expectation=${result.expectation}`,
    '-'.repeat(96),
    `browser              : ${result.browserName} via ${result.launchMethod}`,
    `extension dir        : ${result.extensionDir ?? '<none - control run>'}`,
    `extension loaded     : ${result.extensionLoaded} id=${result.extensionId ?? result.mozExtensionUuid ?? '-'}`,
    `background state     : ${JSON.stringify(result.backgroundState ?? null)}`,
    `post-run state       : ${JSON.stringify(result.postRunState ?? null)}`,
    `consent wall         : ${result.consentWallHit === true}`,
    `final page url       : ${result.finalPageUrl}`,
    `gesture notes        : ${JSON.stringify(result.gestureNotes ?? [])}`,
    '',
    `recorded requests    : ${s.totalRecorded} (plus ${s.preNavigation?.count ?? 0} pre-navigation, ` +
      `extension-originated: ${JSON.stringify(s.preNavigation?.tokens ?? {})})`,
    `  buckets            : ${JSON.stringify(s.buckets)}`,
    `base-map (terminal)  : ${s.baseMapTerminal}   rewritable ${s.rewritableTerminal} of which dark ${s.rewritableDark}` +
      `   non-rewritable (proto) ${s.nonRewritableTerminal}`,
    `distinct zooms       : [${(s.distinctZooms ?? []).join(', ')}]`,
    `legend versions seen : ${JSON.stringify(s.legendVersionsSeen ?? [])}`,
    '',
    'PER TRANSPORT (terminal = the URL Google actually served, after redirects):',
    ...['legend', 'stream', 'raster', 'proto'].map(
      (k) =>
        `  ${k.padEnd(7)} requests=${String(t(k).requests ?? 0).padStart(5)} ` +
        `baseRaw=${String(t(k).baseMapRaw ?? 0).padStart(5)} ` +
        `baseTerminal=${String(t(k).baseMapTerminal ?? 0).padStart(5)} ` +
        `superseded=${String(t(k).superseded ?? 0).padStart(4)} ` +
        `dark=${String(t(k).darkTerminal ?? 0).padStart(5)} light=${String(t(k).lightTerminal ?? 0).padStart(5)} ` +
        `tokens=${JSON.stringify(t(k).tokensTerminal ?? {})} zooms=[${(t(k).zooms ?? []).join(',')}]`
    ),
    '',
    'PER PHASE:',
    ...Object.entries(s.zoomsByPhase ?? {}).map(
      ([k, val]) =>
        `  ${k.padEnd(14)} req=${String(val.recorded).padStart(5)} base=${String(val.baseTerminal).padStart(5)} ` +
        `zooms=[${val.zooms.join(',')}] tokens=${JSON.stringify(val.tokens)}`
    ),
    '',
    'LUMINANCE TIME SERIES (map area; t is ms from navigation start):',
    ...(result.samples ?? []).map(
      (x) =>
        `  ${String(x.atMsFromNav).padStart(7)}ms  ${x.sample.padEnd(22)} ` +
        `rgb=(${String(x.pixels.r).padStart(6)},${String(x.pixels.g).padStart(6)},${String(x.pixels.b).padStart(6)}) ` +
        `lum=${String(x.pixels.luminance).padStart(6)} sd=${String(x.pixels.stdev).padStart(6)} ` +
        `colours=${String(x.pixels.distinctColours).padStart(4)} -> ${x.verdict}`
    ),
    '',
    'URL SHAPES (the content script marker is written by theme.js and by nothing on Google\'s side):',
    ...(result.urlShapes ?? []).map(
      (s) =>
        `  ${String(s.id).padEnd(7)} ${String(s.requested).padEnd(46)} http=${String(s.httpStatus ?? '-').padStart(3)} ` +
        `data-mapsnoir=${JSON.stringify(s.marker)}\n` +
        `          landed: ${s.landed}\n` +
        `          server redirect chain: ${JSON.stringify(s.serverRedirects ?? [])}` +
        (s.error ? `\n          ERROR: ${s.error}` : '')
    ),
    '',
    'APP CHROME SAMPLES:',
    ...(result.chromeSamples ?? []).map(
      (x) =>
        `  ${x.region.padEnd(10)} @${x.phase.padEnd(14)} rgb=(${String(x.pixels.r).padStart(6)},` +
        `${String(x.pixels.g).padStart(6)},${String(x.pixels.b).padStart(6)}) lum=${String(x.pixels.luminance).padStart(6)}`
    ),
    '',
    `ASSERTIONS (expectation: ${result.expectation})`,
    renderVerdicts(v),
    '',
    ...(s.darkSample?.length ? ['sample dark URL:', `  ${s.darkSample[0]}`] : []),
    ...(s.offenderSample?.length ? ['sample offending URL:', `  ${s.offenderSample[0]}`] : []),
    ...(result.errors.length ? ['', 'RUN ERRORS:', ...result.errors.map((e) => `  ${e.split('\n')[0]}`)] : []),
    '-'.repeat(96),
    `RESULT [${result.mode}]: ${v.pass ? 'PASS' : 'FAIL'}${v.voidGate ? '   *** GATE VOID ***' : ''}` +
      `${result.errors.length ? '   (with run errors)' : ''}`,
    '-'.repeat(96),
  ];
  return out.join('\n');
}

/* --------------------------------------------------------------------- CLI */

async function main() {
  const arg = process.argv[2] ?? 'chrome';
  const modes = arg === 'all' ? ['chrome', 'chrome-control', 'firefox', 'firefox-control'] : [arg];
  const results = [];
  for (const m of modes) {
    results.push(await runMode(m));
    if (m !== modes.at(-1)) await sleep(4000); // do not hammer the live site
  }

  console.log('');
  console.log('='.repeat(96));
  console.log('COMBINED');
  console.log('='.repeat(96));
  for (const r of results) {
    console.log(
      `  ${r.mode.padEnd(16)} ${r.verdicts.pass ? 'PASS' : 'FAIL'}${r.verdicts.voidGate ? '  *** VOID ***' : ''}  ` +
        `[${r.verdicts.list.map((a) => `${a.id}:${a.pass ? 'ok' : 'FAIL'}`).join(' ')}]` +
        `${r.errors.length ? `  errors=${r.errors.length}` : ''}`
    );
  }
  const anyVoid = results.some((r) => r.verdicts.voidGate);
  const allPass = results.every((r) => r.verdicts.pass) && results.every((r) => r.errors.length === 0);
  fs.mkdirSync(ARTIFACTS, { recursive: true });
  fs.writeFileSync(
    path.join(ARTIFACTS, 'summary.json'),
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        modes,
        void: anyVoid,
        pass: allPass && !anyVoid,
        runs: results.map((r) => ({
          mode: r.mode,
          pass: r.verdicts.pass,
          void: r.verdicts.voidGate,
          errors: r.errors.length,
          assertions: r.verdicts.list.map((a) => ({ id: a.id, pass: a.pass, observed: a.observed })),
          companions: (r.verdicts.companions ?? []).map((c) => ({ id: c.id, pass: c.pass, observed: c.observed })),
        })),
      },
      null,
      2
    )
  );
  if (anyVoid) {
    console.log('\nGATE VOID: the control run satisfied a positive assertion. No pass here means anything.');
    process.exitCode = 2;
  } else if (!allPass) {
    process.exitCode = 1;
  }
}

// Windows: import.meta.url is a percent-encoded file:/// URL, so comparing it to
// a hand-built string silently never matches on a path containing a space.
const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
