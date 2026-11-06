import test from 'node:test';
import assert from 'node:assert/strict';
import { mountPlanner } from './helpers/planner-harness.mjs';
import { dayEditOutcome } from '../../server/planner/day-composition-policy.js';
const DATE = '2026-10-16', LAST = 'parranda:anywhere:last';
const stops = [
  { id: 'museum', label: 'Fixture Museum', type: 'museum', covered_preferences: ['culture'] },
  { id: 'lunch', label: 'Fixture Lunch', type: 'restaurant', covered_preferences: ['food'] },
  { id: 'park', label: 'Fixture Park', type: 'park', covered_preferences: ['views'] },
].map((s, i) => ({ ...s, lat: 59.333 + i * .001, lng: 18.065, commitment_eligible: true }));
const chosen = { id: 'chosen', label: 'River Kitchen', type: 'restaurant', lat: 59.337, lng: 18.066, covered_preferences: ['food'] };
const calls = h => h.fetchMock.calls.filter(c => c.url.includes('route-recommendations'));
function body(items = stops, command = null) {
  const points = [{ lat: 59.3326, lng: 18.0649, label: 'Fixture Town', role: 'start' }, ...items, { lat: 59.3326, lng: 18.0649, label: 'Fixture Town', role: 'end' }];
  return { days: [{ date: DATE, experimental_agnostic_route_applied: true, alternatives: [], primary_route: {
    id: '__agnostic_compose__', title: 'Fixture day', estimated_km: .2 * (items.length + 1), main_stops: items,
    map_route_points: points, map_path_points: [], legs: points.slice(1).map((p, i) => ({ from_label: points[i].label, to_label: p.label, distance_km: .2, estimated_walk_minutes: 3 })),
  } }], agnostic_route_output_experiment: { promotion: { promote: true }, source_status: { anchor: { lat: 59.3326, lng: 18.0649 } },
    ...(command ? { day_edit: dayEditOutcome(command, items) } : {}) },
    live_events: { coverage: 'covered', selected_date: DATE, pending: false, tonight: [], this_week: [], acquisition: { source_health: { status: 'healthy', result: 'empty' } } } };
}
const button = (h, text) => [...h.container.querySelectorAll('button')].find(x => x.textContent.trim() === text || x.getAttribute('aria-label') === text);
async function click(h, text) { const el = button(h, text); assert.ok(el, `button ${text}`); await h.act(() => el.dispatchEvent(new h.window.MouseEvent('click', { bubbles: true }))); }
async function ready(t, options = {}) {
  t.mock.timers.enable({ apis: ['Date'], now: new Date(`${DATE}T10:00:00Z`) });
  const { teardown = true, publishedResponse, ...mountOptions } = options;
  const h = await mountPlanner({ url: 'http://localhost/anywhere?place=Fixture%20Town&lang=en&walk=balanced&prefs=culture,food,views', ...mountOptions });
  if (teardown) t.after(() => h.unmount());
  await h.act(() => h.fetchMock.respond(calls(h)[0], publishedResponse ?? body()));
  return h;
}
async function search(h, query = 'indiskt', items = [{ ...chosen, hours_status: 'unknown', match_kind: 'cuisine' }]) {
  const form = h.container.querySelector('form[aria-label="Add a place"], form[aria-label="Lägg till en plats"]');
  assert.ok(form, 'search sits alongside the real published day');
  const input = form.querySelector('input');
  await h.act(() => {
    Object.getOwnPropertyDescriptor(h.window.HTMLInputElement.prototype, 'value').set.call(input, query);
    input.dispatchEvent(new h.window.Event('input', { bubbles: true }));
    form.dispatchEvent(new h.window.Event('submit', { bubbles: true, cancelable: true }));
  });
  const request = calls(h).at(-1);
  assert.equal(request.body.day_place_search.query, query);
  await h.act(() => h.fetchMock.respond(request, { ...body(), day_place_search: { query, coverage: 'available_supply', items } }));
}

