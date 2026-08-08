#!/usr/bin/env node
/**
 * Builds `ext-variant/` -- a byte-for-byte copy of the shipped `dist/firefox`
 * add-on with ONE difference: the declarativeNetRequest ruleset also covers the
 * `/maps/vt/stream/pb=` endpoint.
 *
 * This is a Lane D experiment, not a change to the product. `extension/**` and
 * `tools/**` are owned by another lane and are untouched; regenerate with
 * `node tools/build.mjs && node test/experiments/firefox-load/build-variant.mjs`.
 *
 * Rationale, measured on Firefox 2026-08-07 (see artifacts/result-ffext-1.json):
 * every one of the 201 base-map requests the shipped rule *can* match was
 * rewritten to RoadmapDark, and the map was still light from ~1.4s onward,
 * because the vector renderer's data does not travel on `/maps/vt/pb=`. It
 * travels on `/maps/vt/stream/pb=`, carrying the identical plain-ASCII
 * `!1sset!2sRoadmap!` selector one path segment further along. The shipped
 * regex `^(https://[^/]+/maps/vt/pb=.*!2s)Roadmap(!.*)$` cannot match that URL.
 *
 * Rule 2 below is the minimal repair. Rule 1 is copied unchanged so that the
 * variant is a strict superset of shipped behaviour.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..');
const SRC = path.join(ROOT, 'dist', 'firefox');
const DEST = path.join(HERE, 'ext-variant');

if (!fs.existsSync(path.join(SRC, 'manifest.json'))) {
  throw new Error(`no built add-on at ${SRC}; run \`node tools/build.mjs\` first`);
}

fs.rmSync(DEST, { recursive: true, force: true });
fs.cpSync(SRC, DEST, { recursive: true });

const manifest = JSON.parse(fs.readFileSync(path.join(DEST, 'manifest.json'), 'utf8'));
manifest.name = 'Maps Noir (M0 spike) [LANE D stream-rule variant]';
fs.writeFileSync(path.join(DEST, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

const shipped = JSON.parse(fs.readFileSync(path.join(SRC, 'rules', 'dark-tiles.json'), 'utf8'));
const streamRule = {
  id: 2,
  priority: 1,
  action: {
    type: 'redirect',
    redirect: { regexSubstitution: '\\1RoadmapDark\\2' },
  },
  condition: {
    // Only difference from rule 1: the `stream/` path segment. The trailing `!`
    // in the second capture is what prevents a redirect loop -- the rewritten
    // URL contains `!2sRoadmapDark!`, which `!2s` + `Roadmap` + `!` cannot match.
    regexFilter: '^(https://[^/]+/maps/vt/stream/pb=.*!2s)Roadmap(!.*)$',
    resourceTypes: ['image', 'xmlhttprequest', 'other', 'media', 'script', 'object', 'sub_frame'],
  },
};

const rules = [...shipped, streamRule];
fs.writeFileSync(path.join(DEST, 'rules', 'dark-tiles.json'), `${JSON.stringify(rules, null, 2)}\n`);

console.log(`variant built: ${DEST}`);
for (const r of rules) console.log(`  rule ${r.id}: ${r.condition.regexFilter}`);

/* -------------------------------------------------------------------------- *
 * Second variant: `ext-block`.
 *
 * The stream-rule variant showed that rewriting the vector stream's style token
 * does NOT darken the vector render -- the WebGL layer's palette is not
 * determined by that URL. So the only remaining way a URL-level rewrite could
 * produce a permanently dark map is to stop the vector layer from taking over
 * at all, leaving the raster <img> tile layer (which the rewrite *does* control,
 * and which is genuinely dark) in place.
 *
 * This variant tests exactly that: rewrite the raster tiles, and block the
 * base-map vector stream. It is a probe, not a proposal -- blocking a Google
 * endpoint to force a legacy render path is a serious product decision.
 * -------------------------------------------------------------------------- */

const BLOCK_DEST = path.join(HERE, 'ext-block');
fs.rmSync(BLOCK_DEST, { recursive: true, force: true });
fs.cpSync(SRC, BLOCK_DEST, { recursive: true });

const blockManifest = JSON.parse(fs.readFileSync(path.join(BLOCK_DEST, 'manifest.json'), 'utf8'));
blockManifest.name = 'Maps Noir (M0 spike) [LANE D vector-block variant]';
fs.writeFileSync(path.join(BLOCK_DEST, 'manifest.json'), `${JSON.stringify(blockManifest, null, 2)}\n`);

const blockRule = {
  id: 3,
  priority: 2,
  action: { type: 'block' },
  condition: {
    // `!1e0!2sm!` is the base-map layer. The crisis2 / lore-rec overlay streams
    // carry different layer names and are deliberately left alone.
    regexFilter: '^https://[^/]+/maps/vt/stream/pb=.*!1e0!2sm!',
    resourceTypes: ['image', 'xmlhttprequest', 'other', 'media', 'script', 'object', 'sub_frame'],
  },
};
const blockRules = [...shipped, blockRule];
fs.writeFileSync(path.join(BLOCK_DEST, 'rules', 'dark-tiles.json'), `${JSON.stringify(blockRules, null, 2)}\n`);

console.log(`block variant built: ${BLOCK_DEST}`);
for (const r of blockRules) console.log(`  rule ${r.id}: ${r.action.type} ${r.condition.regexFilter}`);
