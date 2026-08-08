/**
 * The shipped declarativeNetRequest ruleset, checked offline against a corpus of
 * real captured URLs.
 *
 * Three failure modes are in scope, in descending order of how badly they bite:
 *
 *   1. REDIRECT LOOP. A rule whose output re-matches its own regexFilter makes
 *      Chrome bounce the request until it gives up with ERR_TOO_MANY_REDIRECTS.
 *      The symptom is a blank map, not a light one, so it is easy to misread.
 *   2. OVER-MATCH. A rule that touches satellite imagery, POI icons, the Maps
 *      document, or the RoadmapSatellite liveness canary.
 *   3. UNDER-MATCH. A rule that misses one of the four transports, which shows
 *      up only as a map that is dark in some renderer modes and not others.
 *
 * Loop-freedom is checked ACROSS the whole ruleset, not per rule: rule 3 not
 * re-matching its own output is not enough if rule 4 would then match it.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { loadRules, applyRule, applyRuleset, matchingRuleIds, RULES_PATH } from '../lib/rules.mjs';
import { classifyRequest } from '../lib/transport.mjs';
import { MUST_MATCH, MUST_NOT_MATCH } from '../fixtures/url-corpus.mjs';

const rules = loadRules();

test(`the ruleset at ${RULES_PATH.replace(/\\/g, '/')} is well formed`, () => {
  assert.ok(rules.length > 0, 'ruleset is empty');
  const ids = new Set();
  for (const r of rules) {
    assert.equal(typeof r.id, 'number', `rule ${JSON.stringify(r).slice(0, 80)} has no numeric id`);
    assert.ok(!ids.has(r.id), `duplicate rule id ${r.id}`);
    ids.add(r.id);
    assert.equal(r.action?.type, 'redirect', `rule ${r.id} is not a redirect`);
    assert.equal(typeof r.action?.redirect?.regexSubstitution, 'string', `rule ${r.id} has no regexSubstitution`);
    assert.equal(typeof r.condition?.regexFilter, 'string', `rule ${r.id} has no regexFilter`);
    assert.doesNotThrow(() => new RegExp(r.condition.regexFilter), `rule ${r.id} regexFilter does not compile`);
    assert.ok(
      Array.isArray(r.condition.resourceTypes) && r.condition.resourceTypes.includes('xmlhttprequest'),
      `rule ${r.id} must cover xmlhttprequest: base-map fetches come from a Web Worker, ` +
        'and a worker fetch is classified as xmlhttprequest. This is the whole reason the ' +
        'network layer is the right hook.'
    );
  }
});

test('every must-match URL is rewritten to exactly the expected URL', () => {
  for (const c of MUST_MATCH) {
    const rule = rules.find((r) => r.id === c.ruleId);
    assert.ok(rule, `rule id ${c.ruleId} (${c.name}) is not in the shipped ruleset`);
    const out = applyRule(rule, c.url);
    assert.equal(out.matched, true, `rule ${c.ruleId} did not match ${c.name}\n  ${c.url}`);
    assert.equal(
      out.result,
      c.expect,
      `rule ${c.ruleId} (${c.name}) produced\n  ${out.result}\nexpected\n  ${c.expect}`
    );
  }
});

test('every must-match URL is rewritten by the ruleset as a whole, in exactly one hop', () => {
  for (const c of MUST_MATCH) {
    const { result, hops, looped } = applyRuleset(rules, c.url);
    assert.equal(looped, false, `${c.name} looped: ${JSON.stringify(hops.map((h) => h.ruleId))}`);
    assert.equal(hops.length, 1, `${c.name} took ${hops.length} hops (expected exactly 1): ${JSON.stringify(hops.map((h) => h.ruleId))}`);
    assert.equal(result, c.expect, `${c.name} settled on\n  ${result}\nexpected\n  ${c.expect}`);
  }
});

test('LOOP FREEDOM: no rule matches the output of any rule', () => {
  for (const c of MUST_MATCH) {
    const ids = matchingRuleIds(rules, c.expect);
    assert.deepEqual(
      ids,
      [],
      `the rewritten URL for ${c.name} is matched again by rule(s) ${ids.join(',')} -- that is a redirect loop\n  ${c.expect}`
    );
  }
});

test('LOOP FREEDOM: exhaustive cross-product -- every rule against every rule output', () => {
  const outputs = [];
  for (const rule of rules) {
    for (const c of MUST_MATCH) {
      const out = applyRule(rule, c.url);
      if (out.matched) outputs.push({ producedBy: rule.id, from: c.name, url: out.result });
    }
  }
  assert.ok(outputs.length >= rules.length, 'expected at least one output per rule to test against');
  for (const o of outputs) {
    for (const rule of rules) {
      const again = applyRule(rule, o.url);
      assert.equal(
        again.matched,
        false,
        `rule ${rule.id} matches the output rule ${o.producedBy} produced from ${o.from}:\n  ${o.url}`
      );
    }
  }
});

test('no must-not-match URL is touched', () => {
  for (const c of MUST_NOT_MATCH) {
    const ids = matchingRuleIds(rules, c.url);
    if (c.expectedToMatchRegexAnyway) {
      // Documented, deliberate: rules 3 and 4 are host-agnostic by design and are
      // scoped by host_permissions instead. Asserting the CURRENT behaviour so a
      // future change to the regex is noticed rather than assumed.
      assert.notDeepEqual(ids, [], `${c.name} was expected to match the regex (host scoping is by host_permissions)`);
      continue;
    }
    assert.deepEqual(ids, [], `rule(s) ${ids.join(',')} matched ${c.name} -- ${c.guards}\n  ${c.url}`);
  }
});

test('all four transports are covered: each has at least one must-match case', () => {
  const seen = new Set();
  for (const c of MUST_MATCH) seen.add(classifyRequest(c.url).transport);
  for (const t of ['legend', 'stream', 'raster']) {
    assert.ok(seen.has(t), `no must-match corpus entry exercises the ${t} transport`);
  }
});

test('the proto transport is classified as NOT rewritable, and no rule touches it', () => {
  const proto = MUST_NOT_MATCH.find((c) => c.name === 'proto-tile');
  const c = classifyRequest(proto.url);
  assert.equal(c.transport, 'proto');
  assert.equal(c.baseMap, true, 'the proto tile really does carry a style selector');
  assert.equal(c.token, 'Roadmap', 'and the token is readable out of the protobuf');
  assert.equal(c.rewritable, false, 'but it cannot be rewritten by a regexSubstitution');
  assert.deepEqual(matchingRuleIds(rules, proto.url), []);
});

test('the transport classifier agrees with the corpus about what each URL is', () => {
  const expect = {
    'legend-roadmap': ['legend', 'Roadmap', false],
    'legend-roadmap-other-version': ['legend', 'Roadmap', false],
    'legend-terrain': ['legend', 'Terrain', false],
    'vector-stream': ['stream', 'Roadmap', false],
    'terrain-stream': ['stream', 'Terrain', false],
    'terrain-raster': ['raster', 'Terrain', false],
    'raster-firstpaint-z12': ['raster', 'Roadmap', false],
    'raster-firstpaint-z17': ['raster', 'Roadmap', false],
    'raster-maps-google-com': ['raster', 'Roadmap', false],
  };
  for (const c of MUST_MATCH) {
    const got = classifyRequest(c.url);
    const [transport, token, dark] = expect[c.name];
    assert.equal(got.transport, transport, `${c.name} transport`);
    assert.equal(got.token, token, `${c.name} token`);
    assert.equal(got.dark, dark, `${c.name} dark`);
    assert.equal(got.baseMap, true, `${c.name} baseMap`);
    assert.equal(got.rewritable, true, `${c.name} rewritable`);

    const after = classifyRequest(c.expect);
    assert.equal(after.dark, true, `${c.name}: the rewritten URL must classify as dark`);
  }
});

test('the classifier does not mistake POI icons or satellite tiles for base map', () => {
  for (const name of ['poi-icon', 'imagery-thumb']) {
    const c = classifyRequest(MUST_NOT_MATCH.find((x) => x.name === name).url);
    assert.equal(c.baseMap, false, `${name} classified as a base-map request`);
  }
  const sat = classifyRequest(MUST_NOT_MATCH.find((x) => x.name === 'legend-roadmap-satellite').url);
  assert.equal(sat.transport, 'legend');
  assert.equal(sat.baseMap, false, 'RoadmapSatellite is not one of our base-map styles');
  assert.equal(sat.rewritable, false);
});

test('zoom level is recoverable from every tile transport (A1 depends on it)', () => {
  assert.equal(classifyRequest(MUST_MATCH.find((c) => c.name === 'raster-firstpaint-z12').url).zoom, 12);
  assert.equal(classifyRequest(MUST_MATCH.find((c) => c.name === 'raster-firstpaint-z17').url).zoom, 17);
  assert.equal(classifyRequest(MUST_MATCH.find((c) => c.name === 'vector-stream').url).zoom, 12);
  assert.equal(classifyRequest(MUST_NOT_MATCH.find((c) => c.name === 'proto-tile').url).zoom, 12);
});

/* ---------------------------------------------------------------------------
 * The mutation harness, shared by every MUTATION test below.
 *
 * A check that cannot fail is worth nothing. `corpusFailures` feeds the SAME
 * corpus a deliberately broken ruleset and reports which entries catch it; every
 * mutation test asserts that a named entry did. If one of them ever passes the
 * broken rule, the corresponding assertion above is decorative.
 *
 * Note that it looks exactly ONE hop ahead (`matchingRuleIds(ruleset, c.expect)`)
 * and never iterates. That is deliberate: a rule that re-matches its own output
 * is a fault at the first hop, and refusing to walk the chain is what makes this
 * harness immune to the diverging-loop case that has no fixed point to walk to.
 * ------------------------------------------------------------------------- */