for (const lang of ['en', 'sv']) test(`search results show localized place type, match reason and selected-day hours (${lang})`, async t => {
  const h = await ready(t, { url: `http://localhost/anywhere?place=Fixture%20Town&lang=${lang}`, props: { lang } });
  await search(h, 'River Kitchen', [{ ...chosen, hours_status: 'known', match_kind: 'cuisine',
    selected_day_hours: { status: 'known', all_day: false, windows: [{ opens: '11:00', closes: '14:00' }, { opens: '17:00', closes: '22:00' }] } }]);
  const row = h.container.querySelector('form').closest('section').querySelector('ul li').textContent;
  assert.match(row, lang === 'sv' ? /Restaurang/ : /Restaurant/);
  assert.match(row, lang === 'sv' ? /Matchar kökstypen/ : /Cuisine match/);
  assert.match(row, lang === 'sv' ? /Källans tider för vald dag: 11:00–14:00, 17:00–22:00/ : /Source hours for selected day: 11:00–14:00, 17:00–22:00/);
  assert.doesNotMatch(row, /open now|öppet nu|Opening hours unknown|Öppettider saknas/i);
});

test('search results explain each supported match without exposing unknown engine types', async t => {
  const h = await ready(t);
  await search(h, 'Museum', ['name', 'address', 'category'].map((kind, i) => ({ ...chosen, id: `result-${i}`,
    label: `Result ${i}`, type: i === 2 ? 'unmapped_engine_type' : 'museum', match_kind: kind, hours_status: 'unknown' })));
  const rows = [...h.container.querySelector('form').closest('section').querySelectorAll('ul li')].map(row => row.textContent);
  assert.match(rows[0], /Museum.*Name match/);
  assert.match(rows[1], /Museum.*Address match/);
  assert.match(rows[2], /Place type match/);
  assert.ok(rows.every(row => /Opening hours unknown/.test(row)));
  assert.ok(rows.every(row => !row.includes('unmapped_engine_type')));
});

