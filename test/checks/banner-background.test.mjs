import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createHash, webcrypto } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const LIB_DIR = path.join(ROOT, 'extension', 'lib');
const BACKGROUND_SOURCE = fs.readFileSync(path.join(ROOT, 'extension', 'background.js'), 'utf8');
const VECTOR_DIR = path.join(ROOT, 'test', 'banner', 'vectors');
const VECTOR_MANIFEST = JSON.parse(fs.readFileSync(path.join(VECTOR_DIR, 'cases.json'), 'utf8'));
const VALID_SIGNED = new Uint8Array(fs.readFileSync(path.join(VECTOR_DIR, 'cases', 'valid.signed')));
const VALID_BANNER = JSON.parse(new TextDecoder().decode(VALID_SIGNED.subarray(VALID_SIGNED.indexOf(10) + 1)));
const VALID_PHOTO = new Uint8Array(fs.readFileSync(path.join(VECTOR_DIR, 'photos', VALID_BANNER.photo.webp)));
const VALID_HASH = createHash('sha256').update(VALID_SIGNED).digest('hex');
const KILLSWITCH_SIGNED = new Uint8Array(fs.readFileSync(path.join(VECTOR_DIR, 'cases', 'valid-killswitch.signed')));
const KILLSWITCH_BANNER = JSON.parse(
  new TextDecoder().decode(KILLSWITCH_SIGNED.subarray(KILLSWITCH_SIGNED.indexOf(10) + 1)),
);
const KILLSWITCH_HASH = createHash('sha256').update(KILLSWITCH_SIGNED).digest('hex');
const RECORD_KEY = 'goatcamBanner.record';
const DISPLAY_KEY = 'goatcamBanner.display';
const SET_PREFIX = 'goatcamBanner.set.';
const nowMs = Date.parse('2026-11-03T12:00:00Z');

const clone = (value) => value === undefined ? undefined : JSON.parse(JSON.stringify(value));

function eventSource() {
  const listeners = [];
  return {
    addListener(listener) { listeners.push(listener); },
    async emit(...args) {
      const results = [];
      for (const listener of listeners) results.push(await listener(...args));
      return results;
    },
    get size() { return listeners.length; },
  };
}

function responseFor(bytes) {
  let used = false;
  return {
    status: 200,
    headers: { get() { return null; } },
    body: {
      getReader() {
        return {
          async read() {
            if (used) return { done: true, value: undefined };
            used = true;
            return { done: false, value: bytes }; 
          },
          releaseLock() {},
          async cancel() {},
        };
      },
    },
  };
}

function makePort() {
  const port = {
    name: 'goatcamBanner',
    onMessage: eventSource(),
    onDisconnect: eventSource(),
    async send(message) { await port.onMessage.emit(message); },
    async disconnect() { await port.onDisconnect.emit(port); },
  };
  return port;
}

function makeRecord({ hash = VALID_HASH, revision = 7, enabled = true, expiresMs = Date.parse(VALID_BANNER.expires), photos = { webp: VALID_BANNER.photo.sha256.webp }, lastCheckMs = nowMs } = {}) {
  return {
    hwm: revision,
    current: { revision, sha256: hash, enabled, expiresMs, photos },
    lastCheckMs,
    failures: 0,
  };
}

