const test = require('node:test');
const assert = require('node:assert/strict');
const { collectAnchorEvents, eventCacheKey, rankCollectedEventsForPreferences } = require('../server/place-candidates/agnostic-event-supply');
const { executeLiveEventQuery } = require('../server/place-candidates/live-event-query');
const { eventOccursOnDate, selectedDateBucket, sourceWindowStart } = require('../server/place-candidates/event-calendar-date');

const anchor = { lat: 60.17, lng: 24.94 };
const now = '2026-06-28T12:00:00Z';
const registry = [{ id: 'official', label: 'Official calendar', adapter: 'localized_events_api',
  endpoint: 'https://calendar.example/events/', bbox: [24,60,25,61], timezone: 'Europe/Helsinki',
  source_language: 'en', source_tier: 'official', confidence: 'medium',
  source_family: 'official_tourism_open_api', source_identity: 'calendar.example', status: 'active' }];
const record = (id, date) => ({ id, title: { en: id }, start_date: date, end_date: date,
  start_time: '18:00', end_time: '22:00', external_website_url: `https://calendar.example/${id}`,
  venue_name: 'Quay stage', location: { latitude: 60.171, longitude: 24.941 } });

test('tomorrow is its own Live day; today is not relabelled or admitted', async () => {
  const out = await collectAnchorEvents({ anchor, now, selectedDate: '2026-06-29', registry,
    fetcher: async () => ({ ok: true, text: async () => JSON.stringify({ results: [
      record('today', '2026-06-28'), record('tomorrow', '2026-06-29'), record('later', '2026-06-30'),
    ] }) }),
  });
  assert.equal(out.selected_date, '2026-06-29');
  assert.deepEqual(out.tonight.map(x => x.id), ['tomorrow']);
  assert.deepEqual(out.this_week.map(x => x.id), ['later']);
  assert.equal(out.tonight[0].timing_relevance, 'future', 'selection must not rewrite the real clock');
});

test('bounded warm projection does not repeat timezone work for every horizon day', () => {
  const events = Array.from({ length: 40 }, (_, i) => ({ id: `concert-${i}`, title: `Concert ${i}`,
    timezone: 'Europe/Helsinki', starts_at: '2026-07-05T15:00:00Z', ends_at: '2026-07-05T19:00:00Z' }));
  const original = Intl.DateTimeFormat;
  let formats = 0;
  Intl.DateTimeFormat = new Proxy(original, { construct(target, args) {
    formats += 1;
    return Reflect.construct(target, args);
  } });
  try {
    const result = rankCollectedEventsForPreferences({ selected_date: '2026-06-28', coverage: 'covered',
      tonight: [], this_week: events }, [], null, now);
    assert.equal(result.this_week.length, 6);
    assert.ok(formats <= 600, `bounded projection constructed ${formats} timezone formatters`);
  } finally { Intl.DateTimeFormat = original; }
});

test('the cache isolates selected dates even at the same anchor and acquisition hour', () => {
  assert.notEqual(eventCacheKey(anchor, now, ['official'], 3000, null, '2026-06-28'),
    eventCacheKey(anchor, now, ['official'], 3000, null, '2026-06-29'));
});

test('calendar overlap uses source timezone, exclusive end boundaries and DST-local midnights', () => {
  const ev = { timezone: 'Asia/Tokyo', starts_at: '2026-06-28T15:30:00Z', ends_at: '2026-06-28T17:00:00Z' };
  assert.equal(eventOccursOnDate(ev, '2026-06-28', now), false);
  assert.equal(eventOccursOnDate(ev, '2026-06-29', now), true);
  assert.equal(eventOccursOnDate({ ...ev, timezone: undefined }, '2026-06-29', now), false);
  assert.equal(eventOccursOnDate({ ...ev, ends_at: '2026-06-28T15:00:00Z' }, '2026-06-29', now), false);
  assert.equal(eventOccursOnDate({ ...ev, freshness: 'stale' }, '2026-06-29', now), false);
  assert.equal(sourceWindowStart('2026-03-29', 'Europe/Stockholm', '2026-03-28T12:00:00Z'), '2026-03-28T23:00:00.000Z');
  assert.equal(sourceWindowStart('2026-03-30', 'Europe/Stockholm', '2026-03-28T12:00:00Z'), '2026-03-29T22:00:00.000Z');
});

