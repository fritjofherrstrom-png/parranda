import test from 'node:test';
import assert from 'node:assert/strict';
import { mountPlanner } from './helpers/planner-harness.mjs';

const DATE = '2026-10-14';
const FIRST = 'live:2026-10-14:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const SECOND = 'live:2026-10-14:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const LAST = 'parranda:anywhere:last';
const routeCalls = h => h.fetchMock.calls.filter(c => c.url.includes('route-recommendations'));
function response(event = 'first', date = DATE) {
  const liveStop = { id: `live-${event}`, event_id: event, is_live_event: true,
    live_occurrence_id: event === 'first' ? FIRST : SECOND, live_choice_eligible: true,
    label: event === 'first' ? 'First concert' : 'Second concert', lat: 41.902, lng: 12.492,
    starts_at: `${date}T18:00:00Z`, timezone: 'Europe/Rome', occurrence_date: date,
    source: { label: 'Published source', url: `https://example.org/${event}` } };
  return { days: [{ date, experimental_agnostic_route_applied: true,
    primary_route: { id: '__agnostic_compose__', title: 'Plan', estimated_km: 1.2,
      main_stops: [{ id: 'cafe', label: 'Cafe', type: 'restaurant', lat: 41.9, lng: 12.49, tags: [] },
        { id: 'view', label: 'View', type: 'viewpoint', lat: 41.901, lng: 12.491, tags: [] },
        ...(event ? [liveStop] : [])], map_route_points: [], map_path_points: [], legs: [] }, alternatives: [] }],
    place_structure: { provenance: 'agnostic_anchor', area_count: 1, areas: [], district_day: { areas: [],
      evening_event: event ? { id: event, title: liveStop.label, live_occurrence_id: liveStop.live_occurrence_id,
        starts_at: liveStop.starts_at, timezone: 'Europe/Rome', woven_into_route: true } : null } },
    agnostic_route_output_experiment: { promotion: { promote: true }, source_status: { anchor: { lat: 41.9, lng: 12.49 } } },
    live_events: { coverage: 'covered', selected_date: date, pending: false, tonight: [], this_week: [],
      acquisition: { source_health: { status: 'healthy', result: 'events_found' } } } };
}
async function click(h, label) {
  const b = [...h.container.querySelectorAll('button')].find(b => b.textContent.trim() === label || b.getAttribute('aria-label') === label);
  assert.ok(b, `real control '${label}' exists`);
  await h.act(() => b.dispatchEvent(new h.window.Event('click', { bubbles: true })));
}
async function completedChoice(t, action) {
  const h = await mountPlanner({ url: 'http://localhost/anywhere?place=Testville&lang=en' });
  await h.fetchMock.respond(routeCalls(h)[0], response());
  const labels = { keep: 'Keep this event', replace: 'Try another event', remove: 'Remove from day' };
  await click(h, labels[action]);
  await h.clock.advance(400);
  assert.deepEqual(routeCalls(h).at(-1).body.live_event_choices, [{ occurrence_id: FIRST, action }]);
  await h.fetchMock.respond(routeCalls(h).at(-1), response(action === 'remove' ? null : action === 'replace' ? 'second' : 'first'));
  const entry = h.readStorage(LAST);
  assert.equal(entry.commitments.entries[FIRST].kind, action === 'keep' ? 'pin' : 'exclude');
  const url = h.window.location.href;
  assert.equal(new URL(url).searchParams.get('place'), 'Testville', 'reload the actual live ?place URL, not restore=last');
  await h.unmount();
  return { entry, url };
}
function freezeDate(t) {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-14T10:00:00Z') });
}

for (const action of ['keep', 'replace', 'remove']) {
  test(`completed ${action} survives ordinary place-URL reload and its new completed composition`, async t => {
    freezeDate(t);
    const { entry, url } = await completedChoice(t, action);
    const h = await mountPlanner({ url, storage: { [LAST]: entry }, navigationType: 'reload' });
    t.after(() => h.unmount());
    const request = routeCalls(h)[0];
    assert.deepEqual(request.body.live_event_choices, [{ occurrence_id: FIRST, action }]);
    assert.deepEqual(request.body.dates, ['2026-10-14']);
    await h.fetchMock.respond(request, response(action === 'remove' ? null : action === 'replace' ? 'second' : 'first'));
    const saved = h.readStorage(LAST);
    assert.equal(saved.commitments.entries[FIRST].kind, action === 'keep' ? 'pin' : 'exclude');
    if (action !== 'keep') assert.equal(saved.commitments.entries[FIRST].liveAction, action);
    const stops = saved.safeResponse.days[0].primary_route.main_stops.filter(s => s.is_live_event);
    assert.deepEqual(stops.map(s => s.live_occurrence_id), action === 'remove' ? [] : [action === 'replace' ? SECOND : FIRST]);
    await h.clock.advance(1000);
    assert.equal(routeCalls(h).length, 1, 'restored choices do not trigger a duplicate arrival recompose');
  });
}

