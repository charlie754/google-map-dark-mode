(function () {
  "use strict";

  const H = 3_600_000;
  const BACKOFF = [6 * H, 6 * H, 12 * H, 24 * H];
  const CHECK = 24 * H;
  const MIN_TIMER_AHEAD = 60_000;

  const clone = (value) => {
    if (Array.isArray(value)) return value.map(clone);
    if (value !== null && typeof value === "object") {
      const copy = {};
      for (const key of Object.keys(value)) copy[key] = clone(value[key]);
      return copy;
    }
    return value;
  };

  const emptyRecord = (floor) => ({
    hwm: floor,
    current: null,
    lastCheckMs: 0,
    failures: 0,
  });

  const create = ({ floor, kinds }) => {
    const clientKinds = kinds.slice();

    let started = false;
    let record = emptyRecord(floor);
    let visible = false;
    let gen = 0;
    let attempting = false;
    let phase = null;
    let pending = null;
    let displayed = { what: "dagoat" };
    let pendingSwap = false;
    let pointerOver = false;
    let focusInside = false;
    let timerAtMs = null;
    let lastMayFetch = false;
    let setVerified = false;
    let nowMs = 0;
    let hwmHigh = floor;

    const showable = () => {
      const current = record.current;
      return current !== null
        && current.enabled
        && current.revision === record.hwm
        && nowMs < current.expiresMs
        && setVerified;
    };

    const desired = () => {
      if (showable()) {
        return {
          what: "online",
          sha256: record.current.sha256,
          expiresMs: record.current.expiresMs,
        };
      }
      return { what: "dagoat" };
    };

    const due = () => (
      nowMs >= record.lastCheckMs + BACKOFF[Math.min(3, record.failures)]
      || record.lastCheckMs > nowMs
    );

    const timerTarget = () => {
      if (!visible) return null;

      const targets = [];
      if (displayed.what === "online") targets.push(displayed.expiresMs);
      if (showable()) targets.push(record.current.expiresMs);

      if (!attempting && lastMayFetch) {
        const lower = nowMs + MIN_TIMER_AHEAD;
        const upper = nowMs + CHECK;
        const check = record.lastCheckMs + CHECK;
        targets.push(Math.min(upper, Math.max(lower, check)));
      }

      return targets.length === 0 ? null : Math.min(...targets);
    };

    const startAttempt = (effects) => {
      gen += 1;
      attempting = true;
      phase = "signed";
      effects.push({ type: "fetch-signed", gen });
    };

    const swapNow = (effects) => {
      const next = desired();
      effects.push({
        type: "display",
        what: next.what,
        immediate: true,
      });
      displayed = next;
      pendingSwap = false;
    };

    const failAttempt = (effects) => {
      record.lastCheckMs = nowMs;
      record.failures = Math.min(3, record.failures + 1);
      hwmHigh = Math.max(hwmHigh, record.hwm);
      attempting = false;
      phase = null;
      pending = null;
      effects.push({ type: "write-record", record: clone(record) });
    };

    const photosFor = (result) => {
      if (result.action === "killswitch") return {};
      const photos = {};
      for (const kind of clientKinds) {
        const hash = result.banner?.photo?.sha256?.[kind];
        if (typeof hash !== "string" || hash.length === 0) return null;
        photos[kind] = hash;
      }
      return photos;
    };

    const preCommit = (result, effects) => {
      const expiresMs = Date.parse(result.banner?.expires);
      const photos = photosFor(result);
      if (!(nowMs < expiresMs) || result.revision < record.hwm || photos === null) {
        failAttempt(effects);
        return;
      }

      pending = {
        result: clone(result),
        expiresMs,
        photos,
      };
      phase = "write-set";
      effects.push({ type: "write-set", gen, sha256: result.sha256 });
    };

    const sameDisplayed = (next) => {
      if (displayed.what !== next.what) return false;
      return next.what !== "online" || displayed.sha256 === next.sha256;
    };

    const reconcileDisplay = (effects) => {
      if (!visible) return;

      const next = desired();
      if (sameDisplayed(next)) {
        pendingSwap = false;
        return;
      }

      if (next.what === "dagoat" && displayed.what === "online") {
        swapNow(effects);
        return;
      }

      if (pointerOver || focusInside) {
        pendingSwap = true;
        return;
      }

      effects.push({ type: "display", what: "online", immediate: false });
      displayed = next;
      pendingSwap = false;
    };

    const reconcileTimer = (effects) => {
      const target = timerTarget();
      if (target === timerAtMs) return;

      if (target === null) effects.push({ type: "disarm-timer" });
      else effects.push({ type: "arm-timer", atMs: target });
      timerAtMs = target;
    };

    const dispatch = (event, eventNowMs) => {
      const effects = [];

      if (!started && event.type !== "START") return effects;

      if (event.type === "START") {
        let nextRecord;
        let recordChanged = false;
        try {
          nextRecord = event.record !== null && typeof event.record === "object"
            ? clone(event.record)
            : emptyRecord(floor);

          if (nextRecord.hwm < floor) {
            nextRecord.hwm = floor;
            recordChanged = true;
          }
          if (
            nextRecord.current !== null
            && !(event.setValid
              && nextRecord.current.revision === nextRecord.hwm
              && eventNowMs < nextRecord.current.expiresMs)
          ) {
            nextRecord.current = null;
            recordChanged = true;
          }
        } catch {
          return effects;
        }

        nowMs = eventNowMs;
        visible = false;
        attempting = false;
        phase = null;
        pending = null;
        displayed = { what: "dagoat" };
        pendingSwap = false;
        pointerOver = false;
        focusInside = false;
        timerAtMs = null;
        lastMayFetch = false;

        started = true;
        record = nextRecord;

        setVerified = record.current !== null;
        hwmHigh = record.hwm;
        if (recordChanged) effects.push({ type: "write-record", record: clone(record) });
        effects.push({ type: "delete-unnamed-sets" });
        return effects;
      }

      nowMs = eventNowMs;
      let expirySwapped = false;

      if (event.type === "TIMER" || event.type === "RESUME") timerAtMs = null;

      if (
        event.type !== "HIDDEN"
        && visible
        && displayed.what === "online"
        && nowMs >= displayed.expiresMs
      ) {
        swapNow(effects);
        expirySwapped = true;
      }

      switch (event.type) {
        case "SHOWN":
          lastMayFetch = event.mayFetch;
          if (!visible) {
            visible = true;
            const next = desired();
            effects.push({ type: "display", what: next.what, immediate: true });
            displayed = next;
          }
          if (!attempting && event.mayFetch && due()) startAttempt(effects);
          break;

        case "HIDDEN":
          if (!visible) break;
          visible = false;
          if (attempting) {
            effects.push({ type: "cancel", gen });
            attempting = false;
            phase = null;
            pending = null;
          }
          pointerOver = false;
          focusInside = false;
          pendingSwap = false;
          break;

        case "SIGNED":
          if (!attempting || event.gen !== gen || phase !== "signed") break;
          if (event.result.action === "reject") failAttempt(effects);
          else if (event.result.action === "killswitch") preCommit(event.result, effects);
          else if (event.result.action === "show") {
            pending = { result: clone(event.result) };
            phase = "photos";
            effects.push({ type: "fetch-photos", gen, kinds: clientKinds.slice() });
          } else failAttempt(effects);
          break;

        case "PHOTOS":
          if (!attempting || event.gen !== gen || phase !== "photos") break;
          if (!event.ok) failAttempt(effects);
          else preCommit(pending.result, effects);
          break;

        case "COMMITTED":
          if (!attempting || event.gen !== gen || phase !== "write-set") break;
          {
            const result = pending.result;
            record = {
              hwm: result.revision,
              current: {
                revision: result.revision,
                sha256: result.sha256,
                enabled: result.action === "show",
                expiresMs: pending.expiresMs,
                photos: clone(pending.photos),
              },
              lastCheckMs: nowMs,
              failures: 0,
            };
            hwmHigh = Math.max(hwmHigh, record.hwm);
            setVerified = true;
            attempting = false;
            phase = null;
            pending = null;
            effects.push({ type: "write-record", record: clone(record) });
          }
          break;

        case "FAILED":
          if (attempting && event.gen === gen) failAttempt(effects);
          break;

        case "TIMER":
        case "RESUME":
          if (!visible) break;
          lastMayFetch = event.mayFetch;
          if (!attempting && event.mayFetch && due()) startAttempt(effects);
          break;

        case "CLICK":
          if (!visible || expirySwapped) break;
          effects.push({ type: "open-link" });
          break;

        case "POINTER":
          if (!visible) break;
          pointerOver = event.over;
          break;

        case "FOCUS":
          if (!visible) break;
          focusInside = event.inside;
          break;

        default:
          break;
      }

      reconcileDisplay(effects);
      reconcileTimer(effects);
      return effects;
    };

    const state = () => ({
      record: clone(record),
      visible,
      gen,
      attempting,
      shown: displayed.what,
      pendingSwap,
      floor,
      timerAtMs,
    });

    const checkInvariants = () => {
      const broken = [];
      const desiredNow = desired();

      if (record.hwm < floor) broken.push("record hwm below floor");
      if (record.hwm < hwmHigh) broken.push("record hwm below high-water mark");
      if (visible && displayed.what === "online" && !(nowMs < displayed.expiresMs && showable())) {
        broken.push("visible online display is not showable");
      }
      if (!visible && attempting) {
        broken.push("hidden machine is attempting");
      }
      if (timerAtMs !== null && !visible) broken.push("timer is armed while hidden");
      if (visible && !attempting && lastMayFetch && (timerAtMs === null || timerAtMs > nowMs + CHECK)) {
        broken.push("visible idle fetch gate has no valid timer");
      }
      if (pendingSwap && (!visible || (!pointerOver && !focusInside) || desiredNow.what !== "online")) {
        broken.push("pending swap lacks an active hold or online target");
      }
      if (record.failures < 0 || record.failures > 3) broken.push("failure count out of range");
      if (attempting !== (phase !== null)) broken.push("attempting and phase disagree");
      if (visible && !pendingSwap && !sameDisplayed(desiredNow)) {
        broken.push("displayed value differs from desired");
      }
      if (visible && !attempting && lastMayFetch && timerAtMs !== null) {
        const expiryTargets = [nowMs + MIN_TIMER_AHEAD];
        if (displayed.what === "online") expiryTargets.push(displayed.expiresMs);
        if (showable()) expiryTargets.push(record.current.expiresMs);
        if (timerAtMs < Math.min(...expiryTargets)) {
          broken.push("timer is earlier than its expiry lower bound");
        }
      }
      if (!visible && (pointerOver || focusInside)) {
        broken.push("hidden machine has an active hold");
      }
      return broken;
    };

    return { dispatch, state, checkInvariants };
  };

  const api = { create };
  globalThis.GoatBannerMachine = api;
  if (typeof module !== "undefined" && module && module.exports) module.exports = api;
})();