test('conditional and malformed source hours keep their uncertainty in search results', async t => {
  const h = await ready(t);
  await search(h, 'River Kitchen', [
    { ...chosen, id: 'conditional', label: 'Conditional hours', hours_status: 'unknown', match_kind: 'name',
      selected_day_hours: { status: 'unknown', all_day: false, windows: [], ordinary_status: 'known', ordinary_windows: [{ opens: '11:00', closes: '22:00' }],
        uncertainty: 'holiday_exceptions', date: DATE, timezone: 'Europe/Stockholm', source_url: 'https://kitchen.example/hours', observed_at: `${DATE}T08:00:00.000Z` } },
    { ...chosen, id: 'malformed', label: 'Malformed hours', hours_status: 'known', match_kind: 'name',
      selected_day_hours: { status: 'known', all_day: false, windows: [{ opens: 'not-a-time', closes: '22:00' }] } },
  ]);
  const rows = [...h.container.querySelector('form').closest('section').querySelectorAll('ul li')].map(row => row.textContent);
  assert.match(rows[0], /Regular hours: 11:00–22:00 · Holiday hours unconfirmed/);
  assert.doesNotMatch(rows[0], /Source hours for selected day/);
  assert.match(rows[1], /Opening hours unknown/);
  assert.doesNotMatch(rows[1], /not-a-time|Hours available|open now/);
});
test('search and preview leave route and storage unchanged; confirm adopts once and Undo restores exact day', async t => {
  const h = await ready(t), original = h.window.localStorage.getItem(LAST);
  await search(h);
  assert.match(h.container.textContent, /Opening hours unknown/);
  await click(h, 'Preview change');
  const previewCall = calls(h).at(-1), command = previewCall.body.day_edit;
  assert.equal(command.action, 'add');
  const edited = body([...stops, chosen], command);
  await h.act(() => h.fetchMock.respond(previewCall, edited));
  assert.equal(h.window.localStorage.getItem(LAST), original);
  assert.ok(!h.container.querySelector('section[aria-label="The route"]').textContent.includes('River Kitchen'));
  assert.match(h.container.querySelector('[aria-label="Preview day change"]').textContent, /0.8.*1.0/);
  const count = calls(h).length;
  await click(h, 'Confirm addition');
  await h.act(() => h.clock.advance(500));
  assert.equal(calls(h).length, count, 'confirm adopts preview without another acquisition');
  assert.match(h.container.querySelector('section[aria-label="The route"]').textContent, /River Kitchen/);
  const accepted = JSON.parse(h.window.localStorage.getItem(LAST));
  assert.deepEqual(accepted.safeResponse.days[0].primary_route.main_stops.map(s => s.id), ['museum', 'lunch', 'park', 'chosen']);
  assert.equal(accepted.inputs.dayEdit.action, 'add');
  await click(h, 'Undo');
  await h.act(() => h.clock.advance(500));
  assert.equal(h.window.localStorage.getItem(LAST), original);
  assert.equal(calls(h).length, count);
});
test('explicit meal replacement keeps the chosen target and cancellation never changes the answer', async t => {
  const h = await ready(t), original = h.window.localStorage.getItem(LAST);
  await search(h, 'River Kitchen');
  const select = h.container.querySelector('select[aria-label="Placement for River Kitchen"]');
  assert.ok(select);
  await h.act(() => { select.value = 'lunch'; select.dispatchEvent(new h.window.Event('change', { bubbles: true })); });
  await click(h, 'Preview change');
  const request = calls(h).at(-1);
  assert.equal(request.body.day_edit.action, 'replace');
  assert.equal(request.body.day_edit.candidate_id, 'lunch');
  assert.equal(request.body.day_edit.replacement_candidate_id, 'chosen');
  await h.act(() => h.fetchMock.respond(request, body([stops[0], chosen, stops[2]], request.body.day_edit)));
  await click(h, 'Cancel preview');
  assert.equal(h.window.localStorage.getItem(LAST), original);
  assert.ok(!button(h, 'Confirm replacement'));
});
test('source refusal preserves the current answer and offers retry within search', async t => {
  const h = await ready(t), original = h.window.localStorage.getItem(LAST);
  await search(h);
  await click(h, 'Preview change');
  const request = calls(h).at(-1);
  const refused = body(); refused.agnostic_route_output_experiment.day_edit = dayEditOutcome(request.body.day_edit, [], 'chosen_candidate_unavailable');
  await h.act(() => h.fetchMock.respond(request, refused));
  assert.match(h.container.textContent, /could not add.*day is unchanged/i);
  assert.equal(h.window.localStorage.getItem(LAST), original);
  assert.ok(!button(h, 'Confirm addition'));
});
test('changing the date invalidates an in-flight preview immediately', async t => {
  const h = await ready(t);
  await search(h);
  await click(h, 'Preview change');
  const request = calls(h).at(-1);
  await click(h, 'Adjust');
  await click(h, 'Tomorrow');
  await h.act(() => h.fetchMock.respond(request, body([...stops, chosen], request.body.day_edit)));
  assert.ok(!button(h, 'Confirm addition'));
});

test('cancelling an in-flight preview rejects even a late successful result', async t => {
  const h = await ready(t), original = h.window.localStorage.getItem(LAST);
  await search(h); await click(h, 'Preview change');
  const request = calls(h).at(-1);
  await click(h, 'Cancel');
  assert.equal(request.aborted, true);
  await h.act(() => h.fetchMock.respond(request, body([...stops, chosen], request.body.day_edit)));
  assert.ok(!button(h, 'Confirm addition'));
  assert.equal(h.window.localStorage.getItem(LAST), original);
});

test('midnight invalidates a ready preview while keeping the frozen visible day', async t => {
  const h = await ready(t), original = h.window.localStorage.getItem(LAST);
  await search(h); await click(h, 'Preview change');
  const request = calls(h).at(-1);
  await h.act(() => h.fetchMock.respond(request, body([...stops, chosen], request.body.day_edit)));
  t.mock.timers.setTime(Date.parse('2026-10-17T10:00:00Z'));
  await click(h, 'Confirm addition');
  assert.ok(!button(h, 'Confirm addition'));
  assert.match(h.container.textContent, /day has changed/i);
  assert.equal(h.window.localStorage.getItem(LAST), original);
});

