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
// the human-readable why/source note. The second-hand subset follows
// docs/candidate-packs/second-hand-source-pack-playbook.md: open geodata can
// seed provisional route fill, never verified catalog promotion.

const LAST_SEEN = "2026-05-24";
const SECOND_HAND_PLAYBOOK = "docs/candidate-packs/second-hand-source-pack-playbook.md";

const PROVISIONAL_SOURCE_NOTE =
  "Provisional source candidate surfaced from open geodata. Not yet human-verified or promoted into the Athens citypack; used only as honest low-confidence fill for thin neighborhoods.";

function osmNodeUrl(id) {
  return `https://www.openstreetmap.org/node/${id}`;
}

function vintageSourceCandidate({
  id,
  osmNode,
  label,
  lat,
  lng,
  area,
  tags = [],
  routeRoles = ["connector", "vintage_second_hand_option"],
  packRole,
  scopeBasis,
  why,
}) {
  return {
    id,
    city: "athens",
    label,
    type: "vintage-shop",
    candidate_kind: "draft_place",
    is_structural: false,
    city_pack_owned: false,
    lat,
    lng,
    area,
    tags: ["second_hand", "vintage", ...tags],
    vibes: [],
    time_fit: ["morning", "afternoon"],
    route_roles: routeRoles,
    source: {
      kind: "open_geo_source",
      label: "OpenStreetMap",
      url: osmNodeUrl(osmNode),
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
      why_included: why,
      source_note: PROVISIONAL_SOURCE_NOTE,
      last_seen: LAST_SEEN,
      osm_node: String(osmNode),
      candidate_pack_playbook: SECOND_HAND_PLAYBOOK,
      pack_role: packRole,
      scope_basis: scopeBasis,
      weatherTags: ["all-weather"],
    },
  };
}

const sourceCandidates = [
  vintageSourceCandidate({
    id: "athens-kilo-shop-monastiraki",
    osmNode: 4285025700,
    label: "Kilo Shop",
    lat: 37.9773988,
    lng: 23.7216782,
    area: "monastiraki-psyrri",
    tags: ["kilo", "shopping", "lokalt"],
    packRole: "utility_anchor",
    scopeBasis: "kilo-format vintage clothing stop; generic shopping is secondary only.",
    why:
      "Open geodata names a Kilo Shop beside the Monastiraki flea-market cluster; useful as provisional vintage clothing density pending human verification.",
  }),
  vintageSourceCandidate({
    id: "athens-palaiopoleion-ton-athinon",
    osmNode: 4285025704,
    label: "Palaiopoleion ton Athinon",
    lat: 37.9771509,
    lng: 23.7219415,
    area: "monastiraki-psyrri",
    tags: ["antiques", "loppis", "flea", "shopping"],
    packRole: "market_context_anchor",
    scopeBasis:
      "Open geodata carries second_hand and the stop sits inside the Avissinias flea-market context; antiques/flea tags are secondary market context, not standalone generic antiques.",
    why:
      "Open geodata tags this Monastiraki-adjacent shop as second_hand; it strengthens the Avissinias vintage/flea-market walk without being promoted to verified catalog.",
  }),
  vintageSourceCandidate({
    id: "athens-reset-thrift-shop",
    osmNode: 4943398235,
    label: "Reset Thrift Shop",
    lat: 37.9868502,
    lng: 23.7340862,
    area: "exarchia",
    tags: ["thrift", "shopping", "lokalt"],
    packRole: "utility_anchor",
    scopeBasis: "Named thrift shop; generic shopping is secondary only.",
    why:
      "Open geodata carries an English thrift-shop name near Exarchia; provisional fill for single-intent second-hand days pending source corroboration.",
  }),
  vintageSourceCandidate({
    id: "athens-bohbo-second-hand",
    osmNode: 10174064368,
    label: "Bohbo",
    lat: 37.9831957,
    lng: 23.7365609,
    area: "exarchia",
    tags: ["shopping"],
    packRole: "utility_anchor",
    scopeBasis: "Open geodata tags the place as second_hand; generic shopping is secondary only.",
    why:
      "Open geodata tags Bohbo as second_hand near the Exarchia/Kolonaki edge; useful as central-north second-hand density only while marked provisional.",
  }),
  vintageSourceCandidate({
    id: "athens-vintage-room-patision",
    osmNode: 5684066961,
    label: "Vintage Room",
    lat: 37.9961324,
    lng: 23.7321778,
    area: "kypseli",
    tags: ["shopping"],
    packRole: "utility_anchor",
    scopeBasis: "Named vintage clothing signal in open geodata; generic shopping is secondary only.",
    why:
      "Open geodata names a Vintage Room on Patision with recent check dates; provisional north-side vintage density for Athens preview routes.",
  }),
  vintageSourceCandidate({
    id: "athens-bee-hive-second-hand",
    osmNode: 10118352739,
    label: "Bee Hive",
    lat: 38.0003504,
    lng: 23.7346553,
    area: "kypseli",
    tags: ["shopping", "lokalt"],
    packRole: "utility_anchor",
    scopeBasis: "Open geodata tags the place as second_hand; generic shopping is secondary only.",
    why:
      "Open geodata tags Bee Hive as second_hand around Kypseli; provisional fill for thin northern second-hand coverage pending human verification.",
  }),
  vintageSourceCandidate({
    id: "athens-movintage",
    osmNode: 2690369510,
    label: "MoVintage Athens",
    lat: 37.9669862,
    lng: 23.728221,
    area: "koukaki-makrygianni",
    tags: ["shopping"],
    packRole: "utility_anchor",
    scopeBasis: "Named vintage clothing signal in open geodata; generic shopping is secondary only.",
    why:
      "Open geodata names MoVintage Athens near Koukaki/Makrygianni; provisional south-side vintage clothing density for Athens preview routes.",
  }),
  vintageSourceCandidate({
    id: "athens-vintage-lovers",
    osmNode: 4015408206,
    label: "Vintage Lovers",
    lat: 37.9637316,
    lng: 23.7232843,
    area: "koukaki-makrygianni",
    tags: ["shopping"],
    packRole: "utility_anchor",
    scopeBasis: "Named vintage clothing signal in open geodata; generic shopping is secondary only.",
    why:
      "Open geodata names Vintage Lovers near the south-center walking belt; provisional vintage clothing stop pending human verification.",
  }),
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
