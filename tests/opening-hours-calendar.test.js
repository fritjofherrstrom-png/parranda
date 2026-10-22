'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluateOperationalViability } = require('../server/place-candidates/operational-viability');
const { selectedHoursCalendarKey: key, normalizeSelectedHoursCalendar: normalize,
  projectSelectedHoursCalendar: project, resolveCandidateDayHours: resolve } = require('../server/place-candidates/opening-hours-calendar');
const row = { id: 'selected-cafe', name: 'Juniper Café', type: 'cafe', lat: 59.8, lng: 17.6,
  website: 'http://www.owner.example/cafe' };
const windows = [{ opens: '06:30', closes: '18:00' }];
const fact = changes => ({ contract: 'selected-hours-calendar-v1', identity_key: key(row),
  visit_function: 'general_visit', entry_url: 'https://www.owner.example/cafe',
  source_url: 'https://owner.example/cafe', source_relation: 'entry', observed_at: '2026-10-19T08:00:00.000Z',
  rules: [{ week: { Mo: windows, Sa: [{ opens: '08:00', closes: '15:30' }] } }],
  overrides: [], unresolved: [], ...changes });
const options = (date, changes) => ({ date, timezone: 'Europe/Stockholm', ...changes });
const day = (calendar, date, changes) => project(calendar, options(date, changes));

// Removing explicit weekday coverage must make this fail: omitted days stay unknown.
test('a partial ordinary week projects its stated weekday without inventing missing-day closure', () => {
  const calendar = normalize(fact(), { record: row });
  assert.ok(calendar);
  assert.deepEqual(day(calendar, '2026-10-19')?.selected_day_hours, {
    status: 'known', all_day: false, windows, date: '2026-10-19', timezone: 'Europe/Stockholm',
    source_url: 'https://owner.example/cafe', observed_at: '2026-10-19T08:00:00.000Z',
  });
  assert.equal(day(calendar, '2026-10-25')?.status, 'unknown');
  assert.equal(day(calendar, '2026-10-25')?.eligible, true);
});

test('absolute validity is inclusive and never treats absence beyond the interval as closure', () => {
  const calendar = normalize(fact({ rules: [{ week: { Mo: windows, Su: [] },
    validity: { kind: 'absolute', from: '2026-10-19', through: '2026-10-25' } }] }), { record: row });
  assert.equal(day(calendar, '2026-10-19')?.status, 'known');
  assert.equal(day(calendar, '2026-10-25')?.status, 'closed');
  assert.equal(day(calendar, '2026-10-18')?.status, 'unknown');
  assert.equal(day(calendar, '2026-10-26')?.status, 'unknown');
});

test('annual seasons cross New Year while a summer Monday remains independently open', () => {
  const calendar = normalize(fact({ rules: [
    { week: { Mo: [] }, validity: { kind: 'annual', from: '09-01', through: '05-31' } },
    { week: { Mo: windows }, validity: { kind: 'annual', from: '06-01', through: '08-31' } },
  ] }), { record: row });
  for (const date of ['2026-10-19', '2026-12-28', '2027-01-04', '2027-05-31']) {
    assert.equal(day(calendar, date)?.status, 'closed', date);
  }
  assert.equal(day(calendar, '2027-06-07')?.status, 'known');
  assert.equal(calendar?.observed_at, '2026-10-19T08:00:00.000Z');
});

test('an absolute holiday closure overrides ordinary hours without making the business inactive', () => {
  const calendar = normalize(fact({ overrides: [{ from: '2026-10-19', through: '2026-10-19', status: 'closed', windows: [] }] }), { record: row });
  const candidate = { ...row, selected_hours_calendar: calendar };
  const result = resolve(candidate, options('2026-10-19'));
  assert.equal(result?.status, 'closed');
  assert.equal(result?.eligible, false);
  assert.equal(result?.selected_day_hours?.status, 'closed');
  assert.equal(candidate.opening_hours, undefined);
  assert.equal(evaluateOperationalViability({ candidate }).route_eligible, true);
  assert.equal(resolve(candidate, options('2026-10-26'))?.status, 'known');
});

