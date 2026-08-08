/**
 * Classification of Google Maps `/maps/vt/` traffic.
 *
 * Base-map tiles look like:
 *   https://www.google.com/maps/vt/pb=!1m4!1m3!1i{z}!2i{x}!3i{y}!2m3!1e0!2sm!3i{ver}
 *     !3m8!2sen!3sus!5e1105!12m4!1e68!2m2!1sset!2sRoadmap!4e0!5m1!1e0!23i{exp}...
 *
 * The `!12m4!1e68!2m2!1sset!2s<Style>` group is the server-side style selector.
 * The extension under test rewrites `!2sRoadmap!` -> `!2sRoadmapDark!`.
 */

import { bpbOf, protoStyleToken, protoTileCoords } from './bpb.mjs';

export const VT_PATH = '/maps/vt/';
export const STYLE_MARKER = '!1sset!2s';
export const LIGHT_TOKEN = 'Roadmap';
export const DARK_TOKEN = 'RoadmapDark';

/** Any request to the vector-tile endpoint (base map, imagery thumbs, signed data tiles). */
export function isVtRequest(url) {
  return typeof url === 'string' && url.includes(VT_PATH);
}

/**
 * A base-map raster tile: the `pb=` protobuf-ish form, layer `!2sm!` (map),
 * carrying an explicit style selector. Imagery thumbnails (`!2m2!1e1`, `!4i128`)
 * and signed `data=` tiles do not match.
 */
export function isBaseMapTile(url) {
  return (
    isVtRequest(url) &&
    url.includes('/maps/vt/pb=') &&
    url.includes('!2sm!') &&
    url.includes(STYLE_MARKER)
  );
}

/** The style token: the value after `!1sset!2s`, up to the next `!`. */
export function styleToken(url) {
  const i = url.indexOf(STYLE_MARKER);
  if (i < 0) return null;
  const rest = url.slice(i + STYLE_MARKER.length);
  const j = rest.indexOf('!');
  return j < 0 ? rest : rest.slice(0, j);
}

/** Tile coordinates from the `!1m3!1i{z}!2i{x}!3i{y}` group. */
export function tileCoords(url) {
  const strict = url.match(/!1m3!1i(\d+)!2i(\d+)!3i(\d+)/);
  const m = strict ?? url.match(/!1i(\d+)!2i(\d+)!3i(\d+)/);
  if (!m) return null;
  return { z: Number(m[1]), x: Number(m[2]), y: Number(m[3]) };
}

/** Zoom level of a base-map tile, or null. */
export function tileZoom(url) {
  return tileCoords(url)?.z ?? null;
}

/** The URL this one becomes after the extension's rewrite (used to pair redirect halves). */
export function darkTwin(url) {
  const i = url.indexOf(STYLE_MARKER + LIGHT_TOKEN + '!');
  if (i < 0) return null;
  return (
    url.slice(0, i) +
    STYLE_MARKER +
    DARK_TOKEN +
    url.slice(i + STYLE_MARKER.length + LIGHT_TOKEN.length)
  );
}

/* ------------------------------------------------------------------------ *
 * The protobuf form.
 *
 * The task spec defined a base-map tile as "URL contains /maps/vt/pb= AND !2sm!
 * AND !1sset!2s". Measured against live Maps that definition sees only the
 * initial raster paint: 24 tiles at one zoom, none at all during pan or zoom.
 * Every base-map request after first paint goes to /maps/vt/proto?bpb=<base64
 * protobuf>, which carries the identical `set:<Style>` selector in binary (see
 * bpb.mjs). A harness that could not see those requests would have reported
 * "interaction-time tiles do not exist" -- vacuously passing or failing on an
 * empty set. Both forms are therefore classified, and reported separately so no
 * reader has to take the merge on trust.
 * ------------------------------------------------------------------------ */

export function isProtoTileRequest(url) {
  return typeof url === 'string' && url.includes('/maps/vt/proto') && url.includes('bpb=');
}

/** 'raster' | 'proto' | null -- which base-map transport this request uses. */
export function baseMapKind(url) {
  if (isBaseMapTile(url)) return 'raster';
  if (isProtoTileRequest(url)) {
    const buf = bpbOf(url);
    if (buf && protoStyleToken(buf) !== null) return 'proto';
  }
  return null;
}

export function isAnyBaseMapTile(url) {
  return baseMapKind(url) !== null;
}

/** Style token for either transport. */
export function styleTokenOf(url) {
  const kind = baseMapKind(url);
  if (kind === 'raster') return styleToken(url);
  if (kind === 'proto') return protoStyleToken(bpbOf(url));
  return null;
}

/** Tile coords for either transport. */
export function tileCoordsOf(url) {
  const kind = baseMapKind(url);
  if (kind === 'raster') return tileCoords(url);
  if (kind === 'proto') return protoTileCoords(bpbOf(url));
  return null;
}

export function tileZoomOf(url) {
  return tileCoordsOf(url)?.z ?? null;
}

/** Coarse bucket for `/maps/vt/` traffic, for the report only. */
export function vtBucket(url) {
  const kind = baseMapKind(url);
  if (kind === 'raster') return 'basemap-raster';
  if (kind === 'proto') return 'basemap-proto';
  if (url.includes('/maps/vt/proto')) return 'proto-no-style';
  if (url.includes('/maps/vt/icon/')) return 'poi-icon';
  if (url.includes('/maps/vt/data=')) return 'signed-data';
  if (url.includes('!4i128') || url.includes('!2m2!1e1')) return 'imagery-thumb';
  if (url.includes('/maps/vt/pb=')) return 'vt-pb-other';
  return 'vt-other';
}

/** The zoom the Maps page believes it is at, parsed from the address bar. */
export function urlZoom(pageUrl) {
  const m = String(pageUrl).match(/@(-?[\d.]+),(-?[\d.]+),([\d.]+)z/);
  return m ? { lat: Number(m[1]), lng: Number(m[2]), zoom: Number(m[3]) } : null;
}
