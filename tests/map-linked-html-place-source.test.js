"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");

const {
  collectReviewedPlaceFeed,
  probeReviewedPlaceFeed,
} = require("../server/place-candidates/schema-org-place-source");
const {
  coordinateMapUrl,
  extractMapLinkedPlaceRecords,
  inspectMapLinkedPlacePayload,
} = require("../server/place-candidates/map-linked-html-place-source");

function feed(overrides = {}) {
  return {
    id: "reviewed-map-guide",
    label: "Reviewed map guide",
    endpoint: "https://guide.example/places",
    adapter: "map_linked_place_html",
    bbox: [13, 55, 14, 56],
    evidence_family: "official",
    source_tier: "official",
    max_items: 20,
    ...overrides,
  };
}

function card({
  name = "Harbour Museum",
  detail = "/places/harbour-museum",
  category = "Museums",
  map = "https://maps.google.com/?q=Harbour+Museum&loc=55.5001+13.5001&ll=55.5001,13.5001",
  description = "Untrusted prose and popularity must never survive.",
} = {}) {
  return `<li class="place-card">
    <h2><a href="${detail}">${name}</a></h2>
    <a class="map-link" href="${map}">Map</a>
    <p class="text-tag poi-category"><strong>${category}</strong></p>
    <p>${description}</p>
  </li>`;
}

