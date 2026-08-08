/**
 * A1-A5 for the sustained-interaction gate, plus their inverses for the
 * mutation control, plus the void check.
 *
 * The control is not a formality. If a run with NO extension loaded still
 * satisfies A2/A3/A4, then those assertions are not measuring the extension and
 * every pass this suite has ever produced is meaningless. `voidGate` carries
 * that finding and the runner refuses to report a pass when it fires.
 */

/** Chrome (the app UI, not the map) is a flat surface, so it is judged on
 * luminance alone -- the map-validity gate in image.mjs is calibrated for
 * cartography and would call a legitimately flat white panel "degenerate". */
export const CHROME_DARK_MAX_LUM = 100;
export const CHROME_LIGHT_MIN_LUM = 150;

/** A1 -- gestures produced base-map tile requests at >= 4 distinct zoom levels. */
export function a1(result) {
  const zooms = result.requests?.distinctZooms ?? [];
  return {
    id: 'A1',
    claim: 'base-map tiles requested at >= 4 distinct zoom levels',
    pass: zooms.length >= 4,
    observed: `${zooms.length} distinct zoom levels: [${zooms.join(', ')}]`,
    numbers: { distinctZooms: zooms },
  };
}

/**
 * A2 -- every REWRITABLE base-map request carries a dark style token.
 *
 * "Rewritable" excludes the /maps/vt/proto?bpb= transport, whose style token is
 * a length-prefixed protobuf string that no regexSubstitution can rewrite (see
 * test/lib/transport.mjs). Proto counts are reported next to the verdict, never
 * merged into it.
 */
export function a2(result) {
  const s = result.requests ?? {};
  const total = s.rewritableTerminal ?? 0;
  const dark = s.rewritableDark ?? 0;
  const offenders = s.offenders ?? [];
  const per = s.byTransport ?? {};
  const line = (t) =>
    `${t}: ${per[t]?.baseMapTerminal ?? 0} terminal base-map (` +
    `${JSON.stringify(per[t]?.tokensTerminal ?? {})})`;
  return {
    id: 'A2',
    claim: '100% of rewritable base-map requests carry a dark style token',
    pass: total > 0 && dark === total && offenders.length === 0,
    observed:
      `${dark}/${total} rewritable terminal base-map requests are dark; ` +
      `${['legend', 'stream', 'raster', 'proto'].map(line).join(' | ')}; ` +
      `non-rewritable (proto) terminal base-map requests: ${s.nonRewritableTerminal ?? 0}`,
    numbers: {
      rewritableTerminal: total,
      rewritableDark: dark,
      nonRewritableTerminal: s.nonRewritableTerminal ?? 0,
      byTransport: per,
      offenderCount: offenders.length,
    },
    offenders: offenders.slice(0, 10),
  };
}

/**
 * A3 -- the map area is dark at EVERY sample in the time series.
 *
 * Reported three ways, because the honest answer needs all three:
 *   A3        every sample is DARK (the literal gate)
 *   A3-nolight  no sample is LIGHT  (what "no overpaint happened" really means)
 *   A3-settled  every sample from the first rendered frame onward is DARK
 * A pre-paint blank canvas is INVALID, not dark and not light: image.mjs was
 * fixed so a dead canvas can no longer score DARK. That fix means the earliest
 * time-series frames can legitimately be neither, which A3-settled accounts for
 * and A3 does not.
 */
