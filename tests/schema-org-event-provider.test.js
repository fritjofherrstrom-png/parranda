const assert = require("node:assert/strict");
const test = require("node:test");

const {
  createSchemaOrgEventProvider,
  resolveDefaultSchemaOrgEventProvider,
  extractSchemaOrgEvents,
  extractSchemaOrgEventsFromHtml,
  mapSchemaOrgEventToRaw,
} = require("../server/pulse-sources/schema-org-event-provider");
const { collectPulseSourcesForCity } = require("../server/pulse-sources/provider-registry");

const city = { key: "schemaville", label: "Schemaville" };
const NOW = new Date("2026-07-10T19:00:00.000Z");

function event(overrides = {}) {
  return {
    "@type": "Event",
    "@id": "https://feed.test/event/1",
    name: "Night market by the river",
    startDate: "2026-07-10T18:00:00+02:00",
    endDate: "2026-07-10T23:00:00+02:00",
    url: "https://feed.test/event/1",
    location: { name: "Riverside Square", geo: { latitude: 55.6, longitude: 13.0 } },
    ...overrides,
  };
}

function jsonResponse(body) {
  return { ok: true, json: async () => body };
}

function htmlResponse(body) {
  return { ok: true, text: async () => body };
}

function provider(overrides = {}) {
  return createSchemaOrgEventProvider({
    endpoint: "https://feed.test/events.jsonld",
    label: "Test City Calendar",
    sourceUrl: "https://feed.test/",
    license: "CC-BY 4.0",
    ...overrides,
  });
}

// --- pure mapping ----------------------------------------------------------

test("maps a schema.org/Event to the raw time-sensitive shape", () => {
  const raw = mapSchemaOrgEventToRaw(event());
  assert.equal(raw.id, "https://feed.test/event/1");
  assert.equal(raw.title, "Night market by the river");
  assert.equal(raw.starts_at, "2026-07-10T18:00:00+02:00");
  assert.equal(raw.ends_at, "2026-07-10T23:00:00+02:00");
  assert.equal(raw.lat, 55.6);
  assert.equal(raw.lng, 13.0);
  assert.equal(raw.source_url, "https://feed.test/event/1");
  assert.equal(raw.place_context, "Riverside Square");
});

test("reads geo from event.geo as well as event.location.geo", () => {
  const raw = mapSchemaOrgEventToRaw(event({ geo: { latitude: 41.4, longitude: 2.1 }, location: { name: "Plaça" } }));
  assert.equal(raw.lat, 41.4);
  assert.equal(raw.lng, 2.1);
});

test("missing coordinates map to no lat/lng (the normalizer decides eligibility)", () => {
  const raw = mapSchemaOrgEventToRaw(event({ location: { name: "Somewhere" }, geo: undefined }));
  assert.equal(raw.lat, undefined);
  assert.equal(raw.lng, undefined);
});

test("multilingual name (language map / array) resolves to a usable string", () => {
  assert.equal(mapSchemaOrgEventToRaw(event({ name: { sv: "Marknad", en: "Market" } })).title, "Marknad");
  assert.equal(mapSchemaOrgEventToRaw(event({ name: [{ "@value": "Fira" }] })).title, "Fira");
});

test("a cancelled event is flagged stale via freshness, never trusted as live", () => {
  const raw = mapSchemaOrgEventToRaw(event({ eventStatus: "https://schema.org/EventCancelled" }));
  assert.equal(raw.freshness, "stale");
});

// --- envelope extraction ---------------------------------------------------

test("extracts events from bare object, array, @graph and items wrappers; filters non-events", () => {
  assert.equal(extractSchemaOrgEvents(event()).length, 1);
  assert.equal(extractSchemaOrgEvents([event(), event()]).length, 2);
  assert.equal(extractSchemaOrgEvents({ "@graph": [event(), { "@type": "Place", name: "x" }] }).length, 1);
  assert.equal(extractSchemaOrgEvents({ items: [event()] }).length, 1);
  assert.equal(extractSchemaOrgEvents({ "@type": "WebSite" }).length, 0);
  assert.equal(extractSchemaOrgEvents(null).length, 0);
});

