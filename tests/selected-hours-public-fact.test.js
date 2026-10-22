const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeSelectedDayHoursFact } = require('../server/place-candidates/opening-hours');

const conditional = {
  status: 'unknown', all_day: false, windows: [], ordinary_status: 'known',
  ordinary_windows: [{ opens: '06:30', closes: '18:00' }], uncertainty: 'holiday_exceptions',
  date: '2026-10-20', timezone: 'Europe/Stockholm', source_url: 'https://cafe.example/visit',
  observed_at: '2026-10-19T10:00:00.000Z',
};

test('a bounded conditional public fact retains regular hours without promoting its unknown selected day', () => {
  const result = normalizeSelectedDayHoursFact({ ...conditional, raw_schedule: 'must not survive',
    raw_html: '<p>payload</p>', open_now: true, arbitrary: 'payload' });
  assert.deepEqual(result, conditional);
  assert.equal(result.status, 'unknown');
  assert.deepEqual(result.windows, []);
});

test('regular closure and unresolved conditions remain distinct from selected-day closure', () => {
  assert.deepEqual(normalizeSelectedDayHoursFact({ ...conditional, ordinary_status: 'closed',
    ordinary_windows: [], uncertainty: 'unresolved_conditions' }), {
    status: 'unknown', all_day: false, windows: [], ordinary_status: 'closed', ordinary_windows: [],
    uncertainty: 'unresolved_conditions', date: '2026-10-20', timezone: 'Europe/Stockholm',
    source_url: 'https://cafe.example/visit', observed_at: '2026-10-19T10:00:00.000Z',
  });
});

test('conditional facts require every source and ordinary-hours field', () => {
  for (const key of Object.keys(conditional)) {
    const value = { ...conditional };
    delete value[key];
    assert.equal(normalizeSelectedDayHoursFact(value), null, key);
  }
});

test('malformed and unsafe conditional facts fail closed rather than publishing a partial schedule', () => {
  for (const extra of [
    { status: 'payload' }, { all_day: true }, { all_day: 0 }, { windows: null },
    { windows: [{ opens: '06:30', closes: '18:00' }] },
    { ordinary_status: 'payload' }, { ordinary_status: 'closed' }, { ordinary_windows: [] },
    { ordinary_windows: null }, { ordinary_windows: [{ opens: '6:30', closes: '18:00' }] },
    { ordinary_windows: [{ opens: '06:30', closes: '24:30' }] },
    { ordinary_windows: [{ opens: '06:30', closes: '06:30' }] },
    { ordinary_windows: [{ opens: '18:00', closes: '06:30' }] },
    { ordinary_windows: [{ opens: '06:30', closes: '18:00' }, { opens: 'payload', closes: '18:00' }] },
    { ordinary_windows: Array.from({ length: 5 }, () => ({ opens: '06:30', closes: '18:00' })) },
    { uncertainty: 'payload' }, { date: '2026-02-30' }, { date: 'tomorrow' },
    { timezone: 'Bogus/Zone' }, { timezone: '' },
    { source_url: 'javascript:alert(1)' }, { source_url: 'https://user:secret@cafe.example/' },
    { source_url: 'https://cafe.example/\nhours' }, { source_url: 'https://cafe.example\\@other.example/' },
    { observed_at: 'yesterday' }, { observed_at: '2026-10-19T10:00:00' },
    { observed_at: '2026-02-30T10:00:00.000Z' },
  ]) assert.equal(normalizeSelectedDayHoursFact({ ...conditional, ...extra }), null, JSON.stringify(extra));
});

test('the established known and closed normalization contracts remain intact', () => {
  assert.deepEqual(normalizeSelectedDayHoursFact({ status: 'known', windows: [
    { opens: '9:00', closes: '17:00' }, { opens: 'payload', closes: '19:00' },
  ] }), { status: 'known', all_day: false, windows: [{ opens: '09:00', closes: '17:00' }] });
  assert.deepEqual(normalizeSelectedDayHoursFact({ status: 'closed', all_day: true }),
    { status: 'closed', all_day: false, windows: [] });
  assert.deepEqual(normalizeSelectedDayHoursFact({ status: 'known', all_day: true }),
    { status: 'known', all_day: true, windows: [] });
});
