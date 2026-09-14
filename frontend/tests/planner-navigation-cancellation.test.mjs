import assert from "node:assert/strict";
import test from "node:test";

import { mountPlanner } from "./helpers/planner-harness.mjs";

const pendingLifecycle = (token) => ({
  planner_lifecycle: {
    version: 1,
    state: "warm_pending",
    token,
    retry_after_ms: 3000,
    remaining_ms: 50000,
    max_polls: 20,
  },
});

function routeCalls(h) {
  return h.fetchMock.calls.filter(call => call.url.startsWith('/api/route-recommendations'));
}

async function click(h, pattern) {
  const button = [...h.container.querySelectorAll('button')].find(node => pattern.test(node.textContent));
  assert.ok(button, `button ${pattern} exists`);
  await h.act(() => button.click());
}

const composedDay = {
  days: [{ date: '2026-09-13', experimental_agnostic_route_applied: true,
    primary_route: { id: '__agnostic_compose__', title: 'Preserved day', estimated_km: 2,
      main_stops: ['museum', 'cafe'].map((id, i) => ({ id, label: `Trusted ${id}`, lat: 48 + i * .001, lng: 8,
        type: i ? 'cafe' : 'museum', provenance: { attribution: [{ provider_id: 'osm', label: 'osm' }] } })),
      map_route_points: [], map_path_points: [], legs: [], confidence: 'low' }, alternatives: [] }],
  agnostic_route_output_experiment: { promotion: { promote: true } },
};

async function pageTransition(h, type, persisted = true) {
  await h.act(() => h.window.dispatchEvent(new h.window.PageTransitionEvent(type, { persisted })));
}

test('bfcache return from pending clears waiting, rejects a late poll body, and offers one explicit retry', async t => {
  const token = '1'.repeat(48);
  const h = await plannerWaitingOnColdSupply(t, token);
  await h.clock.advance(3000);
  const poll = h.fetchMock.pending().find(call => call.url === '/api/planner-status');
  assert.ok(poll);
  await h.fetchMock.respond(poll, composedDay, 200, { deferBody: true });
  await pageTransition(h, 'pagehide');
  await pageTransition(h, 'pageshow');
  await h.fetchMock.releaseBody(poll);
  await pageTransition(h, 'pageshow');
  await h.clock.advance(61000);
  assert.doesNotMatch(h.text(), /plan will continue automatically|Composing the day|Trusted museum/i);
  assert.match(h.text(), /paused when you left/i);
  assert.equal(routeCalls(h).length, 1, 'restoration itself never composes');
  assert.equal(h.fetchMock.calls.filter(call => call.url === '/api/planner-status' && call.method === 'POST').length, 1);
  assert.equal(lifecycleDeletes(h).length, 1);
  const retry = [...h.container.querySelectorAll('button')].find(node => /Continue planning/i.test(node.textContent));
  assert.ok(retry);
  await h.act(() => { retry.click(); retry.click(); });
  assert.equal(routeCalls(h).length, 2);
  assert.deepEqual(routeCalls(h)[1].body, routeCalls(h)[0].body);
  await h.fetchMock.respond(routeCalls(h)[1], composedDay);
  assert.match(h.text(), /Trusted museum/);
  assert.doesNotMatch(h.text(), /paused when you left/i);
});

test('bfcache suspends an adjustment debounce, preserves the earlier day and retries current inputs once', async t => {
  const h = await mountPlanner({ url: 'http://localhost/anywhere?place=Testville&lang=en' });
  t.after(() => h.unmount());
  await h.clock.advance(500);
  await h.fetchMock.respond(routeCalls(h)[0], composedDay);
  await click(h, /Adjust/);
  await click(h, /Second hand/);
  await pageTransition(h, 'pagehide');
  await h.clock.advance(1000);
  await pageTransition(h, 'pageshow');
  await h.clock.advance(1000);
  assert.equal(routeCalls(h).length, 1, 'no resumed stale debounce or automatic composition');
  assert.match(h.text(), /Trusted museum/);
  assert.match(h.text(), /paused when you left/i);
  await click(h, /Continue planning/);
  await h.clock.advance(500);
  assert.equal(routeCalls(h).length, 2);
  assert.ok(routeCalls(h)[1].body.preferences.includes('second_hand'));
  assert.equal(routeCalls(h)[1].body.place, 'Testville');
  await h.fetchMock.respond(routeCalls(h)[1], composedDay);
  assert.match(h.text(), /Trusted museum/);
});

