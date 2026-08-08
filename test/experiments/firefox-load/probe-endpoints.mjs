#!/usr/bin/env node
/**
 * Does the *vector* endpoint honour the style selector at all?
 *
 * The raster endpoint provably does (research doc: Roadmap 29 750 bytes light,
 * RoadmapDark 27 275 bytes dark). The open question after the Firefox runs is
 * whether `/maps/vt/stream/pb=...!1sset!2sRoadmapDark!4e1...` returns *dark*
 * vector data or merely the same geometry, with colour applied client-side.
 *
 * Fetches each URL once with each token and reports status + byte length +
 * content type. Two requests per endpoint, run once -- this is a live Google
 * endpoint, not a load test.
 */

const URLS = {
  'raster /maps/vt/pb= (control: known to honour the token)':
    'https://www.google.com/maps/vt/pb=!1m4!1m3!1i12!2i960!3i1691!2m3!1e0!2sm!3i790555512!3m8!2sen!3sus!5e1105!12m4!1e68!2m2!1sset!2sTOKEN!4e0!5m1!1e0',
  'vector /maps/vt/stream/pb= (the layer that actually paints after ~1.4s)':
    'https://www.google.com/maps/vt/stream/pb=!1m7!8m6!1m3!1i12!2i960!3i1691!2i6!3x16777215!2m3!1e0!2sm!3i790555512!3m8!2sen!3sus!5e1105!12m4!1e68!2m2!1sset!2sTOKEN!4e1!5m4!1e4!8m2!1e0!1e1!6m14!1e12!2i2!19m1!1e0!20m1!1e0!26m2!1b1!4b1!39b1!44e1!50e0!67m1!1e1',
};

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:153.0) Gecko/20100101 Firefox/153.0';

for (const [name, tmpl] of Object.entries(URLS)) {
  console.log(`\n=== ${name} ===`);
  const bodies = {};
  for (const token of ['Roadmap', 'RoadmapDark']) {
    const url = tmpl.replace('TOKEN', token);
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': UA, Accept: '*/*', Referer: 'https://www.google.com/maps/' },
      });
      const buf = Buffer.from(await res.arrayBuffer());
      bodies[token] = buf;
      console.log(
        `  ${token.padEnd(12)} HTTP ${res.status}  ${String(buf.length).padStart(7)} bytes  ` +
          `content-type=${res.headers.get('content-type')}`
      );
    } catch (err) {
      console.log(`  ${token.padEnd(12)} FAILED ${err.message}`);
    }
  }
  if (bodies.Roadmap && bodies.RoadmapDark) {
    const same = bodies.Roadmap.equals(bodies.RoadmapDark);
    console.log(
      `  -> payloads ${same ? 'IDENTICAL' : 'DIFFER'} ` +
        `(${bodies.Roadmap.length} vs ${bodies.RoadmapDark.length} bytes)`
    );
    if (!same) {
      let common = 0;
      const n = Math.min(bodies.Roadmap.length, bodies.RoadmapDark.length);
      while (common < n && bodies.Roadmap[common] === bodies.RoadmapDark[common]) common += 1;
      console.log(`     first differing byte at offset ${common}`);
    }
  }
}

/* What is /maps/vt/sxforms? It is fetched once per session and is the only
 * plausible carrier of a client-side style table. */
const SX = 'https://www.google.com/maps/vt/sxforms?v=4311471e3660cd049e8ede59d279b3ba';
console.log(`\n=== ${SX} ===`);
try {
  const res = await fetch(SX, { headers: { 'User-Agent': UA, Referer: 'https://www.google.com/maps/' } });
  const buf = Buffer.from(await res.arrayBuffer());
  console.log(`  HTTP ${res.status} ${buf.length} bytes content-type=${res.headers.get('content-type')}`);
  console.log(`  first 300 chars: ${JSON.stringify(buf.subarray(0, 300).toString('utf8'))}`);
} catch (err) {
  console.log(`  FAILED ${err.message}`);
}
