/**
 * Google Map Dark Mode — settings, background self-check, and remediation.
 *
 * This file is loaded in two different ways and must be valid in both:
 *   - Chrome MV3: an ES module service worker ("type": "module").
 *   - Firefox MV3: a classic event-page script ("background": { "scripts": [...] }).
 *
 * Therefore: no `import`, no `export`, no top-level `await`. Everything is a
 * plain declaration plus synchronously-registered event listeners, so the
 * listeners exist before the worker/event page can be torn down.
 *
 * ---------------------------------------------------------------------------
 * WHAT THE EXTENSION ACTUALLY DOES
 * ---------------------------------------------------------------------------
 * All the colour work lives in the declarativeNetRequest static ruleset
 * (rules/dark-map.json). Google Maps picks one of three renderers client-side
 * and each takes its palette from a different place, so it takes four rules to
 * cover them:
 *
 *   mode            base-map transport                    palette source
 *   --------------  -----------------------------------   --------------------
 *   mapcore         /maps/vt/proto?bpb=<protobuf>          gstatic CompactLegend
 *   canvas+labeler  /maps/vt/pb= raster + /vt/stream/pb=   gstatic CompactLegend
 *   canvas          /maps/vt/pb= raster + /vt/stream/pb=   server, via the
 *                                                          stream URL's set: token
 *
 *   rule 1  CompactLegend-Roadmap-<v>  -> CompactLegend-RoadmapDark-<v>
 *           The important one. Covers mapcore and canvas+labeler, i.e. every
 *           stock desktop Chrome and every Firefox.
 *   rule 2  CompactLegend-Terrain-<v>  -> CompactLegend-TerrainDark-<v>
 *           Same, for the terrain base map.
 *   rule 3  /maps/vt/stream/pb=…!2s(Roadmap|Terrain)! -> …Dark!
 *           Covers plain `canvas` mode, which colours from the server stream.
 *   rule 4  /maps/vt/pb=…!2s(Roadmap|Terrain)!        -> …Dark!
 *           The server-HTML first-paint raster grid, present in ALL modes. Its
 *           only job is to remove the ~1 s light flash before the vector layer
 *           arrives; it cannot darken the map on its own (the vector renderer
 *           overpaints it).
 *
 * Rewriting the `set:` token inside the mapcore /maps/vt/proto?bpb= protobuf is
 * NOT attempted: three nested length prefixes plus base64 re-encoding put it out
 * of reach of a regex substitution. Rule 1 is what makes mapcore dark.
 *
 * ---------------------------------------------------------------------------
 * WHY THERE IS A SELF-CHECK AT ALL
 * ---------------------------------------------------------------------------
 * Chrome silently drops a DNR rule whose regexFilter exceeds a 2 KB
 * compiled-memory budget. The extension still installs, the ruleset still shows
 * up in getEnabledRulesets(), and the only symptom is that the map stays light.
 * (Measured: `(-[0-9a-f]{32})$` as the version tail blows the budget; `(-.*)$`
 * does not.) So health is never inferred from "the ruleset is enabled" — every
 * rule is put through a real matching oracle against a real captured URL.
 *
 * The rule table is derived from the shipped ruleset rather than duplicated
 * here, so a rule added without a matching self-check entry is itself reported
 * as a failure instead of quietly going unverified.
 *
 * ---------------------------------------------------------------------------
 * WHY A DETECTED FAILURE IS ACTED ON, NOT JUST REPORTED
 * ---------------------------------------------------------------------------
 * When the dark style name stops being served, rule 1 redirects Maps' ~2 MB
 * palette fetch to a 404. MEASURED, on live Maps in stock headed Chromium
 * (mapcore), against a control and a working build:
 *
 *   arm      map-area mean RGB    buttons  focusable  attribution  zoom  Layers
 *   control  (223,231,230) LIGHT       46         48          yes   yes     yes
 *   working  ( 36, 54, 76) DARK        46         48          yes   yes     yes
 *   404      ( 39, 55, 76) DARK         6          7           NO    NO      NO
 *
 * So a dead style name does NOT blank the vector map and does NOT degrade to
 * light — the renderer falls back to the raster/stream transport, which rules 3
 * and 4 darken, and the picture looks right. What breaks is the APPLICATION:
 * Maps never finishes mounting, which is the same signature CLAUDE.md records
 * for blocking the vector transport outright. A user in that state gets a
 * handsome dark map with no zoom controls, no Street View, no Layers widget and
 * no attribution bar, which is strictly worse than having no extension at all.
 *
 * That is why a `token-dead` or `rules-broken` verdict disables the ruleset in
 * the same run that detects it, and records WHY it was disabled. The record is
 * kept apart from the user's own switch: an auto-disable is undone by the next
 * probe that clears its cause, a user-disable never is.
 */

const api = globalThis.browser ?? globalThis.chrome;

/**
 * Console attribution tag. Coupled: `attributableToExtension()` in
 * `test/lib/live-assertions.mjs` matches this exact literal to decide whether a
 * console error belongs to us, so the two move together or A5 stops seeing our
 * own errors. It must also stay distinguishable from
 * `LISTENER_PROBE_MARK` in `test/lib/session.mjs`.
 */
const LOG_PREFIX = "[google-map-dark-mode]";
const STORAGE_KEY = "health";
const VERSION_KEY = "legendVersion";
const SETTINGS_KEY = "settings";
const RULESET_STATE_KEY = "rulesetState";
const RULESET_PATH = "rules/dark-map.json";

/** The static ruleset id declared in both manifests. */
const RULESET_ID = "dark_map";

/** Re-probe the network at most this often when woken by a getHealth message. */
const MAX_RECORD_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * Periodic re-check. Without it the health record is only ever as fresh as the
 * last browser start, which for a machine that sleeps rather than shuts down is
 * "never" — and a verdict that never refreshes can neither raise the alarm nor
 * clear it. Six hours is chosen over the plan's 24 h because the verdict now
 * drives remediation: an auto-disabled ruleset should come back within hours of
 * Google restoring the style, not within a day. The cost is three small HTTP
 * requests per period.
 */
const HEALTH_ALARM = "healthCheck";
const HEALTH_ALARM_PERIOD_MINUTES = 6 * 60;

/**
 * User settings. All three default true: the extension does its job out of the
 * box, and every switch is a way to turn something OFF.
 *
 *   enabled     master switch; gates both of the others
 *   darkMap     the DNR ruleset that darkens the map surface
 *   darkChrome  the content script that recolours the app chrome
 *
 * `enabled && darkMap` is the only input to whether the ruleset is armed.
 * `darkChrome` is owned by the content script, which follows storage.onChanged;
 * see the note on broadcastSettings() below for why no message is sent.
 */
const DEFAULT_SETTINGS = Object.freeze({ enabled: true, darkMap: true, darkChrome: true });
const SETTINGS_KEYS = Object.freeze(Object.keys(DEFAULT_SETTINGS));

/**
 * Verdicts that mean "the ruleset is doing harm, or at best nothing" and must
 * therefore take the ruleset off the air.
 *
 * `degraded` is deliberately NOT here: it means the map still goes dark and only
 * the first-paint flash is back. Disabling on `degraded` would trade a one
 * second flash for no dark mode at all.
 */
const AUTO_DISABLE_VERDICTS = Object.freeze(["token-dead", "rules-broken"]);

