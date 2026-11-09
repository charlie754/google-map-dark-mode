'use strict';
/**
 * Firefox-only switch for the GOAT Cam banner download (popup and options page).
 *
 * In Firefox the panel's GOAT Cam banner is only downloaded from goatcam.dagoat.io after the
 * user has granted the optional `technicalAndInteraction` data-collection permission declared
 * in manifest.firefox.json (see goatBannerGate in background.js). Firefox offers it as a
 * checkbox in the AMO install prompt, and in about:addons > Permissions and data; but a
 * temporary install from about:debugging shows no prompt at all, and in 1.0.4 nothing in the
 * extension itself could ask for it, so Firefox users only ever saw the bundled banner.
 *
 * permissions.request() is only honoured inside a user-action handler, which is why this lives
 * on the extension's own pages rather than in the content script (content scripts have no
 * permissions API). The request is the first thing the change handler does, synchronously.
 *
 * Chrome has no data-collection permissions and downloads the banner without asking, so the row
 * stays hidden there: feature-detected by `data_collection` being present in getAll().
 */
(function (root) {
  const DATA = 'technicalAndInteraction';
  const REQUEST = Object.freeze({ data_collection: [DATA] });

  async function readGranted(api) {
    const all = await api.permissions.getAll();
    if (!all || !Array.isArray(all.data_collection)) return null;
    return all.data_collection.includes(DATA);
  }

  /**
   * @param {HTMLElement} container  hidden until the browser is known to support the consent
   * @param {HTMLInputElement} input the switch
   */
  function bind(container, input) {
    const api = root.browser;
    if (!container || !input || !api || !api.permissions ||
        typeof api.permissions.getAll !== 'function' ||
        typeof api.permissions.request !== 'function' ||
        typeof api.runtime.getBrowserInfo !== 'function') return;

    let busy = false;
    const refresh = function () {
      return readGranted(api).then(function (granted) {
        if (granted === null) { container.hidden = true; return; }
        container.hidden = false;
        if (!busy) input.checked = granted;
      }, function () { container.hidden = true; });
    };

    input.addEventListener('change', function () {
      const want = input.checked;
      busy = true;
      let pending;
      try {
        pending = want ? api.permissions.request(REQUEST) : api.permissions.remove(REQUEST);
      } catch (_) {
        pending = Promise.resolve(false);
      }
      Promise.resolve(pending).catch(function () { return false; }).then(function () {
        busy = false;
        return refresh();
      });
    });

    if (api.permissions.onAdded) api.permissions.onAdded.addListener(refresh);
    if (api.permissions.onRemoved) api.permissions.onRemoved.addListener(refresh);
    refresh();
  }

  root.GoatBannerConsent = Object.freeze({ bind: bind });
})(typeof globalThis !== 'undefined' ? globalThis : self);
