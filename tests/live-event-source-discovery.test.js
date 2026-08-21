const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");

const {
  EXTRACTION_TIERS,
  SOURCE_FAMILIES,
  evaluateLiveEventSourceCandidate,
  mapsToExistingProvider,
  normalizeSourceCandidate,
} = require("../server/pulse-sources/source-discovery");

function candidate(overrides = {}) {
  return {
    id: "official-calendar",
    place: "Example City",
    family: "official_municipal_calendar",
    source_label: "Example City Events",
    url: "https://events.example.test/api",
    adapter: "the_events_calendar",
    extraction_tier: "official_api_open_data",
    trust_tier: "official",
    terms_status: "api_terms_compatible",
    extractable: {
      title: true,
      start: true,
      end: true,
      venue: true,
      source_url: true,
      geo: true,
      recurrence: true,
    },
    ...overrides,
  };
}

test("official source with extractable timing and venue is viable for a provider probe", () => {
  const result = evaluateLiveEventSourceCandidate(candidate());

  assert.equal(result.status, "viable_provider_probe");
  assert.equal(result.family, "official_municipal_calendar");
  assert.equal(result.priority, SOURCE_FAMILIES.official_municipal_calendar.priority);
  assert.equal(result.extraction_tier, "official_api_open_data");
  assert.equal(result.extraction_tier_label, EXTRACTION_TIERS.official_api_open_data.label);
  assert.ok(result.score >= 10);
  assert.ok(result.reasons.includes("has_provider_geo"));
  assert.ok(result.reasons.includes("has_end_time"));
  assert.deepEqual(result.blockers, []);
});

test("schema.org/Event discovery maps to the existing generic provider family", () => {
  const result = evaluateLiveEventSourceCandidate(
    candidate({
      id: "schema-listing",
      family: "schema_org_event",
      adapter: "",
      extraction_tier: "",
      extractable: {
        schema_org_event: true,
        title: true,
        start: true,
        venue: true,
        source_url: true,
        venue_geocodable: true,
      },
      terms_status: "open_license",
    }),
  );

  assert.equal(result.adapter, "schema_org_event");
  assert.equal(result.extraction_tier, "schema_org_json_ld");
  assert.equal(result.maps_to_existing_provider, true);
  assert.equal(mapsToExistingProvider(result.adapter), true);
});

test("official program articles map to a known stable-html adapter without becoming approved", () => {
  const result = evaluateLiveEventSourceCandidate({
    id: "official-program",
    family: "official_municipal_calendar",
    source_label: "Municipal summer program",
    url: "https://city.example/news/program",
    adapter: "official_program_article",
    extraction_tier: "stable_html_calendar",
    trust_tier: "official",
    terms_status: "unknown",
    source_health: "healthy",
    runtime_policy: "review_needed",
    extractable: {
      title: true,
      start: true,
      end: true,
      venue: true,
      venue_geocodable: true,
      source_url: true,
      stable_html: true,
    },
  });

  assert.equal(result.maps_to_existing_provider, true);
  assert.equal(result.status, "needs_adapter_or_permission");
  assert.ok(result.reasons.includes("terms_need_review"));
  assert.ok(result.reasons.includes("runtime_policy_review_needed"));
});

