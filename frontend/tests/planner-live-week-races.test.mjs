import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { mountPlanner } from './helpers/planner-harness.mjs';

const future = { id: 'future-concert', title: 'Listed Monday concert',
  starts_at: '2026-10-26T17:00:00Z', timezone: 'Europe/Copenhagen',
  source_label: 'Library calendar', source_url: 'https://calendar.example/event', route_eligible: false };
function live({ pending = false, today = [] } = {}) {
  return { coverage: 'covered', selected_date: '2026-10-25', pending,
    tonight: today, this_week: pending ? [] : [future],
    acquisition: { source_health: { status: pending ? 'pending' : 'partial', result: pending ? 'pending' : 'events_found',
      selected_source_count: 3, responding_source_count: pending ? 0 : 1,
      event_bearing_source_count: pending ? 0 : 1, empty_source_count: 0,
      failed_source_count: pending ? 0 : 1, unavailable_source_count: pending ? 0 : 1,
      raw_event_count: pending ? 0 : 1, normalized_event_count: pending ? 0 : 1,
      accepted_event_count: pending ? 0 : 1, surfaced_event_count: pending ? 0 : 1,
      rejected_event_count: 0, reasons: pending ? [] : ['source_failures_present'] } } };
}
function day(events) {
  return { days: [{ date: events.selected_date, experimental_agnostic_route_applied: true,
    primary_route: { id: '__agnostic_compose__', title: 'Published plan', estimated_km: 1,
      main_stops: [{ id: 'a', label: 'Museum', lat: 55.68, lng: 12.57 },
        { id: 'b', label: 'Cafe', lat: 55.681, lng: 12.571 }], legs: [], map_path_points: [] }, alternatives: [] }],
    agnostic_route_output_experiment: { promotion: { promote: true }, intake: { query: 'Testville' },
      source_status: { anchor: { lat: 55.68, lng: 12.57 } } }, live_events: events,
    ...(events.pending ? { live_completion: { version: 1, token: 'a'.repeat(48), expires_in_ms: 120000 } } : {}) };
}
const queries = h => h.fetchMock.calls.filter(c => c.url.startsWith('/api/live-events'));
const routes = h => h.fetchMock.calls.filter(c => c.url.includes('route-recommendations'));
const button = (h, title) => [...h.container.querySelectorAll('button')].find(b => b.textContent.trim() === title);
async function click(h, title) {
  const b = button(h, title); assert.ok(b, title); assert.equal(b.disabled, false, title);
  await h.act(() => b.dispatchEvent(new h.window.Event('click', { bubbles: true })));
}
const pressed = (h, title) => button(h, title).getAttribute('aria-pressed');
const query = events => ({ contract: 'live_event_query_v1', route_mutation: false, day_anchor_mutation: false, live_events: events });
const completion = events => ({ live_events: events, live_completion: { version: 1, state: 'ready', route_upgrade: 'not_supported' } });
async function start(t, events = live({ pending: true })) {
  const h = await mountPlanner({ url: 'http://localhost/anywhere?place=Testville&lang=en' });
  t.after(() => h.unmount()); await h.clock.advance(500);
  await h.fetchMock.respond(routes(h)[0], day(events)); await h.clock.advance(50);
  await click(h, 'Explore live'); return h;
}
async function close(h) {
  const b = h.container.querySelector('[aria-label="Close live"]'); assert.ok(b);
  await h.act(() => b.dispatchEvent(new h.window.Event('click', { bubbles: true })));
}
async function read(h) {
  await h.clock.advance(2000);
  const c = h.fetchMock.calls.find(c => c.url === '/api/planner-live-completion'); assert.ok(c);
  return c;
}

for (const order of ['before-query', 'after-query']) test(`real completion ${order} preserves explicit selected day and reopen`, async t => {
  const h = await start(t); await click(h, 'Sun 25 Oct');
  const manual = queries(h).at(-1), c = await read(h);
  if (order === 'before-query') await h.fetchMock.respond(c, completion(live()));
  await h.fetchMock.respond(manual, query(live()));
  if (order === 'after-query') await h.fetchMock.respond(c, completion(live()));
  assert.equal(pressed(h, 'Sun 25 Oct'), 'true');
  await close(h); await click(h, 'See all live');
  assert.equal(pressed(h, 'Sun 25 Oct'), 'true');
  assert.equal(queries(h).at(-1).body.time, 'tonight'); assert.equal(routes(h).length, 1);
});

