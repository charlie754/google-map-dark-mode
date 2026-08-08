#!/usr/bin/env node
/**
 * LANE D orchestrator.
 *
 *   node test/experiments/firefox-load/run.mjs ext                 # one extension run
 *   node test/experiments/firefox-load/run.mjs control             # one control run
 *   node test/experiments/firefox-load/run.mjs ext ext ext control # the full set
 *
 * Runs are strictly sequential -- this drives a live third-party site and there
 * is no reason to hammer it. Each run gets a fresh profile and its own RDP port.
 */

import fs from 'node:fs';
import path from 'node:path';
import { runFirefoxGate, ARTIFACTS, SHIPPED_EXT_DIR, VARIANT_EXT_DIR, BLOCK_EXT_DIR } from './gate-run.mjs';
import { verdicts, renderVerdicts } from '../../lib/verdict.mjs';

const KINDS = {
  ext: { withExtension: true, extDir: SHIPPED_EXT_DIR, variant: 'shipped', prefix: 'ffext' },
  variant: { withExtension: true, extDir: VARIANT_EXT_DIR, variant: 'stream-rule', prefix: 'ffvar' },
  block: { withExtension: true, extDir: BLOCK_EXT_DIR, variant: 'vector-block', prefix: 'ffblk' },
  control: { withExtension: false, extDir: null, variant: 'none', prefix: 'ffctl' },
};

const args = process.argv.slice(2);
if (args.length === 0 || args.some((a) => !(a in KINDS))) {
  console.error(`usage: node test/experiments/firefox-load/run.mjs <${Object.keys(KINDS).join('|')}>...`);
  process.exit(2);
}

fs.mkdirSync(ARTIFACTS, { recursive: true });

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const summary = { startedAt: new Date().toISOString(), runs: [] };
const counters = {};
let port = 6200 + Math.floor(Math.random() * 200);

