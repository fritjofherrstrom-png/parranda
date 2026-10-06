"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createDatatourismeEventProvider, datatourismeFeedForContext, mapDatatourismeEvent,
  coordinateTimezone, ENDPOINT } = require("../server/pulse-sources/datatourisme-event-provider");
const { collectAnchorEvents, resolveDefaultEventSupply } = require("../server/place-candidates/agnostic-event-supply");
const { createSourceCache } = require("../server/place-candidates/source-cache");
const { executeLiveEventQuery } = require("../server/place-candidates/live-event-query");

const ANCHOR = { lat: 48.1173, lng: -1.6778 };
const CONTEXT = { country_code: "fr", locality: "Test locality" };
const NOW = "2026-07-20T12:00:00Z";
function record(overrides = {}) {
  return { uuid: "event-1", uri: "https://data.datatourisme.fr/42/event-1?format=json", label: "Concert associatif",
    type: "Concert", isLocatedAt: [{ geo: { latitude: ANCHOR.lat, longitude: ANCHOR.lng },
      address: [{ addressLocality: "Test locality", streetAddress: "1 rue de la scène" }] }],
    takesPlaceAt: [{ startDate: "2026-07-20", endDate: "2026-07-20", startTime: "18:00", endTime: "21:00" }],
    hasBeenPublishedBy: [{ legalName: "Office de tourisme" }], lastUpdate: "2026-07-19T09:00:00Z", ...overrides };
}
function response(objects = [], meta = { page: 1, total: objects.length, total_pages: 1 }) {
  return new Response(JSON.stringify({ objects, meta }));
}
// The new complementary country calendar is a healthy empty control here;
// assertions below count actual DATAtourisme reads, not all country sources.
function openCalendarControl(url) {
  if (!url.startsWith("https://openholidaysapi.org/")) return null;
  return new Response(JSON.stringify(url.endsWith("/Countries")
    ? [{ isoCode: "FR", name: [{ language: "FR", text: "France" }], officialLanguages: ["FR"] }] : []));
}
async function collect(options = {}) {
  return createDatatourismeEventProvider({ key: "private-test-key", anchor: ANCHOR,
    fetcher: async () => response([record()]), ...options }).create().collect({ date: "2026-07-20" });
}

test("country layer selection uses server-attested country, not a city or public endpoint", () => {
  assert.equal(datatourismeFeedForContext({ anchor: ANCHOR }), null);
  assert.equal(datatourismeFeedForContext({ anchor: ANCHOR, placeContext: { country_code: "es" } }), null);
  assert.equal(datatourismeFeedForContext({ anchor: { lat: NaN, lng: 1 }, placeContext: CONTEXT }), null);
  for (const anchor of [ANCHOR, { lat: 45.7, lng: 4.8 }]) {
    const feed = datatourismeFeedForContext({ anchor, placeContext: CONTEXT });
    assert.equal(feed.endpoint, ENDPOINT);
    assert.equal(feed.pulse_only, true);
    assert.equal(feed.source_family, "national_open");
  }
});

test("mapper retains exact URL, French atoms, actual geometry and publisher/update credits", () => {
  const [event] = mapDatatourismeEvent(record());
  assert.equal(event.title, "Concert associatif");
  assert.equal(event.starts_at, "2026-07-20T16:00:00.000Z");
  assert.equal(event.ends_at, "2026-07-20T19:00:00.000Z");
  assert.equal(event.source_url, record().uri);
  assert.equal(event.place_context, "Test locality");
  assert.equal(event.address, "1 rue de la scène");
  assert.equal(event.source_language, "fr");
  assert.equal(event.timezone, "Europe/Paris");
  assert.equal(event.provenance.attribution, "Office de tourisme — DATAtourisme — Licence Ouverte — 2026-07-19T09:00:00Z");
  assert.equal(event.lat, ANCHOR.lat);
  assert.equal(mapDatatourismeEvent(record({ label: { fr: "Concert associatif", en: "Community concert" } }))[0].title, "Concert associatif");
});

test("geographic timezone data work outside the mainland; no France-wide clock assumption", () => {
  assert.equal(coordinateTimezone(-21.1151, 55.5364), "Indian/Reunion");
  const [event] = mapDatatourismeEvent(record({ isLocatedAt: [{ geo: { latitude: -21.1151, longitude: 55.5364 } }] }));
  assert.equal(event.starts_at, "2026-07-20T14:00:00.000Z");
  assert.equal(event.timezone, "Indian/Reunion");
  assert.equal(coordinateTimezone(0, -30), null, "an ocean timezone does not prove a venue clock");
});

