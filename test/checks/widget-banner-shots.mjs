/** Browser checks for both runtime-rendered banner variants.
 *
 * Run: npm run build && node test/checks/widget-banner-shots.mjs "" chromium
 *      npm run build && node test/checks/widget-banner-shots.mjs "" firefox
 */
import { chromium, firefox } from '@playwright/test';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ENGINE = process.argv.includes('firefox') ? 'firefox' : 'chromium';
if (ENGINE !== 'chromium' && ENGINE !== 'firefox') {
  console.error('engine must be chromium or firefox');
  process.exit(2);
}
const PREFIX = ENGINE === 'firefox' ? 'firefox-' : '';
const WIDGET = path.join(ROOT, 'dist', ENGINE === 'firefox' ? 'firefox' : 'chrome', 'content', 'widget.js');
const ORIGINAL_WIDGET = execFileSync('git', ['show', '2e7d372:extension/content/widget.js'], { cwd: ROOT, encoding: 'utf8' });
const DEFAULT_OUT = path.join(ROOT, 'test', 'artifacts', 'banner');
const outputArgument = process.argv[2] && !['chromium', 'firefox'].includes(process.argv[2]) ? process.argv[2] : '';
const OUT = path.resolve(outputArgument.trim() ? outputArgument : DEFAULT_OUT);
const DAGOAT_URL = 'https://dagoat.io';
const ONLINE_URL = 'https://goatcam.dagoat.io';
const DAGOAT_LINES = [
  'Goat Project - Help fight Cancer, Alzheimer\u2019s, Parkinson\u2019s, COVID-19, Dengue, Hepatitis C etc.',
  'Contribute your idle compute to Earn GOAT.',
];
const V2_BADGE_FIRST_FAMILY = 'ui-monospace';
const ONLINE_TEXT_SELECTORS = [
  ['wordmark', '.goat--online .goat-lockup__name', '.goat--online .goat-lockup__word'],
  ['tagline', '.goat--online .goat-lockup__tag', '.goat--online .goat-lockup__word'],
  ['tagline em', '.goat--online .goat-lockup__tag em', '.goat--online .goat-lockup__tag'],
  ['badge text', '.goat--online .gc-badge__text', '.goat--online .gc-badge'],
];
// Whole photo inset of the 16ef14e DPR-2 rest render; this fixed reference is
// informational only for the natural-photo check below.
const PHOTO_LUMINANCE_BEFORE_16EF14E = 0.06199577356776212;
const PHOTO_NATURAL_MAX_ATTENUATION = 1.03;
const PHOTO_NATURAL_MIN_MEAN_ATTENUATION = 0.9;
const PHOTO_TEXT_GLOW_PADDING = 12;
// The threshold is derived per engine/DPR from the injected hard-edge control:
// the real overlay must stay below 35% of the control's seam response.
const NO_HARD_EDGE_CONTROL_THRESHOLD_FRACTION = 0.35;
const NO_HARD_EDGE_EPSILON = 0.001;
const NO_HARD_EDGE_MIN_ROWS_FRACTION = 0.5;
const ONLINE_TEXT_HIDE_CSS = '.goat--online .goat-lockup__name, .goat--online .goat-lockup__tag, .goat--online .goat-lockup__tag em, .goat--online .gc-badge__text { color: transparent !important; -webkit-text-fill-color: transparent !important; -webkit-text-stroke: 0 !important; transition: none !important; }';
const ONLINE_BARE_PHOTO_CSS = ONLINE_TEXT_HIDE_CSS +
  ' .goat--online .gc-photo::after { background: none !important; }' +
  ' .goat--online .gc-photo { filter: none !important; }' +
  ' .goat--online .goat-lockup__word::before { content: none !important; display: none !important; }' +
  ' .goat--online .goat-lockup__name, .goat--online .goat-lockup__tag, .goat--online .gc-badge__text { text-shadow: none !important; filter: none !important; }' +
  ' .goat--online .gc-badge { background: transparent !important; box-shadow: none !important; }';
const ONLINE_HARD_EDGE_CONTROL_CSS = ONLINE_TEXT_HIDE_CSS +
  ' .goat--online .goat-lockup::after { content: ""; position: absolute; z-index: 10; inset: 0;' +
  ' background: linear-gradient(to right, #000 0 50%, #fff 50% 100%); pointer-events: none; }';
const NO_HARD_EDGE_CONTROL_MIN_AVERAGE = 0.2;
const LIVE_TEXT_MIN_FONT_SIZES = [10.5, 15, 6, 6.5];
let onlineProbeSequence = 0;

if (!fs.existsSync(WIDGET)) {
  console.error(WIDGET + ' is missing -- run npm run build first');
  process.exit(2);
}
fs.mkdirSync(OUT, { recursive: true });

function readVector(name) {
  const file = path.join(ROOT, 'test', 'banner', 'vectors', 'cases', name + '.signed');
  const text = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  const lf = text.indexOf('\n');
  return { signed: text.slice(0, lf).trim(), banner: JSON.parse(text.slice(lf + 1)) };
}

const valid = readVector('valid');
const online = valid;
Object.assign(valid.banner, {
  headline: 'GOAT Cam \u2014 your iPhone, NOW your PC\u2019s webcam.',
  headlineEm: 'NOW',
  tagline: ['Your iPhone, NOW', 'your PC\u2019s webcam.'],
  badge: '1440p \u00b7 60 fps',
});
const maxText = readVector('max-text');
const webp = fs.readFileSync(path.join(ROOT, 'test', 'banner', 'vectors', 'photos', 'hero-coffee-800.webp')).toString('base64');

function displayFor(vector, expiresMs, immediate, seq) {
  const sha256 = crypto.createHash('sha256').update(vector.signed).digest('hex');
  return {
    display: { kind: 'online', sha256, immediate: Boolean(immediate), seq, banner: vector.banner, expiresMs },
    key: 'goatcamBanner.set.' + sha256,
    stored: { signed: vector.signed, webp },
  };
}

function installRuntimeStub() {
  const values = Object.create(null);
  const listeners = [];
  const ports = [];
  let connections = 0;
  const messages = [];
  const reply = (msg) => {
    if (msg && msg.type === 'getSettings') return { enabled: true, darkMap: true, darkChrome: true };
    if (msg && msg.type === 'getHealth') return { verdict: 'ok' };
    return null;
  };
  const emit = (key, value, oldValue) => {
    const change = { oldValue, newValue: value };
    for (const fn of listeners.slice()) fn({ [key]: change }, 'local');
  };
  const write = (items) => {
    for (const [key, value] of Object.entries(items || {})) {
      const oldValue = values[key];
      values[key] = value;
      emit(key, value, oldValue);
    }
  };
  const local = {
    get(key, callback) {
      const result = key ? { [key]: values[key] } : { ...values };
      if (callback) setTimeout(() => callback(result), 0);
      return Promise.resolve(result);
    },
    set(items, callback) {
      write(items);
      if (callback) setTimeout(callback, 0);
      return Promise.resolve();
    },
  };
  const runtime = {
    lastError: null,
    sendMessage(msg, callback) {
      const result = reply(msg);
      if (callback) setTimeout(() => callback(result), 0);
      return Promise.resolve(result);
    },
    connect(info) {
      connections += 1;
      let disconnected = false;
      const disconnectListeners = [];
      const port = {
        name: info && info.name,
        onDisconnect: { addListener(fn) { disconnectListeners.push(fn); } },
        postMessage(message) { messages.push(message); },
        disconnect() {
          if (disconnected) return;
          disconnected = true;
          for (const fn of disconnectListeners.slice()) fn(port);
        },
      };
      ports.push(port);
      return port;
    },
  };
  Object.defineProperty(window, 'chrome', { configurable: true, value: {
    runtime,
    storage: { local, onChanged: { addListener(fn) { listeners.push(fn); } } },
  } });
  window.__bannerHarness = {
    write,
    disconnectLast() { const port = ports[ports.length - 1]; if (port) port.disconnect(); },
    connectCount() { return connections; },
    messages() { return messages.slice(); },
  };
}

const FIXTURE = '<!doctype html><html><head><meta charset="utf-8"><style>' +
  'html,body{margin:0;height:100%}body{background:linear-gradient(115deg,transparent 0 46%,#38414e 46% 47.4%,transparent 47.4%),#242f3e}' +
  '</style></head><body></body></html>';

const results = [];
function check(name, pass, detail) {
  results.push({ name, status: pass ? 'pass' : 'fail', detail });
  console.log((pass ? 'PASS' : 'FAIL') + '  ' + name + '\n      ' + detail);
}
function skipped(name, reason) {
  results.push({ name, status: 'skip', detail: reason });
  console.log('SKIPPED  ' + name + '\n      ' + reason);
}

function vectorCopy(vector) {
  return JSON.parse(JSON.stringify(vector.banner));
}

async function publish(page, vector, expiresMs, immediate, seq) {
  const bundle = displayFor(vector, expiresMs, immediate, seq);
  const harnessReady = await page.evaluate(() => Boolean(window.__bannerHarness));
  if (!harnessReady) throw new Error('banner harness disappeared before storage write; url=' + page.url());
  await page.evaluate((value) => window.__bannerHarness.write(value), {
    [bundle.key]: bundle.stored,
    'goatcamBanner.display': bundle.display,
  });
  await page.waitForTimeout(80);
  return bundle;
}

async function publishDagoat(page, immediate, seq) {
  await page.evaluate(({ immediate: now, seq: number }) => window.__bannerHarness.write({
    'goatcamBanner.display': { kind: 'dagoat', sha256: null, immediate: now, seq: number, banner: null, expiresMs: null },
  }), { immediate, seq });
  await page.waitForTimeout(80);
}

