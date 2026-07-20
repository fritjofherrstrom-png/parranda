"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");

const {
  discoverLocalEventSourcesForPlace,
} = require("../server/pulse-sources/place-event-source-scout");

function resolverFor(label, lat = 55.6, lng = 13, adminContext = null) {
  return async () => [
    {
      label,
      lat,
      lng,
      confidence: "medium",
      provenance: "trusted_test_resolver",
      ...(adminContext ? { admin_context: adminContext } : {}),
    },
  ];
}

function loaded(records, status = `loaded:${records.length}`, error = null) {
  Object.defineProperty(records, "loader_status", { value: status });
  Object.defineProperty(records, "loader_error", { value: error });
  return records;
}

test("trusted place records become bounded scout seeds and review-only manifests", async () => {
  let scoutInput = null;
  const result = await discoverLocalEventSourcesForPlace({
    placeQuery: "Test Place",
    placeResolver: resolverFor("Test Place, Region"),
    openDataLoader: async () =>
      loaded([
        {
          id: "osm-node-1",
          name: "Local venue",
          type: "gallery",
          website: "https://venue.example/program",
          lat: 55.61,
          lng: 13.01,
          raw_private_payload: "must-not-leak",
        },
        {
          id: "private",
          name: "Private host",
          website: "http://127.0.0.1/calendar",
        },
      ]),
    sourceScout: async (input) => {
      scoutInput = input;
      return {
        status: "complete",
        reasons: ["bounded_source_scout_complete"],
        discovery_queries: ["Test Place events"],
        inspected_source_count: 1,
        blocked_source_count: 0,
        failed_source_count: 0,
        linked_page_attempt_count: 1,
        linked_source_count: 1,
        results: [
          {
            source_url: "https://venue.example/program",
            source_identity: "venue.example",
            status: "inspected",
            detected: ["ical"],
            reasons: ["source_interfaces_detected"],
            manifest_candidates: [{ endpoint: "https://venue.example/events.ics" }],
            social_hints: [],
            raw_html: "must-not-leak",
          },
        ],
        manifest_candidates: [
          {
            id: "candidate-feed",
            adapter: "ical",
            endpoint: "https://venue.example/events.ics",
            status: "active",
            runtime_policy: "active",
            enabled: true,
            raw_secret: "must-not-leak",
          },
        ],
        social_hints: [],
      };
    },
  });

  assert.equal(result.status, "complete");
  assert.equal(result.activation_performed, false);
  assert.equal(result.loader.trusted_record_count, 2);
  assert.equal(result.loader.website_seed_count, 1);
  assert.equal(result.source_scout.linked_page_attempt_count, 1);
  assert.equal(result.source_scout.linked_source_count, 1);
  assert.equal(scoutInput.seeds.length, 1);
  assert.equal(scoutInput.seeds[0].url, "https://venue.example/program");
  assert.deepEqual(scoutInput.anchor, { lat: 55.6, lng: 13 });
  assert.equal(result.manifest_candidates[0].status, "review-needed");
  assert.equal(result.manifest_candidates[0].runtime_policy, "review_required");
  assert.equal("enabled" in result.manifest_candidates[0], false);
  assert.deepEqual(result.source_results, [
    {
      source_url: "https://venue.example/program",
      source_identity: "venue.example",
      status: "inspected",
      detected: ["ical"],
      reasons: ["source_interfaces_detected"],
      manifest_candidate_count: 1,
      social_hint_count: 0,
    },
  ]);
  assert.doesNotMatch(
    JSON.stringify(result),
    /raw_private_payload|raw_html|raw_secret|must-not-leak/,
  );
});

