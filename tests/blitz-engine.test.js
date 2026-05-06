const test = require("node:test");
const assert = require("node:assert/strict");

const { getCityConfig } = require("../server/cities");
const { buildBlitzDecision, normalizeBlitzMemory } = require("../server/blitz-engine");

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
  assert.equal(result.best_move.availability?.kind, "shop");
  assert.equal(result.best_move.availability?.day_fit, "stable");
  assert.equal(result.best_move.caution_notes.length, 0);
  assert.ok(moveIncludesTag(result.best_move, "second_hand"));
  assert.ok(!moveIncludesTag(result.best_move, "market"));
  assert.ok(result.backup_option);
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

test("Blitz normaliserar trasig klient-memory utan char-level spill eller fel", () => {
  const normalized = normalizeBlitzMemory({
    recent_stop_ids: "porta-portese-market",
    recent_move_kinds: { move: "mini_route_60" },
    recent_area_tokens: 42,
    recent_template_ids: null,
    last_blitz_at: ["bad"],
  });

  assert.deepEqual(normalized.recent_stop_ids, []);
  assert.deepEqual(normalized.recent_move_kinds, []);
  assert.deepEqual(normalized.recent_area_tokens, []);
  assert.deepEqual(normalized.recent_template_ids, []);
  assert.equal(normalized.last_blitz_at, null);
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

test("Blitz låter tid på dagen påverka vilket förslag som känns starkast", async () => {
  const cityConfig = getCityConfig("rome");
  const morning = await buildBlitzDecision(cityConfig, {
    now: "2026-05-12T09:30:00+02:00",
    origin: { type: "preset", label: "Trastevere" },
    intent_keys: ["views"],
  });
  const afternoon = await buildBlitzDecision(cityConfig, {
    now: "2026-05-12T14:30:00+02:00",
    origin: { type: "preset", label: "Trastevere" },
    intent_keys: ["views"],
  });

  assert.notEqual(morning.best_move.title, afternoon.best_move.title);
  assert.match(morning.best_move.title, /San Crisogono/i);
  assert.match(afternoon.best_move.title, /(Les Vignerons|Trastevere|Gianicolo)/i);
});

test("Blitz låter en stark Pulse-signal påverka val och förklaring", async () => {
  const baseCity = getCityConfig("rome");
  const noPulseCity = {
    ...baseCity,
    services: {
      ...baseCity.services,
      getCityPulse() {
        return {
          date: "2026-05-12",
          items: [],
        };
      },
    },
  };
  const pulseCity = {
    ...baseCity,
    services: {
      ...baseCity.services,
      getCityPulse() {
        return {
          date: "2026-05-12",
          items: [
            {
              id: "gianicolo-pulse",
              title: "Golden hour pulls west",
              why_it_matters: "Gianicolo and nearby views are especially good right now.",
              route_hints: {
                preferred_tags: ["utsikt"],
                preferred_area_tokens: ["gianicolo", "trastevere"],
                preferred_macros: ["west"],
                preferred_vibes: ["low_key"],
              },
            },
          ],
        };
      },
    },
  };

  const withoutPulse = await buildBlitzDecision(noPulseCity, {
    now: "2026-05-12T18:45:00+02:00",
    origin: { type: "preset", label: "Trastevere" },
    intent_keys: ["views"],
  });
  const withPulse = await buildBlitzDecision(pulseCity, {
    now: "2026-05-12T18:45:00+02:00",
    origin: { type: "preset", label: "Trastevere" },
    intent_keys: ["views"],
  });

  assert.notEqual(withPulse.best_move.title, withoutPulse.best_move.title);
  assert.equal(withPulse.best_move.title, "Gianicolo");
  assert.equal(withPulse.best_move.pulse_context?.title, "Golden hour pulls west");
  assert.match(withPulse.best_move.why_now, /especially good right now/i);
});
