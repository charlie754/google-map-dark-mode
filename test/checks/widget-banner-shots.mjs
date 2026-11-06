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
    const qr = $('.gc-qr');
    const qrSvg = qr && qr.querySelector('svg');
    const qrBounds = qr && qr.getBoundingClientRect();
    const qrViewportRoom = qrBounds ? Math.min(qrBounds.left, innerWidth - qrBounds.right,
      qrBounds.top, innerHeight - qrBounds.bottom) : null;
    const headline = goat && goat.querySelector('.goat__copy .goat__line');
    const wordmark = goat && goat.querySelector('.goat-lockup__name');
    const tagline = goat && goat.querySelector('.goat-lockup__tag');
    const badge = goat && goat.querySelector('.gc-badge');
    const badgeText = badge && badge.querySelector('.gc-badge__text');
    const badgeTextStyle = badgeText && getComputedStyle(badgeText);
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

function intersects(a, b) {
  return Boolean(a && b && a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y);
}

function noOverlap(measured) {
  const boxes = {
    headline: measured.headline && measured.headline.box,
    wordmark: measured.wordmarkBox,
    tagline: measured.taglineBox,
    badge: measured.badgeBox,
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
     check(tag + ' plate size and photo cover the plate inside its border',
       Math.abs(rest.plate.w - 244) < 0.01 && Math.abs(rest.plate.h - 74) < 0.01 &&
      Math.abs(rest.photo.w - (rest.plate.w - 2)) < 0.01 && Math.abs(rest.photo.h - (rest.plate.h - 2)) < 0.01 &&
      rest.image.complete && rest.image.naturalWidth === 800 && rest.image.naturalHeight === 498,
      JSON.stringify({ plate: rest.plate, photo: rest.photo, image: rest.image }));
    check(tag + ' nothing overflows the plate; the plate itself clips nothing',
      rest.plateScroll[0] === rest.plateScroll[1] && rest.plateScroll[2] === rest.plateScroll[3] &&
      rest.textsOutside.length === 0 && rest.plateOverflow === 'visible',
      JSON.stringify({ scroll: rest.plateScroll, textsOutside: rest.textsOutside, overflow: rest.plateOverflow }));
    check(tag + ' QR rests at 60x60 css px with the 37-module matrix, clear of the wordmark',
      rest.qrViewBox === '0 0 37 37' && Math.abs(rest.qr.w - 60) < 0.01 && Math.abs(rest.qr.h - 60) < 0.01 &&
      rest.textsOverQr.length === 0,
      JSON.stringify({ qr: rest.qr, viewBox: rest.qrViewBox, textsOverQr: rest.textsOverQr }));
    const restOverlap = noOverlap(rest);
    check(tag + ' no-overlap valid vector', restOverlap.overlaps.length === 0 && restOverlap.textFits && restOverlap.headlineAbovePlate,
      JSON.stringify(restOverlap));
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
      onlineText.name === valid.banner.wordmark && onlineText.tag === valid.banner.tagline.join(' \u00b7 ') && onlineText.href === valid.banner.link &&
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
      Math.abs(onlineText.copyBox.w - dagoat.copyBox.w) <= 1 && Math.abs(onlineText.copyBox.h - dagoat.copyBox.h) <= 1 &&
      Math.abs(onlineText.plate.w - dagoat.plate.w) <= 1 && Math.abs(onlineText.plate.h - dagoat.plate.h) <= 1,
      JSON.stringify({ online: { goat: onlineText.goat, copy: onlineText.copyBox, plate: onlineText.plate },
        dagoat: { goat: dagoat.goat, copy: dagoat.copyBox, plate: dagoat.plate } }));
    check(tag + ' online geometry', onlineText.open && onlineText.plate && Math.abs(onlineText.plate.w - 244) < 0.01 && Math.abs(onlineText.plate.h - 74) < 0.01 &&
      onlineText.image.complete && onlineText.image.naturalWidth === 800 && onlineText.image.naturalHeight === 498 && onlineText.qrViewBox === '0 0 37 37' && onlineText.qrPathCount === 1,
      JSON.stringify({ plate: onlineText.plate, image: onlineText.image, qr: onlineText.qr, viewBox: onlineText.qrViewBox, paths: onlineText.qrPathCount }));
    check(tag + ' online text fits', onlineText.texts.every((x) => x.scrollWidth <= x.clientWidth || x.text.endsWith('\u2026')),
      JSON.stringify(onlineText.texts.map((x) => ({ text: x.text, scroll: [x.scrollWidth, x.clientWidth] }))));
    check(tag + ' online photo and QR are local', onlineText.image.scheme === 'data:image/webp;base64' && onlineText.plateScroll[0] === onlineText.plateScroll[1],
      JSON.stringify({ scheme: onlineText.image.scheme, scroll: onlineText.plateScroll }));

    const qrFile = path.join(OUT, PREFIX + 'online-qr-dpr' + dpr + '.png');
    await page.locator('.gc-qr').screenshot({ path: qrFile });
    const qr = decodeQr(qrFile, valid.banner.qr.text);
    if (qr.skipped) skipped(tag + ' online-qr-decodes', qr.reason);
    else check(tag + ' online-qr-decodes', qr.pass, qr.detail);

    const expectedBannerTexts = [valid.banner.headline, valid.banner.wordmark, valid.banner.tagline.join(' \u00b7 '), valid.banner.badge];
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
    await page.waitForTimeout(1000);
    const active = await measure(page);
    await setActive(false);
    await page.waitForTimeout(1000);
    const afterActive = await measure(page);
    check(tag + ' motion active state', +active.steamOpacity === 1 && active.animations.running >= 3 && afterActive.animations.running === 0,
      JSON.stringify({ active: active.animations, after: afterActive.animations, steam: [active.steamOpacity, afterActive.steamOpacity] }));
    await page.locator('.goat-lockup').hover({ position: { x: 20, y: 20 } });
    await page.waitForTimeout(700);
    const hover = await measure(page);
    check(tag + ' hover motion', /^matrix\(1, 0, 0, 1, 0, -2\)$/.test(hover.plateTransform) && /^matrix\(1\.0[5-6]/.test(hover.frameTransform),
      JSON.stringify({ plate: hover.plateTransform, frame: hover.frameTransform }));
    check(tag + ' photo hover lifts the plate 2px', hover.plateTransform === 'matrix(1, 0, 0, 1, 0, -2)',
      JSON.stringify({ plate: hover.plateTransform }));
    await park();
    await page.waitForTimeout(250);

    await page.locator('.gc-qr').hover();
    await page.waitForTimeout(400);
    const qrHover = await measure(page);
    await shot('online-qr-hover');
    await park();
    await page.waitForTimeout(800);
    const afterQr = await measure(page);
    check(tag + ' QR hover: tile >= 150px, not clipped by the panel, on top',
      qrHover.qr.w >= 150 && qrHover.qr.h >= 150 && qrHover.qrMinRoom >= 0 &&
      qrHover.qrClips.length >= 1 && qrHover.qrOnTop === 5,
      JSON.stringify({ qr: qrHover.qr, clips: qrHover.qrClips, room: qrHover.qrMinRoom, onTop: qrHover.qrOnTop }));
    check(tag + ' QR returns to 60px after the pointer leaves',
      Math.abs(afterQr.qr.w - 60) < 0.01 && Math.abs(afterQr.qr.h - 60) < 0.01,
      JSON.stringify(afterQr.qr));

    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.locator('.goat-lockup').hover({ position: { x: 20, y: 20 } });
    await page.waitForTimeout(900);
    const reducedHover = await measure(page);
    await page.locator('.gc-qr').hover();
    await page.waitForTimeout(40);
    const reducedQr = await measure(page);
    check(tag + ' reduced motion: no lift, no steam, nothing running; QR zoom stays and is instant',
      reducedHover.reduced && reducedHover.plateTransform === 'none' && reducedHover.frameTransform === 'none' &&
      reducedHover.steamDisplay === 'none' && reducedHover.animations.running === 0 &&
      reducedQr.qr.w >= 150 && reducedQr.qr.h >= 150 && reducedQr.qrMinRoom >= 0 && reducedQr.qrOnTop === 5,
      JSON.stringify({ plate: reducedHover.plateTransform, frame: reducedHover.frameTransform, steam: reducedHover.steamDisplay,
        animations: reducedHover.animations, qr: reducedQr.qr, room: reducedQr.qrMinRoom, onTop: reducedQr.qrOnTop }));
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
    check(tag + ' keyboard: Tab reaches the link, focus-visible zooms the QR, unclipped and on top',
      keyboard.focused && keyboard.focusVisible && keyboard.isActive && keyboard.qr.w >= 150 &&
      keyboard.qr.h >= 150 && keyboard.qrMinRoom >= 0 && keyboard.qrOnTop === 5,
      JSON.stringify({ focused: keyboard.focused, focusVisible: keyboard.focusVisible, active: keyboard.isActive,
        qr: keyboard.qr, room: keyboard.qrMinRoom, onTop: keyboard.qrOnTop }));
    await page.locator('.pill').focus();
    await park();
    await page.waitForTimeout(250);

    await publish(page, maxText, Date.now() + 3600000, false, 2);
    const maxMeasure = await measure(page);
    check(tag + ' max-text-fits', maxMeasure.variant === 'online' && maxMeasure.texts.every((x) => x.scrollWidth <= x.clientWidth || x.text.endsWith('\u2026')),
      JSON.stringify(maxMeasure.texts.map((x) => ({ text: x.text, scroll: [x.scrollWidth, x.clientWidth] }))));
    const maxOverlap = noOverlap(maxMeasure);
    check(tag + ' no-overlap max-text vector', maxOverlap.overlaps.length === 0 && maxOverlap.textFits && maxOverlap.headlineAbovePlate,
      JSON.stringify(maxOverlap));

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
