#!/usr/bin/env node
/**
 * THE 2 KB DNR TRAP DETECTOR, as a standing regression test.
 *
 *   node test/checks/dnr-2kb.mjs
 *
 * ---------------------------------------------------------------------------
 * THE TRAP
 * ---------------------------------------------------------------------------
 * Chrome refuses to compile a declarativeNetRequest `regexFilter` whose compiled
 * RE2 program exceeds a 2 KB memory budget, and for a STATIC ruleset it does so
 * SILENTLY:
 *
 *   - the extension installs without error
 *   - getEnabledRulesets() still returns the ruleset id
 *   - chrome.runtime.lastError is not set
 *   - the only symptom is that the map stays light
 *
 * A previous lane burned two full trials on this before testMatchOutcome exposed
 * it (test/experiments/transport-arm/FINDINGS.txt, "TRAP THAT COST A CYCLE").
 * The measured example is a bounded hex quantifier as the version tail:
 *
 *   BAD : ^(https://www\.gstatic\.com/maps/res/CompactLegend-)Roadmap(-[0-9a-f]{32})$
 *   GOOD: ^(https://www\.gstatic\.com/maps/res/CompactLegend-)Roadmap(-.*)$
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS TEST ASSERTS
 * ---------------------------------------------------------------------------
 * ARM 0  premise      Chrome still rejects the known-bad filter, and still
 *                     accepts the shipped one. Measured through
 *                     updateDynamicRules, which unlike the static path reports
 *                     the rejection out loud, so the premise is quotable.
 * ARM 1  good build   Every shipped rule matches its real captured URL under
 *                     Chrome's own compiled copy, and the extension's self-check
 *                     reports rules=ok.
 * ARM 2  bad build    A build whose ruleset carries the known-bad filter. The
 *                     mutation control. Asserts BOTH halves of the trap:
 *                       (a) getEnabledRulesets() is still green  <- the trap
 *                       (b) testMatchOutcome finds no match      <- the detector
 *                     and that the extension's own self-check therefore reports
 *                     rules=failed / verdict=rules-broken.
 *
 * If ARM 2 ever reports the ruleset as NOT enabled, the trap has been fixed
 * upstream and this test says so rather than silently passing.
 *
 * Local browser only. The extension's self-check does make three small HEAD/GET
 * probes to Google when it runs; the rule half of its verdict does not depend on
 * them, and the test asserts only on the rule half.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

import { loadRules } from '../lib/rules.mjs';
import { freshChromiumProfile } from '../lib/chrome-profile.mjs';
import { MUST_MATCH, KNOWN_BAD_REGEX_FILTER } from '../fixtures/url-corpus.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const DIST = process.env.GATE_EXT_DIR ?? path.join(ROOT, 'dist', 'chrome');

const results = [];
const record = (name, pass, detail) => {
  results.push({ name, pass, detail });
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}`);
  console.log(`        ${detail}`);
};

/** Recursive copy without depending on fs.cp's stability across Node versions. */
function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    if (e.name === '_metadata') continue; // Chrome writes this into unpacked dirs
    const s = path.join(src, e.name);
    const d = path.join(dst, e.name);
    if (e.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

async function withExtension(extDir, fn) {
  // freshChromiumProfile, not a bare mkdtemp: Chrome serves the CACHED service
  // worker for an unpacked extension across a restart and across a manifest
  // version bump, so a reused profile can run the previous background.js while
  // reporting the new version. See test/lib/chrome-profile.mjs.
  const profileDir = freshChromiumProfile(os.tmpdir(), 'dnr2kb-profile-', (m) => console.log(`  ${m}`));
  const ctx = await chromium.launchPersistentContext(profileDir, {
    headless: false,
    args: [
      '--no-first-run',
      '--no-default-browser-check',
      '--hide-crash-restore-bubble',
      `--disable-extensions-except=${extDir}`,
      `--load-extension=${extDir}`,
    ],
    ignoreDefaultArgs: ['--disable-extensions'],
  });
  try {
    let sw = ctx.serviceWorkers()[0] ?? null;
    if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 30000 });
    return await fn(sw, ctx);
  } finally {
    await ctx.close().catch(() => {});
    try {
      fs.rmSync(profileDir, { recursive: true, force: true, maxRetries: 3 });
    } catch {
      /* Windows sometimes holds the profile briefly */
    }
  }
}

