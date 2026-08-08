/**
 * Records every request the extension's rules could touch, tags it with the
 * gesture phase in flight, and resolves redirect chains afterwards.
 *
 * Why redirect resolution matters (unchanged from test/lib/recorder.mjs, which
 * this replaces for the four-transport world): a declarativeNetRequest
 * `redirect` action is a real network-stack redirect, so the browser emits TWO
 * request events per rewritten resource -- the original `Roadmap` URL and the
 * `RoadmapDark` one. Counting raw events would make "100% of base-map requests
 * carry the dark token" impossible to pass even when the rewrite works
 * perfectly. Assertions run on the TERMINAL url of each chain, the one Google
 * actually served.
 *
 * Three independent supersede signals, and which one fired is reported:
 *   1. request.redirectedTo() is non-null   (Playwright saw the chain)
 *   2. response status is 3xx               (the network stack saw the chain)
 *   3. the dark twin of the exact same URL was also requested
 * Signal 3 is the weakest and only reachable when 1 and 2 are both blind. A
 * light URL with no dark twin is never excused.
 */

import { classifyRequest, isInteresting, DARK_OF } from './transport.mjs';

/** The URL this one becomes after the extension's rewrite, or null. */
export function darkTwinOf(url, c) {
  if (!c || c.dark !== false || !c.token) return null;
  const dark = DARK_OF[c.token];
  if (!dark) return null;
  if (c.transport === 'legend') return url.replace(`CompactLegend-${c.token}-`, `CompactLegend-${dark}-`);
  if (c.transport === 'raster' || c.transport === 'stream') {
    return url.replace(`!1sset!2s${c.token}!`, `!1sset!2s${dark}!`);
  }
  return null;
}

export class SessionRecorder {
  constructor() {
    this.records = [];
    this.phase = 'boot';
    this.lastAt = 0;
    this.startedAt = Date.now();
  }

  setPhase(phase) {
    this.phase = phase;
  }

  attach(context) {
    context.on('request', (req) => {
      let url;
      try {
        url = req.url();
      } catch {
        return;
      }
      if (!isInteresting(url)) return;
      this.lastAt = Date.now();
      let redirectedFromUrl = null;
      try {
        redirectedFromUrl = req.redirectedFrom()?.url() ?? null;
      } catch {
        /* ignore */
      }
      this.records.push({
        req,
        url,
        phase: this.phase,
        at: Date.now() - this.startedAt,
        resourceType: safe(() => req.resourceType()),
        redirectedFromUrl,
      });
    });
  }

  /** Count of recorded events so far -- used by the settle loop. */
  get count() {
    return this.records.length;
  }

  /** Resolve responses, classify, and mark superseded rows. Call after the run. */
  async analyse() {
    await Promise.all(
      this.records.map(async (r) => {
        try {
          const resp = await withTimeout(r.req.response(), 4000);
          r.status = resp ? resp.status() : null;
        } catch {
          r.status = null;
        }
      })
    );

    const all = this.records.map((r) => ({
      url: r.url,
      phase: r.phase,
      at: r.at,
      status: r.status ?? null,
      resourceType: r.resourceType,
      redirectedFromUrl: r.redirectedFromUrl,
      redirectedTo: safe(() => r.req.redirectedTo()?.url() ?? null),
      c: classifyRequest(r.url),
    }));

    const darkSeen = new Set(all.filter((r) => r.c.dark === true).map((r) => r.url));

    for (const r of all) {
      r.supersededBy = null;
      if (r.redirectedTo) r.supersededBy = 'playwright-redirect-chain';
      else if (r.status !== null && r.status >= 300 && r.status < 400) r.supersededBy = `http-${r.status}`;
      else if (r.c.dark === false) {
        const twin = darkTwinOf(r.url, r.c);
        if (twin && darkSeen.has(twin)) r.supersededBy = 'dark-twin-requested';
      }
      r.terminal = r.supersededBy === null;
    }
    return all;
  }
}

function safe(fn) {
  try {
    return fn();
  } catch {
    return null;
  }
}

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
  ]);
}
