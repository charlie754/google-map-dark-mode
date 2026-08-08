/**
 * The app-chrome theme layer, under test for the first time.
 *
 * The review that opened these findings said it plainly: "No theme-layer test
 * exists. `test/` covers tiles, rules, images, and the live gate; nothing reads
 * `data-mapsnoir-stats` or exercises `pass()`. F2 and F4 both went undetected
 * for this reason." This file is that layer.
 *
 * SHAPE
 * -----
 * Every finding gets two tests: the assertion, and a MUTATION CONTROL that
 * reverses the one expression the review named and requires the same assertion
 * to fail. A test that cannot fail is not evidence, and the defects here are
 * exactly the kind that a green-by-construction test would have missed --
 * `palettesLooksDark([])` returning false is, after all, technically correct.
 *
 * Run:  node --test test/checks/theme.test.mjs
 *
 * NOT part of `npm test`: that script is the offline, no-browser suite and this
 * one launches Playwright's bundled Chromium. It needs no network.
 */

import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';

import {
  launchBrowser,
  openFixture,
  closePage,
  themeSource,
  lightPalette,
  darkPalette,
  marginalDarkPalette,
  thinDarkPalette,
  readStats,
  waitForQuiet,
  tokenValues,
  paintedColours,
  addSheet,
  runPass,
  overrides,
  changeSettings,
  releaseStorage,
  attribute,
  elementMeanRgb,
  relativeLuminance,
  contrastRatio,
} from '../fixtures/theme-harness.mjs';
import { mutate } from '../fixtures/theme-mutants.mjs';

let browser;

before(async () => { browser = await launchBrowser(); });
after(async () => { if (browser) await browser.close(); });

/**
 * Run a test body against a mutant and require it to fail *as an assertion*.
 *
 * The distinction matters: a mutant that crashes the page, or that makes the
 * harness time out for an unrelated reason, is not evidence that the assertion
 * detects the defect. Only a failed assertion is.
 *
 * @param {string} name  mutant id from theme-mutants.mjs
 * @param {(source: string) => Promise<void>} body
 */
async function mutationControl(name, body) {
  const source = mutate(themeSource(), name);
  let caught = null;
  try {
    await body(source);
  } catch (err) {
    caught = err;
  }
  assert.ok(
    caught,
    `mutation control "${name}" PASSED. The assertion does not detect the defect it claims to.`
  );
  assert.ok(
    caught instanceof assert.AssertionError,
    `mutation control "${name}" failed, but not by assertion: ${caught && caught.message}`
  );
  return caught.message.split('\n')[0];
}

function noPageErrors(page) {
  assert.deepEqual(page.__errors, [], 'the page logged errors');
}

/* =========================================================================
 * 0. Baseline -- the theme still does its job
 * ========================================================================= */