function makeFakeBrowser({ flavor = 'chrome', data = {}, fetchImpl, permissions = [], failSet = false, browserGlobal = false } = {}) {
  const state = new Map(Object.entries(data).map(([key, value]) => [key, clone(value)]));
  const alarms = new Map();
  const storageGetCalls = [];
  const storageBytesCalls = [];
  const storageSetCalls = [];
  const storageRemoveCalls = [];
  const fetchCalls = [];
  const runtime = {
    onConnect: eventSource(),
    onInstalled: eventSource(),
    onStartup: eventSource(),
    onMessage: eventSource(),
    getManifest() { return { manifest_version: 3 }; },
    getURL(file) { return `chrome-extension://goatcam/${file}`; },
  };
  const storageLocal = {
    onChanged: eventSource(),
    async getBytesInUse(key) {
      storageBytesCalls.push(key);
      if (key === null) {
        return [...state.values()].reduce((sum, value) => sum + JSON.stringify(value).length, 0);
      }
      return state.has(key) ? JSON.stringify(state.get(key)).length : 0;
    },
    async get(key) {
      storageGetCalls.push(key);
      if (key === null) return Object.fromEntries([...state].map(([k, v]) => [k, clone(v)]));
      if (typeof key === 'string') return state.has(key) ? { [key]: clone(state.get(key)) } : {};
      if (Array.isArray(key)) return Object.fromEntries(key.filter((k) => state.has(k)).map((k) => [k, clone(state.get(k))]));
      if (key && typeof key === 'object') return Object.fromEntries(
        Object.entries(key).map(([k, fallback]) => [k, state.has(k) ? clone(state.get(k)) : fallback]),
      );
      return {};
    },
    async set(values) {
      storageSetCalls.push(clone(values));
      if (failSet && Object.keys(values).some((key) => key.startsWith(SET_PREFIX))) throw new Error('injected set failure');
      for (const [key, value] of Object.entries(values)) state.set(key, clone(value));
      await storageLocal.onChanged.emit(Object.fromEntries(Object.keys(values).map((key) => [key, { newValue: clone(state.get(key)) }])));
    },
    async remove(keys) {
      const list = Array.isArray(keys) ? keys : [keys];
      storageRemoveCalls.push([...list]);
      for (const key of list) state.delete(key);
    },
    async getKeys() { return [...state.keys()]; },
  };
  const alarmsApi = {
    onAlarm: eventSource(),
    async create(name, info) { alarms.set(name, { name, ...info }); },
    async clear(name) { return alarms.delete(name); },
    async get(name) { return alarms.get(name) ?? null; },
  };
  const api = {
    runtime,
    storage: { local: storageLocal },
    alarms: alarmsApi,
    permissions: { onAdded: eventSource(), onRemoved: eventSource(), async getAll() { return { data_collection: [...permissions] }; } },
    tabs: { created: [], async create(info) { this.created.push(info); return info; } },
  };
  const context = {
    console,
    crypto: webcrypto,
    TextEncoder,
    TextDecoder,
    URL,
    AbortController,
    AbortSignal,
    Blob,
    atob,
    btoa,
    setTimeout,
    clearTimeout,
    Date,
    fetch: async (url, options) => {
      fetchCalls.push({ url, options });
      return fetchImpl ? fetchImpl(url, options) : Promise.reject(new Error('unexpected fetch'));
    },
  };
  if (flavor === 'firefox') {
    runtime.getBrowserInfo = async () => ({ name: 'Firefox' });
    context.browser = api;
  } else {
    context.chrome = api;
    if (browserGlobal) context.browser = api;
  }
  return {
    context,
    api,
    state,
    alarms,
    storageGetCalls,
    storageBytesCalls,
    storageSetCalls,
    storageRemoveCalls,
    fetchCalls,
  };
}

async function loadBackground(options = {}) {
  const fake = makeFakeBrowser(options);
  const context = vm.createContext(fake.context);
  for (const file of ['banner-core.js', 'banner-machine.js', 'banner-fetch.js', 'banner-key.js']) {
    vm.runInContext(fs.readFileSync(path.join(LIB_DIR, file), 'utf8'), context, { filename: file });
  }
  context.GoatBannerKey = Object.freeze({
    publicKeyHex: VECTOR_MANIFEST.publicKeyHex,
    keyId: VECTOR_MANIFEST.keyId,
    floor: 1,
    firefoxOnline: options.firefoxOnline === true,
  });
  const source = options.exposeRender
    ? `${BACKGROUND_SOURCE}\nglobalThis.__goatBannerRender = goatBannerRender;`
    : BACKGROUND_SOURCE;
  vm.runInContext(source, context, { filename: 'background.js' });
  await new Promise((resolve) => setTimeout(resolve, 0));
  if (options.exposeRender) fake.render = context.__goatBannerRender;
  return fake;
}

async function connect(fake) {
  const port = makePort();
  await fake.api.runtime.onConnect.emit(port);
  return port;
}