async function measure(page) {
  return page.evaluate(() => {
    const sh = document.getElementById('gmdm-widget-host').shadowRoot;
    const $ = (selector) => sh.querySelector(selector);
    const box = (element) => {
      if (!element) return null;
      const r = element.getBoundingClientRect();
      return { x: +r.x.toFixed(2), y: +r.y.toFixed(2), w: +r.width.toFixed(2), h: +r.height.toFixed(2) };
    };
    const shell = $('.shell');
    const body = $('.body');
    const bodyInner = $('.body__inner');
    const goat = $('.goat');
    const plate = $('.goat-lockup');
    const gh = $('.gh');
    const image = $('.gc-photo__img');
    const iphone = $('.gc-iphone');
    const iphoneImage = iphone && iphone.querySelector('.gc-iphone__screen');
    const qr = $('.gc-qr');
    const qrSvg = qr && qr.querySelector('svg');
    const stage = $('.gc-stage');
    const vf = $('.gc-vf');
    const qrBounds = qr && qr.getBoundingClientRect();
    const qrViewportRoom = qrBounds ? Math.min(qrBounds.left, innerWidth - qrBounds.right,
      qrBounds.top, innerHeight - qrBounds.bottom) : null;
    const headline = goat && goat.querySelector('.goat__copy .goat__line');
    const wordmark = goat && goat.querySelector('.goat-lockup__name');
    const tagline = goat && goat.querySelector('.goat-lockup__tag');
    const badge = goat && goat.querySelector('.gc-badge');
    const badgeText = badge && badge.querySelector('.gc-badge__text');
    const badgeTextStyle = badgeText && getComputedStyle(badgeText);
    const taglineLines = tagline ? [...tagline.children] : [];
    const stageStyle = stage && getComputedStyle(stage);
    const stageTransform = stageStyle && stageStyle.transform;
    const stageScale = stageTransform && stageTransform !== 'none' ? Number.parseFloat(stageTransform.slice(7)) : 1;
    const vfBounds = vf && vf.getBoundingClientRect();
    const vfInner = vfBounds ? box(vf) && {
      x: +(vfBounds.x + 2).toFixed(2), y: +(vfBounds.y + 2).toFixed(2),
      w: +(Math.max(0, vfBounds.width - 4)).toFixed(2), h: +(Math.max(0, vfBounds.height - 4)).toFixed(2),
    } : null;
    const stageItems = [
      ['.gc-badge', badge], ['.goat-lockup__name', wordmark],
      ...taglineLines.map((line) => ['.' + String(line.className), line]),
      ['.gc-iphone', iphone], ['.gc-qr', qr],
    ].filter(([, element]) => element).map(([selector, element]) => ({ selector, rect: box(element) }));
    const pill = $('.pill');
    const texts = goat ? [...goat.querySelectorAll('.goat__line, .goat-lockup__name, .goat-lockup__tag, .gc-badge')].map((el) => ({
      text: el.textContent, cls: String(el.className), scrollWidth: el.scrollWidth, clientWidth: el.clientWidth,
      scrollHeight: el.scrollHeight, clientHeight: el.clientHeight, fontSize: Number.parseFloat(getComputedStyle(el).fontSize), box: box(el),
    })) : [];
    const textOutside = texts.filter((item) => {
      const inBox = item.cls.startsWith('goat__line') ? goat : plate;
      const b = item.box;
      const r = inBox && inBox.getBoundingClientRect();
      return !r || b.x < r.left - 0.5 || b.x + b.w > r.right + 0.5 ||
        b.y < r.top - 0.5 || b.y + b.h > r.bottom + 0.5;
    });
    const textsOverQr = qrBounds ? texts.filter((item) => {
      if (item.cls.startsWith('goat__line')) return false;
      const b = item.box;
      return b.x < qrBounds.right && b.x + b.w > qrBounds.left &&
        b.y < qrBounds.bottom && b.y + b.h > qrBounds.top;
    }) : [];
    const clips = [];
    if (qrBounds) {
      for (let el = qr.parentElement || qr.getRootNode().host; el; el = el.parentElement || (el.getRootNode().host || null)) {
        const style = getComputedStyle(el);
        if (style.overflowX === 'visible' && style.overflowY === 'visible') continue;
        const r = el.getBoundingClientRect();
        clips.push({
          el: el.className ? String(el.className) : el.tagName,
          overflow: style.overflowX + '/' + style.overflowY,
          room: Math.min(qrBounds.left - r.left, r.right - qrBounds.right,
            qrBounds.top - r.top, r.bottom - qrBounds.bottom),
        });
      }
    }
    const qrInset = qrBounds ? Math.min(8, qrBounds.width / 4) : 0;
    const qrPoints = qrBounds ? [
      [qrBounds.left + qrBounds.width / 2, qrBounds.top + qrBounds.height / 2],
      [qrBounds.left + qrInset, qrBounds.top + qrInset],
      [qrBounds.right - qrInset, qrBounds.top + qrInset],
      [qrBounds.left + qrInset, qrBounds.bottom - qrInset],
      [qrBounds.right - qrInset, qrBounds.bottom - qrInset],
    ] : [];
    const qrOnTop = qrPoints.filter(([x, y]) => {
      const element = sh.elementFromPoint(x, y);
      return Boolean(element && element.closest && element.closest('.gc-qr'));
    }).length;
    const animations = sh.getAnimations().filter((animation) => animation.effect && animation.effect.target && goat && goat.contains(animation.effect.target));
    return {
      open: shell.classList.contains('is-open'), variant: goat && goat.classList.contains('goat--online') ? 'online' : 'dagoat',
      viewport: { w: innerWidth, h: innerHeight },
      pillExpanded: pill && pill.getAttribute('aria-expanded'),
      shell: box(shell), body: box(body), bodyInner: box(bodyInner), shellScroll: shell && [shell.scrollHeight, shell.clientHeight],
      bodyScroll: body && [body.scrollHeight, body.clientHeight, body.scrollTop],
      bodyInnerScroll: bodyInner && [bodyInner.scrollHeight, bodyInner.clientHeight, bodyInner.scrollTop],
      shellOverflowY: shell && getComputedStyle(shell).overflowY,
      bodyOverflowY: bodyInner && getComputedStyle(bodyInner).overflowY,
      goat: box(goat), copyBox: box(goat && goat.querySelector('.goat__copy')), plate: box(plate), bannerLink: box(plate), gh: box(gh),
      gap: goat && gh ? +(goat.getBoundingClientRect().top - gh.getBoundingClientRect().bottom).toFixed(2) : null,
      copy: goat ? [...goat.querySelectorAll('.goat__line')].map((el) => el.textContent) : [],
      headline: headline && { box: box(headline), inPlate: Boolean(plate && plate.contains(headline)), hasEm: Boolean(headline.querySelector('em')) },
      wordmarkBox: box(wordmark), taglineBox: box(tagline), badgeBox: box(badge),
      taglineLines: taglineLines.map((line) => ({ text: line.textContent, box: box(line) })),
      taglineFontFamily: tagline && getComputedStyle(tagline).fontFamily,
      taglineEm: tagline && [...tagline.querySelectorAll('em')].map((em) => ({
        text: em.textContent, fontStyle: getComputedStyle(em).fontStyle, color: getComputedStyle(em).color,
      })),
      wordmarkFontSize: wordmark && Number.parseFloat(getComputedStyle(wordmark).fontSize),
      stage: box(stage), stageTransform, stageScale, content: stageItems, vfInner,
      badgeText: badgeText && {
        scrollHeight: badgeText.scrollHeight,
        clientHeight: badgeText.clientHeight,
        fontFamily: badgeTextStyle.fontFamily,
        fontSize: Number.parseFloat(badgeTextStyle.fontSize),
        lineBoxHeight: Number.parseFloat(badgeTextStyle.lineHeight),
      },
      name: goat && $('.goat-lockup__name') ? $('.goat-lockup__name').textContent : '',
      tag: goat && $('.goat-lockup__tag') ? $('.goat-lockup__tag').textContent : '',
      href: plate && plate.getAttribute('href'), target: plate && plate.getAttribute('target'), rel: plate && plate.getAttribute('rel'),
      aria: plate && plate.getAttribute('aria-label'), links: goat ? goat.querySelectorAll('a').length : 0,
      photo: box($('.gc-photo')), image: image && { complete: image.complete, naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight, scheme: image.src.slice(0, 22) },
      iphone: box(iphone), iphoneImage: iphoneImage && {
        complete: iphoneImage.complete, naturalWidth: iphoneImage.naturalWidth, naturalHeight: iphoneImage.naturalHeight,
        scheme: iphoneImage.src.slice(0, 22), borderRadius: getComputedStyle(iphone).borderRadius,
      },
      objectPosition: image && getComputedStyle(image).objectPosition,
      qr: box(qr), qrViewBox: qrSvg && qrSvg.getAttribute('viewBox'), qrPathCount: qrSvg ? qrSvg.querySelectorAll(':scope > path').length : 0,
      qrClips: clips, qrMinRoom: clips.length ? Math.min(...clips.map((item) => item.room)) : null, qrViewportRoom, qrOnTop,
      textsOverQr: textsOverQr.map((item) => item.cls), textsOutside: textOutside.map((item) => item.cls),
      plateBg: plate && getComputedStyle(plate).backgroundColor, plateTransform: plate && getComputedStyle(plate).transform,
      frameTransform: $('.gc-photo__frame') && getComputedStyle($('.gc-photo__frame')).transform,
      steamOpacity: $('.gc-steam') && getComputedStyle($('.gc-steam')).opacity,
      steamDisplay: $('.gc-steam') && getComputedStyle($('.gc-steam')).display,
      plateScroll: plate && [plate.scrollWidth, plate.clientWidth, plate.scrollHeight, plate.clientHeight],
      plateOverflow: plate && getComputedStyle(plate).overflow,
      texts, animations: { total: animations.length, running: animations.filter((a) => a.playState === 'running').length },
      focused: sh.activeElement === plate, focusVisible: Boolean(plate && plate.matches(':focus-visible')),
      isActive: Boolean(plate && plate.classList.contains('is-active')),
      hasMark: Boolean(goat && goat.querySelector('.goat-lockup__mark')), hasAsk: Boolean(goat && goat.querySelector('.goat__line--ask')),
      reduced: matchMedia('(prefers-reduced-motion: reduce)').matches,
    };
  });
}

async function installFocusoutTrace(page) {
  await page.evaluate(() => {
    const describe = (node) => {
      if (!node) return null;
      return {
        tag: node.nodeName,
        id: node.id || null,
        className: typeof node.className === 'string' ? node.className : null,
        rootHost: node.getRootNode() && node.getRootNode().host ? node.getRootNode().host.id : null,
      };
    };
    window.__focusoutTrace = [];
    document.addEventListener('focusout', (event) => {
      window.__focusoutTrace.push({
        target: describe(event.target),
        relatedTarget: describe(event.relatedTarget),
      });
    }, true);
  });
}

async function focusoutTrace(page) {
  return page.evaluate(() => window.__focusoutTrace.slice());
}

