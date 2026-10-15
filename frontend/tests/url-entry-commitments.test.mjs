import test from 'node:test';
import assert from 'node:assert/strict';
import { urlEntryCommitments } from '../src/lib/url-entry-commitments.mjs';

const id = 'Qualified Testville::2026-10-14::culture,food,views::rhythm=balanced';
const makeEntry = () => ({
  id, dateIso: '2026-10-14', classification: { status: 'composed_limited' },
  safeResponse: { days: [{ date: '2026-10-14' }] },
  inputs: { mode: 'typed', city: null, place: 'Testville', placeLabel: 'Qualified Testville',
    placeRef: 'r1234', walkKey: 'balanced', selected: ['food', 'culture', 'views'] },
  commitments: { version: 3, anchorKey: 'place:qualified testville', dayKey: id,
    entries: { cafe: { kind: 'pin', label: 'Cafe' } }, appliedPins: [], refusals: [] },
});
const context = { navigationType: 'reload', anchor: { place: 'Testville', placeRef: 'r1234' },
  dateIso: '2026-10-14', selected: ['views', 'food', 'culture'], walkKey: 'balanced' };

test('a matching durable place identity recovers bounded choices without importing the old qualifier or response', () => {
  const entry = makeEntry();
  const result = urlEntryCommitments(entry, context);
  assert.deepEqual(result, { applies: true, entries: { cafe: { kind: 'pin', label: 'Cafe' } } });
  assert.notEqual(result.entries, entry.commitments.entries);
  assert.equal(Object.hasOwn(result, 'safeResponse'), false);
});
for (const [name, override] of [
  ['different durable identity', { anchor: { place: 'Testville', placeRef: 'r5678' } }],
  ['invalid durable identity', { anchor: { place: 'Testville', placeRef: 'not-a-ref' } }],
  ['missing durable identity even with identical text', { anchor: { place: 'Testville' } }],
  ['unattested coordinates', { anchor: { coords: { lat: 60.17, lng: 24.94 } } }],
  ['missing navigation timing', { navigationType: undefined }],
]) test(`${name} never reuses the stored choices`, () => {
  assert.deepEqual(urlEntryCommitments(makeEntry(), { ...context, ...override }), { applies: false, entries: {} });
});

test('v2 place commitments remain compatible through matching URL reload', () => {
  const entry = makeEntry(); entry.commitments.version = 2;
  assert.deepEqual(urlEntryCommitments(entry, context).entries, { cafe: { kind: 'pin', label: 'Cafe' } });
});
