/**
 * Install and interrogate an unpacked, unsigned add-on in a Playwright-launched
 * Firefox, over the DevTools Remote Debugging Protocol.
 *
 * The RDP wire client itself is `test/experiments/firefox-load/rdp.mjs` and is
 * imported, not reimplemented -- an earlier lane proved that client works and
 * that the obvious alternative (dropping an XPI into <profile>/extensions/) is a
 * silent no-op on this Gecko build: the add-on is never even recorded in
 * extensions.json, so every "Firefox extension run" done that way was in fact a
 * second control run. installTemporaryAddon is the mechanism `web-ext run` uses
 * internally, minus the undriveable browser.
 *
 * The background-context evaluation below is the shape proven in
 * test/experiments/firefox-load/gate-run.mjs: the modern descriptor actor has no
 * `getTarget`, so the target form arrives as an unsolicited
 * `target-available-form` notification after `watchTargets`. Both shapes are
 * attempted so this keeps working across Gecko versions.
 */

import { connectWithRetry, installTemporaryAddon } from '../experiments/firefox-load/rdp.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * @param {number} port
 * @param {string} extDir  absolute path to the unpacked add-on
 * @param {string} geckoId browser_specific_settings.gecko.id from its manifest
 * @param {(s:string)=>void} log
 */
export async function installAndProbe(port, extDir, geckoId, log) {
  const { client, attempt } = await connectWithRetry(port, { attempts: 40, delayMs: 500 });
  log(`RDP connected on 127.0.0.1:${port} (attempt ${attempt})`);

  const installed = await installTemporaryAddon(client, extDir);
  const entry = installed.listed.find((a) => a.id === geckoId) ?? null;
  const uuid = String(entry?.manifestURL ?? '').match(/moz-extension:\/\/([0-9a-f-]+)\//)?.[1] ?? null;
  log(
    `installTemporaryAddon -> id=${installed.addon?.id} temporarilyInstalled=${entry?.temporarilyInstalled} ` +
      `backgroundScriptStatus=${entry?.backgroundScriptStatus} uuid=${uuid} ` +
      `warnings=${JSON.stringify(entry?.warnings ?? null)}`
  );
  return { client, addon: installed.addon, entry, uuid, descriptorActor: entry?.actor ?? null };
}

/** Re-read the add-on entry (used for the post-run "was it still armed?" probe). */
export async function relistAddon(client, geckoId) {
  const listed = await client.request({ to: 'root', type: 'listAddons' }, { timeoutMs: 15000 });
  return (listed.addons ?? []).find((a) => a.id === geckoId) ?? null;
}

/**
 * Evaluate an expression in the add-on's background context.
 * @param {import('../experiments/firefox-load/rdp.mjs').RdpClient} client
 * @param {string} descriptorActor
 * @param {string} expr  must evaluate to a JSON string
 */
export async function evalInBackground(client, descriptorActor, expr, log) {
  if (!descriptorActor) return { error: 'no descriptor actor' };
  let consoleActor = null;
  let how = null;

  try {
    const t = await client.request({ to: descriptorActor, type: 'getTarget' }, { timeoutMs: 10000 });
    consoleActor = t?.frame?.consoleActor ?? t?.form?.consoleActor ?? null;
    if (consoleActor) how = 'descriptor.getTarget';
  } catch {
    /* expected on Gecko >= ~115 */
  }

  if (!consoleActor) {
    try {
      const w = await client.request({ to: descriptorActor, type: 'getWatcher' }, { timeoutMs: 15000 });
      const watcher = w.actor ?? w.watcher ?? w?.form?.actor;
      const before = client.notifications.length;
      await client.request({ to: watcher, type: 'watchTargets', targetType: 'frame' }, { timeoutMs: 20000 });
      await sleep(1500);
      const form = client.notifications
        .slice(before)
        .filter((n) => n.type === 'target-available-form')
        .map((n) => n.target)
        .find((f) => f?.consoleActor);
      consoleActor = form?.consoleActor ?? null;
      if (consoleActor) how = 'watcher.watchTargets(frame)';
    } catch (err) {
      log?.(`background eval: watcher path failed: ${err.message}`);
    }
  }

  if (!consoleActor) return { error: 'no console actor reachable' };

  const ack = await client.request(
    { to: consoleActor, type: 'evaluateJSAsync', text: expr, mapped: { await: true } },
    { timeoutMs: 60000 }
  );
  let packet = null;
  for (let i = 0; i < 120 && !packet; i++) {
    packet = client.notifications.find(
      (n) => n.type === 'evaluationResult' && n.resultID === ack.resultID
    );
    if (!packet) await sleep(250);
  }
  let parsed = null;
  try {
    parsed = JSON.parse(packet?.result);
  } catch {
    parsed = null;
  }
  return { how, consoleActor, hasException: packet?.hasException ?? null, raw: packet?.result ?? null, parsed };
}

/**
 * The standard state dump: which rulesets are on, how many dynamic/session
 * rules exist, and the health record the extension's own self-check wrote.
 */
export const STATE_EXPR = `(async () => {
  const api = globalThis.browser ?? globalThis.chrome;
  const out = { hasDnr: Boolean(api?.declarativeNetRequest) };
  try { out.enabledRulesets = await api.declarativeNetRequest.getEnabledRulesets(); }
  catch (e) { out.enabledRulesetsError = String(e); }
  try { out.dynamicRules = (await api.declarativeNetRequest.getDynamicRules()).length; }
  catch (e) { out.dynamicRulesError = String(e); }
  try { out.sessionRules = (await api.declarativeNetRequest.getSessionRules()).length; }
  catch (e) { out.sessionRulesError = String(e); }
  try { out.manifestName = api.runtime.getManifest().name; } catch (e) { out.manifestError = String(e); }
  /* The health record is READ FROM STORAGE, not requested over
   * runtime.sendMessage: a background context's own sendMessage does not
   * dispatch to its own onMessage listener. background.js runs the checks on
   * onInstalled -- which always fires here, because every run uses a fresh
   * profile and a temporary install -- and writes the record under "health". */
  try {
    let rec = null;
    for (let i = 0; i < 60 && !rec; i++) {
      rec = (await api.storage.local.get('health'))?.health ?? null;
      if (!rec) await new Promise((r) => setTimeout(r, 500));
    }
    out.health = rec ? { verdict: rec.verdict, rules: rec.rules?.status, legend: rec.legend?.status, raster: rec.raster?.status,
      ruleChecks: (rec.rules?.checks ?? []).map(c => ({ id: c.ruleId, name: c.name, matched: c.matched, rewriteOk: c.rewriteOk, note: c.note })) } : null;
  } catch (e) { out.healthError = String(e); }
  return JSON.stringify(out);
})()`;
