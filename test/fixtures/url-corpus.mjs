/**
 * Real captured URLs, with provenance.
 *
 * Nothing in here is invented. Every URL was either observed on the wire by one
 * of the earlier experiment lanes and quoted from the artefact named beside it,
 * or -- for the entries flagged `derived: true` -- produced from one of those
 * captures by substituting ONLY the `!1sset!2s<Style>` token. A reviewer can
 * therefore check the corpus against the capture rather than against my memory
 * of the format, and can see at a glance which entries are transcriptions and
 * which are one-token edits of a transcription.
 *
 * Why the derived entries exist. The Terrain arm of the tile transports is only
 * requested after a user switches the base map to Terrain, and no capture lane
 * ever drove that; what IS known from capture is the exact shape of the raster
 * and stream URLs, and that the style name sits in a plain-ASCII
 * `!1sset!2s<Style>!` selector. The derived URLs are byte-identical to the
 * shipped extension's own self-check samples (`extension/background.js`
 * RULE_SAMPLES[3] and [4], Terrain arm), so the offline corpus and the
 * in-product self-check are testing the same strings rather than two
 * independently-guessed ones.
 *
 * The MUST-NOT-MATCH corpus is the half that catches the dangerous bugs: a rule
 * that is too greedy silently breaks satellite imagery, rewrites the Maps
 * document itself, or -- worst -- re-matches its own output and produces an
 * infinite redirect loop that Chrome terminates with ERR_TOO_MANY_REDIRECTS and
 * a blank page.
 *
 * One shape of loop deserves naming here because it defeats the obvious
 * detector. `Roadmap -> RoadmapDark` re-matching itself produces the SAME URL
 * twice, which a seen-set cycle check catches immediately. A tile rule that
 * loses the `!` terminating its token capture instead DIVERGES --
 * `Terrain -> TerrainDark -> TerrainDarkDark -> ...` -- and never repeats a URL
 * at all. A detector that only remembers URLs it has seen runs until the process
 * dies (measured: 3.7 GB). Every loop check in this suite therefore carries a
 * hop budget as well as a set.
 */

const LEGEND_V = '4311471e3660cd049e8ede59d279b3ba';
const LEGEND_V2 = 'e3dec3f84b7764496b89ce7fd835e7f4';

