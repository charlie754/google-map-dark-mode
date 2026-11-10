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
/** Live on 2026-11-09, when the Transit palette (rule 5) was first captured. */
const LEGEND_V3 = '5e6bae4931cec7c0849f0477025453b8';

/**
 * Transit-layer captures, 2026-11-09 (google.com/maps, Layers > Transit, Chromium
 * 1234 and Firefox 153/159, verbatim from the request log of the 1.0.5 probe; the
 * tile URLs are truncated before the trailing `!23i` experiment ids, which no
 * rule reads). Transit does not overlay the Roadmap palette -- it swaps the whole
 * base map to its own `TransitFocused` style, on every transport.
 */
const TRANSIT_STREAM =
  'https://www.google.com/maps/vt/stream/pb=!1m7!8m6!1m3!1i14!2i4822!3i6156!2i6!3x16777215' +
  '!2m3!1e0!2sm!3i803569006!2m6!1e2!2stransit!3i999999!4m2!1ssp!2s2!3m8!2sen!3sus!5e1105' +
  '!12m4!1e68!2m2!1sset!2sTransitFocused!4e1!6m9!1e12!2i2!26m1!1b1!28e3!39b1!44e2!50e0!71b1';
const TRANSIT_RASTER =
  'https://www.google.com/maps/vt/pb=!1m4!1m3!1i14!2i4824!3i6157!2m3!1e0!2sm!3i803568952' +
  '!2m6!1e2!2stransit!3i999999!4m2!1ssp!2s2!3m8!2sen!3sus!5e1105!12m4!1e68!2m2!1sset' +
  '!2sTransitFocused!4e0!5m1!1e0!23i1368782';
const darkTransit = (u) => u.replace('!2sTransitFocused!', '!2sTransitFocusedDark!');

/**
 * Vector terrain, 2026-11-09. Google's live Maps config (the protobuf in the page
 * HTML, google.com/maps?hl=zh-TW) lists `CompactLegend-TerrainVectorClient-<v>` and
 * `CompactLegend-TerrainVectorClientDark-<v>` (both HTTP 200, ~2 MB) beside the
 * classic Terrain pair. Rule 2 was `CompactLegend-)Terrain(-.*)$`, which cannot
 * match `TerrainVectorClient-`, so a client that renders terrain from the vector
 * palette got Google's light terrain: the "Terrain on is still white in Firefox"
 * report from Windows. The tile URLs below are the captured Terrain ones with the
 * style token swapped (derived): the token sits in the same `!1sset!2s<Style>!` slot.
 */
const TVC_STREAM =
  'https://www.google.com/maps/vt/stream/pb=!1m7!8m6!1m3!1i13!2i1317!3i3175!2i6!3x16777215' +
  '!2m3!1e0!2sm!3i803569114!2m2!1e6!2scontours!2m2!1e5!2sshading!3m8!2szh-TW!3sus!5e1105' +
  '!12m4!1e68!2m2!1sset!2sTerrainVectorClient!4e1!6m9!1e12!2i2!26m1!1b1!28e3!39b1!44e2!50e0!71b1';
const TVC_RASTER =
  'https://www.google.com/maps/vt/pb=!1m4!1m3!1i13!2i1317!3i3175!2m3!1e0!2sm!3i803569114' +
  '!2m2!1e6!2scontours!2m2!1e5!2sshading!3m8!2szh-TW!3sus!5e1105!12m4!1e68!2m2!1sset' +
  '!2sTerrainVectorClient!4e0!5m1!1e0!23i1368782';
const darkTvc = (u) => u.replace('!2sTerrainVectorClient!', '!2sTerrainVectorClientDark!');


/**
 * mapcore Terrain relief tiles, 2026-11-09 (Chromium, WebGL renderer, San Jose,
 * Layers > Terrain). The relief layer (shading + contours) is a proto request whose
 * style is a protobuf string inside base64url; rules 6-8 swap it with a same-length
 * rewrite (tools/proto-terrain-rules.mjs). z11 is verbatim from the capture; z9 and
 * z5 are that request with only the tile-coordinate varints re-encoded (derived),
 * which is exactly what moves the rewritten region to the other two base64
 * alignments. All three, and their rewrites, answered HTTP 200 from Google.
 */
