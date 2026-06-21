/**
 * Preference-driven composition for thin PREVIEW Planner cities.
 *
 * A recognized preview city (Athens) runs the registered-city preview-beta path
 * through `generateRecommendations` with a `cityConfigOverride` — NOT the
 * any-place route-output path. Before this change, stop selection there was
 * geometry/anchor dominated, so different preference sets collapsed to nearly the
 * same `primary_route.main_stops`. Now the shared candidate reservoir's fit
 * verdict drives selection: different preferences produce meaningfully different
 * routes, each preference is preserved end-to-end (or honestly reported missing),
 * and a dense off-intent source pack can no longer leak into an unrelated day.
 *
 * Athens is the preview-thin FIXTURE, not a hardcoded target — every assertion
 * is on generic preview behavior (visibility:"preview" + thin density). No live
 * network: the preview-beta auto-path uses Athens' own catalog + the #302
 * second-hand source pack, no loader required.
 */

const assert = require("node:assert/strict");
const test = require("node:test");

const { buildApp } = require("../server/app");
const { requestJson, mockStableWeatherFetch } = require("./helpers/planner-reservoir-compare");

const ORIGINAL_FETCH = global.fetch;
const DATE = "2026-06-22";

function withServer(run, { openDataLoader = null } = {}) {
  return async () => {
    global.fetch = mockStableWeatherFetch();
    const server = buildApp({ openDataLoader }).listen(0);
    try {
      await run(server);
    } finally {
      await new Promise((resolve) => server.close(resolve));
      global.fetch = ORIGINAL_FETCH;
    }
  };
}

async function athensRoute(server, preferences, extra = {}) {
  const response = await requestJson(server, {
    path: "/api/route-recommendations?lang=en",
    body: { city: "athens", dates: [DATE], preferences, ...extra },
  });
  const day = response.body.days && response.body.days[0];
  const stops = day && day.primary_route ? day.primary_route.main_stops || [] : [];
  return { body: response.body, stops };
}

// Does any stop express this intent — by tag OR type token? (Semantic, so the
// test does not hardcode citypack ids.)
function someStopMatches(stops, tokens, types = []) {
  return stops.some((stop) => {
    const tags = (stop.tags || []).map((t) => String(t).toLowerCase());
    const type = String(stop.type || "").toLowerCase();
    return tokens.some((t) => tags.includes(t)) || types.some((t) => type.includes(t));
  });
}

function signature(stops) {
  return stops.map((s) => s.id).join(",");
}

// --- 1. Different preferences → meaningfully different routes ----------------

test(
  "Athens preview route differs across preference sets (≥4 distinct)",
  withServer(async (server) => {
    const sets = [["second_hand"], ["utsikt"], ["kultur"], ["kväll"], ["fika"]];
    const signatures = [];
    for (const prefs of sets) {
      const { stops } = await athensRoute(server, prefs);
      assert.ok(stops.length > 0, `expected stops for ${JSON.stringify(prefs)}`);
      signatures.push(signature(stops));
    }
    const distinct = new Set(signatures);
    assert.ok(
      distinct.size >= 4,
      `expected ≥4 distinct routes, got ${distinct.size}: ${JSON.stringify(signatures)}`,
    );
  }),
);

// --- 2. Each preference is preserved end-to-end -----------------------------

test(
  "second_hand surfaces the #302 source pack / flea spine, not generic shopping",
  withServer(async (server) => {
    const { stops } = await athensRoute(server, ["second_hand"]);
    assert.ok(
      someStopMatches(stops, ["second_hand", "vintage", "flea", "thrift", "antique"], ["vintage", "flea"]),
      `second_hand produced no second-hand stop: ${signature(stops)}`,
    );
    // Must NOT collapse to a generic shopping/landmark day: the second-hand
    // intent should dominate, not appear as a lone token in an unrelated route.
    const secondHandCount = stops.filter((s) =>
      (s.tags || []).map((t) => String(t).toLowerCase()).includes("second_hand"),
    ).length;
    assert.ok(secondHandCount >= 2, `expected a second-hand-led day, got ${secondHandCount}`);
  }),
);

test(
  "fika surfaces a café/coffee stop",
  withServer(async (server) => {
    const { stops } = await athensRoute(server, ["fika"]);
    assert.ok(
      someStopMatches(stops, ["fika", "coffee", "cafe"], ["cafe"]),
      `fika produced no café stop: ${signature(stops)}`,
    );
  }),
);

test(
  "utsikt surfaces a scenic/view/hill/park stop",
  withServer(async (server) => {
    const { stops } = await athensRoute(server, ["utsikt"]);
    assert.ok(
      someStopMatches(stops, ["utsikt", "scenic", "view", "grönt", "waterfront"], ["viewpoint", "park", "hill"]),
      `utsikt produced no scenic stop: ${signature(stops)}`,
    );
  }),
);