test('continuous intervals survive skipped and repeated local midnights', () => {
  const before = '2026-09-01T12:00:00Z';
  const daytime = { timezone: 'America/Santiago', starts_at: '2026-09-06T15:00:00Z', ends_at: '2026-09-06T17:00:00Z' };
  assert.equal(eventOccursOnDate(daytime, '2026-09-06', before), true);
  const overnight = { ...daytime, starts_at: '2026-09-06T03:30:00Z', ends_at: '2026-09-06T04:30:00Z' };
  assert.equal(eventOccursOnDate(overnight, '2026-09-05', before), true);
  assert.equal(eventOccursOnDate(overnight, '2026-09-06', before), true);
  assert.equal(eventOccursOnDate({ ...overnight, ends_at: '2026-09-06T04:00:00Z' }, '2026-09-06', before), false);
  const fold = { timezone: 'America/Havana', starts_at: '2026-11-01T05:15:00Z', ends_at: '2026-11-01T06:00:00Z' };
  assert.equal(eventOccursOnDate(fold, '2026-11-01', before), true);
  const skippedDay = { timezone: 'Pacific/Apia', starts_at: '2011-12-29T22:00:00Z', ends_at: '2011-12-30T22:00:00Z' };
  assert.equal(eventOccursOnDate(skippedDay, '2011-12-30', '2011-12-28T00:00:00Z'), false);
});

test('daily and date-only facts stay calendar-based; current-day closed hours cannot revive tomorrow', () => {
  const daily = { timezone: 'Europe/Helsinki', time_window: { kind: 'daily', starts_on: '2026-06-28', ends_on: '2026-06-30', local_start: '10:00', local_end: '14:00' } };
  assert.equal(eventOccursOnDate(daily, '2026-06-28', now), false);
  assert.equal(eventOccursOnDate(daily, '2026-06-29', now), true);
  assert.equal(eventOccursOnDate({ time_window: { kind: 'all_day', starts_on: '2026-06-29', ends_on: '2026-06-29' } }, '2026-06-29', now), true);
  assert.equal(eventOccursOnDate({ time_window: { kind: 'all_day', starts_on: '2026-06-25', ends_on: '2026-06-25' } }, '2026-06-25', now), false,
    'a date already past everywhere must not revive merely because timezone is absent');
});

test('warm selected-day results expire against the real clock without reacquisition or stale count claims', () => {
  const cached = { selected_date: '2026-06-28', coverage: 'covered',
    tonight: [{ id: 'ended', title: 'Concert', timezone: 'Europe/Helsinki', starts_at: '2026-06-28T15:00:00Z', ends_at: '2026-06-28T19:00:00Z' }], this_week: [],
    acquisition: { source_health: { status: 'healthy', result: 'events_found', responding_source_count: 1, accepted_event_count: 1, reasons: ['bounded_events_found'] } },
  };
  const result = rankCollectedEventsForPreferences(cached, [], null, '2026-06-28T19:00:01Z');
  assert.deepEqual(result.tonight, []);
  assert.equal(result.acquisition.source_health.accepted_event_count, 0);
  assert.equal(result.acquisition.source_health.result, 'empty');
  assert.ok(!result.acquisition.source_health.reasons.includes('bounded_events_found'));
  assert.equal(cached.tonight.length, 1, 'read projection never mutates cached evidence');
});

test('Live API passes only a valid date, retaining its real clock and ignoring public timezone/source claims', async () => {
  let received;
  const payload = { anchor, selected_date: '2026-06-29', timezone: 'UTC', source_tier: 'official' };
  const out = await executeLiveEventQuery({ payload, now, eventSupply: async input => {
    received = input;
    return { coverage: 'covered', selected_date: input.selectedDate, tonight: [], this_week: [] };
  } });
  assert.equal(received.selectedDate, '2026-06-29');
  assert.equal(received.now, now);
  assert.equal(received.timezone, undefined);
  assert.equal(received.source_tier, undefined);
  assert.equal(out.body.live_events.selected_date, '2026-06-29');
  for (const selected_date of ['2026-02-30', 'tomorrow', {}, '2026-06-29T00:00:00Z']) {
    assert.equal((await executeLiveEventQuery({ payload: { anchor, selected_date }, now })).status, 400);
  }
});

