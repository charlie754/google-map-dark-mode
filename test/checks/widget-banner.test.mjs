/* Offline source checks for the two runtime-rendered GOAT Cam banners. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const widgetPath = path.join(ROOT, 'extension', 'content', 'widget.js');
const cssPath = path.join(ROOT, 'extension', 'content', 'brand', 'goatcam-banner.css');
const widget = fs.readFileSync(widgetPath, 'utf8');
const css = fs.readFileSync(cssPath, 'utf8');

function rendererSource(source) {
  const begin = source.indexOf('// goatcam-banner-render:begin');
  const end = source.indexOf('// goatcam-banner-render:end');
  assert.ok(begin >= 0, 'renderer begin marker is missing');
  assert.ok(end > begin, 'renderer end marker is missing or out of order');
  return source.slice(begin, end);
}

test('the banner is an empty mount, not a static data-bearing fragment', () => {
  assert.match(widget, /<div class="goat-mount" data-goat-banner><\/div>/);
  const html = widget.slice(widget.indexOf('const HTML'), widget.indexOf('/* ------------------------------------------------------------------ state */'));
  assert.doesNotMatch(html, /goat-lockup|data:image\/webp;base64|<svg/i);
});

test('the renderer is marked and builds DOM without an innerHTML data sink', () => {
  const source = rendererSource(widget);
  assert.match(source, /function renderGoatBanner\s*\(mount, model\)/);
  assert.match(source, /createElement/);
  assert.match(source, /textContent/);
  assert.doesNotMatch(source, /\.innerHTML\s*=/);
  assert.match(source, /goat--dagoat/);
  assert.match(source, /goat--online/);
  assert.match(source, /<path|createElementNS/);
});

test('the online renderer embeds the decoded static iPhone preview', () => {
  const source = rendererSource(widget);
  const match = /const IPHONE_PREVIEW_DATA_URL = 'data:image\/webp;base64,([^']+)'/.exec(source);
  assert.ok(match, 'the static iPhone WebP data URL is missing');
  const bytes = Buffer.from(match[1], 'base64');
  assert.equal(bytes.subarray(0, 4).toString('ascii'), 'RIFF');
  assert.equal(bytes.subarray(8, 12).toString('ascii'), 'WEBP');
  assert.ok(bytes.length < 20 * 1024, 'the embedded iPhone preview exceeds 20 KB');
  assert.match(source, /make\('span', 'gc-iphone', stage\)/);
  assert.match(source, /attr\(iphone, 'aria-hidden', 'true'\)/);
  assert.match(source, /attr\(iphoneImage, 'width', '60'\)/);
  assert.match(source, /attr\(iphoneImage, 'height', '128'\)/);
  assert.match(source, /Static extension preview only; this image is not part of the signed banner/);
});

test('the online photo stays natural and text uses only soft treatment', () => {
  const source = widget.slice(widget.indexOf('const GOAT_ONLINE_FIX_CSS'), widget.indexOf('// goatcam-banner-render:begin'));
  // The glow is declared for rest and for the hover states, so the master hover slab never applies.
  assert.match(source, /\.goat--online \.gc-photo, \.goat--online \.goat-lockup:is\(:hover, :focus-visible, \.is-active\) \.gc-photo \{ --gc-scrim: radial-gradient\(/);
  assert.match(source, /\.goat--online \.goat-lockup:is\(:hover, :focus-visible, \.is-active\) \.gc-photo::after \{ transform: scale\(1\.05\)/);
  assert.match(source, /\.goat--online \.gc-photo::after \{ background: var\(--gc-scrim\); \}/);
  assert.match(source, /\.goat--online \.gc-photo__img \{ filter: none; \}/);
  assert.match(source, /\.goat--online \.goat-lockup__name \{[^}]*color: var\(--gc-cream\);[^}]*text-shadow:/);
  assert.match(source, /\.goat--online \.goat-lockup__tag \{[^}]*color: var\(--gc-cream\);[^}]*font: 400 [^/]+\/[^ ]+ var\(--gc-serif\)/);
  assert.match(source, /\.goat--online \.gc-badge__text \{[^}]*color: var\(--gc-gold\); text-shadow:/);
  assert.match(source, /\.goat--online \.gc-stage \{[^}]*transform-origin: 50% 50%/);
  assert.match(source, /\.goat--online \.goat-lockup:is\(:hover, :focus-visible, \.is-active\) \.gc-stage \{ transform: scale\(1\.05\)/);
  assert.match(source, /\.goat--online \.gc-qr \{ --gc-qr: 72px;/);
  assert.doesNotMatch(source, /--gc-qr-zoom/);
  assert.doesNotMatch(source, /\.goat--online \.goat-lockup__word::before \{[^}]*background:/s);
  assert.doesNotMatch(source, /\.goat--online \.goat-lockup__name, \.goat--online \.goat-lockup__tag \{[^}]*background:/s);
  assert.match(source, /\.goat--online \.gc-badge \{[^}]*background: rgba\(20, 13, 8, \.82\); box-shadow: none;/);
  assert.doesNotMatch(source, /brightness\(|contrast\(|saturate\(|-webkit-text-fill-color|-webkit-text-stroke|background-blend-mode/);
});

test('the online and DaGoat links carry their required navigation policy', () => {
  const source = rendererSource(widget);
  assert.match(source, /https:\/\/dagoat\.io/);
  assert.match(source, /attr\(link,\s*['"]href['"],\s*['"]https:\/\/dagoat\.io/);
  assert.match(source, /attr\(link,\s*['"]target['"],\s*['_"]_blank/);
  assert.match(source, /attr\(link,\s*['"]rel['"],\s*['_"]noopener noreferrer/);
  assert.match(source, /banner\.link/);
  assert.match(source, /labels\.link/);
  assert.match(source, /labels\.qr/);
});

test('the embedded GOAT lockup stylesheet is byte-identical to the brand copy', () => {
  const match = /const GOAT_LOCKUP_CSS = ("(?:\\.|[^"\\])*")/.exec(widget);
  assert.ok(match, 'GOAT_LOCKUP_CSS string is missing');
  assert.equal(JSON.parse(match[1]), css);
  assert.match(css, /\.goat--dagoat/);
  assert.match(css, /\.goat--online/);
});

test('banner lifecycle wiring covers the contract events', () => {
  assert.match(widget, /runtime\.connect\(\{\s*name:\s*['"]goatcamBanner['"]\s*\}\)/);
  assert.match(widget, /onDisconnect/);
  assert.match(widget, /type:\s*['"]pointer['"]/);
  assert.match(widget, /type:\s*['"]focus['"]/);
  assert.match(widget, /type:\s*['"]resume['"]/);
  assert.match(widget, /type:\s*['"]click['"]/);
  assert.match(widget, /goatcamBanner\.display/);
  assert.match(widget, /expiresMs/);
  assert.match(widget, /400000/);
  assert.match(widget, /visibilitychange/);
});
