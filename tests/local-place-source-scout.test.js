"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");

const {
  buildLocalPlaceDiscoveryQueryPlan,
  extractPlaceListPageLinks,
  inspectPlaceSourcePage,
} = require("../server/pulse-sources/local-place-source-scout");
const {
  scoutLocalEventSources,
  buildLocalSourceDiscoveryQueryPlan,
} = require("../server/pulse-sources/local-event-source-scout");

function placeList(items = defaultPlaces()) {
  return `<script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org",
    "@type": "ItemList",
    itemListElement: items.map((item) => ({ "@type": "ListItem", item })),
  })}</script>`;
}

function placeListDetail() {
  return `
    <div class="vs-experience-card" data-title="harbour museum" data-categories="place-en" data-subcategories="museum-en">
      <div class="vs-title">Harbour Museum</div>
      <div class="vs-categories"><span class="vs-category primary">Activities</span><span class="vs-category">Museum</span></div>
      <a href="/places/harbour-museum" class="vs-readmore">Read more</a>
    </div>
    <div class="vs-experience-card" data-title="cliff park" data-categories="place-en" data-subcategories="park-en">
      <div class="vs-title">Cliff Park</div>
      <div class="vs-categories"><span class="vs-category primary">Activities</span><span class="vs-category">Park</span></div>
      <a href="/places/cliff-park" class="vs-readmore">Read more</a>
    </div>`;
}

function defaultPlaces() {
  return [
    {
      "@type": "Museum",
      "@id": "https://guide.example/places/harbour-museum",
      name: "Harbour Museum",
      geo: { "@type": "GeoCoordinates", latitude: 55.55, longitude: 14.35 },
    },
    {
      "@type": "Park",
      "@id": "https://guide.example/places/cliff-park",
      name: "Cliff Park",
      geo: { "@type": "GeoCoordinates", latitude: 55.56, longitude: 14.36 },
    },
  ];
}

function mapLinkedPlaceList() {
  return `
    <ul>
      <li class="poi-card">
        <h3><a href="/places/harbour-museum">Harbour Museum</a></h3>
        <span class="poi-category">Museum</span>
        <a href="https://www.google.com/maps?q=55.5501,14.3501">Map</a>
      </li>
      <li class="poi-card">
        <h3><a href="/places/cliff-park">Cliff Park</a></h3>
        <span data-place-type="Parks and nature">Nature</span>
        <a href="https://www.openstreetmap.org/?mlat=55.5601&amp;mlon=14.3601">Map</a>
      </li>
    </ul>`;
}

function context() {
  return {
    anchor: { lat: 55.55, lng: 14.35 },
    bounds: [14.1, 55.3, 14.6, 55.8],
  };
}

test("place-source query planning is bounded, localized and location-generic", () => {
  const plan = buildLocalPlaceDiscoveryQueryPlan({
    place: {
      name: "Northport",
      label: "Northport, Coastal Region",
      region_terms: ["Coastal Region"],
      local_place_discovery_terms: ["sevärdheter", "besöksmål"],
    },
  });

  assert.ok(plan.some((item) => item.query === "Northport sevärdheter"));
  assert.ok(plan.some((item) => item.query.includes("official tourism attractions")));
  assert.ok(plan.some((item) => item.query.includes("things to do")));
  assert.ok(plan.length <= 8);
  assert.ok(plan.every((item) => item.query_family && item.term_key));
});

test("the earliest bounded search tranche represents both event and place supply", () => {
  const plan = buildLocalSourceDiscoveryQueryPlan({
    place: {
      name: "Northport",
      label: "Northport, Coastal Region",
      local_discovery_terms: ["evenemang", "marknad"],
      local_place_discovery_terms: ["sevärdheter", "besöksmål"],
    },
  });
  const firstTranche = plan.slice(0, 6);

  assert.ok(firstTranche.some((item) => item.query_family === "local_discovery"));
  assert.ok(firstTranche.some((item) => item.query_family === "local_place_guide"));
  assert.ok(firstTranche.some((item) => item.query_family === "generic_events"));
  assert.ok(firstTranche.some((item) => item.query_family === "official_place_guide"));
  assert.ok(plan.length <= 26);
});

test("two exact in-scope schema.org places become one review-only source candidate", () => {
  const result = inspectPlaceSourcePage({
    seed: {
      url: "https://guide.example/see-and-do",
      label: "Official destination guide",
      family: "official_tourism_calendar",
      trust_tier: "official",
      terms_status: "open_license",
    },
    body: placeList(),
    contentType: "text/html",
    context: context(),
  });

  assert.equal(result.candidate.candidate_kind, "place_list");
  assert.equal(result.candidate.status, "viable_place_provider_probe");
  assert.equal(result.candidate.maps_to_existing_provider, true);
  assert.equal(result.candidate.accepted_place_count, 2);
  assert.equal(result.manifest_candidate.adapter, "schema_org_place_html");
  assert.equal(result.manifest_candidate.status, "review-needed");
  assert.equal(result.manifest_candidate.runtime_policy, "review_required");
  assert.equal(result.manifest_candidate.review.robots_status, "review_at_activation");
  assert.equal(result.manifest_candidate.activation_performed, undefined);
});

