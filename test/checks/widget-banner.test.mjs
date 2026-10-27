/**
 * Offline checks for the GOAT Cam banner (v2) on the in-page panel.
 *
 * These exist so a lost sentence, a vanished gap, a lost QR code or photo, a
 * missing QR zoom, a stray remote URL, a resurrected piece of the old lockup,
 * or an innerHTML write fails in `npm test` rather than only in the headed
 * Maps run.
 *
 * The banner is a copy of the v2 master in the GOAT Cam repository
 * (brand/goatcam-banner: goatcam-banner.css + goatcam-banner.html, 2026-10-26).
 * The SHA-256 pins below are of that master. If the master changes, copy it
 * again and update the pins -- never edit the banner here by hand.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const widget = fs.readFileSync(path.join(ROOT, 'extension', 'content', 'widget.js'), 'utf8');
const brandDir = path.join(ROOT, 'extension', 'content', 'brand');
const bannerCssPath = path.join(brandDir, 'goatcam-banner.css');

const GOATCAM_URL = 'https://goatcam.dagoat.io';
const LINE_1 = 'GOAT Cam &mdash; your iPhone, <em>NOW</em> your PC&rsquo;s webcam.';

/* SHA-256 of the v2 master's pieces. */
const SHA_FRAGMENT = 'aeaccb3cf0003d9805f0d34ac2d50e5ad71060733aeb77730571cf71d18bf456'; // goatcam-banner.html markup, 35,579 B
const SHA_QR_PATH = '5970ff43d0c4b0467b1f09638833db96f3e6a5d2c56e8428584dbb179b53667f'; // assets/app-store-qr.svg path d (unchanged since v1)
const SHA_PHOTO_URI = '7f7c0c0815742343f438082b56359aef58d30ac72fd8894bbf8d8a163b3d6bf3'; // base64 of site/public/assets/hero-coffee-800.webp (21,038 B)
const SHA_CSS_RULES = '4a3a6b3db969f6723100d5f524350136cf698416800338b4c3b71943be66cd76'; // goatcam-banner.css, comments and whitespace removed

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The banner markup exactly as the browser will receive it: every quoted
 * literal from `<div class="goat ...">` to the `</div>` that closes it, joined,
 * with GOAT_URL substituted. Any other identifier in that span is an error --
 * Game Optimizer's generator reads this same span and silently drops names it
 * does not know, so a constant introduced here would vanish from its copy.
 */
function bannerMarkup(source) {
  const url = /const GOAT_URL = '([^']*)';/.exec(source);
  assert.ok(url, 'GOAT_URL is missing');
  const start = source.indexOf("'<div class=\"goat ");
  assert.ok(start > 0, 'the <div class="goat ..."> literal is missing');
  const mark = source.indexOf('data-goat-mark', start);
  assert.ok(mark > start, 'the plate anchor (data-goat-mark) is missing');
  const close = "'</div>' +";
  const end = source.indexOf(close, mark);
  assert.ok(end > mark, 'the literal that closes .goat is missing');
  const span = source.slice(start, end + close.length - 1);
  let out = '';
  let i = 0;
  while (i < span.length) {
    const c = span[i];
    if (c === "'") {
      const j = span.indexOf("'", i + 1);
      const lit = span.slice(i + 1, j);
      assert.ok(!lit.includes('\\'), 'banner literals must not carry escapes');
      out += lit;
      i = j + 1;
    } else if (/[A-Za-z_]/.test(c)) {
      const name = /^[A-Za-z_][A-Za-z0-9_]*/.exec(span.slice(i))[0];
      assert.equal(name, 'GOAT_URL', `unexpected identifier ${name} inside the banner markup`);
      out += url[1];
      i += name.length;
    } else {
      assert.ok(/[\s+]/.test(c), `unexpected character ${JSON.stringify(c)} between banner literals`);
      i++;
    }
  }
  return out;
}

const bannerCss = () => fs.readFileSync(bannerCssPath, 'utf8');

/* ---- reusable checks, each with a mutation control below ---- */

