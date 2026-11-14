import assert from 'node:assert/strict';
import test from 'node:test';
import { mountPlanner } from './helpers/planner-harness.mjs';

// Mounted Planner + real React with a pinned clock: fixture evidence, not
// real-provider acceptance. Live at 14:05 venue time grouped by where each
// row stands in the day (QA, staging, 23 Oct 2026: a lunch theatre listed
// "12:00" with no end read as something about to happen, and the date was
// printed three times).
const NOW = Date.parse('2026-10-07T11:05:00Z'); // 14:05 in Helsinki (EEST)
const DAY = '2026-10-07';
const ZONE = 'Europe/Helsinki';

function pinClock(t) {
  const RealDate = globalThis.Date;
  class PinnedDate extends RealDate {
    constructor(...args) { super(...(args.length ? args : [NOW])); }
    static now() { return NOW; }
  }
  globalThis.Date = PinnedDate;
  t.after(() => { globalThis.Date = RealDate; });
}

const counts = ['selected_source_count', 'responding_source_count', 'event_bearing_source_count', 'empty_source_count',
  'failed_source_count', 'unavailable_source_count', 'raw_event_count', 'normalized_event_count',
  'accepted_event_count', 'surfaced_event_count', 'rejected_event_count'];
const row = (id, title, time_window) => ({ id, title, place: 'Source venue', lat: 60.2, lng: 24.94, timezone: ZONE, time_window,
  source_url: 'https://calendar.example/event', source_link_kind: 'page', source_link_host: 'calendar.example' });
const TONIGHT = [
  row('lunch', 'Lunch theatre', { kind: 'continuous', starts_at: '2026-10-07T09:00:00Z' }),
  row('concert', 'Evening concert', { kind: 'occurrences', dates: [DAY], local_start: '19:30', local_end: '21:00' }),
  row('exhibition', 'Harbour exhibition', { kind: 'continuous', starts_at: '2026-10-05T07:00:00Z', ends_at: '2026-10-07T14:00:00Z' }),
  row('festival', 'Light festival', { kind: 'all_day', starts_on: DAY, ends_on: DAY, all_day_explicit: true }),
];
const live = () => ({ coverage: 'covered', selected_date: DAY, tonight: TONIGHT, this_week: [],
  acquisition: { source_health: { ...Object.fromEntries(counts.map(k => [k, 0])), status: 'healthy', result: 'events',
    reasons: [], selected_source_count: 1, responding_source_count: 1, accepted_event_count: 4, surfaced_event_count: 4 } } });
const day = () => ({ days: [{ experimental_agnostic_route_applied: true, primary_route: {
  id: '__agnostic_compose__', title: 'Published day', main_stops: [{ id: 'a', label: 'Museum', lat: 60.17, lng: 24.94 },
    { id: 'b', label: 'Cafe', lat: 60.172, lng: 24.942 }], estimated_km: 2, map_path_points: [], legs: [], confidence: 'low' }, alternatives: [] }],
  live_events: live(), agnostic_route_output_experiment: { promotion: { promote: true },
    intake: { query: 'Testville' }, source_status: { anchor: { lat: 60.17, lng: 24.94 } } } });

async function composed(t, lang) {
  pinClock(t);
  const h = await mountPlanner({ url: `http://localhost/anywhere?place=Testville&lang=${lang}`, props: { lang } });
  t.after(() => h.unmount());
  await h.clock.advance(500);
  await h.fetchMock.respond(h.fetchMock.pending()[0], day());
  await h.clock.advance(50);
  return h;
}
const liveCard = (h) => [...h.container.querySelectorAll('section')].find(s => /^Live (in|i) Testville/.test(s.querySelector('h2')?.textContent || ''));
// A row reads its title heading first, then its time line.
const title = (li) => li.querySelector(':scope > div > :is(h3, h4, h5)');
const groups = (root) => [...root.querySelectorAll('[data-live-time-group]')].map(g => ({
  heading: g.querySelector(':scope > :is(h3, h4)')?.textContent,
  rows: [...g.querySelectorAll(':scope > ul > li')].map(li => [li.querySelector(':scope > div > :is(h3, h4, h5) + div > p')?.textContent, title(li)?.textContent]),
}));
// A title sits one level below its time group's heading.
const titleLevels = (root) => [...root.querySelectorAll('[data-live-time-group] > ul > li')].map(li => title(li)?.tagName);
const button = (h, re) => [...h.container.querySelectorAll('button')].find(b => re.test(b.textContent.trim()));

