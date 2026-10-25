/**
 * The route composer reads a server-injected clock in either shape: a function
 * or an object with now(). An object clock used to be ignored, so the day was
 * composed on the machine's wall date (the product-integration-browser failure
 * after 22:00 Stockholm on 2026-10-22). A clock that cannot be read leaves the
 * local time unknown instead of borrowing wall time.
 */

const assert = require("node:assert/strict");
const test = require("node:test");

const { buildApp } = require("../server/app");
const { readClockInstant, serverInstant } = require("../server/lib/clock");
const { resolveAgnosticContext } = require("../server/planner/agnostic-route-context");
const {
  externalRecord,
  makeLoader,
  requestJson,
  mockStableWeatherFetch,
} = require("./helpers/planner-reservoir-compare");

const ORIGINAL_FETCH = global.fetch;
const FLAG = "experimental_agnostic_route_output=1";
const NOW = "2026-10-16T08:00:00Z";
// Europe/Stockholm is UTC+2 until 2026-10-25.
const LOCAL_NOW = "2026-10-16T10:00:00";
const DATE = "2026-10-16";
const ANCHOR = { lat: 59.3326, lng: 18.0649 };
const WEATHER = {
  condition: "sun", maxTemp: 12, minTemp: 6, apparentTempMax: 11, precipitationProbabilityMax: 5,
  precipitationSum: 0, windSpeedMax: 6, source: "test", stale: false,
  timezone_resolution: { timezone: "Europe/Stockholm", timezone_source: "weather_provider_auto", utc_offset_seconds: 7200 },
};

function fixtureNear(base) {
  const at = (i) => ({ lat: base.lat + (i % 5) * 0.0008, lng: base.lng + Math.floor(i / 5) * 0.0008 });
  return [
    ...Array.from({ length: 8 }, (_, i) => externalRecord(`food-${i}`, `Food ${i}`, "restaurant", at(i).lat, at(i).lng, ["mat"])),
    ...Array.from({ length: 8 }, (_, i) => externalRecord(`cafe-${i}`, `Cafe ${i}`, "cafe", at(i + 2).lat, at(i + 2).lng, ["fika"])),
  ];
}

async function composedTime(clock) {
  global.fetch = mockStableWeatherFetch();
  const server = buildApp({ openDataLoader: makeLoader(fixtureNear(ANCHOR)), weatherProvider: async () => WEATHER, clock }).listen(0);
  try {
    const r = await requestJson(server, {
      path: `/api/route-recommendations?lang=en&${FLAG}`,
      body: { city: "atlantis-unknown-place", dates: [DATE], ...ANCHOR, preferences: ["food", "coffee"], include_external_candidates: 1 },
    });
    assert.equal(r.status, 200);
    return r.body.agnostic_route_output_experiment.context.time;
  } finally {
    await new Promise((resolve) => server.close(resolve));
    global.fetch = ORIGINAL_FETCH;
  }
}

test("readClockInstant accepts a function or an object clock and normalizes what it returns", () => {
  const expected = Date.parse(NOW);
  for (const clock of [
    () => new Date(NOW),
    () => NOW,
    () => expected,
    { now: () => NOW },
    { now: () => new Date(NOW) },
    { now: () => expected },
  ]) {
    assert.equal(readClockInstant(clock).getTime(), expected);
  }
});

test("an injected clock that cannot be read gives no instant; only an absent clock means wall time", () => {
  for (const clock of [{ now: () => { throw new Error("clock down"); } }, { now: () => "not a date" }, () => null, {}]) {
    assert.equal(readClockInstant(clock), null);
  }
  const before = Date.now();
  const wall = readClockInstant(null).getTime();
  assert.ok(wall >= before && wall <= Date.now());
  // Blitz keeps its wall-time fallback for an unreadable clock.
  assert.ok(serverInstant({ now: () => "not a date" }).getTime() >= before);
});

test("resolveAgnosticContext reads an object clock and leaves time unknown when it cannot", async () => {
  const base = { coords: ANCHOR, date: DATE, trustedTimezone: "Europe/Stockholm", weatherProvider: async () => null };
  const read = await resolveAgnosticContext({ ...base, clock: { now: () => NOW } });
  assert.equal(read.now, LOCAL_NOW);
  assert.equal(read.contextBlock.time.requested_date_is_today, true);

  const unreadable = await resolveAgnosticContext({ ...base, clock: { now: () => { throw new Error("clock down"); } } });
  assert.equal(unreadable.timezoneKnown, true);
  assert.equal(unreadable.now, null, "an unreadable clock must not fall back to the wall clock");
});

test("/api/route-recommendations composes on an object clock's date, the same as on a function clock", async () => {
  const objectTime = await composedTime({ now: () => NOW });
  assert.equal(objectTime.timezone, "Europe/Stockholm");
  assert.equal(objectTime.now, LOCAL_NOW, "the composition must use the controlled clock, not the wall date");
  assert.equal(objectTime.requested_date_is_today, true);
  assert.equal(objectTime.status, "resolved");

  const functionTime = await composedTime(() => new Date(NOW));
  assert.deepEqual(objectTime, functionTime);
});
