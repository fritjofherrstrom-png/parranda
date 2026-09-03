"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { createSourceCache } = require("../server/place-candidates/source-cache");
const {
  collectReviewedPlaceFeed,
  collectReviewedPlaceFeedOutcome,
  createReviewedPlaceSource,
  EXPERIENCE_CARD_PLACE_LIST_DETAIL_ADAPTER,
  extractExperienceCardDetailPointers,
  extractSchemaOrgPlaces,
  inspectExperienceCardPlaceListDetailPayload,
  MAX_LIST_DETAIL_LINKS,
  parseSchemaOrgPlacesFromHtml,
  probeSchemaOrgPlaceFeed,
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

function htmlResponse(body, url) {
  return response(body, {
    url,
    headers: { get: (name) => String(name).toLowerCase() === "content-type" ? "text/html" : null },
  });
}

function experienceCard({ url, name, type }) {
  const slug = `${type.toLowerCase().replace(/\s+/g, "-")}-en`;
  return `<div class="vs-experience-card" data-title="${name.toLowerCase()}" data-categories="place-en" data-subcategories="${slug}">
    <div class="vs-content">
      <div class="vs-title">${name}</div>
      <div class="vs-categories"><span class="vs-category primary">Activities</span><span class="vs-category">${type}</span></div>
      <a href="${url}" class="vs-readmore">Read more</a>
    </div>
  </div>`;
}

function experienceList(items) {
  return `<html><body>${items.map(experienceCard).join("\n")}</body></html>`;
}

function experienceDetail({
  url,
  name,
  type,
  lat = 55.5001,
  lng = 13.5001,
  canonical = url,
  heroName = name,
  contentName = name,
  extra = "",
}) {
  return `<html><head><link rel="canonical" href="${canonical}"></head><body>
    <h1 class="postHerosection postHerosection__heroHeading">${heroName}</h1>
    <div class="experience-meta-container">
      <div class="experience-taxonomy"><span class="experience-category">Activities</span><span class="experience-subcategory">${type}</span></div>
      <h2 class="experience-title">${contentName}</h2>
      <div class="experience-map" data-lat="${lat}" data-lng="${lng}"></div>
    </div>${extra}
  </body></html>`;
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

test("list-detail inspection accepts only capped same-origin verified experience cards", () => {
  const items = [
    { url: "/places/one", name: "One Museum", type: "Museum" },
    { url: "https://guide.example/places/two#section", name: "Two Park", type: "Park" },
    { url: "https://other.example/places/three", name: "Foreign Park", type: "Park" },
    { url: "http://guide.example/places/four", name: "Http Park", type: "Park" },
    { url: "/places/one", name: "Duplicate Museum", type: "Museum" },
    ...Array.from({ length: 20 }, (_, index) => ({
      url: `/places/more-${index}`,
      name: `More Museum ${index}`,
      type: "Museum",
    })),
  ];
  const parsed = inspectExperienceCardPlaceListDetailPayload(experienceList(items), {
    endpoint: "https://guide.example/places",
  });
  assert.equal(parsed.status, "ok");
  assert.equal(parsed.detail_link_count, MAX_LIST_DETAIL_LINKS);
  assert.deepEqual(parsed.detail_pointers.slice(0, 2), [
    { url: "https://guide.example/places/one", name: "One Museum", type: "museum" },
    { url: "https://guide.example/places/two", name: "Two Park", type: "park" },
  ]);
  assert.deepEqual(extractExperienceCardDetailPointers("", {
    endpoint: "https://guide.example/places",
  }), []);
});

test("experience-card inspection never joins title, category and link across sibling cards", () => {
  const source = `<div class="catalog-wrapper">
    <div class="vs-experience-card" data-title="split museum" data-categories="place-en" data-subcategories="museum-en">
      <div class="vs-title">Split Museum</div>
    </div>
    <div class="vs-experience-card" data-title="other park" data-categories="place-en" data-subcategories="park-en">
      <div class="vs-categories"><span class="vs-category">Park</span></div>
      <a href="/places/other" class="vs-readmore">Read more</a>
    </div>
  </div>`;
  assert.deepEqual(inspectExperienceCardPlaceListDetailPayload(source, {
    endpoint: "https://guide.example/places",
  }), {
    status: "empty",
    detail_link_count: 0,
    detail_pointers: [],
    reason: "bounded_experience_card_list_not_detected",
  });
});

test("bounded list-detail collection follows exact same-origin details under one byte budget", async () => {
  const endpoint = "https://guide.example/places";
  const bodies = new Map([
    [endpoint, experienceList([
      { url: "/places/museum", name: "Detail Museum", type: "Museum" },
      { url: "/places/park", name: "Detail Park", type: "Park" },
      { url: "https://other.example/places/foreign", name: "Foreign", type: "Park" },
      { url: "/places/third", name: "Detail Cafe", type: "Cafe" },
    ])],
    ["https://guide.example/places/museum", experienceDetail({
      url: "https://guide.example/places/museum", name: "Detail Museum", type: "Museum",
    })],
    ["https://guide.example/places/park", experienceDetail({
      url: "https://guide.example/places/park", name: "Detail Park", type: "Park",
    })],
    ["https://guide.example/places/third", experienceDetail({
      url: "https://guide.example/places/third", name: "Detail Cafe", type: "Cafe",
    })],
  ]);
  const requests = [];
  const records = await collectReviewedPlaceFeed(feed({
    adapter: EXPERIENCE_CARD_PLACE_LIST_DETAIL_ADAPTER,
    max_items: 2,
  }), {
    fetcher: async (url, options) => {
      requests.push({ url, options });
      return htmlResponse(bodies.get(url), url);
    },
  });

  assert.deepEqual(requests.map((request) => request.url), [
    endpoint,
    "https://guide.example/places/museum",
    "https://guide.example/places/park",
  ]);
  assert.ok(requests.every((request) => request.options.redirect === "error"));
  assert.ok(requests.every((request) => request.options.signal === requests[0].options.signal));
  assert.deepEqual(records.map((record) => [record.name, record.type]), [
    ["Detail Museum", "museum"],
    ["Detail Park", "park"],
  ]);
  assert.ok(records.every((record) => record.sources[0].url.startsWith("https://guide.example/places/")));
});

test("list and details share one aggregate byte ceiling", async () => {
  const endpoint = "https://guide.example/places";
  const detailUrls = [`${endpoint}/one`, `${endpoint}/two`];
  const listBody = experienceList(detailUrls.map((url, index) => ({
    url,
    name: `Detail ${index + 1}`,
    type: "Museum",
  })));
  const baseDetails = detailUrls.map((url, index) => experienceDetail({
    url,
    name: `Detail ${index + 1}`,
    type: "Museum",
  }));
  const byteCeiling = 2048;
  const remaining = byteCeiling - Buffer.byteLength(listBody, "utf8");
  const targetDetailBytes = Math.floor(remaining * 0.6);
  const details = baseDetails.map((body) => {
    const fillerLength = Math.max(0, targetDetailBytes - Buffer.byteLength(body, "utf8") - 7);
    return `${body}<!--${"x".repeat(fillerLength)}-->`;
  });
  assert.ok(Buffer.byteLength(listBody, "utf8") + Buffer.byteLength(details[0], "utf8") <= byteCeiling);
  assert.ok(
    Buffer.byteLength(listBody, "utf8") +
    Buffer.byteLength(details[0], "utf8") +
    Buffer.byteLength(details[1], "utf8") > byteCeiling,
  );
  const bodies = new Map([[endpoint, listBody], ...detailUrls.map((url, index) => [url, details[index]])]);
  const records = await collectReviewedPlaceFeed(feed({
    adapter: EXPERIENCE_CARD_PLACE_LIST_DETAIL_ADAPTER,
    max_items: 2,
  }), {
    maxBytes: byteCeiling,
    fetcher: async (url) => htmlResponse(bodies.get(url), url),
  });

  assert.deepEqual(records.map((record) => record.name), ["Detail 1"]);
});

test("list-detail rows fail closed on identity, entity, content-type and redirect drift", async () => {
  const endpoint = "https://guide.example/places";
  const urls = ["mismatch", "ambiguous", "wrong-type", "redirected"].map(
    (slug) => `${endpoint}/${slug}`,
  );
  const bodies = new Map([
    [endpoint, experienceList(urls.map((url, index) => ({
      url,
      name: `Detail ${index}`,
      type: "Museum",
    })))],
    [urls[0], experienceDetail({
      url: urls[0], name: "Detail 0", type: "Museum", canonical: `${endpoint}/someone-else`,
    })],
    [urls[1], experienceDetail({
      url: urls[1], name: "Detail 1", type: "Museum", heroName: "Another identity",
    })],
    [urls[2], experienceDetail({ url: urls[2], name: "Detail 2", type: "Museum" })],
    [urls[3], experienceDetail({ url: urls[3], name: "Detail 3", type: "Museum" })],
  ]);
  const outcome = await collectReviewedPlaceFeedOutcome(feed({
    adapter: EXPERIENCE_CARD_PLACE_LIST_DETAIL_ADAPTER,
  }), {
    fetcher: async (url) => {
      if (url === urls[2]) {
        return response(bodies.get(url), {
          url,
          headers: { get: () => "application/json" },
        });
      }
      if (url === urls[3]) {
        return htmlResponse(bodies.get(url), "https://guide.example/redirect-target");
      }
      return htmlResponse(bodies.get(url), url);
    },
  });
  assert.deepEqual(outcome, { status: "empty", records: [] });
});

test("a list whose entire detail transport fails is failed, not a healthy empty source", async () => {
  const endpoint = "https://guide.example/places";
  const urls = [`${endpoint}/one`, `${endpoint}/two`];
  const outcome = await collectReviewedPlaceFeedOutcome(feed({
    adapter: EXPERIENCE_CARD_PLACE_LIST_DETAIL_ADAPTER,
    max_items: 2,
  }), {
    fetcher: async (url) => url === endpoint
      ? htmlResponse(experienceList([
          { url: urls[0], name: "One Museum", type: "Museum" },
          { url: urls[1], name: "Two Park", type: "Park" },
        ]), endpoint)
      : response("{}", {
          url,
          headers: { get: () => "application/json" },
        }),
  });

  assert.deepEqual(outcome, { status: "failed", records: [] });
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

test("discovery probing reuses the bounded exact-endpoint parser but returns counts only", async () => {
  const probeFeed = {
    id: "unapproved-guide",
    endpoint: "https://guide.example/places",
    adapter: "schema_org_place_html",
    bbox: [13, 55, 14, 56],
  };
  const result = await probeSchemaOrgPlaceFeed(probeFeed, {
    fetcher: async () => response(html([
      place(),
      place({
        "@id": "https://guide.example/places/park",
        "@type": "Park",
        name: "Local Park",
      }),
    ])),
  });
  assert.deepEqual(result, {
    status: "ok",
    accepted_place_count: 2,
    distinct_place_type_count: 2,
  });
  assert.equal("records" in result, false);

  assert.deepEqual(await probeSchemaOrgPlaceFeed({
    ...probeFeed,
    endpoint: "http://guide.example/places",
  }, { fetcher: async () => response(html(place())) }), {
    status: "failed",
    accepted_place_count: 0,
    distinct_place_type_count: 0,
  });
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

test("catalog-backed runtime consumes only fresh worker-persisted records and never request-fetches", async () => {
  let fetchCount = 0;
  let feedReadCount = 0;
  const persisted = [{
    id: "reviewed-place:reviewed-guide:persisted",
    name: "Persisted Local Museum",
    type: "museum",
    lat: 55.5,
    lng: 13.5,
    freshness: "fresh",
    operator_reviewed_source: true,
    source_policy: "reviewed_profile_bounded_refresh",
    source_profile_key: "place-source-profile-v1:test",
    source_profile_revision: "sha256:profile",
    source_observed_at: "2026-08-20T11:00:00.000Z",
    sources: [{ provider: "reviewed-guide", family: "official", tier: "official" }],
  }];
  const source = createReviewedPlaceSource({
    sourceCatalog: {
      listFreshApprovedPlaceCandidatesForAnchor: async () => persisted,
      listApprovedPlaceFeedsForAnchor: async () => {
        feedReadCount += 1;
        return [feed()];
      },
    },
    env: {},
    now: () => new Date("2026-08-20T12:00:00.000Z"),
    fetcher: async () => {
      fetchCount += 1;
      return response(html(place()));
    },
  });

  assert.deepEqual(await source.load({ lat: 55.5, lng: 13.5 }), persisted);
  assert.equal(fetchCount, 0);
  assert.equal(feedReadCount, 0);
});

test("list-detail traversal is never warmed by the legacy request-path source bridge", async () => {
  let fetchCount = 0;
  const source = createReviewedPlaceSource({
    sourceCatalog: {
      listApprovedPlaceFeedsForAnchor: async () => [feed({
        adapter: EXPERIENCE_CARD_PLACE_LIST_DETAIL_ADAPTER,
      })],
    },
    env: {},
    cache: createSourceCache({ namespace: "list-detail-request-path-test", ttlMs: 60_000 }),
    now: () => new Date("2026-08-20T12:00:00.000Z"),
    fetcher: async () => {
      fetchCount += 1;
      return htmlResponse("", "https://guide.example/places");
    },
  });

  assert.deepEqual(await source.load({ lat: 55.5, lng: 13.5 }), []);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(fetchCount, 0);
});

test("persistent catalog records remain available without a network fetcher", async () => {
  const persisted = [{ id: "persisted-one", name: "Persisted", lat: 55.5, lng: 13.5 }];
  const source = createReviewedPlaceSource({
    sourceCatalog: {
      listFreshApprovedPlaceCandidatesForAnchor: async () => persisted,
    },
    env: {},
    fetcher: null,
    now: () => new Date("2026-08-20T12:00:00.000Z"),
  });

  assert.deepEqual(await source.load({ lat: 55.5, lng: 13.5 }), persisted);
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
