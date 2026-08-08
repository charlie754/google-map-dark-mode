/**
 * Aggregates every trial in data/trials.ndjson into data/summary.json plus a
 * plain-text tally, and re-mines the pre-existing test/artifacts/result-*.json
 * runs for the experiment-ID question.
 *
 * Nothing here touches the network.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(HERE, 'data');
const ARTIFACTS = path.resolve(HERE, '..', '..', 'artifacts');

/** Variants whose browser config is stock Chromium at the stock Maps URL. */
const STOCK_CHROMIUM = new Set([
  'chromium-headed',
  'shot-baseline',
  'shot-legend-dark',
  'shot-proto-dark-only',
  'shot-stream-only',
  'shot-legend-dark-plus-proto',
]);

const lines = fs
  .readFileSync(path.join(DATA, 'trials.ndjson'), 'utf8')
  .trim()
  .split('\n')
  .map((l) => JSON.parse(l));

const byVariant = {};
for (const t of lines) {
  const v = (byVariant[t.variant] ??= { trials: 0, arms: {}, modules: {}, wasm: {}, pixels: [] });
  v.trials++;
  v.arms[t.arm] = (v.arms[t.arm] ?? 0) + 1;
  const mk = (t.rendererModules ?? []).join('|') || '(not recorded)';
  v.modules[mk] = (v.modules[mk] ?? 0) + 1;
  const wk = (t.wasmModules ?? []).join('|') || '(none)';
  v.wasm[wk] = (v.wasm[wk] ?? 0) + 1;
  if (t.pixels) v.pixels.push({ r: t.pixels.r, g: t.pixels.g, b: t.pixels.b, dark: t.pixels.isDark });
  if (t.passes) {
    v.passSequences ??= [];
    v.passSequences.push(t.passes.map((p) => p.arm).join(' -> '));
  }
}

/* Stock-Chromium natural assignment rate. Every navigation counts, including the
   repeats inside the stickiness profiles. */
let stockNav = 0;
let stockRaster = 0;
const stockDetail = [];
for (const t of lines) {
  if (STOCK_CHROMIUM.has(t.variant)) {
    stockNav++;
    if (t.arm !== 'proto') stockRaster++;
    stockDetail.push(`${t.variant} ${t.arm}`);
  } else if (t.variant === 'sticky-4') {
    for (const p of t.passes ?? []) {
      stockNav++;
      if (p.arm !== 'proto') stockRaster++;
      stockDetail.push(`sticky-4/pass ${p.arm}`);
    }
  }
}

/* Experiment IDs: do the two arms differ? */
const expByArm = { proto: new Map(), raster: new Map() };
for (const t of lines) {
  const bucket = t.arm === 'proto' ? 'proto' : 'raster';
  for (const id of t.experimentIds ?? []) {
    expByArm[bucket].set(id, (expByArm[bucket].get(id) ?? 0) + 1);
  }
}
const armTrialCount = { proto: 0, raster: 0 };
for (const t of lines) armTrialCount[t.arm === 'proto' ? 'proto' : 'raster']++;

const allIds = new Set([...expByArm.proto.keys(), ...expByArm.raster.keys()]);
const expTable = [...allIds]
  .sort((a, b) => a - b)
  .map((id) => ({
    id,
    protoSeen: expByArm.proto.get(id) ?? 0,
    protoOf: armTrialCount.proto,
    rasterSeen: expByArm.raster.get(id) ?? 0,
    rasterOf: armTrialCount.raster,
  }));
const armExclusive = expTable.filter(
  (e) => (e.protoSeen === e.protoOf && e.rasterSeen === 0) || (e.rasterSeen === e.rasterOf && e.protoSeen === 0),
);

/* The five pre-existing gate artifacts. */
const artifacts = [];
for (const f of fs.existsSync(ARTIFACTS) ? fs.readdirSync(ARTIFACTS) : []) {
  if (!f.startsWith('result-') || !f.endsWith('.json')) continue;
  const j = JSON.parse(fs.readFileSync(path.join(ARTIFACTS, f), 'utf8'));
  const rl = j.requestLog ?? [];
  const ids = new Set();
  for (const r of rl) for (const m of (r.originalUrl ?? r.url).matchAll(/!23i(\d+)/g)) ids.add(Number(m[1]));
  artifacts.push({
    file: f,
    browser: j.browserName,
    raster: rl.filter((r) => r.kind === 'raster').length,
    proto: rl.filter((r) => r.kind === 'proto').length,
    arm: rl.some((r) => r.kind === 'proto') ? 'proto' : 'raster',
    gEp: (j.finalPageUrl ?? '').match(/g_ep=([^&]+)/)?.[1] ?? null,
    experimentIds: [...ids].sort((a, b) => a - b),
  });
}
const artifactIdSets = new Set(artifacts.map((a) => a.experimentIds.join(',')));

const summary = {
  generatedAt: new Date().toISOString(),
  totalTrials: lines.length,
  byVariant,
  stockChromium: { navigations: stockNav, nonProto: stockRaster, rate: +(stockRaster / stockNav).toFixed(4), stockDetail },
  experimentIds: { armExclusive, table: expTable },
  preExistingArtifacts: artifacts,
  preExistingArtifactsShareOneExperimentIdSet: artifactIdSets.size === 1,
};

fs.writeFileSync(path.join(DATA, 'summary.json'), JSON.stringify(summary, null, 1));

const out = [];
out.push('LANE E -- transport-arm trial tally');
out.push(`generated ${summary.generatedAt}`);
out.push(`total trials: ${lines.length}`);
out.push('');
out.push('variant                          n   arms                          renderer modules            wasm');
for (const [k, v] of Object.entries(byVariant)) {
  out.push(
    `${k.padEnd(32)} ${String(v.trials).padStart(2)}  ${JSON.stringify(v.arms).padEnd(28)}  ${Object.keys(v.modules)
      .join(' ')
      .padEnd(26)}  ${Object.keys(v.wasm).join(' ')}`,
  );
  if (v.passSequences) for (const s of v.passSequences) out.push(`${''.padEnd(35)}sticky: ${s}`);
  if (v.pixels.length) for (const p of v.pixels) out.push(`${''.padEnd(35)}px rgb(${p.r},${p.g},${p.b}) dark=${p.dark}`);
}
out.push('');
out.push(
  `stock-Chromium navigations: ${stockNav}, non-proto: ${stockRaster} (${(summary.stockChromium.rate * 100).toFixed(1)}%)`,
);
out.push(`experiment IDs exclusive to one arm: ${armExclusive.length}`);
out.push(`pre-existing gate artifacts all share one experiment-ID set: ${summary.preExistingArtifactsShareOneExperimentIdSet}`);
for (const a of artifacts) out.push(`  ${a.file.padEnd(32)} ${a.browser.padEnd(9)} arm=${a.arm} raster=${a.raster} proto=${a.proto}`);
fs.writeFileSync(path.join(DATA, 'tally.txt'), out.join('\n') + '\n');
console.log(out.join('\n'));
