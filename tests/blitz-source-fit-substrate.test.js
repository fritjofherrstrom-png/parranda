// Source-fit Blitz substrate: for preview/thin/agnostic contexts the editorial
// Blitz decision is made by the shared candidate spine (intent → fit → source
// priority). Curated wins comparable fit; source-backed wins when it better
// satisfies the intent. Output stays the editorial format (title/why_now/route).
const assert = require("node:assert/strict");
const test = require("node:test");

const { buildBlitzDecision } = require("../server/blitz-engine");
const { buildApp } = require("../server/app");
const { getCityConfig } = require("../server/cities");
const {
  externalRecord,
  makeLoader,
  requestJson,
  mockStableWeatherFetch,
} = require("./helpers/planner-reservoir-compare");

const originalFetch = global.fetch;
test.before(() => {
  global.fetch = mockStableWeatherFetch();
});
test.after(() => {
  global.fetch = originalFetch;
});

const NEAR = { lat: 37.9685, lng: 23.7257 };

function spineDecision(preferences, dataset, extra = {}) {
  return buildBlitzDecision(
    getCityConfig("athens"),
    {
      spine_ranking: 1,
      include_external_candidates: 1,
      date: "2026-06-22",
      now: "2026-06-22T13:00:00Z",
      origin: NEAR,
      preferences,
      ...extra,
    },
    dataset ? { external_provider: { dataset } } : {},
  );
}

test("source-backed candidate WINS when it better satisfies an intent curated does not cover", async () => {
  // Athens has no curated beach near the centre; a source-backed beach must win.
  const out = await spineDecision(
    ["swimming"],
    [externalRecord("osm-beach", "Faliro Bay Beach", "beach", 37.9355, 23.69, ["swimming", "beach", "utsikt"])],
  );
  assert.ok(out.best_move, "a move is produced");
  assert.match(out.best_move.title, /Faliro|Beach/i, "the source-backed beach won on better fit");
  // Editorial output shape is preserved (frontend renders this unchanged).
  assert.ok(typeof out.best_move.why_now === "string", "editorial why_now present");
  assert.ok(["single_stop", "mini_route_60"].includes(out.best_move.kind));
});

test("curated wins when fit is comparable (food) — source-backed does not displace the curated spine", async () => {
  const out = await spineDecision(
    ["mat"],
    [externalRecord("osm-grill", "Generic Grill", "restaurant", 37.9686, 23.7258, ["mat"])],
  );
  assert.ok(out.best_move);
  assert.doesNotMatch(out.best_move.title, /generic grill/i, "a comparably-fitting source-backed pick must not beat curated");
});

test("second_hand does not collapse to generic shopping — a real second-hand place wins", async () => {
  const out = await spineDecision(["second_hand"], [
    externalRecord("osm-vintage", "Monastiraki Vintage", "vintage-shop", 37.9686, 23.7259, ["second_hand", "vintage"]),
  ]);
  assert.ok(out.best_move);
  // Either the curated flea market or the source-backed vintage — but a genuine
  // second-hand match, never a generic shop.
  assert.match(
    JSON.stringify(out.best_move).toLowerCase(),
    /second_hand|vintage|flea|market/,
    "second_hand resolves to a real second-hand place",
  );
});

// --- API-level gating ------------------------------------------------------

function withServer(openDataLoader, run) {
  return async () => {
    const server = buildApp({ openDataLoader }).listen(0);
    await new Promise((resolve) => server.once("listening", resolve));
    try {
      await run(server);
    } finally {
      server.close();
    }
  };
}

test(
  "Athens preview Blitz routes through the spine without manual flags and keeps editorial output",
  withServer(
    makeLoader([externalRecord("osm-beach", "Faliro Bay Beach", "beach", 37.9355, 23.69, ["swimming"])]),
    async (server) => {
      const res = await requestJson(server, {
        path: "/api/blitz?lang=en",
        body: { city: "athens", lat: 37.9685, lng: 23.7257, preferences: ["swimming"] },
      });
      assert.ok(res.body.best_move && typeof res.body.best_move.title === "string");
      assert.ok(typeof res.body.best_move.why_now === "string", "editorial format preserved through the API");
    },
  ),
);

test(
  "rich citypacks (Rome) never use spine_ranking and never surface source-backed candidates",
  withServer(makeLoader([externalRecord("osm-x", "Source X", "cafe", 41.9, 12.49, ["fika"])]), async (server) => {
    const res = await requestJson(server, {
      path: "/api/blitz?lang=en",
      body: { city: "rome", lat: 41.9, lng: 12.49, preferences: ["fika"] },
    });
    assert.ok(res.body.best_move, "Rome still produces a move");
    assert.doesNotMatch(JSON.stringify(res.body.best_move).toLowerCase(), /source x|osm-x/, "no source-backed leak into a rich citypack");
  }),
);

test(
  "public payload cannot inject source candidates into the Athens spine Blitz",
  withServer(null, async (server) => {
    const res = await requestJson(server, {
      path: "/api/blitz?lang=en",
      body: {
        city: "athens",
        lat: 37.9685,
        lng: 23.7257,
        preferences: ["mat"],
        sourceCandidates: [{ id: "evil-injected", label: "Injected", lat: 37.97, lng: 23.72 }],
      },
    });
    assert.ok(res.body.best_move);
    assert.doesNotMatch(JSON.stringify(res.body.best_move).toLowerCase(), /evil-injected|injected/, "payload-injected candidate must never reach the move");
  }),
);
