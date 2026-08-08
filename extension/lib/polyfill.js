'use strict';
/**
 * Namespace bridge for the extension's own pages (popup, options).
 *
 * The UI is written against the WebExtension `browser.*` namespace. Firefox has it natively;
 * Chrome MV3 already returns promises from `chrome.*` when no callback is passed, so aliasing
 * `chrome` onto `browser` is genuinely all that is needed — no shim layer, no third-party
 * polyfill, no dependency.
 *
 * It is loaded in every page rather than feature-detected at each call site, so the UI code
 * depends on a namespace this file establishes itself rather than on the host happening to
 * provide one. (Current Chrome does define `browser` in extension pages, but older Chrome and
 * other Chromium builds have not been tested here, and this costs well under a kilobyte.)
 *
 * Deliberately narrower than the same file in the author's previous extension: that one also
 * aliased `menus` -> `contextMenus`, which this extension has no use for. Nothing is aliased
 * speculatively — an alias that is never called is an untested code path.
 */
(function (root) {
  if (typeof root.browser === 'undefined' && typeof chrome !== 'undefined') {
    root.browser = chrome;
  }
})(typeof globalThis !== 'undefined' ? globalThis : self);
