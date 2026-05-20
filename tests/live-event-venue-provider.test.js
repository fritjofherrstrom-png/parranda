const assert = require("node:assert/strict");
const test = require("node:test");

const barcelona = require("../server/cities/barcelona");
const rome = require("../server/cities/rome");
const {
  CandidateProviderRegistry,
  createDefaultCandidateProviderRegistry,
} = require("../server/place-candidates/provider-registry");
const {
  LiveEventVenueProvider,
  buildLiveEventVenuePlaceCandidates,
  flattenLiveEvents,
} = require("../server/place-candidates/live-event-venue-provider");
const { validatePlaceCandidate } = require("../server/place-candidates/contract");

test("LiveEventVenueProvider returns an empty list when no context events are provided", () => {
  const provider = new LiveEventVenueProvider(barcelona);

  assert.deepEqual(provider.listCandidates(), []);
  assert.deepEqual(provider.listCandidates({ context: {} }), []);
  assert.deepEqual(buildLiveEventVenuePlaceCandidates(barcelona), []);
});

test("LiveEventVenueProvider converts Barcelona Open Data BCN-shaped events", () => {
  const candidates = buildLiveEventVenuePlaceCandidates(barcelona, [
    {
      id: "barcelona-open-data-12345",
      source_id: "barcelona-open-data-agenda",
      source_label: "Open Data BCN",
      source_url: "https://opendata-ajuntament.barcelona.cat/data/dataset/agenda",
      url: "https://guia.barcelona.cat/ca/detall/12345",
      title: "Concert de barri a Barcelona",
      type: "Concerts",
      provider_category: "Concerts",
      venue: "Centre Civic Example",
      address: "C Example, 12",
      start_date: "2026-05-17",
      lat: 41.402,
      lng: 2.203,
      match_tags: ["kultur", "music", "mat"],
    },
  ]);

  assert.equal(candidates.length, 1);
  const [candidate] = candidates;
  assert.doesNotThrow(() => validatePlaceCandidate(candidate));
  assert.equal(candidate.id, "barcelona-live-event-venue-barcelona-open-data-12345");
  assert.equal(candidate.city, "barcelona");
  assert.equal(candidate.label, "Centre Civic Example");
  assert.equal(candidate.type, "Concerts");
  assert.equal(candidate.candidate_kind, "event_venue");
  assert.equal(candidate.is_structural, false);
  assert.equal(candidate.source.kind, "live_event_feed");
  assert.equal(candidate.source.id, "barcelona-open-data-agenda");
  assert.equal(candidate.source.label, "Open Data BCN");
  assert.equal(candidate.trust.source_tier, "official");
  assert.equal(candidate.trust.confidence, "medium");
  assert.equal(candidate.trust.freshness, "live");
  assert.equal(candidate.city_pack_owned, false);
  assert.equal(candidate.lat, 41.402);
  assert.equal(candidate.lng, 2.203);
  assert.deepEqual(candidate.tags, ["kultur", "music", "mat"]);
  assert.ok(candidate.route_roles.includes("live_event_venue"));
});

test("LiveEventVenueProvider converts Rome Turismo Roma-shaped events", () => {
  const provider = new LiveEventVenueProvider(rome, {
    events: {
      "2026-04-16": [
        {
          id: "en-events-teatro-india-night",
          source_label: "Turismo Roma",
          url: "https://www.turismoroma.it/en/events/teatro-india-night",
          title: "Teatro India Night",
          type: "Events",
          venue: "Teatro di Roma - Teatro India",
          address: "Lungotevere Vittorio Gassman",
          start_date: "2026-04-16",
          lat: 41.8701,
          lng: 12.4744,
          match_tags: ["kultur", "nattliv"],
        },
      ],
    },
  });

  const candidates = provider.listCandidates();

  assert.equal(candidates.length, 1);
  const [candidate] = candidates;
  assert.doesNotThrow(() => validatePlaceCandidate(candidate));
  assert.equal(candidate.city, "rome");
  assert.equal(candidate.label, "Teatro di Roma - Teatro India");
  assert.equal(candidate.source.kind, "live_event_feed");
  assert.equal(candidate.source.id, "rome-live-events");
  assert.equal(candidate.source.label, "Turismo Roma");
  assert.equal(candidate.trust.source_tier, "official");
  assert.equal(candidate.city_pack_owned, false);
  assert.equal(candidate.lat, 41.8701);
  assert.equal(candidate.lng, 12.4744);
});

test("LiveEventVenueProvider degrades honestly for missing coordinates and skips missing venue labels", () => {
  const candidates = buildLiveEventVenuePlaceCandidates(barcelona, [
    {
      id: "barcelona-open-data-no-coordinates",
      source_id: "barcelona-open-data-agenda",
      source_label: "Open Data BCN",
      title: "Concert without coordinates",
      type: "Concerts",
      venue: "Centre Civic Sense Coordenades",
      start_date: "2026-05-17",
      match_tags: ["kultur"],
    },
    {
      id: "barcelona-open-data-no-venue",
      source_id: "barcelona-open-data-agenda",
      source_label: "Open Data BCN",
      title: "Event without usable venue",
      start_date: "2026-05-17",
      match_tags: ["kultur"],
    },
  ]);

  assert.equal(candidates.length, 1);
  const [candidate] = candidates;
  assert.equal(candidate.label, "Centre Civic Sense Coordenades");
  assert.equal("lat" in candidate, false);
  assert.equal("lng" in candidate, false);
  assert.equal(candidate.trust.source_tier, "official");
  assert.equal(candidate.trust.confidence, "needs_review");
  assert.doesNotThrow(() => validatePlaceCandidate(candidate));
});

test("LiveEventVenueProvider can flatten date-keyed events and dedupe repeated event venues", () => {
  const event = {
    id: "barcelona-open-data-duplicate",
    source_id: "barcelona-open-data-agenda",
    source_label: "Open Data BCN",
    title: "Festival de barri",
    type: "Festival",
    venue: "Parc del Centre",
    lat: 41.4,
    lng: 2.2,
  };

  assert.equal(flattenLiveEvents({ "2026-05-17": [event], "2026-05-18": [event] }).length, 2);

  const candidates = buildLiveEventVenuePlaceCandidates(barcelona, {
    "2026-05-17": [event],
    "2026-05-18": [event],
  });

  assert.equal(candidates.length, 1);
  assert.equal(candidateIds(candidates)[0], "barcelona-live-event-venue-barcelona-open-data-duplicate");
});

test("LiveEventVenueProvider is available but not default-enabled in the registry", () => {
  const defaultRegistry = createDefaultCandidateProviderRegistry();
  assert.deepEqual(defaultRegistry.listProviderIds(), ["curated-catalog"]);

  const liveOnlyRegistry = new CandidateProviderRegistry([
    {
      id: "live-event-venue",
      create(cityConfig) {
        return new LiveEventVenueProvider(cityConfig);
      },
    },
  ]);

  const empty = liveOnlyRegistry.collectCandidates(barcelona, {
    context: {
      events: [],
    },
  });

  assert.equal(empty.city, "barcelona");
  assert.deepEqual(empty.candidates, []);
  assert.equal(empty.summary.total, 0);
  assert.deepEqual(empty.summary.by_provider["live-event-venue"].by_candidate_kind, {});
});

function candidateIds(candidates) {
  return candidates.map((candidate) => candidate.id);
}
