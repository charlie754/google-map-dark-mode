#!/usr/bin/env node
/**
 * Store packaging for Google Map Dark Mode.
 *
 * Zero dependencies, stock Node ESM. Run from anywhere:
 *
 *     node tools/package.mjs
 *
 * Builds (by running tools/build.mjs, so the archives can never be made from a
 * stale dist/) and then emits:
 *
 *     dist/google-map-dark-mode-chrome-<version>.zip   -> Chrome Web Store
 *     dist/google-map-dark-mode-firefox-<version>.xpi  -> addons.mozilla.org
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS NOT `Compress-Archive`
 * ---------------------------------------------------------------------------
 * PowerShell's `Compress-Archive` writes WINDOWS path separators into the
 * archive's file names -- observed on this machine as `icons\icon-128.png`.
 * APPNOTE 4.4.17.1 requires forward slashes. Firefox's add-on manager SILENTLY
 * declines such an XPI: it never appears in the profile's extensions.json at
 * all, which reads exactly like a signature refusal and is not one. That cost a
 * previous lane a full round of debugging, so this uses the pure-JS stored-ZIP
 * writer at test/lib/zip.mjs, which builds the names itself with '/'.
 *
 * The writer is imported rather than reimplemented for the same reason the
 * ruleset is read from extension/ rather than copied: a second implementation is
 * a second thing to keep in step and the first thing to drift. The harness
 * already ships an XPI built by that exact function into a live Firefox.
 *
 * ---------------------------------------------------------------------------
 * WHAT IS VERIFIED, AND HOW
 * ---------------------------------------------------------------------------
 * Nothing here trusts the writer's own return value. Each archive is re-opened
 * FROM DISK and its central directory is parsed (readZipEntries below), and the
 * checks run against what that parse found:
 *
 *   - `manifest.json` is present at the archive ROOT (not one level down --
 *     both stores reject a package with a wrapper directory)
 *   - no entry name contains a backslash
 *   - no entry name is absolute, drive-qualified, or contains `..`
 *   - every file the build emitted is in the archive, and nothing else is
 *   - the version in the archived manifest is the version in the file name
 *
 * The version is read from the built manifests and never hard-coded. The two
 * manifests disagreeing is a hard failure: shipping Chrome 1.0.1 and Firefox
 * 1.0.0 from one commit is the kind of thing nobody notices until a user reports
 * a bug that was fixed on the other store.
 */

import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { zipDirectory, readZipEntries, readZipFiles } from "../test/lib/zip.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST = path.join(ROOT, "dist");
const BUILD = path.join(ROOT, "tools", "build.mjs");

/** Archive base name. Kept out of the manifest name so a rename of the shipped
 *  display name cannot silently change the file both stores index by. */
const SLUG = "google-map-dark-mode";

const TARGETS = [
  { name: "chrome", dir: "chrome", ext: "zip", store: "Chrome Web Store" },
  { name: "firefox", dir: "firefox", ext: "xpi", store: "addons.mozilla.org" },
];

/* -------------------------------------------------------------------------- */
/* helpers                                                                    */
/* -------------------------------------------------------------------------- */

function fail(message) {
  throw new Error(message);
}