for (const order of ['before-query', 'after-query']) test(`real completion ${order} preserves explicit near-route scope, period and reopen`, async t => {
  const h = await start(t);
  const today = { ...future, id: 'today', title: 'Sunday event', starts_at: '2026-10-25T17:00:00Z' };
  await h.fetchMock.respond(queries(h).at(-1), query(live({ today: [today] })));
  await click(h, 'Near the route'); const scoped = queries(h).at(-1), c = await read(h);
  if (order === 'before-query') await h.fetchMock.respond(c, completion(live()));
  await h.fetchMock.respond(scoped, query(live()));
  if (order === 'after-query') await h.fetchMock.respond(c, completion(live()));
  assert.equal(pressed(h, 'Near the route'), 'true'); assert.equal(pressed(h, 'Sun 25 Oct'), 'true');
  await close(h); await click(h, 'See all live');
  assert.equal(pressed(h, 'Near the route'), 'true'); assert.equal(pressed(h, 'Sun 25 Oct'), 'true');
  assert.equal(queries(h).at(-1).body.scope, 'near_route'); assert.equal(queries(h).at(-1).body.time, 'tonight');
  assert.equal(routes(h).length, 1);
});

test('late automatic week query body cannot overwrite a newer explicit selected-day query', async t => {
  const h = await start(t), initial = queries(h).at(-1), c = await read(h);
  await h.fetchMock.respond(c, completion(live())); await h.fetchMock.respond(initial, query(live()));
  const automatic = queries(h).at(-1); assert.equal(automatic.body.time, 'this_week');
  await h.fetchMock.respond(automatic, query(live()), 200, { deferBody: true });
  await click(h, 'Sun 25 Oct'); const manual = queries(h).at(-1);
  assert.equal(automatic.aborted, true); await h.fetchMock.releaseBody(automatic);
  await h.fetchMock.respond(manual, query(live()));
  assert.equal(pressed(h, 'Sun 25 Oct'), 'true'); assert.equal(routes(h).length, 1);
});

// The genuine backend fixture contains an applied final weave. This checks an
// actual safeResponse replacement, distinct from completion's completedLive update.
const wire = JSON.parse(readFileSync(new URL('./fixtures/live-wire-81d2ad7.json', import.meta.url), 'utf8')).fixtures;
const wireBody = name => structuredClone(wire[name].body);
for (const period of ['Sun 28 Jun', 'Next 7 days']) test(`real applied upgrade preserves the open manually chosen period (${period})`, async t => {
  const events = { ...wireBody('completion_pending').live_events, selected_date: '2026-06-28', pending: true, tonight: [], this_week: [] };
  const h = await mountPlanner({ url: 'http://localhost/anywhere?place=Testville&lang=en' }); t.after(() => h.unmount());
  await h.clock.advance(500); const body = day(events); body.live_completion.route_upgrade = 'explicit_request';
  const applied = wireBody('upgrade_applied');
  body.agnostic_route_output_experiment.source_status.anchor = structuredClone(applied.result.agnostic_route_output_experiment.source_status.anchor);
  body.days[0].primary_route.main_stops = structuredClone(applied.result.days[0].primary_route.main_stops.filter(stop => !stop.event_id));
  await h.fetchMock.respond(routes(h)[0], body); await h.clock.advance(50); await click(h, 'Explore live'); await click(h, period);
  const terminal = wireBody('completion_ready'), e = terminal.live_events;
  const later = { ...e.tonight[0], id: 'later', title: 'Later concert', starts_at: '2026-06-29T18:00:00Z',
    time_window: { kind: 'continuous', starts_at: '2026-06-29T18:00:00Z' }, route_eligible: false };
  e.this_week = [later]; await h.fetchMock.respond(queries(h).at(-1), query(e));
  await h.fetchMock.respond(await read(h), terminal);
  const upgrade = h.fetchMock.calls.find(c => c.url === '/api/planner-live-route-upgrade'); assert.ok(upgrade);
  applied.result.live_events.this_week = [later];
  await h.fetchMock.respond(upgrade, applied);
  assert.equal(pressed(h, period), 'true'); assert.match(h.text(), /Changed: Live: event added/); assert.equal(routes(h).length, 1);
});