test("trusted administrative identity produces a generic regional source profile", async () => {
  let scoutInput = null;
  const result = await discoverLocalEventSourcesForPlace({
    placeQuery: "Stockholm",
    placeResolver: resolverFor("Stockholm, Sverige", 59.3293, 18.0686, {
      locality: "Stockholm",
      municipality: "Stockholms kommun",
      county: "Stockholms län",
      region: "Stockholms län",
      country: "Sverige",
      country_code: "se",
      postcode: "must-not-leak",
    }),
    openDataLoader: async () =>
      loaded([
        {
          id: "venue-1",
          name: "Independent venue",
          type: "gallery",
          website: "https://venue.example/events",
        },
      ]),
    bounds: [17.8, 59.1, 18.3, 59.5],
    intentHints: ["culture"],
    localDiscoveryTerms: ["evenemang"],
    timeWindow: {
      label: "this_week",
      starts_at: "2026-07-20",
      ends_at: "2026-07-27",
    },
    sourceScout: async (input) => {
      scoutInput = input;
      return {
        status: "complete",
        reasons: ["bounded_source_scout_complete"],
        inspected_source_count: 1,
        results: [
          {
            source_url: "https://venue.example/events",
            source_identity: "venue.example",
            status: "inspected",
            detected: ["schema_org_html"],
            reasons: ["source_interfaces_detected"],
            candidates: [
              {
                id: "schema-source",
                place: "Stockholm",
                family: "cultural_institution_calendar",
                source_label: "Independent venue",
                url: "https://venue.example/events",
                source_identity: "venue.example",
                adapter: "schema_org_event",
                extraction_tier: "schema_org_json_ld",
                source_language: "sv",
                trust_tier: "institution",
                terms_status: "api_terms_compatible",
                source_health: "healthy",
                runtime_policy: "review_needed",
                extractable: {
                  title: true,
                  start: true,
                  end: true,
                  venue: true,
                  source_url: true,
                  venue_geocodable: true,
                  schema_org_event: true,
                },
                raw_html: "must-not-leak",
              },
            ],
            manifest_candidates: [],
            social_hints: [],
          },
        ],
        manifest_candidates: [],
        social_hints: [
          {
            id: "social-source",
            url: "https://social.example/events",
            source_identity: "social.example",
            source_label: "Community listings",
            family: "community_social_listing",
            extraction_tier: "weak_social_manual",
            runtime_policy: "probe_only",
            corroboration_required: true,
          },
        ],
      };
    },
  });

  assert.equal(scoutInput.place.name, "Stockholm");
  assert.deepEqual(scoutInput.place.region_terms, [
    "Stockholms kommun",
    "Stockholms län",
    "Sverige",
  ]);
  assert.ok(result.discovery_queries.includes("Stockholms kommun events"));
  assert.match(result.source_profile.profile_key, /^place-source-profile-v1:[a-f0-9]{16}$/);
  assert.equal(result.source_profile.place_context.label, "Stockholm, Sverige");
  assert.deepEqual(result.source_profile.place_context.region_terms, [
    "Stockholms kommun",
    "Stockholms län",
    "Sverige",
  ]);
  assert.deepEqual(result.source_profile.place_context.bounds, {
    north: 59.5,
    south: 59.1,
    east: 18.3,
    west: 17.8,
  });
  assert.equal(result.source_profile.time_window.label, "this_week");
  assert.ok(result.source_profile.discovery_terms.includes("evenemang"));
  assert.ok(result.source_profile.discovery_terms.includes("culture"));
  assert.equal(result.source_profile.coverage.status, "thin");
  assert.deepEqual(result.source_profile.coverage.needs_review_families, [
    "cultural_institution_calendar",
  ]);
  assert.equal(result.source_profile.coverage.can_collect_pulse_candidates, false);
  assert.equal(
    result.source_profile.source_families.find(
      (family) => family.family === "cultural_institution_calendar",
    ).status,
    "needs_review",
  );
  assert.equal(result.source_profile.social_coverage.status, "needs_corroboration");
  assert.equal(result.activation_performed, false);
  assert.doesNotMatch(JSON.stringify(result), /postcode|raw_html|must-not-leak/);
});

test("ambiguous or weak place resolution fails closed before loading records", async () => {
  let loaderCalls = 0;
  let scoutCalls = 0;
  const result = await discoverLocalEventSourcesForPlace({
    placeQuery: "Springfield",
    placeResolver: async () => [
      { label: "One", lat: 1, lng: 1, confidence: "medium" },
      { label: "Two", lat: 2, lng: 2, confidence: "medium" },
    ],
    openDataLoader: async () => {
      loaderCalls += 1;
      return [];
    },
    sourceScout: async () => {
      scoutCalls += 1;
      return {};
    },
  });

  assert.equal(result.status, "blocked");
  assert.deepEqual(result.reasons, ["ambiguous_place"]);
  assert.equal(loaderCalls, 0);
  assert.equal(scoutCalls, 0);
});

test("missing trusted seams and loader failures remain explicit", async () => {
  const noResolver = await discoverLocalEventSourcesForPlace({
    placeQuery: "Somewhere",
  });
  assert.equal(noResolver.status, "unavailable");
  assert.deepEqual(noResolver.reasons, ["place_resolver_unavailable"]);

  const noLoader = await discoverLocalEventSourcesForPlace({
    placeQuery: "Somewhere",
    placeResolver: resolverFor("Somewhere"),
  });
  assert.equal(noLoader.status, "unavailable");
  assert.deepEqual(noLoader.reasons, ["trusted_place_loader_unavailable"]);

  const loaderFailure = await discoverLocalEventSourcesForPlace({
    placeQuery: "Somewhere",
    placeResolver: resolverFor("Somewhere"),
    openDataLoader: async () => {
      throw new Error("https://secret.example?key=credential");
    },
  });
  assert.equal(loaderFailure.status, "failed");
  assert.deepEqual(loaderFailure.reasons, ["trusted_place_loader_failed"]);
  assert.doesNotMatch(JSON.stringify(loaderFailure), /secret|credential/);
});