/** Which corpus entries a given ruleset gets wrong. */
function corpusFailures(ruleset) {
  const failures = [];
  for (const c of MUST_MATCH) {
    const rule = ruleset.find((r) => r.id === c.ruleId);
    if (!rule) {
      failures.push(`missing rule ${c.ruleId}`);
      continue;
    }
    const out = applyRule(rule, c.url);
    if (!out.matched) failures.push(`under-match: ${c.name}`);
    else if (out.result !== c.expect) failures.push(`bad-substitution: ${c.name}`);
    if (matchingRuleIds(ruleset, c.expect).length > 0) failures.push(`loop: ${c.name}`);
  }
  for (const c of MUST_NOT_MATCH) {
    if (c.expectedToMatchRegexAnyway) continue;
    if (matchingRuleIds(ruleset, c.url).length > 0) failures.push(`over-match: ${c.name}`);
  }
  return failures;
}

const clone = () => JSON.parse(JSON.stringify(rules));

test('MUTATION: the shipped ruleset has zero corpus failures (baseline)', () => {
  assert.deepEqual(corpusFailures(rules), []);
});

/* ---------------------------------------------------------------------------
 * THE TERRAIN ARM.
 *
 * This section replaces a test that used to pin the OPPOSITE claim. Rules 3 and
 * 4 once matched `!1sset!2s)Roadmap(!` literally, so a raster or stream tile
 * requested with `!1sset!2sTerrain!` -- what the canvas and canvas+labeler arms
 * fetch once the user switches the base map to Terrain -- was outside their
 * regex by construction, and the gap was pinned as a standing KNOWN GAP test
 * whose own header said to delete it the day the rules closed it. They now match
 * `!2s(Roadmap|Terrain)!`, so it is deleted, and this is the coverage that
 * replaces it: the corpus gained `terrain-stream` and `terrain-raster`
 * must-match entries plus their already-dark twins, which means the whole file
 * above -- one-hop settlement, the cross-product loop check, the corpus-failure
 * mutation harness -- now exercises the alternation instead of only its Roadmap
 * half. What follows is what is specific to Terrain and would otherwise only be
 * covered incidentally.
 * ------------------------------------------------------------------------- */

