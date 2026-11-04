import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createHash, webcrypto } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const clientDir = path.dirname(fileURLToPath(import.meta.url));
const vectorsDir = path.resolve(clientDir, '..', 'vectors');
const manifest = JSON.parse(fs.readFileSync(path.join(vectorsDir, 'cases.json'), 'utf8'));
const corePath = path.join(clientDir, 'banner-core.js');
const coreSource = fs.readFileSync(corePath, 'utf8');
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const PREFIX = encoder.encode('GOATCAM-BANNER-V1\n');
const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

await import(pathToFileURL(corePath).href);
const core = globalThis.GoatBannerCore;

const bytesFromHex = (hex) => {
  assert.match(hex, /^(?:[0-9a-fA-F]{2})+$/);
  return Uint8Array.from(hex.match(/../g), (pair) => Number.parseInt(pair, 16));
};

const bytesFromFile = (relativePath) => new Uint8Array(
  fs.readFileSync(path.join(vectorsDir, relativePath)),
);

const sha256Hex = (bytes) => createHash('sha256').update(bytes).digest('hex');

function concatBytes(...parts) {
  const result = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function cloneBanner(banner) {
  return JSON.parse(JSON.stringify(banner));
}

function spacedJson(json) {
  let result = '';
  let inString = false;
  let escaped = false;
  for (const character of json) {
    if (inString) {
      result += character;
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') {
      inString = true;
      result += character;
    } else if (character === ':' || character === ',') {
      result += `${character} \t`;
    } else {
      result += character;
    }
  }
  return `\n \t${result}\r\n`;
}

function replaceJsonToken(json, key, token) {
  const pattern = new RegExp(`("${key}"\\s*:\\s*)-?(?:0|[1-9][0-9]*)(?:\\.[0-9]+)?(?:[eE][+-]?[0-9]+)?`);
  return json.replace(pattern, `$1${token}`);
}

function resultShape(result, expectedAction, expectedReason, signedBytes) {
  assert.equal(result.action, expectedAction);
  assert.equal(result.reason, expectedReason);
  if (expectedAction === 'reject') {
    assert.equal(result.banner, null);
    assert.equal(result.revision, null);
    assert.equal(result.sha256, null);
  } else {
    assert.equal(typeof result.revision, 'number');
    assert.ok(result.banner && typeof result.banner === 'object');
    assert.equal(result.revision, result.banner.revision);
    assert.equal(result.sha256, sha256Hex(signedBytes));
    assert.match(result.sha256, /^[0-9a-f]{64}$/);
  }
}

test('banner core exposes the fixed interface', async () => {
  assert.ok(core);
  assert.deepEqual(core.REASONS, [
    'size', 'sigline', 'sig', 'utf8', 'json', 'dupkey', 'depth', 'schema', 'keyid',
    'field', 'text', 'url', 'qr', 'time', 'revision', 'floor', 'equal', 'photo-size',
    'photo-hash', 'photo-dims', 'photo-anim', 'photo-decode',
  ]);
  assert.equal(Object.isFrozen(core.REASONS), true);

  const publicKeyRaw = bytesFromHex(manifest.publicKeyHex);
  assert.equal(await core.keyIdOf(publicKeyRaw), manifest.keyId);
});

for (const entry of manifest.cases) {
  test(entry.name, async () => {
    const signedBytes = bytesFromFile(entry.file);
    const storedBytes = entry.stored === null ? null : bytesFromFile(entry.stored);
    const result = await core.evaluate(signedBytes, {
      publicKeyRaw: bytesFromHex(manifest.publicKeyHex),
      nowMs: Date.parse(entry.now),
      hwm: entry.hwm,
      floor: entry.floor,
      storedBytes,
    });
    resultShape(result, entry.expect, entry.reason, signedBytes);

    if (entry.photo !== null) {
      assert.ok(result.banner);
      const photoSpec = {
        kind: entry.photo.kind,
        sha256: result.banner.photo.sha256[entry.photo.kind],
        w: result.banner.photo.w,
        h: result.banner.photo.h,
      };
      const photoResult = await core.checkPhoto(bytesFromFile(entry.photo.file), photoSpec);
      assert.equal(photoResult.ok, entry.photo.expect === 'ok');
      assert.equal(photoResult.reason, entry.photo.expect === 'ok' ? null : entry.photo.expect);
    }
  });
}

test('classic script exposes the core and evaluates a valid banner', async () => {
  const context = { crypto: webcrypto, TextEncoder, TextDecoder };
  vm.runInNewContext(coreSource, context, { filename: corePath });
  assert.ok(context.GoatBannerCore);

  const valid = manifest.cases.find((entry) => entry.name === 'valid');
  const signedBytes = bytesFromFile(valid.file);
  const publicKeyRaw = bytesFromHex(manifest.publicKeyHex);
  const vmSignedBytes = vm.runInNewContext(`Uint8Array.from(${JSON.stringify([...signedBytes])})`, context);
  const vmPublicKeyRaw = vm.runInNewContext(`Uint8Array.from(${JSON.stringify([...publicKeyRaw])})`, context);
  const result = await context.GoatBannerCore.evaluate(vmSignedBytes, {
    publicKeyRaw: vmPublicKeyRaw,
    nowMs: Date.parse(valid.now),
    hwm: valid.hwm,
    floor: valid.floor,
    storedBytes: null,
  });
  resultShape(result, 'show', null, signedBytes);
});

test('parser applies the R2 depth stop to top-level arrays', () => {
  let nested = '0';
  for (let i = 0; i < 31; i += 1) nested = `[${nested}]`;
  const text = `[ {"a": 1, "a": 2}, ${nested} ]`;
  assert.deepEqual(core.parseJson(text), { ok: false, reason: 'depth' });
});

const ownKeyPair = await webcrypto.subtle.generateKey(
  { name: 'ECDSA', namedCurve: 'P-256' },
  true,
  ['sign', 'verify'],
);
const ownPublicKeyRaw = new Uint8Array(await webcrypto.subtle.exportKey('raw', ownKeyPair.publicKey));
const ownKeyId = await core.keyIdOf(ownPublicKeyRaw);
const validVector = manifest.cases.find((entry) => entry.name === 'valid');
const validVectorBytes = bytesFromFile(validVector.file);
const validVectorLf = validVectorBytes.indexOf(0x0a);
const ownBaseBanner = JSON.parse(decoder.decode(validVectorBytes.subarray(validVectorLf + 1)));
ownBaseBanner.keyId = ownKeyId;
const defaultContext = {
  publicKeyRaw: ownPublicKeyRaw,
  nowMs: Date.parse('2026-11-02T12:00:00Z'),
  hwm: 1,
  floor: 1,
  storedBytes: null,
};

async function signOwnJson(jsonText) {
  const jsonBytes = encoder.encode(jsonText);
  const signature = new Uint8Array(await webcrypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    ownKeyPair.privateKey,
    concatBytes(PREFIX, jsonBytes),
  ));
  assert.equal(signature.length, 64);
  return concatBytes(encoder.encode(`${Buffer.from(signature).toString('base64')}\n`), jsonBytes);
}