const PROTO_TERRAIN = {
  "6": {
    "z": 9,
    "url": "https://www.google.com/maps/vt/proto?bpb=CgwKBwgJEFMYxgHKAQASCwgFEgdzaGFkaW5nEgwIBhIIY29udG91cnMSCQgAEgFtGL-EPRouEgJlbhoCdXMo0QhiAghDYgIIP2ICCANiEghEEg4KA3NldBIHVGVycmFpbqABASAAKgkIAC0AAIA_MAEyLwgMEAIwADgBQAKIAQHgAQaAAgG4AgHIAgHYAgHoAgGQAwHgAwGaBAQIARAByAUBkgECCAG6AWbOxVPRxVOyrFS63agC-LfvBJW6thbpkrsi6pK7IuySuyK_iMwivfT4LO3zhTDOxVPRxVO63agC7p_vBLKsVKX-txaVurYW6ZK7IuqSuyLskrsivfT4LMCE3yLt84Uwo6mIML-IzCLaAQDgAaMGgAIB",
    "expect": "https://www.google.com/maps/vt/proto?bpb=CgwKBwgJEFMYxgHKAQASCwgFEgdzaGFkaW5nEgwIBhIIY29udG91cnMSCQgAEgFtGL-EPRouEgJlbhoCdXMo0QhiAghDYgIIA2IWCEQSEgoDc2V0EgtUZXJyYWluRGFya6ABASAAKgkIAC0AAIA_MAEyLwgMEAIwADgBQAKIAQHgAQaAAgG4AgHIAgHYAgHoAgGQAwHgAwGaBAQIARAByAUBkgECCAG6AWbOxVPRxVOyrFS63agC-LfvBJW6thbpkrsi6pK7IuySuyK_iMwivfT4LO3zhTDOxVPRxVO63agC7p_vBLKsVKX-txaVurYW6ZK7IuqSuyLskrsivfT4LMCE3yLt84Uwo6mIML-IzCLaAQDgAaMGgAIB"
  },
  "7": {
    "z": 11,
    "url": "https://www.google.com/maps/vt/proto?bpb=Cg0KCAgLEMwCGJwGygEAEgsIBRIHc2hhZGluZxIMCAYSCGNvbnRvdXJzEgkIABIBbRi_hD0aLhICZW4aAnVzKNEIYgIIQ2ICCD9iAggDYhIIRBIOCgNzZXQSB1RlcnJhaW6gAQEgACoJCAAtAACAPzABMi8IDBACMAA4AUACiAEB4AEGgAIBuAIByAIB2AIB6AIBkAMB4AMBmgQECAEQAcgFAZIBAggBugFmzsVT0cVTsqxUut2oAvi37wSVurYW6ZK7IuqSuyLskrsiv4jMIr30-Czt84UwzsVT0cVTut2oAu6f7wSyrFSl_rcWlbq2FumSuyLqkrsi7JK7Ir30-CzAhN8i7fOFMKOpiDC_iMwi2gEA4AGjBoACAQ",
    "expect": "https://www.google.com/maps/vt/proto?bpb=Cg0KCAgLEMwCGJwGygEAEgsIBRIHc2hhZGluZxIMCAYSCGNvbnRvdXJzEgkIABIBbRi_hD0aLhICZW4aAnVzKNEIYgIIQ2ICCANiFghEEhIKA3NldBILVGVycmFpbkRhcmugAQEgACoJCAAtAACAPzABMi8IDBACMAA4AUACiAEB4AEGgAIBuAIByAIB2AIB6AIBkAMB4AMBmgQECAEQAcgFAZIBAggBugFmzsVT0cVTsqxUut2oAvi37wSVurYW6ZK7IuqSuyLskrsiv4jMIr30-Czt84UwzsVT0cVTut2oAu6f7wSyrFSl_rcWlbq2FumSuyLqkrsi7JK7Ir30-CzAhN8i7fOFMKOpiDC_iMwi2gEA4AGjBoACAQ"
  },
  "8": {
    "z": 5,
    "url": "https://www.google.com/maps/vt/proto?bpb=CgsKBggFEAoYGMoBABILCAUSB3NoYWRpbmcSDAgGEghjb250b3VycxIJCAASAW0Yv4Q9Gi4SAmVuGgJ1cyjRCGICCENiAgg_YgIIA2ISCEQSDgoDc2V0EgdUZXJyYWluoAEBIAAqCQgALQAAgD8wATIvCAwQAjAAOAFAAogBAeABBoACAbgCAcgCAdgCAegCAZADAeADAZoEBAgBEAHIBQGSAQIIAboBZs7FU9HFU7KsVLrdqAL4t-8Elbq2FumSuyLqkrsi7JK7Ir-IzCK99Pgs7fOFMM7FU9HFU7rdqALun-8EsqxUpf63FpW6thbpkrsi6pK7IuySuyK99PgswITfIu3zhTCjqYgwv4jMItoBAOABowaAAgE",
    "expect": "https://www.google.com/maps/vt/proto?bpb=CgsKBggFEAoYGMoBABILCAUSB3NoYWRpbmcSDAgGEghjb250b3VycxIJCAASAW0Yv4Q9Gi4SAmVuGgJ1cyjRCGICCENiAggDYhYIRBISCgNzZXQSC1RlcnJhaW5EYXJroAEBIAAqCQgALQAAgD8wATIvCAwQAjAAOAFAAogBAeABBoACAbgCAcgCAdgCAegCAZADAeADAZoEBAgBEAHIBQGSAQIIAboBZs7FU9HFU7KsVLrdqAL4t-8Elbq2FumSuyLqkrsi7JK7Ir-IzCK99Pgs7fOFMM7FU9HFU7rdqALun-8EsqxUpf63FpW6thbpkrsi6pK7IuySuyK99PgswITfIu3zhTCjqYgwv4jMItoBAOABowaAAgE"
  }
};

/**
 * Rules 9-17: the server-styled ("baked") mapcore tiles -- the variant whose style
 * set entry carries options 5 and 6 (`28 01 30 01`) and which never fetches a
 * CompactLegend. Live Chrome mapcore capture at Mountain View, 2026-11-09; the ones
 * marked verbatim are byte-for-byte as captured, the others have only the tile
 * coordinates re-encoded (which is what moves the base64 alignment).
 */
