#!/usr/bin/env node
/**
 * Why did the side-loaded XPI not activate?
 *
 * Builds the profile exactly as the gate does, launches Playwright's bundled
 * Firefox, then reads back two things the gate run cannot see because it deletes
 * the profile in its finally block:
 *
 *   1. the ZIP central directory of the XPI we produced (PowerShell's
 *      Compress-Archive has historically written backslash path separators,
 *      which a strict ZIP reader rejects);
 *   2. <profile>/extensions.json, which is where Firefox records every add-on it
 *      considered, with `active`, `appDisabled`, `userDisabled` and
 *      `signedState` -- the four fields that distinguish "bad archive" from
 *      "refused for want of a signature".
 *
 * Run: node test/diagnose-firefox.mjs [chrome|firefox-fixture]
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { firefox } from '@playwright/test';
import { zipDirectory } from './lib/zip.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const extDir =
  process.argv[2] === 'firefox-fixture'
    ? path.join(ROOT, 'test', 'fixtures', 'probe-extension-firefox')
    : path.join(ROOT, 'dist', 'firefox');

fs.mkdirSync(path.join(ROOT, 'test', '.profiles'), { recursive: true });
const profileDir = fs.mkdtempSync(path.join(ROOT, 'test', '.profiles', 'ffdiag-'));
const manifest = JSON.parse(fs.readFileSync(path.join(extDir, 'manifest.json'), 'utf8'));
const geckoId = manifest?.browser_specific_settings?.gecko?.id;
console.log(`extension : ${extDir}`);
console.log(`gecko id  : ${geckoId}`);

const extRoot = path.join(profileDir, 'extensions');
fs.mkdirSync(extRoot, { recursive: true });
const xpiPath = path.join(extRoot, geckoId + '.xpi');
const zipInfo = zipDirectory(extDir, xpiPath);
console.log('zip entries:', JSON.stringify(zipInfo.entries));

/* --- 1. inspect the archive we produced ---------------------------------- */
const buf = fs.readFileSync(xpiPath);
const names = [];
for (let i = 0; i + 4 < buf.length; i++) {
  if (buf.readUInt32LE(i) === 0x02014b50) {
    const nameLen = buf.readUInt16LE(i + 28);
    names.push(buf.subarray(i + 46, i + 46 + nameLen).toString('utf8'));
  }
}
console.log(`\nXPI       : ${xpiPath} (${buf.length} bytes)`);
console.log(`entries   : ${JSON.stringify(names)}`);
console.log(`backslashes in entry names: ${names.some((n) => n.includes('\\'))}`);
console.log(`manifest.json at archive root: ${names.includes('manifest.json')}`);

/* --- 2. what did Firefox make of it? ------------------------------------- */
const ctx = await firefox.launchPersistentContext(profileDir, {
  headless: false,
  viewport: { width: 900, height: 700 },
  firefoxUserPrefs: {
    'xpinstall.signatures.required': false,
    'extensions.autoDisableScopes': 0,
    'extensions.enabledScopes': 15,
    'extensions.startupScanScopes': 15,
    'extensions.installDistroAddons': false,
    'browser.shell.checkDefaultBrowser': false,
  },
});
const page = ctx.pages()[0] ?? (await ctx.newPage());
await page.goto('about:blank');
await new Promise((r) => setTimeout(r, 9000));
await ctx.close();

const dbPath = path.join(profileDir, 'extensions.json');
if (!fs.existsSync(dbPath)) {
  console.log('\nextensions.json was never written -- Firefox did not scan the profile scope.');
} else {
  const db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
  const rows = (db.addons ?? []).map((a) => ({
    id: a.id,
    location: a.location,
    active: a.active,
    userDisabled: a.userDisabled,
    appDisabled: a.appDisabled,
    signedState: a.signedState,
    type: a.type,
    version: a.version,
  }));
  console.log('\nextensions.json addons:');
  for (const r of rows) console.log(`  ${JSON.stringify(r)}`);
  const ours = rows.find((r) => r.id === geckoId);
  console.log(`\nour add-on present: ${Boolean(ours)}`);
  if (ours) {
    console.log(
      `verdict: active=${ours.active} appDisabled=${ours.appDisabled} ` +
        `userDisabled=${ours.userDisabled} signedState=${ours.signedState}  ` +
        '(signedState -1 = broken/unknown, 0 = missing signature, >=1 = signed)'
    );
  }
}
console.log(`\nprofile kept for inspection: ${profileDir}`);
