"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { buildApp, resolveSelectedRouteDate } = require("../server/app");
const { cityConfigs } = require("../server/cities");
const {
  collectAnchorEvents,
  resolveDefaultEventSupply,
  HELSINKI_LINKED_EVENTS_FEED,
} = require("../server/place-candidates/agnostic-event-supply");
const { createSourceCache } = require("../server/place-candidates/source-cache");
const { createPlaceSelectionStore } = require("../server/place-candidates/place-selection");
const { routeWalkingPath } = require("../server/walking-router");
const { externalRecord, requestJson } = require("./helpers/planner-reservoir-compare");

const SELECTED_DATE = "2026-10-14";
const NEXT_DATE = "2026-10-15";
const BEFORE_MIDNIGHT = "2026-10-14T20:59:59Z"; // 23:59 in Helsinki
const AFTER_MIDNIGHT = "2026-10-14T21:00:01Z";
const ROUTE_PATH = "/api/route-recommendations?lang=en&experimental_agnostic_route_output=1&include_external_candidates=1&include_live_completion=1&include_live_route_upgrade=1";
const COMPLETION_PATH = "/api/planner-live-completion";
const UPGRADE_PATH = "/api/planner-live-route-upgrade";
const ROUTE_BODY = {
  place: "Fixture harbour",
  day_rhythm: "balanced",
  preferences: ["food", "culture", "views"],
  agnostic_engine_compose: true,
  pinned_candidate_ids: ["date-restaurant-0"],
  excluded_candidate_ids: ["date-viewpoint-5"],
};

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

function sourceRow(date) {
  return {
    id: `concert-${date}`,
    name: { en: "Source-backed harbour concert" },
    start_time: `${date}T18:00:00Z`,
    // The selected-day occurrence is still genuinely running after midnight.
    end_time: `${date}T22:00:00Z`,
    location: { position: { coordinates: [24.943, 60.173] }, name: { en: "Harbour stage" } },
    info_url: { en: "https://example.org/harbour-concert" },
    data_source: "fixture",
    keywords: [{ name: { en: "music" } }],
  };
}

