const assert = require("node:assert/strict");
const test = require("node:test");

const {
  createLinkedEventsProvider,
  resolveDefaultLinkedEventsProvider,
  extractLinkedEvents,
  mapLinkedEventToRaw,
  buildEventsUrl,
} = require("../server/pulse-sources/linked-events-source-provider");
const { collectPulseSourcesForCity } = require("../server/pulse-sources/provider-registry");

const city = { key: "linkedville", label: "Linkedville" };
const NOW = new Date("2026-08-05T10:00:00.000Z");

// Shaped like a real Linked Events record (api.hel.fi/linkedevents/v1).
function event(overrides = {}) {
  return {
    id: "helsinki:agpnap7syu",
    name: { fi: "Jumppa ja kävelyretki", en: "Gym and walk" },
    start_time: "2026-08-05T09:00:00Z",
    end_time: "2026-08-05T12:00:00Z",
    event_status: "EventScheduled",
    data_source: "helsinki",
    publisher: "ahjo:u321200",
    info_url: { en: "https://hel.fi/event/1" },
    location: {
      name: { fi: "Keskuspuisto", en: "Central Park" },
      position: { type: "Point", coordinates: [24.924204, 60.181667] },
    },
    keywords: [{ name: { en: "outdoors" } }, { name: { en: "sports" } }],
    ...overrides,
  };
}

function jsonResponse(body) {
  return { ok: true, json: async () => body };
}

function provider(overrides = {}) {
  return createLinkedEventsProvider({
    endpoint: "https://api.hel.fi/linkedevents/v1/event/",
    label: "Helsinki Linked Events",
    sourceUrl: "https://api.hel.fi/linkedevents/v1/",
    ...overrides,
  });
}

// --- pure mapping ----------------------------------------------------------

test("maps a Linked Events record (GeoJSON [lng,lat]) to the raw shape", () => {
  const raw = mapLinkedEventToRaw(event());
  assert.equal(raw.id, "helsinki:agpnap7syu");
  assert.equal(raw.title, "Gym and walk"); // en preferred over fi
  assert.equal(raw.starts_at, "2026-08-05T09:00:00Z");
  assert.equal(raw.ends_at, "2026-08-05T12:00:00Z");
  assert.equal(raw.lat, 60.181667); // coordinates[1]
  assert.equal(raw.lng, 24.924204); // coordinates[0]
  assert.equal(raw.source_url, "https://hel.fi/event/1");
  assert.equal(raw.place_context, "Central Park");
  assert.deepEqual(raw.tags, ["outdoors", "sports"]);
  assert.deepEqual(raw.provenance, {
    source_url: "https://hel.fi/event/1",
    source_label: "helsinki",
    attribution: "helsinki / ahjo:u321200",
    license: "CC-BY 4.0",
  });
});

test("prefers en→sv→fi for localized name, falls back to any present language", () => {
  assert.equal(mapLinkedEventToRaw(event({ name: { fi: "Vain suomeksi" } })).title, "Vain suomeksi");
  assert.equal(mapLinkedEventToRaw(event({ name: { sv: "På svenska", fi: "x" } })).title, "På svenska");
});

test("missing/!point location maps to no coordinates (normalizer decides)", () => {
  assert.equal(mapLinkedEventToRaw(event({ location: { name: { en: "TBA" } } })).lat, undefined);
  assert.equal(mapLinkedEventToRaw(event({ location: null })).lng, undefined);
});

test("a cancelled or postponed event is flagged stale, never trusted live", () => {
  assert.equal(mapLinkedEventToRaw(event({ event_status: "EventCancelled" })).freshness, "stale");
  assert.equal(mapLinkedEventToRaw(event({ event_status: "EventPostponed" })).freshness, "stale");
  assert.equal(mapLinkedEventToRaw(event({ event_status: "EventScheduled" })).freshness, undefined);
});

// --- envelope + URL --------------------------------------------------------

test("extracts events from { data: [...] }, bare array, and single object", () => {
  assert.equal(extractLinkedEvents({ meta: {}, data: [event(), event()] }).length, 2);
  assert.equal(extractLinkedEvents([event()]).length, 1);
  assert.equal(extractLinkedEvents(event()).length, 1);
  assert.equal(extractLinkedEvents(null).length, 0);
});