function decodeQr(file, expected) {
  const code = 'import sys,cv2; img=cv2.imread(sys.argv[1]); data,_,_=cv2.QRCodeDetector().detectAndDecode(img); print(data)';
  const result = spawnSync('python', ['-I', '-c', code, file], { encoding: 'utf8' });
  if (result.error) return { skipped: true, reason: 'python unavailable: ' + result.error.message };
  if (result.status !== 0 && /No module named ['"]cv2['"]|ModuleNotFoundError/.test(result.stderr || '')) {
    return { skipped: true, reason: 'cv2 is not importable in python -I' };
  }
  if (result.status !== 0) return { pass: false, detail: (result.stderr || result.stdout || ('python exit ' + result.status)).trim() };
  const decoded = (result.stdout || '').trim();
  return { pass: decoded === expected, detail: 'decoded=' + JSON.stringify(decoded) };
}

function comparePngFiles(actualFile, originalFile) {
  const actual = PNG.sync.read(fs.readFileSync(actualFile));
  const original = PNG.sync.read(fs.readFileSync(originalFile));
  const sameSize = actual.width === original.width && actual.height === original.height;
  if (!sameSize) return { pass: false, sameSize, actual: [actual.width, actual.height], original: [original.width, original.height] };
  const tolerance = 8;
  let differingPixels = 0;
  let maxChannelDelta = 0;
  let minX = actual.width;
  let minY = actual.height;
  let maxX = -1;
  let maxY = -1;
  for (let i = 0; i < actual.data.length; i += 4) {
    const delta = Math.max(Math.abs(actual.data[i] - original.data[i]), Math.abs(actual.data[i + 1] - original.data[i + 1]),
      Math.abs(actual.data[i + 2] - original.data[i + 2]), Math.abs(actual.data[i + 3] - original.data[i + 3]));
    if (delta > maxChannelDelta) maxChannelDelta = delta;
    if (delta > tolerance) {
      differingPixels += 1;
      const pixel = i / 4;
      const x = pixel % actual.width;
      const y = Math.floor(pixel / actual.width);
      minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
    }
  }
  const totalPixels = actual.width * actual.height;
  const differingFraction = differingPixels / totalPixels;
  return {
    pass: maxChannelDelta <= 8 && differingFraction <= 0.005,
    sameSize, width: actual.width, height: actual.height, tolerance: 'per-channel <= 8 for anti-aliasing; differing pixels <= 0.5%',
    differingPixels, differingFraction, maxChannelDelta, diffBounds: differingPixels ? [minX, minY, maxX, maxY] : null,
  };
}

function parseRgbColor(color) {
  const match = color.match(/^rgba?\(\s*([\d.]+)[, ]+\s*([\d.]+)[, ]+\s*([\d.]+)(?:[, ]+\s*([\d.]+))?\s*\)$/i);
  if (!match) throw new Error('unparseable computed text colour: ' + color);
  return { r: Number(match[1]), g: Number(match[2]), b: Number(match[3]), a: match[4] === undefined ? 1 : Number(match[4]) };
}

function linearChannel(value) {
  const channel = value / 255;
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(rgb) {
  return 0.2126 * linearChannel(rgb.r) + 0.7152 * linearChannel(rgb.g) + 0.0722 * linearChannel(rgb.b);
}

function imageRect(box, plate, scaleX, scaleY) {
  return {
    left: (box.x - plate.x) * scaleX, top: (box.y - plate.y) * scaleY,
    right: (box.x + box.w - plate.x) * scaleX, bottom: (box.y + box.h - plate.y) * scaleY,
  };
}

function containsImagePoint(rect, x, y) {
  return x >= rect.left && x < rect.right && y >= rect.top && y < rect.bottom;
}

function measurePlateLuminance(buffer, plate, exclusions) {
  const image = PNG.sync.read(buffer);
  const scaleX = image.width / plate.w;
  const scaleY = image.height / plate.h;
  const plateRect = imageRect(plate, plate, scaleX, scaleY);
  const exclusionRects = exclusions.filter(Boolean).map((box) => imageRect(box, plate, scaleX, scaleY));
  let total = 0;
  let count = 0;
  for (let y = Math.max(0, Math.floor(plateRect.top)); y < Math.min(image.height, Math.ceil(plateRect.bottom)); y++) {
    for (let x = Math.max(0, Math.floor(plateRect.left)); x < Math.min(image.width, Math.ceil(plateRect.right)); x++) {
      if (exclusionRects.some((rect) => containsImagePoint(rect, x + 0.5, y + 0.5))) continue;
      const offset = (y * image.width + x) * 4;
      total += relativeLuminance({ r: image.data[offset], g: image.data[offset + 1], b: image.data[offset + 2] });
      count += 1;
    }
  }
  return { mean: total / count, pixels: count, scale: [scaleX, scaleY], plate: plateRect, exclusions: exclusionRects };
}

function measureOverlayAttenuation(actualBuffer, bareBuffer, plate, photo, qr, iphone) {
  const actual = PNG.sync.read(actualBuffer);
  const bare = PNG.sync.read(bareBuffer);
  if (actual.width !== bare.width || actual.height !== bare.height) {
    throw new Error('overlay probe screenshots changed size');
  }
  const image = actual;
  const scaleX = image.width / plate.w;
  const scaleY = image.height / plate.h;
  const photoRect = imageRect(photo, plate, scaleX, scaleY);
  const exclusionRects = [qr, iphone].filter(Boolean)
    .map((box) => imageRect(box, plate, scaleX, scaleY));
  const excluded = (x, y) => exclusionRects.some((rect) => containsImagePoint(rect, x + 0.5, y + 0.5));
  const sums = Array(Math.max(0, image.width - 1)).fill(0);
  const counts = Array(Math.max(0, image.width - 1)).fill(0);
  const top = Math.max(0, Math.floor(photoRect.top));
  const bottom = Math.min(image.height, Math.ceil(photoRect.bottom));
  const left = Math.max(0, Math.floor(photoRect.left));
  const right = Math.min(image.width - 1, Math.ceil(photoRect.right) - 1);
  const luminance = (source, x, y) => {
    const offset = (y * source.width + x) * 4;
    return relativeLuminance({ r: source.data[offset], g: source.data[offset + 1], b: source.data[offset + 2] });
  };
  for (let y = top; y < bottom; y++) {
    for (let x = left; x < right; x++) {
      if (excluded(x, y) || excluded(x + 1, y)) continue;
      const leftAttenuation = luminance(actual, x, y) / Math.max(luminance(bare, x, y), NO_HARD_EDGE_EPSILON);
      const rightAttenuation = luminance(actual, x + 1, y) / Math.max(luminance(bare, x + 1, y), NO_HARD_EDGE_EPSILON);
      sums[x] += Math.abs(leftAttenuation - rightAttenuation);
      counts[x] += 1;
    }
  }
  const boundaries = sums.map((sum, x) => ({
    boundaryCss: +(((x + 0.5) / scaleX).toFixed(2)),
    average: counts[x] ? sum / counts[x] : 0,
    rows: counts[x],
  })).filter((item) => item.rows >= (bottom - top) * NO_HARD_EDGE_MIN_ROWS_FRACTION);
  const max = boundaries.reduce((worst, item) => item.average > worst.average ? item : worst,
    { boundaryCss: null, average: 0, rows: 0 });
  return { max, photo: photoRect, exclusions: exclusionRects,
    minRows: (bottom - top) * NO_HARD_EDGE_MIN_ROWS_FRACTION,
    boundaries: boundaries.sort((a, b) => b.average - a.average).slice(0, 5) };
}

function inflateBox(box, padding) {
  return { x: box.x - padding, y: box.y - padding, w: box.w + padding * 2, h: box.h + padding * 2 };
}

function measurePhotoNaturalAttenuation(hiddenBuffer, bareBuffer, plate, photo, qr, iphone, textBoxes) {
  const hidden = PNG.sync.read(hiddenBuffer);
  const bare = PNG.sync.read(bareBuffer);
  if (hidden.width !== bare.width || hidden.height !== bare.height) {
    throw new Error('photo-natural probe screenshots changed size');
  }
  const scaleX = hidden.width / plate.w;
  const scaleY = hidden.height / plate.h;
  const photoRect = imageRect(photo, plate, scaleX, scaleY);
  const exclusionRects = [qr, iphone, ...textBoxes.filter(Boolean).map((box) => inflateBox(box, PHOTO_TEXT_GLOW_PADDING))]
    .map((box) => imageRect(box, plate, scaleX, scaleY));
  const excluded = (x, y) => exclusionRects.some((rect) => containsImagePoint(rect, x + 0.5, y + 0.5));
  const top = Math.max(0, Math.floor(photoRect.top));
  const bottom = Math.min(hidden.height, Math.ceil(photoRect.bottom));
  const left = Math.max(0, Math.floor(photoRect.left));
  const right = Math.min(hidden.width, Math.ceil(photoRect.right));
  const luminance = (source, x, y) => {
    const offset = (y * source.width + x) * 4;
    return relativeLuminance({ r: source.data[offset], g: source.data[offset + 1], b: source.data[offset + 2] });
  };
  let max = { value: 0, x: null, y: null };
  let minimum = Infinity;
  let total = 0;
  let count = 0;
  let pixels = 0;
  for (let y = top; y < bottom; y++) {
    for (let x = left; x < right; x++) {
      const hiddenLuminance = luminance(hidden, x, y);
      const bareLuminance = luminance(bare, x, y);
      const attenuation = hiddenLuminance / Math.max(bareLuminance, NO_HARD_EDGE_EPSILON);
      pixels += 1;
      if (!excluded(x, y) && attenuation > max.value) max = { value: attenuation, x, y };
      minimum = Math.min(minimum, attenuation);
      if (!excluded(x, y)) {
        total += attenuation;
        count += 1;
      }
    }
  }
  return {
    max: { value: max.value, css: { x: +(max.x / scaleX).toFixed(2), y: +(max.y / scaleY).toFixed(2) } },
    minimum, mean: total / count, pixels, includedPixels: count,
    photo: photoRect, exclusions: exclusionRects,
  };
}

async function withOnlineProbeStyle(page, attribute, cssText, action) {
  const token = attribute + '-' + (++onlineProbeSequence);
  try {
    await page.evaluate(({ attribute: name, token: value, cssText: text }) => {
      const shadow = document.getElementById('gmdm-widget-host').shadowRoot;
      const style = shadow.ownerDocument.createElement('style');
      style.setAttribute(name, value);
      style.textContent = text;
      shadow.appendChild(style);
    }, { attribute, token, cssText });
    return await action();
  } finally {
    await page.evaluate(({ attribute: name, token: value }) => {
      const shadow = document.getElementById('gmdm-widget-host').shadowRoot;
      [...shadow.querySelectorAll('style')].find((style) => style.getAttribute(name) === value)?.remove();
    }, { attribute, token });
    await page.waitForTimeout(700);
  }
}

async function screenshotOnlineProbe(page, cssText) {
  return withOnlineProbeStyle(page, 'data-online-overlay-probe', cssText, async () => {
    await page.waitForTimeout(30);
    return page.locator('.goat--online .goat-lockup').screenshot();
  });
}

function rgbDistance(a, b) {
  return Math.max(Math.abs(a.r - b.r), Math.abs(a.g - b.g), Math.abs(a.b - b.b));
}

async function measureIphoneCorners(page, measured) {
  const image = PNG.sync.read(await page.locator('.goat--online .goat-lockup').screenshot());
  const scaleX = image.width / measured.plate.w;
  const scaleY = image.height / measured.plate.h;
  const left = Math.round((measured.iphone.x - measured.plate.x) * scaleX);
  const top = Math.round((measured.iphone.y - measured.plate.y) * scaleY);
  const right = Math.round((measured.iphone.x + measured.iphone.w - measured.plate.x) * scaleX) - 1;
  const bottom = Math.round((measured.iphone.y + measured.iphone.h - measured.plate.y) * scaleY) - 1;
  const points = [[left, top], [right, top], [left, bottom], [right, bottom]];
  const outside = [[left - 2, top], [right + 2, top], [left - 2, bottom], [right + 2, bottom]];
  const pixel = ([x, y]) => {
    const safeX = Math.max(0, Math.min(image.width - 1, x));
    const safeY = Math.max(0, Math.min(image.height - 1, y));
    const offset = (safeY * image.width + safeX) * 4;
    return { r: image.data[offset], g: image.data[offset + 1], b: image.data[offset + 2] };
  };
  const corners = points.map((point, index) => ({ point, color: pixel(point), outside: pixel(outside[index]) }));
  const isBezel = (color) => rgbDistance(color, { r: 10, g: 8, b: 7 }) <= 24;
  return { corners, pass: corners.every((item) => !isBezel(item.color) || isBezel(item.outside) || rgbDistance(item.color, item.outside) <= 42) };
}

function wcagContrast(text, background) {
  const alpha = text.a === undefined ? 1 : text.a;
  const composited = alpha === 1 ? text : {
    r: alpha * text.r + (1 - alpha) * background.r,
    g: alpha * text.g + (1 - alpha) * background.g,
    b: alpha * text.b + (1 - alpha) * background.b,
  };
  const textLuminance = relativeLuminance(composited);
  const backgroundLuminance = relativeLuminance(background);
  return (Math.max(textLuminance, backgroundLuminance) + 0.05) /
    (Math.min(textLuminance, backgroundLuminance) + 0.05);
}

async function measureRenderedOnlineText(page) {
  const measured = await page.evaluate((selectors) => {
    const shadow = document.getElementById('gmdm-widget-host').shadowRoot;
    const plate = shadow.querySelector('.goat--online .goat-lockup');
    const box = (element) => {
      const rect = element.getBoundingClientRect();
      return { x: rect.x, y: rect.y, w: rect.width, h: rect.height };
    };
    return {
      plate: box(plate),
      text: selectors.map(([name, selector, blockSelector]) => {
        const element = shadow.querySelector(selector);
        const block = shadow.querySelector(blockSelector);
        return element && block ? {
          name, selector, blockSelector, box: box(element), color: getComputedStyle(element).color,
        } : null;
      }).filter(Boolean),
    };
  }, ONLINE_TEXT_SELECTORS);
  const plateImage = PNG.sync.read(await page.locator('.goat--online .goat-lockup').screenshot());
  const scaleX = plateImage.width / measured.plate.w;
  const scaleY = plateImage.height / measured.plate.h;
  const hiddenImage = await withOnlineProbeStyle(page, 'data-rendered-online-text', ONLINE_TEXT_HIDE_CSS, async () => {
    await page.waitForTimeout(20);
    return PNG.sync.read(await page.locator('.goat--online .goat-lockup').screenshot());
  });
  if (plateImage.width !== hiddenImage.width || plateImage.height !== hiddenImage.height) {
    throw new Error('online text screenshots changed size while hiding text');
  }

  const text = measured.text.map((item) => {
    const textColor = parseRgbColor(item.color);
    const declaredLuminance = relativeLuminance(textColor);
    const left = Math.max(0, Math.floor((item.box.x - measured.plate.x) * scaleX));
    const top = Math.max(0, Math.floor((item.box.y - measured.plate.y) * scaleY));
    const right = Math.min(plateImage.width, Math.ceil((item.box.x + item.box.w - measured.plate.x) * scaleX));
    const bottom = Math.min(plateImage.height, Math.ceil((item.box.y + item.box.h - measured.plate.y) * scaleY));
    const changed = [];
    for (let y = top; y < bottom; y++) {
      for (let x = left; x < right; x++) {
        const offset = (y * plateImage.width + x) * 4;
        const visible = { r: plateImage.data[offset], g: plateImage.data[offset + 1], b: plateImage.data[offset + 2] };
        const background = { r: hiddenImage.data[offset], g: hiddenImage.data[offset + 1], b: hiddenImage.data[offset + 2] };
        const delta = Math.max(Math.abs(visible.r - background.r), Math.abs(visible.g - background.g),
          Math.abs(visible.b - background.b));
        if (delta > 2) {
          changed.push({ x, y, luminance: relativeLuminance(visible), contrast: wcagContrast(visible, background),
            declaredContrast: wcagContrast(textColor, background) });
        }
      }
    }
    changed.sort((a, b) => b.luminance - a.luminance);
    const topCount = Math.max(1, Math.ceil(changed.length * 0.1));
    const brightest = changed[0]?.luminance || 0;
    const top10 = changed.slice(0, topCount);
    const minimumTopContrast = top10.length ? Math.min(...top10.map((pixel) => pixel.contrast)) : 0;
    const minimumDeclaredTopContrast = top10.length ? Math.min(...top10.map((pixel) => pixel.declaredContrast)) : 0;
    const brightestRatio = declaredLuminance ? brightest / declaredLuminance : 0;
    const sampleCount = Math.min(8, changed.length);
    const glyphPixels = changed.slice(0, Math.max(sampleCount, Math.ceil(changed.length * 0.1)));
    const points = [];
    for (let i = 0; i < sampleCount; i++) {
      const pixel = glyphPixels[Math.min(glyphPixels.length - 1,
        Math.floor((i + 0.5) * glyphPixels.length / sampleCount))];
      points.push({ x: measured.plate.x + (pixel.x + 0.5) / scaleX, y: measured.plate.y + (pixel.y + 0.5) / scaleY });
    }
    return {
      ...item, box: item.box, points, changedPixels: changed.length, top10Pixels: topCount,
      declaredLuminance, brightestLuminance: brightest, brightestRatio,
      minimumTopContrast, minimumDeclaredTopContrast,
      contrastPass: changed.length > 0 && Math.max(minimumTopContrast, minimumDeclaredTopContrast) >= 4.5,
    };
  });

  const top = await withOnlineProbeStyle(page, 'data-rendered-online-text-hit-test',
    '.goat--online .goat-lockup__word, .goat--online .goat-lockup__word *, .goat--online .gc-badge, .goat--online .gc-badge * { pointer-events: auto !important; }',
    () => page.evaluate((items) => {
      const shadow = document.getElementById('gmdm-widget-host').shadowRoot;
      const describe = (element) => element ? {
        tag: element.tagName, className: typeof element.className === 'string' ? element.className : null,
      } : null;
      return items.map((item) => {
        const text = shadow.querySelector(item.selector);
        const block = shadow.querySelector(item.blockSelector);
        const samples = item.points.map((point) => {
          const hit = shadow.elementFromPoint(point.x, point.y);
          const allowed = Boolean(hit && text && block &&
            (hit === text || text.contains(hit) || (block.contains(hit) && hit.contains(text))));
          return { point, hit: describe(hit), allowed };
        });
        return { element: item.name, samples, pass: samples.length >= 3 && samples.every((sample) => sample.allowed) };
      });
    }, text));
  return { text, top };
}

async function checkOnlineTextOnTop(page, tag, vectorName, state) {
  const measured = await measureRenderedOnlineText(page);
  const pass = measured.top.every((item) => item.pass);
  check(tag + ' text-on-top ' + vectorName + ' ' + state, pass, JSON.stringify(measured.top));
  return measured;
}

async function checkOnlineTextRenderedContrast(page, tag, vectorName, state, measured = null) {
  const result = measured || await measureRenderedOnlineText(page);
  const pass = result.text.every((item) => item.contrastPass);
  check(tag + ' text-rendered-contrast ' + vectorName + ' ' + state, pass,
    JSON.stringify(result.text.map((item) => ({
      element: item.name, color: item.color, changedPixels: item.changedPixels,
      minimumTopContrast: +item.minimumTopContrast.toFixed(3), declaredTopContrast: +item.minimumDeclaredTopContrast.toFixed(3),
      brightestRatio: +item.brightestRatio.toFixed(3),
    }))));
  return result;
}

async function measureOnlineTextContrast(page) {
  const measured = await page.evaluate(() => {
    const shadow = document.getElementById('gmdm-widget-host').shadowRoot;
    const plate = shadow.querySelector('.goat--online .goat-lockup');
    const selectors = [
      ['goat-lockup__name', '.goat--online .goat-lockup__name'],
      ['goat-lockup__tag', '.goat--online .goat-lockup__tag'],
      ['goat-lockup__tag em', '.goat--online .goat-lockup__tag em'],
      ['gc-badge__text', '.goat--online .gc-badge__text'],
    ];
    const box = (element) => {
      const rect = element.getBoundingClientRect();
      return { x: rect.x, y: rect.y, w: rect.width, h: rect.height };
    };
    const text = selectors.map(([name, selector]) => {
      const element = shadow.querySelector(selector);
      if (!element) return null;
      return { name, box: box(element), color: getComputedStyle(element).color };
    }).filter(Boolean);
    return { plate: box(plate), text };
  });
  return withOnlineProbeStyle(page, 'data-online-text-contrast', ONLINE_TEXT_HIDE_CSS, async () => {
    await page.waitForTimeout(700);
    const image = PNG.sync.read(await page.locator('.goat--online .goat-lockup').screenshot());
    const scaleX = image.width / measured.plate.w;
    const scaleY = image.height / measured.plate.h;
    return measured.text.map((item) => {
      const textColor = parseRgbColor(item.color);
      const left = Math.max(0, Math.floor((item.box.x - measured.plate.x) * scaleX));
      const top = Math.max(0, Math.floor((item.box.y - measured.plate.y) * scaleY));
      const right = Math.min(image.width, Math.ceil((item.box.x + item.box.w - measured.plate.x) * scaleX));
      const bottom = Math.min(image.height, Math.ceil((item.box.y + item.box.h - measured.plate.y) * scaleY));
      let minimum = Infinity;
      for (let y = top; y < bottom; y++) {
        for (let x = left; x < right; x++) {
          const offset = (y * image.width + x) * 4;
          minimum = Math.min(minimum, wcagContrast(textColor, {
            r: image.data[offset], g: image.data[offset + 1], b: image.data[offset + 2],
          }));
        }
      }
      return { element: item.name, color: item.color, box: item.box, minimum: +minimum.toFixed(3) };
    });
  });
}

async function checkOnlineTextContrast(page, tag, vectorName, state) {
  const ratios = await measureOnlineTextContrast(page);
  const summary = ratios.map((item) => item.element + '=' + item.minimum.toFixed(2)).join(' ');
  check(tag + ' online-text-contrast ' + vectorName + ' ' + state + ' ' + summary,
    ratios.every((item) => item.minimum >= 4.5), JSON.stringify(ratios));
}

async function checkOnlineNoColourHacks(page, tag, vectorName, state) {
  const styles = await page.evaluate(() => {
    const shadow = document.getElementById('gmdm-widget-host').shadowRoot;
    const selectors = [
      ['wordmark', '.goat--online .goat-lockup__name'],
      ['tagline', '.goat--online .goat-lockup__tag'],
      ['tagline em', '.goat--online .goat-lockup__tag em'],
      ['badge', '.goat--online .gc-badge'],
      ['badge text', '.goat--online .gc-badge__text'],
    ];
    const describe = (name, selector) => {
      const element = shadow.querySelector(selector);
      if (!element) return { name, selector, missing: true };
      const style = getComputedStyle(element);
      return { name, selector, color: style.color, filter: style.filter,
        textFill: style.webkitTextFillColor, textStroke: style.webkitTextStrokeColor };
    };
    const photo = shadow.querySelector('.goat--online .gc-photo__img');
    return { photo: photo ? { filter: getComputedStyle(photo).filter } : { missing: true }, text: selectors.map(([name, selector]) => describe(name, selector)) };
  });
  const expected = {
    wordmark: { r: 248, g: 238, b: 223 },
    tagline: { r: 248, g: 238, b: 223 },
    'tagline em': { r: 240, g: 192, b: 122 },
    badge: { r: 240, g: 192, b: 122 },
    'badge text': { r: 240, g: 192, b: 122 },
  };
  const colorMatches = (value, wanted) => {
    try {
      const actual = parseRgbColor(value);
      return actual.r === wanted.r && actual.g === wanted.g && actual.b === wanted.b && actual.a === 1;
    } catch {
      return false;
    }
  };
  const pass = styles.photo.filter === 'none' && styles.text.every((item) => item.name === 'tagline em' && item.missing ||
    (!item.missing && item.filter === 'none' && colorMatches(item.color, expected[item.name])));
  check(tag + ' no-colour-hacks ' + vectorName + ' ' + state, pass, JSON.stringify({ expected, ...styles }));
}

function intersects(a, b) {
  return Boolean(a && b && a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y);
}

function noOverlap(measured) {
  const boxes = {
    headline: measured.headline && measured.headline.box,
    wordmark: measured.wordmarkBox,
    tagline: measured.taglineBox,
    badge: measured.badgeBox,
    iphone: measured.iphone,
    qr: measured.qr,
  };
  const names = Object.keys(boxes);
  const overlaps = [];
  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      const pair = [names[i], names[j]];
      if (intersects(boxes[pair[0]], boxes[pair[1]])) overlaps.push(pair.join(' vs '));
    }
  }
  return {
    overlaps,
    textFits: measured.texts.every((item) => item.scrollWidth <= item.clientWidth || item.text.endsWith('\u2026')),
    headlineAbovePlate: !measured.headline || Boolean(measured.headline.box && measured.plate &&
      measured.headline.box.y + measured.headline.box.h <= measured.plate.y + 0.01),
  };
}