async function withFixture({ rollover = true, instantAtStart = BEFORE_MIDNIGHT,
  eventMode = "pending", completionDate = null } = {}, run) {
  const todayDescriptor = Object.getOwnPropertyDescriptor(cityConfigs.rome, "todayIsoDate");
  const transport = deferred();
  const sourceRequests = [], weatherRequests = [], eventRequests = [];
  let today = SELECTED_DATE, instant = instantAtStart;
  let clockReads = 0, todayReads = 0, providerCalls = 0, walks = 0;
  let server;
  const records = ["restaurant", "viewpoint"].flatMap((type, group) =>
    Array.from({ length: 6 }, (_, i) => externalRecord(
      `date-${type}-${i}`, `Fixture ${type} ${i}`, type,
      60.17 + group * .002 + i * .0003, 24.94 + i * .0003,
      [type === "restaurant" ? "mat" : "utsikt"],
    )));
  const clock = () => { clockReads++; return new Date(instant); };
  // Preserve both existing seams: composition takes a Date-returning callable;
  // Live takes clock.now() and must retain its actual later acquisition instant.
  clock.now = () => instant;
  const collectEvents = input => {
    eventRequests.push(input);
    return collectAnchorEvents({ ...input,
      registry: input.registry || [HELSINKI_LINKED_EVENTS_FEED],
      // A mismatched producer still passes the real normalizer. Only its
      // external acquisition date changes, never the HTTP/completion schema.
      selectedDate: completionDate || input.selectedDate,
      fetcher: async url => {
        assert.equal(new URL(String(url)).origin, "https://api.hel.fi");
        providerCalls++;
        return transport.promise;
      },
    });
  };
  const pendingSupply = resolveDefaultEventSupply({
    PARRANDA_AGNOSTIC_EVENTS: "enabled",
    PARRANDA_EVENT_FEEDS: JSON.stringify([HELSINKI_LINKED_EVENTS_FEED]),
  }, {
    eventCache: createSourceCache({ dir: null }),
    collectEvents,
  });
  try {
    cityConfigs.rome.todayIsoDate = () => { todayReads++; return today; };
    if (eventMode === "eager") {
      transport.resolve({ ok: true, json: async () => ({ data: [sourceRow(SELECTED_DATE)] }) });
    }
    server = buildApp({
      openDataLoader: async request => {
        sourceRequests.push(request);
        if (rollover && sourceRequests.length === 1) {
          today = NEXT_DATE;
          instant = AFTER_MIDNIGHT;
        }
        return records;
      },
      eventSupply: eventMode === "none" ? null : eventMode === "eager" ? collectEvents : pendingSupply,
      placeResolver: async () => [{ label: "Fixture harbour", lat: 60.17, lng: 24.94,
        confidence: "medium", provenance: "test_resolver", timezone: "Europe/Helsinki" }],
      placeSelectionStore: createPlaceSelectionStore({ cacheDir: null }),
      placeSuggestions: null, reviewedPlaceSource: null, sourceCatalog: null,
      weatherProvider: async input => { weatherRequests.push(input); return null; },
      walkingRouter: async points => { walks++; return routeWalkingPath(points); },
      clock,
    }).listen(0, "127.0.0.1");
    if (!server.listening) await new Promise(resolve => server.once("listening", resolve));
    return await run({
      post: (path, body) => requestJson(server, { path, body }),
      finish: (rows = [sourceRow(SELECTED_DATE), sourceRow(NEXT_DATE)]) =>
        transport.resolve({ ok: true, json: async () => ({ data: rows }) }),
      records, sourceRequests, weatherRequests, eventRequests,
      counts: () => ({ loaders: sourceRequests.length, weather: weatherRequests.length,
        events: eventRequests.length, providers: providerCalls, clock: clockReads, today: todayReads, walks }),
    });
  } finally {
    transport.resolve({ ok: true, json: async () => ({ data: [] }) });
    if (server) {
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    }
    Object.defineProperty(cityConfigs.rome, "todayIsoDate", todayDescriptor);
  }
}

async function readCompleted(h, token) {
  let response;
  for (let i = 0; i < 20; i++) {
    await new Promise(resolve => setImmediate(resolve));
    response = await h.post(COMPLETION_PATH, { token });
    if (response.status !== 202) break;
  }
  assert.equal(response.status, 200, "real source normalization must reach terminal completion");
  assert.equal(response.body.days, undefined, "completion remains a read-only sidecar");
  return response;
}

function assertPublished(response, date) {
  assert.equal(response.status, 200);
  assert.equal(response.body.agnostic_route_output_experiment.promotion.promote, true);
  assert.equal(response.body.days[0].date, date);
  const route = response.body.days[0].primary_route;
  assert.ok(route.main_stops.length >= 2, "precondition: a real published engine day");
  assert.ok(route.main_stops.some(stop => stop.id === "date-restaurant-0"), "published pin survives");
  assert.ok(route.main_stops.every(stop => stop.id !== "date-viewpoint-5"), "exclusion survives");
  assert.equal(response.body.agnostic_route_output_experiment.walking_validation.valid, true);
}