async function signOwnBanner(banner, jsonText = JSON.stringify(banner)) {
  return signOwnJson(jsonText);
}

async function signSizedOwnBanner(banner, totalLength) {
  const json = JSON.stringify(banner);
  const padding = totalLength - encoder.encode(json).length - 89;
  assert.ok(padding >= 0);
  return signOwnBanner(banner, `${json}${' '.repeat(padding)}`);
}

function ownBanner() {
  return cloneBanner(ownBaseBanner);
}

test('generated-key rule table covers whitespace, boundaries, and context failures', async () => {
  const rows = [
    {
      name: 'whitespace after every colon and comma and around object',
      reason: null,
      expect: 'show',
      mutate: () => {},
      jsonFactory: (banner) => spacedJson(JSON.stringify(banner)),
    },
    {
      name: 'pretty-printed JSON',
      reason: null,
      expect: 'show',
      mutate: () => {},
      jsonFactory: (banner) => JSON.stringify(banner, null, 2),
    },
    {
      name: 'spaced kill switch',
      reason: null,
      expect: 'killswitch',
      mutate: (banner) => { banner.enabled = false; },
      jsonFactory: (banner) => JSON.stringify(banner).replace('"enabled":false', '"enabled" : false'),
    },
    {
      name: 'schema 1.0',
      reason: 'schema',
      expect: 'reject',
      mutate: () => {},
      jsonFactory: (banner) => replaceJsonToken(JSON.stringify(banner), 'schema', '1.0'),
    },
    {
      name: 'schema 1e0',
      reason: 'schema',
      expect: 'reject',
      mutate: () => {},
      jsonFactory: (banner) => replaceJsonToken(JSON.stringify(banner), 'schema', '1e0'),
    },
    {
      name: 'exactly 16384 bytes',
      reason: null,
      expect: 'show',
      mutate: () => {},
      sized: 16384,
    },
    {
      name: '16385 bytes',
      reason: 'size',
      expect: 'reject',
      mutate: () => {},
      sized: 16385,
    },
    {
      name: 'line 1 is exactly 100 bytes with no LF in the first 101',
      reason: 'sigline',
      expect: 'reject',
      raw: () => encoder.encode('A'.repeat(100)),
    },
    {
      name: 'non-canonical base64 trailing bits',
      reason: 'sigline',
      expect: 'reject',
      raw: async () => {
        const signed = await signOwnBanner(ownBanner());
        const lineEnd = signed.indexOf(0x0a);
        const line = signed.slice(0, lineEnd);
        const value = BASE64_ALPHABET.indexOf(String.fromCharCode(line[85]));
        line[85] = BASE64_ALPHABET.charCodeAt(value ^ 1);
        return concatBytes(line, Uint8Array.of(0x0a), signed.subarray(lineEnd + 1));
      },
    },
    ...[
      [0x7f, 'U+007F'], [0xad, 'U+00AD'], [0x250, 'U+0250'], [0x2010, 'U+2010'],
    ].map(([code, name]) => ({
      name: `headline ${name}`,
      reason: 'text',
      expect: 'reject',
      mutate: (banner) => { banner.headline = `A${String.fromCodePoint(code)}`; },
    })),
    {
      name: 'headlineEm is not a substring',
      reason: 'text',
      expect: 'reject',
      mutate: (banner) => { banner.headline = 'GoatCam'; banner.headlineEm = 'Nope'; },
    },
    {
      name: 'tagline part has length 19',
      reason: 'text',
      expect: 'reject',
      mutate: (banner) => { banner.tagline = ['a'.repeat(19)]; },
    },
    {
      name: 'badge has length 17',
      reason: 'text',
      expect: 'reject',
      mutate: (banner) => { banner.badge = 'a'.repeat(17); },
    },
    {
      name: 'label has length 81',
      reason: 'text',
      expect: 'reject',
      mutate: (banner) => { banner.labels.link = 'a'.repeat(81); },
    },
    {
      name: 'URL label starts with hyphen',
      reason: 'url',
      expect: 'reject',
      mutate: (banner) => { banner.link = 'https://-goatcam.io/'; },
    },
    {
      name: 'URL label ends with hyphen',
      reason: 'url',
      expect: 'reject',
      mutate: (banner) => { banner.link = 'https://goatcam-.io/'; },
    },
    {
      name: 'URL label has 64 characters',
      reason: 'url',
      expect: 'reject',
      mutate: (banner) => { banner.link = `https://${'a'.repeat(64)}.com/`; },
    },
    {
      name: 'URL has a one-letter TLD',
      reason: 'url',
      expect: 'reject',
      mutate: (banner) => { banner.link = 'https://goatcam.d/'; },
    },
    {
      name: 'URL has an all-digit TLD',
      reason: 'url',
      expect: 'reject',
      mutate: (banner) => { banner.link = 'https://goatcam.123/'; },
    },
    {
      name: 'internationalized URL labels',
      reason: null,
      expect: 'show',
      mutate: (banner) => { banner.link = 'https://xn--d1acufc.xn--p1ai'; },
    },
    {
      name: 'explicit port 443',
      reason: null,
      expect: 'show',
      mutate: (banner) => { banner.link = 'https://goatcam.dagoat.io:443/'; },
    },
    {
      name: 'URL has 201 characters',
      reason: 'url',
      expect: 'reject',
      mutate: (banner) => { banner.link = `https://${'a'.repeat(63)}.${'b'.repeat(63)}.${'c'.repeat(63)}.com/`; },
    },
    {
      name: 'URL contains a non-ASCII character',
      reason: 'url',
      expect: 'reject',
      mutate: (banner) => { banner.link = 'https://goatcam.例子/'; },
    },
    {
      name: 'QR row contains 2',
      reason: 'qr',
      expect: 'reject',
      mutate: (banner) => { banner.qr.rows[0] = `${'0'.repeat(36)}2`; },
    },
    {
      name: 'textBox x plus width exceeds 1',
      reason: 'field',
      expect: 'reject',
      mutate: (banner) => { banner.photo.textBox = [0.5, 0, 0.6, 0]; },
    },
    {
      name: 'textBox y plus height exceeds 1',
      reason: 'field',
      expect: 'reject',
      mutate: (banner) => { banner.photo.textBox = [0, 0.5, 0, 0.6]; },
    },
    {
      name: 'photo width 1601',
      reason: 'field',
      expect: 'reject',
      mutate: (banner) => { banner.photo.w = 1601; },
    },
    {
      name: 'photo height 1001',
      reason: 'field',
      expect: 'reject',
      mutate: (banner) => { banner.photo.h = 1001; },
    },
    {
      name: 'revision is beyond the safe integer maximum',
      reason: 'field',
      expect: 'reject',
      mutate: (banner) => { banner.revision = 9007199254740992; },
    },
    {
      name: 'date 2027-02-29',
      reason: 'field',
      expect: 'reject',
      mutate: (banner) => { banner.issued = '2027-02-29T00:00:00Z'; },
    },
    {
      name: 'hour 24',
      reason: 'field',
      expect: 'reject',
      mutate: (banner) => { banner.issued = '2026-11-02T24:00:00Z'; },
    },
    {
      name: 'year 1999',
      reason: 'field',
      expect: 'reject',
      mutate: (banner) => { banner.issued = '1999-11-02T00:00:00Z'; },
    },
    {
      name: 'ctx hwm NaN',
      reason: 'revision',
      expect: 'reject',
      context: { hwm: Number.NaN },
    },
    {
      name: 'ctx floor -1',
      reason: 'floor',
      expect: 'reject',
      context: { floor: -1 },
    },
    {
      name: 'ctx nowMs NaN',
      reason: 'time',
      expect: 'reject',
      context: { nowMs: Number.NaN },
    },
    {
      name: 'ctx public key has 64 bytes',
      reason: 'sig',
      expect: 'reject',
      context: { publicKeyRaw: new Uint8Array(64) },
    },
    {
      name: 'ctx storedBytes undefined means absent',
      reason: null,
      expect: 'show',
      context: { hwm: ownBaseBanner.revision, storedBytes: undefined },
    },
    {
      name: 'ctx storedBytes string fails equal',
      reason: 'equal',
      expect: 'reject',
      context: { hwm: ownBaseBanner.revision, storedBytes: 'abc' },
    },
  ];

  for (const row of rows) {
    const banner = ownBanner();
    row.mutate?.(banner);
    let signedBytes;
    if (row.raw) signedBytes = await row.raw();
    else if (row.sized) signedBytes = await signSizedOwnBanner(banner, row.sized);
    else signedBytes = await signOwnBanner(banner, row.jsonFactory?.(banner));
    const result = await core.evaluate(signedBytes, { ...defaultContext, ...(row.context || {}) });
    resultShape(result, row.expect, row.reason, signedBytes);
  }
});