const PROTO_BAKED = {
  "9": {
    "style": "Roadmap",
    "z": 9,
    "verbatim": true,
    "url": "https://www.google.com/maps/vt/proto?bpb=CgwKBwgJEFIYxgHKAQASEwgCEgdjcmlzaXMy-o3FjAsCCAMaJhICZW4aAnVzKNEIYhYIRBIOCgNzZXQSB1JvYWRtYXAoATABoAEBIAEyOwgMEAIwADgBQAKIAQHgAQaAAgG4AgHAAgHIAgHYAgHoAgGQAwLIAwHgAwHwAwn4AxaaBAQIARAByAUBogECEAO6AW7OxVPRxVOyrFS63agCh7LvBPW37wSVurYW6ZK7IuqSuyLskrsiv4jMIr30-Czt84UwnvSFMM7FU9HFU7rdqALun-8EsqxUpf63FpW6thbpkrsi6pK7IuySuyK99PgswITfIu3zhTCjqYgwv4jMItoBAOABowaAAgE&authuser=0",
    "expect": "https://www.google.com/maps/vt/proto?bpb=CgwKBwgJEFIYxgHKAQASEwgCEgdjcmlzaXMy-o3FjAsCCAMaJhICZW4aAnVzKNEIYhYIRBISCgNzZXQSC1JvYWRtYXBEYXJroAEBIAEyOwgMEAIwADgBQAKIAQHgAQaAAgG4AgHAAgHIAgHYAgHoAgGQAwLIAwHgAwHwAwn4AxaaBAQIARAByAUBogECEAO6AW7OxVPRxVOyrFS63agCh7LvBPW37wSVurYW6ZK7IuqSuyLskrsiv4jMIr30-Czt84UwnvSFMM7FU9HFU7rdqALun-8EsqxUpf63FpW6thbpkrsi6pK7IuySuyK99PgswITfIu3zhTCjqYgwv4jMItoBAOABowaAAgE&authuser=0"
  },
  "10": {
    "style": "Roadmap",
    "z": 4,
    "verbatim": true,
    "url": "https://www.google.com/maps/vt/proto?bpb=CgsKBggEEAIYBsoBABIPCAAYv4Q9IgcKBW5kbGNjGiYSAmVuGgJ1cyjRCGIWCEQSDgoDc2V0EgdSb2FkbWFwKAEwAaABASABKgUtAACAPzI5CAwQAjAAOAFAAogBAdIBBAgBIAHgAQaAAgG4AgHIAgHYAgHoAgGQAwGwAwHgAwGaBAQIARAByAUBogEGGAEwAXgBugFuzsVT0cVTsqxUut2oAoey7wT1t-8Elbq2FumSuyLqkrsi7JK7Ir-IzCK99Pgs7fOFMJ70hTDOxVPRxVO63agC7p_vBLKsVKX-txaVurYW6ZK7IuqSuyLskrsivfT4LMCE3yLt84Uwo6mIML-IzCLaAQDgAaMGgAIB&authuser=0",
    "expect": "https://www.google.com/maps/vt/proto?bpb=CgsKBggEEAIYBsoBABIPCAAYv4Q9IgcKBW5kbGNjGiYSAmVuGgJ1cyjRCGIWCEQSEgoDc2V0EgtSb2FkbWFwRGFya6ABASABKgUtAACAPzI5CAwQAjAAOAFAAogBAdIBBAgBIAHgAQaAAgG4AgHIAgHYAgHoAgGQAwGwAwHgAwGaBAQIARAByAUBogEGGAEwAXgBugFuzsVT0cVTsqxUut2oAoey7wT1t-8Elbq2FumSuyLqkrsi7JK7Ir-IzCK99Pgs7fOFMJ70hTDOxVPRxVO63agC7p_vBLKsVKX-txaVurYW6ZK7IuqSuyLskrsivfT4LMCE3yLt84Uwo6mIML-IzCLaAQDgAaMGgAIB&authuser=0"
  },
  "11": {
    "style": "Roadmap",
    "z": 5,
    "verbatim": false,
    "url": "https://www.google.com/maps/vt/proto?bpb=CgsKBggFEAUYDMoBABITCAISB2NyaXNpczL6jcWMCwIIAxomEgJlbhoCdXMo0QhiFghEEg4KA3NldBIHUm9hZG1hcCgBMAGgAQEgATI7CAwQAjAAOAFAAogBAeABBoACAbgCAcACAcgCAdgCAegCAZADAsgDAeADAfADCfgDFpoEBAgBEAHIBQGiAQIQA7oBbs7FU9HFU7KsVLrdqAKHsu8E9bfvBJW6thbpkrsi6pK7IuySuyK_iMwivfT4LO3zhTCe9IUwzsVT0cVTut2oAu6f7wSyrFSl_rcWlbq2FumSuyLqkrsi7JK7Ir30-CzAhN8i7fOFMKOpiDC_iMwi2gEA4AGjBoACAQ&authuser=0",
    "expect": "https://www.google.com/maps/vt/proto?bpb=CgsKBggFEAUYDMoBABITCAISB2NyaXNpczL6jcWMCwIIAxomEgJlbhoCdXMo0QhiFghEEhIKA3NldBILUm9hZG1hcERhcmugAQEgATI7CAwQAjAAOAFAAogBAeABBoACAbgCAcACAcgCAdgCAegCAZADAsgDAeADAfADCfgDFpoEBAgBEAHIBQGiAQIQA7oBbs7FU9HFU7KsVLrdqAKHsu8E9bfvBJW6thbpkrsi6pK7IuySuyK_iMwivfT4LO3zhTCe9IUwzsVT0cVTut2oAu6f7wSyrFSl_rcWlbq2FumSuyLqkrsi7JK7Ir30-CzAhN8i7fOFMKOpiDC_iMwi2gEA4AGjBoACAQ&authuser=0"
  },
  "12": {
    "style": "TransitFocused",
    "z": 14,
    "verbatim": true,
    "url": "https://www.google.com/maps/vt/proto?bpb=Cg0KCAgOEMoUGNExygEACg0KCAgOEMoUGNIxygEACg0KCAgOEMoUGNMxygEACg0KCAgOEMoUGNQxygEACg0KCAgOEMsUGNExygEACg0KCAgOEMsUGNIxygEACg0KCAgOEMsUGNMxygEACg0KCAgOEMsUGNQxygEACg0KCAgOEMwUGNExygEACg0KCAgOEMwUGNIxygEACg0KCAgOEMwUGNMxygEACg0KCAgOEMwUGNQxygEACg0KCAgOEM0UGNExygEACg0KCAgOEM0UGNIxygEACg0KCAgOEM0UGNMxygEACg0KCAgOEM0UGNQxygEACg0KCAgOEM4UGNExygEACg0KCAgOEM4UGNIxygEACg0KCAgOEM4UGNMxygEACg0KCAgOEM4UGNQxygEACg0KCAgOEM8UGNExygEACg0KCAgOEM8UGNIxygEACg0KCAgOEM8UGNMxygEACg0KCAgOEM8UGNQxygEAEg8IAhIHdHJhbnNpdBi_hD0aLRICZW4aAnVzKNEIYh0IRBIVCgNzZXQSDlRyYW5zaXRGb2N1c2VkKAEwAaABASABMi8IDBACMAA4AUACiAEB4AEGgAIBuAIByAIB2AIB6AIBkAMB4AMBmgQECAEQAcgFAboBbs7FU9HFU7KsVLrdqAKHsu8E9bfvBJW6thbpkrsi6pK7IuySuyK_iMwivfT4LO3zhTCe9IUwzsVT0cVTut2oAu6f7wSyrFSl_rcWlbq2FumSuyLqkrsi7JK7Ir30-CzAhN8i7fOFMKOpiDC_iMwi2gEPotTb0g8JCgcKAnNwEgEy4AGjBoACAQ&authuser=0",
    "expect": "https://www.google.com/maps/vt/proto?bpb=Cg0KCAgOEMoUGNExygEACg0KCAgOEMoUGNIxygEACg0KCAgOEMoUGNMxygEACg0KCAgOEMoUGNQxygEACg0KCAgOEMsUGNExygEACg0KCAgOEMsUGNIxygEACg0KCAgOEMsUGNMxygEACg0KCAgOEMsUGNQxygEACg0KCAgOEMwUGNExygEACg0KCAgOEMwUGNIxygEACg0KCAgOEMwUGNMxygEACg0KCAgOEMwUGNQxygEACg0KCAgOEM0UGNExygEACg0KCAgOEM0UGNIxygEACg0KCAgOEM0UGNMxygEACg0KCAgOEM0UGNQxygEACg0KCAgOEM4UGNExygEACg0KCAgOEM4UGNIxygEACg0KCAgOEM4UGNMxygEACg0KCAgOEM4UGNQxygEACg0KCAgOEM8UGNExygEACg0KCAgOEM8UGNIxygEACg0KCAgOEM8UGNMxygEACg0KCAgOEM8UGNQxygEAEg8IAhIHdHJhbnNpdBi_hD0aLRICZW4aAnVzKNEIYh0IRBIZCgNzZXQSElRyYW5zaXRGb2N1c2VkRGFya6ABASABMi8IDBACMAA4AUACiAEB4AEGgAIBuAIByAIB2AIB6AIBkAMB4AMBmgQECAEQAcgFAboBbs7FU9HFU7KsVLrdqAKHsu8E9bfvBJW6thbpkrsi6pK7IuySuyK_iMwivfT4LO3zhTCe9IUwzsVT0cVTut2oAu6f7wSyrFSl_rcWlbq2FumSuyLqkrsi7JK7Ir30-CzAhN8i7fOFMKOpiDC_iMwi2gEPotTb0g8JCgcKAnNwEgEy4AGjBoACAQ&authuser=0"
  },
  "13": {
    "style": "TransitFocused",
    "z": 5,
    "verbatim": false,
    "url": "https://www.google.com/maps/vt/proto?bpb=CgsKBggFEAUYDMoBAAoNCggIDhDKFBjSMcoBAAoNCggIDhDKFBjTMcoBAAoNCggIDhDKFBjUMcoBAAoNCggIDhDLFBjRMcoBAAoNCggIDhDLFBjSMcoBAAoNCggIDhDLFBjTMcoBAAoNCggIDhDLFBjUMcoBAAoNCggIDhDMFBjRMcoBAAoNCggIDhDMFBjSMcoBAAoNCggIDhDMFBjTMcoBAAoNCggIDhDMFBjUMcoBAAoNCggIDhDNFBjRMcoBAAoNCggIDhDNFBjSMcoBAAoNCggIDhDNFBjTMcoBAAoNCggIDhDNFBjUMcoBAAoNCggIDhDOFBjRMcoBAAoNCggIDhDOFBjSMcoBAAoNCggIDhDOFBjTMcoBAAoNCggIDhDOFBjUMcoBAAoNCggIDhDPFBjRMcoBAAoNCggIDhDPFBjSMcoBAAoNCggIDhDPFBjTMcoBAAoNCggIDhDPFBjUMcoBABIPCAISB3RyYW5zaXQYv4Q9Gi0SAmVuGgJ1cyjRCGIdCEQSFQoDc2V0Eg5UcmFuc2l0Rm9jdXNlZCgBMAGgAQEgATIvCAwQAjAAOAFAAogBAeABBoACAbgCAcgCAdgCAegCAZADAeADAZoEBAgBEAHIBQG6AW7OxVPRxVOyrFS63agCh7LvBPW37wSVurYW6ZK7IuqSuyLskrsiv4jMIr30-Czt84UwnvSFMM7FU9HFU7rdqALun-8EsqxUpf63FpW6thbpkrsi6pK7IuySuyK99PgswITfIu3zhTCjqYgwv4jMItoBD6LU29IPCQoHCgJzcBIBMuABowaAAgE&authuser=0",
    "expect": "https://www.google.com/maps/vt/proto?bpb=CgsKBggFEAUYDMoBAAoNCggIDhDKFBjSMcoBAAoNCggIDhDKFBjTMcoBAAoNCggIDhDKFBjUMcoBAAoNCggIDhDLFBjRMcoBAAoNCggIDhDLFBjSMcoBAAoNCggIDhDLFBjTMcoBAAoNCggIDhDLFBjUMcoBAAoNCggIDhDMFBjRMcoBAAoNCggIDhDMFBjSMcoBAAoNCggIDhDMFBjTMcoBAAoNCggIDhDMFBjUMcoBAAoNCggIDhDNFBjRMcoBAAoNCggIDhDNFBjSMcoBAAoNCggIDhDNFBjTMcoBAAoNCggIDhDNFBjUMcoBAAoNCggIDhDOFBjRMcoBAAoNCggIDhDOFBjSMcoBAAoNCggIDhDOFBjTMcoBAAoNCggIDhDOFBjUMcoBAAoNCggIDhDPFBjRMcoBAAoNCggIDhDPFBjSMcoBAAoNCggIDhDPFBjTMcoBAAoNCggIDhDPFBjUMcoBABIPCAISB3RyYW5zaXQYv4Q9Gi0SAmVuGgJ1cyjRCGIdCEQSGQoDc2V0EhJUcmFuc2l0Rm9jdXNlZERhcmugAQEgATIvCAwQAjAAOAFAAogBAeABBoACAbgCAcgCAdgCAegCAZADAeADAZoEBAgBEAHIBQG6AW7OxVPRxVOyrFS63agCh7LvBPW37wSVurYW6ZK7IuqSuyLskrsiv4jMIr30-Czt84UwnvSFMM7FU9HFU7rdqALun-8EsqxUpf63FpW6thbpkrsi6pK7IuySuyK99PgswITfIu3zhTCjqYgwv4jMItoBD6LU29IPCQoHCgJzcBIBMuABowaAAgE&authuser=0"
  },
  "14": {
    "style": "TransitFocused",
    "z": 9,
    "verbatim": false,
    "url": "https://www.google.com/maps/vt/proto?bpb=CgwKBwgJEFIYxgHKAQAKDQoICA4QyhQY0jHKAQAKDQoICA4QyhQY0zHKAQAKDQoICA4QyhQY1DHKAQAKDQoICA4QyxQY0THKAQAKDQoICA4QyxQY0jHKAQAKDQoICA4QyxQY0zHKAQAKDQoICA4QyxQY1DHKAQAKDQoICA4QzBQY0THKAQAKDQoICA4QzBQY0jHKAQAKDQoICA4QzBQY0zHKAQAKDQoICA4QzBQY1DHKAQAKDQoICA4QzRQY0THKAQAKDQoICA4QzRQY0jHKAQAKDQoICA4QzRQY0zHKAQAKDQoICA4QzRQY1DHKAQAKDQoICA4QzhQY0THKAQAKDQoICA4QzhQY0jHKAQAKDQoICA4QzhQY0zHKAQAKDQoICA4QzhQY1DHKAQAKDQoICA4QzxQY0THKAQAKDQoICA4QzxQY0jHKAQAKDQoICA4QzxQY0zHKAQAKDQoICA4QzxQY1DHKAQASDwgCEgd0cmFuc2l0GL-EPRotEgJlbhoCdXMo0QhiHQhEEhUKA3NldBIOVHJhbnNpdEZvY3VzZWQoATABoAEBIAEyLwgMEAIwADgBQAKIAQHgAQaAAgG4AgHIAgHYAgHoAgGQAwHgAwGaBAQIARAByAUBugFuzsVT0cVTsqxUut2oAoey7wT1t-8Elbq2FumSuyLqkrsi7JK7Ir-IzCK99Pgs7fOFMJ70hTDOxVPRxVO63agC7p_vBLKsVKX-txaVurYW6ZK7IuqSuyLskrsivfT4LMCE3yLt84Uwo6mIML-IzCLaAQ-i1NvSDwkKBwoCc3ASATLgAaMGgAIB&authuser=0",
    "expect": "https://www.google.com/maps/vt/proto?bpb=CgwKBwgJEFIYxgHKAQAKDQoICA4QyhQY0jHKAQAKDQoICA4QyhQY0zHKAQAKDQoICA4QyhQY1DHKAQAKDQoICA4QyxQY0THKAQAKDQoICA4QyxQY0jHKAQAKDQoICA4QyxQY0zHKAQAKDQoICA4QyxQY1DHKAQAKDQoICA4QzBQY0THKAQAKDQoICA4QzBQY0jHKAQAKDQoICA4QzBQY0zHKAQAKDQoICA4QzBQY1DHKAQAKDQoICA4QzRQY0THKAQAKDQoICA4QzRQY0jHKAQAKDQoICA4QzRQY0zHKAQAKDQoICA4QzRQY1DHKAQAKDQoICA4QzhQY0THKAQAKDQoICA4QzhQY0jHKAQAKDQoICA4QzhQY0zHKAQAKDQoICA4QzhQY1DHKAQAKDQoICA4QzxQY0THKAQAKDQoICA4QzxQY0jHKAQAKDQoICA4QzxQY0zHKAQAKDQoICA4QzxQY1DHKAQASDwgCEgd0cmFuc2l0GL-EPRotEgJlbhoCdXMo0QhiHQhEEhkKA3NldBISVHJhbnNpdEZvY3VzZWREYXJroAEBIAEyLwgMEAIwADgBQAKIAQHgAQaAAgG4AgHIAgHYAgHoAgGQAwHgAwGaBAQIARAByAUBugFuzsVT0cVTsqxUut2oAoey7wT1t-8Elbq2FumSuyLqkrsi7JK7Ir-IzCK99Pgs7fOFMJ70hTDOxVPRxVO63agC7p_vBLKsVKX-txaVurYW6ZK7IuqSuyLskrsivfT4LMCE3yLt84Uwo6mIML-IzCLaAQ-i1NvSDwkKBwoCc3ASATLgAaMGgAIB&authuser=0"
  },
  "15": {
    "style": "Terrain",
    "z": 14,
    "verbatim": false,
    "url": "https://www.google.com/maps/vt/proto?bpb=Cg0KCAgOEMwUGNYxygEAEgsIBRIHc2hhZGluZxIMCAYSCGNvbnRvdXJzEgkIABIBbRi_hD0aMhICZW4aAnVzKNEIYgIIQ2ICCD9iAggDYhYIRBIOCgNzZXQSB1RlcnJhaW4oATABoAEBIAAqCQgALQAAgD8wATIvCAwQAjAAOAFAAogBAeABBoACAbgCAcgCAdgCAegCAZADAeADAZoEBAgBEAHIBQGSAQIIAboBbs7FU9HFU7KsVLrdqAKHsu8E9bfvBJW6thbpkrsi6pK7IuySuyK_iMwivfT4LO3zhTCe9IUwzsVT0cVTut2oAu6f7wSyrFSl_rcWlbq2FumSuyLqkrsi7JK7Ir30-CzAhN8i7fOFMKOpiDC_iMwi2gEA4AGjBoACAQ&authuser=0",
    "expect": "https://www.google.com/maps/vt/proto?bpb=Cg0KCAgOEMwUGNYxygEAEgsIBRIHc2hhZGluZxIMCAYSCGNvbnRvdXJzEgkIABIBbRi_hD0aMhICZW4aAnVzKNEIYgIIQ2ICCD9iAggDYhYIRBISCgNzZXQSC1RlcnJhaW5EYXJroAEBIAAqCQgALQAAgD8wATIvCAwQAjAAOAFAAogBAeABBoACAbgCAcgCAdgCAegCAZADAeADAZoEBAgBEAHIBQGSAQIIAboBbs7FU9HFU7KsVLrdqAKHsu8E9bfvBJW6thbpkrsi6pK7IuySuyK_iMwivfT4LO3zhTCe9IUwzsVT0cVTut2oAu6f7wSyrFSl_rcWlbq2FumSuyLqkrsi7JK7Ir30-CzAhN8i7fOFMKOpiDC_iMwi2gEA4AGjBoACAQ&authuser=0"
  },
  "16": {
    "style": "Terrain",
    "z": 1,
    "verbatim": true,
    "url": "https://www.google.com/maps/vt/proto?bpb=CgsKBggBEAAYAMoBABILCAUSB3NoYWRpbmcSDAgGEghjb250b3VycxIJCAASAW0Yv4Q9GjISAmVuGgJ1cyjRCGICCENiAgg_YgIIA2IWCEQSDgoDc2V0EgdUZXJyYWluKAEwAaABASAAKgkIAC0AAIA_MAEyLwgMEAIwADgBQAKIAQHgAQaAAgG4AgHIAgHYAgHoAgGQAwHgAwGaBAQIARAByAUBkgECCAG6AW7OxVPRxVOyrFS63agCh7LvBPW37wSVurYW6ZK7IuqSuyLskrsiv4jMIr30-Czt84UwnvSFMM7FU9HFU7rdqALun-8EsqxUpf63FpW6thbpkrsi6pK7IuySuyK99PgswITfIu3zhTCjqYgwv4jMItoBAOABowaAAgE&authuser=0",
    "expect": "https://www.google.com/maps/vt/proto?bpb=CgsKBggBEAAYAMoBABILCAUSB3NoYWRpbmcSDAgGEghjb250b3VycxIJCAASAW0Yv4Q9GjISAmVuGgJ1cyjRCGICCENiAgg_YgIIA2IWCEQSEgoDc2V0EgtUZXJyYWluRGFya6ABASAAKgkIAC0AAIA_MAEyLwgMEAIwADgBQAKIAQHgAQaAAgG4AgHIAgHYAgHoAgGQAwHgAwGaBAQIARAByAUBkgECCAG6AW7OxVPRxVOyrFS63agCh7LvBPW37wSVurYW6ZK7IuqSuyLskrsiv4jMIr30-Czt84UwnvSFMM7FU9HFU7rdqALun-8EsqxUpf63FpW6thbpkrsi6pK7IuySuyK99PgswITfIu3zhTCjqYgwv4jMItoBAOABowaAAgE&authuser=0"
  },
  "17": {
    "style": "Terrain",
    "z": 9,
    "verbatim": false,
    "url": "https://www.google.com/maps/vt/proto?bpb=CgwKBwgJEFIYxgHKAQASCwgFEgdzaGFkaW5nEgwIBhIIY29udG91cnMSCQgAEgFtGL-EPRoyEgJlbhoCdXMo0QhiAghDYgIIP2ICCANiFghEEg4KA3NldBIHVGVycmFpbigBMAGgAQEgACoJCAAtAACAPzABMi8IDBACMAA4AUACiAEB4AEGgAIBuAIByAIB2AIB6AIBkAMB4AMBmgQECAEQAcgFAZIBAggBugFuzsVT0cVTsqxUut2oAoey7wT1t-8Elbq2FumSuyLqkrsi7JK7Ir-IzCK99Pgs7fOFMJ70hTDOxVPRxVO63agC7p_vBLKsVKX-txaVurYW6ZK7IuqSuyLskrsivfT4LMCE3yLt84Uwo6mIML-IzCLaAQDgAaMGgAIB&authuser=0",
    "expect": "https://www.google.com/maps/vt/proto?bpb=CgwKBwgJEFIYxgHKAQASCwgFEgdzaGFkaW5nEgwIBhIIY29udG91cnMSCQgAEgFtGL-EPRoyEgJlbhoCdXMo0QhiAghDYgIIP2ICCANiFghEEhIKA3NldBILVGVycmFpbkRhcmugAQEgACoJCAAtAACAPzABMi8IDBACMAA4AUACiAEB4AEGgAIBuAIByAIB2AIB6AIBkAMB4AMBmgQECAEQAcgFAZIBAggBugFuzsVT0cVTsqxUut2oAoey7wT1t-8Elbq2FumSuyLqkrsi7JK7Ir-IzCK99Pgs7fOFMJ70hTDOxVPRxVO63agC7p_vBLKsVKX-txaVurYW6ZK7IuqSuyLskrsivfT4LMCE3yLt84Uwo6mIML-IzCLaAQDgAaMGgAIB&authuser=0"
  }
};