test("date-only listings preserve dates; ranges and unstated recurrence never become daily sessions", () => {
  const map = (period) => mapDatatourismeEvent(record({ takesPlaceAt: [period] }))[0];
  const day = map({ startDate: "2026-07-20" });
  assert.deepEqual(day.time_window, { kind: "all_day", starts_on: "2026-07-20", ends_on: "2026-07-20" });
  assert.equal(day.starts_at, undefined);
  const range = map({ startDate: "2026-07-20", endDate: "2026-07-24", startTime: "18:00", endTime: "21:00" });
  assert.equal(range.time_window.kind, "period");
  assert.equal(range.time_window.local_start, "18:00");
  assert.equal(range.starts_at, undefined);
  assert.equal(map({ startDate: "2026-07-20", appliesOnDay: [{ key: "Monday" }] }).time_window.kind, "period");
});

test("distinct source periods keep stable identities independent of response ordering", () => {
  const periods = [record().takesPlaceAt[0], { ...record().takesPlaceAt[0], startTime: "21:30", endTime: "23:00" }];
  const rows = mapDatatourismeEvent(record({ takesPlaceAt: periods }));
  assert.equal(new Set(rows.map(row => row.id)).size, 2);
  assert.deepEqual(rows.map(row => row.id).sort(), mapDatatourismeEvent(record({ takesPlaceAt: periods.reverse() })).map(row => row.id).sort());
});

test("unverifiable geometry, credits, time facts and ambiguous local clocks fail honestly", () => {
  for (const overrides of [
    { isLocatedAt: [] }, { isLocatedAt: [record().isLocatedAt[0], record().isLocatedAt[0]] },
    { isLocatedAt: [{ geo: { latitude: null, longitude: null } }] },
    { label: "" }, { uri: "javascript:alert(1)" }, { hasBeenPublishedBy: [] }, { lastUpdate: "yesterday" },
    { takesPlaceAt: [] }, { takesPlaceAt: [{ startDate: "2026-02-30" }] },
    { takesPlaceAt: [{ startDate: "2026-07-20", endDate: "2026-07-19" }] },
    { takesPlaceAt: [{ startDate: "2026-07-20", startTime: "24:00" }] },
    { takesPlaceAt: [{ startDate: "2026-07-20", endTime: "21:00" }] },
    { takesPlaceAt: [{ startDate: "2026-07-20", startTime: "21:00", endTime: "18:00" }] },
    { takesPlaceAt: [{ startDate: "2026-03-29", startTime: "02:30" }] },
    { takesPlaceAt: [{ startDate: "2026-10-25", startTime: "02:30" }] },
  ]) assert.equal(mapDatatourismeEvent(record(overrides)), null, JSON.stringify(overrides));
  assert.equal(mapDatatourismeEvent(record(), { timezoneResolver: () => null }), null);
});

test("credentials stay private; query uses bounded geographic fields and fixed HTTPS pagination", async () => {
  const calls = [];
  const out = await collect({ fetcher: async (url, init) => {
    calls.push({ url, init });
    return response([record({ uuid: `event-${calls.length}` })], {
      page: calls.length, total: 2, total_pages: 2, next: "http://hostile.invalid/?api_key=not-to-be-followed",
    });
  } });
  assert.equal(out.collection_status.status, "ok");
  assert.equal(calls.length, 2);
  for (let index = 0; index < calls.length; index++) {
    const { url, init } = calls[index];
    const parsed = new URL(url);
    assert.equal(parsed.origin + parsed.pathname, ENDPOINT);
    assert.equal(parsed.searchParams.get("page"), String(index + 1));
    assert.equal(parsed.searchParams.get("page_size"), "80");
    assert.ok(parsed.searchParams.get("fields").includes("takesPlaceAt"));
    assert.equal(parsed.searchParams.get("geo_distance"), `${ANCHOR.lat},${ANCHOR.lng},3km`);
    assert.equal(parsed.searchParams.get("filters"), "(takesPlaceAt.endDate[gte]=2026-07-19 OR takesPlaceAt.startDate[gte]=2026-07-19) AND takesPlaceAt.startDate[lte]=2026-07-28");
    assert.equal(parsed.searchParams.get("sort"), "takesPlaceAt.endDate[asc],uuid[asc]");
    assert.equal(url.includes("private-test-key"), false);
    assert.equal(init.headers["X-API-Key"], "private-test-key");
    assert.equal(init.redirect, "manual");
  }
});

test("missing key makes no fetch and cannot be reported as an empty source", async () => {
  const out = await collect({ key: null, fetcher: () => assert.fail("no credentials, no acquisition") });
  assert.equal(out.collection_status.status, "unavailable");
  assert.equal(out.collection_status.reason, "source_credentials_unavailable");
  assert.deepEqual(out.time_sensitive_events, []);
});