/**
 * Legend version hashes known to exist. gstatic serves CompactLegend assets
 * under an immutable 32-hex content version; two were observed within one day,
 * so these rotate and a pinned hash WILL eventually 404. That is why the probe
 * distinguishes "this version is gone" from "the dark style name is gone" —
 * only the latter is a real failure. Newest first.
 */
const PINNED_LEGEND_VERSIONS = [
  "e3dec3f84b7764496b89ce7fd835e7f4",
  "4311471e3660cd049e8ede59d279b3ba",
];

/**
 * Version-liveness canary. `RoadmapSatellite` is served (HTTP 200) alongside
 * Roadmap/RoadmapDark/Terrain/TerrainDark, and — critically — none of our four
 * rules can match it: rule 1 requires `Roadmap` followed immediately by `-`,
 * and here it is followed by `S`. So the canary measures whether the *version*
 * is still on the CDN without being perturbed by our own redirects.
 */
const LEGEND_CANARY_STYLE = "RoadmapSatellite";
const LEGEND_TARGET_STYLE = "RoadmapDark";

/**
 * Fixed z13 tile over Houston, already carrying the dark token — so this URL is
 * likewise immune to rule 4, which requires a bare `Roadmap`. Real dark tiles
 * measure ~20-30 KB (24,154 B light / 22,765 B dark on last measure); Google's
 * "invalid style" response is a 178-byte solid-yellow PNG served with HTTP 200,
 * which is why this one classifies on size and the legend probe on status.
 */
const RASTER_PROBE_URL =
  "https://www.google.com/maps/vt/pb=!1m4!1m3!1i13!2i1925!3i3385!2m3!1e0!2sm!3i789555512!3m8!2sen!3sus!5e1105!12m4!1e68!2m2!1sset!2sRoadmapDark!4e0!5m1!1e0";

const RASTER_HEALTHY_MIN_BYTES = 5000;
const RASTER_DEAD_MAX_BYTES = 500;

/**
 * Representative real captured URLs, per rule id, with the substitution we
 * expect. Every id present in the shipped ruleset must appear here; ids in one
 * and not the other are reported as a failure by runRuleSelfCheck().
 *
 * The value is a LIST because a rule's regex can carry alternatives that the
 * self-check must not be narrower than: rules 3 and 4 match `(Roadmap|Terrain)`,
 * and a table with only the Roadmap arm would report "ok" for a ruleset whose
 * Terrain arm had been broken.
 *
 * `type` is the DNR resource type to test under. The CompactLegend asset is
 * fetched by Maps as fetch/xhr (both are `xmlhttprequest` to DNR); the raster
 * first-paint grid is an <img> grid, hence `image`.
 */
const RULE_SAMPLES = {
  1: [
    {
      name: "legend-roadmap",
      type: "xmlhttprequest",
      url: "https://www.gstatic.com/maps/res/CompactLegend-Roadmap-4311471e3660cd049e8ede59d279b3ba",
      expect:
        "https://www.gstatic.com/maps/res/CompactLegend-RoadmapDark-4311471e3660cd049e8ede59d279b3ba",
    },
  ],
  2: [
    {
      name: "legend-terrain",
      type: "xmlhttprequest",
      url: "https://www.gstatic.com/maps/res/CompactLegend-Terrain-4311471e3660cd049e8ede59d279b3ba",
      expect:
        "https://www.gstatic.com/maps/res/CompactLegend-TerrainDark-4311471e3660cd049e8ede59d279b3ba",
    },
  ],
  3: [
    {
      name: "vector-stream",
      type: "xmlhttprequest",
      url: "https://www.google.com/maps/vt/stream/pb=!1m7!8m6!1m3!1i12!2i960!3i1691!2i6!3x16777215!2m3!1e0!2sm!3i790555512!3m8!2sen!3sus!5e1105!12m4!1e68!2m2!1sset!2sRoadmap!4e1!5m1!1e0",
      expect:
        "https://www.google.com/maps/vt/stream/pb=!1m7!8m6!1m3!1i12!2i960!3i1691!2i6!3x16777215!2m3!1e0!2sm!3i790555512!3m8!2sen!3sus!5e1105!12m4!1e68!2m2!1sset!2sRoadmapDark!4e1!5m1!1e0",
    },
    {
      name: "vector-stream-terrain",
      type: "xmlhttprequest",
      url: "https://www.google.com/maps/vt/stream/pb=!1m7!8m6!1m3!1i12!2i960!3i1691!2i6!3x16777215!2m3!1e0!2sm!3i790555512!3m8!2sen!3sus!5e1105!12m4!1e68!2m2!1sset!2sTerrain!4e1!5m1!1e0",
      expect:
        "https://www.google.com/maps/vt/stream/pb=!1m7!8m6!1m3!1i12!2i960!3i1691!2i6!3x16777215!2m3!1e0!2sm!3i790555512!3m8!2sen!3sus!5e1105!12m4!1e68!2m2!1sset!2sTerrainDark!4e1!5m1!1e0",
    },
  ],
  4: [
    {
      name: "raster-firstpaint",
      type: "image",
      url: "https://www.google.com/maps/vt/pb=!1m4!1m3!1i17!2i30812!3i54180!2m3!1e0!2sm!3i789555512!3m8!2sen!3sus!5e1105!12m4!1e68!2m2!1sset!2sRoadmap!4e0!5m1!1e0!23i100818990",
      expect:
        "https://www.google.com/maps/vt/pb=!1m4!1m3!1i17!2i30812!3i54180!2m3!1e0!2sm!3i789555512!3m8!2sen!3sus!5e1105!12m4!1e68!2m2!1sset!2sRoadmapDark!4e0!5m1!1e0!23i100818990",
    },
    {
      name: "raster-firstpaint-terrain",
      type: "image",
      url: "https://www.google.com/maps/vt/pb=!1m4!1m3!1i17!2i30812!3i54180!2m3!1e0!2sm!3i789555512!3m8!2sen!3sus!5e1105!12m4!1e68!2m2!1sset!2sTerrain!4e0!5m1!1e0!23i100818990",
      expect:
        "https://www.google.com/maps/vt/pb=!1m4!1m3!1i17!2i30812!3i54180!2m3!1e0!2sm!3i789555512!3m8!2sen!3sus!5e1105!12m4!1e68!2m2!1sset!2sTerrainDark!4e0!5m1!1e0!23i100818990",
    },
  ],
};

/** Realistic initiator for the self-check; every rule fires on Maps' behalf. */
const SELF_CHECK_INITIATOR = "https://www.google.com";

/**
 * Id range for the dynamic-rule mirror oracle (see mirrorCompiles). Kept well
 * clear of the static ruleset's 1-4 and of the 9001/9002 pair the 2 KB
 * regression test uses for its own premise probe.
 */
const MIRROR_ID_BASE = 90000;
const MIRROR_CONTROL_ID = MIRROR_ID_BASE;

/**
 * A domain the mirrored rules are scoped to so they can never match real
 * traffic. Every shipped regexFilter pins a real Google/gstatic host, so a
 * `requestDomains` of `.invalid` makes the condition unsatisfiable while
 * leaving the regexFilter to be compiled — which is the only thing being
 * measured.
 */
const MIRROR_INERT_DOMAIN = "dnr-self-check.invalid";

/** Trivially small filter used as the oracle's own mutation control. */
const MIRROR_CONTROL_FILTER = "^https://control\\.invalid/dnr-self-check$";

