'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { withLiveDiscoveryChoices } = require('../server/planner/live-discovery-choices');
const { liveOccurrenceId } = require('../server/planner/live-occurrence-choice');
const DATE = '2026-10-17';
const event = extra => ({ id: 'source-event', title: 'Source concert', source_provider_id: 'controlled-calendar',
  source_url: 'https://example.org/event', timezone: 'Europe/Stockholm', lat: 55.6, lng: 13,
  starts_at: DATE + 'T18:00:00+02:00', ends_at: DATE + 'T20:00:00+02:00',
  cultural_tier: 'cultural', route_eligible: true, timing_relevance: 'today', ...extra });
const shape = row => withLiveDiscoveryChoices({ selected_date: DATE, tonight: [row], this_week: [], browse: {
  tonight: { more: [row] }, this_week: { more: [] },
} });

for (const [name, extra] of [
  ['Pulse-only event', { route_eligible: false }],
  ['missing source eligibility', { route_eligible: undefined }],
  ['missing timezone', { timezone: undefined }],
  ['ambiguous source clock', { starts_at: DATE + 'T18:00:00' }],
  ['another date', { starts_at: '2026-10-18T18:00:00+02:00', ends_at: '2026-10-18T20:00:00+02:00' }],
  ['daytime event', { starts_at: DATE + 'T09:00:00+02:00', ends_at: DATE + 'T11:00:00+02:00' }],
  ['missing venue point', { lat: undefined }],
]) test(`${name} cannot inherit selectable metadata`, () => {
  const input = event({ live_occurrence_id: `live:${DATE}:${'a'.repeat(32)}`, live_choice_eligible: true, ...extra });
  const result = shape(input);
  for (const row of [result.tonight[0], result.browse.tonight.more[0]]) {
    assert.equal(row.live_choice_eligible, undefined);
    assert.equal(row.live_occurrence_id, undefined);
  }
  assert.equal(input.live_choice_eligible, true, 'source inputs are not mutated');
});

test('a source series offers each actual selected-day slot by its own identity', () => {
  const first = event(), second = event({ starts_at: DATE + 'T21:00:00+02:00', ends_at: DATE + 'T23:00:00+02:00' });
  const result = shape({ ...first, occurrences: [first, second] }).tonight[0];
  assert.equal(result.live_occurrence_id, undefined, 'a series wrapper is not a chosen occurrence');
  assert.deepEqual(result.occurrences.map(row => row.live_occurrence_id), [liveOccurrenceId(first), liveOccurrenceId(second)]);
  assert.notEqual(result.occurrences[0].live_occurrence_id, result.occurrences[1].live_occurrence_id);
});
