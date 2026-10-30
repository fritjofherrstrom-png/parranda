import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { eventTiming, liveTimeGroups, liveTimeRepresentative } from '../src/lib/pulse-view.mjs';

// A display programme from the real server builder, read at fixed instants:
// pure fixture evidence (review of #643, F1: with its second slot on now, a
// programme sat under "Earlier today" with its first slot's ended time).
const require = createRequire(import.meta.url);
const { groupLiveProgramViews } = require('../../server/place-candidates/live-program-presentation.js');

const DAY = '2026-10-24';
const slot = (id, starts_at, ends_at) => ({ id, title: 'Source programme', place: 'Source venue', lat: 59.33, lng: 18.06,
  timezone: 'Europe/Stockholm', starts_at, ...(ends_at ? { ends_at } : {}), source_provider_id: 'source-calendar',
  source_label: 'Source calendar', source_url: 'https://calendar.example/programme', source_link_kind: 'page',
  source_link_host: 'calendar.example' });
function programme(...slots) {
  const [row] = groupLiveProgramViews(slots);
  assert.equal(row.display_group_kind, 'source_program');
  return row;
}
// What the card shows for the row at `iso`: its time group, the slot its time
// is read from, and its time line under that group.
function read(row, iso, lang = 'en') {
  const now = new Date(iso);
  const [group] = liveTimeGroups([row], { now, selectedDate: DAY });
  const shown = liveTimeRepresentative(row, now, DAY);
  return [group.state, shown.id, eventTiming(shown, lang, now, DAY, { omitDate: DAY, underOnNow: group.state === 'now' })];
}

test('a programme row is read by the slot that stands where it is in the day', () => {
  const row = programme(slot('slot-early', '2026-10-24T08:00:00Z', '2026-10-24T09:00:00Z'),
    slot('slot-active', '2026-10-24T09:30:00Z', '2026-10-24T10:30:00Z'));
  assert.deepEqual(read(row, '2026-10-24T07:59:00Z'), ['later', 'slot-early', '10:00–11:00']);
  assert.deepEqual(read(row, '2026-10-24T08:30:00Z'), ['now', 'slot-early', 'until 11:00']);
  assert.deepEqual(read(row, '2026-10-24T09:10:00Z'), ['later', 'slot-active', '11:30–12:30'], 'after the first slot ends, the next one leads');
  assert.deepEqual(read(row, '2026-10-24T09:45:00Z'), ['now', 'slot-active', 'until 12:30']);
  assert.deepEqual(read(row, '2026-10-24T09:45:00Z', 'sv'), ['now', 'slot-active', 'till 12:30']);
  assert.deepEqual(read(row, '2026-10-24T10:31:00Z'), ['ended', 'slot-active', '11:30–12:30'], 'when all are over, the latest is shown');
  // The row itself is not rewritten: same id, representative fields and slots.
  assert.equal(row.id, 'slot-early');
  assert.equal(row.starts_at, '2026-10-24T08:00:00Z');
  assert.deepEqual(row.occurrences.map((s) => s.id), ['slot-early', 'slot-active']);
});

test('a slot still to come leads before one only known to have started', () => {
  const row = programme(slot('start-early', '2026-10-24T08:00:00Z'), slot('start-later', '2026-10-24T11:00:00Z'));
  assert.deepEqual(read(row, '2026-10-24T09:45:00Z'), ['later', 'start-later', '13:00']);
  assert.deepEqual(read(row, '2026-10-24T11:30:00Z'), ['started', 'start-later', 'started 13:00 · end time unknown']);
});

test("another day's slot does not lead the day's programme row; other rows pass through", () => {
  const row = programme(slot('today', '2026-10-24T08:00:00Z', '2026-10-24T09:00:00Z'),
    slot('tomorrow', '2026-10-25T08:00:00Z', '2026-10-25T09:00:00Z'));
  assert.deepEqual(read(row, '2026-10-24T10:00:00Z'), ['ended', 'today', '10:00–11:00']);
  const single = slot('single', '2026-10-24T08:00:00Z', '2026-10-24T09:00:00Z');
  assert.equal(liveTimeRepresentative(single, new Date('2026-10-24T10:00:00Z'), DAY), single);
});
