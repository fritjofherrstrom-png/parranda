import test from 'node:test';
import assert from 'node:assert/strict';
import { extractLiveCompletion, readLiveCompletion } from '../src/lib/planner-live-completion.mjs';
const token = 'b'.repeat(48);
const capability = { token, expires_in_ms: 120000 };
const health = { status: 'healthy', result: 'empty', reasons: [], selected_source_count: 1, responding_source_count: 1, event_bearing_source_count: 0, empty_source_count: 1, failed_source_count: 0, unavailable_source_count: 0, raw_event_count: 0, normalized_event_count: 0, accepted_event_count: 0, surfaced_event_count: 0, rejected_event_count: 0 };
const events = { selected_date: '2026-10-09', pending: false, coverage: 'covered', tonight: [], this_week: [], acquisition: { source_health: health } };
const response = body => ({ status: 200, json: async () => body });
const body = () => ({ live_events: structuredClone(events), live_completion: { version: 1, state: 'ready', route_upgrade: 'not_supported' } });

test('legacy answers do not acquire a capability and extraction strips malformed capability without mutating input', () => {
  assert.equal(extractLiveCompletion({ days: [] }).capability, null);
  for (const candidate of [null, {version: 2, token}, {version: 1, token: 'url'}, {version: 1, token, expires_in_ms: 0}]) {
    const input = { days: [], live_completion: candidate }; const before = structuredClone(input);
    assert.deepEqual(extractLiveCompletion(input), { body: {days: []}, capability: null });
    assert.deepEqual(input, before);
  }
});

test('expired capability stops before read even if expiry is shorter than the first retry delay', async () => {
  let time = 0; let calls = 0;
  const ready = await readLiveCompletion({ capability: {...capability, expires_in_ms: 10},
    signal: new AbortController().signal, selectedDate: events.selected_date,
    now: () => time, wait: async delay => { time += delay; }, isCurrent: () => true,
    onReady: () => assert.fail('expired body must not install'), fetcher: async () => { calls++; return response(body()); } });
  assert.equal(ready, false); assert.equal(calls, 0);
});

test('malformed completion cannot manufacture healthy-empty evidence', async () => {
  const invalid = body(); delete invalid.live_events.acquisition;
  const ready = await readLiveCompletion({ capability, signal: new AbortController().signal,
    selectedDate: events.selected_date, wait: async () => {}, isCurrent: () => true,
    onReady: () => assert.fail('unknown source health must not install'), fetcher: async () => response(invalid) });
  assert.equal(ready, false);
});
