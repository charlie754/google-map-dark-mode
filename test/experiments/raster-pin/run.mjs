#!/usr/bin/env node
/**
 * LANE C runner.  node test/experiments/raster-pin/run.mjs <scenario> [...]
 *
 * Scenarios are run strictly sequentially -- this drives live Google Maps and
 * two headed Chromes at once is both noise and abuse.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  runScenario,
  summaryLine,
  defaultPhases,
  dragPan,
  wheelZoom,
  sleep,
  pageHealth,
} from './harness.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/* --------------------------------------------------------------- scenarios */

export const SCENARIOS = {
  /* --- references ------------------------------------------------------- */
  control: {
    note: 'no intervention at all. Establishes the light baseline and the transport arm this session was assigned.',
    intervention: {},
  },
  'raster-rewrite': {
    note: 'raster style token rewritten to RoadmapDark, nothing blocked. The known-failing baseline: dark at 500ms, light by 1400ms.',
    intervention: { rasterRewrite: true },
  },

  /* --- E1: block the proto transport ------------------------------------ */
  'e1-abort': {
    note: 'E1a. raster rewrite + every /maps/vt/proto request aborted (net::ERR_FAILED).',
    intervention: { rasterRewrite: true, proto: 'abort' },
  },
  'e1-blocked': {
    note: 'E1b. raster rewrite + proto aborted as blockedbyclient (what a DNR block looks like on the wire).',
    intervention: { rasterRewrite: true, proto: 'blocked' },
  },
  'e1-empty200': {
    note: 'E1c. raster rewrite + proto answered with an empty 200.',
    intervention: { rasterRewrite: true, proto: 'empty200' },
  },
  'e1-404': {
    note: 'E1d. raster rewrite + proto answered 404.',
    intervention: { rasterRewrite: true, proto: '404' },
  },
  'e1-abort-noreriwte': {
    note: 'E1 control. proto aborted but NO raster rewrite: isolates "blocking proto keeps the raster layer" from "the raster layer is dark".',
    intervention: { proto: 'abort' },
  },

  /* --- E2: block the WASM renderer -------------------------------------- */
  'e2-wasm-abort': {
    note: 'E2a. raster rewrite + every *.wasm aborted.',
    intervention: { rasterRewrite: true, wasm: 'abort' },
  },
  'e2-wasm-empty200': {
    note: 'E2b. raster rewrite + *.wasm answered with an empty 200 body.',
    intervention: { rasterRewrite: true, wasm: 'empty200' },
  },
  'e2-wasm-js': {
    note: 'E2c. raster rewrite + *.wasm and the /maps/_/wa/ JS modules aborted.',
    intervention: { rasterRewrite: true, wasm: 'abort', mapcoreJs: 'abort' },
  },

  /* --- E3: minimisation, and the capability route ----------------------- */
  'e3-proto-only': {
    note: 'E3. proto blocked, raster rewritten, nothing else touched. The candidate minimal intervention.',
    intervention: { rasterRewrite: true, proto: 'abort' },
  },
  'e3-nowasm-init': {
    note: 'E3. No network blocking at all: WebAssembly removed at document_start so the app never chooses the vector renderer. Raster rewrite only.',
    intervention: { rasterRewrite: true, initScript: 'no-wasm' },
  },
  'e3-nooffscreen-init': {
    note: 'E3. OffscreenCanvas/transferControlToOffscreen removed at document_start; raster rewrite.',
    intervention: { rasterRewrite: true, initScript: 'no-offscreen' },
  },
  'e3-nowebgl-init': {
    note: 'E3. canvas.getContext("webgl*") forced to null at document_start; raster rewrite.',
    intervention: { rasterRewrite: true, initScript: 'no-webgl' },
  },
  'e3-nowasm-block4e1': {
    note: 'E3. WebAssembly removed at document_start (clean bootstrap, full chrome) AND the pb !4e1 vector-data format blocked, so only server-painted !4e0 PNG remains.',
    intervention: { rasterRewrite: true, initScript: 'no-wasm', pb4e1: 'abort', proto: 'abort' },
  },
  'e3-block-both-vectors': {
    note: 'E3. No capability suppression. Block BOTH vector data transports: /maps/vt/proto and pb !4e1. Raster rewrite on.',
    intervention: { rasterRewrite: true, pb4e1: 'abort', proto: 'abort' },
  },
  'e3-nowasm-block4e1-nosw': {
    note: 'E3. Same as e3-nowasm-block4e1 but with service workers blocked, so context.route really does see every tile fetch. Decides whether the light map in that arm was served by Maps’ service worker behind the harness’s back.',
    intervention: { rasterRewrite: true, initScript: 'no-wasm', pb4e1: 'abort', proto: 'abort' },
    serviceWorkers: 'block',
  },
  'e3-nowasm-pin': {
    note: 'E3. no-WASM at document_start (clean bootstrap keeps the chrome) + ALL FOUR vector transports blocked: /maps/vt/stream, pb !4e1, and proto. Only server-painted !4e0 PNG is left. The best hope for dark map AND intact UI.',
    intervention: { rasterRewrite: true, initScript: 'no-wasm', stream: 'abort', pb4e1: 'abort', proto: 'abort' },
    serviceWorkers: 'block',
  },
  'e3-pin-all-vectors': {
    note: 'E3. No capability suppression. Block every vector data transport (stream + pb!4e1 + proto), rewrite !4e0 to RoadmapDark. Arm-agnostic candidate.',
    intervention: { rasterRewrite: true, stream: 'abort', pb4e1: 'abort', proto: 'abort' },
  },
  'diag-nowasm-paintsource': {
    note: 'Diagnostic. no-WASM arm with every vector transport blocked and service workers off, recording EVERY response over 4KB. Answers: what actually paints the complete light map when nothing it asked for arrived?',
    intervention: { rasterRewrite: true, initScript: 'no-wasm', pb4e1: 'abort', proto: 'abort' },
    serviceWorkers: 'block',
    fullCensus: true,
    series: [500, 1400, 3000, 6000],
    phases: () => [{ name: 'settled', gesture: null }],
  },
  'diag-delayed-block': {
    note: 'Diagnostic. Let the app boot untouched for 20s, then start blocking proto + pb!4e1 and rewriting raster. Separates "blocking breaks the chrome" from "blocking during bootstrap breaks the chrome".',
    intervention: { rasterRewrite: true, pb4e1: 'abort', proto: 'abort', delayMs: 20000 },
  },
  'e3-nowasm-init-plain': {
    note: 'E3 control. WebAssembly removed at document_start, NO raster rewrite: shows the chrome cost of the capability suppression on its own.',
    intervention: { initScript: 'no-wasm' },
  },
};

