/**
 * Mean-RGB analysis of a PNG screenshot buffer.
 *
 * Decoding uses `pngjs` (pure JavaScript, no native build step). The alternative
 * -- shipping the buffer into a blank page and decoding via createImageBitmap +
 * canvas -- was rejected because it needs a live browser just to read a file,
 * which would make the analysis unavailable when a run fails early.
 *
 * ---------------------------------------------------------------------------
 * THE DEFECT THIS FILE USED TO HAVE
 * ---------------------------------------------------------------------------
 * classify() scored a *broken* map -- a canvas that had painted nothing at all,
 * mean RGB (0,0,0) -- as DARK, because (0,0,0) has luminance 0 and is nearer
 * (38,57,77) than (218,228,229). A dead renderer therefore passed the darkness
 * assertion more comfortably than a working one. Six real frames in
 * test/experiments/firefox-load/artifacts/ffblk-1-*.png are exactly that.
 *
 * The fix is a validity gate in front of both verdicts: a frame must contain
 * enough colour structure to be a *map* before "dark" or "light" means anything.
 * Two independent statistics have to clear a floor:
 *
 *   distinctColours  number of occupied 12-bit RGB buckets (4 bits per channel)
 *   stdev            mean of the three per-channel population standard deviations
 *
 * Calibrated over the 321 map-area screenshots already on disk from the earlier
 * experiment runs (test/experiments/{raster-pin,firefox-load,transport-arm}/
 * artifacts/), the two populations do not overlap and the gap is wide:
 *
 *   distinct  stdev   what it is
 *   --------  -----   ----------------------------------------------------
 *          1   0.00   dead canvas, pure black          (ffblk-1-*.png)
 *          3   2.5    dead canvas, flat white          (e3-nowasm-pin-*.png)
 *         11  11.6    vector data blocked, flat blue   (e1-abort-zoom-in-2.png)
 *   ------------------ threshold sits in this gap ------------------------
 *         51   7.4    real map, sparse light render    (e3-nowasm-pin-zoom-in-2)
 *         55  17.7    real map, dark, zoomed out       (e1-abort-zoom-out.png)
 *         58  33.0    real dark cartography tile       (composite-tile-RoadmapDark)
 *        279  47.4    real map, busy                   (e4-baseline-pegman.png)
 *
 * MIN_DISTINCT_COLOURS is set at 24: ~2.2x above the worst degenerate frame and
 * ~2.1x below the sparsest real one. MIN_STDEV is set at 5, which on its own
 * would not reject the flat-blue case -- the two floors are ANDed precisely
 * because neither alone is sufficient. Both numbers are reported on every frame
 * so a future reader can re-derive them rather than trust them.
 *
 * Consequence: isDark and isLight are now *three*-valued in effect. A frame can
 * be neither, and `validity.valid === false` says why. Callers that treated
 * `!isDark` as "light" must read `isLight` instead.
 */

import { PNG } from 'pngjs';

/** Reference values measured on real tiles (see docs/research). */
export const DARK_REF = { r: 38, g: 57, b: 77 };
export const LIGHT_REF = { r: 218, g: 228, b: 229 };

/**
 * Validity floors. See the calibration table above.
 * QUANT_BITS = 4 keeps 16 levels per channel, which is coarse enough that JPEG-
 * ish gradients and antialiasing do not inflate the count on a flat field.
 */
export const QUANT_BITS = 4;
export const MIN_DISTINCT_COLOURS = 24;
export const MIN_STDEV = 5;

/** Rec.709 relative luminance on a 0-255 scale. */
export function luminance({ r, g, b }) {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function rgbDistance(a, b) {
  return Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);
}

/**
 * Decode a PNG buffer, average every opaque pixel, and measure how much colour
 * structure it has.
 *
 * @param {Buffer} buffer
 * @returns {{r:number,g:number,b:number,width:number,height:number,pixels:number,
 *            stdev:number,stdevRgb:number[],distinctColours:number,
 *            maxBucketShare:number}}
 */
