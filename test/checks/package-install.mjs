#!/usr/bin/env node
/**
 * THE STORE ARTIFACTS, INSTALLED.
 *
 *   node test/checks/package-install.mjs        (npm run test:package)
 *
 * `node tools/package.mjs` proves the two archives are well FORMED. This proves
 * they WORK: the exact files that would be uploaded are put into real browsers
 * and asked to come up.
 *
 * Everything before this point tests `dist/chrome/` and `dist/firefox/` -- the
 * unpacked directories. Nobody installs those. A store user installs a ZIP or an
 * XPI, and the packaging step sits between the two: it is the one stage whose
 * output no other check in this repo has ever loaded. The specific failure it
 * can produce is silent by nature (Firefox declines an XPI with backslash
 * separators without recording it anywhere), which is why "the build passed" is
 * not evidence that the package installs.
 *
 * ---------------------------------------------------------------------------
 * ARMS
 * ---------------------------------------------------------------------------
 * ARM 0  mutation controls, offline. Three deliberately-broken archives, each
 *        carrying one real defect, fed to the same verifier tools/package.mjs
 *        uses. If the verifier accepts any of them it is decorative and every
 *        "verified" line it printed means nothing.
 * ARM 1  Firefox. The .xpi FILE (not the directory) is installed over the
 *        DevTools RDP into a Playwright-launched Firefox, and the add-on must
 *        report `temporarilyInstalled: true`, `backgroundScriptStatus: RUNNING`
 *        and an enabled static ruleset.
 * ARM 2  Chromium. The .zip is EXTRACTED and loaded unpacked -- which is as
 *        close as an automated harness can get to a Web Store install, because
 *        Chromium cannot be told to install a local .crx without a policy. The
 *        extension must produce a service worker, an enabled ruleset, a
 *        per-rule testMatchOutcome match, and then a genuinely dark live Maps.
 *
 * ARM 2 touches the network (one navigation to live Google Maps). ARM 0 and
 * ARM 1 do not.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { chromium, firefox } from '@playwright/test';

import { zipDirectory, readZipFiles, extractZipTo } from '../lib/zip.mjs';
import { freshChromiumProfile } from '../lib/chrome-profile.mjs';
import { analyse, verdictWord } from '../lib/image.mjs';
import { mapClip, VIEWPORT, MAPS_URL } from '../lib/session.mjs';
import { installAndProbe, evalInBackground, STATE_EXPR } from '../lib/firefox-addon.mjs';
import { loadRules } from '../lib/rules.mjs';
import { MUST_MATCH } from '../fixtures/url-corpus.mjs';
import { SLUG, agreedVersion, verifyArchive, listFiles } from '../../tools/package.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const DIST = path.join(ROOT, 'dist');
const PROFILES = path.join(ROOT, 'test', '.profiles');
const ARTIFACTS = path.join(ROOT, 'test', 'artifacts', 'package');

const sleep = (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms)));

const results = [];
const record = (name, pass, detail) => {
  results.push({ name, pass, detail });
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}`);
  console.log(`        ${detail}`);
};

const log = (msg) => console.log(`  ${msg}`);

/* -------------------------------------------------------------------------- */
/* ARM 0 -- the verifier's own mutation controls                              */
/* -------------------------------------------------------------------------- */

/**
 * Build a ZIP by hand, entry names taken literally, so a deliberately-invalid
 * name can be written. `zipDirectory` cannot produce one -- which is the point
 * of it -- so the mutants are assembled here instead.
 */