/**
 * Rejections that are genuinely about the rule's own regex, as opposed to the
 * API path being unusable. Only the former is allowed to count as a rule
 * FAILURE, because a failure now disables the ruleset for real users.
 */
const MIRROR_COMPILE_ERROR = /regex|regular expression|memory limit|2\s*KB/i;

/**
 * Last record held in memory so getHealth can still answer when the storage
 * write failed. Lost when the worker is torn down; storage is the durable copy.
 * @type {object | null}
 */
let lastRecord = null;

/** Set while a check run is in flight, so concurrent wakeups share one run. */
let inFlight = null;

/* -------------------------------------------------------------------------- */
/* pure helpers                                                               */
/* -------------------------------------------------------------------------- */

/**
 * DNR writes back-references as `\1`; JS String.replace wants `$1`. Escape any
 * literal `$` first so a `$` in the substitution cannot be read as a group ref.
 * @param {string} substitution
 * @returns {string}
 */
function dnrSubstitutionToJs(substitution) {
  return substitution.replace(/\$/g, "$$$$").replace(/\\(\d)/g, "$$$1");
}

/**
 * Apply a rule's regexFilter/regexSubstitution in plain JS.
 *
 * The RE2 syntax used by our rules is a strict subset of JS regex syntax, so
 * this reproduces what Chrome will do. It is a second, independent check
 * alongside the live oracle: the oracle proves the engine accepted and matched
 * the rule, this proves the substitution lands where we think and that the
 * result cannot be matched again.
 *
 * @param {{condition: {regexFilter: string}, action: {redirect: {regexSubstitution: string}}}} rule
 * @param {string} url
 * @returns {{matched: boolean, result: string | null}}
 */
function applyRuleOffline(rule, url) {
  const filter = rule?.condition?.regexFilter;
  const substitution = rule?.action?.redirect?.regexSubstitution;
  if (typeof filter !== "string" || typeof substitution !== "string") {
    return { matched: false, result: null };
  }
  const re = new RegExp(filter);
  if (!re.test(url)) return { matched: false, result: null };
  return { matched: true, result: url.replace(re, dnrSubstitutionToJs(substitution)) };
}

/**
 * @param {number} bytes
 * @returns {"healthy" | "token-dead" | "unknown"}
 */
function classifyRasterBytes(bytes) {
  if (bytes >= RASTER_HEALTHY_MIN_BYTES) return "healthy";
  if (bytes <= RASTER_DEAD_MAX_BYTES) return "token-dead";
  return "unknown";
}

/**
 * @param {"ok"|"failed"|"unknown"} rules
 * @param {string} legend
 * @param {string} raster
 * @returns {"healthy"|"rules-broken"|"token-dead"|"degraded"|"unverified"|"unknown"}
 */
function combineVerdict(rules, legend, raster) {
  // A rule that did not match is the 2 KB-limit symptom and outranks
  // everything: the network can be perfectly healthy and the map still light.
  if (rules === "failed") return "rules-broken";
  if (legend === "token-dead") return "token-dead";
  // Rules that could NOT be checked must never fall through to "healthy". This
  // branch sits above the healthy/degraded ones for exactly that reason: the
  // engine may have dropped a rule and there is no oracle here able to say so.
  if (rules === "unknown") {
    // If the network probes could not run either, "could not check" is the more
    // informative of the two info-level answers.
    if (legend === "unknown" && raster === "unknown") return "unknown";
    return "unverified";
  }
  if (legend === "healthy" && raster === "healthy") return "healthy";
  // Legend alive but the raster token gone: the map still goes dark, we just
  // get the light first-paint flash back. Degraded, not broken.
  if (legend === "healthy" && raster === "token-dead") return "degraded";
  // Anything else — offline, DNS failure, every pinned version garbage
  // collected — is genuinely not known, and must not be reported as failure.
  return "unknown";
}

/** @param {string} verdict */
function isFailure(verdict) {
  return verdict === "rules-broken" || verdict === "token-dead" || verdict === "degraded";
}

function legendUrl(style, version) {
  return `https://www.gstatic.com/maps/res/CompactLegend-${style}-${version}`;
}

/** The shipped name, so the badge tooltip cannot drift from the manifest. */
function extensionName() {
  try {
    const name = api?.runtime?.getManifest?.()?.name;
    if (typeof name === "string" && name !== "") return name;
  } catch (err) {
    /* fall through */
  }
  return "Google Map Dark Mode";
}

/**
 * @param {any} value
 * @returns {{enabled: boolean, darkMap: boolean, darkChrome: boolean}}
 */
function normaliseSettings(value) {
  const out = { ...DEFAULT_SETTINGS };
  if (value && typeof value === "object") {
    for (const key of SETTINGS_KEYS) {
      if (typeof value[key] === "boolean") out[key] = value[key];
    }
  }
  return out;
}

/**
 * Should the DNR ruleset be armed?
 *
 * Two independent reasons to be off, and they are kept apart on purpose. The
 * user's switch is never overwritten by a health verdict, and a health verdict
 * is never mistaken for the user's switch: a user who turned dark mode off
 * stays off through any number of healthy probes.
 *
 * @param {{enabled: boolean, darkMap: boolean}} settings
 * @param {{autoDisabled: boolean}} rulesetState
 * @returns {boolean}
 */
function wantRulesetEnabled(settings, rulesetState) {
  return Boolean(settings.enabled && settings.darkMap) && !rulesetState.autoDisabled;
}

/**
 * Has the specific fault that took the ruleset off the air cleared?
 *
 * Deliberately keyed on the CAUSE rather than on a blanket `verdict === healthy`:
 * a ruleset disabled because RoadmapDark 404'd should come back the moment
 * RoadmapDark is served again, even if the unrelated first-paint raster token is
 * still gone and the verdict is therefore only `degraded`.
 *
 * @param {string | null} reason
 * @param {string} rulesStatus
 * @param {string} legendStatus
 * @param {string} verdict
 * @returns {boolean}
 */
function causeCleared(reason, rulesStatus, legendStatus, verdict) {
  if (AUTO_DISABLE_VERDICTS.includes(verdict)) return false;
  if (reason === "token-dead") return legendStatus === "healthy";
  if (reason === "rules-broken") return rulesStatus === "ok";
  return verdict === "healthy";
}

/* -------------------------------------------------------------------------- */
/* settings and ruleset state                                                 */
/* -------------------------------------------------------------------------- */

/** @returns {Promise<{enabled: boolean, darkMap: boolean, darkChrome: boolean}>} */
async function readSettings() {
  try {
    const stored = await api.storage.local.get(SETTINGS_KEY);
    return normaliseSettings(stored?.[SETTINGS_KEY]);
  } catch (err) {
    console.warn(`${LOG_PREFIX} settings read failed:`, err);
    return { ...DEFAULT_SETTINGS };
  }
}

/**
 * Persisting settings IS the broadcast.
 *
 * The content script owns `darkChrome` and follows `storage.onChanged`, which
 * fires in every extension context that has the `storage` permission —
 * including content scripts, and including the popup and options page, both of
 * which already listen. A runtime.sendMessage broadcast on top would be a
 * second source of truth for the same value and a second thing to keep in step,
 * so there is deliberately only one. (Measured: a content script in the built
 * extension receives storage.onChanged for `settings` with no message sent.)
 *
 * @param {object} settings
 * @returns {Promise<boolean>}
 */
