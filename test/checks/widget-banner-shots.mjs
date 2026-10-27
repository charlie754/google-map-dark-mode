/**
 * The GOAT Cam banner (v2), rendered by the REAL built content script, headless.
 *
 * Run:  npm run build && node test/checks/widget-banner-shots.mjs [outDir] [chromium|firefox]
 *
 * firefox injects dist/firefox/content/widget.js into Playwright's headless
 * Firefox (the AMO build's engine) and prefixes its files with firefox-.
 *
 * widget.mjs is the full live check, but it needs live Google Maps, a headed
 * browser and a parked OS cursor (see its header). This one needs none of
 * that: it injects the built widget.js into a local page with a stubbed
 * runtime, opens the panel with Playwright's synthetic pointer (the OS cursor
 * never moves) and checks the banner in place, at DPR 1 and 2: the gap under
 * StarGithub, the plate, photo and QR geometry, that nothing is fetched, the
 * motion states, the QR zoom (size, clipping, stacking; pointer, keyboard and
 * reduced motion), and reduced motion. It saves the screenshots it measured
 * next to a JSON log.
 *
 * Exit code 1 if any check fails.
 */
import { chromium, firefox } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ENGINE = process.argv[3] || 'chromium';
if (ENGINE !== 'chromium' && ENGINE !== 'firefox') {
  console.error('engine must be chromium or firefox');
  process.exit(2);
}
const PREFIX = ENGINE === 'firefox' ? 'firefox-' : '';
const WIDGET = path.join(ROOT, 'dist', ENGINE === 'firefox' ? 'firefox' : 'chrome', 'content', 'widget.js');
const OUT = path.resolve(process.argv[2] || path.join(ROOT, 'test', 'artifacts', 'banner'));
const GOATCAM_URL = 'https://goatcam.dagoat.io';
const QR_ZOOMED_MIN = 150; // SPEC 7.4: >= 150 css px; the master zooms 72 -> 160

if (!fs.existsSync(WIDGET)) {
  console.error(`missing ${WIDGET} -- run npm run build first`);
  process.exit(2);
}
fs.mkdirSync(OUT, { recursive: true });

/* A Maps-dark backdrop (the master's preview uses the same one), so the glass
   panel is judged over what it really sits on. */
const FIXTURE = `<!doctype html><html><head><meta charset="utf-8"><style>
html, body { margin: 0; height: 100%; }
body { background:
  linear-gradient(115deg, transparent 0 46%, #38414e 46% 47.4%, transparent 47.4%),
  linear-gradient(28deg, transparent 0 62%, #2f3948 62% 63%, transparent 63%),
  linear-gradient(170deg, transparent 0 30%, #3c4656 30% 30.8%, transparent 30.8%),
  #242f3e; }
</style></head><body></body></html>`;

function installRuntimeStub() {
  const reply = (msg) => {
    if (msg && msg.type === 'getSettings') return { enabled: true, darkMap: true, darkChrome: true };
    if (msg && msg.type === 'getHealth') return { verdict: 'ok' };
    return null;
  };
  Object.defineProperty(window, 'chrome', {
    configurable: true,
    value: { runtime: { sendMessage(msg, cb) { setTimeout(() => cb && cb(reply(msg)), 0); } } },
  });
}