function handmadeZip(destPath, files) {
  const crcTable = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  const crc32 = (b) => {
    let c = 0xffffffff;
    for (let i = 0; i < b.length; i++) c = crcTable[(c ^ b[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };

  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [rawName, contents] of files) {
    const data = Buffer.isBuffer(contents) ? contents : Buffer.from(contents, 'utf8');
    const name = Buffer.from(rawName, 'utf8');
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, data);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += local.length + name.length + data.length;
  }
  const centralBuf = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  fs.writeFileSync(destPath, Buffer.concat([...locals, centralBuf, eocd]));
  return destPath;
}

/** @returns {string|null} the rejection message, or null if it was accepted. */
function rejection(fn) {
  try {
    fn();
    return null;
  } catch (err) {
    return err.message.split('\n').slice(0, 3).join(' / ');
  }
}

function arm0(tmp, version) {
  console.log('--- ARM 0: the verifier rejects packages with each known defect (offline) ---');
  const manifest = JSON.stringify({ manifest_version: 3, name: 'x', version });

  // 1. Backslash separators -- Compress-Archive's signature defect, and the one
  //    Firefox refuses without telling anybody.
  const backslash = handmadeZip(path.join(tmp, 'mutant-backslash.zip'), [
    ['manifest.json', manifest],
    ['icons\\icon-16.png', 'fake'],
  ]);
  record(
    'ARM0.mutant-backslash-rejected',
    /backslash/i.test(rejection(() => verifyArchive(backslash, ['manifest.json', 'icons/icon-16.png'], version)) ?? ''),
    `verifyArchive said: ${rejection(() => verifyArchive(backslash, ['manifest.json', 'icons/icon-16.png'], version))}`
  );

  // 2. A wrapper directory: manifest.json one level down. Both stores reject it.
  const wrapper = handmadeZip(path.join(tmp, 'mutant-wrapper.zip'), [
    ['dist/manifest.json', manifest],
  ]);
  record(
    'ARM0.mutant-wrapper-directory-rejected',
    /not at the archive root/i.test(rejection(() => verifyArchive(wrapper, ['manifest.json'], version)) ?? ''),
    `verifyArchive said: ${rejection(() => verifyArchive(wrapper, ['manifest.json'], version))}`
  );

  // 3. A version inside the archive that is not the version in its name.
  const mismatched = handmadeZip(path.join(tmp, 'mutant-version.zip'), [
    ['manifest.json', JSON.stringify({ manifest_version: 3, name: 'x', version: '9.9.9' })],
  ]);
  record(
    'ARM0.mutant-version-mismatch-rejected',
    /version/i.test(rejection(() => verifyArchive(mismatched, ['manifest.json'], version)) ?? ''),
    `verifyArchive said: ${rejection(() => verifyArchive(mismatched, ['manifest.json'], version))}`
  );

  // 4. The control for the three above: a well-formed archive is ACCEPTED. If a
  //    verifier rejected everything, the three rejections would prove nothing.
  const goodDir = path.join(tmp, 'good-src');
  fs.mkdirSync(path.join(goodDir, 'icons'), { recursive: true });
  fs.writeFileSync(path.join(goodDir, 'manifest.json'), manifest);
  fs.writeFileSync(path.join(goodDir, 'icons', 'icon-16.png'), 'fake');
  const good = path.join(tmp, 'control-good.zip');
  zipDirectory(goodDir, good);
  const err = rejection(() => verifyArchive(good, listFiles(goodDir), version));
  record(
    'ARM0.control: a well-formed archive is accepted',
    err === null,
    err === null ? 'accepted, as it must be' : `WRONGLY rejected: ${err}`
  );
  console.log('');
}

/* -------------------------------------------------------------------------- */
/* ARM 1 -- the XPI, in Firefox                                               */
/* -------------------------------------------------------------------------- */

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

async function arm1(xpi, geckoId, rulesetId) {
  console.log('--- ARM 1: the built .xpi, installed into Firefox ---');
  console.log(`  artifact: ${xpi}`);
  const rdpPort = await freePort();
  fs.mkdirSync(PROFILES, { recursive: true });
  const profileDir = fs.mkdtempSync(path.join(PROFILES, 'pkg-firefox-'));

  const ctx = await firefox.launchPersistentContext(profileDir, {
    headless: false,
    viewport: VIEWPORT,
    locale: 'en-US',
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
  log(`launched ${firefox.executablePath()}`);

  let client = null;
  try {
    // The XPI FILE is handed to installTemporaryAddon, not the directory.
    // That is the whole point of this arm: it is the archive that is under test.
    const inst = await installAndProbe(rdpPort, xpi, geckoId, log);
    client = inst.client;
    const entry = inst.entry;

    record(
      'ARM1.xpi-installed',
      entry?.id === geckoId && entry?.temporarilyInstalled === true,
      `listAddons entry: id=${entry?.id} temporarilyInstalled=${entry?.temporarilyInstalled} ` +
        `warnings=${JSON.stringify(entry?.warnings ?? null)}. An XPI Firefox declines never ` +
        'appears here at all -- there is no error, so this presence check IS the load proof.'
    );
    record(
      'ARM1.background-RUNNING',
      entry?.backgroundScriptStatus === 'RUNNING',
      `backgroundScriptStatus=${entry?.backgroundScriptStatus} (Firefox MV3 runs an event page, ` +
        'never a service worker, so this is the only status the add-on manager reports)'
    );

    const bg = await evalInBackground(client, inst.descriptorActor, STATE_EXPR, log);
    log(`background state: ${JSON.stringify(bg.parsed)}`);
    record(
      'ARM1.ruleset-enabled-from-the-xpi',
      Array.isArray(bg.parsed?.enabledRulesets) && bg.parsed.enabledRulesets.includes(rulesetId),
      `enabledRulesets=${JSON.stringify(bg.parsed?.enabledRulesets)} manifestName=` +
        `${JSON.stringify(bg.parsed?.manifestName)} -- read from inside the installed add-on`
    );
    record(
      'ARM1.self-check-ran',
      bg.parsed?.health !== null && bg.parsed?.health !== undefined,
      `health=${JSON.stringify(bg.parsed?.health)}. testMatchOutcome does not exist on Firefox, so ` +
        'the rules half degrades to the dynamic-rule mirror oracle; a non-null record proves the ' +
        'background script executed, which is what this arm is about.'
    );
    return { uuid: inst.uuid, entry, background: bg.parsed };
  } finally {
    try {
      client?.close();
    } catch {
      /* socket already gone */
    }
    await ctx.close().catch(() => {});
    try {
      fs.rmSync(profileDir, { recursive: true, force: true, maxRetries: 3 });
    } catch {
      /* Windows sometimes holds the profile briefly; .gitignore covers it */
    }
    console.log('');
  }
}

/* -------------------------------------------------------------------------- */
/* ARM 2 -- the ZIP's contents, in Chromium, against live Maps                */
/* -------------------------------------------------------------------------- */

async function arm2(zip, tmp, rulesetId) {
  console.log('--- ARM 2: the built .zip, extracted and loaded in Chromium, against live Maps ---');
  console.log(`  artifact: ${zip}`);
  const extDir = path.join(tmp, 'chrome-from-zip');
  const written = extractZipTo(zip, extDir);
  log(`extracted ${written.length} entries to ${extDir}`);
  record(
    'ARM2.zip-extracts-to-a-loadable-directory',
    fs.existsSync(path.join(extDir, 'manifest.json')),
    `manifest.json present after extraction; entries: ${written.join(', ')}`
  );

  fs.mkdirSync(ARTIFACTS, { recursive: true });
  const profileDir = freshChromiumProfile(PROFILES, 'pkg-chrome-', log);
  const ctx = await chromium.launchPersistentContext(profileDir, {
    headless: false,
    viewport: VIEWPORT,
    locale: 'en-US',
    timezoneId: 'America/Chicago',
    colorScheme: 'dark',
    args: [
      '--no-first-run',
      '--no-default-browser-check',
      '--hide-crash-restore-bubble',
      '--disable-features=Translate,OptimizationHints',
      `--disable-extensions-except=${extDir}`,
      `--load-extension=${extDir}`,
    ],
    ignoreDefaultArgs: ['--disable-extensions'],
  });
  log(`launched ${chromium.executablePath()}`);

  try {
    let sw = ctx.serviceWorkers()[0] ?? null;
    if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 30000 }).catch(() => null);
    record(
      'ARM2.service-worker-started',
      Boolean(sw),
      `service worker: ${sw ? sw.url() : 'NONE within 30s'}`
    );
    if (!sw) return null;

    const extensionId = sw.url().match(/^chrome-extension:\/\/([a-p]+)\//)?.[1] ?? null;

    const samples = loadRules().map((r) => {
      const s = MUST_MATCH.find((c) => c.ruleId === r.id);
      return { ruleId: r.id, name: s.name, url: s.url, resourceType: s.resourceType };
    });

    const state = await sw.evaluate(
      async ([samples, rulesetId]) => {
        const out = { matches: [] };
        // Barrier first: the extension disables its own ruleset on a bad
        // verdict, so read the settled state rather than racing the boot.
        let rec = null;
        for (let i = 0; i < 120 && !rec; i++) {
          rec = (await chrome.storage.local.get('health'))?.health ?? null;
          if (!rec) await new Promise((r) => setTimeout(r, 250));
        }
        out.health = rec ? { verdict: rec.verdict, rules: rec.rules?.status, legend: rec.legend?.status } : null;
        out.manifest = chrome.runtime.getManifest();
        out.enabledRulesets = await chrome.declarativeNetRequest.getEnabledRulesets();
        out.rulesetOn = out.enabledRulesets.includes(rulesetId);
        for (const s of samples) {
          try {
            const o = await chrome.declarativeNetRequest.testMatchOutcome({
              url: s.url,
              type: s.resourceType,
              initiator: 'https://www.google.com',
              method: 'get',
            });
            out.matches.push({
              ruleId: s.ruleId,
              name: s.name,
              matchedRuleIds: (o?.matchedRules ?? []).map((m) => m.ruleId),
              redirectTo: o?.matchedRules?.[0]?.rule ? null : null,
            });
          } catch (e) {
            out.matches.push({ ruleId: s.ruleId, name: s.name, error: String(e?.message ?? e) });
          }
        }
        return out;
      },
      [samples, rulesetId]
    );
    log(`state: ${JSON.stringify({ ...state, manifest: undefined })}`);

    record(
      'ARM2.rules-enabled-from-the-zip',
      state.rulesetOn === true,
      `getEnabledRulesets()=${JSON.stringify(state.enabledRulesets)} name=` +
        `${JSON.stringify(state.manifest?.name)} version=${state.manifest?.version} ` +
        `(self-check verdict=${state.health?.verdict}, rules=${state.health?.rules})`
    );
    for (const m of state.matches) {
      record(
        `ARM2.rule-${m.ruleId}-matches`,
        Array.isArray(m.matchedRuleIds) && m.matchedRuleIds.includes(m.ruleId),
        `${m.name}: Chrome matched ${JSON.stringify(m.matchedRuleIds ?? m.error)}`
      );
    }

    /* --- and now the only claim a user cares about ----------------------- */
    const page = ctx.pages()[0] ?? (await ctx.newPage());
    await page.setViewportSize(VIEWPORT);
    const clip = mapClip(VIEWPORT);
    log(`goto ${MAPS_URL}`);
    await page.goto(MAPS_URL, { waitUntil: 'domcontentloaded', timeout: 90000 });

    const series = [];
    for (const at of [3000, 6000, 10000]) {
      await sleep(at - (series.at(-1)?.at ?? 0));
      const buf = await page.screenshot({ clip, timeout: 20000 });
      const px = analyse(buf);
      fs.writeFileSync(path.join(ARTIFACTS, `chrome-zip-t${at}.png`), buf);
      series.push({ at, px, verdict: verdictWord(px) });
      log(
        `  t=${String(at).padStart(5)}ms rgb=(${px.r},${px.g},${px.b}) lum=${px.luminance} ` +
          `sd=${px.stdev} colours=${px.distinctColours} -> ${verdictWord(px)}`
      );
    }
    const rendered = series.filter((s) => s.px.valid);
    record(
      'ARM2.LIVE: the map is dark, from the packaged build',
      rendered.length > 0 && rendered.every((s) => s.px.isDark),
      `${rendered.filter((s) => s.px.isDark).length}/${rendered.length} rendered frames DARK: ` +
        series.map((s) => `${s.at}ms=(${s.px.r},${s.px.g},${s.px.b}) ${s.verdict}`).join(' | ') +
        `  [artifacts: test/artifacts/package/chrome-zip-t*.png]`
    );

    // The app chrome, which is the content script rather than the ruleset.
    const marker = await page
      .evaluate(() => document.documentElement.getAttribute('data-mapsnoir'))
      .catch(() => null);
    record(
      'ARM2.LIVE: the content script injected',
      marker === 'on',
      `document.documentElement[data-mapsnoir] = ${JSON.stringify(marker)} on ${page.url()} ` +
        '(the theme layer sets this itself; "on" means it ran and applied)'
    );

    return { extensionId, series, marker };
  } finally {
    await ctx.close().catch(() => {});
    try {
      fs.rmSync(profileDir, { recursive: true, force: true, maxRetries: 3 });
    } catch {
      /* Windows sometimes holds the profile briefly */
    }
    console.log('');
  }
}

/* -------------------------------------------------------------------------- */

async function main() {
  const built = ['chrome', 'firefox'].map((name) => {
    const dir = path.join(DIST, name);
    if (!fs.existsSync(path.join(dir, 'manifest.json'))) {
      throw new Error(`no built extension at ${dir}; run \`node tools/package.mjs\` first`);
    }
    return { name, dir, manifest: JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')) };
  });
  const version = agreedVersion(built);

  const zip = path.join(DIST, `${SLUG}-chrome-${version}.zip`);
  const xpi = path.join(DIST, `${SLUG}-firefox-${version}.xpi`);
  for (const f of [zip, xpi]) {
    if (!fs.existsSync(f)) throw new Error(`missing artifact ${f}; run \`node tools/package.mjs\` first`);
  }

  // Everything below is keyed off the ARCHIVED manifest, never the one on disk
  // beside it: if the two ever differ, the archive is what a user installs.
  const archivedFirefoxManifest = JSON.parse(readZipFiles(xpi).get('manifest.json').toString('utf8'));
  const archivedChromeManifest = JSON.parse(readZipFiles(zip).get('manifest.json').toString('utf8'));
  const geckoId = archivedFirefoxManifest?.browser_specific_settings?.gecko?.id;
  const rulesetIds = (archivedChromeManifest?.declarative_net_request?.rule_resources ?? []).map((r) => r.id);
  if (!geckoId) throw new Error('the archived Firefox manifest has no browser_specific_settings.gecko.id');
  if (rulesetIds.length !== 1) throw new Error(`expected one static ruleset, got ${JSON.stringify(rulesetIds)}`);
  const rulesetId = rulesetIds[0];

  console.log('='.repeat(96));
  console.log('STORE ARTIFACTS -- INSTALLED');
  console.log('='.repeat(96));
  console.log(`version      : ${version}   (from the built manifests)`);
  console.log(`chrome zip   : ${zip}  ${fs.statSync(zip).size} bytes`);
  console.log(`firefox xpi  : ${xpi}  ${fs.statSync(xpi).size} bytes`);
  console.log(`gecko id     : ${geckoId}`);
  console.log(`ruleset id   : ${rulesetId}`);
  console.log('');

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pkg-install-'));
  try {
    arm0(tmp, version);
    await arm1(xpi, geckoId, rulesetId);
    await arm2(zip, tmp, rulesetId);
  } finally {
    try {
      fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 3 });
    } catch {
      /* leave it for the OS */
    }
  }

  const failed = results.filter((r) => !r.pass);
  console.log('-'.repeat(96));
  console.log(`STORE ARTIFACT CHECKS: ${results.length - failed.length}/${results.length} passed`);
  if (failed.length) {
    console.log('FAILED:');
    for (const f of failed) console.log(`  - ${f.name}: ${f.detail}`);
  }
  console.log('-'.repeat(96));
  process.exitCode = failed.length ? 1 : 0;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