async function writeSettings(settings) {
  try {
    await api.storage.local.set({ [SETTINGS_KEY]: settings });
    return true;
  } catch (err) {
    console.warn(`${LOG_PREFIX} settings write failed:`, err);
    return false;
  }
}

/** @returns {Promise<{autoDisabled: boolean, reason: string|null, since: string|null}>} */
async function readRulesetState() {
  try {
    const stored = await api.storage.local.get(RULESET_STATE_KEY);
    const entry = stored?.[RULESET_STATE_KEY];
    if (entry && typeof entry === "object") {
      return {
        autoDisabled: entry.autoDisabled === true,
        reason: typeof entry.reason === "string" ? entry.reason : null,
        since: typeof entry.since === "string" ? entry.since : null,
      };
    }
  } catch (err) {
    console.warn(`${LOG_PREFIX} ruleset state read failed:`, err);
  }
  return { autoDisabled: false, reason: null, since: null };
}

/**
 * @param {{autoDisabled: boolean, reason: string|null, since: string|null}} state
 * @returns {Promise<boolean>}
 */
async function writeRulesetState(state) {
  try {
    await api.storage.local.set({ [RULESET_STATE_KEY]: state });
    return true;
  } catch (err) {
    console.warn(`${LOG_PREFIX} ruleset state write failed:`, err);
    return false;
  }
}

/** @returns {Promise<string[] | null>} null when the API is unavailable or threw. */
async function getEnabledRulesetIds() {
  const dnr = api?.declarativeNetRequest;
  if (typeof dnr?.getEnabledRulesets !== "function") return null;
  try {
    const ids = await dnr.getEnabledRulesets();
    return Array.isArray(ids) ? ids : null;
  } catch (err) {
    console.warn(`${LOG_PREFIX} getEnabledRulesets failed:`, err);
    return null;
  }
}

/**
 * Put the static ruleset where settings + health say it belongs.
 *
 * Chrome resets the enabled-ruleset set to the manifest default on every
 * extension update, and the set is not otherwise readable from the manifest, so
 * this has to run on install, on startup, and on every settings write rather
 * than being assumed to have stuck.
 *
 * @param {object} settings
 * @param {{autoDisabled: boolean}} rulesetState
 * @returns {Promise<{wanted: boolean, before: string[]|null, after: string[]|null,
 *                    changed: boolean, error: string|null}>}
 */
async function applyRulesetState(settings, rulesetState) {
  const wanted = wantRulesetEnabled(settings, rulesetState);
  const before = await getEnabledRulesetIds();
  const result = { wanted, before, after: before, changed: false, error: null };

  const dnr = api?.declarativeNetRequest;
  if (typeof dnr?.updateEnabledRulesets !== "function") {
    result.error = "updateEnabledRulesets unavailable";
    return result;
  }

  // `null` (unreadable) is not equal to either boolean, so an unreadable current
  // state falls through to attempting the update rather than assuming it is
  // already right.
  const isOn = Array.isArray(before) ? before.includes(RULESET_ID) : null;
  if (isOn === wanted) return result;

  try {
    await dnr.updateEnabledRulesets(
      wanted ? { enableRulesetIds: [RULESET_ID] } : { disableRulesetIds: [RULESET_ID] },
    );
    result.changed = true;
  } catch (err) {
    result.error = String(err?.message ?? err);
    console.warn(`${LOG_PREFIX} updateEnabledRulesets failed:`, err);
  }
  result.after = await getEnabledRulesetIds();
  console.log(
    `${LOG_PREFIX} ruleset wanted=${wanted} before=${JSON.stringify(before)}` +
      ` after=${JSON.stringify(result.after)} changed=${result.changed}` +
      (result.error ? ` error="${result.error}"` : ""),
  );
  return result;
}

/** Read both halves of the desired state and apply it. Used on install/startup. */
async function applyRulesetFromStorage() {
  const settings = await readSettings();
  const rulesetState = await readRulesetState();
  return applyRulesetState(settings, rulesetState);
}

/**
 * Handle `{type:"setSettings", patch}`.
 *
 * The ruleset is moved BEFORE the write, and the write is skipped if the move
 * failed. That ordering is the whole point of routing settings through the
 * background at all: the switch on screen and the rules in the engine have to
 * change together, and a half-applied change is reported as a failure rather
 * than stored.
 *
 * @param {any} patch
 * @returns {Promise<{ok: boolean, settings?: object, error?: string, warning?: string}>}
 */
async function handleSetSettings(patch) {
  if (!patch || typeof patch !== "object") {
    return { ok: false, error: "patch must be an object" };
  }
  const current = await readSettings();
  const next = { ...current };
  let touched = 0;
  for (const key of SETTINGS_KEYS) {
    if (typeof patch[key] === "boolean") {
      next[key] = patch[key];
      touched++;
    }
  }
  if (touched === 0) return { ok: false, error: "patch contained no known boolean setting" };

  const rulesetState = await readRulesetState();
  const applied = await applyRulesetState(next, rulesetState);

  const settled = Array.isArray(applied.after) ? applied.after.includes(RULESET_ID) : null;
  if (settled !== null && settled !== applied.wanted) {
    console.warn(`${LOG_PREFIX} setSettings refused: ruleset did not reach ${applied.wanted}`);
    return {
      ok: false,
      error: applied.error ?? "the redirect ruleset did not reach the requested state",
      settings: current,
    };
  }

  if (!(await writeSettings(next))) {
    // Storage refused after the engine already moved. Put the engine back, so
    // the two cannot disagree, and tell the caller it did not stick.
    await applyRulesetState(current, rulesetState);
    return { ok: false, error: "settings could not be written to storage", settings: current };
  }

  console.log(
    `${LOG_PREFIX} settings ${JSON.stringify(next)} ruleset=${applied.wanted}` +
      ` autoDisabled=${rulesetState.autoDisabled}`,
  );
  const response = { ok: true, settings: next };
  // The setting IS stored and the UI should show it; the caveat is that this
  // browser cannot arm or disarm the ruleset at all.
  if (settled === null && applied.error) response.warning = applied.error;
  return response;
}

/* -------------------------------------------------------------------------- */
/* rule-matching oracles                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Read the ruleset we actually shipped. Reading the packaged file rather than a
 * copy in this script is what makes the self-check honest about drift.
 * @returns {Promise<Array<object>>}
 */
async function loadShippedRules() {
  const response = await fetch(api.runtime.getURL(RULESET_PATH));
  if (!response.ok) throw new Error(`ruleset fetch HTTP ${response.status}`);
  const rules = await response.json();
  if (!Array.isArray(rules)) throw new Error("ruleset is not an array");
  return rules;
}

/**
 * testMatchOutcome for one URL, normalised.
 *
 * This is the strong oracle — it asks the engine what it would actually do —
 * and it is NOT available in most shipped builds:
 *
 *   - Chrome restricts it to unpacked extensions: "Only available for unpacked
 *     extensions as this is only intended to be used during extension
 *     development." A Chrome Web Store build therefore does not have it either,
 *     which is why blaming Firefox alone here used to let a store build ship
 *     with no rule check at all.
 *   - Firefox gates it behind the declarativeNetRequestFeedback permission AND
 *     the extensions.dnr.feedback pref, so on a released Firefox build the
 *     function is simply absent.
 *
 * Absence degrades to "unavailable" with a reason — never a thrown error and
 * never a false "healthy". mirrorCompiles() is the substitute that does work in
 * a packed build.
 *
 * @param {string} url
 * @param {string} type
 * @returns {Promise<{available: boolean, ruleIds: number[], error: string | null}>}
 */
