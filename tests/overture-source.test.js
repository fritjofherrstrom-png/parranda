"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  OVERTURE_ATTRIBUTION_URL,
  buildOvertureQuery,
  categoryMapping,
  createOvertureSource,
  mapOvertureRow,
  resolveLatestOvertureRelease,
} = require("../server/place-candidates/overture-source");
const { composeOpenDataLoaders } = require("../server/place-candidates/open-data-loader");
const { mapRecordToCandidate } = require("../server/place-candidates/external-open-provider");

const ID = "06d8f8c3-fb2b-4680-a518-8df6bf53c0b9";

function row(overrides = {}) {
  return {
    id: ID,
    name: "Buhres på Kivik",
    category: "seafood_restaurant",
    alternate: ["restaurant"],
    confidence: 0.998,
    operating_status: "open",
    websites: ["https://buhres.se/"],
    brand: null,
    lat: 55.684,
    lng: 14.228,
    ...overrides,
  };
}

test("maps only structured travel categories into attributed open_directory records", () => {
  const mapped = mapOvertureRow(row());
  assert.equal(mapped.id, `overture-${ID}`);
  assert.equal(mapped.name, "Buhres på Kivik");
  assert.equal(mapped.type, "restaurant");
  assert.deepEqual(mapped.tags, ["mat"]);
  assert.deepEqual(mapped.sources, [{
    provider: "overture",
    family: "open_directory",
    tier: "inferred",
    url: OVERTURE_ATTRIBUTION_URL,
    license: "CDLA-Permissive-2.0",
  }]);
  assert.equal(mapped.website, "https://buhres.se/");
  assert.equal(mapped.operational_status, "source_indicated_active");
  assert.equal("confidence" in mapped, false, "source existence confidence gates rows but never becomes ranking power");
  assert.equal("alternate" in mapped, false, "raw provider taxonomy must not leak");
});

test("category mapping covers local food, culture, nature, markets and second hand without generic retail", () => {
  assert.equal(categoryMapping("scandinavian_restaurant").type, "restaurant");
  assert.equal(categoryMapping("restaurant", ["bakery"]).type, "restaurant", "primary category wins over alternate facets");
  assert.equal(categoryMapping("modern_art_museum").type, "museum");
  assert.equal(categoryMapping("national_park").type, "park");
  assert.equal(categoryMapping("farmers_market").type, "market");
  assert.equal(categoryMapping("antique_store").type, "vintage-shop");
  assert.equal(categoryMapping("home_goods_store", ["antique_store"]).type, "vintage-shop");
  assert.equal(categoryMapping("pharmacy"), null);
  assert.equal(categoryMapping("shopping_mall"), null);
  assert.equal(categoryMapping("tourist_attraction"), null, "generic attraction labels are not route evidence");
});

test("drops low-confidence, closed, unlocated, unnamed and unsupported rows", () => {
  assert.equal(mapOvertureRow(row({ confidence: 0.7 })), null);
  assert.equal(mapOvertureRow(row({ operating_status: "closed_permanently" })), null);
  assert.equal(mapOvertureRow(row({ lat: null })), null);
  assert.equal(mapOvertureRow(row({ name: "" })), null);
  assert.equal(mapOvertureRow(row({ category: "pharmacy", alternate: [] })), null);
});

test("the GeoParquet query is release-validated, bbox-bounded, filtered and capped", () => {
  const sql = buildOvertureQuery({
    release: "2026-08-19.0",
    lat: 55.68,
    lng: 14.23,
    radiusKm: 5,
    rowLimit: 9000,
  });
  assert.match(sql, /release\/2026-08-19\.0\/theme=places\/type=place\/\*/);
  assert.match(sql, /bbox\.ymin BETWEEN/);
  assert.match(sql, /bbox\.xmin BETWEEN/);
  assert.match(sql, /confidence >= 0\.950/);
  assert.match(sql, /regexp_matches/);
  assert.match(sql, /LIMIT 600$/);
  assert.equal(buildOvertureQuery({ release: "latest; DROP TABLE x", lat: 1, lng: 1 }), null);
  assert.equal(buildOvertureQuery({ release: "2026-08-19.0", lat: 91, lng: 1 }), null);
});

