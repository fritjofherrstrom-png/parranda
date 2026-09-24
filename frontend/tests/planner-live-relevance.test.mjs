import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { mountPlanner } from './helpers/planner-harness.mjs';

// Mounted component with controlled transport, not real-provider acceptance.
// The Live rows are ranked and shaped by the server's own functions, so the
// sheet is checked against the fit fields the server really emits.
const require = createRequire(import.meta.url);
const { rankCollectedEventsForPreferences } = require('../../server/place-candidates/agnostic-event-supply.js');
const { shapeCollectedLiveEvents } = require('../../server/place-candidates/live-event-query.js');

const PICKS = ['food', 'culture', 'views']; // the Planner's default chips
const HEALTHY = { status: 'healthy', result: 'events_found', reasons: [], selected_source_count: 1,
  responding_source_count: 1, event_bearing_source_count: 1, accepted_event_count: 8 };

function row(id, title, salience, extra = {}) {
  return { id, title, starts_at: '2026-06-28T17:00:00Z', ends_at: '2026-06-28T19:00:00Z',
    timezone: 'Europe/Stockholm', place: `Venue ${id}`, source_label: 'Official calendar',
    source_url: `https://calendar.example/${id}`, salience_score: salience, cultural_tier: 'neutral',
    tags: [], ...extra };
}
function serverLiveEvents(rows, picks = PICKS) {
  return shapeCollectedLiveEvents(rankCollectedEventsForPreferences({
    coverage: 'covered', tonight: [], this_week: [], acquisition: { source_health: HEALTHY },
    _rankable_events: { tonight: rows, this_week: [] },
  }, picks));
}
function day(liveEvents) {
  return { days: [{ experimental_agnostic_route_applied: true, primary_route: {
    id: '__agnostic_compose__', title: 'Published day', main_stops: [
      { id: 'a', label: 'Museum', lat: 59.33, lng: 18.06 },
      { id: 'b', label: 'Cafe', lat: 59.332, lng: 18.062 },
    ], estimated_km: 2, map_path_points: [], legs: [], confidence: 'low',
  }, alternatives: [] }], live_events: liveEvents,
  agnostic_route_output_experiment: { promotion: { promote: true }, source_status: { anchor: { lat: 59.33, lng: 18.06 } } } };
}
const button = (h, pattern) => [...h.container.querySelectorAll('button')].find(b => pattern.test(b.textContent));
async function click(h, control) {
  assert.ok(control, 'control exists');
  await h.act(() => control.dispatchEvent(new h.window.Event('click', { bubbles: true })));
}
async function composedPlanner(t, liveEvents, { lang = 'en', picks = PICKS } = {}) {
  const prefs = picks === PICKS ? '' : `&prefs=${picks.join(',')}`;
  const h = await mountPlanner({ url: `http://localhost/anywhere?place=Testville${prefs}&lang=${lang}` });
  t.after(() => h.unmount());
  await h.clock.advance(500);
  const compose = h.fetchMock.pending()[0];
  assert.deepEqual(compose.body.preferences, picks, 'Live was ranked for the picks on screen');
  await h.fetchMock.respond(compose, day(liveEvents));
  await h.clock.advance(50);
  return h;
}
const sheet = h => h.container.querySelector('[role="dialog"]');
function rowsUnder(h, heading) {
  const title = [...sheet(h).querySelectorAll('p')].find(p => p.textContent.trim() === heading);
  assert.ok(title, `"${heading}" is shown`);
  assert.equal(title.nextElementSibling?.tagName, 'UL');
  return [...title.nextElementSibling.children].map(li => li.textContent);
}

// Six rows compete for the highlights. A music-tagged "kvällskonsert" is a
// match only through the closed-compound head, and the server reserves its
// last highlight slot for a salient local happening outside the picks.
const ROWS = [
  row('a-evening-concert', 'Fixture: kvällskonsert', 5, { tags: ['music', 'Music'] }),
  row('b-jazz', 'Jazzkonsert på kajen', 5),
  row('c-exhibition', 'Sommarutställning', 5),
  row('d-sunset', 'Sunset photo walk', 5),
  row('e-market', 'Saturday market', 7),
  row('f-food', 'Street food tasting', 4.9),
  row('g-swim', 'Night swim at the harbour', 7.5),
  row('h-library', 'Library open house', 5),
];

