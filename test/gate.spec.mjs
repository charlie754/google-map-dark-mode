/**
 * M0 gate. One Playwright test, driven by GATE_MODE.
 *
 *   GATE_MODE=extension        dist/chrome loaded  -> expects dark
 *   GATE_MODE=selftest         test/fixtures/probe-extension loaded -> expects dark
 *   GATE_MODE=control          no extension        -> expects light (mutation control)
 *   GATE_MODE=firefox-extension / firefox-selftest / firefox-control
 *
 * Run through the npm scripts; they set the env var for you.
 */

import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';

import { runGate, ROOT, ARTIFACTS, MAPS_URL } from './lib/gate.mjs';
import { verdicts, renderVerdicts } from './lib/verdict.mjs';

const MODE = process.env.GATE_MODE ?? 'control';

const MODES = {
  extension: {
    browserName: 'chromium',
    extension: () => process.env.GATE_EXT_DIR ?? path.join(ROOT, 'dist', 'chrome'),
    expectation: 'dark',
  },
  selftest: {
    browserName: 'chromium',
    extension: () => path.join(ROOT, 'test', 'fixtures', 'probe-extension'),
    expectation: 'dark',
  },
  control: {
    browserName: 'chromium',
    extension: () => null,
    expectation: 'light',
  },
  // Harness-side interception, no extension. Answers "is the interaction-time
  // endpoint styleable at all?" independently of what any extension can do.
  'route-rewrite': {
    browserName: 'chromium',
    extension: () => null,
    routeRewrite: true,
    expectation: 'dark',
  },
  'firefox-extension': {
    browserName: 'firefox',
    extension: () => process.env.GATE_EXT_DIR ?? path.join(ROOT, 'dist', 'firefox'),
    expectation: 'dark',
  },
  'firefox-selftest': {
    browserName: 'firefox',
    extension: () => path.join(ROOT, 'test', 'fixtures', 'probe-extension-firefox'),
    expectation: 'dark',
  },
  'firefox-control': {
    browserName: 'firefox',
    extension: () => null,
    expectation: 'light',
  },
};

test.describe.configure({ mode: 'serial' });

