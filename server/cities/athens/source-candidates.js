// Provisional source candidates for the Athens preview citypack.
//
// These are REAL Athens places surfaced from open geodata that have NOT yet
// been promoted into the verified catalog (catalog.js). They carry full
// provenance and a low-trust signal (source_tier "inferred",
// confidence "needs_review", human_verified false, city_pack_owned false) so
// the route engine can use them ONLY as honest, clearly-marked fill when a
// thin neighborhood's verified pool runs out — never as part of the verified
// route spine, never counted as real catalog places.
//
// Shape conforms to server/place-candidates/contract.js (draft_place). The
// extra `provenance` block carries the engine-facing hints (weatherTags) plus
// the human-readable why/source note. Coordinates are well-known stable
// landmarks; nothing here is invented.

const LAST_SEEN = "2026-05-24";

const PROVISIONAL_SOURCE_NOTE =
  "Provisional source candidate surfaced from open geodata. Not yet human-verified or promoted into the Athens citypack; used only as honest low-confidence fill for thin neighborhoods.";

const sourceCandidates = [
  {
    id: "athens-filopappou-hill",
    city: "athens",
    label: "Filopappou Hill",
    type: "viewpoint",
    candidate_kind: "draft_place",
    is_structural: false,
    city_pack_owned: false,
    lat: 37.966702,
    lng: 23.718624,
    area: "koukaki-makrygianni",
    tags: ["utsikt", "kultur", "klassiker", "sun", "golden-hour"],
    vibes: [],
    time_fit: ["afternoon", "evening"],
    route_roles: ["connector", "viewpoint_anchor"],
    source: {
      kind: "open_geo_source",
      label: "OpenStreetMap",
      url: "https://www.openstreetmap.org/relation/9301969",
    },
    trust: {
      source_tier: "inferred",
      confidence: "needs_review",
      human_verified: false,
      freshness: "unknown",
    },
    confidence: "needs_review",
    freshness: "unknown",
    provenance: {
      why_included:
        "Major pedestrian hill/viewpoint west of the Acropolis; plausible connector for thin Koukaki-Makrygianni routes pending verification.",
      source_note: PROVISIONAL_SOURCE_NOTE,
      last_seen: LAST_SEEN,
      weatherTags: ["sun", "golden-hour"],
    },
  },
  {
    id: "athens-hill-of-the-nymphs",
    city: "athens",
    label: "Hill of the Nymphs",
    type: "viewpoint",
    candidate_kind: "draft_place",
    is_structural: false,
    city_pack_owned: false,
    lat: 37.972471,
    lng: 23.718187,
    area: "koukaki-makrygianni",
    tags: ["utsikt", "klassiker", "lokalt", "sun"],
    vibes: [],
    time_fit: ["morning", "afternoon"],
    route_roles: ["connector"],
    source: {
      kind: "open_geo_source",
      label: "OpenStreetMap",
      url: "https://www.openstreetmap.org/way/183016378",
    },
    trust: {
      source_tier: "inferred",
      confidence: "needs_review",
      human_verified: false,
      freshness: "unknown",
    },
    confidence: "needs_review",
    freshness: "unknown",
    provenance: {
      why_included:
        "Quiet hill with the National Observatory; candidate green connector between Thiseio and Koukaki pending verification.",
      source_note: PROVISIONAL_SOURCE_NOTE,
      last_seen: LAST_SEEN,
      weatherTags: ["sun"],
    },
  },
  {
    id: "athens-pnyx-hill",
    city: "athens",
    label: "Pnyx",
    type: "viewpoint",
    candidate_kind: "draft_place",
    is_structural: false,
    city_pack_owned: false,
    lat: 37.971401,
    lng: 23.720319,
    area: "koukaki-makrygianni",
    tags: ["utsikt", "kultur", "klassiker", "golden-hour"],
    vibes: [],
    time_fit: ["afternoon", "evening"],
    route_roles: ["connector", "viewpoint_anchor"],
    source: {
      kind: "open_geo_source",
      label: "Wikidata",
      url: "https://www.wikidata.org/wiki/Q207340",
    },
    trust: {
      source_tier: "inferred",
      confidence: "needs_review",
      human_verified: false,
      freshness: "unknown",
    },
    confidence: "needs_review",
    freshness: "unknown",
    provenance: {
      why_included:
        "Historic assembly hill with Acropolis views; candidate golden-hour anchor for thin south/west routes pending verification.",
      source_note: PROVISIONAL_SOURCE_NOTE,
      last_seen: LAST_SEEN,
      weatherTags: ["sun", "golden-hour"],
    },
  },
  {
    id: "athens-panathenaic-stadium",
    city: "athens",
    label: "Panathenaic Stadium",
    type: "landmark",
    candidate_kind: "draft_place",
    is_structural: false,
    city_pack_owned: false,
    lat: 37.968296,
    lng: 23.741066,
    area: "pangrati-mets",
    tags: ["kultur", "klassiker", "utsikt"],
    vibes: [],
    time_fit: ["morning", "afternoon"],
    route_roles: ["connector", "neighborhood_anchor"],
    source: {
      kind: "open_geo_source",
      label: "Wikidata",
      url: "https://www.wikidata.org/wiki/Q207360",
    },
    trust: {
      source_tier: "inferred",
      confidence: "needs_review",
      human_verified: false,
      freshness: "unknown",
    },
    confidence: "needs_review",
    freshness: "unknown",
    provenance: {
      why_included:
        "Marble stadium anchoring the Pangrati-Mets edge; candidate daytime anchor pending verification of access/hours.",
      source_note: PROVISIONAL_SOURCE_NOTE,
      last_seen: LAST_SEEN,
      weatherTags: ["sun", "all-weather"],
    },
  },
];

module.exports = {
  sourceCandidates,
};