test("healthy empty, HTTP failure, bad payload, redirect and truncation stay distinct", async () => {
  const empty = await collect({ fetcher: async () => response([], { page: 1, total: 0, total_pages: 0 }) });
  assert.equal(empty.collection_status.status, "empty");
  for (const fetcher of [async () => new Response("denied", { status: 403 }),
    async () => new Response("not JSON"), async () => response([record({ takesPlaceAt: [] })]),
    async () => ({ ok: true, url: "https://other.invalid/", text: async () => "{}" }),
  ]) assert.equal((await collect({ fetcher })).collection_status.status, "failed");
  const truncated = await collect({ fetcher: async (url) => response([record()], {
    page: Number(new URL(url).searchParams.get("page")), total: 240, total_pages: 3,
  }) });
  assert.equal(truncated.collection_status.status, "failed");
  assert.equal(truncated.collection_status.reason, "source_collection_truncated");
  assert.equal(truncated.time_sensitive_events.length, 1, "retained facts survive partial acquisition with deduplication");
});

test("stream byte cap cancels oversized input before parsing and timeout bounds a stalled transport", async () => {
  let cancelled = false;
  const capped = await collect({ fetcher: async () => ({ ok: true, body: { getReader: () => ({
    read: async () => ({ done: false, value: new Uint8Array(2 * 1024 * 1024 + 1) }),
    cancel: async () => { cancelled = true; },
  }) } }) });
  assert.equal(cancelled, true);
  assert.equal(capped.collection_status.status, "failed");
  const timedOut = await collect({ timeoutMs: 50, fetcher: () => new Promise(() => {}) });
  assert.equal(timedOut.collection_status.reason, "source_timeout");
});

test("expanded POI periods cannot exceed the downstream event budget", async () => {
  const takesPlaceAt = Array.from({ length: 24 }, (_, index) => ({ startDate: `2026-07-${String(index + 1).padStart(2, "0")}` }));
  const out = await collect({ fetcher: async () => response(Array.from({ length: 10 }, (_, index) => record({ uuid: `poi-${index}`, takesPlaceAt }))) });
  assert.equal(out.time_sensitive_events.length, 160);
  assert.equal(out.collection_status.status, "failed");
  assert.equal(out.collection_status.reason, "source_collection_truncated");
});

test("outside geometry cannot spend timezone work or become a local event", async () => {
  const far = record({ isLocatedAt: [{ geo: { latitude: 40, longitude: 10 } }] });
  const out = await collect({ fetcher: async () => response([far]), timezoneResolver: () => assert.fail("far geometry is rejected first") });
  assert.equal(out.time_sensitive_events.length, 0);
  assert.equal(out.collection_status.status, "empty");
});

test("actual collector exposes both date periods, credit and exact resource link, with no route eligibility", async () => {
  const feed = datatourismeFeedForContext({ anchor: ANCHOR, placeContext: CONTEXT });
  const rows = [record(), record({ uuid: "future", takesPlaceAt: [{ startDate: "2026-07-23" }] }),
    record({ uuid: "range", takesPlaceAt: [{ startDate: "2026-07-20", endDate: "2026-07-25", startTime: "18:00" }] })];
  const out = await collectAnchorEvents({ anchor: ANCHOR, now: NOW, selectedDate: "2026-07-20", registry: [feed],
    datatourismeKey: "private-test-key", fetcher: async () => response(rows) });
  assert.equal(out.acquisition.source_health.status, "healthy");
  assert.equal(out.tonight.length, 1);
  assert.equal(out.this_week.length, 2);
  const event = out.tonight[0];
  assert.equal(event.timezone, "Europe/Paris");
  assert.equal(event.source_url, record().uri);
  assert.equal(event.source_link_host, "data.datatourisme.fr");
  assert.equal(event.source_link_kind, "page");
  assert.ok(event.sources[0].attribution.includes("Office de tourisme"));
  assert.equal(event.route_eligible, false);
  assert.equal(out.this_week.find(row => row.id.includes("range")).time_window.kind, "period");
});

