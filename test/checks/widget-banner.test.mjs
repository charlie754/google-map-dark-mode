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
