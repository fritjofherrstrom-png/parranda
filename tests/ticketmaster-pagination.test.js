"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createTicketmasterProvider } = require("../server/pulse-sources/ticketmaster-source-provider");

const NOW = "2026-10-21T10:00:00Z";
const ENDPOINT = "https://provider.example/discovery/v2/events.json?locale=*&page=99";

function event(id, dateTime = "2026-10-25T18:00:00Z", name = "Published booking") {
  return {
    id, name, url: `https://www.ticketmaster.com/event/${id}`,
    dates: {
      start: { dateTime }, end: { dateTime: "2026-10-25T21:00:00Z" },
      timezone: "Europe/Stockholm", status: { code: "onsale" },
    },
    classifications: [{ segment: { name: "Music" } }],
    _embedded: { venues: [{ name: "Published venue", location: { latitude: "59.3326", longitude: "18.0649" } }] },
  };
}

function page(events, number, totalPages, totalElements) {
  return { _embedded: { events }, page: { size: 40, number, totalPages, totalElements } };
}

function response(body) {
  return { ok: true, status: 200, json: async () => body };
}

function collect(fetcher, options = {}) {
  return createTicketmasterProvider({
    key: "fixture-only-key", endpoint: ENDPOINT,
    anchor: { lat: 59.3326, lng: 18.0649 }, now: NOW, fetcher, ...options,
  }).create().collect();
}

function sequence(bodies, calls = []) {
  return async (url, options) => {
    calls.push({ url: new URL(url), signal: options.signal });
    const body = bodies[calls.length - 1];
    assert.notEqual(body, undefined, "collection must stop within its advertised pages");
    return typeof body === "function" ? body() : response(body);
  };
}

function assertTruncated(result, ids) {
  assert.deepEqual(result.time_sensitive_events.map(row => row.source_occurrence_id), ids);
  assert.deepEqual(result.collection_status, {
    status: ids.length ? "ok" : "failed", reason: "source_collection_truncated", event_rows: ids.length,
  });
}

// A missing later-page fetch loses genuine occurrences; merging by title would
// also incorrectly erase two separately published bookings of the same show.
test("Ticketmaster collects two pages and keeps distinct occurrence identities and facts", async () => {
  const calls = [];
  const result = await collect(sequence([
    page([event("slot-a"), event("slot-a")], 0, 2, 5),
    page([event("slot-a"), event("slot-b", "2026-10-25T19:00:00Z"), event("other", "2026-10-25T20:00:00Z", "Another program")], 1, 2, 5),
  ], calls));
  assert.deepEqual(result.time_sensitive_events.map(row => row.source_occurrence_id), ["slot-a", "slot-b", "other"]);
  assert.deepEqual(result.time_sensitive_events.map(row => row.starts_at), [
    "2026-10-25T18:00:00Z", "2026-10-25T19:00:00Z", "2026-10-25T20:00:00Z",
  ]);
  const second = result.time_sensitive_events[1];
  assert.equal(second.source_url, "https://www.ticketmaster.com/event/slot-b");
  assert.equal(second.ends_at, "2026-10-25T21:00:00Z");
  assert.equal(second.timezone, "Europe/Stockholm");
  assert.equal(second.place_context, "Published venue");
  assert.deepEqual(second.tags, ["music"]);
  assert.deepEqual(result.collection_status, { status: "ok", reason: null, event_rows: 3 });
  assert.deepEqual(calls.map(call => call.url.searchParams.get("page")), ["0", "1"]);
});

test("Ticketmaster stops at three pages and reports the remaining advertised inventory", async () => {
  const calls = [];
  const bodies = [0, 1, 2, 3].map(number => page(
    Array.from({ length: 40 }, (_, index) => event(`page-${number}-row-${index}`)), number, 4, 160,
  ));
  const result = await collect(sequence(bodies, calls));
  assert.equal(calls.length, 3);
  assert.equal(result.time_sensitive_events.length, 120);
  assert.equal(result.time_sensitive_events[119].source_occurrence_id, "page-2-row-39");
  assert.deepEqual(result.collection_status, { status: "ok", reason: "source_collection_truncated", event_rows: 120 });
});

test("Ticketmaster marks an oversized source page truncated while bounding retained rows", async () => {
  const result = await collect(sequence([page(
    Array.from({ length: 121 }, (_, index) => event(`row-${index}`)), 0, 1, 121,
  )]));
  assert.ok(result.time_sensitive_events.length <= 120);
  assert.equal(result.collection_status.reason, "source_collection_truncated");
});

