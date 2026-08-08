/**
 * classify() must not score a dead canvas as DARK.
 *
 * This is a regression test for a defect that was live in this repo: a pure
 * black frame -- mean RGB (0,0,0), which is what a broken/never-painted map
 * canvas screenshots as -- passed the darkness assertion, because luminance 0 is
 * below the threshold and (0,0,0) is nearer (38,57,77) than (218,228,229). Six
 * real frames of exactly that shape are on disk in
 * test/experiments/firefox-load/artifacts/ffblk-1-*.png, and they were scored
 * DARK by the previous implementation.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  analyse,
  classify,
  meanRgb,
  solidPng,
  texturedPng,
  downscalePng,
  MIN_DISTINCT_COLOURS,
  MIN_STDEV,
} from '../lib/image.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

test('a pure black frame is INVALID, not DARK', () => {
  const px = analyse(solidPng({ r: 0, g: 0, b: 0 }));
  assert.deepEqual([px.r, px.g, px.b], [0, 0, 0], 'the mean really is (0,0,0)');
  assert.equal(px.luminance, 0);
  assert.equal(px.distinctColours, 1);
  assert.equal(px.stdev, 0);

  // The defect, stated as an assertion: the OLD rule would have said dark.
  assert.equal(px.isDarkIgnoringValidity, true, 'the pre-validity verdict is still DARK -- that was the bug');
  // The fix.
  assert.equal(px.valid, false);
  assert.equal(px.isDark, false, 'a dead canvas must not pass the darkness assertion');
  assert.equal(px.isLight, false);
  assert.match(px.invalidReason, /degenerate frame/);
  assert.match(px.invalidReason, /distinct/);
});

test('a pure white frame is INVALID, not LIGHT', () => {
  const px = analyse(solidPng({ r: 255, g: 255, b: 255 }));
  assert.equal(px.valid, false);
  assert.equal(px.isLight, false);
  assert.equal(px.isDark, false);
  assert.equal(px.isLightIgnoringValidity, true);
});

test('a flat dark-blue field (blocked vector data) is INVALID, not DARK', () => {
  // Mean (25,53,72) -- the exact shape of test/experiments/raster-pin/artifacts/
  // e1-abort-zoom-in-2.png, a run where the vector data was deliberately blocked.
  // It is very close to the dark reference, which is precisely why luminance and
  // distance alone cannot reject it.
  const px = analyse(texturedPng({ r: 25, g: 53, b: 72, spread: 3, seed: 7 }));
  assert.ok(px.distinctColours < MIN_DISTINCT_COLOURS, `distinct=${px.distinctColours}`);
  assert.equal(px.isDarkIgnoringValidity, true);
  assert.equal(px.isDark, false);
  assert.equal(px.valid, false);
});

test('a textured dark frame IS valid and DARK', () => {
  const px = analyse(texturedPng({ r: 36, g: 54, b: 76, spread: 45, seed: 3 }));
  assert.equal(px.valid, true, px.invalidReason ?? '');
  assert.ok(px.stdev >= MIN_STDEV, `stdev=${px.stdev}`);
  assert.ok(px.distinctColours >= MIN_DISTINCT_COLOURS, `distinct=${px.distinctColours}`);
  assert.equal(px.isDark, true);
  assert.equal(px.isLight, false);
});

test('a textured light frame IS valid and LIGHT', () => {
  const px = analyse(texturedPng({ r: 223, g: 231, b: 230, spread: 45, seed: 5 }));
  assert.equal(px.valid, true, px.invalidReason ?? '');
  assert.equal(px.isLight, true);
  assert.equal(px.isDark, false);
});

test('a mid-grey frame is neither dark nor light', () => {
  const px = analyse(texturedPng({ r: 128, g: 128, b: 128, spread: 45, seed: 11 }));
  assert.equal(px.valid, true);
  assert.equal(px.isDark, false);
  assert.equal(px.isLight, false);
});

test('the real degenerate frames on disk are rejected, and the real map frames are not', () => {
  // Calibration evidence, run against the actual artefacts rather than a story
  // about them. Skipped rather than failed if a previous lane's artefacts have
  // been cleaned away, because they are not this suite's to guarantee.
  const cases = [
    { file: 'test/experiments/firefox-load/artifacts/ffblk-1-initial.png', expectValid: false },
    { file: 'test/experiments/firefox-load/artifacts/ffblk-1-t3000ms.png', expectValid: false },
    { file: 'test/experiments/raster-pin/artifacts/e3-nowasm-pin-settled.png', expectValid: false },
    { file: 'test/experiments/raster-pin/artifacts/e1-abort-zoom-in-2.png', expectValid: false },
    { file: 'test/experiments/raster-pin/artifacts/composite-tile-RoadmapDark.png', expectValid: true, expectDark: true },
    { file: 'test/experiments/raster-pin/artifacts/composite-tile-Roadmap.png', expectValid: true, expectLight: true },
    { file: 'test/experiments/raster-pin/artifacts/e1-abort-zoom-out.png', expectValid: true },
  ];
  let checked = 0;
  for (const c of cases) {
    const abs = path.join(ROOT, c.file);
    if (!fs.existsSync(abs)) continue;
    checked += 1;
    const px = analyse(fs.readFileSync(abs));
    assert.equal(
      px.valid,
      c.expectValid,
      `${c.file}: valid=${px.valid} (distinct=${px.distinctColours} stdev=${px.stdev} lum=${px.luminance})`
    );
    if (c.expectDark) assert.equal(px.isDark, true, `${c.file} should be DARK`);
    if (c.expectLight) assert.equal(px.isLight, true, `${c.file} should be LIGHT`);
  }
  if (checked === 0) {
    console.log('  (skipped: no prior-lane artefacts on disk to calibrate against)');
  }
});

test('meanRgb ignores fully transparent pixels and reports frame geometry', () => {
  const m = meanRgb(solidPng({ width: 10, height: 6, r: 10, g: 20, b: 30 }));
  assert.equal(m.width, 10);
  assert.equal(m.height, 6);
  assert.equal(m.pixels, 60);
  assert.equal(m.maxBucketShare, 1);
  assert.throws(() => meanRgb(solidPng({ r: 1, g: 2, b: 3, a: 0 })), /zero opaque pixels/);
});

test('classify is a pure function of the mean statistics', () => {
  const a = classify({ r: 36, g: 54, b: 76, stdev: 20, distinctColours: 200 });
  assert.equal(a.isDark, true);
  const b = classify({ r: 36, g: 54, b: 76, stdev: 20, distinctColours: 2 });
  assert.equal(b.isDark, false);
});

test('downscalePng halves the frame and preserves a flat colour', () => {
  const src = solidPng({ width: 40, height: 20, r: 12, g: 34, b: 56 });
  const out = meanRgb(downscalePng(src, 2));
  assert.equal(out.width, 20);
  assert.equal(out.height, 10);
  assert.deepEqual([out.r, out.g, out.b], [12, 34, 56]);
});