for (const action of ['Keep', 'Remove']) test(`${action} invalidates a pending place preview before debounce`, async t => {
  const h = await ready(t);
  await search(h); await click(h, 'Preview change');
  const request = calls(h).at(-1);
  const disclosure = [...h.container.querySelectorAll('button[aria-controls]')].find(b => b.textContent.includes('Fixture Museum'));
  await h.act(() => disclosure.dispatchEvent(new h.window.MouseEvent('click', { bubbles: true })));
  await click(h, action === 'Keep' ? 'Keep this one' : action);
  await h.act(() => h.fetchMock.respond(request, body([...stops, chosen], request.body.day_edit)));
  assert.ok(!button(h, 'Confirm addition'));
  assert.ok(!h.container.querySelector('section[aria-label="The route"]').textContent.includes('River Kitchen'));
});

test('a place change cancels preview without publishing it into the former day', async t => {
  const h = await ready(t), original = h.window.localStorage.getItem(LAST);
  await search(h); await click(h, 'Preview change');
  const request = calls(h).at(-1);
  const change = [...h.container.querySelectorAll('a')].find(a => a.textContent.trim() === 'Change');
  assert.ok(change);
  await h.act(() => change.dispatchEvent(new h.window.MouseEvent('click', { bubbles: true, cancelable: true })));
  await h.act(() => h.fetchMock.respond(request, body([...stops, chosen], request.body.day_edit)));
  assert.ok(!button(h, 'Confirm addition'));
  assert.equal(h.window.localStorage.getItem(LAST), original);
});

test('saved and position snapshots require rebuilding/position consent before a new search', async t => {
  const h = await ready(t, { teardown: false });
  const saved = JSON.parse(h.window.localStorage.getItem(LAST));
  await h.unmount();
  for (const nearMe of [false, true]) {
    const entry = structuredClone(saved);
    if (nearMe) entry.inputs.mode = 'near_me';
    const restored = await mountPlanner({ url: 'http://localhost/anywhere?restore=last&lang=en', storage: { [LAST]: entry } });
    const input = restored.container.querySelector('form[aria-label="Add a place"] input');
    assert.ok(input?.readOnly && input.getAttribute('aria-disabled') === 'true', 'a source snapshot cannot grant permission for a new request');
    assert.equal(calls(restored).length, 0);
    await restored.unmount();
  }
});

test('six-stop days offer exact meal replacement without a seventh stop option', async t => {
  const h = await ready(t, { teardown: false });
  await h.unmount();
  const full = await mountPlanner({ url: 'http://localhost/anywhere?place=Fixture%20Town&lang=en' });
  t.after(() => full.unmount());
  await full.act(() => full.fetchMock.respond(calls(full)[0], body([...stops, ...stops.map(s => ({ ...s, id: s.id + '-2', label: s.label + ' 2' }))])));
  // Source search may recompose its own supply; the UI's current extent wins.
  await search(full);
  const placement = full.container.querySelector('select[aria-label="Placement for River Kitchen"]');
  assert.ok(placement);
  assert.ok(![...placement.options].some(o => o.value === ''));
  assert.match(full.container.textContent, /six stops/);
});

test('accepted place survives Save and exact reload, and Undo restores the old share reference', async t => {
  const reference = ref => ({ version: 1, state: 'ready', ref: ref.repeat(48), created_at: `${DATE}T09:00:00Z`, expires_at: '2026-10-18T09:00:00Z' });
  const originalBody = { ...body(), day_snapshot: reference('a') };
  const h = await ready(t, { teardown: false, publishedResponse: originalBody });
  await search(h); await click(h, 'Preview change');
  const request = calls(h).at(-1), acceptedBody = { ...body([...stops, chosen], request.body.day_edit), day_snapshot: reference('b') };
  await h.act(() => h.fetchMock.respond(request, acceptedBody));
  await click(h, 'Confirm addition');
  await click(h, 'Save this day');
  const saved = JSON.parse(h.window.localStorage.getItem('parranda:anywhere:saved'));
  assert.equal(saved[0].safeResponse.days[0].primary_route.main_stops.at(-1).id, 'chosen');
  const accepted = JSON.parse(h.window.localStorage.getItem(LAST));
  const links = [];
  Object.defineProperty(h.window.navigator, 'clipboard', { configurable: true, value: { writeText: async text => { links.push(text); } } });
  await click(h, 'Share this day');
  assert.ok(links.at(-1).includes('snapshot=' + 'b'.repeat(48)));
  await click(h, 'Undo');
  await click(h, 'Share this day');
  assert.ok(links.at(-1).includes('snapshot=' + 'a'.repeat(48)), 'Undo returns sharing to the old immutable answer');
  await h.unmount();
  const reload = await mountPlanner({ url: 'http://localhost/anywhere?restore=last&lang=en', storage: { [LAST]: accepted } });
  assert.match(reload.container.querySelector('section[aria-label="The route"]').textContent, /River Kitchen/);
  assert.equal(calls(reload).length, 0);
  await reload.unmount();
});