test("omitted dates keep route, Live and retained upgrade on one selected day across local midnight", async () => {
  await withFixture({}, async h => {
    assert.equal(Object.hasOwn(ROUTE_BODY, "dates"), false, "the actual HTTP request omits dates");
    const initial = await h.post(ROUTE_PATH, ROUTE_BODY);
    assertPublished(initial, SELECTED_DATE);
    assert.equal(initial.body.live_events.pending, true);
    assert.equal(initial.body.live_completion.version, 1);
    assert.equal(initial.body.live_completion.route_upgrade, "explicit_request");
    const { token } = initial.body.live_completion;
    assert.equal((await h.post(COMPLETION_PATH, { token })).status, 202);
    const before = h.counts(), original = JSON.stringify(initial.body.days);
    h.records.splice(0); // An upgrade must use the retained original reservoir.
    h.finish();
    const completed = await readCompleted(h, token);
    const upgraded = await h.post(UPGRADE_PATH, { token });
    console.log(JSON.stringify({ case: "omitted-midnight", route_date: initial.body.days[0].date,
      live_date: initial.body.live_events.selected_date,
      collection_date: h.eventRequests[0].selectedDate,
      completion_date: completed.body.live_events.selected_date,
      upgrade_state: upgraded.body.live_route_upgrade?.state,
      initial_days: initial.body.days, upgraded_days: upgraded.body.result?.days,
      counts: h.counts() }));
    assert.deepEqual([
      initial.body.days[0].date, initial.body.live_events.selected_date,
      h.eventRequests[0].selectedDate, completed.body.live_events.selected_date,
    ], Array(4).fill(SELECTED_DATE), "selected identity must not be resampled after the first loader");
    assert.equal(h.eventRequests[0].now, AFTER_MIDNIGHT, "freeze the selected day, not Live's real clock");
    assert.equal(completed.body.live_events.acquisition.source_health.status, "healthy");
    assert.equal(completed.body.live_events.acquisition.source_health.result, "events_found");
    assert.equal(upgraded.status, 200);
    assert.equal(upgraded.body.live_route_upgrade.state, "applied");
    assertPublished({ status: upgraded.status, body: upgraded.body.result }, SELECTED_DATE);
    assert.equal(upgraded.body.result.days[0].primary_route.main_stops.at(-1).event_id, `concert-${SELECTED_DATE}`);
    assert.equal(upgraded.body.result.place_structure.district_day.evening_event.occurrence_date, SELECTED_DATE);
    assert.equal(upgraded.body.result.place_structure.district_day.evening_event.woven_into_route, true);
    assert.deepEqual(upgraded.body.result.agnostic_route_output_experiment.context,
      initial.body.agnostic_route_output_experiment.context, "retained trusted clock/weather remain original");
    assert.equal(JSON.stringify(initial.body.days), original, "published original stays immutable");
    assert.equal(h.counts().loaders, before.loaders);
    assert.equal(h.counts().weather, before.weather);
    assert.equal(h.counts().events, 1);
    assert.equal(h.counts().providers, 1);
    assert.equal(h.counts().clock, 1, "the acquisition and finalizer share the memoized clock");
    assert.equal(h.counts().today, 1, "the omitted selected day is resolved once");
    assert.equal(h.sourceRequests.length, 2);
    assert.equal(h.weatherRequests.length, 1);
    for (const request of h.sourceRequests) {
      assert.deepEqual(request.availabilityWindow, { weekday: 3, startMinute: 1439, endMinute: 1440 });
    }
    assert.deepEqual((await h.post(UPGRADE_PATH, { token })).body, upgraded.body);
  });
});

test("same-day healthy completion still applies through the real finalizer under standard preferences", async () => {
  await withFixture({ rollover: false, instantAtStart: "2026-10-14T12:00:00Z" }, async h => {
    const initial = await h.post(ROUTE_PATH, ROUTE_BODY);
    assertPublished(initial, SELECTED_DATE);
    const before = h.counts(), { token } = initial.body.live_completion;
    h.finish();
    const completed = await readCompleted(h, token);
    assert.equal(completed.body.live_events.selected_date, SELECTED_DATE);
    assert.equal(completed.body.live_events.tonight[0].route_eligible, true, "real source route attestation");
    const upgraded = await h.post(UPGRADE_PATH, { token });
    assert.equal(upgraded.body.live_route_upgrade.state, "applied");
    assertPublished({ status: upgraded.status, body: upgraded.body.result }, SELECTED_DATE);
    assert.equal(upgraded.body.result.days[0].primary_route.main_stops.at(-1).event_id, `concert-${SELECTED_DATE}`);
    assert.equal(h.counts().loaders, before.loaders);
    assert.equal(h.counts().weather, before.weather);
    assert.deepEqual(h.counts(), { loaders: 2, weather: 1, events: 1, providers: 1, clock: 1, today: 1, walks: 1 });
    console.log(JSON.stringify({ case: "same-day-control", date: upgraded.body.result.days[0].date,
      upgrade_state: upgraded.body.live_route_upgrade.state, counts: h.counts() }));
  });
});

