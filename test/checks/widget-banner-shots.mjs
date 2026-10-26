/**
 * The GOAT Cam banner, rendered by the REAL built content script, headless.
 *
 * Run:  npm run build && node test/checks/widget-banner-shots.mjs [outDir] [chromium|firefox]
 *
 * firefox injects dist/firefox/content/widget.js into Playwright's headless
 * Firefox (the AMO build's engine) and prefixes its files with firefox-.
 *
 * widget.mjs is the full live check, but it needs live Google Maps, a headed
 * browser and a parked OS cursor (see its header). This one needs none of
 * that: it injects dist/chrome/content/widget.js into a local page with a
 * stubbed runtime, opens the panel with Playwright's synthetic pointer (the
 * OS cursor never moves) and checks the banner in place, at DPR 1 and 2:
 * the gap under StarGithub, the plate and QR geometry, the decoded photo, that
 * nothing is fetched, the motion states, and reduced motion. It saves the
 * screenshots it measured next to a JSON log.
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
  const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { x: +b.x.toFixed(2), y: +b.y.toFixed(2), w: +b.width.toFixed(2), h: +b.height.toFixed(2) }; };
  const shell = $('.shell'), goat = $('.goat'), plate = $('.goat-lockup'), gh = $('.gh');
  const img = $('.gc-photo__img');
  const qrSvg = $('.gc-qr__tile svg');
  const anims = sh.getAnimations().filter((a) => a.effect && a.effect.target && goat.contains(a.effect.target));
  const texts = [...goat.querySelectorAll('.goat__line, .goat-lockup__name, .goat-lockup__tag, .gc-osd__t')]
    .map((el) => ({ cls: el.className, box: r(el) }));
  const gb = goat.getBoundingClientRect();
  const pb = plate.getBoundingClientRect();
  const outside = texts.filter((t) => {
    const inPlate = t.cls.startsWith('goat__line') ? gb : pb;
    return t.box.x < inPlate.left - 0.5 || t.box.x + t.box.w > inPlate.right + 0.5;
  });
  const cs = (el) => getComputedStyle(el);
  return {
    open: shell.classList.contains('is-open'),
    shell: r(shell), goat: r(goat), plate: r(plate), gh: r(gh),
    gap: +(gb.top - gh.getBoundingClientRect().bottom).toFixed(2),
    qrTile: r($('.gc-qr__tile')), qrViewBox: qrSvg && qrSvg.getAttribute('viewBox'),
    photo: r($('.gc-photo')), mark: r($('.goat-lockup__svg')),
    img: { complete: img.complete, naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight, scheme: img.currentSrc.slice(0, 22) },
    copy: [...goat.querySelectorAll('.goat__line')].map((el) => el.textContent),
    name: $('.goat-lockup__name').textContent, tag: $('.goat-lockup__tag').textContent,
    href: plate.getAttribute('href'), target: plate.getAttribute('target'), rel: plate.getAttribute('rel'),
    aria: plate.getAttribute('aria-label'), links: goat.querySelectorAll('a').length,
    goatClass: goat.className,
    plateBg: cs(plate).backgroundColor, plateTransform: cs(plate).transform,
    meteors: cs($('.goat-lockup__meteors')).opacity, thumb: cs($('.gl-thumb')).opacity,
    face: cs($('.gl-seal-face')).fill, steamDisplay: cs($('.gc-steam')).display,
    plateScroll: [plate.scrollWidth, plate.clientWidth],
    textsOutside: outside.length, textCount: texts.length,
    anims: { total: anims.length, running: anims.filter((a) => a.playState === 'running').length },
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
    await page.locator('.pill').click();
    await page.mouse.move(595, 895);
    await page.waitForTimeout(1100);

    const run = { dpr, shots: {} };
    const shellShot = async (name) => {
      const file = `${PREFIX}${name}-dpr${dpr}.png`;
      await page.locator('.shell').screenshot({ path: path.join(OUT, file) });
      run.shots[name] = file;
    };

    run.rest = await page.evaluate(measure);
    await shellShot('rest');

    await page.evaluate(() => document.getElementById('gmdm-widget-host').shadowRoot.querySelector('.goat-lockup').classList.add('is-active'));
    await page.waitForTimeout(2000);
    run.active = await page.evaluate(measure);
    await shellShot('forced-active');
    await page.evaluate(() => document.getElementById('gmdm-widget-host').shadowRoot.querySelector('.goat-lockup').classList.remove('is-active'));
    await page.waitForTimeout(800);
    run.afterActive = await page.evaluate(measure);

    await page.locator('.goat-lockup').hover();
    await page.waitForTimeout(900);
    run.hover = await page.evaluate(measure);
    await shellShot('hover-900ms');
    await page.waitForTimeout(300); // the master's own hover shots are taken at 1200ms
    await shellShot('hover-1200ms');
    await page.mouse.move(595, 895);
    await page.waitForTimeout(800);

    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.locator('.goat-lockup').hover();
    await page.waitForTimeout(900);
    run.reducedHover = await page.evaluate(measure);
    await shellShot('reduced-hover-900ms');
    await page.mouse.move(595, 895);

    run.errors = errors;
    run.requests = requests;
    log.runs.push(run);
    await ctx.close();
  }
} finally {
  await browser.close();
}

for (const run of log.runs) {
  const { dpr, rest, active, afterActive, hover, reducedHover } = run;
  const tag = `[${ENGINE} dpr ${dpr}]`;
  ok(`${tag} panel opened with the banner in it`, rest.open && rest.goat && rest.plate, JSON.stringify({ open: rest.open, shell: rest.shell }));
  ok(`${tag} banner sits under StarGithub with a gap >= 16px`, rest.gap >= 16, `gap=${rest.gap}px`);
  ok(`${tag} plate is the only link and opens ${GOATCAM_URL} in a new tab`,
     rest.links === 1 && rest.href === GOATCAM_URL && rest.target === '_blank' && /noopener/.test(rest.rel) && /GOAT Cam/.test(rest.aria),
     JSON.stringify({ links: rest.links, href: rest.href, target: rest.target, rel: rest.rel, aria: rest.aria }));
  ok(`${tag} copy lines read the GOAT Cam campaign`,
     rest.copy[0] === 'GOAT Cam — your iPhone, NOW your PC’s webcam.' &&
     rest.copy[1] === 'Free Windows 11 app · USB or Wi‑Fi · Scan for the iPhone app.',
     JSON.stringify(rest.copy));
  ok(`${tag} wordmark and tagline`, rest.name === 'GOAT Cam' && rest.tag === 'iPhone app · On the App Store',
     JSON.stringify({ name: rest.name, tag: rest.tag }));
  ok(`${tag} QR tile is 72x72 css px with the 37-module matrix`,
     rest.qrViewBox === '0 0 37 37' && Math.abs(rest.qrTile.w - 72) < 0.01 && Math.abs(rest.qrTile.h - 72) < 0.01,
     JSON.stringify({ viewBox: rest.qrViewBox, tile: rest.qrTile }));
  ok(`${tag} coffee photo decoded from its data: URI`,
     rest.img.complete && rest.img.naturalWidth === 264 && rest.img.naturalHeight === 222 && rest.img.scheme === 'data:image/webp;base64',
     JSON.stringify(rest.img));
  ok(`${tag} plate fills the panel column without clipping text`,
     rest.plateScroll[0] === rest.plateScroll[1] && rest.textsOutside === 0 && Math.abs(rest.plate.w - rest.goat.w) < 0.01,
     JSON.stringify({ plate: rest.plate, goat: rest.goat, scroll: rest.plateScroll, textsOutside: `${rest.textsOutside} of ${rest.textCount}` }));
  ok(`${tag} plate is espresso #140d08`, rest.plateBg === 'rgb(20, 13, 8)', rest.plateBg);
  ok(`${tag} at rest: meteors hidden, glyph showing, no animation running`,
     +rest.meteors === 0 && +rest.thumb === 0 && rest.anims.running === 0 && rest.anims.total >= 12,
     JSON.stringify({ meteors: rest.meteors, thumb: rest.thumb, anims: rest.anims }));
  ok(`${tag} .is-active plays the lockup without a pointer, and stops when removed`,
     +active.meteors === 1 && +active.thumb === 1 && active.anims.running >= 12 && active.plateTransform === 'none' &&
     afterActive.anims.running === 0 && +afterActive.thumb === 0,
     JSON.stringify({ active: { meteors: active.meteors, thumb: active.thumb, anims: active.anims, transform: active.plateTransform }, after: { thumb: afterActive.thumb, anims: afterActive.anims } }));
  ok(`${tag} hover plays it and lifts the plate 1.05 (panel open)`,
     +hover.meteors > 0.9 && +hover.thumb > 0.9 && /^matrix\(1\.05, 0, 0, 1\.05,/.test(hover.plateTransform),
     JSON.stringify({ meteors: hover.meteors, thumb: hover.thumb, transform: hover.plateTransform, anims: hover.anims }));
  ok(`${tag} reduced motion: cross-fade only, no lift, no steam, nothing running`,
     reducedHover.reduced && +reducedHover.thumb > 0.9 && reducedHover.plateTransform === 'none' &&
     reducedHover.steamDisplay === 'none' && reducedHover.anims.running === 0,
     JSON.stringify({ reduced: reducedHover.reduced, thumb: reducedHover.thumb, transform: reducedHover.plateTransform, steam: reducedHover.steamDisplay, anims: reducedHover.anims }));
  const fetched = run.requests.filter((u) => !u.startsWith('data:') && u !== 'about:blank');
  ok(`${tag} nothing fetched, no page errors`, fetched.length === 0 && run.errors.length === 0,
     JSON.stringify({ fetched, errors: run.errors }));
}

fs.writeFileSync(path.join(OUT, `${PREFIX}banner-shots.json`), JSON.stringify(log, null, 1));
const failed = results.filter((x) => !x.pass).length;
console.log(`\n${ENGINE} ${log.version}: ${results.length - failed} passed, ${failed} failed -- screenshots and ${PREFIX}banner-shots.json in ${OUT}`);
process.exit(failed ? 1 : 0);
