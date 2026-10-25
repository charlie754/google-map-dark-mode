/**
 * Offline checks for the Goat lockup on the in-page panel.
 *
 * These exist so a missing sentence, a vanished gap, or an innerHTML write
 * fails in `npm test` rather than only in the headed Maps run.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const widget = fs.readFileSync(path.join(ROOT, 'extension', 'content', 'widget.js'), 'utf8');
const hoverCssPath = path.join(ROOT, 'extension', 'content', 'brand', 'goat-lockup-hover.css');

const LINE_1 = 'Goat Project - Help fight Cancer, Alzheimer';
const LINE_2 = 'Contribute your idle compute to Earn GOAT.';

test('the panel carries both Goat sentences', () => {
  assert.match(widget, new RegExp(LINE_1.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(widget, /Alzheimer(?:'|\&rsquo;|&#39;)s, Parkinson(?:'|\&rsquo;|&#39;)s, COVID-19, Dengue, Hepatitis C etc\./);
  assert.match(widget, new RegExp(LINE_2.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(widget, /idle computer/);
});

test('the sentences sit above the lockup, and the lockup sits after StarGithub', () => {
  const htmlStart = widget.indexOf('const HTML');
  assert.ok(htmlStart > 0, 'widget markup constant is missing');
  const html = widget.slice(htmlStart);
  const star = html.indexOf('Star Project on Github');
  const line1 = html.indexOf(LINE_1);
  const line2 = html.indexOf(LINE_2);
  const mark = html.indexOf('goat-lockup');
  assert.ok(star > 0, 'StarGithub label is missing from the markup');
  assert.ok(line1 > star, 'sentence 1 must follow StarGithub in the markup');
  assert.ok(line2 > line1, 'sentence 2 must follow sentence 1');
  assert.ok(mark > line2, 'the lockup must follow both sentences');
});

test('the panel leaves space between StarGithub and the banner', () => {
  const gap = widget.match(/\.goat\s*\{[^}]*margin-top:\s*(\d+)px/);
  assert.ok(gap, '.goat must set margin-top in pixels');
  assert.ok(Number(gap[1]) >= 16, `.goat margin-top is ${gap[1]}px; need at least 16px`);
});

test('the lockup is the hover component from brand/lockup-hover, not the looping SVG', () => {
  assert.ok(fs.existsSync(hoverCssPath), 'extension/content/brand/goat-lockup-hover.css is missing');
  const css = fs.readFileSync(hoverCssPath, 'utf8');
  assert.match(css, /\.goat-lockup:hover \.gl-thumb/);
  assert.match(css, /\.gl-char/);
  assert.match(widget, /goat-lockup:hover/);
  assert.match(widget, /class="goat-lockup"/);
  assert.match(widget, /class="gl-char"/);
  assert.doesNotMatch(widget, /gl-strokes/);
  assert.doesNotMatch(widget, /const GOAT_SVG/);
  assert.doesNotMatch(widget, /goat-lockup-loop\.svg/);
  const embedded = widget.match(/const GOAT_LOCKUP_CSS = ("(?:\\.|[^"\\])*")/);
  assert.ok(embedded, 'GOAT_LOCKUP_CSS string is missing');
  assert.equal(JSON.parse(embedded[1]), css, 'inlined hover CSS drifted from goat-lockup-hover.css');
});

test('lockup motion is hover-gated: meteors stay invisible until :hover', () => {
  assert.match(widget, /\.goat-lockup__meteors\s*\{[^}]*opacity:\s*0/);
  assert.match(widget, /\.goat-lockup:hover \.goat-lockup__meteors/);
  assert.doesNotMatch(widget, /\.goat:hover \.goat-lockup__meteors/);
});

test('the lockup enlarges on hover like Ko-fi and GitHub', () => {
  assert.match(widget, /\.shell\.is-open \.goat-lockup:hover[\s\S]{0,80}transform: scale\(1\.05\)/);
  assert.match(widget, /\.shell\.is-open \.goat-lockup:active[\s\S]{0,80}transform: scale\(0\.96\)/);
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

test('the banner opens the Goat site and is not assigned via innerHTML', () => {
  assert.match(widget, /const GOAT_URL = 'https:\/\/dagoat\.io'/);
  assert.match(widget, /<a class="goat-lockup" href="'\s*\+\s*GOAT_URL/);
  assert.match(widget, /<div class="goat">/);
  assert.doesNotMatch(widget, /<a class="goat"/);
  assert.doesNotMatch(widget, /\.innerHTML\s*=/);
  const html = widget.slice(widget.indexOf('const HTML'));
  const copy = html.indexOf('goat__copy');
  const lockupA = html.indexOf('<a class="goat-lockup"');
  const copyEnd = html.indexOf('</div>', copy);
  assert.ok(copy > 0 && lockupA > copyEnd, 'sentences must sit outside the lockup <a>');
});

test('the panel lockup shows the People\'s Compute Commons tagline and a 20% smaller stamp', () => {
  assert.match(widget, /--gl-seal-scale:\s*1\.36/);
  assert.match(widget, /--gl-name-min:\s*13px/);
  assert.match(widget, /--gl-tag-min:\s*7px/);
  assert.match(widget, /People(?:'|\&rsquo;|&#39;)s Compute Commons/);
  assert.match(widget, /goat-lockup__name">Goatproject<\/span><span class="goat-lockup__tag"/);
  assert.match(widget, /\.goat \.goat-lockup\s*\{[^}]*flex-wrap:\s*nowrap/);
  assert.match(widget, /\.goat \.goat-lockup__word\s*\{[^}]*align-items:\s*flex-start/);
  assert.match(widget, /\.goat \.goat-lockup__name,\s*\.goat \.goat-lockup__tag\s*\{[^}]*text-indent:\s*0/);
  assert.match(widget, /\.goat \.goat-lockup__tag\s*\{[^}]*white-space:\s*nowrap|\.goat \.goat-lockup__name,\s*\.goat \.goat-lockup__tag\s*\{[^}]*white-space:\s*nowrap/);
  assert.doesNotMatch(widget, /flex:\s*1 0 100%/);
  assert.doesNotMatch(widget, /\.goat \.goat-lockup__tag\s*\{[^}]*display:\s*none/);
});

test('the lockup uses the black plate in Dark Mode and the paper plate when it is off', () => {
  assert.match(widget, /\.goat \.goat-lockup\s*\{[^}]*background:\s*#0b0b0d/);
  assert.match(widget, /\.goat-lockup--paper\s*\{[^}]*background:\s*#f6efe6/);
  assert.match(widget, /classList\.toggle\(\s*['"]goat-lockup--paper['"]/);
  assert.match(widget, /goat-lockup--paper/);
});
