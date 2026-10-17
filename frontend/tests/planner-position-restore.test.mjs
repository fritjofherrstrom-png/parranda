/** Mounted position lifecycle regressions. Controlled source replies, no live providers. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mountPlanner } from './helpers/planner-harness.mjs';
import dayPolicy from '../../server/planner/day-composition-policy.js';

const LAST = 'parranda:anywhere:last';
const DATE = '2026-10-14';
const P1 = { lat: 59.3326, lng: 18.0649 };
const P2 = { lat: 59.3429, lng: 18.0496 };
const routes = h => h.fetchMock.calls.filter(c => c.url.includes('route-recommendations'));
function response({ replaced = false, date = DATE, anchor = P1, title = 'Museum', dayEdit = null } = {}) {
  const stops = [
    { id: 'museum', label: title, lat: 59.333, lng: 18.065, type: 'museum', covered_preferences: ['culture'] },
    { id: 'cafe', label: 'Cafe', lat: 59.334, lng: 18.066, type: 'restaurant', covered_preferences: ['food'] },
    replaced
      ? { id: 'garden', label: 'Garden', lat: 59.3352, lng: 18.0672, type: 'park', covered_preferences: ['views'] }
      : { id: 'park', label: 'Park', lat: 59.335, lng: 18.067, type: 'park', covered_preferences: ['views'] },
  ];
  const lastLabel = replaced ? 'Garden' : 'Park';
  return { days: [{ date, experimental_agnostic_route_applied: true, primary_route: {
    id: '__agnostic_compose__', title: 'Published day', estimated_km: 1.8,
    main_stops: stops, map_path_points: [], map_route_points: [
      { ...anchor, label: 'Stockholm', role: 'start' }, ...stops,
      { ...anchor, label: 'Stockholm', role: 'end' },
    ], legs: [
      { from_label: 'Stockholm', to_label: title, distance_km: 0.1, estimated_walk_minutes: 2 },
      { from_label: title, to_label: 'Cafe', distance_km: 0.7, estimated_walk_minutes: 9 },
      { from_label: 'Cafe', to_label: lastLabel, distance_km: 0.4, estimated_walk_minutes: 5 },
      { from_label: lastLabel, to_label: 'Stockholm', distance_km: 0.6, estimated_walk_minutes: 8 },
    ],
  }, alternatives: [] }], agnostic_route_output_experiment: { promotion: { promote: true }, source_status: { anchor },
    // Only a controlled transport acknowledgement; no provider acceptance is claimed.
    ...(dayEdit ? { day_edit: dayPolicy.dayEditOutcome(dayEdit, stops) } : {}) },
    live_events: { coverage: 'covered', selected_date: date, pending: false, tonight: [], this_week: [],
      acquisition: { source_health: { status: 'healthy', result: 'events_found' } } } };
}
async function click(h, label, prefix = false) {
  const b = [...h.container.querySelectorAll('button')].find(b => prefix ? b.textContent.trim().includes(label) : b.textContent.trim() === label);
  assert.ok(b, `real control '${label}' exists`);
  await h.act(() => b.dispatchEvent(new h.window.Event('click', { bubbles: true })));
}
function geo(h, coords = P1) {
  const requests = [];
  Object.defineProperty(h.window.navigator, 'geolocation', { configurable: true, value: {
    getCurrentPosition(success, failure) { requests.push({ success, failure }); },
  } });
  return { requests, async grant(index = requests.length - 1) {
    await h.act(() => requests[index].success({ coords: { latitude: coords.lat, longitude: coords.lng } }));
  }, async deny(index = requests.length - 1) {
    await h.act(() => requests[index].failure({ code: 1, message: 'Permission denied' }));
  } };
}
function freeze(t) { t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-14T10:00:00Z') }); }
async function completed(t) {
  const h = await mountPlanner({ url: 'http://localhost/anywhere?anchor=near&lang=en',
    sessionStorage: { 'parranda:anchor:coords': P1 } });
  try {
    await h.fetchMock.respond(routes(h)[0], response());
    await click(h, 'Museum', true); await click(h, 'Keep this one'); await h.clock.advance(400);
    assert.deepEqual(routes(h).at(-1).body.pinned_candidate_ids, ['museum']);
    await h.fetchMock.respond(routes(h).at(-1), response());
    const beforeEdit = { entry: h.readStorage(LAST), url: h.window.location.href };
    await click(h, 'Park', true); await click(h, 'Replace'); await h.clock.advance(400);
    const replacement = routes(h).at(-1);
    assert.equal(routes(h).length, 3, 'Keep and Replace each emit exactly one compose');
    assert.deepEqual(replacement.body.pinned_candidate_ids, ['museum']);
    assert.deepEqual(replacement.body.excluded_candidate_ids, ['park']);
    assert.deepEqual(replacement.body.day_edit, {
      version: 1, action: 'replace', candidate_id: 'park', retained_candidate_ids: ['museum', 'cafe'],
      target_stop_count: 3, slot_index: 2, replacement_preference: 'views', removed_candidate_ids: [],
    });
    await h.fetchMock.respond(replacement, response({ replaced: true, dayEdit: replacement.body.day_edit }));
    const entry = h.readStorage(LAST), url = h.window.location.href;
    assert.deepEqual(entry.commitments.entries, { museum: { kind: 'pin', label: 'Museum' }, park: { kind: 'exclude', label: 'Park' } });
    assert.deepEqual(entry.safeResponse.days[0].primary_route.main_stops.map(stop => stop.id), ['museum', 'cafe', 'garden'],
      'Replace preserves the other IDs and the count with one relevant new stop');
    assert.equal(entry.inputs.mode, 'near_me');
    assert.equal(entry.commitments.anchorKey, 'coords:59.333,18.065');
    assert.equal(entry.commitments.dayKey, entry.id, 'the ledger belongs to the applied edit identity');
    assert.equal(entry.inputs.coords, undefined, 'GPS is not added to saved inputs');
    assert.equal(new URL(url).searchParams.has('lat'), false);
    assert.equal(new URL(url).searchParams.has('lng'), false);
    assert.deepEqual(entry.inputs.dayEdit, {
      version: 1, action: 'remove', candidate_id: 'park', retained_candidate_ids: ['museum', 'cafe', 'garden'],
      target_stop_count: 3, slot_index: 2, replacement_preference: null, removed_candidate_ids: [],
    }, 'the saved edit is applied retention, never a replayable Replace command');
    assert.deepEqual(JSON.parse(new URL(url).searchParams.get('edit')), entry.inputs.dayEdit,
      'a genuine reload uses the actual post-edit URL');
    return { entry, url, beforeEdit };
  } finally {
    await h.unmount();
  }
}

test('same-position consent after reload recovers its saved keep and dismissal before fresh compose', async t => {
  freeze(t); const { entry, url } = await completed(t);
  const h = await mountPlanner({ url, storage: { [LAST]: entry }, navigationType: 'reload' });
  t.after(() => h.unmount()); const gps = geo(h);
  assert.equal(routes(h).length, 0); assert.equal(gps.requests.length, 0);
  await click(h, 'Use my location'); await gps.grant();
  assert.deepEqual(routes(h)[0].body.day_edit, entry.inputs.dayEdit, 'consent retains the applied cap and IDs instead of replaying Replace');
  assert.deepEqual(routes(h)[0].body.pinned_candidate_ids, ['museum']);
  assert.deepEqual(routes(h)[0].body.excluded_candidate_ids, ['park']);
  await h.fetchMock.respond(routes(h)[0], response({ replaced: true, dayEdit: routes(h)[0].body.day_edit }));
  assert.match(h.text(), /1 place kept/); assert.match(h.text(), /1 place dismissed/);
  assert.match(h.container.querySelector('section[aria-label="The route"]').textContent, /Kept/);
  await h.clock.advance(1000); assert.equal(routes(h).length, 1);
  assert.doesNotMatch(h.text(), /Your previous kept and dismissed stops could not be carried over/);
  assert.deepEqual(h.readStorage(LAST).commitments.entries, entry.commitments.entries);
  assert.deepEqual(h.readStorage(LAST).inputs.dayEdit, entry.inputs.dayEdit);
});

test('same-position consent still recovers a keep-only reload without manual edit intent', async t => {
  freeze(t); const { beforeEdit } = await completed(t);
  const h = await mountPlanner({ url: beforeEdit.url, storage: { [LAST]: beforeEdit.entry }, navigationType: 'reload' });
  t.after(() => h.unmount()); const gps = geo(h);
  await click(h, 'Use my location'); await gps.grant();
  assert.deepEqual(routes(h)[0].body.pinned_candidate_ids, ['museum']);
  assert.equal(routes(h)[0].body.day_edit, undefined);
  await h.fetchMock.respond(routes(h)[0], response());
  assert.match(h.text(), /1 place kept/);
  await h.clock.advance(1000); assert.equal(routes(h).length, 1);
});

for (const [name, alter, coords, nav] of [
  ['another position', () => {}, P2, 'reload'],
  ['another day', u => u.searchParams.set('day', '1'), P1, 'reload'],
  ['another rhythm', u => u.searchParams.set('rhythm', 'full'), P1, 'reload'],
  ['another place', u => { u.searchParams.delete('anchor'); u.searchParams.set('place', 'Elsewhere'); }, P1, 'reload'],
  ['new navigation', () => {}, P1, 'navigate'],
]) test(`${name} does not inherit position choices`, async t => {
  freeze(t); const completedDay = await completed(t);
  // An independent question does not request the previous manual edit. Also
  // exercise its keep-only predecessor so edit-identity mismatch cannot mask
  // a broken position/date/rhythm/navigation guard.
  for (const saved of [completedDay.beforeEdit, completedDay]) {
    const url = new URL(saved.url); url.searchParams.delete('edit'); alter(url);
    const h = await mountPlanner({ url: url.href, storage: { [LAST]: saved.entry }, navigationType: nav });
    try {
      const gps = geo(h, coords);
      if (!url.searchParams.has('place')) { await click(h, 'Use my location'); await gps.grant(); }
      assert.equal(routes(h)[0].body.pinned_candidate_ids, undefined);
      assert.equal(routes(h)[0].body.excluded_candidate_ids, undefined);
      assert.equal(routes(h)[0].body.day_edit, undefined, 'a new context never borrows the stored edit');
      const notice = /Your previous kept and dismissed stops could not be carried over/;
      if (nav === 'reload') {
        assert.match(h.text(), notice, 'rejected previous choices must not disappear silently');
        await h.fetchMock.respond(routes(h)[0], response({ date: routes(h)[0].body.dates[0], anchor: coords }));
        assert.match(h.text(), notice, 'the explanation survives installation of the new day');
      } else assert.doesNotMatch(h.text(), notice, 'an independent navigation did not request recovery');
    } finally {
      await h.unmount();
    }
  }
});

test('a rejected position ledger is explained in Swedish and the notice clears on a new explicit choice', async t => {
  freeze(t); const saved = await completed(t);
  const url = new URL(saved.url); url.searchParams.delete('edit'); url.searchParams.set('lang', 'sv');
  const h = await mountPlanner({ url: url.href, props: { lang: 'sv' },
    storage: { [LAST]: saved.entry }, navigationType: 'reload' });
  t.after(() => h.unmount()); const gps = geo(h, P2);
  await click(h, 'Använd min position'); await gps.grant();
  assert.match(h.text(), /Dina tidigare fästa och bortvalda stopp kunde inte föras över/);
  assert.equal(routes(h)[0].body.pinned_candidate_ids, undefined);
  await h.fetchMock.respond(routes(h)[0], response({ anchor: P2 }));
  await click(h, 'Justera'); await click(h, 'Imorgon');
  assert.doesNotMatch(h.text(), /Dina tidigare fästa och bortvalda stopp kunde inte föras över/);
});

test('restore last carries valid position ledger and pin badge without asking for or recovering GPS', async t => {
  freeze(t); const { entry } = await completed(t);
  const h = await mountPlanner({ url: 'http://localhost/anywhere?restore=last&lang=en', storage: { [LAST]: entry } });
  t.after(() => h.unmount()); const gps = geo(h);
  assert.equal(routes(h).length, 0); assert.equal(gps.requests.length, 0);
  assert.match(h.text(), /1 place kept/); assert.match(h.text(), /1 place dismissed/);
  assert.match(h.container.querySelector('section[aria-label="The route"]').textContent, /Kept/);
});

test('restored position maps endpoints name the position while retaining the published route', async t => {
  freeze(t); const { entry } = await completed(t);
  const h = await mountPlanner({ url: 'http://localhost/anywhere?restore=last&lang=en', storage: { [LAST]: entry } });
  t.after(() => h.unmount());
  const links = [...h.container.querySelectorAll('a[href*="/maps/dir/"]')];
  assert.ok(links.length); assert.match(h.text(), /Start: Your position · Finish: Your position/);
  assert.doesNotMatch(h.text(), /Start: Stockholm|Finish: Stockholm/);
  assert.equal(new URL(links[0].href).searchParams.get('origin'), '59.3326,18.0649');
});

test('Blitz on a restored position explains missing consent and offers a deliberate position action', async t => {
  freeze(t); const { entry } = await completed(t);
  const h = await mountPlanner({ url: 'http://localhost/anywhere?restore=last&lang=en', storage: { [LAST]: entry } });
  t.after(() => h.unmount()); const gps = geo(h);
  await click(h, 'Blitz right now');
  assert.equal(h.fetchMock.calls.filter(c => c.url.includes('/api/blitz')).length, 0);
  assert.equal(gps.requests.length, 0);
  assert.match(h.text(), /Blitz needs your position/);
  assert.doesNotMatch(h.text(), /Blitz could not read the moment/);
  await click(h, 'Share position for Blitz'); await gps.grant();
  const blitz = h.fetchMock.calls.find(c => c.url.includes('/api/blitz'));
  assert.deepEqual(blitz.body, { lat: 59.3326, lng: 18.0649, preferences: ['food', 'culture', 'views'] });
  assert.equal(routes(h).length, 0, 'Blitz consent does not rebuild the saved day');
});

test('route list includes published start and return estimates already counted in the total', async t => {
  freeze(t);
  const h = await mountPlanner({ url: 'http://localhost/anywhere?anchor=near&lang=en', sessionStorage: { 'parranda:anchor:coords': P1 } });
  t.after(() => h.unmount()); await h.fetchMock.respond(routes(h)[0], response());
  const route = h.container.querySelector('section[aria-label="The route"]');
  assert.match(route.textContent, /From Your position/);
  assert.match(route.textContent, /2 min · (?:100 m|0.1 km)/);
  assert.match(route.textContent, /Return to Your position/);
  assert.match(route.textContent, /8 min · (?:600 m|0.6 km)/);
});

test('late consent after leaving cannot compose or install a position day', async t => {
  freeze(t); const { entry, url } = await completed(t);
  const h = await mountPlanner({ url, storage: { [LAST]: entry }, navigationType: 'reload' });
  t.after(() => h.unmount()); const gps = geo(h);
  await click(h, 'Use my location');
  const home = [...h.container.querySelectorAll('a')].find(a => a.getAttribute('href') === '/?lang=en');
  assert.ok(home);
  await h.act(() => { const e = new h.window.MouseEvent('click', { bubbles: true, cancelable: true }); home.addEventListener('click', e => e.preventDefault(), { once: true }); home.dispatchEvent(e); });
  await gps.grant();
  assert.equal(routes(h).length, 0);
});

test('denied position consent neither composes nor changes the saved choices or leaks GPS', async t => {
  freeze(t); const { entry, url } = await completed(t);
  const h = await mountPlanner({ url, storage: { [LAST]: entry }, navigationType: 'reload' });
  t.after(() => h.unmount()); const gps = geo(h);
  await click(h, 'Use my location'); await gps.deny();
  assert.equal(routes(h).length, 0);
  assert.deepEqual(h.readStorage(LAST), entry, 'denial does not overwrite or partially restore the remembered answer');
  assert.equal(h.window.location.href, url);
  assert.equal(new URL(h.window.location.href).searchParams.has('lat'), false);
  assert.equal(new URL(h.window.location.href).searchParams.has('lng'), false);
});

for (const [name, change] of [
  ['another position ledger', e => { e.commitments.anchorKey = 'coords:59.343,18.050'; }],
  ['another day ledger', e => { e.commitments.dayKey = 'pos::2026-10-15::culture,food,views::rhythm=balanced'; }],
  ['precise GPS key', e => { e.commitments.anchorKey = 'coords:59.3326,18.0649'; }],
  ['out of range GPS key', e => { e.commitments.anchorKey = 'coords:159.333,18.065'; }],
]) test(`restoring ${name} cannot present saved commitments as valid`, async t => {
  freeze(t); const { entry } = await completed(t); change(entry);
  const h = await mountPlanner({ url: 'http://localhost/anywhere?restore=last&lang=en', storage: { [LAST]: entry } });
  t.after(() => h.unmount());
  assert.doesNotMatch(h.text(), /1 place kept|1 place dismissed|Kept/);
});

test('late Blitz position consent after navigation sends nothing', async t => {
  freeze(t); const { entry } = await completed(t);
  const h = await mountPlanner({ url: 'http://localhost/anywhere?restore=last&lang=en', storage: { [LAST]: entry } });
  t.after(() => h.unmount()); const gps = geo(h);
  await click(h, 'Blitz right now'); await click(h, 'Share position for Blitz');
  const home = [...h.container.querySelectorAll('a')].find(a => a.getAttribute('href') === '/?lang=en');
  await h.act(() => { const e = new h.window.MouseEvent('click', { bubbles: true, cancelable: true }); home.addEventListener('click', e => e.preventDefault(), { once: true }); home.dispatchEvent(e); });
  await gps.grant();
  assert.equal(h.fetchMock.calls.filter(c => c.url.includes('/api/blitz')).length, 0);
});

test('a late route body after consent cannot replace the newer position choices', async t => {
  freeze(t); const { entry, url } = await completed(t);
  const h = await mountPlanner({ url, storage: { [LAST]: entry }, navigationType: 'reload' });
  t.after(() => h.unmount()); const gps = geo(h);
  await click(h, 'Use my location'); await gps.grant();
  const older = routes(h)[0];
  assert.deepEqual(older.body.pinned_candidate_ids, ['museum'], 'precondition: this request recovered the original choices');
  assert.deepEqual(older.body.day_edit, entry.inputs.dayEdit);
  await h.fetchMock.respond(older, response({ replaced: true, title: 'Late museum', dayEdit: older.body.day_edit }), 200, { deferBody: true });
  await click(h, 'Start over without my choices'); await h.clock.advance(400);
  const newer = routes(h).at(-1);
  assert.notEqual(newer, older); assert.equal(older.aborted, true);
  await h.fetchMock.respond(newer, response()); await h.fetchMock.releaseBody(older);
  assert.doesNotMatch(h.text(), /Late museum|1 place kept|1 place dismissed/);
  assert.equal(h.readStorage(LAST).commitments, null);
  assert.equal(h.readStorage(LAST).inputs.dayEdit, undefined);
});

test('position consent answering an older day cannot compose or recover that older ledger', async t => {
  freeze(t); const { entry, url } = await completed(t);
  const h = await mountPlanner({ url, storage: { [LAST]: entry }, navigationType: 'reload' });
  t.after(() => h.unmount()); const gps = geo(h);
  await click(h, 'Use my location');
  await click(h, 'Adjust'); await click(h, 'Tomorrow'); await h.clock.advance(400);
  await gps.grant();
  assert.equal(routes(h).length, 0, 'an old consent does not answer a new day');
  await click(h, 'Use my location'); await gps.grant();
  assert.deepEqual(routes(h)[0].body.dates, ['2026-10-15']);
  assert.equal(routes(h)[0].body.pinned_candidate_ids, undefined);
  assert.equal(routes(h)[0].body.excluded_candidate_ids, undefined);
  assert.equal(routes(h)[0].body.day_edit, undefined, 'the new day does not inherit the old edit scope');
});

for (const accepted of [true, false]) test(`position consent ${accepted ? 'preserves a verified' : 'rejects an unverified'} intentional empty day after reload`, async t => {
  freeze(t);
  let h = await mountPlanner({ url: 'http://localhost/anywhere?anchor=near&lang=en',
    sessionStorage: { 'parranda:anchor:coords': P1 } });
  t.after(() => h?.unmount());
  const single = response();
  single.days[0].primary_route.main_stops = [single.days[0].primary_route.main_stops[0]];
  await h.fetchMock.respond(routes(h)[0], single);
  await click(h, 'Museum', true); await click(h, 'Remove'); await h.clock.advance(400);
  const removal = routes(h).at(-1);
  assert.equal(removal.body.day_edit.target_stop_count, 0);
  const empty = { days: [{ date: DATE, primary_route: null, alternatives: [], manual_empty_day: true }],
    agnostic_route_output_experiment: { promotion: { promote: false }, manual_edit_published: true,
      source_status: { anchor: P1 }, day_edit: dayPolicy.dayEditOutcome(removal.body.day_edit, []) } };
  await h.fetchMock.respond(removal, empty);
  const saved = h.readStorage(LAST), url = h.window.location.href;
  assert.equal(saved.classification.status, 'edited_empty');
  assert.equal(saved.inputs.dayEdit.target_stop_count, 0);
  if (!accepted) saved.safeResponse.agnostic_route_output_experiment.manual_edit_published = false;
  await h.unmount(); h = null;
  h = await mountPlanner({ url, storage: { [LAST]: saved }, navigationType: 'reload' });
  const gps = geo(h);
  assert.equal(routes(h).length, 0, 'reload cannot recover a precise position without consent');
  assert.equal(gps.requests.length, 0);
  await click(h, 'Use my location'); await gps.grant();
  const fresh = routes(h)[0];
  assert.ok(Boolean(fresh));
  if (accepted) {
    assert.equal(fresh.body.day_edit?.target_stop_count, 0, 'fresh position consent must not turn a chosen empty day into Full');
    assert.deepEqual(fresh.body.day_edit, saved.inputs.dayEdit);
    await h.fetchMock.respond(fresh, empty);
    assert.match(h.text(), /Your day is empty/);
    assert.equal(h.readStorage(LAST).inputs.dayEdit.target_stop_count, 0);
  } else {
    assert.equal(fresh.body.day_edit, undefined, 'inconsistent empty markers cannot recover a prior authoritative choice');
    await h.fetchMock.respond(fresh, response());
  }
  assert.equal(new URL(h.window.location.href).searchParams.has('lat'), false);
  assert.equal(new URL(h.window.location.href).searchParams.has('lng'), false);
  await h.clock.advance(500);
  assert.equal(routes(h).length, 1);
});
