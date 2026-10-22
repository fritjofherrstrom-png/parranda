"use strict";

const test = require('node:test');
const assert = require('node:assert/strict');
const { composeAgnosticRouteOutput } = require('../server/planner/agnostic-route-output');
const { externalRecord } = require('./helpers/planner-reservoir-compare');

test('selected-hours replay keeps the originally resolved omitted date when the local day changes during the check', async () => {
  // Sunday is open; Monday is explicitly closed. Resolving the omitted date
  // again during replay would both move the day and discard the selected visits.
  let today = '2026-10-18';
  let collections = 0, checks = 0, weatherReads = 0;
  const retained = [];
  const records = Array.from({ length: 3 }, (_, i) => ({
    ...externalRecord(`midnight-museum-${i}`, `Midnight museum ${i}`, 'museum', 55.6 + i * .001, 13, ['museum']),
    website: `https://midnight-museum-${i}.example/`,
  }));
  const loader = async () => { collections++; return records; };
  loader.enrichSelected = async (snapshot, options) => {
    checks++;
    assert.deepEqual([...options.selectedIds].sort(), ['midnight-museum-0', 'midnight-museum-1', 'midnight-museum-2']);
    assert.equal(options.date, '2026-10-18', 'selected evidence must use the already frozen day');
    today = '2026-10-19'; // The selected website check crosses local midnight.
    return snapshot.map(record => ({
      ...record, opening_hours: 'Su 10:00-17:00; Mo off; Tu-Sa 10:00-17:00',
      opening_hours_source: { url: record.website, observed_at: '2026-10-17T10:00:00.000Z' },
    }));
  };

  const output = await composeAgnosticRouteOutput({
    coords: { lat: 55.6, lng: 13 }, baselineResult: { days: [] },
    externalRequested: true, openDataLoader: loader,
    preferences: ['culture'], dayRhythm: 'full', distanceMode: 'no_limit',
    synthesizeVia: 'engine', anchorMode: 'coordinates',
    // Deliberately omit date: the first composition owns its resolved value.
    todayIsoDate: () => today,
    trustedTimezone: 'Europe/Stockholm',
    clock: () => new Date('2026-10-18T08:00:00Z'),
    weatherProvider: async () => { weatherReads++; return null; },
    onRetainComposition: snapshot => retained.push(snapshot),
  });

  assert.equal(checks, 1, 'one bounded selected check must actually trigger the replay');
  assert.equal(collections, 1, 'replay consumes the same frozen source snapshot');
  assert.equal(weatherReads, 1, 'replay consumes the original trusted time context');
  assert.equal(today, '2026-10-19', 'the clock transition really happened during enrichment');
  assert.deepEqual(retained.map(snapshot => snapshot.date), ['2026-10-18'], 'retained replay must keep the original resolved date');
  assert.equal(output.result.days[0]?.date, '2026-10-18', 'replay must keep the day the user originally requested');
  const stops = output.result.days[0].primary_route.main_stops;
  assert.deepEqual(stops.map(stop => stop.id).sort(), ['midnight-museum-0', 'midnight-museum-1', 'midnight-museum-2']);
  for (const stop of stops) {
    assert.equal(stop.selected_day_hours.date, '2026-10-18');
    assert.deepEqual(stop.selected_day_hours.windows, [{ opens: '10:00', closes: '17:00' }]);
    assert.equal(output.candidateHours.get(stop.id).date, '2026-10-18');
  }
});

test('a selected-date fact for another day cannot mutate the retained composition', async () => {
  const records = Array.from({ length: 3 }, (_, i) => ({
    ...externalRecord(`wrong-date-museum-${i}`, `Wrong date museum ${i}`, 'museum', 55.6 + i * .001, 13, ['museum']),
    website: `https://wrong-date-museum-${i}.example/`,
  }));
  const loader = async () => records;
  loader.enrichSelected = async snapshot => snapshot.map(record => ({ ...record,
    opening_hours: 'Su 10:00-17:00; Mo off; Tu-Sa 10:00-17:00',
    opening_hours_source: { url: record.website, observed_at: '2026-10-18T08:00:00Z', valid_for_date: '2026-10-20' },
  }));
  const output = await composeAgnosticRouteOutput({
    coords: { lat: 55.6, lng: 13 }, baselineResult: { days: [] }, date: '2026-10-19',
    externalRequested: true, openDataLoader: loader, preferences: ['culture'], dayRhythm: 'full',
    distanceMode: 'no_limit', synthesizeVia: 'engine', anchorMode: 'coordinates',
    trustedTimezone: 'Europe/Stockholm', clock: () => new Date('2026-10-18T08:00:00Z'), weatherProvider: async () => null,
  });
  const stops = output.result.days[0]?.primary_route?.main_stops || [];
  assert.equal(stops.length, 3, 'a stale date-specific negative cannot remove the requested day’s visits');
  assert.ok(stops.every(stop => stop.selected_day_hours === undefined));
});