test("Ticketmaster stops a repeated page without inventing successful exhaustion", async () => {
  const calls = [];
  const result = await collect(sequence([
    page([event("first")], 0, 5, 5),
    page([event("first")], 1, 5, 5),
  ], calls));
  assertTruncated(result, ["first"]);
  assert.equal(calls.length, 2);
});

test("Ticketmaster stops mismatched page numbering and retains earlier usable events", async () => {
  const calls = [];
  const result = await collect(sequence([
    page([event("first")], 0, 5, 5),
    page([event("first")], 0, 5, 5),
  ], calls));
  assertTruncated(result, ["first"]);
  assert.equal(calls.length, 2);
});

for (const [label, later] of [
  ["HTTP 429", () => ({ ok: false, status: 429 })],
  ["invalid JSON", () => ({ ok: true, json: async () => { throw new SyntaxError("invalid fixture JSON"); } })],
  ["malformed event list", { _embedded: { events: {} } }],
  ["unusable event rows", page([{ id: "broken", name: "Missing venue facts" }], 1, 2, 2)],
  ["empty non-progress page", page([], 1, 3, 3)],
]) {
  test(`Ticketmaster retains obtained events after later ${label}`, async () => {
    const calls = [];
    const result = await collect(sequence([page([event("first")], 0, 3, 3), later], calls));
    assertTruncated(result, ["first"]);
    assert.equal(calls.length, 2, "later failures do not add retries");
  });
}

test("Ticketmaster uses one 15 second budget across sequential pages", async t => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 0 });
  const calls = [];
  let finished = false;
  const pending = collect(async (url, { signal }) => {
    calls.push({ url, signal });
    if (calls.length === 1) {
      await new Promise(resolve => setTimeout(resolve, 12000));
      return response(page([event("first")], 0, 3, 3));
    }
    return new Promise((_resolve, reject) => {
      const abort = () => reject(Object.assign(new Error("Fixture request aborted"), { name: "AbortError" }));
      if (signal.aborted) abort();
      else signal.addEventListener("abort", abort, { once: true });
    });
  }).then(value => { finished = true; return value; });
  t.mock.timers.tick(12000);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls.length, 2, "second page starts after the first page, inside the shared budget");
  assert.equal(calls[0].signal, calls[1].signal, "the same abort signal owns every page");
  t.mock.timers.tick(2999);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(finished, false);
  t.mock.timers.tick(1);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(finished, true, "the second page receives only the remaining 3 seconds");
  assertTruncated(await pending, ["first"]);
  assert.equal(calls.length, 2);
});

test("Ticketmaster starts no later page after its shared budget has expired", async t => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 0 });
  let calls = 0;
  const result = await collect(async () => {
    calls += 1;
    return { ok: true, json: async () => {
      t.mock.timers.tick(15000);
      return page([event("first")], 0, 3, 3);
    } };
  });
  assert.equal(calls, 1);
  assert.deepEqual(result.time_sensitive_events, [], "a page completed at the deadline is not admitted as pre-deadline evidence");
  assert.equal(result.collection_status.reason, "source_timeout");
});

test("Ticketmaster constructs numeric pages on its configured endpoint instead of following next URLs", async () => {
  const calls = [];
  const result = await collect(sequence([
    { _embedded: { events: [event("first")] }, _links: { next: { href: "https://attacker.example/steal?apikey=replace-me&page=17" } } },
    page([event("second")], 1, 2, 2),
  ], calls));
  assert.deepEqual(result.time_sensitive_events.map(row => row.source_occurrence_id), ["first", "second"]);
  assert.deepEqual(calls.map(call => call.url.origin), ["https://provider.example", "https://provider.example"]);
  assert.deepEqual(calls.map(call => call.url.pathname), ["/discovery/v2/events.json", "/discovery/v2/events.json"]);
  assert.deepEqual(calls.map(call => call.url.searchParams.get("page")), ["0", "1"]);
  for (const { url } of calls) {
    assert.equal(url.searchParams.get("apikey"), "fixture-only-key");
    assert.equal(url.searchParams.get("locale"), "*");
    assert.equal(url.searchParams.get("size"), "40");
    assert.equal(url.searchParams.get("startDateTime"), "2026-10-21T10:00:00Z");
    assert.equal(url.searchParams.get("endDateTime"), "2026-10-28T10:00:00Z");
  }
});

