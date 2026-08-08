/**
 * Diagnostic traffic logger (MV2, persistent background page).
 *
 * MV2 deliberately: an MV3 event page can be torn down mid-run and take the log
 * with it, and MV2 host permissions are granted at install rather than opt-in.
 * This add-on is a measuring instrument for Lane D, never shipped.
 *
 * `webRequest` sits below the worker boundary, so this sees the mapcore Web
 * Worker's fetches -- which is exactly the class of request Playwright's
 * `context.on('request')` may not surface, and therefore the one place a
 * "we saw zero proto requests" conclusion could be wrong.
 */

globalThis.__laneD = {
  requests: [],
  redirects: [],
  completed: [],
  errors: [],
};

const filter = { urls: ['<all_urls>'] };

browser.webRequest.onBeforeRequest.addListener((d) => {
  globalThis.__laneD.requests.push({
    id: d.requestId,
    url: d.url,
    type: d.type,
    method: d.method,
    t: d.timeStamp,
    documentUrl: d.documentUrl ?? null,
    originUrl: d.originUrl ?? null,
  });
}, filter);

browser.webRequest.onBeforeRedirect.addListener((d) => {
  globalThis.__laneD.redirects.push({
    id: d.requestId,
    from: d.url,
    to: d.redirectUrl,
    status: d.statusCode,
    fromCache: d.fromCache,
    t: d.timeStamp,
  });
}, filter);

browser.webRequest.onCompleted.addListener((d) => {
  globalThis.__laneD.completed.push({
    id: d.requestId,
    url: d.url,
    status: d.statusCode,
    fromCache: d.fromCache,
    type: d.type,
    t: d.timeStamp,
  });
}, filter);

browser.webRequest.onErrorOccurred.addListener((d) => {
  globalThis.__laneD.errors.push({ id: d.requestId, url: d.url, error: d.error, type: d.type });
}, filter);

console.log('[lane-d-logger] armed');