test('a conventional light palette is themed, and the ramp lands where the review measured', async () => {
  const page = await openFixture(browser, { tokens: lightPalette() });
  try {
    const stats = await waitForQuiet(page);
    assert.equal(stats.state, 'settled');
    assert.ok(stats.tokensFound >= 36, `tokensFound=${stats.tokensFound}`);
    assert.ok(stats.overridden >= 25, `overridden=${stats.overridden}`);

    // The premise every F2 assertion rests on: at document_start the only
    // stylesheet in the document is theme.css, which declares no custom
    // properties. If this ever stops being true the fixture has drifted away
    // from the ordering that made the defect possible, and the mutation
    // controls below would start passing for the wrong reason.
    assert.deepEqual(
      { found: stats.passLog[0].found, wrote: stats.passLog[0].wrote },
      { found: 0, wrote: 0 },
      'the boot pass must see an empty palette, as it does on live Maps'
    );

    const ov = await overrides(page);

    // Calibration. Both F4 tests below depend on `#ffffff` landing exactly
    // here, and the whole exception table is keyed by resolved value, so a
    // silent drift in the ramp constants must break something loudly.
    assert.equal(ov['--surface'].light, 'rgb(255, 255, 255)');
    assert.equal(ov['--surface'].dark, 'rgb(24, 24, 24)');

    // The exception table, keyed by value not by name.
    assert.equal(ov['--primary'].dark, 'rgb(168, 199, 250)', '#0b57d0 -> #a8c7fa');
    assert.equal(stats.reasons.exception >= 1, true);

    // Never inverted: translucent black, translucent white, vivid accents.
    assert.ok(!('--shadow' in ov), 'a translucent-black shadow must be left alone');
    assert.ok(!('--wash' in ov), 'a translucent-white wash must be left alone');
    assert.ok(!('--star' in ov), 'a vivid gold star must be left alone');

    // Non-colour tokens are recognised as such, not mangled.
    const vals = await tokenValues(page);
    assert.equal(vals['--t9000000000000001'], '8px');
    assert.equal(vals['--t9000000000000002'], '1.5');

    // The tokens reached the UI.
    const paint = await paintedColours(page);
    assert.equal(paint.panel.backgroundColor, 'rgb(24, 24, 24)');
    assert.ok(relativeLuminance(paint['body-text'].color) > 0.5, 'body text became light');

    // Contrast, on the surface it actually sits on.
    const body = contrastRatio(paint['body-text'].color, paint.panel.backgroundColor);
    const secondary = contrastRatio(paint['secondary-text'].color, paint.panel.backgroundColor);
    const filled = contrastRatio(paint['btn-filled'].color, paint['btn-filled'].backgroundColor);
    const outlined = contrastRatio(paint['btn-outlined'].color, paint['btn-outlined'].backgroundColor);
    console.log(
      `      contrast: body ${body}:1  secondary ${secondary}:1  ` +
      `filled ${filled}:1  outlined ${outlined}:1`
    );
    assert.ok(body >= 4.5, `body text ${body}:1`);
    assert.ok(secondary >= 4.5, `secondary text ${secondary}:1`);
    assert.ok(filled >= 4.5, `filled button ${filled}:1`);
    assert.ok(outlined >= 4.5, `outlined button ${outlined}:1`);

    noPageErrors(page);
  } finally {
    await closePage(page);
  }
});

/* =========================================================================
 * 1. F2 -- the already-dark guard
 * ========================================================================= */

async function f2GuardFires(source) {
  const page = await openFixture(browser, { tokens: darkPalette(), source });
  try {
    const stats = await waitForQuiet(page);
    assert.equal(
      stats.state,
      'skipped-already-dark',
      'a page whose palette is already dark must be left alone'
    );
    assert.equal(stats.overridden, 0, 'nothing may be written when the guard fires');

    // The review's own reproduction, verbatim.
    const vals = await tokenValues(page);
    assert.equal(
      vals['--tok0'],
      'rgb(10, 10, 10)',
      '--tok0 must not be inverted to a near-white'
    );
    const paint = await paintedColours(page);
    assert.ok(
      relativeLuminance(paint.panel.backgroundColor) < 0.05,
      `the dark panel stayed dark: ${paint.panel.backgroundColor}`
    );
  } finally {
    await closePage(page);
  }
}

test('F2: an already-dark palette is recognised and left alone', () => f2GuardFires());

test('F2 mutation control: the guard is unreachable when gated on stats.passes === 0', async () => {
  const first = await mutationControl('f2-guard-first-pass-only', f2GuardFires);
  console.log(`      mutant f2-guard-first-pass-only failed as required: ${first}`);
});