/* Repeatability arms: same intervention, fresh profile, distinct label. */
for (const n of [1, 2, 3]) {
  SCENARIOS[`rep${n}-e1-abort`] = {
    note: `repeat ${n}/3 of the winning intervention in a fresh profile, to rule out an A/B arm coincidence.`,
    intervention: { rasterRewrite: true, proto: 'abort' },
  };
  SCENARIOS[`rep${n}-control`] = {
    note: `paired control ${n}/3, fresh profile, no intervention.`,
    intervention: {},
  };
}

/* --- E4: degradation audit ------------------------------------------------ */

const uiProbe = (page) =>
  page.evaluate(() => {
    const names = [...document.querySelectorAll('[aria-label],[title]')]
      .map((e) => e.getAttribute('aria-label') || e.getAttribute('title'))
      .filter(Boolean);
    return {
      controlNames: [...new Set(names)].slice(0, 60),
      canvases: document.querySelectorAll('canvas').length,
    };
  });

async function clickByName(page, names, log) {
  for (const n of names) {
    const loc = page.locator(`[aria-label="${n}"], button[title="${n}"]`).first();
    if ((await loc.count()) > 0) {
      try {
        await loc.click({ timeout: 5000 });
        log(`clicked control "${n}"`);
        return n;
      } catch (err) {
        log(`click "${n}" failed: ${err.message}`);
      }
    }
  }
  log(`no control matched any of ${JSON.stringify(names)}`);
  return null;
}

