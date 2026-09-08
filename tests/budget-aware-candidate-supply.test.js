"use strict";

/**
 * The candidate aperture must answer the question the user actually asked.
 *
 * Two defects found by read-only product QA on 446b802 across Stockholm,
 * Malmö, Ystad and Kivik (180 scenarios, three anchor forms, three walking
 * presets, five preference packs):
 *
 *  1. The collection radius was a constant. A 9 km "long" day drew candidates
 *     from the same 1.5 km disc as a 4 km "short" day, so `candidate_span_km`
 *     could never exceed ~3 km and `can_support_target` was false in 84 of 87
 *     scenarios that reported it. Measured consequence: `long > short` in
 *     ZERO of 60 comparable groups, every produced route exactly 2 stops, and
 *     48 scenarios with >=20 records and every requested intent covered still
 *     returned no route at all.
 *
 *  2. A cold cache plus a failed primary lost the request entirely. The eager
 *     secondary returns [] on a cache miss and warms out of band; the
 *     background pass then reuses that same empty result, so nothing rescues
 *     the day even though the secondary succeeds moments later. Observed live
 *     with overpass-api.de globally unreachable: first request
 *     error_failed_closed with 0 records, second identical request loaded:80.
 *
 * Both are provider-independent. Neither fix may look at a city.
 */

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  createOpenDataLoader,
  composeOpenDataLoaders,
  DEFAULT_RADIUS_KM,
  MAX_RADIUS_KM,
} = require("../server/place-candidates/open-data-loader");

const ANCHOR = { lat: 59.3322005, lng: 18.0640284 };
const band = (targetKm) => ({ targetKm, floorKm: targetKm * 0.8, ceilingKm: targetKm * 1.2 });

/** Record the radius of every Overpass query the loader issues. */
function radiusRecordingFetcher(elements = []) {
  const radii = [];
  const fetcher = async (_url, opts) => {
    // The Overpass query is form-encoded, so `around:1500` arrives as `around%3A1500`.
    const m = /around:(\d+(?:\.\d+)?)/.exec(decodeURIComponent(String(opts?.body || "")));
    if (m) radii.push(Number(m[1]) / 1000);
    return { ok: true, json: async () => ({ elements }) };
  };
  return { fetcher, radii };
}

// --------------------------------------------------------------------------
// 1. The aperture follows the walking budget.
// --------------------------------------------------------------------------

test("a longer walking budget collects candidates from a wider aperture", async () => {
  const shortRun = radiusRecordingFetcher();
  const longRun = radiusRecordingFetcher();

  await createOpenDataLoader({ fetcher: shortRun.fetcher })({ ...ANCHOR, walkingTargetBand: band(4) });
  await createOpenDataLoader({ fetcher: longRun.fetcher })({ ...ANCHOR, walkingTargetBand: band(9) });

  assert.ok(shortRun.radii.length, "precondition: the short run queried at least once");
  assert.ok(longRun.radii.length, "precondition: the long run queried at least once");

  const shortBase = shortRun.radii[0];
  const longBase = longRun.radii[0];
  assert.ok(
    longBase > shortBase,
    `a 9 km day must not draw from the same disc as a 4 km day (short=${shortBase} long=${longBase})`,
  );
});

test("the aperture is proportional to the budget, not a second constant", async () => {
  const seen = new Map();
  for (const targetKm of [4, 6, 9, 12]) {
    const run = radiusRecordingFetcher();
    await createOpenDataLoader({ fetcher: run.fetcher })({ ...ANCHOR, walkingTargetBand: band(targetKm) });
    seen.set(targetKm, run.radii[0]);
  }
  const radii = [...seen.values()];
  assert.ok(radii.every((r) => r <= MAX_RADIUS_KM), `every aperture stays within the reviewed ceiling: ${radii}`);
  assert.ok(radii[0] >= DEFAULT_RADIUS_KM, "the smallest budget is never narrower than today's default");
  for (let i = 1; i < radii.length; i++) {
    assert.ok(radii[i] >= radii[i - 1], `aperture must be monotone in the budget: ${radii}`);
  }
  assert.ok(radii[radii.length - 1] > radii[0], `the widest budget must actually widen: ${radii}`);
});

test("no walking band keeps exactly today's default aperture", async () => {
  // A caller that says nothing about walking gets the behaviour it has now.
  const run = radiusRecordingFetcher();
  await createOpenDataLoader({ fetcher: run.fetcher })(ANCHOR);
  assert.equal(run.radii[0], DEFAULT_RADIUS_KM, "an absent band must not change the default");
});

test("an explicit radius option still wins over the budget", async () => {
  const run = radiusRecordingFetcher();
  await createOpenDataLoader({ fetcher: run.fetcher, radiusKm: 0.4 })({ ...ANCHOR, walkingTargetBand: band(9) });
  assert.equal(run.radii[0], 0.4, "an operator-pinned radius is not overridden by the budget");
});

// --------------------------------------------------------------------------
// 2. A failed primary must not discard a secondary that is about to succeed.
// --------------------------------------------------------------------------

/** A secondary shaped exactly like the Overture wrapper: cold miss -> [], warms out of band. */
function eagerWarmingSource(records) {
  let warmed = false;
  return {
    eager: true,
    loadCount: 0,
    load() {
      this.loadCount += 1;
      if (warmed) return records;
      warmed = true; // the out-of-band warm lands between the eager and background passes
      return [];
    },
  };
}

