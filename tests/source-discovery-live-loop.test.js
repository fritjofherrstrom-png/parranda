"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  collectAnchorEvents,
  resolveDefaultEventSupply,
} = require("../server/place-candidates/agnostic-event-supply");
const {
  discoverLocalEventSourcesForPlace,
} = require("../server/pulse-sources/place-event-source-scout");
const {
  eventFeedsFromQualifiedSourceProfiles,
  qualifyDiscoveredSourceProfile,
} = require("../server/pulse-sources/source-qualification");
const {
  runScoutWorkerBatch,
} = require("../scripts/run-source-scout-worker");

const FIXTURES = [
  {
    place: "Umeå",
    countryCode: "se",
    language: "sv",
    discoveryTerm: "evenemang",
    title: "Kvällsmarknad vid hamnen",
    expectedAdapter: "ical",
    expectedAccepted: 1,
    expectedSurfaced: 1,
    anchor: { lat: 63.8258, lng: 20.263 },
    timezone: "Europe/Stockholm",
  },
  {
    place: "Clermont-Ferrand",
    countryCode: "fr",
    language: "fr",
    discoveryTerm: "événements",
    title: "Concert au jardin civique",
    expectedAdapter: "official_program_article",
    expectedAccepted: 3,
    expectedSurfaced: 3,
    anchor: { lat: 45.7772, lng: 3.087 },
    timezone: "Europe/Paris",
  },
  {
    place: "Coimbra",
    countryCode: "pt",
    language: "pt",
    discoveryTerm: "eventos",
    title: "Mercado noturno no parque",
    expectedAdapter: "ical",
    expectedAccepted: 1,
    expectedSurfaced: 1,
    anchor: { lat: 40.2033, lng: -8.4103 },
    timezone: "Europe/Lisbon",
  },
];

function loaded(records = []) {
  const rows = [...records];
  rows.loader_status = `loaded:${rows.length}`;
  return rows;
}

function response(body, { url, contentType = "text/html", status = 200 } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    url,
    headers: {
      get(name) {
        if (String(name).toLowerCase() === "content-type") return contentType;
        return null;
      },
    },
    text: async () => body,
  };
}

function sourcePage(fixture) {
  if (fixture.expectedAdapter === "official_program_article") {
    return [
      `<html lang="${fixture.language}"><head>`,
      '<link rel="license" href="https://creativecommons.org/licenses/by/4.0/">',
      "</head><body>",
      "<h1>Programme local 2026</h1>",
      "<h2>PROGRAMME JARDIN CIVIQUE</h2>",
      `<p>2 août (18.00): ${fixture.title}</p>`,
      "<p>2 août (19.30): Atelier ouvert</p>",
      "<p>3 août (11.00): Marché local</p>",
      "<h2>Informations pratiques</h2>",
      "</body></html>",
    ].join("");
  }
  return [
    `<html lang="${fixture.language}"><head>`,
    '<link rel="license" href="https://creativecommons.org/licenses/by/4.0/">',
    '<link rel="alternate" type="text/calendar" href="/events.ics">',
    "</head><body><h1>Local calendar</h1></body></html>",
  ].join("");
}

function icalFeed(fixture) {
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "BEGIN:VEVENT",
    `UID:${fixture.language}-local-event`,
    `SUMMARY:${fixture.title}`,
    "DTSTART:20260802T180000Z",
    "DTEND:20260802T210000Z",
    `LOCATION:${fixture.place} central square`,
    `GEO:${fixture.anchor.lat + 0.001};${fixture.anchor.lng + 0.001}`,
    `URL:https://${fixture.language}.calendar.example/events/local-evening`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
}

function fixtureFetcher(fixture) {
  return async (input) => {
    const url = String(input);
    if (url.endsWith("/robots.txt")) {
      return response("User-agent: *\nAllow: /", { url, contentType: "text/plain" });
    }
    if (url.includes("events.ics")) {
      return response(icalFeed(fixture), { url, contentType: "text/calendar" });
    }
    if (url.includes("calendar.example/program")) {
      return response(sourcePage(fixture), { url, contentType: "text/html" });
    }
    return response("", { url, status: 404 });
  };
}

