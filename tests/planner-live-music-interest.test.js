"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { buildApp } = require("../server/app");
const { collectAnchorEvents } = require("../server/place-candidates/agnostic-event-supply");
const { externalRecord, requestJson } = require("./helpers/planner-reservoir-compare");

const DATE = "2026-07-12";
const NOW = "2026-07-12T09:00:00Z";
const anchor = { lat: 59.33, lng: 18.07 };
const registry = [{
  id: "local-calendar", label: "Local calendar", adapter: "schema_org", bbox: [18, 59, 19, 60],
  endpoint: "https://calendar.example/events", timezone: "Europe/Stockholm", status: "active",
  source_tier: "official", confidence: "medium", source_family: "municipal_open", source_identity: "calendar.example",
}];

function sourceEvent(id, title, type = "Event", fields = {}) {
  return {
    "@type": type, "@id": id, name: title, url: `https://calendar.example/events/${id}`,
    startDate: `${DATE}T19:00:00+02:00`, endDate: `${DATE}T21:00:00+02:00`,
    location: { "@type": "Place", name: "Quayside Hall", geo: { latitude: 59.3312, longitude: 18.0712 } },
    ...fields,
  };
}

const concert = sourceEvent("quartet", "Harbour Quartet", "MusicEvent");
const exhibition = sourceEvent("exhibition", "Concert poster exhibition", "ExhibitionEvent", { keywords: ["music", "exhibition"] });
const venue = sourceEvent("venue", "The Concert Hall", "MusicVenue", { startDate: undefined, endDate: undefined });
const offDate = sourceEvent("off-date", "Harbour Concert", "MusicEvent", {
  startDate: "2026-07-13T19:00:00+02:00", endDate: "2026-07-13T21:00:00+02:00",
});
const restaurants = [
  externalRecord("nearby-restaurant", "Quayside Kitchen", "restaurant", 59.3304, 18.0704),
  externalRecord("second-restaurant", "Market Kitchen", "restaurant", 59.3309, 18.0709),
];

async function plan(t, { events, places = restaurants, preferences = ["food", "live_music"], engine = true }) {
  const server = buildApp({
    openDataLoader: async () => places, placeResolver: null, reviewedPlaceSource: null, sourceCatalog: null,
    walkingRouter: null, weatherProvider: async () => null, clock: { now: () => NOW },
    eventSupply: options => collectAnchorEvents({ ...options, registry,
      fetcher: async () => ({ ok: true, json: async () => ({ "@graph": events }) }),
    }),
  }).listen(0);
  t.after(() => new Promise(resolve => server.close(resolve)));
  const result = await requestJson(server, {
    path: "/api/route-recommendations?experimental_agnostic_route_output=1&include_external_candidates=1&lang=en",
    body: { ...anchor, dates: [DATE], day_rhythm: "balanced", preferences, agnostic_engine_compose: engine },
  });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  return result.body;
}

function dayCoverage(body) {
  return body.agnostic_route_output_experiment.constraint_negotiation.preference_coverage;
}

test("the selected-day MusicEvent is woven after a viable focused two-place route", async t => {
  const body = await plan(t, { events: [exhibition, venue, offDate, concert] });
  assert.equal(body.agnostic_route_output_experiment.promotion.promote, true);
  const route = body.days[0].primary_route;
  const stop = route.main_stops.at(-1);
  assert.equal(stop.event_id, "quartet");
  assert.equal(stop.occurrence_date, DATE);
  assert.deepEqual(stop.covered_preferences, ["live_music"]);
  assert.ok(route.legs.some(leg => leg.to_label === "Harbour Quartet" && Number.isFinite(leg.distance_km)));
  assert.deepEqual(dayCoverage(body).covered_preferences, ["food", "live_music"]);
  assert.deepEqual(dayCoverage(body).missing_preferences, []);
  assert.deepEqual(body.live_events.tonight.find(row => row.id === "quartet").matched_preferences, ["live_music"]);
});

