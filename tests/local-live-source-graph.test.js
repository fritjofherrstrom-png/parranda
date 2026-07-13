const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");

const {
  buildLocalLiveSourceGraph,
} = require("../server/pulse-sources/local-live-source-graph");
const {
  SOURCE_FAMILIES,
} = require("../server/pulse-sources/source-discovery");

function source(overrides = {}) {
  return {
    id: "source",
    place: "Test Region",
    family: "official_municipal_calendar",
    source_label: "Test Region Events",
    url: "https://events.example.test/calendar",
    adapter: "the_events_calendar",
    extraction_tier: "official_api_open_data",
    trust_tier: "official",
    terms_status: "api_terms_compatible",
    source_health: "healthy",
    runtime_policy: "runtime_ok",
    extractable: {
      title: true,
      start: true,
      end: true,
      venue: true,
      source_url: true,
      venue_geocodable: true,
    },
    ...overrides,
  };
}

test("local live source graph turns independent sources into coverage, not a raw list", () => {
  const graph = buildLocalLiveSourceGraph({
    place: {
      label: "Österlen",
      lat: 55.55,
      lng: 14.35,
      region_terms: ["södra Skåne", "Simrishamn", "Tomelilla"],
      language_hints: ["sv", "en"],
    },
    timeWindow: { label: "this_weekend", starts_at: "2026-07-17", ends_at: "2026-07-19" },
    intentHints: ["loppis", "konsert", "marknad"],
    sourceCandidates: [
      source({
        id: "municipal-events",
        family: "official_municipal_calendar",
        signal_roles: ["official_live_baseline"],
        coverage_tags: ["culture", "family", "market"],
        event_kinds: ["municipal_event", "market"],
      }),
      source({
        id: "gallery-calendar",
        family: "venue_owned_calendar",
        source_label: "Gallery calendar",
        url: "https://gallery.example.test/events",
        adapter: "html_event_listing",
        extraction_tier: "stable_html_calendar",
        trust_tier: "institution",
        signal_roles: ["venue_programming"],
        coverage_tags: ["culture", "vernissage"],
        event_kinds: ["vernissage"],
        extractable: {
          title: true,
          start: true,
          end: true,
          venue: true,
          source_url: true,
          stable_html: true,
          venue_geocodable: true,
        },
      }),
    ],
  });

  assert.equal(graph.place_context.label, "Österlen");
  assert.equal(graph.coverage.status, "partial");
  assert.deepEqual(graph.coverage.covered_families.sort(), [
    "official_municipal_calendar",
    "venue_owned_calendar",
  ]);
  assert.equal(graph.coverage.can_collect_pulse_candidates, true);
  assert.equal(graph.coverage.can_evaluate_route_salience, true);
  assert.ok(graph.discovery_terms.includes("loppis"));
  assert.ok(graph.discovery_terms.includes("södra Skåne"));

  const municipal = graph.source_families.find((family) => family.family === "official_municipal_calendar");
  assert.equal(municipal.status, "covered");
  assert.deepEqual(municipal.signal_roles, ["official_live_baseline"]);
  assert.ok(municipal.event_kinds.includes("market"));

  const marketGap = graph.acquisition_plan.find((step) => step.family === "market_listing");
  assert.equal(marketGap.action, "discover_source_family");
  assert.equal(marketGap.reason, "coverage_gap");
});

test("community and social listings are discovered but never become strong runtime truth alone", () => {
  const graph = buildLocalLiveSourceGraph({
    place: { label: "Local coast", language_hints: ["sv"] },
    intentHints: ["loppis"],
    sourceCandidates: [
      source({
        id: "facebook-loppis-posts",
        family: "community_social_listing",
        source_label: "Public community listings",
        url: "https://social.example.test/group/events",
        adapter: "needs_adapter",
        extraction_tier: "weak_social_manual",
        trust_tier: "community",
        terms_status: "unknown",
        corroboration_required: true,
        coverage_tags: ["loppis", "second_hand"],
        event_kinds: ["loppis"],
        extractable: {
          title: true,
          start: true,
          source_url: true,
          social: true,
          manual_listing: true,
        },
      }),
    ],
  });

  assert.equal(graph.coverage.status, "thin");
  assert.equal(graph.coverage.can_collect_pulse_candidates, false);
  assert.equal(graph.coverage.can_evaluate_route_salience, false);
  assert.deepEqual(graph.coverage.needs_corroboration_families, ["community_social_listing"]);
  assert.equal(graph.social_coverage.status, "needs_corroboration");
  assert.ok(graph.social_coverage.reasons.includes("social_signal_not_enough_for_runtime_claims"));

  const social = graph.source_families.find((family) => family.family === "community_social_listing");
  assert.equal(social.status, "needs_corroboration");
  assert.equal(social.candidates[0].corroboration_required, true);
  assert.ok(social.reasons.includes("community_or_social_requires_corroboration"));
});