test("an explicit date distinct from both local days survives rollover and retained completion", async () => {
  const date = "2026-10-16";
  await withFixture({}, async h => {
    const initial = await h.post(ROUTE_PATH, { ...ROUTE_BODY, dates: [date] });
    assertPublished(initial, date);
    assert.equal(initial.body.live_events.selected_date, date);
    assert.equal(h.eventRequests[0].selectedDate, date);
    const before = h.counts(), { token } = initial.body.live_completion;
    h.finish([sourceRow(date)]);
    const completed = await readCompleted(h, token);
    assert.equal(completed.body.live_events.selected_date, date);
    const upgraded = await h.post(UPGRADE_PATH, { token });
    assert.equal(upgraded.body.live_route_upgrade.state, "applied");
    assertPublished({ status: upgraded.status, body: upgraded.body.result }, date);
    assert.equal(upgraded.body.result.place_structure.district_day.evening_event.occurrence_date, date);
    assert.equal(h.counts().loaders, before.loaders);
    assert.equal(h.counts().weather, before.weather);
    assert.equal(h.counts().today, 0, "explicit date never consults the fallback day");
    assert.equal(h.counts().clock, 1);
    assert.equal(h.counts().events, 1);
    assert.equal(h.counts().providers, 1);
    for (const request of h.sourceRequests) {
      assert.deepEqual(request.availabilityWindow, { weekday: 5, startMinute: 0, endMinute: 1440 });
    }
  });
});

test("same-anchor healthy completion for a different date cannot replace the original day", async () => {
  await withFixture({ completionDate: NEXT_DATE }, async h => {
    const initial = await h.post(ROUTE_PATH, ROUTE_BODY);
    assertPublished(initial, SELECTED_DATE);
    assert.equal(initial.body.live_events.selected_date, SELECTED_DATE);
    const before = h.counts(), original = JSON.stringify(initial.body.days);
    const { token } = initial.body.live_completion;
    h.finish([sourceRow(NEXT_DATE)]);
    const completed = await readCompleted(h, token);
    const live = completed.body.live_events;
    assert.equal(live.selected_date, NEXT_DATE, "different-day source normalization actually completed");
    assert.equal(live.acquisition.source_health.status, "healthy");
    assert.equal(live.acquisition.source_health.result, "events_found");
    assert.equal(live.tonight[0].route_eligible, true);
    const upgraded = await h.post(UPGRADE_PATH, { token });
    assert.equal(upgraded.status, 200);
    assert.equal(upgraded.body.live_route_upgrade.state, "not_eligible");
    assert.equal(upgraded.body.result, undefined);
    assert.equal(h.counts().walks, before.walks, "date mismatch never reaches finalization");
    assert.equal(h.counts().loaders, before.loaders);
    assert.equal(h.counts().weather, before.weather);
    assert.equal(h.counts().events, 1);
    assert.equal(h.counts().providers, 1);
    assert.equal(JSON.stringify(initial.body.days), original);
    assert.deepEqual((await h.post(UPGRADE_PATH, { token })).body, upgraded.body);
    console.log(JSON.stringify({ case: "different-day-denied", original_date: initial.body.days[0].date,
      completion_date: live.selected_date, upgrade_state: upgraded.body.live_route_upgrade.state, counts: h.counts() }));
  });
});

