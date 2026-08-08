#!/usr/bin/env node
/**
 * Spike 2: having installed the add-on over RDP, prove it is *active*, not just
 * *listed*. Three independent probes, all of which must be positive statements:
 *
 *   1. `listAddons` -> temporarilyInstalled + the per-profile moz-extension UUID
 *   2. navigate a page to `moz-extension://<uuid>/manifest.json` and read it back
 *   3. attach to the add-on's own background context and ask
 *      `browser.declarativeNetRequest.getEnabledRulesets()`
 *
 * (3) is the one that actually answers "is the rewrite rule armed".
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { firefox } from '@playwright/test';
import { connectWithRetry, installTemporaryAddon } from './rdp.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..');
const EXT = path.join(ROOT, 'dist', 'firefox');
const PORT = Number(process.env.RDP_PORT ?? 6098);

/**
 * Read from the built manifest, never hard-coded: this used to be the literal
 * `maps-noir@local.test` and went stale the moment the add-on was renamed to its
 * AMO id, which would have left `ours` undefined and every probe below reporting
 * `undefined` rather than failing.
 */
const GECKO_ID =
  JSON.parse(fs.readFileSync(path.join(EXT, 'manifest.json'), 'utf8'))
    ?.browser_specific_settings?.gecko?.id;
if (!GECKO_ID) throw new Error(`no browser_specific_settings.gecko.id in ${EXT}/manifest.json`);

const profiles = path.join(ROOT, 'test', '.profiles');
fs.mkdirSync(profiles, { recursive: true });
const profileDir = fs.mkdtempSync(path.join(profiles, 'ffprobe-'));

const ctx = await firefox.launchPersistentContext(profileDir, {
  headless: false,
  viewport: { width: 900, height: 700 },
  args: ['-start-debugger-server', String(PORT)],
  firefoxUserPrefs: {
    'devtools.debugger.remote-enabled': true,
    'devtools.debugger.prompt-connection': false,
    'devtools.chrome.enabled': true,
    'xpinstall.signatures.required': false,
    'extensions.dnr.feedback': true,
    'browser.shell.checkDefaultBrowser': false,
  },
});

const { client } = await connectWithRetry(PORT, { attempts: 24, delayMs: 500 });
const res = await installTemporaryAddon(client, EXT);
const ours = res.listed.find((a) => a.id === GECKO_ID);
console.log('--- listAddons entry (full) ---');
console.log(JSON.stringify(ours, null, 2));

const uuid = String(ours?.manifestURL ?? '').match(/moz-extension:\/\/([0-9a-f-]+)\//)?.[1] ?? null;
console.log(`\nmoz-extension uuid: ${uuid}`);

/* --- probe 2: read the manifest back out of the browser ------------------- */
if (uuid) {
  const p = await ctx.newPage();
  try {
    const resp = await p.goto(`moz-extension://${uuid}/manifest.json`, {
      timeout: 15000,
      waitUntil: 'domcontentloaded',
    });
    const body = await p.evaluate(() => document.body.innerText);
    console.log(`manifest read-back status=${resp?.status()} bytes=${body.length}`);
    console.log(`  name="${JSON.parse(body).name}"`);
  } catch (err) {
    console.log(`manifest read-back FAILED: ${err.message}`);
  } finally {
    await p.close().catch(() => {});
  }
}

/* --- probe 3: evaluate inside the add-on's background context ------------- */
const descriptor = ours?.actor;
console.log(`\ndescriptor actor: ${descriptor}`);

async function tryEval() {
  if (!descriptor) return { error: 'no descriptor actor in listAddons' };

  // Path A: legacy/simple -- descriptor exposes the target form directly.
  let consoleActor = null;
  let how = null;
  try {
    const t = await client.request({ to: descriptor, type: 'getTarget' }, { timeoutMs: 15000 });
    consoleActor = t?.frame?.consoleActor ?? t?.form?.consoleActor ?? null;
    if (consoleActor) how = 'descriptor.getTarget';
  } catch (err) {
    console.log(`  getTarget failed: ${err.message}`);
  }

  // Path B: modern -- watcher actor streams target forms as notifications.
  if (!consoleActor) {
    try {
      const w = await client.request({ to: descriptor, type: 'getWatcher' }, { timeoutMs: 15000 });
      const watcher = w.actor ?? w.watcher ?? w?.form?.actor;
      console.log(`  watcher actor: ${watcher}`);
      const before = client.notifications.length;
      await client.request(
        { to: watcher, type: 'watchTargets', targetType: 'frame' },
        { timeoutMs: 20000 }
      );
      await new Promise((r) => setTimeout(r, 1500));
      const forms = client.notifications
        .slice(before)
        .filter((n) => n.type === 'target-available-form')
        .map((n) => n.target);
      console.log(`  target forms: ${JSON.stringify(forms.map((f) => ({ url: f?.url, browsingContextID: f?.browsingContextID, hasConsole: Boolean(f?.consoleActor) })))}`);
      const form = forms.find((f) => f?.consoleActor);
      consoleActor = form?.consoleActor ?? null;
      if (consoleActor) how = 'watcher.watchTargets(frame)';
    } catch (err) {
      console.log(`  getWatcher path failed: ${err.message}`);
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
    try {
      out.testMatchOutcome = await api.declarativeNetRequest.testMatchOutcome({
        url: 'https://www.google.com/maps/vt/pb=!1m4!1m3!1i13!2i1925!3i3385!2m3!1e0!2sm!3i789555512!3m8!2sen!3sus!5e1105!12m4!1e68!2m2!1sset!2sRoadmap!4e0!5m1!1e0',
        initiator: 'https://www.google.com',
        type: 'xmlhttprequest',
        method: 'get',
      });
    } catch (e) { out.testMatchOutcomeError = String(e); }
    return JSON.stringify(out);
  })()`;

  const reply = await client.request(
    { to: consoleActor, type: 'evaluateJSAsync', text: expr, mapped: { await: true } },
    { timeoutMs: 30000 }
  );
  console.log(`  evaluateJSAsync ack: ${JSON.stringify(reply).slice(0, 300)}`);
  // The result arrives as an unsolicited `evaluationResult` packet.
  let out = null;
  for (let i = 0; i < 40 && !out; i++) {
    out = client.notifications.find(
      (n) => n.type === 'evaluationResult' && n.resultID === reply.resultID
    );
    if (!out) await new Promise((r) => setTimeout(r, 250));
  }
  return { how, consoleActor, evaluationResult: out };
}

try {
  const r = await tryEval();
  console.log('\n--- background eval ---');
  console.log(JSON.stringify(r, null, 2).slice(0, 3000));
} catch (err) {
  console.log(`background eval FAILED: ${err.message}`);
}

client.close();
await ctx.close().catch(() => {});
fs.rmSync(profileDir, { recursive: true, force: true, maxRetries: 3 });
