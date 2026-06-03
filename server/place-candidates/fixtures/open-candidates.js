/**
 * Deterministic open/external candidate fixtures.
 *
 * Stand-in for a real OSM / Wikidata / open-data fetch. No network. These
 * records exercise the full spine on source-backed candidates:
 *   - corroborated (2+ source families) → existence lifts to eligible
 *   - single weak family → stays low, filtered by gates
 *   - consensus-heavy but single family → still filtered (consensus ≠ promotion)
 *   - url-only / no coordinates → not a reliable place target
 *
 * Each record is intentionally NOT in the curated catalog, so they prove the
 * external bridge rather than duplicating curated places.
 */

const FIXTURES = {
  rome: [
    {
      // Corroborated scenic viewpoint — OSM (map) + Wikidata (community).
      // Catalog ALSO has strong viewpoints, so this lets curated beat external.
      id: "rome-ext-monte-mario",
      name: "Monte Mario Belvedere (open data)",
      type: "viewpoint",
      lat: 41.9249,
      lng: 12.4467,
      area: "monte-mario",
      tags: ["utsikt"],
      time_fit: ["golden-hour", "sun"],
      sources: [
        { provider: "osm", family: "map", tier: "inferred", url: "https://www.openstreetmap.org/node/1" },
        { provider: "wikidata", family: "community", tier: "inferred", url: "https://www.wikidata.org/wiki/Q1" },
      ],
    },
    {
      // Corroborated swimming spot — Rome's curated catalog has NO swimming,
      // so this is where an external candidate can legitimately WIN.
      id: "rome-ext-lido-ostia",
      name: "Lido di Ostia (open data)",
      type: "beach",
      lat: 41.7299,
      lng: 12.2761,
      area: "ostia",
      tags: ["coast", "strand"],
      time_fit: ["sun", "hot"],
      sources: [
        { provider: "osm", family: "map", tier: "inferred", url: "https://www.openstreetmap.org/way/2" },
        { provider: "opendata-roma", family: "official", tier: "official", url: "https://dati.comune.roma.it/x" },
      ],
    },
    {
      // Corroborated second-hand / vintage shop (kept distinct from shopping).
      id: "rome-ext-mercato-vintage",
      name: "Borgo Vintage Collective (open data)",
      type: "vintage-shop",
      lat: 41.8902,
      lng: 12.4711,
      area: "monti",
      tags: ["second_hand", "vintage", "antique"],
      time_fit: ["all-weather"],
      sources: [
        { provider: "osm", family: "map", tier: "inferred", url: "https://www.openstreetmap.org/node/3" },
        { provider: "wikidata", family: "community", tier: "inferred", url: "https://www.wikidata.org/wiki/Q3" },
      ],
    },
    {
      // Weak single-family candidate → existence stays low → gated out.
      id: "rome-ext-weak-cafe",
      name: "Unverified corner cafe (open data)",
      type: "cafe",
      lat: 41.9011,
      lng: 12.4633,
      tags: [],
      sources: [{ provider: "osm", family: "map", tier: "inferred", url: "https://www.openstreetmap.org/node/4" }],
    },
    {
      // Consensus-heavy but single family → still low → gated out.
      // Proves popularity alone does not promote, even for external sources.
      id: "rome-ext-hyped-bar",
      name: "Hyped rooftop (open data)",
      type: "cocktail-bar",
      lat: 41.8955,
      lng: 12.4823,
      tags: ["cocktail"],
      sources: [{ provider: "osm", family: "map", tier: "inferred", url: "https://www.openstreetmap.org/node/5" }],
      popularity: { count: 9000, rating: 4.9 },
    },
    {
      // Source-URL-only: a name + a link, but no coordinates → not a place.
      id: "rome-ext-url-only",
      name: "Event listing with no location (open data)",
      type: "bar",
      tags: ["nattliv"],
      sources: [{ provider: "community-blog", family: "community", tier: "inferred", url: "https://example.org/listing" }],
    },
  ],
  barcelona: [
    {
      id: "barcelona-ext-bunkers",
      name: "Bunkers del Carmel (open data)",
      type: "viewpoint",
      lat: 41.4195,
      lng: 2.1619,
      area: "el-carmel",
      tags: ["utsikt"],
      time_fit: ["golden-hour", "sun"],
      sources: [
        { provider: "osm", family: "map", tier: "inferred", url: "https://www.openstreetmap.org/node/10" },
        { provider: "wikidata", family: "community", tier: "inferred", url: "https://www.wikidata.org/wiki/Q10" },
      ],
    },
  ],
  athens: [
    {
      id: "athens-ext-lycabettus",
      name: "Lycabettus Hill (open data)",
      type: "viewpoint",
      lat: 37.9836,
      lng: 23.7434,
      area: "kolonaki",
      tags: ["utsikt"],
      time_fit: ["golden-hour", "sun"],
      sources: [
        { provider: "osm", family: "map", tier: "inferred", url: "https://www.openstreetmap.org/node/20" },
        { provider: "wikidata", family: "community", tier: "inferred", url: "https://www.wikidata.org/wiki/Q20" },
      ],
    },
  ],
};

function getOpenCandidateFixtures(cityKey) {
  const records = FIXTURES[cityKey];
  return Array.isArray(records) ? records.map((record) => ({ ...record })) : [];
}

module.exports = { getOpenCandidateFixtures, OPEN_CANDIDATE_FIXTURES: FIXTURES };
