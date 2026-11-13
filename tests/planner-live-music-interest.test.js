"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { buildApp, selectPublishedEventWeave } = require("../server/app");
const { weaveEveningEvent } = require("../server/candidates/evening-event-weave");
const { collectAnchorEvents } = require("../server/place-candidates/agnostic-event-supply");
const { composeAgnosticRouteOutput } = require("../server/planner/agnostic-route-output");
const { routeWalkingPath } = require("../server/walking-router");
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
const distantConcert = sourceEvent("distant-concert", "Headliner concert", "MusicEvent", {
  startDate: `${DATE}T18:00:00+02:00`,
  location: { ...concert.location, geo: { latitude: 59.331, longitude: 18.119 } },
});
const exhibition = sourceEvent("exhibition", "Concert poster exhibition", "ExhibitionEvent", { keywords: ["music", "exhibition"] });
const venue = sourceEvent("venue", "The Concert Hall", "MusicVenue", { startDate: undefined, endDate: undefined });
const offDate = sourceEvent("off-date", "Harbour Concert", "MusicEvent", {
  startDate: "2026-07-13T19:00:00+02:00", endDate: "2026-07-13T21:00:00+02:00",
});
const restaurants = [
  externalRecord("nearby-restaurant", "Quayside Kitchen", "restaurant", 59.3304, 18.0704),
  externalRecord("second-restaurant", "Market Kitchen", "restaurant", 59.3309, 18.0709),
];