function writeUint32Little(bytes, offset, value) {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >>> 8) & 0xff;
  bytes[offset + 2] = (value >>> 16) & 0xff;
  bytes[offset + 3] = (value >>> 24) & 0xff;
}

function webpChunk(fourCC, data, includePad = true) {
  const pad = includePad && data.length % 2 === 1 ? 1 : 0;
  const result = new Uint8Array(8 + data.length + pad);
  result.set(encoder.encode(fourCC), 0);
  writeUint32Little(result, 4, data.length);
  result.set(data, 8);
  return result;
}

function webpFile(chunks) {
  const body = concatBytes(...chunks);
  const result = new Uint8Array(12 + body.length);
  result.set(encoder.encode('RIFF'), 0);
  writeUint32Little(result, 4, body.length + 4);
  result.set(encoder.encode('WEBP'), 8);
  result.set(body, 12);
  return result;
}

function vp8xData(w = 800, h = 498, animated = false) {
  const data = new Uint8Array(10);
  data[0] = animated ? 0x02 : 0;
  data[4] = (w - 1) & 0xff;
  data[5] = ((w - 1) >>> 8) & 0xff;
  data[6] = ((w - 1) >>> 16) & 0xff;
  data[7] = (h - 1) & 0xff;
  data[8] = ((h - 1) >>> 8) & 0xff;
  data[9] = ((h - 1) >>> 16) & 0xff;
  return data;
}

