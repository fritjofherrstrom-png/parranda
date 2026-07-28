/**
 * Evening-event wiring — on the agnostic path, a genuine tonight-event is woven
 * into the composed day's `place_structure.district_day.evening_event`, tied to
 * the nearest district. Additive + honest: no geocoded tonight-event → no anchor,
 * and the route/structure are otherwise unchanged.
 */

const assert = require("node:assert/strict");
const http = require("node:http");
const test = require("node:test");

const { buildApp } = require("../server/app");
const { mockStableWeatherFetch } = require("./helpers/planner-reservoir-compare");

const ORIGINAL_FETCH = global.fetch;
const FLAG = "experimental_agnostic_route_output=1&include_external_candidates=1";
const ANCHOR = { lat: 60.17, lng: 24.94 };

// A tight café cluster near the anchor → at least one derived district.
function loaderFor(records) {
  return async () => records.map((r) => ({ ...r }));
}
const CAFES = [
  { id: "c1", type: "cafe", tags: ["fika"], lat: 60.1700, lng: 24.9400, name: "A" },
  { id: "c2", type: "cafe", tags: ["fika"], lat: 60.1704, lng: 24.9405, name: "B" },
  { id: "c3", type: "cafe", tags: ["fika"], lat: 60.1708, lng: 24.9410, name: "C" },
];

function post(server, body) {
  const { port } = server.address();
  const payload = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path: `/api/route-recommendations?lang=en&${FLAG}`,
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) },
      },
      (res) => {
        let d = "";
        res.on("data", (c) => (d += c));
        res.on("end", () => resolve(JSON.parse(d)));
      },
    );
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

async function withServer({ openDataLoader, eventSupply }, run) {
  global.fetch = mockStableWeatherFetch();
  const server = buildApp({ openDataLoader, eventSupply }).listen(0);
  try {
    await run(server);
  } finally {
    await new Promise((r) => server.close(r));
    global.fetch = ORIGINAL_FETCH;
  }
}

const BODY = { lat: ANCHOR.lat, lng: ANCHOR.lng, dates: ["2026-06-28"], preferences: ["fika"], include_external_candidates: 1 };

test("a geocoded tonight-event is woven into the day as the evening anchor, tied to a district", async () => {
  const eventSupply = async () => ({
    coverage: "covered",
    feed: { id: "linkedevents-helsinki", label: "Helsinki Linked Events", license: "CC-BY 4.0" },
    tonight: [
      { id: "gig", title: "Rooftop set", starts_at: "2026-06-28T19:00:00Z", timezone: "Europe/Helsinki", source_url: "https://x/gig", source_label: "Feed", lat: 60.1706, lng: 24.9408, salience_score: 9 },
    ],
    this_week: [],
  });
  await withServer({ openDataLoader: loaderFor(CAFES), eventSupply }, async (server) => {
    const res = await post(server, BODY);
    const day = res.place_structure && res.place_structure.district_day;
    assert.ok(day, "district day composed");
    const ev = day.evening_event;
    assert.ok(ev, "evening_event woven into the day");
    assert.equal(ev.id, "gig");
    assert.equal(ev.source_url, "https://x/gig");
    assert.ok(Number.isInteger(ev.near_area_index), "tied to the nearest district");
    // It's an anchor, not a walking stop — no fabricated ETA/walking fields.
    assert.ok(!("walk_minutes" in ev) && !("eta" in ev));
    // Live events sidecar is still present and unchanged.
    assert.equal(res.live_events.tonight[0].id, "gig");
  });
});

test("a tonight-event with NO coordinates → no evening anchor, but the day is intact", async () => {
  const eventSupply = async () => ({
    coverage: "covered",
    feed: { id: "f", label: "Feed", license: "CC-BY 4.0" },
    tonight: [{ id: "noco", title: "No coords", starts_at: "2026-06-28T19:00:00Z", source_url: "https://x/noco" }],
    this_week: [],
  });
  await withServer({ openDataLoader: loaderFor(CAFES), eventSupply }, async (server) => {
    const res = await post(server, BODY);
    const day = res.place_structure && res.place_structure.district_day;
    assert.ok(day, "district day still composed");
    assert.equal(day.evening_event, undefined, "no fabricated evening anchor without coordinates");
  });
});

test("administrative live events do not become evening anchors when a cultural event exists", async () => {
  const eventSupply = async () => ({
    coverage: "covered",
    feed: { id: "f", label: "Feed", license: "CC-BY 4.0" },
    tonight: [
      {
        id: "admin",
        title: "Municipal committee session",
        starts_at: "2026-06-28T18:00:00Z",
        timezone: "Europe/Helsinki",
        source_url: "https://x/admin",
        source_label: "Official calendar",
        lat: 60.1706,
        lng: 24.9408,
        cultural_tier: "administrative",
        salience_score: 9.8,
      },
      {
        id: "culture",
        title: "Evening courtyard concert",
        starts_at: "2026-06-28T20:00:00Z",
        timezone: "Europe/Helsinki",
        source_url: "https://x/culture",
        source_label: "Official calendar",
        lat: 60.1707,
        lng: 24.9409,
        cultural_tier: "cultural",
        salience_score: 7.2,
      },
    ],
    this_week: [],
  });
  await withServer({ openDataLoader: loaderFor(CAFES), eventSupply }, async (server) => {
    const res = await post(server, BODY);
    const ev = res.place_structure?.district_day?.evening_event;
    assert.ok(ev, "cultural evening_event woven into the day");
    assert.equal(ev.id, "culture");
    assert.equal(ev.cultural_tier, "cultural");
    assert.equal(
      (res.days?.[0]?.primary_route?.main_stops || []).some((stop) => stop.id === "culture" || stop.id === "admin"),
      false,
      "live events are not injected into main_stops",
    );
  });
});

test("no event supply → no evening anchor, place_structure unchanged", async () => {
  await withServer({ openDataLoader: loaderFor(CAFES), eventSupply: null }, async (server) => {
    const res = await post(server, BODY);
    const day = res.place_structure && res.place_structure.district_day;
    assert.ok(day, "district day composed without any event provider");
    assert.equal(day.evening_event, undefined);
  });
});
