#!/usr/bin/env node
/**
 * Does the vector-stream endpoint actually *honour* the style selector, or does
 * it merely echo it back into a response that the client then colours itself?
 *
 * The tell, established in the research doc, is that the raster endpoint answers
 * a bogus style name with a 178-byte yellow error tile. If the stream endpoint
 * answers a bogus style name with a full-size normal payload, then it is not
 * reading the selector as a style at all -- and no URL rewrite can ever darken
 * the vector layer.
 *
 * Four requests total.
 */

const STREAM =
  'https://www.google.com/maps/vt/stream/pb=!1m7!8m6!1m3!1i12!2i960!3i1691!2i6!3x16777215!2m3!1e0!2sm!3i790555512!3m8!2sen!3sus!5e1105!12m4!1e68!2m2!1sset!2sTOKEN!4e1!5m4!1e4!8m2!1e0!1e1!6m14!1e12!2i2!19m1!1e0!20m1!1e0!26m2!1b1!4b1!39b1!44e1!50e0!67m1!1e1';
const RASTER =
  'https://www.google.com/maps/vt/pb=!1m4!1m3!1i12!2i960!3i1691!2m3!1e0!2sm!3i790555512!3m8!2sen!3sus!5e1105!12m4!1e68!2m2!1sset!2sTOKEN!4e0!5m1!1e0';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:153.0) Gecko/20100101 Firefox/153.0';

async function get(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: '*/*', Referer: 'https://www.google.com/maps/' },
  });
  const buf = Buffer.from(await res.arrayBuffer());
  return { status: res.status, bytes: buf.length, type: res.headers.get('content-type') };
}

for (const [name, tmpl] of [
  ['raster  /maps/vt/pb=', RASTER],
  ['stream  /maps/vt/stream/pb=', STREAM],
]) {
  for (const token of ['Roadmap', 'LaneDBogusStyleName']) {
    const r = await get(tmpl.replace('TOKEN', token));
    console.log(
      `${name.padEnd(30)} ${token.padEnd(20)} HTTP ${r.status} ${String(r.bytes).padStart(7)} bytes  ${r.type}`
    );
  }
}
console.log(
  '\nA bogus style name that yields a normal-size payload means the endpoint is not treating\n' +
    'the selector as a style; a 178-byte (raster) or error response means it is.'
);