function stageClearances(measured) {
  const vf = measured.vfInner;
  return (measured.content || []).map((item) => ({
    selector: item.selector,
    clear: vf && item.rect ? Math.min(
      item.rect.x - vf.x, item.rect.y - vf.y,
      vf.x + vf.w - item.rect.x - item.rect.w,
      vf.y + vf.h - item.rect.y - item.rect.h,
    ) : -Infinity,
  }));
}

function stageInside(measured, margin = 4) {
  return measured.variant === 'online' && measured.vfInner && measured.content &&
    measured.content.length === 6 && stageClearances(measured).every((item) => item.clear >= margin);
}

function stageGeometrySummary(measured) {
  return {
    stageScale: measured.stageScale,
    plate: measured.plate,
    plateTransform: measured.plateTransform,
    vfInner: measured.vfInner,
    clearances: stageClearances(measured),
  };
}

function zoomTextFits(measured) {
  return measured.texts.every((item) => item.scrollWidth <= item.clientWidth || item.text.endsWith('\u2026')) &&
    measured.textsOutside.length === 0;
}

function zoomPanelInViewport(measured) {
  const panel = measured.shell;
  return Boolean(panel && panel.x >= 0 && panel.x + panel.w <= measured.viewport.w &&
    panel.y >= 0 && panel.y + panel.h <= measured.viewport.h);
}

