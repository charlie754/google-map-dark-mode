/**
 * Records every `/maps/vt/` request the browser makes, tags it with the gesture
 * phase that was in flight, and resolves redirect chains afterwards.
 *
 * Why redirect resolution matters: a declarativeNetRequest `redirect` action is
 * a real network-stack redirect. The browser therefore emits TWO request events
 * for one tile -- the original `!2sRoadmap!` URL and the rewritten
 * `!2sRoadmapDark!` URL. Counting raw events would make A2 ("100% of base-map
 * tile requests carry RoadmapDark") impossible to pass even when the rewrite is
 * working perfectly. The assertion must run on the TERMINAL url of each chain --
 * the one actually served by Google.
 *
 * Three independent supersede signals are used, and which one fired is reported,
 * so a reader can see exactly how a light URL was excused:
 *   1. `request.redirectedTo()` is non-null   (Playwright saw the chain)
 *   2. the response status is 3xx             (the network stack saw the chain)
 *   3. a `!2sRoadmapDark!` twin of the exact same URL was also requested
 * Signal 3 is the weakest and is only reachable when 1 and 2 are both blind;
 * a light tile with no dark twin is never excused, and A3 (dark pixels) is an
 * independent check on the same claim.
 */

import {
  isVtRequest,
  isAnyBaseMapTile,
  baseMapKind,
  styleTokenOf,
  tileZoomOf,
  tileCoordsOf,
  darkTwin,
  vtBucket,
} from './tiles.mjs';

export class VtRecorder {
  constructor() {
    /**
     * Populated only by the `route-rewrite` mode: original URL -> the URL that
     * was actually put on the wire. Classification runs on the effective URL,
     * because that is what Google served; the original is kept in the report.
     */
    this.rewrites = new Map();
    /** @type {Array<{req: import('@playwright/test').Request, url: string, phase: string, at: number}>} */
    this.records = [];
    this.phase = 'boot';
    this.lastVtAt = 0;
    this.startedAt = Date.now();
  }

  setPhase(phase) {
    this.phase = phase;
  }

  attach(context) {
    context.on('request', (req) => {
      let url;
      try {
        url = req.url();
      } catch {
        return;
      }
      if (!isVtRequest(url)) return;
      this.lastVtAt = Date.now();
      let redirectedFromUrl = null;
      try {
        redirectedFromUrl = req.redirectedFrom()?.url() ?? null;
      } catch {
        /* ignore */
      }
      this.records.push({
        req,
        url,
        phase: this.phase,
        at: Date.now() - this.startedAt,
        resourceType: safe(() => req.resourceType()),
        redirectedFromUrl,
      });
    });
  }

  /** Number of `/maps/vt/` events seen so far (used by the settle loop). */
  get count() {
    return this.records.length;
  }

  /** Resolve responses, then build the analysed view. Call after the run. */
  async analyse() {
    await Promise.all(
      this.records.map(async (r) => {
        try {
          const resp = await withTimeout(r.req.response(), 4000);
          r.status = resp ? resp.status() : null;
        } catch {
          r.status = null;
        }
      })
    );

    const all = this.records.map((r) => {
      const effective = this.rewrites.get(r.url) ?? r.url;
      return {
        url: effective,
        originalUrl: effective === r.url ? null : r.url,
        rewrittenByHarness: effective !== r.url,
        phase: r.phase,
        at: r.at,
        status: r.status ?? null,
        resourceType: r.resourceType,
        bucket: vtBucket(effective),
        kind: baseMapKind(effective),
        base: isAnyBaseMapTile(effective),
        token: styleTokenOf(effective),
        zoom: tileZoomOf(effective),
        coords: tileCoordsOf(effective),
        redirectedFromUrl: r.redirectedFromUrl,
        redirectedTo: safe(() => r.req.redirectedTo()?.url() ?? null),
      };
    });

    const darkTwinsSeen = new Set(
      all.filter((r) => r.base && r.token && r.token !== 'Roadmap').map((r) => r.url)
    );

    for (const r of all) {
      r.supersededBy = null;
      if (r.redirectedTo) r.supersededBy = 'playwright-redirect-chain';
      else if (r.status !== null && r.status >= 300 && r.status < 400)
        r.supersededBy = `http-${r.status}`;
      else if (r.base && r.token === 'Roadmap') {
        const twin = darkTwin(r.url);
        if (twin && darkTwinsSeen.has(twin)) r.supersededBy = 'dark-twin-requested';
      }
      r.terminal = r.supersededBy === null;
    }

    return all;
  }
}