export function a3(result) {
  const rows = (result.samples ?? []).map((s) => ({
    sample: s.sample,
    atMsFromNav: s.atMsFromNav,
    rgb: [s.pixels.r, s.pixels.g, s.pixels.b],
    luminance: s.pixels.luminance,
    stdev: s.pixels.stdev,
    distinctColours: s.pixels.distinctColours,
    verdict: s.verdict,
    isDark: s.pixels.isDark,
    isLight: s.pixels.isLight,
    valid: s.pixels.valid,
  }));
  const firstValid = rows.findIndex((r) => r.valid);
  const fromFirstValid = firstValid < 0 ? [] : rows.slice(firstValid);
  const brief = rows
    .map((r) => `${r.sample}@${r.atMsFromNav}ms=(${r.rgb.join(',')}) lum=${r.luminance} ${r.verdict}`)
    .join(' | ');
  return {
    id: 'A3',
    claim: 'map-area mean RGB is DARK at every sample in the time series',
    pass: rows.length > 0 && rows.every((r) => r.isDark),
    observed: `${rows.filter((r) => r.isDark).length}/${rows.length} samples DARK; ${brief}`,
    numbers: { samples: rows, firstValidIndex: firstValid },
    companions: [
      {
        id: 'A3-nolight',
        claim: 'no sample in the time series is LIGHT',
        pass: rows.length > 0 && rows.every((r) => !r.isLight),
        observed: `${rows.filter((r) => r.isLight).length} LIGHT samples: [${rows
          .filter((r) => r.isLight)
          .map((r) => `${r.sample}@${r.atMsFromNav}ms lum=${r.luminance}`)
          .join(', ')}]`,
      },
      {
        id: 'A3-settled',
        claim: 'every sample from the first rendered frame onward is DARK',
        pass: fromFirstValid.length > 0 && fromFirstValid.every((r) => r.isDark),
        observed:
          firstValid < 0
            ? 'no sample was a rendered map at all'
            : `first rendered frame: ${rows[firstValid].sample}@${rows[firstValid].atMsFromNav}ms; ` +
              `${fromFirstValid.filter((r) => r.isDark).length}/${fromFirstValid.length} DARK from there on` +
              (fromFirstValid.some((r) => !r.isDark)
                ? `; not-dark: [${fromFirstValid
                    .filter((r) => !r.isDark)
                    .map((r) => `${r.sample}=${r.verdict}(lum ${r.luminance})`)
                    .join(', ')}]`
                : ''),
      },
    ],
  };
}

/**
 * The URL shapes every run must have visited.
 *
 * Kept as a hard list rather than derived from whatever the session happened to
 * navigate: if a future edit drops a navigation, the assertion has to FAIL, and
 * an assertion that iterates over what was collected can only ever pass.
 */
export const REQUIRED_URL_SHAPES = ['coords', 'bare', 'query'];

/** Chrome samples grouped by the URL shape their phase belongs to. */
function chromeRowsByShape(rows) {
  const out = {};
  for (const id of REQUIRED_URL_SHAPES) {
    out[id] = rows.filter((r) => (id === 'coords' ? !r.phase.startsWith('url-') : r.phase === `url-${id}`));
  }
  return out;
}

/**
 * A4 -- the app chrome is dark, on EVERY URL shape.
 *
 * The companion is not decoration. An adversarial review found the content
 * script never injecting on `/maps` and `/maps?q=…`, and the reason it survived
 * every previous gate is that the gate only ever navigated to `/maps/@lat,lng,z`.
 * A4 on its own would go green again the moment someone removed those
 * navigations, because it can only judge the samples it is given. A4-shapes
 * fails when a shape is MISSING, which is the failure mode that actually
 * happened.
 */
export function a4(result) {
  const rows = (result.chromeSamples ?? []).map((s) => ({
    region: s.region,
    phase: s.phase,
    rgb: [s.pixels.r, s.pixels.g, s.pixels.b],
    luminance: s.pixels.luminance,
    dark: s.pixels.luminance < CHROME_DARK_MAX_LUM,
    light: s.pixels.luminance >= CHROME_LIGHT_MIN_LUM,
  }));
  const byShape = chromeRowsByShape(rows);
  const missing = REQUIRED_URL_SHAPES.filter((id) => byShape[id].length === 0);
  const notDark = REQUIRED_URL_SHAPES.filter((id) => byShape[id].length > 0 && !byShape[id].every((r) => r.dark));
  return {
    id: 'A4',
    claim: `app chrome (search box + left rail) is dark (mean luminance < ${CHROME_DARK_MAX_LUM})`,
    pass: rows.length > 0 && rows.every((r) => r.dark),
    observed: rows
      .map((r) => `${r.region}@${r.phase}=(${r.rgb.join(',')}) lum=${r.luminance} ${r.dark ? 'dark' : r.light ? 'LIGHT' : 'mid'}`)
      .join(' | '),
    numbers: { regions: rows, byShape },
    companions: [
      {
        id: 'A4-shapes',
        claim: `app chrome sampled and dark on every required URL shape [${REQUIRED_URL_SHAPES.join(', ')}]`,
        pass: missing.length === 0 && notDark.length === 0,
        observed:
          REQUIRED_URL_SHAPES.map(
            (id) =>
              `${id}: ${byShape[id].length} sample(s)` +
              (byShape[id].length
                ? ` min lum ${Math.min(...byShape[id].map((r) => r.luminance))} max lum ${Math.max(
                    ...byShape[id].map((r) => r.luminance)
                  )}`
                : ' -- NOT SAMPLED')
          ).join(' | ') +
          (missing.length ? `; MISSING SHAPES: ${missing.join(', ')}` : '') +
          (notDark.length ? `; NOT DARK: ${notDark.join(', ')}` : ''),
      },
    ],
  };
}

