'use strict';
/**
 * Options page.
 *
 * Same three settings as the popup with room to say what they do, plus the status the popup only
 * hints at, an explanation of the mechanism, and the limitations. Every control writes
 * immediately — there is no Save button.
 *
 * As in the popup, settings are never written to storage from this page: `setSettings` goes to
 * the background so that switching dark mode off also disables the declarativeNetRequest ruleset
 * in the same step. The direct storage read is a read-only fallback for a background that never
 * answers.
 */
(function () {
  /** Mirrors the background's defaults. Dark mode is ON out of the box. */
  const DEFAULTS = Object.freeze({ enabled: true, darkMap: true, darkChrome: true });
  const KEYS = ['enabled', 'darkMap', 'darkChrome'];
  const SUB_KEYS = ['darkMap', 'darkChrome'];

  /**
   * Status copy, one entry per verdict the background can produce.
   *
   * `healthy` is present here, unlike in the popup: someone who opened the settings page asked
   * to know. The popup stays quiet when all is well; this page answers the question either way.
   */
  const STATUS = {
    healthy: {
      level: 'ok',
      verdict: 'Working',
      text:
        'The redirect rules are compiled and matching, and Google is still serving the dark ' +
        'palette this extension asks for.',
    },
    degraded: {
      level: 'warn',
      verdict: 'Working, with a light flash',
      text:
        'The map still goes dark. What has stopped working is the smaller rule that darkens the ' +
        'very first frame of a page load, so for about a second you will see the light map ' +
        'before the dark one arrives.',
    },
    'rules-broken': {
      level: 'alert',
      verdict: 'Not working',
      text:
        'The browser is no longer applying the redirect rules that darken the map, so Maps is ' +
        'showing you its ordinary light one. Nothing on this page will bring it back: an ' +
        'updated version of the extension is needed. This is normally what a change on ' +
        'Google’s side looks like from in here.',
    },
    'token-dead': {
      level: 'alert',
      verdict: 'Not working',
      text:
        'Google has stopped serving the dark palette under the name this extension asks for. ' +
        'The rules are fine; there is simply nothing at the other end of them any more. ' +
        'Nothing on this page will bring it back — an updated version of the extension is ' +
        'needed.',
    },
    unverified: {
      level: 'info',
      verdict: 'Not checked yet',
      text:
        'The extension has not yet confirmed that Google is still serving the dark palette. It ' +
        'is applying its rules as normal in the meantime. Use “Check again” to run the check now.',
    },
    unknown: {
      level: 'info',
      verdict: 'Could not check',
      text:
        'The check could not reach Google — usually just no connection. This says nothing about ' +
        'whether dark mode is working; the extension is applying its rules as normal.',
    },
  };

  const NO_BACKGROUND = {
    level: 'info',
    verdict: 'Could not check',
    text:
      'The extension’s background component did not answer, so its state is unknown. ' +
      'Restarting the browser usually clears this.',
  };

  /** Sub-check wording. Anything not listed is shown verbatim, so an unfamiliar value is
   *  reported rather than swallowed. */
  const RULE_WORDS = {
    ok: 'matching',
    failed: 'not matching',
    unknown: 'cannot be checked in this browser',
  };
  const LEGEND_WORDS = {
    healthy: 'being served',
    'token-dead': 'gone from Google’s servers',
    'version-stale': 'the version checked has been retired',
    unknown: 'could not be reached',
  };
  const RASTER_WORDS = {
    healthy: 'darkened',
    'token-dead': 'no longer darkened (light flash on load)',
    unknown: 'could not be reached',
  };

  const el = function (id) { return document.getElementById(id); };

  const panel = el('panel');
  const errorBox = el('error');
  const statusBox = el('status');
  const detail = el('detail');
  const flash = el('flash');

  let current = Object.assign({}, DEFAULTS);
  let writable = true;
  let flashTimer = null;

  /* ------------------------------------------------------------------ plumbing */

  /**
   * Send a message to the background and get a promise on both engines. Chrome MV3 returns one
   * when no callback is passed; Firefox always does. A missing background surfaces as a
   * rejection or as `undefined`, and both are handled by the callers.
   *
   * @param {object} message
   * @returns {Promise<any>}
   */
  function send(message) {
    try {
      const result = browser.runtime.sendMessage(message);
      return result && typeof result.then === 'function' ? result : Promise.resolve(result);
    } catch (err) {
      return Promise.reject(err);
    }
  }

  function normalise(value) {
    const out = Object.assign({}, DEFAULTS);
    if (value && typeof value === 'object') {
      for (let i = 0; i < KEYS.length; i++) {
        const key = KEYS[i];
        if (typeof value[key] === 'boolean') out[key] = value[key];
      }
    }
    return out;
  }

  /** @param {string} text */
  function flashMessage(text) {
    flash.textContent = text;
    flash.dataset.visible = 'true';
    clearTimeout(flashTimer);
    flashTimer = setTimeout(function () { flash.dataset.visible = 'false'; }, 1800);
  }

  function showError(message) {
    errorBox.textContent = message;
    errorBox.hidden = false;
  }

  function clearError() {
    errorBox.textContent = '';
    errorBox.hidden = true;
  }

  /* -------------------------------------------------------------------- render */

  function render(settings) {
    current = settings;
    for (let i = 0; i < KEYS.length; i++) {
      el(KEYS[i]).checked = settings[KEYS[i]];
    }
    for (let i = 0; i < SUB_KEYS.length; i++) {
      const input = el(SUB_KEYS[i]);
      input.disabled = !settings.enabled;
      el('row-' + SUB_KEYS[i]).dataset.off = String(!settings.enabled);
    }
    if (panel.dataset.ready !== 'true') {
      panel.dataset.ready = 'true';
      // See the same note in popup.js: flush the un-animated state so opening the page does not
      // play the switches sliding from off to on.
      void panel.offsetWidth;
      document.body.dataset.anim = 'on';
    }
  }

  /**
   * @param {object|null|undefined} value
   * @param {object} words
   * @returns {string}
   */
  function describe(value, words) {
    const status = value && typeof value === 'object' ? value.status : value;
    if (typeof status !== 'string' || status === '') return '—';
    return words[status] || status;
  }

  /** @param {any} record */
  function renderStatus(record) {
    let state;
    let verdict = null;

    if (!record || typeof record !== 'object') {
      state = NO_BACKGROUND;
    } else {
      verdict = typeof record.verdict === 'string' ? record.verdict : 'unknown';
      state = STATUS[verdict] || STATUS.unknown;
    }

    el('statusVerdict').textContent = state.verdict;
    el('statusText').textContent = state.text;
    statusBox.dataset.level = state.level;

    if (!record || typeof record !== 'object') {
      detail.hidden = true;
      return;
    }
    el('detailRules').textContent = describe(record.rules, RULE_WORDS);
    el('detailLegend').textContent = describe(record.legend, LEGEND_WORDS);
    el('detailRaster').textContent = describe(record.raster, RASTER_WORDS);
    el('detailCheckedAt').textContent = formatWhen(record.checkedAt);
    detail.hidden = false;
  }

  /** @param {any} iso @returns {string} */
  function formatWhen(iso) {
    if (typeof iso !== 'string' || iso === '') return 'never';
    const when = new Date(iso);
    if (Number.isNaN(when.getTime())) return String(iso);
    return when.toLocaleString();
  }

  /* ---------------------------------------------------------------- load, save */

  async function loadSettings() {
    try {
      const response = await send({ type: 'getSettings' });
      if (response && typeof response === 'object') return normalise(response);
      throw new Error('no response');
    } catch (err) {
      try {
        const stored = await browser.storage.local.get('settings');
        if (stored && stored.settings) {
          writable = false;
          return normalise(stored.settings);
        }
      } catch (storageErr) {
        /* fall through to defaults */
      }
      writable = false;
      return Object.assign({}, DEFAULTS);
    }
  }

  /** @param {boolean} force run a fresh probe rather than accept the stored record */
  async function loadHealth(force) {
    if (force) {
      try {
        const fresh = await send({ type: 'runHealthCheck' });
        if (fresh && typeof fresh === 'object') return renderStatus(fresh);
      } catch (err) {
        /* fall through to the stored record — an older answer beats no answer */
      }
    }
    try {
      const record = await send({ type: 'getHealth' });
      renderStatus(record);
    } catch (err) {
      renderStatus(null);
    }
  }

  /**
   * @param {object} patch
   * @param {string} message
   */
  async function save(patch, message) {
    let response;
    try {
      response = await send({ type: 'setSettings', patch: patch });
    } catch (err) {
      response = null;
    }
    if (!response || response.ok !== true || !response.settings) {
      writable = false;
      showError(
        'That could not be saved — the extension’s background component did not answer. ' +
        'Try reopening the browser.'
      );
      render(current); // put the switch back rather than show a state that was never stored
      return;
    }
    writable = true;
    clearError();
    render(normalise(response.settings));
    flashMessage(message || 'Saved');
    loadHealth(false);
  }

  /* ------------------------------------------------------------------- actions */

  /**
   * This page runs inside an iframe in about:addons and chrome://extensions, where window.open
   * is unreliable. tabs.create needs no permission and always works.
   *
   * @param {string} url
   */
  function openTab(url) {
    if (browser.tabs && browser.tabs.create) {
      browser.tabs.create({ url: url });
      return;
    }
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  function bind() {
    for (let i = 0; i < KEYS.length; i++) {
      const key = KEYS[i];
      el(key).addEventListener('change', function (event) {
        const patch = {};
        patch[key] = event.currentTarget.checked;
        save(patch);
      });
    }

    el('reset').addEventListener('click', function () {
      save(Object.assign({}, DEFAULTS), 'Defaults restored');
    });

    const recheck = el('recheck');
    recheck.addEventListener('click', async function () {
      recheck.disabled = true;
      el('statusVerdict').textContent = 'Checking…';
      el('statusText').textContent = 'Asking Google whether the dark palette is still there.';
      statusBox.dataset.level = 'info';
      try {
        await loadHealth(true);
      } finally {
        recheck.disabled = false;
      }
    });

    const kofi = el('kofi');
    kofi.addEventListener('click', function () { openTab(kofi.dataset.url); });

    const source = el('source');
    if (source.dataset.url) {
      el('sourceLine').hidden = false;
      source.addEventListener('click', function () { openTab(source.dataset.url); });
    }

    // The popup may be open at the same time. Follow it rather than show a state the browser
    // has already left behind.
    if (browser.storage && browser.storage.onChanged) {
      browser.storage.onChanged.addListener(function (changes, area) {
        if (area !== 'local') return;
        if (changes.settings) render(normalise(changes.settings.newValue));
        if (changes.health) renderStatus(changes.health.newValue);
      });
    }
  }

  /**
   * The list of Google domains the extension is wired up for, read out of the manifest at
   * runtime rather than written into the page by hand.
   *
   * This is the one claim on this page that a change in another file could silently turn into a
   * lie — a domain added to or dropped from the manifest would leave a hand-written list saying
   * something untrue about what the user is going to get. Deriving it costs six lines.
   *
   * @param {object} manifest
   * @returns {string[]}
   */
  function coveredHosts(manifest) {
    const hosts = [];
    const scripts = Array.isArray(manifest.content_scripts) ? manifest.content_scripts : [];
    for (let i = 0; i < scripts.length; i++) {
      const matches = Array.isArray(scripts[i].matches) ? scripts[i].matches : [];
      for (let j = 0; j < matches.length; j++) {
        const host = String(matches[j]).replace(/^[a-z*]+:\/\//, '').split('/')[0];
        if (host && hosts.indexOf(host) === -1) hosts.push(host);
      }
    }
    return hosts;
  }

  /* ---------------------------------------------------------------------- boot */

  const manifest = browser.runtime.getManifest();
  el('name').textContent = manifest.name;
  el('version').textContent = 'Version ' + manifest.version;
  document.title = manifest.name + ' — Settings';
  const icons = manifest.icons || {};
  const size = ['48', '128', '32', '16'].filter(function (s) { return icons[s]; })[0];
  if (size) el('icon').src = browser.runtime.getURL(icons[size]);

  const hosts = coveredHosts(manifest);
  if (hosts.length > 0) {
    el('hostList').textContent = hosts.join(', ');
    el('hosts').hidden = false;
  }

  loadSettings().then(function (settings) {
    render(settings);
    if (!writable) {
      showError(
        'The extension’s background component is not answering, so these switches will not ' +
        'save. Restarting the browser usually clears this.'
      );
    }
    bind();
    return loadHealth(false);
  });
})();