async function f2VerdictSurvivesLadder(source) {
  const page = await openFixture(browser, { tokens: darkPalette(), source });
  try {
    // Long enough for the ladder's 0/120/400/900 ms rungs to accumulate
    // NO_GROWTH_STOP no-growth passes, which is when the state was being
    // relabelled.
    // 1500 ms clears the ladder's 0 / 120 / 400 / 900 ms rungs, so the
    // no-growth branch that used to relabel the state has certainly run. That
    // it ran is not asserted here but by the mutation control below: if the
    // branch were unreachable, flipping it would change nothing and the control
    // would fail to fail.
    const stats = await waitForQuiet(page, { minMs: 1500 });
    assert.equal(
      stats.passes,
      2,
      'the boot pass and the pass that reached the verdict -- and nothing after it, ' +
      'because a latched alreadyDark short-circuits every later pass'
    );
    assert.equal(
      stats.state,
      'skipped-already-dark',
      'the terminal verdict must survive the no-growth branch, not be relabelled "settled"'
    );
    assert.ok(stats.guard, 'the guard must record the verdict it reached');
    assert.equal(stats.guard.isDark, true);
    assert.ok(stats.guard.evidence >= 20, `evidence=${stats.guard.evidence}`);
    assert.ok(stats.guard.lightFraction < 0.25, `lightFraction=${stats.guard.lightFraction}`);
  } finally {
    await closePage(page);
  }
}

test('F2: the already-dark verdict survives the ladder', () => f2VerdictSurvivesLadder());

test('F2 mutation control: the no-growth branch overwrites the terminal state', async () => {
  const first = await mutationControl('f2-state-clobbered', f2VerdictSurvivesLadder);
  console.log(`      mutant f2-state-clobbered failed as required: ${first}`);
});

async function f2EvidenceFloor(source) {
  // Eight dark tokens at parse time and nothing else: a mid-ladder fragment,
  // below the floor. The full light palette arrives afterwards, as Maps' lazy
  // CSS modules do.
  const page = await openFixture(browser, { tokens: thinDarkPalette(), source });
  try {
    const early = await waitForQuiet(page);
    assert.notEqual(
      early.state,
      'skipped-already-dark',
      'eight tokens is not enough evidence to disable the whole theme'
    );

    const late = lightPalette()
      .filter(([name]) => name.startsWith('--t') && name.length > 12)
      .map(([name, value]) => `  ${name}: ${value};`)
      .join('\n');
    await addSheet(page, `:root {\n${late}\n}`, 'late-light-palette');
    await runPass(page);

    const stats = await readStats(page);
    assert.ok(
      stats.overridden >= 25,
      `the full palette must still be themed, saw overridden=${stats.overridden}`
    );
  } finally {
    await closePage(page);
  }
}

test('F2: a thin dark fragment does not trip the guard', () => f2EvidenceFloor());

test('F2: where the ratio threshold actually sits (documented limit, not a goal)', async () => {
  // Not an endorsement. The 0.25 light-fraction threshold predates these
  // findings and has never been calibrated against a real Google dark chrome,
  // because none exists. This palette is unmistakably dark to a human eye and
  // the guard does NOT fire on it. Recording that here turns an unknown into a
  // known: if Google ships dark Maps chrome, this is the number to re-measure
  // before trusting the guard.
  const page = await openFixture(browser, { tokens: marginalDarkPalette() });
  try {
    const stats = await waitForQuiet(page, { minMs: 1500 });
    assert.ok(stats.guard, 'the guard must have reached a verdict');
    assert.ok(
      stats.guard.lightFraction > 0.25 && stats.guard.lightFraction < 0.32,
      `expected a light fraction just above the threshold, saw ${stats.guard.lightFraction}`
    );
    assert.equal(stats.guard.isDark, false);
    assert.equal(stats.state, 'settled', 'so the theme runs, and inverts an already-dark page');
    console.log(
      `      guard verdict on a marginal dark palette: light=${stats.guard.light} ` +
      `dark=${stats.guard.dark} fraction=${stats.guard.lightFraction} -> isDark=false`
    );
  } finally {
    await closePage(page);
  }
});

test('F2 mutation control: without the evidence floor the fragment disables the theme', async () => {
  const first = await mutationControl('f2-no-evidence-floor', f2EvidenceFloor);
  console.log(`      mutant f2-no-evidence-floor failed as required: ${first}`);
});

/* =========================================================================
 * 2. F4 -- late-declared alias tokens
 * ========================================================================= */

