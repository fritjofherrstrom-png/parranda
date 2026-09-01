"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");

const {
  combineSeeds,
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

function response(body, { status = 200, contentType = "text/html" } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get(name) {
        if (String(name).toLowerCase() === "content-type") return contentType;
        return null;
      },
    },
    text: async () => body,
  };
}

test("source-class interleaving keeps search and trusted websites inside the scout prefix", () => {
  const trusted = [
    { url: "https://city.example/events", trust_tier: "official", family: "official_municipal_calendar" },
    ...Array.from({ length: 14 }, (_, index) => ({
      url: `https://venue-${index}.example/program`,
      trust_tier: "unknown",
      family: "venue_owned_calendar",
    })),
  ];
  const searched = Array.from({ length: 4 }, (_, index) => ({
    url: `https://search-${index}.example/calendar`,
    trust_tier: "unknown",
    family: "unknown_source_family",
    discovery_method: "bounded_source_search",
  }));

  const prefix = combineSeeds(trusted, searched).slice(0, 12);
  assert.equal(prefix[0].url, "https://city.example/events");
  assert.ok(prefix.some((seed) => seed.discovery_method === "bounded_source_search"));
  assert.ok(prefix.some((seed) => seed.family === "venue_owned_calendar"));
  assert.ok(
    prefix.filter((seed) => seed.discovery_method === "bounded_source_search").length >= 3,
    "venue websites cannot starve real search seeds before the scout cap",
  );
});

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
      place_manifest_candidate_count: 0,
      exploratory_interface_count: 0,
      social_hint_count: 0,
    },
  ]);
  assert.doesNotMatch(
    JSON.stringify(result),
    /raw_private_payload|raw_html|raw_secret|must-not-leak/,
  );
});