test("map-linked place cards enter the same review-only source lane", () => {
  const result = inspectPlaceSourcePage({
    seed: {
      url: "https://guide.example/see-and-do",
      label: "Official destination guide",
      trust_tier: "official",
      terms_status: "open_license",
    },
    body: mapLinkedPlaceList(),
    contentType: "text/html",
    context: context(),
  });

  assert.equal(result.candidate.adapter, "map_linked_place_html");
  assert.equal(result.candidate.accepted_place_count, 2);
  assert.equal(result.manifest_candidate.adapter, "map_linked_place_html");
  assert.equal(result.manifest_candidate.status, "review-needed");
  assert.equal(result.manifest_candidate.runtime_policy, "review_required");
  assert.equal(result.manifest_candidate.activation_performed, undefined);
});

test("a same-origin verified experience-card list enters the bounded review-only adapter", () => {
  const result = inspectPlaceSourcePage({
    seed: {
      url: "https://guide.example/see-and-do",
      label: "Official destination guide",
      trust_tier: "official",
      terms_status: "open_license",
    },
    body: placeListDetail(),
    contentType: "text/html",
    context: context(),
  });

  assert.equal(result.candidate.adapter, "experience_card_place_list_detail_html");
  assert.equal(result.candidate.accepted_place_count, 0);
  assert.equal(result.candidate.detail_link_count, 2);
  assert.equal(result.manifest_candidate.adapter, "experience_card_place_list_detail_html");
  assert.equal(result.manifest_candidate.max_items, 2);
  assert.equal(result.manifest_candidate.status, "review-needed");
});

test("individual venues, generic businesses and out-of-scope rows are not place-list sources", () => {
  for (const items of [
    defaultPlaces().slice(0, 1),
    defaultPlaces().map((item) => ({ ...item, "@type": "LocalBusiness" })),
    defaultPlaces().map((item) => ({
      ...item,
      geo: { "@type": "GeoCoordinates", latitude: 60, longitude: 18 },
    })),
  ]) {
    const result = inspectPlaceSourcePage({
      seed: { url: "https://guide.example/place" },
      body: placeList(items),
      context: context(),
    });
    assert.equal(result.candidate, null);
    assert.equal(result.manifest_candidate, null);
  }
});

test("restricted terms retain no manifest and never become review-capable", () => {
  const result = inspectPlaceSourcePage({
    seed: { url: "https://guide.example/places", terms_status: "restricted" },
    body: placeList(),
    context: context(),
  });
  assert.equal(result.candidate.status, "rejected");
  assert.deepEqual(result.candidate.blockers, ["terms_restricted"]);
  assert.equal(result.manifest_candidate, null);
});

test("place-list navigation follows only matching same-origin HTTPS links", () => {
  const links = extractPlaceListPageLinks({
    pageUrl: "https://guide.example/",
    localPlaceDiscoveryTerms: ["sevärdheter"],
    links: [
      { url: "https://guide.example/sevardheter", text: "Sevärdheter" },
      { url: "https://guide.example/about", text: "About us" },
      { url: "https://other.example/attractions", text: "Attractions" },
      { url: "http://guide.example/attractions", text: "Attractions" },
    ],
  });
  assert.deepEqual(links.map((item) => item.url), ["https://guide.example/sevardheter"]);
});

test("the bounded worker scout follows a local place-list link and carries robots approval", async () => {
  const bodies = new Map([
    ["https://guide.example/robots.txt", "User-agent: *\nAllow: /"],
    ["https://guide.example/", '<a href="/sevardheter">Sevärdheter</a>'],
    ["https://guide.example/sevardheter", placeList()],
  ]);
  const result = await scoutLocalEventSources({
    place: { local_place_discovery_terms: ["sevärdheter"] },
    anchor: context().anchor,
    bounds: context().bounds,
    seeds: [{ url: "https://guide.example/", trust_tier: "official" }],
    fetcher: async (url) => ({
      ok: bodies.has(url),
      status: bodies.has(url) ? 200 : 404,
      headers: { get: (name) => String(name).toLowerCase() === "content-type" ? "text/html" : null },
      text: async () => bodies.get(url) || "",
    }),
  });

  assert.equal(result.manifest_candidates.length, 0);
  assert.equal(result.place_manifest_candidates.length, 1);
  assert.equal(result.place_manifest_candidates[0].review.robots_status, "allowed");
  assert.equal(result.place_source_candidates.length, 1);
  assert.ok(result.results.some((item) => item.discovery_method === "same_origin_place_link"));
});

test("place discovery implementation contains no city-specific branch or activation lane", () => {
  const source = fs.readFileSync(
    require.resolve("../server/pulse-sources/local-place-source-scout"),
    "utf8",
  );
  assert.doesNotMatch(source, /kivik|stockholm|ljubljana|paris|barcelona|naxos/i);
  assert.doesNotMatch(source, /runtime_ok|bounded_refresh|status:\s*["']active["']/i);
});
