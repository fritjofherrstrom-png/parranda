const test = require("node:test");
const assert = require("node:assert/strict");

const { getCityConfig } = require("../server/cities");
const {
  createEmptyLocalTruthEffect,
  evaluateLocalTruth,
  resolveActiveCalendarEntries,
} = require("../server/local-truth");

function buildRouteStops(cityKey, names) {
  const cityConfig = getCityConfig(cityKey);
  return names.map((name) => cityConfig.catalog.findItemByName(name)).filter(Boolean);
}

function buildRouteFromStops(id, title, routeStops) {
  return {
    id,
    title,
    main_stops: routeStops.map((stop) => ({
      id: stop.id,
      label: stop.name,
      tags: stop.tags,
    })),
  };
}

test("empty local truth effect returns the neutral normalized shape", () => {
  assert.deepEqual(createEmptyLocalTruthEffect(), {
    score_adjustments: [],
    caution_notes: [],
    verify_opening_hours: [],
    route_context_notes: [],
    live_context_notes: [],
    prefer_tags: [],
    avoid_tags: [],
    score_delta: 0,
  });
});

test("recurring month/day calendar entries resolve for active dates", () => {
  const rome = getCityConfig("rome");
  const activeEntries = resolveActiveCalendarEntries("2026-08-15", rome.localTruth.calendar);

  assert.equal(activeEntries.length, 1);
  assert.equal(activeEntries[0].id, "rome-ferragosto");
});

test("Rome Monday culture rule emits normalized risk effects", () => {
  const rome = getCityConfig("rome");
  const routeStops = buildRouteStops("rome", [
    "Centrale Montemartini",
    "Museum of Rome in Trastevere",
    "San Clemente",
    "Gianicolo",
  ]);
  const route = buildRouteFromStops("rome-monday-culture", "Rome Monday Culture", routeStops);

  const effect = evaluateLocalTruth(rome, {
    date: "2026-04-20",
    route,
    routeStops,
    template: { id: "rome-monday-culture", preferenceTags: ["kultur"] },
    preferences: ["kultur", "hidden gems"],
    optimizerMode: "culture-mode",
    liveEvents: [],
  });

  assert.ok(effect.score_adjustments.some((entry) => entry.rule_id === "rome-monday-culture-risk"));
  assert.ok(effect.caution_notes.some((entry) => entry.rule_id === "rome-monday-culture-risk"));
  assert.ok(
    effect.verify_opening_hours.some((entry) => entry.rule_id === "rome-monday-culture-risk"),
  );
  assert.ok(effect.prefer_tags.includes("kyrkor"));
  assert.ok(effect.prefer_tags.includes("utsikt"));
  assert.ok(effect.avoid_tags.includes("museum"));
  assert.ok(effect.score_delta < 0);
});

test("Rome crowd suitability rule emits contextual midday caution without a hard ban", () => {
  const rome = getCityConfig("rome");
  const routeStops = buildRouteStops("rome", ["Colosseum", "Piazza Navona", "San Clemente"]);
  const route = buildRouteFromStops("rome-classics", "Rome Classics", routeStops);

  const effect = evaluateLocalTruth(rome, {
    date: "2026-04-22",
    route,
    routeStops,
    template: { id: "rome-classics", preferenceTags: ["klassiker", "kultur"] },
    preferences: ["kultur", "utsikt"],
    liveEvents: [],
  });

  assert.ok(
    effect.score_adjustments.some((entry) => entry.rule_id === "rome-classics-crowd-suitability"),
  );
  assert.ok(
    effect.route_context_notes.some(
      (entry) =>
        entry.rule_id === "rome-classics-crowd-suitability" &&
        /tidigt eller sent/i.test(entry.text),
    ),
  );
  assert.equal(
    effect.caution_notes.some((entry) => entry.rule_id === "rome-classics-crowd-suitability"),
    false,
  );
});

test("Rome Ferragosto rule emits cautious holiday effects without certainty wording", () => {
  const rome = getCityConfig("rome");
  const routeStops = buildRouteStops("rome", ["Centrale Montemartini", "Gianicolo", "Piazza Navona"]);
  const route = buildRouteFromStops("rome-ferragosto", "Rome Ferragosto", routeStops);

  const effect = evaluateLocalTruth(rome, {
    date: "2026-08-15",
    route,
    routeStops,
    template: { id: "rome-ferragosto", preferenceTags: ["kultur", "utsikt"] },
    preferences: ["kultur", "hidden gems"],
    liveEvents: [],
  });

  assert.ok(effect.verify_opening_hours.some((entry) => entry.rule_id === "rome-ferragosto-rhythm"));
  assert.ok(effect.caution_notes.some((entry) => entry.rule_id === "rome-ferragosto-rhythm"));
  assert.ok(effect.live_context_notes.some((entry) => entry.rule_id === "rome-ferragosto-rhythm"));
  assert.ok(effect.score_delta < 0);
  assert.ok(
    effect.caution_notes.every(
      (entry) => !/är stängt|är stängda|kommer vara stängt|kommer vara stängda/i.test(entry.text),
    ),
  );
});
