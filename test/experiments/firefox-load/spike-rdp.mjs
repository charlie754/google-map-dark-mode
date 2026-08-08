#!/usr/bin/env node
/**
 * Spike: can Playwright's bundled Firefox be talked to over RDP, and will it
 * accept `installTemporaryAddon` for the unsigned, unpacked add-on?
 *
 * Nothing here touches Google. It launches, installs, interrogates, and exits.
 * Usage: node test/experiments/firefox-load/spike-rdp.mjs [bundled|devedition]
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { firefox } from '@playwright/test';
import { connectWithRetry, installTemporaryAddon } from './rdp.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..');
const EXT = path.join(ROOT, 'dist', 'firefox');
const PORT = Number(process.env.RDP_PORT ?? 6099);

const profiles = path.join(ROOT, 'test', '.profiles');
fs.mkdirSync(profiles, { recursive: true });
const profileDir = fs.mkdtempSync(path.join(profiles, 'ffspike-'));

const prefs = {
  'devtools.debugger.remote-enabled': true,
  'devtools.debugger.prompt-connection': false,
  'devtools.chrome.enabled': true,
  'devtools.debugger.remote-port': PORT,
  'xpinstall.signatures.required': false,
  'extensions.dnr.feedback': true,
  'browser.shell.checkDefaultBrowser': false,
};

console.log(`profile : ${profileDir}`);
console.log(`ext     : ${EXT}`);
console.log(`port    : ${PORT}`);

const ctx = await firefox.launchPersistentContext(profileDir, {
  headless: false,
  viewport: { width: 900, height: 700 },
  args: ['-start-debugger-server', String(PORT)],
  firefoxUserPrefs: prefs,
});
console.log(`launched: ${firefox.executablePath()}`);

let outcome = { connected: false };
try {
  const { client, root, attempt } = await connectWithRetry(PORT, { attempts: 24, delayMs: 500 });
  outcome.connected = true;
  console.log(`RDP connected on attempt ${attempt}`);
  console.log(`root greeting: ${JSON.stringify(root).slice(0, 400)}`);

  const res = await installTemporaryAddon(client, EXT);
  console.log(`installTemporaryAddon -> ${JSON.stringify(res.addon)}`);
  console.log(`listAddons:`);
  for (const a of res.listed) {
    console.log(
      `  id=${a.id} temporarilyInstalled=${a.temporarilyInstalled} ` +
        `debuggable=${a.debuggable} url=${a.url ?? ''} manifestURL=${a.manifestURL ?? ''}`
    );
  }
  outcome.addon = res.addon;
  outcome.listed = res.listed;
  client.close();
} catch (err) {
  console.log(`RDP FAILED: ${err.message}`);
  outcome.error = err.message;
}

// Does the add-on's own origin answer? (moz-extension UUID is per-profile random)
try {
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  await page.goto('about:debugging#/runtime/this-firefox', { timeout: 15000 });
  await new Promise((r) => setTimeout(r, 2500));
  const text = await page.evaluate(() => document.body.innerText).catch((e) => `ERR ${e.message}`);
  console.log('--- about:debugging text ---');
  console.log(String(text).slice(0, 1500));
} catch (err) {
  console.log(`about:debugging read failed: ${err.message}`);
}

await ctx.close().catch(() => {});
fs.rmSync(profileDir, { recursive: true, force: true, maxRetries: 3 });
console.log(`\nRESULT: ${JSON.stringify({ connected: outcome.connected, error: outcome.error ?? null })}`);