test('known overrides carry their own windows across an explicitly dated year boundary', () => {
  const calendar = normalize(fact({ overrides: [{ from: '2026-12-31', through: '2027-01-01', status: 'known',
    windows: [{ opens: '10:00', closes: '12:00' }] }] }), { record: row });
  for (const date of ['2026-12-31', '2027-01-01']) {
    assert.deepEqual(day(calendar, date)?.selected_day_hours?.windows, [{ opens: '10:00', closes: '12:00' }]);
  }
  assert.equal(day(calendar, '2027-12-31')?.status, 'unknown');
});

test('unresolved rules suppress ordinary hours only inside their explicit date and weekday scope', () => {
  const calendar = normalize(fact({ unresolved: [{ reason: 'late_hours_unresolved', weekdays: [1],
    from: '2026-10-19', through: '2026-10-19' }] }), { record: row });
  assert.equal(day(calendar, '2026-10-19')?.status, 'unknown');
  assert.equal(day(calendar, '2026-10-26')?.status, 'known');
  assert.equal(day(calendar, '2026-10-24')?.status, 'known');
  const broad = normalize(fact({ unresolved: [{ reason: 'holiday_scope_unresolved' }] }), { record: row });
  assert.equal(day(broad, '2026-10-19')?.status, 'unknown');
});

test('a resolved explicit date override precedes unresolved ordinary exception prose', () => {
  const calendar = normalize(fact({ unresolved: [{ reason: 'holiday_scope_unresolved' }],
    overrides: [{ from: '2026-10-19', through: '2026-10-19', status: 'closed', windows: [] }] }), { record: row });
  assert.equal(day(calendar, '2026-10-19')?.status, 'closed');
});

test('contradictory applicable rules or overrides stay unknown', () => {
  const ordinary = normalize(fact({ rules: [{ week: { Mo: windows } }, { week: { Mo: [] } }] }), { record: row });
  assert.equal(day(ordinary, '2026-10-19')?.status, 'unknown');
  const override = normalize(fact({ overrides: [
    { from: '2026-10-19', through: '2026-10-19', status: 'closed', windows: [] },
    { from: '2026-10-19', through: '2026-10-19', status: 'known', windows },
  ] }), { record: row });
  assert.equal(day(override, '2026-10-19')?.status, 'unknown');
});

test('known windows use the remaining-day window while publication retains full source windows', () => {
  const calendar = normalize(fact(), { record: row });
  const available = day(calendar, '2026-10-19', { availabilityWindow: { weekday: 1, startMinute: 17 * 60, endMinute: 1440 } });
  const unavailable = day(calendar, '2026-10-19', { availabilityWindow: { weekday: 1, startMinute: 18 * 60, endMinute: 1440 } });
  assert.equal(available?.eligible, true);
  assert.equal(available?.status, 'known');
  assert.equal(unavailable?.eligible, false);
  assert.equal(unavailable?.selected_day_hours?.status, 'known');
  assert.deepEqual(unavailable?.selected_day_hours?.windows, windows);
});

test('untrusted date, timezone, function and inconsistent day-window identity stay unknown', () => {
  const calendar = normalize(fact(), { record: row });
  for (const changes of [{ date: '2026-02-30' }, { date: undefined }, { timezone: undefined },
    { timezone: 'Invalid/Zone' }, { visitFunction: 'guided_tour' },
    { availabilityWindow: { weekday: 2, startMinute: 0, endMinute: 1440 } },
    { availabilityWindow: { weekday: 1, startMinute: 100, endMinute: 50 } }]) {
    const result = project(calendar, options('2026-10-19', changes));
    assert.equal(result?.status, 'unknown', JSON.stringify(changes));
    assert.equal(result?.eligible, true);
    assert.equal(result?.selected_day_hours, undefined);
  }
});