test("extracts schema.org/Event JSON-LD from a reviewed HTML calendar page", () => {
  const html = `<!doctype html>
    <script type="application/ld+json">${JSON.stringify({ "@type": "WebSite", name: "Calendar" })}</script>
    <script data-source="calendar" type='application/ld+json; charset=utf-8'>
      ${JSON.stringify({ "@graph": [event(), { "@type": "Place", name: "Riverside" }] })}
    </script>`;
  const events = extractSchemaOrgEventsFromHtml(html);
  assert.equal(events.length, 1);
  assert.equal(events[0].name, "Night market by the river");
});

// --- end-to-end through the #280 registry bridge ---------------------------

test("a configured provider yields a normalized, source-backed, timed event through the registry", async () => {
  const result = await collectPulseSourcesForCity(city, {
    providerSpecs: [provider({ fetcher: async () => jsonResponse({ "@graph": [event()] }) })],
    context: { now: NOW },
  });
  assert.equal(result.events.length, 0, "schema.org events are not legacy live events");
  assert.equal(result.time_sensitive_events.length, 1);
  const e = result.time_sensitive_events[0];
  assert.equal(e.candidate_kind, "source_event");
  assert.equal(e.timing_relevance, "now"); // 18:00–23:00 local around a 21:00 local now
  assert.equal(e.lat, 55.6);
  assert.equal(e.lng, 13.0);
  // Source backing comes from the event url (+ descriptor label via the bridge).
  assert.equal(e.source_url, "https://feed.test/event/1");
  assert.equal(e.source_label, "Test City Calendar");
  assert.ok(!(e.timing_reasons || []).includes("missing_source_backing"));
});

test("HTML mode yields the same normalized source event without scraping editorial copy", async () => {
  const html = `<!doctype html><main>Long editorial description that is not Parranda content.</main>
    <script type="application/ld+json">${JSON.stringify(event())}</script>`;
  const result = await collectPulseSourcesForCity(city, {
    providerSpecs: [provider({ format: "html", endpoint: "https://feed.test/calendar", fetcher: async () => htmlResponse(html) })],
    context: { now: NOW },
  });
  assert.equal(result.time_sensitive_events.length, 1);
  assert.equal(result.time_sensitive_events[0].title, "Night market by the river");
  assert.ok(!JSON.stringify(result.time_sensitive_events[0]).includes("Long editorial description"));
});

test("HTML mode distinguishes malformed JSON-LD from a proven empty calendar", async () => {
  const malformed = await collectPulseSourcesForCity(city, {
    providerSpecs: [provider({ format: "html", endpoint: "https://feed.test/calendar", fetcher: async () => htmlResponse(
      '<script type="application/ld+json">{not json}</script>',
    ) })],
    context: { now: NOW },
  });
  assert.equal(malformed.source_status[0].collection_status, "failed");
  assert.equal(malformed.source_status[0].collection_reason, "source_payload_invalid");

  const mixedMalformed = await collectPulseSourcesForCity(city, {
    providerSpecs: [provider({ format: "html", endpoint: "https://feed.test/calendar", fetcher: async () => htmlResponse(
      '<script type="application/ld+json">{"@type":"WebSite"}</script><script type="application/ld+json">{not json}</script>',
    ) })],
    context: { now: NOW },
  });
  assert.equal(mixedMalformed.source_status[0].collection_status, "failed");

  const empty = await collectPulseSourcesForCity(city, {
    providerSpecs: [provider({ format: "html", endpoint: "https://feed.test/calendar", fetcher: async () => htmlResponse(
      '<script type="application/ld+json">{"@type":"WebSite"}</script>',
    ) })],
    context: { now: NOW },
  });
  assert.equal(empty.source_status[0].collection_status, "empty");
  assert.equal(empty.source_status[0].collection_reason, "source_empty");
});