async function testMatch(url, type) {
  const dnr = api?.declarativeNetRequest;
  if (!dnr || typeof dnr.testMatchOutcome !== "function") {
    return { available: false, ruleIds: [], error: "testMatchOutcome unavailable" };
  }
  try {
    const outcome = await dnr.testMatchOutcome({
      url,
      type,
      initiator: SELF_CHECK_INITIATOR,
      method: "get",
    });
    const ruleIds = (outcome?.matchedRules ?? []).map((m) => m.ruleId);
    return { available: true, ruleIds, error: null };
  } catch (err) {
    return { available: false, ruleIds: [], error: String(err?.message ?? err) };
  }
}

/**
 * An inert dynamic clone of a static rule.
 *
 * Same regexFilter — which is the thing being measured — but scoped to a
 * `.invalid` request domain that no real request can ever have, so the clone
 * cannot redirect anything during the few milliseconds it exists. Every shipped
 * regexFilter pins a real host, so the two conditions are mutually
 * unsatisfiable by construction.
 *
 * @param {object} rule
 * @param {number} id
 * @returns {object}
 */
function inertMirrorRule(rule, id) {
  return {
    id,
    priority: 1,
    action: {
      type: "redirect",
      redirect: { regexSubstitution: rule?.action?.redirect?.regexSubstitution ?? "\\0" },
    },
    condition: {
      regexFilter: rule?.condition?.regexFilter,
      resourceTypes: rule?.condition?.resourceTypes ?? ["xmlhttprequest"],
      requestDomains: [MIRROR_INERT_DOMAIN],
    },
  };
}

/** Remove every id this oracle could have left behind, including from a crash. */
async function purgeMirrorRules(ids) {
  const dnr = api?.declarativeNetRequest;
  if (typeof dnr?.updateDynamicRules !== "function") return;
  try {
    await dnr.updateDynamicRules({ removeRuleIds: ids });
  } catch (err) {
    console.warn(`${LOG_PREFIX} mirror purge failed:`, err);
  }
}

/**
 * THE PACKED-BUILD ORACLE.
 *
 * testMatchOutcome does not exist in a Chrome Web Store build, so without this
 * a store build would ship with no rule check at all — the 2 KB compile trap
 * would be undetectable in exactly the builds users install.
 *
 * updateDynamicRules is the one path where Chrome reports that rejection OUT
 * LOUD instead of silently skipping the rule (test/checks/dnr-2kb.mjs ARM 0
 * proves this: the known-bad filter comes back with a memory-limit error while
 * the shipped shape is accepted and comes back from getDynamicRules). So each
 * static rule is mirrored through it, confirmed present, and removed.
 *
 * What this proves and what it does not:
 *   proves      the engine will compile this exact regexFilter, i.e. the rule is
 *               not being silently dropped for exceeding the budget
 *   proves      (with applyRuleOffline) that the substitution lands where we
 *               expect and cannot re-match — RE2 here is a subset of JS regex
 *   does NOT    prove the engine matched this URL; only testMatchOutcome can
 *
 * @param {object} rule
 * @returns {Promise<{compiled: true|false|null, error: string|null}>}
 */
async function mirrorCompiles(rule) {
  const dnr = api?.declarativeNetRequest;
  if (typeof dnr?.updateDynamicRules !== "function") {
    return { compiled: null, error: "updateDynamicRules unavailable" };
  }
  const id = MIRROR_ID_BASE + Number(rule.id);
  try {
    await dnr.updateDynamicRules({
      removeRuleIds: [id],
      addRules: [inertMirrorRule(rule, id)],
    });
  } catch (err) {
    const message = String(err?.message ?? err);
    // Only a rejection that is about the regex itself counts as a rule failure.
    // Anything else (quota, an unsupported condition key on this engine) says
    // the oracle is unusable, not that the rule is broken — and a wrong
    // "broken" here would take dark mode off a working install.
    return { compiled: MIRROR_COMPILE_ERROR.test(message) ? false : null, error: message };
  }

  let present = false;
  let error = null;
  try {
    const dynamic = await dnr.getDynamicRules();
    present = Array.isArray(dynamic) && dynamic.some((r) => r.id === id);
    if (!present) error = "accepted by updateDynamicRules but absent from getDynamicRules";
  } catch (err) {
    error = String(err?.message ?? err);
    await purgeMirrorRules([id]);
    return { compiled: null, error };
  }
  await purgeMirrorRules([id]);
  return { compiled: present, error };
}

/**
 * The oracle's own mutation control: if a filter that could not possibly blow
 * any budget is also rejected, the API path is unusable and NOTHING measured
 * through it may be reported as a failure.
 *
 * @returns {Promise<{usable: boolean, note: string}>}
 */
async function mirrorOracleUsable() {
  const control = await mirrorCompiles({
    id: MIRROR_CONTROL_ID - MIRROR_ID_BASE,
    action: { redirect: { regexSubstitution: "https://control.invalid/ok" } },
    condition: { regexFilter: MIRROR_CONTROL_FILTER, resourceTypes: ["xmlhttprequest"] },
  });
  if (control.compiled === true) return { usable: true, note: "dynamic-rule mirror control passed" };
  return {
    usable: false,
    note: `dynamic-rule mirror unusable: control rule rejected (${control.error ?? "no reason given"})`,
  };
}

/**
 * Pick the strongest oracle available for this run.
 *
 * testMatchOutcome is only meaningful while the static ruleset is actually
 * armed: with the ruleset disabled — by the user, or by our own remediation —
 * it correctly reports "no rule matched", which is not a fault and must not be
 * read as one. The mirror oracle does not depend on the ruleset being enabled
 * at all, which is also what lets an auto-disabled ruleset ever be re-armed.
 *
 * @param {boolean|null} rulesetEnabled
 * @returns {Promise<{kind: "testMatchOutcome"|"dynamic-mirror"|"none", note: string|null}>}
 */
async function selectRuleOracle(rulesetEnabled) {
  const dnr = api?.declarativeNetRequest;
  if (rulesetEnabled === true && typeof dnr?.testMatchOutcome === "function") {
    return { kind: "testMatchOutcome", note: null };
  }
  const mirror = await mirrorOracleUsable();
  const why =
    rulesetEnabled === true
      ? "testMatchOutcome unavailable (packed build)"
      : "static ruleset is not enabled, so testMatchOutcome would report no match";
  if (mirror.usable) return { kind: "dynamic-mirror", note: `${why}; ${mirror.note}` };
  return { kind: "none", note: `${why}; ${mirror.note}` };
}

/* -------------------------------------------------------------------------- */
/* checks                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Per-rule self-check. For every sample of every rule in the shipped ruleset:
 *   - offline: does its own regex match the sample URL, and is the result the
 *     URL we expect, and does that result fail to match again (loop-freedom)?
 *   - live:    whichever oracle selectRuleOracle() could offer.
 *
 * `matched` is tri-state: true / false / "unknown". Only false is a failure —
 * "unknown" means no oracle would tell us, and now produces an `unverified`
 * verdict rather than falling through to healthy.
 *
 * @param {boolean|null} rulesetEnabled
 * @returns {Promise<{status: "ok"|"failed"|"unknown", oracle: string, checks: object[]}>}
 */