function vp8lData(w = 800, h = 498) {
  const bits = (w - 1) | ((h - 1) << 14);
  return Uint8Array.of(0x2f, bits & 0xff, (bits >>> 8) & 0xff, (bits >>> 16) & 0xff, (bits >>> 24) & 0xff);
}

test('constructed photo rows cover header and trailing-byte boundaries', async () => {
  const vp8x = webpChunk('VP8X', vp8xData());
  const rows = [
    { name: '0-byte photo', bytes: new Uint8Array(), kind: 'webp', reason: 'photo-size' },
    {
      name: 'VP8X animation flag only',
      bytes: webpFile([webpChunk('VP8X', vp8xData(800, 498, true))]),
      kind: 'webp',
      reason: 'photo-anim',
    },
    {
      name: 'lone ANIM chunk',
      bytes: webpFile([vp8x, webpChunk('ANIM', new Uint8Array())]),
      kind: 'webp',
      reason: 'photo-anim',
    },
    {
      name: 'lone ANMF chunk',
      bytes: webpFile([vp8x, webpChunk('ANMF', new Uint8Array())]),
      kind: 'webp',
      reason: 'photo-anim',
    },
    {
      name: 'VP8L known-size header',
      bytes: webpFile([webpChunk('VP8L', vp8lData())]),
      kind: 'webp',
      reason: null,
    },
    {
      name: 'JPEG with FF fill bytes before SOF',
      bytes: Uint8Array.of(0xff, 0xd8, 0xff, 0xff, 0xc0, 0x00, 0x07, 0x08, 0x01, 0xf2, 0x03, 0x20),
      kind: 'jpg',
      reason: null,
    },
    {
      name: 'WebP missing only final pad byte',
      bytes: webpFile([webpChunk('VP8L', vp8lData(), false)]),
      kind: 'webp',
      reason: null,
    },
    {
      name: 'WebP with three trailing garbage bytes',
      bytes: concatBytes(webpFile([vp8x]), Uint8Array.of(0xaa, 0xbb, 0xcc)),
      kind: 'webp',
      reason: 'photo-dims',
    },
  ];

  for (const row of rows) {
    const result = await core.checkPhoto(row.bytes, {
      kind: row.kind,
      sha256: sha256Hex(row.bytes),
      w: 800,
      h: 498,
    });
    assert.deepEqual(result, { ok: row.reason === null, reason: row.reason });
  }
});
