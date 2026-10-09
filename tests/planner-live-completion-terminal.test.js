"use strict";
const assert = require('node:assert/strict');
const test = require('node:test');
const { resolveDefaultEventSupply, HELSINKI_LINKED_EVENTS_FEED } = require('../server/place-candidates/agnostic-event-supply');
const { LIVE_COLLECTION_READ, createLiveCompletionStore } = require('../server/planner/live-completion');

function deferred() {
  let resolve, reject;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
}
const tick = () => new Promise(resolve => setImmediate(resolve));
const input = {
  anchor: { lat: 60.17, lng: 24.94 }, selectedDate: '2026-06-28',
  now: '2026-06-28T12:00:00Z', placeContext: { name: 'Fixture' }, spatialScope: { kind: 'fixture' },
};
function setup() {
  const jobs = [];
  let clock = 0;
  const supply = resolveDefaultEventSupply({
    PARRANDA_AGNOSTIC_EVENTS: 'enabled', PARRANDA_EVENT_FEEDS: JSON.stringify([HELSINKI_LINKED_EVENTS_FEED]),
  }, {
    sourceCatalog: { listApprovedEventFeedsForAnchor: async () => [], recordScoutDemand: async () => null },
    failedRefreshClock: () => clock,
    collectEvents: async () => { const job = deferred(); jobs.push(job); return job.promise; },
  });
  return { supply, jobs, expireFailure: () => { clock = 120000; } };
}
// Deliberately not healthy-empty: this result must not acquire healthy absence semantics.
function partialResult() {
  return {
    coverage: 'covered', selected_date: '2026-06-28', feed: { id: 'later-partial' }, feeds: [],
    tonight: [], this_week: [], acquisition: { source_health: {
      status: 'partial', result: 'unknown', failed_source_count: 1, responding_source_count: 1,
      reasons: ['source_failures_present'],
    } },
  };
}

test('null collection with discovery health settles unavailable and releases its same-key generation', async () => {
  const h = setup();
  const first = await h.supply(input);
  assert.equal(first.pending, true);
  assert.ok(first.acquisition.discovery_health, 'non-null discovery health normalization branch reached');
  assert.equal(h.jobs.length, 1);
  const store = createLiveCompletionStore();
  const old = store.issue(first);
  assert.equal(store.read(old.token).status, 202);
  h.jobs[0].resolve(null);
  await tick();
  assert.equal(store.read(old.token).status, 503, 'finished invalid producer is terminal, not abandoned pending');
  assert.equal(store.read(old.token).body.live_events, undefined);

  const later = await h.supply(input);
  assert.equal(later.pending, true);
  assert.equal(h.jobs.length, 2, 'same key starts a new producer after invalid completion');
  const next = store.issue(later);
  assert.equal(store.read(next.token).status, 202);
  assert.equal(first[LIVE_COLLECTION_READ](), null, 'original producer stays invalid during later refresh');
  h.jobs[1].resolve(partialResult());
  await tick();
  const ready = store.read(next.token);
  assert.equal(ready.status, 200);
  assert.equal(ready.body.live_events.feed.id, 'later-partial');
  assert.equal(ready.body.live_events.acquisition.source_health.status, 'partial');
  assert.equal(ready.body.live_completion.route_upgrade, 'not_supported');
  assert.equal(store.read(old.token).status, 503, 'late same-key completion cannot replace old terminal failure');
  assert.equal(first[LIVE_COLLECTION_READ](), null);
  assert.equal(h.jobs.length, 2, 'completion reads never acquire');
});

test('thrown source failure retains health across hold expiry and late same-key refresh', async () => {
  const h = setup();
  const first = await h.supply(input);
  assert.equal(first.pending, true);
  assert.ok(first.acquisition.discovery_health, 'source failure also reaches discovery health branch');
  const store = createLiveCompletionStore();
  const old = store.issue(first);
  h.jobs[0].reject(new Error('fixture source transport failure'));
  await tick();
  const failed = first[LIVE_COLLECTION_READ]();
  assert.equal(failed.pending, undefined);
  assert.equal(failed.acquisition.source_health.status, 'unavailable');
  assert.equal(failed.acquisition.source_health.failed_source_count, 1);
  assert.ok(failed.acquisition.source_health.reasons.includes('source_failures_present'));
  assert.notEqual(failed.acquisition.source_health.result, 'empty');
  assert.ok(failed.acquisition.discovery_health);
  const held = await h.supply(input);
  assert.equal(held.pending, undefined, 'source failures retain their bounded hold semantics');
  assert.equal(held.acquisition.source_health.failed_source_count, 1);
  assert.equal(h.jobs.length, 1);

  h.expireFailure();
  const later = await h.supply(input);
  assert.equal(later.pending, true);
  assert.equal(h.jobs.length, 2, 'expired failed hold permits a new generation');
  const next = store.issue(later);
  assert.equal(store.read(next.token).status, 202);
  assert.deepEqual(first[LIVE_COLLECTION_READ](), failed, 'pending refresh cannot mutate old source failure');
  h.jobs[1].resolve(partialResult());
  await tick();
  const ready = store.read(next.token);
  assert.equal(ready.status, 200);
  assert.equal(ready.body.live_events.feed.id, 'later-partial');
  assert.equal(ready.body.live_events.acquisition.source_health.status, 'partial');
  // First completion read is deliberately late: it cannot depend on the store's terminal snapshot.
  const original = store.read(old.token);
  assert.equal(original.status, 200, 'source failure stays a completed sidecar, not invalid-evidence 503');
  assert.equal(original.body.live_events.acquisition.source_health.status, 'unavailable');
  assert.equal(original.body.live_events.acquisition.source_health.failed_source_count, 1);
  assert.ok(original.body.live_events.acquisition.source_health.reasons.includes('source_failures_present'));
  assert.equal(original.body.live_completion.route_upgrade, 'not_supported');
  assert.deepEqual(first[LIVE_COLLECTION_READ](), failed, 'late refresh preserves producer-owned failure');
  assert.deepEqual(store.read(old.token), original);
  assert.equal(h.jobs.length, 2);
});
