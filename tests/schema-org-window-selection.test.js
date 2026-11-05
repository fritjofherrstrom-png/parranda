"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createSchemaOrgEventProvider, schemaOrgCollectionLocationScope } = require("../server/pulse-sources/schema-org-event-provider");

function event(id, start, end = start) {
  return {
    "@type": "Event",
    "@id": `https://venue.example/events/${id}`,
    name: id,
    startDate: start,
    endDate: end,
    location: { "@type": "Place", name: "Lantern Theatre" },
  };
}

function fixture() {
  // An ordinary listing retains its archive before the current programme.
  return [
    event("old-first", "2030-04-01"),
    event("old-second", "2030-04-02"),
    event("old-third", "2030-04-03"),
    event("ongoing", "2030-05-10", "2030-05-14"),
    event("upcoming", "2030-05-13"),
  ];
}

function providerWithListing(rows, limit = 2, options = {}) {
  let calls = 0;
  const provider = createSchemaOrgEventProvider({
    ...options,
    endpoint: "https://venue.example/programme",
    format: "html",
    limit,
    fetcher: async () => {
      calls += 1;
      return {
        ok: true,
        status: 200,
        text: async () => `<script type="application/ld+json">${JSON.stringify(rows)}</script>`,
      };
    },
  });
  return { collector: provider.create({ key: null }), calls: () => calls };
}

test("dated schema collection retains current/upcoming source rows before an archive prefix within the unchanged row cap", async () => {
  const source = providerWithListing(fixture());
  const result = await source.collector.collect({ date: "2030-05-12T09:00:00.000Z" });
  assert.equal(source.calls(), 1, "priority must not fetch additional pages");
  assert.equal(result.time_sensitive_events.length, 2, "source row cap must stay unchanged");
  assert.deepEqual(result.time_sensitive_events.map(row => row.title), ["ongoing", "upcoming"]);
  assert.equal(result.collection_status.status, "ok");
});

test("without a valid requested window schema collection preserves its existing source order and cap", async () => {
  for (const date of [undefined, "not-a-date"]) {
    const source = providerWithListing(fixture());
    const result = await source.collector.collect({ date });
    assert.deepEqual(result.time_sensitive_events.map(row => row.title), ["old-first", "old-second"]);
    assert.equal(source.calls(), 1);
  }
});

test("published source timezone owns date-only retirement while an unknown timezone retains the boundary uncertainty", async () => {
  const rows = [event("yesterday", "2030-05-11"), event("today", "2030-05-12")];
  const known = providerWithListing(rows, 1, { timezone: "Etc/UTC" });
  const uncertain = providerWithListing(rows, 1);
  assert.equal((await known.collector.collect({ date: "2030-05-12T00:30:00Z" })).time_sensitive_events[0].title, "today");
  assert.equal((await uncertain.collector.collect({ date: "2030-05-12T00:30:00Z" })).time_sensitive_events[0].title, "yesterday");
  const eastern = providerWithListing([event("ended-local-day", "2030-05-12"), event("local-today", "2030-05-13")], 1, { timezone: "Pacific/Auckland" });
  assert.equal((await eastern.collector.collect({ date: "2030-05-12T20:30:00Z" })).time_sensitive_events[0].title, "local-today");
});

test("a date-only requested day does not silently assume UTC for an offset-bearing source", async () => {
  const source = providerWithListing([
    event("still-on-source-day", "2030-05-11T20:00:00+14:00", "2030-05-12T01:00:00+14:00"),
    event("later", "2030-05-13"),
  ], 1);
  assert.equal((await source.collector.collect({ date: "2030-05-12" })).time_sensitive_events[0].title, "still-on-source-day");
});

test("explicit source instants are compared as instants without changing their published offsets", async () => {
  const rows = [
    event("ended", "2030-05-12T10:00:00+02:00", "2030-05-12T11:00:00+02:00"),
    event("ongoing", "2030-05-12T20:00:00+02:00", "2030-05-12T22:00:00+02:00"),
  ];
  const source = providerWithListing(rows, 1);
  const result = await source.collector.collect({ date: "2030-05-12T19:00:00Z" });
  assert.equal(result.time_sensitive_events[0].title, "ongoing");
  assert.equal(result.time_sensitive_events[0].starts_at, rows[1].startDate);
  assert.equal(result.time_sensitive_events[0].ends_at, rows[1].endDate);
});

test("missing, malformed and unreadable local end facts are not manufactured into archive evidence", async () => {
  const unknownRows = [
    { ...event("missing-end", "2030-04-01"), endDate: undefined },
    event("malformed-date", "2030-02-30T10:00:00Z", "2030-02-30T11:00:00Z"),
    event("unattested-floating", "2030-04-01T10:00:00", "2030-04-01T11:00:00"),
  ];
  for (const unknown of unknownRows) {
    const source = providerWithListing([unknown, event("upcoming", "2030-05-13")], 1);
    assert.equal((await source.collector.collect({ date: "2030-05-12T09:00:00Z" })).time_sensitive_events[0].title, unknown.name);
  }
});

test("full bounded location evidence is private to the actual collection and cannot be claimed by JSON", async () => {
  const source = providerWithListing(fixture(), 2);
  const result = await source.collector.collect({ date: "2030-05-12T09:00:00Z" });
  const scope = schemaOrgCollectionLocationScope(result);
  assert.equal(scope.length, fixture().length);
  assert.ok(Object.isFrozen(scope) && scope.every(Object.isFrozen));
  assert.equal(schemaOrgCollectionLocationScope(JSON.parse(JSON.stringify(result))), null);
  assert.equal(schemaOrgCollectionLocationScope({ sourceLocationScope: scope }), null);
  assert.equal(result.sourceLocationScope, undefined, "location scope is not a public positive flag or additional event output");
  assert.equal(result.time_sensitive_events.length, 2);
});
