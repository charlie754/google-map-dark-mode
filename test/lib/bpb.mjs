/**
 * `/maps/vt/proto?bpb=<base64url protobuf>` -- the endpoint Google Maps actually
 * uses for base-map data once the WASM renderer is warm.
 *
 * This is the same request the ASCII `/maps/vt/pb=!1m4!...` raster URL encodes,
 * in binary. Field-for-field:
 *
 *   ASCII                                   binary
 *   !1m4!1m3!1i{z}!2i{x}!3i{y}               0a .. 0a 08 08 {z} 10 {x} 18 {y}
 *   !12m4!1e68!2m2!1sset!2sRoadmap           62 12 08 44 12 0e 0a 03 "set" 12 07 "Roadmap"
 *
 * So the style selector survives into interaction-time traffic -- but as a
 * length-prefixed protobuf string, three nested length prefixes deep. Swapping
 * "Roadmap" (7 bytes) for "RoadmapDark" (11) changes the innermost length, the
 * enclosing submessage length, and the outer submessage length, and then shifts
 * every subsequent base64 character. A declarativeNetRequest `regexSubstitution`
 * cannot do arithmetic, so the plan's regex rewrite provably cannot reach this.
 *
 * The parser below exists so the harness can (a) read the style token and zoom
 * out of interaction-time requests, which is what the M0 gate actually turns on,
 * and (b) construct a correctly re-length-prefixed dark variant so we can ask
 * Google's server whether it would even honour it here.
 */

/* ------------------------------------------------------------- wire format */

function readVarint(buf, pos) {
  let result = 0n;
  let shift = 0n;
  for (;;) {
    if (pos >= buf.length) throw new Error('varint ran off the end');
    const b = buf[pos++];
    result |= BigInt(b & 0x7f) << shift;
    if ((b & 0x80) === 0) break;
    shift += 7n;
    if (shift > 70n) throw new Error('varint too long');
  }
  return [result, pos];
}

function writeVarint(value) {
  let v = BigInt(value);
  const out = [];
  do {
    let byte = Number(v & 0x7fn);
    v >>= 7n;
    if (v > 0n) byte |= 0x80;
    out.push(byte);
  } while (v > 0n);
  return Buffer.from(out);
}

/**
 * Strict parse: every byte must be consumed and every wire type known, so a
 * random byte string does not accidentally look like a message.
 * @returns {Array<{no:number, wire:number, bytes?:Buffer, value?:bigint}>}
 */
export function parseMessage(buf) {
  const fields = [];
  let pos = 0;
  while (pos < buf.length) {
    const [tag, p1] = readVarint(buf, pos);
    pos = p1;
    const no = Number(tag >> 3n);
    const wire = Number(tag & 7n);
    if (no === 0) throw new Error('field number 0');
    if (wire === 0) {
      const [value, p2] = readVarint(buf, pos);
      pos = p2;
      fields.push({ no, wire, value });
    } else if (wire === 1) {
      if (pos + 8 > buf.length) throw new Error('i64 overruns');
      fields.push({ no, wire, bytes: buf.subarray(pos, pos + 8) });
      pos += 8;
    } else if (wire === 2) {
      const [len, p2] = readVarint(buf, pos);
      pos = p2;
      const n = Number(len);
      if (pos + n > buf.length) throw new Error('len overruns');
      fields.push({ no, wire, bytes: buf.subarray(pos, pos + n) });
      pos += n;
    } else if (wire === 5) {
      if (pos + 4 > buf.length) throw new Error('i32 overruns');
      fields.push({ no, wire, bytes: buf.subarray(pos, pos + 4) });
      pos += 4;
    } else {
      throw new Error(`unsupported wire type ${wire}`);
    }
  }
  return fields;
}

export function serializeMessage(fields) {
  const parts = [];
  for (const f of fields) {
    parts.push(writeVarint((BigInt(f.no) << 3n) | BigInt(f.wire)));
    if (f.wire === 0) parts.push(writeVarint(f.value));
    else if (f.wire === 2) {
      parts.push(writeVarint(f.bytes.length));
      parts.push(f.bytes);
    } else parts.push(f.bytes);
  }
  return Buffer.concat(parts);
}