test(
  "kultur surfaces a cultural/museum/gallery stop",
  withServer(async (server) => {
    const { stops } = await athensRoute(server, ["kultur"]);
    assert.ok(
      someStopMatches(stops, ["kultur", "museum", "gallery", "art"], ["museum", "gallery", "cultural"]),
      `kultur produced no cultural stop: ${signature(stops)}`,
    );
  }),
);

test(
  "kväll surfaces an evening/bar/nightlife stop",
  withServer(async (server) => {
    const { stops } = await athensRoute(server, ["kväll"]);
    assert.ok(
      someStopMatches(stops, ["kväll", "nattliv", "evening", "bar", "nightlife"], ["bar"]),
      `kväll produced no evening stop: ${signature(stops)}`,
    );
  }),
);

// --- 3. Missing preference is surfaced honestly, not silently faked ----------

test(
  "an unsatisfiable preference is reported missing, not filled with an off-intent pack",
  withServer(async (server) => {
    // Athens has no curated coast and no loader here → swimming cannot be filled.
    const { body, stops } = await athensRoute(server, ["swimming"]);
    assert.ok(body.preference_coverage, "expected preference_coverage on the response");
    assert.deepEqual(body.preference_coverage.missing, ["swimming"]);
    // It must NOT silently fall back to the dense second-hand pack just because
    // that pack is the city's biggest provisional supply.
    const leakedSecondHand = stops.filter((s) =>
      (s.tags || []).map((t) => String(t).toLowerCase()).includes("second_hand"),
    );
    assert.equal(
      leakedSecondHand.length,
      0,
      `off-intent second-hand pack leaked into a missing-preference day: ${signature(stops)}`,
    );
  }),
);

test(
  "a satisfiable + an unsatisfiable preference: one route-shaping, the other reported partial/missing",
  withServer(async (server) => {
    const { body, stops } = await athensRoute(server, ["second_hand", "swimming"]);
    assert.deepEqual(body.preference_coverage.covered, ["second_hand"]);
    assert.deepEqual(body.preference_coverage.missing, ["swimming"]);
    assert.ok(
      someStopMatches(stops, ["second_hand", "vintage", "flea"], ["vintage", "flea"]),
      `second_hand was not route-shaping: ${signature(stops)}`,
    );
  }),
);

// --- 4. Trust + honesty markers preserved -----------------------------------

test(
  "source-backed stops stay provisional / needs_review / not human-verified — no fake claims",
  withServer(async (server) => {
    const { stops } = await athensRoute(server, ["second_hand"]);
    const provisional = stops.filter((s) => s.provisional === true);
    assert.ok(provisional.length > 0, "expected provisional source-backed stops");
    for (const stop of provisional) {
      assert.equal(stop.trust.human_verified, false);
      assert.equal(stop.trust.confidence, "needs_review");
      assert.equal(stop.trust.source_tier, "inferred");
      // No fabricated arrival/opening/walking claims smuggled onto the stop.
      assert.equal(stop.eta, undefined);
      assert.equal(stop.opening_hours, undefined);
      assert.equal(stop.walking_minutes, undefined);
    }
  }),
);

// --- 5. Public payload cannot inject candidates -----------------------------

test(
  "a fabricated place in the request payload never enters the route",
  withServer(async (server) => {
    const poison = {
      sourceCandidates: [
        { id: "athens-poison-injected", label: "Poison", type: "vintage-shop", lat: 37.98, lng: 23.72, tags: ["second_hand"] },
      ],
      candidates: [{ id: "athens-poison-injected", tags: ["second_hand"] }],
      places: [{ id: "athens-poison-injected" }],
    };
    const { stops } = await athensRoute(server, ["second_hand"], poison);
    assert.ok(
      !stops.some((s) => String(s.id).includes("poison")),
      `public-payload candidate leaked into the route: ${signature(stops)}`,
    );
    // The trusted reservoir still drove a real second-hand day.
    assert.ok(someStopMatches(stops, ["second_hand", "vintage", "flea"], ["vintage", "flea"]));
  }),
);

// --- 6. Rich citypacks are untouched ----------------------------------------

for (const city of ["rome", "barcelona"]) {
  test(
    `rich citypack ${city} is not preference-composed (no preview coverage, route intact)`,
    withServer(async (server) => {
      const response = await requestJson(server, {
        path: "/api/route-recommendations?lang=en",
        body: { city, dates: [DATE], preferences: ["second_hand"] },
      });
      assert.equal(response.body.preference_coverage, undefined, `${city} must not emit preview preference coverage`);
      assert.ok(response.body.days && response.body.days[0].primary_route.main_stops.length > 0);
    }),
  );
}

// --- 7. No-preferences preview behavior is unchanged ------------------------

test(
  "a no-preference preview request keeps pre-existing behavior (no coverage gate)",
  withServer(async (server) => {
    const { body, stops } = await athensRoute(server, []);
    assert.equal(body.preference_coverage, undefined, "no preferences → no coverage gate, no fit map");
    assert.ok(stops.length > 0, "a no-preference preview day still composes");
  }),
);