export function meanRgb(buffer) {
  const png = PNG.sync.read(buffer);
  const { width, height, data } = png;
  const shift = 8 - QUANT_BITS;

  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  let rr = 0;
  let gg = 0;
  let bb = 0;
  // 4 bits per channel -> 4096 buckets, small enough for a dense array.
  const buckets = new Uint32Array(1 << (QUANT_BITS * 3));

  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    const R = data[i];
    const G = data[i + 1];
    const B = data[i + 2];
    r += R;
    g += G;
    b += B;
    rr += R * R;
    gg += G * G;
    bb += B * B;
    n += 1;
    buckets[((R >> shift) << (QUANT_BITS * 2)) | ((G >> shift) << QUANT_BITS) | (B >> shift)] += 1;
  }
  if (n === 0) throw new Error('screenshot decoded to zero opaque pixels');

  const mr = r / n;
  const mg = g / n;
  const mb = b / n;
  // Population standard deviation via the sum-of-squares identity. Clamped at 0
  // because floating-point cancellation can push a genuinely uniform field
  // fractionally negative.
  const sd = (sum2, mean) => Math.sqrt(Math.max(0, sum2 / n - mean * mean));
  const sdR = sd(rr, mr);
  const sdG = sd(gg, mg);
  const sdB = sd(bb, mb);

  let distinct = 0;
  let biggest = 0;
  for (let i = 0; i < buckets.length; i++) {
    if (buckets[i] === 0) continue;
    distinct += 1;
    if (buckets[i] > biggest) biggest = buckets[i];
  }

  return {
    r: +(mr).toFixed(2),
    g: +(mg).toFixed(2),
    b: +(mb).toFixed(2),
    width,
    height,
    pixels: n,
    stdev: +((sdR + sdG + sdB) / 3).toFixed(2),
    stdevRgb: [+sdR.toFixed(2), +sdG.toFixed(2), +sdB.toFixed(2)],
    distinctColours: distinct,
    /** Fraction of the frame occupied by its single most common quantised colour. */
    maxBucketShare: +(biggest / n).toFixed(4),
  };
}

/**
 * Is this frame a rendered map at all, as opposed to a blank or dead canvas?
 *
 * @param {{stdev:number, distinctColours:number}} mean
 * @returns {{valid:boolean, reason:string|null}}
 */
export function validity(mean) {
  const reasons = [];
  if (!(mean.distinctColours >= MIN_DISTINCT_COLOURS)) {
    reasons.push(
      `only ${mean.distinctColours} distinct ${QUANT_BITS}-bit colours (need >= ${MIN_DISTINCT_COLOURS})`
    );
  }
  if (!(mean.stdev >= MIN_STDEV)) {
    reasons.push(`stdev ${mean.stdev} (need >= ${MIN_STDEV})`);
  }
  if (reasons.length === 0) return { valid: true, reason: null };
  return {
    valid: false,
    reason: `degenerate frame -- not a rendered map: ${reasons.join('; ')}`,
  };
}

/**
 * A3's definition of dark:
 *   the frame is a rendered map (see validity()), AND its mean luminance is
 *   below 100 on 0-255, AND it is clearly nearer (38,57,77) than (218,228,229).
 * "Clearly" is read as a 1.5x margin, so a mid-grey cannot squeak past.
 *
 * `isDark` and `isLight` are both false for a degenerate frame; that is the
 * whole point of the validity gate, and `valid`/`invalidReason` carry the why.
 */
export function classify(mean) {
  const lum = +luminance(mean).toFixed(2);
  const dDark = +rgbDistance(mean, DARK_REF).toFixed(2);
  const dLight = +rgbDistance(mean, LIGHT_REF).toFixed(2);
  const nearerDark = dDark * 1.5 < dLight;
  const nearerLight = dLight * 1.5 < dDark;
  const v = validity(mean);
  return {
    ...mean,
    luminance: lum,
    distToDarkRef: dDark,
    distToLightRef: dLight,
    valid: v.valid,
    invalidReason: v.reason,
    isDark: v.valid && lum < 100 && nearerDark,
    isLight: v.valid && lum >= 100 && nearerLight,
    /* Pre-validity verdicts, kept so a report can distinguish "the map is light"
     * from "the map never painted". Never assert on these. */
    isDarkIgnoringValidity: lum < 100 && nearerDark,
    isLightIgnoringValidity: lum >= 100 && nearerLight,
  };
}

