"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createSchemaOrgEventProvider,
  schemaOrgCollectionLocationScope,
} = require("../server/pulse-sources/schema-org-event-provider");
const {
  normalizeIanaTimezone,
  normalizeSourceEventDateTime,
  datePartsInTimezone,
} = require("../server/pulse-sources/source-event-time");

test("maximum distinct floating-time listing bounds formatter construction and classification work", async () => {
  const rows = Array.from({ length: 500 }, (_, index) => {
    const start = Date.parse("2030-04-01T00:00:00Z") + index * 120000;
    return {
      "@type": "Event", "@id": `fixture-${index}`, name: `fixture-${index}`,
      startDate: new Date(start).toISOString().slice(0, 19),
      endDate: new Date(start + 60000).toISOString().slice(0, 19),
      location: { name: "Lantern Theatre" },
    };
  });
  rows[499] = { ...rows[499], startDate: "2030-05-13T18:00:00", endDate: "2030-05-13T19:00:00" };
  const original = Intl.DateTimeFormat;
  const originalParts = original.prototype.formatToParts;
  let constructions = 0;
  let partReads = 0;
  // Stop constructing real formatters early on RED, avoiding the reported
  // native-memory amplification. The oracle below measures operations, not
  // wall time, and no real source/network is involved.
  Intl.DateTimeFormat = function (...args) {
    constructions += 1;
    if (constructions > 8) throw new Error("test_formatter_construction_budget");
    return new original(...args);
  };
  original.prototype.formatToParts = function (...args) {
    partReads += 1;
    return originalParts.apply(this, args);
  };
  let calls = 0;
  let collection;
  try {
    const provider = createSchemaOrgEventProvider({
      endpoint: "https://fixture.invalid/programme", timezone: "Europe/Paris", limit: 40,
      fetcher: async () => {
        calls += 1;
        return { ok: true, status: 200, json: async () => rows };
      },
    }).create({ key: null });
    collection = await provider.collect({ date: "2030-05-12T09:00:00Z" });
  } finally {
    Intl.DateTimeFormat = original;
    original.prototype.formatToParts = originalParts;
  }
  assert.ok(constructions <= 4, `formatter construction must be source-zone bounded, got ${constructions}`);
  assert.ok(partReads <= 30000, `one classification per distinct source time must stay bounded, got ${partReads}`);
  assert.equal(calls, 1);
  assert.equal(collection.time_sensitive_events.length, 40);
  assert.equal(collection.time_sensitive_events[0].title, "fixture-499");
  assert.equal(collection.time_sensitive_events[0].starts_at, rows[499].startDate);
  assert.equal(collection.time_sensitive_events[1].title, "fixture-0");
  assert.equal(schemaOrgCollectionLocationScope(collection).length, 500);
});

test("timezone formatter reuse is bounded and evicts old zones rather than retaining unbounded keys", () => {
  const original = Intl.DateTimeFormat;
  let constructions = 0;
  Intl.DateTimeFormat = function (...args) {
    constructions += 1;
    return new original(...args);
  };
  try {
    const zones = Intl.supportedValuesOf("timeZone").slice(0, 40);
    for (const zone of zones) assert.equal(normalizeIanaTimezone(zone), zone);
    const afterFill = constructions;
    for (let index = 0; index < 3; index += 1) {
      assert.equal(normalizeIanaTimezone(zones.at(-1)), zones.at(-1));
      assert.ok(datePartsInTimezone("2030-05-12T09:00:00Z", zones.at(-1)));
    }
    assert.equal(constructions, afterFill, "the same valid zone must reuse its formatter");
    assert.equal(normalizeIanaTimezone(zones[0]), zones[0]);
    assert.equal(constructions, afterFill + 1, "the oldest zone must have been evicted from the bounded cache");
    assert.equal(normalizeIanaTimezone("Not/A_Timezone"), null);
  } finally {
    Intl.DateTimeFormat = original;
  }
});

test("reused timezone conversion preserves DST gap/fold refusal and explicit source offsets", () => {
  for (let index = 0; index < 2; index += 1) {
    assert.equal(normalizeSourceEventDateTime("2025-03-30T02:30:00", { timezone: "Europe/Paris" }), null);
    assert.equal(normalizeSourceEventDateTime("2025-10-26T02:30:00", { timezone: "Europe/Paris" }), null);
    assert.equal(normalizeSourceEventDateTime("2025-05-12T18:30:00", { timezone: "Europe/Paris" }), "2025-05-12T16:30:00.000Z");
    assert.equal(normalizeSourceEventDateTime("2025-05-12T18:30:00", { timezone: "America/New_York" }), "2025-05-12T22:30:00.000Z");
    assert.equal(normalizeSourceEventDateTime("2025-10-26T02:30:00+02:00", { timezone: "Europe/Paris" }), "2025-10-26T02:30:00+02:00");
  }
});