test("Ticketmaster uses a stated total count when totalPages is absent", async () => {
  const calls = [];
  const result = await collect(sequence([
    { _embedded: { events: [event("first")] }, page: { number: 0, totalElements: 2 } },
    { _embedded: { events: [event("second")] }, page: { number: 1, totalElements: 2 } },
  ], calls));
  assert.deepEqual(result.time_sensitive_events.map(row => row.source_occurrence_id), ["first", "second"]);
  assert.equal(result.collection_status.reason, null);
  assert.equal(calls.length, 2);
});

test("Ticketmaster retains earlier pagination evidence when a later page omits metadata", async () => {
  const calls = [];
  const result = await collect(sequence([
    page([event("first")], 0, 3, 3),
    { _embedded: { events: [event("second")] } },
    page([event("third")], 2, 3, 3),
  ], calls));
  assert.deepEqual(result.time_sensitive_events.map(row => row.source_occurrence_id), ["first", "second", "third"]);
  assert.deepEqual(result.collection_status, { status: "ok", reason: null, event_rows: 3 });
  assert.equal(calls.length, 3, "a later omission cannot cancel previously stated remaining inventory");
});

test("Ticketmaster preserves single-page compatibility without pagination evidence", async () => {
  const calls = [];
  const result = await collect(sequence([{ _embedded: { events:
    Array.from({ length: 40 }, (_, index) => event(`row-${index}`)),
  } }], calls));
  assert.equal(calls.length, 1);
  assert.deepEqual(result.collection_status, { status: "ok", reason: null, event_rows: 40 });
});

test("Ticketmaster preserves unidentified rows instead of treating missing IDs as one occurrence", async () => {
  const first = event("first");
  const second = event("second", "2026-10-25T19:00:00Z");
  delete first.id;
  delete second.id;
  const result = await collect(sequence([page([first], 0, 2, 2), page([second], 1, 2, 2)]));
  assert.deepEqual(result.time_sensitive_events.map(row => row.starts_at), ["2026-10-25T18:00:00Z", "2026-10-25T19:00:00Z"]);
  assert.equal(result.collection_status.reason, null);
});

test("Ticketmaster first-page failures keep their existing specific reasons", async t => {
  for (const [label, failure, reason] of [
    ["HTTP 429", async () => ({ ok: false, status: 429 }), "source_http_429"],
    ["malformed payload", async () => response({ _embedded: { events: {} } }), "source_payload_invalid"],
    ["timeout", async () => { throw Object.assign(new Error("fixture timeout"), { name: "AbortError" }); }, "source_timeout"],
  ]) {
    await t.test(label, async () => {
      const result = await collect(failure);
      assert.deepEqual(result.time_sensitive_events, []);
      assert.deepEqual(result.collection_status, { status: "failed", reason, event_rows: 0 });
    });
  }
});

for (const later of [false, true]) {
  test(`Ticketmaster rejects a ${later ? 'final later' : 'first and final'} page whose JSON completes after the shared deadline`, async t => {
    t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 0 });
    let calls = 0;
    const result = await collect(async () => {
      calls += 1;
      if (later && calls === 1) return response(page([event('before-deadline')], 0, 2, 2));
      return { ok: true, json: async () => {
        t.mock.timers.tick(15000);
        return page([event('after-deadline')], later ? 1 : 0, later ? 2 : 1, later ? 2 : 1);
      } };
    });
    assert.deepEqual(result.time_sensitive_events.map(row => row.source_occurrence_id), later ? ['before-deadline'] : []);
    assert.equal(result.collection_status.reason, later ? 'source_collection_truncated' : 'source_timeout');
  });
}

// Same source identity can carry a later cancellation. Only truly identical
// facts may be collapsed; otherwise downstream conflict/stale gates need both.
test('Ticketmaster preserves changed facts on repeated identities across pages', async () => {
  const first=event('updated'),cancelled=structuredClone(first);
  cancelled.dates.status.code='cancelled';
  const result=await collect(sequence([page([first],0,2,2),page([cancelled],1,2,2)]));
  assert.equal(result.time_sensitive_events.length,2);
  assert.deepEqual(result.time_sensitive_events.map(row=>row.freshness),['stale','stale']);
});

test('a cancellation without a stated occurrence identity cannot stale unrelated unidentified rows', async () => {
  const active=event(''),cancelled=event('');cancelled.name='Another source programme';cancelled.url='https://tickets.example/another';cancelled.dates.status.code='cancelled';
  const result=await collect(sequence([page([active,cancelled],0,1,2)]));
  assert.deepEqual(result.time_sensitive_events.map(row=>row.freshness),[null,'stale']);
});
