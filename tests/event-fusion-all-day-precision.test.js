'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeTimeSensitiveSourceEvent, fuseTimeSensitiveEvents } = require('../server/pulse-sources');
const { toEventView } = require('../server/place-candidates/agnostic-event-supply');

const options = { timezone: 'Europe/Stockholm', now: '2026-10-15T12:00:00Z' };
function row(overrides = {}) {
  return normalizeTimeSensitiveSourceEvent({
    id: 'same-event', title: 'Source whole day', starts_on: '2026-10-22',
    source_url: 'https://calendar.example/dated', source_tier: 'official', confidence: 'strong',
    route_eligible: false, source_scope_verified: false, ...overrides,
  }, { ...options, timezone: overrides.timezone || options.timezone });
}
function explicit(overrides = {}) {
  return row({ time_window: { kind: 'all_day', starts_on: '2026-10-22', all_day_explicit: true }, ...overrides });
}

for (const reversed of [false, true]) test(`same-publisher equally trusted duplicate preserves explicit whole-day precision, reversed=${reversed}`, async () => {
  const inputs = [row(), explicit()];
  if (reversed) inputs.reverse();
  const fused = fuseTimeSensitiveEvents(inputs);
  assert.equal(fused.length, 1);
  assert.equal(fused[0].time_window.all_day_explicit, true);
  assert.equal(fused[0].confidence, 'strong');
  assert.equal(fused[0].route_eligible, inputs[0].route_eligible, 'fusion does not create eligibility');
  const { eventTiming } = await import('../frontend/src/lib/pulse-view.mjs');
  assert.match(eventTiming(toEventView(fused[0], { id: 'calendar', label: 'Source' }), 'en'), /All day/);
});

for (const ids of [['a-date', 'z-explicit'], ['z-date', 'a-explicit']]) test(`provider aliases do not decide timing precision: ${ids.join('/')}`, () => {
  const [fused] = fuseTimeSensitiveEvents([row({ source_provider_id: ids[0] }), explicit({ source_provider_id: ids[1] })]);
  assert.equal(fused.time_window.all_day_explicit, true);
  assert.equal(fused.independent_source_count, 1, 'same publisher does not gain independent corroboration');
});

for (const [reason, overrides] of [
  ['lower confidence', { confidence: 'low' }],
  ['lower source tier', { source_tier: 'fallback' }],
  ['different publisher', { source_identity: 'z-other-publisher' }],
  ['different source page', { source_url: 'https://calendar.example/another-event' }],
  ['different timezone', { timezone: 'Europe/London' }],
  ['stale evidence', { freshness: 'stale' }],
]) test(`${reason} cannot upgrade the primary date-only evidence to whole-day precision`, () => {
  const primary = row(), donor = explicit(overrides);
  if (reason === 'different timezone') assert.notEqual(primary.timezone, donor.timezone, 'the negative control actually has different source timezones');
  const [fused] = fuseTimeSensitiveEvents([primary, donor]);
  assert.notEqual(fused.time_window.all_day_explicit, true);
});

test('date-only duplicates and a string marker remain date-only', () => {
  const [fused] = fuseTimeSensitiveEvents([row(), explicit({ time_window: { kind: 'all_day', starts_on: '2026-10-22', all_day_explicit: 'true' } })]);
  assert.notEqual(fused.time_window.all_day_explicit, true);
});

test('different date intervals retain separate occurrences instead of copying precision', () => {
  const events = fuseTimeSensitiveEvents([row(), explicit({ starts_on: '2026-10-23', time_window: { kind: 'all_day', starts_on: '2026-10-23', all_day_explicit: true } })]);
  assert.equal(events.length, 2);
  assert.notEqual(events.find(x => x.starts_on === '2026-10-22').time_window.all_day_explicit, true);
});
