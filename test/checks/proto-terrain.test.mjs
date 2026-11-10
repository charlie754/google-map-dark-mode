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
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { loadRules, applyRuleset, matchingRuleIds } from '../lib/rules.mjs';
import { bpbOf, parseMessage, protoStyleToken, protoTileCoords, encodeB64Url } from '../lib/bpb.mjs';
import { MUST_MATCH, MUST_NOT_MATCH } from '../fixtures/url-corpus.mjs';
import { protoTerrainRules, OLD_REGION, NEW_REGION } from '../../tools/proto-terrain-rules.mjs';

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