function checkAssets(markup) {
  const qr = /<span class="gc-qr"><svg viewBox="0 0 37 37" shape-rendering="crispEdges" role="img" aria-label="QR code that opens GOAT Cam on the App Store"[^>]*>[\s\S]*?<path fill="#1c130c" d="([^"]+)"\/><\/svg><\/span>/.exec(markup);
  assert.ok(qr, 'the App Store QR svg (viewBox 0 0 37 37) is missing');
  assert.equal(sha256(qr[1]), SHA_QR_PATH, 'the QR matrix differs from the master -- never re-encode it');
  const photo = /<img class="gc-photo__img" src="(data:image\/webp;base64,[A-Za-z0-9+/=]+)" alt="" width="800" height="498"/.exec(markup);
  assert.ok(photo, 'the site hero photo (800x498 data:image/webp) is missing');
  assert.equal(sha256(photo[1]), SHA_PHOTO_URI, 'the photo is not the site hero (hero-coffee-800.webp)');
}

function checkQrZoom(css) {
  // 72 css px at rest, x2.2223 = 160 css px on hover / keyboard focus, in the panel variant
  assert.match(css, /\n\.goat \{[^}]*--gc-qr: 72px;[^}]*--gc-qr-zoom: 2\.2223;/, 'panel QR must rest at 72px and zoom x2.2223 (160px)');
  assert.match(css, /\.gc-qr:hover, \.goat-lockup:focus-visible \.gc-qr \{[^}]*scale: var\(--gc-qr-zoom\);/, 'the QR zoom rule is missing');
  assert.match(css, /\.gc-qr \{[^}]*z-index: 3;/, 'the QR must sit above the photo and the wordmark');
  assert.match(css, /\.goat--panel \.gc-qr \{[^}]*--gc-qr-origin: 100% 100%;/, 'the panel QR must grow up and left');
  assert.doesNotMatch(css, /\.goat--panel[^{]*\{[^}]*--gc-qr-zoom: 1;/, 'the panel QR zoom is switched off');
}

