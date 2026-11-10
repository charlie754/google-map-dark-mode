'use strict';
/**
 * Toolbar popup.
 *
 * Three things live here and nothing else: the switches, the one place a user can find out the
 * extension has stopped working, and the Ko-fi link. Anything that needs a paragraph to explain
 * belongs on the options page.
 *
 * Settings are never written to storage from this page. Every write goes through the background
 * as a `setSettings` message, because turning dark mode off also has to disable the
 * declarativeNetRequest ruleset, and those two have to happen together or the map and the switch
 * disagree. The read goes through the background too; a direct storage read exists only as a
 * fallback for the case where the background never answers, and it is read-only.
 */
(function () {
  /** Mirrors the background's defaults. Dark mode is ON out of the box. */
  const DEFAULTS = Object.freeze({ enabled: true, darkMap: true, darkChrome: true });
  const KEYS = ['enabled', 'darkMap', 'darkChrome'];
  /** The two sub-toggles, which the master switch gates. */
  const SUB_KEYS = ['darkMap', 'darkChrome'];

  /**
   * What the user is told for each non-healthy verdict.
   *
   * `healthy` is absent on purpose: nothing is shown when everything works. A banner that is
   * always on screen is a banner nobody reads, and this one has to be believed the day it
   * finally says something.
   *
   * The two `alert` verdicts are the ones where nothing the user does will help, so they say so
   * plainly rather than implying a setting is at fault.
   */
  const HEALTH = {
    'rules-broken': {
      level: 'alert',
      title: 'Dark mode has stopped working',
      text:
        'The browser is no longer applying the rules that darken the map. Google has most ' +
        'likely changed something on their side, and an updated version of this extension is ' +
        'needed to fix it. Until then Maps will look the way it normally does.',
    },
    'token-dead': {
      level: 'alert',
      title: 'Google is no longer serving the dark map style',
      text:
        'The dark palette this extension points Maps at has gone from Google’s servers ' +
        'under the name it used. Nothing can be changed from here to bring it back — an ' +
        'updated version of the extension is needed. Until then Maps will look the way it ' +
        'normally does.',
    },
    degraded: {
      level: 'warn',
      title: 'Working, with a light flash',
      text:
        'The map still goes dark, but for about a second after each page load you will see the ' +
        'light one first.',
    },
    unverified: {
      level: 'info',
      title: 'Not checked yet',
      text:
        'The extension has not confirmed that Google is still serving the dark map style. It is ' +
        'applying its rules as normal.',
    },
    unknown: {
      level: 'info',
      title: 'Could not check',
      text:
        'The extension could not reach Google to confirm the dark map style is still being ' +
        'served — usually just no connection. It is applying its rules as normal.',
    },
  };

  const NO_BACKGROUND = {
    level: 'info',
    title: 'Could not check',
    text:
      'The extension’s background component did not answer, so its state is unknown. ' +
      'Restarting the browser usually clears this.',
  };

  const el = function (id) { return document.getElementById(id); };

  const panel = el('panel');
  const errorBox = el('error');
  const health = el('health');

  /** Last state rendered, so a failed write can be put back on screen. */
  let current = Object.assign({}, DEFAULTS);
  /** False once a write has been proven to fail; used only to phrase the error. */
  let writable = true;

  /* ------------------------------------------------------------------ plumbing */

  /**
   * Send a message to the background and get a promise, on both engines.
   *
   * Firefox returns a promise natively; Chrome MV3 does too when no callback is passed. The
   * failure mode that matters is the background not being there at all, which surfaces as a
   * rejection on Chrome ("Could not establish connection") and as `undefined` on either — both
   * are handled by the callers, neither is allowed to leave the UI lying.
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

  /** @param {any} value @returns {{enabled: boolean, darkMap: boolean, darkChrome: boolean}} */
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

  /* -------------------------------------------------------------------- render */

  function showError(message) {
    errorBox.textContent = message;
    errorBox.hidden = false;
  }

  function clearError() {
    errorBox.textContent = '';
    errorBox.hidden = true;
  }

  /** @param {{level: string, title: string, text: string} | null} state */
  function renderHealth(state) {
    if (!state) {
      health.hidden = true;
      return;
    }
    el('healthTitle').textContent = state.title;
    el('healthText').textContent = state.text;
    health.dataset.level = state.level;
    health.hidden = false;
  }

  /** @param {object} settings */
  function render(settings) {
    current = settings;
    for (let i = 0; i < KEYS.length; i++) {
      el(KEYS[i]).checked = settings[KEYS[i]];
    }
    // The sub-switches keep showing their own state when the master is off — the user gets to
    // see what will come back — but they stop being operable, and leave the tab order with them.
    for (let i = 0; i < SUB_KEYS.length; i++) {
      const input = el(SUB_KEYS[i]);
      input.disabled = !settings.enabled;
      el('row-' + SUB_KEYS[i]).dataset.off = String(!settings.enabled);
    }
    if (panel.dataset.ready !== 'true') {
      panel.dataset.ready = 'true';
      // Flush the un-animated state before switching animation back on, otherwise the browser
      // sees "unchecked -> checked" as one transitionable change and every popup open plays the
      // switches sliding from off to on. Reading offsetWidth forces the style recalculation
      // that makes the checked state the transition's starting point rather than its end.
      void panel.offsetWidth;
      document.body.dataset.anim = 'on';
    }
  }

  /* --------------------------------------------------------------------- load */

  async function loadSettings() {
    try {
      const response = await send({ type: 'getSettings' });
      if (response && typeof response === 'object') return normalise(response);
      throw new Error('no response');
    } catch (err) {
      // Read-only fallback. Not a write path: if the background is not answering, the switches
      // will not stick either, and the user is told that the first time they try one.
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

  async function loadHealth(settings) {
    // With dark mode off, "it is not working" is the user's own doing and saying so is noise.
    if (!settings.enabled) return renderHealth(null);
    let record = null;
    try {
      record = await send({ type: 'getHealth' });
    } catch (err) {
      return renderHealth(NO_BACKGROUND);
    }
    if (!record || typeof record !== 'object') return renderHealth(NO_BACKGROUND);
    const verdict = typeof record.verdict === 'string' ? record.verdict : 'unknown';
    if (verdict === 'healthy') return renderHealth(null);
    renderHealth(HEALTH[verdict] || HEALTH.unknown);
  }

  /* --------------------------------------------------------------------- save */

  /**
   * @param {string} key
   * @param {boolean} value
   */
  async function save(key, value) {
    const patch = {};
    patch[key] = value;
    let response;
    try {
      response = await send({ type: 'setSettings', patch: patch });
    } catch (err) {
      response = null;
    }
    if (!response || response.ok !== true || !response.settings) {
      writable = false;
      showError(
        'That could not be saved — the extension’s background component did not ' +
        'answer. Try reopening the browser.'
      );
      render(current); // put the switch back where it was rather than lie about the state
      return;
    }
    writable = true;
    clearError();
    render(normalise(response.settings));
    loadHealth(current);
  }

  /* ------------------------------------------------------------------- actions */

  /**
   * A popup is destroyed the moment focus leaves it, so opening a tab has to happen through
   * tabs.create (no permission needed) rather than window.open, and the panel is closed
   * explicitly afterwards.
   *
   * @param {string} url
   */
  function openTab(url) {
    if (browser.tabs && browser.tabs.create) {
      browser.tabs.create({ url: url }).then(
        function () { window.close(); },
        function () { window.close(); }
      );
      return;
    }
    window.open(url, '_blank', 'noopener,noreferrer');
    window.close();
  }

  function bind() {
    for (let i = 0; i < KEYS.length; i++) {
      const key = KEYS[i];
      el(key).addEventListener('change', function (event) {
        save(key, event.currentTarget.checked);
      });
    }

    const kofi = el('kofi');
    kofi.addEventListener('click', function () { openTab(kofi.dataset.url); });

    const source = el('source');
    if (source.dataset.url) {
      source.hidden = false;
      source.addEventListener('click', function () { openTab(source.dataset.url); });
    }

    el('settings').addEventListener('click', function () {
      if (browser.runtime.openOptionsPage) {
        browser.runtime.openOptionsPage().then(
          function () { window.close(); },
          function () { window.close(); }
        );
        return;
      }
      openTab(browser.runtime.getURL('options/options.html'));
    });

    // The options page may be open in another tab at the same time. Follow it rather than show
    // a state the browser has already left behind.
    if (browser.storage && browser.storage.onChanged) {
      browser.storage.onChanged.addListener(function (changes, area) {
        if (area !== 'local' || !changes.settings) return;
        render(normalise(changes.settings.newValue));
        loadHealth(current);
      });
    }
  }

  /* ---------------------------------------------------------------------- boot */

  const manifest = browser.runtime.getManifest();
  el('name').textContent = manifest.name;
  el('version').textContent = 'Version ' + manifest.version;
  document.title = manifest.name;
  const icons = manifest.icons || {};
  const size = ['48', '32', '128', '16'].filter(function (s) { return icons[s]; })[0];
  if (size) el('icon').src = browser.runtime.getURL(icons[size]);

  loadSettings().then(function (settings) {
    render(settings);
    if (!writable) {
      showError(
        'The extension’s background component is not answering, so these switches will ' +
        'not save. Restarting the browser usually clears this.'
      );
    }
    bind();
    return loadHealth(settings);
  });
})();
