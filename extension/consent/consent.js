'use strict';
// Firefox only: opened from the "Show the latest GOAT Cam banner" button in the Maps
// panel (content scripts cannot call permissions.request). The request runs inside
// the click handler, as Firefox requires a user action for it.
(function () {
  const api = globalThis.browser;
  const REQUEST = Object.freeze({ data_collection: ['technicalAndInteraction'] });
  const allow = document.getElementById('allow');
  const decline = document.getElementById('decline');
  const status = document.getElementById('status');

  const closeSoon = function () {
    setTimeout(function () {
      if (!api || !api.tabs || typeof api.tabs.getCurrent !== 'function') return;
      api.tabs.getCurrent().then(function (tab) {
        if (tab && typeof tab.id === 'number') return api.tabs.remove(tab.id);
      }).catch(function () { /* leave the tab open */ });
    }, 1800);
  };
  const say = function (text) { status.textContent = text; status.hidden = false; };

  allow.addEventListener('click', function () {
    if (!api || !api.permissions || typeof api.permissions.request !== 'function') {
      say('This version of Firefox cannot grant the permission here. Use about:addons \u2192 Permissions and data.');
      return;
    }
    allow.disabled = true;
    decline.disabled = true;
    let pending;
    try { pending = api.permissions.request(REQUEST); } catch (_) { pending = Promise.resolve(false); }
    Promise.resolve(pending).catch(function () { return false; }).then(function (granted) {
      if (granted) {
        say('Done. The latest GOAT Cam banner will appear in the Maps panel. This tab closes itself.');
        closeSoon();
      } else {
        allow.disabled = false;
        decline.disabled = false;
        say('Not allowed. The panel keeps the built-in banner.');
      }
    });
  });

  decline.addEventListener('click', function () {
    // Hide the panel's button from now on; the popup and settings switch stay available.
    try { api.storage.local.set({ 'goatcamBanner.consentDismissed': true }); } catch (_) { /* best effort */ }
    say('No problem. Nothing is downloaded; the panel keeps the built-in banner.');
    allow.disabled = true;
    decline.disabled = true;
    closeSoon();
  });
})();
