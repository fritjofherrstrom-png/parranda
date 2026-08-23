"use strict";

/**
 * Every date runs the whole recommendation flow once, inside one HTTP request.
 * Measured on staging before this bound: one date took 3.3s and thirty took
 * 315s — steeply growing rather than linear (thirty times the single-date cost
 * would have been 99s), so one unauthenticated request could hold the event
 * loop for minutes and there was no ceiling on how far that went.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  MAX_REQUESTED_DATES,
  MAX_RAW_REQUESTED_DATES,
  isRealIsoDate,
  parseRequestedDates,
} = require("../server/planner/requested-dates");

const { buildApp } = require("../server/app");
const {
  externalRecord,
  makeLoader,
  requestJson,
  mockStableWeatherFetch,
} = require("./helpers/planner-reservoir-compare");

test("the shipped contract is one day, and it still works", () => {
  assert.deepEqual(parseRequestedDates(["2026-08-23"]), { ok: true, dates: ["2026-08-23"] });
  // Absent or empty is not an error — plenty of callers legitimately omit it.
  assert.deepEqual(parseRequestedDates(undefined), { ok: true, dates: [] });
  assert.deepEqual(parseRequestedDates([]), { ok: true, dates: [] });
});

test("more days than the contract covers is refused, never trimmed", () => {
  const result = parseRequestedDates(["2026-08-23", "2026-08-24"]);
  assert.equal(result.ok, false);
  assert.equal(result.error, "too_many_dates");
  // The refusal must not hand back a shortened list that a caller could mistake
  // for success — returning one day when two were asked for is a quiet lie.
  assert.equal("dates" in result, false);
});

test("the raw array is bounded before de-duplication", () => {
  // Otherwise a payload of ten thousand copies of one date collapses to
  // something that looks reasonable, having already been walked and hashed.
  const flood = Array.from({ length: MAX_RAW_REQUESTED_DATES + 1 }, () => "2026-08-23");
  const result = parseRequestedDates(flood);
  assert.equal(result.ok, false);
  assert.equal(result.error, "too_many_dates");
  assert.match(result.detail, new RegExp(`at most ${MAX_RAW_REQUESTED_DATES} entries`));
});

test("only real calendar dates are accepted", () => {
  // ISO-SHAPED is not the same as real: both of these match the pattern and
  // neither exists, and a non-existent date reaches the engine as a silent
  // fallback rather than an error.
  assert.equal(isRealIsoDate("2026-02-31"), false);
  assert.equal(isRealIsoDate("2026-13-01"), false);
  assert.equal(isRealIsoDate("2026-02-28"), true);
  assert.equal(isRealIsoDate("2028-02-29"), true, "a real leap day");
  assert.equal(isRealIsoDate("2027-02-29"), false, "not a leap year");

  for (const bad of [["2026-13-01"], ["23/08/2026"], ["2026-8-3"], [""], [null], [{}], [12345]]) {
    const result = parseRequestedDates(bad);
    assert.equal(result.ok, false, `${JSON.stringify(bad)} must be refused`);
    assert.equal(result.error, "invalid_dates");
  }
});

test("a non-array is refused rather than coerced", () => {
  assert.equal(parseRequestedDates("2026-08-23").ok, false);
  assert.equal(parseRequestedDates({ 0: "2026-08-23" }).ok, false);
});

// --------------------------------------------------------------------------
// The bound is only worth anything at the boundary itself.
// --------------------------------------------------------------------------

const ORIGINAL_FETCH = global.fetch;
const loader = () =>
  makeLoader([
    externalRecord("food-0", "Food 0", "restaurant", 41.9, 12.49, ["mat"]),
    externalRecord("cafe-0", "Cafe 0", "cafe", 41.9008, 12.49, ["fika"]),
    externalRecord("view-0", "View 0", "viewpoint", 41.9012, 12.4906, ["utsikt"]),
  ]);

function withServer(run) {
  return async () => {
    global.fetch = mockStableWeatherFetch();
    const server = buildApp({ openDataLoader: loader() }).listen(0);
    try {
      await run(server);
    } finally {
      await new Promise((resolve) => server.close(resolve));
      global.fetch = ORIGINAL_FETCH;
    }
  };
}

const body = (dates) => ({
  city: "atlantis-unknown-place",
  place: "Malmö",
  lat: 41.9,
  lng: 12.49,
  dates,
  preferences: ["food"],
  walking_km_target: 6,
  include_external_candidates: 1,
});

test(
  "the API refuses an oversized date list instead of composing it",
  withServer(async (server) => {
    const many = Array.from({ length: 30 }, (_, i) => `2026-08-${String(i + 1).padStart(2, "0")}`);
    const response = await requestJson(server, {
      path: "/api/route-recommendations?lang=en",
      method: "POST",
      body: body(many),
    });

    // Before the bound this returned 200 with thirty composed days after 315
    // seconds of single-threaded work.
    assert.equal(response.status, 400);
    assert.equal(response.body.error, "too_many_dates");
    assert.ok(response.body.detail, "the refusal says what the limit is");
    assert.equal("days" in response.body, false, "no partial day is returned");
  }),
);

test(
  "the API refuses a malformed date instead of falling back",
  withServer(async (server) => {
    const response = await requestJson(server, {
      path: "/api/route-recommendations?lang=en",
      method: "POST",
      body: body(["2026-02-31"]),
    });
    assert.equal(response.status, 400);
    assert.equal(response.body.error, "invalid_dates");
  }),
);

test(
  "an ordinary single-date request is unaffected",
  withServer(async (server) => {
    const response = await requestJson(server, {
      path: "/api/route-recommendations?lang=en",
      method: "POST",
      body: body(["2026-08-23"]),
    });
    // Only that the boundary accepted it. What the engine then composes from a
    // deliberately thin fixture is a different question, and not this one.
    assert.equal(response.status, 200);
    assert.equal(response.body.error, undefined);
  }),
);