function fullyInside(inner, outer) {
  return Boolean(inner && outer && inner.x >= outer.x - 0.5 && inner.y >= outer.y - 0.5 &&
    inner.x + inner.w <= outer.x + outer.w + 0.5 && inner.y + inner.h <= outer.y + outer.h + 0.5);
}

function zoomBannerReachable(measured) {
  const viewport = { x: 0, y: 0, w: measured.viewport.w, h: measured.viewport.h };
  const panel = measured.shell;
  return measured.bodyOverflowY === 'auto' && measured.shellScroll[0] > measured.shellScroll[1] &&
    [measured.bannerLink, measured.plate, measured.qr].every((box) =>
      fullyInside(box, viewport) && fullyInside(box, panel));
}

const browser = await (ENGINE === 'firefox' ? firefox : chromium).launch({ headless: true });
const log = { engine: ENGINE, version: browser.version(), widget: path.relative(ROOT, WIDGET), runs: [] };
try {
  for (const dpr of [1, 2]) {
    const context = await browser.newContext({ viewport: { width: 600, height: 900 }, deviceScaleFactor: dpr });
    const page = await context.newPage();
    const errors = [];
    const requests = [];
    page.on('pageerror', (error) => errors.push(String(error)));
    page.on('console', (message) => { if (message.type() === 'error') errors.push('console: ' + message.text()); });
    page.on('request', (request) => requests.push(request.url()));
    await page.setContent(FIXTURE);
    await page.evaluate('(' + installRuntimeStub.toString() + ')()');
    await page.addScriptTag({ content: fs.readFileSync(WIDGET, 'utf8') });
    await page.waitForSelector('#gmdm-widget-host');
    await installFocusoutTrace(page);
    const tag = '[' + ENGINE + ' dpr ' + dpr + ']';
    const shot = async (name) => page.locator('.shell').screenshot({ path: path.join(OUT, PREFIX + name + '-dpr' + dpr + '.png') });
    const park = async () => page.mouse.move(595, 895);
    const setActive = async (on) => page.evaluate((value) => document.getElementById('gmdm-widget-host').shadowRoot.querySelector('.goat-lockup').classList.toggle('is-active', value), on);

    await shot('dagoat-closed');
    await page.locator('.pill').click();
    await publishDagoat(page, true, 0);
    await park();
    await page.waitForTimeout(800);
    const dagoat = await measure(page);
    const dagoatFocusout = await focusoutTrace(page);
    console.log(tag + ' focusout after pinned dagoat redraw: ' + JSON.stringify(dagoatFocusout));
    check(tag + ' pinned-stays-open dagoat', dagoat.open,
      JSON.stringify({ shell: dagoat.open, focusout: dagoatFocusout }));
    await shot('dagoat-open');
    const currentDagoatFile = path.join(OUT, PREFIX + 'dagoat-model-dpr' + dpr + '.png');
    await page.locator('.goat').screenshot({ path: currentDagoatFile });
    const currentDagoatBoxes = await page.locator('.goat').evaluate((element) => {
      const box = (selector) => { const node = element.querySelector(selector); const rect = node && node.getBoundingClientRect(); return rect &&
        { x: +rect.x.toFixed(2), y: +rect.y.toFixed(2), w: +rect.width.toFixed(2), h: +rect.height.toFixed(2),
          font: getComputedStyle(node).font, letter: getComputedStyle(node).letterSpacing }; };
      return { plate: box('.goat-lockup'), mark: box('.goat-lockup__mark'), word: box('.goat-lockup__word'),
        name: box('.goat-lockup__name'), tag: box('.goat-lockup__tag') };
    });
    const originalContext = await browser.newContext({ viewport: { width: 600, height: 900 }, deviceScaleFactor: dpr });
    const originalPage = await originalContext.newPage();
    await originalPage.setContent(FIXTURE);
    await originalPage.evaluate('(' + installRuntimeStub.toString() + ')()');
    await originalPage.addScriptTag({ content: ORIGINAL_WIDGET });
    await originalPage.waitForSelector('#gmdm-widget-host');
    await originalPage.locator('.pill').click();
    await originalPage.mouse.move(595, 895);
    await originalPage.waitForTimeout(800);
    const originalDagoatFile = path.join(OUT, PREFIX + 'dagoat-model-1.0.2-dpr' + dpr + '.png');
    await originalPage.locator('.goat').screenshot({ path: originalDagoatFile });
    const dagoatImage = comparePngFiles(currentDagoatFile, originalDagoatFile);
    dagoatImage.currentBoxes = currentDagoatBoxes;
    dagoatImage.originalBoxes = await originalPage.locator('.goat').evaluate((element) => {
      const box = (selector) => { const node = element.querySelector(selector); const rect = node && node.getBoundingClientRect(); return rect &&
        { x: +rect.x.toFixed(2), y: +rect.y.toFixed(2), w: +rect.width.toFixed(2), h: +rect.height.toFixed(2),
          font: getComputedStyle(node).font, letter: getComputedStyle(node).letterSpacing }; };
      return { plate: box('.goat-lockup'), mark: box('.goat-lockup__mark'), word: box('.goat-lockup__word'),
        name: box('.goat-lockup__name'), tag: box('.goat-lockup__tag') };
    });
    check(tag + ' dagoat-matches-1.0.2 image', dagoatImage.pass, JSON.stringify(dagoatImage));
    await originalContext.close();
    check(tag + ' dagoat-text', dagoat.variant === 'dagoat' && JSON.stringify(dagoat.copy) === JSON.stringify(DAGOAT_LINES) && dagoat.href === DAGOAT_URL,
      JSON.stringify({ copy: dagoat.copy, href: dagoat.href, target: dagoat.target, rel: dagoat.rel }));
    check(tag + ' dagoat-matches-1.0.2', dagoat.goat && dagoat.copyBox && dagoat.plate &&
      Math.abs(dagoat.goat.w - 244) <= 1 && Math.abs(dagoat.goat.h - 130.1) <= 1 &&
      Math.abs(dagoat.copyBox.w - 244) <= 1 && Math.abs(dagoat.copyBox.h - 48.1) <= 1 &&
      Math.abs(dagoat.plate.w - 244) <= 1 && Math.abs(dagoat.plate.h - 74) <= 1,
      JSON.stringify({ goat: dagoat.goat, copy: dagoat.copyBox, plate: dagoat.plate }));

    await publish(page, valid, Date.now() + 3600000, false, 1);
    await park();
    await page.waitForTimeout(800);
    const rest = await measure(page);
    check(tag + ' stage clearance at rest >= 4px', stageInside(rest), JSON.stringify(stageGeometrySummary(rest)));
    await page.locator('.goat--online .goat-lockup').screenshot({ path: path.join(OUT, PREFIX + 'online-plate-rest-dpr' + dpr + '.png') });
    check(tag + ' slogan is two serif lines with gold NOW emphasis',
      rest.taglineLines && rest.taglineLines.length === 2 &&
      JSON.stringify(rest.taglineLines.map((line) => line.text)) === JSON.stringify(online.banner.tagline) &&
      rest.taglineEm && rest.taglineEm.length === 1 && rest.taglineEm[0].text === 'NOW' &&
      rest.taglineEm[0].fontStyle === 'italic' && rest.taglineEm[0].color === 'rgb(240, 192, 122)' &&
      /serif/i.test(rest.taglineFontFamily || ''),
      JSON.stringify({ lines: rest.taglineLines, em: rest.taglineEm, fontFamily: rest.taglineFontFamily }));
    check(tag + ' wordmark is larger than be8ee2a', rest.wordmarkFontSize > 15,
      JSON.stringify({ wordmarkFontSize: rest.wordmarkFontSize, baseline: 15 }));
    const validRestText = await checkOnlineTextOnTop(page, tag, 'valid', 'rest');
    await checkOnlineTextRenderedContrast(page, tag, 'valid', 'rest', validRestText);
    await checkOnlineNoColourHacks(page, tag, 'valid', 'rest');
    await checkOnlineTextContrast(page, tag, 'valid', 'rest');
    const onlineFocusout = await focusoutTrace(page);
    console.log(tag + ' focusout after pinned online redraw: ' + JSON.stringify(onlineFocusout));
    check(tag + ' pinned-stays-open online', rest.open,
      JSON.stringify({ shell: rest.open, focusout: onlineFocusout }));
    await shot('online-open');
    check(tag + ' no-scroll-at-normal-size', rest.shellScroll[0] <= rest.shellScroll[1],
      JSON.stringify({ shellScroll: rest.shellScroll, shellOverflowY: rest.shellOverflowY, bodyOverflowY: rest.bodyOverflowY }));
    check(tag + ' banner sits under StarGithub with a gap >= 16px', rest.open && rest.gap >= 16,
      JSON.stringify({ open: rest.open, gap: rest.gap }));
    check(tag + ' link is the only link and opens banner.link safely in a new tab',
      rest.links === 1 && rest.href === valid.banner.link && rest.target === '_blank' &&
      /(^| )noopener( |$)/.test(rest.rel) && /(^| )noreferrer( |$)/.test(rest.rel),
      JSON.stringify({ links: rest.links, href: rest.href, target: rest.target, rel: rest.rel }));
    const iphoneCorners = rest.variant === 'online' && rest.iphone ? await measureIphoneCorners(page, rest) : null;
    check(tag + ' iphone-mockup', rest.variant === 'online' && rest.iphone && rest.qr &&
      rest.iphone.x + rest.iphone.w <= rest.qr.x + 0.01 &&
      Math.abs((rest.iphone.y + rest.iphone.h / 2) - (rest.plate.y + rest.plate.h / 2)) <= 1 &&
      rest.iphone.w >= 26 && rest.iphone.w <= 30 && rest.iphone.h >= 56 && rest.iphone.h <= 62 &&
      rest.iphoneImage && rest.iphoneImage.complete && rest.iphoneImage.naturalWidth === 60 &&
      rest.iphoneImage.naturalHeight === 128 && rest.iphoneImage.scheme === 'data:image/webp;base64' &&
      Number.parseFloat(rest.iphoneImage.borderRadius) >= 5 && iphoneCorners && iphoneCorners.pass,
      JSON.stringify({ iphone: rest.iphone, qr: rest.qr, image: rest.iphoneImage, corners: iphoneCorners }));
    check(tag + ' plate size and photo cover the plate inside its border',
       Math.abs(rest.plate.w - 244) < 0.01 && Math.abs(rest.plate.h - 96) < 0.01 &&
      Math.abs(rest.photo.w - (rest.plate.w - 2)) < 0.01 && Math.abs(rest.photo.h - (rest.plate.h - 2)) < 0.01 &&
      rest.image.complete && rest.image.naturalWidth === 800 && rest.image.naturalHeight === 498,
      JSON.stringify({ plate: rest.plate, photo: rest.photo, image: rest.image }));
    check(tag + ' nothing overflows the plate; the plate itself clips nothing',
      rest.plateScroll[0] === rest.plateScroll[1] && rest.plateScroll[2] === rest.plateScroll[3] &&
      rest.textsOutside.length === 0 && rest.plateOverflow === 'visible',
      JSON.stringify({ scroll: rest.plateScroll, textsOutside: rest.textsOutside, overflow: rest.plateOverflow }));
    check(tag + ' QR rests at 72x72 css px with the 37-module matrix, clear of the wordmark',
      rest.qrViewBox === '0 0 37 37' && Math.abs(rest.qr.w - 72) < 0.01 && Math.abs(rest.qr.h - 72) < 0.01 &&
      rest.textsOverQr.length === 0,
      JSON.stringify({ qr: rest.qr, viewBox: rest.qrViewBox, textsOverQr: rest.textsOverQr }));
    const restOverlap = noOverlap(rest);
    check(tag + ' no-overlap valid vector', restOverlap.overlaps.length === 0 && restOverlap.textFits && restOverlap.headlineAbovePlate,
      JSON.stringify(restOverlap));
    const plateImage = await page.locator('.goat--online .goat-lockup').screenshot();
    const plateAfter = measurePlateLuminance(plateImage, rest.plate, [rest.qr, rest.iphone]);
    const barePhotoImage = await screenshotOnlineProbe(page, ONLINE_BARE_PHOTO_CSS);
    const hiddenTextImage = await screenshotOnlineProbe(page, ONLINE_TEXT_HIDE_CSS);
    const naturalPhoto = measurePhotoNaturalAttenuation(hiddenTextImage, barePhotoImage, rest.plate, rest.photo, rest.qr, rest.iphone,
      [rest.wordmarkBox, rest.taglineBox, rest.badgeBox]);
    check(tag + ' photo-natural', naturalPhoto.max.value <= PHOTO_NATURAL_MAX_ATTENUATION &&
      naturalPhoto.mean >= PHOTO_NATURAL_MIN_MEAN_ATTENUATION,
      JSON.stringify({ maxAttenuation: +naturalPhoto.max.value.toFixed(6), meanAttenuation: +naturalPhoto.mean.toFixed(6),
        minimumAttenuation: +naturalPhoto.minimum.toFixed(6), maxAt: naturalPhoto.max.css,
        maxRequired: PHOTO_NATURAL_MAX_ATTENUATION, meanRequired: PHOTO_NATURAL_MIN_MEAN_ATTENUATION,
        textGlowPaddingCssPx: PHOTO_TEXT_GLOW_PADDING, pixels: naturalPhoto.pixels,
        includedPixels: naturalPhoto.includedPixels, exclusions: naturalPhoto.exclusions,
        wholePlateMean: +plateAfter.mean.toFixed(12), wholePlateVs16ef14e: +(plateAfter.mean / PHOTO_LUMINANCE_BEFORE_16EF14E).toFixed(6),
        wholePlateBaseline16ef14e: PHOTO_LUMINANCE_BEFORE_16EF14E }));
    const controlImage = await screenshotOnlineProbe(page, ONLINE_HARD_EDGE_CONTROL_CSS);
    const realOverlay = measureOverlayAttenuation(hiddenTextImage, barePhotoImage, rest.plate, rest.photo, rest.qr, rest.iphone);
    const controlOverlay = measureOverlayAttenuation(controlImage, barePhotoImage, rest.plate, rest.photo, rest.qr, rest.iphone);
    const noHardEdgeThreshold = controlOverlay.max.average * NO_HARD_EDGE_CONTROL_THRESHOLD_FRACTION;
    check(tag + ' no-hard-edge control', controlOverlay.max.average >= NO_HARD_EDGE_CONTROL_MIN_AVERAGE &&
      controlOverlay.max.average >= realOverlay.max.average * 3,
      JSON.stringify({ control: controlOverlay.max, real: realOverlay.max,
        controlMin: NO_HARD_EDGE_CONTROL_MIN_AVERAGE, requiredControlToRealRatio: 3,
        thresholdFraction: NO_HARD_EDGE_CONTROL_THRESHOLD_FRACTION, exclusions: controlOverlay.exclusions }));
    check(tag + ' no-hard-edge', realOverlay.max.average <= noHardEdgeThreshold,
      JSON.stringify({ real: realOverlay.max, control: controlOverlay.max, threshold: noHardEdgeThreshold,
        thresholdFraction: NO_HARD_EDGE_CONTROL_THRESHOLD_FRACTION, exclusions: realOverlay.exclusions,
        realBoundaries: realOverlay.boundaries, controlBoundaries: controlOverlay.boundaries }));
    check(tag + ' at rest: steam hidden and its three loops are paused',
      +rest.steamOpacity === 0 && rest.animations.running === 0 && rest.animations.total >= 3,
      JSON.stringify({ steam: rest.steamOpacity, display: rest.steamDisplay, animations: rest.animations }));
    await page.locator('.pill').click();
    await park();
    await page.waitForTimeout(350);
    const closed = await measure(page);
    check(tag + ' panel-closes', !closed.open && closed.pillExpanded === 'false',
      JSON.stringify({ open: closed.open, ariaExpanded: closed.pillExpanded }));
    await shot('online-closed');
    await page.locator('.pill').click();
    await park();
    await page.waitForTimeout(350);
    await publish(page, valid, Date.now() + 3600000, true, 1);
    await park();
    const onlineText = await measure(page);
    check(tag + ' online-text', onlineText.variant === 'online' && onlineText.texts.some((x) => x.text === valid.banner.headline) &&
      onlineText.name === valid.banner.wordmark && onlineText.tag === valid.banner.tagline.join('') && onlineText.href === valid.banner.link &&
      onlineText.target === '_blank' && /(^| )noopener( |$)/.test(onlineText.rel),
      JSON.stringify({ texts: onlineText.texts.map((x) => x.text), name: onlineText.name, tag: onlineText.tag, href: onlineText.href, rel: onlineText.rel }));
    check(tag + ' online layout keeps headline above the photo and restores the plate copy',
      onlineText.headline && !onlineText.headline.inPlate && onlineText.headline.hasEm &&
      onlineText.wordmarkBox && onlineText.taglineBox && onlineText.badgeBox && onlineText.qr &&
      onlineText.wordmarkBox.y >= onlineText.plate.y && onlineText.taglineBox.y >= onlineText.wordmarkBox.y,
      JSON.stringify({ headline: onlineText.headline, plate: onlineText.plate, wordmark: onlineText.wordmarkBox,
        tagline: onlineText.taglineBox, badge: onlineText.badgeBox, qr: onlineText.qr }));
    check(tag + ' badge-descenders', onlineText.badgeText &&
      onlineText.badgeText.scrollHeight <= onlineText.badgeText.clientHeight &&
      onlineText.badgeText.fontFamily.trim().toLowerCase().startsWith(V2_BADGE_FIRST_FAMILY) &&
      onlineText.badgeText.lineBoxHeight >= 1.2 * onlineText.badgeText.fontSize,
      JSON.stringify(onlineText.badgeText));
    check(tag + ' online-geometry-matches-dagoat', onlineText.goat && onlineText.copyBox && onlineText.plate &&
      dagoat.goat && dagoat.copyBox && dagoat.plate &&
      Math.abs(onlineText.goat.w - dagoat.goat.w) <= 1 && Math.abs(onlineText.goat.h - dagoat.goat.h) <= 1 &&
      Math.abs(onlineText.goat.w - 244) <= 1 && Math.abs(onlineText.goat.h - 130) <= 1,
      JSON.stringify({ online: { goat: onlineText.goat, copy: onlineText.copyBox, plate: onlineText.plate },
        dagoat: { goat: dagoat.goat, copy: dagoat.copyBox, plate: dagoat.plate } }));
    check(tag + ' online geometry', onlineText.open && onlineText.goat && Math.abs(onlineText.goat.w - 244) < 0.01 && Math.abs(onlineText.goat.h - 130) < 0.01 &&
      onlineText.plate && Math.abs(onlineText.plate.w - 244) < 0.01 && Math.abs(onlineText.plate.h - 96) < 0.01 &&
      onlineText.image.complete && onlineText.image.naturalWidth === 800 && onlineText.image.naturalHeight === 498 && onlineText.qrViewBox === '0 0 37 37' && onlineText.qrPathCount === 1,
      JSON.stringify({ plate: onlineText.plate, image: onlineText.image, qr: onlineText.qr, viewBox: onlineText.qrViewBox, paths: onlineText.qrPathCount }));
    check(tag + ' online text fits', onlineText.texts.every((x) => x.scrollWidth <= x.clientWidth || x.text.endsWith('\u2026')),
      JSON.stringify(onlineText.texts.map((x) => ({ text: x.text, scroll: [x.scrollWidth, x.clientWidth] }))));
    const liveTextExpected = [valid.banner.headline, valid.banner.wordmark, valid.banner.tagline.join(''), valid.banner.badge];
    const liveTextWhole = onlineText.texts.length === liveTextExpected.length &&
      onlineText.texts.every((item, index) => item.text === liveTextExpected[index] && !item.text.includes('\u2026') &&
        item.scrollWidth <= item.clientWidth && item.fontSize >= LIVE_TEXT_MIN_FONT_SIZES[index] - 0.01);
    check(tag + ' live-text-whole', liveTextWhole,
      JSON.stringify({ expected: liveTextExpected, actual: onlineText.texts.map((item) => ({ text: item.text, fontSize: item.fontSize, scroll: [item.scrollWidth, item.clientWidth] })) }));
    check(tag + ' online photo and QR are local', onlineText.image.scheme === 'data:image/webp;base64' && onlineText.plateScroll[0] === onlineText.plateScroll[1],
      JSON.stringify({ scheme: onlineText.image.scheme, scroll: onlineText.plateScroll }));

    const qrFile = path.join(OUT, PREFIX + 'online-qr-dpr' + dpr + '.png');
    await page.locator('.gc-qr').screenshot({ path: qrFile });
    const qr = decodeQr(qrFile, valid.banner.qr.text);
    if (qr.skipped) skipped(tag + ' online-qr-decodes', qr.reason);
    else check(tag + ' online-qr-decodes', qr.pass, qr.detail);

    const expectedBannerTexts = [valid.banner.headline, valid.banner.wordmark, valid.banner.tagline.join(''), valid.banner.badge];
    const firstOpenText = onlineText.texts.map((item) => ({ text: item.text, fontSize: item.fontSize }));
    const intactAfterReopen = (measured) => {
      const snapshot = measured.texts.map((item) => ({ text: item.text, fontSize: item.fontSize }));
      return measured.variant === 'online' && JSON.stringify(snapshot.map((item) => item.text)) === JSON.stringify(expectedBannerTexts) &&
        snapshot.length === firstOpenText.length && snapshot.every((item, index) => Math.abs(item.fontSize - firstOpenText[index].fontSize) < 0.01);
    };
    await page.locator('.pill').click();
    await park();
    await page.waitForTimeout(350);
    await page.locator('.pill').click();
    await park();
    await page.waitForTimeout(500);
    const reopened = await measure(page);
    check(tag + ' reopen-text-intact', intactAfterReopen(reopened),
      JSON.stringify({ first: firstOpenText, reopened: reopened.texts.map((item) => ({ text: item.text, fontSize: item.fontSize })) }));

    await page.locator('.pill').click();
    await park();
    await page.waitForTimeout(350);
    await publish(page, valid, Date.now() + 3600000, true, 9);
    await page.locator('.pill').click();
    await park();
    await page.waitForTimeout(500);
    const closedPublished = await measure(page);
    check(tag + ' reopen-text-intact closed-display', intactAfterReopen(closedPublished),
      JSON.stringify({ first: firstOpenText, reopened: closedPublished.texts.map((item) => ({ text: item.text, fontSize: item.fontSize })) }));

    await setActive(true);
    await page.waitForTimeout(1400);
    const validActiveText = await checkOnlineTextOnTop(page, tag, 'valid', 'active');
    await checkOnlineTextRenderedContrast(page, tag, 'valid', 'active', validActiveText);
    await checkOnlineNoColourHacks(page, tag, 'valid', 'active');
    await checkOnlineTextContrast(page, tag, 'valid', 'active');
    const active = await measure(page);
    const restQrItem = rest.content && rest.content.find((item) => item.selector === '.gc-qr');
    const activeQrItem = active.content && active.content.find((item) => item.selector === '.gc-qr');
    const restNameItem = rest.content && rest.content.find((item) => item.selector === '.goat-lockup__name');
    const activeNameItem = active.content && active.content.find((item) => item.selector === '.goat-lockup__name');
    check(tag + ' stage clearance at active >= 4px', stageInside(active), JSON.stringify(stageGeometrySummary(active)));
    check(tag + ' active stage grows, brackets tighten, plate stays fixed',
      active.stageScale > rest.stageScale + 0.01 && activeQrItem.rect.w > restQrItem.rect.w * 1.01 &&
      activeNameItem.rect.w > restNameItem.rect.w * 1.01 && active.vfInner.w < rest.vfInner.w - 1 &&
      active.vfInner.h < rest.vfInner.h - 1 && active.plateTransform === 'none' &&
      Math.abs(active.plate.w - rest.plate.w) < 0.5 && Math.abs(active.plate.h - rest.plate.h) < 0.5,
      JSON.stringify({ rest: stageGeometrySummary(rest), active: stageGeometrySummary(active) }));
    await setActive(false);
    await page.waitForTimeout(1000);
    const afterActive = await measure(page);
    check(tag + ' motion active state', +active.steamOpacity === 1 && active.animations.running >= 3 && afterActive.animations.running === 0,
      JSON.stringify({ active: active.animations, after: afterActive.animations, steam: [active.steamOpacity, afterActive.steamOpacity] }));
    await page.evaluate(() => {
      const shadow = document.getElementById('gmdm-widget-host').shadowRoot;
      const wordmark = shadow.querySelector('.goat--online .goat-lockup__name');
      wordmark.style.setProperty('position', 'relative');
      wordmark.style.setProperty('left', '-100px', 'important');
    });
    const shifted = await measure(page);
    check(tag + ' negative control: wordmark pushed left fails 4px clearance', !stageInside(shifted),
      JSON.stringify(stageGeometrySummary(shifted)));
    await page.evaluate(() => {
      const wordmark = document.getElementById('gmdm-widget-host').shadowRoot.querySelector('.goat--online .goat-lockup__name');
      wordmark.style.removeProperty('position');
      wordmark.style.removeProperty('left');
    });
    await page.locator('.goat-lockup').hover({ position: { x: 20, y: 20 } });
    await page.waitForTimeout(700);
    const hover = await measure(page);
    await page.locator('.goat--online .goat-lockup').screenshot({ path: path.join(OUT, PREFIX + 'online-plate-hover-dpr' + dpr + '.png') });
    check(tag + ' hover motion', hover.stageScale > 1.04 && /^matrix\(1\.0[5-6]/.test(hover.frameTransform) && hover.plateTransform === 'none',
      JSON.stringify({ stage: hover.stageTransform, plate: hover.plateTransform, frame: hover.frameTransform }));
    await park();
    await page.waitForTimeout(250);

    await page.locator('.gc-qr').hover();
    await page.waitForTimeout(400);
    const qrHover = await measure(page);
    await park();
    await page.waitForTimeout(800);
    const afterQr = await measure(page);
    check(tag + ' QR hover uses stage scale only', qrHover.stageScale > 1.04 && qrHover.qr.w > afterQr.qr.w * 1.01 &&
      qrHover.qr.w < afterQr.qr.w * 1.1 && qrHover.qrOnTop === 5,
      JSON.stringify({ hover: { qr: qrHover.qr, stage: qrHover.stageTransform }, rest: { qr: afterQr.qr, stage: afterQr.stageTransform } }));

    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.locator('.goat-lockup').hover({ position: { x: 20, y: 20 } });
    await page.waitForTimeout(900);
    const reducedHover = await measure(page);
    check(tag + ' reduced motion: no stage scale, no bracket travel, no lift or steam',
      reducedHover.reduced && reducedHover.plateTransform === 'none' && reducedHover.frameTransform === 'none' &&
      reducedHover.stageTransform === 'none' && reducedHover.steamDisplay === 'none' && reducedHover.animations.running === 0 &&
      Math.abs(reducedHover.vfInner.w - rest.vfInner.w) < 0.01 && Math.abs(reducedHover.vfInner.h - rest.vfInner.h) < 0.01,
      JSON.stringify({ plate: reducedHover.plateTransform, frame: reducedHover.frameTransform, steam: reducedHover.steamDisplay,
        stage: reducedHover.stageTransform, animations: reducedHover.animations, vf: reducedHover.vfInner, restVf: rest.vfInner }));
    await park();
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.waitForTimeout(600);

    await page.locator('.pill').focus();
    for (let i = 0; i < 12; i++) {
      const at = await page.evaluate(() => {
        const sh = document.getElementById('gmdm-widget-host').shadowRoot;
        return sh.activeElement === sh.querySelector('.goat-lockup');
      });
      if (at) break;
      await page.keyboard.press('Tab');
    }
    await page.waitForTimeout(400);
    const keyboard = await measure(page);
    await shot('online-keyboard-focus');
    check(tag + ' keyboard: Tab reaches the link and focus-visible scales the stage',
      keyboard.focused && keyboard.focusVisible && keyboard.isActive && keyboard.stageScale > 1.04 &&
      keyboard.qr.w > rest.qr.w * 1.01 && keyboard.qrOnTop === 5,
      JSON.stringify({ focused: keyboard.focused, focusVisible: keyboard.focusVisible, active: keyboard.isActive,
        stage: keyboard.stageTransform, qr: keyboard.qr, room: keyboard.qrMinRoom, onTop: keyboard.qrOnTop }));
    await page.locator('.pill').focus();
    await park();
    await page.waitForTimeout(250);

    await publish(page, maxText, Date.now() + 3600000, false, 2);
    const maxMeasure = await measure(page);
    const maxRestText = await checkOnlineTextOnTop(page, tag, 'max-text', 'rest');
    await checkOnlineTextRenderedContrast(page, tag, 'max-text', 'rest', maxRestText);
    await checkOnlineNoColourHacks(page, tag, 'max-text', 'rest');
    await checkOnlineTextContrast(page, tag, 'max-text', 'rest');
    check(tag + ' max-text-fits', maxMeasure.variant === 'online' && maxMeasure.texts.every((x) => x.scrollWidth <= x.clientWidth || x.text.endsWith('\u2026')),
      JSON.stringify(maxMeasure.texts.map((x) => ({ text: x.text, scroll: [x.scrollWidth, x.clientWidth] }))));
    const maxOverlap = noOverlap(maxMeasure);
    check(tag + ' no-overlap max-text vector', maxOverlap.overlaps.length === 0 && maxOverlap.textFits && maxOverlap.headlineAbovePlate,
      JSON.stringify(maxOverlap));
    await setActive(true);
    await page.waitForTimeout(1400);
    const maxActiveText = await checkOnlineTextOnTop(page, tag, 'max-text', 'active');
    await checkOnlineTextRenderedContrast(page, tag, 'max-text', 'active', maxActiveText);
    await checkOnlineNoColourHacks(page, tag, 'max-text', 'active');
    await checkOnlineTextContrast(page, tag, 'max-text', 'active');
    await setActive(false);
    await page.waitForTimeout(1000);

    const unsafe = vectorCopy(valid);
    unsafe.headline = '<b>x';
    delete unsafe.headlineEm;
    await publish(page, { signed: valid.signed, banner: unsafe }, Date.now() + 3600000, true, 3);
    const unsafeMeasure = await measure(page);
    const markupCount = await page.locator('.goat--online b').count();
    check(tag + ' no-markup-from-data', unsafeMeasure.texts.some((x) => x.text === '<b>x') && markupCount === 0,
      JSON.stringify({ headline: unsafeMeasure.texts.find((x) => x.text === '<b>x')?.text || null, markupCount }));

    await publish(page, valid, Date.now() + 3600000, true, 4);
    await page.locator('.goat-lockup').hover({ position: { x: 20, y: 20 } });
    const beforePending = await measure(page);
    await publish(page, maxText, Date.now() + 3600000, false, 5);
    const whilePointer = await measure(page);
    check(tag + ' fresh-under-pointer-waits', whilePointer.texts.map((x) => x.text).includes(valid.banner.headline) &&
      !whilePointer.texts.map((x) => x.text).includes(maxText.banner.headline),
      JSON.stringify({ before: beforePending.texts.map((x) => x.text), while: whilePointer.texts.map((x) => x.text) }));
    await park();
    await page.waitForTimeout(300);
    const afterPointer = await measure(page);
    check(tag + ' deferred banner applies on pointerleave', afterPointer.texts.map((x) => x.text).includes(maxText.banner.headline) ||
      afterPointer.texts.some((x) => x.text.endsWith('\u2026')), JSON.stringify(afterPointer.texts.map((x) => x.text)));

    await page.locator('.goat-lockup').hover({ position: { x: 20, y: 20 } });
    await publishDagoat(page, true, 6);
    const killed = await measure(page);
    check(tag + ' killswitch-under-pointer', killed.variant === 'dagoat' && killed.copy.length === 2, JSON.stringify({ variant: killed.variant, copy: killed.copy }));

    await publish(page, valid, Date.now() + 140, true, 7);
    await page.waitForTimeout(260);
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await page.waitForTimeout(80);
    const expired = await measure(page);
    const resumeMessages = await page.evaluate(() => window.__bannerHarness.messages().filter((x) => x && x.type === 'resume').length);
    check(tag + ' resume-after-expiry', expired.variant === 'dagoat' && resumeMessages > 0, JSON.stringify({ variant: expired.variant, resumeMessages }));

    await publish(page, valid, Date.now() + 3600000, true, 8);
    const stale = await measure(page);
    check(tag + ' stale-tab-redraws', stale.variant === 'online' && stale.href === ONLINE_URL, JSON.stringify({ variant: stale.variant, href: stale.href }));
    const connectsBefore = await page.evaluate(() => window.__bannerHarness.connectCount());
    await page.evaluate(() => window.__bannerHarness.disconnectLast());
    await page.waitForTimeout(100);
    const connectsAfter = await page.evaluate(() => window.__bannerHarness.connectCount());
    check(tag + ' port-reconnects', connectsAfter > connectsBefore, JSON.stringify({ before: connectsBefore, after: connectsAfter }));

    await page.locator('.goat-lockup').focus();
    await page.locator('.pill').focus();
    await park();
    const messages = await page.evaluate(() => window.__bannerHarness.messages());
    check(tag + ' pointer-focus messages', messages.some((x) => x.type === 'pointer' && x.over === true) &&
      messages.some((x) => x.type === 'pointer' && x.over === false) && messages.some((x) => x.type === 'focus' && x.inside === true) &&
      messages.some((x) => x.type === 'focus' && x.inside === false), JSON.stringify(messages));

    const fetched = requests.filter((url) => !url.startsWith('data:') && url !== 'about:blank');
    check(tag + ' nothing fetched', fetched.length === 0 && errors.length === 0, JSON.stringify({ fetched, errors }));
    log.runs.push({ dpr, screenshots: [PREFIX + 'dagoat-open-dpr' + dpr + '.png', PREFIX + 'dagoat-closed-dpr' + dpr + '.png', PREFIX + 'online-open-dpr' + dpr + '.png', PREFIX + 'online-closed-dpr' + dpr + '.png'], errors, requests });
    await context.close();
  }

  for (const zoom of [
    { name: 'zoom200', viewport: { width: 300, height: 450 } },
    { name: 'zoom200-narrow', viewport: { width: 400, height: 330 } },
    { name: 'zoom200-short', viewport: { width: 640, height: 330 } },
  ]) {
    const context = await browser.newContext({ viewport: zoom.viewport, deviceScaleFactor: 2 });
    const page = await context.newPage();
    const errors = [];
    const requests = [];
    page.on('pageerror', (error) => errors.push(String(error)));
    page.on('console', (message) => { if (message.type() === 'error') errors.push('console: ' + message.text()); });
    page.on('request', (request) => requests.push(request.url()));
    await page.setContent(FIXTURE);
    await page.evaluate('(' + installRuntimeStub.toString() + ')()');
    await page.addScriptTag({ content: fs.readFileSync(WIDGET, 'utf8') });
    await page.waitForSelector('#gmdm-widget-host');
    const tag = '[' + ENGINE + ' ' + zoom.name + ']';
    const short = zoom.viewport.height < 450;
    const shot = async (name) => page.locator('.shell').screenshot({ path: path.join(OUT, PREFIX + name + '.png') });
    const park = async () => page.mouse.move(Math.max(0, zoom.viewport.width - 5), Math.max(0, zoom.viewport.height - 5));
    const scrollBannerIntoView = async () => {
      await page.locator('.goat-lockup').evaluate((element) => element.scrollIntoView({ block: 'nearest', inline: 'nearest' }));
      await park();
      await page.waitForTimeout(80);
    };

    await page.locator('.pill').click();
    await park();
    await page.waitForTimeout(350);

    await publish(page, valid, Date.now() + 3600000, true, 20);
    await park();
    const zoomOnline = await measure(page);
    await shot(zoom.name + '-online-open');
    check(tag + ' zoom-text-fits valid vector', zoomOnline.variant === 'online' && zoomTextFits(zoomOnline),
      JSON.stringify({ texts: zoomOnline.texts, outside: zoomOnline.textsOutside, plateScroll: zoomOnline.plateScroll }));
    const zoomOnlineOverlap = noOverlap(zoomOnline);
    check(tag + ' zoom-no-overlap valid vector', zoomOnlineOverlap.overlaps.length === 0 && zoomOnlineOverlap.textFits &&
      zoomOnlineOverlap.headlineAbovePlate, JSON.stringify(zoomOnlineOverlap));
    check(tag + ' zoom-panel-in-viewport', zoomPanelInViewport(zoomOnline),
      JSON.stringify({ panel: zoomOnline.shell, viewport: zoomOnline.viewport }));

    if (short) {
      await scrollBannerIntoView();
      const zoomQrRestMeasure = await measure(page);
      await shot(zoom.name + '-banner-scrolled');
      check(tag + ' zoom-banner-reachable', zoomBannerReachable(zoomQrRestMeasure),
        JSON.stringify({ link: zoomQrRestMeasure.bannerLink, plate: zoomQrRestMeasure.plate,
          qr: zoomQrRestMeasure.qr, panel: zoomQrRestMeasure.shell, body: zoomQrRestMeasure.body,
          bodyInner: zoomQrRestMeasure.bodyInner, shellScroll: zoomQrRestMeasure.shellScroll,
          bodyScroll: zoomQrRestMeasure.bodyScroll, bodyInnerScroll: zoomQrRestMeasure.bodyInnerScroll,
          bodyOverflowY: zoomQrRestMeasure.bodyOverflowY, viewport: zoomQrRestMeasure.viewport }));
    }
    const zoomQrRest = path.join(OUT, PREFIX + zoom.name + '-qr-rest.png');
    await page.locator('.gc-qr').screenshot({ path: zoomQrRest });
    const zoomQr = decodeQr(zoomQrRest, valid.banner.qr.text);
    if (zoomQr.skipped) skipped(tag + ' zoom-qr-decodes', zoomQr.reason);
    else check(tag + ' zoom-qr-decodes', zoomQr.pass, zoomQr.detail);

    if (!short && zoomOnline.shellScroll[0] <= zoomOnline.shellScroll[1]) {
      await page.mouse.move(zoomOnline.qr.x + zoomOnline.qr.w / 2, zoomOnline.qr.y + zoomOnline.qr.h / 2);
      await page.waitForTimeout(400);
      const zoomQrHover = await measure(page);
      await shot(zoom.name + '-qr-hover');
      check(tag + ' zoom-qr-hover', zoomQrHover.qr.w > zoomOnline.qr.w && zoomQrHover.qr.h > zoomOnline.qr.h &&
        zoomQrHover.qrMinRoom >= 0 && zoomQrHover.qrViewportRoom >= 0 && zoomQrHover.qrOnTop === 5,
        JSON.stringify({ resting: zoomOnline.qr, qr: zoomQrHover.qr, clips: zoomQrHover.qrClips,
          panelRoom: zoomQrHover.qrMinRoom, viewportRoom: zoomQrHover.qrViewportRoom, onTop: zoomQrHover.qrOnTop }));
      await park();
      await page.waitForTimeout(250);
    }

    await publish(page, maxText, Date.now() + 3600000, true, 21);
    await park();
    const zoomMax = await measure(page);
    await shot(zoom.name + '-maxtext-open');
    check(tag + ' zoom-text-fits max-text vector', zoomMax.variant === 'online' && zoomTextFits(zoomMax),
      JSON.stringify({ texts: zoomMax.texts, outside: zoomMax.textsOutside, plateScroll: zoomMax.plateScroll }));
    const zoomMaxOverlap = noOverlap(zoomMax);
    check(tag + ' zoom-no-overlap max-text vector', zoomMaxOverlap.overlaps.length === 0 && zoomMaxOverlap.textFits &&
      zoomMaxOverlap.headlineAbovePlate, JSON.stringify(zoomMaxOverlap));

    await publishDagoat(page, true, 22);
    await park();
    const zoomDagoat = await measure(page);
    await shot(zoom.name + '-dagoat-open');
    check(tag + ' zoom-text-fits dagoat', zoomDagoat.variant === 'dagoat' && zoomTextFits(zoomDagoat),
      JSON.stringify({ texts: zoomDagoat.texts, outside: zoomDagoat.textsOutside, plateScroll: zoomDagoat.plateScroll }));
    const zoomDagoatOverlap = noOverlap(zoomDagoat);
    check(tag + ' zoom-no-overlap dagoat', zoomDagoatOverlap.overlaps.length === 0 && zoomDagoatOverlap.textFits &&
      zoomDagoatOverlap.headlineAbovePlate, JSON.stringify(zoomDagoatOverlap));

    log.runs.push({ zoom: zoom.name, viewport: zoom.viewport, dpr: 2,
      screenshots: [PREFIX + zoom.name + '-online-open.png', PREFIX + zoom.name + '-maxtext-open.png',
        PREFIX + zoom.name + '-dagoat-open.png',
        ...(short ? [PREFIX + zoom.name + '-banner-scrolled.png'] : []),
        ...(!short && zoomOnline.shellScroll[0] <= zoomOnline.shellScroll[1] ? [PREFIX + zoom.name + '-qr-hover.png'] : [])],
      errors, requests });
    await context.close();
  }
} finally {
  await browser.close();
}

const failed = results.filter((x) => x.status === 'fail').length;
const passed = results.filter((x) => x.status === 'pass').length;
const skippedCount = results.filter((x) => x.status === 'skip').length;
fs.writeFileSync(path.join(OUT, PREFIX + 'banner-shots.json'), JSON.stringify(log, null, 1));
console.log('\n' + ENGINE + ' ' + log.version + ': ' + passed + ' passed, ' + failed + ' failed, ' + skippedCount + ' skipped -- screenshots and ' + PREFIX + 'banner-shots.json in ' + OUT);
process.exit(failed ? 1 : 0);