for (const scope of ['Around the place', 'Near the route', 'Near me']) for (const period of ['Sun 28 Jun', 'Next 7 days']) {
  test(`same-question upgrade retains ${scope} × ${period} through reopen and rejects the old geometry body`, async t => {
    const applied = wireBody('upgrade_applied');
    const events = { ...wireBody('completion_pending').live_events, selected_date: '2026-06-28', pending: true, tonight: [], this_week: [] };
    const original = day(events); original.live_completion.route_upgrade = 'explicit_request';
    original.agnostic_route_output_experiment.source_status.anchor = structuredClone(applied.result.agnostic_route_output_experiment.source_status.anchor);
    original.days[0].primary_route.main_stops = structuredClone(applied.result.days[0].primary_route.main_stops.filter(stop => !stop.event_id));
    const h = await mountPlanner({ url: 'http://localhost/anywhere?place=Testville&lang=en' }); t.after(() => h.unmount());
    let permissions = 0;
    Object.defineProperty(h.window.navigator, 'geolocation', { configurable: true, value: {
      getCurrentPosition(success) { permissions += 1; success({ coords: { latitude: 60.18, longitude: 24.95 } }); },
    } });
    await h.clock.advance(500); await h.fetchMock.respond(routes(h)[0], original); await h.clock.advance(50);
    await click(h, 'Explore live'); await click(h, period);
    const terminal = wireBody('completion_ready');
    const later = { ...terminal.live_events.tonight[0], id: 'later', title: 'Later concert', starts_at: '2026-06-29T18:00:00Z',
      time_window: { kind: 'continuous', starts_at: '2026-06-29T18:00:00Z' }, route_eligible: false };
    terminal.live_events.this_week = [later]; applied.result.live_events.this_week = [later];
    await h.fetchMock.respond(queries(h).at(-1), query(terminal.live_events));
    let obsolete = null;
    if (scope !== 'Around the place') {
      await click(h, scope); obsolete = queries(h).at(-1);
      const oldEvents = structuredClone(terminal.live_events);
      oldEvents.tonight = [{ ...oldEvents.tonight[0], title: 'Obsolete geometry event' }];
      oldEvents.this_week = [{ ...later, title: 'Obsolete geometry event' }];
      await h.fetchMock.respond(obsolete, query(oldEvents), 200, { deferBody: true });
    } else await close(h); // also retain the cell when the upgrade arrives hidden
    await h.fetchMock.respond(await read(h), terminal);
    const upgrade = h.fetchMock.calls.find(c => c.url === '/api/planner-live-route-upgrade'); assert.ok(upgrade);
    await h.fetchMock.respond(upgrade, applied);
    if (obsolete) {
      assert.equal(obsolete.aborted, true, 'geometry replacement aborts the old query');
      await h.fetchMock.releaseBody(obsolete);
      assert.equal(pressed(h, scope), 'true'); assert.equal(pressed(h, period), 'true');
      const refreshed = queries(h).at(-1);
      assert.notEqual(refreshed, obsolete);
      assert.equal(refreshed.body.scope, scope === 'Near me' ? 'near_me' : 'near_route');
      if (scope === 'Near me') assert.deepEqual(refreshed.body.anchor, { lat: 60.18, lng: 24.95 });
      else assert.deepEqual(refreshed.body.route_points, applied.result.days[0].primary_route.main_stops.map(({ lat, lng }) => ({ lat, lng })));
      await h.fetchMock.respond(refreshed, query(applied.result.live_events));
      assert.doesNotMatch(h.text(), /Obsolete geometry event/);
      await close(h);
    }
    await click(h, 'See all live');
    if (scope !== 'Around the place') assert.equal(pressed(h, scope), 'true');
    assert.equal(pressed(h, period), 'true');
    assert.equal(queries(h).at(-1).body.scope, scope === 'Near me' ? 'near_me' : scope === 'Near the route' ? 'near_route' : 'around_place');
    assert.equal(queries(h).at(-1).body.time, period === 'Next 7 days' ? 'this_week' : 'tonight');
    if (scope === 'Near me') {
      assert.deepEqual(queries(h).at(-1).body.anchor, { lat: 60.18, lng: 24.95 });
      assert.equal(permissions, 1, 'the same Live-only consent survives the upgrade and reopen');
    }
    assert.equal(routes(h).length, 1, 'cell preservation never composes another day');
  });
}