function createMemoryCatalog(fixture) {
  let target = null;
  let claimable = false;
  let attemptCount = 0;
  let profile = null;
  const completionSchedule = [];

  return {
    async listApprovedEventFeedsForAnchor() {
      return [];
    },
    async listQualifiedEventFeedsForAnchor({ now } = {}) {
      return eventFeedsFromQualifiedSourceProfiles(profile ? [profile] : [], { now });
    },
    async recordScoutDemand({ anchor, placeLabel, placeContext, spatialScope }) {
      target = {
        target_key: `source-scout-target-v1:${fixture.language}`,
        lease_token: `lease-${fixture.language}`,
        place_label: placeLabel,
        anchor: { ...anchor },
        place_context: { ...placeContext },
        spatial_scope: structuredClone(spatialScope),
        attempt_count: attemptCount,
      };
      claimable = true;
      return { status: "recorded", target_key: target.target_key, target_status: "pending" };
    },
    async claimScoutTarget() {
      if (!claimable || !target) return null;
      claimable = false;
      attemptCount += 1;
      return { ...target, attempt_count: attemptCount, lease_token: `lease-${attemptCount}` };
    },
    async recordDiscovery(value) {
      profile = structuredClone(value);
      return { status: "recorded", profile_key: profile.profile_key, catalog_status: "review_needed" };
    },
    async loadSourceQualification() {
      return profile?.source_qualification || null;
    },
    async completeScoutTarget(_target, _reason, options) {
      completionSchedule.push(options?.nextAttemptAt || null);
      return { status: "completed" };
    },
    async failScoutTarget() {
      return { status: "retry_wait" };
    },
    prepareNextProbe() {
      claimable = true;
    },
    snapshot() {
      return { profile: structuredClone(profile), completionSchedule: [...completionSchedule] };
    },
  };
}

function createMemoryEventCache() {
  const values = new Map();
  let warmPromise = null;
  return {
    peek(key) {
      return values.get(key) || null;
    },
    warm(key, producer, { shouldStore = () => true } = {}) {
      warmPromise = Promise.resolve().then(producer).then((value) => {
        if (shouldStore(value)) values.set(key, value);
        return value;
      });
      return warmPromise;
    },
    async waitForWarm() {
      await warmPromise;
    },
  };
}

async function runColdLoop(fixture) {
  const catalog = createMemoryCatalog(fixture);
  const eventCache = createMemoryEventCache();
  const sourceUrl = `https://${fixture.language}.calendar.example/program`;
  const fetcher = fixtureFetcher(fixture);
  let currentNow = new Date("2026-08-01T10:00:00Z");
  const searchedQueries = [];
  const runtime = {
    now: () => new Date(currentNow),
    openDataLoader: async () => loaded([]),
    sourceSearch: async ({ queries }) => {
      searchedQueries.push(...queries);
      return {
        status: "complete",
        reasons: ["bounded_source_search_complete"],
        queried_count: queries.length,
        responding_query_count: queries.length,
        result_count: 1,
        seed_count: 1,
        seeds: [{ url: sourceUrl, discovered_from: queries[0] }],
      };
    },
    scoutOptions: { fetcher },
    sourceQualifier: qualifyDiscoveredSourceProfile,
    fetcher,
    timezoneResolver: async () => ({
      timezone: fixture.timezone,
      timezone_source: "weather_provider_auto",
    }),
    placeResolver: async () => fixture.expectedAdapter === "official_program_article"
      ? [{
          lat: fixture.anchor.lat + 0.001,
          lng: fixture.anchor.lng + 0.001,
          confidence: "medium",
          provenance: "nominatim_osm",
          attribution: "OpenStreetMap contributors",
          license: "ODbL",
        }]
      : [],
  };
  const env = {
    PARRANDA_AGNOSTIC_EVENTS: "enabled",
    PARRANDA_QUALIFIED_SOURCE_RUNTIME: "enabled",
  };
  const supply = resolveDefaultEventSupply(env, {
    sourceCatalog: catalog,
    eventCache,
    collectEvents: (input) => collectAnchorEvents({ ...input, fetcher }),
  });
  const request = {
    anchor: fixture.anchor,
    placeLabel: fixture.place,
    placeContext: {
      locality: fixture.place,
      country: `Country ${fixture.countryCode.toUpperCase()}`,
      country_code: fixture.countryCode,
    },
    spatialScope: {
      source: "resolver_bounds",
      kind: "region",
      bounds: {
        west: fixture.anchor.lng - 0.2,
        south: fixture.anchor.lat - 0.2,
        east: fixture.anchor.lng + 0.2,
        north: fixture.anchor.lat + 0.2,
      },
    },
    now: currentNow,
    preferences: ["second_hand"],
  };
  assert.equal("source_url" in request, false, "the user request carries no source URL");
  assert.equal("domain" in request, false, "the user request carries no source domain");

  const cold = await supply(request);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(cold.coverage, "uncovered");

  const first = await runScoutWorkerBatch({ catalog, runtime, limit: 1 });
  assert.equal(first.results[0].qualification_status, "observing");
  catalog.prepareNextProbe();
  currentNow = new Date("2026-08-02T16:00:00Z");
  request.now = currentNow;
  const second = await runScoutWorkerBatch({ catalog, runtime, limit: 1 });
  assert.equal(second.results[0].qualification_status, "qualified_for_review");

  const snapshot = catalog.snapshot();
  const qualifiedFeeds = await catalog.listQualifiedEventFeedsForAnchor({ now: currentNow });
  assert.equal(qualifiedFeeds.length, 1);
  assert.equal(qualifiedFeeds[0].runtime_trust, "qualified_probationary");
  assert.equal(qualifiedFeeds[0].pulse_only, true);
  assert.equal(qualifiedFeeds[0].license, "https://creativecommons.org/licenses/by/4.0/");

  const warming = await supply(request);
  assert.equal(warming.pending, true);
  await eventCache.waitForWarm();
  const live = await supply(request);
  const candidate = snapshot.profile.source_families
    .flatMap((family) => family.candidates || [])[0];
  const observation = snapshot.profile.source_qualification.candidates[0].observations[0];
  const shown = live.tonight.find((row) => row.title === fixture.title);
  return {
    cold,
    first,
    second,
    snapshot,
    qualifiedFeeds,
    live,
    searchedQueries,
    sourceUrl,
    stages: {
      discovered: Boolean(candidate),
      parsed: observation?.normalized_event_count > 0,
      qualified: snapshot.profile.source_qualification.status === "qualified_for_review",
      runtime_eligible: qualifiedFeeds.length > 0,
      collected: live.acquisition?.source_health?.accepted_event_count > 0,
      salient: Number(shown?.salience_score) >= 7,
      shown_in_live: Boolean(shown),
      route_eligible: shown?.route_eligible === true,
    },
  };
}

