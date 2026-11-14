import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSavedEntry, savedEntryId, upsertSaved } from '../src/lib/anywhere-storage.mjs';
import { buildCommitmentSnapshot, readCommitmentSnapshot } from '../src/lib/commitment-snapshot.mjs';
import { anchorKey } from '../src/lib/recompose-retention.mjs';
import { urlEntryCommitments } from '../src/lib/url-entry-commitments.mjs';

// HOLD review on #610, 13 Nov 2026: an ordinary free day and "Let Parranda
// choose" for the same place, date and empty picks are different questions
// with different stops, but they shared one saved ID, so saving one replaced
// the other and their commitment ledgers could answer for each other. A
// non-neutral intent mode is part of the day's identity; a neutral one leaves
// every existing ID byte-identical.
const DATE = '2026-10-01';
const PLACE = { place: 'Roma', placeLabel: 'Roma, Lazio' };
const anchor = { place: 'Roma', selectionLabel: 'Roma, Lazio' };
const stop = id => ({ id, label: id, lat: 41.9, lng: 12.49 });
const response = ids => ({ days: [{ date: DATE, primary_route: { main_stops: ids.map(stop) } }],
  agnostic_route_output_experiment: { promotion: { promote: true } } });
function entry({ intentMode = null, selected = [], ids, pins = [] }) {
  const inputs = { city: null, ...PLACE, mode: 'typed', dayOffset: 0, walkKey: 'free', selected, intentMode };
  const id = savedEntryId({ ...inputs, dateIso: DATE });
  const entries = Object.fromEntries(pins.map(pin => [pin, { kind: 'pin', label: pin }]));
  return buildSavedEntry({ ...PLACE, label: 'Roma', dateIso: DATE, savedAt: '2026-10-01T10:00:00.000Z',
    safeResponse: response(ids), classification: { status: 'composed' }, inputs,
    commitments: pins.length ? buildCommitmentSnapshot({ anchorKey: anchorKey(anchor), dayKey: id, entries,
      appliedPins: pins.map(pin => ({ id: pin, kind: 'pin', label: pin })), refusals: [] }) : null });
}

test('a neutral intent mode leaves every existing saved ID byte-identical', () => {
  const free = { ...PLACE, dateIso: DATE, selected: [], walkKey: 'free' };
  const picked = { ...PLACE, dateIso: DATE, selected: ['culture', 'food'], walkKey: 'balanced', preferencePriority: ['food', 'culture'] };
  for (const intentMode of [undefined, null, '', 'unknown_mode']) {
    assert.equal(savedEntryId({ ...free, intentMode }), 'Roma, Lazio::2026-10-01::::rhythm=free');
    assert.equal(savedEntryId({ ...picked, intentMode }), 'Roma, Lazio::2026-10-01::culture,food::rhythm=balanced::prio=food,culture');
  }
  assert.equal(entry({ ids: ['a', 'b'] }).id, 'Roma, Lazio::2026-10-01::::rhythm=free');
});

test('"Let Parranda choose" and an ordinary free day are two saved days', () => {
  const ordinary = entry({ ids: ['a', 'b'] });
  const chosen = entry({ intentMode: 'parranda_chooses', ids: ['c', 'd'] });
  assert.notEqual(chosen.id, ordinary.id);
  const saved = upsertSaved(upsertSaved([], ordinary), chosen);
  assert.deepEqual(saved.map(e => e.id).sort(), [ordinary.id, chosen.id].sort(), 'both answers stay saved');
  assert.deepEqual(saved.find(e => e.id === chosen.id).safeResponse.days[0].primary_route.main_stops.map(s => s.id), ['c', 'd']);
  assert.deepEqual(saved.find(e => e.id === ordinary.id).safeResponse.days[0].primary_route.main_stops.map(s => s.id), ['a', 'b']);
});

test('explicit picks win over the mode, so the mode adds nothing to their identity', () => {
  const base = { ...PLACE, dateIso: DATE, selected: ['culture'], walkKey: 'free' };
  assert.equal(savedEntryId({ ...base, intentMode: 'parranda_chooses' }), savedEntryId(base));
});

test('each mode\'s commitment ledger answers only for its own saved day', () => {
  const ordinary = entry({ ids: ['a', 'b'], pins: ['a'] });
  const chosen = entry({ intentMode: 'parranda_chooses', ids: ['c', 'd'], pins: ['c'] });
  const key = anchorKey(anchor);
  assert.equal(readCommitmentSnapshot(chosen.commitments, { anchorKey: key, dayKey: chosen.id }).applies, true);
  assert.equal(readCommitmentSnapshot(ordinary.commitments, { anchorKey: key, dayKey: ordinary.id }).applies, true);
  assert.equal(readCommitmentSnapshot(chosen.commitments, { anchorKey: key, dayKey: ordinary.id }).applies, false,
    'a Keep made while Parranda chose never applies to the ordinary day');
  assert.equal(readCommitmentSnapshot(ordinary.commitments, { anchorKey: key, dayKey: chosen.id }).applies, false);
});

test('a reload recovers a ledger only for the same intent mode', () => {
  const chosen = entry({ intentMode: 'parranda_chooses', ids: ['c', 'd'], pins: ['c'] });
  const context = mode => ({ navigationType: 'reload', anchor, dateIso: DATE, selected: [], walkKey: 'free', intentMode: mode });
  assert.equal(urlEntryCommitments(chosen, context('parranda_chooses')).applies, true);
  assert.deepEqual(Object.keys(urlEntryCommitments(chosen, context('parranda_chooses')).entries), ['c']);
  assert.equal(urlEntryCommitments(chosen, context(null)).applies, false, 'an ordinary reload never borrows the chosen day\'s Keep');
  const ordinary = entry({ ids: ['a', 'b'], pins: ['a'] });
  assert.equal(urlEntryCommitments(ordinary, context(null)).applies, true);
  assert.equal(urlEntryCommitments(ordinary, context('parranda_chooses')).applies, false);
});