async function runRuleSelfCheck(rulesetEnabled) {
  /** @type {object[]} */
  const checks = [];

  /** @type {Array<object>} */
  let rules;
  try {
    rules = await loadShippedRules();
  } catch (err) {
    const check = {
      ruleId: null,
      name: "ruleset",
      matched: false,
      note: `could not read ${RULESET_PATH}: ${String(err?.message ?? err)}`,
    };
    console.log(`${LOG_PREFIX} rulecheck rule=? name=ruleset matched=false note=${check.note}`);
    return { status: "failed", oracle: "none", checks: [check] };
  }

  const shippedIds = rules.map((r) => r.id);
  const sampleIds = Object.keys(RULE_SAMPLES).map(Number);

  // A sample with no rule behind it means the ruleset lost a rule.
  for (const id of sampleIds) {
    if (!shippedIds.includes(id)) {
      for (const sample of RULE_SAMPLES[id]) {
        checks.push({
          ruleId: id,
          name: sample.name,
          matched: false,
          note: "rule id present in self-check table but absent from the shipped ruleset",
        });
      }
    }
  }

  const oracle = await selectRuleOracle(rulesetEnabled);
  // Clear anything a previous run left behind before measuring through it.
  if (oracle.kind === "dynamic-mirror") {
    await purgeMirrorRules([MIRROR_CONTROL_ID, ...shippedIds.map((id) => MIRROR_ID_BASE + Number(id))]);
  }

  for (const rule of rules) {
    const samples = RULE_SAMPLES[rule.id];

    // A rule with no sample behind it means the self-check lost coverage.
    if (!samples || samples.length === 0) {
      checks.push({
        ruleId: rule.id,
        name: "unknown",
        matched: false,
        note: "rule shipped with no self-check sample URL — coverage gap",
      });
      continue;
    }

    // The mirror oracle answers per RULE, not per sample: one add/get/remove
    // round trip is enough to know whether the engine compiled this regex.
    const mirror = oracle.kind === "dynamic-mirror" ? await mirrorCompiles(rule) : null;

    for (const sample of samples) {
      const offline = applyRuleOffline(rule, sample.url);
      const rewritten = offline.result;
      const rewriteOk = offline.matched && rewritten === sample.expect;
      const loopFreeOffline = rewritten === null ? null : !applyRuleOffline(rule, rewritten).matched;

      /** @type {true | false | "unknown"} */
      let matched = "unknown";
      let note = "";
      let loopFreeLive = null;
      let liveMatchedRuleIds = [];

      if (oracle.kind === "testMatchOutcome") {
        const live = await testMatch(sample.url, sample.type);
        const liveLoop =
          rewritten === null
            ? { available: false, ruleIds: [], error: "no rewrite" }
            : await testMatch(rewritten, sample.type);
        liveMatchedRuleIds = live.ruleIds;

        if (!live.available) {
          matched = "unknown";
          note = live.error ?? "testMatchOutcome unavailable";
        } else if (live.ruleIds.includes(rule.id)) {
          matched = true;
        } else {
          matched = false;
          note =
            live.ruleIds.length === 0
              ? "no rule matched — regexFilter probably exceeded the 2KB compile limit and was skipped"
              : `matched other rule ids: ${live.ruleIds.join(",")}`;
        }

        // Loop-freedom failing live is a redirect loop, which is worse than not
        // matching at all: fold it into the same hard-failure signal.
        if (liveLoop.available) {
          loopFreeLive = !liveLoop.ruleIds.includes(rule.id);
          if (!loopFreeLive) {
            matched = false;
            note = `REDIRECT LOOP: rule re-matches its own output (${rewritten})`;
          }
        }
      } else if (oracle.kind === "dynamic-mirror") {
        if (mirror.compiled === true) {
          matched = true;
          note = "verified by dynamic-rule mirror (compile only; the engine was not asked to match)";
        } else if (mirror.compiled === false) {
          matched = false;
          note = `the engine refused this regexFilter: ${mirror.error ?? "no reason given"}`;
        } else {
          matched = "unknown";
          note = `dynamic-rule mirror inconclusive: ${mirror.error ?? "no reason given"}`;
        }
      } else {
        matched = "unknown";
        note = oracle.note ?? "no rule-matching oracle available";
      }

      if (matched !== false && !rewriteOk) {
        matched = false;
        note = `substitution produced ${rewritten} but expected ${sample.expect}`;
      }
      if (matched !== false && loopFreeOffline === false) {
        matched = false;
        note = "offline loop check: rewritten URL re-matches the same regex";
      }

      checks.push({
        ruleId: rule.id,
        name: sample.name,
        matched,
        oracle: oracle.kind,
        regexFilter: rule.condition?.regexFilter ?? null,
        sampleUrl: sample.url,
        rewrittenUrl: rewritten,
        rewriteOk,
        loopFreeOffline,
        loopFreeLive,
        liveMatchedRuleIds,
        note,
      });
    }
  }

  for (const c of checks) {
    console.log(
      `${LOG_PREFIX} rulecheck rule=${c.ruleId} name=${c.name} matched=${c.matched}` +
        ` oracle=${c.oracle ?? "none"} rewrite=${c.rewriteOk ? "ok" : "BAD"}` +
        ` loopfree=${c.loopFreeOffline}/${c.loopFreeLive}` +
        (c.note ? ` note="${c.note}"` : ""),
    );
  }

  const anyFailed = checks.some((c) => c.matched === false);
  const anyUnknown = checks.some((c) => c.matched === "unknown");
  const status = anyFailed ? "failed" : anyUnknown ? "unknown" : "ok";
  console.log(
    `${LOG_PREFIX} rulecheck summary status=${status} oracle=${oracle.kind} rules=${checks.length}` +
      ` ok=${checks.filter((c) => c.matched === true).length}` +
      ` failed=${checks.filter((c) => c.matched === false).length}` +
      ` unknown=${checks.filter((c) => c.matched === "unknown").length}`,
  );
  return { status, oracle: oracle.kind, oracleNote: oracle.note, checks };
}

/**
 * @param {string} url
 * @returns {Promise<{status: number | null, error: string | null}>}
 */
async function headStatus(url) {
  try {
    const response = await fetch(url, {
      method: "HEAD",
      cache: "no-store",
      credentials: "omit",
      redirect: "follow",
    });
    return { status: response.status, error: null };
  } catch (err) {
    return { status: null, error: String(err?.message ?? err) };
  }
}

/**
 * Is the CompactLegend dark palette still being served?
 *
 * Both probe URLs are HEADs, so this costs no payload despite the assets being
 * ~0.5 MB compressed. Classification per version:
 *
 *   canary 200, dark 200  -> healthy
 *   canary 200, dark 404  -> token-dead   (the version lives; the style is gone)
 *   canary 404            -> version-stale, try the next pinned version
 *   transport error       -> unknown
 *
 * Splitting those two 404 cases is the whole point. A pinned version hash is
 * guaranteed to be garbage-collected eventually, and treating that as
 * "RoadmapDark is dead" would disable a perfectly working extension.
 *
 * @returns {Promise<object>}
 */