/** Both style tokens, on every transport a rule can rewrite. */
const REWRITABLE_TRANSPORTS = ['legend', 'stream', 'raster'];

test('the corpus covers BOTH style tokens on every rewritable transport', () => {
  // The guard against the gap ever reopening quietly: it is not enough for the
  // rules to carry an alternation, the corpus has to feed both arms of it. If a
  // future edit drops a Terrain entry, this fails rather than the suite going
  // green over half a rule.
  for (const transport of REWRITABLE_TRANSPORTS) {
    for (const token of ['Roadmap', 'Terrain']) {
      const hit = MUST_MATCH.find((c) => {
        const k = classifyRequest(c.url);
        return k.transport === transport && k.token === token;
      });
      assert.ok(hit, `no must-match corpus entry exercises ${token} on the ${transport} transport`);
    }
  }
});

test('the Terrain arm is rewritten on every transport, by the rule that owns it', () => {
  const byName = (n) => MUST_MATCH.find((c) => c.name === n);
  assert.deepEqual(matchingRuleIds(rules, byName('legend-terrain').url), [2]);
  assert.deepEqual(matchingRuleIds(rules, byName('terrain-stream').url), [3]);
  assert.deepEqual(matchingRuleIds(rules, byName('terrain-raster').url), [4]);

  // Exactly one rule per URL. Two rules matching one tile is how a redirect
  // fight starts, and priority alone would decide it silently.
  for (const name of ['legend-terrain', 'terrain-stream', 'terrain-raster']) {
    assert.equal(matchingRuleIds(rules, byName(name).url).length, 1, `${name} matched more than one rule`);
  }
});

