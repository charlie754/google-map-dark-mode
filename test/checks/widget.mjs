/**
 * Live verification for the in-page Dark Mode widget.
 * Run: node verify-widget.mjs
 */
import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const EXT = path.resolve(process.cwd(), 'dist', 'chrome');
const OUT = path.resolve(process.cwd(), 'test', 'artifacts', 'widget');
const MAPS = 'https://www.google.com/maps/@29.7604,-95.3698,12z';

mkdirSync(OUT, { recursive: true });
const profile = mkdtempSync(path.join(tmpdir(), 'gmdm-w-'));
// Chrome caches the SW script across launches; a fresh profile sidesteps it.
const sw = path.join(profile, 'Default', 'Service Worker');
if (existsSync(sw)) rmSync(sw, { recursive: true, force: true });

/*
 * WHY THE PHYSICAL CURSOR IS PARKED
 *
 * This check first ran headed and passed 12/12 in isolation, then failed 5 of
 * those 12 inside `npm run test:full`, with the widget measured at 256x294 --
 * already expanded -- at the collapsed assertion. The widget was not at fault:
 * a headed browser also receives the REAL OS pointer, so wherever the operator
 * happened to leave their mouse decided whether the panel was hovered open. A
 * check whose result depends on that is not a check.
 *
 * Headless would remove the physical pointer entirely and was tried first, but
 * Chromium's headless mode does not load the unpacked extension here -- the
 * content script never runs and the host element is simply absent (measured:
 * 0/3, twice). So the browser must stay headed and the cursor is moved out of
 * the way instead. `no stray pointer at rest` below then asserts the condition
 * outright, so this can never again corrupt other assertions silently.
 */
function parkPhysicalCursor() {
  if (process.platform !== 'win32') return 'skipped (not win32)';
  // -EncodedCommand rather than -Command: the script contains ';', '$' and
  // parentheses, and Node's Windows argv quoting mangled it (the -Command form
  // failed on every run while the identical text pasted into a shell worked).
  // Base64 UTF-16LE has no quoting surface at all.
  const ps = [
    'Add-Type -AssemblyName System.Windows.Forms,System.Drawing',
    '$b=[System.Windows.Forms.Screen]::PrimaryScreen.Bounds',
    '[System.Windows.Forms.Cursor]::Position=New-Object System.Drawing.Point(($b.Right-2),($b.Bottom-2))',
    '[System.Windows.Forms.Cursor]::Position.ToString()',
  ].join('; ');
  try {
    const out = execFileSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(ps, 'utf16le').toString('base64')],
      { timeout: 20000, encoding: 'utf8' },
    );
    return 'parked -> ' + out.trim();
  } catch (e) {
    return 'could not park: ' + (e && e.message ? e.message.split('\n')[0] : e);
  }
}
console.log('physical cursor:', parkPhysicalCursor());

const ctx = await chromium.launchPersistentContext(profile, {
  headless: false,
  viewport: { width: 1366, height: 900 },
  args: [
    `--disable-extensions-except=${EXT}`,
    `--load-extension=${EXT}`,
    '--window-position=0,0',
  ],
});