test("an expired event is downgraded to stale even if it claims to be happening", async () => {
  const result = await collectPulseSourcesForCity(city, {
    providerSpecs: [
      provider({
        fetcher: async () =>
          jsonResponse([event({ startDate: "2020-01-01T18:00:00Z", endDate: "2020-01-01T22:00:00Z" })]),
      }),
    ],
    context: { now: NOW },
  });
  // schema.org/Event carries no Parranda confidence field, so the provider sets
  // none; the honest guarantee is that an expired event is stale and never
  // trusted as strong/medium.
  assert.equal(result.time_sensitive_events[0].timing_relevance, "stale");
  assert.ok(["low", "needs_review"].includes(result.time_sensitive_events[0].confidence));
});

// --- fail-soft + env gating ------------------------------------------------

test("no endpoint, non-200, thrown error, and malformed payload fail soft with honest outcomes", async () => {
  // endpoint omitted at construction → resolved as null at collect time → empty.
  // (sourceUrl is supplied so the descriptor still validates.)
  const noEndpoint = createSchemaOrgEventProvider({ sourceUrl: "https://feed.test/", fetcher: async () => jsonResponse([event()]) });
  const r0 = await collectPulseSourcesForCity(city, { providerSpecs: [noEndpoint], context: { now: NOW } });
  assert.deepEqual(r0.time_sensitive_events, []);
  assert.equal(r0.source_status[0].status, "skipped");
  assert.equal(r0.source_status[0].collection_status, "unavailable");
  assert.equal(r0.source_status[0].collection_reason, "source_endpoint_unavailable");

  const r1 = await collectPulseSourcesForCity(city, {
    providerSpecs: [provider({ fetcher: async () => ({ ok: false, status: 503 }) })],
    context: { now: NOW },
  });
  assert.deepEqual(r1.time_sensitive_events, []);
  assert.equal(r1.source_status[0].status, "failed");
  assert.equal(r1.source_status[0].collection_reason, "source_http_503");

  const r2 = await collectPulseSourcesForCity(city, {
    providerSpecs: [provider({ fetcher: async () => { throw new Error("network down"); } })],
    context: { now: NOW },
  });
  assert.deepEqual(r2.time_sensitive_events, []);
  assert.equal(r2.source_status[0].status, "failed");
  assert.equal(r2.source_status[0].collection_reason, "source_fetch_failed");

  const r3 = await collectPulseSourcesForCity(city, {
    providerSpecs: [provider({ fetcher: async () => ({ ok: true, json: async () => { throw new Error("bad json"); } }) })],
    context: { now: NOW },
  });
  assert.deepEqual(r3.time_sensitive_events, []);
  assert.equal(r3.source_status[0].status, "failed");
  assert.equal(r3.source_status[0].collection_reason, "source_payload_invalid");

  const empty = await collectPulseSourcesForCity(city, {
    providerSpecs: [provider({ fetcher: async () => jsonResponse({ "@graph": [] }) })],
    context: { now: NOW },
  });
  assert.equal(empty.source_status[0].status, "ok");
  assert.equal(empty.source_status[0].collection_status, "empty");
  assert.equal(empty.source_status[0].collection_reason, "source_empty");
});

test("resolveDefaultSchemaOrgEventProvider is null without an endpoint env and a provider with one", () => {
  assert.equal(resolveDefaultSchemaOrgEventProvider({}), null);
  const built = resolveDefaultSchemaOrgEventProvider({
    PARRANDA_SCHEMA_ORG_EVENT_SOURCE: "https://feed.test/events.jsonld",
    PARRANDA_SCHEMA_ORG_EVENT_LABEL: "Region Skåne calendar",
    PARRANDA_SCHEMA_ORG_EVENT_LICENSE: "CC-BY 4.0",
  });
  assert.ok(built && built.descriptor);
  assert.equal(built.descriptor.label, "Region Skåne calendar");
  assert.equal(built.descriptor.license_label, "CC-BY 4.0");
  assert.equal(built.descriptor.status, "active");
});
