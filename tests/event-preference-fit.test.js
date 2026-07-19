const assert = require("node:assert/strict");
const test = require("node:test");

const { scoreEventPreferenceFit } = require("../server/pulse-engine/event-preference-fit");

test("structured provider semantics match canonical planner preferences", () => {
  const fit = scoreEventPreferenceFit(
    {
      title: "Saturday programme",
      tags: ["second_hand", "market"],
      intents: ["nightlife"],
      route_role_hint: "market_stop",
    },
    ["second_hand", "nightlife", "food"],
  );

  assert.equal(fit.level, "strong");
  assert.deepEqual(fit.matched_preferences.sort(), ["bars", "second_hand"]);
  assert.deepEqual(fit.partial_preferences, ["food"], "a generic market is only adjacent to food");
  assert.deepEqual(fit.missing_preferences, []);
  assert.ok(fit.reasons.includes("preference_second_hand_structured"));
  assert.ok(fit.reasons.includes("preference_bars_structured"));
});

test("local-language factual titles provide a bounded reusable fallback", () => {
  const flea = scoreEventPreferenceFit(
    { title: "Bakluckeloppis och antikmarknad", tags: [] },
    ["second_hand", "food"],
  );
  assert.deepEqual(flea.matched_preferences, ["second_hand"]);
  assert.equal(flea.score, 3);

  const culture = scoreEventPreferenceFit(
    { title: "Konsert och klubbkväll", tags: [] },
    ["culture", "nightlife"],
  );
  assert.deepEqual(culture.matched_preferences.sort(), ["bars", "museums"]);
  assert.equal(culture.score, 6);
});

test("every public planner interest has a reusable event-semantic path", () => {
  const cases = [
    ["food", "Street food tasting", "food"],
    ["fika", "Kaffeprovning i rosteriet", "coffee"],
    ["green", "Guidad naturvandring", "green"],
    ["views", "Sunset photo walk", "scenic"],
    ["culture", "Vernissage och utstallning", "museums"],
    ["nightlife", "DJ set and club night", "bars"],
    ["second_hand", "Loppmarknad och vintage", "second_hand"],
  ];

  for (const [preference, title, canonical] of cases) {
    const fit = scoreEventPreferenceFit({ title }, [preference]);
    assert.equal(fit.level, "strong", `${preference} should strongly match ${title}`);
    assert.deepEqual(fit.matched_preferences, [canonical]);
  }
});

test("a generic market is only adjacent to second hand, not a fabricated full match", () => {
  const fit = scoreEventPreferenceFit(
    { title: "Sunday market", tags: ["market"] },
    ["second_hand"],
  );
  assert.equal(fit.level, "partial");
  assert.deepEqual(fit.matched_preferences, []);
  assert.deepEqual(fit.partial_preferences, ["second_hand"]);
  assert.equal(fit.score, 1);
});

test("source and publisher labels never mint preference relevance", () => {
  const fit = scoreEventPreferenceFit(
    {
      title: "Open house",
      source_label: "Vintage Flea Market Network",
      provenance: { attribution: "Nightlife and culture publisher" },
    },
    ["second_hand", "nightlife", "culture"],
  );
  assert.equal(fit.level, "none");
  assert.equal(fit.score, 0);
  assert.deepEqual(fit.matched_preferences, []);
});

test("no requested preferences is byte-neutral ranking context", () => {
  const fit = scoreEventPreferenceFit(
    { title: "Loppis and concert", tags: ["second_hand", "music"] },
    [],
  );
  assert.deepEqual(fit, {
    score: 0,
    level: "none",
    requested_preferences: [],
    matched_preferences: [],
    partial_preferences: [],
    missing_preferences: [],
    reasons: [],
  });
});