test("cold source discovery reaches low-trust Live across unrelated places and languages", async () => {
  for (const fixture of FIXTURES) {
    const result = await runColdLoop(fixture);
    const candidate = result.snapshot.profile.source_families
      .flatMap((family) => family.candidates || [])[0];
    const qualification = result.snapshot.profile.source_qualification;
    const event = result.live.tonight.find((row) => row.title === fixture.title);

    assert.ok(result.searchedQueries.includes(`${fixture.place} ${fixture.discoveryTerm}`));
    assert.equal(
      candidate.url,
      fixture.expectedAdapter === "ical"
        ? new URL("/events.ics", result.sourceUrl).toString()
        : result.sourceUrl,
    );
    assert.equal(candidate.adapter, fixture.expectedAdapter);
    assert.equal(candidate.terms_status, "open_license");
    assert.equal(qualification.status, "qualified_for_review");
    assert.equal(qualification.candidates[0].healthy_probe_count, 2);
    assert.equal(qualification.candidates[0].event_bearing_probe_count, 2);
    assert.ok(
      event,
      `${fixture.place} should surface the collected occurrence: ${JSON.stringify(result.live)}`,
    );
    assert.equal(event.route_eligible, false);
    assert.equal(event.license, "https://creativecommons.org/licenses/by/4.0/");
    assert.ok(event.salience_score >= 7);
    assert.equal(result.live.acquisition.source_health.accepted_event_count, fixture.expectedAccepted);
    assert.equal(result.live.acquisition.source_health.surfaced_event_count, fixture.expectedSurfaced);
    assert.deepEqual(result.stages, {
      discovered: true,
      parsed: true,
      qualified: true,
      runtime_eligible: true,
      collected: true,
      salient: true,
      shown_in_live: true,
      route_eligible: false,
    });
  }
});

test("cold source discovery refuses an incidental-date news page", async () => {
  const result = await discoverLocalEventSourcesForPlace({
    placeQuery: "Plainville",
    placeResolver: async () => [{
      label: "Plainville, Testland",
      lat: 50,
      lng: 10,
      confidence: "medium",
      provenance: "fixture_resolver",
      admin_context: { locality: "Plainville", country_code: "de" },
    }],
    openDataLoader: async () => loaded([]),
    sourceSearch: async () => ({
      status: "complete",
      queried_count: 1,
      responding_query_count: 1,
      result_count: 1,
      seed_count: 1,
      seeds: [{ url: "https://plainville.example/news/road-project" }],
    }),
    scoutOptions: {
      fetcher: async (input) => {
        const url = String(input);
        if (url.endsWith("/robots.txt")) {
          return response("User-agent: *\nAllow: /", { url, contentType: "text/plain" });
        }
        return response(
          "<h1>Road project update 2026</h1><p>The council met on 12 June at 18:00. Work continues.</p>",
          { url },
        );
      },
    },
  });

  assert.equal(result.status, "complete");
  assert.equal(result.source_results[0].status, "inspected");
  assert.deepEqual(result.source_results[0].detected, []);
  assert.equal(result.manifest_candidates.length, 0);
  assert.equal(result.activation_performed, false);
});