test('the Terrain and Roadmap arms cannot rewrite into each other', () => {
  // `\1\2Dark\3` keeps the matched token; a substitution that hard-coded
  // "RoadmapDark" would turn a Terrain tile into a Roadmap one, which is a
  // wrong-map bug rather than a no-op and would not show up as a loop, an
  // over-match or an under-match.
  for (const name of ['terrain-stream', 'terrain-raster']) {
    const c = MUST_MATCH.find((x) => x.name === name);
    const k = classifyRequest(applyRule(rules.find((r) => r.id === c.ruleId), c.url).result);
    assert.equal(k.token, 'TerrainDark', `${name} must stay in the Terrain family`);
    assert.equal(k.dark, true);
  }
  for (const name of ['vector-stream', 'raster-firstpaint-z17']) {
    const c = MUST_MATCH.find((x) => x.name === name);
    const k = classifyRequest(applyRule(rules.find((r) => r.id === c.ruleId), c.url).result);
    assert.equal(k.token, 'RoadmapDark', `${name} must stay in the Roadmap family`);
  }
});

/**
 * Settle a URL through the ruleset under a HARD HOP BUDGET and report how it
 * stopped.
 *
 * `applyRuleset` already carries both a seen-set and a budget; this asserts on
 * WHICH of the two fired, because they answer different questions and the
 * difference is not academic. A Roadmap loop repeats a URL and a seen-set finds
 * it on the second hop. A Terrain loop DIVERGES -- TerrainDark,
 * TerrainDarkDark, TerrainDarkDarkDark -- and a seen-set never fires at all: an
 * earlier attempt at exactly this check ran until the process died at 3.7 GB.
 */
function settle(ruleset, url, budget = 6) {
  const { result, hops, looped } = applyRuleset(ruleset, url, budget);
  const outs = hops.map((h) => h.to);
  return {
    result,
    looped,
    hops: hops.length,
    repeated: new Set(outs).size !== outs.length,
    exhaustedBudget: hops.length >= budget,
    urls: outs,
  };
}

test('LOOP FREEDOM: every must-match URL settles in one hop and spends none of the budget', () => {
  for (const c of MUST_MATCH) {
    const s = settle(rules, c.url);
    assert.equal(s.looped, false, `${c.name} looped: ${JSON.stringify(s.urls)}`);
    assert.equal(s.hops, 1, `${c.name} took ${s.hops} hops`);
    assert.equal(s.result, c.expect, `${c.name} settled on ${s.result}`);
  }
});

test('MUTATION: a DIVERGING Terrain loop is caught by the hop budget, not by a repeat', () => {
  // The one-character defect: drop the `!` that terminates the token capture on
  // rule 4, so `(.*)$` swallows the "Dark" the rule just wrote and the rule
  // matches its own output for ever.
  const bad = clone();
  const rule4 = bad.find((r) => r.id === 4);
  rule4.condition.regexFilter = '^(https://[^/]+/maps/vt/pb=.*!2s)(Roadmap|Terrain)(.*)$';

  const c = MUST_MATCH.find((x) => x.name === 'terrain-raster');
  const s = settle(bad, c.url, 6);

  assert.equal(s.looped, true, 'the diverging rewrite must be reported as a loop');
  assert.equal(s.exhaustedBudget, true, 'it must be the BUDGET that stopped it');
  assert.equal(
    s.repeated,
    false,
    'and no URL may have repeated -- if one did, this mutant is not the diverging kind ' +
      `and the test is not proving what it claims: ${JSON.stringify(s.urls)}`
  );
  // Each hop is strictly longer than the last: that is what "diverging" means.
  assert.deepEqual(
    s.urls.map((u) => u.length - c.url.length),
    [4, 8, 12, 16, 20, 24],
    'each pass must have appended exactly one more "Dark"'
  );
  assert.match(s.urls.at(-1), /!2sTerrainDarkDarkDarkDarkDarkDark!/);

  // And the same defect on the corpus harness, which only ever looks one hop
  // ahead, is still caught -- as a loop, at the first hop.
  assert.ok(
    corpusFailures(bad).some((x) => x.startsWith('loop:')),
    'the one-hop corpus check must catch it too'
  );
});