function page(...cards) {
  return `<main><section class="place-list"><ul>${cards.join("\n")}</ul></section></main>`;
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

test("nested map-linked cards become separate bounded place records", () => {
  const source = page(
    card(),
    card({
      name: "Cliff Park",
      detail: "/places/cliff-park",
      category: "Parks and nature",
      map: "https://maps.google.com/?q=Cliff+Park&amp;loc=55.5101+13.5101&amp;ll=55.5101,13.5101",
    }),
  );
  const records = extractMapLinkedPlaceRecords(source, feed());

  assert.deepEqual(records.map((record) => [record.name, record.type]), [
    ["Harbour Museum", "museum"],
    ["Cliff Park", "park"],
  ]);
  assert.equal(records[0].lat, 55.5001);
  assert.equal(records[0].lng, 13.5001);
  assert.equal(records[0].website, "https://guide.example/places/harbour-museum");
  assert.equal(records[0].operator_reviewed_source, true);
  assert.equal(records[0].sources[0].family, "official");
  assert.doesNotMatch(JSON.stringify(records), /Untrusted prose|popularity|maps\.google/);
});

test("all four same-card facts are required and unknown evidence fails closed", () => {
  const valid = card();
  const invalid = [
    card({ name: "", detail: "/places/no-name" }),
    card({ detail: "https://other.example/place", name: "External identity" }),
    card({ category: "Products of local designers", name: "Unknown category" }),
    card({ map: "https://maps.google.com/?q=No+coordinates", name: "No coordinates" }),
    card({ map: "https://maps.google.com.evil.example/?loc=55.5+13.5", name: "Fake maps" }),
  ];
  const records = extractMapLinkedPlaceRecords(page(valid, ...invalid), feed());
  assert.deepEqual(records.map((record) => record.name), ["Harbour Museum"]);
});

test("a wrapping section cannot assemble one place from sibling card fragments", () => {
  const source = `<main>
    <section class="place-list">
      <ul>
        <li class="place-card">
          <h2><a href="/places/old-church">Old Church</a></h2>
        </li>
        <li class="place-card">
          <a class="map-link" href="https://maps.google.com/?loc=55.5001+13.5001">Map</a>
          <p class="poi-category">Restaurants</p>
        </li>
      </ul>
    </section>
  </main>`;

  assert.deepEqual(extractMapLinkedPlaceRecords(source, feed()), []);
});

test("article and explicitly card-marked section boundaries remain supported", () => {
  const article = card({ name: "Article Museum", detail: "/places/article-museum" })
    .replace(/^<li/, "<article")
    .replace(/<\/li>$/, "</article>");
  const section = card({
    name: "Section Garden",
    detail: "/places/section-garden",
    category: "Gardens",
    map: "https://maps.apple.com/?ll=55.5101,13.5101",
  })
    .replace(/^<li/, "<section")
    .replace(/<\/li>$/, "</section>");

  assert.deepEqual(
    extractMapLinkedPlaceRecords(`<main>${article}${section}</main>`, feed())
      .map((record) => [record.name, record.type]),
    [["Article Museum", "museum"], ["Section Garden", "garden"]],
  );
});

test("ambiguous identities, categories or coordinates inside one card fail closed", () => {
  const ambiguousHeadingIdentity = card().replace(
    "</h2>",
    `</h2><h3><a href="/places/other-museum">Other Museum</a></h3>`,
  );
  const ambiguousLinkedIdentity = card().replace(
    "Harbour Museum</a>",
    `Harbour Museum</a><a href="/places/other-museum">Other identity</a>`,
  );
  const ambiguousCategory = card().replace(
    "</li>",
    `<p class="poi-category">Restaurants</p></li>`,
  );
  const ambiguousCoordinates = card().replace(
    "</li>",
    `<a href="https://maps.apple.com/?ll=55.5201,13.5201">Other map</a></li>`,
  );

  assert.deepEqual(extractMapLinkedPlaceRecords(page(ambiguousHeadingIdentity), feed()), []);
  assert.deepEqual(extractMapLinkedPlaceRecords(page(ambiguousLinkedIdentity), feed()), []);
  assert.deepEqual(extractMapLinkedPlaceRecords(page(ambiguousCategory), feed()), []);
  assert.deepEqual(extractMapLinkedPlaceRecords(page(ambiguousCoordinates), feed()), []);
});

test("coordinate-looking prose and executable payloads cannot create route evidence", () => {
  const source = page(`<li>
    <h2><a href="/places/prose-only">Prose only</a></h2>
    <p class="poi-category">Museums</p>
    <p>maps.google.com/?loc=55.5001+13.5001</p>
    <script><a href="https://maps.google.com/?loc=55.5001+13.5001">Map</a></script>
  </li>`);
  assert.deepEqual(extractMapLinkedPlaceRecords(source, feed()), []);
});

test("inspection requires in-bounds rows and reports compact counts only", () => {
  const source = page(
    card(),
    card({
      name: "Local Gallery",
      detail: "/places/gallery",
      category: "Art galleries",
      map: "https://www.openstreetmap.org/?mlat=55.5201&mlon=13.5201",
    }),
    card({
      name: "Far Beach",
      detail: "/places/far-beach",
      category: "Beaches",
      map: "https://maps.apple.com/?ll=60.1001,18.1001",
    }),
  );
  const summary = inspectMapLinkedPlacePayload(source, {
    endpoint: feed().endpoint,
    bbox: feed().bbox,
    sourceId: "probe-guide",
  });
  assert.deepEqual(summary, {
    status: "ok",
    accepted_place_count: 2,
    distinct_place_type_count: 2,
  });
  assert.equal("records" in summary, false);
});

test("the reviewed collector and qualifier probe share the exact bounded adapter", async () => {
  const source = page(
    card(),
    card({
      name: "Old Town Sight",
      detail: "/places/old-town",
      category: "Sights",
      map: "https://www.google.co.jp/maps/place/55.5301,13.5301",
    }),
  );
  const fetcher = async () => response(source);
  const records = await collectReviewedPlaceFeed(feed(), { fetcher });
  assert.equal(records.length, 2);
  assert.deepEqual(await probeReviewedPlaceFeed(feed(), { fetcher }), {
    status: "ok",
    accepted_place_count: 2,
    distinct_place_type_count: 2,
  });
});

test("only closed coordinate-map hosts and valid coordinate ranges are accepted", () => {
  assert.deepEqual(coordinateMapUrl("https://maps.google.com/?loc=55.5001+13.5001"), {
    lat: 55.5001,
    lng: 13.5001,
  });
  assert.deepEqual(coordinateMapUrl("https://www.openstreetmap.org/?mlat=55.5001&mlon=13.5001"), {
    lat: 55.5001,
    lng: 13.5001,
  });
  assert.equal(coordinateMapUrl("https://maps.google.com.evil.example/?loc=55.5001+13.5001"), null);
  assert.equal(coordinateMapUrl("https://maps.google.com/?loc=155.5001+13.5001"), null);
  assert.equal(coordinateMapUrl("https://other.example/?loc=55.5001+13.5001"), null);
  assert.equal(coordinateMapUrl("https://maps.google.com/?loc=55.5+13.5"), null);
});

test("the adapter contains no destination-specific branch or page fixture", () => {
  const source = fs.readFileSync(
    require.resolve("../server/place-candidates/map-linked-html-place-source"),
    "utf8",
  );
  assert.doesNotMatch(source, /kivik|stockholm|ljubljana|matsumoto|oaxaca|paris|barcelona/i);
  assert.doesNotMatch(source, /visitljubljana|visitystadosterlen|visitmatsumoto|oaxaca\.travel/i);
});
