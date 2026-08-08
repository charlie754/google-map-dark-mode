/**
 * Maps Noir — M0 feasibility spike.
 *
 * This file is loaded in two different ways and must be valid in both:
 *   - Chrome MV3: an ES module service worker ("type": "module").
 *   - Firefox MV3: a classic event-page script ("background": { "scripts": [...] }).
 *
 * Therefore: no `import`, no `export`, no top-level `await`. Everything is a
 * plain declaration plus synchronously-registered event listeners, so the
 * listeners exist before the worker/event page can be torn down.
 *
 * The one functional behaviour of the spike (rewriting base-map tile requests
 * to Google's dark cartography) lives entirely in the declarativeNetRequest
 * static ruleset — see rules/dark-tiles.json. This script only probes whether
 * the undocumented `RoadmapDark` style token is still alive and reports it.
 */

const api = globalThis.browser ?? globalThis.chrome;

/** Fixed z13 tile over Houston. Same URL used in the research doc's one-liner. */
const PROBE_URL =
  "https://www.google.com/maps/vt/pb=!1m4!1m3!1i13!2i1925!3i3385!2m3!1e0!2sm!3i789555512!3m8!2sen!3sus!5e1105!12m4!1e68!2m2!1sset!2sRoadmapDark!4e0!5m1!1e0";

/**
 * Real dark tiles measure ~20-30 KB and the payload churns with map data
 * (27,275 bytes in the 2026-08-07 research; 22,765 on re-measure). The
 * threshold is deliberately an order of magnitude below either.
 */
const HEALTHY_MIN_BYTES = 5000;

/** Google's "invalid style" tile is a 178-byte solid-yellow PNG. */
const DEAD_MAX_BYTES = 500;

const STORAGE_KEY = "healthProbe";
const LOG_PREFIX = "[maps-noir]";

/**
 * Last probe result held in memory, so getHealth can still answer if the
 * storage write failed. Lost when the service worker is torn down; storage is
 * the durable copy.
 * @type {{status: string, bytes: number, checkedAt: string} | null}
 */
let lastRecord = null;

/**
 * @param {number} bytes
 * @returns {"healthy" | "token-dead" | "unknown"}
 */
function classifyBytes(bytes) {
  if (bytes >= HEALTHY_MIN_BYTES) return "healthy";
  if (bytes <= DEAD_MAX_BYTES) return "token-dead";
  return "unknown";
}

/**
 * Badge state. Guarded on every hop: `action` is absent in some contexts
 * (and is `browserAction` on older Gecko), and the setters are promise-based
 * in MV3 on both engines but must never be allowed to break the probe.
 * @param {string} status
 */
async function setBadge(status) {
  const action = api?.action ?? api?.browserAction;
  if (!action) return;
  const healthy = status === "healthy";
  try {
    if (typeof action.setBadgeText === "function") {
      await action.setBadgeText({ text: healthy ? "" : "!" });
    }
    if (!healthy && typeof action.setBadgeBackgroundColor === "function") {
      await action.setBadgeBackgroundColor({ color: "#D32F2F" });
    }
  } catch (err) {
    console.warn(`${LOG_PREFIX} badge update failed:`, err);
  }
}

/**
 * @returns {Promise<{status: string, bytes: number, checkedAt: string} | null>}
 */
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
 * Fetch the known-good dark tile and classify the response by size.
 *
 * Note that this fetch needs host access to www.google.com. On engines where
 * host permissions are not granted the request fails outright, which surfaces
 * as status "unknown" with 0 bytes — distinguishable from "token-dead", which
 * requires an actual 200 carrying the ~178-byte yellow error tile.
 *
 * @returns {Promise<{status: string, bytes: number, checkedAt: string}>}
 */
async function runHealthProbe() {
  let status = "unknown";
  let bytes = 0;

  try {
    const response = await fetch(PROBE_URL, {
      cache: "no-store",
      credentials: "omit",
      redirect: "follow",
    });
    const buffer = await response.arrayBuffer();
    bytes = buffer.byteLength;
    if (response.status === 200) {
      status = classifyBytes(bytes);
    } else {
      console.warn(`${LOG_PREFIX} probe HTTP ${response.status}`);
    }
  } catch (err) {
    status = "unknown";
    bytes = 0;
    console.warn(`${LOG_PREFIX} probe request failed:`, err);
  }

  const record = { status, bytes, checkedAt: new Date().toISOString() };
  lastRecord = record;

  try {
    await api.storage.local.set({ [STORAGE_KEY]: record });
  } catch (err) {
    console.warn(`${LOG_PREFIX} storage write failed:`, err);
  }

  await setBadge(status);

  // Single-line, grep-friendly. Emitted last so that its presence implies the
  // storage write and badge update have already been attempted.
  console.log(`${LOG_PREFIX} healthProbe ${status} ${bytes}`);

  return record;
}

// Both listeners return the probe promise rather than firing and forgetting.
// runHealthProbe never rejects (every failure path is caught and recorded), so
// this cannot produce an unhandled rejection; returning it makes the async work
// explicitly owned and lets a test harness await a probe to completion.
api.runtime.onInstalled.addListener(() => runHealthProbe());

api.runtime.onStartup.addListener(() => runHealthProbe());

api.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || message.type !== "getHealth") return false;
  readRecord().then(
    (record) => sendResponse(record ?? null),
    () => sendResponse(null),
  );
  // Keep the message channel open for the async storage read.
  return true;
});