function e4Phases() {
  return [
    { name: 'settled', gesture: null, probe: uiProbe },
    { name: 'pan', gesture: (p, a, l) => dragPan(p, a, l) },
    { name: 'zoom-in', gesture: (p, a, l) => wheelZoom(p, a, { direction: 'in', notches: 3 }, l) },
    { name: 'zoom-out', gesture: (p, a, l) => wheelZoom(p, a, { direction: 'out', notches: 3 }, l) },
    {
      name: 'rotate-tilt',
      gesture: async (p, a, l) => {
        await p.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
        await p.keyboard.down('Control');
        await p.mouse.down();
        for (let i = 1; i <= 6; i++) {
          await p.mouse.move(a.x + a.width / 2 + i * 18, a.y + a.height / 2 + i * 6, { steps: 2 });
          await sleep(60);
        }
        await p.mouse.up();
        await p.keyboard.up('Control');
        l('gesture: ctrl+drag (rotate/tilt)');
      },
      probe: (p) => p.evaluate(() => location.href),
    },
    {
      name: 'search',
      gesture: async (p, a, l) => {
        const box = p
          .locator('input[aria-label*="Search"], input#searchboxinput, input[name="q"]')
          .first();
        if ((await box.count()) === 0) {
          l('search box not found');
          return;
        }
        await box.click({ timeout: 8000 });
        await box.fill('coffee');
        await p.keyboard.press('Enter');
        l('gesture: searched "coffee"');
        await sleep(3500);
      },
      probe: (p) =>
        p.evaluate(() => ({
          url: location.href,
          resultsText: (document.body.innerText || '').slice(0, 600),
        })),
    },
    {
      name: 'poi-click',
      gesture: async (p, a, l) => {
        await p.mouse.click(a.x + a.width / 2, a.y + a.height / 2);
        l('gesture: clicked map centre (POI probe)');
        await sleep(2500);
      },
      probe: (p) =>
        p.evaluate(() => ({
          url: location.href,
          panelText: (document.body.innerText || '').slice(0, 400),
        })),
    },
    {
      name: 'directions',
      gesture: async (p, a, l) => {
        await clickByName(p, ['Directions'], l);
        await sleep(2500);
      },
      probe: (p) => p.evaluate(() => ({ url: location.href })),
    },
    {
      name: 'satellite',
      gesture: async (p, a, l) => {
        await clickByName(p, ['Show satellite imagery', 'Show imagery', 'Layers', 'Show street map'], l);
        await sleep(3000);
      },
      probe: (p) => p.evaluate(() => ({ url: location.href })),
    },
    {
      name: 'roadmap-back',
      gesture: async (p, a, l) => {
        await clickByName(p, ['Show street map', 'Show satellite imagery', 'Layers'], l);
        await sleep(3000);
      },
    },
    {
      name: 'pegman',
      gesture: async (p, a, l) => {
        await clickByName(p, ['Drag Pegman onto the map to open Street View', 'Browse Street View images'], l);
        await sleep(3000);
      },
      probe: (p) => p.evaluate(() => ({ url: location.href })),
    },
  ];
}

SCENARIOS['e4-degradation'] = {
  note: 'E4. Full degradation audit under the winning intervention.',
  intervention: { rasterRewrite: true, proto: 'abort' },
  phases: e4Phases,
  series: [500, 1400, 3000, 6000],
};
SCENARIOS['e4-baseline'] = {
  note: 'E4 control. Same audit with NO intervention, so "broken" can be told apart from "Maps is like that".',
  intervention: {},
  phases: e4Phases,
  series: [500, 1400, 3000, 6000],
};

/* -------------------------------------------------------------------- main */

const argv = process.argv.slice(2);
if (argv.length === 0) {
  console.log('scenarios:');
  for (const [k, v] of Object.entries(SCENARIOS)) console.log(`  ${k.padEnd(22)} ${v.note}`);
  process.exit(1);
}

const results = [];
for (const name of argv) {
  const s = SCENARIOS[name];
  if (!s) {
    console.error(`unknown scenario "${name}". Run with no args to list.`);
    process.exit(2);
  }
  console.log('\n' + '#'.repeat(96));
  console.log(`### ${name}  --  ${s.note}`);
  console.log('#'.repeat(96) + '\n');
  const res = await runScenario({
    label: name,
    note: s.note,
    intervention: s.intervention,
    extensionDir: s.extensionDir ? path.resolve(HERE, s.extensionDir) : null,
    serviceWorkers: s.serviceWorkers ?? null,
    fullCensus: s.fullCensus ?? false,
    phases: (s.phases ?? defaultPhases)(),
    ...(s.series ? { series: s.series } : {}),
  });
  results.push(res);
}

console.log('\n' + '='.repeat(96));
console.log('LANE C SUMMARY');
console.log('='.repeat(96));
for (const r of results) console.log(summaryLine(r) + '\n');