test('identity keys survive label normalization and safe canonical URL aliases but not another place', () => {
  const labelRow = { ...row, name: undefined, label: 'Juniper Café', website: 'https://owner.example/cafe' };
  assert.ok(key(row));
  assert.equal(key(row), key(labelRow));
  for (const change of [{ id: 'another' }, { name: 'Juniper Café Annex' }, { type: 'museum' },
    { lat: 59.9 }, { lng: 17.7 }, { website: 'https://owner.example/annex' }]) {
    assert.notEqual(key(row), key({ ...row, ...change }));
    assert.equal(normalize(fact(), { record: { ...row, ...change } }), null);
  }
});

test('source relations bind an exact entry or its validated descendant rather than any shared host', () => {
  const linked = fact({ source_url: 'https://owner.example/cafe/visit/hours', source_relation: 'direct_hours_link' });
  assert.ok(normalize(linked, { record: row }));
  for (const changes of [{ source_relation: 'entry' }, { source_url: 'https://owner.example/annex/hours' },
    { source_url: 'https://foreign.example/cafe/hours' }, { entry_url: 'https://owner.example/annex' },
    { source_url: 'https://owner.example/cafe/hours?identity=other' }, { source_url: 'https://owner.example/cafe/hours#section' },
    { source_url: 'https://owner.example:443/cafe/hours' }, { source_url: ' https://owner.example:443/cafe/hours' },
    { source_url: 'https://owner.example/cafe/hours?' }, { source_url: 'https://owner.example/cafe/hours#' },
    { source_url: 'https://user@owner.example/cafe/hours' }]) {
    assert.equal(normalize({ ...linked, ...changes }, { record: row }), null, JSON.stringify(changes));
  }
});

test('observation freshness is checked against original acquisition and never renewed by projection', () => {
  const initial = fact();
  assert.ok(normalize(initial, { record: row, now: Date.parse('2026-10-19T13:59:59Z') }));
  assert.equal(normalize(initial, { record: row, now: Date.parse('2026-10-19T14:00:00Z') }), null);
  assert.equal(normalize(initial, { record: row, now: Date.parse('2026-10-19T07:59:59Z') }), null);
  const structural = normalize(initial, { record: row });
  assert.equal(day(structural, '2027-06-07')?.selected_day_hours?.observed_at, '2026-10-19T08:00:00.000Z');
  assert.equal(initial.observed_at, '2026-10-19T08:00:00.000Z');
});

test('corrupt calendar scope, windows and bounded collections are rejected as whole facts', () => {
  const mutations = [
    { contract: 'old-contract' }, { visit_function: 'guided_tour' }, { observed_at: '2026-02-30T08:00:00Z' },
    { rules: [{ week: { XX: windows } }] }, { rules: [{ week: {} }] },
    { rules: [{ week: { Mo: [{ opens: '18:00', closes: '06:30' }] } }] },
    { rules: [{ week: { Mo: [{ opens: '06:30', closes: '25:00' }] } }] },
    { rules: [{ week: { Mo: [...windows, ...windows] } }] },
    { rules: [{ week: { Mo: windows }, validity: { kind: 'absolute', from: '2026-10-25', through: '2026-10-19' } }] },
    { rules: [{ week: { Mo: windows }, validity: { kind: 'annual', from: '02-30', through: '03-01' } }] },
    { overrides: [{ from: '2026-02-30', through: '2026-03-01', status: 'closed', windows: [] }] },
    { overrides: [{ from: '2026-10-19', through: '2026-10-19', status: 'closed', windows }] },
    { overrides: [{ from: '2026-10-19', through: '2026-10-19', status: 'known', windows: [] }] },
    { unresolved: [{ reason: 'unsupported', weekdays: [7] }] },
    { unresolved: [{ reason: 'unsupported', from: '2026-10-25', through: '2026-10-19' }] },
    { unresolved: Array.from({ length: 25 }, () => ({ reason: 'unsupported' })) },
    { rules: Array.from({ length: 13 }, () => ({ week: { Mo: windows } })) },
    { arbitrary: 'ignored scope must not disappear' },
  ];
  for (const mutation of mutations) assert.equal(normalize(fact(mutation), { record: row }), null, JSON.stringify(mutation));
});