async function waitFor(predicate, label) {
  const deadline = Date.now() + 2500;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail(`timed out waiting for ${label}`);
}

function validFetch(url) {
  if (url.endsWith('/banner/v1.signed')) return responseFor(VALID_SIGNED);
  if (url.endsWith(`/banner/${VALID_BANNER.photo.webp}`)) return responseFor(VALID_PHOTO);
  throw new Error(`unexpected URL ${url}`);
}

test('two-tabs-one-request', async () => {
  const fake = await loadBackground({ fetchImpl: validFetch });
  const first = await connect(fake);
  const second = await connect(fake);
  await waitFor(() => fake.state.has(DISPLAY_KEY) && fake.state.get(DISPLAY_KEY).kind === 'online', 'online display');
  assert.equal(fake.fetchCalls.filter(({ url }) => url.endsWith('/banner/v1.signed')).length, 1);
  await first.disconnect();
  await second.disconnect();
});

test('chrome-with-browser-global-fetches', async () => {
  const fake = await loadBackground({ browserGlobal: true, fetchImpl: validFetch });
  const port = await connect(fake);
  await waitFor(() => fake.state.get(DISPLAY_KEY)?.kind === 'online', 'Chrome online display');
  assert.equal(fake.fetchCalls.filter(({ url }) => url.endsWith('/banner/v1.signed')).length, 1);
  assert.equal(fake.state.get(DISPLAY_KEY).kind, 'online');
  await port.disconnect();
});

test('last-tab-hidden-cancels', async () => {
  let release;
  const signed = new Promise((resolve) => { release = resolve; });
  const fake = await loadBackground({
    fetchImpl: (url) => url.endsWith('/banner/v1.signed') ? signed : responseFor(VALID_PHOTO),
  });
  const first = await connect(fake);
  const second = await connect(fake);
  await waitFor(() => fake.fetchCalls.some(({ url }) => url.endsWith('/banner/v1.signed')), 'signed fetch');
  await first.disconnect();
  await second.disconnect();
  release(responseFor(VALID_SIGNED));
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(fake.storageSetCalls.some((values) => Object.hasOwn(values, RECORD_KEY)), false);
});

test('tab-closed-without-hide', async () => {
  let release;
  const signed = new Promise((resolve) => { release = resolve; });
  const fake = await loadBackground({ fetchImpl: (url) => url.endsWith('/banner/v1.signed') ? signed : responseFor(VALID_PHOTO) });
  const port = await connect(fake);
  await waitFor(() => fake.fetchCalls.some(({ url }) => url.endsWith('/banner/v1.signed')), 'signed fetch');
  await port.disconnect();
  release(responseFor(VALID_SIGNED));
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(fake.storageSetCalls.some((values) => Object.hasOwn(values, RECORD_KEY)), false);
});

test('worker-restart-reconnects', async () => {
  const first = await loadBackground({ fetchImpl: validFetch });
  const firstPort = await connect(first);
  await waitFor(() => first.state.has(RECORD_KEY), 'cached record');
  await firstPort.disconnect();
  const persisted = Object.fromEntries(first.state);
  const second = await loadBackground({ data: persisted, fetchImpl: validFetch });
  const secondPort = await connect(second);
  await waitFor(() => second.state.has(DISPLAY_KEY) && second.alarms.has('goatcamBanner.timer'), 'reconnected display and timer');
  assert.equal(second.state.get(DISPLAY_KEY).kind, 'online');
  assert.equal(second.alarms.has('goatcamBanner.timer'), true);
  await secondPort.disconnect();
});

test('firefox-gate-off', async () => {
  for (const firefoxOnline of [false, true]) {
    const fake = await loadBackground({
      flavor: 'firefox',
      firefoxOnline,
      permissions: [],
      fetchImpl: validFetch,
    });
    const port = await connect(fake);
    await waitFor(() => fake.state.has(DISPLAY_KEY), 'Firefox fallback display');
    assert.equal(fake.fetchCalls.length, 0);
    assert.equal(fake.state.get(DISPLAY_KEY).kind, 'dagoat');
    await port.disconnect();
  }
});