// 9 July 2026 is a Thursday; 10 July is a Friday.
const thursdaySeries = { timezone: 'Europe/Stockholm', starts_on: '2026-06-25', ends_on: '2026-07-16',
  time_window: { kind: 'occurrences', dates: ['2026-06-25', '2026-07-02', '2026-07-09', '2026-07-16'],
    starts_on: '2026-06-25', ends_on: '2026-07-16', local_start: '18:00', local_end: '21:00', timezone: 'Europe/Stockholm' } };
const beforeSeries = '2026-07-08T10:00:00Z';

test('listed occurrences reach a selected day only on a stated date', () => {
  assert.equal(eventOccursOnDate(thursdaySeries, '2026-07-09', beforeSeries), true);
  assert.equal(eventOccursOnDate(thursdaySeries, '2026-07-10', beforeSeries), false, 'a Friday inside the range is not a stated date');
  assert.equal(selectedDateBucket(thursdaySeries, '2026-07-09', beforeSeries), 'tonight');
  assert.equal(selectedDateBucket(thursdaySeries, '2026-07-10', beforeSeries), 'this_week', 'next stated Thursday is inside the following days');
  assert.equal(selectedDateBucket(thursdaySeries, '2026-07-17', beforeSeries), null, 'no stated date remains');
  // A listed session that already ended does not stay on today's list.
  const afterSession = '2026-07-09T19:30:00Z'; // 21:30 in Stockholm
  assert.equal(eventOccursOnDate(thursdaySeries, '2026-07-09', afterSession), false);
  assert.equal(selectedDateBucket(thursdaySeries, '2026-07-09', afterSession), 'this_week');

  const dateOnly = { time_window: { kind: 'occurrences', dates: ['2026-07-09'] } };
  assert.equal(eventOccursOnDate(dateOnly, '2026-07-09', beforeSeries), true, 'listed date facts need no invented hours');
  assert.equal(eventOccursOnDate(dateOnly, '2026-07-10', beforeSeries), false);
  const startOnly = { timezone: 'Europe/Stockholm', time_window: { kind: 'occurrences', dates: ['2026-07-09'], local_start: '19:00' } };
  assert.equal(eventOccursOnDate(startOnly, '2026-07-09', beforeSeries), true);
  assert.equal(eventOccursOnDate({ ...startOnly, timezone: undefined }, '2026-07-09', beforeSeries), false,
    'a clocked listing needs the reviewed venue timezone');
});

test('a period never claims the selected day, only following days it overlaps', () => {
  const period = { timezone: 'Europe/Stockholm', starts_on: '2026-06-25', ends_on: '2026-07-16',
    time_window: { kind: 'period', starts_on: '2026-06-25', ends_on: '2026-07-16', local_start: '18:00', local_end: '21:00' } };
  for (const date of ['2026-06-25', '2026-07-09', '2026-07-10', '2026-07-16']) {
    assert.equal(eventOccursOnDate(period, date, '2026-06-20T10:00:00Z'), false, date);
  }
  assert.equal(selectedDateBucket(period, '2026-07-10', beforeSeries), 'this_week');
  assert.equal(selectedDateBucket(period, '2026-06-20', '2026-06-19T10:00:00Z'), 'this_week', 'starts inside the following days');
  assert.equal(selectedDateBucket(period, '2026-07-16', beforeSeries), null, 'overlapping only the selected day claims nothing');
  assert.equal(selectedDateBucket(period, '2026-07-20', beforeSeries), null);
  assert.equal(selectedDateBucket({ ...period, timing_relevance: 'stale' }, '2026-07-10', beforeSeries), null);
});