/** URLs each rule id must rewrite, and what it must rewrite them to. */
export const MUST_MATCH = [
  {
    ruleId: 1,
    name: 'legend-roadmap',
    why: 'gstatic CompactLegend palette asset -- the request that darkens mapcore and canvas+labeler',
    source: 'extension/background.js RULE_SAMPLES[1]; version hashes confirmed live 200 on 2026-08-07',
    resourceType: 'xmlhttprequest',
    url: `https://www.gstatic.com/maps/res/CompactLegend-Roadmap-${LEGEND_V}`,
    expect: `https://www.gstatic.com/maps/res/CompactLegend-RoadmapDark-${LEGEND_V}`,
  },
  {
    ruleId: 1,
    name: 'legend-roadmap-other-version',
    why: 'the version hash rotates; the rule must not be pinned to one',
    source: 'second version hash observed within a day of the first (background.js PINNED_LEGEND_VERSIONS)',
    resourceType: 'xmlhttprequest',
    url: `https://www.gstatic.com/maps/res/CompactLegend-Roadmap-${LEGEND_V2}`,
    expect: `https://www.gstatic.com/maps/res/CompactLegend-RoadmapDark-${LEGEND_V2}`,
  },
  {
    ruleId: 2,
    name: 'legend-terrain',
    why: 'terrain base map takes its palette from the same asset family',
    source: 'extension/background.js RULE_SAMPLES[2]',
    resourceType: 'xmlhttprequest',
    url: `https://www.gstatic.com/maps/res/CompactLegend-Terrain-${LEGEND_V}`,
    expect: `https://www.gstatic.com/maps/res/CompactLegend-TerrainDark-${LEGEND_V}`,
  },
  {
    ruleId: 3,
    name: 'vector-stream',
    why: 'plain `canvas` mode colours from the server via the stream URL set: token',
    source: 'test/experiments/firefox-load/gate-run.mjs header capture; background.js RULE_SAMPLES[3]',
    resourceType: 'xmlhttprequest',
    url:
      'https://www.google.com/maps/vt/stream/pb=!1m7!8m6!1m3!1i12!2i960!3i1691!2i6!3x16777215' +
      '!2m3!1e0!2sm!3i790555512!3m8!2sen!3sus!5e1105!12m4!1e68!2m2!1sset!2sRoadmap!4e1!5m1!1e0',
    expect:
      'https://www.google.com/maps/vt/stream/pb=!1m7!8m6!1m3!1i12!2i960!3i1691!2i6!3x16777215' +
      '!2m3!1e0!2sm!3i790555512!3m8!2sen!3sus!5e1105!12m4!1e68!2m2!1sset!2sRoadmapDark!4e1!5m1!1e0',
  },
  {
    ruleId: 3,
    name: 'terrain-stream',
    why:
      'the Terrain base map on the stream transport. Rules 3 and 4 match ' +
      '`!2s(Roadmap|Terrain)!`; without a Terrain entry on each tile transport the ' +
      'alternation is untested and a rule could silently fall back to Roadmap-only.',
    source:
      'the vector-stream capture above with only the !1sset!2s token changed; identical to ' +
      'extension/background.js RULE_SAMPLES[3] "vector-stream-terrain"',
    derived: true,
    resourceType: 'xmlhttprequest',
    url:
      'https://www.google.com/maps/vt/stream/pb=!1m7!8m6!1m3!1i12!2i960!3i1691!2i6!3x16777215' +
      '!2m3!1e0!2sm!3i790555512!3m8!2sen!3sus!5e1105!12m4!1e68!2m2!1sset!2sTerrain!4e1!5m1!1e0',
    expect:
      'https://www.google.com/maps/vt/stream/pb=!1m7!8m6!1m3!1i12!2i960!3i1691!2i6!3x16777215' +
      '!2m3!1e0!2sm!3i790555512!3m8!2sen!3sus!5e1105!12m4!1e68!2m2!1sset!2sTerrainDark!4e1!5m1!1e0',
  },
  {
    ruleId: 4,
    name: 'terrain-raster',
    why: 'the Terrain base map on the first-paint raster grid -- the other half of the alternation',
    source:
      'the raster-firstpaint-z17 capture above with only the !1sset!2s token changed; identical ' +
      'to extension/background.js RULE_SAMPLES[4] "raster-firstpaint-terrain"',
    derived: true,
    resourceType: 'image',
    url:
      'https://www.google.com/maps/vt/pb=!1m4!1m3!1i17!2i30812!3i54180!2m3!1e0!2sm!3i789555512' +
      '!3m8!2sen!3sus!5e1105!12m4!1e68!2m2!1sset!2sTerrain!4e0!5m1!1e0!23i100818990',
    expect:
      'https://www.google.com/maps/vt/pb=!1m4!1m3!1i17!2i30812!3i54180!2m3!1e0!2sm!3i789555512' +
      '!3m8!2sen!3sus!5e1105!12m4!1e68!2m2!1sset!2sTerrainDark!4e0!5m1!1e0!23i100818990',
  },
  {
    ruleId: 4,
    name: 'raster-firstpaint-z12',
    why: 'the server-HTML first-paint raster grid, present in all three renderer modes',
    source: 'test/experiments/transport-arm/data/one-raster-light.txt (verbatim capture)',
    resourceType: 'image',
    url:
      'https://www.google.com/maps/vt/pb=!1m4!1m3!1i12!2i962!3i1693!2m3!1e0!2sm!3i789555512' +
      '!3m8!2sen!3sus!5e1105!12m4!1e68!2m2!1sset!2sRoadmap!4e0!5m1!1e0!23i100818990!23i1368782' +
      '!23i1368785!23i4861626!23i10211310!23i1381938!23i47054629!23i47029525!23i72272233' +
      '!23i72272234!23i72272236!23i72458815!23i94243289!23i94255677!23i72860224!23i10211515' +
      '!23i94260020!23i100799651!23i72549439',
    expect:
      'https://www.google.com/maps/vt/pb=!1m4!1m3!1i12!2i962!3i1693!2m3!1e0!2sm!3i789555512' +
      '!3m8!2sen!3sus!5e1105!12m4!1e68!2m2!1sset!2sRoadmapDark!4e0!5m1!1e0!23i100818990!23i1368782' +
      '!23i1368785!23i4861626!23i10211310!23i1381938!23i47054629!23i47029525!23i72272233' +
      '!23i72272234!23i72272236!23i72458815!23i94243289!23i94255677!23i72860224!23i10211515' +
      '!23i94260020!23i100799651!23i72549439',
  },
  {
    ruleId: 4,
    name: 'raster-firstpaint-z17',
    why: 'a second zoom level, so the rule is not accidentally z12-shaped',
    source: 'extension/background.js RULE_SAMPLES[4]',
    resourceType: 'image',
    url:
      'https://www.google.com/maps/vt/pb=!1m4!1m3!1i17!2i30812!3i54180!2m3!1e0!2sm!3i789555512' +
      '!3m8!2sen!3sus!5e1105!12m4!1e68!2m2!1sset!2sRoadmap!4e0!5m1!1e0!23i100818990',
    expect:
      'https://www.google.com/maps/vt/pb=!1m4!1m3!1i17!2i30812!3i54180!2m3!1e0!2sm!3i789555512' +
      '!3m8!2sen!3sus!5e1105!12m4!1e68!2m2!1sset!2sRoadmapDark!4e0!5m1!1e0!23i100818990',
  },
  {
    ruleId: 4,
    name: 'raster-maps-google-com',
    why: 'the host is a regex wildcard; maps.google.com must be covered too',
    source: 'same shape as the z17 capture, host swapped -- host_permissions list maps.google.com',
    resourceType: 'image',
    url:
      'https://maps.google.com/maps/vt/pb=!1m4!1m3!1i17!2i30812!3i54180!2m3!1e0!2sm!3i789555512' +
      '!3m8!2sen!3sus!5e1105!12m4!1e68!2m2!1sset!2sRoadmap!4e0!5m1!1e0',
    expect:
      'https://maps.google.com/maps/vt/pb=!1m4!1m3!1i17!2i30812!3i54180!2m3!1e0!2sm!3i789555512' +
      '!3m8!2sen!3sus!5e1105!12m4!1e68!2m2!1sset!2sRoadmapDark!4e0!5m1!1e0',
  },
];