test("structured place sources enter the dedicated profile lane but remain review-only", async () => {
  const placeCandidate = {
    id: "scout-place-regional-guide",
    candidate_kind: "place_list",
    family: "official_place_guide",
    source_label: "Regional guide",
    url: "https://guide.example/places",
    source_identity: "guide.example",
    adapter: "schema_org_place_html",
    status: "viable_place_provider_probe",
    maps_to_existing_provider: true,
    trust_tier: "official",
    terms_status: "open_license",
    source_health: "healthy",
    runtime_policy: "review_needed",
    raw_rows: ["must-not-leak"],
  };
  const result = await discoverLocalEventSourcesForPlace({
    placeQuery: "Test Place",
    placeResolver: resolverFor("Test Place, Region", 55.6, 13, {
      locality: "Test Place",
      country_code: "se",
    }),
    openDataLoader: async () => loaded([{
      name: "Official guide",
      website: "https://guide.example/",
      trust_tier: "official",
    }]),
    bounds: [12.8, 55.4, 13.3, 55.8],
    sourceScout: async () => ({
      status: "complete",
      reasons: ["bounded_source_scout_complete"],
      inspected_source_count: 1,
      results: [],
      manifest_candidates: [],
      place_source_candidates: [placeCandidate],
      place_manifest_candidates: [{
        id: placeCandidate.id,
        label: placeCandidate.source_label,
        endpoint: placeCandidate.url,
        adapter: placeCandidate.adapter,
        bbox: [12.8, 55.4, 13.3, 55.8],
        source_tier: "official",
        source_identity: placeCandidate.source_identity,
        status: "active",
        runtime_policy: "bounded_refresh",
        review: { terms_status: "open_license", robots_status: "allowed" },
        raw_rows: ["must-not-leak"],
      }],
    }),
  });

  assert.ok(result.discovery_queries.some((query) => query.includes("sevärdheter")));
  assert.equal(result.place_manifest_candidates.length, 1);
  assert.equal(result.place_manifest_candidates[0].status, "review-needed");
  assert.equal(result.place_manifest_candidates[0].runtime_policy, "review_required");
  assert.equal(result.source_profile.place_source_candidates.length, 1);
  assert.equal(result.source_profile.place_source_candidates[0].id, placeCandidate.id);
  assert.equal(result.source_profile.place_source_candidates[0].url, placeCandidate.url);
  assert.equal(result.source_profile.place_source_candidates[0].runtime_policy, "review_needed");
  assert.deepEqual(result.source_profile.runtime_review.place_sources, []);
  assert.equal(result.source_profile.place_source_qualification, undefined);
  assert.doesNotMatch(JSON.stringify(result), /raw_rows|must-not-leak/);
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
  assert.deepEqual(result.source_profile.runtime_review, {
    status: "unreviewed",
    reviewed_at: null,
    expires_at: null,
    feeds: [],
    place_sources: [],
  });
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

test("trusted regional bounds reach the seed loader without changing the anchor", async () => {
  let loaderInput = null;
  const spatialScope = {
    source: "resolver_bounds",
    kind: "region",
    bounds: { west: 12.8, south: 55.4, east: 13.3, north: 55.8 },
  };
  const result = await discoverLocalEventSourcesForPlace({
    placeQuery: "Test Region",
    placeResolver: async () => [{
      label: "Test Region, Test Country",
      lat: 55.6,
      lng: 13,
      confidence: "high",
      provenance: "trusted_test_resolver",
      admin_context: { region: "Test Region", country_code: "tc" },
      spatial_scope: spatialScope,
    }],
    openDataLoader: async (input) => {
      loaderInput = input;
      return loaded([]);
    },
  });

  assert.equal(result.status, "empty");
  assert.deepEqual({ lat: loaderInput.lat, lng: loaderInput.lng }, { lat: 55.6, lng: 13 });
  assert.equal(loaderInput.anchorMode, "place");
  assert.equal(loaderInput.spatialScope.collection_mode, "regional_bounded");
  assert.deepEqual(loaderInput.spatialScope.bounds, spatialScope.bounds);
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

test("bounded source search can supply review-only seeds without a place loader", async () => {
  let searchInput = null;
  let scoutInput = null;
  const result = await discoverLocalEventSourcesForPlace({
    placeQuery: "Northport",
    placeResolver: resolverFor("Northport, Sverige", 59, 18, {
      locality: "Northport",
      country: "Sverige",
      country_code: "se",
    }),
    sourceSearch: async (input) => {
      searchInput = input;
      return {
        contract: "bounded_source_search_v1",
        status: "complete",
        reasons: ["bounded_source_search_complete"],
        queried_count: 6,
        responding_query_count: 6,
        failed_query_count: 0,
        result_count: 1,
        seed_count: 1,
        seeds: [{
          url: "https://northport-events.example/calendar",
          label: "Northport calendar",
          family: "official_city_calendar",
          trust_tier: "official",
          status: "active",
          runtime_policy: "active",
          source_language: "sv",
          discovered_from: "Northport evenemang",
        }],
        query_outcomes: [{
          query_key: "abcdef123456",
          status: "ok",
          reason: "source_search_results_found",
          result_count: 1,
          raw_payload: "must-not-leak",
        }],
        activation_performed: true,
        raw_payload: "must-not-leak",
      };
    },
    sourceScout: async (input) => {
      scoutInput = input;
      return {
        status: "complete",
        reasons: ["bounded_source_scout_complete"],
        inspected_source_count: 1,
        results: [],
        manifest_candidates: [],
      };
    },
  });

  assert.ok(searchInput.queries.includes("Northport evenemang"));
  assert.deepEqual(searchInput.place.language_hints, ["sv"]);
  assert.ok(searchInput.place.local_discovery_terms.includes("loppis"));
  assert.equal(scoutInput.seeds.length, 1);
  assert.deepEqual(scoutInput.seeds[0], {
    url: "https://northport-events.example/calendar",
    label: "Northport calendar",
    place: "Northport, Sverige",
    family: "unknown_source_family",
    trust_tier: "unknown",
    source_language: null,
    discovery_method: "bounded_source_search",
    discovered_from: "Northport evenemang",
  });
  assert.equal(result.status, "complete");
  assert.equal(result.loader.status, "unavailable");
  assert.equal(result.source_search.status, "complete");
  assert.equal(result.source_search.activation_performed, false);
  assert.equal(result.activation_performed, false);
  assert.doesNotMatch(JSON.stringify(result), /must-not-leak|runtime_policy|official_city_calendar/);
});

test("cold source search discovers official program articles across unrelated place contexts", async () => {
  const fixtures = [
    {
      place: "Harbourton",
      countryCode: "se",
      language: "sv",
      url: "https://harbourton.example/nyheter/sommarprogram",
      heading: "Program vid Hamnscenen",
      rows: ["5 juni 18.00 Lokal orkester", "5 juni 20.00 Kvällskonsert"],
      expectedTerm: "evenemang",
    },
    {
      place: "Ville-sur-Rive",
      countryCode: "fr",
      language: "fr",
      url: "https://ville-sur-rive.example/actualites/programme-ete",
      heading: "Programme au Jardin civique",
      rows: ["6 juillet 18.00 Concert local", "6 juillet 21.00 Cinéma en plein air"],
      expectedTerm: "événements",
    },
    {
      place: "Porto Novo",
      countryCode: "pt",
      language: "pt",
      url: "https://porto-novo.example/noticias/programa-verao",
      heading: "Programa no Parque municipal",
      rows: ["7 agosto 18.00 Mercado local", "7 agosto 21.00 Concerto noturno"],
      expectedTerm: "eventos",
    },
  ];

  const results = [];
  for (let index = 0; index < fixtures.length; index += 1) {
    const fixture = fixtures[index];
    const html = [
      `<html lang="${fixture.language}"><body>`,
      "<h1>Summer programme 2026</h1>",
      `<h2>${fixture.heading}</h2>`,
      ...fixture.rows.map((row) => `<p>${row}</p>`),
      "</body></html>",
    ].join("");
    const result = await discoverLocalEventSourcesForPlace({
      placeQuery: fixture.place,
      placeResolver: resolverFor(fixture.place, 45 + index, 8 + index, {
        locality: fixture.place,
        country_code: fixture.countryCode,
      }),
      openDataLoader: async () => loaded([]),
      bounds: [7 + index, 44 + index, 9 + index, 46 + index],
      sourceSearch: async () => ({
        status: "complete",
        reasons: ["bounded_source_search_complete"],
        queried_count: 8,
        responding_query_count: 8,
        result_count: 1,
        seed_count: 1,
        seeds: [{ url: fixture.url, discovered_from: `${fixture.place} ${fixture.expectedTerm}` }],
      }),
      scoutOptions: {
        fetcher: async (url) => response(
          String(url).endsWith("/robots.txt") ? "User-agent: *\nAllow: /" : html,
          { contentType: String(url).endsWith("/robots.txt") ? "text/plain" : "text/html" },
        ),
      },
    });

    assert.ok(result.discovery_queries.includes(`${fixture.place} ${fixture.expectedTerm}`));
    assert.equal(result.source_search.accepted_seed_count, 1);
    assert.equal(result.source_results[0].detected[0], "official_program_article");
    assert.equal(result.manifest_candidates[0].adapter, "official_program_article");
    assert.equal(result.manifest_candidates[0].source_language, fixture.language);
    assert.equal(result.manifest_candidates[0].review.robots_status, "allowed");
    assert.equal(result.manifest_candidates[0].status, "review-needed");
    assert.equal(result.activation_performed, false);
    results.push(result);
  }

  assert.equal(new Set(results.map((result) => result.source_profile.profile_key)).size, fixtures.length);
});

test("search failure does not discard a trusted venue website seed", async () => {
  let scoutInput = null;
  const result = await discoverLocalEventSourcesForPlace({
    placeQuery: "Southbay",
    placeResolver: resolverFor("Southbay"),
    openDataLoader: async () => loaded([{
      name: "Independent venue",
      website: "https://venue.example/program",
    }]),
    sourceSearch: async () => {
      throw new Error("https://secret.example?credential=hidden");
    },
    sourceScout: async (input) => {
      scoutInput = input;
      return {
        status: "complete",
        reasons: ["bounded_source_scout_complete"],
        inspected_source_count: 1,
        manifest_candidates: [],
      };
    },
  });

  assert.equal(result.status, "complete");
  assert.equal(result.source_search.status, "failed");
  assert.deepEqual(scoutInput.seeds.map((seed) => seed.url), [
    "https://venue.example/program",
  ]);
  assert.doesNotMatch(JSON.stringify(result), /secret|credential|hidden/);
});

test("bounded search empty cannot disguise a missing trusted loader as proven empty", async () => {
  const result = await discoverLocalEventSourcesForPlace({
    placeQuery: "Northport",
    placeResolver: resolverFor("Northport"),
    sourceSearch: async () => ({
      status: "empty",
      reasons: ["source_search_no_public_results"],
      queried_count: 6,
      responding_query_count: 6,
      seed_count: 0,
      seeds: [],
    }),
  });

  assert.equal(result.status, "unavailable");
  assert.deepEqual(result.reasons, [
    "trusted_place_loader_unavailable",
    "source_search_no_public_results",
  ]);
  assert.equal(result.source_search.status, "empty");
  assert.equal(result.source_search.accepted_seed_count, 0);
});

test("bounded source search remains isolated across unrelated place contexts", async () => {
  const searched = [];
  async function run(placeQuery, countryCode, url) {
    return discoverLocalEventSourcesForPlace({
      placeQuery,
      placeResolver: resolverFor(placeQuery, 48, 2, {
        locality: placeQuery,
        country_code: countryCode,
      }),
      openDataLoader: async () => loaded([]),
      sourceSearch: async (input) => {
        searched.push(input);
        return {
          status: "complete",
          reasons: ["bounded_source_search_complete"],
          seeds: [{ url }],
          seed_count: 1,
        };
      },
      sourceScout: async () => ({
        status: "complete",
        reasons: ["bounded_source_scout_complete"],
        manifest_candidates: [],
      }),
    });
  }

  const first = await run("Northport", "fr", "https://north.example/agenda");
  const second = await run("Southbay", "cz", "https://south.example/akce");
  assert.ok(searched[0].queries.includes("Northport vide-greniers"));
  assert.ok(searched[1].queries.includes("Southbay akce"));
  assert.doesNotMatch(searched[0].queries.join("|"), /Southbay|akce/);
  assert.doesNotMatch(searched[1].queries.join("|"), /Northport|vide-greniers/);
  assert.match(first.trusted_website_seeds[0].url, /north\.example/);
  assert.match(second.trusted_website_seeds[0].url, /south\.example/);
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
    source_search: async () => ({
      status: "complete",
      seeds: [{ url: "https://injected-search.example/events" }],
    }),
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

test("production discovery and provider code contains no cold-canary special cases", () => {
  const roots = [
    require("node:path").join(__dirname, "..", "server"),
    require("node:path").join(__dirname, "..", "scripts"),
  ];
  const files = roots.flatMap(walkJavaScriptFiles);
  const source = files.map((file) => fs.readFileSync(file, "utf8")).join("\n");
  assert.doesNotMatch(source, /felanitx|sant[ -]agust[ií]|felanitx\.org/i);
});

function walkJavaScriptFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = require("node:path").join(directory, entry.name);
    if (entry.isDirectory()) return walkJavaScriptFiles(path);
    return entry.isFile() && /\.m?js$/.test(entry.name) ? [path] : [];
  });
}