test("latest release resolution accepts the bounded STAC field and fails closed", async () => {
  assert.equal(await resolveLatestOvertureRelease({
    fetcher: async () => ({ ok: true, json: async () => ({ latest: "2026-08-19.0" }) }),
  }), "2026-08-19.0");
  assert.equal(await resolveLatestOvertureRelease({
    fetcher: async () => ({ ok: true, json: async () => ({ latest: "not-a-release" }) }),
  }), null);
  assert.equal(await resolveLatestOvertureRelease({ fetcher: async () => { throw new Error("offline"); } }), null);
});

test("source uses injected release/query seams, filters precisely and honors requested intent", async () => {
  let capturedSql = null;
  const source = createOvertureSource({
    releaseResolver: async () => "2026-08-19.0",
    queryRows: async (sql) => {
      capturedSql = sql;
      return [
        row({ id: "10000000-0000-0000-0000-000000000001", name: "Nearby Cafe", category: "cafe", lat: 55.6801 }),
        row({ id: "10000000-0000-0000-0000-000000000002", name: "Local Museum", category: "museum", lat: 55.681 }),
        row({ id: "10000000-0000-0000-0000-000000000003", name: "Pharmacy", category: "pharmacy", alternate: [] }),
      ];
    },
    limit: 2,
  });
  const records = await source({ lat: 55.68, lng: 14.23, requestedIntents: ["museums"] });
  assert.match(capturedSql, /read_parquet/);
  assert.deepEqual(records.map((record) => record.name), ["Local Museum", "Nearby Cafe"]);
});

test("an Overture record passes through the existing external evidence contract as one inferred family", () => {
  const candidate = mapRecordToCandidate({ key: "kivik" }, mapOvertureRow(row()), "2026-08-26T00:00:00Z", 0);
  assert.equal(candidate.city_pack_owned, false);
  assert.equal(candidate.trust.human_verified, false);
  assert.equal(candidate.source_family, "open_directory");
  assert.deepEqual([...new Set(candidate.evidence.map((item) => item.source_ref.source_family))], ["open_directory"]);
  assert.equal(candidate.website, "https://buhres.se/");
});

test("composed loader can serve cached Overture supply when Overpass failed", async () => {
  const osm = [];
  Object.defineProperty(osm, "loader_status", { value: "error_failed_closed" });
  Object.defineProperty(osm, "loader_error", { value: "timeout_or_abort" });
  const loader = composeOpenDataLoaders(
    async () => osm,
    null,
    { load: async () => [mapOvertureRow(row())] },
  );
  const records = await loader({ lat: 55.68, lng: 14.23 });
  assert.equal(records.length, 1);
  assert.equal(records.loader_status, "loaded:1");
  assert.equal(records.loader_error, "timeout_or_abort", "the rescued result must retain the primary outage fact");
});

test("a varied cached Overture reservoir returns without waiting behind live Overpass", async () => {
  let releasePrimary;
  const primary = new Promise((resolve) => { releasePrimary = resolve; });
  const types = ["restaurant", "cafe", "museum"];
  const overtureRecords = Array.from({ length: 12 }, (_, index) => ({
    id: `overture-fast-${index}`,
    name: `Local ${index}`,
    type: types[index % types.length],
    lat: 55.68 + index / 10000,
    lng: 14.23 + index / 10000,
    tags: [],
    sources: [{ provider: "overture", family: "open_directory", tier: "inferred" }],
  }));
  const loader = composeOpenDataLoaders(
    async () => primary,
    null,
    { eager: true, load: () => overtureRecords },
  );

  const result = await Promise.race([
    loader({ lat: 55.68, lng: 14.23 }),
    new Promise((_, reject) => setTimeout(() => reject(new Error("waited_for_overpass")), 50)),
  ]);
  assert.equal(result.length, 12);
  assert.equal(result.loader_metadata.primary_collection, "background_refresh");
  releasePrimary([]);
});
