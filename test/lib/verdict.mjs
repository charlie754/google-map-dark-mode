/**
 * A1/A2/A3 and their inverses.
 *
 * The control run is not a formality. If a run with no extension loaded still
 * satisfies A2 and A3, then A2 and A3 are not measuring the extension and the
 * whole gate is void. `voidGate` carries that finding.
 */

const DARK = 'RoadmapDark';

/** A1 -- gestures produced base-map tile requests at >= 3 distinct zoom levels. */
export function a1(result) {
  const zooms = result.requests?.distinctZoomsTerminal ?? [];
  return {
    id: 'A1',
    claim: 'base-map tiles requested at >= 3 distinct zoom levels',
    pass: zooms.length >= 3,
    observed: `${zooms.length} distinct zoom levels: [${zooms.join(', ')}]`,
    numbers: { distinctZooms: zooms },
  };
}

/** A2 -- every base-map tile actually fetched carries the dark style token. */
export function a2(result) {
  const s = result.requests ?? {};
  const counts = s.tokenCountsTerminal ?? {};
  const total = s.baseMapTileRequestsTerminal ?? 0;
  const dark = counts[DARK] ?? 0;
  const offenders = s.offenders ?? [];
  return {
    id: 'A2',
    claim: `100% of base-map tile requests carry style token ${DARK}`,
    pass: total > 0 && dark === total && offenders.length === 0,
    observed:
      `${dark}/${total} terminal base-map tiles are ${DARK}; ` +
      `token breakdown ${JSON.stringify(counts)}; ` +
      `${s.baseMapTileRequestsSuperseded ?? 0} raw requests superseded by redirect ` +
      `(${JSON.stringify(s.supersedeReasons ?? {})})`,
    numbers: {
      terminalBaseTiles: total,
      darkTiles: dark,
      tokenCountsTerminal: counts,
      tokenCountsRaw: s.tokenCountsRaw ?? {},
      offenderCount: offenders.length,
    },
    offenders: offenders.slice(0, 10),
  };
}

/** A3 -- every map-area screenshot is dark. */
export function a3(result) {
  const rows = (result.phases ?? []).map((p) => ({
    phase: p.phase,
    rgb: [p.pixels.r, p.pixels.g, p.pixels.b],
    luminance: p.pixels.luminance,
    distToDarkRef: p.pixels.distToDarkRef,
    distToLightRef: p.pixels.distToLightRef,
    isDark: p.pixels.isDark,
  }));
  return {
    id: 'A3',
    claim: 'mean RGB of every map-area screenshot is dark (lum < 100 and clearly nearer (38,57,77))',
    pass: rows.length > 0 && rows.every((r) => r.isDark),
    observed: rows
      .map(
        (r) =>
          `${r.phase}=(${r.rgb.join(', ')}) lum=${r.luminance} dDark=${r.distToDarkRef} dLight=${r.distToLightRef} ${r.isDark ? 'DARK' : 'not-dark'}`
      )
      .join(' | '),
    numbers: { phases: rows },
  };
}

/** A2-inverse -- the control must have fetched zero dark tiles. */
export function a2Control(result) {
  const s = result.requests ?? {};
  const counts = s.tokenCountsTerminal ?? {};
  const dark = counts[DARK] ?? 0;
  const total = s.baseMapTileRequestsTerminal ?? 0;
  return {
    id: 'A2-inv',
    claim: `control: ZERO base-map tiles carry ${DARK}`,
    pass: total > 0 && dark === 0,
    observed: `${dark}/${total} terminal base-map tiles are ${DARK}; token breakdown ${JSON.stringify(counts)}`,
    numbers: { terminalBaseTiles: total, darkTiles: dark, tokenCountsTerminal: counts },
  };
}

/** A3-inverse -- the control must be visibly light. */
export function a3Control(result) {
  const rows = (result.phases ?? []).map((p) => ({
    phase: p.phase,
    rgb: [p.pixels.r, p.pixels.g, p.pixels.b],
    luminance: p.pixels.luminance,
    distToDarkRef: p.pixels.distToDarkRef,
    distToLightRef: p.pixels.distToLightRef,
    isLight: p.pixels.isLight,
    isDark: p.pixels.isDark,
  }));
  return {
    id: 'A3-inv',
    claim: 'control: mean RGB of every map-area screenshot is light',
    pass: rows.length > 0 && rows.every((r) => r.isLight),
    observed: rows
      .map(
        (r) =>
          `${r.phase}=(${r.rgb.join(', ')}) lum=${r.luminance} dDark=${r.distToDarkRef} dLight=${r.distToLightRef} ${r.isLight ? 'LIGHT' : r.isDark ? 'DARK' : 'AMBIGUOUS'}`
      )
      .join(' | '),
    numbers: { phases: rows },
  };
}

/**
 * Build the verdict set for a run.
 * `expect` is 'dark' (extension loaded) or 'light' (control).
 */
export function verdicts(result, expectation) {
  if (expectation === 'light') {
    const list = [a1(result), a2Control(result), a3Control(result)];
    // If the control would ALSO satisfy the positive assertions, the gate is void.
    const posA2 = a2(result);
    const posA3 = a3(result);
    return {
      expectation,
      list,
      voidGate: posA2.pass && posA3.pass,
      voidDetail: `control run against positive assertions: A2=${posA2.pass ? 'PASS' : 'fail'} A3=${posA3.pass ? 'PASS' : 'fail'} (both PASS would mean the assertions do not measure the extension)`,
      pass: list.every((v) => v.pass),
    };
  }
  const list = [a1(result), a2(result), a3(result)];
  return { expectation, list, voidGate: false, pass: list.every((v) => v.pass) };
}

export function renderVerdicts(v) {
  const out = [];
  for (const a of v.list) {
    out.push(`  ${a.pass ? 'PASS' : 'FAIL'}  ${a.id}  ${a.claim}`);
    out.push(`        observed: ${a.observed}`);
    if (a.offenders?.length) {
      const show = a.offenders.slice(0, 4);
      out.push(
        `        offending URLs (${show.length} of ${a.numbers?.offenderCount ?? a.offenders.length}; ` +
          'truncated for reading, full URLs in test/artifacts/result-*.json):'
      );
      for (const o of show) {
        const u = o.url.length > 180 ? `${o.url.slice(0, 180)}...[${o.url.length} chars]` : o.url;
        out.push(`          [${o.kind ?? '?'} ${o.token} z${o.zoom} ${o.phase}] ${u}`);
      }
    }
  }
  if (v.voidDetail) out.push(`  ${v.voidDetail}`);
  return out.join('\n');
}