test("healthy records without websites return an honest empty result", async () => {
  let scoutCalled = false;
  const result = await discoverLocalEventSourcesForPlace({
    placeQuery: "Sparse Place",
    placeResolver: resolverFor("Sparse Place"),
    openDataLoader: async () => loaded([{ id: "osm-1", name: "Town park" }]),
    sourceScout: async () => {
      scoutCalled = true;
      return {};
    },
  });

  assert.equal(result.status, "empty");
  assert.deepEqual(result.reasons, ["no_trusted_website_seeds"]);
  assert.equal(result.loader.status, "loaded:1");
  assert.equal(scoutCalled, false);
});

test("public-looking records cannot bypass the trusted loader", async () => {
  let scoutCalled = false;
  const result = await discoverLocalEventSourcesForPlace({
    placeQuery: "Test Place",
    placeResolver: resolverFor("Test Place"),
    records: [
      {
        name: "Injected venue",
        website: "https://injected.example/events",
      },
    ],
    openDataLoader: async () => loaded([]),
    sourceScout: async () => {
      scoutCalled = true;
      return {};
    },
  });

  assert.equal(result.status, "empty");
  assert.deepEqual(result.reasons, ["no_trusted_place_records"]);
  assert.deepEqual(result.trusted_website_seeds, []);
  assert.equal(scoutCalled, false);
});

test("partial scout health remains visible without leaking source bodies", async () => {
  const result = await discoverLocalEventSourcesForPlace({
    placeQuery: "Test Place",
    placeResolver: resolverFor("Test Place"),
    openDataLoader: async () =>
      loaded([
        {
          name: "Venue",
          type: "museum",
          website: "https://venue.example/events",
        },
      ]),
    sourceScout: async () => ({
      status: "complete",
      reasons: ["bounded_source_scout_complete"],
      inspected_source_count: 0,
      blocked_source_count: 0,
      failed_source_count: 1,
      results: [
        {
          source_url: "https://venue.example/events",
          status: "failed",
          reasons: ["source_timeout"],
          social_hints: [],
          response_body: "must-not-leak",
        },
      ],
      manifest_candidates: [],
    }),
  });

  assert.equal(result.status, "complete");
  assert.equal(result.source_scout.failed_source_count, 1);
  assert.deepEqual(result.source_results[0].reasons, ["source_timeout"]);
  assert.doesNotMatch(JSON.stringify(result), /response_body|must-not-leak/);
});

test("the same place-driven bridge works for unrelated place labels", async () => {
  async function run(placeQuery, lat) {
    return discoverLocalEventSourcesForPlace({
      placeQuery,
      placeResolver: resolverFor(`${placeQuery}, Region`, lat, 10),
      openDataLoader: async () =>
        loaded([
          {
            name: `${placeQuery} Hall`,
            type: "gallery",
            website: `https://${placeQuery.toLowerCase()}.example/events`,
          },
        ]),
      sourceScout: async ({ seeds }) => ({
        status: "complete",
        reasons: ["bounded_source_scout_complete"],
        inspected_source_count: seeds.length,
        manifest_candidates: [],
      }),
    });
  }

  const first = await run("Northport", 60);
  const second = await run("Southbay", -30);
  assert.equal(first.status, "complete");
  assert.equal(second.status, "complete");
  assert.notEqual(first.anchor.lat, second.anchor.lat);
  assert.match(first.trusted_website_seeds[0].url, /northport/);
  assert.match(second.trusted_website_seeds[0].url, /southbay/);
  assert.notEqual(first.source_profile.profile_key, second.source_profile.profile_key);
  assert.deepEqual(first.source_profile.coverage.covered_families, []);
  assert.equal(first.source_profile.coverage.can_collect_pulse_candidates, false);
});

test("place-event source bridge contains no city branches or activation path", () => {
  const source = fs.readFileSync(
    require.resolve("../server/pulse-sources/place-event-source-scout"),
    "utf8",
  );
  assert.doesNotMatch(source, /athens|rome|barcelona|helsinki|österlen|skåne|malm[oö]/i);
  assert.doesNotMatch(source, /status:\s*["']active["']/);
});