test('firefox-gate-on-when-allowed', async () => {
  const fake = await loadBackground({
    flavor: 'firefox',
    firefoxOnline: true,
    permissions: ['technicalAndInteraction'],
    fetchImpl: validFetch,
  });
  const port = await connect(fake);
  await waitFor(() => fake.state.get(DISPLAY_KEY)?.kind === 'online', 'Firefox online display');
  assert.equal(fake.fetchCalls.filter(({ url }) => url.endsWith('/banner/v1.signed')).length, 1);
  assert.equal(fake.state.get(DISPLAY_KEY).kind, 'online');
  await port.disconnect();
});

test('firefox-consent-granted-while-panel-open-fetches-now', async () => {
  // 1.0.5: the popup/options switch requests technicalAndInteraction from a click. A grant
  // made while a Maps panel is already open must start the download there and then.
  const permissions = [];
  const fake = await loadBackground({
    flavor: 'firefox',
    firefoxOnline: true,
    permissions,
    fetchImpl: validFetch,
  });
  const port = await connect(fake);
  await waitFor(() => fake.state.get(DISPLAY_KEY)?.kind === 'dagoat', 'Firefox fallback before consent');
  assert.equal(fake.fetchCalls.length, 0);
  permissions.push('technicalAndInteraction');
  await fake.api.permissions.onAdded.emit({ permissions: [], origins: [], data_collection: ['technicalAndInteraction'] });
  await waitFor(() => fake.state.get(DISPLAY_KEY)?.kind === 'online', 'Firefox online display after consent');
  assert.equal(fake.fetchCalls.filter(({ url }) => url.endsWith('/banner/v1.signed')).length, 1);
  await port.disconnect();
});

test('shipped key enables the Firefox banner behind the consent gate', () => {
  // 1.0.4 shipped firefoxOnline:false, so Firefox never fetched even with consent -- the
  // "ads section does not work on Firefox" report. The consent gate itself is unchanged.
  const key = fs.readFileSync(path.join(LIB_DIR, 'banner-key.js'), 'utf8');
  assert.match(key, /firefoxOnline: true,/);
});

test('firefox-panel-consent-button-state-and-page', async () => {
  // 1.0.5 follow-up: a temporary/self-installed Firefox add-on never shows the install-prompt
  // checkbox, so the Maps panel itself offers the opt-in. The background publishes whether
  // it is needed and opens consent/consent.html on request; a grant clears the flag.
  const permissions = [];
  const fake = await loadBackground({ flavor: 'firefox', firefoxOnline: true, permissions, fetchImpl: validFetch });
  await waitFor(() => fake.state.get('goatcamBanner.consent')?.needed === true, 'consent needed published');
  await fake.api.runtime.onMessage.emit({ type: 'goatcamBanner.openConsent' }, {}, () => {});
  await waitFor(() => fake.api.tabs.created.length === 1, 'consent page opened');
  assert.match(fake.api.tabs.created[0].url, /consent\/consent\.html$/);
  permissions.push('technicalAndInteraction');
  await fake.api.permissions.onAdded.emit({ permissions: [], origins: [], data_collection: ['technicalAndInteraction'] });
  await waitFor(() => fake.state.get('goatcamBanner.consent')?.needed === false, 'consent flag cleared');
  await fake.api.runtime.onMessage.emit({ type: 'goatcamBanner.openConsent' }, {}, () => {});
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(fake.api.tabs.created.length, 1, 'no page once granted');
});

test('chrome-never-offers-the-consent-button', async () => {
  const fake = await loadBackground({ fetchImpl: validFetch });
  await waitFor(() => fake.state.has('goatcamBanner.consent'), 'consent state published');
  assert.equal(fake.state.get('goatcamBanner.consent').needed, false);
  await fake.api.runtime.onMessage.emit({ type: 'goatcamBanner.openConsent' }, {}, () => {});
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(fake.api.tabs.created.length, 0);
});

