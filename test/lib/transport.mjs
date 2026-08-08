/**
 * Complete classification of every request the extension's four DNR rules can
 * touch, across all three Google Maps renderer modes.
 *
 * `test/lib/tiles.mjs` predates the CompactLegend discovery: it knows only the
 * raster `pb=` and proto `bpb=` transports, so a run classified through it alone
 * cannot see the request that actually darkens mapcore and canvas+labeler. This
 * module is the superset. tiles.mjs is left untouched because the earlier gate
 * and the earlier experiment harnesses still import it.
 *
 *   #  transport   URL shape                                    rewritable?
 *   -  ----------  -------------------------------------------  -----------
 *   1  legend      www.gstatic.com/maps/res/CompactLegend-S-V    yes (rules 1,2)
 *   2  stream      <host>/maps/vt/stream/pb=...!1sset!2sS!...    yes (rule 3)
 *   3  raster      <host>/maps/vt/pb=...!2sm!...!1sset!2sS!...   yes (rule 4)
 *   4  proto       <host>/maps/vt/proto?bpb=<base64 protobuf>    NO
 *
 * "Rewritable" is not a style choice, it is a fact about the wire format: the
 * proto transport carries the style token as a length-prefixed protobuf string
 * three nested length prefixes deep (see bpb.mjs), and a DNR regexSubstitution
 * cannot recompute a length prefix. A proto tile therefore keeps saying
 * `Roadmap` even when the extension is working perfectly -- mapcore takes its
 * palette from the CompactLegend asset, not from that token. A2 is asserted over
 * the rewritable transports and the proto count is reported beside it, never
 * folded in, because folding it in either fabricates a failure or hides one.
 */

import { bpbOf, protoStyleToken, protoTileCoords } from './bpb.mjs';

export const LIGHT_TOKENS = ['Roadmap', 'Terrain'];
export const DARK_OF = { Roadmap: 'RoadmapDark', Terrain: 'TerrainDark' };
export const DARK_TOKENS = ['RoadmapDark', 'TerrainDark'];

const SET_MARK = '!1sset!2s';
const LEGEND_PREFIX = 'https://www.gstatic.com/maps/res/CompactLegend-';

/* --------------------------------------------------------------- CompactLegend */

/** `https://www.gstatic.com/maps/res/CompactLegend-<Style>-<32 hex>` */
export function legendParts(url) {
  if (typeof url !== 'string' || !url.startsWith(LEGEND_PREFIX)) return null;
  const tail = url.slice(LEGEND_PREFIX.length);
  const m = tail.match(/^([A-Za-z0-9]+)-([0-9a-f]{6,})$/);
  if (!m) return { style: tail, version: null, malformed: true };
  return { style: m[1], version: m[2], malformed: false };
}

export function isLegendRequest(url) {
  return legendParts(url) !== null;
}

/* --------------------------------------------------------------------- stream */

export function isStreamRequest(url) {
  return typeof url === 'string' && url.includes('/maps/vt/stream/pb=');
}

/** The `!<n>e<k>!2s<layer>!` group: `m` is the base map, `crisis2`/`lore-rec` overlays. */
export function streamLayer(url) {
  return url.match(/!1e\d+!2s([A-Za-z0-9_-]+)!/)?.[1] ?? null;
}

/* ---------------------------------------------------------------------- raster */

export function isRasterRequest(url) {
  return (
    typeof url === 'string' &&
    url.includes('/maps/vt/pb=') &&
    url.includes('!2sm!') &&
    url.includes(SET_MARK)
  );
}

/* ----------------------------------------------------------------------- proto */

export function isProtoRequest(url) {
  return typeof url === 'string' && url.includes('/maps/vt/proto') && url.includes('bpb=');
}

/* ------------------------------------------------------------------ shared bits */

/** The ASCII `!1sset!2s<Style>` selector, used by both raster and stream. */
export function asciiStyleToken(url) {
  const i = url.indexOf(SET_MARK);
  if (i < 0) return null;
  const rest = url.slice(i + SET_MARK.length);
  const j = rest.indexOf('!');
  return j < 0 ? rest : rest.slice(0, j);
}