async function runLegendProbe() {
  const stored = await readStoredVersion();
  /** @type {Array<{version: string, source: string}>} */
  const candidates = [];
  if (stored) candidates.push({ version: stored.version, source: stored.source });
  for (const v of PINNED_LEGEND_VERSIONS) {
    if (!candidates.some((c) => c.version === v)) candidates.push({ version: v, source: "pinned" });
  }

  const attempts = [];
  for (const candidate of candidates) {
    const canary = await headStatus(legendUrl(LEGEND_CANARY_STYLE, candidate.version));
    const dark = await headStatus(legendUrl(LEGEND_TARGET_STYLE, candidate.version));

    let status;
    if (canary.status === null || dark.status === null) status = "unknown";
    else if (canary.status !== 200) status = "version-stale";
    else if (dark.status === 200) status = "healthy";
    else status = "token-dead";

    attempts.push({
      version: candidate.version,
      versionSource: candidate.source,
      canaryStyle: LEGEND_CANARY_STYLE,
      canaryStatus: canary.status,
      darkStyle: LEGEND_TARGET_STYLE,
      darkStatus: dark.status,
      error: canary.error ?? dark.error,
      status,
    });

    // A conclusive answer ends the walk; only a stale version is worth retrying
    // against an older pin.
    if (status !== "version-stale") break;
  }

  const last = attempts[attempts.length - 1] ?? {
    version: null,
    versionSource: "none",
    canaryStatus: null,
    darkStatus: null,
    status: "unknown",
    error: "no candidate versions",
  };
  const result = { ...last, attempts };

  console.log(
    `${LOG_PREFIX} legendProbe status=${result.status} version=${result.version}` +
      ` source=${result.versionSource} canary=${result.canaryStatus} dark=${result.darkStatus}` +
      (result.error ? ` error="${result.error}"` : ""),
  );
  return result;
}

/**
 * Is the raster `set:` token still being served?
 *
 * Kept from the M0 spike because the raster endpoint has no 404: an unknown
 * style name comes back HTTP 200 carrying a 178-byte solid-yellow error tile,
 * so size is the only signal available here.
 *
 * @returns {Promise<object>}
 */
async function runRasterProbe() {
  let httpStatus = null;
  let bytes = 0;
  let status = "unknown";
  let error = null;

  try {
    const response = await fetch(RASTER_PROBE_URL, {
      cache: "no-store",
      credentials: "omit",
      redirect: "follow",
    });
    httpStatus = response.status;
    bytes = (await response.arrayBuffer()).byteLength;
    if (httpStatus === 200) status = classifyRasterBytes(bytes);
  } catch (err) {
    error = String(err?.message ?? err);
  }

  const result = { url: RASTER_PROBE_URL, httpStatus, bytes, status, error };
  console.log(
    `${LOG_PREFIX} rasterProbe status=${status} http=${httpStatus} bytes=${bytes}` +
      (error ? ` error="${error}"` : ""),
  );
  return result;
}

/* -------------------------------------------------------------------------- */
/* storage, badge, remediation, orchestration                                 */
/* -------------------------------------------------------------------------- */

/** @returns {Promise<{version: string, source: string} | null>} */
async function readStoredVersion() {
  try {
    const stored = await api.storage.local.get(VERSION_KEY);
    const entry = stored?.[VERSION_KEY];
    if (entry && typeof entry.version === "string" && /^[0-9a-f]{32}$/.test(entry.version)) {
      return { version: entry.version, source: entry.source ?? "reported" };
    }
  } catch (err) {
    console.warn(`${LOG_PREFIX} version read failed:`, err);
  }
  return null;
}

/**
 * Runtime version discovery.
 *
 * The legend version hash cannot be derived from anything the background script
 * can reach on its own: it appears in no Maps HTML response (measured — zero
 * 32-hex tokens in a 194 KB /maps document) and reading it off live traffic
 * would need either declarativeNetRequestFeedback (unpacked-only in Chrome) or
 * the webRequest permission. So the channel is a message: any component that
 * does see a CompactLegend URL can report the version here and the probe will
 * prefer it over the pinned list from then on.
 *
 * NOTE: nothing in the shipped extension currently sends this message. Today
 * the probe always falls back to PINNED_LEGEND_VERSIONS. The hook exists so the
 * pins are not the only path, and it is exercised by the test harness.
 *
 * @param {string} version
 * @param {string} source
 * @returns {Promise<boolean>}
 */
async function recordLegendVersion(version, source) {
  if (typeof version !== "string" || !/^[0-9a-f]{32}$/.test(version)) {
    console.log(`${LOG_PREFIX} legendVersion rejected value=${version}`);
    return false;
  }
  try {
    await api.storage.local.set({
      [VERSION_KEY]: { version, source: source ?? "reported", seenAt: new Date().toISOString() },
    });
    console.log(`${LOG_PREFIX} legendVersion recorded version=${version} source=${source}`);
    return true;
  } catch (err) {
    console.warn(`${LOG_PREFIX} version write failed:`, err);
    return false;
  }
}

/**
 * Badge state. Guarded on every hop: `action` is absent in some contexts (and
 * is `browserAction` on older Gecko), and the setters must never be allowed to
 * break a check run. The title is derived from the manifest so it cannot drift
 * from `action.default_title`.
 * @param {string} verdict
 */
async function setBadge(verdict) {
  const action = api?.action ?? api?.browserAction;
  if (!action) return;
  const name = extensionName();
  const bad = isFailure(verdict);
  try {
    if (typeof action.setBadgeText === "function") {
      await action.setBadgeText({ text: bad ? "!" : "" });
    }
    if (bad && typeof action.setBadgeBackgroundColor === "function") {
      await action.setBadgeBackgroundColor({ color: "#D32F2F" });
    }
    if (typeof action.setTitle === "function") {
      await action.setTitle({ title: bad ? `${name} — ${verdict}` : name });
    }
  } catch (err) {
    console.warn(`${LOG_PREFIX} badge update failed:`, err);
  }
}

/** @returns {Promise<object|null>} */
async function readRecord() {
  try {
    const stored = await api.storage.local.get(STORAGE_KEY);
    if (stored && stored[STORAGE_KEY]) return stored[STORAGE_KEY];
  } catch (err) {
    console.warn(`${LOG_PREFIX} storage read failed:`, err);
  }
  return lastRecord;
}

/**
 * ACT on the verdict.
 *
 * The plan's hard requirement is "never let a user see a yellow error tile", and
 * a verdict that is only written to storage cannot honour it: with the ruleset
 * still armed, `token-dead` means every palette fetch Maps makes is redirected
 * to a 404 for as long as the fault lasts, and the measurement at the top of
 * this file says that leaves Maps with 6 controls instead of 46. So the ruleset
 * comes off the air in the same run that detects the fault, and the reason is
 * persisted — otherwise the next browser start, or the next extension update
 * (which resets the enabled-ruleset set to the manifest default), would re-arm a
 * ruleset already known to be broken.
 *
 * The auto-disable flag is a SEPARATE key from the user's settings, and
 * wantRulesetEnabled() ANDs them. Clearing the auto-disable therefore cannot
 * turn dark mode back on for someone who switched it off themselves.
 *
 * @param {string} verdict
 * @param {{status: string}} rules
 * @param {{status: string}} legend
 * @param {{autoDisabled: boolean, reason: string|null, since: string|null}} rulesetState
 * @returns {Promise<object>}
 */
