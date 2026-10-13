import assert from 'node:assert/strict';
import test from 'node:test';
import { mountPlanner } from './helpers/planner-harness.mjs';
import { sourceFixture, activityDay, DATE } from './helpers/live-source-integration.mjs';
import { LAST_KEY } from '../src/lib/anywhere-storage.mjs';

// Real provider → collector → v14 cache → completion store/query projection →
// mounted Planner, with a real candidate engine day. HTTP and source HTML are
// controlled boundaries; this is not deployed or live-provider acceptance.
const routes = h => h.fetchMock.calls.filter(call => call.url.includes('route-recommendations'));
const queries = h => h.fetchMock.calls.filter(call => call.url.startsWith('/api/live-events'));
const button = (h, label) => [...h.container.querySelectorAll('button')].find(b => b.textContent.trim() === label);
const pressed = (h, label) => button(h, label)?.getAttribute('aria-pressed');
async function click(h, label) {
  const target = button(h, label);
  assert.ok(target, label);
  assert.equal(target.disabled, false);
  await h.act(() => target.dispatchEvent(new h.window.Event('click', { bubbles: true })));
}
async function close(h) {
  const target = h.container.querySelector('[aria-label="Close live"]');
  assert.ok(target);
  await h.act(() => target.dispatchEvent(new h.window.Event('click', { bubbles: true })));
}
async function mount(t, body) {
  const h = await mountPlanner({ url: 'http://localhost/anywhere?place=Testville&lang=en' });
  t.after(() => h.unmount());
  await h.clock.advance(500);
  assert.equal(routes(h)[0].body.place, 'Testville');
  assert.ok(!('lat' in routes(h)[0].body) && !('lng' in routes(h)[0].body));
  await h.fetchMock.respond(routes(h)[0], body);
  await h.clock.advance(50);
  return h;
}
const occurrences = live => [...live.this_week, ...(live.browse?.this_week?.more || [])]
  .flatMap(row => row.occurrences?.length ? row.occurrences : [row]);
function datesFor(live, title) {
  return occurrences(live).filter(row => row.title === title).map(row => row.time_window.dates[0]).sort();
}

test('cold source completion selects following days with every stated occurrence while the activity day stays intact', async t => {
  const fixture = await sourceFixture(); t.after(() => fixture.dispose());
  const body = await activityDay(fixture.pending, fixture.capability);
  const before = structuredClone(body.days);
  const h = await mount(t, body);
  const publishedDay = h.readStorage(LAST_KEY).safeResponse.days;
  assert.deepEqual(publishedDay, JSON.parse(JSON.stringify(before)),
    'the composed activity day is published through the JSON storage boundary');
  await click(h, 'Explore live');
  assert.equal(pressed(h, 'Sun 25 Oct'), 'true', 'pending is not a verified empty day');
  const first = queries(h).at(-1);
  await h.clock.advance(2000);
  const completion = h.fetchMock.calls.find(call => call.url === '/api/planner-live-completion');
  assert.ok(completion);
  assert.equal(fixture.completion.read(completion.body.token).status, 202);
  fixture.release();
  const ready = await fixture.ready();
  assert.deepEqual(datesFor(ready, 'Local workshop series'), ['2026-10-27', '2026-11-01']);
  assert.deepEqual(datesFor(ready, 'Far workshop series'), ['2026-10-27', '2026-11-01']);
  assert.ok(occurrences(ready).every(row => row.route_eligible === false), 'the full long series remains Pulse-only');
  const terminal = fixture.completion.read(completion.body.token);
  assert.equal(terminal.status, 200);
  assert.equal(terminal.body.live_completion.route_upgrade, 'not_supported');
  await h.fetchMock.respond(completion, terminal.body, terminal.status);
  const answer = await fixture.query(first.body);
  await h.fetchMock.respond(first, answer.body);
  assert.equal(pressed(h, 'Following 7 days'), 'true');
  const following = queries(h).at(-1);
  assert.equal(following.body.time, 'this_week');
  assert.equal(following.body.selected_date, DATE);
  const weekly = await fixture.query(following.body);
  await h.fetchMock.respond(following, weekly.body);
  const dialog = h.container.querySelector('[role="dialog"]');
  assert.match(dialog.textContent, /Local workshop series/);
  assert.match(dialog.textContent, /27 Oct|27 oct|27 okt/i);
  assert.match(dialog.textContent, /1 Nov|1 nov/i);
  assert.equal(routes(h).length, 1);
  assert.equal(h.fetchMock.calls.filter(call => call.url === '/api/planner-live-route-upgrade').length, 0);
  assert.deepEqual(body.days, before, 'Live does not mutate the activity-composed day');
  assert.deepEqual(h.readStorage(LAST_KEY).safeResponse.days, publishedDay,
    'completion and automatic week selection preserve the published day used by save/share');
  const requests = fixture.requests.length;
  const warm = await fixture.query({ ...following.body, preferences: ['swimming'] });
  assert.deepEqual(datesFor(warm.body.live_events, 'Local workshop series'), ['2026-10-27', '2026-11-01']);
  assert.equal(fixture.requests.length, requests, 'same date/period/geometry cache reprojects preferences without refetching');
});