const results = [];
const ok = (name, pass, detail) => { results.push({ name, pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}\n      ${detail}`); };

try {
  for (let i = 0; i < 40 && ctx.serviceWorkers().length === 0; i++) await new Promise(r => setTimeout(r, 250));
  const worker = ctx.serviceWorkers()[0];
  console.log('service worker:', worker ? worker.url() : 'NONE');

  const page = ctx.pages()[0] || await ctx.newPage();
  await page.goto(MAPS, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(9000);

  const q = (fn, arg) => page.evaluate(fn, arg);

  // ---- 1. exists, collapsed geometry, top-left
  const geom = await q(() => {
    const h = document.getElementById('gmdm-widget-host');
    if (!h) return null;
    const sh = h.shadowRoot.querySelector('.shell');
    const r = sh.getBoundingClientRect();
    return { top: r.top, left: r.left, w: r.width, h: r.height, cs: getComputedStyle(sh).width };
  });
  ok('widget mounts', !!geom, geom ? JSON.stringify(geom) : 'host element absent');

  // Asserted, not assumed: if a real pointer is resting on the widget, every
  // collapsed-state measurement below is meaningless. Fail here rather than
  // reporting five confusing downstream failures.
  const strayHover = await q(() => {
    const h = document.getElementById('gmdm-widget-host');
    return h ? h.shadowRoot.querySelector('.shell').matches(':hover') : false;
  });
  ok('no stray pointer over the widget at rest', !strayHover,
     strayHover ? 'a physical cursor is hovering the widget -- park it and re-run' : 'clear');

  ok('anchored top-left', geom && geom.left < 200 && geom.top < 470,
     geom ? `left=${geom.left.toFixed(0)} top=${geom.top.toFixed(0)}` : 'n/a');
  ok('collapsed is a pill', geom && Math.round(geom.w) === 158,
     geom ? `width=${geom.w.toFixed(1)}px (expect 158)` : 'n/a');

  // The words themselves, not just the element: the requirement is that a user
  // can SEE "Dark Mode" and its state without hovering anything.
  const words = await q(() => {
    const sh = document.getElementById('gmdm-widget-host').shadowRoot;
    const t = sh.querySelector('.pill__title');
    const s = sh.querySelector('[data-state]');
    const shell = sh.querySelector('.shell').getBoundingClientRect();
    const rt = t.getBoundingClientRect();
    const rs = s.getBoundingClientRect();
    const inside = (r) => r.width > 0 && r.right <= shell.right + 0.5 && r.left >= shell.left - 0.5;
    return {
      title: t.textContent.trim(), state: s.textContent.trim(),
      titleVisible: inside(rt), stateVisible: inside(rs),
      titleW: +rt.width.toFixed(1), stateW: +rs.width.toFixed(1),
    };
  });
  ok('collapsed shows the words "Dark Mode" and its state',
     words.title === 'Dark Mode' && /^(On|Off)$/.test(words.state) && words.titleVisible && words.stateVisible,
     JSON.stringify(words));

  // ---- 2. no overlap with Google's own top-left cards
  const overlap = await q(() => {
    const h = document.getElementById('gmdm-widget-host');
    const me = h.shadowRoot.querySelector('.shell').getBoundingClientRect();
    const hit = [];
    for (const el of document.body.querySelectorAll('div, form, header')) {
      if (el === h || el.contains(h)) continue;
      const r = el.getBoundingClientRect();
      if (r.top < 0 || r.top > 420 || r.left < 0 || r.left > 460) continue;
      if (r.width < 180 || r.width > 460 || r.height < 28 || r.height > 320) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none') continue;
      const painted = (cs.backgroundColor && !/rgba\(0, 0, 0, 0\)/.test(cs.backgroundColor)) || cs.boxShadow !== 'none';
      if (!painted) continue;
      const inter = !(me.right < r.left || me.left > r.right || me.bottom < r.top || me.top > r.bottom);
      if (inter) hit.push({ cls: (el.className || '').toString().slice(0, 30), rect: [r.left | 0, r.top | 0, r.width | 0, r.height | 0] });
    }
    return { hit, mine: [me.left | 0, me.top | 0, me.width | 0, me.height | 0] };
  });
  ok('clears Google\'s top-left cards', overlap.hit.length === 0,
     `widget=${JSON.stringify(overlap.mine)} overlaps=${JSON.stringify(overlap.hit)}`);

  await page.screenshot({ path: path.join(OUT, '1-collapsed.png'), clip: { x: 0, y: 0, width: 560, height: 420 } });

  // ---- 3. hover expands, and the expansion is animated (not a jump)
  const box = await q(() => {
    const r = document.getElementById('gmdm-widget-host').getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  await page.mouse.move(box.x, box.y);
  const widths = [];
  for (let i = 0; i < 14; i++) {
    widths.push(await q(() => {
      const sh = document.getElementById('gmdm-widget-host').shadowRoot.querySelector('.shell');
      return +getComputedStyle(sh).width.replace('px', '');
    }));
    await page.waitForTimeout(35);
  }
  await page.waitForTimeout(600);
  const openW = await q(() => +getComputedStyle(document.getElementById('gmdm-widget-host').shadowRoot.querySelector('.shell')).width.replace('px', ''));
  const intermediate = widths.filter(w => w > 50 && w < 265).length;
  ok('hover expands the panel', openW > 250, `open width=${openW}px (expect ~272)`);
  ok('expansion is animated', intermediate >= 3,
     `${intermediate} intermediate widths sampled: ${widths.map(w => w.toFixed(0)).join(',')}`);

  const bodyRows = await q(() => {
    const sh = document.getElementById('gmdm-widget-host').shadowRoot;
    return [...sh.querySelectorAll('.row')].map(r => ({
      key: r.dataset.row,
      op: getComputedStyle(r).opacity,
      label: r.querySelector('.row__label').textContent,
      checked: r.querySelector('.track').getAttribute('aria-checked'),
    }));
  });
  ok('all three switches render and read On', bodyRows.length === 3 && bodyRows.every(r => r.checked === 'true' && +r.op > 0.9),
     JSON.stringify(bodyRows));
  await page.screenshot({ path: path.join(OUT, '2-expanded.png'), clip: { x: 0, y: 0, width: 560, height: 560 } });

  // ---- 4. Ko-fi steam animates on hover
  const kofiBox = await q(() => {
    const h = document.getElementById('gmdm-widget-host');
    const b = h.shadowRoot.querySelector('.kofi').getBoundingClientRect();
    return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
  });
  const steamBefore = await q(() => {
    const sh = document.getElementById('gmdm-widget-host').shadowRoot;
    return [...sh.querySelectorAll('.steam')].map(s => getComputedStyle(s).animationName);
  });
  await page.mouse.move(kofiBox.x, kofiBox.y);
  await page.waitForTimeout(300);
  const steamAfter = await q(() => {
    const sh = document.getElementById('gmdm-widget-host').shadowRoot;
    return [...sh.querySelectorAll('.steam')].map(s => ({
      name: getComputedStyle(s).animationName,
      delay: getComputedStyle(s).animationDelay,
    }));
  });
  ok('steam is idle until hover', steamBefore.every(n => n === 'none'), `before=${JSON.stringify(steamBefore)}`);
  ok('steam animates on hover, staggered',
     steamAfter.every(s => s.name === 'steam') && new Set(steamAfter.map(s => s.delay)).size === 3,
     JSON.stringify(steamAfter));

  const opac = [];
  for (let i = 0; i < 10; i++) {
    opac.push(await q(() => getComputedStyle(document.getElementById('gmdm-widget-host').shadowRoot.querySelector('.steam--a')).opacity));
    await page.waitForTimeout(90);
  }
  ok('steam opacity actually moves', new Set(opac).size >= 4, `samples: ${opac.join(',')}`);
  for (let i = 0; i < 4; i++) {
    await page.screenshot({ path: path.join(OUT, `3-kofi-steam-${i}.png`), clip: { x: 0, y: 0, width: 400, height: 560 } });
    await page.waitForTimeout(160);
  }

  // ---- 4b. the GitHub button: present, width-matched to Ko-fi, and animated
  const gh = await q(() => {
    const sh = document.getElementById('gmdm-widget-host').shadowRoot;
    const g = sh.querySelector('.gh');
    const k = sh.querySelector('.kofi');
    if (!g || !k) return null;
    const rg = g.getBoundingClientRect();
    const rk = k.getBoundingClientRect();
    const cs = (sel) => getComputedStyle(sh.querySelector(sel));
    return {
      label: g.querySelector('.gh__label').textContent.trim(),
      ghW: +rg.width.toFixed(2), kofiW: +rk.width.toFixed(2),
      ghLeft: +rg.left.toFixed(2), kofiLeft: +rk.left.toFixed(2),
      belowKofi: rg.top >= rk.bottom - 1,
      sweep: cs('.gh__sweep').animationName,
      bar: cs('.gh__bar').animationName,
      star: cs('.gh__star svg').animationName,
      glow: cs('.gh__glow').animationName,
    };
  });
  ok('GitHub button sits under Ko-fi', gh && gh.belowKofi, gh ? `ghTop>=kofiBottom = ${gh.belowKofi}, label="${gh.label}"` : 'absent');
  ok('GitHub button width matches Ko-fi',
     gh && Math.abs(gh.ghW - gh.kofiW) < 0.75 && Math.abs(gh.ghLeft - gh.kofiLeft) < 0.75,
     gh ? `gh=${gh.ghW}@${gh.ghLeft} kofi=${gh.kofiW}@${gh.kofiLeft}` : 'absent');
  ok('GitHub button carries all four uiverse animations',
     gh && gh.sweep === 'gh-border-translate' && gh.bar === 'gh-border-scale' &&
     gh.star === 'gh-star-rotate' && gh.glow === 'gh-star-shine',
     gh ? JSON.stringify({ sweep: gh.sweep, bar: gh.bar, star: gh.star, glow: gh.glow }) : 'absent');

  const ghBox = await q(() => {
    const r = document.getElementById('gmdm-widget-host').shadowRoot.querySelector('.gh').getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  const ghRest = await q(() => getComputedStyle(document.getElementById('gmdm-widget-host').shadowRoot.querySelector('.gh__star')).transform);
  await page.mouse.move(ghBox.x, ghBox.y);
  await page.waitForTimeout(450);
  const ghHover = await q(() => getComputedStyle(document.getElementById('gmdm-widget-host').shadowRoot.querySelector('.gh__star')).transform);
  ok('GitHub star reacts to hover', ghRest !== ghHover, `rest=${ghRest} hover=${ghHover}`);
  await page.screenshot({ path: path.join(OUT, '3b-github-hover.png'), clip: { x: 0, y: 0, width: 480, height: 620 } });

  // ---- 5. a switch actually drives the engine
  const before = await worker.evaluate(() => chrome.declarativeNetRequest.getEnabledRulesets());
  await page.mouse.move(box.x, box.y);
  await page.waitForTimeout(400);
  await page.evaluate(() => document.getElementById('gmdm-widget-host').shadowRoot.querySelector('.track[data-key="darkMap"]').click());
  await page.waitForTimeout(1200);
  const after = await worker.evaluate(() => chrome.declarativeNetRequest.getEnabledRulesets());
  const stored = await worker.evaluate(() => chrome.storage.local.get('settings'));
  ok('switch drives the DNR ruleset', before.includes('dark_map') && !after.includes('dark_map'),
     `rulesets ${JSON.stringify(before)} -> ${JSON.stringify(after)}; storage=${JSON.stringify(stored.settings)}`);
  await page.screenshot({ path: path.join(OUT, '4-map-off.png'), clip: { x: 0, y: 0, width: 560, height: 560 } });

  await page.evaluate(() => document.getElementById('gmdm-widget-host').shadowRoot.querySelector('.track[data-key="darkMap"]').click());
  await page.waitForTimeout(1200);
  const restored = await worker.evaluate(() => chrome.declarativeNetRequest.getEnabledRulesets());
  ok('switch restores it', restored.includes('dark_map'), `rulesets=${JSON.stringify(restored)}`);

  // ---- 5b. a search opens Google's results column; we must vacate it
  const beforeMode = await q(() => document.getElementById('gmdm-widget-host').dataset.gmdmPlacement);
  await page.mouse.move(1100, 700); // off the widget so it collapses
  await page.goto('https://www.google.com/maps/search/coffee/@29.7604,-95.3698,13z', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(9000);

  const shifted = await q(() => {
    const h = document.getElementById('gmdm-widget-host');
    if (!h) return null;
    const me = h.shadowRoot.querySelector('.shell').getBoundingClientRect();
    // Google's results column: tall, hard left, painted.
    let panel = null;
    for (const el of document.body.querySelectorAll('div, form, header')) {
      if (el === h || el.contains(h)) continue;
      const r = el.getBoundingClientRect();
      if (r.left > 140 || r.right < 200 || r.right > innerWidth * 0.75) continue;
      if (r.top > 160 || r.height < innerHeight * 0.5) continue;
      if (r.width < 260 || r.width > 560) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none') continue;
      const painted = !/rgba\(0, 0, 0, 0\)/.test(cs.backgroundColor) || cs.boxShadow !== 'none';
      if (!painted) continue;
      if (!panel || r.right > panel.right) panel = { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
    }
    return {
      mode: h.dataset.gmdmPlacement,
      me: [me.left | 0, me.top | 0, me.width | 0, me.height | 0],
      panel: panel ? [panel.left | 0, panel.top | 0, (panel.right - panel.left) | 0, (panel.bottom - panel.top) | 0] : null,
      overlaps: panel ? !(me.right < panel.left || me.left > panel.right || me.bottom < panel.top || me.top > panel.bottom) : false,
    };
  });
  ok('results panel is detected', shifted && shifted.panel !== null,
     shifted ? `panel=${JSON.stringify(shifted.panel)}` : 'widget absent after navigation');
  ok('widget shifts onto the map and clears the results panel',
     shifted && shifted.panel !== null && shifted.mode === 'on-map' && !shifted.overlaps,
     shifted ? `mode=${shifted.mode} widget=${JSON.stringify(shifted.me)} panel=${JSON.stringify(shifted.panel)} overlaps=${shifted.overlaps}` : 'n/a');
  await page.screenshot({ path: path.join(OUT, '6-search-shifted.png'), clip: { x: 0, y: 0, width: 900, height: 500 } });
  console.log(`      placement mode before search = ${beforeMode}`);

  // ---- 6. full window, for the record
  await page.mouse.move(box.x, box.y);
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(OUT, '5-fullwindow.png') });

} finally {
  const fails = results.filter(r => !r.pass);
  console.log(`\n${'-'.repeat(70)}\nWIDGET: ${results.length - fails.length}/${results.length} passed`);
  if (fails.length) console.log('FAILED: ' + fails.map(f => f.name).join(' | '));
  console.log(`shots -> ${OUT}`);
  await ctx.close();
  process.exit(fails.length ? 1 : 0);
}
