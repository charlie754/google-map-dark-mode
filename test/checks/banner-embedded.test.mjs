// Firefox ships the GOAT Cam banner offline (lib/banner-embedded.js, written by
// tools/embed-banner.mjs) instead of downloading it, because AMO requires explicit
// data-collection consent for that download. These checks keep the embedded copy
// honest and keep Firefox from fetching it.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { verify } from '../../tools/embed-banner.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const EXT = path.join(ROOT, 'extension');
const read = (rel) => fs.readFileSync(path.join(EXT, rel), 'utf8');
const json = (rel) => JSON.parse(read(rel));

const context = vm.createContext({});
vm.runInContext(read('lib/banner-embedded.js'), context);
const embedded = context.GoatBannerEmbedded;

test('embedded banner is a verbatim, correctly signed copy of the online one', async () => {
  assert.ok(embedded, 'GoatBannerEmbedded is defined');
  const signed = Buffer.from(embedded.signed, 'base64');
  const webp = Buffer.from(embedded.webp, 'base64');
  assert.equal(createHash('sha256').update(signed).digest('hex'), embedded.signedSha256);
  assert.equal(createHash('sha256').update(webp).digest('hex'), embedded.webpSha256);
  // Verify as of the day it was embedded, with the same core + public key Chrome uses.
  const result = await verify(new Uint8Array(signed), new Uint8Array(webp), Date.parse(embedded.embeddedAt + 'T12:00:00Z'));
  assert.equal(result.sha256, embedded.signedSha256);
  assert.deepEqual(JSON.parse(JSON.stringify(embedded.banner)), JSON.parse(JSON.stringify(result.banner)),
    'banner fields must be exactly what the signed file says');
  assert.equal(embedded.webpSha256, result.banner.photo.sha256.webp);
});

test('only the Firefox build carries the embedded banner, ahead of the widget', () => {
  const ff = json('manifest.firefox.json').content_scripts[0].js;
  assert.ok(ff.indexOf('lib/banner-embedded.js') >= 0 && ff.indexOf('lib/banner-embedded.js') < ff.indexOf('content/widget.js'));
  const ch = json('manifest.chrome.json').content_scripts[0].js;
  assert.ok(!ch.includes('lib/banner-embedded.js'), 'Chrome keeps the online banner');
  const build = fs.readFileSync(path.join(ROOT, 'tools', 'build.mjs'), 'utf8');
  assert.match(build, /name: "chrome", manifest: "manifest\.chrome\.json", exclude: new Set\(\["lib\/banner-embedded\.js"\]\)/);
});

test('Firefox makes no banner request: widget skips the runner, gate is closed, no consent API', () => {
  const widget = read('content/widget.js');
  assert.match(widget, /function connectBannerPort\(\) \{\n    if \(embeddedBannerModel\(\)\) return;/);
  const bg = read('background.js');
  assert.match(bg, /const goatBannerGate = async \(\) => typeof api\?\.runtime\?\.getBrowserInfo !== "function";/);
  for (const rel of ['background.js', 'content/widget.js', 'popup/popup.js', 'options/options.js']) {
    assert.doesNotMatch(read(rel), /data_collection|permissions\.request/, rel);
  }
  assert.equal(fs.existsSync(path.join(EXT, 'lib', 'data-consent.js')), false);
  assert.equal(fs.existsSync(path.join(EXT, 'consent')), false);
});

test('the widget accepts the embedded banner (same validator as the online path)', () => {
  const src = read('content/widget.js');
  const pick = (name) => {
    const start = src.indexOf(`  function ${name}(`);
    let depth = 0;
    for (let i = src.indexOf('{', start); i < src.length; i++) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}' && --depth === 0) return src.slice(start, i + 1);
    }
    throw new Error(name);
  };
  const sandbox = vm.createContext({ GoatBannerEmbedded: embedded });
  vm.runInContext(['inUnit', 'validBannerObject', 'base64'].map(pick).join('\n') +
    '\nglobalThis.ok = validBannerObject(GoatBannerEmbedded.banner) && base64(GoatBannerEmbedded.webp);', sandbox);
  assert.equal(sandbox.ok, true);
});