function tryParse(buf) {
  if (buf.length === 0) return null;
  try {
    return parseMessage(buf);
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ base64 */

export function decodeB64Url(s) {
  const norm = s.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(norm + '='.repeat((4 - (norm.length % 4)) % 4), 'base64');
}

export function encodeB64Url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** The `bpb` parameter of a /maps/vt/proto URL, decoded. Null if absent. */
export function bpbOf(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const raw = u.searchParams.get('bpb');
  if (!raw) return null;
  try {
    return decodeB64Url(raw);
  } catch {
    return null;
  }
}

/* ---------------------------------------------------- style token & coords */

/** Is this the `{1: "set", 2: "<Style>"}` pair? */
function isSetPair(fields) {
  return (
    fields.length === 2 &&
    fields[0].no === 1 &&
    fields[0].wire === 2 &&
    fields[0].bytes.toString('latin1') === 'set' &&
    fields[1].no === 2 &&
    fields[1].wire === 2
  );
}

/** Depth-first search for the style selector. Returns the token or null. */
export function protoStyleToken(buf) {
  const fields = tryParse(buf);
  if (!fields) return null;
  for (const f of fields) {
    if (f.wire !== 2) continue;
    const inner = tryParse(f.bytes);
    if (!inner) continue;
    if (isSetPair(inner)) return inner[1].bytes.toString('latin1');
    const deeper = protoStyleToken(f.bytes);
    if (deeper !== null) return deeper;
  }
  return null;
}

/**
 * Rewrite the style token, fixing every enclosing length prefix.
 * Returns the new buffer, or null if no style selector was found.
 */
export function patchStyleToken(buf, newToken) {
  const fields = tryParse(buf);
  if (!fields) return null;
  let changed = false;
  for (const f of fields) {
    if (f.wire !== 2 || changed) continue;
    const inner = tryParse(f.bytes);
    if (!inner) continue;
    if (isSetPair(inner)) {
      inner[1] = { no: 2, wire: 2, bytes: Buffer.from(newToken, 'latin1') };
      f.bytes = serializeMessage(inner);
      changed = true;
      break;
    }
    const patched = patchStyleToken(f.bytes, newToken);
    if (patched) {
      f.bytes = patched;
      changed = true;
      break;
    }
  }
  return changed ? serializeMessage(fields) : null;
}

/** Tile coordinates from the leading `1 { 1 { 1:z 2:x 3:y } }` group. */
export function protoTileCoords(buf) {
  const top = tryParse(buf);
  if (!top) return null;
  const f1 = top.find((f) => f.no === 1 && f.wire === 2);
  if (!f1) return null;
  const inner = tryParse(f1.bytes);
  if (!inner) return null;
  const g = inner.find((f) => f.no === 1 && f.wire === 2);
  if (!g) return null;
  const coords = tryParse(g.bytes);
  if (!coords) return null;
  const pick = (no) => {
    const f = coords.find((x) => x.no === no && x.wire === 0);
    return f ? Number(f.value) : null;
  };
  const z = pick(1);
  const x = pick(2);
  const y = pick(3);
  if (z === null || x === null || y === null) return null;
  return { z, x, y };
}

/** Build the same URL with a different style token, or null if not patchable. */
export function protoUrlWithStyle(url, newToken) {
  const buf = bpbOf(url);
  if (!buf) return null;
  const patched = patchStyleToken(buf, newToken);
  if (!patched) return null;
  const u = new URL(url);
  u.searchParams.set('bpb', encodeB64Url(patched));
  // URLSearchParams percent-encodes the base64url alphabet's '-' and '_' not at
  // all, but it does encode nothing else here; rebuild by hand to be certain the
  // server sees exactly the bytes we produced.
  const params = [...u.searchParams.entries()]
    .map(([k, v]) => `${k}=${k === 'bpb' ? encodeB64Url(patched) : encodeURIComponent(v)}`)
    .join('&');
  return `${u.origin}${u.pathname}?${params}`;
}
