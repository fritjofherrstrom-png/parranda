"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { collectAnchorEvents } = require("../server/place-candidates/agnostic-event-supply");

const ANCHOR = { lat: 48.2, lng: 3.3 };
const HOST = { name: "Lantern Theatre", ...ANCHOR, wikidata_ref: "Q500" };
const SOURCE = {
  id: "one-venue-programme",
  label: "Lantern programme",
  adapter: "schema_org_html",
  endpoint: "https://venue.example/programme",
  bbox: [-180, -90, 180, 90],
  source_tier: "official",
  confidence: "strong",
  status: "active",
  runtime_policy: "bounded_refresh",
  license: "CC-BY-4.0",
  fallback_timezone: "Europe/Paris",
  host_venue: HOST,
};

function row(id, start, end, name = "") {
  return {
    "@type": "Event", "@id": `https://venue.example/${id}`,
    name: id, startDate: start, endDate: end,
    location: { "@type": "Place", name },
  };
}

async function collect(archiveVenue, archiveGeo = null) {
  const archived = row("archived-location-evidence", "2030-04-01T18:00:00Z", "2030-04-01T19:00:00Z", archiveVenue);
  if (archiveGeo) archived.location.geo = archiveGeo;
  const rows = [
    archived,
    ...Array.from({ length: 40 }, (_, index) =>
      row(`future-${index}`, "2030-05-13T18:00:00Z", "2030-05-13T19:00:00Z")),
  ];
  let calls = 0;
  const live = await collectAnchorEvents({
    anchor: ANCHOR,
    registry: [SOURCE],
    now: "2030-05-12T10:00:00Z",
    selectedDate: "2030-05-12",
    time: "this_week",
    fetcher: async () => {
      calls += 1;
      return { ok: true, status: 200,
        text: async () => `<script type="application/ld+json">${JSON.stringify(rows)}</script>` };
    },
  });
  assert.equal(calls, 1, "the correction must not acquire another page");
  assert.equal(live.feeds[0].event_rows, 40, "negative scope evidence must not raise the event row cap");
  return live;
}

test("an archived other-venue fact outside the new row prefix still vetoes unnamed-host placement", async () => {
  const live = await collect("Riverbank Arts Hall");
  assert.equal(live.this_week.length, 0, "date prioritization must not erase mixed-venue evidence and grant host coordinates");
  assert.ok(live.acquisition.rejection_summary.some(row => row.reason === "missing_event_coordinates"));
});

test("an unchanged single-host programme can still place its source-backed future rows", async () => {
  const live = await collect(HOST.name);
  assert.ok(live.this_week.length > 0, "do not disable the existing single-host fallback wholesale");
  assert.ok(live.this_week.every(row => row.venue_resolution?.basis === "host_venue_programme"));
});

test("an omitted source point away from the host remains a full-source veto", async () => {
  const live = await collect("", { latitude: 49.2, longitude: 3.3 });
  assert.equal(live.this_week.length, 0);
  assert.ok(live.acquisition.rejection_summary.some(row => row.reason === "missing_event_coordinates"));
});

test("an omitted explicit invalid source point cannot become permission to place unnamed rows", async () => {
  const live = await collect("", { latitude: 0, longitude: 0 });
  assert.equal(live.this_week.length, 0);
});

test("an omitted partial source point survives lossy mapping as a negative veto", async () => {
  const live = await collect("", { latitude: 999 });
  assert.equal(live.this_week.length, 0, "a partial point must not become absent geometry and authorize host placement");
});

test("an omitted malformed source point survives lossy mapping as a negative veto", async () => {
  const live = await collect("", { latitude: "invalid", longitude: 3.3 });
  assert.equal(live.this_week.length, 0, "malformed geometry is not permission to manufacture a point for unnamed siblings");
});

test("an omitted valid numeric-string point at the host does not veto the single-host programme", async () => {
  const live = await collect("", { latitude: String(HOST.lat), longitude: String(HOST.lng) });
  assert.ok(live.this_week.length > 0);
  assert.ok(live.this_week.every(row => row.venue_resolution?.basis === "host_venue_programme"));
});