test("ordinary default supply warms once, preserves scout demand and reuses source snapshot across periods", async () => {
  let fetched = 0; let demands = 0; let release;
  const started = new Promise(resolve => { release = resolve; });
  const producers = [];
  const supply = resolveDefaultEventSupply({ PARRANDA_AGNOSTIC_EVENTS: "enabled", PARRANDA_DATATOURISME_KEY: "private-test-key" }, {
    eventCache: createSourceCache({ namespace: "fixture-national", ttlMs: 60000 }),
    sourceCatalog: { recordScoutDemand: async () => { demands++; return { status: "recorded" }; } },
    collectEvents: options => {
      assert.equal(options.datatourismeKey, "private-test-key");
      assert.equal(options.registry[0].key, undefined);
      const promise = collectAnchorEvents({ ...options, fetcher: async (url) => {
        const calendar = openCalendarControl(url); if (calendar) return calendar;
        fetched++; await started; return response([record()]);
      } });
      producers.push(promise); return promise;
    },
  });
  const query = { anchor: ANCHOR, placeContext: CONTEXT, now: NOW, selectedDate: "2026-07-20" };
  const cold = await supply(query);
  assert.equal(cold.pending, true);
  assert.equal(cold.feeds[0].id, "datatourisme-fr");
  assert.equal(JSON.stringify(cold).includes("private-test-key"), false);
  await supply(query);
  assert.equal(producers.length, 1, "retry coalesces the existing background collection");
  release(); await Promise.all(producers); await new Promise(resolve => setImmediate(resolve));
  const warm = await supply(query);
  assert.equal(warm.tonight.length, 1);
  assert.equal(warm.pending, undefined);
  assert.ok(demands > 0, "national source must not suppress local source discovery");
  await supply({ ...query, time: "this_week" });
  await Promise.all(producers); await new Promise(resolve => setImmediate(resolve));
  assert.equal(fetched, 1, "same provider snapshot is shared across Live period views");
});

test("public country, provider and timezone hints cannot activate the national layer", async () => {
  const supply = resolveDefaultEventSupply({ PARRANDA_AGNOSTIC_EVENTS: "enabled" }, {
    collectEvents: () => assert.fail("unattested public country cannot trigger collection"),
  });
  const result = await executeLiveEventQuery({ payload: { scope: "around_place", anchor: ANCHOR,
    country_code: "fr", placeContext: CONTEXT, timezone: "Europe/Paris", endpoint: ENDPOINT,
  }, eventSupply: supply, now: NOW });
  assert.equal(result.status, 200);
  assert.equal(result.body.live_events.coverage, "uncovered");
  assert.equal(result.body.route_mutation, false);
  assert.equal(result.body.day_anchor_mutation, false);
});

for (const lang of ["en", "sv"]) test(`${lang} attested Live query/retry exposes country events without changing scope/day/route`, async () => {
  const bounds = { south: ANCHOR.lat - 0.12, north: ANCHOR.lat + 0.12, west: ANCHOR.lng - 0.15, east: ANCHOR.lng + 0.15 };
  const resolver = async (_query, options) => {
    assert.equal(options.language, lang);
    return [{ ...ANCHOR, label: "Test locality", confidence: "medium", provenance: "trusted_fixture_resolver",
      admin_context: CONTEXT, spatial_scope: { source: "resolver_bounds", kind: "settlement", bounds } }];
  };
  let fetches = 0;
  const producers = [];
  const supply = resolveDefaultEventSupply({ PARRANDA_AGNOSTIC_EVENTS: "enabled", PARRANDA_DATATOURISME_KEY: "private-test-key" }, {
    eventCache: createSourceCache({ namespace: `fixture-${lang}`, ttlMs: 60000 }),
    collectEvents: options => {
      const promise = collectAnchorEvents({ ...options, fetcher: async (url) => {
        const calendar = openCalendarControl(url); if (calendar) return calendar;
        fetches++; return response([record(), record({ uuid: "next-day", takesPlaceAt: [{ startDate: "2026-07-23" }] })]);
      } });
      producers.push(promise); return promise;
    },
  });
  const publishedDay = { anchor: ANCHOR, date: "2026-07-20", stops: ["original-stop"], route: "/frozen-route" };
  const before = JSON.stringify(publishedDay);
  for (const time of ["tonight", "this_week"]) {
    const payload = { scope: "around_place", anchor: ANCHOR, place_query: "Test locality", selected_date: publishedDay.date, time,
      country_code: "es", timezone: "UTC", provider_url: "https://injected.invalid/" };
    const query = () => executeLiveEventQuery({ payload, now: NOW, placeResolver: resolver, placeLanguage: lang, eventSupply: supply });
    const cold = await query();
    assert.equal(cold.body.live_events.pending, true);
    await Promise.all(producers); await new Promise(resolve => setImmediate(resolve));
    const warm = await query();
    assert.equal(warm.status, 200);
    assert.equal(warm.body.live_events.pending, undefined);
    assert.equal(warm.body.live_events.tonight[0].title, "Concert associatif");
    assert.equal(warm.body.live_events.this_week[0].starts_on, "2026-07-23");
    assert.equal(warm.body.live_events.tonight[0].timezone, "Europe/Paris");
    assert.equal(warm.body.query.selected_date, publishedDay.date);
    assert.equal(warm.body.query.time, time);
    assert.equal(warm.body.route_mutation, false);
    assert.equal(warm.body.day_anchor_mutation, false);
    assert.equal(JSON.stringify(publishedDay), before);
  }
  assert.equal(fetches, 1, "period changes/retry reuse the background provider snapshot");
});