/**
 * Probe run inside the extension's service worker.
 *
 * ---------------------------------------------------------------------------
 * ORDERING -- this is the whole design, and it used to be wrong
 * ---------------------------------------------------------------------------
 * The first version of this probe read `getEnabledRulesets()` on its first line
 * and then ran testMatchOutcome. Both were RACES against the extension's own
 * boot, which is: apply the persisted ruleset state, run the self-check, and --
 * on a `rules-broken` or `token-dead` verdict -- DISABLE the static ruleset,
 * roughly 300 ms in. ARM 2 deliberately induces `rules-broken`. So:
 *
 *   - the "ruleset is still green" observation was true only if the probe won
 *     the race, and
 *   - once remediation lands, testMatchOutcome correctly reports NO rule
 *     matching ANYTHING, which would fail the `ARM2.rule-N-unaffected` checks
 *     for rules 2, 3 and 4 -- the ones whose whole job is to show that only
 *     rule 1 was mutated.
 *
 * It passed 3/3 by margin, not by construction. This version removes the race
 * instead of widening the margin:
 *
 *   1. WAIT for the health record. background.js writes it only AFTER
 *      remediation has run, so its arrival is a hard barrier: nothing about the
 *      first check run is still in flight once it exists.
 *   2. Read the pre-remediation ruleset state OUT OF THAT RECORD. background.js
 *      captures `enabledRulesets` before it remediates and stores it verbatim,
 *      so this is the trap observation taken at the only moment it means
 *      anything -- and it is a stored value, not a re-measurement.
 *   3. Read the post-remediation state, which is now settled and cannot move.
 *   4. Re-arm the static ruleset explicitly, and confirm it took, so the
 *      matching oracle runs against a known-enabled ruleset. Nothing re-runs the
 *      self-check afterwards (the next run is the 6-hour alarm), so this state
 *      holds for the rest of the probe.
 *   5. Only then ask testMatchOutcome anything.
 *
 * Step 4 is measurement scaffolding, not a claim about the product: the
 * product's remediation has already happened and been recorded by step 2.
 */
async function probe(sw, samples, badFilter, rulesetId) {
  return sw.evaluate(
    async ([samples, badFilter, rulesetId]) => {
      const out = { matches: [], dynamic: {}, health: null, rulesets: {} };
      out.testMatchOutcomeAvailable = typeof chrome.declarativeNetRequest.testMatchOutcome === 'function';

      /* --- 1. barrier: the first check run is complete ---------------------- */
      // Read out of storage, NOT over runtime.sendMessage: a service worker's
      // own sendMessage does not dispatch to its own onMessage listener
      // ("Receiving end does not exist"). background.js runs the checks on
      // onInstalled -- which always fires here, because every launch uses a
      // fresh profile -- and writes the record under the "health" key once
      // remediation has already been applied.
      let rec = null;
      try {
        for (let i = 0; i < 120 && !rec; i++) {
          rec = (await chrome.storage.local.get('health'))?.health ?? null;
          if (!rec) await new Promise((r) => setTimeout(r, 250));
        }
        out.health = rec
          ? {
              verdict: rec.verdict,
              rules: rec.rules?.status,
              legend: rec.legend?.status,
              raster: rec.raster?.status,
              enabledRulesets: rec.enabledRulesets,
              remediation: rec.remediation
                ? {
                    action: rec.remediation.action,
                    autoDisabled: rec.remediation.autoDisabled,
                    reason: rec.remediation.reason,
                    rulesetsAfter: rec.remediation.rulesetsAfter,
                  }
                : null,
              checks: (rec.rules?.checks ?? []).map((c) => ({
                id: c.ruleId,
                name: c.name,
                matched: c.matched,
                rewriteOk: c.rewriteOk,
                note: c.note,
              })),
            }
          : null;
      } catch (e) {
        out.healthError = String(e?.message ?? e);
      }
      out.healthRecordSeen = rec !== null;

      /* --- 2/3. the two ruleset observations, neither of them a race -------- */
      // As the extension itself saw it, before it acted on the verdict.
      out.rulesets.atSelfCheck = rec?.enabledRulesets ?? null;
      try {
        // Settled: remediation is already done by the time the record exists.
        out.rulesets.afterRemediation = await chrome.declarativeNetRequest.getEnabledRulesets();
      } catch (e) {
        out.rulesets.afterRemediationError = String(e);
      }

      /* --- 4. arm the ruleset for the matching oracle ----------------------- */
      try {
        await chrome.declarativeNetRequest.updateEnabledRulesets({ enableRulesetIds: [rulesetId] });
        out.rulesets.forMatching = await chrome.declarativeNetRequest.getEnabledRulesets();
      } catch (e) {
        out.rulesets.forMatchingError = String(e);
      }
      out.rulesetArmedForMatching =
        Array.isArray(out.rulesets.forMatching) && out.rulesets.forMatching.includes(rulesetId);

      /* --- 5. the matching oracle ------------------------------------------ */
      for (const s of samples) {
        const row = { ruleId: s.ruleId, name: s.name, url: s.url };
        try {
          const o = await chrome.declarativeNetRequest.testMatchOutcome({
            url: s.url,
            type: s.resourceType,
            initiator: 'https://www.google.com',
            method: 'get',
          });
          row.matchedRuleIds = (o?.matchedRules ?? []).map((m) => m.ruleId);
        } catch (e) {
          row.error = String(e?.message ?? e);
        }
        out.matches.push(row);
      }

      // ARM 0: ask Chrome directly whether it will compile each filter.
      const tryAdd = async (id, regexFilter) => {
        try {
          await chrome.declarativeNetRequest.updateDynamicRules({
            removeRuleIds: [id],
            addRules: [
              {
                id,
                priority: 1,
                action: { type: 'redirect', redirect: { regexSubstitution: '\\1RoadmapDark\\2' } },
                condition: { regexFilter, resourceTypes: ['xmlhttprequest'] },
              },
            ],
          });
          const present = (await chrome.declarativeNetRequest.getDynamicRules()).some((r) => r.id === id);
          await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: [id] });
          return { accepted: true, present, error: null };
        } catch (e) {
          return { accepted: false, present: false, error: String(e?.message ?? e) };
        }
      };
      out.dynamic.bad = await tryAdd(9001, badFilter);
      out.dynamic.good = await tryAdd(
        9002,
        '^(https://www\\.gstatic\\.com/maps/res/CompactLegend-)Roadmap(-.*)$'
      );

      return out;
    },
    [samples, badFilter, rulesetId]
  );
}