test('MUTATION: tile rules that cover only Roadmap are caught (the gap that used to be pinned here)', () => {
  // Verbatim the pre-fix ruleset: `(Roadmap)` where the shipped rules now say
  // `(Roadmap|Terrain)`. This is the exact state the deleted KNOWN GAP test used
  // to assert as correct, and the corpus must now reject it.
  const bad = clone();
  bad.find((r) => r.id === 3).condition.regexFilter =
    '^(https://[^/]+/maps/vt/stream/pb=.*!2s)(Roadmap)(!.*)$';
  bad.find((r) => r.id === 4).condition.regexFilter =
    '^(https://[^/]+/maps/vt/pb=.*!2s)(Roadmap)(!.*)$';
  const f = corpusFailures(bad);
  assert.ok(
    f.includes('under-match: terrain-stream') && f.includes('under-match: terrain-raster'),
    `expected both Terrain arms to be reported as under-matched, got ${JSON.stringify(f)}`
  );
  // The Roadmap arms must still pass, or this mutant proves nothing about Terrain.
  assert.ok(
    !f.some((x) => x.includes('vector-stream') || x.includes('raster-firstpaint')),
    `the Roadmap arms must be unaffected, got ${JSON.stringify(f)}`
  );
});

test('MUTATION: a substitution that forces the Roadmap palette onto Terrain is caught', () => {
  const bad = clone();
  bad.find((r) => r.id === 4).action.redirect.regexSubstitution = '\\1RoadmapDark\\3';
  const f = corpusFailures(bad);
  assert.ok(
    f.includes('bad-substitution: terrain-raster'),
    `expected the Terrain tile to notice it was handed a Roadmap palette, got ${JSON.stringify(f)}`
  );
});

/* ---------------------------------------------------------------------------
 * Mutation proofs -- the remaining ones. The harness and the baseline are above,
 * because the Terrain section uses them too.
 * ------------------------------------------------------------------------- */

test('MUTATION: a loop-producing rule is caught', () => {
  // Drop the trailing `-` from rule 1's capture, so `RoadmapDark-<v>` matches
  // again and the substitution keeps prepending "Dark".
  const bad = clone();
  bad[0].condition.regexFilter = '^(https://www\\.gstatic\\.com/maps/res/CompactLegend-)Roadmap(.*)$';
  const f = corpusFailures(bad);
  assert.ok(
    f.some((x) => x.startsWith('loop:')),
    `expected a loop failure, got ${JSON.stringify(f)}`
  );
});

test('MUTATION: an over-matching rule that eats RoadmapSatellite is caught', () => {
  const bad = clone();
  bad[0].condition.regexFilter = '^(https://www\\.gstatic\\.com/maps/res/CompactLegend-)Roadmap(.*)$';
  const f = corpusFailures(bad);
  assert.ok(
    f.includes('over-match: legend-roadmap-satellite'),
    `expected the satellite canary to be protected, got ${JSON.stringify(f)}`
  );
});

test('MUTATION: an under-matching rule pinned to one version hash is caught', () => {
  const bad = clone();
  bad[0].condition.regexFilter =
    '^(https://www\\.gstatic\\.com/maps/res/CompactLegend-)Roadmap(-4311471e3660cd049e8ede59d279b3ba)$';
  const f = corpusFailures(bad);
  assert.ok(
    f.includes('under-match: legend-roadmap-other-version'),
    `expected the rotating-version case to fail, got ${JSON.stringify(f)}`
  );
});

test('MUTATION: a rule that rewrites the raster tile to the wrong token is caught', () => {
  const bad = clone();
  bad[3].action.redirect.regexSubstitution = '\\1RoadmapDarkk\\2';
  const f = corpusFailures(bad);
  assert.ok(
    f.includes('bad-substitution: raster-firstpaint-z12'),
    `expected a substitution failure, got ${JSON.stringify(f)}`
  );
});

test('MUTATION: deleting a rule is caught', () => {
  const f = corpusFailures(rules.filter((r) => r.id !== 3));
  assert.ok(f.includes('missing rule 3'), `expected the missing rule to be caught, got ${JSON.stringify(f)}`);
});

test('MUTATION: a rule that would rewrite the Maps document itself is caught', () => {
  const bad = clone();
  bad.push({
    id: 99,
    priority: 1,
    action: { type: 'redirect', redirect: { regexSubstitution: '\\1Dark\\2' } },
    condition: { regexFilter: '^(https://www\\.google\\.com/maps)(/.*)$', resourceTypes: ['xmlhttprequest'] },
  });
  const f = corpusFailures(bad);
  assert.ok(
    f.includes('over-match: maps-document'),
    `expected the Maps document to be protected, got ${JSON.stringify(f)}`
  );
});
