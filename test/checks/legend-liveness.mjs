#!/usr/bin/env node
/**
 * LIVE TOKEN LIVENESS -- the canary for Google withdrawing the dark style names.
 *
 *   node test/checks/legend-liveness.mjs
 *
 * The whole extension rests on four undocumented internal style names existing
 * on Google's CDN. Nothing in the codebase can make them keep existing; the only
 * defence is noticing quickly when they stop. This check asks the CDN directly:
 *
 *   CompactLegend-{Roadmap,RoadmapDark,Terrain,TerrainDark}-<version>  -> 200
 *   CompactLegend-<nonsense>-<version>                                 -> 404
 *
 * Two distinct failures have to stay distinguishable, or this check will cry
 * wolf every few weeks:
 *
 *   VERSION STALE  the 32-hex content version has been garbage collected. Every
 *                  style under it 404s, including RoadmapSatellite, which no
 *                  rule can touch and which therefore serves as the version
 *                  canary. This is EXPECTED eventually and is not a failure of
 *                  the extension -- but if EVERY pinned version is stale, the
 *                  check has lost its grip and says so.
 *   TOKEN DEAD     the version is alive (canary 200) but the dark style 404s.
 *                  That is the real emergency: the extension would start
 *                  redirecting real requests to nothing.
 *
 * HEAD requests only, so this costs no payload despite each asset being ~0.5 MB.
 * Roughly a dozen requests to www.gstatic.com per run.
 */

import { LEGEND_VERSIONS, LEGEND_STYLES_LIVE, LEGEND_STYLES_DEAD } from '../fixtures/url-corpus.mjs';

const CANARY_STYLE = 'RoadmapSatellite';
const REQUIRED_LIVE = ['Roadmap', 'RoadmapDark', 'Terrain', 'TerrainDark'];

const url = (style, version) => `https://www.gstatic.com/maps/res/CompactLegend-${style}-${version}`;

async function head(u) {
  const started = Date.now();
  try {
    const r = await fetch(u, { method: 'HEAD', cache: 'no-store', redirect: 'follow' });
    return {
      status: r.status,
      bytes: Number(r.headers.get('content-length') ?? 0) || null,
      contentType: r.headers.get('content-type'),
      ms: Date.now() - started,
      error: null,
    };
  } catch (err) {
    return { status: null, bytes: null, contentType: null, ms: Date.now() - started, error: String(err?.message ?? err) };
  }
}

async function main() {
  console.log('='.repeat(96));
  console.log('COMPACTLEGEND TOKEN LIVENESS');
  console.log('='.repeat(96));

  const versions = [];
  for (const v of LEGEND_VERSIONS) {
    const canary = await head(url(CANARY_STYLE, v));
    const styles = {};
    for (const s of LEGEND_STYLES_LIVE) {
      styles[s] = s === CANARY_STYLE ? canary : await head(url(s, v));
    }
    const dead = {};
    for (const s of LEGEND_STYLES_DEAD) dead[s] = await head(url(s, v));

    const versionAlive = canary.status === 200;
    const allLive = REQUIRED_LIVE.every((s) => styles[s].status === 200);
    const all404 = Object.values(dead).every((d) => d.status === 404);

    const state = canary.status === null ? 'unknown' : !versionAlive ? 'version-stale' : allLive ? 'healthy' : 'token-dead';
    versions.push({ version: v, state, canary, styles, dead, allLive, all404 });

    console.log('');
    console.log(`version ${v}  ->  ${state.toUpperCase()}`);
    for (const s of LEGEND_STYLES_LIVE) {
      const r = styles[s];
      console.log(
        `  ${String(r.status ?? 'ERR').padStart(4)}  ${s.padEnd(18)} ${String(r.bytes ?? '-').padStart(8)} bytes  ${r.ms}ms` +
          (r.error ? `  error=${r.error}` : '')
      );
    }
    for (const s of LEGEND_STYLES_DEAD) {
      const r = dead[s];
      console.log(`  ${String(r.status ?? 'ERR').padStart(4)}  ${s.padEnd(18)} (must be 404)`);
    }
  }

  /* --------------------------------------------------------------- verdict */
  const results = [];
  const record = (name, pass, detail) => {
    results.push({ name, pass, detail });
    console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}`);
    console.log(`        ${detail}`);
  };

  console.log('');
  console.log('-'.repeat(96));
  const alive = versions.filter((v) => v.state === 'healthy');
  const tokenDead = versions.filter((v) => v.state === 'token-dead');
  const stale = versions.filter((v) => v.state === 'version-stale');
  const unknown = versions.filter((v) => v.state === 'unknown');

  record(
    'network-reachable',
    unknown.length === 0,
    unknown.length
      ? `${unknown.length} version(s) could not be probed at all: ${unknown.map((v) => v.canary.error).join('; ')}`
      : 'every probe got an HTTP status back'
  );
  record(
    'at-least-one-pinned-version-still-on-the-CDN',
    versions.some((v) => v.state !== 'version-stale' && v.state !== 'unknown'),
    stale.length === versions.length
      ? `ALL ${versions.length} pinned versions are stale (canary ${CANARY_STYLE} 404s on each). This does NOT ` +
        'mean the dark style is gone -- it means this check can no longer see. Refresh the pins in ' +
        'extension/background.js PINNED_LEGEND_VERSIONS and test/fixtures/url-corpus.mjs.'
      : `${versions.length - stale.length}/${versions.length} pinned versions still resolve (stale: ${stale.length})`
  );
  record(
    'dark-style-names-still-served',
    tokenDead.length === 0 && alive.length > 0,
    tokenDead.length
      ? `TOKEN DEAD on version(s) ${tokenDead.map((v) => v.version).join(', ')}: the version is alive but ` +
        `${REQUIRED_LIVE.filter((s) => tokenDead[0].styles[s].status !== 200).join(', ')} 404s. ` +
        'The extension would now redirect real requests to nothing.'
      : `${REQUIRED_LIVE.join(', ')} all return 200 on ${alive.length} live version(s): ` +
        alive
          .map((v) => `${v.version.slice(0, 8)}(${REQUIRED_LIVE.map((s) => v.styles[s].bytes).join('/')} bytes)`)
          .join(' ')
  );
  record(
    'invalid-style-names-404',
    versions.filter((v) => v.state !== 'version-stale').every((v) => v.all404),
    `nonsense style names (${LEGEND_STYLES_DEAD.join(', ')}) return 404 on every live version -- ` +
      'so a 200 above really means "this style exists", not "gstatic returns 200 for anything"'
  );
  record(
    'dark-asset-is-a-real-payload',
    alive.every((v) => REQUIRED_LIVE.every((s) => (v.styles[s].bytes ?? 0) > 100000)),
    alive.length
      ? `every dark asset is > 100 KB (smallest ${Math.min(...alive.flatMap((v) => REQUIRED_LIVE.map((s) => v.styles[s].bytes ?? 0)))} bytes)`
      : 'no live version to measure'
  );

  const failed = results.filter((r) => !r.pass);
  console.log('-'.repeat(96));
  console.log(`TOKEN LIVENESS: ${results.length - failed.length}/${results.length} checks passed`);
  console.log('-'.repeat(96));
  process.exitCode = failed.length ? 1 : 0;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
