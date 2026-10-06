"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createQuotedEventProvider } = require("../server/pulse-sources/quoted-event-provider");
const { verifyQuotedEvent } = require("../server/pulse-sources/quoted-event-reader");
const { collectAnchorEvents } = require("../server/place-candidates/agnostic-event-supply");

const endpoint = "https://association.example/news/concert";
const timezone = "Europe/Stockholm";
const anchor = { lat: 55.6, lng: 13 };
const fetcher = async () => new Response("<p>Fixture document</p>", {
  headers: { "content-type": "text/html" },
});

function quotedEvent(date, time) {
  const excerpt = `Concert ${date} ${time} at Civic Hall`;
  const row = verifyQuotedEvent({
    title: { value: "Concert", quote: "Concert" },
    date: { value: date, quote: date },
    time: { value: time, quote: time },
    place: { value: "Civic Hall", quote: "Civic Hall" }, excerpt,
  }, { document: excerpt, sourceUrl: endpoint, language: "en" });
  assert.ok(row, "the literal date and clock pass original-document verification");
  return row;
}

async function collect(events) {
  return createQuotedEventProvider({ endpoint, timezone, fetcher,
    eventReader: async () => ({ status: "ok", events }),
  }).create().collect();
}

for (const date of ["2026-03-29", "2026-10-25"]) {
  test(`a quoted nonexistent or ambiguous venue-local clock fails instead of healthy empty (${date})`, async () => {
    const result = await collect([quotedEvent(date, "02:30")]);
    assert.deepEqual(result.time_sensitive_events, []);
    assert.equal(result.collection_status.status, "failed");
    assert.equal(result.collection_status.reason, "source_payload_invalid");
  });
}

test("unresolved quoted clocks retain valid rows but report incomplete source health", async () => {
  const valid = quotedEvent("2026-03-29", "03:30");
  const result = await collect([quotedEvent("2026-03-29", "02:30"), valid]);
  assert.equal(result.time_sensitive_events.length, 1);
  assert.equal(result.time_sensitive_events[0].id, valid.id);
  assert.equal(result.time_sensitive_events[0].starts_at, "2026-03-29T01:30:00.000Z");
  assert.equal(result.collection_status.status, "failed");
  assert.equal(result.collection_status.event_rows, 1);
  assert.equal(result.collection_status.reason, "source_payload_invalid");
});

test("a source-backed dated clock failure reaches shared Live as failure, not responding-empty", async () => {
  const result = await collectAnchorEvents({ anchor, now: "2026-03-29T00:00:00Z",
    selectedDate: "2026-03-29", fetcher,
    registry: [{ id: "quoted-clock-fixture", endpoint, adapter: "quoted_public_document",
      bbox: [12, 55, 14, 56], timezone, status: "active", source_tier: "official",
      confidence: "low", pulse_only: true }],
    eventReader: async () => ({ status: "ok", events: [quotedEvent("2026-03-29", "02:30")] }),
  });
  assert.equal(result.acquisition.source_health.failed_source_count, 1);
  assert.equal(result.acquisition.source_health.empty_source_count, 0);
  assert.equal(result.acquisition.source_health.status, "unavailable");
  assert.deepEqual(result.tonight, []);
});

test("actually empty documents and valid quoted clocks keep their existing outcomes", async () => {
  assert.equal((await collect([])).collection_status.status, "empty");
  const result = await collect([quotedEvent("2026-03-29", "03:30")]);
  assert.equal(result.collection_status.status, "ok");
  assert.equal(result.time_sensitive_events[0].starts_at, "2026-03-29T01:30:00.000Z");
});
