/**
 * Agnostic live-event supply — "what's alive near here" for an arbitrary anchor,
 * generically (open municipal feed, geo-filtered, deterministic, no network).
 */

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  collectAnchorEvents,
  resolveEventFeedForAnchor,
  buildAnchorEventEndpoint,
  BUILTIN_EVENT_FEEDS,
} = require("../server/place-candidates/agnostic-event-supply");

const HELSINKI = { lat: 60.17, lng: 24.94 }; // inside the built-in feed bbox
const ROME = { lat: 41.9, lng: 12.5 }; // outside every feed bbox
const NOW = "2026-06-28T12:00:00Z";

// A Linked Events-shaped payload covering every timing bucket relative to NOW.
function linkedEventsPayload() {
  const ev = (id, name, start, end, lat, lng) => ({
    id,
    name: { en: name },
    start_time: start,
    end_time: end,
    location: { position: { coordinates: [lng, lat] }, name: { en: "Venue " + id } },
    info_url: { en: `https://example.org/${id}` },
    data_source: "helsinki",
    publisher: "City of Helsinki",
    keywords: [],
  });
  return {
    meta: { count: 6 },
    data: [
      ev("now1", "Ongoing now", "2026-06-28T11:00:00Z", "2026-06-28T13:00:00Z", 60.171, 24.941), // now
      ev("tonight1", "Tonight gig", "2026-06-28T19:00:00Z", "2026-06-28T21:00:00Z", 60.172, 24.942), // tonight
      ev("today1", "Daytime market", "2026-06-28T14:00:00Z", "2026-06-28T16:00:00Z", 60.173, 24.943), // today
      ev("week1", "Thursday concert", "2026-07-01T18:00:00Z", "2026-07-01T20:00:00Z", 60.174, 24.944), // this_week (3d)
      ev("far1", "Autumn festival", "2026-09-01T18:00:00Z", "2026-09-01T20:00:00Z", 60.175, 24.945), // beyond 7d
      ev("stale1", "Yesterday show", "2026-06-27T18:00:00Z", "2026-06-27T20:00:00Z", 60.176, 24.946), // stale
      ev("perm1", "Permanent exhibition", "2001-01-01T09:00:00Z", "2030-01-01T00:00:00Z", 60.177, 24.947), // ongoing-since-2001 → NOT tonight
      ev("now1", "Ongoing now", "2026-06-28T11:00:00Z", "2026-06-28T13:00:00Z", 60.171, 24.941), // exact duplicate of now1 → deduped
    ],
  };
}

function fetcherFor(payload) {
  return async () => ({ ok: true, json: async () => payload });
}

test("an anchor inside an open feed resolves the feed; outside, it does not", () => {
  const feed = resolveEventFeedForAnchor(HELSINKI);
  assert.ok(feed && feed.id === "linkedevents-helsinki");
  assert.equal(resolveEventFeedForAnchor(ROME), null);
  assert.equal(resolveEventFeedForAnchor({ lat: NaN, lng: NaN }), null);
});

test("the endpoint is geo-filtered to the anchor and excludes permanent infrastructure", () => {
  const url = new URL(buildAnchorEventEndpoint(BUILTIN_EVENT_FEEDS[0].base, HELSINKI));
  assert.equal(url.searchParams.get("dwithin_origin"), "24.94,60.17");
  assert.ok(Number(url.searchParams.get("dwithin_metres")) > 0);
  assert.equal(url.searchParams.get("sort"), "end_time");
  assert.ok(Number(url.searchParams.get("max_duration")) > 0, "duration cap excludes always-open venues");
});

test("covered anchor buckets events into tonight (now/today/tonight) and this_week (<=7d)", async () => {
  const out = await collectAnchorEvents({
    anchor: HELSINKI,
    now: NOW,
    fetcher: fetcherFor(linkedEventsPayload()),
  });
  assert.equal(out.coverage, "covered");
  assert.equal(out.feed.id, "linkedevents-helsinki");

  const tonightIds = out.tonight.map((e) => e.id).sort();
  assert.deepEqual(
    tonightIds,
    ["now1", "today1", "tonight1"],
    "now/today/tonight only; permanent-since-2001 dropped, duplicate collapsed",
  );
  assert.equal(out.tonight.filter((e) => e.id === "now1").length, 1, "duplicate occurrence collapsed");
  assert.ok(!out.tonight.some((e) => e.id === "perm1"), "always-open exhibition is not 'tonight'");

  const weekIds = out.this_week.map((e) => e.id);
  assert.deepEqual(weekIds, ["week1"], "only the within-7-days future event; far-future + stale excluded");

  // Honest data-only view: coords, source, license, trust carried; no prose.
  const tonightGig = out.tonight.find((e) => e.id === "tonight1");
  assert.ok(tonightGig.starts_at && tonightGig.source_url && tonightGig.license);
  assert.ok(Number.isFinite(tonightGig.lat) && Number.isFinite(tonightGig.lng));
});

test("tonight ranks by salience: an ongoing 'now' event outranks a later-today one", async () => {
  const out = await collectAnchorEvents({
    anchor: HELSINKI,
    now: NOW,
    fetcher: fetcherFor(linkedEventsPayload()),
  });
  // 'now' timing scores highest in the shared salience scorer.
  assert.equal(out.tonight[0].id, "now1");
});

test("an uncovered anchor returns honest empty — no fetch, no fabricated events", async () => {
  let fetched = false;
  const out = await collectAnchorEvents({
    anchor: ROME,
    now: NOW,
    fetcher: async () => {
      fetched = true;
      return { ok: true, json: async () => linkedEventsPayload() };
    },
  });
  assert.equal(out.coverage, "uncovered");
  assert.equal(fetched, false, "no feed covers the anchor → no network call");
  assert.deepEqual(out.tonight, []);
  assert.deepEqual(out.this_week, []);
});

test("fail-soft: a feed error yields covered-but-empty, never a throw", async () => {
  const httpError = await collectAnchorEvents({ anchor: HELSINKI, now: NOW, fetcher: async () => ({ ok: false }) });
  assert.equal(httpError.coverage, "covered");
  assert.deepEqual(httpError.tonight, []);

  const thrower = await collectAnchorEvents({
    anchor: HELSINKI,
    now: NOW,
    fetcher: async () => {
      throw new Error("network down");
    },
  });
  assert.equal(thrower.coverage, "covered");
  assert.deepEqual(thrower.this_week, []);
});