test('bfcache during an updating day cancels once and removes the busy state without losing the day', async t => {
  const h = await mountPlanner({ url: 'http://localhost/anywhere?place=Testville&lang=en' });
  t.after(() => h.unmount());
  await h.clock.advance(500);
  await h.fetchMock.respond(routeCalls(h)[0], composedDay);
  await click(h, /Adjust/);
  await click(h, /Second hand/);
  await h.clock.advance(500);
  await h.fetchMock.respond(routeCalls(h)[1], pendingLifecycle('2'.repeat(48)), 202);
  await pageTransition(h, 'pagehide');
  await pageTransition(h, 'pageshow');
  await h.clock.advance(61000);
  assert.match(h.text(), /Trusted museum/);
  assert.doesNotMatch(h.text(), /Updating your day|plan will continue automatically/i);
  assert.equal(h.container.querySelector('[aria-busy="true"]'), null);
  assert.equal(lifecycleDeletes(h).length, 1);
  await click(h, /Continue planning/);
  assert.equal(routeCalls(h).length, 3);
});

test('bfcache return with a completed day preserves it without cancellation, retry notice or composition', async t => {
  const h = await mountPlanner({ url: 'http://localhost/anywhere?place=Testville&lang=en' });
  t.after(() => h.unmount());
  await h.clock.advance(500);
  await h.fetchMock.respond(routeCalls(h)[0], composedDay);
  await pageTransition(h, 'pagehide');
  await pageTransition(h, 'pageshow');
  await h.clock.advance(61000);
  assert.match(h.text(), /Trusted museum/);
  assert.doesNotMatch(h.text(), /paused when you left/i);
  assert.equal(routeCalls(h).length, 1);
  assert.equal(lifecycleDeletes(h).length, 0);
});

test('bfcache return never revives a scheduled Live follow-up composition', async t => {
  const h = await mountPlanner({ url: 'http://localhost/anywhere?place=Testville&lang=en' });
  t.after(() => h.unmount());
  await h.clock.advance(500);
  await h.fetchMock.respond(routeCalls(h)[0], { ...composedDay, live_events: { pending: true } });
  await pageTransition(h, 'pagehide');
  await pageTransition(h, 'pageshow');
  await h.clock.advance(61000);
  assert.equal(routeCalls(h).length, 1);
  assert.match(h.text(), /Trusted museum/);
});

async function plannerWaitingOnColdSupply(t, token) {
  const h = await mountPlanner({
    url: "http://localhost/anywhere?place=Testville&lang=en",
  });
  t.after(() => h.unmount());
  await h.clock.advance(500);
  const initial = h.fetchMock.pending()[0];
  assert.ok(initial, "the initial Planner request exists");
  await h.fetchMock.respond(initial, pendingLifecycle(token), 202);
  assert.match(h.text(), /plan will continue automatically/i);
  return h;
}

function lifecycleDeletes(h) {
  return h.fetchMock.calls.filter(
    (call) => call.url === "/api/planner-status" && call.method === "DELETE",
  );
}

test("Change place synchronously sends one keepalive cancellation before navigation", async (t) => {
  const token = "e".repeat(48);
  const h = await plannerWaitingOnColdSupply(t, token);
  const link = h.container.querySelector('a[aria-label="Change place"]');
  assert.ok(link, "Change place remains available while supply is pending");

  // Keep jsdom on this document after the real target handler has run.
  h.document.addEventListener("click", (event) => event.preventDefault());
  await h.act(() => {
    link.dispatchEvent(new h.window.MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      button: 0,
    }));
  });

  assert.deepEqual(lifecycleDeletes(h).map(({ body, keepalive }) => ({ body, keepalive })), [
    { body: { token }, keepalive: true },
  ]);
});

test("pagehide sends one keepalive cancellation for direct or history navigation", async (t) => {
  const token = "f".repeat(48);
  const h = await plannerWaitingOnColdSupply(t, token);

  await h.act(() => {
    h.window.dispatchEvent(new h.window.Event("pagehide"));
    h.window.dispatchEvent(new h.window.Event("pagehide"));
  });

  assert.deepEqual(lifecycleDeletes(h).map(({ body, keepalive }) => ({ body, keepalive })), [
    { body: { token }, keepalive: true },
  ]);
});