function checkUrls(markup, css) {
  for (const [label, text] of [['markup', markup], ['CSS', css]]) {
    // The SVG namespace is an identifier, never fetched; it is the only other
    // http string the master carries.
    const rest = text.replaceAll('xmlns="http://www.w3.org/2000/svg"', '');
    const urls = rest.match(/https?:\/\/[^\s"'<>)]*/gi) || [];
    for (const u of urls) {
      assert.equal(u, GOATCAM_URL, `banner ${label} carries a URL other than ${GOATCAM_URL}: ${u}`);
    }
    assert.doesNotMatch(rest, /\burl\(|@import|src="(?!data:)/i, `banner ${label} can load a resource`);
  }
}

/** Neither the Goat Project banner nor the v1 lockup may come back. */
function checkRemnantsGone(text) {
  assert.doesNotMatch(text, /(?<!goatcam\.)dagoat\.io/i, 'bare dagoat.io is still present');
  assert.doesNotMatch(text, /Help fight Cancer|Earn GOAT|Goatproject|Compute Commons/i, 'Goat Project copy');
  assert.doesNotMatch(text, /Free Windows|goat__line--ask|Scan for the iPhone app/i, 'the removed ask line');
  assert.doesNotMatch(text, /\bgl-[a-z]|goat-lockup__(?:mark|svg|meteors)|meteor/i, 'the removed DaGoat lockup (mark, seal, spark, meteors)');
  assert.doesNotMatch(text, /gc-qr__(?:tile|cap)|gc-osd__(?:t|sep)\b/, 'v1 QR wrapper, caption or two-line OSD');
}

/* ---- the copy and its place in the panel ---- */

test('the panel carries the one GOAT Cam sentence, and no ask line', () => {
  assert.match(widget, new RegExp(esc(LINE_1)));
  const markup = bannerMarkup(widget);
  assert.equal((markup.match(/class="goat__line/g) || []).length, 1, 'v2 has exactly one copy line');
  assert.doesNotMatch(markup, /micro\s*phone|\bmic\b|\$\s*\d|\bprice\b|\bUSD\b/i,
    'v1 is camera-only and the banner carries no price');
});

test('the sentence sits above the plate, and the plate sits after StarGithub', () => {
  const htmlStart = widget.indexOf('const HTML');
  assert.ok(htmlStart > 0, 'widget markup constant is missing');
  const html = widget.slice(htmlStart);
  const star = html.indexOf('Star Project on Github');
  const line1 = html.indexOf(LINE_1);
  const plate = html.indexOf('goat-lockup');
  assert.ok(star > 0, 'StarGithub label is missing from the markup');
  assert.ok(line1 > star, 'the sentence must follow StarGithub in the markup');
  assert.ok(plate > line1, 'the plate must follow the sentence');
});

test('the panel leaves space between StarGithub and the banner', () => {
  // .body__pad .goat, not .goat: the master's .goat { margin: 0 } comes later
  // in the cascade, so a one-class host rule would lose to it.
  const gap = widget.match(/\.body__pad \.goat\s*\{[^}]*margin-top:\s*(\d+)px/);
  assert.ok(gap, '.body__pad .goat must set margin-top in pixels');
  assert.ok(Number(gap[1]) >= 16, `.goat margin-top is ${gap[1]}px; need at least 16px`);
  assert.match(bannerCss(), /\n\.goat \{[^}]*margin: 0;/, 'the master .goat rule is expected to zero margin');
});

/* ---- the master, copied rather than retyped ---- */

test('the banner markup is the v2 master fragment, with only the lift gate added', () => {
  const markup = bannerMarkup(widget);
  assert.ok(markup.startsWith('<div class="goat goat--panel goat--gated"><div class="goat__copy">'));
  const asMaster = markup.replace('<div class="goat goat--panel goat--gated">', '<div class="goat goat--panel">');
  assert.equal(sha256(asMaster), SHA_FRAGMENT, 'banner markup drifted from goatcam-banner.html');
});

test('the banner sheet is the v2 master sheet, embedded byte-for-byte', () => {
  assert.ok(fs.existsSync(bannerCssPath), 'extension/content/brand/goatcam-banner.css is missing');
  const css = bannerCss();
  assert.equal(sha256(css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, '')), SHA_CSS_RULES,
    'goatcam-banner.css rules drifted from the master');
  assert.doesNotMatch(css.slice(css.indexOf('*/') + 2), /\/\*/, 'embed the sheet comment-stripped');
  const embedded = widget.match(/const GOAT_LOCKUP_CSS = ("(?:\\.|[^"\\])*")/);
  assert.ok(embedded, 'GOAT_LOCKUP_CSS string is missing');
  assert.equal(JSON.parse(embedded[1]), css, 'inlined banner CSS drifted from goatcam-banner.css');
  assert.match(css, /\.goat-lockup:is\(:hover, :focus-visible, \.is-active\) \.gc-photo__frame \{ transform: scale\(1\.06\)/);
  assert.match(widget, /class="goat-lockup"/);
  assert.doesNotMatch(widget, /const GOAT_SVG/);
  assert.doesNotMatch(widget, /goat-lockup-loop\.svg/);
});

test('the banner carries the App Store QR and the site hero photo, verbatim', () => {
  checkAssets(bannerMarkup(widget));
});

test('the QR enlarges to 160px on hover and keyboard focus', () => {
  checkQrZoom(bannerCss());
});

test('the banner names no remote resource other than goatcam.dagoat.io', () => {
  checkUrls(bannerMarkup(widget), bannerCss());
});

test('nothing of the Goat Project banner or the v1 lockup remains', () => {
  checkRemnantsGone(widget);
  checkRemnantsGone(bannerCss());
});

test('the Game Optimizer QR bridge is not shipped in the extension', () => {
  // goatcam-qr-bridge.js is for Game Optimizer's WebView2 strip only.
  assert.deepEqual(fs.readdirSync(brandDir), ['goatcam-banner.css']);
  assert.doesNotMatch(widget, /goatcamQrBridge|chrome\.webview/);
});

test('mutation controls: each banner check fails on the defect it names', () => {
  const markup = bannerMarkup(widget);
  const css = bannerCss();
  const mustFail = (fn, why) => assert.throws(fn, assert.AssertionError, `control passed: ${why}`);
  mustFail(() => checkAssets(markup.replace('viewBox="0 0 37 37"', 'viewBox="0 0 33 33"')), 'QR svg removed');
  mustFail(() => checkAssets(markup.replace('M4 4h1v1h-1z', 'M4 4h2v1h-2z')), 'QR re-encoded');
  mustFail(() => checkAssets(markup.replace('data:image/webp;base64,', 'data:image/png;base64,')), 'photo removed');
  mustFail(() => checkAssets(markup.replace(/(base64,)UklGR/, '$1UklGQ')), 'photo swapped for another image');
  mustFail(() => checkQrZoom(css.replace('--gc-qr-zoom: 2.2223;', '--gc-qr-zoom: 1;')), 'QR zoom disabled');
  mustFail(() => checkQrZoom(css.replace('scale: var(--gc-qr-zoom);', '')), 'QR zoom rule removed');
  mustFail(() => checkQrZoom(css + '\n.goat--panel .goat-lockup { --gc-qr-zoom: 1; }'), 'panel zoom overridden');
  mustFail(() => checkUrls(markup.replace('<em>NOW</em>', '<em>NOW</em> https://dagoat.io'), css), 'foreign URL in markup');
  mustFail(() => checkUrls(markup, css + '\n.x { background: url(https://example.com/a.png); }'), 'remote url() in CSS');
  mustFail(() => checkUrls(markup.replace('src="data:', 'src="//cdn.example/x.webp" data-x="'), css), 'non-data src');
  mustFail(() => checkRemnantsGone(markup + ' https://dagoat.io'), 'bare dagoat.io');
  mustFail(() => checkRemnantsGone(markup + ' Help fight Cancer'), 'old line 1');
  mustFail(() => checkRemnantsGone(markup + ' GOATPROJECT'), 'old wordmark');
  mustFail(() => checkRemnantsGone(markup + '<span class="goat__line goat__line--ask">Free Windows 11 app</span>'), 'ask line back');
  mustFail(() => checkRemnantsGone(markup + '<g class="gl-head"></g>'), 'goat mark back');
  mustFail(() => checkRemnantsGone(css + '\n.goat-lockup__meteors i { left: 1%; }'), 'meteor rules back');
  mustFail(() => checkRemnantsGone(markup + '<span class="gc-qr__tile"></span>'), 'v1 QR wrapper back');
  assert.doesNotThrow(() => checkRemnantsGone('open https://goatcam.dagoat.io'), 'goatcam.dagoat.io is the new host');
});

/* ---- motion and lift ---- */

test('motion is gated on the plate: the steam loop is paused at rest', () => {
  const css = bannerCss();
  assert.match(css, /animation: gc-steam [^;]*infinite paused;/);
  assert.match(css, /\.goat-lockup:is\(:hover, :focus-visible, \.is-active\) \.gc-steam path \{ animation-play-state: running; \}/);
  assert.match(css, /\.gc-steam \{[^}]*opacity: 0;/);
  assert.doesNotMatch(css, /\.goat:hover \.gc-/);
  // keyboard focus plays it too: the plate takes .is-active on focusin
  assert.match(widget, /lockup\.addEventListener\('focusin', function \(\) \{ lockup\.classList\.add\('is-active'\)/);
});

test('the plate lifts on hover only while the panel is open', () => {
  assert.match(widget, /<div class="goat goat--panel goat--gated">/);
  assert.match(widget, /\.shell\.is-open \.goat--gated \.goat-lockup:hover \{[^}]*transform: var\(--gc-lift\)/);
  assert.match(widget, /\.shell\.is-open \.goat--gated \.goat-lockup:active \{ transform: var\(--gc-press\)/);
  const css = bannerCss();
  // v2 lift is the site's own translate: a scaled plate stops the QR decoding at DPR 1
  assert.match(css, /\n\.goat \{[^}]*--gc-lift: translateY\(-2px\);[^}]*--gc-press: scale\(\.98\);/);
  // the master's own lift is ungated; .goat--gated is what hands it to the host
  assert.match(css, /\.goat:not\(\.goat--gated\) \.goat-lockup:hover \{/);
  // reduced motion: the widget's own block pins the plate's transform
  assert.match(widget, /@media \(prefers-reduced-motion: reduce\) \{\s*\n\s*\.shell, [^{]*\.goat, \.goat-lockup,[^{]*\{\s*transition: none !important;\s*transform: none !important;/);
});

test('the switch buttons enlarge on hover, not the whole row', () => {
  assert.match(widget, /\.shell\.is-open \.track:not\(:disabled\):hover \{ transform: scale\(1\.15\)/);
  assert.match(widget, /\.shell\.is-open \.track:not\(:disabled\):active \{ transform: scale\(0\.96\)/);
  assert.doesNotMatch(widget, /\.shell\.is-open \.row:hover \{ transform: scale\(1\.05\)/);
});

test('the Dark Mode pill enlarges on hover only while the panel is open', () => {
  assert.match(widget, /\.shell\.is-open \.pill:hover \{ transform: scale\(1\.05\)/);
  assert.match(widget, /\.shell\.is-open \.pill:active \{ transform: scale\(0\.96\)/);
  assert.doesNotMatch(widget, /^\s*\.pill:hover \{ transform: scale/m);
});

/* ---- link, wordmark, plate ---- */

test('the banner opens goatcam.dagoat.io and is not assigned via innerHTML', () => {
  assert.match(widget, /const GOAT_URL = 'https:\/\/goatcam\.dagoat\.io'/);
  assert.match(widget, /<a class="goat-lockup" href="'\s*\+\s*GOAT_URL/);
  assert.doesNotMatch(widget, /<a class="goat"/);
  assert.doesNotMatch(widget, /\.innerHTML\s*=/);
  assert.match(widget, /new DOMParser\(\)\.parseFromString\(HTML, 'text\/html'\)/);
  const markup = bannerMarkup(widget);
  assert.match(markup, /<a class="goat-lockup" href="https:\/\/goatcam\.dagoat\.io" target="_blank" rel="noopener noreferrer" aria-label="GOAT Cam &mdash; open goatcam\.dagoat\.io" data-goat-mark>/);
  assert.equal((markup.match(/<a /g) || []).length, 1, 'the plate is the only link');
  const html = widget.slice(widget.indexOf('const HTML'));
  const copy = html.indexOf('goat__copy');
  const lockupA = html.indexOf('<a class="goat-lockup"');
  const copyEnd = html.indexOf('</div>', copy);
  assert.ok(copy > 0 && lockupA > copyEnd, 'the sentence must sit outside the plate <a>');
});

test('the plate shows the GOAT Cam wordmark and the App Store tagline on the photo', () => {
  const markup = bannerMarkup(widget);
  assert.match(markup, /<span class="goat-lockup__word"><span class="goat-lockup__name">GOAT Cam<\/span><span class="goat-lockup__tag"><span class="gc-tag__a">iPhone app<\/span><span class="gc-tag__sep">&middot;<\/span><span class="gc-tag__b">On the App Store<\/span><\/span><\/span>/);
  const css = bannerCss();
  assert.match(css, /\.goat \.goat-lockup__word \{[^}]*position: absolute;[^}]*align-items: flex-start/);
  assert.match(css, /\.goat \.goat-lockup__name \{[^}]*white-space: nowrap/);
  assert.match(css, /\.goat \.goat-lockup__tag \{[^}]*white-space: nowrap/);
  assert.match(css, /\.goat \.goat-lockup__tag \{[^}]*text-transform: uppercase/);
  assert.doesNotMatch(css, /\.goat-lockup__tag\s*\{[^}]*display:\s*none/);
});

test('the photo covers the plate in its own clipping layer; the plate clips nothing', () => {
  const css = bannerCss();
  assert.match(css, /--gc-950: #140d08/);
  assert.match(css, /\.goat \.goat-lockup \{[^}]*background: var\(--gc-950\)/);
  assert.match(css, /\.gc-photo \{[^}]*position: absolute; inset: 0;[^}]*overflow: hidden;/);
  assert.doesNotMatch(css.match(/\.goat \.goat-lockup \{[^}]*\}/)[0], /overflow/, 'the plate must not clip the zoomed QR');
  assert.doesNotMatch(widget, /goat-lockup--paper/);
  assert.doesNotMatch(css, /goat-lockup--paper/);
});