async function f4LateAlias(source) {
  const page = await openFixture(browser, { tokens: lightPalette(), source });
  try {
    await waitForQuiet(page);
    const ov = await overrides(page);
    const surfaceDark = ov['--surface'].dark;
    const textDark = ov['--on-surface'].dark;

    // A `:root` alias sheet landing strictly after the pass that overrode its
    // target -- the dangerous window the review named.
    await addSheet(
      page,
      ':root { --late-alias: var(--surface); --late-text: var(--on-surface); }',
      'late-alias'
    );
    await runPass(page);

    const vals = await tokenValues(page);
    assert.equal(
      vals['--late-alias'],
      surfaceDark,
      `#ffffff -> ${surfaceDark} must not be inverted a second time`
    );
    assert.equal(
      vals['--late-text'],
      textDark,
      `#1f1f1f -> ${textDark} must not be inverted a second time`
    );

    const after = await overrides(page);
    assert.ok(!('--late-alias' in after), 'an alias must not be written at all');
    assert.ok(!('--late-text' in after), 'an alias must not be written at all');

    const stats = await readStats(page);
    assert.equal(stats.aliasSkipped, 2, 'both aliases recorded as such');
    assert.equal(stats.reasons['alias-of-override'], 2);
    assert.ok(stats.aliasProbes >= 1, 'the sentinel probe must actually have run');
    assert.ok(stats.aliasSuspects >= 2, `suspects examined=${stats.aliasSuspects}`);
  } finally {
    await closePage(page);
  }
}

test('F4: a :root alias declared in a later pass is not inverted twice', () => f4LateAlias());

test('F4 mutation control: without the alias check the value is inverted twice', async () => {
  const first = await mutationControl('f4-no-alias-check', f4LateAlias);
  console.log(`      mutant f4-no-alias-check failed as required: ${first}`);
});

async function f4GenuineCollision(source) {
  const page = await openFixture(browser, { tokens: lightPalette(), source });
  try {
    await waitForQuiet(page);
    const ov = await overrides(page);
    const surfaceDark = ov['--surface'].dark; // rgb(24, 24, 24) == #181818

    // A genuine Maps token, declared late, whose own literal value happens to
    // equal one of our outputs. On live Maps this is dark TEXT and it has to
    // become light. Constructed from the observed output rather than a
    // hard-coded hex, so the collision holds even if the ramp is retuned.
    await addSheet(page, `:root { --late-real: ${surfaceDark}; }`, 'late-real');
    await runPass(page);

    const after = await overrides(page);
    assert.ok(
      '--late-real' in after,
      'a genuine dark token must still be themed -- skipping it leaves dark text on a dark surface'
    );
    assert.equal(after['--late-real'].light, surfaceDark);
    assert.notEqual(after['--late-real'].dark, surfaceDark);

    const vals = await tokenValues(page);
    assert.ok(
      relativeLuminance(vals['--late-real']) > 0.5,
      `it must have become light, saw ${vals['--late-real']}`
    );

    const stats = await readStats(page);
    assert.equal(stats.aliasSkipped, 0, 'a literal is not an alias');
    assert.ok(
      stats.aliasSuspects >= 1,
      'the token must have been SUSPECTED -- otherwise this test proves nothing about the check'
    );
    assert.ok(stats.aliasProbes >= 1, 'and the cascade must have been asked about it');
  } finally {
    await closePage(page);
  }
}

test('F4: a late literal equal to one of our outputs is still themed', () => f4GenuineCollision());

test('F4 mutation control: the naive value match wrongly skips it', async () => {
  const first = await mutationControl('f4-naive-value-match', f4GenuineCollision);
  console.log(`      mutant f4-naive-value-match failed as required: ${first}`);
});

test('F4: an alias declared in the same pass as its target is themed normally', async () => {
  const page = await openFixture(browser, { tokens: lightPalette() });
  try {
    await waitForQuiet(page);
    const ov = await overrides(page);
    assert.ok('--alias-same-pass' in ov, 'a same-pass alias is not the hazard and must be written');
    assert.equal(ov['--alias-same-pass'].light, 'rgb(255, 255, 255)');
    assert.equal(ov['--alias-same-pass'].dark, ov['--surface'].dark);
    const stats = await readStats(page);
    assert.equal(stats.aliasSkipped, 0);
  } finally {
    await closePage(page);
  }
});

