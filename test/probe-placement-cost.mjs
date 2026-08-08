/**
 * Cost of the placement scan, and how often the subtree observer makes it run.
 *
 * The observer had to become `subtree: true` to see Maps' dynamically-built
 * panels at all (see widget.js). That fires constantly on Maps, so this
 * measures what the resulting scan actually costs and how often it runs during
 * an ordinary session with gestures and a search.
 */
import { chromium } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const EXT = path.resolve(process.cwd(), 'dist', 'chrome');
const ctx = await chromium.launchPersistentContext(mkdtempSync(path.join(tmpdir(), 'gmdm-perf-')), {
  headless: false,
  viewport: { width: 1366, height: 900 },
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
});

const page = ctx.pages()[0] || (await ctx.newPage());

// Count how often the host's position attributes change -- one write per scan
// that produced a new placement, which is the only work the user can perceive.
await page.addInitScript(() => {
  window.__gmdmPlaceWrites = 0;
  const tick = () => {
    const h = document.getElementById('gmdm-widget-host');
    if (h && !h.__watched) {
      h.__watched = true;
      new MutationObserver(() => { window.__gmdmPlaceWrites++; })
        .observe(h, { attributes: true, attributeFilter: ['style', 'data-gmdm-placement'] });
    }
    requestAnimationFrame(tick);
  };
  tick();
});

await page.goto('https://www.google.com/maps/@29.7604,-95.3698,12z', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(9000);

// The scan itself, timed in-page against the real Maps DOM.
const cost = await page.evaluate(() => {
  const runs = [];
  for (let n = 0; n < 12; n++) {
    const t0 = performance.now();
    const els = document.body.querySelectorAll('div, form, header, button, a');
    let considered = 0;
    for (const el of els) {
      const r = el.getBoundingClientRect();
      if (r.top < 0 || r.top > 420) continue;
      if (r.height < 28 || r.height > 320) continue;
      considered++;
      getComputedStyle(el);
    }
    runs.push({ ms: +(performance.now() - t0).toFixed(2), scanned: els.length, considered });
  }
  runs.sort((a, b) => a.ms - b.ms);
  return { median: runs[6], worst: runs[runs.length - 1], best: runs[0] };
});

const before = await page.evaluate(() => window.__gmdmPlaceWrites);
const t0 = Date.now();
// A busy 20 seconds: pan, zoom, and a search -- the mutation-heaviest things Maps does.
await page.mouse.move(900, 500);
for (let i = 0; i < 3; i++) {
  await page.mouse.down(); await page.mouse.move(700 - i * 40, 420 - i * 30, { steps: 8 }); await page.mouse.up();
  await page.mouse.wheel(0, -240);
  await page.waitForTimeout(1200);
}
const input = await page.evaluate(() => {
  const i = document.querySelector('input[name="q"], input#searchboxinput, input[aria-label*="Search"]');
  const r = i.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
});
await page.mouse.click(input.x, input.y);
await page.keyboard.type('coffee', { delay: 80 });
await page.waitForTimeout(2000);
await page.keyboard.press('Enter');
await page.waitForTimeout(8000);
const elapsed = (Date.now() - t0) / 1000;
const after = await page.evaluate(() => window.__gmdmPlaceWrites);

console.log('\n=== placement scan cost, measured against the live Maps DOM ===');
console.log('  best  ', JSON.stringify(cost.best));
console.log('  median', JSON.stringify(cost.median));
console.log('  worst ', JSON.stringify(cost.worst));
console.log(`\n=== repositions during ${elapsed.toFixed(0)}s of pan + zoom + search ===`);
console.log(`  host position writes: ${after - before}  (~${((after - before) / elapsed).toFixed(2)}/s)`);
console.log(`\n  rate limit is 220ms, so the ceiling is ~4.5 scans/s ~= ${(cost.median.ms * 4.5).toFixed(1)}ms/s of main thread`);

await ctx.close();
