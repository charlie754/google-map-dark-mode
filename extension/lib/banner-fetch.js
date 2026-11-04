(function () {
  "use strict";

  const HEX64 = /^[0-9a-f]{64}$/;
  const KINDS = new Set(["webp", "jpg"]);
  const SIGNED_CAP = 16_384;
  const PHOTO_CAP = 300_000;
  const textEncoder = new TextEncoder();

  const isBytes = (value) => value instanceof Uint8Array;

  const recordFitsCap = (record) => {
    try {
      const serialized = JSON.stringify(record);
      return typeof serialized === "string"
        && textEncoder.encode(serialized).byteLength <= SIGNED_CAP;
    } catch {
      return false;
    }
  };

  const validRecord = (record) => {
    if (record === null || typeof record !== "object" || Array.isArray(record)) return false;
    if (!Number.isSafeInteger(record.hwm) || record.hwm < 0) return false;
    if (!Number.isSafeInteger(record.lastCheckMs)) return false;
    if (!Number.isInteger(record.failures) || record.failures < 0 || record.failures > 3) return false;

    if (record.current === null) return true;
    const current = record.current;
    if (current === null || typeof current !== "object" || Array.isArray(current)) return false;
    if (!Number.isSafeInteger(current.revision) || current.revision < 1) return false;
    if (typeof current.sha256 !== "string" || !HEX64.test(current.sha256)) return false;
    if (typeof current.enabled !== "boolean") return false;
    if (!Number.isSafeInteger(current.expiresMs)) return false;
    if (current.photos === null || typeof current.photos !== "object" || Array.isArray(current.photos)) return false;
    for (const kind of Object.keys(current.photos)) {
      if (!KINDS.has(kind) || typeof current.photos[kind] !== "string" || !HEX64.test(current.photos[kind])) {
        return false;
      }
    }
    return true;
  };

  const asError = (value) => (value instanceof Error ? value : new Error(String(value)));

  const isProductionOrigin = (value) => {
    if (typeof value !== "string") return false;
    try {
      const parsed = new URL(value);
      return parsed.protocol === "https:"
        && parsed.username === ""
        && parsed.password === ""
        && parsed.pathname === "/"
        && parsed.search === ""
        && parsed.hash === ""
        && value === `https://${parsed.host}`;
    } catch {
      return false;
    }
  };

  const base64 = (bytes) => {
    let text = "";
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
      text += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    }
    return btoa(text);
  };

  const joinBytes = (chunks, length) => {
    const result = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.length;
    }
    return result;
  };

  const makeRequestSignal = (attempt, deadlineMs, capController) => {
    let deadlineController = null;
    let deadlineSignal;
    let deadlineTimer = null;
    if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") {
      deadlineSignal = AbortSignal.timeout(deadlineMs);
    } else {
      deadlineController = new AbortController();
      deadlineSignal = deadlineController.signal;
      deadlineTimer = globalThis.setTimeout(() => deadlineController.abort(), deadlineMs);
    }

    const signals = [attempt.controller.signal, deadlineSignal, capController.signal];
    let combinedController = null;
    const listeners = [];
    let signal;
    if (typeof AbortSignal !== "undefined" && typeof AbortSignal.any === "function") {
      signal = AbortSignal.any(signals);
    } else {
      combinedController = new AbortController();
      signal = combinedController.signal;
      for (const source of signals) {
        const abort = () => combinedController.abort();
        if (source.aborted) abort();
        else {
          source.addEventListener("abort", abort, { once: true });
          listeners.push([source, abort]);
        }
      }
    }

    return {
      signal,
      cleanup() {
        if (deadlineTimer !== null) globalThis.clearTimeout(deadlineTimer);
        for (const [source, listener] of listeners) source.removeEventListener("abort", listener);
      },
    };
  };

  const run = (machine, opts) => {
    const options = opts || {};
    const core = globalThis.GoatBannerCore;
    const storage = options.storage;
    const kinds = Array.isArray(options.kinds) ? options.kinds.slice() : [];
    const origin = options.origin;
    const publicKeyRaw = options.publicKeyRaw;
    const allowInsecureForTests = options.allowInsecureForTests === true;
    if (!allowInsecureForTests && !isProductionOrigin(origin)) {
      throw new TypeError("invalid online banner origin");
    }
    const deadlineMs = options.deadlineMs === undefined ? 20_000 : options.deadlineMs;
    const gate = typeof options.gate === "function" ? options.gate : async () => true;
    const fetchImpl = options.fetch || globalThis.fetch;
    const now = typeof options.now === "function" ? options.now : Date.now;
    if (typeof options.setTimer !== "function") throw new TypeError("setTimer is required");
    if (typeof options.clearTimer !== "function") throw new TypeError("clearTimer is required");
    const setTimer = options.setTimer;
    const clearTimer = options.clearTimer;
    const render = typeof options.render === "function" ? options.render : () => {};
    const openLink = typeof options.openLink === "function" ? options.openLink : () => {};
    const onError = typeof options.onError === "function" ? options.onError : () => {};
    const customDecode = typeof options.decode === "function" ? options.decode : null;

    let queue = [];
    let draining = false;
    let pendingAsync = 0;
    let idleWaiters = [];
    let lastModel = null;
    let currentSet = null;
    let currentBanner = null;
    let fallbackTimer = null;
    let renderRetryPending = false;
    const attempts = new Map();

    const clearFallbackTimer = () => {
      if (fallbackTimer !== null) {
        globalThis.clearTimeout(fallbackTimer);
        fallbackTimer = null;
      }
    };

    const reportError = (error) => {
      try {
        onError(asError(error));
      } catch {
        // A logger must not break the effect queue.
      }
    };

    const renderModel = async (model) => {
      try {
        await render(model);
        renderRetryPending = false;
      } catch (error) {
        renderRetryPending = true;
        throw error;
      }
    };

    const retryRender = async () => {
      if (!renderRetryPending || lastModel === null) return;
      try {
        await renderModel(lastModel);
      } catch (error) {
        reportError(error);
      }
    };

    const gateWithTimeout = async () => {
      let timer = null;
      try {
        return await Promise.race([
          Promise.resolve().then(() => gate()).then((value) => value === true, () => false),
          new Promise((resolve) => {
            timer = globalThis.setTimeout(() => resolve(false), 5_000);
          }),
        ]);
      } finally {
        if (timer !== null) globalThis.clearTimeout(timer);
      }
    };

    const isCurrent = (gen) => {
      const state = machine.state();
      const attempt = attempts.get(gen);
      return state.gen === gen && state.attempting && state.visible && attempt && !attempt.cancelled;
    };

    const notifyIdle = () => {
      if (draining || queue.length !== 0 || pendingAsync !== 0) return;
      const waiters = idleWaiters;
      idleWaiters = [];
      for (const resolve of waiters) resolve();
    };

    const enqueue = (task) => new Promise((resolve) => {
      queue.push({ task, resolve });
      void drain();
    });

    async function drain() {
      if (draining) return;
      draining = true;
      while (queue.length !== 0) {
        const item = queue.shift();
        try {
          item.resolve(await item.task());
        } catch (error) {
          reportError(error);
          item.resolve(undefined);
        }
      }
      draining = false;
      notifyIdle();
    }

    const whenIdle = () => {
      if (!draining && queue.length === 0 && pendingAsync === 0) return Promise.resolve();
      return new Promise((resolve) => idleWaiters.push(resolve));
    };

    const defaultDecode = async (bytes, kind) => {
      if (typeof globalThis.createImageBitmap !== "function") return null;
      const mime = kind === "webp" ? "image/webp" : "image/jpeg";
      const bitmap = await globalThis.createImageBitmap(new Blob([bytes], { type: mime }));
      try {
        return { width: bitmap.width, height: bitmap.height };
      } finally {
        if (typeof bitmap.close === "function") bitmap.close();
      }
    };

    const decode = customDecode || defaultDecode;

    const requestBytes = async (url, cap, attempt) => {
      const capController = new AbortController();
      const requestSignal = makeRequestSignal(attempt, deadlineMs, capController);
      try {
        const response = await fetchImpl(url, {
          method: "GET",
          credentials: "omit",
          redirect: "error",
          referrerPolicy: "no-referrer",
          cache: "no-store",
          signal: requestSignal.signal,
        });
        if (response.status !== 200) {
          capController.abort();
          throw new Error(`HTTP status ${response.status}`);
        }

        const contentLength = response.headers && response.headers.get("content-length");
        if (contentLength !== null && contentLength !== undefined) {
          const length = Number(contentLength);
          if (Number.isFinite(length) && length > cap) {
            capController.abort();
            throw new Error("response-size");
          }
        }

        if (!response.body || typeof response.body.getReader !== "function") return new Uint8Array(0);
        const reader = response.body.getReader();
        const chunks = [];
        let length = 0;
        try {
          while (true) {
            const part = await reader.read();
            if (part.done) break;
            const value = part.value instanceof Uint8Array ? part.value : new Uint8Array(part.value);
            length += value.byteLength;
            if (length > cap) {
              capController.abort();
              try {
                await reader.cancel();
              } catch {
                // The abort is the relevant cancellation.
              }
              throw new Error("response-size");
            }
            chunks.push(value);
          }
        } finally {
          reader.releaseLock();
        }
        return joinBytes(chunks, length);
      } finally {
        requestSignal.cleanup();
      }
    };

    const modelFor = (what, immediate) => {
      if (what === "dagoat") return { kind: "dagoat", immediate };
      if (!currentSet || !currentBanner) throw new Error("online set is unavailable");
      const kind = kinds[0];
      const bytes = currentSet.photos[kind];
      if (!isBytes(bytes)) throw new Error("online photo is unavailable");
      const mime = kind === "webp" ? "image/webp" : "image/jpeg";
      return {
        kind: "online",
        banner: currentBanner,
        photo: { kind, dataUrl: `data:${mime};base64,${base64(bytes)}` },
        immediate,
      };
    };

    const processEffect = async (effect) => {
      switch (effect.type) {
        case "fetch-signed": {
          for (const gen of attempts.keys()) {
            if (gen !== effect.gen) attempts.delete(gen);
          }
          const attempt = {
            controller: new AbortController(),
            cancelled: false,
            signed: null,
            result: null,
            photos: null,
          };
          attempts.set(effect.gen, attempt);
          pendingAsync += 1;
          void (async () => {
            try {
              if (!isCurrent(effect.gen)) return;
              const bytes = await requestBytes(`${origin}/banner/v1.signed`, SIGNED_CAP, attempt);
              if (!isCurrent(effect.gen)) return;
              const state = machine.state();
              const result = await core.evaluate(bytes, {
                publicKeyRaw,
                nowMs: now(),
                hwm: state.record.hwm,
                floor: state.floor,
                storedBytes: currentSet ? currentSet.signed : null,
              });
              if (!isCurrent(effect.gen)) return;
              attempt.signed = bytes;
              await enqueue(() => dispatchEvent({ type: "SIGNED", gen: effect.gen, result }));
            } catch (error) {
              if (attempt.cancelled || !isCurrent(effect.gen)) return;
              await enqueue(() => dispatchEvent({ type: "FAILED", gen: effect.gen }));
            } finally {
              pendingAsync -= 1;
              notifyIdle();
            }
          })();
          return;
        }
        case "fetch-photos": {
          const attempt = attempts.get(effect.gen);
          if (!attempt || !isCurrent(effect.gen)) return;
          pendingAsync += 1;
          void (async () => {
            try {
              const result = attempt.result;
              if (!result || !result.banner) {
                if (isCurrent(effect.gen)) {
                  await enqueue(() => dispatchEvent({ type: "PHOTOS", gen: effect.gen, ok: false }));
                }
                return;
              }
              const photos = {};
              for (const kind of effect.kinds) {
                if (!isCurrent(effect.gen)) return;
                const bytes = await requestBytes(
                  `${origin}/banner/${result.banner.photo[kind]}`,
                  PHOTO_CAP,
                  attempt,
                );
                if (!isCurrent(effect.gen)) return;
                const checked = await core.checkPhoto(bytes, {
                  kind,
                  sha256: result.banner.photo.sha256[kind],
                  w: result.banner.photo.w,
                  h: result.banner.photo.h,
                });
                if (!checked || checked.ok !== true) throw new Error("photo-check");
                if (!isCurrent(effect.gen)) return;
                const decoded = await decode(bytes, kind);
                if (!isCurrent(effect.gen)) return;
                if (decoded !== null && (!decoded || decoded.width !== result.banner.photo.w || decoded.height !== result.banner.photo.h)) {
                  throw new Error("photo-decode");
                }
                photos[kind] = bytes;
              }
              if (!isCurrent(effect.gen)) return;
              attempt.photos = photos;
              await enqueue(() => dispatchEvent({ type: "PHOTOS", gen: effect.gen, ok: true }));
            } catch (error) {
              if (attempt.cancelled || !isCurrent(effect.gen)) return;
              await enqueue(() => dispatchEvent({ type: "PHOTOS", gen: effect.gen, ok: false }));
            } finally {
              pendingAsync -= 1;
              notifyIdle();
            }
          })();
          return;
        }
        case "cancel": {
          const attempt = attempts.get(effect.gen);
          if (attempt) {
            attempt.cancelled = true;
            attempt.controller.abort();
            attempts.delete(effect.gen);
          }
          return;
        }
        case "write-set": {
          if (!isCurrent(effect.gen)) return;
          const attempt = attempts.get(effect.gen);
          if (!attempt || !attempt.signed || !attempt.photos) {
            await dispatchEvent({ type: "FAILED", gen: effect.gen });
            return;
          }
          try {
            await storage.writeSet(effect.sha256, {
              signed: attempt.signed,
              photos: attempt.photos,
            });
          } catch (error) {
            reportError(error);
            await dispatchEvent({ type: "FAILED", gen: effect.gen });
            return;
          }
          await dispatchEvent({ type: "COMMITTED", gen: effect.gen });
          return;
        }
        case "write-record":
          try {
            await storage.writeRecord(effect.record);
          } catch (error) {
            reportError(error);
          }
          return;
        case "delete-unnamed-sets": {
          const state = machine.state();
          try {
            await storage.deleteSetsExcept(state.record.current ? state.record.current.sha256 : null);
          } catch (error) {
            reportError(error);
          }
          return;
        }
        case "display": {
          const model = modelFor(effect.what, effect.immediate);
          lastModel = model;
          await renderModel(model);
          return;
        }
        case "arm-timer": {
          clearFallbackTimer();
          const timerCallback = () => {
            fallbackTimer = null;
            void controls.timerFired();
          };
          let fallbackNeeded = false;
          try {
            clearTimer();
          } catch (error) {
            reportError(error);
            fallbackNeeded = true;
          }
          try {
            if (setTimer(effect.atMs, timerCallback) === false) {
              throw new Error("timer arm failed");
            }
          } catch (error) {
            reportError(error);
            fallbackNeeded = true;
          }
          if (fallbackNeeded) {
            fallbackTimer = globalThis.setTimeout(
              timerCallback, Math.max(0, effect.atMs - now()),
            );
          }
          return;
        }
        case "disarm-timer":
          clearFallbackTimer();
          try {
            clearTimer();
          } catch (error) {
            reportError(error);
          }
          return;
        case "open-link":
          await openLink(lastModel && lastModel.kind === "online" ? lastModel.banner.link : "https://dagoat.io");
          return;
        default:
          return;
      }
    };

    const processEffects = async (effects) => {
      for (const effect of effects) {
        try {
          await processEffect(effect);
        } catch (error) {
          reportError(error);
        }
      }
    };

    async function dispatchEvent(event) {
      const before = machine.state();
      const effects = machine.dispatch(event, now());
      if (event.type === "SIGNED" && before.attempting && before.gen === event.gen) {
        const attempt = attempts.get(event.gen);
        if (attempt && (event.result.action === "show" || event.result.action === "killswitch")) {
          attempt.result = event.result;
          if (event.result.action === "killswitch") attempt.photos = {};
        }
      }
      if (event.type === "COMMITTED" && before.attempting && before.gen === event.gen) {
        const attempt = attempts.get(event.gen);
        if (attempt && attempt.signed && attempt.photos) {
          currentSet = { signed: attempt.signed, photos: attempt.photos };
          currentBanner = attempt.result ? attempt.result.banner : null;
        }
        attempts.delete(event.gen);
      }
      if (event.type === "FAILED" && before.attempting && before.gen === event.gen) attempts.delete(event.gen);
      await processEffects(effects);
    }

    const verifyStoredSet = async (record) => {
      if (!record || record.current === null) return { valid: false, set: null, banner: null };
      try {
        const set = await storage.readSet(record.current.sha256);
        if (!set || !isBytes(set.signed) || !set.photos || typeof set.photos !== "object") {
          return { valid: false, set: null, banner: null };
        }
        if (set.signed.byteLength > SIGNED_CAP) {
          return { valid: false, set: null, banner: null };
        }
        const state = machine.state();
        const result = await core.evaluate(set.signed, {
          publicKeyRaw,
          nowMs: now(),
          hwm: record.hwm,
          floor: state.floor,
          storedBytes: set.signed,
        });
        if (
          !result ||
          (result.action !== "show" && result.action !== "killswitch")
          || result.sha256 !== record.current.sha256
          || result.revision !== record.current.revision
          || (record.current.enabled !== (result.action === "show"))
          || record.current.expiresMs !== Date.parse(result.banner.expires)
        ) return { valid: false, set: null, banner: null };

        const expectedPhotos = {};
        if (result.action === "show") {
          for (const kind of kinds) expectedPhotos[kind] = result.banner.photo.sha256[kind];
        }
        const cachedPhotoKinds = Object.keys(record.current.photos);
        const expectedPhotoKinds = Object.keys(expectedPhotos);
        if (
          cachedPhotoKinds.length !== expectedPhotoKinds.length
          || expectedPhotoKinds.some((kind) => record.current.photos[kind] !== expectedPhotos[kind])
        ) return { valid: false, set: null, banner: null };

        const cachedPhotos = {};
        if (result.action === "show") {
          for (const kind of kinds) {
            const bytes = set.photos[kind];
            if (!isBytes(bytes) || bytes.byteLength > PHOTO_CAP) {
              return { valid: false, set: null, banner: null };
            }
            const checked = await core.checkPhoto(bytes, {
              kind,
              sha256: result.banner.photo.sha256[kind],
              w: result.banner.photo.w,
              h: result.banner.photo.h,
            });
            if (!checked || checked.ok !== true) return { valid: false, set: null, banner: null };
            cachedPhotos[kind] = bytes.slice();
          }
        }
        return {
          valid: true,
          set: {
            signed: set.signed.slice(),
            photos: cachedPhotos,
          },
          banner: result.banner,
        };
      } catch {
        return { valid: false, set: null, banner: null };
      }
    };

    const startup = async () => {
      let record = null;
      try {
        const candidate = await storage.readRecord();
        if (recordFitsCap(candidate) && validRecord(candidate)) record = candidate;
      } catch {
        record = null;
      }
      const stored = await verifyStoredSet(record);
      if (stored.valid) {
        currentSet = stored.set;
        currentBanner = stored.banner;
      } else {
        currentSet = null;
        currentBanner = null;
      }
      await dispatchEvent({ type: "START", record, setValid: stored.valid });
    };

    const controls = {
      shown: () => enqueue(async () => {
        const wasVisible = machine.state().visible;
        if (!wasVisible) await retryRender();
        const mayFetch = await gateWithTimeout();
        await dispatchEvent({ type: "SHOWN", mayFetch });
        if (wasVisible && lastModel !== null) await renderModel(lastModel);
      }),
      hidden: () => enqueue(() => dispatchEvent({ type: "HIDDEN" })),
      pointer: (over) => enqueue(async () => {
        await retryRender();
        await dispatchEvent({ type: "POINTER", over: Boolean(over) });
      }),
      focus: (inside) => enqueue(async () => {
        await retryRender();
        await dispatchEvent({ type: "FOCUS", inside: Boolean(inside) });
      }),
      click: () => enqueue(async () => {
        await retryRender();
        await dispatchEvent({ type: "CLICK" });
      }),
      timerFired: () => enqueue(async () => {
        await retryRender();
        const mayFetch = await gateWithTimeout();
        await dispatchEvent({ type: "TIMER", mayFetch });
      }),
      resumed: () => enqueue(async () => {
        await retryRender();
        const mayFetch = await gateWithTimeout();
        await dispatchEvent({ type: "RESUME", mayFetch });
      }),
      whenIdle,
    };

    void enqueue(startup);
    return controls;
  };

  const api = { run };
  globalThis.GoatBannerFetch = api;
  if (typeof module !== "undefined" && module && module.exports) module.exports = api;
})();
