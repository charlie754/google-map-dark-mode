/**
 * Dump the protobuf tree of a /maps/vt/proto?bpb= URL (or a raw base64url blob)
 * so the fields around the `set:<Style>` selector can be read by eye.
 *
 * Usage: node dump-proto.mjs "<url or bpb blob>"
 */
import { decodeB64Url, parseMessage } from '../../lib/bpb.mjs';

function tryParse(buf) {
  if (buf.length === 0) return null;
  try {
    return parseMessage(buf);
  } catch {
    return null;
  }
}

const PRINTABLE = /^[\x20-\x7e]+$/;

function dump(buf, indent, path, out) {
  const fields = tryParse(buf);
  if (!fields) return false;
  for (const f of fields) {
    const p = `${path}.${f.no}`;
    if (f.wire === 0) {
      out.push(`${indent}${p}: varint ${f.value}`);
    } else if (f.wire === 2) {
      const s = f.bytes.toString('latin1');
      const sub = [];
      const ok = f.bytes.length > 0 && dump(f.bytes, indent + '  ', p, sub);
      if (ok && !(PRINTABLE.test(s) && s.length < 24)) {
        out.push(`${indent}${p}: msg(${f.bytes.length})`);
        out.push(...sub);
      } else if (PRINTABLE.test(s)) {
        out.push(`${indent}${p}: str "${s}"`);
      } else {
        out.push(
          `${indent}${p}: bytes(${f.bytes.length}) ${f.bytes.subarray(0, 32).toString('hex')}${
            f.bytes.length > 32 ? '…' : ''
          }`,
        );
      }
    } else {
      out.push(`${indent}${p}: wire${f.wire} ${f.bytes.toString('hex')}`);
    }
  }
  return true;
}

const arg = process.argv[2];
let blob = arg;
if (arg.startsWith('http')) {
  blob = new URL(arg).searchParams.get('bpb');
}
const buf = decodeB64Url(blob);
const out = [];
dump(buf, '', '', out);
console.log(`bytes=${buf.length}`);
console.log(out.join('\n'));