test('a late Live completion from the former day cannot overwrite an accepted addition', async t => {
  const initial = body(); initial.live_events.pending = true;
  initial.live_completion = { version: 1, token: 'c'.repeat(48), expires_in_ms: 120000 };
  const h = await ready(t, { publishedResponse: initial });
  await h.act(() => h.clock.advance(2000));
  const read = h.fetchMock.calls.find(call => call.url === '/api/planner-live-completion');
  assert.ok(read);
  await h.act(() => h.fetchMock.respond(read, { live_events: { ...initial.live_events, pending: false, tonight: [{ id: 'obsolete', title: 'Obsolete event' }] }, live_completion: { version: 1, state: 'ready', route_upgrade: 'not_supported' } }, 200, { deferBody: true }));
  await search(h); await click(h, 'Preview change');
  const request = calls(h).at(-1);
  await h.act(() => h.fetchMock.respond(request, body([...stops, chosen], request.body.day_edit)));
  await click(h, 'Confirm addition');
  await h.act(() => h.fetchMock.releaseBody(read));
  assert.equal(read.aborted, true);
  assert.match(h.container.querySelector('section[aria-label="The route"]').textContent, /River Kitchen/);
  const saved = h.window.localStorage.getItem(LAST);
  assert.ok(!saved.includes('Obsolete event'));
  assert.ok(!saved.includes('live_completion'));
});

async function acceptedAddition(t) {
  const h = await ready(t);
  await search(h); await click(h, 'Preview change');
  const request = calls(h).at(-1);
  await h.act(() => h.fetchMock.respond(request, body([...stops, chosen], request.body.day_edit)));
  await click(h, 'Confirm addition');
  return h;
}
test('changing rhythm after an accepted addition preserves its pin without excluding the same identity', async t => {
  const h = await acceptedAddition(t);
  t.mock.timers.setTime(Date.parse('2026-10-17T10:00:00Z'));
  await click(h, 'Adjust'); await click(h, 'Relaxed');
  await h.act(() => h.clock.advance(400));
  const request = calls(h).at(-1);
  assert.equal(request.body.day_rhythm, 'calm');
  assert.deepEqual(request.body.dates, [DATE], 'the accepted absolute day survives midnight');
  assert.ok(request.body.pinned_candidate_ids.includes('chosen'));
  assert.ok(!request.body.excluded_candidate_ids?.includes('chosen'));
  assert.notEqual(request.body.day_edit?.candidate_id, 'chosen');
});
test('releasing an added place removes its Keep obligation from both pin and edit intent', async t => {
  const h = await acceptedAddition(t);
  t.mock.timers.setTime(Date.parse('2026-10-17T10:00:00Z'));
  const disclosure = [...h.container.querySelectorAll('button[aria-controls]')].find(b => b.textContent.includes('River Kitchen'));
  await h.act(() => disclosure.dispatchEvent(new h.window.MouseEvent('click', { bubbles: true })));
  await click(h, 'Kept — release');
  await h.act(() => h.clock.advance(400));
  const request = calls(h).at(-1);
  assert.ok(!request.body.pinned_candidate_ids?.includes('chosen'));
  assert.deepEqual(request.body.dates, [DATE], 'Release does not select another date');
  assert.notEqual(request.body.day_edit?.action, 'add');
  assert.ok(!request.body.excluded_candidate_ids?.includes('chosen'), 'Release is not Not this');
});

