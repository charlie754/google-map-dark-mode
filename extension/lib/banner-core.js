(function () {
  "use strict";

  const REASONS = Object.freeze([
    "size", "sigline", "sig", "utf8", "json", "dupkey", "depth", "schema", "keyid",
    "field", "text", "url", "qr", "time", "revision", "floor", "equal", "photo-size",
    "photo-hash", "photo-dims", "photo-anim", "photo-decode",
  ]);
  const MAX_FILE_BYTES = 16384;
  const MAX_JSON_DEPTH = 32;
  const MAX_PHOTO_BYTES = 300000;
  const DAY_MS = 86400000;
  const MAX_REVISION = 9007199254740991;
  const PREFIX = new TextEncoder().encode("GOATCAM-BANNER-V1\n");
  const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

  function reject(reason) {
    return {
      action: "reject",
      reason,
      banner: null,
      revision: null,
      sha256: null,
    };
  }

  function bytesToHex(bytes) {
    let result = "";
    for (const byte of bytes) result += byte.toString(16).padStart(2, "0");
    return result;
  }

  async function sha256Hex(bytes) {
    const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
    return bytesToHex(new Uint8Array(digest));
  }

  function concatBytes(left, right) {
    const result = new Uint8Array(left.length + right.length);
    result.set(left, 0);
    result.set(right, left.length);
    return result;
  }

  async function keyIdOf(publicKeyRaw) {
    return (await sha256Hex(publicKeyRaw)).slice(0, 16);
  }

  function parserError(code) {
    const error = new Error(code);
    error.code = code;
    throw error;
  }

  function isJsonWhitespace(code) {
    return code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0d;
  }

  function skipJsonWhitespace(text, state) {
    while (state.index < text.length && isJsonWhitespace(text.charCodeAt(state.index))) {
      state.index += 1;
    }
  }

  function readHexEscape(text, state) {
    if (state.index + 4 > text.length) parserError("json");
    let value = 0;
    for (let i = 0; i < 4; i += 1) {
      const code = text.charCodeAt(state.index + i);
      let digit;
      if (code >= 0x30 && code <= 0x39) digit = code - 0x30;
      else if (code >= 0x41 && code <= 0x46) digit = code - 0x41 + 10;
      else if (code >= 0x61 && code <= 0x66) digit = code - 0x61 + 10;
      else parserError("json");
      value = value * 16 + digit;
    }
    state.index += 4;
    return value;
  }

  function parseJsonString(text, state) {
    if (text.charCodeAt(state.index) !== 0x22) parserError("json");
    state.index += 1;
    let value = "";
    while (state.index < text.length) {
      const code = text.charCodeAt(state.index);
      state.index += 1;
      if (code === 0x22) return { kind: "string", value };
      if (code === 0x5c) {
        if (state.index >= text.length) parserError("json");
        const escape = text.charCodeAt(state.index);
        state.index += 1;
        if (escape === 0x22) value += '"';
        else if (escape === 0x5c) value += "\\";
        else if (escape === 0x2f) value += "/";
        else if (escape === 0x62) value += "\b";
        else if (escape === 0x66) value += "\f";
        else if (escape === 0x6e) value += "\n";
        else if (escape === 0x72) value += "\r";
        else if (escape === 0x74) value += "\t";
        else if (escape === 0x75) {
          const first = readHexEscape(text, state);
          if (first >= 0xd800 && first <= 0xdbff) {
            if (text.charCodeAt(state.index) !== 0x5c || text.charCodeAt(state.index + 1) !== 0x75) {
              parserError("json");
            }
            state.index += 2;
            const second = readHexEscape(text, state);
            if (second < 0xdc00 || second > 0xdfff) parserError("json");
            value += String.fromCharCode(first, second);
          } else if (first >= 0xdc00 && first <= 0xdfff) {
            parserError("json");
          } else {
            value += String.fromCharCode(first);
          }
        } else {
          parserError("json");
        }
        continue;
      }
      if (code < 0x20) parserError("json");
      if (code >= 0xd800 && code <= 0xdbff) {
        const next = text.charCodeAt(state.index);
        if (next < 0xdc00 || next > 0xdfff) parserError("json");
        value += String.fromCharCode(code, next);
        state.index += 1;
        continue;
      }
      if (code >= 0xdc00 && code <= 0xdfff) parserError("json");
      value += String.fromCharCode(code);
    }
    parserError("json");
  }

  function parseJsonNumber(text, state) {
    const start = state.index;
    if (text.charCodeAt(state.index) === 0x2d) state.index += 1;
    if (state.index >= text.length) parserError("json");
    if (text.charCodeAt(state.index) === 0x30) {
      state.index += 1;
    } else if (text.charCodeAt(state.index) >= 0x31 && text.charCodeAt(state.index) <= 0x39) {
      state.index += 1;
      while (text.charCodeAt(state.index) >= 0x30 && text.charCodeAt(state.index) <= 0x39) {
        state.index += 1;
      }
    } else {
      parserError("json");
    }
    if (text.charCodeAt(state.index) === 0x2e) {
      state.index += 1;
      const fractionStart = state.index;
      while (text.charCodeAt(state.index) >= 0x30 && text.charCodeAt(state.index) <= 0x39) {
        state.index += 1;
      }
      if (state.index === fractionStart) parserError("json");
    }
    const exponent = text.charCodeAt(state.index);
    if (exponent === 0x65 || exponent === 0x45) {
      state.index += 1;
      const sign = text.charCodeAt(state.index);
      if (sign === 0x2b || sign === 0x2d) state.index += 1;
      const exponentStart = state.index;
      while (text.charCodeAt(state.index) >= 0x30 && text.charCodeAt(state.index) <= 0x39) {
        state.index += 1;
      }
      if (state.index === exponentStart) parserError("json");
    }
    const source = text.slice(start, state.index);
    return { kind: "number", value: Number(source), source };
  }

  function parseJsonArray(text, state, depth, maxDepth) {
    if (depth >= maxDepth) parserError("depth");
    state.maxDepth = Math.max(state.maxDepth, depth);
    state.index += 1;
    const items = [];
    skipJsonWhitespace(text, state);
    if (text.charCodeAt(state.index) === 0x5d) {
      state.index += 1;
      return { kind: "array", items };
    }
    while (true) {
      items.push(parseJsonValue(text, state, depth, maxDepth));
      skipJsonWhitespace(text, state);
      const separator = text.charCodeAt(state.index);
      if (separator === 0x5d) {
        state.index += 1;
        return { kind: "array", items };
      }
      if (separator !== 0x2c) parserError("json");
      state.index += 1;
      skipJsonWhitespace(text, state);
    }
  }

  function parseJsonObject(text, state, depth, maxDepth) {
    if (depth >= maxDepth) parserError("depth");
    state.maxDepth = Math.max(state.maxDepth, depth);
    state.index += 1;
    const properties = new Map();
    skipJsonWhitespace(text, state);
    if (text.charCodeAt(state.index) === 0x7d) {
      state.index += 1;
      return { kind: "object", properties };
    }
    while (true) {
      if (text.charCodeAt(state.index) !== 0x22) parserError("json");
      const key = parseJsonString(text, state).value;
      if (properties.has(key)) state.duplicate = true;
      skipJsonWhitespace(text, state);
      if (text.charCodeAt(state.index) !== 0x3a) parserError("json");
      state.index += 1;
      properties.set(key, parseJsonValue(text, state, depth, maxDepth));
      skipJsonWhitespace(text, state);
      const separator = text.charCodeAt(state.index);
      if (separator === 0x7d) {
        state.index += 1;
        return { kind: "object", properties };
      }
      if (separator !== 0x2c) parserError("json");
      state.index += 1;
      skipJsonWhitespace(text, state);
    }
  }

  function parseJsonValue(text, state, depth, maxDepth) {
    skipJsonWhitespace(text, state);
    const code = text.charCodeAt(state.index);
    if (code === 0x7b) return parseJsonObject(text, state, depth + 1, maxDepth);
    if (code === 0x5b) return parseJsonArray(text, state, depth + 1, maxDepth);
    if (code === 0x22) return parseJsonString(text, state);
    if (code === 0x2d || (code >= 0x30 && code <= 0x39)) return parseJsonNumber(text, state);
    if (text.startsWith("true", state.index)) {
      state.index += 4;
      return { kind: "boolean", value: true };
    }
    if (text.startsWith("false", state.index)) {
      state.index += 5;
      return { kind: "boolean", value: false };
    }
    if (text.startsWith("null", state.index)) {
      state.index += 4;
      return { kind: "null", value: null };
    }
    parserError("json");
  }

  function parseJsonNodes(text, maxDepth) {
    const state = { index: 0, duplicate: false, maxDepth: 0 };
    const limit = Number.isInteger(maxDepth) && maxDepth > 0 ? maxDepth : MAX_JSON_DEPTH;
    try {
      skipJsonWhitespace(text, state);
      const node = parseJsonValue(text, state, 0, limit);
      skipJsonWhitespace(text, state);
      if (state.index !== text.length) parserError("json");
      if (node.kind !== "object") return { ok: false, reason: "json" };
      if (state.duplicate) return { ok: false, reason: "dupkey" };
      return { ok: true, node, maxDepth: state.maxDepth };
    } catch (error) {
      if (error && error.code === "depth") {
        // R2: the hard stop at nesting 32 wins over every other row, including top-level arrays.
        return { ok: false, reason: "depth" };
      }
      return { ok: false, reason: "json" };
    }
  }

  // Returns {ok:true,value} or {ok:false,reason}; value contains strict JSON primitives.
  // maxDepth is the hard-stop container nesting depth: a container at that depth is rejected;
  // an omitted or invalid limit uses the R2 default stop at 32.
  function parseJson(text, maxDepth) {
    const parsed = parseJsonNodes(text, maxDepth);
    return parsed.ok ? { ok: true, value: nodeToValue(parsed.node) } : parsed;
  }

  function nodeToValue(node) {
    if (node.kind === "array") return node.items.map(nodeToValue);
    if (node.kind === "object") {
      const result = {};
      for (const [key, child] of node.properties) {
        Object.defineProperty(result, key, {
          value: nodeToValue(child),
          enumerable: true,
          configurable: true,
          writable: true,
        });
      }
      return result;
    }
    return node.value;
  }

  function property(node, name) {
    return node && node.kind === "object" ? node.properties.get(name) : undefined;
  }

  function hasProperty(node, name) {
    return Boolean(node && node.kind === "object" && node.properties.has(name));
  }

  function isKind(node, kind) {
    return Boolean(node && node.kind === kind);
  }

  function isFiniteNumberNode(node) {
    return isKind(node, "number") && Number.isFinite(node.value);
  }

  function isWrittenInteger(node) {
    return isFiniteNumberNode(node)
      && Number.isInteger(node.value)
      && /^-?(?:0|[1-9][0-9]*)$/.test(node.source);
  }

  function isValidPublicKeyRaw(value) {
    return value instanceof Uint8Array && value.length === 65 && value[0] === 0x04;
  }

  function parseTimestamp(value) {
    if (typeof value !== "string") return null;
    const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})Z$/.exec(value);
    if (!match) return null;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const hour = Number(match[4]);
    const minute = Number(match[5]);
    const second = Number(match[6]);
    if (year < 2000 || year > 9999 || month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59) {
      return null;
    }
    const epochMs = Date.UTC(year, month - 1, day, hour, minute, second);
    if (!Number.isFinite(epochMs)) return null;
    const date = new Date(epochMs);
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1
      || date.getUTCDate() !== day || date.getUTCHours() !== hour
      || date.getUTCMinutes() !== minute || date.getUTCSeconds() !== second) {
      return null;
    }
    return epochMs;
  }

  function validUrl(value) {
    if (typeof value !== "string" || value.length > 200) return false;
    for (let i = 0; i < value.length; i += 1) {
      const code = value.charCodeAt(i);
      if (code < 0x21 || code > 0x7e) return false;
    }
    if (!value.startsWith("https://")) return false;
    const authorityEnd = value.slice(8).search(/[/?#]/);
    const authority = authorityEnd < 0 ? value.slice(8) : value.slice(8, 8 + authorityEnd);
    let host = authority;
    if (authority.endsWith(":443")) host = authority.slice(0, -4);
    if (host.length < 1 || host.length > 253) return false;
    const labels = host.split(".");
    if (labels.length < 2) return false;
    for (const label of labels) {
      if (!/^[A-Za-z0-9-]{1,63}$/.test(label) || label.startsWith("-") || label.endsWith("-")) {
        return false;
      }
    }
    const last = labels[labels.length - 1];
    if (!/^(?:[A-Za-z]{2,63}|xn--[A-Za-z0-9-]{1,59})$/.test(last)) return false;
    return true;
  }

  function validText(value, minimum, maximum) {
    if (typeof value !== "string") return false;
    const characters = Array.from(value);
    if (characters.length < minimum || characters.length > maximum) return false;
    for (const character of characters) {
      const code = character.codePointAt(0);
      const inFirstRange = code >= 0x20 && code <= 0x7e;
      const inSecondRange = code >= 0xa0 && code <= 0xac;
      const inThirdRange = code >= 0xae && code <= 0x24f;
      const explicitlyAllowed = [0x2013, 0x2014, 0x2018, 0x2019, 0x201c, 0x201d, 0x2026, 0x2122].includes(code);
      if (!inFirstRange && !inSecondRange && !inThirdRange && !explicitlyAllowed) return false;
    }
    return true;
  }

  function validNumberArray(node, length) {
    return isKind(node, "array") && node.items.length === length
      && node.items.every((item) => isFiniteNumberNode(item) && item.value >= 0 && item.value <= 1);
  }

  function validatePhotoFields(node) {
    if (!isKind(node, "object")) return false;
    const webp = property(node, "webp");
    const jpg = property(node, "jpg");
    const hashes = property(node, "sha256");
    const width = property(node, "w");
    const height = property(node, "h");
    if (!isKind(webp, "string") || !/^[a-z0-9-]{1,64}\.webp$/.test(webp.value)) return false;
    if (!isKind(jpg, "string") || !/^[a-z0-9-]{1,64}\.jpg$/.test(jpg.value)) return false;
    if (!isKind(hashes, "object")) return false;
    const webpHash = property(hashes, "webp");
    const jpgHash = property(hashes, "jpg");
    if (!isKind(webpHash, "string") || !/^[0-9a-f]{64}$/.test(webpHash.value)) return false;
    if (!isKind(jpgHash, "string") || !/^[0-9a-f]{64}$/.test(jpgHash.value)) return false;
    if (!isWrittenInteger(width) || width.value < 1 || width.value > 1600) return false;
    if (!isWrittenInteger(height) || height.value < 1 || height.value > 1000) return false;
    if (!validNumberArray(property(node, "focus"), 2)) return false;
    if (!validNumberArray(property(node, "steamAt"), 2)) return false;
    const textBox = property(node, "textBox");
    if (!validNumberArray(textBox, 4)) return false;
    if (textBox.items[0].value + textBox.items[2].value > 1) return false;
    if (textBox.items[1].value + textBox.items[3].value > 1) return false;
    return true;
  }

  function validateFields(root) {
    const revision = property(root, "revision");
    const issued = property(root, "issued");
    const expires = property(root, "expires");
    const enabled = property(root, "enabled");
    if (!isWrittenInteger(revision) || revision.value < 1 || revision.value > MAX_REVISION) return null;
    if (!isKind(issued, "string") || !isKind(expires, "string")) return null;
    const issuedMs = parseTimestamp(issued.value);
    const expiresMs = parseTimestamp(expires.value);
    if (issuedMs === null || expiresMs === null || !isKind(enabled, "boolean")) return null;

    const base = { revision: revision.value, issuedMs, expiresMs, enabled: enabled.value };
    if (!enabled.value) return base;

    const headline = property(root, "headline");
    const headlineEm = property(root, "headlineEm");
    const wordmark = property(root, "wordmark");
    const tagline = property(root, "tagline");
    const effects = property(root, "effects");
    const link = property(root, "link");
    const qr = property(root, "qr");
    const photo = property(root, "photo");
    const labels = property(root, "labels");
    const badge = property(root, "badge");
    if (!isKind(headline, "string") || !isKind(wordmark, "string") || !isKind(tagline, "array")
      || !isKind(effects, "object") || !isKind(link, "string") || !isKind(qr, "object")
      || !isKind(photo, "object") || !isKind(labels, "object")) return null;
    if (hasProperty(root, "headlineEm") && !isKind(headlineEm, "string")) return null;
    if (hasProperty(root, "badge") && !isKind(badge, "string")) return null;
    if (tagline.items.length > 2 || tagline.items.some((item) => !isKind(item, "string"))) return null;
    const viewfinder = property(effects, "viewfinder");
    const steam = property(effects, "steam");
    if (!isKind(viewfinder, "boolean") || !isKind(steam, "boolean")) return null;

    const qrText = property(qr, "text");
    const qrSize = property(qr, "size");
    const qrRows = property(qr, "rows");
    if (!isKind(qrText, "string") || !isKind(qrSize, "number")
      || !/^-?(?:0|[1-9][0-9]*)$/.test(qrSize.source) || !isKind(qrRows, "array")
      || qrRows.items.some((item) => !isKind(item, "string"))) return null;
    const labelLink = property(labels, "link");
    const labelQr = property(labels, "qr");
    if (!isKind(labelLink, "string") || !isKind(labelQr, "string")) return null;
    if (!validatePhotoFields(photo)) return null;
    return base;
  }

  function validateTextFields(root) {
    const headline = property(root, "headline");
    const headlineEm = property(root, "headlineEm");
    const wordmark = property(root, "wordmark");
    const tagline = property(root, "tagline");
    const labels = property(root, "labels");
    if (!validText(headline.value, 1, 48) || !validText(wordmark.value, 1, 12)) return false;
    if (hasProperty(root, "headlineEm")
      && (!validText(headlineEm.value, 1, 48) || !headline.value.includes(headlineEm.value))) return false;
    if (tagline.items.some((item) => !validText(item.value, 1, 18))) return false;
    if (hasProperty(root, "badge") && !validText(property(root, "badge").value, 1, 16)) return false;
    if (!validText(property(labels, "link").value, 1, 80)) return false;
    if (!validText(property(labels, "qr").value, 1, 80)) return false;
    return true;
  }

  function validateQr(root) {
    const qr = property(root, "qr");
    if (property(qr, "size").source !== "37") return false;
    const rows = property(qr, "rows").items;
    if (rows.length !== 37) return false;
    return rows.every((row) => row.value.length === 37 && /^[01]+$/.test(row.value));
  }

  function decodeBase64Signature(line) {
    if (line.length !== 88 || line[86] !== 0x3d || line[87] !== 0x3d) return null;
    for (let i = 0; i < 86; i += 1) {
      if (BASE64_ALPHABET.indexOf(String.fromCharCode(line[i])) < 0) return null;
    }
    const result = new Uint8Array(64);
    let output = 0;
    for (let i = 0; i < 84; i += 4) {
      const a = BASE64_ALPHABET.indexOf(String.fromCharCode(line[i]));
      const b = BASE64_ALPHABET.indexOf(String.fromCharCode(line[i + 1]));
      const c = BASE64_ALPHABET.indexOf(String.fromCharCode(line[i + 2]));
      const d = BASE64_ALPHABET.indexOf(String.fromCharCode(line[i + 3]));
      result[output++] = (a << 2) | (b >> 4);
      result[output++] = (b << 4) | (c >> 2);
      result[output++] = (c << 6) | d;
    }
    const a = BASE64_ALPHABET.indexOf(String.fromCharCode(line[84]));
    const b = BASE64_ALPHABET.indexOf(String.fromCharCode(line[85]));
    if ((b & 0x0f) !== 0) return null;
    result[output] = (a << 2) | (b >> 4);
    return result;
  }

  function byteEqual(left, right) {
    if (left === null || right === null || left.length !== right.length) return false;
    for (let i = 0; i < left.length; i += 1) if (left[i] !== right[i]) return false;
    return true;
  }

  async function evaluate(signedBytes, ctx) {
    let lineEnd;
    let jsonBytes;
    let signature;
    const publicKeyRaw = ctx && ctx.publicKeyRaw;

    // RULES A1 row 1: reject an oversized complete signed file.
    try {
      if (signedBytes.length > MAX_FILE_BYTES) return reject("size");
    } catch (_) {
      return reject("size");
    }

    // RULES A1 row 2: require the exact 88-character standard-base64 signature line.
    try {
      lineEnd = -1;
      const searchLimit = Math.min(101, signedBytes.length);
      for (let i = 0; i < searchLimit; i += 1) {
        if (signedBytes[i] === 0x0a) {
          lineEnd = i;
          break;
        }
      }
      if (lineEnd < 0) return reject("sigline");
      signature = decodeBase64Signature(signedBytes.subarray(0, lineEnd));
      if (signature === null) return reject("sigline");
      jsonBytes = signedBytes.subarray(lineEnd + 1);
    } catch (_) {
      return reject("sigline");
    }

    // RULES A1 row 3: verify the domain-separated P-256 ECDSA signature.
    try {
      if (!isValidPublicKeyRaw(publicKeyRaw)) return reject("sig");
      const publicKey = await globalThis.crypto.subtle.importKey(
        "raw",
        publicKeyRaw,
        { name: "ECDSA", namedCurve: "P-256" },
        false,
        ["verify"],
      );
      const verified = await globalThis.crypto.subtle.verify(
        { name: "ECDSA", hash: "SHA-256" },
        publicKey,
        signature,
        concatBytes(PREFIX, jsonBytes),
      );
      if (!verified) return reject("sig");
    } catch (_) {
      return reject("sig");
    }

    let text;
    // RULES A1 row 4: decode JSON bytes with fatal UTF-8 and a preserved BOM.
    try {
      text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(jsonBytes);
    } catch (_) {
      return reject("utf8");
    }

    // RULES A1 rows 5-7: parse strict JSON, then classify syntax, duplicate, and depth.
    const parsed = parseJsonNodes(text, MAX_JSON_DEPTH);
    if (!parsed.ok) return reject(parsed.reason);
    if (!isKind(parsed.node, "object")) return reject("json");
    if (parsed.maxDepth > 3) return reject("depth");
    const root = parsed.node;

    // RULES A1 row 8: schema is the numeric value one.
    const schema = property(root, "schema");
    if (!isWrittenInteger(schema) || schema.value !== 1) return reject("schema");

    // RULES A1 row 9: keyId must match the compiled public point.
    try {
      const expectedKeyId = await keyIdOf(publicKeyRaw);
      const keyId = property(root, "keyId");
      if (!isKind(keyId, "string") || keyId.value !== expectedKeyId) return reject("keyid");
    } catch (_) {
      return reject("keyid");
    }

    // RULES A1 row 10 / A2: validate the required field shapes and ranges.
    let fields;
    try {
      fields = validateFields(root);
    } catch (_) {
      return reject("field");
    }
    if (fields === null) return reject("field");

    if (fields.enabled) {
      // RULES A1 row 11 / A3: validate code-point counts and allowed text characters.
      try {
        if (!validateTextFields(root)) return reject("text");
      } catch (_) {
        return reject("text");
      }

      // RULES A1 row 12 / A4: validate both HTTPS URLs and their host grammar.
      try {
        if (!validUrl(property(root, "link").value) || !validUrl(property(property(root, "qr"), "text").value)) {
          return reject("url");
        }
      } catch (_) {
        return reject("url");
      }

      // RULES A1 row 13: require the 37-by-37 binary QR matrix.
      try {
        if (!validateQr(root)) return reject("qr");
      } catch (_) {
        return reject("qr");
      }
    }

    // RULES A1 row 14: validate the clock window after exact timestamp parsing.
    try {
      if (typeof ctx.nowMs !== "number" || !Number.isFinite(ctx.nowMs)
        || fields.issuedMs > ctx.nowMs + DAY_MS
        || ctx.nowMs >= fields.expiresMs
        || fields.expiresMs - fields.issuedMs > 400 * DAY_MS
        || fields.expiresMs <= fields.issuedMs) return reject("time");
    } catch (_) {
      return reject("time");
    }

    // RULES A1 row 15: reject revisions below the persisted high-water mark.
    try {
      if (!Number.isSafeInteger(ctx.hwm) || ctx.hwm < 0 || fields.revision < ctx.hwm) return reject("revision");
    } catch (_) {
      return reject("revision");
    }

    // RULES A1 row 16: reject revisions below the deployment floor.
    try {
      if (!Number.isSafeInteger(ctx.floor) || ctx.floor < 0 || fields.revision < ctx.floor) return reject("floor");
    } catch (_) {
      return reject("floor");
    }

    // RULES A1 row 17: equal revisions require byte-identical stored bytes when supplied.
    try {
      if (fields.revision === ctx.hwm && ctx.storedBytes !== null && ctx.storedBytes !== undefined) {
        if (!(ctx.storedBytes instanceof Uint8Array) || !byteEqual(signedBytes, ctx.storedBytes)) {
          return reject("equal");
        }
      }
    } catch (_) {
      return reject("equal");
    }

    let fileHash;
    try {
      fileHash = await sha256Hex(signedBytes);
    } catch (_) {
      return reject("sig");
    }
    let banner;
    try {
      banner = nodeToValue(root);
    } catch (_) {
      return reject("field");
    }
    return {
      action: fields.enabled ? "show" : "killswitch",
      reason: null,
      banner,
      revision: fields.revision,
      sha256: fileHash,
    };
  }

  function asciiAt(bytes, offset, text) {
    if (offset + text.length > bytes.length) return false;
    for (let i = 0; i < text.length; i += 1) {
      if (bytes[offset + i] !== text.charCodeAt(i)) return false;
    }
    return true;
  }

  function readUint32Little(bytes, offset) {
    return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16)
      | (bytes[offset + 3] << 24)) >>> 0;
  }

  function readWebpHeader(bytes) {
    if (bytes.length < 12 || !asciiAt(bytes, 0, "RIFF") || !asciiAt(bytes, 8, "WEBP")) return null;
    let offset = 12;
    let first = true;
    let dimensions = null;
    let animated = false;
    while (offset < bytes.length) {
      if (bytes.length - offset < 8) return null;
      const fourCC = offset;
      const size = readUint32Little(bytes, offset + 4);
      const dataStart = offset + 8;
      const dataEnd = dataStart + size;
      if (dataEnd > bytes.length) return null;
      if (asciiAt(bytes, fourCC, "ANIM") || asciiAt(bytes, fourCC, "ANMF")) animated = true;
      if (asciiAt(bytes, fourCC, "VP8X") && size >= 1 && (bytes[dataStart] & 0x02) !== 0) animated = true;

      if (first) {
        if (asciiAt(bytes, fourCC, "VP8 ")) {
          if (size < 10 || bytes[dataStart + 3] !== 0x9d || bytes[dataStart + 4] !== 0x01
            || bytes[dataStart + 5] !== 0x2a) return null;
          dimensions = {
            w: (bytes[dataStart + 6] | (bytes[dataStart + 7] << 8)) & 0x3fff,
            h: (bytes[dataStart + 8] | (bytes[dataStart + 9] << 8)) & 0x3fff,
          };
        } else if (asciiAt(bytes, fourCC, "VP8L")) {
          if (size < 5 || bytes[dataStart] !== 0x2f) return null;
          const bits = (bytes[dataStart + 1] | (bytes[dataStart + 2] << 8)
            | (bytes[dataStart + 3] << 16) | (bytes[dataStart + 4] << 24)) >>> 0;
          dimensions = { w: (bits & 0x3fff) + 1, h: ((bits >>> 14) & 0x3fff) + 1 };
        } else if (asciiAt(bytes, fourCC, "VP8X")) {
          if (size < 10) return null;
          dimensions = {
            w: (bytes[dataStart + 4] | (bytes[dataStart + 5] << 8) | (bytes[dataStart + 6] << 16)) + 1,
            h: (bytes[dataStart + 7] | (bytes[dataStart + 8] << 8) | (bytes[dataStart + 9] << 16)) + 1,
          };
        } else {
          return null;
        }
        first = false;
      }
      if ((size & 1) !== 0 && dataEnd < bytes.length) offset = dataEnd + 1;
      else offset = dataEnd;
      if (offset > bytes.length) return null;
    }
    return first ? null : { ...dimensions, animated };
  }

  function isJpegSof(marker) {
    return (marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7)
      || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf);
  }

  function readJpegHeader(bytes) {
    if (bytes.length < 2 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
    let offset = 2;
    while (offset < bytes.length) {
      if (bytes[offset] !== 0xff) return null;
      while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
      if (offset >= bytes.length) return null;
      const marker = bytes[offset];
      offset += 1;
      if (marker === 0xda || marker === 0xd9 || marker === 0x00) return null;
      if (isJpegSof(marker)) {
        if (offset + 2 > bytes.length) return null;
        const segmentLength = (bytes[offset] << 8) | bytes[offset + 1];
        if (segmentLength < 7 || offset + segmentLength > bytes.length || offset + 7 > bytes.length) return null;
        return {
          w: (bytes[offset + 5] << 8) | bytes[offset + 6],
          h: (bytes[offset + 3] << 8) | bytes[offset + 4],
          animated: false,
        };
      }
      if (marker >= 0xd0 && marker <= 0xd8 || marker === 0x01) continue;
      if (offset + 2 > bytes.length) return null;
      const segmentLength = (bytes[offset] << 8) | bytes[offset + 1];
      if (segmentLength < 2 || offset + segmentLength > bytes.length) return null;
      offset += segmentLength;
    }
    return null;
  }

  async function checkPhoto(bytes, spec) {
    // RULES A6 photo-size: reject empty images and images over 300,000 bytes.
    try {
      if (bytes.length === 0 || bytes.length > MAX_PHOTO_BYTES) return { ok: false, reason: "photo-size" };
    } catch (_) {
      return { ok: false, reason: "photo-size" };
    }

    // RULES A6 photo-hash: compare the complete byte sequence to the named SHA-256.
    try {
      if (await sha256Hex(bytes) !== spec.sha256) return { ok: false, reason: "photo-hash" };
    } catch (_) {
      return { ok: false, reason: "photo-hash" };
    }

    let header;
    // RULES A6 photo-dims: read the format header without decoding the image.
    try {
      header = spec.kind === "webp" ? readWebpHeader(bytes) : readJpegHeader(bytes);
      if (header === null || header.w !== spec.w || header.h !== spec.h) {
        return { ok: false, reason: "photo-dims" };
      }
    } catch (_) {
      return { ok: false, reason: "photo-dims" };
    }

    // RULES A6 photo-anim: reject WebP animation flags and animation chunks.
    if (spec.kind === "webp" && header.animated) return { ok: false, reason: "photo-anim" };
    return { ok: true, reason: null };
  }

  const api = { REASONS, keyIdOf, evaluate, checkPhoto, parseJson };
  globalThis.GoatBannerCore = api;
  if (typeof module !== "undefined" && module && module.exports) module.exports = api;
})();