/* =========================================================================
 * 3. F6 -- the pass budget
 * ========================================================================= */

async function f6BudgetRefunded(source) {
  const page = await openFixture(browser, { tokens: lightPalette(), source });
  try {
    await waitForQuiet(page);

    // 66 more passes, one in ten of them productive -- a long-lived tab whose
    // user keeps opening place cards. A lifetime cap of 60 is spent by this;
    // a consecutive-unproductive cap of 60 never gets near it.
    for (let i = 0; i < 66; i++) {
      if (i % 10 === 0) await addSheet(page, `:root { --churn-${i}: #f0f0f0; }`, `churn-${i}`);
      await runPass(page);
    }

    const mid = await readStats(page);
    assert.ok(mid.passes >= 60, `expected 60+ passes to have run, saw ${mid.passes}`);

    await addSheet(page, ':root { --after-the-cap: #fafafa; }', 'after-the-cap');
    await runPass(page);

    const ov = await overrides(page);
    assert.ok(
      '--after-the-cap' in ov,
      'a token arriving after 60 passes must still be themed'
    );
    const stats = await readStats(page);
    assert.notEqual(stats.state, 'pass-cap-reached');
    assert.ok(stats.unproductivePasses < 60, `unproductivePasses=${stats.unproductivePasses}`);
  } finally {
    await closePage(page);
  }
}

test('F6: a productive pass refunds the budget', () => f6BudgetRefunded());

test('F6 mutation control: a lifetime cap stops theming a live tab', async () => {
  const first = await mutationControl('f6-lifetime-pass-cap', f6BudgetRefunded);
  console.log(`      mutant f6-lifetime-pass-cap failed as required: ${first}`);
});

/* =========================================================================
 * 4. Idempotency and reversibility
 * ========================================================================= */

test('running the pass again changes nothing', async () => {
  const page = await openFixture(browser, { tokens: lightPalette() });
  try {
    await waitForQuiet(page);
    const before = await tokenValues(page);
    const ovBefore = await overrides(page);

    for (let i = 0; i < 3; i++) {
      const wrote = await runPass(page);
      assert.equal(wrote, 0, `pass ${i + 2} wrote ${wrote} tokens; it should have written none`);
    }

    assert.deepEqual(await tokenValues(page), before, 'no token value moved');
    assert.deepEqual(await overrides(page), ovBefore, 'no override record moved');
  } finally {
    await closePage(page);
  }
});

test('undo restores the page byte for byte', async () => {
  // The control: the same fixture with the static CSS layer gated off and no
  // runtime theme at all. This is what "original" means.
  const control = await openFixture(browser, {
    tokens: lightPalette(),
    source: "document.documentElement.setAttribute('data-mapsnoir', 'off');",
  });
  const page = await openFixture(browser, { tokens: lightPalette() });
  try {
    const originalTokens = await tokenValues(control);
    const originalPaint = await paintedColours(control);

    await waitForQuiet(page);
    const themedPaint = await paintedColours(page);
    assert.notDeepEqual(themedPaint, originalPaint, 'the theme must have changed something first');

    await page.evaluate(() => window.__mapsNoirTheme.undo());

    assert.equal(await attribute(page, 'data-mapsnoir'), 'off');
    assert.deepEqual(await tokenValues(page), originalTokens, 'every token back to its own value');
    assert.deepEqual(await paintedColours(page), originalPaint, 'every painted colour restored');

    const stats = await readStats(page);
    assert.equal(stats.state, 'off');
    assert.equal(stats.overridden, 0);
  } finally {
    await closePage(page);
    await closePage(control);
  }
});

/* =========================================================================
 * 5. The map surface and photographic content
 * ========================================================================= */

