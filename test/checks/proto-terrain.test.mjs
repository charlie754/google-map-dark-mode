/**
 * Rules 6-8: the mapcore Terrain relief tile, rewritten inside its base64 protobuf.
 *
 * The rules are a same-length byte swap (tools/proto-terrain-rules.mjs): option 63
 * is dropped to pay for the four bytes of "Dark", so the enclosing message keeps
 * its length and no base64 character outside the region moves. These checks pin
 * the parts a reviewer cannot eyeball in a base64 literal: the shipped rules are
 * exactly what the derivation produces, the rewrite decodes to a strictly valid
 * protobuf whose style is TerrainDark with the tile coordinates untouched, all
 * three base64 alignments are covered, and nothing else in the proto transport
 * is touched.
 *
 * Rules 9-17 are the same construction for the server-styled ("baked") variant:
 * Roadmap / TransitFocused / Terrain tiles whose style set entry carries options 5
 * and 6, which are dropped to pay for "Dark". The second half of this file pins
 * them the same way.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { loadRules, applyRuleset, matchingRuleIds } from '../lib/rules.mjs';
import { bpbOf, parseMessage, protoStyleToken, protoTileCoords, encodeB64Url } from '../lib/bpb.mjs';
import { MUST_MATCH, MUST_NOT_MATCH } from '../fixtures/url-corpus.mjs';
import { protoTerrainRules, protoRules, SWAPS, OLD_REGION, NEW_REGION } from '../../tools/proto-terrain-rules.mjs';
import { classifyRequest, protoServerStyled } from '../lib/transport.mjs';

const rules = loadRules();
const shipped = rules.filter((r) => r.id >= 6 && r.id <= 8);
const cases = MUST_MATCH.filter((c) => c.name.startsWith('proto-terrain-relief-'));

test('shipped rules 6-8 are exactly what tools/proto-terrain-rules.mjs derives', () => {
  const derived = protoTerrainRules();
  assert.equal(shipped.length, 3);
  for (const d of derived) {
    const s = shipped.find((r) => r.id === d.id);
    assert.ok(s, `rule ${d.id} missing from the shipped ruleset`);
    assert.equal(s.condition.regexFilter, d.condition.regexFilter, `rule ${d.id} regexFilter drifted`);
    assert.equal(
      s.action.redirect.regexSubstitution,
      d.action.redirect.regexSubstitution,
      `rule ${d.id} substitution drifted`
    );
  }
});

test('the swap keeps the byte count, so no length prefix outside it changes', () => {
  assert.equal(OLD_REGION.length, NEW_REGION.length);
});

test('each proto Terrain sample is rewritten by exactly one rule, one per alignment', () => {
  assert.equal(cases.length, 3);
  const ids = new Set();
  for (const c of cases) {
    const hit = matchingRuleIds(rules, c.url);
    assert.equal(hit.length, 1, `${c.name}: matched ${hit.join(',')}`);
    ids.add(hit[0]);
    const offset = bpbOf(c.url).indexOf(OLD_REGION);
    assert.ok(offset > 0, `${c.name}: sample does not contain the region`);
    assert.equal(hit[0], 6 + (offset % 3), `${c.name}: wrong alignment rule`);
  }
  assert.deepEqual([...ids].sort(), [6, 7, 8], 'all three base64 alignments must be exercised');
});

test('the rewrite decodes to a valid protobuf: style TerrainDark, same tile, same everything else', () => {
  for (const c of cases) {
    const { result: url, hops, looped } = applyRuleset(rules, c.url);
    assert.equal(looped, false, `${c.name}: loop`);
    assert.equal(hops.length, 1, `${c.name}: expected one hop`);
    assert.equal(url, c.expect, `${c.name}: unexpected output`);
    const before = bpbOf(c.url);
    const after = bpbOf(url);
    assert.equal(after.length, before.length, `${c.name}: byte length changed`);
    assert.deepEqual(after, Buffer.from(before.toString('latin1').replace(OLD_REGION.toString('latin1'), NEW_REGION.toString('latin1')), 'latin1'));
    assert.doesNotThrow(() => parseMessage(after), `${c.name}: rewritten bpb is not a strict protobuf`);
    assert.equal(protoStyleToken(before), 'Terrain');
    assert.equal(protoStyleToken(after), 'TerrainDark', `${c.name}: style not TerrainDark`);
    assert.deepEqual(protoTileCoords(after), protoTileCoords(before), `${c.name}: tile moved`);
    // Only the region's characters changed in the URL.
    const head = c.url.indexOf('bpb=') + 4;
    assert.equal(url.slice(0, head), c.url.slice(0, head));
    assert.equal(encodeB64Url(after).length, encodeB64Url(before).length);
  }
});

test('the Roadmap proto tile and a reordered Terrain tile are left alone', () => {
  const roadmap = MUST_NOT_MATCH.find((c) => c.name === 'proto-tile');
  assert.deepEqual(matchingRuleIds(rules, roadmap.url), []);
  // Same Terrain tile with options 63 and 3 swapped: the literal no longer
  // matches, so the tile stays as Google sent it (light relief) -- the safe failure.
  const c = cases[0];
  const buf = bpbOf(c.url);
  const swapped = Buffer.from(
    buf.toString('latin1').replace('\x62\x02\x08\x3f\x62\x02\x08\x03', '\x62\x02\x08\x03\x62\x02\x08\x3f'),
    'latin1'
  );
  const url = c.url.replace(encodeB64Url(buf), encodeB64Url(swapped));
  assert.notEqual(url, c.url);
  assert.deepEqual(matchingRuleIds(rules, url), []);
});

test('MUTATION: deleting any one alignment rule leaves its sample light', () => {
  for (const id of [6, 7, 8]) {
    const mutated = rules.filter((r) => r.id !== id);
    const c = cases.find((x) => matchingRuleIds(rules, x.url)[0] === id);
    assert.equal(applyRuleset(mutated, c.url).result, c.url, `deleting rule ${id} was not caught`);
  }
});

/* ------------------------------------------------ rules 9-17: server-styled tiles */

