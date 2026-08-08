/**
 * Chromium profile hygiene for extension runs.
 *
 * ---------------------------------------------------------------------------
 * THE HAZARD THIS EXISTS FOR -- it has already cost two verification attempts
 * ---------------------------------------------------------------------------
 * Chrome caches the compiled service-worker script for an UNPACKED extension
 * inside the user profile, at `<profile>/Default/Service Worker/`. That cache
 * survives:
 *
 *   - a browser restart on the same profile, and
 *   - a manifest `version` bump.
 *
 * So a relaunched profile can execute the PREVIOUS `background.js` while
 * `chrome.runtime.getManifest().version` and `chrome://extensions` both report
 * the new one. Every symptom points at the new code; the code running is the
 * old code. There is no error, no warning, and no way to tell from inside the
 * worker.
 *
 * The defence is to delete that directory before the profile is handed to
 * Chromium. Every launch in this repo currently uses a fresh `mkdtemp` profile,
 * where the purge is a no-op -- which is exactly why the hazard is easy to
 * reintroduce: the day someone reuses a profile to save eight seconds of
 * startup, nothing tells them. `freshChromiumProfile()` and `purgeServiceWorkerCache()`
 * are therefore called on EVERY launch path, no-op or not, so the guarantee is
 * structural rather than incidental.
 *
 * `Code Cache/` gets the same treatment: it caches compiled scripts for
 * extension pages (popup, options) under the same "keyed by URL, not by
 * version" rule.
 */

import fs from 'node:fs';
import path from 'node:path';

/** Profile-relative directories that can serve stale extension code. */
export const STALE_CODE_DIRS = [
  path.join('Default', 'Service Worker'),
  path.join('Default', 'Code Cache'),
  // Chromium sometimes uses the profile root rather than Default/ when launched
  // with a --user-data-dir that is itself the profile.
  'Service Worker',
  'Code Cache',
];

/**
 * Remove every cached-script directory from a Chromium profile.
 *
 * Safe to call on a profile that does not exist yet; returns what it actually
 * removed so a caller can log it rather than assume it.
 *
 * @param {string} profileDir
 * @returns {{profileDir: string, removed: string[], missing: string[]}}
 */
export function purgeServiceWorkerCache(profileDir) {
  const removed = [];
  const missing = [];
  for (const rel of STALE_CODE_DIRS) {
    const abs = path.join(profileDir, rel);
    if (!fs.existsSync(abs)) {
      missing.push(rel);
      continue;
    }
    fs.rmSync(abs, { recursive: true, force: true, maxRetries: 3 });
    removed.push(rel);
  }
  return { profileDir, removed, missing };
}

/**
 * Make a fresh throwaway profile directory under `parentDir` and purge it.
 *
 * The purge is redundant on a directory created microseconds ago. It is done
 * anyway so that the invariant is "no launch path in this repo can serve a
 * stale service worker", which survives someone later swapping the mkdtemp for
 * a fixed path.
 *
 * @param {string} parentDir
 * @param {string} prefix
 * @param {(s: string) => void} [log]
 * @returns {string} absolute profile path
 */
export function freshChromiumProfile(parentDir, prefix, log) {
  fs.mkdirSync(parentDir, { recursive: true });
  const dir = fs.mkdtempSync(path.join(parentDir, prefix));
  const purge = purgeServiceWorkerCache(dir);
  log?.(
    `chromium profile ${dir} (service-worker cache purge: ` +
      `${purge.removed.length ? `removed ${purge.removed.join(', ')}` : 'nothing to remove -- fresh profile'})`
  );
  return dir;
}