for (const kind of args) {
  const cfg = KINDS[kind];
  counters[kind] = (counters[kind] ?? 0) + 1;
  // The invocation stamp is part of the label: without it a second invocation
  // reuses `ffext-1` and silently overwrites the first invocation's PNGs and
  // result JSON. (Learned the hard way -- the per-invocation summary-<stamp>.json
  // files are what survived.)
  const label = `${cfg.prefix}-${counters[kind]}-${stamp.slice(11, 19)}`;
  port += 1;

  console.log(
    `\n${'='.repeat(78)}\nRUN ${label}  (kind=${kind} extension=${cfg.withExtension} variant=${cfg.variant})  rdp port ${port}\n${'='.repeat(78)}`
  );
  const result = await runFirefoxGate({
    label,
    withExtension: cfg.withExtension,
    rdpPort: port,
    extDir: cfg.extDir ?? SHIPPED_EXT_DIR,
    variant: cfg.variant,
  });
  const withExtension = cfg.withExtension;

  const v = verdicts(result, withExtension ? 'dark' : 'light');
  result.verdicts = v;

  const jsonPath = path.join(ARTIFACTS, `result-${label}.json`);
  fs.writeFileSync(jsonPath, JSON.stringify(result, null, 2));

  const s = result.requests ?? {};
  const byKind = s.byKind ?? {};
  console.log(`\n--- ${label} verdicts ---`);
  console.log(renderVerdicts(v));
  const st = result.streamRequests ?? {};
  console.log(
    `\ntransport split: raster=${byKind.raster?.count ?? 0} proto=${byKind.proto?.count ?? 0} ` +
      `stream-basemap=${st.baseMapStreamRequests ?? 0} ` +
      `(raster tokens ${JSON.stringify(byKind.raster?.tokens ?? {})}, ` +
      `proto tokens ${JSON.stringify(byKind.proto?.tokens ?? {})}, ` +
      `stream tokens ${JSON.stringify(st.tokens ?? {})})`
  );
  console.log(`vt buckets: ${JSON.stringify(s.vtByBucket ?? {})}`);
  console.log(`artifact: ${jsonPath}`);

  summary.runs.push({
    label,
    kind,
    withExtension,
    variant: result.variant,
    staticRules: (result.staticRules ?? []).map((r) => r.condition?.regexFilter),
    stream: st,
    loadMechanism: result.loadMechanism,
    extensionLoaded: result.extensionLoaded,
    enabledRulesets: result.loadProof?.backgroundEval?.parsed?.enabledRulesets ?? null,
    healthProbe: result.loadProof?.backgroundEval?.parsed?.health?.healthProbe ?? null,
    postRunRulesets: result.postRunProbe?.backgroundEval?.parsed?.enabledRulesets ?? null,
    consentWallHit: result.consentWallHit,
    errors: result.errors,
    transport: {
      raster: byKind.raster?.count ?? 0,
      proto: byKind.proto?.count ?? 0,
      rasterTokens: byKind.raster?.tokens ?? {},
      protoTokens: byKind.proto?.tokens ?? {},
      rasterZooms: byKind.raster?.zooms ?? [],
      protoZooms: byKind.proto?.zooms ?? [],
    },
    baseMapTileRequestsRaw: s.baseMapTileRequestsRaw ?? 0,
    baseMapTileRequestsTerminal: s.baseMapTileRequestsTerminal ?? 0,
    baseMapTileRequestsSuperseded: s.baseMapTileRequestsSuperseded ?? 0,
    supersedeReasons: s.supersedeReasons ?? {},
    tokenCountsRaw: s.tokenCountsRaw ?? {},
    tokenCountsTerminal: s.tokenCountsTerminal ?? {},
    distinctZoomsTerminal: s.distinctZoomsTerminal ?? [],
    preNavigation: s.preNavigationRequests ?? null,
    offenderCount: (s.offenders ?? []).length,
    offenderSample: (s.offenders ?? []).slice(0, 3),
    timeSeries: (result.timeSeries ?? []).map((t) => ({
      atMs: t.atMs,
      rgb: [t.r, t.g, t.b],
      lum: t.luminance,
      verdict: t.isDark ? 'DARK' : t.isLight ? 'LIGHT' : 'AMBIGUOUS',
    })),
    phases: (result.phases ?? []).map((p) => ({
      phase: p.phase,
      urlZoom: p.urlZoom,
      vt: p.vtRequestsDuringPhase,
      settled: p.pixels
        ? { rgb: [p.pixels.r, p.pixels.g, p.pixels.b], lum: p.pixels.luminance, verdict: p.pixels.isDark ? 'DARK' : p.pixels.isLight ? 'LIGHT' : 'AMBIGUOUS' }
        : null,
      plus2500: p.latePixels
        ? { rgb: [p.latePixels.r, p.latePixels.g, p.latePixels.b], lum: p.latePixels.luminance, verdict: p.latePixels.isDark ? 'DARK' : p.latePixels.isLight ? 'LIGHT' : 'AMBIGUOUS' }
        : null,
    })),
    verdicts: v.list.map((a) => ({ id: a.id, pass: a.pass, observed: a.observed })),
    voidGate: v.voidGate ?? false,
    pass: v.pass,
    jsonPath: path.relative(path.resolve(ARTIFACTS, '..', '..', '..', '..'), jsonPath).replace(/\\/g, '/'),
  });

  fs.writeFileSync(path.join(ARTIFACTS, `summary-${stamp}.json`), JSON.stringify(summary, null, 2));
  fs.writeFileSync(path.join(ARTIFACTS, 'summary-latest.json'), JSON.stringify(summary, null, 2));
}

summary.finishedAt = new Date().toISOString();
fs.writeFileSync(path.join(ARTIFACTS, `summary-${stamp}.json`), JSON.stringify(summary, null, 2));
fs.writeFileSync(path.join(ARTIFACTS, 'summary-latest.json'), JSON.stringify(summary, null, 2));

console.log(`\n${'='.repeat(78)}\nPER-RUN TRANSPORT SPLIT\n${'='.repeat(78)}`);
for (const r of summary.runs) {
  console.log(
    `${r.label.padEnd(9)} variant=${String(r.variant).padEnd(11)} loaded=${String(r.extensionLoaded).padEnd(5)} ` +
      `raster=${String(r.transport.raster).padStart(4)} proto=${String(r.transport.proto).padStart(4)} ` +
      `stream=${String(r.stream?.baseMapStreamRequests ?? 0).padStart(3)}${JSON.stringify(r.stream?.tokens ?? {})} ` +
      `zooms=[${r.distinctZoomsTerminal.join(',')}] tokens=${JSON.stringify(r.tokenCountsTerminal)} ` +
      `A1/A2/A3=${r.verdicts.map((x) => (x.pass ? 'P' : 'F')).join('')}`
  );
  const last = r.phases.at(-1);
  console.log(
    `          pixels: t500=${r.timeSeries[0]?.verdict} t3000=${r.timeSeries.find((t) => t.atMs === 3000)?.verdict} ` +
      `final-phase=${last?.settled?.verdict} rgb=${JSON.stringify(last?.settled?.rgb)}`
  );
}
console.log(`\nsummary: ${path.join(ARTIFACTS, 'summary-latest.json')}`);
