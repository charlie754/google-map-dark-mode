/**
 * A minimal, dependency-free ZIP writer and reader (stored / no compression).
 *
 * This exists because PowerShell's `Compress-Archive` writes Windows path
 * separators into the archive's file names -- observed here as
 * `icons\icon-128.png` -- and the ZIP spec (APPNOTE 4.4.17.1) requires forward
 * slashes. Firefox's add-on manager silently declined such an XPI: it never
 * appeared in the profile's extensions.json at all, which reads exactly like a
 * signature refusal and is not one.
 *
 * Stored entries are fine for an XPI; Firefox does not require deflate.
 *
 * The reader half is here rather than beside the packaging tool for one reason:
 * the whole point of reading an archive back is to check the bytes against what
 * the writer BELIEVES it wrote, and both halves living in one file is what keeps
 * the on-disk format described in exactly one place. `readZipEntries` parses the
 * central directory -- the index the stores and the browsers actually consult --
 * not the local headers, because a name can differ between the two and it is the
 * central directory that wins.
 */

import fs from 'node:fs';
import path from 'node:path';

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function walk(dir, prefix = '') {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const abs = path.join(dir, entry.name);
    // ZIP names always use '/', on every platform.
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...walk(abs, rel));
    else if (entry.isFile()) out.push({ name: rel, abs });
  }
  return out;
}

/**
 * Zip the contents of `srcDir` (its children at the archive root) to `destPath`.
 * @returns {{path: string, entries: string[], bytes: number}}
 */
export function zipDirectory(srcDir, destPath) {
  const files = walk(srcDir);
  if (!files.some((f) => f.name === 'manifest.json')) {
    throw new Error(`${srcDir} has no manifest.json at its root; that is not a loadable extension`);
  }

  const locals = [];
  const centrals = [];
  let offset = 0;

  // Fixed DOS timestamp (1980-01-01) so the archive is byte-reproducible.
  const dosTime = 0;
  const dosDate = 33;

  for (const f of files) {
    const data = fs.readFileSync(f.abs);
    const name = Buffer.from(f.name, 'utf8');
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0, 6); // flags
    local.writeUInt16LE(0, 8); // method: stored
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(dosTime, 12);
    central.writeUInt16LE(dosDate, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30); // extra
    central.writeUInt16LE(0, 32); // comment
    central.writeUInt16LE(0, 34); // disk
    central.writeUInt16LE(0, 36); // internal attrs
    central.writeUInt32LE(0, 38); // external attrs
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);

    offset += local.length + name.length + data.length;
  }

  const centralBuf = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  const out = Buffer.concat([...locals, centralBuf, eocd]);
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  fs.writeFileSync(destPath, out);
  return { path: destPath, entries: files.map((f) => f.name), bytes: out.length };
}

/* ------------------------------------------------------------------ reading */

/**
 * Parse a ZIP's central directory.
 *
 * `rawBytes` is carried alongside the decoded name on purpose: a name holding a
 * literal 0x5c must be detectable as a backslash even when the rest of the name
 * is not valid UTF-8, and `String.includes('\\')` on a lossily-decoded name is
 * not a reliable way to find that out.
 *
 * @param {string|Buffer} fileOrBuffer
 * @returns {Array<{name: string, rawBytes: number[], size: number, compressedSize: number, method: number, crc: number}>}
 */
export function readZipEntries(fileOrBuffer) {
  const buf = Buffer.isBuffer(fileOrBuffer) ? fileOrBuffer : fs.readFileSync(fileOrBuffer);
  const label = Buffer.isBuffer(fileOrBuffer) ? '<buffer>' : fileOrBuffer;

  // Scanned backwards: the EOCD is followed by a variable-length comment.
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error(`${label}: no end-of-central-directory record -- not a ZIP`);

  const count = buf.readUInt16LE(eocd + 10);
  const cdSize = buf.readUInt32LE(eocd + 12);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (cdOffset + cdSize > buf.length) {
    throw new Error(`${label}: central directory runs past the end of the file`);
  }

  const entries = [];
  let p = cdOffset;
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) {
      throw new Error(`${label}: bad central-directory header at byte ${p}`);
    }
    const nameLen = buf.readUInt16LE(p + 28);
    const raw = buf.subarray(p + 46, p + 46 + nameLen);
    entries.push({
      name: raw.toString('utf8'),
      rawBytes: [...raw],
      method: buf.readUInt16LE(p + 10),
      crc: buf.readUInt32LE(p + 16),
      compressedSize: buf.readUInt32LE(p + 20),
      size: buf.readUInt32LE(p + 24),
    });
    p += 46 + nameLen + extraAndComment(buf, p);
  }
  return entries;
}

function extraAndComment(buf, p) {
  return buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32);
}

/**
 * Read every stored entry's bytes, keyed by entry name.
 * Throws on any entry that is not stored -- this reader has no inflate.
 * @param {string} file
 * @returns {Map<string, Buffer>}
 */
export function readZipFiles(file) {
  const buf = fs.readFileSync(file);
  const out = new Map();
  let p = 0;
  while (p + 30 <= buf.length && buf.readUInt32LE(p) === 0x04034b50) {
    const method = buf.readUInt16LE(p + 8);
    const compressedSize = buf.readUInt32LE(p + 18);
    const nameLen = buf.readUInt16LE(p + 26);
    const extraLen = buf.readUInt16LE(p + 28);
    const name = buf.subarray(p + 30, p + 30 + nameLen).toString('utf8');
    const dataAt = p + 30 + nameLen + extraLen;
    if (method !== 0) throw new Error(`${file}: entry "${name}" is compressed (method ${method})`);
    out.set(name, buf.subarray(dataAt, dataAt + compressedSize));
    p = dataAt + compressedSize;
  }
  return out;
}

/**
 * Extract a stored archive into `destDir`.
 *
 * Every name is re-validated here even though the writer produced it: this is
 * the function that turns an archive entry into a filesystem path, and an
 * archive is untrusted input by definition. `..`, absolute paths and
 * drive-qualified paths are refused rather than sanitised.
 *
 * @param {string} file
 * @param {string} destDir
 * @returns {string[]} the entry names written, in archive order
 */
export function extractZipTo(file, destDir) {
  const files = readZipFiles(file);
  const written = [];
  for (const [name, bytes] of files) {
    const parts = name.split('/');
    if (name.includes('\\') || name.startsWith('/') || /^[A-Za-z]:/.test(name) || parts.includes('..')) {
      throw new Error(`${file}: refusing to extract unsafe entry name "${name}"`);
    }
    const abs = path.join(destDir, ...parts);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, bytes);
    written.push(name);
  }
  return written;
}