test("the day stays honest when only a same-day exhibition, a venue and an off-date concert are available", async t => {
  const body = await plan(t, { events: [exhibition, venue, offDate] });
  assert.equal(body.agnostic_route_output_experiment.promotion.promote, true);
  assert.ok(body.days[0].primary_route.main_stops.every(stop => !stop.is_live_event));
  assert.deepEqual(dayCoverage(body).covered_preferences, ["food"]);
  assert.deepEqual(dayCoverage(body).missing_preferences, ["live_music"]);
  assert.deepEqual(body.live_events.tonight.map(row => row.id), ["exhibition"]);
  assert.deepEqual(body.live_events.this_week.find(row => row.id === "off-date").matched_preferences, []);
});

for (const [type, title] of [
  ["ExhibitionEvent", "Concert poster exhibition"],
  ["ScreeningEvent", "Film screening of the Queen concert"],
]) test(`${type} about a concert remains in Live without satisfying Live music`, async t => {
  const body = await plan(t, { events: [sourceEvent("about-a-concert", title, type, { keywords: ["concert"] })] });
  const listing = body.live_events.tonight.find(row => row.id === "about-a-concert");
  assert.deepEqual(listing?.matched_preferences, []);
  assert.ok(body.days[0].primary_route.main_stops.every(stop => !stop.is_live_event));
  assert.deepEqual(dayCoverage(body).missing_preferences, ["live_music"]);
});

for (const [label, fields] of [
  ["postponed", { eventStatus: { "@id": "https://schema.org/EventPostponed" } }],
  ["moved online", { eventStatus: "https://schema.org/EventMovedOnline" }],
  ["online only", { eventAttendanceMode: "schema:OnlineEventAttendanceMode" }],
]) test(`${label} MusicEvent with a physical address cannot extend the day`, async t => {
  const body = await plan(t, { events: [sourceEvent("unavailable-concert", "Harbour Quartet", "MusicEvent", fields)] });
  assert.ok(body.live_events.tonight.every(row => row.id !== "unavailable-concert"));
  assert.ok(body.days[0].primary_route.main_stops.every(stop => !stop.is_live_event));
  assert.deepEqual(dayCoverage(body).missing_preferences, ["live_music"]);
});

test("a dated performance is still a Live match with insufficient place supply for a day", async t => {
  const body = await plan(t, { events: [concert], places: [], preferences: ["live_music"] });
  assert.equal(body.agnostic_route_output_experiment.promotion.promote, false);
  assert.deepEqual(dayCoverage(body).covered_preferences, []);
  assert.equal(body.live_events.tonight[0].id, "quartet");
  assert.deepEqual(body.live_events.tonight[0].matched_preferences, ["live_music"]);
});

test("a concert outside the evening walking extension stays in Live without covering the day", async t => {
  const distant = { ...concert, location: { ...concert.location, geo: { latitude: 59.331, longitude: 18.119 } } };
  const body = await plan(t, { events: [distant] });
  assert.equal(body.agnostic_route_output_experiment.promotion.promote, true);
  assert.ok(body.days[0].primary_route.main_stops.every(stop => !stop.is_live_event));
  assert.deepEqual(dayCoverage(body).missing_preferences, ["live_music"]);
  assert.deepEqual(body.live_events.tonight[0].matched_preferences, ["live_music"]);
});

test("the experimental legacy composer also reports coverage only after its final event weave", async t => {
  const views = externalRecord("quay-views", "Quayside lookout", "viewpoint", 59.3301, 18.0701);
  const body = await plan(t, { events: [concert], places: [...restaurants, views],
    preferences: ["food", "views", "live_music"], engine: false });
  assert.equal(body.agnostic_route_output_experiment.route_mutation, true);
  assert.equal(body.days[0].primary_route.main_stops.at(-1).event_id, "quartet");
  assert.deepEqual(dayCoverage(body).covered_preferences, ["food", "scenic", "live_music"]);
});
