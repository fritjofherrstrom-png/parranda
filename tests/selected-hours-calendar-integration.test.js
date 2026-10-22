'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createSourceCache } = require('../server/place-candidates/source-cache');
const { createOperatorVisitEnricher } = require('../server/place-candidates/operator-visit-evidence');
const { mapRecordToCandidate } = require('../server/place-candidates/external-open-provider');
const { CALENDAR_CONTRACT, selectedHoursCalendarKey, projectSelectedHoursCalendar, resolveCandidateDayHours } = require('../server/place-candidates/opening-hours-calendar');
const { composeAgnosticRouteOutput } = require('../server/planner/agnostic-route-output');
const { externalRecord } = require('./helpers/planner-reservoir-compare');
const fixture = name => fs.readFileSync(path.join(__dirname, 'fixtures/selected-place-visit-hours', name), 'utf8');
const entry = fixture('gustavianum-entry.html'), detail = fixture('gustavianum-hours.html');
const museum = { ...externalRecord('calendar-museum', 'Gustavianum', 'museum', 59.857944, 17.631795, ['museum']),
  website: 'https://www.uu.se/gustavianum' };
const sourceOptions = extra => ({ cache: createSourceCache(), hoursCache: createSourceCache(),
  resolveHost: async () => [{ address: '93.184.216.34', family: 4 }], ...extra });
const response = body => new Response(body, { headers: { 'Content-Type': 'text/html' } });
const selected = date => ({ selectedIds: [museum.id], date });
function calendar(record, changes = {}) {
  return { contract: CALENDAR_CONTRACT, identity_key: selectedHoursCalendarKey(record), visit_function: 'general_visit',
    entry_url: record.website, source_url: record.website, source_relation: 'entry', observed_at: '2026-10-18T08:00:00.000Z',
    rules: [{ week: { Mo: [{ opens: '10:00', closes: '17:00' }] } }], overrides: [], unresolved: [], ...changes };
}
const day = (value, date) => projectSelectedHoursCalendar(value, { date, timezone: 'Europe/Stockholm' });

// Fails if enrichment still flattens seasonal facts into a day-keyed weekly string.
test('the real selected HTML path caches source calendar once and projects other dates without renewal', async () => {
  const calls = [];
  let now = Date.parse('2026-10-18T08:00:00Z');
  const enricher = createOperatorVisitEnricher(sourceOptions({ now: () => now,
    hoursCache: createSourceCache({ now: () => now }), fetcher: async url => { calls.push(url); return response(url === museum.website ? entry : detail); } }));
  const first = (await enricher.forRequest().enrichSelected([museum], selected('2026-10-19')))[0];
  assert.ok(first.selected_hours_calendar, 'real HTML must reach the calendar enrichment contract');
  assert.equal(first.opening_hours, undefined, 'a temporal week cannot become an undated candidate schedule');
  assert.equal(day(first.selected_hours_calendar, '2026-10-19').status, 'closed');
  now += 60_000;
  const summer = (await enricher.forRequest().enrichSelected([museum], selected('2027-06-07')))[0];
  assert.equal(day(summer.selected_hours_calendar, '2027-06-07').status, 'known');
  assert.equal(summer.selected_hours_calendar.observed_at, first.selected_hours_calendar.observed_at);
  assert.equal(calls.length, 2);
  assert.equal(day(summer.selected_hours_calendar, '2026-12-25').status, 'closed', 'explicit dated exception survives caching');
});

test('expired HTML source calendar cannot gain a renewed observation from failed refresh', async () => {
  let now = Date.parse('2026-10-18T08:00:00Z'), failed = false;
  const cache = createSourceCache({ now: () => now });
  const writes = [], set = cache.set.bind(cache);
  cache.set = (key, value) => { writes.push(value); set(key, value); };
  const enricher = createOperatorVisitEnricher(sourceOptions({ hoursCache: cache, now: () => now,
    fetcher: async url => response(failed ? 'Unavailable schedule' : url === museum.website ? entry : detail) }));
  assert.ok((await enricher.forRequest().enrichSelected([museum], selected('2026-10-19')))[0].selected_hours_calendar);
  now += 6 * 60 * 60 * 1000; failed = true;
  assert.equal((await enricher.forRequest().enrichSelected([museum], selected('2026-10-26')))[0].selected_hours_calendar, undefined);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].observed_at, '2026-10-18T08:00:00.000Z');
});

test('provider normalization preserves bound calendar provenance and blocks a corrupt calendar fallback', () => {
  const fact = calendar(museum, { source_relation: 'direct_hours_link', source_url: museum.website + '/visit/hours' });
  const candidate = mapRecordToCandidate({ key: 'calendar-place' }, { ...museum, selected_hours_calendar: fact }, null, 0);
  assert.deepEqual(candidate.selected_hours_calendar, fact);
  assert.equal(resolveCandidateDayHours(candidate, { date: '2026-10-19', timezone: 'Europe/Stockholm' }).status, 'known');
  const corrupt = mapRecordToCandidate({ key: 'calendar-place' }, { ...museum, opening_hours: '24/7',
    selected_hours_calendar: { ...fact, identity_key: '0'.repeat(64) } }, null, 0);
  assert.equal(resolveCandidateDayHours(corrupt, { date: '2026-10-19', timezone: 'Europe/Stockholm' })?.status, 'unknown');
});