for (const upgrade of [false, true]) test(`the preview's own pending Live finishes privately before confirmation (${upgrade ? 'applied upgrade' : 'events only'})`, async t => {
  const h = await ready(t), original = h.window.localStorage.getItem(LAST);
  await search(h); await click(h, 'Preview change');
  const request = calls(h).at(-1), preview = body([...stops, chosen], request.body.day_edit);
  preview.live_events.pending = true;
  preview.live_completion = { version: 1, token: 'd'.repeat(48), expires_in_ms: 120000, route_upgrade: upgrade ? 'explicit_request' : 'not_supported' };
  await h.act(() => h.fetchMock.respond(request, preview));
  assert.ok(!button(h, 'Confirm addition'), 'an unfinished generation is not yet confirmable');
  assert.equal(h.window.localStorage.getItem(LAST), original);
  await h.act(() => h.clock.advance(2000));
  const completion = h.fetchMock.calls.find(call => call.url === '/api/planner-live-completion' && call.body.token === 'd'.repeat(48));
  assert.ok(completion, 'the preview follows its own capability');
  const reference = { version: 1, state: 'ready', ref: 'd'.repeat(48), created_at: `${DATE}T09:00:00Z`, expires_at: '2026-10-18T09:00:00Z' };
  await h.act(() => h.fetchMock.respond(completion, { live_events: { ...preview.live_events, pending: false }, day_snapshot: reference,
    live_completion: { version: 1, state: 'ready', route_upgrade: upgrade ? 'explicit_request' : 'not_supported' } }));
  if (upgrade) {
    const call = h.fetchMock.calls.find(call => call.url === '/api/planner-live-route-upgrade');
    assert.ok(call);
    await h.act(() => h.fetchMock.respond(call, { live_route_upgrade: { version: 1, state: 'applied' }, result: { ...body([...stops, chosen], request.body.day_edit), day_snapshot: reference } }));
  }
  assert.ok(button(h, 'Confirm addition'));
  const before = calls(h).length;
  await click(h, 'Confirm addition');
  const accepted = JSON.parse(h.window.localStorage.getItem(LAST));
  assert.equal(accepted.safeResponse.live_events.pending, false);
  assert.equal(accepted.safeResponse.day_snapshot.ref, reference.ref);
  assert.ok(!JSON.stringify(accepted).includes('live_completion'));
  assert.equal(calls(h).length, before);
  assert.ok(button(h, 'Share this day'));
});

test('expired preview Live leaves the current day unchanged and cannot be confirmed', async t => {
  const h = await ready(t), original = h.window.localStorage.getItem(LAST);
  await search(h); await click(h, 'Preview change');
  const request = calls(h).at(-1), preview = body([...stops, chosen], request.body.day_edit);
  preview.live_events.pending = true; preview.live_completion = { version: 1, token: 'd'.repeat(48), expires_in_ms: 120000 };
  await h.act(() => h.fetchMock.respond(request, preview));
  await h.act(() => h.clock.advance(2000));
  const completion = h.fetchMock.calls.find(call => call.url === '/api/planner-live-completion');
  assert.ok(completion);
  await h.act(() => h.fetchMock.respond(completion, {}, 410));
  assert.ok(!button(h, 'Confirm addition'));
  assert.equal(h.window.localStorage.getItem(LAST), original);
});

test('cancelling the preview cancels its own Live read and rejects a late terminal body', async t => {
  const h = await ready(t), original = h.window.localStorage.getItem(LAST);
  await search(h); await click(h, 'Preview change');
  const request = calls(h).at(-1), preview = body([...stops, chosen], request.body.day_edit);
  preview.live_events.pending = true; preview.live_completion = { version: 1, token: 'd'.repeat(48), expires_in_ms: 120000 };
  await h.act(() => h.fetchMock.respond(request, preview));
  await h.act(() => h.clock.advance(2000));
  const completion = h.fetchMock.calls.find(call => call.url === '/api/planner-live-completion');
  assert.ok(completion);
  await click(h, 'Cancel');
  assert.equal(completion.aborted, true);
  await h.act(() => h.fetchMock.respond(completion, { live_events: { ...preview.live_events, pending: false }, live_completion: { version: 1, state: 'ready', route_upgrade: 'not_supported' } }));
  assert.ok(!button(h, 'Confirm addition'));
  assert.equal(h.window.localStorage.getItem(LAST), original);
});