const baked = SWAPS.filter((sw) => sw.name.startsWith('baked-'));
const bakedCases = MUST_MATCH.filter((c) => c.name.startsWith('proto-baked-'));

test('shipped rules 6-17 are exactly what tools/proto-terrain-rules.mjs derives, and fit in 2 KB', () => {
  const derived = protoRules();
  assert.deepEqual(derived.map((r) => r.id), [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17]);
  for (const d of derived) {
    const s = rules.find((r) => r.id === d.id);
    assert.ok(s, `rule ${d.id} missing from the shipped ruleset`);
    assert.deepEqual(s, d, `rule ${d.id} drifted from the derivation`);
    assert.ok(d.condition.regexFilter.length < 200, `rule ${d.id} regex is suspiciously long`);
  }
});

test('every server-styled swap keeps the byte count', () => {
  assert.deepEqual(baked.map((sw) => sw.name), ['baked-Roadmap', 'baked-TransitFocused', 'baked-Terrain']);
  for (const sw of baked) assert.equal(sw.old.length, sw.new.length, sw.name);
});

test('each server-styled sample is rewritten by exactly one rule, all 3 alignments x 3 styles', () => {
  assert.equal(bakedCases.length, 9);
  const ids = new Set();
  for (const c of bakedCases) {
    const before = bpbOf(c.url);
    assert.equal(protoServerStyled(before), true, `${c.name}: sample is not server-styled`);
    const hit = matchingRuleIds(rules, c.url);
    assert.equal(hit.length, 1, `${c.name}: matched ${hit.join(',')}`);
    const sw = baked.find((x) => before.includes(x.old));
    assert.ok(sw, `${c.name}: sample does not contain a server-styled region`);
    assert.equal(hit[0], sw.firstId + (before.indexOf(sw.old) % 3), `${c.name}: wrong alignment rule`);
    ids.add(hit[0]);
  }
  assert.deepEqual([...ids].sort((a, b) => a - b), [9, 10, 11, 12, 13, 14, 15, 16, 17]);
});