test("already available events weave only the frozen selected-day occurrence after rollover", async () => {
  await withFixture({ eventMode: "eager" }, async h => {
    const response = await h.post(ROUTE_PATH, ROUTE_BODY);
    assertPublished(response, SELECTED_DATE);
    assert.equal(response.body.live_events.selected_date, SELECTED_DATE);
    assert.equal(response.body.live_completion, undefined, "finished supply does not mint a pending capability");
    const supplied = [...response.body.live_events.tonight, ...response.body.live_events.this_week]
      .find(event => event.id === `concert-${SELECTED_DATE}`);
    assert.ok(supplied, "precondition: normalized selected-day occurrence in the real Live pool");
    assert.equal(supplied.route_eligible, true);
    console.log(JSON.stringify({ case: "eager-midnight", live_date: response.body.live_events.selected_date,
      occurrence_date: response.body.place_structure?.district_day?.evening_event?.occurrence_date, counts: h.counts() }));
    assert.equal(response.body.days[0].primary_route.main_stops.at(-1).event_id, `concert-${SELECTED_DATE}`);
    assert.equal(response.body.place_structure.district_day.evening_event.occurrence_date, SELECTED_DATE);
    assert.equal(response.body.place_structure.district_day.evening_event.woven_into_route, true);
    assert.equal(h.counts().today, 1);
    assert.equal(h.counts().events, 1);
    assert.equal(h.counts().providers, 1);
    assert.equal(h.counts().walks, 1);
  });
});

test("no event supply keeps the frozen date without adding Live or completion contracts", async () => {
  await withFixture({ eventMode: "none" }, async h => {
    const response = await h.post(ROUTE_PATH, ROUTE_BODY);
    assertPublished(response, SELECTED_DATE);
    assert.equal(response.body.live_events, undefined);
    assert.equal(response.body.live_completion, undefined);
    assert.ok(response.body.days[0].primary_route.main_stops.every(stop => !stop.event_id));
    assert.deepEqual(h.counts(), { loaders: 2, weather: 1, events: 0, providers: 0, clock: 1, today: 1, walks: 0 });
  });
});

test("healthy empty completion remains read-only and cannot upgrade the frozen day", async () => {
  await withFixture({}, async h => {
    const initial = await h.post(ROUTE_PATH, ROUTE_BODY);
    assertPublished(initial, SELECTED_DATE);
    const before = h.counts(), { token } = initial.body.live_completion;
    h.finish([]);
    const completed = await readCompleted(h, token);
    assert.equal(completed.body.live_events.selected_date, SELECTED_DATE);
    assert.equal(completed.body.live_events.acquisition.source_health.status, "healthy");
    assert.equal(completed.body.live_events.acquisition.source_health.result, "empty");
    const upgraded = await h.post(UPGRADE_PATH, { token });
    assert.equal(upgraded.body.live_route_upgrade.state, "not_eligible");
    assert.equal(upgraded.body.result, undefined);
    assert.equal(h.counts().walks, before.walks);
    assert.equal(h.counts().loaders, before.loaders);
    assert.equal(h.counts().weather, before.weather);
    assert.equal(h.counts().events, 1);
    assert.equal(h.counts().providers, 1);
  });
});

test("selected-day normalization preserves explicit then baseline precedence without reading fallback today", () => {
  // HTTP date omission currently yields an empty baseline. Cover the existing
  // normalized-baseline helper contract without fabricating an HTTP response.
  const cityConfig = { todayIsoDate: () => { throw new Error("fallback day must not be read"); } };
  const baseline = { days: [{ date: SELECTED_DATE }] };
  assert.equal(resolveSelectedRouteDate({ dates: [] }, baseline, cityConfig), SELECTED_DATE);
  assert.equal(resolveSelectedRouteDate({ dates: ["2026-10-16"] }, baseline, cityConfig), "2026-10-16");
});