test("stable HTML scraping is a valid tier when constrained by terms and source atoms", () => {
  const result = evaluateLiveEventSourceCandidate(
    candidate({
      id: "venue-html-calendar",
      family: "cultural_institution_calendar",
      adapter: "html_event_listing",
      extraction_tier: "stable_html_calendar",
      terms_status: "api_terms_compatible",
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
  );

  assert.equal(result.status, "viable_provider_probe");
  assert.equal(result.extraction_tier, "stable_html_calendar");
  assert.ok(!result.reasons.includes("probe_only_stable_html_calendar"));
});

test("reviewed Sitevision calendars map to the bounded generic provider", () => {
  const result = evaluateLiveEventSourceCandidate(
    candidate({
      adapter: "sitevision_calendar",
      extraction_tier: "stable_html_calendar",
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
  );

  assert.equal(result.maps_to_existing_provider, true);
  assert.equal(result.extraction_tier, "stable_html_calendar");
});

test("local-language sources are first-class and preserve translation metadata", () => {
  const result = evaluateLiveEventSourceCandidate(
    candidate({
      id: "local-language-calendar",
      source_language: "el",
      event_language: "el",
      local_discovery_terms: ["εκδηλώσεις", "φεστιβάλ Αθήνα"],
      translation_status: "provided",
      translation_confidence: "medium",
      translated_atoms: ["title", "category"],
      extractable: {
        title: true,
        start: true,
        source_url: true,
        venue: true,
        stable_html: true,
        venue_geocodable: true,
      },
    }),
  );

  assert.equal(result.status, "viable_provider_probe");
  assert.equal(result.source_language, "el");
  assert.equal(result.event_language, "el");
  assert.deepEqual(result.local_discovery_terms, ["εκδηλώσεις", "φεστιβάλ Αθήνα"]);
  assert.equal(result.translation_status, "provided");
  assert.equal(result.translation_confidence, "medium");
  assert.deepEqual(result.translated_atoms, ["title", "category"]);
  assert.ok(result.reasons.includes("local_language_source"));
  assert.ok(result.reasons.includes("has_local_discovery_terms"));
  assert.ok(result.reasons.includes("translation_available"));
});

test("JS-rendered scraping and weak listings stay probe-only until reviewed", () => {
  const jsRendered = evaluateLiveEventSourceCandidate(
    candidate({
      id: "js-calendar",
      extraction_tier: "js_rendered_browser",
      extractable: {
        title: true,
        start: true,
        source_url: true,
        js_rendered: true,
        venue_geocodable: true,
      },
    }),
  );
  const weakSocial = evaluateLiveEventSourceCandidate(
    candidate({
      id: "social-listing",
      extraction_tier: "weak_social_manual",
      extractable: {
        title: true,
        start: true,
        source_url: true,
        social: true,
      },
    }),
  );

  assert.equal(jsRendered.status, "needs_adapter_or_permission");
  assert.ok(jsRendered.reasons.includes("probe_only_js_rendered_browser"));
  assert.equal(weakSocial.status, "needs_adapter_or_permission");
  assert.ok(weakSocial.reasons.includes("probe_only_weak_social_manual"));
});

test("permission-required source is not treated as runtime-ready", () => {
  const result = evaluateLiveEventSourceCandidate(
    candidate({
      id: "destination-calendar",
      family: "official_tourism_calendar",
      adapter: "html_event_listing",
      terms_status: "permission_required",
      extractable: {
        title: true,
        start: true,
        end: true,
        venue: true,
        source_url: true,
        venue_geocodable: true,
      },
    }),
  );

  assert.equal(result.status, "needs_adapter_or_permission");
  assert.ok(result.reasons.includes("permission_required_before_runtime"));
  assert.equal(result.maps_to_existing_provider, false);
});

test("restricted or incomplete sources are rejected with explicit blockers", () => {
  const restricted = evaluateLiveEventSourceCandidate(
    candidate({
      terms_status: "restricted",
    }),
  );
  const incomplete = evaluateLiveEventSourceCandidate(
    candidate({
      url: "",
      discovery_method: "",
      extractable: {
        title: true,
        start: false,
        source_url: false,
      },
    }),
  );

  assert.equal(restricted.status, "rejected");
  assert.ok(restricted.blockers.includes("terms_restricted"));
  assert.equal(incomplete.status, "rejected");
  assert.ok(incomplete.blockers.includes("missing_source_locator"));
  assert.ok(incomplete.blockers.includes("missing_start_time"));
  assert.ok(incomplete.blockers.includes("missing_source_url"));
});

test("unknown source families stay low-priority instead of becoming official tourism", () => {
  const normalized = normalizeSourceCandidate(
    candidate({
      place: "Any Place",
      family: "made_up_family",
      trust_tier: "made_up",
      terms_status: "made_up",
    }),
  );

  assert.equal(normalized.place, "Any Place");
  assert.equal(normalized.raw_family, "made_up_family");
  assert.equal(normalized.family, "unknown_source_family");
  assert.equal(normalized.family_known, false);
  assert.equal(SOURCE_FAMILIES[normalized.family].priority, 99);
  assert.equal(normalized.trust_tier, "unknown");
  assert.equal(normalized.terms_status, "unknown");

  const source = fs.readFileSync(require.resolve("../server/pulse-sources/source-discovery"), "utf8");
  assert.ok(!/athens|rome|barcelona|bologna|malm[oö]/i.test(source));
});
