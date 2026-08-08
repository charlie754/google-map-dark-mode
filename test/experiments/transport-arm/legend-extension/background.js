// Nothing to do at runtime -- the static ruleset does the work. The service
// worker exists only so the harness has a page to evaluate in, and so a failed
// ruleset load is visible rather than silent.
chrome.declarativeNetRequest.getEnabledRulesets().then((r) => {
  console.log('[lane-e] enabled rulesets:', JSON.stringify(r));
});