const results = [];
const ok = (name, pass, detail) => {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}\n      ${detail}`);
};

/** Everything the checks read, from inside the shadow root. */
function measure() {
  const sh = document.getElementById('gmdm-widget-host').shadowRoot;
  const $ = (s) => sh.querySelector(s);
  const box = (b) => ({ x: +b.x.toFixed(2), y: +b.y.toFixed(2), w: +b.width.toFixed(2), h: +b.height.toFixed(2) });
  const r = (el) => (el ? box(el.getBoundingClientRect()) : null);
  const shell = $('.shell'), goat = $('.goat'), plate = $('.goat-lockup'), gh = $('.gh');
  const img = $('.gc-photo__img');
  const qr = $('.gc-qr');
  const qrSvg = qr && qr.querySelector('svg');
  const qb = qr.getBoundingClientRect();
  const anims = sh.getAnimations().filter((a) => a.effect && a.effect.target && goat.contains(a.effect.target));
  const texts = [...goat.querySelectorAll('.goat__line, .goat-lockup__name, .goat-lockup__tag, .gc-osd')]
    .map((el) => ({ cls: el.className, box: r(el) }));
  const gb = goat.getBoundingClientRect();
  const pb = plate.getBoundingClientRect();
  const outside = texts.filter((t) => {
    const inBox = t.cls.startsWith('goat__line') ? gb : pb;
    return t.box.x < inBox.left - 0.5 || t.box.x + t.box.w > inBox.right + 0.5 ||
           t.box.y < inBox.top - 0.5 || t.box.y + t.box.h > inBox.bottom + 0.5;
  });
  const overlapsQr = texts.filter((t) => t.cls !== 'goat__line' &&
    !(t.box.x + t.box.w <= qb.left || t.box.x >= qb.right || t.box.y + t.box.h <= qb.top || t.box.y >= qb.bottom));
  // every ancestor that clips (crossing the shadow boundary), and the QR's room inside each
  const clips = [];
  for (let el = qr.parentElement || qr.getRootNode().host; el; el = el.parentElement || (el.getRootNode().host || null)) {
    const s = getComputedStyle(el);
    if (s.overflowX === 'visible' && s.overflowY === 'visible') continue;
    const a = el.getBoundingClientRect();
    clips.push({
      el: el.className ? String(el.className) : el.tagName,
      overflow: `${s.overflowX}/${s.overflowY}`,
      room: +Math.min(qb.left - a.left, a.right - qb.right, qb.top - a.top, a.bottom - qb.bottom).toFixed(2),
    });
  }
  // what is on top at five points of the QR
  const inset = Math.min(8, qb.width / 4);
  const pts = [[qb.left + qb.width / 2, qb.top + qb.height / 2], [qb.left + inset, qb.top + inset],
    [qb.right - inset, qb.top + inset], [qb.left + inset, qb.bottom - inset], [qb.right - inset, qb.bottom - inset]];
  const onTop = pts.filter(([x, y]) => { const e = sh.elementFromPoint(x, y); return Boolean(e && e.closest && e.closest('.gc-qr')); }).length;
  const cs = (el) => getComputedStyle(el);
  return {
    open: shell.classList.contains('is-open'),
    shell: r(shell), goat: r(goat), plate: r(plate), gh: r(gh),
    gap: +(gb.top - gh.getBoundingClientRect().bottom).toFixed(2),
    qr: box(qb), qrScale: cs(qr).scale, qrViewBox: qrSvg && qrSvg.getAttribute('viewBox'),
    qrClips: clips, qrMinRoom: clips.length ? Math.min(...clips.map((c) => c.room)) : null, qrOnTop: onTop,
    textsOverQr: overlapsQr.map((t) => t.cls),
    photo: r($('.gc-photo')), frameTransform: cs($('.gc-photo__frame')).transform,
    img: { complete: img.complete, naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight, scheme: img.currentSrc.slice(0, 22) },
    copy: [...goat.querySelectorAll('.goat__line')].map((el) => el.textContent),
    name: $('.goat-lockup__name').textContent, tag: $('.goat-lockup__tag').textContent,
    href: plate.getAttribute('href'), target: plate.getAttribute('target'), rel: plate.getAttribute('rel'),
    aria: plate.getAttribute('aria-label'), links: goat.querySelectorAll('a').length,
    removed: goat.querySelectorAll('.goat__line--ask, .goat-lockup__mark, .goat-lockup__meteors, [class^="gl-"], [class*=" gl-"], .gc-qr__tile').length,
    plateBg: cs(plate).backgroundColor, plateTransform: cs(plate).transform, plateOverflow: cs(plate).overflow,
    steamOpacity: cs($('.gc-steam')).opacity, steamDisplay: cs($('.gc-steam')).display,
    plateScroll: [plate.scrollWidth, plate.clientWidth, plate.scrollHeight, plate.clientHeight],
    textsOutside: outside.map((t) => t.cls), textCount: texts.length,
    anims: { total: anims.length, running: anims.filter((a) => a.playState === 'running').length },
    focused: sh.activeElement === plate, focusVisible: plate.matches(':focus-visible'), isActive: plate.classList.contains('is-active'),
    reduced: matchMedia('(prefers-reduced-motion: reduce)').matches,
  };
}

const browser = await (ENGINE === 'firefox' ? firefox : chromium).launch({ headless: true });
const log = { engine: ENGINE, version: browser.version(), widget: path.relative(ROOT, WIDGET), runs: [] };
try {
  for (const dpr of [1, 2]) {
    const ctx = await browser.newContext({ viewport: { width: 600, height: 900 }, deviceScaleFactor: dpr });
    const page = await ctx.newPage();
    const errors = [];
    const requests = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
    page.on('request', (q) => requests.push(q.url()));
    await page.addInitScript(installRuntimeStub);
    await page.setContent(FIXTURE);
    await page.addScriptTag({ content: fs.readFileSync(WIDGET, 'utf8') });
    await page.waitForSelector('#gmdm-widget-host');

    // Open and pin the panel with the synthetic pointer, then park that pointer
    // in the far corner so nothing in the panel is hovered.
    const park = () => page.mouse.move(595, 895);
    await page.locator('.pill').click();
    await park();
    await page.waitForTimeout(1100);

    const run = { dpr, shots: {} };
    const shot = async (name) => {
      const file = `${PREFIX}${name}-dpr${dpr}.png`;
      await page.locator('.shell').screenshot({ path: path.join(OUT, file) });
      run.shots[name] = file;
    };
    const setActive = (on) => page.evaluate((v) => document.getElementById('gmdm-widget-host').shadowRoot
      .querySelector('.goat-lockup').classList.toggle('is-active', v), on);

    run.rest = await page.evaluate(measure);
    await shot('rest');

    await setActive(true);
    await page.waitForTimeout(2000);
    run.active = await page.evaluate(measure);
    await shot('forced-active');
    await setActive(false);
    await page.waitForTimeout(800);
    run.afterActive = await page.evaluate(measure);

    // pointer on the photo (the cup), not on the QR
    await page.locator('.goat-lockup').hover({ position: { x: 60, y: 100 } });
    await page.waitForTimeout(1200);
    run.hover = await page.evaluate(measure);
    await shot('hover-1200ms');
    await park();
    await page.waitForTimeout(800);

    await page.locator('.gc-qr').hover();
    await page.waitForTimeout(400);
    run.qrHover = await page.evaluate(measure);
    await shot('qr-hover-400ms');
    await park();
    await page.waitForTimeout(800);
    run.afterQr = await page.evaluate(measure);

    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.locator('.goat-lockup').hover({ position: { x: 60, y: 100 } });
    await page.waitForTimeout(900);
    run.reducedHover = await page.evaluate(measure);
    await page.locator('.gc-qr').hover();
    await page.waitForTimeout(40);
    run.reducedQr = await page.evaluate(measure);
    await shot('reduced-qr-hover-40ms');
    await park();
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.waitForTimeout(600);

    // keyboard: Tab from the pill to the plate; :focus-visible zooms the QR
    for (let i = 0; i < 12; i++) {
      const at = await page.evaluate(() => {
        const sh = document.getElementById('gmdm-widget-host').shadowRoot;
        return sh.activeElement === sh.querySelector('.goat-lockup');
      });
      if (at) break;
      await page.keyboard.press('Tab');
    }
    await page.waitForTimeout(400);
    run.keyboard = await page.evaluate(measure);
    await shot('keyboard-focus');

    run.errors = errors;
    run.requests = requests;
    log.runs.push(run);
    await ctx.close();
  }
} finally {
  await browser.close();
}

const zoomed = (m) => m.qr.w >= QR_ZOOMED_MIN && m.qr.h >= QR_ZOOMED_MIN;
for (const run of log.runs) {
  const { dpr, rest, active, afterActive, hover, qrHover, afterQr, reducedHover, reducedQr, keyboard } = run;
  const tag = `[${ENGINE} dpr ${dpr}]`;
  ok(`${tag} panel opened with the banner in it`, rest.open && rest.goat && rest.plate, JSON.stringify({ open: rest.open, shell: rest.shell }));
  ok(`${tag} banner sits under StarGithub with a gap >= 16px`, rest.gap >= 16, `gap=${rest.gap}px`);
  ok(`${tag} plate is the only link and opens ${GOATCAM_URL} in a new tab`,
     rest.links === 1 && rest.href === GOATCAM_URL && rest.target === '_blank' && /noopener/.test(rest.rel) && /GOAT Cam/.test(rest.aria),
     JSON.stringify({ links: rest.links, href: rest.href, target: rest.target, rel: rest.rel, aria: rest.aria }));
  ok(`${tag} one copy line, the GOAT Cam headline; no ask line, no DaGoat lockup`,
     rest.copy.length === 1 && rest.copy[0] === 'GOAT Cam — your iPhone, NOW your PC’s webcam.' && rest.removed === 0,
     JSON.stringify({ copy: rest.copy, removedElements: rest.removed }));
  ok(`${tag} wordmark and tagline on the photo`, rest.name === 'GOAT Cam' && rest.tag === 'iPhone app·On the App Store',
     JSON.stringify({ name: rest.name, tag: rest.tag }));
  ok(`${tag} plate 244x136 in a 244x176.38 banner (master's Maps measurement)`,
     Math.abs(rest.plate.w - 244) < 0.01 && Math.abs(rest.plate.h - 136) < 0.01 && Math.abs(rest.goat.w - 244) < 0.01,
     JSON.stringify({ plate: rest.plate, goat: rest.goat }));
  ok(`${tag} site hero photo decoded and covering the plate inside its border`,
     rest.img.complete && rest.img.naturalWidth === 800 && rest.img.naturalHeight === 498 && rest.img.scheme === 'data:image/webp;base64' &&
     Math.abs(rest.photo.w - (rest.plate.w - 2)) < 0.01 && Math.abs(rest.photo.h - (rest.plate.h - 2)) < 0.01,
     JSON.stringify({ img: rest.img, photo: rest.photo }));
  ok(`${tag} QR rests at 72x72 css px with the 37-module matrix, clear of the wordmark`,
     rest.qrViewBox === '0 0 37 37' && Math.abs(rest.qr.w - 72) < 0.01 && Math.abs(rest.qr.h - 72) < 0.01 && rest.textsOverQr.length === 0,
     JSON.stringify({ viewBox: rest.qrViewBox, qr: rest.qr, textsOverQr: rest.textsOverQr }));
  ok(`${tag} nothing overflows the plate; the plate itself clips nothing`,
     rest.plateScroll[0] === rest.plateScroll[1] && rest.plateScroll[2] === rest.plateScroll[3] && rest.textsOutside.length === 0 &&
     rest.plateOverflow === 'visible',
     JSON.stringify({ scroll: rest.plateScroll, textsOutside: `${rest.textsOutside.length} of ${rest.textCount}`, overflow: rest.plateOverflow }));
  ok(`${tag} plate ground is espresso #140d08`, rest.plateBg === 'rgb(20, 13, 8)', rest.plateBg);
  ok(`${tag} at rest: steam hidden, 3 steam loops held paused`,
     +rest.steamOpacity === 0 && rest.anims.total === 3 && rest.anims.running === 0,
     JSON.stringify({ steam: rest.steamOpacity, anims: rest.anims }));
  ok(`${tag} .is-active plays the motion without a pointer, no lift, and stops when removed`,
     +active.steamOpacity === 1 && active.anims.running >= 3 && active.plateTransform === 'none' &&
     /^matrix\(1\.06, 0, 0, 1\.06,/.test(active.frameTransform) && afterActive.anims.running === 0 && +afterActive.steamOpacity === 0,
     JSON.stringify({ active: { steam: active.steamOpacity, anims: active.anims, plate: active.plateTransform, frame: active.frameTransform },
       after: { steam: afterActive.steamOpacity, anims: afterActive.anims } }));
  ok(`${tag} photo hover lifts the plate 2px (panel open), pushes the photo in, leaves the QR alone`,
     hover.plateTransform === 'matrix(1, 0, 0, 1, 0, -2)' && /^matrix\(1\.0[5-6]\d*, 0, 0, 1\.0[5-6]/.test(hover.frameTransform) &&
     Math.abs(hover.qr.w - 72) < 0.01,
     JSON.stringify({ plate: hover.plateTransform, frame: hover.frameTransform, qr: hover.qr }));
  ok(`${tag} QR hover: tile >= ${QR_ZOOMED_MIN}px, not clipped by the panel, on top`,
     zoomed(qrHover) && qrHover.qrMinRoom >= 0 && qrHover.qrClips.length >= 1 && qrHover.qrOnTop === 5,
     JSON.stringify({ qr: qrHover.qr, scale: qrHover.qrScale, clips: qrHover.qrClips, onTop: `${qrHover.qrOnTop}/5` }));
  ok(`${tag} QR returns to 72px after the pointer leaves`, Math.abs(afterQr.qr.w - 72) < 0.01, JSON.stringify(afterQr.qr));
  ok(`${tag} reduced motion: no lift, no steam, nothing running; QR zoom stays and is instant (40ms)`,
     reducedHover.reduced && reducedHover.plateTransform === 'none' && reducedHover.frameTransform === 'none' &&
     reducedHover.steamDisplay === 'none' && reducedHover.anims.running === 0 &&
     zoomed(reducedQr) && reducedQr.qrMinRoom >= 0 && reducedQr.qrOnTop === 5,
     JSON.stringify({ plate: reducedHover.plateTransform, frame: reducedHover.frameTransform, steam: reducedHover.steamDisplay,
       anims: reducedHover.anims, qrAt40ms: reducedQr.qr, room: reducedQr.qrMinRoom }));
  ok(`${tag} keyboard: Tab reaches the plate, :focus-visible zooms the QR, unclipped and on top`,
     keyboard.focused && keyboard.focusVisible && keyboard.isActive && zoomed(keyboard) && keyboard.qrMinRoom >= 0 && keyboard.qrOnTop === 5,
     JSON.stringify({ focused: keyboard.focused, focusVisible: keyboard.focusVisible, isActive: keyboard.isActive, qr: keyboard.qr, room: keyboard.qrMinRoom, onTop: keyboard.qrOnTop }));
  const fetched = run.requests.filter((u) => !u.startsWith('data:') && u !== 'about:blank');
  ok(`${tag} nothing fetched, no page errors`, fetched.length === 0 && run.errors.length === 0,
     JSON.stringify({ fetched, errors: run.errors }));
}

fs.writeFileSync(path.join(OUT, `${PREFIX}banner-shots.json`), JSON.stringify(log, null, 1));
const failed = results.filter((x) => !x.pass).length;
console.log(`\n${ENGINE} ${log.version}: ${results.length - failed} passed, ${failed} failed -- screenshots and ${PREFIX}banner-shots.json in ${OUT}`);
process.exit(failed ? 1 : 0);