test(`M0 gate [${MODE}]`, async () => {
  const cfg = MODES[MODE];
  if (!cfg) throw new Error(`unknown GATE_MODE="${MODE}"; expected one of ${Object.keys(MODES).join(', ')}`);

  const extensionDir = cfg.extension();
  if (extensionDir && !fs.existsSync(path.join(extensionDir, 'manifest.json'))) {
    throw new Error(
      `GATE_MODE=${MODE} needs a built extension at ${extensionDir}, but manifest.json is not there.\n` +
        'That directory is produced by `npm run build` (tools/build.mjs), which belongs to the extension lane.\n' +
        'Either build it, or set GATE_EXT_DIR, or run `npm run gate:selftest` to exercise the harness ' +
        'against its own fixture extension.'
    );
  }

  console.log('='.repeat(100));
  console.log(`M0 GATE  mode=${MODE}  expectation=${cfg.expectation}  target=${MAPS_URL}`);
  console.log('='.repeat(100));

  const result = await runGate({
    mode: MODE,
    label: MODE,
    browserName: cfg.browserName,
    extensionDir,
    routeRewrite: cfg.routeRewrite === true,
  });

  const v = verdicts(result, cfg.expectation);
  result.verdicts = v;

  const s = result.requests ?? {};
  const report = [
    '',
    '-'.repeat(100),
    `RUN SUMMARY  [${MODE}]`,
    '-'.repeat(100),
    `browser              : ${result.browserName} via ${result.launchMethod} (${result.executable})`,
    `extension dir        : ${result.extensionDir ?? '<none - control run>'}`,
    `extension loaded     : ${result.extensionLoaded} id=${result.extensionId ?? '-'} sw=${result.serviceWorkerUrl ?? '-'}`,
    `consent wall         : ${result.consentWallHit}`,
    `final page url       : ${result.finalPageUrl}`,
    '',
    `/maps/vt/ requests   : ${s.totalVtRequests}  (excludes ${s.preNavigationRequests?.count ?? 0} pre-navigation, ` +
      `extension-originated: ${JSON.stringify(s.preNavigationRequests?.tokens ?? {})})`,
    `  by bucket          : ${JSON.stringify(s.vtByBucket)}`,
    `base-map tiles (raw) : ${s.baseMapTileRequestsRaw}`,
    `  superseded         : ${s.baseMapTileRequestsSuperseded}  ${JSON.stringify(s.supersedeReasons)}`,
    `base-map (terminal)  : ${s.baseMapTileRequestsTerminal}`,
    `style tokens (raw)   : ${JSON.stringify(s.tokenCountsRaw)}`,
    `style tokens (final) : ${JSON.stringify(s.tokenCountsTerminal)}`,
    `distinct zooms       : [${(s.distinctZoomsTerminal ?? []).join(', ')}]`,
    `zooms by token       : ${JSON.stringify(s.zoomsByToken)}`,
    '',
    'BY TRANSPORT (raster = /maps/vt/pb=..., proto = /maps/vt/proto?bpb=<base64 protobuf>):',
    ...['raster', 'proto'].map(
      (k) =>
        `  ${k.padEnd(7)} n=${String(s.byKind?.[k]?.count ?? 0).padStart(4)} ` +
        `tokens=${JSON.stringify(s.byKind?.[k]?.tokens ?? {})} ` +
        `zooms=[${(s.byKind?.[k]?.zooms ?? []).join(',')}] ` +
        `phases=${JSON.stringify(s.byKind?.[k]?.phases ?? {})}`
    ),
    ...(result.routeRewrite
      ? [
          `  harness route-rewrites applied: ${s.harnessRewrites} ` +
            `(raster=${result.routeStats?.rasterHits} proto=${result.routeStats?.protoHits} failures=${result.routeStats?.failures})`,
        ]
      : []),
    ...(result.dnrProbe ? [`  dnr probe: ${JSON.stringify(result.dnrProbe)}`] : []),
    '',
    'per phase:',
    ...Object.entries(s.perPhase ?? {}).map(
      ([k, val]) =>
        `  ${k.padEnd(10)} vt=${String(val.vt).padStart(4)} base=${String(val.baseTerminal).padStart(4)} zooms=[${val.zooms.join(',')}] tokens=${JSON.stringify(val.tokens)}`
    ),
    '',
    'first-paint frames (diagnostic only, never asserted):',
    ...(result.earlyFrames ?? []).map(
      (f) =>
        `  @${String(f.atMs).padStart(4)}ms rgb=(${String(f.pixels.r).padStart(6)}, ${String(f.pixels.g).padStart(6)}, ${String(f.pixels.b).padStart(6)})` +
        ` lum=${String(f.pixels.luminance).padStart(6)} -> ${f.pixels.isDark ? 'DARK' : f.pixels.isLight ? 'LIGHT' : 'AMBIGUOUS'}   ${f.screenshot}`
    ),
    '',
    'mean RGB per map-area screenshot:',
    ...(result.phases ?? []).map(
      (p) =>
        `  ${p.phase.padEnd(10)} rgb=(${String(p.pixels.r).padStart(6)}, ${String(p.pixels.g).padStart(6)}, ${String(p.pixels.b).padStart(6)})` +
        ` lum=${String(p.pixels.luminance).padStart(6)} dDark=${String(p.pixels.distToDarkRef).padStart(6)} dLight=${String(p.pixels.distToLightRef).padStart(6)}` +
        ` -> ${p.pixels.isDark ? 'DARK' : p.pixels.isLight ? 'LIGHT' : 'AMBIGUOUS'}   ${p.screenshot}`
    ),
    '',
    `ASSERTIONS (expectation: ${cfg.expectation})`,
    renderVerdicts(v),
    '',
    ...(s.darkSample?.length ? ['sample RoadmapDark URL:', `  ${s.darkSample[0]}`] : []),
    ...(s.offenderSample?.length ? ['sample offending (non-dark) URL:', `  ${s.offenderSample[0]}`] : []),
    ...(result.errors.length ? ['', 'ERRORS:', ...result.errors.map((e) => `  ${e}`)] : []),
    '-'.repeat(100),
    `RESULT [${MODE}]: ${v.pass ? 'PASS' : 'FAIL'}${v.voidGate ? '   *** GATE VOID ***' : ''}`,
    '-'.repeat(100),
  ].join('\n');

  console.log(report);

  fs.mkdirSync(ARTIFACTS, { recursive: true });
  fs.writeFileSync(path.join(ARTIFACTS, `result-${MODE}.json`), JSON.stringify(result, null, 2));
  fs.writeFileSync(path.join(ARTIFACTS, `console-${MODE}.log`), `${result.log.join('\n')}\n${report}\n`);

  // ---- the actual gate --------------------------------------------------
  expect(result.errors, `run errors for mode=${MODE}`).toEqual([]);

  if (v.voidGate) {
    throw new Error(
      'GATE VOID: the control run (no extension loaded) satisfied the positive assertions A2 and A3. ' +
        'The assertions are therefore not measuring the extension, and no pass from this suite means anything. ' +
        v.voidDetail
    );
  }

  for (const a of v.list) {
    expect
      .soft(a.pass, `${a.id} ${a.claim}\n        observed: ${a.observed}`)
      .toBe(true);
  }
});