test('the map surface and a photo are pixel-identical with the theme on and off', async () => {
  const control = await openFixture(browser, {
    tokens: lightPalette(),
    source: "document.documentElement.setAttribute('data-mapsnoir', 'off');",
  });
  const page = await openFixture(browser, { tokens: lightPalette() });
  try {
    await waitForQuiet(page);

    const mapOff = await elementMeanRgb(control, '#map');
    const mapOn = await elementMeanRgb(page, '#map');
    const photoOff = await elementMeanRgb(control, '#photo');
    const photoOn = await elementMeanRgb(page, '#photo');
    console.log(
      `      map  off=(${mapOff.r}, ${mapOff.g}, ${mapOff.b})  on=(${mapOn.r}, ${mapOn.g}, ${mapOn.b})\n` +
      `      photo off=(${photoOff.r}, ${photoOff.g}, ${photoOff.b})  on=(${photoOn.r}, ${photoOn.g}, ${photoOn.b})`
    );
    assert.deepEqual(mapOn, mapOff, 'map-area mean RGB must not move');
    assert.deepEqual(photoOn, photoOff, 'photographic content must not move');

    const paint = await paintedColours(page);
    for (const id of ['map', 'photo', 'panel']) {
      assert.equal(paint[id].filter, 'none', `${id} must carry no filter`);
      assert.equal(paint[id].mixBlendMode, 'normal', `${id} must carry no blend mode`);
      assert.equal(paint[id].opacity, '1', `${id} must not be faded`);
    }
    assert.equal(paint.map.backgroundColor, 'rgb(36, 54, 76)', 'the map keeps its own colour');
  } finally {
    await closePage(page);
    await closePage(control);
  }
});

/* =========================================================================
 * 6. Settings
 * ========================================================================= */

async function settingsGateAtBoot(source) {
  const page = await openFixture(browser, {
    tokens: lightPalette(),
    settings: { enabled: true, darkMap: true, darkChrome: false },
    source,
  });
  try {
    const stats = await waitForQuiet(page);
    assert.equal(stats.state, 'off', 'darkChrome:false must leave the theme off');
    assert.equal(stats.overridden, 0);
    assert.equal(stats.settings.darkChrome, false);
    assert.equal(await attribute(page, 'data-mapsnoir'), 'off');

    const paint = await paintedColours(page);
    assert.equal(
      paint.html.backgroundColor,
      'rgb(255, 255, 255)',
      'the static CSS layer must be gated off too'
    );
    assert.equal(paint.panel.backgroundColor, 'rgb(255, 255, 255)');
  } finally {
    await closePage(page);
  }
}

test('settings: darkChrome false at boot leaves the page alone', () => settingsGateAtBoot());

test('settings mutation control: ignoring the settings themes it anyway', async () => {
  const first = await mutationControl('settings-ignored', settingsGateAtBoot);
  console.log(`      mutant settings-ignored failed as required: ${first}`);
});

test('settings: enabled false leaves the page alone', async () => {
  const page = await openFixture(browser, {
    tokens: lightPalette(),
    settings: { enabled: false, darkMap: true, darkChrome: true },
  });
  try {
    const stats = await waitForQuiet(page);
    assert.equal(stats.state, 'off');
    assert.equal(stats.overridden, 0);
    assert.equal(await attribute(page, 'data-mapsnoir'), 'off');
  } finally {
    await closePage(page);
  }
});

async function settingsLive(source) {
  const page = await openFixture(browser, {
    tokens: lightPalette(),
    settings: { enabled: true, darkMap: true, darkChrome: true },
    source,
  });
  try {
    const on = await waitForQuiet(page);
    assert.equal(on.state, 'settled');
    const applied = on.overridden;
    assert.ok(applied >= 25);

    // Off, live, no reload.
    await changeSettings(page, { enabled: true, darkMap: true, darkChrome: false });
    const off = await readStats(page);
    assert.equal(off.state, 'off', 'turning darkChrome off must revert an open tab');
    assert.equal(off.overridden, 0);
    assert.equal(off.settings.source, 'onChanged');
    assert.equal(await attribute(page, 'data-mapsnoir'), 'off');
    let paint = await paintedColours(page);
    assert.equal(paint.html.backgroundColor, 'rgb(255, 255, 255)');
    assert.equal(paint.panel.backgroundColor, 'rgb(255, 255, 255)');

    // And back on, live, no reload.
    await changeSettings(page, { enabled: true, darkMap: true, darkChrome: true });
    const again = await readStats(page);
    assert.ok(
      again.state === 'running' || again.state === 'settled',
      `turning it back on must reapply immediately, state=${again.state}`
    );
    assert.equal(again.overridden, applied, 'the same token set comes back');
    assert.equal(await attribute(page, 'data-mapsnoir'), 'on');
    paint = await paintedColours(page);
    assert.equal(paint.html.backgroundColor, 'rgb(19, 19, 20)');
    assert.equal(paint.panel.backgroundColor, 'rgb(24, 24, 24)');
  } finally {
    await closePage(page);
  }
}