test('display-written', async () => {
  const fake = await loadBackground({ fetchImpl: validFetch });
  const port = await connect(fake);
  await waitFor(() => fake.state.get(DISPLAY_KEY)?.kind === 'online', 'online display');
  const display = fake.state.get(DISPLAY_KEY);
  assert.equal(display.banner.headline, VALID_BANNER.headline);
  assert.equal(display.sha256, VALID_HASH);
  assert.equal(display.expiresMs, Date.parse(VALID_BANNER.expires));
  const set = fake.state.get(`${SET_PREFIX}${VALID_HASH}`);
  assert.equal(typeof set.signed, 'string');
  assert.equal(typeof set.webp, 'string');
  await port.disconnect();
});

test('display-expiry-from-signed-expires', async () => {
  const fake = await loadBackground({ exposeRender: true });
  await fake.render({
    kind: 'online',
    banner: {
      expires: '2027-11-02T00:00:00Z',
      expiresMs: 9e15,
    },
  });
  assert.equal(fake.state.get(DISPLAY_KEY).expiresMs, Date.parse('2027-11-02T00:00:00Z'));
});

test('killswitch-cached', async () => {
  const data = {
    [RECORD_KEY]: makeRecord({
      hash: KILLSWITCH_HASH,
      enabled: false,
      expiresMs: Date.parse(KILLSWITCH_BANNER.expires),
      photos: {},
      lastCheckMs: Date.now(),
    }),
    [`${SET_PREFIX}${KILLSWITCH_HASH}`]: { signed: Buffer.from(KILLSWITCH_SIGNED).toString('base64') },
  };
  const fake = await loadBackground({ data, fetchImpl: validFetch });
  const port = await connect(fake);
  await waitFor(() => fake.state.has(DISPLAY_KEY), 'cached killswitch display');
  assert.equal(fake.state.get(DISPLAY_KEY).kind, 'dagoat');
  assert.equal(fake.fetchCalls.length, 0);
  await port.disconnect();
});

test('adapter-record-cap', async () => {
  const fake = await loadBackground({
    data: { [RECORD_KEY]: { hwm: 0, padding: 'x'.repeat(17000) } },
    fetchImpl: () => Promise.reject(new Error('not reached')),
  });
  const port = await connect(fake);
  await waitFor(() => fake.storageBytesCalls.includes(RECORD_KEY), 'record size check');
  assert.equal(fake.storageGetCalls.includes(RECORD_KEY), false);
  await port.disconnect();
});

test('adapter-set-cap', async () => {
  const record = makeRecord({ lastCheckMs: Date.now() });
  const fake = await loadBackground({
    data: {
      [RECORD_KEY]: record,
      [`${SET_PREFIX}${VALID_HASH}`]: {
        signed: 'A'.repeat(22000),
        webp: 'A'.repeat(420000),
      },
    },
    fetchImpl: () => Promise.reject(new Error('not reached')),
  });
  const port = await connect(fake);
  await waitFor(() => fake.state.get(DISPLAY_KEY)?.kind === 'dagoat', 'oversized set fallback');
  assert.equal(fake.fetchCalls.length, 0);
  await port.disconnect();
});

test('adapter-atomic-set', async () => {
  const data = {
    [RECORD_KEY]: makeRecord({ lastCheckMs: 0 }),
    [`${SET_PREFIX}${VALID_HASH}`]: {
      signed: Buffer.from(VALID_SIGNED).toString('base64'),
      webp: Buffer.from(VALID_PHOTO).toString('base64'),
    },
  };
  const oldSet = clone(data[`${SET_PREFIX}${VALID_HASH}`]);
  const fake = await loadBackground({ data, fetchImpl: validFetch, failSet: true });
  const port = await connect(fake);
  await waitFor(() => fake.storageSetCalls.some((values) => Object.keys(values).some((key) => key.startsWith(SET_PREFIX))), 'atomic set attempt');
  const setCalls = fake.storageSetCalls.filter((values) => Object.keys(values).some((key) => key.startsWith(SET_PREFIX)));
  assert.equal(setCalls.length, 1);
  assert.deepEqual(fake.state.get(`${SET_PREFIX}${VALID_HASH}`), oldSet);
  await port.disconnect();
});
