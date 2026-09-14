import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchPlannerLifecycle } from '../src/lib/planner-lifecycle.mjs';
const token = 'a'.repeat(48);
const pending = { planner_lifecycle: { version: 1, state: 'warm_pending', token, retry_after_ms: 3000, remaining_ms: 50000, max_polls: 20 } };
const response = (body, status = 200) => ({ status, ok: status < 400, json: async () => body });

test('one submission polls server token only and returns final route without replaying inputs', async () => {
  const calls = []; let waiting = 0;
  const result = await fetchPlannerLifecycle('/api/route-recommendations?lang=sv', {
    payload: { lat: 12, lng: 34, dates: ['2026-09-11'], preferences: ['green'], walking_km_target: 6 },
    signal: new AbortController().signal, onPending: () => waiting++, wait: async () => {},
    fetcher: async (url, init) => { calls.push({ url, ...init }); return calls.length < 3 ? response(pending, 202) : response({ days: ['real'] }); },
  });
  assert.deepEqual(result.body, { days: ['real'] });
  assert.equal(waiting, 2);
  assert.equal(calls.length, 3);
  assert.equal(calls[0].headers.Prefer, 'respond-async');
  assert.deepEqual(calls.slice(1).map(c => [c.url, JSON.parse(c.body)]), [
    ['/api/planner-status', { token }], ['/api/planner-status', { token }],
  ]);
});

test('warm route has no poll or delay', async () => {
  let calls = 0;
  await fetchPlannerLifecycle('/api/route-recommendations?lang=en', {
    payload: {}, signal: new AbortController().signal, wait: () => assert.fail(),
    fetcher: async () => { calls++; return response({ days: ['warm'] }); },
  });
  assert.equal(calls, 1);
});

test('unknown state or hostile token cannot choose a URL or restart composition', async () => {
  let calls = 0;
  await assert.rejects(fetchPlannerLifecycle('/api/route-recommendations', {
    payload: {}, signal: new AbortController().signal,
    fetcher: async () => { calls++; return response({ planner_lifecycle: { ...pending.planner_lifecycle, token: 'https://evil.test' } }, 202); },
  }), /invalid_planner_lifecycle/);
  assert.equal(calls, 1);
});

test('poll cap stays bounded even if server repeatedly extends remaining time', async () => {
  let polls = 0; let cancelled = 0;
  await assert.rejects(fetchPlannerLifecycle('/api/route-recommendations', {
    payload: {}, signal: new AbortController().signal, wait: async () => {},
    fetcher: async (_, init) => { if (init.method === 'DELETE') { cancelled++; return response({}); } polls++; return response(pending, 202); },
  }), /supply_wait_expired/);
  assert.equal(polls, 21); assert.equal(cancelled, 1);
});

test('changed intent aborts polling and cancels the server token', async () => {
  const controller = new AbortController(); const methods = [];
  await assert.rejects(fetchPlannerLifecycle('/api/route-recommendations', {
    payload: {}, signal: controller.signal, wait: async () => { controller.abort(); },
    fetcher: async (_, init) => { methods.push(init.method); return response(pending, 202); },
  }));
  assert.deepEqual(methods, ['POST', 'DELETE']);
});

test('navigation can synchronously claim the token cancellation exactly once', async () => {
  const controller = new AbortController();
  const calls = [];
  let cancelActiveLifecycle;
  await assert.rejects(fetchPlannerLifecycle('/api/route-recommendations', {
    payload: {},
    signal: controller.signal,
    onCancellationReady: cancel => {
      cancelActiveLifecycle = cancel;
      cancel();
      cancel();
    },
    wait: async () => assert.fail('explicit cancellation stops before polling'),
    fetcher: async (url, init) => {
      calls.push({ url, method: init.method, keepalive: init.keepalive === true });
      return response(pending, 202);
    },
  }));
  assert.equal(typeof cancelActiveLifecycle, 'function');
  assert.deepEqual(calls, [
    { url: '/api/route-recommendations', method: 'POST', keepalive: false },
    { url: '/api/planner-status', method: 'DELETE', keepalive: true },
  ]);
});

test('the final partial interval can still deliver a ready day within the fixed deadline', async () => {
  let time = 0; let calls = 0; const delays = [];
  const result = await fetchPlannerLifecycle('/api/route-recommendations', {
    payload: {}, signal: new AbortController().signal, now: () => time,
    wait: async ms => { delays.push(ms); time += ms; },
    fetcher: async () => ++calls === 1
      ? response({ planner_lifecycle: { ...pending.planner_lifecycle, remaining_ms: 2000 } }, 202)
      : response({ days: ['ready'] }),
  });
  assert.deepEqual(delays, [1500]);
  assert.deepEqual(result.body, { days: ['ready'] });
});