/** URLs each rule id must rewrite, and what it must rewrite them to. */
export const MUST_MATCH = [
  {
    ruleId: 9,
    name: 'proto-baked-roadmap-z9',
    why: 'server-styled mapcore Roadmap tile: colours baked in by Google, no CompactLegend is fetched',
    source: 'live mapcore capture 2026-11-09; background.js RULE_SAMPLES[9]',
    resourceType: 'xmlhttprequest',
    url: PROTO_BAKED[9].url,
    expect: PROTO_BAKED[9].expect,
  },
  {
    ruleId: 10,
    name: 'proto-baked-roadmap-z4',
    why: 'server-styled mapcore Roadmap tile: colours baked in by Google, no CompactLegend is fetched',
    source: 'live mapcore capture 2026-11-09; background.js RULE_SAMPLES[10]',
    resourceType: 'xmlhttprequest',
    url: PROTO_BAKED[10].url,
    expect: PROTO_BAKED[10].expect,
  },
  {
    ruleId: 11,
    name: 'proto-baked-roadmap-z5',
    why: 'server-styled mapcore Roadmap tile: colours baked in by Google, no CompactLegend is fetched',
    source: 'live mapcore capture 2026-11-09 (tile coordinates re-encoded); background.js RULE_SAMPLES[11]',
    derived: true,
    resourceType: 'xmlhttprequest',
    url: PROTO_BAKED[11].url,
    expect: PROTO_BAKED[11].expect,
  },
  {
    ruleId: 12,
    name: 'proto-baked-transitfocused-z14',
    why: 'server-styled mapcore TransitFocused tile: colours baked in by Google, no CompactLegend is fetched',
    source: 'live mapcore capture 2026-11-09; background.js RULE_SAMPLES[12]',
    resourceType: 'xmlhttprequest',
    url: PROTO_BAKED[12].url,
    expect: PROTO_BAKED[12].expect,
  },
  {
    ruleId: 13,
    name: 'proto-baked-transitfocused-z5',
    why: 'server-styled mapcore TransitFocused tile: colours baked in by Google, no CompactLegend is fetched',
    source: 'live mapcore capture 2026-11-09 (tile coordinates re-encoded); background.js RULE_SAMPLES[13]',
    derived: true,
    resourceType: 'xmlhttprequest',
    url: PROTO_BAKED[13].url,
    expect: PROTO_BAKED[13].expect,
  },
  {
    ruleId: 14,
    name: 'proto-baked-transitfocused-z9',
    why: 'server-styled mapcore TransitFocused tile: colours baked in by Google, no CompactLegend is fetched',
    source: 'live mapcore capture 2026-11-09 (tile coordinates re-encoded); background.js RULE_SAMPLES[14]',
    derived: true,
    resourceType: 'xmlhttprequest',
    url: PROTO_BAKED[14].url,
    expect: PROTO_BAKED[14].expect,
  },
  {
    ruleId: 15,
    name: 'proto-baked-terrain-z14',
    why: 'server-styled mapcore Terrain tile: colours baked in by Google, no CompactLegend is fetched',
    source: 'live mapcore capture 2026-11-09 (tile coordinates re-encoded); background.js RULE_SAMPLES[15]',
    derived: true,
    resourceType: 'xmlhttprequest',
    url: PROTO_BAKED[15].url,
    expect: PROTO_BAKED[15].expect,
  },
  {
    ruleId: 16,
    name: 'proto-baked-terrain-z1',
    why: 'server-styled mapcore Terrain tile: colours baked in by Google, no CompactLegend is fetched',
    source: 'live mapcore capture 2026-11-09; background.js RULE_SAMPLES[16]',
    resourceType: 'xmlhttprequest',
    url: PROTO_BAKED[16].url,
    expect: PROTO_BAKED[16].expect,
  },
  {
    ruleId: 17,
    name: 'proto-baked-terrain-z9',
    why: 'server-styled mapcore Terrain tile: colours baked in by Google, no CompactLegend is fetched',
    source: 'live mapcore capture 2026-11-09 (tile coordinates re-encoded); background.js RULE_SAMPLES[17]',
    derived: true,
    resourceType: 'xmlhttprequest',
    url: PROTO_BAKED[17].url,
    expect: PROTO_BAKED[17].expect,
  },
  {
    ruleId: 6,
    name: 'proto-terrain-relief-z9',
    why: 'mapcore Terrain relief tile (hillshade + landcover + contours); its style lives in the bpb protobuf',
    source: 'live mapcore capture 2026-11-09 (tile coordinates re-encoded); background.js RULE_SAMPLES[6]',
    derived: true,
    resourceType: 'xmlhttprequest',
    url: PROTO_TERRAIN[6].url,
    expect: PROTO_TERRAIN[6].expect,
  },
  {
    ruleId: 7,
    name: 'proto-terrain-relief-z11',
    why: 'mapcore Terrain relief tile (hillshade + landcover + contours); its style lives in the bpb protobuf',
    source: 'live mapcore capture 2026-11-09; background.js RULE_SAMPLES[7]',
    resourceType: 'xmlhttprequest',
    url: PROTO_TERRAIN[7].url,
    expect: PROTO_TERRAIN[7].expect,
  },
  {
    ruleId: 8,
    name: 'proto-terrain-relief-z5',
    why: 'mapcore Terrain relief tile (hillshade + landcover + contours); its style lives in the bpb protobuf',
    source: 'live mapcore capture 2026-11-09 (tile coordinates re-encoded); background.js RULE_SAMPLES[8]',
    derived: true,
    resourceType: 'xmlhttprequest',
    url: PROTO_TERRAIN[8].url,
    expect: PROTO_TERRAIN[8].expect,
  },
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
    ruleId: 5,
    name: 'legend-transit',
    why:
      'Layers > Transit makes Maps fetch its own TransitFocused palette instead of Roadmap; ' +
      'before rule 5 existed this request went through untouched and the Transit map was light ' +
      'in both engines (the 1.0.5 bug report)',
    source: 'captured 2026-11-09, Chromium and Firefox, Layers > Transit; TransitFocusedDark 200 live',
    resourceType: 'xmlhttprequest',
    url: `https://www.gstatic.com/maps/res/CompactLegend-TransitFocused-${LEGEND_V3}`,
    expect: `https://www.gstatic.com/maps/res/CompactLegend-TransitFocusedDark-${LEGEND_V3}`,
  },
  {
    ruleId: 2,
    name: 'legend-terrain-vector-client',
    why:
      'the vector terrain palette Google lists next to TerrainVectorClientDark; rule 2 used to ' +
      'require "Terrain-" and let it through light (Terrain on, Firefox on Windows, 1.0.5)',
    source: 'live Maps config 2026-11-09 (page HTML protobuf); both legends HTTP 200',
    resourceType: 'xmlhttprequest',
    url: `https://www.gstatic.com/maps/res/CompactLegend-TerrainVectorClient-${LEGEND_V3}`,
    expect: `https://www.gstatic.com/maps/res/CompactLegend-TerrainVectorClientDark-${LEGEND_V3}`,
  },
  {
    ruleId: 3,
    name: 'terrain-vector-client-stream',
    why: 'the TerrainVectorClient token on the stream transport',
    source: 'derived: captured zh-TW Terrain tile with the style token swapped',
    derived: true,
    resourceType: 'xmlhttprequest',
    url: TVC_STREAM,
    expect: darkTvc(TVC_STREAM),
  },
  {
    ruleId: 4,
    name: 'terrain-vector-client-raster',
    why: 'the TerrainVectorClient token on the first-paint raster grid',
    source: 'derived: captured zh-TW Terrain tile with the style token swapped',
    derived: true,
    resourceType: 'image',
    url: TVC_RASTER,
    expect: darkTvc(TVC_RASTER),
  },
  {
    ruleId: 3,
    name: 'transit-stream',
    why: 'the TransitFocused base map on the stream transport -- the third arm of the alternation',
    source: 'captured 2026-11-09 (TRANSIT_STREAM above); identical to background.js RULE_SAMPLES[3] "vector-stream-transit"',
    resourceType: 'xmlhttprequest',
    url: TRANSIT_STREAM,
    expect: darkTransit(TRANSIT_STREAM),
  },
  {
    ruleId: 4,
    name: 'transit-raster',
    why: 'the TransitFocused base map on the first-paint raster grid',
    source: 'captured 2026-11-09 (TRANSIT_RASTER above); identical to background.js RULE_SAMPLES[4] "raster-firstpaint-transit"',
    resourceType: 'image',
    url: TRANSIT_RASTER,
    expect: darkTransit(TRANSIT_RASTER),
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
    name: 'proto-baked-roadmap-z9-already-dark',
    guards: 'redirect loop -- rule 9 re-matching its own RoadmapDark output',
    url: PROTO_BAKED[9].expect,
  },
  {
    name: 'proto-baked-roadmap-z4-already-dark',
    guards: 'redirect loop -- rule 10 re-matching its own RoadmapDark output',
    url: PROTO_BAKED[10].expect,
  },
  {
    name: 'proto-baked-roadmap-z5-already-dark',
    guards: 'redirect loop -- rule 11 re-matching its own RoadmapDark output',
    url: PROTO_BAKED[11].expect,
  },
  {
    name: 'proto-baked-transitfocused-z14-already-dark',
    guards: 'redirect loop -- rule 12 re-matching its own TransitFocusedDark output',
    url: PROTO_BAKED[12].expect,
  },
  {
    name: 'proto-baked-transitfocused-z5-already-dark',
    guards: 'redirect loop -- rule 13 re-matching its own TransitFocusedDark output',
    url: PROTO_BAKED[13].expect,
  },
  {
    name: 'proto-baked-transitfocused-z9-already-dark',
    guards: 'redirect loop -- rule 14 re-matching its own TransitFocusedDark output',
    url: PROTO_BAKED[14].expect,
  },
  {
    name: 'proto-baked-terrain-z14-already-dark',
    guards: 'redirect loop -- rule 15 re-matching its own TerrainDark output',
    url: PROTO_BAKED[15].expect,
  },
  {
    name: 'proto-baked-terrain-z1-already-dark',
    guards: 'redirect loop -- rule 16 re-matching its own TerrainDark output',
    url: PROTO_BAKED[16].expect,
  },
  {
    name: 'proto-baked-terrain-z9-already-dark',
    guards: 'redirect loop -- rule 17 re-matching its own TerrainDark output',
    url: PROTO_BAKED[17].expect,
  },
  {
    name: 'proto-terrain-relief-z9-already-dark',
    guards: 'redirect loop -- rule 6 re-matching its own TerrainDark output',
    url: PROTO_TERRAIN[6].expect,
  },
  {
    name: 'proto-terrain-relief-z11-already-dark',
    guards: 'redirect loop -- rule 7 re-matching its own TerrainDark output',
    url: PROTO_TERRAIN[7].expect,
  },
  {
    name: 'proto-terrain-relief-z5-already-dark',
    guards: 'redirect loop -- rule 8 re-matching its own TerrainDark output',
    url: PROTO_TERRAIN[8].expect,
  },
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
    name: 'legend-terrain-vector-client-already-dark',
    guards: 'redirect loop -- rule 2 re-matching its own TerrainVectorClientDark output',
    url: `https://www.gstatic.com/maps/res/CompactLegend-TerrainVectorClientDark-${LEGEND_V3}`,
  },
  {
    name: 'stream-terrain-vector-client-already-dark',
    guards: 'redirect loop -- rule 3 re-matching its own TerrainVectorClientDark output',
    derived: true,
    url: darkTvc(TVC_STREAM),
  },
  {
    name: 'raster-terrain-vector-client-already-dark',
    guards: 'redirect loop -- rule 4 re-matching its own TerrainVectorClientDark output',
    derived: true,
    url: darkTvc(TVC_RASTER),
  },
  {
    name: 'legend-transit-already-dark',
    guards: 'redirect loop -- rule 5 re-matching its own output',
    url: `https://www.gstatic.com/maps/res/CompactLegend-TransitFocusedDark-${LEGEND_V3}`,
  },
  {
    name: 'raster-transit-already-dark',
    guards: 'redirect loop on the Transit arm -- rule 4 re-matching its own output (the diverging kind)',
    source: 'the transit-raster must-match entry, after the substitution rule 4 performs on it',
    derived: true,
    url: darkTransit(TRANSIT_RASTER),
  },
  {
    name: 'stream-transit-already-dark',
    guards: 'redirect loop on the Transit arm -- rule 3 re-matching its own output',
    source: 'the transit-stream must-match entry, after the substitution rule 3 performs on it',
    derived: true,
    url: darkTransit(TRANSIT_STREAM),
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

export const LEGEND_VERSIONS = [LEGEND_V3, LEGEND_V2, LEGEND_V];
export const LEGEND_STYLES_LIVE = [
  'Roadmap', 'RoadmapDark', 'Terrain', 'TerrainDark', 'TerrainVectorClient', 'TerrainVectorClientDark',
  'TransitFocused', 'TransitFocusedDark', 'RoadmapSatellite',
];
export const LEGEND_STYLES_DEAD = ['RoadmapNoSuchStyle', 'RoadmapDarkDark', 'Nonsense'];
