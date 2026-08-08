/**
 * Store-acceptance checks on the two manifest variants.
 *
 * These exist because a manifest can be perfectly valid to *load* and still be
 * rejected at *submission*, and nothing else in this repo looks at the
 * difference. AMO refused the 1.0.0 XPI with "The data_collection_permissions
 * property is missing" -- a key Firefox does not need in order to run the
 * extension, that no local test exercised, and whose absence therefore only
 * surfaced at the upload form.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, 'extension', f), 'utf8'));

const firefox = read('manifest.firefox.json');
const chrome = read('manifest.chrome.json');

// Every value AMO accepts. `none` is mutually exclusive with the rest, and
// technicalAndInteraction is the one type that may only ever be optional.
const DATA_TYPES = new Set([
  'none',
  'personallyIdentifyingInfo',
  'healthInfo',
  'financialAndPaymentInfo',
  'authenticationInfo',
  'personalCommunications',
  'locationInfo',
  'browsingActivity',
  'websiteContent',
  'websiteActivity',
  'searchTerms',
  'bookmarksInfo',
  'technicalAndInteraction',
]);

test('the Firefox manifest declares data_collection_permissions (AMO rejects it otherwise)', () => {
  const dcp = firefox?.browser_specific_settings?.gecko?.data_collection_permissions;
  assert.ok(dcp, 'browser_specific_settings.gecko.data_collection_permissions is missing');
  assert.ok(Array.isArray(dcp.required), 'data_collection_permissions.required must be an array');
  assert.ok(dcp.required.length > 0, 'data_collection_permissions.required must not be empty');
});

test('every declared data type is one AMO recognises', () => {
  const dcp = firefox.browser_specific_settings.gecko.data_collection_permissions;
  for (const v of [...dcp.required, ...(dcp.optional ?? [])]) {
    assert.ok(DATA_TYPES.has(v), `unknown data collection type ${JSON.stringify(v)}`);
  }
});

test('"none" is declared alone, and technicalAndInteraction is never required', () => {
  const dcp = firefox.browser_specific_settings.gecko.data_collection_permissions;
  if (dcp.required.includes('none')) {
    assert.equal(dcp.required.length, 1, '"none" cannot be combined with other required types');
    assert.equal(dcp.optional, undefined, '"none" means nothing is collected, so there is nothing optional');
  }
  assert.ok(
    !dcp.required.includes('technicalAndInteraction'),
    'technicalAndInteraction must be optional, never required',
  );
});

test('the "none" declaration matches reality: no network egress and no analytics', () => {
  // If this ever fails, the manifest is not what needs changing -- the claim is.
  const sources = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.js')) sources.push([path.relative(ROOT, p), fs.readFileSync(p, 'utf8')]);
    }
  };
  walk(path.join(ROOT, 'extension'));
  assert.ok(sources.length > 0, 'found no extension sources to scan');

  // "Collects no data" is not the same as "makes no requests". background.js
  // does two outbound HEAD/GET health probes against gstatic to tell a rotated
  // legend version from a broken ruleset, and those send nothing about the
  // user. So the assertion is about the shape of a request that COULD carry
  // user data out, not about requests existing at all.
  const UPLOAD = /\b(sendBeacon|WebSocket|EventSource)\s*\(|\bmethod:\s*["']POST["']|\bbody:/;
  const uploaders = sources.filter(([, src]) => UPLOAD.test(src)).map(([rel]) => rel);
  assert.deepEqual(uploaders, [], `these can upload a payload while the manifest declares "none": ${uploaders}`);

  // A credentialled request carries the user's Google cookies to the endpoint,
  // which would make the probes identifying. Both must stay credentials-omit.
  const bg = sources.find(([rel]) => rel.endsWith('background.js'))[1];
  const fetches = (bg.match(/\bfetch\s*\(/g) ?? []).length;
  const omits = (bg.match(/credentials:\s*["']omit["']/g) ?? []).length;
  assert.equal(
    omits,
    fetches - 1, // the one exception is fetch(runtime.getURL(...)), which never leaves the extension
    `every outbound fetch in background.js must be credentials-omit (${fetches} fetches, ${omits} omits)`,
  );

  // storage.sync would put user data on Mozilla's servers; storage.local does not.
  const synced = sources.filter(([, src]) => /storage\.sync\b/.test(src)).map(([rel]) => rel);
  assert.deepEqual(synced, [], `these use storage.sync while the manifest declares "none": ${synced}`);
});

test('the version floors are at or above where data_collection_permissions is supported', () => {
  // Desktop Firefox understands the key from 140, Firefox for Android from 142.
  // Declaring it under an older floor is accepted but produces an AMO warning on
  // every submission ("requires Firefox 128, which was released before version
  // 140 introduced support for ..."), and worse, means the key silently does
  // nothing on the versions the floor claims to support.
  const bss = firefox.browser_specific_settings;
  const floor = (s) => Number(String(s).split('.')[0]);
  assert.ok(floor(bss.gecko.strict_min_version) >= 140, 'gecko.strict_min_version must be >= 140');
  assert.ok(
    floor(bss.gecko_android?.strict_min_version) >= 142,
    'gecko_android.strict_min_version must be >= 142',
  );
});

test('both manifests agree on name and version (the store artifacts are keyed off it)', () => {
  assert.equal(chrome.version, firefox.version);
  assert.equal(chrome.name, firefox.name);
});

test('the Chrome manifest carries no gecko-only keys', () => {
  assert.equal(chrome.browser_specific_settings, undefined);
});