test('the Live sheet claims picks only for server matches and labels every other row honestly', async t => {
  const liveEvents = serverLiveEvents(ROWS);
  assert.deepEqual(liveEvents.tonight.map(e => e.id),
    ['e-market', 'a-evening-concert', 'b-jazz', 'c-exhibition', 'd-sunset', 'g-swim']);
  assert.equal(liveEvents.tonight.at(-1).highlight_reason, 'local_serendipity');
  assert.deepEqual(liveEvents.browse.tonight.more.map(e => e.id), ['f-food', 'h-library']);

  const h = await composedPlanner(t, liveEvents);
  await click(h, button(h, /See all live/));

  const picks = rowsUnder(h, 'Highlights for your picks');
  assert.equal(picks.length, 4);
  assert.match(picks[0], /Fixture: kvällskonsert.*Matches: Culture$/);
  assert.match(picks[1], /Jazzkonsert på kajen.*Matches: Culture$/);
  assert.match(picks[2], /Sommarutställning.*Matches: Culture$/);
  assert.match(picks[3], /Sunset photo walk.*Matches: Views$/);

  const other = rowsUnder(h, 'Other local highlights');
  assert.equal(other.length, 2);
  assert.match(other[0], /Saturday market.*A looser match for: Food & drink$/, 'the pick is named as its chip reads');
  assert.match(other[1], /Night swim at the harbour.*A local discovery beyond your picks$/);

  const more = [...sheet(h).querySelectorAll('details li')].map(li => li.textContent);
  assert.equal(more.length, 2);
  assert.match(more[0], /Street food tasting.*Matches: Food & drink$/);
  assert.match(more[1], /Library open house · Venue h-library · Official calendar$/, 'no server reason, no line');
});

test('without a server match the sheet makes no claim about the picks', async t => {
  const liveEvents = serverLiveEvents([row('a-open-house', 'Library open house', 6), row('b-walk-in', 'Neighbourhood drop-in', 5)]);
  assert.ok(liveEvents.tonight.every(e => e.preference_match === 'none'));

  const h = await composedPlanner(t, liveEvents);
  await click(h, button(h, /See all live/));

  assert.equal(rowsUnder(h, 'Highlights').length, 2);
  assert.doesNotMatch(sheet(h).textContent,
    /Highlights for your picks|Other local highlights|Matches:|looser match|local discovery/);
});

test('a pick added before the day recomposes is never claimed from the older ranking', async t => {
  const h = await composedPlanner(t, serverLiveEvents(ROWS));
  await click(h, button(h, /Adjust/));
  await click(h, button(h, /^Nightlife$/));
  // Within the 400 ms before the recompose leaves, the published day and its
  // Live rows are still on screen.
  await click(h, button(h, /See all live/));

  const picks = rowsUnder(h, 'Highlights for your picks');
  assert.match(picks[0], /Fixture: kvällskonsert.*Matches: Culture$/, 'a match to a pick still held stays true');
  assert.doesNotMatch(sheet(h).textContent, /Nightlife/, 'the server never ranked for the new pick');
  const other = rowsUnder(h, 'Other local highlights');
  assert.match(other[1], /Night swim at the harbour · Venue g-swim · Official calendar$/,
    '"beyond your picks" is not established for a pick the server never checked');
});

test('Swedish reason lines name each pick exactly as its chip reads', async t => {
  const h = await composedPlanner(t, serverLiveEvents(ROWS), { lang: 'sv' });
  await click(h, button(h, /Se allt live/));

  assert.match(rowsUnder(h, 'Höjdpunkter för dina val')[0], /Fixture: kvällskonsert.*Matchar: Kultur$/);
  const other = rowsUnder(h, 'Andra lokala höjdpunkter');
  assert.match(other[0], /Saturday market.*Lösare träff för: Mat & dryck$/);
  assert.match(other[1], /Night swim at the harbour.*Lokal upptäckt utanför dina val$/);
});

test('the known subject-compound false hits show no match reason anywhere in Live', async t => {
  const picks = ['food', 'culture', 'views', 'green'];
  const falseHits = [
    'Nationell hundutställning',
    'Veteranbilsutställning på torget',
    'Koiranäyttely',
    'Rechnungsausstellung: Schulung',
    'Fågelkonsert i gryningen',
    'Hupkonzert gegen Fluglärm',
    'Barnträdgård Solstrålen: föräldramöte',
  ];
  const liveEvents = serverLiveEvents([
    row('a-evening-concert', 'Fixture: kvällskonsert', 5),
    ...falseHits.map((title, index) => row(`z-false-${index}`, title, 5)),
  ], picks);
  for (const event of [...liveEvents.tonight, ...liveEvents.browse.tonight.more].filter(e => falseHits.includes(e.title))) {
    assert.equal(event.preference_match, 'none', event.title);
    assert.equal(event.preference_score, 0, event.title);
  }

  const h = await composedPlanner(t, liveEvents, { lang: 'sv', picks });
  await click(h, button(h, /Se allt live/));

  const picked = rowsUnder(h, 'Höjdpunkter för dina val');
  assert.equal(picked.length, 1);
  assert.match(picked[0], /Fixture: kvällskonsert.*Matchar: Kultur$/);
  const rows = [...sheet(h).querySelectorAll('li')].map(li => li.textContent);
  for (const title of falseHits) {
    const text = rows.find(line => line.includes(title));
    assert.ok(text, `${title} is still listed`);
    assert.doesNotMatch(text, /Matchar|Lösare träff|Lokal upptäckt/, `${title} carries no reason`);
  }
});
