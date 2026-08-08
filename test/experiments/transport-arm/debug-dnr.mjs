/**
 * Offline DNR bench: launches Chromium with the probe extension, then uses
 * dynamic rules + testMatchOutcome to find a regexFilter that actually matches
 * the CompactLegend URL. Never navigates to Google, so it costs no live traffic.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import fs from 'node:fs';
import { chromium } from '@playwright/test';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXT = path.join(HERE, 'legend-extension');
const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lane-e-dnr-'));

const LIGHT = 'https://www.gstatic.com/maps/res/CompactLegend-Roadmap-4311471e3660cd049e8ede59d279b3ba';
const DARK = 'https://www.gstatic.com/maps/res/CompactLegend-RoadmapDark-4311471e3660cd049e8ede59d279b3ba';

const CANDIDATES = [
  ['A-anchored-hex', '^(https://www\\.gstatic\\.com/maps/res/CompactLegend-)Roadmap(-[0-9a-f]{32})$'],
  ['B-anchored-any', '^(https://www\\.gstatic\\.com/maps/res/CompactLegend-)Roadmap(-.*)$'],
  ['C-unanchored', '(CompactLegend-)Roadmap(-)'],
  ['D-dotstar', '^(.*CompactLegend-)Roadmap(-.*)$'],
  ['E-no-escape', '^(https://www.gstatic.com/maps/res/CompactLegend-)Roadmap(-.*)$'],
];

const INITIATORS = ['https://www.google.com', undefined];

const ctx = await chromium.launchPersistentContext(profileDir, {
  headless: false,
  args: ['--no-first-run', '--no-default-browser-check', `--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  ignoreDefaultArgs: ['--disable-extensions'],
});
const sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker', { timeout: 15000 }));

const results = await sw.evaluate(
  async ({ candidates, light, dark, initiators }) => {
    const out = [];
    const manifest = chrome.runtime.getManifest();
    out.push({ note: 'manifest', permissions: manifest.permissions, host_permissions: manifest.host_permissions });
    out.push({ note: 'staticRulesets', enabled: await chrome.declarativeNetRequest.getEnabledRulesets() });
    // Turn the static ruleset off so only the rule under test can match.
    await chrome.declarativeNetRequest.updateEnabledRulesets({ disableRulesetIds: ['legend'] });
    let id = 100;
    for (const [name, rx] of candidates) {
      id++;
      let addError = null;
      try {
        await chrome.declarativeNetRequest.updateDynamicRules({
          removeRuleIds: [id - 1, id],
          addRules: [
            {
              id,
              priority: 1,
              action: { type: 'redirect', redirect: { regexSubstitution: '\\1RoadmapDark\\2' } },
              condition: { regexFilter: rx, resourceTypes: ['xmlhttprequest', 'image', 'other'] },
            },
          ],
        });
      } catch (e) {
        addError = String(e);
      }
      const row = { name, rx, addError, match: {} };
      for (const init of initiators) {
        const req = { url: light, type: 'xmlhttprequest', method: 'get' };
        if (init) req.initiator = init;
        try {
          const r = await chrome.declarativeNetRequest.testMatchOutcome(req);
          row.match[init ?? '(no initiator)'] = r.matchedRules;
        } catch (e) {
          row.match[init ?? '(no initiator)'] = String(e);
        }
      }
      try {
        const r = await chrome.declarativeNetRequest.testMatchOutcome({
          url: dark,
          type: 'xmlhttprequest',
          initiator: 'https://www.google.com',
          method: 'get',
        });
        row.loopCheckOnDarkUrl = r.matchedRules;
      } catch (e) {
        row.loopCheckOnDarkUrl = String(e);
      }
      out.push(row);
      await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: [id] });
    }
    return out;
  },
  { candidates: CANDIDATES, light: LIGHT, dark: DARK, initiators: INITIATORS },
);

console.log(JSON.stringify(results, null, 1));
fs.writeFileSync(path.join(HERE, 'data', 'dnr-bench.json'), JSON.stringify(results, null, 1));
await ctx.close();
fs.rmSync(profileDir, { recursive: true, force: true, maxRetries: 3 });
