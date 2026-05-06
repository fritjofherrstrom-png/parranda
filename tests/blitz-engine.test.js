const test = require("node:test");
const assert = require("node:assert/strict");

const { getCityConfig } = require("../server/cities");
const { buildBlitzDecision } = require("../server/blitz-engine");

function collectMoveStops(move) {
  if (!move) {
    return [];
  }

  if (move.kind === "mini_route_60") {
    return Array.isArray(move.route?.stops) ? move.route.stops : [];
  }

  return move.stop ? [move.stop] : [];
}

function moveIncludesTag(move, tag) {
  return collectMoveStops(move).some((stop) => Array.isArray(stop.tags) && stop.tags.includes(tag));
}

test("Blitz kan yta ett riktigt second hand-spår på stark marknadsdag i Rom", async () => {
  const cityConfig = getCityConfig("rome");
  const result = await buildBlitzDecision(cityConfig, {
    now: "2026-05-10T10:30:00+02:00",
    origin: { type: "preset", label: "Trastevere" },
    intent_keys: ["second_hand"],
  });

  assert.ok(result.best_move);
  assert.ok(
    moveIncludesTag(result.best_move, "second_hand") ||
      moveIncludesTag(result.backup_option, "second_hand"),
  );
  assert.equal(result.best_move.availability?.day_fit, "strong");
  assert.ok(result.best_move.local_truth.score_delta > 0);
});

test("Blitz behandlar svag marknadsdag försiktigt men håller shop/vintage-spåret levande", async () => {
  const cityConfig = getCityConfig("rome");
  const result = await buildBlitzDecision(cityConfig, {
    now: "2026-05-11T14:30:00+02:00",
    origin: { type: "preset", label: "Trastevere" },
    intent_keys: ["second_hand"],
  });

  assert.ok(result.best_move);
  assert.equal(result.best_move.availability?.day_fit, "weak");
  assert.ok(result.best_move.caution_notes.length >= 1);
  assert.ok(moveIncludesTag(result.best_move, "second_hand"));
  assert.equal(result.backup_option.availability?.kind, "shop");
  assert.equal(result.backup_option.availability?.day_fit, "stable");
});

test("Blitz reroll undviker att direkt upprepa samma förslag", async () => {
  const cityConfig = getCityConfig("rome");
  const first = await buildBlitzDecision(cityConfig, {
    now: "2026-05-12T19:10:00+02:00",
    origin: { type: "preset", label: "Trastevere" },
    intent_keys: ["food_drink", "nightlife"],
  });
  const second = await buildBlitzDecision(cityConfig, {
    now: "2026-05-12T19:10:00+02:00",
    origin: { type: "preset", label: "Trastevere" },
    intent_keys: ["food_drink", "nightlife"],
    memory: first.memory,
  });

  assert.ok(first.best_move);
  assert.ok(second.best_move);
  assert.notEqual(second.best_move.title, first.best_move.title);
});

test("Blitz kan tvingas till en kompakt 60-minuters mini-rutt", async () => {
  const cityConfig = getCityConfig("rome");
  const result = await buildBlitzDecision(cityConfig, {
    now: "2026-05-12T20:30:00+02:00",
    origin: { type: "preset", label: "Trastevere" },
    intent_keys: ["food_drink", "nightlife"],
    mode: "mini_route_60",
  });

  assert.equal(result.best_move.kind, "mini_route_60");
  assert.ok(result.best_move.route.duration_minutes >= 35);
  assert.ok(result.best_move.route.duration_minutes <= 85);
  assert.ok(result.best_move.route.stops.length >= 2);
});

test("Blitz håller test-city neutral och ärlig när second hand-täckning saknas", async () => {
  const cityConfig = getCityConfig("test-city");
  const result = await buildBlitzDecision(cityConfig, {
    date: "2026-05-11",
    origin: { type: "preset", label: "Old Town" },
    intent_keys: ["second_hand"],
  });

  assert.match(result.context.coverage_note || "", /fullt second hand-pack/i);
  assert.equal(result.best_move.local_truth.score_delta, 0);
  assert.equal(result.best_move.pulse_context, null);
  assert.ok(!JSON.stringify(result).includes("Trastevere"));
});

test("Blitz låter tid på dagen påverka tonen i nästa förslag", async () => {
  const cityConfig = getCityConfig("rome");
  const midday = await buildBlitzDecision(cityConfig, {
    now: "2026-05-12T12:30:00+02:00",
    origin: { type: "preset", label: "Trastevere" },
    intent_keys: ["food_drink", "nightlife"],
  });
  const evening = await buildBlitzDecision(cityConfig, {
    now: "2026-05-12T20:30:00+02:00",
    origin: { type: "preset", label: "Trastevere" },
    intent_keys: ["food_drink", "nightlife"],
  });

  assert.notEqual(midday.best_move.why_now, evening.best_move.why_now);
  assert.match(evening.best_move.why_now, /kväll/i);
});