function safe(fn) {
  try {
    return fn();
  } catch {
    return null;
  }
}

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
  ]);
}

/** Summarise the analysed request list into the numbers the gate asserts on. */
export function summarise(all) {
  /*
   * Requests recorded in the 'boot' phase happened before the page was ever
   * navigated, so they cannot be Maps rendering anything -- in practice they are
   * the extension's own startup health probe, which deliberately fetches a known
   * RoadmapDark tile. Counting that as a base-map tile would let an extension
   * inflate A2's numerator with its own traffic. It is reported, not asserted on.
   */
  const preNav = all.filter((r) => r.phase === 'boot');
  const vt = all.filter((r) => r.phase !== 'boot');
  const base = vt.filter((r) => r.base);
  const terminalBase = base.filter((r) => r.terminal);
  const superseded = base.filter((r) => !r.terminal);

  const tally = (rows, key) => {
    const out = {};
    for (const r of rows) {
      const k = String(r[key]);
      out[k] = (out[k] ?? 0) + 1;
    }
    return Object.fromEntries(Object.entries(out).sort((a, b) => b[1] - a[1]));
  };

  const distinctZooms = [
    ...new Set(terminalBase.map((r) => r.zoom).filter((z) => Number.isFinite(z))),
  ].sort((a, b) => a - b);

  const zoomsByToken = {};
  for (const r of terminalBase) {
    const t = String(r.token);
    (zoomsByToken[t] ??= new Set()).add(r.zoom);
  }
  for (const k of Object.keys(zoomsByToken))
    zoomsByToken[k] = [...zoomsByToken[k]].sort((a, b) => a - b);

  const offenders = terminalBase
    .filter((r) => r.token !== 'RoadmapDark')
    .map((r) => ({
      url: r.url,
      kind: r.kind,
      token: r.token,
      zoom: r.zoom,
      phase: r.phase,
      status: r.status,
    }));

  // Split by transport. Merging raster and proto without showing the split
  // would hide the single most important fact this harness discovered.
  const byKind = {};
  for (const kind of ['raster', 'proto']) {
    const rows = terminalBase.filter((r) => r.kind === kind);
    byKind[kind] = {
      count: rows.length,
      tokens: tally(rows, 'token'),
      zooms: [...new Set(rows.map((r) => r.zoom).filter(Number.isFinite))].sort((a, b) => a - b),
      phases: tally(rows, 'phase'),
    };
  }

  const darkOnes = terminalBase
    .filter((r) => r.token === 'RoadmapDark')
    .map((r) => ({ url: r.url, zoom: r.zoom, phase: r.phase, status: r.status }));

  return {
    totalVtRequests: vt.length,
    preNavigationRequests: {
      count: preNav.length,
      baseMapTiles: preNav.filter((r) => r.base).length,
      tokens: tally(preNav.filter((r) => r.base), 'token'),
      note: 'recorded before navigation, therefore extension-originated (e.g. a health probe); excluded from all assertions',
    },
    vtByBucket: tally(vt, 'bucket'),
    baseMapTileRequestsRaw: base.length,
    baseMapTileRequestsTerminal: terminalBase.length,
    baseMapTileRequestsSuperseded: superseded.length,
    byKind,
    harnessRewrites: vt.filter((r) => r.rewrittenByHarness).length,
    supersedeReasons: tally(superseded, 'supersededBy'),
    tokenCountsRaw: tally(base, 'token'),
    tokenCountsTerminal: tally(terminalBase, 'token'),
    distinctZoomsTerminal: distinctZooms,
    zoomsByToken,
    perPhase: Object.fromEntries(
      [...new Set(vt.map((r) => r.phase))].map((p) => [
        p,
        {
          vt: vt.filter((r) => r.phase === p).length,
          baseTerminal: terminalBase.filter((r) => r.phase === p).length,
          zooms: [
            ...new Set(terminalBase.filter((r) => r.phase === p).map((r) => r.zoom)),
          ].sort((a, b) => a - b),
          tokens: tally(terminalBase.filter((r) => r.phase === p), 'token'),
        },
      ])
    ),
    offenders,
    offenderSample: offenders.slice(0, 5).map((o) => o.url),
    darkSample: darkOnes.slice(0, 3).map((o) => o.url),
  };
}