test('the candidate wrapper distinguishes absent from corrupt calendar without falling back to weekly open', () => {
  assert.equal(resolve(row, options('2026-10-19')), null);
  const invalid = resolve({ ...row, opening_hours: '24/7', selected_hours_calendar: fact({ identity_key: 'corrupt' }) }, options('2026-10-19'));
  assert.equal(invalid?.status, 'unknown');
  assert.equal(invalid?.eligible, true);
  assert.equal(invalid?.selected_day_hours, undefined);
});

test('unresolved holiday conditions retain ordinary source windows separately from availability', () => {
  const calendar = normalize(fact({ unresolved: [{ reason: 'holiday_condition' }] }), { record: row });
  const result = day(calendar, '2026-10-19');
  assert.equal(result?.status, 'unknown');
  assert.equal(result?.eligible, true);
  assert.equal(result?.selected_day_hours, undefined);
  assert.deepEqual(result?.ordinary_day_hours, {
    status: 'known', all_day: false, windows, date: '2026-10-19', timezone: 'Europe/Stockholm',
    source_url: 'https://owner.example/cafe', observed_at: '2026-10-19T08:00:00.000Z',
  });
  assert.equal(result?.reason, 'holiday_condition');
});

test('unresolved winter late hours cannot suppress a different summer Tuesday season', () => {
  const calendar = normalize(fact({ rules: [
    { week: { Tu: windows }, validity: { kind: 'annual', from: '09-01', through: '05-31' } },
    { week: { Tu: [{ opens: '10:00', closes: '17:00' }] }, validity: { kind: 'annual', from: '06-01', through: '08-31' } },
  ], unresolved: [{ reason: 'late_hours_unresolved', weekdays: [2],
    validity: { kind: 'annual', from: '09-01', through: '05-31' } }] }), { record: row });
  assert.ok(calendar, 'a parsed unresolved rule retains its source season');
  assert.equal(day(calendar, '2026-10-20')?.status, 'unknown');
  assert.deepEqual(day(calendar, '2026-10-20')?.ordinary_day_hours?.windows, windows);
  assert.equal(day(calendar, '2027-01-05')?.status, 'unknown');
  assert.equal(day(calendar, '2027-06-08')?.status, 'known');
  assert.deepEqual(day(calendar, '2027-06-08')?.selected_day_hours?.windows, [{ opens: '10:00', closes: '17:00' }]);
  assert.equal(normalize(fact({ unresolved: [{ reason: 'late_hours_unresolved',
    validity: { kind: 'annual', from: '02-30', through: '03-01' } }] }), { record: row }), null);
});

test('unresolved absolute validity bounds its effect without borrowing the observation year', () => {
  const calendar = normalize(fact({ unresolved: [{ reason: 'special_hours',
    validity: { kind: 'absolute', from: '2026-10-19', through: '2026-10-19' } }] }), { record: row });
  assert.equal(day(calendar, '2026-10-19')?.status, 'unknown');
  assert.equal(day(calendar, '2026-10-26')?.status, 'known');
});

test('a conflicting unresolved exception for the same date cannot be hidden by an override', () => {
 for(const unresolved of [[{reason:'unresolved_date_exception',from:'2026-10-19',through:'2026-10-19'}], [{reason:'unsupported_schedule_condition'}]]) {
  const calendar=normalize(fact({overrides:[{from:'2026-10-19',through:'2026-10-19',status:'known',windows}],unresolved}),{record:row});
  assert.equal(day(calendar,'2026-10-19').status,'unknown');
 }
});