test('the Live card reads its rows by time state and names the day once (en)', async t => {
  const h = await composed(t, 'en');
  const card = liveCard(h);
  assert.ok(card, h.text());
  assert.deepEqual(groups(card), [
    { heading: 'On now', rows: [['until 17:00', 'Harbour exhibition']] },
    { heading: 'Later today', rows: [['19:30–21:00', 'Evening concert']] },
    { heading: 'During the day', rows: [['All day', 'Light festival']] },
    { heading: 'Started earlier', rows: [['started 12:00 · end time unknown', 'Lunch theatre']] },
  ]);
  assert.equal(card.querySelectorAll('[data-live-time-group] > h3').length, 4);
  assert.deepEqual(titleLevels(card), ['H4', 'H4', 'H4', 'H4']);
  // The date is in the heading, not on every row.
  assert.equal((card.textContent.match(/Wed 7 Oct/g) || []).length, 1, card.textContent);
  // "See all live" is a secondary Live-blue outline, not a second filled action.
  const seeAll = button(h, /^See all live/);
  assert.match(seeAll.className, /border-parranda-live\/60/);
  assert.doesNotMatch(seeAll.className, /(^|\s)bg-parranda-live(\s|$)/);
});

test('the Live card time groups in Swedish, and a passed start is neither on now nor over', async t => {
  const h = await composed(t, 'sv');
  const card = liveCard(h);
  assert.deepEqual(groups(card).map(g => g.heading), ['Pågår nu', 'Senare i dag', 'Under dagen', 'Började tidigare']);
  assert.deepEqual(groups(card)[3].rows, [['började 12:00 · sluttid okänd', 'Lunch theatre']]);
  assert.doesNotMatch(card.textContent, /avslutad|slutade/);
});

test('the Live sheet is headed h2, and By time reads the current day by time state', async t => {
  const h = await composed(t, 'en');
  await h.act(() => button(h, /^See all live/).dispatchEvent(new h.window.Event('click', { bubbles: true })));
  const query = h.fetchMock.pending().find(c => c.url.includes('/api/live-events'));
  if (query) {
    await h.fetchMock.respond(query, { contract: 'live_event_query_v1', query: { scope: query.body.scope, time: query.body.time,
      selected_date: DAY }, route_mutation: false, day_anchor_mutation: false, live_events: live() });
  }
  const sheet = h.container.querySelector('[role="dialog"]');
  assert.equal(sheet.querySelector('h2')?.textContent, 'Live in Testville');
  await h.act(() => button(h, /^By time$/).dispatchEvent(new h.window.Event('click', { bubbles: true })));
  const section = [...sheet.querySelectorAll('section')].find(s => s.getAttribute('aria-label') === 'Wed 7 Oct');
  assert.ok(section, sheet.textContent);
  // The list's own line already names the selected day, so its section does
  // not print the date again: the time groups are its headings.
  assert.equal(section.querySelector(':scope > h3'), null);
  assert.equal((sheet.textContent.match(/Wed 7 Oct/g) || []).length, 2, 'the When choice and the list line, nothing more');
  // The multi-day exhibition is a source date range and keeps its own section.
  assert.deepEqual(groups(section).map(g => g.heading), ['Later today', 'During the day', 'Started earlier']);
  assert.deepEqual([...section.querySelectorAll('[data-live-time-group] > h3')].map(h => h.textContent), ['Later today', 'During the day', 'Started earlier']);
  assert.deepEqual(titleLevels(section), ['H4', 'H4', 'H4']);
  assert.deepEqual(groups(section)[0].rows.map(([timing]) => timing), ['19:30–21:00'], 'the day is named once, above');
  const ranges = [...sheet.querySelectorAll('section')].find(s => s.getAttribute('aria-label') === 'Source date ranges');
  assert.match(ranges.textContent, /Harbour exhibition/);
  assert.match(ranges.textContent, /on now · until 17:00/);
  assert.deepEqual([...ranges.querySelectorAll('li > div > :is(h3, h4, h5)')].map(h => h.tagName), ['H4'], 'one level below the section heading');
});