test("buildEventsUrl forces include=location + a window + result cap, keeps caller params", () => {
  const url = buildEventsUrl("https://api.hel.fi/linkedevents/v1/event/?text=jazz", { limit: 25, date: "2026-08-05" });
  assert.match(url, /include=location/);
  assert.match(url, /page_size=25/);
  assert.match(url, /start=2026-08-05/);
  assert.match(url, /text=jazz/); // caller param preserved
});

// --- end-to-end through the #280 registry bridge ---------------------------

test("a configured provider yields a normalized, geocoded, source-backed event", async () => {
  const result = await collectPulseSourcesForCity(city, {
    providerSpecs: [provider({ fetcher: async () => jsonResponse({ meta: {}, data: [event()] }) })],
    context: { now: NOW },
  });
  assert.equal(result.events.length, 0, "not legacy live events");
  assert.equal(result.time_sensitive_events.length, 1);
  const e = result.time_sensitive_events[0];
  assert.equal(e.candidate_kind, "source_event");
  assert.equal(e.timing_relevance, "now"); // 09:00–12:00Z spans a 10:00Z now
  assert.equal(e.lat, 60.181667);
  assert.equal(e.lng, 24.924204);
  assert.equal(e.source_url, "https://hel.fi/event/1");
  assert.equal(e.source_label, "Helsinki Linked Events");
  assert.ok(!(e.timing_reasons || []).includes("missing_source_backing"));
});

test("an expired event is downgraded to stale, never trusted as happening now", async () => {
  const result = await collectPulseSourcesForCity(city, {
    providerSpecs: [
      provider({
        fetcher: async () =>
          jsonResponse({ data: [event({ start_time: "2020-01-01T09:00:00Z", end_time: "2020-01-01T12:00:00Z" })] }),
      }),
    ],
    context: { now: NOW },
  });
  assert.equal(result.time_sensitive_events[0].timing_relevance, "stale");
  assert.ok(["low", "needs_review"].includes(result.time_sensitive_events[0].confidence));
});

// --- fail-soft + env gating ------------------------------------------------

test("no endpoint, non-200, thrown error, and malformed payload all fail soft", async () => {
  const noEndpoint = createLinkedEventsProvider({ sourceUrl: "https://api.hel.fi/linkedevents/v1/", fetcher: async () => jsonResponse({ data: [event()] }) });
  assert.deepEqual((await collectPulseSourcesForCity(city, { providerSpecs: [noEndpoint], context: { now: NOW } })).time_sensitive_events, []);

  assert.deepEqual(
    (await collectPulseSourcesForCity(city, { providerSpecs: [provider({ fetcher: async () => ({ ok: false, status: 500 }) })], context: { now: NOW } })).time_sensitive_events,
    [],
  );

  const thrown = await collectPulseSourcesForCity(city, {
    providerSpecs: [provider({ fetcher: async () => { throw new Error("boom"); } })],
    context: { now: NOW },
  });
  assert.deepEqual(thrown.time_sensitive_events, []);
  assert.equal(thrown.source_status[0].status, "ok", "fail-soft inside collect, not a provider failure");

  assert.deepEqual(
    (await collectPulseSourcesForCity(city, { providerSpecs: [provider({ fetcher: async () => ({ ok: true, json: async () => { throw new Error("bad json"); } }) })], context: { now: NOW } })).time_sensitive_events,
    [],
  );
});

test("resolveDefaultLinkedEventsProvider is null without an endpoint env and a provider with one", () => {
  assert.equal(resolveDefaultLinkedEventsProvider({}), null);
  const built = resolveDefaultLinkedEventsProvider({
    PARRANDA_LINKED_EVENTS_SOURCE: "https://api.hel.fi/linkedevents/v1/event/",
    PARRANDA_LINKED_EVENTS_LABEL: "Helsinki Linked Events",
  });
  assert.ok(built && built.descriptor);
  assert.equal(built.descriptor.label, "Helsinki Linked Events");
  assert.equal(built.descriptor.license_label, "CC-BY 4.0");
  assert.equal(built.descriptor.status, "active");
});