export function asciiTileCoords(url) {
  const m = url.match(/!1m3!1i(\d+)!2i(\d+)!3i(\d+)/) ?? url.match(/!1i(\d+)!2i(\d+)!3i(\d+)/);
  return m ? { z: Number(m[1]), x: Number(m[2]), y: Number(m[3]) } : null;
}

/**
 * Classify one URL.
 *
 * @param {string} url
 * @returns {{
 *   transport: 'legend'|'stream'|'raster'|'proto'|null,
 *   baseMap: boolean, rewritable: boolean,
 *   token: string|null, dark: boolean|null,
 *   zoom: number|null, coords: object|null,
 *   legendVersion: string|null, bucket: string
 * }}
 */
export function classifyRequest(url) {
  const none = {
    transport: null,
    baseMap: false,
    rewritable: false,
    token: null,
    dark: null,
    zoom: null,
    coords: null,
    legendVersion: null,
    bucket: 'other',
  };
  if (typeof url !== 'string') return none;

  const legend = legendParts(url);
  if (legend) {
    const dark = DARK_TOKENS.includes(legend.style);
    const light = LIGHT_TOKENS.includes(legend.style);
    return {
      transport: 'legend',
      // A palette asset is not a tile, but it IS the thing that decides whether
      // the base map is dark in mapcore and canvas+labeler. It is counted as a
      // base-map request for A2 and excluded from A1's zoom tally (it has none).
      baseMap: dark || light,
      rewritable: dark || light,
      token: legend.style,
      dark: dark ? true : light ? false : null,
      zoom: null,
      coords: null,
      legendVersion: legend.version,
      bucket: dark || light ? 'legend-basemap' : `legend-other:${legend.style}`,
    };
  }

  if (isStreamRequest(url)) {
    const token = asciiStyleToken(url);
    const layer = streamLayer(url);
    const isBase = layer === 'm' && token !== null;
    const coords = asciiTileCoords(url);
    return {
      transport: 'stream',
      baseMap: isBase,
      rewritable: isBase,
      token,
      dark: token === null ? null : DARK_TOKENS.includes(token),
      zoom: coords?.z ?? null,
      coords,
      legendVersion: null,
      bucket: isBase ? 'stream-basemap' : `stream-other:${layer ?? '?'}`,
    };
  }

  if (isRasterRequest(url)) {
    const token = asciiStyleToken(url);
    const coords = asciiTileCoords(url);
    return {
      transport: 'raster',
      baseMap: true,
      rewritable: true,
      token,
      dark: token === null ? null : DARK_TOKENS.includes(token),
      zoom: coords?.z ?? null,
      coords,
      legendVersion: null,
      bucket: 'raster-basemap',
    };
  }

  if (isProtoRequest(url)) {
    const buf = bpbOf(url);
    const token = buf ? protoStyleToken(buf) : null;
    const coords = buf ? protoTileCoords(buf) : null;
    return {
      transport: 'proto',
      baseMap: token !== null,
      // Not rewritable by any regexSubstitution -- see the header.
      rewritable: false,
      token,
      dark: token === null ? null : DARK_TOKENS.includes(token),
      zoom: coords?.z ?? null,
      coords,
      legendVersion: null,
      bucket: token !== null ? 'proto-basemap' : 'proto-no-style',
    };
  }

  if (typeof url === 'string' && url.includes('/maps/vt/')) {
    if (url.includes('/maps/vt/icon/')) return { ...none, bucket: 'poi-icon' };
    if (url.includes('/maps/vt/data=')) return { ...none, bucket: 'signed-data' };
    return { ...none, bucket: 'vt-other' };
  }
  return none;
}

/** Should this URL be recorded at all? Keeps the log to things the rules touch. */
export function isInteresting(url) {
  return (
    typeof url === 'string' &&
    (url.includes('/maps/vt/') || url.startsWith(LEGEND_PREFIX))
  );
}