/** Every file under `dir`, as POSIX-relative paths. */
function listFiles(dir, prefix = "") {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const rel = prefix ? `${prefix}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...listFiles(path.join(dir, e.name), rel));
    else if (e.isFile()) out.push(rel);
  }
  return out;
}

function sha256(file) {
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

const kb = (n) => `${(n / 1024).toFixed(1)} KiB`;

/**
 * The version every artifact is named after.
 *
 * Read from the BUILT manifests, so it is the version that is actually in the
 * package rather than the version someone meant to put there. A disagreement
 * between the two targets is fatal.
 *
 * @param {Array<{name: string, manifest: any}>} built
 * @returns {string}
 */
function agreedVersion(built) {
  const seen = new Map();
  for (const b of built) {
    const v = b.manifest?.version;
    if (typeof v !== "string" || v === "") {
      fail(`dist/${b.name}/manifest.json has no usable "version" (got ${JSON.stringify(v)})`);
    }
    seen.set(b.name, v);
  }
  const distinct = [...new Set(seen.values())];
  if (distinct.length !== 1) {
    fail(
      "the built manifests disagree on version: " +
        [...seen].map(([k, v]) => `${k}=${v}`).join(", ") +
        ". Both stores index by version; shipping two different ones from one commit means a fix " +
        "lands on one store and not the other. Fix extension/manifest.chrome.json and " +
        "extension/manifest.firefox.json before packaging."
    );
  }
  // Both stores require a dotted numeric version. Catch a typo here rather than
  // at upload, after the archive has been named after it.
  if (!/^\d+(\.\d+){0,3}$/.test(distinct[0])) {
    fail(`version ${JSON.stringify(distinct[0])} is not a plain dotted-number version`);
  }
  return distinct[0];
}

/**
 * Every check that has to hold for an archive to be worth uploading.
 * @param {string} archive
 * @param {string[]} expectedFiles POSIX-relative, from the built directory
 * @param {string} version
 */
function verifyArchive(archive, expectedFiles, version) {
  const entries = readZipEntries(archive);
  const names = entries.map((e) => e.name);
  const problems = [];

  if (!names.includes("manifest.json")) {
    problems.push(
      "manifest.json is not at the archive root. Both stores reject a package whose manifest " +
        "sits inside a wrapper directory."
    );
  }
  for (const e of entries) {
    if (e.rawBytes.includes(0x5c)) {
      problems.push(
        `entry "${e.name}" contains a backslash. APPNOTE 4.4.17.1 requires '/', and Firefox ` +
          "declines such an XPI without recording it anywhere."
      );
    }
    if (e.name.startsWith("/") || /^[A-Za-z]:/.test(e.name) || e.name.split("/").includes("..")) {
      problems.push(`entry "${e.name}" is not a safe relative path`);
    }
    if (e.method !== 0) problems.push(`entry "${e.name}" is not stored (method ${e.method})`);
    if (e.name.split("/").includes("_metadata")) {
      problems.push(
        `entry "${e.name}": Chrome writes _metadata/ into an unpacked extension directory when it ` +
          "loads it. It must never be uploaded."
      );
    }
  }

  const missing = expectedFiles.filter((f) => !names.includes(f));
  const extra = names.filter((n) => !expectedFiles.includes(n));
  if (missing.length) problems.push(`missing from the archive: ${missing.join(", ")}`);
  if (extra.length) problems.push(`in the archive but not in the build: ${extra.join(", ")}`);

  // The manifest INSIDE the archive, not the one on disk beside it.
  if (entries.some((e) => e.name === "manifest.json")) {
    const inside = readZipFiles(archive).get("manifest.json");
    let parsed = null;
    try {
      parsed = JSON.parse(inside.toString("utf8"));
    } catch (err) {
      problems.push(`the archived manifest.json is not valid JSON: ${err.message}`);
    }
    if (parsed && parsed.version !== version) {
      problems.push(
        `the archived manifest says version ${parsed.version} but the file is named ${version}`
      );
    }
  }

  if (problems.length) {
    fail(`${archive} is not shippable:\n  - ${problems.join("\n  - ")}`);
  }
  return entries;
}

/* -------------------------------------------------------------------------- */
/* the run                                                                    */
/* -------------------------------------------------------------------------- */

function build() {
  console.log("$ node tools/build.mjs");
  const r = spawnSync(process.execPath, [BUILD], { cwd: ROOT, stdio: "inherit" });
  if (r.error) throw r.error;
  if (r.status !== 0) fail(`tools/build.mjs exited ${r.status}; refusing to package a failed build`);
  console.log("");
}

async function main() {
  // Always rebuild. Packaging a dist/ that someone edited by hand, or that a
  // browser wrote _metadata/ into, is how a store gets an artifact nobody can
  // reproduce from the repo.
  build();

  const built = TARGETS.map((t) => {
    const dir = path.join(DIST, t.dir);
    const manifestPath = path.join(dir, "manifest.json");
    if (!fs.existsSync(manifestPath)) fail(`no built extension at ${dir}`);
    return {
      ...t,
      dir,
      files: listFiles(dir),
      manifest: JSON.parse(fs.readFileSync(manifestPath, "utf8")),
    };
  });

  const version = agreedVersion(built);
  console.log(`packaging ${JSON.stringify(built[0].manifest.name)} version ${version}`);
  console.log(
    `  version source: extension/manifest.chrome.json and extension/manifest.firefox.json ` +
      `(both ${version}) -- never hard-coded here`
  );
  console.log("");

  const emitted = [];
  for (const t of built) {
    const archive = path.join(DIST, `${SLUG}-${t.name}-${version}.${t.ext}`);
    fs.rmSync(archive, { force: true });
    const written = zipDirectory(t.dir, archive);
    const entries = verifyArchive(archive, t.files, version);

    const stat = fs.statSync(archive);
    emitted.push({ target: t, archive, entries, bytes: stat.size, sha256: sha256(archive) });

    console.log(`${t.store}`);
    console.log(`  ${path.relative(ROOT, archive).split(path.sep).join("/")}`);
    console.log(`  ${stat.size} bytes (${kb(stat.size)})   sha256 ${sha256(archive)}`);
    console.log(`  ${entries.length} entries, read back from the archive's own central directory:`);
    for (const e of entries) {
      console.log(`    ${e.name.padEnd(28)} ${String(e.size).padStart(8)} bytes  crc ${e.crc.toString(16).padStart(8, "0")}`);
    }
    const rootManifest = entries.some((e) => e.name === "manifest.json");
    const anyBackslash = entries.some((e) => e.rawBytes.includes(0x5c));
    console.log(
      `  manifest.json at root: ${rootManifest} | any backslash in any entry name: ${anyBackslash} | ` +
        `writer reported ${written.entries.length} entries`
    );
    console.log("");
  }

  console.log("-".repeat(96));
  for (const e of emitted) {
    console.log(
      `  ${e.target.name.padEnd(8)} ${path.relative(ROOT, e.archive).split(path.sep).join("/").padEnd(56)} ` +
        `${String(e.bytes).padStart(7)} bytes`
    );
  }
  console.log(
    "  both archives verified from disk: manifest.json at root, forward slashes only, stored entries,\n" +
      "  contents equal to the build output, archived version equal to the file name."
  );
  console.log("-".repeat(96));
  console.log("");
  console.log("Next: `npm run test:package` installs these two artifacts in real browsers and");
  console.log("proves they come up. Uploading either one is a human step -- see docs/store-listing.md.");
}

// Windows: import.meta.url is a percent-encoded file:/// URL, so comparing it to
// a hand-built string silently never matches on a path containing a space.
const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main().catch((err) => {
    console.error(`package failed: ${err.message}`);
    process.exitCode = 1;
  });
}

export { SLUG, TARGETS, DIST, agreedVersion, verifyArchive, listFiles };
