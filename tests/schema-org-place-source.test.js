"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { createSourceCache } = require("../server/place-candidates/source-cache");
const {
  collectReviewedPlaceFeed,
  createReviewedPlaceSource,
  extractSchemaOrgPlaces,
  parseSchemaOrgPlacesFromHtml,
  resolveDefaultReviewedPlaceSource,
} = require("../server/place-candidates/schema-org-place-source");

function feed(overrides = {}) {
  return {
    id: "reviewed-guide",
    label: "Reviewed guide",
    endpoint: "https://guide.example/places",
    adapter: "schema_org_place_html",
    bbox: [13, 55, 14, 56],
    evidence_family: "official",
    source_tier: "official",
    max_items: 20,
    profile_reviewed_at: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

function place(overrides = {}) {
  return {
    "@type": "Museum",
    "@id": "https://guide.example/places/local-museum",
    name: "Local Museum",
    geo: { latitude: 55.5, longitude: 13.5 },
    description: "This prose must never enter the candidate record.",
    aggregateRating: { ratingValue: 5 },
    ...overrides,
  };
}

function html(payload) {
  return `<html><script type="application/ld+json">${JSON.stringify(payload)}</script></html>`;
}

function response(body, overrides = {}) {
  return {
    ok: true,
    status: 200,
    url: "https://guide.example/places",
    redirected: false,
    text: async () => body,
    ...overrides,
  };
}

test("JSON-LD extraction supports graph and ItemList envelopes but rejects generic businesses", () => {
  const payload = {
    "@graph": [
      { "@type": "ItemList", itemListElement: [{ item: place() }] },
      place({ "@type": "LocalBusiness", "@id": "https://guide.example/generic" }),
    ],
  };
  const records = extractSchemaOrgPlaces(payload);
  assert.equal(records.length, 1);
  assert.equal(records[0].name, "Local Museum");
});

test("HTML extraction ignores prose and survives one malformed JSON-LD block", () => {
  const source = `<script type="application/ld+json">{bad}</script>${html(place())}<p>Secret copy</p>`;
  const parsed = parseSchemaOrgPlacesFromHtml(source);
  assert.equal(parsed.invalidScriptCount, 1);
  assert.equal(parsed.validScriptCount, 1);
  assert.equal(parsed.places.length, 1);
});

test("collector emits only bounded factual route records with attribution", async () => {
  const payload = [
    place(),
    place({
      "@id": "https://guide.example/places/outside",
      name: "Outside",
      geo: { latitude: 57, longitude: 13.5 },
    }),
    place({ "@id": "https://guide.example/places/no-geo", name: "No geo", geo: null }),
  ];
  const records = await collectReviewedPlaceFeed(feed(), {
    fetcher: async () => response(html(payload)),
  });
  assert.equal(records.length, 1);
  assert.equal(records[0].name, "Local Museum");
  assert.equal(records[0].type, "museum");
  assert.equal(records[0].operator_reviewed_source, true);
  assert.equal(records[0].sources[0].family, "official");
  assert.equal(records[0].sources[0].license, undefined);
  assert.equal("description" in records[0], false);
  assert.equal("aggregateRating" in records[0], false);
});

test("network, oversized, malformed and cross-origin redirect responses fail closed", async () => {
  const cases = [
    async () => response("x", { ok: false, status: 503 }),
    async () => response("x".repeat(2048)),
    async () => response("<script type='application/ld+json'>{bad}</script>"),
    async () => response(html(place()), { url: "https://redirect.example/places", redirected: true }),
    async () => { throw new Error("private endpoint detail"); },
  ];
  for (const fetcher of cases) {
    const records = await collectReviewedPlaceFeed(feed(), { fetcher, maxBytes: 1024 });
    assert.deepEqual(records, []);
  }
});

test("runtime source warms off-path, then serves only records within 5km of the exact anchor", async () => {
  const cache = createSourceCache({ namespace: "reviewed-place-test", ttlMs: 60_000 });
  let fetchCount = 0;
  const source = createReviewedPlaceSource({
    sourceCatalog: {
      listApprovedPlaceFeedsForAnchor: async () => [feed()],
    },
    env: {},
    cache,
    now: () => new Date("2026-08-20T12:00:00.000Z"),
    fetcher: async () => {
      fetchCount += 1;
      return response(html([
        place({ geo: { latitude: 55.5, longitude: 13.5 } }),
        place({
          "@id": "https://guide.example/places/far",
          name: "Far but in profile bbox",
          geo: { latitude: 55.55, longitude: 13.5 },
        }),
      ]));
    },
  });

  assert.deepEqual(await source.load({ lat: 55.5, lng: 13.5 }), []);
  await new Promise((resolve) => setImmediate(resolve));
  const records = await source.load({ lat: 55.5, lng: 13.5 });
  assert.equal(fetchCount, 1);
  assert.equal(records.length, 1);
  assert.equal(records[0].name, "Local Museum");
});

test("default runtime wiring requires the server flag and a catalog or reviewed profile", () => {
  assert.equal(resolveDefaultReviewedPlaceSource({}, { fetcher: async () => response("") }), null);
  assert.equal(resolveDefaultReviewedPlaceSource({ PARRANDA_REVIEWED_PLACE_SOURCES: "enabled" }, {
    fetcher: async () => response(""),
  }), null);
  const source = resolveDefaultReviewedPlaceSource({ PARRANDA_REVIEWED_PLACE_SOURCES: "enabled" }, {
    sourceCatalog: { listApprovedPlaceFeedsForAnchor: async () => [] },
    fetcher: async () => response(""),
  });
  assert.equal(typeof source.load, "function");
});

test("multiple reviewed sources remain hard-capped as one runtime reservoir", async () => {
  const feeds = [
    feed({ id: "guide-a", endpoint: "https://guide.example/a", max_items: 100 }),
    feed({ id: "guide-b", endpoint: "https://guide.example/b", max_items: 100 }),
  ];
  const source = createReviewedPlaceSource({
    sourceCatalog: { listApprovedPlaceFeedsForAnchor: async () => feeds },
    env: {},
    cache: createSourceCache({ namespace: "reviewed-place-cap-test", ttlMs: 60_000 }),
    now: () => new Date("2026-08-20T12:00:00.000Z"),
    fetcher: async (endpoint) => {
      const suffix = endpoint.endsWith("/a") ? "a" : "b";
      const rows = Array.from({ length: 60 }, (_, index) => place({
        "@id": `${endpoint}/${index}`,
        name: `Place ${suffix}-${index}`,
        geo: { latitude: 55.5 + index * 0.00001, longitude: 13.5 },
      }));
      return response(html(rows), { url: endpoint });
    },
  });
  assert.deepEqual(await source.load({ lat: 55.5, lng: 13.5 }), []);
  await new Promise((resolve) => setImmediate(resolve));
  const records = await source.load({ lat: 55.5, lng: 13.5 });
  assert.equal(records.length, 100);
  assert.equal(records[0].name, "Place a-0");
  assert.equal(records[99].name, "Place b-39");
});