test('the server-styled rewrite decodes to a valid protobuf in the Dark style, same tile', () => {
  for (const c of bakedCases) {
    const { result: url, hops, looped } = applyRuleset(rules, c.url);
    assert.equal(looped, false, `${c.name}: loop`);
    assert.equal(hops.length, 1, `${c.name}: expected one hop`);
    assert.equal(url, c.expect, `${c.name}: unexpected output`);
    const before = bpbOf(c.url);
    const after = bpbOf(url);
    const sw = baked.find((x) => before.includes(x.old));
    assert.equal(after.length, before.length, `${c.name}: byte length changed`);
    assert.deepEqual(after, Buffer.from(before.toString('latin1').replace(sw.old.toString('latin1'), sw.new.toString('latin1')), 'latin1'));
    assert.doesNotThrow(() => parseMessage(after), `${c.name}: rewritten bpb is not a strict protobuf`);
    const style = sw.name.slice('baked-'.length);
    assert.equal(protoStyleToken(before), style);
    assert.equal(protoStyleToken(after), `${style}Dark`, `${c.name}: style not ${style}Dark`);
    assert.equal(protoServerStyled(after), false, `${c.name}: options 5/6 should be gone`);
    assert.deepEqual(protoTileCoords(after), protoTileCoords(before), `${c.name}: tile moved`);
    assert.equal(classifyRequest(url).dark, true);
  }
});

test('the default-variant tiles (no options 5/6) are not touched by rules 9-17', () => {
  // The Roadmap proto tile of the default variant is coloured client-side by the
  // CompactLegend (rule 1); rewriting it is neither needed nor safe.
  const roadmap = MUST_NOT_MATCH.find((c) => c.name === 'proto-tile');
  assert.equal(protoServerStyled(bpbOf(roadmap.url)), false);
  assert.deepEqual(matchingRuleIds(rules, roadmap.url), []);
  // A server-styled tile with only option 5 (not 6) does not match: safe failure.
  const c = bakedCases[0];
  const buf = bpbOf(c.url);
  const partial = Buffer.from(buf.toString('latin1').replace('\x28\x01\x30\x01', '\x28\x01\x30\x00'), 'latin1');
  const partialUrl = c.url.replace(encodeB64Url(buf), encodeB64Url(partial));
  assert.notEqual(partialUrl, c.url);
  assert.deepEqual(matchingRuleIds(rules, partialUrl), []);
});

test('MUTATION: deleting any one server-styled rule leaves its sample light', () => {
  for (let id = 9; id <= 17; id++) {
    const mutated = rules.filter((r) => r.id !== id);
    const c = bakedCases.find((x) => matchingRuleIds(rules, x.url)[0] === id);
    assert.ok(c, `no sample for rule ${id}`);
    assert.equal(applyRuleset(mutated, c.url).result, c.url, `deleting rule ${id} was not caught`);
  }
});

test('background.js self-check samples for rules 6-17 are the corpus URLs', async () => {
  const fs = await import('node:fs');
  const src = fs.readFileSync(new URL('../../extension/background.js', import.meta.url), 'utf8');
  const start = src.indexOf('const RULE_SAMPLES = {');
  const end = src.indexOf('\n};', start);
  assert.ok(start >= 0 && end > start, 'RULE_SAMPLES not found');
  // The literal is plain data (strings, numbers, concatenation), so evaluating it is safe.
  const samples = new Function(`return {${src.slice(start + 'const RULE_SAMPLES = {'.length, end)}\n};`)();
  for (const c of [...cases, ...bakedCases]) {
    const s = (samples[c.ruleId] || []).find((x) => x.name === c.name);
    assert.ok(s, `RULE_SAMPLES[${c.ruleId}] has no ${c.name}`);
    assert.equal(s.url, c.url, `${c.name}: url differs from the corpus`);
    assert.equal(s.expect, c.expect, `${c.name}: expect differs from the corpus`);
  }
});
