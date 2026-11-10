#!/usr/bin/env node
/**
 * Derive DNR rules 6-8: the Terrain relief ("shading" + "contours") tiles that the
 * WebGL renderer (mapcore) fetches as `/maps/vt/proto?bpb=<base64url protobuf>`.
 *
 * Why these exist. In mapcore, Terrain is two things: the vector base map, coloured
 * by the CompactLegend palette (rule 2 darkens it), and a server-rendered relief
 * layer -- hillshade, landcover greens, contours -- baked in the colours of the
 * style named inside the bpb protobuf (`set` = `Terrain`). Rule 2 alone therefore
 * gives a dark road grid and dark water over light beige/mint mountains (the
 * Windows Firefox report after a512522). Google serves the same tile in its dark
 * terrain colours when the protobuf says `TerrainDark` (the page config's own
 * `terrain_dark` layer is exactly shading + contours + set TerrainDark).
 *
 * Why a regex can do it after all. Swapping `Terrain` (7 bytes) for `TerrainDark`
 * (11) normally changes three nested length prefixes and shifts every base64
 * character after it (see test/lib/bpb.mjs). The trick is to keep the byte count
 * of the ENCLOSING message unchanged: the style option immediately before the set
 * entry, `62 02 08 3f` (option 63, 4 bytes), is dropped while the 4 bytes of
 * "Dark" are added. Google returns a byte-identical tile with or without option 63
 * once the style is TerrainDark (verified 2026-11-09). The rewritten region is the
 * same length as the original, so:
 *   - no length prefix outside the region changes;
 *   - every base64 character outside the region is unchanged;
 *   - only the region's position modulo 3 matters, which gives exactly three
 *     literal base64 strings -- one rule each (the tile-coordinate varints in front
 *     of the region vary in length with zoom, so all three alignments occur).
 *
 * If Google ever reorders or renames these options the literal no longer matches
 * and the tile simply stays as it is today (light relief); nothing breaks.
 *
 * Usage: node tools/proto-terrain-rules.mjs   -> prints rules 6-17 as JSON.
 */

const b = (...xs) => Buffer.from(xs);
const s = (t) => Buffer.from(t, 'latin1');

/** Option 63, option 3, then the style set entry `set=Terrain`, then the next field tag. */
export const OLD_REGION = Buffer.concat([
  b(0x62, 0x02, 0x08, 0x3f), // option 63 (dropped)
  b(0x62, 0x02, 0x08, 0x03), // option 3
  b(0x62, 0x12, 0x08, 0x44, 0x12, 0x0e, 0x0a, 0x03), s('set'), b(0x12, 0x07), s('Terrain'),
  b(0xa0, 0x01), // the field that follows (tag 20, varint) -- anchors the last base64 char
]);
export const NEW_REGION = Buffer.concat([
  b(0x62, 0x02, 0x08, 0x03),
  b(0x62, 0x16, 0x08, 0x44, 0x12, 0x12, 0x0a, 0x03), s('set'), b(0x12, 0x0b), s('TerrainDark'),
  b(0xa0, 0x01),
]);

const enc = (buf) => buf.toString('base64url');

/**
 * Base64 characters fully determined by the region when it starts `k` bytes into a
 * 3-byte group: drop the leading chars that mix in the previous byte and the
 * trailing char that mixes in the following byte.
 */
export function regionCore(region, k) {
  const full = enc(Buffer.concat([Buffer.alloc(k), region]));
  const skip = [0, 2, 3][k];
  const end = region.length + k;
  const fullChars = Math.floor(end / 3) * 4 + [0, 1, 2][end % 3];
  return full.slice(skip, fullChars);
}

export const FIRST_RULE_ID = 6;

/*
 * Rules 9-17: the "server-styled" mapcore tiles (found 2026-11-09, Chrome on a
 * profile Google had put in the variant that bakes colours into the tile).
 *
 * In that variant every vector tile request carries two extra options inside the
 * style set entry -- `28 01 30 01` (fields 5 and 6 = 1) right after the style
 * name -- and Google returns the tile with the style's colours baked in. The
 * client then never fetches a CompactLegend palette at all, so rules 1/2/5 have
 * nothing to redirect and the map renders in the light `Roadmap` / `TransitFocused`
 * colours although the extension is on (the "Transit, then More, still bright"
 * report: the variant is per profile, not per click, and Firefox's profile was
 * in the default variant). Same trick as rules 6-8: the 4 bytes of the two
 * options are dropped while the 4 bytes of "Dark" are added, so the region keeps
 * its length. Without the options Google returns the tile in the default
 * (palette) form for the Dark style, and the client fetches the Dark legend
 * itself (verified: the page turns dark, the RoadmapDark/TransitFocusedDark
 * CompactLegend is fetched -- see docs/turns/2026-11-09-version-1.0.5.md).
 */
const setEntry = (name, extra) => {
  const nm = s(name);
  const inner = Buffer.concat([b(0x0a, 0x03), s('set'), b(0x12, nm.length), nm]);
  const body = Buffer.concat([b(0x08, 0x44, 0x12, inner.length), inner, extra]);
  return Buffer.concat([b(0x62, body.length), body]);
};
const BAKED = b(0x28, 0x01, 0x30, 0x01);
const NEXT = b(0xa0, 0x01);

export const SWAPS = [
  { name: 'terrain-relief', firstId: FIRST_RULE_ID, old: OLD_REGION, new: NEW_REGION },
  ...['Roadmap', 'TransitFocused', 'Terrain'].map((style, i) => ({
    name: `baked-${style}`,
    firstId: 9 + 3 * i,
    old: Buffer.concat([setEntry(style, BAKED), NEXT]),
    new: Buffer.concat([setEntry(`${style}Dark`, Buffer.alloc(0)), NEXT]),
  })),
];

function swapRules(swap) {
  if (swap.old.length !== swap.new.length) throw new Error(`${swap.name}: regions must be the same length`);
  return [0, 1, 2].map((k) => ({
    id: swap.firstId + k,
    priority: 1,
    action: {
      type: 'redirect',
      redirect: { regexSubstitution: `\\1${regionCore(swap.new, k)}\\2` },
    },
    condition: {
      regexFilter: `^(https://[^/]+/maps/vt/proto\\?bpb=[^&]*)${regionCore(swap.old, k)}(.*)$`,
      resourceTypes: ['xmlhttprequest', 'other'],
    },
  }));
}

/** Rules 6-8 (Terrain relief). */
export function protoTerrainRules() {
  return swapRules(SWAPS[0]);
}

/** Rules 6-17: Terrain relief plus the server-styled Roadmap / TransitFocused / Terrain tiles. */
export function protoRules() {
  return SWAPS.flatMap(swapRules);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(JSON.stringify(protoRules(), null, 2));
}