/** Sorted-descending tally helper used by the summariser. */
function tally(rows, pick) {
  const out = {};
  for (const r of rows) {
    const k = String(pick(r));
    out[k] = (out[k] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(out).sort((a, b) => b[1] - a[1]));
}

/**
 * Roll up a list of recorded requests.
 *
 * Each row must carry: url, phase, at, status, resourceType, and the flags the
 * recorder derived (terminal / supersededBy). Rows in the `boot` phase happened
 * before navigation and are therefore extension-originated (the health probe) --
 * they are reported separately and never counted in an assertion.
 */
export function summariseTransports(rows) {
  const preNav = rows.filter((r) => r.phase === 'boot');
  const live = rows.filter((r) => r.phase !== 'boot');

  const byTransport = {};
  for (const t of ['legend', 'stream', 'raster', 'proto']) {
    const all = live.filter((r) => r.c.transport === t);
    const base = all.filter((r) => r.c.baseMap);
    const terminal = base.filter((r) => r.terminal);
    byTransport[t] = {
      requests: all.length,
      baseMapRaw: base.length,
      baseMapTerminal: terminal.length,
      superseded: base.length - terminal.length,
      rewritable: terminal.filter((r) => r.c.rewritable).length,
      tokensRaw: tally(base, (r) => r.c.token),
      tokensTerminal: tally(terminal, (r) => r.c.token),
      darkTerminal: terminal.filter((r) => r.c.dark === true).length,
      lightTerminal: terminal.filter((r) => r.c.dark === false).length,
      zooms: [...new Set(terminal.map((r) => r.c.zoom).filter(Number.isFinite))].sort(
        (a, b) => a - b
      ),
      phases: tally(terminal, (r) => r.phase),
      statuses: tally(terminal, (r) => r.status),
      sample: terminal.slice(0, 2).map((r) => r.url),
    };
  }

  const terminalBase = live.filter((r) => r.c.baseMap && r.terminal);
  const rewritable = terminalBase.filter((r) => r.c.rewritable);
  const offenders = rewritable
    .filter((r) => r.c.dark !== true)
    .map((r) => ({
      url: r.url,
      transport: r.c.transport,
      token: r.c.token,
      zoom: r.c.zoom,
      phase: r.phase,
      status: r.status,
      resourceType: r.resourceType,
    }));

  const zoomsAll = [
    ...new Set(terminalBase.map((r) => r.c.zoom).filter(Number.isFinite)),
  ].sort((a, b) => a - b);

  return {
    totalRecorded: live.length,
    preNavigation: {
      count: preNav.length,
      baseMap: preNav.filter((r) => r.c.baseMap).length,
      tokens: tally(preNav.filter((r) => r.c.baseMap), (r) => r.c.token),
      note: 'recorded before navigation -> extension-originated (health probe); excluded from every assertion',
    },
    buckets: tally(live, (r) => r.c.bucket),
    byTransport,
    baseMapTerminal: terminalBase.length,
    rewritableTerminal: rewritable.length,
    rewritableDark: rewritable.filter((r) => r.c.dark === true).length,
    nonRewritableTerminal: terminalBase.length - rewritable.length,
    distinctZooms: zoomsAll,
    zoomsByPhase: Object.fromEntries(
      [...new Set(live.map((r) => r.phase))].map((p) => [
        p,
        {
          recorded: live.filter((r) => r.phase === p).length,
          baseTerminal: terminalBase.filter((r) => r.phase === p).length,
          zooms: [
            ...new Set(
              terminalBase.filter((r) => r.phase === p).map((r) => r.c.zoom).filter(Number.isFinite)
            ),
          ].sort((a, b) => a - b),
          tokens: tally(terminalBase.filter((r) => r.phase === p), (r) => r.c.token),
        },
      ])
    ),
    legendVersionsSeen: [
      ...new Set(
        live.filter((r) => r.c.transport === 'legend').map((r) => r.c.legendVersion).filter(Boolean)
      ),
    ],
    offenders,
    offenderSample: offenders.slice(0, 5).map((o) => o.url),
    darkSample: rewritable
      .filter((r) => r.c.dark === true)
      .slice(0, 3)
      .map((r) => r.url),
  };
}