async function main() {
  if (!fs.existsSync(path.join(DIST, 'manifest.json'))) {
    throw new Error(`no built extension at ${DIST}; run \`npm run build\` first`);
  }

  // The ruleset id is read from the built manifest, never hard-coded: the probe
  // has to re-arm that exact ruleset, and a hard-coded id that stopped matching
  // the manifest would silently turn the re-arm into a no-op.
  const builtManifest = JSON.parse(fs.readFileSync(path.join(DIST, 'manifest.json'), 'utf8'));
  const rulesetIds = (builtManifest?.declarative_net_request?.rule_resources ?? []).map((r) => r.id);
  if (rulesetIds.length !== 1) {
    throw new Error(
      `expected exactly one static ruleset in ${DIST}/manifest.json, found ${JSON.stringify(rulesetIds)}`
    );
  }
  const RULESET_ID = rulesetIds[0];

  const shipped = loadRules();
  // EVERY corpus sample for every shipped rule id, not one representative each.
  // Rules 3 and 4 carry a `(Roadmap|Terrain)` alternation, and one sample per
  // rule would put only the Roadmap arm through Chrome's own RE2 engine -- which
  // is the one thing the offline suite genuinely cannot do for itself, because
  // it evaluates the filters with JavaScript's regex engine rather than RE2.
  const samples = [];
  for (const r of shipped) {
    const found = MUST_MATCH.filter((c) => c.ruleId === r.id);
    if (found.length === 0) throw new Error(`no corpus sample for shipped rule id ${r.id}`);
    for (const s of found) {
      samples.push({ ruleId: r.id, name: s.name, url: s.url, resourceType: s.resourceType });
    }
  }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dnr2kb-'));
  const goodDir = path.join(tmp, 'good');
  const badDir = path.join(tmp, 'bad');
  copyDir(DIST, goodDir);
  copyDir(DIST, badDir);

  // The mutation: swap rule 1's filter for the known-bad one. Everything else,
  // including the substitution and the other three rules, is left alone.
  const badRulesPath = path.join(badDir, 'rules', 'dark-map.json');
  const badRules = JSON.parse(fs.readFileSync(badRulesPath, 'utf8'));
  const target = badRules.find((r) => r.id === 1);
  if (!target) throw new Error('rule id 1 not found in the built ruleset');
  const originalFilter = target.condition.regexFilter;
  target.condition.regexFilter = KNOWN_BAD_REGEX_FILTER;
  fs.writeFileSync(badRulesPath, JSON.stringify(badRules, null, 2));

  console.log('='.repeat(96));
  console.log('2 KB DNR TRAP DETECTOR');
  console.log('='.repeat(96));
  console.log(`shipped extension : ${DIST}`);
  console.log(`good build        : ${goodDir}`);
  console.log(`bad build         : ${badDir}`);
  console.log(`rule 1 filter     : ${originalFilter}`);
  console.log(`mutated to        : ${KNOWN_BAD_REGEX_FILTER}`);
  console.log('');

  console.log(`ruleset id        : ${RULESET_ID} (read from ${path.join(DIST, 'manifest.json')})`);
  console.log('');

  console.log('--- ARM 1: the shipped build ---');
  const good = await withExtension(goodDir, (sw) => probe(sw, samples, KNOWN_BAD_REGEX_FILTER, RULESET_ID));
  console.log(`  raw: ${JSON.stringify(good, null, 1).slice(0, 4000)}`);

  record(
    'ARM0.premise.testMatchOutcome-available',
    good.testMatchOutcomeAvailable === true,
    `testMatchOutcome available in the service worker: ${good.testMatchOutcomeAvailable}. ` +
      'Without it there is no detector at all and every other assertion here is vacuous.'
  );
  record(
    'ARM0.premise.chrome-rejects-known-bad-filter',
    good.dynamic?.bad?.accepted === false && /2\s*KB|memory limit/i.test(good.dynamic?.bad?.error ?? ''),
    `updateDynamicRules(known-bad) -> accepted=${good.dynamic?.bad?.accepted} error=${JSON.stringify(good.dynamic?.bad?.error)}`
  );
  record(
    'ARM0.premise.chrome-accepts-shipped-filter',
    good.dynamic?.good?.accepted === true && good.dynamic?.good?.present === true,
    `updateDynamicRules(shipped shape) -> accepted=${good.dynamic?.good?.accepted} present=${good.dynamic?.good?.present} error=${JSON.stringify(good.dynamic?.good?.error)}`
  );
  record(
    'ARM0.barrier: the extension finished its first check run',
    good.healthRecordSeen === true,
    `health record observed: ${good.healthRecordSeen}. Everything below is measured AFTER this ` +
      'barrier, so no assertion here is racing the extension\'s own boot-time remediation. ' +
      'Without the barrier the ruleset readings and testMatchOutcome are timing-dependent.'
  );
  record(
    'ARM1.ruleset-enabled',
    Array.isArray(good.rulesets?.atSelfCheck) && good.rulesets.atSelfCheck.includes(RULESET_ID),
    `enabledRulesets as the extension recorded them at self-check time = ` +
      `${JSON.stringify(good.rulesets?.atSelfCheck)}; after remediation = ` +
      `${JSON.stringify(good.rulesets?.afterRemediation)}`
  );
  record(
    'ARM1.oracle-armed: the ruleset is enabled while testMatchOutcome runs',
    good.rulesetArmedForMatching === true,
    `rulesets when the oracle ran = ${JSON.stringify(good.rulesets?.forMatching)}. A disabled ` +
      'ruleset makes testMatchOutcome report "no rule matched" for every URL, which would look ' +
      'exactly like the 2 KB trap firing on all four rules at once.'
  );
  for (const m of good.matches) {
    record(
      `ARM1.rule-${m.ruleId}-matches[${m.name}]`,
      Array.isArray(m.matchedRuleIds) && m.matchedRuleIds.includes(m.ruleId),
      `${m.name}: Chrome matched rule ids ${JSON.stringify(m.matchedRuleIds ?? m.error)}`
    );
  }
  record(
    'ARM1.self-check-reports-ok',
    good.health?.rules === 'ok',
    `extension self-check: rules=${good.health?.rules} verdict=${good.health?.verdict} ` +
      `(legend=${good.health?.legend} raster=${good.health?.raster}; only the rules half is asserted)`
  );

  console.log('');
  console.log('--- ARM 2: the mutated build (rule 1 filter over the 2 KB budget) ---');
  const bad = await withExtension(badDir, (sw) => probe(sw, samples, KNOWN_BAD_REGEX_FILTER, RULESET_ID));
  console.log(`  raw: ${JSON.stringify(bad, null, 1).slice(0, 4000)}`);

  record(
    'ARM2.barrier: the extension finished its first check run',
    bad.healthRecordSeen === true,
    `health record observed: ${bad.healthRecordSeen}`
  );
  record(
    'ARM2.trap-half-a: ruleset still reports as ENABLED',
    Array.isArray(bad.rulesets?.atSelfCheck) && bad.rulesets.atSelfCheck.includes(RULESET_ID),
    `enabledRulesets, as the extension itself recorded them at the moment it ran the self-check = ` +
      `${JSON.stringify(bad.rulesets?.atSelfCheck)} -- this is the trap: the ruleset is green ` +
      'while rule 1 was silently dropped. Taken from the stored health record rather than ' +
      're-measured, because by the time anything can re-measure it the extension has already ' +
      'taken the ruleset off the air. If this ever fails, Chrome has started reporting the skip ' +
      'and the detector may no longer be needed.'
  );
  record(
    'ARM2.oracle-armed: the ruleset is enabled while testMatchOutcome runs',
    bad.rulesetArmedForMatching === true,
    `rulesets when the oracle ran = ${JSON.stringify(bad.rulesets?.forMatching)} (re-armed by the ` +
      'harness after remediation, so the per-rule results below mean "this rule was dropped" ' +
      'rather than "the whole ruleset is off")'
  );
  const badRule1 = bad.matches.filter((m) => m.ruleId === 1);
  record(
    'ARM2.trap-half-b: rule 1 does NOT match under Chrome',
    badRule1.length > 0 &&
      badRule1.every((m) => Array.isArray(m.matchedRuleIds) && !m.matchedRuleIds.includes(1)),
    `testMatchOutcome on ${badRule1.length} rule-1 sample(s): ` +
      badRule1.map((m) => `${m.name} -> ${JSON.stringify(m.matchedRuleIds ?? m.error)}`).join('; ')
  );
  for (const m of bad.matches.filter((x) => x.ruleId !== 1)) {
    record(
      `ARM2.rule-${m.ruleId}-unaffected[${m.name}]`,
      Array.isArray(m.matchedRuleIds) && m.matchedRuleIds.includes(m.ruleId),
      `${m.name}: matched ${JSON.stringify(m.matchedRuleIds ?? m.error)} -- only rule 1 was mutated`
    );
  }
  record(
    'ARM2.DETECTOR-FIRES: self-check reports rules=failed',
    bad.health?.rules === 'failed',
    `extension self-check: rules=${bad.health?.rules} verdict=${bad.health?.verdict}; ` +
      `rule 1 note = ${JSON.stringify(bad.health?.checks?.find((c) => c.id === 1)?.note ?? null)}`
  );
  record(
    'ARM2.DETECTOR-FIRES: overall verdict is rules-broken',
    bad.health?.verdict === 'rules-broken',
    `verdict=${bad.health?.verdict} (must outrank the network probes: the network can be perfectly ` +
      'healthy while the map stays light)'
  );
  record(
    'ARM2.REMEDIATION-ACTS: the broken ruleset was taken off the air',
    bad.health?.remediation?.autoDisabled === true &&
      Array.isArray(bad.rulesets?.afterRemediation) &&
      !bad.rulesets.afterRemediation.includes(RULESET_ID),
    `remediation action=${bad.health?.remediation?.action} autoDisabled=` +
      `${bad.health?.remediation?.autoDisabled} reason=${bad.health?.remediation?.reason}; ` +
      `getEnabledRulesets() after the run = ${JSON.stringify(bad.rulesets?.afterRemediation)}. ` +
      'Detecting the fault and leaving the ruleset armed would leave a user with a dark map and ' +
      'no working Maps UI, which is the state this remediation exists to prevent. ' +
      '(ARM 1 is not asserted this way: a healthy build has nothing to remediate.)'
  );
  record(
    'ARM1.NO-REMEDIATION: the healthy build was left armed',
    good.health?.remediation?.autoDisabled === false &&
      Array.isArray(good.rulesets?.afterRemediation) &&
      good.rulesets.afterRemediation.includes(RULESET_ID),
    `remediation action=${good.health?.remediation?.action} autoDisabled=` +
      `${good.health?.remediation?.autoDisabled}; getEnabledRulesets() after the run = ` +
      `${JSON.stringify(good.rulesets?.afterRemediation)}. This is the control for the ARM 2 ` +
      'remediation check: if the shipped build disarmed itself too, that check would be measuring ' +
      'nothing.'
  );

  try {
    fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 3 });
  } catch {
    /* leave it for the OS */
  }

  const failed = results.filter((r) => !r.pass);
  console.log('');
  console.log('-'.repeat(96));
  console.log(`2 KB TRAP DETECTOR: ${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) {
    console.log('FAILED:');
    for (const f of failed) console.log(`  - ${f.name}: ${f.detail}`);
  }
  console.log('-'.repeat(96));
  process.exitCode = failed.length ? 1 : 0;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
