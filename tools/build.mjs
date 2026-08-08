#!/usr/bin/env node
/**
 * Maps Noir build.
 *
 * Zero dependencies, stock Node ESM. Run from anywhere:
 *
 *     node tools/build.mjs
 *
 * Emits two directly-loadable unpacked extensions:
 *
 *     dist/chrome/    <- extension/** with manifest.chrome.json  as manifest.json
 *     dist/firefox/   <- extension/** with manifest.firefox.json as manifest.json
 *
 * There is no bundler and no transpile step on purpose: extension/background.js
 * has to remain valid both as a Chrome ESM service worker and as a Firefox
 * classic event-page script, so it is copied verbatim.
 */

import { readdir, readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { dirname, join, posix, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "extension");
const DIST = join(ROOT, "dist");

/** Per-target manifest variants. These are never copied verbatim. */
const TARGETS = [
  { name: "chrome", manifest: "manifest.chrome.json" },
  { name: "firefox", manifest: "manifest.firefox.json" },
];

const MANIFEST_VARIANTS = new Set(TARGETS.map((t) => t.manifest));

/**
 * Recursively list files under `dir`, returned as POSIX-style paths relative to
 * `dir`. POSIX separators keep the emitted log stable across platforms and let
 * us compare against manifest paths, which are always forward-slashed.
 *
 * @param {string} dir
 * @param {string} [prefix]
 * @returns {Promise<string[]>}
 */
async function listFiles(dir, prefix = "") {
  const entries = await readdir(dir, { withFileTypes: true });
  const out = [];
  for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const rel = prefix ? posix.join(prefix, entry.name) : entry.name;
    if (entry.isDirectory()) {
      out.push(...(await listFiles(join(dir, entry.name), rel)));
    } else if (entry.isFile()) {
      out.push(rel);
    }
  }
  return out;
}

/**
 * @param {string} file absolute path
 * @param {Buffer} bytes
 */
async function emit(file, bytes) {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, bytes);
}

/**
 * Parse JSON and re-throw with the offending path attached, so a build failure
 * names the file instead of dumping a bare SyntaxError.
 *
 * @param {string} label
 * @param {Buffer|string} contents
 * @returns {unknown}
 */
function parseJson(label, contents) {
  try {
    return JSON.parse(contents.toString("utf8"));
  } catch (err) {
    throw new Error(`invalid JSON in ${label}: ${err.message}`, { cause: err });
  }
}

/**
 * Cross-check that every path a manifest points at actually landed in dist.
 * A manifest that references a missing rules file, background script or
 * content script makes the browser refuse the whole extension, and that
 * failure is invisible until load time — which is exactly when a harness would
 * misread it as the approach failing.
 *
 * Content scripts matter most here because they are the one part of the
 * manifest written by a different lane than the manifest itself: declaring
 * `content/theme.js` before it exists must fail the build loudly rather than
 * emit a dist/ that Chrome silently refuses.
 *
 * @param {string} target
 * @param {any} manifest
 * @param {Set<string>} emittedRelPaths
 */
function checkReferences(target, manifest, emittedRelPaths) {
  /** @type {string[]} */
  const referenced = [];

  const bg = manifest?.background;
  if (bg?.service_worker) referenced.push(bg.service_worker);
  if (Array.isArray(bg?.scripts)) referenced.push(...bg.scripts);

  for (const cs of manifest?.content_scripts ?? []) {
    if (Array.isArray(cs?.js)) referenced.push(...cs.js);
    if (Array.isArray(cs?.css)) referenced.push(...cs.css);
  }

  for (const rs of manifest?.declarative_net_request?.rule_resources ?? []) {
    if (rs?.path) referenced.push(rs.path);
  }
  for (const icon of Object.values(manifest?.icons ?? {})) referenced.push(icon);
  const defaultIcon = manifest?.action?.default_icon;
  if (typeof defaultIcon === "string") referenced.push(defaultIcon);
  else for (const icon of Object.values(defaultIcon ?? {})) referenced.push(icon);

  const missing = referenced.filter((p) => !emittedRelPaths.has(p));
  if (missing.length > 0) {
    throw new Error(
      `dist/${target}/manifest.json references files that were not emitted: ${missing.join(", ")}`,
    );
  }
  return referenced.length;
}

async function build() {
  const sourceFiles = await listFiles(SRC);
  const payload = sourceFiles.filter((f) => !MANIFEST_VARIANTS.has(f));

  if (payload.length === 0) {
    throw new Error(`no source files found under ${SRC}`);
  }
  for (const { manifest } of TARGETS) {
    if (!sourceFiles.includes(manifest)) {
      throw new Error(`missing manifest variant: extension/${manifest}`);
    }
  }

  let grandTotal = 0;

  for (const target of TARGETS) {
    const outDir = join(DIST, target.name);
    await rm(outDir, { recursive: true, force: true });
    await mkdir(outDir, { recursive: true });

    /** @type {Array<{rel: string, bytes: number}>} */
    const emitted = [];

    for (const rel of payload) {
      const bytes = await readFile(join(SRC, ...rel.split("/")));
      await emit(join(outDir, ...rel.split("/")), bytes);
      emitted.push({ rel, bytes: bytes.length });
    }

    const manifestBytes = await readFile(join(SRC, target.manifest));
    parseJson(`extension/${target.manifest}`, manifestBytes); // fail before emitting
    await emit(join(outDir, "manifest.json"), manifestBytes);
    emitted.push({ rel: "manifest.json", bytes: manifestBytes.length });

    // Validate every emitted .json by re-reading it from disk, not by trusting
    // the in-memory copy: this is what proves the artifact on disk is loadable.
    const emittedRel = new Set(emitted.map((e) => e.rel));
    let manifest = null;
    let jsonChecked = 0;
    for (const { rel } of emitted) {
      if (!rel.endsWith(".json")) continue;
      const parsed = parseJson(`dist/${target.name}/${rel}`, await readFile(join(outDir, ...rel.split("/"))));
      if (rel === "manifest.json") manifest = parsed;
      jsonChecked++;
    }
    const refs = checkReferences(target.name, manifest, emittedRel);

    const subtotal = emitted.reduce((n, e) => n + e.bytes, 0);
    grandTotal += subtotal;

    console.log(`dist/${target.name}/  (from extension/${target.manifest})`);
    for (const { rel, bytes } of emitted.sort((a, b) => (a.rel < b.rel ? -1 : 1))) {
      console.log(`  ${relative(ROOT, join(outDir, ...rel.split("/"))).split(sep).join("/")}  ${bytes} bytes`);
    }
    console.log(`  -- ${emitted.length} files, ${subtotal} bytes, ${jsonChecked} JSON file(s) parsed OK, ${refs} manifest reference(s) resolved`);
    console.log("");
  }

  console.log(`TOTAL ${grandTotal} bytes across ${TARGETS.length} target(s)`);
}

build().catch((err) => {
  console.error(`build failed: ${err.message}`);
  if (err.cause) console.error(err.cause);
  process.exitCode = 1;
});