for (const [name, amend, navigationType] of [
  ['same place / another day', url => { url.searchParams.set('day', '1'); }, 'reload'],
  ['another place', url => { url.searchParams.set('place', 'Elsewhere'); }, 'reload'],
  ['different preferences', url => { url.searchParams.set('prefs', 'food'); }, 'reload'],
  ['different rhythm', url => { url.searchParams.set('rhythm', 'full'); }, 'reload'],
  ['new navigation even to identical context', () => {}, 'navigate'],
  ['history navigation without retained document', () => {}, 'back_forward'],
]) test(`${name} must not inherit last day's choices`, async t => {
  freezeDate(t);
  const { entry, url } = await completedChoice(t, 'keep');
  const next = new URL(url); amend(next);
  const h = await mountPlanner({ url: next.href, storage: { [LAST]: entry }, navigationType });
  t.after(() => h.unmount());
  const req = routeCalls(h)[0];
  assert.equal(req.body.live_event_choices, undefined);
  assert.equal(req.body.pinned_candidate_ids, undefined);
  await h.fetchMock.respond(req, response('first', req.body.dates[0]));
  assert.equal(h.readStorage(LAST).commitments, null);
});

test('same relative day after midnight cannot inherit yesterday absolute-date choices', async t => {
  freezeDate(t);
  const { entry, url } = await completedChoice(t, 'keep');
  t.mock.timers.tick(24 * 60 * 60 * 1000);
  const h = await mountPlanner({ url, storage: { [LAST]: entry }, navigationType: 'reload' });
  t.after(() => h.unmount());
  assert.deepEqual(routeCalls(h)[0].body.dates, ['2026-10-15']);
  assert.equal(routeCalls(h)[0].body.live_event_choices, undefined);
});

test('a newer change after reload rejects the older returned route body and keeps the new choice', async t => {
  freezeDate(t);
  const { entry, url } = await completedChoice(t, 'keep');
  const h = await mountPlanner({ url, storage: { [LAST]: entry }, navigationType: 'reload' });
  t.after(() => h.unmount());
  await h.fetchMock.respond(routeCalls(h)[0], response());
  await click(h, 'Try another event'); await h.clock.advance(400);
  const older = routeCalls(h).at(-1);
  await h.fetchMock.respond(older, response('second'), 200, { deferBody: true });
  await click(h, 'Remove from day'); await h.clock.advance(400);
  assert.equal(older.aborted, true);
  await h.fetchMock.respond(routeCalls(h).at(-1), response(null));
  await h.fetchMock.releaseBody(older);
  const saved = h.readStorage(LAST);
  assert.equal(saved.commitments.entries[FIRST].liveAction, 'remove');
  assert.equal(saved.safeResponse.days[0].primary_route.main_stops.filter(s => s.is_live_event).length, 0);
});

test('ordinary reload also recovers a completed regular place keep through the same entry contract', async t => {
  freezeDate(t);
  let h = await mountPlanner({ url: 'http://localhost/anywhere?place=Testville&lang=en' });
  await h.fetchMock.respond(routeCalls(h)[0], response());
  const row = [...h.container.querySelectorAll('button')].find(b => b.textContent.includes('Cafe'));
  assert.ok(row);
  await h.act(() => row.dispatchEvent(new h.window.Event('click', { bubbles: true })));
  await click(h, 'Keep this one'); await h.clock.advance(400);
  assert.deepEqual(routeCalls(h).at(-1).body.pinned_candidate_ids, ['cafe']);
  await h.fetchMock.respond(routeCalls(h).at(-1), response());
  const entry = h.readStorage(LAST), url = h.window.location.href;
  await h.unmount();
  h = await mountPlanner({ url, storage: { [LAST]: entry }, navigationType: 'reload' });
  t.after(() => h.unmount());
  assert.deepEqual(routeCalls(h)[0].body.pinned_candidate_ids, ['cafe']);
  assert.equal(routeCalls(h)[0].body.live_event_choices, undefined);
  await h.fetchMock.respond(routeCalls(h)[0], response());
  assert.equal(h.readStorage(LAST).commitments.entries.cafe.kind, 'pin');
});

for (const [name, alter] of [
  ['malformed snapshot day key', entry => { entry.commitments.dayKey = 'other-question'; }],
  ['inconsistent published date', entry => { entry.safeResponse.days[0].date = '2026-10-15'; }],
  ['lost namesake qualifier', entry => { entry.inputs.placeLabel = 'Testville, another region'; }],
  ['same label / changed durable place identity', entry => { entry.inputs.placeRef = 'r1234'; }],
  ['unavailable old day', entry => { entry.classification.status = 'unavailable'; }],
]) test(`${name} refuses recovery instead of inheriting choices`, async t => {
  freezeDate(t);
  const { entry, url } = await completedChoice(t, 'keep'); alter(entry);
  const h = await mountPlanner({ url, storage: { [LAST]: entry }, navigationType: 'reload' });
  t.after(() => h.unmount());
  assert.equal(routeCalls(h)[0].body.live_event_choices, undefined);
});
