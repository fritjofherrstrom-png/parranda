const test = require("node:test");
const assert = require("node:assert/strict");

const { summarizeAvailability } = require("../server/availability");
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

function buildSyntheticAvailabilityStop(name, availability, tags = ["second_hand"]) {
  return {
    id: name.toLowerCase().replace(/\s+/g, "-"),
    name,
    kind: "synthetic-stop",
    tags,
    closedWeekdays: [],
    availability,
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

test("availability summary is reusable and does not depend on Rome-specific names", () => {
  const summary = summarizeAvailability(
    [
      buildSyntheticAvailabilityStop("Alpha Weekend Market", {
        kind: "event_market",
        strongWeekdays: [0],
        weakWeekdays: [1, 2, 3, 4, 5, 6],
        daySensitivity: "high",
        note: "Strongest on Sundays.",
        verifyRecommended: true,
      }),
      buildSyntheticAvailabilityStop("Beta Vintage Shop", {
        kind: "shop",
        daySensitivity: "low",
        verifyRecommended: false,
      }),
    ],
    0,
  );

  assert.equal(summary.marketStyleStops.length, 1);
  assert.equal(summary.shopStops.length, 1);
  assert.equal(summary.strongMarketStops.length, 1);
  assert.equal(summary.weakMarketStops.length, 0);
  assert.equal(summary.verifyRecommendedStops.length, 1);
  assert.equal(summary.hasShopFallback, true);
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

test("Rome market availability rule boosts strong market days without needing Rome names in generic logic", () => {
  const rome = getCityConfig("rome");
  const routeStops = buildRouteStops("rome", ["Trastevere", "Porta Portese Market", "Ponte Sisto"]);
  const route = buildRouteFromStops("rome-market-sunday", "Rome Market Sunday", routeStops);

  const effect = evaluateLocalTruth(rome, {
    date: "2026-05-10",
    route,
    routeStops,
    template: { id: "rome-market-sunday", preferenceTags: ["second_hand", "market", "shopping"] },
    preferences: ["second_hand", "vin", "low-key"],
    liveEvents: [],
  });

  assert.ok(
    effect.score_adjustments.some(
      (entry) => entry.rule_id === "rome-day-sensitive-market-availability" && entry.delta > 0,
    ),
  );
  assert.ok(
    effect.route_context_notes.some(
      (entry) =>
        entry.rule_id === "rome-day-sensitive-market-availability" && /stark veckodag/i.test(entry.text),
    ),
  );
  assert.ok(
    effect.verify_opening_hours.some(
      (entry) => entry.rule_id === "rome-day-sensitive-market-availability",
    ),
  );
});

test("Rome market availability rule softens weak market days without blocking shop-based second hand", () => {
  const rome = getCityConfig("rome");
  const marketRouteStops = buildRouteStops("rome", ["Trastevere", "Porta Portese Market", "Ponte Sisto"]);
  const marketRoute = buildRouteFromStops("rome-market-weekday", "Rome Market Weekday", marketRouteStops);
  const marketEffect = evaluateLocalTruth(rome, {
    date: "2026-05-13",
    route: marketRoute,
    routeStops: marketRouteStops,
    template: { id: "rome-market-weekday", preferenceTags: ["second_hand", "market", "shopping"] },
    preferences: ["second_hand", "vin", "low-key"],
    liveEvents: [],
  });

  const shopRouteStops = buildRouteStops("rome", ["Monti", "Humana Vintage Monti", "Pifebo Vintage Shop"]);
  const shopRoute = buildRouteFromStops("rome-shop-weekday", "Rome Shop Weekday", shopRouteStops);
  const shopEffect = evaluateLocalTruth(rome, {
    date: "2026-05-13",
    route: shopRoute,
    routeStops: shopRouteStops,
    template: { id: "rome-shop-weekday", preferenceTags: ["second_hand", "vintage", "shopping"] },
    preferences: ["second_hand", "vin", "low-key"],
    liveEvents: [],
  });

  assert.ok(marketEffect.score_delta < 0);
  assert.ok(
    marketEffect.caution_notes.some(
      (entry) =>
        entry.rule_id === "rome-day-sensitive-market-availability" && /dubbelkolla|veckodagen/i.test(entry.text),
    ),
  );
  assert.ok(
    marketEffect.verify_opening_hours.some(
      (entry) => entry.rule_id === "rome-day-sensitive-market-availability",
    ),
  );
  assert.ok(shopEffect.score_delta > 0);
  assert.ok(
    shopEffect.route_context_notes.some(
      (entry) =>
        entry.rule_id === "rome-day-sensitive-market-availability" && /butiker|vintage-stopp/i.test(entry.text),
    ),
  );
});