async function plan(t, { events, places = restaurants, preferences = ["food", "live_music"], engine = true,
  liveEventChoices = [], walkingRouter = null }) {
  const server = buildApp({
    openDataLoader: async () => places, placeResolver: null, reviewedPlaceSource: null, sourceCatalog: null,
    walkingRouter, weatherProvider: async () => null, clock: { now: () => NOW },
    eventSupply: options => collectAnchorEvents({ ...options, registry,
      fetcher: async () => ({ ok: true, json: async () => ({ "@graph": events }) }),
    }),
  }).listen(0);
  t.after(() => new Promise(resolve => server.close(resolve)));
  const result = await requestJson(server, {
    path: "/api/route-recommendations?experimental_agnostic_route_output=1&include_external_candidates=1&lang=en",
    body: { ...anchor, dates: [DATE], day_rhythm: "balanced", preferences, agnostic_engine_compose: engine,
      live_event_choices: liveEventChoices },
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
  const body = await plan(t, { events: [distantConcert] });
  assert.equal(body.agnostic_route_output_experiment.promotion.promote, true);
  assert.ok(body.days[0].primary_route.main_stops.every(stop => !stop.is_live_event));
  assert.deepEqual(dayCoverage(body).missing_preferences, ["live_music"]);
  assert.deepEqual(body.live_events.tonight[0].matched_preferences, ["live_music"]);
});

test("a higher-ranked concert outside walking reach does not hide a walkable exact match", async t => {
  const body = await plan(t, { events: [distantConcert, concert] });
  assert.deepEqual(body.live_events.tonight.map(row => row.id), ["distant-concert", "quartet"]);
  assert.ok(body.live_events.tonight.every(row => row.route_eligible && row.matched_preferences.includes("live_music")));
  const route = body.days[0].primary_route;
  const stop = route.main_stops.at(-1);
  assert.equal(stop.event_id, "quartet");
  assert.equal(stop.occurrence_date, DATE);
  assert.equal(body.place_structure.district_day.evening_event.live_occurrence_id, stop.live_occurrence_id);
  assert.equal(body.pulse_route_interrupt.event.id, "quartet");
  assert.deepEqual(dayCoverage(body).covered_preferences, ["food", "live_music"]);
});

test("the highest-ranked exact match keeps priority when both concerts fit the walk", async t => {
  const nearbyHeadliner = { ...distantConcert,
    location: { ...concert.location, geo: { latitude: 59.334, longitude: 18.076 } },
  };
  const body = await plan(t, { events: [nearbyHeadliner, concert] });
  assert.deepEqual(body.live_events.tonight.map(row => row.id), ["distant-concert", "quartet"]);
  assert.equal(body.days[0].primary_route.main_stops.at(-1).event_id, "distant-concert");
});

async function composeMusicWithWalkingTarget({ includeQuartet, distanceMode = "soft_target" }) {
  const headliner = { ...distantConcert, location: concert.location };
  const preferences = ["food", "live_music"];
  const live = await collectAnchorEvents({
    anchor, registry, preferences, now: NOW, selectedDate: DATE,
    fetcher: async () => ({ ok: true, json: async () => ({ "@graph": includeQuartet ? [headliner, concert] : [headliner] }) }),
  });
  const attempted = [];
  const walkingRouter = async points => {
    const event = points.at(-1).label;
    if (event === headliner.name || event === concert.name) attempted.push(points.map(point => point.label));
    const legs = points.slice(1).map((point, index) => ({
      from_label: points[index].label, to_label: point.label, estimated_walk_minutes: 10,
      distance_km: index === 0 ? 4 : point.label === headliner.name ? 2 : point.label === concert.name ? 0.3 : 0.1,
    }));
    return { legs, pathPoints: points, source: "osrm", mode: "walking" };
  };
  const composed = await composeAgnosticRouteOutput({
    coords: anchor, baselineResult: { days: [] }, externalRequested: true, openDataLoader: async () => restaurants,
    preferences, date: DATE, todayIsoDate: DATE, trustedTimezone: "Europe/Stockholm",
    clock: () => new Date(NOW), weatherProvider: async () => null, synthesizeVia: "engine",
    eveningEventStructure: weaveEveningEvent(null, live, { selectedDate: DATE, preferences }),
    distanceMode, walkingKmTarget: 4, walkingRouter,
    walkingConfig: { defaultProvider: "osrm", transportMode: "foot" },
  });
  return { ...composed, attempted, headliner };
}

test("the music shortlist tries the next concert when the full walking order exceeds the selected target", async () => {
  const { result, experiment, attempted, headliner } = await composeMusicWithWalkingTarget({ includeQuartet: true });
  assert.equal(experiment.route_mutation, true);
  const route = result.days[0].primary_route;
  assert.equal(route.main_stops.at(-1).event_id, "quartet");
  assert.equal(route.estimated_km, 4.4);
  assert.equal(route.geometry_source, "osrm");
  const publishedOrder = route.map_route_points.map(point => point.label);
  assert.deepEqual(attempted, [[...publishedOrder.slice(0, -1), headliner.name], publishedOrder]);
});

test("a sole automatic concert over the final walking budget leaves the stable day and is not retried in publication", async () => {
  const { result, experiment, eventWeave, attempted, headliner } = await composeMusicWithWalkingTarget({ includeQuartet: false });
  assert.equal(experiment.route_mutation, true);
  const stops = result.days[0].primary_route.main_stops;
  assert.equal(stops.length, 2);
  assert.ok(stops.every(stop => !stop.is_live_event));
  assert.deepEqual(attempted.map(labels => labels.at(-1)), [headliner.name]);
  assert.deepEqual(selectPublishedEventWeave({ promotionPromote: true, eventWeave, publicResult: result }),
    { ...eventWeave, result });
});

test("a no-limit day can weave a concert above the ordinary target tolerance", async () => {
  const { result, attempted } = await composeMusicWithWalkingTarget({ includeQuartet: false, distanceMode: "no_limit" });
  const route = result.days[0].primary_route;
  assert.equal(route.main_stops.at(-1).event_id, "distant-concert");
  assert.equal(route.estimated_km, 6.1);
  assert.deepEqual(attempted, [route.map_route_points.map(point => point.label)]);
});

test("only three ranked performances can request walking validation for one route", async t => {
  const location = distantConcert.location;
  const events = [
    sourceEvent("first-concert", "First concert", "MusicEvent", { location, startDate: `${DATE}T17:00:00+02:00` }),
    sourceEvent("second-concert", "Second concert", "MusicEvent", { location, startDate: `${DATE}T17:30:00+02:00` }),
    distantConcert,
    concert,
  ];
  const attempted = [];
  const walkingRouter = async (points, options) => {
    const last = points.at(-1)?.label;
    if (events.some(event => event.name === last)) attempted.push(last);
    return routeWalkingPath(points, options);
  };
  const body = await plan(t, { events, walkingRouter });
  assert.deepEqual(body.live_events.tonight.map(row => row.id), ["first-concert", "second-concert", "distant-concert", "quartet"]);
  assert.deepEqual(attempted, ["First concert", "Second concert", "Headliner concert"]);
  assert.deepEqual(dayCoverage(body).missing_preferences, ["live_music"]);
  assert.equal(body.place_structure.district_day.evening_event.id, "first-concert");
});

test("a walking transport failure ends the music shortlist without a response retry", async t => {
  const headliner = { ...distantConcert, location: concert.location };
  const attempted = [];
  const walkingRouter = async (points, options) => {
    const last = points.at(-1)?.label;
    if (last === headliner.name || last === concert.name) {
      attempted.push(last);
      if (attempted.length === 1) throw new Error("fixture walking transport unavailable");
    }
    return routeWalkingPath(points, options);
  };
  const body = await plan(t, { events: [headliner, concert], walkingRouter });
  assert.deepEqual(body.live_events.tonight.map(row => row.id), ["distant-concert", "quartet"]);
  assert.deepEqual(attempted, ["Headliner concert"]);
  assert.deepEqual(dayCoverage(body).missing_preferences, ["live_music"]);
});

test("a walkable concert cannot substitute for an explicit Keep outside walking reach", async t => {
  const events = [distantConcert, concert];
  const automatic = await plan(t, { events: [distantConcert] });
  const occurrenceId = automatic.place_structure.district_day.evening_event.live_occurrence_id;
  assert.match(occurrenceId, /^live:/);
  const body = await plan(t, { events, liveEventChoices: [{ occurrence_id: occurrenceId, action: "keep" }] });
  assert.deepEqual(body.days, []);
  assert.ok(body.agnostic_route_output_experiment.eligibility.blockers.includes("live_keep_not_preserved"));
  assert.equal(body.agnostic_route_output_experiment.live_event_choices.honored_count, 0);
  assert.equal(body.live_events.tonight.length, 2);
});

test("the experimental legacy composer also reports coverage only after its final event weave", async t => {
  const views = externalRecord("quay-views", "Quayside lookout", "viewpoint", 59.3301, 18.0701);
  const body = await plan(t, { events: [concert], places: [...restaurants, views],
    preferences: ["food", "views", "live_music"], engine: false });
  assert.equal(body.agnostic_route_output_experiment.route_mutation, true);
  assert.equal(body.days[0].primary_route.main_stops.at(-1).event_id, "quartet");
  assert.deepEqual(dayCoverage(body).covered_preferences, ["food", "scenic", "live_music"]);
});