const records = () => Array.from({ length: 3 }, (_, i) => ({
  ...externalRecord(`calendar-replay-${i}`, `Calendar museum ${i}`, 'museum', 55.6 + i * .001, 13, ['museum']),
  website: `https://calendar-replay-${i}.example/`, opening_hours: '24/7',
}));
const composeOptions = loader => ({ coords: { lat: 55.6, lng: 13 }, baselineResult: { days: [] }, date: '2026-10-19',
  externalRequested: true, openDataLoader: loader, preferences: ['culture'], dayRhythm: 'full', distanceMode: 'no_limit',
  synthesizeVia: 'engine', anchorMode: 'coordinates', trustedTimezone: 'Europe/Stockholm',
  clock: () => new Date('2026-10-18T08:00:00Z'), weatherProvider: async () => null });
const stops = output => output.result.days[0]?.primary_route?.main_stops || [];

test('calendar-only closure replays the frozen supply even when its weekly string is unchanged', async () => {
  const rows = records();
  let loads = 0, checks = 0, weather = 0;
  const loader = async () => { loads++; return rows; };
  loader.enrichSelected = async snapshot => {
    checks++;
    return snapshot.map((row, index) => index ? row : { ...row, selected_hours_calendar: calendar(row, {
      overrides: [{ from: '2026-10-19', through: '2026-10-19', status: 'closed', windows: [] }],
    }) });
  };
  const result = await composeAgnosticRouteOutput({ ...composeOptions(loader), weatherProvider: async () => { weather++; return null; } });
  assert.equal(loads, 1); assert.equal(checks, 1); assert.equal(weather, 1);
  assert.ok(stops(result).every(stop => stop.id !== rows[0].id));
  assert.equal(result.candidateHours.get(rows[0].id)?.status, 'closed', 'negative evidence remains available for downstream views');
  assert.equal(rows[0].opening_hours, '24/7', 'original weekly/lifecycle evidence is untouched');
});

test('conditional calendar hours remain route-allowed without borrowing an existing weekly open claim', async () => {
  const rows = records().map(row => ({ ...row, selected_hours_calendar: calendar(row, { unresolved: [{ reason: 'holiday_condition' }] }) }));
  const result = await composeAgnosticRouteOutput(composeOptions(async () => rows));
  assert.equal(stops(result).length, 3);
  assert.ok(stops(result).every(stop => stop.selected_day_hours?.status === 'unknown'), 'qualified unknown facts must reach the actual published route');
  for (const row of rows) {
    const fact = result.candidateHours.get(row.id);
    assert.equal(fact?.status, 'unknown');
    assert.equal(fact?.ordinary_status, 'known');
    assert.deepEqual(fact?.ordinary_windows, [{ opens: '10:00', closes: '17:00' }]);
    assert.equal(fact?.uncertainty, 'holiday_exceptions');
  }
});

test('calendar updates cannot lend a changed identity, type, coordinate or trust upgrade to replay', async () => {
  const rows = records();
  const loader = async () => rows;
  loader.enrichSelected = async snapshot => snapshot.map(row => ({ ...row, name: 'Foreign annex', type: 'cafe',
    trust: { human_verified: true }, selected_hours_calendar: calendar({ ...row, name: 'Foreign annex', type: 'cafe' }, {
      overrides: [{ from: '2026-10-19', through: '2026-10-19', status: 'closed', windows: [] }],
    }) }));
  const result = await composeAgnosticRouteOutput(composeOptions(loader));
  assert.equal(stops(result).length, 3);
  assert.ok(stops(result).every(stop => stop.label.startsWith('Calendar museum')));
  assert.ok([...result.candidateHours.values()].every(fact => fact.status === 'known'));
});

test('expired supplied calendar cannot exclude a route or survive a failed refresh',async()=>{
 const rows=records().map(row=>({...row,selected_hours_calendar:calendar(row,{observed_at:'2026-10-17T08:00:00.000Z',overrides:[{from:'2026-10-19',through:'2026-10-19',status:'closed',windows:[]}]})}));
 const result=await composeAgnosticRouteOutput(composeOptions(async()=>rows));
 assert.equal(stops(result).length,3,'stale closure cannot exclude selected supply');
 assert.ok(stops(result).every(stop=>!stop.selected_day_hours));
 const stale={...museum,selected_hours_calendar:calendar(museum,{observed_at:'2026-10-17T08:00:00.000Z'})};
 const enricher=createOperatorVisitEnricher(sourceOptions({now:()=>Date.parse('2026-10-18T08:00:00Z'),fetcher:async()=>response('Unavailable')}));
 const output=await enricher.enrichSelected([stale],selected('2026-10-19'));
 assert.equal(output[0].selected_hours_calendar,null,'failed refresh cannot leave expired supplied metadata authoritative');
});