/** URLs no rule may rewrite. Each carries the failure it is guarding against. */
export const MUST_NOT_MATCH = [
  {
    name: 'legend-already-dark',
    guards: 'redirect loop -- rule 1 re-matching its own output',
    url: `https://www.gstatic.com/maps/res/CompactLegend-RoadmapDark-${LEGEND_V}`,
  },
  {
    name: 'legend-terrain-already-dark',
    guards: 'redirect loop -- rule 2 re-matching its own output',
    url: `https://www.gstatic.com/maps/res/CompactLegend-TerrainDark-${LEGEND_V}`,
  },
  {
    name: 'legend-roadmap-satellite',
    guards:
      'satellite base map. "RoadmapSatellite" starts with "Roadmap"; a rule that did not ' +
      'require the following "-" would rewrite it to a style name that does not exist. It is also ' +
      "the extension's own version-liveness canary, which only works while no rule perturbs it.",
    source: 'served HTTP 200 alongside the others -- verified live 2026-08-07',
    url: `https://www.gstatic.com/maps/res/CompactLegend-RoadmapSatellite-${LEGEND_V}`,
  },
  {
    name: 'legend-other-asset',
    guards: 'unrelated gstatic maps resources',
    url: 'https://www.gstatic.com/maps/res/api/2/main.js',
  },
  {
    name: 'raster-already-dark',
    guards: 'redirect loop -- rule 4 re-matching its own output',
    url:
      'https://www.google.com/maps/vt/pb=!1m4!1m3!1i12!2i962!3i1693!2m3!1e0!2sm!3i789555512' +
      '!3m8!2sen!3sus!5e1105!12m4!1e68!2m2!1sset!2sRoadmapDark!4e0!5m1!1e0',
  },
  {
    name: 'stream-already-dark',
    guards: 'redirect loop -- rule 3 re-matching its own output',
    url:
      'https://www.google.com/maps/vt/stream/pb=!1m7!8m6!1m3!1i12!2i960!3i1691!2i6!3x16777215' +
      '!2m3!1e0!2sm!3i790555512!3m8!2sen!3sus!5e1105!12m4!1e68!2m2!1sset!2sRoadmapDark!4e1!5m1!1e0',
  },
  {
    name: 'raster-terrain-already-dark',
    guards:
      'redirect loop on the Terrain arm -- rule 4 re-matching its own output. This is the ' +
      'DIVERGING kind: the rewrite would produce TerrainDarkDark, then TerrainDarkDarkDark, ' +
      'never repeating a URL, so it must be caught here at one hop rather than by a cycle ' +
      'detector that waits for a repeat.',
    source: 'the terrain-raster must-match entry, after the substitution rule 4 performs on it',
    derived: true,
    url:
      'https://www.google.com/maps/vt/pb=!1m4!1m3!1i17!2i30812!3i54180!2m3!1e0!2sm!3i789555512' +
      '!3m8!2sen!3sus!5e1105!12m4!1e68!2m2!1sset!2sTerrainDark!4e0!5m1!1e0!23i100818990',
  },
  {
    name: 'stream-terrain-already-dark',
    guards: 'redirect loop on the Terrain arm -- rule 3 re-matching its own output',
    source: 'the terrain-stream must-match entry, after the substitution rule 3 performs on it',
    derived: true,
    url:
      'https://www.google.com/maps/vt/stream/pb=!1m7!8m6!1m3!1i12!2i960!3i1691!2i6!3x16777215' +
      '!2m3!1e0!2sm!3i790555512!3m8!2sen!3sus!5e1105!12m4!1e68!2m2!1sset!2sTerrainDark!4e1!5m1!1e0',
  },
  {
    name: 'proto-tile',
    guards:
      'the mapcore transport. Its style token is a length-prefixed protobuf string; a regex ' +
      'substitution cannot recompute the length prefixes, so a rule that "matched" it would ' +
      'produce a corrupt request rather than a dark one.',
    source: 'test/experiments/transport-arm/data/proto-urls-control.txt (verbatim capture)',
    url:
      'https://www.google.com/maps/vt/proto?bpb=Cg0KCAgMEMUHGJ4NygEAEg8IABi_hD0iBwoFbmRsY2MaIhI' +
      'CZW4aAnVzKNEIYhIIRBIOCgNzZXQSB1JvYWRtYXCgAQEgASoFLQAAgD8yOQgMEAIwADgBQAKIAQHSAQQIASAB4AEG' +
      'gAIBuAIByAIB2AIB6AIBkAMBsAMB4AMBmgQECAEQAcgFAaIBBhgBMAF4AboBes7FU9HFU7KsVLrdqAK1ru8Elbq2F' +
      'umSuyLqkrsi7JK7Ir-IzCK99PgstJb5LNT0hTCuwIkwzsVT0cVTut2oAu6f7wSyrFSl_rcWlbq2FumSuyLqkrsi7J' +
      'K7Ir_ExiLZk_gsvfT4LMCE3yK7oe8EtJb5LKOpiDC_iMwi2gEA4AGVBoACAQ&authuser=0',
  },
  {
    name: 'maps-document',
    guards: 'the Maps HTML document itself -- rewriting it would break the whole page',
    url: 'https://www.google.com/maps/@29.7604,-95.3698,12z',
  },
  {
    name: 'maps-place-document',
    guards: 'a place URL that literally contains the word Roadmap-adjacent text in a query',
    url: 'https://www.google.com/maps/search/Roadmap+cafe/@29.7604,-95.3698,12z',
  },
  {
    name: 'poi-icon',
    guards: 'POI icon sprites -- inverting these is what makes generic dark-mode extensions look broken',
    url: 'https://www.google.com/maps/vt/icon/name=assets/icons/poi/tactile/pinlet_shadow-2-medium.png',
  },
  {
    name: 'imagery-thumb',
    guards: 'satellite imagery tiles, which must stay photographic',
    url: 'https://www.google.com/maps/vt/pb=!1m5!1m4!1i12!2i962!3i1693!4i256!2m3!1e0!2ssat!3i0',
  },
  {
    name: 'non-google-host-legend-lookalike',
    guards: 'a hostile lookalike host must not be rewritten (rule 1 is host-anchored)',
    url: `https://evil.example.com/maps/res/CompactLegend-Roadmap-${LEGEND_V}`,
  },
  {
    name: 'non-google-host-raster-lookalike',
    guards:
      'rules 3 and 4 use `https://[^/]+/maps/vt/...`, which is host-agnostic by design (regional ' +
      'google.<cctld> domains). Host scoping therefore comes from host_permissions + ' +
      'declarativeNetRequestWithHostAccess, NOT from the regex. This entry documents that the ' +
      'regex alone does not scope the host, so if host_permissions is ever widened the rules ' +
      'widen with it.',
    url:
      'https://evil.example.com/maps/vt/pb=!1m4!1m3!1i12!2i962!3i1693!2m3!1e0!2sm!3i789555512' +
      '!3m8!2sen!3sus!5e1105!12m4!1e68!2m2!1sset!2sRoadmap!4e0!5m1!1e0',
    expectedToMatchRegexAnyway: true,
  },
];

/**
 * The regexFilter that Chrome silently refuses to compile.
 * Quoted verbatim, with Chrome's own error text, from
 * test/experiments/transport-arm/data/dnr-bench.json (entry "A-anchored-hex").
 */
export const KNOWN_BAD_REGEX_FILTER =
  '^(https://www\\.gstatic\\.com/maps/res/CompactLegend-)Roadmap(-[0-9a-f]{32})$';

export const KNOWN_BAD_CHROME_ERROR =
  'Rule with id 101 was skipped as the "regexFilter" value exceeded the 2KB memory limit when compiled.';

export const LEGEND_VERSIONS = [LEGEND_V2, LEGEND_V];
export const LEGEND_STYLES_LIVE = ['Roadmap', 'RoadmapDark', 'Terrain', 'TerrainDark', 'RoadmapSatellite'];
export const LEGEND_STYLES_DEAD = ['RoadmapNoSuchStyle', 'RoadmapDarkDark', 'Nonsense'];