/** One-word verdict for logs. */
export function verdictWord(px) {
  if (!px) return 'MISSING';
  if (!px.valid) return 'INVALID';
  if (px.isDark) return 'DARK';
  if (px.isLight) return 'LIGHT';
  return 'AMBIGUOUS';
}

export function analyse(buffer) {
  return classify(meanRgb(buffer));
}

/**
 * Box-filter downscale, used only for the on-disk copy of a frame.
 *
 * Prior runs left ~112 MB of full-size PNGs in test/experiments/*\/artifacts/.
 * Every assertion in this suite runs on the full-resolution buffer in memory;
 * the file on disk exists for a human to look at, so it is written at 1/2 or
 * 1/3 scale. Nothing reads these back.
 *
 * @param {Buffer} buffer  PNG
 * @param {number} factor  integer >= 1
 * @returns {Buffer} PNG
 */
export function downscalePng(buffer, factor = 2) {
  const f = Math.max(1, Math.round(factor));
  if (f === 1) return buffer;
  const src = PNG.sync.read(buffer);
  const w = Math.max(1, Math.floor(src.width / f));
  const h = Math.max(1, Math.floor(src.height / f));
  const out = new PNG({ width: w, height: h });
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let n = 0;
      for (let dy = 0; dy < f; dy++) {
        const sy = y * f + dy;
        if (sy >= src.height) break;
        for (let dx = 0; dx < f; dx++) {
          const sx = x * f + dx;
          if (sx >= src.width) break;
          const i = (sy * src.width + sx) * 4;
          r += src.data[i];
          g += src.data[i + 1];
          b += src.data[i + 2];
          a += src.data[i + 3];
          n += 1;
        }
      }
      const o = (y * w + x) * 4;
      out.data[o] = Math.round(r / n);
      out.data[o + 1] = Math.round(g / n);
      out.data[o + 2] = Math.round(b / n);
      out.data[o + 3] = Math.round(a / n);
    }
  }
  return PNG.sync.write(out);
}

/**
 * Synthesise a solid-colour PNG. Used by the regression test that proves
 * classify() rejects a blank canvas, and available to any future test that
 * needs a known-degenerate frame.
 *
 * @param {{width?:number,height?:number,r:number,g:number,b:number,a?:number}} spec
 */
export function solidPng({ width = 64, height = 64, r, g, b, a = 255 }) {
  const png = new PNG({ width, height });
  for (let i = 0; i < png.data.length; i += 4) {
    png.data[i] = r;
    png.data[i + 1] = g;
    png.data[i + 2] = b;
    png.data[i + 3] = a;
  }
  return PNG.sync.write(png);
}

/**
 * Synthesise a PNG with deterministic pseudo-random colour structure around a
 * given mean, so a test can construct a frame that is dark AND valid.
 *
 * @param {{width?:number,height?:number,r:number,g:number,b:number,spread?:number,seed?:number}} spec
 */
export function texturedPng({ width = 64, height = 64, r, g, b, spread = 40, seed = 1 }) {
  const png = new PNG({ width, height });
  let s = seed >>> 0 || 1;
  const rnd = () => {
    // xorshift32 -- deterministic, no dependency.
    s ^= s << 13;
    s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 0xffffffff;
  };
  const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));
  for (let i = 0; i < png.data.length; i += 4) {
    png.data[i] = clamp(r + (rnd() - 0.5) * 2 * spread);
    png.data[i + 1] = clamp(g + (rnd() - 0.5) * 2 * spread);
    png.data[i + 2] = clamp(b + (rnd() - 0.5) * 2 * spread);
    png.data[i + 3] = 255;
  }
  return PNG.sync.write(png);
}