test("blocked, stale, and probe-only sources never count as covered runtime supply", () => {
  const graph = buildLocalLiveSourceGraph({
    sourceCandidates: [
      source({ id: "blocked", source_health: "blocked", runtime_policy: "blocked" }),
      source({
        id: "stale",
        family: "official_tourism_calendar",
        source_health: "stale",
        runtime_policy: "runtime_ok",
      }),
      source({
        id: "probe",
        family: "venue_owned_calendar",
        source_health: "healthy",
        runtime_policy: "probe_only",
      }),
    ],
  });

  assert.equal(graph.coverage.runtime_ready_source_count, 0);
  assert.equal(graph.coverage.can_collect_pulse_candidates, false);
  assert.equal(graph.coverage.can_evaluate_route_salience, false);
  assert.equal(
    graph.source_families.find((family) => family.family === "official_municipal_calendar").status,
    "blocked",
  );
  assert.equal(
    graph.source_families.find((family) => family.family === "official_tourism_calendar").status,
    "needs_review",
  );
  assert.equal(
    graph.source_families.find((family) => family.family === "venue_owned_calendar").status,
    "needs_review",
  );
});

test("one publisher cannot masquerade as three independent source families", () => {
  const graph = buildLocalLiveSourceGraph({
    sourceCandidates: [
      source({ id: "municipal", family: "official_municipal_calendar", url: "https://same.example/city" }),
      source({ id: "tourism", family: "official_tourism_calendar", url: "https://same.example/tourism" }),
      source({ id: "venue", family: "venue_owned_calendar", url: "https://same.example/venue" }),
    ],
  });

  assert.equal(graph.coverage.independent_runtime_source_count, 1);
  assert.equal(graph.coverage.status, "thin");
  assert.equal(graph.coverage.can_evaluate_route_salience, false);
});

test("an unrelated official source is context, not corroboration of a social event", () => {
  const graph = buildLocalLiveSourceGraph({
    sourceCandidates: [
      source({ id: "official" }),
      source({
        id: "social",
        family: "community_social_listing",
        url: "https://social.example.test/post",
        extraction_tier: "weak_social_manual",
        trust_tier: "community",
        terms_status: "unknown",
        runtime_policy: "probe_only",
        corroboration_required: true,
        extractable: { title: true, start: true, source_url: true, social: true },
      }),
    ],
  });

  assert.equal(graph.social_coverage.status, "needs_corroboration");
  assert.equal(graph.social_coverage.stronger_source_context_present, true);
  assert.ok(graph.social_coverage.reasons.includes("stronger_source_context_available_but_event_match_required"));
});

test("discovery terms use supplied local-language vocabulary instead of hardcoded regions", () => {
  const graph = buildLocalLiveSourceGraph({
    place: {
      label: "Athína",
      language_hints: ["el"],
      local_discovery_terms: ["εκδηλώσεις", "συναυλία", "αγορά"],
    },
    sourceCandidates: [
      source({
        id: "local-calendar",
        source_language: "el",
        local_discovery_terms: ["φεστιβάλ"],
      }),
    ],
  });

  assert.ok(graph.discovery_terms.includes("εκδηλώσεις"));
  assert.ok(graph.discovery_terms.includes("φεστιβάλ"));
  assert.equal(graph.discovery_terms.includes("loppis"), false);
});

test("local-language and market source candidates stay first-class acquisition targets", () => {
  const graph = buildLocalLiveSourceGraph({
    place: {
      label: "Southern region",
      region_terms: ["södra Skåne"],
      language_hints: ["sv"],
    },
    sourceCandidates: [
      source({
        id: "local-market-magazine",
        family: "trusted_local_media",
        source_label: "Local market magazine",
        url: "https://media.example.test/helgens-loppisar",
        adapter: "html_event_listing",
        extraction_tier: "stable_html_calendar",
        trust_tier: "community",
        terms_status: "permission_required",
        source_language: "sv",
        local_discovery_terms: ["loppis", "bakluckeloppis", "marknad"],
        translation_status: "not_required",
        coverage_tags: ["loppis", "market", "second_hand"],
        event_kinds: ["flea_market"],
        extractable: {
          title: true,
          start: true,
          venue: true,
          source_url: true,
          stable_html: true,
          venue_geocodable: true,
        },
      }),
    ],
  });

  const localMedia = graph.source_families.find((family) => family.family === "trusted_local_media");
  assert.equal(localMedia.status, "needs_review");
  assert.ok(localMedia.reasons.includes("local_language_source_present"));
  assert.ok(localMedia.candidates[0].local_discovery_terms.includes("bakluckeloppis"));
  assert.deepEqual(localMedia.coverage_tags, ["loppis", "market", "second_hand"]);

  const action = graph.acquisition_plan.find((step) => step.family === "trusted_local_media");
  assert.equal(action.action, "review_terms_or_build_adapter");
});

test("source graph keeps generic code free of named-region branches", () => {
  assert.equal(SOURCE_FAMILIES.market_listing.priority < SOURCE_FAMILIES.community_social_listing.priority, true);
  const source = fs.readFileSync(require.resolve("../server/pulse-sources/local-live-source-graph"), "utf8");
  assert.ok(!/österlen|skåne|simrishamn|borrby|athens|barcelona|rome/i.test(source));
});