/**
 * Is this console/page error the extension's fault?
 *
 * Live Google Maps logs errors of its own constantly, so attribution has to be
 * by origin: anything raised from a chrome-extension:// or moz-extension://
 * URL, or carrying the extension's own log prefix, is ours. Everything else is
 * counted and reported but does not fail A5 -- and the control run's error set
 * is printed beside it so a reader can see the baseline.
 *
 * The literal below is `LOG_PREFIX` in `extension/background.js`. Changing one
 * without the other silently narrows A5 to the origin clauses, so they move
 * together.
 */
export function attributableToExtension(entry, extensionOrigins) {
  const hay = `${entry.text ?? ''} ${entry.url ?? ''} ${entry.message ?? ''} ${entry.stack ?? ''}`;
  if (/\[google-map-dark-mode\]/.test(hay)) return true;
  if (/chrome-extension:\/\/|moz-extension:\/\//.test(hay)) return true;
  for (const o of extensionOrigins ?? []) {
    if (o && hay.includes(o)) return true;
  }
  if (/theme\.js|background\.js/.test(entry.url ?? '')) return true;
  return false;
}

/**
 * A5 -- no console or page errors attributable to the extension.
 *
 * Measured fact that makes this assertion dangerous: live Google Maps emits ZERO
 * console messages of any type in this Chromium. So "0 errors" is exactly what a
 * DEAD listener would also report, and a green A5 would be indistinguishable
 * from a harness that never attached one. The session therefore emits a
 * deliberate console.error and a deliberate uncaught throw at the end, and A5
 * FAILS if neither is observed. A check that cannot fail is worth nothing.
 */
export function a5(result) {
  const origins = [];
  if (result.extensionId) origins.push(`chrome-extension://${result.extensionId}`);
  if (result.mozExtensionUuid) origins.push(`moz-extension://${result.mozExtensionUuid}`);
  const con = (result.consoleErrors ?? []).filter((e) => attributableToExtension(e, origins));
  const pag = (result.pageErrors ?? []).filter((e) => attributableToExtension(e, origins));
  const mine = [...con, ...pag];
  const proof = result.listenerProof ?? {};
  const listenersProven = proof.consoleProbeSeen === true && proof.pageErrorProbeSeen === true;
  return {
    id: 'A5',
    claim: 'no console errors or page errors attributable to the extension (with the listeners proven live)',
    pass: mine.length === 0 && listenersProven,
    observed:
      `${mine.length} extension-attributable (of ${(result.consoleErrors ?? []).length} console errors + ` +
      `${(result.pageErrors ?? []).length} page errors total, origins ${JSON.stringify(origins)}); ` +
      `listener proof: console probe seen=${proof.consoleProbeSeen} pageerror probe seen=${proof.pageErrorProbeSeen} ` +
      `(console messages of any type during the whole session: ${proof.consoleMessagesAnyType})` +
      (listenersProven ? '' : ' -- LISTENERS NOT PROVEN, so a zero count here means nothing') +
      (mine.length ? `: ${mine.map((e) => (e.text ?? e.message ?? '').slice(0, 160)).join(' || ')}` : ''),
    numbers: {
      attributable: mine.slice(0, 10),
      totalConsoleErrors: (result.consoleErrors ?? []).length,
      totalPageErrors: (result.pageErrors ?? []).length,
      listenerProof: proof,
      requestFailures: (result.requestFailures ?? []).length,
      sampleOtherConsoleErrors: (result.consoleErrors ?? [])
        .filter((e) => !attributableToExtension(e, origins))
        .slice(0, 5)
        .map((e) => (e.text ?? '').slice(0, 160)),
    },
  };
}

/**
 * A6 -- the content script was injected on every URL shape.
 *
 * ---------------------------------------------------------------------------
 * THE BUG THIS ASSERTION EXISTS FOR
 * ---------------------------------------------------------------------------
 * `https://www.google.com/maps` (bare) and `https://www.google.com/maps?q=…`
 * did not match the manifest's content-script patterns. The app chrome stayed
 * light on both, in both browsers, and no gate noticed for the length of the
 * project -- because the gate navigated to `/maps/@lat,lng,z` and nothing else,
 * and that is the one shape that matched in both engines.
 *
 * A4 measures pixels, which is the effect. This measures the CAUSE: `theme.js`
 * writes `data-mapsnoir` onto <html> itself, nothing on Google's side does, so
 * the attribute's presence says the script ran in THIS document. The two are
 * kept separate deliberately -- a dark rail could conceivably come from
 * somewhere else, an attribute with our name on it could not, and the inverse
 * below turns that from an argument into a measurement.
 *
 * `serverRedirects` is reported for every shape because it is what could make
 * this vacuous: if Google 30x-redirected `/maps` to `/maps/@…` before the
 * document existed, the content script would have been matched against the
 * destination and this would prove nothing about the bare shape. The chain is in
 * the observed text so a reader can check rather than assume.
 */
export function a6(result) {
  const shapes = result.urlShapes ?? [];
  const missing = REQUIRED_URL_SHAPES.filter((id) => !shapes.some((s) => s.id === id));
  const injected = shapes.filter((s) => s.marker === 'on');
  const brief = shapes
    .map(
      (s) =>
        `${s.id}: ${s.requested} -> ${s.landed} data-mapsnoir=${JSON.stringify(s.marker)}` +
        (s.serverRedirects?.length > 1 ? ` [SERVER REDIRECT CHAIN ${s.serverRedirects.join(' -> ')}]` : '') +
        (s.error ? ` ERROR ${s.error}` : '')
    )
    .join(' | ');
  return {
    id: 'A6',
    claim: `the content script injected on every URL shape [${REQUIRED_URL_SHAPES.join(', ')}]`,
    pass: missing.length === 0 && shapes.length > 0 && shapes.every((s) => s.marker === 'on'),
    observed:
      `${injected.length}/${shapes.length} shapes carry data-mapsnoir="on"` +
      (missing.length ? `; SHAPES NEVER NAVIGATED: ${missing.join(', ')}` : '') +
      `; ${brief}`,
    numbers: { shapes, missing },
  };
}

/* ------------------------------------------------------------- inverses --- */

export function a2Inverse(result) {
  const s = result.requests ?? {};
  const total = s.rewritableTerminal ?? 0;
  const dark = s.rewritableDark ?? 0;
  return {
    id: 'A2-inv',
    claim: 'control: ZERO rewritable base-map requests carry a dark token',
    pass: total > 0 && dark === 0,
    observed:
      `${dark}/${total} rewritable terminal base-map requests are dark; ` +
      `tokens ${JSON.stringify(
        Object.fromEntries(
          ['legend', 'stream', 'raster', 'proto'].map((t) => [t, s.byTransport?.[t]?.tokensTerminal ?? {}])
        )
      )}`,
    numbers: { rewritableTerminal: total, rewritableDark: dark },
  };
}

export function a3Inverse(result) {
  const rows = (result.samples ?? []).map((s) => ({
    sample: s.sample,
    atMsFromNav: s.atMsFromNav,
    rgb: [s.pixels.r, s.pixels.g, s.pixels.b],
    luminance: s.pixels.luminance,
    verdict: s.verdict,
    isLight: s.pixels.isLight,
    isDark: s.pixels.isDark,
    valid: s.pixels.valid,
  }));
  const valid = rows.filter((r) => r.valid);
  return {
    id: 'A3-inv',
    claim: 'control: no rendered sample is DARK (the map stays light without the extension)',
    pass: valid.length > 0 && valid.every((r) => r.isLight) && rows.every((r) => !r.isDark),
    observed:
      `${valid.filter((r) => r.isLight).length}/${valid.length} rendered samples LIGHT, ` +
      `${rows.filter((r) => r.isDark).length} DARK; ` +
      rows
        .map((r) => `${r.sample}@${r.atMsFromNav}ms=(${r.rgb.join(',')}) lum=${r.luminance} ${r.verdict}`)
        .join(' | '),
    numbers: { samples: rows },
  };
}

export function a4Inverse(result) {
  const rows = (result.chromeSamples ?? []).map((s) => ({
    region: s.region,
    phase: s.phase,
    rgb: [s.pixels.r, s.pixels.g, s.pixels.b],
    luminance: s.pixels.luminance,
    light: s.pixels.luminance >= CHROME_LIGHT_MIN_LUM,
    dark: s.pixels.luminance < CHROME_DARK_MAX_LUM,
  }));
  const byShape = chromeRowsByShape(rows);
  const missing = REQUIRED_URL_SHAPES.filter((id) => byShape[id].length === 0);
  return {
    id: 'A4-inv',
    claim: 'control: app chrome is light',
    pass: rows.length > 0 && rows.every((r) => r.light),
    observed: rows
      .map((r) => `${r.region}@${r.phase}=(${r.rgb.join(',')}) lum=${r.luminance} ${r.light ? 'light' : r.dark ? 'DARK' : 'mid'}`)
      .join(' | '),
    numbers: { regions: rows, byShape },
    companions: [
      {
        // The control has to visit the same shapes, or A4-shapes on the
        // treatment run is being compared against nothing.
        id: 'A4-shapes-inv',
        claim: `control: app chrome sampled and LIGHT on every required URL shape [${REQUIRED_URL_SHAPES.join(', ')}]`,
        pass: missing.length === 0 && REQUIRED_URL_SHAPES.every((id) => byShape[id].every((r) => r.light)),
        observed:
          REQUIRED_URL_SHAPES.map(
            (id) =>
              `${id}: ${byShape[id].length} sample(s)` +
              (byShape[id].length
                ? ` min lum ${Math.min(...byShape[id].map((r) => r.luminance))}`
                : ' -- NOT SAMPLED')
          ).join(' | ') + (missing.length ? `; MISSING SHAPES: ${missing.join(', ')}` : ''),
      },
    ],
  };
}

/**
 * A6 inverse -- with no extension, no document carries the marker at all.
 *
 * This is what turns A6 from an argument into a measurement: if a control run
 * ALSO reported `data-mapsnoir` on every shape, the attribute would not be
 * evidence of our content script and A6 would be measuring nothing.
 */
export function a6Inverse(result) {
  const shapes = result.urlShapes ?? [];
  const missing = REQUIRED_URL_SHAPES.filter((id) => !shapes.some((s) => s.id === id));
  return {
    id: 'A6-inv',
    claim: 'control: no URL shape carries the content script marker',
    pass: missing.length === 0 && shapes.length > 0 && shapes.every((s) => s.marker === null),
    observed:
      shapes
        .map((s) => `${s.id}: ${s.requested} -> ${s.landed} data-mapsnoir=${JSON.stringify(s.marker)}`)
        .join(' | ') + (missing.length ? `; SHAPES NEVER NAVIGATED: ${missing.join(', ')}` : ''),
    numbers: { shapes, missing },
  };
}

/* ------------------------------------------------------------- assembly --- */

export function verdicts(result, expectation) {
  if (expectation === 'light') {
    const list = [
      a1(result),
      a2Inverse(result),
      a3Inverse(result),
      a4Inverse(result),
      a5(result),
      a6Inverse(result),
    ];
    const posA2 = a2(result);
    const posA3 = a3(result);
    const posA4 = a4(result);
    const posA6 = a6(result);
    const voidGate = posA2.pass || posA3.pass || posA4.pass || posA6.pass;
    return {
      expectation,
      list,
      companions: list.flatMap((v) => v.companions ?? []),
      voidGate,
      voidDetail:
        `control run scored against the POSITIVE assertions: A2=${posA2.pass ? 'PASS' : 'fail'} ` +
        `A3=${posA3.pass ? 'PASS' : 'fail'} A4=${posA4.pass ? 'PASS' : 'fail'} ` +
        `A6=${posA6.pass ? 'PASS' : 'fail'}. ` +
        'Any PASS here means that assertion does not measure the extension.',
      positives: { A2: posA2, A3: posA3, A4: posA4, A6: posA6 },
      pass: list.every((v) => v.pass),
    };
  }
  const A3 = a3(result);
  const list = [a1(result), a2(result), A3, a4(result), a5(result), a6(result)];
  return {
    expectation,
    list,
    companions: list.flatMap((v) => v.companions ?? []),
    voidGate: false,
    pass: list.every((v) => v.pass),
  };
}

export function renderVerdicts(v) {
  const out = [];
  for (const a of v.list) {
    out.push(`  ${a.pass ? 'PASS' : 'FAIL'}  ${a.id}  ${a.claim}`);
    out.push(`        observed: ${a.observed}`);
    for (const c of a.companions ?? []) {
      out.push(`        ${c.pass ? 'pass' : 'FAIL'}  ${c.id}  ${c.claim}`);
      out.push(`              ${c.observed}`);
    }
    if (a.offenders?.length) {
      out.push(`        offending URLs (${a.offenders.length} of ${a.numbers?.offenderCount}):`);
      for (const o of a.offenders.slice(0, 4)) {
        const u = o.url.length > 170 ? `${o.url.slice(0, 170)}...[${o.url.length} chars]` : o.url;
        out.push(`          [${o.transport} ${o.token} z${o.zoom} ${o.phase} ${o.status}] ${u}`);
      }
    }
  }
  if (v.voidDetail) out.push(`  ${v.voidDetail}`);
  return out.join('\n');
}