test('manual selected day and near-route geometry survive the late weekly body and reopen with real cached source rows', async t => {
  const fixture = await sourceFixture(); t.after(() => fixture.dispose());
  const body = await activityDay(fixture.pending, fixture.capability);
  const h = await mount(t, body); await click(h, 'Explore live');
  const first = queries(h).at(-1);
  fixture.release(); await fixture.ready(); await h.clock.advance(2000);
  const completion = h.fetchMock.calls.find(call => call.url === '/api/planner-live-completion');
  const terminal = fixture.completion.read(completion.body.token);
  await h.fetchMock.respond(completion, terminal.body);
  await h.fetchMock.respond(first, (await fixture.query(first.body)).body);
  const weekly = queries(h).at(-1);
  await h.fetchMock.respond(weekly, (await fixture.query(weekly.body)).body, 200, { deferBody: true });
  await click(h, 'Sun 25 Oct');
  const manual = queries(h).at(-1);
  await h.fetchMock.respond(manual, (await fixture.query(manual.body)).body);
  await click(h, 'Near the route');
  const near = queries(h).at(-1);
  assert.deepEqual(near.body.route_points, body.days[0].primary_route.main_stops.map(({ lat, lng }) => ({ lat, lng })));
  assert.equal(near.body.selected_date, DATE);
  await h.fetchMock.respond(near, (await fixture.query(near.body)).body);
  assert.equal(weekly.aborted, true);
  await h.fetchMock.releaseBody(weekly);
  assert.equal(pressed(h, 'Sun 25 Oct'), 'true');
  assert.equal(pressed(h, 'Near the route'), 'true');
  await click(h, 'Following 7 days');
  const scoped = queries(h).at(-1), reply = await fixture.query(scoped.body);
  assert.deepEqual(datesFor(reply.body.live_events, 'Local workshop series'), ['2026-10-27', '2026-11-01']);
  assert.deepEqual(datesFor(reply.body.live_events, 'Far workshop series'), [], 'far source is outside the real route corridor');
  await h.fetchMock.respond(scoped, reply.body);
  const requests = fixture.requests.length;
  await close(h); await click(h, 'See all live');
  assert.equal(pressed(h, 'Following 7 days'), 'true');
  assert.equal(pressed(h, 'Near the route'), 'true');
  const reopened = queries(h).at(-1);
  await h.fetchMock.respond(reopened, (await fixture.query(reopened.body)).body);
  assert.match(h.container.querySelector('[role="dialog"]').textContent, /Local workshop series/);
  assert.doesNotMatch(h.container.querySelector('[role="dialog"]').textContent, /Far workshop series/);
  assert.equal(fixture.requests.length, requests, 'reopen reads the same scoped warm pool');
  assert.equal(routes(h).length, 1);
});

test('a real selected-day source session prevents automatic week selection even when following occurrences are cached', async t => {
  const fixture = await sourceFixture({ includeToday: true }); t.after(() => fixture.dispose());
  fixture.release(); const ready = await fixture.ready();
  assert.deepEqual(ready.tonight.find(row => row.title === 'Local workshop series').time_window.dates, [DATE]);
  assert.deepEqual(datesFor(ready, 'Local workshop series'), ['2026-10-27', '2026-11-01']);
  const h = await mount(t, await activityDay(ready));
  await click(h, 'See all live');
  assert.equal(pressed(h, 'Sun 25 Oct'), 'true');
  assert.match(h.container.querySelector('[role="dialog"]').textContent, /Local workshop series/);
  assert.equal(queries(h).length, 0, 'published source facts need no fallback scope query');
  assert.equal(routes(h).length, 1);
});
