#!/usr/bin/env node
/**
 * Cross-run analysis for the raster-pin experiments.
 *
 * The single most load-bearing discovery here is that `/maps/vt/pb=` is TWO
 * transports, not one. The existing harness classifies any `pb=` + `!2sm!` +
 * `!1sset!2s` URL as a "raster base-map tile", but the tail of the URL selects
 * the response format:
 *
 *   ...!2sRoadmapDark!4e0!5m1!1e0!23i...            -> PNG raster image
 *   ...!2sRoadmapDark!4e1!5m4!1e4!8m2!1e0!1e1!...   -> vector tile data
 *
 * `!4e0` tiles are painted by Google's servers, so `set:RoadmapDark` changes
 * the pixels. `!4e1` tiles are geometry; the style is applied client-side, so
 * the same token in the URL changes nothing you can see. A run can therefore
 * show "100% RoadmapDark base-map tiles" and still render a fully light map.
 * Every count below is split on that distinction.
 *
 *   node test/experiments/raster-pin/analyse.mjs [resultLabel...]
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ARTIFACTS = path.join(HERE, 'artifacts');

/** '4e0' (server-painted PNG) | '4e1' (client-styled vector) | 'other'. */
export function pbFormat(url) {
  if (!url.includes('/maps/vt/pb=')) return null;
  const m = url.match(/!2sRoadmap(?:Dark)?!4e(\d)/);
  if (m) return `4e${m[1]}`;
  const m2 = url.match(/!4e(\d)/);
  return m2 ? `4e${m2[1]}?` : 'other';
}

function tallyRun(res) {
  const all = res.requestLog ?? [];
  /* `/maps/vt/stream/pb=` is a base-map transport that test/lib's baseMapKind()
   * does not recognise (it requires the `pb=` to sit directly after `/vt/`), so
   * it lands in `kind: null` and would vanish from any tally keyed on kind. */
  const stream = all.filter((r) => r.url.includes('/maps/vt/stream'));
  const rows = all.filter((r) => r.kind === 'raster' || r.kind === 'proto');
  const t = { '4e0': 0, '4e1': 0, other: 0, proto: 0 };
  const zooms = { '4e0': new Set(), '4e1': new Set(), proto: new Set() };
  const tokens = { '4e0': {}, '4e1': {} };
  for (const r of rows) {
    if (r.kind === 'proto') {
      t.proto += 1;
      if (Number.isFinite(r.zoom)) zooms.proto.add(r.zoom);
      continue;
    }
    const f = pbFormat(r.url) ?? 'other';
    const key = f === '4e0' || f === '4e1' ? f : 'other';
    t[key] += 1;
    if (key !== 'other') {
      if (Number.isFinite(r.zoom)) zooms[key].add(r.zoom);
      tokens[key][String(r.token)] = (tokens[key][String(r.token)] ?? 0) + 1;
    }
  }
  const s = (x) => [...x].sort((a, b) => a - b);
  return {
    label: res.label,
    intervention: res.intervention,
    pngRaster4e0: { n: t['4e0'], zooms: s(zooms['4e0']), tokens: tokens['4e0'] },
    vectorPb4e1: { n: t['4e1'], zooms: s(zooms['4e1']), tokens: tokens['4e1'] },
    protoVector: { n: t.proto, zooms: s(zooms.proto) },
    streamVector: { n: stream.length },
    otherPb: t.other,
    seriesLum: (res.series ?? []).map((f) => ({ t: f.targetMs, lum: f.pixels?.luminance ?? null })),
    phaseLum: (res.phases ?? []).map((p) => ({
      phase: p.phase,
      lum: p.pixels.luminance,
      dark: p.pixels.isDark,
      urlZoom: p.urlZoom,
    })),
    chrome: res.health?.chrome ?? null,
    textLength: res.health?.textLength ?? null,
    consoleErrors: res.consoleErrors?.length ?? null,
    pageErrors: res.pageErrors?.length ?? null,
    failedRequests: res.failedRequests?.length ?? null,
  };
}

const labels =
  process.argv.slice(2).length > 0
    ? process.argv.slice(2)
    : fs
        .readdirSync(ARTIFACTS)
        .filter((f) => f.startsWith('result-') && f.endsWith('.json'))
        .map((f) => f.slice('result-'.length, -'.json'.length));

const out = [];
for (const l of labels) {
  const p = path.join(ARTIFACTS, `result-${l}.json`);
  if (!fs.existsSync(p)) {
    console.error(`missing ${p}`);
    continue;
  }
  const parsed = JSON.parse(fs.readFileSync(p, 'utf8'));
  // result-probe-composite.json is a no-browser fetch probe, not a run.
  if (!parsed.label) continue;
  out.push(tallyRun(parsed));
}

const pad = (s, n) => String(s).padEnd(n);
console.log(
  pad('run', 24) +
    pad('PNG 4e0', 10) +
    pad('vec 4e1', 10) +
    pad('proto', 8) +
    pad('stream', 8) +
    pad('lum@1400', 10) +
    pad('lum@9000', 10) +
    pad('lum settled', 12) +
    pad('zoomIn btn', 11) +
    'dark all phases'
);
console.log('-'.repeat(110));
for (const r of out) {
  const at = (t) => r.seriesLum.find((x) => x.t === t)?.lum ?? '-';
  const settled = r.phaseLum.find((p) => p.phase === 'settled')?.lum ?? '-';
  const allDark = r.phaseLum.length > 0 && r.phaseLum.every((p) => p.dark);
  console.log(
    pad(r.label, 24) +
      pad(r.pngRaster4e0.n, 10) +
      pad(r.vectorPb4e1.n, 10) +
      pad(r.protoVector.n, 8) +
      pad(r.streamVector.n, 8) +
      pad(at(1400), 10) +
      pad(at(9000) === '-' ? at(6000) : at(9000), 10) +
      pad(settled, 12) +
      pad(r.chrome ? r.chrome.zoomIn : '?', 11) +
      (allDark ? 'YES' : 'no')
  );
}

fs.writeFileSync(path.join(ARTIFACTS, 'analysis.json'), JSON.stringify(out, null, 2));
console.log(`\nwrote test/experiments/raster-pin/artifacts/analysis.json`);
console.log('\nper-run detail:');
for (const r of out) {
  console.log(
    `\n${r.label}  ${JSON.stringify(r.intervention)}\n` +
      `  PNG 4e0 : n=${r.pngRaster4e0.n} zooms=[${r.pngRaster4e0.zooms}] tokens=${JSON.stringify(r.pngRaster4e0.tokens)}\n` +
      `  vec 4e1 : n=${r.vectorPb4e1.n} zooms=[${r.vectorPb4e1.zooms}] tokens=${JSON.stringify(r.vectorPb4e1.tokens)}\n` +
      `  proto   : n=${r.protoVector.n} zooms=[${r.protoVector.zooms}]\n` +
      `  stream  : n=${r.streamVector.n}   (/maps/vt/stream, batched vector)\n` +
      `  series  : ${r.seriesLum.map((x) => `${x.t}:${x.lum}`).join(' ')}\n` +
      `  phases  : ${r.phaseLum.map((x) => `${x.phase}:${x.lum}${x.dark ? 'D' : ''}`).join(' ')}\n` +
      `  chrome  : ${JSON.stringify(r.chrome)}  textLen=${r.textLength}\n` +
      `  errors  : console=${r.consoleErrors} page=${r.pageErrors} failedReq=${r.failedRequests}`
  );
}