async function remediate(verdict, rules, legend, rulesetState) {
  let state = rulesetState;
  let action = "none";

  if (AUTO_DISABLE_VERDICTS.includes(verdict)) {
    if (!state.autoDisabled || state.reason !== verdict) {
      state = { autoDisabled: true, reason: verdict, since: new Date().toISOString() };
      await writeRulesetState(state);
      action = "auto-disabled";
    } else {
      action = "still-auto-disabled";
    }
  } else if (state.autoDisabled && causeCleared(state.reason, rules.status, legend.status, verdict)) {
    state = { autoDisabled: false, reason: null, since: new Date().toISOString() };
    await writeRulesetState(state);
    action = "auto-re-enabled";
  } else if (state.autoDisabled) {
    action = "still-auto-disabled";
  }

  // Settings are re-read HERE rather than reused from the start of the run: a
  // probe takes hundreds of milliseconds of network time, and a user who moves
  // a switch during it must not have that switch undone by a stale snapshot.
  const settings = await readSettings();
  const applied = await applyRulesetState(settings, state);
  const result = {
    action,
    autoDisabled: state.autoDisabled,
    reason: state.reason,
    since: state.since,
    settings,
    userWantsRuleset: Boolean(settings.enabled && settings.darkMap),
    rulesetWanted: applied.wanted,
    rulesetsBefore: applied.before,
    rulesetsAfter: applied.after,
    rulesetChanged: applied.changed,
    error: applied.error,
  };
  console.log(
    `${LOG_PREFIX} remediation action=${result.action} verdict=${verdict}` +
      ` autoDisabled=${result.autoDisabled} reason=${result.reason}` +
      ` userWants=${result.userWantsRuleset} rulesets=${JSON.stringify(result.rulesetsAfter)}`,
  );
  return result;
}

/**
 * Run every check, act on the result, and store one combined record.
 * Never rejects: every failure path is caught and recorded.
 * @returns {Promise<object>}
 */
function runAllChecks() {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    const rulesetState = await readRulesetState();
    const enabledRulesets = await getEnabledRulesetIds();
    const rulesetEnabled = Array.isArray(enabledRulesets)
      ? enabledRulesets.includes(RULESET_ID)
      : null;

    const rules = await runRuleSelfCheck(rulesetEnabled);
    const legend = await runLegendProbe();
    const raster = await runRasterProbe();

    const verdict = combineVerdict(rules.status, legend.status, raster.status);
    const remediation = await remediate(verdict, rules, legend, rulesetState);

    const record = {
      schema: 3,
      checkedAt: new Date().toISOString(),
      verdict,
      // getEnabledRulesets as observed BEFORE remediation, and deliberately NOT
      // an input to the verdict: it stays green when a rule is dropped for
      // exceeding the 2 KB compile limit, which is the failure we care about.
      enabledRulesets,
      settings: remediation.settings,
      remediation,
      rules,
      legend,
      raster,
    };

    lastRecord = record;
    try {
      await api.storage.local.set({ [STORAGE_KEY]: record });
    } catch (err) {
      console.warn(`${LOG_PREFIX} storage write failed:`, err);
    }
    await setBadge(verdict);

    console.log(
      `${LOG_PREFIX} verdict ${verdict} rules=${rules.status} legend=${legend.status}` +
        ` raster=${raster.status} rulesets=${JSON.stringify(enabledRulesets)}` +
        ` remediation=${remediation.action}`,
    );
    return record;
  })();

  return inFlight.finally(() => {
    inFlight = null;
  });
}

/**
 * Create the periodic re-check alarm if it is not already there.
 *
 * `alarms.create` with an existing name RESETS the schedule, so a service worker
 * that wakes often would starve a periodic alarm that it re-created on every
 * wake. Hence get-then-create rather than unconditional create.
 */
async function ensureHealthAlarm() {
  const alarms = api?.alarms;
  if (!alarms || typeof alarms.create !== "function") return false;
  try {
    if (typeof alarms.get === "function") {
      const existing = await alarms.get(HEALTH_ALARM);
      if (existing) return false;
    }
    await alarms.create(HEALTH_ALARM, {
      periodInMinutes: HEALTH_ALARM_PERIOD_MINUTES,
      delayInMinutes: HEALTH_ALARM_PERIOD_MINUTES,
    });
    console.log(`${LOG_PREFIX} health alarm created period=${HEALTH_ALARM_PERIOD_MINUTES}min`);
    return true;
  } catch (err) {
    console.warn(`${LOG_PREFIX} alarm create failed:`, err);
    return false;
  }
}

/* -------------------------------------------------------------------------- */
/* listeners — registered synchronously at top level                          */
/* -------------------------------------------------------------------------- */

/**
 * Install/startup: put the ruleset where settings and the persisted auto-disable
 * flag say it belongs BEFORE probing, so the probe sees the state it is meant to
 * be judging. Chrome resets the enabled-ruleset set to the manifest default on
 * every extension update, which is precisely when a known-broken ruleset would
 * otherwise silently re-arm itself.
 *
 * Both listeners return the promise rather than firing and forgetting.
 * runAllChecks never rejects, so this cannot produce an unhandled rejection;
 * returning it makes the async work explicitly owned and lets a test harness
 * await a run to completion.
 */
function bootstrap() {
  return applyRulesetFromStorage()
    .catch((err) => console.warn(`${LOG_PREFIX} ruleset apply failed:`, err))
    .then(() => ensureHealthAlarm())
    .then(() => runAllChecks());
}

api.runtime.onInstalled.addListener(() => bootstrap());
api.runtime.onStartup.addListener(() => bootstrap());

if (api?.alarms?.onAlarm?.addListener) {
  api.alarms.onAlarm.addListener((alarm) => {
    if (alarm?.name !== HEALTH_ALARM) return;
    console.log(`${LOG_PREFIX} health alarm fired`);
    return runAllChecks();
  });
}

api.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const type = message?.type;

  if (type === "getSettings") {
    readSettings().then(
      (settings) => sendResponse(settings),
      () => sendResponse({ ...DEFAULT_SETTINGS }),
    );
    return true;
  }

  if (type === "setSettings") {
    handleSetSettings(message?.patch).then(
      (result) => sendResponse(result),
      (err) => sendResponse({ ok: false, error: String(err?.message ?? err) }),
    );
    return true;
  }

  if (type === "getHealth") {
    (async () => {
      const record = await readRecord();
      const age = record?.checkedAt ? Date.now() - Date.parse(record.checkedAt) : Infinity;
      if (record && Number.isFinite(age) && age < MAX_RECORD_AGE_MS) return record;
      return runAllChecks();
    })().then(
      (record) => sendResponse(record ?? null),
      (err) => sendResponse({ verdict: "unknown", error: String(err?.message ?? err) }),
    );
    return true; // keep the channel open for the async read
  }

  if (type === "runHealthCheck") {
    runAllChecks().then(
      (record) => sendResponse(record),
      (err) => sendResponse({ verdict: "unknown", error: String(err?.message ?? err) }),
    );
    return true;
  }

  if (type === "reportLegendVersion") {
    recordLegendVersion(message.version, message.source ?? "reported").then(
      (ok) => sendResponse({ ok }),
      () => sendResponse({ ok: false }),
    );
    return true;
  }

  return false;
});

// An MV3 service worker is torn down when idle and the alarm is what wakes it
// again, so a lost alarm is unrecoverable from inside the worker: repair it on
// every wake. Cheap, idempotent, and does not reset an alarm that already
// exists. Not a top-level await — the promise is started and left to settle.
ensureHealthAlarm().catch(() => {});
