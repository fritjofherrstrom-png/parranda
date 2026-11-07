"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { resolveDefaultEventSupply, eventCacheKey, buildScopedEventSourcePlan } = require("../server/place-candidates/agnostic-event-supply");

const anchor = { lat: 48.5, lng: 2.5 };
const now = "2026-11-06T19:00:00Z";
const selectedDate = "2026-11-06";

for (const { adapter, withResolver } of [
  { adapter: "schema_org", withResolver: false },
  { adapter: "schema_org_html", withResolver: false },
  { adapter: "ical", withResolver: false },
  { adapter: "ical", withResolver: true },
]) {
  test(`${adapter} Live caches preserve source timing and venue identity (resolver=${withResolver})`, async () => {
    const feed = { id: "source-calendar", label: "Source Calendar", adapter,
      endpoint: "https://calendar.example/events", source_identity: "calendar.example",
      bbox: [2.49, 48.49, 2.51, 48.51], status: "active", runtime_policy: "bounded_refresh" };
    assert.deepEqual(buildScopedEventSourcePlan({ anchor, registry: [feed] }).map(s => s.id), [feed.id]);
    const legacyKey = eventCacheKey(anchor, now, [feed.id], 3000, null, selectedDate);
    const legacy = { coverage: "covered", tonight: [], this_week: [],
      acquisition: { source_health: { status: "healthy", result: "empty" } } };
    const bytes = JSON.stringify(legacy);
    const values = new Map([[legacyKey, legacy]]);
    let pending;
    let collections = 0;
    const supply = resolveDefaultEventSupply({ PARRANDA_AGNOSTIC_EVENTS: "enabled",
      PARRANDA_EVENT_READER: "disabled", PARRANDA_EVENT_FEEDS: JSON.stringify([feed]) }, {
      requestTimeDiscovery: null,
      venueResolver: withResolver ? async () => [] : null,
      eventCache: {
        peek: key => values.get(key),
        warm: (key, factory) => { pending = Promise.resolve().then(factory).then(value => {
          values.set(key, value); return value;
        }); return pending; },
      },
      collectEvents: async () => { collections++; return structuredClone(legacy); },
    });
    const input = { anchor, now, selectedDate };
    const first = await supply(input);
    if (adapter.startsWith("schema_org") || withResolver) {
      assert.equal(first.pending, true, "old pools cannot attest current timing/physical-venue identity");
      await pending;
      assert.equal((await supply(input)).pending, undefined);
      assert.equal(collections, 1, "new-policy data is reusable after exactly one collection");
      assert.equal(values.size, 2, "new evidence has its own key, without deleting the old pool");
    } else {
      assert.equal(first.pending, undefined, "unaffected adapters retain their valid cache hit");
      assert.equal(collections, 0);
      assert.equal(values.size, 1);
    }
    assert.equal(JSON.stringify(values.get(legacyKey)), bytes);
  });
}
