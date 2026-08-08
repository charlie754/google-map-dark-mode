// Harness self-test fixture background worker.
//
// Its only jobs are (a) to exist, so the harness can observe a service worker
// activating and derive the extension id, and (b) to expose the DNR ruleset
// state to `serviceWorker.evaluate()` so a failed gate can tell "the rule did
// not match" apart from "the extension never loaded".

const SAMPLE_TILE =
  'https://www.google.com/maps/vt/pb=!1m4!1m3!1i13!2i1925!3i3385!2m3!1e0!2sm!3i789555512' +
  '!3m8!2sen!3sus!5e1105!12m4!1e68!2m2!1sset!2sRoadmap!4e0!5m1!1e0';

globalThis.__m0probe = async () => {
  const out = { sampleTile: SAMPLE_TILE };
  try {
    out.enabledRulesets = await chrome.declarativeNetRequest.getEnabledRulesets();
  } catch (e) {
    out.enabledRulesetsError = String(e);
  }
  try {
    const rules = await chrome.declarativeNetRequest.getDynamicRules();
    out.dynamicRuleCount = rules.length;
  } catch (e) {
    out.dynamicRulesError = String(e);
  }
  try {
    out.testMatchOutcome = await chrome.declarativeNetRequest.testMatchOutcome({
      url: SAMPLE_TILE,
      initiator: 'https://www.google.com',
      type: 'xmlhttprequest',
      method: 'get',
    });
  } catch (e) {
    out.testMatchOutcomeError = String(e);
  }
  return out;
};

chrome.runtime.onInstalled.addListener(() => {
  console.log('[m0-probe] installed');
});

console.log('[m0-probe] service worker started');
