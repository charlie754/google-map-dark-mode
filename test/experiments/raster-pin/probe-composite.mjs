#!/usr/bin/env node
/**
 * The no-WASM arm keeps Maps' full UI chrome but paints the map from a tile
 * shape nobody in this project has classified before:
 *
 *   /maps/vt/pb=!1m8!3m7!1m2!1u{px}!2u{py}!2m2!1u2048!2u1536!3i{z}
 *                !2m3!1e0!2sm!3i{ver}!3m3!2sen!3sus!5e1105!4e4!11m2!1e2!2b1
 *
 * One 2048x1536 stitched image for the whole viewport, `!4e4` format -- and
 * critically **no `!1sset!2s<Style>` group at all**. Both the shipped DNR rule
 * and every route rewrite in this repo key on that group, so this shape is
 * invisible to them, which is exactly why that arm renders light.
 *
 * Question: can the style group be INSERTED? In the ordinary tile URL it lives
 * inside the `!3m8` locale message:
 *   !3m8!2sen!3sus!5e1105!12m4!1e68!2m2!1sset!2sRoadmapDark
 * The composite carries the same message with three items instead of eight:
 *   !3m3!2sen!3sus!5e1105
 * So the edit is a pure string substitution -- 3m3 -> 3m8 plus five appended
 * items -- which a declarativeNetRequest regexSubstitution can do.
 *
 * This probe answers only "does Google's server honour it", with no browser.
 *   node test/experiments/raster-pin/probe-composite.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyse } from '../../lib/image.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ARTIFACTS = path.join(HERE, 'artifacts');
fs.mkdirSync(ARTIFACTS, { recursive: true });

const EXP = '!23i100818990!23i1368782!23i1368785!23i4861626!23i10211310!23i1381938';

/** Houston, z12, as observed in the e3-nowasm-* runs. */
const COMPOSITE =
  'https://www.google.com/maps/vt/pb=!1m8!3m7!1m2!1u245504!2u432640!2m2!1u2048!2u1536!3i12' +
  '!2m3!1e0!2sm!3i790!3m3!2sen!3sus!5e1105!4e4!11m2!1e2!2b1' +
  EXP;

/** The ordinary single tile, as the shipped DNR rule already handles it. */
const TILE =
  'https://www.google.com/maps/vt/pb=!1m4!1m3!1i12!2i962!3i1693!2m3!1e0!2sm!3i789555512' +
  '!3m8!2sen!3sus!5e1105!12m4!1e68!2m2!1sset!2s{STYLE}!4e0!5m1!1e0' +
  EXP;

/** The candidate rewrite: grow the !3m3 locale message to !3m8 and append the style. */
export function injectStyle(url, style) {
  return url.replace(
    /!3m3!2sen!3sus!5e1105!/,
    `!3m8!2sen!3sus!5e1105!12m4!1e68!2m2!1sset!2s${style}!`
  );
}

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/141.0.0.0 Safari/537.36';

async function fetchPng(name, url) {
  const t0 = Date.now();
  let resp;
  try {
    resp = await fetch(url, {
      headers: { 'user-agent': UA, accept: 'image/avif,image/webp,image/png,*/*' },
    });
  } catch (err) {
    return { name, url, error: String(err.message) };
  }
  const buf = Buffer.from(await resp.arrayBuffer());
  const out = {
    name,
    url,
    status: resp.status,
    contentType: resp.headers.get('content-type'),
    bytes: buf.length,
    ms: Date.now() - t0,
  };
  const file = path.join(ARTIFACTS, `composite-${name}.png`);
  fs.writeFileSync(file, buf);
  out.file = `test/experiments/raster-pin/artifacts/composite-${name}.png`;
  try {
    const px = analyse(buf);
    out.meanRgb = { r: px.r, g: px.g, b: px.b };
    out.luminance = px.luminance;
    out.size = `${px.width}x${px.height}`;
    out.verdict = px.isDark ? 'DARK' : px.isLight ? 'LIGHT' : 'AMBIGUOUS';
  } catch (err) {
    out.decodeError = String(err.message);
    // Google's "unknown style" error tile is a 178-byte solid yellow PNG; a
    // decode failure usually means we got HTML or a redirect page instead.
    out.head = buf.subarray(0, 24).toString('latin1').replace(/[^\x20-\x7e]/g, '.');
  }
  return out;
}

const cases = [
  ['tile-Roadmap', TILE.replace('{STYLE}', 'Roadmap')],
  ['tile-RoadmapDark', TILE.replace('{STYLE}', 'RoadmapDark')],
  ['composite-asis', COMPOSITE],
  ['composite-injected-Roadmap', injectStyle(COMPOSITE, 'Roadmap')],
  ['composite-injected-RoadmapDark', injectStyle(COMPOSITE, 'RoadmapDark')],
];

const results = [];
for (const [name, url] of cases) {
  const r = await fetchPng(name, url);
  results.push(r);
  console.log(
    `${name.padEnd(32)} status=${r.status ?? 'ERR'} bytes=${String(r.bytes ?? '-').padStart(8)} ` +
      `${String(r.contentType ?? '').padEnd(12)} size=${(r.size ?? '-').padEnd(10)} ` +
      `meanRGB=${r.meanRgb ? `(${r.meanRgb.r}, ${r.meanRgb.g}, ${r.meanRgb.b})` : '-'} ` +
      `${r.verdict ?? r.decodeError ?? ''}`
  );
  await new Promise((res) => setTimeout(res, 400));
}

fs.writeFileSync(
  path.join(ARTIFACTS, 'result-probe-composite.json'),
  JSON.stringify({ ranAt: new Date().toISOString(), results }, null, 2)
);
console.log('\nwrote test/experiments/raster-pin/artifacts/result-probe-composite.json');