const place = (id, i) => ({
  id,
  name: id,
  type: i % 2 ? "restaurant" : "museum",
  lat: ANCHOR.lat + i * 0.0009,
  lng: ANCHOR.lng + (i % 4) * 0.0009,
  tags: ["mat"],
  sources: [{ provider: "overture", family: "open_directory", tier: "inferred", url: "https://overturemaps.org/" }],
});

test("a cold secondary rescues the day when the primary provider is down", async () => {
  // The exact live shape: overpass unreachable, Overture cache cold on arrival.
  const failingPrimary = async () => {
    const out = [];
    out.loader_status = "error_failed_closed";
    out.loader_error = "fetch_error";
    return out;
  };
  const secondary = eagerWarmingSource(Array.from({ length: 20 }, (_, i) => place(`overture-${i}`, i)));
  const composed = composeOpenDataLoaders(failingPrimary, null, secondary);

  const records = await composed({ ...ANCHOR, requestedIntents: ["food", "museums"] });

  assert.ok(
    records.length > 0,
    "a warmed secondary must not be thrown away because the primary failed",
  );
  assert.ok(
    !String(records.loader_status || "").startsWith("error"),
    `status must reflect the records actually held, got ${records.loader_status}`,
  );
});

test("a genuinely empty secondary still fails closed rather than inventing supply", async () => {
  const failingPrimary = async () => {
    const out = [];
    out.loader_status = "error_failed_closed";
    out.loader_error = "fetch_error";
    return out;
  };
  const emptySecondary = { eager: true, load: () => [] };
  const composed = composeOpenDataLoaders(failingPrimary, null, emptySecondary);

  const records = await composed({ ...ANCHOR, requestedIntents: ["food"] });
  assert.equal(records.length, 0, "nothing is invented when no source has anything");
  assert.equal(records.loader_status, "error_failed_closed", "and the failure stays visible");
});

test("a healthy primary is not asked to re-read the secondary", async () => {
  // The re-read is a rescue for the failed-primary case, not an extra call on
  // the happy path.
  const healthyPrimary = async () => {
    const out = [place("osm-1", 1), place("osm-2", 2)];
    out.loader_status = "loaded:2";
    out.loader_error = null;
    return out;
  };
  const secondary = eagerWarmingSource([place("overture-a", 3)]);
  const composed = composeOpenDataLoaders(healthyPrimary, null, secondary);

  await composed({ ...ANCHOR, requestedIntents: ["food"] });
  assert.equal(secondary.loadCount, 1, "one eager read, no rescue re-read when the primary is fine");
});

// --------------------------------------------------------------------------
// 3. The rescue must not turn a bounded live source into two provider calls.
// --------------------------------------------------------------------------

/**
 * A source shaped like the official NAPI descriptor: eager, but its `load()`
 * performs a bounded LIVE request, so it declares `primaryRescue: false` and
 * exposes a cache-only `readCached()` for paths that must not spend a request.
 */
function boundedLiveSource({ cached = [] } = {}) {
  return {
    eager: true,
    primaryRescue: false,
    liveCalls: 0,
    cachedPeeks: 0,
    load() {
      this.liveCalls += 1;
      return []; // the provider failed or had nothing for this anchor
    },
    readCached() {
      this.cachedPeeks += 1;
      return cached;
    },
  };
}

const failingPrimary = async () => {
  const out = [];
  out.loader_status = "error_failed_closed";
  out.loader_error = "fetch_error";
  return out;
};

test("a failed primary never costs a bounded live source a second request", async () => {
  // Without this, the rescue re-read issues a second provider call inside one
  // composition and breaks the source's single-attempt bound.
  const napi = boundedLiveSource();
  const composed = composeOpenDataLoaders(failingPrimary, null, napi);

  await composed({ lat: 55.6061195, lng: 13.000622, requestedIntents: ["food", "museums"] });

  assert.equal(napi.liveCalls, 1, "exactly one live provider request per composition");
});

test("a bounded live source can still rescue the day from its own cache", async () => {
  // The rescue is not abandoned for these sources — it is served from the
  // cache-only peek, which costs no network.
  const rows = Array.from({ length: 6 }, (_, i) => place(`napi-${i}`, i));
  const napi = boundedLiveSource({ cached: rows });
  const composed = composeOpenDataLoaders(failingPrimary, null, napi);

  const records = await composed({ lat: 55.6061195, lng: 13.000622, requestedIntents: ["food", "museums"] });

  assert.equal(napi.liveCalls, 1, "still only one live request");
  assert.equal(napi.cachedPeeks, 1, "the cache-only peek is what answers the rescue");
  assert.equal(records.length, rows.length, "already-fetched official rows still save the day");
});

test("a bounded live source with no cache peek is skipped, not called twice", async () => {
  const napi = { eager: true, primaryRescue: false, liveCalls: 0, load() { this.liveCalls += 1; return []; } };
  const composed = composeOpenDataLoaders(failingPrimary, null, napi);

  const records = await composed({ lat: 55.6061195, lng: 13.000622, requestedIntents: ["food"] });

  assert.equal(napi.liveCalls, 1, "no second provider call when there is nothing to peek");
  assert.equal(records.length, 0, "and nothing is invented");
});

test("a cache-only source is still re-read — the bound applies only to live sources", async () => {
  // Guard against fixing the live case by disabling the rescue for everyone.
  const secondary = eagerWarmingSource(Array.from({ length: 20 }, (_, i) => place(`overture-${i}`, i)));
  const composed = composeOpenDataLoaders(failingPrimary, null, secondary);

  const records = await composed({ lat: 59.3322005, lng: 18.0640284, requestedIntents: ["food", "museums"] });

  assert.ok(records.length > 0, "the warm-cache rescue must survive the live-source bound");
});