test('settings: darkChrome follows storage live, with no reload', () => settingsLive());

test('settings mutation control: without onChanged the open tab never updates', async () => {
  const first = await mutationControl('settings-no-live-updates', settingsLive);
  console.log(`      mutant settings-no-live-updates failed as required: ${first}`);
});

async function pendingWindowFailsDark(source) {
  // The read never answers until the test releases it, which holds the page in
  // the window between theme.css painting and the settings being known.
  const page = await openFixture(browser, {
    tokens: lightPalette(),
    settings: { enabled: true, darkMap: true, darkChrome: false },
    storageMode: 'manual',
    source,
  });
  try {
    assert.equal(await attribute(page, 'data-mapsnoir'), 'pending');
    const during = await paintedColours(page);
    assert.equal(
      during.html.backgroundColor,
      'rgb(19, 19, 20)',
      'the unknown window must paint dark, not white'
    );

    await releaseStorage(page);
    await page.waitForFunction(() => document.documentElement.getAttribute('data-mapsnoir') === 'off');
    const after = await paintedColours(page);
    assert.equal(after.html.backgroundColor, 'rgb(255, 255, 255)');
  } finally {
    await closePage(page);
  }
}

test('settings: the window before the read answers paints dark, not white', () => pendingWindowFailsDark());

test('settings mutation control: pointing the window the other way shows a white flash', async () => {
  const first = await mutationControl('flash-fails-light', pendingWindowFailsDark);
  console.log(`      mutant flash-fails-light failed as required: ${first}`);
});

test('settings: a storage read that never answers falls through to the defaults', async () => {
  const page = await openFixture(browser, {
    tokens: lightPalette(),
    settings: { enabled: true, darkMap: true, darkChrome: false },
    storageMode: 'never',
  });
  try {
    assert.equal(await attribute(page, 'data-mapsnoir'), 'pending');
    // SETTINGS_TIMEOUT_MS is 2000; the ladder then needs its usual ~900 ms.
    const stats = await waitForQuiet(page, { timeout: 25000 });
    assert.equal(stats.settings.source, 'unavailable');
    assert.equal(stats.state, 'settled', 'a dead storage must not leave the page half-themed');
    assert.ok(stats.overridden >= 25);
  } finally {
    await closePage(page);
  }
});

test('settings: the callback form of storage.local.get is honoured', async () => {
  const page = await openFixture(browser, {
    tokens: lightPalette(),
    settings: { enabled: true, darkMap: true, darkChrome: false },
    storageMode: 'callback',
  });
  try {
    const stats = await waitForQuiet(page);
    assert.equal(stats.settings.source, 'storage');
    assert.equal(stats.state, 'off');
    assert.equal(stats.overridden, 0);
  } finally {
    await closePage(page);
  }
});

test('settings: a missing record means defaults, which is on', async () => {
  const page = await openFixture(browser, {
    tokens: lightPalette(),
    storageMode: 'missing',
  });
  try {
    const stats = await waitForQuiet(page);
    assert.equal(stats.settings.enabled, true);
    assert.equal(stats.settings.darkChrome, true);
    assert.equal(stats.state, 'settled');
    assert.ok(stats.overridden >= 25);
  } finally {
    await closePage(page);
  }
});
