const assert = require("node:assert/strict");
const test = require("node:test");

const barcelona = require("../server/cities/barcelona");
const { buildCityPulse } = require("../server/pulse-engine");
const { collectPulseSourcesForCity } = require("../server/pulse-sources");
const {
  createOpenDataBcnAgendaProvider,
  openDataBcnAgendaDescriptor,
} = require("../server/cities/barcelona/open-data-source-provider");

function buildOpenDataEvent(overrides = {}) {
  return {
    id: "barcelona-open-data-12345",
    source_id: "barcelona-open-data-agenda",
    source_label: "Open Data BCN",
    source_url: "https://opendata-ajuntament.barcelona.cat/data/en/dataset/agenda-diaria",
    url: "https://guia.barcelona.cat/ca/detall/12345",
    source_language: "ca",
    title: "Concert de barri a Barcelona",
    start_date: "2027-06-14",
    end_date: "2027-06-14",
    provider_category: "Concerts",
    venue: "Centre Cívic Example",
    address: "C Example, 12",
    summary: "Concert gratuït amb activitats de barri.",
    raw_summary: "Concert gratuït amb activitats de barri.",
    lat: 41.402,
    lng: 2.203,
    geocode_label: "Centre Cívic Example",
    geocode_source: "provider",
    match_tags: ["music", "kultur"],
    ...overrides,
  };
}

test("Open Data BCN provider exposes a normalized official source descriptor", () => {
  assert.equal(openDataBcnAgendaDescriptor.id, "barcelona-open-data-agenda");
  assert.equal(openDataBcnAgendaDescriptor.label, "Open Data BCN");
  assert.equal(openDataBcnAgendaDescriptor.city, "barcelona");
  assert.equal(openDataBcnAgendaDescriptor.role, "official_live_baseline");
  assert.equal(openDataBcnAgendaDescriptor.trust.source_tier, "official");
  assert.equal(openDataBcnAgendaDescriptor.cachePolicy.kind, "memory");
});

test("Barcelona Open Data BCN provider collects normalized events through the source registry", async () => {
  const providerSpec = createOpenDataBcnAgendaProvider();
  const result = await collectPulseSourcesForCity(barcelona, {
    providerSpecs: [providerSpec],
    context: {
      dates: ["2027-06-14"],
      collectOpenDataAgendaEventsForDates: async () => ({
        "2027-06-14": [buildOpenDataEvent()],
      }),
    },
  });

  assert.equal(result.city, "barcelona");
  assert.equal(result.source_status.length, 1);
  assert.equal(result.source_status[0].status, "ok");
  assert.equal(result.source_status[0].events, 1);
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].source.id, "barcelona-open-data-agenda");
  assert.equal(result.events[0].source.label, "Open Data BCN");
  assert.equal(result.events[0].source.trust.source_tier, "official");
  assert.equal(result.events[0].source_owned.title, "Concert de barri a Barcelona");
  assert.equal(result.events[0].source_owned.lat, 41.402);
  assert.equal(result.events[0].source_owned.lng, 2.203);
  assert.deepEqual(result.events[0].parranda_owned.tags_intents, ["music", "kultur"]);
  assert.equal(result.events[0].display_gate.may_show_in_pulse, true);
  assert.equal(result.events[0].display_gate.may_show_as_nearby, true);
  assert.equal(result.events[0].display_gate.may_create_place_candidate, true);
});

test("Open Data BCN provider failure returns empty events and failed source_status", async () => {
  const providerSpec = createOpenDataBcnAgendaProvider();
  const result = await collectPulseSourcesForCity(barcelona, {
    providerSpecs: [providerSpec],
    context: {
      dates: ["2027-06-14"],
      collectOpenDataAgendaEventsForDates: async () => {
        throw new Error("provider down");
      },
    },
  });

  assert.deepEqual(result.events, []);
  assert.equal(result.source_status.length, 1);
  assert.equal(result.source_status[0].id, "barcelona-open-data-agenda");
  assert.equal(result.source_status[0].status, "failed");
  assert.equal(result.source_status[0].reason, "provider_failed");
  assert.equal(result.source_status[0].events, 0);
});

test("Open Data BCN source-url-only events do not become nearby or place candidates", async () => {
  const providerSpec = createOpenDataBcnAgendaProvider();
  const result = await collectPulseSourcesForCity(barcelona, {
    providerSpecs: [providerSpec],
    context: {
      dates: ["2027-06-14"],
      collectOpenDataAgendaEventsForDates: async () => ({
        "2027-06-14": [
          buildOpenDataEvent({
            venue: "",
            address: "",
            lat: null,
            lng: null,
            geocode_label: "",
            geocode_source: null,
          }),
        ],
      }),
    },
  });

  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].display_gate.may_show_in_pulse, true);
  assert.equal(result.events[0].display_gate.may_show_as_nearby, false);
  assert.equal(result.events[0].display_gate.may_create_place_candidate, false);
  assert.equal(result.events[0].display_gate.may_influence_routes, false);
});

test("buildCityPulse uses Barcelona source registry events without a city-specific Pulse branch", async () => {
  const city = {
    ...barcelona,
    services: {
      ...barcelona.services,
      fetchWeatherForDates: async () => ({}),
      pulseSourceProviders: [createOpenDataBcnAgendaProvider()],
    },
  };

  const result = await buildCityPulse(city, {
    date: "2027-06-14",
    lang: "en",
    now: new Date("2027-06-14T12:00:00Z"),
    collectOpenDataAgendaEventsForDates: async () => ({
      "2027-06-14": [buildOpenDataEvent()],
    }),
  });

  assert.equal(result.city, "barcelona");
  assert.equal(result.source_status[0].id, "barcelona-open-data-agenda");
  assert.equal(result.source_status[0].status, "ok");
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].source_id, "barcelona-open-data-agenda");
  assert.equal(result.events[0].display_gate.may_show_as_nearby, true);
  assert.ok(result.signals.some((signal) => signal.official_event_id === "barcelona-open-data-12345"));
});
