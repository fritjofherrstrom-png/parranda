// Blitz reroll variety: the recent-stop memory penalty must move the decision
// through the available candidate pool instead of locking onto one dominant
// place in a thin time band (the "same result every reroll" bug).
const assert = require("node:assert/strict");
const test = require("node:test");

const { buildApp } = require("../server/app");
const { requestJson, mockStableWeatherFetch } = require("./helpers/planner-reservoir-compare");

const originalFetch = global.fetch;
test.before(() => {
  global.fetch = mockStableWeatherFetch();
});
test.after(() => {
  global.fetch = originalFetch;
});

function withServer(run) {
  return async () => {
    const server = buildApp().listen(0);
    await new Promise((resolve) => server.once("listening", resolve));
    try {
      await run(server);
    } finally {
      server.close();
    }
  };
}

async function rerollTitles(server, body, count) {
  let memory = null;
  const titles = [];
  for (let i = 0; i < count; i += 1) {
    const res = await requestJson(server, { path: "/api/blitz?lang=en", body: { ...body, memory } });
    titles.push((res.body.best_move && res.body.best_move.title) || null);
    memory = res.body.memory;
  }
  return titles;
}

function backToBackRepeats(titles) {
  let count = 0;
  for (let i = 1; i < titles.length; i += 1) {
    if (titles[i] && titles[i] === titles[i - 1]) count += 1;
  }
  return count;
}

test(
  "reroll never repeats back-to-back, even when one place dominates a thin time band (Athens evening)",
  withServer(async (server) => {
    // Evening + nightlife is exactly the case that used to lock onto one place.
    const titles = await rerollTitles(
      server,
      { city: "athens", lat: 37.9685, lng: 23.7257, preferences: ["mat", "fika", "kväll"], now: "2026-06-22T19:00:00Z" },
      8,
    );
    assert.equal(backToBackRepeats(titles), 0, `reroll must not repeat back-to-back: ${JSON.stringify(titles)}`);
    assert.ok(new Set(titles).size >= 6, `reroll must move through the pool: ${JSON.stringify(titles)}`);
  }),
);

test(
  "reroll variety holds for a rich city too (Rome) — the fix is generic, not city-specific",
  withServer(async (server) => {
    const titles = await rerollTitles(
      server,
      { city: "rome", lat: 41.9, lng: 12.49, preferences: ["mat", "kultur"], now: "2026-06-22T13:00:00Z" },
      6,
    );
    assert.equal(backToBackRepeats(titles), 0);
    assert.ok(titles.every(Boolean), "every Rome reroll still produces a move");
  }),
);
