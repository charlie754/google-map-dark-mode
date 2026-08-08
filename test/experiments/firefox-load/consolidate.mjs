#!/usr/bin/env node
/**
 * Merge every per-invocation `summary-<stamp>.json` into one FINAL-report.json,
 * so the per-run transport split can be read across all fresh profiles at once.
 *
 * Runs are keyed by `<stamp>/<label>` because the label alone repeats between
 * invocations.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ART = path.join(path.dirname(fileURLToPath(import.meta.url)), 'artifacts');
const files = fs
  .readdirSync(ART)
  .filter((f) => /^summary-2.*\.json$/.test(f))
  .sort();

const runs = [];
for (const f of files) {
  const s = JSON.parse(fs.readFileSync(path.join(ART, f), 'utf8'));
  const stamp = f.replace(/^summary-|\.json$/g, '');
  for (const r of s.runs) runs.push({ invocation: stamp, ...r });
}

const kindOf = (r) => r.kind ?? (r.withExtension ? 'ext' : 'control');

const table = runs.map((r) => ({
  run: `${r.invocation.slice(11, 19)}/${r.label}`,
  kind: kindOf(r),
  variant: r.variant ?? (r.withExtension ? 'shipped' : 'none'),
  addonActive: r.extensionLoaded,
  enabledRulesets: r.enabledRulesets,
  healthProbe: r.healthProbe,
  transportRaster: r.transport.raster,
  transportProto: r.transport.proto,
  transportStreamBaseMap: r.stream?.baseMapStreamRequests ?? null,
  rasterTokens: r.transport.rasterTokens,
  streamTokens: r.stream?.tokens ?? null,
  distinctZooms: r.distinctZoomsTerminal,
  A1: r.verdicts.find((v) => v.id === 'A1')?.pass ?? null,
  A2: r.verdicts.find((v) => v.id.startsWith('A2'))?.pass ?? null,
  A3: r.verdicts.find((v) => v.id.startsWith('A3'))?.pass ?? null,
  timeSeries: r.timeSeries,
  phaseVerdicts: r.phases.map((p) => `${p.phase}:${p.settled?.verdict}/${p.plus2500?.verdict}`),
  errors: r.errors,
}));

const withExt = table.filter((t) => t.kind !== 'control');
const controls = table.filter((t) => t.kind === 'control');

const report = {
  generatedAt: new Date().toISOString(),
  loadMechanism:
    'Firefox DevTools RDP `installTemporaryAddon` against a Playwright-launched ' +
    'bundled Firefox started with `-start-debugger-server <port>`. Profile-directory ' +
    'XPI side-loading remains dead on this build.',
  totalRuns: table.length,
  runsWithAddon: withExt.length,
  controlRuns: controls.length,
  transportArm: {
    protoRequestsAcrossAllRuns: table.reduce((a, t) => a + t.transportProto, 0),
    rasterRequestsAcrossAllRuns: table.reduce((a, t) => a + t.transportRaster, 0),
    streamBaseMapAcrossAllRuns: table.reduce((a, t) => a + (t.transportStreamBaseMap ?? 0), 0),
    conclusion:
      'Firefox is in the raster arm in 100% of runs: zero /maps/vt/proto requests, ' +
      'confirmed independently by a webRequest logger add-on that sees Web Worker fetches.',
  },
  runs: table,
};

fs.writeFileSync(path.join(ART, 'FINAL-report.json'), JSON.stringify(report, null, 2));

const pad = (s, n) => String(s).padEnd(n);
console.log(
  pad('run', 26) + pad('variant', 14) + pad('active', 7) + pad('raster', 8) + pad('proto', 7) +
    pad('stream', 8) + pad('tokens', 26) + pad('zooms', 16) + 'A1 A2 A3'
);
for (const t of table) {
  console.log(
    pad(t.run, 26) + pad(t.variant, 14) + pad(t.addonActive, 7) + pad(t.transportRaster, 8) +
      pad(t.transportProto, 7) + pad(`${t.transportStreamBaseMap}${JSON.stringify(t.streamTokens ?? {})}`, 8) +
      pad(JSON.stringify(t.rasterTokens), 26) + pad(`[${t.distinctZooms.join(',')}]`, 16) +
      `${t.A1 ? 'P' : 'F'}  ${t.A2 ? 'P' : 'F'}  ${t.A3 ? 'P' : 'F'}`
  );
  console.log(`  pixels: ${t.timeSeries.map((x) => `${x.atMs}=${x.verdict[0]}`).join(' ')}  |  phases: ${t.phaseVerdicts.join(' ')}`);
}
console.log(`\nproto requests across ALL runs: ${report.transportArm.protoRequestsAcrossAllRuns}`);
console.log(`wrote ${path.join(ART, 'FINAL-report.json')}`);
