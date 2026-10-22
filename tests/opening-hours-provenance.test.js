const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeSelectedDayHoursFact } = require('../server/place-candidates/opening-hours');
const fact = { status: 'known', all_day: false, windows: [{ opens: '10:00', closes: '17:00' }],
  date: '2026-10-18', timezone: 'Europe/Stockholm', source_url: 'https://museum.example/',
  observed_at: '2026-10-17T10:00:00.000Z' };
test('selected-day fact retains its bounded source identity, observation and local date through publication normalization', () => {
  assert.deepEqual(normalizeSelectedDayHoursFact({ ...fact, raw_html: 'must not be published' }), fact);
});
test('invalid source/date metadata cannot accompany a normalized hours fact', () => {
  for (const extra of [{ date: '2026-02-30' }, { timezone: 'Bogus/Zone' },
    { source_url: 'javascript:alert(1)' }, { source_url: 'https://secret@museum.example/' }, { observed_at: 'yesterday' }]) {
    const normalized = normalizeSelectedDayHoursFact({ ...fact, ...extra });
    assert.deepEqual(normalized, { status: 'known', all_day: false, windows: [{ opens: '10:00', closes: '17:00' }] });
  }
});
